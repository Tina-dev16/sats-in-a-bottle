import crypto from 'node:crypto';
import { config } from './config.js';
import { all, get, run, tx } from './db.js';

/** Tamper-evident audit log: each row's HMAC covers the previous row's hash (a hash chain). */
export function audit(action, { userId = null, bottleId = null, ip = null, meta = {} } = {}) {
  tx(() => {
    const prev = get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')?.hash || 'genesis';
    const at = Date.now();
    const m = JSON.stringify(meta);
    const hash = crypto.createHmac('sha256', config.keys.audit).update([prev, at, userId, bottleId, action, ip, m].join('|')).digest('hex');
    run('INSERT INTO audit_log (at,user_id,bottle_id,action,ip,meta,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?)', at, userId, bottleId, action, ip, m, prev, hash);
  });
}

export function verifyAuditChain() {
  let prev = 'genesis';
  for (const r of all('SELECT * FROM audit_log ORDER BY id')) {
    const hash = crypto.createHmac('sha256', config.keys.audit).update([prev, r.at, r.user_id, r.bottle_id, r.action, r.ip, r.meta].join('|')).digest('hex');
    if (r.prev_hash !== prev || r.hash !== hash) return { ok: false, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true };
}
