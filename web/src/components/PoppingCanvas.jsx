import { useEffect, useState } from 'react';
import BottleCanvas from './BottleCanvas.jsx';

/** A sealed bottle that pops its cork every few seconds, so pages with a bottle always have motion. */
export default function PoppingCanvas({ zoom = 0.9 }) {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    let t1, t2; const cycle = () => { setOpen(1); t1 = setTimeout(() => setOpen(0), 2600); t2 = setTimeout(cycle, 6200); };
    t2 = setTimeout(cycle, 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return <BottleCanvas progress={1} open={open} zoom={zoom} />;
}
