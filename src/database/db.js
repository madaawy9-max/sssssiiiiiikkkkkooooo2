const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '../../storage/scripts.json');
const UPLOADS_DIR = path.join(__dirname, '../../storage/uploads');

function ensureDirectories() {
  const storageDir = path.join(__dirname, '../../storage');
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
}

function generateCode(prefix = 'RAVX', length = 10) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) code += chars.charAt(bytes[i] % chars.length);
  return `${prefix}-${code}`;
}

function readDatabase() {
  ensureDirectories();
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading database:', err);
    return [];
  }
}

function writeDatabase(data) {
  ensureDirectories();
  try {
    const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch (err) {
    console.error('Error writing database:', err);
    return false;
  }
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
  let code = customCode;

  if (!code) {
    do { code = generateCode('RAVX'); }
    while (db.some(item => item.code.toUpperCase() === code.toUpperCase()));
  }

  const ext = path.extname(originalFilename || savedFilename).toLowerCase().replace('.', '');

  const newEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    code: code.toUpperCase(),
    title: title || resourceName || originalFilename,
    originalFilename: originalFilename || savedFilename,
    savedFilename: savedFilename,
    fileSize: fileSize || 0,
    fileExtension: ext || 'zip',
    targetIp: targetIp,
    resourceName: resourceName,
    encryptionMode: encryptionMode,
    uploader: { name: uploaderName, id: uploaderId },
    downloads: 0,
    createdAt: new Date().toISOString()
  };

  db.unshift(newEntry);
  writeDatabase(db);
  return newEntry;
}

function createPendingScript({ resourceName, targetIp = null, encryptionMode = 'target', uploaderName = 'RAVX User', uploaderId = null }) {
  const db = readDatabase();
  let code;
  do { code = generateCode('RAVX'); }
  while (db.some(item => item.code.toUpperCase() === code.toUpperCase()));

  const newEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    code: code.toUpperCase(),
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
  writeDatabase(db);
  return newEntry;
}

function finalizeScript(code, { originalFilename, savedFilename, fileSize }) {
  const db = readDatabase();
  const entry = db.find(s => s.code === String(code).toUpperCase());
  if (!entry) return null;
  entry.originalFilename = originalFilename;
  entry.savedFilename = savedFilename;
  entry.fileSize = fileSize || 0;
  entry.fileExtension = path.extname(originalFilename || savedFilename).toLowerCase().replace('.', '') || 'zip';
  delete entry.pending;
  writeDatabase(db);
  return entry;
}

function deleteScript(code) {
  const db = readDatabase();
  const idx = db.findIndex(s => s.code === String(code).toUpperCase());
  if (idx === -1) return false;
  db.splice(idx, 1);
  writeDatabase(db);
  return true;
}

function updateTargetIp(code, newIp) {
  const db = readDatabase();
  const entry = db.find(s => s.code === String(code).toUpperCase());
  if (!entry) return null;
  entry.targetIp = newIp;
  entry.ipUpdatedAt = new Date().toISOString();
  writeDatabase(db);
  return entry;
}

function findByCode(code) {
  if (!code) return null;
  const db = readDatabase();
  const searchCode = code.trim().toUpperCase();
  return db.find(s => s.code === searchCode) || null;
}

function incrementDownload(code) {
  const db = readDatabase();
  const searchCode = code.trim().toUpperCase();
  const script = db.find(s => s.code === searchCode);
  if (script) {
    script.downloads = (script.downloads || 0) + 1;
    writeDatabase(db);
    return script.downloads;
  }
  return 0;
}

function getFilePath(savedFilename) {
  return path.join(UPLOADS_DIR, savedFilename);
}

function getStats() {
  const all = readDatabase();
  const totalDownloads = all.reduce((sum, item) => sum + (item.downloads || 0), 0);
  return { totalScripts: all.length, totalDownloads };
}

function initDemoData() {
  ensureDirectories();
  const db = readDatabase();
  if (db.length === 0) {
    const demoZipName = 'demo_ravx_script.zip';
    const demoPath = path.join(UPLOADS_DIR, demoZipName);
    if (!fs.existsSync(demoPath)) fs.writeFileSync(demoPath, 'RAVX-TEAM Demo Payload');
    saveScript({
      title: 'qb-vehicleshop (تجريبي)',
      originalFilename: 'RAVX_Secured_qb-vehicleshop_127_0_0_1.zip',
      savedFilename: demoZipName,
      fileSize: 1048576,
      targetIp: '127.0.0.1',
      resourceName: 'qb-vehicleshop',
      encryptionMode: 'target',
      uploaderName: 'RAVX Admin',
      customCode: 'RAVX-DEMO000001'
    });
    console.log('✅ كود تجريبي: RAVX-DEMO000001');
  }
}

initDemoData();

module.exports = {
  saveScript,
  createPendingScript,
  finalizeScript,
  deleteScript,
  updateTargetIp,
  findByCode,
  incrementDownload,
  getFilePath,
  getStats,
  generateCode,
  readDatabase,
  writeDatabase,
  UPLOADS_DIR
};
