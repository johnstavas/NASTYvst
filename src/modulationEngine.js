// modulationEngine.js — 8-zone waveform modulation module
// Angle selects waveform zone: Sine=270°, Tri=315°, Saw↑=0°, Saw↓=45°,
//   Sqr=90°, Pulse=135°, S&H=180°, ~Rnd=225°
// Distance = modulation depth intensity
// Mode A=Tremolo, B=Filter sweep, C=Vibrato

export function createModulationEngine(ctx) {
  // === I/O ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();
  const outputGain   = ctx.createGain();         outputGain.gain.value  = 1.0;  // unity — no hidden makeup boost
  const outputPanner = ctx.createStereoPanner();  outputPanner.pan.value = 0;
  const inputGainNode = ctx.createGain();         inputGainNode.gain.value = 1;
  input.connect(inputGainNode);

  // Pan + ping-pong sit on the WET bus only — dry signal always passes through centre.
  const wetPanner      = ctx.createStereoPanner(); wetPanner.pan.value      = 0;
  const pingPongPanner = ctx.createStereoPanner(); pingPongPanner.pan.value = 0;
  const lfoToPingPong  = ctx.createGain();          lfoToPingPong.gain.value = 0;
  // NOTE: lfoToPingPong is NOT connected to pingPongPanner.pan at init.
  // It only gets connected when ping-pong depth > 0, and disconnected when = 0.
  // This prevents the audio-rate oscillator from leaving a residual on the AudioParam.
  let _ppActive = false;

  // outputPanner sits between outputGain and output so Mod's pan is independent.
  // chainOutput is tapped BEFORE the panner so series routing never bakes pan in.
  outputGain.connect(outputPanner);
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

  // === 8 ZONE ANGLES (codebase convention: 0=top, clockwise) ===
  const ZONE_ANGLES = [270, 315, 0, 45, 90, 135, 180, 225];
  // Per-zone harmonic multiplier: cutoff = N × currentHz
  // Sine=transparent (1000×), Tri=15 harmonics, Saw=4, Sqr=2, Pulse=1.5, S&H=2, Rnd=8
  // Keeping it Hz-relative means slow LFOs get a tight enough filter regardless of BPM
  const ZONE_N = [1000, 15, 4, 4, 2, 1.5, 2, 8];
  let _lastWeights = new Array(8).fill(0); _lastWeights[0] = 1; // default sine

  // === 8 LFO WAVEFORM OSCILLATORS ===
  let currentHz = 2;

  // Phase tracking
  let phaseStartTime = 0;
  let phaseAtReset   = 0;

  let lfoSine = ctx.createOscillator();
  lfoSine.type = 'sine'; lfoSine.frequency.value = currentHz; lfoSine.start();

  let lfoTri = ctx.createOscillator();
  lfoTri.type = 'triangle'; lfoTri.frequency.value = currentHz; lfoTri.start();

  let lfoSawUp = ctx.createOscillator();
  lfoSawUp.type = 'sawtooth'; lfoSawUp.frequency.value = currentHz; lfoSawUp.start();

  let lfoSawDownOsc = ctx.createOscillator();
  lfoSawDownOsc.type = 'sawtooth'; lfoSawDownOsc.frequency.value = currentHz; lfoSawDownOsc.start();
  const lfoSawDownInvert = ctx.createGain(); lfoSawDownInvert.gain.value = -1;
  lfoSawDownOsc.connect(lfoSawDownInvert);

  let lfoSquare = ctx.createOscillator();
  lfoSquare.type = 'square'; lfoSquare.frequency.value = currentHz; lfoSquare.start();

  let lfoPulseOsc = ctx.createOscillator();
  lfoPulseOsc.type = 'sawtooth'; lfoPulseOsc.frequency.value = currentHz; lfoPulseOsc.start();
  const lfoPulseShaper = ctx.createWaveShaper();
  const pulseN = 256; const pulseCurve = new Float32Array(pulseN);
  for (let i = 0; i < pulseN; i++) { const x = (i * 2) / (pulseN - 1) - 1; pulseCurve[i] = x > 0.5 ? 1 : -1; }
  lfoPulseShaper.curve = pulseCurve;
  lfoPulseOsc.connect(lfoPulseShaper);

  const lfoSH = ctx.createConstantSource();
  lfoSH.offset.value = 0; lfoSH.start();
  let shInterval = null;

  const smoothRandBufLen = ctx.sampleRate * 2;
  const smoothRandBuf = ctx.createBuffer(1, smoothRandBufLen, ctx.sampleRate);
  const smoothRandData = smoothRandBuf.getChannelData(0);
  for (let i = 0; i < smoothRandBufLen; i++) smoothRandData[i] = Math.random() * 2 - 1;
  const smoothRandSrc = ctx.createBufferSource();
  smoothRandSrc.buffer = smoothRandBuf; smoothRandSrc.loop = true; smoothRandSrc.start();
  const smoothRandLP = ctx.createBiquadFilter();
  smoothRandLP.type = 'lowpass'; smoothRandLP.frequency.value = currentHz * 2; smoothRandLP.Q.value = 0.5;
  const smoothRandBoost = ctx.createGain(); smoothRandBoost.gain.value = 8;
  smoothRandSrc.connect(smoothRandLP); smoothRandLP.connect(smoothRandBoost);

  // === ZONE BLEND GAINS → lfoMix ===
  const lfoMix = ctx.createGain(); lfoMix.gain.value = 1;
  const zoneGains = new Array(8).fill(null).map(() => { const g = ctx.createGain(); g.gain.value = 0; g.connect(lfoMix); return g; });

  lfoSine.connect(zoneGains[0]);
  lfoTri.connect(zoneGains[1]);
  lfoSawUp.connect(zoneGains[2]);
  lfoSawDownInvert.connect(zoneGains[3]);
  lfoSquare.connect(zoneGains[4]);
  lfoPulseShaper.connect(zoneGains[5]);
  lfoSH.connect(zoneGains[6]);
  smoothRandBoost.connect(zoneGains[7]);

  // === LFO SMOOTHER — lowpass slew after lfoMix to tame sharp waveforms ===
  const lfoSmoother = ctx.createBiquadFilter();
  lfoSmoother.type = 'lowpass'; lfoSmoother.Q.value = 0.5;
  lfoSmoother.frequency.value = 10000;
  lfoMix.connect(lfoSmoother);

  // === EFFECT PATHS ===
  let currentDepth = 0.5;

  // Ping-pong uses its own dedicated sine oscillator so it always sweeps smoothly
  // L→R regardless of which waveform zone the effects are using.
  // It tracks currentHz exactly so it stays locked to the BPM/division.
  let pingPongOsc = ctx.createOscillator();
  pingPongOsc.type = 'sine'; pingPongOsc.frequency.value = currentHz; pingPongOsc.start();
  pingPongOsc.connect(lfoToPingPong);
  // lfoToPingPong → pingPongPanner.pan is connected lazily in setPingPong()

  // Tremolo — baseline holds unity and LFO scales around that baseline.
  // With currentDepth=0 at init, baseline=1 and LFO contribution=0, so the
  // tremolo path is bit-identical to a straight wire when the user hasn't
  // engaged depth yet.
  const tremoloGain     = ctx.createGain();  tremoloGain.gain.value     = 1 - currentDepth * 0.5;
  const tremoloLFOScale = ctx.createGain();  tremoloLFOScale.gain.value = currentDepth * 0.5;
  lfoSmoother.connect(tremoloLFOScale);
  tremoloLFOScale.connect(tremoloGain.gain);

  // Filter sweep
  // Base freq = 1000 Hz (fixed). LFO swing = ±(depth*900).
  // Min reachable freq = 1000 - 900 = 100 Hz — never goes to 0 → no biquad instability.
  // Q kept low (0.9) to avoid resonant ringing as frequency sweeps.
  // filterSmoother adds a 2nd slew stage (same as vibratoSmoother) so even sharp LFO
  // waveforms arrive at the frequency AudioParam as smooth curves.
  const sweepFilter  = ctx.createBiquadFilter();
  sweepFilter.type = 'lowpass'; sweepFilter.frequency.value = 0; sweepFilter.Q.value = 0.9;
  const sweepBaseHz  = ctx.createConstantSource(); sweepBaseHz.offset.value = 1000; sweepBaseHz.start();
  sweepBaseHz.connect(sweepFilter.frequency);

  const filterSmoother = ctx.createBiquadFilter();
  filterSmoother.type = 'lowpass'; filterSmoother.Q.value = 0.5;
  filterSmoother.frequency.value = currentHz * 3;
  lfoSmoother.connect(filterSmoother);

  const lfoToFilter  = ctx.createGain(); lfoToFilter.gain.value = currentDepth * 900;
  filterSmoother.connect(lfoToFilter);
  lfoToFilter.connect(sweepFilter.frequency);

  // Vibrato — LFO modulates a short delay time
  // vibratoSmoother is a second, tighter lowpass chained after lfoSmoother.
  // It caps the vibrato signal at ~4x LFO rate so sharp waveform resets
  // (sawtooth, square, pulse) can't create sudden delay-time jumps → no pitch clicks.
  const vibratoSmoother = ctx.createBiquadFilter();
  vibratoSmoother.type = 'lowpass'; vibratoSmoother.Q.value = 0.5;
  vibratoSmoother.frequency.value = currentHz * 4;
  lfoSmoother.connect(vibratoSmoother);

  const vibratoDelay  = ctx.createDelay(0.02);
  vibratoDelay.delayTime.value = 0.005;
  const lfoToVibrato  = ctx.createGain(); lfoToVibrato.gain.value = currentDepth * 0.004;
  vibratoSmoother.connect(lfoToVibrato);
  lfoToVibrato.connect(vibratoDelay.delayTime);

  // === 3 PARALLEL AUDIO PATHS + DRY ===
  const tremoloOut = ctx.createGain(); tremoloOut.gain.value = 1;
  const sweepOut   = ctx.createGain(); sweepOut.gain.value   = 0;
  const vibratoOut = ctx.createGain(); vibratoOut.gain.value = 0;
  // Dry/wet start at mix=0 → pure dry passthrough (transparent at rest).
  // User must dial the Mix knob up to engage the modulation.
  const dryGain    = ctx.createGain(); dryGain.gain.value    = 1;
  const wetBus     = ctx.createGain(); wetBus.gain.value     = 0;
  // Passthrough: when ALL effects are off, wet bus would be silent.
  // Bypasses wetPanner so pan ONLY affects actual effect signal, not the dry fallback.
  const wetPassthrough = ctx.createGain(); wetPassthrough.gain.value = 0;
  inputGainNode.connect(wetPassthrough);

  inputGainNode.connect(tremoloGain);
  tremoloGain.connect(tremoloOut);
  tremoloOut.connect(wetBus);

  inputGainNode.connect(sweepFilter);
  sweepFilter.connect(sweepOut);
  sweepOut.connect(wetBus);

  inputGainNode.connect(vibratoDelay);
  vibratoDelay.connect(vibratoOut);
  vibratoOut.connect(wetBus);

  inputGainNode.connect(dryGain);
  dryGain.connect(outputGain);
  wetPassthrough.connect(outputGain);       // passthrough → center (no pan)
  // Only actual effect signal goes through pan + ping-pong
  wetBus.connect(wetPanner);
  wetPanner.connect(pingPongPanner);
  pingPongPanner.connect(outputGain);

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

  // === 8-ZONE ANGLE BLEND ===
  function calcZoneWeights(angleDeg) {
    const w = ZONE_ANGLES.map(a => {
      let d = Math.abs(angleDeg - a) % 360;
      if (d > 180) d = 360 - d;
      return Math.max(0, Math.cos((Math.min(d, 45) / 45) * (Math.PI / 2)));
    });
    const sum = w.reduce((a, b) => a + b, 0);
    return sum > 0 ? w.map(v => v / sum) : w;
  }

  // === S&H INTERVAL ===
  function startSH(hz) {
    if (shInterval) clearInterval(shInterval);
    const ms = Math.max(50, 1000 / hz);
    shInterval = setInterval(() => {
      lfoSH.offset.setTargetAtTime(Math.random() * 2 - 1, ctx.currentTime, 0.005);
    }, ms);
  }

  // === SMOOTHER CUTOFF — Hz-relative so it works at any BPM/division ===
  function updateSmootherFromWeights(weights) {
    _lastWeights = weights;
    let N = 0;
    weights.forEach((w, i) => { N += w * ZONE_N[i]; });
    // cutoff = N × Hz, clamped 5Hz–10kHz
    const cutoff = Math.min(Math.max(N * currentHz, 5), 10000);
    lfoSmoother.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.08);
  }

  // === SETTERS ===
  // Independent per-effect on/off
  const _effectActive = { tremolo: true, filter: false, vibrato: false };

  function setEffectActive(effect, active) {
    _effectActive[effect] = active;
    const t = ctx.currentTime, tc = 0.08;
    const anyOn = _effectActive.tremolo || _effectActive.filter || _effectActive.vibrato;
    // Normalize per-effect gain so total wet always sums to 1 regardless of how many are on
    const count = [_effectActive.tremolo, _effectActive.filter, _effectActive.vibrato].filter(Boolean).length;
    const perGain = count > 0 ? 1 / count : 0;
    tremoloOut.gain.setTargetAtTime(_effectActive.tremolo ? perGain : 0, t, tc);
    sweepOut.gain.setTargetAtTime(  _effectActive.filter  ? perGain : 0, t, tc);
    vibratoOut.gain.setTargetAtTime(_effectActive.vibrato ? perGain : 0, t, tc);
    wetPassthrough.gain.setTargetAtTime(anyOn ? 0 : 1, t, tc);
  }

  function setPosition(angleDeg, dist) {
    const t = ctx.currentTime;
    const weights = calcZoneWeights(angleDeg);
    weights.forEach((w, i) => zoneGains[i].gain.setTargetAtTime(w, t, 0.06));
    updateSmootherFromWeights(weights);
  }

  function _applyHz(hz) {
    currentHz = Math.max(0.05, hz);
    const t = ctx.currentTime;
    lfoSine.frequency.setTargetAtTime(currentHz, t, 0.05);
    lfoTri.frequency.setTargetAtTime(currentHz, t, 0.05);
    lfoSawUp.frequency.setTargetAtTime(currentHz, t, 0.05);
    lfoSawDownOsc.frequency.setTargetAtTime(currentHz, t, 0.05);
    lfoSquare.frequency.setTargetAtTime(currentHz, t, 0.05);
    lfoPulseOsc.frequency.setTargetAtTime(currentHz, t, 0.05);
    smoothRandLP.frequency.setTargetAtTime(currentHz * 2, t, 0.05);
    pingPongOsc.frequency.setTargetAtTime(currentHz, t, 0.05);
    // Secondary smoothers: tight Hz-relative cutoffs for filter + vibrato paths
    filterSmoother.frequency.setTargetAtTime(Math.max(currentHz * 3, 5), t, 0.05);
    vibratoSmoother.frequency.setTargetAtTime(Math.max(currentHz * 2, 4), t, 0.05);
    startSH(currentHz);
    // Re-apply smoother cutoff now that Hz changed
    updateSmootherFromWeights(_lastWeights);
  }

  function setRate(bpm, divisionBeats) {
    const hz = (bpm / 60) / divisionBeats;
    _applyHz(hz);
  }

  function setDepth(v) {
    currentDepth = v;
    const t = ctx.currentTime;
    tremoloGain.gain.setTargetAtTime(1 - v * 0.5, t, 0.05);
    tremoloLFOScale.gain.setTargetAtTime(v * 0.5, t, 0.05);
    lfoToFilter.gain.setTargetAtTime(v * 900, t, 0.05);
    lfoToVibrato.gain.setTargetAtTime(v * 0.004, t, 0.05);
  }

  function setMix(v) {
    const t = ctx.currentTime;
    dryGain.gain.setTargetAtTime(1 - v, t, 0.05);
    wetBus.gain.setTargetAtTime(v, t, 0.05);
  }

  function setInputGain(v)  { inputGainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,   ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,  ctx.currentTime, 0.02); }
  // Ping-pong depth 0=off, 1=full L-R swing at LFO rate
  function setPingPong(v) {
    if (v > 0.005) {
      // Connect oscillator to pan AudioParam only when actually in use
      if (!_ppActive) {
        lfoToPingPong.connect(pingPongPanner.pan);
        _ppActive = true;
      }
      lfoToPingPong.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    } else {
      // Disconnect audio-rate source first so it can't keep driving the pan
      if (_ppActive) {
        try { lfoToPingPong.disconnect(pingPongPanner.pan); } catch {}
        _ppActive = false;
      }
      lfoToPingPong.gain.cancelScheduledValues(ctx.currentTime);
      lfoToPingPong.gain.value = 0;
      // Hard-reset pan to centre
      pingPongPanner.pan.cancelScheduledValues(ctx.currentTime);
      pingPongPanner.pan.setValueAtTime(0, ctx.currentTime);
    }
  }

  // Bypass-state guard: prevents the duplicate-connect bug — without this,
  // the first setBypass(false) call after construction would re-issue every
  // inputGainNode connection that construction already made, summing the
  // input signal multiple times into the wet path.
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      // Tear down every path that hangs off inputGainNode → outputGain.
      // Must include wetPassthrough, which can be 1 when all effects are
      // toggled off (fallback dry wire for the wet side). Otherwise the
      // bypass wire stacks on top and doubles the signal.
      try { inputGainNode.disconnect(tremoloGain);   } catch {}
      try { inputGainNode.disconnect(sweepFilter);    } catch {}
      try { inputGainNode.disconnect(vibratoDelay);   } catch {}
      try { inputGainNode.disconnect(dryGain);        } catch {}
      try { inputGainNode.disconnect(wetPassthrough); } catch {}
      try { input.connect(outputGain); } catch {}
    } else {
      try { input.disconnect(outputGain); } catch {}
      try { inputGainNode.connect(tremoloGain);   } catch {}
      try { inputGainNode.connect(sweepFilter);    } catch {}
      try { inputGainNode.connect(vibratoDelay);   } catch {}
      try { inputGainNode.connect(dryGain);        } catch {}
      try { inputGainNode.connect(wetPassthrough); } catch {}
    }
  }

  function getLfoPhase() {
    return (phaseAtReset + (ctx.currentTime - phaseStartTime) * currentHz) % 1;
  }

  function resetPhase(targetPhase = 0) {
    const target = ((targetPhase % 1) + 1) % 1;
    const when   = ctx.currentTime - target / Math.max(currentHz, 0.01);

    lfoMix.gain.cancelScheduledValues(ctx.currentTime);
    lfoMix.gain.setTargetAtTime(0, ctx.currentTime, 0.003);
    lfoMix.gain.setTargetAtTime(1, ctx.currentTime + 0.015, 0.003);

    [lfoSine, lfoTri, lfoSawUp, lfoSawDownOsc, lfoSquare, lfoPulseOsc].forEach(o => {
      try { o.stop(); } catch {} try { o.disconnect(); } catch {}
    });

    const mk = (type, dest) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = currentHz;
      o.connect(dest); o.start(when);
      return o;
    };
    lfoSine       = mk('sine',     zoneGains[0]);
    lfoTri        = mk('triangle', zoneGains[1]);
    lfoSawUp      = mk('sawtooth', zoneGains[2]);
    lfoSawDownOsc = mk('sawtooth', lfoSawDownInvert);
    lfoSquare     = mk('square',   zoneGains[4]);
    lfoPulseOsc   = mk('sawtooth', lfoPulseShaper);

    phaseStartTime = ctx.currentTime;
    phaseAtReset   = target;
  }

  // === METERING ===
  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;
  const getRMS = an => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length); };
  function getInputLevel()  { return getRMS(inputAnalyser); }
  function getOutputLevel() { return getRMS(outputAnalyser); }
  function getInputPeak()  { const l = getInputLevel(),  n = ctx.currentTime; if (l > iPeak || n - iPeakT > 2) { iPeak = l; iPeakT = n; } return iPeak; }
  function getOutputPeak() { const l = getOutputLevel(), n = ctx.currentTime; if (l > oPeak || n - oPeakT > 2) { oPeak = l; oPeakT = n; } return oPeak; }
  function getReactiveData() {
    const d = new Float32Array(reactiveAnalyser.fftSize); reactiveAnalyser.getFloatTimeDomainData(d);
    let rms = 0, peak = 0; for (const x of d) { rms += x * x; if (Math.abs(x) > peak) peak = Math.abs(x); }
    return { rms: Math.sqrt(rms / d.length), peak, transient: Math.abs(d[0] - d[d.length - 1]) };
  }

  function destroy() {
    if (shInterval) clearInterval(shInterval);
    try { lfoSine.stop(); } catch {}
    try { lfoTri.stop(); } catch {}
    try { lfoSawUp.stop(); } catch {}
    try { lfoSawDownOsc.stop(); } catch {}
    try { lfoSquare.stop(); } catch {}
    try { lfoPulseOsc.stop(); } catch {}
    try { lfoSH.stop(); } catch {}
    try { smoothRandSrc.stop(); } catch {}
    try { sweepBaseHz.stop(); } catch {}
    try { pingPongOsc.stop(); } catch {}
  }

  // === INIT ===
  // Module starts fully transparent: mix=0, depth=0 → dry path only.
  // Tremolo path is enabled (default effect) so that as soon as the user
  // dials Mix up, there's something to hear.
  setMix(0);
  setDepth(0);
  setRate(120, 1);
  setEffectActive('tremolo', true);
  setPosition(270, 0);

  return {
    ctx, input, output, chainOutput, reconnectAnalysers,
    setPosition, setEffectActive, setRate, setDepth, setMix,
    setInputGain, setOutputGain, setPan, setPingPong, setBypass,
    getLfoPhase, resetPhase,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak, getReactiveData,
    destroy,
  };
}
