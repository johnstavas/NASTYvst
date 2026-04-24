// op_onePole.worklet.js — Stage-3 op sidecar for the `onePole` op.
//
// Catalog #32 (Filters family). Generic 1-pole LP/HP. Half the CPU and
// cleaner phase than #2 filter (biquad), 6 dB/oct slope, no resonance.
//
// Math: standard 1-pole IIR (Canon:filters §9 / DAFX §2.1.1):
//   a     = exp(-2π · fc / Fs)         (pole radius, 0 < a < 1)
//   LP:   y[n] = (1 − a)·x[n] + a·y[n−1]
//   HP:   y[n] = x[n] − LP(x[n])        (complementary — same state)
//
// The HP form is implemented as "input minus LP output" using the same
// stored state, which is the canonical 1-pole complementary construction:
// it guarantees LP + HP = input exactly (bit-equal in float32 math), so
// wiring `in → onePole(lp) + onePole(hp) → sum` reconstructs the signal.
//
// Relation to #17 dcBlock:
//   - dcBlock is a 1-pole HP pinned at fc ≈ 10 Hz, with a slightly
//     different topology (y[n] = x[n] − x[n−1] + R·y[n−1]) tuned for
//     zero DC gain and broadband-flat elsewhere. It's FB-loop-safe.
//   - onePole is the general-purpose filter; it still has 0 dB passband
//     gain but the HP form has a less sharp DC null than dcBlock and
//     shouldn't be used for feedback-trap duty. Use dcBlock for that.
//
// Stability:
//   - cutoff clamped to [1, sr/2 − 100]. Below 1 Hz a → 1 and the filter
//     stalls; above Nyquist, `exp` saturates and the pole degenerates.
//   - Denormal flush on the LP state (Canon:utilities §1): long silent
//     tails with microscopic residuals stall CPU on x86 without FTZ.

const MODES    = ['lp', 'hp'];
const DENORMAL = 1e-30;

export class OnePoleOp {
  static opId = 'onePole';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'mode',   default: 'lp' },
    { id: 'cutoff', default: 1000 },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._mode   = 'lp';
    this._cutoff = 1000;
    this._a      = 0;   // pole radius
    this._oma    = 1;   // (1 − a)
    this._y1     = 0;   // LP state
    this._recomputeCoefs();
  }

  reset() {
    this._y1 = 0;
  }

  setParam(id, v) {
    if (id === 'mode')   { this._mode = MODES.includes(v) ? v : 'lp'; }
    if (id === 'cutoff') { this._cutoff = +v; }
    this._recomputeCoefs();
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    const sr  = this.sr;
    const nyq = 0.5 * sr - 100;
    const fc  = Math.min(Math.max(this._cutoff, 1), nyq);
    // a = exp(-2π · fc / Fs). At fc → 0, a → 1 (full smoothing);
    // at fc → Nyquist, a → exp(-π) ≈ 0.0432 (near passthrough).
    this._a   = Math.exp(-2 * Math.PI * fc / sr);
    this._oma = 1 - this._a;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const a    = this._a;
    const oma  = this._oma;
    let   y1   = this._y1;
    const isHP = this._mode === 'hp';

    for (let i = 0; i < N; i++) {
      const x  = inCh[i];
      // LP step.
      let lp = oma * x + a * y1;
      if (lp < DENORMAL && lp > -DENORMAL) lp = 0;
      y1 = lp;
      // HP = input − LP (same-sample complementary).
      outCh[i] = isHP ? (x - lp) : lp;
    }

    this._y1 = y1;
  }
}
