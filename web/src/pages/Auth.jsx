import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PoppingCanvas from '../components/PoppingCanvas.jsx';
import { Spinner, useAsync } from '../components/ui.jsx';

function PoppingBottle() {
  return <div className="auth2-art"><PoppingCanvas zoom={0.9} /></div>;
}

function Field({ label, ...p }) {
  return <label className="fld"><span>{label}</span><input {...p} /></label>;
}

export function Login() {
  const { login, user, config } = useAuth();
  const nav = useNavigate(); const loc = useLocation();
  const { busy, error, run } = useAsync();
  const [f, setF] = useState({ email: '', password: '' });
  useEffect(() => { if (user) nav(loc.state?.from || '/home', { replace: true }); }, [user, nav, loc.state]);
  const demo = (email) => setF({ email, password: 'demo-bottle-2026' });
  // demo / dev builds open with the Alice account already filled in, so it's one click to sign in
  useEffect(() => { if (config?.dev) setF((cur) => (cur.email || cur.password ? cur : { email: 'alice@demo.test', password: 'demo-bottle-2026' })); }, [config?.dev]);
  return (
    <div className="auth2">
      <form className="auth2-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await login(f.email, f.password); nav(loc.state?.from || '/home', { replace: true }); }); }}>
        <h1 className="h-hero"><span>Welcome</span><span>back.</span></h1>
        <Field label="Email" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label="Password" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {error && <p className="err" role="alert">{error.message}</p>}
        <button className="go" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
        <p className="alt">New here? <Link to="/register">Create an account</Link></p>
        {config?.dev && (
          <div className="demo-box"><span className="mono">DEMO ACCOUNTS</span>
            <button type="button" onClick={() => demo('alice@demo.test')}>Alice (sender)</button>
            <button type="button" onClick={() => demo('bob@demo.test')}>Bob (recipient)</button></div>
        )}
      </form>
      <PoppingBottle />
    </div>
  );
}

export function Register() {
  const { config } = useAuth();
  const { busy, error, run } = useAsync();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [sent, setSent] = useState(false);
  const [devMail, setDevMail] = useState(null);
  async function loadDev(email) {
    if (!config?.dev) return;
    const r = await get(`/dev/outbox?email=${encodeURIComponent(email)}`).catch(() => null);
    setDevMail(r?.emails?.find((m) => m.subject.startsWith('Verify')) || null);
  }
  return (
    <div className="auth2">
      {sent ? (
        <div className="auth2-form">
          <h1 className="h-hero"><span>Check your</span><span>inbox.</span></h1>
          <p className="alt" style={{ marginTop: 24 }}>Link sent to <b>{f.email}</b>.</p>
          {config?.dev && (devMail
            ? <a className="go" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} href={devMail.body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, '')}>Open verification link</a>
            : <button className="go" onClick={() => loadDev(f.email)}>Show verification link</button>)}
          <p className="alt"><Link to="/login">Go to sign in</Link></p>
        </div>
      ) : (
        <form className="auth2-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/register', f); setSent(true); setTimeout(() => loadDev(f.email), 300); }); }}>
          <h1 className="h-hero"><span>Open your</span><span>first bottle.</span></h1>
          <Field label="Name" autoComplete="name" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field label={`Password (${f.password.length}/12 minimum)`} type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {error && <p className="err" role="alert">{error.message}</p>}
          <button className="go" disabled={busy}>{busy ? <Spinner /> : 'Create account'}</button>
          <p className="alt">Already have one? <Link to="/login">Sign in</Link></p>
        </form>
      )}
      <PoppingBottle />
    </div>
  );
}

export function Verify() {
  const [q] = useSearchParams();
  const [state, setState] = useState('working');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true; // StrictMode would otherwise spend the one-time token twice
    post('/auth/verify', { token: q.get('token') || '' }).then(() => setState('ok')).catch(() => setState('bad'));
  }, [q]);
  return (
    <div className="auth2">
      <div className="auth2-form">
        {state === 'working' && <Spinner />}
        {state === 'ok' && <><h1 className="h-hero"><span>Verified.</span></h1><Link className="go" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} to="/login">Sign in</Link></>}
        {state === 'bad' && <><h1 className="h-hero"><span>Link</span><span>expired.</span></h1><Link className="go" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} to="/login">Sign in</Link></>}
      </div>
      <PoppingBottle />
    </div>
  );
}
