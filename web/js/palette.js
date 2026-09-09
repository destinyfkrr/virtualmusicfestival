// Extracts a vivid 3-colour lighting palette from album artwork.
import * as THREE from 'three';

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
  hues.push((hues[0] + 0.3 + Math.random() * 0.08) % 1);
  return hues.map(h => '#' + new THREE.Color().setHSL(h, 0.95, 0.55).getHexString());
}
