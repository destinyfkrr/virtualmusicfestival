// Built-in demo set: a small synthesised EDM arrangement (kick, bass, clap, hats, supersaw lead, pads,
// risers, snare rolls) so the stage can run a full intro → build → drop → breakdown show without Spotify.
// Everything is scheduled on the audio clock with a lookahead timer; nothing is sampled, so it ships in one file.

const BPM = 128;
const SECTIONS = [['intro', 8], ['groove', 8], ['build', 8], ['drop', 16], ['break', 8], ['build', 8], ['drop', 16]]; // [name, bars]
const TOTAL = SECTIONS.reduce((a, s) => a + s[1], 0);
const ROOTS = [33, 41, 38, 36];                                   // A1 F2 D2 C2 — i VI iv III in A minor
const CHORDS = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [48, 52, 55]];
const LEAD_PAT = [[2, 0, 0, 1], [0, 0, 1, 0], [2, 0, 0, 1], [0, 0, 1, 0]]; // 16th grid per beat, value = length in 16ths
const MELODY = [69, 0, 72, 76, 0, 74, 72, 0, 69, 0, 72, 77, 0, 76, 74, 0];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(ctx, secs) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export class DemoTrack {
  constructor(ctx, artist = 'Martin Garrix') {
    this.ctx = ctx; this.artist = artist;
    this.out = ctx.createGain(); this.out.gain.value = 0.9;
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14; this.master.ratio.value = 5; this.master.attack.value = 0.004; this.master.release.value = 0.12;
    this.master.connect(this.out);
    this.duck = ctx.createGain(); this.duck.connect(this.master);   // sidechain bus (bass + lead)
    this.noise = noiseBuffer(ctx, 2);
    this.timer = 0; this.nextBeat = 0; this.beatIdx = 0; this.startAt = 0;
  }
  start() {
    const t0 = this.ctx.currentTime + 0.15;
    this.startAt = t0; this.nextBeat = t0; this.beatIdx = 0;
    this._schedule();
    this.timer = setInterval(() => this._schedule(), 50);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = 0; try { this.out.disconnect(); } catch {} }
  duration() { return TOTAL * 4 * 60 / BPM; }
  position() { return Math.max(0, this.ctx.currentTime - this.startAt) % this.duration(); }
  section() { return this._sectionAt(Math.floor(Math.max(0, this.ctx.currentTime - this.startAt) * BPM / 240)).name; }
  track() {
    return { type: 'track', state: 'playing', name: 'Demo Set (' + this.section() + ')', artist: this.artist, album: 'Virtual-Fest built-in demo',
      art: '', id: 'demo:' + this.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ':' + Math.round(this.startAt * 1000), position: this.position(), duration: this.duration(), ts: Date.now() };
  }

  _sectionAt(bar) { let b = bar % TOTAL, prev = SECTIONS[SECTIONS.length - 1][0]; for (const [name, len] of SECTIONS) { if (b < len) return { name, len, at: b, prev }; b -= len; prev = name; } return { name: 'drop', len: 16, at: 0, prev }; }
  _schedule() {
    const bl = 60 / BPM, ahead = this.ctx.currentTime + 0.4;
    while (this.nextBeat < ahead) { this._beat(this.beatIdx, this.nextBeat, bl); this.beatIdx++; this.nextBeat += bl; }
  }

  _beat(idx, t, bl) {
    const bar = Math.floor(idx / 4), bib = idx & 3, sec = this._sectionAt(bar), name = sec.name, last = sec.at === sec.len - 1;
    const root = ROOTS[bar & 3], chord = CHORDS[bar & 3], e = bl / 4;
    if (sec.at === 0 && bib === 0) this._sectionStart(name, sec, t, bl);
    // build: kick + bass keep going for the first half, then the kick drops out under an accelerating snare roll
    // and the riser, with the classic one-beat hole right before the drop (what real EDM builds do, and what the
    // section detector listens for)
    const gap = name === 'build' && last && bib === 3;
    const buildKick = name === 'build' && sec.at < sec.len / 2 && sec.prev === 'groove';   // after a breakdown the build has no kick at all
    const kicks = name === 'groove' || name === 'drop' || name === 'intro' || buildKick;
    if (kicks && !gap) this.kick(t, name === 'intro' ? 0.75 : 1);
    if ((name === 'groove' || name === 'drop' || buildKick) && (bib & 1)) this.clap(t, name === 'drop' ? 0.9 : 0.6);
    if (kicks && !gap) {
      this.hat(t + bl / 2, 0.35, name === 'drop');
      if (name === 'drop' || name === 'groove') { this.hat(t + bl / 4, 0.14, false); this.hat(t + 3 * bl / 4, 0.16, false); }
    } else if (name === 'break') { this.shaker(t, 0.06); this.shaker(t + bl / 2, 0.04); }
    // bass: filtered in the intro, open in the groove, gone during the build (kick + riser only) and back for the drop
    if (name === 'groove' || name === 'drop' || name === 'intro') {
      const cut = name === 'drop' ? 2400 : name === 'intro' ? 350 : 900;
      const v = name === 'drop' ? 1 : name === 'intro' ? 0.6 : 0.8;
      this.bass(t, root, bl * 0.48, v, cut);
      this.bass(t + bl / 2, root, bl * 0.46, v * 0.9, cut);
    }
    if (name === 'drop') { const pat = LEAD_PAT[bib]; for (let s = 0; s < 4; s++) if (pat[s]) this.lead(t + s * e, chord, e * pat[s], 0.085, 5200); }
    if (name === 'break') {
      if (bib === 0) this.pad(t, chord, bl * 4, 0.12);
      const m = MELODY[(bar * 4 + bib) % MELODY.length]; this.pluck(t, m || chord[bib % 3] + 12, m ? 0.2 : 0.12); if (m) this.pluck(t + bl / 2, m - 5, 0.12);
    }
    if (name === 'build') {
      if (bib === 0) this.pad(t, chord, bl * 4, 0.07 + 0.09 * sec.at / sec.len);
      const rem = sec.len - sec.at;           // bars left including this one
      if (!buildKick && !gap) {
        // snare roll: 8ths -> 16ths -> 32nds over the second half
        const div = rem > 3 ? 2 : rem > 1 ? 4 : bib < 2 ? 4 : 8;
        const prog = (sec.at + bib / 4) / sec.len;              // 0..1 across the build: the roll gets louder as it thickens
        for (let k = 0; k < div; k++) this.clap(t + k * bl / div, 0.16 + 0.55 * prog + 0.06 * k / div);
        if (bib === 0) this.lead(t, chord, bl * 3.8, 0.03 + 0.05 * prog, 1800 + 3000 * prog);   // pumping chord stabs under the roll
      }
    }
    if (gap) this.burst(t, bl * 0.9, 0.2, 'highpass', 4000, 0.5);   // white-noise tail through the hole
  }
  _sectionStart(name, sec, t, bl) {
    if (name === 'build') this.riser(t, sec.len * 4 * bl, 0.35);
    else if (name === 'drop') { this.impact(t); this.crash(t, 0.4); }
    else if (name === 'break') this.crash(t, 0.25);
  }

  // ---- voices
  burst(t, len, v, type, freq, q = 0.8, dst = this.master) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(dst); s.start(t); s.stop(t + len + 0.02);
  }
  kick(t, v = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.075);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.1 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.42);
    this.burst(t, 0.014, 0.4 * v, 'highpass', 1800);
    const d = this.duck.gain; d.cancelScheduledValues(t); d.setValueAtTime(0.4, t); d.linearRampToValueAtTime(1, t + 0.2);
  }
  clap(t, v = 1) {
    for (let k = 0; k < 3; k++) this.burst(t + k * 0.011, 0.11 + k * 0.03, 0.6 * v, 'bandpass', 1900, 0.6);
    this.burst(t, 0.05, 0.5 * v, 'highpass', 3200, 0.5);
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.05);
    g.gain.setValueAtTime(0.22 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.07);
  }
  hat(t, v, open) { this.burst(t, open ? 0.16 : 0.04, v, 'highpass', 7000, 0.5); }
  shaker(t, v) { this.burst(t, 0.035, v, 'bandpass', 9000, 1.2); }
  crash(t, v) { this.burst(t, 1.1, v, 'highpass', 3500, 0.4); }
  impact(t) {
    this.burst(t, 1.3, 0.9, 'lowpass', 500, 0.7);
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.72);
  }
  bass(t, midi, len, v, cutoff) {
    const c = this.ctx, f0 = mtof(midi), o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = f0; o2.type = 'square'; o2.frequency.value = f0 / 2;
    f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(90, cutoff * 0.3), t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.65 * v, t + 0.01); g.gain.setValueAtTime(0.65 * v, t + len - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.duck);
    o.start(t); o2.start(t); o.stop(t + len + 0.02); o2.stop(t + len + 0.02);
  }
  lead(t, notes, len, v, cutoff) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(cutoff * 0.35, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.setValueAtTime(v, t + len * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    f.connect(g).connect(this.duck);
    for (const n of notes) for (const d of [-14, 0, 14]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = d; o.connect(f); o.start(t); o.stop(t + len + 0.03); }
  }
  pad(t, notes, len, v) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.5); g.gain.setValueAtTime(v, t + len - 0.6); g.gain.linearRampToValueAtTime(0.0001, t + len);
    f.connect(g).connect(this.master);
    for (const n of notes) for (const d of [-8, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = d; o.connect(f); o.start(t); o.stop(t + len + 0.05); }
  }
  pluck(t, midi, v) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(midi); f.type = 'lowpass'; f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.34);
  }
  riser(t, len, v) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(220, t); f.frequency.exponentialRampToValueAtTime(7000, t + len);
    g.gain.setValueAtTime(0.002, t); g.gain.exponentialRampToValueAtTime(v, t + len); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.05);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + len + 0.1);
    const o = c.createOscillator(), g2 = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(mtof(45), t); o.frequency.exponentialRampToValueAtTime(mtof(57), t + len);
    g2.gain.setValueAtTime(0.001, t); g2.gain.exponentialRampToValueAtTime(v * 0.35, t + len); g2.gain.linearRampToValueAtTime(0.0001, t + len + 0.05);
    o.connect(g2).connect(this.master); o.start(t); o.stop(t + len + 0.1);
  }
}
