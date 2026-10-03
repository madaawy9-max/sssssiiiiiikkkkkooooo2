'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const protection = require('./protection-engine');

const execFileAsync = promisify(execFile);
const MAX_SCRIPT_BYTES = 50 * 1024 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolveHerculesScript() {
  const root = path.resolve(process.env.HERCULES_ROOT || path.join(PROJECT_ROOT, 'vendor/hercules'));
  const candidates = [
    path.join(root, 'src', 'hercules.lua'),
    path.join(root, 'hercules.lua')
  ];
  const script = candidates.find(file => fs.existsSync(file));
  if (!script) {
    throw new Error('ملفات Hercules غير موجودة. ضع مستودع Hercules داخل vendor/hercules أو عيّن HERCULES_ROOT لمساره.');
  }
  return script;
}

function selectedPreset() {
  const preset = String(process.env.HERCULES_PRESET || 'maximum').trim().toLowerCase();
  if (!['light', 'balanced', 'heavy', 'maximum'].includes(preset)) {
    throw new Error('HERCULES_PRESET يجب أن يكون light أو balanced أو heavy أو maximum.');
  }
  return preset;
}

function outputPathFor(inputPath) {
  return inputPath.replace(/\.lua$/i, '_obfuscated.lua');
}

async function obfuscateLua(source, relativeName) {
  const scriptPath = resolveHerculesScript();
  const luaBin = String(process.env.LUA_BIN || 'lua5.4').trim();
  const preset = selectedPreset();
  const sourceBytes = Buffer.from(String(source), 'utf8');
  if (sourceBytes.length > MAX_SCRIPT_BYTES) {
    throw new Error(`ملف Lua أكبر من الحد البالغ 50MB: ${relativeName}`);
  }

  // Hercules resolves/handles input files relative to its own source tree on
  // some builds. Keep the temporary input under src/ instead of /tmp.
  const tempDir = fs.mkdtempSync(path.join(path.dirname(scriptPath), '.ravx-hercules-'));
  const safeBase = path.basename(relativeName || 'resource.lua').replace(/[^A-Za-z0-9_.-]/g, '_');
  const inputPath = path.join(tempDir, safeBase.toLowerCase().endsWith('.lua') ? safeBase : `${safeBase}.lua`);
  const outputPath = outputPathFor(inputPath);
  fs.writeFileSync(inputPath, sourceBytes);

  try {
    await execFileAsync(luaBin, [scriptPath, inputPath, '--target', 'lua', `--${preset}`], {
      cwd: path.dirname(scriptPath),
      timeout: 190000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true
    });
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Hercules لم ينشئ الملف المتوقع: ${path.basename(outputPath)}`);
    }
    const protectedSource = fs.readFileSync(outputPath, 'utf8');
    if (!protectedSource.trim()) throw new Error('Hercules أعاد ملف Lua فارغاً.');
    return protectedSource;
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message,
      error.code ? `exit=${error.code}` : '', error.signal ? `signal=${error.signal}` : '']
      .filter(Boolean).join('\n').trim();
    if (/spawn .*ENOENT|not found|is not recognized/i.test(detail)) {
      throw new Error(`لم يتم العثور على Lua 5.4 (${luaBin}). ثبّت Lua 5.4 أو اضبط LUA_BIN لمسار lua.`);
    }
    throw new Error(`فشل Hercules في معالجة ${relativeName}: ${detail.slice(0, 1800)}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function walkLuaFiles(root) {
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lua') &&
        !['fxmanifest.lua', '__resource.lua'].includes(entry.name.toLowerCase())) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function isTargetLua(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normalized);
  return /(^|[-_.])(client|server|main)([-_.]|$)/.test(base) || protection.isServerLua(normalized);
}

function ensureFiveMLua54(root) {
  const manifest = ['fxmanifest.lua', '__resource.lua']
    .map(name => path.join(root, name)).find(file => fs.existsSync(file));
  if (!manifest) return false;
  const source = fs.readFileSync(manifest, 'utf8');
  if (/^\s*lua54\s+/im.test(source)) return false;
  fs.writeFileSync(manifest, `${source.replace(/\s*$/, '')}\n\nlua54 'yes'\n`, 'utf8');
  return true;
}

async function processAndProtectFiles(resourceRoot, licenseCode, resourceName, encryptionMode = 'target', baseUrl) {
  const root = path.resolve(resourceRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Resource folder not found');
  const mode = ['target', 'full', 'none'].includes(encryptionMode) ? encryptionMode : 'target';
  const files = walkLuaFiles(root);
  const serverFiles = files.filter(protection.isServerLua);
  if (!serverFiles.length) throw new Error('لم أجد ملف Lua للخادم (server/main) لإضافة فحص الترخيص.');

  for (const file of serverFiles) {
    const source = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, protection.buildProtectionCode(licenseCode, resourceName, baseUrl, source), 'utf8');
  }

  if (mode === 'none') {
    return { processed: serverFiles.length, serverFiles: serverFiles.length, mode, provider: 'license-only' };
  }

  const selected = mode === 'full' ? files : files.filter(isTargetLua);
  if (!selected.some(protection.isServerLua)) throw new Error('لم أجد ملف server/main ضمن ملفات Lua المحددة.');

  for (const file of selected) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const input = fs.readFileSync(file, 'utf8');
    const output = await obfuscateLua(input, relative);
    fs.writeFileSync(file, output, 'utf8');
  }

  const manifestUpdated = ensureFiveMLua54(root);
  return { processed: selected.length, serverFiles: serverFiles.length, mode, provider: 'hercules', manifestUpdated };
}

module.exports = { processAndProtectFiles, obfuscateLua, selectedPreset, resolveHerculesScript };
