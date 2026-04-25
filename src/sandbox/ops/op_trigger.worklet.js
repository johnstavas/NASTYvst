// op_trigger.worklet.js — Stage-3 op sidecar for the `trigger` op.
//
// Catalog #96 (Control primitives). Schmitt trigger + optional
// rising-edge pulse.
//
//   armed state machine (hysteresis):
//     if !high and x >= threshHi  → high = true
//     if  high and x <= threshLo  → high = false
//
//   mode='gate':  out = high ? 1 : 0    (persistent square pulse)
//   mode='pulse': out = (high && !prevHigh) ? 1 : 0    (one-sample tick
//                 on arm-up transition only)
//
// HYSTERESIS
//
// The gap between threshHi and threshLo is the dead-band. Without it,
// any signal hovering near a single threshold would chatter 0/1/0/1
// at sample rate. Schmitt named this after the 1930s vacuum-tube
// regenerative comparator that this digital emulator models.
//
// Canon:dynamics §4 (Bram / musicdsp #200 beat detector) uses this
// exact pattern: peak follower → Schmitt(0.3/0.15) → rising-edge
// pulse. We're extracting the Schmitt+edge half as a reusable control
// primitive.
//
// SAFETY: threshLo is forced <= threshHi. If the user passes threshLo
// > threshHi we clamp threshLo = threshHi to avoid degenerate states.
//
// LATENCY: zero. Pure combinational + 1 bit of state.

export class TriggerOp {
  static opId = 'trigger';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'threshHi', default: 0.5 },
    { id: 'threshLo', default: 0.4 },
    { id: 'mode',     default: 'gate' },  // 'gate' | 'pulse' (or 0/1)
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._threshHi = 0.5;
    this._threshLo = 0.4;
    this._mode     = 0;   // 0 = gate, 1 = pulse
    this._high     = false;
  }

  reset() {
    this._high = false;
  }

  setParam(id, v) {
    if (id === 'mode') {
      if (typeof v === 'string') {
        if      (v === 'gate')  this._mode = 0;
        else if (v === 'pulse') this._mode = 1;
        // unknown string: sticky last-good
      } else {
        const n = +v;
        if (Number.isFinite(n)) this._mode = n ? 1 : 0;
      }
      return;
    }
    const n = +v;
    if (!Number.isFinite(n)) return;
    if      (id === 'threshHi') this._threshHi = n;
    else if (id === 'threshLo') this._threshLo = n;
    // Safety: if hi < lo after update, coerce lo down. Keeps state
    // machine well-defined (dead-band collapses to zero at worst).
    if (this._threshLo > this._threshHi) this._threshLo = this._threshHi;
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    const hi   = this._threshHi;
    const lo   = this._threshLo;
    const mode = this._mode;
    let high   = this._high;

    if (!inCh) {
      // No input → treat as 0. State will disarm (0 < lo typically) then
      // stay down; output is all-zero regardless of mode.
      if (!high) {
        for (let i = 0; i < N; i++) outCh[i] = 0;
        return;
      }
      // Was high; 0 may or may not be below lo.
      for (let i = 0; i < N; i++) {
        if (high && 0 <= lo) high = false;
        outCh[i] = (mode === 0) ? (high ? 1 : 0) : 0;  // no rising edge here
      }
      this._high = high;
      return;
    }

    if (mode === 0) {
      // Gate mode — persistent square pulse.
      for (let i = 0; i < N; i++) {
        const x = inCh[i];
        if      (!high && x >= hi) high = true;
        else if ( high && x <= lo) high = false;
        outCh[i] = high ? 1 : 0;
      }
    } else {
      // Pulse mode — one-sample tick on arm-up transition.
      for (let i = 0; i < N; i++) {
        const x = inCh[i];
        let edge = 0;
        if (!high && x >= hi) { high = true; edge = 1; }
        else if (high && x <= lo) { high = false; }
        outCh[i] = edge;
      }
    }

    this._high = high;
  }
}
