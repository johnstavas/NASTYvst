// manChildEngine.v1.js — FROZEN SNAPSHOT of MANchild engine at v1 approval.
// =====================================================================
// This file is immutable. If you need to change MANchild behavior, create
// manChildEngine.v2.js, leave this one alone, and register a new engine_v2
// variant in migration/registry.js. v1 stays bit-identical forever so saved
// sessions that pinned v1 keep sounding the way they did at approval.
// =====================================================================
//
// manChildEngine.js — Fairchild 670-inspired vari-mu stereo compressor.
// =====================================================================
// GOVERNED BY /DEV_RULES.md  —  read that file before touching this one.
//
// RESEARCH-AUTHENTIC TOPOLOGY (Fairchild 660/670 manual pp.1-6, DAFx Ch.4,
// audio_engineer_mental_model.md §3, pasp_through_design_lens.md §3):
//
//   Manual p.2 explicitly specifies the compression CELL as:
//     • NO DISTORTION introduced by compression
//     • NO CHANGE IN TUBE BIAS (tubes always at optimal operating point)
//     • NO PHASE SHIFT due to compression
//   All harmonic character therefore lives in the LINE AMP / OUTPUT
//   TRANSFORMER stage — downstream of the cell, not inside it.
//
//   Detector taps at the 670 OUTPUT (feedback by design — the AGC amp reads
//   from the output transformer secondary). The "Compression" character
//   comes from the vari-mu gain law coupling
//   threshold + ratio + knee together via the DC-threshold bias.
//
// Topology (DEV_RULES I1 — matches the built graph below):
//
//   externalIn ──► scExternalSum ─┐
//                                 │
//   input ─► inTrim ──┬─► splitIn ─► inGainA ─► scTapA ─┬─► mergerIn ─► worklet AUDIO_IN
//                    │            └─► inGainB ─► scTapB ┘         (pure VCA — NO NL)
//                    │                               │
//                    │                               └─► scMerger ─► worklet SC_IN
//                    │                                  (FF tap = pre-cell, post-input-gain)
//                    │
//                    (No external dry leg — Mix lives inside the worklet;
//                     see v4 note. Dry + wet are summed sample-aligned
//                     in process() → phase-coherent parallel compression.)
//
//   worklet.out ─► lineIn (master IN knob — drive into the tube)
//               └─► splitOut ─► lineAmpA (WS, the ONLY NL) ─┐
//                            └─► lineAmpB (WS, the ONLY NL) ┤
//                                                            ├─► mergerOut ─► wetGain
//                                                            ┘
//
//   wetGain ─► sumNode ─► outTrim ─► fadeIn ─► output ─► chainOutput
//
//   The line amp curve is C1-continuous, unity-small-signal-gain,
//   asymmetric (adds 2nd harmonic with 3rd on top) — this is the
//   670 "sound". Oversample='4x' inside the WaveShaper.
//
// DSP rulings honored:
//   • Manual p.2        — cell is pure gain (no tanh, no EQ, no bias shift)
//   • DAFx Ch.4.2       — soft-knee gain computer, program-dependent release
//   • DEV_RULES B3      — input gain applied BEFORE the SC tap (FF tap sees
//                         the same signal the cell will compress)
//   • DEV_RULES C1      — MIX is equal-power cos/sin
//   • DEV_RULES C3      — Dry/Wet Mix is internal to the worklet (v4+).
//                         No external dry leg = no group-delay mismatch.
//                         Equal-power cos/sin blend applied per-block.
//   • DEV_RULES B2/B4   — every node connected; VCA only written by worklet
//   • DEV_RULES H1/H2   — dispose stops everything; 180ms silent + 60ms ramp mount
//   • DEV_RULES I4      — getLatency() === 0
// =====================================================================

// Suffixed so the v1 frozen snapshot registers a distinct AudioWorkletProcessor
// name from the mutable manChildEngine.js. Without this they collide in the
// global AudioWorkletGlobalScope and the second-loaded engine throws.
const PROCESSOR_VERSION = 'v9-frozen';

// ── TC table ───────────────────────────────────────────────────────────
// Fairchild 670 reference values (service-data / UnFairchild 670M II-aligned).
// TC1-TC4 are single-exponential releases with per-position attack.
// TC5 / TC6 are the famous program-dependent PIECEWISE releases: a fast
// initial recovery followed by a much slower second (and for TC6, third)
// stage. Dense material rides the slow stage — "breathing" that glues a
// mix. Sparse material barely triggers the slow stage.
//
//   TC1   0.2 ms / 0.3 s               Fast — percussive transients
//   TC2   0.2 ms / 0.8 s               Medium — plucked bass, fast lines
//   TC3   0.4 ms / 2.0 s               Balanced — vocals, mixed program
//   TC4   0.8 ms / 5.0 s               Less aggressive — bus, transparency
//   TC5   0.8 ms / (2 s fast → 10 s)   Program-dependent — smooth master
//   TC6   0.8 ms / (0.3 s → 10 s → 25 s) Most program-dependent — mix glue
//
//   VAR1-VAR4   user-adjustable attack (0.1–36 ms) and release (30 ms–9.6 s)
//
// Per the vari-mu topology: the sidechain detector generates a control
// voltage that biases the tube grid; the tube's gain (mu) varies with
// grid bias. Attack corresponds to how fast the control voltage can
// charge the cell, release to how it discharges. TC6's 25 s tail is the
// slowest cap of the RC discharge network after the initial fast drain.
export const TC_TABLE = Object.freeze([
  { id: 'TC1',  kind: 'fixed', attackMs: 0.2, releaseMs:  300,  weightRms: 0.05 },
  { id: 'TC2',  kind: 'fixed', attackMs: 0.2, releaseMs:  800,  weightRms: 0.20 },
  { id: 'TC3',  kind: 'fixed', attackMs: 0.4, releaseMs: 2000,  weightRms: 0.40 },
  { id: 'TC4',  kind: 'fixed', attackMs: 0.8, releaseMs: 5000,  weightRms: 0.55 },
  { id: 'TC5',  kind: 'dual',  attackMs: 0.4, releaseMs: 2000,  releaseMs2: 10000, xoverDb: 3, weightRms: 0.60 },
  { id: 'TC6',  kind: 'tri',   attackMs: 0.4, releaseMs:  300,  releaseMs2: 10000, releaseMs3: 25000, xoverDb: 3, xoverDb2: 6, weightRms: 0.70 },
  { id: 'VAR1', kind: 'var',   aMin: 0.1, aMax:  4.5, rMin:  30, rMax:  1200, weightRms: 0.25 },
  { id: 'VAR2', kind: 'var',   aMin: 0.2, aMax:  9.0, rMin:  50, rMax:  2400, weightRms: 0.30 },
  { id: 'VAR3', kind: 'var',   aMin: 0.4, aMax: 18.0, rMin: 110, rMax:  4800, weightRms: 0.40 },
  { id: 'VAR4', kind: 'var',   aMin: 0.8, aMax: 36.0, rMin: 200, rMax:  9600, weightRms: 0.50 },
]);

export const CHANNEL_MODES = ['IND', 'LINK', 'M-S', 'M-S LINK'];
export const METER_MODES   = ['BYP', 'VU', 'GR', 'BAL'];

// ── PRESETS ────────────────────────────────────────────────────────────
// Rebuild v1 — exactly 15 presets per spec. Old library wiped.
//
// Threshold mapping: thDb = -36 + thPos*36  →  thPos = (thDb + 36) / 36.
// DC THR is detector sensitivity trim ONLY (not a ratio knob). Kept in
// 0.40-0.60 range per spec rule unless the use case explicitly needs more.
// FB = true (Fairchild hardware default) on every preset; the cell only
// distorts via the line-amp tanh (txDrive). VAR atk/rel left at 0.50
// because none of these presets use a VAR TC slot; if user switches the
// TC to VARx, the knobs come alive at neutral.
//
// Channel rule: A = LEFT/MID, B = RIGHT/SIDE. With INPUT now applied
// inside the worklet post-encode (engine v9), inA/inB and thA/thB act
// on the active processing domain — per-channel M-S presets work as
// labelled.
// VAR atk/rel mapping helpers (knob 0..1 over the VARx range — neutral=0.50).
//   Fast = 0.15  ·  Med-fast = 0.32  ·  Med = 0.50  ·  Slow = 0.85
// Used only by VAR-mode presets (TC = VAR1..VAR4).
const _P = (tcA, tcB, inA, inB, thDbA, thDbB, opts = {}) => Object.freeze({
  tcA, tcB, inA, inB,
  thA: (thDbA + 36) / 36, thB: (thDbB + 36) / 36,
  chanMode: opts.chanMode || 'LINK',
  dcA: opts.dcA ?? 0.50, dcB: opts.dcB ?? opts.dcA ?? 0.50,
  scA: true, scB: true,
  varAtkA: opts.varAtkA ?? 0.50, varAtkB: opts.varAtkB ?? opts.varAtkA ?? 0.50,
  varRelA: opts.varRelA ?? 0.50, varRelB: opts.varRelB ?? opts.varRelA ?? 0.50,
  txDrive: opts.txDrive ?? 0.00,
  fb: opts.fb ?? true,
  mix: opts.mix ?? 1.00,
  inDb: opts.inDb ?? 0, outDb: opts.outDb ?? 0,
  bypass: false,
});

export const MANCHILD_PRESETS = Object.freeze({
  // ── VOCALS (1–3) ────────────────────────────────────────────────────
  'Vocal – 4dB Smooth Level':   _P('TC3','TC3', 6, 6, -18,-18, { dcA:0.50 }),
  'Vocal – 6dB Forward':        _P('TC2','TC2', 8, 8, -22,-22, { dcA:0.60 }),
  'Vocal – Thick Tube':         _P('TC4','TC4',10,10, -20,-20, { dcA:0.40, txDrive:0.30, outDb:-2 }),

  // ── DRUMS (4–6) ─────────────────────────────────────────────────────
  'Drum Bus – Glue 2dB':        _P('TC2','TC2', 4, 4, -14,-14),
  'Drum Bus – Punch 6dB':       _P('TC1','TC1', 8, 8, -24,-24, { outDb:-2 }),
  'Drum Smash – Parallel':      _P('TC1','TC1',12,12, -30,-30, { chanMode:'IND', dcA:0.55, txDrive:0.20, mix:0.40, outDb:-2 }),

  // ── INSTRUMENTS (7–8) ───────────────────────────────────────────────
  'Bass – 5dB Control':         _P('TC3','TC3', 6, 6, -20,-20, { chanMode:'IND' }),
  'Guitar – Smooth 2dB':        _P('TC4','TC4', 3, 3, -12,-12, { outDb:-1 }),

  // ── MIX BUS (9–10) ──────────────────────────────────────────────────
  'Mix Bus – Glue 1.5dB':       _P('TC2','TC2', 2, 2, -10,-10, { outDb:-1 }),
  'Mix Bus – Warm 2dB':         _P('TC3','TC3', 4, 4, -14,-14, { dcA:0.40, txDrive:0.15, outDb:-1 }),

  // ── M/S (11–12) ─────────────────────────────────────────────────────
  // A = Mid, B = Side (engine v9: INPUT applied post M-S encode).
  'M/S – Center Control':       _P('TC3','TC3', 6, 2, -20,-10, { chanMode:'M-S' }),
  'M/S – Width Enhance':        _P('TC4','TC4', 2, 8, -8, -18, { chanMode:'M-S', dcB:0.55, outDb:-2 }),

  // ── CHARACTER (13–15) ───────────────────────────────────────────────
  'Tube Drive – Light':         _P('TC4','TC4',10,10, -8, -8,  { txDrive:0.30, mix:0.80, outDb:-6 }),
  'Heavy Comp – 10dB':          _P('TC1','TC1',12,12, -30,-30, { dcA:0.60, txDrive:0.10, outDb:-4 }),
  'Parallel Glue – Mix 50':     _P('TC2','TC2',10,10, -28,-28, { dcA:0.55, mix:0.50, outDb:-2 }),

  // ── DRUM DETAIL (16–19) ─────────────────────────────────────────────
  'Snare – Crack':              _P('TC1','TC1',10,10, -26,-26, { chanMode:'IND' }),
  'Kick – Tight Punch':         _P('TC2','TC2', 8, 8, -22,-22, { chanMode:'IND' }),
  'Drum Bus – Smash Hard':      _P('TC1','TC1',14,14, -32,-32, { outDb:-4 }),
  'Drum Bus – Parallel Energy': _P('TC1','TC1',12,12, -30,-30, { mix:0.35, outDb:-2 }),

  // ── VOCAL DETAIL (20–22) ────────────────────────────────────────────
  'Vocal – Air Control':        _P('TC4','TC4', 5, 5, -14,-14, { dcA:0.60, outDb:-1 }),
  'Vocal – Tight Modern':       _P('TC2','TC2', 9, 9, -24,-24),
  'Vocal – Parallel Thick':     _P('TC3','TC3',12,12, -30,-30, { mix:0.50, outDb:-2 }),

  // ── INSTRUMENT DETAIL (23–25) ───────────────────────────────────────
  'Guitar – Edge Control':      _P('TC2','TC2', 6, 6, -18,-18, { chanMode:'IND' }),
  'Guitar – Drive Tube':        _P('TC4','TC4',12,12, -10,-10, { chanMode:'IND', txDrive:0.40, mix:0.90, outDb:-5 }),
  'Bass – Aggressive Clamp':    _P('TC1','TC1',10,10, -28,-28, { chanMode:'IND' }),

  // ── MASTERING (26–28) ───────────────────────────────────────────────
  'Master – Clean Glue':        _P('TC2','TC2', 1, 1, -8, -8),
  'Master – Polish':            _P('TC3','TC3', 3, 3, -12,-12, { dcA:0.45, outDb:-1 }),
  'Master – Tube Tone':         _P('TC4','TC4', 8, 8, -6, -6,  { txDrive:0.25, mix:0.80, outDb:-6 }),

  // ── M/S ADVANCED (29–30) ────────────────────────────────────────────
  'M/S – Vocal Focus':          _P('TC3','TC4', 8, 2, -22,-8,  { chanMode:'M-S' }),
  'M/S – Side Control':         _P('TC4','TC2', 2, 8, -8, -22, { chanMode:'M-S', outDb:-2 }),

  // ── VAR MODE (31–41) ────────────────────────────────────────────────
  // VAR atk/rel: Fast=0.15 · Med-fast=0.32 · Med=0.50 · Slow=0.85
  'VAR – Snare Crack Tight':    _P('VAR1','VAR1',10,10, -26,-26, { chanMode:'IND', varAtkA:0.15, varRelA:0.20 }),
  'VAR – Snare Body + Snap':    _P('VAR2','VAR2', 9, 9, -24,-24, { chanMode:'IND', varAtkA:0.50, varRelA:0.32 }),
  'VAR – Drum Bus Bounce':      _P('VAR3','VAR3', 8, 8, -22,-22, { varAtkA:0.50, varRelA:0.85 }),
  'VAR – Drum Pump Parallel':   _P('VAR1','VAR1',12,12, -30,-30, { varAtkA:0.15, varRelA:0.20, mix:0.40, outDb:-2 }),

  'VAR – Vocal Rider Smooth':   _P('VAR3','VAR3', 5, 5, -14,-14, { varAtkA:0.85, varRelA:0.50, outDb:-2 }),
  'VAR – Vocal Tight Modern':   _P('VAR2','VAR2', 9, 9, -24,-24, { varAtkA:0.15, varRelA:0.20 }),
  'VAR – Vocal Breath Control': _P('VAR4','VAR4', 4, 4, -14,-14, { varAtkA:0.85, varRelA:0.85, outDb:-1 }),

  'VAR – Bass Tight Groove':    _P('VAR2','VAR2', 6, 6, -20,-20, { chanMode:'IND', varAtkA:0.50, varRelA:0.50 }),
  'VAR – Guitar Sustain Lift':  _P('VAR4','VAR4', 4, 4, -12,-12, { chanMode:'IND', varAtkA:0.85, varRelA:0.85, outDb:-3 }),

  'VAR – Mix Glue Breathing':   _P('VAR3','VAR3', 2, 2, -10,-10, { varAtkA:0.50, varRelA:0.85, outDb:-1 }),
  'VAR – Mix Punch Control':    _P('VAR2','VAR2', 4, 4, -14,-14, { varAtkA:0.15, varRelA:0.50 }),
});

// ── Worklet processor source ───────────────────────────────────────────
//
// The worklet does ONLY:
//   1. optional M-S encode (matrix only, no saturation)
//   2. FF/FB detector tap selection
//   3. full-wave rectify + RMS blend
//   4. multi-stage program-dependent release envelope (piecewise, not blended)
//   5. soft-knee vari-mu gain-reduction law
//   6. apply GR as a pure linear gain multiply (THE CELL — distortionless)
//   7. optional M-S decode (matrix only)
//   8. meter push
//
// Line-amp / output-transformer saturation happens OUTSIDE the worklet,
// in a single WaveShaper (splitOut → lineAmpA/B → mergerOut). That is the
// ONLY nonlinearity in the whole signal path — per Fairchild manual p.2.
const PROCESSOR_CODE = `
const TC_TABLE_SERIALIZED = ${JSON.stringify(TC_TABLE)};

class MANchildProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thA',       defaultValue: 0.45, minValue: 0, maxValue: 1 },
      { name: 'thB',       defaultValue: 0.45, minValue: 0, maxValue: 1 },
      // Per-channel input gain (LINEAR, not dB) — moved INSIDE the worklet
      // in repair v1 so that in M-S mode INPUT A drives Mid and INPUT B
      // drives Side, matching the UI labels. Previously these were external
      // GainNodes operating on L/R before the M-S encode, which made the
      // labels lie. Range covers -12..+24 dB → 0.251..15.85 linear.
      { name: 'inGainA',   defaultValue: 1, minValue: 0, maxValue: 16 },
      { name: 'inGainB',   defaultValue: 1, minValue: 0, maxValue: 16 },
      // Per-channel DC Threshold and VAR Attack/Release — v8.
      // The Fairchild 670 is a dual-mono unit: each channel has its own
      // rear-panel DC threshold trim and its own VAR control. Sharing a
      // single global param made these controls fake (moving one moved both).
      { name: 'dcA',       defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'dcB',       defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'varAtkA',   defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'varRelA',   defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'varAtkB',   defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'varRelB',   defaultValue: 0.50, minValue: 0, maxValue: 1 },
      // FB/FF: hardware-authentic default is 1 (feedback). The Fairchild 660/670
      // is a FEEDBACK compressor — the AGC amp reads from the output transformer
      // secondary, not the input. FB=0 (feed-forward) is a modern extension.
      { name: 'fb',        defaultValue: 1,    minValue: 0, maxValue: 1 },
      { name: 'chanMode',  defaultValue: 1,    minValue: 0, maxValue: 3 },
      { name: 'tcA',       defaultValue: 1,    minValue: 0, maxValue: 9 },
      { name: 'tcB',       defaultValue: 1,    minValue: 0, maxValue: 9 },
      { name: 'bypass',    defaultValue: 0,    minValue: 0, maxValue: 1 },
      // Dry/Wet mix lives INSIDE the worklet so dry and wet share the exact
      // same sample-for-sample timing (true parallel compression, no
      // phase/comb artefact at any mix ratio). 0 = 100% dry input,
      // 1 = 100% compressed. Equal-power cos/sin applied below.
      { name: 'mix',       defaultValue: 1,    minValue: 0, maxValue: 1 },
      // NOTE: txDrive is NOT a worklet param. Line-amp drive is applied outside
      // the worklet by rebuilding the WaveShaper curve in makeLineAmpCurve().
      // The worklet has no txDrive parameter — removed in v7 (was dead weight).
      // SC enable flags — gate both FF and FB taps per channel so the
      // SC-insert toggle is honest in both detector modes.
      { name: 'scEnaA',   defaultValue: 1,    minValue: 0, maxValue: 1 },
      { name: 'scEnaB',   defaultValue: 1,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Per-channel envelope state (piecewise, not target-blended).
    //   stage: 0 = attacking, 1 = fast release, 2 = slow release, 3 = slower release
    this.envA = 0;  this.stageA = 1;
    this.envB = 0;  this.stageB = 1;
    this.rmsA = 0;  this.rmsB = 0;

    // Smoothed gain-reduction (linear) — prevents zipper on sudden params
    this.grA = 1;   this.grB = 1;
    this.grSmoothCoef = Math.exp(-1 / (this.sr * 0.004));  // 4 ms

    // RMS window — 30 ms
    this.rmsCoef = Math.exp(-1 / (this.sr * 0.030));

    // FB state
    this.lastOutA = 0; this.lastOutB = 0;

    // Meter state
    this._peakInA = 0;  this._peakInB = 0;
    this._peakOutA = 0; this._peakOutB = 0;
    this._grDbA = 0;    this._grDbB = 0;
    this._meterTick = 0;

    this.port.postMessage({ ready: true });
  }

  // Knob pos 0..1 → -36..0 dBFS threshold.
  thDb(thPos) { return -36 + thPos * 36; }

  // DC Threshold — hardware-authentic single role: rectifier sensitivity trim.
  //
  // On the real Fairchild 670 the rear-panel "DC Threshold" trims the idle
  // bias voltage across the detector diodes. Higher DC → diodes fire earlier
  // → detector sees more of the signal → apparent compression threshold drops.
  // It does NOT change the ratio or knee — those are fixed by the vari-mu
  // tube's gain-grid-bias curve and the feedback topology.
  //
  // Knee and ratio are therefore fixed constants here (VARI_MU_KNEE /
  // VARI_MU_RATIO below); DC only shifts the level the detector sees.
  dcParams(dc) {
    return {
      sensDb: -3 + dc * 10,   // -3..+7 dB detector sensitivity trim
    };
  }

  // TC entry → coefficients + piecewise-release staging thresholds.
  tcCoefs(tcIdx, varAtk, varRel) {
    const tc = TC_TABLE_SERIALIZED[Math.max(0, Math.min(9, Math.round(tcIdx)))];
    const msToCoef = (ms) => Math.exp(-1 / (this.sr * ms * 0.001));
    if (tc.kind === 'var') {
      const logA = Math.log(tc.aMin) + varAtk * (Math.log(tc.aMax) - Math.log(tc.aMin));
      const attackMs  = Math.exp(logA);
      const releaseMs = tc.rMin + varRel * (tc.rMax - tc.rMin);
      return {
        aC: msToCoef(attackMs),
        r1C: msToCoef(releaseMs),
        r2C: 0, r3C: 0,
        xo1Db: 999, xo2Db: 999,
        weightRms: tc.weightRms,
      };
    }
    return {
      aC:    msToCoef(tc.attackMs),
      r1C:   msToCoef(tc.releaseMs),
      r2C:   tc.releaseMs2 ? msToCoef(tc.releaseMs2) : 0,
      r3C:   tc.releaseMs3 ? msToCoef(tc.releaseMs3) : 0,
      xo1Db: (tc.kind === 'dual' || tc.kind === 'tri') ? (tc.xoverDb  ?? 3) : 999,
      xo2Db: (tc.kind === 'tri')                      ? (tc.xoverDb2 ?? 6) : 999,
      weightRms: tc.weightRms,
    };
  }

  // Vari-mu fixed transfer curve constants.
  //
  // The Fairchild 670 tube's mu varies with grid bias in a curve that
  // produces a wide soft onset (wide knee) and a firm ratio above it.
  // Published measurements and circuit analyses converge on:
  //   — Knee ≈ 8 dB  (onset starts 4 dB below the threshold, firms up 4 dB above)
  //   — Effective ratio ≈ 10:1 well above the knee (approaches hard limiting at
  //     extreme GR via the feedback loop; typical programme sees 3:1–6:1 because
  //     most content never fully clears the knee)
  //
  // These match the DAFx §4.2 soft-knee form below.  They are NOT user-knobs —
  // the 670 provides no ratio or knee controls on the front panel.
  static get VARI_MU_KNEE()  { return 8;  }   // dB
  static get VARI_MU_RATIO() { return 10; }   // :1

  // Soft-knee gain-reduction law (DAFx §4.2 soft-knee form).
  // Returns dB GR (≤ 0).
  grDb(envDb, thDbV, kneeDb, ratio) {
    const half = kneeDb * 0.5;
    const over = envDb - thDbV;
    if (over <= -half) return 0;
    const slope = 1 - 1 / ratio;
    if (over >=  half) return -over * slope;
    const t = over + half;
    return -slope * (t * t) / (2 * kneeDb);
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    const scBufs  = inputs[1];
    if (!inBufs?.length || !outBufs?.length) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];
    const scL = scBufs && scBufs[0] ? scBufs[0] : iL;
    const scR = scBufs && scBufs[1] ? scBufs[1] : iR;

    const thA      = params.thA[0], thB = params.thB[0];
    const inGA     = params.inGainA[0];
    const inGB     = params.inGainB[0];
    const dcA      = params.dcA[0];
    const dcB      = params.dcB[0];
    const varAtkA  = params.varAtkA[0];
    const varRelA  = params.varRelA[0];
    const varAtkB  = params.varAtkB[0];
    const varRelB  = params.varRelB[0];
    const fb       = params.fb[0] > 0.5;
    const chanMode = Math.round(params.chanMode[0]);  // 0..3
    const tcAIdx   = params.tcA[0];
    const tcBIdx   = params.tcB[0];
    const bypass   = params.bypass[0] > 0.5;
    const mixP     = params.mix[0];

    const tcA = this.tcCoefs(tcAIdx, varAtkA, varRelA);
    const tcB = this.tcCoefs(tcBIdx, varAtkB, varRelB);
    const dcPA    = this.dcParams(dcA);
    const dcPB    = this.dcParams(dcB);
    const sensLinA = Math.pow(10, dcPA.sensDb / 20);
    const sensLinB = Math.pow(10, dcPB.sensDb / 20);
    // Fixed vari-mu transfer curve — knee and ratio are tube constants, not UI knobs.
    const vmKnee  = MANchildProcessor.VARI_MU_KNEE;
    const vmRatio = MANchildProcessor.VARI_MU_RATIO;
    const thDbA = this.thDb(thA);
    const thDbB = this.thDb(thB);
    const grSC  = this.grSmoothCoef;
    const rmsC  = this.rmsCoef;

    // Equal-power mix gains (cos/sin) — computed once per block. The dry and
    // wet branches are internal to this processor, so both carry IDENTICAL
    // sample timing. Summing them is phase-coherent at every mix value.
    const theta = (1 - mixP) * Math.PI * 0.5;
    const mixWet = Math.cos(theta);
    const mixDry = Math.sin(theta);

    // SC enable — read once per block (k-rate), not per-sample
    const scEnaA = params.scEnaA[0] > 0.5;
    const scEnaB = params.scEnaB[0] > 0.5;

    let peakInA = 0, peakInB = 0, peakOutA = 0, peakOutB = 0;
    let grAccumA = 0, grAccumB = 0;

    const N = iL.length;
    for (let n = 0; n < N; n++) {
      let xA = iL[n];
      let xB = iR[n];

      // M-S encode (matrix only — no saturation, no filter)
      if (chanMode === 2 || chanMode === 3) {
        const mid  = 0.5 * (xA + xB);
        const side = 0.5 * (xA - xB);
        xA = mid; xB = side;
      }

      // Per-channel INPUT gain — applied IN THE ACTIVE DOMAIN.
      // L/R modes  : xA = L·inGA,  xB = R·inGB  (matches "LEFT/M" / "RIGHT/S" labels)
      // M-S modes  : xA = M·inGA,  xB = S·inGB  (matches "MID" / "SIDE" labels)
      // Repair v1: was previously an external Gain on L/R before encode,
      // which leaked asymmetric L/R drive into both Mid and Side.
      xA *= inGA;
      xB *= inGB;

      // Peak IN meters — captured POST-encode AND POST-input-gain so the
      // meter source matches the column label in every mode (M/S in modes
      // 2-3, L/R otherwise) and reflects what the cell actually sees.
      const absInA = Math.abs(xA), absInB = Math.abs(xB);
      if (absInA > peakInA) peakInA = absInA;
      if (absInB > peakInB) peakInB = absInB;

      // Sidechain source select (FF default; FB reads previous output).
      // SC-enable params (scEnaA/B) gate both FF and FB taps so the toggle
      // is honest in both detector modes. FF: scTapA/B gain nodes already
      // zero the external SC bus; here we mirror that in FB mode.
      let sA = scL[n], sB = scR[n];
      if (chanMode === 2 || chanMode === 3) {
        const mid  = 0.5 * (sA + sB);
        const side = 0.5 * (sA - sB);
        sA = mid; sB = side;
      }
      // Detector also sees the input-gain trim, in the same domain as the
      // audio path. Without this, turning INPUT up would not increase the
      // amount the detector hears — the knob's apparent "drive into
      // compression" feel would only come from the post-cell line amp.
      sA *= inGA;
      sB *= inGB;
      if (fb) {
        sA = scEnaA ? this.lastOutA : 0;
        sB = scEnaB ? this.lastOutB : 0;
      }
      sA *= sensLinA;
      sB *= sensLinB;

      // Full-wave rectify + RMS blend
      this.rmsA = rmsC * this.rmsA + (1 - rmsC) * (sA * sA);
      this.rmsB = rmsC * this.rmsB + (1 - rmsC) * (sB * sB);
      const rmsLvlA = Math.sqrt(this.rmsA);
      const rmsLvlB = Math.sqrt(this.rmsB);
      const absA = Math.abs(sA);
      const absB = Math.abs(sB);

      // Piecewise program-dependent envelope per channel.
      //   Attack: single fast coefficient (40 ms on fixed TCs)
      //   Release: stage picker — fast → slow → slower based on current
      //   GR depth. On attack we snap back to the fast stage automatically.
      // Channel A
      if (absA > this.envA) {
        this.envA = tcA.aC * this.envA + (1 - tcA.aC) * absA;
        this.stageA = 1;
      } else {
        const coef = (this.stageA === 3) ? tcA.r3C
                   : (this.stageA === 2) ? tcA.r2C
                   : tcA.r1C;
        this.envA = coef * this.envA + (1 - coef) * absA;
      }
      // Channel B
      if (absB > this.envB) {
        this.envB = tcB.aC * this.envB + (1 - tcB.aC) * absB;
        this.stageB = 1;
      } else {
        const coef = (this.stageB === 3) ? tcB.r3C
                   : (this.stageB === 2) ? tcB.r2C
                   : tcB.r1C;
        this.envB = coef * this.envB + (1 - coef) * absB;
      }

      // Blend peak and RMS by TC weight (higher weight on slow TCs)
      const detA = (1 - tcA.weightRms) * this.envA + tcA.weightRms * rmsLvlA;
      const detB = (1 - tcB.weightRms) * this.envB + tcB.weightRms * rmsLvlB;

      const detDbA = detA > 1e-9 ? 20 * Math.log10(detA) : -200;
      const detDbB = detB > 1e-9 ? 20 * Math.log10(detB) : -200;

      // Gain-reduction law — fixed vari-mu knee + ratio (tube constants).
      // DC Threshold shifts sensLin (detection sensitivity), not the curve shape.
      let grDbA = this.grDb(detDbA, thDbA, vmKnee, vmRatio);
      let grDbB = this.grDb(detDbB, thDbB, vmKnee, vmRatio);

      // Channel linking FIRST, so the stage-switch below sees the linked
      // depth on both channels. Without this, LINK/M-S LINK let the
      // channels fall out of step (one in stage 2, one in stage 1) and
      // program-dependent TC5/TC6 release becomes inconsistent with the
      // linked GR value actually applied to the cell.
      //   LINK:     take the deeper GR (min dB) — both channels pulled
      //             to whichever hit harder. Classic Lat-detector behaviour.
      //   M-S LINK: mid-weighted blend prevents the stereo image from
      //             widening under heavy GR on content with loud sides.
      if (chanMode === 1) {
        const grMax = Math.min(grDbA, grDbB);
        grDbA = grMax; grDbB = grMax;
      } else if (chanMode === 3) {
        const linked = 0.7 * grDbA + 0.3 * grDbB;
        grDbA = linked; grDbB = linked;
      }

      // Stage switching (program-dependent release): when GR depth crosses
      // a threshold we stay on the slower-release coefficient. On attack
      // we always return to stage 1 (above). Runs on POST-LINK grDb so
      // linked modes advance the two stages in lock-step.
      if (tcA.r2C && -grDbA > tcA.xo1Db && this.stageA < 2) this.stageA = 2;
      if (tcA.r3C && -grDbA > tcA.xo2Db && this.stageA < 3) this.stageA = 3;
      if (tcB.r2C && -grDbB > tcB.xo1Db && this.stageB < 2) this.stageB = 2;
      if (tcB.r3C && -grDbB > tcB.xo2Db && this.stageB < 3) this.stageB = 3;

      // Smooth GR into linear gain (zipper-free param changes)
      const gTgtA = Math.pow(10, grDbA / 20);
      const gTgtB = Math.pow(10, grDbB / 20);
      this.grA = grSC * this.grA + (1 - grSC) * gTgtA;
      this.grB = grSC * this.grB + (1 - grSC) * gTgtB;

      // Accumulate GR as negative dB (conventional: -6.0 = 6 dB reduction).
      // Do NOT negate here — the UI bar negates ch.grDb itself to get a
      // positive bar width. Storing as positive caused bar to always read 0.
      // Also skip accumulation during bypass — the cell is not running.
      if (!bypass) {
        grAccumA += grDbA;
        grAccumB += grDbB;
      }

      // THE COMPRESSION CELL — pure linear multiply. No tanh, no tilt, no
      // bias-shift. Manual p.2: "NO DISTORTION introduced by compression."
      let yA = xA * this.grA;
      let yB = xB * this.grB;

      // FB tap — captured BEFORE M-S decode, in the same domain the cell
      // processed (M/S when chanMode∈{2,3}, L/R otherwise). On the next
      // sample the FB branch overrides sA/sB after the SC M-S encode, so
      // the detector must already be in the correct domain here.
      // Capturing AFTER decode (old v5 behaviour) fed L/R back into what
      // the next sample's detector treated as M/S — domain mismatch.
      this.lastOutA = yA;
      this.lastOutB = yB;

      // M-S decode (matrix only)
      if (chanMode === 2 || chanMode === 3) {
        const L = yA + yB;
        const R = yA - yB;
        yA = L; yB = R;
      }

      // ── Internal dry/wet sum — PHASE-COHERENT PARALLEL COMPRESSION ──
      // Dry = raw worklet input for this exact sample (iL[n]/iR[n]).
      // Wet = compressed result yA/yB from above.
      // Both paths are sample-aligned by construction — there is no
      // external dry leg and therefore no group-delay mismatch.
      //
      // NOTE: No bypass branch here. When bypass is on, the wrapper gates
      // wetGain to 0 so this output is silenced; real bypass audio travels
      // through bypassRelay (inTrim → sumNode, pre-inGain). The worklet
      // bypass param is still read to gate the GR accumulator above.
      yA = mixWet * yA + mixDry * iL[n];
      yB = mixWet * yB + mixDry * iR[n];

      oL[n] = yA;
      oR[n] = yB;

      const ayA = Math.abs(yA), ayB = Math.abs(yB);
      if (ayA > peakOutA) peakOutA = ayA;
      if (ayB > peakOutB) peakOutB = ayB;
    }

    this._peakInA  = Math.max(peakInA,  this._peakInA  * 0.86);
    this._peakInB  = Math.max(peakInB,  this._peakInB  * 0.86);
    this._peakOutA = Math.max(peakOutA, this._peakOutA * 0.86);
    this._peakOutB = Math.max(peakOutB, this._peakOutB * 0.86);
    this._grDbA    = grAccumA / N;
    this._grDbB    = grAccumB / N;

    this._meterTick++;
    if (this._meterTick >= 6) {
      this._meterTick = 0;
      this.port.postMessage({
        peakInA: this._peakInA, peakInB: this._peakInB,
        peakOutA: this._peakOutA, peakOutB: this._peakOutB,
        grDbA: this._grDbA, grDbB: this._grDbB,
      });
    }

    return true;
  }
}

// Guarded so re-loading the module in the same AudioWorkletGlobalScope
// (second instance, variant switch, hot reload) doesn't throw
// "already registered" and cascade the AudioContext into an error state.
try {
  registerProcessor('manchild-processor-${PROCESSOR_VERSION}', MANchildProcessor);
} catch (err) {
  if (!/already registered/i.test(String(err && err.message))) throw err;
}
`;

// ── Public factory ─────────────────────────────────────────────────────
export async function createManChildEngineV1(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  try {
    await audioCtx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  // ── Graph nodes ──
  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const inTrim  = audioCtx.createGain(); inTrim.gain.value  = 1;
  const outTrim = audioCtx.createGain(); outTrim.gain.value = 1;

  // Silent fade-in (DEV_RULES H2)
  const fadeIn = audioCtx.createGain();
  fadeIn.gain.value = 0;
  const now = audioCtx.currentTime;
  fadeIn.gain.setValueAtTime(0, now);
  fadeIn.gain.setValueAtTime(0, now + 0.180);
  fadeIn.gain.linearRampToValueAtTime(1, now + 0.240);

  // Per-channel splitter/merger only — input gain itself was MOVED INSIDE
  // the worklet in repair v1 so it is applied in the active processing
  // domain (Mid/Side in modes 2-3, L/R otherwise). The graph here just
  // routes raw L/R from inTrim into both the audio input and the
  // sidechain tap; the worklet then handles encoding + per-channel drive.
  const splitIn  = audioCtx.createChannelSplitter(2);
  const mergerIn = audioCtx.createChannelMerger(2);
  splitIn.connect(mergerIn, 0, 0);
  splitIn.connect(mergerIn, 1, 1);

  // Worklet — AUDIO_IN = input 0, SC_IN = input 1
  const worklet = new AudioWorkletNode(audioCtx, `manchild-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
  });

  // Sidechain tap — FF, raw L/R from splitIn. Per-channel SC enable via
  // scTap gains. The worklet now applies INPUT gain itself (post-encode),
  // so the SC path is fed RAW L/R; the worklet multiplies the detector
  // signal by inGainA/B in the active domain to keep "drive into
  // compression" matching the audio path.
  const scTapA  = audioCtx.createGain(); scTapA.gain.value = 1;
  const scTapB  = audioCtx.createGain(); scTapB.gain.value = 1;
  const scMerger = audioCtx.createChannelMerger(2);
  splitIn.connect(scTapA, 0);
  splitIn.connect(scTapB, 1);
  scTapA.connect(scMerger, 0, 0);
  scTapB.connect(scMerger, 0, 1);
  scMerger.connect(worklet, 0, 1);

  // Main audio path into worklet (the distortionless cell)
  mergerIn.connect(worklet, 0, 0);

  // ── LINE AMP — the ONLY nonlinearity in the signal path ──
  // Single stage, C1-continuous, unity-small-signal-gain, asymmetric
  // (2nd harmonic + 3rd harmonic). Oversampled 4× inside the WaveShaper.
  const splitOut  = audioCtx.createChannelSplitter(2);
  const mergerOut = audioCtx.createChannelMerger(2);
  const lineAmpA = audioCtx.createWaveShaper();
  const lineAmpB = audioCtx.createWaveShaper();
  lineAmpA.oversample = '4x';
  lineAmpB.oversample = '4x';
  // lineIn — master IN knob lives HERE (post-cell, pre-line-amp).
  // This makes "IN" a "drive into the tube" control paired with DRIVE:
  // IN = how hard you hit the line amp, DRIVE = shape of its nonlinearity.
  // Channel INPUT A/B (inGainA/B inside worklet) remains the pre-cell
  // input trim. inTrim stays at unity and exists purely so bypassRelay
  // has a clean tap point upstream of the compression path.
  const lineIn = audioCtx.createGain(); lineIn.gain.value = 1;
  worklet.connect(lineIn);
  lineIn.connect(splitOut);
  splitOut.connect(lineAmpA, 0);
  splitOut.connect(lineAmpB, 1);
  lineAmpA.connect(mergerOut, 0, 0);
  lineAmpB.connect(mergerOut, 0, 1);

  // Line-amp drive is updated via setTxDrive → rebuilds curve.
  // Init must match paramSchema def (0) so getState().txDrive reads the
  // schema default at boot — otherwise changedParamsFromDefault lies on
  // every first snapshot. (Conformance finding F1, 2026-04-19.)
  let currentDrive = 0;
  function applyDriveCurve() {
    const curve = makeLineAmpCurve(currentDrive);
    lineAmpA.curve = curve;
    lineAmpB.curve = curve;
  }
  applyDriveCurve();

  // Wet (equal-power)
  const wetGain = audioCtx.createGain(); wetGain.gain.value = 1;
  mergerOut.connect(wetGain);

  // ── Dry/Wet mix lives INSIDE the worklet (v4+) ──────────────────────
  // Prior versions (v2/v3) summed a parallel dry leg against the worklet
  // output. Every external-leg approach we tried comb-filtered because
  // the wet path picks up group delay from (a) the worklet's 128-sample
  // processing quantum and (b) the 4x-oversampled WaveShaper at the line
  // amp — and matching those delays externally is fragile across
  // browsers/sample-rates. The robust fix is to keep both legs inside the
  // worklet where they are trivially sample-aligned. The external graph
  // therefore has NO separate dry path; wetGain is unity during operation.

  // ── True relay bypass (v6) ──────────────────────────────────────────
  // Hardware bypass on the Fairchild 660/670 is a relay that hard-routes
  // the signal around the ENTIRE amp chain (cell + line amp + transformer).
  // The old worklet-only bypass still ran the signal through lineAmpA/B,
  // meaning "bypass" was colored by the WaveShaper at any Tx Drive > 0.
  //
  // Fix: bypassRelay routes inTrim → sumNode directly. When bypass is ON,
  // bypassRelay=1 + wetGain=0 → true clean pass-through.
  // When bypass is OFF, bypassRelay=0 + wetGain=1 → normal compressed path.
  //
  // NOTE: this IS an external dry leg, but it only carries signal at
  // mix=100% dry (bypass). At no point is a fractional mix used through
  // bypassRelay, so there is ZERO comb-filter risk — comb filtering only
  // occurs when a phase-offset wet signal is partially summed with dry.
  // The internal worklet mix still handles all parallel-compression blending.
  const bypassRelay = audioCtx.createGain(); bypassRelay.gain.value = 0;
  inTrim.connect(bypassRelay);

  // Sum + out
  const sumNode = audioCtx.createGain();
  wetGain.connect(sumNode);
  bypassRelay.connect(sumNode);

  // Meters
  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;
  inTrim.connect(analyserIn);
  sumNode.connect(analyserOut);

  // Wire: input → inTrim → splitIn; sumNode → outTrim → fadeIn → output → chainOutput
  // (No external dry leg — Mix is handled inside the worklet for phase-
  // coherent parallel compression. See v4 note above.)
  input.connect(inTrim);
  inTrim.connect(splitIn);

  sumNode.connect(outTrim);
  outTrim.connect(fadeIn);
  fadeIn.connect(output);
  output.connect(chainOutput);

  // ── State mirrors ──
  const state = {
    bypass: false, mix: 1.0,
    inA: 0, inB: 0,
    outA: 0, outB: 0,
    scA: true, scB: true,
    character: null,
  };

  let meter = {
    peakInA: 0, peakInB: 0, peakOutA: 0, peakOutB: 0, grDbA: 0, grDbB: 0,
  };
  worklet.port.onmessage = (e) => { if (e.data?.peakInA !== undefined) meter = e.data; };

  const P = (name) => worklet.parameters.get(name);

  // Diagnostic: last-commanded targets for the variant_drift rule so we can
  // distinguish "setter was called with preset value" (rampset path OK, DSP
  // settle issue) from "setter was called with wrong value" (applyBulk /
  // preset drift). Not authoritative state — just a breadcrumb for QC.
  const _targets = { thA: null, thB: null };

  function setMix(m) {
    state.mix = Math.max(0, Math.min(1, m));
    // Write the worklet's internal mix param. Equal-power curve is applied
    // per-block inside process() — see cos/sin derivation there.
    P('mix').setTargetAtTime(state.mix, audioCtx.currentTime, 0.005);
  }
  setMix(1.0);

  function setScA(on) {
    state.scA = !!on;
    // FF path: gate the tap node gain
    scTapA.gain.setTargetAtTime(on ? 1 : 0, audioCtx.currentTime, 0.01);
    // FB path: gate via worklet param so FB mode also respects SC enable
    P('scEnaA').value = on ? 1 : 0;
  }
  function setScB(on) {
    state.scB = !!on;
    scTapB.gain.setTargetAtTime(on ? 1 : 0, audioCtx.currentTime, 0.01);
    P('scEnaB').value = on ? 1 : 0;
  }
  setScA(true); setScB(true);

  const engine = {
    input, output, chainOutput,

    // ── QC HARNESS SCHEMA (authoritative; verified against worklet) ──────
    // CHANNEL_MODES = ['IND','LINK','M-S','M-S LINK']
    // TC_TABLE      = 10 entries: TC1..TC6 fixed + VAR1..VAR4 variable
    // MANCHILD_PRESETS keys — full preset list drives setCharacter.
    paramSchema: [
      { name: 'setIn',           label: 'Input Drive (dB)',   kind: 'db',   min: -24, max: 24, step: 0.1, def: 0 },
      { name: 'setOut',          label: 'Output Trim (dB)',   kind: 'db',   min: -24, max: 24, step: 0.1, def: 0 },
      { name: 'setMix',          label: 'Mix',                kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 1 },
      { name: 'setBypass',       label: 'Bypass',             kind: 'bool', def: 0 },
      { name: 'setTxDrive',      label: 'Tube Drive',         kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0 },
      { name: 'setFB',           label: 'Feedback Detector',  kind: 'bool', def: 1, stateKey: 'fb' },
      { name: 'setChannelMode',  label: 'Channel Mode',       kind: 'enum', def: 1,
        values: [
          { value: 0, label: 'IND' },
          { value: 1, label: 'LINK' },
          { value: 2, label: 'M-S' },
          { value: 3, label: 'M-S LINK' },
        ] },
      { name: 'setCharacter',    label: 'Preset',             kind: 'preset',
        options: Object.keys(MANCHILD_PRESETS) },

      // Per-channel (A/B) controls
      { name: 'setInputGainA',   label: 'Input Gain A (dB)',  kind: 'db',   min: 0,   max: 24, step: 0.1, def: 0, group: 'A' },
      { name: 'setInputGainB',   label: 'Input Gain B (dB)',  kind: 'db',   min: 0,   max: 24, step: 0.1, def: 0, group: 'B' },
      { name: 'setOutputGainA',  label: 'Output Gain A',      kind: 'noop', note: 'No-op on Fairchild 670 topology — use Output Trim.' },
      { name: 'setOutputGainB',  label: 'Output Gain B',      kind: 'noop', note: 'No-op on Fairchild 670 topology — use Output Trim.' },
      { name: 'setThresholdA',   label: 'Threshold A',        kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.45, group: 'A' },
      { name: 'setThresholdB',   label: 'Threshold B',        kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.45, group: 'B' },
      { name: 'setDcA',          label: 'DC Bias A',          kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.5,  group: 'A' },
      { name: 'setDcB',          label: 'DC Bias B',          kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.5,  group: 'B' },
      { name: 'setVarAtkA',      label: 'VAR Attack A',       kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.5,  group: 'A' },
      { name: 'setVarRelA',      label: 'VAR Release A',      kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.5,  group: 'A' },
      { name: 'setVarAtkB',      label: 'VAR Attack B',       kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.5,  group: 'B' },
      { name: 'setVarRelB',      label: 'VAR Release B',      kind: 'unit', min: 0,   max: 1,  step: 0.01,def: 0.5,  group: 'B' },
      { name: 'setTcA',          label: 'Time Constant A',    kind: 'enum', def: 1, group: 'A',
        values: TC_TABLE.map((t, i) => ({ value: i, label: t.id })) },
      { name: 'setTcB',          label: 'Time Constant B',    kind: 'enum', def: 1, group: 'B',
        values: TC_TABLE.map((t, i) => ({ value: i, label: t.id })) },
      { name: 'setScA',          label: 'Sidechain A',        kind: 'bool', def: 1, group: 'A' },
      { name: 'setScB',          label: 'Sidechain B',        kind: 'bool', def: 1, group: 'B' },
    ],

    setIn:  (db) => { lineIn.gain.setTargetAtTime(Math.pow(10, db / 20), audioCtx.currentTime, 0.01); },
    setOut: (db) => { outTrim.gain.setTargetAtTime(Math.pow(10, db / 20), audioCtx.currentTime, 0.01); },
    setMix,

    setBypass: (on) => {
      state.bypass = !!on;
      // True relay bypass: route inTrim → sumNode directly (clean),
      // gate the wet path (cell + lineAmp) to silence.
      // No fractional mix through bypassRelay → no comb filter risk.
      const t = audioCtx.currentTime;
      bypassRelay.gain.setTargetAtTime(on ? 1 : 0, t, 0.005);
      wetGain.gain.setTargetAtTime(on ? 0 : 1, t, 0.005);
      P('bypass').value = on ? 1 : 0;
    },
    isBypassed: () => state.bypass,

    setInputGainA: (db) => {
      state.inA = db;
      // Input gain lives inside the worklet (repair v1) so it can be
      // applied in the active domain (Mid in M-S, L in L/R modes).
      P('inGainA').setTargetAtTime(Math.pow(10, db / 20), audioCtx.currentTime, 0.01);
    },
    setInputGainB: (db) => {
      state.inB = db;
      P('inGainB').setTargetAtTime(Math.pow(10, db / 20), audioCtx.currentTime, 0.01);
    },
    // NOTE: No per-channel output gain on the Fairchild 670. These setters
    // were placeholders and are intentionally no-ops. Output level is
    // controlled by the global Output Trim (setOut).
    setOutputGainA: (_db) => {},
    setOutputGainB: (_db) => {},

    // Smoothed param writes — Conformance finding F2. Direct `.value =`
    // steps the detector/envelope and causes zipper on fast knob drags.
    // 10 ms target is inaudible but long enough to de-zipper; the cell's
    // own 4 ms GR smoother finishes the job.
    setThresholdA: (v) => { _targets.thA = v; P('thA').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setThresholdB: (v) => { _targets.thB = v; P('thB').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setDcA:        (v) => { P('dcA').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setDcB:        (v) => { P('dcB').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setVarAtkA:    (v) => { P('varAtkA').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setVarRelA:    (v) => { P('varRelA').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setVarAtkB:    (v) => { P('varAtkB').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setVarRelB:    (v) => { P('varRelB').setTargetAtTime(v, audioCtx.currentTime, 0.01); },
    setFB:         (v) => { P('fb').value = v ? 1 : 0; },
    setChannelMode:(mode) => {
      const idx = typeof mode === 'number' ? mode : Math.max(0, CHANNEL_MODES.indexOf(mode));
      P('chanMode').value = idx;
    },
    // Updates the line-amp drive curve (the ONLY NL).
    // Drive lives entirely in the WaveShaper curve — there is no corresponding
    // worklet param (txDrive was removed in v7; it was never read by DSP code).
    setTxDrive: (v) => {
      currentDrive = Math.max(0, Math.min(1, v));
      applyDriveCurve();
    },
    setTcA: (id) => {
      const idx = typeof id === 'number' ? id : TC_TABLE.findIndex(t => t.id === id);
      if (idx >= 0) P('tcA').value = idx;
    },
    setTcB: (id) => {
      const idx = typeof id === 'number' ? id : TC_TABLE.findIndex(t => t.id === id);
      if (idx >= 0) P('tcB').value = idx;
    },

    setScA, setScB,

    applyBulk(obj) {
      if (!obj) return;
      // Dev-mode: warn on preset fields this fan-out doesn't know about,
      // so silent drops don't mask preset drift. (Conformance finding F3.)
      if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
        const known = new Set(['inDb','outDb','mix','bypass','inA','inB','thA','thB',
          'dcA','dcB','varAtkA','varRelA','varAtkB','varRelB','fb','chanMode',
          'txDrive','tcA','tcB','scA','scB']);
        for (const k of Object.keys(obj)) {
          if (!known.has(k)) console.warn(`[manchild] applyBulk: unknown preset field '${k}' ignored`);
        }
      }
      if ('inDb'     in obj) engine.setIn(obj.inDb);
      if ('outDb'    in obj) engine.setOut(obj.outDb);
      if ('mix'      in obj) engine.setMix(obj.mix);
      if ('bypass'   in obj) engine.setBypass(!!obj.bypass);
      if ('inA'      in obj) engine.setInputGainA(obj.inA);
      if ('inB'      in obj) engine.setInputGainB(obj.inB);
      if ('thA'      in obj) engine.setThresholdA(obj.thA);
      if ('thB'      in obj) engine.setThresholdB(obj.thB);
      if ('dcA'      in obj) engine.setDcA(obj.dcA);
      if ('dcB'      in obj) engine.setDcB(obj.dcB);
      if ('varAtkA'  in obj) engine.setVarAtkA(obj.varAtkA);
      if ('varRelA'  in obj) engine.setVarRelA(obj.varRelA);
      if ('varAtkB'  in obj) engine.setVarAtkB(obj.varAtkB);
      if ('varRelB'  in obj) engine.setVarRelB(obj.varRelB);
      if ('fb'       in obj) engine.setFB(!!obj.fb);
      if ('chanMode' in obj) engine.setChannelMode(obj.chanMode);
      if ('txDrive'  in obj) engine.setTxDrive(obj.txDrive);
      if ('tcA'      in obj) engine.setTcA(obj.tcA);
      if ('tcB'      in obj) engine.setTcB(obj.tcB);
      if ('scA'      in obj) engine.setScA(!!obj.scA);
      if ('scB'      in obj) engine.setScB(!!obj.scB);
    },

    setCharacter(name) {
      const p = MANCHILD_PRESETS[name];
      if (!p) return;
      engine.applyBulk(p);
      state.character = name;
    },

    // QC contract: expose the preset dictionary so the harness can diff
    // declared-vs-live per preset and flag variant_drift. Plugin authors:
    // implement these two on every engine. See qcAnalyzer.js → variant_drift.
    getPresetNames() { return Object.keys(MANCHILD_PRESETS); },
    getPreset(name)  { return MANCHILD_PRESETS[name] || null; },

    // ── QC HARNESS: live runtime state ──────────────────────────────────
    // Keys match the QC harness candidateKeys() convention (camelCase of
    // the setter name minus 'set'), so syncFromEngineState() can snap
    // sliders back without per-engine wiring. See harness docs / DEV_RULE Q1.
    // This is the authoritative snapshot: reads are pulled from the
    // worklet's AudioParam.value (the DSP's live value), not the pending
    // setTarget ramp target — so we capture what the audio actually hears.
    getState() {
      const linTo = (g) => 20 * Math.log10(Math.max(1e-9, g));
      // tcA/tcB and chanMode: return the STRING form that presets declare
      // (TC_TABLE id, CHANNEL_MODES name) rather than the worklet's
      // internal index. Keeps the variant_drift QC rule from false-firing
      // on pure representation differences.
      const tcIdxA = P('tcA').value | 0;
      const tcIdxB = P('tcB').value | 0;
      const chanIdx = P('chanMode').value | 0;
      return {
        // Globals
        in:          linTo(lineIn.gain.value),
        out:         linTo(outTrim.gain.value),
        mix:         state.mix,
        bypass:      state.bypass ? 1 : 0,
        txDrive:     currentDrive,
        fb:          P('fb').value,
        chanMode:    CHANNEL_MODES[chanIdx] ?? chanIdx,
        channelMode: P('chanMode').value, // legacy alias — retained for back-compat
        character:   state.character ?? null,
        // Per-channel
        inA:        state.inA,  // alias matching preset field
        inB:        state.inB,
        inputGainA: state.inA,  // legacy alias
        inputGainB: state.inB,
        thA:        P('thA').value, // alias matching preset field
        thB:        P('thB').value,
        thresholdA: P('thA').value, // legacy alias
        thresholdB: P('thB').value,
        dcA:        P('dcA').value,
        dcB:        P('dcB').value,
        varAtkA:    P('varAtkA').value,
        varRelA:    P('varRelA').value,
        varAtkB:    P('varAtkB').value,
        varRelB:    P('varRelB').value,
        tcA:        TC_TABLE[tcIdxA]?.id ?? tcIdxA,
        tcB:        TC_TABLE[tcIdxB]?.id ?? tcIdxB,
        scA:        state.scA ? 1 : 0,
        scB:        state.scB ? 1 : 0,
        // Diagnostic: last-commanded threshold targets. If these match the
        // preset but P('thB').value doesn't, the DSP ramp isn't settling.
        // If these DON'T match the preset, applyBulk/setCharacter path is
        // dropping the field. Surfaces via variant_drift rule affected list.
        _thATarget: _targets.thA,
        _thBTarget: _targets.thB,
      };
    },

    getSidechainInput: () => scMerger,

    getInputPeakA:   () => meter.peakInA,
    getInputPeakB:   () => meter.peakInB,
    getOutputPeakA:  () => meter.peakOutA,
    getOutputPeakB:  () => meter.peakOutB,
    getGrDbA:        () => meter.grDbA,
    getGrDbB:        () => meter.grDbB,

    getLatency: () => 0,

    dispose() {
      try { worklet.port.onmessage = null; } catch {}
      try { worklet.port.close(); } catch {}
      try { worklet.disconnect(); } catch {}
      [input, output, chainOutput, inTrim, outTrim, fadeIn,
       splitIn, mergerIn,
       splitOut, mergerOut, lineAmpA, lineAmpB, lineIn,
       scTapA, scTapB, scMerger,
       wetGain, bypassRelay, sumNode,
       analyserIn, analyserOut].forEach(n => { try { n.disconnect(); } catch {} });
    },
  };

  return engine;
}

// ── Line-amp / output-transformer curve ─────────────────────────────────
// C1-continuous, unity-small-signal-gain, asymmetric.
//
// Shape:
//   y = softClip(x + biasDC) - softClipDC
// where softClip = tanh(k*u) / k   → derivative at 0 is 1 (unity gain).
// The biasDC offset pushes the signal off-center → the clipper produces
// 2nd-harmonic even when symmetric. Subtracting softClip(biasDC) removes
// the output DC offset. A small cubic `trim * x^3` is added for a touch
// of 3rd harmonic at high drive (manual p.2: the 660/670 line amp is not a
// tube saturator but the transformer does add a little iron color).
//
// Small-signal gain = 1/sech^2(k*biasDC) · (1 + 3·trim·0^2) ≈ 1 (unity).
// Peak at x=1: y = tanh(k*(1+biasDC))/k - tanh(k*biasDC)/k, always ≤ 1.
function makeLineAmpCurve(drive) {
  const N = 2048;
  const curve = new Float32Array(N);
  const k       = 1 + drive * 3.5;   // clipper stiffness 1..4.5
  const biasDC  = drive * 0.22;       // asymmetry → 2nd-harmonic bias
  const trim3   = drive * 0.04;       // tiny 3rd-harmonic lean
  const sc      = (u) => Math.tanh(k * u) / k;   // unity-gain soft clip
  const dcOut   = sc(biasDC);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    const y = sc(x + biasDC) - dcOut + trim3 * x * x * x;
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}
