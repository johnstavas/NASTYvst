// op_bitcrush.worklet.js — Stage-3 op sidecar for the `bitcrush` op.
//
// Catalog #14 (Character family). Pure bit-depth quantization: snap each
// sample to the nearest step on a signed 2^bits-level grid over [-1, +1].
//
// Research: Canon:character §8 (memory/dsp_code_canon_character.md) —
// Dither + 2nd-Order Noise Shaping, which is the mastering-grade form of
// bit-depth reduction. This op ships the primitive core (no dither, no
// noise-shaping) because:
//   (A) The mastering NS stage is a separate op — catalog slot #114
//       noiseShaper. Authors compose `bitcrush → noiseShaper` when they
//       want transparent reduction; wire raw `bitcrush` when they want
//       the stepped character deliberately (lofi / bit-reduction FX).
//   (B) Dither is a separate op too (#115 dither). Same composition rule.
//
// Math:
//   levels = 2^bits            (e.g. 4 bits → 16 levels)
//   step   = 2 / levels        (distance between adjacent levels over ±1)
//   y      = round(x / step) · step
//
// bits = 0 is a true bypass (registry default): same-sample passthrough,
// bit-exact. This satisfies the bypass contract (ship_blockers.md).
//
// bits clamp: invalid values (NaN, negative, > 16) fall to 0 (bypass).
//
// Stateless: no reset state, no denormal concern (output is on a discrete
// grid — no subnormal tail ever).

export class BitcrushOp {
  static opId = 'bitcrush';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'bits', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr    = sampleRate;
    this._bits = 0;  // 0 = off / passthrough
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'bits') {
      const b = Math.round(+v);
      this._bits = (!Number.isFinite(b) || b < 0 || b > 16) ? 0 : b;
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
    const bits = this._bits;
    if (bits === 0) {
      // Bypass contract: bit-exact passthrough.
      for (let i = 0; i < N; i++) outCh[i] = inCh[i];
      return;
    }
    // levels = 2^bits; step = 2 / levels; invStep = levels / 2.
    const invStep = (1 << bits) * 0.5;
    const step    = 1 / invStep;
    for (let i = 0; i < N; i++) {
      outCh[i] = Math.round(inCh[i] * invStep) * step;
    }
  }
}
