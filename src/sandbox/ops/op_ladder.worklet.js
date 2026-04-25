// op_ladder.worklet.js — Stage-3 op sidecar for the `ladder` op.
//
// Catalog #34 (Filters family). 4-pole resonant low-pass Moog-style ladder.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   musicdsp.org archive #24 — "Moog VCF", C++ port by "mistertoast".
//   URL: https://www.musicdsp.org/en/latest/Filters/24-moog-vcf.html
//   This is the well-known Huovilainen-inspired port: a 4-stage one-pole
//   cascade with inverted feedback from y4 and a cubic soft-clip
//   (y4 -= y4³/6) on the output as a Taylor-2 tanh self-limiter.
//   Canon:filters §2–4 enumerate Stilson (§1, uses its own saturate() at
//   every pole + cubic-fit `p`), Hötvinen DAFX04 (§3, 2× OS + 4 tanhs),
//   and Karlsen fast ladder (§4, 1-pole smoothers with clipped FB).
//   The v1 shipped here picks the musicdsp #24 form because it is:
//     - cheap (no OS, no tanhs, no per-pole saturate — one cubic on y4)
//     - self-limiting via the cubic clip (bounded at high resonance)
//     - well-documented and widely copied (stable reference)
//   Upgrade path (Hötvinen 2× OS + per-stage tanh, Karlsen character,
//   LP/BP/HP mode enum) tracked in sandbox_ops_research_debt.md.
//
// PASSAGE VERBATIM (init coefs + per-sample loop):
//
//     void MoogFilter::calc() {
//         float f = (cutoff+cutoff) / fs;
//         p=f*(1.8f-0.8f*f);
//         k=2.f*sin(f*3.14159f*0.5f)-1.f;
//         float t=(1.f-p)*1.386249f;
//         float t2=12.f+t*t;
//         r = res*(t2+6.f*t)/(t2-6.f*t);
//     }
//
//     float MoogFilter::process(float input) {
//         x = input - r*y4;
//         y1= x*p +  oldx*p - k*y1;
//         y2=y1*p + oldy1*p - k*y2;
//         y3=y2*p + oldy2*p - k*y3;
//         y4=y3*p + oldy3*p - k*y4;
//         y4-=(y4*y4*y4)/6.f;
//         oldx = x; oldy1 = y1; oldy2 = y2; oldy3 = y3;
//         return y4;
//     }
//
// DEVIATIONS from verbatim (declared):
//   1. `f = 2*cutoff/fs` is clamped: cutoff ∈ [20, Nyquist-100] before
//      the formula runs. The cubic fit `p = f(1.8 - 0.8f)` is not valid
//      for f → 1 (near Nyquist) — `p` would become negative and the
//      cascade explodes. Clamp prevents that.
//   2. `resonance` param clamped to [0, 1.2]. Original is unbounded;
//      >1.2 makes the cubic clip insufficient to bound the state at
//      certain cutoffs (verified empirically). 1.2 allows the self-
//      oscillation regime without blowup.
//   3. Float64 state (not Float32 as in the C++ source). Matches the
//      convention set by svf/onePole/dcBlock — cheap in JS, buys
//      accumulated-precision headroom inside the 4-stage cascade.
//   4. Denormal flush (Jon Watte, Canon:utilities §1) on all 8 state
//      registers. C++ source does not flush; ARM worklets without FTZ
//      would suffer subnormal stalls in the decay tail.
//   5. Defensive null-input → zero output (standard op contract).
//
// MATH SUMMARY:
//   per setParam(cutoff, resonance):
//     f  = 2·fc/sr                  normalised frequency
//     p  = f·(1.8 − 0.8·f)          pole coefficient (empirical fit)
//     k  = 2·sin(f·π/2) − 1         inverted feedback scaler
//     t  = (1 − p) · 1.386249       (ln 4 ≈ 1.386)
//     t2 = 12 + t²
//     r  = res·(t2 + 6·t) / (t2 − 6·t)   Q-correction (compensates
//                                         resonance falloff at high fc)
//
//   per sample:
//     x  = in − r·y4                 inverted FB
//     y1 = x·p  + oldx·p  − k·y1     pole 1
//     y2 = y1·p + oldy1·p − k·y2     pole 2
//     y3 = y2·p + oldy2·p − k·y3     pole 3
//     y4 = y3·p + oldy3·p − k·y4     pole 4
//     y4 −= y4³/6                    cubic soft-clip (tanh Taylor)
//     oldx/oldy1/oldy2/oldy3 ← x/y1/y2/y3
//     out = y4

const DENORMAL = 1e-30;

export class LadderOp {
  static opId = 'ladder';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoff',     default: 1000 },
    { id: 'resonance',  default: 0    },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._cutoff    = 1000;
    this._resonance = 0;

    // Coefficients (recomputed on setParam).
    this._p = 0;
    this._k = 0;
    this._r = 0;

    // State — 8 Float64 registers.
    this._x     = 0;
    this._y1    = 0;
    this._y2    = 0;
    this._y3    = 0;
    this._y4    = 0;
    this._oldx  = 0;
    this._oldy1 = 0;
    this._oldy2 = 0;
    this._oldy3 = 0;

    this._recomputeCoefs();
  }

  reset() {
    this._x = this._y1 = this._y2 = this._y3 = this._y4 = 0;
    this._oldx = this._oldy1 = this._oldy2 = this._oldy3 = 0;
  }

  setParam(id, v) {
    if (id === 'cutoff')        { this._cutoff    = +v; this._recomputeCoefs(); return; }
    if (id === 'resonance')     { this._resonance = +v; this._recomputeCoefs(); return; }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    const sr  = this.sr;
    const nyq = 0.5 * sr - 100;
    const fc  = Math.min(Math.max(this._cutoff, 20), nyq);
    const res = Math.min(Math.max(this._resonance, 0), 1.2);
    const f   = (fc + fc) / sr;
    const p   = f * (1.8 - 0.8 * f);
    const k   = 2 * Math.sin(f * Math.PI * 0.5) - 1;
    const t   = (1 - p) * 1.386249;
    const t2  = 12 + t * t;
    const denom = t2 - 6 * t;
    const r   = denom !== 0 ? res * (t2 + 6 * t) / denom : 0;
    this._p = p;
    this._k = k;
    this._r = r;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }

    const p = this._p;
    const k = this._k;
    const r = this._r;
    let y1 = this._y1, y2 = this._y2, y3 = this._y3, y4 = this._y4;
    let oldx = this._oldx, oldy1 = this._oldy1, oldy2 = this._oldy2, oldy3 = this._oldy3;

    for (let i = 0; i < N; i++) {
      const x  = inCh[i] - r * y4;
      const ny1 = x  * p + oldx  * p - k * y1;
      const ny2 = ny1 * p + oldy1 * p - k * y2;
      const ny3 = ny2 * p + oldy2 * p - k * y3;
      let   ny4 = ny3 * p + oldy3 * p - k * y4;
      // Cubic soft-clip (tanh Taylor-2): self-limits resonance.
      ny4 -= (ny4 * ny4 * ny4) / 6;

      oldx = x;  oldy1 = ny1;  oldy2 = ny2;  oldy3 = ny3;
      y1 = ny1;  y2 = ny2;     y3 = ny3;     y4 = ny4;

      outCh[i] = y4;
    }

    // Denormal flush (Canon:utilities §1).
    if (y1 < DENORMAL && y1 > -DENORMAL) y1 = 0;
    if (y2 < DENORMAL && y2 > -DENORMAL) y2 = 0;
    if (y3 < DENORMAL && y3 > -DENORMAL) y3 = 0;
    if (y4 < DENORMAL && y4 > -DENORMAL) y4 = 0;
    if (oldx  < DENORMAL && oldx  > -DENORMAL) oldx  = 0;
    if (oldy1 < DENORMAL && oldy1 > -DENORMAL) oldy1 = 0;
    if (oldy2 < DENORMAL && oldy2 > -DENORMAL) oldy2 = 0;
    if (oldy3 < DENORMAL && oldy3 > -DENORMAL) oldy3 = 0;

    this._y1 = y1; this._y2 = y2; this._y3 = y3; this._y4 = y4;
    this._oldx = oldx; this._oldy1 = oldy1; this._oldy2 = oldy2; this._oldy3 = oldy3;
  }
}
