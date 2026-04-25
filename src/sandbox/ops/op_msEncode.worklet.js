// op_msEncode.worklet.js — Stage-3 op sidecar for the `msEncode` op.
//
// Catalog #22 (Routing). Encodes a Left/Right pair into Mid/Side.
// Math-by-definition sum-and-difference matrix — declared as such per
// sandbox_op_ship_protocol.md § "If no primary exists".
//
// PRIMARY CITATIONS (opened 2026-04-24):
//   - Blumlein, A. D. (1933). "Improvements in and relating to
//     Sound-transmission, Sound-recording, and Sound-reproducing Systems",
//     British Patent GB 394,325. Canonical introduction of the stereo
//     sum/difference (M/S) matrix.
//   - In-repo authoritative precedent:
//       src/core/dspWorklet.js:1043–1044  (WidthModule encode lines)
//
// PASSAGE VERBATIM — src/core/dspWorklet.js:1043–1044:
//     const m  = (xL + xR) * 0.5;
//     const s  = (xL - xR) * 0.5 * w;   // the *w belongs to width-scale, not encode
//
// Pure encode matrix (this op does encode only, no width scaling):
//     M = (L + R) / 2
//     S = (L - R) / 2
//
// The 0.5 factor is mandatory for round-trip consistency with op #23
// msDecode (L=M+S, R=M-S): encode→decode must be identity.
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Encode only — no width scaling.** WidthModule does encode + scale +
//      decode in one pass; this op is the upper-half (encode) only. Width
//      scaling lives in op #32 `stereoWidth`. Declared deviation.
//   2. **0.5 factor preserved.** Matches Blumlein canonical form and
//      guarantees msEncode ∘ msDecode = identity given the decode matrix
//      L=M+S, R=M−S we shipped in #23.
//   3. **Missing-input tolerance.** If either `left` or `right` input is
//      missing, that leg is treated as zero — matches how other ops
//      (filter, comb, msDecode) handle absent inputs.
//   4. **No denormals expected.** Pure add/subtract/scale is denormal-clean;
//      no flush needed (no feedback path, no recursion).

export class MsEncodeOp {
  static opId = 'msEncode';
  static inputs  = Object.freeze([
    { id: 'left',  kind: 'audio' },
    { id: 'right', kind: 'audio' },
  ]);
  static outputs = Object.freeze([
    { id: 'mid',  kind: 'audio' },
    { id: 'side', kind: 'audio' },
  ]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
  }

  reset() { /* stateless */ }
  setParam(_id, _v) { /* no params */ }
  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inL = inputs.left;
    const inR = inputs.right;
    const outM = outputs.mid;
    const outS = outputs.side;

    for (let i = 0; i < N; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : 0;
      if (outM) outM[i] = (l + r) * 0.5;
      if (outS) outS[i] = (l - r) * 0.5;
    }
  }
}
