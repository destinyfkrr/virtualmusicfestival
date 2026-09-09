// Ring-buffer feeder: receives Float32 PCM chunks from the main thread (WebSocket) and
// plays them out as an audio-graph source so the AnalyserNode can run on them.
class PCMFeeder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1 << 17; // 131072 samples (~2.7 s @ 48 kHz)
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.r = 0;
    this.avail = 0;
    this.target = 1024;   // ~21 ms of pre-roll before playback starts (analysis-only, never heard)
    this.max = 6000;      // ~125 ms: if we fall further behind, skip ahead
    this.primed = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Float32Array) this.push(d);
      else if (d && d.type === 'reset') { this.w = this.r = this.avail = 0; this.primed = false; }
    };
  }
  push(d) {
    for (let i = 0; i < d.length; i++) { this.buf[this.w] = d[i]; this.w = (this.w + 1) & this.mask; }
    this.avail += d.length;
    if (this.avail > this.size) { const drop = this.avail - this.size; this.r = (this.r + drop) & this.mask; this.avail = this.size; }
    if (this.avail > this.max) { const drop = this.avail - this.target; this.r = (this.r + drop) & this.mask; this.avail -= drop; }
    if (this.avail >= this.target) this.primed = true;
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.primed || this.avail < out.length) { out.fill(0); this.primed = false; return true; }
    for (let i = 0; i < out.length; i++) { out[i] = this.buf[this.r]; this.r = (this.r + 1) & this.mask; }
    this.avail -= out.length;
    return true;
  }
}
registerProcessor('pcm-feeder', PCMFeeder);
