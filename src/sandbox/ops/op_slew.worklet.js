// op_slew.worklet.js — Stage-3 op sidecar for the `slew` op.
//
// Catalog #95 (Control primitives). Linear-rate slew limiter:
//
//   rise = target unit-travel time for UPWARD deltas    (ms per unit)
//   fall = target unit-travel time for DOWNWARD deltas  (ms per unit)
//
//   step_up    = 1 / (rise · sr / 1000)   units/sample
//   step_down  = 1 / (fall · sr / 1000)   units/sample
//
//   delta = x[n] − y[n-1]
//   if   delta >  step_up  : y[n] = y[n-1] + step_up
//   elif delta < -step_down: y[n] = y[n-1] − step_down
//   else                   : y[n] = x[n]      (within rate, snap to target)
//
// VS. SMOOTH
//
// `smooth` (#8) is an exponential 1-pole: always decelerating as it
// approaches the target, no sharp corners, τ expressed as a time
// constant. Musical feel: "springy / analog knob".
//
// `slew` is a linear rate limit: full-rate or stopped, sharp corners
// at rate transitions, time expressed as "ms per unit". Musical feel:
// "mechanical / capacitive-discharge / hard-landing".
//
// When a real-world control has rate limits imposed by inertia or a
// driver circuit (DC servo in a vintage comp, tape head response,
// speaker cone mass), slew is the correct model. When it has damping
// (RC filter, spring-loaded pot), smooth is correct.
//
// ASYMMETRY
//
// Separate rise and fall constants mimic real analog behaviour:
//   - envelope followers (attack vs release)
//   - capacitor charge (fast) vs discharge (slow, limited by
//     discharge resistor)
//   - mechanical pots (finger-pulled up is faster than spring-return
//     down on spring-loaded controls)
//
// Default: 10 ms rise, 50 ms fall — slow-ish settling that's
// audible as character, short enough to not feel sluggish.
//
// LATENCY
//
// Zero. slew is a causal, sample-by-sample operator with no look-
// ahead. The price is that transients past the rate limit are
// attenuated rather than delayed.
//
// DENORMALS
//
// Float64 state register, Jon Watte flush on block-end
// (Canon:utilities §1).

const DENORMAL = 1e-30;

export class SlewOp {
  static opId = 'slew';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'riseMs', default: 10 },
    { id: 'fallMs', default: 50 },
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._riseMs   = 10;
    this._fallMs   = 50;
    this._stepUp   = 0;
    this._stepDown = 0;
    this._y        = 0;
    this._recomputeSteps();
  }

  reset() {
    this._y = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    // Clamp: 0 disables (infinite rate, bypass) but we don't special-
    // case it — clamping to 0.001 ms gives a step so large the else-
    // branch always wins (pure passthrough). Max 10 s per unit.
    const clamped = n < 0.001 ? 0.001 : (n > 10000 ? 10000 : n);
    if      (id === 'riseMs') this._riseMs = clamped;
    else if (id === 'fallMs') this._fallMs = clamped;
    else return;
    this._recomputeSteps();
  }

  getLatencySamples() { return 0; }

  _recomputeSteps() {
    // step per sample = 1 unit / (ms * sr / 1000)
    this._stepUp   = 1.0 / (this._riseMs * this.sr * 0.001);
    this._stepDown = 1.0 / (this._fallMs * this.sr * 0.001);
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    const up   = this._stepUp;
    const down = this._stepDown;
    let y = this._y;

    if (!inCh) {
      // No input: rate-limited glide toward 0 at fall rate.
      for (let i = 0; i < N; i++) {
        const delta = -y;
        if (delta > up)        y += up;
        else if (delta < -down) y -= down;
        else                   y = 0;
        outCh[i] = y;
      }
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      this._y = y;
      return;
    }

    for (let i = 0; i < N; i++) {
      const target = inCh[i];
      const delta = target - y;
      if (delta > up) {
        y += up;
      } else if (delta < -down) {
        y -= down;
      } else {
        // Within rate budget: snap to exact target (this is the
        // branch that differentiates slew from smooth — no
        // residual exponential tail).
        y = target;
      }
      outCh[i] = y;
    }

    if (y < DENORMAL && y > -DENORMAL) y = 0;
    this._y = y;
  }
}
