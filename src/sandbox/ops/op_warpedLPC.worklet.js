// op_warpedLPC.worklet.js — Stage-3 op sidecar for the `warpedLPC` op.
//
// Catalog #72 (Analysis/Spectral). Warped Linear-Predictive Coding front-end.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   musicdsp #137 "LPC analysis (autocorrelation + Levinson-Durbin recursion)"
//     URL: https://www.musicdsp.org/en/latest/_sources/Analysis/
//          137-lpc-analysis-autocorrelation-levinson-durbin-recursion.rst.txt
//     Author: ten.enegatum@liam (reversed email)
//     Created: 2004-04-07 09:37:51
//     License: musicdsp mailing list — assume public domain.
//
// PASSAGE VERBATIM (wAutocorrelate, C++):
//
//   //find the order-P autocorrelation array, R, for the sequence x of
//   //length L and warping of lambda
//   wAutocorrelate(float * x, unsigned int L, float * R,
//                  unsigned int P, float lambda)
//   {
//     double * dl = new double [L];
//     double * Rt = new double [L];
//     double r1,r2,r1t;
//     R[0]=0;  Rt[0]=0;  r1=0;  r2=0;  r1t=0;
//     for(unsigned int k=0; k<L;k++) {
//       Rt[0]+=double(x[k])*double(x[k]);
//       dl[k]=r1-double(lambda)*double(x[k]-r2);
//       r1 = x[k];
//       r2 = dl[k];
//     }
//     for(unsigned int i=1; i<=P; i++) {
//       Rt[i]=0; r1=0; r2=0;
//       for(unsigned int k=0; k<L;k++) {
//         Rt[i]+=double(dl[k])*double(x[k]);
//         r1t = dl[k];
//         dl[k]=r1-double(lambda)*double(r1t-r2);
//         r1 = r1t;
//         r2 = dl[k];
//       }
//     }
//     for(i=0; i<=P; i++) R[i]=float(Rt[i]);
//     delete[] dl;  delete[] Rt;
//   }
//
// The warp is a first-order allpass D(z) = (z⁻¹ − λ) / (1 − λ·z⁻¹) applied
// iteratively: for lag i, each `dl[k]` already carries i−1 allpass hops, and
// one more is applied in the inner loop before correlating with x[k].
// Levinson-Durbin (second routine in the musicdsp passage) is identical to
// #71 lpc's recursion — reused verbatim here, with |k| ≤ 0.999 clamp.
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Inverse filter not in primary.** musicdsp #137 provides analysis
//      only. The warped inverse FIR (required for whitening with warped
//      coefs) substitutes every unit-delay z⁻¹ in the prediction FIR with
//      the same allpass D(z) — a standard textbook result (Härmä-Karjalainen
//      "A warped linear prediction approach" class of papers, not opened
//      here). Concretely: compute warped delay taps d_k[n] via an allpass
//      chain on the live input, then e[n] = Σ a[k]·d_k[n] with a[0]=1.
//      Declared deviation: analysis cites primary; inverse-filter structure
//      is canonical-but-not-in-passage.
//   2. **Bark-default lambda.** Smith–Abel 1999 closed form at 48 kHz gives
//      λ ≈ 0.7564 · √(arctan(0.07·sr/1000)/π) − 0.1980 ≈ 0.72. We default
//      to 0.65 (conservative — works across 44.1/48/96 kHz without retuning)
//      and expose `lambda` as a param. Passage leaves lambda a caller arg;
//      not a deviation in behaviour, just a default policy.
//   3. **Dynamic alloc replaced with preallocated Float64.** Passage uses
//      `new double[L]`; we allocate once at setParam('blockN') time.
//   4. **Silence gate.** R[0] < 1e-12 → zero coefs, skip inverse filter
//      (matches #71 lpc behaviour). Passage has no silence gate.
//   5. **order clamp.** [1, 32] to match #71 lpc. Passage has no ceiling.
//   6. **Stability clamp |k| ≤ 0.999.** Matches #71 lpc. Passage does not
//      clamp — musicdsp comments call out "no optimizations" but not the
//      stability check; leaving it off would let numerical noise produce
//      unstable all-pole models on silent-ish blocks.

const MAX_ORDER = 32;

export class WarpedLpcOp {
  static opId = 'warpedLPC';
  static inputs  = Object.freeze([{ id: 'in',       kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'residual', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'order',  default: 12   },
    { id: 'blockN', default: 1024 },
    { id: 'lambda', default: 0.65 }, // Bark-like warp; ~0.65 at 48 kHz
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._order   = 12;
    this._blockN  = 1024;
    this._lambda  = 0.65;

    // Analysis window ring (contiguous samples, wraps every blockN).
    this._buf     = new Float32Array(8192);
    this._wPos    = 0;
    this._filled  = 0;

    // Coefs + scratch. a[0] = 1, a[1..P] are the AR coefs.
    this._coefs   = new Float64Array(MAX_ORDER + 1);
    this._R       = new Float64Array(MAX_ORDER + 1);
    this._tmp     = new Float64Array(MAX_ORDER + 1);
    this._hasCoefs = false;

    // Analysis scratch for warped autocorrelation. Reallocated with blockN.
    this._dl      = new Float64Array(this._blockN);

    // Live warped-allpass chain state for inverse filter: ap[k] is the
    // output of the k-th allpass at the previous sample, k=0..P.
    // (ap[0] holds last input sample; ap[k>=1] holds last allpass output.)
    this._apPrev  = new Float64Array(MAX_ORDER + 1);
    // Current allpass chain output per tap (scratch for this sample).
    this._apCur   = new Float64Array(MAX_ORDER + 1);
  }

  reset() {
    this._buf.fill(0);
    this._wPos     = 0;
    this._filled   = 0;
    this._coefs.fill(0);
    this._hasCoefs = false;
    this._apPrev.fill(0);
    this._apCur.fill(0);
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'order') {
      const c = Math.round(n);
      const o = c < 1 ? 1 : (c > MAX_ORDER ? MAX_ORDER : c);
      if (o !== this._order) {
        this._order    = o;
        this._coefs.fill(0);
        this._hasCoefs = false;
      }
    } else if (id === 'blockN') {
      const c = Math.round(n);
      const b = c < 64 ? 64 : (c > 8192 ? 8192 : c);
      if (b !== this._blockN) {
        this._blockN   = b;
        this._wPos     = 0;
        this._filled   = 0;
        this._coefs.fill(0);
        this._hasCoefs = false;
        this._dl       = new Float64Array(b);
      }
    } else if (id === 'lambda') {
      // Clamp to open unit disk for allpass stability.
      let L = n;
      if (L >  0.99) L =  0.99;
      if (L < -0.99) L = -0.99;
      this._lambda = L;
      // coefs tied to old lambda — invalidate until next block.
      this._coefs.fill(0);
      this._hasCoefs = false;
    }
  }

  getLatencySamples() { return this._blockN; }

  // ────────────────────────────────────────────────────────────────────────
  // Warped autocorrelation — direct port of musicdsp #137 wAutocorrelate,
  // operating on the contiguous window reconstructed from the ring.
  //
  //   dl[k] ← allpass-chain output at sample k, lag-depth incremented per
  //           outer iteration i. dl is modified in-place across i loops.
  //
  _computeCoefs() {
    const P      = this._order;
    const N      = this._blockN;
    const R      = this._R;
    const a      = this._coefs;
    const t      = this._tmp;
    const dl     = this._dl;
    const buf    = this._buf;
    const lambda = this._lambda;

    // Pull the window into dl[] in time order, and accumulate R[0].
    // Also seed the first allpass hop exactly as the passage does.
    let r1 = 0, r2 = 0;
    R[0] = 0;
    for (let k = 0; k < N; k++) {
      const xk = buf[(this._wPos + k) % N];
      R[0] += xk * xk;
      const d = r1 - lambda * (xk - r2);
      dl[k] = d;
      r1 = xk;
      r2 = d;
    }

    // Silence gate — matches #71 lpc behaviour.
    if (R[0] < 1e-12) {
      for (let i = 0; i <= P; i++) a[i] = 0;
      this._hasCoefs = false;
      return;
    }

    // For lags i = 1..P, re-pass dl through another allpass while
    // correlating against the original x[k] (reconstructed from the ring).
    for (let i = 1; i <= P; i++) {
      let Rt = 0;
      let u1 = 0, u2 = 0;
      for (let k = 0; k < N; k++) {
        const xk = buf[(this._wPos + k) % N];
        Rt += dl[k] * xk;
        const r1t = dl[k];
        const d   = u1 - lambda * (r1t - u2);
        dl[k] = d;
        u1 = r1t;
        u2 = d;
      }
      R[i] = Rt;
    }

    // Levinson-Durbin — identical recursion to #71 lpc.
    a.fill(0, 0, P + 1);
    a[0] = 1;
    let E = R[0];
    for (let i = 1; i <= P; i++) {
      let num = R[i];
      for (let j = 1; j < i; j++) num += a[j] * R[i - j];
      let k = -num / E;
      if (k >  0.999) k =  0.999;
      if (k < -0.999) k = -0.999;
      for (let j = 0; j <= i; j++) t[j] = a[j];
      t[i] = k;
      for (let j = 1; j < i; j++) t[j] = a[j] + k * a[i - j];
      for (let j = 0; j <= i; j++) a[j] = t[j];
      E *= (1 - k * k);
      if (E <= 0) {
        for (let z = 0; z <= P; z++) a[z] = 0;
        this._hasCoefs = false;
        return;
      }
    }
    this._hasCoefs = true;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.residual;
    if (!outCh) return;

    const P      = this._order;
    const bN     = this._blockN;
    const buf    = this._buf;
    const coefs  = this._coefs;
    const lambda = this._lambda;
    const apPrev = this._apPrev;
    const apCur  = this._apCur;

    for (let i = 0; i < N; i++) {
      const x = inCh ? inCh[i] : 0;

      // Update analysis ring for next block.
      buf[this._wPos] = x;

      // Live warped-allpass chain: apCur[0] = x, apCur[k] = allpass(apCur[k-1]).
      // Allpass D(z) = (z⁻¹ − λ)/(1 − λ·z⁻¹) realised as:
      //   y[n] = apPrev[k-1] − λ · (apCur[k-1] − apPrev[k])
      // where apPrev[k-1] is the previous INPUT to this allpass and apPrev[k]
      // is the previous OUTPUT. (Standard DF-I first-order allpass.)
      apCur[0] = x;
      for (let k = 1; k <= P; k++) {
        apCur[k] = apPrev[k - 1] - lambda * (apCur[k - 1] - apPrev[k]);
      }

      // e[n] = Σ a[k] · apCur[k]   with a[0] = 1  (residual).
      let e = 0;
      if (this._hasCoefs) {
        e = apCur[0];  // a[0] = 1
        for (let k = 1; k <= P; k++) e += coefs[k] * apCur[k];
      } else {
        e = 0;
      }
      outCh[i] = e;

      // Shift allpass state: previous[k] ← current[k].
      for (let k = 0; k <= P; k++) apPrev[k] = apCur[k];

      // Advance ring + block boundary.
      this._wPos = (this._wPos + 1) % bN;
      this._filled++;
      if (this._filled >= bN) {
        this._filled = 0;
        this._computeCoefs();
      }
    }
  }
}
