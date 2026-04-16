// reactorEngine.js — REACTOR: Modulation That Listens to Your Audio
//
// The input signal drives the modulation engine.
// Envelope, transients, and spectral balance modulate parameters.
//
// Controls:
//   REACT   — how much input drives modulation
//   SPEED   — base modulation rate
//   DEPTH   — modulation depth
//   SHAPE   — mod waveform (sine -> triangle -> random)
//   FILTER  — post-mod LP filter frequency
//   STEREO  — stereo separation
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'reactor-v1';

const PROCESSOR_CODE = `
class ReactorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'react',   defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'speed',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'depth',   defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'shape',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'filter',  defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'stereo',  defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Delay buffer for chorus-like pitch shift (15ms max)
    this.maxDelay = Math.ceil(this.sr * 0.015);
    this.bufL = new Float32Array(this.maxDelay + 4);
    this.bufR = new Float32Array(this.maxDelay + 4);
    this.writePos = 0;

    // LFO phase (0..1)
    this.lfoPhase = 0;

    // Envelope follower state
    this.envLevel = 0;

    // Transient detection
    this.prevEnv = 0;
    this.transientBurst = 0;

    // Smoothed react level for metering
    this.reactLevel = 0;

    // Random LFO state (sample-and-hold with interpolation)
    this.randCurrent = 0;
    this.randTarget = 0;
    this.randPhase = 0;

    // Post-mod LP filter state
    this.lpL = 0;
    this.lpR = 0;

    // Output peak metering
    this._peakOut = 0;

    this.port.postMessage({ ready: true });
  }

  // Hermite interpolation for smooth delay read
  hermite(buf, pos, size) {
    let p = pos;
    while (p < 0) p += size;
    const i = Math.floor(p) % size;
    const f = p - Math.floor(p);

    const xm1 = buf[(i - 1 + size) % size];
    const x0  = buf[i];
    const x1  = buf[(i + 1) % size];
    const x2  = buf[(i + 2) % size];

    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);

    return ((c3 * f + c2) * f + c1) * f + c0;
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const react  = params.react[0];
    const speed  = params.speed[0];
    const depth  = params.depth[0];
    const shape  = params.shape[0];
    const filter = params.filter[0];
    const stereo = params.stereo[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;

    const sr = this.sr;
    const bs = this.maxDelay;

    // ── Base LFO rate: 0.1 Hz to 12 Hz ──
    const baseRateHz = 0.1 * Math.pow(120, speed);

    // ── Filter coefficient: 200 Hz to 18 kHz ──
    const filterFreq = 200 * Math.pow(90, filter);
    const filterCoef = Math.exp(-2 * Math.PI * filterFreq / sr);

    // ── Envelope follower attack/release times ──
    const envAttack  = Math.exp(-1 / (sr * 0.003));  // 3ms attack
    const envRelease = Math.exp(-1 / (sr * 0.08));   // 80ms release

    // ── Transient burst decay ──
    const burstDecay = Math.exp(-1 / (sr * 0.05)); // 50ms burst decay

    let peakAccum = 0;

    // ── True passthrough ──
    const isPassthrough = mix < 0.001 || bypass;
    if (isPassthrough) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      // Reset state
      this.envLevel = 0;
      this.prevEnv = 0;
      this.transientBurst = 0;
      this.reactLevel = 0;
      this.lpL = 0; this.lpR = 0;
      this.bufL.fill(0); this.bufR.fill(0);
      this.randCurrent = 0; this.randTarget = 0;
      // Keep LFO running
      const lfoInc = baseRateHz / sr;
      this.lfoPhase += lfoInc * iL.length;
      while (this.lfoPhase >= 1) this.lfoPhase -= 1;

      this._peakOut = peakAccum;
      this.port.postMessage({ peak: this._peakOut, reactLevel: 0 });
      return true;
    }

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;
      const absMono = Math.abs(mono);

      // ── Envelope follower ──
      if (absMono > this.envLevel) {
        this.envLevel = envAttack * this.envLevel + (1 - envAttack) * absMono;
      } else {
        this.envLevel = envRelease * this.envLevel + (1 - envRelease) * absMono;
      }

      // ── Transient detection ──
      const envDelta = this.envLevel - this.prevEnv;
      if (envDelta > 0.01) {
        // Rising edge — transient burst proportional to slope
        const burstAmount = Math.min(envDelta * 15, 1);
        if (burstAmount > this.transientBurst) {
          this.transientBurst = burstAmount;
        }
      }
      this.transientBurst *= burstDecay;
      this.prevEnv = this.envLevel;

      // ── React amount: how much the envelope modulates ──
      const envMod = this.envLevel * react;

      // ── Modulated LFO rate ──
      const modRateHz = baseRateHz * (1 + envMod * 4);
      const lfoInc = modRateHz / sr;

      // ── LFO waveform based on shape ──
      // shape: 0 = sine, 0.5 = triangle, 1 = random
      let lfoVal;
      if (shape < 0.5) {
        // Sine to triangle blend
        const blend = shape * 2; // 0..1
        const sine = Math.sin(2 * Math.PI * this.lfoPhase);
        const tri = this.lfoPhase < 0.5 ? this.lfoPhase * 4 - 1 : 3 - this.lfoPhase * 4;
        lfoVal = sine * (1 - blend) + tri * blend;
      } else {
        // Triangle to random blend
        const blend = (shape - 0.5) * 2; // 0..1
        const tri = this.lfoPhase < 0.5 ? this.lfoPhase * 4 - 1 : 3 - this.lfoPhase * 4;

        // Random: sample-and-hold with linear interpolation
        this.randPhase += lfoInc;
        if (this.randPhase >= 1) {
          this.randPhase -= 1;
          this.randCurrent = this.randTarget;
          this.randTarget = Math.random() * 2 - 1;
        }
        const randLerp = this.randCurrent + (this.randTarget - this.randCurrent) * this.randPhase;
        lfoVal = tri * (1 - blend) + randLerp * blend;
      }

      // ── Modulated depth: base depth + envelope contribution + transient burst ──
      const modDepth = depth * (0.3 + envMod * 0.7) + this.transientBurst * react * 0.5;

      // ── Delay time modulation ──
      // Base delay: 3ms center, modulated by LFO * modDepth
      const centerMs = 3;
      const sweepMs = 5 * modDepth; // up to 5ms sweep
      const delayMsL = Math.max(0.1, centerMs + lfoVal * sweepMs);

      // Stereo decorrelation via phase offset
      const stereoOffset = stereo * 0.5; // 0..180 degrees
      const lfoPhaseR = (this.lfoPhase + stereoOffset) % 1;
      let lfoValR;
      if (shape < 0.5) {
        const blend = shape * 2;
        const sineR = Math.sin(2 * Math.PI * lfoPhaseR);
        const triR = lfoPhaseR < 0.5 ? lfoPhaseR * 4 - 1 : 3 - lfoPhaseR * 4;
        lfoValR = sineR * (1 - blend) + triR * blend;
      } else {
        const blend = (shape - 0.5) * 2;
        const triR = lfoPhaseR < 0.5 ? lfoPhaseR * 4 - 1 : 3 - lfoPhaseR * 4;
        // Use slightly offset random for R channel
        const randR = this.randCurrent * 0.7 + this.randTarget * 0.3;
        lfoValR = triR * (1 - blend) + randR * blend;
      }
      const delayMsR = Math.max(0.1, centerMs + lfoValR * sweepMs);

      const delaySampL = Math.min(delayMsL * sr / 1000, bs - 2);
      const delaySampR = Math.min(delayMsR * sr / 1000, bs - 2);

      // ── Write to delay buffer ──
      this.bufL[this.writePos] = dryL;
      this.bufR[this.writePos] = dryR;

      // ── Read with Hermite interpolation ──
      const readPosL = this.writePos - delaySampL;
      const readPosR = this.writePos - delaySampR;
      let wetL = this.hermite(this.bufL, readPosL, bs);
      let wetR = this.hermite(this.bufR, readPosR, bs);

      // ── Post-mod LP filter ──
      this.lpL = filterCoef * this.lpL + (1 - filterCoef) * wetL;
      this.lpR = filterCoef * this.lpR + (1 - filterCoef) * wetR;
      wetL = this.lpL;
      wetR = this.lpR;

      // ── Mix ──
      const finalL = dryL * (1 - mix) + wetL * mix;
      const finalR = dryR * (1 - mix) + wetR * mix;

      oL[n] = finalL;
      oR[n] = finalR;

      const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
      if (ap > peakAccum) peakAccum = ap;

      // ── Advance LFO ──
      this.lfoPhase += lfoInc;
      if (this.lfoPhase >= 1) this.lfoPhase -= 1;

      // ── Advance write head ──
      this.writePos = (this.writePos + 1) % bs;
    }

    // Smooth react level for metering
    this.reactLevel = this.reactLevel * 0.92 + this.envLevel * react * 0.08;

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: this._peakOut, reactLevel: this.reactLevel });

    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', ReactorProcessor);
`;

export async function createReactorEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const inputTrim  = audioCtx.createGain();
  const outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  // Chain: input -> inputTrim -> analyserIn -> worklet -> analyserOut -> outputTrim -> output/chainOutput
  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0;
  let _reactLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.reactLevel !== undefined) _reactLevel = e.data.reactLevel;
  };

  const _buf = new Float32Array(2048);

  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0;
    for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) {
      const a = Math.abs(_buf[i]); if (a > m) m = a;
    }
    return m;
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,

    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setReact:   v => { p('react').value   = v; },
    setSpeed:   v => { p('speed').value   = v; },
    setDepth:   v => { p('depth').value   = v; },
    setShape:   v => { p('shape').value   = v; },
    setFilter:  v => { p('filter').value  = v; },
    setStereo:  v => { p('stereo').value  = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getReactLevel:  () => _reactLevel,
    getAnalyserIn:  () => analyserIn,

    destroy() {
      worklet.disconnect();
      input.disconnect();
      inputTrim.disconnect();
      output.disconnect();
      outputTrim.disconnect();
      chainOutput.disconnect();
      analyserIn.disconnect();
      analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
