import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.js';
import { encode, convertBits, networkHrp } from './bech32.js';

/**
 * Payment provider interface. A real provider (BTCPay Server / LND / bitcoind) must implement:
 *   createFunding({ bottleId, sats, expiresAt }) -> { address, invoice, ref }
 *   payout({ idempotencyKey, kind: 'onchain'|'lightning', destination, sats }) -> { txid }
 * and confirm payments by calling POST /api/webhooks/payments (HMAC-signed). See docs/PRODUCTION.md.
 *
 * The built-in "mock" provider only simulates a network: addresses/invoices are well-formed
 * (valid checksums) but nobody controls the keys. It is refused in production unless explicitly allowed.
 */
const mock = {
  name: 'mock',
  simulated: true,
  async createFunding({ sats }) {
    const hrp = networkHrp(config.network);
    const prog = convertBits([...crypto.randomBytes(20)], 8, 5, true);
    const address = encode(hrp.addr, [0, ...prog]);
    const words = convertBits([...crypto.randomBytes(130)], 8, 5, true);
    const invoice = encode(`ln${hrp.ln}${sats * 10}n`, words);
    return { address, invoice, ref: crypto.randomUUID() };
  },
  async payout({ idempotencyKey }) {
    return { txid: crypto.createHash('sha256').update(`mock:${idempotencyKey}`).digest('hex') };
  },
};

const providers = { mock };
export const provider = providers[config.paymentProvider];
if (!provider) throw new Error(`Unknown PAYMENT_PROVIDER "${config.paymentProvider}". Implemented: ${Object.keys(providers).join(', ')}`);

export const toBtc = (sats) => (sats / 1e8).toFixed(8);
export async function qr(text) {
  return QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}
export const bip21 = (address, sats) => `bitcoin:${address}?amount=${toBtc(sats)}`;
