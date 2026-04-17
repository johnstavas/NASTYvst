// playbox.js — PLAYBOX: macro-driven multi-FX box.
//
// Five chains, all routed through the unified FxProcessor by reconfiguring
// the chain[] at runtime when the user changes CHAIN. Macros INTENSITY /
// SPEED / COLOR have chain-specific meaning; this is what proves the
// architecture supports product-level macro reinterpretation without core
// growth.
//
// CHAIN map (v1):
//   0 FLANGE — DelayModule (~3 ms, fb modulated, narrow LFO)
//   1 ECHO   — DelayModule (mid time, fb + damp)
//   2 FILTER — DEFERRED (needs ResonantFilterModule; v1 falls through to ECHO)
//   3 WIDEN  — DelayModule (~8 ms, R-tap offset, fb=0, stereo cross)
//   4 CRUSH  — DEFERRED (needs CrushModule; v1 falls through to BYPASS)
//
// All live chains compose: [DelayModule → ToneModule] → engineMix.

import { MODULE } from '../fxEngine.js';

export const PLAYBOX_CHAIN = { FLANGE: 0, ECHO: 1, FILTER: 2, WIDEN: 3, CRUSH: 4 };

export function createPlaybox(fx) {
  fx.setChain([MODULE.DELAY, MODULE.TONE]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.5);
  fx.setParam(MODULE.DELAY, 'mix', 1.0, { snap: true });

  const defaults = {
    chain:     PLAYBOX_CHAIN.FLANGE,
    intensity: 0.4,
    speed:     0.3,
    color:     0.5,
    mix:       0.5,
  };
  const state = { ...defaults };

  const dly  = (n, v, opts) => fx.setParam(MODULE.DELAY, n, v, opts);
  const tone = (n, v, opts) => fx.setParam(MODULE.TONE,  n, v, opts);

  // -------- Per-chain configurators ----------------------------------
  function configureFlange() {
    fx.setBypass(false);
    fx.setChain([MODULE.DELAY, MODULE.TONE]);
    const I = state.intensity, S = state.speed, C = state.color;
    dly('timeL',        0.002 + I * 0.004);   // 2..6 ms
    dly('timeR',        0.002 + I * 0.004);
    dly('feedback',     I * 0.85);
    dly('wowDepth',     0.5 + I * 0.3);
    dly('wowRate',      0.1 + S * 4.0);       // 0.1..4 Hz
    dly('flutterDepth', 0);
    dly('damp',         0.3 + (1 - C) * 0.5); // COLOR brightens fb
    dly('lowCut',       60);
    dly('drive',        0);
    dly('stereoMode',   2);                   // cross-feed = jet flange
    tone('lpHz',        1800 + C * 14200);
    tone('hpHz',        20);
    tone('stages',      1);
  }
  function configureEcho() {
    fx.setBypass(false);
    fx.setChain([MODULE.DELAY, MODULE.TONE]);
    const I = state.intensity, S = state.speed, C = state.color;
    const sec = 0.060 + S * 0.500;            // 60..560 ms
    dly('timeL',        sec);
    dly('timeR',        sec * 1.014);         // tiny detune for stereo life
    dly('feedback',     I * 0.85);
    dly('wowDepth',     0);
    dly('flutterDepth', 0);
    dly('damp',         0.3 + (1 - C) * 0.55);
    dly('lowCut',       80);
    dly('drive',        I * 0.20);
    dly('stereoMode',   1);                   // ping-pong feel
    tone('lpHz',        1800 + C * 14200);
    tone('hpHz',        20);
    tone('stages',      1);
  }
  function configureWiden() {
    fx.setBypass(false);
    fx.setChain([MODULE.DELAY, MODULE.TONE]);
    const I = state.intensity, S = state.speed, C = state.color;
    const off = 0.003 + I * 0.014;            // 3..17 ms R-tap offset
    dly('timeL',        0.005);
    dly('timeR',        0.005 + off);
    dly('feedback',     0);
    dly('wowDepth',     I * 0.15);            // touch of haas chorus
    dly('wowRate',      0.2 + S * 1.5);
    dly('flutterDepth', 0);
    dly('damp',         0);
    dly('lowCut',       20);
    dly('drive',        0);
    dly('stereoMode',   2);
    tone('lpHz',        1800 + C * 14200);
    tone('hpHz',        20);
    tone('stages',      1);
  }
  function configureFilterDeferred() {
    // Routes to ECHO until ResonantFilterModule lands.
    configureEcho();
  }
  function configureCrushDeferred() {
    // Bypasses until CrushModule lands.
    fx.setBypass(true);
  }

  function applyChain() {
    switch (state.chain) {
      case PLAYBOX_CHAIN.FLANGE: return configureFlange();
      case PLAYBOX_CHAIN.ECHO:   return configureEcho();
      case PLAYBOX_CHAIN.FILTER: return configureFilterDeferred();
      case PLAYBOX_CHAIN.WIDEN:  return configureWiden();
      case PLAYBOX_CHAIN.CRUSH:  return configureCrushDeferred();
      default: return configureFlange();
    }
  }
  function applyMix() { fx.setEngineMix(state.mix); }

  const api = {
    setChain    : v => { state.chain = v|0; applyChain(); fx.reset(); },
    setIntensity: v => { state.intensity = v; applyChain(); },
    setSpeed    : v => { state.speed = v;     applyChain(); },
    setColor    : v => { state.color = v;     applyChain(); },
    setMix      : v => { state.mix = v;       applyMix(); },
    setBypass   : on => fx.setBypass(on),
    reset       : () => fx.reset(),
    getState    : () => ({ ...state }),
    loadPreset  : (preset) => {
      Object.assign(state, defaults, preset || {});
      applyChain(); applyMix();
    },
  };
  api.loadPreset({});
  return api;
}
