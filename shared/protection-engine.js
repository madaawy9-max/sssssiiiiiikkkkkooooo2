'use strict';
/* ---------------------------------------------------------------------------
 * SIKO DEV — Protection Engine (orchestrator)
 * ---------------------------------------------------------------------------
 * Combines:
 *   - obfuscator.js      (fragmented XOR encoding of the Lua source)
 *   - license-guard.js   (HWID/IP-bound license check, fused in BEFORE
 *                          obfuscation so you can't strip it without
 *                          breaking the integrity checks)
 *   - persistent-store.js (so license bindings survive a bot/web restart —
 *                          this is the fix for the "restart wipes people's
 *                          activation state" bug)
 *
 * Usage (from your Discord bot or web upload handler):
 *
 *   const { processAndProtectFiles } = require('./src/shared/protection-engine');
 *
 *   await processAndProtectFiles({
 *     resourceDir:  '/tmp/uploads/my_resource',
 *     resourceName: 'my_resource',
 *     licenseCode:  'SIKO-ABCD1234',
 *     baseUrl:      'https://your-domain.example',
 *     // which files get the license guard fused in (usually just the
 *     // server-side entry point(s) listed in fxmanifest.lua as server_script)
 *     serverFiles:  ['server/main.lua'],
 *   });
 *
 * This walks resourceDir, and for every .lua file:
 *   - if it's listed in serverFiles: prepend the license guard, THEN obfuscate
 *   - otherwise: obfuscate as-is (no license check — only entry points need it)
 * ------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const { obfuscateLuaBlob, BRAND } = require('./obfuscator');
const { buildLicenseGuard } = require('./license-guard');
const { JsonStore, withFileLock } = require('./persistent-store');

function walkLuaFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkLuaFiles(full));
    } else if (entry.isFile() && full.toLowerCase().endsWith('.lua')) {
      out.push(full);
    }
  }
  return out;
}

async function processAndProtectFiles({
  resourceDir,
  resourceName,
  licenseCode,
  baseUrl,
  serverFiles = [], // paths relative to resourceDir that should get the license guard
}) {
  if (!resourceDir || !resourceName || !licenseCode || !baseUrl) {
    throw new Error('processAndProtectFiles: resourceDir, resourceName, licenseCode, baseUrl are all required');
  }

  const serverFileSet = new Set(serverFiles.map(p => path.normalize(p)));
  const luaFiles = walkLuaFiles(resourceDir);
  const results = [];

  for (const filePath of luaFiles) {
    const relPath = path.relative(resourceDir, filePath);
    const original = fs.readFileSync(filePath, 'utf8');

    let toObfuscate = original;
    const isEntryPoint = serverFileSet.has(path.normalize(relPath));

    if (isEntryPoint) {
      const guard = buildLicenseGuard({ resourceName, licenseCode, baseUrl });
      // Fused BEFORE obfuscation: guard + script become ONE encoded blob.
      // Deleting the guard block after this point means deleting bytes out
      // of the middle of an XOR-chained, CRC-checked blob — it won't run.
      toObfuscate = guard + '\n' + original;
    }

    const protectedLua = obfuscateLuaBlob(toObfuscate, relPath);
    fs.writeFileSync(filePath, protectedLua, 'utf8');
    results.push({ file: relPath, guarded: isEntryPoint });
  }

  return { resourceName, brand: BRAND, files: results };
}

/* ---------------------------------------------------------------------------
 * License record store — this is what your /api/license/:code/verify route
 * (in your web server) reads and writes. Built on the restart-safe JsonStore
 * so a bot restart can never reset a customer's binding back to "unused".
 * ------------------------------------------------------------------------- */

function createLicenseStore(storageDir) {
  const store = new JsonStore(path.join(storageDir, 'license_bindings.json'), {});
  const lockPath = path.join(storageDir, '.license.lock');

  /**
   * Verify (and bind-on-first-use) a license code against the caller's
   * reported licenseKey + the IP you read from the actual HTTP connection
   * (pass callerIp in from req.socket.remoteAddress server-side — never
   * from anything inside the request body).
   */
  async function verify(code, { licenseKey, callerIp }) {
    return withFileLock(lockPath, async () => {
      return store.update((bindings) => {
        const existing = bindings[code];

        if (!existing) {
          // First activation: bind it now.
          bindings[code] = {
            licenseKey,
            ip: callerIp,
            boundAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          };
          return bindings;
        }

        const keyMatches = existing.licenseKey === licenseKey;
        const ipMatches = existing.ip === callerIp;

        if (keyMatches && ipMatches) {
          existing.lastSeenAt = new Date().toISOString();
          return bindings;
        }

        // Mismatch — don't mutate the binding, just let the caller see the
        // failure. (verifyResult below carries the reason back up.)
        bindings.__lastDenyReason = !keyMatches
          ? 'license key mismatch (different server / re-registered)'
          : 'ip mismatch (resource moved to a different host)';
        return bindings;
      }).then((bindings) => {
        const rec = bindings[code];
        if (!rec) return { ok: false, reason: 'unknown code' };
        const keyMatches = rec.licenseKey === licenseKey;
        const ipMatches = rec.ip === callerIp;
        if (keyMatches && ipMatches) return { ok: true };
        return { ok: false, reason: !keyMatches ? 'license_key_mismatch' : 'ip_mismatch' };
      });
    });
  }

  return { verify, _store: store };
}

module.exports = {
  processAndProtectFiles,
  createLicenseStore,
};
