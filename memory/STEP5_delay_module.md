# STEP 5 — IDspModule + ParamStore + FxEngine + DelayModule

Stack reframed for the actual codebase: **JS / Web Audio AudioWorklet** (not C++/JUCE). Step 4 architectural principles preserved; class names mirror the C++ spec.

## Files added

```
src/core/
  dspWorklet.js   — string-source AudioWorkletProcessor + primitives + IDspModule + DelayModule
  fxEngine.js     — main-thread ParamStore, AudioWorkletNode wrapper, MIDI mapping stub
```

## Layering

| Layer        | Lives in                           | Owns |
|--------------|------------------------------------|------|
| Control      | `fxEngine.js` (main thread)        | ParamStore, preset load, MIDI map, bypass |
| Modulation   | (deferred — Step 7)                | Mod sources + matrix |
| DSP          | `dspWorklet.js` (audio thread)     | IDspModule chain + primitives |

Strict rule preserved: DSP modules know nothing of MIDI/host/UI; main thread never blocks audio thread. Param updates cross via `port.postMessage` (lock-free ring on the worklet side).

## Primitives implemented

- `ParamSmoother` — two-stage 1-pole (block τ ≈ 25 ms → sample τ ≈ 5 ms). All Step-4 smoothing rules satisfied; per-param tau overridable (DelayModule's `timeL/R` use 50 ms block tau so jumps yield tape-style pitch slide instead of click).
- `DelayLine` — circular buffer, **3rd-order Lagrange** fractional read, write API only (caller owns the read pointer / smoothing). Max length configurable per instance (4 s default).
- `OnePoleLP`, `OnePoleHP`, `DcBlock` — minimal filter set for the feedback path and output cleanup.
- `LFO` — sin / tri / sq / S&H, phase-stable rate change.
- `softSat` — cheap rational tanh-equivalent for feedback-path tape limiting.

## IDspModule contract

```
prepare(sr, maxBlock, channels)
reset()
process(inL, inR, outL, outR, n)
latencySamples()
tailSamples()
```

Plus `this.params` — an object whose values are `ParamSmoother` instances. The processor calls `tickBlock()` once per render quantum on every smoother; the module loop calls `tickSample()` per sample for params it needs at audio rate.

## DelayModule

High-quality stereo delay with 12 params (see `DELAY_PARAMS` in `fxEngine.js`):

| Param | Range | Notes |
|---|---|---|
| timeL / timeR | 0.005 – 3.0 s, exp skew | Independent L/R; smoothed → tape pitch slide |
| feedback | 0 – 0.97 | Hard-clamped at the smoother |
| stereoMode | 0/1/2 | Stereo / Ping-pong / Cross-feed |
| wowDepth | 0 – 1 → 0 – 6 ms | Slow LFO, sin |
| wowRate | 0.05 – 4 Hz, exp | |
| flutterDepth | 0 – 1 → 0 – 1 ms | Fast LFO, tri |
| flutterRate | 1 – 18 Hz, exp | |
| damp | 0 – 1 → 18 kHz – 1.2 kHz | Feedback-path 1-pole LP |
| lowCut | 20 – 600 Hz, exp | Feedback-path 1-pole HP (kills sub-fb runaway) |
| drive | 0 – 1 | Pre-saturation gain into softSat in the FB path |
| mix | 0 – 1 | Equal-power dry/wet |
| (bypass) | AudioParam | Sample-accurate via `setBypass(on)` |

Latency: 0. Tail: capped at 8 s. DC blocker on wet output. All filter coefficients re-derived once per block from smoothed-block values; only fast/perceptual params are re-evaluated per sample.

## ParamStore (main thread)

`defineParam({ id, min, max, default, skew, unit })` returns an object with `fromNorm(0..1) → DSP value`. Three skews available now (`linear / exp / log`); add more as needed.

Engine API:

```
const fx = await createFxEngine(audioCtx);
sourceNode.connect(fx.input);
fx.output.connect(audioCtx.destination);

fx.setParamNorm(0, fx.params[0].feedback, 0.7);
fx.setParam(0, 'timeL', 0.25);                       // raw DSP value
fx.loadPreset(0, fx.params[0], { mix: 0.4, drive: 0.2, feedback: 0.6 });
fx.mapCC(74, 0, fx.params[0].damp);
fx.handleMidiMessage([0xB0, 74, 96]);
fx.setBypass(false);
fx.reset();
```

Snapshot dedup is built in (re-sending the same value is a no-op unless `force: true`).

## What's deliberately NOT here yet (lands later)

- 6-slot RoutingGraph with serial/parallel/multiband — `FxProcessor.process` currently calls one module directly; the routing struct is the next layer above it.
- ModSource roster + ModMatrix — sketched in Step 4, not wired yet.
- 8-Macro engine + scenes.
- Polyphase 2× oversampling for nonlinear primitives (added when Distortion module is introduced).

## How the existing plugins migrate to this core (next)

Per the audit (`STEP4B_AUDIT_existing_plugins.md` §3), the next concrete tasks are:

1. Port **Echoform** to `DelayModule` — its degrade-per-repeat behavior becomes a small `DegradeModule` chained after `DelayModule` rather than a bespoke worklet.
2. Port **TapeDelay** — its three heads become three `DelayModule` instances in parallel slots inside the future RoutingGraph.
3. Port **Drift** — single `DelayModule` with high `wowDepth` + `flutterDepth`, very short `timeL/R`, zero `feedback`.
4. **PitchShifter** keeps its granular processor but consumes `DelayLine` from this core.

Until those ports exist, the new core lives alongside the legacy engines — no breakage.
