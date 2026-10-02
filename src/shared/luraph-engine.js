'use strict';

const fs = require('fs');
const path = require('path');
const protection = require('./protection-engine');

const API_ROOT = 'https://api.lura.ph/v1';
const MAX_SCRIPT_BYTES = 50 * 1024 * 1024;

async function apiRequest(route, options = {}) {
  const apiKey = process.env.LPH_API_KEY;
  if (!apiKey) {
    throw new Error('محرك Luraph يحتاج مفتاح API. أضف LPH_API_KEY في متغيرات بيئة الاستضافة بعد تفعيل خطة تدعم API.');
  }

  const response = await fetch(`${API_ROOT}${route}`, {
    ...options,
    headers: {
      'Luraph-API-Key': apiKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(190000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = Array.isArray(parsed.errors)
        ? parsed.errors.map(item => item.message).filter(Boolean).join('; ')
        : parsed.error || body;
    } catch (_) {}
    throw new Error(`Luraph API (${response.status}): ${detail || response.statusText}`);
  }
  return response;
}

function makeFiveMOptions(node) {
  const options = {};
  for (const [id, info] of Object.entries(node.options || {})) {
    if (info.type === 'CHECKBOX') options[id] = false;
    else if (info.type === 'DROPDOWN') options[id] = (info.choices || [])[0] || '';
    else options[id] = '';
  }

  const targetId = Object.keys(node.options || {}).find(id =>
    id.toUpperCase() === 'TARGET_VERSION' || /target.*version/i.test(node.options[id].name || '')
  );
  if (!targetId) throw new Error('لم يعرض Luraph إعداد Target Version لهذا المحرك.');
  const choices = node.options[targetId].choices || [];
  const fivem = choices.find(choice => /fivem/i.test(String(choice)));
  if (!fivem) throw new Error('خيار FiveM غير متاح في إعدادات Luraph لهذا الحساب أو المحرك.');
  options[targetId] = fivem;
  return options;
}

async function obfuscateLua(source, relativeName, selectedNode = null) {
  const code = Buffer.from(source, 'utf8');
  if (code.length > MAX_SCRIPT_BYTES) throw new Error(`ملف Lua أكبر من حد Luraph البالغ 50MB: ${relativeName}`);

  const nodeListResponse = selectedNode
    ? null
    : await apiRequest('/obfuscate/nodes').then(response => response.json());
  const nodeId = selectedNode?.id || nodeListResponse?.recommendedId;
  const node = selectedNode?.node || nodeListResponse?.nodes?.[nodeId];
  if (!nodeId || !node) throw new Error('لم يعثر Luraph على محرك متاح الآن.');

  const createResponse = await apiRequest('/obfuscate/new', {
    method: 'POST',
    body: JSON.stringify({
      fileName: path.basename(relativeName).slice(0, 255),
      node: nodeId,
      script: code.toString('base64'),
      options: makeFiveMOptions(node),
      useTokens: false,
      enforceSettings: false
    })
  });
  const { jobId } = await createResponse.json();
  if (!jobId) throw new Error(`Luraph لم يرجع رقم عملية للملف ${relativeName}.`);

  const statusResponse = await apiRequest(`/obfuscate/status/${encodeURIComponent(jobId)}`);
  const statusText = await statusResponse.text();
  if (statusText) {
    let status;
    try { status = JSON.parse(statusText); } catch (_) { status = null; }
    if (status?.error) throw new Error(`Luraph رفض الملف ${relativeName}: ${status.error}`);
  }

  const result = await apiRequest(`/obfuscate/download/${encodeURIComponent(jobId)}`);
  const protectedSource = await result.text();
  if (!protectedSource.trim()) throw new Error(`Luraph أعاد ملفاً فارغاً للملف ${relativeName}.`);
  return protectedSource;
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

  // Add the live license guard before sending files to Luraph, so the guard and
  // protected resource code are processed together by the FiveM-target engine.
  for (const file of serverFiles) {
    const source = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, protection.buildProtectionCode(
      licenseCode, resourceName, baseUrl, source
    ), 'utf8');
  }

  if (mode === 'none') return { processed: serverFiles.length, serverFiles: serverFiles.length, mode, provider: 'license-only' };

  const selected = mode === 'full' ? files : files.filter(isTargetLua);
  if (!selected.some(protection.isServerLua)) throw new Error('لم أجد ملف server/main ضمن ملفات Lua المحددة.');

  const nodeListResponse = await apiRequest('/obfuscate/nodes').then(response => response.json());
  const nodeId = nodeListResponse.recommendedId || Object.keys(nodeListResponse.nodes || {})[0];
  const node = nodeListResponse.nodes?.[nodeId];
  if (!nodeId || !node) throw new Error('Luraph لا يعرض محركاً متاحاً الآن.');
  const options = makeFiveMOptions(node);

  for (const file of selected) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const input = fs.readFileSync(file, 'utf8');
    const output = await obfuscateLua(input, relative, { id: nodeId, node, options });
    fs.writeFileSync(file, output, 'utf8');
  }

  const manifestUpdated = ensureFiveMLua54(root);
  return { processed: selected.length, serverFiles: serverFiles.length, mode, provider: 'luraph', manifestUpdated };
}

module.exports = { processAndProtectFiles, obfuscateLua, makeFiveMOptions };
