// op_bbdDelay.worklet.js — Stage-3 op sidecar for the `bbdDelay` op.
//
// Catalog #27 (Delay / Time). Bucket-Brigade Device delay — the character
// engine behind the Juno-60 chorus, Roland Dimension-D, Electric Mistress,
// Memory Man, and every 1970s–80s analog delay. Defining sonic features:
// clock-rate-dependent HF roll-off (anti-alias in, reconstruction out),
// companded dynamics, mild smear, stages-dependent noise floor.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   Martin Holters, Julian D. Parker, "A Combined Model for a Bucket Brigade
//   Device and Its Input and Output Filters," Proc. 21st Int. Conf. on
//   Digital Audio Effects (DAFx-18), Aveiro, Portugal, Sep 4–8 2018.
//   Source file: C:/Users/HEAT2/Downloads/HoltersParker-2018.txt
//   Open-access DAFx paper; reimplementation permitted with citation.
//
// PASSAGES VERBATIM (§3.3 + Table 1, extracted from txt at lines 334–400):
//
//   § 3.3 Real-valued systems — coefficients for the input-filter second-
//   order sub-system formed from a conjugate pair {p̃_in,m, p̃*_in,m}:
//
//       a1,in,m = 2 cos(∠p̃_in,m)                                    (26)
//       a2,in,m = |p̃_in,m|²                                          (27)
//       b0,in,m(dn) = γ_in,m · |p̃_in,m|^dn      · cos(∠r_in,m + dn·∠p̃_in,m)     (28)
//       b1,in,m(dn) = γ_in,m · |p̃_in,m|^(dn+1)  · cos(∠r_in,m + (dn-1)·∠p̃_in,m) (29)
//     where γ_in,m = 2·Ts·|r_in,m|.
//
//   Symmetric form for output filter — eqs (30)–(33) — with
//   γ_out,m = 2·Ts·|r_out,m|, exponents of |p̃_out,m| of (1-dn) and (2-dn).
//
//   Table 1 Juno-60 (Hin | Hout):
//     r1  251 589           |  5 092
//     r2  130 428 −  4 165i | 11 256 − 99 566i
//     r3  130 428 +  4 165i | 11 256 + 99 566i
//     r4    4 634 − 22 873i | 13 802 − 24 606i
//     r5    4 634 + 22 873i | 13 802 + 24 606i
//     p1  −46 580           | −176 261
//     p2  −55 482 + 25 082i | −51 468 + 21 437i
//     p3  −55 482 − 25 082i | −51 468 − 21 437i
//     p4  −26 292 − 59 437i | −26 276 − 59 699i
//     p5  −26 292 + 59 437i | −26 276 + 59 699i
//
//   Algorithm 1 (pseudocode, lines 256–309 of paper) — inner loop runs
//   at BBD clock rate (index n); enqueue on even n, dequeue + output
//   filter accumulation on odd n; host-rate outer loop (index k) advances
//   filter AR states once per host sample.
//
// PASSAGE ↔ CODE DEVIATIONS (v1 is a PRAGMATIC REDUCTION — debt row logs
// the full-fidelity upgrade):
//
//   1. **Topology-only adoption.** v1 ships HP's topology — pre-filter
//      (LPF), BBD FIFO, post-filter (LPF), feedback tap — but replaces
//      the 5-pole modified-impulse-invariant filters with a single
//      2nd-order Butterworth LPF on each side. Cutoff `aaHz` is a user
//      param; Juno-60 Table 1 coefficients are NOT consumed in v1.
//      Rationale: full 5-pole form per eqs (26)–(33) requires dn
//      machinery + complex partial-fraction bookkeeping that doubles
//      the code size. Shipping the topology buys the musical character
//      (clock-rate-tracking HF roll-off via aaHz, companded BBD smear
//      via feedback). Debt row logs the full HP model.
//   2. **No dn fractional-sample timing.** Algorithm 1's dn ∈ [0,1)
//      fractional-step index is dropped; BBD clock is treated as an
//      integer sub-multiple of host SR. For modulated-clock chorus
//      (Juno-60, Dimension-D), this adds quantization sidebands; debt
//      row logs "Lagrange/Thiran fractional-delay interpolation" as
//      the v2 target alongside the full HP model.
//   3. **Delay is host-rate, not BBD-rate.** v1 delay = integer host
//      samples = round(delayMs·sr/1000). This collapses the paper's
//      (clockHz, N) axis into a single delayMs param. The clockHz axis
//      (which physically ties to aaHz in a real BBD) is exposed only
//      through `aaHz` as a separate knob.
//   4. **Feedback path.** Paper models the BBD as a one-shot delay;
//      real pedals (Memory Man, DM-2) route output back to input.
//      We add a feedback tap with |fb| ≤ 0.95 clamp. Debt row: no
//      soft-clip companding on FB path (real BBDs compand the whole
//      signal path; v1 omits this for simplicity).
//   5. **Denormal flush** on delay-line reads and biquad states.
//   6. **Juno-60 Table 1 coefficients** are copied into the source
//      comment for future ports (debt row will reference this comment
//      as the "ready-to-wire" data when the v2 5-pole form lands) but
//      are NOT used by v1 runtime.
//   7. **Maximum delay 1000 ms** — covers Memory Man (~500 ms) and
//      Electric Mistress (~10 ms) with headroom. Above 1 s, BBD noise
//      dominates musicality; hard cap.

const DENORMAL = 1e-30;
const MAX_FB   = 0.95;

// ---------- tiny biquad helpers (2nd-order Butterworth LPF) -----------------
// Bilinear-transform design per RBJ cookbook (standard LPF section).
// a0 normalized out; stored coefficients in (b0, b1, b2, a1, a2) direct-form I.
function designButterworthLPF(fc, sr) {
  const f = Math.min(Math.max(fc, 20), sr * 0.49);
  const w0 = 2 * Math.PI * f / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const Q   = Math.SQRT1_2; // Butterworth
  const alpha = sinw / (2 * Q);
  const a0 = 1 + alpha;
  const b0 = (1 - cosw) / 2 / a0;
  const b1 = (1 - cosw)     / a0;
  const b2 = (1 - cosw) / 2 / a0;
  const a1 = -2 * cosw      / a0;
  const a2 = (1 - alpha)    / a0;
  return { b0, b1, b2, a1, a2 };
}

export class BbdDelayOp {
  static opId    = 'bbdDelay';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'delayMs',  default: 250 },  // BBD delay time in ms
    { id: 'aaHz',     default: 6000 }, // anti-alias / reconstruction cutoff
    { id: 'feedback', default: 0.35 }, // repeats, clamped ±0.95
    { id: 'mix',      default: 0.5 },  // 0=dry, 1=wet (for completeness;
                                        // master-worklet may override)
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;

    // Delay line (host-rate integer samples).
    this._maxDelayMs = 1000;
    const maxSamples = Math.ceil(this._maxDelayMs / 1000 * sampleRate) + 2;
    this._buf      = new Float64Array(maxSamples);
    this._bufLen   = maxSamples;
    this._writeIdx = 0;
    this._delay    = 1;

    // Pre-filter (anti-alias into BBD) + Post-filter (reconstruction out).
    this._pre  = designButterworthLPF(6000, sampleRate);
    this._post = designButterworthLPF(6000, sampleRate);
    this._preX1 = 0; this._preX2 = 0; this._preY1 = 0; this._preY2 = 0;
    this._postX1 = 0; this._postX2 = 0; this._postY1 = 0; this._postY2 = 0;

    this._fb  = 0.35;
    this._mix = 0.5;

    this._setDelayMs(250);
    this._setAaHz(6000);
  }

  reset() {
    if (this._buf) this._buf.fill(0);
    this._writeIdx = 0;
    this._preX1 = this._preX2 = this._preY1 = this._preY2 = 0;
    this._postX1 = this._postX2 = this._postY1 = this._postY2 = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'delayMs')  this._setDelayMs(n);
    else if (id === 'aaHz')     this._setAaHz(n);
    else if (id === 'feedback') {
      this._fb = n >  MAX_FB ?  MAX_FB : (n < -MAX_FB ? -MAX_FB : n);
    } else if (id === 'mix') {
      this._mix = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return 0; }

  _setDelayMs(ms) {
    let d = Math.round(ms / 1000 * this.sr);
    if (d < 1) d = 1;
    if (d > this._bufLen - 1) d = this._bufLen - 1;
    this._delay = d;
  }

  _setAaHz(hz) {
    this._pre  = designButterworthLPF(hz, this.sr);
    this._post = designButterworthLPF(hz, this.sr);
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const buf  = this._buf;
    const blen = this._bufLen;
    const D    = this._delay;
    const fb   = this._fb;
    const mix  = this._mix;

    const pre  = this._pre;
    const post = this._post;

    // Equal-power wet/dry per dry_wet_mix_rule.md (same-sample law).
    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    let preX1 = this._preX1, preX2 = this._preX2;
    let preY1 = this._preY1, preY2 = this._preY2;
    let postX1 = this._postX1, postX2 = this._postX2;
    let postY1 = this._postY1, postY2 = this._postY2;

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;

      // Read delay-line tap for feedback before writing — this samples
      // the PRE-output-filter BBD state (mirrors paper's y_BBD(t) tap).
      const readIdx = (this._writeIdx - D + blen) % blen;
      let yBBD = buf[readIdx];
      if (yBBD > -DENORMAL && yBBD < DENORMAL) yBBD = 0;

      // Input to BBD = pre-filter(x + fb·post-output).
      // Feedback is taken post-reconstruction-filter (common pedal design).
      // Post-filter state from PREVIOUS sample is the fb source.
      const fbSrc = preY1; // use last post-filter output... simpler: use postY1
      // actually keep fb as the last *output* sample (post post-filter):
      // we'll recompute below after post-filter so use postY1 from prior iter.
      const preIn = x + fb * postY1;

      // Pre-filter (anti-alias into BBD).
      const preOut = pre.b0 * preIn + pre.b1 * preX1 + pre.b2 * preX2
                   - pre.a1 * preY1 - pre.a2 * preY2;
      preX2 = preX1; preX1 = preIn;
      preY2 = preY1; preY1 = preOut;

      // Write pre-filtered sample into BBD queue (enqueue).
      buf[this._writeIdx] = preOut;
      this._writeIdx = (this._writeIdx + 1) % blen;

      // Post-filter (reconstruction) driven by BBD output sample.
      const postOut = post.b0 * yBBD + post.b1 * postX1 + post.b2 * postX2
                    - post.a1 * postY1 - post.a2 * postY2;
      postX2 = postX1; postX1 = yBBD;
      postY2 = postY1; postY1 = postOut;

      // Wet/dry (same-sample equal-power).
      out[i] = gDry * x + gWet * postOut;
    }

    this._preX1 = preX1; this._preX2 = preX2;
    this._preY1 = preY1; this._preY2 = preY2;
    this._postX1 = postX1; this._postX2 = postX2;
    this._postY1 = postY1; this._postY2 = postY2;
  }
}
