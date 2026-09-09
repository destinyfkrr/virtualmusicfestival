// Onset tap: sits between the audio source and the AnalyserNode. Passes audio through
// untouched and, every hop (256 samples ≈ 5.3 ms), measures band energies:
//   [bass(<150 Hz), mid(150 Hz–2.5 kHz), high(>2.5 kHz), full]
// Hops are posted to the main thread in small batches with an audio-clock timestamp so
// the ShowDirector can run onset detection / tempo tracking on a fixed, sample-accurate grid
// that does not depend on requestAnimationFrame timing or analyser smoothing.
class OnsetTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hop = 256;
    this.batchHops = 4;               // 4 hops ≈ 21 ms per message
    const sr = sampleRate;
    const coef = (fc) => 1 - Math.exp(-2 * Math.PI * fc / sr);
    this.aB = coef(150);
    this.aM = coef(2500);
    this.lp1 = 0; this.lp2 = 0; this.lpm1 = 0; this.lpm2 = 0;
    this.n = 0; this.eB = 0; this.eM = 0; this.eH = 0; this.eF = 0;
    this.buf = new Float32Array(this.batchHops * 4);
    this.k = 0;
    this.t0 = 0;
    this.frame = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const x = inp && inp[0];
    if (!x) { if (out && out[0]) out[0].fill(0); return true; }
    if (out && out[0]) out[0].set(x);
    const aB = this.aB, aM = this.aM;
    let lp1 = this.lp1, lp2 = this.lp2, lpm1 = this.lpm1, lpm2 = this.lpm2;
    let eB = this.eB, eM = this.eM, eH = this.eH, eF = this.eF, n = this.n;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      lp1 += aB * (v - lp1); lp2 += aB * (lp1 - lp2);      // 2-pole low-pass ≈150 Hz
      lpm1 += aM * (v - lpm1); lpm2 += aM * (lpm1 - lpm2); // 2-pole low-pass ≈2.5 kHz
      const bass = lp2, mid = lpm2 - lp2, high = v - lpm2;
      eB += bass * bass; eM += mid * mid; eH += high * high; eF += v * v;
      n++;
      if (n === this.hop) {
        if (this.k === 0) this.t0 = currentTime + (i + 1 - this.hop) / sampleRate;
        const o = this.k * 4;
        this.buf[o] = Math.sqrt(eB / n); this.buf[o + 1] = Math.sqrt(eM / n); this.buf[o + 2] = Math.sqrt(eH / n); this.buf[o + 3] = Math.sqrt(eF / n);
        eB = eM = eH = eF = 0; n = 0;
        this.k++;
        if (this.k === this.batchHops) {
          this.port.postMessage({ t: this.t0, hopSec: this.hop / sampleRate, data: this.buf.slice(0) });
          this.k = 0;
        }
      }
    }
    this.lp1 = lp1; this.lp2 = lp2; this.lpm1 = lpm1; this.lpm2 = lpm2;
    this.eB = eB; this.eM = eM; this.eH = eH; this.eF = eF; this.n = n;
    return true;
  }
}
registerProcessor('onset-tap', OnsetTap);
