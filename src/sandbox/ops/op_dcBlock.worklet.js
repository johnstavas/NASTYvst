// op_dcBlock.worklet.js — Stage-3 op sidecar for the `dcBlock` op.
//
// SHIP-CRITICAL: DC rejection under feedback is a hard ship-gate
// (memory/ship_blockers.md — "DC rejection under FB"). This op is the
// canonical inline fix — drop on any feedback return to kill DC buildup
// before it runs the loop away.
//
// Topology: 1-pole DC-blocker, the standard difference-equation form:
//   H(z) = (1 - z^-1) / (1 - R · z^-1)
//   y[n] = x[n] - x[n-1] + R · y[n-1]
//
// Zero at DC (z=1) → infinite attenuation at DC. Pole at z=R controls the
// -3 dB cutoff:
//   R = exp(-2π · fc / Fs)
// For fc=10 Hz @ 48 kHz, R ≈ 0.998694. Using exp (not the linear approx
// 1 - 2π·fc/Fs) keeps cutoff accurate at sub-20 Hz corners where the
// approximation errors by a few Hz.
//
// Why not just use filter.hp? Two reasons per memory/opRegistry.js comment:
//   1. `filter` is 2-pole biquad (RBJ Canon:filters §9). Overkill for a
//      DC trap and twice the math in the hot feedback loop.
//   2. `filter`'s default mode is LP; using it as a DC trap is a schema
//      surprise. dcBlock has one job and an unambiguous default cutoff.
//
// Denormal flush per Canon:utilities §1 (Jon Watte) — the y-state is the
// classic denormal source when input goes quiet on a feedback return.

const DENORMAL = 1e-30;

export class DcBlockOp {
  static opId = 'dcBlock';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoff', default: 10 },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._cutoff = 10;
    this._R      = Math.exp(-2 * Math.PI * this._cutoff / this.sr);
    this._x1     = 0;
    this._y1     = 0;
  }

  reset() {
    this._x1 = 0;
    this._y1 = 0;
  }

  setParam(id, v) {
    if (id === 'cutoff') {
      // Registry clamps cutoff to [1, 200]; guard defensively anyway.
      const fc = Math.max(0.01, Math.min(+v, 0.45 * this.sr));
      this._cutoff = fc;
      this._R = Math.exp(-2 * Math.PI * fc / this.sr);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    let x1 = this._x1;
    let y1 = this._y1;
    const R = this._R;
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      let   y = x - x1 + R * y1;
      // Jon Watte denormal flush (Canon:utilities §1, SHIP-CRITICAL).
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      outCh[i] = y;
      x1 = x;
      y1 = y;
    }
    this._x1 = x1;
    this._y1 = y1;
  }
}
