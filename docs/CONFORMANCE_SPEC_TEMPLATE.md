# DSP Conformance Spec — Template

> One of these lives next to every plugin's engine file, as
> `src/<plugin>/CONFORMANCE.md`. It is the contract the DSP is measured
> against. Without it, "correct" has no definition and the harness has
> no targets.
>
> **Rule:** no plugin is considered conformant — and no legacy → V1 port
> is considered done — until the Phase B review against this spec passes
> and the harness can check its measurable targets.

---

## 0. Header

- **productId:** `<snake_case, matches migration registry>`
- **variantId:** `legacy` | `engine_v1` | `engine_v2` …
- **spec version:** `1.0.0` (bump on any behavior change)
- **last reviewed:** `YYYY-MM-DD`
- **reviewer:** `<name or session id>`

---

## 1. Archetype Declaration

One sentence in the language of the *Audio Engineer Mental Model*. State
what this plugin **is**, what analog lineage (if any) it descends from,
which of the six systems it belongs to, and its dominant behavior
profile.

> *Example — ManChild: vari-mu stereo bus compressor, Fairchild 670M
> lineage, Dynamics system, glue + tone behavior profile.*

---

## 2. Reference Anchors

Explicit citations from the memory base. Every claim the spec makes
about "correct" behavior must trace to one of these. No anchor → no
claim.

| Anchor ID | Source | Section | Used for |
|-----------|--------|---------|----------|
| R1 | DAFX (Zölzer 2011) | Ch. X.Y | <what aspect> |
| R2 | PASP (JOS) | <chapter> | <what aspect> |
| R3 | `audio_engineer_mental_model.md` | <profile> | <what aspect> |
| R4 | `<plugin-specific memory file>` | — | <what aspect> |

Use the anchor IDs (R1, R2…) in the Topology and Parameter tables below.

---

## 3. Topology Contract

The signal chain, ordered. Each node gets a one-line rationale and the
anchor that justifies its presence/placement.

```
input → <node 1> → <node 2> → … → output
```

| # | Node | Purpose | Anchor |
|---|------|---------|--------|
| 1 | <name> | <why it's here, why in this position> | R# |
| 2 | … | … | R# |

Call out any deliberately unusual ordering (e.g., comp-into-tube,
sidechain HPF position, pre/post-oversampling boundary).

---

## 4. Parameter Contract

One row per **public setter**. This table is the source of truth for
`paramSchema`. Any setter in the engine that is not in this table is a
violation; any row here that has no setter is a violation.

| Setter | Range | Default | Unit | Kind | Audible effect | Anchor |
|--------|-------|---------|------|------|----------------|--------|
| `setX` | 0 – 1 | 0.5 | norm | unit | <what the user hears> | R# |
| …      |       |     |      |      |                       |     |

**Kind** matches `paramSchema` kinds: `unit | gain | db | hz | bool | enum | preset | noop | float`.

**Macro setters** (e.g. `setCharacter`, `applyPreset`) are listed
separately — see section 5.

---

## 5. Macro Setters

Setters that write more than one DSP node at once. Each must declare:

- which underlying params it drives
- whether it writes *authoritative* state (and calls the recomputer) or
  routes through public setters
- its presets/enum members

> **Governing rule (DEV_RULES D2):** macro setters either route through
> the public setters of this plugin *or* write authoritative state and
> call the recomputer. They never write dead mirror vars. *(This is the
> class of bug that ate Lofi Loofy's `_toneLPBase` sync.)*

---

## 6. Measurable Conformance Targets

Numeric expectations the harness can auto-check. Each target names a
metric, a test condition, and a tolerance. If the harness can't check
it, either instrument the harness or move the claim to section 8.

| ID | Condition | Metric | Expected | Tolerance | Anchor |
|----|-----------|--------|----------|-----------|--------|
| M1 | Bypass on, pink noise -18 dBFS | null-test residual | < −90 dB | — | — |
| M2 | `setDrive(0.7)`, sine @ 1 kHz -12 dBFS | H2/H3 ratio | > 2 | — | R# |
| M3 | `setThreshold(-20 dB)`, input -10 dBFS pink | GR | 4 dB | ±1 dB | R# |
| M4 | `setAttack(tc=3)` | attack time-constant | 0.2 ms → 800 ms per 670 spec | ±10% | R# |
| …  |           |        |          |           |     |

Measurable targets drive the Phase C sweep. Every row here is a check
the harness must be able to evaluate from a QC snapshot.

---

## 7. UI-Isolation Conformance

This is universal (see `UI_ISOLATION_RULES.md`) but each spec declares:

- **Public setter surface:** the exact list of methods React is allowed
  to call on the engine.
- **Observer surface:** the exact list of read-only getters React uses
  for metering (`getState`, `getGrDbA`, `getGrDbB`, …).
- **Any deliberate exceptions:** none expected; if you need one, justify
  it here with a reference.

---

## 8. Non-Goals / Known Deviations

Things this plugin **deliberately does not model**, or where V1
knowingly departs from legacy/hardware. Document the reason so a future
reviewer doesn't "fix" it.

- e.g. *"Only models 670 time-constant 3; constants 1, 2, 4, 5, 6 are
  out of scope for v1."*
- e.g. *"V1 does not attempt to match legacy Panther Buss attack
  envelope below 0.3 ms — DAFX Ch.4 analysis showed legacy value was a
  bug, not a feature."*

---

## 9. Change Log

| Date | Spec version | Change | Reviewer |
|------|--------------|--------|----------|
| YYYY-MM-DD | 1.0.0 | Initial | — |

---

## Review checklist (Phase B)

When reviewing an engine against this spec:

- [ ] Archetype matches what the engine actually is.
- [ ] Every reference anchor is actually cited in the engine (comment or
      structure) and the DSP matches it.
- [ ] Signal chain in code matches section 3 exactly.
- [ ] Every row in section 4 has a corresponding public setter + matching
      `paramSchema` entry + correct default.
- [ ] Every setter in the engine has a row in section 4.
- [ ] Macro setters comply with DEV_RULES D2 (section 5).
- [ ] All measurable targets in section 6 are wired into the harness.
- [ ] `getState()` exposes every live AudioParam consulted by any target.
- [ ] UI-isolation surface (section 7) matches the actual JSX imports.
- [ ] No deviation without a section 8 entry.

Pass = all ticked. Anything unticked blocks the conformance sign-off.
