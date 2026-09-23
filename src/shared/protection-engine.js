/* ============================================================================
 * RAVX — محرك الحماية والتشفير المشترك (مصدر الحقيقة الوحيد)
 * ============================================================================
 * قبل هذا الملف كان عندنا محركان مختلفان تماماً:
 *
 *   - الديسكورد (index.js → processAndProtectFiles/buildProtectionCode):
 *     يدمج كود فحص الآي بي *داخل* ملفات server/main نفسها قبل التمويه، فيصير
 *     فحص الترخيص وكود المطوّر كتلة واحدة غير قابلة للفصل بعد XOR.
 *
 *   - الموقع (src/engine/bot-engine.js → buildIpGuard/installIpGuard):
 *     كان يكتب فحص الآي بي في ملف *منفصل* (ravx_license.lua) ويضيف سطر
 *     server_script في fxmanifest — بحماية أضعف بكثير: يكفي حذف ذلك السطر أو
 *     الملف نفسه من الأرشيف عشان يشتغل السكربت بدون أي قفل آي بي إطلاقاً.
 *     هذا بالضبط سبب أن "التشفير من الموقع ما يقفل الآي بي زي الديسكورد".
 *
 * الآن الاثنان يستدعيان نفس الدالة بالضبط، فالنتيجة متطابقة 100% بغض النظر
 * عن مصدر الطلب.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 🛡️ يبني كود فحص الترخيص كنص Lua صريح — يُدمج لاحقاً مع كود المطوّر نفسه
// ثم يُموَّه الاثنان معاً ككتلة واحدة (نفس نص الديسكورد بالحرف).
//
// 🌐 فحص آي بي "حيّ": قديماً كان الآي بي المسموح مدموجاً كنص ثابت داخل الملف
// نفسه، فتغييره يتطلب إعادة تشفير وإرسال ملف جديد للعميل. الآن الملف لا يحمل
// أي آي بي بداخله إطلاقاً — يحمل فقط "كود الترخيص" (نفس كود التحميل بالموقع)
// ويسأل خادمنا وقت تشغيل السيرفر: "هل الآي بي اللي أنا شغّال عليه الآن مسموح
// لهذا الكود؟" (عبر GET إلى ${baseUrl}/api/license/الكود، والخادم يقرأ آي بي
// الطالب مباشرة من الطلب نفسه ويقارنه بالآي بي المخزَّن حالياً لهذا الكود).
// النتيجة: غيّر الآي بي المسموح من لوحة الأدمن بالموقع، وبنفس اللحظة (أول
// مرة يعيد فيها العميل تشغيل موردته، أو خلال دقائق لو أضفت فحصاً دورياً)
// يتحدّث الترخيص تلقائياً بدون إرسال أي ملف جديد للعميل.
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

    -- نحدّد عنواننا العام على بروتوكول IPv4 تحديداً أولاً — api4.ipify.org له
    -- سجل DNS من نوع A فقط بلا AAAA، فأي اتصال به يُجبر على استخدام IPv4 مهما
    -- كانت تفضيلات شبكة مزوّد الاستضافة (بعضهم يفضّل IPv6 بالاتصالات الصادرة
    -- افتراضياً)، فترجع لك دائماً نفس عنوان IPv4 المعروف والمسجَّل لسيرفرك.
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

// 🛡️ يُخفي كود فحص الترخيص + كود المطوّر معاً بتشفير XOR عشوائي (مفتاح مختلف بكل
// ملف) بحيث يصيرون كتلة واحدة غير قابلة للفصل — محد يقدر يحذف فحص الآي بي
// بمفرده من الملف بعد التمويه. نفس المحرك بالحرف المستخدم بالديسكورد.
function obfuscateLuaBlob(sourceCode, chunkLabel) {
    const xk1 = crypto.randomInt(30, 230);
    const xk2 = crypto.randomInt(30, 230);
    const xmul = [3, 5, 7, 9, 11, 13][crypto.randomInt(0, 6)];

    const uid = () => '_0x' + crypto.randomBytes(4).toString('hex');
    const vPayload = uid();
    const vDecoder = uid();
    const vOut     = uid();
    const vIdx     = uid();
    const vByte     = uid();
    const vLen      = uid();
    const vEnv      = uid();
    const vFunc     = uid();

    const sourceBytes = Buffer.from(sourceCode, 'utf8');
    const xorEncoded = [];
    for (let i = 0; i < sourceBytes.length; i++) {
        let c = sourceBytes[i] ^ xk1;
        c = (c + (i * xmul % 23)) % 256;
        c = c ^ ((xk2 + (i % 17)) % 256);
        xorEncoded.push(c);
    }

    const chunkRows = [];
    const chunkSize = 60;
    for (let i = 0; i < xorEncoded.length; i += chunkSize) {
        chunkRows.push(xorEncoded.slice(i, i + chunkSize).join(','));
    }
    const luaTable = chunkRows.join(',\n    ');

    return `-- [RAVX-TEAM] Protected Resource — license check and script logic are merged and obfuscated as one unit.
-- WARNING: Removing or modifying any part of this block will break the entire resource.
local ${vPayload} = {
    ${luaTable}
}

local function ${vDecoder}(${vOut})
    local ${vIdx} = {}
    local ${vLen} = #${vOut}
    for _i = 1, ${vLen} do
        local ${vByte} = ${vOut}[_i]
        local i = _i - 1
        local _r3 = ${vByte} ~ ((${xk2} + (i % 17)) % 256)
        local _r2 = (_r3 - (i * ${xmul} % 23)) % 256
        ${vIdx}[_i] = string.char(_r2 ~ ${xk1})
    end
    return table.concat(${vIdx})
end

local ${vEnv} = getfenv and getfenv() or _ENV
local ${vFunc}, _0xerr = (loadstring or load)(${vDecoder}(${vPayload}), "@${chunkLabel}", "t", ${vEnv})
if not ${vFunc} then
    error("[RAVX SECURITY] Resource integrity check failed — file has been tampered with: " .. tostring(_0xerr))
end
${vFunc}()
`;
}

// يمشي على كل ملفات .lua بالمورد ويطبّق الحماية بنفس القواعد بالضبط سواء جاء
// الطلب من الديسكورد أو من الموقع:
// - ملفات server/main: يُدمج فحص الآي بي داخلها إجبارياً ثم تُموَّه دائماً،
//   حتى لو اختار المستخدم نمط "بدون تشفير" — لأن حذف الفحص لوحده يجب أن
//   يكون مستحيلاً بمجرد أنه مدموج مع كود المطوّر بكتلة XOR واحدة.
// - باقي ملفات .lua: تتبع اختيار النمط (target/full/none) بدون أي حماية آي بي.
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

        // ندمج كود الحماية مع كود المطوّر بنص واحد قبل أي تمويه — عشان يصيرون
        // كتلة واحدة ما ينفصلون عن بعض بعد التشفير.
        const mergedSource = protectionCode ? (protectionCode + '\n' + originalContent) : originalContent;

        let shouldEncrypt;
        if (encryptionMode === 'full') {
            shouldEncrypt = true;
        } else if (encryptionMode === 'target') {
            shouldEncrypt = baseName.includes('client') || baseName.includes('server') || baseName.includes('script') || baseName.includes('main');
        } else {
            shouldEncrypt = false; // 'none'
        }

        // 🔒 حتى لو اختار المستخدم "بدون تشفير"، لو الملف فيه فحص الآي بي (server/main)
        // نفرض التمويه إجبارياً — عشان محد يقدر يحذف فحص الترخيص لوحده من الملف.
        if (!shouldEncrypt && needsProtection) shouldEncrypt = true;

        const finalContent = shouldEncrypt ? obfuscateLuaBlob(mergedSource, 'ravx_protected') : mergedSource;
        fs.writeFileSync(fullPath, finalContent, 'utf8');
    }
}

/* ============================================================================
 * 🔓 فك الحماية (Unprotect) — عكس obfuscateLuaBlob تماماً
 * ============================================================================
 * التمويه أعلاه ليس تشفيراً حقيقياً بمفتاح سرّي خارجي؛ المفاتيح (xk1, xk2,
 * xmul) تُولَّد عشوائياً لكل ملف لكنها تُكتب كأرقام صريحة داخل نص فك الشيفرة
 * (${vDecoder}) نفسه، لأن ملف Lua يحتاج يقدر يفك نفسه وقت التشغيل. لذلك نفس
 * القيم موجودة حرفياً في الملف الناتج، ويكفي قراءتها منه لعكس العملية بالضبط
 * بنفس الخطوات (بترتيب معاكس) اللي تنفّذها دالة ${vDecoder} في Lua.
 *
 * هذا يسمح لصاحب الأداة (نفس الجهة اللي شفّرت الملف) بإرجاع أي ملف .lua —
 * حتى القديم المشفَّر من نسخ سابقة تستخدم نفس القالب — إلى نص مقروء وقابل
 * للتعديل، ثم إعادة تشفيره من جديد عبر processAndProtectFiles بعد التعديل.
 * ========================================================================== */

// نفس بصمة رأس الحماية المدمج داخل ملفات server/main (انظر buildProtectionCode)
// تُستخدم لإزالته بعد فك التمويه حتى يرجع الملف لكود المطوّر الأصلي فقط —
// وإلا لو أُعيد تشفيره لاحقاً سيتكرر داخل نفس الملف مرتين.
const GUARD_BLOCK_RE = /\n-{5,}\n-- \[🛡️ RAVX-TEAM SERVER SECURITY & IP CHECK\] --\n-{5,}\nCitizen\.CreateThread\(function\(\)[\s\S]*?\nend\)\n-{5,}\n/;

function isProtectedLua(content) {
  return typeof content === 'string'
    && content.includes('[RAVX-TEAM] Protected Resource')
    && /local _0x[0-9a-f]{8} = \{/.test(content);
}

// يستخرج جدول البايتات المموَّهة + المفاتيح الثلاثة (مكتوبة كأرقام صريحة داخل
// دالة فك الشيفرة نفسها) ثم يطبّق نفس خطوات ${vDecoder} بترتيبها بالضبط.
function unprotectLuaBlob(content) {
  if (!isProtectedLua(content)) return null;

  const tableMatch = content.match(/local _0x[0-9a-f]{8} = \{([\s\S]*?)\n\}/);
  const xk2Match = content.match(/~ \(\((\d+) \+ \(i % 17\)\) % 256\)/);
  const xmulMatch = content.match(/\(_r3 - \(i \* (\d+) % 23\)\) % 256/);
  const xk1Match = content.match(/string\.char\(_r2 ~ (\d+)\)/);
  if (!tableMatch || !xk2Match || !xmulMatch || !xk1Match) return null;

  const bytes = tableMatch[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number);
  const xk2 = Number(xk2Match[1]);
  const xmul = Number(xmulMatch[1]);
  const xk1 = Number(xk1Match[1]);

  const mod256 = n => ((n % 256) + 256) % 256;
  const decoded = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const r3 = bytes[i] ^ mod256((xk2 + (i % 17)) % 256);
    const r2 = mod256(r3 - (i * xmul % 23));
    decoded[i] = r2 ^ xk1;
  }
  return decoded.toString('utf8');
}

// يزيل كتلة فحص الآي بي المدمجة (إن وُجدت) بعد فك التمويه، فيرجع الملف لكود
// المطوّر الأصلي وحده — جاهز للتعديل وإعادة التشفير من جديد بدون تكرار الحارس.
function stripEmbeddedGuard(mergedSource) {
  if (!GUARD_BLOCK_RE.test(mergedSource)) return mergedSource;
  return mergedSource.replace(GUARD_BLOCK_RE, '').replace(/^\n+/, '');
}

// يمشي على كل ملفات .lua بمورد مشفَّر سابقاً ويعيدها نصاً مقروءاً للتعديل.
// - الملفات المموَّهة: تُفك ثم يُزال منها حارس الآي بي المدمج إن وُجد.
// - الملفات غير المموَّهة أصلاً: تُترك كما هي (ما فيها شيء نعكسه).
// يرجع تقرير بعدد الملفات التي تم فكها فعلياً لعرضه للمستخدم/تسجيله باللوق.
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
      if (decoded === null) continue; // ملف غير مموَّه أصلاً، لا شيء لفكه
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
