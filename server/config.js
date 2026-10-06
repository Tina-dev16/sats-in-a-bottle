import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
// Hosted demo for a team: production hardening stays on, but seeded accounts, the simulated-payment
// button and the dev inbox are available. Simulated payments only, never mainnet (enforced below).
export const demo = env.DEMO_MODE === 'true';
export const devTools = !isProd || demo;

const DATA_DIR = path.resolve(env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(path.join(DATA_DIR, 'blobs'), { recursive: true, mode: 0o700 });

function loadMasterKey() {
  if (env.SIB_MASTER_KEY) {
    if (/^[0-9a-f]{64}$/i.test(env.SIB_MASTER_KEY)) return Buffer.from(env.SIB_MASTER_KEY, 'hex');
    // Demo hosts (e.g. Render) generate a random string, not hex: hash it. Never accepted for real deployments.
    if (demo && env.SIB_MASTER_KEY.length >= 24) return crypto.createHash('sha256').update(env.SIB_MASTER_KEY).digest();
    throw new Error('SIB_MASTER_KEY must be 64 hex chars (32 bytes)');
  }
  if (isProd) throw new Error('SIB_MASTER_KEY is required in production (use a KMS/secret manager)');
  const f = path.join(DATA_DIR, '.dev-master-key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}

const master = loadMasterKey();
const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), `sib:${label}`, 32));

export const config = {
  isProd,
  port: Number(env.PORT || 3001),
  dataDir: DATA_DIR,
  dbFile: env.DB_FILE || path.join(DATA_DIR, isTest ? `test-${process.pid}.db` : 'sib.db'),
  webDist: path.join(root, 'web', 'dist'),
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : false,
  keys: { kek: derive('kek'), pepper: derive('pepper'), audit: derive('audit') },
  network: env.BTC_NETWORK || 'testnet', // mainnet | testnet | signet | regtest
  paymentProvider: env.PAYMENT_PROVIDER || 'mock',
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET || '',
  limits: {
    minSats: Number(env.MIN_SATS || 1000),
    maxSats: Number(env.MAX_SATS || 5_000_000), // launch cap: ~0.05 BTC per bottle. Raise only after audit.
    minLockSeconds: Number(env.MIN_LOCK_SECONDS || (devTools ? 60 : 3600)),
    maxLockDays: 3650,
    messageChars: 5000,
    photoBytes: 4 * 1024 * 1024,
    audioBytes: 6 * 1024 * 1024,
    claimWindowDays: Number(env.CLAIM_WINDOW_DAYS || 365),
    fundingTtlMinutes: 60,
  },
  smtp: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'Sats in a Bottle <no-reply@localhost>',
};

if (demo && (config.network === 'mainnet' || config.paymentProvider !== 'mock')) {
  throw new Error('DEMO_MODE only runs with simulated payments on a test network');
}
if (isProd && !demo && config.paymentProvider === 'mock' && env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
  throw new Error('Refusing to start in production with the simulated payment provider. Wire a real provider (see docs/PRODUCTION.md) or set ALLOW_SIMULATED_PAYMENTS=true for a staging demo.');
}
if (isProd && config.paymentProvider !== 'mock' && config.webhookSecret.length < 32) {
  throw new Error('PAYMENT_WEBHOOK_SECRET (>=32 chars) is required in production');
}
if (isProd && config.network === 'mainnet' && config.paymentProvider === 'mock') {
  throw new Error('Simulated payments can never run on mainnet');
}
