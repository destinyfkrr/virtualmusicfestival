// Artist signature centrepieces: the structure that hangs in front of the main wall.
// Each centre is built from pixel strips (plus optional truss bars, laser sources and LED panels)
// and animated by shape-agnostic patterns that use every pixel's polar coordinates around the
// centre origin, so a "kick wave from the middle" works on a plus, a ring, a sphere or a cube alike.
import * as THREE from 'three';
import { PixelStrips, LaserBank, LedPanel, V3, pathLine, pathArc, pathCircle, pathRect, pathRegular, pathPoly, pathSpiral } from './fixtures.js';

export const ORIGIN = V3(0, 15, -5);
const O = ORIGIN;
const P3 = (x, y, z = O.z) => V3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);
const frac = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }

const barMats = new Map();
function barMat(color) {
  if (!barMats.has(color)) barMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.75 }));
  return barMats.get(color);
}

// ---------------------------------------------------------------- builder handed to each centre definition
class Builder {
  constructor() {
    this.group = new THREE.Group();
    this.parts = []; this.all = []; this.tags = {}; this.lasers = []; this.panels = []; this.bars = [];
    this.root = this.part(O, 'root');
  }
  /** a part is a group with its own pixel mesh; kin = { axis, mode:'spin'|'rock', rate, amp, base:[x,y,z], order } */
  part(pivot = O, name = 'part', kin = null) {
    const p = { name, pivot: pivot.clone(), pix: new PixelStrips(), group: new THREE.Group(), strips: [], kin, angle: 0 };
    p.group.position.copy(p.pivot);
    if (kin) { p.group.rotation.order = kin.order || 'XYZ'; }
    this.parts.push(p); this.cur = p;
    return p;
  }
  use(p) { this.cur = p; return this; }
  strip(points, size = 0.4, tag = 'main', meta = {}) {
    const p = this.cur;
    const s = p.pix.addStrip(tag, points.map(q => q.clone().sub(p.pivot)), size, meta);
    s.part = p; s.tag = tag; s.world = points; s.idx = this.all.length;
    (this.tags[tag] ||= []).push(s); p.strips.push(s); this.all.push(s);
    return s;
  }
  bar(a, b, r = 0.14, color = 0x1c1c24) {
    const p = this.cur;
    const la = a.clone().sub(p.pivot), lb = b.clone().sub(p.pivot);
    const len = la.distanceTo(lb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), barMat(color));
    m.position.copy(la).add(lb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lb.clone().sub(la).normalize());
    p.group.add(m); this.bars.push(m);
    return m;
  }
  laser(pos, beams = 8, opts = {}) { this.lasers.push({ pos: pos.clone(), beams, opts }); }
  panel(cw, ch, w, h, pos, opts = {}) { this.panels.push({ cw, ch, w, h, pos: pos.clone(), opts }); }
  finish() {
    for (const p of this.parts) { p.mesh = p.pix.build(); p.group.add(p.mesh); this.group.add(p.group); }
  }
}

function ellipse(cx, cy, rx, ry, n, z = O.z) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(V3(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z)); }
  return pts;
}
function cubeEdges(b, c, s, size, tag) {
  const v = [];
  for (let i = 0; i < 8; i++) v.push(V3(c.x + (i & 1 ? s : -s), c.y + (i & 2 ? s : -s), c.z + (i & 4 ? s : -s)));
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  E.forEach(([a, d], i) => b.strip(pathLine(v[a], v[d], Math.round(s * 2.6)), size, tag, { band: i % 8 }));
}

// ---------------------------------------------------------------- centre definitions
export const CENTRES = {
  // Martin Garrix: the big "+"
  plus: { build(b) {
    const arm = 9, w = 1.5;
    for (const off of [-w / 2, 0, w / 2]) {
      b.strip(pathLine(P3(off, O.y - arm), P3(off, O.y + arm), 46), 0.42, 'v', { arm: 'v' });
      b.strip(pathLine(P3(-arm, O.y + off), P3(arm, O.y + off), 46), 0.42, 'h', { arm: 'h' });
    }
    const o = w / 2 + 0.6, e = arm + 0.6;
    const pts = [P3(-o, O.y + e), P3(o, O.y + e), P3(o, O.y + o), P3(e, O.y + o), P3(e, O.y - o), P3(o, O.y - o), P3(o, O.y - e), P3(-o, O.y - e), P3(-o, O.y - o), P3(-e, O.y - o), P3(-e, O.y + o), P3(-o, O.y + o)];
    b.strip(pathPoly(pts, 7), 0.28, 'outline');
    b.bar(P3(0, O.y + e), V3(0, 28, -8), 0.1);
    b.bar(P3(-e, O.y + o), V3(-12, 28, -8), 0.08); b.bar(P3(e, O.y + o), V3(12, 28, -8), 0.08);
  } },
  // five pixel towers with VU behaviour (the most common festival rig)
  towers: { build(b) {
    [-14, -7, 0, 7, 14].forEach((x, ti) => {
      const y0 = 5.5, y1 = 25;
      for (const dx of [-0.6, 0.6]) b.strip(pathLine(P3(x + dx, y0), P3(x + dx, y1), 40), 0.42, 'tower', { band: ti + 1, tower: ti });
      b.bar(P3(x - 0.95, y0 - 0.3), P3(x - 0.95, y1 + 0.8), 0.1); b.bar(P3(x + 0.95, y0 - 0.3), P3(x + 0.95, y1 + 0.8), 0.1);
      b.strip(pathRect(P3(x, y1 + 1.2), 2.4, 1.1, 3), 0.3, 'cap', { band: ti + 1 });
    });
  } },
  // three concentric arches with hanging drips
  arch: { build(b) {
    const c = P3(0, 5);
    [17, 15.6, 14.2].forEach((r, i) => b.strip(pathArc(c, r, 0.1, Math.PI - 0.1, Math.round(r * 4.4), 'xy'), 0.42 - i * 0.03, 'arc', { ring: i }));
    for (let i = 0; i < 9; i++) {
      const a = 0.3 + (Math.PI - 0.6) * i / 8, r = 13.4;
      const x = Math.cos(a) * r, y = 5 + Math.sin(a) * r;
      b.strip(pathLine(P3(x, y), P3(x, y - 3.6), 9), 0.32, 'drip', { band: i % 8 });
    }
    b.bar(P3(-17.4, 5.5), P3(-17.4, 2.4), 0.18); b.bar(P3(17.4, 5.5), P3(17.4, 2.4), 0.18);
  } },
  // nested rectangular frames with corner diagonals
  frame: { build(b) {
    b.strip(pathRect(O, 26, 15, 30), 0.42, 'ring', { ring: 0 });
    b.strip(pathRect(O, 22, 11, 26), 0.36, 'ring', { ring: 1 });
    b.strip(pathRect(O, 18, 7, 20), 0.32, 'ring', { ring: 2 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.strip(pathLine(P3(sx * 13, O.y + sy * 7.5), P3(sx * 9, O.y + sy * 3.5), 8), 0.3, 'diag', { band: (sx + 1) + (sy + 1) / 2 });
    for (const sx of [-1, 1]) b.bar(P3(sx * 13, O.y + 7.5), V3(sx * 13, 28, -8), 0.1);
  } },
  triangle: { build(b) {
    const c = P3(0, 14.5);
    [11, 8.5, 6, 3.5].forEach((r, i) => b.strip(pathRegular(c, r, 3, Math.round(r * 3.4), Math.PI / 2), 0.42 - i * 0.03, 'ring', { ring: i }));
    b.bar(P3(0, 25.5), V3(0, 28, -8), 0.1);
  } },
  hex: { build(b) {
    [11, 8.5, 6, 3.5].forEach((r, i) => b.strip(pathRegular(O, r, 6, Math.round(r * 2.6), Math.PI / 6), 0.4, 'ring', { ring: i }));
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + k * Math.PI / 3;
      b.strip(pathLine(P3(Math.cos(a) * 3.5, O.y + Math.sin(a) * 3.5), P3(Math.cos(a) * 11, O.y + Math.sin(a) * 11), 14), 0.3, 'spoke', { band: k + 1 });
    }
  } },
  ring: { build(b) {
    b.part(O, 'ring', { axis: 'x', mode: 'rock', rate: 0.45, amp: 0.4 });
    b.strip(pathCircle(O, 10, 100, 'xy'), 0.44, 'ring', { ring: 0 });
    b.strip(pathCircle(O, 9, 90, 'xy'), 0.34, 'ring', { ring: 1 });
    b.use(b.root);
    b.strip(pathLine(P3(-21, O.y), P3(21, O.y), 84), 0.34, 'bar');
    b.bar(P3(0, O.y + 10.4), V3(0, 28, -8), 0.1);
  } },
  rings: { build(b) {
    [[11, 'x', 0.35], [8.5, 'y', 0.5], [6, 'z', 0.75]].forEach(([r, axis, rate], i) => {
      b.part(O, 'r' + i, { axis, mode: 'spin', rate, base: [0.2 * i, 0, 0], order: 'YXZ' });
      b.strip(pathCircle(O, r, Math.round(r * 9), 'xy'), 0.4, 'ring', { ring: i });
    });
  } },
  orbit: { build(b) {
    b.strip(pathCircle(O, 3, 30, 'xy'), 0.5, 'core', { ring: 0 });
    b.strip(pathCircle(O, 2.2, 22, 'xz'), 0.5, 'core', { ring: 0 });
    [[9.5, 0.55, 0.6], [7.5, -0.7, -0.8], [5.5, 1.1, 0.5]].forEach(([r, tilt, rate], i) => {
      b.part(O, 'orb' + i, { axis: 'y', mode: 'spin', rate, base: [tilt, 0, 0], order: 'YXZ' });
      b.strip(pathCircle(O, r, Math.round(r * 9), 'xz'), 0.38, 'ring', { ring: i + 1 });
    });
  } },
  x: { build(b) {
    for (const off of [-0.7, 0, 0.7]) {
      b.strip(pathLine(P3(-10 - off, 5 + off), P3(10 - off, 25 + off), 62), 0.42, 'd1', { arm: 'a' });
      b.strip(pathLine(P3(-10 + off, 25 + off), P3(10 + off, 5 + off), 62), 0.42, 'd2', { arm: 'b' });
    }
    b.bar(P3(-10, 25.8), V3(-10, 28, -8), 0.1); b.bar(P3(10, 25.8), V3(10, 28, -8), 0.1);
  } },
  sphere: { build(b) {
    b.part(O, 'sphere', { axis: 'y', mode: 'spin', rate: 0.45, base: [0.3, 0, 0], order: 'YXZ' });
    const R = 8;
    for (let k = -2; k <= 2; k++) {
      const y = k * R / 3, r = Math.sqrt(R * R - y * y);
      b.strip(pathCircle(V3(O.x, O.y + y, O.z), r, Math.round(r * 8), 'xz'), 0.4, 'ring', { ring: k + 2 });
    }
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 4, pts = [];
      for (let i = 0; i < 64; i++) { const t = (i / 64) * Math.PI * 2, x = Math.cos(t) * R, y = Math.sin(t) * R; pts.push(V3(O.x + x * Math.cos(a), O.y + y, O.z + x * Math.sin(a))); }
      b.strip(pts, 0.34, 'lon', { band: k + 1 });
    }
  } },
  plusbars: { build(b) {
    for (let i = 0; i < 9; i++) { const x = -12 + i * 3; b.strip(pathLine(P3(x, 7), P3(x, 23), 36), 0.36, 'v', { band: i % 8 }); }
    for (let j = 0; j < 5; j++) { const y = 8.5 + j * 3.25; b.strip(pathLine(P3(-12, y), P3(12, y), 54), 0.36, 'h', { band: j + 2 }); }
    b.bar(P3(-12, 23.4), V3(-12, 28, -8), 0.08); b.bar(P3(12, 23.4), V3(12, 28, -8), 0.08);
  } },
  tunnel: { build(b) {
    for (let i = 0; i < 7; i++) {
      const f = i / 6, w = 27 - f * 20, h = 15.5 - f * 11.5;
      b.strip(pathRect(V3(0, O.y, -3 - f * 7), w, h, Math.round(w * 1.1)), 0.42 - f * 0.14, 'ring', { ring: i });
    }
  } },
  circle: { build(b) {
    b.strip(pathCircle(O, 10, 100), 0.44, 'ring', { ring: 0 });
    b.strip(pathCircle(O, 5, 50), 0.4, 'ring', { ring: 1 });
    b.part(O, 'rays', { axis: 'z', mode: 'spin', rate: 0.25 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      b.strip(pathLine(P3(Math.cos(a) * 5.8, O.y + Math.sin(a) * 5.8), P3(Math.cos(a) * 9.4, O.y + Math.sin(a) * 9.4), 8), 0.3, 'ray', { band: k % 8 });
    }
  } },
  // Eric Prydz style transparent hologram screen
  holo: { build(b) {
    b.panel(120, 60, 26, 13, V3(0, 16.5, -3.5), { role: 'holo', gain: 1.15, noBack: true, doubleSide: true, additive: true, name: 'holo' });
    b.strip(pathRect(V3(0, 16.5, -3.6), 27, 14, 32), 0.28, 'ring', { ring: 0 });
    b.bar(V3(-13.5, 23.5, -3.6), V3(-13.5, 28, -8), 0.08); b.bar(V3(13.5, 23.5, -3.6), V3(13.5, 28, -8), 0.08);
  } },
  cube: { build(b) {
    const c = V3(0, 15, -4);
    b.part(c, 'cube', { axis: 'y', mode: 'spin', rate: 0.5, base: [0.45, 0, 0.3], order: 'YXZ' });
    cubeEdges(b, c, 5, 0.4, 'ring');
    b.part(c, 'inner', { axis: 'y', mode: 'spin', rate: -0.85, base: [0.45, 0, 0.3], order: 'YXZ' });
    cubeEdges(b, c, 2.6, 0.3, 'inner');
  } },
  // Afterlife: the screen is the show; add a top band and side fillers, no structure
  megawall: { build(b) {
    b.panel(160, 24, 44, 6.6, V3(0, 28.5, -10.5), { role: 'top', gain: 1.2, name: 'top' });
    b.panel(32, 80, 6.5, 22, V3(-25.6, 13.5, -10.5), { role: 'side', name: 'fillL' });
    b.panel(32, 80, 6.5, 22, V3(25.6, 13.5, -10.5), { role: 'side', name: 'fillR' });
  } },
  oval: { build(b) {
    b.strip(ellipse(0, O.y, 13, 7.5, 110), 0.44, 'ring', { ring: 0 });
    b.strip(ellipse(0, O.y, 11.5, 6.2, 96), 0.34, 'ring', { ring: 1 });
    b.strip(pathLine(P3(-11, O.y), P3(11, O.y), 46), 0.36, 'bar');
    b.bar(P3(0, O.y + 7.9), V3(0, 28, -8), 0.1);
  } },
  pillars: { build(b) {
    [-16, -10, -4, 4, 10, 16].forEach((x, i) => {
      for (const [dx, dz] of [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]]) b.strip(pathLine(V3(x + dx, 2.8, O.z + dz), V3(x + dx, 27, O.z + dz), 50), 0.4, 'tower', { band: i + 1, tower: i });
    });
  } },
  // Gareth Emery LSR/CTY: a wall of laser sources
  laserwall: { build(b) {
    for (let i = 0; i < 12; i++) b.laser(V3(-22 + i * 4, 25.5, -4), 8, { yaw: 0, pitch: -0.12, spread: 0.32, meta: { group: 'wall', u: i / 11 } });
    b.strip(pathLine(P3(-23, 25.5), P3(23, 25.5), 92), 0.34, 'bar');
    for (let i = 0; i < 6; i++) b.laser(V3(-20 + i * 8, 6, -4), 6, { pitch: 0.45, spread: 0.5, meta: { group: 'floor', u: i / 5 } });
  } },
  spiral: { build(b) {
    b.part(O, 's', { axis: 'z', mode: 'spin', rate: 0.6 });
    const a = pathSpiral(O, 1.5, 11, 3, 220, 'xy');
    b.strip(a, 0.38, 'spiral', { arm: 'a' });
    b.strip(a.map(p => V3(-p.x, -(p.y - O.y) + O.y, p.z)), 0.38, 'spiral', { arm: 'b' });
  } },
};
export const CENTRE_NAMES = Object.keys(CENTRES);

// ---------------------------------------------------------------- pixel patterns (shape agnostic)
const out = { c: new THREE.Color() };
const PAT = {
  breathe(s, i, P) { out.c.copy(P.A).lerp(P.C, 0.5 + 0.5 * Math.sin(P.t * 0.3 + s.idx)); return 0.2 + 0.15 * Math.sin(P.t * 1.2 + s.d[i] * 4); },
  chase(s, i, P) { const f = frac(s.u[i] * P.rep - P.t * P.speed * (s.idx & 1 ? -1 : 1)); out.c.copy(f < 0.05 ? WHITE : P.A); return f < 0.22 ? 1 - f * 4 : 0.05; },
  sweep(s, i, P) { const a = frac(s.ang[i] - P.t * 0.35 * P.dir); out.c.copy(a < 0.06 ? WHITE : P.B); return 0.05 + Math.pow(1 - a, 5); },
  radialKick(s, i, P) { const pos = P.bp * 1.15, w = Math.exp(-Math.pow((s.d[i] - pos) * 7, 2)); out.c.copy(P.A).lerp(WHITE, w * 0.6); return 0.07 + w * (1 - P.bp * 0.4); },
  radialIn(s, i, P) { const pos = 1.1 - P.bp * 1.15, w = Math.exp(-Math.pow((s.d[i] - pos) * 7, 2)); out.c.copy(P.B).lerp(WHITE, w * 0.5); return 0.07 + w; },
  vu(s, i, P) { const lvl = s.meta.band >= 0 ? P.levels[s.meta.band & 7] : P.level; const h = s.h[i]; if (h > lvl) return 0.03; out.c.copy(P.A).lerp(P.B, h).lerp(WHITE, h > lvl - 0.08 ? 0.7 : 0); return 1; },
  alternate(s, i, P) { const on = ((s.idx + P.beatIdx) & 1) === 0; out.c.copy(on ? P.A : P.B); return on ? 0.35 + 0.65 * P.pulse : 0.08; },
  mirror(s, i, P) { const x = Math.abs(s.xn[i]), e = P.bp * 1.1, k = x < e ? Math.exp(-(e - x) * 4) : 0; out.c.copy(P.barOdd ? P.A : P.B); return 0.05 + k; },
  strobe(s, i, P) { const k = P.kick > 0.05 ? P.kick : P.snare * 0.7; out.c.copy(P.kick > 0.05 ? WHITE : P.B); return 0.03 + k; },
  sparkle(s, i, P) { const r = hash(i * 131 + s.idx * 977 + P.tick * 7919); if (r > P.density) return 0.03; out.c.copy(r < P.density * 0.3 ? WHITE : P.A); return 1; },
  wipeV(s, i, P) { const h = 1 - s.h[i], k = h < P.bp ? Math.exp(-(P.bp - h) * 5) : 0; out.c.copy(P.C); return 0.05 + k; },
  spectrum(s, i, P) { const v = P.spec[(Math.floor(s.ang[i] * 90) + 2) | 0] / 255; out.c.copy(P.A).lerp(P.B, v); return 0.05 + v * v * 1.1; },
  wave(s, i, P) { const k = 0.5 + 0.5 * Math.sin(s.d[i] * 7 - P.t * 2.2 + s.u[i] * 2); out.c.copy(P.C).lerp(P.A, s.h[i]); return 0.04 + 0.38 * k * k; },
  fillOut(s, i, P) { const lit = s.d[i] < P.prog; out.c.copy(P.B).lerp(WHITE, P.prog * P.prog); if (lit) return 0.45 + 0.55 * P.pulse; const r = hash(i * 131 + s.idx * 977 + P.tick * 7919); return r < P.prog * 0.15 ? 0.9 : 0.03; },
  rings(s, i, P) { const r = s.meta.ring ?? (s.idx & 3); const on = ((r + P.beatIdx) % 3) === 0; out.c.copy(on ? WHITE : P.A); return on ? 0.4 + 0.6 * P.pulse : 0.08; },
  bands(s, i, P) { const bnd = (s.meta.band ?? s.idx) & 7; const v = P.levels[bnd]; out.c.copy(P.A).lerp(P.B, v); return 0.05 + v * v; },
  scan(s, i, P) { const x = s.xn[i] * 0.5 + 0.5, p = frac(P.t * 0.9), k = Math.exp(-Math.pow((x - p) * 9, 2)); out.c.copy(P.C).lerp(WHITE, k * 0.6); return 0.05 + k; },
};
const SETS = {
  idle: ['breathe'],
  intro: ['chase', 'breathe', 'sweep', 'scan'],
  groove: ['chase', 'sweep', 'alternate', 'spectrum', 'radialKick', 'bands', 'scan'],
  build: ['fillOut'],
  drop: ['radialKick', 'strobe', 'alternate', 'mirror', 'vu', 'chase', 'sweep', 'wipeV', 'sparkle', 'rings', 'radialIn', 'bands'],
  peak: ['radialKick', 'alternate', 'mirror', 'vu', 'chase', 'sweep', 'rings', 'radialIn', 'bands', 'sparkle'],
  breakdown: ['wave', 'breathe', 'sparkle', 'scan'],
};
const BAND_BINS = [[1, 3], [3, 6], [6, 12], [12, 24], [24, 48], [48, 96], [96, 200], [200, 420]];

// ---------------------------------------------------------------- centrepiece instance
export class Centrepiece {
  constructor(name, style = {}, rng = null) {
    const def = CENTRES[name] || CENTRES.towers;
    this.name = CENTRES[name] ? name : 'towers';
    this.style = style;
    this.b = new Builder();
    def.build(this.b, style, rng);
    this.b.finish();
    this.group = this.b.group;
    this.strips = this.b.all;
    this.parts = this.b.parts;
    this.pixelCount = this.strips.reduce((a, s) => a + s.count, 0);
    // per-pixel polar coordinates around the origin (in world space, before any kinetic motion)
    let maxD = 0.001, minY = Infinity, maxY = -Infinity, maxX = 0.001;
    for (const s of this.strips) for (const p of s.world) { maxD = Math.max(maxD, Math.hypot(p.x - O.x, p.y - O.y)); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); maxX = Math.max(maxX, Math.abs(p.x - O.x)); }
    for (const s of this.strips) {
      s.d = new Float32Array(s.count); s.ang = new Float32Array(s.count); s.h = new Float32Array(s.count); s.xn = new Float32Array(s.count);
      s.world.forEach((p, i) => {
        s.d[i] = Math.hypot(p.x - O.x, p.y - O.y) / maxD;
        s.ang[i] = frac(Math.atan2(p.y - O.y, p.x - O.x) / (Math.PI * 2));
        s.h[i] = maxY > minY ? (p.y - minY) / (maxY - minY) : 0.5;
        s.xn[i] = (p.x - O.x) / maxX;
      });
      if (s.meta.band === undefined) s.meta.band = -1;
    }
    this.lasers = null;
    if (this.b.lasers.length) {
      this.lasers = new LaserBank();
      for (const l of this.b.lasers) this.lasers.add(l.pos, l.beams, l.opts);
      this.group.add(this.lasers.build());
    }
    this.panels = this.b.panels.map(({ cw, ch, w, h, pos, opts }) => {
      const p = new LedPanel(cw, ch, w, h, opts);
      p.mesh.position.copy(pos);
      if (opts.additive) { p.mat.transparent = true; p.mat.blending = THREE.AdditiveBlending; p.mat.depthWrite = false; }
      this.group.add(p.mesh);
      return p;
    });
    this.phase = ''; this.pattern = 'breathe'; this.lastPick = -1; this.dir = 1;
    this.levels = new Float32Array(8);
    this.P = { t: 0, A: WHITE, B: WHITE, C: WHITE, bp: 0, pulse: 0, kick: 0, snare: 0, beatIdx: 0, dir: 1, level: 0, prog: 0, tick: 0, density: 0.05, barOdd: 0, spec: null, speed: 0.5, rep: 3, levels: this.levels };
  }
  pick(ph, rng) {
    const set = SETS[ph] || SETS.groove;
    let p = rng ? rng.pick(set) : set[Math.floor(Math.random() * set.length)];
    if (set.length > 1 && p === this.pattern) p = set[(set.indexOf(p) + 1) % set.length];
    this.pattern = p;
    this.dir = (rng ? rng.chance(0.5) : Math.random() < 0.5) ? 1 : -1;
    this.P.rep = rng ? rng.pick([2, 3, 4, 6]) : 3;
  }
  /** ctx: { A, B, C: THREE.Color, rng: SongRng, gain, dt } */
  update(show, ctx) {
    const P = this.P, ph = show.active ? show.phase : 'idle';
    const rng = ctx.rng;
    if (ph !== this.phase) { this.phase = ph; this.pick(ph, rng); this.lastPick = show.barIndex; }
    else {
      const cadence = ph === 'drop' || ph === 'peak' ? 2 : 4;
      if (show.barIndex !== this.lastPick && show.barIndex % cadence === 0) { this.lastPick = show.barIndex; this.pick(ph, rng); }
    }
    const spec = show.spectrum;
    if (spec) for (let b = 0; b < 8; b++) {
      let m = 0; const [a, e] = BAND_BINS[b];
      for (let k = a; k < e && k < spec.length; k++) if (spec[k] > m) m = spec[k];
      const v = clamp((m / 255 - 0.25) * 1.6, 0, 1);
      this.levels[b] += (v - this.levels[b]) * (v > this.levels[b] ? 0.65 : 0.12);
    }
    P.t = show.t; P.A = ctx.A; P.B = ctx.B; P.C = ctx.C;
    P.bp = clamp(show.beatPhase, 0, 1); P.pulse = show.beatPulse; P.kick = show.kick; P.snare = show.snare; P.beatIdx = show.beatIndex | 0;
    P.dir = this.dir; P.level = clamp(show.bass * 1.15 + show.beatPulse * 0.2, 0, 1); P.prog = clamp(show.buildProgress, 0, 1);
    P.tick = Math.floor(show.t * 16); P.density = 0.02 + show.energy * 0.14; P.barOdd = show.barIndex & 1; P.spec = spec;
    P.speed = 0.35 + show.bpm / 240;
    let fn = PAT[this.pattern] || PAT.breathe;
    if (show.predrop > 0 && ph === 'build') fn = PAT.strobe;
    const gain = ctx.gain ?? 1.6, bo = show.blackout, wo = show.whiteout > 0.5;
    const kf = clamp(show.kick * 0.5 * (ctx.strobes ?? 0.8), 0, 0.6) * (ph === 'drop' || ph === 'peak' ? 1 : 0.3);
    const dim = ph === 'idle' ? 0.5 : ph === 'breakdown' ? 0.7 : 1;
    for (const s of this.strips) {
      const pix = s.part.pix, base = s.start;
      for (let i = 0; i < s.count; i++) {
        let k;
        if (bo) { k = 0; out.c.copy(WHITE); }
        else if (wo) { k = 1; out.c.copy(WHITE); }
        else { out.c.copy(P.A); k = fn(s, i, P); if (kf > 0.02) { out.c.lerp(WHITE, kf); k = Math.max(k, kf); } }
        pix.setPixelC(base + i, out.c, k * gain * dim);
      }
    }
    for (const p of this.parts) {
      p.pix.commit();
      const k = p.kin; if (!k) continue;
      const kin = this.style.kinetic ?? 0.6;
      const mult = ph === 'drop' || ph === 'peak' ? 1.7 : ph === 'breakdown' ? 0.35 : ph === 'idle' ? 0.5 : 1;
      p.angle += (ctx.dt ?? show.dt) * k.rate * (0.4 + kin) * mult;
      const ang = k.mode === 'rock' ? Math.sin(p.angle) * (k.amp ?? 0.3) : p.angle;
      const base = k.base || [0, 0, 0];
      p.group.rotation.set(base[0], base[1], base[2]);
      p.group.rotation[k.axis] += ang;
    }
  }
  dispose() {
    for (const p of this.parts) p.pix.dispose();
    for (const m of this.b.bars) m.geometry.dispose();
    for (const p of this.panels) p.dispose();
    if (this.lasers) { this.lasers.mesh.geometry.dispose(); this.lasers.mat.dispose(); this.lasers.housing.geometry.dispose(); }
    this.group.removeFromParent();
  }
}
