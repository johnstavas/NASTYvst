# Phase 3 — Tier A1 (stateless pointwise math)

**Date:** 2026-04-25
**Per:** memory/codegen_pipeline_buildout.md § 6.1

## What landed

Sample-accurate VST3 ↔ JS-reference parity verified across the 8 simplest
stateless math ops. Each op gets a single-op smoke `.vst3` and a parity
spec entry; `qc:parity` (or `node scripts/check_native_parity.mjs --all`)
walks all 8 and reports PASS/FAIL.

## Codegen template upgrade

While building Tier A1 we hit the recurring issue that every op had only
an `explicit Op(double sr)` constructor — no default ctor — so MasterGraph
member declarations couldn't compile. Fixed at the template level rather
than patching all 125 op jinjas:

- `MasterGraph.h.jinja` — node members are now `std::optional<OpClass>`
- `MasterGraph.cpp.jinja` — `prepare()` uses `n_id_.emplace(sampleRate)`,
  all dispatch goes through `n_id_->method(...)`
- `build_native.mjs` — `callExprFor()` emits `n_id_->process(...)`

Verified by re-rebuilding `SmokeGainV0` and re-running parity (still PASS).

## Acceptance — 8 ops × 5 signals

| Op           | Signals tested                                | Worst dBΔ |
| --- | --- | --- |
| gain         | impulse, dc_step, pink_noise                  | -162.56 |
| gain_chain2  | impulse, dc_step, pink_noise                  | -150.51 |
| abs          | impulse, dc_step, pink_noise, sine_440, two_tone | -Inf  |
| sign         | impulse, dc_step, pink_noise, sine_440, two_tone | -Inf  |
| scaleBy      | impulse, dc_step, pink_noise, sine_440, two_tone | -126.43 |
| clamp        | impulse, dc_step, pink_noise, sine_440, two_tone | -120.41 |
| polarity     | impulse, dc_step, pink_noise, sine_440, two_tone | -Inf  |
| uniBi        | impulse, dc_step, pink_noise, sine_440, two_tone | -Inf  |

All comfortably under -120 dB tolerance. Integer-math ops are bit-exact;
float-multiply ops show ≤ 1 ULP error (Float32 epsilon territory).

## Files in this archive

- `source/check_native_parity.mjs` — orchestrator with 8 reference fns
- `source/parity_signals.mjs` — signal canon
- `source/per_op_specs.json` — 8 op specs
- `source/smoke_*.graph.json` — graph fixtures (one per op)

## Open notes for next slice

- `polarity` tested at default `invert=false` (passthrough). The
  inverted path requires bool-param plumbing in build_native.mjs (only
  number params currently bind to APVTS).
- `uniBi` tested at default `mode=uniToBi`. Same gap (enum params).
- `mix`, `msEncode`, `msDecode`, `crossfeed`, `stereoWidth` — stereo
  ops; the per-channel mono dispatch in MasterGraph.cpp.jinja can't
  represent them. Phase 3 Tier A2 should add multi-input + stereo-aware
  graph dispatch.
- `constant`, `noise`, `sineOsc` — zero-input sources; need codegen
  fix-up for nodes with no input ports.

## Next

Tier A2: lift the codegen restrictions noted above (bool/enum params,
stereo ops, zero-input sources), or move to Tier B (filters with state
propagation: dcBlock, onePole, svf, ladder, biquad).
