// opVerificationLedger.js — browser-side accessor for verification_ledger.json.
//
// Single source of truth for "what's the verification state of each op?" inside
// the React app. Fetches the JSON ledger written by
// scripts/generate_verification_ledger.mjs, caches it in module-scope, exposes
// helpers + a React hook.
//
// The JSON schema (mirror of the markdown ledger):
//   {
//     generatedAt: ISO string,
//     totalOps:   number,
//     goldCount:  number,                 // ops at 6/6 auto + listen ticked
//     ops: [{
//       id:         string,
//       gates: {
//         worklet, cpp, smoke, t1_t7, parity, behavioral: boolean,
//         listen:   string | null         // "JS 2026-05-01" or null
//       },
//       autoPassed: 0..6,
//       notes:      string
//     }, ...]
//   }
//
// Re-run `node scripts/generate_verification_ledger.mjs` to refresh
// public/verification_ledger.json after gates change on disk.

import { useEffect, useState } from 'react';

const LEDGER_URL = '/verification_ledger.json';
const SIGNOFFS_LS_KEY = 'opVerificationSignoffs.v1';

let _ledgerPromise = null;
let _ledgerCache = null;
const _signoffSubs = new Set();    // simple pub/sub so UI updates immediately

// ── Local sign-off overrides (per-browser, persists in localStorage until
//    the disk-write middleware lands in Phase B). Schema:
//    { opId: { listen: 'JS 2026-04-27', behavioral: true (last live PASS) } }
function readSignoffs() {
  try {
    const s = localStorage.getItem(SIGNOFFS_LS_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}
function writeSignoffs(map) {
  try { localStorage.setItem(SIGNOFFS_LS_KEY, JSON.stringify(map)); } catch {}
  for (const fn of _signoffSubs) try { fn(map); } catch {}
}
export function getLocalSignoffs() { return readSignoffs(); }
export function recordSignoff(opId, listenStr, behavioralPassed = true) {
  const map = readSignoffs();
  map[opId] = {
    listen: listenStr,
    behavioral: !!behavioralPassed,
    at: new Date().toISOString(),
  };
  writeSignoffs(map);
  return map[opId];
}
export function clearSignoff(opId) {
  const map = readSignoffs();
  delete map[opId];
  writeSignoffs(map);
}
export function clearAllSignoffs() { writeSignoffs({}); }

// React hook for live sign-offs (re-renders when one is recorded).
export function useLocalSignoffs() {
  const [map, setMap] = useState(readSignoffs);
  useEffect(() => {
    const fn = m => setMap({ ...m });
    _signoffSubs.add(fn);
    return () => _signoffSubs.delete(fn);
  }, []);
  return map;
}

// Apply local sign-offs on top of a fetched ledger so the UI sees the
// flipped gates immediately. Sign-off overrides DON'T downgrade gates
// (only fill in missing ones), so this is safe to apply unconditionally.
export function mergeSignoffs(ledger, signoffs) {
  if (!ledger || !ledger.ops) return ledger;
  return {
    ...ledger,
    ops: ledger.ops.map(o => {
      const so = signoffs?.[o.id];
      if (!so) return o;
      return {
        ...o,
        gates: {
          ...o.gates,
          // Live behavioral PASS upgrades gate 6 if it wasn't already true.
          behavioral: o.gates.behavioral || !!so.behavioral,
          // Listen string upgrades gate 7 if not already set.
          listen: o.gates.listen || so.listen || null,
        },
        autoPassed: Math.max(
          o.autoPassed,
          // Recompute: how many of W/C/S/T/P/B are now green after merge.
          [o.gates.worklet, o.gates.cpp, o.gates.smoke, o.gates.t1_t7,
           o.gates.parity, o.gates.behavioral || !!so.behavioral].filter(Boolean).length
        ),
      };
    }),
  };
}

/**
 * POST the merged ledger back to the dev server's /__dev/save-ledger
 * endpoint, which writes it to public/verification_ledger.json (with a
 * .bak.json backup of the previous file). Returns the server's JSON
 * response on success or throws on failure.
 *
 * Intended to be called from the Save button in OpVerificationLedgerView
 * after the user has ticked listen gates and wants the change to survive
 * a page reload.
 */
export async function saveLedgerToDisk(ledger) {
  if (!ledger || !Array.isArray(ledger.ops)) throw new Error('invalid ledger');
  const res = await fetch('/__dev/save-ledger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ledger),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `save failed (${res.status})`);
  }
  // Refresh the in-memory cache to match what's now on disk.
  _ledgerCache = ledger;
  return json;
}

/**
 * Fetch the verification ledger. Cached after first call.
 * Returns null on failure (browser keeps running with no gate annotations).
 */
export async function fetchVerificationLedger({ force = false } = {}) {
  if (_ledgerCache && !force) return _ledgerCache;
  if (_ledgerPromise && !force) return _ledgerPromise;
  _ledgerPromise = fetch(LEDGER_URL, { cache: force ? 'reload' : 'default' })
    .then(r => {
      if (!r.ok) throw new Error(`ledger fetch ${r.status}`);
      return r.json();
    })
    .then(j => {
      _ledgerCache = j;
      _ledgerPromise = null;
      return j;
    })
    .catch(err => {
      console.warn('[opVerificationLedger] fetch failed:', err.message);
      _ledgerPromise = null;
      return null;
    });
  return _ledgerPromise;
}

/**
 * Look up one op's verification state. Returns null if ledger unavailable
 * or op not in the ledger (e.g. brand new op not yet generated).
 */
export function getOpVerification(ledger, opId) {
  if (!ledger || !Array.isArray(ledger.ops)) return null;
  return ledger.ops.find(o => o.id === opId) || null;
}

/**
 * Count gates passed for an op record. Includes listen gate if signed off.
 * Returns 0–7 inclusive.
 */
export function gatesPassed(opRecord) {
  if (!opRecord) return 0;
  const g = opRecord.gates;
  let n = 0;
  if (g.worklet)    n++;
  if (g.cpp)        n++;
  if (g.smoke)      n++;
  if (g.t1_t7)      n++;
  if (g.parity)     n++;
  if (g.behavioral) n++;
  if (g.listen)     n++;
  return n;
}

/**
 * Compact status emoji for an op:
 *   ✅  — all 7 gates green (gold)
 *   🟢  — 6/6 auto, awaiting listen sign-off
 *   🟡  — partial (some gates green, some red)
 *   🚧  — only structural gates (worklet + cpp) green
 *   ⬜  — nothing built
 */
export function statusEmoji(opRecord) {
  if (!opRecord) return '⬜';
  const n = gatesPassed(opRecord);
  if (n >= 7)  return '✅';
  if (opRecord.autoPassed === 6) return '🟢';
  if (opRecord.autoPassed >= 3)  return '🟡';
  if (opRecord.autoPassed >= 1)  return '🚧';
  return '⬜';
}

/**
 * React hook: load the ledger once on mount, return { ledger, loading, error, refresh }.
 * Automatically merges local sign-off overrides on top of disk-fetched gates so
 * the UI reflects user actions instantly (without a CLI regen step).
 */
export function useVerificationLedger() {
  const [state, setState] = useState({ ledger: _ledgerCache, loading: !_ledgerCache, error: null });
  const signoffs = useLocalSignoffs();
  useEffect(() => {
    let cancelled = false;
    fetchVerificationLedger().then(ledger => {
      if (cancelled) return;
      if (!ledger) setState(s => ({ ...s, loading: false, error: 'unavailable' }));
      else setState({ ledger, loading: false, error: null });
    });
    return () => { cancelled = true; };
  }, []);
  const refresh = () => fetchVerificationLedger({ force: true }).then(ledger => {
    if (ledger) setState({ ledger, loading: false, error: null });
  });
  // Merge happens on every render so any sign-off triggers a fresh-merged ledger.
  const mergedLedger = state.ledger ? mergeSignoffs(state.ledger, signoffs) : null;
  return { ...state, ledger: mergedLedger, refresh };
}
