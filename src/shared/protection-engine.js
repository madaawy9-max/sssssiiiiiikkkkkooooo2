/* ============================================================================
 * RAVX — محرك الحماية والتشفير المشترك (مصدر الحقيقة الوحيد) — v2
 * ============================================================================
 * v2 changes (safe upgrades only):
 *   - Per-resource salt mixed into the PRNG seed
 *   - Multi-stage transform (PRNG stream + rolling add + rolling XOR)
 *   - Shuffled chunk order (storage order != execution order)
 *   - Split keys (seedA^seedB, mulA^mulB, addA^addB) — no plaintext keys
 *   - Dual CRC32 (blob + decoded source)
 *   - Fake decoder trap
 *   - Guarded jit check (only if jit exists)
 *   - Corrected environment check (GetCurrentResourceName, not GetGameTimer)
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------- */

// CRC32 for integrity (not security).
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

// xorshift32 — mirrored in Lua.
function xorshift32(state) {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;  state >>>= 0;
  return state >>> 0;
}

/* ---------------------------------------------------------------------------
 * buildProtectionCode — same as before, with the corrected env check baked in
 * ------------------------------------------------------------------------- */
function buildProtectionCode(licenseCode, rootFolderName, baseUrl) {
    const webhookUrl = process.env.WEBHOOK_URL || '';
    const licenseUrl = `${String(baseUrl || '').replace(/\/+$/, '')}/api/license/${licenseCode}`;
    return `
--------------------------------------------------
-- [🛡️ RAVX-TEAM SERVER SECURITY & IP CHECK] --
--------------------------------------------------
Citizen.CreateThread(function()
    Citizen.Wait(1000)
    local currentResourceName = GetCurrentResourceName()
    local expectedName = "${rootFolderName}"

    -- Environment check: GetCurrentResourceName exists on both client and server.
    if type(GetCurrentResourceName) ~= "function" then
        print("^1[RAVX SECURITY]^7 Not running inside FiveM — aborting.")
        return
    end

    if currentResourceName ~= expectedName then
        print("^8┌──────────────────────────────────────────────────────────┐^7")
        print("^1│  ⚠  RAVX SECURITY  —  RESOURCE INTEGRITY VIOLATION          │^7")
        print("^8├──────────────────────────────────────────────────────────┤^7")
        print("^1│  The resource folder name does not match the license.      │^7")
        print("^1│  Expected resource name : ^3" .. expectedName .. "^7")
        print("^1│  This resource will be terminated in 2 seconds.            │^7")
        print("^1│  Need help? Contact RAVX-TEAM support.                     │^7")
        print("^8└──────────────────────────────────────────────────────────┘^7")
        Citizen.Wait(2000)
        StopResource(currentResourceName)
        StopResource("qb-core")
        return
    end

    print("^5[RAVX SECURITY]^7 Initializing live license verification...")
    local LicenseCode = "${licenseCode}"
    local LicenseBaseURL = "${licenseUrl}"
    local WebhookURL = "${webhookUrl}"
    local authorized = false
    local checked = false
    local currentIP = "unknown"
    local ipDetected = false

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
            if ok and type(data) == "table" then
                authorized = data.authorized == true
                if data.ip and currentIP == "unknown" then currentIP = data.ip end
            end

            if authorized then
                print("^5╔══════════════════════════════════════════════════════════╗^7")
                print("^5║^7        ^2RAVX NEXUS SECURITY — LICENSE VERIFIED^7             ^5║^7")
                print("^5╠══════════════════════════════════════════════════════════╣^7")
                print("^5║^7  STATUS       : ^2AUTHORIZED^7                                 ^5║^7")
                print("^5║^7  RESOURCE     : ^3" .. currentResourceName .. "^7")
                print("^5║^7  IP ADDRESS   : ^3" .. currentIP .. "^7")
                print("^5║^7  LICENSE      : ^3" .. LicenseCode .. "^7")
                print("^5║^7  ENGINE       : ^2ACTIVE & PROTECTED (LIVE)^7                   ^5║^7")
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
                print("^1║^7  RESOURCE     : ^3" .. currentResourceName .. "^7")
                print("^1║^7  CURRENT IP   : ^3" .. currentIP .. "^7")
                print("^1║^7  LICENSE      : ^3" .. LicenseCode .. "^7")
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
            print("^1[RAVX SECURITY]^7 License server unreachable — license cannot be verified.^7")
        end
        checked = true
    end, "GET", "")

    local timeoutCount = 0
    while not checked and timeoutCount < 80 do
        timeoutCount = timeoutCount + 1
        Citizen.Wait(100)
    end

    if not checked then
        print("^1[RAVX SECURITY]^7 ⏰ Timed out waiting for the license server — check the server's internet connection.^7")
    end

    if not authorized then
        print("^1╔══════════════════════════════════════════════════════════╗^7")
        print("^1║^7   ⛔  RESOURCE HALTED — LICENSE VERIFICATION FAILED       ^1║^7")
        print("^1╚══════════════════════════════════════════════════════════╝^7")
        StopResource(currentResourceName)
        StopResource("qb-core")
        return
    end
end)
--------------------------------------------------
`;
}

/* ---------------------------------------------------------------------------
 * obfuscateLuaBlob — hardened multi-stage encoder
 * ------------------------------------------------------------------------- */
function obfuscateLuaBlob(sourceCode, chunkLabel) {
  const sourceBytes = Buffer.from(sourceCode, 'utf8');

  // --- Per-resource salt (8 random bytes) ---
  const salt = crypto.randomBytes(8);
  const saltArr = Array.from(salt);

  // --- Derive real seed by mixing salt into a random 32-bit value ---
  let seedReal = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
  for (const b of salt) seedReal = (((seedReal ^ b) >>> 0) * 16777619) >>> 0;

  // --- Split keys so no plaintext key exists in the file ---
  const seedMask = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
  const seedA    = (seedReal ^ seedMask) >>> 0;
  const seedB    = seedMask;

  const mulReal  = [3,5,7,9,11,13,17,19,23,29][crypto.randomInt(0,10)];
  const mulMask  = crypto.randomInt(1, 0xFF) >>> 0;
  const mulA     = mulReal ^ mulMask;
  const mulB     = mulMask;

  const addReal  = crypto.randomInt(1, 0xFF) >>> 0;
  const addMask  = crypto.randomInt(1, 0xFF) >>> 0;
  const addA     = addReal ^ addMask;
  const addB     = addMask;

  // --- Chunking: 4..7 chunks, shuffled storage order ---
  const nChunks  = 4 + crypto.randomInt(0, 4);
  const chunkLen = Math.ceil(sourceBytes.length / nChunks);
  const order    = Array.from({length: nChunks}, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  // --- Per-byte transform in execution order ---
  const transformed = Buffer.alloc(sourceBytes.length);
  let state = seedReal >>> 0;
  for (let execIdx = 0; execIdx < sourceBytes.length; execIdx++) {
    state = xorshift32(state);
    const k1 = state & 0xFF;
    state = xorshift32(state);
    const k2 = state & 0xFF;
    let b = sourceBytes[execIdx];
    b = (b ^ k1) & 0xFF;
    b = (b + ((execIdx * mulReal) % 251) + k2) & 0xFF;
    b = (b ^ ((addReal + (execIdx % 17)) & 0xFF)) & 0xFF;
    transformed[execIdx] = b;
  }

  // --- Store chunks in shuffled order ---
  const chunks = [];
  for (let c = 0; c < nChunks; c++) {
    const start = c * chunkLen;
    const end   = Math.min(start + chunkLen, transformed.length);
    chunks.push(transformed.slice(start, end));
  }
  const storedChunks = order.map(i => chunks[i]);
  const flat = Buffer.concat(storedChunks);

  // --- Dual CRC32 ---
  const blobCrc    = crc32(flat);
  const decodedCrc = crc32(sourceBytes);

  // --- Render byte rows ---
  const rows = [];
  for (let i = 0; i < flat.length; i += 60) {
    rows.push(Array.from(flat.slice(i, i + 60)).join(','));
  }

  // --- Per-file name mangling ---
  const uid = () => '_0x' + crypto.randomBytes(4).toString('hex');
  const id = {
    data: uid(), decode: uid(), xorStep: uid(), addStep: uid(),
    state: uid(), out: uid(), i: uid(), b: uid(), n: uid(),
    chunks: uid(), order: uid(), blobCrc: uid(), decodedCrc: uid(),
    env: uid(), fn: uid(), err: uid(), verify: uid(), crcFn: uid(),
    seedA: uid(), seedB: uid(), mulA: uid(), mulB: uid(),
    addA: uid(), addB: uid(), nC: uid(), cLen: uid(), total: uid(),
    salt: uid(), decoy: uid(), jitChk: uid(),
  };

  return `-- [RAVX-TEAM] Protected Resource — hardened multi-stage obfuscation (v2).
-- Integrity-checked. Do not edit.
local ${id.data} = {
    ${rows.join(',\n    ')}
}

-- Split-key material (each pair reconstructs the real value via XOR).
local ${id.seedA}, ${id.seedB} = ${seedA}, ${seedB}
local ${id.mulA},  ${id.mulB}  = ${mulA}, ${mulB}
local ${id.addA},  ${id.addB}  = ${addA}, ${addB}
local ${id.salt}               = {${saltArr.join(',')}}
local ${id.nC},    ${id.cLen}  = ${nChunks}, ${chunkLen}
local ${id.blobCrc}            = ${blobCrc}
local ${id.decodedCrc}         = ${decodedCrc}
local ${id.order}              = {${order.join(',')}}

-- Guarded jit check: only runs if jit exists (client-side LuaJIT).
local ${id.jitChk} = false
if type(jit) == "table" and type(jit.off) == "function" then
    ${id.jitChk} = true
end

local function ${id.xorStep}(${id.state})
    ${id.state} = ${id.state} ~ (${id.state} << 13)
    ${id.state} = ${id.state} & 0xFFFFFFFF
    ${id.state} = ${id.state} ~ (${id.state} >> 17)
    ${id.state} = ${id.state} ~ (${id.state} << 5)
    ${id.state} = ${id.state} & 0xFFFFFFFF
    return ${id.state}
end

-- Fake decoder trap: never called. Looks structurally identical to the real one.
local function ${id.decoy}(t)
    local o = {}
    for i = 1, #t do o[i] = string.char((t[i] * 7 + i) % 256) end
    return table.concat(o)
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

local function ${id.decode}()
    -- Blob CRC check first.
    local blobCrc = 0xFFFFFFFF
    for i = 1, #${id.data} do
        blobCrc = blobCrc ~ ${id.data}[i]
        for _ = 1, 8 do
            if blobCrc & 1 == 1 then blobCrc = (blobCrc >> 1) ~ 0xEDB88320
            else blobCrc = blobCrc >> 1 end
        end
    end
    blobCrc = (blobCrc ~ 0xFFFFFFFF) & 0xFFFFFFFF
    if blobCrc ~= ${id.blobCrc} then
        error("[RAVX SECURITY] Blob integrity check failed.")
    end

    -- Reconstruct chunks in stored order.
    local ${id.chunks} = {}
    local pos = 1
    for c = 1, ${id.nC} do
        local len = ${id.cLen}
        if pos + len - 1 > #${id.data} then len = #${id.data} - pos + 1 end
        ${id.chunks}[c] = {}
        for k = 1, len do ${id.chunks}[c][k] = ${id.data}[pos + k - 1] end
        pos = pos + len
    end

    -- Un-shuffle into execution order.
    local ordered = {}
    for c = 1, ${id.nC} do
        ordered[c] = ${id.chunks}[${id.order}[c] + 1]
    end

    -- Reconstruct keys.
    local seed = ${id.seedA} ~ ${id.seedB}
    for i = 1, #${id.salt} do
        seed = ((seed ~ ${id.salt}[i]) * 16777619) & 0xFFFFFFFF
    end
    local mul  = ${id.mulA}  ~ ${id.mulB}
    local add  = ${id.addA}  ~ ${id.addB}

    -- Replay the transform in reverse.
    local ${id.state} = seed
    local ${id.out}   = {}
    local execIdx = 0
    for c = 1, ${id.nC} do
        for k = 1, #ordered[c] do
            ${id.state} = ${id.xorStep}(${id.state})
            local k1 = ${id.state} & 0xFF
            ${id.state} = ${id.xorStep}(${id.state})
            local k2 = ${id.state} & 0xFF
            local b = ordered[c][k]
            b = b ~ ((add + (execIdx % 17)) & 0xFF)
            b = (b - ((execIdx * mul) % 251) - k2) % 256
            b = b ~ k1
            ${id.out}[#${id.out} + 1] = string.char(b)
            execIdx = execIdx + 1
        end
    end
    return table.concat(${id.out})
end

local decoded = ${id.decode}()
if ${id.crcFn}(decoded) ~= ${id.decodedCrc} then
    error("[RAVX SECURITY] Decoded integrity check failed.")
end

local ${id.env} = getfenv and getfenv() or _ENV
local ${id.fn}, ${id.err} = (loadstring or load)(decoded, "@${chunkLabel}", "t", ${id.env})
if not ${id.fn} then
    error("[RAVX SECURITY] Load failed: " .. tostring(${id.err}))
end
${id.fn}()
`;
}

/* ---------------------------------------------------------------------------
 * processAndProtectFiles — unchanged rules, now uses the v2 encoder
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

        // Force obfuscation on files that carry the guard.
        if (!shouldEncrypt && needsProtection) shouldEncrypt = true;

        const finalContent = shouldEncrypt ? obfuscateLuaBlob(mergedSource, 'ravx_protected') : mergedSource;
        fs.writeFileSync(fullPath, finalContent, 'utf8');
    }
}

/* ---------------------------------------------------------------------------
 * Unprotect — internal tool, mirrors the v2 encoder
 * ------------------------------------------------------------------------- */
const GUARD_BLOCK_RE = /\n-{5,}\n-- \[🛡️ RAVX-TEAM SERVER SECURITY & IP CHECK\] --\n-{5,}\nCitizen\.CreateThread\(function\(\)[\s\S]*?\nend\)\n-{5,}\n/;

function isProtectedLua(content) {
  return typeof content === 'string'
    && content.includes('[RAVX-TEAM] Protected Resource')
    && /local _0x[0-9a-f]{8} = \{/.test(content);
}

function unprotectLuaBlob(content) {
  if (!isProtectedLua(content)) return null;

  // Parse the byte table.
  const tableMatch = content.match(/local _0x[0-9a-f]{8} = \{([\s\S]*?)\n\}/);
  if (!tableMatch) return null;

  // Parse the four local lines we emit (seed/mul/add pairs, salt, nC/cLen, blobCrc, decodedCrc, order).
  const seedM = content.match(/local _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)/);
  const mulM  = content.match(/local _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)\nlocal _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)/);
  const addM  = content.match(/local _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)\nlocal _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)\nlocal _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)/);
  const saltM = content.match(/local _0x[0-9a-f]{8}\s*=\s*\{([\d,]+)\}/);
  const nCM   = content.match(/local _0x[0-9a-f]{8},\s*_0x[0-9a-f]{8}\s*=\s*(\d+),\s*(\d+)/);
  const crcM  = content.match(/local _0x[0-9a-f]{8}\s*=\s*(\d+)\nlocal _0x[0-9a-f]{8}\s*=\s*(\d+)/);
  const ordM  = content.match(/local _0x[0-9a-f]{8}\s*=\s*\{([\d,]+)\}/);

  if (!seedM || !mulM || !addM || !saltM || !nCM || !crcM || !ordM) return null;

  // Grab all "local _0x..., _0x... = a, b" lines in order.
  const pairLines = [...content.matchAll(/local (_0x[0-9a-f]{8}),\s*(_0x[0-9a-f]{8})\s*=\s*(\d+),\s*(\d+)/g)];
  if (pairLines.length < 5) return null;

  // Lines: 0 = seed pair, 1 = mul pair, 2 = add pair, 3 = nC/cLen.
  const seedA = Number(pairLines[0][3]), seedB = Number(pairLines[0][4]);
  const mulA  = Number(pairLines[1][3]), mulB  = Number(pairLines[1][4]);
  const addA  = Number(pairLines[2][3]), addB  = Number(pairLines[2][4]);
  const nC    = Number(pairLines[3][3]), cLen  = Number(pairLines[3][4]);

  const salt = saltM[1].split(',').map(Number);
  const order = ordM[1].split(',').map(Number);

  const bytes = tableMatch[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);

  // Rebuild stored chunks.
  const chunks = [];
  let pos = 0;
  for (let c = 0; c < nC; c++) {
    const len = Math.min(cLen, bytes.length - pos);
    chunks.push(bytes.slice(pos, pos + len));
    pos += len;
  }
  // Un-shuffle.
  const ordered = order.map(i => chunks[i]);
  const flat = [].concat(...ordered);

  // Reconstruct keys.
  let seed = (seedA ^ seedB) >>> 0;
  for (const b of salt) seed = (((seed ^ b) >>> 0) * 16777619) >>> 0;
  const mul = (mulA ^ mulB) >>> 0;
  const add = (addA ^ addB) >>> 0;

  // Reverse transform.
  let state = seed >>> 0;
  const out = Buffer.alloc(flat.length);
  let execIdx = 0;
  for (let i = 0; i < flat.length; i++) {
    state = xorshift32(state);
    const k1 = state & 0xFF;
    state = xorshift32(state);
    const k2 = state & 0xFF;
    let b = flat[i];
    b = (b ^ ((add + (execIdx % 17)) & 0xFF)) & 0xFF;
    b = (b - ((execIdx * mul) % 251) - k2) & 0xFF;
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
  processAndProtectFiles,
  buildProtectionCode,
  obfuscateLuaBlob,
  isProtectedLua,
  unprotectLuaBlob,
  stripEmbeddedGuard,
  unprotectFiles
};
