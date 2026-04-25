// op_lra.worklet.js — Stage-3 op sidecar for the `lra` op.
//
// Catalog #55 (Loudness / Metering). EBU Tech 3342 Loudness Range (LRA).
//
// PIPELINE POSITION
//
//   audio → #51 kWeighting → lra → LRA (control, LU)
//
// K-weighting lives upstream (same as lufsIntegrator and loudnessGate).
// This op handles the temporal/statistical side: 3-second short-term
// blocks on a 100 ms hop, two-stage gate, then 10th/95th percentile
// difference of the survivor pool.
//
// ALGORITHM (EBU Tech 3342 v3, referencing BS.1770-5)
//
//   1. Partition the K-weighted stream into 3000 ms rectangular blocks,
//      hopped every 100 ms (that is, each new block shares 2900 ms with
//      the previous). We implement as a ring of 30 × 100 ms sub-blocks;
//      a full 3 s block is the sum-of-squares of all 30 sub-blocks.
//
//   2. For each short-term (ST) block k, compute
//        MS_k = (1/blockLen) · Σ x²[n]   over samples in block k (3 s)
//        L_k  = -0.691 + 10·log10(G · MS_k)    // LUFS equivalent
//
//   3. Absolute gate:  keep L_k if L_k > -70 LUFS
//      (BS.1770 §5.1 abs gate, identical threshold to integrated loudness).
//
//   4. Compute ungated mean of L_k over the abs-passing pool.
//
//   5. Relative gate: keep L_k if L_k > (ungated mean - 20 LU).
//      NOTE: Tech 3342 uses -20 LU here, NOT -10 LU (the -10 LU value is
//      for the integrated-loudness gate in BS.1770 §5.1). This is the
//      single most-often-confused constant in broadcast loudness work;
//      the -20 LU is deliberately wider so LRA captures programme
//      dynamics not just foreground loudness.
//
//   6. Of the twice-gated pool, sort by loudness and take:
//        LRA = L95 - L10
//      i.e. 95th percentile minus 10th percentile (in LU).
//
// RE-COMPUTE ON EVERY UPDATE
//
// Like the integrated-loudness gate, the relative threshold depends on
// the running mean of the abs-passing pool, which changes with every
// new ST block. We re-scan the whole abs-passing history on each new
// 100 ms hop, compute the relative threshold, collect survivors, sort,
// pick percentiles. This is O(n log n) per hop — for 1 h @ 100 ms hops
// (36000 ST values) that's ~500 k comparisons / hop = 5 M / sec worst
// case, acceptable.
//
// PERCENTILE CONVENTION — Tech 3342 V4 §5 (Nov 2023), nearest-rank 1-based.
//
// Canonical formula (must match libebur128 / TC reference bit-for-bit):
//   p_idx_1based = round((n-1) * p/100 + 1)
//   Lp = sorted[p_idx_1based - 1]   (0-based array access)
// Equivalent 0-based:
//   p_idx_0 = round((n-1) * p/100)
// Clamped to [0, n-1]. NOT floor(p·n) — that drifts off-by-one at p=95%.
//
// EDGE CASES
//
// - Fewer than one full 3 s block has elapsed → LRA = 0.
// - Gated pool empty after both gates → LRA = 0 (not NaN; Tech 3342
//   Annex A explicitly defines 0 as the "no valid data" sentinel).
//
// Denormal flush on the sub-block accumulator per Jon Watte
// (Canon:utilities §1).

const LUFS_OFFSET   = -0.691;
const ABS_THRESH_DB = -70;
const REL_OFFSET_DB = -20;     // Tech 3342 — NOT -10 like integrated gate
const SUB_PER_BLOCK = 30;      // 30 × 100 ms = 3 s
const MAX_BLOCKS    = 36000;   // 1 h @ 100 ms hops — O(1) RAM cap
const DENORMAL      = 1e-30;

export class LraOp {
  static opId = 'lra';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'lra', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'channelWeight', default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._G         = 1.0;
    this._subLen    = Math.round(sampleRate * 0.1);            // 100 ms
    this._blockLen  = this._subLen * SUB_PER_BLOCK;            // 3 s
    this._subAcc    = 0;
    this._subCount  = 0;
    this._subRing   = new Float64Array(SUB_PER_BLOCK);
    this._subRingFill = 0;
    this._subIdx    = 0;
    // Per-ST-block MS of everything that passed the abs gate.
    this._absPassMS = new Float64Array(MAX_BLOCKS);
    this._absPassN  = 0;
    // Scratch buffer reused for percentile sort (avoids per-hop allocation).
    this._scratch   = new Float64Array(MAX_BLOCKS);
    this._lraLU     = 0;
  }

  reset() {
    this._subAcc     = 0;
    this._subCount   = 0;
    this._subRing.fill(0);
    this._subRingFill = 0;
    this._subIdx     = 0;
    this._absPassN   = 0;
    this._lraLU      = 0;
  }

  setParam(id, v) {
    if (id === 'channelWeight') {
      const n = +v;
      if (!Number.isFinite(n)) return;
      this._G = n < 0 ? 0 : (n > 2 ? 2 : n);
    }
  }

  getLatencySamples() { return 0; }

  // Close the just-completed 100 ms sub-block. Once the ring has 30
  // sub-blocks filled, we have a full ST block → gate → push → re-scan.
  _closeSubBlock(subSumSq) {
    this._subRing[this._subIdx] = subSumSq;
    this._subIdx = (this._subIdx + 1) % SUB_PER_BLOCK;
    if (this._subRingFill < SUB_PER_BLOCK) {
      this._subRingFill++;
      if (this._subRingFill < SUB_PER_BLOCK) return;
    }

    // Full 3 s block: sum all 30 sub-blocks' Σ x²
    let blockSumSq = 0;
    for (let i = 0; i < SUB_PER_BLOCK; i++) blockSumSq += this._subRing[i];
    const ms = blockSumSq / this._blockLen;
    const G  = this._G;

    // Abs gate: L_k > -70 LUFS  <=>  G·MS > 10^((-70+0.691)/10)
    const absPassMin = Math.pow(10, (ABS_THRESH_DB - LUFS_OFFSET) / 10);
    if (G * ms <= absPassMin) return;
    if (this._absPassN >= MAX_BLOCKS) return;
    this._absPassMS[this._absPassN++] = ms;

    this._recomputeLRA();
  }

  _recomputeLRA() {
    const n = this._absPassN;
    if (n === 0) { this._lraLU = 0; return; }

    const G = this._G;
    // Ungated mean MS → ungated LUFS.
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this._absPassMS[i];
    const meanMsAbs = sum / n;
    // Relative threshold as an MS: L_rel = L_ungated - 20 LU
    //   MS_rel = meanMsAbs · 10^(-20/10) = meanMsAbs · 0.01
    const msRel = meanMsAbs * 0.01;

    // Collect survivors into scratch, converting to LUFS as we go.
    let m = 0;
    for (let i = 0; i < n; i++) {
      const msi = this._absPassMS[i];
      if (msi > msRel) {
        this._scratch[m++] = LUFS_OFFSET + 10 * Math.log10(G * msi);
      }
    }
    if (m === 0) { this._lraLU = 0; return; }

    // Sort survivors ascending.
    // Float64Array.subarray().sort is ascending numeric by default — matches
    // BS.1770 / Tech 3342 convention (lowest loudness at index 0).
    const view = this._scratch.subarray(0, m);
    view.sort();

    // Nearest-rank percentile per Tech 3342 V4 §5:
    //   p_idx_0 = round((m-1) · p/100), clamped to [0, m-1]
    const i10 = Math.min(m - 1, Math.max(0, Math.round((m - 1) * 0.10)));
    const i95 = Math.min(m - 1, Math.max(0, Math.round((m - 1) * 0.95)));
    this._lraLU = view[i95] - view[i10];
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.lra;
    if (!outCh) return;
    const subLen = this._subLen;
    let subAcc   = this._subAcc;
    let subCount = this._subCount;

    if (!inCh) {
      // No input — advance timing (a silent sub-block has MS=0, will
      // fail abs gate and be dropped, but the ring index must stay in
      // sync with wall-clock time). Hold last LRA.
      for (let i = 0; i < N; i++) {
        subCount++;
        if (subCount >= subLen) {
          this._closeSubBlock(subAcc);
          subAcc = 0;
          subCount = 0;
        }
        outCh[i] = this._lraLU;
      }
      if (subAcc < DENORMAL && subAcc > -DENORMAL) subAcc = 0;
      this._subAcc = subAcc;
      this._subCount = subCount;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      subAcc += x * x;
      subCount++;
      if (subCount >= subLen) {
        this._closeSubBlock(subAcc);
        subAcc = 0;
        subCount = 0;
      }
      outCh[i] = this._lraLU;
    }
    if (subAcc < DENORMAL && subAcc > -DENORMAL) subAcc = 0;
    this._subAcc = subAcc;
    this._subCount = subCount;
  }
}
