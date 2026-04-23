// src/qc-harness/knowledge/ruleKnowledgeMap.js
//
// Knowledge Phase A.2 — default ruleId → knowledgeId mapping.
//
// Resolution order for a finding's knowledgeId (per spec):
//
//   1. userFix override (per-plugin refinement, if any)
//   2. RULE_META default — supplied by this map
//   3. fallback (null → UI shows "No Ear Lesson mapped yet.")
//
// We keep this as a sidecar module rather than inlining into RULE_META so
// the teaching-layer vocabulary can evolve without RULE_META churn, and
// so a designer can audit the full mapping in one file.
//
// Rules that are diagnostic-only (pipeline internals, preset infra) map
// to null — they should never surface an Ear Lesson because they aren't
// something the musician did wrong.
//
// Hot-path cards (per spec.md "ManChild Hot Path" section) are starred
// in comments. These must resolve correctly before Phase B dogfood ships.

/** @type {Readonly<Record<string, string | null>>} */
export const RULE_KNOWLEDGE_MAP = Object.freeze({
  // ── Pipeline / diagnostic (no musician-facing lesson) ──────────────────
  snapshot_self_fail:       null,
  preset_not_found:         null,
  preset_not_applied:       'preset.recall_does_not_restore_state',
  variant_drift:            null,
  per_snapshot_warnings:    null,
  rule_threw:               null,

  // ── Metering / level ────────────────────────────────────────────────────
  gr_meter_stuck:           'dynamics.meter_does_not_match_sound',
  louder_than_input:        'level.output_louder_than_input',        // ★ HOT PATH
  loudness_comp:            'level.makeup_gain_overcompensates',
  peak_above_input:         'level.output_louder_than_input',        // ★ HOT PATH
  null_too_colored:         'bypass.bypass_changes_tone_unexpected',

  // ── Mix / wet-dry ───────────────────────────────────────────────────────
  mix_null:                 'mix.wet_dry_not_fully_dry',
  mix_null_series:          'mix.wet_dry_not_fully_dry',
  mix_identity:             'mix.wet_dry_not_fully_wet',
  mix_sanity:               'mix.wet_dry_not_fully_dry',
  fb_mix_coupling:          'feedback.module_loop_uncontrolled',

  // ── Mode / preset / automation ──────────────────────────────────────────
  mode_storm:               'random.preset_chaos_too_extreme',
  zipper:                   'filter.cutoff_zippers',

  // ── Bypass / impulse / reporting ────────────────────────────────────────
  impulse_ir:               'convolution.ir_has_silence_at_start',
  bypass_exact:             'bypass.bypass_changes_tone_unexpected',
  latency_report:           'oversampling.mode_changes_latency_unannounced',

  // ── Feedback / stability ────────────────────────────────────────────────
  feedback_runaway:         'delay.feedback_runaway',
  dc_rejection_fb:          'distortion.dc_offset_from_asymmetry',
  loop_filter_stability_root:'feedback.module_loop_uncontrolled',
  orthogonal_feedback:      'feedback.module_loop_uncontrolled',

  // ── Stereo / image ──────────────────────────────────────────────────────
  pathological_stereo:      'stereo.link_unstable_center',           // ★ HOT PATH
  monosum_null:             'mix.mono_collapse',

  // ── Extremes / safety ───────────────────────────────────────────────────
  extreme_freq:             'control.range_allows_unsafe_value',
  denormal_tail:            'safety.denormal_reverb_tail',
  sample_rate_matrix:       'safety.sample_rate_changes_tone',

  // ── T3 measurement rules ────────────────────────────────────────────────
  freeze_stability:         'reverb.tail_builds_unstable',
  sidechain_regime:         'dynamics.sidechain_low_end_overreacts', // ★ HOT PATH
  wdf_convergence:          'safety.nan_or_infinite_output',
  band_reconstruction:      'multiband.crossover_phase_dip',
  lpc_stability:            'safety.nan_or_infinite_output',
  fft_frame_phase:          'spectral.smearing_too_much',
  pitch_idle:               'pitch.tracking_glitches',
  bpm_detector_accuracy:    'tempo.auto_bpm_locks_to_wrong_multiple',

  // ── T4+ stubs (reserved mappings; bodies pending) ───────────────────────
  os_boundary:              'oversampling.mode_changes_latency_unannounced',
  series_identity:          'routing.latency_added_unexpected',
  long_session_drift:       'safety.memory_growth_tail',
});

/**
 * Resolve a ruleId to its default knowledgeId. Returns null for
 * diagnostic-only rules and unknown ruleIds.
 */
export function getDefaultKnowledgeIdForRule(ruleId) {
  if (typeof ruleId !== 'string' || !ruleId) return null;
  const v = RULE_KNOWLEDGE_MAP[ruleId];
  return v ?? null;
}

/**
 * List of ruleIds that intentionally have no Ear Lesson (diagnostic-only).
 * Useful for coverage reports — "why is this rule not mapped?" is answered
 * by "it's in this list on purpose."
 */
export const DIAGNOSTIC_ONLY_RULES = Object.freeze([
  'snapshot_self_fail',
  'preset_not_found',
  'variant_drift',
  'per_snapshot_warnings',
  'rule_threw',
]);
