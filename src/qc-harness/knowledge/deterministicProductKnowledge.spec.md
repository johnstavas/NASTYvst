# Deterministic Product Knowledge Spec v1

## Purpose

`deterministicProductKnowledge.json` is the static teaching layer for QC repair findings.

It converts a resolved `knowledgeId` into musician-facing guidance:

```text
what the user hears
what the repair changes
what the tradeoff is
what the safer fix is
what to listen for
whether the sound can be kept intentionally
```

This system must run without an LLM at product runtime. The same finding should resolve to the same lesson every time.

## Runtime Flow

```text
QC rule fires
finding gets ruleId and measured facts
RULE_META supplies default knowledgeId
userFix override may refine knowledgeId
finding stores resolved knowledgeId and knowledgeSource
UI looks up exact card by knowledgeId
UI renders Ear Lesson beside the active repair
user fixes, keeps, or defers according to rule/card safety gates
user verifies with control, section, or full-plugin QC
```

## Schema

Required card fields:

```json
{
  "knowledgeId": "level.output_louder_than_input",
  "title": "Output jumps up",
  "riskLevel": "review_recommended",
  "whatYouHear": "The plugin sounds better partly because it gets louder.",
  "fix": "Lower the output until the processed signal feels level-matched with the input."
}
```

Recommended full card shape:

```json
{
  "knowledgeId": "family.slug",
  "title": "Human-readable lesson title",
  "pluginFamilies": ["Dynamics", "Hybrid"],
  "repairFamily": "Level",
  "typicalControls": ["OUT", "Output Trim"],
  "riskLevel": "safe_creative | review_recommended | strong_warning | must_fix",
  "canKeepIntentional": true,
  "whatYouHear": "What the user may hear.",
  "whatThisChanges": "Plain-language explanation of the affected sound/control/path.",
  "tradeoff": "The musical choice being made.",
  "fix": "Safer or standard repair direction.",
  "creativeKeep": "When this can be a valid artistic choice.",
  "listenFor": "What source or behavior to audition.",
  "keepConfirmCopy": "Confirmation copy shown before keeping, or null.",
  "mustFixIf": ["optional hard safety conditions"],
  "sourcePack": "v1 | v3"
}
```

## Safety Behavior

`riskLevel === "must_fix"` must always force:

```json
{
  "canKeepIntentional": false
}
```

This is enforced in the generated JSON at write time.

Rule-level safety wins over card-level safety:

```text
RULE_META.<rule>.allowsCreativeKeep = false
```

If a rule disallows creative keep, the UI must hide or disable the keep path even if the card is otherwise creative.

## Risk Levels

`safe_creative` means the sound is probably safe to keep if intentional.

`review_recommended` means the user may keep it after reading the tradeoff.

`strong_warning` means the user may keep only with stronger confirmation, unless the rule overrides keep eligibility.

`must_fix` means the user cannot keep it for release.

## UI/UX Contract

The repair UI should show one active finding at a time.

The active screen should include:

```text
current issue
Ear Lesson
highlighted control or builder surface
repair gesture
save/apply step
verification controls
optional advanced/details drawer
```

The Ear Lesson should show:

```text
title
risk chip
whatYouHear
whatThisChanges
tradeoff
listenFor
```

The primary repair copy should stay music-first. Technical details belong in an advanced drawer.

## Lookup Rules

The active lesson must be resolved by exact ID only:

```text
finding.knowledgeId -> knowledgeCards[knowledgeId]
```

Do not fuzzy-match the active lesson.

If the exact card is missing, show a schema-gap state:

```text
No Ear Lesson mapped yet.
```

Fuzzy matching may be used only for related cards and searchable drawer results.

## Finding Fields

Resolved findings should carry:

```json
{
  "knowledgeId": "dynamics.release_too_fast_pumping",
  "knowledgeSource": "rule | override | fallback"
}
```

`knowledgeSource` is for traceability and debugging.

## Knowledge Pack Placement

Canonical app-ready file:

```text
src/qc-harness/knowledge/deterministicProductKnowledge.json
```

This file is flat. It does not use `extends`.

`familiesCovered` is intentionally omitted and should be derived at load time.

## Capability Bridge

Analyzer capabilities and knowledge families are different vocabularies.

Add a bridge:

```text
src/qc-harness/knowledge/capabilityToFamily.js
```

Purpose:

```text
capabilityId / analyzer facts -> pluginFamilies
```

Use this for related-card drawer filtering only. Do not use it to choose the active Ear Lesson.

## ManChild Hot Path

Port these first:

```text
level.output_louder_than_input
stereo.link_unstable_center
dynamics.release_too_fast_pumping
dynamics.attack_too_fast_flattened_punch
dynamics.sidechain_low_end_overreacts
color.drive_too_dirty_default
```

These should be treated as high-quality active-path lessons. The rest of the knowledge pack can remain searchable learning content until more rules are mapped.

## Validation

Current clean pack:

```text
schemaVersion: deterministic-product-knowledge/v1
cards: 181
dropped cards: 0
collisions: 18, v3 won
must_fix keep violations: 0
missing required fields: 0
old field names remaining: 0
```
