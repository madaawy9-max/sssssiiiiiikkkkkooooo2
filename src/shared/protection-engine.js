/* ============================================================================
 * RAVX Protection Engine V5
 * ----------------------------------------------------------------------------
 * Goals:
 *  - FiveM/Lua 5.4 compatible, no external obfuscator process.
 *  - Linear-time protection to avoid Hercules/CLI timeouts on large resources.
 *  - Per-file randomized stream transform + shuffled fragments + integrity check.
 *  - Live IP licensing that survives temporary bot/web restarts via a bounded KVP
 *    grace cache. A temporary network failure does NOT instantly kill customers.
 *  - Explicit license denial (deleted license / changed IP) still stops the
 *    resource after a confirmation retry.
 *
 * Important reality: any Lua code that must execute on a customer's machine can
 * ultimately be inspected by a determined operator. This engine raises the cost
 * of casual extraction/tampering while prioritising FiveM stability.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const V5_MARKER = '--[[RAVX-PROTECTED-V5]]';
const LICENSE_BEGIN = '--[[RAVX-LICENSE-BEGIN]]';
const LICENSE_END = '--[[RAVX-LICENSE-END]]';

function xorshift32(v) {
  v >>>= 0;
  v ^= (v << 13) >>> 0;
  v ^= v >>> 17;
  v ^= (v << 5) >>> 0;
  return v >>> 0;
}

function fnv1a32(buf) {
  let h = 0x811c9dc5;
  for (const b of buf) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function randomId() {
  return '_0x' + crypto.randomBytes(5).toString('hex');
}

function luaQuote(value) {
  const s = String(value ?? '');
  return '"' + s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n') + '"';
}

function shuffledAlphabet() {
  const chars = '0123456789abcdef'.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function encodeBytes(sourceBytes, seed) {
  const out = Buffer.alloc(sourceBytes.length);
  let state = seed >>> 0;
  for (let i = 0; i < sourceBytes.length; i++) {
    state = xorshift32(state);
    const k1 = state & 0xff;
    state = xorshift32(state);
    const k2 = (state >>> 8) & 0xff;
    const add = ((i * 13) + (seed & 0xff)) & 0xff;
    out[i] = (((sourceBytes[i] ^ k1) + k2 + add) & 0xff) >>> 0;
  }
  return out;
}

function decodeBytes(encoded, seed) {
  const out = Buffer.alloc(encoded.length);
  let state = seed >>> 0;
  for (let i = 0; i < encoded.length; i++) {
    state = xorshift32(state);
    const k1 = state & 0xff;
    state = xorshift32(state);
    const k2 = (state >>> 8) & 0xff;
    const add = ((i * 13) + (seed & 0xff)) & 0xff;
    out[i] = ((((encoded[i] - k2 - add) & 0xff) ^ k1) & 0xff) >>> 0;
  }
  return out;
}

function bytesToCustomHex(buf, alphabet) {
  let out = '';
  const parts = [];
  // Building one giant string byte-by-byte is expensive for multi-megabyte Lua.
  // Emit medium chunks and join once.
  let chunk = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    chunk += alphabet[(b >>> 4) & 15] + alphabet[b & 15];
    if (chunk.length >= 32768) { parts.push(chunk); chunk = ''; }
  }
  if (chunk) parts.push(chunk);
  return parts.join('');
}

function customHexToBytes(text, alphabet) {
  const inv = new Map();
  for (let i = 0; i < alphabet.length; i++) inv.set(alphabet[i], i);
  if (text.length % 2 !== 0) throw new Error('Invalid protected payload length');
  const out = Buffer.alloc(text.length / 2);
  for (let i = 0, o = 0; i < text.length; i += 2, o++) {
    const hi = inv.get(text[i]);
    const lo = inv.get(text[i + 1]);
    if (hi === undefined || lo === undefined) throw new Error('Invalid protected payload alphabet');
    out[o] = (hi << 4) | lo;
  }
  return out;
}

function fragmentText(text) {
  // 6..11 fragments, kept on even boundaries because the payload is 2 chars/byte.
  const count = Math.min(Math.max(6, Math.ceil(text.length / 180000)), 11);
  const rawSize = Math.ceil(text.length / count);
  const size = rawSize % 2 === 0 ? rawSize : rawSize + 1;
  const original = [];
  for (let i = 0; i < text.length; i += size) original.push(text.slice(i, i + size));

  const shuffledIndices = original.map((_, i) => i);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }
  const stored = shuffledIndices.map(i => original[i]);
  const restore = new Array(original.length);
  shuffledIndices.forEach((origIndex, storedIndex) => { restore[origIndex] = storedIndex + 1; });
  return { stored, restore };
}

function buildLicenseMonitor(licenseCode, resourceName, baseUrl) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/api/license/${encodeURIComponent(licenseCode)}`;
  const stateKey = `ravx:v5:${licenseCode}`;
  const prefix = '__rvx_' + crypto.randomBytes(4).toString('hex');
  const qEndpoint = luaQuote(endpoint);
  const qCode = luaQuote(licenseCode);
  const qResource = luaQuote(resourceName || 'resource');
  const qStateKey = luaQuote(stateKey);

  // This monitor is intentionally non-blocking: developer code runs in the same
  // order FiveM normally loads it. Licensing runs beside it and only stops the
  // resource after an explicit denial, or after a long continuous inability to
  // verify with no valid cached grant. This prevents a bot/web restart from
  // breaking every already-licensed customer.
  return `${LICENSE_BEGIN}
if type(IsDuplicityVersion) == "function" and IsDuplicityVersion() then
    _G.__RAVX_V5_MONITORS = _G.__RAVX_V5_MONITORS or {}
    local ${prefix}_code = ${qCode}
    if not _G.__RAVX_V5_MONITORS[${prefix}_code] then
        _G.__RAVX_V5_MONITORS[${prefix}_code] = true
        local ${prefix}_endpoint = ${qEndpoint}
        local ${prefix}_kvp = ${qStateKey}
        local ${prefix}_resource = ${qResource}

        local function ${prefix}_now()
            return (os and os.time and os.time()) or 0
        end

        local function ${prefix}_urlencode(s)
            return (tostring(s or ""):gsub("([^%w%-_%.~])", function(c)
                return string.format("%%%02X", string.byte(c))
            end))
        end

        local function ${prefix}_parse(body)
            if type(body) ~= "string" then return nil end
            if body:match('"authorized"%s*:%s*true') then return true end
            if body:match('"authorized"%s*:%s*false') then return false end
            return nil
        end

        local function ${prefix}_http(url, cb)
            PerformHttpRequest(url, function(status, body)
                if status and status >= 200 and status < 300 then
                    cb(${prefix}_parse(body), status)
                else
                    cb(nil, status or 0)
                end
            end, "GET", "", { ["Accept"] = "application/json", ["Cache-Control"] = "no-cache" })
        end

        local function ${prefix}_check(cb)
            ${prefix}_http(${prefix}_endpoint, function(first)
                if first == true then cb(true); return end
                if first == nil then cb(nil); return end

                -- Socket/outbound IP did not match. Resolve the machine's public
                -- IPv4 and retry once with ?ip= so NAT/IPv6 egress does not reject
                -- a legitimate customer whose sold IP is IPv4.
                PerformHttpRequest("https://api4.ipify.org", function(ipStatus, ipBody)
                    if not ipStatus or ipStatus < 200 or ipStatus >= 300 or type(ipBody) ~= "string" then
                        cb(nil); return
                    end
                    local ip = ipBody:gsub("%s+", "")
                    if ip == "" or #ip > 100 then cb(nil); return end
                    ${prefix}_http(${prefix}_endpoint .. "?ip=" .. ${prefix}_urlencode(ip), function(second)
                        if second == true then cb(true)
                        elseif second == false then cb(false)
                        else cb(nil) end
                    end)
                end, "GET", "", { ["Accept"] = "text/plain", ["Cache-Control"] = "no-cache" })
            end)
        end

        Citizen.CreateThread(function()
            local denied = 0
            while true do
                local finished, result = false, nil
                ${prefix}_check(function(v) result = v; finished = true end)
                local waited = 0
                while not finished and waited < 15000 do
                    Citizen.Wait(100)
                    waited = waited + 100
                end
                if not finished then result = nil end

                local now = ${prefix}_now()
                if result == true then
                    denied = 0
                    if type(SetResourceKvp) == "function" then
                        SetResourceKvp(${prefix}_kvp .. ":valid_until", tostring(now + 7 * 24 * 60 * 60))
                        SetResourceKvp(${prefix}_kvp .. ":unverified_since", "0")
                    end
                elseif result == false then
                    denied = denied + 1
                    if denied >= 2 then
                        print(("^1[RAVX] License denied for %s (%s). Resource stopped.^0"):format(${prefix}_resource, ${prefix}_code))
                        if type(DeleteResourceKvp) == "function" then
                            DeleteResourceKvp(${prefix}_kvp .. ":valid_until")
                            DeleteResourceKvp(${prefix}_kvp .. ":unverified_since")
                        end
                        Citizen.Wait(250)
                        StopResource(GetCurrentResourceName())
                        return
                    end
                    Citizen.Wait(15000)
                    goto continue
                else
                    denied = 0
                    local validUntil = 0
                    local unverifiedSince = 0
                    if type(GetResourceKvpString) == "function" then
                        validUntil = tonumber(GetResourceKvpString(${prefix}_kvp .. ":valid_until") or "0") or 0
                        unverifiedSince = tonumber(GetResourceKvpString(${prefix}_kvp .. ":unverified_since") or "0") or 0
                    end
                    if validUntil <= now then
                        if unverifiedSince <= 0 then
                            unverifiedSince = now
                            if type(SetResourceKvp) == "function" then SetResourceKvp(${prefix}_kvp .. ":unverified_since", tostring(now)) end
                        elseif now > 0 and (now - unverifiedSince) > 1800 then
                            print(("^1[RAVX] License server unavailable for too long and no valid cache exists for %s. Resource stopped.^0"):format(${prefix}_resource))
                            StopResource(GetCurrentResourceName())
                            return
                        end
                    end
                    print(("^3[RAVX] Temporary license-server/network issue for %s; keeping the licensed resource running during grace.^0"):format(${prefix}_resource))
                end

                Citizen.Wait(5 * 60 * 1000)
                ::continue::
            end
        end)
    end
end
${LICENSE_END}`;
}

function obfuscateLuaBlob(sourceCode, chunkLabel = 'RAVX') {
  const sourceBytes = Buffer.from(sourceCode, 'utf8');
  const seed = crypto.randomInt(1, 0x7fffffff) >>> 0;
  const mask = crypto.randomInt(1, 0x7fffffff) >>> 0;
  const seedA = (seed ^ mask) >>> 0;
  const seedB = mask >>> 0;
  const alphabet = shuffledAlphabet();
  const encoded = encodeBytes(sourceBytes, seed);
  const payload = bytesToCustomHex(encoded, alphabet);
  const { stored, restore } = fragmentText(payload);
  const checksum = fnv1a32(sourceBytes);

  const id = {
    chunks: randomId(), order: randomId(), alpha: randomId(), inv: randomId(),
    a: randomId(), b: randomId(), seed: randomId(), xs: randomId(), state: randomId(),
    enc: randomId(), out: randomId(), idx: randomId(), i: randomId(), h: randomId(),
    lo: randomId(), hi: randomId(), k1: randomId(), k2: randomId(), add: randomId(),
    src: randomId(), hash: randomId(), loader: randomId(), fn: randomId(), err: randomId()
  };

  const chunksLua = stored.map(s => luaQuote(s)).join(',\n');
  const orderLua = restore.join(',');

  return `${V5_MARKER}
-- RAVX metadata is intentionally structural only; source remains transformed.
--@rvx.chunks
local ${id.chunks} = {
${chunksLua}
}
--@rvx.order
local ${id.order} = {${orderLua}}
--@rvx.alpha
local ${id.alpha} = ${luaQuote(alphabet)}
--@rvx.seed
local ${id.a}, ${id.b} = ${seedA}, ${seedB}
--@rvx.check
local ${id.hash} = ${checksum}

local function ${id.xs}(${id.state})
    ${id.state} = (${id.state} ~ (${id.state} << 13)) & 0xFFFFFFFF
    ${id.state} = (${id.state} ~ (${id.state} >> 17)) & 0xFFFFFFFF
    ${id.state} = (${id.state} ~ (${id.state} << 5)) & 0xFFFFFFFF
    return ${id.state}
end

local ${id.inv} = {}
for ${id.i} = 1, #${id.alpha} do
    ${id.inv}[string.sub(${id.alpha}, ${id.i}, ${id.i})] = ${id.i} - 1
end

local ${id.enc} = {}
for ${id.i} = 1, #${id.order} do
    ${id.enc}[#${id.enc} + 1] = ${id.chunks}[${id.order}[${id.i}]]
end
${id.enc} = table.concat(${id.enc})
if (#${id.enc} % 2) ~= 0 then error("[RAVX] damaged payload") end

local ${id.seed} = (${id.a} ~ ${id.b}) & 0xFFFFFFFF
local ${id.state} = ${id.seed}
local ${id.out} = {}
local ${id.idx} = 0
for ${id.i} = 1, #${id.enc}, 2 do
    local ${id.h} = ${id.inv}[string.sub(${id.enc}, ${id.i}, ${id.i})]
    local ${id.lo} = ${id.inv}[string.sub(${id.enc}, ${id.i} + 1, ${id.i} + 1)]
    if ${id.h} == nil or ${id.lo} == nil then error("[RAVX] damaged alphabet") end
    local byte = (${id.h} * 16) + ${id.lo}
    ${id.state} = ${id.xs}(${id.state})
    local ${id.k1} = ${id.state} & 0xFF
    ${id.state} = ${id.xs}(${id.state})
    local ${id.k2} = (${id.state} >> 8) & 0xFF
    local ${id.add} = ((${id.idx} * 13) + (${id.seed} & 0xFF)) & 0xFF
    byte = (((byte - ${id.k2} - ${id.add}) & 0xFF) ~ ${id.k1}) & 0xFF
    ${id.out}[#${id.out} + 1] = string.char(byte)
    ${id.idx} = ${id.idx} + 1
end
local ${id.src} = table.concat(${id.out})

local verify = 0x811C9DC5
for p = 1, #${id.src} do
    verify = (verify ~ string.byte(${id.src}, p)) & 0xFFFFFFFF
    verify = (verify * 0x01000193) & 0xFFFFFFFF
end
if verify ~= ${id.hash} then error("[RAVX] integrity check failed") end

local ${id.loader} = load or loadstring
local ${id.fn}, ${id.err}
if load then
    ${id.fn}, ${id.err} = load(${id.src}, ${luaQuote('@' + chunkLabel)}, "t", _ENV)
else
    ${id.fn}, ${id.err} = loadstring(${id.src}, ${luaQuote('@' + chunkLabel)})
end
if not ${id.fn} then error("[RAVX] load failed: " .. tostring(${id.err})) end
return ${id.fn}()
`;
}

function stripLicenseMonitor(source) {
  const start = source.indexOf(LICENSE_BEGIN);
  if (start === -1) return source;
  const end = source.indexOf(LICENSE_END, start);
  if (end === -1) return source;
  const after = end + LICENSE_END.length;
  return (source.slice(0, start) + source.slice(after)).replace(/^\s*\r?\n/, '');
}

function parseLuaStringLiteral(lit) {
  // Our generator only emits quoted strings escaped by luaQuote(), so JSON.parse
  // is compatible for the subset we produce.
  return JSON.parse(lit);
}

function unprotectLuaBlob(content) {
  if (!content.includes(V5_MARKER)) return null;
  const chunksMatch = content.match(/--@rvx\.chunks\s*\nlocal\s+[_A-Za-z0-9]+\s*=\s*\{([\s\S]*?)\}\s*\n--@rvx\.order/);
  const orderMatch = content.match(/--@rvx\.order\s*\nlocal\s+[_A-Za-z0-9]+\s*=\s*\{([0-9,\s]+)\}/);
  const alphaMatch = content.match(/--@rvx\.alpha\s*\nlocal\s+[_A-Za-z0-9]+\s*=\s*("(?:\\.|[^"\\])*")/);
  const seedMatch = content.match(/--@rvx\.seed\s*\nlocal\s+[_A-Za-z0-9]+\s*,\s*[_A-Za-z0-9]+\s*=\s*(\d+)\s*,\s*(\d+)/);
  const checkMatch = content.match(/--@rvx\.check\s*\nlocal\s+[_A-Za-z0-9]+\s*=\s*(\d+)/);
  if (!chunksMatch || !orderMatch || !alphaMatch || !seedMatch || !checkMatch) {
    throw new Error('RAVX V5 metadata is incomplete');
  }

  const stringLits = chunksMatch[1].match(/"(?:\\.|[^"\\])*"/g) || [];
  const stored = stringLits.map(parseLuaStringLiteral);
  const order = orderMatch[1].split(',').map(s => Number(s.trim())).filter(Number.isFinite);
  const alphabet = parseLuaStringLiteral(alphaMatch[1]);
  const seed = ((Number(seedMatch[1]) >>> 0) ^ (Number(seedMatch[2]) >>> 0)) >>> 0;
  const expected = Number(checkMatch[1]) >>> 0;

  if (!order.length || order.some(i => i < 1 || i > stored.length)) throw new Error('RAVX V5 fragment order is invalid');
  const payload = order.map(i => stored[i - 1]).join('');
  const encoded = customHexToBytes(payload, alphabet);
  const plain = decodeBytes(encoded, seed);
  if (fnv1a32(plain) !== expected) throw new Error('RAVX V5 integrity mismatch');
  return stripLicenseMonitor(plain.toString('utf8'));
}

function walkLuaFiles(rootDir) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.lua$/i.test(entry.name) && !/^fxmanifest\.lua$/i.test(entry.name) && !/^__resource\.lua$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  walk(rootDir);
  return out;
}

function globToRegExp(glob) {
  let s = String(glob).replace(/\\/g, '/');
  s = s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  s = s.replace(/\*\*/g, '___DOUBLE_STAR___');
  s = s.replace(/\*/g, '[^/]*');
  s = s.replace(/___DOUBLE_STAR___/g, '.*');
  return new RegExp('^' + s + '$', 'i');
}

function manifestScriptPatterns(rootDir) {
  const manifest = ['fxmanifest.lua', '__resource.lua'].map(n => path.join(rootDir, n)).find(fs.existsSync);
  const server = [], client = [], shared = [];
  if (!manifest) return { server, client, shared };
  let text = '';
  try { text = fs.readFileSync(manifest, 'utf8'); } catch (_) { return { server, client, shared }; }

  const collect = (kind, arr) => {
    const single = new RegExp(kind + '\\s+["\\\']([^"\\\']+)["\\\']', 'gi');
    let m;
    while ((m = single.exec(text))) arr.push(m[1]);
    const plural = new RegExp(kind + 's\\s*\\{([\\s\\S]*?)\\}', 'gi');
    while ((m = plural.exec(text))) {
      const body = m[1];
      const q = /["']([^"']+)["']/g;
      let qh; while ((qh = q.exec(body))) arr.push(qh[1]);
    }
  };
  collect('server_script', server);
  collect('client_script', client);
  collect('shared_script', shared);
  return { server, client, shared };
}

function matchesAny(rel, patterns) {
  const normalized = rel.replace(/\\/g, '/');
  return patterns.some(p => {
    try { return globToRegExp(p).test(normalized); } catch (_) { return normalized.toLowerCase() === String(p).toLowerCase(); }
  });
}

function isTargetCandidate(rel, manifestPatterns) {
  const n = rel.replace(/\\/g, '/').toLowerCase();
  const base = path.posix.basename(n);
  if (matchesAny(n, [...manifestPatterns.server, ...manifestPatterns.client, ...manifestPatterns.shared])) return true;
  if (/(^|\/)(client|server)(\/|$)/.test(n)) return true;
  if (/(^|[_-])(client|server|main)([_-]|\.|$)/.test(base)) return true;
  return false;
}

function isServerCandidate(rel, manifestPatterns) {
  const n = rel.replace(/\\/g, '/').toLowerCase();
  const base = path.posix.basename(n);
  if (matchesAny(n, [...manifestPatterns.server, ...manifestPatterns.shared])) return true;
  if (/(^|\/)server(\/|$)/.test(n)) return true;
  if (/(^|[_-])(server|main)([_-]|\.|$)/.test(base)) return true;
  return false;
}

function processAndProtectFiles(rootDir, licenseCode, resourceName, encryptionMode = 'target', baseUrl) {
  if (!rootDir || !fs.existsSync(rootDir)) throw new Error('مجلد المورد غير موجود');
  if (!licenseCode) throw new Error('كود الترخيص مفقود');
  if (!baseUrl || !/^https?:\/\//i.test(String(baseUrl))) throw new Error('BASE_URL غير صالح لفحص الترخيص');

  const mode = ['target', 'full', 'none'].includes(encryptionMode) ? encryptionMode : 'target';
  const files = walkLuaFiles(rootDir);
  const patterns = manifestScriptPatterns(rootDir);
  let selected = mode === 'full' ? files.slice() : files.filter(f => isTargetCandidate(path.relative(rootDir, f), patterns));
  if (!selected.length && files.length) selected = [files[0]];

  // In IP-only mode, keep developer source readable and only inject the live
  // monitor into server/shared candidates. For encrypted modes the monitor is
  // merged into every protected chunk; on client it is a no-op.
  const serverFiles = files.filter(f => isServerCandidate(path.relative(rootDir, f), patterns));
  const guardTargets = mode === 'none' ? (serverFiles.length ? serverFiles : (files[0] ? [files[0]] : [])) : selected;
  const guardSet = new Set(guardTargets.map(f => path.resolve(f)));
  const selectedSet = new Set(selected.map(f => path.resolve(f)));
  const report = { processed: 0, protected: 0, guarded: 0, files: [] };

  for (const file of files) {
    report.processed++;
    const abs = path.resolve(file);
    const shouldEncrypt = mode !== 'none' && selectedSet.has(abs);
    const shouldGuard = guardSet.has(abs);
    if (!shouldEncrypt && !shouldGuard) continue;

    let source = fs.readFileSync(file, 'utf8');
    // Avoid accidental double protection if the same resource is uploaded twice.
    const already = unprotectLuaBlob(source);
    if (already !== null) source = already;
    else source = stripLicenseMonitor(source);

    if (shouldGuard) {
      source = buildLicenseMonitor(licenseCode, resourceName, baseUrl) + '\n' + source;
      report.guarded++;
    }

    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    const output = shouldEncrypt ? obfuscateLuaBlob(source, `${resourceName}/${rel}`) : source;
    fs.writeFileSync(file, output, 'utf8');
    report.protected += shouldEncrypt ? 1 : 0;
    report.files.push(rel);
  }

  return report;
}

function unprotectFiles(rootDir) {
  const files = walkLuaFiles(rootDir);
  const report = { processed: 0, unprotected: 0, files: [], errors: [] };
  for (const file of files) {
    report.processed++;
    try {
      const source = fs.readFileSync(file, 'utf8');
      let plain = unprotectLuaBlob(source);
      if (plain === null) {
        const stripped = stripLicenseMonitor(source);
        if (stripped === source) continue;
        plain = stripped;
      }
      fs.writeFileSync(file, plain, 'utf8');
      report.unprotected++;
      report.files.push(path.relative(rootDir, file).replace(/\\/g, '/'));
    } catch (err) {
      report.errors.push({ file: path.relative(rootDir, file), error: err.message });
    }
  }
  return report;
}

module.exports = {
  processAndProtectFiles,
  unprotectFiles,
  obfuscateLuaBlob,
  unprotectLuaBlob,
  buildLicenseMonitor,
  stripLicenseMonitor,
  V5_MARKER
};
