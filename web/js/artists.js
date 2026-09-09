// Artist + genre knowledge base for EDM shows.
//   - GENRES: lighting presets per sub-genre (bpm range, palettes, effect weighting, wall programs)
//   - ARTISTS: signature designs (palette, logo mark, stage centrepiece, effect preferences)
//   - resolveProfile(track): Spotify track -> effective show profile (artist match or genre inference)
//   - seedFromTrack(track) + SongRng: per-song deterministic randomness so every song gets its own show
// Logo marks are drawn procedurally (see marks.js) as geometric approximations; when the server finds the
// artist's real logo online (server/logos.js -> web/js/logos.js) the walls use that image instead.
//   - varyPalette(): per-song colour variety on top of an artist's signature palette (never the same look twice in a row)
import { hexToHsl, hslToHex, shiftHue, hueDist, isNeutral, vivid, paletteKey } from './colors.js';

// ------------------------------------------------------------------ genre presets
// style weights are 0..1 (>1 allowed for "signature" emphasis):
//   pyro flames/CO2/sparkulars/fireworks, lasers, strobes, beams, white (tendency to go white on drops),
//   dark (how dark the stage sits between hits), kinetic (moving set pieces), hits (pyro per drop)
const S = (o) => Object.assign({ pyro: 0.6, lasers: 0.6, strobes: 0.8, beams: 1, white: 0.5, dark: 0.35, kinetic: 0.6, logoRate: 0.7, artColors: true, rainbowLasers: false }, o);

export const GENRES = {
  bigroom:       { bpm: [126, 132], style: S({ pyro: 0.95, lasers: 0.7, strobes: 1, white: 0.7 }), palettes: [['#ffffff', '#ff2a2a', '#1e90ff'], ['#ffffff', '#ff8a00', '#2b5cff'], ['#ffd23f', '#ff2bd6', '#ffffff']], programs: ['chevrons', 'bars', 'tunnel', 'rays', 'flash', 'grid', 'logo'] },
  progressive:   { bpm: [124, 130], style: S({ pyro: 0.7, lasers: 0.6, white: 0.75 }), palettes: [['#ffffff', '#2bd7ff', '#ff9a3c'], ['#2b5cff', '#ffffff', '#ff5ac8'], ['#ffd27f', '#5ac8ff', '#ffffff']], programs: ['waves', 'rays', 'tunnel', 'aurora', 'chevrons', 'starfield', 'logo'] },
  house:         { bpm: [120, 128], style: S({ pyro: 0.4, lasers: 0.45, strobes: 0.6, white: 0.4, dark: 0.3 }), palettes: [['#ff5ac8', '#ffd23f', '#5ac8ff'], ['#ff8a1a', '#ff2bd6', '#ffffff'], ['#5ac8ff', '#ffffff', '#ff6a3c']], programs: ['disco', 'blobs', 'waves', 'bars', 'grid', 'rings', 'logo'] },
  techhouse:     { bpm: [124, 130], style: S({ pyro: 0.3, lasers: 0.6, strobes: 0.85, white: 0.6, dark: 0.45 }), palettes: [['#ffffff', '#ff2a2a', '#111111'], ['#ffffff', '#ffd23f', '#ff2bd6'], ['#00e5ff', '#ffffff', '#ff5ac8']], programs: ['scan', 'bars', 'strobeBars', 'rings', 'grid', 'noise', 'logo'] },
  techno:        { bpm: [128, 140], style: S({ pyro: 0, lasers: 0.5, strobes: 1, white: 0.9, dark: 0.85, artColors: false }), palettes: [['#ffffff', '#8a8a8a', '#202020'], ['#ffffff', '#ff1a1a', '#111111'], ['#e8e8ff', '#4a4aff', '#101018']], programs: ['scan', 'strobeBars', 'noise', 'shards', 'rings', 'lines', 'logo'] },
  hardtechno:    { bpm: [140, 160], style: S({ pyro: 0.1, lasers: 0.6, strobes: 1.2, white: 0.9, dark: 0.85, artColors: false }), palettes: [['#ff1a1a', '#ffffff', '#000000'], ['#ffffff', '#ff2a00', '#111111']], programs: ['strobeBars', 'scan', 'shards', 'noise', 'flash', 'logo'] },
  melodictechno: { bpm: [120, 126], style: S({ pyro: 0.1, lasers: 0.75, strobes: 0.6, white: 0.6, dark: 0.7 }), palettes: [['#2b5cff', '#7a2bff', '#ffffff'], ['#00e5ff', '#ffffff', '#1a1a3a'], ['#ff6a3c', '#ffd27f', '#5ac8ff']], programs: ['aurora', 'particles', 'tunnel', 'rings', 'starfield', 'lines', 'figure', 'logo'] },
  afterlife:     { bpm: [120, 126], style: S({ pyro: 0, lasers: 0.4, strobes: 0.7, white: 0.95, dark: 0.85, artColors: false }), palettes: [['#ffffff', '#b0b0b0', '#202020'], ['#e0e6ff', '#5a6cff', '#0a0a14']], programs: ['figure', 'noise', 'particles', 'lines', 'aurora', 'logo'] },
  trance:        { bpm: [132, 140], style: S({ pyro: 0.65, lasers: 0.85, strobes: 0.8, white: 0.6, beams: 1.1 }), palettes: [['#2b5cff', '#7a2bff', '#ffffff'], ['#ffffff', '#ff2bd6', '#2bd7ff'], ['#00e5ff', '#ff6a00', '#ffffff']], programs: ['tunnel', 'rays', 'starfield', 'waves', 'aurora', 'chevrons', 'logo'] },
  psytrance:     { bpm: [138, 146], style: S({ pyro: 0.5, lasers: 1.1, strobes: 0.9, white: 0.4, rainbowLasers: true }), palettes: [['#ff7a00', '#00ff88', '#ff2bd6'], ['#7fff00', '#ff2bd6', '#00d4ff'], ['#ffd23f', '#7a2bff', '#00ffcc']], programs: ['tunnel', 'mandala', 'rays', 'noise', 'rings', 'logo'] },
  futurehouse:   { bpm: [124, 128], style: S({ pyro: 0.5, lasers: 0.7, strobes: 0.85, white: 0.5 }), palettes: [['#00e5ff', '#ff2bd6', '#ffffff'], ['#ffffff', '#7a2bff', '#00ffcc']], programs: ['grid', 'hexes', 'bars', 'chevrons', 'tunnel', 'logo'] },
  bass:          { bpm: [140, 150], style: S({ pyro: 0.45, lasers: 1.1, strobes: 1.1, white: 0.35, dark: 0.7 }), palettes: [['#00ff66', '#ff2a00', '#7a2bff'], ['#ff2a2a', '#00e5ff', '#ffffff'], ['#7fff00', '#ff00aa', '#ffffff']], programs: ['glitch', 'shards', 'bars', 'flash', 'tunnel', 'noise', 'logo'] },
  melodicbass:   { bpm: [140, 150], style: S({ pyro: 0.9, lasers: 0.85, strobes: 0.85, white: 0.6 }), palettes: [['#ff7a1a', '#1a8cff', '#ffffff'], ['#ff5ac8', '#5ac8ff', '#ffffff'], ['#ffd27f', '#7a2bff', '#ffffff']], programs: ['aurora', 'rays', 'starfield', 'chevrons', 'particles', 'tunnel', 'logo'] },
  dnb:           { bpm: [170, 176], style: S({ pyro: 0.45, lasers: 1.1, strobes: 1.1, white: 0.5, dark: 0.55 }), palettes: [['#ff2a2a', '#ffffff', '#111111'], ['#ff2bd6', '#2bd7ff', '#ffffff'], ['#7fff00', '#ffffff', '#ff2a2a']], programs: ['glitch', 'scan', 'bars', 'lines', 'flash', 'tunnel', 'logo'] },
  hardstyle:     { bpm: [148, 156], style: S({ pyro: 1.1, lasers: 0.8, strobes: 1.2, white: 0.7 }), palettes: [['#ff1a1a', '#ffffff', '#111111'], ['#ff6a00', '#ffffff', '#ffd23f'], ['#ffffff', '#2b5cff', '#ff1a1a']], programs: ['flash', 'chevrons', 'rays', 'bars', 'shards', 'tunnel', 'logo'] },
  hardcore:      { bpm: [160, 200], style: S({ pyro: 0.9, lasers: 0.8, strobes: 1.3, white: 0.6, dark: 0.6 }), palettes: [['#ff0000', '#111111', '#ffffff'], ['#ff2a00', '#ffd23f', '#111111']], programs: ['flash', 'shards', 'glitch', 'strobeBars', 'logo'] },
  trap:          { bpm: [140, 160], style: S({ pyro: 0.6, lasers: 0.8, strobes: 1, white: 0.4, dark: 0.6 }), palettes: [['#ff2a2a', '#ffffff', '#111111'], ['#ffd23f', '#111111', '#ffffff'], ['#7a2bff', '#ff2bd6', '#ffffff']], programs: ['glitch', 'flash', 'bars', 'shards', 'grid', 'logo'] },
  tropical:      { bpm: [100, 120], style: S({ pyro: 0.4, lasers: 0.25, strobes: 0.4, white: 0.35, dark: 0.3 }), palettes: [['#ff9a3c', '#ffd27f', '#3cc6ff'], ['#ff6a3c', '#ffd23f', '#5ac8ff'], ['#ff5ac8', '#ffd27f', '#5ac8ff']], programs: ['aurora', 'waves', 'blobs', 'disco', 'sun', 'logo'] },
  popdance:      { bpm: [118, 128], style: S({ pyro: 0.75, lasers: 0.55, strobes: 0.8, white: 0.55 }), palettes: [['#ffffff', '#ff2bd6', '#5ac8ff'], ['#ffd23f', '#ff6a3c', '#ffffff'], ['#7a2bff', '#ff5ac8', '#ffffff']], programs: ['rays', 'chevrons', 'bars', 'disco', 'waves', 'flash', 'logo'] },
  afrohouse:     { bpm: [118, 124], style: S({ pyro: 0.3, lasers: 0.4, strobes: 0.5, white: 0.4, dark: 0.5 }), palettes: [['#ffd27f', '#ff8a1a', '#ffffff'], ['#ff6a3c', '#ffd23f', '#5ac8ff']], programs: ['sun', 'blobs', 'waves', 'rings', 'aurora', 'logo'] },
  melodic:       { bpm: [118, 128], style: S({ pyro: 0.4, lasers: 0.6, strobes: 0.5, white: 0.5, dark: 0.5 }), palettes: [['#ff5ac8', '#5ac8ff', '#ffffff'], ['#ffd27f', '#ff6a3c', '#5ac8ff'], ['#ffffff', '#7a2bff', '#00ffcc']], programs: ['aurora', 'particles', 'starfield', 'waves', 'blobs', 'logo'] },
};

// ------------------------------------------------------------------ artists
// A(id, 'name|alias|alias', genre, palette, mark, centre, styleOverrides, markText?)
const ARTISTS = [];
const A = (id, names, genre, palette, mark, centre, style = {}, markText) => ARTISTS.push({ id, names: names.split('|'), genre, palette, mark, centre, style, markText });

// --- big room / mainstage
A('garrix', 'martin garrix|area21|ytram|garrix', 'bigroom', ['#ffffff', '#ff2e2e', '#2b7bff', '#ffb000'], 'plusx', 'plus', { pyro: 1.1, lasers: 0.6, white: 0.8, logoRate: 1 });
A('hardwell', 'hardwell', 'bigroom', ['#ff1a1a', '#ffffff', '#0066ff'], 'hardwell', 'frame', { pyro: 1, strobes: 1.1 });
A('dvlm', 'dimitri vegas & like mike|dimitri vegas|like mike|dvlm', 'bigroom', ['#ff0033', '#ffd500', '#ffffff'], 'starA', 'towers', { pyro: 1.2 });
A('tiesto', 'tiësto|tiesto|dj tiesto', 'house', ['#00c2ff', '#ff2bd6', '#ffffff'], 'bird', 'arch', { pyro: 0.8, lasers: 0.7 });
A('guetta', 'david guetta|jack back', 'house', ['#ff3b3b', '#ffffff', '#2e6bff'], 'bars', 'towers', { pyro: 0.85 });
A('afrojack', 'afrojack|nlw|kapuchon', 'bigroom', ['#ff7a00', '#ffffff', '#2b2bff'], 'arrowA', 'triangle', { pyro: 0.9 });
A('nickyromero', 'nicky romero|monocule', 'progressive', ['#ffffff', '#2ecfff', '#ff3b3b'], 'triangleA', 'triangle', { white: 0.8 });
A('ww', 'w&w|nwyr|willem & wardt', 'bigroom', ['#ff0000', '#ffffff', '#ffcc00'], 'ww', 'towers', { pyro: 1.1, strobes: 1.2 });
A('blasterjaxx', 'blasterjaxx', 'bigroom', ['#ff5500', '#ffffff', '#ff0033'], 'xx', 'hex', { pyro: 1 });
A('kshmr', 'kshmr', 'bigroom', ['#ffcc33', '#ff8800', '#ffffff'], 'text', 'arch', { pyro: 0.95, lasers: 0.6, artColors: false }, 'KSHMR');
A('timmytrumpet', 'timmy trumpet', 'bigroom', ['#ffd700', '#ff3300', '#ffffff'], 'trumpet', 'towers', { pyro: 1.1 });
A('aoki', 'steve aoki', 'bigroom', ['#00e5ff', '#ff2bd6', '#ffffff'], 'face', 'towers', { pyro: 0.9 });
A('alesso', 'alesso', 'progressive', ['#ffffff', '#5ac8ff', '#ff5ac8'], 'text', 'ring', { white: 0.8, pyro: 0.8 }, 'ALESSO');
A('shm', 'swedish house mafia|axwell|sebastian ingrosso|steve angello|axwell & ingrosso|axwell λ ingrosso|axwell /\\ ingrosso', 'progressive', ['#ffffff', '#ff1a1a', '#161616'], 'threeDots', 'rings', { lasers: 1.1, strobes: 1.1, white: 0.9, pyro: 0.7, artColors: false, logoRate: 1 });
A('avicii', 'avicii|tim berg', 'progressive', ['#ffffff', '#00d1ff', '#ff9f1a'], 'avicii', 'triangle', { pyro: 0.7, white: 0.8 });
A('zedd', 'zedd', 'popdance', ['#ffffff', '#2b5cff', '#ff2bd6'], 'zedd', 'orbit', { pyro: 1, kinetic: 1 });
A('kygo', 'kygo', 'tropical', ['#ff9a3c', '#ffd27f', '#3cc6ff'], 'text', 'x', { pyro: 0.85, lasers: 0.3 }, 'KYGO');
A('alanwalker', 'alan walker', 'popdance', ['#ffffff', '#1e90ff', '#7fdcff'], 'aw', 'triangle', { white: 0.7, artColors: false });
A('marshmello', 'marshmello', 'popdance', ['#ffffff', '#ff00aa', '#00d4ff'], 'helmet', 'sphere', { pyro: 0.8 });
A('chainsmokers', 'the chainsmokers|chainsmokers', 'popdance', ['#ffffff', '#ff6a00', '#8a2bff'], 'star', 'ring', { pyro: 0.85 });
A('calvinharris', 'calvin harris|love regenerator', 'popdance', ['#ffffff', '#ff2bd6', '#5ac8ff'], 'text', 'arch', { pyro: 0.8 }, 'CALVIN HARRIS');
A('diplo', 'diplo|major lazer|lsd|silk city|thomas wesley', 'popdance', ['#ff2a2a', '#ffd23f', '#00d4ff'], 'text', 'towers', { pyro: 0.8 }, 'DIPLO');
A('dillon', 'dillon francis', 'popdance', ['#ff5ac8', '#ffd23f', '#00e5ff'], 'text', 'arch', {}, 'DILLON FRANCIS');
A('galantis', 'galantis', 'popdance', ['#ffffff', '#ff5ac8', '#5ac8ff'], 'text', 'ring', {}, 'GALANTIS');
A('r3hab', 'r3hab', 'bigroom', ['#ffffff', '#ff2a2a', '#2b5cff'], 'text', 'hex', {}, 'R3HAB');
A('quintino', 'quintino', 'bigroom', ['#ffffff', '#ff6a00', '#2b5cff'], 'text', 'towers', {}, 'QUINTINO');
A('deorro', 'deorro', 'bigroom', ['#ff2bd6', '#ffd23f', '#00e5ff'], 'text', 'towers', { pyro: 0.9 }, 'DEORRO');
A('kaaze', 'kaaze', 'bigroom', ['#ff1a1a', '#ffffff', '#000000'], 'lips', 'towers', { white: 0.7 });
A('mikewilliams', 'mike williams', 'futurehouse', ['#ffffff', '#2bd7ff', '#ff2bd6'], 'text', 'hex', {}, 'MIKE WILLIAMS');
A('brooks', 'brooks', 'futurehouse', ['#ffffff', '#00e5ff', '#ff6a00'], 'text', 'hex', {}, 'BROOKS');
A('julianjordan', 'julian jordan', 'futurehouse', ['#ffffff', '#ff2a2a', '#00e5ff'], 'text', 'plusbars', {}, 'JULIAN JORDAN');
A('justinmylo', 'justin mylo', 'futurehouse', ['#ffffff', '#5ac8ff', '#ff5ac8'], 'text', 'hex', {}, 'JUSTIN MYLO');
A('matissesadko', 'matisse & sadko', 'progressive', ['#ffffff', '#2b5cff', '#ff9a3c'], 'text', 'arch', {}, 'MATISSE & SADKO');
A('sandervandoorn', 'sander van doorn|purple haze', 'trance', ['#ff6a00', '#ffffff', '#2b5cff'], 'text', 'tunnel', {}, 'SANDER VAN DOORN');
A('dyro', 'dyro', 'bigroom', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'towers', {}, 'DYRO');
A('bassjackers', 'bassjackers', 'bigroom', ['#ff2a2a', '#ffffff', '#111111'], 'text', 'towers', { pyro: 1 }, 'BASSJACKERS');
A('showtek', 'showtek', 'bigroom', ['#ff1a1a', '#ffffff', '#111111'], 'text', 'towers', { pyro: 1 }, 'SHOWTEK');
A('ummet', 'ummet ozcan', 'bigroom', ['#ff6a00', '#ffffff', '#7a2bff'], 'text', 'hex', {}, 'UMMET OZCAN');
A('tujamo', 'tujamo', 'bigroom', ['#ffffff', '#ff2bd6', '#00e5ff'], 'text', 'towers', {}, 'TUJAMO');
A('nervo', 'nervo', 'bigroom', ['#ff5ac8', '#ffffff', '#5ac8ff'], 'text', 'arch', {}, 'NERVO');
A('lucassteve', 'lucas & steve', 'futurehouse', ['#ffffff', '#ff2bd6', '#2bd7ff'], 'text', 'hex', {}, 'LUCAS & STEVE');
A('firebeatz', 'firebeatz', 'bigroom', ['#ff6a00', '#ffffff', '#ff2a2a'], 'text', 'towers', {}, 'FIREBEATZ');
A('sickindividuals', 'sick individuals', 'progressive', ['#ffffff', '#2b5cff', '#ff2a2a'], 'text', 'triangle', {}, 'SICK INDIVIDUALS');
A('willsparks', 'will sparks', 'bigroom', ['#ffffff', '#7a2bff', '#00e5ff'], 'text', 'towers', { strobes: 1.1 }, 'WILL SPARKS');
A('alok', 'alok', 'popdance', ['#ffffff', '#00e5ff', '#ff2a2a'], 'peakA', 'triangle', { pyro: 0.8 });
A('vintageculture', 'vintage culture', 'melodic', ['#ff5ac8', '#ffd23f', '#5ac8ff'], 'chevrons5', 'arch', { pyro: 0.6 });
A('meduza', 'meduza', 'house', ['#ffffff', '#ff2bd6', '#2b5cff'], 'text', 'ring', {}, 'MEDUZA');
A('lostfrequencies', 'lost frequencies', 'melodic', ['#ffffff', '#5ac8ff', '#ff9a3c'], 'text', 'arch', {}, 'LOST FREQUENCIES');
A('robinschulz', 'robin schulz', 'house', ['#ffd27f', '#ff6a3c', '#5ac8ff'], 'text', 'arch', {}, 'ROBIN SCHULZ');
A('samfeldt', 'sam feldt', 'tropical', ['#ff9a3c', '#ffd27f', '#5ac8ff'], 'text', 'arch', {}, 'SAM FELDT');
A('jonasblue', 'jonas blue', 'popdance', ['#5ac8ff', '#ffffff', '#ff5ac8'], 'text', 'arch', {}, 'JONAS BLUE');
A('sigala', 'sigala', 'popdance', ['#ffd23f', '#ff5ac8', '#5ac8ff'], 'text', 'arch', {}, 'SIGALA');
A('jaxjones', 'jax jones', 'house', ['#ffffff', '#ff2bd6', '#ffd23f'], 'text', 'ring', {}, 'JAX JONES');
A('joelcorry', 'joel corry', 'house', ['#ffffff', '#5ac8ff', '#ff5ac8'], 'text', 'ring', {}, 'JOEL CORRY');
A('purpledisco', 'purple disco machine', 'house', ['#7a2bff', '#ff2bd6', '#ffd23f'], 'text', 'ring', { pyro: 0.3 }, 'PURPLE DISCO MACHINE');
A('dukedumont', 'duke dumont', 'house', ['#ffffff', '#ff6a3c', '#5ac8ff'], 'text', 'ring', {}, 'DUKE DUMONT');
A('gorgoncity', 'gorgon city', 'house', ['#ffffff', '#5ac8ff', '#ff5ac8'], 'text', 'ring', {}, 'GORGON CITY');
A('disclosure', 'disclosure', 'house', ['#ffffff', '#ff2a2a', '#5ac8ff'], 'faceLine', 'ring', { pyro: 0.4 });
A('kaskade', 'kaskade', 'progressive', ['#ffffff', '#ff2bd6', '#2bd7ff'], 'text', 'arch', { pyro: 0.6 }, 'KASKADE');
A('gryffin', 'gryffin', 'melodic', ['#ffffff', '#ff9a3c', '#5ac8ff'], 'text', 'circle', { pyro: 0.8 }, 'GRYFFIN');
A('porter', 'porter robinson|virtual self', 'melodic', ['#ff5ac8', '#5ac8ff', '#ffffff'], 'text', 'arch', { pyro: 0.5 }, 'PORTER ROBINSON');
A('madeon', 'madeon', 'melodic', ['#ff2bd6', '#2bd7ff', '#ffd23f'], 'text', 'frame', {}, 'MADEON');
A('flume', 'flume', 'melodic', ['#ff5ac8', '#5ac8ff', '#ffffff'], 'text', 'sphere', { lasers: 0.5 }, 'FLUME');
A('odesza', 'odesza', 'melodic', ['#ffffff', '#ffd27f', '#5ac8ff'], 'odesza', 'circle', { pyro: 1, lasers: 0.9 });
A('rufus', 'rüfüs du sol|rufus du sol|rüfüs|rufus', 'melodic', ['#ff6a3c', '#ffd27f', '#5ac8ff'], 'text', 'arch', { pyro: 0.5 }, 'RÜFÜS DU SOL');
A('fredagain', 'fred again..|fred again|fred again.', 'house', ['#ffffff', '#ff9a3c', '#5ac8ff'], 'text', 'frame', { pyro: 0.5 }, 'FRED AGAIN..');
A('bicep', 'bicep', 'melodic', ['#ff5ac8', '#00d4ff', '#ffffff'], 'text', 'frame', { lasers: 0.8 }, 'BICEP');
A('bonobo', 'bonobo', 'melodic', ['#ffd27f', '#5ac8ff', '#ffffff'], 'text', 'arch', { pyro: 0.2 }, 'BONOBO');

// --- bass / dubstep / trap
A('skrillex', 'skrillex|dog blood|jack ü|jack u', 'bass', ['#ff0000', '#ffffff', '#00ff66'], 'text', 'towers', { lasers: 1.2, strobes: 1.1, dark: 0.6, white: 0.35, rainbowLasers: true, logoRate: 0.8 }, 'SKRILLEX');
A('excision', 'excision', 'bass', ['#00ff66', '#ff2a00', '#7a2bff'], 'xJag', 'towers', { lasers: 1.2, strobes: 1.1, dark: 0.8, pyro: 0.6, logoRate: 1 });
A('illenium', 'illenium', 'melodicbass', ['#ff7a1a', '#1a8cff', '#ffffff'], 'phoenix', 'circle', { pyro: 1.1, logoRate: 1 });
A('sevenlions', 'seven lions', 'melodicbass', ['#7a2bff', '#2bd7ff', '#ffffff'], 'text', 'arch', { lasers: 0.9 }, 'SEVEN LIONS');
A('subtronics', 'subtronics', 'bass', ['#00ff88', '#ff00aa', '#ffffff'], 'eye', 'towers', { lasers: 1.1, dark: 0.8 });
A('zedsdead', 'zeds dead', 'bass', ['#ff3b3b', '#ffffff', '#3bff9f'], 'text', 'towers', {}, 'ZEDS DEAD');
A('rezz', 'rezz', 'bass', ['#ff0000', '#111111', '#ffffff'], 'eyes', 'spiral', { dark: 0.9, lasers: 0.9, pyro: 0, artColors: false, logoRate: 1 });
A('nghtmre', 'nghtmre', 'trap', ['#ff2a2a', '#ffffff', '#7a2bff'], 'text', 'towers', {}, 'NGHTMRE');
A('slander', 'slander', 'melodicbass', ['#ffffff', '#ff5ac8', '#5ac8ff'], 'text', 'circle', { pyro: 1 }, 'SLANDER');
A('sanholo', 'san holo', 'melodicbass', ['#ffd27f', '#5ac8ff', '#ffffff'], 'text', 'arch', {}, 'SAN HOLO');
A('saidthesky', 'said the sky', 'melodicbass', ['#5ac8ff', '#ffffff', '#ff5ac8'], 'text', 'arch', {}, 'SAID THE SKY');
A('dabin', 'dabin', 'melodicbass', ['#ff9a3c', '#5ac8ff', '#ffffff'], 'text', 'arch', {}, 'DABIN');
A('rlgrime', 'rl grime', 'trap', ['#ff2a2a', '#ffffff', '#111111'], 'text', 'towers', { dark: 0.6 }, 'RL GRIME');
A('yellowclaw', 'yellow claw', 'trap', ['#ffd23f', '#111111', '#ffffff'], 'text', 'towers', { pyro: 0.8 }, 'YELLOW CLAW');
A('knock2', 'knock2', 'trap', ['#ff5ac8', '#00e5ff', '#ffffff'], 'text', 'towers', {}, 'KNOCK2');
A('isoxo', 'isoxo', 'trap', ['#ffffff', '#ff2a2a', '#2b5cff'], 'text', 'towers', {}, 'ISOXO');
A('jauz', 'jauz', 'bass', ['#00d4ff', '#ffffff', '#ff2a2a'], 'shark', 'towers', {});
A('kayzo', 'kayzo', 'hardstyle', ['#ff2a2a', '#111111', '#ffffff'], 'text', 'towers', { pyro: 1 }, 'KAYZO');
A('svddendeath', 'svdden death|voyd', 'bass', ['#ff2a2a', '#000000', '#ffffff'], 'text', 'towers', { dark: 0.9, artColors: false }, 'SVDDEN DEATH');
A('virtualriot', 'virtual riot', 'bass', ['#00e5ff', '#ff2bd6', '#ffffff'], 'text', 'towers', {}, 'VIRTUAL RIOT');
A('wooli', 'wooli', 'bass', ['#7a2bff', '#00ff88', '#ffffff'], 'text', 'towers', {}, 'WOOLI');
A('bassnectar', 'bassnectar', 'bass', ['#7a2bff', '#00e5ff', '#ff2bd6'], 'text', 'towers', { lasers: 1 }, 'BASSNECTAR');
A('griz', 'griz', 'bass', ['#ffd23f', '#ff2bd6', '#5ac8ff'], 'text', 'arch', {}, 'GRIZ');
A('liquidstranger', 'liquid stranger', 'bass', ['#00ff88', '#7a2bff', '#ffffff'], 'text', 'towers', {}, 'LIQUID STRANGER');
A('ganja', 'ganja white night', 'bass', ['#7fff00', '#ff2bd6', '#ffffff'], 'text', 'towers', {}, 'GANJA WHITE NIGHT');
A('snails', 'snails', 'bass', ['#7fff00', '#ff2a2a', '#ffffff'], 'text', 'towers', {}, 'SNAILS');
A('peekaboo', 'peekaboo', 'bass', ['#ff2bd6', '#00e5ff', '#111111'], 'text', 'towers', {}, 'PEEKABOO');

// --- trance / psy
A('armin', 'armin van buuren|armin|gaia|rising star', 'trance', ['#2b5cff', '#7a2bff', '#ffffff'], 'armin', 'pillars', { beams: 1.3, pyro: 0.8, lasers: 0.8, kinetic: 1, logoRate: 1 });
A('aboveandbeyond', 'above & beyond|above and beyond|oceanlab|anjunabeats', 'trance', ['#ffffff', '#ff2bd6', '#2bd7ff'], 'ampersand', 'arch', { pyro: 0.6, crowdText: true });
A('pvd', 'paul van dyk', 'trance', ['#ffffff', '#ff3b3b', '#2b5cff'], 'text', 'towers', {}, 'PAUL VAN DYK');
A('ferrycorsten', 'ferry corsten|system f|gouryella', 'trance', ['#ff6a00', '#ffffff', '#2bd7ff'], 'text', 'arch', {}, 'FERRY CORSTEN');
A('alyfila', 'aly & fila', 'trance', ['#ffffff', '#7a2bff', '#ff8a1a'], 'text', 'arch', {}, 'ALY & FILA');
A('garethemery', 'gareth emery|laserface', 'trance', ['#00ff88', '#ffffff', '#ff2bd6'], 'text', 'laserwall', { lasers: 1.5, pyro: 0.3, logoRate: 0.8 }, 'GARETH EMERY');
A('markusschulz', 'markus schulz|dakota', 'trance', ['#2b5cff', '#ffffff', '#ff2bd6'], 'text', 'tunnel', {}, 'MARKUS SCHULZ');
A('cosmicgate', 'cosmic gate', 'trance', ['#00e5ff', '#ffffff', '#7a2bff'], 'text', 'tunnel', {}, 'COSMIC GATE');
A('andrewrayel', 'andrew rayel', 'trance', ['#ffffff', '#ff6a00', '#2b5cff'], 'text', 'arch', {}, 'ANDREW RAYEL');
A('marlo', 'marlo', 'trance', ['#ff6a00', '#ffffff', '#2bd7ff'], 'text', 'towers', {}, 'MARLO');
A('bennicky', 'ben nicky', 'trance', ['#ffffff', '#ff2bd6', '#00e5ff'], 'text', 'towers', { strobes: 1.1 }, 'BEN NICKY');
A('dashberlin', 'dash berlin', 'trance', ['#ffffff', '#ff2a2a', '#2b5cff'], 'text', 'arch', {}, 'DASH BERLIN');
A('vinivici', 'vini vici', 'psytrance', ['#ff7a00', '#00ff88', '#ff2bd6'], 'text', 'hex', { lasers: 1.1 }, 'VINI VICI');
A('infected', 'infected mushroom', 'psytrance', ['#7fff00', '#ff2bd6', '#00d4ff'], 'mushroom', 'sphere', {});
A('astrix', 'astrix', 'psytrance', ['#00ffcc', '#ff2bd6', '#ffd23f'], 'text', 'hex', {}, 'ASTRIX');
A('ace', 'ace ventura', 'psytrance', ['#ff7a00', '#00e5ff', '#ff2bd6'], 'text', 'hex', {}, 'ACE VENTURA');

// --- progressive / techno crossover
A('prydz', 'eric prydz|pryda|cirez d|tonja holma|holo', 'progressive', ['#00e5ff', '#ffffff', '#2b5cff'], 'cube', 'holo', { lasers: 0.9, strobes: 0.6, dark: 0.55, white: 0.6, pyro: 0, artColors: false, logoRate: 0.5 });
A('deadmau5', 'deadmau5|testpilot|kx5', 'progressive', ['#ff1a1a', '#161616', '#ffffff'], 'mau5', 'cube', { pyro: 0, lasers: 0.8, dark: 0.7, artColors: false, logoRate: 1 });
A('anyma', 'anyma|tale of us|mrak|mind against|adriatique|massano|kevin de vries|argy|colyn|innellea|afterlife', 'afterlife', ['#ffffff', '#b0b0b0', '#202020'], 'anyma', 'megawall', { logoRate: 0.6 });
A('bodzin', 'stephan bodzin', 'melodictechno', ['#ffffff', '#00e5ff', '#7a2bff'], 'text', 'sphere', {}, 'STEPHAN BODZIN');
A('benbohmer', 'ben böhmer|ben bohmer', 'melodictechno', ['#ffd27f', '#ff6a3c', '#5ac8ff'], 'text', 'arch', {}, 'BEN BÖHMER');
A('lane8', 'lane 8', 'melodictechno', ['#ffffff', '#5ac8ff', '#ff9a3c'], 'text', 'arch', { strobes: 0.4, pyro: 0.1 }, 'LANE 8');
A('yotto', 'yotto', 'melodictechno', ['#ffffff', '#ff5ac8', '#2b5cff'], 'text', 'arch', {}, 'YOTTO');
A('tinlicker', 'tinlicker', 'melodictechno', ['#5ac8ff', '#ffffff', '#ff6a3c'], 'text', 'arch', {}, 'TINLICKER');
A('noraenpure', 'nora en pure', 'melodictechno', ['#ffffff', '#5ac8ff', '#ffd27f'], 'lines3', 'arch', { dark: 0.4 });
A('camelphat', 'camelphat', 'melodictechno', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'frame', { artColors: false }, 'CAMELPHAT');
A('artbat', 'artbat', 'melodictechno', ['#ffffff', '#ff2bd6', '#111111'], 'text', 'frame', {}, 'ARTBAT');
A('kolsch', 'kölsch|kolsch', 'melodictechno', ['#ffffff', '#ff2a2a', '#2b5cff'], 'text', 'frame', {}, 'KÖLSCH');
A('maceoplex', 'maceo plex|maetrik', 'melodictechno', ['#ffffff', '#7a2bff', '#111111'], 'text', 'frame', {}, 'MACEO PLEX');
A('solomun', 'solomun', 'house', ['#ffffff', '#ff2bd6', '#2b2b2b'], 'text', 'oval', { dark: 0.6, artColors: false }, 'SOLOMUN');
A('blackcoffee', 'black coffee', 'afrohouse', ['#ffd27f', '#ff8a1a', '#ffffff'], 'text', 'arch', {}, 'BLACK COFFEE');
A('keinemusik', 'keinemusik|&me|rampa|adam port', 'afrohouse', ['#ffd27f', '#ff6a3c', '#ffffff'], 'text', 'arch', {}, 'KEINEMUSIK');

// --- techno
A('cdw', 'charlotte de witte', 'techno', ['#ffffff', '#7a7a7a', '#000000'], 'cw', 'oval', { logoRate: 1 });
A('amelielens', 'amelie lens', 'techno', ['#ffffff', '#ff1a1a', '#000000'], 'text', 'oval', {}, 'AMELIE LENS');
A('adambeyer', 'adam beyer|drumcode', 'techno', ['#ffffff', '#ff5a00', '#000000'], 'text', 'oval', {}, 'ADAM BEYER');
A('ninakraviz', 'nina kraviz', 'techno', ['#ffffff', '#ff1a1a', '#000000'], 'text', 'oval', {}, 'NINA KRAVIZ');
A('brejcha', 'boris brejcha', 'techno', ['#ffffff', '#ff2a2a', '#111111'], 'mask', 'oval', { dark: 0.8, logoRate: 1 });
A('carlcox', 'carl cox', 'techno', ['#ff8a00', '#ffffff', '#2b5cff'], 'cc', 'ring', { dark: 0.5, artColors: true });
A('enrico', 'enrico sangiuliano', 'techno', ['#ffffff', '#00e5ff', '#000000'], 'text', 'oval', {}, 'ENRICO SANGIULIANO');
A('zonneveld', 'reinier zonneveld', 'hardtechno', ['#ff2a2a', '#ffffff', '#111111'], 'text', 'oval', {}, 'REINIER ZONNEVELD');
A('999', '999999999', 'hardtechno', ['#ffffff', '#ff2a2a', '#000000'], 'text', 'oval', {}, '999999999');
A('ihatemodels', 'i hate models', 'hardtechno', ['#ff1a1a', '#000000', '#ffffff'], 'text', 'oval', {}, 'I HATE MODELS');
A('saralandry', 'sara landry', 'hardtechno', ['#ff2a2a', '#000000', '#ffffff'], 'text', 'oval', {}, 'SARA LANDRY');
A('indira', 'indira paganotto', 'hardtechno', ['#ff2bd6', '#000000', '#ffffff'], 'text', 'oval', {}, 'INDIRA PAGANOTTO');
A('klangkuenstler', 'klangkuenstler|klangkünstler', 'hardtechno', ['#ffffff', '#ff2a2a', '#000000'], 'text', 'oval', {}, 'KLANGKUENSTLER');
A('trym', 'trym', 'hardtechno', ['#ffffff', '#ff2a2a', '#000000'], 'text', 'oval', {}, 'TRYM');
A('marcocarola', 'marco carola', 'techhouse', ['#ffffff', '#ff6a00', '#111111'], 'text', 'oval', {}, 'MARCO CAROLA');
A('capriati', 'joseph capriati', 'techno', ['#ffffff', '#00e5ff', '#111111'], 'text', 'oval', {}, 'JOSEPH CAPRIATI');

// --- tech house
A('fisher', 'fisher', 'techhouse', ['#ffffff', '#ff3b3b', '#ffd23f'], 'text', 'ring', { pyro: 0.6 }, 'FISHER');
A('chrislake', 'chris lake', 'techhouse', ['#ffffff', '#2bd7ff', '#ff2bd6'], 'text', 'ring', {}, 'CHRIS LAKE');
A('domdolla', 'dom dolla', 'techhouse', ['#ffffff', '#ff6a00', '#7a2bff'], 'text', 'ring', {}, 'DOM DOLLA');
A('johnsummit', 'john summit', 'techhouse', ['#ffffff', '#ff2a2a', '#2b5cff'], 'text', 'ring', { pyro: 0.5 }, 'JOHN SUMMIT');
A('jameshype', 'james hype', 'techhouse', ['#ffffff', '#ff2bd6', '#00e5ff'], 'text', 'ring', {}, 'JAMES HYPE');
A('jamiejones', 'jamie jones', 'techhouse', ['#ffffff', '#ff5ac8', '#00d4ff'], 'circleWave', 'ring', {});
A('sonnyfodera', 'sonny fodera', 'techhouse', ['#ffffff', '#ffd23f', '#ff2bd6'], 'text', 'ring', {}, 'SONNY FODERA');
A('maup', 'mau p', 'techhouse', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'ring', {}, 'MAU P');
A('chrisstussy', 'chris stussy', 'techhouse', ['#ffffff', '#5ac8ff', '#111111'], 'text', 'ring', {}, 'CHRIS STUSSY');
A('malaa', 'malaa', 'techhouse', ['#ffffff', '#111111', '#ff2a2a'], 'text', 'towers', { dark: 0.7 }, 'MALAA');
A('tchami', 'tchami', 'futurehouse', ['#ffffff', '#ffd23f', '#2b5cff'], 'text', 'arch', {}, 'TCHAMI');
A('heldens', 'oliver heldens|hi-lo|hilo', 'futurehouse', ['#ffffff', '#00e5ff', '#ff2bd6'], 'text', 'hex', {}, 'OLIVER HELDENS');
A('dondiablo', 'don diablo|camp kubrick', 'futurehouse', ['#00e5ff', '#ff2bd6', '#ffffff'], 'hexagon', 'hex', { logoRate: 1 });
A('matroda', 'matroda', 'techhouse', ['#ffffff', '#ff6a00', '#111111'], 'text', 'ring', {}, 'MATRODA');
A('noizu', 'noizu', 'techhouse', ['#ffffff', '#00e5ff', '#ff2bd6'], 'text', 'ring', {}, 'NOIZU');
A('peggygou', 'peggy gou', 'house', ['#ff5ac8', '#ffd23f', '#5ac8ff'], 'text', 'ring', {}, 'PEGGY GOU');
A('honeydijon', 'honey dijon', 'house', ['#ffd23f', '#ff2bd6', '#ffffff'], 'text', 'ring', {}, 'HONEY DIJON');

// --- hardstyle / hardcore
A('headhunterz', 'headhunterz', 'hardstyle', ['#ff2a2a', '#ffffff', '#111111'], 'text', 'towers', { pyro: 1.2 }, 'HEADHUNTERZ');
A('brennanheart', 'brennan heart', 'hardstyle', ['#ff6a00', '#ffffff', '#111111'], 'text', 'towers', {}, 'BRENNAN HEART');
A('coone', 'coone', 'hardstyle', ['#ff2a2a', '#ffd23f', '#ffffff'], 'text', 'towers', {}, 'COONE');
A('wildstylez', 'wildstylez', 'hardstyle', ['#ffffff', '#ff2a2a', '#2b5cff'], 'text', 'towers', {}, 'WILDSTYLEZ');
A('subzero', 'sub zero project', 'hardstyle', ['#00e5ff', '#ffffff', '#111111'], 'text', 'towers', {}, 'SUB ZERO PROJECT');
A('dblock', 'd-block & s-te-fan|d-block and s-te-fan', 'hardstyle', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'towers', {}, 'D-BLOCK & S-TE-FAN');
A('datweekaz', 'da tweekaz', 'hardstyle', ['#ffd23f', '#ff2bd6', '#00e5ff'], 'text', 'towers', {}, 'DA TWEEKAZ');
A('sefa', 'sefa', 'hardcore', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'towers', {}, 'SEFA');
A('angerfist', 'angerfist', 'hardcore', ['#ff0000', '#111111', '#ffffff'], 'jagged', 'towers', { dark: 0.7 });
A('rand', 'ran-d', 'hardstyle', ['#ff2a2a', '#ffffff', '#111111'], 'text', 'towers', {}, 'RAN-D');
A('warface', 'warface', 'hardstyle', ['#ff2a2a', '#000000', '#ffffff'], 'text', 'towers', {}, 'WARFACE');
A('rebelion', 'rebelion', 'hardstyle', ['#ff2a2a', '#ffffff', '#000000'], 'text', 'towers', {}, 'REBELION');
A('phuturenoize', 'phuture noize', 'hardstyle', ['#00e5ff', '#ff2a2a', '#ffffff'], 'text', 'towers', {}, 'PHUTURE NOIZE');
A('atmozfears', 'atmozfears', 'hardstyle', ['#ffffff', '#ff6a00', '#2b5cff'], 'text', 'towers', {}, 'ATMOZFEARS');

// --- drum & bass
A('andyc', 'andy c', 'dnb', ['#ff2a2a', '#ffffff', '#111111'], 'text', 'towers', {}, 'ANDY C');
A('subfocus', 'sub focus', 'dnb', ['#ff2bd6', '#2bd7ff', '#ffffff'], 'text', 'x', { lasers: 1.2 }, 'SUB FOCUS');
A('wilkinson', 'wilkinson', 'dnb', ['#ffffff', '#ff6a00', '#5ac8ff'], 'text', 'towers', {}, 'WILKINSON');
A('chasestatus', 'chase & status|chase and status', 'dnb', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'towers', { strobes: 1.2 }, 'CHASE & STATUS');
A('pendulum', 'pendulum', 'dnb', ['#ff6a00', '#ffffff', '#2b5cff'], 'pendulum', 'towers', { pyro: 0.7 });
A('dimension', 'dimension', 'dnb', ['#ffffff', '#ff2bd6', '#5ac8ff'], 'text', 'x', { lasers: 1.2 }, 'DIMENSION');
A('netsky', 'netsky', 'dnb', ['#ffffff', '#ff3b3b', '#5ac8ff'], 'text', 'towers', {}, 'NETSKY');
A('camokrooked', 'camo & krooked', 'dnb', ['#ffffff', '#00e5ff', '#ff2bd6'], 'text', 'towers', {}, 'CAMO & KROOKED');
A('noisia', 'noisia', 'dnb', ['#ffffff', '#8a8a8a', '#000000'], 'lines3', 'towers', { artColors: false, dark: 0.8 });
A('hybridminds', 'hybrid minds', 'dnb', ['#ffffff', '#5ac8ff', '#ff5ac8'], 'text', 'arch', {}, 'HYBRID MINDS');
A('bou', 'bou', 'dnb', ['#ffffff', '#ff2a2a', '#ffd23f'], 'text', 'towers', {}, 'BOU');
A('hedex', 'hedex', 'dnb', ['#ffffff', '#ff2a2a', '#111111'], 'text', 'towers', {}, 'HEDEX');
A('kmotionz', 'k motionz', 'dnb', ['#ffffff', '#00e5ff', '#ff2a2a'], 'text', 'towers', {}, 'K MOTIONZ');

export { ARTISTS };

// ------------------------------------------------------------------ matching
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
const ALIAS = new Map();
for (const a of ARTISTS) for (const n of a.names) ALIAS.set(norm(n), a);

// pull every artist-like token out of a Spotify "artist" field and the track title
export function extractArtistNames(track) {
  const out = [];
  const push = (s) => { s = norm(s).replace(/^\(|\)$/g, '').trim(); if (s && !out.includes(s)) out.push(s); };
  const splitList = (s) => s.split(/\s*(?:,|&|\+|\/|\bx\b|\bvs\.?\b|\band\b|\bwith\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i);
  // whole names first (a split on "&" would turn "W&W" into "w" + "w" and "Aly & Fila" into two solo names), then the parts
  for (const part of (track.artist || '').split(/\s*(?:,|\/|\+)\s*/)) push(part);
  for (const part of splitList(track.artist || '')) push(part);
  const name = track.name || '';
  for (const m of name.matchAll(/\((?:feat\.?|ft\.?|with)\s+([^)]+)\)/gi)) for (const p of splitList(m[1])) push(p);
  for (const m of name.matchAll(/[-–(]\s*([^()\-–]+?)\s+(?:remix|edit|bootleg|rework|vip|flip|mix)\b/gi)) for (const p of splitList(m[1])) push(p);
  return out;
}

export function matchArtist(track) {
  const names = extractArtistNames(track);
  for (const n of names) if (ALIAS.has(n)) return ALIAS.get(n);
  for (const n of names) for (const [alias, a] of ALIAS) if (n.length > 3 && alias.length > 3 && (n.startsWith(alias + ' ') || alias.startsWith(n + ' '))) return a;
  return null;
}

// ------------------------------------------------------------------ per-song seed
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function seedFromTrack(track) {
  return hashStr((track?.id || '') + '|' + (track?.name || '') + '|' + (track?.artist || ''));
}
export class SongRng {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() { let t = (this.s += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  weighted(entries) { // [[value, weight], ...]
    let tot = 0; for (const e of entries) tot += Math.max(0, e[1]);
    let r = this.next() * tot;
    for (const e of entries) { r -= Math.max(0, e[1]); if (r <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  }
}

// ------------------------------------------------------------------ genre inference (unknown artists)
// Uses tempo + spectral character once the director has locked onto the track.
export function inferGenre({ bpm, bassRel, highRel, dark, halftime }) {
  if (!bpm) return 'bigroom';
  if (bpm >= 165 && bpm <= 182) return 'dnb';
  if (bpm >= 182) return 'hardcore';
  if (bpm >= 146 && bpm < 165) return halftime ? 'trap' : 'hardstyle';
  if (bpm >= 138 && bpm < 146) return halftime ? 'bass' : dark ? 'hardtechno' : 'trance';
  if (bpm >= 132 && bpm < 138) return dark ? 'techno' : 'trance';
  if (bpm >= 126 && bpm < 132) return dark ? 'techhouse' : highRel > 0.6 ? 'bigroom' : 'progressive';
  if (bpm >= 120 && bpm < 126) return dark ? 'melodictechno' : 'house';
  if (bpm >= 100 && bpm < 120) return 'tropical';
  if (bpm < 100) return 'trap';
  return 'bigroom';
}

// generic centrepieces handed to unknown artists (deterministic per song)
const GENERIC_CENTRES = {
  bigroom: ['arch', 'towers', 'hex', 'frame', 'x'], progressive: ['arch', 'ring', 'triangle', 'frame', 'sphere'], house: ['ring', 'arch', 'frame', 'sphere'],
  techhouse: ['ring', 'oval', 'frame'], techno: ['oval', 'frame'], hardtechno: ['oval', 'towers'], melodictechno: ['sphere', 'arch', 'frame', 'tunnel'], afterlife: ['megawall'],
  trance: ['arch', 'tunnel', 'pillars', 'towers'], psytrance: ['hex', 'sphere', 'spiral'], futurehouse: ['hex', 'frame', 'plusbars'], bass: ['towers', 'x', 'spiral'], melodicbass: ['circle', 'arch', 'x'],
  dnb: ['towers', 'x', 'frame'], hardstyle: ['towers', 'x'], hardcore: ['towers'], trap: ['towers', 'x'], tropical: ['arch', 'sphere', 'ring'], popdance: ['arch', 'ring', 'frame', 'orbit'], afrohouse: ['arch', 'ring'], melodic: ['arch', 'sphere', 'circle'],
};

// ------------------------------------------------------------------ per-song colour variety
// Real LDs re-colour the same rig every song; an artist's brand colours anchor the show but never own it.
// Modes (deterministic per song, never the same mode/palette as the previous song):
//   signature - brand palette as is, reordered
//   shift     - all non-neutral colours hue-rotated by the same 25..60 degrees (keeps the "feel", changes the look)
//   blend     - two brand colours + one or two colours borrowed from a genre palette
//   genre     - one of the genre palettes (what a guest LD would run)
//   harmony   - triad / analogous / split-complement scheme built from the brand's primary hue
// Every palette gets a 4th (and often 5th) accent so the director has enough colours to rotate through
// phrase by phrase. Low-variety brands (monochrome techno, artColors:false) only get reorders and small shifts.
const PALETTE_MODES = ['signature', 'shift', 'blend', 'harmony', 'genre'];
let lastPaletteKey = '', lastPaletteMode = '';

// Black is a brand colour, not a light colour: a fixture set to it just goes dark, so half the rig looks broken for
// a phrase. Palettes that carry it (the monochrome techno brands) get a deep tone of their own hue instead, or a
// steel blue when the brand has no hue at all; the blackouts those brands want come from the dark style knob.
export function lightable(base) {
  const chroma = base.filter((h) => !isNeutral(h));
  const h = chroma[0] ? hexToHsl(chroma[0]).h : 0.62;
  return base.map((hex) => (hexToHsl(hex).l < 0.12 ? hslToHex(h, chroma[0] ? 0.8 : 0.55, 0.32) : hex));
}

export function varyPalette(base, genrePalettes, rng, variety = 1, matched = true) {
  base = lightable(base);
  const chroma = base.filter((h) => !isNeutral(h));
  const hasWhite = base.some((h) => hexToHsl(h).l > 0.93);
  const primary = chroma[0] ? hexToHsl(chroma[0]).h : rng.next();
  const uniq = (arr) => arr.filter((h, i) => arr.findIndex((x) => x.toLowerCase() === h.toLowerCase()) === i);
  const farFrom = (hex, list, d = 0.07) => isNeutral(hex) ? !list.some(isNeutral) : list.every((x) => isNeutral(x) || hueDist(hexToHsl(x).h, hexToHsl(hex).h) > d);
  const modes = variety >= 0.6 ? PALETTE_MODES : ['signature', 'signature', 'shift'];
  const draws = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
  const build = (mode) => {
    let pal;
    switch (mode) {
      case 'shift': {
        if (!chroma.length) return null;
        const deg = variety >= 0.6 ? 25 + 35 * draws[1] : 4 + 8 * draws[1];
        const d = (draws[2] < 0.5 ? -1 : 1) * deg / 360;
        pal = base.map((h) => shiftHue(h, d));
        break;
      }
      case 'blend': {
        if (chroma.length < 2 || !genrePalettes?.length) return null;
        const keep = rng.shuffle(chroma).slice(0, 2);
        const borrowed = rng.shuffle(genrePalettes[Math.floor(draws[3] * genrePalettes.length)]).filter((h) => farFrom(h, keep)).slice(0, 2);
        pal = keep.concat(borrowed);
        if (hasWhite && !pal.some(isNeutral)) pal.push('#ffffff');
        break;
      }
      case 'genre': {
        if (!genrePalettes?.length) return null;
        pal = rng.shuffle(genrePalettes[Math.floor(draws[3] * genrePalettes.length)]);
        break;
      }
      case 'harmony': {
        if (!chroma.length) return null;
        const scheme = ['triad', 'analog', 'split', 'complement'][Math.floor(draws[4] * 4)];
        const h0 = primary;
        const hs = scheme === 'triad' ? [h0, h0 + 1 / 3, h0 + 2 / 3]
          : scheme === 'analog' ? [h0, h0 + 0.09, h0 - 0.09]
          : scheme === 'split' ? [h0, h0 + 5 / 12, h0 + 7 / 12]
          : [h0, h0 + 0.5];
        pal = hs.map((h, i) => vivid(h, i === 0 ? 0.52 : 0.58));
        pal[0] = chroma[0]; // keep the brand's actual primary, not a re-saturated copy
        if (hasWhite || scheme === 'complement') pal.push('#ffffff');
        break;
      }
      default:
        pal = rng.shuffle(base);
        if (variety < 0.6 && draws[5] < 0.5) pal = base.slice(); // monochrome brands mostly keep their order
    }
    pal = uniq(pal);
    // accent colours: a 4th/5th hue far enough from what's there, so phrase-to-phrase colour changes read
    if (variety >= 0.6) {
      const want = 4 + (draws[0] < 0.45 ? 1 : 0);
      const offs = [1 / 3, 0.5, 2 / 3, 0.42, 0.58, 0.25, 0.75];
      for (let k = 0; k < offs.length && pal.length < want; k++) {
        const c = vivid(primary + offs[(k + Math.floor(draws[2] * offs.length)) % offs.length], 0.56);
        if (farFrom(c, pal, 0.09)) pal.push(c);
      }
      if (pal.length < 4 && !pal.some(isNeutral)) pal.push('#ffffff');
    }
    return pal.length >= 3 ? pal : null;
  };
  // pick a mode; walk to the next one if it repeats the previous song's mode or palette
  let mi = Math.floor(draws[0] * modes.length), pal = null, mode = '';
  for (let tries = 0; tries < modes.length + 1; tries++) {
    mode = modes[(mi + tries) % modes.length];
    pal = build(mode);
    if (!pal) continue;
    const key = paletteKey(pal);
    const repeats = key === lastPaletteKey || (variety >= 0.6 && mode === lastPaletteMode && modes.length > 2);
    if (!repeats) { lastPaletteKey = key; lastPaletteMode = mode; return { palette: pal, mode }; }
  }
  pal = pal || base.slice(); lastPaletteKey = paletteKey(pal); lastPaletteMode = mode;
  return { palette: pal, mode };
}

// ------------------------------------------------------------------ profile resolution
export function resolveProfile(track, hints = {}) {
  const seed = seedFromTrack(track);
  const rng = new SongRng(seed);
  const artist = matchArtist(track);
  const genreKey = artist ? artist.genre : (hints.genre || 'bigroom');
  const g = GENRES[genreKey] || GENRES.bigroom;
  const style = Object.assign({}, g.style, artist ? artist.style : {});
  // signature palette is the starting point; every song gets its own re-colouring of it
  const base = artist ? artist.palette.slice() : rng.pick(g.palettes).slice();
  const variety = style.colorVariety ?? (style.artColors === false ? 0.3 : 1);
  const { palette, mode: paletteMode } = varyPalette(base, g.palettes, rng, variety, !!artist);
  const centre = artist ? artist.centre : rng.pick(GENERIC_CENTRES[genreKey] || GENERIC_CENTRES.bigroom);
  const displayName = artist ? (artist.markText || artist.names[0].toUpperCase()) : (track.artist || '').split(/,|&|feat/i)[0].trim().toUpperCase();
  return {
    id: artist ? artist.id : 'generic:' + genreKey,
    matched: !!artist,
    name: displayName,
    genre: genreKey,
    bpm: g.bpm,
    style,
    palette,
    paletteMode,
    signaturePalette: base,
    genrePalettes: g.palettes,
    programs: g.programs,
    mark: artist ? artist.mark : 'text',
    markText: artist ? (artist.markText || displayName) : displayName,
    centre,
    seed,
    variant: rng.int(1000), // per-song variation index used by fixtures/programs
  };
}
