// mixBusEngine.js — Mix Bus EQ + Compressor + Limiter engine
// Pure Web Audio API, synchronous init.
//
// Signal chain:
//   input → hpf → low → lowMid → highMid → high
//         → [comp] → makeupGain → [limiter] → outputGain → outputPanner → output
//                                              outputGain → chainOutput
//
// Brackets = independently bypassable via routing switch.

export function createMixBusEngine(ctx) {

  // === I/O ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();
  const outputGain   = ctx.createGain();   outputGain.gain.value  = 1;
  const outputPanner = ctx.createStereoPanner(); outputPanner.pan.value = 0;

  // === EQ filters ===
  // HPF default 15 Hz — well below audible range, effectively transparent at
  // rest. User drags the band up to engage a real sub-rumble cut.
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 15; hpf.Q.value = 0.7;

  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 100; low.gain.value = 0;

  const lowMid = ctx.createBiquadFilter();
  lowMid.type = 'peaking'; lowMid.frequency.value = 500; lowMid.Q.value = 1.0; lowMid.gain.value = 0;

  const highMid = ctx.createBiquadFilter();
  highMid.type = 'peaking'; highMid.frequency.value = 3000; highMid.Q.value = 1.0; highMid.gain.value = 0;

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf'; high.frequency.value = 10000; high.gain.value = 0;

  // EQ series chain
  input.connect(hpf); hpf.connect(low); low.connect(lowMid);
  lowMid.connect(highMid); highMid.connect(high);

  // === Bus Compressor ===
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value      =  6;   // soft knee — musical on bus
  comp.ratio.value     =  2;
  comp.attack.value    =  0.030;
  comp.release.value   =  0.150;

  const makeupGain = ctx.createGain();
  makeupGain.gain.value = 1; // linear — updated by setCompMakeup()

  // === Brickwall Limiter ===
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value      =  0;   // hard knee
  limiter.ratio.value     = 20;
  limiter.attack.value    =  0.001;
  limiter.release.value   =  0.05;

  // === Output routing ===
  // Both the bus compressor and the brickwall limiter start ROUTING-BYPASSED.
  // Neither DynamicsCompressor is truly transparent even at ratio=1, so we
  // keep them out of the signal path until the user enables them. The UI
  // defaults both LEDs to OFF, so adding a Mix Bus module is a flat
  // 5-band EQ by default with nothing coloring the sound.
  makeupGain.connect(outputGain); // limiter bypassed — makeupGain → outputGain direct
  outputGain.connect(outputPanner);
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

  // === Bypass state ===
  let _compEnabled    = false; // starts routing-bypassed
  let _limiterEnabled = false; // starts routing-bypassed
  let _compMakeupDb   = 0;

  // Initial routing: high → makeupGain (comp bypassed)
  high.connect(makeupGain);

  // === Analysers ===
  // specAnalyser is the mono sum feeding the EQ spectrum display.
  const specAnalyser  = ctx.createAnalyser();
  specAnalyser.fftSize               = 2048;
  specAnalyser.smoothingTimeConstant = 0.85;

  const inputAnalyser = ctx.createAnalyser();
  inputAnalyser.fftSize = 2048;

  // TRUE stereo metering: split the output into L/R and run each through its
  // own analyser. Without this the L and R meters always read identical values
  // (the "mono meter" bug).
  const outputSplitter = ctx.createChannelSplitter(2);
  const outAnalyserL   = ctx.createAnalyser(); outAnalyserL.fftSize = 2048;
  const outAnalyserR   = ctx.createAnalyser(); outAnalyserR.fftSize = 2048;
  output.connect(outputSplitter);
  outputSplitter.connect(outAnalyserL, 0);
  outputSplitter.connect(outAnalyserR, 1);

  output.connect(specAnalyser);
  input.connect(inputAnalyser);

  // === Pre-allocated metering buffers ===
  const _inBuf   = new Float32Array(2048);
  const _outBuf  = new Float32Array(2048);
  const _lBuf    = new Float32Array(2048);
  const _rBuf    = new Float32Array(2048);

  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;
  let lPeak = 0, rPeak = 0, lPeakT = 0, rPeakT = 0;

  // -------------------------------------------------------------------------
  // EQ setters
  // -------------------------------------------------------------------------
  const _filterMap = { hpf, low, lowMid, highMid, high };

  function setBandFreq(bandId, hz) {
    const f = _filterMap[bandId]; if (!f) return;
    f.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02);
  }
  function setBandGain(bandId, db) {
    if (bandId === 'hpf') return;
    const f = _filterMap[bandId]; if (!f) return;
    f.gain.setTargetAtTime(db, ctx.currentTime, 0.02);
  }
  function setBandQ(bandId, q) {
    const f = _filterMap[bandId]; if (!f) return;
    f.Q.setTargetAtTime(q, ctx.currentTime, 0.02);
  }

  // -------------------------------------------------------------------------
  // Compressor setters
  // -------------------------------------------------------------------------
  function setCompThreshold(db) {
    comp.threshold.setTargetAtTime(db,  ctx.currentTime, 0.02);
  }
  function setCompRatio(ratio) {
    comp.ratio.setTargetAtTime(ratio,   ctx.currentTime, 0.02);
  }
  function setCompAttack(s) {
    comp.attack.setTargetAtTime(s,      ctx.currentTime, 0.02);
  }
  function setCompRelease(s) {
    comp.release.setTargetAtTime(s,     ctx.currentTime, 0.02);
  }
  function setCompKnee(db) {
    comp.knee.setTargetAtTime(db,       ctx.currentTime, 0.02);
  }
  function setCompMakeup(db) {
    _compMakeupDb = db;
    if (_compEnabled) {
      makeupGain.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, 0.02);
    }
  }
  function setCompEnabled(enabled) {
    _compEnabled = enabled;
    const t = ctx.currentTime;
    if (enabled) {
      try { high.disconnect(makeupGain); } catch {}
      try { high.connect(comp);          } catch {}
      try { comp.connect(makeupGain);    } catch {}
      makeupGain.gain.setTargetAtTime(Math.pow(10, _compMakeupDb / 20), t, 0.02);
    } else {
      try { comp.disconnect(makeupGain); } catch {}
      try { high.disconnect(comp);       } catch {}
      try { high.connect(makeupGain);    } catch {}
      makeupGain.gain.setTargetAtTime(1, t, 0.02); // unity when bypassed
    }
  }

  // Gain reduction: comp.reduction is always ≤ 0 dB
  function getCompReduction()    { return comp.reduction;    }
  function getLimiterReduction() { return limiter.reduction; }

  // -------------------------------------------------------------------------
  // Limiter setters
  // -------------------------------------------------------------------------
  function setLimiterThreshold(db) {
    limiter.threshold.setTargetAtTime(db, ctx.currentTime, 0.02);
  }
  function setLimiterEnabled(enabled) {
    _limiterEnabled = enabled;
    const t = ctx.currentTime;
    if (enabled) {
      // Normal: makeupGain → limiter → outputGain
      try { makeupGain.disconnect(outputGain); } catch {}
      try { makeupGain.connect(limiter);       } catch {}
      try { limiter.connect(outputGain);       } catch {}
    } else {
      // Bypass: makeupGain → outputGain directly
      try { limiter.disconnect(outputGain);    } catch {}
      try { makeupGain.disconnect(limiter);    } catch {}
      try { makeupGain.connect(outputGain);    } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Output / pan / bypass
  // -------------------------------------------------------------------------
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v, ctx.currentTime, 0.02); }

  // Internal bypass-state guard: prevents the duplicate-connect bug where
  // the first setBypass(false) call on a freshly-constructed engine would
  // re-issue the input → hpf connection that construction already made,
  // doubling the signal entering the chain (+6 dB phantom gain).
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { input.disconnect(hpf);        } catch {}
      try { input.connect(outputGain);    } catch {}
    } else {
      try { input.disconnect(outputGain); } catch {}
      try { input.connect(hpf);           } catch {}
    }
  }

  function reconnectAnalysers() {
    output.connect(specAnalyser);
    input.connect(inputAnalyser);
  }

  // -------------------------------------------------------------------------
  // Metering
  // -------------------------------------------------------------------------
  function _rms(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }
  function getInputLevel()  { inputAnalyser.getFloatTimeDomainData(_inBuf);  return _rms(_inBuf);  }
  function getOutputLevel() { specAnalyser.getFloatTimeDomainData(_outBuf);  return _rms(_outBuf); }
  function getInputPeak()  { const l=getInputLevel(),  n=ctx.currentTime; if(l>iPeak||n-iPeakT>2){iPeak=l;iPeakT=n;} return iPeak; }
  function getOutputPeak() { const l=getOutputLevel(), n=ctx.currentTime; if(l>oPeak||n-oPeakT>2){oPeak=l;oPeakT=n;} return oPeak; }

  // True stereo L/R — each channel has its own analyser.
  function getLeftLevel()  { outAnalyserL.getFloatTimeDomainData(_lBuf); return _rms(_lBuf); }
  function getRightLevel() { outAnalyserR.getFloatTimeDomainData(_rBuf); return _rms(_rBuf); }
  function getLeftPeak()   { const l=getLeftLevel(),  n=ctx.currentTime; if(l>lPeak||n-lPeakT>2){lPeak=l;lPeakT=n;} return lPeak; }
  function getRightPeak()  { const l=getRightLevel(), n=ctx.currentTime; if(l>rPeak||n-rPeakT>2){rPeak=l;rPeakT=n;} return rPeak; }

  function destroy() {}

  const filters = { hpf, low, lowMid, highMid, high };

  return {
    ctx,
    input, output, chainOutput,
    specAnalyser, inputAnalyser,
    filters,
    // EQ
    setBandFreq, setBandGain, setBandQ,
    // Comp
    setCompThreshold, setCompRatio, setCompAttack, setCompRelease,
    setCompKnee, setCompMakeup, setCompEnabled,
    getCompReduction, getLimiterReduction,
    // Limiter
    setLimiterThreshold, setLimiterEnabled,
    // Output
    setOutputGain, setPan, setBypass,
    reconnectAnalysers,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
    getLeftLevel,  getRightLevel, getLeftPeak,  getRightPeak,
    destroy,
  };
}
