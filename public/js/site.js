/* ================= Ravx Store — Shared Site Script ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function escapeHtml(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function api(url, opt){
  const r = await fetch(url, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'تعذر إتمام الطلب');
  return d;
}

/* current logged-in user, shared with page scripts via ravx:user event */
let currentUser = null;

function renderAccount(user){
  currentUser = user;
  const box = $('#account');
  if (!box) return;
  if (!user){
    box.innerHTML = '<a class="btn ghost sm" href="/api/auth/login">تسجيل الدخول عبر Discord</a>';
    return;
  }
  box.innerHTML =
    '<span class="user-pill' + (user.isAdmin ? ' admin' : '') + '"><i></i>' + escapeHtml(user.username) +
    (user.canEncrypt ? ' · مصرح' : '') + '</span>' +
    '<a class="btn ghost sm" href="/api/auth/logout">خروج</a>';
}

async function bootUser(){
  try{
    const a = await api('/api/auth/me');
    renderAccount(a.user);
    document.dispatchEvent(new CustomEvent('ravx:user', {detail: a.user}));
    document.dispatchEvent(new CustomEvent('ravx:subscription', {detail: a.subscription || null}));
  }catch(e){
    renderAccount(null);
    document.dispatchEvent(new CustomEvent('ravx:user', {detail: null}));
    document.dispatchEvent(new CustomEvent('ravx:subscription', {detail: null}));
  }
}
/* متاح لصفحات أخرى لإعادة قراءة حالة الاشتراك فوراً بعد أي عملية */
window.ravxRefreshUser = bootUser;

/* active nav link based on current file */
function markActiveNav(){
  const file = (location.pathname.split('/').pop() || 'index.html');
  $$('[data-page-link]').forEach(a => {
    a.classList.toggle('active', a.dataset.pageLink === file);
  });
}

/* mobile menu */
function initMobileMenu(){
  const toggle = $('#menu-toggle'), menu = $('#menu');
  if (!toggle || !menu) return;
  toggle.addEventListener('click', () => menu.classList.toggle('open'));
  $$('[data-page-link]').forEach(a => a.addEventListener('click', () => menu.classList.remove('open')));
}

/* scroll reveal */
function initReveal(){
  const els = $$('.reveal');
  if (!els.length) return;
  const obs = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting){ entry.target.classList.add('visible'); obs.unobserve(entry.target); }
  }), {threshold: .12});
  els.forEach(el => obs.observe(el));
}

/* trust ticker (home page) */
const TICKER_PEOPLE = [
  {name: 'Ravx Team', image: ''},
  {name: 'FiveM Developers', image: ''},
  {name: 'Secure Resources', image: ''},
  {name: 'Ravx Store Community', image: ''}
];
function initTicker(){
  const el = $('#ticker');
  if (!el) return;
  const row = TICKER_PEOPLE.map(p =>
    `<span class="ticker-person">${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">` : `<i>${escapeHtml((p.name || 'R').trim().charAt(0))}</i>`}<b>${escapeHtml(p.name)}</b></span><em>•</em>`
  ).join('');
  el.innerHTML = row + row; /* duplicated for seamless loop */
}

document.addEventListener('DOMContentLoaded', () => {
  markActiveNav();
  initMobileMenu();
  initReveal();
  initTicker();
  bootUser();
  requestAnimationFrame(() => document.body.classList.add('ready'));
});
