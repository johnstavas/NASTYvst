// flangerEngine.js — Dual Vintage Flanger (MXR + Roland SBF-325 Inspired)
//
// Two distinct flanger engines:
//   MX  — aggressive analog pedal (MXR-style)
//   SBF — clean stereo rack (Roland SBF-325-style)
//
// Controls:
//   ENGINE  — 0=MX, 1=SBF
//   MODE    — MX: 0=CLASSIC, 1=WIDE, 2=TZ | SBF: 0=FL1, 1=FL2, 2=FL3, 3=CHO
//   MANUAL  — base delay time (sweep center)
//   RATE    — LFO speed
//   DEPTH   — LFO modulation amount
//   REGEN   — feedback amount (with saturation)
//   MIX     — dry/wet
//   WIDTH   — stereo spread
//   COLOR   — feedback tone (LP/HP tilt)
//   DRIVE   — input saturation

const PROCESSOR_VERSION = 'v3';

const PROCESSOR_CODE = `
class FlangerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'engine',  defaultValue: 0,    minValue: 0,   maxValue: 1 },
      { name: 'mode',    defaultValue: 0,    minValue: 0,   maxValue: 3 },
      { name: 'manual',  defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'rate',    defaultValue: 0.3,  minValue: 0,   maxValue: 1 },
      { name: 'depth',   defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'regen',   defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'mix',     defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'width',   defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'color',   defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'drive',   defaultValue: 0,    minValue: 0,   maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,    minValue: 0,   maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Delay buffer — 25ms max to cover CHO sweep at extreme depth+manual
    this.maxDelaySamples = Math.ceil(this.sr * 0.025);
    this.bufL = new Float32Array(this.maxDelaySamples + 4); // +4 for Hermite
    this.bufR = new Float32Array(this.maxDelaySamples + 4);
    this.writePos = 0;

    // LFO phase (0..1)
    this.lfoPhase = 0;

    // Feedback state
    this.fbL = 0;
    this.fbR = 0;

    // Color filter state (one-pole LP/HP tilt in feedback path)
    this.colorLpL = 0;
    this.colorLpR = 0;

    // Tone filter on output
    this.outLpL = 0;
    this.outLpR = 0;

    // Metering
    this._peakOut = 0;

    this.port.postMessage({ ready: true });
  }

  // Hermite (cubic) interpolation for smooth, artifact-free sweep
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

  // LFO shapes
  // MX: softened triangle (rounded peaks for vintage analog feel)
  mxLfo(phase, mode) {
    // Basic triangle
    let tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    // Soften the peaks — cubic soft clip
    tri = 1.5 * tri - 0.5 * tri * tri * tri;
    // TZ mode: bipolar with zero-crossing emphasis
    if (mode === 2) {
      // Push triangle through zero more aggressively
      tri = Math.sin(tri * Math.PI * 0.5);
    }
    return tri; // -1..+1
  }

  // SBF: clean sine (Roland precision)
  sbfLfo(phase, mode) {
    // Pure sine for all SBF modes
    let val = Math.sin(2 * Math.PI * phase);
    // CHO mode (3): slower, shallower, more subtle — handled by param mapping
    return val; // -1..+1
  }

  // Soft saturation for feedback path (MX character)
  softSat(x) {
    // Asymmetric tanh — adds even harmonics
    return Math.tanh(x * 1.2);
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const engine = params.engine[0] > 0.5 ? 1 : 0; // 0=MX, 1=SBF
    const mode   = Math.round(params.mode[0]);
    const manual = params.manual[0];
    const rate   = params.rate[0];
    const depth  = params.depth[0];
    const regen  = params.regen[0];
    const mix    = params.mix[0];
    const width  = params.width[0];
    const color  = params.color[0];
    const drive  = params.drive[0];
    const bypass = params.bypass[0] > 0.5;

    const sr = this.sr;
    const bs = this.maxDelaySamples;

    // ── Rate mapping ──────────────────────────────────────────────────────
    // MX: 0.05 Hz to 5 Hz (pedal range)
    // SBF: 0.03 Hz to 10 Hz (rack range, wider for FL3/CHO shimmer)
    let rateHz;
    if (engine === 0) {
      rateHz = 0.05 * Math.pow(100, rate); // 0.05..5 Hz
    } else {
      rateHz = 0.03 * Math.pow(333, rate); // 0.03..10 Hz
      if (mode === 3) rateHz *= 0.5; // CHO: halve rate for subtlety
    }

    // ── Delay time mapping ────────────────────────────────────────────────
    // MX: 0.5ms to 10ms (tight jet)
    // SBF: 0.3ms to 12ms (wider sweep, more lush)
    // TZ: 0.1ms to 8ms (crosses zero for through-zero nulling)
    let minDelayMs, maxDelayMs;
    if (engine === 0) {
      if (mode === 2) { // TZ
        minDelayMs = 0.1;
        maxDelayMs = 8;
      } else if (mode === 1) { // WIDE
        minDelayMs = 0.3;
        maxDelayMs = 12;
      } else { // CLASSIC
        minDelayMs = 0.5;
        maxDelayMs = 10;
      }
    } else {
      if (mode === 3) { // CHO
        minDelayMs = 1;
        maxDelayMs = 15;
      } else { // FL1, FL2, FL3
        minDelayMs = 0.3;
        maxDelayMs = 12;
      }
    }

    // MANUAL controls the center point of the sweep
    const centerMs = minDelayMs + manual * (maxDelayMs - minDelayMs);
    const sweepMs  = depth * (maxDelayMs - minDelayMs) * 0.5;

    // ── Regen mapping ─────────────────────────────────────────────────────
    // MX: up to 95% feedback (jet territory) with saturation
    // SBF: up to 85% feedback (clean, musical)
    const maxFb = engine === 0 ? 0.95 : 0.85;
    // Negative feedback for some modes
    let fbAmount = regen * maxFb;
    if (engine === 0 && mode === 2) {
      // TZ: regen goes negative at high settings for through-zero null
      fbAmount = regen < 0.5 ? regen * 2 * maxFb : -(regen * 2 - 1) * maxFb;
    }
    if (engine === 1 && mode === 1) {
      // FL2: inverted feedback for different character
      fbAmount = -fbAmount;
    }

    // ── Stereo phase offset ───────────────────────────────────────────────
    // WIDTH controls L/R LFO phase separation
    // MX CLASSIC: mono (width has no effect)
    // MX WIDE/TZ: 0..180 degrees
    // SBF: 0..180 degrees (FL3 fixed at 120 degrees for cross-mix)
    let stereoOffset;
    if (engine === 0 && mode === 0) {
      stereoOffset = 0; // CLASSIC is mono
    } else if (engine === 1 && mode === 2) {
      stereoOffset = 0.333; // FL3: fixed 120 degrees
    } else {
      stereoOffset = width * 0.5; // 0..180 degrees in phase units
    }

    // ── Color: feedback path filter ───────────────────────────────────────
    // 0 = dark (heavy LP), 0.5 = neutral, 1 = bright (HP emphasis)
    // Maps to a one-pole LP cutoff: 400 Hz (dark) to 16 kHz (bright)
    const colorFreq = 400 * Math.pow(40, color);
    const colorCoef = Math.exp(-2 * Math.PI * colorFreq / sr);

    // ── Drive: input saturation ───────────────────────────────────────────
    const driveGain = 1 + drive * 6; // 1x to 7x
    const driveActive = drive > 0.01;

    // ── Output LP to tame aliasing — only when regen or drive are active ──
    const needsOutLp = regen > 0.3 || drive > 0.1;
    const outLpFreq = 18000;
    const outLpCoef = needsOutLp ? Math.exp(-2 * Math.PI * outLpFreq / sr) : 0;

    const lfoInc = rateHz / sr;
    let peakAccum = 0;

    // ── True passthrough: mix=0 or bypass — zero processing, zero coloring ──
    const isPassthrough = mix < 0.001 || bypass;
    if (isPassthrough) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n] || iL[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      // Reset DSP state so no stale artifacts when re-engaging
      this.fbL = 0; this.fbR = 0;
      this.colorLpL = 0; this.colorLpR = 0;
      this.outLpL = 0; this.outLpR = 0;
      this.bufL.fill(0); this.bufR.fill(0);
      // Keep LFO running so it doesn't jump when re-engaging
      this.lfoPhase += lfoInc * iL.length;
      while (this.lfoPhase >= 1) this.lfoPhase -= 1;

      this._peakOut = peakAccum;
      this.port.postMessage({ peak: this._peakOut });
      return true;
    }

    for (let n = 0; n < iL.length; n++) {
      let dryL = iL[n];
      let dryR = iR[n];

      // Drive
      let inL = dryL, inR = dryR;
      if (driveActive) {
        inL = Math.tanh(dryL * driveGain) / Math.tanh(driveGain);
        inR = Math.tanh(dryR * driveGain) / Math.tanh(driveGain);
      }

      // ── LFO ─────────────────────────────────────────────────────────
      let lfoL, lfoR;
      if (engine === 0) {
        lfoL = this.mxLfo(this.lfoPhase, mode);
        lfoR = this.mxLfo((this.lfoPhase + stereoOffset) % 1, mode);
      } else {
        lfoL = this.sbfLfo(this.lfoPhase, mode);
        lfoR = this.sbfLfo((this.lfoPhase + stereoOffset) % 1, mode);
      }

      // ── Delay times in samples ──────────────────────────────────────
      const delayMsL = Math.max(0.05, centerMs + lfoL * sweepMs);
      const delayMsR = Math.max(0.05, centerMs + lfoR * sweepMs);
      const delaySampL = Math.min(delayMsL * sr / 1000, bs - 2);
      const delaySampR = Math.min(delayMsR * sr / 1000, bs - 2);

      // ── Write to delay buffer (input + feedback) ────────────────────
      // Color filter on feedback
      this.colorLpL = colorCoef * this.colorLpL + (1 - colorCoef) * this.fbL;
      this.colorLpR = colorCoef * this.colorLpR + (1 - colorCoef) * this.fbR;

      // Blend based on color: <0.5 = more LP (dark), >0.5 = more original (bright)
      const filtFbL = color < 0.5
        ? this.colorLpL
        : this.fbL + (this.fbL - this.colorLpL) * (color - 0.5) * 2;
      const filtFbR = color < 0.5
        ? this.colorLpR
        : this.fbR + (this.fbR - this.colorLpR) * (color - 0.5) * 2;

      // Saturate feedback in MX engine
      let satFbL = filtFbL, satFbR = filtFbR;
      if (engine === 0) {
        satFbL = this.softSat(filtFbL);
        satFbR = this.softSat(filtFbR);
      }

      this.bufL[this.writePos] = inL + satFbL * fbAmount;
      this.bufR[this.writePos] = inR + satFbR * fbAmount;

      // ── Read from delay buffer with Hermite interpolation ───────────
      const readPosL = this.writePos - delaySampL;
      const readPosR = this.writePos - delaySampR;
      const wetL = this.hermite(this.bufL, readPosL, bs);
      const wetR = this.hermite(this.bufR, readPosR, bs);

      // Store feedback for next sample
      this.fbL = wetL;
      this.fbR = wetR;

      // ── Stereo matrix ───────────────────────────────────────────────
      let outWetL = wetL, outWetR = wetR;

      // FL3: crossfeed stereo (120-degree phase + cross-mix)
      if (engine === 1 && mode === 2) {
        const crossMix = 0.3; // 30% crossfeed
        outWetL = wetL * (1 - crossMix) + wetR * crossMix;
        outWetR = wetR * (1 - crossMix) + wetL * crossMix;
      }

      // Width expansion for non-mono modes
      if (stereoOffset > 0.001) {
        const mid  = (outWetL + outWetR) * 0.5;
        const side = (outWetL - outWetR) * 0.5;
        const w = 0.5 + width * 0.5; // 0.5..1.0 side boost
        outWetL = mid + side * w * 2;
        outWetR = mid - side * w * 2;
      }

      // ── Output LP — skip when not needed for transparency ──────────
      if (needsOutLp) {
        this.outLpL = outLpCoef * this.outLpL + (1 - outLpCoef) * outWetL;
        this.outLpR = outLpCoef * this.outLpR + (1 - outLpCoef) * outWetR;
        outWetL = this.outLpL;
        outWetR = this.outLpR;
      }

      // ── Mix ─────────────────────────────────────────────────────────
      const finalL = dryL * (1 - mix) + outWetL * mix;
      const finalR = dryR * (1 - mix) + outWetR * mix;

      oL[n] = finalL;
      oR[n] = finalR;

      const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
      if (ap > peakAccum) peakAccum = ap;

      // Advance LFO
      this.lfoPhase += lfoInc;
      if (this.lfoPhase >= 1) this.lfoPhase -= 1;

      // Advance write head
      this.writePos = (this.writePos + 1) % bs;
    }

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: this._peakOut });

    return true;
  }
}

registerProcessor('flanger-processor-${PROCESSOR_VERSION}', FlangerProcessor);
`;

export async function createFlangerEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const inputTrim  = audioCtx.createGain();
  const outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, `flanger-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  // Chain: input → inputTrim → analyserIn → worklet → analyserOut → outputTrim → output/chainOutput
  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
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
    setEngine:  v => { p('engine').value  = v; },
    setMode:    v => { p('mode').value    = v; },
    setManual:  v => { p('manual').value  = v; },
    setRate:    v => { p('rate').value    = v; },
    setDepth:   v => { p('depth').value   = v; },
    setRegen:   v => { p('regen').value   = v; },
    setMix:     v => { p('mix').value     = v; },
    setWidth:   v => { p('width').value   = v; },
    setColor:   v => { p('color').value   = v; },
    setDrive:   v => { p('drive').value   = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,

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
