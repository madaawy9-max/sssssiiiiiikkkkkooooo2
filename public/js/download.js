/* ================= Download-by-code page ================= */
function formatSize(n){
  n = Number(n) || 0;
  return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB'
       : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
       : (n / 1024).toFixed(1) + ' KB';
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('code-input');
  const searchBtn = document.getElementById('code-search');
  const status = document.getElementById('code-status');
  const result = document.getElementById('code-result');

  input.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') searchBtn.click(); });

  searchBtn.addEventListener('click', async () => {
    const code = input.value.trim();
    result.hidden = true;
    if (!/^RAVX-[A-Z0-9]{10}$/.test(code)){
      status.textContent = 'اكتب كودًا بصيغة RAVX- متبوعًا بـ 10 أحرف';
      status.className = 'code-status error';
      return;
    }
    status.textContent = 'جاري البحث...';
    status.className = 'code-status';
    try{
      const d = await api('/api/script/' + encodeURIComponent(code));
      const s = d.script;
      document.getElementById('result-name').textContent = s.resourceName || s.title || '—';
      document.getElementById('result-code').textContent = s.code;
      document.getElementById('result-size').textContent = formatSize(s.fileSize);
      document.getElementById('result-mode').textContent = s.encryptionMode || '—';
      document.getElementById('result-downloads').textContent = (s.downloads || 0) + ' مرة';
      document.getElementById('result-download').href = '/api/download/' + encodeURIComponent(s.code);
      result.hidden = false;
      status.textContent = 'تم العثور على الملف';
      status.className = 'code-status ok';
    }catch(e){
      status.textContent = e.message;
      status.className = 'code-status error';
    }
  });
});
