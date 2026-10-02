'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WRAPPER_MARKER = '--[[RAVX_OBF_V1]]';
const LICENSE_MARKER = '--[[RAVX_LICENSE_V1]]';

function luaLongString(value) {
  const source = String(value);
  let equals = '';
  while (source.includes(`]${equals}]`)) equals += '=';
  return `[${equals}[${source}]${equals}]`;
}

function encodeLua(sourceCode, chunkLabel) {
  const bytes = Buffer.from(String(sourceCode), 'utf8');
  const key = crypto.randomInt(1, 256);
  const values = [];
  for (let i = 0; i < bytes.length; i++) {
    const stream = (key + ((i + 1) * 73) + ((i + 1) % 31) * 19) & 0xff;
    values.push(bytes[i] ^ stream);
  }
  const label = String(chunkLabel || 'ravx').replace(/[\r\n]/g, '_').replace(/['\\]/g, '_');
  return `${WRAPPER_MARKER}\n` +
`local __ravx_key = ${key}
local __ravx_data = {${values.join(',')}}
local __ravx_out = {}
for __ravx_i = 1, #__ravx_data do
    local __ravx_stream = (__ravx_key + (__ravx_i * 73) + (__ravx_i % 31) * 19) & 0xFF
    __ravx_out[__ravx_i] = string.char((__ravx_data[__ravx_i] ~ __ravx_stream) & 0xFF)
end
local __ravx_source = table.concat(__ravx_out)
local __ravx_chunk, __ravx_err = load(__ravx_source, '@${label}', 't', _ENV)
if not __ravx_chunk then error('[RAVX] Protected chunk failed to load: ' .. tostring(__ravx_err)) end
__ravx_chunk()
`;
}

// Compatibility name used by older callers. This is obfuscation, not
// cryptographic encryption: the runtime decoder and data ship with the file.
function obfuscateLuaBlob(sourceCode, chunkLabel) {
  return encodeLua(sourceCode, chunkLabel);
}

function isServerLua(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normalized);
  if (/(^|\/)client\//.test(normalized) || /(^|[-_.])client([-_.]|$)/.test(base)) return false;
  return /(^|\/)(server|servers)\//.test(normalized) || /(^|[-_.])(server|sv|main)([-_.]|$)/.test(base);
}

function isTargetLua(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return /(^|[-_.])(client|server|main)([-_.]|$)/.test(base) || isServerLua(filePath);
}

function buildProtectionCode(licenseCode, resourceName, baseUrl, originalSource = '') {
  const code = String(licenseCode || '').trim();
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(code)) throw new Error('Invalid license code');
  if (!/^https?:\/\//i.test(base)) throw new Error('BASE_URL must be an HTTP(S) URL');

  const licenseUrl = `${base}/api/license/${encodeURIComponent(code)}`;
  const sourceLiteral = luaLongString(originalSource);
  const label = String(resourceName || 'resource').replace(/[^A-Za-z0-9_.-]/g, '_');
  return `${LICENSE_MARKER}
local __ravx_resource = GetCurrentResourceName()
local __ravx_license_url = ${JSON.stringify(licenseUrl)}
local __ravx_license_payload = ${sourceLiteral}
local __ravx_loaded = false
local __ravx_denials = 0

local function __ravx_checkLicense(callback)
    PerformHttpRequest(__ravx_license_url, function(status, body)
        if status == 200 and type(body) == 'string' then
            local ok, result = pcall(json.decode, body)
            callback(ok and type(result) == 'table' and result.authorized == true, true)
        elseif status >= 400 and status < 500 then
            callback(false, true)
        else
            callback(false, false)
        end
    end, 'GET', '', { ['Accept'] = 'application/json' })
end

local function __ravx_start()
    __ravx_checkLicense(function(authorized, reachable)
        if not authorized then
            if reachable then
                __ravx_denials = __ravx_denials + 1
                if __ravx_loaded and __ravx_denials >= 3 then
                    print('[RAVX] License rejected for resource ${label}; stopping resource.')
                    StopResource(__ravx_resource)
                    return
                end
            end
            -- A short outage or bot restart should not permanently break the
            -- resource. Keep checking until the license service is available.
            Citizen.SetTimeout(15000, __ravx_start)
            return
        end

        __ravx_denials = 0
        if not __ravx_loaded then
            local chunk, err = load(__ravx_license_payload, '@${label}', 't', _ENV)
            if not chunk then
                print('[RAVX] Protected resource load failed: ' .. tostring(err))
                StopResource(__ravx_resource)
                return
            end
            __ravx_loaded = true
            local ok, runErr = pcall(chunk)
            if not ok then
                print('[RAVX] Protected resource error: ' .. tostring(runErr))
                StopResource(__ravx_resource)
                return
            end
        end
        -- Re-check periodically so a revoked license or changed IP takes effect
        -- without downloading a replacement resource.
        Citizen.SetTimeout(60000, __ravx_start)
    end)
end

Citizen.CreateThread(__ravx_start)
`;
}

function protectFile(source, filePath, licenseCode, resourceName, encryptionMode, baseUrl) {
  const serverFile = isServerLua(filePath);
  let sourceToProtect = String(source);
  if (serverFile) sourceToProtect = buildProtectionCode(licenseCode, resourceName, baseUrl, sourceToProtect);
  if (encryptionMode === 'none') return sourceToProtect;
  return encodeLua(sourceToProtect, filePath.replace(/\\/g, '/'));
}

function walkLuaFiles(root) {
  const result = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lua') &&
        !['fxmanifest.lua', '__resource.lua'].includes(entry.name.toLowerCase())) result.push(fullPath);
    }
  };
  visit(root);
  return result;
}

function processAndProtectFiles(resourceRoot, licenseCode, resourceName, encryptionMode = 'target', baseUrl) {
  const root = path.resolve(resourceRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Resource folder not found');
  const mode = ['target', 'full', 'none'].includes(encryptionMode) ? encryptionMode : 'target';
  const files = walkLuaFiles(root);
  const serverFiles = files.filter(isServerLua);
  if (!serverFiles.length) throw new Error('لم أجد ملف Lua للخادم (server/main) لإضافة فحص الترخيص.');
  const selected = mode === 'full' ? files : mode === 'none' ? serverFiles : files.filter(isTargetLua);
  if (!selected.some(isServerLua)) throw new Error('لم أجد ملف server/main ضمن ملفات Lua المحددة.');

  let processed = 0;
  for (const file of selected) {
    const original = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file);
    fs.writeFileSync(file, protectFile(original, relative, licenseCode, resourceName, mode, baseUrl), 'utf8');
    processed++;
  }
  return { processed, serverFiles: serverFiles.length, mode };
}

function decodeWrapper(source) {
  if (!source.startsWith(WRAPPER_MARKER)) return null;
  const keyMatch = source.match(/local __ravx_key\s*=\s*(\d+)/);
  const dataMatch = source.match(/local __ravx_data\s*=\s*\{([\d,\s]*)\}/);
  if (!keyMatch || !dataMatch) return null;
  const key = Number(keyMatch[1]);
  const data = dataMatch[1].split(',').map(s => Number(s.trim())).filter(Number.isFinite);
  const bytes = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    const pos = i + 1;
    const stream = (key + (pos * 73) + (pos % 31) * 19) & 0xff;
    bytes[i] = data[i] ^ stream;
  }
  return bytes.toString('utf8');
}

function extractLicensePayload(source) {
  if (!source.startsWith(LICENSE_MARKER)) return null;
  const match = source.match(/local __ravx_license_payload\s*=\s*\[(=*)\[/);
  if (!match) return null;
  const openerEnd = match.index + match[0].length;
  const close = `]${match[1]}]`;
  const end = source.indexOf(close, openerEnd);
  return end < 0 ? null : source.slice(openerEnd, end);
}

function unprotectFiles(resourceRoot) {
  const root = path.resolve(resourceRoot);
  const files = walkLuaFiles(root);
  let processed = 0;
  let unprotected = 0;
  for (const file of files) {
    let source = fs.readFileSync(file, 'utf8');
    processed++;
    if (source.startsWith(LICENSE_MARKER)) {
      const directPayload = extractLicensePayload(source);
      if (directPayload !== null) {
        fs.writeFileSync(file, directPayload, 'utf8');
        unprotected++;
      }
      continue;
    }
    const decoded = decodeWrapper(source);
    if (decoded === null) continue;
    const payload = extractLicensePayload(decoded);
    fs.writeFileSync(file, payload === null ? decoded : payload, 'utf8');
    unprotected++;
  }
  return { processed, unprotected };
}

module.exports = {
  obfuscateLuaBlob,
  buildProtectionCode,
  processAndProtectFiles,
  unprotectFiles,
  isServerLua
};
