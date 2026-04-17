// smear.js — SMEAR: dream/lo-fi unstable reverb.
//
// Composes:
//   [CombBank] → [TapeCharacter] → [TiltEq] → engineMix
//
// Owns no DSP. The only "active" code in the product layer is a control-
// rate random-walk modulator (~30 Hz) that writes per-comb length offsets
// to CombBank.mod0..mod3 — this is control plane, not DSP. The driving
// LFO will be replaced by a generic ModSource when the ModMatrix lands.

import { MODULE } from '../fxEngine.js';

export function createSmear(fx) {
  fx.setChain([MODULE.COMB_BANK, MODULE.TAPE_CHARACTER, MODULE.TILT_EQ]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.30);

  // CombBank fully wet (engine handles dry/wet)
  fx.setParam(MODULE.COMB_BANK, 'mix', 1.0, { snap: true });
  // TapeCharacter defaults sane for lo-fi voice; keep hum/xfmr modest
  fx.setParam(MODULE.TAPE_CHARACTER, 'hum',       0.0, { snap: true });
  fx.setParam(MODULE.TAPE_CHARACTER, 'xfmrDrive', 0.10, { snap: true });
  fx.setParam(MODULE.TAPE_CHARACTER, 'xfmrColor', 0.20, { snap: true });

  const defaults = {
    smear: 0.40,
    drift: 0.20,
    degrade: 0.15,
    size: 0.50,
    tone: 0.45,
    mix: 0.30,
  };
  const state = { ...defaults };

  const cb = (n, v, opts) => fx.setParam(MODULE.COMB_BANK,      n, v, opts);
  const tc = (n, v, opts) => fx.setParam(MODULE.TAPE_CHARACTER, n, v, opts);
  const te = (n, v, opts) => fx.setParam(MODULE.TILT_EQ,        n, v, opts);

  // ---- Macros (control plane only) ------------------------------------
  function applySmear() {
    cb('fb',        0.50 + state.smear * 0.42);   // 0.50..0.92
    cb('crossfeed', state.smear * 0.45);
  }
  function applyDrift() {
    // DRIFT controls (a) random-walk amplitude on comb lengths and
    // (b) TapeCharacter's gain wobble + slight extra damping.
    cb('damp',                Math.min(0.85, 0.30 + state.drift * 0.05));
    tc('stereoDrift',         state.drift * 0.6);
    // The actual length-modulation values are written by the timer below.
  }
  function applyDegrade() {
    const d = state.degrade;
    tc('age',        d * 0.85);
    tc('hiss',       d * 0.35);
    tc('compAmount', 0.20 + d * 0.50);
  }
  function applySize() { cb('sizeScale', 0.5 + state.size * 1.3); }
  function applyTone() { te('tilt', state.tone); }
  function applyMix()  { fx.setEngineMix(state.mix); }

  // ---- Control-rate random-walk modulator -----------------------------
  // 30 Hz tick → smooth per-comb mod0..3 in ±1 (= ±64 samples in CombBank).
  // ParamSmoother inside the worklet handles the per-sample interpolation
  // so this control-rate update produces audibly smooth pitch drift.
  const N = 4;
  const target = [0, 0, 0, 0];
  const value  = [0, 0, 0, 0];
  let timer = null;
  const TICK_MS  = 33;
  const STEP     = 0.06;     // walk step per tick
  const DECAY    = 0.01;     // pull back to 0 to avoid runaway

  function step() {
    const amt = state.drift;
    if (amt <= 0.001) {
      for (let k = 0; k < N; k++) {
        if (Math.abs(value[k]) > 1e-4) {
          value[k] *= 0.85;
          fx.setParam(MODULE.COMB_BANK, 'mod' + k, value[k]);
        }
      }
      return;
    }
    for (let k = 0; k < N; k++) {
      target[k] += (Math.random() * 2 - 1) * STEP;
      target[k] -= target[k] * DECAY;
      target[k]  = Math.max(-1, Math.min(1, target[k]));
      // Smooth toward target
      value[k]  += (target[k] * amt - value[k]) * 0.35;
      fx.setParam(MODULE.COMB_BANK, 'mod' + k, value[k]);
    }
  }
  function startMod() {
    if (timer) return;
    if (typeof setInterval === 'function') timer = setInterval(step, TICK_MS);
  }
  function stopMod() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  // ---- Public API -----------------------------------------------------
  const api = {
    setSmear  : v => { state.smear = v;   applySmear(); },
    setDrift  : v => { state.drift = v;   applyDrift(); },
    setDegrade: v => { state.degrade = v; applyDegrade(); },
    setSize   : v => { state.size = v;    applySize(); },
    setTone   : v => { state.tone = v;    applyTone(); },
    setMix    : v => { state.mix = v;     applyMix(); },
    setBypass : on => fx.setBypass(on),
    reset     : () => fx.reset(),
    getState  : () => ({ ...state }),
    loadPreset: (preset) => {
      Object.assign(state, defaults, preset || {});
      applySmear(); applyDrift(); applyDegrade();
      applySize(); applyTone(); applyMix();
    },
    dispose: () => { stopMod(); },
  };
  api.loadPreset({});
  startMod();
  return api;
}
