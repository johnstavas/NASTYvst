// drift.js — DRIFT: Micro-Movement Atmosphere
//
// Subtle chorus / detune / vibrato. Composes:
//   [DelayModule (fb=0, ~6ms tap, heavy modulation)] → [ToneModule] → engineMix
//
// Owns no DSP. Single-tap modulated delay with zero feedback IS a chorus
// engine; this product just configures DelayModule as such.

import { MODULE } from '../fxEngine.js';

export function createDrift(fx) {
  fx.setChain([MODULE.DELAY, MODULE.TONE]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.5);

  // Static config: zero feedback, internal mix wet-only, fixed short tap
  fx.setParam(MODULE.DELAY, 'mix',        1.0,  { snap: true });
  fx.setParam(MODULE.DELAY, 'feedback',   0.0,  { snap: true });
  fx.setParam(MODULE.DELAY, 'drive',      0.0,  { snap: true });
  fx.setParam(MODULE.DELAY, 'damp',       0.0,  { snap: true });   // fb-path; irrelevant at fb=0
  fx.setParam(MODULE.DELAY, 'lowCut',     20,   { snap: true });
  fx.setParam(MODULE.DELAY, 'stereoMode', 0,    { snap: true });

  const defaults = {
    motion: 0.30,
    speed:  0.30,
    random: 0.20,
    stereo: 0.40,
    tone:   0.60,
    depth:  0.30,
    mix:    0.50,
  };
  const state = { ...defaults };

  const dly  = (n, v, opts) => fx.setParam(MODULE.DELAY, n, v, opts);
  const tone = (n, v, opts) => fx.setParam(MODULE.TONE,  n, v, opts);

  function applyTimes() {
    // Base tap ~6 ms; STEREO offsets R by up to ±4 ms for natural decorrelation.
    const baseSec  = 0.006;
    const offsetSec = state.stereo * 0.004;
    dly('timeL', baseSec);
    dly('timeR', Math.max(0.002, baseSec + offsetSec));
    dly('stereoMode', state.stereo > 0.7 ? 2 : 0);    // cross-feed at high stereo (still fb=0 so harmless)
  }
  function applyMod() {
    // wow = slow chorus motion; flutter = "random" jitter beat
    const m  = state.motion, d = state.depth, sp = state.speed, r = state.random;
    dly('wowDepth',     Math.min(1, m * d * 1.4));     // motion × depth
    dly('wowRate',      0.2 + sp * 2.5);               // 0.2..2.7 Hz
    dly('flutterDepth', r * 0.45);
    dly('flutterRate',  3 + sp * 9);                   // 3..12 Hz
  }
  function applyTone() {
    // 1.8k..16k LP, tilted toward open at default
    tone('lpHz',   1800 + state.tone * 14200);
    tone('hpHz',   20);
    tone('stages', 1);
  }
  function applyMix() { fx.setEngineMix(state.mix); }

  const api = {
    setMotion : v => { state.motion = v; applyMod(); },
    setSpeed  : v => { state.speed  = v; applyMod(); },
    setRandom : v => { state.random = v; applyMod(); },
    setStereo : v => { state.stereo = v; applyTimes(); },
    setTone   : v => { state.tone   = v; applyTone(); },
    setDepth  : v => { state.depth  = v; applyMod(); },
    setMix    : v => { state.mix    = v; applyMix(); },
    setBypass : on => fx.setBypass(on),
    reset     : () => fx.reset(),
    getState  : () => ({ ...state }),
    loadPreset: (preset) => {
      Object.assign(state, defaults, preset || {});
      applyTimes(); applyMod(); applyTone(); applyMix();
    },
  };
  api.loadPreset({});
  return api;
}
