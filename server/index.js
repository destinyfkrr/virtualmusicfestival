// Virtual Music Festival — server
//  - serves the web app + three.js from node_modules
//  - captures whatever the machine is playing (macOS / Linux / Windows) and streams raw Float32 PCM over WebSocket
//  - polls the platform for Spotify's now-playing metadata
//  - proxies album artwork so the browser can read pixels for palette extraction
//  - fetches + caches real artist logos (TheAudioDB / Wikidata / Commons) for the LED screens
//  - keeps the NoCopyrightSounds catalog (ncs.io) so an NCS release gets the NCS mark on the walls

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createLogoHandler } from './logos.js';
import { createNcs } from './ncs.js';
import { createAudioSource } from './audio-source.js';
import { createMetadata } from './metadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const POLL_MS = Number(process.env.VF_POLL_MS || 400);
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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const ART_HOSTS = new Set(['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com']);

// Range requests matter for the splash video: Safari will not start a <video> at all unless the
// server answers 206, and a seek or a loop restart is a range request in every browser.
function sendFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const media = type.startsWith('video/') || type.startsWith('audio/');
    const head = { 'Content-Type': type, 'Cache-Control': media ? 'public, max-age=3600' : 'no-cache' };
    const range = media && req ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '') : null;
    if (media) head['Accept-Ranges'] = 'bytes';
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(st.size - 1, end);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base) ? p : null;
}

function sendJSON(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
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

// what the machine can offer this browser, so the UI can describe the right next step
function config() {
  return {
    app: 'Virtual Music Festival',
    platform: process.platform,
    tap: tapState,
    // the native capture backend by platform, for the source menu's wording
    capture: process.env.VF_AUDIO_CMD ? 'custom' :
      process.platform === 'darwin' ? 'coreaudio' :
      process.platform === 'linux' ? 'pulse' :
      process.platform === 'win32' ? 'dshow' : 'none',
    metadata: ['darwin', 'linux', 'win32'].includes(process.platform),
    artwork: process.platform !== 'win32',   // the Windows transport controls do not hand out artwork
    tls: !!TLS,
  };
}

const handler = (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/art') return proxyArt(req, res, u.searchParams.get('url') || '');
  if (u.pathname === '/logo') return handleLogo(req, res, u.searchParams.get('artist') || '', u.searchParams.has('meta'));
  if (u.pathname === '/ncs/catalog') return ncs.handleCatalog(req, res);
  if (u.pathname === '/ncs') return ncs.handleMatch(req, res, u);
  if (u.pathname === '/config') return sendJSON(res, config());
  if (u.pathname === '/healthz') return sendJSON(res, { ok: true, tap: tapState, clients: wss.clients.size, uptime: Math.round(process.uptime()) });
  if (u.pathname === '/status') return sendJSON(res, { tap: tapState, audioFormat, track: lastTrack, clients: wss.clients.size, ncs: ncs.info(), ...config() });
  if (u.pathname.startsWith('/vendor/three/')) {
    const f = safeJoin(THREE_DIR, u.pathname.slice('/vendor/three/'.length));
    return f ? sendFile(res, f, req) : (res.writeHead(403), res.end());
  }
  const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  const f = safeJoin(WEB, rel);
  return f ? sendFile(res, f, req) : (res.writeHead(403), res.end());
};

// https:// unlocks AudioWorklet (and screen sharing) for anyone opening the show from another
// machine; over plain http:// the browser falls back to ScriptProcessorNode. See the README.
const TLS = process.env.VF_TLS_CERT && process.env.VF_TLS_KEY
  ? { cert: fs.readFileSync(process.env.VF_TLS_CERT), key: fs.readFileSync(process.env.VF_TLS_KEY) }
  : null;
const server = TLS ? https.createServer(TLS, handler) : http.createServer(handler);

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

// ------------------------------------------------------------- audio capture
const tap = createAudioSource({
  root: ROOT,
  log: (...a) => console.log(...a),
  onPCM: broadcastBinary,
  onFormat: (fmt) => { audioFormat = fmt; broadcastJSON({ type: 'audio-format', ...fmt }); },
  onState: (s) => { if (s !== tapState) { tapState = s; broadcastJSON({ type: 'tap', state: s }); console.log(`[tap] ${s}`); } },
});

// ----------------------------------------------------------- now-playing feed
const meta = createMetadata({
  intervalMs: POLL_MS,
  log: (...a) => console.log(...a),
  onTrack: (t) => { lastTrack = t; broadcastJSON(t); },
});

function lanAddresses() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const scheme = TLS ? 'https' : 'http';
  console.log(`\n  Virtual Music Festival  →  ${scheme}://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const addr of lanAddresses()) console.log(`                          →  ${scheme}://${addr}:${PORT}`);
  }
  console.log('');
  tap.start();
  ncs.start();
  meta.start();
});

function shutdown() { tap.stop(); meta.stop(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
