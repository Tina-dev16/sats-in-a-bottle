import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PoppingCanvas from '../components/PoppingCanvas.jsx';
import { Blocks, INK, MINT, YEL } from '../components/Blocks.jsx';
import { Loading, StatusTag } from '../components/ui.jsx';
import { fmtSats, fmtDate, humanLeft } from '../lib/format.js';

const TONES = { draft: ['#fff', '#fff', INK], funded: [MINT, '#fff', INK], sealed: [INK, '#fff', MINT], ready: [YEL, '#fff', INK], claiming: [YEL, '#fff', INK], claimed: [MINT, MINT, '#fff'], refunded: ['#fff', '#fff', '#fff'], cancelled: ['#fff', '#fff', '#fff'] };

function unlockText(b) {
  if (b.unlock.type === 'milestone') return b.unlock.milestone;
  return b.status === 'sealed' ? `Opens in ${humanLeft(b.unlock.at - b.serverNow)}` : fmtDate(b.unlock.at);
}
function BottleCard({ b, i }) {
  const who = b.role === 'sender' ? `To ${b.recipientEmail}` : `From ${b.senderName}`;
  const cta = b.role === 'recipient' && b.status === 'ready' ? 'Open it' : b.status === 'draft' ? 'Continue' : 'View';
  return (
    <Link to={`/b/${b.id}`} className="idea bcard">
      <div className="idea-art"><Blocks tones={TONES[b.status] || TONES.draft} size={104} delay={i * 3} reverse={i % 2 === 1} /></div>
      <div className="row between"><StatusTag status={b.status} /><span className="mono muted">{who}</span></div>
      <h3>{b.title || (b.role === 'sender' ? 'Untitled bottle' : `Bottle from ${b.senderName}`)}</h3>
      <div className="amt num">{fmtSats(b.amountSats)} <small>sats</small></div>
      <p>{unlockText(b)}</p>
      <span className="btn-gray">{cta}</span>
    </Link>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    Promise.all([get('/bottles'), get('/activity')]).then(([b, a]) => setData({ bottles: b.bottles, activity: a.items })).catch(() => setData({ bottles: [], activity: [] }));
  }, []);
  if (!data) return <Loading />;
  const sent = data.bottles.filter((b) => b.role === 'sender'), recv = data.bottles.filter((b) => b.role === 'recipient');
  const locked = sent.filter((b) => ['funded', 'sealed', 'ready'].includes(b.status)).reduce((s, b) => s + b.amountSats, 0);
  const waiting = recv.filter((b) => b.status === 'ready');
  const next = sent.filter((b) => b.status === 'sealed' && b.unlock.type === 'date').sort((a, b) => a.unlock.at - b.unlock.at)[0];
  const line = waiting.length ? `${waiting.length} bottle${waiting.length > 1 ? 's are' : ' is'} ready to open.` : next ? `Your next bottle opens in ${humanLeft(next.unlock.at - next.serverNow)}.` : 'Nothing is waiting right now.';
  return (
    <>
      <section className="hero dash">
        <div className="hero-art"><PoppingCanvas zoom={0.84} /></div>
        <div className="hero-copy">
          <h1 className="h-hero"><span>Hi,</span><span>{user.name.split(' ')[0]}.</span></h1>
          <div className="dash-cta">
            <p className="hero-p">{line}</p>
            <div className="row wrap-r">
              {waiting.length > 0 && <Link to={`/b/${waiting[0].id}`} className="btn-dark-sm" style={{ background: 'var(--color-voltage-yellow)', color: '#000' }}>Open it now</Link>}
              <Link to="/bottles/new" className="btn-dark-sm">Create a bottle</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="dk arc" data-dark>
        <div className="wrap">
          <div className="cols3 stat3">
            <div><b className="num">{fmtSats(locked)}</b><span>Sats locked</span></div>
            <div><b className="num">{recv.length}</b><span>Received</span></div>
            <div><b className="num">{sent.length}</b><span>Sent</span></div>
          </div>
        </div>
      </section>

      <section className="wh arc dash-list">
        <div className="wrap">
          <div className="row between wrap-r"><h2 className="h-sub">My bottles</h2><Link to="/bottles" className="alt-link">See all</Link></div>
          <div className="idea-grid">
            {sent.slice(0, 6).map((b, i) => <BottleCard key={b.id} b={b} i={i} />)}
            {!sent.length && <Link to="/bottles/new" className="idea bcard empty"><div className="idea-art"><Blocks model="cluster" size={104} /></div><h3>No bottles yet</h3><p>Seal your first one in about two minutes.</p><span className="btn-dark-sm">Create a bottle</span></Link>}
          </div>
          <div className="row between wrap-r" style={{ marginTop: 56 }}><h2 className="h-sub">Received</h2><Link to="/bottles?tab=received" className="alt-link">See all</Link></div>
          <div className="idea-grid">
            {recv.slice(0, 6).map((b, i) => <BottleCard key={b.id} b={b} i={i + 1} />)}
            {!recv.length && <div className="idea bcard empty"><div className="idea-art"><Blocks model="baby" size={104} /></div><h3>Nothing received yet</h3><p>Bottles sent to {user.email} appear here once they are sealed.</p></div>}
          </div>
        </div>
      </section>

      <section className="cards-sec">
        <div className="wrap">
          <div className="row between wrap-r"><h2 className="h-sub">Recent activity</h2><Link to="/activity" className="alt-link">All activity</Link></div>
          <div className="act-list">
            {data.activity.slice(0, 5).map((a) => (
              <Link key={a.id} to={a.bottleId ? `/b/${a.bottleId}` : '/activity'}><span>{a.text}</span><span className="mono muted">{new Date(a.createdAt).toLocaleDateString()}</span></Link>
            ))}
            {!data.activity.length && <p className="p-gray" style={{ margin: 0 }}>Nothing yet.</p>}
          </div>
        </div>
      </section>
    </>
  );
}
