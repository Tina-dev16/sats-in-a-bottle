import { get, run } from './db.js';
import { newId } from './crypto.js';
import { sendMail } from './mailer.js';
import { config } from './config.js';

/** In-app notification + (optional) email. Email bodies never contain message text or amounts-to-be-claimed secrets. */
export async function notify({ email, userId, bottleId, kind, text, mail }) {
  const uid = userId ?? get('SELECT id FROM users WHERE email = ? AND email_verified = 1', email)?.id ?? null;
  run('INSERT INTO notifications (id,user_id,email,bottle_id,kind,text,created_at) VALUES (?,?,?,?,?,?,?)',
    newId(8), uid, uid ? null : email, bottleId ?? null, kind, text, Date.now());
  if (mail) {
    const to = email ?? get('SELECT email FROM users WHERE id = ?', uid)?.email;
    if (to) await sendMail(to, mail.subject, `${mail.body}\n\n- Sats in a Bottle\n${config.appUrl}`);
  }
}
