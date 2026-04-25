// op_stepSeq.worklet.js — Catalog #59 (Movement / Modulation family).
//
// Step sequencer — N-step value table, advances on rising-edge trigger,
// wraps to step 0 after `length-1`. Output held between triggers (S&H).
//
// PRIMARY (algorithm, open — GPLv3 code NOT copied):
//   SuperCollider · server/plugins/TriggerUGens.cpp · Stepper_next_a0
//   (develop branch, lines 1322-1338)
//
// VERBATIM PASSAGE (SC Stepper_next_a0, for diff only):
//   float curtrig = ZXP(trig);
//   if (prevtrig <= 0.f && curtrig > 0.f) {
//     level = (float)sc_wrap((int32)level + step, zmin, zmax);
//   }
//   ZXP(out) = level;
//   prevtrig = curtrig;
//
// SC's `Stepper` is just the counter — combine with an array lookup and you
// get the textbook step sequencer (Moog 960, Serge Sequencer, ARP 1601,
// Doepfer A-155, every modular ever). Counter-advance logic is math-by-def;
// the value lookup `out = values[index]` is also math-by-def.
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) Fixed 8 steps, exposed as individual params (s0..s7). Why 8: matches
//       the standard hardware-sequencer width; powers of 2 simplify wrap.
//       16- or 32-step variants are graph-level macros (chain two stepSeqs
//       with a Stepper-driven select). Upgrade path: array params if/when
//       opRegistry grows that kind (debt row).
//  (ii) `length` param (1-8) lets users use shorter loops at runtime.
//       Counter wraps to 0 after `length-1`.
// (iii) Trigger semantics = rising-edge-through-zero (SC-faithful, matches
//       #123 sampleHold). Same justification.
//  (iv) Initial index = 0. SC's Stepper inits at zmin too (typical).
//   (v) No internal clock. External trigger only — graph composes with
//       #22 trigger / divider to clock at rate. Keeps primitive pure.
//
// PARAMS
//   length — number of active steps              [1, 8]   default 8
//   s0..s7 — value at each step (linear)         [-1, 1]  default 0
//
// I/O
//   inputs:  trig (audio — treated as trigger)
//   outputs: out  (audio — held step value)
//
// LATENCY: 0.

export class StepSeqOp {
  static opId = 'stepSeq';
  static inputs  = Object.freeze([{ id: 'trig', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out',  kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'length', default: 8 },
    { id: 's0', default: 0 }, { id: 's1', default: 0 },
    { id: 's2', default: 0 }, { id: 's3', default: 0 },
    { id: 's4', default: 0 }, { id: 's5', default: 0 },
    { id: 's6', default: 0 }, { id: 's7', default: 0 },
  ]);

  constructor(sampleRate = 48000) {
    this.sr        = sampleRate;
    this._length   = 8;
    this._values   = new Float32Array(8);  // s0..s7
    this._idx      = -1;  // sentinel: first trigger lands on step 0
    this._prevTrig = 0;
    this._level    = 0;
  }

  reset() {
    this._idx      = -1;
    this._prevTrig = 0;
    this._level    = 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    if (id === 'length') {
      this._length = Math.max(1, Math.min(8, v | 0));
      return;
    }
    if (id.length === 2 && id[0] === 's') {
      const k = id.charCodeAt(1) - 48;  // '0'..'7'
      if (k >= 0 && k <= 7) {
        this._values[k] = Math.max(-1, Math.min(1, v));
      }
    }
  }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const trigBuf = inputs && inputs.trig ? inputs.trig : null;
    const vals    = this._values;
    const len     = this._length;

    let idx      = this._idx;
    let prevTrig = this._prevTrig;
    let level    = this._level;

    for (let n = 0; n < N; n++) {
      const curT = trigBuf ? trigBuf[n] : 0;
      if (prevTrig <= 0 && curT > 0) {
        idx = (idx + 1) % len;       // SC sc_wrap analogue
        level = vals[idx];
      }
      out[n] = level;
      prevTrig = curT;
    }

    this._idx      = idx;
    this._prevTrig = prevTrig;
    this._level    = level;
  }

  getLatencySamples() { return 0; }
}
