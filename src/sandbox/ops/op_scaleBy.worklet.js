// op_scaleBy.worklet.js — Stage-3 op sidecar for the `scaleBy` op.
//
// Catalog #29 (Control primitives). Linear static multiplier: `out = k · in`.
//
// Role vs #1 gain:
//   - `gain` is the user-facing level primitive: dB-based with gainMod
//     summing, designed for per-sample modulation into a level bus.
//   - `scaleBy` is the raw linear scalar — used anywhere the right
//     abstraction is "multiply this signal by a number", including:
//       • trimming an LFO/envelope's depth before routing to a param
//         (envelope.env → scaleBy → gain.gainMod)
//       • polarity flip (k = -1) without going through dB math
//       • mute (k = 0) on a control or audio line
//
// Research: none — single multiply. Template still enforced:
//   - Bypass contract: k=1 → bit-exact passthrough (ship_blockers.md).
//   - Mute: k=0 → all zeros.
//   - Negative k: polarity flip, symmetric with positive (odd behavior).
//
// Stateless. No reset state, no denormal concern (multiply preserves zero).

export class ScaleByOp {
  static opId = 'scaleBy';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'k', default: 1 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._k = 1;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'k') {
      const n = +v;
      this._k = Number.isFinite(n) ? n : 1;
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
    const k = this._k;
    if (k === 1) {
      // Bypass contract: bit-exact passthrough.
      for (let i = 0; i < N; i++) outCh[i] = inCh[i];
      return;
    }
    if (k === 0) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    for (let i = 0; i < N; i++) outCh[i] = k * inCh[i];
  }
}
