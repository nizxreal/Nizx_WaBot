'use strict';
const $ = (id) => document.getElementById(id);
const LABEL = {
  idle: 'Belum terhubung',
  connecting: 'Menghubungkan',
  qr: 'Menunggu scan QR',
  pairing: 'Menunggu kode dimasukkan',
  open: 'Terhubung',
  reconnecting: 'Menyambung ulang',
  replaced: 'Sesi dipakai di tempat lain',
  stopped: 'Dihentikan',
};
let timer = null;

async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opt);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    showView('login');
    throw new Error('Belum login');
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Gagal');
  return data;
}

function setMsg(el, text, ok) {
  el.textContent = text || '';
  el.className = 'msg' + (ok ? ' ok' : '');
}
const fmtCode = (c) => String(c).replace(/-/g, '').match(/.{1,4}/g).join('-');

function showView(v) {
  $('setup').hidden = v !== 'setup';
  $('login').hidden = v !== 'login';
  $('app').hidden = v !== 'app';
  if (v !== 'app') clearInterval(timer);
}

async function refreshStatus() {
  try {
    const d = await api('/api/status');
    const b = d.bot;
    const open = b.status === 'open';
    const stopped = b.status === 'stopped' || b.status === 'replaced';
    const blocked = d.mode !== 'running';

    $('st-bot').textContent = LABEL[b.status] || b.status;
    $('st-num').textContent = b.number || d.license.number || '-';
    $('st-lic').textContent = blocked ? 'Tidak aktif' : d.license.days + ' hari lagi';

    $('blocked-card').hidden = !blocked;
    $('ctl-card').hidden = blocked;
    if (blocked) $('blocked-msg').textContent = d.reasonText || '';

    const showCode = b.status === 'pairing' && !!b.pairingCode;
    const showQr = b.status === 'qr' && !!b.qr;
    $('pair-out').hidden = !(showCode || showQr);
    $('code-box').hidden = !showCode;
    if (showCode) $('code').textContent = fmtCode(b.pairingCode);
    $('qr').hidden = !showQr;
    if (showQr) $('qr').src = b.qr;
    $('pair-hint').textContent = showCode
      ? 'WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon, lalu masukkan kode ini.'
      : showQr
      ? 'WhatsApp > Perangkat tertaut > Tautkan perangkat, lalu pindai QR ini dari HP lain.'
      : '';

    const linked = b.hasSession || open;
    $('ctl-pair').hidden = linked;
    $('ctl-run').hidden = !linked;
    $('btn-start').hidden = !stopped;
    $('btn-stop').hidden = stopped;
  } catch {}
}

function renderFeatures(list) {
  const box = $('features');
  box.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Belum ada fitur terpasang.';
    box.appendChild(p);
    return;
  }
  for (const f of list) {
    const row = document.createElement('label');
    row.className = 'feature';
    const info = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = f.name;
    const desc = document.createElement('small');
    desc.textContent = (f.description || '') + (f.commands.length ? ' | ' + f.commands.join(', ') : '');
    info.append(name, desc);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.enabled;
    cb.addEventListener('change', async () => {
      try {
        await api('/api/settings', { features: { [f.id]: cb.checked } });
      } catch (e) {
        cb.checked = !cb.checked;
        alert(e.message);
      }
    });
    row.append(info, cb);
    box.appendChild(row);
  }
}

async function loadSettings() {
  const d = await api('/api/settings');
  $('prefix').value = d.settings.prefix;
  $('botname').value = d.settings.botName;
  $('title').textContent = d.settings.botName;
  renderFeatures(d.features);
}

async function init() {
  clearInterval(timer);
  let st;
  try {
    st = await api('/api/state');
  } catch {
    showView('login');
    return setMsg($('login-msg'), 'Dashboard tidak merespons. Pastikan bot berjalan di Termux.');
  }
  if (st.needsSetup) return showView('setup');
  if (!st.authed) return showView('login');
  showView('app');
  await loadSettings();
  await refreshStatus();
  timer = setInterval(refreshStatus, 2500);
}

async function control(action) {
  setMsg($('ctl-msg'), '');
  try {
    await api('/api/bot', { action });
    refreshStatus();
  } catch (e) {
    setMsg($('ctl-msg'), e.message);
  }
}

// Kode setup terisi otomatis dari alamat yang dibuka bot (#kode=123456).
const hm = /kode=(\d{6})/.exec(location.hash);
if (hm) {
  $('su-code').value = hm[1];
  history.replaceState(null, '', location.pathname);
}

$('btn-setup').addEventListener('click', async () => {
  const pw = $('su-pw').value;
  if (pw !== $('su-pw2').value) return setMsg($('setup-msg'), 'Password tidak sama.');
  setMsg($('setup-msg'), 'Memeriksa token...', true);
  try {
    await api('/api/setup', { code: $('su-code').value, token: $('su-token').value, password: pw });
    $('su-pw').value = '';
    $('su-pw2').value = '';
    setMsg($('setup-msg'), '');
    init();
  } catch (e) {
    setMsg($('setup-msg'), e.message);
  }
});

$('btn-login').addEventListener('click', async () => {
  try {
    await api('/api/login', { password: $('pw').value });
    $('pw').value = '';
    setMsg($('login-msg'), '');
    init();
  } catch (e) {
    setMsg($('login-msg'), e.message);
  }
});
$('pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-login').click();
});

$('btn-token').addEventListener('click', async () => {
  setMsg($('bl-msg'), 'Memeriksa token...', true);
  try {
    await api('/api/license/token', { token: $('bl-token').value });
    $('bl-token').value = '';
    setMsg($('bl-msg'), 'Lisensi aktif.', true);
    refreshStatus();
  } catch (e) {
    setMsg($('bl-msg'), e.message);
  }
});
$('btn-recheck').addEventListener('click', async () => {
  setMsg($('bl-msg'), 'Memeriksa lisensi...', true);
  try {
    await api('/api/license/recheck', {});
    setMsg($('bl-msg'), 'Lisensi aktif.', true);
    refreshStatus();
  } catch (e) {
    setMsg($('bl-msg'), e.message);
  }
});

$('btn-connect').addEventListener('click', async () => {
  const qr = $('method').value === 'qr';
  setMsg($('ctl-msg'), qr ? 'Menyiapkan QR...' : 'Meminta kode...', true);
  try {
    await api('/api/pair', qr ? { mode: 'qr' } : { number: $('num').value });
    setMsg($('ctl-msg'), qr ? 'Scan QR di kartu Koneksi Bot.' : 'Kode dibuat. Masukkan di WhatsApp dalam 1 menit.', true);
    refreshStatus();
  } catch (e) {
    setMsg($('ctl-msg'), e.message);
  }
});
$('btn-start').addEventListener('click', () => control('start'));
$('btn-stop').addEventListener('click', () => control('stop'));
$('btn-restart').addEventListener('click', () => control('restart'));

$('btn-logout').addEventListener('click', async () => {
  if (!confirm('Logout WhatsApp dari bot ini? Kamu perlu pairing ulang.')) return;
  try {
    await api('/api/logout', {});
    refreshStatus();
  } catch (e) {
    setMsg($('ctl-msg'), e.message);
  }
});
$('code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('code').textContent.replace(/-/g, ''));
    setMsg($('ctl-msg'), 'Kode disalin.', true);
  } catch {}
});

$('btn-save').addEventListener('click', async () => {
  try {
    await api('/api/settings', { prefix: $('prefix').value, botName: $('botname').value });
    setMsg($('set-msg'), 'Tersimpan. Berlaku tanpa restart.', true);
    loadSettings();
  } catch (e) {
    setMsg($('set-msg'), e.message);
  }
});
$('btn-signout').addEventListener('click', async () => {
  try {
    await api('/api/signout', {});
  } catch {}
  showView('login');
});

init();
