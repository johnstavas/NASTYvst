// reverbBus.js — ReverbBus: subtle, mix-friendly bus reverb with ducking.
//
// Signal flow:
//
//   in ─► EnvelopeFollower ─► EarlyReflections ─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
//         (pass-through, posts ~50 Hz level back to main thread)
//
// Pure composition. All DSP is generic and already in the palette.
// Product contributes three things:
//   • sensible mix-bus defaults (short-medium decay, tame density, mild width)
//   • GLUE macro — voicing tilt + mod depth + ducker release together for
//     a cohesive "bus-glue" character
//   • DUCK macro — subscribes to EnvelopeFollower and attenuates engineMix
//                  under loud input, restoring on release
//
// No core edits. No new modules. No DSP in this file.

import { MODULE } from '../fxEngine.js';

export function createReverbBus(fx) {
  fx.setChain([
    MODULE.ENVELOPE_FOLLOWER,
    MODULE.EARLY_REFLECTIONS,
    MODULE.FDN_REVERB,
    MODULE.TILT_EQ,
    MODULE.WIDTH,
  ]);
  fx.setEngineMixMode(true);

  // Bus-friendly fixed config
  fx.setParam(MODULE.EARLY_REFLECTIONS, 'mix', 1.0, { snap: true });
  fx.setParam(MODULE.FDN_REVERB,        'mix', 1.0, { snap: true });
  fx.setParam(MODULE.TILT_EQ, 'crossover', 1100, { snap: true });
  // Envelope: fast attack / medium release — mix-bus ducker timescales.
  fx.setParam(MODULE.ENVELOPE_FOLLOWER, 'attackMs',  8,   { snap: true });
  fx.setParam(MODULE.ENVELOPE_FOLLOWER, 'releaseMs', 220, { snap: true });

  const defaults = {
    size:    0.45,     // bus → mid-small room
    decay:   0.40,     // 0.5..5 s mapped range
    density: 0.55,
    tone:    0.55,
    glue:    0.50,     // bus-character dial
    duck:    0.50,     // 0 = off, 1 = strong duck
    width:   1.00,
    mix:     0.22,     // bus-sensible wet level
  };
  const state  = { ...defaults };
  let   envLvl = 0;

  const er  = (n, v, o) => fx.setParam(MODULE.EARLY_REFLECTIONS, n, v, o);
  const fdn = (n, v, o) => fx.setParam(MODULE.FDN_REVERB,        n, v, o);
  const te  = (n, v, o) => fx.setParam(MODULE.TILT_EQ,           n, v, o);
  const wd  = (n, v, o) => fx.setParam(MODULE.WIDTH,             n, v, o);
  const ef  = (n, v, o) => fx.setParam(MODULE.ENVELOPE_FOLLOWER, n, v, o);

  // ---- Scalar macros ----------------------------------------------------
  function applySize() {
    const s = state.size;
    er('size',       0.5 + s * 0.8);       // 0.5..1.3 — bus stays small-ish
    er('spread',     0.4 + s * 0.4);
    fdn('sizeScale', 0.5 + s * 1.0);       // 0.5..1.5 — no cathedrals
  }
  function applyDecay() {
    // DECAY 0..1 → 0.5..5 s exp — bus-appropriate range.
    const sec = 0.5 * Math.pow(5 / 0.5, state.decay);
    fdn('decay', sec);
  }
  function applyDensity() {
    er('density', 0.30 + state.density * 0.65);
  }
  function applyTone() {
    te('tilt', state.tone);
    const hz = 3500 * Math.pow(14000 / 3500, state.tone);  // 3.5k..14k — bus-friendly ceilings
    fdn('dampHz', hz);
  }
  function applyGlue() {
    const g = state.glue;
    // Gentle mod (subtle chorusing on the tail), slightly extended ER,
    // slower ducker release — all classic bus-reverb glue traits.
    fdn('modDepth', 0.10 + g * 0.30);      // small amount of motion, never wobbly
    fdn('modRate',  0.12 + g * 0.35);      // slow
    ef('releaseMs', 140 + g * 260);         // 140..400 ms — longer at high glue
    // Slightly warm the tilt centre at high glue (pulls tone down by up to 0.1)
    const tt = Math.max(0, state.tone - 0.10 * g);
    te('tilt', tt);
  }
  function applyWidth() { wd('width', state.width); }
  function applyMix()   { applyDuckedMix(); }   // duck participates in mix

  // ---- Ducking ----------------------------------------------------------
  // Product-layer curve: ducked gain = 1 − DUCK · sat(envLvl · k).
  // Rewrite engineMix at control rate (~50 Hz) when envLvl changes.
  function duckCurve() {
    // Soft-saturate envelope so transient spikes don't slam mix to zero.
    const x = Math.min(1, envLvl * 1.8);
    // Smoothstep-ish
    const sat = x * x * (3 - 2 * x);
    return 1.0 - state.duck * 0.80 * sat;     // attenuate up to 80%
  }
  function applyDuckedMix() {
    const g = state.duck > 0.001 ? duckCurve() : 1.0;
    fx.setEngineMix(state.mix * g);
  }

  const unsub = fx.onEnvelopeLevel((v) => {
    envLvl = v;
    if (state.duck > 0.001) applyDuckedMix();
  });

  // ---- Public API -------------------------------------------------------
  const api = {
    setSize   : v => { state.size    = v; applySize();    },
    setDecay  : v => { state.decay   = v; applyDecay();   },
    setDensity: v => { state.density = v; applyDensity(); },
    setTone   : v => { state.tone    = v; applyTone();    applyGlue(); },
    setGlue   : v => { state.glue    = v; applyGlue();    },
    setDuck   : v => { state.duck    = v; applyDuckedMix(); },
    setWidth  : v => { state.width   = v; applyWidth();   },
    setMix    : v => { state.mix     = v; applyMix();     },
    setBypass : on => fx.setBypass(on),
    reset     : () => fx.reset(),
    getState  : () => ({ ...state }),
    loadPreset: (preset) => {
      Object.assign(state, defaults, preset || {});
      applySize(); applyDecay(); applyDensity();
      applyTone(); applyGlue(); applyWidth(); applyMix();
    },
    dispose   : () => { unsub(); },
  };
  api.loadPreset({});
  return api;
}
