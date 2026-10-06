import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api.js';
import BottleRow from '../components/BottleRow.jsx';
import { Loading } from '../components/ui.jsx';

const FILTERS = [['all', 'All'], ['locked', 'Locked'], ['unlocked', 'Unlocked'], ['claimed', 'Claimed']];
export default function Bottles() {
  const [q, setQ] = useSearchParams();
  const tab = q.get('tab') === 'received' ? 'received' : 'sent';
  const [f, setF] = useState('all');
  const [all, setAll] = useState(null);
  useEffect(() => { get('/bottles').then((r) => setAll(r.bottles)); }, []);
  if (!all) return <Loading />;
  const mine = all.filter((b) => (tab === 'sent' ? b.role === 'sender' : b.role === 'recipient'));
  const shown = mine.filter((b) => f === 'all' || (f === 'locked' && ['draft', 'funded', 'sealed'].includes(b.status)) || (f === 'unlocked' && ['ready', 'claiming'].includes(b.status)) || (f === 'claimed' && ['claimed', 'refunded'].includes(b.status)));
  return (
    <div className="stack">
      <div className="page-head"><h1 className="display">Bottles</h1></div>
      <div className="row between wrap-r">
        <div className="seg" role="tablist" aria-label="Role">
          <button role="tab" aria-selected={tab === 'sent'} onClick={() => setQ({})}>My bottles</button>
          <button role="tab" aria-selected={tab === 'received'} onClick={() => setQ({ tab: 'received' })}>Received</button>
        </div>
        <div className="seg" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}</div>
      </div>
      <div className="stack-sm">{shown.map((b) => <BottleRow key={b.id} b={b} />)}</div>
      {!shown.length && <div className="card muted" style={{ textAlign: 'center', padding: 48 }}>{tab === 'sent' ? 'Nothing here yet.' : 'Nothing here yet.'}</div>}
    </div>
  );
}
