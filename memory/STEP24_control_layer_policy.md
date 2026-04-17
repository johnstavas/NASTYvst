# STEP 24 — Control-layer policy (UI ↔ audio thread separation)

Formalizes the boundary between the main (UI) thread and the audio
render thread. Engine and DSP modules remain locked; this step
documents the rules already enforced by the architecture and adds one
small symmetric guard in `fxEngine.js`.

## Control-flow diagram

```
 UI thread                                    Audio-worklet thread
 ─────────                                    ────────────────────
 pointer / MIDI / host / preset
        │
        ▼
 product.setXxx(macro)          (pure JS fan-out)
        │
        ▼
 fx.setParam(m, n, v, {snap?})
   · Number.isFinite guard
   · dedup vs last posted
        │
        ▼
 node.port.postMessage ──────► port.onmessage
                                    │
                                    ▼
                             ParamSmoother.setTarget(v)     ← only path
                                or ParamSmoother.snap(v)    ← preset load

 requestAnimationFrame                        process(inputs, outputs)
        │                                          │
        ▼                                          ├─ tickBlock() per param
 DOM/SVG/Canvas read                               ├─ per-sample loop:
 meter snapshots posted                            │    v = tickSample()
 up from worklet                                   │    DSP reads v
                                                   │
                                                   └─ meters ─► postMessage ↑
```

Only `postMessage` payloads cross the boundary. No shared memory, no
AudioParam handles exposed, no direct DSP state access from UI.

## Rules

1. **UI never writes DSP state directly.** All parameter changes go
   through `fx.setParam` / `fx.setParamNorm` / `fx.loadPreset`.
2. **Every parameter flows through a ParamSmoother.** The worklet's
   `'param'` handler writes `ParamSmoother.setTarget(v)`. The only
   exception is `{snap:true}` (preset loads) which calls `.snap(v)` —
   intentional discontinuity, used before audio is flowing for that
   preset.
3. **Parameters are consumed per block or per sample.** `tickBlock()`
   at the top of each `process()`; `tickSample()` inside per-sample
   loops. DSP reads `s.value` or `s.block`; never `s.target`; never
   cross-thread.
4. **Visual systems are fully separate.** Meters/VU/glow run on rAF
   reading snapshots posted up from the worklet. Visual code does not
   call `setParam` as a modulation path.
5. **No UI-driven per-sample modulation.** Any sample-accurate
   modulation lives inside worklet modules (`LFO`,
   `EnvelopeFollower`, `CombBank` mod inputs, FDN warp LFOs). UI-side
   modulation is control-rate only (≤ ~60 Hz via `setInterval` /
   `requestAnimationFrame`), matching the established Orbit / Gravity
   BLOOM / PlateX pattern.

## Why this is already safe

- `fxEngine.setParam` is the **only** function that touches
  `node.port`. Direct port access is not exported.
- The worklet's `port.onmessage` has a fixed set of message types
  (`param`, `setChain`, `reset`, `engineMixMode`, …). No path lets a
  UI-side message bypass the ParamSmoother for a numeric parameter.
- ParamSmoother's `setTarget` already drops non-finite writes (Step
  22). The new engine-side guard is defence-in-depth, not a correctness
  fix.
- Knob-drag / MIDI-CC spam is naturally absorbed: block-τ smoothing
  means N writes between block boundaries produce the same audio as
  one write at the final value. Dedup in `setParam` additionally skips
  posting identical values.

## Engine adjustment

One line added to `fxEngine.setParam`, symmetric with the Step-22
worklet-side guard:

```js
if (!Number.isFinite(dspValue)) return;
```

Placed before the dedup cache check so bad values:
- never enter the port queue
- never poison the `last` cache (which would block the next good value
  from being posted, since the cache compares to the bad value)

No other engine or DSP changes. No module APIs touched.

## Files

| File | Change |
|---|---|
| `src/core/fxEngine.js` | + `Number.isFinite` guard at top of `setParam` |

## State after Step 24

Control-layer policy formalized. Engine still locked. Product layer
continues from here with Panther Buss as the reference composition
pattern; future products follow the same thread-boundary rules by
construction (they only call `fx.setParam` / macro fan-out, never
touch DSP directly).
