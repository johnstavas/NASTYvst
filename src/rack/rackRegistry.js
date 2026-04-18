// rackRegistry.js — plugin-type registry for the QC rack.
//
// Each entry is a *plugin type* (not a version). A type can expose up to
// two factories:
//
//   legacy : () => factoryFn   — original per-plugin engine module
//   nu     : () => factoryFn   — new-engine (FxEngine) product wrapper
//                               (named "nu" to avoid the `new` keyword)
//
// A type with only `legacy` simply has no migrated version yet. A type
// with both supports A/B comparison and approval.
//
// Approval state lives in localStorage, keyed per type. On load, the
// resolver picks `nu` if the type is approved, else `legacy`. Nothing
// else in the system needs to know about approval — it's a pure default-
// version policy, overridable per PUT slot via the version toggle.
//
// ── STRICT MANUAL APPROVAL RULE ──────────────────────────────────────────
// Approval is the exclusive product of a human listening decision made in
// a studio environment. There is no automated path in this file — or
// anywhere else — that writes to the approval store. Specifically:
//
//   • No metric, threshold, correlation, LUFS delta, bypass-null test,
//     or any other analyzer output ever triggers approve().
//   • approve() is called only from a UI button whose click handler is
//     explicitly wired to a user gesture (and gated by a confirm dialog).
//   • Fresh installs / unknown types always resolve to 'legacy'.
//   • Approval is per plugin-type, per browser profile. It does not
//     propagate across machines or users.
//
// If you find yourself wanting to auto-approve based on a measurement,
// you are writing the wrong feature.

const LS_KEY        = 'shagsvst.rack.approved.v1';   // legacy flat-boolean store
const LS_STATUS_KEY = 'shagsvst.rack.qcStatus.v1';   // new QC status store

// ── QC state model ──────────────────────────────────────────────────────
// Per plugin type, one of:
//   not_started : never opened in the rack for listening
//   in_qc       : currently being reviewed (soft flag; set by "Start QC")
//   approved    : studio-listened and approved → new engine is default
//   needs_work  : listened, not acceptable → legacy stays default
//   deferred    : skipped for now → legacy stays default, revisit later
//
// Only `approved` changes default-version resolution. Every other state
// keeps legacy as the default. Status transitions are always manual.
export const STATUSES = ['not_started','in_qc','approved','needs_work','deferred'];
export const STATUS_COLORS = {
  not_started: '#777',   // gray
  in_qc:       '#5aa0ff',// blue
  approved:    '#7fff8f',// green
  needs_work:  '#ff5a5a',// red
  deferred:    '#ffd24a',// yellow
};
export const STATUS_LABELS = {
  not_started: 'not started',
  in_qc:       'in QC',
  approved:    'approved',
  needs_work:  'needs work',
  deferred:    'deferred',
};

// Lazy factory loaders. Each returns the factory function (async (ctx) => engine).
const L = {
  drumBus:      async () => (await import('../drumBusEngine.js')).createDrumBusEngine,
  pantherBuss:  async () => (await import('../pantherBussEngine.js')).createPantherBussEngine,
  la2a:         async () => (await import('../la2aEngine.js')).createLA2AEngine,
  analogGlue:   async () => (await import('../analogGlueEngine.js')).createAnalogGlueEngine,
  gluesmash:    async () => (await import('../gluesmashEngine.js')).createGluesmashEngine,
  neve:         async () => (await import('../neveEngine.js')).createNeveEngine,
  iron1073:     async () => (await import('../iron1073Engine.js')).createIron1073Engine,
  nastyNeve:    async () => (await import('../bae73Engine.js')).createNastyNeveEngine,
  distortion:   async () => (await import('../distortionEngine.js')).createDistortionEngine,
  shagatron:    async () => (await import('../shagatronEngine.js')).createShagatronEngine,
  tape:         async () => (await import('../tapeEngine.js')).createTapeEngine,
  flanger:      async () => (await import('../flangerEngine.js')).createFlangerEngine,
  modulation:   async () => (await import('../modulationEngine.js')).createModulationEngine,
  tapeDelay:    async () => (await import('../tapeDelayEngine.js')).createTapeDelayEngine,
  echoform:     async () => (await import('../echoformEngine.js')).createEchoformEngine,
  simpleReverb: async () => (await import('../simpleReverbEngine.js')).createSimpleReverbEngine,
  morphReverb:    async () => (await import('../morphReverbEngine.js')).createMorphReverbEngine,
  morphReverbNew: async () => (await import('../morphReverbEngineNew.js')).createMorphReverbEngineNew,
  springReverb: async () => (await import('../springReverbEngine.js')).createSpringReverbEngine,
};

export const REGISTRY = [
  // Types with both versions — A/B comparison + approval available.
  { id: 'drumbus', label: 'Drum / Panther Buss',
    legacy: L.drumBus,   nu: L.pantherBuss },

  // Legacy-only — `nu` slot empty. Approval button is disabled in UI.
  { id: 'la2a',         label: 'LA-2A',          legacy: L.la2a         },
  { id: 'analogGlue',   label: 'Analog Glue',    legacy: L.analogGlue   },
  { id: 'gluesmash',    label: 'Glue Smash',     legacy: L.gluesmash    },
  { id: 'neve',         label: 'Neve',           legacy: L.neve         },
  { id: 'iron1073',     label: 'Iron 1073',      legacy: L.iron1073     },
  { id: 'nastyNeve',    label: 'Nasty Neve',     legacy: L.nastyNeve    },
  { id: 'distortion',   label: 'Distortion',     legacy: L.distortion   },
  { id: 'shagatron',    label: 'Shagatron',      legacy: L.shagatron    },
  { id: 'tape',         label: 'Tape (424)',     legacy: L.tape         },
  { id: 'flanger',      label: 'Flanger',        legacy: L.flanger      },
  { id: 'modulation',   label: 'Modulation',     legacy: L.modulation   },
  { id: 'tapeDelay',    label: 'Tape Delay',     legacy: L.tapeDelay    },
  { id: 'echoform',     label: 'Echoform',       legacy: L.echoform     },
  { id: 'simpleReverb', label: 'Simple Reverb',  legacy: L.simpleReverb },
  { id: 'morphReverb',  label: 'Morph Reverb',
    legacy: L.morphReverb, nu: L.morphReverbNew },
  { id: 'springReverb', label: 'Spring Reverb',  legacy: L.springReverb },
];

export function findType(typeId) {
  return REGISTRY.find(r => r.id === typeId);
}

export function hasVersion(type, version) {
  if (!type) return false;
  return version === 'nu' ? !!type.nu : !!type.legacy;
}

// ---- QC status store (localStorage) -------------------------------------
//
// Shape: { [typeId]: 'not_started' | 'in_qc' | 'approved' | 'needs_work' | 'deferred' }
// Missing entries = 'not_started'.
//
// Migration: if the legacy LS_KEY boolean-map exists, each `true` entry is
// folded into the new store as status='approved' on first read. Legacy key
// is left in place (read-only) as a cheap rollback anchor.

function readStatus() {
  let obj = {};
  try {
    const raw = localStorage.getItem(LS_STATUS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed;
    }
  } catch {}
  // One-shot migration from the old flat approval store.
  try {
    const legacyRaw = localStorage.getItem(LS_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) || {};
      let changed = false;
      for (const k of Object.keys(legacy)) {
        if (legacy[k] && !obj[k]) { obj[k] = 'approved'; changed = true; }
      }
      if (changed) localStorage.setItem(LS_STATUS_KEY, JSON.stringify(obj));
    }
  } catch {}
  return obj;
}
function writeStatus(obj) {
  try { localStorage.setItem(LS_STATUS_KEY, JSON.stringify(obj)); } catch {}
}

export function getStatus(typeId) {
  return readStatus()[typeId] || 'not_started';
}
export function setStatus(typeId, status) {
  if (!STATUSES.includes(status)) return false;
  const t = findType(typeId);
  if (!t) return false;
  // Approval requires a `nu` version to exist — cannot approve something
  // that isn't migrated. All other statuses are always valid.
  if (status === 'approved' && !t.nu) return false;
  const s = readStatus();
  if (status === 'not_started') delete s[typeId]; else s[typeId] = status;
  writeStatus(s);
  return true;
}
export function listStatus() { return { ...readStatus() }; }

// ---- Approval helpers (status === 'approved' is the single source) -----

export function isApproved(typeId) { return getStatus(typeId) === 'approved'; }
export function approve(typeId)    { return setStatus(typeId, 'approved'); }
export function revert(typeId)     { return setStatus(typeId, 'not_started'); }
export function listApproved() {
  const s = readStatus();
  return Object.keys(s).filter(k => s[k] === 'approved');
}

// ---- Version resolution --------------------------------------------------

/**
 * Pick the default version for a plugin type:
 *   - 'nu'     if the type has a `nu` factory AND is approved
 *   - 'legacy' otherwise
 * Always returns a version the type actually has, or null if the type has
 * nothing at all (shouldn't happen for registered types).
 */
export function resolveDefaultVersion(typeId) {
  const t = findType(typeId);
  if (!t) return null;
  if (t.nu && isApproved(typeId)) return 'nu';
  if (t.legacy) return 'legacy';
  if (t.nu)     return 'nu';
  return null;
}

/** Return the factory function for (typeId, version), loading it lazily. */
export async function loadFactory(typeId, version) {
  const t = findType(typeId);
  if (!t) throw new Error(`Unknown plugin type: ${typeId}`);
  const loader = version === 'nu' ? t.nu : t.legacy;
  if (!loader) throw new Error(`No ${version} version for ${typeId}`);
  return await loader();
}
