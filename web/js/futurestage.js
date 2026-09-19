// Future Stage: a storybook castle built around the same LED walls, rig and booth as the Mainstage. Towers with swept
// roofs and onion domes, a gabled frontispiece with a stained-glass rose window and a turning astrolabe, hundreds of lit
// windows, fairy lights along every roofline, pennants on the spires and giant glowing mushrooms beside the set.
//
// Everything is authored in site units (the set's own coordinates: 96 wide, front edge at z 2) and added to stage.big.
// The architecture sits behind the pixel arches (z <= -11.8) or outside the set's width, so it frames the stage and
// never covers a wall, a fixture or the DJs. Nothing here stands in the crowd or in the air in front of the stage.
//
// Cost: the architecture is one merged vertex-coloured mesh with one Lambert shader (patched for fake architectural
// uplighting in the show colours, so it needs no lights of its own); windows, fairy lights and flags are one instanced
// draw each.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, PixelStrips, pathLine, pathArc, pathPoly } from './fixtures.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

// deterministic scatter so the castle is the same castle every visit
let _seed = 1;
const rnd = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };

const STONE = 0x7a7786, STONE_DK = 0x5c5966, STONE_LT = 0x94919f, GOLD = 0xd9a436, TEAL = 0x0f6a70, PLUM = 0x5a1e5e, ROSE = 0x8a2440,
  WOOD = 0x4a2a18, CREAM = 0xe2d8c4, MOSS = 0x2c5a2a, SLATE = 0x27305a;

const WALL_Z = -12.5;    // front face of the back wall
const FRONT_Z = -11.9;   // front face of the frontispiece (the pixel arches hang at z -11.5)

// top of the facade at |x| (frontispiece gable in the middle, stepping down to the wings)
function wallTop(ax) {
  if (ax < 13) return 41 + 12 * (1 - ax / 13);
  if (ax < 24) return 39;
  if (ax < 40) return 33;
  if (ax < 66) return 25;
  return 18;
}

// collects coloured geometry and merges it into one mesh
class Paint {
  constructor() { this.geos = []; }
  add(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    g.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
  }
  box(w, h, d, x, y, z, color, ry = 0) { this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, ry); }
  cyl(rTop, rBot, h, x, y0, z, color, seg = 16) { this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, x, y0 + h / 2, z); }
  ball(r, x, y, z, color) { this.add(new THREE.SphereGeometry(r, 10, 8), color, x, y, z); }
  lathe(profile, x, y0, z, color, seg = 16) { this.add(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), seg), color, x, y0, z); }
  merged() { const g = mergeGeometries(this.geos, false); for (const s of this.geos) s.dispose(); this.geos.length = 0; return g; }
}

// swept "witch hat" roof: concave from the eave to the point
const hatProfile = (R, h) => { const p = []; for (let i = 0; i <= 10; i++) { const f = i / 10; p.push([Math.max(0.001, R * Math.pow(1 - f, 1.75)), h * f]); } return p; };
// onion dome: bulges past the drum, then pinches to a point
const onionProfile = (R, h) => { const p = []; for (let i = 0; i <= 12; i++) { const f = i / 12; p.push([Math.max(0.001, R * (1 + 0.42 * Math.sin(f * Math.PI * 1.08)) * (1 - Math.pow(f, 2.4))), h * f]); } return p; };
const hatRadius = (R, f) => R * Math.pow(1 - f, 1.75);

function stainedGlass() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), c = S / 2;
  g.fillStyle = '#05030a'; g.fillRect(0, 0, S, S);
  const jewel = ['#ff2e63', '#ffb627', '#2ec4ff', '#9d4edd', '#2bff9a', '#ff6a1a', '#3a6bff', '#ff4fd8'];
  const ringR = [[0.78, 0.98, 24], [0.5, 0.76, 12], [0.22, 0.48, 12], [0.0, 0.2, 6]];
  ringR.forEach(([r0, r1, n], ri) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU + ri * 0.13, a1 = ((i + 1) / n) * TAU + ri * 0.13, am = (a0 + a1) / 2;
      g.beginPath();
      if (ri === 1 || ri === 2) {   // petals
        g.moveTo(c + Math.cos(a0) * r0 * c, c + Math.sin(a0) * r0 * c);
        g.quadraticCurveTo(c + Math.cos(a0) * r1 * c, c + Math.sin(a0) * r1 * c, c + Math.cos(am) * r1 * c, c + Math.sin(am) * r1 * c);
        g.quadraticCurveTo(c + Math.cos(a1) * r1 * c, c + Math.sin(a1) * r1 * c, c + Math.cos(a1) * r0 * c, c + Math.sin(a1) * r0 * c);
        g.arc(c, c, r0 * c, a1, a0, true);
      } else { g.arc(c, c, r1 * c, a0, a1); g.arc(c, c, Math.max(0.001, r0 * c), a1, a0, true); }
      g.closePath();
      const col = jewel[(i * (ri + 2) + ri * 3) % jewel.length];
      const gr = g.createRadialGradient(c, c, r0 * c, c, c, r1 * c); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, col); gr.addColorStop(1, col);
      g.fillStyle = gr; g.fill();
      g.lineWidth = 7; g.strokeStyle = '#05030a'; g.stroke();
    }
  });
  g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.arc(c, c, c * 0.985, 0, TAU); g.fill();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

export class FutureStage {
  constructor() {
    _seed = 20260919;
    this.group = new THREE.Group();
    this.group.name = 'future-stage';
    this.lights = new PixelStrips('sphere');
    this.win = [];      // {x, y, z, w, h, ry}
    this.flagAt = [];   // {x, y, z}
    this.t = 0; this.spin = 0;
    const P = this.paint = new Paint(), G = this.glowPaint = new Paint();
    this._facade(P);
    this._towers(P);
    this._wings(P);
    this._frontDress(P);
    this._flora(P, G);
    this._buildPaint(P, G);
    this._buildGlass();
    this._buildAstrolabe();
    this._buildWindows();
    this._buildFlags();
    this.group.add(this.lights.build());
    const n = this.lights.total;
    this.twPhase = new Float32Array(n); this.twSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.twPhase[i] = rnd() * TAU; this.twSpeed[i] = 0.6 + rnd() * 2.2; }
    this.group.traverse(o => { o.frustumCulled = false; });
  }

  // a round turret: body, corbelled gallery, swept roof or onion dome, gold finial, a pennant, lights and windows
  _turret(P, x, z, r, y0, yTop, roofH, roofColor, { onion = false, body = STONE, flag = true, windows = true, big = false } = {}) {
    P.cyl(r, r * 1.06, yTop - y0, x, y0, z, body, big ? 20 : 14);
    P.cyl(r * 1.28, r, 0.9, x, yTop - 0.9, z, STONE_DK, big ? 20 : 14);          // corbel
    P.cyl(r * 1.3, r * 1.3, 0.35, x, yTop, z, GOLD, big ? 20 : 14);              // gold cornice
    const nM = big ? 14 : 9;
    for (let i = 0; i < nM; i++) { const a = (i / nM) * TAU; P.box(r * 0.34, 0.8, 0.3, x + Math.sin(a) * r * 1.22, yTop + 0.75, z + Math.cos(a) * r * 1.22, STONE_LT, a); }   // merlons
    const R = r * (onion ? 1.0 : 1.38), ry0 = yTop + (onion ? 0.35 : 0.5);
    if (onion) P.cyl(r * 0.92, r * 0.92, 1.2, x, yTop + 0.35, z, STONE_LT, 14);
    P.lathe(onion ? onionProfile(R, roofH) : hatProfile(R, roofH), x, ry0 + (onion ? 1.2 : 0), z, roofColor, big ? 20 : 14);
    const tip = ry0 + (onion ? 1.2 : 0) + roofH;
    P.cyl(0.06, 0.1, 2.6, x, tip - 0.2, z, GOLD, 6); P.ball(0.34, x, tip + 0.5, z, GOLD); P.ball(0.2, x, tip + 1.3, z, GOLD);
    if (flag) this.flagAt.push({ x, y: tip + 1.9, z });
    // lights: a ring under the gallery and a spiral up the roof
    this.lights.addStrip('ring', pathArc(V3(x, yTop + 0.2, z), r * 1.36, -0.1, Math.PI + 0.1, Math.round(r * 9), 'xz'), 0.3, { kind: 'ring' });
    const sp = [], turns = big ? 3.5 : 2.5, nS = Math.round(roofH * (big ? 5 : 4));
    for (let i = 0; i < nS; i++) {
      const f = i / nS * 0.92, a = f * turns * TAU, rr = (onion ? R * (1 + 0.42 * Math.sin(f * Math.PI * 1.08)) * (1 - Math.pow(f, 2.4)) : hatRadius(R, f)) + 0.12;
      sp.push(V3(x + Math.sin(a) * rr, ry0 + (onion ? 1.2 : 0) + roofH * f, z + Math.cos(a) * rr));
    }
    this.lights.addStrip('spiral', sp, 0.28, { kind: 'spiral' });
    if (windows) {
      const rows = Math.max(1, Math.floor((yTop - Math.max(y0, 27)) / 4.2));
      for (let k = 0; k < rows; k++) for (const a of big ? [-0.7, 0, 0.7] : [-0.5, 0.5]) {
        const y = yTop - 3 - k * 4.2; if (y < y0 + 1.5) continue;
        this.win.push({ x: x + Math.sin(a) * (r + 0.04), y, z: z + Math.cos(a) * (r + 0.04), w: big ? 0.9 : 0.62, h: big ? 2 : 1.5, ry: a });
      }
    }
    return tip;
  }

  _battlements(P, x0, x1, y, z, d = 1.6) {
    const n = Math.max(2, Math.round((x1 - x0) / 1.7));
    for (let i = 0; i < n; i += 2) P.box((x1 - x0) / n, 1.0, d, x0 + (i + 0.5) * (x1 - x0) / n, y + 0.5, z - d / 2, STONE_LT);
  }

  _facade(P) {
    // back wall: a stepped castle silhouette behind the whole set
    const prof = [[-84, 0], [-84, 18], [-66, 18], [-66, 25], [-40, 25], [-40, 33], [-24, 33], [-24, 39], [-13, 39], [-13, 42], [13, 42], [13, 39], [24, 39], [24, 33], [40, 33], [40, 25], [66, 25], [66, 18], [84, 18], [84, 0]];
    const sh = new THREE.Shape(); prof.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
    P.add(new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false }), STONE, 0, 0, WALL_Z - 1.6);
    for (const [a, b, y] of [[13, 24, 39], [24, 40, 33], [40, 66, 25], [66, 84, 18]]) for (const s of [-1, 1]) this._battlements(P, Math.min(s * a, s * b), Math.max(s * a, s * b), y, WALL_Z);
    // gold string courses and a darker plinth give the wall its storeys
    for (const [hw, y] of [[84, 17.2], [66, 24.2], [40, 32.2], [24, 38.2]]) { P.box(hw * 2, 0.45, 0.5, 0, y, WALL_Z + 0.2, GOLD); }
    P.box(168, 3, 0.6, 0, 1.5, WALL_Z + 0.25, STONE_DK);
    // pilasters break the wall into bays; a gold proscenium arch rings the pixel arches
    for (let x = 15.6; x < 83; x += 5.2) for (const s of [-1, 1]) { if ([24, 40, 66].some(tx => Math.abs(x - tx) < 2.8)) continue; const h = wallTop(x) - 0.2; P.box(0.9, h, 0.5, s * x, h / 2, WALL_Z + 0.25, STONE_LT); P.box(1.3, 0.5, 0.7, s * x, h - 1.4, WALL_Z + 0.3, GOLD); }
    P.add(new THREE.TorusGeometry(35.3, 0.42, 6, 96, Math.PI), GOLD, 0, 2, -11.95);
    // frontispiece: the gabled centre that carries the rose window
    const fs = new THREE.Shape(); [[-13, 0], [-13, 41], [0, 53], [13, 41], [13, 0]].forEach((p, i) => i ? fs.lineTo(p[0], p[1]) : fs.moveTo(p[0], p[1]));
    P.add(new THREE.ExtrudeGeometry(fs, { depth: 1.2, bevelEnabled: false }), STONE_LT, 0, 0, FRONT_Z - 1.2);
    // gable coping in gold, stepped crockets up both rakes
    for (const s of [-1, 1]) {
      const len = Math.hypot(13, 12), ang = Math.atan2(12, 13);
      P.add(new THREE.BoxGeometry(len + 0.6, 0.55, 1.5), GOLD, s * 6.5, 47 + 0.3, FRONT_Z - 0.6, 0, 0, -s * ang);
      for (let i = 1; i < 8; i++) { const f = i / 8; P.add(new THREE.ConeGeometry(0.32, 1.1, 5), GOLD, s * 13 * (1 - f), 41 + 12 * f + 1.0, FRONT_Z - 0.6); }
    }
    P.box(26.6, 0.5, 1.5, 0, 40.6, FRONT_Z - 0.55, GOLD);
    // sunburst behind the rose window
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, L = i % 2 ? 2.2 : 3.4, r0 = 5.2;
      P.add(new THREE.BoxGeometry(L, i % 2 ? 0.16 : 0.26, 0.16), GOLD, Math.cos(a) * (r0 + L / 2), 43.5 + Math.sin(a) * (r0 + L / 2), FRONT_Z + 0.06, 0, 0, a);
    }
    P.add(new THREE.TorusGeometry(4.85, 0.32, 8, 40), GOLD, 0, 43.5, FRONT_Z + 0.1);
    for (const s of [-1, 1]) P.add(new THREE.TorusGeometry(2.85, 0.24, 8, 28), GOLD, s * 32, 29.2, WALL_Z + 0.1);
    // gold volutes curling off the shoulders
    for (const s of [-1, 1]) for (const [cx, cy, R] of [[18.5, 40.2, 2.6], [53, 26.4, 2.4]]) {
      const pts = []; for (let i = 0; i <= 40; i++) { const f = i / 40, a = f * TAU * 1.6, r = R * (1 - f * 0.85); pts.push(V3(s * (cx + Math.cos(a) * r - R), cy + Math.sin(a) * r + R * 0.4, 0)); }
      P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.17, 5, false), GOLD, 0, 0, WALL_Z + 0.25);
    }
    // a crescent moon over one shoulder and a sun over the other, both lit from within
    const G = this.glowPaint;
    const moon = new THREE.Shape(); moon.absarc(0, 0, 2.7, -Math.PI * 0.62, Math.PI * 0.62, false); moon.absarc(1.35, 0, 2.25, Math.PI * 0.76, -Math.PI * 0.76, true);
    G.add(new THREE.ExtrudeGeometry(moon, { depth: 0.5, bevelEnabled: false }), 0xffe6a8, -32, 37.4, WALL_Z - 0.2, 0, 0, 0.35);
    P.cyl(0.12, 0.12, 2.2, -32, 33, WALL_Z + 0.05, GOLD, 6);
    G.add(new THREE.CylinderGeometry(1.9, 1.9, 0.5, 28), 0xffc94a, 32, 37.4, WALL_Z + 0.05, 0, Math.PI / 2, 0);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, L = i % 2 ? 1.1 : 1.9; P.add(new THREE.ConeGeometry(0.34, L, 4), GOLD, 32 + Math.cos(a) * (2.2 + L / 2), 37.4 + Math.sin(a) * (2.2 + L / 2), WALL_Z + 0.05, 0, 0, a - Math.PI / 2); }
    P.cyl(0.12, 0.12, 2.2, 32, 33, WALL_Z + 0.05, GOLD, 6);
    // the great central tower behind the gable, and the finial over it
    const tip = this._turret(P, 0, -16.6, 3.4, 38, 55, 10.5, TEAL, { big: true, windows: false });
    this.crownY = tip;
    // facade turrets, shorter toward the wings
    this._turret(P, -13, FRONT_Z - 1.55, 1.5, 0, 46, 8.5, PLUM); this._turret(P, 13, FRONT_Z - 1.55, 1.5, 0, 46, 8.5, PLUM);
    for (const s of [-1, 1]) {
      this._turret(P, s * 24, -11.8 - 1.7, 1.7, 0, 42, 6.5, GOLD, { onion: true });
      this._turret(P, s * 40, -11.8 - 2.0, 2.0, 0, 36, 9, TEAL);
      this._turret(P, s * 66, -11.8 - 1.8, 1.8, 0, 28.5, 6, ROSE, { onion: true });
      this._turret(P, s * 84, -11.8 - 2.2, 2.2, 0, 22, 8, SLATE);
    }
    // fairy lights along every roofline and up the gable
    const edge = (pts, per) => this.lights.addStrip('roofline', pathPoly(pts.map(p => V3(p[0], p[1] + 1.25, p[2] ?? WALL_Z + 0.1)), per, false), 0.3, { kind: 'roofline' });
    for (const s of [-1, 1]) {
      edge([[s * 82, 18], [s * 68, 18]], 12); edge([[s * 64, 25], [s * 42, 25]], 18); edge([[s * 38, 33], [s * 26, 33]], 10); edge([[s * 22, 39], [s * 15, 39]], 6);
      this.lights.addStrip('gable', pathLine(V3(s * 12.4, 42.4, FRONT_Z + 0.2), V3(s * 0.5, 53.4, FRONT_Z + 0.2), 26), 0.32, { kind: 'gable' });
    }
    this.lights.addStrip('rose', pathArc(V3(0, 43.5, FRONT_Z + 0.5), 5.25, 0, TAU, 44, 'xy', true), 0.3, { kind: 'rose' });
    // windows: rows across the wall where it shows (above and beside the LED walls)
    for (let x = -81.4; x <= 81.4; x += 2.6) {
      const ax = Math.abs(x);
      if ([13, 24, 40, 66, 84].some(tx => Math.abs(ax - tx) < 2.7)) continue;
      const front = ax < 13, top = wallTop(ax) - (front ? 3.4 : 2.6);
      for (let y = 5.5; y < top; y += 3.6) {
        if (ax < 23.5 && y < 29.5) continue;                 // behind the main wall and ribbon
        if (ax < 39 && y < 23) continue;                     // behind the wings
        if (ax < 46 && y < 8) continue;
        if (Math.hypot(x, y - 43.5) < 9) continue;           // the rose window and its sunburst
        if (Math.hypot(ax - 32, y - 29.2) < 4) continue;     // side medallions
        if (ax > 50 && ax < 80 && y < 23.5) continue;        // the wing houses stand here
        this.win.push({ x, y, z: (front ? FRONT_Z : WALL_Z) + 0.05, w: 0.8, h: 1.9, ry: 0 });
      }
    }
  }

  _towers(P) {
    // the two great towers flanking the set, just outside and behind the rig towers
    for (const s of [-1, 1]) {
      const x = s * 50.6, z = -4.2;
      P.cyl(3.5, 3.9, 3, x, 0, z, STONE_DK, 20);
      this._turret(P, x, z, 3.2, 3, 33, 0.01, STONE, { big: true, flag: false });     // shaft + gallery (roof replaced by the lantern below)
      P.cyl(2.5, 2.5, 8, x, 33.4, z, STONE_LT, 18);                                  // lantern
      P.cyl(3.0, 2.5, 0.8, x, 40.6, z, STONE_DK, 18); P.cyl(3.05, 3.05, 0.35, x, 41.4, z, GOLD, 18);
      P.lathe(hatProfile(3.9, 14), x, 41.7, z, s < 0 ? PLUM : PLUM, 20);
      P.cyl(0.07, 0.12, 3, x, 55.4, z, GOLD, 6); P.ball(0.42, x, 56.4, z, GOLD); P.ball(0.24, x, 57.4, z, GOLD);
      this.flagAt.push({ x, y: 58.2, z });
      const sp = []; for (let i = 0; i < 80; i++) { const f = i / 80 * 0.93, a = f * 4 * TAU; sp.push(V3(x + Math.sin(a) * (hatRadius(3.9, f) + 0.12), 41.7 + 14 * f, z + Math.cos(a) * (hatRadius(3.9, f) + 0.12))); }
      this.lights.addStrip('spiral', sp, 0.3, { kind: 'spiral' });
      this.lights.addStrip('ring', pathArc(V3(x, 41.2, z), 3.2, -0.1, Math.PI + 0.1, 26, 'xz'), 0.3, { kind: 'ring' });
      for (const a of [-0.75, 0, 0.75]) this.win.push({ x: x + Math.sin(a) * 2.54, y: 37, z: z + Math.cos(a) * 2.54, w: 0.95, h: 2.6, ry: a });
      for (let k = 0; k < 5; k++) for (const a of [-0.7, 0.05, 0.8]) this.win.push({ x: x + Math.sin(a + k * 0.2) * 3.3, y: 8 + k * 5, z: z + Math.cos(a + k * 0.2) * 3.3, w: 0.85, h: 2, ry: a + k * 0.2 });
      // a small bartizan hanging off the shaft
      this._turret(P, x + s * 3.4, z + 1.2, 1.1, 20, 29, 5, TEAL, { flag: false });
      P.lathe([[0.001, 0], [1.16, 2.4]], x + s * 3.4, 17.6, z + 1.2, STONE_DK, 12);
      // brazier bowl under the tower-top flame of the rig tower
      P.lathe([[0.2, 0], [0.5, 0.25], [1.25, 0.95], [1.35, 1.15]], s * 46, 31.2, 0, GOLD, 12);
    }
  }

  _wings(P) {
    // storybook houses against the wing walls
    for (const s of [-1, 1]) {
      for (const [x, w, h, peak, d, body, roof] of [[56.5, 9, 15.5, 7, 3.4, CREAM, ROSE], [73.5, 10.5, 12, 6, 3.0, CREAM, TEAL]]) {
        const sh = new THREE.Shape(); [[-w / 2, 0], [-w / 2, h], [0, h + peak], [w / 2, h], [w / 2, 0]].forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
        const zf = WALL_Z + d;
        P.add(new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }), body, s * x, 0, WALL_Z);
        const len = Math.hypot(w / 2, peak) + 1.2, ang = Math.atan2(peak, w / 2);
        for (const q of [-1, 1]) P.add(new THREE.BoxGeometry(len, 0.5, d + 1.2), roof, s * x + q * (w / 4 + 0.2), h + peak / 2 + 0.15, WALL_Z + d / 2 + 0.3, 0, 0, -q * ang);
        // half-timbering
        for (const yy of [h * 0.36, h * 0.7, h]) P.box(w, 0.32, 0.14, s * x, yy, zf + 0.04, WOOD);
        for (const xx of [-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2]) P.box(0.32, h, 0.14, s * x + xx, h / 2, zf + 0.04, WOOD);
        P.box(0.32, peak * 0.8, 0.14, s * x, h + peak * 0.4, zf + 0.04, WOOD);
        P.ball(0.3, s * x, h + peak + 0.7, WALL_Z + d / 2, GOLD);
        for (const yy of [h * 0.2, h * 0.53, h * 0.85]) for (const xx of [-w / 3, 0, w / 3]) this.win.push({ x: s * x + xx, y: yy, z: zf + 0.12, w: 0.85, h: 1.7, ry: 0 });
        this.win.push({ x: s * x, y: h + peak * 0.35, z: zf + 0.12, w: 0.8, h: 1.5, ry: 0 });
        for (const q of [-1, 1]) this.lights.addStrip('eave', pathLine(V3(s * x + q * (w / 2 + 0.5), h - 0.3, zf + 0.75), V3(s * x, h + peak + 0.45, zf + 0.75), 14), 0.28, { kind: 'roofline' });
      }
      // a gatehouse arch closing each wing end
      P.box(5, 9, 2.4, s * 64.8, 4.5, WALL_Z + 1.2, STONE_DK);
      this.win.push({ x: s * 64.8, y: 3.4, z: WALL_Z + 2.46, w: 2.6, h: 5.6, ry: 0, gate: true });
    }
  }

  _frontDress(P) {
    // stone columns behind the front truss legs, and gold cresting along the front truss
    for (const s of [-1, 1]) {
      const x = s * 37.7, z = 4.5;
      P.cyl(1.35, 1.5, 1.6, x, 0, z, STONE_DK, 14); P.cyl(1.0, 1.1, 22.6, x, 1.6, z, STONE_LT, 14);
      for (const y of [8, 15, 22]) P.cyl(1.16, 1.16, 0.3, x, y, z, GOLD, 14);
      P.cyl(1.45, 1.05, 1.0, x, 24.2, z, STONE_DK, 14); P.cyl(1.5, 1.5, 0.3, x, 25.2, z, GOLD, 14);
      P.lathe(onionProfile(0.95, 2.6), x, 25.5, z, GOLD, 12); P.ball(0.22, x, 28.4, z, GOLD);
      this.lights.addStrip('col', pathArc(V3(x, 25.0, z), 1.6, 0, TAU, 12, 'xz', true), 0.26, { kind: 'ring' });
    }
    for (let x = -35; x <= 35; x += 1.4) P.add(new THREE.ConeGeometry(0.2, x % 7 === 0 ? 1.3 : 0.8, 5), GOLD, x, 25.9 + (x % 7 === 0 ? 0.65 : 0.4), 5.75);
  }

  _flora(P, G) {
    // giant mushrooms and lantern buds beside the set (outside its width, clear of the crowd and of every camera line)
    this.caps = [];
    for (const s of [-1, 1]) {
      for (const [x, z, h, R, col] of [[58, 3.5, 9.5, 4.4, 0xff2e63], [64.5, 7.5, 5.6, 2.9, 0x2ec4ff], [71.5, 2.5, 12, 5.2, 0x9d4edd], [78.5, 6.5, 6.4, 3.2, 0xffb627], [86, 3, 8.5, 3.8, 0x2bff9a]]) {
        const lean = (rnd() - 0.5) * 0.16;
        P.lathe([[R * 0.2, 0], [R * 0.15, h * 0.35], [R * 0.11, h * 0.8], [R * 0.17, h]], s * x, 0, z, CREAM, 10);
        P.lathe([[R * 0.17, 0], [R * 0.4, -0.5], [R * 0.17, -0.9]], s * x, h * 0.82, z, CREAM, 10);   // skirt
        const cap = new THREE.SphereGeometry(R, 18, 8, 0, TAU, 0, Math.PI / 2); cap.scale(1, 0.62, 1);
        G.add(cap, col, s * x, h, z, 0, lean, 0);
        const gills = new THREE.CircleGeometry(R * 0.97, 18); G.add(gills, 0x332218, s * x, h + 0.02, z, 0, Math.PI / 2, 0);
        for (let i = 0; i < 9; i++) {
          const a = rnd() * TAU, e = 0.25 + rnd() * 1.0, rr = R * Math.sin(e), yy = R * 0.62 * Math.cos(e);
          const spot = new THREE.SphereGeometry(R * (0.07 + rnd() * 0.06), 7, 5); spot.scale(1, 0.45, 1);
          G.add(spot, 0xfff2d8, s * x + Math.sin(a) * rr, h + yy + 0.04, z + Math.cos(a) * rr);
        }
      }
      // curling vines with lantern buds climbing the wing wall
      for (const [x0, top] of [[47, 22], [69, 15]]) {
        const pts = []; for (let i = 0; i <= 30; i++) { const f = i / 30; pts.push(V3(s * (x0 + Math.sin(f * 7) * 1.6 * (1 - f * 0.3)), f * top, WALL_Z + 0.5 + Math.cos(f * 9) * 0.25)); }
        P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.22, 5, false), MOSS);
        const buds = []; for (let i = 4; i <= 30; i += 4) buds.push(pts[i].clone().add(V3(0, 0, 0.5)));
        this.lights.addStrip('buds', buds, 0.7, { kind: 'bud' });
      }
    }
  }

  _buildPaint(P, G) {
    const U = this.uniforms = { uT: { value: 0 }, uWarm: { value: 0.6 }, uWashA: { value: new THREE.Color(1, 1, 1) }, uWashB: { value: new THREE.Color(1, 1, 1) }, uWashK: { value: 0.3 } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFsPos = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;\nuniform float uT, uWarm, uWashK;\nuniform vec3 uWashA, uWashB;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // coursed masonry on the grey stone only (gold, roofs and timber stay clean); fades out before it can shimmer
          vec3 fsC = vColor.rgb;
          float fsMx = max(fsC.r, max(fsC.g, fsC.b)), fsMn = min(fsC.r, min(fsC.g, fsC.b));
          float fsStone = (1.0 - smoothstep(0.3, 0.5, (fsMx - fsMn) / max(fsMx, 1e-4))) * (1.0 - smoothstep(0.42, 0.55, fsMx));
          vec2 fsB = vec2(vFsPos.x + vFsPos.z * 0.8, vFsPos.y) / vec2(1.5, 0.7);
          fsB.x += 0.5 * floor(mod(fsB.y, 2.0));
          vec2 fsF = abs(fract(fsB) - 0.5);
          float fsFade = fsStone * (1.0 - smoothstep(0.06, 0.22, fwidth(fsB.y)));
          float fsTone = 1.0 - 0.5 * fsFade * max(smoothstep(0.45, 0.49, fsF.x), smoothstep(0.42, 0.48, fsF.y));
          fsTone *= 1.0 + (fract(sin(dot(floor(fsB), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.4 * fsFade;
          diffuseColor.rgb *= fsTone;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // architectural lighting without lights: warm uplight from the base, show-colour wash chasing up the towers
          float fsUp = clamp(vFsPos.y / 60.0, 0.0, 1.0), fsSide = clamp(abs(vFsPos.x) / 84.0, 0.0, 1.0);
          vec3 fsWash = mix(uWashA, uWashB, smoothstep(0.25, 0.75, fsSide));
          float fsChase = 0.7 + 0.3 * sin(vFsPos.y * 0.3 - uT * 2.2 + fsSide * 5.0);
          totalEmissiveRadiance += fsC * fsTone * (uWarm * vec3(1.0, 0.7, 0.42) * (0.25 + 1.1 * pow(1.0 - fsUp, 2.0)) + fsWash * uWashK * (0.4 + 0.6 * fsUp) * fsChase);`);
    };
    this.paintMesh = new THREE.Mesh(P.merged(), mat);
    this.group.add(this.paintMesh);
    // self-lit pieces (mushroom caps): vertex colours times one pulsing scalar
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
    this.glowMesh = new THREE.Mesh(G.merged(), this.glowMat);
    this.group.add(this.glowMesh);
  }

  _buildGlass() {
    const tex = this.glassTex = stainedGlass();
    this.glassMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true });
    const rose = new THREE.Mesh(new THREE.CircleGeometry(4.75, 48), this.glassMat); rose.position.set(0, 43.5, FRONT_Z + 0.08);
    this.group.add(rose); this.rose = rose;
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.CircleGeometry(2.8, 36), this.glassMat); m.position.set(s * 32, 29.2, WALL_Z + 0.08); m.rotation.z = s * 0.3; this.group.add(m); }
  }

  _buildAstrolabe() {
    // three gold rings carrying jewels, turning in front of the rose window (clear of the arches below and the wall behind)
    this.rings = [];
    const gold = this.ringMat = new THREE.MeshLambertMaterial({ color: GOLD, emissive: new THREE.Color(GOLD).multiplyScalar(0.55) });
    const gemGeo = new THREE.OctahedronGeometry(0.34, 0);
    this.gemMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    [5.6, 6.3, 7.0].forEach((r, i) => {
      const pivot = new THREE.Group(); pivot.position.set(0, 43.5, -8.6);
      const ring = new THREE.Group(); pivot.add(ring);
      ring.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.13, 6, 56), gold));
      const n = 6 + i * 2;
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU, g = new THREE.Mesh(gemGeo, this.gemMats[i]); g.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); ring.add(g); }
      this.group.add(pivot); this.rings.push({ pivot, ring, i });
    });
  }

  _buildWindows() {
    const sh = new THREE.Shape(); sh.moveTo(-0.5, -0.5); sh.lineTo(0.5, -0.5); sh.lineTo(0.5, 0.2); sh.absarc(0, 0.2, 0.5, 0, Math.PI, false); sh.lineTo(-0.5, -0.5);
    const n = this.win.length;
    const mesh = this.winMesh = new THREE.InstancedMesh(new THREE.ShapeGeometry(sh, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.winSeed = new Float32Array(n);
    this.win.forEach((w, i) => {
      _e.set(0, w.ry, 0); _q.setFromEuler(_e);
      mesh.setMatrixAt(i, _m.compose(_v.set(w.x, w.y, w.z), _q, _s.set(w.w, w.h, 1)));
      this.winSeed[i] = rnd();
    });
    this.group.add(mesh);
  }

  _buildFlags() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.55, 0, 0, -0.55, 0, 3.2, 0, 0]), 3));
    const n = this.flagAt.length;
    const mesh = this.flagMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), n);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
  }

  update(show, dt, levels) {
    const t = this.t += dt;
    const ph = show.phase, hot = ph === 'drop' || ph === 'peak', calm = ph === 'breakdown' || ph === 'intro' || ph === 'idle';
    const A = show.colorA, B = show.colorB, C = show.colorC, U = this.uniforms;
    const energy = clamp(show.energy ?? 0.5, 0, 1), pulse = show.beatPulse ?? 0, kick = show.kick ?? 0;
    // facade lighting
    U.uT.value = t;
    U.uWarm.value += ((calm ? 0.7 : hot ? 0.32 : 0.5) - U.uWarm.value) * Math.min(1, dt * 1.5);
    U.uWashA.value.copy(A); U.uWashB.value.copy(B);
    const washT = (calm ? 0.35 : hot ? 0.95 : 0.6) + (hot ? 0.55 : 0.2) * kick;
    U.uWashK.value += (washT - U.uWashK.value) * Math.min(1, dt * (washT > U.uWashK.value ? 14 : 4));
    // stained glass breathes with the beat; the astrolabe turns with the energy
    this.glassMat.color.setScalar(0.75 + 0.5 * pulse + (hot ? 0.35 : 0));
    this.rose.rotation.z -= dt * (0.03 + 0.12 * energy);
    this.spin += dt * (0.12 + (hot ? 0.9 : 0.3) * energy);
    for (const r of this.rings) {
      const i = r.i, dir = i % 2 ? -1 : 1;
      r.ring.rotation.z = dir * this.spin * (1 + i * 0.35);
      r.pivot.rotation.x = Math.sin(this.spin * 0.5 + i * 2.1) * 0.3;
      r.pivot.rotation.y = Math.cos(this.spin * 0.37 + i * 1.3) * 0.3;
      this.gemMats[i].color.copy([A, B, C][i]).multiplyScalar(1.2 + 1.6 * pulse);
    }
    this.glowMat.color.setScalar(0.5 + 0.45 * (levels ? levels[1] : 0) + 0.3 * pulse);
    // windows: warm candle flicker, every fifth one in the show colour, all lifted by their band of the spectrum
    const wc = this.winMesh.instanceColor.array, ws = this.winSeed, nW = this.win.length;
    for (let i = 0; i < nW; i++) {
      const s = ws[i], w = this.win[i];
      const band = levels ? levels[(Math.abs(w.x) * 0.09) & 7] : 0;
      const fl = 0.72 + 0.28 * Math.sin(t * (1.5 + s * 4) + s * 40);
      const k = (w.gate ? 1.5 : 1.0) * fl * (0.75 + 0.9 * band);
      if (s < 0.2) { const c = s < 0.1 ? A : B; wc[i * 3] = c.r * k * 1.3; wc[i * 3 + 1] = c.g * k * 1.3; wc[i * 3 + 2] = c.b * k * 1.3; }
      else if (s > 0.93 && !w.gate) { wc[i * 3] = wc[i * 3 + 1] = wc[i * 3 + 2] = 0.015; }   // a few dark rooms
      else { wc[i * 3] = 1.35 * k; wc[i * 3 + 1] = 0.72 * k; wc[i * 3 + 2] = 0.24 * k; }
    }
    this.winMesh.instanceColor.needsUpdate = true;
    // fairy lights: warm twinkle; on a drop the rooflines chase in the show colours
    const L = this.lights, tp = this.twPhase, tsp = this.twSpeed;
    for (const s of L.strips) {
      const kind = s.meta.kind, chase = hot && kind !== 'bud';
      for (let j = 0; j < s.count; j++) {
        const idx = s.start + j, tw = 0.55 + 0.45 * Math.sin(t * tsp[idx] + tp[idx]);
        if (kind === 'bud') { const c = (j & 1) ? B : C; L.setPixelC(idx, c, 0.9 + 1.2 * tw * (0.4 + pulse)); continue; }
        if (chase) {
          const w = Math.sin(j * 0.45 - t * 9) > 0.2 ? 1 : 0.12, c = (j + ((t * 2) | 0)) % 3 === 0 ? A : (j % 3 === 1 ? B : C);
          L.setPixelC(idx, c, (0.6 + 1.6 * kick) * w + 0.25);
        } else { const k = (calm ? 1.5 : 1.15) * tw; L.setPixel(idx, 1.5 * k, 0.86 * k, 0.34 * k); }
      }
    }
    L.commit();
    // pennants stream in a breeze
    const fc = this.flagMesh.instanceColor.array;
    this.flagAt.forEach((f, i) => {
      _e.set(0, 0.5 + Math.sin(t * 0.9 + i * 1.7) * 0.5, Math.sin(t * 2.3 + i) * 0.12); _q.setFromEuler(_e);
      this.flagMesh.setMatrixAt(i, _m.compose(_v.set(f.x, f.y, f.z), _q, _s.set(1, 1, 1)));
      const c = [A, B, C][i % 3]; fc[i * 3] = 0.25 + c.r * 0.9; fc[i * 3 + 1] = 0.25 + c.g * 0.9; fc[i * 3 + 2] = 0.25 + c.b * 0.9;
    });
    this.flagMesh.instanceMatrix.needsUpdate = true; this.flagMesh.instanceColor.needsUpdate = true;
  }
}
