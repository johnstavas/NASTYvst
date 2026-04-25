// op_meters.worklet.js — Stage-3 op sidecar for the `meters` op.
//
// Catalog #46 (Dynamics). Dual-ballistic metering primitive: emits a
// peak-hold envelope AND a windowed RMS envelope in parallel, driven by
// the same input. Purpose: feed a UI meter widget without requiring the
// graph to split the signal through #49 peak + #50 rms separately. Also
// carries a `standard` preset enum that loads industry-standard ballistics
// (VU, PPM, digital peak-hold).
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//
//   Both primaries are in-tree shipped sibling ops (canonical repo files
//   per the protocol's "primary = canonical repo file" rule).
//
//   Peak ballistics:
//     src/sandbox/ops/op_peak.worklet.js, lines 14–23
//       (IEC 60268-10 / BS.1770-5 peak envelope, shipped row #49)
//
//   RMS averaging:
//     src/sandbox/ops/op_rms.worklet.js, lines 17–20
//       (one-pole mean-square averager, shipped row #50)
//
// PASSAGES VERBATIM:
//
//   From op_peak.worklet.js L14–L23:
//     Instant attack:      if |x[n]| > y[n−1]:  y[n] = |x[n]|
//     Exponential release: else:                 y[n] = r · y[n−1]
//
//     release coefficient mapped from "60 dB fall time":
//       r = exp(ln(0.001) / (release_sec · Fs))
//         = exp(−6.907755 / (release_sec · Fs))
//
//   From op_rms.worklet.js L17–L20:
//     α  = exp(−1 / (τ · Fs))
//     p[n] = (1 − α)·x[n]² + α·p[n−1]
//     y[n] = sqrt(p[n])
//
// STANDARD PRESETS (ballistics table):
//
//   'vu'      : RMS 300 ms window (IEC 60268-17 VU meter);
//               peak release 1700 ms (for auxiliary peak readout).
//   'ppm'     : RMS 10 ms;  peak release 1700 ms (IEC 60268-10 Type I PPM
//               "1.7 s return time from reference to −20 dB").
//   'digital' : RMS 300 ms; peak release 3000 ms (slow DAW peak-hold).
//   'custom'  : use `peakReleaseMs` + `rmsWindowMs` params as-is.
//
// PASSAGE ↔ CODE DEVIATIONS (enumerated):
//   1. **Composition, not transcription.** The PEAK and RMS math is
//      copied bit-for-bit from the shipped sibling ops (#49, #50).
//      This op adds the preset layer + dual-emit convenience but does
//      not introduce new DSP. Covered by the sibling ops' test suites;
//      this op's tests verify the composition is faithful.
//   2. **Denormal flush** on both held states per repo convention.
//   3. **Clamps**: peak release [1, 30000] ms (matches #49);
//                  rms window   [1, 30000] ms (matches #50).
//   4. **No mix / dry-wet**. Metering is monitor-only. Emits control-rate
//      signals; does not pass audio through.
//   5. **Mono**. Stereo metering wraps in graph-level stereo pair and
//      selects max (peak) / sum-then-sqrt (rms) at the brick layer.
//   6. **Control-kind outputs** (matching #49 and #50). Downstream meter
//      widgets read per-sample but typically decimate to 30/60 Hz.
//
// LATENCY: 0 samples.

const LN_1E_MINUS_3 = -6.907755278982137;  // ln(0.001), 60 dB
const DENORMAL      = 1e-30;

const STANDARDS = {
  vu:      { peakReleaseMs: 1700, rmsWindowMs: 300  },
  ppm:     { peakReleaseMs: 1700, rmsWindowMs: 10   },
  digital: { peakReleaseMs: 3000, rmsWindowMs: 300  },
  custom:  null,
};

export class MetersOp {
  static opId    = 'meters';
  static inputs  = Object.freeze([{ id: 'in',   kind: 'audio'   }]);
  static outputs = Object.freeze([
    { id: 'peak', kind: 'control' },
    { id: 'rms',  kind: 'control' },
  ]);
  static params  = Object.freeze([
    { id: 'standard',       default: 'vu'  },          // enum: vu|ppm|digital|custom
    { id: 'peakReleaseMs',  default: 1700 },           // [1, 30000]
    { id: 'rmsWindowMs',    default: 300  },           // [1, 30000]
  ]);

  constructor(sampleRate) {
    this.sr            = sampleRate;
    this._standard     = 'vu';
    this._peakRelMs    = 1700;
    this._rmsWinMs     = 300;
    // Coefficients
    this._rCoef = 0;
    this._alpha = 0;
    this._oma   = 1;
    // State
    this._peakY = 0;
    this._p     = 0;
    this._applyStandard();
    this._recomputeCoefs();
  }

  reset() {
    this._peakY = 0;
    this._p     = 0;
  }

  setParam(id, v) {
    if (id === 'standard') {
      const key = String(v);
      this._standard = STANDARDS.hasOwnProperty(key) ? key : 'vu';
      this._applyStandard();
      this._recomputeCoefs();
      return;
    }
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'peakReleaseMs') {
      this._peakRelMs = n;
      this._standard = 'custom';
      this._recomputeCoefs();
    } else if (id === 'rmsWindowMs') {
      this._rmsWinMs = n;
      this._standard = 'custom';
      this._recomputeCoefs();
    }
  }

  _applyStandard() {
    const s = STANDARDS[this._standard];
    if (!s) return;  // 'custom' — keep whatever user set
    this._peakRelMs = s.peakReleaseMs;
    this._rmsWinMs  = s.rmsWindowMs;
  }

  _recomputeCoefs() {
    // Peak release — op_peak L78–L83
    const relMs = Math.min(Math.max(this._peakRelMs, 1), 30000);
    this._rCoef = Math.exp(LN_1E_MINUS_3 / ((relMs / 1000) * this.sr));
    // RMS window — op_rms one-pole
    const winMs = Math.min(Math.max(this._rmsWinMs, 1), 30000);
    const tau   = winMs / 1000;
    this._alpha = Math.exp(-1 / (tau * this.sr));
    this._oma   = 1 - this._alpha;
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inp     = inputs.in;
    const peakOut = outputs.peak;
    const rmsOut  = outputs.rms;
    if (!peakOut && !rmsOut) return;

    if (!inp) {
      if (peakOut) for (let i = 0; i < N; i++) peakOut[i] = 0;
      if (rmsOut)  for (let i = 0; i < N; i++) rmsOut[i]  = 0;
      return;
    }

    const r     = this._rCoef;
    const alpha = this._alpha;
    const oma   = this._oma;
    let y       = this._peakY;
    let p       = this._p;

    for (let i = 0; i < N; i++) {
      const x  = inp[i];
      const ax = x >= 0 ? x : -x;

      // Peak — op_peak L14-L15
      if (ax > y) y = ax;
      else        y = r * y;
      if (y > -DENORMAL && y < DENORMAL) y = 0;

      // RMS — op_rms L18-L20
      p = oma * (x * x) + alpha * p;
      if (p < 0) p = 0;
      if (p < DENORMAL) p = 0;

      if (peakOut) peakOut[i] = y;
      if (rmsOut)  rmsOut[i]  = Math.sqrt(p);
    }

    this._peakY = y;
    this._p     = p;
  }
}
