export const INK = '#1a1a1a', MINT = '#d1ffca', YEL = '#fff100';
// Block models built from real 3D boxes that rotate continuously (CSS 3D, no extra WebGL contexts).
// Each piece: [width, height, depth, x, y, z, colour, rotateY]. y is negative upwards.
export const WHT = '#efede8', SKIN = '#f1cdb0';
export const MODELS = {
  cluster: (t) => [[58, 58, 58, -30, 24, 0, t[0]], [58, 58, 58, 30, 24, 0, t[1]], [58, 58, 58, 0, -34, 0, t[2]], [36, 36, 36, 0, -80, 4, WHT]],
  cake: () => [[124, 6, 124, 0, 52, 0, INK], [100, 34, 100, 0, 32, 0, MINT], [72, 30, 72, 0, 0, 0, WHT], [46, 26, 46, 0, -28, 0, YEL], [6, 22, 6, 0, -52, 0, INK], [9, 9, 9, 0, -68, 0, YEL]],
  cap: () => [[60, 30, 60, 0, 20, 0, INK], [64, 7, 64, 0, 6, 0, MINT], [130, 8, 130, 0, -8, 0, INK, 45], [10, 6, 10, 0, -15, 0, YEL], [4, 36, 4, 46, 12, 46, YEL, 45], [11, 16, 11, 46, 36, 46, YEL, 45]],
  baby: () => [[54, 50, 54, 0, -30, 0, SKIN], [10, 14, 10, 0, -62, 0, INK], [7, 7, 3, -13, -32, 28, INK], [7, 7, 3, 13, -32, 28, INK], [48, 44, 42, 0, 16, 0, MINT], [13, 30, 13, -33, 14, 0, SKIN], [13, 30, 13, 33, 14, 0, SKIN], [18, 18, 18, -12, 47, 0, SKIN], [18, 18, 18, 12, 47, 0, SKIN]],
};
export function Blocks({ model = 'cluster', tones = [MINT, YEL, INK], size = 150, reverse = false, delay = 0 }) {
  const u = size / 150;
  const norm = (c) => ({ '#000': INK, '#fff': WHT }[c] || c);
  const pieces = MODELS[model](tones.map(norm));
  return (
    <div className="spin" style={{ '--box': `${size}px` }} aria-hidden="true">
      <div className="spin-stage" style={{ animationDirection: reverse ? 'reverse' : 'normal', animationDelay: `${-delay}s` }}>
        {pieces.map(([w, h, d, x, y, z, c, ry = 0], i) => (
          <div key={i} className="cube" style={{ '--w': `${w * u}px`, '--h': `${h * u}px`, '--d': `${d * u}px`, '--c': norm(c), transform: `translate3d(${x * u}px, ${y * u}px, ${z * u}px) rotateY(${ry}deg)` }}>
            {['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((f) => <i key={f} className={`face ${f}`} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

