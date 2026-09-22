const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { ZipArchive } = require('archiver');
let db;
try {
  db = require('../database/db');
} catch (_) {
  db = require(path.join(process.cwd(), 'src/database/db'));
}
// 🛡️ نفس محرك الحماية المستخدم بالضبط في بوت الديسكورد (index.js).
// كان الموقع يستعمل محركاً منفصلاً وأضعف: فحص الآي بي في ملف Lua منفصل
// (ravx_license.lua) يكفي حذفه أو حذف سطره من fxmanifest ليعمل السكربت بدون
// أي قفل. الآن الاثنان يدمجان فحص الآي بي داخل ملفات server/main نفسها قبل
// التمويه، فتشفير الموقع مطابق تماماً لتشفير الديسكورد.
const protectionEngine = require('../shared/protection-engine');
const logger = require('../shared/logger');
const execFileAsync = promisify(execFile);

function createZipFromDirectory(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 0 } });
    let done = false;
    const fail = error => { if (!done) { done = true; reject(error); } };
    output.on('close', () => { if (!done) { done = true; resolve(); } });
    output.on('error', fail);
    archive.on('error', fail);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize().catch(fail);
  });
}

async function notifyDiscord({ channelId, botToken, script, uploader }) {
  if (!channelId || !botToken) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `✅ تم تشفير المورد بنجاح\n📦 المورد: \`${script.resourceName}\`\n🌐 IP: \`${script.targetIp}\`\n🔐 النمط: \`${script.encryptionMode}\`\n🔑 كود التحميل: \`${script.code}\`` })
    });
  } catch (error) { console.error('[WEB] Discord notification failed:', error.message); }
}

async function encryptResource({ inputZipPath, targetIp, resourceName, encryptionMode = 'target', uploader = {}, panelChannelId = process.env.PANEL_CHANNEL_ID, botToken = process.env.DISCORD_BOT_TOKEN }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-engine-'));
  const extracted = path.join(work, 'resource');
  const outputName = `RAVX_Secured_${resourceName}_${String(targetIp).replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
  const outputPath = db.getFilePath(outputName);
  try {
    fs.mkdirSync(extracted, { recursive: true });
    await execFileAsync('unzip', ['-q', '-o', inputZipPath, '-d', extracted], { maxBuffer: 1024 * 1024 });
    let processRoot = extracted;
    const children = fs.readdirSync(extracted, { withFileTypes: true });
    if (children.length === 1 && children[0].isDirectory()) processRoot = path.join(extracted, children[0].name);

    // نفس الدالة، نفس السلوك بالحرف، سواء التشفير جاء من الموقع أو من الديسكورد.
    protectionEngine.processAndProtectFiles(processRoot, targetIp, resourceName, encryptionMode);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    await createZipFromDirectory(extracted, outputPath);
    const stat = fs.statSync(outputPath);
    const script = db.saveScript({ title: resourceName, originalFilename: outputName, savedFilename: outputName, fileSize: stat.size, targetIp, resourceName, encryptionMode, uploaderName: uploader.name || 'Web User', uploaderId: uploader.id || null });
    // لا ترسل عمليات تشفير الموقع إلى روم Discord العام.
    // يبقى إشعار البوت الداخلي مستقلًا عن لوحة الموقع.
    logger.info('encrypt.success', { source: 'web', resourceName, targetIp, encryptionMode, uploaderId: uploader.id || null, code: script.code });
    return { script };
  } catch (err) {
    logger.error('encrypt.failed', err, { source: 'web', resourceName, targetIp, uploaderId: uploader.id || null });
    throw err;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 🔓 فك حماية مورد سبق تشفيره — يقبل نفس نوع الأرشيف الناتج من التشفير (أو أي
// ZIP قديم مشفَّر بنفس القالب حتى لو أُنتج بنسخة سابقة من الأداة)، يعكس التمويه
// على كل ملفات .lua المموَّهة، يزيل حارس الآي بي المدمج، ويعيد ضغط الناتج
// كملف جاهز للتعديل. يُستعمل من لوحة الأدمن على الموقع ومن سكربت CLI المستقل.
async function unprotectResource({ inputZipPath, label = 'unprotected', uploader = {} }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-unprotect-'));
  const extracted = path.join(work, 'resource');
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unprotected';
  const outputName = `RAVX_Unprotected_${safeLabel}_${Date.now()}.zip`;
  const outputPath = db.getFilePath(outputName);
  try {
    fs.mkdirSync(extracted, { recursive: true });
    await execFileAsync('unzip', ['-q', '-o', inputZipPath, '-d', extracted], { maxBuffer: 1024 * 1024 });

    const report = protectionEngine.unprotectFiles(extracted);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    await createZipFromDirectory(extracted, outputPath);
    const stat = fs.statSync(outputPath);
    const script = db.saveScript({
      title: `${safeLabel} (بدون تشفير)`,
      originalFilename: outputName,
      savedFilename: outputName,
      fileSize: stat.size,
      targetIp: null,
      resourceName: safeLabel,
      encryptionMode: 'none',
      uploaderName: uploader.name || 'Web User',
      uploaderId: uploader.id || null
    });
    logger.info('unprotect.success', { source: 'web', label: safeLabel, uploaderId: uploader.id || null, code: script.code, filesUnprotected: report.unprotected, filesScanned: report.processed });
    return { script, report };
  } catch (err) {
    logger.error('unprotect.failed', err, { source: 'web', label: safeLabel, uploaderId: uploader.id || null });
    throw err;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { encryptResource, unprotectResource };
