/* ================= Dashboard page ================= */
let mode = 'target';

function toast(text, ok = false){
  const el = document.getElementById('encrypt-status');
  el.textContent = text;
  el.className = 'status ' + (ok ? 'ok' : 'error');
}

function renderDashboardUser(user){
  const state = document.getElementById('user-state');
  const info = document.getElementById('user-info');
  const box = document.getElementById('encrypt-box');
  if (!user){
    state.textContent = 'سجّل الدخول للوصول إلى أدواتك';
    info.className = 'user-info empty';
    info.textContent = 'تسجيل الدخول عبر Discord يفعّل الأدوات حسب صلاحياتك.';
    box.classList.add('locked');
    return;
  }
  state.textContent = user.canEncrypt ? 'لديك صلاحية التشفير' : 'حساب مسجل';
  info.className = 'user-info';
  info.innerHTML = '<b>' + escapeHtml(user.username) + '</b><small>ID: ' + escapeHtml(user.id) + '</small>';
  if (user.canEncrypt){
    box.classList.remove('locked');
  } else {
    box.classList.add('locked');
    box.querySelector('h3').textContent = 'التشفير غير متاح';
  }
}

async function loadHealthAndStats(){
  const health = document.getElementById('health');
  try{
    const h = await api('/api/health');
    health.textContent = h.online ? '● النظام يعمل' : '● النظام متوقف';
    health.classList.toggle('good', !!h.online);
  }catch(e){
    health.textContent = 'تعذر الاتصال بالنظام';
  }
}

async function loadStatsIfAdmin(user){
  if (!user?.isAdmin) return;
  try{
    const s = await api('/api/stats');
    document.getElementById('stats').innerHTML =
      '<div><b>' + s.totalScripts + '</b><small>الموارد</small></div>' +
      '<div><b>' + s.totalDownloads + '</b><small>التحميلات</small></div>';
  }catch(e){ /* not admin or unavailable */ }
}

document.addEventListener('DOMContentLoaded', () => {
  loadHealthAndStats();

  document.addEventListener('ravx:user', e => {
    renderDashboardUser(e.detail);
    loadStatsIfAdmin(e.detail);
  });

  document.getElementById('file').addEventListener('change', e => {
    if (e.target.files[0]) document.getElementById('file-name').textContent = '✓ ' + e.target.files[0].name;
  });

  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.mode').forEach(x => x.classList.toggle('active', x === b));
  }));

  document.getElementById('encrypt-form').addEventListener('submit', async e => {
    e.preventDefault();
    const file = document.getElementById('file').files[0];
    const btn = document.getElementById('encrypt-btn');
    if (!file) return toast('اختر ملف ZIP أولًا');
    const f = new FormData();
    f.append('file', file);
    f.append('resourceName', document.getElementById('resource').value.trim());
    f.append('targetIp', document.getElementById('ip').value.trim());
    f.append('encryptionMode', mode);
    btn.disabled = true;
    btn.innerHTML = 'جاري الرفع والتشفير...';
    toast('جاري معالجة الملف، لا تغلق الصفحة');
    try{
      const d = await api('/api/encrypt', {method: 'POST', body: f});
      const code = d.script.code;
      document.getElementById('download-code').textContent = code;
      document.getElementById('download-link').href = '/api/download/' + encodeURIComponent(code);
      document.getElementById('encrypt-result').hidden = false;
      toast('تم التشفير بنجاح — احفظ كود التحميل', true);
      btn.innerHTML = 'تم التشفير ✓';
    }catch(err){
      toast(err.message);
      btn.innerHTML = 'تشفير المورد الآن ←';
    }finally{
      btn.disabled = false;
    }
  });

  document.getElementById('copy-code').addEventListener('click', () => {
    navigator.clipboard?.writeText(document.getElementById('download-code').textContent)
      .then(() => toast('تم نسخ كود التحميل', true));
  });
});
