// TiragePro — plateforme de tirages au sort (roue) et tickets à gratter pour commerçants.
// - Un compte super-admin (Vlad) : crée les accès commerçants, voit tout.
// - Comptes commerçants : uniquement ce que l'admin leur a autorisé.
// - Clients : participent via lien / QR, sans compte.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');
const store = require('./store');

const app = express();
app.use(express.json({ limit: '1mb' }));

const { data, save, saveNow, uid, hashPassword, verifyPassword, publicUser, getUserByToken } = store;

// ---------- Utilitaires ----------
function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || req.protocol;
  return `${proto}://${req.get('host')}`;
}
function publicLink(req, campaignId) {
  return `${baseUrl(req)}/#/p/${campaignId}`;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickWinners(participants, alreadyWonIds, count) {
  const pool = participants.filter(p => !alreadyWonIds.has(p.id));
  const winners = [];
  const cp = pool.slice();
  while (winners.length < count && cp.length > 0) {
    winners.push(cp.splice(crypto.randomInt(cp.length), 1)[0]);
  }
  return winners;
}

// ---------- Auth ----------
function tokenFrom(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}
function auth(req, res, next) {
  const u = getUserByToken(tokenFrom(req));
  if (!u) return res.status(401).json({ error: 'Non connecté' });
  req.user = u;
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}
// Petit anti-bruteforce sur /login et /setup (mémoire, par IP)
const attempts = new Map();
function throttle(req, res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (now < rec.until) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute.' });
  req._ipRec = rec; req._ip = ip;
  next();
}
function failAttempt(req) {
  const rec = req._ipRec; if (!rec) return;
  rec.n += 1;
  if (rec.n >= 8) { rec.until = Date.now() + 60000; rec.n = 0; }
  attempts.set(req._ip, rec);
}

function issueToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  data.sessions[token] = user.id;
  save();
  return token;
}

// POST /api/setup — création du compte super-admin (une seule fois)
app.get('/api/status', (req, res) => res.json({ setupDone: !!data.setupDone }));

app.post('/api/setup', throttle, (req, res) => {
  if (data.setupDone || data.users.length > 0) return res.status(400).json({ error: 'Déjà configuré' });
  const { username, password } = req.body || {};
  if (!username || String(username).length < 3) return res.status(400).json({ error: 'Nom d\'utilisateur trop court (3 min).' });
  if (!password || String(password).length < 6) { failAttempt(req); return res.status(400).json({ error: 'Mot de passe trop court (6 min).' }); }
  const { salt, hash } = hashPassword(String(password));
  const user = { id: uid('u'), role: 'superadmin', username: String(username).trim(), salt, passHash: hash, createdAt: Date.now(), active: true };
  data.users.push(user);
  data.setupDone = true;
  const token = issueToken(user);
  save();
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', throttle, (req, res) => {
  const { username, password } = req.body || {};
  const u = data.users.find(x => x.username === String(username || '').trim());
  if (!u || u.active === false || !verifyPassword(String(password || ''), u.salt, u.passHash)) {
    failAttempt(req);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  const token = issueToken(u);
  res.json({ token, user: publicUser(u) });
});

app.post('/api/logout', auth, (req, res) => {
  delete data.sessions[tokenFrom(req)];
  save();
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

// Changement de mot de passe (soi-même)
app.post('/api/password', auth, (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min).' });
  const { salt, hash } = hashPassword(String(password));
  req.user.salt = salt; req.user.passHash = hash;
  save();
  res.json({ ok: true });
});

// ---------- Super-admin : gestion des commerçants ----------
app.get('/api/admin/merchants', auth, requireRole('superadmin'), (req, res) => {
  res.json({ merchants: data.users.filter(u => u.role === 'merchant').map(publicUser) });
});

app.post('/api/admin/merchants', auth, requireRole('superadmin'), (req, res) => {
  const { username, password, merchantName, perms } = req.body || {};
  if (!username || String(username).trim().length < 3) return res.status(400).json({ error: 'Identifiant trop court (3 min).' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min).' });
  if (data.users.some(u => u.username === String(username).trim())) return res.status(400).json({ error: 'Cet identifiant existe déjà.' });
  const { salt, hash } = hashPassword(String(password));
  const m = {
    id: uid('u'), role: 'merchant',
    username: String(username).trim(),
    merchantName: String(merchantName || username).trim().slice(0, 80),
    salt, passHash: hash,
    perms: {
      raffle: !!(perms && perms.raffle),
      scratch: !!(perms && perms.scratch),
      maxCampaigns: Math.max(1, Math.min(100, parseInt((perms && perms.maxCampaigns) || 10, 10) || 10)),
    },
    active: true, createdAt: Date.now(),
  };
  if (!m.perms.raffle && !m.perms.scratch) m.perms.raffle = true;
  data.users.push(m);
  save();
  res.json({ merchant: publicUser(m) });
});

app.patch('/api/admin/merchants/:id', auth, requireRole('superadmin'), (req, res) => {
  const m = data.users.find(u => u.id === req.params.id && u.role === 'merchant');
  if (!m) return res.status(404).json({ error: 'Commerçant introuvable' });
  const { merchantName, perms, active, password } = req.body || {};
  if (merchantName !== undefined) m.merchantName = String(merchantName).slice(0, 80) || m.merchantName;
  if (perms !== undefined) {
    if (perms.raffle !== undefined) m.perms.raffle = !!perms.raffle;
    if (perms.scratch !== undefined) m.perms.scratch = !!perms.scratch;
    if (perms.maxCampaigns !== undefined) m.perms.maxCampaigns = Math.max(1, Math.min(100, parseInt(perms.maxCampaigns, 10) || 10));
    if (!m.perms.raffle && !m.perms.scratch) m.perms.raffle = true;
  }
  if (active !== undefined) m.active = !!active;
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min).' });
    const { salt, hash } = hashPassword(String(password));
    m.salt = salt; m.passHash = hash;
  }
  save();
  res.json({ merchant: publicUser(m) });
});

app.delete('/api/admin/merchants/:id', auth, requireRole('superadmin'), (req, res) => {
  const idx = data.users.findIndex(u => u.id === req.params.id && u.role === 'merchant');
  if (idx < 0) return res.status(404).json({ error: 'Commerçant introuvable' });
  const mid = data.users[idx].id;
  // Suppression en cascade : campagnes + tickets + sessions
  data.campaigns = data.campaigns.filter(c => c.merchantId !== mid);
  const keepTickets = new Set(data.campaigns.map(c => c.id));
  data.tickets = data.tickets.filter(t => keepTickets.has(t.campaignId));
  for (const t of Object.keys(data.sessions)) if (data.sessions[t] === mid) delete data.sessions[t];
  data.users.splice(idx, 1);
  save();
  res.json({ ok: true });
});

app.get('/api/admin/stats', auth, requireRole('superadmin'), (req, res) => {
  const merchants = data.users.filter(u => u.role === 'merchant');
  const participants = data.campaigns.reduce((n, c) => n + (c.participants || []).length, 0);
  res.json({
    merchants: merchants.length,
    merchantsActive: merchants.filter(m => m.active !== false).length,
    campaigns: data.campaigns.length,
    participants,
    ticketsIssued: data.tickets.filter(t => t.claimedAt).length,
  });
});

app.get('/api/admin/campaigns', auth, requireRole('superadmin'), (req, res) => {
  const list = data.campaigns.map(c => {
    const m = data.users.find(u => u.id === c.merchantId);
    return { ...summarize(c), merchantName: m ? m.merchantName : '—' };
  });
  res.json({ campaigns: list });
});

function summarize(c) {
  const s = {
    id: c.id, type: c.type, title: c.title, description: c.description,
    status: c.status, createdAt: c.createdAt,
    participants: (c.participants || []).length,
    winners: (c.winners || []).length,
  };
  if (c.type === 'scratch') {
    const total = data.tickets.filter(t => t.campaignId === c.id).length;
    const issued = data.tickets.filter(t => t.campaignId === c.id && t.claimedAt).length;
    const won = data.tickets.filter(t => t.campaignId === c.id && t.revealedAt && t.prizeIdx !== null && t.prizeIdx !== undefined).length;
    s.tickets = { total, issued, won };
  }
  return s;
}

// ---------- Commerçant : campagnes ----------
function ownCampaign(req, res, next) {
  const c = data.campaigns.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Campagne introuvable' });
  if (req.user.role === 'merchant' && c.merchantId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  req.campaign = c;
  next();
}

app.get('/api/merchant/campaigns', auth, requireRole('merchant'), (req, res) => {
  const list = data.campaigns.filter(c => c.merchantId === req.user.id).map(summarize);
  res.json({ campaigns: list });
});

app.post('/api/merchant/campaigns', auth, requireRole('merchant'), (req, res) => {
  const b = req.body || {};
  const type = b.type;
  if (type !== 'raffle' && type !== 'scratch') return res.status(400).json({ error: 'Type invalide' });
  if (!req.user.perms[type]) return res.status(403).json({ error: 'Ton accès ne permet pas ce type de campagne. Demande à l\'administrateur.' });
  const mine = data.campaigns.filter(c => c.merchantId === req.user.id).length;
  if (mine >= req.user.perms.maxCampaigns) return res.status(403).json({ error: `Limite atteinte (${req.user.perms.maxCampaigns} campagnes max).` });
  const title = String(b.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'Titre requis' });

  const camp = {
    id: uid('c'), merchantId: req.user.id, type, title,
    description: String(b.description || '').slice(0, 500),
    status: 'open', createdAt: Date.now(), drawing: false,
  };

  if (type === 'raffle') {
    const prizes = (Array.isArray(b.prizes) ? b.prizes : []).map(p => String(p).trim().slice(0, 60)).filter(Boolean).slice(0, 20);
    if (!prizes.length) return res.status(400).json({ error: 'Ajoute au moins un lot à gagner.' });
    camp.prizes = prizes;
    camp.maxWinners = Math.max(1, Math.min(50, parseInt(b.maxWinners, 10) || 1));
    camp.requirePhone = !!b.requirePhone;
    camp.participants = [];
    camp.winners = [];
  } else {
    const prizes = (Array.isArray(b.prizes) ? b.prizes : [])
      .map(p => ({ label: String(p.label || '').trim().slice(0, 60), qty: Math.max(1, Math.min(10000, parseInt(p.qty, 10) || 1)) }))
      .filter(p => p.label).slice(0, 20);
    if (!prizes.length) return res.status(400).json({ error: 'Ajoute au moins un lot.' });
    const losers = Math.max(0, Math.min(50000, parseInt(b.losers, 10) || 0));
    camp.prizes = prizes;
    camp.perClient = Math.max(1, Math.min(10, parseInt(b.perClient, 10) || 1));
    camp.requirePhone = b.requirePhone !== false;
    // Pré-génère les tickets, lots mélangés
    const bag = [];
    prizes.forEach((p, i) => { for (let k = 0; k < p.qty; k++) bag.push(i); });
    for (let k = 0; k < losers; k++) bag.push(null);
    const mixed = shuffle(bag);
    const now = Date.now();
    mixed.forEach((prizeIdx, k) => {
      data.tickets.push({
        id: uid('t'), campaignId: camp.id, code: crypto.randomBytes(3).toString('hex').toUpperCase(),
        prizeIdx, claimedBy: null, claimedAt: null, revealedAt: null, createdAt: now + k,
      });
    });
  }
  data.campaigns.push(camp);
  save();
  res.json({ campaign: summarize(camp) });
});

app.get('/api/merchant/campaigns/:id', auth, requireRole('merchant'), ownCampaign, (req, res) => {
  const c = req.campaign;
  const detail = { ...summarize(c), description: c.description, prizes: c.prizes };
  if (c.type === 'raffle') {
    detail.participants = c.participants;
    detail.winners = c.winners;
    detail.maxWinners = c.maxWinners;
    detail.requirePhone = c.requirePhone;
  } else {
    detail.perClient = c.perClient;
    detail.requirePhone = c.requirePhone;
    detail.recentTickets = data.tickets.filter(t => t.campaignId === c.id && t.claimedAt)
      .sort((a, b) => b.claimedAt - a.claimedAt).slice(0, 30)
      .map(t => ({ code: t.code, by: t.claimedBy, at: t.claimedAt, prize: t.prizeIdx === null || t.prizeIdx === undefined ? null : c.prizes[t.prizeIdx].label, revealed: !!t.revealedAt }));
  }
  res.json({ campaign: detail });
});

app.patch('/api/merchant/campaigns/:id', auth, requireRole('merchant'), ownCampaign, (req, res) => {
  const c = req.campaign;
  const { title, description, status } = req.body || {};
  if (title !== undefined) c.title = String(title).trim().slice(0, 80) || c.title;
  if (description !== undefined) c.description = String(description).slice(0, 500);
  if (status !== undefined) {
    if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    c.status = status;
    broadcast(c.id, { t: 'closed', status });
  }
  save();
  res.json({ campaign: summarize(c) });
});

app.delete('/api/merchant/campaigns/:id', auth, requireRole('merchant'), ownCampaign, (req, res) => {
  data.campaigns = data.campaigns.filter(x => x.id !== req.campaign.id);
  data.tickets = data.tickets.filter(t => t.campaignId !== req.campaign.id);
  save();
  res.json({ ok: true });
});

// QR code du lien public
app.get('/api/merchant/campaigns/:id/qr', auth, requireRole('merchant'), ownCampaign, async (req, res) => {
  try {
    const url = await QRCode.toDataURL(publicLink(req, req.campaign.id), { width: 300, margin: 1 });
    res.json({ qr: url, link: publicLink(req, req.campaign.id) });
  } catch (e) { res.status(500).json({ error: 'QR impossible' }); }
});

// ---------- Tirage roue (commerçant) ----------
app.post('/api/merchant/campaigns/:id/draw', auth, requireRole('merchant'), ownCampaign, (req, res) => {
  const c = req.campaign;
  if (c.type !== 'raffle') return res.status(400).json({ error: 'Pas un tirage au sort' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Campagne fermée' });
  if (c.drawing) return res.status(409).json({ error: 'Tirage déjà en cours' });
  const wonIds = new Set((c.winners || []).map(w => w.participantId));
  const remaining = c.participants.filter(p => !wonIds.has(p.id));
  if (!remaining.length) return res.status(400).json({ error: 'Aucun participant restant' });
  const count = Math.max(1, Math.min(c.maxWinners, parseInt((req.body || {}).count, 10) || 1, remaining.length));
  const winners = pickWinners(c.participants, wonIds, count);
  // Attribution des lots dans l'ordre
  const results = winners.map((p, i) => ({
    participantId: p.id, name: p.name,
    prize: c.prizes[(c.winners.length + i) % c.prizes.length],
  }));
  // Ordre stable des participants pour synchroniser les roues
  const order = c.participants.map(p => ({ id: p.id, name: p.name }));
  const winnerIndexes = results.map(r => order.findIndex(o => o.id === r.participantId));

  c.drawing = true;
  save();
  const spinDuration = 6500;
  broadcast(c.id, { t: 'spin', order, winnerIndexes, results, duration: spinDuration });

  setTimeout(() => {
    const cc = data.campaigns.find(x => x.id === c.id);
    if (!cc) return;
    cc.drawing = false;
    results.forEach(r => cc.winners.push({ ...r, at: Date.now() }));
    save();
    broadcast(c.id, { t: 'draw_end', winners: cc.winners });
  }, spinDuration + 800);

  res.json({ results, order, winnerIndexes, duration: spinDuration });
});

// ---------- Public : clients ----------
function publicCampaign(c, req) {
  const m = data.users.find(u => u.id === c.merchantId);
  const base = {
    id: c.id, type: c.type, title: c.title, description: c.description,
    status: c.status, merchantName: m ? m.merchantName : '',
    participants: (c.participants || []).length,
    winners: (c.winners || []).map(w => ({ name: w.name, prize: w.prize })),
  };
  if (c.type === 'raffle') {
    base.prizes = c.prizes;
    base.requirePhone = c.requirePhone;
    base.drawing = !!c.drawing;
  } else {
    base.prizes = c.prizes.map(p => p.label);
    const total = data.tickets.filter(t => t.campaignId === c.id).length;
    const left = data.tickets.filter(t => t.campaignId === c.id && !t.claimedAt).length;
    base.ticketsLeft = left; base.ticketsTotal = total;
    base.requirePhone = c.requirePhone;
    base.perClient = c.perClient;
  }
  return base;
}

app.get('/api/p/:id', (req, res) => {
  const c = data.campaigns.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Campagne introuvable' });
  res.json({ campaign: publicCampaign(c, req) });
});

// Inscription au tirage
app.post('/api/p/:id/join', (req, res) => {
  const c = data.campaigns.find(x => x.id === req.params.id && x.type === 'raffle');
  if (!c) return res.status(404).json({ error: 'Tirage introuvable' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Inscriptions fermées' });
  if (c.drawing) return res.status(409).json({ error: 'Tirage en cours, réessaie dans un moment' });
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  const phone = String((req.body || {}).phone || '').trim().slice(0, 30);
  if (!name) return res.status(400).json({ error: 'Ton nom est requis' });
  if (c.requirePhone && !phone) return res.status(400).json({ error: 'Ton téléphone est requis' });
  if (c.participants.length >= 5000) return res.status(400).json({ error: 'Tirage complet' });
  const key = (phone || name).toLowerCase();
  if (c.participants.some(p => ((p.phone || p.name).toLowerCase()) === key)) {
    return res.status(400).json({ error: 'Tu es déjà inscrit(e) !' });
  }
  const p = { id: uid('p'), name, phone, at: Date.now() };
  c.participants.push(p);
  save();
  broadcast(c.id, { t: 'joined', count: c.participants.length });
  res.json({ ok: true, participant: { id: p.id, name: p.name } });
});

// Ticket à gratter : attribution
app.post('/api/p/:id/ticket', (req, res) => {
  const c = data.campaigns.find(x => x.id === req.params.id && x.type === 'scratch');
  if (!c) return res.status(404).json({ error: 'Campagne introuvable' });
  if (c.status !== 'open') return res.status(400).json({ error: 'Campagne terminée' });
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  const phone = String((req.body || {}).phone || '').trim().slice(0, 30);
  if (!name) return res.status(400).json({ error: 'Ton nom est requis' });
  if (c.requirePhone && !phone) return res.status(400).json({ error: 'Ton téléphone est requis' });
  const key = (phone || name).toLowerCase();
  const mine = data.tickets.filter(t => t.campaignId === c.id && t.claimedAt && ((t.claimedBy.phone || t.claimedBy.name).toLowerCase()) === key);
  if (mine.length >= c.perClient) return res.status(403).json({ error: `Limite de ${c.perClient} ticket(s) par personne.` });
  const t = data.tickets.filter(x => x.campaignId === c.id && !x.claimedAt).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!t) return res.status(400).json({ error: 'Plus de tickets disponibles' });
  t.claimedBy = { name, phone };
  t.claimedAt = Date.now();
  save();
  res.json({ ticketId: t.id, code: t.code });
});

// Révélation du ticket (après grattage côté client)
app.post('/api/p/:id/ticket/:tid/reveal', (req, res) => {
  const c = data.campaigns.find(x => x.id === req.params.id && x.type === 'scratch');
  if (!c) return res.status(404).json({ error: 'Campagne introuvable' });
  const t = data.tickets.find(x => x.id === req.params.tid && x.campaignId === c.id && x.claimedAt);
  if (!t) return res.status(404).json({ error: 'Ticket introuvable' });
  if (!t.revealedAt) { t.revealedAt = Date.now(); save(); }
  const prize = (t.prizeIdx === null || t.prizeIdx === undefined) ? null : c.prizes[t.prizeIdx].label;
  res.json({ prize, code: t.code });
});

// ---------- WebSocket temps réel ----------
const rooms = new Map(); // campaignId -> Set<ws>
function broadcast(campaignId, msg) {
  const set = rooms.get(campaignId);
  if (!set) return;
  const payload = JSON.stringify(msg);
  for (const ws of set) {
    try { if (ws.readyState === 1) ws.send(payload); } catch (e) {}
  }
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/ws') { socket.destroy(); return; }
    const campaignId = u.searchParams.get('campaign');
    if (!campaignId || !data.campaigns.some(c => c.id === campaignId)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!rooms.has(campaignId)) rooms.set(campaignId, new Set());
      rooms.get(campaignId).add(ws);
      ws.on('close', () => { const s = rooms.get(campaignId); if (s) s.delete(ws); });
    });
  } catch (e) { try { socket.destroy(); } catch (_) {} }
});

// ---------- Statique ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`🎡 TiragePro en ligne sur http://localhost:${PORT}`));
}

module.exports = { app, server, broadcast, store };
