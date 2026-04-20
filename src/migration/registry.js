// Migration registry — static capability catalogue.
//
// Three independent namespaces, never fused:
//   productId    — snake_case, stable forever, state key
//   variantId    — from a closed set: 'legacy' | 'engine_v1' | 'engine_v2' …
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

export const VARIANT_LABELS = {
  legacy:    'Legacy',
  engine_v1: 'Engine V1',
};

/** @typedef {'legacy'|'engine_v1'|`engine_v${number}`} VariantId */

/**
 * @typedef {Object} Variant
 * @property {VariantId} variantId
 * @property {string}    displayLabel
 * @property {Function}  component          React component
 * @property {string}    componentName      for ⓘ tooltip
 * @property {Function}  engineFactory      async (ctx) => engine
 * @property {string}    engineName         for ⓘ tooltip
 */

/**
 * @typedef {Object} ProductEntry
 * @property {string}   productId
 * @property {string}   displayLabel
 * @property {string}   category            existing PLUGIN_CATEGORIES id
 * @property {string}   legacyType          string matched against inst.type for back-compat
 * @property {Record<VariantId, Variant>} variants
 */

/** @type {ProductEntry[]} */
export const REGISTRY = [
  {
    productId:    'panther_buss',
    displayLabel: 'Panther Buss',
    category:     'Dynamics',
    legacyType:   'drumbus',
    variants: {
      legacy: {
        variantId:     'legacy',
        displayLabel:  VARIANT_LABELS.legacy,
        component:     DrumBusOrb,
        componentName: 'DrumBusOrb',
        engineFactory: lazy(() => import('../drumBusEngine.js'), 'createDrumBusEngine'),
        engineName:    'drumBusEngine',
      },
      engine_v1: {
        variantId:     'engine_v1',
        displayLabel:  VARIANT_LABELS.engine_v1,
        component:     PantherBussOrb,
        componentName: 'PantherBussOrb',
        engineFactory: lazy(() => import('../pantherBussEngine.js'), 'createPantherBussEngine'),
        engineName:    'pantherBussEngine',
      },
    },
  },
  {
    // MANchild — Fairchild-inspired vari-mu 670M stereo compressor.
    // First-version flagship compressor. Shipped as `legacy` (DEV_RULES G4
    // minimum). Once a new engine revision ships, promote the current one
    // to `engine_v1` and migrate this entry accordingly.
    productId:    'manchild',
    displayLabel: 'MANchild',
    category:     'Dynamics',
    legacyType:   'manchild',
    variants: {
      legacy: {
        variantId:     'legacy',
        displayLabel:  VARIANT_LABELS.legacy,
        component:     ManChildOrb,
        componentName: 'ManChildOrb',
        engineFactory: lazy(() => import('../manChild/manChildEngine.js'), 'createManChildEngine'),
        engineName:    'manChildEngine',
      },
      engine_v1: {
        variantId:     'engine_v1',
        displayLabel:  VARIANT_LABELS.engine_v1,
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
    // saturation + octave-down granular shifter. Shipped as `legacy`
    // (DEV_RULES G4); promote to engine_v1 on next rev.
    productId:    'flapjackman',
    displayLabel: 'Flap Jack Man',
    category:     'Character',
    legacyType:   'flapjackman',
    variants: {
      legacy: {
        variantId:     'legacy',
        displayLabel:  VARIANT_LABELS.legacy,
        component:     FlapJackManOrb,
        componentName: 'FlapJackManOrb',
        engineFactory: lazy(() => import('../nastybeast/nastyBeastEngine.js'), 'createNastyBeastEngine'),
        engineName:    'nastyBeastEngine',
      },
    },
  },
  {
    // Lofi Loofy — tape/cassette/sampler vibe box. Same-day build as
    // ManChild on Engine_V1; registered as `legacy` (first shipped rev
    // per DEV_RULES G4). Promote to engine_v1 on next rev.
    productId:    'lofi_loofy',
    displayLabel: 'Lofi Loofy',
    category:     'Character',
    legacyType:   'lofiLoofy',
    variants: {
      legacy: {
        variantId:     'legacy',
        displayLabel:  VARIANT_LABELS.legacy,
        component:     LofiLoofyOrb,
        componentName: 'LofiLoofyOrb',
        engineFactory: lazy(() => import('../lofiLoofy/lofiLoofyEngine.js'), 'createLofiLoofyEngine'),
        engineName:    'lofiLoofyEngine',
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
export function getVariant(productId, variantId) {
  const p = BY_ID.get(productId);
  return p ? p.variants[variantId] || null : null;
}

// Invariants — cheap asserts so a bad registry fails at boot.
for (const p of REGISTRY) {
  if (!p.variants.legacy) throw new Error(`[registry] ${p.productId} missing legacy variant`);
  for (const [k, v] of Object.entries(p.variants)) {
    if (v.variantId !== k) throw new Error(`[registry] ${p.productId}.${k} variantId mismatch`);
  }
}
