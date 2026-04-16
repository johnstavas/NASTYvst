// vocalEngine.js — async vocal FX engine
// Phase vocoder runs inside an AudioWorklet (dedicated audio thread).
// Main thread is never blocked by FFT work, so no click artifacts even
// when multiple vocal modules are stacked with other plugins.
//
// Signal chain:
//   inputGainNode ─┬─ dryGain ─────────────────────────────────────┐
//                  └─ pitchNode (AudioWorklet PV) ─ formant EQ     │
//                       ─ ringMod ─ drive ─ wetBus ─────────────── outputGain
//                                                                   │
//                                              outputPanner ← limiter ← ┘
//                                                   │
//                                             output / chainOutput

// Cache module load per AudioContext — only pays the async cost once.
const _pvModuleCache = new WeakMap();
async function _loadPVModule(ctx) {
  if (!_pvModuleCache.has(ctx)) {
    _pvModuleCache.set(ctx, ctx.audioWorklet.addModule('/pvProcessor.js'));
  }
  return _pvModuleCache.get(ctx);
}

export async function createVocalEngine(ctx) {
  // Load AudioWorklet module (no-op if already loaded for this context)
  await _loadPVModule(ctx);

  // === I/O ===
  const input         = ctx.createGain();
  const output        = ctx.createGain();
  const chainOutput   = ctx.createGain();
  const inputGainNode = ctx.createGain();  inputGainNode.gain.value = 1;
  const outputGain    = ctx.createGain();  outputGain.gain.value    = 1;
  const outputPanner  = ctx.createStereoPanner(); outputPanner.pan.value = 0;

  // Limiter — catches additive dry+wet peaks before they hit the output
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -0.3; // safety net only — doesn't touch normal program material
  limiter.knee.value      =  0;
  limiter.ratio.value     = 20;
  limiter.attack.value    = 0.001;
  limiter.release.value   = 0.08;

  input.connect(inputGainNode);
  outputGain.connect(outputPanner);
  // Limiter starts BYPASSED — outputPanner goes direct to output at rest.
  // Routing is toggled in by _engageLimiter() when any effect (pitch, harmony,
  // drive) becomes active, and toggled out when everything returns to neutral.
  // DynamicsCompressor is NEVER truly transparent even at ratio=1, so we keep
  // it out of the path whenever it's not needed for peak catching.
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

  // Dry always plays at UNITY; wet = pitch-shifted voice blending in additively.
  // At rest the worklet smart-bypasses (wet = silence), so dry=1.0 means the
  // module is completely transparent with all effects at their zero positions.
  const dryGain = ctx.createGain(); dryGain.gain.value = 1.0;
  const wetBus  = ctx.createGain(); wetBus.gain.value  = 0;
  inputGainNode.connect(dryGain);
  dryGain.connect(outputGain);
  wetBus.connect(outputGain);

  // =====================================================================
  // PHASE VOCODER — AudioWorkletNode (audio thread, never blocks main)
  // Parameters: pitchRatio, harmonyRatio, harmonyGain (all k-rate)
  // Smart bypass inside the worklet: when pitch=unity AND harmony=off,
  // the worklet outputs silence and the dry path handles audio at ~0 CPU.
  // =====================================================================
  const pitchNode = new AudioWorkletNode(ctx, 'pv-processor', {
    numberOfInputs:    1,
    numberOfOutputs:   1,
    outputChannelCount: [2],
  });
  const pitchParam    = pitchNode.parameters.get('pitchRatio');
  const harmonyParam  = pitchNode.parameters.get('harmonyRatio');
  const harmonyGainP  = pitchNode.parameters.get('harmonyGain');

  inputGainNode.connect(pitchNode);

  // === FORMANT EQ — 3-band tilt, all gains=0 at neutral → transparent ===
  const formantLowShelf  = ctx.createBiquadFilter();
  formantLowShelf.type   = 'lowshelf';  formantLowShelf.frequency.value  = 500;  formantLowShelf.gain.value  = 0;

  const formantMidPeak   = ctx.createBiquadFilter();
  formantMidPeak.type    = 'peaking';   formantMidPeak.frequency.value   = 1500; formantMidPeak.Q.value = 0.8; formantMidPeak.gain.value = 0;

  const formantHighShelf = ctx.createBiquadFilter();
  formantHighShelf.type  = 'highshelf'; formantHighShelf.frequency.value = 3000; formantHighShelf.gain.value = 0;

  pitchNode.connect(formantLowShelf);
  formantLowShelf.connect(formantMidPeak);
  formantMidPeak.connect(formantHighShelf);

  // === RING MODULATOR — AM style, active in Robot mode ===
  const ringCarrier    = ctx.createOscillator(); ringCarrier.type = 'sine'; ringCarrier.frequency.value = 100; ringCarrier.start();
  const ringMod        = ctx.createGain();        ringMod.gain.value        = 1;
  const ringDepthScale = ctx.createGain();        ringDepthScale.gain.value = 0;
  ringCarrier.connect(ringDepthScale);
  ringDepthScale.connect(ringMod.gain);
  formantHighShelf.connect(ringMod);

  // === DRIVE ===
  const drivePreGain  = ctx.createGain();       drivePreGain.gain.value  = 1;
  const driveShaper   = ctx.createWaveShaper(); driveShaper.oversample   = '2x';
  const drivePostGain = ctx.createGain();       drivePostGain.gain.value = 1;
  const N_DRIVE = 512;
  const driveCurve = new Float32Array(N_DRIVE);
  for (let i = 0; i < N_DRIVE; i++) driveCurve[i] = (i * 2) / (N_DRIVE - 1) - 1; // linear
  driveShaper.curve = driveCurve;
  ringMod.connect(drivePreGain);
  drivePreGain.connect(driveShaper);
  driveShaper.connect(drivePostGain);
  drivePostGain.connect(wetBus);

  // === ANALYSERS ===
  const inputAnalyser    = ctx.createAnalyser(); inputAnalyser.fftSize    = 2048; inputAnalyser.smoothingTimeConstant = 0.8;
  const outputAnalyser   = ctx.createAnalyser(); outputAnalyser.fftSize   = 2048; outputAnalyser.smoothingTimeConstant = 0.8;
  const reactiveAnalyser = ctx.createAnalyser(); reactiveAnalyser.fftSize = 512;  reactiveAnalyser.smoothingTimeConstant = 0.6;
  inputGainNode.connect(inputAnalyser);
  output.connect(outputAnalyser);
  output.connect(reactiveAnalyser);

  function reconnectAnalysers() {
    output.connect(outputAnalyser);
    output.connect(reactiveAnalyser);
  }

  // === STATE ===
  let _pitch = 0, _formant = 0, _mode = 'transpose', _drive = 0, _harmony = 0;

  // === LIMITER ROUTING BYPASS ===
  // Track whether any effect is live. When nothing is active, the limiter is
  // OUT of the signal path (outputPanner → output direct). When the user
  // engages pitch, harmony, or drive, the limiter is wired in to catch peaks
  // from the additive wet path. This keeps bypass vs non-bypass indistinguishable
  // at rest while still protecting the output when the effect is pushed.
  let _limiterInPath = false;
  let _bypassed      = false;
  function _updateLimiterRouting() {
    if (_bypassed) return; // setBypass manages routing during bypass
    const needed = (_pitch !== 0) || (_harmony !== 0) || (_drive > 0.001);
    if (needed && !_limiterInPath) {
      try { outputPanner.disconnect(output); } catch {}
      try { outputPanner.connect(limiter);   } catch {}
      try { limiter.connect(output);         } catch {}
      _limiterInPath = true;
    } else if (!needed && _limiterInPath) {
      try { outputPanner.disconnect(limiter);} catch {}
      try { limiter.disconnect(output);      } catch {}
      try { outputPanner.connect(output);    } catch {}
      _limiterInPath = false;
    }
  }

  // === SETTERS ===
  function setPitch(semitones) {
    _pitch = semitones;
    if (_mode === 'robot') {
      ringCarrier.frequency.setTargetAtTime(100 * Math.pow(2, semitones / 12), ctx.currentTime, 0.05);
    } else {
      pitchParam.setTargetAtTime(Math.pow(2, semitones / 12), ctx.currentTime, 0.02);
    }
    _updateLimiterRouting();
  }

  function setFormant(v) {
    _formant = v;
    const t = ctx.currentTime;
    formantLowShelf.gain.setTargetAtTime( -v * 10, t, 0.1);
    formantMidPeak.gain.setTargetAtTime(   v *  6, t, 0.1);
    formantHighShelf.gain.setTargetAtTime( v * 10, t, 0.1);
  }

  function setMode(mode) {
    _mode = mode;
    const t = ctx.currentTime;
    if (mode === 'robot') {
      pitchParam.setTargetAtTime(1.0, t, 0.05);
      ringDepthScale.gain.setTargetAtTime(0.8, t, 0.05);
      ringCarrier.frequency.setTargetAtTime(100 * Math.pow(2, _pitch / 12), t, 0.05);
    } else {
      ringDepthScale.gain.setTargetAtTime(0, t, 0.05);
      pitchParam.setTargetAtTime(Math.pow(2, _pitch / 12), t, 0.02);
    }
  }

  function setDrive(v) {
    _drive = v;
    const t = ctx.currentTime;
    const k = v * 8;
    for (let i = 0; i < N_DRIVE; i++) {
      const x = (i * 2) / (N_DRIVE - 1) - 1;
      driveCurve[i] = k < 0.001 ? x : Math.tanh(k * x) / k;
    }
    driveShaper.curve = driveCurve;
    const pre  = 1 + v * 6;
    const post = 1 / (v * 3 + 1);
    drivePreGain.gain.setTargetAtTime(pre,  t, 0.05);
    drivePostGain.gain.setTargetAtTime(post, t, 0.05);
    _updateLimiterRouting();
  }

  // semitones: 0=off, otherwise interval for the harmony voice (e.g. 7 = fifth)
  function setHarmonyInterval(semitones) {
    const t = ctx.currentTime;
    _harmony = semitones || 0;
    if (!semitones || semitones === 0) {
      harmonyGainP.setTargetAtTime(0, t, 0.05);
    } else {
      harmonyParam.setTargetAtTime(Math.pow(2, semitones / 12), t, 0.02);
      harmonyGainP.setTargetAtTime(1.0, t, 0.05);
    }
    _updateLimiterRouting();
  }

  function setMix(v) {
    // Dry stays at UNITY (1.0) until v > 0.5, then fades out reaching 0 at v=1.
    // Wet scales linearly with v.
    // v=0   → dry=1.0,  wet=0     (100% dry)
    // v=0.5 → dry=1.0,  wet=0.5   (dry + half wet — default: still transparent at rest because wet is silent when worklet smart-bypasses)
    // v=1.0 → dry=0.0,  wet=1.0   (100% wet)
    // This keeps the module bit-transparent at rest for any mix ≤ 0.5, and
    // still lets the user fade to fully wet at the top of the slider.
    const dry = v <= 0.5 ? 1.0 : Math.max(0, 1.0 - (v - 0.5) * 2);
    dryGain.gain.setTargetAtTime(dry, ctx.currentTime, 0.05);
    wetBus.gain.setTargetAtTime(v,    ctx.currentTime, 0.05);
  }

  function setInputGain(v)  { inputGainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,    ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,   ctx.currentTime, 0.02); }

  function setBypass(v) {
    const want = !!v;
    // Early-return guard: prevents the duplicate-connect bug where calling
    // setBypass(false) on a fresh engine (or repeatedly with the same state)
    // would re-issue inputGainNode→pitchNode and inputGainNode→dryGain on
    // top of the connections construction already made — Web Audio sums
    // duplicates and silently doubles the wet signal.
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      // Freeze processing chain — route input straight to outputGain so
      // outputPanner + chainOutput still work, and skip the limiter entirely.
      try { inputGainNode.disconnect(pitchNode); } catch {}
      try { inputGainNode.disconnect(dryGain);   } catch {}
      try { input.connect(outputGain);           } catch {}
      // Ensure outputPanner → output is wired (and limiter is unwired)
      if (_limiterInPath) {
        try { outputPanner.disconnect(limiter);  } catch {}
        try { limiter.disconnect(output);        } catch {}
        try { outputPanner.connect(output);      } catch {}
        _limiterInPath = false;
      }
      // else: outputPanner → output already direct, nothing to do
    } else {
      // Restore processing chain
      try { input.disconnect(outputGain);        } catch {}
      // Re-derive limiter routing from current effect state
      const needed = (_pitch !== 0) || (_harmony !== 0) || (_drive > 0.001);
      if (needed) {
        try { outputPanner.disconnect(output);   } catch {}
        try { outputPanner.connect(limiter);     } catch {}
        try { limiter.connect(output);           } catch {}
        _limiterInPath = true;
      }
      // else: outputPanner → output already direct, leave alone
      try { inputGainNode.connect(pitchNode);    } catch {}
      try { inputGainNode.connect(dryGain);      } catch {}
    }
  }

  // === METERING ===
  // Pre-allocated buffers — never allocate during playback, zero GC pressure.
  const _inBuf  = new Float32Array(inputAnalyser.fftSize);
  const _outBuf = new Float32Array(outputAnalyser.fftSize);
  const _rctBuf = new Float32Array(reactiveAnalyser.fftSize);

  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;

  function _rms(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }
  function getInputLevel()  { inputAnalyser.getFloatTimeDomainData(_inBuf);   return _rms(_inBuf);  }
  function getOutputLevel() { outputAnalyser.getFloatTimeDomainData(_outBuf); return _rms(_outBuf); }
  function getInputPeak()  { const l = getInputLevel(),  n = ctx.currentTime; if (l > iPeak || n - iPeakT > 2) { iPeak = l; iPeakT = n; } return iPeak; }
  function getOutputPeak() { const l = getOutputLevel(), n = ctx.currentTime; if (l > oPeak || n - oPeakT > 2) { oPeak = l; oPeakT = n; } return oPeak; }
  function getReactiveData() {
    reactiveAnalyser.getFloatTimeDomainData(_rctBuf);
    let rms = 0, peak = 0;
    for (let i = 0; i < _rctBuf.length; i++) {
      const x = _rctBuf[i];
      rms += x * x;
      if (x > peak) peak = x; else if (-x > peak) peak = -x;
    }
    return { rms: Math.sqrt(rms / _rctBuf.length), peak, transient: Math.abs(_rctBuf[0] - _rctBuf[_rctBuf.length - 1]) };
  }

  function destroy() {
    try { ringCarrier.stop(); } catch {}
    try { pitchNode.disconnect(); } catch {}
  }

  // Apply defaults
  setMix(0.5);
  setPitch(0);
  setFormant(0);
  setMode('transpose');

  return {
    ctx, input, output, chainOutput, reconnectAnalysers,
    setPitch, setFormant, setMode, setDrive,
    setMix, setInputGain, setOutputGain, setPan, setBypass, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak, getReactiveData,
    setHarmonyInterval,
  };
}
