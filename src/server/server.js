const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Busboy = require('busboy');
const db = require('../database/db');
const subs = require('../shared/subscriptions');
const logger = require('../shared/logger');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024 * 1024);
const cfg = {
  clientId: process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.DISCORD_REDIRECT_URI,
  guildId: process.env.DISCORD_GUILD_ID,
  roleId: process.env.ENCRYPT_ROLE_ID || process.env.GRANT_PERMISSION_ROLE_ID,
  botToken: process.env.DISCORD_BOT_TOKEN,
  adminIds: new Set(String(process.env.ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean)),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
};

let engine = null;
try { engine = require(path.join(__dirname, '../engine/bot-engine')); }
catch (e) { console.error('[WEB] engine load failed:', e.message); }

const STORAGE_DIR = path.resolve(__dirname, '../../storage');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');
const sessions = new Map();

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
function loadSessionsFromDisk() {
  ensureStorageDir();
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    for (const [id, session] of Object.entries(raw)) {
      if (session && session.expires > now) sessions.set(id, session);
    }
  } catch (e) {}
}
function saveSessionsToDisk() {
  ensureStorageDir();
  try {
    const obj = {};
    for (const [id, session] of sessions.entries()) obj[id] = session;
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), 'utf8');
  } catch (e) { console.error('[WEB] session persist failed:', e.message); }
}
loadSessionsFromDisk();
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of sessions.entries()) {
    if (session.expires < now) { sessions.delete(id); changed = true; }
  }
  if (changed) saveSessionsToDisk();
}, 10 * 60 * 1000).unref();

const rateBuckets = new Map();
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
function rateLimited(req, res, key, limit, windowMs) {
  const ip = clientIp(req);
  const bucketKey = key + ':' + ip;
  const now = Date.now();
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    sendJson(res, 429, { success: false, message: 'طلبات كثيرة جداً' });
    return true;
  }
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets.entries()) if (b.resetAt < now) rateBuckets.delete(k);
}, 5 * 60 * 1000).unref();

function subscriptionInfo(userId) { return subs.getStatus(userId); }

async function removeRoleNow(userId, entry) {
  const guildId = entry?.guildId || cfg.guildId;
  const roleId = entry?.roleId || cfg.roleId;
  if (!cfg.botToken || !guildId || !roleId) return false;
  try {
    await discordApi('/guilds/' + guildId + '/members/' + userId + '/roles/' + roleId, {
      method: 'DELETE', headers: { Authorization: 'Bot ' + cfg.botToken }
    });
    return true;
  } catch (e) { console.error('[WEB] role removal failed:', e.message); return false; }
}

function invalidateUserSessions(userId, canEncrypt) {
  let changed = false;
  for (const session of sessions.values()) {
    if (session?.user?.id === String(userId)) {
      session.user.canEncrypt = canEncrypt;
      session.user.permCheckedAt = Date.now();
      changed = true;
    }
  }
  if (changed) saveSessionsToDisk();
}

async function finalizeExhausted(userId, entry) {
  const ok = await removeRoleNow(userId, entry);
  if (ok) subs.markRoleRemoved(userId);
  invalidateUserSessions(userId, false);
}

const encryptingNow = new Set();

function isValidTargetToken(value) {
  const t = String(value || '').trim();
  if (!t || t.length > 100) return false;
  const colonCount = (t.match(/:/g) || []).length;
  if (colonCount >= 2) return /^[0-9A-Fa-f:]+$/.test(t);
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/.test(t);
}
function isValidTarget(value) {
  const v = String(value || '').trim();
  if (!v || v.length > 500) return false;
  const parts = v.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(isValidTargetToken);
}
function normalizeIp(ip) {
  let v = String(ip || '').trim().toLowerCase();
  if (v.startsWith('::ffff:')) v = v.slice(7);
  return v;
}
function matchesTargetIp(requesterIp, targetIpField) {
  if (!targetIpField) return false;
  const req = normalizeIp(requesterIp);
  return String(targetIpField).split(',').some(t => normalizeIp(t) === req);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}
function sendJson(res, status, data) {
  if (res.headersSent) return;
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function safeCode(v) {
  const s = String(v || '').trim();
  return s && s.length <= 80 && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}
function publicScript(s) {
  return {
    code: s.code, title: s.title, originalFilename: s.originalFilename,
    fileSize: s.fileSize, fileExtension: s.fileExtension, targetIp: s.targetIp,
    resourceName: s.resourceName, encryptionMode: s.encryptionMode,
    uploader: s.uploader || s.uploaderName, downloads: s.downloads || 0,
    createdAt: s.createdAt, revokedAt: s.revokedAt || null
  };
}
function cookieValue(req, name) {
  const hit = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}
function sign(value) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(value).digest('hex');
}
function setSession(res, user) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { user, expires: Date.now() + 7 * 864e5 });
  saveSessionsToDisk();
  res.setHeader('Set-Cookie', 'ravx_session=' + id + '.' + sign(id) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800');
}
function currentUser(req) {
  const raw = cookieValue(req, 'ravx_session');
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  const session = sessions.get(id);
  if (!id || sig !== sign(id) || !session || session.expires < Date.now()) {
    if (id) { sessions.delete(id); saveSessionsToDisk(); }
    return null;
  }
  return session.user;
}
function requireUser(req, res, permission) {
  const user = currentUser(req);
  if (!user) { sendJson(res, 401, { success: false, message: 'تسجيل الدخول مطلوب' }); return null; }
  if (permission && !user.canEncrypt) { sendJson(res, 403, { success: false, message: 'لا تملك الصلاحية' }); return null; }
  return user;
}
async function discordApi(endpoint, options) {
  const r = await fetch('https://discord.com/api/v10' + endpoint, options || {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || 'Discord ' + r.status);
  return d;
}
async function getDiscordAccess(user, member) {
  const roles = member.roles || [];
  const adminById = cfg.adminIds.has(user.id) || user.id === process.env.OWNER_DISCORD_ID;
  if (adminById) return { canEncrypt: true, isAdmin: true };
  const sub = subs.getStatus(user.id);
  if (sub.entry) return { canEncrypt: sub.active, isAdmin: false };
  if (!cfg.botToken || !cfg.guildId) return { canEncrypt: !!(cfg.roleId && roles.includes(cfg.roleId)), isAdmin: false };
  try {
    const guildMember = await discordApi('/guilds/' + cfg.guildId + '/members/' + user.id, { headers: { Authorization: 'Bot ' + cfg.botToken } });
    const guildRoles = await discordApi('/guilds/' + cfg.guildId + '/roles', { headers: { Authorization: 'Bot ' + cfg.botToken } });
    const memberRoleIds = new Set([cfg.guildId, ...(guildMember.roles || [])]);
    let permissions = 0n;
    for (const role of guildRoles) {
      if (memberRoleIds.has(role.id)) permissions |= BigInt(role.permissions || '0');
    }
    const administrator = (permissions & 0x8n) === 0x8n;
    const roleAllowed = !!cfg.roleId && (guildMember.roles || []).includes(cfg.roleId);
    return { canEncrypt: administrator || roleAllowed, isAdmin: administrator };
  } catch (e) {
    console.error('[WEB] Discord permission check:', e.message);
    return { canEncrypt: !!(cfg.roleId && roles.includes(cfg.roleId)), isAdmin: false };
  }
}
function loginUrl() {
  const q = new URLSearchParams({
    client_id: cfg.clientId || '', redirect_uri: cfg.redirectUri || '',
    response_type: 'code', scope: 'identify guilds.members.read'
  });
  return 'https://discord.com/oauth2/authorize?' + q;
}
async function oauthCallback(code, res) {
  if (!code) throw Error('رمز تسجيل الدخول غير موجود');
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri || !cfg.guildId) throw Error('إعدادات Discord OAuth غير مكتملة');
  const body = new URLSearchParams({
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
    grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri
  });
  const token = await discordApi('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const user = await discordApi('/users/@me', { headers: { Authorization: 'Bearer ' + token.access_token } });
  const member = await discordApi('/users/@me/guilds/' + cfg.guildId + '/member', { headers: { Authorization: 'Bearer ' + token.access_token } });
  const access = await getDiscordAccess(user, member);
  setSession(res, { id: user.id, username: user.username, avatar: user.avatar, canEncrypt: access.canEncrypt, isAdmin: access.isAdmin, permCheckedAt: Date.now() });
  logger.info('auth.login', { userId: user.id, username: user.username, isAdmin: access.isAdmin, canEncrypt: access.canEncrypt });
  res.writeHead(302, { Location: '/' });
  res.end();
}

const PERMISSION_REFRESH_MS = 3 * 60 * 1000;
async function refreshSessionPermissions(req, force) {
  const user = currentUser(req);
  if (!user || !cfg.botToken || !cfg.guildId) return user;
  if (!force && user.permCheckedAt && Date.now() - user.permCheckedAt < PERMISSION_REFRESH_MS) return user;
  try {
    const member = await discordApi('/guilds/' + cfg.guildId + '/members/' + user.id, { headers: { Authorization: 'Bot ' + cfg.botToken } });
    const access = await getDiscordAccess(user, member);
    user.canEncrypt = access.canEncrypt;
    user.isAdmin = access.isAdmin;
    user.permCheckedAt = Date.now();
    saveSessionsToDisk();
    return user;
  } catch (e) { console.error('[WEB] permission refresh:', e.message); return user; }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { success: false, message: 'Forbidden' });
  }
  fs.stat(file, (e, s) => {
    if (e || !s.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      return fs.readFile(fallback, (er, c) => {
        if (er) return sendJson(res, 404, { success: false, message: 'Not found' });
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(c);
      });
    }
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}
function parseUpload(req) {
  return new Promise((resolve, reject) => {
    let tempDir, filePath, fields = {}, fileInfo = null, size = 0, settled = false, fileDone = null;
    const fail = e => {
      if (settled) return;
      settled = true;
      if (filePath) fs.rmSync(filePath, { force: true });
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      reject(e);
    };
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD, files: 1, fields: 10 } }); }
    catch (e) { return fail(e); }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-upload-'));
    bb.on('field', (name, val) => fields[name] = String(val).trim());
    bb.on('file', (name, stream, info) => {
      if (name !== 'file') { stream.resume(); return; }
      fileInfo = info;
      filePath = path.join(tempDir, 'input.zip');
      const out = fs.createWriteStream(filePath);
      fileDone = new Promise((ok, no) => { out.on('finish', ok); out.on('error', no); });
      stream.on('data', c => size += c.length);
      stream.on('limit', () => fail(Error('حجم الملف أكبر من الحد')));
      stream.on('error', fail);
      out.on('error', fail);
      stream.pipe(out);
    });
    bb.on('error', fail);
    bb.on('finish', async () => {
      if (settled) return;
      try {
        if (fileDone) await fileDone;
        if (!filePath || !fileInfo) throw Error('لم يتم رفع ملف');
        settled = true;
        resolve({ fields, filePath, fileInfo, size, tempDir });
      } catch (e) { fail(e); }
    });
    req.on('aborted', () => fail(Error('تم إلغاء الرفع')));
    req.pipe(bb);
  });
}

async function encryptRoute(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const sub = subscriptionInfo(user.id);
  if (!user.isAdmin) {
    if (sub.entry && !sub.active) {
      invalidateUserSessions(user.id, false);
      return sendJson(res, 403, { success: false, message: subs.inactiveReason(sub.entry) });
    }
    if (!sub.entry && !user.canEncrypt) {
      return sendJson(res, 403, { success: false, message: 'لا تملك صلاحية التشفير' });
    }
  }
  if (encryptingNow.has(user.id)) {
    return sendJson(res, 409, { success: false, message: 'عملية تشفير جارية بالفعل' });
  }
  encryptingNow.add(user.id);

  let reserved = false, committed = false;
  if (!user.isAdmin) {
    const reservation = subs.reserve(user.id);
    if (!reservation.ok) {
      encryptingNow.delete(user.id);
      invalidateUserSessions(user.id, false);
      return sendJson(res, 403, { success: false, message: reservation.message });
    }
    reserved = reservation.tracked;
  }

  if (!engine || !engine.encryptResource) {
    if (reserved) subs.release(user.id);
    encryptingNow.delete(user.id);
    return sendJson(res, 503, { success: false, message: 'محرك التشفير غير متاح' });
  }

  let upload;
  try {
    upload = await parseUpload(req);
    if (!/\.zip$/i.test(upload.fileInfo.filename)) throw Error('ارفع ملف ZIP فقط');
    const resourceName = String(upload.fields.resourceName || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const targetIp = String(upload.fields.targetIp || '').trim();
    const encryptionMode = ['target', 'full', 'none'].includes(upload.fields.encryptionMode) ? upload.fields.encryptionMode : 'target';
    if (!resourceName || !targetIp) throw Error('اسم المورد وIP مطلوبان');
    if (!isValidTarget(targetIp)) throw Error('صيغة IP غير صحيحة');
    const result = await engine.encryptResource({
      inputZipPath: upload.filePath, targetIp, resourceName, encryptionMode,
      uploader: { id: user.id, name: user.username }
    });
    if (!result || !result.script || !fs.existsSync(db.getFilePath(result.script.savedFilename))) {
      throw Error('فشل حفظ الملف المشفر');
    }
    let subscription = null;
    if (!user.isAdmin) {
      const commit = subs.commit(user.id);
      committed = true;
      if (commit.exhausted) await finalizeExhausted(user.id, commit.entry);
      subscription = subs.getStatus(user.id).info;
    }
    sendJson(res, 200, { success: true, script: publicScript(result.script), subscription });
  } catch (e) {
    console.error('[WEB] encryption:', e);
    logger.error('encrypt.route_failed', e, { userId: user.id });
    if (reserved && !committed) { try { subs.release(user.id); } catch (err) {} }
    sendJson(res, 400, { success: false, message: e.message || 'فشل التشفير' });
  } finally {
    encryptingNow.delete(user.id);
    if (upload && upload.tempDir) fs.rmSync(upload.tempDir, { recursive: true, force: true });
  }
}

async function unprotectRoute(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'فك الحماية للأدمن فقط' });
  if (encryptingNow.has(user.id)) return sendJson(res, 409, { success: false, message: 'عملية جارية بالفعل' });
  encryptingNow.add(user.id);

  if (!engine || !engine.unprotectResource) {
    encryptingNow.delete(user.id);
    return sendJson(res, 503, { success: false, message: 'محرك فك الحماية غير متاح' });
  }

  let upload;
  try {
    upload = await parseUpload(req);
    if (!/\.zip$/i.test(upload.fileInfo.filename)) throw Error('ارفع ملف ZIP فقط');
    const label = String(upload.fields.label || upload.fileInfo.filename.replace(/\.zip$/i, '')).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'resource';
    const result = await engine.unprotectResource({
      inputZipPath: upload.filePath, label,
      uploader: { id: user.id, name: user.username }
    });
    if (!result || !result.script || !fs.existsSync(db.getFilePath(result.script.savedFilename))) {
      throw Error('فشل حفظ الملف');
    }
    sendJson(res, 200, { success: true, script: publicScript(result.script), report: result.report });
  } catch (e) {
    console.error('[WEB] unprotect:', e);
    logger.error('unprotect.route_failed', e, { userId: user.id });
    sendJson(res, 400, { success: false, message: e.message || 'فشل فك الحماية' });
  } finally {
    encryptingNow.delete(user.id);
    if (upload && upload.tempDir) fs.rmSync(upload.tempDir, { recursive: true, force: true });
  }
}
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      const p = u.pathname;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      if (p === '/api/auth/login') {
        if (rateLimited(req, res, 'login', 20, 60000)) return;
        if (!cfg.clientId || !cfg.redirectUri || !cfg.guildId) {
          return sendJson(res, 500, { success: false, message: 'إعدادات OAuth ناقصة' });
        }
        res.writeHead(302, { Location: loginUrl() });
        return res.end();
      }

      if (p === '/api/auth/callback') {
        if (rateLimited(req, res, 'callback', 20, 60000)) return;
        return await oauthCallback(u.searchParams.get('code'), res);
      }

      if (p === '/api/auth/me') {
        const user = await refreshSessionPermissions(req, false);
        let subscription = null;
        if (user) {
          const sub = subscriptionInfo(user.id);
          subscription = sub.info;
          if (sub.entry && !user.isAdmin && user.canEncrypt !== sub.active) {
            user.canEncrypt = sub.active;
            user.permCheckedAt = Date.now();
            saveSessionsToDisk();
          }
        }
        return sendJson(res, 200, {
          success: true, user, subscription,
          oauthConfigured: !!(cfg.clientId && cfg.clientSecret && cfg.redirectUri && cfg.guildId),
          permissionRoleConfigured: !!cfg.roleId
        });
      }

      if (p === '/api/subscription') {
        const user = requireUser(req, res);
        if (!user) return;
        return sendJson(res, 200, { success: true, subscription: subscriptionInfo(user.id).info });
      }

      if (p === '/api/auth/logout') {
        const raw = cookieValue(req, 'ravx_session');
        if (raw) { sessions.delete(raw.split('.')[0]); saveSessionsToDisk(); }
        res.setHeader('Set-Cookie', 'ravx_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
        return sendJson(res, 200, { success: true });
      }

      if (p === '/api/health') {
        return sendJson(res, 200, { success: true, online: true, engine: !!engine, maxUploadBytes: MAX_UPLOAD });
      }

      if (p === '/api/admin/scripts' && req.method === 'GET') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'للأدمن فقط' });
        return sendJson(res, 200, { success: true, scripts: db.readDatabase() });
      }

      if (p.startsWith('/api/admin/revoke/') && req.method === 'POST') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'للأدمن فقط' });
        const code = safeCode(p.slice('/api/admin/revoke/'.length));
        if (!code) return sendJson(res, 400, { success: false, message: 'كود غير صحيح' });
        const entry = db.findByCode(code);
        if (!entry) return sendJson(res, 404, { success: false, message: 'غير موجود' });
        db.updateTargetIp(code, '__REVOKED__');
        try {
          const all = db.readDatabase();
          const idx = all.findIndex(s => s.code === code.toUpperCase());
          if (idx >= 0) {
            all[idx].revokedAt = new Date().toISOString();
            all[idx].revokedBy = user.id;
            db.writeDatabase(all);
          }
        } catch (e) {}
        logger.warn('license.revoked', { code, byAdminId: user.id });
        return sendJson(res, 200, { success: true, message: 'تم إلغاء الترخيص' });
      }

      if (p.startsWith('/api/admin/unrevoke/') && req.method === 'POST') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'للأدمن فقط' });
        const code = safeCode(p.slice('/api/admin/unrevoke/'.length));
        if (!code) return sendJson(res, 400, { success: false, message: 'كود غير صحيح' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (e) {}
        const newIp = String(parsed.targetIp || '').trim();
        if (!isValidTarget(newIp)) return sendJson(res, 400, { success: false, message: 'IP غير صحيح' });
        const entry = db.updateTargetIp(code, newIp);
        if (!entry) return sendJson(res, 404, { success: false, message: 'غير موجود' });
        try {
          const all = db.readDatabase();
          const idx = all.findIndex(s => s.code === code.toUpperCase());
          if (idx >= 0) {
            delete all[idx].revokedAt;
            delete all[idx].revokedBy;
            db.writeDatabase(all);
          }
        } catch (e) {}
        logger.info('license.unrevoked', { code, newIp, byAdminId: user.id });
        return sendJson(res, 200, { success: true, message: 'تم استرجاع الترخيص' });
      }

      if (p.startsWith('/api/admin/delete/') && req.method === 'POST') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'للأدمن فقط' });
        const code = safeCode(p.slice('/api/admin/delete/'.length));
        if (!code) return sendJson(res, 400, { success: false, message: 'كود غير صحيح' });
        const entry = db.findByCode(code);
        if (!entry) return sendJson(res, 404, { success: false, message: 'غير موجود' });
        const fp = db.getFilePath(entry.savedFilename);
        if (fp && fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
        db.deleteScript(code);
        logger.warn('script.deleted', { code, byAdminId: user.id });
        return sendJson(res, 200, { success: true, message: 'تم الحذف' });
      }

      if (p.startsWith('/api/license/')) {
        if (rateLimited(req, res, 'license', 60, 60000)) return;
        const code = safeCode(p.slice('/api/license/'.length));
        if (!code) return sendJson(res, 400, { success: false, message: 'كود مطلوب' });
        const s = db.findByCode(code);
        const socketIp = clientIp(req);
        const reportedIp = String(u.searchParams.get('ip') || '').trim();
        const effectiveIp = isValidTargetToken(reportedIp) ? reportedIp : socketIp;
        if (s && s.revokedAt) {
          logger.warn('license.denied', { code, socketIp, reportedIp, reason: 'revoked' });
          return sendJson(res, 200, { success: true, authorized: false, ip: effectiveIp });
        }
        if (!s || !s.targetIp || s.targetIp === '__REVOKED__') {
          logger.warn('license.denied', { code, socketIp, reportedIp, reason: 'unknown_code' });
          return sendJson(res, 200, { success: true, authorized: false, ip: effectiveIp });
        }
        const authorized = matchesTargetIp(effectiveIp, s.targetIp);
        if (!authorized) {
          logger.warn('license.denied', {
            code, socketIp, reportedIp, checkedIp: effectiveIp,
            licensedIp: s.targetIp, resourceName: s.resourceName
          });
        }
        return sendJson(res, 200, { success: true, authorized, ip: effectiveIp, resourceName: s.resourceName });
      }

      if (p.startsWith('/api/script/') && p.endsWith('/ip') && req.method === 'POST') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'للأدمن فقط' });
        if (rateLimited(req, res, 'set-ip', 20, 60000)) return;
        const segments = p.split('/');
        const code = safeCode(segments[3]);
        if (!code) return sendJson(res, 400, { success: false, message: 'كود مطلوب' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (e) {}
        const newIp = String(parsed.targetIp || '').trim();
        if (!isValidTarget(newIp)) return sendJson(res, 400, { success: false, message: 'IP غير صحيح' });
        const updated = db.updateTargetIp(code, newIp);
        if (!updated) return sendJson(res, 404, { success: false, message: 'غير موجود' });
        logger.info('license.ip_changed', { code, newIp, byAdminId: user.id });
        return sendJson(res, 200, { success: true, script: publicScript(updated) });
      }

      if (p === '/api/script' || p.startsWith('/api/script/')) {
        if (rateLimited(req, res, 'script', 60, 60000)) return;
        const code = safeCode(u.searchParams.get('code') || p.split('/')[3]);
        if (!code) return sendJson(res, 400, { success: false, message: 'كود مطلوب' });
        const s = db.findByCode(code);
        if (!s) return sendJson(res, 404, { success: false, message: 'غير موجود' });
        return sendJson(res, 200, { success: true, script: publicScript(s) });
      }

      if (p.startsWith('/api/download/')) {
        if (rateLimited(req, res, 'download', 30, 60000)) return;
        const code = safeCode(p.slice('/api/download/'.length));
        const s = code && db.findByCode(code);
        if (!s) return sendJson(res, 404, { success: false, message: 'غير موجود' });
        const fp = db.getFilePath
