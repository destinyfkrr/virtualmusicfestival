// LED wall content programs.
// Every screen on the stage (main wall, wings, towers, booth front, centrepiece holo/top/side
// panels) is a small 2D canvas driven by one of these programs. A program is a pure draw fn:
//
//   fn(ctx, w, h, panel, show, col, o)
//     ctx    2D context of the panel canvas (w×h px, already cleared / faded by drawProgram)
//     panel  LedPanel — role, state (per-program scratch), seed, program, programSince
//     show   ShowDirector frame (beat, bar, phase, spectrum, energy, colours ...)
//     col    colours: { a, b, c } CSS + { A, B, C } THREE.Color + { ar, br, cr } sRGB bytes
//     o      { t, dt, profile, track, logo:{reveal, mode, glitch}, variant, white,
//              kickHit, snareHit, hatHit }   (the *Hit flags are true for one frame)
//
// drawProgram() wraps a program with the shared clear/trail handling, phase dimming and the
// global hits (pre-drop dip, whiteout, wall strobe). colorsFrom() builds `col` once per frame.

import { drawMark, imageRect } from './marks.js';

const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);
const hash1 = (i) => frac(Math.sin(i * 12.9898 + 78.233) * 43758.5453);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const FONT = 'Inter, "Arial Black", Impact, Arial, sans-serif';
const font = (px, weight = 900) => `${weight} ${px}px ${FONT}`;

// ---------------------------------------------------------------- colour helpers
const hex6 = (n) => '#' + n.toString(16).padStart(6, '0');
const bytes = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const rgba = (b, a) => `rgba(${b[0]},${b[1]},${b[2]},${a})`;
const mixCss = (b0, b1, k) => `rgb(${(b0[0] + (b1[0] - b0[0]) * k) | 0},${(b0[1] + (b1[1] - b0[1]) * k) | 0},${(b0[2] + (b1[2] - b0[2]) * k) | 0})`;

export function colorsFrom(show, out = {}) {
  const A = show.colorA, B = show.colorB, C = show.colorC;
  const ha = A.getHex(), hb = B.getHex(), hc = C.getHex();
  out.A = A; out.B = B; out.C = C;
  out.a = hex6(ha); out.b = hex6(hb); out.c = hex6(hc);
  out.ar = bytes(ha); out.br = bytes(hb); out.cr = bytes(hc);
  return out;
}

// ---------------------------------------------------------------- scratch + analysis helpers
// per-program scratch object, reset whenever the panel switches program
function st(panel, name, init) {
  let s = panel.state;
  if (!s || s.prog !== name || s.since !== panel.programSince) {
    s = panel.state = Object.assign({ prog: name, since: panel.programSince }, init ? init() : null);
  }
  return s;
}

// log-spaced band levels (0..1) from the 1024-bin spectrum, with a gentle high tilt
function bandLevels(show, n, cache) {
  const out = cache && cache.length === n ? cache : new Float32Array(n);
  const sp = show.spectrum;
  if (!sp) { out.fill(0); return out; }
  const top = sp.length * 0.45;
  for (let i = 0; i < n; i++) {
    const b0 = Math.floor(2 * Math.pow(top / 2, i / n));
    const b1 = Math.max(b0 + 1, Math.floor(2 * Math.pow(top / 2, (i + 1) / n)));
    let v = 0;
    for (let k = b0; k < b1; k++) v += sp[k];
    v /= (b1 - b0) * 255;
    out[i] = clamp01(v * (1 + (i / n) * 0.9));
  }
  return out;
}

function fitFont(ctx, txt, maxW, size, weight = 900) {
  ctx.font = font(size, weight);
  while (ctx.measureText(txt).width > maxW && size > 5) { size -= 1; ctx.font = font(size, weight); }
  return size;
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function ngonPath(ctx, x, y, r, n, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i * TAU) / n;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

const beatTime = (show) => show.beatIndex + Math.min(1, show.beatPhase); // continuous beat counter

// ---------------------------------------------------------------- programs
export const PROGRAMS = {
  // slow two-colour gradient wash with scan lines — the "nothing special" look
  wash(ctx, w, h, p, show, col, o) {
    const s = st(p, 'wash', () => ({ ang: hash1(o.variant + 3) * TAU, dir: hash1(o.variant + 9) < 0.5 ? -1 : 1 }));
    const a = s.ang + o.t * 0.12 * s.dir;
    const cx = w / 2, cy = h / 2, r = Math.hypot(w, h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, col.a); g.addColorStop(clamp01(0.5 + 0.3 * Math.sin(o.t * 0.7)), col.b); g.addColorStop(1, col.c);
    ctx.globalAlpha = 0.35 + 0.4 * show.energy + 0.25 * show.beatPulse;
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) { const y = frac(o.t * 0.12 + i / 6) * h; ctx.fillRect(0, y, w, 1); }
    if (show.kick > 0.3) { ctx.globalAlpha = show.kick * 0.3; ctx.fillRect(0, 0, w, h); }
  },

  // spectrum analyser — mirrored bars on wide panels, stacked segments on towers
  bars(ctx, w, h, p, show, col, o) {
    const tall = h > w * 1.3;
    const s = st(p, 'bars', () => ({ n: tall ? 12 : w >= 120 ? 32 : 16, lv: null, peaks: null, mirror: hash1(o.variant + 21) < 0.7 }));
    const n = s.n;
    s.lv = bandLevels(show, n, s.lv);
    if (!s.peaks) s.peaks = new Float32Array(n);
    for (let i = 0; i < n; i++) s.peaks[i] = Math.max(s.lv[i], s.peaks[i] - o.dt * 0.7);
    if (tall) {
      const segH = h / n;
      for (let i = 0; i < n; i++) {
        const bw = Math.pow(s.lv[i], 1.2) * w;
        ctx.fillStyle = i % 2 ? col.a : col.b;
        ctx.fillRect((w - bw) / 2, h - (i + 1) * segH + 1, bw, segH - 2);
      }
      return;
    }
    const half = s.mirror ? w / 2 : w, bw = half / n;
    for (let i = 0; i < n; i++) {
      const bh = Math.pow(s.lv[i], 1.3) * h * 1.05;
      const g = ctx.createLinearGradient(0, h, 0, h - Math.max(1, bh));
      g.addColorStop(0, col.a); g.addColorStop(0.7, col.b); g.addColorStop(1, '#fff');
      ctx.fillStyle = g;
      const ph = s.peaks[i] * h;
      if (s.mirror) {
        ctx.fillRect(half + i * bw, h - bh, bw - 1, bh); ctx.fillRect(half - (i + 1) * bw, h - bh, bw - 1, bh);
        ctx.fillStyle = '#fff'; ctx.fillRect(half + i * bw, h - ph - 2, bw - 1, 2); ctx.fillRect(half - (i + 1) * bw, h - ph - 2, bw - 1, 2);
      } else {
        ctx.fillRect(i * bw, h - bh, bw - 1, bh);
        ctx.fillStyle = '#fff'; ctx.fillRect(i * bw, h - ph - 2, bw - 1, 2);
      }
    }
  },

  // expanding beat rings
  pulse(ctx, w, h, p, show, col, o) {
    const s = st(p, 'pulse', () => ({ rings: [] }));
    const t = o.t;
    if (show.beat) s.rings.push({ t0: t, c: show.beatInBar === 0 ? '#fff' : show.beatIndex % 2 ? col.a : col.b, lw: show.beatInBar === 0 ? 5 : 3 });
    if (o.snareHit) s.rings.push({ t0: t, c: col.c, lw: 2 });
    const maxR = Math.hypot(w, h) * 0.55, speed = (60 + 120 * show.buildProgress) * (show.bpm / 128);
    s.rings = s.rings.filter((r) => (t - r.t0) * speed < maxR);
    for (const r of s.rings) {
      const rr = (t - r.t0) * speed;
      ctx.strokeStyle = r.c; ctx.lineWidth = r.lw + 4 * show.buildProgress; ctx.globalAlpha = Math.max(0, 1 - rr / maxR);
      ctx.beginPath(); ctx.arc(w / 2, h / 2, rr, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.6 + 0.4 * show.bass; ctx.fillStyle = col.a;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, h * (0.04 + 0.08 * show.bass), 0, TAU); ctx.fill();
  },

  // track title / artist
  text(ctx, w, h, p, show, col, o) {
    const tr = o.track || {};
    const name = (tr.name || '').toUpperCase(), artist = (tr.artist || '').toUpperCase();
    const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, col.a); g.addColorStop(1, col.b);
    ctx.globalAlpha = 0.45; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    const tall = h > w * 1.3;
    if (h >= 40 && !tall) {
      fitFont(ctx, name, w * 0.92, Math.floor(h * 0.28)); ctx.textAlign = 'center'; ctx.fillText(name, w / 2, h * 0.42);
      fitFont(ctx, artist, w * 0.8, Math.floor(h * 0.16)); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(artist, w / 2, h * 0.68);
    } else {
      const str = `${name}  •  ${artist}   `;
      ctx.font = font(Math.floor((tall ? w : h) * 0.7));
      const tw = ctx.measureText(str).width, L = tall ? h : w;
      const x = L - frac((o.t * 30) / (tw + L)) * (tw + L);
      ctx.textAlign = 'left';
      if (tall) { ctx.save(); ctx.translate(w / 2, 0); ctx.rotate(Math.PI / 2); ctx.fillText(str, x, 0); ctx.restore(); }
      else ctx.fillText(str, x, h / 2);
    }
  },

  // the artist mark (procedural logo) with reveal / glitch, on a coloured bed
  logo(ctx, w, h, p, show, col, o) {
    const pr = o.profile || {};
    const lg = o.logo || {};
    const hot = show.phase === 'drop' || show.phase === 'peak';
    const tall = h > w * 1.1;
    const s = st(p, 'logo', () => ({ sq: null, style: hash1(o.variant + 77) }));
    const reveal = lg.reveal == null ? 1 : lg.reveal;
    if (hot) {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, col.a); g.addColorStop(1, col.b);
      ctx.globalAlpha = (0.5 + 0.3 * show.beatPulse) * reveal; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      g.addColorStop(0, rgba(col.br, 0.35 + 0.2 * show.energy)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = reveal; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
    const img = o.logoImg && lg.image ? o.logoImg : null;
    const opts = {
      t: o.t, beat: show.beatPulse, reveal, revealMode: lg.mode || 'wipe', glitch: lg.glitch || 0,
      color: hot || s.style < 0.5 ? '#ffffff' : col.a, color2: col.c, bg: '#000000',
      text: pr.markText || (o.track?.artist || '').split(/,|&|feat/i)[0].trim().toUpperCase() || 'VIRTUAL-FEST',
      invert: !img && hot && show.kick > 0.6 && s.style > 0.65,
      logoImg: img,
    };
    const mark = img ? 'image' : pr.mark || 'text';
    // a real logo sits on its own soft glow (the wall's own light bleeding around the mark)
    const glow = (c, gw, gh) => { if (img && reveal > 0.3) { c.globalAlpha = (0.35 + 0.35 * show.beatPulse) * Math.min(1, (reveal - 0.3) / 0.4); c.globalCompositeOperation = 'lighter'; drawGlow(c, img, gw, gh, hot ? col.a : col.b, 1); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; } };
    if (tall) {
      if (!s.sq) { s.sq = document.createElement('canvas'); s.sq.width = w; s.sq.height = w; }
      const c2 = s.sq.getContext('2d');
      c2.clearRect(0, 0, w, w);
      glow(c2, w, w);
      drawMark(c2, w, w, mark, opts);
      ctx.drawImage(s.sq, 0, (h - w) / 2);
    } else { glow(ctx, w, h); drawMark(ctx, w, h, mark, opts); }
  },

  // the real logo tiled over the wall, rows scrolling against each other; cells flash white on the kick
  logoTile(ctx, w, h, p, show, col, o) {
    const e = o.logoImg;
    if (!e) return PROGRAMS.grid(ctx, w, h, p, show, col, o);
    const s = st(p, 'logoTile', () => ({ rows: hash1(o.variant + 91) < 0.5 ? 2 : 3, dir: hash1(o.variant + 92) < 0.5 ? 1 : -1, alt: hash1(o.variant + 93) < 0.6 }));
    const tall = h > w * 1.1;
    const rows = tall ? Math.max(3, Math.round(h / (w / 1.4))) : s.rows;
    const cell = tall ? h / rows : h / rows;
    const aspect = Math.max(0.6, Math.min(3.2, e.aspect));
    const cw = cell * aspect * 1.15, ch = cell;
    const cols = Math.ceil(w / cw) + 2;
    const bt = beatTime(show);
    ctx.fillStyle = rgba(col.cr, 0.22 + 0.1 * show.energy); ctx.fillRect(0, 0, w, h);
    const kick = show.kick;
    for (let r = 0; r < rows; r++) {
      const dir = s.alt && r % 2 ? -s.dir : s.dir;
      const off = frac(bt * 0.125 * dir + hash1(r + 3)) * cw;
      const c = r % 2 ? col.b : col.a;
      for (let i = -1; i < cols; i++) {
        const x = i * cw + off - cw, y = r * ch;
        const hi = kick > 0.35 && hash1(i * 7 + r * 13 + Math.floor(bt)) < 0.3 * kick + 0.1;
        const img = e.tint(hi ? '#ffffff' : c);
        const k = 0.72 * (1 + 0.06 * show.beatPulse);
        let dw = cw * k, dh = dw / e.aspect; if (dh > ch * k) { dh = ch * k; dw = dh * e.aspect; }
        ctx.globalAlpha = hi ? 1 : 0.85;
        ctx.drawImage(img, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
      }
    }
    ctx.globalAlpha = 1;
  },

  // the real logo blasts out of the centre every beat, leaving echoes; snare hits tear it apart
  logoBurst(ctx, w, h, p, show, col, o) {
    const e = o.logoImg;
    if (!e) return PROGRAMS.rays(ctx, w, h, p, show, col, o);
    const s = st(p, 'logoBurst', () => ({ half: hash1(o.variant + 95) < 0.4, glitch: 0 }));
    const tall = h > w * 1.1;
    const bt = beatTime(show), rate = s.half && show.phase !== 'drop' ? 0.5 : 1;
    const f = frac(bt * rate);
    s.glitch = Math.max(o.snareHit ? 0.7 : 0, s.glitch * (1 - o.dt * 6));
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.5);
    bg.addColorStop(0, rgba(col.br, 0.35 * (1 - f) + 0.15)); bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const draw = (c, gw, gh) => {
      c.globalCompositeOperation = 'lighter';
      for (let k = 2; k >= 0; k--) {
        const ff = f + k * 0.28; if (ff > 1.3) continue;
        const scale = 0.55 + 0.85 * ff;
        c.globalAlpha = (k ? 0.22 : 0.9) * Math.max(0, 1 - ff / 1.3);
        drawMark(c, gw, gh, 'image', { t: o.t, beat: 0, reveal: 1, glitch: k ? 0 : s.glitch, color: k ? (k === 1 ? col.a : col.b) : '#ffffff', bg: '#000000', logoImg: e, logoScale: scale });
      }
      c.globalAlpha = 0.5 + 0.4 * show.beatPulse;
      drawGlow(c, e, gw, gh, col.a, 0.55 + 0.85 * f);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    };
    if (tall) {
      if (!s.sq) { s.sq = document.createElement('canvas'); s.sq.width = w; s.sq.height = w; }
      const c2 = s.sq.getContext('2d'); c2.clearRect(0, 0, w, w); draw(c2, w, w); ctx.drawImage(s.sq, 0, (h - w) / 2);
    } else draw(ctx, w, h);
  },

  // nested shapes flying out of the centre, one per half beat
  tunnel(ctx, w, h, p, show, col, o) {
    const s = st(p, 'tunnel', () => ({ shape: (hash1(o.variant + 5) * 4) | 0, spin: hash1(o.variant + 6) < 0.4 ? 0 : (hash1(o.variant + 7) - 0.5) * 0.5 }));
    const n = 9, bt = beatTime(show);
    const rate = show.phase === 'breakdown' ? 0.06 : show.phase === 'peak' ? 0.5 : 0.25;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(s.spin * o.t * (show.phase === 'peak' ? 2 : 1));
    for (let k = n - 1; k >= 0; k--) {
      const f = frac(k / n + bt * rate);
      const z = Math.pow(f, 1.8);
      const rw = w * 0.72 * z, rh = h * 0.78 * z;
      ctx.strokeStyle = k % 2 ? col.a : col.c; ctx.lineWidth = 2 + 6 * f; ctx.globalAlpha = Math.min(1, f * 1.5);
      if (s.shape === 0) { ctx.beginPath(); ctx.rect(-rw, -rh, rw * 2, rh * 2); ctx.stroke(); }
      else if (s.shape === 1) { ctx.beginPath(); ctx.ellipse(0, 0, Math.max(0.1, rw), Math.max(0.1, rh), 0, 0, TAU); ctx.stroke(); }
      else if (s.shape === 2) { ngonPath(ctx, 0, 0, Math.max(0.1, rw), 6, Math.PI / 6); ctx.stroke(); }
      else { ngonPath(ctx, 0, 0, Math.max(0.1, rw), 4, 0); ctx.stroke(); }
    }
    ctx.restore();
    if (o.kickHit) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  },

  // blinder-style colour flashes: kick = A, snare = B, hats = small C blocks
  flash(ctx, w, h, p, show, col, o) {
    const s = st(p, 'flash', () => ({ blocks: [] }));
    const t = o.t;
    if (o.kickHit) s.blocks.push({ t0: t, x: 0, y: 0, w, h, c: col.a, life: 0.18, half: show.phase === 'peak' ? show.beatIndex % 2 : -1 });
    if (o.snareHit) s.blocks.push({ t0: t, x: 0, y: 0, w, h, c: col.b, life: 0.14, half: -1 });
    if (o.hatHit && s.blocks.length < 40) {
      const bw = w / 6;
      s.blocks.push({ t0: t, x: Math.floor(hash1(t * 100) * 6) * bw, y: Math.floor(hash1(t * 77) * 3) * (h / 3), w: bw, h: h / 3, c: col.c, life: 0.1, half: -1 });
    }
    s.blocks = s.blocks.filter((b) => t - b.t0 < b.life);
    ctx.globalAlpha = 0.08 + 0.06 * show.energy; ctx.fillStyle = col.b; ctx.fillRect(0, 0, w, h);
    for (const b of s.blocks) {
      ctx.globalAlpha = 1 - (t - b.t0) / b.life; ctx.fillStyle = b.c;
      if (b.half >= 0) ctx.fillRect(b.half ? w / 2 : 0, 0, w / 2, h);
      else ctx.fillRect(b.x, b.y, b.w, b.h);
    }
  },

  // soft northern-lights curtains
  aurora(ctx, w, h, p, show, col, o) {
    const s = st(p, 'aurora', () => ({ ph: hash1(o.variant + 11) * 10, layers: 3 + ((hash1(o.variant + 12) * 2) | 0) }));
    const t = o.t * 0.4 + s.ph;
    ctx.globalCompositeOperation = 'lighter';
    for (let l = 0; l < s.layers; l++) {
      const b = l % 3 === 0 ? col.ar : l % 3 === 1 ? col.br : col.cr;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba(b, 0)); g.addColorStop(0.45, rgba(b, 0.55 + 0.25 * show.energy)); g.addColorStop(1, rgba(b, 0.05));
      ctx.fillStyle = g; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) {
        const u = x / w;
        const y = h * (0.3 + 0.15 * l) + Math.sin(u * (3 + l) + t * (1 + l * 0.3)) * h * 0.14 + Math.sin(u * 7 - t * 0.7 + l) * h * 0.05 - show.bass * h * 0.12;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.1 + 0.12 * show.high; ctx.fillStyle = '#fff';
    for (let i = 0; i < 14; i++) { const x = frac(i / 14 + Math.sin(t * 0.5 + i) * 0.02) * w; ctx.fillRect(x, 0, 1, h); }
    ctx.globalCompositeOperation = 'source-over';
  },

  // oscilloscope waves
  waves(ctx, w, h, p, show, col, o) {
    const s = st(p, 'waves', () => ({ lines: 2 + ((hash1(o.variant + 41) * 3) | 0), amp: 0.14 + 0.1 * hash1(o.variant + 42) }));
    const wave = show.wave, t = o.t;
    for (let l = 0; l < s.lines; l++) {
      ctx.strokeStyle = [col.a, col.b, col.c, '#fff'][l % 4]; ctx.lineWidth = 1.5 + 3 * show.bass; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const u = x / w;
        const wv = wave ? wave[Math.floor(u * (wave.length - 1))] : 0;
        const y = h / 2 + Math.sin(u * (4 + l * 2) + t * (1.5 + l)) * h * s.amp * (0.4 + show.energy) + wv * h * 0.6 * (l === 0 ? 1 : 0.3);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (o.kickHit) { ctx.globalAlpha = 0.3; ctx.fillStyle = col.a; ctx.fillRect(0, 0, w, h); }
  },

  // rotating rays / godrays
  rays(ctx, w, h, p, show, col, o) {
    const s = st(p, 'rays', () => ({ n: 6 + ((hash1(o.variant + 13) * 10) | 0), dir: hash1(o.variant + 14) < 0.5 ? -1 : 1, bottom: hash1(o.variant + 15) < 0.5 }));
    const cx = w / 2, cy = s.bottom ? h * 1.05 : h / 2, R = Math.hypot(w, h);
    const bt = beatTime(show);
    const rot = s.dir * (o.t * 0.15 + bt * 0.06);
    const span = TAU / s.n, width = span * (0.35 + 0.2 * show.beatPulse + 0.15 * show.bass);
    ctx.globalAlpha = 0.75 + 0.25 * show.beatPulse;
    for (let i = 0; i < s.n; i++) {
      const a0 = rot + i * span;
      ctx.fillStyle = i % 2 ? col.a : col.b;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a0 + width); ctx.closePath(); ctx.fill();
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.45);
    g.addColorStop(0, `rgba(255,255,255,${0.45 + 0.5 * show.beatPulse})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },

  // chevrons marching in or out of the centre
  chevrons(ctx, w, h, p, show, col, o) {
    const s = st(p, 'chevrons', () => ({ dir: hash1(o.variant + 16) < 0.5 ? 1 : -1, k: 0.3 + 0.15 * hash1(o.variant + 17), vertical: h > w * 1.3 }));
    const bt = beatTime(show);
    const W = s.vertical ? h : w, H = s.vertical ? w : h;
    const spacing = H * s.k * 1.2;
    const offset = frac(bt * 0.5 * s.dir) * spacing;
    const m = Math.ceil(W / 2 / spacing) + 2;
    ctx.save();
    if (s.vertical) { ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI / 2); ctx.translate(-h / 2, -w / 2); }
    ctx.lineWidth = 3 + 5 * show.beatPulse; ctx.globalAlpha = 0.95;
    for (let i = 0; i < m; i++) {
      const d = i * spacing + offset;
      for (const sgn of [-1, 1]) {
        const cx = W / 2 + sgn * d;
        ctx.strokeStyle = i % 2 ? col.a : col.b;
        ctx.beginPath(); ctx.moveTo(cx - sgn * spacing * 0.4, 0); ctx.lineTo(cx, H / 2); ctx.lineTo(cx - sgn * spacing * 0.4, H); ctx.stroke();
      }
    }
    ctx.restore();
    if (o.kickHit) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  },

  // hard-edged triangles flashing on hits (techno)
  shards(ctx, w, h, p, show, col, o) {
    const s = st(p, 'shards', () => ({ list: [] }));
    const t = o.t;
    const spawn = (n, c) => {
      for (let i = 0; i < n; i++) {
        const cx = hash1(t * 31 + i) * w, cy = hash1(t * 17 + i * 3) * h;
        const r = (0.25 + hash1(t + i * 7) * 0.6) * h, a = hash1(i + t * 3) * TAU, a2 = a + 0.4 + hash1(i + t * 9) * 0.8;
        s.list.push({ t0: t, life: 0.2 + 0.3 * hash1(i * 5 + t), c, pts: [[cx, cy], [cx + Math.cos(a) * r, cy + Math.sin(a) * r], [cx + Math.cos(a2) * r * 0.8, cy + Math.sin(a2) * r * 0.8]] });
      }
    };
    if (o.kickHit) spawn(show.phase === 'peak' ? 6 : 3, '#fff');
    if (o.snareHit) spawn(2, col.a);
    if (o.hatHit && s.list.length < 30) spawn(1, col.b);
    s.list = s.list.filter((x) => t - x.t0 < x.life);
    for (const x of s.list) {
      ctx.globalAlpha = 1 - (t - x.t0) / x.life; ctx.fillStyle = x.c;
      ctx.beginPath(); ctx.moveTo(x.pts[0][0], x.pts[0][1]); ctx.lineTo(x.pts[1][0], x.pts[1][1]); ctx.lineTo(x.pts[2][0], x.pts[2][1]); ctx.closePath(); ctx.fill();
    }
  },

  // filled concentric rings pumping outward, one per beat
  rings(ctx, w, h, p, show, col, o) {
    const s = st(p, 'rings', () => ({ n: 5 + ((hash1(o.variant + 18) * 4) | 0), oy: hash1(o.variant + 19) < 0.5 ? 0.5 : 1 }));
    const cx = w / 2, cy = h * s.oy, R = Math.hypot(w, h) * 0.6;
    const off = frac(beatTime(show) * 0.25);
    for (let k = 0; k < s.n; k++) {
      const f = frac(k / s.n + off);
      const r0 = Math.pow(f, 1.6) * R, r1 = Math.pow(Math.min(1, f + 0.5 / s.n), 1.6) * R;
      ctx.fillStyle = k % 2 ? col.a : col.b; ctx.globalAlpha = 0.85 + 0.15 * show.beatPulse;
      ctx.beginPath(); ctx.arc(cx, cy, r1, 0, TAU); ctx.arc(cx, cy, r0, 0, TAU, true); ctx.fill('evenodd');
    }
    if (show.kick > 0.5) { ctx.globalAlpha = show.kick * 0.6; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, h * 0.12, 0, TAU); ctx.fill(); }
  },

  // TV static, density follows energy, white bursts on kicks
  noise(ctx, w, h, p, show, col, o) {
    const s = st(p, 'noise', () => ({ img: ctx.createImageData(w, h), tint: hash1(o.variant + 20) < 0.5 }));
    const d = s.img.data;
    const thr = clamp01(0.55 + 0.35 * (1 - show.energy) - 0.3 * show.kick);
    const r = s.tint ? col.ar[0] / 255 : 1, g = s.tint ? col.ar[1] / 255 : 1, b = s.tint ? col.ar[2] / 255 : 1;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random();
      const lum = v > thr ? 255 : v > thr - 0.15 ? 55 : 0;
      d[i] = lum * r; d[i + 1] = lum * g; d[i + 2] = lum * b; d[i + 3] = 255;
    }
    ctx.putImageData(s.img, 0, 0);
    if (show.snare > 0.5) { ctx.globalAlpha = show.snare; ctx.fillStyle = '#fff'; ctx.fillRect(0, hash1(o.t * 50) * h, w, 3); }
  },

  // warp-speed starfield, speed follows energy and kicks
  starfield(ctx, w, h, p, show, col, o) {
    const s = st(p, 'starfield', () => {
      const n = Math.max(60, Math.round((w * h) / 55)), stars = [];
      for (let i = 0; i < n; i++) stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });
      return { stars };
    });
    const cx = w / 2, cy = h / 2;
    const hot = show.phase === 'drop' || show.phase === 'peak';
    const spd = (0.12 + 0.5 * show.energy + (hot ? 1.2 : 0.3) * show.beatPulse) * o.dt;
    for (const q of s.stars) {
      q.z -= spd;
      if (q.z <= 0.02) { q.x = Math.random() * 2 - 1; q.y = Math.random() * 2 - 1; q.z = 1; }
      const k = 1 / q.z;
      const x = cx + q.x * k * w * 0.5, y = cy + q.y * k * h * 0.5;
      if (x < 0 || x >= w || y < 0 || y >= h) { q.z = 1; q.x = Math.random() * 2 - 1; q.y = Math.random() * 2 - 1; continue; }
      ctx.globalAlpha = clamp01(1.2 - q.z);
      ctx.fillStyle = q.x > 0.35 ? col.a : q.x < -0.35 ? col.b : '#fff';
      const sz = 1 + (1 - q.z) * 2.5;
      ctx.fillRect(x, y, sz, sz);
    }
  },

  // synthwave grid + sun
  grid(ctx, w, h, p, show, col, o) {
    const horizon = h * 0.42;
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, '#000'); g.addColorStop(1, col.b);
    ctx.fillStyle = g; ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, w, horizon);
    ctx.globalAlpha = 1;
    const sr = h * 0.16 * (1 + 0.3 * show.bass);
    ctx.fillStyle = col.a; ctx.beginPath(); ctx.arc(w / 2, horizon, sr, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#000';
    for (let i = 0; i < 4; i++) { const y = horizon - sr + frac(o.t * 0.3 + i / 4) * sr; ctx.fillRect(w / 2 - sr, y, sr * 2, 1 + i * 0.5); }
    ctx.strokeStyle = col.a; ctx.lineWidth = 1.5;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.05, horizon); ctx.lineTo(w / 2 + i * w * 0.3, h); ctx.stroke(); }
    const bt = beatTime(show);
    for (let k = 0; k < 8; k++) {
      const f = frac(k / 8 + bt * 0.125);
      const y = horizon + Math.pow(f, 2.2) * (h - horizon);
      ctx.globalAlpha = f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    if (o.kickHit) { ctx.globalAlpha = 0.35; ctx.fillStyle = col.c; ctx.fillRect(0, horizon, w, h - horizon); }
  },

  // random bars strobing at the director's strobe rate (techno)
  strobeBars(ctx, w, h, p, show, col, o) {
    const s = st(p, 'strobeBars', () => ({ n: 8 + ((hash1(o.variant + 22) * 8) | 0), vertical: hash1(o.variant + 23) < 0.7, last: -1, seq: 0 }));
    const rate = Math.max(3, show.strobeRate || 0);
    const step = Math.floor(o.t * rate);
    if (step !== s.last) { s.last = step; s.seq = Math.floor(hash1(step) * 8); }
    const hot = show.phase === 'drop' || show.phase === 'peak';
    for (let i = 0; i < s.n; i++) {
      const on = show.kick > 0.7 || hash1(s.seq * 31 + i * 7 + step) < (hot ? 0.4 : 0.25);
      if (!on) continue;
      ctx.fillStyle = i % 3 === 0 ? col.a : '#fff'; ctx.globalAlpha = (hot ? 1 : 0.6) * (0.6 + 0.4 * hash1(i + step));
      if (s.vertical) ctx.fillRect((i * w) / s.n + 1, 0, w / s.n - 2, h);
      else ctx.fillRect(0, (i * h) / s.n + 1, w, h / s.n - 2);
    }
  },

  // sweeping scan lines, ping-pong over two beats
  scan(ctx, w, h, p, show, col, o) {
    const s = st(p, 'scan', () => ({ lines: 1 + ((hash1(o.variant + 24) * 2) | 0), vertical: hash1(o.variant + 25) < 0.5 }));
    const bt = beatTime(show);
    const L = s.vertical ? h : w;
    const n = s.lines + (show.phase === 'peak' ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const ph = frac(bt * 0.25 + i / n);
      const pp = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const pos = easeInOut(pp) * L;
      const th = 2 + 3 * show.bass;
      ctx.fillStyle = i === 0 ? '#fff' : col.a; ctx.globalAlpha = 0.9;
      if (s.vertical) ctx.fillRect(0, pos - th / 2, w, th); else ctx.fillRect(pos - th / 2, 0, th, h);
    }
    if (o.kickHit) { ctx.globalAlpha = 0.6; ctx.fillStyle = col.b; ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, h - 3, w, 3); ctx.fillRect(0, 0, 3, h); ctx.fillRect(w - 3, 0, 3, h); }
  },

  // rising embers / falling sparks
  particles(ctx, w, h, p, show, col, o) {
    const s = st(p, 'particles', () => ({ list: [], up: hash1(o.variant + 26) < 0.7 }));
    const t = o.t, dt = o.dt;
    const spawn = (n, c, spd) => {
      for (let i = 0; i < n && s.list.length < 400; i++) {
        s.list.push({ x: Math.random() * w, y: s.up ? h + 2 : -2, vx: (Math.random() - 0.5) * 20, vy: (s.up ? -1 : 1) * spd * (0.5 + Math.random()), life: 1.2 + Math.random(), age: 0, c, sz: 1 + Math.random() * 2 });
      }
    };
    spawn(Math.round(1 + 5 * show.energy), col.a, h * 0.25);
    if (o.kickHit) spawn(24, '#fff', h * 0.6);
    if (o.snareHit) spawn(12, col.b, h * 0.5);
    for (const q of s.list) { q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx += Math.sin(t * 3 + q.y * 0.1) * 10 * dt; }
    s.list = s.list.filter((q) => q.age < q.life && q.y > -4 && q.y < h + 4);
    for (const q of s.list) { ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.sz, q.sz); }
  },

  // parallel lines drifting on the grid (minimal techno)
  lines(ctx, w, h, p, show, col, o) {
    const s = st(p, 'lines', () => ({ orient: (hash1(o.variant + 27) * 3) | 0, n: 5 + ((hash1(o.variant + 28) * 6) | 0), dir: hash1(o.variant + 29) < 0.5 ? 1 : -1 }));
    const bt = beatTime(show);
    const L = Math.hypot(w, h), spacing = L / s.n, off = frac(bt * 0.25 * s.dir) * spacing;
    ctx.save(); ctx.translate(w / 2, h / 2);
    if (s.orient === 1) ctx.rotate(Math.PI / 2); else if (s.orient === 2) ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = 0.85;
    for (let i = -s.n; i <= s.n; i++) {
      const x = i * spacing + off;
      const th = 1 + 3 * show.bass + (i % 2 === 0 ? 2 * show.beatPulse : 0);
      ctx.fillStyle = i % 2 ? col.a : '#fff';
      ctx.fillRect(x - th / 2, -L, th, L * 2);
    }
    ctx.restore();
    if (o.snareHit) { ctx.globalAlpha = 0.3; ctx.fillStyle = col.b; ctx.fillRect(0, 0, w, h); }
  },

  // datamosh: colour blocks + displaced slices
  glitch(ctx, w, h, p, show, col, o) {
    const s = st(p, 'glitch', () => ({ q: -1, blocks: [] }));
    const q = Math.floor(o.t * 20);
    const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, col.a); g.addColorStop(1, col.b);
    ctx.globalAlpha = 0.5; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (q !== s.q) {
      s.q = q; s.blocks = [];
      const n = 4 + Math.floor(show.energy * 10 + show.kick * 8);
      for (let i = 0; i < n; i++) s.blocks.push({ x: hash1(q + i) * w, y: hash1(q * 3 + i) * h, w: hash1(q * 7 + i) * w * 0.5, h: hash1(q * 11 + i) * h * 0.25, c: [col.a, col.b, col.c, '#fff', '#000'][(hash1(q * 13 + i) * 5) | 0] });
    }
    ctx.globalAlpha = 0.9;
    for (const b of s.blocks) { ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.w, b.h); }
    const amt = 0.2 + show.kick * 0.8 + show.snare * 0.5, n = 6;
    ctx.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      if (hash1(q * 17 + i) > amt) continue;
      const dx = (hash1(q * 19 + i) - 0.5) * w * 0.3;
      ctx.drawImage(ctx.canvas, 0, (i * h) / n, w, h / n, dx, (i * h) / n, w, h / n);
    }
    if (show.kick > 0.6) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3; ctx.drawImage(ctx.canvas, 3, 0); ctx.drawImage(ctx.canvas, -3, 0); ctx.globalCompositeOperation = 'source-over'; }
  },

  // soft additive blobs (house / tropical)
  blobs(ctx, w, h, p, show, col, o) {
    const s = st(p, 'blobs', () => {
      const n = 5 + ((hash1(o.variant + 30) * 4) | 0), b = [];
      for (let i = 0; i < n; i++) b.push({ px: hash1(i + 1), py: hash1(i * 3 + 2), sx: 0.4 + hash1(i * 5 + 3), sy: 0.4 + hash1(i * 7 + 4), c: i % 3 });
      return { b };
    });
    const t = o.t * 0.6;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of s.b) {
      const x = w * (0.5 + 0.42 * Math.sin(t * b.sx + b.px * TAU));
      const y = h * (0.5 + 0.4 * Math.cos(t * b.sy + b.py * TAU));
      const r = h * (0.25 + 0.15 * show.bass + 0.1 * show.beatPulse);
      const c = b.c === 0 ? col.ar : b.c === 1 ? col.br : col.cr;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, 0.9)); g.addColorStop(1, rgba(c, 0));
      ctx.globalAlpha = 0.9; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  // disco floor tiles re-rolled every 8th note
  disco(ctx, w, h, p, show, col, o) {
    const s = st(p, 'disco', () => ({ cols: w >= 120 ? 16 : 8, rows: h >= 60 ? 8 : h >= 30 ? 4 : 2, last: -1, tiles: null }));
    const n = s.cols * s.rows;
    if (!s.tiles) s.tiles = new Float32Array(n);
    const step = show.beatIndex * 2 + (show.beatPhase > 0.5 ? 1 : 0);
    if (step !== s.last) { s.last = step; for (let i = 0; i < n; i++) s.tiles[i] = hash1(step * 7 + i * 3); }
    const tw = w / s.cols, th = h / s.rows;
    for (let i = 0; i < n; i++) {
      const v = s.tiles[i];
      const x = (i % s.cols) * tw, y = Math.floor(i / s.cols) * th;
      ctx.fillStyle = v < 0.33 ? col.a : v < 0.66 ? col.b : col.c;
      ctx.globalAlpha = clamp01(0.3 + 0.6 * ((v * 7) % 1) * (0.5 + 0.5 * show.beatPulse) + 0.2 * show.energy);
      ctx.fillRect(x + 1, y + 1, tw - 2, th - 2);
    }
    const sx = frac(beatTime(show) * 0.125) * (w + 40) - 20;
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(sx - 10, 0, 20, h);
  },

  // retro sun with horizon bands
  sun(ctx, w, h, p, show, col, o) {
    const s = st(p, 'sun', () => ({ bands: 6 + ((hash1(o.variant + 31) * 6) | 0) }));
    const cx = w / 2, cy = h * 0.6 - show.energy * h * 0.08;
    const r = h * (0.36 + 0.06 * show.bass + 0.05 * show.beatPulse);
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#000'); bg.addColorStop(1, rgba(col.cr, 0.5));
    ctx.fillStyle = bg; ctx.globalAlpha = 1; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
    for (let i = 0; i < 20; i++) { const tw = 0.5 + 0.5 * Math.sin(o.t * 2 + i * 1.7); ctx.globalAlpha = 0.3 * tw; ctx.fillRect(hash1(i) * w, hash1(i * 3 + 1) * cy * 0.6, 1, 1); }
    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r); g.addColorStop(0, col.a); g.addColorStop(1, col.b);
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#000';
    const bt = beatTime(show);
    for (let i = 0; i < s.bands; i++) { const f = frac(i / s.bands + bt * 0.125); ctx.fillRect(cx - r, cy + f * r, r * 2, 1 + f * 4); }
    ctx.globalAlpha = 0.3; ctx.fillStyle = col.b; ctx.fillRect(0, cy + r * 0.9, w, h);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(0, cy + r * 0.9, w, 1);
  },

  // lissajous tracer with long trails
  figure(ctx, w, h, p, show, col, o) {
    const s = st(p, 'figure', () => ({ a: 1 + ((hash1(o.variant + 32) * 3) | 0), b: 2 + ((hash1(o.variant + 33) * 3) | 0), ph: hash1(o.variant + 34) * TAU }));
    const T = beatTime(show) * 0.25 * TAU;
    const cx = w / 2, cy = h / 2, rx = w * 0.42, ry = h * 0.42;
    const segs = 24, span = 0.6 + show.energy;
    const trace = (a, b, ph, c) => {
      ctx.strokeStyle = c; ctx.lineWidth = 2 + 3 * show.bass; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const u = T - span + (i / segs) * span;
        const x = cx + Math.sin(a * u + ph) * rx, y = cy + Math.sin(b * u) * ry;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      const hx = cx + Math.sin(a * T + ph) * rx, hy = cy + Math.sin(b * T) * ry;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 2 + 3 * show.beatPulse, 0, TAU); ctx.fill();
    };
    trace(s.a, s.b, s.ph, col.a);
    trace(s.a, s.b, s.ph + Math.PI, col.b);
  },

  // rotating n-fold petal mandala (psy)
  mandala(ctx, w, h, p, show, col, o) {
    const s = st(p, 'mandala', () => ({ n: 6 + 2 * ((hash1(o.variant + 35) * 4) | 0), dir: hash1(o.variant + 36) < 0.5 ? 1 : -1 }));
    const bt = beatTime(show);
    const one = (cx, cy, R) => {
      ctx.save(); ctx.translate(cx, cy);
      for (let l = 0; l < 3; l++) {
        const rot = s.dir * (l % 2 ? -1 : 1) * (bt * 0.04 * TAU + o.t * 0.1);
        const r = R * (1 - l * 0.28) * (1 + 0.08 * show.beatPulse);
        const c = [col.a, col.b, col.c][l];
        ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.5 + show.bass * 2; ctx.globalAlpha = 0.85;
        ctx.save(); ctx.rotate(rot);
        for (let i = 0; i < s.n; i++) {
          ctx.save(); ctx.rotate((i / s.n) * TAU);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.5, -r * 0.18); ctx.lineTo(r, 0); ctx.lineTo(r * 0.5, r * 0.18); ctx.closePath();
          if (l === 1) ctx.fill(); else ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    };
    if (w > h * 1.6) { one(w / 2, h / 2, h * 0.5); one(w / 2 - h * 1.05, h / 2, h * 0.36); one(w / 2 + h * 1.05, h / 2, h * 0.36); }
    else if (h > w * 1.6) { one(w / 2, h / 2, w * 0.5); one(w / 2, h / 2 - w * 1.05, w * 0.36); one(w / 2, h / 2 + w * 1.05, w * 0.36); }
    else one(w / 2, h / 2, Math.min(w, h) * 0.5);
  },

  // hex tiles lighting in waves
  hexes(ctx, w, h, p, show, col, o) {
    const s = st(p, 'hexes', () => {
      const r = Math.max(4, Math.round(Math.min(w, h) / 7)), cells = [];
      const dx = r * 1.732, dy = r * 1.5;
      for (let row = -1; row * dy < h + r; row++) for (let c = -1; c * dx < w + r; c++) {
        const x = c * dx + (row % 2 ? dx / 2 : 0), y = row * dy;
        cells.push({ x, y, d: Math.hypot(x - w / 2, y - h / 2) / Math.hypot(w / 2, h / 2), rnd: hash1(row * 13 + c * 7 + 1) });
      }
      return { r, cells, mode: (hash1(o.variant + 37) * 3) | 0 };
    });
    const bt = beatTime(show), r = s.r * 0.9;
    for (const c of s.cells) {
      let v;
      if (s.mode === 0) v = 1 - frac(bt * 0.25 - c.d);
      else if (s.mode === 1) v = hash1(Math.floor(bt * 2) * 5 + c.rnd * 100);
      else v = 1 - frac(c.x / w - bt * 0.125);
      v = Math.pow(v, 3);
      const lit = v * (0.5 + 0.5 * show.energy) + show.kick * 0.35 * c.rnd;
      if (lit < 0.05) continue;
      ctx.fillStyle = c.rnd < 0.5 ? col.a : col.b; ctx.globalAlpha = Math.min(1, lit);
      hexPath(ctx, c.x, c.y, r); ctx.fill();
    }
  },
};

export const PROGRAM_NAMES = Object.keys(PROGRAMS);

// energy: how hard the program reads (used to match programs to phases); trail: frame persistence
export const PROGRAM_INFO = {
  wash: { energy: 0.2, trail: 0 }, aurora: { energy: 0.2, trail: 0 }, waves: { energy: 0.35, trail: 0.3 }, blobs: { energy: 0.3, trail: 0 },
  starfield: { energy: 0.45, trail: 0.3 }, figure: { energy: 0.3, trail: 0.12 }, sun: { energy: 0.35, trail: 0 }, lines: { energy: 0.5, trail: 0 },
  text: { energy: 0.3, trail: 0 }, logo: { energy: 0.5, trail: 0 }, bars: { energy: 0.55, trail: 0 }, pulse: { energy: 0.55, trail: 0.35 },
  tunnel: { energy: 0.7, trail: 0 }, chevrons: { energy: 0.8, trail: 0.35 }, rays: { energy: 0.8, trail: 0 }, flash: { energy: 0.9, trail: 0.4 },
  shards: { energy: 0.85, trail: 0.3 }, rings: { energy: 0.7, trail: 0 }, noise: { energy: 0.9, trail: 0 }, grid: { energy: 0.5, trail: 0 },
  strobeBars: { energy: 0.95, trail: 0.5 }, scan: { energy: 0.6, trail: 0.25 }, particles: { energy: 0.5, trail: 0.25 }, glitch: { energy: 0.85, trail: 0 },
  disco: { energy: 0.6, trail: 0 }, mandala: { energy: 0.6, trail: 0.2 }, hexes: { energy: 0.65, trail: 0.2 },
  logoTile: { energy: 0.6, trail: 0, needsLogo: true }, logoBurst: { energy: 0.8, trail: 0.3, needsLogo: true },
};

// programs that read well with the real logo floating over them (stage.logoOverlay)
const OVERLAY_OK = new Set(['rays', 'tunnel', 'rings', 'mandala', 'sun', 'disco', 'hexes', 'aurora', 'waves', 'starfield', 'particles', 'blobs', 'wash', 'grid', 'scan']);

// the logo's soft glow, fitted like the logo itself (the glow canvas carries a 24 px margin)
function drawGlow(ctx, e, w, h, color, k = 1) {
  const [x, y, dw, dh] = imageRect(e, w, h, k);
  const sc = dw / e.w;
  ctx.drawImage(e.glowTint(color), w / 2 + x - 24 * sc, h / 2 + y - 24 * sc, e.glow.width * sc, e.glow.height * sc);
}

const DIM = { idle: 0.25, intro: 0.55, groove: 0.85, build: 0.9, drop: 1, peak: 1, breakdown: 0.6 };

// one-frame hit flags derived from the director grid, tracked per panel
function hits(panel, show, o) {
  const tk = panel._tk || (panel._tk = { bp: 0 });
  o.kickHit = !!(show.beat && show.kickOn);
  o.snareHit = !!(show.beat && show.snareOn && (show.beatInBar === 1 || show.beatInBar === 3));
  o.hatHit = !!(show.hatOn && tk.bp < 0.5 && show.beatPhase >= 0.5);
  tk.bp = show.beatPhase;
}

export function drawProgram(ctx, w, h, panel, show, col, o) {
  const prog = PROGRAMS[panel.program] ? panel.program : 'wash';
  const info = PROGRAM_INFO[prog] || {};
  const ph = show.phase;
  o.t = show.t; o.dt = show.dt || 0.016;
  hits(panel, show, o);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const trail = info.trail || 0;
  ctx.fillStyle = trail > 0 ? `rgba(0,0,0,${trail})` : '#000';
  ctx.fillRect(0, 0, w, h);
  PROGRAMS[prog](ctx, w, h, panel, show, col, o);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  // the real logo floating over a content program (breakdown / peak phrases), on a dark halo so it reads
  const ov = o.logoOverlay || 0;
  if (ov > 0.02 && o.logoImg && OVERLAY_OK.has(prog) && (panel.role === 'main' || panel.role === 'holo' || panel.role === 'wing')) {
    const e = o.logoImg, k = 0.7 * (1 + 0.05 * show.beatPulse);
    const halo = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.4);
    halo.addColorStop(0, `rgba(0,0,0,${0.6 * ov})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * ov;
    drawGlow(ctx, e, w, h, col.a, k);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ov;
    const [x, y, dw, dh] = imageRect(e, w, h, k);
    ctx.drawImage(e.tint(ph === 'drop' || ph === 'peak' ? '#ffffff' : col.b), w / 2 + x, h / 2 + y, dw, dh);
    ctx.globalAlpha = 1;
  }
  const dim = DIM[ph] ?? 1;
  if (dim < 1) { ctx.globalAlpha = 1 - dim; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  // wall strobe — kept off logo/text so the mark reads; scaled by the artist's taste for white
  const white = o.white == null ? 0.5 : o.white;
  if (prog !== 'logo' && prog !== 'text' && prog !== 'logoBurst' && white > 0.05) {
    let a = 0;
    if (ph === 'drop' && show.strobe >= 0.99) a = frac(show.t * 12) < 0.5 ? 0.7 : 0;
    else if (ph === 'build' && show.buildProgress > 0.7) a = frac(show.t * Math.max(4, show.strobeRate)) < 0.5 ? ((show.buildProgress - 0.7) / 0.3) * 0.5 : 0;
    if (a > 0) { ctx.globalAlpha = a * white; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  }
  const dip = show.dip || 0;
  if (dip > 0) { ctx.globalAlpha = Math.min(0.85, dip * 0.85); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  if (show.whiteout > 0) { ctx.globalAlpha = Math.min(1, show.whiteout); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.globalAlpha = 1;
}
