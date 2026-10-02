/* ---------------------------------------------------------------------------
 * RAVX — Protection Engine
 * ---------------------------------------------------------------------------
 * - obfuscateLuaBlob: multi-stage obfuscation (v4 fragmented multi-load)
 * - buildProtectionCode: v5 signed-token license check (HMAC-SHA256)
 * - processAndProtectFiles: walks .lua files, applies protection per mode
 * - unprotectLuaBlob / unprotectFiles: internal reverse tool (admin only)
 *
 * The Lua no longer trusts a boolean. It receives a base64url payload and a
 * hex HMAC signature, and verifies the signature using a per-script secret
 * baked into the obfuscated blob at encode time. A one-line edit like
 * `authorized = true` no longer works.
 * ------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { perScriptSecret } = require('./license-token');

/* ---------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------- */
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function xorshift32(state) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state >>> 0;
}

/* ---------------------------------------------------------------------------
 * buildProtectionCode — v5: signed-token license check
 * ------------------------------------------------------------------------- */
function buildProtectionCode(licenseCode, rootFolderName, baseUrl) {
    const webhookUrl = process.env.WEBHOOK_URL || '';
    const licenseUrl = `${String(baseUrl || '').replace(/\/+$/, '')}/api/license/${licenseCode}`;
    const scriptSecret = perScriptSecret(licenseCode);
    return `
--------------------------------------------------
-- [RAVX-TEAM SERVER SECURITY & IP CHECK] --
--------------------------------------------------
Citizen.CreateThread(function()
    Citizen.Wait(1000)
    local currentResourceName = GetCurrentResourceName()
    local expectedName = "${rootFolderName}"

    if type(GetCurrentResourceName) ~= "function" then
        print("^1[RAVX SECURITY]^7 Not running inside FiveM — aborting.")
        return
    end

    if currentResourceName ~= expectedName then
        print("^8┌──────────────────────────────────────────────────────────┐^7")
        print("^1│  ⚠  RAVX SECURITY  —  RESOURCE INTEGRITY VIOLATION          │^7")
        print("^8├──────────────────────────────────────────────────────────┤^7")
        print("^1│  Expected resource name : ^3" .. expectedName .. "^7")
        print("^1│  This resource will be terminated in 2 seconds.            │^7")
        print("^8└──────────────────────────────────────────────────────────┘^7")
        Citizen.Wait(2000)
        StopResource(currentResourceName)
        return
    end

    print("^5[RAVX SECURITY]^7 Initializing signed license verification...")
    local LicenseCode     = "${licenseCode}"
    local LicenseBaseURL  = "${licenseUrl}"
    local ScriptSecret    = "${scriptSecret}"
    local WebhookURL      = "${webhookUrl}"
    local authorized      = false
    local checked         = false
    local currentIP       = "unknown"
    local ipDetected      = false

    -- --- HMAC-SHA256 (pure Lua) ---
    local function _band(a, b)
        local r, bit = 0, 1
        for _ = 1, 32 do
            if a % 2 == 1 and b % 2 == 1 then r = r + bit end
            a = math.floor(a / 2); b = math.floor(b / 2); bit = bit * 2
        end
        return r
    end
    local function _bxor(a, b)
        local r, bit = 0, 1
        for _ = 1, 32 do
            local aa, bb = a % 2, b % 2
            if aa ~= bb then r = r + bit end
            a = math.floor(a / 2); b = math.floor(b / 2); bit = bit * 2
        end
        return r
    end
    local function _rrot(x, n) return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF end
    local function _sha256(msg)
        local K = {
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        }
        local H = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}
        local function _u32(x) return x & 0xFFFFFFFF end
        local function _add(...) local s = 0; for _, v in ipairs({...}) do s = _u32(s + v) end return s end
        local bytes = { string.byte(msg, 1, #msg) }
        local bitlen = #bytes * 8
        bytes[#bytes + 1] = 0x80
        while (#bytes % 64) ~= 56 do bytes[#bytes + 1] = 0 end
        for i = 7, 0, -1 do bytes[#bytes + 1] = math.floor(bitlen / (2 ^ (i * 8))) % 256 end
        for chunk = 0, (#bytes / 64) - 1 do
            local w = {}
            for i = 1, 16 do
                local o = chunk * 64 + (i - 1) * 4
                w[i] = _u32(bytes[o+1]*16777216 + bytes[o+2]*65536 + bytes[o+3]*256 + bytes[o+4])
            end
            for i = 17, 64 do
                local s0 = _bxor(_bxor(_rrot(w[i-15], 7), _rrot(w[i-15], 18)), (w[i-15] >> 3))
                local s1 = _bxor(_bxor(_rrot(w[i-2], 17), _rrot(w[i-2], 19)), (w[i-2] >> 10))
                w[i] = _u32(w[i-16] + s0 + w[i-7] + s1)
            end
            local a,b,c,d,e,f,g,h = H[1],H[2],H[3],H[4],H[5],H[6],H[7],H[8]
            for i = 1, 64 do
                local S1 = _bxor(_bxor(_rrot(e, 6), _rrot(e, 11)), _rrot(e, 25))
                local ch = _bxor(_band(e, f), _band(_bxor(e, 0xFFFFFFFF), g))
                local t1 = _u32(h + S1 + ch + K[i] + w[i])
                local S0 = _bxor(_bxor(_rrot(a, 2), _rrot(a, 13)), _rrot(a, 22))
                local mj = _bxor(_bxor(_band(a, b), _band(a, c)), _band(b, c))
                local t2 = _u32(S0 + mj)
                h,g,f,e,d,c,b,a = g,f,e,_u32(d + t1),c,b,a,_u32(t1 + t2)
            end
            H[1]=_u32(H[1]+a); H[2]=_u32(H[2]+b); H[3]=_u32(H[3]+c); H[4]=_u32(H[4]+d)
            H[5]=_u32(H[5]+e); H[6]=_u32(H[6]+f); H[7]=_u32(H[7]+g); H[8]=_u32(H[8]+h)
        end
        local out = ""
        for i = 1, 8 do out = out .. string.format("%08x", H[i]) end
        return out
    end
    local function _hmac_sha256(key, msg)
        if #key > 64 then key = _sha256(key) end
        local k = {}
        for i = 1, #key do k[i] = string.byte(key, i) end
        while #k < 64 do k[#k + 1] = 0 end
        local o_pad, i_pad = "", ""
        for i = 1, 64 do
            o_pad = o_pad .. string.char(_bxor(k[i], 0x5c))
            i_pad = i_pad .. string.char(_bxor(k[i], 0x36))
        end
        return _sha256(o_pad .. _sha256(i_pad .. msg))
    end
    local function _b64url_decode(s)
        s = s:gsub("%-", "+"):gsub("_", "/")
        local pad = (4 - (#s % 4)) % 4
        s = s .. string.rep("=", pad)
        local b = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        local map = {}
        for i = 1, 64 do map[b:sub(i, i)] = i - 1 end
        local out, buf, bits = {}, 0, 0
        for i = 1, #s do
            local c = s:sub(i, i)
            if c == "=" then break end
            local v = map[c]
            if v then
                buf = buf * 64 + v
                bits = bits + 6
                if bits >= 8 then
                    bits = bits - 8
                    out[#out + 1] = string.char(math.floor(buf / (2 ^ bits)) % 256)
                end
            end
        end
        return table.concat(out)
    end

    PerformHttpRequest("https://api4.ipify.org", function(err2, text2)
        if err2 == 200 and text2 then
            currentIP = text2:gsub("%s+", "")
        end
        ipDetected = true
    end, "GET", "")

    local ipWait = 0
    while not ipDetected and ipWait < 50 do
        ipWait = ipWait + 1
        Citizen.Wait(100)
    end

    local LicenseURL = LicenseBaseURL
    if currentIP ~= "unknown" and currentIP ~= "" then
        LicenseURL = LicenseBaseURL .. "?ip=" .. currentIP
    end

    PerformHttpRequest(LicenseURL, function(err, text, headers)
        if err == 200 and text then
            local ok, data = pcall(json.decode, text)
            if ok and type(data) == "table" and data.body and data.sig then
                local expected = _hmac_sha256(ScriptSecret, data.body)
                local valid = (expected == data.sig)
                if valid then
                    local decoded = json.decode(_b64url_decode(data.body))
                    if type(decoded) == "table"
                       and decoded.code == LicenseCode
                       and decoded.exp and decoded.exp > os.time()
                       and (decoded.ip == "" or decoded.ip == currentIP)
                       and data.authorized == true then
                        authorized = true
                    end
                else
                    print("^1[RAVX SECURITY]^7 Signature mismatch — license response tampered or forged.")
                end
            else
                print("^1[RAVX SECURITY]^7 License server returned an unrecognized response.")
            end

            if authorized then
                print("^5╔══════════════════════════════════════════════════════════╗^7")
                print("^5║^7        ^2RAVX NEXUS SECURITY — LICENSE VERIFIED^7             ^5║^7")
                print("^5╠══════════════════════════════════════════════════════════╣^7")
                print("^5║^7  STATUS       : ^2AUTHORIZED (SIGNED)^7                        ^5║^7")
                print("^5║^7  RESOURCE     : ^3" .. currentResourceName .. "^7")
                print("^5║^7  IP ADDRESS   : ^3" .. currentIP .. "^7")
                print("^5║^7  LICENSE      : ^3" .. LicenseCode .. "^7")
                print("^5╚══════════════════════════════════════════════════════════╝^7")
                if WebhookURL ~= "" then
                    PerformHttpRequest(WebhookURL, function() end, "POST", json.encode({
                        username = "RAVX Security System",
                        embeds = {{
                            title = "✅ تم تشغيل السكريبت بنجاح",
                            color = 65280,
                            fields = {
                                { name = "🌐 الآي بي الحالي:", value = "\`" .. currentIP .. "\`", inline = true },
                                { name = "🔑 كود الترخيص:", value = "\`" .. LicenseCode .. "\`", inline = true },
                                { name = "📂 السكريبت:", value = "\`" .. currentResourceName .. "\`", inline = true }
                            },
                            footer = { text = "RAVX TEAM Security Protection" }
                        }}
                    }), { ["Content-Type"] = "application/json" })
                end
            else
                print("^1╔══════════════════════════════════════════════════════════╗^7")
                print("^1║^7      ^8RAVX NEXUS SECURITY — LICENSE REJECTED^7               ^1║^7")
                print("^1╠══════════════════════════════════════════════════════════╣^7")
                print("^1║^7  STATUS       : ^1UNAUTHORIZED^7                               ^1║^7")
                print("^1║^7  CURRENT IP   : ^3" .. currentIP .. "^7")
                print("^1╚══════════════════════════════════════════════════════════╝^7")
                if WebhookURL ~= "" then
                    PerformHttpRequest(WebhookURL, function() end, "POST", json.encode({
                        username = "RAVX Security System",
                        embeds = {{
                            title = "🚨 محاولة تشغيل سكريبت على سيرفر غير مرخص!",
                            color = 16711680,
                            fields = {
                                { name = "🌐 الآي بي المحاول:", value = "\`" .. currentIP .. "\`", inline = true },
                                { name = "🔑 كود الترخيص:", value = "\`" .. LicenseCode .. "\`", inline = true },
                                { name = "📂 السكريبت:", value = "\`" .. currentResourceName .. "\`", inline = false }
                            },
                            footer = { text = "RAVX TEAM Security Protection" }
                        }}
                    }), { ["Content-Type"] = "application/json" })
                end
            end
        else
            print("^1[RAVX SECURITY]^7 License server unreachable — cannot verify signed token.")
        end
        checked = true
    end, "GET", "")

    local timeoutCount = 0
    while not checked and timeoutCount < 80 do
        timeoutCount = timeoutCount + 1
        Citizen.Wait(100)
    end

    if not checked then
        print("^1[RAVX SECURITY]^7 Timed out waiting for the license server.^7")
    end

    if not authorized then
        print("^1╔══════════════════════════════════════════════════════════╗^7")
        print("^1║^7   ⛔  RESOURCE HALTED — SIGNED LICENSE VERIFICATION FAILED  ^1║^7")
        print("^1╚══════════════════════════════════════════════════════════╝^7")
        StopResource(currentResourceName)
        return
    end
end)
--------------------------------------------------
`;
}

/* ---------------------------------------------------------------------------
 * obfuscateLuaBlob — v4: fragmented, multi-load, cross-chained
 * ------------------------------------------------------------------------- */
function obfuscateLuaBlob(sourceCode, chunkLabel) {
    const sourceBytes = Buffer.from(sourceCode, 'utf8');

    const FRAGMENT_COUNT = 4 + crypto.randomInt(0, 4);
    const fragLen = Math.ceil(sourceBytes.length / FRAGMENT_COUNT);

    const fragments = [];
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
        const start = i * fragLen;
        const end = Math.min(start + fragLen, sourceBytes.length);
        if (start >= end) break;
        fragments.push(sourceBytes.slice(start, end));
    }
    const actualFragCount = fragments.length;

    const fragKeys = [];
    let chain = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
    for (let i = 0; i < actualFragCount; i++) {
        chain = xorshift32(chain);
        const k = ((chain ^ (i * 0x9E3779B1)) >>> 0) & 0xFF;
        fragKeys.push(k);
        chain = ((chain + fragments[i].length) * 16777619) >>> 0;
    }

    const encodedFrags = fragments.map((frag, fi) => {
        const key = fragKeys[fi];
        const out = Buffer.alloc(frag.length);
        for (let i = 0; i < frag.length; i++) {
            let b = frag[i];
            b = (b ^ key) & 0xFF;
            b = (b + ((i * 7 + fi) % 251)) & 0xFF;
            b = (b ^ ((key + (i % 17) + fi) & 0xFF)) & 0xFF;
            out[i] = b;
        }
        return out;
    });

    const order = Array.from({ length: actualFragCount }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [order[i], order[j]] = [order[j], order[i]];
    }
    const storedFrags = order.map(i => encodedFrags[i]);

    const renderFragTable = (buf) => {
        const rows = [];
        for (let i = 0; i < buf.length; i += 60) {
            rows.push(Array.from(buf.slice(i, i + 60)).join(','));
        }
        return rows.join(',\n    ');
    };
    const fragTablesLua = storedFrags
        .map(buf => `{\n    ${renderFragTable(buf)}\n}`)
        .join(',\n');

    const blobCrc = crc32(Buffer.concat(storedFrags));
    const decodedCrc = crc32(sourceBytes);
    const fragCrcs = encodedFrags.map(f => crc32(f));

    const salt = crypto.randomBytes(8);
    const saltArr = Array.from(salt);
    let seedReal = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
    for (const b of salt) seedReal = (((seedReal ^ b) >>> 0) * 16777619) >>> 0;
    const seedMask = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
    const seedA = (seedReal ^ seedMask) >>> 0;
    const seedB = seedMask;

    const decoy1 = crypto.randomBytes(16 + crypto.randomInt(0, 16)).toString('hex');
    const decoy2 = crypto.randomBytes(16 + crypto.randomInt(0, 16)).toString('hex');

    const uid = () => '_0x' + crypto.randomBytes(4).toString('hex');
    const id = {
        frags: uid(), order: uid(), keys: uid(), blobCrc: uid(),
        decodedCrc: uid(), fragCrcs: uid(), xorStep: uid(),
        decode: uid(), decode2: uid(), crcFn: uid(), env: uid(),
        seedA: uid(), seedB: uid(), salt: uid(), d1: uid(), d2: uid(),
        fn: uid(), err: uid(), state: uid(), jit: uid(), len: uid(),
        frag: uid(), i: uid(), k: uid(), out: uid(), tmp: uid(),
        assembled: uid(), chain: uid(), first: uid(),
    };

    return `-- [RAVX-TEAM] Protected Resource — v4 (fragmented multi-load).
-- Integrity-checked. Do not edit.
local ${id.frags} = {
${fragTablesLua}
}

local ${id.order}     = {${order.join(',')}}
local ${id.keys}      = {${fragKeys.join(',')}}
local ${id.blobCrc}   = ${blobCrc}
local ${id.decodedCrc}= ${decodedCrc}
local ${id.fragCrcs}  = {${fragCrcs.join(',')}}
local ${id.seedA}, ${id.seedB} = ${seedA}, ${seedB}
local ${id.salt}      = {${saltArr.join(',')}}
local ${id.d1}        = "${decoy1}"
local ${id.d2}        = "${decoy2}"

local ${id.jit} = false
if type(jit) == "table" and type(jit.off) == "function" then ${id.jit} = true end

local function ${id.xorStep}(${id.state})
    ${id.state} = ${id.state} ~ (${id.state} << 13)
    ${id.state} = ${id.state} & 0xFFFFFFFF
    ${id.state} = ${id.state} ~ (${id.state} >> 17)
    ${id.state} = ${id.state} ~ (${id.state} << 5)
    ${id.state} = ${id.state} & 0xFFFFFFFF
    return ${id.state}
end

local function ${id.crcFn}(s)
    local crc = 0xFFFFFFFF
    for i = 1, #s do
        crc = crc ~ string.byte(s, i)
        for _ = 1, 8 do
            if crc & 1 == 1 then crc = (crc >> 1) ~ 0xEDB88320
            else crc = crc >> 1 end
        end
    end
    return (crc ~ 0xFFFFFFFF) & 0xFFFFFFFF
end

local function ${id.decode2}(t, key)
    local o = {}
    for i = 1, #t do o[i] = string.char((t[i] * 7 + i + key) % 256) end
    return table.concat(o)
end

local function ${id.decode}(${id.frag}, ${id.k}, fragIndex)
    local ${id.out} = {}
    for ${id.i} = 1, #${id.frag} do
        local ${id.i}_0 = ${id.i} - 1
        local b = ${id.frag}[${id.i}]
        b = b ~ ((${id.k} + (${id.i}_0 % 17) + fragIndex) & 0xFF)
        b = (b - ((${id.i}_0 * 7 + fragIndex) % 251)) % 256
        b = b ~ ${id.k}
        ${id.out}[#${id.out} + 1] = string.char(b)
    end
    return table.concat(${id.out})
end

local ${id.env} = getfenv and getfenv() or _ENV

do
    local acc = {}
    for i = 1, #${id.frags} do
        for j = 1, #${id.frags}[i] do acc[#acc + 1] = ${id.frags}[i][j] end
    end
    local blobCrc = 0xFFFFFFFF
    for i = 1, #acc do
        blobCrc = blobCrc ~ acc[i]
        for _ = 1, 8 do
            if blobCrc & 1 == 1 then blobCrc = (blobCrc >> 1) ~ 0xEDB88320
            else blobCrc = blobCrc >> 1 end
        end
    end
    blobCrc = (blobCrc ~ 0xFFFFFFFF) & 0xFFFFFFFF
    if blobCrc ~= ${id.blobCrc} then
        error("[RAVX SECURITY] Blob integrity check failed.")
    end
end

local ${id.chain} = ${id.seedA} ~ ${id.seedB}
for i = 1, #${id.salt} do
    ${id.chain} = ((${id.chain} ~ ${id.salt}[i]) * 16777619) & 0xFFFFFFFF
end
${id.chain} = (${id.chain} + (#${id.d1} + #${id.d2})) & 0xFFFFFFFF

local ${id.assembled} = {}
for ${id.i} = 1, #${id.order} do
    local storedIdx = ${id.order}[${id.i}]
    local frag = ${id.frags}[storedIdx + 1]

    local acc = {}
    for j = 1, #frag do acc[#acc + 1] = frag[j] end
    local fragCrc = 0xFFFFFFFF
    for j = 1, #acc do
        fragCrc = fragCrc ~ acc[j]
        for _ = 1, 8 do
            if fragCrc & 1 == 1 then fragCrc = (fragCrc >> 1) ~ 0xEDB88320
            else fragCrc = fragCrc >> 1 end
        end
    end
    fragCrc = (fragCrc ~ 0xFFFFFFFF) & 0xFFFFFFFF
    if fragCrc ~= ${id.fragCrcs}[${id.i}] then
        error("[RAVX SECURITY] Fragment integrity check failed.")
    end

    ${id.chain} = ${id.xorStep}(${id.chain})
    local k = ((${id.chain} ^ ((${id.i} - 1) * 0x9E3779B1)) & 0xFF)
    if k ~= ${id.keys}[${id.i}] then
        error("[RAVX SECURITY] Key chain mismatch.")
    end

    local plain = ${id.decode}(frag, k, ${id.i} - 1)
    ${id.assembled}[#${id.assembled} + 1] = plain

    ${id.chain} = ((${id.chain} + #plain) * 16777619) & 0xFFFFFFFF
end

local finalSource = table.concat(${id.assembled})
if ${id.crcFn}(finalSource) ~= ${id.decodedCrc} then
    error("[RAVX SECURITY] Decoded integrity check failed.")
end

local ${id.fn}, ${id.err} = (loadstring or load)(finalSource, "@${chunkLabel}", "t", ${id.env})
if not ${id.fn} then
    error("[RAVX SECURITY] Load failed: " .. tostring(${id.err}))
end
${id.fn}()
`;
}

/* ---------------------------------------------------------------------------
 * processAndProtectFiles — walks .lua files and applies protection
 * ------------------------------------------------------------------------- */
function processAndProtectFiles(dirPath, licenseCode, rootFolderName, encryptionMode, baseUrl) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            processAndProtectFiles(fullPath, licenseCode, rootFolderName, encryptionMode, baseUrl);
            continue;
        }

        const extName = path.extname(entry.name).toLowerCase();
        if (extName !== '.lua') continue;

        const baseName = path.basename(entry.name, extName).toLowerCase();
        const originalContent = fs.readFileSync(fullPath, 'utf8');

        const needsProtection = baseName.includes('server') || baseName.includes('main');
        const protectionCode = needsProtection ? buildProtectionCode(licenseCode, rootFolderName, baseUrl) : '';

        const mergedSource = protectionCode ? (protectionCode + '\n' + originalContent) : originalContent;

        let shouldEncrypt;
        if (encryptionMode === 'full') {
            shouldEncrypt = true;
        } else if (encryptionMode === 'target') {
            shouldEncrypt = baseName.includes('client') || baseName.includes('server') || baseName.includes('script') || baseName.includes('main');
        } else {
            shouldEncrypt = false;
        }

        if (!shouldEncrypt && needsProtection) shouldEncrypt = true;

        const finalContent = shouldEncrypt ? obfuscateLuaBlob(mergedSource, 'ravx_protected') : mergedSource;
        fs.writeFileSync(fullPath, finalContent, 'utf8');
    }
}

/* ---------------------------------------------------------------------------
 * Unprotect — internal tool
 * ------------------------------------------------------------------------- */
const GUARD_BLOCK_RE = /\n-{5,}\n-- \[🛡️ RAVX-TEAM SERVER SECURITY & IP CHECK\] --\n-{5,}\nCitizen\.CreateThread\(function\(\)[\s\S]*?\nend\)\n-{5,}\n/;

function isProtectedLua(content) {
    return typeof content === 'string'
        && content.includes('[RAVX-TEAM] Protected Resource')
        && /local _0x[0-9a-f]{8} = \{/.test(content);
}

function unprotectLuaBlob(content) {
    if (!isProtectedLua(content)) return null;

    const tableMatch = content.match(/local _0x[0-9a-f]{8} = \{([\s\S]*?)\n\}/);
    if (!tableMatch) return null;

    const pairLines = [...content.matchAll(/local (_0x[0-9a-f]{8}),\s*(_0x[0-9a-f]{8})\s*=\s*(\d+),\s*(\d+)/g)];
    if (pairLines.length < 5) return null;

    const orderMatch = content.match(/local _0x[0-9a-f]{8}\s*=\s*\{([\d,]+)\}/);
    const saltMatch = content.match(/local _0x[0-9a-f]{8}\s*=\s*\{([\d,]+)\}/g);
    if (!orderMatch) return null;

    const seedA = Number(pairLines[0][3]), seedB = Number(pairLines[0][4]);
    const nC = Number(pairLines[3][3]), cLen = Number(pairLines[3][4]);
    const order = orderMatch[1].split(',').map(Number);

    const bytes = tableMatch[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);

    const chunks = [];
    let pos = 0;
    for (let c = 0; c < nC; c++) {
        const len = Math.min(cLen, bytes.length - pos);
        chunks.push(bytes.slice(pos, pos + len));
        pos += len;
    }
    const ordered = order.map(i => chunks[i]);
    const flat = [].concat(...ordered);

    let seed = (seedA ^ seedB) >>> 0;
    // Note: salt is applied at encode time, but reversing it requires the exact
    // salt array. It's present in the file but the regex above is simplified.
    // For fully robust unprotect, use the CLI version with a proper parser.

    let state = seed >>> 0;
    const out = Buffer.alloc(flat.length);
    let execIdx = 0;
    for (let i = 0; i < flat.length; i++) {
        state = xorshift32(state);
        const k1 = state & 0xFF;
        state = xorshift32(state);
        const k2 = state & 0xFF;
        let b = flat[i];
        b = (b ^ ((0 + (execIdx % 17)) & 0xFF)) & 0xFF;
        b = (b - ((execIdx * 1) % 251) - k2) & 0xFF;
        b = (b ^ k1) & 0xFF;
        out[i] = b;
        execIdx++;
    }
    return out.toString('utf8');
}

function stripEmbeddedGuard(mergedSource) {
    if (!GUARD_BLOCK_RE.test(mergedSource)) return mergedSource;
    return mergedSource.replace(GUARD_BLOCK_RE, '').replace(/^\n+/, '');
}

function unprotectFiles(dirPath) {
    const report = { processed: 0, unprotected: 0, files: [] };
    const walk = dir => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                walk(fullPath);
                continue;
            }
            if (path.extname(entry.name).toLowerCase() !== '.lua') continue;
            report.processed++;
            const content = fs.readFileSync(fullPath, 'utf8');
            const decoded = unprotectLuaBlob(content);
            if (decoded === null) continue;
            const clean = stripEmbeddedGuard(decoded);
            fs.writeFileSync(fullPath, clean, 'utf8');
            report.unprotected++;
            report.files.push(path.relative(dirPath, fullPath));
        }
    };
    walk(dirPath);
    return report;
}

module.exports = {
    buildProtectionCode,
    obfuscateLuaBlob,
    processAndProtectFiles,
    isProtectedLua,
    unprotectLuaBlob,
    stripEmbeddedGuard,
    unprotectFiles,
};