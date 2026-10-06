import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { get, run, tx } from './db.js';
import { hashPassword, verifyPassword, DUMMY_HASH, newId, sha256 } from './crypto.js';
import { audit } from './audit.js';
import { sendMail } from './mailer.js';
import { COOKIE, cookieOpts, SESSION_MS, HttpError, wrap, authLimiter, requireAuth } from './middleware.js';

const COMMON = new Set(['password1234', '123456789012', 'qwertyuiopas', 'iloveyou1234', 'letmein12345', 'bitcoin12345', 'satoshi12345']);
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const password = z.string().min(12, 'Use at least 12 characters').max(128, 'Password is too long')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'That password is too common')
  .refine((p) => new Set(p).size >= 5, 'Use a more varied password');

const MAX_FAILS = 5, LOCK_MS = 15 * 60e3;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, emailVerified: !!u.email_verified });

async function issueVerification(user) {
  const t = newId(32);
  run('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?', user.id, 'verify');
  run('INSERT INTO email_tokens (token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)', sha256(t), user.id, 'verify', Date.now() + 24 * 3600e3);
  await sendMail(user.email, 'Verify your email', `Welcome to Sats in a Bottle, ${user.name}.\n\nConfirm your email (valid 24h):\n${config.appUrl}/verify?token=${t}`);
}

function startSession(req, res, userId) {
  const sid = newId(32), csrf = newId(24), now = Date.now();
  run('INSERT INTO sessions (id_hash,user_id,csrf,created_at,last_seen,expires_at,ip,ua) VALUES (?,?,?,?,?,?,?,?)',
    sha256(sid), userId, csrf, now, now, now + SESSION_MS, req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
  res.cookie(COOKIE, sid, cookieOpts());
  return csrf;
}

export const authRouter = Router();

authRouter.post('/auth/register', authLimiter, wrap(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1, 'Enter your name').max(80), email, password }).strict().parse(req.body);
  if (body.password.toLowerCase().includes(body.email.split('@')[0]) && body.email.split('@')[0].length > 3) throw new HttpError(400, 'Password must not contain your email name');
  const existing = get('SELECT id FROM users WHERE email = ?', body.email);
  if (existing) {
    // Same response either way: don't reveal which emails have accounts.
    await sendMail(body.email, 'Sign-in attempt', 'Someone tried to register with this email, but you already have an account. If it was you, just sign in or reset your password.');
  } else {
    const id = newId(12);
    run('INSERT INTO users (id,name,email,pw_hash,created_at) VALUES (?,?,?,?,?)', id, body.name, body.email, await hashPassword(body.password), Date.now());
    audit('auth.register', { userId: id, ip: req.ip });
    await issueVerification({ id, name: body.name, email: body.email });
  }
  res.status(202).json({ ok: true, message: 'Check your inbox to verify your email, then sign in.' });
}));

authRouter.post('/auth/verify', authLimiter, wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(100) }).strict().parse(req.body);
  const t = get('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?', sha256(token), 'verify');
  if (!t || t.expires_at < Date.now()) throw new HttpError(400, 'This link is invalid or has expired');
  tx(() => {
    run('UPDATE users SET email_verified = 1 WHERE id = ?', t.user_id);
    run('DELETE FROM email_tokens WHERE token_hash = ?', t.token_hash);
  });
  audit('auth.verify', { userId: t.user_id, ip: req.ip });
  res.json({ ok: true });
}));

authRouter.post('/auth/resend', requireAuth, authLimiter, wrap(async (req, res) => {
  if (!req.user.email_verified) await issueVerification(req.user);
  res.json({ ok: true });
}));

authRouter.post('/auth/login', authLimiter, wrap(async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(128) }).strict().parse(req.body);
  const u = get('SELECT * FROM users WHERE email = ?', body.email);
  const now = Date.now();
  if (u && u.locked_until > now) {
    await verifyPassword(body.password, DUMMY_HASH);
    throw new HttpError(429, 'Account temporarily locked after repeated failures. Try again in 15 minutes.');
  }
  const ok = await verifyPassword(body.password, u?.pw_hash || DUMMY_HASH);
  if (!u || !ok) {
    if (u) {
      const fails = u.failed_logins + 1;
      run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now + LOCK_MS : 0, u.id);
      audit('auth.login_failed', { userId: u.id, ip: req.ip, meta: { fails } });
    }
    throw new HttpError(401, 'Email or password is incorrect');
  }
  run('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?', u.id);
  const csrf = startSession(req, res, u.id); // fresh session id on every login (prevents fixation)
  audit('auth.login', { userId: u.id, ip: req.ip });
  res.json({ user: publicUser(u), csrfToken: csrf });
}));

authRouter.post('/auth/logout', wrap(async (req, res) => {
  if (req.session) run('DELETE FROM sessions WHERE id_hash = ?', req.session.id_hash);
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
  res.json({ ok: true });
}));

authRouter.post('/auth/change-password', requireAuth, authLimiter, wrap(async (req, res) => {
  const body = z.object({ current: z.string().max(128), next: password }).strict().parse(req.body);
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!(await verifyPassword(body.current, u.pw_hash))) throw new HttpError(401, 'Current password is incorrect');
  run('UPDATE users SET pw_hash = ? WHERE id = ?', await hashPassword(body.next), u.id);
  run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', u.id, req.session.id_hash); // kill all other sessions
  audit('auth.password_changed', { userId: u.id, ip: req.ip });
  res.json({ ok: true });
}));

authRouter.get('/user/profile', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), csrfToken: req.session.csrf });
});
