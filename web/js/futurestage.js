// Future Stage: a stage of its own, not the Mainstage in costume. No truss anywhere. The set is one sculpture, 176 wide
// and 58 high: a sleeping golden oracle above the booth, wearing a sunburst that opens on the drop and folds away on the
// breakdown, in front of two fans of giant petals that sweep from the crown down to the ground at either end. The LED
// walls are shaped and set into the sculpture (a pointed arch under the face, a collar at her throat, leaf screens in
// the petals), the lights sit on the petals, around the halo and in the bud spires, and water runs at the far ends.
//
// Everything is authored in site units (front edge of the deck at z 5) and added to the kit's group inside stage.big.
// layout() places this stage's own walls, pixels, heads, strobes and lasers through the kit builder, using the same
// zones and groups as the Mainstage so every pattern, head set and laser cycle plays on it unchanged.
// Nothing here stands in the crowd or in the air in front of the stage: the water is outside the screens, behind the deck line.
//
// Cost: the sculpture is one merged vertex-coloured mesh (plus the face) with one Lambert shader patched for fake
// architectural lighting in the show colours, so it needs no lights of its own; the halo is one instanced draw, the
// water one shader mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, PixelStrips, LedPanel, ledShapeHalf, pathLine } from './fixtures.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();

// deterministic scatter so the stage is the same stage every visit
let _seed = 1;
const rnd = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };

const GOLD = 0xd9a436, GOLD_DK = 0x8a5f1c, GOLD_LT = 0xf3cf7a, INDIGO = 0x1c1670, TEAL = 0x10a39c, PLUM = 0x4a1a78, MAGENTA = 0xd42f7c, NIGHT = 0x0c0a24, STEM = 0x0d4a4c;

const ROOT_Y = 4, HALF_W = 88, TOP = 48;          // the petal fans: rooted behind the booth, 48 up, 88 out to each side
const FACE = { x: 0, y: 40, z: -10.5, s: 8.5 };   // the oracle's head (unit head scaled by s)
const SCREEN_Z = -10.5;

// how far a petal reaches at angle a from vertical: an ellipse, tall in the middle, long and low at the ends
const reach = a => 1 / Math.hypot(Math.cos(a) / TOP, Math.sin(a) / HALF_W);

// collects coloured geometry and merges it into one mesh (color null = the geometry brings its own vertex colours)
export class Paint {
  constructor() { this.geos = []; }
  add(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    g.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'color' && color === null)) g.deleteAttribute(k);
    if (color !== null) {
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      _c.set(color);
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.geos.push(g);
  }
  box(w, h, d, x, y, z, color, ry = 0) { this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, ry); }
  cyl(rTop, rBot, h, x, y0, z, color, seg = 16) { this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, x, y0 + h / 2, z); }
  ball(r, x, y, z, color, seg = 12) { this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), color, x, y, z); }
  lathe(profile, x, y0, z, color, seg = 18) { this.add(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(Math.max(0.001, p[0]), p[1])), seg), color, x, y0, z); }
  merged() { const g = mergeGeometries(this.geos, false); for (const s of this.geos) s.dispose(); this.geos.length = 0; return g; }
}

// ---- petals
// A petal in its own frame: root at the origin, growing up +y, cupped toward the crowd at its edges, tip curling forward.
function petalPoint(p, u, v, out) {
  const w = p.W * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85);
  return out.set(v * w, u * p.L, p.cup * v * v * (w / p.W) + p.bend * Math.pow(u, 2.5));
}
// the same point on the site: petals fan around the root, a = angle from vertical (positive toward +x)
function petalWorld(p, u, v, lift = 0) {
  const q = petalPoint(p, u, v, new THREE.Vector3()), c = Math.cos(p.a), s = Math.sin(p.a);
  return V3(q.x * c + q.y * s, ROOT_Y + q.y * c - q.x * s, p.z + q.z + lift);
}
function petalGeo(p, base, tip, rim) {
  const NU = 18, NV = 8, pos = [], col = [], idx = [], cb = new THREE.Color(base), ct = new THREE.Color(tip), cr = new THREE.Color(rim), c = new THREE.Color(), q = new THREE.Vector3();
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    const u = i / NU, v = j / NV * 2 - 1;
    petalPoint(p, u, v, q); pos.push(q.x, q.y, q.z);
    c.copy(cb).lerp(ct, Math.pow(u, 1.3));
    const vein = Math.abs(v) < 0.01 || Math.abs(v) > 0.99 ? 1 : 0;
    c.lerp(cr, vein ? 0.9 : 0.12 * (0.5 + 0.5 * Math.cos(u * 40)));   // gold rim and midrib, faint banding between
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---- the face: a unit head looking down +z
function faceDeform(x, y, z) {
  let d = 0;
  if (z > 0) {
    const ax = Math.abs(x), k = smooth(0.0, 0.45, z);
    d += 0.2 * Math.exp(-((x / 0.095) ** 2)) * smooth(0.34, -0.12, y) * smooth(-0.3, -0.16, y);     // nose ridge, rising to the tip
    d += 0.13 * gauss(x, y, 0, -0.17, 0.15, 0.085);                                                    // nose tip
    d += 0.05 * gauss(ax, y, 0.13, -0.2, 0.06, 0.05);                                                  // nostril wings
    d += 0.07 * gauss(ax, y, 0.3, 0.32, 0.22, 0.06);                                                   // brows
    d -= 0.1 * gauss(ax, y, 0.3, 0.19, 0.19, 0.1);                                                     // eye sockets
    d += 0.075 * gauss(ax, y, 0.3, 0.16, 0.14, 0.055);                                                 // closed lids
    d -= 0.02 * gauss(ax, y, 0.3, 0.125, 0.15, 0.012);                                                 // lash line
    d += 0.06 * gauss(ax, y, 0.5, -0.05, 0.2, 0.2);                                                    // cheekbones
    d += 0.075 * gauss(x, y, 0, -0.4, 0.2, 0.042) + 0.065 * gauss(x, y, 0, -0.5, 0.16, 0.05);          // lips
    d -= 0.045 * gauss(x, y, 0, -0.448, 0.22, 0.014);                                                  // the line between them
    d -= 0.03 * gauss(x, y, 0, -0.3, 0.05, 0.05);                                                      // philtrum
    d += 0.09 * gauss(x, y, 0, -0.78, 0.2, 0.13);                                                      // chin
    d *= k * 1.4;
  }
  const jaw = y < 0 ? 1 - 0.34 * Math.pow(-y, 1.6) : 1;
  return [x * 0.82 * jaw, y * 1.14, (z + d) * 0.84, d];
}
// a point on the face surface (unit head coords in, site coords out)
function facePoint(x, y, lift = 0) {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)), p = faceDeform(x, y, z);
  return V3(FACE.x + p[0] * FACE.s, FACE.y + p[1] * FACE.s, FACE.z + p[2] * FACE.s + lift);
}
function faceGeo() {
  const g = new THREE.SphereGeometry(1, 72, 56), P = g.attributes.position, n = P.count, col = new Float32Array(n * 3);
  const lo = new THREE.Color(GOLD_DK), mid = new THREE.Color(GOLD), hi = new THREE.Color(GOLD_LT), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = faceDeform(P.getX(i), P.getY(i), P.getZ(i));
    P.setXYZ(i, p[0], p[1], p[2]);
    const t = clamp(0.5 + p[3] * 5, 0, 1);   // hollows darker, ridges brighter: the features read from the back of the field
    c.copy(lo).lerp(mid, smooth(0, 0.55, t)).lerp(hi, smooth(0.6, 1, t));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.scale(FACE.s, FACE.s, FACE.s);
  return g;
}

// outline of a shaped wall in its own plane (closed loop, no doubled points)
export function outline(shape, w, h, n) {
  const pts = [], push = (x, y) => { const p = V3(x, y, 0); if (!pts.length || pts[pts.length - 1].distanceTo(p) > 0.05) pts.push(p); };
  for (let i = 0; i <= n; i++) { const y = i / n; push(ledShapeHalf(shape, y, h / w) * w / 2, (y - 0.5) * h); }
  for (let i = n; i >= 0; i--) { const y = i / n; push(-ledShapeHalf(shape, y, h / w) * w / 2, (y - 0.5) * h); }
  if (pts[0].distanceTo(pts[pts.length - 1]) < 0.05) pts.pop();
  return pts;
}
export const place = (p, cx, cy, cz, ry, lift = 0) => { const z = p.z + lift; return V3(cx + p.x * Math.cos(ry) + z * Math.sin(ry), cy + p.y, cz - p.x * Math.sin(ry) + z * Math.cos(ry)); };

// bud spire: a tapering stem that swells into a closed bud
const spireProfile = (r, h) => {
  const p = [];
  for (let i = 0; i <= 28; i++) {
    const f = i / 28, y = f * h;
    const stem = r * (1.25 - 0.75 * smooth(0, 0.5, f)) + r * 0.5 * Math.exp(-f * 14);
    const bud = r * 1.55 * Math.sin(Math.PI * clamp((f - 0.58) / 0.42, 0, 1) ** 0.8) * (1 - 0.35 * smooth(0.8, 1, f));
    p.push([Math.max(stem * (1 - smooth(0.62, 0.72, f)), bud), y]);
  }
  p[p.length - 1][0] = 0.001;
  return p;
};

export class FutureStage {
  constructor() {
    _seed = 20260919;
    this.group = new THREE.Group();
    this.group.name = 'future-stage';
    this.t = 0; this.open = 0.5; this.spin = 0;
    this.lights = new PixelStrips('sphere');
  }

  // Places this stage's walls and fixtures through the kit builder, and builds the sculpture around them.
  layout(b, kit, ZONE) {
    const P = new Paint(), F = new Paint(), G = new Paint(), TA = new Paint(), TB = new Paint(), E = new Paint();
    kit.xN = HALF_W; kit.hN = 56;
    kit.cam = { wide: 1.32, lookUp: 6, fwHigh: 22 };

    // ---- petal fans
    const back = [], front = [];
    for (let i = 0; i < 11; i++) { const a = (-80 + 16 * i) * DEG, L = reach(a); back.push({ a, L, W: L * 0.2, cup: 2.2, bend: 3.5, z: -15.5 }); }
    for (let i = 0; i < 10; i++) { const a = (-72 + 16 * i) * DEG, L = reach(a) * 0.7; front.push({ a, L, W: L * 0.2, cup: 1.6, bend: 2.6, z: -13.2 }); }
    for (const p of back) P.add(petalGeo(p, INDIGO, TEAL, GOLD), null, 0, ROOT_Y, p.z, 0, 0, -p.a);
    for (const p of front) P.add(petalGeo(p, PLUM, MAGENTA, GOLD_LT), null, 0, ROOT_Y, p.z, 0, 0, -p.a);
    // peacock eyes near the tips of the back petals (the middle ones stand behind the halo)
    for (const p of back) {
      if (Math.abs(p.a) < 20 * DEG) continue;
      const c = petalWorld(p, 0.78, 0, 0.5), r = p.L / 60 * 2.7;
      P.add(new THREE.TorusGeometry(r * 1.08, 0.2, 6, 28), GOLD, c.x, c.y, c.z);
      TA.add(new THREE.CircleGeometry(r, 28), 0xffffff, c.x, c.y, c.z);
      TB.add(new THREE.CircleGeometry(r * 0.62, 24), 0xffffff, c.x, c.y, c.z + 0.08);
      G.add(new THREE.CircleGeometry(r * 0.27, 18), 0xfff0c0, c.x, c.y, c.z + 0.16);
    }

    // ---- ground line: a long low plinth the petals grow out of
    P.box(186, 2.6, 7, 0, 1.3, -14.5, NIGHT);
    P.box(186, 0.35, 7.4, 0, 2.75, -14.5, GOLD);
    for (const side of [-1, 1]) for (let i = 0; i < 9; i++) P.ball(1.5 + rnd() * 1.6, side * (30 + i * 7 + rnd() * 3), 1.2, -10.6 - rnd() * 1.5, i % 2 ? STEM : NIGHT, 10);

    // ---- the oracle
    F.add(faceGeo(), null, FACE.x, FACE.y, FACE.z);
    P.cyl(3.4, 5.4, 8, 0, 25.5, -12.6, GOLD_DK, 20);
    // shoulders behind the collar, a hood over the head, and a lotus crown rising out of it
    const sh = new THREE.SphereGeometry(1, 28, 16); sh.scale(19, 5.2, 4.5); P.add(sh, GOLD_DK, 0, 25.6, -13.8);
    const hood = new THREE.SphereGeometry(1, 40, 28); hood.scale(FACE.s * 0.98, FACE.s * 1.2, FACE.s * 0.95); P.add(hood, INDIGO, 0, FACE.y + 1.2, FACE.z - 2.6);
    P.add(new THREE.TorusGeometry(FACE.s * 0.93, 0.32, 6, 48, Math.PI * 1.25), GOLD_LT, 0, FACE.y + 1.0, FACE.z + 0.75, 0, 0, -Math.PI * 0.125);
    for (let i = 0; i < 9; i++) {
      const a = (-64 + 16 * i) * DEG, L = 11.5 - Math.abs(i - 4) * 1.3, cp = { a, L, W: L * 0.24, cup: 0.8, bend: 1.6, z: 0 };
      const g = petalGeo(cp, i % 2 ? TEAL : GOLD_DK, i % 2 ? GOLD_LT : GOLD_LT, GOLD_LT);
      P.add(g, null, Math.sin(a) * 5.2, FACE.y + 4.2 + Math.cos(a) * 4.6, FACE.z - 1.2 - (i % 2) * 0.5, 0, 0, -a);
    }
    for (const side of [-1, 1]) {   // earrings: a disc and three drops
      const ex = side * FACE.s * 0.86, ey = FACE.y - 1.6, ez = FACE.z + 0.6;
      P.add(new THREE.TorusGeometry(1.5, 0.3, 6, 24), GOLD_LT, ex, ey, ez);
      TA.add(new THREE.CircleGeometry(1.25, 20), 0xffffff, ex, ey, ez);
      for (let j = -1; j <= 1; j++) P.add(new THREE.ConeGeometry(0.36, 2.6 - Math.abs(j) * 0.7, 4), GOLD, ex + j * 0.9, ey - 2.9 + Math.abs(j) * 0.35, ez, 0, Math.PI);
    }                                     // throat, down into the collar
    P.add(new THREE.TorusGeometry(15.4, 0.45, 8, 48, Math.PI), GOLD, 0, 28.3, -12, 0, 0, Math.PI);   // necklace arcs behind the collar
    P.add(new THREE.TorusGeometry(12.2, 0.3, 8, 40, Math.PI), GOLD_LT, 0, 28.3, -11.6, 0, 0, Math.PI);
    // closed eyes: a glowing line under each lid, and a gem on the brow
    for (const side of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 10; i++) { const f = i / 10 - 0.5; pts.push(facePoint(side * 0.3 + f * 0.3, 0.125 - 0.035 * Math.cos(f * Math.PI), 0.12)); }
      E.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.11, 5), 0xffffff);
    }
    const gem = this.gemAt = facePoint(0, 0.52, 0.35);
    E.add(new THREE.OctahedronGeometry(0.8), 0xffffff, gem.x, gem.y, gem.z);
    P.add(new THREE.TorusGeometry(1.15, 0.16, 6, 20), GOLD_LT, gem.x, gem.y, gem.z - 0.2);
    // diadem: a band over the brow with a row of leaves standing up from it
    for (let i = 0; i <= 12; i++) {
      const f = i / 12 - 0.5, c = facePoint(f * 1.5, 0.62 + 0.1 * Math.cos(f * Math.PI), 0.2), h = 2.6 - Math.abs(f) * 2.4;
      P.add(new THREE.ConeGeometry(0.55, h, 4), i % 2 ? GOLD : GOLD_LT, c.x, c.y + h / 2, c.z - 0.3, Math.PI / 4);
      if (i % 2 === 0) TA.add(new THREE.SphereGeometry(0.26, 8, 6), 0xffffff, c.x, c.y + h + 0.2, c.z - 0.3);
    }

    // ---- LED walls, shaped and framed in gold
    const wall = (cw, ch, w, h, opts, x, y, z, ry, zone, band, per) => {
      const p = b.panel(new LedPanel(cw, ch, w, h, Object.assign({ noBack: true }, opts)), x, y, z, ry), shape = opts.shape || 'rect';
      const loop = outline(shape, w + 0.5, h + 0.5, 22);
      P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop.map(q => place(q, x, y, z, ry, -0.05)), true, 'centripetal'), loop.length * 3, 0.3, 6, true), GOLD);
      const px = outline(shape, w + 1.3, h + 1.3, per).map(q => place(q, x, y, z, ry, 0.3));
      px.push(px[0].clone());
      b.strip('frame', px, 0.28, zone, band);
      return p;
    };
    wall(160, 84, 46, 24, { role: 'main', name: 'main', shape: 'arch' }, 0, 14, SCREEN_Z, 0, ZONE.frame, 3, 60);
    wall(168, 14, 30, 2.6, { role: 'ribbon', name: 'ribbon', shape: 'pill', gain: 1.1 }, 0, 28.6, -9.6, 0, ZONE.frame, 4, 40);
    b.panel(new LedPanel(72, 16, 9, 2.1, { gain: 1.0, role: 'booth', name: 'booth' }), 0, 4.5, 0.52);
    for (const side of [-1, 1]) {
      wall(56, 84, 14, 21, { role: 'wing', name: 'wing' + side, shape: 'leaf' }, side * 35, 14.5, -8, -side * 0.3, ZONE.frame, side < 0 ? 2 : 5, 36);
      wall(44, 66, 11, 16.5, { role: 'wing', name: 'wingo' + side, shape: 'leaf' }, side * 62, 11.5, -5, -side * 0.45, ZONE.frame, side < 0 ? 0 : 7, 30);
      wall(20, 88, 5, 22, { role: 'tower', name: 'tower' + side, shape: 'leaf', gain: 1.0 }, side * 48.5, 16, -2.5, -side * 0.25, ZONE.frame, side < 0 ? 1 : 6, 30);
      // each leaf stands on a stem
      P.cyl(0.35, 0.7, 4.2, side * 35, 0, -8.2, GOLD_DK, 8); P.cyl(0.3, 0.6, 3.4, side * 62, 0, -5.2, GOLD_DK, 8); P.cyl(0.3, 0.6, 5.2, side * 48.5, 0, -2.7, GOLD_DK, 8);
    }

    // ---- bud spires
    const spires = [[25.5, -9, 30, 1.7, ZONE.col], [48, -7.5, 38, 2.6, ZONE.tower], [74, -6, 27, 2.3, ZONE.tower]];
    for (const side of [-1, 1]) for (const [ax, z, h, r, zone] of spires) {
      const x = side * ax, prof = spireProfile(r, h);
      P.lathe(prof, x, 0, z, STEM, 18);
      P.lathe(prof.filter((_, i) => i >= 17).map(p => [p[0] * 1.03, p[1]]), x, 0, z, MAGENTA, 18);      // the bud wears colour
      P.add(new THREE.TorusGeometry(r * 0.9, 0.25, 6, 20), GOLD, x, h * 0.6, z, 0, Math.PI / 2);
      TB.add(new THREE.SphereGeometry(0.55, 10, 8), 0xffffff, x, h + 0.4, z);
      // sepals cupping the bud
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; P.add(new THREE.ConeGeometry(r * 0.5, h * 0.2, 4), GOLD_DK, x + Math.sin(a) * r * 1.1, h * 0.66, z + Math.cos(a) * r * 1.1, a, 0.25); }
      // a pixel vine winding up the stem and round the bud
      const pts = [], n = Math.round(h * 3.2), turns = h / 7;
      for (let i = 0; i < n; i++) { const f = i / (n - 1), y = 0.6 + f * (h - 1.2), rr = radiusAt(prof, y) + 0.22, a = f * turns * TAU * side; pts.push(V3(x + Math.sin(a) * rr, y, z + Math.cos(a) * rr)); }
      b.strip('spire', pts, 0.3, zone, side < 0 ? (ax > 60 ? 0 : 1) : (ax > 60 ? 7 : 6));
    }
    kit.topFlames = [[-48, 38.6, -7.5], [48, 38.6, -7.5]];

    // ---- pixel architecture: every petal is drawn in light
    const edge = (p, v, n, u0 = 0.12) => { const pts = []; for (let i = 0; i < n; i++) pts.push(petalWorld(p, u0 + (1 - u0) * i / (n - 1), v, 0.35)); return pts; };
    front.forEach((p, i) => { for (const v of [-1, 1]) b.strip('petal', edge(p, v, Math.round(p.L * 1.1)), 0.34, ZONE.arch, i % 8); });
    back.forEach((p, i) => {
      for (const v of [-1, 1]) b.strip('crest', edge(p, v, Math.round(p.L * 0.8), 0.45), 0.4, ZONE.arch, (i + 3) % 8);
      b.strip('rib', edge(p, 0, Math.round(p.L * 0.7), 0.3), 0.3, ZONE.truss, i % 8);
    });
    front.forEach((p, i) => b.strip('rib', edge(p, 0, Math.round(p.L * 0.8), 0.2), 0.28, ZONE.truss, (i + 4) % 8));
    // rays behind the head, where the Mainstage hangs its drips
    for (let i = 0; i < 15; i++) { const a = (-105 + 15 * i) * DEG; b.strip('ray', pathLine(V3(Math.sin(a) * 10.5, FACE.y + Math.cos(a) * 10.5, -13.6), V3(Math.sin(a) * 17.5, FACE.y + Math.cos(a) * 17.5, -13.6), 12), 0.3, ZONE.drop, i % 8); }
    // deck, riser, floor and runway lines (the deck is shared with the Mainstage)
    for (const side of [-1, 1]) b.strip('deckside', pathLine(V3(side * 28.1, 2.25, -11), V3(side * 28.1, 2.25, 5), 33), 0.3, ZONE.deck);
    b.strip('deckfront', pathLine(V3(-27.5, 2.25, 5.1), V3(27.5, 2.25, 5.1), 111), 0.3, ZONE.deck);
    b.strip('riser', pathLine(V3(-7, 3.45, 1.1), V3(7, 3.45, 1.1), 31), 0.22, ZONE.riser);
    for (const x of [-8, 8]) b.strip('runway', pathLine(V3(x, 0.3, 8), V3(x, 0.3, 60), 53), 0.34, ZONE.runway);
    b.strip('barrier', pathLine(V3(-40, 0.3, 11), V3(40, 0.3, 11), 81), 0.3, ZONE.runway);
    for (const z of [-9, -6, -3, 0, 3]) b.strip('floor', pathLine(V3(-27, 2.25, z), V3(27, 2.25, z), 55), 0.22, ZONE.floor);
    // the deck front wears a gold arcade instead of bare black
    for (let i = 0; i < 14; i++) P.add(new THREE.TorusGeometry(1.9, 0.12, 5, 14, Math.PI), GOLD, -26 + i * 4, 0.15, 5.12);
    for (const side of [-1, 1]) P.add(new THREE.TorusGeometry(1.0, 0.13, 5, 18), GOLD_LT, side * 6.4, 4.5, 0.56);

    // ---- moving heads, hidden in the sculpture (same zones and counts as the Mainstage rig)
    const head = b.head, at = (p, u, v, fn, ...rest) => { const q = petalWorld(p, u, v, 0.9); fn(q.x, q.y, q.z, ...rest); };
    for (const p of front) for (const u of [0.55, 0.7, 0.85, 0.99]) at(p, u, 0, head, 0);
    back.forEach((p, i) => { for (const u of i === 5 ? [0.8, 0.99] : [0.6, 0.8, 0.99]) at(p, u, 0, head, 1); });
    for (let i = 0; i < 22; i++) { const a = (-120 + 240 * i / 21) * DEG; head(Math.sin(a) * 12.8, FACE.y + Math.cos(a) * 12.8, -13.2, 2); }
    for (let i = 0; i < 12; i++) head(-13.75 + i * 2.5, 30.4, -9.3, 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) head(side * 51.6, 4 + i * 2.9, -5.5, 3, true);
      for (let i = 0; i < 6; i++) head(side * 25.5, 4 + i * 3.6, -6.9, 4, true);
      for (const yn of [0.14, 0.38, 0.62, 0.86]) for (const e of [-1, 1]) { const q = place(V3(e * (ledShapeHalf('leaf', yn) * 7 + 0.9), (yn - 0.5) * 21, 0), side * 35, 14.5, -8, -side * 0.3, 0.5); head(q.x, q.y, q.z, 7, true); }
      for (let i = 0; i < 4; i++) head(side * 74, 6 + i * 4.2, -3.2, 9);
    }
    for (let i = 0; i < 18; i++) head(-25.5 + i * 3, 2.4, -9.2, 5, true);
    for (let i = 0; i < 13; i++) head(-27 + i * 4.5, 2.4, 5.6, 6, true);
    for (const e of [-1, 1]) for (let i = 0; i < 8; i++) { const yn = 0.58 + 0.4 * i / 7; head(e * (ledShapeHalf('arch', yn) * 23 + 1.2), 2 + yn * 24, -10, 8); }

    // ---- strobes and blinders
    const st = b.strobe; let k = 0;
    for (const p of front) for (const u of [0.25, 0.4, 0.62, 0.78]) { const q = petalWorld(p, u, 0, 0.7); st(q.x, q.y, q.z, 'front', k++, { u: (q.x / HALF_W + 1) / 2 }); }
    k = 0;
    for (const p of back) for (const u of [0.4, 0.52, 0.7, 0.9]) { const q = petalWorld(p, u, 0, 0.7); st(q.x, q.y, q.z, 'back', k++, { u: (q.x / HALF_W + 1) / 2 }); }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 13; i++) st(side * 44.4, 5 + i * 2, -5.5, 'tower', i, { u: i / 12, rot: new THREE.Euler(0, -side * 0.4, 0) });
      for (const y of [2.6, 26.4]) st(side * 35, y, -7.4, 'blinder', 0, { w: 2, h: 1.2, warm: true });
      for (const x of [20, 38]) st(side * x, 3.6, 5.2, 'blinder', 0, { w: 2, h: 1.2, warm: true });
    }
    for (const x of [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5]) st(x, 26.6, -9.4, 'blinder', 0, { w: 2.4, h: 1.2, warm: true });
    for (let i = 0; i < 37; i++) st(-27 + i * 1.5, 2.9, 5.25, 'deck', i, { w: 0.9, h: 0.35, u: i / 36 });

    // ---- lasers: 16 projectors, as on the Mainstage
    const laser = b.laser;
    for (let i = 0; i < 4; i++) laser(-12 + i * 8, 30.7, -9.1, 5, { pitch: -0.05 }, 0);
    laser(-25.5, 30.6, -9, 5, { pitch: -0.08 }, 1); laser(gem.x, gem.y, gem.z + 0.6, 5, { pitch: -0.12 }, 1); laser(25.5, 30.6, -9, 5, { pitch: -0.08 }, 1);
    for (const side of [-1, 1]) {
      laser(side * 48, 33, -4.6, 5, { yaw: -side * 0.4 }, 2);
      laser(side * 35, 26.6, -7.3, 4, { yaw: -side * 0.2, pitch: 0.05 }, 3);
    }
    for (const x of [-12, 12]) laser(x, 2.6, -9.5, 5, { pitch: 0.35 }, 4);
    for (const x of [-17, 0, 17]) { const yn = x ? 0.8 : 1; laser(x, 2 + yn * 24 + 0.6, -10, 6, { mode: 'cone', pitch: 0.1, spread: 0.5 }, 5); }

    // ---- a garden of lantern buds at the far ends, and the water
    for (const side of [-1, 1]) for (const [ax, h] of [[56, 4.2], [67, 3], [81, 5], [90, 3.4]]) {
      const x = side * ax, z = -1.5 - rnd() * 2;
      P.cyl(0.14, 0.24, h, x, 0, z, STEM, 6);
      this.lights.addStrip('bud', [V3(x, h + 0.7, z)], 1.7, { kind: 'bud' });
      for (let j = 0; j < 5; j++) { const a = j / 5 * TAU; P.add(new THREE.ConeGeometry(0.5, 1.5, 4), j % 2 ? PLUM : MAGENTA, x + Math.sin(a) * 0.75, h + 0.5, z + Math.cos(a) * 0.75, a, 0.5); }
    }
    this._buildPaint(P, F, G, TA, TB, E);
    this._buildHalo();
    this._buildWater();
    this.group.add(this.lights.build());
    this.group.traverse(o => { o.frustumCulled = false; });
  }

  _material(flat) {
    const S = this.shared, U = { uT: S.uT, uWarm: S.uWarm, uWashA: S.uWashA, uWashB: S.uWashB, uWashK: S.uWashK, uFlat: { value: flat } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;\nvarying vec3 vFsNrm;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvFsNrm = objectNormal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFsPos = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;\nvarying vec3 vFsNrm;\nuniform float uT, uWarm, uWashK, uFlat;\nuniform vec3 uWashA, uWashB;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // architectural lighting without lights: warm uplight from the ground, the show colours washing out from the
          // centre, all shaped by a fake key light from low in front so the petals and the face keep their form
          float fsUp = clamp(vFsPos.y / 58.0, 0.0, 1.0), fsSide = clamp(abs(vFsPos.x) / 88.0, 0.0, 1.0);
          float fsKey = 0.22 + 0.78 * pow(clamp(dot(normalize(vFsNrm) * faceDirection, normalize(vec3(0.0, -0.5, 0.86))), 0.0, 1.0), 1.4);
          vec3 fsWash = mix(uWashA, uWashB, smoothstep(0.2, 0.8, fsSide + 0.15 * sin(uT * 0.4)));
          float fsChase = 0.72 + 0.28 * sin(length(vFsPos.xy - vec2(0.0, 4.0)) * 0.22 - uT * 2.4);
          vec3 fsWarm = vec3(1.0, 0.72, 0.42) * mix(0.22 + 1.0 * pow(1.0 - fsUp, 2.0), 0.85, uFlat);
          totalEmissiveRadiance += vColor.rgb * fsKey * (uWarm * fsWarm + fsWash * uWashK * mix(0.45 + 0.55 * fsUp, 0.55, uFlat) * fsChase);`);
    };
    return mat;
  }
  _buildPaint(P, F, G, TA, TB, E) {
    this.shared = { uT: { value: 0 }, uWarm: { value: 0.6 }, uWashA: { value: new THREE.Color(1, 1, 1) }, uWashB: { value: new THREE.Color(1, 1, 1) }, uWashK: { value: 0.3 } };
    this.group.add(new THREE.Mesh(P.merged(), this._material(0)));
    this.group.add(new THREE.Mesh(F.merged(), this._material(1)));
    const glow = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
    this.glowMat = glow(); this.tintA = glow(); this.tintB = glow(); this.eyeMat = glow();
    this.group.add(new THREE.Mesh(G.merged(), this.glowMat), new THREE.Mesh(TA.merged(), this.tintA), new THREE.Mesh(TB.merged(), this.tintB), new THREE.Mesh(E.merged(), this.eyeMat));
  }

  // the sunburst behind the head: two rings of blades that fold back when the music rests and open on the drop
  _buildHalo() {
    const p = { L: 1, W: 0.17, cup: 0, bend: 0 }, NU = 8, NV = 2, pos = [], col = [], idx = [], q = new THREE.Vector3();
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) { const u = i / NU; petalPoint(p, u, j - 1, q); pos.push(q.x, q.y, 0); const k = j === 1 ? 1 : 0.45; col.push(k, k, k); }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    this.haloN = 26;
    this.halo = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }), this.haloN * 2);
    this.halo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.haloN * 6).fill(1), 3);
    this.group.add(this.halo);
  }

  _buildWater() {
    const pos = [], uv = [], info = [], idx = [];
    const quad = (x, y, z, w, h, kind, ph) => {
      const o = pos.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x + (u - 0.5) * w, y, z); uv.push(u, v); info.push(y, h, kind, ph); }
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    for (const side of [-1, 1]) {
      quad(side * 82, 1, -9.4, 9, 15, 0, rnd() * 9); quad(side * 93, 1, -9.8, 6, 10, 0, rnd() * 9);      // falls off the low outer petals
      for (let i = 0; i < 7; i++) quad(side * (70 + i * 3.2), 0.4, -3.5, 2.2, 5 + 2.5 * Math.sin(i / 6 * Math.PI), 1, rnd() * 9);   // a bow of jets outside the screens
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4)); g.setIndex(idx);
    this.waterU = { uT: { value: 0 }, uJet: { value: 0.5 }, uCol: { value: new THREE.Color(0.5, 0.8, 1) }, uGain: { value: 0.6 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec4 aInfo; uniform float uT, uJet; varying vec2 vUv; varying vec2 vK;
        void main(){
          vUv = uv; vK = aInfo.zw;
          float h = aInfo.y * (aInfo.z > 0.5 ? uJet * (0.8 + 0.2 * sin(uT * 1.7 + aInfo.w)) : 1.0);
          vec3 p = position; p.y = aInfo.x + uv.y * h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uT, uGain; uniform vec3 uCol; varying vec2 vUv; varying vec2 vK;
        float hash(float n){ return fract(sin(n * 12.9898 + vK.y) * 43758.5453); }
        void main(){
          float a;
          if (vK.x < 0.5) {   // falling sheet: columns of streaks sliding down, mist at the foot
            float s = hash(floor(vUv.x * 70.0)), f = fract(vUv.y * (0.8 + 1.2 * s) + uT * (0.35 + 0.5 * s));
            a = (0.16 + 0.5 * smoothstep(0.0, 0.5, f) * smoothstep(1.0, 0.5, f)) * (0.35 + 0.65 * s);
            a *= smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x) * smoothstep(1.0, 0.85, vUv.y);
            a += 0.3 * smoothstep(0.18, 0.0, vUv.y);
          } else {            // jet: a narrow column that feathers open toward the top
            float x = abs(vUv.x - 0.5) * 2.0, w = 0.1 + 0.55 * vUv.y * vUv.y;
            a = smoothstep(w, 0.0, x) * (1.0 - 0.7 * vUv.y) * (0.65 + 0.35 * sin(vUv.y * 34.0 - uT * 15.0 + vK.y));
            a *= smoothstep(1.0, 0.8, vUv.y);
          }
          gl_FragColor = vec4(mix(vec3(0.6, 0.82, 1.0), uCol, 0.55) * a * uGain, 1.0);
        }`,
    });
    this.water = new THREE.Mesh(g, mat);
    this.group.add(this.water);
  }

  update(show, dt, levels) {
    if (!this.shared) return;
    const t = this.t += dt;
    const ph = show.phase, hot = ph === 'drop' || ph === 'peak', calm = ph === 'breakdown' || ph === 'intro' || ph === 'idle';
    const A = show.colorA, B = show.colorB, C = show.colorC, U = this.shared;
    const energy = clamp(show.energy ?? 0.5, 0, 1), pulse = show.beatPulse ?? 0, kick = show.kick ?? 0, bass = levels ? levels[1] : 0;
    // sculpture lighting
    U.uT.value = t;
    U.uWarm.value += ((calm ? 0.62 : hot ? 0.3 : 0.45) - U.uWarm.value) * Math.min(1, dt * 1.5);
    U.uWashA.value.copy(A); U.uWashB.value.copy(B);
    const washT = (calm ? 0.4 : hot ? 1.0 : 0.62) + (hot ? 0.6 : 0.2) * kick;
    U.uWashK.value += (washT - U.uWashK.value) * Math.min(1, dt * (washT > U.uWashK.value ? 14 : 4));
    // peacock eyes, bud tips, the oracle's eyes
    this.tintA.color.copy(A).multiplyScalar(0.7 + 0.9 * pulse + (hot ? 0.5 : 0));
    this.tintB.color.copy(B).multiplyScalar(0.8 + 0.8 * bass + (hot ? 0.4 : 0));
    this.glowMat.color.setScalar(0.7 + 0.6 * pulse);
    if (hot) this.eyeMat.color.copy(C).lerp(_c.set(0xffffff), 0.35).multiplyScalar(1.4 + 2.2 * kick);
    else this.eyeMat.color.set(0xffd9a0).multiplyScalar(calm ? 0.55 + 0.25 * Math.sin(t * 0.8) : 0.9 + 0.6 * pulse);
    // the halo opens with the music
    const openT = hot ? 1 : calm ? 0.12 : ph === 'build' ? 0.45 + 0.4 * energy : 0.55;
    this.open += (openT - this.open) * Math.min(1, dt * (openT > this.open ? 5 : 0.9));
    this.spin += dt * (0.02 + 0.1 * energy) * (hot ? 2 : 1);
    const n = this.haloN, o = this.open, hc = this.halo.instanceColor.array;
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) {
      const j = r * n + i, a = (i + r * 0.5) / n * TAU + (r ? -1 : 1) * this.spin, r0 = 7.6, len = (r ? 7 : 11.5) * (0.5 + 0.5 * o) * (1 + 0.06 * pulse * (i & 1 ? 1 : -1));
      _q.setFromAxisAngle(_v.set(0, 0, 1), -a); _q2.setFromAxisAngle(_v.set(1, 0, 0), -(1 - o) * (r ? 1.0 : 0.75)); _q.multiply(_q2);
      this.halo.setMatrixAt(j, _m.compose(_v.set(FACE.x + Math.sin(a) * r0, FACE.y + Math.cos(a) * r0, -14.4 - r * 0.4), _q, _s.set(len * 1.15, len, 1)));
      const wave = 0.5 + 0.5 * Math.sin(i / n * TAU * 3 - t * (hot ? 6 : 1.5)), k = (r ? 0.5 : 0.36) + (hot ? 0.9 : 0.3) * wave * (0.4 + pulse) + 0.25 * o;
      _c.set(GOLD_LT).lerp(_c2.copy(r ? B : A), hot ? 0.75 : 0.3).multiplyScalar(k);
      hc[j * 3] = _c.r; hc[j * 3 + 1] = _c.g; hc[j * 3 + 2] = _c.b;
    }
    this.halo.instanceMatrix.needsUpdate = true; this.halo.instanceColor.needsUpdate = true;
    // water
    const W = this.waterU;
    W.uT.value = t; W.uCol.value.copy(B).lerp(A, 0.5 + 0.5 * Math.sin(t * 0.3));
    W.uJet.value += ((calm ? 0.45 : hot ? 1 : 0.7) * (0.85 + 0.3 * bass) - W.uJet.value) * Math.min(1, dt * 3);
    W.uGain.value = (calm ? 0.3 : 0.42) + 0.2 * pulse;
    // lantern buds
    const L = this.lights;
    for (const s of L.strips) for (let j = 0; j < s.count; j++) { const idx = s.start + j; L.setPixelC(idx, (s.idx ?? idx) & 1 ? B : C, 0.8 + 0.9 * (0.5 + 0.5 * Math.sin(t * 1.3 + idx * 1.7)) * (0.5 + pulse)); }
    L.commit();
  }
}

// radius of a lathe profile at height y
function radiusAt(prof, y) {
  for (let i = 1; i < prof.length; i++) if (prof[i][1] >= y) { const a = prof[i - 1], b = prof[i], f = (y - a[1]) / Math.max(1e-6, b[1] - a[1]); return a[0] + (b[0] - a[0]) * f; }
  return prof[prof.length - 1][0];
}
