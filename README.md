# Virtual Music Festival

**Stop only listening to EDM. Watch it.**

A Tomorrowland / Ultra style festival main stage rendered live in your browser with three.js, driven
by whatever your Spotify is playing. LED walls, moving heads, strobes, lasers, pixel architecture,
CO2 jets, flames, cold sparks and fireworks all run to the beat grid of the actual song, on a
per-artist stage design with a per-song colour theme and the artist's real logo on the screens.

- 180+ artist profiles across 21 EDM genres, each with its own centrepiece: Martin Garrix's "+",
  Armin's towers, Tiesto's arch, Eric Prydz's HOLO, the deadmau5 cube, the Excision megawall.
  Unknown artists get their genre's rig.
- 21 centrepiece designs, 27 LED wall programs, 5 colour theme modes, so no two songs look alike.
- Real artist logos, fetched and cached. NoCopyrightSounds releases carry the NCS mark.
- Runs on macOS, Linux and Windows. Anyone on your network can watch the same show in their browser.

This is a local app, not a service. It runs on your machine, reads your own Spotify, and talks to
nothing but the logo and NCS lookups. No account, no Spotify login.

## Run

```sh
npm install
npm start          # serves http://localhost:5173
```

Open <http://localhost:5173>, press ENTER THE FESTIVAL, press play in Spotify. Node 18+ is required
(developed on Node 24). Then, per platform:

### macOS

Audio is captured with a Core Audio process tap (macOS 14.2+) that reads Spotify's own output. No
virtual audio driver is needed and Spotify keeps playing through your speakers. The tap binary
builds itself on first run, so you need the Xcode command line tools (`xcode-select --install` gives
you `swiftc`). The first start asks to let your terminal record system audio: accept it in System
Settings, Privacy and Security, Screen and System Audio Recording, then restart `npm start`. Title,
artist, artwork and position come from Spotify over AppleScript.

### Linux

Audio comes from the default sink's monitor source, so it follows whatever is coming out of the
speakers. Install the recorder and the metadata reader:

```sh
sudo apt install pulseaudio-utils playerctl     # Debian / Ubuntu (or pipewire-utils for pw-record)
sudo dnf install pulseaudio-utils playerctl     # Fedora
sudo pacman -S libpulse playerctl               # Arch
```

`parec` is used when present, otherwise `pw-record`. Title, artist, album, artwork and position come
from Spotify over MPRIS through `playerctl`.

### Windows

Windows has no always-present loopback device, so audio goes through ffmpeg and a loopback input:

1. Install ffmpeg and put it on `PATH` (`winget install Gyan.FFmpeg`).
2. Enable Stereo Mix (Sound settings, More sound settings, Recording, right-click, Show Disabled
   Devices, enable Stereo Mix), or install [VB-CABLE](https://vb-audio.com/Cable/) or VoiceMeeter and
   play Spotify into it.
3. `npm start`. The server auto-detects Stereo Mix / What U Hear / CABLE Output / VoiceMeeter Out /
   Loopback. If it picks the wrong one, run `ffmpeg -list_devices true -f dshow -i dummy` and set
   `VF_AUDIO_DEVICE` to the exact device name.

Title, artist, album and position come from Windows itself, read through Windows PowerShell 5.1, and
fall back to Spotify's window title. Windows exposes no album artwork, so the artwork colour blend is
skipped there. The artist and genre palettes still drive the whole show.

### Any platform: bring your own capture

Set `VF_AUDIO_CMD` to any command that writes float32 little-endian, mono, 48 kHz PCM to stdout and
it is used instead of the built-in backends:

```sh
VF_AUDIO_CMD='ffmpeg -f pulse -i my.monitor -ac 1 -ar 48000 -f f32le -' npm start
```

## Watching from another device on your network

The server listens on every interface, so the show is at `http://<your-lan-ip>:5173` for anything on
the same Wi-Fi: a second laptop, a TV browser, the projector in the room. The addresses are printed
on startup. Audio and track info still come from the machine running the server, so every viewer sees
the same show, in sync, with no Spotify setup of their own.

One browser caveat: `AudioWorklet` and tab sharing are secure-context only, and a plain
`http://192.168.x.x` address is not a secure context. Over LAN http the app falls back to a
`ScriptProcessorNode` path automatically, which is what fixes
`undefined is not an object (evaluating 'ctx.audioWorklet.addModule')`. It costs about 20 ms of extra
latency and that is compensated for in the sync. For the tighter path, serve it over TLS:

```sh
# a self-signed pair is enough on a home network; browsers will warn once
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout key.pem -out cert.pem -subj "/CN=$(hostname)"
VF_TLS_CERT=cert.pem VF_TLS_KEY=key.pem npm start     # now https://<your-lan-ip>:5173
```

Phones and tablets get a "come back on a computer" notice, since the show wants a wide screen and a
real GPU, with a "let me in anyway" button for small laptops and desktops that report a touch screen.

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5173` | HTTP/WS port |
| `HOST` | `0.0.0.0` | Bind address. Set `127.0.0.1` to keep it off the network |
| `VF_POLL_MS` | `400` | How often the now-playing metadata is polled |
| `VF_AUDIO_CMD` | none | Your own capture command (float32le mono 48 kHz on stdout) |
| `VF_AUDIO_DEVICE` | auto | Windows: the exact dshow device name to record |
| `VF_TLS_CERT` / `VF_TLS_KEY` | none | Serve https instead of http (both required) |
| `TAP_DEBUG` | none | macOS: per-second callback and byte counters from the native tap |
| `TAP_SUBDEV` | none | macOS: include the default output device in the aggregate |

## Audio sources

Press S, or the Source button:

- This computer's audio: the host capture above, the default, streamed to every browser watching.
- Share a tab or your screen: pick the Spotify tab and tick "Share tab audio". Needs https or
  localhost, so it is greyed out when the page was opened over plain LAN http.
- Use input: any input device, for example a loopback interface.
- Built-in demo set: a synthesised EDM arrangement, no Spotify at all.

## Demo set (no Spotify)

Open <http://localhost:5173/?demo> and a built-in 135 s arrangement (intro, groove, build, drop,
breakdown, build, drop) plays through the speakers and drives the show. Add an artist to get their
rig, logo and colour treatment: `/?demo=Armin%20van%20Buuren`, `/?demo=Charlotte%20de%20Witte`
(default: Martin Garrix). Add `&song=` to give the set a real title, so
`/?demo=Jim%20Yosef&song=Link` plays it as an NCS release.

## Keys and buttons

| Key | Action |
| --- | --- |
| F | Fullscreen |
| C | Cut to the next camera shot (auto-cam resumes about 25 s after you drag) |
| 1-9, 0 | Camera 1-10, all framed on the stage |
| B | Camera 11: the DJ booth close-up |
| I | Put the live DJ feed (IMAG) on the side screens now, for 8 bars |
| L | Show the artist's logo or mark on the walls now |
| P | Fire pyro (CO2, flames, cold sparks and a fireworks salvo over the set) |
| D | Force a drop on the next beat |
| - / = | Fewer or more beams and lasers (the Lights button cycles low, med, high) |
| [ / ] | Nudge sync lead by 10 ms if hits feel late or early |
| H | Hide or show the HUD |
| S | Source menu |
| Drag / wheel | Orbit camera |

## How the show works

- `web/js/director.js`: an onset-detection worklet feeds hop energies to tempo tracking
  (autocorrelation plus phase lock), which predicts the beat grid ahead of the audio, infers
  downbeats and 8 or 16 bar phrases, and drives a phase machine (intro, groove, build, drop, peak,
  breakdown) with kick, snare and hat envelopes, strobe rate, whiteouts and pyro cues.
- `web/js/artists.js`: 180+ artist profiles across 21 genres, each with a signature palette,
  centrepiece, mark and style. The track hashes into a seed, so every song gets its own look.
- Colour themes: an artist's brand colours anchor the show but never own it. Every song picks one of
  five palette modes (signature, hue shift, brand plus genre blend, harmony scheme, guest genre
  palette), never the same one twice in a row, and vivid album artwork colours are merged in.
- Logos: `server/logos.js` fetches the real logo (TheAudioDB, then Wikidata, then Wikimedia Commons)
  and caches it. The walls reveal it on song start, drops and breakdowns, falling back to the
  procedural marks in `web/js/marks.js`.
- NoCopyrightSounds: `web/data/ncs.json` holds the catalog (about 2000 releases, refreshed weekly by
  `server/ncs.js`). A match puts the NCS lockup on the walls and "NCS release" on the now-playing
  line.
- `web/js/stage.js`: the set, built four times life size over a 20k crowd. About 210 moving heads,
  165 strobes, 16 laser sources, thousands of architectural pixels, the centrepiece, bloom, and a
  camera director with 11 shots that all stay on the stage. An auto-iris meters the HDR frame and
  closes the exposure by up to a stop so the stage stays legible through the heaviest drops.
- `web/js/festival.js`: the grounds under a pure black star sky. Ferris wheel, drop tower, lighting
  towers, skytrackers, festoons, entrance gate, and the DJ booth at stage scale with the DJ (or duo
  or trio) playing the set to the beat grid, plus an IMAG feed on the side screens.
- `web/js/fireworks.js`: peonies, chrysanthemums, willows, rings, palms and crossettes in the song's
  colours, launched from behind the set and bursting above the roof line, so nothing ever hangs
  between the camera and the stage.

## Why it reads your own audio instead of using the Spotify API

Spotify's `/v1/audio-features` and `/v1/audio-analysis` endpoints (tempo, beats, bars, sections) were
deprecated on 27 November 2024 and return 403 for every new app, so the beat grid has to come from
the audio itself. The Web Playback SDK cannot help either: its audio is Widevine protected inside an
iframe and never reaches an `AnalyserNode`
([spotify/web-playback-sdk#25](https://github.com/spotify/web-playback-sdk/issues/25)). A new Spotify
app in Development Mode is also capped at 5 users. Reading the machine's own audio has none of those
limits, and it works for anything that makes sound.

## Debugging

- `curl localhost:5173/config`: what the host resolved, so capture backend, metadata, artwork, TLS.
- `curl localhost:5173/healthz`: liveness, tap state, connected browsers, uptime.
- `curl localhost:5173/status`: tap state and current track.
- `curl "localhost:5173/logo?artist=Martin%20Garrix&meta=1"`: the logo cache entry for an artist.
- `curl "localhost:5173/ncs?title=Link&artist=Jim%20Yosef"`: is this track an NCS release.
- `TAP_DEBUG=1 npm start`: per-second callback and byte counters from the native tap.
- `window.__stage` in the console exposes `audio`, `director`, `stage` and `hud`.

## Licence

MIT. The looping clip behind the splash is `web/background.mp4`; replace it with any H.264 mp4 of
your own and the page will use it.
