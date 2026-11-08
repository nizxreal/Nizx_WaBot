'use strict';
require('dotenv').config({ quiet: true });

const fs = require('fs');
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

const bot = new Bot();
let dashboard = null;
let rl = null;
let shuttingDown = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (ms) => new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

// Satu pesan bermasalah tidak boleh mematikan bot.
process.on('unhandledRejection', (e) => console.error('[error]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('[error]', (e && e.message) || e));

async function shutdown(reason, { notify = false, code = 0 } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[bot] Berhenti: ${license.describe(reason)}`);
  license.stopLoop();
  if (notify) {
    try {
      await bot.sendToSelf('Masa aktif bot habis. Hubungi pemilik untuk perpanjang token, lalu jalankan ulang bot.');
      await sleep(2500);
    } catch {}
  }
  try { await bot.stop(); } catch {}
  try { if (dashboard && dashboard.stop) await dashboard.stop(); } catch {}
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



function menu() {
  if (dashboard) console.log(`\nTekan Enter untuk membuka dashboard (${DASH_URL})`);
  else console.log('\nDashboard tidak aktif (lihat pesan error di atas). Pairing hanya bisa lewat dashboard.');
  rl.once('line', async () => {
    if (dashboard) openUrl(DASH_URL);
    else console.log('Dashboard tidak aktif. Tutup bot lain yang memakai port 3000, lalu jalankan ulang.');
    menu();
  });
}

async function main() {
  console.log(`Nizx WaBot v${pkg.version}`);

  const r = await license.check();
  if (!r.ok) {
    console.error(`Lisensi gagal: ${license.describe(r.reason)}`);
    process.exit(1);
  }
  const days = Math.max(0, Math.ceil(license.remainingMs() / 86400000));
  console.log(`Lisensi valid sampai ${fmtDate(r.expiresAt)} (sisa ${days} hari)`);
  console.log(`Fitur dimuat: ${registry.load()}`);

  bot.on('status', (s) => console.log(`[bot] status: ${s}`));
  bot.on('messages', async ({ sock, messages, type }) => {
    if (type !== 'notify') return;
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
    shutdown(b.reason, { code: 1 });
  });

  license.startLoop((reason) => shutdown(reason, { notify: reason === 'expired', code: 1 }));
  await bot.start();

  const dashFile = path.join(__dirname, 'dashboard', 'server.js');
  if (fs.existsSync(dashFile)) {
    try {
      dashboard = require(dashFile);
      await dashboard.start({ bot, license, registry, settings, host: DASH_HOST, port: DASH_PORT });
    } catch (e) {
      console.error('[dashboard] gagal start:', e.message);
      dashboard = null;
    }
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
