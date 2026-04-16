// deharshEngine.js — DEHARSHPROVOCAL: Dynamic harshness reshaper.
//
// Multi-band harshness detector (transient + sustained separately),
// dynamic band smoothing, sibilance region control (6-10kHz),
// harmonic detail recovery, air return layer.
//
// Controls:
//   SMOOTH    — main smoothing amount 0-100
//   FOCUS     — mode: 0=Low Bite, 1=Presence Edge, 2=Sizzle, 3=Broad Vocal
//   AIR RETURN — top-end openness restoration 0-100
//   SIBILANCE — sibilance reduction 0-100
//   MIX       — dry/wet 0-100%
//   OUTPUT    — output gain -18 to +18 dB
//   BYPASS

const PROCESSOR_VERSION = 'deharsh-v1';

const PROCESSOR_CODE = `
class DeHarshProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'smooth',    defaultValue: 0.40, minValue: 0, maxValue: 1 },
      { name: 'focusMode', defaultValue: 1,    minValue: 0, maxValue: 3 },
      { name: 'airReturn', defaultValue: 0.35, minValue: 0, maxValue: 1 },
      { name: 'sibilance', defaultValue: 0.40, minValue: 0, maxValue: 1 },
      { name: 'mix',       defaultValue: 1.0,  minValue: 0, maxValue: 1 },
      { name: 'outputDb',  defaultValue: 0,    minValue: -18, maxValue: 18 },
      { name: 'bypass',    defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Multi-band harshness detection ──
    // Band 1: Low bite (1-3kHz)
    this.b1LpL = 0; this.b1LpR = 0; this.b1HpL = 0; this.b1HpR = 0;
    // Band 2: Presence edge (2.5-5kHz)
    this.b2LpL = 0; this.b2LpR = 0; this.b2HpL = 0; this.b2HpR = 0;
    // Band 3: Sizzle (5-9kHz)
    this.b3LpL = 0; this.b3LpR = 0; this.b3HpL = 0; this.b3HpR = 0;

    // Transient envelope followers (fast)
    this.transEnv1 = 0; this.transEnv2 = 0; this.transEnv3 = 0;
    // Sustained envelope followers (slow)
    this.sustEnv1 = 0; this.sustEnv2 = 0; this.sustEnv3 = 0;

    // ── Dynamic smoothing biquad states (3 bands) ──
    // Band 1 notch
    this.n1x1L = 0; this.n1x2L = 0; this.n1y1L = 0; this.n1y2L = 0;
    this.n1x1R = 0; this.n1x2R = 0; this.n1y1R = 0; this.n1y2R = 0;
    // Band 2 notch
    this.n2x1L = 0; this.n2x2L = 0; this.n2y1L = 0; this.n2y2L = 0;
    this.n2x1R = 0; this.n2x2R = 0; this.n2y1R = 0; this.n2y2R = 0;
    // Band 3 notch
    this.n3x1L = 0; this.n3x2L = 0; this.n3y1L = 0; this.n3y2L = 0;
    this.n3x1R = 0; this.n3x2R = 0; this.n3y1R = 0; this.n3y2R = 0;

    // ── Sibilance region (6-10kHz): separate path ──
    this.sibHpL = 0; this.sibHpR = 0;
    this.sibLpL = 0; this.sibLpR = 0;
    this.sibEnv = 0;
    this.sibGainSmooth = 1;

    // ── Air shelf state ──
    this.airHpL = 0; this.airHpR = 0;

    // ── Harmonic detail recovery: stores pre-smoothed HF detail ──
    this.detailHpL = 0; this.detailHpR = 0;
    this.detailEnvL = 0; this.detailEnvR = 0;

    // ── Metering ──
    this._peak = 0;
    this._harshLevel = 0;
    this._sibLevel = 0;

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

    const smooth    = params.smooth[0];
    const focusMode = Math.round(params.focusMode[0]);
    const airReturn = params.airReturn[0];
    const sibilance = params.sibilance[0];
    const mix       = params.mix[0];
    const outputDb  = params.outputDb[0];
    const bypass    = params.bypass[0] > 0.5;
    const sr        = this.sr;

    const outputGain = Math.pow(10, outputDb / 20);
    let peakAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, harshLevel: 0, sibLevel: 0 });
      return true;
    }

    // ── Band edge frequencies by focus mode ──
    // Mode 0: Low Bite (1-3kHz focus)
    // Mode 1: Presence Edge (2.5-5kHz focus)
    // Mode 2: Sizzle (4-8kHz focus)
    // Mode 3: Broad Vocal (1.5-6kHz broad)
    const bandConfigs = [
      { f1: 1000, f2: 2000, f3: 3000, q1: 2, q2: 2, q3: 2, w1: 1.0, w2: 0.6, w3: 0.3 },
      { f1: 2500, f2: 3500, f3: 5000, q1: 2, q2: 2.5, q3: 2, w1: 0.6, w2: 1.0, w3: 0.6 },
      { f1: 4000, f2: 6000, f3: 8000, q1: 2, q2: 2, q3: 2.5, w1: 0.3, w2: 0.6, w3: 1.0 },
      { f1: 1500, f2: 3000, f3: 5500, q1: 1.2, q2: 1.5, q3: 1.2, w1: 0.8, w2: 0.8, w3: 0.8 },
    ];
    const bc = bandConfigs[focusMode] || bandConfigs[1];

    // LP/HP coefficients for band extraction
    const b1LpC = Math.exp(-2 * Math.PI * Math.min(bc.f1 * 1.5, sr * 0.45) / sr);
    const b1HpC = Math.exp(-2 * Math.PI * Math.max(bc.f1 * 0.6, 20) / sr);
    const b2LpC = Math.exp(-2 * Math.PI * Math.min(bc.f2 * 1.5, sr * 0.45) / sr);
    const b2HpC = Math.exp(-2 * Math.PI * Math.max(bc.f2 * 0.6, 20) / sr);
    const b3LpC = Math.exp(-2 * Math.PI * Math.min(bc.f3 * 1.3, sr * 0.45) / sr);
    const b3HpC = Math.exp(-2 * Math.PI * Math.max(bc.f3 * 0.6, 20) / sr);

    // Transient envelope: 1ms atk, 20ms rel
    const transAtk = Math.exp(-1 / (sr * 0.001));
    const transRel = Math.exp(-1 / (sr * 0.02));
    // Sustained envelope: 30ms atk, 200ms rel
    const sustAtk = Math.exp(-1 / (sr * 0.03));
    const sustRel = Math.exp(-1 / (sr * 0.2));

    // Sibilance detection: 6-10kHz
    const sibHpC = Math.exp(-2 * Math.PI * 6000 / sr);
    const sibLpC = Math.exp(-2 * Math.PI * 10000 / sr);
    const sibAtkC = Math.exp(-1 / (sr * 0.001));
    const sibRelC = Math.exp(-1 / (sr * 0.04));
    const sibGainSmoothC = Math.exp(-1 / (sr * 0.003));

    // Air shelf: above 10kHz
    const airCoef = Math.exp(-2 * Math.PI * 10000 / sr);

    // Detail recovery: 3-7kHz HF content
    const detailCoef = Math.exp(-2 * Math.PI * 3000 / sr);

    // Biquad peaking EQ helper
    const calcBiquad = (freq, Q, gainDb) => {
      const omega = 2 * Math.PI * freq / sr;
      const sinW = Math.sin(omega);
      const cosW = Math.cos(omega);
      const A = Math.pow(10, gainDb / 40);
      const alpha = sinW / (2 * Q);
      const b0 = (1 + alpha * A);
      const b1 = (-2 * cosW);
      const b2 = (1 - alpha * A);
      const a0 = (1 + alpha / A);
      const a1 = (-2 * cosW);
      const a2 = (1 - alpha / A);
      return { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
    };

    let harshAccum = 0;
    let sibAccum = 0;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      let wL = dryL;
      let wR = dryR;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 1: MULTI-BAND HARSHNESS DETECTION
      // ═══════════════════════════════════════════════════════════════
      // Band 1 extraction
      this.b1LpL = b1LpC * this.b1LpL + (1 - b1LpC) * wL;
      this.b1LpR = b1LpC * this.b1LpR + (1 - b1LpC) * wR;
      this.b1HpL = b1HpC * this.b1HpL + (1 - b1HpC) * this.b1LpL;
      this.b1HpR = b1HpC * this.b1HpR + (1 - b1HpC) * this.b1LpR;
      const band1L = this.b1LpL - this.b1HpL;
      const band1R = this.b1LpR - this.b1HpR;
      const band1E = Math.max(Math.abs(band1L), Math.abs(band1R));

      // Band 2 extraction
      this.b2LpL = b2LpC * this.b2LpL + (1 - b2LpC) * wL;
      this.b2LpR = b2LpC * this.b2LpR + (1 - b2LpC) * wR;
      this.b2HpL = b2HpC * this.b2HpL + (1 - b2HpC) * this.b2LpL;
      this.b2HpR = b2HpC * this.b2HpR + (1 - b2HpC) * this.b2LpR;
      const band2L = this.b2LpL - this.b2HpL;
      const band2R = this.b2LpR - this.b2HpR;
      const band2E = Math.max(Math.abs(band2L), Math.abs(band2R));

      // Band 3 extraction
      this.b3LpL = b3LpC * this.b3LpL + (1 - b3LpC) * wL;
      this.b3LpR = b3LpC * this.b3LpR + (1 - b3LpC) * wR;
      this.b3HpL = b3HpC * this.b3HpL + (1 - b3HpC) * this.b3LpL;
      this.b3HpR = b3HpC * this.b3HpR + (1 - b3HpC) * this.b3LpR;
      const band3L = this.b3LpL - this.b3HpL;
      const band3R = this.b3LpR - this.b3HpR;
      const band3E = Math.max(Math.abs(band3L), Math.abs(band3R));

      // Transient envelopes (fast)
      this.transEnv1 = band1E > this.transEnv1 ? transAtk * this.transEnv1 + (1 - transAtk) * band1E : transRel * this.transEnv1;
      this.transEnv2 = band2E > this.transEnv2 ? transAtk * this.transEnv2 + (1 - transAtk) * band2E : transRel * this.transEnv2;
      this.transEnv3 = band3E > this.transEnv3 ? transAtk * this.transEnv3 + (1 - transAtk) * band3E : transRel * this.transEnv3;

      // Sustained envelopes (slow)
      this.sustEnv1 = band1E > this.sustEnv1 ? sustAtk * this.sustEnv1 + (1 - sustAtk) * band1E : sustRel * this.sustEnv1;
      this.sustEnv2 = band2E > this.sustEnv2 ? sustAtk * this.sustEnv2 + (1 - sustAtk) * band2E : sustRel * this.sustEnv2;
      this.sustEnv3 = band3E > this.sustEnv3 ? sustAtk * this.sustEnv3 + (1 - sustAtk) * band3E : sustRel * this.sustEnv3;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 2: DYNAMIC BAND SMOOTHING
      // ═══════════════════════════════════════════════════════════════
      // Combine transient+sustained harshness weighted by mode
      const mono = Math.max(Math.abs(wL), Math.abs(wR)) + 0.0001;

      const harsh1 = ((this.transEnv1 * 0.6 + this.sustEnv1 * 0.4) / mono) * bc.w1;
      const harsh2 = ((this.transEnv2 * 0.6 + this.sustEnv2 * 0.4) / mono) * bc.w2;
      const harsh3 = ((this.transEnv3 * 0.6 + this.sustEnv3 * 0.4) / mono) * bc.w3;

      // Dynamic cut dB per band: only cut when ratio exceeds threshold
      const threshold = 0.3;
      const h1Over = Math.max(0, harsh1 - threshold);
      const h2Over = Math.max(0, harsh2 - threshold);
      const h3Over = Math.max(0, harsh3 - threshold);

      const cut1Db = -smooth * h1Over * 30 * bc.w1;
      const cut2Db = -smooth * h2Over * 30 * bc.w2;
      const cut3Db = -smooth * h3Over * 30 * bc.w3;

      // Apply biquad peaking EQs (inline for performance)
      if (Math.abs(cut1Db) > 0.1) {
        const c = calcBiquad(bc.f1, bc.q1, cut1Db);
        const yL = c.b0 * wL + c.b1 * this.n1x1L + c.b2 * this.n1x2L - c.a1 * this.n1y1L - c.a2 * this.n1y2L;
        this.n1x2L = this.n1x1L; this.n1x1L = wL; this.n1y2L = this.n1y1L; this.n1y1L = yL; wL = yL;
        const yR = c.b0 * wR + c.b1 * this.n1x1R + c.b2 * this.n1x2R - c.a1 * this.n1y1R - c.a2 * this.n1y2R;
        this.n1x2R = this.n1x1R; this.n1x1R = wR; this.n1y2R = this.n1y1R; this.n1y1R = yR; wR = yR;
      }

      if (Math.abs(cut2Db) > 0.1) {
        const c = calcBiquad(bc.f2, bc.q2, cut2Db);
        const yL = c.b0 * wL + c.b1 * this.n2x1L + c.b2 * this.n2x2L - c.a1 * this.n2y1L - c.a2 * this.n2y2L;
        this.n2x2L = this.n2x1L; this.n2x1L = wL; this.n2y2L = this.n2y1L; this.n2y1L = yL; wL = yL;
        const yR = c.b0 * wR + c.b1 * this.n2x1R + c.b2 * this.n2x2R - c.a1 * this.n2y1R - c.a2 * this.n2y2R;
        this.n2x2R = this.n2x1R; this.n2x1R = wR; this.n2y2R = this.n2y1R; this.n2y1R = yR; wR = yR;
      }

      if (Math.abs(cut3Db) > 0.1) {
        const c = calcBiquad(bc.f3, bc.q3, cut3Db);
        const yL = c.b0 * wL + c.b1 * this.n3x1L + c.b2 * this.n3x2L - c.a1 * this.n3y1L - c.a2 * this.n3y2L;
        this.n3x2L = this.n3x1L; this.n3x1L = wL; this.n3y2L = this.n3y1L; this.n3y1L = yL; wL = yL;
        const yR = c.b0 * wR + c.b1 * this.n3x1R + c.b2 * this.n3x2R - c.a1 * this.n3y1R - c.a2 * this.n3y2R;
        this.n3x2R = this.n3x1R; this.n3x1R = wR; this.n3y2R = this.n3y1R; this.n3y1R = yR; wR = yR;
      }

      harshAccum += (harsh1 + harsh2 + harsh3) / 3;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 3: SIBILANCE CONTROL (6-10kHz, separate dynamic path)
      // ═══════════════════════════════════════════════════════════════
      if (sibilance > 0.01) {
        // Extract 6-10kHz band
        this.sibHpL = sibHpC * this.sibHpL + (1 - sibHpC) * wL;
        this.sibHpR = sibHpC * this.sibHpR + (1 - sibHpC) * wR;
        const sibBandL = wL - this.sibHpL;
        const sibBandR = wR - this.sibHpR;

        // Sibilance envelope
        const sibE = Math.max(Math.abs(sibBandL), Math.abs(sibBandR));
        this.sibEnv = sibE > this.sibEnv
          ? sibAtkC * this.sibEnv + (1 - sibAtkC) * sibE
          : sibRelC * this.sibEnv + (1 - sibRelC) * sibE;

        // Dynamic gain reduction on sibilance band
        // Threshold-based: only reduce above a dynamic threshold
        const sibThresh = 0.05 + (1 - sibilance) * 0.15;
        const sibOver = Math.max(0, this.sibEnv - sibThresh);
        const sibRatio = 1 - Math.min(0.8, sibOver * sibilance * 10);

        // Smooth sibilance gain to prevent artifacts (no lisp)
        this.sibGainSmooth = sibGainSmoothC * this.sibGainSmooth + (1 - sibGainSmoothC) * sibRatio;

        // Apply: reduce only the sibilance band, keep the rest
        wL = (wL - sibBandL) + sibBandL * this.sibGainSmooth;
        wR = (wR - sibBandR) + sibBandR * this.sibGainSmooth;

        sibAccum += this.sibEnv;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 4: HARMONIC DETAIL RECOVERY
      // ═══════════════════════════════════════════════════════════════
      // After smoothing, recover some perceived detail by adding back
      // low-level HF content that was reduced
      if (smooth > 0.1) {
        this.detailHpL = detailCoef * this.detailHpL + (1 - detailCoef) * dryL;
        this.detailHpR = detailCoef * this.detailHpR + (1 - detailCoef) * dryR;
        const detailL = dryL - this.detailHpL;
        const detailR = dryR - this.detailHpR;

        // Only recover detail that was lost (compare dry vs wet HF)
        const wetHpL = wL - (detailCoef * wL + (1 - detailCoef) * wL); // approximation
        const lostL = detailL - (wL - this.detailHpL);
        const lostR = detailR - (wR - this.detailHpR);

        // Gentle recovery scaled by smooth amount (more smooth = more recovery needed)
        const recoveryAmt = smooth * 0.25;
        wL += lostL * recoveryAmt;
        wR += lostR * recoveryAmt;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 5: AIR RETURN (top-end openness above 10kHz)
      // ═══════════════════════════════════════════════════════════════
      if (airReturn > 0.01) {
        this.airHpL = airCoef * this.airHpL + (1 - airCoef) * wL;
        this.airHpR = airCoef * this.airHpR + (1 - airCoef) * wR;
        const airL = wL - this.airHpL;
        const airR = wR - this.airHpR;
        // Boost the air band gently
        wL += airL * airReturn * 3.5;
        wR += airR * airReturn * 3.5;
      }

      // ═══════════════════════════════════════════════════════════════
      // OUTPUT
      // ═══════════════════════════════════════════════════════════════
      oL[n] = (dryL * (1 - mix) + wL * mix) * outputGain;
      oR[n] = (dryR * (1 - mix) + wR * mix) * outputGain;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._harshLevel = harshAccum / iL.length;
    this._sibLevel = sibAccum / iL.length;
    this.port.postMessage({
      peak: peakAccum,
      harshLevel: this._harshLevel,
      sibLevel: this._sibLevel,
    });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', DeHarshProcessor);
`;

export async function createDeHarshEngine(audioCtx) {
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

  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0, _harshLevel = 0, _sibLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.harshLevel !== undefined) _harshLevel = e.data.harshLevel;
    if (e.data?.sibLevel !== undefined) _sibLevel = e.data.sibLevel;
  };

  const _buf = new Float32Array(2048);

  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0;
    for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeakAn(an) {
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
    setSmooth:     v => { p('smooth').value    = v; },
    setFocusMode:  v => { p('focusMode').value = v; },
    setAirReturn:  v => { p('airReturn').value = v; },
    setSibilance:  v => { p('sibilance').value = v; },
    setMix:        v => { p('mix').value       = v; },
    setOutputDb:   v => { p('outputDb').value  = v; },
    setBypass:     v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeakAn(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getHarshLevel:  () => _harshLevel,
    getSibLevel:    () => _sibLevel,

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
