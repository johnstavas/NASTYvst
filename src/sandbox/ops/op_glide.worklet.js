// op_glide.worklet.js — Stage-3 op sidecar for the `glide` op.
//
// Catalog #99 (Control primitives). Constant-time glide (portamento).
//
// SEMANTICS
//
//   On target change, compute:
//     step = (newTarget − currentY) / (glideMs · sr / 1000)
//   Advance y by step each sample until |y − target| ≤ |step| → snap.
//   Result: y reaches newTarget in glideMs regardless of distance.
//
// FAMILY POSITIONING
//
//   slew   — constant rate (time varies with distance)
//   smooth — exponential asymptote (never arrives; τ-relative)
//   glide  — constant TIME to target (rate recomputed per change)
//   ramp   — trigger-driven one-shot sweep (different trigger model)
//
// Glide is the classic monophonic-synth portamento: every new note
// takes the same time to reach, whether it's a semitone or two octaves
// away. This is the "singable" legato feel — analog synths (Minimoog,
// MS-20) use time-mode glide.
//
// FIRST-SAMPLE BEHAVIOUR
//
// On the very first sample after construction/reset, we snap y to the
// input value (no glide from zero). This is the universally expected
// behaviour — you don't want a filter cutoff param gliding up from 0
// Hz at plugin load.
//
// MID-GLIDE RETARGETING
//
// If target changes while a glide is in progress, we recompute step
// from the CURRENT y (not from the original start) to the new target
// over glideMs. Glide always completes in glideMs from the moment of
// each target change — never "queues up" residual motion.
//
// glideMs=0 → instant snap (every target change latches in one sample).
//
// LATENCY: zero. DENORMALS: no recursive filter state; y is bounded
// by input range so denormals aren't a risk.

export class GlideOp {
  static opId = 'glide';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'glideMs', default: 100 },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._glideMs   = 100;
    this._y         = 0;
    this._target    = 0;
    this._step      = 0;
    this._active    = false;
    this._init      = false;    // cleared by reset(); set after first sample
  }

  reset() {
    this._y        = 0;
    this._target   = 0;
    this._step     = 0;
    this._active   = false;
    this._init     = false;
  }

  setParam(id, v) {
    if (id !== 'glideMs') return;
    const n = +v;
    if (!Number.isFinite(n)) return;
    // Clamp [0, 60s]. glideMs=0 is explicit bypass/instant semantics.
    this._glideMs = n < 0 ? 0 : (n > 60000 ? 60000 : n);
    // If a glide is in flight when glideMs changes, recompute step to
    // honour the NEW time-to-target from here.
    if (this._active) {
      const samples = this._glideMs * this.sr * 0.001;
      if (samples <= 0) {
        this._y      = this._target;
        this._step   = 0;
        this._active = false;
      } else {
        this._step = (this._target - this._y) / samples;
        if (this._step === 0) this._active = false;
      }
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    let y       = this._y;
    let target  = this._target;
    let step    = this._step;
    let active  = this._active;
    let init    = this._init;
    const glideSamples = this._glideMs * this.sr * 0.001;

    if (!inCh) {
      // No input — hold last y. Don't auto-decay (glide is a portamento
      // primitive, not a silencer).
      for (let i = 0; i < N; i++) outCh[i] = y;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x = inCh[i];

      if (!init) {
        // First sample: snap.
        y      = x;
        target = x;
        step   = 0;
        active = false;
        init   = true;
      } else if (x !== target) {
        // Target changed — start (or restart) glide from current y.
        target = x;
        if (glideSamples <= 0) {
          y      = target;
          step   = 0;
          active = false;
        } else {
          step   = (target - y) / glideSamples;
          active = step !== 0;
          if (!active) y = target;  // step rounded to 0 ⇒ snap
        }
      }

      if (active) {
        y += step;
        // Snap when within one step of target (covers both directions).
        if (step > 0) {
          if (y >= target) { y = target; active = false; }
        } else /* step < 0 */ {
          if (y <= target) { y = target; active = false; }
        }
      }

      outCh[i] = y;
    }

    this._y      = y;
    this._target = target;
    this._step   = step;
    this._active = active;
    this._init   = init;
  }
}
