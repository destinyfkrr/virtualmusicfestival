// The DJs on the riser: articulated figures that DJ to the beat grid — hands on the jog wheels and the mixer, headphone
// cueing, a knee-dip bounce and head nod on every beat, hands up through the build, jumps and fist pumps on the drop,
// claps, pointing and waving at the crowd. Everything here is authored in metres inside `Djs.group`, which is scaled by
// DECK.SCALE and parked on the riser top at DECK.Z0. The scale is 1, i.e. the set's own scale (4x life size, the way the
// whole set is built), because at true human size the DJ was a 0.4-unit speck on a 96-unit-wide set and vanished from
// every front shot; at stage scale the DJ and the console read from the field, the way a broadcast cut reads them.
// `DECK` is the shared booth layout: festival.js builds the table, players, mixer, laptop and wedges from it, so the
// hands land on the gear instead of on thin air.
import * as THREE from 'three';
import { SongRng } from './artists.js';

// ---- broadcast lighting on the figures. Under the set's own lights a DJ in a black shirt is a silhouette against a
// black riser, so every figure material gets, in its shader: a Fresnel rim in the show colour (the backlight every
// booth camera sees) and a soft camera-facing fill in the booth's own light (the console, the screens). Done in the
// shader so no extra scene light is needed — a point light costs every lit fragment on the field, this only costs the
// figures' own pixels. The uniforms are shared, Djs.update drives them from the show.
export const FIGURE_LIGHT = { rim: { value: new THREE.Color(0x3355aa) }, fill: { value: new THREE.Color(0x202028) } };
const figureCompile = (sh) => {
  sh.uniforms.uRim = FIGURE_LIGHT.rim; sh.uniforms.uFill = FIGURE_LIGHT.fill;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform vec3 uFill;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float ndv = saturate(dot(normal, normalize(vViewPosition))); totalEmissiveRadiance += uRim * pow(1.0 - ndv, 3.0) + (diffuseColor.rgb * 0.7 + 0.3) * uFill * (0.25 + 0.75 * ndv); }');
};
const _rimC = new THREE.Color(), _fillC = new THREE.Color(), WHITE = new THREE.Color(0xffffff);

export const DECK = {
  SCALE: 1,                                  // booth scale: 1 = stage scale (the set's own 4x life size), so the DJs and their console read from the field
  RY: 5.6,                                   // riser top, site units (the group's origin; +z faces the crowd)
  Z0: -1.3,                                  // booth origin z on the riser (riser spans z -2.5..0.5): puts the table's front edge at the riser's front edge
  TZ: 1.2, TW: 3.6, TD: 1.0, TH: 0.95,       // table centre z, width, depth, height (m)
  GZ: 0.95,                                  // z of the CDJ + mixer row (25 cm in from the DJ-side edge of the table)
  CDJ_X: 0.55, JOG_Y: 1.07, MIX_Y: 1.04,     // player centres, jog-wheel and mixer-top heights
  LAPTOP_Z: 1.5,                             // laptop at the crowd-side edge, screen facing the DJ
  STAND_Z: 0.55,                             // where the DJs stand (15 cm behind the table)
  WEDGE_X: 2.4, WEDGE_Z: 1.4,                // monitor wedges either side of the table
  MAT_Z: 0.6, MAT_W: 6.4, MAT_D: 2.4,        // riser mat under it all
};

// ---- who is on stage: duos / trios by artist id, overridden by the primary artist name on the track
const MEMBERS = {
  dvlm: 2, ww: 2, matissesadko: 2, bassjackers: 2, showtek: 2, nervo: 2, lucassteve: 2, galantis: 2, gorgoncity: 2,
  disclosure: 2, zedsdead: 2, slander: 2, yellowclaw: 2, alyfila: 2, cosmicgate: 2, vinivici: 2, camelphat: 2, artbat: 2,
  dblock: 2, chasestatus: 2, camokrooked: 2, blasterjaxx: 2, aboveandbeyond: 3, noisia: 3, shm: 3, keinemusik: 3,
};
const NAME_MEMBERS = {
  'tale of us': 2, 'mind against': 2, 'adriatique': 2, 'jack ü': 2, 'jack u': 2, 'dog blood': 2, 'axwell & ingrosso': 2,
  'axwell λ ingrosso': 2, 'major lazer': 3, 'axwell': 1, 'sebastian ingrosso': 1, 'steve angello': 1, '&me': 1, 'rampa': 1,
  'adam port': 1, 'anyma': 1, 'diplo': 1, 'skrillex': 1,
};
export function memberCount(profile, track) {
  const primary = ((track && track.artist) || '').split(',')[0].trim().toLowerCase();
  if (primary && NAME_MEMBERS[primary] != null) return NAME_MEMBERS[primary];
  if (profile && MEMBERS[profile.id] != null) return MEMBERS[profile.id];
  if (primary && !(profile && profile.matched) && /\s(&|and|b2b|vs\.?)\s/.test(primary)) return 2;
  return 1;
}

// ---- rig proportions (metres)
const HIP_Y = 0.95, SX = 0.21, SY = 0.50, L1 = 0.30, L2 = 0.30, HEAD_Y = 0.58, HEAD_R = 0.11;
const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
// a hit that peaks on the beat (phase 0), decays, and rises again ahead of the next beat so the arm is already on its
// way up when the kick lands — continuous across the beat boundary
const hitShape = (p) => (p < 0.7 ? Math.exp(-p * 4.5) : lerp(Math.exp(-0.7 * 4.5), 1, smooth((p - 0.7) / 0.3)));
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// how hard each phase moves the body, and how each gesture shapes it
const PHASE_AMP = { idle: 0.15, intro: 0.55, groove: 0.75, build: 0.85, drop: 1, peak: 1, breakdown: 0.45 };
//                dip = knee bounce, nod = head/torso beat nod, lean = torso forward (rad), headX = base head pitch (rad, + looks down), speed = hand tracking rate
const MODES = {
  rest:      { dip: 0.25, nod: 0.25, lean: 0.14, headX: 0.10, sway: 0.5, speed: 6 },
  mix:       { dip: 0.75, nod: 0.80, lean: 0.30, headX: 0.32, sway: 0.7, speed: 10 },
  headphone: { dip: 0.60, nod: 0.60, lean: 0.24, headX: 0.22, sway: 0.5, speed: 9 },
  handsUp:   { dip: 1.00, nod: 0.60, lean: -0.12, headX: -0.18, sway: 1.0, speed: 8 },
  pump:      { dip: 1.20, nod: 1.00, lean: -0.05, headX: -0.10, sway: 0.6, speed: 22 },
  clap:      { dip: 0.90, nod: 0.60, lean: -0.08, headX: -0.15, sway: 0.7, speed: 20 },
  point:     { dip: 0.70, nod: 0.70, lean: 0.02, headX: -0.05, sway: 0.6, speed: 8 },
  wave:      { dip: 0.70, nod: 0.60, lean: 0.00, headX: -0.08, sway: 0.7, speed: 9 },
  jump:      { dip: 1.20, nod: 0.50, lean: -0.08, headX: -0.15, sway: 0.3, speed: 12 },
  crowdWide: { dip: 0.80, nod: 0.50, lean: -0.10, headX: -0.15, sway: 0.8, speed: 7 },
  ears:      { dip: 0.60, nod: 0.30, lean: -0.10, headX: 0.00, sway: 0.4, speed: 8 },
  lean:      { dip: 0.80, nod: 1.60, lean: 0.42, headX: 0.30, sway: 0.5, speed: 8 },
};
const MODE_LEN = { rest: [2, 4], mix: [2, 6], headphone: [1, 2], handsUp: [4, 8], pump: [1, 3], clap: [1, 2], point: [1, 2], wave: [1, 1], jump: [2, 2], crowdWide: [2, 4], ears: [1, 2], lean: [2, 4] };

class Figure {
  constructor(idx, cx, look, genre) {
    this.idx = idx; this.cx = cx; this.genre = genre || '';
    this.rng = new SongRng(1);
    this.t = 0; this.mode = 'rest'; this.modeT = 0; this.modeBars = 0; this.modeLen = 2;
    this.up = 0; this.lean = 0; this.twist = 0; this.twistT = 0; this.headYaw = 0; this.headYawT = 0; this.headRoll = 0; this.headRollT = 0;
    this.jogX = cx < -0.2 ? -DECK.CDJ_X : cx > 0.2 ? DECK.CDJ_X : DECK.CDJ_X; this.jogHand = 1; this.pointSide = 1; this.pointDir = 0; this.cupSide = -1; this.fader = 0;
    this.mats = []; this.geos = [];
    const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); m.onBeforeCompile = figureCompile; this.mats.push(m); return m; };
    const geo = (g) => { this.geos.push(g); return g; };
    const skin = mat({ color: look.skin, roughness: 0.75, emissive: look.skin, emissiveIntensity: 0.16 });
    const shirt = mat({ color: look.shirt, roughness: 0.9, emissive: look.shirt, emissiveIntensity: 0.08 });
    const pants = mat({ color: 0x141419, roughness: 0.95 });
    const gear = mat({ color: 0x0c0c10, roughness: 0.6, metalness: 0.2 });

    this.root = new THREE.Group(); this.root.position.set(cx, 0, DECK.STAND_Z);
    this.legs = new THREE.Group(); this.root.add(this.legs);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.07, HIP_Y - 0.16, 3, 8)), pants); leg.position.set(s * 0.10, HIP_Y * 0.5 + 0.01, 0); this.legs.add(leg);
      const foot = new THREE.Mesh(geo(new THREE.BoxGeometry(0.10, 0.06, 0.26)), gear); foot.position.set(s * 0.11, 0.03, 0.05); this.legs.add(foot);
    }
    this.hips = new THREE.Group(); this.hips.position.y = HIP_Y; this.root.add(this.hips);
    const torso = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.17, 0.30, 4, 12)), shirt); torso.scale.set(1.15, 1, 0.62); torso.position.y = 0.30; this.hips.add(torso);
    const belt = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.17, 0.16, 0.12, 12)), pants); belt.scale.set(1.1, 1, 0.65); belt.position.y = 0.02; this.hips.add(belt);
    // head: skull, neck, hair or cap, glasses, headphones (band over the top, cups on the ears)
    this.head = new THREE.Group(); this.head.position.y = HEAD_Y; this.hips.add(this.head);
    const skull = new THREE.Mesh(geo(new THREE.SphereGeometry(HEAD_R, 14, 10)), skin); skull.position.y = HEAD_R + 0.02; this.head.add(skull);
    const neck = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 8)), skin); neck.position.y = 0.03; this.head.add(neck);
    if (look.cap) {
      const capMat = mat({ color: look.capColor, roughness: 0.9 });
      const crown = new THREE.Mesh(geo(new THREE.SphereGeometry(HEAD_R + 0.012, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), capMat); crown.position.y = HEAD_R + 0.02; this.head.add(crown);
      const brim = new THREE.Mesh(geo(new THREE.BoxGeometry(0.19, 0.012, 0.13)), capMat); brim.position.set(0, HEAD_R + 0.055, look.capBack ? -0.13 : 0.13); brim.rotation.x = look.capBack ? 0.15 : -0.15; this.head.add(brim);
    } else {
      const hair = new THREE.Mesh(geo(new THREE.SphereGeometry(HEAD_R + 0.008, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), mat({ color: look.hair, roughness: 0.95 })); hair.position.y = HEAD_R + 0.02; this.head.add(hair);
    }
    if (look.glasses) { const g = new THREE.Mesh(geo(new THREE.BoxGeometry(0.17, 0.035, 0.03)), mat({ color: 0x050507, roughness: 0.2, metalness: 0.4 })); g.position.set(0, HEAD_R + 0.035, HEAD_R - 0.005); this.head.add(g); }
    const band = new THREE.Mesh(geo(new THREE.TorusGeometry(HEAD_R + 0.02, 0.011, 6, 20, Math.PI)), gear); band.position.y = HEAD_R + 0.02; this.head.add(band);
    for (const s of [-1, 1]) { const cup = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10)), gear); cup.rotation.z = Math.PI / 2; cup.position.set(s * (HEAD_R + 0.02), HEAD_R + 0.01, 0); this.head.add(cup); }
    // arms: shoulder pivot → upper arm (sleeve) → elbow pivot → forearm → hand; posed by two-bone IK every frame
    this.arms = [];
    for (const s of [-1, 1]) {
      const upper = new THREE.Group(); upper.position.set(s * SX, SY, 0); this.hips.add(upper);
      const ua = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.05, L1 - 0.02, 3, 8)), shirt); ua.position.y = -L1 * 0.5; upper.add(ua);
      const fore = new THREE.Group(); fore.position.y = -L1; upper.add(fore);
      const fa = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.042, L2 - 0.04, 3, 8)), skin); fa.position.y = -L2 * 0.5; fore.add(fa);
      const hand = new THREE.Mesh(geo(new THREE.SphereGeometry(0.052, 10, 8)), skin); hand.position.y = -L2; hand.scale.set(0.9, 1, 1.15); fore.add(hand);
      this.arms.push({ side: s, upper, fore, shoulder: new THREE.Vector3(s * SX, SY, 0), pole: new THREE.Vector3(s * 0.9, -0.35, -0.5).normalize(), goal: new THREE.Vector3(cx + s * 0.3, DECK.TH + 0.05, 0.85), cur: new THREE.Vector3(cx + s * 0.3, DECK.TH + 0.05, 0.85) });
    }
  }

  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }

  reseed(seed) { this.rng = new SongRng(seed); }

  // ---- gesture state machine
  setMode(mode, show) {
    const r = this.rng, span = MODE_LEN[mode] || [1, 2];
    this.mode = mode; this.modeT = 0; this.modeBars = 0; this.modeLen = span[0] + r.int(span[1] - span[0] + 1);
    // which player and hand this DJ works: the player in front of them, or either for the one in the middle
    this.jogX = this.cx < -0.2 ? -DECK.CDJ_X : this.cx > 0.2 ? DECK.CDJ_X : (r.chance(0.5) ? -DECK.CDJ_X : DECK.CDJ_X);
    this.jogHand = Math.sign(this.jogX - this.cx) || r.pick([-1, 1]);
    this.pointSide = r.chance(0.5) ? -1 : 1; this.pointDir = this.pointSide * r.range(0.15, 0.5);
    this.cupSide = r.chance(0.5) ? -1 : 1;
    const build = show && show.phase === 'build';
    this.up = (mode === 'handsUp' || mode === 'crowdWide') && build ? clamp((show.buildProgress - 0.15) / 0.7, 0.15, 1) : 0;
    if (mode === 'handsUp' && build) this.modeLen = 99;   // stays up until the drop cuts it off
  }
  weights(show) {
    const g = this.genre, hard = /hardstyle|hardcore|rawstyle|frenchcore|hardtechno/.test(g), tech = /techno|deep|tech|minimal|melodic/.test(g);
    let w;
    switch (show.phase) {
      case 'intro': w = { mix: 6, headphone: 3, wave: 1, rest: 1 }; break;
      case 'groove': w = { mix: 5, headphone: 2, point: 1.5, wave: 1, clap: 1, pump: 1, crowdWide: 0.5 }; break;
      case 'build': w = { handsUp: 3 + 5 * show.buildProgress, mix: 3, ears: 1, clap: 1, crowdWide: 1.5, headphone: 0.5 }; break;
      case 'drop': w = { pump: 4, mix: 3, clap: 1.5, point: 1.5, lean: 1.5, jump: 0.8, handsUp: 1 }; break;
      case 'peak': w = { pump: 3, mix: 4, clap: 1.5, point: 1.5, lean: 1, jump: 1, handsUp: 1, wave: 0.5 }; break;
      case 'breakdown': w = { mix: 4, headphone: 2, wave: 1.5, crowdWide: 1.5, rest: 1.5, point: 0.5 }; break;
      default: w = { rest: 1 };
    }
    if (hard) { if (w.lean) w.lean *= 3; if (w.jump) w.jump *= 1.6; if (w.pump) w.pump *= 1.3; }
    if (tech) { if (w.mix) w.mix *= 1.8; if (w.clap) w.clap *= 0.4; if (w.pump) w.pump *= 0.5; if (w.jump) w.jump *= 0.3; if (w.headphone) w.headphone *= 1.5; }
    const entries = Object.entries(w); if (entries.length > 1) for (const e of entries) if (e[0] === this.mode) e[1] *= 0.35;   // vary
    return entries;
  }
  pick(show) { this.setMode(this.rng.weighted(this.weights(show)), show); }
  onPhase(show) {
    const p = show.phase;
    if (p === 'drop') { this.setMode(this.rng.chance(0.65) ? 'jump' : 'pump', show); this.modeLen = 2; }
    else if (p === 'build') this.setMode('mix', show);
    else if (p === 'idle') this.setMode('rest', show);
    else this.pick(show);
  }
  onBar(show) {
    const r = this.rng;
    if (show.phase === 'build' && this.mode !== 'handsUp' && this.mode !== 'crowdWide' && show.buildProgress > 0.45 && r.chance(0.5)) { this.setMode(r.chance(0.75) ? 'handsUp' : 'crowdWide', show); return; }
    if (this.mode === 'mix' && this.modeBars % 2 === 0 && r.chance(0.4)) { this.jogHand = -this.jogHand; if (Math.abs(this.cx) < 0.2 && r.chance(0.5)) this.jogX = -this.jogX; }
  }

  update(show, dt, c) {
    this.t += dt; this.modeT += dt;
    const r = this.rng;
    // ---- what to do next
    if (!c.live) { if (this.mode !== 'rest') this.setMode('rest', show); }
    else if (c.phaseChanged) this.onPhase(show);
    else if (show.bar) { this.modeBars++; if (this.modeBars >= this.modeLen) this.pick(show); else this.onBar(show); }
    else if (this.modeT > (this.modeLen * 4 + 6) * (show.period || 0.47) * 1.5) this.pick(show);   // bars stopped arriving → move on anyway
    if (c.live && show.phase === 'build' && show.predrop && this.mode !== 'handsUp' && this.mode !== 'crowdWide') { this.setMode(r.chance(0.7) ? 'handsUp' : 'crowdWide', show); this.modeLen = 99; }
    const mode = this.mode, M = MODES[mode], A = c.amp;
    if (mode === 'handsUp' || mode === 'crowdWide') {
      const rate = show.phase === 'build' && !show.predrop ? 0.12 : show.predrop ? 3 : 1.6;
      this.up = Math.min(1, this.up + dt * rate);
      if (show.phase === 'build') this.up = Math.max(this.up, clamp((show.buildProgress - 0.15) / 0.7, 0, 1));
    }
    if (mode === 'mix') this.fader = show.phase === 'build' ? -0.06 + 0.14 * show.buildProgress : 0.07 * Math.sin(this.t * 0.6 + this.idx);

    // ---- body: knee dip into the beat, jumps on the drop, bar-rate sway, torso lean and twist
    const dip = 0.06 * A * c.down * M.dip;
    const jump = mode === 'jump' ? 0.2 * A * Math.sin(Math.PI * c.bp) : 0;
    const breath = 0.006 * Math.sin(this.t * 1.7 + this.idx * 2);
    this.hips.position.y = HIP_Y - dip + jump + breath;
    this.legs.scale.y = (HIP_Y - dip) / HIP_Y; this.legs.position.y = jump;
    const sway = Math.sin(Math.PI * 2 * show.barPhase + this.idx * 0.9) * M.sway;
    this.root.position.x = this.cx + 0.035 * A * sway;
    this.lean += (M.lean + 0.07 * A * c.down * M.nod - this.lean) * damp(dt, 8);
    this.twist += (this.twistT - this.twist) * damp(dt, 5);
    this.hips.rotation.set(this.lean, this.twist, 0.07 * A * sway);
    // head: base pitch per gesture plus the beat nod (down on the kick), yaw/roll set by the gesture below
    this.head.rotation.x = M.headX + 0.24 * M.nod * A * c.down;
    this.headYaw += (this.headYawT - this.headYaw) * damp(dt, 6);
    this.headRoll += (this.headRollT - this.headRoll) * damp(dt, 6);
    this.head.rotation.y = this.headYaw; this.head.rotation.z = this.headRoll;

    // ---- hands (riser space, metres)
    const q = this.hips.quaternion, P = this.root.position, H = this.hips.position;
    const shoulder = (s, out) => out.set(s * SX, SY, 0).applyQuaternion(q).add(H).add(P);
    const ear = (s, out) => out.set(s * (HEAD_R + 0.045), HEAD_Y + HEAD_R + 0.02, 0.01).applyQuaternion(q).add(H).add(P);
    const rest = (s, out) => out.set(this.cx + s * 0.30, DECK.TH + 0.04, DECK.TZ - DECK.TD * 0.5 + 0.10);
    const L = this.arms[0], R = this.arms[1], arm = (s) => (s < 0 ? L : R);
    const jogNudge = (out) => { const th = Math.PI * 2 * ((show.beatIndex % 4) + c.bp) / 4, n = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + this.idx)); return out.set(this.jogX + 0.07 * n * Math.sin(th), DECK.JOG_Y + 0.035, DECK.GZ + 0.045 * n * Math.cos(th)); };
    const mixerOrButtons = (s, out) => {   // the mixer if it is in reach of this shoulder, else the player's cue buttons
      if (Math.abs(this.cx + s * SX) < 0.47) return out.set(s * 0.06 + 0.05 * Math.sin(this.t * 1.3 + this.idx), DECK.MIX_Y + 0.045 + 0.012 * c.hit, DECK.GZ + 0.03 + this.fader);
      return out.set(this.jogX + s * 0.13, DECK.JOG_Y + 0.03 + 0.01 * c.hit, DECK.GZ - 0.16);
    };
    let headYaw = 0, headRoll = 0, twist = 0;
    switch (mode) {
      case 'mix': {
        jogNudge(arm(this.jogHand).goal); mixerOrButtons(-this.jogHand, arm(-this.jogHand).goal);
        headYaw = Math.atan2(this.jogX - this.cx, 0.45) * 0.8; twist = headYaw * 0.35; break;
      }
      case 'headphone': {
        const s = this.cupSide; ear(s, arm(s).goal).add(_v1.set(s * 0.02, 0.0, 0.03));
        jogNudge(arm(-s).goal);
        headRoll = -s * 0.28; headYaw = Math.atan2(this.jogX - this.cx, 0.45) * 0.5; twist = headYaw * 0.3; break;
      }
      case 'handsUp': {
        const up = this.up, sw = Math.sin(Math.PI * 2 * show.barPhase) * up;
        for (const a of this.arms) shoulder(a.side, a.goal).add(_v1.set(a.side * (0.20 + 0.10 * (1 - up)) + 0.10 * sw, 0.12 + 0.44 * up + 0.03 * Math.abs(sw) + 0.05 * c.hit * A * up, 0.22 * (1 - up) + 0.06));
        break;
      }
      case 'pump': {
        // fists alternate per beat; the hand rising ahead of the next beat is the one that lands on it
        const beat = c.bp < 0.7 ? show.beatIndex : show.beatIndex + 1, active = ((beat + this.idx) & 1) ? 1 : -1;
        for (const a of this.arms) {
          if (a.side === active) shoulder(a.side, a.goal).add(_v1.set(a.side * 0.14, 0.08 + 0.48 * c.hit, 0.18 - 0.08 * c.hit));
          else shoulder(a.side, a.goal).add(_v1.set(a.side * 0.20, 0.02, 0.24));
        }
        twist = -active * 0.12; break;
      }
      case 'clap': {
        const every = show.phase === 'drop' || show.phase === 'peak', cp = every ? c.bp : ((show.beatInBar & 1) + c.bp) / 2, h = hitShape(cp);
        const gap = 0.045 + 0.24 * (1 - h);
        shoulder(-1, _v2); shoulder(1, _v3); _v2.add(_v3).multiplyScalar(0.5).add(_v1.set(0, 0.46, 0.12));
        for (const a of this.arms) a.goal.copy(_v2).add(_v1.set(a.side * gap, 0.02 * (1 - h), 0));
        break;
      }
      case 'point': {
        const s = this.pointSide, th = this.pointDir + 0.45 * Math.sin(this.t * 0.6 + this.idx);
        _v1.set(Math.sin(th), 0.38 + 0.1 * Math.sin(this.t * 1.1), Math.cos(th)).normalize().multiplyScalar(0.59);
        shoulder(s, arm(s).goal).add(_v1);
        mixerOrButtons(-s, arm(-s).goal);
        headYaw = th * 0.7; twist = th * 0.35; break;
      }
      case 'wave': {
        const s = this.pointSide;
        shoulder(s, arm(s).goal).add(_v1.set(s * 0.16 + 0.14 * Math.sin(this.t * 6.5), 0.50 + 0.03 * Math.cos(this.t * 6.5), 0.08));
        rest(-s, arm(-s).goal); headYaw = s * 0.2; break;
      }
      case 'jump': {
        for (const a of this.arms) shoulder(a.side, a.goal).add(_v1.set(a.side * 0.20, 0.50 + 0.04 * c.hit, 0.04));
        break;
      }
      case 'crowdWide': {
        const up = this.up;
        for (const a of this.arms) shoulder(a.side, a.goal).add(_v1.set(a.side * (0.52 - 0.30 * up), -0.12 + 0.62 * up, 0.10 + 0.05 * up));
        break;
      }
      case 'ears': {
        const s = this.cupSide; ear(s, arm(s).goal).add(_v1.set(s * 0.05, 0.0, -0.06));
        _v1.set(-s * 0.3, 0.25, 1).normalize().multiplyScalar(0.59); shoulder(-s, arm(-s).goal).add(_v1);
        headYaw = -s * 0.8; twist = -s * 0.3; break;
      }
      case 'lean': { for (const a of this.arms) rest(a.side, a.goal); break; }
      default: { for (const a of this.arms) rest(a.side, a.goal); headYaw = 0.3 * Math.sin(this.t * 0.4 + this.idx); }
    }
    this.headYawT = headYaw; this.headRollT = headRoll; this.twistT = twist;
    // ---- track the goals and solve the arms
    const k = damp(dt, M.speed);
    for (const a of this.arms) { a.cur.lerp(a.goal, k); this._solve(a, a.cur); }
  }

  // two-bone IK: hips-space target → shoulder and elbow quaternions (elbow bends toward the arm's pole vector)
  _solve(a, targetRiser) {
    const T = _v1.copy(targetRiser).sub(this.root.position).sub(this.hips.position).applyQuaternion(_q1.copy(this.hips.quaternion).invert());
    const d = _v2.subVectors(T, a.shoulder); let len = d.length(); if (len < 1e-4) { d.set(0, -1, 0); len = 1; }
    d.multiplyScalar(1 / len);
    const reach = clamp(len, 0.08, L1 + L2 - 0.006);
    const cosA = (L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach), ang = Math.acos(clamp(cosA, -1, 1));
    const n = _v3.copy(a.pole).addScaledVector(d, -d.dot(a.pole)); if (n.lengthSq() < 1e-6) n.set(a.side, 0, 0); n.normalize();
    const u = _v4.copy(d).multiplyScalar(Math.cos(ang)).addScaledVector(n, Math.sin(ang));
    a.upper.quaternion.setFromUnitVectors(DOWN, u);
    const E = _v3.copy(a.shoulder).addScaledVector(u, L1);                 // elbow
    const f = _v5.copy(a.shoulder).addScaledVector(d, reach).sub(E).normalize();   // forearm direction (hips space)
    f.applyQuaternion(_q1.copy(a.upper.quaternion).invert());
    a.fore.quaternion.setFromUnitVectors(DOWN, f);
  }
}

export class Djs {
  constructor(scale = DECK.SCALE) {
    this.group = new THREE.Group(); this.group.scale.setScalar(scale); this.group.position.set(0, DECK.RY, DECK.Z0 * scale);
    this.figs = []; this.identity = ''; this.seed = 0; this.t = 0; this.phase = 'idle'; this.amp = 0;
    this.setAct(null, null);
  }
  get count() { return this.figs.length; }

  // the act: how many figures (duo / trio) and what they look like is keyed on the artist, so the same DJ stays on
  // stage across their songs; the gesture RNG is reseeded per song so no two songs get the same routine
  setAct(profile, track) {
    const count = memberCount(profile, track), id = (profile && profile.id) || 'generic', genre = (profile && profile.genre) || '';
    const identity = id + ':' + count;
    const seed = ((profile && profile.seed) || 1) >>> 0;
    let rebuilt = false;
    if (identity !== this.identity) {
      rebuilt = true;
      for (const f of this.figs) { this.group.remove(f.root); f.dispose(); }
      this.figs = [];
      const xs = count >= 3 ? [-0.95, 0, 0.95] : count === 2 ? [-0.5, 0.5] : [0];
      const look = new SongRng(hashStr(identity));
      const palette = (profile && profile.palette && profile.palette.length ? profile.palette : ['#3355aa']);
      xs.forEach((cx, i) => {
        const shirtPick = look.next();
        const shirt = shirtPick < 0.5 ? 0x1c1c22 : shirtPick < 0.75 ? 0xd8d8dd : new THREE.Color(look.pick(palette)).multiplyScalar(0.55).getHex();   // black tees read as charcoal under the rim and the fill
        const skins = [0xf1c9a5, 0xd9a677, 0xb98a63, 0x8d5a3b, 0x5c3a24];
        const fig = new Figure(i, cx, { shirt, skin: look.pick(skins), cap: look.chance(0.45), capBack: look.chance(0.3), capColor: look.chance(0.7) ? 0x0e0e12 : new THREE.Color(look.pick(palette)).multiplyScalar(0.5).getHex(), glasses: look.chance(0.4), hair: look.chance(0.8) ? 0x151210 : 0x3a2a1c }, genre);
        this.group.add(fig.root); this.figs.push(fig);
      });
      this.identity = identity;
    }
    if (rebuilt || seed !== this.seed) { this.seed = seed; this.figs.forEach((f, i) => f.reseed((seed ^ Math.imul(i + 1, 0x9E3779B9)) >>> 0)); }
    for (const f of this.figs) f.genre = genre;
  }

  update(show, dt) {
    dt = clamp(dt || 0, 0, 0.1); this.t += dt;
    const phaseChanged = show.phase !== this.phase; this.phase = show.phase;
    const live = !!show.active && !show.silence;
    // beat clock: `bp` runs 0 → 1 between beats (0 on the beat); the body is lowest on the beat and highest halfway
    const gridOk = live && show.bpm > 0 && show.beatPhase <= 1.05;
    const bp = gridOk ? Math.min(1, show.beatPhase) : 0.5;
    const down = gridOk ? 1 - Math.pow(Math.sin(Math.PI * bp), 0.9) : 0;
    const hit = gridOk ? hitShape(bp) : 0;
    const conf = show.tempoLocked ? 1 : 0.35 + 0.65 * clamp(show.confidence || 0, 0, 1);
    const target = live ? (PHASE_AMP[show.phase] ?? 0.5) * conf * (0.7 + 0.3 * clamp(show.energySlow || 0, 0, 1)) : 0;
    this.amp += (target - this.amp) * damp(dt, 3);
    const c = { bp, down, hit, amp: this.amp, live, phaseChanged };
    for (const f of this.figs) f.update(show, dt, c);
    // the rim is the show's second colour behind the act, hardest on the kick through the drop and the peak; the fill is
    // the booth's own light: the first colour washed most of the way to white
    const ph = show.phase, hot = ph === 'drop' || ph === 'peak', dip = clamp(show.dip || 0, 0, 1), wo = clamp(show.whiteout || 0, 0, 1);
    const rk = live ? (hot ? 0.75 + 0.6 * (show.kick || 0) : ph === 'build' ? 0.5 + 0.3 * (show.buildProgress || 0) : 0.45) : 0.25;
    FIGURE_LIGHT.rim.value.copy(_rimC.copy(show.colorB || WHITE).lerp(WHITE, 0.15 + 0.85 * wo).multiplyScalar(rk * (1 - 0.7 * dip)));
    FIGURE_LIGHT.fill.value.copy(_fillC.copy(show.colorA || WHITE).lerp(WHITE, 0.6).multiplyScalar((live ? 0.28 + 0.12 * (show.kick || 0) : 0.18) * (1 - 0.5 * dip)));
  }
}
