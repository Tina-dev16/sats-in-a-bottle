import { useCallback, useEffect, useRef, useState } from 'react';
import { splitDuration, STATUS } from '../lib/format.js';
import { useToast } from './Toast.jsx';

export const Spinner = () => <span className="spinner" aria-label="Loading" />;
export const Loading = () => <div className="center-screen"><Spinner /></div>;

export function StatusTag({ status }) {
  const s = STATUS[status] || { label: status };
  const cls = status === 'ready' ? 'yellow' : status === 'sealed' ? 'dark' : status === 'claimed' ? '' : 'gray';
  return <span className={`tag ${cls}`}>{s.label}</span>;
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    ref.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal stack" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row between"><h2 className="h-xl" style={{ fontSize: 40 }}>{title}</h2><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-dark btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); toast('Copied to clipboard'); setTimeout(() => setDone(false), 1500); }
      catch { toast('Copy failed', 'bad'); }
    }}>{done ? 'Copied' : label}</button>
  );
}

export function QrBox({ src, alt }) {
  return <div className="qr">{src ? <img src={src} alt={alt} /> : null}</div>;
}

/** Counts down to `at`, corrected for client/server clock skew via serverNow. Fires onZero once. */
export function Countdown({ at, serverNow, onZero, dark }) {
  const skew = useRef(serverNow ? serverNow - Date.now() : 0);
  const fired = useRef(false);
  const [left, setLeft] = useState(() => at - (Date.now() + skew.current));
  useEffect(() => { skew.current = serverNow ? serverNow - Date.now() : 0; fired.current = false; }, [at, serverNow]);
  useEffect(() => {
    const tick = () => {
      const l = at - (Date.now() + skew.current);
      setLeft(l);
      if (l <= 0 && !fired.current) { fired.current = true; onZero?.(); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [at, onZero]);
  const { d, h, m, s } = splitDuration(left);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <div className="countdown" role="timer" aria-label={`${d} days ${h} hours ${m} minutes ${s} seconds remaining`} data-dark={dark}>
      {[['days', d], ['hrs', pad(h)], ['min', pad(m)], ['sec', pad(s)]].map(([k, v]) => <div key={k}><b>{v}</b><span className="mono muted">{k}</span></div>)}
    </div>
  );
}

export function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const targets = el.classList.contains('reveal') ? [el] : [...el.querySelectorAll('.reveal')];
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return ref;
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}
