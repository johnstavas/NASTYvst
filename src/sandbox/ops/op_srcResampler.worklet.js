// op_srcResampler.worklet.js — Stage-3 op sidecar for the `srcResampler` op.
//
// #166 Foundation/Utility — varispeed-read with polyphase Kaiser-windowed-sinc
// interpolation. NOT a true elastic-buffered SRC. Same N inputs / N outputs
// per process() call; the `speed` param controls the per-sample read-pointer
// advance into a circular history of recent inputs. At speed=1 the op is a
// pure Nz-sample filter delay (group delay of the windowed-sinc). Deviating
// `speed` from 1 introduces drift between input-time and output-time that
// accumulates over blocks; for sustained large speed deviations, drift will
// eventually walk the read pointer outside the ring buffer (clamped to the
// nearest valid position — output degrades gracefully). Log elastic buffering
// as P2 in `sandbox_ops_research_debt.md`.
//
// PRIMARY (opened 2026-04-26 via WebFetch):
//   1. JOS — *Digital Audio Resampling Home Page → Implementation*
//      ccrma.stanford.edu/~jos/resample/Implementation.html
//      VERBATIM (left-wing / right-wing two-stage compute, ρ ≥ 1):
//        v    ←  Σ(i=0..h_end) x(n-i) · [h(l + i·L) + η · h̄(l + i·L)]   [left]
//        P    ←  1 − P
//        y(t) ←  v + Σ(i=0..h_end) x(n+1+i) · [h(l + i·L) + η · h̄(l + i·L)] [right]
//      where L = polyphase factor, η ∈ [0,1) = fractional between adjacent
//      table entries, h(l) = right wing of symmetric Kaiser-windowed sinc
//      sampled at LN_z+1 points, h̄(l) = h(l+1) − h(l) (linear-interp
//      differences), n = floor(P · L)/L mapped to integer input index.
//   2. JOS — *Theory_Ideal_Bandlimited_Interpolation*
//      VERBATIM:
//        hs(t) ≡ sinc(Fs·t) ≡ sin(π·Fs·t)/(π·Fs·t)
//        [downsampling kernel scaling]
//        hs(t) = min{1, Fs'/Fs} · sinc(min{Fs, Fs'}·t)
//      Cutoff drops to lower of the two rates; gain pre-scales by ratio to
//      preserve unity passband.
//
// CHOSEN DIMENSIONS:
//   L  = 32   polyphase phases per zero-crossing
//   Nz = 8    one-sided zero-crossings (17-tap effective FIR)
//   β  = 7    Kaiser window parameter (~70 dB stopband attenuation)
//   K  = 1024 ring-buffer size (allows ~21 ms of drift at 48 kHz before
//             read-pointer hits the buffer wall)
//
// AUTHORING SHAPE:
//   Inputs  : in  (audio)
//   Outputs : out (audio)
//   Params  : speed (0.25..4.0, default 1.0 — read-pointer advance per output sample)
//
// State: ring buffer xbuf[K], write index wpos, fractional read lag
// `phase` in [Nz, K-Nz] input samples behind write pointer.
//
// DEVIATIONS from JOS Implementation (called out per ship-protocol Step 4):
//   A. JOS partitions a fixed-point time register `t` into bitfields
//      (n_n | n_l | n_η). We use double-precision floating-point `phase`
//      and `Math.floor`/multiply/subtract to extract integer + fractional
//      parts. Algebraically identical at audio precision.
//   B. JOS handles ρ < 1 (downsample) via kernel cutoff scaling
//      `hs(t) = ρ · sinc(ρ · t)`. We omit cutoff scaling for first ship —
//      kernel stays at unity cutoff regardless of speed. Result: speed > 1
//      will alias above Nyquist/speed. Logged as P2 research-debt.
//      Acceptable for sandbox use because: (a) varispeed is bounded by
//      the [0.25, 4.0] param range; (b) 17-tap kernel has natural HF
//      rolloff; (c) typical use (vibrato/wow) keeps speed near 1.0.
//   C. No elastic input/output buffering. Per-block contract is N inputs
//      → N outputs in lockstep. Drift at speed≠1 walks the read pointer
//      relative to write head; clamped to ring bounds when exceeded.
//      Logged as P2 research-debt.

const KAISER_BETA = 7.0;     // Kaiser window β (~70 dB stopband)
const NZ = 8;                // One-sided zero-crossings of windowed sinc
const L  = 32;               // Polyphase phases per zero-crossing
const TABLE_LEN = NZ * L + 1;       // h() entries: 257
const KBUF = 4096;           // Ring buffer size (must be > 2*NZ).
                             // Sized for ~85 ms of speed<1 drift at 48 kHz
                             // before phase hits the ceiling and clamps.

// ---- Bessel I0 (modified Bessel, first kind, order 0) for Kaiser window ----
// Series truncation to ~10 terms — exact to ≥1e-12 for β ≤ 10.
function besselI0(x) {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = (x / 3.75) ** 2;
    return 1.0 + y*(3.5156229 + y*(3.0899424 + y*(1.2067492 +
           y*(0.2659732 + y*(0.0360768 + y*0.0045813)))));
  }
  const y = 3.75 / ax;
  return (Math.exp(ax) / Math.sqrt(ax)) * (
    0.39894228 + y*(0.01328592 + y*(0.00225319 + y*(-0.00157565 +
    y*(0.00916281 + y*(-0.02057706 + y*(0.02635537 +
    y*(-0.01647633 + y*0.00392377))))))));
}

// ---- Kaiser-windowed-sinc kernel construction ----
// Right wing of symmetric h: h[l] for l = 0..NZ*L. h[0] = 1, h[NZ*L] = 0.
// Argument t = l/L (input-sample units, since L phases per zero-crossing).
function buildPolyphaseTable() {
  const h  = new Float64Array(TABLE_LEN);
  const hd = new Float64Array(TABLE_LEN - 1);
  const inv_I0_beta = 1 / besselI0(KAISER_BETA);
  for (let l = 0; l < TABLE_LEN; l++) {
    const t = l / L;                // t in input-sample units, 0..NZ
    let sinc_t;
    if (l === 0) sinc_t = 1.0;
    else {
      const pt = Math.PI * t;
      sinc_t = Math.sin(pt) / pt;
    }
    // Kaiser window: I0(β·sqrt(1 - (t/Nz)²)) / I0(β), zero at |t|=Nz.
    const r = t / NZ;
    const winArg = (r >= 1.0) ? 0.0 : Math.sqrt(1.0 - r * r);
    const win = besselI0(KAISER_BETA * winArg) * inv_I0_beta;
    h[l] = sinc_t * win;
  }
  for (let l = 0; l < TABLE_LEN - 1; l++) hd[l] = h[l + 1] - h[l];
  return [h, hd];
}

// Build once at module load — table is identical for every instance.
const [_H, _HD] = buildPolyphaseTable();

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export class SrcResamplerOp {
  static opId = 'srcResampler';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'speed', default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._speed = 1.0;

    // Polyphase tables — referenced by index, not copied.
    this.h  = _H;
    this.hd = _HD;

    // Ring buffer state.
    this.xbuf = new Float64Array(KBUF);
    this.wpos = 0;            // Index of NEXT write
    this.phase = NZ;          // Fractional read lag (input samples behind write head).
                              // Initial = NZ → output starts as a clean filter-delayed copy.
  }

  reset() {
    this.xbuf.fill(0);
    this.wpos = 0;
    this.phase = NZ;
  }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    if (id === 'speed') this._speed = clip(x, 0.25, 4.0);
  }

  getLatencySamples() { return NZ; }

  process(inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;
    const inCh = inputs.in;
    const speed = this._speed;
    const xbuf = this.xbuf;
    const h    = this.h;
    const hd   = this.hd;
    let wpos   = this.wpos;
    let phase  = this.phase;

    // Phase increment per output sample.
    // Per JOS Implementation: write head advances by 1 input sample, read
    // head advances by `speed` input samples. Phase = (write head) − (read
    // head) in input-sample units, so per step: Δphase = 1 − speed.
    //  - speed = 1: phase constant → identity (with NZ filter delay)
    //  - speed > 1: phase shrinks (read catches up). Valid for ~(phase−NZ)
    //               output samples before clamping. CAUSALITY LIMIT — see
    //               worklet header. Sustained speed > 1 needs elastic input
    //               buffering (P2 research-debt).
    //  - speed < 1: phase grows (read falls behind). Valid until phase hits
    //               KBUF − NZ − 1 ceiling.
    const phaseInc = 1.0 - speed;

    for (let i = 0; i < N; i++) {
      // 1. Push incoming sample into ring at write position.
      xbuf[wpos] = inCh ? inCh[i] : 0;
      wpos = (wpos + 1) % KBUF;

      // 2. Compute anchor + fractional position per JOS Implementation.
      //    read_pos = i - phase (in input-sample-time, where i is current
      //    output index and phase is the read lag).
      //    n = floor(read_pos) = the integer input sample BELOW read_pos.
      //    P = read_pos - n ∈ [0, 1) = JOS's fractional position past n.
      //
      //    In ring-buffer coords:
      //      lag_of_n = i - n = ceil(phase)  when phase has fractional part,
      //                       = phase        when phase is integer.
      //      P = lag_of_n - phase ∈ [0, 1).
      //
      // Clamp phase to [NZ, KBUF - NZ - 1] — graceful degrade outside.
      let pClamped = phase;
      if (pClamped < NZ) pClamped = NZ;
      else if (pClamped > KBUF - NZ - 1) pClamped = KBUF - NZ - 1;
      const phaseFloor = Math.floor(pClamped);
      const phaseFrac  = pClamped - phaseFloor;
      // anchor lag and P (per JOS):
      const anchorLag = (phaseFrac === 0) ? phaseFloor : (phaseFloor + 1);
      const P         = anchorLag - pClamped;   // ∈ [0, 1)

      // 3. JOS two-wing polyphase interpolation.
      // Anchor input sample n is "anchorLag samples ago" relative to write head.
      // Left wing reads x[n], x[n-1], ..., x[n - (NZ-1)] (NZ samples).
      // Right wing reads x[n+1], x[n+2], ..., x[n + NZ] (NZ samples).
      // Table phase for left wing: l = floor(P*L), η = P*L - l.
      // Table phase for right wing: l' = floor((1-P)*L), η' = (1-P)*L - l'.
      const Pleft  = P;
      const Pright = 1 - P;
      const lLeftF  = Pleft  * L;
      const lRightF = Pright * L;
      let lLeft  = Math.floor(lLeftF);
      let lRight = Math.floor(lRightF);
      let etaL = lLeftF  - lLeft;
      let etaR = lRightF - lRight;
      // Boundary: if P = 0 exactly, lLeft = 0, etaL = 0; lRight could equal L.
      if (lLeft  >= L) { lLeft  = L - 1; etaL = 1 - 1e-15; }
      if (lRight >= L) { lRight = L - 1; etaR = 1 - 1e-15; }

      // Anchor n in ring at lag anchorLag. base = lag-of-n index in xbuf coords.
      const base = wpos - 1 - anchorLag + KBUF;

      // Left wing.
      let v = 0.0;
      for (let k = 0; k < NZ; k++) {
        const x_k = xbuf[(base - k) % KBUF];
        const tableIdx = lLeft + k * L;
        v += x_k * (h[tableIdx] + etaL * hd[tableIdx]);
      }
      // Right wing.
      let vr = 0.0;
      for (let k = 0; k < NZ; k++) {
        const x_kp1 = xbuf[(base + 1 + k) % KBUF];
        const tableIdx = lRight + k * L;
        vr += x_kp1 * (h[tableIdx] + etaR * hd[tableIdx]);
      }
      outCh[i] = v + vr;

      // 4. Advance phase for next output.
      phase += phaseInc;
    }
    this.wpos = wpos;
    this.phase = phase;
  }
}
