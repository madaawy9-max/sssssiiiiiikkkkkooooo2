/* ============================================================================
 * أداة فك الحماية عن أرشيف مشفَّر مسبقاً (سطر أوامر مستقل)
 * ============================================================================
 * تُستخدم لإرجاع أي مورد سبق تشفيره — حتى لو كان قديماً جداً ومشفَّراً بنسخة
 * سابقة من الأداة — إلى نص Lua مقروء وقابل للتعديل، بدون المرور بالموقع أو
 * البوت إطلاقاً. تعتمد فقط على src/shared/protection-engine.js (نفس المحرك
 * المستخدم بالموقع والديسكورد)، فالنتيجة مطابقة لما تنتجه لوحة الأدمن.
 *
 * الاستخدام:
 *   node scripts/unprotect.js path/to/protected.zip
 *   node scripts/unprotect.js path/to/protected.zip path/to/output.zip
 *
 * الناتج: أرشيف ZIP جديد بنفس بنية المجلدات، بملفات Lua مفكوكة الحماية
 * (وبدون كتلة فحص الآي بي المدمجة داخل ملفات server/main)، جاهز للتعديل ثم
 * إعادة تشفيره من جديد عبر الموقع أو البوت.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const protectionEngine = require('../src/shared/protection-engine');
const logger = require('../src/shared/logger');

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

const inputZip = process.argv[2];
if (!inputZip) {
  fail('حدد مسار ملف ZIP المشفَّر: node scripts/unprotect.js path/to/protected.zip');
}
const resolvedInput = path.resolve(inputZip);
if (!fs.existsSync(resolvedInput)) fail(`الملف غير موجود: ${resolvedInput}`);

const outputZip = process.argv[3]
  ? path.resolve(process.argv[3])
  : resolvedInput.replace(/\.zip$/i, '') + '_unprotected.zip';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ravx-cli-unprotect-'));
const extracted = path.join(work, 'resource');

try {
  fs.mkdirSync(extracted, { recursive: true });
  console.log('📦 جاري فك ضغط الأرشيف...');
  execFileSync('unzip', ['-q', '-o', resolvedInput, '-d', extracted]);

  console.log('🔓 جاري فك الحماية عن ملفات Lua...');
  const report = protectionEngine.unprotectFiles(extracted);

  if (report.processed === 0) {
    console.log('⚠️ لم يُعثر على أي ملف .lua داخل الأرشيف.');
  } else if (report.unprotected === 0) {
    console.log('ℹ️ لا يوجد أي ملف Lua مموَّه بهذا القالب — الأرشيف على حاله أصلاً (غير مشفَّر أو بقالب مختلف).');
  } else {
    console.log(`✅ تم فك حماية ${report.unprotected} من أصل ${report.processed} ملف Lua:`);
    report.files.forEach(f => console.log('   - ' + f));
  }

  console.log('📦 جاري إعادة ضغط الناتج...');
  if (fs.existsSync(outputZip)) fs.unlinkSync(outputZip);
  // zip بأمر النظام حتى لا نضيف اعتمادية جديدة (adm-zip/archiver متوفرة أصلاً
  // للمحرك، لكن سكربت CLI مستقل يبقيه بسيطاً بأدوات النظام فقط كما في SETUP.md).
  execFileSync('zip', ['-qr', outputZip, '.'], { cwd: extracted });

  console.log(`\n✅ تم الحفظ في: ${outputZip}`);
  console.log('يمكنك الآن فك ضغطه، تعديل ملفات Lua كما تريد، ثم إعادة تشفيره من جديد عبر الموقع أو البوت.');

  logger.info('unprotect.cli', {
    source: 'cli',
    input: resolvedInput,
    output: outputZip,
    filesScanned: report.processed,
    filesUnprotected: report.unprotected
  });
} catch (err) {
  logger.error('unprotect.cli_failed', err, { input: resolvedInput });
  fail(err.message || String(err));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
