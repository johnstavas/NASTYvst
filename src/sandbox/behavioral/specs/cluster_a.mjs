// cluster_a.mjs — behavioral specs for Tier-S Character Cluster A GR cells.
//
// Day 1 deliverable. Behavioral metadata lives in this sidecar rather than
// being inlined into the 160 KB opRegistry.js — same effect, surgical edit
// footprint. Day 5 protocol bind moves these into opRegistry as the .behavioral
// field per the design doc § 4 schema.
//
// Each entry's shape:
//   defaultParams:   params applied to the worklet before testing
//   declared:        what the op promises (see compressor.mjs for fields)
//   tolerances:      per-metric overrides on default tolerances

export const CLUSTER_A_BEHAVIORAL = {
  // ──────────────────────────────────────────────────────────────
  // #141 optoCell — LA-2A T4 cell
  //   NOTE: optoCell has a different port shape from sibling cells:
  //     inputs:  [cv]          (control voltage in)
  //     outputs: [gain]        (gain coefficient out — to be applied externally)
  //   It is a pure transfer-curve generator, not an in-line audio processor.
  //   The compressor metric module here doesn't fit cleanly; it's marked
  //   for migration to the `analyzer` category in Day 2 (curve-generator
  //   metric battery: input-vs-output linearity over declared range).
  // ──────────────────────────────────────────────────────────────
  // optoCell migrated to specs/foundation.mjs ANALYZER_BEHAVIORAL (Day 2).

  // ──────────────────────────────────────────────────────────────
  // #142 blackmerVCA — dbx / THAT 2180
  // ──────────────────────────────────────────────────────────────
  blackmerVCA: {
    category: 'compressor',
    tldr: 'Clean, transparent CV-controlled volume. The quiet compressor cell — pumps with zero coloration. dbx 2180 / SSL bus-comp DNA.',
    defaultParams: {
      bias:          0.0,    // clean (no class-AB asymmetry)
      trim:          0,
    },
    declared: {
      // SIGN CONVENTION NOTE: blackmerVCA uses cv = dB of gain ADJUSTMENT.
      // Positive cv = amplification, negative cv = attenuation. This is
      // OPPOSITE to varMuTube / fetVVR / diodeBridgeGR (which use positive
      // cv = compression depth). This catalog inconsistency is logged as
      // a known footgun for graph composition; sign conversion belongs
      // upstream of the cell.
      cv_sweep_linear: [0, -1, -3, -6, -9, -12, -18, -24],
      cv_for_6db_gr:   -6,
      // blackmerVCA is mathematically linear: cv (dB) maps directly to gain (dB).
      // So cv=-24 → 24 dB GR. (Original spec said 18 dB — that was an arbitrary
      // pre-measurement guess that didn't account for the linear-in-dB law.
      // Calibrated to actual measurement 2026-04-27.)
      gr_at_max_cv_db: 24,
      audio_test_dbfs: -12,
      // NOTE: Cluster A cells are memoryless (getLatencySamples=0, no state).
      // Attack/release time-constants belong to the envelopeFollower upstream,
      // not the cell itself. Declared as null here so the harness skips T90.
      attack_ms:   null,
      release_ms:  null,
      thd_grows_with_gr: false,  // blackmer is CLEAN by default; bias=0 → linear
      unity_gain_at_zero_cv: 1.0,
    },
    tolerances: {
      attack_ms_pct: 50,
      release_ms_pct: 30,
    },
  },

  // ──────────────────────────────────────────────────────────────
  // #145 varMuTube — Manley / Fairchild 670
  // ──────────────────────────────────────────────────────────────
  varMuTube: {
    category: 'compressor',
    tldr: 'Smooth, fat, glued tube compression. Manley Vari-Mu / Fairchild 670 — even-harmonic warmth that grows with compression.',
    defaultParams: {
      // Default cutoffScale floor is 1.0 in the worklet (the very bug we're
      // hunting). At default cutoffScale=10, cv up to 8 should still show a
      // working knee. We test BOTH the default-param case (where the cell
      // SHOULD work given the right cv range) AND validate the knee actually
      // appears within the declared sweep.
      cutoffScale:   10,
      curveExponent: 1.5,
      distortion:    0.0,
      trim:          0,
    },
    declared: {
      // Sweep wide because cutoffScale=10 needs cv approaching 10+ for GR.
      cv_sweep_linear: [0.0, 1.0, 3.0, 5.0, 8.0, 12.0, 20.0, 30.0],
      cv_for_6db_gr:   10.0,   // = cutoffScale (Hill-fn -6 dB knee)
      gr_at_max_cv_db: 18,     // expect significant GR by cv=30
      audio_test_dbfs: -12,
      attack_ms:   null,  // memoryless cell
      release_ms:  null,
      thd_grows_with_gr: false,  // distortion=0, expect flat THD
      unity_gain_at_zero_cv: 1.0,
    },
    tolerances: {
      attack_ms_pct: 60,
      release_ms_pct: 40,
    },
  },

  // ──────────────────────────────────────────────────────────────
  // #147 fetVVR — UREI 1176
  // ──────────────────────────────────────────────────────────────
  fetVVR: {
    category: 'compressor',
    tldr: 'Snappy FET pump. UREI 1176 character — sharp, fast compression that grabs drums and vocals.',
    defaultParams: {
      cutoffScale:    1.0,
      curveExponent:  2.0,
      distortion2H:   0.0,
      distortion3H:   0.0,
      trim:           0,
    },
    declared: {
      cv_sweep_linear: [0.0, 0.1, 0.3, 0.5, 1.0, 2.0, 4.0],
      // Hill function gain = 1/(1 + (cv/1.0)^2) with β=2.0. At cv=1.0 the
      // denominator is exactly 2 → gain = 0.5 = -6 dB GR. At cv=4 the
      // denominator is 17 → gain ≈ 0.0588 = -24.6 dB. (Pre-measurement spec
      // said 0.5 / 20 — calibrated to actual Hill math 2026-04-27.)
      cv_for_6db_gr:   1.0,
      gr_at_max_cv_db: 24,
      audio_test_dbfs: -12,
      attack_ms:   null,  // memoryless cell
      release_ms:  null,
      thd_grows_with_gr: false,  // distortion knobs at zero
      unity_gain_at_zero_cv: 1.0,
    },
    tolerances: {
      attack_ms_pct: 80,    // sub-ms attack is hard to measure precisely
      release_ms_pct: 30,
    },
  },

  // ──────────────────────────────────────────────────────────────
  // #179 diodeBridgeGR — Neve 33609 / 2254
  // ──────────────────────────────────────────────────────────────
  diodeBridgeGR: {
    category: 'compressor',
    tldr: 'British bus-comp crunch. Neve 33609 / 2254 — pure 3rd-harmonic glow that BLOOMS as you push more compression.',
    defaultParams: {
      cutoffScale:   1.0,
      curveExponent: 1.8,
      distortion:    0.0,
      asymmetry:     0.0,
      trim:          0,
    },
    declared: {
      cv_sweep_linear: [0.0, 0.1, 0.3, 0.5, 1.0, 2.0, 4.0],
      // Hill function gain = 1/(1 + (cv/1.0)^1.8). At cv=1.0 the denominator
      // is exactly 2 → gain = 0.5 = -6 dB GR. At cv=4 the denominator is
      // ~13.13 → gain ≈ 0.076 = -22.4 dB. (Pre-measurement spec said 0.5 / 16
      // — calibrated to actual Hill math 2026-04-27.)
      cv_for_6db_gr:   1.0,
      gr_at_max_cv_db: 22,
      audio_test_dbfs: -12,
      attack_ms:   null,  // memoryless cell
      release_ms:  null,
      thd_grows_with_gr: false,  // distortion at zero
      unity_gain_at_zero_cv: 1.0,
    },
    tolerances: {
      attack_ms_pct: 50,
      release_ms_pct: 30,
    },
  },
};
