// nearfarEngine.js — NEARFAR: Distance Designer
// Full psychoacoustic distance processor based on spec.
// Distance = spatial redistribution, NOT volume loss.

const PROCESSOR_VERSION = 'nearfar-v18';

const PROCESSOR_CODE = `
class NearFarProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'distance', defaultValue: 45,  minValue: 0,   maxValue: 100 },
      { name: 'room',     defaultValue: 35,  minValue: 0,   maxValue: 100 },
      { name: 'focus',    defaultValue: 65,  minValue: 0,   maxValue: 100 },
      { name: 'airLoss',  defaultValue: 35,  minValue: 0,   maxValue: 100 },
      { name: 'tail',     defaultValue: 25,  minValue: 0,   maxValue: 100 },
      { name: 'mix',      defaultValue: 100, minValue: 0,   maxValue: 100 },
      { name: 'bypass',   defaultValue: 0,   minValue: 0,   maxValue: 1   },
      { name: 'smooth',   defaultValue: 0,   minValue: 0,   maxValue: 5   },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const sr = this.sr;

    // ── Per-block parameter smoothing state ───────────────────────────────
    this._sd = 0.45; this._sr = 0.35; this._sf = 0.65;
    this._sa = 0.35; this._st = 0.25; this._sm = 1.0;

    // ── Early Reflection Engine ───────────────────────────────────────────
    // Near taps (ms): 8, 14, 21   Far taps (ms): 12, 20, 31, 45, 62
    this.erMaxLen = Math.ceil(sr * 0.08);
    this.erBufL = new Float32Array(this.erMaxLen);
    this.erBufR = new Float32Array(this.erMaxLen);
    this.erWritePos = 0;

    // 5 tap slots — interpolate near→far tap times
    this.nearTapsMs = [8, 14, 21, 21, 21];   // near: 3 real taps, pad last two
    this.farTapsMs  = [12, 20, 31, 45, 62];  // far: 5 real taps
    this.numTaps = 5;
    this.tapPans = [0.3, -0.4, 0.2, -0.6, 0.5]; // alternating L/R spread

    // Current tap delay samples (smoothly updated)
    this.tapDelaySamples = this.farTapsMs.map(ms => Math.round(ms * sr / 1000));
    // Target tap delays (what we're crossfading toward)
    this.tapDelayTarget  = [...this.tapDelaySamples];
    // Crossfade counter for tap position changes (50ms = ~2200 samples)
    this.tapXfadeLen = Math.round(sr * 0.05);
    this.tapXfadePos = 0;
    this.tapXfading = false;
    this.tapDelayOld = [...this.tapDelaySamples];

    // One-pole LP per tap
    this.tapLpState = new Float32Array(this.numTaps);

    // ── Nested Allpass Tail (Schroeder 1962 nested structure) ────────────
    // Structure: large outer allpass whose internal delay element passes
    // the signal through a chain of 5 inner allpass stages before writing.
    // Each loop around the outer delay, the signal gets another pass through
    // the inner chain → echo density INCREASES over time.
    // This is the architecture that separates Lexicon from a plate reverb.
    const scale = sr / 44100;

    // Outer delay: controls room size / reverb time (~27ms..90ms)
    this.naOuterMaxLen = Math.ceil(sr * 0.095);
    this.naOuterBufL   = new Float32Array(this.naOuterMaxLen);
    this.naOuterBufR   = new Float32Array(this.naOuterMaxLen);
    this.naOuterIdxL   = 0;
    this.naOuterIdxR   = 0;

    // 5 inner allpass stages — coprime delays, L/R slightly detuned for
    // natural stereo width without any extra width processing
    this.naInnerLens = [
      [142, 107, 379, 277, 188].map(n => Math.round(n * scale)), // L
      [153, 113, 397, 283, 197].map(n => Math.round(n * scale)), // R
    ];
    this.naInnerMaxLen = Math.round(450 * scale);
    this.naInnerBufs = [
      [0,1,2,3,4].map(() => new Float32Array(this.naInnerMaxLen)), // L stages
      [0,1,2,3,4].map(() => new Float32Array(this.naInnerMaxLen)), // R stages
    ];
    this.naInnerIdxs = [new Int32Array(5), new Int32Array(5)];

    // ── Spectral Distance Filter state ────────────────────────────────────
    // Biquad for presence dip (3200 Hz peak cut)
    this.presL = [0, 0]; this.presR = [0, 0]; // z1, z2
    this.presCoeffs = this._calcPeakCoeffs(3200, 0.5, 0.0); // recomputed per block

    // One-pole high shelf for air loss (7kHz shelf)
    this.airShelfL = 0; this.airShelfR = 0;

    // ── Focus Recovery biquad (2kHz bell boost) ───────────────────────────
    this.focL = [0, 0]; this.focR = [0, 0];
    this.focCoeffs = this._calcPeakCoeffs(2000, 0.6, 0.0);

    // ── Pre-delay buffer (0..60ms bloom gap) ─────────────────────────────
    // Gap between direct sound and when the room blooms in.
    // Near=5ms, Far=50ms. Brain uses this gap to perceive room size.
    this.preDelayMaxLen = Math.ceil(sr * 0.065);
    this.preDelayBufL = new Float32Array(this.preDelayMaxLen);
    this.preDelayBufR = new Float32Array(this.preDelayMaxLen);
    this.preDelayIdx  = 0;
    this.preDelaySamples = Math.round(0.005 * sr); // init at 5ms

    // ── Bloom envelope (wet onset swell) ──────────────────────────────────
    // Wet signal ramps up slowly after each transient — room "breathes open"
    this.bloomEnv  = 0.0;
    this.bloomAtt  = Math.exp(-1 / (sr * 0.025)); // 25ms attack (slow bloom in)
    this.bloomRel  = Math.exp(-1 / (sr * 0.200)); // 200ms release (room sustains)

    // ── Micro Smear delay buffers (max 512 samples) ───────────────────────
    this.smearMaxLen = 512;
    this.smearBufL = new Float32Array(this.smearMaxLen);
    this.smearBufR = new Float32Array(this.smearMaxLen);
    this.smearIdxL = 0;
    this.smearIdxR = 0;

    // ── Smooth LP filter state (for SMOOTH button) ────────────────────────
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    // ── Auto-smooth LP state (distance-driven, always active) ─────────────
    // Scales from transparent (d=0) to ~3kHz 2-pole LP (d=1)
    // Bakes the "10x smooth" feel into the wet path automatically with distance
    this.autoSmL1 = 0; this.autoSmR1 = 0;
    this.autoSmL2 = 0; this.autoSmR2 = 0;

    // ── Transient detector state ──────────────────────────────────────────
    this.envFast = 0;
    this.envSlow = 0;
    // time constants
    this.fastAtt = Math.exp(-1 / (sr * 0.0001));
    this.fastRel = Math.exp(-1 / (sr * 0.03));
    this.slowAtt = Math.exp(-1 / (sr * 0.01));
    this.slowRel = Math.exp(-1 / (sr * 0.15));

    // ── Loudness / energy normalizer state ───────────────────────────────
    // Simple one-pole smoothed RMS for input and wet
    this.inputRmsSmooth  = 0;
    this.wetRmsSmooth    = 0;
    this.rmsAlpha = Math.exp(-1 / (sr * 0.1)); // 100ms RMS window

    this._peak = 0;

    this.port.postMessage({ ready: true });
  }

  // ── Biquad peak/notch coefficient calculator ────────────────────────────
  // gainDb > 0 = boost, < 0 = cut
  _calcPeakCoeffs(freq, Q, gainDb) {
    const sr = this.sr;
    const A  = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * freq / sr;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);
    const b0 =  1 + alpha * A;
    const b1 = -2 * cosw0;
    const b2 =  1 - alpha * A;
    const a0 =  1 + alpha / A;
    const a1 = -2 * cosw0;
    const a2 =  1 - alpha / A;
    return [b0/a0, b1/a0, b2/a0, a1/a0, a2/a0]; // [b0,b1,b2,a1,a2]
  }

  // ── Apply biquad to a sample ─────────────────────────────────────────────
  _biquad(x, state, c) {
    const y = c[0]*x + c[1]*state[0] + c[2]*state[1] - c[3]*state[0] - c[4]*state[1];
    // Direct Form I: needs x history too — use transposed form II instead
    // Transposed form II:
    const yn = c[0]*x + state[0];
    state[0] = c[1]*x - c[3]*yn + state[1];
    state[1] = c[2]*x - c[4]*yn;
    return yn;
  }

  // ── One-pole high shelf ──────────────────────────────────────────────────
  // Approximate: split into LP + passthrough, attenuate HF
  _highShelf(x, state, cutoff, gainLinear) {
    // LP portion
    const lp = state + cutoff * (x - state);
    // HF = x - lp, attenuate, recombine
    return lp + (x - lp) * gainLinear;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];
    const N  = iL.length;
    const sr = this.sr;

    const bypass = params.bypass[0] > 0.5;
    if (bypass) {
      for (let n = 0; n < N; n++) { oL[n] = iL[n]; oR[n] = iR[n]; }
      this.port.postMessage({ peak: 0, transient: 0 });
      return true;
    }

    // ── Block-level parameter smoothing ────────────────────────────────
    const PS = 0.85;
    this._sd = PS * this._sd + (1-PS) * (params.distance[0] / 100);
    this._sr = PS * this._sr + (1-PS) * (params.room[0]     / 100);
    this._sf = PS * this._sf + (1-PS) * (params.focus[0]    / 100);
    this._sa = PS * this._sa + (1-PS) * (params.airLoss[0]  / 100);
    this._st = PS * this._st + (1-PS) * (params.tail[0]     / 100);
    this._sm = PS * this._sm + (1-PS) * (params.mix[0]      / 100);

    const d = this._sd, r = this._sr, f = this._sf;
    const a = this._sa, t = this._st, m = this._sm;

    // ── Derived gains ───────────────────────────────────────────────────
    // Direct: the KEY to distance — reduce direct by up to -12dB at full distance.
    // This shifts the DRR (direct-to-reverberant ratio) which is the primary
    // psychoacoustic distance cue. Early reflections fill the gap.
    const directGain  = Math.pow(10, d * -12.0 / 20);  // 0dB→-12dB

    // Early reflections rise to fill the energy gap left by direct reduction.
    // At d=1: earlyGain can exceed 1.0 — this is correct, room dominates.
    const earlyGain   = (0.3 + d * 0.9) * (0.5 + r * 0.5);

    // Tail supports room size, stays tucked behind earlys
    const tailGain    = d * t * 0.5;

    const smearAmt    = d * 0.35;
    const transAmt    = d * 0.55;                       // stronger transient softening
    const presenceDip = d * (1.0 - f) * 0.85;          // deeper presence cut
    const airAmt      = d * a;
    const focusAmt    = f * d;
    const width       = 1.05 + d * (0.88 - 1.05);      // slightly wider at distance

    // ── Update spectral filter coefficients ────────────────────────────
    // Presence dip: -8dB max at 3200Hz — makes source step back, not just get dark
    const presGainDb = presenceDip * -8.0;
    this.presCoeffs = this._calcPeakCoeffs(3200, 0.5, presGainDb);

    // Focus recovery: up to +3dB bell at 2kHz restores intelligibility
    const focGainDb  = focusAmt * 3.0;
    this.focCoeffs  = this._calcPeakCoeffs(2000, 0.6, focGainDb);

    // Air loss: shelf at 4kHz (not 7kHz — more audible), -10dB max
    // This is what makes distant sounds feel like they're behind air/atmosphere
    const airShelfGain   = Math.pow(10, -airAmt * 10.0 / 20);
    const airShelfCutoff = 1.0 - Math.exp(-2 * Math.PI * 4000 / sr);

    // ── Pre-delay: bloom gap between direct and room ───────────────────
    // Near=5ms, Far=50ms (scaled by room size too — bigger room = longer gap)
    const preDelayMs = 5 + d * 45 * (0.4 + r * 0.6);
    this.preDelaySamples = Math.min(
      Math.round(preDelayMs * sr / 1000),
      this.preDelayMaxLen - 2
    );

    // ── Nested allpass decay coefficient ──────────────────────────────
    // gOuter controls reverb time: near/low-tail = short, far/high-tail = lush
    // Must stay < 1.0 for stability. At 0.88 = very long, organic decay.
    const gOuter = Math.min(0.88, 0.25 + t * 0.50 + d * 0.13);
    // Outer delay length = room size in samples (bigger room = longer pre-echo)
    const scale = sr / 44100;
    const naOuterDelay = Math.min(
      Math.round((1200 + r * 1800 + d * 600) * scale),
      this.naOuterMaxLen - 2
    );

    // ── Update early reflection tap targets ────────────────────────────
    // Interpolate near→far tap times based on distance
    let needXfade = false;
    for (let i = 0; i < this.numTaps; i++) {
      const ms = this.nearTapsMs[i] + d * (this.farTapsMs[i] - this.nearTapsMs[i]);
      const newTarget = Math.min(Math.round(ms * sr / 1000), this.erMaxLen - 2);
      if (newTarget !== this.tapDelayTarget[i]) {
        if (!this.tapXfading) needXfade = true;
        this.tapDelayTarget[i] = newTarget;
      }
    }
    if (needXfade) {
      this.tapDelayOld = [...this.tapDelaySamples];
      this.tapXfadePos = 0;
      this.tapXfading  = true;
    }

    // Tap LP cutoff: lerp 18kHz→8kHz with distance
    const tapLpCutoff = 1.0 - Math.exp(-2 * Math.PI * (18000 - d * 10000) / sr);

    // ── Per-sample smoother for MIX ─────────────────────────────────────
    const smC = Math.exp(-1 / (sr * 0.005));
    let smMix = this._sm;

    // ── Accumulate input perceived energy (RMS proxy) ──────────────────
    let inputSqAcc = 0, wetSqAcc = 0;
    let peakAccum = 0, transAccum = 0;

    // Scratch arrays
    const dirL = new Float32Array(N), dirR = new Float32Array(N);
    const erL  = new Float32Array(N), erR  = new Float32Array(N);
    const tlL  = new Float32Array(N), tlR  = new Float32Array(N);
    const smrL = new Float32Array(N), smrR = new Float32Array(N);

    for (let n = 0; n < N; n++) {
      const dryL = iL[n], dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;
      const monoAbs = Math.abs(mono);
      inputSqAcc += monoAbs * monoAbs;

      // ── Transient detection ──────────────────────────────────────────
      if (monoAbs > this.envFast)
        this.envFast = this.fastAtt * this.envFast + (1-this.fastAtt) * monoAbs;
      else
        this.envFast = this.fastRel * this.envFast;

      if (monoAbs > this.envSlow)
        this.envSlow = this.slowAtt * this.envSlow + (1-this.slowAtt) * monoAbs;
      else
        this.envSlow = this.slowRel * this.envSlow;

      const transient = Math.max(0, this.envFast - this.envSlow * 1.2);
      transAccum += transient;

      // ── DIRECT PATH ─────────────────────────────────────────────────
      // Start with full dry, apply modest direct reduction
      let dL = dryL * directGain;
      let dR = dryR * directGain;

      // Presence dip (2k-5k center, broad cut, makes source step back)
      dL = this._biquad(dL, this.presL, this.presCoeffs);
      dR = this._biquad(dR, this.presR, this.presCoeffs);

      // Air loss: high shelf attenuation
      const newAirL = this.airShelfL + airShelfCutoff * (dL - this.airShelfL);
      dL = newAirL + (dL - newAirL) * airShelfGain;
      this.airShelfL = newAirL;

      const newAirR = this.airShelfR + airShelfCutoff * (dR - this.airShelfR);
      dR = newAirR + (dR - newAirR) * airShelfGain;
      this.airShelfR = newAirR;

      // Transient softening on direct path only
      const soften = Math.min(0.7, transAmt * transient * 0.5);
      dL *= (1.0 - soften);
      dR *= (1.0 - soften);

      dirL[n] = dL;
      dirR[n] = dR;

      // ── PRE-DELAY: write dry into bloom delay line ───────────────────
      // ER and tail read from this delayed signal — creates bloom gap
      this.preDelayBufL[this.preDelayIdx] = dryL;
      this.preDelayBufR[this.preDelayIdx] = dryR;
      const pdReadIdx = (this.preDelayIdx - this.preDelaySamples + this.preDelayMaxLen) % this.preDelayMaxLen;
      const pdL = this.preDelayBufL[pdReadIdx];
      const pdR = this.preDelayBufR[pdReadIdx];
      this.preDelayIdx = (this.preDelayIdx + 1) % this.preDelayMaxLen;

      // ── EARLY REFLECTIONS ────────────────────────────────────────────
      // Write pre-delayed signal to ER buffer (bloom gap baked in)
      this.erBufL[this.erWritePos] = pdL;
      this.erBufR[this.erWritePos] = pdR;

      let erSumL = 0, erSumR = 0;

      // Advance tap crossfade
      let xfadeBlend = 1.0;
      if (this.tapXfading) {
        xfadeBlend = this.tapXfadePos / this.tapXfadeLen;
        this.tapXfadePos++;
        if (this.tapXfadePos >= this.tapXfadeLen) {
          this.tapXfading = false;
          for (let i = 0; i < this.numTaps; i++)
            this.tapDelaySamples[i] = this.tapDelayTarget[i];
        }
      }

      for (let tap = 0; tap < this.numTaps; tap++) {
        // Interpolate delay position during crossfade
        const dSamp = this.tapXfading
          ? Math.round(this.tapDelayOld[tap] * (1-xfadeBlend) + this.tapDelayTarget[tap] * xfadeBlend)
          : this.tapDelaySamples[tap];

        if (!this.tapXfading) this.tapDelaySamples[tap] = this.tapDelayTarget[tap];

        const readIdx = (this.erWritePos - dSamp + this.erMaxLen) % this.erMaxLen;

        // Per-tap LP
        const rawL = this.erBufL[readIdx];
        const rawR = this.erBufR[readIdx];
        const lpd  = tapLpCutoff;
        this.tapLpState[tap] = this.tapLpState[tap] + lpd * (rawL - this.tapLpState[tap]);
        const tapSampleL = this.tapLpState[tap];
        const tapSampleR = rawR + lpd * (rawR - rawR); // simplified: use same LP value for R

        // Tap gain: decreases with tap index (later taps quieter)
        const tapBaseGain = Math.pow(0.75, tap);
        const tapGain = tapBaseGain * (0.4 + r * 0.6);

        // Pan
        const pan = this.tapPans[tap] * (0.3 + r * 0.7);
        erSumL += tapSampleL * tapGain * (1.0 - pan * 0.5);
        erSumR += tapSampleR * tapGain * (1.0 + pan * 0.5);
      }

      this.erWritePos = (this.erWritePos + 1) % this.erMaxLen;

      erL[n] = erSumL * earlyGain;
      erR[n] = erSumR * earlyGain;

      // ── NESTED ALLPASS TAIL ───────────────────────────────────────────
      // Outer allpass wraps a chain of 5 inner allpass stages.
      // Each revolution around the outer delay adds another pass through
      // the inner chain → density grows, non-repeating, organic decay.
      let tailSumL = 0, tailSumR = 0;

      for (let ch = 0; ch < 2; ch++) {
        const inp        = ch === 0 ? pdL : pdR;
        const outerBuf   = ch === 0 ? this.naOuterBufL  : this.naOuterBufR;
        const outerIdx   = ch === 0 ? this.naOuterIdxL  : this.naOuterIdxR;
        const innerBufs  = this.naInnerBufs[ch];
        const innerIdxs  = this.naInnerIdxs[ch];
        const innerLens  = this.naInnerLens[ch];

        // Read from outer delay (z = what was written naOuterDelay samples ago)
        const rOuter = (outerIdx - naOuterDelay + this.naOuterMaxLen) % this.naOuterMaxLen;
        const z = outerBuf[rOuter];

        // Outer allpass input: v = x + g*z
        const v = inp + gOuter * z;

        // Pass v through 5 inner allpass stages (Schroeder form: y = -g*v + z_i)
        let sig = v;
        for (let i = 0; i < 5; i++) {
          const len  = innerLens[i];
          const wIdx = innerIdxs[i];
          const rIdx = (wIdx - len + this.naInnerMaxLen) % this.naInnerMaxLen;
          const zi   = innerBufs[i][rIdx];
          const vi   = sig + 0.5 * zi;       // inner g = 0.5
          innerBufs[i][wIdx] = vi;
          innerIdxs[i] = (wIdx + 1) % this.naInnerMaxLen;
          sig = -0.5 * vi + zi;              // allpass output
        }

        // Write inner-processed signal into outer delay
        outerBuf[outerIdx] = sig;
        if (ch === 0) this.naOuterIdxL = (outerIdx + 1) % this.naOuterMaxLen;
        else          this.naOuterIdxR = (outerIdx + 1) % this.naOuterMaxLen;

        // Outer allpass output: y = -g*v + z
        const out = -gOuter * v + z;
        if (ch === 0) tailSumL = out;
        else          tailSumR = out;
      }

      tlL[n] = tailSumL * tailGain;
      tlR[n] = tailSumR * tailGain;

      // ── MICRO SMEAR ──────────────────────────────────────────────────
      const leftDelay  = Math.round(smearAmt * 7);  // 0..7 samples
      const rightDelay = Math.round(smearAmt * 10); // 0..10 samples

      this.smearBufL[this.smearIdxL % this.smearMaxLen] = dryL;
      this.smearBufR[this.smearIdxR % this.smearMaxLen] = dryR;
      const smL = this.smearBufL[(this.smearIdxL - leftDelay  + this.smearMaxLen) % this.smearMaxLen];
      const smR = this.smearBufR[(this.smearIdxR - rightDelay + this.smearMaxLen) % this.smearMaxLen];
      this.smearIdxL = (this.smearIdxL + 1) % this.smearMaxLen;
      this.smearIdxR = (this.smearIdxR + 1) % this.smearMaxLen;

      smrL[n] = smL * 0.20 * smearAmt;
      smrR[n] = smR * 0.20 * smearAmt;
    }

    // ── Stereo width (M/S) on each layer + sum wet ──────────────────────
    let peakWet = 0;
    const wetL = new Float32Array(N), wetR = new Float32Array(N);

    for (let n = 0; n < N; n++) {
      // Stereo width per layer
      const applyWidth = (l, r, w) => {
        const mid  = (l + r) * 0.5;
        const side = (l - r) * 0.5;
        return [mid + side * w, mid - side * w];
      };
      const [dL2, dR2]  = applyWidth(dirL[n], dirR[n], width);
      const [eL2, eR2]  = applyWidth(erL[n],  erR[n],  width);
      const [tL2, tR2]  = applyWidth(tlL[n],  tlR[n],  width);
      const [sL2, sR2]  = applyWidth(smrL[n], smrR[n], width);

      // Sum wet
      let wL = dL2 + eL2 + tL2 + sL2;
      let wR = dR2 + eR2 + tR2 + sR2;

      // Focus recovery: bell boost at 2kHz
      wL = this._biquad(wL, this.focL, this.focCoeffs);
      wR = this._biquad(wR, this.focR, this.focCoeffs);

      // Center assist when far + focused
      if (d > 0.5 && f > 0.4) {
        const ca = 1.0 + (d * f - 0.2) * (Math.pow(10, 1.5/20) - 1.0);
        const mid  = (wL + wR) * 0.5 * ca;
        const side = (wL - wR) * 0.5;
        wL = mid + side;
        wR = mid - side;
      }

      // ── Bloom envelope — wet swells in rather than hitting immediately ──
      // Tracks the wet signal energy: slow attack = room breathes open,
      // long release = room sustains after source stops.
      const wetAbs = Math.abs(wL + wR) * 0.5;
      if (wetAbs > this.bloomEnv)
        this.bloomEnv = this.bloomAtt * this.bloomEnv + (1 - this.bloomAtt) * wetAbs;
      else
        this.bloomEnv = this.bloomRel * this.bloomEnv;

      // Scale bloom by distance — near=no bloom, far=full bloom swell
      const bloomDepth = d * 0.7;
      const bloomScale = 1.0 - bloomDepth + bloomDepth * Math.min(1, this.bloomEnv * 8);
      wL *= bloomScale;
      wR *= bloomScale;

      // Soft safety ceiling (pre-normalization)
      wL = Math.tanh(wL * 0.85) * 1.18;
      wR = Math.tanh(wR * 0.85) * 1.18;

      wetL[n] = wL;
      wetR[n] = wR;
      wetSqAcc += wL * wL;
    }

    // ── Energy normalization (safety floor only) ───────────────────────
    // DO NOT fight the DRR shift — that's the distance effect working correctly.
    // Only prevent extreme level collapse (more than -6dB below input).
    // The distance character comes FROM the reduced direct signal.
    const inputRms = Math.sqrt(inputSqAcc / N + 1e-12);
    const wetRms   = Math.sqrt(wetSqAcc   / N + 1e-12);

    this.inputRmsSmooth = this.rmsAlpha * this.inputRmsSmooth + (1-this.rmsAlpha) * inputRms;
    this.wetRmsSmooth   = this.rmsAlpha * this.wetRmsSmooth   + (1-this.rmsAlpha) * wetRms;

    let makeup = 1.0;
    if (this.wetRmsSmooth > 1e-6) {
      const ratio = this.inputRmsSmooth / this.wetRmsSmooth;
      makeup = Math.sqrt(ratio);
      // Only boost if wet collapsed more than 6dB below input — safety floor only
      const maxMakeup = Math.pow(10,  6.0 / 20);  // +6dB max (emergency only)
      const minMakeup = Math.pow(10, -2.0 / 20);  // -2dB min (allow distance to work)
      makeup = Math.max(minMakeup, Math.min(maxMakeup, makeup));
    }

    // ── SMOOTH LP on wet if enabled ─────────────────────────────────────
    const smooth = params.smooth[0];

    // ── Final dry/wet mix + output ──────────────────────────────────────
    for (let n = 0; n < N; n++) {
      let wL = wetL[n] * makeup;
      let wR = wetR[n] * makeup;

      // ── Auto-smooth: distance-driven LP, always on when distance > 0 ──
      // d=0 → 20kHz (transparent), d=0.5 → ~8kHz, d=1.0 → ~2.8kHz
      // Two-pole so it has the same silky feel as SMOOTH 5x
      // Uses exponential curve so most of the effect happens in the upper half
      const autoSmFreq = 20000 * Math.pow(0.14, d);  // 20kHz→2800Hz
      const asc = Math.exp(-2 * Math.PI * autoSmFreq / sr);
      this.autoSmL1 = asc * this.autoSmL1 + (1-asc) * wL;
      this.autoSmR1 = asc * this.autoSmR1 + (1-asc) * wR;
      this.autoSmL2 = asc * this.autoSmL2 + (1-asc) * this.autoSmL1;
      this.autoSmR2 = asc * this.autoSmR2 + (1-asc) * this.autoSmR1;
      wL = this.autoSmL2;
      wR = this.autoSmR2;

      // ── Manual SMOOTH button — extra polish on top ──────────────────
      if (smooth > 0.5) {
        const smoothFreq = 16000 - smooth * 2000;
        const sc = Math.exp(-2 * Math.PI * smoothFreq / sr);
        this.smoothLpL1 = sc * this.smoothLpL1 + (1-sc) * wL;
        this.smoothLpR1 = sc * this.smoothLpR1 + (1-sc) * wR;
        this.smoothLpL2 = sc * this.smoothLpL2 + (1-sc) * this.smoothLpL1;
        this.smoothLpR2 = sc * this.smoothLpR2 + (1-sc) * this.smoothLpR1;
        wL = this.smoothLpL2;
        wR = this.smoothLpR2;
      }

      // Equal-power dry/wet mix
      const dryCoeff = Math.cos(m * Math.PI * 0.5);
      const wetCoeff = Math.sin(m * Math.PI * 0.5);
      oL[n] = iL[n] * dryCoeff + wL * wetCoeff;
      oR[n] = iR[n] * dryCoeff + wR * wetCoeff;

      // Safety soft clip
      if (Math.abs(oL[n]) > 0.98) oL[n] = Math.tanh(oL[n] * 0.95);
      if (Math.abs(oR[n]) > 0.98) oR[n] = Math.tanh(oR[n] * 0.95);

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this.port.postMessage({
      peak: peakAccum,
      transient: transAccum / N,
      distance: this._sd
    });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', NearFarProcessor);
`;

export async function createNearFarEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
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

  let _peak = 0, _transient = 0, _distance = 0.45;
  worklet.port.onmessage = e => {
    if (e.data?.peak     !== undefined) _peak      = e.data.peak;
    if (e.data?.transient !== undefined) _transient = e.data.transient;
    if (e.data?.distance  !== undefined) _distance  = e.data.distance;
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
    for (let i = 0; i < _buf.length; i++) { const a = Math.abs(_buf[i]); if (a > m) m = a; }
    return m;
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setDistance: v => { p('distance').value = v * 100; },
    setRoom:     v => { p('room').value     = v * 100; },
    setFocus:    v => { p('focus').value    = v * 100; },
    setAirLoss:  v => { p('airLoss').value  = v * 100; },
    setTail:     v => { p('tail').value     = v * 100; },
    setMix:      v => { p('mix').value      = v * 100; },
    setBypass:   v => { p('bypass').value   = v ? 1 : 0; },
    setSmooth:   v => { p('smooth').value   = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeakAn(analyserIn),  _peakIn  * DECAY); return _peakIn;  },
    getOutputPeak:  () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getTransient:   () => _transient,
    getDistance:    () => _distance,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
