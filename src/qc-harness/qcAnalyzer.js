// src/qc-harness/qcAnalyzer.js
//
// Pure audit analyzer — takes a QC audit bundle (the same shape that
// Analyzer.jsx#exportAudit produces) and returns a plain-English report.
//
// This exists so non-engineers never have to open the 500 KB JSON or send
// it to an LLM. They click ANALYZE in the drawer and read a verdict.
//
// ── Philosophy ──────────────────────────────────────────────────────────
// Every rule is explicit, numeric, and lives in RULES below. A maintainer
// can read this file top-to-bottom and know exactly why a given audit
// earned its verdict. No ML, no AI, no heuristics — just an engineer's
// checklist turned into code.
//
// ── Report shape ────────────────────────────────────────────────────────
// {
//   verdict: 'ok' | 'warn' | 'fail',
//   summary: string,                       // one-line banner text
//   headline: {                            // numbers a human would eyeball
//     snapshots, presetsFound, presetsApplied,
//     nullRms:  { p50, min, max },
//     lufs:     { p50, min, max },
//     gr:       { p50, min, max, variance },
//     peak:     { p50, min, max },
//   },
//   findings: [                            // ranked severity desc
//     { severity, rule, msg, affected: [labels] },
//     ...
//   ],
// }

const FAIL = 'fail', WARN = 'warn', OK = 'ok', INFO = 'info';
const SEV_WEIGHT = { fail: 3, warn: 2, info: 1, ok: 0 };

// ── Human-facing metadata for every rule ────────────────────────────────
// The analyzer's rule IDs (e.g. `gr_meter_stuck`) are useful for diffs and
// CI but unreadable to anyone who isn't already inside the code. For each
// rule we keep a short plain-English title, one sentence explaining what
// it means, and a hard-coded first-move fix drawn from the project's DSP
// references (DAFx Zölzer, JOS PASP, MANchild lessons). Audience: the
// person looking at the popup who wants to know "what do I do next?".
//
// Keep `title` under 40 chars — it renders as a card header.
// Keep `meaning` one sentence, readable aloud.
// Keep `fix` action-first: start with a verb, give the one file or knob
// to touch. If you don't know, say so — don't invent a remedy.
export const RULE_META = {
  snapshot_self_fail: {
    title:   "A snapshot crashed during capture",
    meaning: "The harness itself hit an error while measuring one or more presets, so those results are missing or partial.",
    fix:     "Open the browser console, re-run the sweep, and watch for the red error line. The failing preset name is in the 'affected' list below.",
    dev: {
      files:  ["src/qc-harness/Analyzer.jsx → captureSnapshot()", "src/qc-harness/QcHarness.jsx → sweep loop"],
      refs:   ["MEMORY.md → manchild_lessons.md (disposal list discipline)"],
      checks: ["Search console for the preset label exactly as shown below.", "Verify audio context state is 'running' (not 'suspended') before the sweep starts.", "If the error is an AudioParam value-range throw, the preset JSON is pushing a knob past its clamp."],
      antipatterns: ["Swallowing the error with try/catch and continuing — always surface it in the snapshot.checks.items."],
    },
  },
  preset_not_found: {
    title:   "Preset names didn't match the engine",
    meaning: "The harness asked for presets that the engine doesn't have — usually a typo or a stale preset list.",
    fix:     "Check the preset name in the 'affected' list against the engine's preset registry. Rename one side to match.",
    dev: {
      files:  ["src/manChild/manChildPresets.js (or equivalent for the product)", "src/qc-harness/presetMatrix.js (harness side)"],
      refs:   ["MEMORY.md → manchild_lessons.md (explicit preset field coverage)"],
      checks: ["Log the engine's preset list at boot and diff against the harness's request list.", "Remember preset names are case- and whitespace-sensitive — '– ' (en-dash) vs '-' (hyphen) is the usual culprit."],
      antipatterns: ["Fuzzy-matching names at runtime. Make the IDs exact or fail loud."],
    },
  },
  preset_not_applied: {
    title:   "Presets loaded but nothing changed",
    meaning: "The engine accepted the preset call but its internal state stayed the same — apply is broken somewhere in the chain.",
    fix:     "Trace `applyPreset()` in the engine file. Usually a missing setParam dispatch or a field name mismatch between preset JSON and engine state.",
    dev: {
      files:  ["src/<product>/<product>Engine.js → applyPreset()", "src/<product>/<product>Presets.js (field schema)"],
      refs:   ["MEMORY.md → manchild_lessons.md (terminal preset-flag-clear useEffect, not queueMicrotask)"],
      checks: ["Log `before`/`after` state hashes around applyPreset. If equal, the setter chain is broken.", "Verify the preset JSON's keys match the engine's state keys exactly (camelCase vs snake_case trap).", "Check the terminal flag-clear — if it runs before setters, the UI reverts to defaults."],
      antipatterns: ["Clearing the preset flag inside a queueMicrotask — the setters haven't landed yet."],
    },
  },
  variant_drift: {
    title:   "Preset didn't land — engine state ≠ preset declaration",
    meaning: "After applying a preset, the engine's live state doesn't match the values the preset declared. Usually means the running engine is a different module than the one the preset file belongs to (silent variant drift), or applyBulk dropped a field.",
    fix:     "Check that the Orb loads its engine factory + preset dictionary from the same module as the variantId reports. Hardcoded `import './xEngine.js'` while the registry points at `.v1.js` = exact signature of this bug. Route the Orb through `registry.getVariant(productId, variantId)` or a dynamic import keyed on variantId. Second most common: preset field name typo or missing case in `applyBulk`.",
    dev: {
      files:  ["src/<product>/<Product>Orb.jsx → engine module import / dynamic loader", "src/migration/registry.js → variants.<id>.engineFactory", "src/<product>/<product>Engine.*.js → applyBulk switch + getPreset / getPresetNames"],
      refs:   ["MEMORY.md → manchild_lessons.md (DEV_RULE D5 — terminal preset-flag-clear; silent drops)", "CONFORMANCE.md → M19 (setCharacter → engineState matches preset)", "store.js → defaultVariantFor (how variantId is chosen per instance)"],
      checks: ["Sweep report shows `engine.out=<A>dB` while preset source says `outDb:<B>` → wrong module loaded. Confirm Orb's import path matches the variant's engineFactory.", "Preset name in report doesn't exist in the expected preset file → Orb is reading presets from a different module than you're editing.", "applyBulk warns `unknown preset field 'X' ignored` in DevTools console → field name mismatch between preset author and engine."],
      antipatterns: ["Hardcoding `import createXEngine from './xEngine.js'` in the Orb while also shipping an `xEngine.v1.js` in the registry — the registry label lies and every QC verdict becomes untrustworthy.", "Trusting the QC header's variantId without running the `variant_drift` rule — the header is a label, not a proof."],
    },
  },
  gr_meter_stuck: {
    title:   "Compression meter isn't moving",
    meaning: "Every preset reports the same gain-reduction number. Real presets always differ — the meter is reading a cached or stale value.",
    fix:     "Two likely causes. (1) The harness reads a React state snapshot instead of calling `engine.getGrDbA()` live at capture time. (2) The sweep settle time is too short for a vari-mu — bump 600ms → 1500ms (DAFx Ch.4 attack/release).",
    dev: {
      files:  ["src/qc-harness/Analyzer.jsx → captureSnapshot() (the line that reads grDb)", "src/manChild/manChildEngine.v1.js → getGrDbA() / getGrDbB()", "Worklet processor → gain-reduction sample-accurate output"],
      refs:   ["MEMORY.md → dafx_zolzer_textbook.md Ch.4 (compressor detector smoothing, attack/release coefs)", "MEMORY.md → manchild_lessons.md (30Hz throttled meter RAF + change threshold)", "MEMORY.md → jos_pasp_dsp_reference.md (detector topology)"],
      checks: ["In DevTools while sweeping: call `window.__engine.getGrDbA()` 5× in 2s with audio hot — does it wiggle?", "If it wiggles but snapshots are identical → harness reads stale React state, not live engine.", "If it's also frozen → engine's GR tap is broken (check detector → worklet port message path).", "Variance of exactly 0.000 = almost never a DSP bug; it's a capture-path bug."],
      antipatterns: ["Reading `state.grDb` inside the sweep callback (RAF-throttled + change-thresholded).", "Sampling GR before the settle delay — vari-mu attack/release can be 100–300ms."],
    },
  },
  louder_than_input: {
    title:   "Output is louder than input",
    meaning: "Some presets push perceived loudness (LUFS) above the dry signal. Usually a makeup-gain authoring issue, occasionally intentional.",
    fix:     "Check the makeup-gain math in the engine. Rule of thumb: auto-makeup ≈ −GR_avg (see audio_engineer_mental_model.md). If a preset stores its own makeup, confirm it isn't additive on top of auto.",
    dev: {
      files:  ["src/<product>/<product>Engine.js → makeup / output-trim stage", "src/<product>/<product>Presets.js → the affected preset entries"],
      refs:   ["MEMORY.md → audio_engineer_mental_model.md (loudness compensation rules)", "MEMORY.md → dafx_zolzer_textbook.md Ch.4 (makeup gain formulas)", "MEMORY.md → pasp_through_design_lens.md (behavior-profile → DSP)"],
      checks: ["Sort the affected list by LUFS delta — the ones >+1.5 dB are almost always hand-authored overshoots.", "Compute `expected_makeup_dB = -avg(GR_dB)` per preset and diff vs stored value.", "Character presets (Tube Tone, Drive Tube) can be intentionally louder — flag expected vs actual outliers only."],
      antipatterns: ["Stacking preset makeup on top of auto-makeup without subtracting one.", "Trusting RMS for 'loudness' — use LUFS (already what the analyzer reports)."],
    },
  },
  peak_above_input: {
    title:   "Output peaks are hotter than input",
    meaning: "Post-compression peaks exceed the input by more than 1 dB. Downstream gear could clip.",
    fix:     "For vari-mu topologies, slow attack lets transients through by design (DAFx Ch.4). If unintentional, lower output trim or add a brickwall ceiling on the output.",
    dev: {
      files:  ["src/<product>/<product>Engine.js → output-trim / ceiling stage", "Worklet processor → output gain application order"],
      refs:   ["MEMORY.md → dafx_zolzer_textbook.md Ch.4 (NL, tape sat, valve — peak behavior)", "MEMORY.md → dafx_zolzer_textbook.md Ch.12 (virtual-analog valve curves)", "MEMORY.md → jos_pasp_physical_modeling.md (nonlinearity spectra)"],
      checks: ["Cross-reference with 'louder_than_input' — overlap = makeup too hot; disjoint = fast transient leakage.", "Measure deltaPkDb with a transient-heavy source (drums) vs steady-state (pink) — gap reveals attack-time leakage.", "If you need a ceiling, add it POST-makeup, not pre — otherwise it gets gained back up."],
      antipatterns: ["Applying a hard clipper as a 'ceiling' — adds aliasing on top of the overshoot.", "Oversampled saturation without output smoothing — creates inter-sample peaks that show up as +dB in peak meters."],
    },
  },
  null_too_colored: {
    title:   "Plugin is coloring the sound a lot",
    meaning: "When you subtract input from output, a lot remains. Expected for character presets, worth a look on transparent ones.",
    fix:     "If this is a character preset (saturation, tape, tube), it's fine. If it's meant to be transparent, check for an accidental wet-path in bypass or too much drive in the default state.",
    dev: {
      files:  ["src/<product>/<product>Engine.js → dry/wet mix stage (MUST be in-worklet per MEMORY.md)", "Bypass / identity path wiring"],
      refs:   ["MEMORY.md → dry_wet_mix_rule.md (NON-NEGOTIABLE: mix in-worklet, not external parallel)", "MEMORY.md → dafx_zolzer_textbook.md Ch.4 (saturation / valve coloration)", "MEMORY.md → bbd_holters_parker_model.md (if BBD-type coloration is expected)"],
      checks: ["Run null test at 0% wet — residual should be < -90 dB. If it's not, you have an external parallel dry leg (FORBIDDEN).", "Check sample alignment between pre/post capture — a 1-sample offset alone nulls at ~-20 dB.", "For character presets, this finding is informational — document expected null floor in the preset description."],
      antipatterns: ["External `dryGain` / `dryDelay` legs matching worklet group delay — combs every time (see dry_wet_mix_rule.md).", "Mixing dry/wet in React state instead of inside the processor."],
    },
  },
  per_snapshot_warnings: {
    title:   "Other minor warnings across presets",
    meaning: "A grab-bag of per-snapshot advisories the engine reported during capture.",
    fix:     "Open 'show list' below to see the individual messages. These are informational — address only if patterns repeat.",
    dev: {
      files:  ["Search engine source for the message strings in the affected list."],
      refs:   ["MEMORY.md → manchild_lessons.md (DEV_RULES pre-commit checklist)"],
      checks: ["Group by message — if one message appears on >5 presets, promote it to its own rule in RULES[] above.", "One-off warnings are usually harmless (e.g. missing optional field)."],
      antipatterns: ["Treating this rule as a catch-all forever. If a pattern emerges, make it its own rule."],
    },
  },
  rule_threw: {
    title:   "Analyzer rule crashed",
    meaning: "One of the analyzer rules threw an exception while inspecting this audit. The bug is in the analyzer, not your engine.",
    fix:     "Open qcAnalyzer.js and check the error message below. File a note so the rule can be hardened.",
    dev: {
      files:  ["src/qc-harness/qcAnalyzer.js → the RULES[] array"],
      refs:   ["Error message is in the raw text below."],
      checks: ["Guard optional chains (snap?.measurements?.grDb?.A).", "Most crashes are `undefined.toFixed` — a measurement was missing on one snapshot."],
      antipatterns: ["Rethrowing from inside a rule — it already runs in a try/catch; the analyzer recovers by design."],
    },
  },

  // ── QC-harness rules (generated by qcPresets.js) ─────────────────────
  mix_null: {
    // FAIL copy (applies when the rule actually fires as a problem).
    title:   "Dry path leaks when Mix = 0",
    meaning: "With the wet knob at zero, the plugin's output should match its input exactly. Instead, it's leaking a processed signal — you'd hear comb filtering or a subtle phase smear even when 'fully dry'.",
    fix:     "Confirm the dry/wet mix is computed INSIDE the AudioWorklet against the same-sample raw input. Remove any external parallel dry leg (dryGain / dryDelay / identity WaveShaper).",
    dev: {
      files:  ["src/<product>/<product>Engine.js → dry/wet mix stage", "src/<product>/<product>Worklet.js → processor"],
      refs:   ["MEMORY.md → dry_wet_mix_rule.md (NON-NEGOTIABLE: mix in-worklet)", "MEMORY.md → manchild_lessons.md (in-worklet mix pattern)", "MEMORY.md → qc_family_map.md §mix_null_triad (gate ≤ −80 dB)"],
      checks: ["Null test at mix=0 should produce < −80 dB RMS residual (canonical gate per qc_family_map.md). If not, you have a parallel dry leg.", "Check for `dryGain` / `dryDelay` nodes in the engine — delete them; the worklet must own the mix.", "Ensure Mix is smoothed inside the processor (k-rate AudioParam or linear ramp), not via React state."],
      antipatterns: ["External `dryGain` / `dryDelay` legs matching worklet group delay — combs every time.", "Mixing dry/wet in React state instead of inside the processor."],
    },
    // Severity-branched copy. When the rule returns INFO/cannot_verify,
    // the card should not read like an accusation — it's a diagnostic
    // note explaining why this test doesn't apply to this plugin class.
    // The renderer (reportToMarkdown) merges bySeverity[severity] over
    // the defaults above when a finding matches. Any rule that branches
    // severity should add a bySeverity block — missing keys inherit from
    // the defaults, so adding just `title` and `meaning` is enough.
    bySeverity: {
      info: {
        title:   "Mix knob — automatic check skipped for this plugin",
        meaning: "Plugins with built-in character (tubes, tape, transformers, saturators) are always adding warmth or color, even at 0% wet. That means the simple \"turn the wet knob all the way down and compare to input\" check can't work here — there's always some color on the signal, by design. That's not a bug, it's what makes this kind of plugin sound like itself. See the Diagnostics card for \"mix_null_series\" below for the deeper test that applies to this plugin class.",
        fix:     "Nothing to fix. If you want to sanity-check it yourself: bounce a dry signal through the plugin with Mix at 0% and compare it to the original file. It won't be bit-identical (the character stage is always on), but they should sound tonally close — no swirling, no phasing, no comb-filtered weirdness.",
      },
    },
  },
  mix_null_series: {
    // FAIL copy — fires when the series render reveals that Mix=0 is NOT
    // a pure dry passthrough (the second instance at Mix=0 colors/alters
    // the signal produced by the first instance).
    title:   "Mix=0 isn't a clean bypass",
    meaning: "Two copies of the plugin in a row, with the second one set to 0% wet, should sound identical to one copy alone. They don't. Something in the 'dry' path of the second instance is still processing the signal — a coloration stage that runs unconditionally, an output stage that isn't bypassed, or a smoothing buffer that leaks.",
    fix:     "Trace what the worklet actually does when Mix=0. The contract from dry_wet_mix_rule.md: at Mix=0, `out = dry`, period. Coloration, oversampling filters, output trim — none of them should run on the dry leg. If any stage is always-on regardless of Mix, it needs a `if (mix > 0)` gate or the mix crossfade has to happen upstream of that stage.",
    dev: {
      files:  ["src/<product>/<product>Worklet.js → process() dry-leg path", "src/<product>/<product>Engine.js → dry/wet mix stage + always-on stages audit"],
      refs:   ["MEMORY.md → dry_wet_mix_rule.md §5 (series test — canonical for coloration-bearing plugins)", "MEMORY.md → dry_wet_mix_rule.md §2 (why absolute null doesn't apply here)", "MEMORY.md → qc_family_map.md §mix_null_triad (gate ≤ −80 dB, inherited)"],
      checks: ["The series null is alignment-free by construction (both passes share the same latency). Residual > −80 dB = real dry-path processing, not measurement artifact.", "Diff the worklet's process() for the `mix === 0` branch against the general branch. If there's no fast-path, add one and verify the residual drops.", "If an oversampling filter sits on the output after the mix, it will color the dry leg too. Move the mix AFTER the filter, or gate the filter off when Mix=0."],
      antipatterns: ["Treating 'always-on character' as license to ignore the Mix=0 contract — the coloration belongs on the wet leg, not on whatever happens to pass through.", "Running the output trim / makeup stage on a signal that's supposed to be a pure dry copy of input."],
    },
    // Two INFO conditions share the same copy pattern (title differs by
    // the specific cannot_verify reason set on the finding's msg). The
    // renderer merges bySeverity.info over the defaults, so artist-facing
    // copy stays plain language while the dev notes carry the
    // hardware-emulation context for anyone who opens the drop-down.
    bySeverity: {
      info: {
        title:   "Series-null check — not applicable to this plugin",
        meaning: "Some plugins are modeled on hardware where the signal path can't be bypassed — a Fairchild-style vari-mu keeps its tubes in-circuit at all times, same as the real hardware. For those plugins, running two copies in a row will always show a coloration difference, because that's the emulation being honest. This is a declared design choice (`capabilities.dryLegHasColoration`), not a bug.",
        fix:     "Nothing to fix. If you want to sanity-check it yourself: A/B a dry signal against the plugin with Mix at 0%. You should hear the plugin's character — that's the point. If it sounds BROKEN (swirling, phasing, combing) rather than COLORED (warm, fat, expensive), that's a different problem and worth flagging.",
      },
    },
  },
  fb_mix_coupling: {
    title:   "Feedback tap is on the wrong side of Mix",
    meaning: "When a feedback path is engaged and you sweep the Mix knob, loudness should rise roughly monotonically. It's wobbling — usually means the feedback signal is being fed back AFTER the mix instead of BEFORE it, so reducing Mix starves the feedback loop unexpectedly.",
    fix:     "Move the feedback tap to before the dry/wet mix node. The wet signal feeds the delay line; the mix is the LAST stage.",
    dev: {
      files:  ["src/<product>/<product>Worklet.js → signal-flow graph", "src/<product>/<product>Engine.js → delay / feedback routing"],
      refs:   ["MEMORY.md → dry_wet_mix_rule.md §FB-tap placement", "MEMORY.md → dafx_zolzer_textbook.md Ch.2 (delay structures)"],
      checks: ["Trace signal flow: feedback tap MUST read from pre-mix wet bus.", "Plot LUFS vs mix across 0/25/50/75/100 — should be monotone non-decreasing within noise."],
      antipatterns: ["Taking feedback from the node's output (post-mix) — couples wet and feedback gain non-linearly."],
    },
  },
  mode_storm: {
    title:   "Two modes behave identically",
    meaning: "The plugin declares multiple modes (e.g. IND / LINK / M-S), but two of them produce exactly the same measurements — meaning the mode switch isn't actually changing the DSP path for that pair. Either the switch is a stub or the engine isn't branching on the mode value.",
    fix:     "Grep the engine for the mode param's consumer. Confirm each declared mode has its own code path. If a mode is intentionally aliased to another, declare only one in the UI.",
    dev: {
      files:  ["src/<product>/<product>Engine.js → mode dispatch", "src/<product>/<product>Worklet.js → per-mode processing branch"],
      refs:   ["MEMORY.md → manchild_lessons.md (explicit preset field coverage)"],
      checks: ["Log the branch taken for each mode value at process time — should see all 4 distinct branches fire.", "Check the mode enum's conversion layer — string vs index mismatch often collapses two modes silently."],
      antipatterns: ["Switch/case fall-through without `break` — silently aliases modes.", "Mode param declared in schema but not read in processor."],
    },
  },
  zipper: {
    title:   "Param sweep crashed or blew up",
    meaning: "Walking one knob across its full range produced NaN, Infinity, or a peak hotter than +24 dBFS. The setter is either crashing, producing denormals, or cascading through a feedback loop without clamping.",
    fix:     "Clamp the param at the setter. For params that drive exponentials (gain, freq), convert via stable formulae — `dbToLin(clamp(db, -90, +24))` not `10^(db/20)` on raw input.",
    dev: {
      files:  ["src/<product>/<product>Engine.js → setter for the failing param", "src/<product>/<product>Worklet.js → processor state update"],
      refs:   ["MEMORY.md → manchild_lessons.md (setX target verification)", "MEMORY.md → dafx_zolzer_textbook.md Ch.4 (NL saturation — denormal behavior)"],
      checks: ["Clamp input at the setter boundary, not at the UI.", "Check for exponential denormals — subnormal floats in feedback paths cascade into Inf.", "Verify the param's schema min/max matches the setter's clamp."],
      antipatterns: ["UI-only clamping — automation and preset load both bypass it.", "Unbounded exp() or pow() inside processor — overflows to Inf."],
    },
  },
};

/**
 * Human-readable verdict sentence — used in the popup banner. Falls back
 * to the existing machine summary if nothing fancy fits.
 */
export function humanSummary(report) {
  const snaps = report?.headline?.snapshots || 0;
  const fails = (report?.findings || []).filter(f => f.severity === FAIL).length;
  const warns = (report?.findings || []).filter(f => f.severity === WARN).length;
  if (snaps === 0) return "No snapshots in this audit — nothing to analyze.";
  if (report.verdict === 'fail') {
    const a = fails === 1 ? "1 problem"       : `${fails} problems`;
    const b = warns === 0 ? ""                : warns === 1 ? " and 1 thing to check" : ` and ${warns} things to check`;
    return `Not ready. ${a}${b}. Fix and re-run.`;
  }
  if (report.verdict === 'warn') {
    const b = warns === 1 ? "1 thing to check" : `${warns} things to check`;
    return `Mostly fine — ${b} before you approve.`;
  }
  return `All ${snaps} snapshot(s) look clean. Safe to approve.`;
}

/**
 * Friendly label for each headline metric — the "what this tells you"
 * column in the popup. Kept beside the rule metadata for the same reason.
 */
export const HEADLINE_HINTS = {
  snapshots: "How many presets were swept.",
  nullRms:   "How different the output is from the input. Lower (more negative) = plugin changed the sound more.",
  lufs:      "Loudness change in dB. 0 is neutral, negative means quieter, positive means louder.",
  peak:      "Peak level change in dB. Positive means output is hotter than input — watch for clipping.",
  gr:        "Gain reduction — how much the compressor clamped down. Variance near 0 means the meter isn't moving (see findings).",
};

// ── Numeric helpers ─────────────────────────────────────────────────────
const finite = (n) => typeof n === 'number' && isFinite(n);
const median = (arr) => {
  if (arr.length === 0) return NaN;
  const v = [...arr].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const minOf = (arr) => (arr.length ? Math.min(...arr) : NaN);
const maxOf = (arr) => (arr.length ? Math.max(...arr) : NaN);
const rng = (arr) => ({ p50: median(arr), min: minOf(arr), max: maxOf(arr) });

// ── Rule table ──────────────────────────────────────────────────────────
// Each rule: (bundle, snapshots, ctx) → null | { severity, rule, msg, affected? }
//
// `snapshots` is the union of all captures (plugin-authored + QC-harness).
// `ctx` exposes { pluginSnaps, qcSnaps } for rules that only apply to one
// audience. Plugin-preset rules (makeup gain, variant drift, peak
// headroom) read `ctx.pluginSnaps`. QC rules (mix_null, fb_coupling,
// mode_storm, zipper, etc.) read `ctx.qcSnaps`, filtering further by
// the snap's `qc.ruleId` tag. Rules that care about every capture
// equally (crash detection, per-snapshot warning passthrough) read
// `snapshots` directly.
//
// Rules return at most one finding; a rule that wants to report multiple
// things should be split into multiple rules.

const RULES = [

  // R0 — variant_drift: engine's live state disagrees with what the preset
  // declared. Upstream-of-everything check: if this fires, every other
  // finding is suspect because the engine under test isn't the one the
  // report claims (see CONFORMANCE.md M19 + qcAnalyzer.js RULE_META.variant_drift).
  //
  // Requires the engine to expose getPreset(name). If it doesn't, the
  // rule self-disables (cannot_verify) rather than false-firing.
  //
  // Matching rules:
  //   - Only fields present in the declared preset are checked (preset is
  //     the source of truth; if it doesn't declare a field, engine's live
  //     value is not drift).
  //   - Numeric comparison tolerates setter rounding + dB<->linear noise
  //     (1e-3 abs delta = well below a JND).
  //   - String/bool comparison is exact.
  //
  // Key-mapping: preset field names and engineState key names don't always
  // agree (e.g. preset `outDb` vs engineState `out`). The PRESET_TO_STATE
  // map bridges the two. When adding a new plugin, add its mappings here
  // or unify the names at the engine's getState.
  (_, _snaps, ctx) => {
    // Preset-field → engineState-key mapping. Plugins should mirror their
    // preset field names 1:1 in getState; this map only bridges known
    // legacy mismatches. If a field isn't listed, the rule compares the
    // preset key against the same-named engineState key (identity).
    const PRESET_TO_STATE = {
      inDb: 'in',   // manchild: preset declares dB, engine exposes as 'in'
      outDb:'out',  // same for output trim
    };
    const EPS = 1e-3;
    const drift = [];
    let checkable = 0;
    // Plugin-only: QC presets don't declare via declaredPreset; they set
    // engine state directly via applyQcPreset. variant_drift only makes
    // sense for plugin-authored presets.
    for (const s of ctx.pluginSnaps) {
      const decl = s?.declaredPreset;
      const live = s?.engineState;
      if (!decl || !live) continue;
      checkable++;
      for (const [pKey, pVal] of Object.entries(decl)) {
        const sKey = PRESET_TO_STATE[pKey] || pKey;
        if (!(sKey in live)) continue; // engine doesn't surface it — skip
        const lVal = live[sKey];
        // Normalize representation differences that aren't real drift:
        //   bool <-> 0/1 (worklet AudioParams return numeric bools)
        //   numeric tolerance on floats (setter rounding, dB↔linear)
        // String-vs-number for enum fields (e.g. tcA="TC3" vs index 2)
        // is the engine's responsibility — getState() should return the
        // same representation the preset declares, otherwise add a
        // normalizer to the preset dict or fix getState.
        const toNum = (v) => typeof v === 'boolean' ? (v ? 1 : 0) : v;
        const p = toNum(pVal);
        const l = toNum(lVal);
        let mismatch = false;
        if (typeof p === 'number' && typeof l === 'number') {
          if (Math.abs(p - l) > EPS) mismatch = true;
        } else if (p !== l) {
          mismatch = true;
        }
        if (mismatch) {
          // If the engine exposes a _<key>Target breadcrumb (e.g. _thBTarget
          // for thB), append it so the reader can tell setter-was-never-called
          // from setter-called-but-DSP-didn't-settle. Diagnostic only; plugins
          // don't have to implement it.
          const tKey = `_${pKey}Target`;
          const tVal = (tKey in live) ? live[tKey] : undefined;
          const tail = tVal === undefined ? ''
            : ` [lastTarget=${JSON.stringify(tVal)}]`;
          drift.push(`${s.label} · ${pKey}=${JSON.stringify(pVal)} → engine.${sKey}=${JSON.stringify(lVal)}${tail}`);
        }
      }
    }
    if (checkable === 0) return null; // no engine exposed getPreset — nothing to check
    if (drift.length === 0) return null;
    return {
      severity: FAIL,
      rule: 'variant_drift',
      msg: `${drift.length} preset field(s) didn't land — engine's live state disagrees with the preset declaration. `
         + `Usually means the Orb is loading a different engine module than the registry says it should. `
         + `Verdict from this report is not trustworthy until this is fixed.`,
      affected: drift,
    };
  },

  // R1 — any snapshot self-reported a failure
  (_, snaps) => {
    const hits = snaps.filter(s => s?.checks?.severity === FAIL);
    if (!hits.length) return null;
    return {
      severity: FAIL,
      rule: 'snapshot_self_fail',
      msg: `${hits.length} snapshot(s) reported internal failure during capture.`,
      affected: hits.map(s => s.label),
    };
  },

  // R2 — presets that couldn't be found in the engine's preset list
  // (plugin-only: QC presets are never in the engine's registry by design)
  (_, _snaps, ctx) => {
    const hits = ctx.pluginSnaps.filter(s => s?.preset?.requestedName && s.preset.found === false);
    if (!hits.length) return null;
    return {
      severity: FAIL,
      rule: 'preset_not_found',
      msg: `${hits.length} preset(s) were requested but not found on the engine.`,
      affected: hits.map(s => s.preset.requestedName),
    };
  },

  // R3 — presets that were found but didn't apply (state didn't change)
  // (plugin-only: QC presets don't go through engine.applyPreset)
  (_, _snaps, ctx) => {
    const hits = ctx.pluginSnaps.filter(s => s?.preset?.requestedName && s.preset.applySucceeded === false);
    if (!hits.length) return null;
    return {
      severity: FAIL,
      rule: 'preset_not_applied',
      msg: `${hits.length} preset(s) were loaded but engine state did not change — preset apply is broken.`,
      affected: hits.map(s => s.preset.requestedName),
    };
  },

  // R4 — gain-reduction meter stuck (near-zero variance across snapshots)
  // Stuck meter is a common Engine V1 bug when getState() returns a cached
  // field instead of the current GR reading. We flag it if the worst-GR
  // channel shows <0.5 dB spread across all snapshots that were measured.
  // Plugin-only: QC presets can deliberately park GR at a fixed value
  // (e.g. zipper sweep holds threshold constant while moving other knobs),
  // which would artificially collapse the spread and false-fire this rule.
  (_, _snaps, ctx) => {
    const gr = ctx.pluginSnaps
      .map(s => s?.measurements?.grDb)
      .filter(g => g && (finite(g.A) || finite(g.B)))
      .map(g => Math.min(finite(g.A) ? g.A : 0, finite(g.B) ? g.B : 0));
    if (gr.length < 3) return null;
    const spread = maxOf(gr) - minOf(gr);
    if (spread >= 0.5) return null;
    return {
      severity: FAIL,
      rule: 'gr_meter_stuck',
      msg: `Gain-reduction meter reads ${median(gr).toFixed(2)} dB on every preset (spread ${spread.toFixed(3)} dB). `
         + `Real presets should hit different GR amounts — the meter is likely sampling a stale or cached value.`,
    };
  },

  // R5 — some preset is louder than the input after processing
  // LUFS is a perceptual loudness metric; positive delta means the
  // processed signal is louder than the dry source. Usually a makeup-gain
  // authoring bug, sometimes intentional loudness comp (needs review).
  //
  // Threshold: +0.3 dB. Below that is inaudible (human JND ≈ 1 dB) AND
  // within pink-noise LUFS-integrator run-to-run variance at a 600ms
  // settle. Flagging sub-0.3 dB presets creates whack-a-mole: you trim
  // one, measurement noise surfaces the next. The rule is supposed to
  // catch audible overshoots, not measurement drift.
  (_, _snaps, ctx) => {
    const LUFS_AUDIBLE_EPS = 0.3;
    const hits = ctx.pluginSnaps.filter(s => finite(s?.measurements?.deltaLufsDb) && s.measurements.deltaLufsDb > LUFS_AUDIBLE_EPS);
    if (!hits.length) return null;
    // DIAG: also dump engineState.out so the MD report tells us whether
    // the preset's outDb actually landed in the audio graph. If engineState
    // reports -6 dB but LUFS barely moved, the bug is downstream of outTrim.
    // If engineState reports 0 dB, applyBulk/setOut never wired through.
    const fmtHit = (s) => {
      const out = s?.engineState?.out;
      const outStr = (typeof out === 'number' && finite(out))
        ? ` [engine.out=${out.toFixed(2)}dB]`
        : ' [engine.out=??]';
      return `${s.label} (+${s.measurements.deltaLufsDb.toFixed(1)} dB LUFS)${outStr}`;
    };
    return {
      severity: WARN,
      rule: 'louder_than_input',
      msg: `${hits.length} preset(s) are louder than the input (positive LUFS delta). `
         + `Review makeup-gain settings or confirm the gain-up is intentional.`,
      affected: hits.map(fmtHit),
    };
  },

  // R6 — output peak ran hotter than input — topology-aware gate.
  //
  // Default gate: +1.0 dB (tight — FET/VCA/digital compressors shouldn't
  // overshoot by more than that without a gain-staging bug).
  //
  // Vari-mu carve-out: +2.5 dB. Variable-mu topologies (Fairchild, Manley
  // Variable Mu, ManChild) use the tube's transfer curve as the gain
  // element, so attack is inherently slow and transients overshoot by
  // 1–2 dB BY DESIGN before the tube settles (DAFx Ch.4). Firing at the
  // FET/VCA threshold would false-warn every pink-noise sweep because
  // the seed randomizes which preset happens to land near the edge.
  //
  // Other topologies can add a bySeverity override here when they land
  // (opto is slow but not AS slow; FET stays strict at +1.0).
  (_, _snaps, ctx) => {
    const snaps = ctx.pluginSnaps;
    if (!snaps.length) return null;
    const topology = snaps[0]?.capabilities?.compressorTopology ?? null;
    const gateDb = topology === 'vari-mu' ? 2.5 : 1.0;
    const hits = snaps.filter(s => finite(s?.measurements?.deltaPkDb) && s.measurements.deltaPkDb > gateDb);
    if (!hits.length) return null;
    const topologyNote = topology === 'vari-mu'
      ? ` (vari-mu gate: +${gateDb} dB — transient leakage under this level is expected per DAFx Ch.4)`
      : '';
    return {
      severity: WARN,
      rule: 'peak_above_input',
      msg: `${hits.length} preset(s) push output peak >${gateDb} dB above input${topologyNote}. `
         + `Check for risk of downstream clipping.`,
      affected: hits.map(s => `${s.label} (+${s.measurements.deltaPkDb.toFixed(1)} dB peak)`),
    };
  },

  // R7 — null test is too colored (residual > −12 dBFS RMS). For a clean
  // compressor this is normal-ish, but past −12 means the processed signal
  // barely resembles the input — usually excess drive/character or a wet
  // path in bypass that shouldn't be there.
  (_, _snaps, ctx) => {
    const hits = ctx.pluginSnaps.filter(s => finite(s?.measurements?.nullRmsDb) && s.measurements.nullRmsDb > -12);
    if (!hits.length) return null;
    return {
      severity: WARN,
      rule: 'null_too_colored',
      msg: `${hits.length} preset(s) leave a large residual when nulled against input (> −12 dBFS). `
         + `Heavy coloration is expected for character presets but flagged for review.`,
      affected: hits.map(s => `${s.label} (${s.measurements.nullRmsDb.toFixed(1)} dB null)`),
    };
  },

  // R8 — every other snapshot-level warn that wasn't already caught above
  // (the per-snapshot checks.items list, surfaced once grouped).
  (_, snaps) => {
    const byMsg = new Map();
    for (const s of snaps) {
      for (const it of (s?.checks?.items || [])) {
        if (it.severity !== WARN) continue;
        const arr = byMsg.get(it.msg) || [];
        arr.push(s.label);
        byMsg.set(it.msg, arr);
      }
    }
    if (byMsg.size === 0) return null;
    // Emit first as a single finding with all affected labels — the others
    // will be emitted on subsequent rule calls via the grouped list. Since
    // a rule returns one finding, we collapse all grouped warns into a
    // single "other warnings" finding with a compact summary.
    const parts = [...byMsg.entries()]
      .map(([msg, labels]) => `${labels.length}× ${msg}`)
      .join('; ');
    const affected = [...byMsg.values()].flat();
    return {
      severity: WARN,
      rule: 'per_snapshot_warnings',
      msg: `Additional per-snapshot warnings: ${parts}.`,
      affected,
    };
  },

  // ── QC-harness rules ──────────────────────────────────────────────────
  // These rules operate on ctx.qcSnaps (tagged with snap.qc.source==='qc').
  // They match on snap.qc.ruleId — the contract the generator sets in
  // qcPresets.js. If a QC preset isn't emitted by the generator (e.g.
  // plugin lacks the capability flag), the rule silently no-ops. Never
  // false-fire when the data isn't present.

  // QC-R1 — mix_null. The "dry leg" is the single most common authoring
  // bug (see MEMORY.md → dry_wet_mix_rule.md). At mix=0 the output MUST
  // null against the input below the canonical gate in qc_family_map.md
  // §mix_null_triad: ≤ −80 dB. Anything above that means there's a
  // parallel dry path combing with the in-worklet dry, or the Mix knob
  // isn't actually in-worklet.
  //
  // Reads `alignedNullRmsDb` (offline cross-correlated) — NOT `nullRmsDb`,
  // which is the live graph-sum readout and floors at ~−20 dB under any
  // plugin latency (the original advisory reading the author flagged in
  // Analyzer.jsx:353). The aligned field is the real contract.
  //
  // Self-disable condition (cannot_verify). Per dry_wet_mix_rule.md §2:
  // the absolute phase-inverted null-to-float-noise test only applies
  // when the plugin has NO in-worklet coloration stage. Plugins with
  // always-on nonlinear stages (tubes, saturators, transformers) will
  // never null to silence at Mix=0 because the coloration runs on the
  // dry signal too. For those plugins the canonical test is step 5 —
  // a RELATIVE null (two instances in series, second at Mix=0, null
  // against a single instance) — which belongs in a separate Tier 2
  // rule (mix_null_series). Rather than false-fail on rule-misapply,
  // this rule gates off when capabilities.nonlinearStages > 0.
  (_, _snaps, ctx) => {
    const probes = ctx.qcSnaps.filter(s => s?.qc?.ruleId === 'mix_null');
    if (!probes.length) return null;

    // Probe ANY matched snap for capabilities (every snap embeds it).
    const caps = probes[0]?.capabilities ?? null;
    const nonlinearStages = Number(caps?.nonlinearStages ?? 0);
    if (nonlinearStages > 0) {
      return {
        severity: INFO,
        rule: 'mix_null',
        msg: `cannot_verify: plugin declares capabilities.nonlinearStages = ${nonlinearStages} `
           + `(in-worklet coloration). Absolute phase-invert null-to-silence does not apply `
           + `to coloration-bearing plugins (dry_wet_mix_rule.md §2). The canonical relative `
           + `test for this class is mix_null_series (two-instances-in-series, §5) — emitted `
           + `by the generator and pending capture-layer support.`,
        affected: probes.map(s => {
          const db  = finite(s?.measurements?.alignedNullRmsDb)
                    ? s.measurements.alignedNullRmsDb.toFixed(1) : '—';
          const lag = s?.measurements?.alignedNullLagSamples;
          return `${s.label} (aligned null=${db} dB @ lag=${lag ?? '?'} samp — diagnostic only)`;
        }),
      };
    }

    const hits = probes.filter(s =>
      finite(s?.measurements?.alignedNullRmsDb) &&
      s.measurements.alignedNullRmsDb > -80
    );
    if (!hits.length) return null;
    return {
      severity: FAIL,
      rule: 'mix_null',
      msg: `Mix=0 should null against input below −80 dB RMS but ${hits.length} preset(s) leaked. `
         + `This is the dry/wet mix contract (MEMORY.md → dry_wet_mix_rule.md, `
         + `qc_family_map.md §mix_null_triad). Usually means an external parallel dry leg `
         + `is combing with the in-worklet dry.`,
      affected: hits.map(s => {
        const db  = s.measurements.alignedNullRmsDb.toFixed(1);
        const lag = s.measurements.alignedNullLagSamples;
        return `${s.label} (null=${db} dB @ lag=${lag ?? '?'} samp, want < −80)`;
      }),
    };
  },

  // QC-R1b — mix_null_series. The canonical Mix=0 test for plugins with
  // always-on coloration (nonlinearStages > 0). Two instances in series,
  // second at Mix=0 — should match one instance alone, because a correct
  // Mix=0 is pure dry passthrough regardless of the plugin's always-on
  // character (see dry_wet_mix_rule.md §5).
  //
  // This escapes the alignment floor that caps the absolute mix_null
  // (cross-correlation → integer-sample lag → ~−53 dB). The series test
  // is alignment-free by construction: both ref and test pass through
  // the same plugin latency, so direct subtraction works.
  //
  // Contract for the capture layer (Analyzer.jsx TODO): for any snap
  // tagged `qc.ruleId === 'mix_null_series'`, populate
  //   measurements.seriesNullRmsDb    — RMS dB of (test − ref) residual
  //   measurements.seriesNullRefLabel — preset label used for the ref pass
  // Until that ships, the rule self-disables with INFO/waiting so the
  // report stays consistent across plugins.
  (_, _snaps, ctx) => {
    const probes = ctx.qcSnaps.filter(s => s?.qc?.ruleId === 'mix_null_series');
    if (!probes.length) return null;

    // Hardware-faithfulness gate (declared). Plugins modeling hardware
    // where the signal path can't be bypassed (e.g. Fairchild vari-mu —
    // 6386 twin triodes in push-pull sit in-circuit at all times) will
    // always fail this test by construction. Respect the declaration
    // instead of false-failing the verdict. See manChildEngine.v1.js
    // capabilities.dryLegHasColoration for the canonical explanation.
    const caps = probes[0]?.capabilities ?? null;
    if (caps?.dryLegHasColoration === true) {
      return {
        severity: INFO,
        rule: 'mix_null_series',
        msg: `cannot_verify: plugin declares capabilities.dryLegHasColoration = true `
           + `(hardware-faithful emulation — dry leg is colored by design). The series `
           + `test will always show a coloration-difference residual and cannot be used `
           + `to police the Mix=0 contract on this plugin class.`,
        affected: probes.map(s => {
          const db = finite(s?.measurements?.seriesNullRmsDb)
                   ? s.measurements.seriesNullRmsDb.toFixed(1) : '—';
          return `${s.label} (series null=${db} dB — diagnostic only, declared as expected)`;
        }),
      };
    }

    // Capture-layer gate: if no snap carries the series measurement, the
    // harness hasn't implemented the two-pass render yet. Report INFO
    // instead of a spurious FAIL or a silent disappearance — artists see
    // "waiting on capture support" per the bySeverity.info card.
    const withData = probes.filter(s => finite(s?.measurements?.seriesNullRmsDb));
    if (withData.length === 0) {
      return {
        severity: INFO,
        rule: 'mix_null_series',
        msg: `capture_pending: series-null measurement not present on any snap. `
           + `Capture layer needs to implement the two-pass offline render `
           + `(see Analyzer.jsx → sweepQcPresets, ruleId='mix_null_series'). `
           + `Generator emitted ${probes.length} probe(s) — they'll light up automatically once populated.`,
        affected: probes.map(s => `${s.label} (measurement pending)`),
      };
    }

    // Gate matches qc_family_map.md §mix_null_triad: ≤ −80 dB. The series
    // measurement has more headroom than the aligned null (no integer-lag
    // floor), but the contract we're policing is the same one. If a plugin
    // really needs it, we can tighten per-plugin via RULE_META later.
    const hits = withData.filter(s => s.measurements.seriesNullRmsDb > -80);
    if (!hits.length) return null;
    return {
      severity: FAIL,
      rule: 'mix_null_series',
      msg: `Series test: running plugin twice with the second instance at Mix=0 `
         + `produced a non-null residual on ${hits.length} snap(s). `
         + `Mix=0 is not a clean dry passthrough — something on the dry leg is coloring. `
         + `See dry_wet_mix_rule.md §5.`,
      affected: hits.map(s => {
        const db = s.measurements.seriesNullRmsDb.toFixed(1);
        const ref = s.measurements.seriesNullRefLabel || 'single-instance ref';
        return `${s.label} (series null=${db} dB vs ${ref}, want < −80)`;
      }),
    };
  },

  // QC-R2 — fb_coupling. Feedback-coupling presets walk Mix across
  // 0/25/50/75/100 while feedback is engaged. If the FB tap is placed
  // PRE-mix (correct), LUFS should rise roughly monotonically with mix.
  // If it's placed POST-mix (wrong), the curve becomes non-monotonic or
  // collapses — a classic delay/chorus feedback-routing bug.
  // Relaxed to: detect >1 inversion in the LUFS sequence. Perfect
  // monotonicity is unrealistic in noise; a single direction change is
  // within measurement jitter, two or more indicates a real routing bug.
  (_, _snaps, ctx) => {
    const fb = ctx.qcSnaps
      .filter(s => s?.qc?.ruleId === 'fb_mix_coupling' && finite(s?.measurements?.deltaLufsDb))
      .map(s => ({
        mix: Number(s?.qc?.meta?.mixValue ?? NaN),
        lufs: s.measurements.deltaLufsDb,
        label: s.label,
      }))
      .filter(r => finite(r.mix))
      .sort((a, b) => a.mix - b.mix);
    if (fb.length < 3) return null;
    let inversions = 0;
    for (let i = 1; i < fb.length - 1; i++) {
      const a = fb[i - 1].lufs, b = fb[i].lufs, c = fb[i + 1].lufs;
      if ((b - a) * (c - b) < 0) inversions++;
    }
    if (inversions < 2) return null;
    return {
      severity: WARN,
      rule: 'fb_mix_coupling',
      msg: `Feedback-coupled Mix sweep shows ${inversions} direction change(s) in the LUFS curve. `
         + `Expected near-monotonic rise. FB tap may be post-mix instead of pre-mix.`,
      affected: fb.map(r => `${r.label} (mix=${r.mix}, ΔLUFS=${r.lufs.toFixed(1)})`),
    };
  },

  // QC-R3 — mode_storm. Every declared mode must produce distinct
  // measurable output. If two modes yield identical (deltaLufsDb,
  // nullRmsDb) pairs within noise, one of them isn't actually wired —
  // the mode switch in the UI is a stub, or the engine doesn't branch
  // on it. This catches the ManChild-class bug where M/S LINK was
  // declared but executed the same path as LINK.
  (_, _snaps, ctx) => {
    const modes = ctx.qcSnaps.filter(s => s?.qc?.ruleId === 'mode_storm');
    if (modes.length < 2) return null;
    const key = (s) => {
      const l = s?.measurements?.deltaLufsDb;
      const n = s?.measurements?.nullRmsDb;
      return `${finite(l) ? l.toFixed(1) : 'x'}|${finite(n) ? n.toFixed(1) : 'x'}`;
    };
    const groups = new Map();
    for (const s of modes) {
      const k = key(s);
      const arr = groups.get(k) || [];
      arr.push(s.label);
      groups.set(k, arr);
    }
    const dup = [...groups.values()].filter(arr => arr.length > 1);
    if (!dup.length) return null;
    return {
      severity: FAIL,
      rule: 'mode_storm',
      msg: `${dup.length} pair(s) of declared modes produced identical measurements — the mode switch isn't wired. `
         + `Check engine's mode dispatch.`,
      affected: dup.flat(),
    };
  },

  // QC-R4 — zipper (relaxed). Each zipper preset walks ONE param across
  // its range in a single snapshot. We can't detect clicks during the
  // transition without a capture-layer extension, but we CAN detect
  // NaN/non-finite output and peak blowups — either indicates the param
  // setter crashed or produced a denormal/Inf cascade.
  (_, _snaps, ctx) => {
    const zips = ctx.qcSnaps.filter(s => s?.qc?.ruleId === 'zipper');
    if (!zips.length) return null;
    const hits = zips.filter(s => {
      const pk = s?.measurements?.post?.peakDb;
      const lufs = s?.measurements?.deltaLufsDb;
      return !finite(pk) || !finite(lufs) || pk > 24;
    });
    if (!hits.length) return null;
    return {
      severity: FAIL,
      rule: 'zipper',
      msg: `${hits.length} zipper sweep(s) produced NaN/non-finite output or runaway peak (>+24 dBFS). `
         + `A param setter is probably crashing or emitting denormals during transition.`,
      affected: hits.map(s => {
        const pk = s?.measurements?.post?.peakDb;
        return `${s.label} (postPk=${finite(pk) ? pk.toFixed(1)+' dBFS' : 'NaN'})`;
      }),
    };
  },

];

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Analyze a QC audit bundle.
 * @param {object} bundle  shape matches Analyzer.exportAudit() output
 * @returns {object} report
 */
export function analyzeAudit(bundle) {
  const snaps = Array.isArray(bundle?.snapshots) ? bundle.snapshots : [];

  // ── Snapshot origin split ────────────────────────────────────────────
  // Snapshots come from two audiences and must be judged by different
  // rules. Plugin-preset snapshots are authored by the product team and
  // should obey author-intent rules (makeup gain reasonable, null floor,
  // peak headroom, variant_drift). QC snapshots are generated by the
  // harness itself (qcPresets.js) and deliberately stress-test the
  // engine — e.g. slamming input drive to +24 dB — so author-intent
  // rules would always false-fire.
  //
  // Every rule below declares which slice it operates on via ctx.
  // Rules that read `snaps` directly see everything (used for crash
  // detection and per-snapshot warning passthrough that apply to both).
  const pluginSnaps = snaps.filter(s => s?.qc?.source !== 'qc');
  const qcSnaps     = snaps.filter(s => s?.qc?.source === 'qc');
  const ctx = { pluginSnaps, qcSnaps };

  // Headline metrics — computed from plugin snaps only, since the QC
  // set is authored to blow out peak/LUFS and would skew the "typical"
  // numbers a reviewer uses to eyeball the product.
  const nulls  = pluginSnaps.map(s => s?.measurements?.nullRmsDb).filter(finite);
  const lufs   = pluginSnaps.map(s => s?.measurements?.deltaLufsDb).filter(finite);
  const peaks  = pluginSnaps.map(s => s?.measurements?.deltaPkDb).filter(finite);
  const grVals = pluginSnaps
    .map(s => s?.measurements?.grDb)
    .filter(g => g && (finite(g.A) || finite(g.B)))
    .map(g => Math.min(finite(g.A) ? g.A : 0, finite(g.B) ? g.B : 0));

  const presetsRequested = pluginSnaps.filter(s => s?.preset?.requestedName).length;
  const presetsFound     = pluginSnaps.filter(s => s?.preset?.found === true).length;
  const presetsApplied   = pluginSnaps.filter(s => s?.preset?.applySucceeded === true).length;

  const headline = {
    snapshots: snaps.length,
    presetsRequested,
    presetsFound,
    presetsApplied,
    nullRms: rng(nulls),
    lufs:    rng(lufs),
    peak:    rng(peaks),
    gr: {
      ...rng(grVals),
      variance: grVals.length ? (maxOf(grVals) - minOf(grVals)) : NaN,
    },
  };

  // Run rules. Each rule receives (bundle, snaps, ctx) where ctx exposes
  // { pluginSnaps, qcSnaps } slices. Rules that read `snaps` directly
  // see the union (used for crash detection + warning passthrough).
  const findings = [];
  for (const rule of RULES) {
    try {
      const f = rule(bundle, snaps, ctx);
      if (f) findings.push(f);
    } catch (err) {
      findings.push({
        severity: WARN,
        rule: 'rule_threw',
        msg: `Internal analyzer rule threw: ${err && err.message || err}`,
      });
    }
  }

  // Rank — worst severity first, then rule name for stability.
  findings.sort((a, b) =>
    (SEV_WEIGHT[b.severity] || 0) - (SEV_WEIGHT[a.severity] || 0)
    || String(a.rule).localeCompare(String(b.rule))
  );

  // Overall verdict.
  let verdict = OK;
  let summary = `All ${snaps.length} snapshot(s) look clean — safe to approve.`;
  if (findings.some(f => f.severity === FAIL)) {
    verdict = FAIL;
    const failN = findings.filter(f => f.severity === FAIL).length;
    const warnN = findings.filter(f => f.severity === WARN).length;
    summary = `${failN} failure(s)${warnN ? `, ${warnN} warning(s)` : ''} — do not approve, fix and re-run.`;
  } else if (findings.some(f => f.severity === WARN)) {
    verdict = WARN;
    const warnN = findings.filter(f => f.severity === WARN).length;
    summary = `${warnN} warning(s) — review before approving.`;
  }

  if (snaps.length === 0) {
    verdict = WARN;
    summary = 'Audit bundle contains no snapshots — nothing to analyze.';
  }

  return { verdict, summary, headline, findings };
}

/**
 * Compare a new report against a previous history entry. Used by the
 * RE-RUN flow so the popup can tell the user what their last fix
 * actually changed: resolved findings, new regressions, verdict shift.
 *
 * @param {object} prev  { at, verdict, findingKeys } from history
 * @param {object} curr  full report from analyzeAudit()
 * @returns {{
 *   verdictChange: 'improved'|'regressed'|'same',
 *   resolved: string[],   // rule keys that existed before and are gone now
 *   introduced: string[], // rule keys that are new this run
 *   carried: string[],    // rule keys that persisted across both runs
 * }}
 */
export function diffReports(prev, curr) {
  const prevKeys = new Set(prev.findingKeys || []);
  const currKeys = new Set((curr.findings || []).map(f => f.rule));
  const resolved   = [...prevKeys].filter(k => !currKeys.has(k));
  const introduced = [...currKeys].filter(k => !prevKeys.has(k));
  const carried    = [...currKeys].filter(k =>  prevKeys.has(k));

  const w = { fail: 3, warn: 2, info: 1, ok: 0 };
  const dv = (w[curr.verdict] || 0) - (w[prev.verdict] || 0);
  const verdictChange = dv < 0 ? 'improved' : dv > 0 ? 'regressed' : 'same';

  return { verdictChange, resolved, introduced, carried };
}

/**
 * Render a report as a markdown document suitable for pasting into
 * CONFORMANCE_REPORT.md or downloading as .md.
 */
export function reportToMarkdown(report, bundle) {
  const L = [];
  const badge = report.verdict === FAIL ? '❌ Not ready'
             : report.verdict === WARN ? '⚠️ Almost there'
             : '✅ Looks good';

  const pid  = bundle?.product?.productId || '?';
  const vid  = bundle?.product?.variantId  || '?';
  const when = bundle?.capturedAt || new Date().toISOString();

  L.push(`# QC Audit Report — ${pid} · ${vid}`);
  L.push('');
  L.push(`**Verdict:** ${badge}`);
  L.push('');
  L.push(`> ${humanSummary(report)}`);
  L.push('');
  L.push(`- **Captured:** ${when}`);
  if (bundle?.build?.sha)     L.push(`- **Build SHA:** \`${bundle.build.sha}\``);
  if (bundle?.build?.version) L.push(`- **Build version:** ${bundle.build.version}`);
  if (bundle?.source?.kind)   L.push(`- **Test source:** ${bundle.source.kind}${bundle.source.name ? ` (${bundle.source.name})` : ''}`);
  L.push('');

  // The numbers — plain-English column so the download reads the same as
  // the in-app popup. No "p50/min/max" jargon here on purpose.
  const h = report.headline;
  const fmt = (x) => finite(x) ? x.toFixed(2) : '—';
  L.push('## The numbers');
  L.push('');
  L.push('| Metric | Typical | Range | What this tells you |');
  L.push('|---|---|---|---|');
  L.push(`| How many presets | ${h.snapshots} | ${h.presetsApplied}/${h.presetsRequested} applied | ${HEADLINE_HINTS.snapshots} |`);
  L.push(`| How much the sound changed | ${fmt(h.nullRms.p50)} dB | ${fmt(h.nullRms.min)} … ${fmt(h.nullRms.max)} dB | ${HEADLINE_HINTS.nullRms} |`);
  L.push(`| Loudness change | ${fmt(h.lufs.p50)} dB | ${fmt(h.lufs.min)} … ${fmt(h.lufs.max)} dB | ${HEADLINE_HINTS.lufs} |`);
  L.push(`| Peak level change | ${fmt(h.peak.p50)} dB | ${fmt(h.peak.min)} … ${fmt(h.peak.max)} dB | ${HEADLINE_HINTS.peak} |`);
  L.push(`| Compression (GR) | ${fmt(h.gr.p50)} dB | variance ${fmt(h.gr.variance)} dB | ${HEADLINE_HINTS.gr} |`);
  L.push('');

  // Findings are split into two visual sections for the artist-facing
  // report. Real issues (FAIL / WARN) go under "## Findings" and drive
  // the verdict. Informational notes (INFO — tests that couldn't run on
  // this plugin class, diagnostic measurements, etc.) go under
  // "## Diagnostics" so a clean report doesn't have scary-looking cards
  // floating next to a green verdict. See session discussion — Option B.
  const findings    = report.findings.filter(f => f.severity === FAIL || f.severity === WARN);
  const diagnostics = report.findings.filter(f => f.severity !== FAIL && f.severity !== WARN);

  const renderCard = (f) => {
    const tag = f.severity === FAIL ? '🔴 **Problem**'
              : f.severity === WARN ? '🟡 **Check**'
              :                       '🔵 **Info**';
    const baseMeta = RULE_META[f.rule] || {
      title:   f.rule,
      meaning: f.msg,
      fix:     "No suggested fix on file for this rule yet.",
    };
    // Severity-branched copy merge (see mix_null for canonical example).
    const override = baseMeta.bySeverity?.[f.severity] || {};
    const meta = { ...baseMeta, ...override, dev: override.dev || baseMeta.dev };
    L.push(`### ${tag} — ${meta.title}`);
    L.push('');
    L.push(`**What it means:** ${meta.meaning}`);
    L.push('');
    L.push(`**Try this:** ${meta.fix}`);

    if (meta.dev) {
      L.push('');
      L.push('<details><summary><b>Developer notes</b> — files, references, checks, anti-patterns</summary>');
      L.push('');
      if (meta.dev.files?.length) {
        L.push('**Files to inspect:**');
        for (const x of meta.dev.files) L.push(`- \`${x}\``);
        L.push('');
      }
      if (meta.dev.refs?.length) {
        L.push('**References:**');
        for (const x of meta.dev.refs) L.push(`- ${x}`);
        L.push('');
      }
      if (meta.dev.checks?.length) {
        L.push('**Diagnostic checks:**');
        for (const x of meta.dev.checks) L.push(`- ${x}`);
        L.push('');
      }
      if (meta.dev.antipatterns?.length) {
        L.push('**Anti-patterns (avoid):**');
        for (const x of meta.dev.antipatterns) L.push(`- ⚠️ ${x}`);
        L.push('');
      }
      L.push('</details>');
    }

    if (f.affected && f.affected.length) {
      L.push('');
      L.push(`<details><summary>${f.affected.length} affected preset${f.affected.length === 1 ? '' : 's'}</summary>`);
      L.push('');
      for (const a of f.affected.slice(0, 40)) L.push(`- ${a}`);
      if (f.affected.length > 40) L.push(`- …and ${f.affected.length - 40} more`);
      L.push('');
      L.push('</details>');
    }
    L.push('');
    L.push(`<sub>Technical details — rule: \`${f.rule}\` · raw: ${f.msg}</sub>`);
    L.push('');
  };

  L.push('## Findings');
  L.push('');
  if (findings.length === 0) {
    L.push('_No issues detected._');
    L.push('');
  } else {
    for (const f of findings) renderCard(f);
  }

  if (diagnostics.length > 0) {
    L.push('## Diagnostics');
    L.push('');
    L.push('_These are informational notes — tests we measured or skipped. They do not affect the verdict._');
    L.push('');
    for (const f of diagnostics) renderCard(f);
  }

  return L.join('\n');
}
