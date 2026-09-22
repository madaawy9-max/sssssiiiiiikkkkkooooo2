/* ============================================================================
 * RAVX — ملف اللوق المشترك (مصدر واحد يستعمله الموقع والبوت معاً)
 * ============================================================================
 * يسجّل كل حدث مهم (تسجيل دخول، تشفير، فك حماية، تفعيل كود، خطأ) في ملف
 * نصي على القرص تحت storage/logs/، سطر واحد لكل حدث بصيغة JSON (JSON Lines)
 * سهل القراءة والفلترة لاحقاً. ملف جديد لكل يوم حتى لا يكبر ملف واحد بلا حدود.
 * لا يوقف أي عملية لو فشلت الكتابة (مثلاً القرص ممتلئ) — يكتفي بطباعة تحذير.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../../storage/logs');

function ensureLogDir() {
  try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

function currentLogFile() {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(LOG_DIR, `app-${day}.log`);
}

function serializeError(err) {
  if (!err) return undefined;
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return err;
}

function write(level, event, data) {
  ensureLogDir();
  const entry = {
    time: new Date().toISOString(),
    level,
    event,
    ...(data && typeof data === 'object' ? data : { data })
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(currentLogFile(), line, 'utf8');
  } catch (e) {
    console.error('[LOGGER] failed to write log file:', e.message);
  }
  // نطبعه بالكونسول أيضاً حتى يظهر في لوق الاستضافة (Render/PM2/إلخ)
  const consoleFn = level === 'error' ? console.error : console.log;
  consoleFn(`[${entry.time}] [${level.toUpperCase()}] ${event}`, data && Object.keys(data).length ? data : '');
}

function info(event, data) { write('info', event, data); }
function warn(event, data) { write('warn', event, data); }
function error(event, err, data) { write('error', event, { ...(data || {}), error: serializeError(err) }); }

// يقرأ آخر N سطر من ملف/ملفات اللوق (اليوم الحالي + الأمس إن احتجنا) — تُستخدم
// من لوحة تحكم الأدمن لعرض آخر الأحداث بدون فتح ملفات على الاستضافة يدوياً.
function readRecent(limit = 200) {
  ensureLogDir();
  let files = [];
  try {
    files = fs.readdirSync(LOG_DIR)
      .filter(f => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .reverse();
  } catch (e) { return []; }

  const lines = [];
  for (const f of files) {
    if (lines.length >= limit) break;
    try {
      const content = fs.readFileSync(path.join(LOG_DIR, f), 'utf8');
      const fileLines = content.split('\n').filter(Boolean);
      lines.unshift(...fileLines);
    } catch (e) { /* ignore unreadable file */ }
  }
  return lines.slice(-limit).reverse().map(l => {
    try { return JSON.parse(l); } catch (e) { return { time: null, level: 'raw', event: 'unparsed', line: l }; }
  });
}

module.exports = { info, warn, error, readRecent, LOG_DIR };
