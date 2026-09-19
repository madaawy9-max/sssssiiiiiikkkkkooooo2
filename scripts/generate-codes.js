/* ============================================================================
 * أداة توليد أكواد الاشتراك
 * ============================================================================
 * الاستخدام:
 *   node scripts/generate-codes.js                 → يكمل كل باقة إلى 100 كود غير مستخدم
 *   node scripts/generate-codes.js 200             → يكمل كل باقة إلى 200 كود غير مستخدم
 *   node scripts/generate-codes.js 100 --fresh     → يلغي كل الأكواد القديمة ويولّد 100 كود جديد لكل باقة
 *
 * ملاحظة: --fresh يُبطل أي كود قديم لم يُستخدم بعد (مفيد لو تسربت الأكواد).
 * الاشتراكات المفعّلة فعلياً في permissions.json لا تتأثر.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const STORAGE_DIR = path.join(ROOT, 'storage');
// ⚠️ الأكواد تُخزَّن في storage/ (مُستثنى من git، يبقى بعد إعادة النشر/التشغيل).
// كتابتها في جذر المشروع كانت تجعلها ترجع لحالتها الأصلية (كل الأكواد غير
// مستخدمة) في كل إعادة نشر — لأن الجذر يُعاد بناؤه من مستودع git.
fs.mkdirSync(STORAGE_DIR, { recursive: true });
const FILE = path.join(STORAGE_DIR, 'permission_codes.json');
const EXPORT_FILE = path.join(ROOT, 'ravx-store-codes.txt'); // ملف تصدير فقط للمتجر، لا يُقرأ وقت التشغيل
const ARCHIVE_FILE = path.join(STORAGE_DIR, 'permission_codes.previous.json');

// ترحيل تلقائي: لو فيه نسخة قديمة بالجذر ولا فيه نسخة بـ storage/ بعد
const legacyFile = path.join(ROOT, 'permission_codes.json');
if (!fs.existsSync(FILE) && fs.existsSync(legacyFile)) {
  fs.copyFileSync(legacyFile, FILE);
  console.log('تم ترحيل permission_codes.json القديم من الجذر إلى storage/.');
}

const args = process.argv.slice(2);
const FRESH = args.includes('--fresh');
const TARGET = Number(args.find(a => /^\d+$/.test(a))) || 100;

// المدد الحقيقية — نفس ما يطبّقه محرك الاشتراكات (src/shared/subscriptions.js).
// باقة التجربة: 3 أيام نافذة + عملية تشفير واحدة فقط (كانت days:0 فتنتهي لحظة التفعيل).
const PLANS = [
  { plan: 'تجربة',      price: 2,   days: 3,  type: 'single_script',     maxEncrypts: 1 },
  { plan: 'يومي',       price: 5,   days: 1,  type: 'unlimited_24h',     maxEncrypts: null },
  { plan: 'أسبوعي',     price: 15,  days: 7,  type: 'unlimited_7d',      maxEncrypts: null },
  { plan: 'شهري',       price: 25,  days: 30, type: 'unlimited_support', maxEncrypts: null },
  { plan: 'مدى الحياة', price: 200, days: -1, type: 'lifetime',          maxEncrypts: null }
];

function loadCodes() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}

// توليد عشوائي مبني على crypto (Math.random ليس عشوائياً بما يكفي لأكواد تُباع)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون O/0/I/1 لتفادي الالتباس عند النسخ
function randomCode(existing) {
  let code;
  do {
    let suffix = '';
    const bytes = crypto.randomBytes(12);
    for (let i = 0; i < 12; i++) suffix += CHARS[bytes[i] % CHARS.length];
    code = `RAVX-${suffix}`;
  } while (existing.has(code));
  return code;
}

const oldCodes = loadCodes();
if (FRESH && Object.keys(oldCodes).length) {
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(oldCodes, null, 2), 'utf8');
  console.log(`تم أرشفة الأكواد القديمة في: ${path.basename(ARCHIVE_FILE)} (صارت كلها ملغاة).`);
}

const codes = FRESH ? {} : oldCodes;
const existing = new Set([...Object.keys(codes), ...Object.keys(oldCodes)]); // نتجنب إعادة إصدار كود قديم
const newlyCreated = {};

for (const planDef of PLANS) {
  const unusedCount = Object.values(codes).filter(c => c.plan === planDef.plan && !c.used).length;
  const toCreate = Math.max(0, TARGET - unusedCount);
  newlyCreated[planDef.plan] = [];
  for (let i = 0; i < toCreate; i++) {
    const code = randomCode(existing);
    existing.add(code);
    codes[code] = {
      plan: planDef.plan,
      price: planDef.price,
      days: planDef.days,
      type: planDef.type,
      maxEncrypts: planDef.maxEncrypts,
      used: false,
      createdAt: new Date().toISOString()
    };
    newlyCreated[planDef.plan].push(code);
  }
}

fs.writeFileSync(FILE, JSON.stringify(codes, null, 2), 'utf8');

console.log(`\nتم التحديث. الهدف: ${TARGET} كود غير مستخدم لكل باقة.${FRESH ? ' (وضع التجديد الكامل)' : ''}\n`);
for (const planDef of PLANS) {
  console.log(`${planDef.plan}: أُضيف ${newlyCreated[planDef.plan].length} كود جديد`);
}

// ملف التصدير: كل الأكواد غير المستخدمة، مرتبة حسب الباقة — جاهز للمتجر
let out = `RAVX STORE — أكواد الاشتراك\nتاريخ التوليد: ${new Date().toISOString()}\n`;
for (const planDef of PLANS) {
  const list = Object.entries(codes)
    .filter(([, v]) => v.plan === planDef.plan && !v.used)
    .map(([k]) => k)
    .sort();
  const duration = planDef.days === -1 ? 'مدى الحياة' : `${planDef.days} يوم`;
  const limit = planDef.maxEncrypts ? `${planDef.maxEncrypts} عملية تشفير` : 'تشفير غير محدود';
  out += `\n===== ${planDef.plan} ($${planDef.price}) — ${duration} — ${limit} — ${list.length} كود =====\n`;
  out += list.join('\n') + '\n';
}
fs.writeFileSync(EXPORT_FILE, out, 'utf8');
console.log(`\nتم تصدير الأكواد المتاحة إلى: ${path.basename(EXPORT_FILE)}`);
