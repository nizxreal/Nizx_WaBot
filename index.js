'use strict';
require('dotenv').config({ quiet: true });

const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const pkg = require('./package.json');
const license = require('./license');
const registry = require('./core/registry');
const settings = require('./core/settings');
const { Bot } = require('./core/bot');

const DASH_HOST = '127.0.0.1';
const DASH_PORT = 3000;
const DASH_URL = `http://${DASH_HOST}:${DASH_PORT}`;
const TOKEN_RE = /^[A-Z0-9]{2,10}(-[A-Z0-9]{4}){4}$/;

const bot = new Bot();
let dashboard = null;
let rl = null;
let shuttingDown = false;
let mode = 'blocked'; // 'running' | 'blocked'
let blockedReason = 'no_token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (ms) => new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

// Satu pesan bermasalah tidak boleh mematikan bot.
process.on('unhandledRejection', (e) => console.error('[error]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('[error]', (e && e.message) || e));

async function shutdown(reason = 'manual', code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[bot] Berhenti: ${license.describe(reason)}`);
  license.stopLoop();
  try { await bot.stop(); } catch {}
  try { if (dashboard) await dashboard.stop(); } catch {}
  process.exit(code);
}

function openUrl(url) {
  try {
    const p = spawn('termux-open-url', [url], { stdio: 'ignore', detached: true });
    p.on('error', () => console.log(`Buka manual di browser: ${url}`));
    p.unref();
  } catch {
    console.log(`Buka manual di browser: ${url}`);
  }
}

// Lisensi tidak valid: bot berhenti, dashboard tetap hidup.
async function block(reason, { notify = false } = {}) {
  if (mode === 'blocked' && blockedReason === reason) return;
  mode = 'blocked';
  blockedReason = reason;
  console.log(`[lisensi] ${license.describe(reason)}`);
  license.stopLoop();
  if (notify) {
    try {
      await bot.sendToSelf('Masa aktif bot habis. Hubungi pemilik untuk perpanjang, lalu buka dashboard dan tekan Cek ulang lisensi.');
      await sleep(2500);
    } catch {}
  }
  try { await bot.stop(); } catch {}
}

function activate() {
  mode = 'running';
  blockedReason = null;
  const i = license.info();
  console.log(`Lisensi valid sampai ${fmtDate(i.expiresAt)} (sisa ${Math.max(0, Math.ceil(i.remainingMs / 86400000))} hari)`);
  license.stopLoop();
  license.startLoop((reason) => block(reason, { notify: reason === 'expired' }));
  if (!['open', 'connecting', 'reconnecting'].includes(bot.status)) {
    bot.start().catch((e) => console.error('[bot]', e.message));
  }
}

// Dipanggil dashboard.
const ctl = {
  getMode: () => mode,
  getReasonText: () => (blockedReason ? license.describe(blockedReason) : ''),
  async submitToken(raw) {
    const token = String(raw || '').trim().toUpperCase();
    if (!TOKEN_RE.test(token)) return { ok: false, error: license.describe('bad_request') };
    const prev = license.getStoredToken();
    license.setToken(token);
    const r = await license.check();
    if (!r.ok) {
      if (prev) license.setToken(prev);
      else license.clearToken();
      return { ok: false, error: license.describe(r.reason) };
    }
    activate();
    return { ok: true };
  },
  async recheck() {
    if (mode === 'running') return { ok: true };
    const r = await license.check();
    if (!r.ok) {
      blockedReason = r.reason;
      return { ok: false, error: license.describe(r.reason) };
    }
    activate();
    return { ok: true };
  },
};

const dashboardUrl = () => {
  const code = dashboard && dashboard.setupCode();
  return code ? `${DASH_URL}/#kode=${code}` : DASH_URL;
};

function menu() {
  console.log(`\nTekan Enter untuk membuka dashboard (${DASH_URL})`);
  rl.once('line', () => {
    openUrl(dashboardUrl());
    menu();
  });
}

async function main() {
  console.log(`Nizx WaBot v${pkg.version}`);
  console.log(`Fitur dimuat: ${registry.load()}`);

  bot.on('status', (s) => console.log(`[bot] status: ${s}`));
  bot.on('messages', async ({ sock, messages, type }) => {
    if (type !== 'notify' || mode !== 'running') return;
    for (const msg of messages) {
      try {
        await registry.handle(sock, msg);
      } catch (e) {
        console.error('[pesan] error:', e.message);
      }
    }
  });
  bot.on('open', async ({ number }) => {
    console.log(`[bot] terhubung sebagai ${number}`);
    const b = await license.bindNumber(number);
    if (b.ok) return;
    console.error(`[lisensi] ${license.describe(b.reason)}`);
    if (b.reason === 'number_mismatch') await bot.logout();
    await block(b.reason);
  });

  try {
    dashboard = require(path.join(__dirname, 'dashboard', 'server.js'));
    await dashboard.start({ bot, license, registry, settings, ctl, host: DASH_HOST, port: DASH_PORT });
  } catch (e) {
    console.error(
      e.code === 'EADDRINUSE'
        ? 'Port 3000 dipakai. Kemungkinan bot sudah berjalan. Matikan dulu: pkill -f "node index.js"'
        : `[dashboard] gagal start: ${e.message}`
    );
    process.exit(1);
  }

  const r = await license.check();
  if (r.ok) activate();
  else await block(r.reason);

  const code = dashboard.setupCode();
  if (code) {
    console.log('\nPengaturan awal: masukkan token lewat dashboard.');
    console.log(`  Alamat     : ${DASH_URL}`);
    console.log(`  Kode setup : ${code}`);
    console.log('Membuka browser... (kalau tidak terbuka, buka alamat di atas lewat Chrome)');
    openUrl(dashboardUrl());
  } else if (mode === 'blocked') {
    console.log('Buka dashboard untuk memasukkan token baru atau cek ulang lisensi.');
  }

  if (process.stdin.isTTY) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => shutdown('manual'));
    menu();
  }
  process.on('SIGINT', () => shutdown('manual'));
  process.on('SIGTERM', () => shutdown('manual'));
}

main().catch((e) => {
  console.error('Gagal start:', e.message);
  process.exit(1);
});
