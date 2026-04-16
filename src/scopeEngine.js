// scopeEngine.js — Transparent passthrough + deep metering / spectrum / scope / stereo analysis
//
// Signal flow (NO processing — fully transparent):
//   input → inputGain → outputGain → panner → output
//                                        │
//                                        ├─→ analyserSpectrum   (summed, 4096 FFT)
//                                        └─→ splitter ─┬─→ analyserL (2048 FFT, time-domain)
//                                                      └─→ analyserR (2048 FFT, time-domain)
//
// All analyser buffers are pre-allocated (no per-frame GC). Peak-hold state
// lives in the engine so it survives across frames even if the UI re-renders.

export function createScopeEngine(ctx) {

  // === I/O (fully transparent passthrough) ===
  const input         = ctx.createGain();
  const output        = ctx.createGain();
  const chainOutput   = ctx.createGain();
  const outputGain    = ctx.createGain();          outputGain.gain.value   = 1;
  const outputPanner  = ctx.createStereoPanner();  outputPanner.pan.value  = 0;
  const inputGainNode = ctx.createGain();          inputGainNode.gain.value = 1;

  input.connect(inputGainNode);
  inputGainNode.connect(outputGain);
  outputGain.connect(outputPanner);
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

  // === Stereo tap for L/R analysis ===
  // Splitter routes each channel of the post-panner stereo signal to its own
  // time-domain analyser. Used for stereo meters, goniometer, correlation.
  const splitter = ctx.createChannelSplitter(2);
  outputPanner.connect(splitter);

  const analyserL = ctx.createAnalyser();
  analyserL.fftSize = 2048;
  analyserL.smoothingTimeConstant = 0;
  const analyserR = ctx.createAnalyser();
  analyserR.fftSize = 2048;
  analyserR.smoothingTimeConstant = 0;
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);

  // === Spectrum analyser (mono sum) ===
  // 4096-point FFT gives ~11.7 Hz bin resolution at 48 kHz — enough to read
  // EQ activity down to the lowest musical frequencies clearly.
  // smoothingTimeConstant 0.82 feels like a classic spectrum analyzer (not too
  // twitchy, not too sluggish).
  const analyserSpectrum = ctx.createAnalyser();
  analyserSpectrum.fftSize               = 4096;
  analyserSpectrum.smoothingTimeConstant = 0.82;
  analyserSpectrum.minDecibels           = -100;
  analyserSpectrum.maxDecibels           = 0;
  outputPanner.connect(analyserSpectrum);

  // === Pre-allocated buffers ===
  const _specBuf     = new Float32Array(analyserSpectrum.frequencyBinCount);
  const _peakHoldBuf = new Float32Array(analyserSpectrum.frequencyBinCount);
  _peakHoldBuf.fill(-200);
  const _lBuf        = new Float32Array(analyserL.fftSize);
  const _rBuf        = new Float32Array(analyserR.fftSize);

  // Stereo peak-hold state (amplitude, not dB). Rises instantly, falls back
  // to instantaneous peak after PEAK_HOLD_TIME seconds.
  let lPeakHold = 0, rPeakHold = 0;
  let lPeakTime = 0, rPeakTime = 0;
  const PEAK_HOLD_TIME = 1.5;

  // Spectrum peak-hold fall rate (dB per frame at ~60 fps → ~24 dB/sec)
  const SPEC_HOLD_FALL_PER_FRAME = 0.4;

  // === DATA FETCHERS ===
  // Returns live spectrum (current frame) and peak-hold spectrum (slow-fall max).
  // Both are Float32Array in dBFS already (getFloatFrequencyData format).
  function getSpectrum() {
    analyserSpectrum.getFloatFrequencyData(_specBuf);
    for (let i = 0; i < _peakHoldBuf.length; i++) {
      const decayed = _peakHoldBuf[i] - SPEC_HOLD_FALL_PER_FRAME;
      _peakHoldBuf[i] = decayed > _specBuf[i] ? decayed : _specBuf[i];
    }
    return { live: _specBuf, hold: _peakHoldBuf };
  }

  // Returns per-channel time-domain buffers. These are ALSO used by getLevels()
  // to compute RMS/peak/correlation — so the draw loop should call getScope()
  // BEFORE getLevels() to populate the buffers.
  function getScope() {
    analyserL.getFloatTimeDomainData(_lBuf);
    analyserR.getFloatTimeDomainData(_rBuf);
    return { l: _lBuf, r: _rBuf };
  }

  // Computes:
  //   • Instantaneous peak per channel
  //   • Peak-hold per channel (rises instantly, falls after PEAK_HOLD_TIME)
  //   • RMS per channel
  //   • Crest factor per channel (20*log10(peak/rms), in dB)
  //   • Pearson stereo correlation (-1..+1)
  // Reads from _lBuf/_rBuf, which must be refreshed by getScope() first.
  function getLevels() {
    const n = _lBuf.length;
    let lSumSq = 0, rSumSq = 0, lMax = 0, rMax = 0;
    let sumLR  = 0, sumL2  = 0, sumR2 = 0;

    // Single pass over both buffers — RMS, peak, and correlation in one loop.
    for (let i = 0; i < n; i++) {
      const li = _lBuf[i];
      const ri = _rBuf[i];
      const la = li < 0 ? -li : li;
      const ra = ri < 0 ? -ri : ri;
      lSumSq += li * li;
      rSumSq += ri * ri;
      if (la > lMax) lMax = la;
      if (ra > rMax) rMax = ra;
      sumLR += li * ri;
      sumL2 += li * li;
      sumR2 += ri * ri;
    }

    const lRms = Math.sqrt(lSumSq / n);
    const rRms = Math.sqrt(rSumSq / n);

    // Peak-hold state update
    const now = ctx.currentTime;
    if (lMax >= lPeakHold || now - lPeakTime > PEAK_HOLD_TIME) { lPeakHold = lMax; lPeakTime = now; }
    if (rMax >= rPeakHold || now - rPeakTime > PEAK_HOLD_TIME) { rPeakHold = rMax; rPeakTime = now; }

    // Crest factor (dB): the gap between peak and RMS. Pure sine ≈ 3 dB,
    // music typically 8–18 dB, over-compressed content ≤ 6 dB.
    const lCrest = lRms > 1e-6 ? 20 * Math.log10(lMax / lRms) : 0;
    const rCrest = rRms > 1e-6 ? 20 * Math.log10(rMax / rRms) : 0;

    // Stereo correlation: +1 = mono, 0 = uncorrelated, -1 = out-of-phase.
    // Under ~0.5 is a warning sign for phase issues.
    const denom       = Math.sqrt(sumL2 * sumR2);
    const correlation = denom < 1e-9 ? 1 : sumLR / denom;

    return {
      lPeak:     lMax,      rPeak:     rMax,
      lPeakHold,             rPeakHold,
      lRms,                  rRms,
      lCrest,                rCrest,
      correlation,
    };
  }

  // === PARAMETER SETTERS ===
  function setInputGain(v)  { inputGainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,    ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,   ctx.currentTime, 0.02); }

  // Bypass: the module is already transparent, but we implement the standard
  // contract (disconnect-and-route-direct) so the chain-pill bypass dot
  // behaves consistently with the other modules.
  // Bypass-state guard: prevents the duplicate-connect bug where calling
  // setBypass(false) on a freshly-constructed engine would re-issue a
  // connection already made during construction (Web Audio sums duplicates).
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { inputGainNode.disconnect(outputGain); } catch {}
      try { input.connect(outputGain);            } catch {}
    } else {
      try { input.disconnect(outputGain);         } catch {}
      try { inputGainNode.connect(outputGain);    } catch {}
    }
  }

  function destroy() {}

  return {
    ctx, input, output, chainOutput,
    setInputGain, setOutputGain, setPan, setBypass, destroy,
    getSpectrum, getScope, getLevels,
    get sampleRate()      { return ctx.sampleRate; },
    get spectrumFftSize() { return analyserSpectrum.fftSize; },
  };
}
