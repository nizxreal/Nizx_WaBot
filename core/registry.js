'use strict';
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const FEATURES_DIR = path.join(__dirname, '..', 'features');
const features = new Map();

function load() {
  features.clear();
  let files = [];
  try {
    files = fs.readdirSync(FEATURES_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  } catch {}
  for (const file of files) {
    try {
      const mod = require(path.join(FEATURES_DIR, file));
      if (typeof mod.run !== 'function' && typeof mod.onMessage !== 'function') {
        throw new Error('harus punya run() atau onMessage()');
      }
      const id = mod.id || path.basename(file, '.js');
      features.set(id, {
        id,
        name: mod.name || id,
        description: mod.description || '',
        defaultEnabled: mod.defaultEnabled !== false,
        allowFromMe: mod.allowFromMe === true,
        commands: (mod.commands || []).map((c) => String(c).toLowerCase()),
        run: mod.run,
        onMessage: mod.onMessage,
      });
    } catch (e) {
      console.error(`[registry] gagal memuat ${file}: ${e.message}`);
    }
  }
  return features.size;
}

function isEnabled(id) {
  const f = features.get(id);
  if (!f) return false;
  const v = settings.get().features[id];
  return v === undefined ? f.defaultEnabled : !!v;
}

const list = () =>
  [...features.values()].map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    commands: f.commands,
    enabled: isEnabled(f.id),
  }));

function setEnabled(id, enabled) {
  if (!features.has(id)) throw new Error('Fitur tidak ditemukan.');
  return settings.update({ features: { [id]: !!enabled } });
}

function unwrap(m) {
  let x = m;
  for (let i = 0; i < 5 && x; i++) {
    const inner =
      x.ephemeralMessage?.message ||
      x.viewOnceMessage?.message ||
      x.viewOnceMessageV2?.message ||
      x.documentWithCaptionMessage?.message ||
      x.editedMessage?.message;
    if (!inner) break;
    x = inner;
  }
  return x;
}

function getText(m) {
  const x = unwrap(m);
  return x?.conversation || x?.extendedTextMessage?.text || x?.imageMessage?.caption || x?.videoMessage?.caption || '';
}

async function handle(sock, msg) {
  if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast') return;

  // Abaikan pesan lama (backlog saat reconnect) supaya tidak membalas beruntun.
  const ts = Number(msg.messageTimestamp);
  if (ts && Date.now() / 1000 - ts > 120) return;

  const s = settings.get();
  const text = getText(msg.message).trim();
  const jid = msg.key.remoteJid;

  let command = null;
  let args = [];
  if (text && text.startsWith(s.prefix)) {
    const parts = text.slice(s.prefix.length).trim().split(/\s+/);
    command = (parts.shift() || '').toLowerCase() || null;
    args = parts;
  }

  const ctx = {
    sock,
    msg,
    jid,
    sender: msg.key.participant || jid,
    isGroup: jid.endsWith('@g.us'),
    isFromMe: !!msg.key.fromMe,
    text,
    command,
    args,
    prefix: s.prefix,
    settings: s,
    reply: (t) => sock.sendMessage(jid, { text: t }, { quoted: msg }),
  };

  for (const f of features.values()) {
    if (!isEnabled(f.id)) continue;
    if (ctx.isFromMe && !f.allowFromMe) continue;
    try {
      if (f.onMessage) await f.onMessage(ctx);
      if (command && f.run && f.commands.includes(command)) await f.run(ctx);
    } catch (e) {
      console.error(`[${f.id}] error: ${e.message}`);
    }
  }
}

module.exports = { load, list, isEnabled, setEnabled, handle };
