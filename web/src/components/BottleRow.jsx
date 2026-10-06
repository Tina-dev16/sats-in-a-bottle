import { Link } from 'react-router-dom';
import { fmtDate, fmtSats, humanLeft } from '../lib/format.js';
import { StatusTag } from './ui.jsx';

export function unlockLine(b) {
  if (b.unlock.type === 'milestone') return `Milestone: ${b.unlock.milestone}`;
  if (b.status === 'sealed') return `Opens in ${humanLeft(b.unlock.at - b.serverNow)} · ${fmtDate(b.unlock.at)}`;
  return `Opens ${fmtDate(b.unlock.at)}`;
}
export default function BottleRow({ b }) {
  const who = b.role === 'sender' ? `To ${b.recipientEmail}` : `From ${b.senderName}`;
  return (
    <Link to={`/b/${b.id}`} className="list-item">
      <div className="stack-sm">
        <div className="row wrap-r"><StatusTag status={b.status} /><span className="mono muted">{who}</span></div>
        <div style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{b.title || (b.role === 'sender' ? 'Untitled bottle' : `A bottle from ${b.senderName}`)}</div>
        <div className="body-sm muted">{unlockLine(b)}</div>
      </div>
      <div style={{ textAlign: 'right' }}><div className="h3 num">{fmtSats(b.amountSats)}</div><div className="mono muted">SATS</div></div>
    </Link>
  );
}
