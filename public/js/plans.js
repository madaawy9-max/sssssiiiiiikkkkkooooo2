/* ================= Plans page ================= */
const SUBSCRIPTION_LINKS = {
  trial: 'https://discord.gg/CQYYwafzwr',
  day: 'https://discord.gg/CQYYwafzwr',
  week: 'https://discord.gg/CQYYwafzwr',
  month: 'https://discord.gg/CQYYwafzwr',
  lifetime: 'https://discord.gg/CQYYwafzwr'
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.subscribe').forEach(btn => btn.addEventListener('click', () => {
    const url = SUBSCRIPTION_LINKS[btn.dataset.plan];
    if (url && url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
    else alert('أضف رابط الاشتراك داخل SUBSCRIPTION_LINKS في js/plans.js');
  }));
});
