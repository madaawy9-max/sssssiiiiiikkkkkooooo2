const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Busboy = require('busboy');
const db = require('../database/db');
const subs = require('../shared/subscriptions');

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
try { engine = require(path.join(__dirname, '../engine/bot-engine')); } catch (e) { console.error('[WEB] engine load failed:', e.message); }

// ==================== الجلسات — محفوظة على القرص لا في الذاكرة فقط ====================
// كانت الجلسات تُحفظ في Map بالذاكرة فقط؛ أي إعادة تشغيل للسيرفر (نشر جديد، سقوط
// العملية، توقف مؤقت من الاستضافة) كانت تمسح كل الجلسات فيظهر المستخدم "مسجّل خروج"
// فجأة رغم أن الكوكي نفسه ما زال صالحاً. الآن نحفظها في storage/sessions.json ونحمّلها
// عند الإقلاع، فتبقى الجلسة شغالة عبر عمليات إعادة التشغيل حتى تنتهي مدتها فعلياً.
const STORAGE_DIR = path.resolve(__dirname, '../../storage');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');
const sessions = new Map();

function ensureStorageDir() { if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true }); }

function loadSessionsFromDisk() {
  ensureStorageDir();
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    for (const [id, session] of Object.entries(raw)) {
      if (session && session.expires > now) sessions.set(id, session);
    }
  } catch (e) { /* لا يوجد ملف بعد، أو تالف — نبدأ بجلسات فارغة بأمان */ }
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

// تنظيف دوري للجلسات المنتهية من الذاكرة والقرص، كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of sessions.entries()) {
    if (session.expires < now) { sessions.delete(id); changed = true; }
  }
  if (changed) saveSessionsToDisk();
}, 10 * 60 * 1000).unref();

// ==================== حدّ معدل الطلبات (Rate Limit) ====================
// حماية بسيطة بدون اعتماديات خارجية: تمنع إغراق نقاط النهاية الحساسة (تسجيل
// الدخول، التشفير، التحميل، البحث عن كود) بعدد كبير من الطلبات من نفس الـIP.
const rateBuckets = new Map();
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
function rateLimited(req, res, key, limit, windowMs) {
  const ip = clientIp(req);
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    sendJson(res, 429, { success: false, message: 'طلبات كثيرة جداً، حاول بعد قليل.' });
    return true;
  }
  return false;
}
// تنظيف دوري لسلال المعدل حتى لا تتراكم في الذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets.entries()) if (b.resetAt < now) rateBuckets.delete(k);
}, 5 * 60 * 1000).unref();

// ==================== الاشتراك ورصيد التشفير (مشترك مع البوت) ====================
// كل القرارات تُقرأ لحظياً من محرك الاشتراكات (permissions.json) لا من الجلسة.
// قبل كذا كان الموقع يعتمد على user.canEncrypt المخزّن في الجلسة والمحدَّث كل 3
// دقائق، فيقدر العضو يشفّر أكثر من مرة خلال هذه الفجوة بعد ما ينتهي رصيده.
function subscriptionInfo(userId) { return subs.getStatus(userId); }

// سحب رتبة الاشتراك من Discord مباشرة من الموقع (لا ننتظر دورة البوت).
async function removeRoleNow(userId, entry) {
  const guildId = entry?.guildId || cfg.guildId;
  const roleId = entry?.roleId || cfg.roleId;
  if (!cfg.botToken || !guildId || !roleId) return false;
  try {
    await discordApi(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'DELETE', headers: { Authorization: `Bot ${cfg.botToken}` } });
    return true;
  } catch (e) {
    console.error('[WEB] role removal failed:', e.message);
    return false;
  }
}

// إبطال صلاحية التشفير في كل جلسات هذا المستخدم فوراً — عشان الواجهة تتحدث
// لحظة انتهاء الرصيد بدل ما تنتظر دورة التحديث (هذا سبب "الموقع يتأخر").
function invalidateUserSessions(userId, canEncrypt = false) {
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

// بعد نفاد الرصيد: قفل السجل (تم داخل subs.commit) + سحب الرتبة + إبطال الجلسات.
async function finalizeExhausted(userId, entry) {
  const ok = await removeRoleNow(userId, entry);
  if (ok) subs.markRoleRemoved(userId);
  invalidateUserSessions(userId, false);
}

// يمنع نفس المستخدم من إرسال أكثر من طلب تشفير بنفس اللحظة (يحمي رصيد الباقات
// المحدودة من استهلاك مضاعف لو ضغط المستخدم الزر مرتين بسرعة).
const encryptingNow = new Set();

// التحقق من صيغة IP/دومين السيرفر قبل استخدامه داخل محرك التشفير — يمنع حقن
// قيم غريبة (اقتباسات، فواصل منقوطة، أسطر جديدة) داخل ملفات Lua الناتجة.
function isValidTarget(value) {
  const v = String(value || '').trim();
  if (!v || v.length > 253) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/.test(v);
}

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function securityHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); }
function sendJson(res, status, data) { if (res.headersSent) return; securityHeaders(res); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function safeCode(v) { const s = String(v || '').trim(); return s && s.length <= 80 && /^[A-Za-z0-9_-]+$/.test(s) ? s : null; }
function publicScript(s) { return { code: s.code, title: s.title, originalFilename: s.originalFilename, fileSize: s.fileSize, fileExtension: s.fileExtension, targetIp: s.targetIp, resourceName: s.resourceName, encryptionMode: s.encryptionMode, uploader: s.uploader || s.uploaderName, downloads: s.downloads || 0, createdAt: s.createdAt }; }
function cookieValue(req, name) { const hit = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '=')); return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null; }
function sign(value) { return crypto.createHmac('sha256', cfg.sessionSecret).update(value).digest('hex'); }
function setSession(res, user) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { user, expires: Date.now() + 7 * 864e5 });
  saveSessionsToDisk();
  res.setHeader('Set-Cookie', `ravx_session=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
}
function currentUser(req) {
  const raw = cookieValue(req, 'ravx_session');
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  const session = sessions.get(id);
  if (!id || sig !== sign(id) || !session || session.expires < Date.now()) { if (id) { sessions.delete(id); saveSessionsToDisk(); } return null; }
  return session.user;
}
function requireUser(req, res, permission = false) { const user = currentUser(req); if (!user) { sendJson(res, 401, { success: false, message: 'تسجيل الدخول عبر Discord مطلوب' }); return null; } if (permission && !user.canEncrypt) { sendJson(res, 403, { success: false, message: 'لا تملك صلاحية التشفير في Discord' }); return null; } return user; }
async function discordApi(endpoint, options = {}) { const r = await fetch('https://discord.com/api/v10' + endpoint, options); const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.message || `Discord ${r.status}`); return d; }
async function getDiscordAccess(user, member) {
  const roles = member.roles || [];
  const adminById = cfg.adminIds.has(user.id) || user.id === process.env.OWNER_DISCORD_ID;
  if (adminById) return { canEncrypt: true, isAdmin: true };
  // لو عنده سجل اشتراك في النظام، هو المرجع (لا ننتظر مزامنة الرتبة من Discord):
  // يفعّل كود من الديسكورد → يقدر يشفّر من الموقع فوراً، وينتهي رصيده → يُمنع فوراً.
  const sub = subs.getStatus(user.id);
  if (sub.entry) return { canEncrypt: sub.active, isAdmin: false };
  if (!cfg.botToken || !cfg.guildId) return { canEncrypt: !!(cfg.roleId && roles.includes(cfg.roleId)), isAdmin: false };
  try {
    const guildMember = await discordApi(`/guilds/${cfg.guildId}/members/${user.id}`, { headers: { Authorization: `Bot ${cfg.botToken}` } });
    const guildRoles = await discordApi(`/guilds/${cfg.guildId}/roles`, { headers: { Authorization: `Bot ${cfg.botToken}` } });
    // GET /guilds/{guild}/members/{user} لا يعيد permissions عادةً؛
    // لذلك نحسبها من صلاحيات رتب العضو، مع صلاحيات everyone الأساسية.
    const memberRoleIds = new Set([cfg.guildId, ...(guildMember.roles || [])]);
    let permissions = 0n;
    for (const role of guildRoles) {
      if (memberRoleIds.has(role.id)) permissions |= BigInt(role.permissions || '0');
    }
    const administrator = (permissions & 0x8n) === 0x8n;
    const roleAllowed = !!cfg.roleId && (guildMember.roles || []).includes(cfg.roleId);
    return { canEncrypt: administrator || roleAllowed, isAdmin: administrator };
  } catch (e) { console.error('[WEB] Discord permission check:', e.message); return { canEncrypt: !!(cfg.roleId && roles.includes(cfg.roleId)), isAdmin: false }; }
}
function loginUrl() { const q = new URLSearchParams({ client_id: cfg.clientId || '', redirect_uri: cfg.redirectUri || '', response_type: 'code', scope: 'identify guilds.members.read' }); return 'https://discord.com/oauth2/authorize?' + q; }
async function oauthCallback(code, res) {
  if (!code) throw Error('رمز تسجيل الدخول غير موجود');
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri || !cfg.guildId) throw Error('إعدادات Discord OAuth غير مكتملة');
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri });
  const token = await discordApi('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const user = await discordApi('/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
  const member = await discordApi(`/users/@me/guilds/${cfg.guildId}/member`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  const access = await getDiscordAccess(user, member);
  setSession(res, { id: user.id, username: user.username, avatar: user.avatar, canEncrypt: access.canEncrypt, isAdmin: access.isAdmin, permCheckedAt: Date.now() });
  res.writeHead(302, { Location: '/' });
  res.end();
}
// كنا نعيد التحقق من صلاحيات Discord (نداءين لـ API) في كل تحميل صفحة، وهذا
// يسبب "تعليق الصفحة ثم رجوعها" لو تأخر رد Discord أو حصل Rate Limit مؤقت.
// الآن نخزّن آخر وقت تحقق (permCheckedAt) ونكتفي بالتحقق الفعلي كل REFRESH_MS
// فقط، بينما بقية الطلبات ترجع فوراً من الجلسة المخزّنة — يبقى التحديث دورياً
// (خلال دقائق) لكن بدون ما يعلّق كل تنقّل بين الصفحات.
const PERMISSION_REFRESH_MS = 3 * 60 * 1000;
async function refreshSessionPermissions(req, force = false) {
  const user = currentUser(req);
  if (!user || !cfg.botToken || !cfg.guildId) return user;
  if (!force && user.permCheckedAt && Date.now() - user.permCheckedAt < PERMISSION_REFRESH_MS) return user;
  try {
    const member = await discordApi(`/guilds/${cfg.guildId}/members/${user.id}`, { headers: { Authorization: `Bot ${cfg.botToken}` } });
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
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { success: false, message: 'Forbidden' });
  fs.stat(file, (e, s) => {
    if (e || !s.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      return fs.readFile(fallback, (er, c) => { if (er) return sendJson(res, 404, { success: false, message: 'Page not found' }); securityHeaders(res); res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] }); res.end(c); });
    }
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}
function parseUpload(req) {
  return new Promise((resolve, reject) => {
    let tempDir, filePath, fields = {}, fileInfo = null, size = 0, settled = false, fileDone = null;
    const fail = e => { if (settled) return; settled = true; if (filePath) fs.rmSync(filePath, { force: true }); if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); reject(e); };
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD, files: 1, fields: 10 } }); } catch (e) { return fail(e); }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-upload-'));
    bb.on('field', (name, val) => fields[name] = String(val).trim());
    bb.on('file', (name, stream, info) => {
      if (name !== 'file') { stream.resume(); return; }
      fileInfo = info;
      filePath = path.join(tempDir, 'input.zip');
      const out = fs.createWriteStream(filePath);
      fileDone = new Promise((ok, no) => { out.on('finish', ok); out.on('error', no); });
      stream.on('data', c => size += c.length);
      stream.on('limit', () => fail(Error('حجم الملف أكبر من الحد المسموح')));
      stream.on('error', fail);
      out.on('error', fail);
      stream.pipe(out);
    });
    bb.on('error', fail);
    bb.on('finish', async () => { if (settled) return; try { if (fileDone) await fileDone; if (!filePath || !fileInfo) throw Error('لم يتم رفع ملف'); settled = true; resolve({ fields, filePath, fileInfo, size, tempDir }); } catch (e) { fail(e); } });
    req.on('aborted', () => fail(Error('تم إلغاء الرفع')));
    req.pipe(bb);
  });
}
async function encryptRoute(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  // التحقق الحيّ: الأدمن مسموح دائماً، ومن عنده سجل اشتراك يُحكم عليه من السجل
  // نفسه لحظياً، ومن ما عنده سجل (رتبة يدوية) يُحكم عليه من صلاحية الجلسة.
  const sub = subscriptionInfo(user.id);
  if (!user.isAdmin) {
    if (sub.entry && !sub.active) {
      invalidateUserSessions(user.id, false);
      return sendJson(res, 403, { success: false, message: subs.inactiveReason(sub.entry) });
    }
    if (!sub.entry && !user.canEncrypt) {
      return sendJson(res, 403, { success: false, message: 'لا تملك صلاحية التشفير. فعّل كود اشتراك أولاً.' });
    }
  }

  if (encryptingNow.has(user.id)) return sendJson(res, 409, { success: false, message: 'في عملية تشفير جارية بالفعل، انتظر انتهاءها.' });
  encryptingNow.add(user.id);

  // 🔒 حجز العملية من الرصيد قبل بدء المعالجة — نفس القفل الذي يستعمله البوت،
  // فلا يمكن استهلاك عملية التجربة الواحدة مرتين (موقع + ديسكورد بنفس اللحظة).
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

  if (!engine?.encryptResource) {
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
    if (!resourceName || !targetIp) throw Error('اسم المورد وIP السيرفر مطلوبان');
    if (!isValidTarget(targetIp)) throw Error('صيغة IP/دومين السيرفر غير صحيحة');
    const result = await engine.encryptResource({ inputZipPath: upload.filePath, targetIp, resourceName, encryptionMode, uploader: { id: user.id, name: user.username } });
    if (!result?.script || !fs.existsSync(db.getFilePath(result.script.savedFilename))) throw Error('فشل حفظ الملف المشفر');

    // تأكيد الاستهلاك فور نجاح التشفير، ثم سحب الرتبة وإبطال الجلسة فوراً لو نفد الرصيد
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
    // فشل التشفير → إرجاع الحجز، العميل ما يخسر عملية من باقته
    if (reserved && !committed) { try { subs.release(user.id); } catch (err) {} }
    sendJson(res, 400, { success: false, message: e.message || 'فشل التشفير' });
  } finally {
    encryptingNow.delete(user.id);
    if (upload?.tempDir) fs.rmSync(upload.tempDir, { recursive: true, force: true });
  }
}
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`), p = u.pathname;
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }

      if (p === '/api/auth/login') {
        if (rateLimited(req, res, 'login', 20, 60 * 1000)) return;
        if (!cfg.clientId || !cfg.redirectUri || !cfg.guildId) return sendJson(res, 500, { success: false, message: 'إعدادات Discord OAuth ناقصة: DISCORD_CLIENT_ID وDISCORD_REDIRECT_URI وDISCORD_GUILD_ID مطلوبة' });
        res.writeHead(302, { Location: loginUrl() });
        return res.end();
      }
      if (p === '/api/auth/callback') {
        if (rateLimited(req, res, 'callback', 20, 60 * 1000)) return;
        return await oauthCallback(u.searchParams.get('code'), res);
      }
      if (p === '/api/auth/me') {
        const user = await refreshSessionPermissions(req);
        let subscription = null;
        if (user) {
          const sub = subscriptionInfo(user.id);
          subscription = sub.info;
          // مصدر الحقيقة للتشفير هو سجل الاشتراك، فنصحّح الجلسة فوراً عند أي تغيّر
          if (sub.entry && !user.isAdmin && user.canEncrypt !== sub.active) {
            user.canEncrypt = sub.active;
            user.permCheckedAt = Date.now();
            saveSessionsToDisk();
          }
        }
        return sendJson(res, 200, { success: true, user, subscription, oauthConfigured: !!(cfg.clientId && cfg.clientSecret && cfg.redirectUri && cfg.guildId), permissionRoleConfigured: !!cfg.roleId });
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
      if (p === '/api/health') return sendJson(res, 200, { success: true, online: true, engine: !!engine, maxUploadBytes: MAX_UPLOAD });
      if (p === '/api/script' || p.startsWith('/api/script/')) {
        if (rateLimited(req, res, 'script', 60, 60 * 1000)) return;
        const code = safeCode(u.searchParams.get('code') || p.split('/')[3]);
        if (!code) return sendJson(res, 400, { success: false, message: 'كود السكربت مطلوب' });
        const s = db.findByCode(code);
        if (!s) return sendJson(res, 404, { success: false, message: 'لم يتم العثور على السكربت' });
        return sendJson(res, 200, { success: true, script: publicScript(s) });
      }
      if (p.startsWith('/api/download/')) {
        if (rateLimited(req, res, 'download', 30, 60 * 1000)) return;
        const code = safeCode(p.slice('/api/download/'.length)), s = code && db.findByCode(code);
        if (!s) return sendJson(res, 404, { success: false, message: 'السكربت غير موجود' });
        const fp = db.getFilePath(s.savedFilename);
        if (!fs.existsSync(fp)) return sendJson(res, 404, { success: false, message: 'الملف غير موجود' });
        db.incrementDownload(code);
        const name = String(s.originalFilename || `${code}.zip`).replace(/[\r\n"\\]/g, '_'), st = fs.statSync(fp);
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${name}"` });
        return fs.createReadStream(fp).pipe(res);
      }
      if (p === '/api/stats') {
        const user = requireUser(req, res);
        if (!user) return;
        if (!user.isAdmin) return sendJson(res, 403, { success: false, message: 'لوحة الإدارة للأدمن فقط' });
        return sendJson(res, 200, { success: true, ...db.getStats() });
      }
      if (p === '/api/encrypt' && req.method === 'POST') {
        if (rateLimited(req, res, 'encrypt', 10, 60 * 1000)) return;
        return encryptRoute(req, res);
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { success: false, message: 'API Route Not Found' });
      serveStatic(req, res, p);
    } catch (e) {
      console.error('[WEB]', e);
      sendJson(res, 500, { success: false, message: 'خطأ داخلي في الخادم' });
    }
  });
}
module.exports = { createServer };
if (require.main === module) createServer().listen(Number(process.env.PORT || 3000), () => console.log('RAVX STORY server online'));
