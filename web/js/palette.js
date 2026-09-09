// Extracts a vivid 3-colour lighting palette from album artwork, and merges it into the song's show palette.
import * as THREE from 'three';
import { hexToHsl, hueDist, isNeutral } from './colors.js';

export async function paletteFromArt(url) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = '/art?url=' + encodeURIComponent(url);
  });
  const N = 40;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const bins = new Array(24).fill(0);
  const col = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  let satTotal = 0;
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    col.getHSL(hsl);
    const weight = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 1.6);
    if (weight <= 0.05) continue;
    satTotal += weight;
    bins[Math.floor(hsl.h * 24) % 24] += weight;
  }
  if (satTotal < N * N * 0.04) return null; // artwork is basically greyscale → let caller pick a default
  const order = bins.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]);
  const hues = [];
  for (const [w, i] of order) {
    if (w <= 0) break;
    const h = (i + 0.5) / 24;
    if (hues.every(x => Math.min(Math.abs(x - h), 1 - Math.abs(x - h)) > 0.09)) hues.push(h);
    if (hues.length === 2) break;
  }
  if (!hues.length) return null;
  if (hues.length === 1) hues.push((hues[0] + 0.5) % 1);
  let hash = 0; for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  hues.push((hues[0] + 0.3 + (hash % 1000) / 1000 * 0.08) % 1); // deterministic per artwork
  return hues.map(h => '#' + new THREE.Color().setHSL(h, 0.95, 0.55).getHexString());
}

// Album art tints the show; it doesn't replace the artist's colours. Keeps the show palette's two lead
// colours, adds up to two artwork hues that aren't already represented (>25 degrees from every lead hue),
// then tops up from the remaining show colours. One song in three leads with the artwork colours instead.
export function mergeArtPalette(showPal, artPal, seed = 0) {
  if (!artPal || !artPal.length) return showPal;
  if (!showPal || showPal.length < 2) return artPal;
  const far = (hex, list) => list.every((x) => isNeutral(x) || isNeutral(hex) || hueDist(hexToHsl(x).h, hexToHsl(hex).h) > 0.07);
  const lead = showPal.slice(0, 2);
  const fromArt = artPal.filter((h) => far(h, lead)).slice(0, 2);
  const out = (seed % 3 === 0 && fromArt.length >= 2) ? fromArt.concat(lead) : lead.concat(fromArt);
  for (const h of showPal.slice(2)) { if (out.length >= 5) break; if (!out.includes(h) && far(h, out)) out.push(h); }
  if (out.length < 4 && !out.some(isNeutral)) out.push('#ffffff');
  return out;
}
