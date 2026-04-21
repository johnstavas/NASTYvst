// src/qc-harness/knowledge/knowledgeLoader.js
//
// Knowledge Phase A.1 — runtime-safe loader for the deterministic product
// knowledge pack.
//
// This module owns the boundary between the JSON pack on disk and the
// rest of the QC subsystem. Rules, findings, and the (future) UI all talk
// to the loader, never to the raw JSON, so the pack format can evolve
// without callsite churn.
//
// Contract:
//
//   getKnowledgeCard(knowledgeId) → card | null
//     Exact-ID lookup. O(1). Returns null for unknown IDs. This is the
//     only API allowed on the active-lesson code path (see spec.md:
//     "Do not fuzzy-match the active lesson.").
//
//   getAllKnowledgeCards() → ReadonlyArray<card>
//     Full card list. Intended for drawer/search/related, never the
//     active lesson.
//
//   getFamiliesCovered() → ReadonlyArray<string>
//     Union of every `pluginFamilies[]` entry across the pack. Derived
//     at load time — the pack JSON intentionally omits this (see
//     spec.md: "familiesCovered is intentionally omitted and should be
//     derived at load time.").
//
//   getSchemaVersion() → string
//
// Safety enforcement is already applied by the migration writer
// (`riskLevel === 'must_fix'` ⇒ `canKeepIntentional === false`) so the
// loader trusts the file. It still surfaces a dev-only warning if it
// catches a violation, to guard against a hand-edited pack.

import pack from './deterministicProductKnowledge.json';

// Build indices eagerly at module load. The pack is ~186 KB and indexing
// is trivial; no reason to defer.
const byId = new Map();
const familiesSet = new Set();

const cards = Array.isArray(pack?.knowledgeCards) ? pack.knowledgeCards : [];

for (const card of cards) {
  if (!card || typeof card.knowledgeId !== 'string') continue;

  // Safety guard: must_fix with canKeepIntentional=true is a spec violation.
  if (card.riskLevel === 'must_fix' && card.canKeepIntentional === true) {
    // eslint-disable-next-line no-console
    console.warn(
      `[knowledgeLoader] must_fix card "${card.knowledgeId}" has canKeepIntentional=true. ` +
      `Spec forbids this. Treating as canKeepIntentional=false at runtime.`,
    );
  }

  byId.set(card.knowledgeId, card);

  if (Array.isArray(card.pluginFamilies)) {
    for (const fam of card.pluginFamilies) {
      if (typeof fam === 'string' && fam.length) familiesSet.add(fam);
    }
  }
}

const familiesCovered = Object.freeze([...familiesSet].sort());

export function getKnowledgeCard(knowledgeId) {
  if (typeof knowledgeId !== 'string' || !knowledgeId) return null;
  const card = byId.get(knowledgeId);
  return card || null;
}

export function getAllKnowledgeCards() {
  return cards;
}

export function getFamiliesCovered() {
  return familiesCovered;
}

export function getSchemaVersion() {
  return pack?.schemaVersion ?? null;
}

export function getKnowledgeCardCount() {
  return byId.size;
}

/**
 * Normalize a card for runtime. Applies the must_fix → canKeepIntentional=false
 * safety rule regardless of pack state, so callers cannot accidentally offer
 * "keep" on a must_fix finding even if the card has been hand-edited.
 *
 * Returns a shallow-frozen clone so downstream code can't mutate the pack.
 */
export function getSafeKnowledgeCard(knowledgeId) {
  const card = getKnowledgeCard(knowledgeId);
  if (!card) return null;
  const safe = { ...card };
  if (safe.riskLevel === 'must_fix') safe.canKeepIntentional = false;
  return Object.freeze(safe);
}
