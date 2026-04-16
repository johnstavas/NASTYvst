// iron1073Engine.js — Neve 1073-inspired transformer coloration module
//
// PURPOSE
// ────────
// This is NOT a generic distortion. It models the *iron tone* of a 1073
// preamp — the thing that makes a real 1073 sound bigger and more expensive
// even at unity gain. Three stages, each contributing a different flavor:
//
//   1. Input transformer  → mild asymmetric, seeds 2nd harmonic
//   2. Class-A gain stage → smooth even-dominant, the "warmth"
//   3. Output transformer → frequency-split saturator, lows bloom hardest
//
// The signal flow mirrors a real 1073's analog topology, with one important
// trick: the output transformer is split into two bands BEFORE saturation,
// so lows hit a hotter curve than highs. That's how real iron behaves
// (LF saturates first because it has more energy per cycle), and it's why
// the lows "bloom" on a 1073 in a way single-curve saturators can't fake.
//
// SIGNAL CHAIN
// ─────────────
//   input → inputAnalyser
//         → inputTrim
//         → preEmphLow (+thick·6 dB shelf @ 180 Hz)
//         → preTilt    (–thick·1.5 dB shelf @ 7 kHz)
//         → inputXfmrShaper                   ← stage 1: input transformer
//         → inputXfmrLPF (1-pole @ 18 kHz)
//         → classAPreGain (drive ↑)
//         → classAShaper                      ← stage 2: Class-A
//         → classAPostGain (1 / drive·0.85)
//         → classADamper (drive-linked LPF)
//         ┌─→ outXfmrLowSplit (LP @ 250 Hz)
//         │     → outXfmrShaperLow ──┐
//         │                          ├─→ outXfmrSum
//         └─→ outXfmrHighSplit (HP @ 250 Hz)   ← stage 3: output transformer
//               → outXfmrShaperHigh ─┘
//         → outXfmrRolloff (–thick·2 dB @ 14 kHz)
//         → makeupGain
//         → outputTrim
//         → outputAnalyser
//         → output / chainOutput
//
// PARAMETERS
// ──────────
//   Drive     0 → 18 dB   How hard you push the iron. Pushes preGain into
//                          Class-A and scales the input/output transformer
//                          curve "hotness" multipliers. PostGain compensates
//                          85 % so loudness stays roughly stable.
//
//   Thickness 0 → 1       Tone macro: more thickness = more low-mid pre-
//                          emphasis into the input transformer + hotter
//                          low-band drive into the output transformer +
//                          softer top end. One knob, multiple linked moves.
//
//   Output    -24→+6 dB   Final trim after all saturation stages.
//
//   Mix       0 → 1       Dry/wet for parallel blend. Default 1.0 (full wet).

export function createIron1073Engine(ctx) {
  // ───────────────────────────────────────────────────────────────────────
  // I/O nodes
  // ───────────────────────────────────────────────────────────────────────
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();

  const inputTrim    = ctx.createGain(); inputTrim.gain.value = 1;

  // ───────────────────────────────────────────────────────────────────────
  // STAGE 1: Input transformer
  // ───────────────────────────────────────────────────────────────────────
  // Pre-emphasis shelf — Thickness pushes more lows into the saturator.
  const preEmphLow = ctx.createBiquadFilter();
  preEmphLow.type = 'lowshelf';
  preEmphLow.frequency.value = 180;
  preEmphLow.gain.value = 0;          // 0 → +6 dB by Thickness

  // Tilt — gently constrain extreme HF sharpness before the curve.
  const preTilt = ctx.createBiquadFilter();
  preTilt.type = 'highshelf';
  preTilt.frequency.value = 7000;
  preTilt.gain.value = 0;             // 0 → -1.5 dB by Thickness

  const inputXfmrShaper = ctx.createWaveShaper();
  inputXfmrShaper.oversample = '4x';

  // 1-pole LPF after the input transformer (fixed @ 18 kHz). Real iron
  // can't pass DC-to-Nyquist; this just shaves the brittlest fizz.
  const inputXfmrLPF = ctx.createBiquadFilter();
  inputXfmrLPF.type = 'lowpass';
  inputXfmrLPF.frequency.value = 18000;
  inputXfmrLPF.Q.value = 0.707;

  // ───────────────────────────────────────────────────────────────────────
  // STAGE 2: Class-A gain coloration
  // ───────────────────────────────────────────────────────────────────────
  const classAPreGain  = ctx.createGain(); classAPreGain.gain.value  = 1;
  const classAShaper   = ctx.createWaveShaper(); classAShaper.oversample = '4x';
  const classAPostGain = ctx.createGain(); classAPostGain.gain.value = 1;

  // Drive-linked dynamic damper: LPF whose corner moves DOWN as drive rises.
  // At drive=0 → 22 kHz (inaudible). At full drive → ~12 kHz. This is the
  // "high end softens when pushed" behavior — perceptually correct because
  // a real preamp's iron starts to lose top end as it saturates.
  const classADamper = ctx.createBiquadFilter();
  classADamper.type = 'lowpass';
  classADamper.frequency.value = 22000;
  classADamper.Q.value = 0.707;

  // ───────────────────────────────────────────────────────────────────────
  // STAGE 3: Output transformer (band-split saturator)
  // ───────────────────────────────────────────────────────────────────────
  // The signal entering this stage is duplicated: one path through a low-
  // pass + hot saturator, one path through a high-pass + gentle saturator.
  // After both saturate, they sum back into one stream. Lows hit harder
  // because the band-split isolates them and lets the curve work on them
  // exclusively, producing a "bloom" that whole-band saturators can't.
  const outXfmrSplitter = ctx.createGain(); outXfmrSplitter.gain.value = 1;

  // LOW BAND
  const outXfmrLowLP = ctx.createBiquadFilter();
  outXfmrLowLP.type = 'lowpass';
  outXfmrLowLP.frequency.value = 250;
  outXfmrLowLP.Q.value = 0.707;
  const outXfmrShaperLow = ctx.createWaveShaper();
  outXfmrShaperLow.oversample = '4x';
  const outXfmrLowMakeup = ctx.createGain(); outXfmrLowMakeup.gain.value = 1;

  // HIGH BAND
  const outXfmrHighHP = ctx.createBiquadFilter();
  outXfmrHighHP.type = 'highpass';
  outXfmrHighHP.frequency.value = 250;
  outXfmrHighHP.Q.value = 0.707;
  const outXfmrShaperHigh = ctx.createWaveShaper();
  outXfmrShaperHigh.oversample = '4x';

  // SUM
  const outXfmrSum = ctx.createGain(); outXfmrSum.gain.value = 1;

  // Iron-limited HF roll-off after the band-recombine — softens the very
  // top, scaled by Thickness. Real iron does this passively.
  const outXfmrRolloff = ctx.createBiquadFilter();
  outXfmrRolloff.type = 'highshelf';
  outXfmrRolloff.frequency.value = 14000;
  outXfmrRolloff.gain.value = 0;     // 0 → -2 dB by Thickness

  // ───────────────────────────────────────────────────────────────────────
  // Output stage
  // ───────────────────────────────────────────────────────────────────────
  const makeupGain = ctx.createGain(); makeupGain.gain.value = 1;
  const outputTrim = ctx.createGain(); outputTrim.gain.value = 1;

  // Dry / wet mix for parallel blend
  const dryGain = ctx.createGain(); dryGain.gain.value = 0;
  const wetGain = ctx.createGain(); wetGain.gain.value = 1;
  const mixSum  = ctx.createGain(); mixSum.gain.value = 1;

  // ───────────────────────────────────────────────────────────────────────
  // Build the saturation curves
  // ───────────────────────────────────────────────────────────────────────
  const N = 4096;

  // --- Input transformer curve ---
  // Asymmetric, mild. Slope at 0 = 1.0. Hot signal → ~3 % H2, ~0.8 % H3.
  function buildInputXfmrCurve(hotness) {
    const k = hotness;
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
      const asym = x > 0 ? 0.018 * x2 : -0.012 * x2;
      const poly = x
                 + 0.10  * x2 * k
                 + 0.04  * x3 * k
                 + 0.008 * x4 * k
                 + asym;
      c[i] = Math.tanh(poly);
    }
    return c;
  }

  // --- Class-A curve ---
  // Even-dominant, tube-ish. Slope at 0 = 1.0.
  function buildClassACurve() {
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x;
      const poly = x + 0.18 * x2 + 0.06 * x3;
      c[i] = Math.tanh(poly);
    }
    return c;
  }

  // --- Output transformer LOW band curve ---
  // The main tone stage. Hot, asymmetric, atan soft-clip for slower roll.
  function buildOutXfmrLowCurve(hotness) {
    const k = hotness;
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x, x5 = x2 * x2 * x;
      const asym = x > 0 ? 0.06 * x2 : -0.045 * x2;
      const poly = x
                 + 0.22  * x2 * k
                 + 0.14  * x3 * k
                 + 0.025 * x5 * k
                 + asym;
      // atan rolls off more gradually than tanh — it's hotter at the
      // shoulders without becoming brittle at the ceiling.
      c[i] = (2 / Math.PI) * Math.atan(poly * 1.4);
    }
    return c;
  }

  // --- Output transformer HIGH band curve ---
  // Light. We don't want fizz in the top.
  function buildOutXfmrHighCurve() {
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x  = (i * 2) / (N - 1) - 1;
      const x2 = x * x, x3 = x2 * x;
      const poly = x + 0.05 * x2 + 0.03 * x3;
      c[i] = Math.tanh(poly);
    }
    return c;
  }

  // Initial curves
  inputXfmrShaper.curve   = buildInputXfmrCurve(1.0);
  classAShaper.curve      = buildClassACurve();
  outXfmrShaperLow.curve  = buildOutXfmrLowCurve(1.0);
  outXfmrShaperHigh.curve = buildOutXfmrHighCurve();

  // ───────────────────────────────────────────────────────────────────────
  // Wire the chain
  // ───────────────────────────────────────────────────────────────────────
  input.connect(inputTrim);
  inputTrim.connect(dryGain);          // dry tap
  inputTrim.connect(preEmphLow);       // wet path

  preEmphLow.connect(preTilt);
  preTilt.connect(inputXfmrShaper);
  inputXfmrShaper.connect(inputXfmrLPF);

  inputXfmrLPF.connect(classAPreGain);
  classAPreGain.connect(classAShaper);
  classAShaper.connect(classAPostGain);
  classAPostGain.connect(classADamper);

  // Band split: feed both branches from classADamper
  classADamper.connect(outXfmrLowLP);
  classADamper.connect(outXfmrHighHP);

  outXfmrLowLP.connect(outXfmrShaperLow);
  outXfmrShaperLow.connect(outXfmrLowMakeup);
  outXfmrLowMakeup.connect(outXfmrSum);

  outXfmrHighHP.connect(outXfmrShaperHigh);
  outXfmrShaperHigh.connect(outXfmrSum);

  outXfmrSum.connect(outXfmrRolloff);
  outXfmrRolloff.connect(wetGain);

  // Mix
  dryGain.connect(mixSum);
  wetGain.connect(mixSum);
  mixSum.connect(makeupGain);
  makeupGain.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  // ───────────────────────────────────────────────────────────────────────
  // Analysers
  // ───────────────────────────────────────────────────────────────────────
  const inputAnalyser  = ctx.createAnalyser(); inputAnalyser.fftSize  = 2048;
  const outputAnalyser = ctx.createAnalyser(); outputAnalyser.fftSize = 2048;
  input.connect(inputAnalyser);
  outputTrim.connect(outputAnalyser);

  const _inBuf  = new Float32Array(2048);
  const _outBuf = new Float32Array(2048);
  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;

  function _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function getInputLevel()  { inputAnalyser.getFloatTimeDomainData(_inBuf);   return _rms(_inBuf);  }
  function getOutputLevel() { outputAnalyser.getFloatTimeDomainData(_outBuf); return _rms(_outBuf); }
  function getInputPeak()  { const l = getInputLevel(),  n = ctx.currentTime; if (l > iPeak || n - iPeakT > 2) { iPeak = l; iPeakT = n; } return iPeak; }
  function getOutputPeak() { const l = getOutputLevel(), n = ctx.currentTime; if (l > oPeak || n - oPeakT > 2) { oPeak = l; oPeakT = n; } return oPeak; }

  // ───────────────────────────────────────────────────────────────────────
  // Parameter setters
  // ───────────────────────────────────────────────────────────────────────
  let _driveDb   = 0;
  let _thickness = 0.5;
  let _autoMakeup = false;

  // Curve rebuild is debounced so dragging Drive doesn't hammer CPU.
  let _curveTimer = null;
  function _scheduleCurveRebuild() {
    if (_curveTimer) clearTimeout(_curveTimer);
    _curveTimer = setTimeout(() => {
      const driveNorm = _driveDb / 18;             // 0..1
      const inHot     = 1 + driveNorm * 0.7;       // input transformer hotness
      const lowHot    = 1 + driveNorm * 0.6 + _thickness * 0.5;  // low-band hotness
      inputXfmrShaper.curve  = buildInputXfmrCurve(inHot);
      outXfmrShaperLow.curve = buildOutXfmrLowCurve(lowHot);
      _curveTimer = null;
    }, 60);
  }

  function setDrive(db) {
    _driveDb = Math.max(0, Math.min(18, db));
    const t = ctx.currentTime;

    // Class-A drive: pre-gain pushes signal in, post-gain compensates 85%
    // so loudness stays roughly stable (user hears tone, not volume).
    const lin     = Math.pow(10, _driveDb / 20);
    const compLin = Math.pow(10, -_driveDb * 0.85 / 20);
    classAPreGain.gain.setTargetAtTime(lin,     t, 0.025);
    classAPostGain.gain.setTargetAtTime(compLin, t, 0.025);

    // High-end damper: 22 kHz at 0 drive → 12 kHz at full drive
    const damperHz = 22000 - (_driveDb / 18) * 10000;
    classADamper.frequency.setTargetAtTime(damperHz, t, 0.05);

    // Low-band post-saturation makeup. Saturation compresses the lows,
    // the makeup gives them back a touch of body. Scaled by drive.
    const lowMakeup = 1 + (_driveDb / 18) * 0.3;
    outXfmrLowMakeup.gain.setTargetAtTime(lowMakeup, t, 0.04);

    _scheduleCurveRebuild();
  }

  function setThickness(v) {
    _thickness = Math.max(0, Math.min(1, v));
    const t = ctx.currentTime;

    // Pre-emphasis: more lows pushed into the input transformer.
    preEmphLow.gain.setTargetAtTime(_thickness * 6, t, 0.05);

    // Pre-tilt: gentle HF restraint into the input transformer.
    preTilt.gain.setTargetAtTime(_thickness * -1.5, t, 0.05);

    // Output rolloff: HF softening after the output transformer.
    outXfmrRolloff.gain.setTargetAtTime(_thickness * -2, t, 0.05);

    _scheduleCurveRebuild();
  }

  function setOutputTrim(db) {
    const lin = Math.pow(10, db / 20);
    outputTrim.gain.setTargetAtTime(lin, ctx.currentTime, 0.02);
  }

  function setMix(v) {
    const wet = Math.max(0, Math.min(1, v));
    const dry = 1 - wet;
    const t = ctx.currentTime;
    wetGain.gain.setTargetAtTime(wet, t, 0.03);
    dryGain.gain.setTargetAtTime(dry, t, 0.03);
  }

  function setInputGain(v)  { inputTrim.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }

  function setAutoMakeup(on) { _autoMakeup = !!on; }

  // ───────────────────────────────────────────────────────────────────────
  // Slow auto-makeup loop — measures input vs output RMS over a 2s window
  // and adjusts makeupGain at ~1 Hz so loudness stays roughly stable as
  // Drive changes. Only active if setAutoMakeup(true) was called.
  // ───────────────────────────────────────────────────────────────────────
  let _makeupTimer = null;
  function _startMakeupLoop() {
    if (_makeupTimer) return;
    _makeupTimer = setInterval(() => {
      if (!_autoMakeup) return;
      const inRms  = getInputLevel();
      const outRms = getOutputLevel();
      if (inRms < 0.001 || outRms < 0.001) return;
      const ratio = inRms / outRms;
      const target = Math.max(0.5, Math.min(2.0, ratio));
      makeupGain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
    }, 1000);
  }
  _startMakeupLoop();

  // ───────────────────────────────────────────────────────────────────────
  // Bypass (true clean — input straight to outputTrim)
  // ───────────────────────────────────────────────────────────────────────
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { input.disconnect(inputTrim); } catch {}
      try { input.connect(outputTrim);   } catch {}
    } else {
      try { input.disconnect(outputTrim); } catch {}
      try { input.connect(inputTrim);     } catch {}
    }
  }

  function destroy() {
    if (_curveTimer)  clearTimeout(_curveTimer);
    if (_makeupTimer) clearInterval(_makeupTimer);
  }

  // Apply defaults
  setDrive(0);
  setThickness(0.5);
  setOutputTrim(0);
  setMix(1);

  return {
    ctx, input, output, chainOutput,
    setDrive, setThickness, setOutputTrim, setMix, setInputGain,
    setAutoMakeup, setBypass, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
  };
}
