import nodemailer from 'nodemailer';
import { config, isProd } from './config.js';
import { run } from './db.js';

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;

/** Never put message contents or secrets other than one-time links in email bodies. */
export async function sendMail(to, subject, body) {
  if (!isProd || !transport) run('INSERT INTO outbox (to_email,subject,body,created_at) VALUES (?,?,?,?)', to, subject, body, Date.now());
  if (transport) {
    try { await transport.sendMail({ from: config.mailFrom, to, subject, text: body }); }
    catch (e) { console.error('[mail] send failed:', e.message); }
  } else if (!isProd) console.log(`[mail] to=${to} subject="${subject}"`);
  else console.warn('[mail] SMTP_URL not configured; email dropped');
}
