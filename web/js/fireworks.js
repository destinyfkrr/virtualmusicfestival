// fireworks.js - festival fireworks fired from behind the set, the way the big main stages close a drop: shells rise
// out of sight behind the LED walls, clear the roof line and burst high over the stage (peony, chrysanthemum, willow,
// ring, palm, crossette, glitter), so every camera that frames the stage sees them over the set and nothing ever hangs
// in the air between the camera and the stage. Shells are tiny kinematic bodies that leave a spark trail while they
// rise; the stars are drawn through the stage's additive Particles system in site units inside the scaled stage group.
import * as THREE from 'three';

const WHITE = new THREE.Color(1.9, 1.9, 1.9);
const GOLD = new THREE.Color(1.7, 1.15, 0.45);
const SILVER = new THREE.Color(1.6, 1.6, 1.75);
const _c = new THREE.Color(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const TYPES = [['peony', 5], ['chrys', 4], ['willow', 3], ['ring', 2], ['palm', 2], ['crossette', 2], ['glitter', 2]];
const pickType = () => { let s = 0; for (const t of TYPES) s += t[1]; let r = Math.random() * s; for (const t of TYPES) { r -= t[1]; if (r <= 0) return t[0]; } return 'peony'; };
const randomDir = (out) => { out.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); return out.lengthSq() < 1e-4 ? out.set(0, 1, 0) : out.normalize(); };
/** star colour: the shell colour lifted into HDR, a touch towards white so it blooms like a burning star */
const star = (color, k = 1.6) => _c.copy(color).lerp(WHITE, 0.15).multiplyScalar(k);

export class Fireworks {
  constructor(particles) {
    this.pr = particles;
    this.shells = []; this.queue = []; this.t = 0;
    this.launched = 0;   // counter, exposed for the harness
  }
  /** queue one shell. x/z in site units (keep z behind the set), apexY the burst height, color a THREE.Color */
  launch(x, z, apexY, color, type = 'peony', delay = 0, color2 = null) {
    this.queue.push({ at: this.t + delay, x, z, apexY, color: color.clone(), color2: color2 ? color2.clone() : null, type });
  }
  /**
   * A salvo of n shells spread across the back of the set: staggered by ~a quarter second each, colours cycling the
   * palette with the odd gold or silver shell, effects mixed. `wide` spreads the shells further out, `high` lifts them.
   */
  salvo(palette, n = 3, { stagger = 0.24, wide = 1, high = 0 } = {}) {
    const pal = palette && palette.length ? palette : [GOLD];
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;                                   // spread left to right
      const x = (u * 34 + rnd(-8, 8)) * wide, z = rnd(-46, -66), y = rnd(46, 62) + high + (n > 3 && k === (n >> 1) ? 6 : 0);
      const r = Math.random();
      const color = r < 0.12 ? GOLD : r < 0.2 ? SILVER : pal[(k + Math.floor(Math.random() * 2)) % pal.length];
      const color2 = pal[(k + 1) % pal.length];
      this.launch(x, z, y, color, pickType(), k * stagger + rnd(0, 0.12), color2);
    }
  }
  _fire(q) {
    // rise time 1.4-1.9 s from a launch point hidden behind the set (ground level behind the back wall), apex at q.apexY
    const T = rnd(1.4, 1.9), y0 = 4, H = Math.max(20, q.apexY - y0), g = 2 * H / (T * T), vy = 2 * H / T;
    this.shells.push({ p: new THREE.Vector3(q.x, y0, q.z), v: new THREE.Vector3(rnd(-1.5, 1.5), vy, rnd(-1, 1)), g, life: T, color: q.color, color2: q.color2, type: q.type, trail: 'shell', burst: true });
    this.launched++;
  }
  update(dt) {
    this.t += dt;
    if (this.queue.length) { const keep = []; for (const q of this.queue) (q.at <= this.t ? this._fire(q) : keep.push(q)); this.queue = keep; }
    if (!this.shells.length) return;
    const pr = this.pr, alive = [];
    for (const s of this.shells) {
      s.life -= dt;
      s.v.y -= s.g * dt;
      s.p.addScaledVector(s.v, dt);
      if (s.trail) this._trail(s, dt);
      if (s.life > 0) { alive.push(s); continue; }
      if (s.burst) this._burst(s);
    }
    this.shells = alive;
  }
  /** spark trail behind a rising shell or a palm / crossette tendril */
  _trail(s, dt) {
    const pr = this.pr, n = s.trail === 'shell' ? 4 : 3;
    const c = s.trail === 'shell' ? _c.copy(GOLD).lerp(WHITE, 0.35) : star(s.color, 1.4);
    for (let k = 0; k < n; k++) {
      _p.copy(s.p).addScaledVector(s.v, -Math.random() * dt);
      _v.set(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)).addScaledVector(s.v, -0.08);
      pr.spawn(_p, _v, c, rnd(0.25, 0.5), rnd(0.9, 1.5), 3, 6, 1.4);
    }
  }
  _burst(s) {
    const pr = this.pr, p = s.p, c1 = s.color, c2 = s.color2 || s.color;
    // the flash at the burst point
    const fl = _c.copy(WHITE).multiplyScalar(1.3);
    for (let k = 0; k < 8; k++) { _v.set(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)); pr.spawn(p, _v, fl, rnd(0.16, 0.26), rnd(9, 15), 0, 0, 3); }
    switch (s.type) {
      case 'chrys': {   // chrysanthemum: dense sphere with short radial streaks
        for (let k = 0; k < 230; k++) {
          randomDir(_n); const sp = rnd(17, 26), c = Math.random() < 0.1 ? WHITE : star(c1);
          for (let j = 0; j < 3; j++) { _v.copy(_n).multiplyScalar(sp * (1 - j * 0.13)); pr.spawn(p, _v, c, rnd(1.7, 2.5), rnd(1.4, 2.2), 1.1, 7, 0.4); }
        }
        break;
      }
      case 'willow': {   // gold willow: long-lived heavy sparks that droop
        for (let k = 0; k < 380; k++) {
          randomDir(_n); _v.copy(_n).multiplyScalar(rnd(11, 20)); _v.y += 2;
          pr.spawn(p, _v, _c.copy(GOLD).lerp(c1, 0.3), rnd(2.8, 4.2), rnd(1.3, 2.1), 0.55, 12, 0.22);
        }
        break;
      }
      case 'ring': {   // a ring in a plane that faces the field, tilted a little
        _n.set(rnd(-0.35, 0.35), rnd(-0.25, 0.25), 1).normalize();
        _a.set(1, 0, 0).cross(_n).normalize(); _b.copy(_n).cross(_a).normalize();
        const sp = rnd(21, 25), c = star(c1, 1.7);
        for (let k = 0; k < 260; k++) {
          const ang = (k / 260) * Math.PI * 2 + rnd(-0.02, 0.02), j = rnd(0.92, 1.08);
          _v.copy(_a).multiplyScalar(Math.cos(ang) * sp * j).addScaledVector(_b, Math.sin(ang) * sp * j);
          pr.spawn(p, _v, c, rnd(1.6, 2.2), rnd(1.6, 2.4), 1.0, 6, 0.4);
        }
        for (let k = 0; k < 90; k++) { randomDir(_n); _v.copy(_n).multiplyScalar(rnd(6, 11)); pr.spawn(p, _v, star(c2, 1.4), rnd(1.2, 1.8), rnd(1.2, 1.8), 1.2, 6, 0.5); }   // pistil
        break;
      }
      case 'palm': {   // thick rising tendrils with trails, like a palm tree
        const n = 9 + Math.floor(Math.random() * 5);
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2 + rnd(-0.2, 0.2), tilt = rnd(0.25, 0.55);
          const v = new THREE.Vector3(Math.cos(ang) * Math.cos(tilt), Math.sin(tilt) + 0.35, Math.sin(ang) * Math.cos(tilt) * 0.6).multiplyScalar(rnd(15, 21));
          this.shells.push({ p: p.clone(), v, g: 11, life: rnd(1.1, 1.5), color: k % 3 === 0 ? c2 : c1, color2: c2, type: 'none', trail: 'tendril', burst: false });
        }
        for (let k = 0; k < 120; k++) { randomDir(_n); _v.copy(_n).multiplyScalar(rnd(4, 9)); pr.spawn(p, _v, star(c1), rnd(1.0, 1.6), rnd(1.2, 1.8), 1.2, 6, 0.5); }
        break;
      }
      case 'crossette': {   // a few comets that each break into a small star burst
        const n = 8;
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2 + rnd(-0.2, 0.2);
          const v = new THREE.Vector3(Math.cos(ang), rnd(0.2, 0.7), Math.sin(ang) * 0.5).normalize().multiplyScalar(rnd(15, 19));
          this.shells.push({ p: p.clone(), v, g: 9, life: rnd(0.5, 0.7), color: c2, color2: c1, type: 'mini', trail: 'tendril', burst: true });
        }
        break;
      }
      case 'mini': {   // the small stars of a crossette
        for (let k = 0; k < 80; k++) { randomDir(_n); _v.copy(_n).multiplyScalar(rnd(7, 12)); pr.spawn(p, _v, star(c1, 1.7), rnd(1.1, 1.7), rnd(1.3, 1.9), 1.2, 7, 0.45); }
        break;
      }
      case 'glitter': {   // silver glitter: many small long-lived sparks that keep twinkling as they fall
        for (let k = 0; k < 520; k++) {
          randomDir(_n); _v.copy(_n).multiplyScalar(rnd(9, 24));
          pr.spawn(p, _v, _c.copy(SILVER).lerp(c1, 0.35), rnd(2.4, 3.6), rnd(0.9, 1.5), 1.4, 9, 0.16);
        }
        break;
      }
      default: {   // peony: the classic sphere, two-tone (inner colour, outer colour)
        for (let k = 0; k < 420; k++) {
          randomDir(_n); const sp = rnd(15, 27), c = Math.random() < 0.12 ? WHITE : star(sp > 22 ? c1 : c2);
          _v.copy(_n).multiplyScalar(sp);
          pr.spawn(p, _v, c, rnd(1.5, 2.3), rnd(1.6, 2.6), 1.1, 7, 0.45);
        }
      }
    }
  }
}
