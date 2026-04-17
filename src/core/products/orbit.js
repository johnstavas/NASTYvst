// orbit.js — Orbit: motion-focused comb reverb with rotating spatial taps.
//
// Signal flow:
//
//   in ─► CombBank ─► Diffuser ─► TiltEq ─► engineMix ─► out
//
// Non-FDN branch of the reverb family: late field is a 4-comb Schroeder-
// style network with external length modulation, smeared by an allpass
// diffuser. All DSP is generic; Orbit contributes only:
//   • PATH 0..3 — preset motion topologies (circle, figure-8, pendulum, chaos)
//   • MOTION    — rotation rate
//   • DEPTH     — modulation amplitude
//   • standard SIZE / TONE / SPREAD / FEEDBACK / MIX macros
//
// The "spatial pan rotator" is realized entirely as control-rate writes
// to CombBank.mod0..mod3 in a rotating phase pattern — each comb is a
// distinct pitched delay, so cycling their length offsets through a
// 4-point rotation in the complex plane creates a convincing orbital
// stereo image without adding a new core module. When a second product
// clearly needs a true SpatialPanModule, it gets promoted out of Orbit.
//
// Reuses only: CombBankModule, DiffuserModule, TiltEqModule, engineMix.
// No core edits.

import { MODULE } from '../fxEngine.js';

export function createOrbit(fx) {
  fx.setChain([
    MODULE.COMB_BANK,
    MODULE.DIFFUSER,
    MODULE.TILT_EQ,
  ]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.35);

  // Wet-only inside the chain
  fx.setParam(MODULE.COMB_BANK, 'mix', 1.0, { snap: true });
  fx.setParam(MODULE.TILT_EQ, 'crossover', 900, { snap: true });

  const defaults = {
    motion:   0.45,   // rotation rate
    depth:    0.55,   // mod amplitude
    path:     0,      // 0=circle 1=fig8 2=pendulum 3=chaos
    size:     0.55,
    tone:     0.55,
    spread:   0.60,
    feedback: 0.55,
    mix:      0.35,
  };
  const state = { ...defaults };

  const cb = (n, v, o) => fx.setParam(MODULE.COMB_BANK, n, v, o);
  const df = (n, v, o) => fx.setParam(MODULE.DIFFUSER,  n, v, o);
  const te = (n, v, o) => fx.setParam(MODULE.TILT_EQ,   n, v, o);

  // ---- Scalar macros ----------------------------------------------------
  function applySize() {
    cb('sizeScale', 0.5 + state.size * 1.3);       // 0.5..1.8
    df('size',      0.25 + state.size * 0.65);     // 0.25..0.90
  }
  function applyTone()   { te('tilt', state.tone); }
  function applySpread() {
    cb('crossfeed', state.spread * 0.45);
    df('amount',    0.30 + state.spread * 0.55);
    cb('damp',      0.25 + (1.0 - state.spread) * 0.25);  // slightly darker at tight
  }
  function applyFeedback() { cb('fb', 0.45 + state.feedback * 0.45); } // 0.45..0.90
  function applyMix()      { fx.setEngineMix(state.mix); }

  // ---- Motion rotator (control plane only) ------------------------------
  // 60 Hz tick rotates a phase and writes mod0..3 = amp·f_path(phase, k).
  // ParamSmoother in the worklet handles per-sample interpolation.
  const TICK_MS = 16;        // ~60 Hz
  let phase = 0;             // radians
  let chaosState = [0, 0, 0, 0];
  let timer = null;

  function tickPhase() {
    // MOTION 0..1 → 0.05..4 Hz base rate (exp feel)
    const hz = 0.05 * Math.pow(4 / 0.05, state.motion);
    phase += 2 * Math.PI * hz * (TICK_MS / 1000);
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
  }
  function pathValue(k) {
    // 4 combs → angular offset 0, π/2, π, 3π/2 (orbital quadrants)
    const off = k * Math.PI * 0.5;
    switch (state.path | 0) {
      case 0: // CIRCLE — uniform rotation
        return Math.sin(phase + off);
      case 1: // FIGURE-8 — two combs move in sine, two in sine(2φ)
        return (k & 1) ? Math.sin(2 * phase + off) : Math.sin(phase + off);
      case 2: // PENDULUM — all combs share one axis, phase-staggered
        return Math.sin(phase) * Math.cos(off * 0.5);
      case 3: // CHAOS — random walk per comb, refreshed each tick
        chaosState[k] += (Math.random() * 2 - 1) * 0.12;
        chaosState[k] -= chaosState[k] * 0.015;
        chaosState[k] = Math.max(-1, Math.min(1, chaosState[k]));
        return chaosState[k];
      default: return 0;
    }
  }
  function step() {
    const amp = state.depth;
    if (amp <= 0.001 && state.motion <= 0.001) {
      // Relax mods toward 0
      let anyNonZero = false;
      for (let k = 0; k < 4; k++) {
        const v = pathValueRelax(k);
        if (Math.abs(v) > 1e-4) anyNonZero = true;
        fx.setParam(MODULE.COMB_BANK, 'mod' + k, v);
      }
      if (!anyNonZero) { stopMotion(); return; }
      return;
    }
    tickPhase();
    for (let k = 0; k < 4; k++) {
      const v = pathValue(k) * amp;
      fx.setParam(MODULE.COMB_BANK, 'mod' + k, v);
    }
  }
  // Relax helper — reuses last chaos state or returns 0 for deterministic paths
  const lastValue = [0, 0, 0, 0];
  function pathValueRelax(k) {
    lastValue[k] *= 0.85;
    return lastValue[k];
  }
  function startMotion() {
    if (timer) return;
    if (typeof setInterval === 'function') timer = setInterval(step, TICK_MS);
  }
  function stopMotion() {
    if (!timer) return;
    clearInterval(timer); timer = null;
  }

  // ---- Public API -------------------------------------------------------
  const api = {
    setMotion  : v => { state.motion   = v; /* timer reads it */ },
    setDepth   : v => { state.depth    = v; },
    setPath    : v => { state.path     = Math.max(0, Math.min(3, v | 0)); chaosState = [0,0,0,0]; },
    setSize    : v => { state.size     = v; applySize();     },
    setTone    : v => { state.tone     = v; applyTone();     },
    setSpread  : v => { state.spread   = v; applySpread();   },
    setFeedback: v => { state.feedback = v; applyFeedback(); },
    setMix     : v => { state.mix      = v; applyMix();      },
    setBypass  : on => fx.setBypass(on),
    reset      : () => fx.reset(),
    getState   : () => ({ ...state }),
    loadPreset : (preset) => {
      Object.assign(state, defaults, preset || {});
      applySize(); applyTone(); applySpread();
      applyFeedback(); applyMix();
    },
    dispose    : () => { stopMotion(); },
  };
  api.loadPreset({});
  startMotion();
  return api;
}
