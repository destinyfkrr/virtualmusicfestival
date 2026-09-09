// Procedurally drawn artist marks (logo-like geometric signatures) for the LED walls.
// All shapes are drawn in a unit space: origin = panel centre, 1 unit = panel height,
// x spans ±aspect/2. drawMark() composites the mark with reveal / glitch / beat-pulse effects.

const FONT = '"Arial Black", Impact, "Helvetica Neue", Helvetica, Arial, sans-serif';
const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);
const hash1 = (i) => frac(Math.sin(i * 12.9898 + 78.233) * 43758.5453);

// ------------------------------------------------------------------ helpers (unit space)
function poly(c, pts, { fill = true, stroke = false, lw = 0.05, close = true } = {}) {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  if (close) c.closePath();
  if (fill) c.fill();
  if (stroke) { c.lineWidth = lw; c.stroke(); }
}
function line(c, x1, y1, x2, y2, lw = 0.06) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = lw; c.stroke(); }
function path(c, pts, lw = 0.06) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.lineWidth = lw; c.stroke(); }
function circle(c, x, y, r, { fill = false, lw = 0.05 } = {}) { c.beginPath(); c.arc(x, y, r, 0, TAU); if (fill) c.fill(); else { c.lineWidth = lw; c.stroke(); } }
function arc(c, x, y, r, a0, a1, lw = 0.06) { c.beginPath(); c.arc(x, y, r, a0, a1); c.lineWidth = lw; c.stroke(); }
function rect(c, x, y, w, h, { fill = true, lw = 0.05 } = {}) { if (fill) c.fillRect(x, y, w, h); else { c.lineWidth = lw; c.strokeRect(x, y, w, h); } }
function plus(c, x, y, r, lw) { line(c, x - r, y, x + r, y, lw); line(c, x, y - r, x, y + r, lw); }
function cross(c, x, y, r, lw) { const k = r * 0.7071; line(c, x - k, y - k, x + k, y + k, lw); line(c, x - k, y + k, x + k, y - k, lw); }
function starPts(cx, cy, rOuter, rInner, n = 5, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? rInner : rOuter; const a = rot + (i * Math.PI) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}
function ngonPts(cx, cy, r, n, rot = 0) { const pts = []; for (let i = 0; i < n; i++) { const a = rot + (i * TAU) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts; }

function splitLines(str) {
  const s = (str || '').trim();
  if (s.length <= 11 || !s.includes(' ')) return [s];
  const words = s.split(' ');
  let best = null, bestD = 1e9;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const d = Math.abs(a.length - b.length);
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  return best;
}

// text in unit space (renders in pixel space for crisp glyphs)
function text(c, o, str, { cx = 0, cy = 0, maxW = 1.8, maxH = 0.5, weight = '900', family = FONT, spacing = 0.04, lines = null, stroke = false, lw = 0 } = {}) {
  const px = o.s;
  const ls = lines || splitLines(str);
  const lineH = maxH / ls.length;
  c.save();
  c.scale(1 / px, 1 / px);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  ls.forEach((ln, i) => {
    let size = Math.max(4, Math.floor(lineH * 0.9 * px));
    const setFont = () => { c.font = `${weight} ${size}px ${family}`; try { c.letterSpacing = `${(spacing * size) | 0}px`; } catch {} };
    setFont();
    let m = c.measureText(ln).width;
    if (m > maxW * px) { size = Math.max(4, Math.floor((size * maxW * px) / m)); setFont(); }
    const y = (cy + (i - (ls.length - 1) / 2) * lineH) * px;
    if (stroke) { c.lineWidth = Math.max(1, lw * px); c.strokeText(ln, cx * px, y); } else c.fillText(ln, cx * px, y);
  });
  c.restore();
}

// real logo (see logos.js) fitted into the panel; drawn tinted with the current mark colour, photo-like
// kinds (clearart / cutouts) as they are. o.logoScale scales the fit.
export function imageRect(e, aw, ah, k = 1) {
  const kk = e.scale * k;
  let dw = aw * 0.92 * kk, dh = dw / e.aspect;
  if (dh > ah * 0.9 * kk) { dh = ah * 0.9 * kk; dw = dh * e.aspect; }
  return [-dw / 2, -dh / 2, dw, dh];
}

// ------------------------------------------------------------------ mark library
export const MARKS = {
  image(c, o) {
    const e = o.logoImg;
    if (!e) return MARKS.text(c, o);
    const [x, y, dw, dh] = imageRect(e, o.aw, 1, o.logoScale || 1);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(e.tint(c.fillStyle), x, y, dw, dh);
  },
  text(c, o) { text(c, o, o.text || '', { maxW: o.aw * 0.92, maxH: 0.56 }); },

  plusx(c, o) { plus(c, -0.36, 0, 0.26, 0.12); cross(c, 0.36, 0, 0.28, 0.12); },

  threeDots(c, o) { for (let i = -1; i <= 1; i++) circle(c, i * 0.36, 0, 0.11, { fill: true }); },

  mau5(c, o) {
    circle(c, -0.3, -0.24, 0.16, { fill: true }); circle(c, 0.3, -0.24, 0.16, { fill: true });
    circle(c, 0, 0.02, 0.32, { fill: true });
    c.fillStyle = o.bg; circle(c, -0.12, -0.05, 0.06, { fill: true }); circle(c, 0.12, -0.05, 0.06, { fill: true });
    c.beginPath(); c.arc(0, 0.04, 0.2, 0.15 * Math.PI, 0.85 * Math.PI); c.lineWidth = 0.05; c.strokeStyle = o.bg; c.stroke();
    c.strokeStyle = c.fillStyle = o.color;
  },

  helmet(c, o) {
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(-0.26, 0.36); c.lineTo(-0.26, -0.1); c.arc(0, -0.1, 0.26, Math.PI, 0); c.lineTo(0.26, 0.36); c.closePath(); c.fill();
    c.strokeStyle = '#111';
    cross(c, -0.11, -0.06, 0.07, 0.035); cross(c, 0.11, -0.06, 0.07, 0.035);
    c.beginPath(); c.arc(0, 0.06, 0.15, 0.1 * Math.PI, 0.9 * Math.PI); c.lineWidth = 0.035; c.stroke();
    c.strokeStyle = c.fillStyle = o.color;
  },

  aw(c, o) {
    path(c, [[-0.42, -0.3], [-0.22, 0.34], [0, -0.08], [0.22, 0.34], [0.42, -0.3]], 0.07);
    path(c, [[-0.24, 0.34], [0, -0.34], [0.24, 0.34]], 0.07);
  },

  x(c, o) { cross(c, 0, 0, 0.42, 0.13); },

  xJag(c, o) {
    cross(c, 0, 0, 0.44, 0.16);
    c.strokeStyle = o.bg; cross(c, 0, 0, 0.44, 0.04); c.strokeStyle = o.color;
    poly(c, [[-0.06, -0.44], [0.06, -0.44], [0, -0.3]]); poly(c, [[-0.06, 0.44], [0.06, 0.44], [0, 0.3]]);
  },

  phoenix(c, o) {
    poly(c, [[-0.05, -0.02], [-0.22, -0.12], [-0.42, -0.34], [-0.5, -0.06], [-0.36, 0.06], [-0.2, 0.1], [-0.08, 0.16]]);
    poly(c, [[0.05, -0.02], [0.22, -0.12], [0.42, -0.34], [0.5, -0.06], [0.36, 0.06], [0.2, 0.1], [0.08, 0.16]]);
    poly(c, [[0, -0.34], [0.07, -0.16], [0.06, 0.16], [0, 0.42], [-0.06, 0.16], [-0.07, -0.16]]);
    poly(c, [[-0.06, 0.28], [-0.2, 0.44], [-0.02, 0.4]]); poly(c, [[0.06, 0.28], [0.2, 0.44], [0.02, 0.4]]);
  },

  hexagon(c, o) {
    poly(c, ngonPts(0, 0, 0.42, 6, Math.PI / 6), { fill: false, stroke: true, lw: 0.06 });
    const inner = ngonPts(0, 0, 0.24, 6, Math.PI / 6);
    poly(c, inner, { fill: false, stroke: true, lw: 0.04 });
    for (let i = 0; i < 6; i += 2) line(c, 0, 0, inner[i][0], inner[i][1], 0.04);
  },

  triangleA(c, o) { poly(c, [[0, -0.4], [0.42, 0.34], [-0.42, 0.34]], { fill: false, stroke: true, lw: 0.07 }); line(c, -0.18, 0.12, 0.18, 0.12, 0.07); },

  bird(c, o) {
    c.beginPath();
    c.moveTo(0, 0.12); c.quadraticCurveTo(-0.22, -0.02, -0.5, -0.3); c.quadraticCurveTo(-0.24, -0.26, -0.08, -0.16);
    c.lineTo(0, -0.34); c.lineTo(0.08, -0.16); c.quadraticCurveTo(0.24, -0.26, 0.5, -0.3); c.quadraticCurveTo(0.22, -0.02, 0, 0.12);
    c.closePath(); c.fill();
    poly(c, [[-0.05, 0.1], [0.05, 0.1], [0, 0.32]]);
  },

  bars(c, o) { for (let i = -1; i <= 1; i++) poly(c, [[i * 0.3 - 0.06, 0.3], [i * 0.3 + 0.12, -0.3], [i * 0.3 + 0.24, -0.3], [i * 0.3 + 0.06, 0.3]]); },

  mask(c, o) {
    const pts = [[-0.5, -0.06], [-0.34, -0.24], [-0.12, -0.14], [0, -0.22], [0.12, -0.14], [0.34, -0.24], [0.5, -0.06], [0.34, 0.14], [0.14, 0.12], [0, 0.36], [-0.14, 0.12], [-0.34, 0.14]];
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
    c.moveTo(-0.08, -0.04); c.ellipse(-0.22, -0.04, 0.12, 0.06, 0, 0, TAU); c.moveTo(0.34, -0.04); c.ellipse(0.22, -0.04, 0.12, 0.06, 0, 0, TAU);
    c.fill('evenodd');
  },

  lips(c, o) {
    c.beginPath(); c.moveTo(-0.44, 0); c.quadraticCurveTo(-0.22, -0.26, -0.02, -0.12); c.quadraticCurveTo(0, -0.16, 0.02, -0.12); c.quadraticCurveTo(0.22, -0.26, 0.44, 0);
    c.quadraticCurveTo(0.2, 0.3, 0, 0.3); c.quadraticCurveTo(-0.2, 0.3, -0.44, 0); c.closePath(); c.fill();
    c.strokeStyle = o.bg; line(c, -0.4, 0.01, 0.4, 0.01, 0.03); c.strokeStyle = o.color;
    c.fillStyle = '#ffffff'; rect(c, -0.3, 0.38, 0.6, 0.06); c.fillStyle = o.color;
  },

  xx(c, o) { poly(c, ngonPts(0, 0, 0.46, 6, Math.PI / 6), { fill: false, stroke: true, lw: 0.05 }); cross(c, -0.16, 0, 0.16, 0.08); cross(c, 0.16, 0, 0.16, 0.08); },

  trumpet(c, o) {
    line(c, 0, -0.26, 0, 0.4, 0.12);
    line(c, -0.46, -0.26, 0.18, -0.26, 0.1);
    poly(c, [[0.16, -0.36], [0.5, -0.46], [0.5, -0.06], [0.16, -0.16]]);
    for (let i = 0; i < 3; i++) line(c, -0.3 + i * 0.1, -0.32, -0.3 + i * 0.1, -0.42, 0.04);
  },

  face(c, o) {
    circle(c, 0, 0, 0.36, { lw: 0.06 });
    circle(c, -0.13, -0.08, 0.05, { fill: true }); circle(c, 0.13, -0.08, 0.05, { fill: true });
    path(c, [[-0.2, 0.12], [-0.12, 0.2], [-0.04, 0.12], [0.04, 0.2], [0.12, 0.12], [0.2, 0.2]], 0.05);
  },

  faceLine(c, o) {
    c.beginPath(); c.ellipse(0, 0, 0.32, 0.42, 0, 0, TAU); c.lineWidth = 0.035; c.stroke();
    c.beginPath(); c.ellipse(-0.12, -0.1, 0.07, 0.04, 0, 0, TAU); c.stroke(); c.beginPath(); c.ellipse(0.12, -0.1, 0.07, 0.04, 0, 0, TAU); c.stroke();
    path(c, [[0, -0.06], [-0.05, 0.1], [0.03, 0.1]], 0.035);
    arc(c, 0, 0.16, 0.12, 0.15 * Math.PI, 0.85 * Math.PI, 0.035);
  },

  odesza(c, o) {
    circle(c, 0, 0, 0.4, { lw: 0.05 });
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(-0.26, i * 0.14); c.quadraticCurveTo(0, i * 0.14 - 0.16, 0.26, i * 0.14); c.lineWidth = 0.045; c.stroke(); }
  },

  eye(c, o) {
    c.beginPath(); c.moveTo(-0.5, 0); c.quadraticCurveTo(0, -0.42, 0.5, 0); c.quadraticCurveTo(0, 0.42, -0.5, 0); c.closePath(); c.lineWidth = 0.06; c.stroke();
    circle(c, 0, 0, 0.17, { fill: true }); c.fillStyle = o.bg; circle(c, 0, 0, 0.08, { fill: true }); c.fillStyle = o.color;
  },

  eyes(c, o) {
    for (const sx of [-0.28, 0.28]) {
      const r0 = 0.24;
      for (let i = 0; i < 4; i++) { const r = r0 * (1 - i / 4) - frac(o.t * 0.8) * (r0 / 4); if (r > 0.01) circle(c, sx, 0, r, { lw: 0.03 }); }
    }
    line(c, -0.04, 0, 0.04, 0, 0.03);
  },

  shark(c, o) {
    c.beginPath(); c.moveTo(-0.3, 0.18); c.quadraticCurveTo(-0.04, 0.02, 0.04, -0.36); c.quadraticCurveTo(0.14, -0.06, 0.34, 0.18); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-0.55, 0.22); for (let x = -0.55; x <= 0.55; x += 0.05) c.lineTo(x, 0.22 + Math.sin(x * 20 + o.t * 3) * 0.03); c.lineWidth = 0.04; c.stroke();
  },

  armin(c, o) {
    rect(c, -0.9 * Math.min(1, o.aw / 2), -0.42, 1.8 * Math.min(1, o.aw / 2), 0.84, { fill: false, lw: 0.04 });
    text(c, o, 'ARMIN', { cy: -0.16, maxW: o.aw * 0.8, maxH: 0.34, lines: ['ARMIN'] });
    text(c, o, 'VAN BUUREN', { cy: 0.17, maxW: o.aw * 0.8, maxH: 0.22, lines: ['VAN BUUREN'], spacing: 0.1 });
  },

  ampersand(c, o) {
    text(c, o, 'ABOVE', { cy: -0.32, maxW: o.aw * 0.7, maxH: 0.16, lines: ['ABOVE'], spacing: 0.25 });
    text(c, o, '&', { cy: 0.02, maxW: 0.5, maxH: 0.5, lines: ['&'] });
    text(c, o, 'BEYOND', { cy: 0.36, maxW: o.aw * 0.7, maxH: 0.16, lines: ['BEYOND'], spacing: 0.25 });
  },

  cube(c, o) {
    const r = 0.4, a = o.t * 0.4;
    const P = [];
    for (let i = 0; i < 8; i++) {
      let x = (i & 1 ? 1 : -1), y = (i & 2 ? 1 : -1), z = (i & 4 ? 1 : -1);
      const cx = Math.cos(a), sx = Math.sin(a);
      const x2 = x * cx - z * sx, z2 = x * sx + z * cx;
      const ty = 0.6, cy = Math.cos(ty), sy = Math.sin(ty);
      const y3 = y * cy - z2 * sy, z3 = y * sy + z2 * cy;
      const d = 1 / (3.2 + z3);
      P.push([x2 * d * r * 3, y3 * d * r * 3]);
    }
    c.lineWidth = 0.035;
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const dd = i ^ j; if (dd === 1 || dd === 2 || dd === 4) line(c, P[i][0], P[i][1], P[j][0], P[j][1], 0.035); }
  },

  ww(c, o) {
    path(c, [[-0.9, -0.3], [-0.72, 0.32], [-0.54, -0.12], [-0.36, 0.32], [-0.18, -0.3]], 0.09);
    text(c, o, '&', { cx: 0, cy: 0.02, maxW: 0.3, maxH: 0.42, lines: ['&'] });
    path(c, [[0.18, -0.3], [0.36, 0.32], [0.54, -0.12], [0.72, 0.32], [0.9, -0.3]], 0.09);
  },

  peakA(c, o) {
    path(c, [[-0.44, 0.38], [0, -0.4], [0.44, 0.38]], 0.08);
    poly(c, [[0, -0.1], [0.16, 0.2], [-0.16, 0.2]], { fill: false, stroke: true, lw: 0.06 });
  },

  jagged(c, o) {
    text(c, o, o.text || 'ANGERFIST', { maxW: o.aw * 0.86, maxH: 0.4, lines: [o.text || 'ANGERFIST'] });
    const zig = (y, dir) => { const pts = []; for (let i = 0; i <= 16; i++) pts.push([-0.9 + (1.8 * i) / 16, y + (i % 2 ? dir * 0.06 : 0)]); path(c, pts, 0.03); };
    zig(-0.34, -1); zig(0.34, 1);
  },

  cw(c, o) { arc(c, -0.14, 0, 0.36, 0.3 * Math.PI, 1.7 * Math.PI, 0.08); path(c, [[0.02, -0.22], [0.14, 0.24], [0.28, -0.1], [0.42, 0.24], [0.54, -0.22]], 0.08); },

  anyma(c, o) {
    circle(c, 0, -0.24, 0.11, { fill: true });
    poly(c, [[-0.34, 0.46], [-0.22, -0.02], [-0.08, -0.08], [0.08, -0.08], [0.22, -0.02], [0.34, 0.46]]);
    c.strokeStyle = o.bg; for (let i = 1; i < 5; i++) line(c, -0.34 + i * 0.03, -0.02 + i * 0.1, 0.34 - i * 0.03, -0.02 + i * 0.1, 0.012); c.strokeStyle = o.color;
  },

  avicii(c, o) { poly(c, [[-0.46, 0.24], [-0.04, 0.24], [-0.04, -0.24]]); poly(c, [[0.04, -0.24], [0.46, -0.24], [0.04, 0.24]]); },

  starA(c, o) { poly(c, starPts(0, -0.1, 0.32, 0.13)); text(c, o, 'DV&LM', { cy: 0.32, maxW: o.aw * 0.8, maxH: 0.2, lines: ['DV&LM'], spacing: 0.12 }); },

  arrowA(c, o) { path(c, [[-0.4, 0.38], [0, -0.3], [0.4, 0.38]], 0.09); line(c, -0.18, 0.14, 0.18, 0.14, 0.08); poly(c, [[0, -0.46], [0.16, -0.18], [-0.16, -0.18]]); },

  star(c, o) { poly(c, starPts(0, 0.02, 0.42, 0.17), { fill: false, stroke: true, lw: 0.06 }); },

  hardwell(c, o) {
    line(c, -0.62, -0.36, -0.62, 0.36, 0.11); line(c, -0.26, -0.36, -0.26, 0.36, 0.11);
    line(c, -0.62, 0, 0.62, 0, 0.11); line(c, 0.62, -0.36, 0.62, 0.36, 0.11); line(c, 0.26, 0.28, 0.62, 0.28, 0.11);
  },

  lines3(c, o) { for (let i = -1; i <= 1; i++) line(c, -0.5 + (i + 1) * 0.12, i * 0.24, 0.5 - (i + 1) * 0.12, i * 0.24, 0.09); },

  chevrons5(c, o) { for (let i = -2; i <= 2; i++) path(c, [[i * 0.32 - 0.12, 0.2], [i * 0.32, -0.2], [i * 0.32 + 0.12, 0.2]], 0.06); },

  zedd(c, o) {
    poly(c, [[-0.5, -0.36], [0.5, -0.36], [0.5, -0.18], [-0.16, 0.18], [0.5, 0.18], [0.5, 0.36], [-0.5, 0.36], [-0.5, 0.18], [0.16, -0.18], [-0.5, -0.18]]);
    c.fillStyle = o.bg; poly(c, [[-0.5, -0.36], [-0.32, -0.36], [-0.5, -0.24]]); poly(c, [[0.5, 0.36], [0.32, 0.36], [0.5, 0.24]]); c.fillStyle = o.color;
  },

  cc(c, o) {
    arc(c, 0, 0, 0.4, 0.25 * Math.PI, 1.75 * Math.PI, 0.08); arc(c, 0, 0, 0.22, 0.3 * Math.PI, 1.7 * Math.PI, 0.07);
    line(c, 0.3, -0.28, 0.6, -0.4, 0.05); line(c, 0.3, 0.28, 0.6, 0.4, 0.05);
  },

  circleWave(c, o) {
    circle(c, 0, 0, 0.42, { lw: 0.05 });
    const pts = []; for (let i = 0; i <= 24; i++) { const x = -0.3 + (0.6 * i) / 24; pts.push([x, Math.sin(i * 0.9 + o.t * 4) * 0.16 * Math.sin((i / 24) * Math.PI)]); } path(c, pts, 0.04);
  },

  pendulum(c, o) {
    const a = Math.sin(o.t * 2.4) * 0.55;
    circle(c, 0, -0.42, 0.04, { fill: true });
    const bx = Math.sin(a) * 0.62, by = -0.42 + Math.cos(a) * 0.62;
    line(c, 0, -0.42, bx, by, 0.03); circle(c, bx, by, 0.11, { fill: true });
  },

  mushroom(c, o) {
    c.beginPath(); c.arc(0, -0.02, 0.4, Math.PI, 0); c.closePath(); c.fill();
    rect(c, -0.12, -0.02, 0.24, 0.42);
    c.fillStyle = o.bg; circle(c, -0.18, -0.2, 0.06, { fill: true }); circle(c, 0.12, -0.28, 0.05, { fill: true }); circle(c, 0.24, -0.1, 0.05, { fill: true }); c.fillStyle = o.color;
  },
};

export const MARK_NAMES = Object.keys(MARKS);
export const hasMark = (n) => !!MARKS[n];

// ------------------------------------------------------------------ compositing
const offs = new Map();
function getOff(w, h) {
  const k = w + 'x' + h;
  let cv = offs.get(k);
  if (!cv) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; offs.set(k, cv); }
  return cv;
}

const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/**
 * drawMark(ctx, w, h, mark, o)
 *  o: { t, beat, reveal (0..1), revealMode ('wipe'|'scale'|'scan'|'flicker'|'build'), glitch (0..1),
 *       color, color2, bg, text, invert }
 */
export function drawMark(ctx, w, h, mark, o) {
  const fn = MARKS[mark] || MARKS.text;
  const off = getOff(w, h);
  const c = off.getContext('2d');
  const s = h;
  o.s = s; o.aw = w / h;
  o.bg = o.bg || '#000000'; o.color = o.color || '#ffffff';
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  if (o.invert) { c.fillStyle = o.color; c.fillRect(0, 0, w, h); }
  c.save();
  const pulse = 1 + 0.05 * (o.beat || 0);
  c.translate(w / 2, h / 2);
  c.scale(s * pulse, s * pulse);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (o.invert) { c.fillStyle = c.strokeStyle = o.bg; const sw = o.color; o.color = o.bg; o.bg = sw; }
  else c.fillStyle = c.strokeStyle = o.color;
  fn(c, o);
  c.restore();
  if (o.invert) { const sw = o.color; o.color = o.bg; o.bg = sw; }

  // composite with reveal + glitch
  const rv = o.reveal == null ? 1 : Math.max(0, Math.min(1, o.reveal));
  const mode = o.revealMode || 'wipe';
  ctx.save();
  if (rv < 1) {
    if (mode === 'wipe') {
      const sw = Math.max(1, w * easeOut(rv));
      const sx = (w - sw) / 2;
      ctx.drawImage(off, sx, 0, sw, h, sx, 0, sw, h);
      ctx.fillStyle = o.color; ctx.globalAlpha = 0.8; ctx.fillRect(sx, 0, 2, h); ctx.fillRect(sx + sw - 2, 0, 2, h);
    } else if (mode === 'scan') {
      const sh = Math.max(1, h * easeOut(rv));
      ctx.drawImage(off, 0, 0, w, sh, 0, 0, w, sh);
      ctx.fillStyle = o.color; ctx.globalAlpha = 0.9; ctx.fillRect(0, sh - 1, w, 2);
    } else if (mode === 'scale') {
      const k = 0.4 + 0.6 * easeOut(rv);
      ctx.globalAlpha = Math.min(1, rv * 2);
      ctx.translate(w / 2, h / 2); ctx.scale(k, k); ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(off, 0, 0);
    } else if (mode === 'flicker') {
      const on = hash1(Math.floor(o.t * 30)) < rv * rv + 0.1;
      if (on) ctx.drawImage(off, 0, 0);
    } else { // build: slices appear in random order
      const n = 12;
      for (let i = 0; i < n; i++) if (hash1(i * 7 + 3) < rv * 1.15) ctx.drawImage(off, (i * w) / n, 0, w / n + 1, h, (i * w) / n, 0, w / n + 1, h);
    }
  } else if (o.glitch > 0.02) {
    const q = Math.floor(o.t * 24);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const r = hash1(i + q * 13.1);
      const dx = r < o.glitch ? (hash1(i * 3 + q) - 0.5) * w * 0.12 * o.glitch : 0;
      ctx.drawImage(off, 0, (i * h) / n, w, h / n + 1, dx, (i * h) / n, w, h / n + 1);
    }
    if (hash1(q * 0.37) < o.glitch * 0.5) { // colour split
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35;
      ctx.drawImage(off, 3, 0); ctx.drawImage(off, -3, 0);
    }
  } else {
    ctx.drawImage(off, 0, 0);
  }
  ctx.restore();
}
