// drones.js - the drone show. A swarm parked dark on the ground behind the set lifts on a breakdown, flies into the
// artist's logo (or the festival's own letters) above and behind the roof line, holds it through the build, and
// scatters when the drop lands. Nothing crosses the air in front of the stage, and an idle swarm is not drawn at all,
// so the black sky keeps no stray dots.
import * as THREE from 'three';
import { drawMark } from './marks.js';

const N = 720, CW = 240, CH = 96;          // drones, and the canvas the formation is sampled from
const PLANE_Z = -46, WIDTH = 70, HEIGHT = 26;           // the formation's plane (site units) and its full width
const GAP = 45, HOLD_MAX = 44;             // seconds between flights, and the longest a formation is held
const h1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class Drones {
  constructor() {
    this.state = 'idle'; this.t = 0; this.since = 0; this.last = -GAP; this.flights = 0; this.used = 0; this.cy = 54; this.lastPhase = '';
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.home = new Float32Array(N * 3); this.tgt = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3); this.delay = new Float32Array(N); this.lit = new Float32Array(N); this.u = new Float32Array(N);
    const ph = new Float32Array(N), order = [];
    for (let i = 0; i < N; i++) { order.push([-42 + 84 * h1(i * 3 + 1), -52 - 20 * h1(i * 3 + 2)]); ph[i] = h1(i * 3 + 3) * 6.283; }
    order.sort((a, b) => a[0] - b[0]);     // drones and targets are both sorted left to right, so flight paths rarely cross
    for (let i = 0; i < N; i++) { this.home[i * 3] = order[i][0]; this.home[i * 3 + 1] = 0.4; this.home[i * 3 + 2] = order[i][1]; }
    this.pos.set(this.home);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uSize: { value: 2.2 }, uScale: { value: 1000 } },
      vertexShader: `attribute vec3 aCol; attribute float aPh; uniform float uT, uSize, uScale; varying vec3 vCol;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float px = uSize * uScale / max(1.0, -mv.z);
          vCol = aCol * (0.82 + 0.18 * sin(uT * 3.1 + aPh)) * min(1.0, px * px / 6.0 + 0.45);
          gl_PointSize = max(2.5, px); }`,
      fragmentShader: `varying vec3 vCol; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, d); gl_FragColor = vec4(vCol * a * a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, fog: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 5;
    this.group = this.points;
    this.canvas = document.createElement('canvas'); this.canvas.width = CW; this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tmpA = new THREE.Color(); this.tmpB = new THREE.Color();
  }

  /** where the formation hangs: clear of the roof line of whichever stage is up */
  anchor(kit) { this.cy = (kit?.hN ?? 32) * 1.12 + 16; }

  // sample the mark into at most N target points, on the coarsest grid that still fits the swarm
  _targets(o) {
    const ctx = this.ctx, vmf = this.flights % 2 === 1 || (!o.logoImg && !o.profile?.mark && !o.text);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, CW, CH);
    const img = vmf ? null : o.logoImg, mark = vmf ? 'text' : img ? 'image' : o.profile?.mark || 'text';
    try { drawMark(ctx, CW, CH, mark, { t: 0, beat: 0, reveal: 1, color: '#ffffff', bg: '#000000', logoImg: img, logoScale: img?.scale, text: vmf ? 'VMF' : o.text || 'VMF' }); }
    catch { ctx.clearRect(0, 0, CW, CH); ctx.fillStyle = '#fff'; ctx.font = '900 72px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VMF', CW / 2, CH / 2); }
    const d = ctx.getImageData(0, 0, CW, CH).data, on = (x, y) => { const k = ((y | 0) * CW + (x | 0)) * 4; return d[k + 3] * (d[k] + d[k + 1] + d[k + 2]) > 255 * 3 * 110; };
    let best = [];
    for (let s = 1.5; s <= 9; s += 0.25) {
      const pts = [];
      for (let y = s / 2; y < CH; y += s) for (let x = s / 2; x < CW; x += s) if (on(x, y)) pts.push([x, y]);
      if (pts.length <= N) { best = pts; break; }
    }
    if (best.length < 40) return 0;
    best.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // fit the lit cells, not the canvas: a mark drawn small in its sheet still fills the formation
    let x0 = CW, x1 = 0, y0 = CH, y1 = 0;
    for (const p of best) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, k = Math.min(WIDTH / Math.max(1, x1 - x0), HEIGHT / Math.max(1, y1 - y0)), n = best.length, step = N / n;
    this.lit.fill(0);
    // spread the used drones evenly through the x-sorted swarm so each target is fed from the ground beneath it
    for (let j = 0; j < n; j++) {
      const i = Math.min(N - 1, Math.floor(j * step + step / 2)), p = best[j];
      this.tgt[i * 3] = (p[0] - mx) * k; this.tgt[i * 3 + 1] = this.cy + (my - p[1]) * k; this.tgt[i * 3 + 2] = PLANE_Z;
      this.lit[i] = 1; this.u[i] = (p[0] - x0) / Math.max(1, x1 - x0);
      this.delay[i] = 0.2 + 2.2 * h1(i * 5 + this.flights) + 1.5 * Math.abs((p[0] - mx) / Math.max(1, x1 - x0));
    }
    return n;
  }

  /** force a flight now (the probe hook and the O key) */
  fly(o, manual = false) {
    if (this.state !== 'idle') return false;
    this.manual = manual;
    this.used = this._targets(o || this._o || {});
    if (!this.used) return false;
    this.pos.set(this.home); this.vel.fill(0); this.col.fill(0);
    this.state = 'rise'; this.since = this.t; this.last = this.t; this.flights++; this.points.visible = true;
    return true;
  }
  scatter() {
    if (this.state !== 'rise' && this.state !== 'hold') return;
    this.state = 'scatter'; this.since = this.t;
    for (let i = 0; i < N; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1] - this.cy, l = Math.hypot(x, y) || 1, sp = 26 + 30 * h1(i * 7 + 9);
      this.vel[i * 3] = x / l * sp; this.vel[i * 3 + 1] = y / l * sp + 8; this.vel[i * 3 + 2] = -14 * h1(i * 7 + 4);
    }
  }
  reset() { this.state = 'idle'; this.points.visible = false; this.col.fill(0); this.points.geometry.attributes.aCol.needsUpdate = true; }

  update(show, dt, o, viewH, fov) {
    this.t += dt; this._o = o;
    // 0..1 while a formation is up: the wide cameras tilt up and pull back by this much to take it in
    this.lift = (this.lift || 0) + ((this.state === 'rise' || this.state === 'hold' ? 1 : 0) - (this.lift || 0)) * Math.min(1, dt * 0.8);
    const ph = show.phase, hot = ph === 'drop' || ph === 'peak';
    if (this.state === 'idle') {
      if (show.active && ph === 'breakdown' && this.lastPhase !== 'breakdown' && this.t - this.last > GAP) this.fly(o);
      this.lastPhase = ph;
      if (this.state === 'idle') return;
    }
    this.lastPhase = ph;
    const age = this.t - this.since, P = this.pos, C = this.col;
    if (this.state === 'rise' && age > 7) { this.state = 'hold'; }
    if ((this.state === 'rise' || this.state === 'hold') && (hot || !show.active)) this.scatter();
    else if (this.state === 'hold' && (this.t - this.last > HOLD_MAX || (!this.manual && ph !== 'breakdown' && ph !== 'build' && age > 12) || (this.manual && age > 30))) { this.state = 'land'; this.since = this.t; }
    const st = this.state, a2 = this.t - this.since;
    const cA = this.tmpA.copy(show.colorA), cB = this.tmpB.copy(show.colorB);
    for (const c of [cA, cB]) { const m = Math.max(c.r, c.g, c.b, 1e-3); c.multiplyScalar(1 / m).lerp(WHITE, 0.18); }
    const gain = 2.1 + 0.9 * (show.beatPulse || 0);
    let fade = 1;
    if (st === 'scatter') fade = Math.max(0, 1 - a2 / 1.3);
    if (st === 'land') fade = Math.max(0, 1 - a2 / 2.5);
    for (let i = 0; i < N; i++) {
      if (!this.lit[i]) continue;
      const k = i * 3;
      let b = 1;
      if (st === 'scatter') { P[k] += this.vel[k] * dt; P[k + 1] += this.vel[k + 1] * dt; P[k + 2] += this.vel[k + 2] * dt; }
      else {
        const go = (this.t - (st === 'rise' ? this.since : -1e3)) - this.delay[i];
        if (go > 0) {
          const e = 1 - Math.exp(-dt * 1.15);
          P[k] += (this.tgt[k] - P[k]) * e; P[k + 2] += (this.tgt[k + 2] - P[k + 2]) * e;
          P[k + 1] += (this.tgt[k + 1] + 0.18 * Math.sin(this.t * 0.9 + i) - P[k + 1]) * (1 - Math.exp(-dt * 1.5));
        }
        const dist = Math.abs(this.tgt[k] - P[k]) + Math.abs(this.tgt[k + 1] - P[k + 1]);
        b = go <= 0 ? 0 : 0.12 + 0.88 * Math.max(0, 1 - dist / 6);      // dim running lights on the way up, full once on station
      }
      const u = this.u[i], g = gain * b * fade;
      C[k] = (cA.r + (cB.r - cA.r) * u) * g; C[k + 1] = (cA.g + (cB.g - cA.g) * u) * g; C[k + 2] = (cA.b + (cB.b - cA.b) * u) * g;
    }
    const G = this.points.geometry; G.attributes.position.needsUpdate = true; G.attributes.aCol.needsUpdate = true;
    this.mat.uniforms.uT.value = this.t;
    this.mat.uniforms.uScale.value = viewH / (2 * Math.tan((fov || 55) * Math.PI / 360));
    if ((st === 'scatter' || st === 'land') && fade <= 0) this.reset();
  }
}
const WHITE = new THREE.Color(1, 1, 1);
