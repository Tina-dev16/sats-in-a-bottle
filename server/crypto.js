import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const N = 32768, R = 8, P = 1;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Password hashing: HMAC pepper (derived from the master key, never stored in the DB) then scrypt.
const pre = (pw) => crypto.createHmac('sha256', config.keys.pepper).update(pw).digest('hex');
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(pre(pw), salt, 64, { N, r: R, p: P, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const dk = await scrypt(pre(pw), Buffer.from(salt, 'base64'), 64, { N: +n, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
  const want = Buffer.from(hash, 'base64');
  return dk.length === want.length && crypto.timingSafeEqual(dk, want);
}
// Used to equalise timing when an account does not exist.
export const DUMMY_HASH = await hashPassword('dummy-password-for-timing-equalisation');

// AES-256-GCM: output = iv(12) | tag(16) | ciphertext. AAD binds ciphertext to its purpose + bottle.
export function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function open(key, blob, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

// Envelope encryption: each bottle has its own random data key, wrapped by the master-derived KEK.
export const newDek = (bottleId) => {
  const dek = crypto.randomBytes(32);
  return { dek, wrapped: seal(config.keys.kek, dek, `dek:${bottleId}`) };
};
export const unwrapDek = (bottleId, wrapped) => open(config.keys.kek, wrapped, `dek:${bottleId}`);
