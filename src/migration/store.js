// Migration store — localStorage-backed QC-mode flag and per-product lifecycle.
//
// Schema is versioned. Shape changes bump the namespace (v1 → v2 …) so
// persisted state never silently corrupts. A one-shot migration shim below
// reads any legacy v1 entries on first boot and rewrites them under v2.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { REGISTRY } from './registry.js';

const NS              = 'migration.v2';
const KEY_QC_MODE     = `${NS}.qcMode`;
const keyStatus       = (productId) => `${NS}.status.${productId}`;

// ── v1 → v2 one-shot migration ───────────────────────────────────────────
// v1 used variantId values 'legacy'/'engine_v1' and status 'legacy_only'/
// 'approved_engine_v1'. v2 uses 'prototype'/'v1' + 'prototype_only'/
// 'approved_v1'. Run once per product key that hasn't already been seeded
// under v2; leave v1 entries in place so a downgrade still works.

const V1_NS             = 'migration.v1';
const V1_MIGRATION_FLAG = `${NS}.migratedFromV1`;

function mapV1Status(s) {
  if (s === 'legacy_only')         return 'prototype_only';
  if (s === 'approved_engine_v1')  return 'approved_v1';
  return s; // 'in_qc' | 'needs_work' | 'deferred' unchanged
}

function runV1Migration() {
  try {
    if (localStorage.getItem(V1_MIGRATION_FLAG) === '1') return;
    // qcMode
    const v1Mode = localStorage.getItem(`${V1_NS}.qcMode`);
    if (v1Mode != null && localStorage.getItem(KEY_QC_MODE) == null) {
      localStorage.setItem(KEY_QC_MODE, v1Mode);
    }
    // per-product status
    for (const p of REGISTRY) {
      const v2Key = keyStatus(p.productId);
      if (localStorage.getItem(v2Key) != null) continue;
      const v1 = localStorage.getItem(`${V1_NS}.status.${p.productId}`);
      if (v1 != null) localStorage.setItem(v2Key, mapV1Status(v1));
    }
    localStorage.setItem(V1_MIGRATION_FLAG, '1');
  } catch {}
}
// Run at module load — idempotent, guarded by the flag.
if (typeof localStorage !== 'undefined') runV1Migration();

// ── Status ───────────────────────────────────────────────────────────────
// Values: 'prototype_only' | 'in_qc' | 'approved_v1' | 'needs_work' | 'deferred'
//
// 'prototype_only' is automatic when no non-prototype variants exist in the
// registry. 'in_qc' is the default seeded state for products that have a
// migrated variant. 'approved_v1' / 'needs_work' / 'deferred' are explicit
// user actions.

function defaultStatusFor(productId) {
  const p = REGISTRY.find(x => x.productId === productId);
  if (!p) return 'prototype_only';
  const hasMigrated = Object.keys(p.variants).some(v => v !== 'prototype');
  return hasMigrated ? 'in_qc' : 'prototype_only';
}

function readStatus(productId) {
  try {
    const raw = localStorage.getItem(keyStatus(productId));
    return raw || defaultStatusFor(productId);
  } catch { return defaultStatusFor(productId); }
}

function writeStatus(productId, status) {
  try { localStorage.setItem(keyStatus(productId), status); } catch {}
  // notify listeners
  window.dispatchEvent(new CustomEvent('migration:change', { detail: { productId, status } }));
}

// ── External-store bridge so components re-render on cross-instance changes ─

function subscribe(cb) {
  window.addEventListener('migration:change', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('migration:change', cb);
    window.removeEventListener('storage', cb);
  };
}

export function useProductStatus(productId) {
  const getSnapshot = () => readStatus(productId);
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [status, (next) => writeStatus(productId, next)];
}

// Sync read — used by menu filters that run every render.
export function getStatus(productId) { return readStatus(productId); }

// Explicit transitions (kept as named calls so the intent is visible at sites).
export function approve(productId) { writeStatus(productId, 'approved_v1'); }
export function revoke(productId)  { writeStatus(productId, 'needs_work'); }
export function defer(productId)   { writeStatus(productId, 'deferred'); }
export function resetQc(productId) { writeStatus(productId, defaultStatusFor(productId)); }

// Resolve the best version to load when the non-QC menu says "Panther Buss".
// Approved migrated variant wins; otherwise prototype.
export function defaultVersionFor(productId) {
  const s = readStatus(productId);
  return s === 'approved_v1' ? 'v1' : 'prototype';
}

// ── Finding state machine (v2 — Codex UX alignment) ─────────────────────
// Per-finding repair + verification state, keyed by
//   {productId}:{version}:{findingId}
//
// Lives alongside — but orthogonal to — the v1-promotion approval layer
// (`approve()` / qc:approvals:v2). A finding can be `resolved` without
// the rule being approved, and a rule can be approved while an individual
// finding instance is still `open`. Do not collapse these.
//
// Shape:
//   {
//     repairState,       // REPAIR_STATES
//     verificationState, // VERIFICATION_STATES
//     lastRunId,
//     dirtySince,        // ts when a saved value was invalidated
//     lastSavedValue: { [controlId]: [{ value, authoredHash, ts }, ...] },
//                       // stack — newest last; capped at SAVED_HISTORY_MAX.
//     verificationHistory: [{ runId, scope, status, ts, authoredHash }]
//   }
//
// Undo contract: pop one entry off each controlId's stack → re-derive
// verificationState from verificationHistory entries whose authoredHash
// matches the restored top-of-stack. Never blindly blank the finding.
// Depth is capped at SAVED_HISTORY_MAX per control so long repair
// sessions don't balloon localStorage.

const KEY_FINDINGS = `${NS}.findings`;
const SAVED_HISTORY_MAX = 20;

const REPAIR = {
  OPEN: 'open', EDITING: 'editing', SAVED: 'saved',
  VERIFIED: 'verified', VERIFIED_PARTIAL: 'verified_partial',
  FAILED_VERIFICATION: 'failed_verification',
  REOPENED: 'reopened', RESOLVED: 'resolved',
};
const VERIF = {
  IDLE: 'idle', RUNNING: 'running',
  PASSED: 'passed', PARTIAL: 'partial', FAILED: 'failed',
};

const findingKey = (productId, version, findingId) =>
  `${productId}:${version}:${findingId}`;

function readFindings() {
  try {
    const raw = localStorage.getItem(KEY_FINDINGS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeFindings(all) {
  try { localStorage.setItem(KEY_FINDINGS, JSON.stringify(all)); } catch {}
  window.dispatchEvent(new CustomEvent('migration:findings', { detail: {} }));
}

function emptyFinding() {
  return {
    repairState: REPAIR.OPEN,
    verificationState: VERIF.IDLE,
    lastRunId: null,
    dirtySince: null,
    lastSavedValue: {},
    verificationHistory: [],
  };
}

export function getFinding(productId, version, findingId) {
  const all = readFindings();
  return all[findingKey(productId, version, findingId)] || emptyFinding();
}

function mutate(productId, version, findingId, fn) {
  const all = readFindings();
  const k = findingKey(productId, version, findingId);
  const next = fn(all[k] || emptyFinding());
  all[k] = next;
  writeFindings(all);
  return next;
}

// Transitions — pure functions, no UI concerns.

export function startEditing(productId, version, findingId) {
  return mutate(productId, version, findingId, (f) => ({
    ...f, repairState: REPAIR.EDITING,
  }));
}

// Commit an authored snapshot for one or more controls.
// `snapshot` = { [controlId]: { value, authoredHash } }
// Each controlId's stack grows by one entry, capped at SAVED_HISTORY_MAX.
export function commitSave(productId, version, findingId, snapshot) {
  const ts = Date.now();
  return mutate(productId, version, findingId, (f) => {
    const lastSavedValue = { ...f.lastSavedValue };
    for (const [cid, s] of Object.entries(snapshot || {})) {
      const prev = Array.isArray(lastSavedValue[cid]) ? lastSavedValue[cid] : [];
      const entry = { value: s.value, authoredHash: s.authoredHash, ts };
      const next = [...prev, entry];
      // Keep only the most recent SAVED_HISTORY_MAX revisions.
      lastSavedValue[cid] = next.length > SAVED_HISTORY_MAX
        ? next.slice(next.length - SAVED_HISTORY_MAX)
        : next;
    }
    return {
      ...f,
      repairState: REPAIR.SAVED,
      verificationState: VERIF.IDLE,
      dirtySince: null,
      lastSavedValue,
    };
  });
}

export function beginVerify(productId, version, findingId, runId, scope) {
  return mutate(productId, version, findingId, (f) => ({
    ...f,
    verificationState: VERIF.RUNNING,
    lastRunId: runId,
    // opportunistically remember scope on the in-flight verification
    // (finalized entry is pushed in resolveVerify)
    _pendingScope: scope,
  }));
}

// outcome ∈ { passed, partial, failed }; authoredHash captures the
// state-at-verify so undo can re-derive correctly.
export function resolveVerify(productId, version, findingId, outcome, authoredHash) {
  const ts = Date.now();
  return mutate(productId, version, findingId, (f) => {
    const scope = f._pendingScope || null;
    const history = [
      ...f.verificationHistory,
      { runId: f.lastRunId, scope, status: outcome, ts, authoredHash },
    ];
    let repair = f.repairState;
    let verif = f.verificationState;
    if (outcome === 'passed')  { repair = REPAIR.VERIFIED;            verif = VERIF.PASSED; }
    if (outcome === 'partial') { repair = REPAIR.VERIFIED_PARTIAL;    verif = VERIF.PARTIAL; }
    if (outcome === 'failed')  { repair = REPAIR.FAILED_VERIFICATION; verif = VERIF.FAILED; }
    const { _pendingScope, ...rest } = f;
    return { ...rest, repairState: repair, verificationState: verif, verificationHistory: history };
  });
}

export function markReopened(productId, version, findingId, ts = Date.now()) {
  return mutate(productId, version, findingId, (f) => ({
    ...f,
    repairState: REPAIR.REOPENED,
    verificationState: VERIF.IDLE,
    dirtySince: ts,
  }));
}

// Finding-local closure. Does NOT imply rule approval.
export function finalizeResolved(productId, version, findingId) {
  return mutate(productId, version, findingId, (f) => ({
    ...f, repairState: REPAIR.RESOLVED,
  }));
}

// Undo: pop one entry off each controlId's stack and re-derive the
// verification state from verificationHistory matching the restored
// top-of-stack authoredHash(es). If every stack becomes empty after the
// pop, the finding returns to OPEN. If restored snapshot matches a prior
// passing/partial verification, restore that; otherwise fall back to SAVED.
export function undoSave(productId, version, findingId) {
  return mutate(productId, version, findingId, (f) => {
    const lastSavedValue = {};
    let anyRemaining = false;
    for (const [cid, stack] of Object.entries(f.lastSavedValue || {})) {
      const arr = Array.isArray(stack) ? stack : (stack ? [stack] : []);
      const popped = arr.slice(0, -1); // drop top
      if (popped.length > 0) {
        lastSavedValue[cid] = popped;
        anyRemaining = true;
      }
      // else: omit key entirely — stack fully drained
    }
    if (!anyRemaining) {
      return {
        ...f,
        repairState: REPAIR.OPEN,
        verificationState: VERIF.IDLE,
        lastSavedValue: {},
      };
    }
    // Restored hashes = current tops after the pop.
    const hashes = Object.values(lastSavedValue)
      .map(stack => stack[stack.length - 1]?.authoredHash)
      .filter(Boolean);
    const match = [...f.verificationHistory].reverse()
      .find(h => hashes.includes(h.authoredHash));
    let repair = REPAIR.SAVED;
    let verif  = VERIF.IDLE;
    if (match?.status === 'passed')  { repair = REPAIR.VERIFIED;         verif = VERIF.PASSED; }
    if (match?.status === 'partial') { repair = REPAIR.VERIFIED_PARTIAL; verif = VERIF.PARTIAL; }
    if (match?.status === 'failed')  { repair = REPAIR.FAILED_VERIFICATION; verif = VERIF.FAILED; }
    return { ...f, lastSavedValue, repairState: repair, verificationState: verif };
  });
}

export const FINDING_STATES = { REPAIR, VERIF };

// ── QC Mode toggle ───────────────────────────────────────────────────────

export function useQcMode() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY_QC_MODE) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY_QC_MODE, on ? '1' : '0'); } catch {}
  }, [on]);
  return [on, setOn];
}
