// op_msDecode.worklet.js — Stage-3 op sidecar for the `msDecode` op.
//
// Catalog #23 (Routing). Decodes a Mid/Side pair back to Left/Right.
// Math-by-definition sum-and-difference matrix — declared as such per
// sandbox_op_ship_protocol.md § "If no primary exists".
//
// PRIMARY CITATIONS (opened 2026-04-24):
//   - Blumlein, A. D. (1933). "Improvements in and relating to
//     Sound-transmission, Sound-recording, and Sound-reproducing Systems",
//     British Patent GB 394,325. Canonical introduction of the stereo
//     sum/difference (M/S) matrix.
//   - In-repo authoritative precedent (copied bit-for-bit):
//       src/core/dspWorklet.js:1040–1047  (WidthModule — encode/decode)
//       src/finisherEngine.js:99–100     (decode matrix line)
//
// PASSAGE VERBATIM — src/core/dspWorklet.js:1043–1046:
//     const m  = (xL + xR) * 0.5;
//     const s  = (xL - xR) * 0.5 * w;
//     outL[i] = m + s;
//     outR[i] = m - s;
//
// Decode-only matrix (this op takes M and S directly, not L/R):
//     L = M + S
//     R = M - S
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Decode only — no width scaling.** WidthModule does encode + scale +
//      decode in one pass; this op is the lower-half (decode) only. Width
//      scaling lives in op #32 `stereoWidth`. Declared deviation.
//   2. **No 0.5 scaling.** WidthModule's `0.5` factor is part of the *encode*
//      step (mid = (L+R)/2, side = (L-R)/2). Pure decode is L=M+S, R=M-S
//      with no scaling — inverse of the encode. Confirmed: encode(decode)
//      round-trips: given M,S → L=M+S, R=M-S → M'=(L+R)/2 = M, S'=(L-R)/2 = S.
//   3. **Missing-input tolerance.** If either `mid` or `side` input is
//      missing, that leg is treated as zero — matches how other ops
//      (filter, comb) handle absent inputs. Deviation from a strict
//      "require both inputs" interpretation.
//   4. **No denormals expected.** Pure add/subtract is denormal-clean;
//      no flush needed (no feedback path, no recursion).

export class MsDecodeOp {
  static opId = 'msDecode';
  static inputs  = Object.freeze([
    { id: 'mid',  kind: 'audio' },
    { id: 'side', kind: 'audio' },
  ]);
  static outputs = Object.freeze([
    { id: 'left',  kind: 'audio' },
    { id: 'right', kind: 'audio' },
  ]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
  }

  reset() { /* stateless */ }
  setParam(_id, _v) { /* no params */ }
  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const mid  = inputs.mid;
    const side = inputs.side;
    const outL = outputs.left;
    const outR = outputs.right;

    for (let i = 0; i < N; i++) {
      const m = mid  ? mid[i]  : 0;
      const s = side ? side[i] : 0;
      if (outL) outL[i] = m + s;
      if (outR) outR[i] = m - s;
    }
  }
}
