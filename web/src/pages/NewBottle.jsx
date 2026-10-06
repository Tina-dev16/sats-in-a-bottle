import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtBtc, fmtDay, fmtSats, humanLeft } from '../lib/format.js';
import { PhotoPicker, VoiceRecorder, uploadMedia } from '../components/Media.jsx';
import { Spinner, useAsync } from '../components/ui.jsx';
import BottleCanvas from '../components/BottleCanvas.jsx';

// the bottle builds itself as you move through the steps
const STEP_PROGRESS = [0.14, 0.52, 0.68, 0.84, 1];

const STEPS = ['Who', 'Message', 'Amount', 'Unlock', 'Review'];
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const PRESETS = [['1 week', 7], ['1 month', 30], ['6 months', 182], ['1 year', 365], ['5 years', 1826]];
const AMOUNTS = [10_000, 50_000, 100_000, 500_000];

export default function NewBottle() {
  const { user, config } = useAuth();
  const nav = useNavigate();
  const lim = config?.limits || { minSats: 1000, maxSats: 5_000_000, minLockSeconds: 3600, messageChars: 5000 };
  const { busy, error, run, setError } = useAsync();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ title: '', email: '', message: '', sats: '', type: 'date', at: '', milestone: '' });
  const [voice, setVoice] = useState(null); const [photo, setPhoto] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sats = Number(f.sats);
  const at = f.at ? new Date(f.at) : null;

  const problem = useMemo(() => {
    if (step === 0) {
      if (!/^\S+@\S+\.\S+$/.test(f.email)) return 'Enter the recipient’s email address';
      if (f.email.trim().toLowerCase() === user.email) return 'You can’t send a bottle to yourself';
    }
    if (step === 1 && !f.message.trim() && !voice && !photo) return 'Add a message, voice note or photo';
    if (step === 2) {
      if (!Number.isInteger(sats) || sats < lim.minSats) return `Minimum is ${fmtSats(lim.minSats)} sats`;
      if (sats > lim.maxSats) return `Early-access limit is ${fmtSats(lim.maxSats)} sats (${fmtBtc(lim.maxSats)} BTC) per bottle`;
    }
    if (step === 3) {
      if (f.type === 'date') {
        if (!at || isNaN(at)) return 'Pick an unlock date and time';
        if (at.getTime() < Date.now() + lim.minLockSeconds * 1000) return lim.minLockSeconds >= 3600 ? 'Pick a time at least an hour from now' : 'Pick a time a little further in the future';
      } else if (f.milestone.trim().length < 3) return 'Describe the milestone';
    }
    return '';
  }, [step, f, voice, photo, sats, at, user.email, lim]);

  const next = () => { if (problem) return setError(new Error(problem)); setError(null); setStep(step + 1); };

  async function create() {
    await run(async () => {
      const { bottle } = await post('/bottles', {
        recipientEmail: f.email, title: f.title, message: f.message, amountSats: sats,
        unlock: f.type === 'date' ? { type: 'date', at: at.toISOString() } : { type: 'milestone', text: f.milestone.trim() },
      });
      try { if (photo) await uploadMedia(bottle.id, photo); if (voice) await uploadMedia(bottle.id, voice); } catch { /* bottle exists; user can re-add media on the next screen */ }
      nav(`/b/${bottle.id}`);
    });
  }

  return (
    <div className="wiz">
    <div className="wiz-main stack">
      <div className="page-head"><span className="mono muted">NEW BOTTLE · STEP {step + 1}/{STEPS.length}</span><h1 className="display" style={{ marginTop: 8 }}>{['Who is it\nfor?', 'Your\nmessage', 'How many\nsats?', 'When does\nit open?', 'Looks\ngood?'][step].split('\n').map((l) => <span key={l} style={{ display: 'block' }}>{l}</span>)}</h1></div>
      <div className="wiz-bar" aria-label={`Step ${step + 1} of ${STEPS.length}`}>{STEPS.map((x, i) => <i key={x} className={i <= step ? 'on' : ''} />)}</div>

      <div className="stack wiz-body">
        {step === 0 && <>
          <label className="field"><span>Recipient’s email</span><input className="input" type="email" autoFocus placeholder="friend@example.com" value={f.email} onChange={set('email')} /><div className="help">They sign in with this email to open it.</div></label>
          <label className="field"><span>Name this bottle (optional)</span><input className="input" maxLength={80} placeholder="Happy 30th, Sam" value={f.title} onChange={set('title')} /></label>
        </>}
        {step === 1 && <>
          <label className="field"><span>Message</span><textarea className="textarea" autoFocus maxLength={lim.messageChars} placeholder="Write something they’ll want to keep…" value={f.message} onChange={set('message')} /><div className="help" style={{ textAlign: 'right' }}>{f.message.length}/{lim.messageChars}</div></label>
          <div className="grid g2"><VoiceRecorder value={voice} onChange={setVoice} /><PhotoPicker value={photo} onChange={setPhoto} /></div>
          <p className="help">Hidden until the bottle opens.</p>
        </>}
        {step === 2 && <>
          <label className="field"><span>Amount in sats</span><input className="input num" inputMode="numeric" autoFocus placeholder="100000" value={f.sats} onChange={(e) => setF({ ...f, sats: e.target.value.replace(/\D/g, '') })} /></label>
          <div className="row wrap-r">{AMOUNTS.map((a) => <button key={a} type="button" className="tag light" style={{ cursor: 'pointer', border: 0 }} onClick={() => setF({ ...f, sats: String(a) })}>{fmtSats(a)}</button>)}</div>
          <div className="card mist sm row between wrap-r"><div><div className="amount-big num">{fmtSats(sats || 0)}</div><span className="mono muted">SATS</span></div><div style={{ textAlign: 'right' }}><div className="h3 num">{fmtBtc(sats || 0)}</div><span className="mono muted">BTC</span></div></div>
          <div className="help">Max {fmtSats(lim.maxSats)} sats.</div>
        </>}
        {step === 3 && <>
          <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
            <button role="tab" aria-selected={f.type === 'date'} onClick={() => setF({ ...f, type: 'date' })}>A date</button>
            <button role="tab" aria-selected={f.type === 'milestone'} onClick={() => setF({ ...f, type: 'milestone' })}>A milestone</button>
          </div>
          {f.type === 'date' ? <>
            <label className="field"><span>Opens on</span><input className="input" type="datetime-local" min={toLocalInput(new Date())} value={f.at} onChange={set('at')} /></label>
            <div className="row wrap-r">
              {PRESETS.map(([l, d]) => <button key={l} type="button" className="tag light" style={{ cursor: 'pointer', border: 0 }} onClick={() => { const x = new Date(Date.now() + d * 864e5); x.setSeconds(0); setF({ ...f, at: toLocalInput(x) }); }}>in {l}</button>)}
              {config?.dev && <button type="button" className="tag yellow" style={{ cursor: 'pointer', border: 0 }} onClick={() => setF({ ...f, at: toLocalInput(new Date(Date.now() + 2 * 60e3)) })}>in 2 min (demo)</button>}
            </div>
            {at && !isNaN(at) && <div className="card ink"><span className="mono faint">THIS BOTTLE WILL OPEN ON</span><div className="amount-big" style={{ marginTop: 8 }}>{fmtDay(at)}</div><div className="muted" style={{ marginTop: 8 }}>{at.toLocaleTimeString(undefined, { timeStyle: 'short' })} · in {humanLeft(at - Date.now())}</div></div>}
          </> : <>
            <label className="field"><span>The milestone</span><input className="input" maxLength={280} placeholder="Sam graduates from nursing school" value={f.milestone} onChange={set('milestone')} /></label>
            <p className="help">Only you can release it.</p>
          </>}
        </>}
        {step === 4 && <>
          <div className="grid g2">
            <div className="stack-sm"><span className="mono muted">TO</span><div>{f.email}</div>{f.title && <><span className="mono muted">TITLE</span><div>{f.title}</div></>}
              <span className="mono muted">OPENS</span><div>{f.type === 'date' ? `${fmtDay(at)}, ${at.toLocaleTimeString(undefined, { timeStyle: 'short' })}` : `When you confirm: “${f.milestone}”`}</div></div>
            <div className="card ink"><span className="mono faint">AMOUNT</span><div className="amount-big num">{fmtSats(sats)}</div><span className="mono faint">SATS · {fmtBtc(sats)} BTC</span></div>
          </div>
          <div className="stack-sm"><span className="mono muted">MESSAGE</span><div className="letter" style={{ fontSize: 16, padding: 20, maxHeight: 220, overflow: 'auto' }}>{f.message || '(no text)'}</div>
            <div className="row wrap-r">{voice && <span className="tag">Voice note</span>}{photo && <span className="tag">Photo</span>}</div></div>
          
        </>}
        {(error || problem) && step < 4 && error && <p className="err" role="alert">{error.message}</p>}
        {step === 4 && error && <p className="err" role="alert">{error.message}</p>}
        <div className="row between">
          <button className="btn btn-ghost" onClick={() => { setError(null); step ? setStep(step - 1) : nav(-1); }}>Back</button>
          {step < 4 ? <button className="btn btn-dark" onClick={next}>Continue</button> : <button className="btn btn-dark" onClick={create} disabled={busy}>{busy ? <Spinner /> : 'Create draft & fund →'}</button>}
        </div>
      </div>
    </div>
    <div className="wiz-art"><BottleCanvas progress={STEP_PROGRESS[step]} zoom={0.9} /></div>
    </div>
  );
}
