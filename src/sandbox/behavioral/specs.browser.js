// specs.browser.js — browser-side aggregator of behavioral spec banks.
//
// Mirror of what scripts/check_behavioral.mjs does at the top — collect every
// op's declared behavior into one map keyed by opId. The .mjs spec files are
// pure JS so they import cleanly here.

import { CLUSTER_A_BEHAVIORAL } from './specs/cluster_a.mjs';
import {
  UTILITY_BEHAVIORAL, FILTER_BEHAVIORAL,
  DISTORTION_BEHAVIORAL, ANALYZER_BEHAVIORAL,
  ENVELOPE_BEHAVIORAL, GAINCURVE_BEHAVIORAL,
} from './specs/foundation.mjs';

export const ALL_SPECS = {
  ...CLUSTER_A_BEHAVIORAL,
  ...UTILITY_BEHAVIORAL,
  ...FILTER_BEHAVIORAL,
  ...DISTORTION_BEHAVIORAL,
  ...ANALYZER_BEHAVIORAL,
  ...ENVELOPE_BEHAVIORAL,
  ...GAINCURVE_BEHAVIORAL,
};

export function getSpec(opId) {
  return ALL_SPECS[opId] || null;
}

export function listSpecOps() {
  return Object.keys(ALL_SPECS).sort();
}
