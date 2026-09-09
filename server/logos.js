// Artist logo fetcher with a disk cache.
//  GET /logo?artist=<name>           -> image (PNG/SVG/JPEG) + X-Logo-Kind / X-Logo-Source headers, or 404
//  GET /logo?artist=<name>&meta=1    -> cache metadata as JSON
//
// Sources, in order (all public, no API keys):
//  1. TheAudioDB  — strArtistLogo (transparent wordmark), then strArtistClearart / strArtistCutout
//  2. Wikidata    — the artist item's P154 (logo image) claim, rendered by Wikimedia Commons
//  3. Commons     — file search "<artist> logo" (svg/png whose title contains the artist name)
// Misses are cached too (7 days) so an unknown artist doesn't trigger three lookups per song.

import fs from 'node:fs';
import path from 'node:path';

const UA = 'Virtual-Fest/1.0 (local festival visualiser; node fetch)';
const MISS_TTL = 7 * 24 * 3600e3;
const MAX_BYTES = 8e6;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const MUSIC = /\b(dj|disc jockey|musician|producer|band|duo|trio|group|singer|songwriter|composer|artist|project|remixer|rapper|collective)\b/i;

export function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';
}

// "Martin Garrix, Dua Lipa" / "Alesso & Tove Lo" / "Tiësto feat. …" -> primary artist
export function primaryArtist(name) {
  return String(name || '').split(/,|&| x |feat\.?|ft\.?|\bvs\.?\b|\bwith\b/i)[0].replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function getImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT[ct]) throw new Error(`not an image (${ct}) ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200 || buf.length > MAX_BYTES) throw new Error(`bad size ${buf.length} ${url}`);
  return { buf, ct };
}

const commonsPath = (file) => 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file.replace(/ /g, '_')) + '?width=640';

async function fromAudioDB(name) {
  const j = await getJSON('https://www.theaudiodb.com/api/v1/json/2/search.php?s=' + encodeURIComponent(name));
  const out = [];
  for (const a of j?.artists || []) {
    if (slugify(a.strArtist) !== slugify(name)) continue;
    for (const [kind, url] of [['logo', a.strArtistLogo], ['clearart', a.strArtistClearart], ['cutout', a.strArtistCutout]]) {
      if (url) out.push({ kind, url, source: 'theaudiodb', name: a.strArtist });
    }
  }
  return out;
}

async function fromWikidata(name) {
  const j = await getJSON('https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' + encodeURIComponent(name) + '&language=en&format=json&type=item&limit=6');
  const sl = slugify(name), out = [];
  for (const e of j?.search || []) {
    if (!MUSIC.test(e.description || '')) continue;
    if (slugify(e.label) !== sl && !(e.aliases || []).some((a) => slugify(a) === sl)) continue;
    const c = await getJSON('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=' + e.id + '&property=P154&format=json');
    const f = c?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
    if (f) out.push({ kind: 'logo', url: commonsPath(f), source: 'wikidata', name: e.label });
  }
  return out;
}

// Commons full-text search is the loosest source: a one-word artist name ("Fisher", "Cash") matches company logos
// too, so every candidate file must also be categorised / described as something musical before it counts.
const MUSICAL = /\b(dj|djs|disc jockey|musician|musicians|music|band|bands|record label|producer|producers|electronic|edm|singer|singers|rapper|artist|artists|album|discography|festival)\b/i;
async function fromCommons(name) {
  const j = await getJSON('https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent('"' + name + '" logo') + '&srnamespace=6&format=json&srlimit=10');
  const sl = slugify(name), out = [];
  for (const r of j?.query?.search || []) {
    const t = r.title.replace(/^File:/, '');
    if (!/\.(svg|png)$/i.test(t) || !/logo/i.test(t) || !slugify(t).includes(sl)) continue;
    const m = await getJSON('https://commons.wikimedia.org/w/api.php?action=query&titles=' + encodeURIComponent(r.title) + '&prop=categories|imageinfo&iiprop=extmetadata&cllimit=50&format=json');
    const page = Object.values(m?.query?.pages || {})[0] || {};
    const cats = (page.categories || []).map((c) => c.title).join(' ');
    const ext = page.imageinfo?.[0]?.extmetadata || {};
    const desc = [cats, ext.ImageDescription?.value, ext.Categories?.value, ext.ObjectName?.value].filter(Boolean).join(' ').replace(/<[^>]+>/g, ' ');
    if (!MUSICAL.test(desc)) continue;
    out.push({ kind: 'logo', url: commonsPath(t), source: 'commons', name });
  }
  return out;
}

/** resolve + download; returns { found, kind, source, url, file, ct, name } (never throws) */
export async function resolveLogo(name, cacheDir) {
  const slug = slugify(name);
  const tried = [];
  for (const src of [fromAudioDB, fromWikidata, fromCommons]) {
    let cands = [];
    try { cands = await src(name); } catch (e) { tried.push(`${src.name}: ${e.message}`); continue; }
    for (const c of cands) {
      try {
        const { buf, ct } = await getImage(c.url);
        const file = `${slug}.${EXT[ct]}`;
        fs.writeFileSync(path.join(cacheDir, file), buf);
        return { found: true, kind: c.kind, source: c.source, url: c.url, file, ct, name: c.name, bytes: buf.length, ts: Date.now() };
      } catch (e) { tried.push(`${c.source}: ${e.message}`); }
    }
  }
  return { found: false, tried, ts: Date.now() };
}

export function createLogoHandler(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const inflight = new Map();
  const metaPath = (slug) => path.join(cacheDir, slug + '.json');
  const readMeta = (slug) => { try { return JSON.parse(fs.readFileSync(metaPath(slug), 'utf8')); } catch { return null; } };

  async function lookup(name) {
    const slug = slugify(name);
    const m = readMeta(slug);
    if (m?.found && fs.existsSync(path.join(cacheDir, m.file))) return m;
    if (m && !m.found && Date.now() - m.ts < MISS_TTL) return m;
    if (inflight.has(slug)) return inflight.get(slug);
    const p = resolveLogo(name, cacheDir).then((r) => {
      r.artist = name;
      fs.writeFileSync(metaPath(slug), JSON.stringify(r, null, 1));
      return r;
    }).finally(() => inflight.delete(slug));
    inflight.set(slug, p);
    return p;
  }

  return async function handleLogo(req, res, artist, wantMeta) {
    const name = primaryArtist(artist);
    if (!name) { res.writeHead(400); return res.end('artist required'); }
    let m;
    try { m = await lookup(name); } catch (e) { res.writeHead(500); return res.end(String(e)); }
    if (wantMeta) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify(m)); }
    if (!m.found) { res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }); return res.end(JSON.stringify({ found: false, artist: name })); }
    res.writeHead(200, { 'Content-Type': m.ct, 'Cache-Control': 'public, max-age=86400', 'X-Logo-Kind': m.kind, 'X-Logo-Source': m.source, 'X-Logo-Name': encodeURIComponent(m.name || name) });
    fs.createReadStream(path.join(cacheDir, m.file)).pipe(res);
  };
}
