// ScriptProcessorNode stand-ins for the two AudioWorklets.
//
// AudioWorklet is only defined in a secure context, so `ctx.audioWorklet` is undefined when the
// page is opened over plain http:// from another machine on the network (http://192.168.x.x:5173).
// ScriptProcessorNode is deprecated but has no such restriction and is supported everywhere, so we
// fall back to it and the app keeps working — a little more main-thread jitter, same show.
//
// Both factories expose the same `.port.postMessage` / `.port.onmessage` surface as the worklet
// nodes they replace, so nothing downstream has to know which one it got.

const FEEDER_BLOCK = 2048;   // ~43 ms at 48 kHz; large enough to survive main-thread hiccups
const ONSET_BLOCK = 1024;

function makePort() {
  return { onmessage: null, postMessage() {} };
}

/** pcm-feeder: plays WebSocket PCM out into the graph. See js/pcm-worklet.js. */
export function createFeederFallback(ctx) {
  const node = ctx.createScriptProcessor(FEEDER_BLOCK, 1, 1);
  const size = 1 << 17;                 // 131072 samples (~2.7 s @ 48 kHz)
  const mask = size - 1;
  const buf = new Float32Array(size);
  let w = 0, r = 0, avail = 0, primed = false;
  const target = 2048;                  // pre-roll before playback starts (analysis-only, never heard)
  const max = 12000;                    // if we fall further behind than ~250 ms, skip ahead

  const port = makePort();
  port.postMessage = (d) => {
    if (d instanceof Float32Array) {
      for (let i = 0; i < d.length; i++) { buf[w] = d[i]; w = (w + 1) & mask; }
      avail += d.length;
      if (avail > size) { const drop = avail - size; r = (r + drop) & mask; avail = size; }
      if (avail > max) { const drop = avail - target; r = (r + drop) & mask; avail -= drop; }
      if (avail >= target) primed = true;
    } else if (d && d.type === 'reset') { w = r = avail = 0; primed = false; }
  };

  node.onaudioprocess = (e) => {
    const out = e.outputBuffer.getChannelData(0);
    if (!primed || avail < out.length) { out.fill(0); primed = false; return; }
    for (let i = 0; i < out.length; i++) { out[i] = buf[r]; r = (r + 1) & mask; }
    avail -= out.length;
  };

  node.port = port;
  return node;
}

/** onset-tap: passes audio through and posts per-hop band energies. See js/analysis-worklet.js. */
export function createOnsetFallback(ctx) {
  const node = ctx.createScriptProcessor(ONSET_BLOCK, 1, 1);
  const sr = ctx.sampleRate;
  const hop = 256, batchHops = 4;
  const coef = (fc) => 1 - Math.exp(-2 * Math.PI * fc / sr);
  const aB = coef(150), aM = coef(2500);
  let lp1 = 0, lp2 = 0, lpm1 = 0, lpm2 = 0;
  let eB = 0, eM = 0, eH = 0, eF = 0, n = 0, k = 0, t0 = 0;
  let out4 = new Float32Array(batchHops * 4);

  const port = makePort();

  node.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    e.outputBuffer.getChannelData(0).set(x);
    // playbackTime is when this block reaches the speakers, on the same clock as ctx.currentTime
    const blockTime = Number.isFinite(e.playbackTime) ? e.playbackTime : ctx.currentTime;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      lp1 += aB * (v - lp1); lp2 += aB * (lp1 - lp2);        // 2-pole low-pass ≈150 Hz
      lpm1 += aM * (v - lpm1); lpm2 += aM * (lpm1 - lpm2);   // 2-pole low-pass ≈2.5 kHz
      const bass = lp2, mid = lpm2 - lp2, high = v - lpm2;
      eB += bass * bass; eM += mid * mid; eH += high * high; eF += v * v;
      n++;
      if (n === hop) {
        if (k === 0) t0 = blockTime + (i + 1 - hop) / sr;
        const o = k * 4;
        out4[o] = Math.sqrt(eB / n); out4[o + 1] = Math.sqrt(eM / n);
        out4[o + 2] = Math.sqrt(eH / n); out4[o + 3] = Math.sqrt(eF / n);
        eB = eM = eH = eF = 0; n = 0;
        if (++k === batchHops) {
          port.onmessage?.({ data: { t: t0, hopSec: hop / sr, data: out4.slice(0) } });
          k = 0;
        }
      }
    }
  };

  node.port = port;
  return node;
}

/** true when this page can use real AudioWorklets (https:// or localhost) */
export function hasAudioWorklet(ctx) {
  return !!(ctx.audioWorklet && typeof ctx.audioWorklet.addModule === 'function');
}
