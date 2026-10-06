import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config, isProd, isTest } from './config.js';
import { sha256, safeEqual } from './crypto.js';
import { get, run } from './db.js';

export const COOKIE = isProd ? '__Host-sib' : 'sib_sid';
const IDLE_MS = 24 * 3600e3;
export const SESSION_MS = 7 * 24 * 3600e3;

export const cookieOpts = () => ({ httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: SESSION_MS });

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function attachSession(req, _res, next) {
  const sid = req.cookies?.[COOKIE];
  if (typeof sid === 'string' && sid.length >= 32 && sid.length < 128) {
    const now = Date.now();
    const s = get('SELECT * FROM sessions WHERE id_hash = ?', sha256(sid));
    if (s && s.expires_at > now && now - s.last_seen < IDLE_MS) {
      const u = get('SELECT id,name,email,email_verified FROM users WHERE id = ?', s.user_id);
      if (u) {
        if (now - s.last_seen > 60e3) run('UPDATE sessions SET last_seen = ? WHERE id_hash = ?', now, s.id_hash);
        req.session = s; req.user = u;
      }
    } else if (s) run('DELETE FROM sessions WHERE id_hash = ?', s.id_hash);
  }
  next();
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in')));
export const requireVerified = (req, _res, next) =>
  req.user?.email_verified ? next() : next(new HttpError(403, 'Verify your email address first', { code: 'EMAIL_UNVERIFIED' }));

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** CSRF defence in depth: SameSite=Strict cookie + Origin check + per-session token header. */
export function csrf(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.path.startsWith('/webhooks/')) return next(); // authenticated by HMAC signature instead
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { return next(new HttpError(403, 'Bad origin')); }
    const ok = host === req.headers.host || config.allowedOrigins.includes(origin) || origin === config.appUrl;
    if (!ok) return next(new HttpError(403, 'Bad origin'));
  } else if (isProd) return next(new HttpError(403, 'Origin required'));
  if (req.session && !safeEqual(req.headers['x-csrf-token'] || '', req.session.csrf)) return next(new HttpError(403, 'Bad CSRF token'));
  next();
}

const mk = (windowMs, limit, message, keyFn) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => isTest,
  message: { error: message }, ...(keyFn ? { keyGenerator: keyFn } : {}),
});
export const globalLimiter = mk(60e3, 300, 'Too many requests, slow down.');
export const authLimiter = mk(15 * 60e3, 20, 'Too many attempts. Try again in a few minutes.');
export const moneyLimiter = mk(3600e3, 30, 'Too many sensitive actions. Try again later.', (req) => (req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip)));
export const uploadLimiter = mk(3600e3, 60, 'Too many uploads. Try again later.', (req) => (req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip)));

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.name === 'ZodError') {
    return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input', field: err.issues[0]?.path?.join('.') });
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error('[error]', req.method, req.path, err);
  res.status(500).json({ error: 'Something went wrong' }); // never leak internals
}
