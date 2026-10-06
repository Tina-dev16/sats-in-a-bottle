import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { decode } from './bech32.js';
import { parseInvoice } from './bech32.js';
import { config } from './config.js';
import { HttpError } from './middleware.js';

const ADDRESS = /^[a-z0-9._+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,24}$/i;
export const isLightningAddress = (s) => ADDRESS.test(s) && s.length <= 254;

/** Accepts name@domain or an lnurl1... string; returns the https URL to query, or null. */
export function lnurlEndpoint(input) {
  const s = String(input).trim().replace(/^lightning:/i, '');
  if (isLightningAddress(s)) {
    const [name, domain] = s.split('@');
    return `https://${domain.toLowerCase()}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  }
  const d = s.toLowerCase().startsWith('lnurl1') ? decode(s, 2048) : null;
  if (!d || d.hrp !== 'lnurl') return null;
  let bits = 0, acc = 0; const out = [];
  for (const v of d.data) { acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; } }
  try { return Buffer.from(out).toString('utf8'); } catch { return null; }
}

function privateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
// Validates every address at connect time, so DNS rebinding can't swap in an internal IP.
function safeLookup(host, opts, cb) {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => privateIp(a.address));
    if (bad || !addrs.length) return cb(new Error('blocked address'));
    if (opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('bad url')); }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return reject(new Error('https only'));
    const req = https.get(u, { lookup: safeLookup, timeout: 6000, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`status ${res.statusCode}`)); } // redirects are not followed
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 16384) req.destroy(new Error('too large')); else chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Turns a Lightning address / LNURL-pay into a BOLT11 invoice for exactly `sats`. */
export async function invoiceFromLnurl(input, sats) {
  const fail = (m) => new HttpError(400, m);
  const url = lnurlEndpoint(input);
  if (!url) throw fail('That is not a valid Lightning address or LNURL.');
  const msat = BigInt(sats) * 1000n;
  let meta, res;
  try {
    meta = await getJson(url);
    if (meta.tag !== 'payRequest' || typeof meta.callback !== 'string') throw new Error('not payRequest');
    if (msat < BigInt(meta.minSendable) || msat > BigInt(meta.maxSendable)) throw fail(`That wallet does not accept exactly ${sats.toLocaleString('en-US')} sats.`);
    const cb = new URL(meta.callback);
    cb.searchParams.set('amount', msat.toString());
    res = await getJson(cb.toString());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw fail('Could not reach that Lightning address. Check it, or paste an invoice instead.');
  }
  const inv = typeof res.pr === 'string' ? parseInvoice(res.pr, config.network) : null;
  if (!inv || inv.msat !== msat) throw fail('That wallet returned an invoice for the wrong amount, so nothing was sent.');
  return res.pr;
}
