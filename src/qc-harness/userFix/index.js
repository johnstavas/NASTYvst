// src/qc-harness/userFix/index.js
//
// userFix — the layer-C knowledge base.
//
// Third-party plugin developers ship their plugins through this QC rack.
// When a rule fires they need to know:
//   1. WHY it fired (plain language)
//   2. HOW to fix it (actionable, one-file-one-change if possible)
//   3. WHO proved the fix works (provenance → trust)
//
// The data lives in ./overrides.json so it's editable without touching
// code. Every time a plugin gets approved with a capability-scoped carve-
// out, an entry lands here and every future plugin declaring that
// capability automatically inherits the fix copy.
//
// Match grammar (see overrides.json):
//   severity:     'fail' | 'warn' | 'info' | '*'
//   capabilities: { key: value | ">=N" | "<=N" | "eq:X" | true | false }
//   productId:    string | '*'       (use sparingly — prefer capabilities)
//   version:    string | '*'       (use sparingly — prefer capabilities)
//
// Higher specificity wins:
//   plugin-specific (productId+version)  +10
//   capability-match  (+2 per capability)  +2..+10
//   severity-specific (non-'*')             +2
//
// Ties broken by array order (later wins — last-authored is most-recent).
//
// Resolution pipeline:
//   default = RULE_META[ruleId]                           (rule-level default copy, from qcAnalyzer.js)
//   bySev   = default.bySeverity?.[severity]              (backwards-compat severity branch)
//   fixes   = overrides.filter(o => matches(o, context))
//   merged  = default < bySev < ...fixes (by specificity)
//
// Every override carries `provenance` so the popup can render "this fix
// was verified against <plugin> on <date>" — the thing that makes help
// text written by strangers trustworthy.

import overridesData from './overrides.json';

// Frozen at import. Hot-reload in dev still works because Vite
// reimports this module when the JSON changes.
const OVERRIDES = Object.freeze(overridesData);

/**
 * Check a single capability predicate against a value.
 * @param {*} predicate  literal | ">=N" | "<=N" | ">N" | "<N" | "eq:X"
 * @param {*} actual     the capability value on the engine
 */
function matchPredicate(predicate, actual) {
  if (predicate === actual) return true;
  if (typeof predicate !== 'string') return false;
  if (predicate === '*' && actual != null) return true;

  // Numeric comparators
  const num = (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  if (predicate.startsWith('>=')) { const n = num(predicate.slice(2)); return n != null && typeof actual === 'number' && actual >= n; }
  if (predicate.startsWith('<=')) { const n = num(predicate.slice(2)); return n != null && typeof actual === 'number' && actual <= n; }
  if (predicate.startsWith('>'))  { const n = num(predicate.slice(1)); return n != null && typeof actual === 'number' && actual >  n; }
  if (predicate.startsWith('<'))  { const n = num(predicate.slice(1)); return n != null && typeof actual === 'number' && actual <  n; }
  if (predicate.startsWith('eq:')) return String(actual) === predicate.slice(3);

  return false;
}

/**
 * Does an override's `match` block apply to the current finding context?
 * Returns { ok: boolean, score: number } so callers can pick the most
 * specific match when several apply.
 */
function scoreMatch(override, { ruleId, severity, productId, version, capabilities }) {
  if (override.ruleId !== ruleId) return { ok: false, score: -1 };

  const m = override.match || {};
  let score = 0;

  if (m.severity && m.severity !== '*') {
    if (m.severity !== severity) return { ok: false, score: -1 };
    score += 2;
  }

  if (m.productId && m.productId !== '*') {
    if (m.productId !== productId) return { ok: false, score: -1 };
    score += 10;
  }

  if (m.version && m.version !== '*') {
    if (m.version !== version) return { ok: false, score: -1 };
    score += 5;
  }

  if (m.capabilities && typeof m.capabilities === 'object') {
    const caps = capabilities || {};
    for (const [key, pred] of Object.entries(m.capabilities)) {
      if (!matchPredicate(pred, caps[key])) return { ok: false, score: -1 };
      score += 2;
    }
  }

  return { ok: true, score };
}

/**
 * Find all overrides that apply, sorted by specificity (highest first,
 * ties broken by array order — later wins).
 */
function pickOverrides(context) {
  const matches = [];
  for (let i = 0; i < OVERRIDES.length; i++) {
    const { ok, score } = scoreMatch(OVERRIDES[i], context);
    if (ok) matches.push({ override: OVERRIDES[i], score, index: i });
  }
  matches.sort((a, b) => (b.score - a.score) || (b.index - a.index));
  return matches.map(m => m.override);
}

/**
 * Merge one override's copy over a base meta object.
 * Only fields present in the override.copy replace the base — dev notes
 * are preserved unless the override explicitly provides its own.
 */
// Fields the override's `copy` block can set. Core (pre-γ) plus the
// UX-facing fields the Repair Drawer needs (see qcAnalyzer.js Finding
// contract). Targeting/scope fields live under override.repair and
// override.verification, merged below.
const COPY_FIELDS = [
  // core
  'title', 'meaning', 'fix', 'dev',
  // UX
  'short', 'whyItMatters', 'expectedBehavior',
  'beforeState', 'afterPassState', 'afterFailState',
  'verifyLabel', 'successStateText', 'failureStateText',
  'helperActionLabel', 'commitLabel', 'saveTarget', 'whatToTouch',
  'family', 'area', 'repairType',
];

const TARGETING_FIELDS = ['controlIds', 'sectionId', 'capabilityId', 'uiTargets'];
const VERIFICATION_FIELDS = ['qcScopes'];

function applyCopy(base, override) {
  const c = override.copy || {};
  const r = override.repair || {};
  const v = override.verification || {};
  const out = { ...base };
  for (const k of COPY_FIELDS)         if (c[k] !== undefined) out[k] = c[k];
  for (const k of TARGETING_FIELDS)    if (r[k] !== undefined) out[k] = r[k];
  for (const k of VERIFICATION_FIELDS) if (v[k] !== undefined) out[k] = v[k];
  // Stash provenance for the popup to surface.
  out.provenance = override.provenance || null;
  out.userFixId  = override.id;
  return out;
}

/**
 * Resolve the final meta for a finding.
 *
 * @param {object} baseMeta  RULE_META[ruleId] (may be undefined for
 *                           unknown rules). Its bySeverity[severity]
 *                           block is merged FIRST as the rule-level
 *                           severity branch; overrides stack on top.
 * @param {object} context
 * @param {string} context.ruleId
 * @param {string} context.severity  'fail' | 'warn' | 'info'
 * @param {string} [context.productId]
 * @param {string} [context.version]
 * @param {object} [context.capabilities]
 * @returns {{ title, meaning, fix, dev, provenance, userFixId, overridesApplied }}
 */
export function resolveUserFix(baseMeta, context) {
  const start = baseMeta || {
    title:   context.ruleId,
    meaning: context.rawMsg || "No meaning on file for this rule — add an entry to RULE_META or userFix/overrides.json.",
    fix:     "No suggested fix on file for this rule yet — contribute one to src/qc-harness/userFix/overrides.json.",
    dev:     null,
  };

  // Step 1 — apply the rule-level severity branch (back-compat with the
  // old bySeverity mechanism in RULE_META). This keeps existing copy
  // working without requiring every entry to be ported to userFix.json.
  let meta = { ...start };
  const sevBranch = start.bySeverity?.[context.severity];
  if (sevBranch) {
    meta = {
      ...meta,
      ...sevBranch,
      dev: sevBranch.dev || start.dev,
    };
  }
  // Never leak the bySeverity map into the rendered meta.
  delete meta.bySeverity;

  // Step 2 — apply capability/plugin-matched overrides in ascending
  // specificity order (least specific first, so most specific wins the
  // final write). pickOverrides returns highest-first, so we reverse.
  const overrides = pickOverrides(context).reverse();
  for (const o of overrides) meta = applyCopy(meta, o);

  meta.overridesApplied = overrides.map(o => o.id);
  return meta;
}

/**
 * Debug helper — returns the raw overrides list so tooling can render
 * a "knowledge base" view (coming soon: /userfix preview page).
 */
export function getAllOverrides() {
  return OVERRIDES;
}
