// neveEngine.js — 1073 Neve-style transformer preamp
//
// The goal of this engine is to feel like a unit with real input and output
// transformers in the signal path — not a drive pedal.
//
// Key behaviors of a real transformer:
//   1. Linear response below core saturation flux. Program material at
//      normal levels passes CLEANLY. There is no always-on "color" — the
//      iron is transparent until you push signal into it.
//   2. When the core approaches saturation, the B-H curve knees. Peaks get
//      rounded off asymmetrically → generates H2 + H3 at the same time.
//      The asymmetry is where the "warmth" comes from.
//   3. Finite bandwidth. A 1073 input transformer is roughly 30 Hz – 22 kHz
//      (-3 dB); output is tighter, ~35 Hz – 19 kHz. The in-band response is
//      flat — the "sound" is the rolloff at the edges and the phase shift
//      from the primary's inductance.
//   4. LF headroom runs out first (flux × time), so bass hits saturation
//      sooner than midrange. Pushed LF material generates more harmonics.
//
// Modeling strategy:
//   • Bandwidth: one 1-pole HP and one 1-pole LP around EACH shaper stage.
//     These are the defining "feel" filters — they give the signal the
//     phase tilt and top-end rounding that make a pre feel "open" even
//     while it's adding character.
//   • Saturation: hard-knee soft-clipping curve. Below |x| < knee the
//     response is PERFECTLY LINEAR — slope exactly 1, no harmonics, no
//     level change. Above the knee the output curves asymptotically
//     toward a ceiling using 1 - e^(-over·rate). Asymmetric knees
//     (kneePos ≠ kneeNeg) generate H2; the exponential generates H3 + H5.
//   • LF-dependent saturation: +5 dB shelf at 160 Hz before the input
//     shaper, -5 dB after, so bass content crosses the knee sooner.
//   • Two transformers, two shapers: input transformer is larger/cooler
//     (higher knee, gentler curve), output is smaller/hotter (lower knee,
//     sharper knee). Output shaper sits AFTER the EQ, so boosting bands
//     genuinely pushes the output iron harder — the EQ interacts with the
//     saturation like it does on real hardware.
//
// What this engine removed from the previous version:
//   • The polynomial shaper (x + 0.14x² + 0.10x³ + …). Because the curve
//     had nonzero slope at every point, it generated harmonics on ALL
//     signals regardless of level, making the module sound "always driven"
//     — basically a drive knob with extra steps. Replaced with the
//     knee-based curve so the module is transparent below -5 dBFS peaks.
//   • The baked-in voicing filters (girth +0.6 dB, presenceBump +0.7 dB,
//     hfRolloff -1.2 dB). These were compensating for the fact that the
//     previous model didn't have proper transformer bandwidth. Now the
//     1-pole HP/LP pairs around the shapers do the tone-shaping naturally.
//
// Signal chain:
//   input → drivePreGain
//         → inputTxHP (30 Hz)  → preEmphasis (+5 dB LF)
//         → inputShaper        → deEmphasis (-5 dB LF) → inputTxLP (22 kHz)
//         → userHpfA → userHpfB                         (cascaded 2×12 dB/oct)
//         → low → mid → high                            (user EQ)
//         → outputTxHP (35 Hz)
//         → outputShaper
//         → outputTxLP (19 kHz)
//         → makeupGain → outputTrim → output / chainOutput

export function createNeveEngine(ctx) {
  // === I/O ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();

  // === Trim (drive into the iron) ===
  // Pushes signal into the always-on shapers. More trim = signal crosses
  // the knee sooner = more harmonic content. At trim = 0 dB the signal is
  // entering the chain at unity, and the shapers are transparent below
  // about -5 dBFS peaks — so normal program material passes clean until
  // you push it.
  const drivePreGain = ctx.createGain(); drivePreGain.gain.value = 1;

  // === Input transformer bandwidth ===
  // 1-pole HP at 30 Hz and 1-pole LP at 22 kHz around the input shaper.
  // These create the phase tilt and gentle top roll-off that you can hear
  // on a real 1073 preamp even with everything flat.
  const inputTxHP = ctx.createBiquadFilter();
  inputTxHP.type = 'highpass';
  inputTxHP.frequency.value = 30;
  inputTxHP.Q.value = 0.707;

  const inputTxLP = ctx.createBiquadFilter();
  inputTxLP.type = 'lowpass';
  inputTxLP.frequency.value = 22000;
  inputTxLP.Q.value = 0.707;

  // === Pre/de-emphasis — LF-dependent saturation ===
  // +5 dB shelf at 160 Hz into the input shaper means bass frequencies
  // reach the knee sooner, so bass content generates more harmonics than
  // midrange at the same fader level. The matching -5 dB shelf after the
  // shaper cancels the magnitude boost but keeps the extra harmonics.
  // This is how a real transformer's B-H curve behaves: low frequencies
  // require more flux × time, so the core saturates at LF first.
  const preEmphasis = ctx.createBiquadFilter();
  preEmphasis.type = 'lowshelf';
  preEmphasis.frequency.value = 160;
  preEmphasis.gain.value = 5;

  const deEmphasis = ctx.createBiquadFilter();
  deEmphasis.type = 'lowshelf';
  deEmphasis.frequency.value = 160;
  deEmphasis.gain.value = -5;

  // === Input transformer shaper (4x oversampled) ===
  const inputTransformerShaper = ctx.createWaveShaper();
  inputTransformerShaper.oversample = '4x';

  // === Output transformer bandwidth ===
  // Tighter than the input — output iron is physically smaller on a 1073,
  // so the self-resonances are closer together (35 Hz – 19 kHz, -3 dB).
  const outputTxHP = ctx.createBiquadFilter();
  outputTxHP.type = 'highpass';
  outputTxHP.frequency.value = 35;
  outputTxHP.Q.value = 0.707;

  const outputTxLP = ctx.createBiquadFilter();
  outputTxLP.type = 'lowpass';
  outputTxLP.frequency.value = 19000;
  outputTxLP.Q.value = 0.707;

  // === Output transformer shaper (4x oversampled) ===
  // Sits AFTER the EQ so band boosts interact with its saturation.
  const outputTransformerShaper = ctx.createWaveShaper();
  outputTransformerShaper.oversample = '4x';

  // === User HPF ===
  // Cascaded 2×12 dB/oct for ~24 dB/oct, close to the 18 dB/oct on a real
  // 1073. OFF parks both poles at 10 Hz so it's inaudible.
  const hpfA = ctx.createBiquadFilter();
  hpfA.type = 'highpass'; hpfA.frequency.value = 10; hpfA.Q.value = 0.707;
  const hpfB = ctx.createBiquadFilter();
  hpfB.type = 'highpass'; hpfB.frequency.value = 10; hpfB.Q.value = 0.707;

  // === User EQ ===
  // 1073 EQ frequencies are SWITCHED, not swept — the UI exposes discrete
  // chips for each band's available corner frequencies.
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 110;
  low.gain.value = 0;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1600;
  mid.Q.value = 0.7;
  mid.gain.value = 0;

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  // 8 kHz corner because Web Audio's biquad highshelf knees START at the
  // corner and don't reach full gain until roughly an octave above. A
  // 12 kHz corner would put half the boost above Nyquist — the knob
  // would feel dead. 8 kHz gives ~70% of target gain at 12 kHz (the
  // real 1073's labeled "air" point) and full gain by 16 kHz.
  high.frequency.value = 8000;
  high.gain.value = 0;

  // === Makeup + output trim ===
  const makeupGain = ctx.createGain(); makeupGain.gain.value = 1;
  const outputTrim = ctx.createGain(); outputTrim.gain.value = 1;

  // === Wire the chain ===
  input.connect(drivePreGain);
  drivePreGain.connect(inputTxHP);
  inputTxHP.connect(preEmphasis);
  preEmphasis.connect(inputTransformerShaper);
  inputTransformerShaper.connect(deEmphasis);
  deEmphasis.connect(inputTxLP);
  inputTxLP.connect(hpfA);
  hpfA.connect(hpfB);
  hpfB.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(outputTxHP);
  outputTxHP.connect(outputTransformerShaper);
  outputTransformerShaper.connect(outputTxLP);
  outputTxLP.connect(makeupGain);
  makeupGain.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  // === Iron saturation curves ===
  //
  // Hard-knee soft-clip, asymmetric.
  //
  //   |x| < knee   → output = x         (PERFECTLY LINEAR — slope 1.0,
  //                                       zero harmonics, zero level
  //                                       change, the iron is not doing
  //                                       anything until you push it)
  //   |x| ≥ knee   → output = knee + (1 - e^(-(|x|-knee) · rate))
  //                          · (ceiling - knee)
  //
  // kneePos ≠ kneeNeg is what generates H2 — asymmetric clipping at the
  // knee means the positive and negative halves of a sine get rounded off
  // at slightly different levels. The exponential curve above the knee is
  // odd-symmetric in its argument, so on top of the H2 asymmetry it adds
  // smooth H3, H5, H7 — the "warm-up-as-you-push-it" character of iron.
  //
  // INPUT transformer (larger, cooler):
  //   knee +0.58 / -0.62  → knee at -4.7 / -4.1 dBFS peak
  //   ceiling 0.96        → gentle compression above
  //   rate  3.0           → smooth transition
  //
  // OUTPUT transformer (smaller, hotter, sharper):
  //   knee +0.50 / -0.53  → knee at -6.0 / -5.5 dBFS peak
  //   ceiling 0.94
  //   rate  4.0           → sharper knee
  //
  // Why the output iron is "hotter": on a real 1073 the output transformer
  // is physically smaller than the input tx, runs at higher flux density,
  // and saturates earlier. Because the output shaper also sits after the
  // EQ, boosting a band pushes its particular frequency region harder into
  // this stage — which is the interaction that makes hardware EQ feel
  // "non-linear" in a good way.
  const buildIronCurve = (kneePos, kneeNeg, ceiling, rate) => {
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      const s = x >= 0 ? 1 : -1;
      const absX = Math.abs(x);
      const knee = x >= 0 ? kneePos : kneeNeg;
      if (absX < knee) {
        curve[i] = x;                                // perfectly linear
      } else {
        const over = absX - knee;
        const headroom = ceiling - knee;
        const curved = knee + (1 - Math.exp(-over * rate)) * headroom;
        curve[i] = s * curved;
      }
    }
    return curve;
  };

  inputTransformerShaper.curve  = buildIronCurve(0.58, 0.62, 0.96, 3.0);
  outputTransformerShaper.curve = buildIronCurve(0.50, 0.53, 0.94, 4.0);

  // === Analysers for metering ===
  const inputAnalyser  = ctx.createAnalyser(); inputAnalyser.fftSize  = 2048;
  const outputAnalyser = ctx.createAnalyser(); outputAnalyser.fftSize = 2048;
  input.connect(inputAnalyser);
  outputTrim.connect(outputAnalyser);

  const _inBuf  = new Float32Array(2048);
  const _outBuf = new Float32Array(2048);
  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;

  // ───────────────────────────────────────────────────────────────────────────
  // Setters
  // ───────────────────────────────────────────────────────────────────────────
  let _driveDb = 0;
  function setDrive(db) {
    _driveDb = db;
    const lin = Math.pow(10, db / 20);
    const t   = ctx.currentTime;
    // drivePreGain pushes signal into the always-on iron chain. At 0 dB the
    // shapers are transparent below -5 dBFS peaks. Turning trim up simply
    // drives more signal across the knee — hotter material, more harmonics.
    drivePreGain.gain.setTargetAtTime(lin, t, 0.02);
  }

  // HPF freq in Hz; pass 10 (or any value ≤ 20) for "off".
  function setHpfFreq(hz) {
    const t = ctx.currentTime;
    hpfA.frequency.setTargetAtTime(hz, t, 0.02);
    hpfB.frequency.setTargetAtTime(hz, t, 0.02);
  }

  function setLowFreq(hz)  { low.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02); }
  function setLowGain(db)  { low.gain.setTargetAtTime(db,      ctx.currentTime, 0.02); }
  function setMidFreq(hz)  { mid.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02); }
  function setMidGain(db)  { mid.gain.setTargetAtTime(db,      ctx.currentTime, 0.02); }
  function setHighGain(db) { high.gain.setTargetAtTime(db,     ctx.currentTime, 0.02); }

  function setOutputTrim(db) {
    outputTrim.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, 0.02);
  }

  // CRITICAL: track current bypass state internally so that calling
  // setBypass(false) on a freshly-constructed engine is a no-op. Without
  // this guard, the first call would issue a second `input → drivePreGain`
  // connection on top of the one made during chain wiring, and Web Audio
  // sums duplicate connections — silently doubling the signal entering
  // the chain (+6 dB of phantom gain at "default").
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { input.disconnect(drivePreGain); } catch {}
      try { input.connect(outputTrim);      } catch {}
    } else {
      try { input.disconnect(outputTrim);   } catch {}
      try { input.connect(drivePreGain);    } catch {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Metering
  // ───────────────────────────────────────────────────────────────────────────
  function _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function getInputLevel()  { inputAnalyser.getFloatTimeDomainData(_inBuf);   return _rms(_inBuf);  }
  function getOutputLevel() { outputAnalyser.getFloatTimeDomainData(_outBuf); return _rms(_outBuf); }
  function getInputPeak()   { const l=getInputLevel(),  n=ctx.currentTime; if(l>iPeak||n-iPeakT>2){iPeak=l;iPeakT=n;} return iPeak; }
  function getOutputPeak()  { const l=getOutputLevel(), n=ctx.currentTime; if(l>oPeak||n-oPeakT>2){oPeak=l;oPeakT=n;} return oPeak; }

  function destroy() {}

  return {
    ctx, input, output, chainOutput,
    setDrive,
    setHpfFreq,
    setLowFreq, setLowGain,
    setMidFreq, setMidGain,
    setHighGain,
    setOutputTrim,
    setBypass,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
    destroy,
  };
}
