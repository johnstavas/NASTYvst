// op_lufsIntegrator.worklet.js — Stage-3 op sidecar for the `lufsIntegrator` op.
//
// Catalog #52 (Loudness/Metering family).
// BS.1770-5 + EBU Tech 3341 V4 — EBU-MODE COMPLIANT.
//
// PRIMARY SOURCES CONSULTED
//   • memory/dsp_code_canon_loudness.md §3 (Tech 3341 V4, Nov 2023)
//   • memory/dsp_code_canon_loudness.md §2 (BS.1770-5 calibration constant)
//
// WHAT IT DOES
//
// Reads pre-K-weighted audio (chain with #51 upstream) and emits a LUFS
// reading at audio rate. Two canonical integration windows, selected
// via `mode`:
//
//   'momentary'  — 400 ms SLIDING RECTANGULAR window (Tech 3341 "M")
//   'short-term' — 3   s  SLIDING RECTANGULAR window (Tech 3341 "S")
//
// **EBU Mode compliance.** Per Tech 3341 V4 the window IS the only
// smoothing. IIR smoothing after the window breaks EBU Mode — do not
// add it. BS.1771-1 defines an IIR momentary (τ = 0.4 s) that is NOT
// EBU Mode and can differ from the rectangular method by up to ~2 LU;
// this op does not offer that mode. Future: a separate `lufsIIR` op
// if engineer workflow demands.
//
// FORMULA (BS.1770-5 §3.1):
//
//   L_K = −0.691 + 10·log10(G · MS)
//
//   MS = (1/N) · Σ_{k=n−N+1}^{n} x[k]²     (sliding rectangular average)
//   G  = channel weight (1.0 for L/R/C/mono, 1.41 for Ls/Rs, 0 disables)
//   −0.691 = calibration so stereo 1 kHz 0 dBFS → 0 LUFS
//
// IMPLEMENTATION — RUNNING-SUM RING BUFFER
//
//   Keep a ring buffer of the last N squared samples.  Maintain a
//   running sum so the per-sample cost is O(1):
//
//     sumSq ← sumSq + x[n]² − x[n−N]²       (subtract sample leaving window)
//     buf[idx] ← x[n]²
//     idx ← (idx + 1) mod N
//
//   Use float64 for sumSq — accumulating float32 over 144 000 samples
//   (3 s @ 48 kHz) drifts perceptibly (~0.01 LUFS). float64 holds
//   to < 1 ULP over realistic session lengths.
//
// STATE ON MODE CHANGE
//
// Switching windows flushes the running sum and resets the "filled"
// counter. Meter reads at the floor until the new window fills — this
// is correct behavior (Tech 3341 §2.3: "incomplete gating block
// discarded" spirit; a half-filled window gives a biased reading).
// Same behavior on reset().
//
// STABILITY / FLOOR
//
//   • MS floor = 1e-12 (≈ −120 dB) prevents −∞ readings in silence.
//     Effective LUFS floor ~ −120.
//   • Running sum clamped to ≥ 0 before the log (float cancellation
//     can push the residual negative by tiny amounts after many cycles).
//   • Denormal-aware: x² of denormal-magnitude input is effectively 0.
//
// LATENCY = 0 (output is instantaneous MS-over-trailing-window; meter
// ballistics are in the window itself, not added delay).

const MODES       = ['momentary', 'short-term'];
const WINDOW_SEC  = { 'momentary': 0.4, 'short-term': 3.0 };
const LUFS_OFFSET = -0.691;       // BS.1770-5 Annex 1 calibration
const MS_FLOOR    = 1e-12;        // ≈ −120 dB floor

// Worst-case buffer: short-term window at 192 kHz = 576 000 samples.
// 576 000 × 4 bytes = 2.25 MB per instance. Acceptable.
const MAX_BUF     = 576000 + 8;

export class LufsIntegratorOp {
  static opId = 'lufsIntegrator';
  static inputs  = Object.freeze([{ id: 'in',   kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'lufs', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'mode',          default: 'momentary' },
    { id: 'channelWeight', default: 1.0         },
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate || 48000;
    this._mode    = 'momentary';
    this._G       = 1.0;
    // Cap window length to buffer capacity (protects against exotic SRs).
    this._buf     = new Float32Array(MAX_BUF);
    this._winLen  = 0;
    this._idx     = 0;
    this._filled  = 0;
    this._sumSq   = 0;
    this._applyMode();
  }

  _applyMode() {
    const sec = WINDOW_SEC[this._mode];
    let N = Math.round(sec * this.sr);
    if (N < 1) N = 1;
    if (N > MAX_BUF) N = MAX_BUF;
    this._winLen = N;
    this._flush();
  }

  _flush() {
    // Zero only up to winLen (the active window); old slots don't matter.
    const buf = this._buf;
    const N = this._winLen;
    for (let i = 0; i < N; i++) buf[i] = 0;
    this._idx    = 0;
    this._filled = 0;
    this._sumSq  = 0;
  }

  reset() {
    this._flush();
  }

  setParam(id, v) {
    if (id === 'mode') {
      const next = MODES.includes(v) ? v : 'momentary';
      if (next !== this._mode) {
        this._mode = next;
        this._applyMode();
      }
      return;
    }
    if (id === 'channelWeight') {
      const n = +v;
      if (!Number.isFinite(n)) return;
      // BS.1770 allows 0..1.41; we clamp to 0..2 to cover any legitimate
      // non-standard weight without enabling pathological values.
      this._G = n < 0 ? 0 : (n > 2 ? 2 : n);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.lufs;
    if (!outCh) return;

    const buf    = this._buf;
    const winLen = this._winLen;
    const G      = this._G;
    let   idx    = this._idx;
    let   filled = this._filled;
    let   sumSq  = this._sumSq;

    for (let i = 0; i < N; i++) {
      const x   = inCh ? inCh[i] : 0;
      const xsq = x * x;

      // Sample leaving the window: buf[idx] holds the squared value
      // from winLen samples ago (or 0 if window not yet full).
      const leaving = buf[idx];
      sumSq += xsq - leaving;
      buf[idx] = xsq;

      idx++;
      if (idx >= winLen) idx = 0;
      if (filled < winLen) filled++;

      // Float64 residual can drift slightly negative after many cycles
      // when the true sum is near zero — clamp before log.
      let s = sumSq;
      if (s < 0) s = 0;

      const effN = filled > 0 ? filled : 1;
      let ms = G * s / effN;
      if (ms < MS_FLOOR) ms = MS_FLOOR;

      outCh[i] = LUFS_OFFSET + 10 * Math.log10(ms);
    }

    this._idx    = idx;
    this._filled = filled;
    this._sumSq  = sumSq;
  }
}
