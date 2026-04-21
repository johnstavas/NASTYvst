// qcPresets.js — canonical QC preset generator.
//
// Consumes `engine.capabilities` (see memory/qc_family_map.md §2) +
// `engine.paramSchema` (the param descriptor array) and emits an array of
// QC preset objects the harness can sweep via the existing audit pipeline.
//
// Each QC preset is independent of plugin-authored presets. Tier 1+2 fire
// unconditionally; Tier 3+4 are gated on capability flags. Long-session
// drift tests are opt-in only (enabled by the "SWEEP ALL + LONG" button).
//
// Output shape (one per preset):
//   {
//     id:      string,          // stable unique ID (for dedupe + reporting)
//     label:   string,          // human-readable, shown in analyzer
//     tier:    1 | 2 | 3 | 4,   // which tier scheduled it
//     ruleId:  string,          // maps to a rule in qcAnalyzer.js
//     source:  'qc',            // distinguishes from plugin presets
//     params:  { setterName: value, ... },  // applied to engine
//     meta?:   { ... },         // rule-specific context (freq, duration, etc)
//   }
//
// Contract: the sweeper applies `params` by calling each `engine[setterName](value)`
// in insertion order. Missing setters are skipped silently — not all plugins
// expose every neutral. The sweeper then captures a snapshot + engine state,
// and qcAnalyzer.js evaluates the associated rule.
//
// IMPORTANT: this file DOES NOT run any DSP. It only generates preset
// descriptors. Actual null-test evaluation lives in qcAnalyzer.js.

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a neutral param map from the schema's declared defaults. */
function neutralFromSchema(paramSchema) {
  const out = {};
  if (!Array.isArray(paramSchema)) return out;
  for (const p of paramSchema) {
    if (p.kind === 'noop' || p.kind === 'preset') continue;
    if (p.def !== undefined) out[p.name] = p.def;
  }
  return out;
}

/** Find a schema entry by name (first match). */
function findParam(paramSchema, name) {
  if (!Array.isArray(paramSchema)) return null;
  return paramSchema.find(p => p.name === name) || null;
}

/** Pick the first matching setter name from a list of candidates. */
function pickSetter(paramSchema, candidates) {
  for (const n of candidates) {
    if (findParam(paramSchema, n)) return n;
  }
  return null;
}

/** Min/max of a numeric param, falling back to 0/1. */
function rangeOf(param) {
  if (!param) return { min: 0, max: 1 };
  return { min: param.min ?? 0, max: param.max ?? 1 };
}

// ── Tier 1 — universal correctness (every plugin) ─────────────────────────
//
// 1a. Mix null triad: Mix=0 bypass null, Mix=50 sanity, Mix=100 transparent.
// 1b. FB-tap vs Mix coupling: sweep Mix at fixed feedback/drive.
// 1c. Zipper sweep: neutral + one knob per continuous param forced to max.
//     (The actual zipper rule modulates the knob; here we emit the starting
//     preset at max — the rule in qcAnalyzer handles the modulation.)
// 1d. Mode-switching storm: one preset per declared mode, neutral otherwise.

function tier1(capabilities, paramSchema) {
  const presets = [];
  const neutral = neutralFromSchema(paramSchema);
  const mixName = pickSetter(paramSchema, ['setMix', 'setWet', 'setDryWet']);

  // 1a. Mix null triad
  if (mixName) {
    presets.push({
      id: 'qc_t1_mix_0',
      label: 'QC · T1 · Mix=0 (bypass null)',
      tier: 1, ruleId: 'mix_null', source: 'qc',
      params: { ...neutral, [mixName]: 0 },
    });

    // 1a-bis. Coloration-bearing null — the canonical test for plugins
    // with always-on in-worklet coloration stages (tubes, tape, transformers).
    // These plugins can't pass the absolute Mix=0 null (mix_null self-disables)
    // because the dry leg's cross-correlated null is capped near −53 dB by
    // integer-sample alignment, and coloration means dry≠in anyway. The series
    // test sidesteps both: capture A→out_ref, then feed out_ref back through
    // the SAME engine at Mix=0 → out_test, and null the two buffers directly.
    // Both passes share the same latency by construction, so no alignment is
    // needed and the null is bit-exact-floor-limited (< −100 dB is realistic).
    //
    // Requires capture-layer support: the sweeper must recognize this ruleId
    // and perform a two-pass offline render (see Analyzer.jsx TODO at the QC
    // sweep loop). Until that lands, the generator still emits the preset
    // so the capture work has a fixed interface to target. The analyzer
    // rule self-disables (no hits) when `measurements.seriesNullRmsDb` is
    // absent from the snapshot — rolling this out is safe-by-default.
    //
    // Gated on capabilities.nonlinearStages > 0. For linear plugins the
    // absolute mix_null already covers the same contract, so there's no
    // point doubling capture cost.
    if ((capabilities?.nonlinearStages ?? 0) > 0) {
      presets.push({
        id: 'qc_t1_mix_null_series',
        label: 'QC · T1 · Mix=0 series null (coloration-bearing)',
        tier: 1, ruleId: 'mix_null_series', source: 'qc',
        params: { ...neutral, [mixName]: 0 },
        meta: { chainLength: 2, secondInstanceMix: 0, refPass: 'neutral' },
      });
    }

    presets.push({
      id: 'qc_t1_mix_100',
      label: 'QC · T1 · Mix=100 (wet only)',
      // Tagged mix_identity even though the rule isn't built yet (needs
      // a reference-wet capture step). Records measurements; silent in
      // the current analyzer — will light up when the capture extension
      // lands. Splitting ruleIds now avoids another generator edit later.
      tier: 1, ruleId: 'mix_identity', source: 'qc',
      params: { ...neutral, [mixName]: 1 },
    });
    presets.push({
      id: 'qc_t1_mix_50',
      label: 'QC · T1 · Mix=50 (mid-point sanity)',
      // Emits a mix=0.5 capture; the hook (renderMixSanity) re-renders
      // dry (Mix=0) and wet (Mix=1) references in the same sweep and
      // compares. Meta carries mixName + neutral so the hook can build
      // sibling param objects without re-resolving paramSchema.
      tier: 1, ruleId: 'mix_sanity', source: 'qc',
      params: { ...neutral, [mixName]: 0.5 },
      meta: { mixName, neutralParams: { ...neutral } },
    });
  }

  // 1b-bis. DC rejection under feedback — silent input, max FB/drive,
  // measure output DC. Any nonzero mean indicates denormal rectification,
  // asymmetric NL feeding DC into the FB accumulator, or uninit state.
  // All three cause audible bypass-unbypass thumps in a DAW. T1 because
  // a plugin that thumps in every session is ship-blocking.
  if (capabilities?.hasFeedback) {
    const fbName    = pickSetter(paramSchema, ['setFeedback', 'setFB', 'setDecay']);
    const driveName = pickSetter(paramSchema, ['setDrive', 'setTxDrive', 'setIn']);
    const paramsMax = { ...neutral };
    if (fbName) {
      const p = findParam(paramSchema, fbName);
      paramsMax[fbName] = rangeOf(p).max;
    }
    if (driveName) {
      const p = findParam(paramSchema, driveName);
      paramsMax[driveName] = rangeOf(p).max;
    }
    presets.push({
      id: 'qc_t1_dc_rejection_fb',
      label: 'QC · T1 · DC rejection (silent input + max FB/drive)',
      tier: 1, ruleId: 'dc_rejection_fb', source: 'qc',
      params: paramsMax,
      meta: { signalSource: 'silence', durationMs: 10000 },
    });
  }

  // 1b. FB-tap vs Mix coupling — only meaningful if feedback is a declared capability
  if (capabilities?.hasFeedback && mixName) {
    for (const m of [0, 0.25, 0.5, 0.75, 1]) {
      presets.push({
        id: `qc_t1_fb_mix_${Math.round(m * 100)}`,
        label: `QC · T1 · FB-coupling · Mix=${Math.round(m * 100)}%`,
        tier: 1, ruleId: 'fb_mix_coupling', source: 'qc',
        params: { ...neutral, [mixName]: m },
        meta: { mixValue: m },
      });
    }
  }

  // 1c. Zipper sweep — one preset per continuous param at its max.
  // The rule (qcAnalyzer: 'zipper') modulates the knob at 10 Hz during capture.
  if (Array.isArray(paramSchema)) {
    for (const p of paramSchema) {
      if (p.kind !== 'unit' && p.kind !== 'db' && p.kind !== 'hz') continue;
      const { max } = rangeOf(p);
      presets.push({
        id: `qc_t1_zipper_${p.name}`,
        label: `QC · T1 · Zipper · ${p.label || p.name}`,
        tier: 1, ruleId: 'zipper', source: 'qc',
        params: { ...neutral, [p.name]: max },
        meta: { targetParam: p.name, modHz: 10 },
      });
    }
  }

  // 1d. Mode-switching storm — one preset per mode (composite-bus plugins).
  const modes = capabilities?.modes;
  if (Array.isArray(modes) && modes.length > 0) {
    const modeSetter = pickSetter(paramSchema, ['setChannelMode', 'setMode', 'setStyle']);
    const modeParam = findParam(paramSchema, modeSetter);
    for (let i = 0; i < modes.length; i++) {
      const val = modeParam?.values?.[i]?.value ?? i;
      presets.push({
        id: `qc_t1_mode_${i}_${String(modes[i]).replace(/\W+/g, '_')}`,
        label: `QC · T1 · Mode = ${modes[i]}`,
        tier: 1, ruleId: 'mode_storm', source: 'qc',
        params: modeSetter ? { ...neutral, [modeSetter]: val } : { ...neutral },
        meta: { modeIndex: i, modeLabel: modes[i] },
      });
    }
  }

  return presets;
}

// ── Tier 2 — high-value, cheap (every plugin except pure pass-through) ────
//
// 2a. Impulse/Dirac — IR capture. Signal source handled by harness.
// 2b. Denormal tail — feedback/decay at max, then silence.
// 2c. Pathological stereo — L=R, L=-R, L-only, R-only. Signal source handled.
// 2d. DC / near-Nyquist sines — 4 presets, each tags the freq.
// 2e. Bypass-exact.

function tier2(capabilities, paramSchema) {
  const presets = [];
  const neutral = neutralFromSchema(paramSchema);
  const bypassName = pickSetter(paramSchema, ['setBypass']);

  // 2a. Impulse
  presets.push({
    id: 'qc_t2_impulse',
    label: 'QC · T2 · Impulse (IR capture)',
    tier: 2, ruleId: 'impulse_ir', source: 'qc',
    params: { ...neutral },
    meta: { signalSource: 'impulse' },
  });

  // 2b. Denormal tail — push feedback/decay where possible
  const fbParam = pickSetter(paramSchema, ['setFeedback', 'setDecay', 'setRT60']);
  const denormalParams = { ...neutral };
  if (fbParam) {
    const p = findParam(paramSchema, fbParam);
    const { max } = rangeOf(p);
    denormalParams[fbParam] = max * 0.99;
  }
  presets.push({
    id: 'qc_t2_denormal',
    label: 'QC · T2 · Denormal tail (30s silence after burst)',
    tier: 2, ruleId: 'denormal_tail', source: 'qc',
    params: denormalParams,
    meta: { silenceTailMs: 30000 },
  });

  // 2c. Pathological stereo — 4 signal variants at neutral params
  for (const variant of ['mono_LR', 'side_only', 'L_only', 'R_only']) {
    presets.push({
      id: `qc_t2_stereo_${variant}`,
      label: `QC · T2 · Stereo = ${variant}`,
      tier: 2, ruleId: 'pathological_stereo', source: 'qc',
      params: { ...neutral },
      meta: { signalSource: 'stereo', variant },
    });
  }

  // 2d. DC / near-Nyquist sines
  for (const freq of [0, 10, 'nyquist_0_45', 'nyquist_0_49']) {
    presets.push({
      id: `qc_t2_freq_${freq}`,
      label: `QC · T2 · ${freq === 0 ? 'DC' : freq} Hz sine`,
      tier: 2, ruleId: 'extreme_freq', source: 'qc',
      params: { ...neutral },
      meta: { signalSource: 'sine', freq },
    });
  }

  // 2f. Orthogonal feedback — T2. Only fires when the plugin declares a
  // specific FDN matrix family (capabilities.feedbackMatrix === 'hadamard'
  // | 'householder'). Renders an impulse with decay high-but-not-max (so
  // there's a measurable tail without tripping runaway guards) and measures
  // per-channel log-RMS slope. Orthogonal matrices preserve energy across
  // taps uniformly → L/R decay slopes and initial tail energy should match
  // within tight tolerance. Asymmetry = sign/normalization typo in the
  // matrix constants.
  if (capabilities?.feedbackMatrix === 'hadamard' ||
      capabilities?.feedbackMatrix === 'householder') {
    const decayName = pickSetter(paramSchema, ['setDecay', 'setRT60', 'setFeedback']);
    const paramsOf = { ...neutral };
    if (decayName) {
      const p = findParam(paramSchema, decayName);
      const { min, max } = rangeOf(p);
      paramsOf[decayName] = min + (max - min) * 0.7;
    }
    presets.push({
      id: 'qc_t2_orthogonal_feedback',
      label: 'QC · T2 · Orthogonal feedback (per-channel decay match)',
      tier: 2, ruleId: 'orthogonal_feedback', source: 'qc',
      params: paramsOf,
      meta: {
        signalSource: 'impulse',
        durationMs: 5000,
        decayFrac: 0.7,
        matrixFamily: capabilities.feedbackMatrix,
      },
    });
  }

  // 2e. Bypass-exact
  if (bypassName) {
    presets.push({
      id: 'qc_t2_bypass_exact',
      label: 'QC · T2 · Bypass exact',
      tier: 2, ruleId: 'bypass_exact', source: 'qc',
      params: { ...neutral, [bypassName]: 1 },
    });
  }

  return presets;
}

// ── Tier 3 — schema-conditional ───────────────────────────────────────────

function tier3(capabilities, paramSchema) {
  const presets = [];
  const neutral = neutralFromSchema(paramSchema);
  const cap = capabilities || {};

  // Freeze / RT60=∞
  if (cap.hasFreeze) {
    const decayName = pickSetter(paramSchema, ['setDecay', 'setRT60', 'setFreeze']);
    const decayParam = findParam(paramSchema, decayName);
    const { max } = rangeOf(decayParam);
    presets.push({
      id: 'qc_t3_freeze',
      label: 'QC · T3 · Freeze (decay ≈ ∞, 30s stability)',
      tier: 3, ruleId: 'freeze_stability', source: 'qc',
      params: decayName ? { ...neutral, [decayName]: max * 0.99 } : { ...neutral },
      meta: { silenceTailMs: 30000 },
    });
  }

  // Sidechain
  if (cap.hasSidechain) {
    for (const key of ['silence', 'hot', 'copy']) {
      presets.push({
        id: `qc_t3_sc_${key}`,
        label: `QC · T3 · Sidechain = ${key}`,
        tier: 3, ruleId: 'sidechain_regime', source: 'qc',
        params: { ...neutral },
        meta: { scKey: key },
      });
    }
  }

  // Feedback runaway
  if (cap.hasFeedback) {
    const fbName = pickSetter(paramSchema, ['setFeedback', 'setFB', 'setDecay']);
    const driveName = pickSetter(paramSchema, ['setDrive', 'setTxDrive', 'setIn']);
    const paramsMax = { ...neutral };
    if (fbName) {
      const p = findParam(paramSchema, fbName);
      paramsMax[fbName] = rangeOf(p).max;
    }
    if (driveName) {
      const p = findParam(paramSchema, driveName);
      paramsMax[driveName] = rangeOf(p).max;
    }
    presets.push({
      id: 'qc_t3_fb_runaway',
      label: 'QC · T3 · Feedback runaway (max FB + max drive + 30 Hz)',
      tier: 3, ruleId: 'feedback_runaway', source: 'qc',
      params: paramsMax,
      meta: { signalSource: 'sine', freq: 30, durationMs: 10000 },
    });
  }

  // Loop-filter stability root (T3).
  //
  // feedback_runaway catches catastrophic blowups at max FB; this catches
  // the subtler class where a pole sits right at / just outside the unit
  // circle. Uses 0.8 × max FB to excite the loop enough that a marginally
  // stable root shows up as slope ≥ 0, without tripping the runaway
  // guard. Drive left at neutral (not max) — we want to probe the LINEAR
  // loop filter, not the nonlinear-in-loop combo (that's its own test).
  if (cap.hasFeedback) {
    const fbName    = pickSetter(paramSchema, ['setFeedback', 'setFB', 'setDecay']);
    const paramsLfsr = { ...neutral };
    if (fbName) {
      const p = findParam(paramSchema, fbName);
      const { min, max } = rangeOf(p);
      paramsLfsr[fbName] = min + (max - min) * 0.8;
    }
    presets.push({
      id: 'qc_t3_loop_filter_stability_root',
      label: 'QC · T3 · Loop-filter stability root (impulse + tail regression)',
      tier: 3, ruleId: 'loop_filter_stability_root', source: 'qc',
      params: paramsLfsr,
      meta: { signalSource: 'impulse', durationMs: 5000, fbFrac: 0.8 },
    });
  }

  // Latency report match.
  //
  // Fires whenever the plugin declares non-zero latency. `hasLookahead`
  // propagates through `meta` so the analyzer can distinguish two modes:
  //   - `hasLookahead === true` → intentional latency (lookahead limiter
  //     prefetch buffer). Rule checks declared === measured, tight gate.
  //   - `hasLookahead` absent/false → unusual: non-zero latency without
  //     a declared lookahead stage is usually a mis-declaration (pipeline
  //     delay not accounted for). Rule can warn on mere existence.
  // Per qc_capability_flags.md §4 cross-flag interactions.
  if ((cap.latencySamples ?? 0) > 0) {
    presets.push({
      id: 'qc_t3_latency_report',
      label: 'QC · T3 · Latency report match',
      tier: 3, ruleId: 'latency_report', source: 'qc',
      params: { ...neutral },
      meta: {
        signalSource: 'impulse',
        declaredLatency: cap.latencySamples,
        hasLookahead: !!cap.hasLookahead,
      },
    });
  }

  // Monosum null (stereo-width plugins)
  if (cap.hasStereoWidth) {
    const widthName = pickSetter(paramSchema, ['setWidth', 'setStereo', 'setImage']);
    presets.push({
      id: 'qc_t3_monosum_null',
      label: 'QC · T3 · Monosum null (width = neutral)',
      tier: 3, ruleId: 'monosum_null', source: 'qc',
      params: widthName ? { ...neutral, [widthName]: 1 } : { ...neutral },
      meta: { signalSource: 'stereo', variant: 'decorrelated' },
    });
  }

  // Band-reconstruction null (multiband plugins)
  if (cap.hasMultiband) {
    presets.push({
      id: 'qc_t3_band_reconstruction',
      label: 'QC · T3 · Band-reconstruction null (all bands unity)',
      tier: 3, ruleId: 'band_reconstruction', source: 'qc',
      params: { ...neutral },
      meta: { bandsUnity: true },
    });
  }

  // LPC stability
  if (cap.hasLPC) {
    presets.push({
      id: 'qc_t3_lpc_stability',
      label: 'QC · T3 · LPC reflection-coeff stability',
      tier: 3, ruleId: 'lpc_stability', source: 'qc',
      params: { ...neutral },
      meta: { check: 'abs_k_lt_1' },
    });
  }

  // FFT frame-boundary
  if (cap.hasFFT) {
    presets.push({
      id: 'qc_t3_fft_frame_phase',
      label: 'QC · T3 · FFT frame-boundary phase coherence',
      tier: 3, ruleId: 'fft_frame_phase', source: 'qc',
      params: { ...neutral },
      meta: { signalSource: 'sine', freq: 1000 },
    });
  }

  // WDF iteration convergence
  if (cap.hasWDF) {
    presets.push({
      id: 'qc_t3_wdf_convergence',
      label: 'QC · T3 · WDF iteration convergence',
      tier: 3, ruleId: 'wdf_convergence', source: 'qc',
      params: { ...neutral },
      meta: { signalSource: 'step' },
    });
  }

  // Near-silence pitch-detector idle
  if (cap.hasPitchDetector) {
    presets.push({
      id: 'qc_t3_pitch_idle',
      label: 'QC · T3 · Pitch detector idle (sub-threshold DC)',
      tier: 3, ruleId: 'pitch_idle', source: 'qc',
      params: { ...neutral },
      meta: { signalSource: 'near_silence' },
    });
  }

  return presets;
}

// ── Tier 4 — pressure tests (schema-conditional, higher cost) ─────────────

function tier4(capabilities, paramSchema, { includeLong = false } = {}) {
  const presets = [];
  const neutral = neutralFromSchema(paramSchema);
  const cap = capabilities || {};
  const subs = new Set(cap.subcategories || []);

  // Substring match — subcategory strings may be 'tape-echo' / 'tape-saturation' / etc.
  const SR_SENSITIVE_TOKENS = [
    'bbd', 'tape', 'amp-sim', 'clipper', 'true-peak', 'convolution',
    'fft', 'wdf', 'filter-resonance',
  ];
  // Structured-flag triggers — preferred over subcategory string match.
  // `isClipper` ('hard' | 'soft') implies infinite-bandwidth aliasing
  // (hard) or cumulative aliasing (soft) → SR matrix is always warranted.
  // Keeps the generator decoupled from subcategory string conventions.
  const isClipperAny = cap.isClipper === 'hard' || cap.isClipper === 'soft';
  const srSensitive = cap.hasTruePeak || cap.hasFFT || cap.hasWDF || isClipperAny ||
    Array.from(subs).some(s => SR_SENSITIVE_TOKENS.some(tok => s.includes(tok)));

  // 4a. Sample-rate matrix
  if (srSensitive) {
    for (const sr of [44100, 48000, 88200, 96000, 192000]) {
      presets.push({
        id: `qc_t4_sr_${sr}`,
        label: `QC · T4 · Sample rate = ${sr} Hz`,
        tier: 4, ruleId: 'sample_rate_matrix', source: 'qc',
        params: { ...neutral },
        meta: { sampleRate: sr },
      });
    }
  }

  // 4b. Oversampling boundary — one ramp per declared threshold × NL stage
  const osThresh = Array.isArray(cap.osThresholds) ? cap.osThresholds : null;
  if (osThresh && osThresh.length > 0) {
    const stages = cap.nonlinearStages || 1;
    for (const thr of osThresh) {
      for (let s = 0; s < stages; s++) {
        presets.push({
          id: `qc_t4_os_boundary_${thr}_stage${s}`,
          label: `QC · T4 · OS boundary · ${thr} dBFS · stage ${s + 1}`,
          tier: 4, ruleId: 'os_boundary', source: 'qc',
          params: { ...neutral },
          meta: { thresholdDb: thr, stageIndex: s },
        });
      }
    }
  }

  // 4c. Series-identity — delay/reverb/convolution only
  const SERIES_SUBS = new Set([
    'digital-delay', 'tape-echo', 'bbd', 'ping-pong',
    'fdn-reverb', 'schroeder', 'plate-reverb', 'spring-reverb',
    'convolution-reverb',
  ]);
  const seriesApplicable = Array.from(subs).some(s => SERIES_SUBS.has(s));
  if (seriesApplicable) {
    presets.push({
      id: 'qc_t4_series_identity',
      label: 'QC · T4 · Series identity (A→B, B at Mix=0)',
      tier: 4, ruleId: 'series_identity', source: 'qc',
      params: { ...neutral },
      meta: { chainLength: 2 },
    });
  }

  // 4d. Long-session drift — opt-in only
  const LONG_SUBS = new Set(['bbd', 'fdn-reverb', 'time-stretch', 'phase-vocoder']);
  const longApplicable = includeLong && (
    cap.hasLFO || cap.hasFreeze ||
    Array.from(subs).some(s => LONG_SUBS.has(s))
  );
  if (longApplicable) {
    presets.push({
      id: 'qc_t4_long_drift',
      label: 'QC · T4 · Long-session drift (10 min steady-state)',
      tier: 4, ruleId: 'long_session_drift', source: 'qc',
      params: { ...neutral },
      meta: { durationMs: 600000 },
    });
  }

  return presets;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate QC preset descriptors for a plugin engine.
 *
 * @param {object} engine               The plugin engine (reads capabilities + paramSchema)
 * @param {object} [opts]
 * @param {boolean} [opts.includeLong]  If true, emit Tier 4 long-session drift preset when applicable
 * @returns {Array}                     Array of QC preset descriptors
 */
export function generateQcPresets(engine, opts = {}) {
  if (!engine) return [];
  const capabilities = engine.capabilities || null;
  const paramSchema = Array.isArray(engine.paramSchema) ? engine.paramSchema : null;
  const all = [
    ...tier1(capabilities, paramSchema),
    ...tier2(capabilities, paramSchema),
    ...tier3(capabilities, paramSchema),
    ...tier4(capabilities, paramSchema, opts),
  ];
  // Dedupe by id — defensive (shouldn't happen, but cheap insurance).
  const seen = new Set();
  const out = [];
  for (const p of all) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Apply a QC preset's `params` to the engine. Silently skips missing setters.
 * Returns the list of names that were applied (for reporting).
 */
export function applyQcPreset(engine, preset) {
  const applied = [];
  if (!engine || !preset || !preset.params) return applied;
  for (const [name, value] of Object.entries(preset.params)) {
    const fn = engine[name];
    if (typeof fn === 'function') {
      try { fn.call(engine, value); applied.push(name); } catch { /* swallow */ }
    }
  }
  return applied;
}

/** Count by tier — useful for UI summaries. */
export function summarizeQcPresets(presets) {
  const out = { total: presets.length, t1: 0, t2: 0, t3: 0, t4: 0 };
  for (const p of presets) out[`t${p.tier}`]++;
  return out;
}
