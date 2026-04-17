// nearFar.js — Near/Far: psychoacoustic distance reverb (pure reuse).
//
// Signal flow:
//
//   in ─► EarlyReflections ─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
//
// All DSP is generic and unchanged. Near/Far owns only a DISTANCE macro
// that re-weights the balance between direct / early / late fields and
// applies psychoacoustic tone and width changes consistent with a source
// moving away from the listener. Completes the reverb family as planned.
//
// Psychoacoustic mapping (DISTANCE 0 = near, 1 = far):
//   • ER.mix       — near: low (weak early set, source is close so direct
//                    dominates); far: full (early cluster characterizes
//                    the room more than the source)
//   • FDN.mix      — near: very low (reverb should be audible as tail
//                    not bath); far: full (late field surrounds)
//   • FDN.decay    — grows with distance (larger perceived room)
//   • FDN.sizeScale / ER.size — grow with distance
//   • TiltEq.tilt  — near: slightly bright (direct HF); far: darker
//                    (air absorption rolls off HF)
//   • FDN.dampHz   — higher at near, lower at far (per-channel damping
//                    models frequency-dependent air loss)
//   • WIDTH        — near: narrow (source is localized); far: wider
//                    (reflections envelop, image expands)
//   • engineMix    — base wet floor rises with distance
//
// SIZE, DAMPING and WIDTH_TRIM are independent offsets on top.

import { MODULE } from '../fxEngine.js';

export function createNearFar(fx) {
  fx.setChain([
    MODULE.EARLY_REFLECTIONS,
    MODULE.FDN_REVERB,
    MODULE.TILT_EQ,
    MODULE.WIDTH,
  ]);
  fx.setEngineMixMode(true);

  // Fixed config
  fx.setParam(MODULE.EARLY_REFLECTIONS, 'spread',  0.7, { snap: true });
  fx.setParam(MODULE.EARLY_REFLECTIONS, 'density', 0.7, { snap: true });
  fx.setParam(MODULE.TILT_EQ, 'crossover', 1000, { snap: true });

  const defaults = {
    distance: 0.40,    // 0 = on top of listener, 1 = far across the room
    size:     0.50,    // independent room size bias
    damping:  0.50,    // independent air-absorption bias
    width:    1.00,    // user trim applied on top of distance-derived width
    mix:      0.35,    // overall wet trim
  };
  const state = { ...defaults };

  const er  = (n, v, o) => fx.setParam(MODULE.EARLY_REFLECTIONS, n, v, o);
  const fdn = (n, v, o) => fx.setParam(MODULE.FDN_REVERB,        n, v, o);
  const te  = (n, v, o) => fx.setParam(MODULE.TILT_EQ,           n, v, o);
  const wd  = (n, v, o) => fx.setParam(MODULE.WIDTH,             n, v, o);

  // ---- Master re-compute: everything depends on DISTANCE ---------------
  function applyAll() {
    const d = state.distance;
    const s = state.size;
    const dampBias = state.damping;   // 0..1

    // Balance: near → weak ER + very weak FDN; far → full both
    const erMix  = 0.25 + d * 0.75;
    const fdnMix = 0.10 + d * 0.90;
    er ('mix', erMix);
    fdn('mix', fdnMix);

    // Room grows with distance (and SIZE as independent offset)
    const sizeEff = Math.min(1, s * 0.7 + d * 0.6);   // 0..1 composite
    er ('size',      0.5 + sizeEff * 0.9);             // 0.5..1.4
    fdn('sizeScale', 0.5 + sizeEff * 1.3);             // 0.5..1.8

    // Decay grows with distance (bigger room, longer tail)
    const decaySec = 0.6 * Math.pow(6 / 0.6, d);       // 0.6..6 s (exp)
    fdn('decay', decaySec);

    // Tone: near slightly bright (tilt 0.55 at d=0), far darker (tilt 0.30 at d=1)
    // plus DAMPING shifts it further down.
    const tilt = Math.max(0, 0.55 - d * 0.25 - dampBias * 0.10);
    te('tilt', tilt);

    // FDN per-channel damping corner: near 14 k → far 3 k, minus DAMPING pull
    const dampHz = 14000 * Math.pow(3000 / 14000, d) * (1.0 - dampBias * 0.25);
    fdn('dampHz', Math.max(1500, dampHz));

    // Width: near 0.7 (localized) → far 1.5 (envelopment); user WIDTH trims it.
    const widthEff = (0.7 + d * 0.8) * state.width;
    wd('width', Math.max(0, Math.min(2, widthEff)));

    // Overall wet floor: near ~ mix×0.5, far ~ mix×1.0 — far feels wetter
    // even at the same MIX setting.
    const wetFloor = 0.5 + d * 0.5;
    fx.setEngineMix(state.mix * wetFloor);

    // Slight modulation growth with distance — large halls breathe more.
    fdn('modDepth', 0.10 + d * 0.25);
    fdn('modRate',  0.15 + d * 0.25);
  }

  // ---- Public API -------------------------------------------------------
  const api = {
    setDistance: v => { state.distance = v; applyAll(); },
    setSize    : v => { state.size     = v; applyAll(); },
    setDamping : v => { state.damping  = v; applyAll(); },
    setWidth   : v => { state.width    = v; applyAll(); },
    setMix     : v => { state.mix      = v; applyAll(); },
    setBypass  : on => fx.setBypass(on),
    reset      : () => fx.reset(),
    getState   : () => ({ ...state }),
    loadPreset : (preset) => {
      Object.assign(state, defaults, preset || {});
      applyAll();
    },
    dispose    : () => {},
  };
  api.loadPreset({});
  return api;
}
