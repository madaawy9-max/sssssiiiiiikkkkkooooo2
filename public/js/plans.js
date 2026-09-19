/* ================= Plans page ================= */
const SUBSCRIPTION_LINKS = {
  trial: 'https://madaawy9.00stores.com/product/Ag3BXWU9VLil',
  day: 'https://madaawy9.00stores.com/product/yJHK3hhXiJuW',
  week: 'https://madaawy9.00stores.com/product/bADzAFrCm1nd',
  month: 'https://madaawy9.00stores.com/product/7yaSn1fNoRkk',
  lifetime: 'https://madaawy9.00stores.com/product/G6eW4aMiUw7w'
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.subscribe').forEach(btn => btn.addEventListener('click', () => {
    const url = SUBSCRIPTION_LINKS[btn.dataset.plan];
    if (url && url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
    else alert('أضف رابط الاشتراك داخل SUBSCRIPTION_LINKS في js/plans.js');
  }));
});
