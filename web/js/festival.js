// Festival grounds — everything around the main stage so the arena reads as a real festival site:
//   (no sky dome: the sky is the pure black scene background plus the stars built in stage.js, nothing else)
//   Landscape    hills + treeline silhouettes + lit trees framing the arena
//   FerrisWheel  rotating wheel with its own pixel rim/spokes (rainbow chase, beat flashes)
//   DropTower    drop-tower ride: rises during builds, free-falls on the drop
//   Towers       crowd lighting towers, perimeter skytrackers
//   Wristbands   LED wristbands on half the crowd: waves, chases, kick flashes, drop whiteouts
//   Festoons     catenary bulb strings + bunting across the field
//   Gate         entrance arch at the back of the field with a VIRTUAL-FEST sign
//   Dressing     PA hangs, sub stacks, rails, stairs, DJ gear (human scale inside the big set), food stalls
// All of it is instanced or shader-driven; the per-frame CPU work is a few thousand colour writes.
import * as THREE from 'three';
import { V3, BEAM_GAIN, BeamArray, PixelStrips, pathLine, pathCircle } from './fixtures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _c2 = new THREE.Color();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const frac = (x) => x - Math.floor(x);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const halfW = (z) => 22 + z * 0.55;           // crowd field half width (matches Crowd)
const rand = (a, b) => a + Math.random() * (b - a);

function catenary(a, b, sag, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const u = n === 1 ? 0 : i / (n - 1); const p = a.clone().lerp(b, u); p.y -= 4 * u * (1 - u) * sag; out.push(p); }
  return out;
}
function textTexture(text, w = 1024, h = 192, fg = '#ffffff', bg = 'rgba(0,0,0,0)') {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.floor(h * 0.62)}px Inter, "SF Pro Display", Helvetica, Arial, sans-serif`;
  ctx.fillText(text, w / 2, h / 2 + h * 0.03);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- landscape
export class Landscape {
  constructor() {
    this.group = new THREE.Group();
    const silMat = new THREE.MeshBasicMaterial({ color: 0x030309 });
    const hills = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 10), silMat, 16);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand(-0.15, 0.15), r = rand(330, 420);
      const sx = rand(110, 220), sy = rand(26, 58), sz = rand(80, 140);
      _e.set(0, -a, 0); _q.setFromEuler(_e);
      _m.compose(_v.set(Math.cos(a) * r, -sy * 0.45, Math.sin(a) * r), _q, _s.set(sx, sy, sz));
      hills.setMatrixAt(i, _m);
    }
    this.group.add(hills);
    // far treeline ring
    const tree = new THREE.ConeGeometry(1, 1, 6); tree.translate(0, 0.5, 0);
    const far = new THREE.InstancedMesh(tree, silMat, 900);
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(215, 320), h = rand(9, 20);
      _m.compose(_v.set(Math.cos(a) * r, 0, Math.sin(a) * r), _q.identity(), _s.set(h * 0.32, h, h * 0.32));
      far.setMatrixAt(i, _m);
    }
    this.group.add(far);
    // lit trees framing the field (Lambert: picks up the wash lights near the stage)
    const near = new THREE.InstancedMesh(tree, new THREE.MeshLambertMaterial({ color: 0x0b1a0e }), 320);
    for (let i = 0; i < 320; i++) {
      let z = rand(-30, 150), side = i & 1 ? 1 : -1;
      let x = side * (halfW(Math.max(9, z)) + rand(14, 60)), h = rand(7, 15);
      if (Math.hypot(x + 108, z - 78) < 34 || Math.hypot(x - 112, z - 84) < 22) { z = rand(-30, 30); x = side * (halfW(Math.max(9, z)) + rand(14, 60)); }   // keep the rides clear of trees
      _m.compose(_v.set(x, 0, z), _q.identity(), _s.set(h * 0.3, h, h * 0.3));
      near.setMatrixAt(i, _m);
    }
    this.group.add(near);
    // trunks for the near trees are not needed at night; a low mist band hides the ground seam
    const mistMat = new THREE.MeshBasicMaterial({ color: 0x0a0a16, transparent: true, opacity: 0.35, depthWrite: false, fog: false });
    const mist = new THREE.Mesh(new THREE.CylinderGeometry(300, 300, 6, 48, 1, true), mistMat);
    mist.position.y = 2; this.group.add(mist);
  }
}

// ---------------------------------------------------------------- ferris wheel
export class FerrisWheel {
  constructor(pos, rotY = 0.5, radius = 24, spokes = 16) {
    this.group = new THREE.Group(); this.group.position.copy(pos); this.group.rotation.y = rotY;
    this.r = radius; this.n = spokes; this.hubY = radius + 5;
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    this.hub = new THREE.Group(); this.hub.position.y = this.hubY; this.group.add(this.hub);
    this.hub.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 0.4, 8, 72), truss));
    this.hub.add(new THREE.Mesh(new THREE.TorusGeometry(radius * 0.82, 0.25, 6, 64), truss));
    this.hub.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 16).rotateX(Math.PI / 2), truss));
    const spokeGeo = new THREE.CylinderGeometry(0.16, 0.16, radius, 6); spokeGeo.translate(0, radius / 2, 0);
    const spokeMesh = new THREE.InstancedMesh(spokeGeo, truss, spokes);
    for (let i = 0; i < spokes; i++) { _e.set(0, 0, (i / spokes) * Math.PI * 2); _q.setFromEuler(_e); _m.compose(_v.set(0, 0, 0), _q, _s.set(1, 1, 1)); spokeMesh.setMatrixAt(i, _m); }
    this.hub.add(spokeMesh);
    // A-frame legs (both sides of the wheel plane)
    const leg = (x, z) => { const L = Math.hypot(x, this.hubY, z); const g = new THREE.CylinderGeometry(0.35, 0.5, L, 8); const m = new THREE.Mesh(g, truss); m.position.set(x / 2, this.hubY / 2, z / 2); m.lookAt(0, this.hubY, 0); m.rotateX(Math.PI / 2); this.group.add(m); };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * radius * 0.75, sz * 3.5);
    this.group.add(new THREE.Mesh(new THREE.BoxGeometry(radius * 1.8, 1, 10), truss)).position.y = 0.5;
    // gondolas (kept upright each frame)
    this.gondMat = new THREE.MeshStandardMaterial({ color: 0x552244, roughness: 0.6, metalness: 0.2, emissive: 0x220011 });
    this.gond = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 1.8, 1.8), this.gondMat, spokes);
    this.group.add(this.gond);
    // pixels: rim, inner rim, spokes, hub ring
    this.px = new PixelStrips('sphere');
    const c = V3(0, 0, 0);
    this.rim = this.px.addStrip('rim', pathCircle(c, radius + 0.15, 180, 'xy').map(p => { p.z = 0.55; return p; }), 0.5);
    this.rim2 = this.px.addStrip('rim2', pathCircle(c, radius * 0.82, 120, 'xy').map(p => { p.z = -0.5; return p; }), 0.4);
    this.spk = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + Math.PI / 2;
      this.spk.push(this.px.addStrip('spoke', pathLine(V3(Math.cos(a) * 3, Math.sin(a) * 3, 0.4), V3(Math.cos(a) * (radius - 1), Math.sin(a) * (radius - 1), 0.4), 12), 0.36));
    }
    this.hubRing = this.px.addStrip('hub', pathCircle(c, 2.2, 24, 'xy').map(p => { p.z = 1.7; return p; }), 0.4);
    this.hub.add(this.px.build());
    this.rot = 0; this.flash = 0;
  }
  update(show, dt) {
    const ph = show.phase, hi = ph === 'drop' || ph === 'peak';
    this.rot += dt * (0.05 + 0.12 * show.energy + (hi ? 0.1 : 0));
    this.hub.rotation.z = this.rot;
    // upright gondolas
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * Math.PI * 2 + this.rot;
      _m.makeTranslation(Math.cos(a) * this.r, this.hubY + Math.sin(a) * this.r - 1.4, 0);
      this.gond.setMatrixAt(i, _m);
    }
    this.gond.instanceMatrix.needsUpdate = true;
    this.gondMat.emissive.copy(show.colorC).multiplyScalar(0.25 + 0.3 * show.beatPulse);
    // pixel patterns
    const px = this.px, A = show.colorA, B = show.colorB, C = show.colorC, t = show.t;
    if (show.beat && show.beatInBar === 0 && hi) this.flash = 1;
    this.flash *= Math.exp(-dt * 6);
    const g = show.active ? 1 : 0.35;
    const rimK = hi ? 1.2 : 0.8;
    for (let i = 0; i < this.rim.count; i++) {
      const u = i / this.rim.count;
      if (ph === 'breakdown' || ph === 'intro' || ph === 'idle') _c.setHSL(frac(u + t * 0.04), 0.9, 0.55);
      else { const k = frac(u * 12 - show.beatIndex * 0.25 - show.beatPhase * 0.25); _c.copy(k < 0.5 ? A : B); }
      _c.lerp(_c2.setRGB(1, 1, 1), this.flash * 0.9).multiplyScalar(rimK * g * (0.85 + 0.35 * show.beatPulse));
      px.setPixelC(this.rim.start + i, _c, 1);
    }
    for (let i = 0; i < this.rim2.count; i++) {
      const u = i / this.rim2.count;
      const k = frac(u * 6 + t * 0.2);
      _c.copy(k < 0.5 ? C : B).multiplyScalar(0.7 * g);
      px.setPixelC(this.rim2.start + i, _c, 1);
    }
    for (let s = 0; s < this.spk.length; s++) {
      const st = this.spk[s], odd = s & 1;
      for (let i = 0; i < st.count; i++) {
        const u = i / (st.count - 1);
        const chase = smooth(1 - Math.abs(frac(u - show.beatPhase) - 0.5) * 3);
        const k = hi ? 0.35 + 0.9 * chase : 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + u * 6 + s));
        _c.copy(odd ? A : C).multiplyScalar(k * g);
        px.setPixelC(st.start + i, _c, 1);
      }
    }
    for (let i = 0; i < this.hubRing.count; i++) { _c.setRGB(1, 1, 1).lerp(A, 0.5).multiplyScalar((0.6 + 0.8 * show.kick) * g); px.setPixelC(this.hubRing.start + i, _c, 1); }
    px.commit();
  }
}

// ---------------------------------------------------------------- drop tower ride
export class DropTower {
  constructor(pos, height = 58) {
    this.group = new THREE.Group(); this.group.position.copy(pos);
    this.h = height;
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, height, 12), truss); pole.position.y = height / 2; this.group.add(pole);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 2.5, 12), truss); cap.position.y = height + 1.2; this.group.add(cap);
    this.group.add(new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1.2, 16), truss)).position.y = 0.6;
    this.car = new THREE.Group(); this.group.add(this.car);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.car.add(new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.55, 8, 32).rotateX(Math.PI / 2), this.ringMat));
    const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.4, 0.9), new THREE.MeshStandardMaterial({ color: 0x1a1a22 }), 16);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; _e.set(0, -a, 0); _q.setFromEuler(_e); _m.compose(_v.set(Math.cos(a) * 3.6, -0.9, Math.sin(a) * 3.6), _q, _s.set(1, 1, 1)); seats.setMatrixAt(i, _m); }
    this.car.add(seats);
    this.px = new PixelStrips('sphere');
    this.poleStrips = [];
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; this.poleStrips.push(this.px.addStrip('pole', pathLine(V3(Math.cos(a) * 1.5, 2, Math.sin(a) * 1.5), V3(Math.cos(a) * 1.3, height - 1, Math.sin(a) * 1.3), 44), 0.36)); }
    this.capRing = this.px.addStrip('cap', pathCircle(V3(0, height + 2.6, 0), 3.1, 28, 'xz'), 0.4);
    this.group.add(this.px.build());
    this.y = 4; this.vy = 0; this.mode = 'idle'; this.lastPhase = ''; this.holdUntil = 0;
  }
  update(show, dt) {
    const ph = show.phase, t = show.t;
    if (ph !== this.lastPhase) {
      if (ph === 'drop' && (this.lastPhase === 'build' || this.y > 20)) { this.mode = 'fall'; this.vy = 0; }
      else if (ph === 'build') this.mode = 'rise';
      this.lastPhase = ph;
    }
    const top = this.h - 6;
    if (this.mode === 'rise') { const target = 4 + (top - 4) * clamp(show.buildProgress, 0, 1); this.y += (target - this.y) * Math.min(1, dt * 1.5); if (ph !== 'build') this.mode = 'hold', this.holdUntil = t + 12; }
    else if (this.mode === 'fall') { this.vy -= 22 * dt; this.y += this.vy * dt; if (this.y <= 4) { this.y = 4; this.vy = -this.vy * 0.25; if (Math.abs(this.vy) < 1.5) { this.mode = 'idle'; this.vy = 0; } } }
    else if (this.mode === 'hold') { if (t > this.holdUntil) this.mode = 'fall', this.vy = 0; }
    else { const target = 4 + (top - 4) * (0.5 + 0.5 * Math.sin(t * 0.09)); this.y += (target - this.y) * Math.min(1, dt * 0.4); }
    this.car.position.y = this.y;
    this.ringMat.color.copy(show.colorB).lerp(_c.setRGB(1, 1, 1), 0.4).multiplyScalar(this.mode === 'fall' ? 2.2 : 1.1 + 0.6 * show.beatPulse);
    // pole: lit up to the carriage, chase running the same way the car moves
    const A = show.colorA, C = show.colorC, g = show.active ? 1 : 0.4;
    const yn = (this.y - 2) / (this.h - 3);
    for (const st of this.poleStrips) for (let i = 0; i < st.count; i++) {
      const u = i / (st.count - 1);
      const lit = u < yn ? 1 : 0.12;
      const k = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(u * 30 - t * (this.mode === 'fall' ? 25 : 4)));
      _c.copy(u < yn ? A : C).multiplyScalar(lit * k * g);
      this.px.setPixelC(st.start + i, _c, 1);
    }
    for (let i = 0; i < this.capRing.count; i++) { _c.setRGB(1, 0.2, 0.2).multiplyScalar((0.5 + 0.5 * Math.sin(t * 3)) * 1.2); this.px.setPixelC(this.capRing.start + i, _c, 1); }
    this.px.commit();
  }
}

// ---------------------------------------------------------------- towers: crowd lighting towers, skytrackers
export class Towers {
  constructor(px) {
    this.group = new THREE.Group();
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.8, metalness: 0.3 });
    const box = (w, h, d, x, y, z, m = dark) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); this.group.add(mesh); return mesh; };
    const pole = (x0, y0, z0, x1, y1, z1, r = 0.16) => {
      const a = _v.set(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), L = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 6), truss);
      m.position.copy(a).lerp(b, 0.5); m.lookAt(b); m.rotateX(Math.PI / 2); this.group.add(m); return m;
    };
    const scaffold = (cx, cz, w, d, h) => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pole(cx + sx * w / 2, 0, cz + sz * d / 2, cx + sx * w / 2, h, cz + sz * d / 2, 0.14);
      for (let y = 3; y < h; y += 3) {
        pole(cx - w / 2, y, cz - d / 2, cx + w / 2, y, cz - d / 2, 0.06); pole(cx - w / 2, y, cz + d / 2, cx + w / 2, y, cz + d / 2, 0.06);
        pole(cx - w / 2, y, cz - d / 2, cx - w / 2, y, cz + d / 2, 0.06); pole(cx + w / 2, y, cz - d / 2, cx + w / 2, y, cz + d / 2, 0.06);
        pole(cx - w / 2, y, cz + d / 2, cx + w / 2, Math.min(h, y + 3), cz + d / 2, 0.05);
      }
    };
    this.heads = new BeamArray();
    this.sky = new BeamArray();
    // crowd lighting towers
    this.ctowers = [];
    for (const [x, z] of [[-57, 36], [57, 36], [-69, 82], [69, 82]]) {
      scaffold(x, z, 3.4, 3.4, 15);
      box(4.2, 0.35, 4.2, x, 15.2, z, truss);
      const ids = [];
      for (const ox of [-1.2, 0, 1.2]) ids.push(this.heads.add(V3(x + ox, 15.9, z), { kind: 'crowd', side: Math.sign(x) }));
      this.ctowers.push({ x, z, ids });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) px.addStrip('ctower', pathLine(V3(x + sx * 1.7, 0.5, z + sz * 1.7), V3(x + sx * 1.7, 15, z + sz * 1.7), 30), 0.3, { zone: 'ctower', x, z });
      for (const sx of [-1, 1]) px.addStrip('ctowerTop', pathLine(V3(x - 2.1, 15.4, z + sx * 2.1), V3(x + 2.1, 15.4, z + sx * 2.1), 9), 0.3, { zone: 'ctowerTop', x, z });
    }
    // perimeter skytrackers (big beams into the sky)
    this.skyIds = [];
    const spots = [[-140, -70], [140, -70], [-175, 40], [175, 40], [-125, 165], [125, 165]];
    spots.forEach(([x, z], i) => { box(3, 1.2, 3, x, 0.6, z, truss); this.skyIds.push(this.sky.add(V3(x, 1.5, z), { i })); });
    this.group.add(this.heads.build(), this.sky.build());
    for (let i = 0; i < this.sky.n; i++) { this.sky.len[i] = 2.6; this.sky.speed[i] = 1.2; }
    this.heads.setGain(BEAM_GAIN * 0.9); this.sky.setGain(BEAM_GAIN * 0.55);
    this.beamsK = 1;
  }
  setGain(k) { this.beamsK = k; this.heads.setGain(BEAM_GAIN * 0.9 * k); this.sky.setGain(BEAM_GAIN * 0.55 * k); }
  update(show, dt) {
    const ph = show.phase, hi = ph === 'drop' || ph === 'peak', t = show.t;
    const H = this.heads, S = this.sky;
    // crowd towers: slow crowd sweeps, kicked up in drops, dark in dips/breakdowns
    for (const tw of this.ctowers) {
      tw.ids.forEach((id, k) => {
        const a = t * (hi ? 0.9 : 0.35) + k * 2.1 + tw.x * 0.01;
        const tx = tw.x * 0.3 + Math.sin(a) * 30, tz = 40 + Math.cos(a * 0.7) * 30, ty = hi ? 6 + Math.sin(a * 1.3) * 5 : 22 + Math.sin(a * 0.5) * 10;
        H.setGoal(id, tx, ty, tz);
        const lvl = !show.active ? 0.15 : ph === 'breakdown' ? 0.12 : ph === 'intro' || ph === 'idle' ? 0.25 : ph === 'build' ? 0.3 + 0.5 * show.buildProgress : 0.75 + 0.35 * show.kick;
        H.inten[id] = lvl * (1 - 0.85 * (show.dip || 0));
        H.setColor(id, k === 1 ? show.colorB : show.colorA, 1);
        if (hi && show.strobe > 0.5) H.setRGB(id, 1, 1, 1);
      });
    }
    // skytrackers: crossing sky sweeps; white in intros, palette colours in drops
    for (const i of this.skyIds) {
      const o = i * 3, x = S.pos[o], z = S.pos[o + 2];
      const sp = hi ? 0.55 : 0.22, a = t * sp + i * 1.05;
      S.setGoal(i, x * 0.3 + Math.sin(a) * 70, 220, z * 0.3 + Math.cos(a * 0.8) * 70 - 20);
      const lvl = !show.active ? 0.3 : ph === 'breakdown' ? 0.45 : hi ? 0.9 + 0.3 * show.kick : ph === 'build' ? 0.5 + 0.5 * show.buildProgress : 0.55;
      S.inten[i] = lvl * (1 - 0.6 * (show.dip || 0));
      if (hi) S.setColor(i, i & 1 ? show.colorA : show.colorB, 1); else S.setRGB(i, 0.85, 0.9, 1);
    }
    H.update(dt, t); S.update(dt, t);
  }
}

// ---------------------------------------------------------------- LED wristbands
export class Wristbands {
  constructor(crowd, fraction = 0.5) {
    const n = Math.floor(crowd.count * fraction); this.n = n;
    const geo = new THREE.SphereGeometry(0.085, 5, 4);
    const rnd = new Float32Array(n * 3);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uT: crowd.uT, uJump: crowd.uJump, uBounce: crowd.uBounce, uBar: crowd.uBar, uWave: crowd.uWave });
      sh.vertexShader = `attribute vec3 aRnd; uniform float uT, uJump, uBounce, uBar, uWave;\n` + sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          float ph = aRnd.x;
          transformed.y += aRnd.y * uJump * uBounce * (0.4 + 0.6 * abs(sin(ph + uBar)));
          transformed.y += uWave * (0.5 + 0.5 * sin(uT * 2.0 + ph * 3.0)) * 0.7;
          transformed.x += sin(uT * 1.3 + ph) * 0.08;
        }`);
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.zn = new Float32Array(n); this.xn = new Float32Array(n); this.ph = new Float32Array(n); this.d = new Float32Array(n);
    const base = crowd.base, cr = crowd.rnd, scale = crowd.scale, bs = crowd.bodyScale ?? 1;
    for (let k = 0; k < n; k++) {
      const j = Math.floor(Math.random() * crowd.count);
      const x = base[j * 3], z = base[j * 3 + 2];
      rnd[k * 3] = cr[j * 3]; rnd[k * 3 + 1] = cr[j * 3 + 1]; rnd[k * 3 + 2] = Math.random();
      _m.compose(_v.set(x - 0.34 * bs, 1.35 * scale[j], z + 0.12 * bs), _q.identity(), _s.set(bs, bs, bs)); this.mesh.setMatrixAt(k, _m);
      this.zn[k] = clamp((z - 9) / 110, 0, 1); this.xn[k] = clamp(x / halfW(z), -1, 1); this.ph[k] = Math.random() * 6.28;
      this.d[k] = Math.hypot(x, z + 8) / 130;
    }
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 3));
    this.colors = this.mesh.instanceColor.array;
    this.flash = 0; this.mode = 'wave'; this.modeSince = 0;
  }
  update(show, dt) {
    const ph = show.phase, t = show.t, hi = ph === 'drop' || ph === 'peak';
    if (show.beat && show.kickOn && hi) this.flash = 1;
    this.flash *= Math.exp(-dt * 9);
    if (show.beat && show.beatInBar === 0 && show.barIndex % 8 === 0) { const modes = hi ? ['sides', 'radial', 'wave', 'rand'] : ['wave', 'radial', 'twinkle']; this.mode = modes[show.barIndex / 8 % modes.length | 0]; }
    const A = show.colorA, B = show.colorB, C = show.colorC, col = this.colors;
    const g = !show.active ? 0.12 : ph === 'idle' ? 0.35 : ph === 'intro' ? 0.6 : 1;
    const dip = 1 - 0.9 * (show.dip || 0);
    const fl = this.flash, wo = show.whiteout, mode = this.mode, bp = show.beatPhase, bar = show.barIndex;
    const speed = show.period ? 1 / (show.period * 4) : 0.5;
    for (let k = 0; k < this.n; k++) {
      const zn = this.zn[k], xn = this.xn[k], phk = this.ph[k], d = this.d[k];
      let r, gg, b, kk;
      if (mode === 'twinkle' || !hi && ph !== 'build') {
        const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + phk * 7);
        const w = smooth(1 - Math.abs(frac(zn * 2 - t * speed * 0.5) - 0.5) * 2.5);
        _c.copy(A).lerp(B, w); kk = 0.15 + 0.55 * tw * (0.5 + 0.5 * w);
      } else if (ph === 'build') {
        const w = smooth(1 - Math.abs(frac(zn * 3 + bp + bar) - 0.5) * 3);
        _c.copy(w > 0.5 ? A : C); kk = 0.25 + 0.75 * w * (0.4 + 0.6 * show.buildProgress);
      } else if (mode === 'sides') { _c.copy((xn < 0) === ((bar & 1) === 0) ? A : B); kk = 0.6 + 0.4 * show.beatPulse; }
      else if (mode === 'radial') { const w = smooth(1 - Math.abs(frac(d * 2.5 - bp - bar) - 0.5) * 3); _c.copy(w > 0.5 ? B : C); kk = 0.3 + 0.8 * w; }
      else if (mode === 'rand') { const on = Math.sin(phk * 13 + Math.floor(t * 8)) > 0.2; _c.copy(on ? A : C); kk = on ? 1 : 0.15; }
      else { const w = smooth(1 - Math.abs(frac(zn * 2 - bp * 0.5 - bar * 0.5) - 0.5) * 2.5); _c.copy(A).lerp(B, w); kk = 0.35 + 0.65 * w; }
      kk = kk * g * dip;
      r = _c.r * kk; gg = _c.g * kk; b = _c.b * kk;
      const f = Math.max(fl * 1.3, wo * 1.6);
      if (f > 0.01) { r += f; gg += f; b += f; }
      col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- festoons + bunting across the field
export class Festoons {
  constructor(px) {
    this.group = new THREE.Group();
    const spans = [
      [V3(-44, 29, 2), V3(-57, 15.2, 36), 5], [V3(44, 29, 2), V3(57, 15.2, 36), 5],
      [V3(-57, 15.2, 36), V3(-69, 15.2, 82), 4], [V3(57, 15.2, 36), V3(69, 15.2, 82), 4],
      [V3(-69, 15.2, 82), V3(69, 15.2, 82), 7],
      [V3(-57, 15.2, 38), V3(-30, 26, 126), 6], [V3(57, 15.2, 38), V3(30, 26, 126), 6],
      [V3(-69, 15.2, 84), V3(-30, 26, 128), 5], [V3(69, 15.2, 84), V3(30, 26, 128), 5],
    ];
    const linePts = [];
    this.bulbs = [];
    const buntPos = [];
    for (const [a, b, sag] of spans) {
      const L = a.distanceTo(b), n = Math.max(2, Math.round(L / 1.2));
      const pts = catenary(a, b, sag, n);
      for (let i = 0; i < n - 1; i++) linePts.push(pts[i], pts[i + 1]);
      const bulbPts = pts.filter((_, i) => i % 2 === 0).map(p => p.clone().add(_v.set(0, -0.35, 0)));
      this.bulbs.push(px.addStrip('festoon', bulbPts, 0.2, { zone: 'festoon' }));
      for (let i = 1; i < n - 1; i += 2) buntPos.push(pts[i]);
    }
    const lg = new THREE.BufferGeometry().setFromPoints(linePts);
    this.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x33333c })));
    // bunting triangles
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.4, 0, 0, 0.4, 0, 0, 0, -0.9, 0], 3));
    tri.computeVertexNormals();
    this.buntMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.bunt = new THREE.InstancedMesh(tri, this.buntMat, buntPos.length);
    this.bunt.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(buntPos.length * 3), 3);
    buntPos.forEach((p, i) => {
      _e.set(0, Math.random() * 6.28, 0); _q.setFromEuler(_e);
      _m.compose(p, _q, _s.set(0.55, 0.55, 1)); this.bunt.setMatrixAt(i, _m);
      _c.setHSL(Math.random(), 0.9, 0.55); this.bunt.setColorAt(i, _c);
    });
    this.bunt.frustumCulled = false;
    this.group.add(this.bunt);
  }
  update(show, px) {
    const ph = show.phase, hi = ph === 'drop' || ph === 'peak', t = show.t;
    const warm = _c2.setRGB(1.0, 0.72, 0.42);
    const k = !show.active ? 0.5 : ph === 'breakdown' || ph === 'intro' || ph === 'idle' ? 0.8 : ph === 'build' ? 0.6 - 0.35 * show.buildProgress : 0.22;
    const dip = 1 - 0.9 * (show.dip || 0);
    for (const st of this.bulbs) for (let i = 0; i < st.count; i++) {
      const tw = 0.85 + 0.15 * Math.sin(t * 3 + i * 1.7);
      if (hi) { const on = frac(i * 0.5 - show.beatIndex * 0.5) < 0.5; _c.copy(on ? show.colorA : show.colorB).multiplyScalar(0.5 + 0.5 * show.beatPulse); }
      else _c.copy(warm);
      px.setPixelC(st.start + i, _c, k * tw * dip);
    }
    this.buntMat.color.setRGB(1, 1, 1).multiplyScalar(clamp(0.35 + 0.5 * show.energy + 0.6 * show.whiteout, 0.3, 1.2));
  }
}

// ---------------------------------------------------------------- entrance gate
export class Gate {
  constructor(px, z = 128) {
    this.group = new THREE.Group();
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.8, metalness: 0.3 });
    for (const x of [-30, 30]) {
      const py = new THREE.Mesh(new THREE.BoxGeometry(4.5, 27, 4.5), truss); py.position.set(x, 13.5, z); this.group.add(py);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 6), dark); cap.position.set(x, 27.5, z); this.group.add(cap);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) px.addStrip('gatePylon', pathLine(V3(x + sx * 2.3, 0.5, z + sz * 2.3), V3(x + sx * 2.3, 27, z + sz * 2.3), 44), 0.34, { zone: 'gate' });
    }
    const arcPts = [];
    for (let i = 0; i <= 64; i++) { const u = i / 64, a = Math.PI * (1 - u); arcPts.push(V3(Math.cos(a) * 30, 27 + Math.sin(a) * 16, z)); }
    const curve = new THREE.CatmullRomCurve3(arcPts);
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.9, 8), truss));
    const inner = arcPts.map(p => V3(p.x * 0.93, 27 + (p.y - 27) * 0.9, z));
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(inner), 64, 0.5, 6), truss));
    const arcPx = []; for (let i = 0; i <= 150; i++) { const a = Math.PI * (1 - i / 150); arcPx.push(V3(Math.cos(a) * 30.4, 27 + Math.sin(a) * 16.4, z + 1.0)); }
    this.arc = px.addStrip('gateArc', arcPx, 0.5, { zone: 'gate' });
    const arcPx2 = arcPx.map(p => V3(p.x, p.y, z - 1.0));
    this.arc2 = px.addStrip('gateArc2', arcPx2, 0.5, { zone: 'gate' });
    // sign (readable from both sides)
    const tex = textTexture('VIRTUAL-FEST', 1024, 192);
    this.signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: 0xffffff });
    const board = new THREE.Mesh(new THREE.BoxGeometry(40, 8.5, 1.2), dark); board.position.set(0, 33, z); this.group.add(board);
    for (const s of [-1, 1]) { const sign = new THREE.Mesh(new THREE.PlaneGeometry(36, 6.8), this.signMat); sign.position.set(0, 33, z + s * 0.75); if (s < 0) sign.rotation.y = Math.PI; this.group.add(sign); }
    this.signPx = px.addStrip('gateSign', [...pathLine(V3(-20, 28.4, z + 0.9), V3(20, 28.4, z + 0.9), 40), ...pathLine(V3(-20, 37.6, z + 0.9), V3(20, 37.6, z + 0.9), 40), ...pathLine(V3(-20, 28.4, z - 0.9), V3(20, 28.4, z - 0.9), 40), ...pathLine(V3(-20, 37.6, z - 0.9), V3(20, 37.6, z - 0.9), 40)], 0.36, { zone: 'gate' });
    this.z = z;
  }
  update(show, px) {
    const t = show.t, ph = show.phase, hi = ph === 'drop' || ph === 'peak', g = show.active ? 1 : 0.5;
    const A = show.colorA, B = show.colorB;
    for (const st of [this.arc, this.arc2]) for (let i = 0; i < st.count; i++) {
      const u = i / (st.count - 1);
      const w = hi ? smooth(1 - Math.abs(frac(u * 4 - show.beatPhase) - 0.5) * 3) : 0.5 + 0.5 * Math.sin(u * 12 - t * 2);
      _c.copy(A).lerp(B, w).multiplyScalar((0.5 + 0.7 * w) * g);
      px.setPixelC(st.start + i, _c, 1);
    }
    for (let i = 0; i < this.signPx.count; i++) { const on = frac(i * 0.1 + t * 0.8) < 0.5; _c.copy(on ? A : B).lerp(_c2.setRGB(1, 1, 1), 0.3).multiplyScalar(0.9 * g); px.setPixelC(this.signPx.start + i, _c, 1); }
    this.signMat.color.setRGB(1, 1, 1).lerp(A, 0.35).multiplyScalar(1.1 + 0.5 * show.beatPulse * (hi ? 1 : 0.3));
  }
}

// ---------------------------------------------------------------- stage dressing + village
export class Dressing {
  constructor(mainMat, px, human = 0.5) {
    this.group = new THREE.Group();
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.8, metalness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x08080c, roughness: 0.9 });
    const box = (w, h, d, x, y, z, m = dark, ry = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.rotation.y = ry; this.group.add(mesh); return mesh; };
    // PA: line-array hangs under the front truss + ground subs
    const pa = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.55, 1.1), black, 2 * 14 + 2 * 12);
    let pi = 0;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 14; k++) { const tilt = k * 0.04; _e.set(tilt, side * 0.35, 0); _q.setFromEuler(_e); _m.compose(_v.set(side * 25.5, 23.6 - k * 0.6 - k * k * 0.012, 7.2 + k * 0.05), _q, _s.set(1, 1, 1)); pa.setMatrixAt(pi++, _m); }
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { _m.compose(_v.set(side * (29 + c * 1.6), 0.6 + r * 1.1, 8.2), _q.identity(), _s.set(1, 2, 1.4)); pa.setMatrixAt(pi++, _m); }
      // hang bumper + chains
      box(1.8, 0.3, 1.4, side * 25.5, 24.1, 7.2, truss);
      // side stairs
      for (let k = 0; k < 12; k++) box(3, 0.19, 0.6, side * (30 + k * 0.45), 0.095 + k * 0.19, 7.5, dark);
    }
    this.group.add(pa);
    // deck rails (leaving the runway gap) + skirt
    for (const side of [-1, 1]) {
      const rail = (y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 20, 6).rotateZ(Math.PI / 2), truss); m.position.set(side * 18, y, 5.3); this.group.add(m); };
      rail(2.5); rail(2.8);
      for (let x = 8; x <= 28; x += 2) box(0.08, 0.6, 0.08, side * x, 2.5, 5.3, truss);
    }
    box(56, 0.3, 0.5, 0, 0.15, 5.4, black);
    // DJ gear on the riser, sized in metres times `human` (the crowd's body scale, 1/WORLD_SCALE) so the table, players
    // and wedges stay human size on a set built several times life size
    const RY = 5.6, ZG = -1.3, h = human, screenMat = new THREE.MeshBasicMaterial({ color: 0x334455, toneMapped: false });
    box(5.2 * h, 0.9 * h, 1.5 * h, 0, RY + 0.45 * h, ZG, black);                                                   // plinth
    for (const x of [-1.7 * h, 1.7 * h]) box(0.9 * h, 0.16 * h, 0.7 * h, x, RY + 0.98 * h, ZG, dark);              // CDJs
    box(1.1 * h, 0.14 * h, 0.7 * h, 0, RY + 0.97 * h, ZG, dark);                                                   // mixer
    box(0.9 * h, 0.56 * h, 0.06 * h, 0, RY + 1.44 * h, ZG - 0.6 * h, screenMat);                                   // laptop screen
    this.jogs = [];
    for (const x of [-1.7 * h, 1.7 * h]) { const jog = new THREE.Mesh(new THREE.RingGeometry(0.14 * h, 0.24 * h, 24), new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false, side: THREE.DoubleSide })); jog.rotation.x = -Math.PI / 2; jog.position.set(x, RY + 1.07 * h, ZG + 0.1 * h); this.group.add(jog); this.jogs.push(jog); }
    this.mixerLeds = px.addStrip('mixer', pathLine(V3(-0.44 * h, RY + 1.06 * h, ZG - 0.06 * h), V3(0.44 * h, RY + 1.06 * h, ZG - 0.06 * h), 10), 0.06 * h, { zone: 'mixer' });
    for (const x of [-3.2 * h, 3.2 * h]) box(1.2 * h, 0.8 * h, 1.0 * h, x, RY + 0.4 * h, ZG + 1.4 * h, black, x < 0 ? 0.5 : -0.5);   // monitor wedges
    box(6 * h, 0.06 * h, 2.8 * h, 0, RY + 0.03 * h, ZG + 0.2 * h, new THREE.MeshBasicMaterial({ color: 0x101018 }));   // riser mat
    // food / merch village along both sides of the field
    const nStalls = 26;
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 2.6, 4), dark, nStalls);
    const roofGeo = new THREE.ConeGeometry(4.2, 2.4, 4); roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), nStalls);
    roof.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nStalls * 3), 3);
    this.stallLight = new THREE.InstancedMesh(new THREE.BoxGeometry(4.6, 0.22, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), nStalls);
    this.stallLight.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nStalls * 3), 3);
    for (let i = 0; i < nStalls; i++) {
      const side = i & 1 ? 1 : -1, z = 20 + Math.floor(i / 2) * 8.2, x = side * (halfW(z) + 9);
      _e.set(0, side * Math.PI / 2, 0); _q.setFromEuler(_e);
      _m.compose(_v.set(x, 1.3, z), _q, _s.set(1, 1, 1)); body.setMatrixAt(i, _m);
      _m.compose(_v.set(x, 3.8, z), _q, _s.set(1, 1, 1)); roof.setMatrixAt(i, _m);
      _c.setHSL(Math.random(), 0.7, 0.45); roof.setColorAt(i, _c);
      _m.compose(_v.set(x - side * 2.05, 2.5, z), _q, _s.set(1, 1, 1)); this.stallLight.setMatrixAt(i, _m);
      const warm = Math.random() < 0.7; _c.setRGB(warm ? 1.6 : 0.9, warm ? 1.1 : 1.3, warm ? 0.6 : 1.6); this.stallLight.setColorAt(i, _c);
    }
    this.group.add(body, roof, this.stallLight);
    // portaloos + fence lines behind the village (tiny but they sell the site)
    const loo = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 1.15, 0.55), new THREE.MeshLambertMaterial({ color: 0x1c3a5a }), 40);
    for (let i = 0; i < 40; i++) { const side = i < 20 ? -1 : 1, z = 40 + (i % 20) * 0.65, x = side * (halfW(z) + 16); _m.makeTranslation(x, 0.575, z); loo.setMatrixAt(i, _m); }
    this.group.add(loo);
    const fencePts = [];
    for (const side of [-1, 1]) for (let z = 14; z < 132; z += 2) { const x = side * (halfW(z) + 4); fencePts.push(V3(x, 0, z), V3(x, 1.2, z)); if (z + 2 < 132) fencePts.push(V3(x, 1.2, z), V3(side * (halfW(z + 2) + 4), 1.2, z + 2)); }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fencePts), new THREE.LineBasicMaterial({ color: 0x2a2a33 })));
  }
  update(show, px) {
    for (let k = 0; k < this.jogs.length; k++) this.jogs[k].material.color.copy(k ? show.colorB : show.colorA).multiplyScalar(0.8 + 1.5 * show.kick);
    for (let i = 0; i < this.mixerLeds.count; i++) { const lvl = show.levels ? show.levels[Math.min(7, i)] : 0.5; _c.setRGB(1, 0.3 + 0.7 * (1 - lvl), 0.2).multiplyScalar(0.3 + 1.2 * lvl); px.setPixelC(this.mixerLeds.start + i, _c, 1); }
  }
}

// ---------------------------------------------------------------- the whole site
// ---------------------------------------------------------------- ground glow (stage light spill on the field + lit entrance path)
export class GroundGlow {
  constructor() {
    const geo = new THREE.PlaneGeometry(460, 360, 1, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: new THREE.Color(0.4, 0.3, 0.9) }, uB: { value: new THREE.Color(0.9, 0.3, 0.5) }, uK: { value: 0.1 }, uT: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz / length(modelMatrix[0].xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,   // site-local xz (the mesh sits in the scaled site group)
      fragmentShader: /* glsl */`
        uniform vec3 uA, uB; uniform float uK, uT, uFlash; varying vec2 vP;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 p = vP;
          float n = hash(floor(p * 2.5)), n2 = hash(floor(p * 0.6));
          // stage spill: elliptical, wider in x, fading with distance from the deck front
          float d = length(vec2(p.x * 0.75, max(0.0, p.y - 4.0)));
          float spill = exp(-d * d * 0.00045) * (0.75 + 0.5 * n) * (0.8 + 0.4 * n2);
          vec3 col = mix(uA, uB, 0.5 + 0.5 * sin(p.x * 0.05 + uT * 0.4)) * spill * uK;
          col += vec3(1.0, 0.95, 0.9) * spill * uFlash;
          // lit entrance path beyond the gate
          float path = smoothstep(9.5, 6.5, abs(p.x)) * smoothstep(120.0, 126.0, p.y) * (1.0 - smoothstep(196.0, 206.0, p.y));
          col += vec3(1.0, 0.72, 0.42) * path * (0.10 + 0.05 * n);
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.set(0, 0.04, 96);
    this.mesh.renderOrder = -5;
  }
  update(show) {
    const u = this.mat.uniforms, hi = show.phase === 'drop' || show.phase === 'peak';
    u.uT.value = show.t;
    u.uA.value.copy(show.colorA); u.uB.value.copy(show.colorB);
    const base = show.active ? 0.06 + 0.16 * show.energy + (hi ? 0.08 * show.kick : 0) : 0.03;
    u.uK.value = base * (1 - 0.85 * (show.dip || 0));
    u.uFlash.value = 0.3 * show.whiteout;
  }
}

export class Festival {
  constructor(scene, crowd, mainMat) {
    this.scene = scene; this.crowd = crowd;
    this.px = new PixelStrips('sphere');
    this.land = new Landscape(); scene.add(this.land.group);
    this.wheel = new FerrisWheel(V3(-108, 0, 78), 0); scene.add(this.wheel.group);
    this.tower = new DropTower(V3(112, 0, 84)); scene.add(this.tower.group);
    this.towers = new Towers(this.px); scene.add(this.towers.group);
    this.bands = new Wristbands(crowd, 0.5); scene.add(this.bands.mesh);
    this.festoons = new Festoons(this.px); scene.add(this.festoons.group);
    this.gate = new Gate(this.px, 128); scene.add(this.gate.group);
    this.dress = new Dressing(mainMat, this.px, crowd.bodyScale ?? 1); scene.add(this.dress.group);
    this.ground = new GroundGlow(); scene.add(this.ground.mesh);
    // entrance path beyond the gate: bollard lights + lamp posts
    const bol = []; for (let z = 132; z <= 196; z += 6) for (const x of [-8.5, 8.5]) bol.push(V3(x, 0.8, z));
    this.pathPx = this.px.addStrip('path', bol, 0.45, { zone: 'path' });
    const lampPts = [-15, 15].flatMap(x => [142, 168, 194].map(z => V3(x, 7.6, z)));
    this.lampPx = this.px.addStrip('lamps', lampPts, 1.1, { zone: 'lamp' });
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 7.4, 6); poleGeo.translate(0, 3.7, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshBasicMaterial({ color: 0x1e1e26 }), lampPts.length);
    lampPts.forEach((p, i) => { _m.makeTranslation(p.x, 0, p.z); poles.setMatrixAt(i, _m); });
    scene.add(poles);
    scene.add(this.px.build());
    this.ctowerStrips = this.px.strips.filter(s => s.meta.zone === 'ctower' || s.meta.zone === 'ctowerTop');
    this.levels = null;
  }
  setGain(k) { this.towers.setGain(k); }
  update(show, dt, levels) {
    show.levels = levels;
    this.wheel.update(show, dt);
    this.tower.update(show, dt);
    this.towers.update(show, dt);
    this.bands.update(show, dt);
    this.festoons.update(show, this.px);
    this.gate.update(show, this.px);
    this.dress.update(show, this.px);
    this.ground.update(show);
    // entrance path: steady warm lighting (real site lighting does not chase)
    _c.setRGB(1, 0.72, 0.42).multiplyScalar(show.active ? 0.9 : 0.6);
    for (let i = 0; i < this.pathPx.count; i++) this.px.setPixelC(this.pathPx.start + i, _c, 1);
    _c.setRGB(1, 0.86, 0.62).multiplyScalar(show.active ? 1.3 : 0.9);
    for (let i = 0; i < this.lampPx.count; i++) this.px.setPixelC(this.lampPx.start + i, _c, 1);
    // crowd tower edge pixels: level meters from the spectrum, palette coloured
    const hi = show.phase === 'drop' || show.phase === 'peak', g = show.active ? 1 : 0.4;
    for (const st of this.ctowerStrips) {
      const lvl = levels ? levels[(Math.abs(st.meta.x) / 10 | 0) % 8] : show.energy;
      for (let i = 0; i < st.count; i++) {
        const u = st.count > 1 ? i / (st.count - 1) : 0;
        const on = st.meta.zone === 'ctowerTop' ? 1 : u < 0.15 + 0.85 * lvl ? 1 : 0.08;
        _c.copy(u > 0.8 ? show.colorC : show.colorA).multiplyScalar(on * (hi ? 0.9 + 0.5 * show.kick : 0.6) * g);
        this.px.setPixelC(st.start + i, _c, 1);
      }
    }
    this.px.commit();
  }
}
