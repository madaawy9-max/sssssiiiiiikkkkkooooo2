/* ============================================================================
 * RAVX — Signed License Tokens
 * ============================================================================
 * The client Lua no longer receives "authorized: true" (which can be edited to
 * "authorized = true" in one line after unprotecting). Instead the server
 * returns a payload + HMAC signature. The Lua verifies the signature using a
 * secret that is embedded in the obfuscated file but is different per script.
 *
 * Why this is stronger:
 *   - Editing the boolean no longer works — the signature check fails.
 *   - Each script has its own secret → leaking one doesn't compromise others.
 *   - Token is bound to: code + IP + resource name + expiry timestamp.
 *   - Even with full source access, forging a signature requires the per-script
 *     secret, which lives only in the obfuscated blob and on your server.
 *
 * Honest ceiling (unchanged): someone who hooks `load`/`loadstring` and dumps
 * the decoded Lua can still read the secret from the file and forge signatures.
 * But that's now a *two-step* attack requiring the secret, not a one-line edit.
 * ========================================================================== */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.resolve(__dirname, '../../storage/license_secret.key');

// Global HMAC secret (used to derive per-script secrets).
function loadGlobalSecret() {
    try {
        if (fs.existsSync(SECRET_FILE)) {
            const raw = fs.readFileSync(SECRET_FILE, 'utf8').trim();
            if (raw.length >= 32) return raw;
        }
    } catch (e) { /* ignore */ }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    console.log('[RAVX] Generated new license_secret.key — keep this file safe and out of git.');
    return secret;
}

const GLOBAL_SECRET = loadGlobalSecret();

// Per-script secret: derived from the global secret + the script code.
// Deterministic (same code = same secret), so a re-issued token for the same
// code uses the same secret, but different codes have unrelated secrets.
function perScriptSecret(scriptCode) {
    return crypto
        .createHmac('sha256', GLOBAL_SECRET)
        .update('ravx-script:' + String(scriptCode).toUpperCase())
        .digest('hex');
}

// Build a signed token for a given code + requesting IP + resource name.
// Format: base64url(payload) + '.' + hex(HMAC(payload))
// Payload is JSON: { code, ip, resource, exp, iat }
function signToken({ code, ip, resource, ttlSeconds = 300 }) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        code: String(code).toUpperCase(),
        ip: String(ip || ''),
        resource: String(resource || ''),
        exp: now + Math.max(30, ttlSeconds),
        iat: now,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
        .createHmac('sha256', perScriptSecret(code))
        .update(body)
        .digest('hex');
    return { body, sig, payload };
}

// Verify a token's signature and expiry (server-side helper — the Lua does the
// equivalent in pure Lua using its embedded secret).
function verifyToken(code, body, sig) {
    const expected = crypto
        .createHmac('sha256', perScriptSecret(code))
        .update(body)
        .digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(sig || ''), 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.code !== String(code).toUpperCase()) return null;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

module.exports = { GLOBAL_SECRET, perScriptSecret, signToken, verifyToken };