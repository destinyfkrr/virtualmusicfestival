// ShowDirector — turns the audio stream into a beat-locked EDM show timeline.
//
//  ingest(msg)  <- 'onset-tap' worklet batches (band RMS per 256-sample hop, audio-clock stamped)
//     · log-compressed spectral flux onset function (bass weighted) + kick / snare / hat detectors
//     · autocorrelation tempo induction (70–200 BPM, EDM prior, comb reinforcement) every 0.5 s
//     · comb-filter beat phase alignment + kick PLL -> predictive beat grid (anchor + period)
//  update(f, dt) <- per frame: predictive beat emission with sync lead, sub-beat pulses,
//     · EDM section machine (intro / groove / build / drop / peak / breakdown) with phrase counting,
//       predictive pre-drop dip (short, partial, once per build) and drop snapping to the downbeat
//  Events: beat(index, strength), bar(index), phrase(index), drop, pyro, predrop, phase(p, prev), palette(p)
//
//  Time axes: hop stamps are audio-clock seconds of the *analysed* stream. Analysis runs `lead`
//  seconds behind what the listener hears (tap → ws → preroll) plus render latency, so the
//  director's "now" is audioClock + lead and beats are emitted when now >= gridTime.

import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const N = 4096;              // hop ring (~21.8 s at 5.3 ms hops)
const MASK = N - 1;
const PHASES = ['idle', 'intro', 'groove', 'build', 'drop', 'peak', 'breakdown'];
const WHITE = new THREE.Color(1, 1, 1);
const GREY = new THREE.Color(0.5, 0.5, 0.56);
const RENDER_LEAD = 0.02;   // frame render -> display budget (s)

export const DEFAULT_PALETTES = [
  ['#ff2bd6', '#29e6ff', '#ffffff'],
  ['#ff3b3b', '#ffb000', '#ffffff'],
  ['#2b5cff', '#7a2bff', '#ffffff'],
  ['#00ff88', '#00d4ff', '#ffffff'],
  ['#ff7a00', '#ff2bd6', '#2bd7ff'],
];

export class ShowDirector {
  constructor() {
    this._dbg = null;                       // optional ring of low-onset candidates (set to [] by test harnesses)
    this.listeners = new Map();
    this.clock = null;
    this.lead = 0.075;
    this.nudge = 0;
    this.profile = null;
    this.seed = 1;
    this.hopSec = 256 / 48000;

    // ---- hop rings
    this.n = 0;
    this.tim = new Float64Array(N);
    this.odf = new Float32Array(N); this.odfB = new Float32Array(N); this.odfM = new Float32Array(N); this.odfH = new Float32Array(N);
    this.lb = new Float32Array(N); this.lm = new Float32Array(N); this.lh = new Float32Array(N);
    this.lvB = new Float32Array(N); this.lvM = new Float32Array(N); this.lvH = new Float32Array(N); this.lvF = new Float32Array(N);
    this.acfBuf = new Float32Array(1400); this.acf = new Float32Array(700); this.score = new Float32Array(300); this.comb = new Float32Array(300);

    // ---- running stats
    this.meanODF = 0.02; this.meanB = 0.02; this.meanM = 0.02; this.meanH = 0.02;
    this.ref = 0.05; this.refB = 0.03; this.refH = 0.01; this.refK = 0; this.envF = 0;
    this.lastHopT = 0; this.lastIngestPerf = 0; this.hopsSinceTempo = 0;

    // ---- onsets
    this.onsets = [];
    this.lastOn = { o: -9, k: -9, s: -9, h: -9 };
    this.hatRate = 0; this.midRate = 0;
    this._kick = 0; this._snare = 0; this._hat = 0;
    this._lastKickT = -9; this._lastSnareT = -9; this._lastHatT = -9;
    this._pendingFallback = null; this.fallbackBeatT = -9;

    // ---- tempo / grid
    this.period = 60 / 128; this.bpm = 128; this.tempoConf = 0; this.stable = 0;
    this.pendingPeriod = 0; this.pendingCount = 0; this.pendingPhaseErr = 0; this.pendingPhaseCount = 0;
    this.downbeatHold = -1;                 // bar index until which the downbeat is frozen (after a drop snap)
    this.phraseScore = new Float32Array(8); // evidence per (barIndex % 8) of being a phrase start
    this.phraseHold = -1;
    this.downbeatTrust = 0; this.phraseTrust = 0;
    this.posRef = null;                     // { pos, t }: track position (s) at analysis-time t
    this.trackOffset = null;                // sub-beat offset of the beat grid relative to track position 0, s
    this.firstKickPos = null;
    this.kickPeriodT = -1e9;                // last time the kick least-squares period was available
    this.priorBeatShift = 0;                // phrase-beat index of track position 0 (recalibrated at confirmed drops)
    this.priorCalibrated = false;
    this.phraseEvidenced = false;           // energy evidence has agreed with the current phrase anchor
    this.phraseEvidence = new Float32Array(8);
    this._priorPhraseBeat = -1;
    this._flags = null; this.tense = false;
    this.phaseBuf = new Float32Array(1400);
    this.anchor = null; this.nextBeat = null; this.lastBeatT = -1; this.beatIndex = -1;
    this.tempoLocked = false; this.lockedSince = 0;
    this.downbeatScore = new Float32Array(4); this.downbeatOffset = 0;
    this.barIndex = -1; this.lastBarBeat = -9; this.phraseAnchorBar = 0; this.phraseLen = 8; this.phraseIndex = -1;

    // ---- section machine
    this.phase = 'idle'; this.phaseSince = 0; this.phaseBeats = 0; this.phaseBars = 0;
    this.hist = [];
    this.buildStartBar = 0; this.rollNorm = 0;
    // tension: evidence that the current section is heading somewhere (snare roll thickening, riser sweeping up,
    // the mix swelling) measured against the settled sound of the calm section it grew out of (phaseBase)
    this.tension = 0; this.phaseBase = null; this._baseAcc = null;
    this.dropAt = -9; this.dropPending = false; this.dropPendingAt = 0; this.dropConfirmed = false;
    this._dropOnNextBeat = false; this._snapDownbeatNextBeat = false; this._forceDropNext = false;
    this._dipDone = false; this._dipAt = 0;
    this.trackStart = 0; this.dropsSeen = 0; this._silentFor = 0;

    // ---- colours
    this.paletteHex = DEFAULT_PALETTES[0];
    this.palette = this.paletteHex.map((h) => new THREE.Color(h));
    this.colorA = this.palette[0].clone(); this.colorB = this.palette[1].clone(); this.colorC = this.palette[2].clone();
    this.colorFromA = this.colorA.clone(); this.colorFromB = this.colorB.clone(); this.colorFromC = this.colorC.clone();
    this.colorToA = this.colorA.clone(); this.colorToB = this.colorB.clone(); this.colorToC = this.colorC.clone();
    this.colorMix = 1; this.colorIdx = 0;

    this.show = {
      t: 0, dt: 0, now: 0, phase: 'idle', phaseTime: 0, phaseBars: 0, sectionBars: 0,
      beat: false, beatStrength: 0, beatIndex: 0, beatPhase: 0, beatPulse: 0, nextBeatIn: 1, beatInBar: 0,
      bar: false, barIndex: 0, barPhase: 0, phraseBar: 0, phraseBeat: 0, phraseIndex: 0, phrasePhase: 0, phrase: false, phraseLen: 8,
      bpm: 0, period: 0.469, confidence: 0, tempoLocked: false,
      energy: 0, energySlow: 0, bass: 0, mid: 0, high: 0, rel: 0, bassRel: 0, highRel: 0, darkness: 0.5,
      kick: 0, snare: 0, hat: 0, roll: 0, kickOn: false, snareOn: false, hatOn: false,
      strobe: 0, strobeRate: 0, whiteout: 0, buildProgress: 0, dropPulse: 0, predrop: false, dip: 0, dropCount: 0, dropConfirmed: false,
      colorA: this.colorA, colorB: this.colorB, colorC: this.colorC, palette: this.palette,
      active: false, silence: true, spectrum: null, wave: null, sync: this.lead, profile: null, seed: 1, trackTime: 0, hopAge: 9, trackPos: 0, downbeatTrust: 0, phraseTrust: 0,
    };
  }

  // ------------------------------------------------------------------ events / config
  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn); return this; }
  emit(ev, ...a) { const l = this.listeners.get(ev); if (l) for (const fn of l) { try { fn(...a); } catch (e) { console.error(e); } } }

  setClock(audio) { this.clock = audio; this._updateLead(); }
  setLead(v) { this.nudge = clamp(v, -0.3, 0.5); return this._updateLead(); }
  _updateLead() { this.lead = (this.clock ? this.clock.baseLatency() : 0.075) + RENDER_LEAD + this.nudge; this.show.sync = this.lead; return this.lead; }
  setProfile(p) { this.profile = p; this.show.profile = p; if (p && p.palette) this.setPalette(p.palette); }
  setSeed(s) { this.seed = s >>> 0; this.show.seed = this.seed; }

  setPalette(hexes) {
    if (!hexes || hexes.length < 3) return;
    this.paletteHex = hexes.slice(0, 5);
    this.palette = this.paletteHex.map((h) => new THREE.Color(h));
    this.show.palette = this.palette;
    this.colorIdx = 0;
    // the palette's coolest saturated colour: breakdowns drift toward it
    const hsl = { h: 0, s: 0, l: 0 };
    let best = null, bestD = 9;
    for (const c of this.palette) { c.getHSL(hsl); if (hsl.s < 0.25 || hsl.l < 0.12 || hsl.l > 0.93) continue; const d = Math.min(Math.abs(hsl.h - 0.62), 1 - Math.abs(hsl.h - 0.62)); if (d < bestD) { bestD = d; best = c; } }
    this.coolColor = (best || this.palette[0]).clone();
    this._cueColors(true);
    this.emit('palette', this.palette);
  }
  randomPalette() { this.setPalette(DEFAULT_PALETTES[Math.floor(Math.random() * DEFAULT_PALETTES.length)]); }
  nextColors(snap = false) { this.colorIdx++; this._cueColors(snap); }
  // colour choreography: re-colour the rig phrase by phrase (every phrase while it's pumping, every other
  // phrase in the groove, rarely in breakdowns); builds keep their colours because the white ramp is their story
  _phraseColors() {
    const p = this.phase, n = this.phraseIndex;
    if (p === 'drop' || p === 'peak') this.nextColors(false);
    else if (p === 'groove' && (n & 1)) this.nextColors(false);
    else if (p === 'breakdown' && n % 3 === 0) this.nextColors(false);
  }

  // new song: keep tempo estimate (re-checked quickly) but reset structure
  resetTrack() {
    this.trackStart = this._now();
    this.hist.length = 0;
    this.dropsSeen = 0; this.dropPending = false; this.dropConfirmed = false;
    this._dropOnNextBeat = false; this._snapDownbeatNextBeat = false;
    this._dipDone = false; this._dipAt = 0;
    this.rollNorm = 0; this.tension = 0; this.phaseBase = null; this._baseAcc = { n: 0, mids: 0, high: 0, full: 0 };
    this.refK *= 0.5; this._lastKickT = -10;
    this.phraseAnchorBar = this.barIndex + 1; this.phraseLen = 8;
    this.stable = 0; this.tempoConf *= 0.6; this.tempoLocked = false;
    this.downbeatScore.fill(0); this.phraseScore.fill(0);
    this.downbeatHold = -1; this.phraseHold = -1; this.downbeatTrust = 0; this.phraseTrust = 0;
    this.posRef = null; this.trackOffset = null; this.firstKickPos = null; this._priorPhraseBeat = -1; this.kickPeriodT = -1e9;
    this.priorBeatShift = 0; this.priorCalibrated = false; this.phraseEvidence.fill(0); this.phraseEvidenced = false;
    this.setPhase('intro');
  }

  // Spotify playback position (seconds into the track) heard at audio-clock time atClock (default: now).
  // Gives a phrase prior: EDM tracks put beat 1 of the phrase grid at the first kick and drops on 32-beat multiples.
  setPosition(pos, atClock = null) {
    if (!(pos >= 0)) return;
    const c = atClock ?? (this.clock ? this.clock.now() : performance.now() / 1000);
    const t = c + (this.lead - RENDER_LEAD - this.nudge);    // analysis-stream time of that audio
    if (this.posRef && Math.abs((this.posRef.pos + (t - this.posRef.t)) - pos) > 1.5) {
      // seek / restart: phrase prior is stale
      this.trackOffset = null; this.firstKickPos = null; this.phraseScore.fill(0); this.phraseEvidence.fill(0); this.phraseTrust = 0; this.phraseEvidenced = false;
    }
    this.posRef = { pos, t };
  }
  _posAt(t) { return this.posRef ? this.posRef.pos + (t - this.posRef.t) : null; }

  setPhase(p) {
    if (!PHASES.includes(p) || p === this.phase) return;
    const prev = this.phase;
    this.phase = p; this.phaseSince = this._now(); this.phaseBeats = 0; this.phaseBars = 0;
    if (p === 'build') this.buildStartBar = this.barIndex;
    // a build keeps measuring its tension against the breakdown it grew out of; any other section start (or a build
    // straight out of a kicked section) takes the last four beats as a provisional calm reference and, unless it is a
    // build, re-captures a settled one over beats 4..8
    const keepBase = p === 'build' && this.phaseBase && this.phaseBase.final;
    if (!keepBase) this.phaseBase = this._recentBase(p === 'build');
    this._baseAcc = p === 'build' || keepBase ? null : { n: 0, mids: 0, high: 0, full: 0 };
    if (p !== 'build') this.tension = 0;
    if (p === 'drop') { this.dropAt = this.phaseSince; this.dropsSeen++; this.emit('drop'); }
    this.emit('phase', p, prev);
  }
  forceDrop() { this._forceDropNext = true; }

  _now() { return this.clock ? this.clock.now() + this.lead : performance.now() / 1000; }

  // ------------------------------------------------------------------ ingest: worklet hop batches
  ingest(msg) {
    this.lastIngestPerf = performance.now();
    if (msg.hopSec) this.hopSec = msg.hopSec;
    const d = msg.data;
    for (let i = 0; i + 3 < d.length; i += 4) this._pushHop(msg.t + (i / 4) * this.hopSec, d[i], d[i + 1], d[i + 2], d[i + 3]);
  }

  _pushHop(t, b, m, h, f) {
    const n = this.n, i = n & MASK;
    this.tim[i] = t;
    this.lvB[i] = b; this.lvM[i] = m; this.lvH[i] = h; this.lvF[i] = f;
    const lb = Math.log1p(b * 60), lm = Math.log1p(m * 60), lh = Math.log1p(h * 60);
    this.lb[i] = lb; this.lm[i] = lm; this.lh[i] = lh;
    const back = (n - 3) & MASK;
    const fb = Math.max(0, lb - this.lb[back]), fm = Math.max(0, lm - this.lm[back]), fh = Math.max(0, lh - this.lh[back]);
    const o = fb + fm * 0.55 + fh * 0.4;
    this.odf[i] = o; this.odfB[i] = fb; this.odfM[i] = fm; this.odfH[i] = fh;
    const a = 0.006;
    this.meanODF += (o - this.meanODF) * a; this.meanB += (fb - this.meanB) * a; this.meanM += (fm - this.meanM) * a; this.meanH += (fh - this.meanH) * a;
    this.ref = f > this.ref ? this.ref + (f - this.ref) * 0.05 : this.ref * 0.99987 + 0.0000013;
    this.refB = b > this.refB ? this.refB + (b - this.refB) * 0.05 : this.refB * 0.99987 + 0.0000013;
    this.refH = h > this.refH ? this.refH + (h - this.refH) * 0.05 : this.refH * 0.99987 + 0.0000005;
    this.refK *= 0.99995;
    this.envF = Math.max(f, this.envF * 0.995);
    this.hatRate *= 0.9993; this.midRate *= 0.9993;
    this.lastHopT = t;
    this.n++;
    this.hopsSinceTempo++;
    if (this.n >= 12) this._pickOnsets();
    if (this.hopsSinceTempo >= 94 && this.n > 700) { this.hopsSinceTempo = 0; this._estimateTempo(); }
    if (this.dropPending) this._confirmDrop(t, b);
    else this._earlyDropCheck(t, b);
  }

  // peak picking with 3-hop lookahead on the generic / bass / mid / high onset functions
  _pickOnsets() {
    const c = this.n - 4;
    const ci = c & MASK, tc = this.tim[ci];
    const isPeak = (arr) => {
      const v = arr[ci];
      for (let j = c - 8; j <= c + 3; j++) if (j !== c && arr[j & MASK] > v) return false;
      return true;
    };
    const o = this.odf[ci];
    if (o > 0.05 + 1.7 * this.meanODF && tc - this.lastOn.o > 0.06 && isPeak(this.odf)) {
      this.lastOn.o = tc; this._addOnset(tc, o / (this.meanODF + 0.02), 'o');
    }
    const fb = this.odfB[ci];
    if (fb > 0.05 + 1.8 * this.meanB && this.lvB[ci] > 0.18 * this.refB && tc - this.lastOn.k > 0.16 && isPeak(this.odfB)) {
      // Kick gate: bass notes, sidechain recovery and kick tails all make low-band bumps a few times per beat.
      // Only an onset at least ~45% as sharp as the recent kicks (decaying reference) counts as a kick; the rest
      // are logged as plain low onsets so the kick flashes, the PLL and the kick tempo regression stay clean.
      // After a long kick-less stretch the reference has faded, so any low onset used to re-arm it; build claps and
      // snare bodies leak into the low band and got counted as kicks. The fallback now also needs the onset to be
      // kick-shaped: still a fair fraction of the old reference, or low-dominant (bass level near the mid level).
      const lvB = this.lvB[ci], lvM = this.lvM[ci];
      // kick-shaped = real low-end body (not a pad/chord attack or a clap tail leaking into the bass band):
      // the bass level must carry against the mids and against the recent kick level
      const kickShaped = lvB > 0.45 * lvM && lvB > 0.25 * this.refB;
      let isKick = (fb > 0.45 * this.refK && (kickShaped || fb > 0.9 * this.refK))
        || (tc - this._lastKickT > 2.5 && kickShaped && (fb > 0.3 * this.refK || lvB > 0.35 * this.refB));
      if (this._dbg) this._dbg.push([+tc.toFixed(3), +fb.toFixed(3), +this.refK.toFixed(3), +lvB.toFixed(4), +this.refB.toFixed(4), +lvM.toFixed(4), +this.odfM[ci].toFixed(3), isKick ? 1 : 0]);
      // with a locked grid, a medium low onset far from any beat is an off-beat bass note, not a kick
      if (isKick && this.tempoLocked && this.anchor != null && fb < 0.8 * this.refK) {
        const bf = (tc - this.hopSec - this.anchor) / this.period;
        if (Math.abs(bf - Math.round(bf)) > 0.3) isKick = false;
      }
      if (isKick) {
        this.refK = Math.max(fb, this.refK);
        this.lastOn.k = tc; this._addOnset(tc, fb / (this.meanB + 0.02), 'k');
        this._kick = 1; this._lastKickT = tc;
      } else this._addOnset(tc, fb / (this.meanB + 0.02), 'b');
    }
    const fm = this.odfM[ci] + this.odfH[ci] * 0.7;
    if (fm > 0.06 + 1.9 * (this.meanM + this.meanH * 0.7) && tc - this.lastOn.s > 0.08 && isPeak(this.odfM)) {
      this.lastOn.s = tc; this._addOnset(tc, fm / (this.meanM + 0.02), 's');
      this.midRate += 0.35; this._snare = 1; this._lastSnareT = tc;
    }
    const fh = this.odfH[ci];
    if (fh > 0.04 + 1.6 * this.meanH && tc - this.lastOn.h > 0.045 && isPeak(this.odfH)) {
      this.lastOn.h = tc; this.hatRate += 0.35; this._hat = 1; this._lastHatT = tc;
    }
  }

  _addOnset(t, s, k) {
    this.onsets.push({ t, s, k });
    if (this.onsets.length > 1024) this.onsets.splice(0, 256);
    if (k !== 'k') return;
    if (this.firstKickPos == null && this.posRef) {
      const pos = this._posAt(t - this.hopSec);
      if (pos != null && pos >= 0) this.firstKickPos = pos;
    }
    // PLL: kicks near a predicted beat pull the grid
    if (this.anchor != null && this.tempoConf > 0.2) {
      const P = this.period;
      const tk = t - this.hopSec;
      const err = tk - (this.anchor + Math.round((tk - this.anchor) / P) * P);
      if (Math.abs(err) < 0.2 * P) this.anchor += err * (this.tempoLocked ? 0.12 : 0.25);
    }
    // fallback beats while tempo unknown
    if (this.tempoConf < 0.2 && t - this.fallbackBeatT > 0.26) { this.fallbackBeatT = t; this._pendingFallback = t; }
  }

  // ------------------------------------------------------------------ tempo induction
  _estimateTempo() {
    const hop = this.hopSec;
    const W = Math.min(this.n - 2, 1130);
    if (W < 600) return;
    const end = this.n - 2;
    const x = this.acfBuf;
    let mean = 0;
    for (let j = 0; j < W; j++) {
      const i = end - W + 1 + j;
      const v = (this.odf[(i - 1) & MASK] + this.odf[i & MASK] + this.odf[(i + 1) & MASK]) / 3;
      x[j] = v; mean += v;
    }
    mean /= W;
    let e0 = 1e-6;
    for (let j = 0; j < W; j++) { x[j] -= mean; e0 += x[j] * x[j]; }
    const Lmin = Math.max(8, Math.round(60 / 200 / hop)), Lmax = Math.min(Math.round(60 / 70 / hop), 290);
    const maxLag = Math.min(3 * Lmax, W - 200, 699);
    const acf = this.acf;
    for (let L = Lmin; L <= maxLag; L++) {
      let s = 0;
      for (let j = L; j < W; j++) s += x[j] * x[j - L];
      acf[L] = (s / (W - L)) / (e0 / W);
    }
    const prof = this.profile;
    const score = this.score;
    let best = Lmin, bestV = -1e9, sum = 0, cnt = 0;
    for (let L = Lmin; L <= Lmax; L++) {
      let v = acf[L], wsum = 1;
      if (2 * L <= maxLag) { v += 0.5 * acf[2 * L]; wsum += 0.5; }
      if (3 * L <= maxLag) { v += 0.33 * acf[3 * L]; wsum += 0.33; }
      v /= wsum;
      const bpm = 60 / (L * hop);
      const lg = Math.log2(bpm / 145) / 0.32;                 // EDM prior: 118-180 flat-ish, <100 = half-time error
      let w = Math.exp(-0.5 * lg * lg) * 0.6 + 0.4;
      if (prof && prof.bpm && bpm >= prof.bpm[0] - 3 && bpm <= prof.bpm[1] + 3) w *= 1.35;
      v *= w;
      score[L] = v; sum += v; cnt++;
      if (v > bestV) { bestV = v; best = L; }
    }
    const avg = sum / cnt;
    let sd = 0; for (let L = Lmin; L <= Lmax; L++) { const d = score[L] - avg; sd += d * d; }
    sd = Math.sqrt(sd / cnt) + 1e-6;
    const z = (bestV - avg) / sd;
    const conf = clamp((z - 2.2) / 3, 0, 1) * clamp(acf[best] * 3, 0, 1);
    let Lf = best;
    if (best > Lmin && best < Lmax) {
      const a = score[best - 1], b = score[best], c = score[best + 1];
      const den = a - 2 * b + c;
      if (Math.abs(den) > 1e-9) Lf = best + 0.5 * (a - c) / den;
    }
    this._acceptTempo(Lf * hop, conf, acf[best]);
    this._alignPhase(W, end, conf);
  }

  // least-squares beat period from kick onsets sitting on the current grid (last 8 s)
  _kickPeriod() {
    if (this.anchor == null) return null;
    const P = this.period, tEnd = this.lastHopT;
    // one onset per beat index (the strongest), so a stray bass note next to a kick cannot skew the fit
    const byBeat = new Map();
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const o = this.onsets[i]; if (o.t < tEnd - 8) break; if (o.k !== 'k') continue;
      const kf = (o.t - this.anchor) / P, k = Math.round(kf);
      if (Math.abs(kf - k) > 0.2) continue;
      const prev = byBeat.get(k);
      if (!prev || o.s > prev.s) byBeat.set(k, o);
    }
    let n = 0, sk = 0, st = 0, skk = 0, skt = 0, kmin = Infinity, kmax = -Infinity;
    for (const [k, o] of byBeat) { n++; sk += k; st += o.t; skk += k * k; skt += k * o.t; if (k < kmin) kmin = k; if (k > kmax) kmax = k; }
    if (n < 8 || kmax - kmin < 8) return null;
    const den = n * skk - sk * sk;
    if (den < 1e-6) return null;
    const b = (n * skt - sk * st) / den, a = (st - b * sk) / n;
    let ss = 0; for (const [k, o] of byBeat) { const r = o.t - (a + b * k); ss += r * r; }
    if (Math.sqrt(ss / n) > 0.05 * P) return null;   // ragged fit (rolls, syncopated bass): no opinion
    return Math.abs(b / P - 1) < 0.03 ? b : null;
  }

  _acceptTempo(Pc, conf, acfBest) {
    const P = this.period;
    const ratio = Pc / P;
    const near = Math.abs(ratio - 1) < 0.035;
    if (conf < (this.tempoLocked ? 0.3 : 0.15) || acfBest < 0.2) {
      // weak evidence (breakdown, pads): free-wheel on the current tempo, decay slowly
      if (near && conf > 0.1 && !this.tempoLocked) this.period = lerp(P, Pc, 0.1 * conf);
      this.tempoConf *= this.tempoLocked ? 0.99 : 0.9;
      this.pendingCount = 0;
    } else if (near) {
      const g = (this.tempoLocked ? 0.25 : 0.5) * clamp(conf / 0.5, 0.2, 1);
      const Pk = this._kickPeriod();
      if (Pk != null) this.kickPeriodT = this.lastHopT;
      // kick-free evidence (risers, pads) barely moves a locked period: the kicks own the tempo
      const gk = this.tempoLocked && this.lastHopT - this.kickPeriodT < 30 ? g * 0.1 : g;
      // a strong, clean ACF peak owns the tempo; the kick regression refines it (and takes over when the ACF is mushy)
      const wk = clamp(1.2 - acfBest, 0.15, 0.6);
      this.period = Pk != null ? lerp(P, lerp(Pc, Pk, wk), Math.max(gk, 0.35)) : lerp(P, Pc, gk);
      this.stable = Math.min(this.stable + 1, 20);
      this.pendingCount = 0;
      this.tempoConf = lerp(this.tempoConf, conf, conf > this.tempoConf ? 0.4 : 0.15);
    } else {
      const octave = Math.abs(ratio - 2) < 0.06 || Math.abs(ratio - 0.5) < 0.03;
      if (Math.abs(Pc / this.pendingPeriod - 1) < 0.035) this.pendingCount++; else { this.pendingPeriod = Pc; this.pendingCount = 1; }
      const need = octave && this.tempoLocked ? 8 : this.tempoLocked ? 4 : 2;
      if (this.pendingCount >= need || (!this.tempoLocked && this.tempoConf < 0.15)) {
        this.period = Pc; this.stable = 0; this.pendingCount = 0; this.tempoConf = conf * 0.7; this.tempoLocked = false;
        this.anchor = null; this.nextBeat = null; this.pendingPhaseCount = 0;
      } else this.tempoConf *= 0.95;
    }
    this.bpm = 60 / this.period;
    if (this.tempoLocked) this.tempoLocked = this.tempoConf > 0.2;
    else if (this.tempoConf > 0.45 && this.stable >= 4) { this.tempoLocked = true; this.lockedSince = this.lastHopT; }
  }

  // comb filter over the last ~5 s of a kick-weighted onset function -> most recent beat time
  _alignPhase(W, end, conf) {
    const hop = this.hopSec, Pf = this.period / hop;
    const L = Math.round(Pf);
    if (L < 8 || W < 3 * L) return;
    // kicks in the last 4 s: without them the phase evidence is unreliable -> free-wheel
    let kicks = 0;
    for (let i = this.onsets.length - 1; i >= 0; i--) { const o = this.onsets[i]; if (o.t < this.lastHopT - 4) break; if (o.k === 'k') kicks++; }
    if (kicks < 3 && this.tempoLocked) return;
    const y = this.phaseBuf;
    for (let j = 0; j < W; j++) {
      const i = end - W + 1 + j;
      let v = 0;
      for (let d = -1; d <= 1; d++) { const ii = (i + d) & MASK; v += this.odfB[ii] + 0.35 * this.odfM[ii] + 0.15 * this.odfH[ii]; }
      y[j] = v / 3;
    }
    const K = Math.min(10, Math.floor((W - 1) / Pf) - 1);
    let best = 0, bestV = -1, sum = 0;
    const comb = this.comb;
    for (let phi = 0; phi < L; phi++) {
      let s = 0, wgt = 1;
      for (let k = 0; k <= K; k++) {
        const pos = Math.round(W - 1 - phi - k * Pf);
        if (pos < 1) break;
        s += (y[pos] + 0.5 * (y[pos - 1] + y[Math.min(W - 1, pos + 1)])) * wgt; wgt *= 0.88;
      }
      comb[phi] = s; sum += s;
      if (s > bestV) { bestV = s; best = phi; }
    }
    const q = bestV > 1e-6 ? (bestV - sum / L) / bestV : 0;   // peak prominence 0..1
    if (q < 0.25) return;
    let phi = best;
    const a = comb[(best - 1 + L) % L], b = comb[best], c = comb[(best + 1) % L];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) phi = best + 0.5 * (a - c) / den;
    const tb = this.tim[end & MASK] - phi * hop - hop;         // onset-function peak sits ~1 hop after the attack
    const P = this.period;
    if (this.anchor == null) { this.anchor = tb; return; }
    let err = tb - (this.anchor + Math.round((tb - this.anchor) / P) * P);
    const gain = (this.tempoLocked ? 0.3 : 0.6) * clamp(q / 0.5, 0.3, 1) * clamp(conf / 0.3, 0.3, 1);
    if (Math.abs(err) < 0.25 * P || !this.tempoLocked) { this.anchor += err * gain; this.pendingPhaseCount = 0; }
    else {
      // large jump while locked: needs 3 consecutive agreeing estimates (rolls / offbeat hats cause P/2 ambiguity)
      if (Math.abs(err - this.pendingPhaseErr) < 0.1 * P) this.pendingPhaseCount++; else { this.pendingPhaseErr = err; this.pendingPhaseCount = 1; }
      if (this.pendingPhaseCount >= 3) { this.anchor += err; this.pendingPhaseCount = 0; }
    }
    this.anchor += Math.floor((this.lastHopT - this.anchor) / P) * P;
  }

  // ------------------------------------------------------------------ drops (ingest side, low latency)
  _confirmDrop(t, b) {
    if (t < this.dropPendingAt - 0.03) return;
    if (b > 0.55 * this.refB && b > 0.015) { this.dropPending = false; this.dropConfirmed = true; this.emit('pyro'); return; }
    if (t - this.dropPendingAt > 0.35) {
      this.dropPending = false;
      this.dropsSeen = Math.max(0, this.dropsSeen - 1);
      this.setPhase('build');
    }
  }
  _earlyDropCheck(t, b) {
    if (this.phase !== 'build' && this.phase !== 'breakdown') return;
    if (t - this.dropAt < 2) return;
    const h = this.hist[this.hist.length - 1];
    if (!h) return;
    const recent = Math.max(h.bass, this.hist.length > 1 ? this.hist[this.hist.length - 2].bass : 0);
    const bn = b / (this.refB + 1e-4);
    if (bn > 0.7 && bn > recent * 2.2 && b > 0.015 && this.lvB[(this.n - 4) & MASK] > 0.6 * this.refB && t - this._lastKickT < 0.12) this._snapToDrop(this._lastKickT);
  }
  _snapToDrop(tKick) {
    const P = this.period;
    if (this.anchor != null) {
      const err = tKick - (this.anchor + Math.round((tKick - this.anchor) / P) * P);
      this.anchor += err;
    }
    if (this.lastBeatT > 0 && Math.abs(tKick - this.lastBeatT) < 0.5 * P) this._startDrop(true);
    else { this._snapDownbeatNextBeat = true; this.nextBeat = tKick; }
  }
  // the current beat (or the previous one, when detected from its stats) becomes beat 1 of a new phrase; drop starts
  _startDrop(confirmed, atPrev = false) {
    const idx = atPrev ? this.beatIndex - 1 : this.beatIndex;
    this.downbeatOffset = idx; this.downbeatScore.fill(0); this.downbeatScore[((idx % 4) + 4) % 4] = 3;
    let barEmitted = false;
    if (this.lastBarBeat !== idx) { this.barIndex++; this.lastBarBeat = idx; if (!atPrev) { this.show.bar = true; barEmitted = true; } }
    this.phraseAnchorBar = this.barIndex; this.phraseLen = 8; this.phraseIndex++; this.show.phrase = true;
    this.phraseScore.fill(0); this.phraseScore[((this.barIndex % 8) + 8) % 8] = 3;
    // a drop snaps to a fresh colour triple (two steps on, so both lead colours change)
    this.colorIdx += 2; this._cueColors(true);
    if (confirmed) {
      this.downbeatHold = this.barIndex + 24; this.phraseHold = this.barIndex + 24; this.downbeatTrust = 1; this.phraseTrust = 1;
      this.phraseEvidence.fill(0); this.phraseEvidence[((this.barIndex % 8) + 8) % 8] = 3;
      if (this.posRef && this.firstKickPos != null && this.trackOffset != null) {
        const tDrop = atPrev ? this.lastBeatT - this.period : this.lastBeatT;
        const nb = (this._posAt(tDrop) - this.trackOffset) / this.period;
        this.priorBeatShift = ((Math.round(nb) % 32) + 32) % 32; this.priorCalibrated = true;
      }
    }
    this.dropConfirmed = confirmed; this.dropPending = !confirmed; this.dropPendingAt = this.lastBeatT;
    if (this.phase === 'drop') { this.dropAt = this._now(); this.dropsSeen++; this.emit('drop'); } else this.setPhase('drop');
    this.phaseBars = 0; this.phaseBeats = atPrev ? 1 : 0;
    if (barEmitted) this.emit('bar', this.barIndex);
    this.emit('phrase', this.phraseIndex);
    if (confirmed) this.emit('pyro');
  }

  // ------------------------------------------------------------------ frame update
  update(f, dt) {
    this._updateLead();
    const now = this._now();
    const s = this.show;
    s.dt = dt; s.t += dt; s.now = now;
    s.hopAge = (performance.now() - this.lastIngestPerf) / 1000;

    // fallback: no worklet data -> synthesise hops from analyser features (coarser)
    if (f && s.hopAge > 0.25 && f.rms > 0.0005) {
      this.hopSec = lerp(this.hopSec, clamp(dt, 0.008, 0.05), 0.2);
      this._pushHop(this.clock ? this.clock.now() : now, f.bass + f.sub * 0.6, f.lowMid * 0.5 + f.mid, f.high + f.air * 0.5, f.rms);
    }

    // ---- levels (normalised by slow references)
    const li = (this.n - 1) & MASK;
    const bRaw = this.lvB[li], mRaw = this.lvM[li], hRaw = this.lvH[li], fRaw = this.lvF[li];
    const kFast = 1 - Math.exp(-dt / 0.045), kSlow = 1 - Math.exp(-dt / 2.0);
    const eN = clamp(fRaw / (this.ref + 1e-4), 0, 1.4), bN = clamp(bRaw / (this.refB + 1e-4), 0, 1.4), hN = clamp(hRaw / (this.refH + 1e-5), 0, 1.4), mN = clamp(mRaw / (this.ref * 0.6 + 1e-4), 0, 1.4);
    s.energy += (eN - s.energy) * kFast; s.energySlow += (eN - s.energySlow) * kSlow;
    s.bass += (bN - s.bass) * kFast; s.mid += (mN - s.mid) * kFast; s.high += (hN - s.high) * kFast;
    s.rel = s.energy; s.bassRel = s.bass; s.highRel = s.high;
    s.darkness += (clamp(1 - hRaw / (fRaw * 0.25 + 1e-5), 0, 1) - s.darkness) * kSlow;
    s.silence = this.envF < 0.001 || this.n === 0;
    s.spectrum = f ? f.spectrum : s.spectrum; s.wave = f ? f.wave : s.wave;
    s.trackTime = now - this.trackStart;

    if (s.silence) {
      this._silentFor += dt;
      if (this._silentFor > 1.5 && this.phase !== 'idle') this.setPhase('idle');
    } else {
      this._silentFor = 0;
      if (this.phase === 'idle') this.setPhase('intro');
    }
    // `active` has hysteresis: a single near-silent analysis hop (tap hiccup, a gap between tracks) used to
    // zero every fixture for one frame, which read as a black flash in the middle of a drop.
    s.active = !s.silence || (this._silentFor < 0.35 && this.n > 0 && this.phase !== 'idle');

    s.downbeatTrust = this.downbeatTrust; s.phraseTrust = this.phraseTrust; s.trackPos = this.posRef ? this._posAt(now - this.lead) : 0;
    s.bpm = this.bpm; s.period = this.period; s.confidence = this.tempoConf; s.tempoLocked = this.tempoLocked;

    // ---- beat emission (predictive grid)
    s.beat = false; s.bar = false; s.phrase = false;
    const P = this.period;
    if (this.anchor != null && this.tempoConf >= 0.2 && !s.silence) {
      if (this.nextBeat == null) this.nextBeat = this.anchor + Math.ceil((now - this.anchor) / P) * P;
      else {
        const k = Math.round((this.nextBeat - this.anchor) / P);
        this.nextBeat = this.anchor + k * P;
        if (this.nextBeat < now - P) this.nextBeat = this.anchor + Math.ceil((now - this.anchor) / P) * P;
      }
      let guard = 0;
      while (now >= this.nextBeat && guard++ < 4) {
        if (this.nextBeat - this.lastBeatT > 0.5 * P) this._emitBeat(this.nextBeat, now);
        this.nextBeat += P;
      }
      this._pendingFallback = null;
    } else if (this._pendingFallback != null && !s.silence) {
      const tb = this._pendingFallback + this.lead;
      this._pendingFallback = null;
      if (tb - this.lastBeatT > 0.5 * P) this._emitBeat(tb, now);
    }
    this._gridFields(now);
    s.beatPulse = Math.max(0, s.beatPulse - dt * 4.5);

    // ---- sub-beat pulses: grid-predicted layers when a tempo lock exists, else detected transients (late by `lead`)
    const kickLayer = this._kickLayer(), snareLayer = this._snareLayer(), hatLayer = this._hatLayer();
    const bp = Math.min(1, s.beatPhase);
    const gridOk = this.anchor != null && this.tempoConf >= 0.2;
    const gridPulse = Math.exp(-bp * 9);
    const offPulse = Math.exp(-Math.abs(bp - 0.5) * 18);
    this._kick = Math.max(0, this._kick - dt * 14); this._snare = Math.max(0, this._snare - dt * 12); this._hat = Math.max(0, this._hat - dt * 22);
    s.kick = gridOk && kickLayer ? gridPulse : this._kick * 0.9;
    s.snare = gridOk && snareLayer ? ((s.beatInBar === 1 || s.beatInBar === 3) ? gridPulse : 0) : this._snare * 0.9;
    s.hat = gridOk && hatLayer ? offPulse * 0.8 : this._hat * 0.8;
    s.kickOn = kickLayer; s.snareOn = snareLayer; s.hatOn = hatLayer;
    s.roll = this.rollNorm;

    this._sectionFrame(s, now, dt);

    // ---- colours
    this.colorMix = Math.min(1, this.colorMix + dt / Math.max(0.2, P * 2));
    const e = this.colorMix * this.colorMix * (3 - 2 * this.colorMix);
    this.colorA.copy(this.colorFromA).lerp(this.colorToA, e);
    this.colorB.copy(this.colorFromB).lerp(this.colorToB, e);
    this.colorC.copy(this.colorFromC).lerp(this.colorToC, e);
    if (this.phase === 'build' && s.buildProgress > 0.55) { const w = (s.buildProgress - 0.55) / 0.45 * 0.8; this.colorA.lerp(WHITE, w); this.colorB.lerp(WHITE, w * 0.6); }
    else if (this.phase === 'breakdown' && this.coolColor) {
      // breakdowns sit cooler and softer: lead colours drift toward the palette's coolest hue, slightly greyed
      const k = Math.min(1, this.phaseBeats / 16) * 0.35;
      this.colorA.lerp(this.coolColor, k).lerp(GREY, k * 0.3); this.colorB.lerp(this.coolColor, k * 0.5).lerp(GREY, k * 0.2);
    }
    return s;
  }

  _gridFields(now) {
    const s = this.show, P = this.period;
    if (this.lastBeatT > 0) {
      s.beatPhase = clamp((now - this.lastBeatT) / P, 0, 1.5);
      s.nextBeatIn = Math.max(0, (this.nextBeat != null ? this.nextBeat : this.lastBeatT + P) - now);
    }
    s.beatIndex = Math.max(0, this.beatIndex); s.barIndex = Math.max(0, this.barIndex); s.phraseIndex = Math.max(0, this.phraseIndex);
    s.beatInBar = this.beatIndex < 0 ? 0 : (((this.beatIndex - this.downbeatOffset) % 4) + 4) % 4;
    s.barPhase = (s.beatInBar + Math.min(1, s.beatPhase)) / 4;
    const pb = this.barIndex < 0 ? 0 : (((this.barIndex - this.phraseAnchorBar) % this.phraseLen) + this.phraseLen) % this.phraseLen;
    s.phraseBar = pb; s.phraseBeat = pb * 4 + s.beatInBar; s.phraseLen = this.phraseLen;
    s.phrasePhase = (s.phraseBeat + Math.min(1, s.beatPhase)) / (4 * this.phraseLen);
  }

  _emitBeat(tb, now) {
    const s = this.show;
    this.beatIndex++;
    this.lastBeatT = tb;
    const st = this._beatStats(tb - this.lead - this.period, tb - this.lead);
    this.hist.push(st); if (this.hist.length > 64) this.hist.shift();
    // st describes the beat that just ended (index beatIndex-1): credit its slot
    const prevSlot = (((this.beatIndex - 1) % 4) + 4) % 4;
    // score decay is paced by evidence: a kick-less breakdown or build offers nothing to contradict the grid, so it
    // keeps the downbeat / phrase it trusted (EDM keeps the grid through the whole track) instead of fading it out
    const kicked = st.kick > 0.25;
    const dbDecay = kicked ? 0.93 : 0.995;
    for (let i = 0; i < 4; i++) this.downbeatScore[i] *= dbDecay;
    const prev = this.hist.length > 1 ? this.hist[this.hist.length - 2] : st;
    // kick-less bars (breaks, builds) carry pattern evidence that is often half-bar periodic (shaker, plucks); it is
    // weighted down so the downbeat found at the last drop is kept until real kick evidence contradicts it
    const evW = kicked ? 1 : 0.1;
    this.downbeatScore[prevSlot] += evW * (st.kick * 0.6 + Math.max(0, st.bass - prev.bass) * 4 + Math.max(0, st.full - prev.full) * 3 + Math.max(0, st.high - prev.high) * 2);
    // continuity prior: the bar phase of a locked grid does not wander, so the current anchor gets a small steady vote
    this.downbeatScore[((this.downbeatOffset % 4) + 4) % 4] += evW * 0.04;
    // track-position prior: beat grid origin at the first kick, phrases every 32 beats
    this._priorPhraseBeat = -1;
    if (this.posRef && this.firstKickPos != null && this.tempoLocked) {
      // beat grid assumed to pass through track position 0 (+ sub-beat residual of the first kick); phrases every 32 beats
      const fk = this.firstKickPos;
      this.trackOffset = fk - Math.round(fk / this.period) * this.period;
      const nb = (this._posAt(tb - this.period) - this.trackOffset) / this.period;
      const e = nb - Math.round(nb);
      if (Math.abs(e) < 0.3) {
        const pbeat = (((Math.round(nb) - this.priorBeatShift) % 32) + 32) % 32;
        this._priorPhraseBeat = pbeat;
        this.downbeatScore[(((this.beatIndex - 1 - pbeat) % 4) + 4) % 4] += 0.25 * (1 - Math.abs(e) / 0.3);
      }
    }
    {
      // trust is the margin of the best slot over the runner-up, measured against the discriminative part of the
      // scores (the floor shared by all four slots is uniform four-on-the-floor evidence and says nothing)
      const sc = this.downbeatScore;
      let bi = 0; for (let i = 1; i < 4; i++) if (sc[i] > sc[bi]) bi = i;
      let second = -1, lo = Infinity; for (let i = 0; i < 4; i++) { if (i !== bi && sc[i] > second) second = sc[i]; if (sc[i] < lo) lo = sc[i]; }
      this.downbeatTrust = this.barIndex <= this.downbeatHold ? 1 : clamp((sc[bi] - second) / (sc[bi] - lo + 0.3), 0, 1);
    }
    if (this._forceDropNext) { this._forceDropNext = false; this._startDrop(true); }
    else if (this._dropOnNextBeat) { this._dropOnNextBeat = false; if (this.phase === 'build') this._startDrop(false); }
    else if (this._snapDownbeatNextBeat) { this._snapDownbeatNextBeat = false; this._startDrop(true); }
    else {
      const sc = this.downbeatScore;
      let bi = 0, lo = Infinity; for (let i = 0; i < 4; i++) { if (sc[i] > sc[bi]) bi = i; if (sc[i] < lo) lo = sc[i]; }
      const cur = ((this.downbeatOffset % 4) + 4) % 4;
      if (bi !== cur && this.barIndex > this.downbeatHold && sc[bi] - lo > 0.8 && sc[bi] - lo > (sc[cur] - lo) * 1.5 + 0.3) this.downbeatOffset = bi;
      if ((((this.beatIndex - this.downbeatOffset) % 4) + 4) % 4 === 0) this._newBar();
    }
    this._gridFields(now);
    const strength = clamp(0.5 + st.kick * 0.3 + st.bass * 0.4, 0.4, 1.5);
    s.beat = true; s.beatStrength = strength; s.beatPulse = 1;
    this.phaseBeats++;
    this._sectionBeat(st);
    this.emit('beat', this.beatIndex, strength);
  }

  _newBar() {
    this.barIndex++; this.lastBarBeat = this.beatIndex;
    this.phaseBars++;
    this.show.bar = true;
    this._scorePhrase();
    const pb = (((this.barIndex - this.phraseAnchorBar) % this.phraseLen) + this.phraseLen) % this.phraseLen;
    if (pb === 0) { this.phraseIndex++; this.show.phrase = true; this._phraseColors(); this.emit('phrase', this.phraseIndex); }
    this.emit('bar', this.barIndex);
  }

  // evidence that the bar that just ended (barIndex-1) started a phrase: energy / crash jump at its first beat, position prior
  _scorePhrase() {
    const h = this.hist, L = h.length;
    const ps = this.phraseScore;
    let kb = 0; for (let i = Math.max(0, L - 4); i < L; i++) if (h[i].kick > 0.25) kb++;
    const decay = kb >= 2 ? 0.9 : 0.985;
    const evW = kb >= 2 ? 1 : 0.3;   // kick-less bars: melodic patterns repeat every 2/4 bars, weak phrase evidence
    for (let i = 0; i < 8; i++) ps[i] *= decay;
    const ev = this.phraseEvidence;
    for (let i = 0; i < 8; i++) ev[i] *= decay;
    const ended = this.barIndex - 1;
    const slot = ((ended % 8) + 8) % 8;
    if (L >= 8) {
      const first = h[L - 4];
      let pf = 0, pb = 0, ph = 0;
      for (let i = L - 8; i < L - 4; i++) { pf += h[i].full; pb += h[i].bass; ph += h[i].high; }
      pf /= 4; pb /= 4; ph /= 4;
      const j = Math.max(0, first.full - pf) * 2 + Math.max(0, first.bass - pb) * 2 + Math.max(0, first.high - ph) * 2.5;
      ps[slot] += evW * j; ev[slot] += j;
    }
    if (this._priorPhraseBeat >= 0) {
      // the beat that just ended has phrase-beat index p -> the bar containing it is bar floor(p/4) of the phrase
      const barOfPhrase = Math.floor(this._priorPhraseBeat / 4);
      ps[(((slot - barOfPhrase) % 8) + 8) % 8] += 0.3;
    }
    const cur = ((this.phraseAnchorBar % 8) + 8) % 8;
    ps[cur] += evW * 0.03;   // continuity prior for the current phrase anchor
    let bi = 0; for (let i = 1; i < 8; i++) if (ps[i] > ps[bi]) bi = i;
    let second = -1, lo = Infinity; for (let i = 0; i < 8; i++) { if (i !== bi && ps[i] > second) second = ps[i]; if (ps[i] < lo) lo = ps[i]; }
    if (this.barIndex <= this.phraseHold) this.phraseTrust = 1;
    else {
      this.phraseTrust = clamp((ps[bi] - second) / (ps[bi] - lo + 0.25), 0, 1);
      if (bi !== cur && ps[bi] - lo > 0.6 && ps[bi] - lo > (ps[cur] - lo) * 1.5 + 0.3) {
        this.phraseAnchorBar = this.barIndex - (((this.barIndex - bi) % 8) + 8) % 8;
        this.phraseEvidenced = false;
      }
    }
    let be = 0; for (let i = 1; i < 8; i++) if (ev[i] > ev[be]) be = i;
    if (ev[be] >= 0.3 && be === ((this.phraseAnchorBar % 8) + 8) % 8) this.phraseEvidenced = true;
  }

  _beatStats(t0, t1) {
    let bass = 0, full = 0, high = 0, cnt = 0;
    for (let i = this.n - 1; i >= 0 && i > this.n - 400; i--) {
      const ii = i & MASK; const t = this.tim[ii];
      if (t > t1) continue; if (t < t0) break;
      bass += this.lvB[ii]; full += this.lvF[ii]; high += this.lvH[ii]; cnt++;
    }
    if (cnt) { bass /= cnt; full /= cnt; high /= cnt; }
    let kick = 0, mids = 0;
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const o = this.onsets[i]; if (o.t < t0 - 0.12) break; if (o.t > t1 + 0.05) continue;
      if (o.k === 'k') kick = Math.max(kick, Math.min(3, o.s) / 3);
      if (o.k === 's') mids++;
    }
    return { kick, bass: bass / (this.refB + 1e-4), full: full / (this.ref + 1e-4), high: high / (this.refH + 1e-5), mids, t: t1, fraw: full, hraw: high };
  }

  _recentBase(final) {
    const h = this.hist, L = h.length, n = Math.min(4, L);
    const b = { n, mids: 0, high: 0, full: 0, final: !!final };
    for (let i = L - n; i < L; i++) { b.mids += h[i].mids / n; b.high += h[i].hraw / n; b.full += h[i].fraw / n; }
    return b;
  }

  _kickLayer() { const h = this.hist; if (h.length < 2) return false; let k = 0; for (let i = Math.max(0, h.length - 4); i < h.length; i++) if (h[i].kick > 0.25) k++; return k >= 2; }
  _snareLayer() { const h = this.hist; if (h.length < 4) return false; let c = 0; for (let i = Math.max(0, h.length - 8); i < h.length; i++) if (h[i].mids >= 1 && h[i].mids <= 3) c++; return c >= 3; }
  _hatLayer() { return this.hatRate > 3; }

  // ------------------------------------------------------------------ section machine (per beat)
  _sectionBeat(st) {
    const h = this.hist, L = h.length, beats0 = this.phaseBeats, p = this.phase;
    const avg = (from, to, fn) => { let v = 0, c = 0; for (let i = Math.max(0, from); i < Math.min(L, to); i++) { v += fn(h[i]); c++; } return c ? v / c : 0; };
    const kicks4 = avg(L - 4, L, (x) => (x.kick > 0.25 ? 1 : 0)) * 4;
    const kicks8 = avg(L - 8, L, (x) => (x.kick > 0.25 ? 1 : 0)) * 8;
    const bass4 = avg(L - 4, L, (x) => x.bass), full4 = avg(L - 4, L, (x) => x.full), high8 = avg(L - 8, L, (x) => x.high);
    const highPrev = L >= 16 ? avg(L - 16, L - 8, (x) => x.high) : high8;
    const bassPrev = L >= 12 ? avg(L - 12, L - 4, (x) => x.bass) : bass4;
    const mids4 = avg(L - 4, L, (x) => x.mids), midsPrev = L >= 8 ? avg(L - 8, L - 4, (x) => x.mids) : mids4;
    const driving = kicks4 >= 3;
    const heavy = bass4 > 0.45;
    const loud = full4 > 0.62;
    const high4 = avg(L - 4, L, (x) => x.high), highPrev4 = L >= 8 ? avg(L - 8, L - 4, (x) => x.high) : high4;
    const kicks12 = avg(L - 12, L, (x) => (x.kick > 0.25 ? 1 : 0)) * 12;
    const high4b = L >= 12 ? avg(L - 12, L - 8, (x) => x.high) : highPrev4;
    const riserRel = (L >= 12 && kicks12 === 0 && high4 > highPrev4 * 1.12 && highPrev4 > high4b * 1.04 && high4 > high4b * 1.35 && high4 > 0.08)
      || (L >= 8 && kicks8 === 0 && high4 > highPrev4 * 1.5 && high4 > 0.15);
    const midsPrev2 = L >= 12 ? avg(L - 12, L - 8, (x) => x.mids) : midsPrev;
    const full4r = avg(L - 4, L, (x) => x.fraw), high4r = avg(L - 4, L, (x) => x.hraw);
    // Raw (un-normalised) high-band growth bar over bar: a riser sweeping up over several bars is invisible to the
    // reference-relative `high` (the reference follows it within a beat), so it is judged on raw levels.
    const hb1 = L >= 8 ? avg(L - 8, L - 4, (x) => x.hraw) : high4r, hb2 = L >= 12 ? avg(L - 12, L - 8, (x) => x.hraw) : hb1;
    const baseHigh = this.phaseBase && this.phaseBase.final ? this.phaseBase.high : 0;
    const riserRaw = L >= 12 && high4r > hb1 * 1.12 && hb1 > hb2 * 1.04 && high4r > hb2 * 1.3 && high4r > 0.003 && high4r > baseHigh * 1.4;
    const riseGrowth = hb1 > hb2 && high4r > 0.003 ? clamp((high4r / Math.max(hb2, 1e-4) - 1.3) / 1.2, 0, 1) : 0;
    const riser = riserRel || riserRaw;
    // Calm baseline of the section (settled over beats 4..8, then following the sound down quickly and up slowly, so a
    // breakdown that thins out re-arms). Tension is growth against it: a steady shaker / hat / pluck pattern scores 0,
    // a snare roll thickening, a riser sweeping up or the whole mix swelling scores towards 1.
    const b = this.phaseBase;
    if (this._baseAcc && beats0 >= 4 && beats0 < 8) { const a = this._baseAcc; a.n++; a.mids += st.mids; a.high += st.hraw; a.full += st.fraw; if (a.n >= 4) { this.phaseBase = { mids: a.mids / a.n, high: a.high / a.n, full: a.full / a.n, final: true }; this._baseAcc = null; } }
    else if (b && b.final && p !== 'build') {
      const mids8 = avg(L - 8, L, (x) => x.mids), full8 = avg(L - 8, L, (x) => x.fraw), high8r = avg(L - 8, L, (x) => x.hraw);
      b.mids += (mids8 - b.mids) * (mids8 < b.mids ? 0.15 : 0.02);
      b.full += (full8 - b.full) * (full8 < b.full ? 0.15 : 0.02);
      b.high += (high8r - b.high) * (high8r < b.high ? 0.15 : 0.02);
    }
    const settled = !!(this.phaseBase && this.phaseBase.final);
    const rollScore = settled ? clamp((mids4 - Math.max(1, this.phaseBase.mids * 1.25)) / 4, 0, 1) : 0;
    const riseScore = Math.max(riseGrowth, settled ? clamp((high4r / Math.max(this.phaseBase.high, 1e-4) - 1.3) / 1.2, 0, 1) : 0);
    const fullScore = settled ? clamp((full4r / Math.max(this.phaseBase.full, 1e-4) - 1.25) / 0.9, 0, 1) : 0;
    const rollGrow = mids4 >= 2.5 && mids4 >= midsPrev * 1.3 && midsPrev >= midsPrev2 * 1.15 && midsPrev > 0;   // two consecutive rises: a roll, not a pattern switching on
    const rolling = mids4 >= 2.5 && (rollGrow || rollScore >= 0.35);
    const swelling = kicks8 <= 1 && (fullScore >= 0.35 || riseScore >= 0.35);
    // kicks just went out: only a riser or an accelerating roll makes that a build; a percussive breakdown that merely
    // has a different pattern than the drop is judged later, against its own settled baseline
    const rising = riser || (mids4 >= 2.5 && rollGrow);
    const raw = Math.max(rollScore, riseScore, fullScore, riser ? 0.5 : 0, rollGrow ? 0.45 : 0);
    this.tension = p === 'build' || p === 'breakdown' || p === 'intro' ? Math.max(raw, this.tension * 0.85) : raw * 0.5;
    this.rollNorm = rollScore;
    const prevBeat = L > 1 ? h[L - 2] : st;
    const bassJump = st.bass > bassPrev * 1.5 && st.bass > 0.6 && st.kick > 0.3 && st.bass > prevBeat.bass * 1.35;
    const beats = this.phaseBeats, bars = this.phaseBars;
    const s = this.show;
    // st = the beat that just ended; its grid position:
    const endedBib = (s.beatInBar + 3) % 4;
    const endedBar = s.beatInBar === 0 ? (s.phraseBar + this.phraseLen - 1) % this.phraseLen : s.phraseBar;
    const onDownbeat = endedBib === 0 || this.downbeatTrust < 0.5;
    const atPhraseEdge = onDownbeat && (endedBar === 0 || endedBar === 4 || this.phraseTrust < 0.5);
    this.tense = this.tension > 0.3 || (fullScore > 0.2 && Math.max(st.full, L > 1 ? h[L - 2].full : 0) > 0.8) || (riser && high4 > 0.4);
    this._flags = { kicks4, kicks8, kicks12, bass4, full4, high4, highPrev4, high4b, high8, highPrev, mids4, midsPrev, driving, heavy, loud, riser, riserRaw, riseGrowth, hb1, hb2, rolling, swelling, bassJump, tense: this.tense, tension: this.tension, rollScore, riseScore, fullScore, base: this.phaseBase, stBass: st.bass, stKick: st.kick, stHigh: st.high };

    switch (p) {
      case 'idle': this.setPhase('intro'); break;
      case 'intro':
        if (bassJump && driving && onDownbeat && beats >= 8) this._startDrop(true, true);
        else if (driving && beats >= 8) this.setPhase('groove');
        else if (!driving && (riser || rolling) && beats >= 8) this.setPhase('build');
        else if (!driving && beats >= 32) this.setPhase('breakdown');
        break;
      case 'groove':
        if (kicks4 === 0 && beats >= 4) this.setPhase(rising ? 'build' : 'breakdown');
        else if (kicks8 <= 2 && beats >= 8) this.setPhase('breakdown');
        else if (!driving && (riser || rolling)) this.setPhase('build');
        else if (bassJump && (atPhraseEdge || (onDownbeat && st.full > full4 * 1.3)) && beats >= 4) this._startDrop(true, true);
        else if (heavy && loud && full4 > 0.85 && beats >= 16) this.setPhase('peak');
        break;
      case 'breakdown':
        if (riser || rolling || swelling) this.setPhase('build');
        else if (driving && heavy && onDownbeat && beats >= 4) this._startDrop(true, true);
        else if (driving && bars >= 4) this.setPhase('groove');
        break;
      case 'build':
        if ((bassJump || (driving && heavy && st.bass > 0.75)) && onDownbeat && beats >= 4 && !this.dropPending) this._startDrop(true, true);
        else if (driving && !riser && !rolling && beats >= 32 && !heavy) this.setPhase('groove');
        // no growth for 4 bars (no riser, no roll, mid onsets flat): that was a percussive breakdown, not a build
        else if (!driving && !riser && !rolling && !swelling && beats >= 16 && this.tension < 0.2) this.setPhase('breakdown');
        else if (bars >= 40) this.setPhase('breakdown');
        break;
      case 'drop':
        if (kicks4 === 0 && beats >= 4) this.setPhase(rising ? 'build' : 'breakdown');
        else if (bars >= 8) { if (driving && heavy) this.setPhase('peak'); else if (!driving) this.setPhase('breakdown'); else this.setPhase('groove'); }
        break;
      case 'peak':
        if (kicks4 === 0 && beats >= 4) this.setPhase(rising ? 'build' : 'breakdown');
        else if (kicks4 <= 1 && beats >= 8) this.setPhase(riser || rolling ? 'build' : 'breakdown');
        else if (riser && !driving) this.setPhase('build');
        else if (!heavy && !driving && beats >= 8) this.setPhase('groove');
        else if (bassJump && atPhraseEdge && bars >= 8) this._startDrop(true, true);
        break;
    }

    // predictive drop: build ending on the last beat of a phrase with the tension peaking
    if (this.phase === 'build' && this._gridTrusted()) {
      const lastBar = s.phraseBar === this.phraseLen - 1;
      const prog = this._buildProgress();
      const tense = this.tense;
      if (lastBar && s.beatInBar === 3 && prog > 0.5 && tense && bars >= 2) this.emit('predrop');
      if (lastBar && s.beatInBar === 3 && prog > 0.72 && tense && bars >= 2) this._dropOnNextBeat = true;
    }
  }

  _gridTrusted() {
    if (this.downbeatTrust < 0.5 || this.phraseTrust < 0.5) return false;
    return this.priorCalibrated || this.phraseEvidenced;
  }

  _buildProgress() {
    const s = this.show;
    const pPhrase = (s.phraseBar + s.beatInBar / 4) / this.phraseLen;
    const pBuild = clamp((this.phaseBars + s.beatInBar / 4) / 16, 0, 1);
    // the phrase position says when the drop would land, the tension says whether one is coming: with no growth
    // evidence the ramp (strobes, whiteout) stays low, so a percussive breakdown never strobes the stage out
    const gate = clamp(this.tension / 0.4, 0.25, 1);
    return clamp((0.6 * pPhrase + 0.4 * pBuild) * gate + 0.3 * this.tension, 0, 1);
  }

  // ------------------------------------------------------------------ section outputs (per frame)
  _sectionFrame(s, now, dt) {
    const p = this.phase, P = this.period;
    s.phase = p; s.phaseTime = now - this.phaseSince; s.phaseBars = this.phaseBars; s.sectionBars = this.phaseBars;
    s.dropCount = this.dropsSeen; s.dropConfirmed = this.dropConfirmed && !this.dropPending;
    const bp = Math.min(1, s.beatPhase);
    let strobe = 0, strobeRate = 0, whiteout = 0;
    s.buildProgress = 0; s.predrop = false; s.dip = 0;
    if (p !== 'build') { this._dipDone = false; this._dipAt = 0; }
    if (p === 'build') {
      const prog = clamp(this._buildProgress() + bp / (4 * this.phraseLen) * 0.6, 0, 1);
      s.buildProgress = prog;
      strobeRate = 2 + 18 * prog * prog;
      strobe = 0.25 + 0.75 * prog;
      whiteout = prog * prog * prog * 0.5;
      const lastBar = s.phraseBar === this.phraseLen - 1 && this._gridTrusted() && this.phaseBars >= 2;
      s.predrop = lastBar && s.beatInBar === 3 && prog > 0.5 && this.tense;
      // Pre-drop dip: one short partial dim (never a full blackout) half a beat before a confidently
      // predicted drop. Fires once per build, so a missed prediction can't re-trigger it every phrase.
      if (this._dropOnNextBeat && s.predrop && bp > 0.5 && !this._dipDone) { this._dipDone = true; this._dipAt = now; }
      if (this._dipAt > 0) {
        const age = now - this._dipAt;
        s.dip = age < 0.22 ? 0.8 * Math.min(1, Math.max(age, 0.004) / 0.03) : Math.max(0, 0.8 * (1 - (age - 0.22) / 0.08));
        if (age > 0.3) this._dipAt = 0;   // clear only once the envelope has fully played out (age 0 on the arming frame must not clear it)
      }
      if (s.dip > 0.3) { strobe *= 1 - s.dip; whiteout = 0; }
    } else if (p === 'drop') {
      const age = now - this.dropAt;
      whiteout = age < 0.25 ? 1 - age / 0.25 : 0;
      strobe = age < P * 2 ? 1 : 0.55;
      strobeRate = 12;
      s.dropPulse = clamp(1 - age / (P * 1.5), 0, 1);
    } else if (p === 'peak') { strobe = 0.5; strobeRate = 8; }
    else if (p === 'groove') { strobe = 0.15; strobeRate = 4; }
    if (p !== 'drop') s.dropPulse = Math.max(0, s.dropPulse - dt * 1.5);
    s.strobe = strobe; s.strobeRate = strobeRate; s.whiteout = whiteout;
  }

  // ------------------------------------------------------------------ colours
  _cueColors(snap) {
    const pal = this.palette, n = pal.length;
    const i = this.colorIdx % n;
    this.colorFromA.copy(this.colorA); this.colorFromB.copy(this.colorB); this.colorFromC.copy(this.colorC);
    this.colorToA.copy(pal[i]); this.colorToB.copy(pal[(i + 1) % n]); this.colorToC.copy(pal[(i + 2) % n]);
    this.colorMix = snap ? 1 : 0;
    if (snap) { this.colorA.copy(this.colorToA); this.colorB.copy(this.colorToB); this.colorC.copy(this.colorToC); }
  }
}
