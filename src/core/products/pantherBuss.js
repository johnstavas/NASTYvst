// pantherBuss.js — Panther Buss: channel-strip / buss-processor product.
//
// Signal flow:
//
//   in ─► EQ ─► Saturator ─► Compressor ─► Limiter ─► engineMix ─► out
//
// Composition only. All DSP is generic; Panther Buss is pure product layer.
//   • EqModule          — 5-band RBJ (HP → LS → PK → HS → LP)
//   • SaturatorModule   — tube curve for colour, ADAA-1 on
//   • CompressorModule  — slow, low-ratio "glue" bus compression
//   • LimiterModule     — transparent ceiling, short lookahead
//
// Product-layer macros (no DSP edits):
//   • DRIVE   — saturator drive + subtle EQ pre-emphasis (lift a touch of
//               low-shelf and high-shelf so harmonic content has something
//               to bite on; keeps the strip from going muddy as drive rises)
//   • GLUE    — compressor threshold, ratio and release (bussy: soft knee,
//               low ratio, slow-ish release). One macro, three coupled moves.
//   • TONE    — symmetric low/high shelf push/pull around a neutral mid;
//               bipolar 0..1 where 0.5 is flat.
//   • OUTPUT  — final trim on the Saturator post-gain (kept pre-comp-makeup
//               so the comp sees a consistent level as OUTPUT moves).
//               Actually: post-gain on Saturator *does* feed the comp, so
//               OUTPUT here is the comp makeup instead (clean trim of the
//               processed signal without retouching drive feel).
//   • MIX     — engine-level parallel blend (dry ↔ full processed chain).

import { MODULE } from '../fxEngine.js';

export function createPantherBuss(fx) {
  fx.setChain([
    MODULE.EQ,
    MODULE.SATURATOR,
    MODULE.COMPRESSOR,
    MODULE.LIMITER,
  ]);
  fx.setEngineMixMode(true);
  fx.setEngineMix(1.0);

  // Wet-only inside each module (MIX is handled at engine level)
  fx.setParam(MODULE.SATURATOR,  'mix', 1.0, { snap: true });
  fx.setParam(MODULE.COMPRESSOR, 'mix', 1.0, { snap: true });
  fx.setParam(MODULE.LIMITER,    'mix', 1.0, { snap: true });

  // Fixed EQ shape — product voicing, not user-facing.
  // HP at 30 Hz trims rumble; LP off by default.
  fx.setParam(MODULE.EQ, 'hpOn',   1,    { snap: true });
  fx.setParam(MODULE.EQ, 'hpFreq', 30,   { snap: true });
  fx.setParam(MODULE.EQ, 'hpQ',    0.707,{ snap: true });
  fx.setParam(MODULE.EQ, 'lsFreq', 120,  { snap: true });
  fx.setParam(MODULE.EQ, 'lsQ',    0.707,{ snap: true });
  fx.setParam(MODULE.EQ, 'pkFreq', 1800, { snap: true });   // presence anchor
  fx.setParam(MODULE.EQ, 'pkQ',    0.8,  { snap: true });
  fx.setParam(MODULE.EQ, 'pkGain', 0,    { snap: true });
  fx.setParam(MODULE.EQ, 'hsFreq', 8000, { snap: true });
  fx.setParam(MODULE.EQ, 'hsQ',    0.707,{ snap: true });
  fx.setParam(MODULE.EQ, 'lpOn',   0,    { snap: true });

  // Saturator voicing: tube curve with mild asymmetry → even-order warmth.
  fx.setParam(MODULE.SATURATOR, 'curve', 2,    { snap: true });
  fx.setParam(MODULE.SATURATOR, 'asym',  0.35, { snap: true });
  fx.setParam(MODULE.SATURATOR, 'aa',    1,    { snap: true });

  // Compressor voicing: peak+RMS hybrid, stereo-linked, slow-ish attack,
  // soft knee. GLUE then controls threshold/ratio/release from a single knob.
  fx.setParam(MODULE.COMPRESSOR, 'detectMode', 2,    { snap: true });  // hybrid
  fx.setParam(MODULE.COMPRESSOR, 'stereoLink', 1,    { snap: true });
  fx.setParam(MODULE.COMPRESSOR, 'attackMs',   20,   { snap: true });
  fx.setParam(MODULE.COMPRESSOR, 'knee',       8,    { snap: true });

  // Limiter voicing: safety-net ceiling. Lookahead pinned at 0 ms so
  // the wet path stays sample-aligned with the dry path at any MIX
  // (avoids comb-filtering on partial blend). Attack falls back to
  // the 0.05 ms zero-latency mode — acceptable for a bus safety net.
  // Lookahead is NOT switched at runtime (changing latency live can
  // produce discontinuities).
  fx.setParam(MODULE.LIMITER, 'ceiling',     -0.3, { snap: true });
  fx.setParam(MODULE.LIMITER, 'lookaheadMs',  0.0, { snap: true });
  fx.setParam(MODULE.LIMITER, 'releaseMs',    120, { snap: true });

  // Character-first defaults, tuned to the product-level transparency
  // QC rule (STEP 25): subtle coloration only — ≤ ~3 dB drive, ≤ ~2 dB
  // GR, ±1.5 dB tonal tilt, output level matched.
  //   drive 0.10 → +2.8 dB saturator drive (tube curve just touching)
  //   glue  0.20 → ~1 dB GR on typical program, long release (344 ms)
  //   tone/output at 0.50 (flat / unity)
  const defaults = {
    drive  : 0.10,   // 0..1
    glue   : 0.20,   // 0..1
    tone   : 0.50,   // bipolar, 0.5 = flat
    output : 0.50,   // bipolar trim, 0.5 = 0 dB
    mix    : 1.00,
  };
  const state = { ...defaults };

  const eq   = (n, v, o) => fx.setParam(MODULE.EQ,         n, v, o);
  const sat  = (n, v, o) => fx.setParam(MODULE.SATURATOR,  n, v, o);
  const comp = (n, v, o) => fx.setParam(MODULE.COMPRESSOR, n, v, o);

  // ---- Macros -----------------------------------------------------------

  // DRIVE: saturator drive 0..28 dB + tiny shelf pre-emphasis so the
  // harmonics generated by the curve have a defined "voice". The
  // pre-emphasis is intentionally small (±2 dB max) — it is character,
  // not tone shaping (TONE owns tone shaping).
  function applyDrive() {
    const d = state.drive;
    sat('drive', d * 28);                        // 0..28 dB
    // Mild low-shelf lift + high-shelf lift as drive rises. Keeps the
    // strip from collapsing to mids when driven hard.
    const lsLift = d * 1.5;                      // 0..+1.5 dB
    const hsLift = d * 2.0;                      // 0..+2.0 dB
    // Compose with TONE below — TONE writes the base shelf gains, DRIVE
    // adds the pre-emphasis lift. Re-applied through applyTone() to keep
    // the two macros additive on the same targets.
    applyTone();
    eq('lsGain', _lsBase() + lsLift);
    eq('hsGain', _hsBase() + hsLift);
  }

  // GLUE: one knob → threshold, ratio, release. Low-ratio bus glue at 0,
  // firmer "pull-it-together" at 1.
  function applyGlue() {
    const g = state.glue;
    // Threshold descends from -6 dB (barely touching) to -20 dB (firm)
    comp('threshold', -6 + (-14) * g);
    // Ratio from 1.3 (almost unity) to 3.0 (still bussy, not squashing)
    comp('ratio', 1.3 + 1.7 * g);
    // Release from 400 ms (slow, program-dependent feel) to 120 ms
    // (tighter, more movement). Slower at low glue = transparent.
    comp('releaseMs', 400 - 280 * g);
  }

  // TONE: bipolar tilt via symmetric low/high shelves around 0.5.
  // 0.0 = darker (+LS, −HS), 1.0 = brighter (−LS, +HS).
  function _lsBase() {
    const t = state.tone;                        // 0..1
    return (0.5 - t) * 6.0;                      // −3..+3 dB
  }
  function _hsBase() {
    const t = state.tone;
    return (t - 0.5) * 6.0;                      // −3..+3 dB
  }
  function applyTone() {
    // Include DRIVE's pre-emphasis lift so the two macros stay additive.
    const d = state.drive;
    eq('lsGain', _lsBase() + d * 1.5);
    eq('hsGain', _hsBase() + d * 2.0);
  }

  // OUTPUT: bipolar trim via compressor makeup (−12..+12 dB around 0.5).
  // Placed on makeup rather than sat.outputDb so changing OUTPUT doesn't
  // retouch compressor program level / drive feel.
  function applyOutput() {
    const o = state.output;                      // 0..1, 0.5 = 0 dB
    comp('makeupDb', (o - 0.5) * 24);            // −12..+12 dB
  }

  // MIX: parallel blend at engine level (dry ↔ full processed chain).
  // Wet path is always sample-aligned with dry (limiter lookahead = 0,
  // fixed at construction) so no runtime latency changes here.
  function applyMix() { fx.setEngineMix(state.mix); }

  // ---- Public API -------------------------------------------------------
  const api = {
    setDrive : v => { state.drive  = v; applyDrive();  },
    setGlue  : v => { state.glue   = v; applyGlue();   },
    setTone  : v => { state.tone   = v; applyTone();   },
    setOutput: v => { state.output = v; applyOutput(); },
    setMix   : v => { state.mix    = v; applyMix();    },
    setBypass: on => fx.setBypass(on),
    reset    : () => fx.reset(),
    getState : () => ({ ...state }),
    loadPreset: (preset) => {
      Object.assign(state, defaults, preset || {});
      applyDrive(); applyGlue(); applyTone(); applyOutput(); applyMix();
    },
    dispose  : () => {},
  };
  api.loadPreset({});
  return api;
}
