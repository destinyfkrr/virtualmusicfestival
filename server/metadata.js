// Cross-platform "what is Spotify playing right now".
//
//   macOS    osascript on Spotify's AppleScript dictionary  — full metadata incl. artwork
//   Linux    playerctl (MPRIS/D-Bus)                        — full metadata incl. artwork
//   Windows  the system media transport controls (WinRT)    — title/artist/album/position, no artwork
//
// Every backend resolves to the same shape, which is what the browser and the show director read:
//   { type:'track', state, name, artist, album, albumArtist, art, id, position, duration, ts }

import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STOPPED = () => ({ type: 'track', state: 'stopped', ts: Date.now() });

function exec(cmd, args, opts = {}) {
  return new Promise((res) => execFile(cmd, args, { timeout: 4000, ...opts }, (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

// a stable id for backends that do not expose one, so the show only resets on a real track change
function synthId(artist, name) {
  return 'np:' + `${artist}|${name}`.toLowerCase().replace(/[^a-z0-9|]+/g, '-').slice(0, 96);
}

// ------------------------------------------------------------------- macOS
const APPLESCRIPT = path.join(__dirname, 'spotify.applescript');

async function readMac() {
  const running = await exec('pgrep', ['-xq', 'Spotify']);
  if (running.err) return STOPPED();
  const { err, stdout } = await exec('osascript', [APPLESCRIPT], { timeout: 2000 });
  if (err) return STOPPED();
  const [state, name, artist, album, art, position, duration, id, albumArtist] = stdout.trim().split('\t');
  return {
    type: 'track', state, name, artist, album, albumArtist: albumArtist || '', art, id,
    position: parseFloat(position) || 0,
    duration: (parseFloat(duration) || 0) / 1000,
    ts: Date.now(),
  };
}

// ------------------------------------------------------------------- Linux
// MPRIS reports position and length in microseconds, and the track id as a D-Bus object path.
const PLAYERCTL_FMT = [
  '{{status}}', '{{xesam:title}}', '{{xesam:artist}}', '{{xesam:album}}',
  '{{mpris:artUrl}}', '{{position}}', '{{mpris:length}}', '{{mpris:trackid}}', '{{xesam:albumArtist}}',
].join('\t');

let playerctlMissing = false;

async function readLinux() {
  if (playerctlMissing) return STOPPED();
  const { err, stdout, stderr } = await exec('playerctl', ['--player=spotify,%any', 'metadata', '--format', PLAYERCTL_FMT]);
  if (err) {
    if (/not found|ENOENT/i.test(stderr) || err.code === 'ENOENT') playerctlMissing = true;
    return STOPPED();
  }
  const [status, name, artist, album, art, position, length, trackid, albumArtist] = stdout.trim().split('\t');
  if (!name) return STOPPED();
  return {
    type: 'track',
    state: (status || '').toLowerCase() === 'playing' ? 'playing' : (status || '').toLowerCase() === 'paused' ? 'paused' : 'stopped',
    name, artist: artist || '', album: album || '', albumArtist: albumArtist || '',
    art: art || '',
    // /com/spotify/track/<base62>  ->  spotify:track:<base62>
    id: /spotify\/track\//.test(trackid || '') ? 'spotify:track:' + trackid.split('/').pop() : (trackid || synthId(artist, name)),
    position: (parseFloat(position) || 0) / 1e6,
    duration: (parseFloat(length) || 0) / 1e6,
    ts: Date.now(),
  };
}

// ----------------------------------------------------------------- Windows
// Windows PowerShell 5.1 (powershell.exe, not pwsh) is what can project the WinRT async APIs.
const PS_SCRIPT = path.join(__dirname, 'windows-nowplaying.ps1');
let psFailures = 0;

async function readWindows() {
  const { err, stdout } = await exec('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT], { timeout: 6000 });
  if (err) { psFailures++; return STOPPED(); }
  psFailures = 0;
  const line = stdout.trim();
  if (!line || line === 'stopped') return STOPPED();
  const [state, name, artist, album, position, duration, albumArtist] = line.split('\t');
  if (!name) return STOPPED();
  return {
    type: 'track', state: state || 'playing', name, artist: artist || '', album: album || '',
    albumArtist: albumArtist || '',
    art: '',                                   // the transport controls only expose artwork as a stream
    id: synthId(artist, name),
    position: parseFloat(position) || 0,
    duration: parseFloat(duration) || 0,
    ts: Date.now(),
  };
}

const READERS = { darwin: readMac, linux: readLinux, win32: readWindows };

/**
 * Polls the platform for now-playing metadata and calls onTrack whenever it changes.
 * @param {{onTrack:(t:object)=>void, log?:(...a:any)=>void, intervalMs?:number}} o
 */
export function createMetadata({ onTrack, log = () => {}, intervalMs = 400 }) {
  const read = READERS[process.platform];
  let timer = null, busy = false, last = STOPPED();

  if (!read) log(`[meta] no now-playing backend for ${process.platform}; the show will run on audio alone.`);

  async function tick() {
    if (busy) return;
    busy = true;
    let t;
    try { t = await read(); } catch { t = STOPPED(); } finally { busy = false; }
    // a stopped->stopped repeat is not news; anything else is
    if (t.state === 'stopped' && last.state === 'stopped') return;
    last = t;
    onTrack(t);
  }

  return {
    start() { if (read && !timer) { tick(); timer = setInterval(tick, intervalMs); } },
    stop() { clearInterval(timer); timer = null; },
    get last() { return last; },
  };
}
