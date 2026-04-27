// recipes.mjs — recipe-level (graph) behavioral specs.
//
// Each entry corresponds to a graph.json under test/fixtures/codegen/.
// `category` routes to a metric module (see runner.mjs CATEGORY_DISPATCH).
// `graphPath` is resolved relative to the repo root by check_recipe_behavioral.mjs.
//
// Declared values are RECIPE-LEVEL — they account for makeup gain and any
// post-processing in the chain. For NastyNeve v1: gainComputer threshold is
// -18 dB internally, but the static curve measured at the recipe's
// out terminal includes +6 dB makeup, so threshold_recipe_db = -18 + 6 = -12.
// (Or close to it — the soft-knee blends, plus a small RMS-vs-peak fudge.)

// Calibration notes:
//   threshold_recipe_db = gainComputer.thresholdDb + (makeup or output gain)
//   unity_makeup_gain_db = whatever net gain a sub-threshold tone sees
// All four recipes share the same compressor core (envelope τ 5/200–250 ms,
// thr=-18, ratio=4, knee=6), so attack/release T90 stay close to v1's values.

export const RECIPE_BEHAVIORAL = {
  nasty_neve_v1: {
    category: 'compressorRecipe',
    graphPath: 'test/fixtures/codegen/nasty_neve_v1.graph.json',
    declared: {
      // Static curve — measured at recipe out (includes makeup).
      // gainComputer.thresholdDb = -18, makeup = +6 → recipe threshold ≈ -12.
      threshold_recipe_db: -12,
      ratio: 4,
      threshold_tol_db: 4,    // soft knee + RMS-of-sine fudge → wider tol
      ratio_tol_pct:    35,   // recipe-level ratio is fuzzier than op-level

      // Step response — recipe-level T90 measured on the GR signal
      // (= 20·log10(out_env / in_env)). Op-level envelope T90 ≈ 2.303·τ,
      // but at the RECIPE level gainComputer's static curve nonlinearly
      // shapes the GR trajectory: once envelope crosses below threshold,
      // GR snaps to 0 long before the envelope finishes decaying. So
      // GR-T90 < envelope-T90, and ratio depends on threshold/ratio/knee.
      //
      // Calibration (NastyNeve v1, attack=5/release=250 ms τ, thr=-18, ratio=4):
      //   measured attack T90 ≈ 24 ms (envelope ramps up + GR engages)
      //   measured release T90 ≈ 340 ms
      attack_t90_ms:   24,
      release_t90_ms: 340,
      attack_tol_pct:  40,
      release_tol_pct: 30,

      // Sub-threshold unity check — at low signal the recipe is 1:1 + makeup.
      unity_test_dbfs:      -50,
      unity_makeup_gain_db: 6,    // n_makeup.gainDb
      unity_tol_db:         1.0,
    },
  },

  // ── NastyNeve v2 — adds n_in (gain), n_mix (full wet @ amount=1), n_out (gain).
  //    No makeup gain stage; n_in=0, n_out=0. Recipe threshold equals
  //    gainComputer.threshold (no offset). Sub-threshold gain = 0 dB.
  nasty_neve_v2: {
    category: 'compressorRecipe',
    graphPath: 'test/fixtures/codegen/nasty_neve_v2.graph.json',
    declared: {
      threshold_recipe_db: -18,
      ratio: 4,
      threshold_tol_db: 4,
      ratio_tol_pct:    35,
      attack_t90_ms:    24,
      release_t90_ms:  340,
      attack_tol_pct:   40,
      release_tol_pct:  30,
      unity_test_dbfs:      -50,
      unity_makeup_gain_db: 0,
      unity_tol_db:         1.0,
    },
  },

  // ── NastyNeve v3 — v2 plus xformerSat post-mix (drive=6 dB).
  //    The xformerSat with drive=+6 dB adds ≈ +6 dB of net gain at low
  //    signal level (the drive parameter scales output, not just THD), so
  //    sub-threshold unity = +6 dB and recipe threshold lifts by the same
  //    +6 dB → -12 dB.  Release T90 is unreliable in v3 because the
  //    xformer's amplitude-dependent gain pollutes the GR measurement
  //    (out_env/in_env no longer reflects compressor GR alone), so we
  //    skip it via skip_release_t90.
  nasty_neve_v3: {
    category: 'compressorRecipe',
    graphPath: 'test/fixtures/codegen/nasty_neve_v3.graph.json',
    declared: {
      threshold_recipe_db: -12,
      ratio: 4,
      threshold_tol_db: 5,
      ratio_tol_pct:    40,
      attack_t90_ms:    24,
      attack_tol_pct:   60,    // xformer adds noise to early GR trace
      skip_release_t90: true,  // v1 covers release; v3's adds nothing
      unity_test_dbfs:      -50,
      unity_makeup_gain_db: 6,    // xformer drive contributes +6 dB
      unity_tol_db:         1.5,
    },
  },

  // ── nasty_3btn — preset-mode comp. Defaults: attack=5, release=200 ms,
  //    thr=-18, ratio=4, knee=6, makeup=+5 → recipe threshold ≈ -13.
  nasty_3btn: {
    category: 'compressorRecipe',
    graphPath: 'test/fixtures/codegen/nasty_3btn.graph.json',
    declared: {
      threshold_recipe_db: -13,
      ratio: 4,
      threshold_tol_db: 4,
      ratio_tol_pct:    35,
      attack_t90_ms:    24,
      release_t90_ms:  280,    // shorter τ (200 ms) → shorter recipe T90
      attack_tol_pct:   40,
      release_tol_pct:  35,
      unity_test_dbfs:      -50,
      unity_makeup_gain_db: 5,    // n_makeup.gainDb
      unity_tol_db:         1.0,
    },
  },
};
