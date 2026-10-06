import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { config, devTools } from './config.js';
import { get, all, run } from './db.js';
import { safeEqual } from './crypto.js';
import { audit, verifyAuditChain } from './audit.js';
import { HttpError, wrap, requireAuth, requireVerified } from './middleware.js';
import { confirmFunding, loadFor } from './bottles.js';
import { tick } from './scheduler.js';
import { provider } from './payments.js';

export const webhookRouter = Router();
export const devRouter = Router();

webhookRouter.get('/health', (_req, res) => res.json({
  ok: true, network: config.network, simulated: config.paymentProvider === 'mock',
  limits: { minSats: config.limits.minSats, maxSats: config.limits.maxSats, minLockSeconds: config.limits.minLockSeconds, messageChars: config.limits.messageChars },
  dev: devTools,
}));

/**
 * Provider -> us. Signed with HMAC-SHA256 over the raw body: header "x-sib-signature: sha256=<hex>".
 * Replays are ignored via event-id dedupe; amounts are re-checked against the bottle.
 */
webhookRouter.post('/webhooks/payments', express.raw({ type: 'application/json', limit: '16kb' }), wrap(async (req, res) => {
  if (!config.webhookSecret) throw new HttpError(404, 'Not found');
  const sig = String(req.headers['x-sib-signature'] || '').replace(/^sha256=/, '');
  const want = crypto.createHmac('sha256', config.webhookSecret).update(req.body).digest('hex');
  if (!safeEqual(sig, want)) throw new HttpError(401, 'Bad signature');
  const e = z.object({ eventId: z.string().max(100), bottleId: z.string().max(64), txid: z.string().max(100), sats: z.number().int() }).parse(JSON.parse(req.body.toString('utf8')));
  if (get('SELECT 1 x FROM webhook_events WHERE event_id=?', e.eventId)) return res.json({ ok: true, duplicate: true });
  run('INSERT INTO webhook_events (event_id, received_at) VALUES (?,?)', e.eventId, Date.now());
  const r = await confirmFunding(e.bottleId, e);
  audit('webhook.payment', { bottleId: e.bottleId, meta: { eventId: e.eventId, applied: r.applied } });
  res.json({ ok: true, ...r });
}));

if (devTools) {
  // ---- DEV / DEMO ONLY: these routes do not exist in production builds -------------------------
  devRouter.get('/dev/outbox', wrap(async (req, res) => {
    const email = String(req.query.email || '').toLowerCase();
    res.json({ emails: email ? all('SELECT * FROM outbox WHERE to_email=? ORDER BY id DESC LIMIT 5', email) : [] });
  }));
  devRouter.post('/dev/bottles/:id/simulate-payment', requireAuth, wrap(async (req, res) => {
    if (config.paymentProvider !== 'mock') throw new HttpError(404, 'Not found');
    const { b } = loadFor(req.params.id, req.user);
    const r = await confirmFunding(b.id, { txid: crypto.randomBytes(32).toString('hex'), sats: b.amount_sats });
    res.json(r);
  }));
  devRouter.post('/dev/bottles/:id/fast-forward', requireAuth, requireVerified, wrap(async (req, res) => {
    const { b } = loadFor(req.params.id, req.user);
    run("UPDATE bottles SET unlock_at = ? WHERE id=? AND status='sealed' AND unlock_type='date'", Date.now() - 1, b.id);
    await tick();
    res.json({ ok: true });
  }));
  devRouter.get('/dev/demo-destination', requireAuth, wrap(async (req, res) => {
    const sats = Math.min(Math.max(parseInt(req.query.sats, 10) || 1000, 1), 1e9);
    const f = await provider.createFunding({ sats });
    res.json({ address: f.address, invoice: f.invoice });
  }));
  devRouter.get('/dev/audit', (_req, res) => res.json(verifyAuditChain()));
}
