/* ============================================================================
 * RAVX — محرك الاشتراكات المشترك (مصدر الحقيقة الوحيد)
 * ============================================================================
 * قبل هذا الملف كان عندنا نظامان منفصلان:
 *   - البوت (index.js) يحتفظ بنسخة من permissions.json في الذاكرة ويكتبها كاملة.
 *   - الموقع (src/server/server.js) يقرأ ويكتب نفس الملف بشكل مستقل.
 * النتيجة: أي كتابة من طرف تمسح تحديث الطرف الثاني (مثلاً الموقع يزيد
 * usedEncrypts، ثم البوت يحفظ نسخته القديمة من الذاكرة فيرجع الرصيد كأن شيئاً
 * لم يكن) — وهذا هو السبب المباشر لاستخدام كود "تجربة" أكثر من مرة.
 *
 * الآن: كل قراءة تتم من القرص لحظياً، وكل تعديل يتم داخل قفل ملفات مشترك بين
 * كل العمليات (bot + web) مع كتابة ذرّية (tmp + rename) حتى لا يتلف الملف.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// ==================== مكان التخزين ====================
// ⚠️ كانت هذه الملفات في جذر المشروع مباشرة — وهو نفس مجلد الكود المرفوع
// لـ git. أي إعادة نشر (git push) أو إعادة بناء الحاوية (شائع على استضافات
// كـ Render عند إعادة التشغيل التلقائي) يعيد جذر المشروع لحالة الصورة/المستودع
// المبني منها، فيمحو أي تعديل تم أثناء التشغيل (مثل تعليم كود "مستخدم"،
// أو استهلاك رصيد اشتراك) — وهذا بالضبط سبب أن الأكواد ترجع تشتغل بعد
// إعادة تشغيل البوت. `storage/` هو المجلد الوحيد المُستثنى من git (مُدرَج في
// .gitignore) والمُثبَت فعلياً أنه يبقى بعد إعادة التشغيل (يستخدمه الموقع
// أصلاً لجلسات storage/sessions.json)، فنقلنا كل ملفات الحالة القابلة
// للتغيير إليه.
const STORAGE_DIR = path.join(ROOT, 'storage');
const PERMISSIONS_FILE = path.join(STORAGE_DIR, 'permissions.json');
const CODES_FILE = path.join(STORAGE_DIR, 'permission_codes.json');
const HISTORY_FILE = path.join(STORAGE_DIR, 'subscription_history.json');
const LOCK_DIR = path.join(STORAGE_DIR, '.ravx-perm.lock');

// ترحيل تلقائي لمرة واحدة: لو الملفات القديمة موجودة في الجذر (من نسخة سابقة)
// وما فيه نسخة في storage/ بعد، ننقلها بدل ما نبدأ من الصفر ونخسر الأكواد
// المستهلكة والاشتراكات الحالية.
function migrateLegacyFile(legacyName, targetFile) {
    const legacyPath = path.join(ROOT, legacyName);
    try {
        if (!fs.existsSync(targetFile) && fs.existsSync(legacyPath)) {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
            fs.copyFileSync(legacyPath, targetFile);
            console.log(`[RAVX] تم ترحيل ${legacyName} إلى storage/ (تخزين دائم يبقى بعد إعادة التشغيل).`);
        }
    } catch (e) { console.error(`[RAVX] فشل ترحيل ${legacyName}:`, e.message); }
}

fs.mkdirSync(STORAGE_DIR, { recursive: true });
migrateLegacyFile('permissions.json', PERMISSIONS_FILE);
migrateLegacyFile('permission_codes.json', CODES_FILE);
migrateLegacyFile('subscription_history.json', HISTORY_FILE);

// ==================== حدود الباقات ====================
// المصدر الوحيد لمدة وسقف كل باقة. لا نعتمد على حقل days المخزّن مع الكود
// (كان 0 لباقة التجربة فينتهي الاشتراك فوراً لحظة تفعيله).
const PLAN_LIMITS = {
    single_script:      { days: 3,  maxEncrypts: 1,    label: 'تجربة' },
    unlimited_24h:      { days: 1,  maxEncrypts: null, label: 'يومي' },
    unlimited_7d:       { days: 7,  maxEncrypts: null, label: 'أسبوعي' },
    unlimited_support:  { days: 30, maxEncrypts: null, label: 'شهري' },
    lifetime:           { days: -1, maxEncrypts: null, label: 'مدى الحياة' }
};

// ==================== قفل بين العمليات ====================
// mkdir ذرّي على كل أنظمة الملفات: أول عملية تنجح، الباقي ينتظر.
// مع كشف القفل الميت (لو سقطت العملية أثناء التعديل) بعد 10 ثوانٍ.
const LOCK_STALE_MS = 10_000;

function acquireLock() {
    const start = Date.now();
    for (;;) {
        try {
            fs.mkdirSync(LOCK_DIR);
            try { fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid)); } catch (e) {}
            return true;
        } catch (e) {
            if (e.code !== 'EEXIST') return false;
            try {
                const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
                if (age > LOCK_STALE_MS) { releaseLock(); continue; }
            } catch (e2) { continue; }
            if (Date.now() - start > 8000) { releaseLock(); continue; } // لا نعلّق الطلب للأبد
            sleepSync(15);
        }
    }
}

function releaseLock() {
    try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch (e) {}
}

function sleepSync(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* انتظار قصير جداً (ملي ثانية) */ }
}

// كل تعديل يمر من هنا: قفل → قراءة طازجة → تعديل → كتابة ذرّية → فك القفل
function withLock(fn) {
    acquireLock();
    try {
        return fn();
    } finally {
        releaseLock();
    }
}

// ==================== قراءة/كتابة ذرّية ====================
function readJson(file, fallback) {
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw || 'null');
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 4), 'utf8');
    fs.renameSync(tmp, file);
}

function readPermissions() { return readJson(PERMISSIONS_FILE, {}); }
function readCodes() { return readJson(CODES_FILE, {}); }

function appendHistory(entry) {
    try {
        const history = readJson(HISTORY_FILE, []);
        const list = Array.isArray(history) ? history : [];
        list.push({ ...entry, archivedAt: Date.now() });
        writeJsonAtomic(HISTORY_FILE, list.slice(-5000));
    } catch (e) { /* السجل التاريخي غير حرج */ }
}

// ==================== حالة الاشتراك ====================
// اشتراك "فعّال" = غير مستهلك + غير منتهٍ + فيه رصيد تشفير متبقٍ.
// أي شيء غير ذلك يعتبر منتهياً، فيُسمح للعضو فوراً بتفعيل كود جديد
// (هذا بالضبط ما كان يمنع استخدام كود تجربة ثانٍ بعد استهلاك الأول).
function isPermanent(entry) {
    return entry.expiresAt === -1 || entry.expiresAt === null || entry.expiresAt === undefined;
}

function remainingEncrypts(entry) {
    if (!entry || !entry.maxEncrypts) return null; // null = غير محدود
    const used = (entry.usedEncrypts || 0) + (entry.pending || 0);
    return Math.max(0, entry.maxEncrypts - used);
}

function isActive(entry) {
    if (!entry) return false;
    if (entry.exhausted) return false;
    if (entry.revoked) return false;
    const left = remainingEncrypts(entry);
    if (left !== null && left <= 0) return false;
    if (isPermanent(entry)) return true;
    return Date.now() < entry.expiresAt;
}

function describe(entry) {
    if (!entry) return null;
    return {
        plan: entry.plan || 'صلاحية إدارية',
        planType: entry.planType || null,
        code: entry.code || null,
        roleId: entry.roleId || null,
        guildId: entry.guildId || null,
        expiresAt: isPermanent(entry) ? -1 : entry.expiresAt,
        maxEncrypts: entry.maxEncrypts || null,
        usedEncrypts: entry.usedEncrypts || 0,
        remaining: remainingEncrypts(entry),
        exhausted: !!entry.exhausted,
        active: isActive(entry),
        grantedAt: entry.grantedAt || null
    };
}

function getStatus(userId) {
    const entry = readPermissions()[String(userId)];
    return { active: isActive(entry), entry: entry || null, info: describe(entry) };
}

function inactiveReason(entry) {
    if (!entry) return 'لا يوجد اشتراك مفعّل.';
    if (entry.exhausted || (remainingEncrypts(entry) !== null && remainingEncrypts(entry) <= 0)) {
        return 'استهلكت كامل رصيد التشفير في باقتك (عملية التجربة الواحدة). فعّل كوداً جديداً للمتابعة.';
    }
    if (!isPermanent(entry) && Date.now() >= entry.expiresAt) {
        return 'انتهت مدة اشتراكك. فعّل كوداً جديداً للمتابعة.';
    }
    return 'اشتراكك غير فعّال حالياً.';
}

// ==================== تفعيل كود ====================
function redeem(code, userId, { guildId, roleId, source } = {}) {
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        const current = perms[uid];

        if (isActive(current)) {
            const info = describe(current);
            const when = info.expiresAt === -1
                ? '♾️ مدى الحياة'
                : `<t:${Math.floor(info.expiresAt / 1000)}:R>`;
            const credit = info.remaining === null ? '' : `\nالرصيد المتبقي: **${info.remaining}** عملية تشفير.`;
            return {
                ok: false,
                message: `⚠️ لديك اشتراك **${info.plan}** فعّال بالفعل (ينتهي: ${when}).${credit}\nاستهلك اشتراكك الحالي أو انتظر انتهاءه ثم فعّل الكود الجديد.`
            };
        }

        const codes = readCodes();
        const key = String(code || '').trim().toUpperCase();
        const item = codes[key];
        if (!item) return { ok: false, message: 'الكود غير صحيح.' };
        if (item.used) return { ok: false, message: 'هذا الكود مستخدم مسبقاً ولا يمكن استخدامه مرة أخرى.' };

        const limits = PLAN_LIMITS[item.type] || { days: Number(item.days) || 0, maxEncrypts: null };
        const expiresAt = limits.days === -1 ? -1 : Date.now() + limits.days * 24 * 60 * 60 * 1000;

        // نوسم الكود مستخدماً داخل نفس القفل — يمنع أي سباق بين الموقع والديسكورد
        item.used = true;
        item.usedBy = uid;
        item.usedAt = Date.now();
        writeJsonAtomic(CODES_FILE, codes);

        // نؤرشف الاشتراك القديم (المنتهي/المستهلك) بدل تركه يشوّش على الجديد
        if (current) appendHistory({ userId: uid, ...current });

        const entry = {
            roleId: roleId || current?.roleId || null,
            guildId: guildId || current?.guildId || null,
            plan: item.plan,
            planType: item.type,
            code: key,
            expiresAt,
            maxEncrypts: limits.maxEncrypts,
            usedEncrypts: 0,
            pending: 0,
            exhausted: false,
            revoked: false,
            roleRemoved: false,
            grantedAt: Date.now(),
            grantedBy: source || 'STORE_CODE'
        };
        perms[uid] = entry;
        writeJsonAtomic(PERMISSIONS_FILE, perms);

        return {
            ok: true,
            code: key,
            plan: item.plan,
            planType: item.type,
            days: limits.days,
            maxEncrypts: limits.maxEncrypts,
            expiresAt,
            entry
        };
    });
}

// ==================== منح إداري ====================
function grantManual(userId, { roleId, guildId, days, grantedBy }) {
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        if (perms[uid]) appendHistory({ userId: uid, ...perms[uid] });
        const expiresAt = (days === null || days === undefined || days === -1)
            ? -1
            : Date.now() + Number(days) * 24 * 60 * 60 * 1000;
        perms[uid] = {
            roleId, guildId,
            plan: 'صلاحية إدارية',
            planType: 'admin_grant',
            code: null,
            expiresAt,
            maxEncrypts: null,
            usedEncrypts: 0,
            pending: 0,
            exhausted: false,
            revoked: false,
            roleRemoved: false,
            grantedAt: Date.now(),
            grantedBy: grantedBy || 'ADMIN'
        };
        writeJsonAtomic(PERMISSIONS_FILE, perms);
        return perms[uid];
    });
}

// ==================== حجز/تأكيد/إلغاء رصيد التشفير ====================
// الحجز قبل بدء المعالجة يمنع: ضغطتين متتاليتين، طلب من الموقع + طلب من الديسكورد
// بنفس اللحظة، أو عمليتين متوازيتين تستهلكان نفس العملية الواحدة.
function reserve(userId) {
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        const entry = perms[uid];

        if (entry && !isActive(entry)) {
            return { ok: false, message: inactiveReason(entry) };
        }
        if (!entry) {
            // لا يوجد سجل اشتراك (رتبة ممنوحة يدوياً من داخل Discord) — نسمح بدون رصيد
            return { ok: true, tracked: false };
        }
        if (entry.maxEncrypts) {
            const used = (entry.usedEncrypts || 0) + (entry.pending || 0);
            if (used >= entry.maxEncrypts) {
                return { ok: false, message: 'استهلكت رصيد التشفير المتاح ضمن باقتك. فعّل كوداً جديداً للمتابعة.' };
            }
            entry.pending = (entry.pending || 0) + 1;
            writeJsonAtomic(PERMISSIONS_FILE, perms);
            return { ok: true, tracked: true };
        }
        return { ok: true, tracked: false };
    });
}

function release(userId) { // إلغاء الحجز عند فشل التشفير — لا نأخذ من العميل رصيداً مقابل عملية فاشلة
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        const entry = perms[uid];
        if (!entry || !entry.pending) return;
        entry.pending = Math.max(0, entry.pending - 1);
        writeJsonAtomic(PERMISSIONS_FILE, perms);
    });
}

// تأكيد استهلاك عملية تشفير ناجحة.
// عند نفاد الرصيد: يُقفل السجل فوراً (exhausted) ويُجعل expiresAt في الماضي،
// فيتحقق أمران معاً: (1) لا يمكن تشفير مرة أخرى حتى لو بقيت الرتبة في Discord،
// (2) يستطيع العضو فوراً تفعيل كود جديد بدون رسالة "لديك اشتراك فعال".
function commit(userId) {
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        const entry = perms[uid];
        if (!entry) return { tracked: false, exhausted: false };
        entry.pending = Math.max(0, (entry.pending || 0) - 1);
        entry.usedEncrypts = (entry.usedEncrypts || 0) + 1;
        entry.lastEncryptAt = Date.now();
        let exhausted = false;
        if (entry.maxEncrypts && entry.usedEncrypts >= entry.maxEncrypts) {
            entry.exhausted = true;
            entry.expiresAt = Date.now() - 1;
            entry.roleRemoved = false; // إشارة للسحب الفوري للرتبة
            exhausted = true;
        }
        writeJsonAtomic(PERMISSIONS_FILE, perms);
        return { tracked: true, exhausted, entry: { ...entry } };
    });
}

// ==================== سحب الرتب ====================
// كل سجل غير فعّال ولم تُسحب رتبته بعد يظهر هنا، فيسحبها أي طرف (البوت أو الموقع)
// فوراً. لو فشل السحب لأي سبب يبقى السجل مؤشراً فيُعاد المحاولة في الدورة التالية،
// بينما التشفير يظل مرفوضاً طوال الوقت لأن الرفض يعتمد على السجل لا على الرتبة.
function pendingRevocations() {
    const perms = readPermissions();
    const out = [];
    for (const [userId, entry] of Object.entries(perms)) {
        if (isActive(entry)) continue;
        if (entry.roleRemoved) continue;
        if (!entry.roleId) continue;
        out.push({ userId, entry });
    }
    return out;
}

function markRoleRemoved(userId) {
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        if (!perms[uid]) return;
        perms[uid].roleRemoved = true;
        perms[uid].roleRemovedAt = Date.now();
        writeJsonAtomic(PERMISSIONS_FILE, perms);
    });
}

function revoke(userId, reason = 'MANUAL') {
    return withLock(() => {
        const uid = String(userId);
        const perms = readPermissions();
        const entry = perms[uid];
        if (!entry) return null;
        entry.revoked = true;
        entry.revokedReason = reason;
        entry.expiresAt = Date.now() - 1;
        entry.roleRemoved = false;
        writeJsonAtomic(PERMISSIONS_FILE, perms);
        return entry;
    });
}

function all() {
    const perms = readPermissions();
    return Object.entries(perms).map(([userId, entry]) => ({ userId, ...describe(entry) }));
}

function codesSummary() {
    const codes = readCodes();
    const summary = {};
    for (const item of Object.values(codes)) {
        const k = item.plan || item.type;
        if (!summary[k]) summary[k] = { total: 0, used: 0, available: 0 };
        summary[k].total++;
        if (item.used) summary[k].used++; else summary[k].available++;
    }
    return summary;
}

module.exports = {
    PLAN_LIMITS,
    PERMISSIONS_FILE,
    CODES_FILE,
    readPermissions,
    readCodes,
    isActive,
    isPermanent,
    remainingEncrypts,
    describe,
    getStatus,
    inactiveReason,
    redeem,
    grantManual,
    reserve,
    release,
    commit,
    pendingRevocations,
    markRoleRemoved,
    revoke,
    all,
    codesSummary
};
