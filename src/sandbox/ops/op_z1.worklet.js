// op_z1.worklet.js — Stage-3 op sidecar for the `z1` op.
//
// Catalog #93 (Control primitives). One-sample delay. Transfer
// function H(z) = z^-1:
//
//   y[n] = x[n-1]     (x[-1] = 0 at reset)
//
// WHY THIS OP EXISTS
//
// z1 is the atomic feedback primitive. It breaks what would otherwise
// be an unresolvable zero-latency cycle in a graph by introducing
// exactly one sample of delay — the minimum the scheduler needs to
// order nodes topologically.
//
// USES
//
//   - Hand-rolled one-pole LP at graph level:
//       y[n] = (1-a)·x[n] + a·y[n-1]
//     where y[n-1] is produced by z1 on the y output fed back.
//
//   - Custom allpass / comb-filter loops without committing to the
//     `delay` op (which is multi-sample + interpolated).
//
//   - DC-coupled differentiator / accumulator: y[n] = x[n] − z1(x[n])
//     gives a first-order difference (high-pass equivalent).
//
//   - Cycle-break instrumentation: any graph author who wants
//     "feedback here" explicit in graph.json inserts z1 on the
//     feedback return path.
//
// LATENCY
//
// getLatencySamples() reports 1 — the master compiler accounts for
// it when aligning sibling paths (dry + wet compensation). Chains
// of N × z1 in series report N-sample latency, mirrored in the
// summed path the compiler emits.
//
// STATE
//
// Single Float64 register. Not Float32, because z1 often lands
// inside tight feedback topologies where per-sample precision loss
// compounds; Float64 state with Float32 I/O costs one cast per
// sample and buys ~40 dB of accumulated headroom. Matches the
// convention already set by dcBlock / onePole / svf state.
//
// DENORMALS
//
// Jon Watte flush on the state register (Canon:utilities §1). A
// feedback loop running z1 with zero input decays to subnormal
// eventually — FTZ/DAZ on the x86 side will handle it, but ARM
// worklets don't guarantee FTZ, so we flush at the op level.

const DENORMAL = 1e-30;

export class Z1Op {
  static opId = 'z1';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._z = 0;  // single-sample register, Float64 in JS by default
  }

  reset() {
    this._z = 0;
  }

  setParam(_id, _v) { /* no params */ }

  // Exactly one sample of delay.
  getLatencySamples() { return 1; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    let z = this._z;

    if (!inCh) {
      // No input: emit the one stored sample, then zero thereafter.
      // State clears to 0 after this block (subsequent blocks see
      // silent input → silent output).
      outCh[0] = z;
      for (let i = 1; i < N; i++) outCh[i] = 0;
      this._z = 0;
      return;
    }

    // Main loop: y[n] = z, then z = x[n].
    // Functionally equivalent to: emit previous sample, store current.
    for (let i = 0; i < N; i++) {
      outCh[i] = z;
      z = inCh[i];
    }

    // Denormal flush (register is Float64 — flush at the tiny threshold).
    if (z < DENORMAL && z > -DENORMAL) z = 0;
    this._z = z;
  }
}
