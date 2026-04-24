// op_loudnessGate.worklet.js — Stage-3 op sidecar for the `loudnessGate` op.
//
// Catalog #53 (Loudness / Metering). ITU-R BS.1770-5 §5.1 two-stage
// absolute-then-relative gating for INTEGRATED loudness.
//
// PIPELINE POSITION
//
//   audio → #51 kWeighting → loudnessGate → integrated LUFS (control)
//
// The upstream K-weighting handles the spectral side of BS.1770. This op
// handles the temporal/statistical side: rectangular 400 ms blocks on a
// 100 ms hop, two-stage gate, arithmetic mean of MS over the survivors,
// final LUFS conversion.
//
// ALGORITHM (BS.1770-5 §5.1, verbatim)
//
//   1. Partition the stream into 400 ms rectangular blocks, hopped every
//      100 ms (75% overlap). We implement this as a ring of four
//      100 ms sub-blocks; a full 400 ms block is the sum-of-squares of
//      the last four sub-blocks.
//
//   2. For each 400 ms block k, compute
//        MS_k = (1/blockLen) · Σ x²[n]     over samples in block k
//        L_k  = -0.691 + 10·log10(G · MS_k)     // LUFS equivalent
//
//   3. Absolute gate:  keep block k if L_k > Γ_abs where Γ_abs = -70 LUFS
//      (equivalently, MS_k > 10^((-70+0.691)/10) / G).
//
//   4. Compute ungated loudness over the abs-passing blocks:
//        Γ_rel = -0.691 + 10·log10(G · mean(MS_k : L_k > Γ_abs)) - 10 LU
//      (per spec, relative threshold is ungated loudness minus 10 LU.)
//
//   5. Relative gate: keep block k if both L_k > Γ_abs AND L_k > Γ_rel.
//
//   6. Integrated LUFS over the twice-gated pool:
//        L_I = -0.691 + 10·log10(G · mean(MS_k : two-gate-passing))
//
// RE-GATING ON EACH UPDATE
//
// Γ_rel depends on the running mean of the abs-passing pool, which
// changes with every new block. The spec requires re-applying the
// relative gate to the whole abs-passing history, not just the newest
// block. Our implementation stores every abs-passing block's MS in an
// array, and re-scans the whole array on each new block boundary.
//
// Memory: one Float64 per abs-passing block. Cap at MAX_BLOCKS to bound
// RAM; user is expected to call reset() between programme chunks.
//
// STATE HANDLING
//
// - Output is sample-accurate but block-boundary-quantized: the running
//   integrated value is computed once per 100 ms hop and held between
//   updates (the spec is statistical, not continuous).
// - Before the first full 400 ms block has elapsed, output is the
//   LUFS_FLOOR sentinel (≈ -120 LUFS, same as lufsIntegrator silence).
// - reset() clears the abs-passing pool and sub-block accumulators.
//
// Denormal flush on the sub-block accumulators per Jon Watte
// (Canon:utilities §1).

const LUFS_OFFSET   = -0.691;
const LUFS_FLOOR    = -120.691;        // -0.691 + 10·log10(1e-12)
const MS_FLOOR      = 1e-12;
const ABS_THRESH_DB = -70;              // Γ_abs per BS.1770-5
const REL_OFFSET_DB = -10;              // relative gate is ungated -10 LU
const MAX_BLOCKS    = 36000;            // 1 hour @ 100 ms hops
const DENORMAL      = 1e-30;

export class LoudnessGateOp {
  static opId = 'loudnessGate';
  static inputs  = Object.freeze([{ id: 'in',   kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'lufs', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'channelWeight', default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr          = sampleRate;
    this._G          = 1.0;
    this._subLen     = Math.round(sampleRate * 0.1);   // samples per 100 ms sub-block
    this._blockLen   = this._subLen * 4;               // 400 ms block
    this._subAcc     = 0;                              // Σ x² in current sub-block
    this._subCount   = 0;                              // samples into current sub-block
    this._subRing    = new Float64Array(4);            // last 4 sub-blocks' Σ x²
    this._subRingFill = 0;                             // how many sub-blocks filled so far
    this._subIdx     = 0;                              // ring write index
    // MS of every abs-passing block, in chronological order.
    this._absPassMS  = new Float64Array(MAX_BLOCKS);
    this._absPassN   = 0;
    // Last-computed integrated LUFS (held between hop boundaries).
    this._integratedLufs = LUFS_FLOOR;
  }

  reset() {
    this._subAcc     = 0;
    this._subCount   = 0;
    this._subRing.fill(0);
    this._subRingFill = 0;
    this._subIdx     = 0;
    this._absPassN   = 0;
    this._integratedLufs = LUFS_FLOOR;
  }

  setParam(id, v) {
    if (id === 'channelWeight') {
      const n = +v;
      if (!Number.isFinite(n)) return;
      this._G = n < 0 ? 0 : (n > 2 ? 2 : n);
    }
  }

  getLatencySamples() { return 0; }

  // Called once per 100 ms boundary. Takes the just-completed sub-block,
  // pushes it into the ring, and if the ring is full (≥ 4 sub-blocks)
  // computes a new 400 ms block MS, applies abs gate, stores, then
  // re-gates and recomputes the integrated value.
  _closeSubBlock(subSumSq) {
    this._subRing[this._subIdx] = subSumSq;
    this._subIdx = (this._subIdx + 1) & 3;
    if (this._subRingFill < 4) {
      this._subRingFill++;
      if (this._subRingFill < 4) return; // not enough yet
    }
    // Full 400 ms block: sum the four sub-blocks' Σ x²
    const blockSumSq =
      this._subRing[0] + this._subRing[1] + this._subRing[2] + this._subRing[3];
    const ms = blockSumSq / this._blockLen;
    const G  = this._G;
    // L_k > Γ_abs  <=>  -0.691 + 10·log10(G·MS) > -70
    //              <=>  G·MS > 10^((-70+0.691)/10)
    const absPassMin = Math.pow(10, (ABS_THRESH_DB - LUFS_OFFSET) / 10);
    if (G * ms <= absPassMin) return;                  // abs gate rejects
    if (this._absPassN >= MAX_BLOCKS) return;          // cap → silently stop
    this._absPassMS[this._absPassN++] = ms;

    // Re-compute relative threshold from the whole abs-passing pool.
    let sum = 0;
    for (let i = 0; i < this._absPassN; i++) sum += this._absPassMS[i];
    const meanMsAbs = sum / this._absPassN;
    // Γ_rel as an MS threshold: L_rel = ungated - 10 LU
    //   L_ungated = -0.691 + 10·log10(G·meanMsAbs)
    //   L_rel     = L_ungated + REL_OFFSET_DB
    //   MS_rel    = 10^((L_rel - LUFS_OFFSET) / 10) / G
    //             = meanMsAbs · 10^(REL_OFFSET_DB / 10)
    //             = meanMsAbs · 0.1
    const msRel = meanMsAbs * 0.1;
    // Integrate over blocks passing both gates.
    let sum2 = 0, n2 = 0;
    for (let i = 0; i < this._absPassN; i++) {
      if (this._absPassMS[i] > msRel) {
        sum2 += this._absPassMS[i];
        n2++;
      }
    }
    if (n2 === 0) {
      this._integratedLufs = LUFS_FLOOR;
      return;
    }
    let meanMs2 = sum2 / n2;
    if (G * meanMs2 < MS_FLOOR) meanMs2 = MS_FLOOR / G || MS_FLOOR;
    this._integratedLufs = LUFS_OFFSET + 10 * Math.log10(G * meanMs2);
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.lufs;
    if (!outCh) return;
    const subLen = this._subLen;
    let subAcc   = this._subAcc;
    let subCount = this._subCount;
    const heldOut = () => this._integratedLufs;

    if (!inCh) {
      // Decay nothing; integrated LUFS is a statistical memory and just
      // holds. But we must still advance the sub-block counter with zero
      // energy so future blocks stay aligned with real time.
      for (let i = 0; i < N; i++) {
        subCount++;
        if (subCount >= subLen) {
          this._closeSubBlock(subAcc);
          subAcc   = 0;
          subCount = 0;
        }
        outCh[i] = this._integratedLufs;
      }
      // Denormal flush
      if (subAcc < DENORMAL && subAcc > -DENORMAL) subAcc = 0;
      this._subAcc   = subAcc;
      this._subCount = subCount;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      subAcc += x * x;
      subCount++;
      if (subCount >= subLen) {
        this._closeSubBlock(subAcc);
        subAcc   = 0;
        subCount = 0;
      }
      outCh[i] = this._integratedLufs;
    }
    if (subAcc < DENORMAL && subAcc > -DENORMAL) subAcc = 0;
    this._subAcc   = subAcc;
    this._subCount = subCount;
  }
}
