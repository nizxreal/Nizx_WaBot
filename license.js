'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('./package.json');

// URL Worker sengaja di-hardcode, bukan dari .env.
const API = 'https://botwa-license.nizxreal.workers.dev';

const DATA_DIR = path.join(__dirname, 'data');
const DEVICE_FILE = path.join(DATA_DIR, 'device.json');
const TOKEN_FILE = path.join(DATA_DIR, 'license.json');

const CHECK_MS = 3 * 60 * 60 * 1000; // validasi ulang tiap 3 jam
const RETRY_MS = 10 * 60 * 1000;     // coba lagi tiap 10 menit bila Worker tak terjangkau
const GRACE_MS = 6 * 60 * 60 * 1000; // batas maksimal offline

const state = { expiresAt: null, offset: 0, number: null, lastOkAt: 0 };
let timer = null;
let stopped = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTemporary = (reason) => reason === 'unreachable' || reason === 'server_error';
const resetState = () => {
  state.expiresAt = null;
  state.number = null;
  state.lastOkAt = 0;
};

const MESSAGES = {
  no_token: 'Token belum dimasukkan.',
  not_found: 'Token tidak ditemukan. Periksa lagi tokennya.',
  bad_request: 'Format token salah. Contoh: NIZXBOT-XXXX-XXXX-XXXX-XXXX.',
  expired: 'Masa aktif token habis. Hubungi pemilik untuk perpanjang, lalu tekan Cek ulang lisensi.',
  revoked: 'Token sudah dicabut oleh pemilik.',
  device_mismatch: 'Token sudah terikat ke perangkat lain. Hubungi pemilik.',
  number_mismatch: 'Token terikat ke nomor WhatsApp lain.',
  unreachable: 'Server lisensi tidak terjangkau. Periksa internet.',
  server_error: 'Server lisensi sedang bermasalah. Coba lagi nanti.',
  offline_too_long: 'Server lisensi tidak terjangkau lebih dari 6 jam.',
  manual: 'Dihentikan manual.',
};
const describe = (reason) => MESSAGES[reason] || `Ditolak (${reason}).`;

function getDeviceId() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const d = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    if (typeof d.deviceId === 'string' && d.deviceId.length >= 8) return d.deviceId;
  } catch {}
  const deviceId = crypto.randomUUID();
  fs.writeFileSync(DEVICE_FILE, JSON.stringify({ deviceId }, null, 2));
  return deviceId;
}

// Token dari dashboard (data/license.json) diutamakan, lalu .env.
function getStoredToken() {
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token;
    return typeof t === 'string' ? t.trim() : '';
  } catch {
    return '';
  }
}
const getToken = () => getStoredToken() || (process.env.LICENSE_TOKEN || '').trim();

function setToken(token) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }), { mode: 0o600 });
  resetState();
}
function clearToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
  resetState();
}

async function post(endpoint, body) {
  try {
    const res = await fetch(API + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!data || typeof data.ok !== 'boolean') return { ok: false, reason: 'unreachable' };
    return data;
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

async function check() {
  const token = getToken();
  if (!token) return { ok: false, reason: 'no_token' };
  const r = await post('/validate', { token, deviceId: getDeviceId(), version: pkg.version });
  if (r.ok) {
    state.expiresAt = r.expiresAt;
    state.offset = (r.serverTime || Date.now()) - Date.now(); // koreksi jam HP
    state.number = r.number || null;
    state.lastOkAt = Date.now();
  }
  return r;
}

const remainingMs = () => (state.expiresAt ? state.expiresAt - (Date.now() + state.offset) : 0);
const info = () => ({ expiresAt: state.expiresAt, remainingMs: remainingMs(), number: state.number });

async function bindNumber(number) {
  if (state.number === number) return { ok: true };
  for (let i = 0; i < 3; i++) {
    const r = await post('/bind-number', { token: getToken(), deviceId: getDeviceId(), number });
    if (r.ok) {
      state.number = number;
      return r;
    }
    if (!isTemporary(r.reason)) return r;
    await sleep(3000);
  }
  return { ok: false, reason: 'unreachable' };
}

function startLoop(onStop) {
  stopped = false;
  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  };
  const halt = (reason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    onStop(reason);
  };
  async function tick() {
    if (stopped) return;
    const r = await check();
    if (r.ok) return schedule(Math.min(CHECK_MS, Math.max(5000, remainingMs() + 2000)));
    if (isTemporary(r.reason)) {
      const offline = Date.now() - state.lastOkAt;
      if (offline >= GRACE_MS) return halt('offline_too_long');
      return schedule(Math.min(RETRY_MS, GRACE_MS - offline + 1000));
    }
    halt(r.reason);
  }
  schedule(Math.min(CHECK_MS, Math.max(5000, remainingMs() + 2000)));
}

function stopLoop() {
  stopped = true;
  clearTimeout(timer);
}

module.exports = {
  check, bindNumber, startLoop, stopLoop, remainingMs, info, describe,
  getDeviceId, getStoredToken, setToken, clearToken,
};
