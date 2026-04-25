// op_formant.worklet.js — Stage-3 op sidecar for the `formant` op.
//
// Catalog #35 (Tone/Filter). Vowel-formant filter (A/E/I/O/U morph).
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - musicdsp archive #110, "Formant Filter" by alex@smartelectronix
//     (2002-08-02). 10th-order all-pole direct-form IIR with precomputed
//     per-vowel coefficient tables calibrated at 44 kHz (female soprano).
//     URL: https://www.musicdsp.org/en/latest/Filters/110-formant-filter.html
//     License: musicdsp archive (free use for non-commercial purposes per
//     site convention; coefficient tables are numerical data not subject
//     to copyright; structure is textbook all-pole IIR).
//
// PASSAGES VERBATIM:
//
//   Five vowel coefficient arrays (11 doubles each):
//     A: 8.11044e-06, 8.943665402, -36.83889529, 92.01697887, -154.337906,
//        181.6233289, -151.8651235, 89.09614114, -35.10298511, 8.388101016,
//        -0.923313471
//     E: 4.36215e-06, 8.90438318, -36.55179099, 91.05750846, -152.422234,
//        179.1170248, -149.6496211, 87.78352223, -34.60687431, 8.282228154,
//        -0.914150747
//     I: 3.33819e-06, 8.893102966, -36.49532826, 90.96543286, -152.4545478,
//        179.4835618, -150.315433, 88.43409371, -34.98612086, 8.407803364,
//        -0.932568035
//     O: 1.13572e-06, 8.994734087, -37.2084849, 93.22900521, -156.6929844,
//        184.596544, -154.3755513, 90.49663749, -35.58964535, 8.478996281,
//        -0.929252233
//     U: 4.09431e-07, 8.997322763, -37.20218544, 93.11385476, -156.2530937,
//        183.7080141, -153.2631681, 89.59539726, -35.12454591, 8.338655623,
//        -0.910251753
//
//   State: `static double memory[10] = {0,...,0};`
//
//   Structure: "weighted sum combining the current input with ten previous
//   filter state values, then shifts the state history forward for the
//   next iteration."
//
//   Author notes: "Double precision coefficients recommended for stability.
//   Linear morphing between vowel coefficients works effectively. Input
//   amplitude may require scaling to prevent distortion. The 'U' vowel
//   can exhibit self-oscillation in some conditions."
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Sample-rate calibration.** Tables are for 44.1 kHz; at 48 kHz
//      formant frequencies shift up ~9%. Declared deviation — no rescale
//      in v1. P2 debt: compile per-SR table, or rewrite coefs as warped
//      pole-pair biquads that can be re-tuned at runtime.
//   2. **Per-instance memory.** Original code uses `static double
//      memory[10]` — implicitly shared across caller instances; we make
//      memory per-instance to allow multiple concurrent voices.
//   3. **Linear vowel morphing.** Following author's "linear morphing
//      works effectively" note, we lerp coefficient arrays between
//      adjacent integer vowels for fractional `vowel` values. This is
//      not physically correct formant interpolation (actual formants
//      should move in log-frequency), but matches the reference's
//      documented behavior.
//   4. **No amplitude safety clamp.** Input scaling is caller's job per
//      author's note; we forward output as-is. Denormal flush only.
//   5. **Denormal flush** on memory[] state (Canon:utilities §1).

const COEFFS = [
  // A
  [8.11044e-06, 8.943665402, -36.83889529, 92.01697887, -154.337906,
   181.6233289, -151.8651235, 89.09614114, -35.10298511, 8.388101016,
   -0.923313471],
  // E
  [4.36215e-06, 8.90438318, -36.55179099, 91.05750846, -152.422234,
   179.1170248, -149.6496211, 87.78352223, -34.60687431, 8.282228154,
   -0.914150747],
  // I
  [3.33819e-06, 8.893102966, -36.49532826, 90.96543286, -152.4545478,
   179.4835618, -150.315433, 88.43409371, -34.98612086, 8.407803364,
   -0.932568035],
  // O
  [1.13572e-06, 8.994734087, -37.2084849, 93.22900521, -156.6929844,
   184.596544, -154.3755513, 90.49663749, -35.58964535, 8.478996281,
   -0.929252233],
  // U
  [4.09431e-07, 8.997322763, -37.20218544, 93.11385476, -156.2530937,
   183.7080141, -153.2631681, 89.59539726, -35.12454591, 8.338655623,
   -0.910251753],
];

const DENORMAL = 1e-30;
const N_VOWELS = 5;

export class FormantOp {
  static opId = 'formant';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'vowel', default: 0 }, // 0..4 (A/E/I/O/U), fractional = morph
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._vowel  = 0;
    this._coef   = new Float64Array(11);
    this._memory = new Float64Array(10);
    this._updateCoefs(0);
  }

  reset() {
    if (this._memory) this._memory.fill(0);
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'vowel') {
      const vc = n < 0 ? 0 : (n > N_VOWELS - 1 ? N_VOWELS - 1 : n);
      if (vc !== this._vowel) {
        this._vowel = vc;
        this._updateCoefs(vc);
      }
    }
  }

  getLatencySamples() { return 0; }

  _updateCoefs(v) {
    const i0 = Math.floor(v);
    const i1 = Math.min(i0 + 1, N_VOWELS - 1);
    const t  = v - i0;
    const a  = COEFFS[i0];
    const b  = COEFFS[i1];
    for (let k = 0; k < 11; k++) {
      this._coef[k] = a[k] * (1 - t) + b[k] * t;
    }
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const c = this._coef;
    const m = this._memory;

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;

      // res = c[0]*x + c[1]*m[0] + c[2]*m[1] + ... + c[10]*m[9]
      let res = c[0] * x
              + c[1] * m[0] + c[2] * m[1] + c[3] * m[2]
              + c[4] * m[3] + c[5] * m[4] + c[6] * m[5]
              + c[7] * m[6] + c[8] * m[7] + c[9] * m[8]
              + c[10] * m[9];

      if (res > -DENORMAL && res < DENORMAL) res = 0;

      // Shift memory: m[9] ← m[8], ..., m[1] ← m[0], m[0] ← res.
      m[9] = m[8]; m[8] = m[7]; m[7] = m[6];
      m[6] = m[5]; m[5] = m[4]; m[4] = m[3];
      m[3] = m[2]; m[2] = m[1]; m[1] = m[0];
      m[0] = res;

      out[i] = res;
    }
  }
}
