# QC Capability Flags — Glossary

> Canonical list of every flag that may appear on `engine.capabilities`.
> Derived from `qc_family_map.md`. Read by `src/qc-harness/qcPresets.js`
> to decide which QC preset tiers fire for a given plugin.
>
> **Authoring contract:** plugin engines declare `capabilities` once at
> construction. Every flag here is either a bool or a small typed value.
> Unknown flags are ignored. Missing flags default to false / 0 / []
> (i.e. "not declared" = "not applicable").

---

## 1. How to declare

```js
// inside the engine factory
const engine = {
  capabilities: {
    nonlinearStages: 2,
    dryLegHasColoration: true,
    hasFeedback: true,
    compressorTopology: 'vari-mu',
    // ...only declare what's true; everything else defaults
  },
  paramSchema: [...],
  // setters ...
};
```

Rule: **if it's true, declare it.** The QC rack treats undeclared
behavior as a bug; declared behavior as intentional. Over-declaring
is safer than under-declaring.

---

## 2. Flags in the generator TODAY

Confirmed by reading `src/qc-harness/qcPresets.js` (2026-04-20).

| Flag | Type | Gates | Example |
|---|---|---|---|
| `nonlinearStages` | number | mix_null_series (T1); cascaded-NL (T2/T4); character family | ManChild = 2 |
| `dryLegHasColoration` | bool | mix_null_series INFO demote (T1) | ManChild = true |
| `compressorTopology` | `'feedforward' \| 'feedback' \| 'vari-mu'` | topology-aware peak gate | ManChild = 'vari-mu' |
| `hasFeedback` | bool | fb_mix_coupling (T1); feedback_runaway (T3) | Delay, reverb |
| `hasFreeze` | bool | freeze_stability (T3); long-session drift (T4) | Reverb shimmer, freeze-field |
| `hasSidechain` | bool | sidechain_regime (T3) | ManChild (when SC enabled) |
| `hasStereoWidth` | bool | monosum_null (T3) | Width utilities |
| `hasMultiband` | bool | band_reconstruction (T3); per-band sidechain (T3) | Multiband comp / dynamic EQ |
| `hasLPC` | bool | lpc_stability (T3) | Auto-tune / formant-correct |
| `hasFFT` | bool | fft_frame_phase (T3); SR matrix (T4) | Phase vocoder, convolver |
| `hasWDF` | bool | wdf_convergence (T3) | Wave-digital-filter models |
| `hasPitchDetector` | bool | pitch_idle (T3) | Auto-tune, shimmer |
| `hasTruePeak` | bool | SR matrix (T4) | True-peak limiters |
| `hasLFO` | bool | long-session drift (T4) | All modulation plugins |
| `latencySamples` | number | latency_report (T3) | Lookahead limiter = 4410 |
| `osThresholds` | number[] dBFS | os_boundary (T4) | Saturator = [-12, -6, 0] |
| `subcategories` | string[] | SR matrix token match; series-identity; long-session drift | `['tape-echo', 'bbd']` |
| `modes` | string[] | mode_storm (T1) | ManChild = ['LINK','IND','M-S','MSL'] |

---

## 3. Flags implied by the family map, NOT YET in the generator

These are the gaps surfaced by `qc_family_map.md` §5. Adding them is
task #3 on the todo list. Naming conventions proposed below (lock in
when we actually wire them).

| Flag | Type | Should gate | Family row |
|---|---|---|---|
| `isClipper` | `'hard' \| 'soft' \| null` | OS+SR mandatory (T4) for hard; OS boundary for soft | Clipper — hard / soft |
| `hasLookahead` | bool | latency_report correctness (T3) | Limiter — lookahead |
| `hasHysteresis` | bool | edge-flutter / rapid-open-close rule (new T2) | Dynamics — gate/expander |
| `hasVariableClockRate` | bool | rolling-OS boundary rule (T4) | Delay — BBD / tape echo |
| `hasRegen` | bool | feedback_runaway for phaser (T3) | Modulation — phaser |
| `isTransientDesigner` | bool | impulse + zipper critical (T2) | Dynamics — transient designer |
| `isDeEsser` | bool | near-Nyquist + SC filter rule (T2/T3) | Dynamics — de-esser |
| `isRingMod` | bool | near-critical aliasing / ring_mod rule (T2 critical) | Modulation — ring mod |
| `isRotary` | bool | LFO+filter+delay triad gate (T3/T4) | Modulation — rotary / Leslie |
| `isConvolver` | bool | SR matrix (T4) + series-identity (T4) | Convolver / IR |
| `isAmpSim` | bool | compounding aliasing (T4, OS×stages) | Amp sim (multi-stage) |
| `isPassThrough` | bool | bit-match Mix null expectation (T1) | Utility pass-through |

### Naming reconciliation

- `hasTruePeak` (in generator today) vs `isTruePeak` (tempting name): **keep `hasTruePeak`.** The flag describes a capability (has a true-peak detector) not an identity. Same reasoning will apply to any future `has*` vs `is*` conflict.
- `isClipper` is an identity (the plugin IS a clipper, hard or soft). Keep `is*` there.
- Rule of thumb: `has*` = a stage or detector inside; `is*` = the whole plugin's classification.

---

## 4. Cross-flag interactions

A few flag combinations trigger combined rules, not just the sum of
individual rules:

| Combination | Triggers |
|---|---|
| `nonlinearStages > 0` + `hasFeedback` | character-family + FB-runaway both fire — stability of NL-in-FB loop |
| `hasFreeze` + `hasPitchDetector` | shimmer family — FB-runaway + freeze + pitch-lock all must be safe |
| `hasVariableClockRate` + `nonlinearStages > 0` | BBD / tape echo — rolling OS + SR matrix critical |
| `isClipper='hard'` + `osThresholds=[]` | SHOULD WARN at declaration — hard clipper with no declared OS thresholds is usually a bug |
| `latencySamples > 0` + `!hasLookahead` | likely a mis-declaration — lookahead is the common cause of latency |

Not all of these are implemented yet; listed here so the generator
audit (task #3) can spec the combined-gates explicitly.

---

## 5. What gets declared on ManChild today

Reference example — the only plugin fully gated through the family map
as of 2026-04-20.

```js
capabilities: {
  nonlinearStages: 2,
  dryLegHasColoration: true,
  compressorTopology: 'vari-mu',
  hasFeedback: true,        // TC detector FB
  hasSidechain: true,       // per-channel SC gate
  modes: ['LINK','IND','M-S','MSL'],
  // no hasFreeze, no hasFFT, no hasWDF, no hasPitchDetector, etc.
}
```

When a new plugin lands, copy this block and delete / change only what
doesn't match. Do not add undeclared flags.

---

## 6. Revision history

- **2026-04-20 v1.0** — Glossary derived from `qc_family_map.md` v1.0.
