import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Scroll-driven 3D "sats in a bottle" scene (inspired by the product-render + scroll choreography
 * on dayos.com): a glass bottle on a concrete block, wrapped in a black ₿ label.
 *   progress 0 .00-.18  bottle turns in, the wrap hugs its body
 *            .18-.42    the wrap slides up and tightens around the neck
 *            .42-.62    a rolled message drops in through the neck
 *            .50-.70    sats (coins) fall in and settle
 *            .70-.86    cork presses in
 *            .86-1.0    sealed: camera pulls back, block rises
 *   open 0→1           (reveal) cork pops, message rises, sats spiral out, wrap drops off
 */
const INK = 0x000000, MINT = 0xd1ffca, YELLOW = 0xfff100, CANVAS = 0xe5e5e5;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function drawBitcoin(ctx, cx, cy, r, fg, bg) {
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.lineWidth = r * 0.14; ctx.lineCap = 'round';
  const w = r * 0.5, h = r * 0.9, x = cx - w * 0.55, y = cy - h / 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke();               // spine
  for (const [yy, ww] of [[y, w], [cy, w * 1.1], [y + h, w]]) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + ww, yy); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(x + w, y + h * 0.25, h * 0.25, -Math.PI / 2, Math.PI / 2); ctx.stroke(); // upper bowl
  ctx.beginPath(); ctx.arc(x + w * 1.1, y + h * 0.75, h * 0.25, -Math.PI / 2, Math.PI / 2); ctx.stroke(); // lower bowl
  for (const dx of [-0.18, 0.12]) { ctx.beginPath(); ctx.moveTo(x + w * (0.7 + dx), y - h * 0.16); ctx.lineTo(x + w * (0.7 + dx), y); ctx.moveTo(x + w * (0.7 + dx), y + h); ctx.lineTo(x + w * (0.7 + dx), y + h * 1.16); ctx.stroke(); }
}

function wrapTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#d1ffca'; g.fillRect(0, 0, c.width, 26); g.fillRect(0, c.height - 26, c.width, 26);
  g.fillStyle = '#fff'; g.font = '400 92px "JetBrains Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
  g.fillText('SATS IN A BOTTLE · SEALED · SATS IN A BOTTLE ·', 40, 150);
  g.fillStyle = '#979797'; g.font = '400 40px "JetBrains Mono", ui-monospace, monospace';
  g.fillText('0.00000001 BTC = 1 SAT   ·   OPEN WHEN THE TIME IS RIGHT   ·   0.00000001 BTC = 1 SAT', 40, 250);
  for (let i = 0; i < 4; i++) drawBitcoin(g, 256 + i * 512, 380, 72, '#000', i % 2 ? '#fff100' : '#fff');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping;
  return t;
}
function coinTexture(bg) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#000'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  drawBitcoin(g, 128, 128, 80, '#000', bg);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function concreteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#6f6f6f'; g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 46; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, Math.random() * 3 + 0.5, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function paperTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbf7'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#8a8a8a'; g.lineWidth = 3;
  for (let y = 40; y < 230; y += 26) { g.beginPath(); g.moveTo(24, y); g.lineTo(150 + Math.random() * 80, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function bottleGeometry() {
  const pts = [[0, 0.02], [0.52, 0.0], [0.72, 0.1], [0.8, 0.34], [0.8, 2.0], [0.77, 2.45], [0.6, 2.95], [0.36, 3.38], [0.285, 3.62], [0.285, 4.1], [0.33, 4.14], [0.345, 4.26], [0.3, 4.34], [0.24, 4.3]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const curve = new THREE.SplineCurve(pts).getPoints(140);
  return new THREE.LatheGeometry(curve, 72);
}

export function createBottleScene(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  // Phones: lighter rendering (lower pixel ratio, no transmission pass) so it stays smooth on mobile GPUs.
  const lite = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.setClearColor(CANVAS, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 8, 6); scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbdbdbd, 0.25));

  const root = new THREE.Group(); scene.add(root);
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // --- concrete block + coloured cubes (nod to the tactile render style)
  const ctex = track(concreteTexture());
  const concrete = track(new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.95, metalness: 0 }));
  const block = new THREE.Mesh(track(new THREE.BoxGeometry(3.4, 0.7, 3.4)), concrete); block.position.y = -0.36; root.add(block);
  const mkCube = (s, color, x, z, y = 0.0) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(s, s, s)), track(new THREE.MeshStandardMaterial({ color, roughness: 0.55 })));
    m.position.set(x, y + s / 2, z); m.rotation.y = x * 0.7; block.add(m); m.position.y = 0.35 + s / 2; return m;
  };
  mkCube(0.3, MINT, 1.25, 1.2); mkCube(0.3, YELLOW, -1.25, 1.2);
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return track(new THREE.CanvasTexture(c)); })();
  const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 2.6)), track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; root.add(shadow);

  // --- bottle
  const bottle = new THREE.Group(); root.add(bottle);
  const glassLite = new THREE.MeshPhysicalMaterial({ color: 0x8fdba7, roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.5, envMapIntensity: 0.7, clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide });
  const glass = track(lite ? glassLite : new THREE.MeshPhysicalMaterial({
    color: 0xdff7e6, roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.7, ior: 1.46,
    attenuationColor: new THREE.Color(0x8fdba7), attenuationDistance: 3.4, specularIntensity: 1, envMapIntensity: 1.0, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.03,
  }));
  const body = new THREE.Mesh(track(bottleGeometry()), glass); bottle.add(body);

  const wrapTex = track(wrapTexture());
  const wrapMat = track(new THREE.MeshStandardMaterial({ map: wrapTex, roughness: 0.55, side: THREE.DoubleSide }));
  const wrap = new THREE.Mesh(track(new THREE.CylinderGeometry(0.812, 0.812, 1.05, 96, 1, true)), wrapMat); bottle.add(wrap);

  const corkMat = track(new THREE.MeshStandardMaterial({ color: 0xb98b5a, roughness: 0.9 }));
  const cork = new THREE.Mesh(track(new THREE.CylinderGeometry(0.262, 0.222, 0.78, 32)), corkMat); bottle.add(cork);

  const paperMat = track(new THREE.MeshStandardMaterial({ map: track(paperTexture()), roughness: 0.8, side: THREE.DoubleSide }));
  const paper = new THREE.Mesh(track(new THREE.CylinderGeometry(0.13, 0.13, 1.25, 24, 1, false)), paperMat); bottle.add(paper);
  const ribbon = new THREE.Mesh(track(new THREE.CylinderGeometry(0.136, 0.136, 0.12, 24)), track(new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 }))); paper.add(ribbon);

  const coinGeo = track(new THREE.CylinderGeometry(0.17, 0.17, 0.045, 32));
  const coinMats = [track(new THREE.MeshStandardMaterial({ map: track(coinTexture('#fff100')), roughness: 0.4, metalness: 0.15 })),
    track(new THREE.MeshStandardMaterial({ map: track(coinTexture('#ffffff')), roughness: 0.4, metalness: 0.1 }))];
  const edge = track(new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
  const coins = Array.from({ length: 10 }, (_, i) => {
    const m = new THREE.Mesh(coinGeo, [edge, coinMats[i % 2], coinMats[i % 2]]);
    const a = (i / 10) * Math.PI * 2;
    m.userData = { a, orbitR: 1.95 + (i % 2) * 0.25, orbitY: 0.7 + i * 0.36, speed: 0.3,
      restX: Math.cos(a * 2.3) * 0.38, restZ: Math.sin(a * 2.3) * 0.38, restY: 0.07 + Math.floor(i / 4) * 0.055, tilt: (i % 5) * 0.4 };
    root.add(m); return m;
  });

  // --- sparks (burst when the cork goes in, bigger burst when it pops) + a flash at the neck
  const N = 140, sparkPos = new Float32Array(N * 3), sparkVel = [], sparkCol = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, up = 0.4 + Math.random() * 0.9, sp = 1.2 + Math.random() * 3.2;
    sparkVel.push([Math.cos(a) * sp, up * sp * 1.4, Math.sin(a) * sp]);
    const c = new THREE.Color([0xfff100, 0xffffff, 0xd1ffca][i % 3]); sparkCol.set([c.r, c.g, c.b], i * 3);
  }
  const sparkGeo = track(new THREE.BufferGeometry());
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = track(new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.frustumCulled = false; root.add(sparks);
  const flash = new THREE.PointLight(0xd1ffca, 0, 14, 1.6); root.add(flash);
  function updateSparks(tt, scale) {
    sparks.visible = tt > 0 && tt < 1;
    if (!sparks.visible) return;
    for (let i = 0; i < N; i++) {
      const v = sparkVel[i];
      sparkPos[i * 3] = v[0] * tt * scale; sparkPos[i * 3 + 1] = 4.4 + (v[1] * tt - 4.2 * tt * tt) * scale; sparkPos[i * 3 + 2] = v[2] * tt * scale;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = 1 - tt * tt;
  }

  // --- state
  const S = { target: 0, p: 0, open: 0, openTarget: 0, mx: 0, my: 0, tmx: 0, tmy: 0, w: 1, h: 1, running: false, visible: true, t0: performance.now() };
  const layout = { offsetX: 0, scale: 1, zoom: 1, lift: 0 };

  function resize() {
    const r = canvas.getBoundingClientRect();
    S.w = Math.max(1, r.width); S.h = Math.max(1, r.height);
    renderer.setSize(S.w, S.h, false);
    camera.aspect = S.w / S.h; camera.updateProjectionMatrix();
    layout.scale = S.w < 640 ? 0.78 : 1;
    layout.zoom = canvas.dataset.zoom ? Number(canvas.dataset.zoom) : 1;
    // data-offset is a fraction of the half-width of the view (0.5 = the right edge)
    const halfW = 15.5 * layout.zoom * Math.tan((28 / 2) * Math.PI / 180) * camera.aspect;
    layout.offsetX = (canvas.dataset.offset ? Number(canvas.dataset.offset) : 0) * halfW;
    layout.lift = canvas.dataset.lift ? Number(canvas.dataset.lift) : 0;
  }

  function frame(now) {
    const t = (now - S.t0) / 1000;
    const dt = Math.min(0.1, Math.max(0.001, (now - (S.last || now)) / 1000)); S.last = now;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 9); // time-based, so slow frames don't make it lag
    S.p += (S.target - S.p) * k; S.open += (S.openTarget - S.open) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 6));
    S.mx += (S.tmx - S.mx) * 0.06; S.my += (S.tmy - S.my) * 0.06;
    const p = S.p, o = S.open;

    // stage phases
    const turn = seg(p, 0, 0.18), wrapT = seg(p, 0.18, 0.42), paperT = seg(p, 0.42, 0.62), coinT = seg(p, 0.5, 0.7), corkT = seg(p, 0.7, 0.86), endT = seg(p, 0.86, 1);

    root.position.x = layout.offsetX; root.scale.setScalar(layout.scale * lerp(1, 0.94, endT));
    root.position.y = lerp(-0.25, 0, endT) - 2.3 - layout.lift;
    bottle.rotation.y = (reducedMotion ? 0.5 : p * Math.PI * 3.4 + t * 0.15) + S.mx * 0.5 + o * 1.2;
    bottle.rotation.z = Math.sin(t * 0.6) * 0.012 + S.mx * 0.03;
    block.position.y = lerp(-1.1, -0.36, seg(p, 0, 0.12));
    bottle.position.y = block.position.y + 0.35; // always standing on the block
    shadow.position.y = bottle.position.y + 0.02;
    block.rotation.y = lerp(0.5, 0, seg(p, 0, 0.3)) + p * 0.2;

    // wrap: body -> neck ring, then (on open) drops away
    const wy = lerp(1.25, 3.5, wrapT), ws = lerp(1, 0.4, wrapT), wh = lerp(1, 0.62, wrapT);
    wrap.position.y = wy - o * 1.2;
    wrap.scale.set(ws + o * 1.6, wh, ws + o * 1.6);
    wrap.rotation.y = wrapT * 5 - o * 3 + t * (0.05 + o * 1.5);
    wrapMat.opacity = 1 - o * 0.9; wrapMat.transparent = o > 0.01;
    wrap.visible = o < 0.97;

    // paper roll falls in through the neck, rises out on open
    paper.visible = paperT > 0.001 || o > 0;
    const py = lerp(6.3, 1.45, paperT) + o * 4.4;
    paper.position.set(Math.sin(t) * 0.01, py, 0);
    paper.rotation.set(0, t * 1.5 * (1 - paperT * 0.6), paperT > 0.9 ? 0.0 : 0);
    paper.rotation.z = lerp(0, Math.PI / 2 - 0.3, seg(p, 0.56, 0.64)) * (1 - o);
    if (paperT >= 0.999) paper.position.y = lerp(1.45, 0.42, seg(p, 0.56, 0.64)) + o * 4.4;

    // coins: orbit -> pour in -> rest -> spiral out on open
    coins.forEach((c) => {
      const d = c.userData, a = d.a + t * d.speed * (1 - coinT) * 1.0 + coinT * 2;
      const ox = Math.cos(a) * d.orbitR, oz = Math.sin(a) * d.orbitR, oy = d.orbitY + Math.sin(t * 1.2 + d.a * 3) * 0.05;
      const drop = Math.max(0, (coinT - (d.a / 18)) / (1 - d.a / 18));
      const dz = clamp(drop);
      // path: orbit -> above neck (0, 5.2) -> rest in the bottle
      const mid = clamp(dz * 2), fall = clamp(dz * 2 - 1);
      let x = lerp(ox, 0, mid), z = lerp(oz, 0, mid), y = lerp(oy, 5.2, mid);
      x = lerp(x, d.restX, fall); z = lerp(z, d.restZ, fall); y = lerp(y, d.restY + 0.1, fall);
      // spiral out on open
      const sp = o * 4.2, sa = d.a * 2 + o * 6 + t * 0.3;
      x += Math.cos(sa) * sp * 0.5 * d.speed * 4 * o; z += Math.sin(sa) * sp * 0.5 * d.speed * 4 * o; y += sp * (0.8 + d.speed);
      c.position.set(x, y + bottle.position.y, z);
      c.rotation.set(lerp(Math.PI / 2 + d.tilt + t * 1.2, d.tilt * 0.12, fall), 0, d.a + t * 0.5 * (1 - fall));
      c.visible = o < 0.98 || y < 12;
    });

    // cork presses in; on open it pops
    const cy = lerp(6.6, 4.18, corkT);
    cork.visible = corkT > 0.001 || o > 0;
    cork.position.y = cy + o * 5.5;
    cork.rotation.set(o * 5, 0, o * 2.5);
    cork.position.x = o * 1.2;

    camera.position.set(S.mx * 0.9, 1.9 + S.my * -0.4 + lerp(0, 0.8, endT), (lerp(15.5, 17.5, endT) + (1 - turn) * 1.5) * layout.zoom);
    camera.lookAt(0, -0.25 + endT * 0.3, 0);
    // drama: sparks + flash at the seal, a bigger burst + camera kick when the cork pops
    const sealT = seg(p, 0.84, 0.97);
    const burstT = o > 0.02 ? clamp(o * 1.15) : (p > 0.84 ? sealT : 0);
    updateSparks(o > 0.02 ? burstT : sealT > 0 && sealT < 1 ? sealT : 0, o > 0.02 ? 1.5 : 0.7);
    flash.position.set(0, 4.4, 0);
    flash.intensity = 60 * Math.max(Math.sin(clamp(sealT) * Math.PI) * (o > 0.02 ? 0 : 1), Math.sin(clamp(o) * Math.PI) * 1.4);
    camera.fov = 28 - 2.5 * Math.sin(clamp(o) * Math.PI); camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  let raf = 0;
  const loop = (now) => { raf = 0; if (S.running && S.visible) { frame(now); raf = requestAnimationFrame(loop); } };
  const start = () => { S.running = true; if (!raf) raf = requestAnimationFrame(loop); };
  const io = new IntersectionObserver(([e]) => { S.visible = e.isIntersecting; if (S.visible && S.running && !raf) raf = requestAnimationFrame(loop); });
  io.observe(canvas);
  const onMove = (e) => { S.tmx = (e.clientX / window.innerWidth - 0.5) * 2; S.tmy = (e.clientY / window.innerHeight - 0.5) * 2; };
  if (!reducedMotion) window.addEventListener('pointermove', onMove, { passive: true });
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (S.running && !raf) raf = requestAnimationFrame(loop); };
  document.addEventListener('visibilitychange', onVis);
  resize(); start();

  return {
    setProgress(v) { S.target = clamp(v); },
    jumpTo(v) { S.target = S.p = clamp(v); },
    setOpen(v) { S.openTarget = clamp(v); },
    jumpOpen(v) { S.openTarget = S.open = clamp(v); },
    canvas,
    dispose() {
      S.running = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
      disposables.forEach((d) => d.dispose?.()); envRT.dispose(); pmrem.dispose(); renderer.dispose();
    },
  };
}
