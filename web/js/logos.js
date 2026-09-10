// Real artist logos for the LED walls.
// The local server resolves + caches them (/logo?artist=...; TheAudioDB, then Wikidata's official-logo claim,
// then Wikimedia Commons). Here each image becomes what the screen programs need: a trimmed white silhouette
// (alpha mask), a soft glow, and tinted copies on demand, so a real logo composites exactly like a procedural mark.

const MAX = 512;            // longest silhouette edge in px (LED canvases are 160 px wide at most)
const entries = new Map();  // slug -> Promise<entry|null>
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };

export function slugify(name) { return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
export function primaryArtist(name) { return String(name || '').split(/,|&| x |feat\.?|ft\.?|\bvs\.?\b|\bwith\b/i)[0].replace(/\s+/g, ' ').trim().slice(0, 80); }

// fit an entry's aspect into w x h (contain), scaled by k, centred -> [x, y, dw, dh]
export function fitRect(aspect, w, h, k = 1) {
  let dw = w * k, dh = dw / aspect;
  if (dh > h * k) { dh = h * k; dw = dh * aspect; }
  return [(w - dw) / 2, (h - dh) / 2, dw, dh];
}

// silhouette: alpha channel when the image has transparency, otherwise distance from the (corner-sampled) background
function silhouette(img, kind) {
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const src = canvas(w, h), sc = src.getContext('2d', { willReadFrequently: true });
  sc.drawImage(img, 0, 0, w, h);
  const d = sc.getImageData(0, 0, w, h), px = d.data, n = w * h;
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 24) transparent++;
  const alphaMode = transparent > n * 0.04;
  let bg = null;
  if (!alphaMode) {
    // background = average of the four corner patches
    const pick = (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const cs = [pick(1, 1), pick(w - 2, 1), pick(1, h - 2), pick(w - 2, h - 2)];
    bg = [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / 4);
  }
  const mask = new Uint8ClampedArray(n);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    const j = i * 4; let a;
    if (alphaMode) a = px[j + 3];
    else { const dist = Math.abs(px[j] - bg[0]) + Math.abs(px[j + 1] - bg[1]) + Math.abs(px[j + 2] - bg[2]); a = Math.min(255, Math.max(0, (dist - 40) * 3)); }
    mask[i] = a;
    if (a > 40) { const x = i % w, y = (i / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < minX || maxY - minY < 2 || maxX - minX < 2) return null;
  const pad = 2, bx = Math.max(0, minX - pad), by = Math.max(0, minY - pad), bw = Math.min(w, maxX + pad + 1) - bx, bh = Math.min(h, maxY + pad + 1) - by;
  // the raw colour image, trimmed (photo-like kinds are shown as they are)
  const photo = canvas(bw, bh);
  photo.getContext('2d').drawImage(src, bx, by, bw, bh, 0, 0, bw, bh);
  // white silhouette
  const sil = canvas(bw, bh), out = sil.getContext('2d').createImageData(bw, bh), o = out.data;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const a = mask[(y + by) * w + (x + bx)], k = (y * bw + x) * 4; o[k] = o[k + 1] = o[k + 2] = 255; o[k + 3] = a; }
  sil.getContext('2d').putImageData(out, 0, 0);
  // coverage: how much of the box the shape fills (dense marks get a smaller on-screen scale)
  let cov = 0; for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) cov += mask[(y + by) * w + (x + bx)];
  cov /= 255 * bw * bh;
  return { sil, photo, cov, kind };
}

function glowOf(sil) {
  const g = canvas(sil.width + 48, sil.height + 48), c = g.getContext('2d');
  c.filter = 'blur(9px)';
  c.drawImage(sil, 24, 24);
  c.filter = 'none';
  return g;
}

function buildEntry(img, name, kind, source) {
  const s = silhouette(img, kind);
  if (!s) return null;
  const tints = new Map();
  const e = {
    name, kind, source, photo: kind !== 'logo', w: s.sil.width, h: s.sil.height, aspect: s.sil.width / s.sil.height,
    sil: s.sil, img: s.photo, glow: glowOf(s.sil), cov: s.cov,
    // shape scale on a panel: dense/boxy marks sit smaller, thin wordmarks can fill the width
    scale: s.cov > 0.55 ? 0.62 : s.cov > 0.3 ? 0.72 : 0.84,
    tint(color) {
      if (this.photo) return this.img;
      let t = tints.get(color);
      if (!t) {
        if (tints.size > 16) tints.clear();
        t = canvas(this.w, this.h); const c = t.getContext('2d');
        c.fillStyle = color; c.fillRect(0, 0, this.w, this.h);
        c.globalCompositeOperation = 'destination-in'; c.drawImage(this.sil, 0, 0);
        tints.set(color, t);
      }
      return t;
    },
    glowTint(color) {
      const key = 'g:' + color;
      let t = tints.get(key);
      if (!t) {
        if (tints.size > 16) tints.clear();
        t = canvas(this.glow.width, this.glow.height); const c = t.getContext('2d');
        c.fillStyle = color; c.fillRect(0, 0, t.width, t.height);
        c.globalCompositeOperation = 'destination-in'; c.drawImage(this.glow, 0, 0);
        tints.set(key, t);
      }
      return t;
    },
  };
  return e;
}

async function fetchLogo(name) {
  const r = await fetch('/logo?artist=' + encodeURIComponent(name), { cache: 'force-cache' });
  if (!r.ok) return null;
  const blob = await r.blob();
  if (!/^image\//.test(blob.type)) return null;
  const kind = r.headers.get('X-Logo-Kind') || 'logo', source = r.headers.get('X-Logo-Source') || '';
  let img;
  try { img = await createImageBitmap(blob); }
  catch {
    // SVG (and the odd exotic PNG) via an <img>
    img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
    if (!img.width) { img.width = 512; img.height = 256; }
  }
  const e = buildEntry(img, name, kind, source);
  if (img.close) img.close();
  return e;
}

// an image shipped with the app (web/logos/*.png) as the same kind of entry; one request per URL per session
export function loadLogoUrl(url, name, kind = 'logo') {
  const key = 'url:' + url;
  let p = entries.get(key);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return null;
      const img = await createImageBitmap(await r.blob());
      const e = buildEntry(img, name, kind, 'bundled');
      if (img.close) img.close();
      return e;
    })().catch((e) => { console.warn('logo', url, e.message || e); return null; });
    entries.set(key, p);
  }
  return p;
}

// Promise of an entry (null when no logo exists); one request per artist per session
export function loadLogo(artist) {
  const name = primaryArtist(artist), slug = slugify(name);
  if (!slug) return Promise.resolve(null);
  let p = entries.get(slug);
  if (!p) {
    p = fetchLogo(name).catch((e) => { console.warn('logo', name, e.message || e); return null; });
    entries.set(slug, p);
  }
  return p;
}
