// Stage fixtures. Everything that appears in numbers is instanced so the rig can hold
// thousands of lights at 60 fps:
//   BeamArray    moving heads (base + head + lens + volumetric beam), per-head aim / colour / intensity
//   StrobeArray  strobes, blinders, audience blinders, sun-strips
//   LaserBank    laser sources, each fanning N beams (instanced thin boxes, additive, floor-clipped)
//   PixelStrips  LED pixel dots along arbitrary paths (instanced boxes with instanceColor)
//   LedPanel     canvas-driven LED screens with a dot-matrix shader
//   Crowd        shader-animated audience + phone lights (no per-frame CPU work)
//   Particles    CO2, flames, sparkulars, confetti, fireworks
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- path helpers (Vector3 arrays for pixel strips)
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function pathLine(a, b, n) { const out = []; for (let i = 0; i < n; i++) out.push(a.clone().lerp(b, n === 1 ? 0 : i / (n - 1))); return out; }
/** arc in a plane: 'xy' faces the crowd (z fixed), 'xz' lies flat (y fixed), 'yz' is side-on (x fixed) */
export function pathArc(c, r, a0, a1, n, plane = 'xy', closed = false) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (closed ? i / n : i / Math.max(1, n - 1));
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    out.push(plane === 'xy' ? V3(c.x + u, c.y + v, c.z) : plane === 'xz' ? V3(c.x + u, c.y, c.z + v) : V3(c.x, c.y + v, c.z + u));
  }
  return out;
}
export const pathCircle = (c, r, n, plane = 'xy') => pathArc(c, r, 0, Math.PI * 2, n, plane, true);
export function pathPoly(points, perEdge, closed = true) {
  const out = [];
  const m = closed ? points.length : points.length - 1;
  for (let e = 0; e < m; e++) { const a = points[e], b = points[(e + 1) % points.length]; for (let i = 0; i < perEdge; i++) out.push(a.clone().lerp(b, i / perEdge)); }
  if (!closed) out.push(points[points.length - 1].clone());
  return out;
}
export function pathRect(c, w, h, perEdge) {
  const x0 = c.x - w / 2, x1 = c.x + w / 2, y0 = c.y - h / 2, y1 = c.y + h / 2;
  return pathPoly([V3(x0, y0, c.z), V3(x1, y0, c.z), V3(x1, y1, c.z), V3(x0, y1, c.z)], perEdge);
}
export function pathRegular(c, r, sides, perEdge, rot = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) { const a = rot + (i / sides) * Math.PI * 2; pts.push(V3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z)); }
  return pathPoly(pts, perEdge);
}
export function pathSpiral(c, r0, r1, turns, n, plane = 'xy', rise = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), a = f * turns * Math.PI * 2, r = r0 + (r1 - r0) * f;
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    out.push(plane === 'xy' ? V3(c.x + u, c.y + v, c.z + rise * f) : V3(c.x + u, c.y + rise * f, c.z + v));
  }
  return out;
}

// ---------------------------------------------------------------- beam shader (instanced)
const beamVert = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist; varying vec3 vC;
  void main(){
    vUv = uv; vC = instanceColor;
    vec4 wp = instanceMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * wp;
    vN = normalize(normalMatrix * (mat3(instanceMatrix) * normal));
    vV = normalize(-mv.xyz);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const beamFrag = /* glsl */`
  uniform float time; uniform float gain;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist; varying vec3 vC;
  void main(){
    float along = vUv.y;                              // 1 at the lens, 0 at the far end
    float fade = pow(along, 1.5);
    float rim = abs(dot(normalize(vN), normalize(vV)));
    float soft = pow(rim, 1.6);
    float haze = 0.88 + 0.12 * sin(along * 46.0 - time * 7.0);
    float near = smoothstep(2.0, 14.0, vDist);
    float a = fade * soft * haze * near * gain;
    gl_FragColor = vec4(vC * a, 1.0);
  }`;

const BEAM_LEN = 90;
function makeBeamGeo(r0 = 0.16, r1 = 3.4) {
  const g = new THREE.CylinderGeometry(r0, r1, BEAM_LEN, 14, 1, true);
  g.translate(0, -BEAM_LEN / 2, 0);
  g.rotateX(-Math.PI / 2); // extends from the origin along +z; a lookAt matrix aims it
  return g;
}

/** Hundreds of moving heads in four draw calls. add() heads before build(); then drive goal/colour/intensity per head. */
export class BeamArray {
  constructor() { this.n = 0; this.items = []; }
  /** meta is free-form (group, side, u, ...) and available later as this.meta[i] */
  add(pos, meta = {}) { this.items.push({ pos: pos.clone(), meta }); return this.n++; }
  build() {
    const n = this.n;
    this.pos = new Float32Array(n * 3); this.aim = new Float32Array(n * 3); this.goal = new Float32Array(n * 3);
    this.speed = new Float32Array(n).fill(3); this.inten = new Float32Array(n);
    this.col = new Float32Array(n * 3).fill(1); this.len = new Float32Array(n).fill(1);
    this.meta = this.items.map(it => it.meta);
    this.items.forEach((it, i) => {
      const o = i * 3;
      this.pos[o] = it.pos.x; this.pos[o + 1] = it.pos.y; this.pos[o + 2] = it.pos.z;
      this.goal[o] = it.pos.x * 0.6; this.goal[o + 1] = 0; this.goal[o + 2] = 45;
    });
    this.aim.set(this.goal);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.6, metalness: 0.7 });
    this.base = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.4, 1.0), bodyMat, n);
    const headGeo = new THREE.CylinderGeometry(0.42, 0.5, 1.3, 10); headGeo.rotateX(Math.PI / 2);
    this.head = new THREE.InstancedMesh(headGeo, bodyMat, n);
    this.head.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const lensGeo = new THREE.CircleGeometry(0.4, 12); lensGeo.translate(0, 0, 0.66);
    this.lens = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
    this.lens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lens.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, gain: { value: 0.17 } },
      vertexShader: beamVert, fragmentShader: beamFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.beam = new THREE.InstancedMesh(makeBeamGeo(), this.beamMat, n);
    this.beam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beam.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    for (const m of [this.base, this.head, this.lens, this.beam]) m.frustumCulled = false;
    for (let i = 0; i < n; i++) { _m.makeTranslation(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); this.base.setMatrixAt(i, _m); }
    this.group = new THREE.Group();
    this.group.add(this.base, this.head, this.lens, this.beam);
    this.update(0, 0);
    return this.group;
  }
  setGoal(i, x, y, z) { const o = i * 3; this.goal[o] = x; this.goal[o + 1] = y; this.goal[o + 2] = z; }
  setColor(i, c, k = 1) { const o = i * 3; this.col[o] = c.r * k; this.col[o + 1] = c.g * k; this.col[o + 2] = c.b * k; }
  setRGB(i, r, g, b) { const o = i * 3; this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b; }
  snap() { this.aim.set(this.goal); }
  update(dt, t) {
    const n = this.n, P = this.pos, A = this.aim, G = this.goal, C = this.col, I = this.inten;
    const hm = this.head.instanceMatrix.array, lm = this.lens.instanceMatrix.array, bm = this.beam.instanceMatrix.array;
    const lc = this.lens.instanceColor.array, bc = this.beam.instanceColor.array;
    for (let i = 0; i < n; i++) {
      const k = dt > 0 ? 1 - Math.exp(-dt * this.speed[i]) : 1;
      const o = i * 3;
      A[o] += (G[o] - A[o]) * k; A[o + 1] += (G[o + 1] - A[o + 1]) * k; A[o + 2] += (G[o + 2] - A[o + 2]) * k;
      _v.set(P[o], P[o + 1], P[o + 2]); _v2.set(A[o], A[o + 1], A[o + 2]);
      _m.lookAt(_v2, _v, UP);                 // +z of the fixture points at the aim (Object3D.lookAt convention)
      _q.setFromRotationMatrix(_m);
      _m.compose(_v, _q, _s.set(1, 1, 1));
      _m.toArray(hm, i * 16); _m.toArray(lm, i * 16);
      const L = this.len[i];
      if (L !== 1) _m.compose(_v, _q, _s.set(1, 1, L));
      _m.toArray(bm, i * 16);
      const it = I[i];
      bc[o] = C[o] * it; bc[o + 1] = C[o + 1] * it; bc[o + 2] = C[o + 2] * it;
      const lb = 0.12 + 2.6 * it;
      lc[o] = C[o] * lb; lc[o + 1] = C[o + 1] * lb; lc[o + 2] = C[o + 2] * lb;
    }
    this.head.instanceMatrix.needsUpdate = true; this.lens.instanceMatrix.needsUpdate = true; this.beam.instanceMatrix.needsUpdate = true;
    this.lens.instanceColor.needsUpdate = true; this.beam.instanceColor.needsUpdate = true;
    this.beamMat.uniforms.time.value = t;
  }
}

// ---------------------------------------------------------------- strobes / blinders (instanced)
export class StrobeArray {
  constructor() { this.items = []; }
  /** rot: optional Euler; warm = tungsten blinder look; meta free-form */
  add(pos, w = 1.6, h = 0.7, warm = false, rot = null, meta = {}) { this.items.push({ pos: pos.clone(), w, h, warm, rot, meta }); return this.items.length - 1; }
  build() {
    const n = this.items.length;
    this.n = n;
    this.level = new Float32Array(n); this.warm = new Uint8Array(n);
    this.meta = this.items.map(it => it.meta);
    this.frame = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.3), new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.7 }), n);
    this.face = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
    this.face.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const e0 = new THREE.Euler();
    this.items.forEach((it, i) => {
      this.warm[i] = it.warm ? 1 : 0;
      _q.setFromEuler(it.rot || e0);
      _m.compose(it.pos, _q, _s.set(it.w + 0.25, it.h + 0.25, 1)); this.frame.setMatrixAt(i, _m);
      _v.set(0, 0, 0.12).applyQuaternion(_q).add(it.pos);
      _m.compose(_v, _q, _s.set(it.w, it.h, 1)); this.face.setMatrixAt(i, _m);
    });
    this.face.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(this.frame, this.face);
    return this.group;
  }
  set(i, level) {
    this.level[i] = level;
    const v = level * (1 + 5 * level), c = this.face.instanceColor.array, o = i * 3; // partial levels stay tame, full strobe hits 6x HDR
    if (this.warm[i]) { c[o] = v; c[o + 1] = v * 0.72; c[o + 2] = v * 0.42; } else { c[o] = v; c[o + 1] = v; c[o + 2] = v * 1.05; }
  }
  commit() { this.face.instanceColor.needsUpdate = true; }
}

// ---------------------------------------------------------------- lasers (instanced thin boxes)
export class LaserBank {
  constructor() { this.sources = []; this.total = 0; }
  /** opts: yaw, pitch, spread, roll, mode ('fan' | 'cone'), len, meta */
  add(pos, beams = 10, o = {}) {
    const s = {
      pos: pos.clone(), n: beams, start: this.total,
      yaw: o.yaw ?? 0, pitch: o.pitch ?? -0.1, spread: o.spread ?? 0.8, roll: o.roll ?? 0, mode: o.mode || 'fan', len: o.len ?? 150,
      op: 0, color: new THREE.Color(0x00ff66), meta: o.meta || {},
    };
    this.sources.push(s); this.total += beams;
    return s;
  }
  build() {
    const geo = new THREE.BoxGeometry(0.11, 0.11, 1); geo.translate(0, 0, 0.5);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, Math.max(1, this.total));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, this.total) * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const n = this.sources.length;
    this.housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: 0x131318, roughness: 0.6, metalness: 0.6 }), Math.max(1, n));
    this.sources.forEach((s, i) => { _m.makeTranslation(s.pos.x, s.pos.y, s.pos.z); this.housing.setMatrixAt(i, _m); });
    this.group = new THREE.Group(); this.group.add(this.mesh, this.housing);
    return this.group;
  }
  update() {
    const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    for (const s of this.sources) {
      const vis = s.op > 0.003;
      const cp = Math.cos(s.pitch);
      const D = _v.set(Math.sin(s.yaw) * cp, Math.sin(s.pitch), Math.cos(s.yaw) * cp);
      const R = _v2.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      const U = _v3.crossVectors(D, R).normalize();
      const k = vis ? s.op * 1.8 : 0;
      for (let i = 0; i < s.n; i++) {
        let a, th;
        if (s.mode === 'cone') { a = s.spread * 0.5; th = (i / s.n) * Math.PI * 2 + s.roll; }
        else { a = (s.n === 1 ? 0 : i / (s.n - 1) - 0.5) * s.spread; th = s.roll; }
        const sa = Math.sin(a), ca = Math.cos(a), ct = Math.cos(th), st = Math.sin(th);
        const dx = D.x * ca + (R.x * ct + U.x * st) * sa;
        const dy = D.y * ca + (R.y * ct + U.y * st) * sa;
        const dz = D.z * ca + (R.z * ct + U.z * st) * sa;
        let L = s.len;
        if (dy < -0.002) L = Math.min(L, (s.pos.y - 0.05) / -dy);
        if (!vis) L = 0;
        _q.setFromUnitVectors(Z, _v4.set(dx, dy, dz));
        _m.compose(s.pos, _q, _s.set(1, 1, L));
        const j = s.start + i;
        _m.toArray(M, j * 16);
        C[j * 3] = s.color.r * k; C[j * 3 + 1] = s.color.g * k; C[j * 3 + 2] = s.color.b * k;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- pixel strips (instanced LED dots)
export class PixelStrips {
  constructor(shape = 'box') { this.strips = []; this.total = 0; this.shape = shape; }
  /** returns the strip record {name, start, count, points, size, u (0..1 along), meta} */
  addStrip(name, points, size = 0.35, meta = {}) {
    const u = new Float32Array(points.length);
    for (let i = 0; i < points.length; i++) u[i] = points.length > 1 ? i / (points.length - 1) : 0;
    const s = { name, start: this.total, count: points.length, points, size, u, meta };
    this.strips.push(s);
    this.total += points.length;
    return s;
  }
  build() {
    const geo = this.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 6, 5) : new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const n = Math.max(1, this.total);
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.px = new Float32Array(n * 3);
    for (const s of this.strips) {
      s.points.forEach((p, i) => {
        const j = s.start + i;
        _m.makeScale(s.size, s.size, s.size); _m.setPosition(p);
        this.mesh.setMatrixAt(j, _m);
        this.px[j * 3] = p.x; this.px[j * 3 + 1] = p.y; this.px[j * 3 + 2] = p.z;
      });
    }
    this.colors = this.mesh.instanceColor.array;
    if (this.total === 0) this.mesh.visible = false;
    return this.mesh;
  }
  setPixel(idx, r, g, b) { const a = this.colors; a[idx * 3] = r; a[idx * 3 + 1] = g; a[idx * 3 + 2] = b; }
  setPixelC(idx, c, k) { const a = this.colors; a[idx * 3] = c.r * k; a[idx * 3 + 1] = c.g * k; a[idx * 3 + 2] = c.b * k; }
  addPixel(idx, r, g, b) { const a = this.colors; a[idx * 3] += r; a[idx * 3 + 1] += g; a[idx * 3 + 2] += b; }
  clear() { this.colors.fill(0); }
  commit() { this.mesh.instanceColor.needsUpdate = true; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}

// ---------------------------------------------------------------- LED panel (canvas → LED shader)
const ledVert = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ledFrag = /* glsl */`
  uniform sampler2D map; uniform vec2 res; uniform float gain;
  varying vec2 vUv;
  void main(){
    vec2 cell = floor(vUv * res);
    vec2 f = fract(vUv * res) - 0.5;
    vec3 c = texture2D(map, (cell + 0.5) / res).rgb;
    float d = length(f) * 2.0;
    float dot = 1.0 - smoothstep(0.55, 0.95, d);
    vec3 col = c * (0.15 + dot * 1.1) * gain;
    gl_FragColor = vec4(col, 1.0);
  }`;

export class LedPanel {
  constructor(cw, ch, worldW, worldH, opts = {}) {
    this.cw = cw; this.ch = ch;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw; this.canvas.height = ch;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex }, res: { value: new THREE.Vector2(cw, ch) }, gain: { value: opts.gain ?? 1.25 } },
      vertexShader: ledVert, fragmentShader: ledFrag, side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), this.mat);
    if (!opts.noBack) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(worldW + 1, worldH + 1, 0.8), new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.9 }));
      back.position.z = -0.45;
      this.mesh.add(back);
    }
    this.name = opts.name || 'panel';
    this.role = opts.role || 'side';      // 'main' | 'side' | 'booth' | 'tower' | 'centre'
    this.seed = Math.random() * 1000;
    this.program = 'wash';
    this.programSince = 0;
    this.state = {};                      // per-program scratch (rings, particles ...)
    this.text = '';
  }
  draw(fn) { fn(this.ctx, this.cw, this.ch, this); this.tex.needsUpdate = true; }
  dispose() { this.tex.dispose(); this.mat.dispose(); this.mesh.geometry.dispose(); }
}

// ---------------------------------------------------------------- crowd (all motion in the vertex shader)
const crowdInject = /* glsl */`
  attribute vec3 aRnd;
  uniform float uT, uJump, uBounce, uBar, uWave;
`;
const crowdMove = /* glsl */`
  #include <begin_vertex>
  {
    float ph = aRnd.x;
    float y = aRnd.y * uJump * uBounce * (0.4 + 0.6 * abs(sin(ph + uBar)));
    float arms = uWave * step(1.4, position.y) * (0.5 + 0.5 * sin(uT * 2.0 + ph * 3.0));
    transformed.y += y + arms * 0.6;
    transformed.x += sin(uT * 1.3 + ph) * 0.08;
  }
`;
export class Crowd {
  constructor(count = 6000) {
    this.count = count;
    this.uT = { value: 0 }; this.uJump = { value: 0 }; this.uBounce = { value: 0 }; this.uBar = { value: 0 }; this.uWave = { value: 0 }; this.uPhone = { value: 0 };
    const geo = new THREE.CapsuleGeometry(0.32, 1.1, 3, 6);
    geo.translate(0, 0.9, 0);
    this.mat = new THREE.MeshLambertMaterial({ color: 0x0c0c16 });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uT: this.uT, uJump: this.uJump, uBounce: this.uBounce, uBar: this.uBar, uWave: this.uWave });
      sh.vertexShader = crowdInject + sh.vertexShader.replace('#include <begin_vertex>', crowdMove);
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    const rnd = new Float32Array(count * 3);
    const base = new Float32Array(count * 3), scale = new Float32Array(count), rotY = new Float32Array(count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let i = 0;
    while (i < count) {
      const z = 9 + Math.pow(Math.random(), 0.85) * 110;
      const halfW = 22 + z * 0.55;
      const x = (Math.random() * 2 - 1) * halfW;
      if (Math.abs(x) < 6 && z < 12) continue; // gap at the barrier
      base[i * 3] = x; base[i * 3 + 2] = z;
      rnd[i * 3] = Math.random() * Math.PI * 2; rnd[i * 3 + 1] = 0.25 + Math.random() * 0.55; rnd[i * 3 + 2] = Math.random();
      scale[i] = 0.85 + Math.random() * 0.35;
      rotY[i] = Math.random() * 0.6 - 0.3;
      e.set(0, rotY[i], 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(scale[i], scale[i], scale[i]));
      this.mesh.setMatrixAt(i, m);
      i++;
    }
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 3));
    this.mesh.frustumCulled = false;
    // phones: bright dots held up by ~15 % of the crowd, animated by the same shader idea
    const pc = Math.floor(count * 0.15);
    const pgeo = new THREE.SphereGeometry(0.09, 6, 6);
    const prnd = new Float32Array(pc * 3);
    this.phoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.phoneMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uT: this.uT, uJump: this.uJump, uBounce: this.uBounce, uBar: this.uBar, uPhone: this.uPhone });
      sh.vertexShader = `attribute vec3 aRnd; uniform float uT, uJump, uBounce, uBar, uPhone;\n` + sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          float ph = aRnd.x;
          float tw = 0.6 + 0.4 * sin(uT * 2.0 + ph * 3.0);
          float sc = 0.3 + 1.4 * uPhone * tw * (0.5 + aRnd.z);
          transformed *= sc;
          transformed.y += aRnd.y * uJump * uBounce * (0.4 + 0.6 * abs(sin(ph + uBar)));
        }`);
    };
    this.phones = new THREE.InstancedMesh(pgeo, this.phoneMat, pc);
    for (let k = 0; k < pc; k++) {
      const j = Math.floor(Math.random() * count);
      prnd[k * 3] = rnd[j * 3]; prnd[k * 3 + 1] = rnd[j * 3 + 1]; prnd[k * 3 + 2] = Math.random();
      e.set(0, rotY[j], 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(base[j * 3] + 0.35, 2.1 * scale[j], base[j * 3 + 2]), q, new THREE.Vector3(1, 1, 1));
      this.phones.setMatrixAt(k, m);
    }
    pgeo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(prnd, 3));
    this.phones.frustumCulled = false;
  }
  update(show) {
    const ph = show.phase;
    const jump = show.active ? (ph === 'drop' || ph === 'peak' ? 1 : ph === 'build' ? 0.6 : 0.35) * (0.5 + show.energy) : 0;
    this.uT.value = show.t;
    this.uJump.value = jump;
    this.uBounce.value = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, show.beatPhase))), 1.5);
    this.uBar.value = show.barIndex;
    this.uWave.value = ph === 'build' ? 0.4 + 0.6 * show.buildProgress : ph === 'drop' ? 0.9 : ph === 'peak' ? 0.5 : 0;
    const phoneUp = ph === 'breakdown' || ph === 'build' || ph === 'intro' ? 1 : ph === 'idle' ? 0.6 : 0.25;
    this.uPhone.value += (phoneUp - this.uPhone.value) * Math.min(1, show.dt * 1.5);
    const pb = 0.8 + 1.4 * this.uPhone.value;
    this.phoneMat.color.setRGB(pb, pb, pb * 1.1);
  }
}

// ---------------------------------------------------------------- particles (CO2, flames, sparkulars, confetti, fireworks)
export class Particles {
  constructor(capacity = 16000) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.fade = new Float32Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */`
        attribute float size; attribute vec3 color; varying vec3 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = 1.0 - smoothstep(0.3, 1.0, d); gl_FragColor = vec4(vC * a, a); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.next = 0;
    this.alive = 0;
    this._c = new THREE.Color();
    this._p = new THREE.Vector3(); this._v = new THREE.Vector3();
  }
  spawn(p, v, color, life, size, drag = 1.5, grav = 2, fade = 0.35) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.size0[i] = size;
    this.drag[i] = drag; this.grav[i] = grav; this.fade[i] = fade;
  }
  /** CO2 jet from the deck edge; dir tilts it sideways (-1..1) */
  co2(x, z, dir = 0, color, n = 220) {
    const p = this._p.set(x, 2.3, z), v = this._v;
    const c = color ? this._c.copy(color).lerp(new THREE.Color(1, 1, 1), 0.7) : this._c.setRGB(1, 1, 1);
    for (let k = 0; k < n; k++) {
      v.set((Math.random() - 0.5) * 5 + dir * 8, 22 + Math.random() * 18, (Math.random() - 0.5) * 4);
      this.spawn(p, v, c, 1.0 + Math.random() * 0.8, 1.5 + Math.random() * 2.5, 2.6, 4, 0.35);
    }
  }
  /** flame jet: call every frame while the burst is on */
  flame(x, y, z, scale = 1, n = 14) {
    const p = this._p, v = this._v;
    for (let k = 0; k < n; k++) {
      p.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
      v.set((Math.random() - 0.5) * 3, (16 + Math.random() * 10) * scale, (Math.random() - 0.5) * 3);
      const hot = Math.random();
      this._c.setRGB(1.6, 0.55 + hot * 0.7, 0.1 + hot * 0.25);
      this.spawn(p, v, this._c, 0.35 + Math.random() * 0.35, (3 + Math.random() * 3) * scale, 2.2, -5, 2.4);
    }
  }
  /** cold-spark fountain: call every frame while running */
  sparkular(x, y, z, n = 4, height = 1) {
    const p = this._p.set(x, y, z), v = this._v;
    for (let k = 0; k < n; k++) {
      v.set((Math.random() - 0.5) * 4.5, (18 + Math.random() * 9) * height, (Math.random() - 0.5) * 4.5);
      this._c.setRGB(1.8, 1.55, 1.0);
      this.spawn(p, v, this._c, 1.2 + Math.random() * 1.0, 0.55 + Math.random() * 0.6, 0.5, 13, 0.25);
    }
  }
  /** confetti burst: slow tumbling flakes in the palette colours */
  confetti(x, y, z, colors, n = 320) {
    const p = this._p.set(x, y, z), v = this._v;
    const white = new THREE.Color(1, 1, 1);
    for (let k = 0; k < n; k++) {
      v.set((Math.random() - 0.5) * 30, 8 + Math.random() * 16, (Math.random() - 0.5) * 30);
      const c = Math.random() < 0.25 ? white : colors[k % colors.length];
      this._c.copy(c).multiplyScalar(1.3);
      this.spawn(p, v, this._c, 5 + Math.random() * 4, 1.1 + Math.random() * 1.0, 1.6, 2.2, 0.02);
    }
  }
  firework(x, y, z, color, n = 320) {
    const p = this._p.set(x, y, z), v = this._v;
    const c2 = new THREE.Color(1, 1, 1);
    for (let k = 0; k < n; k++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(14 + Math.random() * 16);
      this.spawn(p, v, Math.random() < 0.8 ? color : c2, 1.4 + Math.random() * 1.2, 1.2 + Math.random() * 1.2, 0.9, 9, 0.35);
    }
  }
  /** comet: a rising trail that bursts (call once; the burst is scheduled by the caller) */
  streamer(x, z, color) {
    const p = this._p.set(x, 2.5, z), v = this._v;
    for (let k = 0; k < 40; k++) {
      v.set((Math.random() - 0.5) * 2, 30 + Math.random() * 12, (Math.random() - 0.5) * 2);
      this.spawn(p, v, color, 1.6 + Math.random() * 0.4, 1.2, 0.3, 12, 0.3);
    }
  }
  update(dt) {
    const P = this.pos, V = this.vel, L = this.life, S = this.size, C = this.col;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (L[i] <= 0) { if (S[i] !== 0) S[i] = 0; continue; }
      alive++;
      L[i] -= dt;
      const d = Math.exp(-dt * this.drag[i]);
      V[i * 3] *= d; V[i * 3 + 1] = V[i * 3 + 1] * d - this.grav[i] * dt; V[i * 3 + 2] *= d;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      const f = L[i] / this.maxLife[i];
      S[i] = L[i] <= 0 ? 0 : this.size0[i] * Math.max(0.05, f);
      const fd = 1 - dt * this.fade[i];
      C[i * 3] *= fd; C[i * 3 + 1] *= fd; C[i * 3 + 2] *= fd;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
