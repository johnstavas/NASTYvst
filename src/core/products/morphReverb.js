// morphReverb.js — MorphReverb: flagship late-field reverb with A/B diffuser morph.
//
// Signal flow:
//
//   in ─► [ parallel: DiffuserA ┐                                 ]
//                               ├─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
//                     DiffuserB ┘   (crossfade by `morph` AudioParam, equal-power)
//
// All DSP is in the core palette. This product file only:
//   • configures the chain (incl. the parallel A/B diffuser pair),
//   • maps the 7 macro knobs → module params,
//   • sets sane defaults for DiffuserA (tight pre-diffusion) vs DiffuserB (wide plate-ish).
//
// Owns no DSP. Owns no timers. All morph movement is sample-accurate via the
// engine-level `morph` AudioParam; the future ModMatrix can automate it directly.

import { MODULE } from '../fxEngine.js';

export function createMorphReverb(fx) {
  fx.setChain([
    { parallel: [[MODULE.DIFFUSER], [MODULE.DIFFUSER_B]] },
    MODULE.FDN_REVERB,
    MODULE.TILT_EQ,
    MODULE.WIDTH,
  ]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.35);

  // ---- Fixed per-branch diffuser character (product-defined) -----------
  // A = tight/early pre-diffusion (small AP lengths, high density).
  fx.setParam(MODULE.DIFFUSER, 'size',   0.30, { snap: true });
  fx.setParam(MODULE.DIFFUSER, 'amount', 0.75, { snap: true });
  // B = loose/plate-ish (long AP lengths, softer density).
  fx.setParam(MODULE.DIFFUSER_B, 'size',   0.90, { snap: true });
  fx.setParam(MODULE.DIFFUSER_B, 'amount', 0.55, { snap: true });

  // FDN + Tilt + Width wet-only
  fx.setParam(MODULE.FDN_REVERB, 'mix', 1.0, { snap: true });
  fx.setParam(MODULE.TILT_EQ, 'crossover', 1000, { snap: true });

  const defaults = {
    morph:  0.50,
    size:   0.55,
    decay:  0.50,   // normalized; mapped to seconds below
    tone:   0.50,
    density:0.60,
    warp:   0.30,
    width:  1.00,   // 0..2 raw
    mix:    0.35,
  };
  const state = { ...defaults };

  const fdn = (n, v, o) => fx.setParam(MODULE.FDN_REVERB, n, v, o);
  const da  = (n, v, o) => fx.setParam(MODULE.DIFFUSER,   n, v, o);
  const db  = (n, v, o) => fx.setParam(MODULE.DIFFUSER_B, n, v, o);
  const te  = (n, v, o) => fx.setParam(MODULE.TILT_EQ,    n, v, o);
  const wd  = (n, v, o) => fx.setParam(MODULE.WIDTH,      n, v, o);

  // ---- Macros -----------------------------------------------------------
  function applyMorph()  { fx.setMorph(state.morph); }           // sample-accurate
  function applySize() {
    // SIZE scales both diffuser AP lengths and FDN delay lengths together.
    // Diffuser bounds stay inside product-chosen per-branch offsets.
    const s = state.size;
    da('size', 0.20 + s * 0.35);        // 0.20..0.55 around A's tight nominal
    db('size', 0.70 + s * 0.30);        // 0.70..1.00 around B's loose nominal
    fdn('sizeScale', 0.5 + s * 1.3);    // 0.5..1.8
  }
  function applyDecay() {
    // Normalized 0..1 → 0.4s .. 9s (exp feel)
    const d = state.decay;
    const sec = 0.4 * Math.pow(9 / 0.4, d);
    fdn('decay', sec);
  }
  function applyTone() {
    // TONE 0..1 drives TiltEq tilt AND FDN HF damping corner together:
    // darker (0) → lower dampHz; brighter (1) → higher dampHz.
    te('tilt', state.tone);
    const hz = 2500 * Math.pow(16000 / 2500, state.tone);  // 2.5k..16k
    fdn('dampHz', hz);
  }
  function applyDensity() {
    // DENSITY pushes both diffuser amounts together (keeps A/B contrast).
    const x = state.density;
    da('amount', 0.30 + x * 0.65);
    db('amount', 0.15 + x * 0.65);
  }
  function applyWarp() {
    const w = state.warp;
    fdn('modDepth', w);
    fdn('modRate',  0.15 + w * 0.85);   // 0.15..1 Hz
  }
  function applyWidth() { wd('width', state.width); }
  function applyMix()   { fx.setEngineMix(state.mix); }

  const api = {
    setMorph   : v => { state.morph   = v; applyMorph();   },
    setSize    : v => { state.size    = v; applySize();    },
    setDecay   : v => { state.decay   = v; applyDecay();   },
    setTone    : v => { state.tone    = v; applyTone();    },
    setDensity : v => { state.density = v; applyDensity(); },
    setWarp    : v => { state.warp    = v; applyWarp();    },
    setWidth   : v => { state.width   = v; applyWidth();   },
    setMix     : v => { state.mix     = v; applyMix();     },
    setBypass  : on => fx.setBypass(on),
    reset      : () => fx.reset(),
    getState   : () => ({ ...state }),
    loadPreset : (preset) => {
      Object.assign(state, defaults, preset || {});
      applyMorph(); applySize(); applyDecay(); applyTone();
      applyDensity(); applyWarp(); applyWidth(); applyMix();
    },
    dispose    : () => {},
  };
  api.loadPreset({});
  return api;
}
