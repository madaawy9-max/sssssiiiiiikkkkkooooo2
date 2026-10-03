/* RAVX protection engine
 * Practical FiveM protection: the resource contains ciphertext only. The key is
 * returned by the license API after the server IP is authorized. This prevents
 * a static copy of the ZIP from being decrypted without access to the license
 * service. It is still not absolute DRM: code can be observed after runtime load.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MARKER = '-- RAVX-FIVEM-PROTECTED-V5';

function u32(n) { return n >>> 0; }
function xorshift32(n) {
  n = u32(n ^ (n << 13));
  n = u32(n ^ (n >>> 17));
  return u32(n ^ (n << 5));
}
function seedFor(keyHex, nonceHex) {
  let s = 2166136261 >>> 0;
  const input = Buffer.from(`${keyHex}${nonceHex}`, 'utf8');
  for (const b of input) { s = u32(s ^ b); s = Math.imul(s, 16777619) >>> 0; }
  return s || 0x6d2b79f5;
}
function encryptBytes(source, keyHex, nonceHex) {
  let state = seedFor(keyHex, nonceHex);
  const input = Buffer.from(source, 'utf8');
  const out = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) {
    state = xorshift32(state);
    out[i] = input[i] ^ (state & 0xff) ^ ((i * 31) & 0xff);
  }
  return out.toString('hex');
}

function luaQuote(value) { return JSON.stringify(String(value)); }
function buildProtectedLua(source, chunkLabel, licenseCode, baseUrl, keyHex) {
  const nonceHex = crypto.randomBytes(12).toString('hex');
  const dataHex = encryptBytes(source, keyHex, nonceHex);
  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/api/license/${encodeURIComponent(licenseCode)}`;
  return `${MARKER}
-- The decryption key is obtained only after live license/IP authorization.
local RAVX_CODE = ${luaQuote(licenseCode)}
local RAVX_URL = ${luaQuote(endpoint)}
local RAVX_NONCE = ${luaQuote(nonceHex)}
local RAVX_DATA = ${luaQuote(dataHex)}

local function ravx_bxor(a, b)
    if bit32 and bit32.bxor then return bit32.bxor(a, b) end
    return a ~ b
end
local function ravx_seed(key, nonce)
    local s = 2166136261
    local v = key .. nonce
    for i = 1, #v do
        s = ravx_bxor(s, string.byte(v, i))
        s = (s * 16777619) % 4294967296
    end
    if s == 0 then s = 1831565813 end
    return s
end
local function ravx_step(s)
    s = ravx_bxor(s, (s * 8192) % 4294967296)
    s = ravx_bxor(s, math.floor(s / 131072))
    s = ravx_bxor(s, (s * 32) % 4294967296)
    return s % 4294967296
end
local function ravx_unhex(h)
    local out = {}
    for i = 1, #h, 2 do out[#out + 1] = tonumber(string.sub(h, i, i + 1), 16) end
    return out
end
local function ravx_decrypt(key)
    local bytes, out, state = ravx_unhex(RAVX_DATA), {}, ravx_seed(key, RAVX_NONCE)
    for i = 1, #bytes do
        state = ravx_step(state)
        local b = ravx_bxor(bytes[i], state % 256)
        b = ravx_bxor(b, ((i - 1) * 31) % 256)
        out[i] = string.char(b % 256)
    end
    return table.concat(out)
end

CreateThread(function()
    local done, allowed, licenseKey, responseBody = false, false, nil, nil
    local requestUrl = RAVX_URL
    PerformHttpRequest(requestUrl, function(status, body)
        responseBody = body or ''
        if status == 200 and responseBody:match('"authorized"%s*:%s*true') then
            licenseKey = responseBody:match('"key"%s*:%s*"([0-9a-fA-F]+)"')
            allowed = licenseKey ~= nil and #licenseKey >= 32
        end
        done = true
    end, 'GET', '', { ['Content-Type'] = 'application/json' })
    local waited = 0
    while not done and waited < 15000 do Wait(100); waited = waited + 100 end
    if not done or not allowed then
        error('[RAVX] License denied or license service unavailable for ' .. RAVX_CODE)
        return
    end
    local source = ravx_decrypt(licenseKey)
    local fn, err = load(source, '@${String(chunkLabel).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')
    if not fn then error('[RAVX] Protected chunk load failed: ' .. tostring(err)) end
    return fn()
end)
`;
}

function isLuaFile(file) { return /\.lua$/i.test(file); }
function shouldGuard(file) { return true; }
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function processAndProtectFiles(rootDir, licenseCode, resourceName, encryptionMode = 'target', baseUrl, licenseKey) {
  if (!baseUrl) throw Error('BASE_URL غير مضبوط');
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(String(licenseCode))) throw Error('كود ترخيص غير صالح');
  if (!/^[0-9a-f]{64}$/i.test(String(licenseKey || ''))) throw Error('مفتاح ترخيص غير صالح');
  const files = walk(rootDir).filter(isLuaFile);
  let processed = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes(MARKER)) continue;
    processed++;
    // none keeps non-server Lua readable, while the server-side guard remains.
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    const isServer = /(^|\/)(server|sv_|shared|main)/i.test(rel) || /fxmanifest|__resource/i.test(rel);
    const protect = encryptionMode === 'full' || encryptionMode === 'target' || (encryptionMode === 'none' && isServer);
    if (protect) fs.writeFileSync(file, buildProtectedLua(source, `${resourceName}/${rel}`, licenseCode, baseUrl, licenseKey), 'utf8');
  }
  return { processed, protected: files.length };
}

function protectedMetadata(text) {
  if (!text || !text.includes(MARKER)) return null;
  const code = text.match(/local RAVX_CODE = "([A-Za-z0-9_-]+)"/);
  return code ? { code: code[1] } : null;
}
function unprotectFiles(rootDir, keyResolver) {
  const files = walk(rootDir).filter(isLuaFile);
  let processed = 0, unprotected = 0;
  const report = { processed: 0, unprotected: 0, files: [] };
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(MARKER)) continue;
    processed++;
    const code = protectedMetadata(text)?.code;
    const key = typeof keyResolver === 'function' ? keyResolver(code) : null;
    if (!key) throw Error(`لا يوجد مفتاح ترخيص محفوظ لفك الملف: ${path.basename(file)}`);
    const nonce = text.match(/local RAVX_NONCE = "([0-9a-f]+)"/)?.[1];
    const data = text.match(/local RAVX_DATA = "([0-9a-f]+)"/)?.[1];
    if (!nonce || !data) throw Error(`قالب حماية غير صالح: ${path.basename(file)}`);
    let state = seedFor(key, nonce);
    const bytes = Buffer.from(data, 'hex'), out = Buffer.alloc(bytes.length);
    for (let i = 0; i < bytes.length; i++) { state = xorshift32(state); out[i] = bytes[i] ^ (state & 0xff) ^ ((i * 31) & 0xff); }
    fs.writeFileSync(file, out.toString('utf8'), 'utf8');
    unprotected++; report.files.push(path.relative(rootDir, file));
  }
  report.processed = processed; report.unprotected = unprotected; return report;
}

module.exports = { processAndProtectFiles, unprotectFiles, protectedMetadata, MARKER };
