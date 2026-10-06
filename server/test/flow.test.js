import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { encode, convertBits } from '../bech32.js';

let server, base;
before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => { server.close(); db.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + s, { force: true }); });

class Client {
  cookie = ''; csrf = '';
  async req(method, path, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    let payload = body;
    if (body && !(body instanceof FormData)) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method, headers: h, body: payload });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
  async signup(name, email) {
    const password = `correct-horse-${crypto.randomBytes(4).toString('hex')}`;
    assert.equal((await this.post('/auth/register', { name, email, password })).status, 202);
    const row = db.prepare('SELECT body FROM outbox WHERE to_email=? ORDER BY id DESC').get(email);
    const token = /token=([\w-]+)/.exec(row.body)[1];
    assert.equal((await this.post('/auth/verify', { token })).status, 200);
    const r = await this.post('/auth/login', { email, password });
    assert.equal(r.status, 200);
    this.csrf = r.body.csrfToken;
    return password;
  }
}
const addr = () => encode('tb', [0, ...convertBits([...crypto.randomBytes(20)], 8, 5, true)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), crypto.randomBytes(64)]);

test('full lifecycle + privacy + double-claim protection', async () => {
  const alice = new Client(), bob = new Client(), eve = new Client();
  await alice.signup('Alice', 'alice@example.com');
  await bob.signup('Bob', 'bob@example.com');
  await eve.signup('Eve', 'eve@example.com');
  const SECRET = 'my-very-secret-love-letter-zzz';

  const at = new Date(Date.now() + 3000).toISOString();
  const c = await alice.post('/bottles', { recipientEmail: 'bob@example.com', title: 'Birthday', message: SECRET, amountSats: 21000, unlock: { type: 'date', at } });
  assert.equal(c.status, 201);
  const id = c.body.bottle.id;
  assert.equal(c.body.bottle.status, 'draft');

  // Not visible to the recipient or strangers before sealing
  assert.equal((await bob.get(`/bottles/${id}`)).status, 404);
  assert.equal((await eve.get(`/bottles/${id}`)).status, 404);

  // Message is encrypted at rest
  const raw = db.prepare('SELECT msg_enc FROM bottles WHERE id=?').get(id).msg_enc;
  assert.ok(!Buffer.from(raw).includes(Buffer.from(SECRET)));

  // Cannot seal unfunded
  assert.equal((await alice.post(`/bottles/${id}/seal`)).status, 409);

  // Photo upload (and a spoofed file is rejected)
  const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
  assert.equal((await alice.req('POST', `/bottles/${id}/attachments`, fd)).status, 201);
  const bad = new FormData(); bad.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  assert.equal((await alice.req('POST', `/bottles/${id}/attachments`, bad)).status, 415);

  // Fund
  const f = await alice.post(`/bottles/${id}/fund`);
  assert.equal(f.status, 200);
  assert.match(f.body.onchain.address, /^tb1q/);
  assert.match(f.body.onchain.qr, /^data:image\/png/);
  assert.equal((await alice.post(`/dev/bottles/${id}/simulate-payment`)).body.applied, true);
  assert.equal((await alice.post(`/dev/bottles/${id}/simulate-payment`)).body.applied, false, 'payment confirms once');
  assert.equal((await alice.get(`/bottles/${id}`)).body.bottle.status, 'funded');

  // Seal
  assert.equal((await alice.post(`/bottles/${id}/seal`)).body.bottle.status, 'sealed');
  assert.equal((await alice.req('PUT', `/bottles/${id}`, { amountSats: 5000 })).status, 409, 'sealed bottles are immutable');

  // Locked view: recipient sees amount + countdown but NOT the message or media
  const locked = (await bob.get(`/bottles/${id}`)).body.bottle;
  assert.equal(locked.status, 'sealed');
  assert.equal(locked.amountSats, 21000);
  assert.equal(locked.message, undefined);
  assert.equal(locked.attachments, undefined);
  assert.ok(!JSON.stringify(locked).includes(SECRET));
  const attId = (await alice.get(`/bottles/${id}`)).body.bottle.attachments[0].id;
  assert.equal((await bob.get(`/bottles/${id}/attachments/${attId}`)).status, 404);
  assert.equal((await eve.get(`/bottles/${id}/attachments/${attId}`)).status, 404);

  // Early unlock + early claim blocked
  assert.equal((await bob.post(`/bottles/${id}/unlock`)).status, 409);
  const early = await bob.post(`/bottles/${id}/claim`, { kind: 'onchain', destination: addr(), confirmAmountSats: 21000 });
  assert.equal(early.status, 409);

  // Wait for the unlock time, then the scheduler-independent unlock path works
  await new Promise((r) => setTimeout(r, 3200));
  const open = await bob.post(`/bottles/${id}/unlock`);
  assert.equal(open.body.bottle.status, 'ready');
  assert.equal(open.body.bottle.message, SECRET);
  const media = await bob.get(`/bottles/${id}/attachments/${attId}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(media.body, png);

  // Strangers still can't claim; bad destinations are rejected; wrong amount rejected
  assert.equal((await eve.post(`/bottles/${id}/claim`, { kind: 'onchain', destination: addr(), confirmAmountSats: 21000 })).status, 404);
  assert.equal((await bob.post(`/bottles/${id}/claim`, { kind: 'onchain', destination: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsy', confirmAmountSats: 21000 })).status, 400);
  assert.equal((await bob.post(`/bottles/${id}/claim`, { kind: 'onchain', destination: addr(), confirmAmountSats: 1 })).status, 400);
  // Sender can't claim their own bottle
  assert.equal((await alice.post(`/bottles/${id}/claim`, { kind: 'onchain', destination: addr(), confirmAmountSats: 21000 })).status, 403);

  // Concurrent double-claim: exactly one succeeds
  const dest = addr();
  assert.equal((await bob.post(`/bottles/${id}/claim`, { kind: 'lnurl', destination: 'not-an-address', confirmAmountSats: 21000 })).status, 400);
  const rs = await Promise.all([1, 2, 3].map(() => bob.post(`/bottles/${id}/claim`, { kind: 'lnurl', destination: 'bob@wallet.example.com', confirmAmountSats: 21000 })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions WHERE bottle_id=? AND type='claim'").get(id).n, 1);
  assert.equal((await bob.get(`/bottles/${id}`)).body.bottle.status, 'claimed');

  // History + activity
  assert.equal((await alice.get('/transactions')).body.transactions[0].direction, 'sent');
  assert.equal((await bob.get('/transactions')).body.transactions[0].direction, 'received');
  assert.ok((await alice.get('/activity')).body.items.some((i) => i.kind === 'bottle.claimed'));
  assert.equal((await alice.get('/dev/audit')).body.ok, true, 'audit chain intact');
});

test('milestone bottles: only the sender can release', async () => {
  const s = new Client(), r = new Client();
  await s.signup('Sam', 'sam@example.com'); await r.signup('Rae', 'rae@example.com');
  const { body } = await s.post('/bottles', { recipientEmail: 'rae@example.com', message: 'Graduation!', amountSats: 5000, unlock: { type: 'milestone', text: 'You graduate' } });
  const id = body.bottle.id;
  await s.post(`/bottles/${id}/fund`); await s.post(`/dev/bottles/${id}/simulate-payment`); await s.post(`/bottles/${id}/seal`);
  assert.equal((await r.post(`/bottles/${id}/unlock`)).status, 403);
  assert.equal((await s.post(`/bottles/${id}/unlock`)).body.bottle.status, 'ready');
});

test('auth hardening', async () => {
  const c = new Client();
  const weak = await c.post('/auth/register', { name: 'W', email: 'w@example.com', password: 'short' });
  assert.equal(weak.status, 400);
  const p = await c.signup('Lock', 'lock@example.com');
  const anon = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await anon.post('/auth/login', { email: 'lock@example.com', password: 'wrong-wrong-wrong' })).status, 401);
  assert.equal((await anon.post('/auth/login', { email: 'lock@example.com', password: p })).status, 429, 'locked even with the right password');
  // unknown user and wrong password look identical
  const a = await anon.post('/auth/login', { email: 'nobody@example.com', password: 'whatever-whatever' });
  assert.equal(a.status, 401); assert.equal(a.body.error, 'Email or password is incorrect');
  // duplicate registration is indistinguishable
  assert.equal((await anon.post('/auth/register', { name: 'X', email: 'lock@example.com', password: 'another-long-password-1' })).status, 202);
});

test('CSRF, session and webhook protections', async () => {
  const c = new Client(); await c.signup('Carl', 'carl@example.com');
  const noToken = await fetch(base + '/bottles', { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 403);
  const badOrigin = await fetch(base + '/bottles', { method: 'POST', headers: { cookie: c.cookie, 'x-csrf-token': c.csrf, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(badOrigin.status, 403);
  assert.equal((await new Client().get('/bottles')).status, 401);
  const unknownField = await c.post('/bottles', { recipientEmail: 'z@example.com', amountSats: 5000, unlock: { type: 'milestone', text: 'abc' }, status: 'ready' });
  assert.equal(unknownField.status, 400, 'mass-assignment rejected');
  assert.equal((await c.post('/bottles', { recipientEmail: 'z@example.com', amountSats: 999999999, unlock: { type: 'milestone', text: 'abc' } })).status, 400, 'launch cap');
  // webhook
  const body = JSON.stringify({ eventId: 'e1', bottleId: 'nope', txid: 'x', sats: 1 });
  const bad = await fetch(base + '/webhooks/payments', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sib-signature': 'sha256=00' }, body });
  assert.equal(bad.status, 401);
  const sig = crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');
  const ok = await fetch(base + '/webhooks/payments', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sib-signature': `sha256=${sig}` }, body });
  assert.equal(ok.status, 404, 'valid signature, unknown bottle'); // reaches business logic
  // security headers
  const h = (await fetch(base + '/health')).headers;
  assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(h.get('x-powered-by'), null);
});
