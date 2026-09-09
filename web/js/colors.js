// Small colour helpers shared by the palette variety code (artists.js), the album-art extractor (palette.js)
// and the director's per-phase colour treatment. Pure functions on '#rrggbb' strings / {h,s,l} (h in turns).

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(r, g, b) {
  const c = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}
export function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export const hexToHsl = (hex) => rgbToHsl(...hexToRgb(hex));
export const hslToHex = (h, s, l) => rgbToHex(...hslToRgb(h, s, l));
export const hueDist = (a, b) => { const d = Math.abs((((a - b) % 1) + 1) % 1); return Math.min(d, 1 - d); };
// neutral = white / grey / black: those are brand anchors (SHM white, techno grey) and never get hue-shifted
export const isNeutral = (hex) => { const c = hexToHsl(hex); return c.s < 0.2 || c.l < 0.12 || c.l > 0.93; };
export function shiftHue(hex, turns) { if (isNeutral(hex)) return hex; const c = hexToHsl(hex); return hslToHex(c.h + turns, c.s, c.l); }
export function saturate(hex, k) { const c = hexToHsl(hex); if (isNeutral(hex)) return hex; return hslToHex(c.h, Math.min(1, c.s * k), c.l); }
// stage-friendly version of a hue: vivid, not too dark (LED walls + beams need brightness)
export const vivid = (h, l = 0.55) => hslToHex(h, 0.95, l);
// a palette key that ignores order, for "don't repeat the last song" checks
export const paletteKey = (hexes) => hexes.map((h) => h.toLowerCase()).sort().join(',');
