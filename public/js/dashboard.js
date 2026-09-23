/* ================= Dashboard page ================= */
let mode = 'target';

function toast(text, ok = false){
  const el = document.getElementById('encrypt-status');
  el.textContent = text;
  el.className = 'status ' + (ok ? 'ok' : 'error');
}

let currentSubscription = null;

function planLine(sub){
  if (!sub) return '';
  const left = sub.remaining === null ? 'غير محدود' : sub.remaining + ' عملية';
  const ends = sub.expiresAt === -1
    ? 'مدى الحياة'
    : new Date(sub.expiresAt).toLocaleString('ar', {dateStyle: 'short', timeStyle: 'short'});
  if (!sub.active){
    return '<div class="sub-state off">اشتراكك (' + escapeHtml(sub.plan) + ') ' +
      (sub.exhausted ? 'استُهلك بالكامل' : 'منتهٍ') + ' — فعّل كوداً جديداً في Discord للمتابعة.</div>';
  }
  return '<div class="sub-state on">الباقة: <b>' + escapeHtml(sub.plan) + '</b> · الرصيد المتبقي: <b>' + escapeHtml(left) +
    '</b> · ينتهي: <b>' + escapeHtml(ends) + '</b></div>';
}

function renderSubscription(sub){
  currentSubscription = sub;
  const info = document.getElementById('user-info');
  if (!info || !sub) return;
  const old = info.querySelector('.sub-state');
  if (old) old.remove();
  info.insertAdjacentHTML('beforeend', planLine(sub));
  const box = document.getElementById('encrypt-box');
  if (box && sub && !sub.active) box.classList.add('locked');
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

  const unprotectBox = document.getElementById('unprotect-box');
  const logsBox = document.getElementById('logs-box');
  const ipBox = document.getElementById('ip-box');
  if (user.isAdmin){
    unprotectBox.hidden = false;
    logsBox.hidden = false;
    if (ipBox) ipBox.hidden = false;
    loadLogs();
  } else {
    unprotectBox.hidden = true;
    logsBox.hidden = true;
    if (ipBox) ipBox.hidden = true;
  }
}

async function loadLogs(){
  const list = document.getElementById('logs-list');
  if (!list) return;
  try{
    const d = await api('/api/logs?limit=200');
    if (!d.logs || !d.logs.length){ list.innerHTML = '<div style="opacity:.6">لا يوجد أحداث بعد</div>'; return; }
    list.innerHTML = d.logs.map(l => {
      const color = l.level === 'error' ? 'var(--danger)' : (l.level === 'warn' ? '#e0a827' : 'var(--text-mute)');
      const time = l.time ? new Date(l.time).toLocaleString('ar', {dateStyle:'short', timeStyle:'medium'}) : '';
      const rest = Object.entries(l).filter(([k]) => !['time','level','event'].includes(k));
      const details = rest.length ? escapeHtml(JSON.stringify(Object.fromEntries(rest))) : '';
      // "الآي بي المحاول" الحقيقي المرفوض — لأي محاولة تشغيل بكود موجود، نعرض
      // زر سريع يعبّي فورم تغيير الآي بي بنفس الكود والعنوان، لو كان العميل
      // فعلاً مرخَّصاً واتصل هذي المرة بعنوان مختلف (IPv4/IPv6) عن المسجَّل.
      let quickAdd = '';
      const deniedIp = l.checkedIp || l.reportedIp || l.socketIp;
      if (l.event === 'license.denied' && l.code && deniedIp && l.reason !== 'unknown_code_or_no_ip') {
        quickAdd = ' <button type="button" class="btn ghost sm" data-add-ip-code="' + escapeHtml(l.code) + '" data-add-ip-value="' + escapeHtml(deniedIp) + '" style="padding:2px 8px;font-size:11px">➕ ثبّت هذا العنوان لهذا الكود</button>';
      }
      return '<div style="border-bottom:1px solid var(--border);padding:6px 0">' +
        '<span style="color:' + color + ';font-weight:700">[' + escapeHtml(l.level || '') + ']</span> ' +
        '<span style="opacity:.7">' + escapeHtml(time) + '</span> ' +
        '<b>' + escapeHtml(l.event || '') + '</b>' + quickAdd +
        (details ? '<div style="opacity:.65;word-break:break-all">' + details + '</div>' : '') +
        '</div>';
    }).join('');
    list.querySelectorAll('[data-add-ip-code]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const code = btn.dataset.addIpCode;
        const newAddr = btn.dataset.addIpValue;
        document.getElementById('ip-code').value = code;
        document.getElementById('ip-new').value = newAddr; // قيمة أولية فورية
        document.getElementById('ip-box')?.scrollIntoView({behavior:'smooth', block:'center'});
        // نحاول نضيفه لقائمة العناوين الحالية بدل استبدالها بالكامل
        try{
          const d2 = await api('/api/script/' + encodeURIComponent(code));
          const current = (d2.script?.targetIp || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!current.includes(newAddr)) current.push(newAddr);
          document.getElementById('ip-new').value = current.join(',');
        }catch(e){ /* يبقى العنوان الجديد لوحده لو تعذر الجلب */ }
      });
    });
  }catch(e){ list.innerHTML = '<div style="color:var(--danger)">تعذر تحميل السجل</div>'; }
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
  document.addEventListener('ravx:subscription', e => renderSubscription(e.detail));

  /* تحديث دوري خفيف لحالة الاشتراك (كل 30 ثانية) حتى تنقفل الأدوات فوراً
     بعد انتهاء الرصيد أو المدة، بدون ما يحتاج المستخدم يحدّث الصفحة */
  setInterval(async () => {
    try{
      const d = await api('/api/subscription');
      renderSubscription(d.subscription);
    }catch(e){ /* غير مسجّل دخول */ }
  }, 30000);

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
      if (d.subscription) renderSubscription(d.subscription);
      const code = d.script.code;
      document.getElementById('download-code').textContent = code;
      document.getElementById('download-link').href = '/api/download/' + encodeURIComponent(code);
      document.getElementById('encrypt-result').hidden = false;
      toast('تم التشفير بنجاح — احفظ كود التحميل', true);
      btn.innerHTML = 'تم التشفير ✓';
    }catch(err){
      toast(err.message);
      btn.innerHTML = 'تشفير المورد الآن ←';
      if (window.ravxRefreshUser) window.ravxRefreshUser();
    }finally{
      btn.disabled = false;
    }
  });

  document.getElementById('copy-code').addEventListener('click', () => {
    navigator.clipboard?.writeText(document.getElementById('download-code').textContent)
      .then(() => toast('تم نسخ كود التحميل', true));
  });

  /* ===== فك الحماية (أدمن) ===== */
  const unprotectFileInput = document.getElementById('unprotect-file');
  if (unprotectFileInput){
    unprotectFileInput.addEventListener('change', e => {
      if (e.target.files[0]) document.getElementById('unprotect-file-name').textContent = '✓ ' + e.target.files[0].name;
    });
  }

  const unprotectStatus = document.getElementById('unprotect-status');
  function unprotectToast(text, ok = false){
    if (!unprotectStatus) return;
    unprotectStatus.textContent = text;
    unprotectStatus.className = 'status ' + (ok ? 'ok' : 'error');
  }

  const unprotectForm = document.getElementById('unprotect-form');
  if (unprotectForm){
    unprotectForm.addEventListener('submit', async e => {
      e.preventDefault();
      const file = document.getElementById('unprotect-file').files[0];
      const btn = document.getElementById('unprotect-btn');
      if (!file) return unprotectToast('اختر ملف ZIP مشفَّر أولًا');
      const f = new FormData();
      f.append('file', file);
      f.append('label', document.getElementById('unprotect-label').value.trim());
      btn.disabled = true;
      btn.innerHTML = 'جاري فك الحماية...';
      unprotectToast('جاري المعالجة، لا تغلق الصفحة');
      try{
        const d = await api('/api/unprotect', {method: 'POST', body: f});
        const code = d.script.code;
        document.getElementById('unprotect-code').textContent = code;
        document.getElementById('unprotect-link').href = '/api/download/' + encodeURIComponent(code);
        document.getElementById('unprotect-report').textContent =
          'تم فك ' + d.report.unprotected + ' من أصل ' + d.report.processed + ' ملف Lua.';
        document.getElementById('unprotect-result').hidden = false;
        unprotectToast('تم فك الحماية بنجاح — الملف الآن قابل للتعديل', true);
        btn.innerHTML = 'تم فك الحماية ✓';
        loadLogs();
      }catch(err){
        unprotectToast(err.message);
        btn.innerHTML = 'فك الحماية الآن ←';
      }finally{
        btn.disabled = false;
      }
    });
  }

  const logsRefresh = document.getElementById('logs-refresh');
  if (logsRefresh) logsRefresh.addEventListener('click', loadLogs);

  /* ===== تغيير الآي بي الحيّ (أدمن) ===== */
  const ipStatus = document.getElementById('ip-status');
  function ipToast(text, ok = false){
    if (!ipStatus) return;
    ipStatus.textContent = text;
    ipStatus.className = 'status ' + (ok ? 'ok' : 'error');
  }
  const ipForm = document.getElementById('ip-form');
  if (ipForm){
    ipForm.addEventListener('submit', async e => {
      e.preventDefault();
      const code = document.getElementById('ip-code').value.trim().toUpperCase();
      const newIp = document.getElementById('ip-new').value.trim();
      const btn = document.getElementById('ip-btn');
      if (!code || !newIp) return ipToast('عبّي الكود والآي بي الجديد');
      btn.disabled = true;
      btn.innerHTML = 'جاري التحديث...';
      try{
        await api('/api/script/' + encodeURIComponent(code) + '/ip', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({targetIp: newIp})
        });
        ipToast('تم تحديث الآي بي — يتطبّق عند العميل تلقائياً في أول فحص جاي', true);
        btn.innerHTML = 'تحديث الآي بي الآن ←';
        loadLogs();
      }catch(err){
        ipToast(err.message);
        btn.innerHTML = 'تحديث الآي بي الآن ←';
      }finally{
        btn.disabled = false;
      }
    });
  }
});
