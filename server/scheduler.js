import { all, run } from './db.js';
import { markReady } from './bottles.js';
import { notify } from './notify.js';
import { audit } from './audit.js';
import { config } from './config.js';

const HOUR = 3600e3;

export async function tick() {
  const now = Date.now();
  // 1. Time-locked bottles whose date has passed.
  for (const b of all("SELECT * FROM bottles WHERE status='sealed' AND unlock_type='date' AND unlock_at <= ?", now)) await markReady(b);
  // 2. 24h reminder, once.
  for (const b of all("SELECT * FROM bottles WHERE status='sealed' AND unlock_type='date' AND reminded_at IS NULL AND unlock_at <= ?", now + 24 * HOUR)) {
    run('UPDATE bottles SET reminded_at=? WHERE id=?', now, b.id);
    await notify({ userId: b.sender_id, bottleId: b.id, kind: 'bottle.reminder', text: 'A bottle you sealed opens within 24 hours.' });
    await notify({ email: b.recipient_email, bottleId: b.id, kind: 'bottle.reminder', text: 'A bottle for you opens within 24 hours.',
      mail: { subject: 'A bottle for you opens tomorrow', body: `A sealed bottle addressed to you unlocks within 24 hours.\n${config.appUrl}/b/${b.id}` } });
  }
  // 3. Payouts that died mid-flight need a human (the provider's idempotency key makes retries safe).
  for (const b of all("SELECT id FROM bottles WHERE status='claiming'")) {
    audit('bottle.stuck_claiming', { bottleId: b.id });
    console.error(`[reconcile] bottle ${b.id} is stuck in 'claiming', check the payment provider for idempotency key ${b.id}:*`);
  }
}

export function startScheduler() {
  const t = setInterval(() => tick().catch((e) => console.error('[scheduler]', e)), 15_000);
  t.unref();
  tick().catch((e) => console.error('[scheduler]', e));
  return t;
}
