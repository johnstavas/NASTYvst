// op_gate.worklet.js — Stage-3 op sidecar for the `gate` op.
//
// Catalog #41 (Dynamics). Noise gate. Completes the classic dynamics
// quartet alongside #3 detector + #4 envelope + #5 gainComputer.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//
//   Envelope detector (core sidechain):
//     dsp_code_canon_dynamics.md §1 "Bram Envelope Detector"
//     (musicdsp #97, Bram de Jong 2002-04-12, assume public-domain)
//     Full code block opened and pasted verbatim below.
//
//   Gate state-machine topology:
//     **Math-by-definition primitive — declared.** A noise gate is a
//     well-defined textbook combination of envelope follower (§1) +
//     Schmitt-trigger hysteresis + A/H/R gain ballistics over a 5-state
//     machine {CLOSED, ATTACK, OPEN, HOLD, RELEASE}. No single canonical
//     paper; Zölzer DAFX Ch. 7 §7.3 describes the topology.
//
//     Surveyed primaries 2026-04-24 (post-ship audit):
//       • Airwindows Gatelope (MIT) — spectral / multiband gate,
//         not a Schmitt-hysteresis time-domain gate. Structurally
//         divergent; not citable as primary for this op.
//       • Faust `compressors.lib` (GRAME, LGPL) — provides compressor
//         and expander gain computers but **no dedicated gate function**
//         (gates there are modelled as ratio=∞ expanders; no state
//         machine, no hold stage).
//       • musicdsp.org Effects index — envelope followers (#97 §1, used
//         above) but no gate entry with Schmitt hysteresis + 5-state
//         ballistics.
//       • Local amplessEngine.js — 2-state CLOSED/OPEN gate; simpler
//         topology (no ATTACK / HOLD / RELEASE lerp stages).
//     Conclusion: no open-source primary matches our 5-state Schmitt
//     topology end-to-end. Math-by-definition declaration preserved
//     with this survey trail; structural contract documented inline
//     below.
//
// PASSAGE VERBATIM (dsp_code_canon_dynamics.md §1 lines 15–31):
//
//   float ga = (float)exp(-1/(SampleRate*attack));
//   float gr = (float)exp(-1/(SampleRate*release));
//   float envelope = 0;
//   for (...) {
//     EnvIn = std::abs(input);
//     if (envelope < EnvIn) {
//       envelope *= ga;
//       envelope += (1-ga)*EnvIn;
//     } else {
//       envelope *= gr;
//       envelope += (1-gr)*EnvIn;
//     }
//   }
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Detector attack/release are sidechain-internal**, separate
//      from the gate's own A/H/R (which shape the OUTPUT GAIN, not
//      the detector envelope). Fixed fast detector: attackMs=1,
//      releaseMs=10 for snappy threshold tracking. User's `attackMs`
//      / `holdMs` / `releaseMs` params drive GAIN ballistics on top
//      of the envelope. This two-timing-constant pattern is textbook
//      Zölzer / Giannoulis 2012 but is NOT in §1 itself — §1 only
//      covers the envelope. Declared as deviation.
//   2. **Schmitt-trigger hysteresis.** Threshold has an internal 3 dB
//      band: `thOpen = threshold`, `thClose = threshold · 10^(-3/20)`.
//      Prevents chatter when env hovers near threshold. Not in §1;
//      universal textbook extension.
//   3. **State machine {CLOSED, ATTACK, OPEN, HOLD, RELEASE}.**
//      Attack ramps gain from `floor` to 1 over `attackMs`.
//      Hold keeps gain=1 for `holdMs` after env drops below thClose.
//      Release ramps gain from 1 to `floor` over `releaseMs`.
//   4. **floor** param (default 0.0, fully muted) — user may raise
//      to e.g. 0.1 for partial ducking / range-control use.
//   5. **Gain ramp is exponential, not linear** — matches the §1
//      one-pole form applied to the gain-target signal: `g += c·(tgt−g)`.
//      Cheaper than true linear ramp and consistent with rest of stack.
//   6. **Denormal flush** on envelope and gain.
//   7. **Mix** param for wet/dry blend; cos/sin equal-power per
//      dry_wet_mix_rule.md.
//
//   NOTE on §1 "LIMITS" row: "36.7% decay reference (not 1%)". Our
//   exp(-1/(sr*tc)) coefficient matches §1 exactly; users targeting
//   100→1% semantics should multiply tc by ~4.6. Consistent w/ §1.

const DENORMAL = 1e-30;

const ST_CLOSED  = 0;
const ST_ATTACK  = 1;
const ST_OPEN    = 2;
const ST_HOLD    = 3;
const ST_RELEASE = 4;

function timeCoef(ms, sr) {
  // §1: exp(-1/(sr*tc)) with tc in seconds.
  const tc = Math.max(ms, 0.01) / 1000;
  return Math.exp(-1 / (sr * tc));
}

export class GateOp {
  static opId    = 'gate';
  static inputs  = Object.freeze([
    { id: 'in', kind: 'audio' },
    { id: 'sidechain', kind: 'audio', optional: true }, // external detector input
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'threshold', default: 0.1  }, // linear amplitude (not dB)
    { id: 'attackMs',  default: 1    },
    { id: 'holdMs',    default: 20   },
    { id: 'releaseMs', default: 100  },
    { id: 'floor',     default: 0.0  }, // 0 = full mute, 1 = bypass
    { id: 'mix',       default: 1.0  },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    // Detector (internal, fast — deviation #1).
    this._detAttack  = timeCoef(1,  sampleRate);
    this._detRelease = timeCoef(10, sampleRate);
    this._env = 0;

    // Gate state + output gain.
    this._state = ST_CLOSED;
    this._gain  = 0;
    this._holdSamps = 0; // countdown
    this._holdTarget = Math.round(20 / 1000 * sampleRate);

    // User params.
    this._threshold = 0.1;
    this._attackMs  = 1;
    this._releaseMs = 100;
    this._floor     = 0.0;
    this._mix       = 1.0;
    this._gAttack   = timeCoef(1,   sampleRate);
    this._gRelease  = timeCoef(100, sampleRate);
    this._thClose   = 0.1 * Math.pow(10, -3 / 20); // 3 dB hysteresis
  }

  reset() {
    this._env = 0;
    this._state = ST_CLOSED;
    this._gain = 0;
    this._holdSamps = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'threshold') {
      this._threshold = n < 0 ? 0 : n;
      this._thClose   = this._threshold * Math.pow(10, -3 / 20);
    } else if (id === 'attackMs') {
      this._attackMs = n < 0.01 ? 0.01 : n;
      this._gAttack  = timeCoef(this._attackMs, this.sr);
    } else if (id === 'holdMs') {
      const h = n < 0 ? 0 : n;
      this._holdTarget = Math.round(h / 1000 * this.sr);
    } else if (id === 'releaseMs') {
      this._releaseMs = n < 0.01 ? 0.01 : n;
      this._gRelease  = timeCoef(this._releaseMs, this.sr);
    } else if (id === 'floor') {
      this._floor = n < 0 ? 0 : (n > 1 ? 1 : n);
    } else if (id === 'mix') {
      this._mix = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const sc  = inputs.sidechain;
    const out = outputs.out;
    if (!out) return;

    const mix  = this._mix;
    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    const detA = this._detAttack;
    const detR = this._detRelease;
    const gA   = this._gAttack;
    const gR   = this._gRelease;
    const thO  = this._threshold;
    const thC  = this._thClose;
    const floor = this._floor;
    const holdT = this._holdTarget;

    let env   = this._env;
    let state = this._state;
    let gain  = this._gain;
    let holdS = this._holdSamps;

    for (let i = 0; i < N; i++) {
      const x  = inp ? inp[i] : 0;
      const sx = sc  ? sc[i]  : x;

      // §1 envelope detector on sidechain (or in when unwired).
      const envIn = Math.abs(sx);
      if (env < envIn) { env = env * detA + (1 - detA) * envIn; }
      else             { env = env * detR + (1 - detR) * envIn; }
      if (env > -DENORMAL && env < DENORMAL) env = 0;

      // State machine (deviation #3 + Schmitt hysteresis deviation #2).
      switch (state) {
        case ST_CLOSED:
          if (env >= thO) state = ST_ATTACK;
          break;
        case ST_ATTACK:
          if (gain >= 0.9999) { gain = 1; state = ST_OPEN; }
          else if (env < thC) state = ST_RELEASE; // threshold dropped mid-attack
          break;
        case ST_OPEN:
          if (env < thC) { holdS = holdT; state = ST_HOLD; }
          break;
        case ST_HOLD:
          if (env >= thO)      state = ST_OPEN;
          else if (--holdS <= 0) state = ST_RELEASE;
          break;
        case ST_RELEASE:
          if (env >= thO) state = ST_ATTACK; // retrigger
          else if (gain <= floor + 1e-5) { gain = floor; state = ST_CLOSED; }
          break;
      }

      // Gain ramp (deviation #5: exp one-pole toward target).
      const target = (state === ST_ATTACK) ? 1
                   : (state === ST_OPEN)   ? 1
                   : (state === ST_HOLD)   ? 1
                   : (state === ST_RELEASE)? floor
                   : /* CLOSED */           floor;
      const coef = (state === ST_ATTACK) ? gA : gR;
      gain = gain * coef + (1 - coef) * target;
      if (gain > -DENORMAL && gain < DENORMAL) gain = 0;

      const wet = x * gain;
      out[i] = gDry * x + gWet * wet;
    }

    this._env = env;
    this._state = state;
    this._gain = gain;
    this._holdSamps = holdS;
  }
}
