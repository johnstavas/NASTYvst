// op_svf.worklet.js — Stage-3 op sidecar for the `svf` op.
//
// Catalog #33 (Filters family). Andy Simper's Zero-Delay-Feedback state-
// variable filter (Cytomic technical paper, "Linear Trapezoidal Integrated
// State Variable Filter", 2013 — primary source).
// Canon:filters does NOT currently have a §1 entry for this form; §1 is
// Stilson Moog, §2 is the older musicdsp-92 double-sampled Simper.
// Math verified against the 2013 Cytomic paper directly.
//
// Why this topology (vs. biquad/ladder):
//   - **Mod stability**: ZDF (trapezoidal) integrators eliminate the unit
//     delay in the feedback path, so the filter stays stable and in-tune
//     under audio-rate cutoff modulation. A transposed biquad swept with
//     an LFO at >50 Hz will detune and can go unstable at high Q; Simper
//     SVF does not.
//   - **Q-independent cutoff**: the −3 dB point stays at `fc` regardless
//     of Q. Moog/ladder topologies shift the cutoff as resonance rises,
//     which is musical but hostile to predictable tone controls.
//   - **Simultaneous LP/BP/HP/notch**: all four outputs come out of the
//     same two-integrator structure for free; we expose one via `mode`
//     but the math computes them all per sample.
//
// Math (Canon:filters §1):
//   coefs (computed once per setParam):
//     g  = tan(π · fc / Fs)       (pre-warped integrator gain)
//     k  = 1 / Q                  (damping factor)
//     a1 = 1 / (1 + g·(g + k))    (shared denominator)
//     a2 = g · a1
//     a3 = g · a2
//
//   per-sample (v0 = input):
//     v3    = v0 − ic2eq
//     v1    = a1·ic1eq + a2·v3
//     v2    = ic2eq + a2·ic1eq + a3·v3
//     ic1eq = 2·v1 − ic1eq        (trapezoidal integrator update)
//     ic2eq = 2·v2 − ic2eq
//
//   taps:
//     LP    = v2
//     BP    = v1
//     HP    = v0 − k·v1 − v2
//     NOTCH = LP + HP = v0 − k·v1       (free — one subtract)
//
// Stability:
//   - Unconditionally stable for g > 0 and k > 0 (Q > 0).
//   - `cutoff` clamped to [20, Nyquist − 100] to keep g finite. At fc near
//     Nyquist, `tan` blows up — the clamp prevents coefficient explosion.
//   - `q` clamped to [0.05, 50]. Below 0.05 it starts to feel anti-resonant;
//     above 50 the filter will self-oscillate (intentional — musical use).
//   - Denormal flush on both integrator states (Canon:utilities §1).

const MODES    = ['lp', 'hp', 'bp', 'notch'];
const DENORMAL = 1e-30;

export class SvfOp {
  static opId = 'svf';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'mode',   default: 'lp'   },
    { id: 'cutoff', default: 1000   },
    { id: 'q',      default: 0.707  },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._mode   = 'lp';
    this._cutoff = 1000;
    this._q      = 0.707;
    this._a1     = 0;
    this._a2     = 0;
    this._a3     = 0;
    this._k      = 0;   // cached 1/Q for HP/notch taps
    this._ic1eq  = 0;   // integrator 1 trapezoid state
    this._ic2eq  = 0;   // integrator 2 trapezoid state
    this._recomputeCoefs();
  }

  reset() {
    this._ic1eq = 0;
    this._ic2eq = 0;
  }

  setParam(id, v) {
    if (id === 'mode')   { this._mode   = MODES.includes(v) ? v : 'lp'; return; }
    if (id === 'cutoff') { this._cutoff = +v; this._recomputeCoefs(); return; }
    if (id === 'q')      { this._q      = +v; this._recomputeCoefs(); return; }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    const sr  = this.sr;
    const nyq = 0.5 * sr - 100;
    const fc  = Math.min(Math.max(this._cutoff, 20), nyq);
    const q   = Math.min(Math.max(this._q, 0.05), 50);
    const g   = Math.tan(Math.PI * fc / sr);
    const k   = 1 / q;
    const a1  = 1 / (1 + g * (g + k));
    this._k   = k;
    this._a1  = a1;
    this._a2  = g * a1;
    this._a3  = g * this._a2;   // = g·g·a1
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const a1 = this._a1;
    const a2 = this._a2;
    const a3 = this._a3;
    const k  = this._k;
    const mode = this._mode;
    let ic1 = this._ic1eq;
    let ic2 = this._ic2eq;

    for (let i = 0; i < N; i++) {
      const v0 = inCh[i];
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      // Trapezoidal integrator state update.
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      // Denormal flush — kills subnormal tails on x86 without FTZ.
      if (ic1 < DENORMAL && ic1 > -DENORMAL) ic1 = 0;
      if (ic2 < DENORMAL && ic2 > -DENORMAL) ic2 = 0;

      let y;
      if      (mode === 'lp')    y = v2;
      else if (mode === 'bp')    y = v1;
      else if (mode === 'hp')    y = v0 - k * v1 - v2;
      else /* notch */           y = v0 - k * v1;
      outCh[i] = y;
    }

    this._ic1eq = ic1;
    this._ic2eq = ic2;
  }
}
