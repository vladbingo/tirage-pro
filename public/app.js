/* TiragePro — frontend */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}
async function api(path, opts) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  const tok = localStorage.getItem('tp_token');
  if (tok) headers['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
  return j;
}
function show(id) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) location.hash = go.getAttribute('data-go');
});

/* ---------- Sons ---------- */
let AC = null;
function beep(freq, dur, when, type) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, AC.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.25, AC.currentTime + when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + when + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(AC.currentTime + when); o.stop(AC.currentTime + when + dur + 0.05);
  } catch (e) {}
}
function fanfare() { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.35, i * 0.13, 'triangle')); }
function clickSnd() { beep(700, 0.08, 0, 'square'); }

/* ---------- Confettis ---------- */
function confetti() {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99;';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#f5c451', '#fff', '#b678ff', '#37d67a', '#ff5d5d'];
  const ps = Array.from({ length: 140 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.3,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI, vr: -0.1 + Math.random() * 0.2,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (++frames < 220) requestAnimationFrame(tick); else c.remove();
  })();
}

/* ---------- WebSocket campagne ---------- */
let ws = null;
function connectWS(campaignId, onMsg) {
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?campaign=${campaignId}`);
  ws.onmessage = (ev) => { try { onMsg(JSON.parse(ev.data)); } catch (e) {} };
  ws.onclose = () => { setTimeout(() => { if (location.hash.includes(campaignId)) connectWS(campaignId, onMsg); }, 4000); };
}

/* ---------- ROUE ---------- */
const WHEEL_COLORS = ['#f5c451', '#7b4fd6', '#e0a92e', '#5a379e', '#ffd97a', '#8f6ae0'];
function drawWheel(canvas, names, rotationDeg) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width, cx = S / 2, cy = S / 2, R = S / 2 - 6;
  ctx.clearRect(0, 0, S, S);
  const n = Math.max(names.length, 1);
  const seg = (Math.PI * 2) / n;
  const rot = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * seg, a1 = a0 + seg;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.stroke();
    // texte
    const mid = a0 + seg / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(mid);
    ctx.textAlign = 'right'; ctx.fillStyle = i % 2 ? '#fff' : '#3a2503';
    const fs = n > 24 ? 11 : n > 12 ? 14 : 18;
    ctx.font = `700 ${fs}px sans-serif`;
    const label = names[i].length > 14 ? names[i].slice(0, 13) + '…' : names[i];
    ctx.fillText(R - 14, fs / 3, label);
    ctx.restore();
  }
  // bordure
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = 8; ctx.strokeStyle = '#f5c451'; ctx.stroke();
}
// Anime la roue pour que le segment winnerIdx finisse sous le pointeur (en haut)
function spinWheel(canvas, names, winnerIdx, durationMs, onDone) {
  const n = names.length;
  const segDeg = 360 / n;
  const cur = canvas._rot || 0;
  const center = (winnerIdx + 0.5) * segDeg;
  const jitter = (Math.random() - 0.5) * segDeg * 0.5;
  let target = (270 - center + jitter) % 360; // 270° = haut
  if (target < 0) target += 360;
  const curMod = ((cur % 360) + 360) % 360;
  let delta = target - curMod;
  if (delta < 0) delta += 360;
  const total = 360 * 6 + delta;
  const start = performance.now();
  let lastTick = 0;
  (function frame(now) {
    const t = Math.min((now - start) / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const rot = cur + total * eased;
    canvas._rot = rot;
    drawWheel(canvas, names, rot);
    if (now - lastTick > 90) { lastTick = now; beep(300 + t * 500, 0.03, 0, 'square'); }
    if (t < 1) requestAnimationFrame(frame);
    else { canvas._rot = ((rot % 360) + 360) % 360; onDone && onDone(); }
  })(start);
}

/* ---------- TICKET À GRATTER ---------- */
function initScratch(canvas, onRevealed) {
  const W = 680, H = 380;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#d9d9e2'); g.addColorStop(0.5, '#a9a9b8'); g.addColorStop(1, '#c9c9d6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.font = '900 44px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('GRATTEZ ICI', W / 2, H / 2 - 8);
  ctx.font = '700 26px sans-serif';
  ctx.fillText('🪙 🪙 🪙', W / 2, H / 2 + 44);
  let done = false, moves = 0;
  function scratchAt(x, y) {
    const r = canvas.getBoundingClientRect();
    const px = (x - r.left) * (W / r.width), py = (y - r.top) * (H / r.height);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(px, py, 46, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (++moves % 6 === 0 && !done) checkDone();
  }
  function checkDone() {
    const d = ctx.getImageData(0, 0, W, H).data;
    let clear = 0, total = 0;
    for (let i = 3; i < d.length; i += 4 * 16) { total++; if (d[i] < 128) clear++; }
    if (clear / total > 0.42 && !done) {
      done = true;
      canvas.style.transition = 'opacity .5s'; canvas.style.opacity = '0';
      setTimeout(() => { canvas.style.display = 'none'; onRevealed && onRevealed(); }, 550);
    }
  }
  let down = false;
  canvas.addEventListener('pointerdown', (e) => { down = true; scratchAt(e.clientX, e.clientY); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => { if (down) scratchAt(e.clientX, e.clientY); });
  window.addEventListener('pointerup', () => { down = false; });
}

/* ---------- Modale mot de passe ---------- */
function askNewPassword() {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="card narrow"><h3>Changer le mot de passe</h3>
      <label>Nouveau mot de passe<input type="password" id="np-pass" placeholder="6 caractères min"></label>
      <div class="row"><button class="btn btn-gold" id="np-ok">Enregistrer</button>
      <button class="btn btn-ghost" id="np-cancel">Annuler</button></div>
      <p class="err" id="np-err"></p></div>`;
    document.body.appendChild(m);
    $('#np-ok', m).onclick = async () => {
      const p = $('#np-pass', m).value;
      if (p.length < 6) { $('#np-err', m).textContent = 'Trop court (6 min).'; return; }
      try { await api('/api/password', { method: 'POST', body: JSON.stringify({ password: p }) }); toast('Mot de passe changé ✔'); m.remove(); resolve(true); }
      catch (e) { $('#np-err', m).textContent = e.message; }
    };
    $('#np-cancel', m).onclick = () => { m.remove(); resolve(false); };
  });
}

/* ---------- ROUTEUR ---------- */
function route() {
  const h = location.hash || '#/';
  let m;
  if (h === '#/' || h === '#') return vHome();
  if (h === '#/setup') return vSetup();
  if (h === '#/login') return vLogin();
  if (h === '#/admin') return vAdmin();
  if (h === '#/m') return vMerchant();
  if ((m = h.match(/^#\/m\/c\/([\w-]+)$/))) return vCampDetail(m[1]);
  if ((m = h.match(/^#\/p\/([\w-]+)$/))) return vPublic(m[1]);
  return vHome();
}
window.addEventListener('hashchange', route);
function needAuth(role) {
  const u = JSON.parse(localStorage.getItem('tp_user') || 'null');
  if (!u) { location.hash = '#/login'; return null; }
  if (role && u.role !== role) { location.hash = u.role === 'superadmin' ? '#/admin' : '#/m'; return null; }
  return u;
}

/* ---------- ACCUEIL ---------- */
function vHome() { show('#view-home'); }

/* ---------- SETUP ---------- */
async function vSetup() {
  try { await api('/api/me'); const u = JSON.parse(localStorage.getItem('tp_user')); location.hash = u.role === 'superadmin' ? '#/admin' : '#/m'; return; } catch (e) {}
  show('#view-setup');
  $('#setup-btn').onclick = async () => {
    $('#setup-err').textContent = '';
    try {
      const j = await api('/api/setup', { method: 'POST', body: JSON.stringify({ username: $('#setup-user').value.trim(), password: $('#setup-pass').value }) });
      localStorage.setItem('tp_token', j.token); localStorage.setItem('tp_user', JSON.stringify(j.user));
      toast('Bienvenue, ' + j.user.username + ' 👑'); location.hash = '#/admin';
    } catch (e) { $('#setup-err').textContent = e.message; }
  };
}

/* ---------- LOGIN ---------- */
function vLogin() {
  show('#view-login');
  $('#login-btn').onclick = async () => {
    $('#login-err').textContent = '';
    try {
      const j = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#login-user').value.trim(), password: $('#login-pass').value }) });
      localStorage.setItem('tp_token', j.token); localStorage.setItem('tp_user', JSON.stringify(j.user));
      clickSnd();
      location.hash = j.user.role === 'superadmin' ? '#/admin' : '#/m';
    } catch (e) { $('#login-err').textContent = e.message; }
  };
}
function doLogout() {
  api('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('tp_token'); localStorage.removeItem('tp_user');
  location.hash = '#/';
}

/* ---------- SUPER-ADMIN ---------- */
let editingMerchant = null;
async function vAdmin() {
  const me = needAuth('superadmin'); if (!me) return;
  show('#view-admin');
  $('#logout-btn').onclick = doLogout;
  $('#admin-pass-btn').onclick = askNewPassword;
  try {
    const [stats, mj, cj] = await Promise.all([
      api('/api/admin/stats'), api('/api/admin/merchants'), api('/api/admin/campaigns'),
    ]);
    $('#admin-stats').innerHTML = `
      <div class="stat"><b>${stats.merchantsActive}/${stats.merchants}</b><span>commerçants actifs</span></div>
      <div class="stat"><b>${stats.campaigns}</b><span>campagnes</span></div>
      <div class="stat"><b>${stats.participants}</b><span>participants</span></div>
      <div class="stat"><b>${stats.ticketsIssued}</b><span>tickets pris</span></div>`;
    $('#merchant-list').innerHTML = mj.merchants.map(m => `
      <div class="mcard"><h3>🏪 ${esc(m.merchantName)}</h3>
        <div class="muted small">@${esc(m.username)}</div>
        <div style="margin:8px 0">
          <span class="perm-dot ${m.perms.raffle ? 'on' : 'off'}"></span><small>Roue</small>
          <span class="perm-dot ${m.perms.scratch ? 'on' : 'off'}" style="margin-left:10px"></span><small>Tickets</small>
          <span class="badge ${m.active !== false ? 'open' : 'closed'}" style="margin-left:10px">${m.active !== false ? 'actif' : 'bloqué'}</span>
          <span class="badge dim">${m.perms.maxCampaigns} camp. max</span>
        </div>
        <div class="row">
          <button class="btn btn-ghost sm" data-edit="${m.id}">Modifier</button>
          <button class="btn btn-ghost sm" data-toggle="${m.id}">${m.active !== false ? 'Bloquer' : 'Activer'}</button>
          <button class="btn btn-danger sm" data-del="${m.id}">Supprimer</button>
        </div></div>`).join('') || `
      <div class="card guide">
        <div style="font-size:44px">👋</div>
        <h3 style="margin:10px 0 6px">Crée ton accès commerçant</h3>
        <p class="muted" style="line-height:2">C'est avec le <b>compte commerçant</b> que tu lanceras tes tirages.<br>
        1️⃣ Clique ci-dessous et crée ton accès<br>
        2️⃣ Déconnecte-toi, puis reconnecte-toi avec cet accès<br>
        3️⃣ Clique <b>🎡 Nouveau tirage</b> et lance ta roue !</p>
        <button class="btn btn-gold big" id="guide-new-merchant">+ Créer mon accès commerçant</button>
      </div>`;
    $('#admin-campaigns').innerHTML = cj.campaigns.map(c => `
      <div class="mcard"><h3>${c.type === 'raffle' ? '🎡' : '🎫'} ${esc(c.title)}</h3>
        <div class="muted small">${esc(c.merchantName)}</div>
        <span class="badge ${c.status}">${c.status === 'open' ? 'ouvert' : 'fermé'}</span>
        <span class="badge dim">${c.type === 'raffle' ? c.participants + ' participants' : (c.tickets ? c.tickets.issued + '/' + c.tickets.total + ' tickets' : '')}</span>
      </div>`).join('') || '<p class="muted">Aucune campagne.</p>';
  } catch (e) { toast(e.message); }

  $('#merchant-new-btn').onclick = () => { editingMerchant = null; openMerchantModal(); };
  const gm = $('#guide-new-merchant');
  if (gm) gm.onclick = () => { editingMerchant = null; openMerchantModal(); };
  $$('#merchant-list [data-edit]').forEach(b => b.onclick = () => { editingMerchant = b.dataset.edit; openMerchantModal(); });
  $$('#merchant-list [data-toggle]').forEach(b => b.onclick = async () => {
    try {
      const cur = await api('/api/admin/merchants');
      const m = cur.merchants.find(x => x.id === b.dataset.toggle);
      await api('/api/admin/merchants/' + b.dataset.toggle, { method: 'PATCH', body: JSON.stringify({ active: !(m.active !== false) }) });
      toast('Mis à jour'); vAdmin();
    } catch (e) { toast(e.message); }
  });
  $$('#merchant-list [data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer ce commerçant et toutes ses campagnes ?')) return;
    try { await api('/api/admin/merchants/' + b.dataset.del, { method: 'DELETE' }); toast('Supprimé'); vAdmin(); }
    catch (e) { toast(e.message); }
  });
}
async function openMerchantModal() {
  const m = $('#merchant-modal'); m.classList.remove('hidden');
  $('#mm-err').textContent = '';
  if (editingMerchant) {
    $('#mm-title').textContent = 'Modifier le commerçant';
    const { merchants } = await api('/api/admin/merchants');
    const x = merchants.find(y => y.id === editingMerchant);
    $('#mm-name').value = x.merchantName; $('#mm-user').value = x.username; $('#mm-user').disabled = true;
    $('#mm-pass').value = ''; $('#mm-pass').placeholder = '(vide = inchangé)';
    $('#mm-raffle').checked = x.perms.raffle; $('#mm-scratch').checked = x.perms.scratch; $('#mm-max').value = x.perms.maxCampaigns;
  } else {
    $('#mm-title').textContent = 'Nouveau commerçant';
    $('#mm-name').value = ''; $('#mm-user').value = ''; $('#mm-user').disabled = false;
    $('#mm-pass').value = ''; $('#mm-pass').placeholder = '6 caractères min';
    $('#mm-raffle').checked = true; $('#mm-scratch').checked = true; $('#mm-max').value = 10;
  }
  $('#mm-cancel').onclick = () => m.classList.add('hidden');
  $('#mm-save').onclick = async () => {
    $('#mm-err').textContent = '';
    const body = {
      merchantName: $('#mm-name').value.trim(),
      perms: { raffle: $('#mm-raffle').checked, scratch: $('#mm-scratch').checked, maxCampaigns: $('#mm-max').value },
    };
    try {
      if (editingMerchant) {
        if ($('#mm-pass').value) body.password = $('#mm-pass').value;
        await api('/api/admin/merchants/' + editingMerchant, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        body.username = $('#mm-user').value.trim(); body.password = $('#mm-pass').value;
        await api('/api/admin/merchants', { method: 'POST', body: JSON.stringify(body) });
      }
      m.classList.add('hidden'); toast('Enregistré ✔'); vAdmin();
    } catch (e) { $('#mm-err').textContent = e.message; }
  };
}

/* ---------- COMMERÇANT : tableau de bord ---------- */
async function vMerchant() {
  const me = needAuth('merchant'); if (!me) return;
  show('#view-merchant');
  $('#m-shopname').textContent = me.merchantName || me.username;
  $('#m-logout-btn').onclick = doLogout;
  $('#m-pass-btn').onclick = askNewPassword;
  const perms = me.perms || {};
  $('#new-raffle-btn').style.display = perms.raffle ? '' : 'none';
  $('#new-scratch-btn').style.display = perms.scratch ? '' : 'none';
  try {
    const { campaigns } = await api('/api/merchant/campaigns');
    $('#m-empty').classList.toggle('hidden', campaigns.length > 0);
    $('#m-campaigns').innerHTML = campaigns.map(c => `
      <div class="mcard"><h3>${c.type === 'raffle' ? '🎡' : '🎫'} ${esc(c.title)}</h3>
        <span class="badge ${c.status}">${c.status === 'open' ? 'ouvert' : 'fermé'}</span>
        <span class="badge type">${c.type === 'raffle' ? 'tirage' : 'tickets'}</span>
        <div class="muted small" style="margin-top:6px">${c.type === 'raffle'
          ? `${c.participants} participant(s) · ${c.winners} gagnant(s)`
          : `${c.tickets.issued}/${c.tickets.total} tickets pris · ${c.tickets.won} gagnés`}</div>
        <div class="row"><button class="btn btn-gold sm" data-open="${c.id}">Ouvrir</button>
        <button class="btn btn-danger sm" data-delc="${c.id}">Supprimer</button></div></div>`).join('');
    $$('#m-campaigns [data-open]').forEach(b => b.onclick = () => location.hash = '#/m/c/' + b.dataset.open);
    $$('#m-campaigns [data-delc]').forEach(b => b.onclick = async () => {
      if (!confirm('Supprimer cette campagne ?')) return;
      try { await api('/api/merchant/campaigns/' + b.dataset.delc, { method: 'DELETE' }); toast('Supprimée'); vMerchant(); }
      catch (e) { toast(e.message); }
    });
  } catch (e) { toast(e.message); }
  $('#new-raffle-btn').onclick = () => openCampModal('raffle');
  $('#new-scratch-btn').onclick = () => openCampModal('scratch');
}

let campType = 'raffle';
function openCampModal(type) {
  campType = type;
  const m = $('#camp-modal'); m.classList.remove('hidden');
  $('#cm-err').textContent = '';
  $('#cm-title').textContent = type === 'raffle' ? '🎡 Nouveau tirage au sort' : '🎫 Nouveaux tickets à gratter';
  const f = $('#cm-fields');
  if (type === 'raffle') {
    f.innerHTML = `
      <label>Titre<input id="cf-title" placeholder="ex : Grand tirage de Noël"></label>
      <label>Description<textarea id="cf-desc" placeholder="ex : Tirage parmi nos clients fidèles"></textarea></label>
      <label>Lots à gagner (un par ligne)<textarea id="cf-prizes" placeholder="TV 55 pouces&#10;Bon d'achat 100$&#10;Cafetière"></textarea></label>
      <div class="row"><label style="flex:1">Nb de gagnants<input id="cf-maxw" type="number" value="1" min="1" max="50"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" id="cf-phone"> Exiger le téléphone</label></div>`;
  } else {
    f.innerHTML = `
      <label>Titre<input id="cf-title" placeholder="ex : Tickets 10e anniversaire"></label>
      <label>Description<textarea id="cf-desc" placeholder="ex : Grattez et gagnez !"></textarea></label>
      <label>Lots (lot + quantité)</label><div id="cf-prize-list"></div>
      <button class="btn btn-ghost sm" id="cf-add-prize" type="button">+ Ajouter un lot</button>
      <div class="row"><label style="flex:1">Tickets perdants<input id="cf-losers" type="number" value="100" min="0" max="50000"></label>
      <label style="flex:1">Tickets / personne<input id="cf-perclient" type="number" value="1" min="1" max="10"></label></div>
      <label class="chk"><input type="checkbox" id="cf-phone" checked> Exiger le téléphone</label>`;
    const addPrizeRow = (label, qty) => {
      const d = document.createElement('div'); d.className = 'prize-row';
      d.innerHTML = `<input placeholder="ex : 10% de rabais" value="${esc(label || '')}"><input class="qty" type="number" min="1" max="10000" value="${qty || 10}"><button class="btn btn-danger sm" type="button">✕</button>`;
      d.querySelector('button').onclick = () => d.remove();
      $('#cf-prize-list').appendChild(d);
    };
    $('#cf-add-prize').onclick = () => addPrizeRow('', 10);
    addPrizeRow('Bon de 10$', 5); addPrizeRow('Café gratuit', 20);
  }
  $('#cm-cancel').onclick = () => m.classList.add('hidden');
  $('#cm-save').onclick = async () => {
    $('#cm-err').textContent = '';
    const body = { type, title: $('#cf-title').value.trim(), description: $('#cf-desc').value.trim(), requirePhone: $('#cf-phone').checked };
    try {
      if (type === 'raffle') {
        body.prizes = $('#cf-prizes').value.split('\n').map(s => s.trim()).filter(Boolean);
        body.maxWinners = $('#cf-maxw').value;
        if (!body.prizes.length) throw new Error('Ajoute au moins un lot.');
      } else {
        body.prizes = $$('#cf-prize-list .prize-row').map(r => ({ label: r.querySelector('input').value.trim(), qty: r.querySelector('.qty').value })).filter(p => p.label);
        body.losers = $('#cf-losers').value; body.perClient = $('#cf-perclient').value;
        if (!body.prizes.length) throw new Error('Ajoute au moins un lot.');
      }
      const j = await api('/api/merchant/campaigns', { method: 'POST', body: JSON.stringify(body) });
      m.classList.add('hidden'); toast('Campagne créée ✔'); fanfare();
      location.hash = '#/m/c/' + j.campaign.id;
    } catch (e) { $('#cm-err').textContent = e.message; }
  };
}

/* ---------- COMMERÇANT : détail campagne ---------- */
async function vCampDetail(id) {
  const me = needAuth('merchant'); if (!me) return;
  show('#view-campdetail');
  const body = $('#cd-body');
  body.innerHTML = '<p class="muted">Chargement…</p>';
  let c;
  try { c = (await api('/api/merchant/campaigns/' + id)).campaign; }
  catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  $('#cd-title').textContent = (c.type === 'raffle' ? '🎡 ' : '🎫 ') + c.title;

  if (c.type === 'raffle') return renderRaffleDetail(c, body);
  return renderScratchDetail(c, body);
}

function shareBlock() {
  return `<div class="sharebox"><b>🔗 Lien client</b>
    <input id="share-link" readonly onclick="this.select()">
    <div class="row" style="justify-content:center"><button class="btn btn-gold sm" id="share-copy">Copier le lien</button></div>
    <div id="share-qr"></div></div>`;
}
async function fillShare(campId) {
  try {
    const j = await api('/api/merchant/campaigns/' + campId + '/qr');
    $('#share-link').value = j.link;
    $('#share-qr').innerHTML = `<img src="${j.qr}" alt="QR code"><div class="muted small">Scanne pour participer</div>`;
    $('#share-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(j.link); toast('Lien copié ✔'); }
      catch (e) { $('#share-link').select(); toast('Sélectionne et copie le lien'); }
    };
  } catch (e) { toast(e.message); }
}

function renderRaffleDetail(c, body) {
  body.innerHTML = `
    <div class="card"><div class="panel-head"><div>
      <span class="badge ${c.status}">${c.status === 'open' ? 'ouvert' : 'fermé'}</span>
      <span class="badge dim">${c.participants.length} participant(s)</span>
      <span class="badge dim">${c.winners.length}/${c.maxWinners} gagnant(s)</span></div>
      <div><button class="btn btn-ghost sm" id="cd-toggle">${c.status === 'open' ? 'Fermer les inscriptions' : 'Rouvrir'}</button></div></div>
      <p class="muted">${esc(c.description || '')}</p>
      <p><b>Lots :</b> ${c.prizes.map(esc).join(' · ')}</p></div>
    <div class="tabs">
      <div class="tab active" data-tab="draw">🎡 Tirage</div>
      <div class="tab" data-tab="parts">👥 Participants</div>
      <div class="tab" data-tab="share">🔗 Partager</div>
    </div>
    <div id="tab-draw"><div class="card"><div class="wheel-zone">
      ${c.participants.length === 0 ? `<div class="hint">👆 <b>Pour commencer :</b> va dans l'onglet <b>🔗 Partager</b>, envoie le lien à tes clients. Quand ils s'inscrivent, reviens ici et lance la roue !</div>` : ''}
      <div class="wheel-wrap"><div class="wheel-pointer">🔻</div><canvas id="wheel" width="600" height="600"></canvas><div class="wheel-hub">🎡</div></div>
      <div id="draw-result"></div>
      <div class="row" style="justify-content:center"><button class="btn btn-gold big" id="draw-btn">Lancer le tirage</button></div>
      <p class="muted small">La roue tourne en direct aussi sur les téléphones des clients.</p>
    </div></div></div>
    <div id="tab-parts" class="hidden"><div class="card"><h3>Participants</h3><div class="plist" id="parts-list"></div></div></div>
    <div id="tab-share" class="hidden"><div class="card">${shareBlock()}</div></div>
    <div class="card"><h3>🏆 Gagnants</h3><div id="winners-list">${winnersHtml(c.winners)}</div></div>`;

  $$('.tab', body).forEach(t => t.onclick = () => {
    $$('.tab', body).forEach(x => x.classList.remove('active')); t.classList.add('active');
    ['draw', 'parts', 'share'].forEach(k => $('#tab-' + k).classList.toggle('hidden', k !== t.dataset.tab));
    clickSnd();
  });
  const paintParts = () => {
    $('#parts-list').innerHTML = c.participants.map((p, i) =>
      `<div class="prow"><span>${i + 1}. ${esc(p.name)}</span><span class="muted small">${esc(p.phone || '')}</span></div>`).join('') || '<p class="muted">Aucun participant pour l\'instant.</p>';
  };
  paintParts();
  fillShare(c.id);
  $('#cd-toggle').onclick = async () => {
    try { const j = await api('/api/merchant/campaigns/' + c.id, { method: 'PATCH', body: JSON.stringify({ status: c.status === 'open' ? 'closed' : 'open' }) }); toast('Mis à jour'); vCampDetail(c.id); }
    catch (e) { toast(e.message); }
  };

  const canvas = $('#wheel');
  const names0 = c.participants.map(p => p.name);
  drawWheel(canvas, names0.length ? names0 : ['En attente'], 0);
  connectWS(c.id, (msg) => {
    if (msg.t === 'joined') { c.participants.push({ name: '…' }); paintParts(); drawWheel(canvas, c.participants.map(p => p.name), canvas._rot || 0); }
    if (msg.t === 'spin') doSpin(msg);
  });
  // Recharge les participants (noms réels après un "joined" optimiste)
  api('/api/merchant/campaigns/' + c.id).then(j => {
    c.participants = j.campaign.participants; c.winners = j.campaign.winners;
    paintParts(); drawWheel(canvas, names0.length ? c.participants.map(p => p.name) : ['En attente'], 0);
    $('#winners-list').innerHTML = winnersHtml(c.winners);
  }).catch(() => {});

  function doSpin(msg) {
    const names = msg.order.map(o => o.name);
    $('#draw-btn').disabled = true;
    $('#draw-result').innerHTML = '<p class="muted">🎡 La roue tourne…</p>';
    beep(400, 0.2, 0, 'triangle');
    spinWheel(canvas, names, msg.winnerIndexes[0], msg.duration, () => {
      const w = msg.results[0];
      $('#draw-result').innerHTML = `<div class="winner-banner">🏆 <b>${esc(w.name)}</b> gagne : ${esc(w.prize)}</div>`;
      fanfare(); confetti();
      c.winners.push(...msg.results.map(r => ({ ...r, at: Date.now() })));
      $('#winners-list').innerHTML = winnersHtml(c.winners);
      $('#draw-btn').disabled = false;
    });
  }
  $('#draw-btn').onclick = async () => {
    try {
      clickSnd();
      await api('/api/merchant/campaigns/' + c.id + '/draw', { method: 'POST', body: JSON.stringify({ count: 1 }) });
    } catch (e) { toast(e.message); $('#draw-btn').disabled = false; }
  };
}
function winnersHtml(winners) {
  if (!winners || !winners.length) return '<p class="muted">Aucun gagnant tiré pour l\'instant.</p>';
  return winners.map((w, i) => `<div class="prow"><span>🏆 ${esc(w.name)}</span><b style="color:var(--gold)">${esc(w.prize)}</b></div>`).join('');
}

function renderScratchDetail(c, body) {
  body.innerHTML = `
    <div class="card"><div class="panel-head"><div>
      <span class="badge ${c.status}">${c.status === 'open' ? 'ouvert' : 'fermé'}</span></div>
      <div><button class="btn btn-ghost sm" id="cd-toggle">${c.status === 'open' ? 'Terminer la campagne' : 'Rouvrir'}</button></div></div>
      <p class="muted">${esc(c.description || '')}</p>
      <div class="stats">
        <div class="stat"><b>${c.tickets.issued}/${c.tickets.total}</b><span>tickets pris</span></div>
        <div class="stat"><b>${c.tickets.won}</b><span>lots gagnés</span></div>
        <div class="stat"><b>${c.tickets.total - c.tickets.issued}</b><span>tickets restants</span></div>
      </div>
      <p><b>Lots :</b></p>${c.prizes.map(p => `<div class="prow"><span>${esc(p.label)}</span><span class="muted">× ${p.qty}</span></div>`).join('')}
    </div>
    <div class="card"><h3>🔗 Partager</h3>${shareBlock()}</div>
    <div class="card"><h3>🎫 Derniers tickets</h3>
      <div class="plist">${c.recentTickets.map(t => `<div class="prow"><span><b>${esc(t.code)}</b> — ${esc(t.by.name)}</span><span>${t.prize ? '🏆 ' + esc(t.prize) : t.revealed ? 'perdu' : 'non gratté'}</span></div>`).join('') || '<p class="muted">Aucun ticket pris.</p>'}</div></div>`;
  fillShare(c.id);
  $('#cd-toggle').onclick = async () => {
    try { await api('/api/merchant/campaigns/' + c.id, { method: 'PATCH', body: JSON.stringify({ status: c.status === 'open' ? 'closed' : 'open' }) }); toast('Mis à jour'); vCampDetail(c.id); }
    catch (e) { toast(e.message); }
  };
}

/* ---------- PUBLIC : page campagne ---------- */
async function vPublic(id) {
  show('#view-public');
  const wrap = $('#pub-body');
  wrap.innerHTML = '<p class="muted" style="text-align:center">Chargement…</p>';
  let c;
  try { c = (await api('/api/p/' + id)).campaign; }
  catch (e) { wrap.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p></div>`; return; }
  $('#pub-emoji').textContent = c.type === 'raffle' ? '🎡' : '🎫';
  $('#pub-title').textContent = c.title;
  $('#pub-merchant').textContent = 'par ' + c.merchantName;
  $('#pub-desc').textContent = c.description || '';
  if (c.type === 'raffle') return renderPublicRaffle(c, wrap);
  return renderPublicScratch(c, wrap);
}

function renderPublicRaffle(c, wrap) {
  const joined = localStorage.getItem('tp_joined_' + c.id);
  wrap.innerHTML = `
    <div class="card" style="text-align:center">
      <span class="badge ${c.status}">${c.status === 'open' ? 'inscriptions ouvertes' : 'terminé'}</span>
      <div class="stats" style="margin-top:12px"><div class="stat"><b id="pub-count">${c.participants}</b><span>participants</span></div>
      <div class="stat"><b>${c.prizes.length}</b><span>lot(s)</span></div></div>
      <p><b>À gagner :</b> ${c.prizes.map(esc).join(' · ')}</p>
    </div>
    <div class="card" id="join-card" style="${joined || c.status !== 'open' ? 'display:none' : ''}">
      <h3>🎟️ Participer</h3>
      <label>Ton nom<input id="j-name" placeholder="ex : Marie"></label>
      ${c.requirePhone ? '<label>Ton téléphone<input id="j-phone" inputmode="tel" placeholder="ex : 514-555-1234"></label>' : ''}
      <button class="btn btn-gold big" id="j-btn">Je participe !</button>
      <p class="err" id="j-err"></p>
    </div>
    <div class="card hidden" id="joined-ok" style="text-align:center;${joined ? '' : 'display:none'}">
      <h3>✔ Tu es inscrit(e) !</h3><p class="muted">Reste ici : la roue tourne en direct.</p>
    </div>
    <div class="card"><div class="wheel-zone">
      <h3>🎡 Roue en direct</h3>
      <div class="wheel-wrap"><div class="wheel-pointer">🔻</div><canvas id="wheel" width="600" height="600"></canvas><div class="wheel-hub">🎡</div></div>
      <div id="pub-spin-msg"></div>
    </div></div>
    <div class="card"><h3>🏆 Gagnants</h3><div id="pub-winners">${winnersHtml(c.winners)}</div></div>`;

  if (joined) { $('#join-card').style.display = 'none'; $('#joined-ok').classList.remove('hidden'); }
  const canvas = $('#wheel');
  let names = (c.names && c.names.length ? c.names : []);
  const paint = () => drawWheel(canvas, names.length ? names : ['Bonne chance !'], canvas._rot || 0);
  paint();
  connectWS(c.id, (msg) => {
    if (msg.t === 'joined') {
      const el = $('#pub-count'); if (el) el.textContent = msg.count;
      // Recharge les noms pour afficher tout le monde sur la roue
      api('/api/p/' + c.id).then(j => { names = j.campaign.names || []; paint(); }).catch(() => {});
    }
    if (msg.t === 'closed') { toast('Campagne mise à jour'); vPublic(c.id); }
    if (msg.t === 'spin') {
      names = msg.order.map(o => o.name);
      $('#pub-spin-msg').innerHTML = '<p class="muted">🎡 Tirage en cours…</p>';
      spinWheel(canvas, names, msg.winnerIndexes[0], msg.duration, () => {
        const w = msg.results[0];
        $('#pub-spin-msg').innerHTML = `<div class="winner-banner">🏆 <b>${esc(w.name)}</b> gagne : ${esc(w.prize)}</div>`;
        fanfare(); confetti();
      });
    }
    if (msg.t === 'draw_end') { $('#pub-winners').innerHTML = winnersHtml(msg.winners); }
  });

  const jb = $('#j-btn');
  if (jb) jb.onclick = async () => {
    $('#j-err').textContent = '';
    const name = $('#j-name').value.trim();
    const phoneEl = $('#j-phone');
    try {
      await api('/api/p/' + c.id + '/join', { method: 'POST', body: JSON.stringify({ name, phone: phoneEl ? phoneEl.value.trim() : '' }) });
      localStorage.setItem('tp_joined_' + c.id, '1');
      $('#join-card').style.display = 'none'; $('#joined-ok').classList.remove('hidden');
      const el = $('#pub-count'); if (el) el.textContent = parseInt(el.textContent, 10) + 1;
      fanfare(); toast('Inscription confirmée 🍀');
    } catch (e) { $('#j-err').textContent = e.message; }
  };
}

function renderPublicScratch(c, wrap) {
  const saved = JSON.parse(localStorage.getItem('tp_ticket_' + c.id) || 'null');
  wrap.innerHTML = `
    <div class="card" style="text-align:center">
      <span class="badge ${c.status}">${c.status === 'open' ? 'en cours' : 'terminé'}</span>
      <div class="stats" style="margin-top:12px"><div class="stat"><b>${c.ticketsLeft}</b><span>tickets restants</span></div>
      <div class="stat"><b>${c.prizes.length}</b><span>lot(s) possible(s)</span></div></div>
      <p class="muted small">Lots : ${c.prizes.map(esc).join(' · ')}</p>
    </div>
    <div id="scratch-area"></div>`;
  const area = $('#scratch-area');
  if (c.status !== 'open') { area.innerHTML = '<div class="card"><p class="muted" style="text-align:center">Cette campagne est terminée.</p></div>'; return; }
  if (saved) return showScratchCard(area, c, saved);
  area.innerHTML = `<div class="card"><h3>🎫 Obtenir mon ticket</h3>
    <label>Ton nom<input id="s-name" placeholder="ex : Marie"></label>
    ${c.requirePhone ? '<label>Ton téléphone<input id="s-phone" inputmode="tel" placeholder="ex : 514-555-1234"></label>' : ''}
    <p class="muted small">Limite : ${c.perClient} ticket(s) par personne.</p>
    <button class="btn btn-gold big" id="s-btn">Prendre un ticket</button>
    <p class="err" id="s-err"></p></div>`;
  $('#s-btn').onclick = async () => {
    $('#s-err').textContent = '';
    const name = $('#s-name').value.trim();
    const phoneEl = $('#s-phone');
    try {
      const j = await api('/api/p/' + c.id + '/ticket', { method: 'POST', body: JSON.stringify({ name, phone: phoneEl ? phoneEl.value.trim() : '' }) });
      localStorage.setItem('tp_ticket_' + c.id, JSON.stringify(j));
      clickSnd();
      showScratchCard(area, c, j);
    } catch (e) { $('#s-err').textContent = e.message; }
  };
}

function showScratchCard(area, c, t) {
  area.innerHTML = `<div class="card scratch-zone"><h3>🎫 Ton ticket</h3>
    <div class="ticket-code">N° ${esc(t.code)}</div>
    <div class="scratch-wrap"><div class="scratch-under" id="su"><span class="muted">Gratte pour découvrir…</span></div>
    <canvas id="scratch-canvas"></canvas></div>
    <p class="muted small">Gratte avec ton doigt 👆</p></div>`;
  initScratch($('#scratch-canvas'), async () => {
    try {
      const j = await api(`/api/p/${c.id}/ticket/${t.ticketId}/reveal`, { method: 'POST' });
      const su = $('#su');
      if (j.prize) {
        su.innerHTML = `<span>🎉 TU GAGNES</span><div class="prize">${esc(j.prize)}</div><span class="muted small">Montre ce ticket au commerçant</span>`;
        fanfare(); confetti();
      } else {
        su.innerHTML = `<span class="lose">😅 Perdu…<br>retente ta chance !</span>`;
        beep(220, 0.3, 0, 'sawtooth');
      }
    } catch (e) { $('#su').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  });
}

/* ---------- Démarrage ---------- */
(async function boot() {
  try {
    const j = await api('/api/me');
    localStorage.setItem('tp_user', JSON.stringify(j.user));
  } catch (e) {
    localStorage.removeItem('tp_user'); localStorage.removeItem('tp_token');
  }
  try {
    const s = await (await fetch('/api/status')).json();
    if (!s.setupDone && (location.hash === '#/' || location.hash === '' || location.hash === '#')) {
      location.hash = '#/setup';
    }
  } catch (e) {}
  route();
})();
