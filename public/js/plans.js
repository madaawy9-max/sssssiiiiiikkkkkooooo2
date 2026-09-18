/* ================= Plans page ================= */
const SUBSCRIPTION_LINKS = {trial: 'https://discord.gg/cfw3', day: 'https://discord.gg/cfw3', week: 'https://discord.gg/cfw3', month: 'https://discord.gg/cfw3'};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.subscribe').forEach(btn => btn.addEventListener('click', () => {
    const url = SUBSCRIPTION_LINKS[btn.dataset.plan];
    if (url && url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
    else alert('أضف رابط الاشتراك داخل SUBSCRIPTION_LINKS في js/plans.js');
  }));
});
