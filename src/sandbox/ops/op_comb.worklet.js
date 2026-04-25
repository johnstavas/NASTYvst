// op_comb.worklet.js — Stage-3 op sidecar for the `comb` op.
//
// Catalog #36 (Tone/Filter). Classic comb filter — feedforward OR feedback.
// Building block for Schroeder reverbs, flangers, Karplus-Strong, chorus,
// pitch-shift via variable-delay, resonant body models.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - Julius O. Smith III, "Physical Audio Signal Processing":
//       https://ccrma.stanford.edu/~jos/pasp/Feedforward_Comb_Filters.html
//       https://ccrma.stanford.edu/~jos/pasp/Feedback_Comb_Filters.html
//     License: CCRMA online text, reference use for reimplementation.
//
// PASSAGES VERBATIM:
//
//   Feedforward comb (FIR, tapped sum):
//       y(n) = b₀ x(n) + b_M x(n-M)
//
//   Feedback comb (IIR, single recursive tap):
//       y(n) = x(n) + g y(n-M)
//     "|a_M| < 1 to prevent exponentially growing echoes"
//     "Models exponentially decaying, uniformly spaced echoes
//      (like plane waves bouncing between parallel walls)"
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Mode param exposes both forms.** Rather than ship two ops, one
//      `mode` param switches: mode=0 → feedforward, mode=1 → feedback.
//      Both formulas encoded exactly as pasted above.
//   2. **Gain naming.** Smith uses `b₀`, `b_M` for feedforward and `g`
//      (or `-a_M`) for feedback. We expose a single `g` param with
//      mode-dependent semantics: FF → b_M (with b₀=1 fixed), FB → g.
//   3. **Stability clamp.** Smith states `|g| < 1` requirement for FB;
//      we clamp `|g| ≤ 0.999` when in feedback mode to prevent runaway
//      on set-to-1.0 user input (declared deviation — pure passage
//      would allow g = 1 and blow up).
//   4. **Delay specified in ms, not samples.** Samples = round(ms/1000*sr),
//      clamped to [1, maxDelayMs·sr/1000]. maxDelayMs = 500 default →
//      24000 samples at 48 kHz (covers chorus to long-slapback range).
//   5. **Integer delay only.** No fractional-delay Lagrange/Thiran
//      interpolation in v1. P2 debt: fractional delay for smooth
//      flanger sweeps and precise pitch.
//   6. **Denormal flush** on delay-line reads.

const DENORMAL = 1e-30;

const MODE_FF = 0;
const MODE_FB = 1;

export class CombOp {
  static opId = 'comb';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'mode',       default: 1   }, // 0=FF, 1=FB
    { id: 'delayMs',    default: 10  },
    { id: 'g',          default: 0.7 },
    { id: 'maxDelayMs', default: 500 },
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._mode    = MODE_FB;
    this._delay   = 0;       // samples
    this._g       = 0.7;
    this._maxMs   = 500;
    this._buf     = null;    // delay line
    this._bufLen  = 0;
    this._writeIdx = 0;
    this._allocBuf(500);
    this._setDelayMs(10);
  }

  reset() {
    if (this._buf) this._buf.fill(0);
    this._writeIdx = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'mode') {
      this._mode = (n >= 0.5) ? MODE_FB : MODE_FF;
    } else if (id === 'delayMs') {
      this._setDelayMs(n);
    } else if (id === 'g') {
      this._g = n;
    } else if (id === 'maxDelayMs') {
      const m = Math.min(Math.max(n, 1), 10000);
      if (m !== this._maxMs) {
        this._maxMs = m;
        this._allocBuf(m);
        this._setDelayMs(this._delay / this.sr * 1000);
      }
    }
  }

  getLatencySamples() { return 0; }

  _allocBuf(maxMs) {
    const maxSamples = Math.max(2, Math.ceil(maxMs / 1000 * this.sr) + 1);
    this._buf      = new Float64Array(maxSamples);
    this._bufLen   = maxSamples;
    this._writeIdx = 0;
  }

  _setDelayMs(ms) {
    let d = Math.round(ms / 1000 * this.sr);
    if (d < 1) d = 1;
    if (d > this._bufLen - 1) d = this._bufLen - 1;
    this._delay = d;
  }

  _effectiveG() {
    // Clamp |g| < 1 in feedback mode for stability (deviation 3).
    if (this._mode === MODE_FB) {
      const G = 0.999;
      return this._g >  G ?  G : (this._g < -G ? -G : this._g);
    }
    return this._g;
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const buf  = this._buf;
    const blen = this._bufLen;
    const D    = this._delay;
    const g    = this._effectiveG();

    if (this._mode === MODE_FF) {
      // y(n) = x(n) + g · x(n-M)
      for (let i = 0; i < N; i++) {
        const x = inp ? inp[i] : 0;
        const readIdx = (this._writeIdx - D + blen) % blen;
        let xDelayed = buf[readIdx];
        if (xDelayed > -DENORMAL && xDelayed < DENORMAL) xDelayed = 0;
        buf[this._writeIdx] = x;
        this._writeIdx = (this._writeIdx + 1) % blen;
        out[i] = x + g * xDelayed;
      }
    } else {
      // y(n) = x(n) + g · y(n-M)
      for (let i = 0; i < N; i++) {
        const x = inp ? inp[i] : 0;
        const readIdx = (this._writeIdx - D + blen) % blen;
        let yDelayed = buf[readIdx];
        if (yDelayed > -DENORMAL && yDelayed < DENORMAL) yDelayed = 0;
        const y = x + g * yDelayed;
        buf[this._writeIdx] = y;
        this._writeIdx = (this._writeIdx + 1) % blen;
        out[i] = y;
      }
    }
  }
}
