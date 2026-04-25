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

### 6. Ship summary (in the chat message where you report the ship)
- **Primary sources consulted** — named explicitly (file paths or
  citations with §).
- **Diff summary vs. reference** — what matched, what you deviated on
  and why, what was new (not in reference).
- **If no primary source was available** — declare it upfront with the
  reason, and auto-log a row in `sandbox_ops_research_debt.md`.

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
