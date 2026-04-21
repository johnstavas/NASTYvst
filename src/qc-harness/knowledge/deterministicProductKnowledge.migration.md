# Deterministic Product Knowledge Migration Note

## Output

`src/qc-harness/knowledge/deterministicProductKnowledge.json`

## Summary

- Schema version: `deterministic-product-knowledge/v1`
- Source cards: 41 from v1, 158 from v3
- Final cards: 181
- Merge policy: merge by `knowledgeId`; v3 wins on collision
- Dropped pack-level fields: `extends`, `familiesCovered`
- Safety enforcement: `riskLevel === must_fix` forces `canKeepIntentional: false` during write

## Field Renames

- `displayName` -> `title`
- `whatThisControlDoes` -> `whatThisChanges`
- `standardFix` -> `fix`
- `recommendedListeningTarget` -> `listenFor`
- `creativeKeepExplanation` -> `creativeKeep`
- `keepConfirmation` -> `keepConfirmCopy`

## Collisions

- dynamics.attack_too_fast_flattened_punch: v1 replaced by v3
- dynamics.attack_too_slow_peaks_escape: v1 replaced by v3
- dynamics.release_too_fast_pumping: v1 replaced by v3
- dynamics.release_too_slow_over_holding: v1 replaced by v3
- delay.feedback_runaway: v1 replaced by v3
- delay.tempo_sync_wrong: v1 replaced by v3
- reverb.tail_builds_unstable: v1 replaced by v3
- reverb.low_end_boom: v1 replaced by v3
- eq.resonance_too_sharp: v1 replaced by v3
- eq.low_cut_too_high_thins_sound: v1 replaced by v3
- eq.high_cut_too_low_dulls_sound: v1 replaced by v3
- mix.wet_dry_not_fully_dry: v1 replaced by v3
- mix.parallel_comb_filtering_mid_mix: v1 replaced by v3
- stereo.link_unstable_center: v1 replaced by v3
- routing.channel_swap: v1 replaced by v3
- routing.latency_added_unexpected: v1 replaced by v3
- safety.nan_or_infinite_output: v1 replaced by v3
- ui.default_knob_position_misleading: v1 replaced by v3

## Dropped Cards

- None

## Counts

- By source after merge: v3=158, v1=23
- By risk: strong_warning=31, safe_creative=45, review_recommended=78, must_fix=27

## Validation

Every card was validated for required fields: `knowledgeId`, `title`, `riskLevel`, `whatYouHear`, and `fix`. No validation errors were found.
