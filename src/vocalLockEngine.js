// vocalLockEngine.js — VOCALLOCK: Vocal positioning system.
//
// Dual-envelope level stabilizer (slow phrase rider + fast peak control),
// dynamic presence shaper (1-5kHz), body/mud manager (low-mid dynamic),
// forwardness layer (harmonic enhancement + micro transient lift),
// de-harsh smoothing (light dynamic HF reduction).
//
// Controls:
//   LOCK      — main macro 0-100 (controls all processing depth)
//   PRESENCE  — dynamic presence boost 0-100
//   BODY      — low-mid body control 0-100
//   STABILITY — how aggressively the level is held 0-100
//   MIX       — dry/wet 0-100%
//   OUTPUT    — output gain -18 to +18 dB
//   BYPASS

const PROCESSOR_VERSION = 'vocallock-v1';

const PROCESSOR_CODE = `
class VocalLockProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lock',      defaultValue: 0.45, minValue: 0, maxValue: 1 },
      { name: 'presence',  defaultValue: 0.40, minValue: 0, maxValue: 1 },
      { name: 'body',      defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'stability', defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'mix',       defaultValue: 1.0,  minValue: 0, maxValue: 1 },
      { name: 'outputDb',  defaultValue: 0,    minValue: -18, maxValue: 18 },
      { name: 'bypass',    defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Dual-envelope level stabilizer ──
    // Slow phrase envelope (~200ms attack, ~800ms release)
    this.phraseEnvL = 0; this.phraseEnvR = 0;
    // Fast peak envelope (~2ms attack, ~50ms release)
    this.peakEnvL = 0; this.peakEnvR = 0;

    // Target level for stabilization (auto-calibrating)
    this.targetLevel = 0.25;
    this.targetSmooth = 0;

    // Smoothed gain for zipper-free application
    this.smoothGainL = 1; this.smoothGainR = 1;

    // ── Dynamic presence shaper (bandpass 1-5kHz) ──
    // 2nd-order biquad state for presence band
    this.presBpX1L = 0; this.presBpX2L = 0; this.presBpY1L = 0; this.presBpY2L = 0;
    this.presBpX1R = 0; this.presBpX2R = 0; this.presBpY1R = 0; this.presBpY2R = 0;
    this.presEnv = 0; // envelope follower for presence band level

    // ── Body/mud manager (low-mid dynamic: 150-500Hz) ──
    this.bodyLpL = 0; this.bodyLpR = 0; // LP at 500Hz
    this.bodyHpL = 0; this.bodyHpR = 0; // HP at 150Hz
    this.bodyEnv = 0;

    // ── Forwardness: harmonic saturation state ──
    this.prevL = 0; this.prevR = 0; // for transient detection

    // ── De-harsh smoothing (HP detect, dynamic LP apply) ──
    this.harshDetL = 0; this.harshDetR = 0;
    this.harshEnv = 0;
    this.harshLpL = 0; this.harshLpR = 0;

    // ── Metering ──
    this._peak = 0;
    this._gainReduction = 0;

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

    const lock      = params.lock[0];
    const presence  = params.presence[0];
    const body      = params.body[0];
    const stability = params.stability[0];
    const mix       = params.mix[0];
    const outputDb  = params.outputDb[0];
    const bypass    = params.bypass[0] > 0.5;
    const sr        = this.sr;

    const outputGain = Math.pow(10, outputDb / 20);
    let peakAccum = 0;
    let grAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, gainReduction: 0 });
      return true;
    }

    // ── Envelope follower coefficients ──
    // Phrase envelope: slow, rides phrase-level dynamics
    const phraseAtk = Math.exp(-1 / (sr * (0.15 + (1 - stability) * 0.25)));  // 150-400ms
    const phraseRel = Math.exp(-1 / (sr * (0.5 + stability * 1.0)));           // 500-1500ms
    // Peak envelope: fast, catches transient peaks
    const peakAtk   = Math.exp(-1 / (sr * 0.001));  // 1ms
    const peakRel   = Math.exp(-1 / (sr * (0.03 + (1 - stability) * 0.05))); // 30-80ms

    // Gain smoothing
    const gainSmooth = Math.exp(-1 / (sr * (0.005 + stability * 0.02))); // 5-25ms

    // ── Presence band: biquad bandpass centered at ~2.5kHz, Q depends on presence ──
    const presFreq = 2500 + presence * 1500; // 2.5-4kHz center
    const presQ = 0.8 + presence * 0.5;
    const presOmega = 2 * Math.PI * presFreq / sr;
    const presSinW = Math.sin(presOmega);
    const presCosW = Math.cos(presOmega);
    const presAlpha = presSinW / (2 * presQ);
    // Bandpass coefficients
    const presBp_b0 = presAlpha;
    const presBp_b1 = 0;
    const presBp_b2 = -presAlpha;
    const presBp_a0 = 1 + presAlpha;
    const presBp_a1 = -2 * presCosW;
    const presBp_a2 = 1 - presAlpha;

    // ── Body band: LP at ~500Hz, HP at ~150Hz ──
    const bodyLpCoef = Math.exp(-2 * Math.PI * 500 / sr);
    const bodyHpCoef = Math.exp(-2 * Math.PI * 150 / sr);

    // ── De-harsh: detect HF above 6kHz ──
    const harshDetCoef = Math.exp(-2 * Math.PI * 6000 / sr);
    const harshLpCoef  = Math.exp(-2 * Math.PI * 7000 / sr);
    const harshAtkCoef = Math.exp(-1 / (sr * 0.003));
    const harshRelCoef = Math.exp(-1 / (sr * 0.06));

    // Presence envelope
    const presAtkCoef = Math.exp(-1 / (sr * 0.01));
    const presRelCoef = Math.exp(-1 / (sr * 0.1));

    // Body envelope
    const bodyAtkCoef = Math.exp(-1 / (sr * 0.01));
    const bodyRelCoef = Math.exp(-1 / (sr * 0.15));

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      let wL = dryL;
      let wR = dryR;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 1: DUAL-ENVELOPE LEVEL STABILIZER
      // ═══════════════════════════════════════════════════════════════
      const absL = Math.abs(wL);
      const absR = Math.abs(wR);
      const mono = (absL + absR) * 0.5;

      // Phrase envelope (slow)
      if (mono > this.phraseEnvL) {
        this.phraseEnvL = phraseAtk * this.phraseEnvL + (1 - phraseAtk) * mono;
      } else {
        this.phraseEnvL = phraseRel * this.phraseEnvL + (1 - phraseRel) * mono;
      }

      // Peak envelope (fast)
      if (mono > this.peakEnvL) {
        this.peakEnvL = peakAtk * this.peakEnvL + (1 - peakAtk) * mono;
      } else {
        this.peakEnvL = peakRel * this.peakEnvL + (1 - peakRel) * mono;
      }

      // Auto-calibrate target level
      this.targetSmooth = this.targetSmooth * 0.9999 + mono * 0.0001;
      if (this.targetSmooth > 0.01) {
        this.targetLevel = this.targetLevel * 0.999 + this.targetSmooth * 0.001;
      }
      const target = Math.max(0.05, Math.min(0.5, this.targetLevel));

      // Blend phrase and peak envelopes for gain computation
      const blendedEnv = this.phraseEnvL * 0.6 + this.peakEnvL * 0.4;

      // Compute gain correction
      let gainCorr = 1;
      if (blendedEnv > 0.0001) {
        const ratio = target / blendedEnv;
        // Limit gain range to prevent extreme boosts/cuts
        const maxBoost = 1 + lock * 3;  // up to 4x boost at full lock
        const maxCut = 1 - lock * 0.7;  // down to 0.3x cut at full lock
        gainCorr = Math.max(maxCut, Math.min(maxBoost, ratio));
        // Scale by lock amount — at 0 lock, gain stays at 1
        gainCorr = 1 + (gainCorr - 1) * lock;
      }

      // Smooth gain application (zipper-free)
      this.smoothGainL = gainSmooth * this.smoothGainL + (1 - gainSmooth) * gainCorr;

      wL *= this.smoothGainL;
      wR *= this.smoothGainL;

      const gr = this.smoothGainL;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 2: DYNAMIC PRESENCE SHAPER
      // ═══════════════════════════════════════════════════════════════
      if (presence > 0.01) {
        // Biquad bandpass on L
        const presYL = (presBp_b0 / presBp_a0) * wL
                     + (presBp_b1 / presBp_a0) * this.presBpX1L
                     + (presBp_b2 / presBp_a0) * this.presBpX2L
                     - (presBp_a1 / presBp_a0) * this.presBpY1L
                     - (presBp_a2 / presBp_a0) * this.presBpY2L;
        this.presBpX2L = this.presBpX1L; this.presBpX1L = wL;
        this.presBpY2L = this.presBpY1L; this.presBpY1L = presYL;

        // Biquad bandpass on R
        const presYR = (presBp_b0 / presBp_a0) * wR
                     + (presBp_b1 / presBp_a0) * this.presBpX1R
                     + (presBp_b2 / presBp_a0) * this.presBpX2R
                     - (presBp_a1 / presBp_a0) * this.presBpY1R
                     - (presBp_a2 / presBp_a0) * this.presBpY2R;
        this.presBpX2R = this.presBpX1R; this.presBpX1R = wR;
        this.presBpY2R = this.presBpY1R; this.presBpY1R = presYR;

        // Envelope follower on presence band energy
        const presEnergy = Math.max(Math.abs(presYL), Math.abs(presYR));
        if (presEnergy > this.presEnv) {
          this.presEnv = presAtkCoef * this.presEnv + (1 - presAtkCoef) * presEnergy;
        } else {
          this.presEnv = presRelCoef * this.presEnv + (1 - presRelCoef) * presEnergy;
        }

        // Dynamic boost: boost presence only when it's lacking
        // If presence band is quiet relative to overall, boost it
        const presRatio = mono > 0.001 ? this.presEnv / (mono + 0.001) : 0;
        const presNeed = Math.max(0, 1 - presRatio * 3); // need boost when ratio is low
        const presBoostAmt = presNeed * presence * lock * 4;

        wL += presYL * presBoostAmt;
        wR += presYR * presBoostAmt;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 3: BODY/MUD MANAGER (dynamic low-mid control)
      // ═══════════════════════════════════════════════════════════════
      // LP at 500Hz
      this.bodyLpL = bodyLpCoef * this.bodyLpL + (1 - bodyLpCoef) * wL;
      this.bodyLpR = bodyLpCoef * this.bodyLpR + (1 - bodyLpCoef) * wR;
      // HP at 150Hz
      this.bodyHpL = bodyHpCoef * this.bodyHpL + (1 - bodyHpCoef) * this.bodyLpL;
      this.bodyHpR = bodyHpCoef * this.bodyHpR + (1 - bodyHpCoef) * this.bodyLpR;
      // Bandpass result: 150-500Hz
      const bodyBandL = this.bodyLpL - this.bodyHpL;
      const bodyBandR = this.bodyLpR - this.bodyHpR;

      // Envelope on body band
      const bodyEnergy = Math.max(Math.abs(bodyBandL), Math.abs(bodyBandR));
      if (bodyEnergy > this.bodyEnv) {
        this.bodyEnv = bodyAtkCoef * this.bodyEnv + (1 - bodyAtkCoef) * bodyEnergy;
      } else {
        this.bodyEnv = bodyRelCoef * this.bodyEnv + (1 - bodyRelCoef) * bodyEnergy;
      }

      // Body control: > 0.5 adds body, < 0.5 removes mud
      const bodyFactor = (body - 0.5) * 2; // -1 to +1
      const bodyModAmt = bodyFactor * lock * 0.6;
      if (bodyFactor > 0) {
        // Add body: boost the low-mid band
        wL += bodyBandL * bodyModAmt;
        wR += bodyBandR * bodyModAmt;
      } else {
        // Remove mud: dynamically reduce when body band is excessive
        const mudThresh = 0.1;
        const mudExcess = Math.max(0, this.bodyEnv - mudThresh) / (mudThresh + 0.01);
        const mudCut = Math.min(1, mudExcess * Math.abs(bodyModAmt));
        wL -= bodyBandL * mudCut * 0.5;
        wR -= bodyBandR * mudCut * 0.5;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 4: FORWARDNESS (harmonic saturation + transient lift)
      // ═══════════════════════════════════════════════════════════════
      if (lock > 0.05) {
        // Soft saturation for harmonic richness
        const satAmt = lock * 0.3;
        const satDrive = 1 + satAmt * 3;
        wL = Math.tanh(wL * satDrive) / satDrive * (1 + satAmt * 0.5);
        wR = Math.tanh(wR * satDrive) / satDrive * (1 + satAmt * 0.5);

        // Micro transient lift: emphasize fast signal changes
        const deltaL = wL - this.prevL;
        const deltaR = wR - this.prevR;
        this.prevL = wL; this.prevR = wR;
        const transientAmt = lock * 0.15;
        wL += deltaL * transientAmt;
        wR += deltaR * transientAmt;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 5: DE-HARSH SMOOTHING (light dynamic HF reduction)
      // ═══════════════════════════════════════════════════════════════
      if (lock > 0.02) {
        // Detect HF energy via HP at 6kHz
        this.harshDetL = harshDetCoef * this.harshDetL + (1 - harshDetCoef) * wL;
        this.harshDetR = harshDetCoef * this.harshDetR + (1 - harshDetCoef) * wR;
        const hfL = wL - this.harshDetL;
        const hfR = wR - this.harshDetR;

        // Envelope on HF
        const hfEnergy = Math.max(Math.abs(hfL), Math.abs(hfR));
        if (hfEnergy > this.harshEnv) {
          this.harshEnv = harshAtkCoef * this.harshEnv + (1 - harshAtkCoef) * hfEnergy;
        } else {
          this.harshEnv = harshRelCoef * this.harshEnv + (1 - harshRelCoef) * hfEnergy;
        }

        // Dynamic LP: reduce HF when harsh
        const harshFactor = Math.min(1, this.harshEnv * 20);
        const harshReduce = harshFactor * lock * 0.4;
        this.harshLpL = harshLpCoef * this.harshLpL + (1 - harshLpCoef) * wL;
        this.harshLpR = harshLpCoef * this.harshLpR + (1 - harshLpCoef) * wR;

        wL = wL * (1 - harshReduce) + this.harshLpL * harshReduce;
        wR = wR * (1 - harshReduce) + this.harshLpR * harshReduce;
      }

      // ═══════════════════════════════════════════════════════════════
      // OUTPUT: Mix + output gain
      // ═══════════════════════════════════════════════════════════════
      oL[n] = (dryL * (1 - mix) + wL * mix) * outputGain;
      oR[n] = (dryR * (1 - mix) + wR * mix) * outputGain;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
      grAccum += Math.abs(1 - gr);
    }

    this._peak = peakAccum;
    this._gainReduction = grAccum / iL.length;
    this.port.postMessage({
      peak: peakAccum,
      gainReduction: this._gainReduction,
      presenceLevel: this.presEnv,
      bodyLevel: this.bodyEnv,
    });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', VocalLockProcessor);
`;

export async function createVocalLockEngine(audioCtx) {
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

  let _peak = 0, _gainReduction = 0, _presenceLevel = 0, _bodyLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.gainReduction !== undefined) _gainReduction = e.data.gainReduction;
    if (e.data?.presenceLevel !== undefined) _presenceLevel = e.data.presenceLevel;
    if (e.data?.bodyLevel !== undefined) _bodyLevel = e.data.bodyLevel;
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
    setLock:       v => { p('lock').value      = v; },
    setPresence:   v => { p('presence').value  = v; },
    setBody:       v => { p('body').value      = v; },
    setStability:  v => { p('stability').value = v; },
    setMix:        v => { p('mix').value       = v; },
    setOutputDb:   v => { p('outputDb').value  = v; },
    setBypass:     v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak:     () => { _peakIn  = Math.max(getPeakAn(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:    () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:    () => getRms(analyserIn),
    getOutputLevel:   () => getRms(analyserOut),
    getPeakOutput:    () => _peak,
    getGainReduction: () => _gainReduction,
    getPresenceLevel: () => _presenceLevel,
    getBodyLevel:     () => _bodyLevel,

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
