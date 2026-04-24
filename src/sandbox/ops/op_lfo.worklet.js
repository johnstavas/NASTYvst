// op_lfo.worklet.js — Stage-3 op sidecar for the `lfo` op.
//
// Low-frequency oscillator, bipolar control signal. Research:
//   - dsp_code_canon_synthesis.md §6 — coupled sin/cos form.
//       a = 2·sin(π·f/Fs); s0 -= a·s1; s1 += a·s0; periodic renorm
//       tmp = 1.5 − 0.5·(s0² + s1²); s0 *= tmp; s1 *= tmp.
//       Valid to Fs/6 (8 kHz at 48 kHz SR). No per-sample trig. Drift-free
//       magnitude under renorm. s1 ≈ sin(2π·f·n/Fs) with seed s0=1, s1=0.
//   - sandbox_modulation_roadmap.md § 4 — LFO primitive: one of three source
//       ops (noise / lfo / knob-follower) feeding the curve→combine stack.
//
// Phase sync across shapes. Triangle / square / saw use a phase accumulator
// [0,1) advanced in lockstep with the coupled oscillator. Switching shape
// mid-stream therefore does NOT cause a phase jump — the phase tracks the
// same rate, and the coupled state is re-seeded to match on rate change.
//
// Shape alignment (all phase-aligned with sine):
//   sine     phase=0 → 0,   phase=0.25 → +1,  phase=0.5 → 0,  phase=0.75 → -1
//   triangle phase=0 → 0,   phase=0.25 → +1,  phase=0.5 → 0,  phase=0.75 → -1
//   square   phase<0.5 → +1, else -1       (leads sine half-cycle)
//   saw ↓    phase=0 → +1,  phase=1 → -1   (registry label "saw (↓)")
//
// Output is bipolar [-amount, +amount] + offset, matching other source ops.

const SHAPE_SINE = 0;
const SHAPE_TRI  = 1;
const SHAPE_SQ   = 2;
const SHAPE_SAW  = 3;

// How often to run the Canon §6 magnitude renorm. Canon calls for "periodic"
// — once per process block is ample for LFO rates (drift is O(a²·N) and
// imperceptible at N=128 samples, f ≤ 40 Hz).
const RENORM_INTERVAL = 128;

export class LfoOp {
  static opId = 'lfo';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'lfo', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'rateHz', default: 1 },
    { id: 'shape',  default: 0 },
    { id: 'amount', default: 1 },
    { id: 'offset', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr     = sampleRate;
    this._rate  = 1;
    this._shape = SHAPE_SINE;
    this._amount = 1;
    this._offset = 0;

    // Phase accumulator in [0, 1). Drives tri/sq/saw and seeds the coupled
    // oscillator on rate changes.
    this._phase = 0;

    // Coupled sin/cos state (Canon §6). Seed: s0=1, s1=0 → s1 starts at 0
    // and rises, matching sin(0)=0 at phase=0.
    this._s0 = 1;
    this._s1 = 0;

    // Rotation coefficient a = 2·sin(π·f/Fs), recomputed on rate change.
    this._a = this._rateToCoef(this._rate);
    this._renormCount = 0;
  }

  _rateToCoef(hz) {
    // Canon §6. `a` must be recomputed whenever rate changes.
    return 2 * Math.sin(Math.PI * hz / this.sr);
  }

  // Re-seed coupled oscillator from current phase. Called on rate change
  // and reset so (s0, s1) stays phase-locked with the accumulator.
  _reseedFromPhase() {
    // At phase p: we want s1 ≈ sin(2π·p), s0 ≈ cos(2π·p). That way reading
    // `s1` produces the same value as sin(2π·phase) at the current instant.
    const theta = 2 * Math.PI * this._phase;
    this._s0 = Math.cos(theta);
    this._s1 = Math.sin(theta);
  }

  reset() {
    this._phase = 0;
    this._s0 = 1;
    this._s1 = 0;
    this._renormCount = 0;
  }

  setParam(id, v) {
    switch (id) {
      case 'rateHz':
        this._rate = +v;
        this._a = this._rateToCoef(this._rate);
        this._reseedFromPhase();  // keep coupled state locked to phase
        break;
      case 'shape': {
        // Registry declares integer values 0..3. Guard nonetheless.
        const n = v | 0;
        if (n >= 0 && n <= 3) this._shape = n;
        break;
      }
      case 'amount': this._amount = +v; break;
      case 'offset': this._offset = +v; break;
    }
  }

  getLatencySamples() { return 0; }

  // process(inputs, outputs, N) — no inputs; writes `lfo`.
  process(_inputs, outputs, N) {
    const outCh = outputs.lfo;
    if (!outCh) return;

    const sr     = this.sr;
    const shape  = this._shape;
    const amount = this._amount;
    const offset = this._offset;
    const a      = this._a;
    const phaseIncr = this._rate / sr;

    let phase = this._phase;
    let s0    = this._s0;
    let s1    = this._s1;
    let rc    = this._renormCount;

    for (let i = 0; i < N; i++) {
      // Advance coupled oscillator (Canon §6).
      s0 -= a * s1;
      s1 += a * s0;

      // Advance phase accumulator in lockstep.
      phase += phaseIncr;
      if (phase >= 1) phase -= 1;
      else if (phase < 0) phase += 1;  // defensive for negative rates

      // Periodic magnitude renorm to prevent drift (Canon §6).
      if (++rc >= RENORM_INTERVAL) {
        const mag2 = s0 * s0 + s1 * s1;
        const tmp = 1.5 - 0.5 * mag2;
        s0 *= tmp;
        s1 *= tmp;
        rc = 0;
      }

      let y;
      if (shape === SHAPE_SINE) {
        y = s1;                                 // s1 ≈ sin(2π·f·t)
      } else if (shape === SHAPE_TRI) {
        // Phase-aligned with sine: shift by +0.25 so phase=0 → 0.
        let p = phase + 0.25;
        if (p >= 1) p -= 1;
        y = 1 - 4 * Math.abs(p - 0.5);
      } else if (shape === SHAPE_SQ) {
        y = phase < 0.5 ? 1 : -1;
      } else {
        // Saw ↓: phase=0 → +1, phase=1 → -1.
        y = 1 - 2 * phase;
      }

      outCh[i] = y * amount + offset;
    }

    this._phase = phase;
    this._s0    = s0;
    this._s1    = s1;
    this._renormCount = rc;
  }
}
