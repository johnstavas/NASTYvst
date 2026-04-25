// op_fdnCore.worklet.js — Stage-3 op sidecar for the `fdnCore` op.
//
// Catalog #20 (Space / reverb primitive). 8-channel Feedback Delay
// Network with Householder orthogonal feedback and per-channel HF shelf.
// The reverb-family workhorse: every full reverb plugin in the Shags
// catalog wraps this core (per reverb_engine_architecture.md "ALL
// reverbs use Geraint Luff FDN standard").
//
// RESEARCH LINEAGE
//
//   • Stautner & Puckette 1982, "Designing multi-channel reverberators"
//     (CMJ 6(1)): first published feedback delay network for reverb.
//   • Jot & Chaigne 1991, "Digital delay networks for designing
//     artificial reverberators" (AES Preprint 3030): modern FDN
//     framework, paraunitary feedback matrices, frequency-dependent
//     decay via per-channel absorption filters. Canon.
//   • Geraint Luff 2021, "Let's Write A Reverb" (signalsmith-audio.co.uk
//     /writing/2021/lets-write-a-reverb/): practical recipe —
//     exponentially-spaced delays, Householder (not full Hadamard)
//     feedback, 1.5 kHz HF-shelf absorption.
//   • This op mirrors the proven shipped path in
//     src/morphReverbEngine.js (morphreverb-v6), minus the
//     outer-engine pieces (diffusers, ER, WARP LFO, MIX).
//
// ALGORITHM (per-sample loop — ORDER MATTERS)
//
// 8 parallel delay lines with exponentially spaced lengths:
//     delayMs[c] = 100 * 2^(c/8)   → 100, 108.95, …, 183.40 ms
//
//   1. Read r[c] = delay[c].read()
//   2. Householder mix FIRST (N=8, 2/N = 0.25):
//        s = (Σ r)·0.25
//        m[c] = r[c] − s
//      Orthogonal reflection about the all-ones vector. Energy-
//      preserving. Less mixing than Hadamard so channels stay distinct
//      (Luff: "too much mixing locks delays together").
//   3. HF shelf on post-mixed signal (frequency-dependent decay):
//        fsh[c] += shelfCoeff · (m[c] − fsh[c])     // LP tracker
//        fb[c]   = m[c] · g_hf + fsh[c] · g_shelf   // split HF vs. LF decay
//      where g_hf < g_dc (HF dies faster), g_shelf = g_dc − g_hf,
//      shelfCoeff = 1 − exp(-2π · 1500 / sr).
//   4. Per-channel safety clamp (±1.8) — belt-and-braces against
//      transient overflow at high decay. From morphReverbEngine v6.
//   5. Write: delay[c] = x·inSpread + fb[c]
//   6. Output: mono sum (Σ r) / sqrt(8) (energy-normalized — taken
//      from the pre-mix raw reads, so output spectrum isn't
//      Householder-colored)
//
// DECAY PARAMETERIZATION (from reverb_engine_architecture.md)
//
//   rt60(s) = 0.3 * 100^decay          // 0.3s … 30s, exponential
//   g_dc    = 10^(-60 / (20 · rt60 / loopMs))
//           = 10^(-3 · loopMs / rt60)
//   loopMs  = 150 (geometric-ish mean of the 8 delays — proven in morphReverbEngine)
//
// Top 1% (decay ≥ 0.99): clamp g_dc to 0.9998 → infinite / freeze mode.
//
// HF parameterization:
//   g_hf    = g_dc * (0.02 + hf · 0.97)   // 0.02 = almost-dead HF, 0.99 = full HF
//   g_shelf = g_dc − g_hf
//   shelfCoeff = 1 − exp(-2π · 1500 / sr)  // 1.5 kHz corner
//
// PARAMETERS
//
//   decay  (0..1, default 0.5)  — RT60 0.3s…30s (exponential), freeze at 0.99+
//   hf     (0..1, default 0.7)  — HF retention ratio; low = dark tail, high = bright
//
// USE
//
//   • Reverb-family core — wrap with pre-delay + diffuser + ER + mix to
//     build a full room/hall/plate/spring engine
//   • Chorus-bed / space-pad — with decay low and hf high, makes a short
//     smeared shimmer (diffusion without tail)
//   • Spectral smear send — insert on modular chain for ambient wash
//
// LATENCY = 0 (reads before write within the same sample).
//
// LIMITS (v1)
//
//   • Fixed 8 delay lines, exponential spacing 100…200ms. Luff's article
//     treats spacing as a knob (range knob); here it's fixed to the
//     proven ratio. Upgrade path: expose `spread` param scaling the
//     base range.
//   • Mono sum output. Stereo decorrelation (tap channels 0,2,4,6 for L
//     and 1,3,5,7 for R, with Householder cross-spreading the energy)
//     is the natural extension — requires multi-output port support.
//   • Static delay lengths. LFO modulation (Luff's WARP) is the upgrade
//     path — requires fractional delay reads.
//   • Single HF shelf corner (1.5 kHz). A 2-shelf or per-channel shelf
//     lattice would give richer spectral decay control.

const N_CH          = 8;
const INV_SQRT_N    = 1 / Math.sqrt(N_CH);           // 0.35355339...
const LOOP_MS_REF   = 150;                           // proven reference loop time
const HF_CORNER_HZ  = 1500;                          // shelf crossover

// Pre-computed delay-line lengths in ms (exponential 100 * 2^(c/8))
const DELAY_MS = new Float64Array(N_CH);
for (let c = 0; c < N_CH; c++) DELAY_MS[c] = 100 * Math.pow(2, c / N_CH);

export class FdnCoreOp {
  static opId = 'fdnCore';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'decay', default: 0.5 },
    { id: 'hf',    default: 0.7 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;

    // Per-channel delay lengths in samples.
    this._lens = new Int32Array(N_CH);
    // Max length determines buffer size; +1 to keep read/write split clean.
    let maxLen = 0;
    for (let c = 0; c < N_CH; c++) {
      const L = Math.max(1, Math.round(this.sr * DELAY_MS[c] * 0.001));
      this._lens[c] = L;
      if (L > maxLen) maxLen = L;
    }
    // One flat Float32 buffer per channel (circular).
    this._buf = [];
    for (let c = 0; c < N_CH; c++) {
      this._buf.push(new Float32Array(maxLen + 4));
    }
    this._idx = new Int32Array(N_CH);     // write/read index per channel
    this._fsh = new Float32Array(N_CH);   // per-channel shelf state

    // Params (raw 0..1)
    this._decay = 0.5;
    this._hf    = 0.7;

    // Derived (recomputed on setParam)
    this._gHf    = 0;
    this._gShelf = 0;
    this._shelfCoeff = 1 - Math.exp(-2 * Math.PI * HF_CORNER_HZ / this.sr);
    this._recomputeGains();
  }

  reset() {
    for (let c = 0; c < N_CH; c++) {
      this._buf[c].fill(0);
      this._idx[c] = 0;
      this._fsh[c] = 0;
    }
  }

  _recomputeGains() {
    const d = this._decay;
    let gDc;
    if (d >= 0.99) {
      gDc = 0.9998;  // freeze
    } else {
      const rt60 = 0.3 * Math.pow(100, d);                    // 0.3s → 30s
      const dbPerMs = -60 / (rt60 * 1000);                    // dB per ms of elapsed time
      const dbPerLoop = dbPerMs * LOOP_MS_REF;
      gDc = Math.pow(10, dbPerLoop * 0.05);
      if (gDc > 0.9997) gDc = 0.9997;
    }
    const hfRatio = 0.02 + this._hf * 0.97;                   // 0.02..0.99
    this._gHf    = gDc * hfRatio;
    this._gShelf = gDc - this._gHf;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'decay') {
      this._decay = n < 0 ? 0 : (n > 1 ? 1 : n);
      this._recomputeGains();
    } else if (id === 'hf') {
      this._hf = n < 0 ? 0 : (n > 1 ? 1 : n);
      this._recomputeGains();
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    const buf   = this._buf;
    const lens  = this._lens;
    const idx   = this._idx;
    const fsh   = this._fsh;
    const gHf    = this._gHf;
    const gShelf = this._gShelf;
    const sc     = this._shelfCoeff;

    // Input spread: driving all N channels with x/sqrt(N) preserves
    // input energy after the Householder reflection.
    const inSpread = INV_SQRT_N;

    // Local temp vector (stack-allocated via scalars below — N_CH=8).
    // We must read all 8 delay lines first (for the output sum AND for
    // Householder), then write in a second sweep.

    for (let s = 0; s < N; s++) {
      const x = inCh ? inCh[s] : 0;

      // ── 1. Read raw delay outputs ──
      const r0 = buf[0][idx[0]], r1 = buf[1][idx[1]], r2 = buf[2][idx[2]], r3 = buf[3][idx[3]];
      const r4 = buf[4][idx[4]], r5 = buf[5][idx[5]], r6 = buf[6][idx[6]], r7 = buf[7][idx[7]];

      // ── 2. Output = energy-normalised sum of raw reads (pre-mix) ──
      outCh[s] = (r0 + r1 + r2 + r3 + r4 + r5 + r6 + r7) * INV_SQRT_N;

      // ── 3. Householder mix FIRST: m[c] = r[c] − (2/N)·Σr ──
      const hh = (r0 + r1 + r2 + r3 + r4 + r5 + r6 + r7) * 0.25;
      let m0 = r0 - hh, m1 = r1 - hh, m2 = r2 - hh, m3 = r3 - hh;
      let m4 = r4 - hh, m5 = r5 - hh, m6 = r6 - hh, m7 = r7 - hh;

      // ── 4. Per-channel HF shelf on post-mix signal ──
      fsh[0] += sc * (m0 - fsh[0]); let f0 = m0 * gHf + fsh[0] * gShelf;
      fsh[1] += sc * (m1 - fsh[1]); let f1 = m1 * gHf + fsh[1] * gShelf;
      fsh[2] += sc * (m2 - fsh[2]); let f2 = m2 * gHf + fsh[2] * gShelf;
      fsh[3] += sc * (m3 - fsh[3]); let f3 = m3 * gHf + fsh[3] * gShelf;
      fsh[4] += sc * (m4 - fsh[4]); let f4 = m4 * gHf + fsh[4] * gShelf;
      fsh[5] += sc * (m5 - fsh[5]); let f5 = m5 * gHf + fsh[5] * gShelf;
      fsh[6] += sc * (m6 - fsh[6]); let f6 = m6 * gHf + fsh[6] * gShelf;
      fsh[7] += sc * (m7 - fsh[7]); let f7 = m7 * gHf + fsh[7] * gShelf;

      // ── 5. Safety clamp (morphReverbEngine v6 parity) ──
      if (f0 >  1.8) f0 =  1.8; else if (f0 < -1.8) f0 = -1.8;
      if (f1 >  1.8) f1 =  1.8; else if (f1 < -1.8) f1 = -1.8;
      if (f2 >  1.8) f2 =  1.8; else if (f2 < -1.8) f2 = -1.8;
      if (f3 >  1.8) f3 =  1.8; else if (f3 < -1.8) f3 = -1.8;
      if (f4 >  1.8) f4 =  1.8; else if (f4 < -1.8) f4 = -1.8;
      if (f5 >  1.8) f5 =  1.8; else if (f5 < -1.8) f5 = -1.8;
      if (f6 >  1.8) f6 =  1.8; else if (f6 < -1.8) f6 = -1.8;
      if (f7 >  1.8) f7 =  1.8; else if (f7 < -1.8) f7 = -1.8;

      // ── 6. Write & advance ──
      const inContrib = x * inSpread;
      buf[0][idx[0]] = f0 + inContrib; idx[0] = (idx[0] + 1) % lens[0];
      buf[1][idx[1]] = f1 + inContrib; idx[1] = (idx[1] + 1) % lens[1];
      buf[2][idx[2]] = f2 + inContrib; idx[2] = (idx[2] + 1) % lens[2];
      buf[3][idx[3]] = f3 + inContrib; idx[3] = (idx[3] + 1) % lens[3];
      buf[4][idx[4]] = f4 + inContrib; idx[4] = (idx[4] + 1) % lens[4];
      buf[5][idx[5]] = f5 + inContrib; idx[5] = (idx[5] + 1) % lens[5];
      buf[6][idx[6]] = f6 + inContrib; idx[6] = (idx[6] + 1) % lens[6];
      buf[7][idx[7]] = f7 + inContrib; idx[7] = (idx[7] + 1) % lens[7];
    }
  }
}
