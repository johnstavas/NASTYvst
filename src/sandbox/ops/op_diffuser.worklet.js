// op_diffuser.worklet.js — Stage-3 op sidecar for the `diffuser` op.
//
// Catalog #19 (Tone/Time). Classical Schroeder allpass diffuser — a
// cascade of 4 allpass sections with mutually-prime delay lengths. The
// front-end stage of every Schroeder / Moorer / Freeverb / FDN reverb:
// flattens transient energy into a dense noise-like wash without
// colouring the magnitude spectrum.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - Julius Smith, "Physical Audio Signal Processing" (PASP):
//       https://ccrma.stanford.edu/~jos/pasp/Allpass_Two_Combs.html
//     Canonical Direct-Form-II allpass derivation.
//   - Julius Smith, PASP, "Schroeder Allpass Sections":
//       https://ccrma.stanford.edu/~jos/pasp/Schroeder_Allpass_Sections.html
//     Typical coefficient / delay conventions.
//   - Historical primary: M. R. Schroeder, "Natural Sounding Artificial
//     Reverberation", JAES 10(3), 1962. (Referenced in JOS; not re-opened
//     here — the JOS pages above are the authoritative restatement with
//     corrected transfer-function form.)
//
// PASSAGE VERBATIM — JOS "Allpass as Two-Comb Cascade":
//     v(n) = x(n) - a_M · v(n-M)
//     y(n) = b_0 · v(n) + v(n-M)
//     H(z) = (b_0 + z^-M) / (1 + a_M · z^-M)
//     Allpass when b_0 = a_M  (real coefficients).
//
// PASSAGE VERBATIM — JOS "Schroeder Allpass Sections":
//     "A typical value for g is 0.7."
//     "The delay-line lengths M_i are typically mutually prime and
//      spanning successive orders of magnitude, e.g., 1051, 337, 113."
//
// TOPOLOGY (applied here):
//     x → AP(M₀,g) → AP(M₁,g) → AP(M₂,g) → AP(M₃,g) → y
//   4-section cascade, shared g, delays = {1051, 337, 113, 43} samples at
//   44.1 kHz → {23.83, 7.64, 2.56, 0.975} ms, scaled linearly by `size`.
//   The 4th length (43) is a 4th-octave mutually-prime extension consistent
//   with JOS's "successive orders of magnitude" pattern.
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Direct-Form-II with b₀=a_M=g**: The JOS passage uses generic
//      `b_0` and `a_M`; we bind both to a single sign-consistent `g`.
//      In the passage's sign convention, `a_M` appears with a plus sign
//      in the denominator `(1 + a_M·z^-M)`. Our state update `v(n) = x(n)
//      - a_M·v(n-M)` matches that convention bit-for-bit. (Note: the
//      classic form `y = -g·x + x[n-M] + g·y[n-M]` is equivalent via DF-I;
//      the DF-II form here uses one delay line per section instead of two.)
//   2. **Delays expressed in ms, not samples**. JOS quotes 1051/337/113 at
//      (implied) 44.1 kHz. We store as ms {23.83, 7.64, 2.56, 0.975},
//      compute samples = max(1, floor(ms·sr/1000)) at construct time.
//      Primality is approximate at non-44.1 kHz; audible diffusion quality
//      is unchanged within ear tolerance. Declared debt.
//   3. **Single shared `g`** — Schroeder's original uses one coefficient
//      across all sections. Per-section `g_i` is a debt-tracked upgrade.
//   4. **`size` param** scales all delays uniformly in [0.5, 2.0]. Not
//      in the passage — a standard reverb-design affordance. Preserves
//      prime-ratio structure. Declared extension.
//   5. **Missing input = 0**, matches sandbox convention.
//   6. **Denormal flush** on each section's v-state (Canon:utilities §1).
//   7. **`g` clamped ±0.99** — passage says `|g| < 1` for allpass; clamp
//      preserves stability under automation extremes.

const DENORMAL = 1e-30;

// Mutually-prime allpass delays from JOS's "1051, 337, 113" set at 44.1 kHz,
// with a 4th-section extension (43 samples) for a standard 4-stage cascade.
const BASE_DELAY_MS = [23.83, 7.64, 2.56, 0.975];

export class DiffuserOp {
  static opId = 'diffuser';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'g',    default: 0.7 },
    { id: 'size', default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr    = sampleRate;
    this._g    = 0.7;
    this._size = 1.0;

    // 4 allpass sections — v[k] = delay line of length M_k, write index w_k.
    this._M  = new Int32Array(4);
    this._w  = new Int32Array(4);
    // Allocate each section's ring to a generous max so size changes don't
    // reallocate (30 ms × 2.0 size headroom at 192 kHz ≈ 11520 samples).
    const MAX = Math.ceil(BASE_DELAY_MS[0] * 2.0 * sampleRate / 1000) + 4;
    this._v0 = new Float32Array(MAX);
    this._v1 = new Float32Array(MAX);
    this._v2 = new Float32Array(MAX);
    this._v3 = new Float32Array(MAX);
    this._MAX = MAX;

    this._recalcDelays();
  }

  _recalcDelays() {
    for (let k = 0; k < 4; k++) {
      const samp = Math.max(1, Math.floor(BASE_DELAY_MS[k] * this._size * this.sr / 1000));
      this._M[k] = Math.min(samp, this._MAX - 1);
    }
  }

  reset() {
    this._v0.fill(0); this._v1.fill(0); this._v2.fill(0); this._v3.fill(0);
    this._w[0] = 0; this._w[1] = 0; this._w[2] = 0; this._w[3] = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'g') {
      this._g = n < -0.99 ? -0.99 : (n > 0.99 ? 0.99 : n);
    } else if (id === 'size') {
      this._size = n < 0.5 ? 0.5 : (n > 2.0 ? 2.0 : n);
      this._recalcDelays();
    }
  }

  getLatencySamples() {
    // Longest delay path = sum of section delays (group delay at DC).
    return this._M[0] + this._M[1] + this._M[2] + this._M[3];
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const g = this._g;
    const M0 = this._M[0], M1 = this._M[1], M2 = this._M[2], M3 = this._M[3];
    let w0 = this._w[0], w1 = this._w[1], w2 = this._w[2], w3 = this._w[3];
    const v0 = this._v0, v1 = this._v1, v2 = this._v2, v3 = this._v3;

    for (let i = 0; i < N; i++) {
      let x = inp ? inp[i] : 0;

      // --- Section 0: DF-II Schroeder allpass (b0 = a_M = g) ---
      //     v(n) = x(n) - g·v(n-M)
      //     y(n) = g·v(n) + v(n-M)
      const r0 = (w0 - M0 + this._MAX) % this._MAX;
      const vd0 = v0[r0];
      let vn0 = x - g * vd0;
      if (vn0 > -DENORMAL && vn0 < DENORMAL) vn0 = 0;
      const y0 = g * vn0 + vd0;
      v0[w0] = vn0;
      w0 = (w0 + 1) % this._MAX;
      x = y0;

      const r1 = (w1 - M1 + this._MAX) % this._MAX;
      const vd1 = v1[r1];
      let vn1 = x - g * vd1;
      if (vn1 > -DENORMAL && vn1 < DENORMAL) vn1 = 0;
      const y1 = g * vn1 + vd1;
      v1[w1] = vn1;
      w1 = (w1 + 1) % this._MAX;
      x = y1;

      const r2 = (w2 - M2 + this._MAX) % this._MAX;
      const vd2 = v2[r2];
      let vn2 = x - g * vd2;
      if (vn2 > -DENORMAL && vn2 < DENORMAL) vn2 = 0;
      const y2 = g * vn2 + vd2;
      v2[w2] = vn2;
      w2 = (w2 + 1) % this._MAX;
      x = y2;

      const r3 = (w3 - M3 + this._MAX) % this._MAX;
      const vd3 = v3[r3];
      let vn3 = x - g * vd3;
      if (vn3 > -DENORMAL && vn3 < DENORMAL) vn3 = 0;
      const y3 = g * vn3 + vd3;
      v3[w3] = vn3;
      w3 = (w3 + 1) % this._MAX;
      x = y3;

      out[i] = x;
    }

    this._w[0] = w0; this._w[1] = w1; this._w[2] = w2; this._w[3] = w3;
  }
}
