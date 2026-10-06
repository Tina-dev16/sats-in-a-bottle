import { useEffect, useRef, useState } from 'react';

/** Lazy-loads three.js; falls back to a flat SVG bottle if WebGL is unavailable. */
export default function BottleCanvas({ progress = 1, open = 0, offset = 0, zoom = 1, lift = 0, onReady, className = '', label = 'A glass bottle holding sats' }) {
  const ref = useRef(null);
  const scene = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const init = useRef({ progress, open });
  init.current = { progress, open };

  useEffect(() => {
    let dead = false, s;
    import('../lib/bottleScene.js').then(({ createBottleScene }) => {
      if (dead || !ref.current) return;
      try {
        s = createBottleScene(ref.current, { reducedMotion: false });
        s.jumpTo(init.current.progress); s.jumpOpen(init.current.open);
        scene.current = s; setReady(true); onReady?.(s);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { dead = true; s?.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { scene.current?.setProgress(progress); }, [progress]);
  useEffect(() => { scene.current?.setOpen(open); }, [open]);

  if (failed) return <FallbackBottle className={className} />;
  return (
    <>
      {!ready && <FallbackBottle className="bottle-placeholder" />}
      <canvas ref={ref} data-offset={offset} data-zoom={zoom} data-lift={lift} className={className} role="img" aria-label={label} style={ready ? undefined : { opacity: 0 }} />
    </>
  );
}

function FallbackBottle({ className }) {
  return (
    <div className={className} style={{ display: 'grid', placeItems: 'center' }}>
      <svg className="bob" width="150" viewBox="0 0 64 100" role="img" aria-label="Bottle">
        <path d="M26 4h12v14l8 16v52a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8V34l8-16z" fill="#d1ffca" stroke="#000" strokeWidth="2" />
        <rect x="18" y="46" width="28" height="22" fill="#000" /><circle cx="32" cy="57" r="6" fill="#fff100" />
      </svg>
    </div>
  );
}
