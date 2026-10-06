# Going to production

The app **will not boot** with `NODE_ENV=production` unless: `SIB_MASTER_KEY` is set; a real payment provider is configured (or `ALLOW_SIMULATED_PAYMENTS=true` on a non-mainnet staging box); and `PAYMENT_WEBHOOK_SECRET` is ≥ 32 chars.

## 1. Plug in real money movement (the one missing piece)

`server/payments.js` defines the contract. Implement a provider with:

```js
createFunding({ bottleId, sats, expiresAt }) -> { address, invoice, ref }   // unique address + LN invoice per bottle
payout({ idempotencyKey, kind: 'onchain'|'lightning', destination, sats }) -> { txid }
```

and have the provider call `POST /api/webhooks/payments` when a payment confirms:

```
x-sib-signature: sha256=HMAC_SHA256(PAYMENT_WEBHOOK_SECRET, rawBody)
{ "eventId": "<unique>", "bottleId": "<id from your invoice metadata>", "txid": "...", "sats": 210000 }
```

Recommended backends: **BTCPay Server** (Greenfield API: invoices + webhooks + pull-payments/payouts; open source, self-hosted, does on-chain + Lightning) or **LND** + bitcoind. Keep the hot wallet small, sweep to cold storage/multisig, and make payouts require provider-side limits. Require ≥ 1 confirmation (≥ 3 above ~$1k) before sending the webhook for on-chain payments. Handle fees explicitly (decide whether the recipient or the platform pays and show it in the claim modal).

## 2. Checklist

- [ ] Real provider implemented, tested on **signet/testnet** end to end, then mainnet with tiny caps
- [ ] `SIB_MASTER_KEY` in a KMS/secret manager; documented recovery + rotation procedure
- [ ] TLS everywhere (reverse proxy), `TRUST_PROXY` set to the hop count, HSTS preload only once you're sure
- [ ] SMTP provider with SPF/DKIM/DMARC; test verification + notification mails
- [ ] Postgres (or Litestream-replicated SQLite) + tested restore; encrypted backups (message ciphertext is useless without the master key, back that up separately)
- [ ] 2FA/passkeys; alerting on `bottle.stuck_claiming`, audit-chain breaks, failed-login spikes, webhook signature failures
- [ ] Redis-backed rate limiter if running multiple instances
- [ ] Reconciliation job: provider balance == Σ(funded, unclaimed bottles); page a human on mismatch
- [ ] Legal review: holding/transmitting customers' bitcoin can make you a money services business / VASP (FinCEN MSB, EU MiCA/AML, etc.), KYC/sanctions screening, terms of service, refund policy, privacy policy. **Talk to a lawyer before mainnet.**
- [ ] Independent security review / pen-test; bug-bounty contact in `/.well-known/security.txt`

## 3. Deploy

```bash
docker build -t sats-in-a-bottle .
docker run -p 3001:3001 -v sib-data:/data --env-file .env sats-in-a-bottle
```
Put it behind a TLS-terminating proxy (Caddy/nginx/Cloudflare). The container runs as a non-root user; `/data` holds the DB and encrypted attachments.
