import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { Loading } from '../components/ui.jsx';
import { fmtBtc, fmtDate, fmtSats } from '../lib/format.js';

export function Transactions() {
  const [d, setD] = useState(null);
  useEffect(() => { get('/transactions').then(setD); }, []);
  if (!d) return <Loading />;
  const label = { fund: 'Funded bottle', claim: 'Claimed bottle', refund: 'Refund' };
  return (
    <div className="stack">
      <div className="page-head"><h1 className="display">Transactions</h1></div>
      {d.transactions.length ? (
        <table className="table">
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>{d.transactions.map((t) => (
            <tr key={t.id}>
              <td className="mono">{fmtDate(t.createdAt)}</td>
              <td><span className={`tag ${t.direction === 'received' ? '' : 'gray'}`}>{t.direction === 'received' ? '↓ received' : '↑ sent'}</span> <span className="muted body-sm">{label[t.type]}</span></td>
              <td className="num"><b>{t.direction === 'received' ? '+' : '−'}{fmtSats(t.sats)} sats</b><div className="mono muted">{fmtBtc(t.sats)} BTC</div></td>
              <td><span className="tag dark">{t.status}</span></td>
              <td><Link to={`/b/${t.bottleId}`}><u>{t.title || 'Bottle'}</u></Link><div className="mono muted" style={{ wordBreak: 'break-all' }}>{t.txid?.slice(0, 20)}…</div></td>
            </tr>))}</tbody>
        </table>
      ) : <div className="card muted" style={{ textAlign: 'center', padding: 48 }}>No transactions yet.</div>}
    </div>
  );
}

export function Activity() {
  const [d, setD] = useState(null);
  useEffect(() => { get('/activity').then((r) => { setD(r); if (r.unread) post('/activity/read').catch(() => {}); }); }, []);
  if (!d) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head"><h1 className="display">Activity</h1></div>
      <div className="stack-sm">
        {d.items.map((a) => (
          <Link key={a.id} to={a.bottleId ? `/b/${a.bottleId}` : '#'} className="list-item">
            <div className="row">{!a.read && <span className="tag yellow">New</span>}<span>{a.text}</span></div><span className="mono muted">{fmtDate(a.createdAt)}</span>
          </Link>))}
      </div>
      {!d.items.length && <div className="card muted" style={{ textAlign: 'center', padding: 48 }}>No activity yet.</div>}
    </div>
  );
}
