// phaserEngine.js — Classic 6-Stage Allpass Phaser
//
// DSP reference: Miss Parker phaser (Axoloti hardware, Phaser_6st_evo.asm)
// AgALag phaser (Axoloti hardware, Phaser.axp)
//
// Architecture: 6 first-order allpass filters in series (dependent stages)
// All stages share the same LFO-swept coefficient.
//
// Allpass coefficient (from PhaserCoeffCalc in assembly):
//   x = fc / sr  (normalized frequency, range ~0.02–0.1)
//   c = (1 - x) / (1 + x)
//
// Allpass filter (from assembly):
//   y = -c * input + zm1
//   zm1 = c * y + input
//
// Feedback: signal from end of 6-stage chain fed back to input (0–90%)
// Stereo: two independent chains with phase-offset LFOs
//
// Controls:
//   RATE      — LFO speed (0.03 Hz → 10 Hz, exponential)
//   DEPTH     — LFO modulation amount (0 = static, 1 = full sweep)
//   FEEDBACK  — resonance feedback (0 → 90%) — narrows / peaks the notches
//   MIX       — dry/wet (50% = classic notch+peak cancellation pattern)
//   FREQ      — base sweep frequency (100 Hz → 4000 Hz, logarithmic)
//   SPREAD    — sweep width ratio fMax/fMin (2x → 15x, quadratic)
//   PHASE     — L/R stereo LFO phase offset (0 = mono, 0.5 = 90°, 1 = 180°)
//   MODE      — 0 = linear Hz sweep, 1 = exponential (octave) sweep

const PROCESSOR_VERSION = 'v1';

const PROCESSOR_CODE = `
class PhaserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate',     defaultValue: 0.30, minValue: 0, maxValue: 1 },
      { name: 'depth',    defaultValue: 0.70, minValue: 0, maxValue: 1 },
      { name: 'feedback', defaultValue: 0.55, minValue: 0, maxValue: 1 },
      { name: 'mix',      defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'freq',     defaultValue: 0.35, minValue: 0, maxValue: 1 },
      { name: 'spread',   defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'phase',    defaultValue: 0.25, minValue: 0, maxValue: 1 },
      { name: 'mode',     defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'stages',   defaultValue: 6,    minValue: 2, maxValue: 8 },
      { name: 'bypass',   defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // 6 allpass stages per channel — z^-1 state for each
    this.zmL = new Float64Array(8); // max 8 stages
    this.zmR = new Float64Array(8);

    // Feedback state
    this.fbL = 0.0;
    this.fbR = 0.0;

    // LFO phase [0..1)
    this.lfoPhase = 0.0;

    // Metering
    this._peak = 0.0;
    this._msgTimer = 0;

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

    const rate     = params.rate[0];
    const depth    = params.depth[0];
    const feedback = params.feedback[0];
    const mix      = params.mix[0];
    const freq     = params.freq[0];
    const spread   = params.spread[0];
    const phase    = params.phase[0];
    const mode     = params.mode[0] > 0.5 ? 1 : 0;
    const stages   = Math.round(Math.max(2, Math.min(8, params.stages[0])));
    const bypass   = params.bypass[0] > 0.5;
    const sr       = this.sr;

    if (bypass) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
      }
      this.fbL = 0.0; this.fbR = 0.0;
      return true;
    }

    // ── Parameter mapping (bootstrapped for full range leverage) ────────────

    // RATE: exponential 0.03 Hz → 10 Hz (333× range)
    const rateHz = 0.03 * Math.pow(333.0, rate);
    const lfoInc = rateHz / sr;

    // FREQ: logarithmic 100 Hz → 4000 Hz
    const fMin = 100.0 * Math.pow(40.0, freq);

    // SPREAD: fMax/fMin ratio, quadratic for wider range at high settings
    //   spread=0 → 2.0×   spread=0.5 → 5.25×   spread=1 → 15×
    const fRatio = 2.0 + spread * spread * 13.0;
    const fMax   = fMin * fRatio;

    // FEEDBACK: power curve so resonance spreads across full knob range
    // Linear 0→90% bunches all drama into the top 30%.
    // pow(0.5) bootstraps it: 50% knob → 64% feedback, 70% knob → 79% feedback
    // Result: interesting resonant peaks are audible from 30% knob upward
    const fbAmt = Math.pow(feedback, 0.5) * 0.90;

    // PHASE: L/R stereo offset — 0..1 maps to 0..180° (0..0.5 in LFO units)
    const stereoOff = phase * 0.5;

    const TWO_PI = 6.283185307179586;
    let peakAcc = 0.0;

    for (let n = 0; n < iL.length; n++) {
      // ── LFO ──────────────────────────────────────────────────────────────
      const lfoL = Math.sin(TWO_PI * this.lfoPhase);
      const phaseR = this.lfoPhase + stereoOff;
      const lfoR = Math.sin(TWO_PI * (phaseR - Math.floor(phaseR)));

      // Map LFO [-1,+1] → sweep position [0,1] scaled by depth
      const posL = 0.5 + lfoL * 0.5 * depth;
      const posR = 0.5 + lfoR * 0.5 * depth;

      // ── LFO → allpass frequency ──────────────────────────────────────────
      let fcL, fcR;
      if (mode === 0) {
        // Linear Hz sweep
        fcL = fMin + posL * (fMax - fMin);
        fcR = fMin + posR * (fMax - fMin);
      } else {
        // Exponential (octave-linear) sweep — more musical
        fcL = fMin * Math.pow(fRatio, posL);
        fcR = fMin * Math.pow(fRatio, posR);
      }

      // ── Axoloti PhaserCoeffCalc: c = (1 - x) / (1 + x), x = fc/sr ───────
      const xL = fcL / sr;
      const xR = fcR / sr;
      const cL = (1.0 - xL) / (1.0 + xL);
      const cR = (1.0 - xR) / (1.0 + xR);

      // ── Input + feedback injection ────────────────────────────────────────
      let sigL = iL[n] + this.fbL * fbAmt;
      let sigR = iR[n] + this.fbR * fbAmt;

      // ── N-stage dependent allpass chain ───────────────────────────────────
      // Direct from Axoloti assembly: y = -c*in + zm1; zm1 = c*y + in
      for (let s = 0; s < stages; s++) {
        const yL = -cL * sigL + this.zmL[s];
        this.zmL[s] = cL * yL + sigL;
        sigL = yL;

        const yR = -cR * sigR + this.zmR[s];
        this.zmR[s] = cR * yR + sigR;
        sigR = yR;
      }

      // ── Safety clip to prevent runaway at extreme feedback ────────────────
      if (sigL > 2.0) sigL = 2.0; else if (sigL < -2.0) sigL = -2.0;
      if (sigR > 2.0) sigR = 2.0; else if (sigR < -2.0) sigR = -2.0;

      // ── Feedback capture ──────────────────────────────────────────────────
      this.fbL = sigL;
      this.fbR = sigR;

      // ── Dry/wet mix — 50% is the classic phaser sweet spot ────────────────
      const outL = iL[n] * (1.0 - mix) + sigL * mix;
      const outR = iR[n] * (1.0 - mix) + sigR * mix;

      oL[n] = outL;
      oR[n] = outR;

      // Peak detection
      const pk = outL > 0 ? outL : -outL;
      const pkR = outR > 0 ? outR : -outR;
      const pkMax = pk > pkR ? pk : pkR;
      if (pkMax > peakAcc) peakAcc = pkMax;

      // ── Advance LFO ───────────────────────────────────────────────────────
      this.lfoPhase += lfoInc;
      if (this.lfoPhase >= 1.0) this.lfoPhase -= 1.0;
    }

    this._peak = peakAcc;
    this._msgTimer++;
    if (this._msgTimer >= 12) {
      this._msgTimer = 0;
      this.port.postMessage({ peak: this._peak, lfoPhase: this.lfoPhase });
    }

    return true;
  }
}

registerProcessor('phaser-processor-${PROCESSOR_VERSION}', PhaserProcessor);
`;

export async function createPhaserEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();
  const inputTrim   = audioCtx.createGain();
  const outputTrim  = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, `phaser-processor-${PROCESSOR_VERSION}`, {
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
  let _lfoPhase = 0;

  worklet.port.onmessage = e => {
    if (e.data?.peak     !== undefined) _peak     = e.data.peak;
    if (e.data?.lfoPhase !== undefined) _lfoPhase = e.data.lfoPhase;
  };

  const _buf  = new Float32Array(2048);
  const DECAY = 0.94;
  let _peakIn  = 0;
  let _peakOut = 0;

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

  return {
    input, output, chainOutput,

    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setRate:     v => { p('rate').value     = v; },
    setDepth:    v => { p('depth').value    = v; },
    setFeedback: v => { p('feedback').value = v; },
    setMix:      v => { p('mix').value      = v; },
    setFreq:     v => { p('freq').value     = v; },
    setSpread:   v => { p('spread').value   = v; },
    setPhase:    v => { p('phase').value    = v; },
    setMode:     v => { p('mode').value     = v; },
    setStages:   v => { p('stages').value   = v; },
    setBypass:   v => { p('bypass').value   = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getLfoPhase:    () => _lfoPhase,

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
