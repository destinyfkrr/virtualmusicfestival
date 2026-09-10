import { AudioEngine } from './audio.js';
import { ShowDirector } from './director.js';
import { Stage } from './stage.js';
import { Hud } from './hud.js';
import { paletteFromArt, mergeArtPalette } from './palette.js';
import { resolveProfile } from './artists.js';
import { loadLogo, loadLogoUrl, primaryArtist } from './logos.js';
import { loadNcsCatalog, NCS_LOGO, NCS_NAME } from './ncs.js';

const canvas = document.getElementById('stage');
const audio = new AudioEngine();
const director = new ShowDirector();
director.setClock(audio);
audio.onAnalysis = (m) => director.ingest(m);
const stage = new Stage(canvas, director);
const hud = new Hud(audio, stage, director);
window.__stage = { audio, director, stage, hud };
const ncsReady = loadNcsCatalog();   // the NoCopyrightSounds catalog (a local JSON); matches resolve once it is in

// new song → artist/genre profile (stage design, palette, programs, seed) → structure reset
let lastTrackId = null;
audio.onTrack = (t) => {
  hud.setTrack(t);
  if (t.id && t.id !== lastTrackId) {
    lastTrackId = t.id;
    const profile = resolveProfile(t);
    director.setProfile(profile);
    director.setSeed(profile.seed);
    director.resetTrack();
    stage.setProfile(profile);
    hud.setProfile(profile);
    // the real logo (server-resolved + cached) replaces the procedural mark on the walls once it is in; an NCS release
    // (title + artist in the NoCopyrightSounds catalog, or an NCS compilation) carries the NCS mark instead
    stage.setLogoImage(null);
    hud.setNcs(null);
    const who = primaryArtist(t.artist);
    ncsReady.then((ncs) => {
      if (lastTrackId !== t.id) return;
      const m = ncs.match(t);
      hud.setNcs(m ? { ...m, catalogId: m.id, id: t.id } : null);
      if (m) stage.style = { ...stage.style, logoRate: Math.max(1, stage.style.logoRate ?? 0.7) };   // the label mark shows as often as a headliner's
      const logo = m ? loadLogoUrl(NCS_LOGO, NCS_NAME) : who ? loadLogo(who) : Promise.resolve(null);
      logo.then((e) => { if (e && lastTrackId === t.id) stage.setLogoImage(e); });
    });
    if (t.art && profile.style.artColors !== false) {
      paletteFromArt(t.art).then((pal) => { if (pal && lastTrackId === t.id) director.setPalette(mergeArtPalette(profile.palette, pal, profile.seed)); }).catch(() => {});
    }
  }
  stage.setTrack(t);
  if (t.state === 'playing' && Number.isFinite(t.position)) director.setPosition(t.position, audio.now());
};

const enter = document.getElementById('enter');
document.getElementById('enter-btn').onclick = async () => {
  enter.classList.add('hide');
  try { await audio.start(); } catch (e) { console.error(e); alert('Audio start failed: ' + (e.message || e)); }
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) { try { const a = q.get('demo'); await audio.useDemo(a && a !== '1' && a !== 'true' ? a : undefined, q.get('song') || undefined); } catch (e) { console.error(e); } }
  hud.refreshStatus();
};

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') hud.toggleFullscreen();
  else if (k === 'c') stage.cycleCamera();
  else if (k === 'h') hud.toggle();
  else if (k === 's') hud.openMenu();
  else if (k === 'l') stage.triggerLogo();
  else if (k === 'p') stage.triggerPyro();
  else if (k === '-' || k === '=' || k === '+') { stage.setDensity(stage.density + (k === '-' ? -0.1 : 0.1)); hud.flash(`lights ${stage.densityLabel()} (${Math.round(stage.density * 100)}%)`); }
  else if (k === 'd') { director.forceDrop(); hud.flash('drop on next beat'); }
  else if (k === '[' || k === ']') {
    const lead = director.setLead(director.nudge + (k === '[' ? -0.01 : 0.01));
    hud.flash(`sync lead ${Math.round(lead * 1000)} ms (${director.nudge >= 0 ? '+' : ''}${Math.round(director.nudge * 1000)})`);
  }
  else if (k === 'b') { stage.setShot(10); hud.flash('camera 11 booth'); }
  else if (k === 'i') { stage.triggerImag(); hud.flash('DJ feed on the wings'); }
  else if (k.length === 1 && k >= '0' && k <= '9') { stage.setShot(k === '0' ? 9 : Number(k) - 1); hud.flash('camera ' + k); }
  else if (k === 'escape') document.getElementById('source-menu').hidden = true;
});
addEventListener('resize', () => stage.resize());

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const f = audio.analyse();
  const show = director.update(f, dt);
  stage.update(show, dt);
  hud.update(show, now);
  stage.render();
}
requestAnimationFrame(frame);
