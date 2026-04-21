// Migration registry — static capability catalogue.
//
// Three independent namespaces, never fused:
//   productId    — snake_case, stable forever, state key
//   version      — from a closed set: 'prototype' | 'v1' | 'v2' …
//                  (was `variantId` with values 'legacy' | 'engine_v1' …
//                  pre-2026-04-20; renamed to read like a real semver lane.
//                  See store.js for the one-shot localStorage migration.)
//   displayLabel — free text, UI only, never read by code
//
// Components and engine factories are imported here once so every menu,
// instance lookup, and info tooltip reads the same source of truth.

import DrumBusOrb      from '../DrumBusOrb.jsx';
import PantherBussOrb  from '../PantherBussOrb.jsx';
import ManChildOrb     from '../manChild/ManChildOrb.jsx';
import LofiLoofyOrb    from '../lofiLoofy/LofiLoofyOrb.jsx';
import FlapJackManOrb  from '../nastybeast/NastyBeastOrb.jsx';

// Engine factories are code-split — each plugin's DSP module loads only when
// that variant is actually instantiated. The eager React components above are
// a few KB each and drive every menu/tooltip, so they stay synchronous; the
// engines are the heavy (50+ KB with worklet source) bundles.
//
// Public contract is unchanged: engineFactory is still `async (ctx) => engine`.
// Callers `await variant.engineFactory(ctx)` exactly as before — the dynamic
// `import()` is hidden here. Vite emits one chunk per engine file.
const lazy = (loader, named) => async (ctx) => (await loader())[named](ctx);

export const VERSION_LABELS = {
  prototype: 'Prototype',
  v1:        'V1',
};

/** @typedef {'prototype'|'v1'|`v${number}`} Version */

/**
 * @typedef {Object} Variant
 * @property {Version}  version
 * @property {string}   displayLabel
 * @property {Function} component          React component
 * @property {string}   componentName      for ⓘ tooltip
 * @property {Function} engineFactory      async (ctx) => engine
 * @property {string}   engineName         for ⓘ tooltip
 */

/**
 * @typedef {Object} ProductEntry
 * @property {string}   productId
 * @property {string}   displayLabel
 * @property {string}   category            existing PLUGIN_CATEGORIES id
 * @property {string}   legacyType          string matched against inst.type for back-compat
 * @property {Record<Version, Variant>} variants
 */

/** @type {ProductEntry[]} */
export const REGISTRY = [
  {
    productId:    'panther_buss',
    displayLabel: 'Panther Buss',
    category:     'Dynamics',
    legacyType:   'drumbus',
    variants: {
      prototype: {
        version:       'prototype',
        displayLabel:  VERSION_LABELS.prototype,
        component:     DrumBusOrb,
        componentName: 'DrumBusOrb',
        engineFactory: lazy(() => import('../drumBusEngine.js'), 'createDrumBusEngine'),
        engineName:    'drumBusEngine',
      },
      v1: {
        version:       'v1',
        displayLabel:  VERSION_LABELS.v1,
        component:     PantherBussOrb,
        componentName: 'PantherBussOrb',
        engineFactory: lazy(() => import('../pantherBussEngine.js'), 'createPantherBussEngine'),
        engineName:    'pantherBussEngine',
      },
    },
  },
  {
    // MANchild — Fairchild-inspired vari-mu 670M stereo compressor.
    // First-version flagship compressor. Shipped as `prototype` (DEV_RULES G4
    // minimum). Once a new engine revision ships, promote the current one
    // to `v1` and migrate this entry accordingly.
    productId:    'manchild',
    displayLabel: 'MANchild',
    category:     'Dynamics',
    legacyType:   'manchild',
    variants: {
      prototype: {
        version:       'prototype',
        displayLabel:  VERSION_LABELS.prototype,
        component:     ManChildOrb,
        componentName: 'ManChildOrb',
        engineFactory: lazy(() => import('../manChild/manChildEngine.js'), 'createManChildEngine'),
        engineName:    'manChildEngine',
      },
      v1: {
        version:       'v1',
        displayLabel:  VERSION_LABELS.v1,
        component:     ManChildOrb,                 // same UI
        componentName: 'ManChildOrb',
        engineFactory: lazy(() => import('../manChild/manChildEngine.v1.js'), 'createManChildEngineV1'), // frozen snapshot
        engineName:    'manChildEngine.v1',
      },
    },
  },
  {
    // Flap Jack Man — thick delay/distortion system with pitch-shifted
    // ghosts. Memory Man / Space Echo-style lo-fi delay with in-loop
    // saturation + octave-down granular shifter. Shipped as `prototype`
    // (DEV_RULES G4); promote to v1 on next rev.
    productId:    'flapjackman',
    displayLabel: 'Flap Jack Man',
    category:     'Character',
    legacyType:   'flapjackman',
    variants: {
      prototype: {
        version:       'prototype',
        displayLabel:  VERSION_LABELS.prototype,
        component:     FlapJackManOrb,
        componentName: 'FlapJackManOrb',
        engineFactory: lazy(() => import('../nastybeast/nastyBeastEngine.js'), 'createNastyBeastEngine'),
        engineName:    'nastyBeastEngine',
      },
    },
  },
  {
    // Lofi Loofy — tape/cassette/sampler vibe box. Same-day build as
    // ManChild on V1. Shipped originally as `prototype`; v1
    // is the frozen QC snapshot (DEV_RULES G4) — any further DSP work
    // happens on a new prototype rev first, then promotes again.
    productId:    'lofi_loofy',
    displayLabel: 'Lofi Loofy',
    category:     'Character',
    legacyType:   'lofiLoofy',
    variants: {
      prototype: {
        version:       'prototype',
        displayLabel:  VERSION_LABELS.prototype,
        component:     LofiLoofyOrb,
        componentName: 'LofiLoofyOrb',
        engineFactory: lazy(() => import('../lofiLoofy/lofiLoofyEngine.js'), 'createLofiLoofyEngine'),
        engineName:    'lofiLoofyEngine',
      },
      v1: {
        version:       'v1',
        displayLabel:  VERSION_LABELS.v1,
        component:     LofiLoofyOrb,                  // same UI
        componentName: 'LofiLoofyOrb',
        engineFactory: lazy(() => import('../lofiLoofy/lofiLoofyEngine.v1.js'), 'createLofiLoofyEngineV1'),  // frozen snapshot
        engineName:    'lofiLoofyEngine.v1',
      },
    },
  },
];

// ── Lookup helpers — all menus / render switches / info tooltips go through
// these. No ad-hoc filters elsewhere.

const BY_ID         = new Map(REGISTRY.map(p => [p.productId, p]));
const BY_LEGACYTYPE = new Map(REGISTRY.map(p => [p.legacyType, p]));

export function getProduct(productId)      { return BY_ID.get(productId) || null; }
export function getProductByLegacyType(t)  { return BY_LEGACYTYPE.get(t) || null; }
export function getVariant(productId, version) {
  const p = BY_ID.get(productId);
  return p ? p.variants[version] || null : null;
}

// Invariants — cheap asserts so a bad registry fails at boot.
for (const p of REGISTRY) {
  if (!p.variants.prototype) throw new Error(`[registry] ${p.productId} missing prototype variant`);
  for (const [k, v] of Object.entries(p.variants)) {
    if (v.version !== k) throw new Error(`[registry] ${p.productId}.${k} version mismatch`);
  }
}
