// op_noiseShaper.worklet.js — Stage-3 op sidecar for the `noiseShaper` op
// (catalog #114).
//
// Higher-order noise-shaping dither. Generalizes #115 dither from the
// fixed 2nd-order feedback filter `2·s1 − s2` to an N-tap FIR error-
// feedback filter with psychoacoustically-weighted coefficients.
//
// PRIMARY: anonymous musicdsp.org Archive #99 "Noise Shaping Class"
//   file: NS9dither16.h (2002-2004)
//   URL : https://www.musicdsp.org/en/latest/Other/99-noise-shaping-class.html
//   theory: Gerzon/Lipshitz/Vanderkooy/Wannamaker "Minimally Audible
//           Noise Shaping", JAES Vol 39 No 11, Nov 1991.
//
// Verbatim coefficients (from NS9dither16.h L7-L19):
//   F-weighted 9-tap : {2.412, -3.370, 3.937, -4.174, 3.353,
//                       -2.205, 1.281, -0.569, 0.0847}
//   modE 9-tap       : {1.662, -1.263, 0.4827, -0.2913, 0.1268,
//                       -0.1124, 0.03252, -0.01265, -0.03524}
//   impE 9-tap       : {2.847, -4.685, 6.214, -7.184, 6.639,
//                       -5.032, 3.263, -1.632, 0.4191}
//   Simple 2nd       : {1.0, -0.5}
//
// Verbatim algorithm (NS9dither16.h L112-L122, canonical form):
//   for x=0..order-1: samp -= c[x] * EH[HistPos+x]
//   output = round(samp + (frand() + frand() - 1))   // TPDF dither
//   EH[HistPos] = output - samp                       // store quantization error
//   advance HistPos by 8, wrap mod order
//
// NOTED PRIMARY BUG: The shipped "unrolled for speed" version in the
// original (NS9dither16.h L105-L107) has `c[2]*EH[HistPos+1] +
// c[1]*EH[HistPos+1]` — index 1 appears twice, index 2 is skipped.
// We ship the COMMENTED-OUT canonical loop form above, which is correct.
// This is mentioned in the header to record the divergence from primary.
//
// PARAMETERS
//   bits      (1..24, default 16) — target quantization grid (wi = 1/2^(bits-1))
//   order     (2|3|5|9, default 9) — FIR feedback length
//   weighting (0..3, default 1)    — 0=Simple, 1=F-weighted, 2=modE, 3=impE
//                                    (2nd-order orders always use `or2Sc`;
//                                    3-tap uses or3Fc; 5-tap uses or5IEc;
//                                    9-tap uses the selected weighting.)
//   seed      (int, default 1)     — deterministic LCG (Canon:synthesis §10).
//
// Output stays float — same sandbox pipeline constraint as #115 dither.

const DENORMAL = 1e-30;

// ---- coefficient banks (verbatim from NS9dither16.h) --------------------
const COEFS = {
  // 2nd-order simple (only weighting available at order=2)
  simple2: [1.0, -0.5],
  // 3-tap F-weighted
  F3:  [1.623, -0.982, 0.109],
  // 5-tap improved-E
  IE5: [2.033, -2.165, 1.959, -1.590, 0.6149],
  // 9-tap F / modE / impE
  F9:  [2.412, -3.370, 3.937, -4.174, 3.353, -2.205, 1.281, -0.569, 0.0847],
  ME9: [1.662, -1.263, 0.4827, -0.2913, 0.1268, -0.1124, 0.03252, -0.01265, -0.03524],
  IE9: [2.847, -4.685, 6.214, -7.184, 6.639, -5.032, 3.263, -1.632, 0.4191],
};

function pickCoefs(order, weighting) {
  if (order === 2) return COEFS.simple2;
  if (order === 3) return COEFS.F3;
  if (order === 5) return COEFS.IE5;
  // order === 9
  if (weighting === 2) return COEFS.ME9;
  if (weighting === 3) return COEFS.IE9;
  return COEFS.F9;   // 0 or 1 → F-weighted (default)
}

export class NoiseShaperOp {
  static opId = 'noiseShaper';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'bits',      default: 16 },
    { id: 'order',     default: 9  },
    { id: 'weighting', default: 1  },
    { id: 'seed',      default: 1  },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._bits      = 16;
    this._order     = 9;
    this._weighting = 1;
    this._seed      = 1;
    this._rng       = 1;
    this._recomputeGrid();
    this._selectCoefs();
    this._applySeed();
  }

  _recomputeGrid() {
    let b = this._bits | 0;
    if (b < 1)  b = 1;
    if (b > 24) b = 24;
    this._w  = Math.pow(2, b - 1);
    this._wi = 1 / this._w;
  }

  _selectCoefs() {
    // Snap order to supported set.
    let o = this._order | 0;
    if (o <= 2)       o = 2;
    else if (o <= 3)  o = 3;
    else if (o <= 5)  o = 5;
    else              o = 9;
    this._orderSnap = o;
    this._c = pickCoefs(o, this._weighting | 0);
    // Double-length error history (dual-buffer scheme — avoids mod wrap
    // on the READ side; we still wrap on the WRITE side).
    this._EH = new Float64Array(2 * o);
    this._histPos = 0;
  }

  _applySeed() { this._rng = (this._seed | 0) || 1; }

  reset() {
    if (this._EH) this._EH.fill(0);
    this._histPos = 0;
    this._applySeed();
  }

  setParam(id, v) {
    if (id === 'bits') {
      const b = (+v) | 0;
      if (b !== this._bits) { this._bits = b; this._recomputeGrid(); }
    } else if (id === 'order') {
      const o = (+v) | 0;
      if (o !== this._order) {
        this._order = o;
        this._selectCoefs();
      }
    } else if (id === 'weighting') {
      const w = (+v) | 0;
      if (w !== this._weighting) {
        this._weighting = w;
        this._selectCoefs();
      }
    } else if (id === 'seed') {
      const s = (v | 0) || 1;
      if (s !== this._seed) { this._seed = s; this._applySeed(); }
    }
  }

  getLatencySamples() { return 0; }

  // Canon:synthesis §10 LCG → uniform [0, 1).
  _rand() {
    this._rng = (this._rng * 1664525 + 1013904223) | 0;
    return ((this._rng >>> 8) & 0xFFFFFF) / 0x1000000;
  }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const c   = this._c;
    const order = this._orderSnap;
    const EH  = this._EH;
    const w   = this._w;
    const wi  = this._wi;
    let   pos = this._histPos;

    for (let n = 0; n < N; n++) {
      const x = iBuf ? iBuf[n] : 0;
      // NS9dither16.h canonical form:
      //   samp -= Σ c[k] * EH[HistPos+k]
      // Scale error to the signal's normalized domain by multiplying by wi.
      let samp = x;
      for (let k = 0; k < order; k++) {
        samp -= c[k] * EH[pos + k] * wi;
      }
      // TPDF dither ±1 LSB: wi · (r1 - r2), same as #115 dither.
      const r1 = this._rand();
      const r2 = this._rand();
      const dithered = samp + wi * (r1 - r2);
      // Quantize to the wi grid via round-to-nearest on the integer code.
      // Matches `output = round(samp + dither)` in the primary (which
      // quantizes integer-valued `samp`; our `samp` is float-domain so
      // we scale by w, round, scale back).
      const code = Math.round(w * dithered);
      const y = code * wi;
      oBuf[n] = y;
      // Store quantization error in the "integer code" domain the primary
      // uses: err = output - samp_before_dither, scaled as integer LSBs.
      // In our float form that is `(y - samp) / wi`.
      let err = (y - samp) / wi;
      if (!Number.isFinite(err)) err = 0;
      if (Math.abs(err) < DENORMAL) err = 0;
      // Dual-buffer write (primary's EH[HistPos+order] = EH[HistPos] = err).
      EH[pos] = err;
      EH[pos + order] = err;
      // Advance by 1 (not 8 — our block layout doesn't share the primary's
      // P-III unroll, so single-sample advance is simpler and mathematically
      // equivalent for an FIR-with-feedback).
      pos -= 1;
      if (pos < 0) pos += order;
    }

    this._histPos = pos;
  }
}
