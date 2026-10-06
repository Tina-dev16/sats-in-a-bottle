import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, get, post, put } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtBtc, fmtDate, fmtDay, fmtSats } from '../lib/format.js';
import BottleCanvas from '../components/BottleCanvas.jsx';
import { PhotoPicker, VoiceRecorder, uploadMedia } from '../components/Media.jsx';
import { CopyButton, Countdown, Loading, Modal, QrBox, Spinner, StatusTag, useAsync } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';

const STAGE = { draft: 0.3, funded: 0.62, sealed: 1, ready: 1, claiming: 1, claimed: 1, refunded: 0.62, cancelled: 0.1 };
const FLOW = ['Create', 'Fund', 'Seal', 'Share', 'Wait', 'Unlock', 'Claim'];
const flowIndex = (s) => ({ draft: 1, funded: 2, sealed: 4, ready: 5, claiming: 6, claimed: 7, refunded: 7, cancelled: 7 }[s] ?? 0);

export default function BottleView() {
  const { id } = useParams();
  const [b, setB] = useState(null);
  const [missing, setMissing] = useState(false);
  const prev = useRef(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await get(`/bottles/${id}`);
      if (prev.current && prev.current !== r.bottle.status) {
        const msg = { funded: 'Payment confirmed', ready: 'The bottle is ready to open', claimed: 'Sats claimed' }[r.bottle.status];
        if (msg) toast(msg);
      }
      prev.current = r.bottle.status; setB(r.bottle);
    } catch (e) { if (e instanceof ApiError && e.status === 404) setMissing(true); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { // gentle polling while something is pending
    if (!b) return;
    const ms = b.status === 'draft' ? 3000 : ['sealed', 'ready', 'claiming'].includes(b.status) ? 15000 : 0;
    if (!ms) return;
    const t = setInterval(load, ms); return () => clearInterval(t);
  }, [b?.status, load]); // eslint-disable-line

  if (missing) return <div className="center-screen"><div className="card stack" style={{ padding: 40 }}><h1 className="display">Not found</h1><p className="muted">Not found, or not addressed to this account.</p><Link to="/home" className="btn btn-dark">Back home</Link></div></div>;
  if (!b) return <Loading />;
  const sender = b.role === 'sender';
  const revealed = ['ready', 'claiming', 'claimed'].includes(b.status);
  return (
    <div className="stack">
      <div className="page-head stack-sm">
        <Link to="/bottles" className="mono muted">← BOTTLES</Link>
        <div className="row wrap-r"><StatusTag status={b.status} /><span className="mono muted">{sender ? `TO ${b.recipientEmail.toUpperCase()}` : `FROM ${b.senderName.toUpperCase()}`}</span></div>
        <h1 className="display">{b.title || (sender ? 'Your bottle' : `A bottle from ${b.senderName}`)}</h1>
      </div>
      {sender && b.status !== 'cancelled' && (
        <ol className="stepper" style={{ padding: 0, margin: 0 }} aria-label="Progress">
          {FLOW.map((s, i) => <li key={s} className={`crumb ${i < flowIndex(b.status) ? 'done' : ''} ${i === flowIndex(b.status) ? 'now' : ''}`}><i>{String(i + 1).padStart(2, '0')}</i>{s}</li>)}
        </ol>
      )}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Hero b={b} revealed={revealed} />
        <div className="stack">
          {sender ? <SenderPanels b={b} reload={load} /> : <RecipientPanels b={b} reload={load} />}
        </div>
      </div>
    </div>
  );
}

function Hero({ b, revealed }) {
  const [open, setOpen] = useState(0);
  useEffect(() => { if (!revealed) return setOpen(0); const t = setTimeout(() => setOpen(1), 700); return () => clearTimeout(t); }, [revealed]);
  return (
    <div className="hero-bottle bv-hero">
      <BottleCanvas zoom={0.88} progress={STAGE[b.status] ?? 1} open={open} label={revealed ? 'The bottle has opened' : `A ${b.status} bottle`} />
      <div style={{ position: 'absolute', left: 20, bottom: 20 }} className="tag dark">{fmtSats(b.amountSats)} sats</div>
    </div>
  );
}

function Amount({ b, dark }) {
  return (
    <div className={`card ${dark ? 'ink' : ''}`}>
      <span className={`mono ${dark ? 'faint' : 'muted'}`}>{['sealed', 'ready'].includes(b.status) ? 'AMOUNT LOCKED' : 'AMOUNT'}</span>
      <div className="amount-big num" style={{ marginTop: 8 }}>{fmtSats(b.amountSats)} <span style={{ fontSize: '.4em' }}>SATS</span></div>
      <span className={`mono ${dark ? 'faint' : 'muted'}`}>{fmtBtc(b.amountSats)} BTC</span>
    </div>
  );
}

function UnlockRule({ b }) {
  return b.unlock.type === 'date'
    ? <div><span className="mono muted">OPENS</span><div style={{ fontSize: 20 }}>{fmtDay(b.unlock.at)} · {new Date(b.unlock.at).toLocaleTimeString(undefined, { timeStyle: 'short' })}</div></div>
    : <div><span className="mono muted">OPENS WHEN</span><div style={{ fontSize: 20 }}>{b.unlock.milestone}</div></div>;
}

/* ============================== SENDER ============================== */
function SenderPanels({ b, reload }) {
  const [edit, setEdit] = useState(false);
  return (<>
    {b.status === 'draft' && <FundPanel b={b} reload={reload} />}
    {b.status === 'funded' && <SealPanel b={b} reload={reload} onEdit={() => setEdit(true)} />}
    {b.status === 'sealed' && <><Locked b={b} reload={reload} sender /><SharePanel b={b} /></>}
    {b.status === 'ready' && <ReadySender b={b} reload={reload} />}
    {['claimed', 'refunded'].includes(b.status) && <Done b={b} />}
    {b.status === 'cancelled' && <div className="card"><h2 className="h2">Cancelled</h2><p className="muted">This draft was cancelled.</p></div>}
    {['draft', 'funded'].includes(b.status) && <div className="row wrap-r"><button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>Edit message</button>{b.status === 'draft' && <CancelDraft b={b} reload={reload} />}</div>}
    {edit && <EditModal b={b} onClose={() => setEdit(false)} reload={reload} />}
  </>);
}

function FundPanel({ b, reload }) {
  const { config } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [method, setMethod] = useState('lightning');
  const { error, run } = useAsync();
  const [now, setNow] = useState(Date.now());
  const fetchFunding = useCallback(() => run(async () => setF(await post(`/bottles/${b.id}/fund`))), [b.id, run]);
  useEffect(() => { fetchFunding(); }, [fetchFunding]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  async function payWebln() {
    try { await window.webln.enable(); await window.webln.sendPayment(f.lightning.invoice); toast('Payment sent, waiting for confirmation'); }
    catch { toast('The wallet did not complete the payment', 'bad'); }
  }
  const left = f ? Math.max(0, Math.floor((f.expiresAt - now) / 1000)) : 0;
  const expired = f && left === 0;
  return (
    <div className="card stack">
      <div className="row between wrap-r"><h2 className="h2">Fund the bottle</h2>{f && !expired && <span className="tag yellow">expires {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}</div>
      <div className="card mist sm row between wrap-r"><div><div className="amount-big num" style={{ fontSize: 56 }}>{fmtSats(b.amountSats)}</div><span className="mono muted">SATS</span></div><div style={{ textAlign: 'right' }}><div className="h3 num">{fmtBtc(b.amountSats)}</div><span className="mono muted">BTC</span></div></div>
      {f?.simulated && <div className="callout warn">Demo network. Do not send real bitcoin.</div>}
      {error && <p className="err">{error.message}</p>}
      {!f && !error && <Loading />}
      {f && <>
        <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
          <button role="tab" aria-selected={method === 'lightning'} onClick={() => setMethod('lightning')}>Lightning</button>
          <button role="tab" aria-selected={method === 'onchain'} onClick={() => setMethod('onchain')}>On-chain</button>
        </div>
        {expired ? <div className="stack-sm"><p className="muted">This payment request expired.</p><button className="btn btn-dark" onClick={fetchFunding}>Get a fresh one</button></div> : (
          <div className="grid g2" style={{ alignItems: 'center' }}>
            <QrBox src={method === 'lightning' ? f.lightning?.qr : f.onchain?.qr} alt={`${method} payment QR code`} />
            <div className="stack-sm">
              <span className="mono muted">{method === 'lightning' ? 'LIGHTNING INVOICE' : 'BITCOIN ADDRESS'}</span>
              <div className="copybox"><code>{method === 'lightning' ? f.lightning?.invoice : f.onchain?.address}</code></div>
              <div className="row wrap-r"><CopyButton text={method === 'lightning' ? f.lightning?.invoice : f.onchain?.address} />{method === 'onchain' && <CopyButton text={f.onchain?.uri} label="Copy BIP21 link" />}</div>
              {method === 'lightning' && <div className="row wrap-r"><a className="btn btn-light btn-sm" href={`lightning:${f.lightning?.invoice}`}>Open in my wallet</a>{window.webln && <button className="btn btn-light btn-sm" onClick={payWebln}>Pay with browser wallet</button>}</div>}
              <p className="help">{method === 'lightning' ? 'Scan, paste or open in your wallet.' : 'Send the exact amount.'}</p>
            </div>
          </div>
        )}
        <div className="row"><Spinner /><span className="muted body-sm">Waiting for payment. This page updates on its own.</span></div>
        {config?.dev && f.simulated && <button className="btn btn-mint btn-sm" onClick={async () => { await post(`/dev/bottles/${b.id}/simulate-payment`); toast('Simulated payment sent'); reload(); }}>Dev: simulate payment</button>}
      </>}
    </div>
  );
}

function SealPanel({ b, reload, onEdit }) {
  const [ack, setAck] = useState(false);
  const { busy, error, run } = useAsync();
  const [refund, setRefund] = useState(false);
  return (<>
    <div className="card stack">
      <h2 className="h2">Seal the bottle</h2>
      
      <div className="letter" style={{ fontSize: 16, padding: 20, maxHeight: 200, overflow: 'auto' }}>{b.message || <i className="muted">(no text, media only)</i>}</div>
      <div className="row wrap-r">{b.attachments?.map((a) => <span key={a.id} className="tag">{a.kind === 'voice' ? 'Voice note' : 'Photo'}</span>)}</div>
      <hr className="divider" />
      <div className="grid g2"><div><span className="mono muted">AMOUNT</span><div style={{ fontSize: 20 }}>{fmtSats(b.amountSats)} sats</div></div><UnlockRule b={b} /></div>
      <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I understand sealing is final.</span></label>
      {error && <p className="err" role="alert">{error.message}</p>}
      <button className="btn btn-dark btn-block" disabled={!ack || busy} onClick={() => run(async () => { await post(`/bottles/${b.id}/seal`); await reload(); })}>{busy ? <Spinner /> : 'Seal bottle'}</button>
      <button className="linkbtn body-sm muted" onClick={() => setRefund(true)}>Get the sats back</button>
    </div>
    {refund && <PayoutModal b={b} mode="refund" onClose={() => setRefund(false)} reload={reload} />}
  </>);
}

function Locked({ b, reload, sender }) {
  const { config } = useAuth();
  const { busy, error, run } = useAsync();
  const [confirm, setConfirm] = useState(false);
  const timer = useRef();
  const unlock = useCallback(async () => {
    try { await post(`/bottles/${b.id}/unlock`); await reload(); }
    catch (e) { if (e.status === 409) timer.current = setTimeout(reload, 3000); }
  }, [b.id, reload]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const date = b.unlock.type === 'date';
  return (<>
    <div className="card ink stack">
      <div className="row between wrap-r"><span className="tag light">Sealed</span><span className="mono faint">SEALED {fmtDate(b.sealedAt)}</span></div>
      {date ? <>
        <h2 className="h2">{sender ? 'This bottle opens in' : 'Your bottle opens in'}</h2>
        <Countdown at={b.unlock.at} serverNow={b.serverNow} onZero={unlock} dark />
        <UnlockRule b={b} />
      </> : <>
        <h2 className="h2">Opens when:</h2><div className="display" style={{ fontSize: 40 }}>{b.unlock.milestone}</div>
        <p className="muted">{sender ? 'Only you can release it.' : `${b.senderName} releases it.`}</p>
        {sender && <button className="btn btn-light" onClick={() => setConfirm(true)}>Milestone reached, release the bottle</button>}
      </>}
      {config?.dev && date && sender && <button className="btn btn-mint btn-sm" onClick={async () => { await post(`/dev/bottles/${b.id}/fast-forward`); reload(); }}>Dev: open this bottle now</button>}
      <hr className="divider" style={{ background: 'var(--color-graphite)' }} />
      <div className="row between wrap-r"><span><b>{fmtSats(b.amountSats)} sats</b> locked</span><span className="muted">Message hidden</span></div>
      {!sender && b.attachmentKinds?.length > 0 && <div className="row wrap-r">{b.attachmentKinds.map((k) => <span key={k} className="tag gray">{k === 'voice' ? 'A voice note' : 'A photo'} inside</span>)}</div>}
    </div>
    {confirm && <Modal title="Release bottle?" onClose={() => setConfirm(false)}>
      <p>Confirm that “{b.unlock.milestone}” happened. They can claim right away.</p>
      {error && <p className="err">{error.message}</p>}
      <div className="row"><button className="btn btn-ghost" onClick={() => setConfirm(false)}>Not yet</button><button className="btn btn-dark" disabled={busy} onClick={() => run(async () => { await post(`/bottles/${b.id}/unlock`); setConfirm(false); await reload(); })}>{busy ? <Spinner /> : 'Release'}</button></div>
    </Modal>}
  </>);
}

function SharePanel({ b }) {
  const [s, setS] = useState(null);
  const [emailed, setEmailed] = useState(false);
  const toast = useToast();
  const { error, run } = useAsync();
  useEffect(() => { run(async () => setS(await post(`/bottles/${b.id}/share`, {}))); }, [b.id, run]);
  return (
    <div className="card stack">
      <h2 className="h2">Share the bottle</h2>
      <p className="muted body-sm">Only {b.recipientEmail} can open it.</p>
      {error && <p className="err">{error.message}</p>}
      {s ? <div className="grid g2" style={{ alignItems: 'center' }}>
        <QrBox src={s.qr} alt="QR code for the bottle link" />
        <div className="stack-sm">
          <div className="copybox"><code>{s.url}</code></div>
          <div className="row wrap-r">
            <CopyButton text={s.url} label="Copy link" />
            {navigator.share && <button className="btn btn-ghost btn-sm" onClick={() => navigator.share({ title: 'A bottle for you', url: s.url }).catch(() => {})}>Share…</button>}
            <button className="btn btn-ghost btn-sm" disabled={emailed} onClick={async () => { await post(`/bottles/${b.id}/share`, { email: true }); setEmailed(true); toast(`Emailed ${b.recipientEmail}`); }}>{emailed ? 'Emailed' : 'Email them'}</button>
          </div>
        </div>
      </div> : !error && <Loading />}
    </div>
  );
}

function ReadySender({ b, reload }) {
  const [refund, setRefund] = useState(false);
  const canRefund = b.claimDeadline && Date.now() > b.claimDeadline;
  return (<>
    <div className="card stack">
      <span className="tag yellow">Unlocked</span>
      <h2 className="h2">Waiting for them to claim</h2>
      <p className="muted">Opened {fmtDate(b.readyAt)}. You can reclaim after {fmtDay(b.claimDeadline)}.</p>
      <button className="btn btn-ghost" disabled={!canRefund} onClick={() => setRefund(true)}>Reclaim sats</button>
    </div>
    <SharePanel b={b} />
    {refund && <PayoutModal b={b} mode="refund" onClose={() => setRefund(false)} reload={reload} />}
  </>);
}

function Done({ b }) {
  return (
    <div className="card ink stack">
      <span className="tag">{b.status === 'claimed' ? 'Claimed' : 'Refunded'}</span>
      <h2 className="display" style={{ fontSize: 56 }}>{b.status === 'claimed' ? 'Delivered.' : 'Returned.'}</h2>
      <p className="muted">{fmtSats(b.amountSats)} sats {b.status === 'claimed' ? 'claimed' : 'returned'} {fmtDate(b.claimedAt)}.</p>
      {b.payoutTxid && <><span className="mono faint">TRANSACTION ID ({b.network})</span><div className="copybox"><code style={{ background: 'var(--color-graphite)' }}>{b.payoutTxid}</code><CopyButton text={b.payoutTxid} /></div></>}
    </div>
  );
}

function CancelDraft({ b, reload }) {
  const { run } = useAsync();
  return <button className="btn btn-danger btn-sm" onClick={() => window.confirm('Cancel this draft? Nothing has been paid.') && run(async () => { await post(`/bottles/${b.id}/cancel`); await reload(); })}>Cancel draft</button>;
}

function EditModal({ b, onClose, reload }) {
  const [message, setMessage] = useState(b.message || '');
  const [title, setTitle] = useState(b.title || '');
  const [voice, setVoice] = useState(null); const [photo, setPhoto] = useState(null);
  const { busy, error, run } = useAsync();
  return (
    <Modal title="Edit bottle" onClose={onClose}>
      <label className="field"><span>Title</span><input className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Message</span><textarea className="textarea" value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} /></label>
      <VoiceRecorder value={voice} onChange={setVoice} /><PhotoPicker value={photo} onChange={setPhoto} />
      
      {error && <p className="err">{error.message}</p>}
      <button className="btn btn-dark" disabled={busy} onClick={() => run(async () => {
        await put(`/bottles/${b.id}`, { title, message });
        if (photo) await uploadMedia(b.id, photo); if (voice) await uploadMedia(b.id, voice);
        await reload(); onClose();
      })}>{busy ? <Spinner /> : 'Save'}</button>
    </Modal>
  );
}

/* ============================== RECIPIENT ============================== */
function RecipientPanels({ b, reload }) {
  if (b.status === 'sealed') return <><Locked b={b} reload={reload} /><Amount b={b} /></>;
  return <Reveal b={b} reload={reload} />;
}

function Reveal({ b, reload }) {
  const [claim, setClaim] = useState(false);
  const photo = b.attachments?.find((a) => a.kind === 'photo'), voice = b.attachments?.find((a) => a.kind === 'voice');
  const url = (a) => a.url || `/api/bottles/${b.id}/attachments/${a.id}`;
  return (<>
    <div className="stack">
      <span className="tag yellow">From {b.senderName}</span>
      <div className="letter letter-anim">{b.message || <i className="muted">(no text)</i>}</div>
      {(photo || voice) && <div className="card stack-sm media">
        {photo && <img src={url(photo)} alt={`Photo from ${b.senderName}`} />}
        {voice && <><span className="mono muted">VOICE NOTE</span><audio controls preload="metadata" src={url(voice)} /></>}
      </div>}
    </div>
    <Amount b={b} dark />
    {b.status === 'ready' && <button className="btn btn-dark btn-block" style={{ minHeight: 64, fontSize: 18 }} onClick={() => setClaim(true)}>Claim {fmtSats(b.amountSats)} sats</button>}
    {b.status === 'claiming' && <div className="callout"><Spinner /> Sending…</div>}
    {b.status === 'claimed' && <Done b={b} />}
    {claim && <PayoutModal b={b} mode="claim" onClose={() => setClaim(false)} reload={reload} />}
  </>);
}

/* ===================== CLAIM / REFUND (shared) ===================== */
function PayoutModal({ b, mode, onClose, reload }) {
  const { config } = useAuth();
  const [kind, setKind] = useState('lnurl');
  const [dest, setDest] = useState('');
  const [step, setStep] = useState('enter');
  const [ack, setAck] = useState(false);
  const [txid, setTxid] = useState('');
  const { busy, error, run, setError } = useAsync();
  const claim = mode === 'claim';
  const demo = () => run(async () => { const r = await get(`/dev/demo-destination?sats=${b.amountSats}`); setDest(kind === 'lnurl' ? 'demo@wallet.example.com' : kind === 'lightning' ? r.invoice : r.address); });
  const looksOk = kind === 'lnurl' ? /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(dest) || /^lnurl1/i.test(dest) : dest.trim().length > 20;
  const KINDS = { lnurl: ['Lightning address', 'you@wallet.com', 'Lightning address or LNURL'], lightning: ['Invoice', 'lnbc…', `Invoice for exactly ${fmtSats(b.amountSats)} sats`], onchain: ['On-chain', 'bc1q…', `Native SegWit address (${b.network === 'mainnet' ? 'bc1' : 'tb1'}…)`] };

  if (step === 'done') return (
    <Modal title={claim ? 'Sats claimed' : 'Sats returned'} onClose={() => { onClose(); reload(); }}>
      <div className="callout">{fmtSats(b.amountSats)} sats are on their way to your wallet.</div>
      <span className="mono muted">TRANSACTION ID</span><div className="copybox"><code>{txid}</code><CopyButton text={txid} /></div>
      <button className="btn btn-dark" onClick={() => { onClose(); reload(); }}>Done</button>
    </Modal>);

  return (
    <Modal title={claim ? 'Claim your sats' : 'Get your sats back'} onClose={onClose}>
      {step === 'enter' ? <>
        <p className="muted">Send {fmtSats(b.amountSats)} sats to:</p>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {Object.entries(KINDS).map(([k, [label]]) => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setDest(''); setError(null); }}>{label}</button>)}
        </div>
        {kind === 'lnurl' && <p className="help" style={{ marginTop: 0 }}>Works with most Lightning wallets.</p>}
        <label className="field"><span>{KINDS[kind][2]}</span>
          <textarea className="textarea input mono-in" style={{ minHeight: kind === 'lnurl' ? 60 : 100 }} spellCheck={false} autoCapitalize="off" autoComplete="off" value={dest} onChange={(e) => { setDest(e.target.value.trim()); setError(null); }} placeholder={KINDS[kind][1]} /></label>
        {config?.dev && <button className="btn btn-mint btn-sm" onClick={demo}>Dev: fill a demo destination</button>}
        {error && <p className="err" role="alert">{error.message}</p>}
        <button className="btn btn-dark" disabled={!looksOk} onClick={() => setStep('confirm')}>Continue</button>
      </> : <>
        <div className="card ink"><span className="mono faint">YOU WILL RECEIVE</span><div className="amount-big num">{fmtSats(b.amountSats)}</div><span className="mono faint">SATS · {fmtBtc(b.amountSats)} BTC</span></div>
        <span className="mono muted">TO ({KINDS[kind][0].toUpperCase()})</span><div className="copybox"><code>{dest}</code></div>
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>This destination is mine. Payments can’t be reversed.</span></label>
        {error && <p className="err" role="alert">{error.message}</p>}
        <div className="row"><button className="btn btn-ghost" onClick={() => { setStep('enter'); setError(null); }}>Back</button>
          <button className="btn btn-dark" disabled={!ack || busy} onClick={() => run(async () => {
            const r = await post(`/bottles/${b.id}/${claim ? 'claim' : 'refund'}`, { kind, destination: dest, confirmAmountSats: b.amountSats });
            setTxid(r.txid); setStep('done');
          }).then(() => {})}>{busy ? <Spinner /> : claim ? 'Claim sats' : 'Return sats'}</button></div>
      </>}
    </Modal>
  );
}
