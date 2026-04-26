# Phase 0 — First .vst3 from the gainCOMPUTER Toolchain

**Date:** 2026-04-24
**Project:** gainCOMPUTER
**Developer:** John Stavas (Stav)
**Plugin:** JuceHello (single gain knob, hello-world)
**Format:** VST3, Windows x64
**Size:** 4.99 MB

---

## What this is

The first plugin ever produced by the gainCOMPUTER native build chain.
A JUCE 8 hello-world (one gain knob, generic editor, no DSP beyond
sample multiplication) that proved the toolchain — CMake → MSVC → JUCE
→ VST3 — works end-to-end on this machine. Loaded successfully in
Reaper on Master Track at 23:30 local on 2026-04-24, immediately after
Phase 0 of the codegen pipeline build-out closed.

This is not a shipping plugin. It's a milestone artifact — the moment
"true DSP" stopped being architectural claim and became binary-on-disk.

## Why preserve it

- **Reproducibility pin.** The CMakeLists.txt + four source files are
  the minimal recipe that worked. If a future toolchain change (new
  JUCE version, new MSVC, different CMake) breaks the build, this is
  the known-good baseline to bisect against.
- **Phase 0 evidence.** `codegen_pipeline_buildout.md § 12` cites the
  Phase 0 hello-world build. This folder is the artifact backing that
  citation.
- **First-of-its-kind.** Plugin #0. Worth keeping for the same reason
  any project keeps its first commit.

## Folder layout

```
2026-04-24_phase0_jucehello/
  README.md                ← this file
  source/
    CMakeLists.txt         ← FetchContent JUCE 8.0.4, juce_add_plugin VST3
    Source/
      PluginProcessor.h    ← juce::AudioProcessor + APVTS gain
      PluginProcessor.cpp
      PluginEditor.h       ← juce::GenericAudioProcessorEditor wrapper
      PluginEditor.cpp
  build/
    JuceHello.vst3/        ← built binary, Reaper-loadable
      Contents/
        x86_64-win/JuceHello.vst3   ← actual .vst3 binary, 4.99 MB
        Resources/moduleinfo.json   ← VST3 manifest
```

## How it was built (preserved verbatim)

```bash
CMAKE="/c/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
"$CMAKE" -S source -B build_tmp -G "Visual Studio 17 2022" -A x64
"$CMAKE" --build build_tmp --config Release --parallel
```

Output lands at `build_tmp/JuceHello_artefacts/Release/VST3/JuceHello.vst3`.

**Wall-clock at first build (cold cache):**
- CMake configure (incl. JUCE FetchContent): 40.5 s
- CMake build (Release, parallel): ~1–2 min
- Total: under 3 min after JUCE source landed in cache

**Subsequent builds** (warm FetchContent cache): ~30–60 s.

## Toolchain at build time

- OS: Windows 10/11
- Compiler: MSVC 19.37.32824 (Visual Studio 2022 Community 17.7)
- CMake: 3.26.4-msvc4 (bundled with VS 2022)
- JUCE: 8.0.4 (via CMake FetchContent, GIT_TAG)
- Generator: Visual Studio 17 2022, x64
- Host validated in: REAPER (x64)

## What this plugin does

- Stereo-in / stereo-out
- One float param: `gain` (range 0.0–2.0, default 1.0)
- Multiplies all input samples by the gain value
- Generic JUCE editor (slider rendered automatically from APVTS)
- No bypass affordance beyond the host's plugin-bypass (intentionally
  minimal — Phase 1 adds the real custom editor with knob/slider/
  meter/bypass per buildout doc § 4.4)

## What replaces this

The Phase 1 deliverable will produce the same shape of output (a
loadable .vst3) from a `graph.json` input via the codegen pipeline,
not from hand-written CMakeLists/source files. The first non-toy
output of Phase 1 will functionally equal this hello-world (same gain
knob), but emitted by `build_native.mjs` instead of typed by hand.

When that lands, this folder remains as the "no-codegen baseline" —
useful for narrowing down whether a future bug is in the toolchain or
in our codegen layer.

## Cross-references

- `memory/codegen_pipeline_buildout.md § 12` — Phase 0 outcome stamp
- `memory/project_meta.md` — gainCOMPUTER / Stav identity
- `memory/codegen_design.md § 6` — JUCE 8 + CMake native emitter rationale
- `.phase0-juce-test/` — original throwaway working copy (gitignored;
  still on disk at the time of this README's creation, contains the
  ~700 MB JUCE FetchContent cache; safe to delete once any future
  rebuild from `source/` here completes successfully)
