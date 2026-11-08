'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'settings.json');
const DEFAULTS = { prefix: '.', botName: 'Nizx WaBot', features: {} };

let cache = null;
let mtime = 0;

// Dibaca ulang otomatis bila file berubah, jadi tanpa restart bot.
function get() {
  try {
    const st = fs.statSync(FILE);
    if (!cache || st.mtimeMs !== mtime) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      cache = { ...DEFAULTS, ...raw, features: { ...(raw.features || {}) } };
      mtime = st.mtimeMs;
    }
  } catch {
    if (!cache) cache = { ...DEFAULTS, features: {} };
  }
  return cache;
}

function update(patch = {}) {
  const cur = get();
  const next = { ...cur, features: { ...cur.features, ...(patch.features || {}) } };
  if (patch.prefix !== undefined) {
    const p = String(patch.prefix).trim();
    if (!p || p.length > 3) throw new Error('Prefix harus 1-3 karakter.');
    next.prefix = p;
  }
  if (patch.botName !== undefined) {
    const n = String(patch.botName).trim();
    if (!n || n.length > 40) throw new Error('Nama bot 1-40 karakter.');
    next.botName = n;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  cache = next;
  mtime = fs.statSync(FILE).mtimeMs;
  return next;
}

module.exports = { get, update };
