# Phase 1 — Codegen Pipeline End-to-End

**Date:** 2026-04-25
**Per:** memory/codegen_pipeline_buildout.md § 4

## What landed

End-to-end pipeline `graph.json → PCOF → jinja render → cmake → .vst3`,
loadable in Reaper, audibly correct.

```
node src/sandbox/codegen/build_native.mjs <graph.json>
```

Emits a self-contained JUCE 8 / VST3 project under `.shagsplug/<graph-id>/`
and a working `.vst3` bundle.

## Components built

- `src/sandbox/codegen/build_native.mjs` — orchestrator
- `src/sandbox/codegen/pcof_builder.mjs` — Node-ESM bridge to browser sandbox
- `src/sandbox/codegen/render_native.mjs` — minimal jinja-subset engine
- `src/sandbox/codegen/templates/*.jinja` — 7 templates:
  CMakeLists, PluginProcessor (.h/.cpp), MasterGraph (.h/.cpp), PluginEditor (.h/.cpp)
- `src/sandbox/ops/op_gain.cpp.jinja` — first real op sidecar (mirrors worklet)
- `src/sandbox/opRegistry.js` — `ui:'slider'` hint added to gain param

## Acceptance

| Plugin | Topology | Result |
| --- | --- | --- |
| SmokeGainV0 | 1× gain | knob UI, +7.2 dB knob → +7.1 dB Reaper master (bit-correct) |
| SmokeGainChainV0 | gain → gain | 2 sliders, both –6 dB → –12 dB total, meter + bypass live |

## Key design wins

- **Per-channel mono dispatch** — correct for pointwise ops (Phase 1 scope);
  revisit Phase 3 for stereo-aware ops (panner/MS).
- **PLUGIN_CODE = caps+digits initialism** of PROJECT_NAME — guarantees unique
  VST3 ClassUID per plugin (SGV0 vs SGCV). First-4-chars naive impl collided.
- **Default-constructible op classes** — MasterGraph members construct then
  `prepare()` reassigns with sampleRate; required `Op() = default;` in jinja.

## Files in this archive

- `source/smoke-gain-v0/` — full rendered codegen workspace (CMakeLists + src)
- `source/smoke-gain-chain-v0/` — same, 2-op
- `source/smoke_gain.graph.json` + `smoke_gain_chain.graph.json` — input fixtures
- `binaries/SmokeGainV0.vst3/` — knob-UI build
- `binaries/SmokeGainChainV0.vst3/` — slider-UI build, 2-op chain

## Next

Phase 2 — parity harness (`scripts/check_native_parity.mjs` + JUCE console host).
Compare WebAudio worklet output vs native VST3 output, sample-accurate, per § 5.
