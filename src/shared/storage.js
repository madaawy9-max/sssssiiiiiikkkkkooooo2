const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_STORAGE_DIR = path.join(ROOT, 'storage');
const STORAGE_DIR = path.resolve(process.env.RAVX_STORAGE_DIR || DEFAULT_STORAGE_DIR);

function ensureStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function copyIfMissing(targetFile, candidates) {
  if (fs.existsSync(targetFile)) return false;
  for (const source of candidates) {
    try {
      if (source && path.resolve(source) !== path.resolve(targetFile) && fs.existsSync(source)) {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(source, targetFile);
        console.log(`[RAVX STORAGE] Migrated ${source} -> ${targetFile}`);
        return true;
      }
    } catch (e) {
      console.error('[RAVX STORAGE] Migration failed:', e.message);
    }
  }
  return false;
}

function file(name, options = {}) {
  ensureStorage();
  const target = path.join(STORAGE_DIR, name);
  const candidates = [];
  if (STORAGE_DIR !== DEFAULT_STORAGE_DIR) candidates.push(path.join(DEFAULT_STORAGE_DIR, name));
  if (options.legacyRoot !== false) candidates.push(path.join(ROOT, name));
  copyIfMissing(target, candidates);
  return target;
}

function dir(name) {
  ensureStorage();
  const target = path.join(STORAGE_DIR, name);
  const source = path.join(DEFAULT_STORAGE_DIR, name);
  try {
    if (STORAGE_DIR !== DEFAULT_STORAGE_DIR && !fs.existsSync(target) && fs.existsSync(source)) {
      fs.cpSync(source, target, { recursive: true, force: false });
      console.log(`[RAVX STORAGE] Migrated directory ${source} -> ${target}`);
    }
  } catch (e) {
    console.error('[RAVX STORAGE] Directory migration failed:', e.message);
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

module.exports = { ROOT, DEFAULT_STORAGE_DIR, STORAGE_DIR, ensureStorage, file, dir, copyIfMissing };
