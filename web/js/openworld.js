// Open world: walk the festival as one of the crowd, in third or first person.
//   You are a visitor, so the site treats you like one. The perimeter fence and the closed exit keep you inside the
//   grounds; the crowd barrier keeps you out of the pit, the stage and everything behind it; the lighting towers and the
//   ride machinery are crew only. Stalls and cabins are solid. The crowd is not: you shoulder through it, slower the
//   denser it gets.
// Everything here is in site units (the group it lives in is scaled to the world by the stage); people are built at
// `crowd.bodyScale`, the same as the audience, so the avatar is exactly one of them.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const halfW = (z) => 22 + z * 0.55;                 // crowd field half width (matches festival.js)
const Z_FRONT = 12.6, Z_BACK = 125.5;                // crowd barrier line, and the fence line just inside the gate
const WHEEL = { x: -108, z: 78, r: 34 }, DROP = { x: 112, z: 84, r: 24 };   // ride plazas (festival.js positions)
const R = 0.22;                                       // the walker's own radius
const OK = 0, EDGE = 1, CREW = 2, SOLID = 3;

// how far out the grounds reach at depth z on one side: the village strip, widened by that side's ride plaza
function reach(z, side) {
  const a = halfW(z) + 24, P = side < 0 ? WHEEL : DROP, dz = z - P.z;
  if (Math.abs(dz) >= P.r) return a;
  const s = Math.sqrt(P.r * P.r - dz * dz), cx = Math.abs(P.x);
  return cx - s <= a ? Math.max(a, cx + s) : a;
}

function signTexture(text) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = '#b3121d'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, 492, 140);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 64px Inter, "SF Pro Display", Helvetica, Arial, sans-serif';
  g.fillText(text, 256, 84);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class OpenWorld {
  constructor({ camera, canvas, crowd, worldScale, notify }) {
    this.camera = camera; this.canvas = canvas; this.crowd = crowd; this.K = worldScale; this.notify = notify || (() => {});
    this.group = new THREE.Group();
    this.on = false; this.first = false;
    this.pos = new THREE.Vector3(0, 0, 70); this.vy = 0;
    this.yaw = 0; this.pitch = 0.1; this.dist = 2.6;      // yaw 0 looks at the stage (-z)
    this.face = 0; this.step = 0; this.speed = 0;
    this.input = { f: 0, b: 0, l: 0, r: 0, run: 0, jump: 0 };
    this.held = {};   // which keys hold each input down, so W and the up arrow together release cleanly
    this.lastNote = 0;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.solids = [];   // { x, z, hx, hz } boxes and { x, z, r } rounds, each with a `why`
    this._buildSolids();
    this._buildFence();
    this._buildAvatar();
    this._buildGrid();
    this.group.visible = true; this.avatar.visible = false;
    // the mouse looks around, like any game: locked to the view when the browser allows it (asked for on the way in
    // and again on a click), and otherwise just by moving it over the picture
    canvas.addEventListener('click', () => this.grab());
    addEventListener('mousemove', (e) => {
      if (!this.on || !(document.pointerLockElement === canvas || e.target === canvas)) return;
      this.look(e.movementX || 0, e.movementY || 0);
    });
    canvas.addEventListener('wheel', (e) => { if (this.on && !this.first) this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.1 : 0.9), 1.2, 9); }, { passive: true });
    addEventListener('blur', () => this.clearInput());
  }
  grab() { if (this.on && document.pointerLockElement !== this.canvas) { try { const p = this.canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch {} } }
  look(dx, dy) { this.yaw -= dx * 0.0024; this.pitch = clamp(this.pitch - dy * 0.0024, -1.0, 1.25); }
  clearInput() { for (const k in this.input) this.input[k] = 0; this.held = {}; }

  // ---- what stands in the way
  _buildSolids() {
    const S = this.solids;
    for (let i = 0; i < 26; i++) { const side = i & 1 ? 1 : -1, z = 20 + Math.floor(i / 2) * 8.2; S.push({ x: side * (halfW(z) + 9), z, hx: 2.05, hz: 2.55, why: SOLID }); }   // stalls
    for (const side of [-1, 1]) for (let k = 0; k < 7; k++) { const z = 41 + k * 1.95; S.push({ x: side * (halfW(z) + 16), z, r: 1.0, why: SOLID }); }                               // cabin row
    for (const [x, z] of [[-57, 36], [57, 36], [-69, 82], [69, 82]]) S.push({ x, z, hx: 2.9, hz: 2.9, why: CREW });                                                            // lighting towers, fenced
    S.push({ x: WHEEL.x, z: WHEEL.z, hx: 27, hz: 4.2, why: CREW });                                                                                                           // under the wheel
    S.push({ x: DROP.x, z: DROP.z, r: 8.2, why: CREW });                                                                                                                       // drop tower pad
  }
  // 0 if a visitor may stand at (x, z), else why not
  blocked(x, z) {
    if (z < Z_FRONT) return CREW;
    if (z > Z_BACK) return EDGE;
    if (Math.abs(x) > reach(z, Math.sign(x) || 1) - 0.4) return EDGE;
    for (const s of this.solids) {
      if (s.r !== undefined) { if (Math.hypot(x - s.x, z - s.z) < s.r + R) return s.why; }
      else if (Math.abs(x - s.x) < s.hx + R && Math.abs(z - s.z) < s.hz + R) return s.why;
    }
    return OK;
  }

  // ---- the fences a visitor can see, so the limits are part of the site and not an invisible wall
  _buildFence() {
    const runs = [];   // [x0, z0, x1, z1, tall]
    for (const side of [-1, 1]) {
      let px = side * reach(Z_FRONT, side), pz = Z_FRONT - 0.3;
      for (let z = Z_FRONT + 1.7; z <= Z_BACK + 0.31; z += 2) { const zz = Math.min(z, Z_BACK + 0.3), x = side * reach(zz, side); runs.push([px, pz, x, zz, 1]); px = x; pz = zz; }
      runs.push([side * 28, Z_BACK + 0.3, px, pz, 1]);                                     // back line, out to the gate
      runs.push([side * 40, Z_FRONT - 0.3, side * reach(Z_FRONT, side), Z_FRONT - 0.3, 1]);   // beside the stage: backstage is behind it
    }
    runs.push([-40, Z_FRONT - 0.3, 40, Z_FRONT - 0.3, 0]);    // the crowd barrier across the front
    runs.push([-28, Z_BACK + 0.3, 28, Z_BACK + 0.3, 0]);      // the exit, closed while the show is on
    for (const s of this.solids) if (s.why === CREW) {
      if (s.r !== undefined) { const n = 14; for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832, b = ((i + 1) / n) * 6.2832; runs.push([s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r, s.x + Math.cos(b) * s.r, s.z + Math.sin(b) * s.r, 1]); } }
      else { const { x, z, hx, hz } = s; runs.push([x - hx, z - hz, x + hx, z - hz, 1], [x + hx, z - hz, x + hx, z + hz, 1], [x + hx, z + hz, x - hx, z + hz, 1], [x - hx, z + hz, x - hx, z - hz, 1]); }
    }
    // cut every run into panels about two units long
    const panels = [];
    for (const [x0, z0, x1, z1, tall] of runs) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2));
      for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; panels.push([x0 + (x1 - x0) * a, z0 + (z1 - z0) * a, x0 + (x1 - x0) * b, z0 + (z1 - z0) * b, tall]); }
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.03), new THREE.MeshBasicMaterial({ color: 0x2b2b36, transparent: true, opacity: 0.5, depthWrite: false }), panels.length);
    const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.035, 0.05), new THREE.MeshBasicMaterial({ color: 0x4a4a58 }), panels.length);
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), new THREE.MeshBasicMaterial({ color: 0x3a3a46 }), panels.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    panels.forEach(([x0, z0, x1, z1, tall], i) => {
      const L = Math.hypot(x1 - x0, z1 - z0), h = tall ? 0.72 : 0.27;
      e.set(0, -Math.atan2(z1 - z0, x1 - x0), 0); q.setFromEuler(e);
      m.compose(p.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2), q, s.set(L, h, 1)); mesh.setMatrixAt(i, m);
      m.compose(p.set((x0 + x1) / 2, h, (z0 + z1) / 2), q, s.set(L, 1, 1)); rail.setMatrixAt(i, m);
      m.compose(p.set(x0, h / 2, z0), q, s.set(1, h, 1)); post.setMatrixAt(i, m);
    });
    this.group.add(mesh, rail, post);
    // signs where a visitor meets a limit
    const board = (text, x, y, z, ry, w = 2.6) => {
      const mat = new THREE.MeshBasicMaterial({ map: signTexture(text), toneMapped: false, color: 0x9a9a9a });   // one sided: it faces the visitor it is for
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.3125), mat); b.position.set(x, y, z); b.rotation.y = ry; this.group.add(b);
    };
    for (const x of [-72, -50, 50, 72]) board('CREW ONLY', x, 0.5, Z_FRONT - 0.26, 0);
    for (const [x, z] of [[-57, 36], [57, 36], [-69, 82], [69, 82]]) board('CREW ONLY', x, 0.5, z + 2.94, 0, 1.8);
    board('CREW ONLY', WHEEL.x, 0.5, WHEEL.z + 4.24, 0); board('CREW ONLY', WHEEL.x, 0.5, WHEEL.z - 4.24, Math.PI);
    board('CREW ONLY', DROP.x - 8.24, 0.5, DROP.z, -Math.PI / 2);
    board('EXIT CLOSED', 0, 0.5, Z_BACK + 0.26, Math.PI, 2.2);
  }

  // ---- the walker: one of the crowd, with limbs, so third person has someone to follow
  _buildAvatar() {
    const A = this.avatar = new THREE.Group();
    const lam = (c, em = 0.22) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: em });
    const skin = lam(0xc58c68, 0.3), top = lam(0xe9e9f2, 0.28), legs = lam(0x23283c, 0.35), shoe = lam(0xf2f2f2, 0.3), hair = lam(0x1a1210, 0.2);
    const part = (geo, mat, x, y, z, parent = A) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    part(new THREE.CapsuleGeometry(0.27, 0.42, 3, 10), top, 0, 1.2, 0).scale.set(1, 1, 0.72);                  // torso
    part(new THREE.SphereGeometry(0.19, 14, 12), skin, 0, 1.78, 0);                                            // head
    part(new THREE.SphereGeometry(0.2, 14, 8, 0, 6.2832, 0, 1.75), hair, 0, 1.8, -0.015);                      // hair
    part(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 8), skin, 0, 1.58, 0);                                  // neck
    this.limbs = {};
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.13, 0.86, 0); A.add(hip);
      part(new THREE.CapsuleGeometry(0.095, 0.62, 2, 8), legs, 0, -0.4, 0, hip);
      part(new THREE.BoxGeometry(0.17, 0.09, 0.32), shoe, 0, -0.82, -0.06, hip);
      const sh = new THREE.Group(); sh.position.set(s * 0.35, 1.47, 0); A.add(sh);
      part(new THREE.CapsuleGeometry(0.07, 0.5, 2, 8), top, 0, -0.27, 0, sh);
      part(new THREE.SphereGeometry(0.08, 8, 8), skin, 0, -0.62, 0, sh);
      if (s > 0) this.band = part(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 0, -0.5, 0, sh);
      this.limbs[s < 0 ? 'legL' : 'legR'] = hip; this.limbs[s < 0 ? 'armL' : 'armR'] = sh;
    }
    A.scale.setScalar(this.crowd.bodyScale * 1.04);
    this.eye = 1.74 * this.crowd.bodyScale * 1.04;
    this.group.add(A);
  }

  // ---- the crowd as a grid of heads, so pushing through it costs a handful of lookups a frame
  _buildGrid() {
    const c = this.crowd, G = this.grid = { x0: -80, z0: 6, w: 160, h: 80 };
    const n = G.w * G.h, cnt = new Uint32Array(n + 1);
    const cell = (i) => { const gx = Math.floor(c.base[i * 3] - G.x0), gz = Math.floor(c.base[i * 3 + 2] - G.z0); return gx < 0 || gz < 0 || gx >= G.w || gz >= G.h ? -1 : gz * G.w + gx; };
    for (let i = 0; i < c.count; i++) { const k = cell(i); if (k >= 0) cnt[k + 1]++; }
    for (let k = 0; k < n; k++) cnt[k + 1] += cnt[k];
    const fill = cnt.slice(0, n), ids = new Uint32Array(cnt[n]);
    for (let i = 0; i < c.count; i++) { const k = cell(i); if (k >= 0) ids[fill[k]++] = i; }
    G.start = cnt; G.ids = ids;
  }
  // nudge (x, z) away from the people around it; returns how crowded the spot is (0 clear .. 1 shoulder to shoulder)
  _shoulder(p, dt) {
    const c = this.crowd, G = this.grid, gx = Math.floor(p.x - G.x0), gz = Math.floor(p.z - G.z0);
    let px = 0, pz = 0, near = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, z = gz + dz; if (x < 0 || z < 0 || x >= G.w || z >= G.h) continue;
      const k = z * G.w + x;
      for (let j = G.start[k]; j < G.start[k + 1]; j++) {
        const i = G.ids[j], ox = p.x - c.base[i * 3], oz = p.z - c.base[i * 3 + 2], d = Math.hypot(ox, oz), min = 0.2 + 0.32 * c.scale[i];
        if (d < 0.9) near++;
        if (d < min && d > 1e-4) { const k2 = (min - d) / d; px += ox * k2; pz += oz * k2; }
      }
    }
    const L = Math.hypot(px, pz), cap = 0.7 * dt;   // a nudge, always weaker than a walk, so the crowd slows you and never traps you
    if (L > cap) { px *= cap / L; pz *= cap / L; }
    const nx = p.x + px, nz = p.z + pz;
    if (!this.blocked(nx, nz)) { p.x = nx; p.z = nz; }
    return clamp(near / 9, 0, 1);
  }

  setOn(on) {
    this.on = !!on; this.clearInput();
    this.avatar.visible = this.on && !this.first;
    if (this.on) {
      if (this.blocked(this.pos.x, this.pos.z)) this.pos.set(0, 0, 70);
      this.yaw = 0; this.pitch = 0.1; this.face = Math.PI; this._snap = true;
      this.grab();
    } else if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    return this.on;
  }
  setFirst(first) { this.first = !!first; this.avatar.visible = this.on && !this.first; this._snap = true; return this.first; }

  _note(why) {
    const now = performance.now(); if (now - this.lastNote < 1600) return; this.lastNote = now;
    this.notify(why === CREW ? 'Restricted area: crew only' : 'Festival boundary: no way out while the show is on');
  }

  update(dt, show) {
    const I = this.input, p = this.pos;
    // move relative to where the camera looks
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let mx = (I.f - I.b) * fx + (I.r - I.l) * -fz, mz = (I.f - I.b) * fz + (I.r - I.l) * fx;
    const ml = Math.hypot(mx, mz), crowded = this._shoulder(p, dt);
    let v = 0;
    if (ml > 0) {
      mx /= ml; mz /= ml;
      v = (I.run ? 4.6 : 1.9) * (1 - 0.45 * crowded);
      const nx = p.x + mx * v * dt, nz = p.z + mz * v * dt;
      let why = this.blocked(nx, nz);
      if (!why) { p.x = nx; p.z = nz; }
      else {   // slide along whatever it is
        const wx = this.blocked(nx, p.z), wz = this.blocked(p.x, nz);
        if (!wx) p.x = nx; else if (!wz) p.z = nz; else v = 0;
        if (why !== SOLID) this._note(why);
      }
      const want = Math.atan2(mx, mz);
      let d = want - this.face; d = Math.atan2(Math.sin(d), Math.cos(d)); this.face += d * Math.min(1, dt * 12);
    }
    if (this.first) this.face = Math.atan2(fx, fz);
    this.speed += (v - this.speed) * Math.min(1, dt * 10);
    this.packed = (this.packed || 0) + (crowded - (this.packed || 0)) * Math.min(1, dt * 2.5);
    // jump
    if (I.jump && p.y <= 0) this.vy = 1.55;
    this.vy -= 5.2 * dt; p.y = Math.max(0, p.y + this.vy * dt); if (p.y === 0 && this.vy < 0) this.vy = 0;
    this._pose(dt, show);

    // camera
    const K = this.K, cam = this.camera, cp = Math.cos(this.pitch), d = this._d.set(fx * cp, Math.sin(this.pitch), fz * cp), t = this._v;
    const fov = this.first ? 72 : 62;
    if (cam.fov !== fov || cam.near !== 0.1) { cam.fov = fov; cam.near = 0.1; cam.updateProjectionMatrix(); }
    if (this.first) t.set(p.x, p.y + this.eye * 0.96 + this.bob, p.z).addScaledVector(d, 0.04);
    else {
      t.set(p.x, p.y + this.eye * 0.92, p.z).addScaledVector(d, -this.dist); t.y += 0.22 + 0.55 * this.packed;   // in the thick of it the camera rides above the heads
      t.y = Math.max(0.14, t.y); t.z = Math.max(9.5, t.z);
    }
    t.multiplyScalar(K);
    if (this._snap) { cam.position.copy(t); this._snap = false; } else cam.position.lerp(t, 1 - Math.exp(-dt * (this.first ? 40 : 12)));
    cam.lookAt(t.copy(cam.position).addScaledVector(d, 40));
  }

  _pose(dt, show) {
    const A = this.avatar, L = this.limbs, p = this.pos, moving = this.speed > 0.15;
    this.step += dt * (3.2 + this.speed * 2.6) * (moving ? 1 : 0);
    const sw = moving ? Math.sin(this.step) * clamp(this.speed / 2.4, 0.35, 1.05) : 0;
    const hi = show && show.active && (show.phase === 'drop' || show.phase === 'peak');
    const beat = show ? Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, show.beatPhase || 0))), 1.5) : 0;
    const dance = !moving && show && show.active ? (hi ? 1 : 0.35) : 0;   // standing still in a drop: hands up, on the beat
    this.bob = moving ? Math.abs(Math.sin(this.step)) * 0.012 : dance * beat * 0.03;
    L.legL.rotation.x = sw; L.legR.rotation.x = -sw;
    const up = hi && !moving ? -2.7 - 0.25 * beat : 0;
    L.armL.rotation.x += ((up || -sw * 0.8) - L.armL.rotation.x) * Math.min(1, dt * 10);
    L.armR.rotation.x += ((up || sw * 0.8) - L.armR.rotation.x) * Math.min(1, dt * 10);
    L.armL.rotation.z = -0.08; L.armR.rotation.z = 0.08;
    A.position.set(p.x, p.y + (moving ? this.bob : dance * beat * 0.05), p.z);
    A.rotation.y = this.face;
    if (show && show.colorA) this.band.material.color.copy(show.colorA).multiplyScalar(1.2 + 1.5 * (show.kick || 0));
  }

  // key state from main.js; returns true when the key belongs to walking
  key(k, down) {
    const map = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', shift: 'run', ' ': 'jump' };
    const f = map[k]; if (!f) return false;
    const h = this.held[f] || (this.held[f] = new Set());
    if (down) h.add(k); else h.delete(k);
    this.input[f] = h.size ? 1 : 0; return true;
  }
  where() { return { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), first: this.first, on: this.on }; }
}
