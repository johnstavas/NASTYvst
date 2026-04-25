// op_tilt.worklet.js — Stage-3 op sidecar for the `tilt` op.
//
// Catalog #38 (Tone/EQ). Tilt equalizer — single control that boosts
// lows while cutting highs (or vice versa) around a pivot frequency.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - musicdsp archive #267, "Simple Tilt Equalizer" by Lubomir I. Ivanov
//     (2009-05-29). Models Elysia mPressor "Niveau" filter.
//     URL: https://www.musicdsp.org/en/latest/Filters/267-simple-tilt-equalizer.html
//     License: musicdsp archive convention (free for non-commercial,
//     structure is a textbook complementary LP/HP crossover with gain).
//
// PASSAGE VERBATIM (the algorithm's essence):
//
//     amp     = 6/log(2);
//     sr3     = 3*srate;
//     gfactor = 5;
//     if (gain > 0) { g1 = -gfactor*gain; g2 =  gain;           }
//     else          { g1 = -gain;         g2 =  gfactor*gain;   };
//     lgain   = exp(g1/amp) - 1;
//     hgain   = exp(g2/amp) - 1;
//
//     omega = 2*pi*f0;
//     n     = 1/(sr3 + omega);
//     a0    = 2*omega*n;
//     b1    = (sr3 - omega)*n;
//
//     // sample loop
//     lp_out = a0*in + b1*lp_out;
//     out    = in + lgain*lp_out + hgain*(in - lp_out);
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **π value.** Original uses `pi = 22/7` ≈ 3.1429 (crude). We use
//      `Math.PI` (3.14159…). Negligible coefficient shift (~0.04%) —
//      declared deviation, numerical improvement only.
//   2. **Unused `denorm`.** Original declares `denorm = 1e-30` but never
//      uses it; commenter on archive flagged this. We implement an
//      actual denormal flush on `lp_out` per Canon:utilities §1.
//   3. **`gfactor` exposed as param.** Original hardcodes `gfactor = 5`;
//      we default to 5 (faithful) but let caller tune for gentler or
//      steeper asymmetry. Declared deviation.
//   4. **Input clamp of gain param.** Documented range is ±6 dB but
//      formula extrapolates. We clamp to ±24 dB (allow push, cap
//      runaway from extreme gfactor*gain exponentials).
//   5. **Recompute coefs only on change.** Original recomputes every
//      block; we lazy-recompute on param change (cosmetic, no audible
//      difference).

const DENORMAL = 1e-30;

export class TiltOp {
  static opId = 'tilt';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'f0',       default: 630 },  // pivot frequency (Hz)
    { id: 'gain',     default: 0   },  // ±dB tilt amount
    { id: 'gfactor',  default: 5   },  // asymmetric gain factor (musicdsp default)
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._f0      = 630;
    this._gain    = 0;
    this._gfactor = 5;
    this._lgain   = 0;
    this._hgain   = 0;
    this._a0      = 0;
    this._b1      = 0;
    this._lp_out  = 0;
    this._recalc();
  }

  reset() { this._lp_out = 0; }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'f0') {
      this._f0 = Math.min(Math.max(n, 1), this.sr * 0.49);
    } else if (id === 'gain') {
      this._gain = Math.min(Math.max(n, -24), 24);  // deviation 4
    } else if (id === 'gfactor') {
      this._gfactor = Math.min(Math.max(n, 0.01), 100);
    } else {
      return;
    }
    this._recalc();
  }

  getLatencySamples() { return 0; }

  _recalc() {
    // Verbatim from musicdsp #267.
    const amp     = 6 / Math.log(2);
    const sr3     = 3 * this.sr;
    const gfactor = this._gfactor;
    const gain    = this._gain;

    let g1, g2;
    if (gain > 0) {
      g1 = -gfactor * gain;
      g2 =  gain;
    } else {
      g1 = -gain;
      g2 =  gfactor * gain;
    }
    this._lgain = Math.exp(g1 / amp) - 1;
    this._hgain = Math.exp(g2 / amp) - 1;

    const omega = 2 * Math.PI * this._f0;  // deviation 1: Math.PI not 22/7
    const n     = 1 / (sr3 + omega);
    this._a0    = 2 * omega * n;
    this._b1    = (sr3 - omega) * n;
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const a0 = this._a0, b1 = this._b1;
    const lgain = this._lgain, hgain = this._hgain;
    let lp = this._lp_out;

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;
      lp = a0 * x + b1 * lp;
      if (lp > -DENORMAL && lp < DENORMAL) lp = 0;
      out[i] = x + lgain * lp + hgain * (x - lp);
    }
    this._lp_out = lp;
  }
}
