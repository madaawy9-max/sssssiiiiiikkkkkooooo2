'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const protection = require('./protection-engine');

const execFileAsync = promisify(execFile);
const MAX_SCRIPT_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 12 * 60 * 1000;
const PROJECT_ROOT = path.resolve(__dirname, '../..');
let herculesQueue = Promise.resolve();

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
  const preset = String(process.env.HERCULES_PRESET || 'heavy').trim().toLowerCase();
  if (!['light', 'balanced', 'heavy', 'maximum'].includes(preset)) {
    throw new Error('HERCULES_PRESET يجب أن يكون light أو balanced أو heavy أو maximum.');
  }
  return preset;
}

function selectedTimeoutMs() {
  const raw = process.env.HERCULES_TIMEOUT_MS;
  const timeout = raw === undefined || raw === '' ? DEFAULT_TIMEOUT_MS : Number(raw);
  if (!Number.isFinite(timeout) || timeout < 30000 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`HERCULES_TIMEOUT_MS يجب أن يكون بين 30000 و${MAX_TIMEOUT_MS} مللي ثانية.`);
  }
  return timeout;
}

function runHercules(luaBin, scriptPath, inputPath, preset, timeout) {
  // Limit CPU and memory pressure when Discord and web requests overlap.
  const run = herculesQueue.then(() => execFileAsync(luaBin, [
    scriptPath, inputPath, '--target', 'lua', `--${preset}`
  ], {
    cwd: path.dirname(scriptPath),
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  }));
  herculesQueue = run.catch(() => {});
  return run;
}

function isTimeout(error) {
  return Boolean(error && error.killed && error.signal === 'SIGTERM');
}

function fallbackPresets(preset) {
  // Try the configured quality first. Large or unusually complex Lua files
  // can make VM-heavy passes exceed the host's CPU budget, so step down only
  // for a timeout instead of failing the entire resource immediately.
  if (preset === 'maximum') return ['heavy', 'balanced', 'light'];
  if (preset === 'heavy') return ['balanced', 'light'];
  if (preset === 'balanced') return ['light'];
  return [];
}

async function runWithFallback(preset, runAttempt) {
  const attempts = [preset, ...fallbackPresets(preset)];
  let lastError;
  for (const attemptPreset of attempts) {
    try {
      await runAttempt(attemptPreset);
      return attemptPreset;
    } catch (error) {
      lastError = error;
      if (!isTimeout(error) || attemptPreset === attempts[attempts.length - 1]) throw error;
    }
  }
  throw lastError;
}

function outputPathFor(inputPath) {
  return inputPath.replace(/\.lua$/i, '_obfuscated.lua');
}

async function obfuscateLuaDetailed(source, relativeName) {
  const scriptPath = resolveHerculesScript();
  const luaBin = String(process.env.LUA_BIN || 'lua5.4').trim();
  const preset = selectedPreset();
  const timeout = selectedTimeoutMs();
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
    const presetUsed = await runWithFallback(preset, async attemptPreset => {
      fs.rmSync(outputPath, { force: true });
      await runHercules(luaBin, scriptPath, inputPath, attemptPreset, timeout);
    });
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Hercules لم ينشئ الملف المتوقع: ${path.basename(outputPath)}`);
    }
    const protectedSource = fs.readFileSync(outputPath, 'utf8');
    if (!protectedSource.trim()) throw new Error('Hercules أعاد ملف Lua فارغاً.');
    return { source: protectedSource, presetUsed };
  } catch (error) {
    if (isTimeout(error)) {
      throw new Error(`انتهت مهلة Hercules بعد تجربة الإعدادات الأخف أثناء معالجة ${relativeName}. خفّض HERCULES_PRESET أو قلّل حجم المورد؛ لم يتم اعتماد ملف ناقص.`);
    }
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

async function obfuscateLua(source, relativeName) {
  return (await obfuscateLuaDetailed(source, relativeName)).source;
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

  const fallbackFiles = [];
  for (const file of selected) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const input = fs.readFileSync(file, 'utf8');
    const result = await obfuscateLuaDetailed(input, relative);
    fs.writeFileSync(file, result.source, 'utf8');
    if (result.presetUsed !== selectedPreset()) fallbackFiles.push(relative);
  }

  const manifestUpdated = ensureFiveMLua54(root);
  return { processed: selected.length, serverFiles: serverFiles.length, mode, provider: 'hercules', manifestUpdated, fallbackFiles };
}

module.exports = { processAndProtectFiles, obfuscateLua, selectedPreset, resolveHerculesScript, fallbackPresets, runWithFallback };
