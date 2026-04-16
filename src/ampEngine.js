// ampEngine.js — Guitar amp simulator module
// Signal flow:
//   input → inputGain → preHP → preampDrive → [preamp shaper] → tonestack → sag → cabSim → outputGain → out

export function createAmpEngine(ctx) {

  // === I/O ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();
  const outputGain   = ctx.createGain();        outputGain.gain.value  = 1;
  const outputPanner = ctx.createStereoPanner(); outputPanner.pan.value = 0;
  const inputGainNode = ctx.createGain();        inputGainNode.gain.value = 1;
  input.connect(inputGainNode);

  // === PREAMP ===
  // High-pass: cut mud/rumble before gain stage
  const preHP = ctx.createBiquadFilter();
  preHP.type = 'highpass'; preHP.frequency.value = 80; preHP.Q.value = 0.7;

  // Presence boost before clipping (makes highs cut through distortion)
  const prePresence = ctx.createBiquadFilter();
  prePresence.type = 'highshelf'; prePresence.frequency.value = 4500; prePresence.gain.value = 3;

  // Pre-gain: controls how hard signal hits the preamp shaper (orb Y axis)
  const preampDrive = ctx.createGain(); preampDrive.gain.value = 0.001;

  // Preamp waveshaper — fixed soft-clip curve (tanh character)
  const preampShaper = ctx.createWaveShaper(); preampShaper.oversample = '4x';
  const N = 512;
  const preampCurve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i * 2) / (N - 1) - 1;
    // Asymmetric tube-style: positive clips softer, negative harder (classic preamp feel)
    preampCurve[i] = x >= 0
      ? Math.tanh(x * 5) / Math.tanh(5)
      : Math.tanh(x * 6.5) / Math.tanh(6.5);
  }
  preampShaper.curve = preampCurve;

  // Post-shaper level restore (shaper attenuates)
  const preampPostGain = ctx.createGain(); preampPostGain.gain.value = 1.5;

  // μ-law waveshaper — variable companding (0 = off/linear, 1 = heavy bloom)
  const muShaper = ctx.createWaveShaper(); muShaper.oversample = '4x';
  const muGain   = ctx.createGain(); muGain.gain.value = 1; // makeup after mu shaper
  let currentMu = 0;
  function buildMuCurve(mu) {
    const curve = new Float32Array(512);
    const muVal = mu * 200; // 0–200 range feels musical
    for (let i = 0; i < 512; i++) {
      const x = (i * 2) / 511 - 1;
      if (muVal < 0.01) { curve[i] = x; }
      else { curve[i] = Math.sign(x) * Math.log(1 + muVal * Math.abs(x)) / Math.log(1 + muVal); }
    }
    muShaper.curve = curve;
  }
  buildMuCurve(0);

  // Buzz — parallel high-frequency harmonic path (highpass → saturation → blend)
  const buzzHP    = ctx.createBiquadFilter(); buzzHP.type = 'highpass'; buzzHP.frequency.value = 2000; buzzHP.Q.value = 0.7;
  const buzzDrive = ctx.createGain(); buzzDrive.gain.value = 0;
  const buzzShaper = ctx.createWaveShaper(); buzzShaper.oversample = '2x';
  const buzzCurve = new Float32Array(512);
  for (let i = 0; i < 512; i++) { const x = (i*2)/511-1; buzzCurve[i] = Math.tanh(x * 8) / Math.tanh(8); }
  buzzShaper.curve = buzzCurve;
  const buzzLevel = ctx.createGain(); buzzLevel.gain.value = 0; // blend into wet

  inputGainNode.connect(preHP);
  preHP.connect(prePresence);
  prePresence.connect(preampDrive);
  preampDrive.connect(preampShaper);
  preampShaper.connect(preampPostGain);
  preampPostGain.connect(muShaper);
  muShaper.connect(muGain);

  // === TONESTACK — Bass / Mid / Treble ===
  // Classic passive-style: boost/cut ±12dB
  const tsBass   = ctx.createBiquadFilter(); tsBass.type   = 'lowshelf';  tsBass.frequency.value   = 100;  tsBass.gain.value   = 0;
  const tsMid    = ctx.createBiquadFilter(); tsMid.type    = 'peaking';   tsMid.frequency.value    = 700;  tsMid.gain.value    = 0; tsMid.Q.value = 1.2;
  const tsTreble = ctx.createBiquadFilter(); tsTreble.type = 'highshelf'; tsTreble.frequency.value = 3200; tsTreble.gain.value = 0;
  const tsPresence = ctx.createBiquadFilter(); tsPresence.type = 'peaking'; tsPresence.frequency.value = 5000; tsPresence.gain.value = 0; tsPresence.Q.value = 1.5;

  // Buzz path: tap from preampPostGain, highpass → saturate → blend into wetBus later
  preampPostGain.connect(buzzHP);
  buzzHP.connect(buzzDrive);
  buzzDrive.connect(buzzShaper);
  buzzShaper.connect(buzzLevel);

  muGain.connect(tsBass);
  tsBass.connect(tsMid);
  tsMid.connect(tsTreble);
  tsTreble.connect(tsPresence);

  // === POWER AMP SAG — compresses dynamically under load ===
  // Routing-bypassed by default. DynamicsCompressor is never truly transparent
  // even at ratio=1 / threshold=-100, so we keep it OUT of the signal path
  // whenever sag is 0. When the user dials sag up, _engageSag() wires the
  // compressor in between tsPresence and cabHP; when they pull it back to 0,
  // _bypassSag() removes it again. This mirrors the pattern used in Space
  // (glueComp / limiter) and Mix Bus (bus comp / limiter).
  const sagComp = ctx.createDynamicsCompressor();
  sagComp.threshold.value = -100; // engaged value set by setSag
  sagComp.knee.value      = 12;
  sagComp.ratio.value     = 4;
  sagComp.attack.value    = 0.05;  // slow attack = bloom/swell
  sagComp.release.value   = 0.4;

  // === CAB SIM — fixed speaker + mic response ===
  const cabHP = ctx.createBiquadFilter();
  cabHP.type = 'highpass'; cabHP.frequency.value = 65; cabHP.Q.value = 0.7;

  const cabLowBump = ctx.createBiquadFilter();  // speaker cone resonance
  cabLowBump.type = 'peaking'; cabLowBump.frequency.value = 130; cabLowBump.gain.value = 2.5; cabLowBump.Q.value = 1.5;

  const cabMidDip = ctx.createBiquadFilter();   // mic placement scoop (makes it less nasal)
  cabMidDip.type = 'peaking'; cabMidDip.frequency.value = 1600; cabMidDip.gain.value = -2.5; cabMidDip.Q.value = 1.8;

  const cabLP1 = ctx.createBiquadFilter();      // speaker air rolloff
  cabLP1.type = 'lowpass'; cabLP1.frequency.value = 5000; cabLP1.Q.value = 0.6;

  const cabLP2 = ctx.createBiquadFilter();      // second stage — steep cut above 7.5kHz
  cabLP2.type = 'lowpass'; cabLP2.frequency.value = 7500; cabLP2.Q.value = 0.5;

  // Default routing: tsPresence → cabHP direct (sagComp routing-bypassed).
  // _engageSag() inserts sagComp between tsPresence and cabHP when sag > 0.
  tsPresence.connect(cabHP);
  cabHP.connect(cabLowBump);
  cabLowBump.connect(cabMidDip);
  cabMidDip.connect(cabLP1);
  cabLP1.connect(cabLP2);

  // Makeup gain (cab sim attenuates)
  const cabMakeup = ctx.createGain(); cabMakeup.gain.value = 3;
  cabLP2.connect(cabMakeup);

  // Dry path bypasses processing.
  // Module starts at dry=1, wet=0 → fully transparent at rest. User dials
  // Mix up to engage the preamp + tonestack + cab sim chain. None of the
  // wet-path coloration (prePresence +3dB shelf, cab EQ, makeup gain) can
  // affect the output while wetBus is silenced, so bypass vs un-bypass
  // sounds identical when the module is first added.
  const dryGain = ctx.createGain(); dryGain.gain.value = 1;
  const wetBus  = ctx.createGain(); wetBus.gain.value  = 0;
  inputGainNode.connect(dryGain);
  dryGain.connect(outputGain);
  cabMakeup.connect(wetBus);
  buzzLevel.connect(wetBus);

  const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const eqFilters = EQ_FREQS.map(freq => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.4; f.gain.value = 0;
    return f;
  });
  eqFilters.reduce((prev, curr) => { prev.connect(curr); return curr; });
  wetBus.connect(eqFilters[0]);
  eqFilters[eqFilters.length - 1].connect(outputGain);

  outputGain.connect(outputPanner);
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

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

  // === PARAMETER SETTERS ===
  // drive 0-1: orb Y position → how hard the preamp is pushed
  function setDrive(v) {
    preampDrive.gain.setTargetAtTime(v < 0.01 ? 0.001 : 0.2 + v * 4, ctx.currentTime, 0.05);
  }

  // tone -1 to +1: orb X position → treble tilt (negative = dark, positive = bright)
  function setToneTilt(v) {
    // Bright side: treble up + bass down. Dark side: bass up + treble down
    tsTreble.gain.setTargetAtTime(v * 10,   ctx.currentTime, 0.05);
    tsBass.gain.setTargetAtTime(-v * 6,     ctx.currentTime, 0.05);
  }

  // Manual tonestack controls (panel sliders)
  function setBass(v)     { tsBass.gain.setTargetAtTime((v - 0.5) * 24,      ctx.currentTime, 0.05); }
  function setMid(v)      { tsMid.gain.setTargetAtTime((v - 0.5) * 20,       ctx.currentTime, 0.05); }
  function setTreble(v)   { tsTreble.gain.setTargetAtTime((v - 0.5) * 24,    ctx.currentTime, 0.05); }
  function setPresence(v) { tsPresence.gain.setTargetAtTime((v - 0.5) * 16,  ctx.currentTime, 0.05); }

  // Sag: 0 = off (sagComp fully routing-bypassed), 1 = heavy compression/bloom
  let _sagActive = false;
  function _engageSag() {
    if (_sagActive) return;
    _sagActive = true;
    try { tsPresence.disconnect(cabHP); } catch {}
    try { tsPresence.connect(sagComp);  } catch {}
    try { sagComp.connect(cabHP);       } catch {}
  }
  function _bypassSag() {
    if (!_sagActive) return;
    _sagActive = false;
    try { sagComp.disconnect(cabHP);    } catch {}
    try { tsPresence.disconnect(sagComp); } catch {}
    try { tsPresence.connect(cabHP);    } catch {}
  }
  function setSag(v) {
    if (v < 0.02) { _bypassSag(); return; }
    _engageSag();
    sagComp.threshold.setTargetAtTime(-8 - v * 22, ctx.currentTime, 0.05);
  }

  function setMix(v) {
    dryGain.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.05);
    wetBus.gain.setTargetAtTime(v,      ctx.currentTime, 0.05);
  }
  function setInputGain(v)  { inputGainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,    ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,   ctx.currentTime, 0.02); }
  function setEqBand(i, gainDb) { eqFilters[i].gain.setTargetAtTime(gainDb, ctx.currentTime, 0.02); }

  // μ-law: 0 = off (linear), 1 = heavy bloom compression
  function setMuLaw(v) {
    if (Math.abs(v - currentMu) > 0.005) { currentMu = v; buildMuCurve(v); }
    // Compensate level: mu compression reduces peak level, restore it
    muGain.gain.setTargetAtTime(1 + v * 0.6, ctx.currentTime, 0.05);
  }

  // Buzz: 0 = off, 1 = full high-freq saturation blend
  function setBuzz(v) {
    buzzDrive.gain.setTargetAtTime(v * 6 + 0.001, ctx.currentTime, 0.05);
    buzzLevel.gain.setTargetAtTime(v * 0.4,        ctx.currentTime, 0.05);
  }

  // Bypass-state guard: prevents the duplicate-connect bug where calling
  // setBypass(false) on a fresh engine would re-issue inputGainNode→preHP
  // and inputGainNode→dryGain, summing the input signal multiple times.
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      // Disconnect BOTH upstream paths: the wet chain (preHP) AND the dry
      // summing wire. Otherwise dryGain=1 at rest would stack on top of the
      // direct bypass wire and produce 2× the input level.
      try { inputGainNode.disconnect(preHP);   } catch {}
      try { inputGainNode.disconnect(dryGain); } catch {}
      try { input.connect(outputGain);         } catch {}
    } else {
      try { input.disconnect(outputGain);      } catch {}
      try { inputGainNode.connect(preHP);      } catch {}
      try { inputGainNode.connect(dryGain);    } catch {}
    }
  }

  // === METERING ===
  let iPeak=0,oPeak=0,iPeakT=0,oPeakT=0;
  const getRMS = an => { const d=new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length); };
  function getInputLevel()  { return getRMS(inputAnalyser); }
  function getOutputLevel() { return getRMS(outputAnalyser); }
  function getInputPeak()  { const l=getInputLevel(),  n=ctx.currentTime; if(l>iPeak||n-iPeakT>2){iPeak=l;iPeakT=n;} return iPeak; }
  function getOutputPeak() { const l=getOutputLevel(), n=ctx.currentTime; if(l>oPeak||n-oPeakT>2){oPeak=l;oPeakT=n;} return oPeak; }
  function getReactiveData() {
    const d=new Float32Array(reactiveAnalyser.fftSize); reactiveAnalyser.getFloatTimeDomainData(d);
    let rms=0,peak=0; for(const x of d){rms+=x*x;if(Math.abs(x)>peak)peak=Math.abs(x);}
    return { rms:Math.sqrt(rms/d.length), peak, transient:Math.abs(d[0]-d[d.length-1]) };
  }

  function destroy() {}

  return {
    ctx, input, output, chainOutput, reconnectAnalysers,
    setDrive, setToneTilt, setBass, setMid, setTreble, setPresence, setSag,
    setMix, setInputGain, setOutputGain, setPan, setBypass, setEqBand, setMuLaw, setBuzz, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak, getReactiveData,
  };
}
