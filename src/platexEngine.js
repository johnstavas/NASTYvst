// platexEngine.js — PLATEX: Modern Dynamic Plate Reverb (v2)
//
// 8 parallel comb filters (Freeverb-style density) with per-comb LFO modulation
// for the characteristic plate shimmer/flutter. True stereo via L/R offset delay
// lengths. 4 series allpass diffusers before combs + 2 post-diffusion allpasses.
// Tension shifts plate modal frequencies. Energy envelope drives dynamic feedback.
// Metal adds resonant biquad peaks at harmonically-related plate modes.
//
// Controls:
//   TENSION — allpass coeff + modal freq (plate tightness)
//   SIZE    — comb delay scale / ring time
//   ENERGY  — transient-driven dynamic feedback boost
//   METAL   — resonant peak character + crossfeed
//   TONE    — tilt EQ (dark→bright)
//   MIX     — dry/wet
//   BYPASS / SMOOTH

const PROCESSOR_VERSION = 'platex-v2';

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
    const sc = this.sr / 44100;

    // 4 allpass diffusers (series, pre-comb)
    this.apLens = [556, 441, 341, 225].map(l => Math.round(l * sc));
    this.apBufL = this.apLens.map(l => new Float32Array(l + 16));
    this.apBufR = this.apLens.map(l => new Float32Array(l + 16));
    this.apPos  = new Int32Array(4);

    // 2 post-diffusion allpasses (smooth the tail)
    this.apPostLens = [89, 61].map(l => Math.round(l * sc));
    this.apPostBufL = this.apPostLens.map(l => new Float32Array(l + 16));
    this.apPostBufR = this.apPostLens.map(l => new Float32Array(l + 16));
    this.apPostPos  = new Int32Array(2);

    // 8 comb filters — L and R have offset lengths for stereo decorrelation
    this.combLensL = [1116,1188,1277,1356,1422,1491,1557,1617].map(l => Math.round(l * sc));
    this.combLensR = [1139,1211,1300,1379,1445,1514,1580,1640].map(l => Math.round(l * sc));
    const maxComb  = Math.round(2300 * sc) + 32;
    this.combBufL  = Array.from({length:8}, () => new Float32Array(maxComb));
    this.combBufR  = Array.from({length:8}, () => new Float32Array(maxComb));
    this.combPos   = new Int32Array(8);
    this.combLpL   = new Float64Array(8);
    this.combLpR   = new Float64Array(8);

    // Per-comb LFO (updated once per block — no per-sample Math.sin)
    this.lfoPhase = new Float64Array(8);
    this.lfoRates = [0.23, 0.31, 0.17, 0.37, 0.21, 0.29, 0.13, 0.41];
    this.lfoVal   = new Float64Array(8);

    // Temp output buffers (avoid GC allocation in process loop)
    this._cL = new Float64Array(8);
    this._cR = new Float64Array(8);

    // Envelope follower
    this.envLevel = 0;

    // Metallic resonant biquad BPs (2 per channel)
    this.bp1L = {x1:0,x2:0,y1:0,y2:0};
    this.bp1R = {x1:0,x2:0,y1:0,y2:0};
    this.bp2L = {x1:0,x2:0,y1:0,y2:0};
    this.bp2R = {x1:0,x2:0,y1:0,y2:0};

    // Tilt EQ LP state
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Smooth LP state
    this.sLpL1 = 0; this.sLpR1 = 0;
    this.sLpL2 = 0; this.sLpR2 = 0;

    // Metering
    this._peak = 0; this._energy = 0; this._plateLevel = 0;

    this.port.postMessage({ ready: true });
  }

  biquadBP(s, x, freq, q) {
    const w0 = 2 * Math.PI * freq / this.sr;
    const sinw = Math.sin(w0), cosw = Math.cos(w0);
    const alpha = sinw / (2 * q);
    const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2*cosw, a2 = 1 - alpha;
    const y = (b0*x + b2*s.x2 - a1*s.y1 - a2*s.y2) / a0;
    s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
    return y;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0], outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];
    const N  = iL.length;

    const tension = params.tension[0];
    const size    = params.size[0];
    const energy  = params.energy[0];
    const metal   = params.metal[0];
    const tone    = params.tone[0];
    const mix     = params.mix[0];
    const bypass  = params.bypass[0] > 0.5;
    const smooth  = params.smooth[0];
    const sr      = this.sr;

    let peakAccum = 0, plateAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < N; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._energy = 0; this._plateLevel = 0;
      this.port.postMessage({ peak: peakAccum, energy: 0, plateLevel: 0 });
      return true;
    }

    // Allpass coeff — tension controls diffusion tightness
    const baseApG = 0.30 + tension * 0.35; // 0.30–0.65

    // Comb feedback — size controls decay ring time
    const baseCombFb = 0.72 + size * 0.18; // 0.72–0.90

    // Size also scales all comb delay lengths
    const sizeScale = 0.65 + size * 0.70; // 0.65–1.35

    // LFO depth — looser plate (low tension) flutters more
    const lfoDepth = 3 + (1 - tension) * 9; // 3–12 samples

    // Update per-comb LFO values once per block (8 Math.sin calls total)
    for (let c = 0; c < 8; c++) {
      this.lfoPhase[c] += this.lfoRates[c] * N / sr;
      if (this.lfoPhase[c] > 1) this.lfoPhase[c] -= 1;
      this.lfoVal[c] = Math.sin(this.lfoPhase[c] * 6.283185) * lfoDepth;
    }

    // LP damping — tone sweeps from dark to bright
    const dampFreq = 2500 + tone * 12000;
    const dampCoef = Math.exp(-6.283185 * dampFreq / sr);

    // Tilt EQ coefficients
    const tiltCoef      = Math.exp(-6.283185 * 800 / sr);
    const tiltGainLow   = 1 + (0.5 - tone) * 1.5;
    const tiltGainHigh  = 1 + (tone - 0.5) * 1.5;

    // Metallic resonant peak frequencies — tension shifts plate modes
    const mFreq1 = 1800 + tension * 1400 + metal * 800;
    const mFreq2 = 3600 + tension * 2800 + metal * 1200;
    const mQ     = 1.5 + metal * 10;

    // Envelope timing
    const envAtk = Math.exp(-1 / (sr * 0.004));
    const envRel = Math.exp(-1 / (sr * 0.12));

    // L→R crossfeed inside combs (metal increases coupling, adds shimmer)
    const crossfeed = 0.03 + metal * 0.07;

    const cL = this._cL;
    const cR = this._cR;
    const maxBuf = this.combBufL[0].length;

    for (let n = 0; n < N; n++) {
      const dryL = iL[n], dryR = iR[n];

      // Envelope follower
      const inLvl = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (inLvl > this.envLevel) {
        this.envLevel = envAtk * this.envLevel + (1 - envAtk) * inLvl;
      } else {
        this.envLevel = envRel * this.envLevel + (1 - envRel) * inLvl;
      }

      // Dynamic feedback boost on loud transients (ENERGY knob)
      const eMod   = this.envLevel * energy * 0.07;
      const dynFb  = Math.min(0.92, baseCombFb + eMod);
      const dynApG = Math.min(0.68, baseApG + this.envLevel * energy * 0.08);

      // ── 4 allpass diffusers (series) ──────────────────────────────────────
      let diffL = dryL, diffR = dryR;
      for (let a = 0; a < 4; a++) {
        const bs  = this.apBufL[a].length;
        const pos = this.apPos[a];
        const ri  = (pos - this.apLens[a] + bs) % bs;
        const dL  = this.apBufL[a][ri], dR = this.apBufR[a][ri];
        const oaL = -dynApG * diffL + dL;
        const oaR = -dynApG * diffR + dR;
        this.apBufL[a][pos] = diffL + dynApG * dL;
        this.apBufR[a][pos] = diffR + dynApG * dR;
        this.apPos[a] = (pos + 1) % bs;
        diffL = oaL; diffR = oaR;
      }

      // ── Read all 8 comb outputs ───────────────────────────────────────────
      for (let c = 0; c < 8; c++) {
        const bs  = this.combBufL[c].length;
        const pos = this.combPos[c];
        const lfoV = this.lfoVal[c];
        const lenL = Math.max(64, Math.min(bs - 8, Math.round(this.combLensL[c] * sizeScale + lfoV)));
        const lenR = Math.max(64, Math.min(bs - 8, Math.round(this.combLensR[c] * sizeScale + lfoV * 0.87)));
        const riL  = (pos - lenL + bs) % bs;
        const riR  = (pos - lenR + bs) % bs;
        // LP damping inside feedback loop
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * this.combBufL[c][riL];
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * this.combBufR[c][riR];
        cL[c] = this.combLpL[c];
        cR[c] = this.combLpR[c];
      }

      // ── Write all 8 combs (adjacent-pair crossfeed for metallic coupling) ─
      let plateL = 0, plateR = 0;
      for (let c = 0; c < 8; c++) {
        const bs   = this.combBufL[c].length;
        const pos  = this.combPos[c];
        const xc   = (c % 2 === 0) ? (c + 1) : (c - 1); // adjacent partner
        this.combBufL[c][pos] = diffL + cL[c] * dynFb + cL[xc] * crossfeed;
        this.combBufR[c][pos] = diffR + cR[c] * dynFb + cR[xc] * crossfeed;
        this.combPos[c] = (pos + 1) % bs;
        plateL += cL[c];
        plateR += cR[c];
      }

      // Normalize 8 combs
      plateL *= 0.125;
      plateR *= 0.125;

      // ── 2 post-diffusion allpasses (smooth the tail) ──────────────────────
      for (let a = 0; a < 2; a++) {
        const bs  = this.apPostBufL[a].length;
        const pos = this.apPostPos[a];
        const ri  = (pos - this.apPostLens[a] + bs) % bs;
        const dL  = this.apPostBufL[a][ri], dR = this.apPostBufR[a][ri];
        const g   = 0.5;
        const oaL = -g * plateL + dL;
        const oaR = -g * plateR + dR;
        this.apPostBufL[a][pos] = plateL + g * dL;
        this.apPostBufR[a][pos] = plateR + g * dR;
        this.apPostPos[a] = (pos + 1) % bs;
        plateL = oaL; plateR = oaR;
      }

      // ── Metal character: resonant biquad peaks at plate mode freqs ────────
      if (metal > 0.05) {
        const r1L = this.biquadBP(this.bp1L, plateL, mFreq1, mQ);
        const r1R = this.biquadBP(this.bp1R, plateR, mFreq1, mQ);
        const r2L = this.biquadBP(this.bp2L, plateL, mFreq2, mQ);
        const r2R = this.biquadBP(this.bp2R, plateR, mFreq2, mQ);
        plateL += (r1L + r2L) * metal * 0.25;
        plateR += (r1R + r2R) * metal * 0.25;
      }

      // ── Tilt EQ ───────────────────────────────────────────────────────────
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * plateL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * plateR;
      let wetL = this.tiltLpL * tiltGainLow + (plateL - this.tiltLpL) * tiltGainHigh;
      let wetR = this.tiltLpR * tiltGainLow + (plateR - this.tiltLpR) * tiltGainHigh;

      // Soft limiting
      wetL = Math.tanh(wetL * 0.85) * 1.15;
      wetR = Math.tanh(wetR * 0.85) * 1.15;

      // ── Smooth LP ─────────────────────────────────────────────────────────
      if (smooth > 0.5) {
        const sCoef = Math.exp(-6.283185 * (6500 - smooth * 900) / sr);
        this.sLpL1 = sCoef * this.sLpL1 + (1 - sCoef) * wetL;
        this.sLpR1 = sCoef * this.sLpR1 + (1 - sCoef) * wetR;
        this.sLpL2 = sCoef * this.sLpL2 + (1 - sCoef) * this.sLpL1;
        this.sLpR2 = sCoef * this.sLpR2 + (1 - sCoef) * this.sLpR1;
        wetL = this.sLpL2; wetR = this.sLpR2;
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

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim); inputTrim.connect(analyserIn); analyserIn.connect(worklet);
  worklet.connect(analyserOut); analyserOut.connect(outputTrim);
  outputTrim.connect(output); outputTrim.connect(chainOutput);

  let _peak = 0, _energy = 0, _plateLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak        !== undefined) _peak        = e.data.peak;
    if (e.data?.energy      !== undefined) _energy      = e.data.energy;
    if (e.data?.plateLevel  !== undefined) _plateLevel  = e.data.plateLevel;
  };

  const _buf = new Float32Array(2048);
  function getRms(an)  { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setTension: v => { p('tension').value = v; },
    setSize:    v => { p('size').value    = v; },
    setEnergy:  v => { p('energy').value  = v; },
    setMetal:   v => { p('metal').value   = v; },
    setTone:    v => { p('tone').value    = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },
    setSmooth:  v => { p('smooth').value  = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn;  },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getEnergy:      () => _energy,
    getPlateLevel:  () => _plateLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose()  { this.destroy(); },
  };
}
