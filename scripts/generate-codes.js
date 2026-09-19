// أداة توليد أكواد الاشتراك: تكمل عدد الأكواد غير المستخدمة لكل باقة إلى الحد المطلوب
// بدون ما تلمس أو تحذف أي كود موجود مسبقاً (حتى لا نُبطل أكواد باعها المتجر فعلاً).
//
// الاستخدام:
//   node scripts/generate-codes.js            → يكمل كل باقة إلى 100 كود غير مستخدم
//   node scripts/generate-codes.js 200         → يكمل كل باقة إلى 200 كود غير مستخدم

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'permission_codes.json');
const TARGET = Number(process.argv[2]) || 100;

const PLANS = [
  { plan: 'تجربة', price: 2, days: 0, type: 'single_script' },
  { plan: 'يومي', price: 5, days: 1, type: 'unlimited_24h' },
  { plan: 'أسبوعي', price: 15, days: 7, type: 'unlimited_7d' },
  { plan: 'شهري', price: 25, days: 30, type: 'unlimited_support' },
  { plan: 'مدى الحياة', price: 200, days: -1, type: 'lifetime' }
];

function loadCodes() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}

function randomCode(existing) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    let suffix = '';
    for (let i = 0; i < 10; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    code = `RAVX-${suffix}`;
  } while (existing.has(code));
  return code;
}

const codes = loadCodes();
const existing = new Set(Object.keys(codes));
const newlyCreated = {};

for (const planDef of PLANS) {
  const unusedCount = Object.values(codes).filter(c => c.plan === planDef.plan && !c.used).length;
  const toCreate = Math.max(0, TARGET - unusedCount);
  newlyCreated[planDef.plan] = [];
  for (let i = 0; i < toCreate; i++) {
    const code = randomCode(existing);
    existing.add(code);
    codes[code] = { plan: planDef.plan, price: planDef.price, days: planDef.days, type: planDef.type, used: false };
    newlyCreated[planDef.plan].push(code);
  }
}

fs.writeFileSync(FILE, JSON.stringify(codes, null, 2), 'utf8');

console.log(`تم التحديث. الهدف: ${TARGET} كود غير مستخدم لكل باقة.\n`);
for (const planDef of PLANS) {
  console.log(`${planDef.plan}: أُضيف ${newlyCreated[planDef.plan].length} كود جديد`);
}

// نطبع الأكواد الجديدة فقط بصيغة يسهل نسخها للمتجر
const outFile = path.join(__dirname, '..', 'new-codes-export.txt');
let out = '';
for (const planDef of PLANS) {
  if (!newlyCreated[planDef.plan].length) continue;
  out += `\n===== ${planDef.plan} ($${planDef.price}) — ${newlyCreated[planDef.plan].length} كود جديد =====\n`;
  out += newlyCreated[planDef.plan].join('\n') + '\n';
}
fs.writeFileSync(outFile, out.trim() + '\n', 'utf8');
console.log(`\nتم تصدير الأكواد الجديدة فقط إلى: ${outFile}`);
