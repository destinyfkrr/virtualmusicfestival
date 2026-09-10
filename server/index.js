// Virtual-Fest server
//  - serves the web app + three.js from node_modules
//  - supervises the native Spotify audio tap and streams raw Float32 PCM over WebSocket
//  - polls Spotify (AppleScript) for now-playing metadata
//  - proxies album artwork so the browser can read pixels for palette extraction
//  - fetches + caches real artist logos (TheAudioDB / Wikidata / Commons) for the LED screens
//  - keeps the NoCopyrightSounds catalog (ncs.io) so an NCS release gets the NCS mark on the walls

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createLogoHandler } from './logos.js';
import { createNcs } from './ncs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const TAP_BIN = path.join(ROOT, 'native', 'spotifytap');
const TAP_BUILD = path.join(ROOT, 'native', 'build.sh');
const SCRIPT = path.join(__dirname, 'spotify.applescript');
const PORT = Number(process.env.PORT || 5173);
const POLL_MS = 400;
const LOGO_CACHE = path.join(ROOT, 'cache', 'logos');
const handleLogo = createLogoHandler(LOGO_CACHE, path.join(WEB, 'logos'));
const ncs = createNcs({ cacheDir: path.join(ROOT, 'cache', 'ncs'), bundled: path.join(WEB, 'data', 'ncs.json') });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const ART_HOSTS = new Set(['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com']);

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base) ? p : null;
}

async function proxyArt(req, res, url) {
  let target;
  try { target = new URL(url); } catch { res.writeHead(400); res.end('bad url'); return; }
  if (target.protocol !== 'https:' || !ART_HOSTS.has(target.hostname)) { res.writeHead(403); res.end('host not allowed'); return; }
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { res.writeHead(r.status); res.end(); return; }
    res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502); res.end(String(e));
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/art') return proxyArt(req, res, u.searchParams.get('url') || '');
  if (u.pathname === '/logo') return handleLogo(req, res, u.searchParams.get('artist') || '', u.searchParams.has('meta'));
  if (u.pathname === '/ncs/catalog') return ncs.handleCatalog(req, res);
  if (u.pathname === '/ncs') return ncs.handleMatch(req, res, u);
  if (u.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tap: tapState, audioFormat, track: lastTrack, clients: wss.clients.size, ncs: ncs.info() }));
  }
  if (u.pathname.startsWith('/vendor/three/')) {
    const f = safeJoin(THREE_DIR, u.pathname.slice('/vendor/three/'.length));
    return f ? sendFile(res, f) : (res.writeHead(403), res.end());
  }
  const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  const f = safeJoin(WEB, rel);
  return f ? sendFile(res, f) : (res.writeHead(403), res.end());
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
let audioFormat = null;
let lastTrack = { type: 'track', state: 'stopped' };
let tapState = 'starting';

function broadcastJSON(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
function broadcastBinary(buf) {
  for (const c of wss.clients) if (c.readyState === 1 && c.bufferedAmount < 1_000_000) c.send(buf, { binary: true });
}

wss.on('connection', (ws) => {
  if (audioFormat) ws.send(JSON.stringify({ type: 'audio-format', ...audioFormat }));
  ws.send(JSON.stringify({ type: 'tap', state: tapState }));
  ws.send(JSON.stringify(lastTrack));
});

// ---------------------------------------------------------------- Native tap supervisor
let tapProc = null;
let restartTimer = null;

function setTapState(s) {
  if (s !== tapState) { tapState = s; broadcastJSON({ type: 'tap', state: s }); console.log(`[tap] ${s}`); }
}

function buildTap(cb) {
  console.log('[tap] building native/spotifytap (needs Xcode Command Line Tools)...');
  execFile('sh', [TAP_BUILD], (err, stdout, stderr) => {
    if (err) { console.error('[tap] build failed:\n' + stderr); return cb(false); }
    cb(true);
  });
}

function startTap() {
  restartTimer = null;
  if (!fs.existsSync(TAP_BIN)) {
    return buildTap((ok) => { if (ok) startTap(); else { setTapState('unavailable'); } });
  }
  setTapState('starting');
  const p = spawn(TAP_BIN, ['com.spotify.client'], { stdio: ['ignore', 'pipe', 'pipe'] });
  tapProc = p;
  let pending = Buffer.alloc(0);
  let errBuf = '';

  p.stdout.on('data', (chunk) => {
    // keep sample alignment: only forward whole Float32 frames
    let buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = buf.length - (buf.length % 4);
    pending = buf.subarray(usable);
    if (usable) broadcastBinary(buf.subarray(0, usable));
  });
  p.stderr.on('data', (d) => {
    errBuf += d.toString();
    let nl;
    while ((nl = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, nl).trim(); errBuf = errBuf.slice(nl + 1);
      if (!line) continue;
      if (line.startsWith('{')) {
        try { audioFormat = JSON.parse(line); broadcastJSON({ type: 'audio-format', ...audioFormat }); setTapState('live'); } catch {}
      } else console.log('[tap]', line);
    }
  });
  p.on('exit', (code) => {
    tapProc = null;
    if (code === 2) setTapState('spotify-closed');
    else if (code === 3) setTapState('permission');
    else setTapState('stopped');
    restartTimer = setTimeout(startTap, code === 3 ? 10000 : 3000);
  });
  p.on('error', (e) => { console.error('[tap] spawn error', e.message); });
}

// ---------------------------------------------------------------- Spotify metadata poller
let polling = false;
function pollSpotify() {
  if (polling) return;
  polling = true;
  execFile('pgrep', ['-xq', 'Spotify'], (notRunning) => {
    if (notRunning) {
      polling = false;
      const t = { type: 'track', state: 'stopped', ts: Date.now() };
      if (lastTrack.state !== 'stopped') { lastTrack = t; broadcastJSON(t); }
      return;
    }
    execFile('osascript', [SCRIPT], { timeout: 2000 }, (err, stdout) => {
      polling = false;
      if (err) {
        const t = { type: 'track', state: 'stopped', ts: Date.now() };
        if (lastTrack.state !== 'stopped') { lastTrack = t; broadcastJSON(t); }
        return;
      }
      const [state, name, artist, album, art, position, duration, id, albumArtist] = stdout.trim().split('\t');
      lastTrack = {
        type: 'track', state, name, artist, album, albumArtist: albumArtist || '', art, id,
        position: parseFloat(position) || 0,
        duration: (parseFloat(duration) || 0) / 1000,
        ts: Date.now(),
      };
      broadcastJSON(lastTrack);
    });
  });
}

server.listen(PORT, () => {
  console.log(`\n  Virtual-Fest  →  http://localhost:${PORT}\n`);
  startTap();
  ncs.start();
  setInterval(pollSpotify, POLL_MS);
});

process.on('SIGINT', () => { if (tapProc) tapProc.kill('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { if (tapProc) tapProc.kill('SIGINT'); process.exit(0); });
