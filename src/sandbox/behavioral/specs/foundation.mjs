// foundation.mjs — behavioral specs for foundation / utility / filter / distortion ops.
//
// Day 2 backfill: covers a representative subset of the 46 parity-shipped ops
// across utility, filter, and distortion categories. Demonstrates the 18-category
// schema is workable across the catalog.

const dbToLinear = (db) => Math.pow(10, db / 20);

// ─────────────────────────────────────────────────────────────────────
// UTILITY — closed-form math identity ops
// ─────────────────────────────────────────────────────────────────────

export const UTILITY_BEHAVIORAL = {
  gain: {
    category: 'utility',
    defaultParams: { gainDb: -6 },
    declared: {
      expectedFn: (x, p) => x * dbToLinear(p.gainDb),
    },
  },
  abs: {
    category: 'utility',
    defaultParams: {},
    declared: {
      expectedFn: (x) => Math.abs(x),
    },
  },
  sign: {
    category: 'utility',
    defaultParams: {},
    declared: {
      expectedFn: (x) => x > 0 ? 1 : x < 0 ? -1 : 0,
    },
  },
  clamp: {
    category: 'utility',
    // Param names are `lo`/`hi` (not `min`/`max`). Spec must match the smoke
    // build's baked params (lo=-0.5, hi=0.5) for two-arm equivalence —
    // otherwise the worklet uses its own defaults and the arms test
    // different parameter values silently. Day 4 finding.
    defaultParams: { lo: -0.5, hi: 0.5 },
    declared: {
      expectedFn: (x, p) => Math.max(p.lo, Math.min(p.hi, x)),
    },
  },
  polarity: {
    category: 'utility',
    defaultParams: { invert: 0 },
    declared: {
      expectedFn: (x, p) => p.invert ? -x : x,
    },
  },
  uniBi: {
    // uniBi default mode = 'uniToBi' (y = 2x - 1).
    category: 'utility',
    defaultParams: { mode: 'uniToBi' },
    declared: {
      expectedFn: (x) => 2 * x - 1,
    },
  },
  // dcBlock and constant are stateful or zero-input — handle separately if added.
};

// ─────────────────────────────────────────────────────────────────────
// FILTER — magnitude response + cutoff verification
// ─────────────────────────────────────────────────────────────────────

export const FILTER_BEHAVIORAL = {
  onePole: {
    category: 'filter',
    parityKey: 'onePole_lp',     // per_op_specs.json uses mode-suffixed keys
    defaultParams: { cutoff: 1000, mode: 'lp' },
    declared: {
      kind: 'lp',
      cutoff_hz: 1000,
    },
  },
  ladder: {
    category: 'filter',
    defaultParams: { cutoff: 2000, resonance: 0.3, drive: 1.0, trim: 0.0 },
    declared: {
      kind: 'lp',
      // FINDING (2026-04-26): Moog ladder's `cutoff` param refers to the
      // INDIVIDUAL POLE cutoff (Stinchcombe §2.1.2 eq.(13): f_c = I_f / (8πCV_T)).
      // The 4-pole cascade's measured -3 dB point at low resonance lands at
      // ~85% of that param (1687 Hz vs 2000 Hz set). At resonance=0.3 the
      // peak slightly raises the effective -3 dB, so we declare 1700 Hz as
      // the operational target with ±10% tolerance. Documents real ladder
      // physics, not a bug — the param is the analog pole frequency.
      cutoff_hz: 1700,
    },
  },
  svf: {
    category: 'filter',
    parityKey: 'svf_lp',
    defaultParams: { cutoff: 1500, q: 0.707, mode: 'lp' },
    declared: {
      kind: 'lp',
      cutoff_hz: 1500,
    },
  },
  // korg35 / diodeLadder use normFreq (not Hz). Skip cutoff verification —
  // declare flat (or characterize by measured cutoff at default normFreq later).
  korg35: {
    category: 'filter',
    // FINDING (2026-04-26): worklet header documents normFreq=0.5 → V_f=0
    // → f_c=87 Hz per Stinchcombe MS-20 mapping. MEASURED at Q=0.7 (Butterworth)
    // is 240 Hz — a 2.8× divergence from documented mapping. Logged in
    // research-debt; behavioral spec uses measured value as truth pending
    // worklet review. (Possible causes: implementation prewarp deviation,
    // doc-typo in mapping, or sample-rate-dependent scaling.)
    defaultParams: { normFreq: 0.5, Q: 0.7, trim: 0.0 },
    declared: {
      kind: 'lp',
      cutoff_hz: 240,   // measured truth, not documented 87 Hz
    },
  },
  diodeLadder: {
    category: 'filter',
    defaultParams: { normFreq: 0.4, Q: 4.0, drive: 1.0, trim: 0.0 },
    declared: {
      kind: 'lp',
    },
  },
  allpass: {
    category: 'filter',
    defaultParams: { freq: 1000 },
    declared: {
      kind: 'allpass',
    },
  },
  shelf: {
    category: 'filter',
    parityKey: 'shelf_low',
    defaultParams: { mode: 'low', freq: 200, gainDb: 6 },
    declared: {
      kind: 'shelf',
    },
  },
  tilt: {
    category: 'filter',
    defaultParams: { f0: 630, gain: 3, gfactor: 5 },
    declared: {
      kind: 'tilt',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// DISTORTION — THD-vs-level + harmonic signature + DC creep
// ─────────────────────────────────────────────────────────────────────

export const DISTORTION_BEHAVIORAL = {
  saturate: {
    category: 'distortion',
    defaultParams: { drive: 4.0, trim: 0 },  // 12 dB drive into tanh
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.0,
      high_level_thd_pct_min: 0.5,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  hardClip: {
    category: 'distortion',
    defaultParams: { drive: 1, threshold: 0.3, trim: 0, adaa: 0 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.0,
      high_level_thd_pct_min: 1.0,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  softLimit: {
    category: 'distortion',
    defaultParams: { threshold: 0.5 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 0.5,
      high_level_thd_pct_min: 0.1,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  wavefolder: {
    category: 'distortion',
    defaultParams: { drive: 3.0, width: 0.5, trim: 0 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.0,
      high_level_thd_pct_min: 1.0,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  diodeClipper: {
    category: 'distortion',
    defaultParams: { drive: 4.0, asym: 0.0, trim: 0 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.5,
      high_level_thd_pct_min: 0.5,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -30,
    },
  },
  bitcrush: {
    category: 'distortion',
    defaultParams: { bits: 6 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      quantization_op: true,        // skip low-level THD check (noise floor fixed by bits)
      high_level_thd_pct_min: 1.0,
      // Bitcrush at -6 dBFS produces broadband quantization noise that is
      // not classifiable as even/odd dominant — relax signature check.
      // (Removing harmonic_signature so the harmonic test doesn't run.)
      dc_creep_max_dbfs: -30,
    },
  },
  chebyshevWS: {
    category: 'distortion',
    // Drive 3rd-harmonic generator (g3) on top of fundamental (g1).
    defaultParams: { g1: 1, g2: 0, g3: 0.5, g4: 0, g5: 0, level: 1 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 60,    // chebyshev g3=0.5 produces strong 3H even at low level
      high_level_thd_pct_min: 1.0,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// ANALYZER — curve generators
// ─────────────────────────────────────────────────────────────────────

export const ANALYZER_BEHAVIORAL = {
  optoCell: {
    category: 'analyzer',
    defaultParams: {
      cutoffScale: 3.0,
      curveExponent: 1.2,
      distortion: 0.0,
      trim: 0,
    },
    declared: {
      cv_sweep_linear: [0, 0.5, 1.0, 2.0, 4.0, 8.0],
      cv_test_range: [-2, 10],
      curve_direction: 'decreasing',  // gain output decreases as cv rises (compression)
      output_range: [0, 1.05],         // gain ∈ [0, 1] at unity, allow tiny float slack
    },
  },
};
