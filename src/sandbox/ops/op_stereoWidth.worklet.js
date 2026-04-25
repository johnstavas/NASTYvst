// op_stereoWidth.worklet.js — Stage-3 op sidecar for the `stereoWidth` op.
//
// Catalog #57 (Analysis / Spectral, stereo metering). Energy-domain
// M/S width meter — complement to `correlation` (#56).
//
// RATIONALE
//
// `correlation` answers: "are L and R the same waveform?" (coherence).
// `stereoWidth` answers:  "how much side-channel energy is there
//                          relative to mid?" (spatial spread).
//
// A record can be highly correlated (ρ≈+1) but still have real width
// (slight LR gain imbalance → mostly-mid with a sliver of side). Width
// and correlation are genuinely independent metrics; mastering engineers
// read both.
//
// DEFINITION
//
//   M = (L + R) / √2      (Bauer mid)
//   S = (L − R) / √2      (Bauer side)
//
//   E[M²] and E[S²] are one-pole-smoothed with shared τ (same ballistic
//   as the correlation meter, default 300 ms per IEC/EBU convention).
//
//   width = E[S²] / (E[M²] + E[S²])       ∈ [0, 1]
//
//   This is the side-energy FRACTION of total stereo energy. Why this
//   form rather than the more common rmsS/rmsM ratio:
//
//     - Bounded [0,1], which is what meter-mapping downstream expects.
//     - Linear in *power*, so doubling the side-channel exactly doubles
//       the reading (for fixed mid). An rmsS/rmsM ratio would double
//       too, but unbounded — display pixels would compress nonlinearly.
//     - Well-defined at edges:
//         L = R (pure mono)        → S=0, width=0
//         L = −R (pure side)       → M=0, width=1
//         decorrelated noise       → E[M²]≈E[S²], width≈0.5
//         L or R alone             → E[M²]=E[S²], width=0.5 also
//       (The last is a deliberate property: a hard-panned mono source
//       sits at 0.5 because its side and mid energy are identical.)
//
// REFERENCES
//   - DAFX (Zölzer) Ch. 11 Spatial Effects — M/S decomposition.
//   - Bauer (1963) "Stereophonic Earphones and Binaural Loudspeakers" —
//     original √2-normalised M/S matrix.
//   - Canon:loudness §1 — E[x²] one-pole primitive reused.
//
// TIME CONSTANT
//
// `timeMs` is the one-pole τ (not rectangular-window length). 300 ms
// matches broadcast convention and pairs with the correlation meter.
// Shorter (50–150 ms) tracks transients; longer (1–3 s) gives a
// programme-average spatial reading.
//
// SILENCE HANDLING
//
// When total energy is below DENOM_FLOOR (1e-20), the ratio is
// undefined — emit 0.5 (neutral) rather than 0 or NaN, because silence
// is not "mono" in any meaningful sense; it's absence-of-information.
// Downstream displays typically park the needle at centre during
// silence, which is exactly width=0.5.
//
// Denormal flush on both states per Jon Watte (Canon:utilities §1).

const DENORMAL    = 1e-30;
const DENOM_FLOOR = 1e-20;  // below this total energy, meter reads 0.5
const INV_SQRT2   = 0.7071067811865475;

export class StereoWidthOp {
  static opId = 'stereoWidth';
  static inputs  = Object.freeze([
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'width', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'timeMs', default: 300 },
  ]);

  constructor(sampleRate) {
    this.sr     = sampleRate;
    this._tauS  = 0.3;
    this._alpha = 0;
    this._oma   = 1;
    this._eMM   = 0;
    this._eSS   = 0;
    this._recomputeCoefs();
  }

  reset() {
    this._eMM = 0;
    this._eSS = 0;
  }

  setParam(id, v) {
    if (id === 'timeMs') {
      const ms = +v;
      if (!Number.isFinite(ms)) return;
      const clamped = ms < 1 ? 1 : (ms > 10000 ? 10000 : ms);
      this._tauS = clamped / 1000;
      this._recomputeCoefs();
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    this._alpha = Math.exp(-1 / (this._tauS * this.sr));
    this._oma   = 1 - this._alpha;
  }

  process(inputs, outputs, N) {
    const lCh = inputs.l;
    const rCh = inputs.r;
    const outCh = outputs.width;
    if (!outCh) return;

    const a   = this._alpha;
    const oma = this._oma;
    let eMM = this._eMM;
    let eSS = this._eSS;

    if (!lCh || !rCh) {
      // One channel unwired — decay and emit neutral 0.5.
      for (let i = 0; i < N; i++) {
        eMM *= a; eSS *= a;
        if (eMM < DENORMAL) eMM = 0;
        if (eSS < DENORMAL) eSS = 0;
        outCh[i] = 0.5;
      }
      this._eMM = eMM; this._eSS = eSS;
      return;
    }

    for (let i = 0; i < N; i++) {
      const l = lCh[i];
      const r = rCh[i];
      // Bauer M/S with √2 normalisation (energy-preserving: eMM+eSS ≡ eLL+eRR).
      const m = (l + r) * INV_SQRT2;
      const s = (l - r) * INV_SQRT2;
      eMM = oma * (m * m) + a * eMM;
      eSS = oma * (s * s) + a * eSS;
      // Always non-negative (sum of squares), single-sided denormal test.
      if (eMM < DENORMAL) eMM = 0;
      if (eSS < DENORMAL) eSS = 0;
      const total = eMM + eSS;
      outCh[i] = total < DENOM_FLOOR ? 0.5 : eSS / total;
    }

    this._eMM = eMM; this._eSS = eSS;
  }
}
