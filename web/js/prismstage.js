// prismstage.js - the Prism Stage: a mountain of cut crystal. Two ranks of leaning hexagonal shards fall away from a
// sixty-unit centre to the far ends, a crystal gate stands over the booth, and a great faceted gem turns above it inside
// a ring of splinters that flies apart on the drop. Screens are cut stones too (octagon wall, shard wings). The rig is
// the Mainstage's, zone for zone and count for count, hidden on the shards. Original art: no real festival's design.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, LedPanel, ledShapeHalf, pathLine } from './fixtures.js';
import { Paint, place, facet, shade, facetJitter, makeShared, sculptMaterial, glowMaterial, driveShared, framedWall, deckLines, arcPoints, lcg, TAU } from './stagekit.js';

const HALF_W = 88, TOP = 60, SCREEN_Z = -10.5;
const ICE_LO = 0x07143a, ICE_MID = 0x2a7fe0, ICE_HI = 0xe4f7ff, VIO_LO = 0x170a40, VIO_HI = 0xc9b8ff, FROST = 0xa9c4dc, NIGHT = 0x0a1024;
const GEM = { x: 0, y: 47, z: -11, r: 6 };

// a hexagonal crystal standing on the origin: tapered body, pointed tip, one flat face toward the crowd
function shardGeo(h, r, lo, hi, seed, pow = 1.5) {
  const body = new THREE.CylinderGeometry(r * 0.78, r, h * 0.72, 6); body.translate(0, h * 0.36, 0);
  const tip = new THREE.ConeGeometry(r * 0.78, h * 0.28, 6); tip.translate(0, h * 0.86, 0);
  const g = mergeGeometries([body, tip]); body.dispose(); tip.dispose();
  g.rotateY(Math.PI / 6);
  return facetJitter(shade(facet(g), lo, hi, pow), 0.28, seed);
}
const radiusAt = (s, f) => s.r * (f < 0.72 ? 1 - 0.22 * f / 0.72 : 0.78 * (1 - (f - 0.72) / 0.28));
// a point on the crowd-facing face of a shard, f of the way up it
const onShard = (s, f, lift = 0.3) => V3(s.x - f * s.h * Math.sin(s.rz), s.y + f * s.h * Math.cos(s.rz), s.z + radiusAt(s, f) * 0.866 + lift);

export class PrismStage {
  constructor() { this.group = new THREE.Group(); this.group.name = 'prism-stage'; this.t = 0; this.spin = 0; this.spread = 0; }

  layout(b, kit, ZONE) {
    kit.xN = HALF_W; kit.hN = 58; kit.cam = { wide: 1.32, lookUp: 6, fwHigh: 22 };
    const rnd = lcg(20260921), P = new Paint(), TA = new Paint(), TB = new Paint();
    const plant = (s, lo, hi) => { P.add(shardGeo(s.h, s.r, lo, hi, s.x * 3.1 + s.z), null, s.x, s.y, s.z, 0, 0, s.rz); return s; };

    // ---- the back rank: 23 great shards, tallest behind the booth, leaning out toward the ends
    const back = [], mid = [];
    for (let i = -11; i <= 11; i++) {
      const x = i * 7.8 + (i ? (rnd() - 0.5) * 2.4 : 0), k = 1 - Math.abs(x) / HALF_W, h = Math.min(TOP, (20 + 40 * Math.pow(k, 1.25)) * (i % 2 ? 0.86 + 0.1 * rnd() : 1));
      back.push(plant({ x, y: 0, z: -15.5 - (i % 2 ? 2.2 : 0) - rnd(), h, r: 1.7 + h * 0.05, rz: -x / HALF_W * 0.5 + (rnd() - 0.5) * 0.06 }, ICE_LO, ICE_HI));
    }
    // ---- the middle rank: 16 violet shards in the gaps, leaning harder
    for (const side of [-1, 1]) [8, 18, 29, 40.5, 57, 66, 76, 85].forEach((ax, j) => {
      const x = side * ax, h = (14 + 22 * Math.pow(1 - ax / HALF_W, 1.1)) * (0.92 + 0.16 * rnd());
      mid.push(plant({ x, y: 0, z: (ax < 30 ? -15.2 : -12.6) - (j % 2) * 0.8, h, r: 1.2 + h * 0.05, rz: -x / HALF_W * 0.8 - side * 0.08 }, VIO_LO, VIO_HI));
    });
    // undergrowth: small splinters round the feet of the ranks (behind the screens, never in front of the deck)
    for (let i = 0; i < 70; i++) {
      const x = (rnd() * 2 - 1) * HALF_W, h = 2.5 + rnd() * 6.5, s = { x, y: 0, z: -11.5 - rnd() * 7, h, r: 0.5 + h * 0.09, rz: -x / HALF_W * 0.6 + (rnd() - 0.5) * 0.9 };
      if (Math.abs(x) > 29 || s.z < -13) plant(s, rnd() < 0.5 ? ICE_LO : VIO_LO, ICE_HI);
    }
    // ---- the gate over the booth: two pillars and a lintel, the gem floating above it
    const pillars = [-1, 1].map(side => plant({ x: side * 25.5, y: 0, z: -9, h: 42, r: 2.3, rz: 0 }, ICE_LO, ICE_HI));
    const lintel = facetJitter(shade(facet(new THREE.CylinderGeometry(1.15, 1.15, 56, 6)), ICE_MID, ICE_HI, 1), 0.3, 5);
    P.add(lintel, null, 0, 38.6, -9.2, 0, 0, Math.PI / 2);
    // the rig towers and the far posts
    const towers = [-1, 1].map(side => plant({ x: side * 51.6, y: 0, z: -7.2, h: 37, r: 2.0, rz: 0 }, ICE_LO, ICE_HI));
    const posts = [-1, 1].map(side => plant({ x: side * 74, y: 0, z: -4.6, h: 27, r: 1.6, rz: 0 }, VIO_LO, VIO_HI));
    // glowing tips
    for (const s of back) { const q = onShard(s, 1, 0); TA.add(new THREE.OctahedronGeometry(0.55), 0xffffff, q.x, q.y + 0.3, s.z); }
    for (const s of mid.concat(pillars, towers, posts)) { const q = onShard(s, 1, 0); TB.add(new THREE.OctahedronGeometry(0.45), 0xffffff, q.x, q.y + 0.3, s.z); }
    kit.topFlames = [[-51.6, 37.6, -7.2], [51.6, 37.6, -7.2]];

    // ---- LED walls: cut stones in frost-steel settings
    const wall = (...a) => framedWall(b, P, LedPanel, FROST, ...a);
    wall(160, 84, 46, 24, { role: 'main', name: 'main', shape: 'octa' }, 0, 14, SCREEN_Z, 0, ZONE.frame, 3, 60);
    wall(168, 14, 30, 2.6, { role: 'ribbon', name: 'ribbon', shape: 'octa', gain: 1.1 }, 0, 29.6, -9.6, 0, ZONE.frame, 4, 40);
    b.panel(new LedPanel(72, 16, 9, 2.1, { gain: 1.0, role: 'booth', name: 'booth' }), 0, 4.5, 0.52);
    for (const side of [-1, 1]) {
      wall(56, 84, 14, 21, { role: 'wing', name: 'wing' + side, shape: 'shard' }, side * 35, 14.5, -8, -side * 0.3, ZONE.frame, side < 0 ? 2 : 5, 36);
      wall(44, 66, 11, 16.5, { role: 'wing', name: 'wingo' + side, shape: 'shard' }, side * 62, 11.5, -5, -side * 0.45, ZONE.frame, side < 0 ? 0 : 7, 30);
      wall(20, 88, 5, 22, { role: 'tower', name: 'tower' + side, shape: 'shard', gain: 1.0 }, side * 48.5, 16, -2.5, -side * 0.25, ZONE.frame, side < 0 ? 1 : 6, 30);
      for (const [x, z, h] of [[35, -8.2, 4.2], [62, -5.2, 3.4], [48.5, -2.7, 5.2]]) P.add(shardGeo(h + 1.5, 1.1, NIGHT, ICE_MID, x), null, side * x, 0, z);
    }

    // ---- pixel architecture: a spine of light up every shard, icicles under the lintel
    const spine = (s, n, f0 = 0.04, f1 = 0.98) => { const pts = []; for (let i = 0; i < n; i++) pts.push(onShard(s, f0 + (f1 - f0) * i / (n - 1))); return pts; };
    back.forEach((s, i) => b.strip('shard', spine(s, Math.round(s.h * 0.95)), 0.36, ZONE.arch, (i + 11) % 8));
    mid.forEach((s, i) => b.strip('splinter', spine(s, Math.round(s.h * 0.95)), 0.3, ZONE.truss, i % 8));
    pillars.forEach((s, i) => b.strip('pillar', spine(s, 40), 0.3, ZONE.col, i ? 5 : 2));
    towers.forEach((s, i) => b.strip('spire', spine(s, 34), 0.3, ZONE.tower, i ? 6 : 1));
    posts.forEach((s, i) => b.strip('spire', spine(s, 26), 0.3, ZONE.tower, i ? 7 : 0));
    b.strip('lintel', pathLine(V3(-27, 38.6, -8), V3(27, 38.6, -8), 61), 0.3, ZONE.truss, 3);
    for (let i = 0; i < 15; i++) {
      const x = -24.5 + i * 3.5, L = 3 + 3.2 * Math.abs(Math.sin(i * 2.3)) ;
      if (Math.abs(x) < 1) continue;
      b.strip('icicle', pathLine(V3(x, 37.3, -9.2), V3(x, 37.3 - L, -9.2), Math.round(L * 2.2)), 0.3, ZONE.drop, i % 8);
      P.add(shardGeo(L + 0.6, 0.42, ICE_HI, ICE_MID, i), null, x, 37.6, -9.6, 0, 0, Math.PI);
    }
    deckLines(b, ZONE, V3, pathLine);

    // ---- moving heads: the Mainstage's zones and counts, carried by the crystal
    const head = b.head, on = (s, f, ...rest) => { const q = onShard(s, f, 0.7); head(q.x, q.y, q.z, ...rest); };
    const outer = back.filter((_, i) => Math.abs(i - 11) > 1);                       // 20 shards: the centre three stand behind the gem
    for (const s of outer) for (const f of [0.72, 0.97]) on(s, f, 0);
    for (const s of mid) for (const f of [0.62, 0.96]) on(s, f, 1);
    for (const q of arcPoints(V3, GEM.x, GEM.y, -9.4, 10.2, -125, 125, 22)) head(q.x, q.y, q.z, 2);
    for (let i = 0; i < 12; i++) head(-13.75 + i * 2.5, 31.5, -9.3, 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) head(side * 51.6, 4 + i * 2.9, -4.9, 3, true);
      for (let i = 0; i < 6; i++) head(side * 25.5, 4 + i * 3.6, -6.5, 4, true);
      for (const yn of [0.14, 0.36, 0.58, 0.76]) for (const e of [-1, 1]) { const q = place(V3(e * (ledShapeHalf('shard', yn) * 7 + 0.9), (yn - 0.5) * 21, 0), side * 35, 14.5, -8, -side * 0.3, 0.5); head(q.x, q.y, q.z, 7, true); }
      for (let i = 0; i < 4; i++) head(side * 74, 6 + i * 4.2, -2.8, 9);
    }
    for (let i = 0; i < 18; i++) head(-25.5 + i * 3, 2.4, -9.2, 5, true);
    for (let i = 0; i < 13; i++) head(-27 + i * 4.5, 2.4, 5.6, 6, true);
    for (const e of [-1, 1]) for (let i = 0; i < 8; i++) { const yn = 0.5 + 0.48 * i / 7; head(e * (ledShapeHalf('octa', yn) * 23 + 1.2), 2 + yn * 24, -10, 8); }

    // ---- strobes and blinders
    const st = b.strobe; let k = 0;
    for (const s of mid.concat(pillars)) for (const f of [0.32, 0.5]) { const q = onShard(s, f, 0.5); st(q.x, q.y, q.z, 'front', k++, { u: (q.x / HALF_W + 1) / 2 }); }
    k = 0;
    for (const s of back) for (const f of [0.42, 0.58]) { const q = onShard(s, f, 0.5); st(q.x, q.y, q.z, 'back', k++, { u: (q.x / HALF_W + 1) / 2 }); }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 13; i++) st(side * 44.4, 5 + i * 2, -5.5, 'tower', i, { u: i / 12, rot: new THREE.Euler(0, -side * 0.4, 0) });
      for (const y of [2.6, 26.4]) st(side * 35, y, -7.4, 'blinder', 0, { w: 2, h: 1.2, warm: true });
      for (const x of [20, 38]) st(side * x, 3.6, 5.2, 'blinder', 0, { w: 2, h: 1.2, warm: true });
    }
    for (const x of [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5]) st(x, 27.4, -9.4, 'blinder', 0, { w: 2.4, h: 1.2, warm: true });
    for (let i = 0; i < 37; i++) st(-27 + i * 1.5, 2.9, 5.25, 'deck', i, { w: 0.9, h: 0.35, u: i / 36 });

    // ---- lasers: 16 projectors, as on the Mainstage
    const laser = b.laser;
    for (let i = 0; i < 4; i++) laser(-12 + i * 8, 31.7, -9.1, 5, { pitch: -0.05 }, 0);
    laser(-25.5, 42.4, -8.6, 5, { pitch: -0.08 }, 1); laser(0, 40, -8.4, 5, { pitch: -0.12 }, 1); laser(25.5, 42.4, -8.6, 5, { pitch: -0.08 }, 1);
    for (const side of [-1, 1]) {
      laser(side * 51.6, 35, -5.2, 5, { yaw: -side * 0.4 }, 2);
      laser(side * 35, 26.6, -7.3, 4, { yaw: -side * 0.2, pitch: 0.05 }, 3);
    }
    for (const x of [-12, 12]) laser(x, 2.6, -9.5, 5, { pitch: 0.35 }, 4);
    for (const x of [-17, 0, 17]) laser(x, 26.8, -10, 6, { mode: 'cone', pitch: 0.1, spread: 0.5 }, 5);

    // ---- a scatter of low crystals at the far ends, level with the towers
    for (const side of [-1, 1]) for (const ax of [56, 60, 67, 70, 80, 84, 89]) {
      const h = 2.5 + rnd() * 4.5; plant({ x: side * ax, y: 0, z: -1.2 - rnd() * 2.5, h, r: 0.45 + h * 0.1, rz: (rnd() - 0.5) * 0.7 }, rnd() < 0.5 ? VIO_LO : ICE_LO, ICE_HI);
    }

    this.shared = makeShared();
    this.group.add(new THREE.Mesh(P.merged(), sculptMaterial(this.shared, { H: TOP, W: HALF_W, warm: [0.5, 0.78, 1.0] })));
    this.tintA = glowMaterial(); this.tintB = glowMaterial();
    this.group.add(new THREE.Mesh(TA.merged(), this.tintA), new THREE.Mesh(TB.merged(), this.tintB));
    this._buildGem();
    this.group.traverse(o => { o.frustumCulled = false; });
  }

  // the gem: a cut stone that turns over the gate, lit from inside, in a ring of splinters
  _buildGem() {
    const cut = (geo, seed) => { const g = facet(geo); shade(g, 0x3050c8, 0xffffff, 1.3); return facetJitter(g, 0.6, seed); };
    const stone = new THREE.OctahedronGeometry(GEM.r, 1); stone.scale(1, 1.3, 1);
    this.gemMat = glowMaterial();
    this.gem = new THREE.Mesh(cut(stone, 3), this.gemMat); this.gem.position.set(GEM.x, GEM.y, GEM.z);
    this.group.add(this.gem);
    const sp = new THREE.OctahedronGeometry(0.62, 0); sp.scale(0.6, 1.9, 0.6);
    this.ringMat = glowMaterial();
    this.ring = new THREE.InstancedMesh(cut(sp, 8), this.ringMat, 30);
    this.ring.position.copy(this.gem.position); this.ring.rotation.set(0.38, 0, 0.2);
    this.group.add(this.ring);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  update(show, dt) {
    this.t += dt;
    const { hot, calm } = driveShared(this.shared, show, dt, this.t), kick = show.kick ?? 0, beat = show.beatPulse ?? 0;
    this.spin += dt * (calm ? 0.12 : hot ? 0.9 : 0.35);
    this.spread += ((hot ? 1 : calm ? 0 : 0.35) - this.spread) * Math.min(1, dt * (hot ? 6 : 1.5));
    this.gem.rotation.y = this.spin; this.gem.position.y = GEM.y + 0.5 * Math.sin(this.t * 0.7);
    this.gem.scale.setScalar(1 + 0.06 * kick);
    this.gemMat.color.copy(show.colorA).lerp(this._c.setRGB(1, 1, 1), 0.1 + 0.35 * kick).multiplyScalar((calm ? 0.3 : 0.42) + 1.1 * kick + (hot ? 0.35 : 0));
    this.ringMat.color.copy(show.colorB).lerp(this._c.setRGB(1, 1, 1), 0.25).multiplyScalar(0.7 + 1.1 * beat);
    this.tintA.color.copy(show.colorA).multiplyScalar(1 + 1.6 * beat); this.tintB.color.copy(show.colorB).multiplyScalar(0.9 + 1.4 * kick);
    const R = 9.2 + 6.5 * this.spread, n = this.ring.count;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + this.spin * 0.6, w = Math.sin(i * 2.4 + this.t * 1.3) * (0.5 + 1.6 * this.spread);
      this._e.set(a * 2 + this.t, a, 0.6); this._q.setFromEuler(this._e);
      this.ring.setMatrixAt(i, this._m.compose(this._v.set(Math.sin(a) * R, w, Math.cos(a) * R * 0.55), this._q, this._s));
    }
    this.ring.instanceMatrix.needsUpdate = true;
    this.ring.position.y = this.gem.position.y;
  }
}
