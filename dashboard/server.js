'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PASS_FILE = path.join(DATA_DIR, 'dashboard.json');

let server = null;
let setupCode = null;
let setupFails = 0;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const mask = (n) => `${n.slice(0, 4)}***${n.slice(-3)}`;
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const envPassword = () => (process.env.DASHBOARD_PASSWORD || '').trim();
const hasPassword = () => !!envPassword() || fs.existsSync(PASS_FILE);

function savePassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PASS_FILE, JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex') }), { mode: 0o600 });
}

function checkPassword(pw) {
  const env = envPassword();
  if (env) return safeEqual(pw, env);
  try {
    const { salt, hash } = JSON.parse(fs.readFileSync(PASS_FILE, 'utf8'));
    const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

async function start({ bot, license, registry, settings, ctl, host = '127.0.0.1', port = 3000 }) {
  if (host !== '127.0.0.1') throw new Error('Dashboard hanya boleh bind ke 127.0.0.1');
  if (!hasPassword()) {
    setupCode = newCode();
    setupFails = 0;
  }

  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  const SESSION_MS = 12 * 60 * 60 * 1000;
  const sessions = new Map();
  const cookieSid = (req) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]{48})/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  const isAuthed = (req) => {
    const t = cookieSid(req);
    const exp = t && sessions.get(t);
    if (!exp) return false;
    if (exp < Date.now()) {
      sessions.delete(t);
      return false;
    }
    return true;
  };
  const issueSession = (res) => {
    const t = crypto.randomBytes(24).toString('hex');
    sessions.set(t, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
  };

  let fails = [];
  const tooMany = () => {
    const now = Date.now();
    fails = fails.filter((t) => now - t < 60000);
    return fails.length >= 5;
  };
  let lastPair = 0;
  let qrCache = { raw: null, img: null };
  async function qrImage(raw) {
    if (!raw) return null;
    if (qrCache.raw !== raw) qrCache = { raw, img: await QRCode.toDataURL(raw, { margin: 1, width: 280 }) };
    return qrCache.img;
  }

  const app = express();
  app.disable('x-powered-by');

  // Anti DNS rebinding: hanya terima Host lokal.
  app.use((req, res, next) => {
    if (!hosts.has(req.headers.host)) return res.status(403).end('Forbidden');
    next();
  });
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
    next();
  });
  // Anti CSRF: POST harus dari origin lokal dan berformat JSON.
  app.use((req, res, next) => {
    if (req.method === 'POST') {
      const o = req.headers.origin;
      if (o && !origins.has(o)) return res.status(403).json({ ok: false, error: 'Origin ditolak' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Harus JSON' });
    }
    next();
  });
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

  const api = express.Router();

  // ---- tanpa login ----
  api.get('/state', (req, res) => res.json({ ok: true, needsSetup: !hasPassword(), authed: isAuthed(req) }));

  api.post('/setup', async (req, res) => {
    try {
      if (hasPassword()) throw new Error('Pengaturan awal sudah selesai. Masuk dengan password.');
      if (tooMany()) return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Tunggu 1 menit.' });
      const b = req.body || {};
      const given = typeof b.code === 'string' ? b.code.trim() : '';
      if (!setupCode || !safeEqual(given, setupCode)) {
        fails.push(Date.now());
        setupFails += 1;
        if (setupFails >= 10) {
          setupCode = newCode();
          setupFails = 0;
          console.log(`[dashboard] Terlalu banyak kode salah. Kode setup baru: ${setupCode}`);
        }
        throw new Error('Kode setup salah. Lihat kode di Termux.');
      }
      const password = typeof b.password === 'string' ? b.password : '';
      if (password.length < 8) throw new Error('Password minimal 8 karakter.');
      if (ctl.getMode() !== 'running' || String(b.token || '').trim()) {
        const r = await ctl.submitToken(b.token);
        if (!r.ok) throw new Error(r.error);
      }
      savePassword(password);
      setupCode = null;
      issueSession(res);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  api.post('/login', (req, res) => {
    if (!hasPassword()) return res.status(400).json({ ok: false, error: 'Selesaikan pengaturan awal dulu.' });
    if (tooMany()) return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Tunggu 1 menit.' });
    const given = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!checkPassword(given)) {
      fails.push(Date.now());
      return res.status(401).json({ ok: false, error: 'Password salah' });
    }
    issueSession(res);
    res.json({ ok: true });
  });

  // ---- wajib login ----
  api.use((req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ ok: false, error: 'Belum login' })));

  api.post('/signout', (req, res) => {
    sessions.delete(cookieSid(req));
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  api.get('/status', async (req, res) => {
    try {
      const b = bot.getStatus();
      const l = license.info();
      const mode = ctl.getMode();
      res.json({
        ok: true,
        mode,
        reasonText: mode === 'running' ? '' : ctl.getReasonText(),
        bot: { hasSession: bot.hasSession(), status: b.status, number: b.number, pairingCode: b.pairingCode, qr: await qrImage(b.qr) },
        license: { expiresAt: l.expiresAt, days: Math.max(0, Math.ceil((l.remainingMs || 0) / 86400000)), number: l.number },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  api.post('/license/token', async (req, res) => {
    try {
      const r = await ctl.submitToken(req.body && req.body.token);
      res.status(r.ok ? 200 : 400).json(r);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  api.post('/license/recheck', async (req, res) => {
    try {
      const r = await ctl.recheck();
      res.status(r.ok ? 200 : 400).json(r);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Pairing dan kontrol bot hanya saat lisensi aktif.
  api.use(['/pair', '/logout', '/bot'], (req, res, next) =>
    ctl.getMode() === 'running'
      ? next()
      : res.status(403).json({ ok: false, error: 'Lisensi belum aktif. Masukkan token atau cek ulang lisensi.' })
  );

  api.post('/pair', async (req, res) => {
    try {
      if (Date.now() - lastPair < 5000) throw new Error('Tunggu beberapa detik sebelum mencoba lagi.');
      lastPair = Date.now();
      const body = req.body || {};
      if (body.mode === 'qr') {
        await bot.startQr();
        return res.json({ ok: true });
      }
      const number = String(body.number || '').replace(/\D/g, '');
      const bound = license.info().number;
      if (bound && bound !== number) throw new Error(`Token ini terikat ke nomor ${mask(bound)}. Pakai nomor itu.`);
      const code = await bot.pair(number);
      res.json({ ok: true, code });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  api.post('/logout', async (req, res) => {
    try {
      await bot.logout();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  api.get('/settings', (req, res) => {
    const s = settings.get();
    res.json({ ok: true, settings: { prefix: s.prefix, botName: s.botName }, features: registry.list() });
  });

  api.post('/settings', (req, res) => {
    try {
      const b = req.body || {};
      const patch = {};
      if (b.prefix !== undefined) patch.prefix = b.prefix;
      if (b.botName !== undefined) patch.botName = b.botName;
      if (Object.keys(patch).length) settings.update(patch);
      if (b.features && typeof b.features === 'object') {
        for (const [id, v] of Object.entries(b.features)) {
          if (typeof v !== 'boolean') throw new Error('Nilai fitur harus true atau false.');
          registry.setEnabled(id, v);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  require('./control')(api, bot);
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ ok: false, error: err.status === 400 ? 'JSON tidak valid' : 'Kesalahan server' });
  });

  await new Promise((resolve, reject) => {
    const s = http.createServer(app);
    s.once('error', reject);
    s.listen(port, host, () => {
      server = s;
      resolve();
    });
  });
  console.log(`[dashboard] aktif di http://${host}:${port}`);
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    try {
      server.closeAllConnections && server.closeAllConnections();
    } catch {}
    server.close(() => resolve());
  });
}

module.exports = { start, stop, setupCode: () => setupCode, needsSetup: () => !hasPassword() };
