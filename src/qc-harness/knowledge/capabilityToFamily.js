// src/qc-harness/knowledge/capabilityToFamily.js
//
// Knowledge Phase A.3 — capability/analyzer-fact → pluginFamily[] bridge.
//
// WHY: capability flags (qcPresets' `hasFreeze`, `hasLPC`, etc.) and the
// knowledge pack's `pluginFamilies[]` vocabulary ("Dynamics", "Reverb",
// "Hybrid", "Amp", "Cabinet"...) are deliberately independent. The pack
// is written for musicians; capabilities are written for the engine.
// This module is the ONLY place they meet.
//
// SCOPE (strict, per spec):
//   ✅ Use for related-card drawer filtering: "show me every card that
//      applies to a Dynamics plugin".
//   ❌ Do NOT use this to choose the active Ear Lesson. The active
//      lesson is resolved by exact knowledgeId only (see spec.md:
//      Lookup Rules).
//
// If a capability isn't listed below, it simply doesn't contribute any
// family tags — callers fall back to showing all cards or using the
// plugin's declared pluginFamily directly.

/**
 * Static capability → family tags.
 * Keyed by the capability flag name qcPresets already uses.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const CAPABILITY_TO_FAMILY = Object.freeze({
  // Dynamics family
  hasSidechain:       ['Dynamics'],
  hasLookahead:       ['Dynamics', 'Limiter'],
  hasMultiband:       ['Dynamics', 'Multiband'],

  // Modulated / time
  hasFeedback:        ['Delay', 'Reverb', 'Feedback'],
  hasFreeze:          ['Reverb', 'Granular'],
  hasLFO:             ['Modulation'],

  // Spectral / analytic
  hasFFT:             ['Spectral'],
  hasLPC:             ['Spectral', 'Voice'],
  hasWDF:             ['Amp', 'Distortion', 'Hybrid'],
  hasPitchDetector:   ['Pitch', 'Voice'],
  hasTruePeak:        ['Limiter', 'Dynamics'],

  // Stereo
  hasStereoWidth:     ['Stereo'],
});

/**
 * Derive family tags from a plugin's capability object.
 * @param {object} capabilities — the plugin's declared capabilities (from engine factory).
 * @returns {string[]} sorted, deduped list of pluginFamily tags.
 */
export function familiesFromCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return [];
  const set = new Set();

  for (const [flag, fams] of Object.entries(CAPABILITY_TO_FAMILY)) {
    if (capabilities[flag]) {
      for (const f of fams) set.add(f);
    }
  }

  // Numeric capabilities
  if (typeof capabilities.oversampling === 'number' && capabilities.oversampling > 1) {
    set.add('Oversampled');
  }
  if (typeof capabilities.nonlinearStages === 'number' && capabilities.nonlinearStages > 0) {
    set.add('Distortion');
    set.add('Color');
  }
  if (typeof capabilities.latencySamples === 'number' && capabilities.latencySamples > 256) {
    set.add('Latency');
  }

  // String enum: feedbackMatrix
  if (typeof capabilities.feedbackMatrix === 'string' && capabilities.feedbackMatrix) {
    set.add('Reverb');
  }

  return [...set].sort();
}

/**
 * Extract family tags directly from a finding's measurement facts when
 * capabilities aren't available at the callsite. Intentionally minimal —
 * prefer capability-driven resolution.
 *
 * @param {object} measurements — snapshot.measurements-like object.
 * @returns {string[]} sorted, deduped list.
 */
export function familiesFromMeasurements(measurements) {
  if (!measurements || typeof measurements !== 'object') return [];
  const set = new Set();
  // Signal-derived: if a measurement family fired, tag its domain.
  if ('lpcPeakGrowthDb' in measurements) set.add('Voice');
  if ('wdfPeakDb' in measurements)       set.add('Amp');
  if ('fftFrameSnrDb' in measurements)   set.add('Spectral');
  if ('pitchIdleHz' in measurements)     set.add('Pitch');
  return [...set].sort();
}

export { CAPABILITY_TO_FAMILY };
