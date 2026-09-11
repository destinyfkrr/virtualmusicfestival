// What the server can actually do on the machine it is running on, and what this browser can do with it.
// /config answers { app, platform, tap, capture, metadata, artwork, tls }; everything here degrades to
// sensible copy if the fetch fails, so the page still works when it is opened straight off the disk.

const CAPTURE = {
  coreaudio: {
    name: "the host Mac's Spotify",
    note: 'A Core Audio process tap reads Spotify itself, so nothing else on the machine leaks into the show. '
        + 'macOS 14.2 or newer. If macOS asked for a "System Audio Recording" permission, grant it to the terminal running the server and restart it.',
  },
  pulse: {
    name: "the host Linux box's audio",
    note: 'Recorded from the default sink\'s monitor through PulseAudio or PipeWire, so it follows whatever is coming out of the speakers. '
        + 'Needs pulseaudio-utils (parec) or pipewire-utils (pw-record), plus playerctl for the track names.',
  },
  dshow: {
    name: "the host PC's audio",
    note: 'Recorded through ffmpeg from a loopback device — Stereo Mix, VB-CABLE or VoiceMeeter. '
        + 'Track names come from Windows itself, so album art is not available on Windows.',
  },
  custom: {
    name: 'the host machine\'s audio',
    note: 'Captured by your own VF_AUDIO_CMD command.',
  },
  none: {
    name: 'the host machine\'s audio',
    note: 'No capture backend was found on the server. Share a tab instead, or run the built-in demo set.',
  },
};

export async function loadConfig() {
  try {
    const r = await fetch('/config', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return { app: 'Virtual Music Festival', platform: '', tap: 'unavailable', capture: 'none', metadata: false, artwork: true, tls: false };
  }
}

export function captureCopy(cfg) {
  return CAPTURE[cfg && cfg.capture] || CAPTURE.none;
}

/** true when getDisplayMedia and AudioWorklet are available: both want a secure context (https, or localhost) */
export function secure() {
  return globalThis.isSecureContext !== false;
}

/** The one line under the ENTER button: what to do next, in the order it will bite. */
export function enterStep(cfg) {
  if (!cfg || cfg.capture === 'none') return 'No audio capture on the server — press enter for the built-in demo set, or share a tab once you are in.';
  if (cfg.tap === 'permission') return 'The server needs screen/audio recording permission. Grant it to the terminal running the server, then restart it.';
  if (cfg.tap === 'spotify-closed') return 'Open Spotify on the machine running the server and press play, then press enter.';
  if (cfg.tap === 'unavailable') return 'The server could not find an audio capture tool — press enter for the demo set, or share a tab once you are in.';
  return 'Press play on Spotify, then enter the festival.';
}

/** The small print at the bottom of the source menu: capture note + the insecure-origin caveat, if any. */
export function sourceNote(cfg) {
  const parts = [captureCopy(cfg).note];
  if (!secure()) {
    parts.push('You opened this over plain http:// from another machine, so the browser blocks tab sharing and the '
             + 'low-latency audio path. The show still runs on the fallback path. For the tighter one, run the server '
             + 'with VF_TLS_CERT and VF_TLS_KEY and open it over https://.');
  }
  return parts.join(' ');
}

/** Phones and tablets: the show wants a wide screen and a real GPU. Desktops with touchscreens are not caught. */
export function isSmallScreen() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const narrow = Math.min(innerWidth, innerHeight) < 560 || innerWidth < 900;
  const phoneUA = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent);
  const tabletUA = /iPad|Android(?!.*Mobile)|Tablet/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS pretends to be a Mac
  return phoneUA || tabletUA || (coarse && narrow);
}
