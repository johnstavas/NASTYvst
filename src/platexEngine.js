// platexEngine.js — PLATEX: Modern Dynamic Plate Reverb
//
// Classic plate character with living, responsive behavior.
// 4 allpass diffusers in series -> 2 parallel combs with crossfeed.
// Tension modulates allpass coefficients. Energy envelope follower
// drives dynamic feedback. Metal character adds resonant peaks.
//
// Controls:
//   TENSION — allpass coeff / tightness (0-1)
//   SIZE    — comb delay / ring time (0-1)
//   ENERGY  — input-driven dynamic response (0-1)
//   METAL   — metallic character / resonance (0-1)
//   TONE    — tilt EQ (0-1)
//   MIX     — dry/wet (0-1)
//   BYPASS

const PROCESSOR_VERSION = 'platex-v1';

const PROCESSOR_CODE = `
class PlatexProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'tension', defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'size',    defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'energy',  defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'metal',   defaultValue: 0.25, minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.55, minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.25, minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth',  defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const scale = this.sr / 44100;

    // 4 allpass diffusers (series)
    this.apLens = [
      Math.round(113 * scale),
      Math.round(337 * scale),
      Math.round(509 * scale),
      Math.round(677 * scale),
    ];
    this.apBufL = []; this.apBufR = [];
    this.apPos = [];
    const maxAp = Math.round(800 * scale) + 16;
    for (let i = 0; i < 4; i++) {
      this.apBufL.push(new Float32Array(maxAp));
      this.apBufR.push(new Float32Array(maxAp));
      this.apPos.push(0);
    }

    // 2 parallel comb filters with crossfeed
    this.combLens = [
      Math.round(1559 * scale),
      Math.round(1907 * scale),
    ];
    this.combBufL = []; this.combBufR = [];
    this.combPos = [];
    this.combLpL = [0, 0]; this.combLpR = [0, 0];
    const maxComb = Math.round(2500 * scale) + 16;
    for (let i = 0; i < 2; i++) {
      this.combBufL.push(new Float32Array(maxComb));
      this.combBufR.push(new Float32Array(maxComb));
      this.combPos.push(0);
    }

    // Envelope follower for energy
    this.envLevel = 0;

    // Resonant peak filter state (2 biquad bandpasses for metal character)
    // Modal frequencies roughly: 2400Hz and 4800Hz (plate modes)
    this.bp1L = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bp1R = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bp2L = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bp2R = { x1: 0, x2: 0, y1: 0, y2: 0 };

    // Tilt EQ
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Mid-side width
    this.prevMid = 0; this.prevSide = 0;

    // Metering
    this._peak = 0;
    this._energy = 0;
    this._plateLevel = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  biquadBP(state, x, freq, q) {
    const sr = this.sr;
    const w0 = 2 * Math.PI * freq / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    const y = (b0 * x + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2) / a0;
    state.x2 = state.x1; state.x1 = x;
    state.y2 = state.y1; state.y1 = y;
    return y;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const tension = params.tension[0];
    const size    = params.size[0];
    const energy  = params.energy[0];
    const metal   = params.metal[0];
    const tone    = params.tone[0];
    const mix     = params.mix[0];
    const bypass  = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;
    let plateAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._energy = 0; this._plateLevel = 0;
      this.port.postMessage({ peak: peakAccum, energy: 0, plateLevel: 0 });
      return true;
    }

    // Allpass coefficient: tension controls tightness
    const baseApG = 0.28 + tension * 0.38;

    // Comb feedback: size controls ring time — capped lower to prevent blowup
    const baseCombFb = 0.60 + size * 0.18; // max 0.78 before energy mod

    // Size also scales comb delay
    const sizeScale = 0.7 + size * 0.6;

    // Damping
    const dampFreq = 3000 + tone * 10000;
    const dampCoef = Math.exp(-2 * Math.PI * dampFreq / sr);

    // Crossfeed between combs — reduced so fb+crossfeed stays well below 1.0
    const crossfeed = 0.06 + metal * 0.05;

    // Tilt EQ
    const tiltFreq = 800;
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);
    const tiltGainLow = 1 + (0.5 - tone) * 1.4;
    const tiltGainHigh = 1 + (tone - 0.5) * 1.4;

    // Metal resonant peak frequencies
    const metalFreq1 = 2400 + metal * 800;
    const metalFreq2 = 4800 + metal * 1200;
    const metalQ = 2 + metal * 8;

    // Envelope follower time constants
    const envAttack = Math.exp(-1 / (sr * 0.005));
    const envRelease = Math.exp(-1 / (sr * 0.15));

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];

      // Envelope follower
      const inLevel = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (inLevel > this.envLevel) {
        this.envLevel = envAttack * this.envLevel + (1 - envAttack) * inLevel;
      } else {
        this.envLevel = envRelease * this.envLevel + (1 - envRelease) * inLevel;
      }

      // Energy modulation: increase feedback on loud hits
      const energyMod = this.envLevel * energy * 0.08;
      const dynCombFb = Math.min(0.88, baseCombFb + energyMod);
      const dynApG = Math.min(0.72, baseApG + energyMod * 0.2);

      // 4 allpass diffusers in series
      let diffL = dryL, diffR = dryR;
      for (let a = 0; a < 4; a++) {
        const len = this.apLens[a];
        const bs = this.apBufL[a].length;
        const pos = this.apPos[a];
        const readIdx = (pos - len + bs) % bs;
        const delL = this.apBufL[a][readIdx];
        const delR = this.apBufR[a][readIdx];

        const outL = -dynApG * diffL + delL;
        const outR = -dynApG * diffR + delR;
        this.apBufL[a][pos] = diffL + dynApG * delL;
        this.apBufR[a][pos] = diffR + dynApG * delR;
        this.apPos[a] = (pos + 1) % bs;

        diffL = outL;
        diffR = outR;
      }

      // 2 parallel comb filters with crossfeed
      let plateL = 0, plateR = 0;
      const combOuts = [{ l: 0, r: 0 }, { l: 0, r: 0 }];

      for (let c = 0; c < 2; c++) {
        const len = Math.round(this.combLens[c] * sizeScale);
        const bs = this.combBufL[c].length;
        const pos = this.combPos[c];
        const readIdx = (pos - len + bs) % bs;
        let cL = this.combBufL[c][readIdx];
        let cR = this.combBufR[c][readIdx];

        // LP damping
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * cL;
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * cR;
        cL = this.combLpL[c];
        cR = this.combLpR[c];

        combOuts[c].l = cL;
        combOuts[c].r = cR;
      }

      // Write with crossfeed
      for (let c = 0; c < 2; c++) {
        const otherC = 1 - c;
        const len = Math.round(this.combLens[c] * sizeScale);
        const bs = this.combBufL[c].length;
        const pos = this.combPos[c];

        this.combBufL[c][pos] = diffL + combOuts[c].l * dynCombFb + combOuts[otherC].l * crossfeed;
        this.combBufR[c][pos] = diffR + combOuts[c].r * dynCombFb + combOuts[otherC].r * crossfeed;
        this.combPos[c] = (pos + 1) % bs;

        plateL += combOuts[c].l;
        plateR += combOuts[c].r;
      }

      plateL *= 0.5;
      plateR *= 0.5;

      // Metal character: add resonant peaks
      if (metal > 0.05) {
        const res1L = this.biquadBP(this.bp1L, plateL, metalFreq1, metalQ);
        const res1R = this.biquadBP(this.bp1R, plateR, metalFreq1, metalQ);
        const res2L = this.biquadBP(this.bp2L, plateL, metalFreq2, metalQ);
        const res2R = this.biquadBP(this.bp2R, plateR, metalFreq2, metalQ);
        plateL += (res1L + res2L) * metal * 0.3;
        plateR += (res1R + res2R) * metal * 0.3;
      }

      // Tilt EQ
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * plateL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * plateR;
      const lowL = this.tiltLpL, lowR = this.tiltLpR;
      const highL = plateL - lowL, highR = plateR - lowR;
      let wetL = lowL * tiltGainLow + highL * tiltGainHigh;
      let wetR = lowR * tiltGainLow + highR * tiltGainHigh;

      // Soft limit wet before mix — safety net against any remaining runaway
      wetL = Math.tanh(wetL * 0.85) * 1.1;
      wetR = Math.tanh(wetR * 0.85) * 1.1;

      // Smooth LP filter on wet signal
      const smooth = params.smooth[0];
      if (smooth > 0.5) {
        const smoothFreq = 6500 - smooth * 900;
        const smoothCoef = Math.exp(-2 * Math.PI * smoothFreq / sr);
        this.smoothLpL1 = smoothCoef * this.smoothLpL1 + (1 - smoothCoef) * wetL;
        this.smoothLpR1 = smoothCoef * this.smoothLpR1 + (1 - smoothCoef) * wetR;
        this.smoothLpL2 = smoothCoef * this.smoothLpL2 + (1 - smoothCoef) * this.smoothLpL1;
        this.smoothLpR2 = smoothCoef * this.smoothLpR2 + (1 - smoothCoef) * this.smoothLpR1;
        wetL = this.smoothLpL2;
        wetR = this.smoothLpR2;
      }

      // Mix
      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const pl = Math.max(Math.abs(wetL), Math.abs(wetR));
      if (pl > plateAccum) plateAccum = pl;
      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._energy = this.envLevel;
    this._plateLevel = plateAccum;
    this.port.postMessage({ peak: peakAccum, energy: this.envLevel, plateLevel: plateAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', PlatexProcessor);
`;

export async function createPlatexEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input = audioCtx.createGain(), output = audioCtx.createGain(), chainOutput = audioCtx.createGain();
  const inputTrim = audioCtx.createGain(), outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });

  const analyserIn = audioCtx.createAnalyser(); analyserIn.fftSize = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim); inputTrim.connect(analyserIn); analyserIn.connect(worklet);
  worklet.connect(analyserOut); analyserOut.connect(outputTrim);
  outputTrim.connect(output); outputTrim.connect(chainOutput);

  let _peak = 0, _energy = 0, _plateLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.energy !== undefined) _energy = e.data.energy;
    if (e.data?.plateLevel !== undefined) _plateLevel = e.data.plateLevel;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setTension: v => { p('tension').value = v; },
    setSize:    v => { p('size').value    = v; },
    setEnergy:  v => { p('energy').value  = v; },
    setMetal:   v => { p('metal').value   = v; },
    setTone:    v => { p('tone').value    = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },
    setSmooth:  v => { p('smooth').value  = v; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getEnergy: () => _energy,
    getPlateLevel: () => _plateLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
