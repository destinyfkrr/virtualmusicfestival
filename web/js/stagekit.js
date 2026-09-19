// stagekit.js - what the sculpted stages share: the geometry painter, shaped wall outlines, and the one Lambert shader
// patched for fake architectural lighting in the show colours (so a whole set costs no lights of its own).
import * as THREE from 'three';
import { Paint, outline, place } from './futurestage.js';
export { Paint, outline, place };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// faceted copy of a geometry: every triangle gets its own normal, so crystals and cut metal read as planes
export function facet(geo) { const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose(); g.computeVertexNormals(); return g; }

// vertex colours running from `lo` at the bottom of the geometry's own bounding box to `hi` at the top
export function shade(geo, lo, hi, pow = 1) {
  geo.computeBoundingBox();
  const P = geo.attributes.position, y0 = geo.boundingBox.min.y, y1 = geo.boundingBox.max.y, a = new THREE.Color(lo), b = new THREE.Color(hi), c = new THREE.Color(), col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { c.copy(a).lerp(b, Math.pow(clamp((P.getY(i) - y0) / Math.max(1e-6, y1 - y0), 0, 1), pow)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export const makeShared = () => ({ uT: { value: 0 }, uWarm: { value: 0.6 }, uWashA: { value: new THREE.Color(1, 1, 1) }, uWashB: { value: new THREE.Color(1, 1, 1) }, uWashK: { value: 0.3 } });

// warm = colour of the resting uplight, H / W = the set's height and half width, flat = 1 for pieces lit evenly (faces, gems)
export function sculptMaterial(shared, { flat = 0, H = 58, W = 88, warm = [1.0, 0.72, 0.42], flatShading = false } = {}) {
  const U = { uT: shared.uT, uWarm: shared.uWarm, uWashA: shared.uWashA, uWashB: shared.uWashB, uWashK: shared.uWashK, uFlat: { value: flat }, uDim: { value: new THREE.Vector2(W, H) }, uWarmC: { value: new THREE.Color(warm[0], warm[1], warm[2]) } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;\nvarying vec3 vFsNrm;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvFsNrm = objectNormal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFsPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;\nvarying vec3 vFsNrm;\nuniform float uT, uWarm, uWashK, uFlat;\nuniform vec3 uWashA, uWashB, uWarmC;\nuniform vec2 uDim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fsUp = clamp(vFsPos.y / uDim.y, 0.0, 1.0), fsSide = clamp(abs(vFsPos.x) / uDim.x, 0.0, 1.0);
        float fsKey = 0.22 + 0.78 * pow(clamp(dot(normalize(vFsNrm) * faceDirection, normalize(vec3(0.0, -0.5, 0.86))), 0.0, 1.0), 1.4);
        vec3 fsWash = mix(uWashA, uWashB, smoothstep(0.2, 0.8, fsSide + 0.15 * sin(uT * 0.4)));
        float fsChase = 0.72 + 0.28 * sin(length(vFsPos.xy - vec2(0.0, 4.0)) * 0.22 - uT * 2.4);
        vec3 fsWarm = uWarmC * mix(0.22 + 1.0 * pow(1.0 - fsUp, 2.0), 0.85, uFlat);
        totalEmissiveRadiance += vColor.rgb * fsKey * (uWarm * fsWarm + fsWash * uWashK * mix(0.45 + 0.55 * fsUp, 0.55, uFlat) * fsChase);`);
  };
  return mat;
}
export const glowMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });

// the shared lighting drive: warm and quiet on the breakdown, washed in the show colours and kicking on the drop
export function driveShared(U, show, dt, t) {
  const ph = show.phase, hot = ph === 'drop' || ph === 'peak', calm = ph === 'breakdown' || ph === 'intro' || ph === 'idle';
  U.uT.value = t;
  U.uWarm.value += ((calm ? 0.62 : hot ? 0.3 : 0.45) - U.uWarm.value) * Math.min(1, dt * 1.5);
  U.uWashA.value.copy(show.colorA); U.uWashB.value.copy(show.colorB);
  const washT = (calm ? 0.4 : hot ? 1.0 : 0.62) + (hot ? 0.6 : 0.2) * (show.kick ?? 0);
  U.uWashK.value += (washT - U.uWashK.value) * Math.min(1, dt * (washT > U.uWashK.value ? 14 : 4));
  return { hot, calm };
}

// a shaped LED wall in a metal frame with a pixel frame round it (the Future Stage's wall(), for any stage)
export function framedWall(b, P, LedPanel, metal, cw, ch, w, h, opts, x, y, z, ry, zone, band, per) {
  const p = b.panel(new LedPanel(cw, ch, w, h, Object.assign({ noBack: true }, opts)), x, y, z, ry), shape = opts.shape || 'rect';
  const loop = outline(shape, w + 0.5, h + 0.5, 22);
  P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop.map(q => place(q, x, y, z, ry, -0.05)), true, 'catmullrom', 0.05), loop.length * 3, 0.3, 6, true), metal);
  const px = outline(shape, w + 1.3, h + 1.3, per).map(q => place(q, x, y, z, ry, 0.3));
  px.push(px[0].clone());
  b.strip('frame', px, 0.28, zone, band);
  return p;
}

// the lines every stage shares with the Mainstage deck: deck edges, riser, runways, barrier, floor
export function deckLines(b, ZONE, V3, pathLine) {
  for (const side of [-1, 1]) b.strip('deckside', pathLine(V3(side * 28.1, 2.25, -11), V3(side * 28.1, 2.25, 5), 33), 0.3, ZONE.deck);
  b.strip('deckfront', pathLine(V3(-27.5, 2.25, 5.1), V3(27.5, 2.25, 5.1), 111), 0.3, ZONE.deck);
  b.strip('riser', pathLine(V3(-7, 3.45, 1.1), V3(7, 3.45, 1.1), 31), 0.22, ZONE.riser);
  for (const x of [-8, 8]) b.strip('runway', pathLine(V3(x, 0.3, 8), V3(x, 0.3, 60), 53), 0.34, ZONE.runway);
  b.strip('barrier', pathLine(V3(-40, 0.3, 11), V3(40, 0.3, 11), 81), 0.3, ZONE.runway);
  for (const z of [-9, -6, -3, 0, 3]) b.strip('floor', pathLine(V3(-27, 2.25, z), V3(27, 2.25, z), 55), 0.22, ZONE.floor);
}

// per-facet brightness: every plane of a cut stone catches the light a little differently (keyed on the face normal,
// so the two triangles of one flat face stay one plane)
export function facetJitter(geo, amt = 0.3, seed = 1) {
  const C = geo.attributes.color, Nn = geo.attributes.normal;
  for (let i = 0; i < C.count; i++) {
    const s = Math.sin((Math.round(Nn.getX(i) * 9) * 12.9898 + Math.round(Nn.getY(i) * 9) * 78.233 + Math.round(Nn.getZ(i) * 9) * 37.719 + seed) * 43.7585) * 43758.5453, k = 1 - amt + 2 * amt * (s - Math.floor(s));
    C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k);
  }
  return geo;
}
export const DEG = Math.PI / 180, TAU = Math.PI * 2;
// points on a circle standing in the xy plane (angle 0 = straight up, positive = toward +x)
export function arcPoints(V3, cx, cy, z, R, a0, a1, n) { const pts = []; for (let i = 0; i < n; i++) { const a = (a0 + (a1 - a0) * (n > 1 ? i / (n - 1) : 0)) * DEG; pts.push(V3(cx + Math.sin(a) * R, cy + Math.cos(a) * R, z)); } return pts; }
export function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
