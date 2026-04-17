// fxEngine.js — Main-thread side of the unified FX core.
//
// Responsibilities:
//   • Register the AudioWorklet module (one-shot per AudioContext)
//   • Construct the AudioWorkletNode that hosts the FxProcessor
//   • Expose ParamStore: typed, normalized→DSP-mapped param updates with
//     skew curves and "snap" support for preset loads
//   • Expose MIDI mapping helpers (CC/Vel/PitchBend/AT) — minimal stub now
//
// Usage:
//   import { createFxEngine } from './core/fxEngine';
//   const fx = await createFxEngine(ctx);
//   sourceNode.connect(fx.input); fx.output.connect(ctx.destination);
//   fx.setParam(0, 'feedback', 0.7);
//   fx.setParam(0, 'timeL', 0.25);

import { WORKLET_SOURCE } from './dspWorklet.js';

const _registered = new WeakSet();

async function ensureWorklet(ctx) {
  if (_registered.has(ctx)) return;
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  _registered.add(ctx);
}

// ---------- ParamStore --------------------------------------------------
// Holds the canonical param definitions and translates 0..1 normalized
// inputs into DSP-domain values (Hz, sec, dB, ratio) with skew curves.

const SKEWS = {
  linear: (n) => n,
  exp:    (n) => n * n,
  log:    (n) => Math.sqrt(Math.max(0, n)),
};

function defineParam({ id, module = 0, min, max, default: def, skew = 'linear', unit = '' }) {
  const skewFn = SKEWS[skew] || SKEWS.linear;
  return {
    id, module, min, max, default: def, skew, unit,
    fromNorm(n) {
      const t = skewFn(Math.min(1, Math.max(0, n)));
      return min + (max - min) * t;
    },
  };
}

// Stable module indices in the FxProcessor palette.
export const MODULE = {
  DELAY: 0, DIFFUSER: 1, TONE: 2, TAPE_MULTITAP: 3, TAPE_CHARACTER: 4,
  COMB_BANK: 5, TILT_EQ: 6,
  FDN_REVERB: 7, DIFFUSER_B: 8, WIDTH: 9,
  EARLY_REFLECTIONS: 10,
  ENVELOPE_FOLLOWER: 11,
  COMPRESSOR: 12,
  LIMITER: 13,
  SATURATOR: 14,
  EQ: 15,
};

export const EQ_PARAMS = {
  hpOn   : defineParam({ id: 'hpOn',   min: 0,    max: 1,     default: 0 }),
  hpFreq : defineParam({ id: 'hpFreq', min: 20,   max: 1000,  default: 80,    skew: 'exp', unit: 'Hz' }),
  hpQ    : defineParam({ id: 'hpQ',    min: 0.3,  max: 2,     default: 0.707 }),
  lsFreq : defineParam({ id: 'lsFreq', min: 30,   max: 400,   default: 120,   skew: 'exp', unit: 'Hz' }),
  lsGain : defineParam({ id: 'lsGain', min: -18,  max: 18,    default: 0,     unit: 'dB' }),
  lsQ    : defineParam({ id: 'lsQ',    min: 0.3,  max: 2,     default: 0.707 }),
  pkFreq : defineParam({ id: 'pkFreq', min: 100,  max: 10000, default: 1000,  skew: 'exp', unit: 'Hz' }),
  pkGain : defineParam({ id: 'pkGain', min: -18,  max: 18,    default: 0,     unit: 'dB' }),
  pkQ    : defineParam({ id: 'pkQ',    min: 0.3,  max: 10,    default: 1.0 }),
  hsFreq : defineParam({ id: 'hsFreq', min: 1000, max: 16000, default: 6000,  skew: 'exp', unit: 'Hz' }),
  hsGain : defineParam({ id: 'hsGain', min: -18,  max: 18,    default: 0,     unit: 'dB' }),
  hsQ    : defineParam({ id: 'hsQ',    min: 0.3,  max: 2,     default: 0.707 }),
  lpFreq : defineParam({ id: 'lpFreq', min: 2000, max: 20000, default: 18000, skew: 'exp', unit: 'Hz' }),
  lpQ    : defineParam({ id: 'lpQ',    min: 0.3,  max: 2,     default: 0.707 }),
  lpOn   : defineParam({ id: 'lpOn',   min: 0,    max: 1,     default: 0 }),
};

export const SATURATOR_PARAMS = {
  drive    : defineParam({ id: 'drive',    min: 0,   max: 48,  default: 12, unit: 'dB' }),
  curve    : defineParam({ id: 'curve',    min: 0,   max: 2,   default: 0 }),
  asym     : defineParam({ id: 'asym',     min: 0,   max: 1,   default: 0.35 }),
  outputDb : defineParam({ id: 'outputDb', min: -24, max: 12,  default: 0,  unit: 'dB' }),
  aa       : defineParam({ id: 'aa',       min: 0,   max: 1,   default: 1 }),
  mix      : defineParam({ id: 'mix',      min: 0,   max: 1,   default: 1.0 }),
};

export const LIMITER_PARAMS = {
  ceiling    : defineParam({ id: 'ceiling',     min: -24, max: 0,    default: -0.3, unit: 'dB' }),
  releaseMs  : defineParam({ id: 'releaseMs',   min: 1,   max: 1000, default: 80,   skew: 'exp', unit: 'ms' }),
  lookaheadMs: defineParam({ id: 'lookaheadMs', min: 0,   max: 5,    default: 2,    unit: 'ms' }),
  mix        : defineParam({ id: 'mix',         min: 0,   max: 1,    default: 1.0 }),
};

export const COMPRESSOR_PARAMS = {
  threshold : defineParam({ id: 'threshold',  min: -60, max: 6,  default: -18, unit: 'dB' }),
  ratio     : defineParam({ id: 'ratio',      min: 1,   max: 30, default: 4 }),
  knee      : defineParam({ id: 'knee',       min: 0,   max: 24, default: 6,  unit: 'dB' }),
  attackMs  : defineParam({ id: 'attackMs',   min: 0.1, max: 200, default: 10, skew: 'exp', unit: 'ms' }),
  releaseMs : defineParam({ id: 'releaseMs',  min: 5,   max: 2000, default: 120, skew: 'exp', unit: 'ms' }),
  makeupDb  : defineParam({ id: 'makeupDb',   min: -12, max: 24, default: 0,  unit: 'dB' }),
  detectMode: defineParam({ id: 'detectMode', min: 0,   max: 2,  default: 0 }),
  stereoLink: defineParam({ id: 'stereoLink', min: 0,   max: 1,  default: 1 }),
  mix       : defineParam({ id: 'mix',        min: 0,   max: 1,  default: 1.0 }),
};

export const ENVELOPE_FOLLOWER_PARAMS = {
  attackMs : defineParam({ id: 'attackMs',  min: 0.5, max: 200, default: 5,   skew: 'exp', unit: 'ms' }),
  releaseMs: defineParam({ id: 'releaseMs', min: 5,   max: 2000, default: 120, skew: 'exp', unit: 'ms' }),
  sense    : defineParam({ id: 'sense',     min: 0,   max: 4,   default: 1.0 }),
};

export const EARLY_REFLECTIONS_PARAMS = {
  size    : defineParam({ id: 'size',    min: 0.3, max: 2.0, default: 1.0 }),
  spread  : defineParam({ id: 'spread',  min: 0, max: 1,   default: 0.7 }),
  density : defineParam({ id: 'density', min: 0, max: 1,   default: 0.8 }),
  mix     : defineParam({ id: 'mix',     min: 0, max: 1,   default: 1.0 }),
};

export const FDN_REVERB_PARAMS = {
  decay     : defineParam({ id: 'decay',     min: 0.2, max: 12.0, default: 2.5, skew: 'exp', unit: 's' }),
  sizeScale : defineParam({ id: 'sizeScale', min: 0.3, max: 2.0,  default: 1.0 }),
  dampHz    : defineParam({ id: 'dampHz',    min: 1500, max: 18000, default: 6000, skew: 'exp', unit: 'Hz' }),
  modDepth  : defineParam({ id: 'modDepth',  min: 0, max: 1,   default: 0.3 }),
  modRate   : defineParam({ id: 'modRate',   min: 0.05, max: 3, default: 0.5, skew: 'exp', unit: 'Hz' }),
  inputGain : defineParam({ id: 'inputGain', min: 0, max: 1,   default: 0.5 }),
  mix       : defineParam({ id: 'mix',       min: 0, max: 1,   default: 1.0 }),
};

export const WIDTH_PARAMS = {
  width: defineParam({ id: 'width', min: 0, max: 2, default: 1.0 }),
};

export const COMB_BANK_PARAMS = {
  fb        : defineParam({ id: 'fb',        min: 0, max: 0.95, default: 0.7 }),
  crossfeed : defineParam({ id: 'crossfeed', min: 0, max: 0.5,  default: 0.0 }),
  damp      : defineParam({ id: 'damp',      min: 0, max: 0.95, default: 0.3 }),
  sizeScale : defineParam({ id: 'sizeScale', min: 0.3, max: 2.0, default: 1.0 }),
  mod0      : defineParam({ id: 'mod0',      min: -1, max: 1, default: 0 }),
  mod1      : defineParam({ id: 'mod1',      min: -1, max: 1, default: 0 }),
  mod2      : defineParam({ id: 'mod2',      min: -1, max: 1, default: 0 }),
  mod3      : defineParam({ id: 'mod3',      min: -1, max: 1, default: 0 }),
  mix       : defineParam({ id: 'mix',       min: 0, max: 1, default: 1.0 }),
};

export const TILT_EQ_PARAMS = {
  tilt      : defineParam({ id: 'tilt',      min: 0, max: 1, default: 0.5 }),
  crossover : defineParam({ id: 'crossover', min: 200, max: 4000, default: 1000, skew: 'exp', unit: 'Hz' }),
};

export const TAPE_CHARACTER_PARAMS = {
  hiss       : defineParam({ id: 'hiss',        min: 0, max: 1,  default: 0.0 }),
  hum        : defineParam({ id: 'hum',         min: 0, max: 1,  default: 0.0 }),
  humHz      : defineParam({ id: 'humHz',       min: 50, max: 60, default: 60 }),
  xfmrDrive  : defineParam({ id: 'xfmrDrive',   min: 0, max: 1,  default: 0.25 }),
  xfmrColor  : defineParam({ id: 'xfmrColor',   min: 0, max: 1,  default: 0.30 }),
  compAmount : defineParam({ id: 'compAmount',  min: 0, max: 1,  default: 0.30 }),
  age        : defineParam({ id: 'age',         min: 0, max: 1,  default: 0.20 }),
  stereoDrift: defineParam({ id: 'stereoDrift', min: 0, max: 1,  default: 0.0 }),
};

export const TAPE_MULTITAP_PARAMS = {
  time1   : defineParam({ id: 'time1',    min: 0.020, max: 1.2, default: 0.167, skew: 'exp', unit: 's' }),
  time2   : defineParam({ id: 'time2',    min: 0.020, max: 1.2, default: 0.334, skew: 'exp', unit: 's' }),
  time3   : defineParam({ id: 'time3',    min: 0.020, max: 1.2, default: 0.501, skew: 'exp', unit: 's' }),
  vol1    : defineParam({ id: 'vol1',     min: 0, max: 1, default: 0.75 }),
  vol2    : defineParam({ id: 'vol2',     min: 0, max: 1, default: 0.75 }),
  vol3    : defineParam({ id: 'vol3',     min: 0, max: 1, default: 0.75 }),
  on1     : defineParam({ id: 'on1',      min: 0, max: 1, default: 1 }),
  on2     : defineParam({ id: 'on2',      min: 0, max: 1, default: 0 }),
  on3     : defineParam({ id: 'on3',      min: 0, max: 1, default: 0 }),
  feedback: defineParam({ id: 'feedback', min: 0, max: 0.96, default: 0.40 }),
  damp    : defineParam({ id: 'damp',     min: 0, max: 1, default: 0.5 }),
  lowCut  : defineParam({ id: 'lowCut',   min: 20, max: 600, default: 80, skew: 'exp', unit: 'Hz' }),
  drive   : defineParam({ id: 'drive',    min: 0, max: 1, default: 0.30 }),
  wowDepth: defineParam({ id: 'wowDepth', min: 0, max: 1, default: 0.35 }),
  wowRate : defineParam({ id: 'wowRate',  min: 0.05, max: 4, default: 0.7, skew: 'exp', unit: 'Hz' }),
  fltDepth: defineParam({ id: 'fltDepth', min: 0, max: 1, default: 0.0 }),
  fltRate : defineParam({ id: 'fltRate',  min: 1, max: 18, default: 7, skew: 'exp', unit: 'Hz' }),
  spread  : defineParam({ id: 'spread',   min: 0, max: 1, default: 0.5 }),
  mix     : defineParam({ id: 'mix',      min: 0, max: 1, default: 1.0 }),
};

export const DIFFUSER_PARAMS = {
  amount: defineParam({ id: 'amount', min: 0, max: 1, default: 0 }),
  size:   defineParam({ id: 'size',   min: 0, max: 1, default: 0.5 }),
};

export const TONE_PARAMS = {
  lpHz:   defineParam({ id: 'lpHz',   min: 1800, max: 18000, default: 16000, skew: 'exp', unit: 'Hz' }),
  hpHz:   defineParam({ id: 'hpHz',   min: 20,   max: 800,   default: 20,    skew: 'exp', unit: 'Hz' }),
  stages: defineParam({ id: 'stages', min: 1,    max: 2,     default: 1 }),
};

// Default param map for the Step-5 Delay module.
export const DELAY_PARAMS = {
  timeL       : defineParam({ id: 'timeL',        min: 0.005, max: 3.0,  default: 0.300, skew: 'exp',    unit: 's' }),
  timeR       : defineParam({ id: 'timeR',        min: 0.005, max: 3.0,  default: 0.300, skew: 'exp',    unit: 's' }),
  feedback    : defineParam({ id: 'feedback',     min: 0,     max: 0.97, default: 0.45 }),
  stereoMode  : defineParam({ id: 'stereoMode',   min: 0,     max: 2,    default: 0 }),  // 0 stereo / 1 ping / 2 cross
  wowDepth    : defineParam({ id: 'wowDepth',     min: 0,     max: 1,    default: 0.0 }),
  wowRate     : defineParam({ id: 'wowRate',      min: 0.05,  max: 4,    default: 0.6,   skew: 'exp', unit: 'Hz' }),
  flutterDepth: defineParam({ id: 'flutterDepth', min: 0,     max: 1,    default: 0.0 }),
  flutterRate : defineParam({ id: 'flutterRate',  min: 1,     max: 18,   default: 7,     skew: 'exp', unit: 'Hz' }),
  damp        : defineParam({ id: 'damp',         min: 0,     max: 1,    default: 0.5 }),
  lowCut      : defineParam({ id: 'lowCut',       min: 20,    max: 600,  default: 80,    skew: 'exp', unit: 'Hz' }),
  drive       : defineParam({ id: 'drive',        min: 0,     max: 1,    default: 0.0 }),
  mix         : defineParam({ id: 'mix',          min: 0,     max: 1,    default: 0.35 }),
};

// ---------- Engine ------------------------------------------------------
export async function createFxEngine(ctx) {
  await ensureWorklet(ctx);

  const node = new AudioWorkletNode(ctx, 'shags-fx-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const input  = ctx.createGain();
  const output = ctx.createGain();
  input.connect(node);
  node.connect(output);

  // Envelope-level subscribers — fed by EnvelopeFollowerModule's port posts.
  const envSubs = new Set();
  function onEnvelopeLevel(cb) { envSubs.add(cb); return () => envSubs.delete(cb); }
  node.port.onmessage = (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'envLevel') { for (const cb of envSubs) cb(m.value); }
  };

  // Snapshot of last sent values per (module,name)
  const last = new Map();
  const key  = (m, n) => `${m}:${n}`;

  function setParam(moduleIdx, name, dspValue, opts = {}) {
    // Control-layer policy: reject non-finite values at the boundary.
    // Symmetric with ParamSmoother.setTarget's worklet-side guard — this
    // keeps bad values out of the port queue *and* the dedup cache.
    if (!Number.isFinite(dspValue)) return;
    const k = key(moduleIdx, name);
    if (!opts.force && last.get(k) === dspValue) return;
    last.set(k, dspValue);
    node.port.postMessage({
      type: 'param',
      module: moduleIdx,
      name,
      value: dspValue,
      snap: !!opts.snap,
    });
  }

  function setParamNorm(moduleIdx, paramDef, normValue, opts) {
    setParam(moduleIdx, paramDef.id, paramDef.fromNorm(normValue), opts);
  }

  function loadPreset(moduleIdx, paramMap, presetNorm) {
    for (const id in paramMap) {
      const def = paramMap[id];
      const v   = presetNorm[id];
      if (v == null) continue;
      setParam(moduleIdx, id, def.fromNorm(v), { snap: true });
    }
  }

  function reset() {
    node.port.postMessage({ type: 'reset' });
    last.clear();
  }

  // Bypass via AudioParam (sample-accurate, host-automatable)
  const bypass = node.parameters.get('bypass');
  function setBypass(on) { bypass.setValueAtTime(on ? 1 : 0, ctx.currentTime); }

  // Engine-level dry/wet (used when modules run wet-only inside a chain)
  const engineMix = node.parameters.get('engineMix');
  function setEngineMix(v) { engineMix.setValueAtTime(Math.min(1, Math.max(0, v)), ctx.currentTime); }
  function setEngineMixMode(on) { node.port.postMessage({ type: 'engineMixMode', on: !!on }); }
  // Chain entries may be integers (serial) OR { parallel: [[idxs], [idxs]] } for
  // two-branch crossfade driven by the `morph` AudioParam.
  function setChain(indices) {
    const safe = indices.map(e => {
      if (typeof e === 'number') return e;
      if (e && Array.isArray(e.parallel)) return { parallel: e.parallel.map(a => a.slice()) };
      return e;
    });
    node.port.postMessage({ type: 'setChain', indices: safe });
  }

  // Morph AudioParam: 0 → branch A only, 1 → branch B only, 0.5 → equal-power mid.
  const morph = node.parameters.get('morph');
  function setMorph(v) { morph.setValueAtTime(Math.min(1, Math.max(0, v)), ctx.currentTime); }

  // ---- Minimal MIDI hook: caller pumps incoming MIDI here and we route
  //      to params by simple CC->paramId map. Mod-matrix is later Steps.
  const ccMap = new Map(); // cc -> {moduleIdx, paramDef}
  function mapCC(cc, moduleIdx, paramDef) { ccMap.set(cc, { moduleIdx, paramDef }); }
  function handleMidiMessage(data) {
    if (!data || data.length < 3) return;
    const status = data[0] & 0xF0;
    if (status === 0xB0) {
      const dst = ccMap.get(data[1]);
      if (dst) setParamNorm(dst.moduleIdx, dst.paramDef, data[2] / 127);
    }
  }

  return {
    ctx, node, input, output,
    setParam, setParamNorm, loadPreset, reset, setBypass,
    setEngineMix, setEngineMixMode, setChain, setMorph,
    onEnvelopeLevel,
    mapCC, handleMidiMessage,
    params: {
      [MODULE.DELAY]:         DELAY_PARAMS,
      [MODULE.DIFFUSER]:      DIFFUSER_PARAMS,
      [MODULE.TONE]:          TONE_PARAMS,
      [MODULE.TAPE_MULTITAP]:  TAPE_MULTITAP_PARAMS,
      [MODULE.TAPE_CHARACTER]: TAPE_CHARACTER_PARAMS,
      [MODULE.COMB_BANK]:      COMB_BANK_PARAMS,
      [MODULE.TILT_EQ]:        TILT_EQ_PARAMS,
      [MODULE.FDN_REVERB]:     FDN_REVERB_PARAMS,
      [MODULE.DIFFUSER_B]:     DIFFUSER_PARAMS,
      [MODULE.WIDTH]:          WIDTH_PARAMS,
      [MODULE.EARLY_REFLECTIONS]: EARLY_REFLECTIONS_PARAMS,
      [MODULE.ENVELOPE_FOLLOWER]: ENVELOPE_FOLLOWER_PARAMS,
      [MODULE.COMPRESSOR]:        COMPRESSOR_PARAMS,
      [MODULE.LIMITER]:           LIMITER_PARAMS,
      [MODULE.SATURATOR]:         SATURATOR_PARAMS,
      [MODULE.EQ]:                EQ_PARAMS,
    },
    MODULE,
  };
}
