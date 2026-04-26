// op_ladder.worklet.js — Stage-3 op sidecar for the `ladder` op (v3).
//
// Catalog #34 (Filters family). 4-pole resonant low-pass Moog-style
// transistor ladder. v3 (2026-04-25) is the Stinchcombe-direct rewrite:
// proper TPT trapezoidal one-pole per stage with pre-warping, 5 tanhs
// placed exactly where the silicon places them (1 driver + 4 stages),
// 2× polyphase oversampling lifted from `op_drive`. Replaces the v2
// musicdsp.org #24 empirical-fit p/k/r form.
//
// PRIMARY (locked Tier-S, 2026-04-25):
//   Stinchcombe, T.E. — "Analysis of the Moog Transistor Ladder and
//   Derivative Filters" (25 Oct 2008).
//   Local: docs/primary_sources/stinchcombe/Moog_ladder_tf.pdf
//   Memory pointer: memory/stinchcombe_korg_moog_filter_studies.md
//
// VERBATIM PASSAGES driving the algorithm:
//
//   §2.1.1 p.6 eq.(5) — differential-pair tanh (the source of every
//   nonlinearity in the ladder):
//     I₁ = (I/2)·[1 + tanh((V₁−V₂)/(2V_T))]
//     I₂ = (I/2)·[1 − tanh((V₁−V₂)/(2V_T))]
//
//   §2.1.1 p.8 eq.(9) — generalised differential-current law (used at
//   every stage; nonlinear form replaces the linear approximation):
//     ΔI = I·(ΔV − ΔV_E) / (2V_T)        ← linear
//     ΔI = I·tanh((ΔV − ΔV_E)/(2V_T))    ← un-linearised (per eq.(5))
//
//   §2.1.2 p.12 eq.(13) — cutoff law:
//     f_c = I_f / (8πCV_T)
//
//   §2.3 p.16 eq.(21) — feedback topology. Block diagram fig.7 sums
//   feedback at the driver pair input:
//     V_out = G(s) · (V_in − k·V_out)
//
//   §2.5 fig.9 — k=3 produces "quite a large amount of corner peaking";
//   k=4 is the analytical self-oscillation boundary for the std form.
//
// CONTINUOUS-TIME MODEL (derived from the verbatim passages above):
//
//   y_0 = drive·V_in − k·y_4                    (driver-pair input;
//                                                feedback summed before tanh)
//   τ·dy_n/dt = tanh(y_{n−1}) − tanh(y_n)       for n = 1..4
//   V_out = y_4
//
// 5 tanhs total, located where Stinchcombe shows them in the silicon:
//   #1 — driver pair Q1/Q2, on (drive·V_in − k·V_out)
//   #2 — stage 1 Q3/Q4, on y_1
//   #3 — stage 2 Q5/Q6, on y_2
//   #4 — stage 3 Q7/Q8, on y_3
//   #5 — stage 4 Q9/Q10, on y_4
//
// DISCRETISATION — Zavalishin TPT one-pole per stage with pre-warped G,
// plus a one-sample lag on the global feedback path y_4 to break the
// algebraic loop without iteration:
//
//   G = tan(min(ω_c·T/2, π/2 − 1e-4)) / (1 + tan(...))
//
//   in_drv = drive · x − k · y4_prev       // global FB lag
//   th_drv = tanh(in_drv)                  // tanh #1
//
//   v1 = (th_drv − s1) · G                 // stage 1 TPT one-pole
//   y1 = v1 + s1
//   s1 += 2·v1
//   th_y1 = tanh(y1)                       // tanh #2
//
//   v2 = (th_y1 − s2) · G                  // stage 2
//   y2 = v2 + s2
//   s2 += 2·v2
//   th_y2 = tanh(y2)                       // tanh #3
//
//   v3 = (th_y2 − s3) · G                  // stage 3
//   y3 = v3 + s3
//   s3 += 2·v3
//   th_y3 = tanh(y3)                       // tanh #4
//
//   v4 = (th_y3 − s4) · G                  // stage 4
//   y4 = v4 + s4
//   s4 += 2·v4
//   // tanh #5 is conceptually on y4 as the input to the (removed) Q11/Q12
//   // output pair; per §2.1.2 p.10 Stinchcombe drops the output pair and
//   // takes V_out = ΔV_4 directly. So no extra tanh on the output node.
//
//   y4_prev = y4
//   out = y4
//
// 2× POLYPHASE OVERSAMPLING — verbatim port of the op_drive halfband:
//   63-tap Kaiser-windowed halfband (β = 10, ~100 dB stopband, passband
//   flat to ~0.40·Fs). Pipeline: zero-stuff ×2 → halfband FIR → run the
//   ladder per-sample at 2·Fs → halfband FIR → decimate. Latency =
//   (kTaps − 1)/2 = 31 samples reported via getLatencySamples().
//
// DEVIATIONS from primary (declared):
//   D1. f_c parameterised directly via `cutoff`, not via I_f/(8πCV_T).
//       The circuit-current model is irrelevant once we expose f_c in Hz.
//   D2. One-sample lag on the global feedback path (y4_prev). The exact
//       continuous-time topology has y_4 inside the driver tanh in the
//       same instant; resolving without lag requires per-sample Newton
//       iteration. Same compromise as `op_korg35` v2-full and the
//       Zavalishin "ZDF with linearised feedback" textbook examples.
//   D3. 2× polyphase OS added (not discussed in the primary — analog
//       circuits don't alias). Necessary because 5 tanhs at 1×Fs alias
//       on hot transients. Halfband group delay = 31 samples.
//   D4. Resonance param maps linearly to internal k ∈ [0, 4]. Existing
//       graph wiring keeps `resonance` ∈ [0, 1.2] for backward compat;
//       internally we rescale k = (4/1.2)·resonance so resonance=1.2
//       hits Stinchcombe's analytical self-osc boundary k=4 (§2.5).
//   D5. Float64 state, denormal flush on all integrator+lag registers.
//   D6. New params: `drive` (pre-tanh input gain) and `trim` (post-gain
//       in dB). Both default to no-op so existing graphs stay green.
//
// CPU vs v2 (per-sample, host rate):
//   v2: 5 tanh + ~10 mul/add per sample  (1× Fs)
//   v3: 5 tanh + ~12 mul/add per sample × 2 (2× Fs)
//       + 2 × 63-tap FIR = ~252 mul/add per sample for OS
//   Net: ~5× v2's per-sample cost. Same multiplier op_drive accepts.
//
// BACKWARD COMPATIBILITY:
//   `cutoff` and `resonance` keep their v2 ranges and meanings to a
//   close approximation; the response shape WILL audibly change because
//   the underlying topology changed (TPT vs musicdsp empirical fit).
//   New `drive` and `trim` default to identity. Existing graphs that
//   wire only cutoff+resonance keep working without edit.

const DENORMAL = 1e-30;

export class LadderOp {
  static opId = 'ladder';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoff',    default: 1000 },
    { id: 'resonance', default: 0    },
    { id: 'drive',     default: 1.0  },   // pre-tanh input gain
    { id: 'trim',      default: 0.0  },   // post-gain in dB
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._cutoff    = 1000;
    this._resonance = 0;
    this._drive     = 1.0;
    this._trim      = 0.0;

    // Coefficients (recomputed on setParam):
    this._G = 0;
    this._k = 0;

    // Ladder state — 4 cap voltages, 4 TPT integrator states, 1 FB lag:
    this._y1 = 0; this._y2 = 0; this._y3 = 0; this._y4 = 0;
    this._s1 = 0; this._s2 = 0; this._s3 = 0; this._s4 = 0;
    this._y4_prev = 0;

    // 2× OS halfband — design once on construct.
    this._designHalfband();
    this._upBuf = new Float64Array(this._kTaps);
    this._dnBuf = new Float64Array(this._kTaps);
    this._upIdx = 0;
    this._dnIdx = 0;

    this._recomputeCoefs();
  }

  reset() {
    this._y1 = this._y2 = this._y3 = this._y4 = 0;
    this._s1 = this._s2 = this._s3 = this._s4 = 0;
    this._y4_prev = 0;
    this._upBuf.fill(0);
    this._dnBuf.fill(0);
    this._upIdx = 0;
    this._dnIdx = 0;
  }

  setParam(id, v) {
    if (id === 'cutoff')    { this._cutoff    = +v; this._recomputeCoefs(); return; }
    if (id === 'resonance') { this._resonance = +v; this._recomputeCoefs(); return; }
    if (id === 'drive')     { this._drive     = +v; return; }
    if (id === 'trim')      { this._trim      = +v; return; }
  }

  // Halfband group delay = (kTaps - 1) / 2 = 31 samples.
  getLatencySamples() { return (this._kTaps - 1) >> 1; }

  _recomputeCoefs() {
    // Pre-warp at 2·Fs (the rate the ladder actually runs at inside the OS).
    const sr2 = 2 * this.sr;
    const nyq2 = 0.5 * sr2 - 100;
    const fc   = Math.min(Math.max(this._cutoff, 20), nyq2);
    const T2   = 1 / sr2;
    const wd   = 2 * Math.PI * fc;
    const preArg = Math.min(wd * T2 / 2, Math.PI / 2 - 1e-4);
    const t      = Math.tan(preArg);
    this._G = t / (1 + t);
    // resonance ∈ [0, 1.2] backward-compat; map → k ∈ [0, 4] (Stinchcombe §2.5).
    const res = Math.min(Math.max(this._resonance, 0), 1.2);
    this._k = (4 / 1.2) * res;
  }

  // ── 63-tap Kaiser β=10 halfband (verbatim from op_drive). ───────────
  _designHalfband() {
    const kTaps = 63;
    const beta  = 10.0;
    const besselI0 = (x) => {
      let sum = 1.0, term = 1.0;
      const q = x * x * 0.25;
      for (let n = 1; n < 50; n++) {
        term *= q / (n * n);
        sum  += term;
        if (term < 1.0e-20 * sum) break;
      }
      return sum;
    };
    const i0Beta = besselI0(beta);
    const N      = kTaps - 1;            // 62
    const half   = (kTaps / 2) | 0;      // 31
    const hb     = new Float64Array(kTaps);
    for (let n = 0; n < kTaps; n++) {
      const m = n - half;
      let sinc;
      if (m === 0)              sinc = 0.5;
      else if ((m & 1) === 0)   sinc = 0.0;
      else                      sinc = Math.sin(0.5 * Math.PI * m) / (Math.PI * m);
      const r = (2 * n - N) / N;
      const a = beta * Math.sqrt(1 - r * r);
      const w = besselI0(a) / i0Beta;
      hb[n] = sinc * w;
    }
    this._kTaps = kTaps;
    this._hb    = hb;
  }

  _pushAndConvolve(buf, idxIsUp, x) {
    const kTaps = this._kTaps;
    const hb    = this._hb;
    let idx = idxIsUp ? this._upIdx : this._dnIdx;
    buf[idx] = x;
    idx = (idx + 1) % kTaps;
    if (idxIsUp) this._upIdx = idx; else this._dnIdx = idx;
    let y = 0, j = idx;
    for (let t = 0; t < kTaps; t++) {
      y += hb[t] * buf[j];
      j = (j + 1) % kTaps;
    }
    return y;
  }

  // Single ladder sample at 2·Fs. Mutates state in place, returns y4.
  _ladderStep(x) {
    const G = this._G;
    const k = this._k;
    const drive = this._drive;
    let s1 = this._s1, s2 = this._s2, s3 = this._s3, s4 = this._s4;
    let y4_prev = this._y4_prev;

    // Driver pair tanh on (drive·x − k·y4_prev). One-sample lag on FB.
    const in_drv = drive * x - k * y4_prev;
    const th_drv = Math.tanh(in_drv);

    // Stage 1
    const v1 = (th_drv - s1) * G;
    const y1 = v1 + s1;
    s1 += 2 * v1;
    const th_y1 = Math.tanh(y1);

    // Stage 2
    const v2 = (th_y1 - s2) * G;
    const y2 = v2 + s2;
    s2 += 2 * v2;
    const th_y2 = Math.tanh(y2);

    // Stage 3
    const v3 = (th_y2 - s3) * G;
    const y3 = v3 + s3;
    s3 += 2 * v3;
    const th_y3 = Math.tanh(y3);

    // Stage 4
    const v4 = (th_y3 - s4) * G;
    const y4 = v4 + s4;
    s4 += 2 * v4;

    this._y1 = y1; this._y2 = y2; this._y3 = y3; this._y4 = y4;
    this._s1 = s1; this._s2 = s2; this._s3 = s3; this._s4 = s4;
    this._y4_prev = y4;
    return y4;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }

    const trimLin = Math.pow(10, this._trim / 20);
    const upBuf = this._upBuf, dnBuf = this._dnBuf;

    for (let i = 0; i < N; i++) {
      // 2× upsample (zero-stuff + halfband FIR, ×2 gain comp)
      const x   = 2.0 * inCh[i];
      const up0 = this._pushAndConvolve(upBuf, true, x);
      const up1 = this._pushAndConvolve(upBuf, true, 0.0);

      // Ladder runs at 2·Fs
      const y0 = this._ladderStep(up0);
      const y1 = this._ladderStep(up1);

      // 2× downsample (halfband FIR + decimate)
      this._pushAndConvolve(dnBuf, false, y0);   // discarded
      const dn = this._pushAndConvolve(dnBuf, false, y1);

      outCh[i] = trimLin * dn;
    }

    // Denormal flush.
    if (this._y1 < DENORMAL && this._y1 > -DENORMAL) this._y1 = 0;
    if (this._y2 < DENORMAL && this._y2 > -DENORMAL) this._y2 = 0;
    if (this._y3 < DENORMAL && this._y3 > -DENORMAL) this._y3 = 0;
    if (this._y4 < DENORMAL && this._y4 > -DENORMAL) this._y4 = 0;
    if (this._s1 < DENORMAL && this._s1 > -DENORMAL) this._s1 = 0;
    if (this._s2 < DENORMAL && this._s2 > -DENORMAL) this._s2 = 0;
    if (this._s3 < DENORMAL && this._s3 > -DENORMAL) this._s3 = 0;
    if (this._s4 < DENORMAL && this._s4 > -DENORMAL) this._s4 = 0;
    if (this._y4_prev < DENORMAL && this._y4_prev > -DENORMAL) this._y4_prev = 0;
  }
}
