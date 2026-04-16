// smootherEngine.js — SMOOTHER: Kill harshness without killing life.
//
// Anti-harshness processor that tames 2-6kHz brittleness
// while preserving air and detail.
//
// Controls:
//   SMOOTH  — main smoothing amount (dynamic EQ depth)
//   FOCUS   — center frequency of smoothing band (2-6kHz mapped)
//   WIDTH   — bandwidth of smoothing notch
//   AIR     — high shelf restoration above smoothing band
//   BODY    — low-end preservation amount
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'smoother-v1';

const PROCESSOR_CODE = `
class SmootherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'smooth', defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'focus',  defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'width',  defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'air',    defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'body',   defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 1,   minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Bandpass filter state for harshness detection ──
    // One-pole bandpass (pair of HP + LP)
    this.bpLpL = 0; this.bpLpR = 0;  // LP component
    this.bpHpL = 0; this.bpHpR = 0;  // HP component (stored as prev)

    // ── Dynamic EQ: notch/dip filter state ──
    // Implemented as a parametric bell using biquad coefficients
    this.x1L = 0; this.x2L = 0; this.y1L = 0; this.y2L = 0;
    this.x1R = 0; this.x2R = 0; this.y1R = 0; this.y2R = 0;

    // ── Air shelf state (HP shelf) ──
    this.airHpL = 0; this.airHpR = 0;

    // ── Body preservation state (LP shelf) ──
    this.bodyLpL = 0; this.bodyLpR = 0;

    // ── Harshness envelope follower ──
    this.harshEnv = 0;

    // ── Metering ──
    this._peakOut = 0;
    this._harshLevel = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const smooth = params.smooth[0];
    const focus  = params.focus[0];
    const width  = params.width[0];
    const air    = params.air[0];
    const body   = params.body[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr     = this.sr;

    let peakAccum = 0;

    // ── True passthrough ──
    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      // Reset state
      this.bpLpL = 0; this.bpLpR = 0; this.bpHpL = 0; this.bpHpR = 0;
      this.x1L = 0; this.x2L = 0; this.y1L = 0; this.y2L = 0;
      this.x1R = 0; this.x2R = 0; this.y1R = 0; this.y2R = 0;
      this.airHpL = 0; this.airHpR = 0;
      this.bodyLpL = 0; this.bodyLpR = 0;
      this.harshEnv = 0;
      this._peakOut = peakAccum;
      this.port.postMessage({ peak: peakAccum, harshLevel: 0 });
      return true;
    }

    // ── Map focus (0-1) to frequency (2000-6000 Hz) ──
    const focusFreq = 2000 + focus * 4000;

    // ── Bandpass coefficients for harshness detection ──
    // One-pole LP at focusFreq * (1 + width), HP at focusFreq / (1 + width)
    const bpWidth = 1 + width * 2; // Q-ish: wider = broader detection
    const bpLpFreq = Math.min(focusFreq * bpWidth, sr * 0.45);
    const bpHpFreq = Math.max(focusFreq / bpWidth, 20);
    const bpLpCoef = Math.exp(-2 * Math.PI * bpLpFreq / sr);
    const bpHpCoef = Math.exp(-2 * Math.PI * bpHpFreq / sr);

    // ── Dynamic EQ: biquad peaking (bell) filter ──
    // Negative gain proportional to smooth * harshness
    const omega = 2 * Math.PI * focusFreq / sr;
    const sinW = Math.sin(omega);
    const cosW = Math.cos(omega);
    // Q from width: narrow width = high Q (surgical), wide width = low Q (broad)
    const Q = 0.5 + (1 - width) * 4; // 0.5 to 4.5

    // Envelope follower coefficients
    const atkCoef = Math.exp(-1 / (sr * 0.002));  // 2ms attack
    const relCoef = Math.exp(-1 / (sr * 0.08));    // 80ms release — smoother behavior

    // ── Air shelf: HP above focus band ──
    const airFreq = Math.min(focusFreq * 1.5, sr * 0.45);
    const airCoef = Math.exp(-2 * Math.PI * airFreq / sr);

    // ── Body shelf: LP to preserve lows ──
    const bodyFreq = 200 + (1 - body) * 600; // 200-800Hz
    const bodyCoef = Math.exp(-2 * Math.PI * bodyFreq / sr);

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      let outL = dryL;
      let outR = dryR;

      // ── Step 1: Detect harshness via bandpass energy ──
      // LP stage
      this.bpLpL = bpLpCoef * this.bpLpL + (1 - bpLpCoef) * dryL;
      this.bpLpR = bpLpCoef * this.bpLpR + (1 - bpLpCoef) * dryR;
      // HP stage (subtract LP of LP to get bandpass)
      const bpOutL = this.bpLpL - this.bpHpL;
      const bpOutR = this.bpLpR - this.bpHpR;
      this.bpHpL = bpHpCoef * this.bpHpL + (1 - bpHpCoef) * this.bpLpL;
      this.bpHpR = bpHpCoef * this.bpHpR + (1 - bpHpCoef) * this.bpLpR;

      // Envelope follower on bandpass energy
      const bpEnergy = Math.max(Math.abs(bpOutL), Math.abs(bpOutR));
      if (bpEnergy > this.harshEnv) {
        this.harshEnv = atkCoef * this.harshEnv + (1 - atkCoef) * bpEnergy;
      } else {
        this.harshEnv = relCoef * this.harshEnv + (1 - relCoef) * bpEnergy;
      }

      // ── Step 2: Dynamic EQ — reduce focus band ──
      // Gain reduction proportional to smooth amount x detected harshness
      // More harshness detected = more reduction
      const harshFactor = Math.min(this.harshEnv * 30, 1); // normalize — increased sensitivity
      const cutDb = -smooth * (6 + harshFactor * 18); // -6 to -24 dB dynamic — more aggressive
      const A = Math.pow(10, cutDb / 40);
      const alpha = sinW / (2 * Q);

      // Biquad peaking EQ coefficients
      const b0 = 1 + alpha * A;
      const b1 = -2 * cosW;
      const b2 = 1 - alpha * A;
      const a0 = 1 + alpha / A;
      const a1 = -2 * cosW;
      const a2 = 1 - alpha / A;

      // Normalize
      const nb0 = b0 / a0;
      const nb1 = b1 / a0;
      const nb2 = b2 / a0;
      const na1 = a1 / a0;
      const na2 = a2 / a0;

      // Apply biquad to L
      const yL = nb0 * outL + nb1 * this.x1L + nb2 * this.x2L - na1 * this.y1L - na2 * this.y2L;
      this.x2L = this.x1L; this.x1L = outL;
      this.y2L = this.y1L; this.y1L = yL;
      outL = yL;

      // Apply biquad to R
      const yR = nb0 * outR + nb1 * this.x1R + nb2 * this.x2R - na1 * this.y1R - na2 * this.y2R;
      this.x2R = this.x1R; this.x1R = outR;
      this.y2R = this.y1R; this.y1R = yR;
      outR = yR;

      // ── Step 3: Restore air above smoothing band ──
      if (air > 0.01) {
        this.airHpL = airCoef * this.airHpL + (1 - airCoef) * outL;
        this.airHpR = airCoef * this.airHpR + (1 - airCoef) * outR;
        const airL = outL - this.airHpL; // HP content
        const airR = outR - this.airHpR;
        outL += airL * air * 3;
        outR += airR * air * 3;
      }

      // ── Step 4: Preserve body (boost LP content) ──
      if (body > 0.01) {
        this.bodyLpL = bodyCoef * this.bodyLpL + (1 - bodyCoef) * outL;
        this.bodyLpR = bodyCoef * this.bodyLpR + (1 - bodyCoef) * outR;
        outL += this.bodyLpL * body * 0.6;
        outR += this.bodyLpR * body * 0.6;
      }

      // ── Mix ──
      oL[n] = dryL * (1 - mix) + outL * mix;
      oR[n] = dryR * (1 - mix) + outR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peakOut = peakAccum;
    this._harshLevel = this.harshEnv;
    this.port.postMessage({ peak: peakAccum, harshLevel: this.harshEnv });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', SmootherProcessor);
`;

export async function createSmootherEngine(audioCtx) {
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

  let _peak = 0, _harshLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.harshLevel !== undefined) _harshLevel = e.data.harshLevel;
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
    setSmooth: v => { p('smooth').value = v; },
    setFocus:  v => { p('focus').value  = v; },
    setWidth:  v => { p('width').value  = v; },
    setAir:    v => { p('air').value    = v; },
    setBody:   v => { p('body').value   = v; },
    setMix:    v => { p('mix').value    = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getHarshLevel:  () => _harshLevel,

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
