// op_ramp.worklet.js — Stage-3 op sidecar for the `ramp` op.
//
// Catalog #97 (Control primitives). Triggered one-shot linear ramp
// generator.
//
//   On rising-edge `trig`:
//     phase = 0, active = true
//
//   While active:
//     phase += 1 / (timeMs · sr / 1000)
//     if phase >= 1: phase = 1, active = false
//
//   Output each sample:
//     out = startVal + (endVal − startVal) · phase
//
// POSITION IN THE CONTROL-PRIMITIVE FAMILY
//
//   `slew`      — reactive linear rate-limiter (tracks an input)
//   `smooth`    — reactive exponential 1-pole (tracks an input)
//   `envelope`  — signal-driven asymmetric AR follower
//   `ramp`      — trigger-driven one-shot linear sweep (THIS)
//   `lfo`       — free-running periodic generator
//
// `ramp` is the only one that is both trigger-gated AND finite-time.
// Pair with `trigger` (pulse mode) upstream and any audio processor
// downstream for classic "note-on linear envelope" behaviour.
//
// MODE
//
// timeMs=0 is valid: the ramp completes instantly on any trigger
// (jumps from startVal to endVal in one sample). Enables use as a
// clean "latch to endVal on trigger" utility. We do NOT special-case
// this; the clamp below to 0.001 is deliberately tighter than the
// minimum sensible slew (see slew op header) because here we don't
// need a step-per-sample ≤ 1 constraint — ramp phase naturally
// saturates in one sample when step ≥ 1.
//
// LATENCY: zero. Output depends only on current phase + trigger.
// NO DENORMAL RISK: phase is a bounded ramp, not a recursive state.
//   (startVal/endVal can be any finite value; we trust the author.)

export class RampOp {
  static opId = 'ramp';
  static inputs  = Object.freeze([{ id: 'trig', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',  kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'startVal', default: 0   },
    { id: 'endVal',   default: 1   },
    { id: 'timeMs',   default: 100 },
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._startVal = 0;
    this._endVal   = 1;
    this._timeMs   = 100;
    this._step     = 0;       // computed in _recompute
    this._phase    = 0;       // 0..1
    this._active   = false;
    this._trigHigh = false;
    this._recompute();
  }

  reset() {
    this._phase    = 0;
    this._active   = false;
    this._trigHigh = false;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'startVal')  this._startVal = n;
    else if (id === 'endVal') this._endVal = n;
    else if (id === 'timeMs') {
      // Clamp lower bound to 0 (allowed — instant jump). Upper bound
      // is generous: 60 s covers slow automation. Past that the per-
      // sample step rounds to 0 at typical sr and output stalls
      // indistinguishably from steady state, so the clamp is for
      // sanity not correctness.
      const c = n < 0 ? 0 : (n > 60000 ? 60000 : n);
      this._timeMs = c;
      this._recompute();
    }
  }

  getLatencySamples() { return 0; }

  _recompute() {
    // step per sample along [0,1]. timeMs=0 → step = Infinity → phase
    // saturates on first active sample (handled by clamp in the loop).
    if (this._timeMs <= 0) {
      this._step = Number.POSITIVE_INFINITY;
    } else {
      this._step = 1 / (this._timeMs * this.sr * 0.001);
    }
  }

  process(inputs, outputs, N) {
    const trigCh = inputs.trig;
    const outCh  = outputs.out;
    if (!outCh) return;

    const start = this._startVal;
    const end   = this._endVal;
    const span  = end - start;
    const step  = this._step;
    let phase   = this._phase;
    let active  = this._active;
    let trigHigh = this._trigHigh;

    for (let i = 0; i < N; i++) {
      if (trigCh) {
        const t = trigCh[i];
        if (!trigHigh && t > 0.5) {
          trigHigh = true;
          phase    = 0;
          active   = true;
        } else if (trigHigh && t < 0.5) {
          trigHigh = false;
        }
      }

      if (active) {
        phase += step;
        if (phase >= 1) {
          phase  = 1;
          active = false;
        }
      }
      outCh[i] = start + span * phase;
    }

    this._phase    = phase;
    this._active   = active;
    this._trigHigh = trigHigh;
  }
}
