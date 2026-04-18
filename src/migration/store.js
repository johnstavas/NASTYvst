// Migration store — localStorage-backed QC-mode flag and per-product lifecycle.
//
// Schema is versioned. Future shape changes bump the prefix to `.v2.` so
// persisted state never silently corrupts.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { REGISTRY } from './registry.js';

const NS              = 'migration.v1';
const KEY_QC_MODE     = `${NS}.qcMode`;
const keyStatus       = (productId) => `${NS}.status.${productId}`;

// ── Status ───────────────────────────────────────────────────────────────
// Values: 'legacy_only' | 'in_qc' | 'approved_engine_v1' | 'needs_work' | 'deferred'
//
// 'legacy_only' is automatic when no non-legacy variants exist in the registry.
// 'in_qc' is the default seeded state for products that have a migrated variant.
// 'approved_engine_v1' / 'needs_work' / 'deferred' are explicit user actions.

function defaultStatusFor(productId) {
  const p = REGISTRY.find(x => x.productId === productId);
  if (!p) return 'legacy_only';
  const hasMigrated = Object.keys(p.variants).some(v => v !== 'legacy');
  return hasMigrated ? 'in_qc' : 'legacy_only';
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
export function approve(productId) { writeStatus(productId, 'approved_engine_v1'); }
export function revoke(productId)  { writeStatus(productId, 'needs_work'); }
export function defer(productId)   { writeStatus(productId, 'deferred'); }
export function resetQc(productId) { writeStatus(productId, defaultStatusFor(productId)); }

// Resolve the best variant to load when the non-QC menu says "Panther Buss".
// Approved migrated variant wins; otherwise legacy.
export function defaultVariantFor(productId) {
  const s = readStatus(productId);
  return s === 'approved_engine_v1' ? 'engine_v1' : 'legacy';
}

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
