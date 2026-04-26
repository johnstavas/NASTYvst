# Phase 2 — Parity Harness

**Date:** 2026-04-25
**Per:** memory/codegen_pipeline_buildout.md § 5

## What landed

Sample-accurate VST3 vs JS-reference parity testing.

```
node scripts/check_native_parity.mjs --op gain
node scripts/check_native_parity.mjs --all
npm run qc:parity
```

For each (op, signal) pair: generate test signal → render through both
the canonical JS reference and the .vst3 (via parity_host) → compare under
per-op tolerance band.

## Components built

- `src/sandbox/codegen/parity_host/` — JUCE console app, hosts a .vst3 and
  renders WAV→WAV with sample-precise block boundaries.
  Builds to `parity_host.exe` (~2 MB).
- `scripts/parity_signals.mjs` — 8 canonical deterministic test signals
  (impulse, dc_step, silence, sine_440, sweep, pink_noise, two_tone, burst).
  All seeded; bit-reproducible cross-platform. Includes Float32 WAV r/w.
- `scripts/check_native_parity.mjs` — orchestrator. Computes JUCE VST3
  ParamID hashes (Java-style `String.hashCode` + Studio One top-bit clear)
  to drive HostedParameter lookup. Normalises raw values to [0,1] using
  per-op range spec. metric: max_abs_diff or rms_diff.
- `test/fixtures/parity/per_op_specs.json` — per-op signals + tolerance +
  vst3 path + params + ranges + reference function.
- `package.json` — `qc:parity` script. NOT yet in `qc:all` (per § 5.5,
  added once Phase 3 starts populating).

## Acceptance results

```
gain                               vst3=SmokeGainV0.vst3      ref=builtin:gain
  [PASS] impulse      maxAbsDiff=0.000e+0  (-Inf dB)
  [PASS] dc_step      maxAbsDiff=0.000e+0  (-Inf dB)
  [PASS] pink_noise   maxAbsDiff=7.451e-9  (-162.56 dB)

gain_chain2 (gain → gain)          vst3=SmokeGainChainV0.vst3 ref=builtin:gain_chain2
  [PASS] impulse      maxAbsDiff=2.980e-8  (-150.51 dB)
  [PASS] dc_step      maxAbsDiff=2.980e-8  (-150.51 dB)
  [PASS] pink_noise   maxAbsDiff=5.588e-9  (-165.05 dB)
```

All 6 pairs PASS at -120 dB tolerance. Float32 epsilon territory.

## Key design wins

- **VST3 ParamID hash discovered** — Java-style `String.hashCode()` (31*h+c)
  cast to uint32, top bit cleared (`& 0x7FFFFFFF`) for Studio One
  compatibility. Replicated in JS so the orchestrator can drive
  `HostedParameter::getParameterID()` matches without per-plugin discovery.
- **Pre-normalisation** — `juce::AudioPluginInstance::HostedParameter`
  doesn't extend `RangedAudioParameter`, so the orchestrator must convert
  raw values to [0,1] using ranges from the spec.
- **Block-precise rendering** — parity_host runs `processBlock` at exactly
  the requested buffer size so we can match the worklet's render-quantum
  discipline byte-for-byte.

## Files in this archive

- `source/parity_signals.mjs` — signal generators + WAV r/w
- `source/check_native_parity.mjs` — orchestrator
- `source/parity_host/` — JUCE app source (CMakeLists + main.cpp)
- `source/per_op_specs.json` — gain + gain_chain2 specs
- `parity_host.exe` — prebuilt binary

## Next

Phase 3 — retroactive sweep across the 16 shipped ops per § 6.
Each op gets:
1. an `op_<name>.cpp.jinja` C++ sidecar
2. an entry in `per_op_specs.json`
3. green PASS at the appropriate tolerance band

Tier order from § 6.1: A (linear/simple) → B (filters) → C (delays) →
D (modulation) → E (nonlinear) → F (neural).
