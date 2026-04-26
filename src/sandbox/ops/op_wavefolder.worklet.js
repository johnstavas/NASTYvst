// op_wavefolder.worklet.js — Stage-3 op sidecar for the `wavefolder` op.
//
// Character / drive stage. Non-monotonic transfer function: above a
// threshold, output FOLDS BACK toward zero rather than soft-saturating
// toward an asymptote. This is the buchla / serge / make-noise wavefolder
// fingerprint — even harmonics, ring-mod-like timbre at high drive,
// distinct from any tanh/atan/Padé sigmoid.
//
// Math: Faust `ef.wavefold` (David Braun, MIT — declared in
// faust_misceffects.lib line 1243+, header citing Zölzer Ch 10 Fig 10.7,
// "Digital Audio Signal Processing" John Wiley & Sons 2022).
//
//   makeOdd(f, x) = (x >= 0) ? f(x) : -f(-x)
//   f(x) = ((x > 1-2a) ? tri : x) * g
//     a   = clamp(width, 0, 1) * 0.4         // adjusted width ∈ [0, 0.4]
//     g   = 1 / (1 - 2a)                     // peak-level normalization
//     tri = 1 - 2.5a + a · |frac((x - (1-2a))/(2a)) - 0.5|
//
// At width=0  → a=0, threshold=1, g=1: pass-through (no folding).
// At width=1  → a=0.4, threshold=0.2, g=5: |x|>0.2 enters fold zone,
//   producing a triangle wave that peaks at +1 at x=0.2 and folds back
//   to 0 at x=0.6, +1 again at x=1.0 — the classic wavefolder shape.
//
// SHIP-DIFFERENTIATION from saturate / softLimit:
//   - saturate: monotonic Padé tanh — sigmoid asymptote at ±1.
//   - softLimit: threshold-scaled Padé — bounded ceiling for FB safety.
//   - wavefolder: NON-MONOTONIC — output goes back DOWN past threshold.
//     Generates even harmonics that sigmoids can't. Distinct primitive.
//
// Authoring contract mirrors saturate (drive + trim), with `width`
// added as the folder-shape control:
//   drive:  pre-gain pushing signal past threshold (× 1..8)
//   width:  fold-zone width [0..1] (0 = no fold, 1 = max fold)
//   trim:   post-gain in dB
//
// Stateless: no reset state, no denormal concern.
//
// Primary citation (verbatim from faust_misceffects.lib § 1243-1259,
// MIT-licensed, David Braun 2024, citing Zölzer 2022):
//   wavefold(width, x) = makeOdd(f, x)
//   with {
//     f(x) = ba.if(x>(1-2*a), tri, x) : *(g)
//       with {
//         a = width : aa.clip(0, 1) : *(.4);
//         g = 1/(1-2*a);
//         tri = 1 - 2.5*a + a*abs(ma.frac((x-(1-2*a))/(2*a))-.5);
//       };
//   };

export class WavefolderOp {
  static opId = 'wavefolder';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive', default: 1 },
    { id: 'width', default: 0.5 },
    { id: 'trim',  default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._drive   = 1;
    this._width   = 0.5;
    this._trimLin = 1;  // 10^(0/20)
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'drive') {
      // Registry clamps 1..8; guard defensively. Drive < 0.01 would mute.
      const x = +v;
      this._drive = Number.isFinite(x) ? Math.max(0.01, x) : 1;
    } else if (id === 'width') {
      const x = +v;
      this._width = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5;
    } else if (id === 'trim') {
      const x = +v;
      this._trimLin = Number.isFinite(x) ? Math.pow(10, x / 20) : 1;
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
    // Faust math (per primary citation above).
    const a       = this._width * 0.4;          // adjusted width [0, 0.4]
    const thr     = 1 - 2 * a;                  // 1-2a — threshold
    // Guard g against width≈0 case where 2a→0 (g→1, safe). At width=1,
    // 2a=0.8, g=5. At width=0, 2a=0, g=1 — both finite.
    const g       = 1 / (Math.max(1e-9, thr));  // 1/(1-2a) — peak norm
    const twoA    = 2 * a;                      // for frac scaling
    const triBase = 1 - 2.5 * a;                // constant part of tri
    for (let i = 0; i < N; i++) {
      let x = inCh[i] * drive;
      // makeOdd: process |x|, restore sign at end.
      const sign = x < 0 ? -1 : 1;
      const ax = sign * x;  // absolute value of x
      let y;
      if (ax > thr && a > 0) {
        // Fold zone: triangle of period 2a starting at thr.
        const u = (ax - thr) / twoA;
        const f = u - Math.floor(u);   // ma.frac (positive, in [0,1))
        const tri = triBase + a * Math.abs(f - 0.5);
        y = tri * g;
      } else {
        // Linear zone (or width=0): just gain.
        y = ax * g;
      }
      outCh[i] = trimLin * sign * y;
    }
  }
}
