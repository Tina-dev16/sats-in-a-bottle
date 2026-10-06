# Security

## What we defend against, and how

| Threat | Control | Where |
|---|---|---|
| Claiming funds before the condition | Unlock is decided **server-side** from the server clock; the claim endpoint requires status `ready`. Milestone bottles can only be released by the sender. The browser countdown is cosmetic. | `routes-bottles.js` `/unlock`, `/claim` |
| Double payout (double-click, replay, race) | `UPDATE … WHERE status='ready'` → `claiming` is the lock; provider call carries an idempotency key; failed payouts roll back. Tested with 3 concurrent claims. | `bottles.js` `payoutBottle` |
| Reading someone else's bottle | Every read checks sender/recipient identity; unauthorised and non-existent both return an identical 404. Recipient must have a **verified** email matching the bottle. | `bottles.js` `loadFor` |
| Message leaks (DB dump, backup, SQL injection) | Per-bottle AES-256-GCM data key, wrapped by a KEK derived (HKDF) from `SIB_MASTER_KEY`; AAD binds ciphertext to bottle id. Attachments encrypted the same way. Locked messages are never serialised to the recipient. | `crypto.js`, `files.js` |
| Wrong/typo'd payout destination | Bech32/Bech32m checksum + network + witness-program validation; BOLT11 checksum + exact-amount check. Native SegWit/Taproot only. | `bech32.js` |
| Password attacks | scrypt (N=2¹⁵) with a server-side pepper, 12-char minimum, per-account lockout (5 fails → 15 min), per-IP rate limits, constant-time dummy hash for unknown users, uniform error messages, no account enumeration on register. | `routes-auth.js`, `middleware.js` |
| Session theft / fixation | 256-bit random session ids, only the SHA-256 stored; `HttpOnly`, `SameSite=Strict`, `Secure` + `__Host-` prefix in prod; new session per login; idle (24h) + absolute (7d) expiry; password change revokes other sessions. | `middleware.js` |
| CSRF | SameSite=Strict + Origin allow-list + per-session token header. | `middleware.js` `csrf` |
| XSS / clickjacking | React escaping, strict CSP (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`), `nosniff`, no-referrer, HSTS in prod. User content is never rendered as HTML. | `app.js` |
| Malicious uploads | Type from **magic bytes** (not client MIME), size caps, photos re-encoded client-side (strips EXIF/GPS), served with `nosniff` + `CSP: sandbox` from an authenticated endpoint. | `files.js` |
| Mass assignment / injection | Zod `.strict()` schemas on every body; parameterised SQL only. | all routes |
| Forged payment notifications | HMAC-SHA256 over the raw body, timing-safe compare, event-id dedupe, amount re-checked against the bottle. | `routes-misc.js` |
| Tampered audit trail | Hash-chained HMAC log (`/dev/audit` verifies; wire into an alert in prod). | `audit.js` |
| Abuse / DoS | Global + auth + money + upload rate limits, 32 KB JSON cap, upload caps, launch cap per bottle. | `middleware.js` |
| Secrets in prod | Server **refuses to start** without `SIB_MASTER_KEY`, and refuses simulated payments in production/mainnet. | `config.js` |

## Known gaps (be honest with yourself and users)

1. **Custody.** In this design the platform holds the keys until claim, so "locked" is enforced by *our software*, not by Bitcoin consensus. A compromised server or insider could move funds. See RECOMMENDATIONS §1 for the non-custodial path.
2. **No real payment provider is bundled.** The `mock` provider simulates a network. See PRODUCTION.md.
3. **No 2FA / passkeys yet.** Strongly recommended before raising `MAX_SATS` (TOTP or WebAuthn on login + claim).
4. **SQLite, single node.** Fine for launch; move to Postgres + managed backups before scale. Rate-limit counters are in-memory (use Redis when you run >1 instance).
5. **Email is the identity of the recipient.** If their mailbox is compromised, so is the bottle. Mitigation: 2FA + optional "claim PIN" the sender tells them out of band.
6. **Master key rotation** is not automated (data keys are wrapped, so rotation = re-wrap the `dek_wrapped` column; script it).
7. **No external audit / pen-test has been done.** Do one before real money.
