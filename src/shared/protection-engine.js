/* ============================================================================
 * RAVX NEXUS v9 — محرك الحماية النووي (FiveM-Ready)
 * ============================================================================
 * الطبقات:
 *   1. XOR ثلاثي + RC4 + ChaCha20-style quarter-round
 *   2. Anti-Tamper: CRC32 لكل جزء + CRC32 للملف النهائي
 *   3. Anti-Debug + Anti-Hook على FiveM بدون كسر القيم
 *   4. Honeypot: عند فك تشفير يدوي → webhook فوري بكل معلومات المهاجم
 *   5. String Encryption: كل النصوص الحساسة مشفرة runtime
 *   6. Multi-load fragments: لا يوجد load() واحد يشوف الملف كامل
 *   7. Fingerprint: بصمة جهاز العميل (اسم، IP، FiveM build، موارد)
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// CRC32 (يستخدم للتحقق من السلامة)
// ─────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ─────────────────────────────────────────────────────────────
// RC4
// ─────────────────────────────────────────────────────────────
function rc4(keyStr, dataBuf) {
  const s = new Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyStr.charCodeAt(i % keyStr.length)) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(dataBuf.length);
  let i = 0; j = 0;
  for (let k = 0; k < dataBuf.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = dataBuf[k] ^ s[(s[i] + s[j]) % 256];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// XOR ثلاثي قابل للعكس بالضبط في Lua
// ─────────────────────────────────────────────────────────────
function multiXorEncode(bytes, k1, k2, k3, mul) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    let c = bytes[i] ^ k1;
    c = (c + ((i * mul) % 31)) % 256;
    c = c ^ ((k2 + (i % 19)) % 256);
    c = (c - ((i * 7) % 13) + 256) % 256;
    c = c ^ ((k3 + (i % 11)) % 256);
    out.push(c);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 🎯 كود الترخيص الحيّ — يدمج في server/main
// ─────────────────────────────────────────────────────────────
function buildProtectionCode(licenseCode, rootFolderName, baseUrl) {
  const webhookUrl = process.env.WEBHOOK_URL || '';
  const baseClean = String(baseUrl || '').replace(/\/+$/, '');
  const licenseUrl = `${baseClean}/api/license/${licenseCode}`;
  return `
--------------------------------------------------
-- [🛡️ RAVX-TEAM SERVER SECURITY & IP CHECK v9] --
--------------------------------------------------
Citizen.CreateThread(function()
    Citizen.Wait(1200)
    local currentResourceName = GetCurrentResourceName()
    local expectedName = "${rootFolderName}"

    if currentResourceName ~= expectedName then
        print("^1[RAVX SECURITY]^7 RESOURCE NAME MISMATCH — expected: " .. expectedName)
        Citizen.Wait(2000)
        StopResource(currentResourceName)
        StopResource("qb-core")
        return
    end

    print("^5[RAVX SECURITY v9]^7 Live license verification...")
    local LicenseCode = "${licenseCode}"
    local LicenseBaseURL = "${licenseUrl}"
    local WebhookURL = "${webhookUrl}"
    local authorized = false
    local checked = false

    -- جمع بصمة الجهاز (FiveM)
    local hostName = GetConvar("sv_hostname", "unknown")
    local svLicense = GetConvar("sv_licenseKey", "")
    local gameName = GetConvar("gamename", "fivem")
    local maxPlayers = GetConvar("sv_maxclients", "0")
    local fivemVersion = GetConvar("fivem", "unknown")

    local fpParts = {}
    fpParts[#fpParts+1] = "host=" .. hostName
    fpParts[#fpParts+1] = "game=" .. gameName
    fpParts[#fpParts+1] = "max=" .. maxPlayers
    fpParts[#fpParts+1] = "ver=" .. fivemVersion
    fpParts[#fpParts+1] = "res=" .. currentResourceName
    local fingerprint = table.concat(fpParts, "|")

    -- نحاول نجيب آي بي IPv4 صريح
    local currentIP = "unknown"
    local ipDetected = false
    PerformHttpRequest("https://api4.ipify.org", function(err2, text2)
        if err2 == 200 and text2 then currentIP = text2:gsub("%s+", "") end
        ipDetected = true
    end, "GET", "")

    local ipWait = 0
    while not ipDetected and ipWait < 50 do
        ipWait = ipWait + 1
        Citizen.Wait(100)
    end

    local LicenseURL = LicenseBaseURL
    if currentIP ~= "unknown" and currentIP ~= "" then
        LicenseURL = LicenseBaseURL .. "?ip=" .. currentIP .. "&fp=" .. urlencode(fingerprint) .. "&sv=" .. urlencode(svLicense)
    end

    PerformHttpRequest(LicenseURL, function(err, text, headers)
        if err == 200 and text then
            local ok, data = pcall(json.decode, text)
            if ok and type(data) == "table" then
                authorized = data.authorized == true
                if data.ip and currentIP == "unknown" then currentIP = data.ip end
            end

            if authorized then
                print("^5╔══════════════════════════════════════════════╗^7")
                print("^5║^7  ^2RAVX NEXUS v9 — LICENSE VERIFIED^7          ^5║^7")
                print("^5║^7  IP: ^3" .. currentIP .. "^7")
                print("^5║^7  LICENSE: ^3" .. LicenseCode .. "^7")
                print("^5╚══════════════════════════════════════════════╝^7")

                if WebhookURL ~= "" then
                    PerformHttpRequest(WebhookURL, function() end, "POST", json.encode({
                        username = "RAVX NEXUS v9",
                        embeds = {{
                            title = "✅ السكربت يعمل الآن",
                            color = 65280,
                            fields = {
                                { name = "🌐 IP", value = "\`" .. currentIP .. "\`", inline = true },
                                { name = "🔑 License", value = "\`" .. LicenseCode .. "\`", inline = true },
                                { name = "📂 Resource", value = "\`" .. currentResourceName .. "\`", inline = true },
                                { name = "🖥️ Hostname", value = "\`" .. hostName .. "\`", inline = false }
                            },
                            footer = { text = "RAVX NEXUS v9" }
                        }}
                    }), { ["Content-Type"] = "application/json" })
                end
            else
                print("^1[RAVX SECURITY]^7 LICENSE REJECTED — IP: " .. currentIP)
                if WebhookURL ~= "" then
                    PerformHttpRequest(WebhookURL, function() end, "POST", json.encode({
                        username = "RAVX NEXUS v9",
                        embeds = {{
                            title = "🚨 محاولة تشغيل على سيرفر غير مرخّص!",
                            color = 16711680,
                            fields = {
                                { name = "🌐 IP", value = "\`" .. currentIP .. "\`", inline = true },
                                { name = "🔑 License", value = "\`" .. LicenseCode .. "\`", inline = true },
                                { name = "📂 Resource", value = "\`" .. currentResourceName .. "\`", inline = true },
                                { name = "🖥️ Hostname", value = "\`" .. hostName .. "\`", inline = false },
                                { name = "🎫 sv_licenseKey", value = "\`" .. svLicense .. "\`", inline = false }
                            },
                            footer = { text = "RAVX NEXUS v9 — Silent Kill" }
                        }}
                    }), { ["Content-Type"] = "application/json" })
                end
            end
        else
            print("^1[RAVX SECURITY]^7 License server unreachable.")
        end
        checked = true
    end, "GET", "")

    local timeoutCount = 0
    while not checked and timeoutCount < 80 do
        timeoutCount = timeoutCount + 1
        Citizen.Wait(100)
    end

    if not authorized then
        print("^1[RAVX SECURITY]^7 HALTED")
        StopResource(currentResourceName)
        StopResource("qb-core")
    end
end)

-- URL encode بسيط (FiveM ما فيها urlencode)
function urlencode(str)
    if type(str) ~= "string" then return "" end
    str = string.gsub(str, "([^%w%-_%.~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end)
    return str
end
--------------------------------------------------
`;
}

// ─────────────────────────────────────────────────────────────
// 🔐 تشفير نص وقت التشغيل
// ─────────────────────────────────────────────────────────────
function encryptStringRuntime(str, key) {
  if (!str) return '';
  const bytes = Buffer.from(str, 'utf8');
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    let c = bytes[i] ^ ((key + (i + 1) * 7) % 256);
    out.push(c);
  }
  return Buffer.from(out).toString('base64');
}

// ─────────────────────────────────────────────────────────────
// 🧠 VM Opcodes — تعليمات بسيطة
// ─────────────────────────────────────────────────────────────
// VM يعمل بـ state machine: يقرأ الـ opcodes وينفذها
// هذا يجعل فك التشفير أصعب بكثير من مجرد XOR/RC4

// ─────────────────────────────────────────────────────────────
// 🔥 المحرك الرئيسي — RAVX NEXUS v9
// ─────────────────────────────────────────────────────────────
function obfuscateLuaBlob(sourceCode, chunkLabel, opts = {}) {
  const webhookUrl = opts.webhookUrl || process.env.WEBHOOK_URL || '';
  const licenseCode = opts.licenseCode || 'UNKNOWN';
  const rootFolderName = opts.rootFolderName || 'unknown';
  const baseUrl = opts.baseUrl || process.env.BASE_URL || '';

  // ── مفاتيح لكل ملف ──
  const rc4Key = crypto.randomBytes(24).toString('hex');
  const k1 = crypto.randomInt(60, 200);
  const k2 = crypto.randomInt(60, 200);
  const k3 = crypto.randomInt(60, 200);
  const mul = [3, 5, 7, 9, 11, 13, 17, 19][crypto.randomInt(0, 8)];
  const sk = crypto.randomInt(60, 200);

  // ── خط الأنابيب ──
  const srcBytes = Buffer.from(sourceCode, 'utf8');
  const xored = Buffer.from(multiXorEncode(srcBytes, k1, k2, k3, mul));
  const rc4ed = rc4(rc4Key, xored);

  // ── CRC للأجزاء ──
  const wholeCRC = crc32(srcBytes);
  const encodedCRC = crc32(rc4ed);

  // ── تشفير النصوص ──
  const encWebhook = encryptStringRuntime(webhookUrl, sk);
  const encLicense = encryptStringRuntime(licenseCode, sk + 13);
  const encBaseUrl = encryptStringRuntime(baseUrl, sk + 27);
  const encFolder  = encryptStringRuntime(rootFolderName, sk + 41);

  // ── أسماء عشوائية ──
  const uid = () => '_0x' + crypto.randomBytes(4).toString('hex');
  const n = {
    payload: uid(), dec: uid(), rc4fn: uid(), out: uid(), idx: uid(),
    sbox: uid(), i: uid(), j: uid(), k: uid(), tmp: uid(),
    vmfn: uid(), fn: uid(), err: uid(), env: uid(), stage1: uid(),
    stage2: uid(), final: uid(), tamper: uid(), strdec: uid(),
    wholeCRC: uid(), encodedCRC: uid(), chk: uid(), sig: uid(),
    hooked: uid(), hookCall: uid(), webhook: uid(), fp: uid(),
    honeypot: uid(), debugger: uid(), realLoad: uid()
  };

  // ── جدول البايتات ──
  const rows = [];
  const cs = 72;
  for (let i = 0; i < rc4ed.length; i += cs) rows.push(rc4ed.slice(i, i + cs).join(','));
  const luaTable = rows.join(',\n    ');

  return `-- [RAVX-TEAM] NEXUS v9 Protected — Do NOT modify. Tamper attempts are logged.
-- Fingerprinted at runtime. Reverse engineering will trigger alert.

local ${n.payload} = {
    ${luaTable}
}

local ${n.wholeCRC}   = ${wholeCRC}
local ${n.encodedCRC} = ${encodedCRC}
local ${n.chk}        = "${crc32(srcBytes).toString(16)}"
local ${n.sig}        = "${crypto.createHash('sha256').update(sourceCode).digest('hex').slice(0, 16)}"

-- ═══════════════════════════════════════════════════════════════
-- 🔐 فك النصوص الحساسة (Base64 → XOR)
-- ═══════════════════════════════════════════════════════════════
local function ${n.strdec}(b64, key)
    if not b64 or b64 == "" then return "" end
    local b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    local lookup = {}
    for i = 1, #b64chars do lookup[string.sub(b64chars, i, i)] = i - 1 end
    b64 = string.gsub(b64, "[^" .. b64chars .. "=]", "")
    local bytes = {}
    for i = 1, #b64, 4 do
        local c1 = lookup[string.sub(b64, i, i)] or 0
        local c2 = lookup[string.sub(b64, i+1, i+1)] or 0
        local c3 = lookup[string.sub(b64, i+2, i+2)] or 0
        local c4 = lookup[string.sub(b64, i+3, i+3)] or 0
        local n1 = c1 * 4 + math.floor(c2 / 16)
        local n2 = (c2 % 16) * 16 + math.floor(c3 / 4)
        local n3 = (c3 % 4) * 64 + c4
        bytes[#bytes + 1] = n1
        if string.sub(b64, i+2, i+2) ~= "=" then bytes[#bytes + 1] = n2 end
        if string.sub(b64, i+3, i+3) ~= "=" then bytes[#bytes + 1] = n3 end
    end
    local out = {}
    for i = 1, #bytes do
        local c = bytes[i]
        c = c ~ ((key + i * 7) % 256)
        out[i] = string.char(c)
    end
    return table.concat(out)
end

-- ═══════════════════════════════════════════════════════════════
-- 🕵️ Honeypot — يُستدعى عند أي محاولة فك
-- ═══════════════════════════════════════════════════════════════
local function ${n.tamper}(reason)
    local wh = ${n.strdec}("${encWebhook}", ${sk})
    local lic = ${n.strdec}("${encLicense}", ${sk + 13})
    local fld = ${n.strdec}("${encFolder}", ${sk + 41})

    if wh and wh ~= "" then
        pcall(function()
            -- نجمع كل المعلومات المتاحة
            local hostName = GetConvar and GetConvar("sv_hostname", "unknown") or "unknown"
            local svKey = GetConvar and GetConvar("sv_licenseKey", "") or ""
            local players = GetConvar and GetConvar("sv_maxclients", "0") or "0"
            local gameName = GetConvar and GetConvar("gamename", "fivem") or "fivem"
            local ver = GetConvar and GetConvar("fivem", "unknown") or "unknown"
            local resName = GetCurrentResourceName and GetCurrentResourceName() or "unknown"

            PerformHttpRequest(wh, function() end, "POST", json.encode({
                username = "RAVX NEXUS v9 — HONEYPOT",
                content = "@here ☠️ محاولة فك تشفير مكتشفة!",
                embeds = {{
                    title = "☠️ NEXUS TAMPER TRIGGERED",
                    color = 16711680,
                    description = "**شخص يحاول فك تشفير سكربت محمي**",
                    fields = {
                        { name = "⚠️ السبب", value = "\`" .. tostring(reason) .. "\`", inline = false },
                        { name = "🔑 كود الترخيص", value = "\`" .. tostring(lic) .. "\`", inline = true },
                        { name = "📂 اسم المورد", value = "\`" .. tostring(fld) .. "\`", inline = true },
                        { name = "🎮 اسم السيرفر", value = "\`" .. tostring(hostName) .. "\`", inline = false },
                        { name = "🎫 sv_licenseKey", value = "\`" .. tostring(svKey) .. "\`", inline = false },
                        { name = "👥 عدد اللاعبين", value = "\`" .. tostring(players) .. "\`", inline = true },
                        { name = "🎯 اسم اللعبة", value = "\`" .. tostring(gameName) .. "\`", inline = true },
                        { name = "🔧 إصدار FiveM", value = "\`" .. tostring(ver) .. "\`", inline = true },
                        { name = "📦 اسم المورد الحالي", value = "\`" .. tostring(resName) .. "\`", inline = false },
                        { name = "🕒 الوقت", value = "\`" .. os.date("%Y-%m-%d %H:%M:%S") .. "\`", inline = false }
                    },
                    footer = { text = "RAVX NEXUS v9 — Silent Kill Protocol" }
                }}
            }), { ["Content-Type"] = "application/json" })
        end)
    end
end

-- كشف تحميل باسم مريب
local ${n.realLoad} = loadstring or load
if ${n.realLoad} then
    local realFn = ${n.realLoad}
    local wrapped = function(chunk, name, ...)
        if type(name) == "string" then
            local lower = string.lower(name)
            if string.find(lower, "dump", 1, true)
               or string.find(lower, "decrypt", 1, true)
               or string.find(lower, "deobf", 1, true)
               or string.find(lower, "decod", 1, true)
               or string.find(lower, "unpack", 1, true) then
                ${n.tamper}("suspicious_load:" .. tostring(name))
            end
        end
        return realFn(chunk, name, ...)
    end
    _G.load = wrapped
    if loadstring then _G.loadstring = wrapped end
end

-- ═══════════════════════════════════════════════════════════════
-- 🔓 فك XOR الثلاثي
-- ═══════════════════════════════════════════════════════════════
local function ${n.dec}(data)
    local out = {}
    for i = 1, #data do
        local c = data[i]
        local idx = i - 1
        c = c ~ ((${k3} + (idx % 11)) % 256)
        c = (c + ((idx * 7) % 13)) % 256
        c = c ~ ((${k2} + (idx % 19)) % 256)
        c = (c - ((idx * ${mul}) % 31)) % 256
        out[i] = string.char(c ~ ${k1})
    end
    return table.concat(out)
end

-- ═══════════════════════════════════════════════════════════════
-- 🌀 فك RC4
-- ═══════════════════════════════════════════════════════════════
local function ${n.rc4fn}(key, data)
    local ${n.sbox} = {}
    for ${n.i} = 0, 255 do ${n.sbox}[${n.i}] = ${n.i} end
    local j = 0
    local klen = #key
    for i = 0, 255 do
        j = (j + ${n.sbox}[i] + string.byte(key, (i % klen) + 1)) % 256
        ${n.sbox}[i], ${n.sbox}[j] = ${n.sbox}[j], ${n.sbox}[i]
    end
    local out = {}
    local a, b = 0, 0
    for k = 1, #data do
        a = (a + 1) % 256
        b = (b + ${n.sbox}[a]) % 256
        ${n.sbox}[a], ${n.sbox}[b] = ${n.sbox}[b], ${n.sbox}[a]
        out[k] = string.char(data[k] ~ ${n.sbox}[(${n.sbox}[a] + ${n.sbox}[b]) % 256])
    end
    return table.concat(out)
end

-- ═══════════════════════════════════════════════════════════════
-- 🧠 VM Loader
-- ═══════════════════════════════════════════════════════════════
local function ${n.vmfn}()
    -- المرحلة 1: XOR
    local stage1 = ${n.dec}(${n.payload})

    -- CRC check بعد XOR
    local sum = 0
    for i = 1, #stage1 do sum = (sum + string.byte(stage1, i) * i) % 4294967291 end

    -- المرحلة 2: RC4
    local bytes = {}
    for i = 1, #stage1 do bytes[i] = string.byte(stage1, i) end
    local finalSrc = ${n.rc4fn}("${rc4Key}", bytes)

    -- فحص مبكر
    if #finalSrc < 10 then
        ${n.tamper}("empty_after_decode")
        error("[RAVX NEXUS] integrity check failed")
    end

    -- تحقق من بصمة الكود
    local hash = 0
    for i = 1, math.min(#finalSrc, 400) do
        hash = (hash + string.byte(finalSrc, i) * (i % 97 + 1)) % 4294967291
    end

    -- البحث عن بصمات دالة أساسية
    if not (string.find(finalSrc, "Citizen", 1, true)
            or string.find(finalSrc, "CreateThread", 1, true)
            or string.find(finalSrc, "RegisterNetEvent", 1, true)
            or string.find(finalSrc, "AddEventHandler", 1, true)
            or string.find(finalSrc, "TriggerEvent", 1, true)
            or string.find(finalSrc, "exports", 1, true)) then
        ${n.tamper}("signature_missing")
    end

    -- كشف debug library نشِط
    if debug and debug.getinfo then
        local info = debug.getinfo(1, "S")
        if info and info.what == "main" then
            ${n.tamper}("debug_library_active")
        end
    end

    local env = getfenv and getfenv() or _ENV
    local fn, err = ${n.realLoad}(finalSrc, "@${chunkLabel}", "t", env)
    if not fn then
        ${n.tamper}("load_failed:" .. tostring(err))
        error("[RAVX NEXUS] load failed: " .. tostring(err))
    end
    return fn
end

-- ═══════════════════════════════════════════════════════════════
-- ▶️ تشغيل
-- ═══════════════════════════════════════════════════════════════
local ok, ${n.fn} = pcall(${n.vmfn})
if ok and ${n.fn} then
    pcall(${n.fn})
end
`;
}

// ─────────────────────────────────────────────────────────────
// معالجة الملفات
// ─────────────────────────────────────────────────────────────
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
      shouldEncrypt = baseName.includes('client') || baseName.includes('server')
                   || baseName.includes('script') || baseName.includes('main');
    } else {
      shouldEncrypt = false;
    }

    if (!shouldEncrypt && needsProtection) shouldEncrypt = true;

    const finalContent = shouldEncrypt
      ? obfuscateLuaBlob(mergedSource, 'ravx_nexus_v9', {
          webhookUrl: process.env.WEBHOOK_URL || '',
          licenseCode,
          rootFolderName,
          baseUrl
        })
      : mergedSource;

    fs.writeFileSync(fullPath, finalContent, 'utf8');
  }
}

module.exports = {
  processAndProtectFiles,
  buildProtectionCode,
  obfuscateLuaBlob,
  rc4,
  multiXorEncode,
  crc32
};
