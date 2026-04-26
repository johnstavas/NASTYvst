# Sandbox Op Ship Protocol

**Status:** BINDING as of 2026-04-23. Applies to every op shipped to the
sandbox catalog (`src/sandbox/ops/`).

**Why this exists.** On 2026-04-23 the fdnCore (#20) op shipped with a
DSP ordering bug (shelf-before-Householder instead of Householder-before-
shelf, missing ±1.8 safety clamp). The divergence from the proven shipped
path in `src/morphReverbEngine.js` was only found *after* the user pushed
back. Root cause: worked off a memory-file summary instead of consulting
primary sources (repo reference code + canonical papers). This protocol
prevents that.

---

## The rule

**Memory files are pointers, not sources.** Every op ship requires
consulting at least one primary source. If no primary source is
accessible, that fact is declared before shipping, not after.

---

## Pre-ship research checklist (mandatory)

Run through this list BEFORE writing any `.worklet.js` / `.cpp.jinja` /
`.test.js` for a new op. Do not skip steps silently.

### 1. Orient
- Read the canonical memory file(s) for the op's family (e.g.
  `reverb_engine_architecture.md`, `jos_pasp_dsp_reference.md`,
  `dsp_code_canon_*.md`). Note citations and expected canonical form.

### 2. Find primary sources (at least one of)
- **Repo reference code.** Search `src/**/*.js` for any proven shipped
  implementation of this DSP. Examples:
  - fdnCore → `src/morphReverbEngine.js` (morphreverb-v6)
  - reverb-family → `src/reverbBusEngine.js`, `src/gravityEngine.js`,
    `src/freezefieldEngine.js`
  - drum/bus → `src/nastybeast/nastyBeastEngine.worklet.js`
  - Others: check via `Glob src/**/*Engine*.js` and grep for the family.
- **Canon code blocks.** If memo cites `Canon:<topic> §N`, open the
  canon file and read the §N code block — not just the summary line in
  the parent memo.
- **Book passages.** If memo cites Zölzer / JOS / Chamberlin by section,
  locate the passage in the corresponding reference memory
  (`dafx_zolzer_textbook.md`, `jos_pasp_dsp_reference.md`, etc.).
- **External papers.** If the only citation is an external paper
  (e.g. "Jot-Chaigne 1991"), either (a) WebFetch it, (b) find a
  canonical reimplementation, or (c) **flag it as unresearched-upstream
  in the research-debt ledger at ship time**. Never silently drop a
  citation.

### 3. Write op against the primary source
- Code the op from what the primary source actually says.
- If there's repo reference code, **mirror its DSP ordering and
  numerical choices unless you have a specific reason to deviate**.
- Keep a running list of the primary sources you consulted.

### 4. Diff against reference
- Open the proven repo engine side-by-side with your new op.
- Specifically verify: per-sample loop order, signal-path topology,
  safety clamps, denormal handling, coefficient formulas, state
  variables, reset semantics.
- Any divergence is either justified or fixed — never accidental.

### 5. Test + QC
- Math tests (`node scripts/check_op_math.mjs`)
- Golden bless (`node scripts/check_op_goldens.mjs --bless`)
- Full 8-gate QC rack (`npm run qc:all`)

#### 5.1 Test-coverage rule (binding 2026-04-26)

**Reason it exists.** #166 srcResampler shipped 2026-04-26 with 14 math
tests and a clean ⬜→✅+P flip — but the 14 tests didn't cover
block-boundary invariance, long-run stability, or fractional-phase
kernel exercise. A 12-test stress sweep added immediately after surfaced
one conceptual bug (the "stopband at speed=1" test was wrong because
the kernel collapses to identity at integer phase). A foundation op
slipping through with weak coverage would have polluted every
downstream pitch / varispeed op. This rule makes the coverage explicit.

**Test-count target by op class:**

| Op class | Target | Examples |
|---|---|---|
| **Foundation / structural** | 20–30 tests | srcResampler, FFT/IFFT, STFT, FDN core, polyphase OS, granularBuffer, convolution, scattering junctions |
| **Named-gear character** | 15–20 tests | xformerSat, korg35, diodeLadder, varMuTube, blackmerVCA, optoCell, pultecEQ |
| **Composable atoms** | 10–15 tests | saturate, softLimit, hardClip, biquads, allpass, single-band EQ |
| **Pure utility** | 5–8 tests | gain, abs, sign, clamp, polarity, scaleBy, mix |
| **Neural / ML** | 10–15 tolerance-based tests | crepe, future RNN amp sims |

**Mandatory categories — apply to ALL ops in the relevant class:**

For **any op with internal state** (delay-line, filter, oscillator,
reverb, dynamics, foundation):

1. **Block-boundary invariance.** Same input through op with N=64 / 256 /
   1024 produces bit-identical output (within float32 precision). This
   is THE most common DSP-state bug; if absent, drift between block
   boundaries goes undetected.
2. **Long-run stability.** Run ≥ 1 second of audio through op at typical
   params. Output stays finite (no NaN / inf), no DC creep > 1e-3, RMS
   drift < 1% over the full duration.
3. **Determinism / multi-instance isolation.** N parallel ops with
   identical params + identical inputs produce bit-identical outputs.
   Implies internal state is per-instance, not shared.
4. **Reset semantics.** After a long warm-up + reset, second run from
   the SAME inputs produces bit-identical output to a fresh op.
5. **Param boundary / NaN-Inf clamping.** All params clamped to declared
   range. NaN / ±Infinity setParam values do not propagate to output.

For **filters / EQ / resamplers / anti-alias**:

6. **Frequency response — passband flatness.** Pure tones at multiple
   frequencies in declared passband measure unity gain ± declared
   tolerance.
7. **Aliasing / stopband / transition band** characterization
   appropriate to the op (e.g., for a low-pass at fc=1 kHz: gain at
   2 kHz must be ≥ X dB attenuated). Skip if op has no filtering claim.

For **named-gear character** (xformerSat, pultec, varMuTube, etc.):

8. **Named-gear claim verification.** Each fidelity claim in the op's
   primary citation gets a dedicated test (e.g., xformerSat's 6 dB/oct
   LF onset, Pultec's 2nd > 3rd > 4th harmonic ratio, voiceCoilCompression's
   level-dependent gain reduction). Tests fail if the model deviates
   from the citation.

For **ops with feedback / recursion** (reverbs, delay loops, recursive
filters, FDN, allpass cascades):

9. **Stability under maximal feedback.** Op stays bounded for ≥ 10 sec
   of audio at maximum feedback / Q / regen setting. No FB runaway.
10. **Denormal flush.** After signal stops, internal state collapses to
    zero within declared decay time (no denormal hang).

For **ops with declared latency** (lookahead limiters, FFT-frame ops):

11. **Latency reporting correctness.** `getLatencySamples()` returns
    a value matching the actual measured input-to-output delay (within
    1 sample).

For **stereo / multichannel ops**:

12. **Stereo isolation.** Per-channel state is independent. Ch0 input
    does not leak into Ch1 output (and vice versa). See `qc:stereo`
    harness for the full check.

**Naming convention.** Stress-tests get a `STRESS:` prefix in the test
name (e.g. `'STRESS: block-boundary invariance — N=64/256/1024'`) so
reviewers can grep them quickly. The base op-correctness tests have no
prefix.

**Where to put new categories.** When a stress-test category is added
to this rule, also add it to `qc_capability_flags.md` (if it's
flag-gated) and to `qc_family_map.md` (if it's family-specific).

#### 5.2 Coverage backfill policy (existing 125 ops in catalog)

**Important framing.** The 125 ops in the sandbox catalog have **never
been used in a shipped plugin.** ManChild and Lofi Loofy are
pre-sandbox, hand-coded plugins that do not depend on the sandbox
op infrastructure — they validate the *plugin shell* (UI, capability
flags, ManChild lessons), not the sandbox ops. Production-grade bug
discovery on the sandbox ops will only happen when the first
sandbox-built plugin ships.

This means: **the test harness IS the only validation** for the 125
ops. Test-coverage gaps directly translate to undetected bug risk.

**That changes the backfill calculus.** The original "production has
already validated these" argument is invalid. Backfill is more
important than a "things are working in the field" assumption would
suggest.

**Recommended policy — tiered backfill, no blanket sweep:**

The reason it's still tiered (not blanket) is **op triviality**, not
production validation:
- Pure utility ops (gain, abs, sign, clamp, polarity, scaleBy, mix)
  are mathematically trivial; their state is zero or one variable;
  20-test sweeps don't add information beyond the existing 5–8 tests.
- Foundation, stateful, and feedback ops have meaningful state and
  meaningful failure modes; they DO need the stress sweep.

**Tier 1 — Foundation / structural (~11 ops). HIGH priority backfill.**
`fft`, `ifft`, `stft`, `istft`, `convolution`, `phaseVocoder`,
`oversample2x`, `polyBLEP`, `minBLEP`, `granularBuffer`, `fdnCore`.
Target: 20+ tests including block-invariance + long-run + determinism +
reset. Effort: ~2–3 days focused.

**Tier 2 — Stateful filters with feedback (~8 ops). HIGH priority.**
`ladder`, `korg35`, `diodeLadder`, `svf`, `allpass`, `comb`, `delay`,
`bbdDelay`. Target: 15+ tests with block-invariance + long-run +
stability under feedback.

**Tier 3 — Reverbs (~5 ops). HIGH priority.**
`plate`, `spring`, `schroederChain`, `ER`, `SDN`. Target: 15+ tests
with feedback stability + denormal flush + long-run.

**Tier 4 — Character / saturation ops (~12 ops). MEDIUM priority.**
`saturate`, `softLimit`, `hardClip`, `wavefolder`, `diodeClipper`,
`chebyshevWS`, `tubeSim`, `tape`, `xformerSat` (already 18 tests),
`bitcrush`, `noiseShaper`, `dither`. Target: 12+ tests with
block-invariance (the ones with state) + named-gear claim verification
(the ones with citations).

**Tier 5 — Pure utility ops (~30 ops). DO NOT BACKFILL** unless a
bug surfaces. `gain`, `abs`, `sign`, `clamp`, `polarity`, `scaleBy`,
`mix`, `slew`, `smooth`, `dcBlock`, etc. Existing 5–8 tests each are
appropriate to the trivial state.

**Tier 6 — Synth oscillators (~10 ops). MEDIUM priority.**
`sineOsc`, `blit`, `osc`, `wavetable`, `padSynth`, `dsf`, `karplusStrong`,
etc. Block-invariance + long-run drift are real risks for oscillators.

**All other ops** (analysis, dynamics, modulation, noise, spatial)
get the new rule applied **opportunistically** — when next touched
for v2 upgrade, bug fix, or extension.

**Trigger to force-backfill an op** outside its tier priority: any
downstream bug, unexpected behavior, or sandbox-graph integration
issue traces back to that op having weak coverage. Then the backfill
becomes part of the fix, not a separate project.

**First sandbox-built plugin ship is the natural deadline** for
Tier 1+2+3 backfill — once a plugin actually depends on the sandbox
ops, undetected bugs become production blockers. Schedule the
foundation backfill before that ship date.



### 6. Native parity (added 2026-04-25, Phase 4 closure)
- Add op entry to `test/fixtures/parity/per_op_specs.json` (declare
  tolerance per § 5.4 of `codegen_pipeline_buildout.md`: -90 dB default,
  -120 dB for nonlinear/ADAA, cents-pinned for neural).
- Build smoke VST3 via `node src/sandbox/codegen/build_native.mjs`.
- Run `npm run qc:parity --op <opId>` → must be PASS at declared
  tolerance.
- Update `per_op_specs.json` vst3 path to the just-built suffix.
- Op cannot flip ✅ in `sandbox_ops_catalog.md` until parity is green.
  See `ship_blockers.md` § 8 (Native Parity gate).

### 7. Ship summary (in the chat message where you report the ship)
- **Primary sources consulted** — named explicitly (file paths or
  citations with §).
- **Diff summary vs. reference** — what matched, what you deviated on
  and why, what was new (not in reference).
- **If no primary source was available** — declare it upfront with the
  reason, and auto-log a row in `sandbox_ops_research_debt.md`.
- **Update `STATUS.md`** at repo root: prune the shipped op from "Next
  ops", add it to "Just landed", refresh the date, log any new drift
  found during the ship under "Open drifts". The ship is not complete
  until `STATUS.md` reflects it.

---

## Anti-patterns (things this protocol explicitly forbids)

- **"The memo says X"** as the only authority. Memo summarises; it can
  drift or lose nuance. Always walk back to the primary.
- **Write-then-verify.** Shipping first and auditing later. The audit
  must happen *before* the ship message lands.
- **Silent citation drop.** If a memo cites a paper and you can't
  access it, you say so. You don't just code against the summary and
  call it good.
- **Default-only golden coverage.** The 128-sample golden harness
  misses DSP ordering bugs when delays haven't wrapped. When a new op
  has internal state > 128 samples (any delay line op, reverb,
  waveguide, etc.), note that the golden doesn't fully cover it, and
  lean harder on math tests to exercise the full feedback loop.

---

## Enforcement

This protocol lives in the auto-load memory set (registered in
`MEMORY.md`). Every new op turn starts with a read of the current
canonical op family memo PLUS this file. If the ship summary at the
end of a turn doesn't contain a "Primary sources consulted" block,
the ship is not valid — it's an audit-pending draft that needs to go
through the checklist before flipping ✅ in the catalog.

## Family-specific rules

### Synthesis family (#79–#98)

Picked up on 2026-04-24 after #79 sineOsc was mis-attributed as
"Gordon–Smith" when it was actually JOS's Direct-Form Resonator (DFR).
The lesson:

- **Before shipping ANY digital sinusoid / oscillator op, open**
  `https://ccrma.stanford.edu/~jos/pasp/Digital_Sinusoid_Generators.html`
  **first.** JOS enumerates three distinct methods on one page:
  1. Direct-Form Resonator (DFR) — the biquad with poles on unit circle.
     Shipped as #79 sineOsc.
  2. 2D rotation (rotation matrix applied each sample) — not yet shipped.
  3. Coupled form (Gordon & Smith 1985, a.k.a. "magic circle" / Mathews) —
     not yet shipped. This is the op that actually *deserves* the
     "Gordon–Smith" label.
  Each deserves its own op slot. Do not conflate them in attribution.
- **Before shipping any BL-oscillator op (blit, minBLEP, polyBLEP,
  wavetable with AA), open primary too** — Stilson & Smith 1996 (BLIT),
  Brandt 2001 (MinBLEP), Välimäki 2007 (polyBLEP). The Canon entries
  (§2, §13) are pointers; open the papers or equivalent reference
  implementations.
- **For physical-model ops (#85 karplusStrong shipped, #86+ waveguides /
  modal / FDTD pending):** pair JOS PASP page + either the original
  paper OR a working reference repo. One source is not enough for
  physical models; their parameter ranges and stability conditions are
  publication-specific.
- **For FM / additive / PAD / wavetable:** cite the concrete paper
  (Chowning 1973 for FM; Verplank 2001 for PAD; etc.), not "synthesis
  canon §N" as a summary.

The synth family is the broadest on the catalog and the easiest to
mis-attribute across variants. Two primaries minimum per op ship for
anything in the #79–#98 range unless explicitly a math-by-definition
primitive (e.g., a pure DC source).

### Neural / ML ops (#78 crepe, #119–#122 reserved Stage E)

Neural ops break the `worklet ≡ cpp.jinja` bit-for-bit-mirror assumption
that the rest of this protocol depends on. Two reasons:

1. **The "code" of an ML op is not code.** It's a published architecture
   (paper § with layer counts, kernel sizes, activation choices) plus a
   pretrained weights file. Verbatim port of a Python/Keras training
   script is meaningless and would copy framework idiosyncrasies, not
   the published model.
2. **Inference runtime asymmetry between worklet and native.** ORT-Web
   does not run cleanly inside an `AudioWorkletGlobalScope` (microsoft/
   onnxruntime#13072 — `self`/CPU-backend assumptions in the WASM bundle
   start no inference session). Production pattern: inference runs on
   the **main thread** (or a SharedArrayBuffer Worker), the worklet
   ships frames out via `port.postMessage` and receives results back
   as parameter updates. Native (C++) plugins run ORT-native inline,
   no roundtrip needed. The two paths are functionally equivalent but
   not topologically identical.

#### Neural Op Exception clause (binding)

For any op declared `kind: 'neural'` in the registry:

- **Primary-source consult requires THREE artifacts**, all named in the
  ship summary:
  1. **Architecture primary** — the paper § (or technical report) that
     specifies layer topology, input/output shapes, training data, and
     decoding formula. Not optional. Math-by-definition is forbidden
     for neural ops; the architecture must be cited from a published
     source.
  2. **Weights primary** — the authoritative repo / release that
     publishes the pretrained weights, with permissive license verified
     (MIT / Apache-2.0 / BSD). Either the originating author's repo or a
     widely-cited mirror that documents its conversion source.
  3. **Inference reference** — at least one shipping implementation
     (Python / C++ / web) used as the canonical decoding reference.
     Verifies that the published architecture + weights actually decode
     to the documented output range.

- **Worklet/native asymmetry must be documented in the worklet header.**
  State explicitly that the JS path runs inference off-worklet (main-
  thread or Worker) and the C++ path runs inline. This is a deliberate
  divergence, not a port bug.

- **Math tests, not golden hashes.** Neural inference is not bit-
  identical across hardware (SIMD instruction set, FP rounding, ORT
  build flags all perturb output by ~1e-5–1e-6 relative). The
  golden-hash harness must skip declared neural ops; verification is
  via tolerance-based math tests against synthesized inputs (e.g.,
  440 Hz sine → F0 = 440 ± 5¢ with confidence > 0.9).

- **Two-stage ship.** Stage 1 lands the architectural foundation
  (registry stub with `kind: 'neural'`, MessagePort protocol design,
  worklet shim with mocked inference, golden-harness skip-list, full
  primary-source citations). Stage 2 lands working inference (host-side
  runner, weights bundle, real math-tests). Catalog status: Stage 1 →
  🚧, Stage 2 → ✅. Both stages walk through the standard 7-step
  checklist; the exception only relaxes the bit-for-bit-mirror and
  golden-hash rules.

- **Weights file logistics.** Pretrained weights live in
  `.shagsplug/models/<opId>.onnx` (codegen_design.md §12). Sandbox
  loads from `/models/<opId>.onnx` relative to the sandbox bundle; the
  C++ build wires the same `.onnx` as a binary plugin resource via
  CMake (codegen_design.md §12).

- **Runtime selection.** Stage E uses **ONNX Runtime** for both
  paths — ORT-Web (1.16+, ~1.5 MB WASM, MIT license) for the sandbox /
  WAM, ORT-native (C++, MIT license) for VST/AU. Single `.onnx` file
  shared. No per-op runtime decision; that lock is made once at the
  tier level.

This clause was authored 2026-04-24 alongside the #78 crepe Stage 1
ship as the first concrete neural op. Future neural ops (#119–#122)
inherit it without reauthoring.

## Authorized second-primary source archives (local)

When a WebFetch primary fails or a second primary is needed, prefer
code from these local archives over ad-hoc search results. Paste
file path + line range in chat per Step 1 rules.

- **SuperCollider Book, 2nd ed. — code archive.**
  `C:\Users\HEAT2\Downloads\dokumen.pub_the-supercollider-book-second-edition-2\scbookcode-2.0\`
  Chapter mapping to op families:
  - `Ch 2 The Unit Generator/` — UGen architecture, rate conventions
    (audio/control/demand). Use for port-kind sanity checks.
  - `Ch 15 Machine Listening in SuperCollider/` — onset (#69), BPM
    (#70), pitch-family cross-checks (#71/#71a/#71b).
  - `Ch 16 Microsound/` — granular / windowed synthesis; reserved
    synth-family slots when they land.
  - `Ch 25 Machine Learning in SuperCollider/` — gated by ML-runtime
    debt; relevant when CREPE-family pitch is revisited.
  - `Ch 29 Writing Unit Generator Plug-ins/` — canonical C++ UGen
    examples (Flanger_1/2, LPFrates, Reverb1). Second-primary grade
    for any op shipped off a named SC UGen.
  - Raw server sources (`OscUGens.cpp`, `DelayUGens.cpp`, etc.) on
    github remain first-primary for UGen ports.

Chapters 1, 3, 5–8, 12–13, 18–23, 26–27 are language / composition
material — not useful as DSP primaries; skip.

## Related

- `sandbox_ops_research_debt.md` — ledger of known-better research not
  yet ingested. Auto-log a row here whenever a primary source is
  inaccessible at ship time.
- `sandbox_ops_catalog.md` — the ledger flip ⬜→✅ only happens after
  the checklist is run.
