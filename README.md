# Sats in a Bottle

Send sats with a message, sealed in a digital bottle that opens when the time is right.
Design system: *Dayos* (brutalist editorial). Hero animation: a scroll-driven 3D glass bottle with a ₿ wrap (three.js).

```
Create → Message → Add Bitcoin → Set condition → Seal → Share → Wait → Unlock → Claim
```

## Run it

```bash
npm install
npm run dev          # API :3001 + web http://localhost:5173
npm test             # 4 integration suites (lifecycle, privacy, double-claim race, auth, CSRF, webhook)
npm run build && npm start   # production mode (see docs/PRODUCTION.md, refuses to boot unsafely)
```

Node ≥ 22.13 (uses built-in `node:sqlite`; no native modules).

> **Status: working product on a simulated Bitcoin network.** Everything except real money movement is
> production-grade. Read [docs/PRODUCTION.md](docs/PRODUCTION.md) before wiring real funds.

## Hosted demo for the team

`render.yaml` deploys a demo on Render (Render > New > Blueprint > pick this repo). It runs with `DEMO_MODE=true`:
production hardening stays on (HTTPS cookies, CSP, rate limits), and the seeded accounts, the simulate-payment
button and the dev inbox are available. Simulated Bitcoin only: the server refuses to start in demo mode on
mainnet or with a real payment provider. Demo sign-in: `alice@demo.test` (sender) and `bob@demo.test`
(recipient), password `demo-bottle-2026`. The free plan sleeps when idle and resets its data on redeploy.
Anyone with the URL can sign in as the demo users, so don't put anything real in it.

## Layout

| Path | What |
|---|---|
| `server/` | Express API, SQLite, crypto, scheduler. `routes-*.js` = endpoints, `bottles.js` = state machine + payouts |
| `web/` | React + Vite SPA. `lib/bottleScene.js` = the 3D scroll animation |
| `docs/SECURITY.md` | Threat model, controls, known gaps |
| `docs/PRODUCTION.md` | Go-live checklist, payment-provider contract |
| `docs/RECOMMENDATIONS.md` | Where this build deliberately differs from the original spec, and why |

## API

All under `/api`, JSON, cookie session + `X-CSRF-Token` header on writes.

| | |
|---|---|
| `POST /auth/register` `POST /auth/login` `POST /auth/logout` `POST /auth/verify` `POST /auth/resend` `POST /auth/change-password` | accounts |
| `GET /user/profile` | current user + CSRF token |
| `POST /bottles` · `GET /bottles?role=sent\|received\|all` · `GET /bottles/:id` · `PUT /bottles/:id` · `POST /bottles/:id/cancel` | create / list / read / edit |
| `POST /bottles/:id/attachments` · `GET\|DELETE /bottles/:id/attachments/:aid` | photo + voice note (encrypted at rest) |
| `POST /bottles/:id/fund` | address + Lightning invoice + QR |
| `POST /bottles/:id/seal` · `POST /bottles/:id/share` · `GET /bottles/:id/status` | seal, link/QR, polling |
| `POST /bottles/:id/unlock` · `POST /bottles/:id/claim` · `POST /bottles/:id/refund` | open, payout, reclaim |
| `GET /transactions` · `GET /activity` · `POST /activity/read` | history, notifications |
| `POST /webhooks/payments` | provider → us (HMAC-signed, idempotent) |

Dev-only (absent when `NODE_ENV=production`): `/dev/outbox`, `/dev/bottles/:id/simulate-payment`, `/dev/bottles/:id/fast-forward`, `/dev/demo-destination`, `/dev/audit`.

## Bottle states

`draft → funded → sealed → ready → claimed` (plus `claiming` in-flight, `refunded`, `cancelled`).
"Sealed" and "locked" from the brief are the same state.
