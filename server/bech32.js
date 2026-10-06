// Bech32 / Bech32m (BIP-173/350) + Bitcoin address and BOLT11 invoice validation.
// Validating checksums client-side-of-the-payout prevents "typo = lost funds".
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const polymod = (values) => {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
};
const hrpExpand = (hrp) => [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
const BECH32 = 1, BECH32M = 0x2bc830a3;

export function decode(str, limit = 90) {
  if (str.length < 8 || str.length > limit) return null;
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
  str = str.toLowerCase();
  const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) return null;
  const hrp = str.slice(0, pos);
  const data = [];
  for (const c of str.slice(pos + 1)) {
    const i = CHARSET.indexOf(c);
    if (i < 0) return null;
    data.push(i);
  }
  const m = polymod([...hrpExpand(hrp), ...data]);
  const spec = m === BECH32 ? 'bech32' : m === BECH32M ? 'bech32m' : null;
  return spec ? { hrp, data: data.slice(0, -6), spec } : null;
}
export function encode(hrp, data, spec = 'bech32') {
  const c = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ (spec === 'bech32m' ? BECH32M : BECH32);
  const chk = Array.from({ length: 6 }, (_, i) => (c >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...chk].map((d) => CHARSET[d]).join('')}`;
}
export function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [], max = (1 << to) - 1, maxAcc = (1 << (from + to - 1)) - 1;
  for (const v of data) {
    if (v >> from) return null;
    acc = ((acc << from) | v) & maxAcc; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & max); }
  else if (bits >= from || ((acc << (to - bits)) & max)) return null;
  return out;
}

const NET = {
  mainnet: { addr: 'bc', ln: 'bc' },
  testnet: { addr: 'tb', ln: 'tb' },
  signet: { addr: 'tb', ln: 'tbs' },
  regtest: { addr: 'bcrt', ln: 'bcrt' },
};
export const networkHrp = (network) => NET[network];

/** Validates a native SegWit/Taproot address for the configured network. */
export function validateAddress(addr, network) {
  const d = decode(String(addr).trim(), 90);
  if (!d || d.hrp !== NET[network].addr || !d.data.length) return false;
  const v = d.data[0];
  if (v > 16) return false;
  const prog = convertBits(d.data.slice(1), 5, 8, false);
  if (!prog || prog.length < 2 || prog.length > 40) return false;
  if (v === 0) return d.spec === 'bech32' && (prog.length === 20 || prog.length === 32);
  return d.spec === 'bech32m' && (v !== 1 || prog.length === 32);
}

/** Validates a BOLT11 invoice checksum + network and returns its amount in msat (or null). */
export function parseInvoice(inv, network) {
  const d = decode(String(inv).trim(), 2048);
  if (!d) return null;
  const m = /^ln(bcrt|bc|tbs|tb)(\d*)([munp]?)$/.exec(d.hrp);
  if (!m || m[1] !== NET[network].ln) return null;
  if (!m[2]) return { msat: null };
  const v = BigInt(m[2]);
  const mult = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n };
  if (m[3] === 'p') return v % 10n ? null : { msat: v / 10n };
  return { msat: v * mult[m[3]] };
}
