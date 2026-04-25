// op_quantizer.worklet.js — Stage-3 op sidecar for the `quantizer` op.
//
// Catalog #98 (Control primitives). Snap-to-grid quantizer for
// control signals.
//
//   y = offset + f((x − offset) / step) · step
//
// where f ∈ {round, floor, ceil} selected by `mode`.
//
// step=0 → passthrough (bypass; avoids divide-by-zero).
//
// USE
//
//   Stepped LFO         — feed LFO output in, choose step=1/N for N
//                         discrete levels per unit.
//   Semitone snap (CV)  — step=1 with a CV expressed in semitones, or
//                         step=1/12 on a normalized 0..1 pitch CV.
//   Macro snap          — quantise a 0..1 macro to N discrete positions
//                         with step=1/(N-1).
//
// Distinct from `bitcrush` (#26): bitcrush quantises audio AMPLITUDE
// in fixed 2^bits levels across [-1, +1]; quantizer is arbitrary-step
// snap on any control-range signal.
//
// MODES
//
//   round (default) — symmetric half-to-even-ish rounding (JS Math.round
//                     rounds half-up; acceptable for control ranges).
//   floor           — always rounds down (monotone-non-increasing on
//                     descent; useful for "arp on grid" semantics).
//   ceil            — always rounds up (rare, kept for completeness).
//
// LATENCY: zero. Stateless.
// DENORMALS: no recursive state; not an issue here.

export class QuantizerOp {
  static opId = 'quantizer';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'step',   default: 0.125 },
    { id: 'offset', default: 0     },
    { id: 'mode',   default: 'round' },  // 'round' | 'floor' | 'ceil' or 0/1/2
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._step    = 0.125;
    this._offset  = 0;
    this._mode    = 0;   // 0 = round, 1 = floor, 2 = ceil
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'mode') {
      if (typeof v === 'string') {
        if      (v === 'round') this._mode = 0;
        else if (v === 'floor') this._mode = 1;
        else if (v === 'ceil')  this._mode = 2;
        // unknown string: sticky last-good
      } else {
        const n = +v;
        if (Number.isFinite(n)) {
          const m = Math.round(n);
          this._mode = (m === 1 || m === 2) ? m : 0;
        }
      }
      return;
    }
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'step') {
      // Negative step doesn't make sense — take absolute value.
      // step=0 is valid (bypass semantics handled in process).
      this._step = n < 0 ? -n : n;
    } else if (id === 'offset') {
      this._offset = n;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    const step   = this._step;
    const offset = this._offset;
    const mode   = this._mode;

    if (!inCh) {
      // No input: treat as all-zero input. Quantise 0 → offset +
      // f((0-offset)/step)·step.
      if (step === 0) {
        for (let i = 0; i < N; i++) outCh[i] = 0;
        return;
      }
      const t = -offset / step;
      let q;
      if      (mode === 1) q = Math.floor(t);
      else if (mode === 2) q = Math.ceil(t);
      else                 q = Math.round(t);
      const v = offset + q * step;
      for (let i = 0; i < N; i++) outCh[i] = v;
      return;
    }

    if (step === 0) {
      // Bypass.
      for (let i = 0; i < N; i++) outCh[i] = inCh[i];
      return;
    }

    const inv = 1 / step;
    if (mode === 1) {
      for (let i = 0; i < N; i++) outCh[i] = offset + Math.floor((inCh[i] - offset) * inv) * step;
    } else if (mode === 2) {
      for (let i = 0; i < N; i++) outCh[i] = offset + Math.ceil ((inCh[i] - offset) * inv) * step;
    } else {
      for (let i = 0; i < N; i++) outCh[i] = offset + Math.round((inCh[i] - offset) * inv) * step;
    }
  }
}
