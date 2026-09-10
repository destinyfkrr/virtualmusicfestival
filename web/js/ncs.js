// NoCopyrightSounds (NCS) release detection.
// web/data/ncs.json is the NCS catalog scraped from the public release list at ncs.io/music (server/ncs.js refreshes it
// weekly into cache/ncs/catalog.json and serves it at /ncs/catalog; the bundled snapshot is the fallback). A track is an
// NCS release when its title (feat. / remix / edit qualifiers stripped) and at least one of its artists match a catalog
// entry, or when the album, album artist or title names NCS itself ("NCS: The Best of 2017" compilations). Pure module,
// no DOM: the server imports the same matcher for the /ncs debug route.

export const NCS_NAME = 'NoCopyrightSounds';
export const NCS_LOGO = '/logos/ncs.png';   // bundled (Wikimedia Commons, public domain): the NCS lockup, white on black

const HINT = /\b(ncs|nocopyrightsounds|no ?copyright ?sounds)\b/i;
// a bracket / dash qualifier that does not change which song it is
const QUAL = /\b(feat|ft|featuring|with|remix|mix|edit|version|ver|ncs|release|instrumental|sped ?up|slowed|extended|radio|vip|bootleg|rework|flip|cover|acoustic|live|remaster(ed)?|mashup|original|club|reprise)\b/i;

// early NCS releases that ncs.io no longer lists (artists who took their catalogue elsewhere), still NCS releases
const LEGACY = [
  ['Alan Walker', 'Fade'], ['Alan Walker', 'Spectre'], ['Alan Walker', 'Force'],
  ['Tobu', 'Candyland'], ['Tobu', 'Hope'], ['Tobu', 'Colors'], ['Tobu', 'Infectious'], ['Tobu', 'Roots'], ['Tobu', 'Sunburst'],
  ['Tobu', 'Higher'], ['Tobu', 'Life'], ['Tobu', 'Seven'], ['Tobu', 'Damn Son'], ['Tobu', 'Puzzle'], ['Tobu', 'Mesmerize'],
  ['Tobu', 'Sound of Goodbye'], ['Itro, Tobu', 'Cloud 9'], ['Tobu, Itro', 'Magic'], ['Itro, Tobu', 'Alive'],
  ['Ahrix', 'Nova'],
];

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019'`\u00b4]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** the song part of a title: "Sky High - Carpe Remix", "Heroes Tonight (feat. Johnning)", "Fade [NCS Release]" -> the song */
export function titleCore(title) {
  let t = String(title || '');
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, (m) => (QUAL.test(m) ? '' : m));   // "(feat. X)", "[NCS Release]", "(Carpe Remix)"; keeps "(In My Mind)"
  t = t.replace(/\s+-\s+.*$/, (m) => (QUAL.test(m) ? '' : m));              // Spotify's "Song - Carpe Remix" / "Song - Radio Edit"
  t = t.replace(/\s+(feat|ft|featuring)\.?\s+.*$/i, '');
  return norm(t);
}

// artist credits -> normalised names: whole comma-separated acts first ("Asketa & Natan Chaim"), then their parts
export function artistNames(credit) {
  const out = new Set();
  for (const part of String(credit || '').split(/,|\/|\bvs\.?\b/i)) {
    const n = norm(part);
    if (n.length >= 2) out.add(n);
    for (const p of n.split(/\s+(?:and|x)\s+/)) if (p.length >= 3 && p !== n) out.add(p);
  }
  return [...out];
}

/** matcher over a catalog {tracks:[{t: title, a: artists, g: genre, id}]}: match(track) -> {how, title, artist, genre, id} | null */
export function createMatcher(catalog) {
  const index = new Map();
  let size = 0;
  const add = (r) => { const core = titleCore(r.t); if (!core) return; let l = index.get(core); if (!l) index.set(core, l = []); l.push({ ...r, names: artistNames(r.a) }); size++; };
  for (const r of catalog?.tracks || []) add(r);
  for (const [a, t] of LEGACY) add({ t, a, g: '', id: 'legacy' });
  return {
    size,
    match(t) {
      if (!t || !t.name) return null;
      const core = titleCore(t.name), sp = ' ' + norm(t.artist) + ' ';
      for (const r of index.get(core) || []) {
        for (const nm of r.names) if (sp.includes(' ' + nm + ' ')) return { how: r.id === 'legacy' ? 'legacy' : 'catalog', title: r.t, artist: r.a, genre: r.g || '', id: r.id };
      }
      const hint = [t.album, t.albumArtist, t.name].find((s) => HINT.test(String(s || '')));
      if (hint) return { how: 'album', title: String(t.name || ''), artist: String(t.artist || ''), genre: '', id: '', hint: String(hint) };
      return null;
    },
  };
}

// browser: the catalog, once per session; the server's refreshed copy first, the bundled snapshot as the fallback
let catalogP = null;
export function loadNcsCatalog() {
  if (catalogP) return catalogP;
  const get = async (url) => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    const j = await r.json();
    if (!Array.isArray(j?.tracks)) throw new Error(url + ': not a catalog');
    return j;
  };
  catalogP = get('/ncs/catalog').catch(() => get('/data/ncs.json'))
    .catch((e) => { console.warn('NCS catalog unavailable:', e.message || e); return { tracks: [] }; })
    .then((j) => createMatcher(j));
  return catalogP;
}
