// op_sampleHold.worklet.js — Catalog #123 (Control/Movement family).
//
// Sample & hold — latch input on rising-edge trigger, hold output between.
//
// PRIMARY (algorithm, open — GPLv3 code NOT copied):
//   SuperCollider · server/plugins/TriggerUGens.cpp · Latch_next_aa
//   https://github.com/supercollider/supercollider — develop branch, lines 1014-1026.
//
// VERBATIM PASSAGE (SC Latch_next_aa, for diff only):
//   LOOP1(inNumSamples,
//         float curtrig = ZXP(trig);
//         if (prevtrig <= 0.f && curtrig > 0.f) level = ZXP(in);
//         else { PZ(in); }
//         ZXP(out) = level;
//         prevtrig = curtrig;);
//
// The "rising-edge-through-zero" trigger rule (prevtrig ≤ 0 AND curtrig > 0)
// matches SC Latch, Buchla 266 S&H, Serge S&H, Doepfer A-148, and every
// modular clone. Math-by-definition for the S&H primitive; SC code is
// GPLv3 so we don't copy it, only mirror the three-line algorithm.
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) Trigger semantics = rising-edge-through-zero. Alternatives considered
//       and rejected: "any positive sample" (fires continuously while trig
//       held high), "rising-edge-anywhere" (fires on 0.1→0.2). SC's rule is
//       standard across Eurorack and CSound and is the one users expect.
//  (ii) Initial hold = 0. Matches SC (unit->mLevel = 0.f in Latch_Ctor).
//       Alternative: hold whatever the first `in` sample is, to avoid
//       audible "click from zero" on first trigger. Rejected — SC-faithful.
// (iii) No internal clock / rate param. Faithful to SC Latch, which takes
//       an external trigger. A #127-style splitter + #22 trigger can drive
//       this at arbitrary rates. Keeps the primitive pure.
//
// PARAMS (none — pure latch)
//
// I/O
//   inputs:  in (audio), trig (audio — treated as trigger signal)
//   outputs: out (audio — held level)
//
// LATENCY: 0.

export class SampleHoldOp {
  static opId = 'sampleHold';
  static inputs  = Object.freeze([
    { id: 'in',   kind: 'audio' },
    { id: 'trig', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._level    = 0;
    this._prevTrig = 0;
  }

  reset() {
    this._level    = 0;
    this._prevTrig = 0;
  }

  setParam(_id, _v) { /* no params */ }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const inBuf   = inputs && inputs.in   ? inputs.in   : null;
    const trigBuf = inputs && inputs.trig ? inputs.trig : null;

    let level    = this._level;
    let prevTrig = this._prevTrig;

    for (let n = 0; n < N; n++) {
      const x    = inBuf   ? inBuf[n]   : 0;
      const curT = trigBuf ? trigBuf[n] : 0;
      if (prevTrig <= 0 && curT > 0) level = x;   // rising-edge latch
      out[n] = level;
      prevTrig = curT;
    }

    this._level    = level;
    this._prevTrig = prevTrig;
  }

  getLatencySamples() { return 0; }
}
