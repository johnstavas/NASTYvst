// echoform.js — ECHOFORM product layer on top of the unified core.
//
// Echoform is a thin product: it owns no DSP. It composes
// [DelayModule → DiffuserModule → ToneModule] inside the FxProcessor and
// translates 9 user-facing controls (0..1) into parameter spreads across
// those three modules. Engine-level dry/wet handles MIX so the chain
// modules can each run wet-only.
//
// Migration target: replaces src/echoformEngine.js once UI is swapped.
//
// Usage:
//   import { createFxEngine } from '../fxEngine.js';
//   import { createEchoform } from './echoform.js';
//   const fx = await createFxEngine(ctx);
//   const echo = createEchoform(fx);
//   sourceNode.connect(fx.input); fx.output.connect(ctx.destination);
//   echo.setTime(0.4); echo.setFeedback(0.5); echo.setBlur(0.6); ...

import { MODULE } from '../fxEngine.js';

export function createEchoform(fx) {
  // 1. Configure the chain & engine-level mix
  fx.setChain([MODULE.DELAY, MODULE.DIFFUSER, MODULE.TONE]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.35);

  // 2. Snap module-internal mixes to fully wet (engine handles dry/wet)
  fx.setParam(MODULE.DELAY, 'mix', 1.0, { snap: true });

  // 3. Sensible defaults consistent with legacy Echoform
  const defaults = {
    time: 0.305,         // ~400 ms after curve
    feedback: 0.45,
    degrade: 0.30,
    motion: 0.0,
    blur: 0.0,
    tone: 0.85,          // bright by default
    mix: 0.35,
    width: 1.0,
    smooth: 0.0,
  };

  // -------- Helpers ----------------------------------------------------
  const setDelay    = (n, v, opts) => fx.setParam(MODULE.DELAY,    n, v, opts);
  const setDiffuser = (n, v, opts) => fx.setParam(MODULE.DIFFUSER, n, v, opts);
  const setTone     = (n, v, opts) => fx.setParam(MODULE.TONE,     n, v, opts);

  // Echoform's 9 user controls — each a 0..1 normalized macro that fans
  // out to one or more underlying module params. Curves chosen to match
  // the legacy plugin's musical feel (validated in A/B test plan).

  const state = { ...defaults };

  function applyTime() {
    // Legacy: 50ms..1200ms
    const sec = 0.050 + state.time * 1.150;
    // Legacy WIDTH offsets the R read tap by (width/2)*18ms behind L.
    // We replicate via timeR = timeL - offset, clamped to >=5ms.
    const offsetSec = (Math.min(2, Math.max(0, state.width)) * 0.5) * 0.018;
    const tR = Math.max(0.005, sec - offsetSec);
    setDelay('timeL', sec);
    setDelay('timeR', tR);
  }

  function applyFeedback() {
    // Cap at 0.92 like legacy
    setDelay('feedback', state.feedback * 0.92);
  }

  function applyDegrade() {
    const d = state.degrade;
    // Tuned A/B vs legacy:
    //   damp 0.4..0.95 → block-curve ≈ 11.3 kHz @ d=0 down to 2 kHz @ d=1 (legacy: 12k→2k)
    //   lowCut 80..260 Hz (legacy HP rises 80→380; we cap lower to keep body)
    //   drive 0..0.40 → matches legacy tanh-output unity-loudness landing
    setDelay('damp',   0.40 + d * 0.55);
    setDelay('lowCut', 80   + d * 180);
    setDelay('drive',  d    * 0.40);
  }

  function applyMotion() {
    const m = state.motion;
    // Legacy peak depth was 3 ms total (wow only, no flutter).
    // wowDepth=0.5 → 0.5*6ms = 3ms. Flutter disabled to preserve character.
    setDelay('wowDepth',     m * 0.50);
    setDelay('wowRate',      0.5 + m * 3.0);   // 0.5–3.5 Hz like legacy
    setDelay('flutterDepth', 0);
    setDelay('flutterRate',  6);                // unused
  }

  function applyBlur() {
    const b = state.blur;
    // 4-stage diffuser is intrinsically denser than legacy single allpass.
    // Taper amount and shrink per-stage size to keep BLUR=1 from getting
    // tunnel-y. amount caps near legacy g (0.7 → effective 0.55*1=0.55
    // through 4 stages ≈ same total energy spread as 1 stage @ 0.7).
    setDiffuser('amount', b * 0.55);
    setDiffuser('size',   0.10 + b * 0.40);
  }

  function applyTone() {
    // Legacy: 2k..16k LP. Smooth biases this lower and adds a 2nd stage.
    const baseHz = 2000 + state.tone * 14000;
    const smoothScale = 1 - 0.5 * Math.min(1, state.smooth);
    const lpHz = Math.max(1800, baseHz * smoothScale);
    setTone('lpHz', lpHz);
    setTone('stages', state.smooth > 0.05 ? 2 : 1);
  }

  function applyWidth() {
    // <1 : stereo+detune (handled in applyTime); stereoMode=0
    // 1   : stereo, no detune
    // >1.5: ping-pong; 1..1.5: cross-feed
    let mode = 0;
    if (state.width >= 1.5) mode = 1;
    else if (state.width > 1.0) mode = 2;
    setDelay('stereoMode', mode);
    applyTime();  // detune depends on width
  }

  function applyMix() { fx.setEngineMix(state.mix); }

  // -------- Public API -------------------------------------------------
  const api = {
    setTime    : v => { state.time     = v; applyTime(); },
    setFeedback: v => { state.feedback = v; applyFeedback(); },
    setDegrade : v => { state.degrade  = v; applyDegrade(); },
    setMotion  : v => { state.motion   = v; applyMotion(); },
    setBlur    : v => { state.blur     = v; applyBlur(); },
    setTone    : v => { state.tone     = v; applyTone(); },
    setSmooth  : v => { state.smooth   = v; applyTone(); },          // smooth re-derives tone
    setWidth   : v => { state.width    = v; applyWidth(); },
    setMix     : v => { state.mix      = v; applyMix(); },
    setBypass  : on => fx.setBypass(on),
    reset      : ()  => fx.reset(),
    getState   : ()  => ({ ...state }),
    loadPreset : (preset) => {
      Object.assign(state, defaults, preset || {});
      applyTime(); applyFeedback(); applyDegrade();
      applyMotion(); applyBlur(); applyTone();
      applyWidth(); applyMix();
    },
  };

  // Initial push
  api.loadPreset({});
  return api;
}
