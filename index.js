try { require('dotenv').config(); } catch (e) {}

process.on('unhandledRejection', (reason, promise) => {
    console.error('[RAVX BOT] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[RAVX BOT] Uncaught Exception:', err);
});
const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags, Events,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    UserSelectMenuBuilder, RoleSelectMenuBuilder, PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const db = require('./src/database/db');
const { createServer } = require('./src/server/server');
const subs = require('./src/shared/subscriptions');
const protectionEngine = require('./src/shared/protection-engine');

// ==================== إعدادات النظام ====================
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1543275242762407958';
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID || '1545704301605945354';
const ADMIN_PANEL_CHANNEL_ID = process.env.ADMIN_PANEL_CHANNEL_ID || '1545524543903367318';
const PRICING_CHANNEL_ID = process.env.PRICING_CHANNEL_ID || '1545526903052435476';
const GRANT_PERMISSION_ROLE_ID = process.env.GRANT_PERMISSION_ROLE_ID || process.env.ENCRYPT_ROLE_ID || '1509455687934283776';
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://ravx.onrender.com";

const BANNER_IMAGE_URL = "https://cdn.discordapp.com/attachments/1347530974971559996/1545106692285661206/ravx_logo_bannr.png?ex=6a9c41be&is=6a9af03e&hm=7bce2e840b13301cdc97aef0dd6738fc7429742431ec97c500999798d0118c43&";
const THUMBNAIL_URL = "https://cdn.discordapp.com/attachments/1347530974971559996/1545517413678977034/RAVX_LOGO.png?ex=6a9c6ec1&is=6a9b1d41&hm=f4254219e932d39218cee412e64e1d0ae3eba0a9993d75024e7eae292972e9eb&";

const filePath = path.join(__dirname, 'licenses.json');
const permissionsFilePath = path.join(__dirname, 'permissions.json');
const permissionCodesFilePath = path.join(__dirname, 'permission_codes.json');

const PERMISSION_CODES_CHANNEL_ID = process.env.PERMISSION_CODES_CHANNEL_ID || process.env.PERMISSION_CHANNEL_ID || '';
console.log('[RAVX CONFIG] Permission channel:', PERMISSION_CODES_CHANNEL_ID || 'NOT SET');
console.log('[RAVX CONFIG] Role:', GRANT_PERMISSION_ROLE_ID || 'NOT SET');
const SUBSCRIPTION_LOG_CHANNEL_ID = process.env.SUBSCRIPTION_LOG_CHANNEL_ID || '';

// جميع الاشتراكات تستخدم رتبة واحدة فقط
const PLAN_ROLES = {};

// 🌐 تشغيل خادم الموقع تلقائياً مع البوت
try {
    const webServer = createServer();
    webServer.listen(PORT, () => {
        console.log('\n======================================================');
        console.log(`🌐 [RAVX NEXUS] موقع التحميل يعمل الآن: ${BASE_URL}`);
        console.log(`🔑 كود تجريبي لاختبار التحميل: RAVX-DEMO1`);
        console.log('======================================================\n');
    });
} catch (e) {
    console.error('ملاحظة خادم الويب:', e.message);
}


async function deleteUploadMessage(message) {
    if (!message) return;
    for (let i = 0; i < 8; i++) {
        try {
            if (message.deletable) {
                await message.delete();
                return;
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }
}

// رسالة عامة في الروم تُحذف تلقائياً بعد ثوانٍ — تفيد بردود الأكواد الخاطئة/الناجحة
// حتى ما تتراكم رسائل قديمة في روم الصلاحيات.
async function sendTempMessage(channel, content, seconds = 8) {
    try {
        const msg = await channel.send({ content });
        setTimeout(() => msg.delete().catch(() => {}), seconds * 1000);
    } catch (e) {}
}

const userSessionData = new Map();
const adminGrantSession = new Map();

// كل الصلاحيات تُقرأ وتُكتب عبر محرك الاشتراكات المشترك (src/shared/subscriptions.js).
// ممنوع الاحتفاظ بنسخة في الذاكرة هنا: الموقع يعدّل نفس الملف، وأي نسخة قديمة
// نحفظها لاحقاً كانت تمسح استهلاك الرصيد القادم من الموقع (ثغرة تكرار التجربة).
function loadPermissions() { return subs.readPermissions(); }

function loadPermissionCodes() {
    try {
        if (fs.existsSync(permissionCodesFilePath)) {
            return JSON.parse(fs.readFileSync(permissionCodesFilePath, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function savePermissionCodes(data) {
    fs.writeFileSync(permissionCodesFilePath, JSON.stringify(data, null, 4), 'utf8');
}

// ==================== سجل الاشتراكات (للإدارة) ====================
const subscriptionLogFilePath = path.join(__dirname, 'subscription_logs.json');
function appendSubscriptionLog(entry) {
    let logs = [];
    try { if (fs.existsSync(subscriptionLogFilePath)) logs = JSON.parse(fs.readFileSync(subscriptionLogFilePath, 'utf8')); } catch (e) {}
    logs.push(entry);
    // نحتفظ بآخر 5000 عملية فقط حتى لا يتضخم الملف إلى ما لا نهاية
    if (logs.length > 5000) logs = logs.slice(logs.length - 5000);
    try { fs.writeFileSync(subscriptionLogFilePath, JSON.stringify(logs, null, 2), 'utf8'); } catch (e) { console.error('[RAVX LOG] فشل حفظ سجل الاشتراكات:', e.message); }
}
async function logSubscriptionEvent({ userId, username, code, plan, source, expiresAt }) {
    const entry = { userId, username: username || null, code, plan, source, grantedAt: new Date().toISOString(), expiresAt: expiresAt === -1 ? 'lifetime' : (expiresAt ? new Date(expiresAt).toISOString() : null) };
    appendSubscriptionLog(entry);
    console.log(`[RAVX SUBSCRIPTION] ${username || userId} فعّل باقة "${plan}" بالكود ${code} عبر ${source}`);
    if (SUBSCRIPTION_LOG_CHANNEL_ID) {
        try {
            const ch = await client.channels.fetch(SUBSCRIPTION_LOG_CHANNEL_ID).catch(() => null);
            if (ch) {
                await ch.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('🧾 تفعيل اشتراك جديد')
                        .addFields(
                            { name: '👤 العضو', value: `<@${userId}> (${userId})`, inline: false },
                            { name: '📦 الباقة', value: plan, inline: true },
                            { name: '🔑 الكود', value: `\`${code}\``, inline: true },
                            { name: '⏳ الانتهاء', value: expiresAt === -1 ? '♾️ مدى الحياة' : (expiresAt ? `<t:${Math.floor(expiresAt / 1000)}:F>` : '—'), inline: false },
                            { name: '📍 المصدر', value: source, inline: true }
                        )
                        .setTimestamp()]
                });
            }
        } catch (e) { console.error('[RAVX LOG] فشل إرسال سجل الاشتراك للروم:', e.message); }
    }
}

// ==================== إعدادات كل نوع باقة ====================
// مصدرها الوحيد الآن محرك الاشتراكات المشترك، حتى يطبّق البوت والموقع نفس
// المدد ونفس سقف عمليات التشفير بالضبط.
const PLAN_LIMITS = subs.PLAN_LIMITS;

async function redeemPermissionCode(code, userId, guildId) {
    return subs.redeem(code, userId, {
        guildId,
        roleId: GRANT_PERMISSION_ROLE_ID,
        source: 'STORE_CODE'
    });
}

// صلاحية التشفير من الديسكورد:
// - الأدمن دائماً مسموح.
// - لو عنده سجل اشتراك: القرار من السجل فقط (منتهي/مستهلك = ممنوع فوراً،
//   حتى لو بقيت الرتبة عالقة عليه في Discord لأي سبب).
// - لو ما عنده سجل إطلاقاً (رتبة أعطاها أدمن يدوياً من داخل Discord): نعتمد الرتبة.
function hasEncryptAccess(interaction) {
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const { active, entry } = subs.getStatus(interaction.user.id);
    if (entry) return active;
    return !!(GRANT_PERMISSION_ROLE_ID && interaction.member.roles.cache.has(GRANT_PERMISSION_ROLE_ID));
}

function encryptDenyMessage(userId) {
    const { entry } = subs.getStatus(userId);
    if (!entry) return '⛔ ما عندك اشتراك فعّال. فعّل كود اشتراك من روم الأكواد وبعدها ارجع.';
    return `⛔ ${subs.inactiveReason(entry)}`;
}

// سحب الرتبة فوراً من العضو (يُستدعى لحظة استهلاك الرصيد أو انتهاء المدة —
// بدون انتظار أي دورة فحص).
async function removeSubscriptionRole(guildId, userId, roleId) {
    try {
        const guild = client.guilds.cache.get(guildId) || (guildId ? await client.guilds.fetch(guildId).catch(() => null) : null);
        if (!guild || !roleId) return false;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return true; // العضو غادر السيرفر — لا شيء لسحبه
        if (!member.roles.cache.has(roleId)) return true;
        await member.roles.remove(roleId);
        return true;
    } catch (e) {
        console.error('[RAVX BOT] فشل سحب الرتبة:', e.message);
        return false;
    }
}

// تأكيد استهلاك عملية تشفير ناجحة + سحب فوري للرتبة عند نفاد الرصيد.
async function consumeEncryptCredit(guild, userId) {
    const result = subs.commit(userId);
    if (!result.tracked) return;
    if (result.exhausted) {
        const ok = await removeSubscriptionRole(result.entry.guildId || guild?.id, userId, result.entry.roleId);
        if (ok) subs.markRoleRemoved(userId);
        console.log(`[RAVX BOT] استهلك العضو ${userId} كامل رصيد التشفير (${result.entry.plan || 'تجربة'}) — تم القفل وسحب الرتبة فوراً.`);
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) await user.send('🔔 انتهى رصيد باقتك بعد عملية التشفير. سُحبت رتبة الاشتراك، وتقدر تفعّل كود جديد في أي وقت.').catch(() => {});
        } catch (e) {}
    }
}

function canGrantPermissions(interaction) {
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (GRANT_PERMISSION_ROLE_ID && interaction.member.roles.cache.has(GRANT_PERMISSION_ROLE_ID)) return true;
    return false;
}

// سحب صلاحية منتهية: نسحب الرتبة، ونبقي السجل محفوظاً بحالة "منتهٍ" بدل حذفه.
// حذف السجل كان يفتح ثغرة: لو فشل سحب الرتبة، يختفي ما يمنع التشفير من الموقع.
// السجل المنتهي لا يمنع العضو من تفعيل كود جديد (isActive = false).
async function revokeExpiredPermission(guild, userId, entry) {
    const ok = await removeSubscriptionRole(entry.guildId || guild?.id, userId, entry.roleId);
    if (ok) subs.markRoleRemoved(userId);
}

function loadLicenses() {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveLicenses(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

let licenses = loadLicenses();

// تحميل ملف من رابط (Discord CDN)
async function downloadFileStream(fileUrl, destPath) {
    try {
        const response = await fetch(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        });
        if (!response.ok) {
            throw new Error(`فشل التحميل، رمز الحالة: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
        return destPath;
    } catch (fetchErr) {
        return new Promise((resolve, reject) => {
            const client = fileUrl.startsWith('https') ? https : http;
            const file = fs.createWriteStream(destPath);
            const req = client.get(fileUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            }, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    file.close();
                    return downloadFileStream(response.headers.location, destPath).then(resolve).catch(reject);
                }
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(destPath, () => {});
                    return reject(new Error(`فشل التحميل، رمز الحالة: ${response.statusCode}`));
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close(() => resolve(destPath));
                });
            });
            req.on('error', (err) => {
                file.close();
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });
    }
}

// 🛡️ محرك الحماية والتشفير — موحّد الآن مع الموقع عبر src/shared/protection-engine.js
// (كان البوت يستخدم محركاً محلياً منفصلاً عن محرك الموقع؛ هذا كان سبب أن
// التشفير من الموقع لا يقفل الآي بي بنفس قوة تشفير الديسكورد — راجع تعليق
// الملف المشترك لتفاصيل الفرق). كلاهما الآن يستدعي نفس الدالة بالضبط.
const crypto = require('crypto');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once(Events.ClientReady, async () => {
    try { const ch=await client.channels.fetch(PERMISSION_CODES_CHANNEL_ID); if(ch){ await ch.send({embeds:[new EmbedBuilder().setColor(0x0066ff).setTitle('🔐 RAVX Subscription').setDescription('اضغط الزر لإدخال كود الاشتراك\n\n✅ الكود يستخدم مرة واحدة\n⏳ تنتهي الرتبة بانتهاء الاشتراك').setFooter({text:'TEAM RAVX'})], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_redeem_subscription').setLabel('🔑 إدخال الكود').setStyle(ButtonStyle.Primary))]}); }} catch(e){console.log('[RAVX PANEL]',e.message)}

    console.log(`[RAVX BOT] Online as ${client.user.tag}`);

    // رسالة استلام الاشتراك داخل روم الأكواد
    try {
        if (PERMISSION_CODES_CHANNEL_ID) {
            const codeChannel = await client.channels.fetch(PERMISSION_CODES_CHANNEL_ID).catch(() => null);
            if (codeChannel && codeChannel.isTextBased()) {
                const recent = await codeChannel.messages.fetch({ limit: 10 }).catch(() => null);
                const exists = recent && recent.some(m => m.author.id === client.user.id && m.content.includes('استلام الاشتراك'));
                if (!exists) {
                    await codeChannel.send(
                        '🔐 **استلام الاشتراك\n\n' +
                        'أرسل كود التفعيل هنا لتفعيل رتبتك.\n\n' +
                        '✅ يتم تفعيل الرتبة تلقائياً\n' +
                        '⏳ تنتهي حسب مدة اشتراكك\n' +
                        '👑 اشتراك مدى الحياة لا ينتهي**'
                    );
                }
            }
        }
    } catch (e) {}

    try {
        const channel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
        if (channel) {
            const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
            if (messages && messages.size > 0) {
                await channel.bulkDelete(messages).catch(() => {});
            }

            const container = new ContainerBuilder().setAccentColor(0x5865F2);

            const titleSection = new SectionBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    '# 🛡️ RAVX PROTECTOR\n' +
                    '-# Enterprise-Grade FiveM Script Security\n\n' +
                    '**`🟢 ONLINE`**　**`⚡ V8 ENGINE`**　**`🔒 AES-256`**\n\n' +
                    'حماية وتشفير احترافي لموارد **FiveM** — كل العملية تتم عبر الأزرار بالأسفل.\n' +
                    'اختر نوع التشفير ثم أدخل IP السيرفر، وبعدها ارفع ملف ZIP وسيتم تجهيز السكربت المحمي.'
                )
            );
            if (/^https?:\/\/.+/i.test(THUMBNAIL_URL)) {
                titleSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(THUMBNAIL_URL));
            }
            container.addSectionComponents(titleSection);

            container
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        '### 📋 آلية العمل\n' +
                        '> **1.** اضغط زر **🔐 بدء التشفير**\n' +
                        '> **2.** اختر **نمط التشفير** المناسب لسكريبتك\n' +
                        '> **3.** أدخل **الآي بي** المخوّل بتشغيل السكريبت\n' +
                        '> **4.** ارفع **ملف الـ `.zip`** من Discord أو من صفحة الرفع\n' +
                        '> **5.** استلم ملفك محمي + كود ورابط تحميل فوري'
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        '### ✨ لماذا RAVX؟\n' +
                        '🛡️ ‎ **محرك تشفير V8** — طبقات حماية متعددة ضد الـ Hooks والتفكيك\n' +
                        '⚡ ‎ **رفع ومعالجة فورية** — بدون تجهيز ملفات مسبقة على السيرفر\n' +
                        '🔒 ‎ **خصوصية تامة** — تُحذف رسالتك تلقائياً فور استلام الملف\n' +
                        '🌐 ‎ **بوابة تحميل مستقلة** — روابط وأكواد تتجاوز حدود ديسكورد (24MB+)'
                    )
                );

            if (/^https?:\/\/.+/i.test(BANNER_IMAGE_URL)) {
                container
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large))
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL(BANNER_IMAGE_URL)
                        )
                    );
            }

            const rowActions = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_start_protect').setLabel('🔐 بدء التشفير').setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId('btn_web_upload').setLabel('🌐 رفع من الموقع').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_check_license').setLabel('🔍 فحص الرخصة').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🌐 بوابة التحميل').setURL(BASE_URL)
            );

            const rowExtra = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('💎 أسعار الاشتراك').setURL('https://discord.com/channels/1411298467061698623/1545526903052435476'),
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('⭐ الدعم الفني').setURL('https://discord.com/channels/1411298467061698623/1509399450504794285')
            );

            container
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                .addActionRowComponents(rowActions)
                .addActionRowComponents(rowExtra)
                .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('-# RAVX-TEAM Security Systems — 2026')
                );

            await channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container]
            });
            console.log('[RAVX BOT] تم إرسال اللوحة الاحترافية بنجاح.');
        }

        // لوحة الصلاحيات الإدارية
        if (ADMIN_PANEL_CHANNEL_ID && ADMIN_PANEL_CHANNEL_ID !== 'YOUR_ADMIN_PANEL_CHANNEL_ID_HERE') {
            const adminChannel = await client.channels.fetch(ADMIN_PANEL_CHANNEL_ID).catch(() => null);
            if (adminChannel) {
                const adminMessages = await adminChannel.messages.fetch({ limit: 10 }).catch(() => null);
                if (adminMessages && adminMessages.size > 0) {
                    await adminChannel.bulkDelete(adminMessages).catch(() => {});
                }

                const adminContainer = new ContainerBuilder()
                    .setAccentColor(0xFEE75C)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '# 🔑 ADMIN CONTROL — صلاحيات التشفير\n' +
                            '-# للإدارة والمخوّلين فقط\n\n' +
                            'امنح أي عضو صلاحية استخدام زر **🔐 بدء التشفير** في البانل الرئيسي — برتبة تلقائية ومدة محددة.'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '### ⚙️ آلية العمل\n' +
                            '> **1.** اضغط **➕ منح صلاحية تشفير**\n' +
                            '> **2.** اختر العضو من القائمة\n' +
                            '> **3.** اختر الرتبة اللي تُمنح له\n' +
                            '> **4.** حدد المدة — أو اجعلها دائمة ♾️\n' +
                            '> **5.** تُسحب الرتبة والصلاحية تلقائياً عند الانتهاء'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('btn_grant_permission').setLabel('➕ منح صلاحية تشفير').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId('btn_list_permissions').setLabel('📋 عرض الصلاحيات الحالية').setStyle(ButtonStyle.Secondary)
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('-# RAVX-TEAM Security Systems — 2026')
                    );

                await adminChannel.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [adminContainer]
                });
                console.log('[RAVX BOT] تم إرسال لوحة الصلاحيات الإدارية بنجاح.');
            }
        }

        // لوحة الأسعار
        if (PRICING_CHANNEL_ID && PRICING_CHANNEL_ID !== 'YOUR_PRICING_CHANNEL_ID_HERE') {
            const pricingChannel = await client.channels.fetch(PRICING_CHANNEL_ID).catch(() => null);
            if (pricingChannel) {
                const oldPricing = await pricingChannel.messages.fetch({ limit: 10 }).catch(() => null);
                if (oldPricing && oldPricing.size > 0) {
                    await pricingChannel.bulkDelete(oldPricing).catch(() => {});
                }

                const pricingContainer = new ContainerBuilder()
                    .setAccentColor(0xFFD700)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '# 💎 RAVX PROTECTOR — الاشتراكات\n' +
                            '-# حماية وتشفير سكربتات FiveM بأعلى مستوى احترافي\n\n' +
                            '`✅ تشفير V8 كامل`　`✅ قفل IP`　`✅ رفع مباشر`　`✅ دعم فني`'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '### 🔐 باقات الاشتراك\n\n' +
                            '🧪 **تجربة** — `$2`\n' +
                            '‎ ‎ ‎ ‎ تشفير سكربت واحد\n\n' +
                            '⏱️ **يومي** — `$5`\n' +
                            '‎ ‎ ‎ ‎ تشفير غير محدود لمدة 24 ساعة\n\n' +
                            '🥉 **أسبوعي** — `$15`\n' +
                            '‎ ‎ ‎ ‎ تشفير غير محدود لمدة 7 أيام\n\n' +
                            '🥈 **شهري**　`⭐ الأكثر طلباً` — `$25`\n' +
                            '‎ ‎ ‎ ‎ تشفير غير محدود + أولوية دعم\n\n' +
                            '👑 **مدى الحياة** — `$200`\n' +
                            '‎ ‎ ‎ ‎ وصول دائم بدون تجديد'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '### 📌 ملاحظات\n' +
                            '🔸 خصومات متاحة للكميات والسيرفرات المتعددة\n' +
                            '🔸 الدعم متوفر للمشتركين على مدار الساعة\n' +
                            '🔸 التفعيل يتم خلال دقائق من إتمام الدفع'
                        )
                    )
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('📩 تواصل للاشتراك')
                                .setStyle(ButtonStyle.Link)
                                .setURL('https://discord.com/channels/1411298467061698623/1509399450504794285')
                        )
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('-# RAVX-TEAM Security Systems — 2026')
                    );

                await pricingChannel.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [pricingContainer]
                });

                console.log('[RAVX BOT] تم إرسال رسالة الأسعار بنجاح.');
            }
        }

        // تنظيف فوري لأي اشتراك انتهى أثناء توقف البوت (قبل أول دورة فحص كل دقيقة)
        await checkExpiredSubscriptions();

        // فحص دوري كل 15 ثانية (كان كل دقيقة) — شبكة أمان فقط، لأن السحب الأساسي
        // صار فورياً لحظة استهلاك الرصيد أو انتهاء المدة. هذه الدورة تلتقط الحالات
        // التي فشل فيها نداء Discord سابقاً أو التي انتهت مدتها أثناء توقف البوت.
        setInterval(async () => {
            try {
                for (const { userId, entry } of subs.pendingRevocations()) {
                    const ok = await removeSubscriptionRole(entry.guildId, userId, entry.roleId);
                    if (ok) {
                        subs.markRoleRemoved(userId);
                        console.log(`[RAVX BOT] انتهت صلاحية التشفير للعضو ${userId} وتم سحب الرتبة.`);
                    }
                }
            } catch (e) { console.error('[RAVX BOT] دورة سحب الصلاحيات:', e.message); }
        }, 15 * 1000);

    } catch (error) {
        console.error('خطأ في تشغيل RAVX:', error);
    }
});

client.on('interactionCreate', async interaction => {

    if (interaction.isModalSubmit() && interaction.customId === 'modal_redeem_subscription') {
        const code = interaction.fields.getTextInputValue('subscription_code').trim().toUpperCase();
        const result = await redeemPermissionCode(code, interaction.user.id, interaction.guild?.id);
        if (!result.ok) {
            return await interaction.reply({content: '❌ '+result.message, flags: MessageFlags.Ephemeral});
        }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const role = interaction.guild.roles.cache.get(GRANT_PERMISSION_ROLE_ID);
        if (!role) return interaction.reply({content:'❌ رتبة الاشتراك غير موجودة', flags:MessageFlags.Ephemeral});
        await member.roles.add(role).catch(() => {});
        // السجل كُتب فعلياً داخل subs.redeem تحت قفل مشترك — ما نكتبه مرة ثانية من هنا
        await logSubscriptionEvent({ userId: interaction.user.id, username: interaction.user.tag, code: result.code, plan: result.plan, source: 'زر إدخال الكود', expiresAt: result.expiresAt });
        const successEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('✅ تم تفعيل الاشتراك')
            .setDescription(`📦 الباقة: **${result.plan}**\n⏳ المدة: **${result.days===-1?'♾️ مدى الحياة':result.days+' يوم'}**\n🎖️ تم إعطاؤك الرتبة` + (result.maxEncrypts ? `\n🔐 رصيد التشفير: **${result.maxEncrypts} عملية فقط**` : ''))
            .setFooter({text:'TEAM RAVX'});
        await interaction.user.send({embeds:[successEmbed]}).catch(()=>{});
        return await interaction.reply({embeds:[successEmbed], flags: MessageFlags.Ephemeral});
    }

    if (interaction.isButton()) {
        const userId = interaction.user.id;
        if (!userSessionData.has(userId)) userSessionData.set(userId, {});

        
        
        if (interaction.customId === 'btn_redeem_subscription') {
            const modal = new ModalBuilder()
                .setCustomId('modal_redeem_subscription')
                .setTitle('🔐 تفعيل اشتراك RAVX');
            const input = new TextInputBuilder()
                .setCustomId('subscription_code')
                .setLabel('كود الاشتراك')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('RAVX-XXXXXXXXXX')
                .setRequired(true);
            modal.addComponents(
                new ActionRowBuilder().addComponents(input)
            );
            return await interaction.showModal(modal);
        }

if (interaction.customId === 'btn_web_upload') {
            return await interaction.reply({
                content:
                    '🌐 **رفع من الموقع**\n' +
                    '━━━━━━━━━━━━━━\n' +
                    `📦 افتح صفحة الرفع: ${BASE_URL}/upload\n` +
                    'اختر ZIP ثم أكمل خطوات IP ونوع التشفير.',
                flags: MessageFlags.Ephemeral
            });
        }

if (interaction.customId === 'btn_start_protect') {
            if (!hasEncryptAccess(interaction)) {
                return await interaction.reply({
                    content: encryptDenyMessage(interaction.user.id),
                    flags: MessageFlags.Ephemeral
                });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_encrypt_mode')
                .setPlaceholder('اختر نمط التشفير المناسب لسكريبتك')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('الملفات المستهدفة')
                        .setDescription('يشفّر فقط ملفات client/server/main — الأنسب والأسرع')
                        .setValue('target')
                        .setEmoji('🛡️'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('تشفير شامل')
                        .setDescription('يشفّر كل ملفات .lua بدون استثناء — أقصى درجة حماية')
                        .setValue('full')
                        .setEmoji('📦'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('بدون تشفير')
                        .setDescription('يفعّل قفل الآي بي فقط، من غير تشفير أكواد')
                        .setValue('none')
                        .setEmoji('🔓')
                );

            return await interaction.reply({
                content: '### 🔐 اختر نمط التشفير\nحدد النمط المناسب من القائمة، وبعدها بنطلب منك آي بي السيرفر مباشرة.',
                components: [new ActionRowBuilder().addComponents(selectMenu)],
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId === 'btn_check_license') {
            const modal = new ModalBuilder().setCustomId('modal_check').setTitle('استعلام عن رخصة سيرفر');
            const ipInput = new TextInputBuilder().setCustomId('ip_field').setLabel('أدخل الآي بي للفحص').setStyle(TextInputStyle.Short).setPlaceholder('127.0.0.1').setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(ipInput));
            return await interaction.showModal(modal);
        }

        if (interaction.customId === 'btn_contact_subscribe') {
            return await interaction.reply({
                content:
                    '📩 **شكراً لاهتمامك بالاشتراك!**\n' +
                    'تواصل مع فريق الإدارة مباشرة عشان نكمل معاك تفاصيل الدفع وتفعيل الباقة.\n' +
                    '-# افتح تذكرة دعم أو راسل الإدارة مباشرة',
                flags: MessageFlags.Ephemeral
            });
        }

        // منح صلاحية
        if (interaction.customId === 'btn_grant_permission') {
            if (!canGrantPermissions(interaction)) {
                return await interaction.reply({ content: '⛔ ما عندك صلاحية منح تصاريح لأعضاء آخرين.', flags: MessageFlags.Ephemeral });
            }

            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('grant_select_user')
                .setPlaceholder('اختر العضو اللي بتمنحه صلاحية التشفير')
                .setMinValues(1)
                .setMaxValues(1);

            return await interaction.reply({
                content: '### 1️⃣ اختر العضو',
                components: [new ActionRowBuilder().addComponents(userSelect)],
                flags: MessageFlags.Ephemeral
            });
        }

        // عرض الصلاحيات
        if (interaction.customId === 'btn_list_permissions') {
            if (!canGrantPermissions(interaction)) {
                return await interaction.reply({ content: '⛔ هذا الزر للإدارة فقط.', flags: MessageFlags.Ephemeral });
            }

            const entries = subs.all();
            const activeOnes = entries.filter(e => e.active);

            if (entries.length === 0) {
                return await interaction.reply({ content: '📭 ما فيه أي صلاحيات ممنوحة حالياً.', flags: MessageFlags.Ephemeral });
            }

            const lines = entries.slice(-25).map(e => {
                const expiry = e.expiresAt === -1 ? '**دائمة**' : `<t:${Math.floor(e.expiresAt / 1000)}:R>`;
                const credit = e.remaining === null ? 'غير محدود' : `${e.remaining}/${e.maxEncrypts}`;
                const state = e.active ? '🟢 فعّال' : (e.exhausted ? '🔴 مستهلك' : '⚪ منتهٍ');
                return `• <@${e.userId}> — ${e.plan} — ${state} — رصيد: ${credit} — ينتهي: ${expiry}`;
            });

            return await interaction.reply({
                content: `### 📋 الصلاحيات (فعّالة: ${activeOnes.length} من ${entries.length})\n${lines.join('\n')}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_encrypt_mode') {
            const userId = interaction.user.id;
            if (!userSessionData.has(userId)) userSessionData.set(userId, {});
            userSessionData.get(userId).mode = interaction.values[0];

            const modal = new ModalBuilder().setCustomId('modal_protect').setTitle('آي بي السيرفر المخوّل');
            const ipInput = new TextInputBuilder()
                .setCustomId('ip_field')
                .setLabel('أدخل آي بي السيرفر المستهدف')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('127.0.0.1')
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(ipInput));
            return await interaction.showModal(modal);
        }
    }

    // اختيار العضو للرتبة
    if (interaction.isUserSelectMenu() && interaction.customId === 'grant_select_user') {
        if (!canGrantPermissions(interaction)) {
            return await interaction.reply({ content: '⛔ ما عندك صلاحية منح تصاريح.', flags: MessageFlags.Ephemeral });
        }

        const targetUserId = interaction.values[0];
        adminGrantSession.set(interaction.user.id, { targetUserId });

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('grant_select_role')
            .setPlaceholder('اختر الرتبة اللي تنعطى للعضو')
            .setMinValues(1)
            .setMaxValues(1);

        return await interaction.update({
            content: `### 2️⃣ اختر الرتبة\nراح تُعطى لـ <@${targetUserId}> تلقائياً.`,
            components: [new ActionRowBuilder().addComponents(roleSelect)]
        });
    }

    // اختيار الرتبة
    if (interaction.isRoleSelectMenu() && interaction.customId === 'grant_select_role') {
        if (!canGrantPermissions(interaction)) {
            return await interaction.reply({ content: '⛔ ما عندك صلاحية منح تصاريح.', flags: MessageFlags.Ephemeral });
        }

        const session = adminGrantSession.get(interaction.user.id);
        if (!session || !session.targetUserId) {
            return await interaction.update({ content: '⚠️ انتهت الجلسة، اضغط "منح صلاحية تشفير" من جديد.', components: [] });
        }
        session.roleId = interaction.values[0];
        adminGrantSession.set(interaction.user.id, session);

        const durationRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('grant_duration_1').setLabel('يوم واحد').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('grant_duration_3').setLabel('3 أيام').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('grant_duration_7').setLabel('7 أيام').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('grant_duration_30').setLabel('30 يوم').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('grant_duration_permanent').setLabel('دائمة ♾️').setStyle(ButtonStyle.Success)
        );

        return await interaction.update({
            content: `### 3️⃣ حدد مدة الصلاحية\nلـ <@${session.targetUserId}> برتبة <@&${session.roleId}>`,
            components: [durationRow]
        });
    }

    // تنفيذ المنح
    if (interaction.isButton() && interaction.customId.startsWith('grant_duration_')) {
        if (!canGrantPermissions(interaction)) {
            return await interaction.reply({ content: '⛔ ما عندك صلاحية منح تصاريح.', flags: MessageFlags.Ephemeral });
        }

        const session = adminGrantSession.get(interaction.user.id);
        if (!session || !session.targetUserId || !session.roleId) {
            return await interaction.update({ content: '⚠️ انتهت الجلسة، اضغط "منح صلاحية تشفير" من جديد.', components: [] });
        }

        await interaction.deferUpdate();

        const durationKey = interaction.customId.replace('grant_duration_', '');
        const durationDaysMap = { '1': 1, '3': 3, '7': 7, '30': 30 };
        const expiresAt = durationKey === 'permanent'
            ? null
            : Date.now() + durationDaysMap[durationKey] * 24 * 60 * 60 * 1000;


        const guild = interaction.guild;
        const member = await guild.members.fetch(session.targetUserId).catch(() => null);

        if (!member) {
            adminGrantSession.delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ ما قدرت ألقى هذا العضو بالسيرفر.', components: [] });
        }

        await member.roles.add(session.roleId).catch(() => {});

        subs.grantManual(session.targetUserId, {
            roleId: session.roleId,
            guildId: guild.id,
            days: durationKey === 'permanent' ? -1 : durationDaysMap[durationKey],
            grantedBy: interaction.user.id
        });
        adminGrantSession.delete(interaction.user.id);

        const expiryText = expiresAt ? `<t:${Math.floor(expiresAt / 1000)}:F>` : '**دائمة، ما تنتهي إلا بسحبها يدوياً**';

        await interaction.editReply({
            content:
                `✅ **تم منح الصلاحية بنجاح**\n` +
                `👤 العضو: <@${session.targetUserId}>\n` +
                `🎖️ الرتبة: <@&${session.roleId}>\n` +
                `⏳ تنتهي: ${expiryText}`,
            components: []
        });

        await member.send({
            content:
                `🔑 **تم منحك صلاحية استخدام ميزة التشفير في RAVX-TEAM**\n` +
                `🎖️ حصلت على رتبة: **${member.guild.roles.cache.get(session.roleId)?.name || 'صلاحية جديدة'}**\n` +
                `⏳ الصلاحية سارية: ${expiresAt ? `حتى ${expiryText}` : 'بشكل دائم'}\n` +
                `روح على قناة البانل واضغط "🔐 بدء التشفير" عشان تبدأ.`
        }).catch(() => {});

        return;
    }

    // =========================================================================
    // الخطوة الحاسمة: إدخال الآي بي ثم طلب رفع ملف الـ ZIP مباشرة في الروم!
    // =========================================================================
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_protect') {
            const ip = interaction.fields.getTextInputValue('ip_field').trim();
            const userId = interaction.user.id;
            const session = userSessionData.get(userId) || {};
            const encryptionMode = session.mode || 'target';

            const modeLabels = {
                target: '🛡️ الملفات المستهدفة',
                full: '📦 تشفير شامل (V8)',
                none: '🔓 بدون تشفير'
            };
            const modeLabel = modeLabels[encryptionMode] || encryptionMode;

            // إشعار المستخدم برفع الملف داخل الروم
            await interaction.reply({
                content:
                    `### 📤 الخطوة التالية: رفع ملف السكربت المضغوط (.zip)\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `🌐 **الآي بي المرخص:** \`${ip}\`\n` +
                    `🔐 **نمط التشفير:** ${modeLabel}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📁 **ارفع ملف السكربت المضغوط (\`.zip\`) هنا في الشات الآن.**\n` +
                    `🔒 *حماية الخصوصية:* سيقوم البوت بحذف رسالتك فوراً لمنع تحميل ملفك من الأعضاء الآخرين.\n` +
                    `⏱️ لديك **90 ثانية** لرفع الملف...`,
                flags: MessageFlags.Ephemeral
            });

            // مراقبة رسالة العضو في هذا الروم
            const filter = m =>
                m.author.id === userId &&
                m.attachments.size > 0 &&
                m.attachments.first().name.toLowerCase().endsWith('.zip');
            const channel = interaction.channel;

            let collected;
            try {
                collected = await channel.awaitMessages({ filter, max: 1, time: 90000, errors: ['time'] });
            } catch (err) {
                return await interaction.editReply({
                    content: '⏰ **انتهت مهلة الرفع (90 ثانية).** اضغط على زر "🔐 بدء التشفير" من جديد عندما تكون جاهزاً.',
                    components: []
                }).catch(() => {});
            }

            const userMessage = collected.first();
            const attachment = userMessage.attachments.first();

            // تحميل الملف ثم حذف رسالة الرفع مباشرة


            // التحقق من صيغة الملف
            if (!attachment.name.toLowerCase().endsWith('.zip')) {
                // حذف رسالة الرفع فوراً بعد اكتمال التحميل مع إعادة محاولة
                if (userMessage && userMessage.deletable) {
                    await userMessage.delete().catch(async () => {
                        await new Promise(r => setTimeout(r, 1000));
                        // انتظار بسيط حتى يتأكد Discord من حفظ المرفق ثم الحذف
                await new Promise(r => setTimeout(r, 2000));
                await deleteUploadMessage(userMessage);
                    });
                }
                return await interaction.editReply({
                    content: '❌ **الملف المرفوع ليس بصيغة `.zip`!** يرجى ضغط مجلد السكربت في ملف zip والمحاولة من جديد.',
                    components: []
                }).catch(() => {});
            }

            const fileUrl = attachment.url || attachment.proxyURL;
            const fileProxyUrl = attachment.proxyURL;

            // 🔒 حجز عملية تشفير من رصيد الباقة قبل بدء أي معالجة.
            // الحجز يتم داخل قفل مشترك مع الموقع، فلا يقدر العضو يشغّل عمليتين
            // بنفس اللحظة (وحدة من الديسكورد ووحدة من الموقع) على رصيد واحد.
            const reservation = subs.reserve(interaction.user.id);
            if (!reservation.ok) {
                return await interaction.editReply({ content: `⛔ ${reservation.message}`, components: [] }).catch(() => {});
            }
            let creditCommitted = false;

            // إشعار المستخدم بالبدء وتحديث الرد
            await interaction.editReply({
                content: '⏳ **تم استلام الملف بنجاح!** جاري التحميل وفك الضغط وتشفير الأكواد بمحرك V8... برجاء الانتظار ثوانٍ...',
                components: []
            }).catch(() => {});

            // إنشاء مسار عمل مؤقت خاص بهذه العملية
            const uniqueOpId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const tempWorkingDir = path.join(__dirname, `temp_op_${uniqueOpId}`);
            const tempExtractedDir = path.join(tempWorkingDir, 'extracted');
            const inputZipPath = path.join(tempWorkingDir, 'uploaded_input.zip');

            try {
                fs.mkdirSync(tempExtractedDir, { recursive: true });

                // 1. لازم نحمّل الملف أولاً — ديسكورد يُبطل رابط المرفق (CDN) فور حذف الرسالة الأصلية،
                //    فحذف الرسالة قبل التحميل يسبب فشل بكود 404. نحمّل بأسرع وقت ثم نحذف فوراً بعدها.
                try {
                    await downloadFileStream(fileUrl, inputZipPath);
                } catch (dlErr) {
                    if (fileProxyUrl && fileProxyUrl !== fileUrl) {
                        await downloadFileStream(fileProxyUrl, inputZipPath);
                    } else {
                        throw dlErr;
                    }
                }

                // 🛡️ نحذف رسالة العضو فوراً بمجرد اكتمال التحميل — قبل فك الضغط والتشفير (الخطوات الأطول)
                // هذا يحصر فترة التعرض بوقت التحميل فقط بدل طول عملية المعالجة كاملة
                // حذف رسالة الرفع فوراً بعد اكتمال التحميل مع إعادة محاولة
                if (userMessage && userMessage.deletable) {
                    await userMessage.delete().catch(async () => {
                        await new Promise(r => setTimeout(r, 1000));
                        // انتظار بسيط حتى يتأكد Discord من حفظ المرفق ثم الحذف
                await new Promise(r => setTimeout(r, 2000));
                await deleteUploadMessage(userMessage);
                    });
                }

                // 2. فك ضغط الملف
                const inputZip = new AdmZip(inputZipPath);
                inputZip.extractAllTo(tempExtractedDir, true);

                // 3. استخراج أو تحديد اسم المورد (Resource Name)
                let resourceName = attachment.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
                const subDirs = fs.readdirSync(tempExtractedDir).filter(f => {
                    try { return fs.statSync(path.join(tempExtractedDir, f)).isDirectory(); } catch (e) { return false; }
                });
                
                let targetProcessDir = tempExtractedDir;
                if (subDirs.length === 1 && fs.readdirSync(tempExtractedDir).length === 1) {
                    resourceName = subDirs[0];
                    targetProcessDir = path.join(tempExtractedDir, subDirs[0]);
                }

                // 4. حفظ الترخيص
                if (!licenses[ip]) licenses[ip] = [];
                if (!licenses[ip].includes(resourceName)) {
                    licenses[ip].push(resourceName);
                    saveLicenses(licenses);
                }

                // 5. تطبيق التشفير المتقدم V8 وقفل الآي بي
                protectionEngine.processAndProtectFiles(targetProcessDir, ip, resourceName, encryptionMode);

                // 6. إعادة ضغط الملف المحمي
                const finalZipFileName = `RAVX_Secured_${resourceName}_${ip.replace(/\./g, '_')}.zip`;
                const finalZipPath = db.getFilePath(finalZipFileName);

                const outputZip = new AdmZip();
                outputZip.addLocalFolder(tempExtractedDir);
                outputZip.writeZip(finalZipPath);

                const finalStats = fs.statSync(finalZipPath);
                const fileSizeMB = finalStats.size / (1024 * 1024);

                // 7. حفظ السكربت في قاعدة بيانات الموقع وتوليد الكود
                const scriptEntry = db.saveScript({
                    title: resourceName,
                    originalFilename: finalZipFileName,
                    savedFilename: finalZipFileName,
                    fileSize: finalStats.size,
                    targetIp: ip,
                    resourceName: resourceName,
                    encryptionMode: encryptionMode,
                    uploaderName: interaction.user.tag || interaction.user.username,
                    uploaderId: interaction.user.id
                });

                const webDownloadUrl = `${BASE_URL.replace(/\/$/, '')}/?code=${scriptEntry.code}`;

                // استهلاك رصيد التشفير لو العضو على باقة محدودة العدد (مثل التجربة) —
                // بعدها يُسحب دوره تلقائياً ولا يقدر يكرر التشفير حتى لو الكود صار "منتهي" فقط لا "محذوف".
                await consumeEncryptCredit(interaction.guild, interaction.user.id);
                creditCommitted = true;

                const webRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('تحميل السكربت من الموقع')
                        .setStyle(ButtonStyle.Link)
                        .setURL(webDownloadUrl)
                        .setEmoji('🌐')
                );

                const successMessage =
                    `🛡️ **[RAVX-TEAM] تمّت معالجة وتشفير سكريبتك بنجاح!**\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📦 **المورد:** \`${resourceName}\`\n` +
                    `🌐 **الآي بي المرخّص:** \`${ip}\`\n` +
                    `🔐 **نمط التشفير:** ${modeLabel}\n` +
                    `📊 **حجم الملف:** \`${(finalStats.size / 1024).toFixed(1)} KB\`\n` +
                    `🔑 **كود التحميل بالموقع:** \`\`\`${scriptEntry.code}\`\`\`\n` +
                    `🔗 **رابط التحميل المباشر:**\n${webDownloadUrl}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `💡 ملفك جاهز للتحميل من الموقع أو عبر المرفقات بالأسفل.`;

                // تجهيز المرفق إذا كان الحجم أقل من 24 ميجا
                const sendFiles = [];
                if (fileSizeMB <= 24) {
                    sendFiles.push(new AttachmentBuilder(finalZipPath, { name: finalZipFileName }));
                }

                // إرسال النتيجة بالخاص إذا كان مفتوحاً
                await interaction.user.send({
                    content: successMessage,
                    files: sendFiles,
                    components: [webRow]
                }).catch(() => {
                    console.log(`[RAVX BOT] تعذر الإرسال للخاص للعضو ${interaction.user.tag} (الخاص مقفل)`);
                });
                

                // تعديل الرد المباشر في الروم
                await interaction.editReply({
                    content: successMessage,
                    files: sendFiles,
                    components: [webRow]
                });

                // تنظيف الملفات المؤقتة
                if (fs.existsSync(tempWorkingDir)) {
                    fs.rmSync(tempWorkingDir, { recursive: true, force: true });
                }

            } catch (err) {
                console.error('Error in direct zip processing:', err);
                // فشلت العملية → نرجّع الحجز حتى لا يخسر العميل رصيده مقابل عملية لم تكتمل
                if (!creditCommitted) { try { subs.release(interaction.user.id); } catch (e) {} }

                // حذف رسالة الملف حتى عند حدوث خطأ أثناء المعالجة
                if (userMessage) {
                    // حذف رسالة الرفع فوراً بعد اكتمال التحميل مع إعادة محاولة
                if (userMessage && userMessage.deletable) {
                    await userMessage.delete().catch(async () => {
                        await new Promise(r => setTimeout(r, 1000));
                        // انتظار بسيط حتى يتأكد Discord من حفظ المرفق ثم الحذف
                await new Promise(r => setTimeout(r, 2000));
                await deleteUploadMessage(userMessage);
                    });
                }
                }

                if (fs.existsSync(tempWorkingDir)) {
                    fs.rmSync(tempWorkingDir, { recursive: true, force: true });
                }
                await interaction.editReply({
                    content: `❌ **حدث خطأ أثناء معالجة الملف:** ${err.message}`,
                    components: []
                }).catch(() => {});
            }

        } else if (interaction.customId === 'modal_check') {
            licenses = loadLicenses();
            const ip = interaction.fields.getTextInputValue('ip_field');
            const scriptsList = licenses[ip] ? licenses[ip].join(', ') : 'لا توجد تراخيص مسجلة';

            const embed = new EmbedBuilder()
                .setTitle('🔍 نتيجة فحص التراخيص')
                .setColor(0x00ffcc)
                .addFields(
                    { name: '🌐 الآي بي:', value: `\`${ip}\``, inline: false },
                    { name: '📋 الموارد:', value: `\`${scriptsList}\``, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    }
});




// تنظيف الاشتراكات المنتهية عند تشغيل البوت
async function checkExpiredSubscriptions() {
    for (const { userId, entry } of subs.pendingRevocations()) {
        const ok = await removeSubscriptionRole(entry.guildId, userId, entry.roleId);
        if (ok) subs.markRoleRemoved(userId);
    }
}

// تفعيل أكواد المتجر: العضو يضع الكود في روم الصلاحيات ويحصل على الرتبة تلقائياً
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!PERMISSION_CODES_CHANNEL_ID) {
            console.log('[RAVX] PERMISSION_CODES_CHANNEL_ID is empty');
            return;
        }
        if (message.channel.id !== PERMISSION_CODES_CHANNEL_ID) return;
        console.log('[RAVX] Code message received:', message.content);

        const code = message.content.trim().toUpperCase();
        if (!code.startsWith('RAVX-')) return;

        // نحذف رسالة العميل اللي فيها الكود فوراً — خصوصية ومنع نسخ الكود من قبل غيره
        await message.delete().catch(() => {});

        const result = await redeemPermissionCode(code, message.author.id, message.guild?.id);
        if (!result.ok) {
            await sendTempMessage(message.channel, `❌ <@${message.author.id}> ${result.message}`);
            return;
        }

        const selectedRole = GRANT_PERMISSION_ROLE_ID;
        if (message.guild && selectedRole) {
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member) {
                const role = message.guild.roles.cache.get(selectedRole);
                if (!role) {
                    await sendTempMessage(message.channel, `❌ <@${message.author.id}> رتبة الاشتراك غير موجودة. تأكد من GRANT_PERMISSION_ROLE_ID`);
                    return;
                }
                if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    await sendTempMessage(message.channel, `❌ <@${message.author.id}> البوت لا يملك صلاحية Manage Roles`);
                    return;
                }
                if (message.guild.members.me.roles.highest.position <= role.position) {
                    await sendTempMessage(message.channel, `❌ <@${message.author.id}> رتبة البوت يجب أن تكون أعلى من رتبة الاشتراك`);
                    return;
                }
                await member.roles.add(role);
            }
        }

        // السجل محفوظ مسبقاً داخل subs.redeem (قفل مشترك بين البوت والموقع)
        await logSubscriptionEvent({ userId: message.author.id, username: message.author.tag, code: result.code, plan: result.plan, source: 'روم الصلاحيات', expiresAt: result.expiresAt });

        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0x00ff99)
                .setTitle('🔐 تم تفعيل الاشتراك بنجاح')
                .setDescription(
                    `👤 العضو: ${message.author}\n\n` +
                    `📦 الباقة: **${result.plan}**\n` +
                    `⏳ المدة: **${result.days === -1 ? '♾️ مدى الحياة' : result.days + ' يوم'}**\n` +
                    (result.maxEncrypts ? `🔐 رصيد التشفير: **${result.maxEncrypts} عملية فقط**\n\n` : '\n') +
                    `🎖️ تم إعطاؤك رتبة الاشتراك\n` +
                    `🔒 الكود تم استخدامه ولن يعمل مرة أخرى`
                )
                .setFooter({ text: 'TEAM RAVX • Subscription System' })]
        });
    } catch (e) {
        console.error('Permission code error:', e);
    }
});

// Upload messages are deleted immediately after the file finishes downloading —
// right before extraction/encryption — since Discord invalidates the attachment's
// CDN link as soon as the source message is deleted, so download must happen first.

console.log("TOKEN CHECK:", TOKEN ? TOKEN.substring(0,10) + "..." : "MISSING");
console.log("TOKEN LENGTH:", TOKEN?.length);
client.login(TOKEN);
