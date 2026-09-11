// Cross-platform audio capture.
//
// Every backend does the same job: hand the server a stream of mono Float32 PCM at 48 kHz,
// which it fans out to the browsers over WebSocket. Only the way we get at the machine's
// audio differs.
//
//   macOS    native/spotifytap   Core Audio process tap, Spotify only (macOS 14.2+)
//   Linux    parec / pw-record   the default sink's monitor (PulseAudio or PipeWire)
//   Windows  ffmpeg (dshow)      a loopback device: Stereo Mix, VB-CABLE, VoiceMeeter...
//   any      $VF_AUDIO_CMD       your own command, as long as it writes float32le mono to stdout
//
// States reported to the browser: starting | live | spotify-closed | permission | unavailable | stopped.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

const RATE = 48000;

function have(cmd) {
  return new Promise((res) => {
    const probe = process.platform === 'win32' ? ['where', [cmd]] : ['sh', ['-c', `command -v ${cmd}`]];
    execFile(probe[0], probe[1], (err, out) => res(!err && String(out).trim().length > 0));
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((res) => execFile(cmd, args, { timeout: 4000, ...opts }, (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

/**
 * @param {object} o
 * @param {(fmt:{sampleRate:number,channels:number})=>void} o.onFormat
 * @param {(chunk:Buffer)=>void} o.onPCM      whole Float32 frames only
 * @param {(state:string)=>void} o.onState
 * @param {(...a:any)=>void} o.log
 * @param {string} o.root                      project root (for native/)
 */
export function createAudioSource({ onFormat, onPCM, onState, log, root }) {
  const TAP_BIN = path.join(root, 'native', 'spotifytap');
  const TAP_BUILD = path.join(root, 'native', 'build.sh');

  let proc = null;
  let restartTimer = null;
  let stopped = false;
  let pending = Buffer.alloc(0);

  // forward only whole Float32 frames so the browser never sees a torn sample
  function feed(chunk) {
    const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = buf.length - (buf.length % 4);
    pending = Buffer.from(buf.subarray(usable));
    if (usable) onPCM(buf.subarray(0, usable));
  }

  function retry(ms) {
    if (stopped) return;
    restartTimer = setTimeout(start, ms);
  }

  // ------------------------------------------------------------------ macOS
  function startMac() {
    if (!fs.existsSync(TAP_BIN)) {
      log('[tap] building native/spotifytap (needs Xcode Command Line Tools)...');
      return execFile('sh', [TAP_BUILD], (err, _o, stderr) => {
        if (err) { log('[tap] build failed:\n' + stderr); return onState('unavailable'); }
        start();
      });
    }
    onState('starting');
    const p = proc = spawn(TAP_BIN, ['com.spotify.client'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errBuf = '';
    p.stdout.on('data', feed);
    p.stderr.on('data', (d) => {
      errBuf += d.toString();
      let nl;
      while ((nl = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, nl).trim(); errBuf = errBuf.slice(nl + 1);
        if (!line) continue;
        // the tap announces its stream format as one JSON line, then starts writing PCM
        if (line.startsWith('{')) { try { onFormat(JSON.parse(line)); onState('live'); } catch {} }
        else log('[tap]', line);
      }
    });
    p.on('exit', (code) => {
      proc = null;
      onState(code === 2 ? 'spotify-closed' : code === 3 ? 'permission' : 'stopped');
      retry(code === 3 ? 10000 : 3000);
    });
    p.on('error', (e) => log('[tap] spawn error', e.message));
  }

  // ------------------------------------------------------------------ Linux
  // PulseAudio and PipeWire both expose every output as a ".monitor" source you can record.
  async function linuxMonitor() {
    const { err, stdout } = await run('pactl', ['get-default-sink']);
    const sink = stdout.trim();
    if (!err && sink && !sink.includes(' ')) return `${sink}.monitor`;
    return '@DEFAULT_MONITOR@';
  }

  async function startLinux() {
    onState('starting');
    const device = process.env.VF_AUDIO_DEVICE || await linuxMonitor();
    let cmd, args;
    if (await have('parec')) {
      cmd = 'parec';
      args = ['--format=float32le', `--rate=${RATE}`, '--channels=1', '--latency-msec=40',
              '--client-name=virtual-music-festival', `--device=${device}`];
    } else if (await have('pw-record')) {
      cmd = 'pw-record';
      args = ['--rate', String(RATE), '--channels', '1', '--format', 'f32', '--target', device, '-'];
    } else {
      log('[tap] no recorder found. Install PulseAudio utils (parec) or PipeWire utils (pw-record):');
      log('[tap]   Debian/Ubuntu:  sudo apt install pulseaudio-utils');
      log('[tap]   Fedora:         sudo dnf install pulseaudio-utils');
      log('[tap]   Arch:           sudo pacman -S libpulse');
      return onState('unavailable');
    }
    log(`[tap] ${cmd} ← ${device}`);
    spawnStream(cmd, args);
  }

  // ---------------------------------------------------------------- Windows
  // Windows has no always-present loopback device, so we look for whichever one the user has:
  // Realtek's "Stereo Mix", VB-CABLE, VoiceMeeter, or anything they name in $VF_AUDIO_DEVICE.
  const WIN_LOOPBACK = [/stereo mix/i, /what u hear/i, /wave out mix/i, /cable output/i, /voicemeeter out/i, /loopback/i];

  async function windowsDevice() {
    if (process.env.VF_AUDIO_DEVICE) return process.env.VF_AUDIO_DEVICE;
    // ffmpeg prints the device list to stderr and then exits non-zero; that is expected
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    const names = [...stderr.matchAll(/"([^"]+)"\s*\(audio\)/g)].map((m) => m[1]);
    for (const re of WIN_LOOPBACK) { const hit = names.find((n) => re.test(n)); if (hit) return hit; }
    return null;
  }

  async function startWindows() {
    onState('starting');
    if (!await have('ffmpeg')) {
      log('[tap] ffmpeg not found. Install it (winget install Gyan.FFmpeg) and enable a loopback device,');
      log('[tap] or use the browser\'s "Share tab audio" source instead — see the README.');
      return onState('unavailable');
    }
    const device = await windowsDevice();
    if (!device) {
      log('[tap] no loopback input found. Enable "Stereo Mix" in Sound > Recording, or install VB-CABLE,');
      log('[tap] then set VF_AUDIO_DEVICE="<device name>". The browser\'s "Share tab audio" source also works.');
      return onState('unavailable');
    }
    log(`[tap] ffmpeg ← ${device}`);
    spawnStream('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-audio_buffer_size', '40',
                           '-i', `audio=${device}`, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  }

  // ------------------------------------------------- generic stdout streamer
  function spawnStream(cmd, args) {
    const p = proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let announced = false;
    p.stdout.on('data', (chunk) => {
      if (!announced) { announced = true; onFormat({ sampleRate: RATE, channels: 1 }); onState('live'); }
      feed(chunk);
    });
    p.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) log('[tap]', s.split('\n')[0]); });
    p.on('exit', () => { proc = null; onState('stopped'); retry(3000); });
    p.on('error', (e) => { log('[tap] spawn error', e.message); onState('unavailable'); });
  }

  function start() {
    restartTimer = null;
    if (stopped) return;
    pending = Buffer.alloc(0);
    if (process.env.VF_AUDIO_CMD) {
      onState('starting');
      log(`[tap] $VF_AUDIO_CMD: ${process.env.VF_AUDIO_CMD}`);
      const shell = process.platform === 'win32' ? ['cmd', ['/c', process.env.VF_AUDIO_CMD]] : ['sh', ['-c', process.env.VF_AUDIO_CMD]];
      return spawnStream(shell[0], shell[1]);
    }
    if (process.platform === 'darwin') return startMac();
    if (process.platform === 'linux') return startLinux();
    if (process.platform === 'win32') return startWindows();
    log(`[tap] no capture backend for ${process.platform}; set $VF_AUDIO_CMD or use the browser source.`);
    onState('unavailable');
  }

  function stop() {
    stopped = true;
    clearTimeout(restartTimer);
    if (proc) { try { proc.kill('SIGINT'); } catch {} proc = null; }
  }

  return { start, stop };
}
