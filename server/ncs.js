// NoCopyrightSounds catalog for the server: scrapes the public release list at ncs.io/music into cache/ncs/catalog.json
// (weekly, in the background), serves it at /ncs/catalog for the browser matcher (web/js/ncs.js), and answers
// /ncs?title=&artist=&album= for debugging. The bundled snapshot web/data/ncs.json seeds the cache and stays the
// browser's fallback, so the app works without the network.

import fs from 'node:fs';
import path from 'node:path';
import { createMatcher } from '../web/js/ncs.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const REFRESH_MS = 7 * 86400e3;   // a week between scrapes
const CHECK_MS = 6 * 3600e3;      // how often the catalog age is checked
const MAX_PAGES = 400;
const MIN_TRACKS = 500;           // a smaller result means the page layout changed: keep what we have

const ent = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** every release listed on ncs.io/music -> {source, fetched, count, tracks:[{t, a, g, id, v}]} */
export async function scrapeCatalog(log = () => {}) {
  const seen = new Map();
  let pages = 0, empty = 0;
  for (let p = 1; p <= MAX_PAGES; p++) {
    let html = null;
    for (let attempt = 0; attempt < 3 && html == null; attempt++) {
      try {
        const r = await fetch(`https://ncs.io/music?page=${p}`, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        html = await r.text();
      } catch (e) { log(`ncs.io page ${p} attempt ${attempt + 1}: ${e.message || e}`); await sleep(1500); }
    }
    if (html == null) throw new Error(`ncs.io page ${p} unreachable`);
    pages++;
    let added = 0;
    // each release is a play button carrying data-* attributes (data-artist nests markup, so split on the button class)
    const parts = html.split(/class="btn [a-z]+ player-play"/); parts.shift();
    for (const tag of parts) {
      const at = {};
      for (const a of tag.matchAll(/data-(tid|track|artistraw|genre|versions)="([^"]*)"/g)) if (!(a[1] in at)) at[a[1]] = ent(a[2]);
      if (!at.tid || !at.track || seen.has(at.tid)) continue;
      seen.set(at.tid, { t: at.track, a: at.artistraw || '', g: at.genre || '', id: at.tid, v: at.versions || '' });
      added++;
    }
    if (added === 0) { if (++empty >= 2) break; } else empty = 0;
    await sleep(300);
  }
  const tracks = [...seen.values()];
  if (tracks.length < MIN_TRACKS) throw new Error(`ncs.io scrape too small (${tracks.length} tracks over ${pages} pages): page layout changed?`);
  return { source: 'https://ncs.io/music', fetched: new Date().toISOString(), count: tracks.length, tracks };
}

export function createNcs({ cacheDir, bundled }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, 'catalog.json');
  const read = (f) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(j?.tracks) ? j : null; } catch { return null; } };
  let catalog = read(cacheFile), origin = 'cache';
  if (!catalog) { catalog = read(bundled); origin = 'bundled'; }
  if (!catalog) { catalog = { source: '', fetched: '', count: 0, tracks: [] }; origin = 'none'; }
  let matcher = createMatcher(catalog), refreshing = null, lastError = '';
  const age = () => Date.now() - (Date.parse(catalog.fetched) || 0);
  const info = () => ({ tracks: catalog.count, fetched: catalog.fetched, origin, refreshing: !!refreshing, error: lastError || undefined });

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = scrapeCatalog((m) => console.warn(m)).then((c) => {
      // releases that left the site stay known (they were NCS releases): merge by id
      const byId = new Map(catalog.tracks.map((t) => [t.id, t]));
      for (const t of c.tracks) byId.set(t.id, t);
      const merged = { ...c, count: byId.size, tracks: [...byId.values()] };
      fs.writeFileSync(cacheFile, JSON.stringify(merged) + '\n');
      catalog = merged; origin = 'cache'; matcher = createMatcher(catalog); lastError = '';
      console.log(`NCS catalog refreshed: ${c.tracks.length} releases on ncs.io, ${merged.count} known`);
    }).catch((e) => { lastError = String(e.message || e); console.warn('NCS catalog refresh failed:', lastError); }).finally(() => { refreshing = null; });
    return refreshing;
  }

  const json = (res, body, extra = {}) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...extra }); res.end(JSON.stringify(body)); };
  return {
    info,
    refresh,
    match: (t) => matcher.match(t),
    /** refresh once the copy is a week old; checked every few hours */
    start() {
      const tick = () => { if (age() > REFRESH_MS) refresh(); };
      setTimeout(tick, 30e3).unref();
      setInterval(tick, CHECK_MS).unref();
    },
    handleCatalog(req, res) { json(res, catalog, { 'X-NCS-Origin': origin }); },
    handleMatch(req, res, u) {
      const q = (k) => u.searchParams.get(k) || '';
      const t = { name: q('title') || q('name'), artist: q('artist'), album: q('album'), albumArtist: q('albumArtist') };
      const m = matcher.match(t);
      json(res, { ncs: !!m, match: m, query: t, catalog: info() });
    },
  };
}
