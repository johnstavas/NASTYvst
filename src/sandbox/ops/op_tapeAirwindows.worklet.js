// op_tapeAirwindows.worklet.js — Stage-3 op sidecar for catalog #112a.
//
// Airwindows ToTape9 tape character — faithful mono port. Sibling to
// #112 tapeSim (musicdsp gloubi-boulga); separate slot because the two
// sound recognizably different and both have sandbox use cases.
//
// PRIMARY (opened 2026-04-24):
//   Airwindows ToTape9 — Chris Johnson, MIT license.
//   Source: github.com/airwindows/airwindows/…/ToTape9/source/ToTape9Proc.cpp
//   Fetched to node_modules/.totape9_primary.cpp (806 lines).
//
// Pipeline stages ported (verbatim math; stereo→mono, double→float):
//   1. Input gain: inputGain = (A·2)²
//   2. Dubly encode (Dolby-like HF emphasis, IIR split + μ-law-ish comp)
//   3. Flutter — 1000-sample circular buffer w/ LCG-jittered sin sweep
//   4. Bias/slew chain — 9 thresholds, golden-ratio spaced (1.618033988…)
//   5. Tiny hysteresis leak
//   6. Pre-averaging cascade (2/4/8/16/32-tap — only the ≤slewsing ones)
//   7. Taylor-sin saturator — CLAMP ±2.305929007734908,
//        verbatim Airwindows coefs /6, /69, /2530.08, /224985.6, /9979200
//        (ToTape9Proc.cpp lines 223-234). "Degenerate Taylor sin()."
//   8. Post-averaging cascade (mirror of stage 6)
//   9. Head-bump dual biquad (tan-K BPF, reso = 0.618033988… golden-ratio
//        inverse; A and B stages staggered, B.freq = 0.9375·A.freq),
//        cubic soft-clip pre-biquad: x -= x³·0.0618/√overallscale
//        (ToTape9Proc.cpp lines 65-81, 284-305).
//   10. Dubly decode (mirror of #2 w/ different coef constants)
//   11. Output gain (inputGain·2)
//
// Stages SKIPPED from original (belong to other sandbox ops):
//   - ClipOnly3 post-limiter → #88 softLimit downstream
//   - Noise-shape dither      → #114 noiseShaper downstream
//
// PRNG: 32-bit xorshift matching Airwindows `fpdL ^= fpdL<<13; fpdL>>17; <<5`.
// State seed defaults to 17 (Airwindows canonical init).
//
// Deferred / deviations: see sandbox_ops_research_debt.md #112 block
// (Airwindows reference logged 2026-04-24).

const DENORMAL = 1e-30;
const TWO_PI   = Math.PI * 2;
const PHI      = 1.618033988749894848; // golden ratio
const INV_PHI  = 0.618033988749894848; // 1/φ

export class TapeAirwindowsOp {
  static opId = 'tapeAirwindows';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive',        default: 0.5 },  // A: input gain → (A·2)²
    { id: 'dubly',        default: 0.5 },  // B: Dubly encode/decode depth
    { id: 'encCross',     default: 0.5 },  // C: IIR crossover split encode/decode
    { id: 'flutterDepth', default: 0.0 },  // D: pow(D,6)·overallscale·50 samples
    { id: 'flutterRate',  default: 0.5 },  // E: 0.02·D³ / overallscale
    { id: 'bias',         default: 0.5 },  // F: (F·2)-1 → ±1 bias offset
    { id: 'bumpMix',      default: 0.25 }, // G: head-bump wet amount
    { id: 'bumpHz',       default: 0.5 },  // H: (H²·175+25) Hz/sr
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this.overallscale = sampleRate / 44100;
    this.slewsing = Math.floor(this.overallscale * 2);
    if (this.slewsing < 2)  this.slewsing = 2;
    if (this.slewsing > 32) this.slewsing = 32;

    this._drive = 0.5;
    this._dubly = 0.5;
    this._encCross = 0.5;
    this._flutterDepth = 0.0;
    this._flutterRate  = 0.5;
    this._bias  = 0.5;
    this._bumpMix = 0.25;
    this._bumpHz  = 0.5;

    // Flutter buffer (1002 slots — Airwindows uses [gcount ±1]%1000)
    this._d = new Float32Array(1002);
    this._gcount = 0;
    this._sweep  = 0;
    this._nextmax = 0.5;

    // LCG seed (xorshift, non-zero)
    this._fpd = 17;

    // Dubly encode state
    this._iirEnc = 0; this._avgEnc = 0; this._compEnc = 0;
    // Dubly decode state
    this._iirDec = 0; this._avgDec = 0; this._compDec = 0;

    // Bias/slew: 9 thresholds, 2 fields per threshold (prev, threshold)
    //   (Airwindows uses 3 fields × R/L — mono port halves that.)
    this._gsPrev   = new Float64Array(9);
    this._gsThresh = new Float64Array(9);

    // Hysteresis
    this._hyst = 0;

    // Averaging cascades (pre + post, each size 2/4/8/16/32)
    this._avg2  = new Float64Array(2);
    this._avg4  = new Float64Array(4);
    this._avg8  = new Float64Array(8);
    this._avg16 = new Float64Array(16);
    this._avg32 = new Float64Array(32);
    this._post2  = new Float64Array(2);
    this._post4  = new Float64Array(4);
    this._post8  = new Float64Array(8);
    this._post16 = new Float64Array(16);
    this._post32 = new Float64Array(32);
    this._avgPos = 0;
    this._lastDark = 0;

    // Head bump state
    this._hbSample = 0;
    // Dual biquads A and B — tan-K form; coefs recomputed on setParam(bumpHz)
    this._hdbA = { a0: 0, a1: 0, a2: 0, b1: 0, b2: 0, s1: 0, s2: 0 };
    this._hdbB = { a0: 0, a1: 0, a2: 0, b1: 0, b2: 0, s1: 0, s2: 0 };

    this._recomputeBiquads();
  }

  reset() {
    this._d.fill(0);
    this._gcount = 0;
    this._sweep  = 0;
    this._nextmax = 0.5;
    this._fpd = 17;
    this._iirEnc = this._avgEnc = this._compEnc = 0;
    this._iirDec = this._avgDec = this._compDec = 0;
    this._gsPrev.fill(0);
    this._gsThresh.fill(0);
    this._hyst = 0;
    this._avg2.fill(0);  this._avg4.fill(0);  this._avg8.fill(0);
    this._avg16.fill(0); this._avg32.fill(0);
    this._post2.fill(0); this._post4.fill(0); this._post8.fill(0);
    this._post16.fill(0); this._post32.fill(0);
    this._avgPos = 0;
    this._lastDark = 0;
    this._hbSample = 0;
    this._hdbA.s1 = this._hdbA.s2 = 0;
    this._hdbB.s1 = this._hdbB.s2 = 0;
  }

  _recomputeBiquads() {
    const H = this._bumpHz;
    const freqA = ((H * H) * 175 + 25) / this.sr;
    const freqB = freqA * 0.9375;
    const reso  = INV_PHI;

    const setBiquad = (biq, freq) => {
      const K = Math.tan(Math.PI * freq);
      const norm = 1 / (1 + K / reso + K * K);
      biq.a0 = (K / reso) * norm;
      biq.a1 = 0;
      biq.a2 = -biq.a0;
      biq.b1 = 2 * (K * K - 1) * norm;
      biq.b2 = (1 - K / reso + K * K) * norm;
    };
    setBiquad(this._hdbA, freqA);
    setBiquad(this._hdbB, freqB);
  }

  setParam(id, v) {
    const f = +v;
    if (!Number.isFinite(f)) return;
    const clamp01 = (x) => x < 0 ? 0 : (x > 1 ? 1 : x);
    if (id === 'drive')        this._drive = clamp01(f);
    else if (id === 'dubly')   this._dubly = clamp01(f);
    else if (id === 'encCross') this._encCross = clamp01(f);
    else if (id === 'flutterDepth') this._flutterDepth = clamp01(f);
    else if (id === 'flutterRate')  this._flutterRate  = clamp01(f);
    else if (id === 'bias')    this._bias = clamp01(f);
    else if (id === 'bumpMix') this._bumpMix = clamp01(f);
    else if (id === 'bumpHz')  { this._bumpHz = clamp01(f); this._recomputeBiquads(); }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;

    const ovs = this.overallscale;
    const slewsing = this.slewsing;

    // Per-block params (mirror ToTape9 param-prep block)
    const A = this._drive, B = this._dubly, C = this._encCross;
    const D = this._flutterDepth, E = this._flutterRate;
    const F = this._bias, G = this._bumpMix;

    const inputGain  = (A * 2) ** 2;
    const outputGain = inputGain * 2; // Airwindows: I*2, where I≈A
    const dublyAmount = B * 2;
    let outlyAmount = (1 - B) * -2;
    if (outlyAmount < -1) outlyAmount = -1;
    const iirEncFreq = (1 - C) / ovs;
    const iirDecFreq = C / ovs;

    let flutDepth = Math.pow(D, 6) * ovs * 50;
    if (flutDepth > 498) flutDepth = 498;
    const flutFrequency = (0.02 * Math.pow(E, 3)) / ovs;

    const bias = (F * 2) - 1;
    let underBias = (Math.pow(bias, 4) * 0.25) / ovs;
    let overBias  = Math.pow(1 - bias, 3) / ovs;
    if (bias > 0) underBias = 0;
    if (bias < 0) overBias  = 1 / ovs;

    // Fill threshold chain (9 thresholds, geometric by φ)
    let ob = overBias;
    for (let i = 8; i >= 0; i--) { this._gsThresh[i] = ob; ob *= PHI; }

    const headBumpDrive = (G * 0.1) / ovs;
    const headBumpMix   = G * 0.5;

    const cubicClipK = 0.0618 / Math.sqrt(ovs);

    // Unpack hot state
    const d = this._d;
    let gcount = this._gcount, sweep = this._sweep, nextmax = this._nextmax;
    let fpd = this._fpd >>> 0;

    let iirEnc = this._iirEnc, avgEnc = this._avgEnc, compEnc = this._compEnc;
    let iirDec = this._iirDec, avgDec = this._avgDec, compDec = this._compDec;

    const gsPrev = this._gsPrev, gsThresh = this._gsThresh;
    let hyst = this._hyst;

    const avg2 = this._avg2, avg4 = this._avg4, avg8 = this._avg8;
    const avg16 = this._avg16, avg32 = this._avg32;
    const post2 = this._post2, post4 = this._post4, post8 = this._post8;
    const post16 = this._post16, post32 = this._post32;
    let avgPos = this._avgPos;
    let lastDark = this._lastDark;

    let hb = this._hbSample;
    const hA = this._hdbA, hB = this._hdbB;

    for (let n = 0; n < N; n++) {
      let x = iBuf ? +iBuf[n] : 0;
      if (Math.abs(x) < 1.18e-23) x = fpd * 1.18e-17 / 0x100000000;

      if (inputGain !== 1) x *= inputGain;

      // --- (1) Dubly encode ---
      if (B > 0) {
        iirEnc = (iirEnc * (1 - iirEncFreq)) + (x * iirEncFreq);
        let highPart = (x - iirEnc) * 2.848;
        highPart += avgEnc;
        avgEnc = (x - iirEnc) * 1.152;
        if (highPart >  1) highPart =  1;
        if (highPart < -1) highPart = -1;
        let dub = Math.abs(highPart);
        if (dub > 0) {
          const adj = Math.log(1 + 255 * dub) / 2.40823996531;
          if (adj > 0) dub /= adj;
          compEnc = (compEnc * (1 - iirEncFreq)) + (dub * iirEncFreq);
          x += (highPart * compEnc) * dublyAmount;
        }
      }

      // --- (2) Flutter ---
      if (flutDepth > 0) {
        if (gcount < 0 || gcount > 999) gcount = 999;
        d[gcount] = x;
        let count = gcount;
        const offset = flutDepth + (flutDepth * Math.sin(sweep));
        sweep += nextmax * flutFrequency;
        if (sweep > TWO_PI) {
          sweep -= TWO_PI;
          const flutA = 0.24 + (fpd / 0xFFFFFFFF) * 0.74;
          fpd ^= fpd << 13; fpd >>>= 0;
          fpd ^= fpd >>> 17;
          fpd ^= fpd << 5;  fpd >>>= 0;
          const flutB = 0.24 + (fpd / 0xFFFFFFFF) * 0.74;
          const target = Math.sin(sweep + nextmax);
          nextmax = (Math.abs(flutA - target) < Math.abs(flutB - target)) ? flutA : flutB;
        }
        count += Math.floor(offset);
        const frac = offset - Math.floor(offset);
        const i0 = count - (count > 999 ? 1000 : 0);
        const i1 = (count + 1) - ((count + 1) > 999 ? 1000 : 0);
        x  = d[i0] * (1 - frac);
        x += d[i1] * frac;
        gcount--;
      }

      // --- (3) Bias / slew chain ---
      if (Math.abs(bias) > 0.001) {
        for (let k = 0; k < 9; k++) {
          const prev = gsPrev[k];
          const th   = gsThresh[k];
          if (underBias > 0) {
            const stuck = Math.abs(x - (prev / 0.975)) / underBias;
            if (stuck < 1) x = (x * stuck) + ((prev / 0.975) * (1 - stuck));
          }
          if ((x - prev) >  th) x = prev + th;
          if (-(x - prev) > th) x = prev - th;
          gsPrev[k] = x * 0.975;
        }
      }

      // --- (4) Tiny hysteresis ---
      const ax = Math.abs(x);
      const apply = (1 - ax) * (1 - ax) * 0.012;
      hyst = Math.max(Math.min(hyst + (x * ax), 0.011449), -0.011449) * 0.999;
      x += hyst * apply;

      // --- (5) Pre-averaging cascade ---
      let dark = x;
      let posCap = avgPos; if (posCap > 31) posCap = 0;
      if (slewsing > 31) {
        avg32[posCap] = dark; let s = 0;
        for (let k = 0; k < 32; k++) s += avg32[k];
        dark = s / 32;
      }
      if (slewsing > 15) {
        avg16[posCap % 16] = dark; let s = 0;
        for (let k = 0; k < 16; k++) s += avg16[k];
        dark = s / 16;
      }
      if (slewsing > 7) {
        avg8[posCap % 8] = dark; let s = 0;
        for (let k = 0; k < 8; k++) s += avg8[k];
        dark = s / 8;
      }
      if (slewsing > 3) {
        avg4[posCap % 4] = dark; let s = 0;
        for (let k = 0; k < 4; k++) s += avg4[k];
        dark = s / 4;
      }
      if (slewsing > 1) {
        avg2[posCap % 2] = dark; let s = 0;
        for (let k = 0; k < 2; k++) s += avg2[k];
        dark = s / 2;
      }
      let avgSlew = Math.min(Math.abs(lastDark - x) * 0.12 * ovs, 1);
      avgSlew = 1 - (1 - avgSlew * 1 - avgSlew);
      x = (x * (1 - avgSlew)) + (dark * avgSlew);
      lastDark = dark;

      // --- (6) Taylor-sin saturator (VERBATIM Airwindows coefs) ---
      if (x >  2.305929007734908) x =  2.305929007734908;
      if (x < -2.305929007734908) x = -2.305929007734908;
      const xx = x * x;
      let emp = x * xx;        // 3rd
      x -= emp / 6.0;
      emp *= xx;               // 5th
      x += emp / 69.0;
      emp *= xx;               // 7th
      x -= emp / 2530.08;
      emp *= xx;               // 9th
      x += emp / 224985.6;
      emp *= xx;               // 11th
      x -= emp / 9979200.0;

      // --- (7) Post-averaging cascade ---
      dark = x;
      posCap = avgPos; if (posCap > 31) posCap = 0;
      if (slewsing > 31) {
        post32[posCap] = dark; let s = 0;
        for (let k = 0; k < 32; k++) s += post32[k];
        dark = s / 32;
      }
      if (slewsing > 15) {
        post16[posCap % 16] = dark; let s = 0;
        for (let k = 0; k < 16; k++) s += post16[k];
        dark = s / 16;
      }
      if (slewsing > 7) {
        post8[posCap % 8] = dark; let s = 0;
        for (let k = 0; k < 8; k++) s += post8[k];
        dark = s / 8;
      }
      if (slewsing > 3) {
        post4[posCap % 4] = dark; let s = 0;
        for (let k = 0; k < 4; k++) s += post4[k];
        dark = s / 4;
      }
      if (slewsing > 1) {
        post2[posCap % 2] = dark; let s = 0;
        for (let k = 0; k < 2; k++) s += post2[k];
        dark = s / 2;
      }
      avgPos++;
      x = (x * (1 - avgSlew)) + (dark * avgSlew);

      // --- (8) Head-bump dual biquad ---
      let hbOut = 0;
      if (headBumpMix > 0) {
        hb += x * headBumpDrive;
        hb -= (hb * hb * hb) * cubicClipK;
        // Biquad A (DF-II-ish form matching Airwindows layout):
        //   y = a0·in + s1;  s1' = a1·in − b1·y + s2;  s2' = a2·in − b2·y
        const yA = hA.a0 * hb + hA.s1;
        hA.s1 = hA.a1 * hb - hA.b1 * yA + hA.s2;
        hA.s2 = hA.a2 * hb - hA.b2 * yA;
        const yB = hB.a0 * yA + hB.s1;
        hB.s1 = hB.a1 * yA - hB.b1 * yB + hB.s2;
        hB.s2 = hB.a2 * yA - hB.b2 * yB;
        hbOut = yB;
      }
      x += hbOut * headBumpMix;

      // --- (9) Dubly decode ---
      if (B > 0) {
        iirDec = (iirDec * (1 - iirDecFreq)) + (x * iirDecFreq);
        let highPart = (x - iirDec) * 2.628;
        highPart += avgDec;
        avgDec = (x - iirDec) * 1.372;
        if (highPart >  1) highPart =  1;
        if (highPart < -1) highPart = -1;
        let dub = Math.abs(highPart);
        if (dub > 0) {
          const adj = Math.log(1 + 255 * dub) / 2.40823996531;
          if (adj > 0) dub /= adj;
          compDec = (compDec * (1 - iirDecFreq)) + (dub * iirDecFreq);
          x += (highPart * compDec) * outlyAmount;
        }
      }

      // --- (10) Output gain ---
      if (outputGain !== 1) x *= outputGain;

      if (Math.abs(x) < DENORMAL) x = 0;
      if (!Number.isFinite(x)) x = 0;
      oBuf[n] = x;
    }

    // Denormal flush + state writeback
    const flush = (v) => (Math.abs(v) < DENORMAL ? 0 : v);
    this._gcount = gcount; this._sweep = sweep; this._nextmax = nextmax;
    this._fpd = fpd >>> 0;
    this._iirEnc = flush(iirEnc); this._avgEnc = flush(avgEnc); this._compEnc = flush(compEnc);
    this._iirDec = flush(iirDec); this._avgDec = flush(avgDec); this._compDec = flush(compDec);
    this._hyst = flush(hyst);
    this._avgPos = avgPos;
    this._lastDark = flush(lastDark);
    this._hbSample = flush(hb);
    hA.s1 = flush(hA.s1); hA.s2 = flush(hA.s2);
    hB.s1 = flush(hB.s1); hB.s2 = flush(hB.s2);
  }
}
