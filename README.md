# Virtual Music Festival

**Stop only listening to EDM. Watch it.**

A Tomorrowland / Ultra style festival main stage rendered live in the browser (three.js), driven by
whatever your Spotify is playing. LED walls, moving heads, strobes, lasers, pixel architecture, CO2
jets, flames, cold sparks and fireworks run to the beat grid of the actual song — with a per-artist
stage design, a per-song colour theme and the artist's real logo on the screens — set in full
festival grounds (20k crowd, lighting towers, ferris wheel, drop tower, entrance gate, festoons,
black star sky). The set is built four times life size around a human-scale crowd, the way the big
main stages dwarf the field in front of them; the DJ (or duo / trio) plays the set in the booth with
an IMAG feed on the wings, and all 11 cameras stay on the stage.

- **180+ artist profiles** across 21 EDM genres — Martin Garrix's "+", Armin's towers, Tiësto's arch,
  Hardwell's frame, Eric Prydz's HOLO, Swedish House Mafia's triangle, Carl Cox's ring, the deadmau5
  cube, the Excision megawall… Unknown artists get their genre's rig.
- **21 centrepiece designs, 27 LED wall programs, 5 colour-theme modes** — no two songs look alike.
- **Real artist logos**, fetched and cached; **NoCopyrightSounds** releases carry the NCS mark.
- **Runs on macOS, Linux and Windows**, and anyone on your network can watch the same show in their
  own browser.

This is a local app, not a service: it runs on your machine, reads your own Spotify, and talks to
nothing but the logo/NCS lookups. There is no account and no Spotify login.

## Run

```sh
npm install
npm start          # serves http://localhost:5173
```

Open <http://localhost:5173>, press **ENTER THE FESTIVAL**, press play in Spotify.

Node 18+ (developed on Node 24). Then, per platform:

### macOS

Audio is captured with a Core Audio **process tap** (macOS 14.2+) that reads Spotify's own output —
no virtual audio driver (BlackHole etc.), and Spotify keeps playing through your speakers. The tap
binary builds itself on first run, so you need the Xcode command line tools (`xcode-select --install`
gives you `swiftc`). The first start asks to let your terminal record system audio: accept it
(System Settings → Privacy & Security → Screen & System Audio Recording) and restart `npm start`.
Track title, artist, artwork and playback position come from Spotify over AppleScript.

### Linux

Audio comes from the default sink's **monitor** source, so it follows whatever is coming out of the
speakers. Install the recorder and the metadata reader:

```sh
sudo apt install pulseaudio-utils playerctl     # Debian / Ubuntu  (or pipewire-utils for pw-record)
sudo dnf install pulseaudio-utils playerctl     # Fedora
sudo pacman -S libpulse playerctl               # Arch
```

`parec` is used when present, otherwise `pw-record` (PipeWire). Metadata (title, artist, album,
artwork, position) comes from Spotify over MPRIS through `playerctl`.

### Windows

Windows has no always-present loopback device, so audio goes through **ffmpeg** and a loopback input:

1. Install ffmpeg and put it on `PATH` (`winget install Gyan.FFmpeg`).
2. Enable **Stereo Mix** (Sound settings → More sound settings → Recording → right-click → Show
   Disabled Devices → enable Stereo Mix), or install [VB-CABLE](https://vb-audio.com/Cable/) or
   VoiceMeeter and play Spotify into it.
3. `npm start`. The server auto-detects Stereo Mix / What U Hear / CABLE Output / VoiceMeeter Out /
   Loopback. If it picks the wrong one, run `ffmpeg -list_devices true -f dshow -i dummy` and set
   `VF_AUDIO_DEVICE` to the exact device name.

Track title, artist, album and position come from Windows itself (the same session info the media
overlay shows), read through Windows PowerShell 5.1; if that fails it falls back to Spotify's window
title. **Windows exposes no album artwork**, so the artwork-derived colour blend is skipped there —
the artist and genre palettes still drive the whole show.

### Any platform: bring your own capture

Set `VF_AUDIO_CMD` to any command that writes **float32 little-endian, mono, 48 kHz PCM to stdout**
and it is used instead of the built-in backends:

```sh
VF_AUDIO_CMD='ffmpeg -f pulse -i my.monitor -ac 1 -ar 48000 -f f32le -' npm start
```

## Watching from another device on your network

The server listens on every interface, so the show is at `http://<your-lan-ip>:5173` for anything on
the same Wi-Fi — a second laptop, a TV browser, the projector in the room. It prints the addresses on
startup. The audio and the track info still come from the machine running the server, so every viewer
sees the same show, in sync, without any Spotify setup of their own.

One browser caveat: `AudioWorklet` and tab sharing are **secure-context only**, and a plain
`http://192.168.x.x` address is not a secure context. Over LAN http the app falls back to a
`ScriptProcessorNode` path automatically (this is what fixes
`undefined is not an object (evaluating 'ctx.audioWorklet.addModule')`), which costs about 20 ms of
extra latency and is compensated for in the sync. To get the tighter path, serve it over TLS:

```sh
# a self-signed pair is enough on a home network; browsers will warn once
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout key.pem -out cert.pem -subj "/CN=$(hostname)"
VF_TLS_CERT=cert.pem VF_TLS_KEY=key.pem npm start     # now https://<your-lan-ip>:5173
```

Phones and tablets get a "come back on a computer" notice — the show wants a wide screen and a real
GPU — with a *let me in anyway* button for small laptops and desktops that report a touch screen.

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5173` | HTTP/WS port |
| `HOST` | `0.0.0.0` | Bind address — set `127.0.0.1` to keep it off the network |
| `VF_POLL_MS` | `400` | How often the now-playing metadata is polled |
| `VF_AUDIO_CMD` | — | Your own capture command (float32le mono 48 kHz on stdout) |
| `VF_AUDIO_DEVICE` | auto | Windows: the exact dshow device name to record |
| `VF_TLS_CERT` / `VF_TLS_KEY` | — | Serve https instead of http (both required) |
| `TAP_DEBUG` | — | macOS: per-second callback/byte counters from the native tap |
| `TAP_SUBDEV` | — | macOS: include the default output device in the aggregate |

`curl localhost:5173/config` reports what the host resolved: capture backend, metadata, artwork, TLS.

## Demo set (no Spotify)

Open <http://localhost:5173/?demo> — a built-in synthesised 135 s EDM arrangement
(intro → groove → build → drop → breakdown → build → drop) plays through the speakers and drives
the show. Add an artist to get their rig, logo and colour treatment:
`/?demo=Armin%20van%20Buuren`, `/?demo=Charlotte%20de%20Witte`, … (default: Martin Garrix).
Add `&song=` to give the set a real title, e.g. `/?demo=Jim%20Yosef&song=Link` plays the demo
as an NCS release (NCS mark on the walls, "NCS release" on the now-playing line).

## Why it reads your own audio instead of using the Spotify API

Spotify's `/v1/audio-features` and `/v1/audio-analysis` endpoints (tempo, beats, bars, sections) were
deprecated on 27 November 2024 and now return 403 for every new app, so the beat grid has to be
derived from the audio itself. The Web Playback SDK cannot help either: its audio is Widevine/EME
protected inside an iframe and never reaches an `AnalyserNode`
([spotify/web-playback-sdk#25](https://github.com/spotify/web-playback-sdk/issues/25)). And a new
Spotify app in Development Mode is capped at 5 users, with Extended Quota needing a registered
business. Reading the machine's own audio has none of those limits — and it works for anything that
makes sound, not just Spotify.

## Fallback audio sources

Press **S** (or the *Source* button):

- **This computer's audio** — the host capture above (default), streamed to every browser watching.
- **Share a tab or your screen** — pick the Spotify tab and tick "Share tab audio". Needs https or
  localhost, so it is greyed out when you opened the page over plain LAN http.
- **Use input** — any input device, e.g. a loopback interface.
- **Built-in demo set** — the synthesised arrangement above, no Spotify at all.

## Keys and buttons

| Key | Action |
| --- | --- |
| F | Fullscreen |
| C | Cut to the next camera shot (auto-cam resumes ~25 s after you drag) |
| 1–9, 0 | Camera 1–10, all framed on the stage: wide, front L, front R, side, close, low, arc, raking, top, centrepiece |
| B | Camera 11: the DJ booth close-up |
| I | Put the live DJ feed (IMAG) on the side screens now, for 8 bars |
| L | Show the artist's logo / mark on the walls now |
| P | Fire pyro (CO2 jets, flames, cold-spark fountains and a fireworks salvo over the set) |
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
- **NoCopyrightSounds** — `web/data/ncs.json` is the NCS catalog: every release listed at
  ncs.io/music (about 2000 tracks, scraped by `server/ncs.js`, refreshed weekly into
  `cache/ncs/` and served at `/ncs/catalog`; the bundled snapshot is the fallback, so it works
  offline). `web/js/ncs.js` matches the playing track against it: the title with feat. / remix /
  edit qualifiers stripped plus any credited artist, an NCS compilation by its album name, and a
  few early releases that later left the site (Alan Walker's Fade and Spectre, Tobu, Ahrix). An
  NCS release carries the NCS lockup (public domain, bundled in `web/logos/`) on the walls
  instead of the artist's logo, as often as a headliner's, and the now-playing line says
  "NCS release".
- `web/js/centrepieces.js` — 21 centrepiece rigs (Martin Garrix "+", Armin's towers,
  Tiësto's arch, Hardwell's frame, Eric Prydz's HOLO screen, Swedish House Mafia's
  triangle, Carl Cox's ring, Alesso's orbit, DVBBS's X, Deadmau5 cube, Excision megawall,
  laser wall…) built from pixel strips, kinetic parts, panels and laser banks.
- `web/js/programs.js` — 27 LED wall programs (waves, rays, tunnel, shards, mandala,
  strobe bars, particles, glitch…) picked per panel by phase energy from the artist's pool.
- `web/js/fixtures.js` — GPU-instanced fixture arrays: `BeamArray` (moving heads with
  volumetric beams), `StrobeArray`, `LaserBank`, `PixelStrips`, `LedPanel`, `Crowd`,
  `Particles`.
- `web/js/stage.js` — the set, built 4x life size: ~210 moving heads, ~165 strobes/blinders,
  16 laser sources (~80 beams), thousands of architectural pixels (arches, trusses, towers,
  frames, runway) plus the centrepiece, the 20k crowd packed into the front of the field with
  phone lights, bloom, and the camera director (11 shots, drop cuts on the downbeat). Every
  shot frames the stage: there is no crowd-only, gate or DJ-point-of-view camera, the grounds
  are only ever the backdrop. Nothing stands in the crowd: no FOH platform or delay towers, so
  every shot from the field sees the whole stage. The rig is deliberately smaller than this
  project's first cut (heads and strobes a third fewer, lasers halved twice): the beams and
  fans frame the stage, the screens and the centrepiece instead of replacing them, and a drop
  never hides the stage behind a laser web. The air in front of the stage is kept clear as
  well: deck pyro is CO2, flames and cold sparks on the drop only, and the fireworks
  (`web/js/fireworks.js`: peonies, chrysanthemums, willows, rings, palms, crossettes and
  glitter shells in the song's colours) are launched from behind the set and burst above the
  roof line, on the drop, mid-phrase through the drop and the peak, and as a finale through
  the last half minute of the track, so nothing ever hangs between the camera and the set. There
  is no confetti, no water curtain and no haze sprite over the field. The *Lights* density scales
  how many beams and lasers are up at once and how bright they are, so the stage always stays visible.
  Lasers are run the way a laser operator runs them: the projectors on one truss share a
  look (mirrored fans, one phase running along the truss), each projector throws four to six
  beams, only one or two of the six laser groups fire at once, drops run them at reduced opacity,
  and a projector fades by up to three quarters by how squarely its fan faces the camera (a fan
  aimed into the lens is the one that hides the stage), so a drop is a few big coherent fans
  instead of a web of lines,
  and every laser is a pure saturated hue no matter what the LED palette is doing. Moving-head
  beams are narrow and fade along their length like beams in real haze, so a sky full of them
  stays a sky full of rays rather than a wash. On top of that an auto-iris does what a
  broadcast camera does: a small pass meters the HDR frame before tone mapping (16×9 cells,
  read back asynchronously), tracks the brightest quarter of the frame, and closes the
  exposure by up to a stop when a laser and beam wall starts to blow the stage out, so the
  stage stays legible through the heaviest drop moments and never dims on a dark wide shot.
- `web/js/festival.js` — the grounds under a pure black night sky (stars only, no moon, no sky glow):
  hills and tree lines, a ferris wheel and a drop tower with chasing pixel rims, four crowd
  lighting towers with pixel edges and level meters, six perimeter skytrackers, wristbands
  that pulse with the show, festoon strings over the field, the entrance gate with its pixel-outlined VIRTUAL-FEST sign, a lit
  cobble path with bollards and lamp posts, stage-colour light spill on the grass, and the
  stage dressing (PA hangs, subs, side screens, flame bars) and the DJ booth, built at stage
  scale so it reads from the field: a lit console (players, mixer, laptop, monitor wedges) and
  the DJ — `web/js/dj.js`, a duo or trio for acts like W&W or Dimitri Vegas & Like Mike —
  who plays the set to the beat grid: heads nodding and cueing in the groove, both hands up
  through the build, jumping and pumping fists on the drop, mixing and waving on the peak,
  hands on the players through the breakdown. Camera 11 (key **B**) sits in the booth, a few
  metres from the act. The figures carry broadcast lighting in their own shader (a Fresnel rim
  in the show's second colour and a soft camera-facing fill in the booth's light), so a DJ in a
  black tee never reads as a silhouette against the riser. The side screens carry an IMAG feed
  the way a festival's do: a second camera in the booth renders the act, the console and the
  walls behind them into a small render target every other frame, and the wings cut to it a
  phrase at a time (most in the groove, the build and the breakdown, a short cut a couple of
  bars into a drop, never over a logo or a text card), changing angle every four bars, with a
  duo or trio framed from further back. Key **I** puts the feed up now.

## Debugging

- `curl localhost:5173/config` — what the host resolved: capture backend, metadata, artwork, TLS.
- `curl localhost:5173/healthz` — liveness, tap state, connected browsers, uptime.
- `curl localhost:5173/status` — tap state and current track.
- `curl "localhost:5173/logo?artist=Martin%20Garrix&meta=1"` — logo cache entry for an artist.
- `curl "localhost:5173/ncs?title=Link&artist=Jim%20Yosef"` — is this track an NCS release (and which catalog entry).
- `curl localhost:5173/ncs/catalog` — the NCS catalog the server holds (`/status` reports its age and origin).
- `TAP_DEBUG=1 npm start` — per-second callback/byte counters from the native tap.
- `TAP_SUBDEV=1 npm start` — include the default output device in the aggregate (older behaviour).
- `window.__stage` in the console exposes `audio`, `director` (`.show` is the live frame), `stage`, `hud`.
