// op_saturate.worklet.js — Stage-3 op sidecar for the `saturate` op.
//
// Character / drive stage. Pre-gain (`drive`) pushes signal into the
// Padé rational tanh's nonlinear region to generate odd-order harmonics;
// post-gain (`trim`, in dB) lets the author set output level without
// re-stacking gain on top of the nonlinear bend.
//
// Math: Canon §11 Padé rational tanh (memory/dsp_code_canon_character.md).
//
//   padé(u) = u · (27 + u²) / (27 + 9u²)       on u ∈ [-3, 3]
//   padé(u) = sign(u)                          for |u| > 3   (hard clip)
//   y = 10^(trim/20) · padé(drive · x)
//
// Why Padé not tanh():
//   - Canon §11: ~2.6% error, C² continuous at ±3, single-precision fast,
//     identical form to analog-model NL stages (ladder diff-amp, tube).
//   - Branchless sign + rational — no transcendental in the hot path.
//
// Why no output normalization (unlike some designs that divide by
// tanh(drive) to keep RMS constant):
//   - Padé is bounded to ±1 intrinsically — output never exceeds ±1
//     regardless of drive. Authors who want unity-RMS matching can wrap
//     saturate in a gainComputer/detector pair, but that's a composition,
//     not a default. Default = "what you turned up is what you hear louder".
//
// SHIP-DIFFERENTIATION from `softLimit`:
//   - softLimit: threshold-scaled Padé, default threshold=0.95 (nearly
//     transparent). Role = bounded ceiling for feedback safety.
//   - saturate:  drive-scaled Padé, default drive=1 (fully transparent).
//     Role = drive/color/harmonics. Same research, different framing.
//
// Stateless: no reset state, no denormal concern.

export class SaturateOp {
  static opId = 'saturate';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive', default: 1 },
    { id: 'trim',  default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._drive = 1;
    this._trimLin = 1;  // 10^(0/20)
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'drive') {
      // Registry clamps to [1, 16]; guard defensively. Drive < ~0.01
      // would effectively mute the signal before the curve — not useful.
      this._drive = Math.max(0.01, +v);
    } else if (id === 'trim') {
      // trim is in dB; convert to linear scale factor.
      this._trimLin = Math.pow(10, (+v) / 20);
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
    const drive   = this._drive;
    const trimLin = this._trimLin;
    for (let i = 0; i < N; i++) {
      let u = inCh[i] * drive;
      if (u >  3) u =  3;
      else if (u < -3) u = -3;
      // Canon §11 Padé rational tanh.
      const u2 = u * u;
      outCh[i] = trimLin * u * (27 + u2) / (27 + 9 * u2);
    }
  }
}
