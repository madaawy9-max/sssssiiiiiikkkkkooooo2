# محرك Hercules المحلي لـ FiveM

يستخدم الموقع وبوت Discord محركًا موحدًا عبر `src/shared/obfuscator-engine.js`. الإعداد الافتراضي هو Hercules محليًا، من دون API key أو رصيد. يمكن الرجوع إلى Luraph بتغيير `OBFUSCATOR_PROVIDER=luraph`.

## متطلبات التشغيل

1. ثبّت Lua 5.4 على جهاز الاستضافة، واضبط `LUA_BIN` إذا كان اسم الأمر أو مساره مختلفًا.
2. نزّل مصدر Hercules من `https://github.com/zeusssz/hercules-obfuscator` إلى `vendor/hercules` في جذر المشروع، أو اضبط `HERCULES_ROOT` إلى مجلد المستودع.
3. أعد تشغيل البوت والموقع بعد ضبط المتغيرات.

```env
OBFUSCATOR_PROVIDER=hercules
LUA_BIN=lua5.4
HERCULES_ROOT=/app/vendor/hercules
HERCULES_PRESET=heavy
HERCULES_TIMEOUT_MS=600000
```

## أوضاع المعالجة

- `target`: ملفات `client` و`server` و`main` التي يحددها البوت.
- `full`: كل ملفات Lua عدا `fxmanifest.lua` و`__resource.lua`.
- `none`: قفل الترخيص لملفات الخادم دون تمويه.

تعمل المعالجة ملفًا ملفًا ببرنامج Hercules المحلي، وتُحفظ ملفات الإدخال المؤقتة داخل مجلد Hercules لأن بعض إصداراته ترفض المسارات الخارجية. يمرر البوت `--target lua` صراحةً. الافتراضي `heavy` مع مهلة 10 دقائق قابلة للرفع إلى 12 دقيقة، وتتم معالجة الوظائف بالتتابع لتخفيف استهلاك الذاكرة. يضيف `lua54 'yes'` إلى manifest إذا لم يكن موجودًا. جرّب الناتج على نسخة اختبار من FXServer؛ يمكن اختيار `balanced` عند الحاجة إلى سرعة أعلى.

التمويه يصعّب القراءة والتحليل الساكن، لكنه لا يمنع التحليل وقت التشغيل ولا يضمن استحالة استرجاع المنطق. احتفظ دائمًا بالملفات الأصلية؛ ميزة الاستعادة في RAVX تعتمد على نسخة المصدر المحفوظة.

## فحوصات التكامل

تم فحص بناء ملفات JavaScript وتجربة استدعاء CLI باستخدام مشغّل وهمي محلي. لم يُشغّل Hercules الفعلي أو مورد FiveM هنا؛ يحتاج ذلك تثبيت Lua 5.4 ومصدر Hercules وسيرفر FiveM تجريبي.
