// Mini-store JSON persistant pour TiragePro.
// Les comptes, campagnes et tickets survivent au redémarrage (data.json).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_PATH = process.env.TIRAGE_DATA || path.join(__dirname, 'data.json');

function blank() {
  return { setupDone: false, users: [], campaigns: [], tickets: [], sessions: {} };
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const d = JSON.parse(raw);
    const b = blank();
    return Object.assign(b, d);
  } catch (e) {
    return blank();
  }
}

let data = load();
let saveTimer = null;

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 1));
    } catch (e) { /* disque plein etc. : on ignore, la mémoire reste la référence */ }
  }, 400);
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 1)); } catch (e) {}
}

function uid(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

// --- Mots de passe : scrypt + sel ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) { return false; }
}

function publicUser(u) {
  if (!u) return null;
  const { passHash, salt, ...rest } = u;
  return rest;
}

function getUserByToken(token) {
  if (!token) return null;
  const uid_ = data.sessions[token];
  if (!uid_) return null;
  return data.users.find(u => u.id === uid_ && u.active !== false) || null;
}

function resetForTests() {
  data = blank();
  saveNow();
}

module.exports = {
  data, save, saveNow, uid, hashPassword, verifyPassword,
  publicUser, getUserByToken, resetForTests, DATA_PATH,
};
