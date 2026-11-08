'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');

let server = null;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const mask = (n) => `${n.slice(0, 4)}***${n.slice(-3)}`;

async function start({ bot, license, registry, settings, host = '127.0.0.1', port = 3000 }) {
  if (host !== '127.0.0.1') throw new Error('Dashboard hanya boleh bind ke 127.0.0.1');

  let password = (process.env.DASHBOARD_PASSWORD || '').trim();
  if (!password) {
    password = crypto.randomBytes(6).toString('hex');
    console.log(`[dashboard] DASHBOARD_PASSWORD kosong. Password sesi ini: ${password}`);
    console.log('[dashboard] Isi DASHBOARD_PASSWORD di .env agar password tetap.');
  }

  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  // ---- sesi ----
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
  let fails = [];
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

  api.post('/login', (req, res) => {
    const now = Date.now();
    fails = fails.filter((t) => now - t < 60000);
    if (fails.length >= 5) return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Tunggu 1 menit.' });
    const given = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!safeEqual(given, password)) {
      fails.push(now);
      return res.status(401).json({ ok: false, error: 'Password salah' });
    }
    const t = crypto.randomBytes(24).toString('hex');
    sessions.set(t, now + SESSION_MS);
    res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    res.json({ ok: true });
  });

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
      res.json({
        ok: true,
        bot: { status: b.status, number: b.number, pairingCode: b.pairingCode, qr: await qrImage(b.qr) },
        license: { expiresAt: l.expiresAt, days: Math.max(0, Math.ceil(l.remainingMs / 86400000)), number: l.number },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

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

module.exports = { start, stop };
