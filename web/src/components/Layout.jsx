import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { get, post } from '../lib/api.js';
import { Loading } from './ui.jsx';

export const Brand = () => (
  <Link to="/" className="logo" aria-label="Sats in a Bottle home">
    <svg width="22" height="28" viewBox="0 0 22 28" fill="none" aria-hidden="true"><path d="M8 1h6v6l4 5v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V12l4-5z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/><circle cx="11" cy="19" r="3" fill="currentColor"/></svg>
    <span>Sats in a Bottle</span>
  </Link>
);

export function Nav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [dark, setDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => { if (user) get('/activity').then((r) => setUnread(r.unread)).catch(() => {}); }, [user, loc.pathname]);
  useEffect(() => { // header turns dark/yellow while it floats over a black section
    let raf = 0;
    const check = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { setScrolled(window.scrollY > 8); setDark(document.elementsFromPoint(window.innerWidth / 2, 40).some((e) => e.closest?.('[data-dark]'))); }); };
    check(); const t = setTimeout(check, 150);
    window.addEventListener('scroll', check, { passive: true }); window.addEventListener('resize', check);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); window.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [loc.pathname]);
  return (
    <header className={`hdr ${dark ? 'dark' : ''} ${scrolled ? 'scrolled' : ''}`}>
      <Brand />
      {user ? (
        <nav className="pill" aria-label="Main">
          <NavLink to="/home" end>Home</NavLink>
          <NavLink to="/bottles">Bottles</NavLink>
          <NavLink to="/activity">Activity{unread > 0 && <b className="dot">{unread}</b>}</NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <a href="/" onClick={async (e) => { e.preventDefault(); await logout(); nav('/'); }}>Sign out</a>
        </nav>
      ) : (
        <nav className="pill" aria-label="Main">
          <a href="/#how">How it works</a><a href="/#security">Security</a><a href="/#ideas">Ideas</a><Link to="/login">Sign in</Link>
        </nav>
      )}
      <Link to={user ? '/bottles/new' : '/register'} className="hdr-cta">{user ? 'Create a bottle' : 'Create a bottle'}</Link>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer" data-dark>
      <div className="wrap foot-row">
        <Brand />
        <p>Bitcoin payments are irreversible. Not a bank, not insured.</p>
      </div>
    </footer>
  );
}

export function AppShell() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  const full = loc.pathname === '/home';
  return (<><Nav />{!user.emailVerified && <VerifyBanner />}<main className={full ? 'page-full' : 'wrap page'}><Outlet /></main><Footer /></>);
}
function VerifyBanner() {
  const { config, user } = useAuth();
  const [state, setState] = useState('idle');
  const [link, setLink] = useState('');
  async function resend() {
    await post('/auth/resend'); setState('sent');
    if (config?.dev) {
      const r = await get(`/dev/outbox?email=${encodeURIComponent(user.email)}`).catch(() => null);
      const m = r?.emails?.find((e) => e.subject.startsWith('Verify'));
      if (m) setLink(m.body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, ''));
    }
  }
  return (
    <div className="wrap" style={{ marginBottom: 16 }}>
      <div className="callout warn row between wrap-r">
        <span>Verify your email to continue. Link sent to {user.email}.</span>
        {state === 'idle' ? <button className="btn btn-dark btn-sm" onClick={resend}>Resend link</button> : link ? <a className="btn btn-dark btn-sm" href={link}>Dev: open link</a> : <span className="mono">SENT</span>}
      </div>
    </div>
  );
}
export function PublicShell() {
  return (<><Nav /><main className="wrap page"><Outlet /></main><Footer /></>);
}
