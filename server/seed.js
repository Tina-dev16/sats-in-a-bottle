import { get, run, tx } from './db.js';
import { hashPassword, newId, newDek, seal } from './crypto.js';
import { audit } from './audit.js';

export const DEMO_PASSWORD = 'demo-bottle-2026';
export const DEMO = [
  { name: 'Alice Demo', email: 'alice@demo.test' },
  { name: 'Bob Demo', email: 'bob@demo.test' },
];

/** Dev only: two verified accounts and one sealed bottle that opens a few minutes after first boot. */
export async function seedDemo() {
  const ids = {};
  for (const u of DEMO) {
    const row = get('SELECT id FROM users WHERE email = ?', u.email);
    if (row) { ids[u.email] = row.id; continue; }
    const id = newId(12);
    run('INSERT INTO users (id,name,email,pw_hash,email_verified,created_at) VALUES (?,?,?,?,1,?)', id, u.name, u.email, await hashPassword(DEMO_PASSWORD), Date.now());
    ids[u.email] = id;
    audit('seed.user', { userId: id });
  }
  if (get('SELECT 1 x FROM bottles WHERE sender_id = ?', ids['alice@demo.test'])) return;
  const id = newId(16), { dek, wrapped } = newDek(id), now = Date.now();
  tx(() => {
    run(`INSERT INTO bottles (id,sender_id,recipient_email,title,amount_sats,unlock_type,unlock_at,status,dek_wrapped,msg_enc,created_at,funded_at,sealed_at,fund_txid)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ids['alice@demo.test'], 'bob@demo.test', 'Happy birthday Bob', 210000, 'date', now + 3 * 60e3, 'sealed', wrapped,
      seal(dek, Buffer.from('Dear Bob,\n\nHappy birthday! Spend these wisely, or just stack them.\n\nAlice', 'utf8'), `msg:${id}`), now, now, now, 'demo');
    run('INSERT INTO transactions (id,user_id,bottle_id,type,sats,status,ref,created_at) VALUES (?,?,?,?,?,?,?,?)', newId(8), ids['alice@demo.test'], id, 'fund', 210000, 'confirmed', 'demo', now);
  });
}
