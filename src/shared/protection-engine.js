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

// 🛡️ يبني كود فحص الترخيص/الآي بي كنص Lua صريح — يُدمج لاحقاً مع كود المطوّر
// نفسه ثم يُموَّه الاثنان معاً ككتلة واحدة (نفس نص الديسكورد بالحرف).
function buildProtectionCode(targetIp, rootFolderName) {
    const webhookUrl = process.env.WEBHOOK_URL || '';
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

    print("^5[RAVX SECURITY]^7 Initializing license & IP verification...")
    local AllowedIP = "${targetIp}"
    local WebhookURL = "${webhookUrl}"
    local authorized = false
    local checked = false

    PerformHttpRequest("https://api.ipify.org", function(err, text, headers)
        if err == 200 and text then
            local currentIP = text:gsub("%s+", "")
            if currentIP == AllowedIP then
                authorized = true
                print("^5╔══════════════════════════════════════════════════════════╗^7")
                print("^5║^7        ^2RAVX NEXUS SECURITY — LICENSE VERIFIED^7             ^5║^7")
                print("^5╠══════════════════════════════════════════════════════════╣^7")
                print("^5║^7  STATUS       : ^2AUTHORIZED^7                                 ^5║^7")
                print("^5║^7  RESOURCE     : ^3" .. currentResourceName .. "^7")
                print("^5║^7  IP ADDRESS   : ^3" .. currentIP .. "^7")
                print("^5║^7  ENGINE       : ^2ACTIVE & PROTECTED^7                          ^5║^7")
                print("^5╚══════════════════════════════════════════════════════════╝^7")

                if WebhookURL ~= "" then
                    PerformHttpRequest(WebhookURL, function() end, "POST", json.encode({
                        username = "RAVX Security System",
                        embeds = {{
                            title = "✅ تم تشغيل السكريبت بنجاح",
                            color = 65280,
                            fields = {
                                { name = "🌐 الآي بي المرخص:", value = "\`" .. currentIP .. "\`", inline = true },
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
                print("^1║^7  LICENSED IP  : ^3" .. AllowedIP .. "^7")
                print("^1╚══════════════════════════════════════════════════════════╝^7")

                if WebhookURL ~= "" then
                    PerformHttpRequest(WebhookURL, function() end, "POST", json.encode({
                        username = "RAVX Security System",
                        embeds = {{
                            title = "🚨 محاولة تشغيل سكريبت على سيرفر غير مرخص!",
                            color = 16711680,
                            fields = {
                                { name = "🌐 الآي بي المحاول:", value = "\`" .. currentIP .. "\`", inline = true },
                                { name = "🎯 الآي بي المرخص:", value = "\`" .. AllowedIP .. "\`", inline = true },
                                { name = "📂 السكريبت:", value = "\`" .. currentResourceName .. "\`", inline = false }
                            },
                            footer = { text = "RAVX TEAM Security Protection" }
                        }}
                    }), { ["Content-Type"] = "application/json" })
                end
            end
        else
            print("^1[RAVX SECURITY]^7 IP lookup request failed (api.ipify.org unreachable) — license cannot be verified.^7")
        end
        checked = true
    end, "GET", "")

    local timeoutCount = 0
    while not checked and timeoutCount < 80 do
        timeoutCount = timeoutCount + 1
        Citizen.Wait(100)
    end

    if not checked then
        print("^1[RAVX SECURITY]^7 ⏰ Timed out waiting for IP verification service — check the server's internet connection.^7")
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
function processAndProtectFiles(dirPath, targetIp, rootFolderName, encryptionMode) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            processAndProtectFiles(fullPath, targetIp, rootFolderName, encryptionMode);
            continue;
        }

        const extName = path.extname(entry.name).toLowerCase();
        if (extName !== '.lua') continue;

        const baseName = path.basename(entry.name, extName).toLowerCase();
        const originalContent = fs.readFileSync(fullPath, 'utf8');

        const needsProtection = baseName.includes('server') || baseName.includes('main');
        const protectionCode = needsProtection ? buildProtectionCode(targetIp, rootFolderName) : '';

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

module.exports = { processAndProtectFiles, buildProtectionCode, obfuscateLuaBlob };
