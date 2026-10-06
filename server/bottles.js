import { config } from './config.js';
import { get, all, run, tx } from './db.js';
import { open, unwrapDek } from './crypto.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { validateAddress, parseInvoice } from './bech32.js';
import { provider } from './payments.js';
import { HttpError } from './middleware.js';
import { isLightningAddress, lnurlEndpoint, invoiceFromLnurl } from './lnurl.js';
import { newId } from './crypto.js';

const DAY = 86400e3;
export const VISIBLE_TO_RECIPIENT = ['sealed', 'ready', 'claiming', 'claimed'];
export const REVEALED = ['ready', 'claiming', 'claimed'];

export const roleOf = (b, user) =>
  b.sender_id === user.id ? 'sender'
    : user.email_verified && user.email === b.recipient_email ? 'recipient' : null;

/** Returns { b, role } or throws 404, identical response whether it doesn't exist or isn't yours. */
export function loadFor(id, user) {
  const b = typeof id === 'string' && id.length < 64 ? get('SELECT * FROM bottles WHERE id = ?', id) : null;
  const role = b && roleOf(b, user);
  if (!b || !role || (role === 'recipient' && !VISIBLE_TO_RECIPIENT.includes(b.status))) throw new HttpError(404, 'Bottle not found');
  if (role === 'recipient' && !b.recipient_user_id) run('UPDATE bottles SET recipient_user_id = ? WHERE id = ?', user.id, b.id);
  return { b, role };
}

export const decryptMessage = (b) =>
  b.msg_enc ? open(unwrapDek(b.id, b.dek_wrapped), b.msg_enc, `msg:${b.id}`).toString('utf8') : '';

export function present(b, role) {
  const sender = get('SELECT name FROM users WHERE id = ?', b.sender_id);
  const revealed = REVEALED.includes(b.status);
  const out = {
    id: b.id, role, status: b.status, title: b.title, amountSats: b.amount_sats,
    unlock: { type: b.unlock_type, at: b.unlock_at, milestone: b.milestone_text, confirmedAt: b.milestone_confirmed_at },
    senderName: sender?.name, createdAt: b.created_at, fundedAt: b.funded_at, sealedAt: b.sealed_at,
    readyAt: b.ready_at, claimedAt: b.claimed_at, serverNow: Date.now(),
    claimDeadline: b.ready_at ? b.ready_at + config.limits.claimWindowDays * DAY : null,
    network: config.network, simulated: provider.simulated,
  };
  if (role === 'sender') {
    Object.assign(out, { recipientEmail: b.recipient_email, shareUrl: shareUrl(b), payoutTxid: b.payout_txid, payoutKind: b.payout_kind });
    out.message = decryptMessage(b); // the author may always re-read their own words
  } else if (revealed) {
    out.message = decryptMessage(b);
    out.payoutTxid = b.payout_txid;
  }
  if (role === 'sender' || revealed) {
    out.attachments = all('SELECT id,kind,mime,size FROM attachments WHERE bottle_id = ? ORDER BY created_at', b.id);
  } else {
    // Locked: reveal only *that* there is something inside, never what.
    out.hasMessage = !!b.msg_enc;
    out.attachmentKinds = all('SELECT kind FROM attachments WHERE bottle_id = ?', b.id).map((a) => a.kind);
  }
  return out;
}
export const shareUrl = (b) => `${config.appUrl}/b/${b.id}`;

/** sealed -> ready. Idempotent; safe to call from the scheduler and from request handlers. */
export async function markReady(b) {
  const now = Date.now();
  const changed = run("UPDATE bottles SET status='ready', ready_at=? WHERE id=? AND status='sealed'", now, b.id).changes;
  if (!changed) return false;
  audit('bottle.ready', { bottleId: b.id, meta: { type: b.unlock_type } });
  const sender = get('SELECT name FROM users WHERE id = ?', b.sender_id);
  await notify({ email: b.recipient_email, bottleId: b.id, kind: 'bottle.ready',
    text: `A bottle from ${sender?.name} is ready to open.`,
    mail: { subject: 'Your bottle is ready to open', body: `A bottle from ${sender?.name} just unlocked. Sign in to read the message and claim your sats:\n${config.appUrl}/b/${b.id}` } });
  await notify({ userId: b.sender_id, bottleId: b.id, kind: 'bottle.ready',
    text: `Your bottle to ${b.recipient_email} has unlocked.` });
  return true;
}

/** Called by the payment webhook (and the dev simulator). Idempotent + amount-checked. */
export async function confirmFunding(bottleId, { txid, sats }) {
  const b = get('SELECT * FROM bottles WHERE id = ?', bottleId);
  if (!b) throw new HttpError(404, 'Unknown bottle');
  if (b.status !== 'draft') return { applied: false };
  if (!Number.isInteger(sats) || sats < b.amount_sats) throw new HttpError(409, 'Underpayment, bottle not funded', { expected: b.amount_sats, received: sats });
  const ok = tx(() => {
    const r = run("UPDATE bottles SET status='funded', funded_at=?, fund_txid=? WHERE id=? AND status='draft'", Date.now(), txid, b.id);
    if (!r.changes) return false;
    run("INSERT INTO transactions (id,user_id,bottle_id,type,sats,status,ref,created_at) VALUES (?,?,?,?,?,?,?,?)",
      newId(8), b.sender_id, b.id, 'fund', b.amount_sats, 'confirmed', txid, Date.now());
    return true;
  });
  if (!ok) return { applied: false };
  audit('bottle.funded', { userId: b.sender_id, bottleId: b.id, meta: { sats: b.amount_sats, txid } });
  await notify({ userId: b.sender_id, bottleId: b.id, kind: 'bottle.funded', text: `Payment confirmed: ${b.amount_sats.toLocaleString('en-US')} sats locked in your bottle. Seal it when you're ready.`,
    mail: { subject: 'Bottle funded', body: 'Your payment was confirmed. Open the bottle and seal it.' } });
  return { applied: true };
}

export function validateDestination(kind, destination, sats) {
  if (kind === 'lnurl') {
    if (!lnurlEndpoint(destination)) throw new HttpError(400, 'Enter a Lightning address like you@wallet.com, or an LNURL.');
  } else if (kind === 'onchain') {
    if (!validateAddress(destination, config.network)) throw new HttpError(400, `That isn't a valid ${config.network} native SegWit address (bc1…/tb1…). Check for typos.`);
  } else {
    const inv = parseInvoice(destination, config.network);
    if (!inv) throw new HttpError(400, `That isn't a valid ${config.network} Lightning invoice.`);
    if (inv.msat === null || inv.msat !== BigInt(sats) * 1000n) throw new HttpError(400, `The invoice must be for exactly ${sats.toLocaleString('en-US')} sats.`);
  }
}

/** Atomic claim/refund: status flip is the lock, so a double-click or replay can never pay out twice. */
export async function payoutBottle(b, { from, to, kind, destination, userId, txType, ip }) {
  validateDestination(kind, destination, b.amount_sats);
  // A Lightning address is resolved to an exact-amount invoice first; nothing is locked if that fails.
  if (kind === 'lnurl') {
    destination = provider.simulated && isLightningAddress(destination) ? destination : await invoiceFromLnurl(destination, b.amount_sats);
    kind = 'lightning';
  }
  if (!run('UPDATE bottles SET status=\'claiming\' WHERE id=? AND status=?', b.id, from).changes) throw new HttpError(409, 'This bottle can no longer be claimed');
  let result;
  try {
    result = await provider.payout({ idempotencyKey: `${b.id}:${txType}`, kind, destination, sats: b.amount_sats });
  } catch (e) {
    run("UPDATE bottles SET status=? WHERE id=? AND status='claiming'", from, b.id);
    audit('bottle.payout_failed', { userId, bottleId: b.id, ip, meta: { err: String(e.message).slice(0, 200) } });
    throw new HttpError(502, 'The payout failed and nothing was sent. Please try again.');
  }
  tx(() => {
    run('UPDATE bottles SET status=?, claimed_at=?, payout_txid=?, payout_kind=? WHERE id=?', to, Date.now(), result.txid, kind, b.id);
    run('INSERT INTO transactions (id,user_id,bottle_id,type,sats,status,ref,created_at) VALUES (?,?,?,?,?,?,?,?)',
      newId(8), userId, b.id, txType, b.amount_sats, 'confirmed', result.txid, Date.now());
  });
  audit(`bottle.${txType}`, { userId, bottleId: b.id, ip, meta: { sats: b.amount_sats, kind, txid: result.txid } });
  if (txType === 'claim') {
    await notify({ userId: b.sender_id, bottleId: b.id, kind: 'bottle.claimed', text: `${b.recipient_email} claimed your bottle. 🍾`,
      mail: { subject: 'Your bottle was claimed', body: 'The recipient has claimed the sats from your bottle.' } });
  }
  return result;
}
