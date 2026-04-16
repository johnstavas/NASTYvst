// springReverbEngine.js — Wabble Spring (synchronous Web Audio)
//
// Signal chain:
//   input → inputGain ─┬─ dryGain ────────────────────────────────────────┐
//                      └─ drivePreGain → driveShaper → drivePostGain       │
//                          → convolver (spring IR)                         │
//                          → wetPad                                        │
//                          → allpass dispersion chain (4 stages)           │
//                          → combDelay (with feedback)                     │
//                          → toneShelf → wetGain → outputGain              │
//                                                     → outputPanner → output / chainOutput
//
// Dispersion chain + comb feedback = the "drip/bwoing" sound. Allpass Q
// scales with the WOBBLE knob — higher Q = more pronounced chirp.
// A slow LFO nudges the mid allpass frequency for organic warble character.

// Build the spring impulse response for a given decay time.
function _buildSpringIR(ctx, decayTime) {
  const sr  = ctx.sampleRate;
  const len = Math.floor(sr * Math.max(0.6, Math.min(4.0, decayTime)));
  const buf = ctx.createBuffer(2, len, sr);

  // Modal resonances of a typical Accutronics 3-spring tank.
  const modes = [
    { freq:  285, amp: 0.55, tau: 4.2 },
    { freq:  620, amp: 0.45, tau: 3.6 },
    { freq: 1080, amp: 0.38, tau: 3.0 },
    { freq: 1750, amp: 0.28, tau: 2.5 },
    { freq: 2700, amp: 0.18, tau: 2.0 },
    { freq: 4100, amp: 0.10, tau: 1.5 },
  ];
  const decayRate = 6 / decayTime;

  for (let ch = 0; ch < 2; ch++) {
    const d      = buf.getChannelData(ch);
    const offset = ch === 1 ? Math.floor(sr * 0.011) : 0;  // 11 ms L/R spread

    for (let i = offset; i < len; i++) {
      const t   = (i - offset) / sr;
      const env = Math.exp(-t * decayRate);

      // Diffuse noise floor
      const noise = (Math.random() * 2 - 1) * env * 0.28;

      // Modal components — give the metallic ring
      let modal = 0;
      for (const m of modes) {
        modal += Math.sin(2 * Math.PI * m.freq * t)
               * m.amp
               * Math.exp(-t * (decayRate * (6 / m.tau)))
               * 0.12;
      }

      // Dispersion chirp at attack — the "bwoing" transient
      const chirp = t < 0.08
        ? Math.sin(2 * Math.PI * (1200 - t * 9000) * t)
          * Math.exp(-t * 55)
          * 1.8
        : 0;

      d[i] = noise + modal + chirp;
    }
  }

  // Normalise so the loudest sample is at 0.9
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  if (peak > 0.001) {
    const scale = 0.9 / peak;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] *= scale;
    }
  }

  return buf;
}

export function createSpringReverbEngine(ctx) {

  // === I/O ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();
  const outputGain   = ctx.createGain();        outputGain.gain.value  = 1;
  const outputPanner = ctx.createStereoPanner(); outputPanner.pan.value = 0;
  const inputGain    = ctx.createGain();         inputGain.gain.value   = 1;

  input.connect(inputGain);
  outputGain.connect(outputPanner);
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

  // === Dry path ===
  const dryGain = ctx.createGain(); dryGain.gain.value = 1.0;
  const wetGain = ctx.createGain(); wetGain.gain.value = 0.0;
  inputGain.connect(dryGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);

  // === Pre-drive — optional mild saturation before the spring ===
  const drivePreGain  = ctx.createGain();       drivePreGain.gain.value  = 1;
  const driveShaper   = ctx.createWaveShaper(); driveShaper.oversample   = '2x';
  const drivePostGain = ctx.createGain();       drivePostGain.gain.value = 1;
  const N = 256;
  const driveCurve = new Float32Array(N);
  for (let i = 0; i < N; i++) driveCurve[i] = (i * 2) / (N - 1) - 1;
  driveShaper.curve = driveCurve;
  inputGain.connect(drivePreGain);
  drivePreGain.connect(driveShaper);
  driveShaper.connect(drivePostGain);

  // === Convolver — holds the spring IR ===
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  drivePostGain.connect(convolver);

  // === Post-convolver level pad ===
  const wetPad = ctx.createGain(); wetPad.gain.value = 0.20;
  convolver.connect(wetPad);

  // === Spring Dispersion — allpass chain creates the "drip" chirp ===
  const DISP_FREQS = [180, 480, 1200, 3200];
  const dispChain = DISP_FREQS.map(f => {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass'; ap.frequency.value = f; ap.Q.value = 1.5;
    return ap;
  });
  wetPad.connect(dispChain[0]);
  for (let i = 0; i < dispChain.length - 1; i++) dispChain[i].connect(dispChain[i + 1]);

  // Comb feedback — resonant "boing" ring
  const combDelay = ctx.createDelay(0.05); combDelay.delayTime.value = 0.0018;
  const combFB    = ctx.createGain();      combFB.gain.value = 0;
  dispChain[dispChain.length - 1].connect(combDelay);
  combDelay.connect(combFB);
  combFB.connect(combDelay);  // feedback loop

  // Subtle slow LFO for warble character
  const dripLFO = ctx.createOscillator(); dripLFO.type = 'sine'; dripLFO.frequency.value = 1.2;
  const dripMod = ctx.createGain();        dripMod.gain.value = 0;
  dripLFO.connect(dripMod);
  dripMod.connect(dispChain[1].frequency);
  dripLFO.start();

  // Tone — high shelf, dark to bright
  const toneShelf = ctx.createBiquadFilter();
  toneShelf.type            = 'highshelf';
  toneShelf.frequency.value = 3500;
  toneShelf.gain.value      = 0;
  combDelay.connect(toneShelf);
  toneShelf.connect(wetGain);

  // === Analysers ===
  const inputAnalyser  = ctx.createAnalyser(); inputAnalyser.fftSize  = 2048; inputAnalyser.smoothingTimeConstant = 0.8;
  const outputAnalyser = ctx.createAnalyser(); outputAnalyser.fftSize = 2048; outputAnalyser.smoothingTimeConstant = 0.8;
  inputGain.connect(inputAnalyser);
  output.connect(outputAnalyser);

  // === Initial IR ===
  let _decayTime = 1.8;
  convolver.buffer = _buildSpringIR(ctx, _decayTime);

  // Debounce IR rebuild so dragging the decay knob doesn't hammer the CPU
  let _decayTimer = null;
  function _scheduleIRRebuild(t) {
    if (_decayTimer) clearTimeout(_decayTimer);
    _decayTimer = setTimeout(() => {
      convolver.buffer = _buildSpringIR(ctx, t);
      _decayTimer = null;
    }, 180);
  }

  // === State ===
  let _mix    = 0.3;
  let _drive  = 0;

  // === Setters ===
  function setMix(v) {
    _mix = Math.max(0, Math.min(1, v));
    const t = ctx.currentTime;
    const dry = _mix <= 0.6 ? 1.0 : Math.max(0, 1.0 - (_mix - 0.6) * 2.5);
    const wet = _mix * _mix * 0.55;
    dryGain.gain.setTargetAtTime(dry, t, 0.04);
    wetGain.gain.setTargetAtTime(wet, t, 0.04);
  }

  function setDecay(v) {
    _decayTime = 0.6 + v * 3.4;
    _scheduleIRRebuild(_decayTime);
  }

  function setTone(v) {
    const gain = (v - 0.5) * 22;
    toneShelf.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
  }

  function setWobble(v) {
    const t = ctx.currentTime;
    // Allpass Q scales with wobble — more Q = more pronounced drip chirp
    const q = 1.5 + v * v * 7.5;
    dispChain.forEach(ap => ap.Q.setTargetAtTime(q, t, 0.18));
    // Comb feedback grows with wobble for metallic ring
    combFB.gain.setTargetAtTime(v * 0.75, t, 0.15);
    // LFO depth and rate
    dripMod.gain.setTargetAtTime(v * 120, t, 0.15);
    dripLFO.frequency.setTargetAtTime(0.6 + v * 1.8, t, 0.15);
  }

  function setDrive(v) {
    _drive = Math.max(0, Math.min(1, v));
    const t = ctx.currentTime;
    const k = _drive * 6;
    for (let i = 0; i < N; i++) {
      const x = (i * 2) / (N - 1) - 1;
      driveCurve[i] = k < 0.001 ? x : Math.tanh(k * x) / Math.max(0.01, Math.tanh(k));
    }
    driveShaper.curve = driveCurve;
    drivePreGain.gain.setTargetAtTime(1 + _drive * 3, t, 0.05);
    drivePostGain.gain.setTargetAtTime(1 / (1 + _drive * 1.2), t, 0.05);
  }

  function setInputGain(v)  { inputGain.gain.setTargetAtTime(v,        ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,       ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,      ctx.currentTime, 0.02); }

  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { inputGain.disconnect(drivePreGain); } catch {}
      try { inputGain.disconnect(dryGain);      } catch {}
      try { input.connect(outputGain);          } catch {}
    } else {
      try { input.disconnect(outputGain);       } catch {}
      try { inputGain.connect(drivePreGain);    } catch {}
      try { inputGain.connect(dryGain);         } catch {}
    }
  }

  // === Metering ===
  const _inBuf  = new Float32Array(inputAnalyser.fftSize);
  const _outBuf = new Float32Array(outputAnalyser.fftSize);
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

  function destroy() {
    if (_decayTimer) clearTimeout(_decayTimer);
    try { dripLFO.stop(); } catch {}
    try { convolver.disconnect(); } catch {}
  }

  // Apply defaults
  setMix(0.3);
  setDecay(0.38);
  setTone(0.5);
  setWobble(0.35);

  return {
    ctx, input, output, chainOutput,
    setMix, setDecay, setTone, setWobble, setDrive,
    setInputGain, setOutputGain, setPan, setBypass, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
  };
}
