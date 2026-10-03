const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('../shared/storage');

const DB_FILE = storage.file('scripts.json', { legacyRoot: false });
const DB_BACKUP_FILE = `${DB_FILE}.bak`;
const UPLOADS_DIR = storage.dir('uploads');

function ensureDirectories() {
  storage.ensureStorage();
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeDatabase([]);
}

function generateCode(prefix = 'RAVX', length = 10) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < length; i++) code += chars[crypto.randomInt(0, chars.length)];
  return `${prefix}-${code}`;
}

function parseDbFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function readDatabase() {
  ensureDirectories();
  try {
    return parseDbFile(DB_FILE);
  } catch (err) {
    console.error('[RAVX DB] scripts.json read failed, trying backup:', err.message);
    try {
      const recovered = parseDbFile(DB_BACKUP_FILE);
      writeDatabase(recovered);
      return recovered;
    } catch (_) {
      return [];
    }
  }
}

function writeDatabase(data) {
  storage.ensureStorage();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    if (fs.existsSync(DB_FILE)) {
      try { fs.copyFileSync(DB_FILE, DB_BACKUP_FILE); } catch (_) {}
    }
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    console.error('[RAVX DB] write failed:', err);
    return false;
  }
}

function uniqueCode(db, customCode = null) {
  if (customCode) return String(customCode).trim().toUpperCase();
  let code;
  do { code = generateCode('RAVX'); }
  while (db.some(item => String(item.code || '').toUpperCase() === code.toUpperCase()));
  return code;
}

function saveScript({
  title,
  originalFilename,
  savedFilename,
  fileSize,
  targetIp = null,
  resourceName = null,
  encryptionMode = 'target',
  uploaderName = 'RAVX User',
  uploaderId = null,
  customCode = null
}) {
  const db = readDatabase();
  const code = uniqueCode(db, customCode);
  const ext = path.extname(originalFilename || savedFilename || '').toLowerCase().replace('.', '');
  const newEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    code,
    title: title || resourceName || originalFilename,
    originalFilename: originalFilename || savedFilename,
    savedFilename,
    fileSize: fileSize || 0,
    fileExtension: ext || 'zip',
    targetIp,
    resourceName,
    encryptionMode,
    uploader: { name: uploaderName, id: uploaderId },
    downloads: 0,
    createdAt: new Date().toISOString()
  };
  db.unshift(newEntry);
  if (!writeDatabase(db)) throw new Error('فشل حفظ سجل السكربت في قاعدة البيانات');
  return newEntry;
}

function createPendingScript({ resourceName, targetIp = null, encryptionMode = 'target', uploaderName = 'RAVX User', uploaderId = null }) {
  const db = readDatabase();
  const code = uniqueCode(db);
  const newEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    code,
    title: resourceName,
    originalFilename: null,
    savedFilename: null,
    fileSize: 0,
    fileExtension: 'zip',
    targetIp,
    resourceName,
    encryptionMode,
    uploader: { name: uploaderName, id: uploaderId },
    downloads: 0,
    createdAt: new Date().toISOString(),
    pending: true
  };
  db.unshift(newEntry);
  if (!writeDatabase(db)) throw new Error('فشل حجز كود الترخيص');
  return newEntry;
}

function finalizeScript(code, { originalFilename, savedFilename, fileSize }) {
  const db = readDatabase();
  const entry = db.find(s => s.code === String(code).toUpperCase());
  if (!entry) return null;
  entry.originalFilename = originalFilename;
  entry.savedFilename = savedFilename;
  entry.fileSize = fileSize || 0;
  entry.fileExtension = path.extname(originalFilename || savedFilename || '').toLowerCase().replace('.', '') || 'zip';
  entry.finalizedAt = new Date().toISOString();
  delete entry.pending;
  if (!writeDatabase(db)) throw new Error('فشل إكمال سجل السكربت');
  return entry;
}

function deleteScript(code, options = {}) {
  const db = readDatabase();
  const searchCode = String(code || '').trim().toUpperCase();
  const idx = db.findIndex(s => s.code === searchCode);
  if (idx === -1) return false;
  const [entry] = db.splice(idx, 1);
  if (!writeDatabase(db)) throw new Error('فشل حذف سجل السكربت');
  if (options.deleteFile && entry.savedFilename) {
    try {
      const fp = getFilePath(entry.savedFilename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (e) {
      console.error('[RAVX DB] failed to delete archive:', e.message);
    }
  }
  return entry;
}

function updateTargetIp(code, newIp) {
  const db = readDatabase();
  const entry = db.find(s => s.code === String(code || '').trim().toUpperCase());
  if (!entry) return null;
  entry.targetIp = newIp;
  entry.ipUpdatedAt = new Date().toISOString();
  if (!writeDatabase(db)) throw new Error('فشل حفظ الآي بي الجديد');
  return entry;
}

function findByCode(code) {
  if (!code) return null;
  const searchCode = String(code).trim().toUpperCase();
  return readDatabase().find(s => s.code === searchCode) || null;
}

function listScripts({ limit = 500, includePending = false } = {}) {
  const n = Math.max(1, Math.min(Number(limit) || 500, 5000));
  return readDatabase().filter(s => includePending || !s.pending).slice(0, n);
}

function incrementDownload(code) {
  const db = readDatabase();
  const searchCode = String(code || '').trim().toUpperCase();
  const script = db.find(s => s.code === searchCode);
  if (!script) return 0;
  script.downloads = (script.downloads || 0) + 1;
  writeDatabase(db);
  return script.downloads;
}

function getFilePath(savedFilename) {
  const safe = path.basename(String(savedFilename || ''));
  return path.join(UPLOADS_DIR, safe);
}

function getStats() {
  const all = readDatabase().filter(s => !s.pending);
  return {
    totalScripts: all.length,
    totalDownloads: all.reduce((sum, item) => sum + (item.downloads || 0), 0)
  };
}

function initDemoData() {
  ensureDirectories();
  const db = readDatabase();
  if (db.length !== 0) return;
  const demoZipName = 'demo_ravx_script.zip';
  const demoPath = path.join(UPLOADS_DIR, demoZipName);
  if (!fs.existsSync(demoPath)) fs.writeFileSync(demoPath, 'RAVX-TEAM Demo Protected Script Payload');
  saveScript({
    title: 'qb-vehicleshop (تجريبي)',
    originalFilename: 'RAVX_Secured_qb-vehicleshop_127_0_0_1.zip',
    savedFilename: demoZipName,
    fileSize: fs.statSync(demoPath).size,
    targetIp: '127.0.0.1',
    resourceName: 'qb-vehicleshop',
    encryptionMode: 'target',
    uploaderName: 'RAVX Admin',
    customCode: 'RAVX-DEMO000001'
  });
  console.log('✅ تم إنشاء كود تجريبي: RAVX-DEMO000001');
}

initDemoData();

module.exports = {
  saveScript,
  createPendingScript,
  finalizeScript,
  deleteScript,
  updateTargetIp,
  findByCode,
  listScripts,
  incrementDownload,
  getFilePath,
  getStats,
  generateCode,
  readDatabase,
  writeDatabase,
  DB_FILE,
  UPLOADS_DIR
};
