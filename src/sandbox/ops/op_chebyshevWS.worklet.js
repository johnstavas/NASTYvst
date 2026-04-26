// op_chebyshevWS.worklet.js — Stage-3 op sidecar for the `chebyshevWS` op.
//
// Character / harmonic exciter. Memoryless waveshaper that injects
// specific harmonic orders via a weighted Chebyshev T_k polynomial sum.
// Distinct primitive from saturate / softLimit / wavefolder / hardClip:
// those produce harmonic spectra as a SIDE EFFECT of their nonlinearity;
// chebyshevWS lets the author DIAL each harmonic INDEPENDENTLY by amount.
//
// Math: Chebyshev polynomials of the first kind, defined by
//   T_k(cos θ) = cos(k·θ)
// so feeding `cos(ωt)` through `T_k` produces exactly the k-th harmonic.
// Linear combination
//   y = g_1·T_1(x) + g_2·T_2(x) + g_3·T_3(x) + g_4·T_4(x) + g_5·T_5(x)
// gives precise harmonic shaping.
//
// Recurrence (Wikipedia "Chebyshev polynomials"):
//   T_0(x) = 1
//   T_1(x) = x
//   T_{k+1}(x) = 2x · T_k(x) − T_{k−1}(x)
//
// Explicit forms used here (canon §4, musicdsp.org #230, public-domain):
//   T_1(x) = x
//   T_2(x) = 2x² − 1
//   T_3(x) = 4x³ − 3x
//   T_4(x) = 8x⁴ − 8x² + 1
//   T_5(x) = 16x⁵ − 20x³ + 5x
//
// LIMITATION (call out per Canon §4 LIMITS): T_k harmonic-isolation
// property is exact ONLY for unit-amplitude pure sinusoidal input.
// Complex inputs produce intermodulation; |x|>1 produces large polynomial
// growth. We clamp |x| ≤ 1 to bound output. Intended use is harmonic
// exciter on already-normalized signals (mastering bus, tape "exciter"
// stage). Authors who want general waveshaping should use saturate /
// hardClip / wavefolder instead.
//
// Stateless: T_k is memoryless. No reset state, no denormal concern.
//
// Default = `g1=1`, others=0 → identity (T_1(x) = x).

export class ChebyshevWSOp {
  static opId = 'chebyshevWS';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'g1', default: 1 },  // fundamental
    { id: 'g2', default: 0 },  // 2nd harmonic
    { id: 'g3', default: 0 },  // 3rd harmonic
    { id: 'g4', default: 0 },  // 4th harmonic
    { id: 'g5', default: 0 },  // 5th harmonic
    { id: 'level', default: 1 }, // output gain (linear, post-shape)
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._g1 = 1;
    this._g2 = 0;
    this._g3 = 0;
    this._g4 = 0;
    this._g5 = 0;
    this._level = 1;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'g1': this._g1 = Math.max(-2, Math.min(2, x)); break;
      case 'g2': this._g2 = Math.max(-2, Math.min(2, x)); break;
      case 'g3': this._g3 = Math.max(-2, Math.min(2, x)); break;
      case 'g4': this._g4 = Math.max(-2, Math.min(2, x)); break;
      case 'g5': this._g5 = Math.max(-2, Math.min(2, x)); break;
      case 'level': this._level = Math.max(0, Math.min(4, x)); break;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const g1 = this._g1, g2 = this._g2, g3 = this._g3,
          g4 = this._g4, g5 = this._g5, lvl = this._level;
    for (let i = 0; i < N; i++) {
      // Clamp input to [-1, 1] to bound polynomial growth.
      let x = inCh[i];
      if (x >  1) x =  1;
      else if (x < -1) x = -1;
      const x2 = x * x;
      const x3 = x2 * x;
      const x4 = x2 * x2;
      const x5 = x4 * x;
      // Explicit Chebyshev T_1..T_5 per Canon §4 (musicdsp #230).
      const T1 = x;
      const T2 = 2 * x2 - 1;
      const T3 = 4 * x3 - 3 * x;
      const T4 = 8 * x4 - 8 * x2 + 1;
      const T5 = 16 * x5 - 20 * x3 + 5 * x;
      outCh[i] = lvl * (g1 * T1 + g2 * T2 + g3 * T3 + g4 * T4 + g5 * T5);
    }
  }
}
