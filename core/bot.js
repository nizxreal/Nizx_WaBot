'use strict';
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { EventEmitter } = require('events');

const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');
const logger = pino({ level: 'silent' });

// Dynamic import supaya jalan di Baileys build CommonJS maupun ESM.
let baileysPromise = null;
function loadBaileys() {
  if (!baileysPromise) {
    baileysPromise = import('@whiskeysockets/baileys').then((mod) => {
      const pick = (k) => mod[k] ?? (mod.default && mod.default[k]);
      const makeWASocket =
        typeof mod.makeWASocket === 'function'
          ? mod.makeWASocket
          : typeof mod.default === 'function'
          ? mod.default
          : mod.default && mod.default.default;
      return {
        makeWASocket,
        useMultiFileAuthState: pick('useMultiFileAuthState'),
        DisconnectReason: pick('DisconnectReason'),
        fetchLatestBaileysVersion: pick('fetchLatestBaileysVersion'),
        Browsers: pick('Browsers'),
      };
    });
  }
  return baileysPromise;
}

const digits = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

class Bot extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.gen = 0;
    this.status = 'idle'; // idle | connecting | qr | pairing | open | reconnecting | replaced | stopped
    this.qr = null;
    this.pairingCode = null;
    this.number = null;
    this.attempts = 0;
    this.pendingPair = null;
    this.reconnectTimer = null;
    this.stopped = false;
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  getStatus() {
    return { status: this.status, number: this.number, qr: this.qr, pairingCode: this.pairingCode };
  }

  hasSession() {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8'));
      return !!c.me;
    } catch {
      return false;
    }
  }

  wipeAuth() {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }

  closeSocket() {
    const s = this.sock;
    this.sock = null;
    if (!s) return;
    try {
      s.end(new Error('closed'));
    } catch {}
  }

  async start() {
    this.stopped = false;
    if (this.hasSession()) await this.connect();
    else this.setStatus('idle'); // belum pairing: tunggu pair() dari dashboard/terminal
  }

  async connect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    const gen = ++this.gen;
    this.closeSocket();
    try {
      const B = await loadBaileys();
      if (gen !== this.gen) return;
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const { state, saveCreds } = await B.useMultiFileAuthState(AUTH_DIR);

      const config = { auth: state, logger, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false };
      try {
        const v = await B.fetchLatestBaileysVersion();
        if (v && v.version) config.version = v.version;
      } catch {}
      if (B.Browsers && B.Browsers.ubuntu) config.browser = B.Browsers.ubuntu('Chrome');

      if (gen !== this.gen) return;
      const sock = B.makeWASocket(config);
      this.sock = sock;
      this.setStatus('connecting');

      sock.ev.on('creds.update', () => {
        if (gen === this.gen) saveCreds();
      });
      sock.ev.on('connection.update', (u) => this.onConnection(gen, B, u));
      sock.ev.on('messages.upsert', (ev) => {
        if (gen === this.gen) this.emit('messages', { sock, ...ev });
      });
    } catch (e) {
      console.error('[bot] gagal membuat koneksi:', e.message);
      if (gen === this.gen) this.scheduleReconnect();
    }
  }

  onConnection(gen, B, update) {
    if (gen !== this.gen) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (this.pendingPair) this.requestCode();
      else {
        this.qr = qr;
        this.setStatus('qr');
        this.emit('qr', qr);
      }
    }

    if (connection === 'open') {
      this.attempts = 0;
      this.qr = null;
      this.pairingCode = null;
      this.number = digits(this.sock && this.sock.user && this.sock.user.id);
      this.setStatus('open');
      this.emit('open', { number: this.number });
    }

    if (connection === 'close') {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : undefined;
      this.qr = null;
      this.pairingCode = null;
      const linked = !!(this.sock && this.sock.authState && this.sock.authState.creds && this.sock.authState.creds.me);

      if (code === B.DisconnectReason.loggedOut) {
        this.closeSocket();
        this.wipeAuth();
        this.number = null;
        this.setStatus('idle');
        this.emit('logged_out');
        return;
      }
      if (code === B.DisconnectReason.connectionReplaced) {
        this.closeSocket();
        this.setStatus('replaced');
        console.error('[bot] Sesi dipakai di tempat lain. Bot berhenti menyambung.');
        return;
      }
      if (this.stopped) return;
      // Pairing/QR belum selesai dan bukan restart normal: jangan menyambung terus.
      if (!linked && code !== B.DisconnectReason.restartRequired) {
        this.closeSocket();
        this.wipeAuth();
        this.pendingPair = null;
        this.setStatus('idle');
        return;
      }
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.attempts += 1;
    const delay = Math.min(30000, 2000 * this.attempts);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  async requestCode() {
    const p = this.pendingPair;
    this.pendingPair = null;
    if (!p || !this.sock) return;
    try {
      const code = await this.sock.requestPairingCode(p.number);
      this.pairingCode = code;
      this.setStatus('pairing');
      p.resolve(code);
    } catch (e) {
      this.setStatus('idle');
      p.reject(e);
    }
  }

  // Minta kode pairing untuk nomor (format 628xxx). Mengembalikan kode.
  async pair(number) {
    const n = String(number || '').replace(/\D/g, '');
    if (n.length < 8 || n.length > 15) throw new Error('Nomor tidak valid. Pakai format 628xxx tanpa + atau spasi.');
    if (this.status === 'open') throw new Error('Bot sudah terhubung. Logout dulu.');
    this.stopped = false;
    this.gen++;
    clearTimeout(this.reconnectTimer);
    this.closeSocket();
    this.wipeAuth();
    return new Promise((resolve, reject) => {
      this.pendingPair = { number: n, resolve, reject };
      this.connect().catch(reject);
      setTimeout(() => {
        if (this.pendingPair && this.pendingPair.resolve === resolve) {
          this.pendingPair = null;
          reject(new Error('Timeout meminta kode pairing. Coba lagi.'));
        }
      }, 30000);
    });
  }

  // Mulai sesi QR (untuk dashboard). QR terbaru ada di getStatus().qr.
  async startQr() {
    if (this.status === 'open') throw new Error('Bot sudah terhubung. Logout dulu.');
    this.stopped = false;
    this.gen++;
    clearTimeout(this.reconnectTimer);
    this.closeSocket();
    this.wipeAuth();
    this.pendingPair = null;
    await this.connect();
  }

  async logout() {
    const sock = this.sock;
    const wasOpen = this.status === 'open';
    this.gen++;
    clearTimeout(this.reconnectTimer);
    try {
      if (sock && wasOpen) await sock.logout();
    } catch {}
    this.closeSocket();
    this.wipeAuth();
    this.number = null;
    this.qr = null;
    this.pairingCode = null;
    this.setStatus('idle');
    this.emit('logged_out');
  }

  async sendToSelf(text) {
    if (!this.sock || this.status !== 'open' || !this.number) return false;
    await this.sock.sendMessage(`${this.number}@s.whatsapp.net`, { text });
    return true;
  }

  async stop() {
    this.stopped = true;
    this.gen++;
    clearTimeout(this.reconnectTimer);
    this.closeSocket();
    this.setStatus('stopped');
  }
}

module.exports = { Bot };
