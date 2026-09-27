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

// --- Sauvegarde distante (GitHub, dépôt privé) : les comptes et campagnes
// survivent aux redéploiements Render (disque éphémère). Sans GH_TOKEN,
// fonctionnement 100 % local comme avant (tests, dev).
const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_REPO = process.env.GH_DATA_REPO || 'vladbingo/tirage-pro-data';
const GH_PATH = 'data.json';
const GH_BRANCH = 'master';
let ghSha = null;
let ghPushTimer = null;
let ghPushing = false;

function ghHeaders() {
  return { 'Authorization': 'Bearer ' + GH_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'tirage-pro' };
}

async function ghFetchBackup() {
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`, { headers: ghHeaders() });
    if (r.status === 200) {
      const j = await r.json();
      ghSha = j.sha || null;
      const d = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      if (d && typeof d === 'object') return d;
    } else if (r.status === 404) { ghSha = null; }
  } catch (e) { /* hors-ligne : on reste en local */ }
  return null;
}

async function ghPushBackup() {
  if (!GH_TOKEN || ghPushing) return;
  ghPushing = true;
  try {
    const body = { message: 'sauvegarde auto TiragePro', content: Buffer.from(JSON.stringify(data)).toString('base64'), branch: GH_BRANCH };
    if (ghSha) body.sha = ghSha;
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`,
      { method: 'PUT', headers: Object.assign(ghHeaders(), { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (r.status === 200 || r.status === 201) {
      const j = await r.json().catch(() => ({}));
      ghSha = (j.content && j.content.sha) || ghSha;
    } else if (r.status === 422) { ghSha = null; } // sha périmé : on réessaiera
  } catch (e) { /* hors-ligne : le disque local garde tout */ }
  ghPushing = false;
}

function scheduleGhPush() {
  if (!GH_TOKEN || ghPushTimer) return;
  ghPushTimer = setTimeout(() => { ghPushTimer = null; ghPushBackup(); }, 8000);
}

// Au démarrage : si le disque local est vide, restaure depuis la sauvegarde.
// (On mute l'objet `data` en place : server.js le référence déjà.)
(async () => {
  if (!GH_TOKEN) return;
  const empty = !data.setupDone && (!data.users || data.users.length === 0);
  if (!empty) { scheduleGhPush(); return; }
  const backup = await ghFetchBackup();
  if (backup && (backup.setupDone || (backup.users && backup.users.length))) {
    Object.assign(data, blank(), backup);
    try { fs.writeFileSync(DATA_PATH, JSON.stringify(data)); } catch (e) {}
  }
})();

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 1));
    } catch (e) { /* disque plein etc. : on ignore, la mémoire reste la référence */ }
    scheduleGhPush();
  }, 400);
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 1)); } catch (e) {}
  scheduleGhPush();
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
