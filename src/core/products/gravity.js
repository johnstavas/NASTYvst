// gravity.js — Gravity: cinematic, slow-blooming reverb.
//
// Signal flow:
//
//   in ─► EarlyReflections ─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
//
// Composition only. All DSP is generic:
//   • EarlyReflectionsModule  — front ER cluster, size/spread/density
//   • FdnReverbModule         — 8-ch Householder late field (shared with MorphReverb)
//   • TiltEqModule, WidthModule
//
// Product layer owns:
//   • GRAVITY  — weights the ER vs FDN balance and pushes FDN decay
//                (heavier = longer, darker, denser late field)
//   • BLOOM    — slow swell of FDN mod-depth + decay via a control-rate
//                timer; relaxes cleanly to 0 when BLOOM = 0
//
// Validates reuse of FdnReverbModule across a second product with no core edits.

import { MODULE } from '../fxEngine.js';

export function createGravity(fx) {
  fx.setChain([
    MODULE.EARLY_REFLECTIONS,
    MODULE.FDN_REVERB,
    MODULE.TILT_EQ,
    MODULE.WIDTH,
  ]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.40);

  // Wet-only inside the chain
  fx.setParam(MODULE.EARLY_REFLECTIONS, 'mix', 1.0, { snap: true });
  fx.setParam(MODULE.FDN_REVERB,        'mix', 1.0, { snap: true });
  fx.setParam(MODULE.TILT_EQ,     'crossover', 1000, { snap: true });

  const defaults = {
    gravity: 0.55,
    bloom:   0.30,
    size:    0.60,
    decay:   0.55,
    tone:    0.45,   // darker-leaning neutral for cinematic voice
    density: 0.70,
    width:   1.15,
    mix:     0.40,
  };
  const state = { ...defaults };

  const er  = (n, v, o) => fx.setParam(MODULE.EARLY_REFLECTIONS, n, v, o);
  const fdn = (n, v, o) => fx.setParam(MODULE.FDN_REVERB,        n, v, o);
  const te  = (n, v, o) => fx.setParam(MODULE.TILT_EQ,           n, v, o);
  const wd  = (n, v, o) => fx.setParam(MODULE.WIDTH,             n, v, o);

  // ---- Macros -----------------------------------------------------------
  function applySize() {
    const s = state.size;
    er('size',       0.6 + s * 0.9);      // 0.6..1.5
    er('spread',     0.5 + s * 0.4);      // 0.5..0.9
    fdn('sizeScale', 0.6 + s * 1.2);      // 0.6..1.8
  }
  function applyDecay() { applyDecayAndBloom(); }
  function applyGravity() {
    // GRAVITY pulls the impression weight from ER toward late field:
    //   low  → loud ER, short FDN
    //   high → quieter ER, long/dark FDN
    const g = state.gravity;
    // FDN side-effect on decay handled by the combined helper to keep BLOOM
    // and GRAVITY additive on the same target.
    applyDecayAndBloom();
    // ER density shrinks slightly as gravity rises (more air, less clatter)
    er('density', state.density * (1.0 - 0.35 * g));
    // Tone darkens as gravity rises (pull TiltEq toward LF)
    const tt = Math.max(0, state.tone - 0.30 * g);
    te('tilt', tt);
    const hz = 2200 * Math.pow(15000 / 2200, Math.max(0, state.tone - 0.25 * g));
    fdn('dampHz', hz);
  }
  function applyTone() { applyGravity(); }        // tone ↔ gravity coupled
  function applyDensity() {
    // Base density driven by DENSITY, then scaled by GRAVITY inside applyGravity.
    applyGravity();
  }
  function applyBloom() {
    // BLOOM enables the control-rate swell. Apply base decay/mod immediately.
    applyDecayAndBloom();
    if (state.bloom > 0.001) startSwell();
  }
  function applyWidth() { wd('width', state.width); }
  function applyMix()   { fx.setEngineMix(state.mix); }

  // --- Joint helper for GRAVITY + DECAY + BLOOM (all write fdn.decay) ---
  // Base decay (sec) from DECAY norm, then GRAVITY adds a multiplicative
  // pull toward long decays, and BLOOM's slow envelope adds on top.
  let bloomEnv = 0;   // 0..1 slow envelope updated by swell timer
  function applyDecayAndBloom() {
    const base = 0.6 * Math.pow(12 / 0.6, state.decay);     // 0.6..12 s
    const gMul = 1.0 + state.gravity * 1.4;                  // up to 2.4×
    const bAdd = bloomEnv * state.bloom * 4.0;               // up to +4 s
    fdn('decay', base * gMul + bAdd);
    fdn('modDepth', 0.15 + state.bloom * 0.5 + bloomEnv * state.bloom * 0.3);
    fdn('modRate',  0.10 + (1.0 - state.bloom) * 0.6);        // bloomier = slower
  }

  // ---- BLOOM swell (control-rate, not DSP) ------------------------------
  // Slow envelope that rises while BLOOM > 0 and relaxes back when it's
  // pulled down. Writes through applyDecayAndBloom so automation stays
  // coherent with DECAY / GRAVITY without racing them.
  const TICK_MS = 50;
  let timer = null;
  function step() {
    const target = state.bloom;
    // Rise with ~6 s constant at BLOOM=1, fall with ~2 s
    const up   = 1.0 - Math.exp(-(TICK_MS / 1000) / (1.5 + 6 * (1 - target)));
    const down = 1.0 - Math.exp(-(TICK_MS / 1000) / 2.0);
    if (target > bloomEnv) bloomEnv += (target - bloomEnv) * up;
    else                   bloomEnv += (0      - bloomEnv) * down;
    if (bloomEnv < 1e-4 && target < 1e-3) {
      bloomEnv = 0;
      applyDecayAndBloom();
      stopSwell();
      return;
    }
    applyDecayAndBloom();
  }
  function startSwell() {
    if (timer) return;
    if (typeof setInterval === 'function') timer = setInterval(step, TICK_MS);
  }
  function stopSwell() {
    if (!timer) return;
    clearInterval(timer); timer = null;
  }

  // ---- Public API -------------------------------------------------------
  const api = {
    setGravity: v => { state.gravity = v; applyGravity(); },
    setBloom  : v => { state.bloom   = v; applyBloom();   },
    setSize   : v => { state.size    = v; applySize();    },
    setDecay  : v => { state.decay   = v; applyDecay();   },
    setTone   : v => { state.tone    = v; applyTone();    },
    setDensity: v => { state.density = v; applyDensity(); },
    setWidth  : v => { state.width   = v; applyWidth();   },
    setMix    : v => { state.mix     = v; applyMix();     },
    setBypass : on => fx.setBypass(on),
    reset     : () => fx.reset(),
    getState  : () => ({ ...state }),
    loadPreset: (preset) => {
      Object.assign(state, defaults, preset || {});
      applySize(); applyDensity(); applyGravity();
      applyDecay(); applyTone(); applyBloom();
      applyWidth(); applyMix();
    },
    dispose   : () => { stopSwell(); },
  };
  api.loadPreset({});
  return api;
}
