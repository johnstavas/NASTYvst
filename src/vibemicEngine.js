// vibemicEngine.js — VIBEMIC: Musical mic personality engine.
//
// 5 mic modes each with unique proximity model, presence/capsule shape,
// character saturation, and off-axis softness/focus.
//
// Modes: 0=Vintage Tube, 1=Broadcast, 2=Modern Condenser, 3=Dark Ribbon, 4=Phone/Lo-Fi
//
// Controls:
//   MIC TYPE       — mode 0-4
//   PROXIMITY      — dynamic low-end buildup 0-100
//   PRESENCE SHAPE — upper-mid curves 0-100
//   CHARACTER      — mode-specific saturation 0-100
//   FOCUS          — off-axis softness 0-100
//   MIX            — dry/wet 0-100%
//   OUTPUT         — output gain -18 to +18 dB
//   BYPASS

const PROCESSOR_VERSION = 'vibemic-v1';

const PROCESSOR_CODE = `
class VibeMicProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'micType',   defaultValue: 0,    minValue: 0, maxValue: 4 },
      { name: 'proximity', defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'presShape', defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'character', defaultValue: 0.40, minValue: 0, maxValue: 1 },
      { name: 'focus',     defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'mix',       defaultValue: 1.0,  minValue: 0, maxValue: 1 },
      { name: 'outputDb',  defaultValue: 0,    minValue: -18, maxValue: 18 },
      { name: 'bypass',    defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Proximity model: dynamic LP boost ──
    this.proxLpL = 0; this.proxLpR = 0;
    this.proxEnvL = 0; this.proxEnvR = 0;

    // ── Presence/capsule shaping: 2-band biquad ──
    // Low presence band
    this.pres1x1L = 0; this.pres1x2L = 0; this.pres1y1L = 0; this.pres1y2L = 0;
    this.pres1x1R = 0; this.pres1x2R = 0; this.pres1y1R = 0; this.pres1y2R = 0;
    // High presence band
    this.pres2x1L = 0; this.pres2x2L = 0; this.pres2y1L = 0; this.pres2y2L = 0;
    this.pres2x1R = 0; this.pres2x2R = 0; this.pres2y1R = 0; this.pres2y2R = 0;

    // ── Character saturation state ──
    this.satPrevL = 0; this.satPrevR = 0;

    // ── Focus / off-axis: LP filter for softening ──
    this.focusLpL = 0; this.focusLpR = 0;
    this.focusHpL = 0; this.focusHpR = 0;

    // ── Lo-Fi bandpass for Phone mode ──
    this.lofiLpL = 0; this.lofiLpR = 0;
    this.lofiHpL = 0; this.lofiHpR = 0;

    // ── Metering ──
    this._peak = 0;
    this._character = 0;

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

    const micType   = Math.round(params.micType[0]);
    const proximity = params.proximity[0];
    const presShape = params.presShape[0];
    const character = params.character[0];
    const focus     = params.focus[0];
    const mix       = params.mix[0];
    const outputDb  = params.outputDb[0];
    const bypass    = params.bypass[0] > 0.5;
    const sr        = this.sr;

    const outputGain = Math.pow(10, outputDb / 20);
    let peakAccum = 0;
    let charAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, character: 0 });
      return true;
    }

    // ── Per-mode configurations ──
    // Each mode has: proxFreq, proxAmount, presFreq1, presGain1, presFreq2, presGain2, satType, satAmount, focusFreq, lofi
    const modeConfigs = [
      // 0: Vintage Tube — rich body, harmonic warmth, smooth top
      { proxFreq: 180, proxAmt: 1.2, pf1: 2000, pg1: 4, pf2: 8000, pg2: -3, satType: 'tube', satAmt: 1.5, focusF: 12000, lofi: false },
      // 1: Broadcast — controlled lows, focused mids
      { proxFreq: 120, proxAmt: 0.6, pf1: 3000, pg1: 5, pf2: 6000, pg2: 2, satType: 'warm', satAmt: 0.8, focusF: 14000, lofi: false },
      // 2: Modern Condenser — open top, clean transients
      { proxFreq: 150, proxAmt: 0.4, pf1: 4000, pg1: 3, pf2: 12000, pg2: 5, satType: 'clean', satAmt: 0.3, focusF: 18000, lofi: false },
      // 3: Dark Ribbon — soft top, strong mid body
      { proxFreq: 200, proxAmt: 1.0, pf1: 1500, pg1: 5, pf2: 6000, pg2: -6, satType: 'ribbon', satAmt: 1.0, focusF: 8000, lofi: false },
      // 4: Phone/Lo-Fi — band-limited, edgy midrange
      { proxFreq: 300, proxAmt: 0.2, pf1: 1000, pg1: 6, pf2: 3000, pg2: 4, satType: 'clip', satAmt: 2.0, focusF: 4000, lofi: true },
    ];
    const mc = modeConfigs[micType] || modeConfigs[0];

    // ── Proximity LP coefficient (dynamic based on level) ──
    const proxCoef = Math.exp(-2 * Math.PI * mc.proxFreq / sr);
    const proxAtkC = Math.exp(-1 / (sr * 0.01));
    const proxRelC = Math.exp(-1 / (sr * 0.15));

    // ── Presence biquad coefficients ──
    const calcBiquadPeak = (freq, Q, gainDb) => {
      const omega = 2 * Math.PI * Math.min(freq, sr * 0.45) / sr;
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

    const presQ = 1.2;
    const p1Gain = mc.pg1 * presShape;
    const p2Gain = mc.pg2 * presShape;
    const c1 = calcBiquadPeak(mc.pf1, presQ, p1Gain);
    const c2 = calcBiquadPeak(mc.pf2, presQ, p2Gain);

    // ── Focus LP ──
    const focusFreq = mc.focusF * (0.3 + focus * 0.7);
    const focusCoef = Math.exp(-2 * Math.PI * Math.min(focusFreq, sr * 0.45) / sr);

    // ── Lo-Fi bandpass (for Phone mode) ──
    const lofiLpCoef = Math.exp(-2 * Math.PI * 3500 / sr);
    const lofiHpCoef = Math.exp(-2 * Math.PI * 300 / sr);

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      let wL = dryL;
      let wR = dryR;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 1: PROXIMITY MODEL (dynamic low-end buildup)
      // ═══════════════════════════════════════════════════════════════
      if (proximity > 0.01) {
        // Extract LP content
        this.proxLpL = proxCoef * this.proxLpL + (1 - proxCoef) * wL;
        this.proxLpR = proxCoef * this.proxLpR + (1 - proxCoef) * wR;

        // Dynamic proximity: more boost when signal is present
        const absM = (Math.abs(wL) + Math.abs(wR)) * 0.5;
        this.proxEnvL = absM > this.proxEnvL
          ? proxAtkC * this.proxEnvL + (1 - proxAtkC) * absM
          : proxRelC * this.proxEnvL + (1 - proxRelC) * absM;

        // Scale proximity boost by signal presence (not just static boost)
        const dynamicProx = Math.min(1, this.proxEnvL * 5);
        const proxBoost = proximity * mc.proxAmt * (0.4 + dynamicProx * 0.6);

        wL += this.proxLpL * proxBoost;
        wR += this.proxLpR * proxBoost;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 2: PRESENCE / CAPSULE SHAPE (biquad EQ)
      // ═══════════════════════════════════════════════════════════════
      if (presShape > 0.01) {
        // Band 1
        let y1L = c1.b0 * wL + c1.b1 * this.pres1x1L + c1.b2 * this.pres1x2L - c1.a1 * this.pres1y1L - c1.a2 * this.pres1y2L;
        this.pres1x2L = this.pres1x1L; this.pres1x1L = wL; this.pres1y2L = this.pres1y1L; this.pres1y1L = y1L;
        let y1R = c1.b0 * wR + c1.b1 * this.pres1x1R + c1.b2 * this.pres1x2R - c1.a1 * this.pres1y1R - c1.a2 * this.pres1y2R;
        this.pres1x2R = this.pres1x1R; this.pres1x1R = wR; this.pres1y2R = this.pres1y1R; this.pres1y1R = y1R;
        wL = y1L; wR = y1R;

        // Band 2
        let y2L = c2.b0 * wL + c2.b1 * this.pres2x1L + c2.b2 * this.pres2x2L - c2.a1 * this.pres2y1L - c2.a2 * this.pres2y2L;
        this.pres2x2L = this.pres2x1L; this.pres2x1L = wL; this.pres2y2L = this.pres2y1L; this.pres2y1L = y2L;
        let y2R = c2.b0 * wR + c2.b1 * this.pres2x1R + c2.b2 * this.pres2x2R - c2.a1 * this.pres2y1R - c2.a2 * this.pres2y2R;
        this.pres2x2R = this.pres2x1R; this.pres2x1R = wR; this.pres2y2R = this.pres2y1R; this.pres2y1R = y2R;
        wL = y2L; wR = y2R;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 3: CHARACTER SATURATION (mode-specific)
      // ═══════════════════════════════════════════════════════════════
      if (character > 0.01) {
        const drive = 1 + character * mc.satAmt * 3;
        const charAmt = character * mc.satAmt;

        switch (mc.satType) {
          case 'tube': {
            // Asymmetric tube warmth: more even harmonics
            const satL = Math.tanh(wL * drive * 0.8);
            const satR = Math.tanh(wR * drive * 0.8);
            // Asymmetric bias for even harmonics
            const biasL = satL + 0.1 * satL * satL * Math.sign(satL);
            const biasR = satR + 0.1 * satR * satR * Math.sign(satR);
            wL = wL * (1 - charAmt) + biasL / drive * charAmt;
            wR = wR * (1 - charAmt) + biasR / drive * charAmt;
            break;
          }
          case 'warm': {
            // Gentle transformer-style saturation
            const warmL = Math.tanh(wL * drive * 0.6) / (drive * 0.6);
            const warmR = Math.tanh(wR * drive * 0.6) / (drive * 0.6);
            wL = wL * (1 - charAmt * 0.7) + warmL * charAmt * 0.7;
            wR = wR * (1 - charAmt * 0.7) + warmR * charAmt * 0.7;
            break;
          }
          case 'clean': {
            // Very subtle soft clip (modern condenser barely colors)
            const headroom = 0.95 - character * 0.15;
            if (Math.abs(wL) > headroom) wL = headroom * Math.sign(wL) + (wL - headroom * Math.sign(wL)) * 0.3;
            if (Math.abs(wR) > headroom) wR = headroom * Math.sign(wR) + (wR - headroom * Math.sign(wR)) * 0.3;
            break;
          }
          case 'ribbon': {
            // Ribbon transformer: smooth, warm, rounded
            const ribL = wL * drive;
            const ribR = wR * drive;
            const softL = ribL / (1 + Math.abs(ribL));
            const softR = ribR / (1 + Math.abs(ribR));
            wL = wL * (1 - charAmt) + softL * charAmt;
            wR = wR * (1 - charAmt) + softR * charAmt;
            break;
          }
          case 'clip': {
            // Hard clip + bit crush for lo-fi edge
            const clipLevel = 0.6 - character * 0.25;
            wL = Math.max(-clipLevel, Math.min(clipLevel, wL * drive)) / clipLevel;
            wR = Math.max(-clipLevel, Math.min(clipLevel, wR * drive)) / clipLevel;
            // Subtle bit reduction
            const bits = 12 - character * 4; // 12 to 8 bit
            const quant = Math.pow(2, bits);
            wL = Math.round(wL * quant) / quant;
            wR = Math.round(wR * quant) / quant;
            wL *= 0.7; wR *= 0.7; // compensate level
            break;
          }
        }
        charAccum += Math.abs(wL - dryL) + Math.abs(wR - dryR);
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 4: FOCUS / OFF-AXIS CONTROL
      // ═══════════════════════════════════════════════════════════════
      // Low focus = soft/off-axis (more LP), High focus = tight/on-axis (less LP)
      if (focus < 0.95) {
        const softAmount = (1 - focus) * 0.6;
        this.focusLpL = focusCoef * this.focusLpL + (1 - focusCoef) * wL;
        this.focusLpR = focusCoef * this.focusLpR + (1 - focusCoef) * wR;
        const hfL = wL - this.focusLpL;
        const hfR = wR - this.focusLpR;
        wL -= hfL * softAmount;
        wR -= hfR * softAmount;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 5: LO-FI BANDPASS (Phone mode only)
      // ═══════════════════════════════════════════════════════════════
      if (mc.lofi) {
        this.lofiLpL = lofiLpCoef * this.lofiLpL + (1 - lofiLpCoef) * wL;
        this.lofiLpR = lofiLpCoef * this.lofiLpR + (1 - lofiLpCoef) * wR;
        this.lofiHpL = lofiHpCoef * this.lofiHpL + (1 - lofiHpCoef) * this.lofiLpL;
        this.lofiHpR = lofiHpCoef * this.lofiHpR + (1 - lofiHpCoef) * this.lofiLpR;
        wL = this.lofiLpL - this.lofiHpL;
        wR = this.lofiLpR - this.lofiHpR;
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
    this._character = charAccum / iL.length;
    this.port.postMessage({
      peak: peakAccum,
      character: this._character,
      micType: micType,
    });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', VibeMicProcessor);
`;

export async function createVibeMicEngine(audioCtx) {
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

  let _peak = 0, _character = 0, _micType = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.character !== undefined) _character = e.data.character;
    if (e.data?.micType !== undefined) _micType = e.data.micType;
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
    setMicType:    v => { p('micType').value   = v; },
    setProximity:  v => { p('proximity').value = v; },
    setPresShape:  v => { p('presShape').value = v; },
    setCharacter:  v => { p('character').value = v; },
    setFocus:      v => { p('focus').value     = v; },
    setMix:        v => { p('mix').value       = v; },
    setOutputDb:   v => { p('outputDb').value  = v; },
    setBypass:     v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeakAn(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getCharacter:   () => _character,

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
