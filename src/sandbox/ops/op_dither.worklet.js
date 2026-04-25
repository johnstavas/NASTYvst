// op_dither.worklet.js — Stage-3 op sidecar for the `dither` op (catalog #115).
//
// Bit-depth reduction with TPDF dither + optional 2nd-order noise shaping.
//
// PRIMARY: Paul Kellett (2002), musicdsp.org Archive #61 "Dither Code".
//   https://www.musicdsp.org/en/latest/Other/61-dither-code.html
//
// Kellett's C (verbatim constants + core loop):
//   s  = 0.5f                  // shaping amount (0 disables)
//   w  = pow(2, bits-1)        // word length
//   wi = 1/w                   // LSB size
//   d  = wi / RAND_MAX         // dither scaler → ±1 LSB after (r1-r2)
//   o  = wi * 0.5f             // DC offset removal
//
//   in += s * (s1 + s1 - s2)             // 2nd-order error feedback
//   tmp = in + o + d*(r1 - r2)           // TPDF-dithered
//   out = (int)(w * tmp); if (tmp<0) out--
//   s1, s2 update with the new quantization error.
//
// The `(r1 − r2)` pair of independent uniforms gives triangular PDF
// dither on [−1,+1] scaled by wi → ±1 LSB amplitude (Lipshitz /
// Vanderkooy / Wannamaker JAES 1992 is the theoretical primary; this
// op ships the Kellett code form as the reference implementation).
//
// PARAMETERS
//   bits  (1..24,  default 16)  — target quantization depth.
//   shape (0..1,   default 0.5) — 2nd-order noise-shaping feedback gain.
//                                 0 = flat TPDF only.
//                                 0.5 = Kellett default (pushes quantization
//                                 noise up toward Nyquist; ~6dB audible-band
//                                 improvement at 16-bit audio rates).
//                                 1.0 = marginal-stability boundary.
//   seed  (int, default 1)      — deterministic LCG seed. Canon:synthesis §10.
//                                 Ensures golden hash stability.
//
// DEVIATIONS from Kellett (diffed in ship protocol Step 4):
//   - RNG: deterministic LCG (Canon:synthesis §10) instead of rand().
//     Preserves golden-vector reproducibility.
//   - Output stays float (requantized back to float via wi·round(w·x))
//     rather than int16/int8. Sandbox pipeline is float throughout; the
//     op is meant to *simulate* bit reduction, not convert to int.
//   - HP-TPDF (`r1[n] − r1[n-1]`) not implemented; pairwise `(r1 − r2)`
//     ships per Kellett's code. HP-TPDF is a 1-line upgrade in the RNG
//     and is filed in the debt ledger.

const DENORMAL = 1e-30;

export class DitherOp {
  static opId = 'dither';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'bits',  default: 16 },
    { id: 'shape', default: 0.5 },
    { id: 'seed',  default: 1 },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._bits   = 16;
    this._shape  = 0.5;
    this._seed   = 1;
    this._rng    = 1;           // LCG state (initialized on seed set)
    this._s1     = 0;           // error feedback z⁻¹
    this._s2     = 0;           // error feedback z⁻²
    this._recompute();
    this._applySeed();
  }

  _recompute() {
    // Guard extreme bits: <1 would div-by-zero; >24 is pointless (floats lose LSB).
    let b = this._bits | 0;
    if (b < 1)  b = 1;
    if (b > 24) b = 24;
    this._w  = Math.pow(2, b - 1);   // e.g. bits=16 → 32768
    this._wi = 1 / this._w;           // LSB size
    this._o  = this._wi * 0.5;        // Kellett DC offset removal
  }

  _applySeed() { this._rng = (this._seed | 0) || 1; }

  reset() {
    this._s1 = 0;
    this._s2 = 0;
    this._applySeed();
  }

  setParam(id, v) {
    if (id === 'bits') {
      const b = (+v) | 0;
      if (b !== this._bits) { this._bits = b; this._recompute(); }
    } else if (id === 'shape') {
      let s = +v;
      if (!Number.isFinite(s)) s = 0.5;
      if (s < 0) s = 0;
      if (s > 1) s = 1;
      this._shape = s;
    } else if (id === 'seed') {
      const s = (v | 0) || 1;
      if (s !== this._seed) { this._seed = s; this._applySeed(); }
    }
  }

  getLatencySamples() { return 0; }

  // LCG (Canon:synthesis §10, 1664525/1013904223) → uniform [0,1).
  _rand() {
    this._rng = (this._rng * 1664525 + 1013904223) | 0;
    return ((this._rng >>> 8) & 0xFFFFFF) / 0x1000000;
  }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const w   = this._w;
    const wi  = this._wi;
    const o   = this._o;
    const s   = this._shape;
    let   s1  = this._s1;
    let   s2  = this._s2;

    for (let n = 0; n < N; n++) {
      const x = iBuf ? iBuf[n] : 0;
      // Kellett: in += s*(2*s1 - s2)
      const shaped = x + s * (2 * s1 - s2);
      // TPDF dither ±1 LSB = wi·(r1 − r2)
      const r1 = this._rand();
      const r2 = this._rand();
      const tmp = shaped + o + wi * (r1 - r2);
      // Kellett: out = (int)(w*tmp); if(tmp<0) out--
      const wTmp = w * tmp;
      let q = wTmp | 0;                    // C-style truncation (toward 0)
      if (tmp < 0 && wTmp !== q) q--;      // Kellett's floor fix
      const y = q * wi;                     // requantized float
      oBuf[n] = y;
      // Kellett: s1 = in - wi*out  (NB: `in` here is the shaped value).
      s2 = s1;
      s1 = shaped - y;
      if (Math.abs(s1) < DENORMAL) s1 = 0;
    }

    this._s1 = s1;
    this._s2 = s2;
  }
}
