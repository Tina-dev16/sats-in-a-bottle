import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA secure_delete = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bottles (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_email TEXT NOT NULL,
  recipient_user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '',
  amount_sats INTEGER NOT NULL,
  unlock_type TEXT NOT NULL CHECK (unlock_type IN ('date','milestone')),
  unlock_at INTEGER,
  milestone_text TEXT,
  milestone_confirmed_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft','funded','sealed','ready','claiming','claimed','refunded','cancelled')),
  dek_wrapped BLOB NOT NULL,
  msg_enc BLOB,
  fund_address TEXT, fund_invoice TEXT, fund_ref TEXT, fund_expires_at INTEGER,
  fund_txid TEXT,
  created_at INTEGER NOT NULL,
  funded_at INTEGER, sealed_at INTEGER, ready_at INTEGER, claimed_at INTEGER,
  reminded_at INTEGER,
  payout_txid TEXT, payout_kind TEXT,
  shared_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bottles_sender ON bottles(sender_id);
CREATE INDEX IF NOT EXISTS idx_bottles_recipient ON bottles(recipient_email);
CREATE INDEX IF NOT EXISTS idx_bottles_due ON bottles(status, unlock_at);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  bottle_id TEXT NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo','voice')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  bottle_id TEXT NOT NULL REFERENCES bottles(id),
  type TEXT NOT NULL CHECK (type IN ('fund','claim','refund')),
  sats INTEGER NOT NULL,
  status TEXT NOT NULL,
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  bottle_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_email ON notifications(email);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, user_id TEXT, bottle_id TEXT, action TEXT NOT NULL, ip TEXT, meta TEXT,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
`);

/** Runs fn inside an IMMEDIATE transaction (serialises writers, rolls back on throw). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
