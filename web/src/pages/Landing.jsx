import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BottleCanvas from '../components/BottleCanvas.jsx';
import { Footer, Nav } from '../components/Layout.jsx';
import { useReveal } from '../components/ui.jsx';
import { Blocks, MINT, YEL, INK } from '../components/Blocks.jsx';

const INTRO_MS = 5200;                  // first play, scroll locked
const LOOP = { hold: 1400, open: 2000, rest: 1300, fade: 350, build: 4200 }; // then it repeats

const TRIO = [
  ['Message', 'Text, a voice note or a photo. Encrypted until it opens.', ['#d1ffca', '#fff', '#000']],
  ['Amount', 'From 1,000 sats. Lightning or on-chain.', ['#fff100', '#fff', '#000']],
  ['Condition', 'A date, or a milestone only you can release.', ['#fff', '#d1ffca', '#fff100']],
];
const IDEAS = [
  ['Birthdays', 'Write it now. It opens on the day.', 'cake'],
  ['Graduation', 'Open it the day they walk the stage.', 'cap'],
  ['New baby', 'A first deposit they can claim at 18.', 'baby'],
];

export default function Landing() {
  const sceneRef = useRef(null);
  const [done, setDone] = useState(false);
  const raf = useRef(0);
  const skipRef = useRef(() => {});
  const r1 = useReveal(), r2 = useReveal(), r3 = useReveal(), r4 = useReveal();

  const finish = useCallback(() => setDone(true), []);

  useEffect(() => { // build the bottle (scroll locked), then loop: open, rewind, build again
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // still animates (it is decorative), just never locks scrolling
    const skipIntro = reduced || !!window.location.hash || window.scrollY > 200; // arriving at a section link: no intro
    let start = performance.now() + 500, phase = skipIntro ? 'hold' : 'intro', skipped = false;
    if (skipIntro) {
      finish();
      const hash = window.location.hash;
      const go = () => { // land with the section's top just below the 72px header
        sceneRef.current?.jumpTo(1);
        const el = hash && document.querySelector(hash);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: 'instant' });
      };
      [150, 600, 1400].forEach((t) => setTimeout(go, t));
    }
    const sc = () => sceneRef.current;
    const fade = (v) => { const c = sc()?.canvas; if (c) { c.style.transition = 'opacity .3s'; c.style.opacity = v; } };
    skipRef.current = () => { skipped = true; };
    const tick = (now) => {
      raf.current = requestAnimationFrame(tick);
      const e = now - start;
      if (e < 0) return;
      if (phase === 'intro') {
        const t = skipped ? 1 : e / INTRO_MS;
        sc()?.setProgress(Math.min(1, t));
        if (t >= 1) { setDone(true); phase = 'hold'; start = now; }
      } else if (phase === 'build') {
        sc()?.setProgress(Math.min(1, e / LOOP.build));
        if (e > LOOP.build) { phase = 'hold'; start = now; }
      } else if (phase === 'hold') {
        if (e > LOOP.hold) { phase = 'open'; start = now; sc()?.setOpen(1); }
      } else if (phase === 'open') {
        if (e > LOOP.open + LOOP.rest) { phase = 'fade'; start = now; fade(0); }
      } else if (e > LOOP.fade) { sc()?.jumpOpen(0); sc()?.jumpTo(0); fade(1); phase = 'build'; start = now; }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [finish]);

  useEffect(() => { // no scrolling until the first play has finished
    const lock = !done;
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    document.body.style.overflow = lock ? 'hidden' : '';
    if (lock) window.scrollTo(0, 0);
    return () => { document.documentElement.style.overflow = ''; document.body.style.overflow = ''; };
  }, [done]);

  return (
    <>
      <Nav />
      <section className="hero">
        <div className="hero-art">
          <BottleCanvas progress={0} offset={0} zoom={0.84} onReady={(s) => { sceneRef.current = s; s.jumpTo(window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.location.hash || window.scrollY > 200 ? 1 : 0); }} />
        </div>
        <div className="hero-copy">
          <h1 className="h-hero">
            <span>Not just</span><span>a transfer.</span><span>A bottle with</span><span>a date on it.</span>
          </h1>
          <p className="hero-p">Send bitcoin with a message inside. It stays sealed until the day you choose, then they claim it to their own wallet.</p>
        </div>
        {!done && <button className="skip-link" onClick={() => skipRef.current()}>Skip</button>}
      </section>

      <section className="dk arc" id="how" data-dark>
        <div className="wrap" ref={r1}>
          <div className="cols3 reveal">
            {[['Lock.', 'Fund a bottle from any Lightning wallet or on-chain. The sats are held until it opens.'],
              ['Wait.', 'The message stays hidden from everyone, the recipient included, until the day.'],
              ['Claim.', 'They get an email, read your message and claim to their own Lightning address.']].map(([t, d]) => (
              <div key={t}><h2 className="h-col">{t}</h2><p className="p-dk">{d}</p></div>))}
          </div>
          <h2 className="h-statement reveal">Sats that stay put until the day.</h2>
          <div className="p-stack reveal"><p>You pick the amount, the date and the words.</p><p>After you seal it, none of it can be changed.</p></div>
        </div>
      </section>

      <section className="dk" data-dark>
        <div className="wrap" ref={r2}>
          <div className="cols3 trio reveal">
            {TRIO.map(([t, d, tones]) => (
              <div key={t}><Blocks tones={tones} size={170} delay={TRIO.findIndex((x) => x[0] === t) * 3} reverse={t === 'Amount'} /><h2 className="h-col">{t}</h2><p className="p-dk">{d}</p></div>))}
          </div>
        </div>
      </section>

      <section className="dk" id="security" data-dark>
        <div className="wrap" ref={r3}>
          <h2 className="h-statement reveal">Built to be trusted.</h2>
          <div className="cols3 reveal">
            {[['Encrypted.', 'Every bottle has its own key. A copy of the database reads as noise.'],
              ['Checked.', 'Addresses and invoices are validated before anything is sent.'],
              ['Once.', 'A payout can only happen one time. The lock is enforced on our server.']].map(([t, d]) => (
              <div key={t}><h2 className="h-col">{t}</h2><p className="p-dk">{d}</p></div>))}
          </div>
          <p className="p-dk fine reveal">We hold the sats until they are claimed, so you are trusting us. Each bottle is capped during early access.</p>
        </div>
      </section>

      <section className="wh arc" id="ideas">
        <div className="wrap" ref={r4}>
          <h2 className="h-sub reveal">Ideas for your first bottle.</h2>
          <p className="p-gray reveal">Pick a reason, set a date, send.</p>
          <div className="feature reveal">
            <div className="feature-copy">
              <h3 className="h-feature">Birthdays that arrive on time.</h3>
              <p>Write it now. It opens on the day, not before.</p>
              <Link to="/register" className="btn-dark-sm">Create one</Link>
            </div>
            <div className="feature-art"><Blocks model="cake" size={270} /></div>
          </div>
        </div>
      </section>

      <section className="cards-sec">
        <div className="wrap idea-grid">
          {IDEAS.map(([t, d, model], i) => (
            <article className="idea" key={t}>
              <div className="idea-art"><Blocks model={model} size={118} delay={i * 4} reverse={i === 1} /></div>
              <h3>{t}</h3><p>{d}</p>
              <Link to="/register" className="btn-gray">Create one</Link>
            </article>))}
        </div>
      </section>

      <section className="split">
        <Link to="/register" className="split-half"><h2 className="h-split">Create<br />a bottle</h2><span className="arrow-box" aria-hidden="true">↗</span><p>About two minutes.</p></Link>
        <Link to="/login" className="split-half"><h2 className="h-split">Sign<br />in</h2><span className="arrow-box" aria-hidden="true">↗</span><p>Pick up where you left off.</p></Link>
      </section>
      <Footer />
    </>
  );
}
