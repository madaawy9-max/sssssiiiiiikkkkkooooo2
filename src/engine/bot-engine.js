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
// يستخدم الموقع وبوت Discord محرك الحماية نفسه، ويُدمجان فحص الترخيص داخل
// ملفات الخادم قبل التمويه حتى يتلقى كل مسار الملفات نفسها.
const protectionEngine = require('../shared/obfuscator-engine');
const legacyProtectionEngine = require('../shared/protection-engine');
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

async function encryptResource({ inputZipPath, targetIp, resourceName, encryptionMode = 'target', uploader = {}, panelChannelId = process.env.PANEL_CHANNEL_ID, botToken = process.env.DISCORD_BOT_TOKEN, baseUrl = process.env.BASE_URL }) {
  if (!baseUrl) throw Error('BASE_URL غير مضبوط — لازم لفحص الآي بي الحيّ من الملف المشفَّر. اضبطه في متغيرات البيئة.');

  // 🔑 نحجز كود التحميل *قبل* التشفير — هذا الكود هو نفسه اللي يُدمج داخل
  // ملف Lua كمعرّف ترخيص (بدل الآي بي الخام)، فالملف يسأل خادمنا عن الآي بي
  // المسموح لهذا الكود وقت التشغيل بدل ما يحمله ثابتاً بداخله. لو فشلت
  // المعالجة نحذف هذا السجل المبدئي (finally block) حتى لا يبقى كود معلَّق.
  const pending = db.createPendingScript({ resourceName, targetIp, encryptionMode, uploaderName: uploader.name || 'Web User', uploaderId: uploader.id || null });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-engine-'));
  const extracted = path.join(work, 'resource');
  const outputName = `RAVX_Secured_${resourceName}_${pending.code}.zip`;
  const outputPath = db.getFilePath(outputName);
  const sourceBackupName = `RAVX_Source_${pending.code}.zip`;
  const sourceBackupPath = db.getFilePath(sourceBackupName);
  let finalized = false;
  try {
    fs.mkdirSync(extracted, { recursive: true });
    await execFileAsync('unzip', ['-q', '-o', inputZipPath, '-d', extracted], { maxBuffer: 1024 * 1024 });
    let processRoot = extracted;
    const children = fs.readdirSync(extracted, { withFileTypes: true });
    if (children.length === 1 && children[0].isDirectory()) processRoot = path.join(extracted, children[0].name);

    // مرّر ملفات Lua لمحرك الحماية المحلي المحدد بعد تضمين فحص الترخيص في ملفات الخادم.
    await protectionEngine.processAndProtectFiles(processRoot, pending.code, resourceName, encryptionMode, baseUrl);

    // احتفظ بالأصل في مساحة التخزين الخاصة حتى يقدر الأدمن يرجعه بالكود؛
    // ناتج التمويه لا يعيد المصدر الأصلي.
    fs.copyFileSync(inputZipPath, sourceBackupPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    await createZipFromDirectory(extracted, outputPath);
    const stat = fs.statSync(outputPath);
    const script = db.finalizeScript(pending.code, { originalFilename: outputName, savedFilename: outputName, fileSize: stat.size, sourceBackupFilename: sourceBackupName });
    finalized = true;
    // لا ترسل عمليات تشفير الموقع إلى روم Discord العام.
    // يبقى إشعار البوت الداخلي مستقلًا عن لوحة الموقع.
    logger.info('encrypt.success', { source: 'web', resourceName, targetIp, encryptionMode, uploaderId: uploader.id || null, code: script.code });
    return { script };
  } catch (err) {
    logger.error('encrypt.failed', err, { source: 'web', resourceName, targetIp, uploaderId: uploader.id || null, code: pending.code });
    throw err;
  } finally {
    if (!finalized) {
      try { db.deleteScript(pending.code); } catch (e) {}
      try { fs.rmSync(sourceBackupPath, { force: true }); } catch (e) {}
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// فك حماية الأرشيفات التي تستخدم RAVX_OBF_V1، وإزالة حارس الترخيص المدمج.
// تُرفض صيغ الحماية القديمة أو غير المدعومة عملياً برسالة في تقرير العملية.
async function unprotectResource({ inputZipPath, label = 'unprotected', uploader = {} }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-unprotect-'));
  const extracted = path.join(work, 'resource');
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unprotected';
  const outputName = `RAVX_Unprotected_${safeLabel}_${Date.now()}.zip`;
  const outputPath = db.getFilePath(outputName);
  try {
    fs.mkdirSync(extracted, { recursive: true });
    await execFileAsync('unzip', ['-q', '-o', inputZipPath, '-d', extracted], { maxBuffer: 1024 * 1024 });

    const report = legacyProtectionEngine.unprotectFiles(extracted);

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

async function restoreOriginalResource({ inputZipPath, label = 'resource', uploader = {} }) {
  if (!fs.existsSync(inputZipPath)) throw new Error('النسخة الأصلية غير موجودة على التخزين.');
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'resource';
  const outputName = `RAVX_Unprotected_${safeLabel}_${Date.now()}.zip`;
  const outputPath = db.getFilePath(outputName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(inputZipPath, outputPath);
  try {
    const stat = fs.statSync(outputPath);
    const script = db.saveScript({
      title: `${safeLabel} (المصدر الأصلي)`,
      originalFilename: outputName,
      savedFilename: outputName,
      fileSize: stat.size,
      targetIp: null,
      resourceName: safeLabel,
      encryptionMode: 'none',
      uploaderName: uploader.name || 'Web User',
      uploaderId: uploader.id || null
    });
    const report = { processed: 0, unprotected: 0, restoredOriginal: true };
    logger.info('unprotect.restore_original', { source: 'web', label: safeLabel, uploaderId: uploader.id || null, code: script.code, fileSize: stat.size });
    return { script, report };
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw error;
  }
}

module.exports = { encryptResource, unprotectResource, restoreOriginalResource };
