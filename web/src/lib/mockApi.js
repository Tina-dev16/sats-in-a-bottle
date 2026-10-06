// In-browser simulation of the Sats in a Bottle API, used only by the static demo build
// (VITE_STATIC_DEMO=true). Everything lives in localStorage. It is a SIMULATION for demos:
// no real Bitcoin, no encryption, no server. The real rules live in /server.
import QRCode from 'qrcode';
import { encode, convertBits, validateAddress, parseInvoice } from '../../../server/bech32.js';

const KEY = 'sib.demo.v1';
const NETWORK = 'testnet';
const LIM = { minSats: 1000, maxSats: 5_000_000, minLockSeconds: 60, messageChars: 5000, photoBytes: 4 * 1024 * 1024, audioBytes: 6 * 1024 * 1024 };
const CLAIM_WINDOW_MS = 365 * 86400e3;
const DEMO_PASSWORD = 'demo-bottle-2026';

class MockError extends Error { constructor(status, error, extra = {}) { super(error); this.mock = true; this.status = status; this.body = { error, ...extra }; } }
const fail = (status, msg, extra) => { throw new MockError(status, msg, extra); };

// ---------- storage ----------
const rid = (n = 12) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sib-demo:${s}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
let S = null;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage full: keep working in memory */ } };
async function load() {
  if (S) return S;
  try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { S = null; }
  if (!S) {
    S = { users: [], bottles: [], atts: {}, tx: [], notes: [], outbox: [], tokens: {}, session: null };
    const pw = await sha(DEMO_PASSWORD);
    const alice = { id: rid(8), name: 'Alice Demo', email: 'alice@demo.test', pw, verified: true };
    const bob = { id: rid(8), name: 'Bob Demo', email: 'bob@demo.test', pw, verified: true };
    S.users.push(alice, bob);
    const now = Date.now();
    S.bottles.push({
      id: rid(16), senderId: alice.id, recipientEmail: bob.email, title: 'Happy birthday Bob', amountSats: 210000, unlockType: 'date',
      unlockAt: now + 3 * 60e3, milestone: null, status: 'sealed', message: 'Dear Bob,\n\nHappy birthday! Spend these wisely, or just stack them.\n\nAlice',
      createdAt: now, fundedAt: now, sealedAt: now, readyAt: null, claimedAt: null, fund: null, payoutTxid: null, payoutKind: null,
    });
    S.tx.push({ id: rid(8), userId: alice.id, bottleId: S.bottles[0].id, type: 'fund', sats: 210000, status: 'confirmed', ref: rid(32), createdAt: now });
    save();
  }
  return S;
}

// ---------- helpers ----------
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const me = () => S.users.find((u) => u.id === S.session) || null;
const requireAuth = () => me() || fail(401, 'Please sign in');
const requireVerified = () => { const u = requireAuth(); if (!u.verified) fail(403, 'Verify your email address first', { code: 'EMAIL_UNVERIFIED' }); return u; };
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, emailVerified: !!u.verified });
const REVEALED = ['ready', 'claiming', 'claimed'];
const VISIBLE_TO_RECIPIENT = ['sealed', 'ready', 'claiming', 'claimed'];

function notify({ userId, email, bottleId, kind, text }) {
  const uid = userId ?? S.users.find((u) => u.email === email && u.verified)?.id ?? null;
  S.notes.unshift({ id: rid(6), userId: uid, email: uid ? null : email, bottleId: bottleId ?? null, kind, text, read: 0, createdAt: Date.now() });
}
function mail(to, subject, body) { S.outbox.unshift({ to, subject, body, createdAt: Date.now() }); }

/** The real server has a scheduler. Here, dates are checked lazily on every call. */
function tick() {
  const now = Date.now();
  for (const b of S.bottles) {
    if (b.status === 'sealed' && b.unlockType === 'date' && b.unlockAt <= now) markReady(b);
  }
}
function markReady(b) {
  if (b.status !== 'sealed') return;
  b.status = 'ready'; b.readyAt = Date.now();
  const sender = S.users.find((u) => u.id === b.senderId);
  notify({ email: b.recipientEmail, bottleId: b.id, kind: 'bottle.ready', text: `A bottle from ${sender?.name} is ready to open.` });
  notify({ userId: b.senderId, bottleId: b.id, kind: 'bottle.ready', text: `Your bottle to ${b.recipientEmail} has unlocked.` });
}

function loadFor(id) {
  const u = requireAuth();
  const b = S.bottles.find((x) => x.id === id);
  const role = b && (b.senderId === u.id ? 'sender' : u.verified && u.email === b.recipientEmail ? 'recipient' : null);
  if (!b || !role || (role === 'recipient' && !VISIBLE_TO_RECIPIENT.includes(b.status))) fail(404, 'Bottle not found');
  return { b, role, u };
}
const atts = (b) => Object.values(S.atts).filter((a) => a.bottleId === b.id);
function present(b, role) {
  const sender = S.users.find((u) => u.id === b.senderId);
  const revealed = REVEALED.includes(b.status);
  const out = {
    id: b.id, role, status: b.status, title: b.title, amountSats: b.amountSats,
    unlock: { type: b.unlockType, at: b.unlockAt, milestone: b.milestone, confirmedAt: b.milestoneConfirmedAt || null },
    senderName: sender?.name, createdAt: b.createdAt, fundedAt: b.fundedAt, sealedAt: b.sealedAt, readyAt: b.readyAt, claimedAt: b.claimedAt,
    serverNow: Date.now(), claimDeadline: b.readyAt ? b.readyAt + CLAIM_WINDOW_MS : null, network: NETWORK, simulated: true,
  };
  const attList = atts(b).map((a) => ({ id: a.id, kind: a.kind, mime: a.mime, size: a.size, url: a.url }));
  if (role === 'sender') Object.assign(out, { recipientEmail: b.recipientEmail, shareUrl: `${location.origin}/b/${b.id}`, payoutTxid: b.payoutTxid, payoutKind: b.payoutKind, message: b.message || '', attachments: attList });
  else if (revealed) Object.assign(out, { message: b.message || '', payoutTxid: b.payoutTxid, attachments: attList });
  else Object.assign(out, { hasMessage: !!b.message, attachmentKinds: attList.map((a) => a.kind) });
  return out;
}

const qr = (text) => QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const fakeAddress = () => encode('tb', [0, ...convertBits([...randomBytes(20)], 8, 5, true)]);
const fakeInvoice = (sats) => encode(`lntb${sats * 10}n`, convertBits([...randomBytes(130)], 8, 5, true));
const toBtc = (s) => (s / 1e8).toFixed(8);

function checkUnlock(u) {
  if (!u || (u.type !== 'date' && u.type !== 'milestone')) fail(400, 'Choose when it opens');
  if (u.type === 'milestone') { if ((u.text || '').trim().length < 3) fail(400, 'Describe the milestone'); return { type: 'milestone', at: null, text: u.text.trim() }; }
  const at = Date.parse(u.at), now = Date.now();
  if (!at || at < now + LIM.minLockSeconds * 1000) fail(400, 'Pick an unlock time a little further in the future');
  if (at > now + 3650 * 86400e3) fail(400, 'Unlock date is too far away (max 10 years)');
  return { type: 'date', at, text: null };
}
function checkAmount(n) {
  if (!Number.isInteger(n)) fail(400, 'Enter an amount');
  if (n < LIM.minSats) fail(400, `Minimum is ${LIM.minSats} sats`);
  if (n > LIM.maxSats) fail(400, `Launch limit is ${LIM.maxSats.toLocaleString('en-US')} sats per bottle`);
}

function validateDestination(kind, dest, sats) {
  const d = String(dest || '').trim();
  if (kind === 'lnurl') { if (!/^[a-z0-9._+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,24}$/i.test(d) && !/^lnurl1/i.test(d)) fail(400, 'Enter a Lightning address like you@wallet.com, or an LNURL.'); }
  else if (kind === 'onchain') { if (!validateAddress(d, NETWORK)) fail(400, `That isn't a valid ${NETWORK} native SegWit address (bc1…/tb1…). Check for typos.`); }
  else if (kind === 'lightning') {
    const inv = parseInvoice(d, NETWORK);
    if (!inv) fail(400, `That isn't a valid ${NETWORK} Lightning invoice.`);
    if (inv.msat === null || inv.msat !== BigInt(sats) * 1000n) fail(400, `The invoice must be for exactly ${sats.toLocaleString('en-US')} sats.`);
  } else fail(400, 'Choose where to send the sats');
}
function payout(b, { to, userId, txType, kind }) {
  b.status = to; b.claimedAt = Date.now(); b.payoutTxid = rid(32); b.payoutKind = kind;
  S.tx.unshift({ id: rid(8), userId, bottleId: b.id, type: txType, sats: b.amountSats, status: 'confirmed', ref: b.payoutTxid, createdAt: Date.now() });
  if (txType === 'claim') notify({ userId: b.senderId, bottleId: b.id, kind: 'bottle.claimed', text: `${b.recipientEmail} claimed your bottle.` });
  return b.payoutTxid;
}

const fileToDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
async function sniff(file) {
  const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (a, b2) => String.fromCharCode(...h.slice(a, b2));
  if (h[0] === 0x89 && ascii(1, 4) === 'PNG') return { kind: 'photo', mime: 'image/png' };
  if (h[0] === 0xff && h[1] === 0xd8) return { kind: 'photo', mime: 'image/jpeg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'photo', mime: 'image/webp' };
  if (h[0] === 0x1a && h[1] === 0x45) return { kind: 'voice', mime: 'audio/webm' };
  if (ascii(0, 4) === 'OggS') return { kind: 'voice', mime: 'audio/ogg' };
  if (ascii(4, 8) === 'ftyp') return { kind: 'voice', mime: 'audio/mp4' };
  if (ascii(0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return { kind: 'voice', mime: 'audio/mpeg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind: 'voice', mime: 'audio/wav' };
  return null;
}

// ---------- router ----------
export async function handle(method, rawPath, body) {
  await load();
  const [path, qs = ''] = rawPath.split('?');
  const q = new URLSearchParams(qs);
  const m = (re) => path.match(re);
  tick();
  const done = (v) => { save(); return v; };

  // public
  if (method === 'GET' && path === '/health') return { ok: true, network: NETWORK, simulated: true, limits: { minSats: LIM.minSats, maxSats: LIM.maxSats, minLockSeconds: LIM.minLockSeconds, messageChars: LIM.messageChars }, dev: true, staticDemo: true };

  // ---- auth
  if (method === 'POST' && path === '/auth/register') {
    const { name = '', email = '', password = '' } = body || {};
    const e = String(email).trim().toLowerCase();
    if (!String(name).trim()) fail(400, 'Enter your name');
    if (!emailOk(e)) fail(400, 'Enter a valid email');
    if (String(password).length < 12) fail(400, 'Use at least 12 characters');
    if (!S.users.some((u) => u.email === e)) {
      const u = { id: rid(8), name: String(name).trim().slice(0, 80), email: e, pw: await sha(password), verified: false };
      S.users.push(u);
      const t = rid(24); S.tokens[t] = u.id;
      mail(e, 'Verify your email', `Welcome to Sats in a Bottle, ${u.name}.\n\nConfirm your email:\n${location.origin}/verify?token=${t}`);
    }
    return done({ ok: true, message: 'Check your inbox to verify your email, then sign in.' });
  }
  if (method === 'POST' && path === '/auth/verify') {
    const id = S.tokens[body?.token];
    if (!id) fail(400, 'This link is invalid or has expired');
    const u = S.users.find((x) => x.id === id); if (u) u.verified = true; delete S.tokens[body.token];
    return done({ ok: true });
  }
  if (method === 'POST' && path === '/auth/login') {
    const e = String(body?.email || '').trim().toLowerCase();
    const u = S.users.find((x) => x.email === e);
    if (!u || u.pw !== (await sha(body?.password || ''))) fail(401, 'Email or password is incorrect');
    S.session = u.id;
    return done({ user: publicUser(u), csrfToken: 'static-demo' });
  }
  if (method === 'POST' && path === '/auth/logout') { S.session = null; return done({ ok: true }); }
  if (method === 'GET' && path === '/user/profile') return { user: publicUser(requireAuth()), csrfToken: 'static-demo' };
  if (method === 'POST' && path === '/auth/resend') {
    const u = requireAuth();
    if (!u.verified) { const t = rid(24); S.tokens[t] = u.id; mail(u.email, 'Verify your email', `Confirm your email:\n${location.origin}/verify?token=${t}`); }
    return done({ ok: true });
  }
  if (method === 'GET' && path === '/dev/outbox') return { emails: S.outbox.filter((x) => x.to === String(q.get('email') || '').toLowerCase()).slice(0, 5).map((x) => ({ to_email: x.to, subject: x.subject, body: x.body })) };

  // ---- bottles: collection
  if (method === 'POST' && path === '/bottles') {
    const u = requireVerified();
    const d = body || {};
    const rec = String(d.recipientEmail || '').trim().toLowerCase();
    if (!emailOk(rec)) fail(400, 'Enter a valid recipient email', { field: 'recipientEmail' });
    if (rec === u.email) fail(400, "You can't send a bottle to yourself", { field: 'recipientEmail' });
    checkAmount(d.amountSats);
    if (String(d.message || '').length > LIM.messageChars) fail(400, `Keep the message under ${LIM.messageChars} characters`);
    const un = checkUnlock(d.unlock);
    const b = { id: rid(16), senderId: u.id, recipientEmail: rec, title: String(d.title || '').trim().slice(0, 80), amountSats: d.amountSats, unlockType: un.type, unlockAt: un.at, milestone: un.text, status: 'draft', message: d.message || '', createdAt: Date.now(), fundedAt: null, sealedAt: null, readyAt: null, claimedAt: null, fund: null, payoutTxid: null, payoutKind: null };
    S.bottles.unshift(b);
    return done({ bottle: present(b, 'sender') });
  }
  if (method === 'GET' && path === '/bottles') {
    const u = requireAuth(); const role = q.get('role') || 'all'; const out = [];
    if (role !== 'received') for (const b of S.bottles.filter((x) => x.senderId === u.id)) out.push(present(b, 'sender'));
    if (role !== 'sent' && u.verified) for (const b of S.bottles.filter((x) => x.recipientEmail === u.email && VISIBLE_TO_RECIPIENT.includes(x.status))) out.push(present(b, 'recipient'));
    return done({ bottles: out });
  }
  if (method === 'GET' && path === '/transactions') {
    const u = requireAuth();
    const rows = S.tx.filter((t) => t.userId === u.id).map((t) => { const b = S.bottles.find((x) => x.id === t.bottleId); return { id: t.id, type: t.type, sats: t.sats, status: t.status, txid: t.ref, createdAt: t.createdAt, bottleId: t.bottleId, title: b?.title || '', recipientEmail: b?.recipientEmail, direction: t.type === 'fund' ? 'sent' : 'received' }; });
    return { transactions: rows, network: NETWORK };
  }
  if (method === 'GET' && path === '/activity') {
    const u = requireAuth();
    const items = S.notes.filter((n) => n.userId === u.id || (n.email === u.email && u.verified)).slice(0, 40).map((n) => ({ id: n.id, bottleId: n.bottleId, kind: n.kind, text: n.text, read: n.read, createdAt: n.createdAt }));
    return { items, unread: items.filter((i) => !i.read).length };
  }
  if (method === 'POST' && path === '/activity/read') { const u = requireAuth(); S.notes.forEach((n) => { if (n.userId === u.id || n.email === u.email) n.read = 1; }); return done({ ok: true }); }
  if (method === 'GET' && path === '/dev/demo-destination') { const sats = Math.max(1, parseInt(q.get('sats'), 10) || 1000); return { address: fakeAddress(), invoice: fakeInvoice(sats) }; }

  // ---- bottles: one
  let r;
  if ((r = m(/^\/bottles\/([^/]+)$/))) {
    const { b, role, u } = loadFor(r[1]);
    if (method === 'GET') return done({ bottle: present(b, role) });
    if (method === 'PUT') {
      requireVerified();
      if (role !== 'sender') fail(403, 'Only the sender can do that');
      if (!['draft', 'funded'].includes(b.status)) fail(409, `Not possible while the bottle is "${b.status}"`);
      const d = body || {};
      if (b.status === 'funded' && ['recipientEmail', 'amountSats', 'unlock'].some((k) => k in d)) fail(409, 'Recipient, amount and unlock rules are locked once funded');
      if (typeof d.title === 'string') b.title = d.title.trim().slice(0, 80);
      if (typeof d.message === 'string') { if (d.message.length > LIM.messageChars) fail(400, `Keep the message under ${LIM.messageChars} characters`); b.message = d.message; }
      if (d.amountSats && d.amountSats !== b.amountSats) { checkAmount(d.amountSats); b.amountSats = d.amountSats; b.fund = null; }
      if (d.recipientEmail) { const e = d.recipientEmail.trim().toLowerCase(); if (e === u.email) fail(400, "You can't send a bottle to yourself"); b.recipientEmail = e; }
      if (d.unlock) { const un = checkUnlock(d.unlock); b.unlockType = un.type; b.unlockAt = un.at; b.milestone = un.text; }
      return done({ bottle: present(b, 'sender') });
    }
  }
  const sub = (re) => { const x = path.match(re); return x ? x[1] : null; };
  if (method === 'POST' && (r = sub(/^\/bottles\/([^/]+)\/cancel$/))) {
    const { b, role } = loadFor(r); if (role !== 'sender') fail(403, 'Only the sender can do that'); if (b.status !== 'draft') fail(409, `Not possible while the bottle is "${b.status}"`);
    b.status = 'cancelled'; b.message = ''; for (const id of Object.keys(S.atts)) if (S.atts[id].bottleId === b.id) delete S.atts[id];
    return done({ bottle: present(b, 'sender') });
  }
  if (method === 'POST' && (r = sub(/^\/bottles\/([^/]+)\/attachments$/))) {
    requireVerified(); const { b, role } = loadFor(r); if (role !== 'sender') fail(403, 'Only the sender can do that'); if (!['draft', 'funded'].includes(b.status)) fail(409, `Not possible while the bottle is "${b.status}"`);
    const file = body instanceof FormData ? body.get('file') : null;
    if (!file) fail(400, 'No file received');
    const t = await sniff(file); if (!t) fail(415, 'Unsupported file. Use a JPG/PNG/WebP photo or a WebM/OGG/MP4/MP3/WAV voice note.');
    if (t.kind === 'photo' && file.size > LIM.photoBytes) fail(413, 'Photo is too large (max 4 MB)');
    if (t.kind === 'voice' && file.size > LIM.audioBytes) fail(413, 'Voice note is too large (max 6 MB)');
    for (const id of Object.keys(S.atts)) if (S.atts[id].bottleId === b.id && S.atts[id].kind === t.kind) delete S.atts[id];
    const id = rid(8); S.atts[id] = { id, bottleId: b.id, kind: t.kind, mime: t.mime, size: file.size, url: await fileToDataUrl(file) };
    return done({ bottle: present(b, 'sender') });
  }
  if (method === 'DELETE' && (r = path.match(/^\/bottles\/([^/]+)\/attachments\/([^/]+)$/))) {
    const { b, role } = loadFor(r[1]); if (role !== 'sender') fail(403, 'Only the sender can do that'); delete S.atts[r[2]];
    return done({ bottle: present(b, 'sender') });
  }
  if (method === 'POST' && (r = sub(/^\/bottles\/([^/]+)\/fund$/))) {
    requireVerified(); const { b, role } = loadFor(r); if (role !== 'sender') fail(403, 'Only the sender can do that'); if (!['draft', 'funded'].includes(b.status)) fail(409, `Not possible while the bottle is "${b.status}"`);
    if (b.status === 'draft' && b.unlockType === 'date' && b.unlockAt < Date.now() + LIM.minLockSeconds * 1000) fail(409, 'The unlock time has passed or is too close. Edit the bottle first.');
    if (b.status === 'draft' && (!b.fund || b.fund.expiresAt < Date.now())) b.fund = { address: fakeAddress(), invoice: fakeInvoice(b.amountSats), expiresAt: Date.now() + 60 * 60e3 };
    const f = b.fund;
    const uri = f ? `bitcoin:${f.address}?amount=${toBtc(b.amountSats)}` : null;
    done();
    return { status: b.status, amountSats: b.amountSats, expiresAt: f?.expiresAt, simulated: true, network: NETWORK,
      onchain: f ? { address: f.address, uri, qr: await qr(uri) } : null, lightning: f ? { invoice: f.invoice, qr: await qr(`lightning:${f.invoice}`) } : null };
  }
  if (method === 'POST' && (r = sub(/^\/dev\/bottles\/([^/]+)\/simulate-payment$/))) {
    const { b } = loadFor(r);
    if (b.status === 'draft') {
      b.status = 'funded'; b.fundedAt = Date.now();
      S.tx.unshift({ id: rid(8), userId: b.senderId, bottleId: b.id, type: 'fund', sats: b.amountSats, status: 'confirmed', ref: rid(32), createdAt: Date.now() });
      notify({ userId: b.senderId, bottleId: b.id, kind: 'bottle.funded', text: `Payment confirmed: ${b.amountSats.toLocaleString('en-US')} sats locked in your bottle. Seal it when you're ready.` });
      return done({ applied: true });
    }
    return { applied: false };
  }
  if (method === 'POST' && (r = sub(/^\/bottles\/([^/]+)\/seal$/))) {
    requireVerified(); const { b, role } = loadFor(r); if (role !== 'sender') fail(403, 'Only the sender can do that'); if (b.status !== 'funded') fail(409, `Not possible while the bottle is "${b.status}"`);
    if (!b.message && !atts(b).length) fail(409, 'Add a message, photo or voice note before sealing');
    if (b.unlockType === 'date' && b.unlockAt <= Date.now()) fail(409, 'The unlock time has already passed. Sealing would open it instantly, so this bottle can be refunded instead.');
    b.status = 'sealed'; b.sealedAt = Date.now();
    notify({ userId: b.senderId, bottleId: b.id, kind: 'bottle.sealed', text: `Bottle sealed. ${b.amountSats.toLocaleString('en-US')} sats are locked until ${b.unlockType === 'date' ? new Date(b.unlockAt).toUTCString() : 'you confirm the milestone'}.` });
    return done({ bottle: present(b, 'sender') });
  }
  if (method === 'POST' && (r = sub(/^\/bottles\/([^/]+)\/share$/))) {
    requireVerified(); const { b, role } = loadFor(r); if (role !== 'sender') fail(403, 'Only the sender can do that'); if (!['sealed', 'ready', 'claimed'].includes(b.status)) fail(409, `Not possible while the bottle is "${b.status}"`);
    const url = `${location.origin}/b/${b.id}`;
    if (body?.email) notify({ email: b.recipientEmail, bottleId: b.id, kind: 'bottle.shared', text: `${me().name} sent you a sealed bottle.` });
    return done({ url, qr: await qr(url), emailed: !!body?.email });
  }
  if (method === 'GET' && (r = sub(/^\/bottles\/([^/]+)\/status$/))) {
    const { b } = loadFor(r); const now = Date.now();
    return { status: b.status, serverNow: now, unlockAt: b.unlockAt, secondsRemaining: b.unlockType === 'date' && b.unlockAt ? Math.max(0, Math.ceil((b.unlockAt - now) / 1000)) : null };
  }
  if (method === 'POST' && (r = sub(/^\/bottles\/([^/]+)\/unlock$/))) {
    const { b, role } = loadFor(r);
    if (b.status === 'sealed') {
      if (b.unlockType === 'date') { if (Date.now() < b.unlockAt) fail(409, 'Still locked', { secondsRemaining: Math.ceil((b.unlockAt - Date.now()) / 1000) }); }
      else { if (role !== 'sender') fail(403, 'Only the sender can confirm this milestone'); b.milestoneConfirmedAt = Date.now(); }
      markReady(b);
    }
    if (!REVEALED.includes(b.status) && b.status !== 'sealed') fail(409, `Bottle is ${b.status}`);
    return done({ bottle: present(b, role) });
  }
  if (method === 'POST' && (r = sub(/^\/dev\/bottles\/([^/]+)\/fast-forward$/))) {
    const { b } = loadFor(r);
    if (b.status === 'sealed' && b.unlockType === 'date') { b.unlockAt = Date.now() - 1; markReady(b); }
    return done({ ok: true });
  }
  if (method === 'POST' && (r = path.match(/^\/bottles\/([^/]+)\/(claim|refund)$/))) {
    requireVerified(); const { b, role, u } = loadFor(r[1]); const claim = r[2] === 'claim';
    const d = body || {};
    if (claim) {
      if (role !== 'recipient') fail(403, 'Only the recipient can claim this bottle');
      if (b.status !== 'ready') fail(409, b.status === 'claimed' ? 'Already claimed' : 'This bottle is not ready to claim yet');
    } else {
      if (role !== 'sender') fail(403, 'Only the sender can do that');
      if (!['funded', 'ready'].includes(b.status)) fail(409, `Not possible while the bottle is "${b.status}"`);
      if (b.status === 'ready' && Date.now() < b.readyAt + CLAIM_WINDOW_MS) fail(409, 'The recipient has 365 days after unlock to claim before you can reclaim the sats');
    }
    if (d.confirmAmountSats !== b.amountSats) fail(400, 'Amount confirmation does not match');
    validateDestination(d.kind, d.destination, b.amountSats);
    const txid = payout(b, { to: claim ? 'claimed' : 'refunded', userId: u.id, txType: claim ? 'claim' : 'refund', kind: d.kind === 'lnurl' ? 'lightning' : d.kind });
    done();
    return { txid, bottle: present(b, role) };
  }
  fail(404, 'Not found');
}
