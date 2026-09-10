// HUD: status pill, BPM/phase/sync, meters, now-playing (+ artist profile line), source menu, toasts.
const GENRE_LABEL = {
  bigroom: 'Big Room', progressive: 'Progressive House', future: 'Future House', bass: 'Bass House', electro: 'Electro House',
  trance: 'Trance', psytrance: 'Psytrance', hardstyle: 'Hardstyle', techno: 'Techno', hardtechno: 'Hard Techno', afterlife: 'Melodic Techno',
  melodic: 'Melodic House', deep: 'Deep House', tech: 'Tech House', dubstep: 'Dubstep', trap: 'Trap', dnb: 'Drum & Bass', hardcore: 'Hardcore',
  future_bass: 'Future Bass', pop: 'Dance Pop', slap: 'Slap House',
};

export class Hud {
  constructor(audio, stage, director) {
    this.audio = audio;
    this.stage = stage;
    this.director = director || stage.director;
    this.$ = (id) => document.getElementById(id);
    this.hud = this.$('hud');
    this.pill = this.$('source-pill');
    this.sourceText = this.$('source-text');
    this.bpm = this.$('bpm');
    this.phase = this.$('phase');
    this.sync = this.$('sync');
    this.energy = this.$('energy');
    this.bass = this.$('bass');
    this.art = this.$('art');
    this.title = this.$('title');
    this.artist = this.$('artist');
    this.showLine = this.$('show-line');
    this.ncs = null; this.lastTrackMeta = null;   // NCS release match for the current track (main.js sets it once the catalog answers)
    this.progress = this.$('progress');
    this.toast = this.$('toast');
    this.menu = this.$('source-menu');
    this.deviceSelect = this.$('device-select');
    this.lastArt = null;
    this.hidden = false;
    this.lastUi = 0;
    this.toastTimer = 0;

    this.$('btn-source').onclick = () => this.openMenu();
    this.$('source-close').onclick = () => { this.menu.hidden = true; };
    this.$('btn-full').onclick = () => this.toggleFullscreen();
    this.$('btn-cam').onclick = () => stage.cycleCamera();
    this.$('btn-logo').onclick = () => stage.triggerLogo();
    this.$('btn-pyro').onclick = () => stage.triggerPyro();
    this.$('btn-lights').onclick = () => { stage.cycleDensity(); this.flash('lights: ' + stage.densityLabel()); };
    for (const b of this.menu.querySelectorAll('[data-src]')) {
      b.onclick = async () => {
        try {
          const src = b.dataset.src;
          if (src === 'server') audio.useServer();
          else if (src === 'demo') await audio.useDemo();
          else if (src === 'screen') await audio.useScreen();
          else if (src === 'device') await audio.useDevice(this.deviceSelect.value || undefined);
          this.menu.hidden = true;
          this.director.setLead(this.director.nudge); // re-read base latency for the new source
        } catch (e) { alert('Could not switch source: ' + (e.message || e)); }
      };
    }
    audio.onStatus = () => this.refreshStatus();
    this.refreshStatus();
  }

  async openMenu() {
    this.menu.hidden = false;
    try {
      const devs = await this.audio.listInputDevices();
      this.deviceSelect.innerHTML = devs.map(d => `<option value="${d.deviceId}">${d.label || 'Input ' + d.deviceId.slice(0, 6)}</option>`).join('') || '<option value="">(no input devices)</option>';
    } catch { this.deviceSelect.innerHTML = '<option value="">(permission needed)</option>'; }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  toggle() { this.hidden = !this.hidden; this.hud.classList.toggle('hide', this.hidden); }

  flash(msg, ms = 1600) {
    if (!this.toast) return;
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('show'), ms);
  }

  refreshStatus() {
    const st = this.audio.status();
    this.pill.className = 'pill ' + (st.level === 'live' ? 'live' : st.level === 'bad' ? 'bad' : '');
    this.sourceText.textContent = st.text;
  }

  setProfile(p) {
    this.profile = p;
    if (!this.showLine || !p) return;
    const who = p.matched ? p.name : 'unlisted artist';
    const genre = GENRE_LABEL[p.genre] || p.genre;
    this.showLine.textContent = `${who} · ${genre} · ${p.centre} rig · ${p.paletteMode || 'signature'} colours · look #${p.variant}`;
    this.showLine.classList.toggle('matched', !!p.matched);
  }

  setTrack(t) {
    this.lastTrackMeta = t;
    if (!t || t.state === 'stopped' || !t.name) {
      this.title.textContent = 'Nothing playing';
      this.artist.textContent = 'Play something on Spotify';
      if (this.showLine) this.showLine.textContent = '';
      this.art.removeAttribute('src');
      this.lastArt = null;
      return;
    }
    this.title.textContent = t.name;
    const ncs = this.ncs && this.ncs.id === t.id ? '  ·  NCS release' : '';
    this.artist.textContent = t.artist + ncs + (t.state === 'paused' ? '  ·  paused' : '');
    if (t.art && t.art !== this.lastArt) { this.lastArt = t.art; this.art.src = '/art?url=' + encodeURIComponent(t.art); }
  }
  /** the NCS match for the current track ({id, how, title, artist} or null): "NCS release" on the artist line */
  setNcs(m) { this.ncs = m || null; if (this.lastTrackMeta) this.setTrack(this.lastTrackMeta); }

  update(show, now) {
    if (now - this.lastUi < 100) return;
    this.lastUi = now;
    this.bpm.textContent = show.bpm && show.confidence > 0.2 ? Math.round(show.bpm) : '—';
    this.phase.textContent = show.phase + (show.phase !== 'idle' && show.phraseTrust > 0.5 ? ' ✓' : '');
    if (this.sync) {
      const locked = !!show.tempoLocked;
      this.sync.textContent = (locked ? '● ' : '○ ') + Math.round((show.sync || 0) * 1000) + 'ms';
      this.sync.classList.toggle('lock', locked);
    }
    this.energy.style.transform = `scaleX(${Math.min(1, show.energy).toFixed(3)})`;
    this.bass.style.transform = `scaleX(${Math.min(1, show.bass).toFixed(3)})`;
    const t = this.audio.track;
    if (t && t.duration > 0 && t.state !== 'stopped') {
      const pos = t.position + (t.state === 'playing' ? (Date.now() - t.ts) / 1000 : 0);
      this.progress.style.width = `${Math.min(100, (pos / t.duration) * 100).toFixed(2)}%`;
    } else this.progress.style.width = '0%';
    // pill freshness (tap silent detection) without waiting for events
    if ((now | 0) % 1000 < 100) this.refreshStatus();
  }
}
