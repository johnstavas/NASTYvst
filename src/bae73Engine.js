// bae73Engine.js — BAE 1073D-inspired transformer + Class A preamp path
//
// PURPOSE
// ────────
// This is a perceptually-modeled 1073-style preamp. Five distinct nonlinear
// stages, each contributing a different flavor of analog-like coloration.
// It is NOT a generic distortion plugin. Every stage is intentionally
// underbuilt on its own — the character emerges from the interaction
// between stages, the way it does in a real 1073 signal path.
//
// SIGNAL FLOW
// ────────────
// input
//   ├─ inputAnalyser ──→ envFollower (RAF, ~30 Hz)
//   │                      drives: even/odd mix, micro-comp,
//   │                              dynamic HF softening, transient LPF
//   ▼
//  Stage 1 — Input Conditioning
//    loadLowMid (peak +0.6 @ 220 Hz, +thickness)
//    loadHFTame (highshelf -0.4 @ 11 kHz)
//   ▼
//  Stage 2 — Input Transformer
//    inXfmrPre (drive·0.3 push)
//    inXfmrSat (biased tanh, asym, 4× OS)
//    inXfmrPost (auto-comp)
//    inXfmrTransientLPF (env-modulated 17 → 13 kHz)
//   ▼
//  Stage 3 — Class-A BA283
//    claPre (drive push)
//    claEvenPath (biased tanh, even-dominant) ─┐
//    claEvenMix (env-modulated)               ─┴─→ claSum
//    claOddPath  (symmetric tanh, odd-dominant)─┐
//    claOddMix   (env-modulated)               ─┘
//    claMicroComp (env-driven, 1.0 → 0.92)
//    claPost (auto-comp)
//   ▼
//  Stage 4 — Output Transformer (single-path, LF pre/post emphasis)
//    otPreLift  (lowshelf +lfTilt dB @ 240 Hz — hits sat harder on lows)
//    otSat      (atan hot curve, 4× OS, k-blended identity at zero)
//    otPostCut  (lowshelf -lfTilt dB @ 240 Hz — exact inverse of preLift)
//   ▼
//  Stage 5 — Dynamic HF Softening
//    dynHFShelf (highshelf @ 14 kHz, env+drive modulated 0 → -2 dB)
//   ▼
//  Stage 6 — Mix / Auto Gain / Output Trim
//    wetGain · dryGain · mixSum → autoGain → outputTrim → output
//
// DESIGN RULES UPHELD
// ───────────────────
// 1. Every stage has a distinct transfer characteristic.
// 2. Lows drive nonlinearity harder than highs (LF pre-emphasis into otSat).
// 3. Harmonics grow progressively (envelope-modulated even→odd shift).
// 4. Drive and Output Trim are independent — workflow is "push then trim".
// 5. Stable under hot input (tanh / atan wrappers + 4× OS).
// 6. Aliasing controlled (every WaveShaperNode runs 4× oversample).
// 7. Tone change is from behavior (band-dependent saturation, envelope-
//    modulated harmonic balance, dynamic damping), NOT from static EQ.
//
// LIMITATIONS OF WEB AUDIO IMPLEMENTATION
// ────────────────────────────────────────
// We can't do per-sample DSP without an AudioWorklet. Slow modulations
// (envelope-driven bias, dynamic damping) are handled via a ~30 Hz RAF
// loop reading an AnalyserNode and updating gain/filter params with
// setTargetAtTime smoothing. This is more than fast enough for the
// "feel-it-not-hear-it" envelope behaviors the spec describes.

// Version stamp — bump on every meaningful change. Imported by NastyNeveOrb
// so it shows in the panel header. If you can SEE this number on the UI, the
// engine module successfully reloaded.
export const NASTY_NEVE_VERSION = 'v6.7';

export function createNastyNeveEngine(ctx) { return createBae73Engine(ctx); }

export function createBae73Engine(ctx) {
  // Version stamp — bump this when the engine changes so we can verify
  // in DevTools whether the new code is actually running.
  console.log('[NastyNeve] engine v6.7 — Thick redesigned — 80 Hz lowshelf weight + 100 Hz OT emphasis for kick');

  // ───────────────────────────────────────────────────────────────────────
  // I/O nodes
  // ───────────────────────────────────────────────────────────────────────
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 1 — Input Conditioning
  // ═══════════════════════════════════════════════════════════════════════
  // Subtle pre-loading: shapes how the nonlinear stages get hit. Both gains
  // start at 0 dB so the path is TRANSPARENT at thickness=0 / drive=0.
  // They scale with thickness/drive in setThickness / setDrive.
  // Low shelf at 180 Hz — the Neve transformer "body" zone.
  // Audible on kick, bass, and vocals. At thick=1.0 adds +5 dB of real
  // tonal weight before the saturation stages.
  const loadLowMid = ctx.createBiquadFilter();
  loadLowMid.type = 'lowshelf';
  loadLowMid.frequency.value = 180;
  loadLowMid.gain.value = 0;         // 0 dB at idle; thickness lifts to +5.0

  // Presence peak at 3.5 kHz — the Neve "air and snap" zone.
  // Transformer resonance gives the 1073 its forward, present character.
  // Thick pushes this to +2 dB; drive adds more via _rebuildCurves harmonics.
  const loadHFTame = ctx.createBiquadFilter();
  loadHFTame.type = 'peaking';
  loadHFTame.frequency.value = 3500;
  loadHFTame.Q.value = 0.9;
  loadHFTame.gain.value = 0;         // 0 dB at idle; thickness lifts to +2.0

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 2 — Input Transformer
  // ═══════════════════════════════════════════════════════════════════════
  const inXfmrPre  = ctx.createGain(); inXfmrPre.gain.value  = 1;
  // oversample starts at 'none' so the identity curve passes through bit-
  // perfectly. When k > 0 _rebuildCurves() switches it to '4x' for
  // anti-aliasing. 4× oversample is NOT transparent even with an identity
  // curve — the internal up/down-sample polyphase filters add small phase
  // and amplitude shifts that accumulate into ~1.5 dB peak overshoot across
  // 4 cascaded waveshapers. Only pay that cost when we're actually shaping.
  const inXfmrSat  = ctx.createWaveShaper(); inXfmrSat.oversample = 'none';
  const inXfmrPost = ctx.createGain(); inXfmrPost.gain.value = 1;

  // Transient softening — a 1-pole LPF whose corner moves DOWN when the
  // envelope follower detects fast peaks. Approximates slew-dependent
  // transient rounding without per-sample DSP.
  const inXfmrTransientLPF = ctx.createBiquadFilter();
  inXfmrTransientLPF.type = 'lowpass';
  inXfmrTransientLPF.frequency.value = 22050; // Nyquist = inert at defaults
  inXfmrTransientLPF.Q.value = 0.707;

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 3 — BA283-inspired Class-A amplifier
  // ═══════════════════════════════════════════════════════════════════════
  // Two parallel transfer paths blended by an envelope-driven crossfader:
  //   evenPath: biased tanh — dominant 2nd harmonic ("warmth")
  //   oddPath:  symmetric tanh — dominant 3rd harmonic ("density")
  // At low signal levels the even path dominates (~85 %). As the envelope
  // rises, odd content fades in (~45 %), creating the "warms then thickens"
  // behavior described in the spec.
  const claPre = ctx.createGain(); claPre.gain.value = 1;

  const claEvenSat = ctx.createWaveShaper(); claEvenSat.oversample = 'none';
  const claOddSat  = ctx.createWaveShaper(); claOddSat.oversample  = 'none';

  const claEvenMix = ctx.createGain(); claEvenMix.gain.value = 0.85;
  const claOddMix  = ctx.createGain(); claOddMix.gain.value  = 0.15;
  const claSum     = ctx.createGain(); claSum.gain.value     = 1;

  // Micro-compression — gain node nudged DOWN by RAF envelope when peaks
  // get hot. Time constant chosen so it feels like "Class-A density",
  // not like a compressor. Default 1.0; envelope can pull it to ~0.92.
  const claMicroComp = ctx.createGain(); claMicroComp.gain.value = 1;

  const claPost = ctx.createGain(); claPost.gain.value = 1;

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 4 — Output Transformer (single-path, LF-emphasis saturation)
  // ═══════════════════════════════════════════════════════════════════════
  // Real iron saturates LF earlier than HF because low frequencies have
  // more energy per cycle. PREVIOUS implementation used a 3-band LR4
  // crossover split → per-band saturators → sum. That approach is broken:
  // the 3-way cascaded LR4 (low=LP·LP, mid=HP·HP·LP·LP, high=HP·HP) is
  // NOT magnitude-flat when summed because the mid path has twice the
  // group delay of the low and high paths, so the three bands recombine
  // with constructive interference that adds +4–6 dB through the mid.
  // (Confirmed empirically — postOTSum tap read +4 to +6 dB above
  //  postClassA at drive=0 with identity saturators.)
  //
  // The fix is to stay on a SINGLE signal path and make the saturation
  // frequency-dependent via pre/post emphasis:
  //
  //   claPost → otPreLift (LF boost) → otSat → otPostCut (inverse LF cut)
  //
  // When otSat has an identity curve and the pre/post filters are at 0 dB,
  // the path is mathematically transparent — no phase issues, no comb,
  // no excess gain. As drive rises, otPreLift tilts low-end up so LF
  // content hits the saturator harder (producing LF-biased harmonics),
  // and otPostCut tilts it back down by exactly the same amount so net
  // frequency response stays flat — only the distortion signature is
  // low-band-dominant, which is the "iron saturates lows first" feel.
  // OT pre/post emphasis at 100 Hz — targets kick sub/fundamental range.
  // Pre lifts lows into the saturator so iron distortion is kick-biased.
  // Post cancels the lift so net frequency response stays flat — only the
  // harmonic character is LF-dominant, not the level.
  const otPreLift  = ctx.createBiquadFilter();
  otPreLift.type  = 'lowshelf'; otPreLift.frequency.value  = 100; otPreLift.gain.value  = 0;
  const otSat      = ctx.createWaveShaper(); otSat.oversample = 'none';
  const otPostCut  = ctx.createBiquadFilter();
  otPostCut.type  = 'lowshelf'; otPostCut.frequency.value  = 100; otPostCut.gain.value  = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 5 — Dynamic HF softening
  // ═══════════════════════════════════════════════════════════════════════
  // Highshelf cut at 14 kHz, modulated by drive setting AND envelope. At
  // idle the cut is 0 (or -0.5 if thickness is up). As drive + level rise
  // it pulls down to -2 dB. This is the "edge softens when pushed" effect.
  const dynHFShelf = ctx.createBiquadFilter();
  dynHFShelf.type = 'highshelf';
  dynHFShelf.frequency.value = 14000;
  dynHFShelf.gain.value = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // EQ SECTION — 1073-style (HPF → Low shelf → Mid peak → High shelf)
  // ═══════════════════════════════════════════════════════════════════════
  // Sits between Stage 5 and Stage 6. All gains start at 0 dB (transparent).
  // HPF starts at 20 Hz (inaudible = effectively off). Everything stays
  // transparent until setEQLOn(true) is called.
  const eqHPF = ctx.createBiquadFilter();
  // eqHPF is NOT connected to the chain at construction — it is inserted
  // dynamically by _applyEQ() only when EQL is on. Keeps it from adding
  // any biquad artefacts at idle.
  eqHPF.type = 'highpass'; eqHPF.frequency.value = 20; eqHPF.Q.value = 0.707;

  const eqLowShelf = ctx.createBiquadFilter();
  eqLowShelf.type = 'lowshelf'; eqLowShelf.frequency.value = 60; eqLowShelf.gain.value = 0;

  const eqMidPeak = ctx.createBiquadFilter();
  eqMidPeak.type = 'peaking'; eqMidPeak.frequency.value = 1600;
  eqMidPeak.Q.value = 0.7; eqMidPeak.gain.value = 0;

  const eqHighShelf = ctx.createBiquadFilter();
  eqHighShelf.type = 'highshelf'; eqHighShelf.frequency.value = 12000; eqHighShelf.gain.value = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 6 — Mix / Auto Gain / Output Trim
  // ═══════════════════════════════════════════════════════════════════════
  const dryGain    = ctx.createGain(); dryGain.gain.value    = 0;
  const wetGain    = ctx.createGain(); wetGain.gain.value    = 1;
  const mixSum     = ctx.createGain(); mixSum.gain.value     = 1;
  const autoGain   = ctx.createGain(); autoGain.gain.value   = 1;
  const outputTrim = ctx.createGain(); outputTrim.gain.value = 1;

  // Bypass crossfader nodes — wetSwitch passes the processed signal,
  // bypSwitch passes the raw input. Exactly one is at 1.0 at any time.
  // This avoids any disconnect/reconnect dance and is impossible to get
  // wrong: the OUT trim sits on the WET side of the switch only.
  const wetSwitch = ctx.createGain(); wetSwitch.gain.value = 1;
  const bypSwitch = ctx.createGain(); bypSwitch.gain.value = 0;
  const finalSum  = ctx.createGain(); finalSum.gain.value  = 1;

  // No parallel dry/wet branching here — that approach (v4) caused comb
  // filtering when summed back against the wet chain because the LR4
  // crossover and other biquads in the wet path apply phase shift.
  //
  // Instead we take the same approach as iron1073Engine: a SINGLE signal
  // path through every biquad, and the saturation character is varied by
  // rebuilding each WaveShaperNode's curve dynamically. Each curve is
  // built as `x*(1-k) + tanh(poly)*k`, so k=0 is the identity function
  // (fully transparent) and k=1 is the original saturator. No phase
  // mismatch is possible because there are no parallel branches.

  // ───────────────────────────────────────────────────────────────────────
  // Build saturation curves (k-blended for transparency at zero)
  // ───────────────────────────────────────────────────────────────────────
  // EVERY curve is `c[i] = x*(1-k) + nonlinear(x)*k`. At k=0 this is the
  // identity function — bit-perfect transparent. At k=1 it's the original
  // saturator. Intermediate k values smoothly fade in the polynomial
  // contribution. setDrive and setThickness recompute k for each saturator
  // and rebuild the curves (debounced).
  const N = 4096;

  // --- Stage 2 Input Transformer: biased tanh, asym, mild ---
  function buildInXfmrCurve(k) {
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x;
      const asym = x > 0 ? 0.022 * x2 : -0.014 * x2;
      const poly = x + 0.06 * x2 + 0.025 * x3 + asym;
      const wet  = Math.tanh(poly);
      c[i] = x * (1 - k) + wet * k;
    }
    return c;
  }

  // --- Stage 3 Class-A EVEN path: biased tanh, dominant H2 ---
  function buildClassAEvenCurve(k) {
    const c = new Float32Array(N);
    const bias = 0.08;
    const dcOffset = Math.tanh(bias);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x;
      const poly = (x + bias) + 0.18 * x2 + 0.04 * x3;
      const wet  = Math.tanh(poly) - dcOffset;
      c[i] = x * (1 - k) + wet * k;
    }
    return c;
  }

  // --- Stage 3 Class-A ODD path: symmetric tanh, dominant H3 ---
  function buildClassAOddCurve(k) {
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x3 = x * x * x;
      const x5 = x3 * x * x;
      const poly = x + 0.14 * x3 + 0.025 * x5;
      const wet  = Math.tanh(poly);
      c[i] = x * (1 - k) + wet * k;
    }
    return c;
  }

  // --- Stage 4 Output Transformer: hot, asymmetric, atan-based.
  // This is the main "iron" tone — it receives a LF-emphasized signal
  // (via otPreLift) so its distortion signature is LF-biased even though
  // the curve itself is full-range. At k=0 it's bit-perfect identity.
  function buildOTSatCurve(k) {
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x, x5 = x2 * x2 * x;
      const asym = x > 0 ? 0.06 * x2 : -0.045 * x2;
      const poly = x + 0.16 * x2 + 0.09 * x3 + 0.018 * x5 + asym;
      const wet  = (2 / Math.PI) * Math.atan(poly * (Math.PI / 2));
      c[i] = x * (1 - k) + wet * k;
    }
    return c;
  }

  // Apply initial curves at k=0 → all are identity, totally transparent.
  inXfmrSat.curve   = buildInXfmrCurve(0);
  claEvenSat.curve  = buildClassAEvenCurve(0);
  claOddSat.curve   = buildClassAOddCurve(0);
  otSat.curve       = buildOTSatCurve(0);

  // ───────────────────────────────────────────────────────────────────────
  // Wire the chain
  // ───────────────────────────────────────────────────────────────────────
  // Dry tap for the user-facing MIX knob (separate from the internal
  // process wet/dry — this one is what the visible MIX slider controls).
  input.connect(dryGain);
  dryGain.connect(mixSum);

  // Stage 1 — input conditioning (wet chain entry, single path)
  input.connect(loadLowMid);
  loadLowMid.connect(loadHFTame);

  // Stage 2 — input transformer
  loadHFTame.connect(inXfmrPre);
  inXfmrPre.connect(inXfmrSat);
  inXfmrSat.connect(inXfmrPost);
  inXfmrPost.connect(inXfmrTransientLPF);

  // Stage 3 — Class-A (parallel even/odd)
  inXfmrTransientLPF.connect(claPre);
  claPre.connect(claEvenSat);
  claPre.connect(claOddSat);
  claEvenSat.connect(claEvenMix);
  claOddSat.connect(claOddMix);
  claEvenMix.connect(claSum);
  claOddMix.connect(claSum);
  claSum.connect(claMicroComp);
  claMicroComp.connect(claPost);

  // Stage 4 — Output transformer (single path, pre/post emphasis)
  claPost.connect(otPreLift);
  otPreLift.connect(otSat);
  otSat.connect(otPostCut);

  // Stage 5 — dynamic HF softening
  otPostCut.connect(dynHFShelf);

  // EQ section (Low → Mid → High). eqHPF is NOT wired in at construction —
  // it is inserted/removed dynamically by _applyEQ() so that when EQL is
  // off the node is completely out of the signal path (no biquad artefacts).
  dynHFShelf.connect(eqLowShelf);   // default: bypass eqHPF
  eqLowShelf.connect(eqMidPeak);
  eqMidPeak.connect(eqHighShelf);

  // Stage 6 — mix, auto gain, output trim → wet switch
  eqHighShelf.connect(wetGain);
  wetGain.connect(mixSum);
  mixSum.connect(autoGain);
  autoGain.connect(outputTrim);
  outputTrim.connect(wetSwitch);

  // Bypass switch — input branches directly into bypSwitch (skips OUT trim)
  input.connect(bypSwitch);

  // Both switches sum into finalSum, which feeds the world
  wetSwitch.connect(finalSum);
  bypSwitch.connect(finalSum);
  finalSum.connect(output);
  finalSum.connect(chainOutput);

  // ───────────────────────────────────────────────────────────────────────
  // Analysers + envelope follower
  // ───────────────────────────────────────────────────────────────────────
  // Per-channel splitter+analysers (matches scopeEngine.js exactly) so the
  // IN/OUT meters here read the SAME true L/R peak that the Scope module
  // does. A single AnalyserNode mono-downmixes (0.5·(L+R)) which under-reads
  // peak by 3-6 dB on uncorrelated stereo and disagrees with neighbouring
  // Scope modules. Reporting max(L,R) restores parity.
  //
  // Both IN and OUT use the SAME fftSize so window length cannot bias one
  // direction over the other.
  const inSplitter   = ctx.createChannelSplitter(2);
  const outSplitter  = ctx.createChannelSplitter(2);
  const inAnalyserL  = ctx.createAnalyser(); inAnalyserL.fftSize  = 2048;
  const inAnalyserR  = ctx.createAnalyser(); inAnalyserR.fftSize  = 2048;
  const outAnalyserL = ctx.createAnalyser(); outAnalyserL.fftSize = 2048;
  const outAnalyserR = ctx.createAnalyser(); outAnalyserR.fftSize = 2048;
  const envAnalyser  = ctx.createAnalyser(); envAnalyser.fftSize  = 512;

  input.connect(inSplitter);
  inSplitter.connect(inAnalyserL, 0);
  inSplitter.connect(inAnalyserR, 1);

  // OUT meter taps finalSum — that's the actual signal leaving the module,
  // so when bypass is engaged the meter reads the bypassed (= input) signal.
  finalSum.connect(outSplitter);
  outSplitter.connect(outAnalyserL, 0);
  outSplitter.connect(outAnalyserR, 1);

  // Envelope follower taps the post-Class-A signal — we want the envelope
  // to track AFTER the chain has shaped it, so the subsequent modulations
  // (HF damping, low-band makeup, etc.) react to the colored level not the
  // raw input.
  claPost.connect(envAnalyser);

  // ── DIAGNOSTIC INTERMEDIATE TAPS ────────────────────────────────────
  // One analyser per stage boundary so the diag report can pinpoint which
  // stage is adding the unexplained gain. Each is a 2048-sample mono RMS
  // tap; cheap. Removed once the bug is fixed.
  const _tapPostLoad   = ctx.createAnalyser(); _tapPostLoad.fftSize   = 2048;
  const _tapPostInXfmr = ctx.createAnalyser(); _tapPostInXfmr.fftSize = 2048;
  const _tapPostClassA = ctx.createAnalyser(); _tapPostClassA.fftSize = 2048;
  const _tapPostOT     = ctx.createAnalyser(); _tapPostOT.fftSize     = 2048;
  const _tapDynHF      = ctx.createAnalyser(); _tapDynHF.fftSize      = 2048;
  const _tapHPF        = ctx.createAnalyser(); _tapHPF.fftSize        = 2048;
  const _tapPostEQ     = ctx.createAnalyser(); _tapPostEQ.fftSize     = 2048;
  const _tapPostTrim   = ctx.createAnalyser(); _tapPostTrim.fftSize   = 2048;
  loadHFTame.connect(_tapPostLoad);
  inXfmrTransientLPF.connect(_tapPostInXfmr);
  claPost.connect(_tapPostClassA);
  otPostCut.connect(_tapPostOT);
  dynHFShelf.connect(_tapDynHF);
  eqHPF.connect(_tapHPF);
  eqHighShelf.connect(_tapPostEQ);
  outputTrim.connect(_tapPostTrim);

  const _inBufL  = new Float32Array(2048);
  const _inBufR  = new Float32Array(2048);
  const _outBufL = new Float32Array(2048);
  const _outBufR = new Float32Array(2048);
  const _envBuf  = new Float32Array(512);
  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;
  let _clipLogged = false;

  function _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function _peakAbs(buf) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
    return m;
  }

  // RMS — averaged level (smooth, body of the signal). Reports the louder
  // of L/R so a hard-panned signal doesn't read 3 dB low.
  function getInputLevel() {
    inAnalyserL.getFloatTimeDomainData(_inBufL);
    inAnalyserR.getFloatTimeDomainData(_inBufR);
    return Math.max(_rms(_inBufL), _rms(_inBufR));
  }
  function getOutputLevel() {
    outAnalyserL.getFloatTimeDomainData(_outBufL);
    outAnalyserR.getFloatTimeDomainData(_outBufR);
    return Math.max(_rms(_outBufL), _rms(_outBufR));
  }
  // PEAK — true sample peak with a 1.5-second hold (matches Scope). This
  // is what ClipMeter colours-on, so it MUST be a real peak (not max-of-rms)
  // or the meter will read ~6 dB low vs reality and miss every transient
  // clip. Hold window matches scopeEngine.js's PEAK_HOLD_TIME.
  function getInputPeak() {
    inAnalyserL.getFloatTimeDomainData(_inBufL);
    inAnalyserR.getFloatTimeDomainData(_inBufR);
    const p = Math.max(_peakAbs(_inBufL), _peakAbs(_inBufR));
    const n = ctx.currentTime;
    if (p > iPeak || n - iPeakT > 1.5) { iPeak = p; iPeakT = n; }
    return iPeak;
  }
  function getOutputPeak() {
    outAnalyserL.getFloatTimeDomainData(_outBufL);
    outAnalyserR.getFloatTimeDomainData(_outBufR);
    const p = Math.max(_peakAbs(_outBufL), _peakAbs(_outBufR));
    const n = ctx.currentTime;
    // Clip-detection: when output genuinely exceeds 1.0 (above 0 dBFS), do a
    // one-shot stage-by-stage trace so we can pinpoint which stage is boosting.
    if (p > 1.0 && !_clipLogged) {
      _clipLogged = true;
      const _cb = new Float32Array(2048);
      const _pk = (b) => { let m = 0; for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > m) m = v; } return m; };
      const _db = (x)  => (20 * Math.log10(Math.max(1e-9, x))).toFixed(2);
      inAnalyserL.getFloatTimeDomainData(_inBufL);
      inAnalyserR.getFloatTimeDomainData(_inBufR);
      const inPk = Math.max(_peakAbs(_inBufL), _peakAbs(_inBufR));
      _tapPostLoad.getFloatTimeDomainData(_cb);   const pkLoad    = _pk(_cb);
      _tapPostInXfmr.getFloatTimeDomainData(_cb); const pkInXfmr  = _pk(_cb);
      _tapPostClassA.getFloatTimeDomainData(_cb); const pkClassA  = _pk(_cb);
      _tapPostOT.getFloatTimeDomainData(_cb);     const pkOT      = _pk(_cb);
      _tapDynHF.getFloatTimeDomainData(_cb);      const pkDynHF   = _pk(_cb);
      _tapHPF.getFloatTimeDomainData(_cb);        const pkHPF     = _pk(_cb);
      _tapPostEQ.getFloatTimeDomainData(_cb);     const pkEQ      = _pk(_cb);
      _tapPostTrim.getFloatTimeDomainData(_cb);   const pkTrim    = _pk(_cb);
      console.warn(
        `[NastyNeve CLIP] t=${n.toFixed(3)} OUT=${_db(p)} dBFS — stage peaks (dBFS):\n` +
        `  in=${_db(inPk)}  load=${_db(pkLoad)}  inXfmr=${_db(pkInXfmr)}  classA=${_db(pkClassA)}\n` +
        `  ot=${_db(pkOT)}  dynHF=${_db(pkDynHF)}  hpf=${_db(pkHPF)}  eq=${_db(pkEQ)}  trim=${_db(pkTrim)}  finalOut=${_db(p)}\n` +
        `  GAINS: claPre=${claPre.gain.value.toFixed(4)} claPost=${claPost.gain.value.toFixed(4)} ` +
        `even=${claEvenMix.gain.value.toFixed(4)} odd=${claOddMix.gain.value.toFixed(4)} ` +
        `uComp=${claMicroComp.gain.value.toFixed(4)} otLift=${otPreLift.gain.value.toFixed(2)} ` +
        `otCut=${otPostCut.gain.value.toFixed(2)} dynHF=${dynHFShelf.gain.value.toFixed(4)} ` +
        `eqLow=${eqLowShelf.gain.value.toFixed(4)} eqMid=${eqMidPeak.gain.value.toFixed(4)} ` +
        `eqHigh=${eqHighShelf.gain.value.toFixed(4)} wet=${wetGain.gain.value.toFixed(4)} ` +
        `dry=${dryGain.gain.value.toFixed(4)} trim=${outputTrim.gain.value.toFixed(4)}\n` +
        `  HPF: freq=${eqHPF.frequency.value.toFixed(1)} Hz  Q=${eqHPF.Q.value.toFixed(4)}  eqlOn=${_eqlOn}`
      );
      // Re-enable after 2 seconds so we don't flood the console
      setTimeout(() => { _clipLogged = false; }, 2000);
    }
    if (p > oPeak || n - oPeakT > 1.5) { oPeak = p; oPeakT = n; }
    return oPeak;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Parameter state
  // ───────────────────────────────────────────────────────────────────────
  let _driveDb    = 0;
  let _thickness  = 0.5;
  let _autoMakeup = false;

  // EQ state
  let _eqlOn         = false;
  let _hpfFreq       = 0;       // 0 = off; else 50/80/160/300 Hz
  let _lowShelfFreq  = 60;
  let _lowShelfGain  = 0;
  let _midFreq       = 1600;
  let _midGain       = 0;
  let _highShelfGain = 0;

  // Tracks whether eqHPF is physically inserted in the chain. Guards against
  // duplicate connect() calls (Web Audio sums duplicates silently).
  let _hpfInChain = false;

  function _applyEQ() {
    const t = ctx.currentTime;
    if (_eqlOn) {
      // Insert eqHPF into chain: dynHFShelf → eqHPF → eqLowShelf
      if (!_hpfInChain) {
        try { dynHFShelf.disconnect(eqLowShelf); } catch {}
        eqHPF.type = 'highpass';
        eqHPF.frequency.value = _hpfFreq > 0 ? _hpfFreq : 20;
        dynHFShelf.connect(eqHPF);
        eqHPF.connect(eqLowShelf);
        _hpfInChain = true;
      }
      eqHPF.frequency.setTargetAtTime(_hpfFreq > 0 ? _hpfFreq : 20, t, 0.02);
      eqLowShelf.frequency.setTargetAtTime(_lowShelfFreq, t, 0.02);
      eqLowShelf.gain.setTargetAtTime(_lowShelfGain, t, 0.02);
      eqMidPeak.frequency.setTargetAtTime(_midFreq, t, 0.02);
      eqMidPeak.gain.setTargetAtTime(_midGain, t, 0.02);
      eqHighShelf.gain.setTargetAtTime(_highShelfGain, t, 0.02);
    } else {
      // Remove eqHPF from chain: dynHFShelf → eqLowShelf (direct)
      if (_hpfInChain) {
        try { dynHFShelf.disconnect(eqHPF);    } catch {}
        try { eqHPF.disconnect(eqLowShelf);    } catch {}
        dynHFShelf.connect(eqLowShelf);
        _hpfInChain = false;
      }
      eqLowShelf.gain.setTargetAtTime(0, t, 0.06);
      eqMidPeak.gain.setTargetAtTime(0, t, 0.06);
      eqHighShelf.gain.setTargetAtTime(0, t, 0.06);
    }
  }

  function setEQLOn(on)            { _eqlOn = !!on; _applyEQ(); }
  function setHPF(freq)            { _hpfFreq = freq; if (_eqlOn) _applyEQ(); }
  function setLowShelf(freq, gain) { _lowShelfFreq = freq; _lowShelfGain = gain; if (_eqlOn) _applyEQ(); }
  function setMidPeak(freq, gain)  { _midFreq = freq; _midGain = gain; if (_eqlOn) _applyEQ(); }
  function setHighShelf(gain)      { _highShelfGain = gain; if (_eqlOn) _applyEQ(); }

  // ───────────────────────────────────────────────────────────────────────
  // Envelope follower loop (RAF-like, ~30 Hz)
  // ───────────────────────────────────────────────────────────────────────
  // Derives a fast envelope (peak-of-window) and a slow envelope (smoothed)
  // from the post-Class-A tap, then drives:
  //   • Class-A even/odd crossfader
  //   • Class-A micro-compression gain
  //   • Dynamic HF softening shelf gain
  //   • Input transformer transient LPF corner
  //
  // Envelope time constants:
  //   fastEnv: ~25 ms (fast attack, fast release)
  //   slowEnv: ~250 ms (slow attack, slow release)
  let _envFast = 0;
  let _envSlow = 0;
  let _envHandle = null;

  function _envTick() {
    envAnalyser.getFloatTimeDomainData(_envBuf);
    const peak = _peakAbs(_envBuf);

    // One-pole smoothers. dt ≈ 0.033 s.
    const dt    = 0.033;
    const tFast = 0.025;
    const tSlow = 0.250;
    const aFast = 1 - Math.exp(-dt / tFast);
    const aSlow = 1 - Math.exp(-dt / tSlow);
    _envFast += (peak - _envFast) * aFast;
    _envSlow += (peak - _envSlow) * aSlow;

    const t = ctx.currentTime;

    // Normalize envelope to [0, 1] over a useful range. Clip at 1.0.
    const envLin = Math.min(1, _envFast / 0.6);          // 0.6 ≈ -4 dBFS = "hot"
    const driveNorm = _driveDb / 18;                      // [0, 1]

    // v6.7: Gate ALL envelope-driven modulation by drive+thickness. At
    // defaults (drive=0, thick=0) every modulated parameter stays frozen
    // at its idle value so rapid biquad/gain sweeps can't create transient
    // peak overshoot. modDepth scales smoothly from 0 → 1 as the user
    // dials in character.
    const modDepth = Math.min(1, Math.max(driveNorm, _thickness));

    // ── Class-A even/odd crossfader ──────────────────────────────────────
    // Idle: 85 % even, 15 % odd. Modulates toward denser/odder with drive.
    const oddDelta    = (envLin * 0.30 + driveNorm * 0.10) * modDepth;
    const oddFraction = 0.15 + oddDelta;
    const oddClamped  = Math.max(0.15, Math.min(0.55, oddFraction));
    const evenClamped = 1 - oddClamped;
    claEvenMix.gain.setTargetAtTime(evenClamped, t, 0.04);
    claOddMix.gain.setTargetAtTime(oddClamped,   t, 0.04);

    // ── Class-A micro-compression ────────────────────────────────────────
    // Gated by modDepth so at drive=0 the gain sits frozen at 1.0 (no
    // state discontinuities → no peak overshoot at defaults).
    const transient  = Math.max(0, _envFast - _envSlow);
    const compAmount = transient * 0.25 * modDepth;
    const compTarget = Math.max(0.92, 1 - compAmount);
    claMicroComp.gain.setTargetAtTime(compTarget, t, 0.015);

    // ── Dynamic HF softening ─────────────────────────────────────────────
    // Baseline cut from thickness, dynamic cut from drive·envelope.
    // Already naturally zero at drive=0/thick=0, but scale dyn by modDepth
    // for smoothness.
    const hfBase = -0.8 * _thickness;  // more HF softening at 14 kHz with thickness
    const hfDyn  = -1.5 * driveNorm * envLin * modDepth;
    const hfTotal = hfBase + hfDyn;
    dynHFShelf.gain.setTargetAtTime(hfTotal, t, 0.08);

    // ── Input transformer transient LPF ──────────────────────────────────
    // 17 kHz at idle, slides toward 13 kHz on hot transients — but ONLY
    // when the user has engaged drive/thick. At defaults the corner is
    // frozen at 17 kHz so rapid biquad coefficient sweeps can't cause
    // transient state glitches.
    // At modDepth=0 (drive=0, thick=0) push LPF to Nyquist so it is
    // physically inert and introduces no HF rolloff or phase shift.
    const lpfHz = modDepth > 0
      ? 17000 - transient * 4000 * modDepth
      : ctx.sampleRate * 0.49;
    inXfmrTransientLPF.frequency.setTargetAtTime(lpfHz, t, 0.05);

    _envHandle = setTimeout(_envTick, 33);
  }
  _envTick();

  // ───────────────────────────────────────────────────────────────────────
  // Auto gain compensation (slow LUFS-ish loop, ~1 Hz)
  // ───────────────────────────────────────────────────────────────────────
  // Compares input vs output RMS over a long window and adjusts autoGain
  // gently. Off by default. Caps adjustment at ±6 dB so it can never wildly
  // distort the signal.
  let _autoTimer = null;
  function _autoTick() {
    if (_autoMakeup) {
      const inRms  = getInputLevel();
      const outRms = getOutputLevel();
      if (inRms > 0.001 && outRms > 0.001) {
        const ratio  = inRms / outRms;
        const target = Math.max(0.5, Math.min(2.0, ratio));
        autoGain.gain.setTargetAtTime(target, ctx.currentTime, 0.5);
      }
    } else {
      // Smoothly return to unity when off
      autoGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.5);
    }
  }
  _autoTimer = setInterval(_autoTick, 1000);

  // ───────────────────────────────────────────────────────────────────────
  // Public setters
  // ───────────────────────────────────────────────────────────────────────
  // Recompute the per-saturator hotness factor `k` from current drive +
  // thickness, then rebuild the WaveShaperNode curves. Each curve is
  // `x*(1-k) + nonlinear*k`, so k=0 is bit-perfect identity and k=1 is
  // the original full-strength saturator. There are no parallel branches
  // in the audio graph, so no comb filtering — just smooth tonal evolution
  // as the user sweeps drive or thickness.
  //
  // Per-stage k values:
  //   inXfmrK  = max(driveNorm * 0.6, thickness * 0.3)
  //   claK     = driveNorm * 0.9                       (Class-A only on drive)
  //   lowK     = max(driveNorm, thickness * 0.7)        (THICK pushes lows hard)
  //   midK     = max(driveNorm * 0.7, thickness * 0.2)
  //   highK    = driveNorm * 0.5                       (HF restraint always)
  //
  // The curve rebuild is debounced 60 ms (matching iron1073Engine) so
  // dragging Drive/Thick doesn't hammer CPU on every mousemove.
  function _rebuildCurves() {
    const driveNorm = _driveDb / 18;
    const inXfmrK = Math.min(1, Math.max(driveNorm * 0.6, _thickness * 0.3));
    const claK    = Math.min(1, driveNorm * 0.9);
    // OT hotness: driven by drive, boosted by thickness. At k=0 (defaults)
    // this is the identity curve — 100 % transparent.
    // otK for thickness at 0.6 — audible iron bloom without crunch.
    // Drive can push it all the way to 1.0 for full saturation.
    const otK     = Math.min(1, Math.max(driveNorm, _thickness * 0.6));
    inXfmrSat.curve  = buildInXfmrCurve(inXfmrK);
    claEvenSat.curve = buildClassAEvenCurve(claK);
    claOddSat.curve  = buildClassAOddCurve(claK);
    otSat.curve      = buildOTSatCurve(otK);
    // Flip oversample to '4x' only when the curve is actually shaping.
    // At k=0 the curve is mathematically identity and 'none' is bit-perfect
    // transparent; '4x' adds polyphase filter artefacts (~0.4 dB per stage
    // of peak overshoot) for no benefit.
    inXfmrSat.oversample  = inXfmrK > 0.001 ? '4x' : 'none';
    claEvenSat.oversample = claK    > 0.001 ? '4x' : 'none';
    claOddSat.oversample  = claK    > 0.001 ? '4x' : 'none';
    otSat.oversample      = otK     > 0.001 ? '4x' : 'none';
  }
  let _curveTimer = null;
  function _scheduleCurveRebuild() {
    if (_curveTimer) clearTimeout(_curveTimer);
    _curveTimer = setTimeout(() => { _rebuildCurves(); _curveTimer = null; }, 60);
  }

  function setDrive(db) {
    _driveDb = Math.max(0, Math.min(18, db));
    const driveNorm = _driveDb / 18;
    const t = ctx.currentTime;

    // Saturation amount lives in the curves themselves now — rebuild them.
    _scheduleCurveRebuild();

    // Class-A drive: pre-gain pushes signal in, post-gain compensates 85 %.
    // User hears tone change, not loudness change.
    const claLin     = Math.pow(10, _driveDb / 20);
    const claCompLin = Math.pow(10, -_driveDb * 0.85 / 20);
    claPre.gain.setTargetAtTime(claLin,     t, 0.025);
    claPost.gain.setTargetAtTime(claCompLin, t, 0.025);

    // Input transformer: gentle 30 % drive scaling — it's a preparatory
    // stage, not the main saturator. Idle = unity (transparent).
    const inXfmrLin    = 1 + driveNorm * 0.30;
    const inXfmrComp   = 1 / (1 + driveNorm * 0.20);
    inXfmrPre.gain.setTargetAtTime(inXfmrLin,   t, 0.025);
    inXfmrPost.gain.setTargetAtTime(inXfmrComp, t, 0.025);

    // Output transformer pre/post LF emphasis — tilts low end UP before
    // the saturator (so LF content hits harder, producing LF-biased
    // distortion) and tilts it back DOWN after by exactly the same amount
    // (so net frequency response stays flat). At drive=0 and thickness=0
    // both are at 0 dB — bit-perfect transparent. Thickness also feeds
    // this so THICK has an audible effect even with drive at zero.
    const lfTilt = driveNorm * 5.0 + _thickness * 4.0;   // 0..9 dB
    otPreLift.gain.setTargetAtTime(+lfTilt, t, 0.04);
    otPostCut.gain.setTargetAtTime(-lfTilt, t, 0.04);

    // Presence peak: drive slightly reduces it as iron saturates the top.
    loadHFTame.gain.setTargetAtTime(_thickness * 2.0 - driveNorm * 0.5, t, 0.05);
  }

  function setThickness(v) {
    _thickness = Math.max(0, Math.min(1, v));
    const t = ctx.currentTime;

    // Low shelf at 180 Hz: 0 → +5 dB of Neve body (transformer bloom zone).
    loadLowMid.gain.setTargetAtTime(_thickness * 5.0, t, 0.05);

    // Presence peak at 3.5 kHz: 0 → +2 dB Neve "air and snap" character.
    // Drive contribution handled in setDrive.
    const driveNorm = _driveDb / 18;
    loadHFTame.gain.setTargetAtTime(_thickness * 2.0 - driveNorm * 0.5, t, 0.05);

    // Re-apply OT LF emphasis (at 100 Hz, kick-range) so thickness contribution
    // takes effect immediately (without waiting for setDrive).
    const lfTilt = driveNorm * 5.0 + _thickness * 4.0;
    otPreLift.gain.setTargetAtTime(+lfTilt, t, 0.05);
    otPostCut.gain.setTargetAtTime(-lfTilt, t, 0.05);

    // Thickness pushes the OT saturator curve — warm iron bloom, not crunch.
    // k=0.4 at thick=1.0 drive=0: noticeable but not aggressive.
    _scheduleCurveRebuild();
  }

  function setOutputTrim(db) {
    const lin = Math.pow(10, db / 20);
    outputTrim.gain.setTargetAtTime(lin, ctx.currentTime, 0.02);
  }

  function setInputGain(lin) {
    input.gain.setTargetAtTime(lin, ctx.currentTime, 0.02);
  }

  function setMix(v) {
    const wet = Math.max(0, Math.min(1, v));
    const dry = 1 - wet;
    const t = ctx.currentTime;
    wetGain.gain.setTargetAtTime(wet, t, 0.03);
    dryGain.gain.setTargetAtTime(dry, t, 0.03);
  }

  function setAutoMakeup(on) { _autoMakeup = !!on; }

  // ───────────────────────────────────────────────────────────────────────
  // Bypass — TRUE unity via gain crossfade (impossible to get wrong)
  // ───────────────────────────────────────────────────────────────────────
  // wetSwitch carries the processed signal (post outputTrim). bypSwitch
  // carries raw input. Exactly one is at 1.0 at any moment, the other at 0.
  // Because the OUT trim sits ENTIRELY on the wet side of the switch, when
  // bypass is engaged the OUT knob has zero effect on the signal — true
  // hardware bypass. The OUT meter taps finalSum, which is downstream of
  // the switch, so it always shows what's actually leaving the module.
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    const t = ctx.currentTime;
    // Hard-set the values (cancel any in-flight ramps), then short ramp
    // for click suppression.
    wetSwitch.gain.cancelScheduledValues(t);
    bypSwitch.gain.cancelScheduledValues(t);
    if (want) {
      wetSwitch.gain.setTargetAtTime(0, t, 0.005);
      bypSwitch.gain.setTargetAtTime(1, t, 0.005);
    } else {
      wetSwitch.gain.setTargetAtTime(1, t, 0.005);
      bypSwitch.gain.setTargetAtTime(0, t, 0.005);
    }
  }

  function destroy() {
    if (_envHandle)  clearTimeout(_envHandle);
    if (_autoTimer)  clearInterval(_autoTimer);
    if (_curveTimer) clearTimeout(_curveTimer);
    // Disconnect every node so the audio graph releases them cleanly. This
    // matters under React StrictMode, which mounts → unmounts → re-mounts in
    // dev: without explicit disconnects the first engine's nodes linger in
    // memory until GC picks them up. Wrap each in try/catch so a missing
    // connection (e.g. node never wired in this configuration) can't throw
    // and abort the rest of the teardown.
    const nodes = [
      input, output, chainOutput,
      loadLowMid, loadHFTame,
      inXfmrPre, inXfmrSat, inXfmrPost, inXfmrTransientLPF,
      claPre, claEvenSat, claOddSat, claEvenMix, claOddMix, claSum,
      claMicroComp, claPost,
      otPreLift, otSat, otPostCut,
      dynHFShelf,
      eqHPF, eqLowShelf, eqMidPeak, eqHighShelf,
      dryGain, wetGain, mixSum, autoGain, outputTrim,
      wetSwitch, bypSwitch, finalSum,
      inSplitter, outSplitter,
      inAnalyserL, inAnalyserR, outAnalyserL, outAnalyserR, envAnalyser,
    ];
    for (const n of nodes) {
      try { n.disconnect(); } catch {}
    }
  }

  // Apply defaults — drive=0, thick=0 → all curves at k=0 → bit-perfect identity.
  setDrive(0);
  setThickness(0);
  setOutputTrim(0);
  setMix(1);

  // ───────────────────────────────────────────────────────────────────────
  // Diagnostic — measures input vs output level repeatedly until we see
  // some real signal, then reports it. Catches whatever non-unity gain is
  // hiding in the chain. Stops itself after 20 reports or when delta is
  // measured at sufficient signal level.
  // ───────────────────────────────────────────────────────────────────────
  let _diagShots = 0;
  let _diagDone = false;
  // Rolling peak accumulators — match UI semantics (peak over ~1.5 s hold).
  let _diagInPeakAcc  = 0;
  let _diagOutPeakAcc = 0;
  let _diagAccStart   = ctx.currentTime;
  function _diagTick() {
    if (_diagDone) return;
    const buf = new Float32Array(2048);
    const rms = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]*b[i]; return Math.sqrt(s/b.length); };
    const pk  = (b) => { let m = 0; for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > m) m = v; } return m; };
    const dB  = (x) => 20 * Math.log10(Math.max(1e-9, x));
    const inL = new Float32Array(2048), inR = new Float32Array(2048);
    const oL = new Float32Array(2048), oR = new Float32Array(2048);
    inAnalyserL.getFloatTimeDomainData(inL);
    inAnalyserR.getFloatTimeDomainData(inR);
    outAnalyserL.getFloatTimeDomainData(oL);
    outAnalyserR.getFloatTimeDomainData(oR);
    const inRms  = Math.max(rms(inL), rms(inR));
    const outRms = Math.max(rms(oL), rms(oR));
    const inPk   = Math.max(pk(inL), pk(inR));
    const outPk  = Math.max(pk(oL), pk(oR));
    // Accumulate rolling peak across ticks so we mirror the UI meter's
    // 1.5 s peak-hold behaviour.
    if (inPk  > _diagInPeakAcc)  _diagInPeakAcc  = inPk;
    if (outPk > _diagOutPeakAcc) _diagOutPeakAcc = outPk;
    // Read each intermediate tap — both RMS and PEAK so we can see which
    // stage adds transient content even if RMS stays flat.
    _tapPostLoad.getFloatTimeDomainData(buf);   const rmsLoad   = rms(buf), pkLoad   = pk(buf);
    _tapPostInXfmr.getFloatTimeDomainData(buf); const rmsInXfmr = rms(buf), pkInXfmr = pk(buf);
    _tapPostClassA.getFloatTimeDomainData(buf); const rmsClassA = rms(buf), pkClassA = pk(buf);
    _tapPostOT.getFloatTimeDomainData(buf);     const rmsOT     = rms(buf), pkOT     = pk(buf);
    _tapPostEQ.getFloatTimeDomainData(buf);     const rmsEQ     = rms(buf), pkEQ     = pk(buf);
    _tapPostTrim.getFloatTimeDomainData(buf);   const rmsTrim   = rms(buf), pkTrim   = pk(buf);
    // Only log when we have actual signal (above -50 dBFS), otherwise the
    // analysers just report noise floor and the delta is meaningless.
    if (inRms > 0.003 || outRms > 0.003) {
      _diagShots++;
      const f2 = (x) => x.toFixed(2);
      const f4 = (x) => x.toFixed(4);
      // Flat single-line logs so "Copy all messages" produces readable text
      // even when objects are not expanded in DevTools.
      console.log(
        `[NastyNeve v6] #${_diagShots} RMS  in=${f2(dB(inRms))}  out=${f2(dB(outRms))}  delta=${f2(dB(outRms) - dB(inRms))}`
      );
      console.log(
        `[NastyNeve v6] #${_diagShots} PEAK in=${f2(dB(inPk))}  out=${f2(dB(outPk))}  delta=${f2(dB(outPk) - dB(inPk))}  ` +
        `HOLD in=${f2(dB(_diagInPeakAcc))}  out=${f2(dB(_diagOutPeakAcc))}  delta=${f2(dB(_diagOutPeakAcc) - dB(_diagInPeakAcc))}`
      );
      console.log(
        `[NastyNeve v6] #${_diagShots} TAPS rms(rel in)  ` +
        `load=${f2(dB(rmsLoad) - dB(inRms))}  ` +
        `inXfmr=${f2(dB(rmsInXfmr) - dB(inRms))}  ` +
        `classA=${f2(dB(rmsClassA) - dB(inRms))}  ` +
        `ot=${f2(dB(rmsOT) - dB(inRms))}  ` +
        `eq=${f2(dB(rmsEQ) - dB(inRms))}  ` +
        `trim=${f2(dB(rmsTrim) - dB(inRms))}  ` +
        `finalSum=${f2(dB(outRms) - dB(inRms))}`
      );
      console.log(
        `[NastyNeve v6] #${_diagShots} TAPS peak(rel in) ` +
        `load=${f2(dB(pkLoad) - dB(inPk))}  ` +
        `inXfmr=${f2(dB(pkInXfmr) - dB(inPk))}  ` +
        `classA=${f2(dB(pkClassA) - dB(inPk))}  ` +
        `ot=${f2(dB(pkOT) - dB(inPk))}  ` +
        `eq=${f2(dB(pkEQ) - dB(inPk))}  ` +
        `trim=${f2(dB(pkTrim) - dB(inPk))}  ` +
        `finalSum=${f2(dB(outPk) - dB(inPk))}`
      );
      console.log(
        `[NastyNeve v6] #${_diagShots} GAINS  ` +
        `even=${f4(claEvenMix.gain.value)} odd=${f4(claOddMix.gain.value)} ` +
        `uComp=${f4(claMicroComp.gain.value)} ` +
        `claPre=${f4(claPre.gain.value)} claPost=${f4(claPost.gain.value)} ` +
        `ixPre=${f4(inXfmrPre.gain.value)} ixPost=${f4(inXfmrPost.gain.value)} ` +
        `otLift=${f4(otPreLift.gain.value)} otCut=${f4(otPostCut.gain.value)} ` +
        `dynHF=${f4(dynHFShelf.gain.value)} ` +
        `eqLow=${f4(eqLowShelf.gain.value)} eqMid=${f4(eqMidPeak.gain.value)} eqHi=${f4(eqHighShelf.gain.value)} ` +
        `wet=${f4(wetGain.gain.value)} dry=${f4(dryGain.gain.value)} ` +
        `auto=${f4(autoGain.gain.value)} trim=${f4(outputTrim.gain.value)} ` +
        `wetSw=${f4(wetSwitch.gain.value)} bypSw=${f4(bypSwitch.gain.value)}`
      );
      console.log(
        `[NastyNeve v6] #${_diagShots} CHANS  ` +
        `in=${input.channelCount} final=${finalSum.channelCount} wet=${wetGain.channelCount}`
      );
      if (_diagShots >= 5) _diagDone = true;
    }
    if (!_diagDone) setTimeout(_diagTick, 500);
  }
  setTimeout(_diagTick, 500);

  return {
    ctx, input, output, chainOutput,
    setDrive, setThickness, setInputGain, setOutputTrim, setMix, setAutoMakeup,
    setEQLOn, setHPF, setLowShelf, setMidPeak, setHighShelf,
    setBypass, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
  };
}
