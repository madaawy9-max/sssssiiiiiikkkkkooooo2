# إعداد النسخة المعدلة

## المتطلبات

تحتاج النسخة إلى Node.js 18 أو أحدث، وأوامر `zip` و`unzip` متاحة على النظام. ثبّت الاعتمادات عبر:

```bash
npm install
npm start
```

## متغيرات البيئة الأساسية

```env
DISCORD_BOT_TOKEN=توكن_البوت
DISCORD_CLIENT_ID=معرف_تطبيق_ديسكورد
DISCORD_CLIENT_SECRET=سر_تطبيق_ديسكورد
DISCORD_REDIRECT_URI=https://your-domain.example/api/auth/callback
DISCORD_GUILD_ID=معرف_السيرفر
ENCRYPT_ROLE_ID=معرف_رتبة_التشفير
ADMIN_USER_IDS=معرفات_الأدمن_مفصولة_بفواصل
SESSION_SECRET=قيمة_عشوائية_طويلة
MAX_UPLOAD_BYTES=5368709120
PORT=3000
BASE_URL=https://your-domain.example
```

صلاحية التشفير تُحسب من Discord عند تسجيل الدخول: Administrator أو رتبة `ENCRYPT_ROLE_ID`. لوحة الإدارة لا تظهر إلا لمن لديه Administrator أو معرف موجود في `ADMIN_USER_IDS`. لا توجد صلاحيات تشفير موثوقة من الواجهة وحدها؛ الخادم يعيد التحقق من الجلسة.

## ملاحظات الملفات الكبيرة

الرفع يُكتب مباشرة إلى ملف مؤقت عبر streaming، لذلك لا يتم تحميل ZIP كاملًا إلى الذاكرة. الحد الافتراضي 5GB. يحتاج فك الضغط والتشفير مساحة قرص مؤقتة إضافية، ويُنصح بتوفير مساحة لا تقل عن ضعف حجم ZIP مع مساحة للناتج.

محرك الموقع يفك ZIP، يعالج جميع ملفات Lua بحسب النمط، ثم يعيد ZIP ويحفظه في `storage/uploads`. الأنماط هي `target` و`full` و`none`؛ ملفات server/main تحتفظ بحارس الترخيص حتى في النمط `none`.

## أمان مهم

النسخة المعدلة أزالت الأسرار الافتراضية المكشوفة من الكود. يجب تدوير Bot Token وWebhook السابقين في Discord لأنهما ظهرا داخل النسخة الأصلية، وعدم وضع أي أسرار داخل Git أو الأرشيف.


## الاشتراكات
PERMISSION_CODES_CHANNEL_ID=روم_استلام_الأكواد
GRANT_PERMISSION_ROLE_ID=رتبة_الاشتراك_الواحدة
