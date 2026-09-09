// AudioEngine: owns the AudioContext + AnalyserNode and the audio source
// (native Spotify tap over WebSocket, an input device, or screen-share audio).
// Produces per-frame spectral features for the ShowDirector.

const BANDS = {
  sub: [20, 60],
  bass: [60, 160],
  lowMid: [160, 450],
  mid: [450, 2000],
  high: [2000, 6000],
  air: [6000, 16000],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.feeder = null;
    this.mute = null;
    this.currentSource = null;   // node currently feeding the analyser
    this.currentStream = null;   // MediaStream (device/screen sources)
    this.sourceKind = 'server';
    this.fmt = { sampleRate: 48000, channels: 1 };
    this.ws = null;
    this.wsOpen = false;
    this.tapState = 'connecting';
    this.track = { state: 'stopped' };
    this.onTrack = null;
    this.onStatus = null;
    this.onAnalysis = null;      // (msg) => void, hop-energy batches from the onset tap worklet
    this.onsetTap = null;
    this.lastHopAt = 0;
    this.spectrum = new Uint8Array(1024);
    this.wave = new Float32Array(2048);
    this.features = { sub: 0, bass: 0, lowMid: 0, mid: 0, high: 0, air: 0, rms: 0, peak: 0, spectrum: this.spectrum, wave: this.wave };
    this.bytesIn = 0;
    this.lastBytesAt = 0;
  }

  status() {
    if (this.sourceKind === 'server') {
      if (!this.wsOpen) return { level: 'bad', text: 'server offline' };
      if (this.tapState === 'live') return { level: performance.now() - this.lastBytesAt < 1500 ? 'live' : 'warn', text: performance.now() - this.lastBytesAt < 1500 ? 'live · spotify tap' : 'spotify silent' };
      if (this.tapState === 'spotify-closed') return { level: 'warn', text: 'open spotify' };
      if (this.tapState === 'permission') return { level: 'bad', text: 'audio permission needed' };
      if (this.tapState === 'unavailable') return { level: 'bad', text: 'tap unavailable' };
      return { level: 'warn', text: 'tap ' + this.tapState };
    }
    return { level: 'live', text: 'live · ' + (this.sourceKind === 'screen' ? 'screen audio' : 'input device') };
  }

  async start() {
    await this.ensureContext(this.fmt.sampleRate);
    this.connectWS();
  }

  async ensureContext(rate) {
    if (this.ctx && this.ctx.sampleRate === rate) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    if (this.ctx) { try { await this.ctx.close(); } catch {} }
    const ctx = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule('js/pcm-worklet.js');
    await ctx.audioWorklet.addModule('js/analysis-worklet.js');
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.45;
    this.mute = ctx.createGain();
    this.mute.gain.value = 0; // we only analyse; Spotify itself plays through the speakers
    this.analyser.connect(this.mute).connect(ctx.destination);
    // onset tap: every source is routed source -> onsetTap -> analyser
    this.onsetTap = new AudioWorkletNode(ctx, 'onset-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    this.onsetTap.port.onmessage = (e) => { this.lastHopAt = performance.now(); this.onAnalysis?.(e.data); };
    this.onsetTap.connect(this.analyser);
    this.feeder = new AudioWorkletNode(ctx, 'pcm-feeder', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.currentSource = null;
    if (this.sourceKind === 'server') this.useServer();
    else if (this.currentStream) this._attachStream(this.currentStream);
    if (ctx.state !== 'running') await ctx.resume();
  }

  _detach() {
    if (this.currentSource) { try { this.currentSource.disconnect(); } catch {} }
    this.currentSource = null;
  }
  _stopStream() {
    if (this.currentStream) { for (const t of this.currentStream.getTracks()) t.stop(); }
    this.currentStream = null;
  }
  _attachStream(stream) {
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.onsetTap);
    this.currentSource = src;
  }

  useServer() {
    this._detach(); this._stopStream();
    this.sourceKind = 'server';
    this.feeder.port.postMessage({ type: 'reset' });
    this.feeder.connect(this.onsetTap);
    this.currentSource = this.feeder;
    this.onStatus?.();
  }

  async useDevice(deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this._detach(); this._stopStream();
    this.sourceKind = 'device';
    this.currentStream = stream;
    this._attachStream(stream);
    this.onStatus?.();
  }

  async useScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (!stream.getAudioTracks().length) { for (const t of stream.getTracks()) t.stop(); throw new Error('No audio track shared — tick "Share audio" in the picker.'); }
    for (const t of stream.getVideoTracks()) t.stop();
    this._detach(); this._stopStream();
    this.sourceKind = 'screen';
    this.currentStream = stream;
    this._attachStream(stream);
    stream.getAudioTracks()[0].onended = () => { if (this.sourceKind === 'screen') this.useServer(); };
    this.onStatus?.();
  }

  async listInputDevices() {
    try { await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())); } catch {}
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter(d => d.kind === 'audioinput');
  }

  connectWS() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => { this.wsOpen = true; this.onStatus?.(); };
    ws.onclose = () => { this.wsOpen = false; this.onStatus?.(); setTimeout(() => this.connectWS(), 2000); };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'audio-format') {
          this.fmt = { sampleRate: m.sampleRate, channels: m.channels };
          if (this.ctx && this.ctx.sampleRate !== m.sampleRate) this.ensureContext(m.sampleRate);
        } else if (m.type === 'tap') {
          this.tapState = m.state; this.onStatus?.();
        } else if (m.type === 'track') {
          this.track = m; this.onTrack?.(m);
        }
        return;
      }
      this.bytesIn += e.data.byteLength;
      this.lastBytesAt = performance.now();
      if (this.sourceKind === 'server' && this.feeder && this.ctx?.state === 'running') {
        const f32 = new Float32Array(e.data);
        this.feeder.port.postMessage(f32, [e.data]);
      }
    };
  }

  /** audio-clock time in seconds (what the onset tap timestamps are measured against) */
  now() { return this.ctx ? this.ctx.currentTime : performance.now() / 1000; }
  /** how far the analysed audio is behind what the speakers play, in seconds (source dependent) */
  baseLatency() { return this.sourceKind === 'server' ? 0.075 : 0.035; }

  analyse() {
    const f = this.features;
    if (!this.analyser) return f;
    const a = this.analyser;
    a.getByteFrequencyData(this.spectrum);
    a.getFloatTimeDomainData(this.wave);
    const binHz = this.ctx.sampleRate / a.fftSize;
    for (const k in BANDS) {
      const [lo, hi] = BANDS[k];
      const b0 = Math.max(1, Math.floor(lo / binHz));
      const b1 = Math.min(this.spectrum.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = b0; i <= b1; i++) s += this.spectrum[i];
      f[k] = s / ((b1 - b0 + 1) * 255);
    }
    let sum = 0, peak = 0;
    const w = this.wave;
    for (let i = 0; i < w.length; i++) { const v = w[i]; sum += v * v; const av = v < 0 ? -v : v; if (av > peak) peak = av; }
    f.rms = Math.sqrt(sum / w.length);
    f.peak = peak;
    return f;
  }
}
