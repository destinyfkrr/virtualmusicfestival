// orbitstage.js - the Orbit Stage: a brass observatory under the night. The main wall is a great disc in a brass ring;
// behind it stand two upright hoops with a graduated scale, and inside them an armillary sphere whose three rings turn
// against each other with planets riding on them. Ringed planets on pylons step down and away to either side. The rig
// is the Mainstage's, zone for zone and count for count, hung on the hoops. Original art: no real festival's design.
import * as THREE from 'three';
import { V3, LedPanel, ledShapeHalf, pathLine } from './fixtures.js';
import { Paint, place, makeShared, sculptMaterial, glowMaterial, driveShared, framedWall, deckLines, arcPoints, lcg, DEG, TAU } from './stagekit.js';

const HALF_W = 88, SCREEN_Z = -10.5;
const BRASS = 0xc9953f, BRASS_DK = 0x6b4a1c, COPPER = 0xb5623a, NAVY = 0x0c1430, NAVY_HI = 0x1d2c5e, IVORY = 0xefe3c6, TEAL = 0x2fb7b0;
const HUB = { x: 0, y: 28, z: -16 }, R_IN = 27, R_OUT = 34;
const WORLDS = [[35, 7, 34, -9.5, 0.35, COPPER], [55, 5, 27, -7, -0.3, TEAL], [72, 3.5, 20, -4.5, 0.4, IVORY], [86, 2.5, 14, -2.5, -0.25, COPPER]];   // |x|, r, y, z, ring tilt, colour

// a hoop standing in the xy plane
const hoop = (R, tube, arc = TAU, seg = 96) => { const g = new THREE.TorusGeometry(R, tube, 8, seg, arc); return g; };

export class OrbitStage {
  constructor() { this.group = new THREE.Group(); this.group.name = 'orbit-stage'; this.t = 0; this.rate = 0.3; this.rings = []; }

  layout(b, kit, ZONE) {
    kit.xN = HALF_W; kit.hN = 66; kit.cam = { wide: 1.32, lookUp: 6, fwHigh: 22 };
    kit.topFlames = [[-51.6, 37.4, -6], [51.6, 37.4, -6]];
    const rnd = lcg(4711), P = new Paint(), TA = new Paint(), TB = new Paint();

    // ---- the two great hoops, upright behind the wall, on a stepped plinth
    for (const [R, tube, col, z] of [[R_OUT, 1.0, BRASS, HUB.z - 1.2], [R_IN, 0.75, COPPER, HUB.z + 0.8]]) {
      const g = hoop(R, tube, 250 * DEG); g.rotateZ(-35 * DEG);                       // open at the bottom, behind the deck
      P.add(g, col, HUB.x, HUB.y, z);
    }
    // the graduated scale between them: a tick every 5 degrees, a long one every 30
    for (let d = -125; d <= 125; d += 5) {
      const a = d * DEG, long = d % 30 === 0, L = long ? R_OUT - R_IN - 1.6 : 2.6, rm = long ? (R_IN + R_OUT) / 2 : R_OUT - 2.4;
      P.add(new THREE.BoxGeometry(long ? 0.5 : 0.28, L, 0.3), long ? IVORY : BRASS_DK, HUB.x + Math.sin(a) * rm, HUB.y + Math.cos(a) * rm, HUB.z - 0.2, 0, 0, -a);
      if (long) TA.add(new THREE.OctahedronGeometry(0.6), 0xffffff, HUB.x + Math.sin(a) * (R_OUT + 1.9), HUB.y + Math.cos(a) * (R_OUT + 1.9), HUB.z - 1.2);
    }
    // the finial at the crown, and the plinth the hoops stand in
    P.lathe([[0, 0], [1.4, 0.3], [0.6, 1.1], [1.5, 2.1], [0.4, 3.3], [0.15, 5.2], [0, 5.6]], 0, HUB.y + R_OUT + 0.6, HUB.z - 1.2, BRASS, 12);
    TA.add(new THREE.OctahedronGeometry(1.1), 0xffffff, 0, HUB.y + R_OUT + 6.9, HUB.z - 1.2);
    for (const side of [-1, 1]) for (const [w, h, x] of [[14, 5, 27], [9, 9, 29.5], [5, 12, 31.5]]) P.box(w, h, 5, side * x, h / 2, HUB.z, NAVY_HI);

    // ---- a starfield wall behind everything: navy blades fanned like the leaves of an iris diaphragm
    for (let i = -14; i <= 14; i++) {
      const a = i * 6.4 * DEG, L = 50 + 6 * (i % 2 ? 1 : 0), g = new THREE.BoxGeometry(5.4, L, 0.4); g.translate(0, L / 2, 0);
      P.add(g, i % 2 ? NAVY : NAVY_HI, Math.sin(a) * 8, 2 + Math.cos(a) * 2, HUB.z - 24 - (i % 2 ? 0.5 : 0), 0, 0, -a * 1.05);
    }
    for (let i = 0; i < 120; i++) {
      const a = (rnd() * 2 - 1) * 88 * DEG, r = 12 + rnd() * 40; if (Math.cos(a) * r + 3 < 3) continue;
      TB.add(new THREE.OctahedronGeometry(0.16 + rnd() * 0.2), 0xffffff, Math.sin(a) * r * 1.05, 3 + Math.cos(a) * r, HUB.z - 23.4);
    }

    // ---- the side worlds: ringed planets on pylons, stepping down and away
    const worldStrips = [];
    for (const side of [-1, 1]) WORLDS.forEach(([ax, r, y, z, tilt, col], j) => {
      const x = side * ax;
      P.lathe([[r * 0.34, 0], [r * 0.2, y * 0.2], [r * 0.12, y * 0.7], [r * 0.2, y - r * 0.9], [r * 0.5, y - r * 0.72]], x, 0, z, BRASS_DK, 10);
      P.ball(r, x, y, z, NAVY_HI, 20);
      for (let m = -2; m <= 2; m++) { const rr = r * Math.cos(m * 0.42) * 1.012, g = new THREE.TorusGeometry(rr, r * 0.035, 5, 40); g.rotateX(Math.PI / 2); P.add(g, m ? BRASS_DK : col, x, y + r * Math.sin(m * 0.42), z); }
      const ring = new THREE.RingGeometry(r * 1.35, r * 1.95, 48); ring.rotateX(-Math.PI / 2 + 0.22);
      P.add(ring, col, x, y, z, 0, 0, side * tilt);
      const under = new THREE.RingGeometry(r * 1.35, r * 1.95, 48); under.rotateX(Math.PI / 2 + 0.22); P.add(under, BRASS_DK, x, y - 0.02, z, 0, 0, side * tilt);
      // pixels round the rim of the planet's ring
      const pts = [], n = Math.round(r * 13), e = new THREE.Euler(0.22, 0, side * tilt), R = r * 2.02;
      for (let i = 0; i <= n; i++) { const a = i / n * TAU; pts.push(V3(Math.cos(a) * R, 0, Math.sin(a) * R).applyEuler(e).add(V3(x, y, z))); }
      worldStrips.push({ pts, j, side });
    });
    worldStrips.forEach(({ pts, j, side }) => b.strip('world', pts, 0.3, j < 2 ? ZONE.tower : ZONE.col, (side < 0 ? 3 - j : 4 + j)));

    // ---- LED walls: discs in brass rings
    const wall = (...a) => framedWall(b, P, LedPanel, BRASS, ...a);
    wall(160, 84, 46, 25, { role: 'main', name: 'main', shape: 'disc' }, 0, 14.5, SCREEN_Z, 0, ZONE.frame, 3, 64);
    wall(168, 14, 30, 2.6, { role: 'ribbon', name: 'ribbon', shape: 'pill', gain: 1.1 }, 0, 30, -9.6, 0, ZONE.frame, 4, 40);
    b.panel(new LedPanel(72, 16, 9, 2.1, { gain: 1.0, role: 'booth', name: 'booth' }), 0, 4.5, 0.52);
    for (const side of [-1, 1]) {
      wall(56, 84, 14, 21, { role: 'wing', name: 'wing' + side, shape: 'disc' }, side * 35, 14.5, -8, -side * 0.3, ZONE.frame, side < 0 ? 2 : 5, 36);
      wall(44, 66, 11, 16.5, { role: 'wing', name: 'wingo' + side, shape: 'disc' }, side * 62, 11.5, -5, -side * 0.45, ZONE.frame, side < 0 ? 0 : 7, 30);
      wall(20, 88, 5, 22, { role: 'tower', name: 'tower' + side, shape: 'pill', gain: 1.0 }, side * 48.5, 16, -2.5, -side * 0.25, ZONE.frame, side < 0 ? 1 : 6, 30);
      for (const [x, z, h, w] of [[35, -8.2, 4.2, 5], [62, -5.2, 3.4, 4], [48.5, -2.7, 5.2, 3]]) P.lathe([[w * 0.5, 0], [w * 0.3, h * 0.5], [w * 0.42, h]], side * x, 0, z, BRASS_DK, 10);
      // the rig masts: fluted brass columns with a lantern on top
      for (const [x, z, h] of [[51.6, -6, 36], [74, -3.6, 25], [25.5, -7.4, 27]]) {
        P.lathe([[1.5, 0], [1.0, 1.2], [0.62, 2.4], [0.5, h - 2], [1.0, h - 1], [0.4, h]], side * x, 0, z, x === 74 ? COPPER : BRASS, 10);
        TB.add(new THREE.OctahedronGeometry(0.8), 0xffffff, side * x, h + 0.9, z);
      }
    }

    // ---- pixel architecture: both hoops, the long ticks, the crown spokes
    const halfArc = (R, z, s, n) => arcPoints(V3, HUB.x, HUB.y, z, R, s * 2, s * 124, n);
    for (const s of [-1, 1]) {
      b.strip('hoop', halfArc(R_OUT, HUB.z - 0.1, s, 160), 0.4, ZONE.arch, s < 0 ? 2 : 5);
      b.strip('hoop', halfArc(R_IN, HUB.z + 1.7, s, 126), 0.36, ZONE.truss, s < 0 ? 1 : 6);
    }
    let ti = 0;
    for (let d = -120; d <= 120; d += 30) { const a = d * DEG, p0 = V3(Math.sin(a) * (R_IN + 1.4), HUB.y + Math.cos(a) * (R_IN + 1.4), HUB.z + 0.2), p1 = V3(Math.sin(a) * (R_OUT - 1.4), HUB.y + Math.cos(a) * (R_OUT - 1.4), HUB.z + 0.2); b.strip('tick', pathLine(p0, p1, 12), 0.32, ZONE.drop, ti++ % 8); }
    for (const side of [-1, 1]) {
      b.strip('mast', pathLine(V3(side * 51.6, 2.6, -5.3), V3(side * 51.6, 34, -5.3), 44), 0.3, ZONE.tower, side < 0 ? 1 : 6);
      b.strip('mast', pathLine(V3(side * 74, 2.6, -2.9), V3(side * 74, 23, -2.9), 28), 0.3, ZONE.tower, side < 0 ? 0 : 7);
      b.strip('mast', pathLine(V3(side * 25.5, 2.6, -6.8), V3(side * 25.5, 25, -6.8), 30), 0.3, ZONE.col, side < 0 ? 2 : 5);
    }
    deckLines(b, ZONE, V3, pathLine);

    // ---- moving heads
    const head = b.head;
    for (const s of [-1, 1]) {
      for (const q of arcPoints(V3, HUB.x, HUB.y, HUB.z + 0.4, R_OUT + 1.6, s * 8, s * 122, 20)) head(q.x, q.y, q.z, 0);
      for (const q of arcPoints(V3, HUB.x, HUB.y, HUB.z + 2.2, R_IN - 1.5, s * 10, s * 118, 16)) head(q.x, q.y, q.z, 1);
    }
    for (let i = 0; i < 22; i++) { const a = (-130 + 260 * i / 21) * DEG; head(Math.sin(a) * 24.4, 14.5 + Math.cos(a) * 13.9 + 17, -9.2, 2); }   // an ellipse echoing the wall, up among the armillary
    for (let i = 0; i < 12; i++) head(-13.75 + i * 2.5, 31.9, -9.3, 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) head(side * 51.6, 4 + i * 2.9, -4.9, 3, true);
      for (let i = 0; i < 6; i++) head(side * 25.5, 4 + i * 3.6, -6.3, 4, true);
      for (const yn of [0.14, 0.36, 0.64, 0.86]) for (const e of [-1, 1]) { const q = place(V3(e * (ledShapeHalf('disc', yn) * 7 + 0.9), (yn - 0.5) * 21, 0), side * 35, 14.5, -8, -side * 0.3, 0.5); head(q.x, q.y, q.z, 7, true); }
      for (let i = 0; i < 4; i++) head(side * 74, 6 + i * 4.2, -2.6, 9);
    }
    for (let i = 0; i < 18; i++) head(-25.5 + i * 3, 2.4, -9.2, 5, true);
    for (let i = 0; i < 13; i++) head(-27 + i * 4.5, 2.4, 5.6, 6, true);
    for (const e of [-1, 1]) for (let i = 0; i < 8; i++) { const yn = 0.5 + 0.47 * i / 7; head(e * (ledShapeHalf('disc', yn) * 23 + 1.3), 2 + yn * 25, -10, 8); }

    // ---- strobes and blinders
    const st = b.strobe; let k = 0;
    for (const s of [-1, 1]) for (const q of arcPoints(V3, HUB.x, HUB.y, HUB.z + 2.0, R_IN + 1.3, s * 6, s * 120, 20)) st(q.x, q.y, q.z, 'front', k++, { u: (q.x / HALF_W + 1) / 2 });
    k = 0;
    for (const s of [-1, 1]) for (const q of arcPoints(V3, HUB.x, HUB.y, HUB.z + 0.2, R_OUT - 1.5, s * 4, s * 122, 23)) st(q.x, q.y, q.z, 'back', k++, { u: (q.x / HALF_W + 1) / 2 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 13; i++) st(side * 44.4, 5 + i * 2, -5.5, 'tower', i, { u: i / 12, rot: new THREE.Euler(0, -side * 0.4, 0) });
      for (const y of [2.6, 26.4]) st(side * 35, y, -7.4, 'blinder', 0, { w: 2, h: 1.2, warm: true });
      for (const x of [20, 38]) st(side * x, 3.6, 5.2, 'blinder', 0, { w: 2, h: 1.2, warm: true });
    }
    for (const x of [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5]) st(x, 27.9, -9.4, 'blinder', 0, { w: 2.4, h: 1.2, warm: true });
    for (let i = 0; i < 37; i++) st(-27 + i * 1.5, 2.9, 5.25, 'deck', i, { w: 0.9, h: 0.35, u: i / 36 });

    // ---- lasers: 16 projectors
    const laser = b.laser;
    for (let i = 0; i < 4; i++) laser(-12 + i * 8, 32.1, -9.1, 5, { pitch: -0.05 }, 0);
    laser(-25.5, 28.4, -7, 5, { pitch: -0.08 }, 1); laser(0, HUB.y + R_OUT + 1.6, HUB.z, 5, { pitch: -0.12 }, 1); laser(25.5, 28.4, -7, 5, { pitch: -0.08 }, 1);
    for (const side of [-1, 1]) {
      laser(side * 51.6, 35, -5, 5, { yaw: -side * 0.4 }, 2);
      laser(side * 35, 26.6, -7.3, 4, { yaw: -side * 0.2, pitch: 0.05 }, 3);
    }
    for (const x of [-12, 12]) laser(x, 2.6, -9.5, 5, { pitch: 0.35 }, 4);
    for (const x of [-17, 0, 17]) laser(x, 27.2 - Math.abs(x) * 0.12, -10, 6, { mode: 'cone', pitch: 0.1, spread: 0.5 }, 5);

    this.shared = makeShared();
    this.metal = sculptMaterial(this.shared, { H: HUB.y + R_OUT, W: HALF_W, warm: [1.0, 0.74, 0.4] });
    this.group.add(new THREE.Mesh(P.merged(), this.metal));
    this.tintA = glowMaterial(); this.tintB = glowMaterial();
    this.group.add(new THREE.Mesh(TA.merged(), this.tintA), new THREE.Mesh(TB.merged(), this.tintB));
    this._buildArmillary();
    this.group.traverse(o => { o.frustumCulled = false; });
  }

  // three rings turning against each other round a small sun, each carrying a planet
  _buildArmillary() {
    this.core = new THREE.Group(); this.core.position.set(HUB.x, 45, -24.5); this.group.add(this.core);
    this.sunMat = glowMaterial();
    const sun = new Paint(); sun.add(new THREE.IcosahedronGeometry(2.6, 1), 0xffffff);
    this.sun = new THREE.Mesh(sun.merged(), this.sunMat); this.core.add(this.sun);
    this.moonMat = glowMaterial();
    const spec = [[13.5, 0.42, BRASS, 1.0, [1, 0.15, 0.1]], [11, 0.36, COPPER, -1.4, [0.2, 1, 0.3]], [8.5, 0.3, IVORY, 2.0, [0.5, 0.2, 1]]];
    for (const [R, tube, col, speed, axis] of spec) {
      const Pn = new Paint(), g = new THREE.Group();
      Pn.add(hoop(R, tube), col);
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; Pn.add(new THREE.BoxGeometry(0.22, i % 6 ? 0.9 : 1.8, tube * 2.6), BRASS_DK, Math.sin(a) * R, Math.cos(a) * R, 0, 0, 0, -a); }
      g.add(new THREE.Mesh(Pn.merged(), this.metal));
      const Mn = new Paint(); Mn.add(new THREE.IcosahedronGeometry(R * 0.075, 1), 0xffffff, R, 0, 0);
      g.add(new THREE.Mesh(Mn.merged(), this.moonMat));
      g.rotation.set(rndTilt(R), rndTilt(R + 3), 0);
      this.core.add(g);
      this.rings.push({ g, speed, axis: new THREE.Vector3(...axis).normalize() });
    }
    this._c = new THREE.Color();
  }

  update(show, dt) {
    this.t += dt;
    const { hot, calm } = driveShared(this.shared, show, dt, this.t), kick = show.kick ?? 0, beat = show.beatPulse ?? 0;
    this.rate += ((calm ? 0.1 : hot ? 1.5 : 0.4) - this.rate) * Math.min(1, dt * 1.5);
    for (const r of this.rings) r.g.rotateOnAxis(r.axis, r.speed * this.rate * dt);
    this.sun.rotation.y += dt * 0.4; this.sun.scale.setScalar(1 + 0.18 * kick);
    this.sunMat.color.copy(show.colorA).lerp(this._c.setRGB(1, 0.85, 0.6), 0.4).multiplyScalar((calm ? 0.6 : 0.9) + 1.5 * kick + (hot ? 0.5 : 0));
    this.moonMat.color.copy(show.colorB).lerp(this._c.setRGB(1, 1, 1), 0.2).multiplyScalar(0.9 + 1.2 * beat);
    this.tintA.color.copy(show.colorA).multiplyScalar(1 + 1.6 * beat);
    this.tintB.color.copy(show.colorB).lerp(this._c.setRGB(1, 1, 1), 0.5).multiplyScalar(0.5 + 0.5 * Math.sin(this.t * 0.8) ** 2 + 1.2 * kick);
  }
}
const rndTilt = s => Math.sin(s * 12.9898) * 1.1;
