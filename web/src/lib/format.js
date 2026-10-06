export const fmtSats = (n) => Number(n).toLocaleString('en-US');
export const fmtBtc = (sats) => (sats / 1e8).toFixed(8);
export const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'long' });

export const STATUS = {
  draft: { label: 'Draft', hint: 'Waiting for funds' },
  funded: { label: 'Funded', hint: 'Ready to seal' },
  sealed: { label: 'Sealed', hint: 'Locked until the condition is met' },
  ready: { label: 'Ready to open', hint: 'Unlocked' },
  claiming: { label: 'Claiming', hint: 'Payout in progress' },
  claimed: { label: 'Claimed', hint: 'Sats delivered' },
  refunded: { label: 'Refunded', hint: 'Returned to sender' },
  cancelled: { label: 'Cancelled', hint: '' },
};
export function splitDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
export function humanLeft(ms) {
  const { d, h, m, s } = splitDuration(ms);
  if (d >= 2) return `${d} days`;
  if (d === 1) return `1 day ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m ${s}s`;
  return `${s}s`;
}
