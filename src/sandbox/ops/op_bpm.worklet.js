// op_bpm.worklet.js — Stage-3 op sidecar for the `bpm` op.
//
// Catalog #75 (Analysis/Spectral). Energy-based beat detector with
// variance-driven adaptive threshold.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - Frédéric Patin, "Beat Detection Algorithms", Feb 2003, pp. 5–7.
//     PDF: https://www.flipcode.com/misc/BeatDetectionAlgorithms.pdf
//     License: "free and without any modification", non-commercial
//     use permitted; this is a reimplementation, not a verbatim copy.
//
// PASSAGES VERBATIM (Simple Sound Energy Algorithm #3, p. 7):
//
//   Every 1024 samples :
//     - Compute the instant sound energy `e` on the 1024 new samples
//       taken in (an) and (bn) using:
//         (R1)  e = Σ_{k=i0}^{i0+1024}  a[k]² + b[k]²
//     - Compute the average local energy <E> with (E) sound energy
//       history buffer using:
//         (R3)  <E> = (1/43) · Σ_{i=0}^{43} E[i]
//     - Compute the variance `V` of the energies in (E) using:
//         (R4)  V = (1/43) · Σ_{i=0}^{43} (E[i] − <E>)²
//     - Compute the `C` constant using a linear regression with
//       (V≈200 → C≈1.0) and (V≈25 → C≈1.45):
//         (R6)  C = (−0.0025714 · V) + 1.5142857
//     - Shift (E) right, pile new `e` at E[0].
//     - Compare `e` to `C · <E>`, if superior we have a beat !
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Mono input.** Patin's R1 sums squared amplitudes of both stereo
//      channels; our op has one `in` port. Callers pre-mix L+R if desired.
//      Numerically: e_stereo = e_left + e_right, so a single input carrying
//      (L+R) pre-summed gives the same magnitude behavior under the same
//      C·<E> comparison. Declared deviation.
//   2. **Configurable windowN and histDepth.** Patin hardcodes 1024 /
//      43 because he's writing at 44.1 kHz. We expose both as params
//      (defaults 1024 and 43) — a caller running at 48 kHz with a
//      1-second history should set histDepth = 46 (48000 / 1024 ≈ 46.9).
//   3. **Early-cold guard.** Before the history is full, <E> and V
//      aren't calibrated; we suppress beat output during the first
//      `histDepth` windows. Declared deviation (Patin is silent on
//      the warm-up edge).
//   4. **No C clamp.** Formula R6 goes below 1.0 at V > 200 and can
//      pass zero at V > 589. Patin reports test-program use without
//      a clamp; we stay faithful (P2 debt: optional C-floor param).
//   5. **Output shape.** Two outputs: `energy` (continuous held instant
//      energy value, `e/windowN` normalized per-sample for dimensional
//      consistency with amplitude-domain signals) and `beat` (single-
//      sample trigger pulse of 1.0 at window boundary on detection,
//      else 0). The energy value itself (unnormalized sum) is not
//      musically useful as a continuous signal.
//   6. **Denormal flush** on energy and history entries (Canon:utilities §1).

const DENORMAL = 1e-30;

export class BpmOp {
  static opId = 'bpm';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'energy', kind: 'audio' },
    { id: 'beat',   kind: 'audio' },
  ]);
  static params  = Object.freeze([
    { id: 'windowN',   default: 1024 }, // analysis window (samples)
    { id: 'histDepth', default: 43   }, // history entries (~1s at 44.1k)
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._windowN   = 1024;
    this._histDepth = 43;

    this._buf       = new Float64Array(1024);
    this._writeIdx  = 0;
    this._filled    = 0;

    this._hist      = new Float64Array(43);
    this._histPos   = 0;  // write pointer (next slot to fill)
    this._framesSeen = 0;

    this._heldE     = 0;
    this._heldBeat  = 0;
    this._readIdx   = 0;
  }

  reset() {
    if (this._buf)  this._buf.fill(0);
    if (this._hist) this._hist.fill(0);
    this._writeIdx  = 0;
    this._filled    = 0;
    this._histPos   = 0;
    this._framesSeen = 0;
    this._heldE     = 0;
    this._heldBeat  = 0;
    this._readIdx   = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'windowN') {
      const W = Math.min(Math.max(Math.round(n), 32), 16384);
      if (W !== this._windowN) {
        this._windowN = W;
        this._buf     = new Float64Array(W);
        this._writeIdx = 0;
        this._filled   = 0;
        this._readIdx  = 0;
      }
    } else if (id === 'histDepth') {
      const H = Math.min(Math.max(Math.round(n), 2), 512);
      if (H !== this._histDepth) {
        this._histDepth = H;
        this._hist      = new Float64Array(H);
        this._histPos   = 0;
        this._framesSeen = 0;
      }
    }
  }

  getLatencySamples() { return this._windowN; }

  _computeFrame() {
    const W = this._windowN;
    const H = this._histDepth;

    // R1 (mono adaptation): e = Σ_{k=0}^{W-1} x[k]²
    let e = 0;
    const buf = this._buf;
    for (let k = 0; k < W; k++) {
      const s = buf[k];
      e += s * s;
    }
    if (e < DENORMAL) e = 0;

    // Warm-up: not enough history yet → emit energy but no beat yet.
    const haveFullHistory = this._framesSeen >= H;

    let isBeat = false;
    if (haveFullHistory) {
      // R3: <E> = (1/H) · Σ E[i]
      const hist = this._hist;
      let sum = 0;
      for (let i = 0; i < H; i++) sum += hist[i];
      const Eavg = sum / H;

      // R4: V = (1/H) · Σ (E[i] − <E>)²
      let vSum = 0;
      for (let i = 0; i < H; i++) {
        const d = hist[i] - Eavg;
        vSum += d * d;
      }
      const V = vSum / H;

      // R6: C = −0.0025714·V + 1.5142857
      const C = (-0.0025714 * V) + 1.5142857;

      // Condition: e > C · <E>
      if (e > C * Eavg) isBeat = true;
    }

    // Shift-in semantics: "Shift (E) right, pile new e at E[0]."
    // We implement as a circular ring; semantic equivalence holds since
    // <E> and V are both order-invariant over the H slots.
    this._hist[this._histPos] = e;
    this._histPos = (this._histPos + 1) % H;
    this._framesSeen++;

    // Hold energy as per-sample amplitude-normalized value (deviation 5).
    this._heldE    = e / W;
    this._heldBeat = isBeat ? 1 : 0;
    this._readIdx  = 0;
  }

  process(inputs, outputs, N) {
    const inp  = inputs.in;
    const outE = outputs.energy;
    const outB = outputs.beat;

    const W = this._windowN;
    for (let i = 0; i < N; i++) {
      if (outE) outE[i] = this._heldE;
      if (outB) outB[i] = (this._readIdx === 0 ? this._heldBeat : 0);
      this._readIdx = (this._readIdx + 1) % W;

      this._buf[this._writeIdx] = inp ? inp[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % W;
      this._filled++;

      if (this._filled >= W) {
        this._filled = 0;
        this._computeFrame();
      }
    }
  }
}
