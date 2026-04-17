// plateX.js — PlateX: character-heavy plate reverb with TENSION + METAL.
//
// Signal flow:
//
//   in ─► EnvelopeFollower ─► Diffuser ─► CombBank ─► DiffuserB ─► TiltEq ─► Width ─► engineMix ─► out
//         (audio pass-through, posts ~50 Hz level back to main thread)
//
// Non-FDN branch. The "plate" is modeled as:
//   • pre-diffusion (DIFFUSER) — short AP cascade
//   • modal ring (CombBank)    — 4 combs run at high fb for narrow resonances
//   • post-diffusion (DIFFUSER_B) — smear the modes to taste (controls METAL)
//   • tilt + width              — voicing
//
// Plates physically choke when hit hard (damping rises with amplitude).
// The new EnvelopeFollowerModule reports input level back to the main
// thread at ~50 Hz; PlateX uses that to push CombBank.fb down under
// transients — classic plate dynamic response, without any sample-
// accurate sidechain primitive.
//
// Owns no DSP. TENSION, METAL, and the DYNAMICS fb-modulation curve are
// pure control-plane mapping.

import { MODULE } from '../fxEngine.js';

export function createPlateX(fx) {
  fx.setChain([
    MODULE.ENVELOPE_FOLLOWER,
    MODULE.DIFFUSER,
    MODULE.COMB_BANK,
    MODULE.DIFFUSER_B,
    MODULE.TILT_EQ,
    MODULE.WIDTH,
  ]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.35);

  // Fixed module config
  fx.setParam(MODULE.COMB_BANK, 'mix',       1.0, { snap: true });
  fx.setParam(MODULE.COMB_BANK, 'crossfeed', 0.30, { snap: true });
  fx.setParam(MODULE.DIFFUSER,   'size',   0.35, { snap: true });  // pre: tight
  fx.setParam(MODULE.DIFFUSER_B, 'size',   0.80, { snap: true });  // post: wide
  fx.setParam(MODULE.TILT_EQ, 'crossover', 1200, { snap: true });
  fx.setParam(MODULE.ENVELOPE_FOLLOWER, 'attackMs',  5,   { snap: true });
  fx.setParam(MODULE.ENVELOPE_FOLLOWER, 'releaseMs', 180, { snap: true });

  const defaults = {
    size:      0.55,
    tone:      0.55,
    diffusion: 0.65,
    tension:   0.40,
    metal:     0.25,
    dynamics:  0.35,   // 0 = static fb; 1 = aggressive plate choke
    width:     1.10,
    mix:       0.35,
  };
  const state  = { ...defaults };
  let   envLvl = 0;

  const cb = (n, v, o) => fx.setParam(MODULE.COMB_BANK, n, v, o);
  const da = (n, v, o) => fx.setParam(MODULE.DIFFUSER,   n, v, o);
  const db = (n, v, o) => fx.setParam(MODULE.DIFFUSER_B, n, v, o);
  const te = (n, v, o) => fx.setParam(MODULE.TILT_EQ,    n, v, o);
  const wd = (n, v, o) => fx.setParam(MODULE.WIDTH,      n, v, o);

  // ---- Derived base feedback --------------------------------------------
  // Base fb comes from TENSION + METAL combined. DYNAMICS then pulls it
  // down in proportion to the envelope level.
  function baseFb() {
    // TENSION raises the ring; METAL pushes to the edge for sharp modes.
    return 0.55 + state.tension * 0.28 + state.metal * 0.14;   // up to 0.97
  }
  function applyFbNow() {
    const fb0 = baseFb();
    const choke = state.dynamics * Math.min(1, envLvl * 1.5);  // 0..~1
    const fbEff = Math.max(0.10, Math.min(0.97, fb0 * (1 - 0.45 * choke)));
    cb('fb', fbEff);
  }

  // ---- Scalar macros ----------------------------------------------------
  function applySize() {
    const s = state.size;
    cb('sizeScale', 0.4 + s * 1.2);                   // 0.4..1.6
    da('size',      0.25 + s * 0.40);
    db('size',      0.70 + s * 0.25);
  }
  function applyTone() {
    te('tilt', state.tone);
    // Tone also trims the HF damp in combs — brighter tone = less damp.
    cb('damp', Math.max(0.05, 0.45 - state.tone * 0.30 - state.metal * 0.20));
  }
  function applyDiffusion() {
    const x = state.diffusion;
    da('amount', 0.30 + x * 0.60);
    // METAL reduces post-diffusion to expose the modes.
    db('amount', Math.max(0, (0.25 + x * 0.55) * (1 - 0.7 * state.metal)));
  }
  function applyTension() {
    // TENSION tightens the comb lengths (higher modal frequencies) and
    // pushes fb up via baseFb()/applyFbNow.
    const t = state.tension;
    // Compose with SIZE: tension scales sizeScale down by up to 40%.
    const s = state.size;
    cb('sizeScale', (0.4 + s * 1.2) * (1 - 0.40 * t));
    applyFbNow();
    applyTone();   // tension indirectly affects damp via metal coupling? re-apply.
  }
  function applyMetal() {
    // METAL: push fb toward the edge, reduce post-diffusion, reduce damp.
    applyFbNow();
    applyDiffusion();
    applyTone();
  }
  function applyDynamics() {
    // DYNAMICS just changes the envelope→fb coupling amount.
    applyFbNow();
  }
  function applyWidth() { wd('width', state.width); }
  function applyMix()   { fx.setEngineMix(state.mix); }

  // ---- Envelope subscription -------------------------------------------
  const unsub = fx.onEnvelopeLevel((v) => {
    envLvl = v;
    // Only rewrite fb if DYNAMICS is meaningfully engaged — avoids port
    // traffic when plate is static.
    if (state.dynamics > 0.001) applyFbNow();
  });

  // ---- Public API -------------------------------------------------------
  const api = {
    setSize     : v => { state.size      = v; applySize();      applyTension(); },
    setTone     : v => { state.tone      = v; applyTone();      },
    setDiffusion: v => { state.diffusion = v; applyDiffusion(); },
    setTension  : v => { state.tension   = v; applyTension();   },
    setMetal    : v => { state.metal     = v; applyMetal();     },
    setDynamics : v => { state.dynamics  = v; applyDynamics();  },
    setWidth    : v => { state.width     = v; applyWidth();     },
    setMix      : v => { state.mix       = v; applyMix();       },
    setBypass   : on => fx.setBypass(on),
    reset       : () => fx.reset(),
    getState    : () => ({ ...state }),
    loadPreset  : (preset) => {
      Object.assign(state, defaults, preset || {});
      applySize(); applyDiffusion(); applyTone();
      applyMetal(); applyTension(); applyDynamics();
      applyWidth(); applyMix();
    },
    dispose     : () => { unsub(); },
  };
  api.loadPreset({});
  return api;
}
