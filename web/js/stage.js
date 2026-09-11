// Virtual Music Festival — the virtual main stage.
//  - set geometry (deck, booth, LED walls, trusses, towers), built 4x life size around a human-scale crowd
//  - fixture rigs: ~210 moving heads, ~165 strobes/blinders, 31 laser sources (~235 beams),
//    ~3.8k rig pixels + the artist centrepiece (another 0.5–1.5k pixels, kinetic parts, holo screens)
//  - cue handling from the director (drops, bars, phrases, phases, pyro, logos)
//  - per-song look (seeded from the track) so no two songs run the same show
//  - auto camera + post chain (bloom)
// Everything is driven from the director's `show` frame, which is beat-grid predicted, so every hit lands on the kick.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { V3, BEAM_GAIN, BeamArray, StrobeArray, LaserBank, PixelStrips, LedPanel, Crowd, Particles, pathLine, pathArc, pathRect } from './fixtures.js';
import { Centrepiece, ORIGIN } from './centrepieces.js';
import { Festival } from './festival.js';
import { Djs, DECK, FIGURE_LIGHT } from './dj.js';
import { Fireworks } from './fireworks.js';
import { colorsFrom, drawProgram, PROGRAM_INFO, PROGRAMS, PROGRAM_NAMES } from './programs.js';
import { SongRng, resolveProfile } from './artists.js';

const WHITE = new THREE.Color(1, 1, 1);
const GREEN = new THREE.Color(0.15, 1, 0.35);
const frac = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const hash = (n) => { let x = Math.imul(n | 0, 374761393); x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const HI = new Set(['drop', 'peak']);
const SHOTS = 11;   // every shot frames the stage (see Stage._updateCamera); 10 is the booth close-up on the DJs
const DROP_SHOTS = [0, 3, 5, 8, 4, 9, 10, 10];
const ALL_SHOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Auto-iris (IrisPass / Stage._readIris / _updateWorld): highlight-priority auto exposure, like a broadcast camera's
// iris. The composer's HDR buffer (scene + bloom, before tone mapping) is metered into 16x9 cells: each cell is the
// mean of 64 taps of luminance clamped at IRIS_RANGE, so a beam at 40x counts the same as one at 2x and the meter
// reads "how much of the cell is blown out". The brightest quarter of the cells (IRIS_TOP) is what the iris keys
// on: exposure scales so that quarter lands near IRIS_TARGET linear (a dark stage with bright fixtures meters
// under the target and keeps the base exposure; a laser and beam wall wash meters at 1.5-2 and closes the iris a
// stop, which also gives the lasers their colour back since ACES bleaches anything that bright).
const IRIS_W = 16, IRIS_H = 9, EXPO_BASE = 1.05, EXPO_MIN = 0.5, IRIS_RANGE = 2, IRIS_TOP = 36, IRIS_TARGET = 0.47;
const IRIS_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const IRIS_FS = `uniform sampler2D tSrc; uniform vec2 uCell; varying vec2 vUv;
void main() {
  vec2 acc = vec2(0.0);
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
    vec3 c = texture2D(tSrc, vUv + ((vec2(float(x), float(y)) + 0.5) / 8.0 - 0.5) * uCell).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    acc += vec2(min(l, ${IRIS_RANGE}.0) / ${IRIS_RANGE}.0, step(1.0, l));
  }
  gl_FragColor = vec4(acc / 64.0, 0.0, 1.0);
}`;

// Sits between the bloom and the output pass, where the composer's read buffer holds the HDR frame.
class IrisPass extends Pass {
  constructor(stage) { super(); this.stage = stage; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) { this.stage._readIris(readBuffer); }
}
const _hsl = { h: 0, s: 0, l: 0 };
// Hue of the first given colour a laser can show, as a monochromatic (fully saturated) laser line. The palette variety
// modes put white, grey or pastel accents on colorA/colorC at times, and a pale laser bank stacked on the beam wall
// reads as a white web over the crowd shots; a real laser is a pure hue no matter what the LED palette does.
const laserColor = (out, ...cols) => {
  for (const c of cols) { c.getHSL(_hsl, THREE.SRGBColorSpace); if (_hsl.s >= 0.3 && _hsl.l >= 0.12 && _hsl.l <= 0.8) return out.setHSL(_hsl.h, 1, 0.5, THREE.SRGBColorSpace); }
  cols[0].getHSL(_hsl, THREE.SRGBColorSpace); return out.setHSL(_hsl.h, 1, 0.5, THREE.SRGBColorSpace);
};
const _lzA = new THREE.Color(), _lzC = new THREE.Color(), _camL = new THREE.Vector3();

// ---------------------------------------------------------------- tables
const HEAD_BASE = { idle: 0.08, intro: 0.28, groove: 0.4, build: 0.5, drop: 0.72, peak: 0.6, breakdown: 0.2 };
const LASER_GROUPS = 6; // back truss, front truss, towers, wings, deck, arch cones
// The set, rig, centrepiece and grounds are authored in "site" units and live in a group scaled WORLD_SCALE times, so the
// stage stands 4x life size; the crowd is built near 1/WORLD_SCALE inside it so people stay human. The camera and lights
// work in world units, hence the point-light compensation (three.js point lights fall off as 1/d^decay, decay 1.8).
const WORLD_SCALE = 4;
const LIGHT_K = Math.pow(WORLD_SCALE, 1.8);
// crowd bodies: a fifth over human scale (1.2 / WORLD_SCALE) and packed into the front of the field, so the field reads
// as a crowd from the stage shots instead of a scatter of dots, while the set still towers over it.
const CROWD_SCALE = 1.2 / WORLD_SCALE;
const DENSITY_PRESETS = [['low', 0.45], ['med', 0.7], ['high', 1.0]];
const HEAD_SETS = {
  idle: ['slowSweep', 'skySearch'],
  intro: ['slowSweep', 'skySearch', 'fanUp', 'circles', 'tiltWave'],
  groove: ['crowdSweep', 'cross', 'wave', 'fanUp', 'circles', 'tiltWave', 'symFan', 'kickFlick', 'crowdPoint'],
  build: ['converge', 'fanUp', 'pyramid', 'symFan', 'tiltWave'],
  drop: ['chaos', 'converge', 'cross', 'symFan', 'kickFlick', 'wave', 'floorFan', 'tiltWave'],
  peak: ['wave', 'chaos', 'cross', 'crowdSweep', 'converge', 'symFan', 'kickFlick', 'tiltWave', 'crowdPoint', 'floorFan', 'circles', 'pyramid'],
  breakdown: ['slowSweep', 'stageWash', 'fanUp', 'skySearch', 'circles'],
};
const LASER_SETS = {
  build: ['fan', 'sky', 'tunnel', 'liquid'],
  drop: ['fan', 'kick', 'cross', 'scan', 'liquid', 'tunnel'],
  peak: ['fan', 'scan', 'cross', 'kick', 'sky', 'liquid', 'tunnel'],
  groove: ['scan', 'fan', 'liquid'],
  breakdown: ['sky', 'liquid'],
};
const PANEL_ENERGY = { idle: 0.2, intro: 0.3, groove: 0.5, build: 0.6, drop: 0.85, peak: 0.78, breakdown: 0.3 };
const BOOTH_POOL = ['bars', 'pulse', 'lines', 'scan', 'strobeBars', 'chevrons', 'wash', 'grid', 'noise', 'flash'];
const RIBBON_POOL = ['bars', 'lines', 'scan', 'pulse', 'strobeBars', 'chevrons', 'waves', 'noise', 'particles'];
const HOLO_POOL = ['rings', 'mandala', 'figure', 'sun', 'particles', 'starfield', 'hexes', 'shards', 'tunnel', 'aurora', 'blobs', 'disco'];
const FLAME_X = [-24, -16, -8, 8, 16, 24];
// IMAG (the live DJ feed on the side screens): the objects the booth camera sees live on this layer, and its shots are
// authored in site units around the DJ's head (~(0, 7.2, -0.75)) and the console (top at y 6.55, front edge z 0.4)
const IMAG_LAYER = 1;
// the feed is lit like a broadcast booth camera would be: for the feed render only, the booth light runs hotter and
// the figures' fill and rim open up, so a DJ in a black tee reads on the wings instead of cutting a silhouette
const IMAG_KEY = 2.5, IMAG_FILL = 2.5, IMAG_RIM = 1.5;
const _imagFill = new THREE.Color(), _imagRim = new THREE.Color();
const IMAG_PRESETS = [
  { eye: [0.3, 7.0, 5.6], look: [0, 6.85, -0.75], fov: 26 },     // front, from the pit: the DJ over the console
  { eye: [-3.6, 7.5, 2.6], look: [0, 6.7, -0.6], fov: 28 },      // stage-left three-quarter
  { eye: [3.4, 7.4, 2.9], look: [0, 6.7, -0.6], fov: 28 },       // stage-right three-quarter
  { eye: [1.0, 8.2, 3.4], look: [0, 6.5, -0.2], fov: 30 },       // high over the decks: the hands on the players
  { eye: [0, 6.7, 4.4], look: [0, 7.0, -0.75], fov: 24 },        // low and tight: the face, the hands up
];
const SPARK_X = [-20, -10, 10, 20];
const BAND_BINS = [[1, 3], [3, 6], [6, 12], [12, 24], [24, 48], [48, 96], [96, 200], [200, 420]];
const ZONE = { arch: 0, truss: 1, tower: 2, col: 3, deck: 4, frame: 5, drop: 6, runway: 7, floor: 9, riser: 10 };

// ---------------------------------------------------------------- rig pixel patterns (shape agnostic, zone aware)
const pc = new THREE.Color();
const RIG_PAT = {
  breathe(s, i, P) { pc.copy(P.A).lerp(P.C, 0.5 + 0.5 * Math.sin(P.t * 0.3 + s.idx)); return 0.18 + 0.14 * Math.sin(P.t * 1.2 + s.u[i] * 6 + s.idx); },
  chase(s, i, P) { const f = frac(s.u[i] * P.rep - P.t * P.speed * (s.idx & 1 ? -P.dir : P.dir)); pc.copy(f < 0.05 ? WHITE : P.A); return f < 0.22 ? 1 - f * 4 : 0.05; },
  sweepX(s, i, P) { const x = s.xn[i] * 0.5 + 0.5, p = frac(P.t * 0.3 * P.dir), k = Math.exp(-Math.pow((x - p) * 8, 2)); pc.copy(P.C).lerp(WHITE, k * 0.5); return 0.05 + k; },
  radialKick(s, i, P) { const pos = P.bp * 1.2, w = Math.exp(-Math.pow((s.d[i] - pos) * 6, 2)); pc.copy(P.A).lerp(WHITE, w * 0.6); return 0.07 + w * (1 - P.bp * 0.4); },
  radialIn(s, i, P) { const pos = 1.15 - P.bp * 1.2, w = Math.exp(-Math.pow((s.d[i] - pos) * 6, 2)); pc.copy(P.B).lerp(WHITE, w * 0.5); return 0.07 + w; },
  vu(s, i, P) { const lvl = P.levels[s.band & 7], h = s.h[i]; if (h > lvl) return 0.03; pc.copy(P.A).lerp(P.B, h).lerp(WHITE, h > lvl - 0.08 ? 0.7 : 0); return 1; },
  alternate(s, i, P) { const on = ((s.idx + P.beatIdx) & 1) === 0; pc.copy(on ? P.A : P.B); return on ? 0.35 + 0.65 * P.pulse : 0.08; },
  mirror(s, i, P) { const x = Math.abs(s.xn[i]), e = P.bp * 1.1, k = x < e ? Math.exp(-(e - x) * 4) : 0; pc.copy(P.barOdd ? P.A : P.B); return 0.05 + k; },
  strobe(s, i, P) { const k = P.kick > 0.05 ? P.kick : P.snare * 0.7; pc.copy(P.kick > 0.05 ? WHITE : P.B); return 0.03 + k; },
  sparkle(s, i, P) { const r = hash(i * 131 + s.idx * 977 + P.tick * 7919); if (r > P.density) return 0.03; pc.copy(r < P.density * 0.3 ? WHITE : P.A); return 1; },
  wipeV(s, i, P) { const h = 1 - s.h[i], k = h < P.bp ? Math.exp(-(P.bp - h) * 5) : 0; pc.copy(P.C); return 0.05 + k; },
  rain(s, i, P) { const f = frac(s.h[i] * 3 + P.t * 1.4 * P.dir + s.idx * 0.37); pc.copy(f < 0.03 ? WHITE : P.B); return f < 0.16 ? 1 - f * 6 : 0.04; },
  spectrum(s, i, P) { const v = P.spec ? P.spec[(Math.floor(s.ang[i] * 90) + 2) | 0] / 255 : 0; pc.copy(P.A).lerp(P.B, v); return 0.05 + v * v * 1.1; },
  wave(s, i, P) { const k = 0.5 + 0.5 * Math.sin(s.d[i] * 7 - P.t * 2.2 + s.u[i] * 2); pc.copy(P.C).lerp(P.A, s.h[i]); return 0.04 + 0.38 * k * k; },
  fillOut(s, i, P) { const lit = s.d[i] < P.prog; pc.copy(P.B).lerp(WHITE, P.prog * P.prog); if (lit) return 0.45 + 0.55 * P.pulse; const r = hash(i * 131 + s.idx * 977 + P.tick * 7919); return r < P.prog * 0.15 ? 0.9 : 0.03; },
  runway(s, i, P) { const pos = P.bp * 1.2, w = Math.exp(-Math.pow((s.zn[i] - pos) * 6, 2)); pc.copy(P.A).lerp(WHITE, w * 0.5); return 0.05 + w; },
  bands(s, i, P) { const v = P.levels[s.band & 7]; pc.copy(P.A).lerp(P.B, v); return 0.05 + v * v; },
  scan(s, i, P) { const x = s.xn[i] * 0.5 + 0.5, p = frac(P.t * 0.9), k = Math.exp(-Math.pow((x - p) * 9, 2)); pc.copy(P.C).lerp(WHITE, k * 0.6); return 0.05 + k; },
  zones(s, i, P) { const on = ((s.zone + P.beatIdx) % 3) === 0; pc.copy(on ? WHITE : P.A); return on ? 0.4 + 0.6 * P.pulse : 0.08; },
};
const RIG_SETS = {
  idle: ['breathe'],
  intro: ['chase', 'breathe', 'sweepX', 'scan', 'rain'],
  groove: ['chase', 'sweepX', 'alternate', 'spectrum', 'radialKick', 'bands', 'scan', 'runway', 'rain', 'wave'],
  build: ['fillOut'],
  drop: ['radialKick', 'strobe', 'alternate', 'mirror', 'vu', 'chase', 'sweepX', 'wipeV', 'sparkle', 'zones', 'radialIn', 'bands', 'runway'],
  peak: ['radialKick', 'alternate', 'mirror', 'vu', 'chase', 'sweepX', 'zones', 'radialIn', 'bands', 'sparkle', 'runway', 'rain'],
  breakdown: ['wave', 'breathe', 'sparkle', 'scan', 'rain'],
};

export class Stage {
  constructor(canvas, director) {
    this.canvas = canvas;
    this.director = director;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);   // pure black night sky: no dome, no moon, no glow, only the stars
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0045 / WORLD_SCALE);   // fog fades to the same black as the sky
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 750 * WORLD_SCALE);   // far: the star shell (480 site units) must fit
    this.camera.position.set(0, 18 * WORLD_SCALE, 70 * WORLD_SCALE);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 13 * WORLD_SCALE, -6 * WORLD_SCALE);
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 3 * WORLD_SCALE;   // the booth close-up (shot 10) orbits ~4 site units from the DJs; OrbitControls clamps the radius after the shot lerp
    this.controls.maxDistance = 220 * WORLD_SCALE;
    this.manualUntil = 0;
    this.controls.addEventListener('start', () => { this.manualUntil = performance.now() + 25000; });

    this.autoCam = true; this.shotIndex = 0; this.shotStartBar = 0; this.shotTime = 0; this.shotOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; this.shotPtr = 0;
    this.track = null; this.t = 0; this.textUntil = 0; this.dropBar = -100; this.lastProgPick = -100;
    this.logo = { on: false, at: -1, len: 6, until: 0, since: 0, mode: 'wipe', g0: 0.5, last: -100, mirror: false, image: false, overlayUntil: 0 };
    this.fx = { flameUntil: 0, sparkUntil: 0 };
    this.col = {};
    this.o = { profile: null, track: null, logo: { reveal: 0, mode: 'wipe', glitch: 0, image: false }, variant: 0, white: 0.5, kickHit: false, snareHit: false, hatHit: false, logoImg: null, logoOverlay: 0 };
    this.tmpC = new THREE.Color(); this.tmpC2 = new THREE.Color(); this.tmpV = new THREE.Vector3(); this.tmpV2 = new THREE.Vector3();
    this.levels = new Float32Array(8);
    this.P = { t: 0, A: WHITE, B: WHITE, C: WHITE, bp: 0, pulse: 0, kick: 0, snare: 0, beatIdx: 0, dir: 1, level: 0, prog: 0, tick: 0, density: 0.05, barOdd: 0, spec: null, speed: 0.5, rep: 3, levels: this.levels };
    this.centreCtx = { A: WHITE, B: WHITE, C: WHITE, rng: null, gain: 1.6, strobes: 0.8, dt: 0.016 };
    this.headLoad = 0; this.bloomS = 0.4;
    // rig density: user control (Lights button, - / = keys). Scales beam brightness, head duty and laser groups.
    let dens = 0.7; try { const v = parseFloat(localStorage.getItem('vf.density')); if (v >= 0.3 && v <= 1.2) dens = v; } catch {}
    this.density = dens;
    this.laserTick = 0; this.chaosTick = 0; this.laserPat = 'fan'; this.rigPat = 'breathe'; this.rigDir = 1; this.rigRep = 3; this.pattern = 'slowSweep'; this.patternB = 'slowSweep'; this.patPtr = {};

    this._buildWorld();
    this._buildStage();
    this._buildFestival();
    this._buildRig();
    this._buildPost();
    this.setDensity(this.density);
    this.centre = null; this.centreKey = ''; this.allPanels = this.panels;
    this.setProfile(resolveProfile({ name: '', artist: '', id: '' }));
    this._bindCues();
    this.resize();
  }

  // ------------------------------------------------------------ world
  _buildWorld() {
    const s = this.scene;
    // `big` holds the whole site (set, rig, centrepiece, grounds, crowd, particles, point lights) at WORLD_SCALE; only the
    // sky-level dressing (ground plane, stars, ambient light) and the camera live in the scene itself.
    const b = this.big = new THREE.Group(); b.scale.setScalar(WORLD_SCALE); s.add(b);
    this.ambLight = new THREE.AmbientLight(0x222233, 0.3); s.add(this.ambLight);
    this.hemiLight = new THREE.HemisphereLight(0x223355, 0x050508, 0.25); s.add(this.hemiLight);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(800 * WORLD_SCALE, 800 * WORLD_SCALE), new THREE.MeshStandardMaterial({ color: 0x16161f, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; s.add(ground);
    const starGeo = new THREE.BufferGeometry(); const sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 0.5 + 0.03, r = 480 * WORLD_SCALE; sp[i * 3] = Math.cos(a) * Math.cos(e) * r; sp[i * 3 + 1] = Math.sin(e) * r; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    s.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8899bb, size: 1.1 * WORLD_SCALE, fog: false })));
    this.washLights = [[-26, 14, 32], [0, 16, 44], [26, 14, 32]].map(p => { const l = new THREE.PointLight(0xffffff, 0, 90 * WORLD_SCALE, 1.8); l.position.set(p[0], p[1], p[2]); b.add(l); return l; });
    this.stageLight = new THREE.PointLight(0xffffff, 4 * LIGHT_K, 50 * WORLD_SCALE, 1.8); this.stageLight.position.set(0, 14, 4); b.add(this.stageLight);
    this.crowd = new Crowd(20000, CROWD_SCALE); b.add(this.crowd.mesh); if (this.crowd.phones) b.add(this.crowd.phones);
    this.particles = new Particles(16000); this.particles.sizeK = WORLD_SCALE; b.add(this.particles.points);
    this.fw = new Fireworks(this.particles);   // shells fired from behind the set, bursting over the roof line
  }

  // ------------------------------------------------------------ set + LED walls + pixel architecture
  _buildStage() {
    const s = this.big;
    const dark = new THREE.MeshStandardMaterial({ color: 0x0e0e14, roughness: 0.8, metalness: 0.3 });
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.5, metalness: 0.8 });
    const box = (w, h, d, x, y, z, m = dark) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); s.add(mesh); return mesh; };
    this.riser = [box(56, 2.2, 16, 0, 1.1, -3), box(14, 1.2, 6, 0, 2.8, -2), box(9, 2.2, 3, 0, 4.5, -1)];
    // the DJs: figures behind the players that DJ to the beat grid (dj.js), built at stage scale (DECK.SCALE) so they
    // and the console read from the field, under their own warm booth key light so they read on the booth close-up
    // and the front shots while the rig is dark around them
    this.djs = new Djs(DECK.SCALE); s.add(this.djs.group);
    this.boothLight = new THREE.PointLight(0xfff1e0, 80 * LIGHT_K, 16 * WORLD_SCALE, 2); this.boothLight.position.set(0, 10.5, 3.5); s.add(this.boothLight);

    // LED walls
    this.panels = [];
    const add = (p, x, y, z, ry = 0) => { p.mesh.position.set(x, y, z); p.mesh.rotation.y = ry; s.add(p.mesh); this.panels.push(p); return p; };
    this.mainPanel = add(new LedPanel(160, 80, 44, 22, { role: 'main', name: 'main' }), 0, 13.5, -10.5);
    add(new LedPanel(160, 12, 44, 3.2, { role: 'ribbon', name: 'ribbon', gain: 1.1 }), 0, 26.4, -10.6);
    add(new LedPanel(72, 16, 9, 2.1, { gain: 1.0, role: 'booth', name: 'booth' }), 0, 4.5, 0.52);
    for (const side of [-1, 1]) {
      add(new LedPanel(48, 72, 12, 18, { role: 'wing', name: 'wing' + side }), side * 31, 12, -7, -side * 0.42);
      add(new LedPanel(24, 96, 4, 24, { gain: 1.0, role: 'tower', name: 'tower' + side }), side * 41, 14, -1, -side * 0.25);
    }

    // trusses
    const bar = (a, b, r = 0.25) => {
      const d = b.clone().sub(a), len = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), truss);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
      s.add(m);
    };
    for (const y of [24.5, 25.5]) bar(V3(-36, y, 6), V3(36, y, 6));
    for (const y of [27.5, 28.5]) bar(V3(-30, y, -8), V3(30, y, -8));
    for (const y of [30.5, 31.5]) bar(V3(-40, y, -2), V3(40, y, -2));
    for (const side of [-1, 1]) {
      bar(V3(side * 36, 0, 6), V3(side * 36, 25.5, 6), 0.3);
      bar(V3(side * 46, 0, 0), V3(side * 46, 32, 0), 0.35);
      bar(V3(side * 36, 25, 6), V3(side * 30, 28, -8));
      bar(V3(side * 40, 31, -2), V3(side * 46, 32, 0));
    }

    // pixel architecture
    this.pixels = new PixelStrips();
    this.rigStrips = [];
    const strip = (name, pts, size, zone, band = -1) => { const st = this.pixels.addStrip(name, pts, size, { zone, band }); this.rigStrips.push(st); return st; };
    const arc = (r, n, size) => { const pts = []; for (let i = 0; i <= n; i++) { const a = Math.PI * (i / n); pts.push(V3(Math.cos(a) * r, 2 + Math.sin(a) * r, -11.5)); } return strip('arch' + r, pts, size, ZONE.arch); };
    arc(33.5, 300, 0.45); arc(30, 280, 0.42); arc(26.5, 240, 0.32);
    for (const y of [24.5, 25.5]) strip('front' + y, pathLine(V3(-36, y, 6.35), V3(36, y, 6.35), 145), 0.28, ZONE.truss);
    for (const y of [27.5, 28.5]) strip('back' + y, pathLine(V3(-30, y, -7.65), V3(30, y, -7.65), 121), 0.28, ZONE.truss);
    strip('roof', pathLine(V3(-40, 31, -1.65), V3(40, 31, -1.65), 161), 0.28, ZONE.truss);
    for (const side of [-1, 1]) {
      for (const ox of [-0.6, 0.6]) for (const oz of [-0.6, 0.6]) strip('tower', pathLine(V3(side * 46 + ox, 0.5, oz), V3(side * 46 + ox, 30, oz), 60), 0.3, ZONE.tower, side < 0 ? 0 : 7);
      for (const ox of [-0.5, 0.5]) strip('col', pathLine(V3(side * 36 + ox, 0.5, 6.4), V3(side * 36 + ox, 24.5, 6.4), 50), 0.28, ZONE.col, side < 0 ? 1 : 6);
      strip('deckside', pathLine(V3(side * 28.1, 2.25, -11), V3(side * 28.1, 2.25, 5), 33), 0.3, ZONE.deck);
      strip('wingEdge', pathLine(V3(side * 26, 3, -7), V3(side * 34, 21, -7), 41), 0.25, ZONE.frame, side < 0 ? 2 : 5);
    }
    strip('deckfront', pathLine(V3(-27.5, 2.25, 5.1), V3(27.5, 2.25, 5.1), 111), 0.3, ZONE.deck);
    strip('riser', pathLine(V3(-7, 3.45, 1.1), V3(7, 3.45, 1.1), 31), 0.22, ZONE.riser);
    // panel frames (rotated with their walls)
    const frame = (cx, cy, cz, w, h, ry, per, size, zone, band) => {
      const pts = pathRect(V3(0, 0, 0), w, h, per).map(p => { const x = p.x, z = 0.3; return V3(cx + x * Math.cos(ry) + z * Math.sin(ry), cy + p.y, cz - x * Math.sin(ry) + z * Math.cos(ry)); });
      return strip('frame', pts, size, zone, band);
    };
    frame(0, 13.5, -10.5, 45.2, 23.2, 0, 40, 0.3, ZONE.frame, 3);
    for (const side of [-1, 1]) {
      frame(side * 31, 12, -7, 13.2, 19.2, -side * 0.42, 24, 0.26, ZONE.frame, side < 0 ? 2 : 5);
      frame(side * 41, 14, -1, 5.2, 25.2, -side * 0.25, 14, 0.24, ZONE.frame, side < 0 ? 1 : 6);
    }
    // hanging drips under the back truss
    for (let i = 0; i < 15; i++) { const x = -28 + i * 4; strip('drip', pathLine(V3(x, 27, -7.9), V3(x, 20, -7.9), 12), 0.26, ZONE.drop, i % 8); }
    // runway + barrier lines into the crowd
    for (const x of [-8, 8]) strip('runway', pathLine(V3(x, 0.3, 8), V3(x, 0.3, 60), 53), 0.34, ZONE.runway);
    strip('barrier', pathLine(V3(-40, 0.3, 11), V3(40, 0.3, 11), 81), 0.3, ZONE.runway);
    // stage floor lines
    for (const z of [-9, -6, -3, 0, 3]) strip('floor', pathLine(V3(-27, 2.25, z), V3(27, 2.25, z), 55), 0.22, ZONE.floor);
    s.add(this.pixels.build());
    // per-pixel coordinates for the pattern functions
    let maxD = 0.001;
    for (const st of this.rigStrips) for (const p of st.points) maxD = Math.max(maxD, Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y));
    this.rigStrips.forEach((st, idx) => {
      st.idx = idx; st.zone = st.meta.zone; st.band = st.meta.band >= 0 ? st.meta.band : idx & 7;
      st.d = new Float32Array(st.count); st.ang = new Float32Array(st.count); st.h = new Float32Array(st.count); st.xn = new Float32Array(st.count); st.zn = new Float32Array(st.count);
      st.points.forEach((p, i) => {
        st.d[i] = Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y) / maxD;
        st.ang[i] = frac(Math.atan2(p.y - ORIGIN.y, p.x - ORIGIN.x) / (Math.PI * 2));
        st.h[i] = clamp(p.y / 32, 0, 1);
        st.xn[i] = clamp(p.x / 48, -1, 1);
        st.zn[i] = clamp((p.z + 12) / 72, 0, 1);
      });
    });
  }

  // ------------------------------------------------------------ lighting rig
  // ---- festival grounds: landscape, rides, towers, wristbands, festoons, gate, dressing
  _buildFestival() {
    this.fest = new Festival(this.big, this.crowd, this.mainPanel.mat);
    // IMAG: the live DJ feed a festival's side screens carry. A second camera in the booth renders the act, the console,
    // the riser and the walls behind them (layer 1 only: no crowd, no field, no beams, no lasers) into a small portrait
    // target every other frame; while the wings run the 'imag' program their LED shader samples that target instead of
    // their canvas. The target is twice the wing's cell grid so each LED averages a 2x2 block of the feed.
    this.imag = { rt: new THREE.WebGLRenderTarget(96, 144, { depthBuffer: true, stencilBuffer: false }), cam: new THREE.PerspectiveCamera(26, 96 / 144, 0.5, 260 * WORLD_SCALE),
      on: false, preset: -1, sinceBar: 0, untilBar: -1, last: -30, frame: 0, frames: 0, t0: 0, eye: new THREE.Vector3(), look: new THREE.Vector3() };
    this.imag.rt.texture.minFilter = THREE.LinearFilter; this.imag.rt.texture.magFilter = THREE.LinearFilter; this.imag.rt.texture.generateMipmaps = false;
    this.imag.cam.layers.set(IMAG_LAYER);
    this._imagLayer();
  }

  _buildRig() {
    const s = this.big;
    // moving heads
    const H = this.heads = new BeamArray();
    const zoneCounts = {};
    const head = (x, y, z, zone, groupB = false) => { const k = zoneCounts[zone] = (zoneCounts[zone] || 0) + 1; H.add(V3(x, y, z), { zone, k: k - 1, u: 0, side: Math.sign(x), groupB }); };
    // Rig size: a third fewer heads than the first cut - the beams should frame the stage, not replace it.
    for (const y of [24, 26]) for (let i = 0; i < 20; i++) head(-35.15 + i * 3.7, y, 6.3, 0);
    for (const y of [27, 29]) for (let i = 0; i < 16; i++) head(-28.5 + i * 3.8, y, -7.7, 1);
    for (const y of [30.5, 31.5]) for (let i = 0; i < 17; i++) head(-38.4 + i * 4.8, y, -1.7, 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) head(side * 46.6, 4 + i * 2.9, 0.8, 3, true);
      for (let i = 0; i < 6; i++) head(side * 36.6, 4 + i * 4, 6.7, 4, true);
      for (let i = 0; i < 4; i++) { const x = side * (26 + i * 10 / 3); head(x, 3.4, -6.4, 7, true); head(x, 21.6, -6.4, 7, true); }
      for (let i = 0; i < 4; i++) { const f = i / 3; head(side * (36 - 6 * f), 25 + 3 * f, 6 - 14 * f, 9); }
    }
    for (let i = 0; i < 18; i++) head(-25.5 + i * 3, 2.4, -9.2, 5, true);
    for (let i = 0; i < 13; i++) head(-27 + i * 4.5, 2.4, 5.6, 6, true);
    for (let i = 0; i < 16; i++) { const a = 0.1 + (Math.PI - 0.2) * i / 15; head(Math.cos(a) * 32.5, 2 + Math.sin(a) * 32.5, -11.5, 8); }
    s.add(H.build());
    this.headMeta = H.meta;
    for (const m of this.headMeta) m.u = zoneCounts[m.zone] > 1 ? m.k / (zoneCounts[m.zone] - 1) : 0.5;
    for (let i = 0; i < H.n; i++) { const z = this.headMeta[i].zone; H.len[i] = z === 5 || z === 6 ? 1.15 : 1; }
    this.seedA = new Float32Array(H.n); this.seedB = new Float32Array(H.n); this.seedR = new Float32Array(H.n);

    // strobes + blinders
    const S = this.strobes = new StrobeArray();
    const st = (x, y, z, zone, k, o = {}) => S.add(V3(x, y, z), o.w ?? 1.6, o.h ?? 0.7, !!o.warm, o.rot || null, { zone, k, u: o.u ?? 0.5, side: Math.sign(x) });
    for (let i = 0; i < 35; i++) st(-34 + i * 2, 23.2, 6.6, 'front', i, { u: i / 34 });
    for (let i = 0; i < 29; i++) st(-28 + i * 2, 29.8, -7.6, 'back', i, { u: i / 28 });
    for (let i = 0; i < 20; i++) st(-38 + i * 4, 32.2, -1.6, 'back', i + 29, { u: i / 19 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 13; i++) st(side * 46.6, 5 + i * 2, 1, 'tower', i, { u: i / 12, rot: new THREE.Euler(0, -side * 0.4, 0) });
      for (const x of [30, 34]) for (const y of [5, 20]) st(side * x, y, -6.3, 'blinder', 0, { w: 2, h: 1.2, warm: true });
      for (const x of [20, 38]) st(side * x, 3.6, 5.2, 'blinder', 0, { w: 2, h: 1.2, warm: true });
    }
    for (const x of [-25, -15, -5, 5, 15, 25]) st(x, 22.2, 6.5, 'blinder', 0, { w: 2.4, h: 1.4, warm: true });
    for (let i = 0; i < 37; i++) st(-27 + i * 1.5, 2.9, 5.25, 'deck', i, { w: 0.9, h: 0.35, u: i / 36 });
    s.add(S.build());

    // lasers
    const L = this.lasers = new LaserBank();
    let li = 0;
    // grp = duty-cycle group (see _driveLasers): only a rotating subset of groups fires at once so single fans stay readable.
    // Within a group the projectors are driven as one symmetric look: u runs 0 (centre line) to 1 (outer end) on both
    // sides, the seed is a phase that progresses along the truss, and key pairs the mirrored projectors for the random
    // picks - so a truss throws a wave of fans rather than a web of independently aimed lines.
    const laser = (x, y, z, beams, o, grp) => { L.add(V3(x, y, z), beams, Object.assign({ meta: { u: 0, grp, side: Math.sign(x) || (li & 1 ? 1 : -1), seed: 0, key: grp * 100 + Math.round(Math.abs(x)) } }, o)); li++; };
    // 16 projectors (half of the 31 of the previous cut, a third of the first) throwing 4-6 beams each (~80 beams, a
    // third of the previous cut): the fans read as a few big shapes over the stage, never a web, and the stage stays
    // visible through a drop.
    for (let i = 0; i < 4; i++) laser(-24 + i * 16, 28.6, -7.5, 5, { pitch: -0.05 }, 0);
    for (let i = 0; i < 3; i++) laser(-25.2 + i * 25.2, 26.2, 6.4, 5, { pitch: -0.08 }, 1);
    for (const side of [-1, 1]) {
      laser(side * 46.6, 17, 1, 5, { yaw: -side * 0.4 }, 2);
      laser(side * 32, 22, -6.3, 4, { yaw: -side * 0.2, pitch: 0.05 }, 3);
    }
    for (const x of [-12, 12]) laser(x, 2.6, -9.5, 5, { pitch: 0.35 }, 4);
    for (let i = 0; i < 3; i++) { const a = 0.25 + (Math.PI - 0.5) * i / 2; laser(Math.cos(a) * 31.5, 2 + Math.sin(a) * 31.5, -11.3, 6, { mode: 'cone', pitch: 0.1, spread: 0.5 }, 5); }
    const reach = {};
    for (const src of L.sources) reach[src.meta.grp] = Math.max(reach[src.meta.grp] || 0, Math.abs(src.pos.x));
    for (const src of L.sources) { const m = src.meta; m.u = reach[m.grp] > 0 ? Math.abs(src.pos.x) / reach[m.grp] : 0.5; m.seed = hash(m.grp * 77 + 5) * 6.283 + m.u * 1.4; }
    s.add(L.build());
  }

  _buildPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.12, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new IrisPass(this));
    this.composer.addPass(new OutputPass());
    const rt = new THREE.WebGLRenderTarget(IRIS_W, IRIS_H, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const mat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uCell: { value: new THREE.Vector2(1 / IRIS_W, 1 / IRIS_H) } }, vertexShader: IRIS_VS, fragmentShader: IRIS_FS, depthTest: false, depthWrite: false });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    this.iris = { rt, mat, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), buf: new Uint8Array(IRIS_W * IRIS_H * 4), cells: new Float32Array(IRIS_W * IRIS_H), load: 0, top: 0, blown: 0, blownTop: 0, expo: EXPO_BASE, frame: 0, busy: false, off: false, snapIn: 0 };
  }

  // ------------------------------------------------------------ artist / song
  setProfile(profile) {
    this.profile = profile; this.style = profile.style || {};
    if (this.djs) { this.djs.setAct(profile, this.track); this._imagLayerDjs(); }
    const rng = this.rng = new SongRng((profile.seed ^ Math.imul((profile.variant | 0) + 1, 0x9E3779B1)) >>> 0);
    const hardish = profile.genre === 'techno' || profile.genre === 'trance' || profile.genre === 'hardstyle' || profile.genre === 'hardtechno' || profile.genre === 'psytrance';
    this.song = {
      colorMode: rng.pick(['alt', 'zone', 'half', 'chase']),
      splitZones: rng.chance(0.55),
      laserClassic: rng.chance(hardish ? 0.5 : 0.2),
      grooveLasers: rng.chance(0.35 * (this.style.lasers ?? 0.6)),
      breakLasers: (this.style.lasers ?? 0.6) > 0.6 && rng.chance(0.4),
      wingsFollow: rng.chance(0.5),
      chaseDiv: rng.pick([2, 3, 4]),
      cutEvery: rng.pick([4, 4, 8]),
      laserRank: rng.shuffle([0, 1, 2, 3, 4, 5]), laserRot: rng.int(LASER_GROUPS),
      headSets: {},
    };
    for (const k in HEAD_SETS) this.song.headSets[k] = rng.shuffle(HEAD_SETS[k]);
    this.patPtr = {};
    this.shotOrder = rng.shuffle(ALL_SHOTS); this.shotPtr = 0;
    for (let i = 0; i < this.heads.n; i++) { this.seedA[i] = rng.range(0, 6.283); this.seedB[i] = rng.range(0, 6.283); this.seedR[i] = rng.next(); }
    const key = profile.centre + '|' + profile.id;
    if (key !== this.centreKey) {
      if (this.centre) this.centre.dispose();
      this.centre = new Centrepiece(profile.centre, this.style, rng);
      this.big.add(this.centre.group);
      this.centreKey = key;
    }
    this.allPanels = this.panels.concat(this.centre.panels);
    this.centreCtx.rng = rng; this.centreCtx.strobes = this.style.strobes ?? 0.8;
    this.o.profile = profile; this.o.variant = profile.variant | 0; this.o.white = this.style.white ?? 0.5;
    this.o.logoImg = null; this.o.logoOverlay = 0; this.logo.overlayUntil = 0; this.logo.image = false;
    this.logo.mirror = rng.chance(0.6);
    this.pickPattern(true);
    this.pickProgram(true);
  }

  setTrack(track) {
    const changed = !this.track || this.track.id !== track.id;
    this.track = track; this.o.track = track;
    if (this.djs) { this.djs.setAct(this.profile, track); this._imagLayerDjs(); }
    if (changed && track.state !== 'stopped' && track.name) {
      const t = this.t, r = this.rng;
      this.textUntil = t + 5;
      for (const p of this.panels) if (p.role === 'main' || p.role === 'booth' || p.role === 'ribbon') { p.program = 'text'; p.programSince = t; }
      // title first, then the artist mark — the way the big walls introduce a set
      this.logo.at = this.textUntil;
      this.logo.len = r.range(5.5, 7.5);
      this.logo.mode = r.pick(['wipe', 'scan', 'scale', 'build']);
      this.logo.on = false; this.logo.until = 0;
    }
  }

  // ------------------------------------------------------------ logos
  /** the artist's real logo (logos.js entry) once it has been fetched; null = procedural mark only */
  setLogoImage(entry) {
    this.o.logoImg = entry || null;
    if (!entry) { this.o.logoOverlay = 0; this.logo.overlayUntil = 0; this.logo.image = false; }
  }
  showLogo(len = 6, mode = null, glitch = 0.5) {
    const t = this.t, L = this.logo;
    L.on = true; L.since = t; L.until = t + len; L.last = t; L.g0 = glitch;
    L.image = !!this.o.logoImg && this.rng.chance(0.85);
    L.overlayUntil = 0;
    L.mode = mode || this.rng.pick(['wipe', 'scan', 'scale', 'flicker', 'build']);
    for (const p of this.allPanels) {
      const r = p.role;
      if (r === 'main' || r === 'holo' || (L.mirror && (r === 'wing' || r === 'top'))) { p.program = 'logo'; p.programSince = t; }
    }
  }
  triggerLogo() { this.logo.at = -1; this.showLogo(6, null, 0.6); }

  _updateLogo(show) {
    const L = this.logo, t = this.t, o = this.o.logo;
    if (L.at >= 0 && t >= L.at) { L.at = -1; this.showLogo(L.len || 6, L.mode, 0.5); }
    if (L.on) {
      if (t >= L.until) {
        L.on = false;
        this.pickProgram(true, null, true);
      } else {
        const age = t - L.since, left = L.until - t;
        o.reveal = clamp(Math.min(age / 1.2, left / 0.7), 0, 1);
        o.mode = L.mode; o.image = L.image;
        o.glitch = Math.max(0, 1 - age / 1.2) * L.g0 + (show.phase === 'drop' ? show.kick * 0.35 : 0);
      }
    }
    // floating-logo window over content programs
    const target = !L.on && this.o.logoImg && t < L.overlayUntil ? 1 : 0;
    this.o.logoOverlay += (target - this.o.logoOverlay) * Math.min(1, (show.dt || 0.016) * (target ? 1.5 : 3));
    if (this.o.logoOverlay < 0.01) this.o.logoOverlay = 0;
  }

  // ------------------------------------------------------------ cues
  _bindCues() {
    const d = this.director;
    d.on('drop', () => {
      const sh = d.show;
      this.dropBar = sh.barIndex;
      this.pickPattern(true);
      this.pickProgram(true);
      const accent = this.rng.pick(['flash', 'strobeBars', 'rays']);
      for (const p of this.panels) if (p.role === 'wing' || p.role === 'tower' || p.role === 'booth') { p.program = accent; p.programSince = this.t; }
      this.cutCamera('drop');
      this._dropFx(false);
    });
    d.on('pyro', () => this._dropFx(true));
    d.on('bar', (bar) => {
      const sh = d.show, ph = sh.phase, s = this.style, pal = sh.palette;
      // Peak-phase pyro stays at deck level (cold sparks every 4 bars): the air over the stage is clear between drops.
      if (ph === 'peak' && sh.active && bar % 4 === 0 && (s.pyro ?? 0.6) > 0.5) this.fx.sparkUntil = this.t + 1.6;
      // Fireworks over the set through the drop and the peak: a shell or two mid-phrase, a small salvo every 16 bars,
      // and a finale through the last half minute of the track (Spotify's playback position tells us where the end is).
      if ((ph === 'drop' || ph === 'peak') && sh.active && (s.pyro ?? 0.6) > 0.3) {
        const since = bar - this.dropBar, dur = this.track?.duration || 0, finale = dur > 90 && sh.trackPos > dur - 30;
        if (finale) { if (bar % 2 === 0) this.fw.salvo(pal, bar % 4 === 0 ? 5 : 3, { wide: 1.15, high: 4 }); }
        else if (since > 0 && since % 8 === 4) this.fw.salvo(pal, since % 16 === 12 ? 3 : this.rng.chance(0.5) ? 2 : 1);
      }
      this._imagBar(bar, ph, sh);
      if (ph === 'drop' && bar - this.dropBar === 2) this.pickProgram(true, ['wing', 'tower', 'booth', 'top', 'side']);
      if (bar % 4 === 0) this.pickPattern(false);
      if (bar % 8 === 0 && this.t - this.lastProgPick > 12) this.pickProgram(false);
      const every = HI.has(ph) ? this.song.cutEvery : 8;
      if (this.autoCam && bar - this.shotStartBar >= every) this.cutCamera();
    });
    d.on('phrase', () => {
      const sh = d.show;
      this.pickProgram(false);
      const rate = this.style.logoRate ?? 0.7;
      if (!this.logo.on && this.t - this.logo.last > 40 && sh.active && (sh.phase === 'breakdown' || sh.phase === 'peak') && this.rng.chance(rate * 0.45)) this.showLogo(sh.phase === 'peak' ? 4 : 7, null, 0.4);
      else if (!this.logo.on && this.o.logoImg && sh.active && this.t >= this.logo.overlayUntil && (sh.phase === 'breakdown' || sh.phase === 'peak' || sh.phase === 'drop') && this.rng.chance(rate * 0.4)) this.logo.overlayUntil = this.t + this.rng.range(7, 14);
    });
    d.on('phase', (p) => {
      this.pickPattern(true);
      this.pickProgram(true);
      if (p === 'build' || p === 'breakdown' || p === 'peak') this.cutCamera(p);
    });
  }

  // Deck pyro is short and anchored to the deck or the roof corners (CO2, flames, cold sparks on the drop), and the
  // fireworks are fired from behind the set to burst over the roof line: no confetti, water curtains or haze sprites,
  // nothing hangs in the air between the camera and the stage, so the set, the screens and the centrepiece stay visible.
  _dropFx(confirmed) {
    const s = this.style, sh = this.director.show, pal = sh.palette, t = this.t, pyro = s.pyro ?? 0.6;
    if (!confirmed) {
      if (pyro > 0.2) for (const x of [-24, -12, 12, 24]) this.particles.co2(x, 4.5, 1, pal[0]);
      if (pyro > 0.4) this.fx.flameUntil = t + 1.0 + pyro;
      if (pyro > 0.25) this.fw.salvo(pal, sh.dropCount >= 2 ? 6 : 4, { stagger: 0.3 });   // the drop hit: a salvo over the set, bigger on later drops
      return;
    }
    if (pyro > 0.6) this.fx.sparkUntil = t + 3;
    if (pyro > 0.45) this.fw.salvo(pal, 3, { stagger: 0.45, high: 6 });   // confirmed drop: a second wave, higher
    if (!this.logo.on && t - this.logo.last > 25 && this.rng.chance((s.logoRate ?? 0.7) * 0.5)) this.showLogo(Math.max(3, (sh.period || 0.5) * 8), this.rng.pick(['flicker', 'scale']), 0.7);
  }

  triggerPyro() {
    const pal = this.director.show.palette, t = this.t;
    for (const x of [-24, -12, 12, 24]) this.particles.co2(x, 4.5, 1, pal[0]);
    this.fx.flameUntil = t + 1.6; this.fx.sparkUntil = t + 3;
    this.fw.salvo(pal, 5, { stagger: 0.3 });
  }

  // ------------------------------------------------------------ patterns / programs
  pickPattern(force) {
    const ph = this.director.show.phase, sets = this.song.headSets, set = sets[ph] || sets.groove, rng = this.rng;
    const idx = this.patPtr[ph] = ((this.patPtr[ph] ?? -1) + 1) % set.length;
    this.pattern = set[idx];
    this.patternB = (HI.has(ph) || ph === 'groove') && this.song.splitZones && set.length > 1 ? set[(idx + 1 + rng.int(set.length - 1)) % set.length] : this.pattern;
    this.patternSince = this.t;
    const ls = LASER_SETS[ph]; this.laserPat = ls ? rng.pick(ls) : 'fan';
    const rs = RIG_SETS[ph] || RIG_SETS.groove;
    let rp = rng.pick(rs); if (rs.length > 1 && rp === this.rigPat) rp = rs[(rs.indexOf(rp) + 1) % rs.length];
    this.rigPat = rp; this.rigDir = rng.chance(0.5) ? 1 : -1; this.rigRep = rng.pick([2, 3, 4, 6]);
  }

  _pool(panel) {
    const r = panel.role;
    if (r === 'booth') return BOOTH_POOL;
    if (r === 'ribbon') return RIBBON_POOL;
    if (r === 'holo') return HOLO_POOL;
    return this.profile.programs || PROGRAM_NAMES;
  }
  _choose(pool, ph, prev) {
    const target = PANEL_ENERGY[ph] ?? 0.5;
    let entries = [];
    const collect = (names, tol, wt = 1) => { for (const n of names) { if (!PROGRAMS[n] || n === 'logo' || n === 'text') continue; if (PROGRAM_INFO[n]?.needsLogo && !this.o.logoImg) continue; const e = PROGRAM_INFO[n]?.energy ?? 0.5, d = Math.abs(e - target); if (d < tol) entries.push([n, (tol + 0.02 - d) * (n === prev ? 0.2 : 1) * wt]); } };
    collect(pool, 0.32);
    if (this.o.logoImg && ph !== 'intro' && ph !== 'idle') collect(['logoTile', 'logoBurst'], 0.32, 0.7 * (this.style.logoRate ?? 0.7) + 0.2);
    if (entries.length < 2) collect(PROGRAM_NAMES, 0.25);
    if (!entries.length) return 'wash';
    return this.rng.weighted(entries);
  }
  pickProgram(force, roles = null, logoOnly = false) {
    const ph = this.director.show.phase, t = this.t;
    this.lastProgPick = t;
    let mainProg = null;
    for (const p of this.allPanels) {
      if (roles && !roles.includes(p.role)) continue;
      if (logoOnly && p.program !== 'logo') continue;
      if (p.program === 'text' && t < this.textUntil) continue;
      if (p.program === 'logo' && this.logo.on) continue;
      if (p.program === 'imag' && !this.imag.ending) continue;
      let next;
      if (p.role === 'wing' && this.song.wingsFollow && mainProg) next = mainProg;
      else next = this._choose(this._pool(p), ph, force ? null : p.program);
      if (p.role === 'main') mainProg = next;
      if (next !== p.program || force) { p.program = next; p.programSince = t; }
    }
  }

  // ------------------------------------------------------------ IMAG (live DJ feed on the wings)
  // the objects the IMAG camera sees (layer 1): the act, the console, the riser, the walls behind the booth, the pixel
  // architecture and the set's own lights — nothing of the field
  _imagLayer() {
    const on = (o) => o && o.traverse(c => c.layers.enable(IMAG_LAYER));
    this._imagLayerDjs();
    for (const m of this.riser) on(m);
    for (const m of this.fest.dress.booth) on(m);
    for (const p of this.panels) if (p.role === 'main' || p.role === 'booth' || p.role === 'ribbon') on(p.mesh);
    on(this.pixels.mesh);
    for (const l of [this.ambLight, this.hemiLight, this.stageLight, this.boothLight]) l.layers.enable(IMAG_LAYER);
  }
  _imagLayerDjs() { this.djs.group.traverse(c => c.layers.enable(IMAG_LAYER)); }
  // the side screens cut to the DJ feed the way a festival's vision mixer does: a phrase at a time, more often in the
  // groove, the build and the breakdown (the crowd watches the DJ work), a short cut a couple of bars into a drop,
  // never over a logo or a text card, with a new angle every 4 bars
  _imagBar(bar, ph, sh) {
    const I = this.imag, wings = this.panels.filter(p => p.role === 'wing');
    if (!wings.length) return;
    if (wings.some(p => p.program === 'imag')) {
      if (bar >= I.untilBar || !sh.active) this._imagStop();
      else if ((bar - I.sinceBar) % 4 === 0) this._imagCut();
      return;
    }
    if (!sh.active || this.logo.on || bar % 4 !== 0 || this.t - I.last < 10) return;
    if (wings.some(p => p.program === 'text' || p.program === 'logo')) return;
    const p = ph === 'drop' ? (sh.phaseBars >= 2 ? 0.3 : 0) : ph === 'peak' ? 0.4 : ph === 'build' ? 0.5 : ph === 'breakdown' ? 0.55 : ph === 'groove' ? 0.55 : ph === 'intro' ? 0.35 : 0;
    if (!this.rng.chance(p)) return;
    this._imagStart(bar, ph === 'drop' ? 4 : 8);
  }
  _imagStart(bar, bars) {
    const I = this.imag;
    for (const w of this.panels) if (w.role === 'wing') { w.program = 'imag'; w.programSince = this.t; }
    I.sinceBar = bar; I.untilBar = bar + bars; this._imagCut();
  }
  _imagStop() {
    const I = this.imag;
    I.ending = true; this.pickProgram(true, ['wing']); I.ending = false;
    I.last = this.t; I.untilBar = -1;
  }
  _imagCut() { const I = this.imag; I.preset = (I.preset + 1 + this.rng.int(IMAG_PRESETS.length - 1)) % IMAG_PRESETS.length; I.t0 = this.t; }
  // key I: put the feed up now for 8 bars
  triggerImag() { const bar = this.director.show.barIndex | 0; if (this.panels.some(p => p.role === 'wing' && p.program === 'imag')) this._imagCut(); else this._imagStart(bar, 8); }
  _updateImag(show) {
    const I = this.imag;
    I.on = this.panels.some(p => p.role === 'wing' && p.program === 'imag');
    if (!I.on) return;
    const P = IMAG_PRESETS[Math.max(0, I.preset)], t = this.t - I.t0, back = 1 + 0.22 * (this.djs.count - 1);
    // a slow push over the first 8 s, a handheld sway, a duo / trio framed from further back, the kick nudging the zoom
    const e = I.eye.set(P.eye[0], P.eye[1], P.eye[2]), l = I.look.set(P.look[0], P.look[1], P.look[2]);
    e.sub(l).multiplyScalar(back * (1 - 0.06 * Math.min(1, t / 8))).add(l);
    e.x += Math.sin(t * 0.7) * 0.05; e.y += Math.sin(t * 0.9 + 1) * 0.03; l.x += Math.sin(t * 0.5 + 2) * 0.03;
    I.cam.position.copy(e).multiplyScalar(WORLD_SCALE); I.cam.lookAt(l.multiplyScalar(WORLD_SCALE));
    I.cam.fov = (P.fov || 26) * (1 - 0.03 * (show.kick || 0)); I.cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ camera
  cutCamera(reason) {
    if (performance.now() < this.manualUntil) return;
    const sh = this.director.show, rng = this.rng;
    let next;
    if (reason === 'drop') next = rng.pick(DROP_SHOTS);
    else if (reason === 'build') next = rng.pick([5, 4, 0, 8, 7, 10]);
    else if (reason === 'breakdown') next = rng.pick([6, 7, 1, 2, 9, 10]);
    else if (reason === 'peak') next = rng.pick([0, 3, 6, 9, 8, 7, 10]);
    else next = this.shotOrder[this.shotPtr++ % this.shotOrder.length];
    if (next === this.shotIndex) next = (next + 1) % SHOTS;
    this.shotIndex = next; this.shotStartBar = sh.barIndex; this.shotTime = 0; this.iris.snapIn = 4;
  }
  cycleCamera() { this.manualUntil = 0; this.autoCam = true; this.cutCamera(); }
  setShot(i) { this.manualUntil = 0; this.autoCam = false; this.shotIndex = ((i % SHOTS) + SHOTS) % SHOTS; this.shotTime = 0; this.iris.snapIn = 4; this.shotStartBar = this.director.show.barIndex; }

  _updateCamera(dt, show) {
    if (performance.now() < this.manualUntil) { this.controls.update(); return; }
    this.shotTime += dt;
    const t = this.shotTime, T = Math.min(1, t / 14), v = this.tmpV, look = this.tmpV2.set(0, 13, -6);
    // Every shot stays on the stage. The paths are authored in site units (the set's own coordinates: 96 wide, 36 high,
    // front edge at z 2) and scaled to world units below, so they frame the set at any WORLD_SCALE; `eye` overrides the
    // camera height with a human head height in world units for the shots that stand at the front of the crowd.
    let eye = 0;
    switch (this.shotIndex) {
      case 0: v.set(Math.sin(t * 0.1) * 6, 18 - 3 * T, 70 - 16 * T); break;                                                    // wide front, slow push-in
      case 1: v.set(-30 + 12 * T, 0, 50 - 10 * T); look.set(3, 13, -6); eye = 3.2 + 0.1 * Math.sin(t * 1.7); break;             // front left, eye level
      case 2: v.set(30 - 12 * T, 0, 50 - 10 * T); look.set(-3, 13, -6); eye = 3.2 + 0.1 * Math.sin(t * 1.7); break;             // front right, eye level
      case 3: v.set(50 - 10 * T, 19 - 4 * T, 40 - 12 * T); look.set(0, 12, -6); break;                                           // side, high
      case 4: v.set(Math.sin(t * 0.3) * 3, 6 + T, 24 - 5 * T); look.set(0, 9, -9); break;                                        // close on the booth and the main screen
      case 5: v.set(0, 0, 56 - 10 * T); look.set(0, 26 - 8 * T, -10); eye = 4 + 6 * T; break;                                    // low front, tilting down from the rig
      case 6: { const a = Math.PI / 2 + Math.sin(t * 0.07); v.set(Math.cos(a) * 62, 22, 36 + Math.sin(a) * 34); look.set(0, 12, -6); break; }   // slow arc across the front
      case 7: v.set(-34 + 6 * T, 8 + 2 * T, 30 - 6 * T); look.set(4 - 4 * T, 13, -8); break;                                    // raking along the stage face
      case 8: v.set(Math.sin(t * 0.15) * 10, 42 - 6 * T, 34 - 8 * T); look.set(0, 8, -8); break;                                 // top-down over the roof
      case 9: v.set(Math.sin(t * 0.2) * 2, 14 - T, 30 - 14 * T); look.set(0, 13.5, -10); break;                                  // centrepiece push-in
      case 10: { const a = Math.sin(t * 0.12) * 0.9, r = 5.2 - 1.4 * T, cz = (DECK.Z0 + DECK.STAND_Z) * DECK.SCALE; v.set(Math.sin(a) * r, 7.1 + 0.25 * T, cz + Math.cos(a) * r); look.set(0, 6.75, cz); break; }   // booth close-up: the DJs at work, orbiting slowly in front of the players
      default: v.set(0, 18, 70);
    }
    v.multiplyScalar(WORLD_SCALE); look.multiplyScalar(WORLD_SCALE);
    if (eye) v.y = eye;
    v.y += show.kick * (show.phase === 'drop' ? 0.35 : show.phase === 'peak' ? 0.15 : 0.04) * (this.shotIndex === 10 ? 0.4 : 1);   // the close-up gets a gentler kick bounce
    const k = 1 - Math.exp(-dt * (t < 0.05 ? 100 : 2.5));
    this.camera.position.lerp(v, k);
    this.controls.target.lerp(look, k);
    this.controls.update();
  }

  // ------------------------------------------------------------ per-frame
  // ---- rig density (user control). 0.3..1.2; persisted. Scales beam gain, head output, strobe punch and laser groups.
  setDensity(v) {
    this.density = clamp(+v || 0.7, 0.3, 1.2);
    try { localStorage.setItem('vf.density', String(this.density)); } catch {}
    this.heads.setGain(BEAM_GAIN * (0.7 + 0.3 * this.density));
    if (this.fest) this.fest.setGain(0.7 + 0.3 * this.density);
    return this.density;
  }
  densityLabel() { const d = this.density; return d < 0.55 ? 'low' : d < 0.85 ? 'med' : d <= 1.02 ? 'high' : 'max'; }
  cycleDensity() { const i = DENSITY_PRESETS.findIndex(p => this.density < p[1] + 0.05); return this.setDensity(DENSITY_PRESETS[(i < 0 ? 0 : i + 1) % DENSITY_PRESETS.length][1]); }

  update(show, dt) {
    this.t = show.t;
    const col = colorsFrom(show, this.col);
    if (show.beat && show.kickOn) this.laserTick++;
    this._levels(show);
    this._updateLogo(show);
    this._updateHeads(show, dt);
    this._updateStrobes(show);
    this._updateLasers(show);
    this._updatePixels(show);
    this._updatePanels(show, col);
    if (this.centre) {
      const c = this.centreCtx; c.A = show.colorA; c.B = show.colorB; c.C = show.colorC; c.dt = dt;
      this.centre.update(show, c);
      if (this.centre.lasers) this._driveLasers(this.centre.lasers, show, 0.9);
    }
    this.crowd.update(show);
    this.fest.update(show, dt, this.levels);
    this.djs.update(show, dt);
    this._updateFx(show, dt);
    this._updateCamera(dt, show);
    this._updateImag(show);
    this._updateWorld(show, dt);
  }

  _levels(show) {
    const spec = show.spectrum; if (!spec) return;
    for (let b = 0; b < 8; b++) {
      let m = 0; const [a, e] = BAND_BINS[b];
      for (let k = a; k < e && k < spec.length; k++) if (spec[k] > m) m = spec[k];
      const v = clamp((m / 255 - 0.25) * 1.6, 0, 1);
      this.levels[b] += (v - this.levels[b]) * (v > this.levels[b] ? 0.65 : 0.12);
    }
  }

  _updateHeads(show, dt) {
    const H = this.heads, n = H.n, t = show.t, ph = show.phase, s = this.style, P = H.pos, G = H.goal, M = this.headMeta;
    const bp = clamp(show.beatPhase, 0, 1), kick = show.kick, dip = show.dip || 0, dens = this.density;
    const base = (HEAD_BASE[ph] ?? 0.4) * (HI.has(ph) ? 1 : 1 - 0.5 * (s.dark ?? 0.35));
    const pulseAmt = HI.has(ph) ? 0.55 : ph === 'groove' ? 0.35 : 0.15;
    const buildBoost = ph === 'build' ? show.buildProgress * 0.45 : 0;
    const speed = HI.has(ph) ? 5 : ph === 'build' ? 3 : 1.6;
    if (show.beat && show.kickOn && (ph === 'drop' || (ph === 'peak' && (show.beatIndex & 1) === 0))) this.chaosTick++;
    const chaosSeed = this.chaosTick * 7919 + (this.profile.variant | 0);
    const act = (show.active || ph === 'idle') ? 1 : 0;
    const A = show.colorA, B = show.colorB, mode = this.song.colorMode, div = this.song.chaseDiv;
    const swap = (show.barIndex + (ph === 'peak' && (show.beatIndex & 1) === 0 ? 1 : 0)) & 1;
    const sA = this.seedA, sB = this.seedB, sR = this.seedR;
    const ax = Math.sin(t * 0.5) * 20, ay = 18 + 10 * Math.sin(t * 0.4), az = 45 + Math.sin(t * 0.35) * 15;
    const cpx = Math.sin(t * 0.6) * 35, cpz = 30 + 25 * (0.5 + 0.5 * Math.sin(t * 0.45));
    const symSpread = 0.3 + 0.7 * (1 - bp);
    // output scale: artist taste x user density x pre-drop dip. In drop/peak one zone-group in three rests
    // (rotating every two bars) so the rig breathes instead of every head firing at once.
    const beams = (s.beams ?? 1) * (0.55 + 0.45 * dens) * (1 - 0.8 * dip);
    const duty = HI.has(ph) && dens < 0.95, dutyBar = show.barIndex >> 1;
    let load = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 3, px = P[o], py = P[o + 1], pz = P[o + 2], m = M[i], u = m.u, side = m.side, a = sA[i], b = sB[i], r = sR[i];
      const pat = m.groupB ? this.patternB : this.pattern;
      let gx, gy, gz;
      if (show.predrop) { gx = px * 0.3; gy = 70; gz = pz + 10; }
      else switch (pat) {
        case 'slowSweep': gx = Math.sin(t * 0.25 + a) * 40; gy = 6 + Math.sin(t * 0.2 + b) * 4; gz = 40 + Math.cos(t * 0.18 + a) * 20; break;
        case 'crowdSweep': gx = Math.sin(t * 0.9 + i * 0.5) * 45; gy = 2 + 6 * Math.abs(Math.sin(t * 0.5 + i)); gz = 30 + 30 * (0.5 + 0.5 * Math.sin(t * 0.6 + i * 0.7)); break;
        case 'fanUp': gx = px + (side || (u - 0.5) * 2) * (12 + 30 * Math.abs(u - 0.5)); gy = py + 45; gz = pz + 20 + 10 * Math.sin(t * 0.5); break;
        case 'cross': gx = -px * 1.4 + Math.sin(t * 1.2 + i) * 8; gy = 1 + 4 * Math.abs(Math.sin(t + i)); gz = 25 + 20 * (0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.4)); break;
        case 'wave': { const w = Math.sin(t * 2.2 - Math.abs(u - 0.5) * 6); gx = px * 1.2; gy = 10 + w * 14; gz = 35 + w * 20; break; }
        case 'stageWash': gx = px * 0.5 + Math.sin(t * 0.4 + a) * 6; gy = 2; gz = -3 + Math.sin(t * 0.3 + b) * 4; break;
        case 'converge': gx = ax; gy = ay; gz = az; break;
        case 'chaos': gx = (hash(i * 31 + chaosSeed) - 0.5) * 110; gy = hash(i * 57 + chaosSeed + 1) * 40; gz = 10 + hash(i * 91 + chaosSeed + 2) * 80; break;
        case 'symFan': gx = px * (1 + symSpread * 1.6); gy = 5 + 45 * symSpread; gz = pz + 30; break;
        case 'pyramid': gx = 0; gy = 50; gz = 20; break;
        case 'skySearch': gx = px + Math.sin(t * 0.3 + a) * 30; gy = 80; gz = pz + Math.cos(t * 0.27 + b) * 30; break;
        case 'crowdPoint': gx = cpx; gy = 1; gz = cpz; break;
        case 'kickFlick': if (((show.beatIndex + m.zone) & 1) === 0) { gx = px; gy = py + 40; gz = pz + 40; } else { gx = -px * 0.8; gy = 2; gz = 40; } break;
        case 'tiltWave': gx = px; gy = 25 + 20 * Math.sin(t * 2.5 - u * 9.4); gz = 40; break;
        case 'circles': gx = px + Math.cos(t * 1.5 + a) * 12; gy = 15; gz = 40 + Math.sin(t * 1.5 + a) * 12; break;
        case 'floorFan': gx = px * 2.5; gy = 55; gz = pz - 10 + 40 * Math.abs(u - 0.5); break;
        default: gx = px * 0.6; gy = 0; gz = 45;
      }
      G[o] = gx; G[o + 1] = gy; G[o + 2] = gz;
      H.speed[i] = show.predrop ? 8 : speed * (0.7 + 0.6 * r);
      const mask = ((i + show.beatIndex) & 1) === 0 ? 1 : 0.4;
      let inten = base + buildBoost + pulseAmt * kick * mask;
      if (ph === 'build') inten *= 0.6 + 0.4 * Math.sin(t * (3 + 12 * show.buildProgress) + i);
      else if (ph === 'breakdown') inten *= 0.6 + 0.4 * Math.sin(t * 0.7 + i * 0.6);
      else if (ph === 'idle') inten *= 0.5 + 0.5 * Math.sin(t * 0.4 + i * 0.5);
      if (show.predrop) inten = 0.9;
      inten += show.whiteout * 0.6;
      H.inten[i] = Math.min(1.1, inten) * beams * act * (duty && (m.zone + dutyBar) % 3 === 0 ? 0.35 : 1);
      load += H.inten[i];
      let g;
      switch (mode) { case 'zone': g = m.zone & 1; break; case 'half': g = side < 0 ? 0 : 1; break; case 'chase': g = (Math.floor(u * div) + show.barIndex) & 1; break; default: g = i & 1; }
      const c = this.tmpC.copy(((g + swap) & 1) === 0 ? A : B);
      if (ph === 'drop' && show.dropPulse > 0.5) c.lerp(WHITE, (show.dropPulse - 0.5) * 2);
      if (show.whiteout > 0) c.lerp(WHITE, show.whiteout);
      H.setColor(i, c);
    }
    this.headLoad = n ? load / n : 0;
    H.update(dt, t);
  }

  _updateStrobes(show) {
    const S = this.strobes, n = S.n, t = show.t, ph = show.phase, dip = show.dip || 0, wo = show.whiteout;
    const st = (this.style.strobes ?? 0.8) * (0.75 + 0.25 * this.density) * (1 - dip);
    const flick = frac(t * Math.max(1, show.strobeRate)) < 0.5 ? 1 : 0;
    const full = show.strobe >= 0.99 ? flick : 0;
    const buildF = ph === 'build' && show.buildProgress > 0.55 ? flick * (show.buildProgress - 0.55) / 0.45 : 0;
    const kick = show.kick, snare = show.snare, hi = HI.has(ph), bi = show.beatIndex | 0;
    const bl = ph === 'drop' && show.dropPulse > 0.55 ? (show.dropPulse - 0.55) * 2.2 : (ph === 'peak' && show.barIndex % 8 === 7 && show.beatInBar >= 2 ? 0.7 * kick : 0);
    const predropB = show.predrop ? 0.8 : 0;
    for (let i = 0; i < n; i++) {
      if (!show.active) { S.set(i, 0); continue; }
      const m = S.meta[i]; let lvl = 0;
      switch (m.zone) {
        case 'front': case 'back':
          lvl = Math.max(full, buildF * ((m.k + bi) & 1 ? 0.5 : 1));
          if (hi && show.strobe < 0.99) lvl = Math.max(lvl, (m.zone === 'front' ? kick : snare) * 0.8 * (((m.k + bi) & 1) ? 1 : 0.35));
          else if (ph === 'groove') lvl = Math.max(lvl, snare * 0.25 * ((m.k & 3) === (bi & 3) ? 1 : 0));
          break;
        case 'tower': lvl = Math.max(full, hi ? kick * 0.7 * ((m.k + show.barIndex) & 1 ? 1 : 0.3) : buildF); break;
        case 'deck': { const f = frac(m.u * 3 - t * 2); lvl = hi ? Math.max(full, kick * 0.9) : ph === 'groove' ? (f < 0.12 ? 0.35 : 0) : buildF; break; }
        case 'blinder': lvl = Math.max(bl, predropB); break;
      }
      S.set(i, Math.min(1, lvl * st + wo * 1.2 * (1 - dip)));
    }
    S.commit();
  }

  _updateLasers(show) { this._driveLasers(this.lasers, show, 1); }

  _driveLasers(bank, show, opMul) {
    const t = show.t, ph = show.phase, s = this.style, kick = show.kick, bp = clamp(show.beatPhase, 0, 1), pat = this.laserPat, lz = s.lasers ?? 0.6;
    const dip = show.dip || 0, dens = this.density, bar = show.barIndex | 0, dt = show.dt || 0.016;
    // Duty cycling: projectors are split into LASER_GROUPS groups and only a rotating window of them fires at once
    // (window size follows the density setting: one group at low / medium, two at the default, three at high), so single
    // fans and the stage behind them stay readable.
    const grpMax = dens < 0.85 ? 1 : dens <= 1.02 ? 2 : 3;
    const rank = this.song.laserRank, rot = this.song.laserRot | 0;
    let op = 0, win = -1, key = 0;   // win < 0 => all groups
    if (ph === 'drop') { if (show.phaseBars < 2) op = 0.5; else { op = 0.64; win = grpMax; key = (bar >> 1) + rot; } }
    else if (ph === 'peak') { op = 0.45 + 0.25 * show.beatPulse; win = grpMax; key = bar + rot; }
    else if (ph === 'build') { const p = show.buildProgress; op = Math.max(0, p - 0.45) * 0.9 + (show.predrop ? 0.35 : 0); win = 1 + Math.floor(p * grpMax); key = rot; }
    else if (ph === 'groove' && this.song.grooveLasers) { op = 0.16 + 0.22 * kick; win = 1; key = (bar >> 2) + rot; }
    else if (ph === 'breakdown' && this.song.breakLasers) { op = 0.14; win = 1; key = (bar >> 2) + rot; }
    op *= lz * opMul * Math.sqrt(dens) * (1 - dip);
    if (show.whiteout > 0.6 || lz < 0.12 || !show.active) op = 0;
    const tick = this.laserTick, rainbow = !!s.rainbowLasers, classic = this.song.laserClassic, c = this.tmpC2;
    const lzA = laserColor(_lzA, show.colorA, show.colorC, show.colorB), lzC = laserColor(_lzC, show.colorC, show.colorB, show.colorA);
    lzA.getHSL(_hsl, THREE.SRGBColorSpace); const hA = _hsl.h; lzC.getHSL(_hsl, THREE.SRGBColorSpace);
    const same = Math.abs(frac(hA - _hsl.h + 0.5) - 0.5) < 0.06;
    const srcs = bank.sources, n = srcs.length, ease = Math.min(1, dt * 14);
    // the camera in the bank's own space: a fan aimed into the lens is the one that hides the stage, so the opacity of
    // a projector is cut by up to 75% by how squarely it faces the camera (the way a laser op keeps fans off the cameras)
    const cam = bank.mesh.worldToLocal(_camL.copy(this.camera.position));
    for (let i = 0; i < n; i++) {
      const L = srcs[i], m = L.meta || (L.meta = {}), u = m.u ?? (n > 1 ? i / (n - 1) : 0.5), side = m.side ?? (u < 0.5 ? -1 : 1), sd = m.seed ?? i, key = m.key ?? i;
      if (m.yaw0 === undefined) { m.yaw0 = L.yaw; m.pitch0 = L.pitch; m.opS = 0; }
      const gOn = win < 0 || m.grp === undefined || ((rank[m.grp] + key) % LASER_GROUPS) < win;   // centre-piece lasers have no group: always in
      const base = m.yaw0, bpitch = m.pitch0;
      // Yaw offsets and rolls are mirrored by side, and the seed only shifts phase (never rate), so a truss keeps one
      // symmetric, coherent look over time.
      let yaw, pitch, spread, roll;
      switch (pat) {
        case 'scan': yaw = base + side * Math.sin(t * 1.3 + sd) * 0.9; pitch = bpitch - 0.28 + 0.08 * Math.sin(t * 0.7 + sd); spread = 0.12 + 0.1 * kick; roll = 0; break;
        case 'tunnel': yaw = base + side * (Math.sin(t * 0.3 + sd * 0.2) * 0.25 - 0.25); pitch = bpitch - 0.1 + 0.1 * Math.sin(t * 0.4); spread = 0.05 + 0.6 * (1 - bp); roll = side * (t * 1.5 + sd); break;
        case 'kick': { const h1 = hash(key * 17 + tick * 101), h2 = hash(key * 29 + tick * 101 + 7), h3 = hash(key * 43 + tick * 101 + 13); yaw = base + side * (h1 - 0.5) * 1.6; pitch = bpitch + (h2 - 0.5) * 0.5; spread = 0.3 + h3 * 0.6; roll = side * h1 * 3; break; }
        case 'sky': yaw = base + side * Math.sin(t * 0.35 + sd) * 0.6; pitch = 0.55 + 0.25 * Math.sin(t * 0.5 + sd); spread = 0.5 + 0.4 * Math.sin(t * 0.4 + sd + 2); roll = side * (t * 0.7 + sd); break;
        case 'cross': yaw = base + side * (Math.sin(t * 0.9 + sd) * 0.35 - 0.9); pitch = bpitch - 0.08 + 0.2 * Math.sin(t * 1.1 + sd + 4); spread = 0.25 + 0.4 * kick; roll = side * Math.sin(t * 0.5 + sd) * 0.6; break;
        case 'liquid': yaw = base + side * Math.sin(t * 0.4 + sd) * 0.5; pitch = bpitch + 0.15 + 0.2 * Math.sin(t * 0.6 + sd); spread = 0.1 + 0.9 * (0.5 + 0.5 * Math.sin(t * 0.8 + sd + 5)); roll = side * (t * 2.5 + sd); break;
        default: yaw = base + side * (0.35 + Math.sin(t * 0.7 + sd) * 0.5); pitch = bpitch - 0.05 + 0.22 * Math.sin(t * 0.9 + sd + 6); spread = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.5 + sd + 8)) + 0.5 * kick; roll = side * Math.sin(t * 0.4 + sd + 6) * 0.9;
      }
      if (L.mode === 'cone') spread = Math.min(spread, 0.7);
      L.yaw = yaw; L.pitch = pitch; L.spread = spread; L.roll = roll;
      m.opS += ((gOn ? op : 0) - m.opS) * ease;
      const cpF = Math.cos(pitch), fx = Math.sin(yaw) * cpF, fy = Math.sin(pitch), fz = Math.cos(yaw) * cpF;
      const tx = cam.x - L.pos.x, ty = cam.y - L.pos.y, tz = cam.z - L.pos.z, tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      const face = clamp(((fx * tx + fy * ty + fz * tz) / tl - 0.2) / 0.45, 0, 1);
      L.op = m.opS * (pat === 'kick' ? 0.5 + 0.5 * kick : 1) * (1 - 0.75 * face);
      if (rainbow) c.setHSL(frac(t * 0.08 + u * 0.6 + (i & 1) * 0.3), 1, 0.55);
      else if (classic) c.copy((i & 1) ? GREEN : lzA).lerp(WHITE, 0.03);
      else { c.copy((i & 1) === 0 ? lzC : lzA).lerp(WHITE, 0.02); if (same && (i & 1) === 0) c.offsetHSL(0.1, 0, 0); }
      L.color.copy(c);
    }
    bank.update();
  }

  _updatePixels(show) {
    const px = this.pixels, ph = show.active ? show.phase : 'idle', P = this.P, s = this.style, dip = show.dip || 0, wo = show.whiteout > 0.5;
    P.t = show.t; P.A = show.colorA; P.B = show.colorB; P.C = show.colorC;
    P.bp = clamp(show.beatPhase, 0, 1); P.pulse = show.beatPulse; P.kick = show.kick; P.snare = show.snare; P.beatIdx = show.beatIndex | 0;
    P.dir = this.rigDir; P.rep = this.rigRep; P.level = clamp(show.bass * 1.15 + show.beatPulse * 0.2, 0, 1); P.prog = clamp(show.buildProgress, 0, 1);
    P.tick = Math.floor(show.t * 16); P.density = 0.02 + show.energy * 0.14; P.barOdd = show.barIndex & 1; P.spec = show.spectrum; P.speed = 0.35 + show.bpm / 240;
    let fn = RIG_PAT[this.rigPat] || RIG_PAT.breathe;
    if (show.predrop && ph === 'build') fn = RIG_PAT.strobe;
    const hi = HI.has(ph);
    const gain = 1.3, kf = clamp(show.kick * 0.4 * (s.strobes ?? 0.8), 0, 0.45) * (hi ? 1 : 0.3);
    const dim = (ph === 'idle' ? 0.5 : ph === 'breakdown' ? 0.7 : 1) * (hi ? 1 : 1 - 0.4 * (s.dark ?? 0.35)) * (1 - 0.85 * dip);
    for (const st of this.rigStrips) {
      const base = st.start;
      for (let i = 0; i < st.count; i++) {
        let k;
        if (wo) { k = 1; pc.copy(WHITE); }
        else { pc.copy(P.A); k = fn(st, i, P); if (kf > 0.02) { pc.lerp(WHITE, kf); k = Math.max(k, kf); } }
        px.setPixelC(base + i, pc, k * gain * dim);
      }
    }
    px.commit();
  }

  _updatePanels(show, col) {
    const t = this.t;
    if (t >= this.textUntil) for (const p of this.panels) if (p.program === 'text') { p.program = 'wash'; this.pickProgram(true, [p.role]); }
    const o = this.o;
    for (const p of this.allPanels) {
      const live = p.program === 'imag';
      if (live !== p.live) p.setSource(live ? this.imag.rt.texture : null);
      if (!live) p.draw((ctx, w, h, panel) => drawProgram(ctx, w, h, panel, show, col, o));
    }
  }

  _updateFx(show, dt) {
    const t = this.t, pr = this.particles;
    if (t < this.fx.flameUntil) for (const x of FLAME_X) pr.flame(x, 2.4, 5.2, 1.1, 8);
    if (t < this.fx.sparkUntil) for (const x of SPARK_X) pr.sparkular(x, 2.4, 4.2, 3, 1.2);
    if (t < this.fx.flameUntil && (this.style.pyro ?? 0.6) > 0.5) for (const x of [-46, 46]) pr.flame(x, 32.4, 0, 1.3, 6);
    this.fw.update(dt);
    pr.update(dt);
  }

  _updateWorld(show, dt) {
    const ph = show.phase, hi = HI.has(ph), dip = show.dip || 0;
    const base = ph === 'idle' ? 2 : ph === 'breakdown' ? 6 : 10;
    const wi = (base + 60 * show.bass * show.energy + 80 * show.strobe + 120 * show.whiteout) * (1 - 0.7 * dip) * LIGHT_K;
    const cols = [show.colorA, show.colorC, show.colorB];
    this.washLights.forEach((l, i) => { l.color.copy(cols[i]).lerp(WHITE, show.whiteout); l.intensity = wi; });
    this.stageLight.color.copy(show.colorB).lerp(WHITE, 0.5);
    this.stageLight.intensity = (8 + 30 * show.bass) * (1 - 0.6 * dip) * LIGHT_K;
    this.crowd.mat.color.copy(show.colorA).multiplyScalar(0.05 + 0.08 * show.energy).add(this.tmpC.setRGB(0.03, 0.03, 0.05));
    // Bloom backs off as the rig fills up: hundreds of additive beams plus HDR strobe faces would
    // otherwise stack into a full-screen white haze during drops (dark phases keep the soft glow).
    const load = clamp(this.headLoad * 1.1 + 0.35 * show.strobe, 0, 1.2);
    const target = 0.46 - 0.26 * load + 0.08 * show.kick * (hi ? 1 : 0.3) + 0.3 * show.whiteout;
    this.bloomS += (target - this.bloomS) * Math.min(1, dt * 5);
    this.bloom.strength = this.bloomS;
    // Auto-iris: scale the exposure so the brightest quarter of the frame sits near the target (laser + beam walls
    // in the low shots close it a stop) - fast attack, slower release - and re-adapt at once a few frames after a
    // cut, like a camera switch. Strobes flicker faster than the attack, so the iris rides them instead of pumping.
    const I = this.iris, expoT = clamp(EXPO_BASE * IRIS_TARGET / Math.max(I.top, 0.05), EXPO_MIN, EXPO_BASE);
    if (I.snapIn > 0 && --I.snapIn === 0) I.expo = expoT;
    else I.expo += (expoT - I.expo) * Math.min(1, dt * (expoT < I.expo ? 8 : 2.5));
    this.renderer.toneMappingExposure = I.expo + 0.25 * show.whiteout;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const I = this.imag;
    if (I.on && (I.frame++ & 1) === 0) {
      const r = this.renderer, bl = this.boothLight, F = FIGURE_LIGHT, bi = bl.intensity;
      bl.intensity = bi * IMAG_KEY;
      _imagFill.copy(F.fill.value); _imagRim.copy(F.rim.value);
      F.fill.value.multiplyScalar(IMAG_FILL); F.rim.value.multiplyScalar(IMAG_RIM);
      r.setRenderTarget(I.rt); r.clear(); r.render(this.scene, I.cam); r.setRenderTarget(null);
      bl.intensity = bi; F.fill.value.copy(_imagFill); F.rim.value.copy(_imagRim);
      I.frames++;
    }
    this.composer.render();
  }

  // Meters the composer's HDR buffer into a 16x9 byte target and reads it back without a stall (PBO + fence);
  // every other frame is plenty for an iris. Any failure switches the iris off and the exposure settles at its base.
  _readIris(src) {
    const I = this.iris;
    if (!I || I.off || I.busy || !src || (I.frame++ & 1)) return;
    const r = this.renderer, prev = r.getRenderTarget();
    try {
      I.mat.uniforms.tSrc.value = src.texture;
      r.setRenderTarget(I.rt); r.render(I.scene, I.cam); r.setRenderTarget(prev);
      I.busy = true;
      r.readRenderTargetPixelsAsync(I.rt, 0, 0, IRIS_W, IRIS_H, I.buf).then(() => {
        // Per channel: R = mean clamped luminance (0..IRIS_RANGE), G = share of taps over 1.0 (blown). Each gives a
        // frame mean (load, blown) and a mean of the brightest quarter (top, blownTop); the iris keys on top.
        const b = I.buf, cells = I.cells, n = cells.length, scale = [IRIS_RANGE, 1], out = ['load', 'blown'], outTop = ['top', 'blownTop'];
        for (let ch = 0; ch < 2; ch++) {
          let sum = 0;
          for (let i = 0; i < n; i++) { const v = b[i * 4 + ch] / 255 * scale[ch]; cells[i] = v; sum += v; }
          cells.sort(); let top = 0;
          for (let i = n - IRIS_TOP; i < n; i++) top += cells[i];
          I[out[ch]] = sum / n; I[outTop[ch]] = top / IRIS_TOP;
        }
        I.busy = false;
      }, (e) => { I.off = true; I.busy = false; I.load = 0; console.warn('auto-iris off:', e); });
    } catch (e) { r.setRenderTarget(prev); I.off = true; I.busy = false; I.load = 0; console.warn('auto-iris off:', e); }
  }
}
