# STEP 4 — Unified FX Plugin Architecture

Synthesises the extracted DSP modules (Reverb / Delay / Distortion / Dynamics / Modulation / Spatial) into one implementable plugin architecture. Three strictly separated layers: **DSP**, **Control**, **Modulation**. Implementation language target: C++17, JUCE / iPlug2 / CLAP-friendly.

---

## 0. Three-Layer Separation Principle

```
┌──────────────────────────────────────────────────────────────┐
│  CONTROL LAYER (host-rate, atomic, lock-free)                │
│  Parameters · Automation · MIDI · Macros · Preset State      │
└─────────────────────────┬────────────────────────────────────┘
                          │ smoothed values @ block rate
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  MODULATION LAYER (control-rate, e.g. 1 sample / 32–64 audio)│
│  LFOs · Envelopes · Sidechain followers · Mod Matrix         │
└─────────────────────────┬────────────────────────────────────┘
                          │ summed mod offsets per parameter
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  DSP LAYER (audio-rate, real-time, branch-free hot path)     │
│  Reverb · Delay · Distortion · Dynamics · Modulation · Spatial│
└──────────────────────────────────────────────────────────────┘
```

**Hard rules:**
- DSP modules never read parameters directly; they receive a `RuntimeParams&` struct each block.
- Control layer never touches audio buffers.
- Modulation layer never owns parameter state — it produces *deltas* added to control-layer values.
- Atomic / lock-free communication only. No mutexes on the audio thread.

---

## 1. CORE ENGINE — DSP Modules

### 1.1 Common module interface

```cpp
class IDspModule {
public:
    virtual void prepare(double sampleRate, int maxBlockSize, int channels) = 0;
    virtual void reset() = 0;
    virtual void process(juce::AudioBuffer<float>& buf,
                         const RuntimeParams& p) = 0;     // block-rate params
    virtual int  latencySamples() const { return 0; }
    virtual int  tailSamples() const { return 0; }
    virtual ~IDspModule() = default;
};
```

### 1.2 Module roster (one class per family, see referenced batch memory)

| Module           | Backbone DSP                                                   | Memory ref |
|------------------|----------------------------------------------------------------|------------|
| `Reverb`         | FDN16 + Hadamard/Householder, HF shelf decay, modulated diffusers | reverb_batch1–6 |
| `Delay`          | Multitap modulated delay (TAPIIR-style) + tape-mod LFO + tube/BBD coloration | delay_batch1–2 |
| `Distortion`     | WDF circuit / Wiener-Hammerstein / NAM-style RNN — three pluggable backends | distortion_batch1–4 |
| `Dynamics`       | Branching detector + soft-knee gain + look-ahead + opto/var-mu/FET character | dynamics_batch1 |
| `Modulation`     | Unified ModDelay-AllpassComb (chorus/flanger/phaser morph) + Leslie + SSB shifter | modulation_batch1 |
| `Spatial`        | Per-band M/S + PCA primary/ambient + velvet-noise / resonator decorrelator | spatial_batch1 |

### 1.3 Sample-rate & oversampling

- Each module declares its **internal preferred SR** (e.g. distortion needs 2× OS or ADAA; reverb runs at host SR).
- Engine wraps each high-quality module in a single `Oversampler<N>` (polyphase IIR) when its quality knob > 1×.
- Smoothing & modulation occur at **host SR**, not OS rate, to keep CPU bounded.

### 1.4 Why modules stay independent

- Each module unit-testable from a `WAV in → params → WAV out` harness.
- Each has its own preset format (per-module preset bank = future-proof).
- Routing graph (§4) freely re-orders / parallelises them.

---

## 2. CONTROL SYSTEM

### 2.1 Parameter primitive

```cpp
struct ParamDef {
    String   id;             // stable, e.g. "reverb.time"
    String   label;
    float    min, max, def;
    enum Curve { Linear, Log, Exp, dB, Hz, Ms, Percent } curve;
    float    skew;           // for Log/Exp
    enum Smooth { Audio, Block, None } smooth;
    float    smoothMs = 25;  // default 25 ms (avoids zipper, fast for live)
};
```

### 2.2 Smoothing (no zipper)

Two-stage smoothing chain per parameter:

```
HostSetValue ─▶ AtomicTarget ─▶ BlockSmoother(1-pole, τ_block)
                                         │
                                         ▼
                                 SampleSmoother(1-pole, τ_audio)
                                         │
                                         ▼  per-sample value to DSP
```

- **Block smoother** runs once per buffer (cheap) → handles slow automation.
- **Sample smoother** runs per audio sample only for *modulated* targets and for filter cutoff / delay time / gain (zipper-prone params).
- τ_audio = 5–25 ms; τ_block = 10–50 ms.
- Uses `Schlecht 2020 energy-preserving rotation form` (delay_batch1 #14) for time-varying allpass coefficients in modules.

### 2.3 Automation

- Every parameter is exposed via a single `juce::AudioProcessorValueTreeState` (or CLAP `clap_param_info`).
- Host writes → atomic store → block smoother picks up → DSP sees smoothed value.
- Latency reporting via `AudioProcessor::setLatencySamples(engine.totalLatency())` so PDC works.

### 2.4 MIDI mapping

```cpp
struct MidiMap {
    enum Source { CC, NoteVelocity, Aftertouch, PolyAT, NoteNumber, PitchBend, ProgChange };
    Source source;
    int    ccNumber = -1;       // for CC
    int    channel  = 0;        // 0 = omni
    String paramId;             // destination param
    float  depth   = 1.0f;      // -1..+1 scale of param range
    Curve  curve   = Linear;    // velocity curve etc.
};
```

- MIDI events processed on audio thread (low-latency); update the same `AtomicTarget` queue as automation.
- "MIDI Learn" flow: UI sets `learnTargetParam`; next incoming CC fills the `MidiMap` slot.
- MPE-aware: per-note channel handling for poly aftertouch / pitch-bend (forwarded as a per-voice modulation source).

### 2.5 Preset / state

- Preset = JSON (paramId → value, mod-matrix routes, macro mappings).
- Versioned schema; migration table for backward compat.
- Independent of DAW state; portable across hosts.

---

## 3. MODULATION SYSTEM

### 3.1 Modulation rate

Run modulation at **control-rate = audio-SR / 32** (≈ 1.4 kHz at 44.1 k).
- Cheap: one mod-tick per 32 audio samples.
- Output linearly interpolated to audio rate when applied to fast-moving targets (delay time, cutoff).

### 3.2 Source roster

| Source           | Shape / behaviour                                          | Notes |
|------------------|------------------------------------------------------------|-------|
| `LFO_Sine`       | Bandlimited sine                                           | Phase reset, retrig on note-on |
| `LFO_Triangle`   | Symmetric / skewed                                         | Skew = 0..1 → ramp ↔ tri ↔ saw |
| `LFO_Square`     | PWM (BLEP for clean edges)                                 | Width 1–99% |
| `LFO_SH`         | Sample & hold (random)                                     | Slew param adds smoothing |
| `LFO_Fractal`    | 1/f / Weierstrass (modulation_batch1 #3)                   | Hurst H ∈ [0,1] |
| `LFO_Tape`       | wow + flutter + scrape band-noise (delay_batch2 #2)        | Realistic vibrato |
| `LFO_Velvet`     | Sparse-impulse trains for jitter/decorrelation             | |
| `Env_AHDSR`      | Attack/Hold/Decay/Sustain/Release                           | Velocity scales attack rate |
| `Env_Follower`   | Detector from input (peak / RMS / K-weighted) — dynamics_batch1 #1, #3 | Fast/slow attack/release |
| `Env_Sidechain`  | Same as follower but on external sidechain bus              | |
| `Macro_n`        | User macro 1..8 (see §5)                                   | Plain knob, also automatable |
| `MIDI_*`         | velocity, aftertouch, CC, key-track, pitch-bend            | |
| `Step_Seq`       | 16/32-step sequencer, tempo-synced                         | Optional |

All sources implement:
```cpp
class IModSource {
public:
    virtual void prepare(double sampleRate) = 0;
    virtual float tick() = 0;        // returns -1..+1 (or 0..1 for unipolar)
    virtual void reset() = 0;
    virtual bool isUnipolar() const = 0;
};
```

### 3.3 Tempo sync

- Engine receives host BPM + PPQ via `AudioPlayHead`.
- Sync-able sources expose `RateMode {Hz, NoteValue, Dotted, Triplet}` and `NoteValue {1/1 .. 1/64}`.
- LFO phase locked to `ppqPosition * (rateInBeats / 4)` so retrig-on-play feels musical.
- Free-run vs locked toggle per source.

### 3.4 Modulation routing matrix

```cpp
struct ModRoute {
    String  sourceId;       // "LFO1", "Env2", "SC", "Macro3", "MIDI.CC11"
    String  destParamId;    // any ParamDef.id
    float   depth;          // -1..+1 (signed)
    Curve   curve;          // Linear / Quad / Exp
    bool    bipolarOffset;  // true: ±depth around current; false: 0..depth additive
};
```

- Per-block computation:
  ```
  for each ModRoute r:
      modSum[r.destParamId] += r.depth * curveMap(source[r.sourceId].tick())
  ```
- Final DSP-bound value: `clamp(paramSmoothed + modSum, paramMin, paramMax)`.
- Hard cap: 64 simultaneous routes (fits typical plugin RAM/CPU).

### 3.5 Sidechain modulation

- Plugin declares an aux input bus (`AudioProcessor::BusesProperties().withInput("Sidechain", Stereo)`).
- `Env_Sidechain` reads that bus per block, runs detector, exposes envelope as a mod source.
- Routable to any param exactly like LFOs (e.g. duck reverb wet on vocal sidechain).

---

## 4. SIGNAL FLOW & ROUTING

### 4.1 The graph

The engine is a fixed-topology DAG with **6 module slots** and a **router** between them. Default slot order: `Distortion → Dynamics → Modulation → Delay → Reverb → Spatial`. User can re-order any slot.

```
                  ┌─────────────┐
   IN ─▶ INPUT ──▶│  Slot 1     │──▶ ┐
                  └─────────────┘    │
                  ┌─────────────┐    │
                  │  Slot 2     │──▶ ├─▶ MIX BUS ─▶ MASTER ─▶ OUT
                  └─────────────┘    │
                       ...           │
                  ┌─────────────┐    │
                  │  Slot 6     │──▶ ┘
                  └─────────────┘
```

### 4.2 Per-slot routing modes

Each slot has a `RoutingMode`:
- `Serial` — output of previous slot feeds this one (default).
- `Parallel` — pulls from a chosen tap (input, post-slot-N, or sidechain) and sums into a chosen bus (Mix, Aux1, Aux2).
- `Bypass` — module skipped, latency still reported (PDC).
- `Solo` — only this slot reaches output (debug / mix evaluation).

### 4.3 Dry/Wet system

- Two-level dry/wet:
  - **Per-module wet/dry** (intrinsic Mix knob inside each DSP module).
  - **Engine-level Mix** (overall plugin Dry/Wet).
- Both implemented as equal-power crossfade `(cos(π/2·m), sin(π/2·m))`.
- "True bypass" mode bypasses both with PDC-aware delay-matching on the dry path.

### 4.4 Insert vs Send behaviour

- **Insert mode** (default): plugin processes full signal; dry/wet at engine level controls blend.
- **Send mode**: dry path muted at output; only wet returns. UI toggle. Intended use on aux-bus inserts.
- Both modes share the same DSP graph — only the final `dry*` coefficient differs.

### 4.5 Optional multiband support

Multiband is **opt-in per module** (Distortion, Dynamics, Modulation are the candidates; Reverb / Delay / Spatial typically stay broadband).

```
INPUT ─▶ Linkwitz-Riley 4-band crossover ─▶ [Module instances ×4] ─▶ Sum ─▶ Wet
                  (50/300/3000 Hz default)
```

- LR4 crossovers → linear-phase-summing (no comb).
- Linear-phase mode (FIR) optional, adds latency (reported).
- Per-band: gain trim + module bypass + solo.

### 4.6 Latency & PDC

- `engine.totalLatency = max(serialChain) + look-ahead(limiter) + linear-phase-FIR-delay`.
- Reported every parameter change that affects latency.
- Dry path delay-aligned to wet path automatically (look-ahead delay line on dry).

---

## 5. MACRO SYSTEM

### 5.1 Macro primitive

```cpp
struct Macro {
    String  name;            // "Vibe", "Size", "Drive", ...
    float   value;           // 0..1, automatable, MIDI-mappable
    Vector<MacroLink> links; // many destinations
};

struct MacroLink {
    String paramId;
    float  fromValue, toValue;   // remap range (allows inversion: from=1, to=0)
    Curve  curve;                // Linear / Quad / Exp / S-curve
};
```

### 5.2 Defaults

- 8 macro knobs ship by default (`Macro1..8`); UI exposes them as a panel of large knobs.
- Each macro can drive any number of parameters (typical: 3–10).
- Macros also act as mod-matrix sources (so a macro can drive an LFO depth which drives a filter cutoff — meta-modulation).

### 5.3 Performance use

- Macros assignable to MIDI CC1 (mod wheel), expression pedal, sustain, etc.
- "Snapshot" feature: capture current macro values as a scene (4–8 scenes per preset); morph between scenes via a single knob (per-param interpolation with optional per-link curve).
- Live-friendly: macros bypass smoothing only when user explicitly sets `instant = true` (else 25 ms smoothing applies to keep performance audible-glitch-free).

### 5.4 Auto-mapping helpers

- "Macro Learn": touch a macro knob, then wiggle parameters in the UI; engine offers to add wiggled params as new MacroLinks with matching ranges.

---

## 6. SYSTEM DIAGRAMS

### 6.1 Overall plugin

```
┌──────────── HOST ────────────┐
│ Automation, MIDI in, Audio in│
└──┬─────────────┬──────────┬──┘
   │ params      │ MIDI     │ audio (in + sidechain)
   ▼             ▼          │
┌──────────────────────────┐ │
│   CONTROL LAYER          │ │
│  ParamStore (atomic)     │ │
│  MIDI mapper             │ │
│  Macro engine            │ │
│  Preset / state          │ │
└──────────┬───────────────┘ │
           │ block-smoothed  │
           ▼                 │
┌──────────────────────────┐ │
│   MODULATION LAYER       │ │  (sidechain feeds Env_SC)
│  LFOs · Envs · SC det.   │◀┤
│  Tempo sync · Step seq   │ │
│  MOD MATRIX (sums Δ)     │ │
└──────────┬───────────────┘ │
           │ paramFinal      │
           ▼                 ▼
┌─────────────────────────────────────────────────────┐
│   DSP LAYER — Routing Graph (6 slots, reorderable)  │
│                                                     │
│  IN ▶ [Slot1] ▶ [Slot2] ▶ ... ▶ [Slot6] ▶ MIX ▶ OUT │
│           │       │                  │              │
│           └─para──┴──parallel taps───┘              │
│                                                     │
│  Optional 4-band split per slot                     │
└─────────────────────────────────────────────────────┘
                                │
                         look-ahead limiter (master)
                                │
                                ▼
                              OUT
```

### 6.2 Per-parameter resolution flow

```
ParamStore.target  ─▶  BlockSmooth  ─▶  AudioSmooth  ─┐
                                                       ├─▶  paramFinal  ─▶ DSP
ModMatrix.sum  ──────────────────────────────────────┘
                    (Σ depth · source.tick())
```

### 6.3 Mod matrix internal

```
Sources (per control tick):
  LFO1.tick()  ─┐
  LFO2.tick()  ─┤
  Env1.tick()  ─┤        ┌─────────────┐
  EnvSC.tick() ─┼──▶ MOD │  N×M depth  │ ──▶ ΔParam[1..M]
  Macro1..8    ─┤   MTX  │   curves    │
  MIDI sources ─┘        └─────────────┘
                              ▲
                              │ user routes (UI)
```

### 6.4 Routing per slot

```
                         ┌───────────────┐
   prev-slot out ───────▶│   Module N    │── post-slot tap (named bus)
                         │ (DSP class)   │
   parallel-in tap  ───▶ │  + wet/dry    │
                         └───────────────┘
                                │
                       slot mode {Serial/Parallel/Bypass/Solo}
                                │
                                ▼
                      next slot OR mix bus
```

---

## 7. MODULE BREAKDOWN — Concrete Classes

```cpp
namespace shags {

// -------- DSP --------
class Reverb         : public IDspModule { /* FDN16 + diffusers + shelves */ };
class Delay          : public IDspModule { /* Multitap + tape mod + tube/BBD */ };
class Distortion     : public IDspModule {
    enum class Backend { WDF, WienerHammerstein, NeuralRNN };
    /* runtime-pluggable backend */
};
class Dynamics       : public IDspModule { /* detector + curve + character */ };
class Modulation     : public IDspModule { /* ModDelay-AllpassComb + Leslie + SSB */ };
class Spatial        : public IDspModule { /* M/S + PCA + decorrelator */ };

// -------- Control --------
class ParamStore     { /* atomic targets, block + audio smoothers */ };
class MidiMapper     { /* CC/Vel/AT/PB → ParamStore queue */ };
class PresetManager  { /* JSON load/save, versioned migration */ };

// -------- Modulation --------
class ModSourceLFO   : public IModSource { /* Sine/Tri/Sq/SH/Fractal/Tape/Velvet */ };
class ModSourceEnv   : public IModSource { /* AHDSR */ };
class ModSourceFollower : public IModSource { /* peak/RMS/K detector */ };
class ModMatrix      { /* routes, per-tick sum into ΔParam */ };
class TempoSync      { /* AudioPlayHead → beat phase for sync sources */ };

// -------- Macros --------
class MacroEngine    { /* 8 macros, links, snapshots, learn */ };

// -------- Engine --------
class RoutingGraph   { /* 6 slots, modes, parallel taps, multiband split */ };
class FxEngine       { /* owns everything, runs per-block process */ };

} // namespace shags
```

---

## 8. PROCESS-BLOCK PSEUDOCODE

```cpp
void FxEngine::process(AudioBuffer<float>& in,
                       AudioBuffer<float>& sc,
                       MidiBuffer& midi)
{
    // 1. Control layer
    midiMapper.process(midi);            // CC/Vel/AT → ParamStore
    paramStore.tickBlock();              // run block smoothers

    // 2. Modulation layer (control-rate ticks within the block)
    const int ctrlStride = 32;
    for (int s = 0; s < numSamples; s += ctrlStride) {
        for (auto& src : modSources) src->tickN(ctrlStride);
        modMatrix.compute(modBuffer);     // ΔParam per dest
        // resolve per-sample paramFinal[t] for any audio-rate-smoothed param
    }

    // 3. DSP layer — routing graph
    routingGraph.process(in, sc, paramStore, modMatrix, outBuffer);

    // 4. Master section
    masterLimiter.process(outBuffer);    // look-ahead, dynamics_batch1 #1
}
```

---

## 9. DESIGN INVARIANTS

1. **No allocation, no locks, no I/O on the audio thread.**
2. **All time-varying coefficients use energy-preserving forms** (rotation-form allpass, ramped allpass, ADAA where saturating) — patterns from delay_batch1 + distortion_batch3.
3. **Latency is always reported.** Look-ahead, FIR linear-phase, oversampling — all contribute to a single `engine.totalLatency` value.
4. **DSP modules know nothing about MIDI, host, or modulation.** They take `RuntimeParams&` and a buffer.
5. **Mod matrix is the only writer to the modulation portion of paramFinal.** Macros write to ParamStore targets (just like host automation).
6. **Mono compatibility check (Spatial)** is always available — surfaced as a meter, not a hidden assumption.
7. **Per-module quality knob** (1× / 2× / 4× OS or AA-mode) — user trades CPU for fidelity per-module without touching others.
8. **Preset is portable.** JSON, no binary blobs, no native-handle storage.

---

## 10. WHAT'S NOT IN THIS ARCHITECTURE

- **Synth / instrument-engine concerns** — MIDI-to-sound, oscillators, voice management — are in `DEFERRED_synthesis_instrument_engine.md`. This document is the FX-bus architecture only.
- **Visualizer / UI rendering** — separate concern. UI reads the same `ParamStore` + meter buffers via lock-free FIFO; uses RAF / repaint timers; styled per `svg_reactive_glow_system.md`.
- **Cloud / model-server features** — out of scope for v1.

---

## 11. BUILD-OUT ORDER (Suggested)

1. `IDspModule` interface + `ParamStore` with smoothing.
2. Skeleton `FxEngine` with one DSP module (start: Delay) wired through a 1-slot RoutingGraph.
3. Add ModMatrix with 1 LFO source → 1 destination; verify smooth modulation.
4. Add remaining DSP modules one at a time; each gets unit tests against extracted memory specs.
5. Add MIDI mapping + tempo sync.
6. Add 6-slot RoutingGraph with reorder + parallel.
7. Add macro engine + snapshots.
8. Add multiband split for Distortion / Dynamics / Modulation.
9. Add master look-ahead limiter + final PDC pass.
10. Wire UI → ParamStore (read-only); add mod-matrix editor + macro-learn.

---

## 12. CROSS-REFERENCES

- DSP recipes per module — `dafx_reverb_batch1–6.md`, `dafx_delay_batch1–2.md`, `dafx_distortion_batch1–4.md`, `dafx_dynamics_batch1.md`, `dafx_modulation_batch1.md`, `dafx_spatial_batch1.md`.
- Governing aesthetic / behavior framework — `audio_engineer_mental_model.md`.
- Visual reactive system — `svg_reactive_glow_system.md`, `project_orb_visual_spec.md`, `project_metering_system.md`.
- Underlying DSP textbooks — `jos_pasp_dsp_reference.md`, `dafx_zolzer_textbook.md`, `bbd_holters_parker_model.md`, `pasp_through_design_lens.md`.
- Future synth-engine phase — `DEFERRED_synthesis_instrument_engine.md`.
