// Tests TiragePro — node --test test/run.js
process.env.TIRAGE_DATA = '/tmp/tirage-test-data.json';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

try { fs.unlinkSync('/tmp/tirage-test-data.json'); } catch (e) {}

const { server, store } = require('../server.js');
let base;
let adminTok, merchTok, merch2Tok;
let raffleId, scratchId;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

before(async () => {
  await new Promise(res => server.listen(0, res));
  base = `http://localhost:${server.address().port}`;
});

after(async () => { server.close(); });

describe('setup & auth', () => {
  it('crée le super-admin', async () => {
    const r = await req('POST', '/api/setup', { username: 'vlad', password: 'secret123' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'superadmin');
    adminTok = r.body.token;
  });
  it('refuse un 2e setup', async () => {
    const r = await req('POST', '/api/setup', { username: 'x', password: 'secret123' });
    assert.equal(r.status, 400);
  });
  it('login ok / ko', async () => {
    const ok = await req('POST', '/api/login', { username: 'vlad', password: 'secret123' });
    assert.equal(ok.status, 200);
    const ko = await req('POST', '/api/login', { username: 'vlad', password: 'nope' });
    assert.equal(ko.status, 401);
  });
  it('/api/me', async () => {
    const r = await req('GET', '/api/me', null, adminTok);
    assert.equal(r.body.user.username, 'vlad');
    const anon = await req('GET', '/api/me');
    assert.equal(anon.status, 401);
  });
});

describe('super-admin : commerçants', () => {
  it('crée un commerçant', async () => {
    const r = await req('POST', '/api/admin/merchants', {
      username: 'boulangerie', password: 'pain1234', merchantName: 'Boulangerie du coin',
      perms: { raffle: true, scratch: true, maxCampaigns: 5 },
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.merchant.perms.scratch, true);
  });
  it('refuse doublon et mdp court', async () => {
    const d = await req('POST', '/api/admin/merchants', { username: 'boulangerie', password: 'pain1234' }, adminTok);
    assert.equal(d.status, 400);
    const s = await req('POST', '/api/admin/merchants', { username: 'fleuriste', password: '123' }, adminTok);
    assert.equal(s.status, 400);
  });
  it('crée un commerçant sans droit tickets', async () => {
    const r = await req('POST', '/api/admin/merchants', {
      username: 'fleuriste', password: 'fleur1234', merchantName: 'Fleuriste',
      perms: { raffle: true, scratch: false, maxCampaigns: 3 },
    }, adminTok);
    assert.equal(r.status, 200);
  });
  it('le commerçant ne peut pas toucher /api/admin', async () => {
    const l = await req('POST', '/api/login', { username: 'boulangerie', password: 'pain1234' });
    merchTok = l.body.token;
    const r = await req('GET', '/api/admin/merchants', null, merchTok);
    assert.equal(r.status, 403);
  });
  it('stats', async () => {
    const r = await req('GET', '/api/admin/stats', null, adminTok);
    assert.equal(r.body.merchants, 2);
  });
});

describe('commerçant : campagnes tirage', () => {
  it('refuse sans titre / sans lots', async () => {
    const a = await req('POST', '/api/merchant/campaigns', { type: 'raffle', prizes: ['TV'] }, merchTok);
    assert.equal(a.status, 400);
    const b = await req('POST', '/api/merchant/campaigns', { type: 'raffle', title: 'X' }, merchTok);
    assert.equal(b.status, 400);
  });
  it('crée un tirage', async () => {
    const r = await req('POST', '/api/merchant/campaigns', {
      type: 'raffle', title: 'Grand tirage', description: 'Noël',
      prizes: ['TV', 'Bon 50$'], maxWinners: 2, requirePhone: false,
    }, merchTok);
    assert.equal(r.status, 200);
    raffleId = r.body.campaign.id;
  });
  it('respecte la limite maxCampaigns', async () => {
    const l = await req('POST', '/api/login', { username: 'fleuriste', password: 'fleur1234' });
    merch2Tok = l.body.token;
    for (let i = 0; i < 3; i++) {
      await req('POST', '/api/merchant/campaigns', { type: 'raffle', title: 'T' + i, prizes: ['lot'] }, merch2Tok);
    }
    const over = await req('POST', '/api/merchant/campaigns', { type: 'raffle', title: 'Trop', prizes: ['lot'] }, merch2Tok);
    assert.equal(over.status, 403);
  });
  it('refuse le scratch sans permission', async () => {
    const r = await req('POST', '/api/merchant/campaigns', {
      type: 'scratch', title: 'Tickets', prizes: [{ label: '10%', qty: 5 }], losers: 5,
    }, merch2Tok);
    assert.equal(r.status, 403);
  });
  it('un commerçant ne voit pas les campagnes d’un autre', async () => {
    const r = await req('GET', '/api/merchant/campaigns/' + raffleId, null, merch2Tok);
    assert.equal(r.status, 403);
  });
});

describe('public : inscription & tirage roue', () => {
  it('page publique', async () => {
    const r = await req('GET', '/api/p/' + raffleId);
    assert.equal(r.body.campaign.title, 'Grand tirage');
    assert.ok(!('participants' in r.body.campaign) || r.body.campaign.participants === 0);
    assert.ok(Array.isArray(r.body.campaign.names), 'noms pour la roue publique');
  });
  it('inscription : nom requis, anti-doublon', async () => {
    const a = await req('POST', '/api/p/' + raffleId + '/join', { name: '' });
    assert.equal(a.status, 400);
    const b = await req('POST', '/api/p/' + raffleId + '/join', { name: 'Marie' });
    assert.equal(b.status, 200);
    const c = await req('POST', '/api/p/' + raffleId + '/join', { name: 'Marie' });
    assert.equal(c.status, 400);
    await req('POST', '/api/p/' + raffleId + '/join', { name: 'Karim' });
    await req('POST', '/api/p/' + raffleId + '/join', { name: 'Léa' });
  });
  it('tirage : gagnants valides + broadcast WS', async () => {
    const WebSocket = require('ws');
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws?campaign=' + raffleId);
    const spinP = new Promise((res, rej) => {
      ws.on('message', (d) => { try { const m = JSON.parse(d); if (m.t === 'spin') res(m); } catch (e) {} });
      setTimeout(() => rej(new Error('pas de spin')), 8000);
    });
    await new Promise(r => ws.on('open', r));
    const dr = await req('POST', '/api/merchant/campaigns/' + raffleId + '/draw', { count: 1 }, merchTok);
    assert.equal(dr.status, 200);
    assert.equal(dr.body.results.length, 1);
    const w = dr.body.results[0];
    assert.ok(['Marie', 'Karim', 'Léa'].includes(w.name));
    assert.ok(['TV', 'Bon 50$'].includes(w.prize));
    const spin = await spinP;
    assert.equal(spin.results[0].name, w.name);
    assert.equal(spin.order.length, 3);
    ws.close();
  });
  it('campagne fermée : inscription refusée', async () => {
    await req('PATCH', '/api/merchant/campaigns/' + raffleId, { status: 'closed' }, merchTok);
    const r = await req('POST', '/api/p/' + raffleId + '/join', { name: 'Zoe' });
    assert.equal(r.status, 400);
  });
});

describe('tickets à gratter', () => {
  it('crée la campagne et pré-génère les tickets', async () => {
    const r = await req('POST', '/api/merchant/campaigns', {
      type: 'scratch', title: 'Anniversaire', prizes: [{ label: 'Bon 10$', qty: 4 }, { label: 'Café', qty: 6 }], losers: 10, perClient: 1,
    }, merchTok);
    assert.equal(r.status, 200);
    scratchId = r.body.campaign.id;
    assert.equal(r.body.campaign.tickets.total, 20);
  });
  it('distribution exacte des lots', async () => {
    const all = store.data.tickets.filter(t => t.campaignId === scratchId);
    assert.equal(all.filter(t => t.prizeIdx === 0).length, 4);
    assert.equal(all.filter(t => t.prizeIdx === 1).length, 6);
    assert.equal(all.filter(t => t.prizeIdx === null).length, 10);
  });
  it('prise de ticket + limite par personne', async () => {
    const a = await req('POST', '/api/p/' + scratchId + '/ticket', { name: 'Marie', phone: '5141' });
    assert.equal(a.status, 200);
    assert.ok(a.body.ticketId);
    const b = await req('POST', '/api/p/' + scratchId + '/ticket', { name: 'Marie', phone: '5141' });
    assert.equal(b.status, 403);
    const rev = await req('POST', `/api/p/${scratchId}/ticket/${a.body.ticketId}/reveal`);
    assert.equal(rev.status, 200);
    assert.ok('prize' in rev.body);
  });
  it('QR code', async () => {
    const r = await req('GET', '/api/merchant/campaigns/' + scratchId + '/qr', null, merchTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.qr.startsWith('data:image/png'));
    assert.ok(r.body.link.includes('/#/p/'));
  });
});

describe('divers', () => {
  it('changement de mot de passe', async () => {
    const r = await req('POST', '/api/password', { password: 'nouveau123' }, merchTok);
    assert.equal(r.status, 200);
    const l = await req('POST', '/api/login', { username: 'boulangerie', password: 'nouveau123' });
    assert.equal(l.status, 200);
  });
  it('logout', async () => {
    await req('POST', '/api/logout', null, adminTok);
    const r = await req('GET', '/api/me', null, adminTok);
    assert.equal(r.status, 401);
  });
  it('santé', async () => {
    const r = await req('GET', '/health');
    assert.equal(r.body.ok, true);
  });
  it('page d’accueil : guide de démarrage visible', async () => {
    const r = await fetch(base + '/');
    const html = await r.text();
    assert.ok(html.includes('Lance ton premier tirage'), 'guide commerçant présent');
  });
  it('guide admin : créer son accès commerçant', async () => {
    const r = await fetch(base + '/app.js');
    const js = await r.text();
    assert.ok(js.includes('Crée ton accès commerçant'), 'guide admin présent');
  });
});
