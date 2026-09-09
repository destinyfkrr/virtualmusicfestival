# Virtual-Fest — Spotify-reactive virtual festival

A Tomorrowland / Ultra style festival rendered in the browser (three.js): a main stage whose LED
walls, moving heads, strobes, lasers, pixel architecture, CO2 jets, flames, water and fireworks
react in real time to whatever your Mac's Spotify app is playing — beat-grid locked, with a
per-artist stage design, a per-song colour theme and the artist's real logo on the screens —
set in full festival grounds (crowd, lighting towers, ferris wheel, drop tower, entrance gate,
festoons, sky). The set is built twice life size around a human-scale crowd, the way the big
festival main stages dwarf the field in front of them.

Audio is captured with a macOS Core Audio *process tap* (macOS 14.2+), so no virtual audio
driver (BlackHole etc.) is needed and Spotify keeps playing through your speakers.
Track metadata (title, artist, artwork, playback position) comes from Spotify via AppleScript.

## Run

```sh
npm install
npm start          # builds native/spotifytap on first run, serves http://localhost:5173
```

Open http://localhost:5173, press **ENTER**, play something in Spotify.

The first time the tap starts, macOS asks to allow your terminal app to record system
audio. Accept it (System Settings → Privacy & Security → Screen & System Audio Recording).
If you denied it, re-enable it there and restart `npm start`.

Requirements: macOS 14.2 or newer, Xcode command line tools (`swiftc`), Node 18+.

### Demo set (no Spotify)

Open http://localhost:5173/?demo — a built-in synthesised 135 s EDM arrangement
(intro → groove → build → drop → breakdown → build → drop) plays through the speakers and drives
the show. Add an artist to get their rig, logo and colour treatment:
`/?demo=Armin%20van%20Buuren`, `/?demo=Charlotte%20de%20Witte`, … (default: Martin Garrix).

## Fallback audio sources

Press **S** (or the *Source* button):

- **Spotify tap** — native capture (default).
- **Screen / tab audio** — share a Chrome tab or the screen with audio.
- **Input device** — any input, e.g. a loopback device.
- **Demo set** — the built-in arrangement above.

## Keys and buttons

| Key | Action |
| --- | --- |
| F | Fullscreen |
| C | Cut to the next camera shot (auto-cam resumes ~25 s after you drag) |
| 1–9, 0 | Camera 1–10: wide, crowd L, crowd R, side, close, low, orbit, crowd POV, top, DJ POV |
| Q / W / E | Festival cameras: walk in through the entrance gate, crane from the ferris wheel to the stage, in the crowd |
| L | Show the artist's logo / mark on the walls now |
| P | Fire pyro (CO2, flames, sparkulars, fireworks, confetti, water) |
| D | Force a drop on the next beat |
| - / = | Fewer / more beams and lasers (the *Lights* button cycles low → med → high) |
| [ / ] | Nudge sync lead −/+10 ms (if hits feel late/early) |
| H | Hide / show HUD |
| S | Source menu |
| Drag / wheel | Orbit camera |

The buttons bottom-right do the same: *Source*, *Camera*, *Logo*, *Pyro*, *Lights*, *Fullscreen*.

## How the show works

- `web/js/director.js` — the show director. An onset-detection worklet feeds it hop
  energies; it runs tempo tracking (autocorrelation + phase lock), predicts the beat grid
  ahead of the audio (compensating tap + render latency), infers downbeats and 8/16-bar
  phrases (using Spotify's playback position as a prior — EDM puts drops on 32-beat
  multiples), and drives a phase machine intro → groove → build → drop → peak → breakdown
  with kick/snare/hat envelopes, strobe rate, whiteouts and pyro cues. The pre-drop
  "blackout" is a short partial dip half a beat before a confidently predicted drop, never a
  black frame; the kick gate and the phrase trust margins keep the rig from flashing on
  every transient.
- `web/js/artists.js` — 180+ artist profiles across 21 EDM genres (big room, progressive,
  future/bass/electro house, trance, psy, hardstyle, techno, hard techno, melodic techno,
  deep, tech house, dubstep, trap, DnB, hardcore, future bass…). Each carries its
  signature palette, centrepiece design, mark and style (pyro, lasers, strobes, kinetic,
  logo rate). Unknown artists get a genre profile. The track id/name/artist hashes into a
  seed so every song gets its own deterministic look (`SongRng`).
- **Colour themes** — an artist's brand colours anchor the show but never own it. Every
  song picks one of five palette modes (`signature`, `shift` = hue-rotated brand palette,
  `blend` = brand + genre colours, `harmony` = triad / analogous / split-complement scheme
  from the brand hue, `genre` = a guest-LD genre palette), never the same mode or palette
  as the previous song, and adds a 4th/5th accent so phrases can rotate colours. Vivid album
  artwork colours (`web/js/palette.js`) are merged in as well. Monochrome brands (some
  techno acts) only get reorders and small shifts. Black brand colours become a deep tone of
  the brand hue (a fixture set to black just goes dark).
- **Logos** — `server/logos.js` fetches the artist's real logo (TheAudioDB wordmark /
  clear-art, then Wikidata's logo claim, then a Wikimedia Commons search) and caches it in
  `cache/logos/` (misses cached 7 days). `web/js/logos.js` turns it into a screen texture;
  the walls reveal it (wipe / scan / scale / flicker / build) on song start, drops and
  breakdown phrases, falling back to the procedural marks in `web/js/marks.js` (plus,
  triangle, x, mau5 head, spiral…) and wordmarks.
- `web/js/centrepieces.js` — 21 centrepiece rigs (Martin Garrix "+", Armin's towers,
  Tiësto's arch, Hardwell's frame, Eric Prydz's HOLO screen, Swedish House Mafia's
  triangle, Carl Cox's ring, Alesso's orbit, DVBBS's X, Deadmau5 cube, Excision megawall,
  laser wall…) built from pixel strips, kinetic parts, panels and laser banks.
- `web/js/programs.js` — 27 LED wall programs (waves, rays, tunnel, shards, mandala,
  strobe bars, particles, glitch…) picked per panel by phase energy from the artist's pool.
- `web/js/fixtures.js` — GPU-instanced fixture arrays: `BeamArray` (moving heads with
  volumetric beams), `StrobeArray`, `LaserBank`, `PixelStrips`, `LedPanel`, `Crowd`,
  `Particles`.
- `web/js/stage.js` — the set, built 2x life size: ~310 moving heads, ~165 strobes/blinders,
  47 laser sources (~360 beams), thousands of architectural pixels (arches, trusses, towers,
  frames, runway) plus the centrepiece, the 18k crowd with phone lights, bloom, and the
  camera director (13 shots, drop cuts on the downbeat). Nothing stands in the crowd: no FOH
  platform or delay towers, so every shot from the field sees the whole stage. The *Lights* density scales
  how many beams and lasers are up at once and how bright they are, so the stage always stays visible.
  Lasers are run the way a laser operator runs them: the projectors on one truss share a
  look (mirrored fans, one phase running along the truss) and only one to three of the six
  laser groups fire at once, so a drop is a few big coherent fans instead of a web of lines,
  and every laser is a pure saturated hue no matter what the LED palette is doing. Moving-head
  beams are narrow and fade along their length like beams in real haze, so a sky full of them
  stays a sky full of rays rather than a wash. On top of that an auto-iris does what a
  broadcast camera does: a small pass meters the HDR frame before tone mapping (16×9 cells,
  read back asynchronously), tracks the brightest quarter of the frame, and closes the
  exposure by up to a stop when a laser and beam wall starts to blow the stage out, so the
  stage stays legible through the heaviest drop moments and never dims on a dark wide shot.
- `web/js/festival.js` — the grounds: sky dome with stars, moon and horizon glow, haze,
  hills and tree lines, a ferris wheel and a drop tower with chasing pixel rims, four crowd
  lighting towers with pixel edges and level meters, six perimeter skytrackers, wristbands
  that pulse with the show, festoon strings over the field, the entrance gate with its pixel-outlined VIRTUAL-FEST sign, a lit
  cobble path with bollards and lamp posts, stage-colour light spill on the grass, and the
  stage dressing (PA hangs, subs, side screens, water jets, waterfall, flame bars, comets).

## Debugging

- `curl localhost:5173/status` — tap state and current track.
- `curl "localhost:5173/logo?artist=Martin%20Garrix&meta=1"` — logo cache entry for an artist.
- `TAP_DEBUG=1 npm start` — per-second callback/byte counters from the native tap.
- `TAP_SUBDEV=1 npm start` — include the default output device in the aggregate (older behaviour).
- `window.__stage` in the console exposes `audio`, `director` (`.show` is the live frame), `stage`, `hud`.
