// op_lookahead.worklet.js — Stage-3 op sidecar for the `lookahead` op.
//
// Catalog #45 (Dynamics). Pure primitive. Splits the audio path into
// two synchronized streams:
//   (a) `out`  = x[n − L]                  — the delayed audio ("payoff")
//   (b) `peak` = max |x[k]|, k∈[n−L, n]    — windowed absolute peak,
//                                            available L samples BEFORE the
//                                            transient reaches `out`.
// This is the structural primitive that enables brick-wall limiters,
// zero-overshoot compressors, and gate/expander v2 paths (logged as
// P1 debt on #41 gate and #42 expander).
//
// PRIMARY SOURCE SITUATION (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//
//   **Math-by-definition primitive — declared.** Pure-delay ring buffer
//   and windowed-max are both textbook. No single canonical implementation
//   worth pasting verbatim. The *efficient* windowed-max algorithm used
//   below is the monotonic-deque ("Ascending Minima") form attributed to
//   Daniel Lemire 2006 "Streaming Maximum-Minimum Filter Using No More
//   Than Three Comparisons per Element" (arXiv:cs/0610046). The PDF is
//   not in the repo; structural idea is well-known (competitive-
//   programming canon). Logged in research debt for a future primary
//   read and re-derivation against the paper's exact bounds.
//
// DECLARED SPEC (passage-equivalent):
//
//   L        = round(lookaheadMs · sr / 1000)   // clamped [0, maxSamps]
//   out[n]   = x[n − L]                         // delayed audio
//   peak[n]  = max_{k ∈ [n−L, n]} |x[k]|        // windowed absolute peak
//   getLatencySamples() = L                     // mandatory for bypass-contract
//
// DEVIATIONS FROM DECLARED SPEC:
//   1. L clamped to [0, ceil(sr · MAX_LOOKAHEAD_MS / 1000)] with
//      MAX_LOOKAHEAD_MS = 50 to bound memory. Beyond 50 ms the primitive
//      should be rebuilt as an FFT-based peak estimator or tapped structure.
//   2. `lookaheadMs` changes resize the ring lazily (next process call)
//      and reset state. No click-free real-time resize — block-rate
//      param updates are the sandbox default.
//   3. Windowed-max uses monotonic deque (O(1) amortized). Deque storage
//      is a pair of fixed-size arrays (values, indices) with head/tail
//      pointers — no heap churn per sample.
//   4. `peak` is control-kind (scalar stream) following the convention
//      of `envelope` / `detector`; downstream `gainComputer` consumes it.
//   5. L=0 degenerate case: out = x, peak = |x|, latency = 0.
//   6. No mix param — this is a shaper primitive, not a wet/dry effect.

const MAX_LOOKAHEAD_MS = 50;

export class LookaheadOp {
  static opId    = 'lookahead';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'out',  kind: 'audio' },
    { id: 'peak', kind: 'control' },
  ]);
  static params  = Object.freeze([
    { id: 'lookaheadMs', default: 5 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._lookaheadMs = 5;
    this._maxSamps = Math.ceil(sampleRate * MAX_LOOKAHEAD_MS / 1000) + 1;
    this._L = Math.max(0, Math.round(5 / 1000 * sampleRate));
    this._alloc();
  }

  _alloc() {
    const cap = this._maxSamps;
    this._buf     = new Float32Array(cap);      // ring of samples
    this._writeI  = 0;                          // next write index (mod cap)
    this._filled  = 0;                          // samples written since reset
    // Monotonic deque: values and source indices, in decreasing order.
    this._dqVals  = new Float32Array(cap);
    // Indices stored as regular JS numbers (Number[]) so the absolute-sample
    // counter can grow past Int32 range; avoids the ~12 h wraparound @48k.
    this._dqIdx   = new Array(cap).fill(0);
    this._dqHead  = 0;
    this._dqTail  = 0;                          // tail points past last used slot
    this._n       = 0;                          // global sample counter
  }

  reset() {
    this._buf.fill(0);
    this._writeI = 0;
    this._filled = 0;
    this._dqHead = 0;
    this._dqTail = 0;
    this._n = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'lookaheadMs') {
      const clamped = n < 0 ? 0 : (n > MAX_LOOKAHEAD_MS ? MAX_LOOKAHEAD_MS : n);
      this._lookaheadMs = clamped;
      const newL = Math.max(0, Math.round(clamped / 1000 * this.sr));
      if (newL !== this._L) {
        this._L = newL;
        this.reset(); // block-rate resize; no click-free reshape by design
      }
    }
  }

  getLatencySamples() { return this._L; }

  process(inputs, outputs, N) {
    const inp    = inputs.in;
    const outAud = outputs.out;
    const outPk  = outputs.peak;
    if (!outAud && !outPk) return;

    const L     = this._L;
    const cap   = this._buf.length;
    const buf   = this._buf;
    const dqV   = this._dqVals;
    const dqI   = this._dqIdx;
    let   wi    = this._writeI;
    let   filled = this._filled;
    let   head  = this._dqHead;
    let   tail  = this._dqTail;
    let   nAbs  = this._n;

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;

      // --- 1. Write into ring ---
      buf[wi] = x;

      // --- 2. Windowed-max deque push (monotonic-decreasing on value) ---
      const absX = x >= 0 ? x : -x;
      while (head !== tail && dqV[(tail - 1 + cap) % cap] <= absX) {
        tail = (tail - 1 + cap) % cap;
      }
      dqV[tail] = absX;
      dqI[tail] = nAbs;
      tail = (tail + 1) % cap;

      // --- 3. Expire deque front if it has fallen out of the L+1 window ---
      // Window spans samples [nAbs - L, nAbs]. Any index < nAbs - L is stale.
      while (head !== tail && dqI[head] < nAbs - L) {
        head = (head + 1) % cap;
      }

      // --- 4. Emit. Before the ring is L-full, out = 0 (zero-prepad
      //     convention to keep latency reported matching audible delay). ---
      const peakVal = head !== tail ? dqV[head] : 0;
      let outVal;
      if (L === 0) {
        outVal = x;
      } else if (filled < L) {
        outVal = 0;
      } else {
        const readI = (wi - L + cap) % cap;
        outVal = buf[readI];
      }
      if (outAud) outAud[i] = outVal;
      if (outPk)  outPk[i]  = peakVal;

      wi = (wi + 1) % cap;
      if (filled < cap) filled++;
      nAbs++;
    }

    this._writeI = wi;
    this._filled = filled;
    this._dqHead = head;
    this._dqTail = tail;
    this._n      = nAbs;
  }
}
