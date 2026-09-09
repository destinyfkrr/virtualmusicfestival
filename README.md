# Mainstage — Spotify-reactive virtual festival stage

A Tomorrowland / Ultra style main stage rendered in the browser (three.js) whose LED walls,
moving heads, strobes, lasers, pixel architecture, CO2 jets, flames and fireworks react in real
time to whatever your Mac's Spotify app is playing — beat-grid locked, with a per-artist stage
design and a per-song look.

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

## Fallback audio sources

Press **S** (or the *Source* button):

- **Spotify tap** — native capture (default).
- **Screen / tab audio** — share a Chrome tab or the screen with audio.
- **Input device** — any input, e.g. a loopback device.

## Keys

| Key | Action |
| --- | --- |
| F | Fullscreen |
| C | Cut to next camera shot (auto-cam resumes ~25 s after you drag) |
| 1–9, 0 | Jump to camera 1–10 (wide, crowd L/R, side, close, low, orbit, crowd POV, top, DJ POV) |
| L | Show the artist's logo / mark on the walls now |
| P | Fire pyro (CO2, flames, sparkulars, fireworks, confetti) |
| D | Force a drop on the next beat |
| [ / ] | Nudge sync lead −/+10 ms (if hits feel late/early) |
| H | Hide / show HUD |
| S | Source menu |
| Drag / wheel | Orbit camera |

## How the show works

- `web/js/director.js` — the show director. An onset-detection worklet feeds it hop
  energies; it runs tempo tracking (autocorrelation + phase lock), predicts the beat grid
  ahead of the audio (compensating tap + render latency), infers downbeats and 8/16-bar
  phrases (using Spotify's playback position as a prior — EDM puts drops on 32-beat
  multiples), and drives a phase machine intro → groove → build → drop → peak → breakdown
  with kick/snare/hat envelopes, strobe rate, whiteouts, pre-drop blackout and pyro cues.
- `web/js/artists.js` — 180+ artist profiles across 21 EDM genres (big room, progressive,
  future/bass/electro house, trance, psy, hardstyle, techno, hard techno, melodic techno,
  deep, tech house, dubstep, trap, DnB, hardcore, future bass…). Each carries its
  signature palette, centrepiece design, mark and style (pyro, lasers, strobes, kinetic,
  logo rate). Unknown artists get a genre profile. The track id/name/artist hashes into a
  seed so every song gets its own deterministic look (`SongRng`).
- `web/js/centrepieces.js` — 21 centrepiece rigs (Martin Garrix "+", Armin's towers,
  Tiësto's arch, Hardwell's frame, Eric Prydz's HOLO screen, Swedish House Mafia's
  triangle, Carl Cox's ring, Alesso's orbit, DVBBS's X, Deadmau5 cube, Excision megawall,
  laser wall…) built from pixel strips, kinetic parts, panels and laser banks.
- `web/js/marks.js` — procedural artist marks (plus, triangle, x, mau5 head, spiral…) and
  wordmarks, revealed on the main wall (wipe / scan / scale / flicker / build) on song
  start, drops and breakdown phrases like a festival wall does.
- `web/js/programs.js` — 27 LED wall programs (waves, rays, tunnel, shards, mandala,
  strobe bars, particles, glitch…) picked per panel by phase energy from the artist's pool.
- `web/js/fixtures.js` — GPU-instanced fixture arrays: `BeamArray` (moving heads with
  volumetric beams), `StrobeArray`, `LaserBank`, `PixelStrips`, `LedPanel`, `Crowd`,
  `Particles`.
- `web/js/stage.js` — the set: ~330 moving heads, ~170 strobes/blinders, ~50 laser
  sources (~520 beams), ~3.8k architectural pixels (arches, trusses, towers, frames,
  runway, delay towers) plus the centrepiece, 6k crowd with phone lights, camera director.

## Debugging

- `curl localhost:5173/status` — tap state and current track.
- `TAP_DEBUG=1 npm start` — per-second callback/byte counters from the native tap.
- `TAP_SUBDEV=1 npm start` — include the default output device in the aggregate (older behaviour).
- `window.__stage` in the console exposes `audio`, `director` (`.show` is the live frame), `stage`, `hud`.
