import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from './config.js';
import { get, all, run, tx } from './db.js';
import { newId, newDek, unwrapDek, seal } from './crypto.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { provider, qr, bip21 } from './payments.js';
import { writeBlob, readBlob, deleteBlob, sniff } from './files.js';
import { HttpError, wrap, requireAuth, requireVerified, moneyLimiter, uploadLimiter } from './middleware.js';
import { loadFor, present, markReady, payoutBottle, shareUrl, REVEALED, VISIBLE_TO_RECIPIENT } from './bottles.js';

export const bottleRouter = Router();
bottleRouter.use(requireAuth);

const L = config.limits;
const encMsg = (b, text) => seal(unwrapDek(b.id, b.dek_wrapped), Buffer.from(text, 'utf8'), `msg:${b.id}`);

const unlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('date'), at: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal('milestone'), text: z.string().trim().min(3, 'Describe the milestone').max(280) }),
]);
const fields = {
  recipientEmail: z.string().trim().toLowerCase().email('Enter a valid recipient email').max(254),
  title: z.string().trim().max(80),
  message: z.string().max(L.messageChars, `Keep the message under ${L.messageChars} characters`),
  amountSats: z.number({ invalid_type_error: 'Enter an amount' }).int().min(L.minSats, `Minimum is ${L.minSats} sats`).max(L.maxSats, `Launch limit is ${L.maxSats.toLocaleString('en-US')} sats per bottle`),
  unlock: unlockSchema,
};
const createSchema = z.object({ ...fields, title: fields.title.default(''), message: fields.message.default('') }).strict();
const updateSchema = z.object(fields).partial().strict();

function checkUnlock(u) {
  if (u.type !== 'date') return { type: 'milestone', at: null, text: u.text };
  const at = Date.parse(u.at), now = Date.now();
  if (at < now + L.minLockSeconds * 1000) throw new HttpError(400, 'Pick an unlock time further in the future', { field: 'unlock.at' });
  if (at > now + L.maxLockDays * 86400e3) throw new HttpError(400, 'Unlock date is too far away (max 10 years)', { field: 'unlock.at' });
  return { type: 'date', at, text: null };
}
const ownBottle = (req, statuses) => {
  const { b, role } = loadFor(req.params.id, req.user);
  if (role !== 'sender') throw new HttpError(403, 'Only the sender can do that');
  if (statuses && !statuses.includes(b.status)) throw new HttpError(409, `Not possible while the bottle is "${b.status}"`);
  return b;
};

// ---- create / list / read / edit ------------------------------------------------------------
bottleRouter.post('/bottles', requireVerified, wrap(async (req, res) => {
  const d = createSchema.parse(req.body);
  if (d.recipientEmail === req.user.email) throw new HttpError(400, "You can't send a bottle to yourself", { field: 'recipientEmail' });
  const u = checkUnlock(d.unlock);
  const id = newId(16), { wrapped, dek } = newDek(id);
  run(`INSERT INTO bottles (id,sender_id,recipient_email,title,amount_sats,unlock_type,unlock_at,milestone_text,status,dek_wrapped,msg_enc,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, req.user.id, d.recipientEmail, d.title, d.amountSats, u.type, u.at, u.text, 'draft', wrapped,
    d.message ? seal(dek, Buffer.from(d.message), `msg:${id}`) : null, Date.now());
  audit('bottle.create', { userId: req.user.id, bottleId: id, ip: req.ip });
  res.status(201).json({ bottle: present(get('SELECT * FROM bottles WHERE id=?', id), 'sender') });
}));

bottleRouter.get('/bottles', wrap(async (req, res) => {
  const role = z.enum(['sent', 'received', 'all']).catch('all').parse(req.query.role);
  const out = [];
  if (role !== 'received') for (const b of all('SELECT * FROM bottles WHERE sender_id = ? ORDER BY created_at DESC LIMIT 200', req.user.id)) out.push(present(b, 'sender'));
  if (role !== 'sent' && req.user.email_verified) {
    const q = `SELECT * FROM bottles WHERE recipient_email = ? AND status IN (${VISIBLE_TO_RECIPIENT.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 200`;
    for (const b of all(q, req.user.email, ...VISIBLE_TO_RECIPIENT)) out.push(present(b, 'recipient'));
  }
  res.json({ bottles: out });
}));

bottleRouter.get('/bottles/:id', wrap(async (req, res) => {
  const { b, role } = loadFor(req.params.id, req.user);
  res.json({ bottle: present(b, role) });
}));

bottleRouter.put('/bottles/:id', requireVerified, wrap(async (req, res) => {
  const b = ownBottle(req, ['draft', 'funded']);
  const d = updateSchema.parse(req.body);
  const locked = ['recipientEmail', 'amountSats', 'unlock'];
  if (b.status === 'funded' && locked.some((k) => k in d)) throw new HttpError(409, 'Recipient, amount and unlock rules are locked once funded');
  if (d.recipientEmail === req.user.email) throw new HttpError(400, "You can't send a bottle to yourself");
  const sets = [], vals = [];
  const set = (c, v) => { sets.push(`${c} = ?`); vals.push(v); };
  if (d.recipientEmail) set('recipient_email', d.recipientEmail);
  if (d.title !== undefined) set('title', d.title);
  if (d.message !== undefined) set('msg_enc', d.message ? encMsg(b, d.message) : null);
  if (d.amountSats) set('amount_sats', d.amountSats);
  if (d.unlock) { const u = checkUnlock(d.unlock); set('unlock_type', u.type); set('unlock_at', u.at); set('milestone_text', u.text); }
  // Any change to what's being paid invalidates an outstanding invoice.
  if (d.amountSats && d.amountSats !== b.amount_sats) { set('fund_address', null); set('fund_invoice', null); set('fund_ref', null); set('fund_expires_at', null); }
  if (sets.length) run(`UPDATE bottles SET ${sets.join(', ')} WHERE id = ? AND status IN ('draft','funded')`, ...vals, b.id);
  audit('bottle.edit', { userId: req.user.id, bottleId: b.id, ip: req.ip, meta: { fields: Object.keys(d) } });
  res.json({ bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'sender') });
}));

bottleRouter.post('/bottles/:id/cancel', requireVerified, wrap(async (req, res) => {
  const b = ownBottle(req, ['draft']);
  run("UPDATE bottles SET status='cancelled', msg_enc=NULL WHERE id=? AND status='draft'", b.id);
  for (const a of all('SELECT id FROM attachments WHERE bottle_id=?', b.id)) deleteBlob(a.id);
  run('DELETE FROM attachments WHERE bottle_id=?', b.id);
  audit('bottle.cancel', { userId: req.user.id, bottleId: b.id, ip: req.ip });
  res.json({ bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'sender') });
}));

// ---- attachments ----------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(L.photoBytes, L.audioBytes), files: 1, fields: 2 } });

bottleRouter.post('/bottles/:id/attachments', requireVerified, uploadLimiter, upload.single('file'), wrap(async (req, res) => {
  const b = ownBottle(req, ['draft', 'funded']);
  if (!req.file) throw new HttpError(400, 'No file received');
  const t = sniff(req.file.buffer);
  if (!t) throw new HttpError(415, 'Unsupported file. Use a JPG/PNG/WebP photo or a WebM/OGG/MP4/MP3/WAV voice note.');
  if (t.kind === 'photo' && req.file.size > L.photoBytes) throw new HttpError(413, 'Photo is too large (max 4 MB)');
  if (t.kind === 'voice' && req.file.size > L.audioBytes) throw new HttpError(413, 'Voice note is too large (max 6 MB)');
  const dek = unwrapDek(b.id, b.dek_wrapped);
  const id = newId(12);
  tx(() => {
    for (const old of all('SELECT id FROM attachments WHERE bottle_id=? AND kind=?', b.id, t.kind)) { deleteBlob(old.id); run('DELETE FROM attachments WHERE id=?', old.id); }
    writeBlob(id, dek, b.id, req.file.buffer);
    run('INSERT INTO attachments (id,bottle_id,kind,mime,size,created_at) VALUES (?,?,?,?,?,?)', id, b.id, t.kind, t.mime, req.file.size, Date.now());
  });
  audit('bottle.attach', { userId: req.user.id, bottleId: b.id, ip: req.ip, meta: { kind: t.kind } });
  res.status(201).json({ bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'sender') });
}));

bottleRouter.delete('/bottles/:id/attachments/:aid', requireVerified, wrap(async (req, res) => {
  const b = ownBottle(req, ['draft', 'funded']);
  const a = get('SELECT id FROM attachments WHERE id=? AND bottle_id=?', req.params.aid, b.id);
  if (!a) throw new HttpError(404, 'Not found');
  deleteBlob(a.id); run('DELETE FROM attachments WHERE id=?', a.id);
  res.json({ bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'sender') });
}));

bottleRouter.get('/bottles/:id/attachments/:aid', wrap(async (req, res) => {
  const { b, role } = loadFor(req.params.id, req.user);
  if (role === 'recipient' && !REVEALED.includes(b.status)) throw new HttpError(404, 'Not found'); // locked = hidden
  const a = get('SELECT * FROM attachments WHERE id=? AND bottle_id=?', req.params.aid, b.id);
  if (!a) throw new HttpError(404, 'Not found');
  const buf = readBlob(a.id, unwrapDek(b.id, b.dek_wrapped), b.id);
  res.set({ 'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline' });
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) { // Safari needs Range support to play audio
    let start = m[1] ? +m[1] : buf.length - +m[2], end = m[1] && m[2] ? +m[2] : buf.length - 1;
    end = Math.min(end, buf.length - 1);
    if (start > end || start < 0) return res.status(416).set('Content-Range', `bytes */${buf.length}`).end();
    return res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 }).end(buf.subarray(start, end + 1));
  }
  res.set('Content-Length', buf.length).end(buf);
}));

// ---- fund / seal / share / status -----------------------------------------------------------
bottleRouter.post('/bottles/:id/fund', requireVerified, moneyLimiter, wrap(async (req, res) => {
  let b = ownBottle(req, ['draft', 'funded']);
  if (b.status === 'draft') {
    if (b.unlock_type === 'date' && b.unlock_at < Date.now() + L.minLockSeconds * 1000) throw new HttpError(409, 'The unlock time has passed or is too close. Edit the bottle first.');
    const stale = !b.fund_address || !b.fund_expires_at || b.fund_expires_at < Date.now();
    if (stale) {
      const expiresAt = Date.now() + L.fundingTtlMinutes * 60e3;
      const f = await provider.createFunding({ bottleId: b.id, sats: b.amount_sats, expiresAt });
      run('UPDATE bottles SET fund_address=?, fund_invoice=?, fund_ref=?, fund_expires_at=? WHERE id=? AND status=\'draft\'', f.address, f.invoice, f.ref, expiresAt, b.id);
      audit('bottle.fund_requested', { userId: req.user.id, bottleId: b.id, ip: req.ip });
      b = get('SELECT * FROM bottles WHERE id=?', b.id);
    }
  }
  res.json({
    status: b.status, amountSats: b.amount_sats, expiresAt: b.fund_expires_at, simulated: provider.simulated, network: config.network,
    onchain: b.fund_address ? { address: b.fund_address, uri: bip21(b.fund_address, b.amount_sats), qr: await qr(bip21(b.fund_address, b.amount_sats)) } : null,
    lightning: b.fund_invoice ? { invoice: b.fund_invoice, qr: await qr(`lightning:${b.fund_invoice}`) } : null,
  });
}));

bottleRouter.post('/bottles/:id/seal', requireVerified, moneyLimiter, wrap(async (req, res) => {
  const b = ownBottle(req, ['funded']);
  const hasAtt = get('SELECT 1 x FROM attachments WHERE bottle_id=?', b.id);
  if (!b.msg_enc && !hasAtt) throw new HttpError(409, 'Add a message, photo or voice note before sealing');
  if (b.unlock_type === 'date' && b.unlock_at <= Date.now()) throw new HttpError(409, 'The unlock time has already passed. Sealing would open it instantly, this bottle can be refunded instead.');
  if (!run("UPDATE bottles SET status='sealed', sealed_at=? WHERE id=? AND status='funded'", Date.now(), b.id).changes) throw new HttpError(409, 'Already sealed');
  audit('bottle.seal', { userId: req.user.id, bottleId: b.id, ip: req.ip });
  await notify({ userId: req.user.id, bottleId: b.id, kind: 'bottle.sealed', text: `Bottle sealed. ${b.amount_sats.toLocaleString('en-US')} sats are locked until ${b.unlock_type === 'date' ? new Date(b.unlock_at).toUTCString() : 'you confirm the milestone'}.` });
  res.json({ bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'sender') });
}));

bottleRouter.post('/bottles/:id/share', requireVerified, wrap(async (req, res) => {
  const b = ownBottle(req, ['sealed', 'ready', 'claimed']);
  const { email } = z.object({ email: z.boolean().default(false) }).strict().parse(req.body ?? {});
  run('UPDATE bottles SET shared_at = COALESCE(shared_at, ?) WHERE id = ?', Date.now(), b.id);
  if (email) {
    await notify({ email: b.recipient_email, bottleId: b.id, kind: 'bottle.shared', text: `${req.user.name} sent you a sealed bottle.`,
      mail: { subject: `${req.user.name} sent you a bottle`, body: `${req.user.name} sealed a bottle for you.${b.unlock_type === 'date' ? ` It opens ${new Date(b.unlock_at).toUTCString()}.` : ''}\nSign in (or create an account with this email address) to see it:\n${shareUrl(b)}` } });
  }
  audit('bottle.share', { userId: req.user.id, bottleId: b.id, ip: req.ip, meta: { email } });
  res.json({ url: shareUrl(b), qr: await qr(shareUrl(b)), emailed: email });
}));

bottleRouter.get('/bottles/:id/status', wrap(async (req, res) => {
  const { b } = loadFor(req.params.id, req.user);
  const now = Date.now();
  res.json({ status: b.status, serverNow: now, unlockAt: b.unlock_at,
    secondsRemaining: b.unlock_type === 'date' && b.unlock_at ? Math.max(0, Math.ceil((b.unlock_at - now) / 1000)) : null });
}));

// ---- unlock / claim / refund ----------------------------------------------------------------
bottleRouter.post('/bottles/:id/unlock', wrap(async (req, res) => {
  const { b, role } = loadFor(req.params.id, req.user);
  if (b.status === 'sealed') {
    if (b.unlock_type === 'date') {
      if (Date.now() < b.unlock_at) throw new HttpError(409, 'Still locked', { secondsRemaining: Math.ceil((b.unlock_at - Date.now()) / 1000) });
    } else {
      if (role !== 'sender') throw new HttpError(403, 'Only the sender can confirm this milestone');
      run('UPDATE bottles SET milestone_confirmed_at = ? WHERE id = ? AND status = \'sealed\'', Date.now(), b.id);
      audit('bottle.milestone_confirmed', { userId: req.user.id, bottleId: b.id, ip: req.ip });
    }
    await markReady(b);
  }
  const fresh = get('SELECT * FROM bottles WHERE id=?', b.id);
  if (!REVEALED.includes(fresh.status) && fresh.status !== 'sealed') throw new HttpError(409, `Bottle is ${fresh.status}`);
  res.json({ bottle: present(fresh, role) });
}));

const payoutSchema = z.object({
  kind: z.enum(['onchain', 'lightning', 'lnurl']),
  destination: z.string().trim().min(10).max(2048),
  confirmAmountSats: z.number().int(),
}).strict();

bottleRouter.post('/bottles/:id/claim', requireVerified, moneyLimiter, wrap(async (req, res) => {
  const { b, role } = loadFor(req.params.id, req.user);
  if (role !== 'recipient') throw new HttpError(403, 'Only the recipient can claim this bottle');
  if (b.status !== 'ready') throw new HttpError(409, b.status === 'claimed' ? 'Already claimed' : 'This bottle is not ready to claim yet');
  const d = payoutSchema.parse(req.body);
  if (d.confirmAmountSats !== b.amount_sats) throw new HttpError(400, 'Amount confirmation does not match');
  const r = await payoutBottle(b, { from: 'ready', to: 'claimed', kind: d.kind, destination: d.destination, userId: req.user.id, txType: 'claim', ip: req.ip });
  res.json({ txid: r.txid, bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'recipient') });
}));

/** Sender gets funds back if: funded but never sealed, or the recipient never claimed within the window. */
bottleRouter.post('/bottles/:id/refund', requireVerified, moneyLimiter, wrap(async (req, res) => {
  const b = ownBottle(req, ['funded', 'ready']);
  if (b.status === 'ready' && Date.now() < b.ready_at + L.claimWindowDays * 86400e3)
    throw new HttpError(409, `The recipient has ${L.claimWindowDays} days after unlock to claim before you can reclaim the sats`);
  const d = payoutSchema.parse(req.body);
  if (d.confirmAmountSats !== b.amount_sats) throw new HttpError(400, 'Amount confirmation does not match');
  const r = await payoutBottle(b, { from: b.status, to: 'refunded', kind: d.kind, destination: d.destination, userId: req.user.id, txType: 'refund', ip: req.ip });
  res.json({ txid: r.txid, bottle: present(get('SELECT * FROM bottles WHERE id=?', b.id), 'sender') });
}));

// ---- history / activity ---------------------------------------------------------------------
bottleRouter.get('/transactions', wrap(async (req, res) => {
  const rows = all(`SELECT t.id, t.type, t.sats, t.status, t.ref AS txid, t.created_at AS createdAt, t.bottle_id AS bottleId, b.title, b.recipient_email AS recipientEmail
                    FROM transactions t JOIN bottles b ON b.id = t.bottle_id WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 200`, req.user.id);
  res.json({ transactions: rows.map((r) => ({ ...r, direction: r.type === 'claim' || r.type === 'refund' ? 'received' : 'sent' })), network: config.network });
}));

bottleRouter.get('/activity', wrap(async (req, res) => {
  const items = all(`SELECT id, bottle_id AS bottleId, kind, text, read, created_at AS createdAt FROM notifications
                     WHERE user_id = ? OR (email = ? AND ? = 1) ORDER BY created_at DESC LIMIT 40`, req.user.id, req.user.email, req.user.email_verified);
  res.json({ items, unread: items.filter((i) => !i.read).length });
}));
bottleRouter.post('/activity/read', wrap(async (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ? OR (email = ? AND ? = 1)', req.user.id, req.user.email, req.user.email_verified);
  res.json({ ok: true });
}));
