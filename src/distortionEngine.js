// distortionEngine.js — 8-zone distortion module
// Zones (angle=screen degrees, y-down): Tape=270°top, Tube=315°, Diode=0°right,
// Fold=45°, Fuzz=90°bottom, Crush=135°, Drive=180°left, Vinyl=225°

export function createDistortionEngine(ctx) {
  // === I/O ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();
  const outputGain   = ctx.createGain();        outputGain.gain.value  = 1;
  const outputPanner = ctx.createStereoPanner(); outputPanner.pan.value = 0;
  const inputGainNode = ctx.createGain();        inputGainNode.gain.value = 1;
  input.connect(inputGainNode);

  // Tone LP on wet path
  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass'; toneFilter.frequency.value = 12000; toneFilter.Q.value = 0.5;

  // Dry / wet summing into outputGain — dry bypasses panner so pan only colours wet signal.
  // Starts at dry=1, wet=0 → module is bit-transparent at rest. User must dial
  // Mix up to hear the distortion zones (matching the transparent-at-rest contract
  // used by every other module).
  const dryGain = ctx.createGain(); dryGain.gain.value = 1;
  const wetBus  = ctx.createGain(); wetBus.gain.value  = 0;
  inputGainNode.connect(dryGain);
  wetBus.connect(toneFilter);

  const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const eqFilters = EQ_FREQS.map(freq => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.4; f.gain.value = 0;
    return f;
  });
  eqFilters.reduce((prev, curr) => { prev.connect(curr); return curr; });
  toneFilter.connect(eqFilters[0]);
  // Pan sits on wet path only — dry bypasses it so pan only colours the distorted signal
  eqFilters[eqFilters.length - 1].connect(outputPanner);
  outputPanner.connect(outputGain);
  dryGain.connect(outputGain);
  outputGain.connect(output);
  outputGain.connect(chainOutput);

  // === 8 ZONE SHAPERS — pre-gain drive approach (no curve changes = no pops) ===
  const ZONE_ANGLES = [270, 315, 0, 45, 90, 135, 180, 225];
  const drivePreGain = ctx.createGain(); drivePreGain.gain.value = 0.001;
  inputGainNode.connect(drivePreGain);

  const zones = ZONE_ANGLES.map(() => {
    const shaper   = ctx.createWaveShaper(); shaper.oversample = '4x';
    const zoneGain = ctx.createGain();       zoneGain.gain.value = 0;
    drivePreGain.connect(shaper);
    shaper.connect(zoneGain);
    zoneGain.connect(wetBus);
    return { shaper, zoneGain };
  });

  // Vinyl crackle noise
  const noiseLen = ctx.sampleRate * 2;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * Math.random();
  const noiseSrc  = ctx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true; noiseSrc.start();
  const noiseBP   = ctx.createBiquadFilter(); noiseBP.type = 'bandpass'; noiseBP.frequency.value = 2200; noiseBP.Q.value = 1.2;
  const noiseGain = ctx.createGain();         noiseGain.gain.value = 0;
  noiseSrc.connect(noiseBP); noiseBP.connect(noiseGain); noiseGain.connect(wetBus);

  // === WAVESHAPER CURVES (set once, never changed — prevents pops) ===
  const N = 512;
  const mk = fn => { const c = new Float32Array(N); for (let i = 0; i < N; i++) { const x=(i*2)/(N-1)-1; c[i]=Math.max(-1,Math.min(1,fn(x))); } return c; };
  const D = 0.85;
  [
    x => { const k=1+D*7;  return Math.tanh(x*k)/Math.tanh(k); },
    x => { const k=1+D*5;  return x>=0?Math.tanh(x*k*0.85)/Math.tanh(k):Math.tanh(x*k*1.2)/Math.tanh(k); },
    x => { const k=1+D*9;  return x>=0?Math.min(1,x*k):Math.tanh(x*k*0.35)/Math.tanh(k*0.35+0.01); },
    x => { const v=x*(1+D*3.5); const m=((v%2)+2)%2; return m<1?m*2-1:(2-m)*2-1; },
    x => x*(1+D*25),
    x => { const bits=Math.max(2,Math.round(8-D*5.5)); const step=2/(2**bits); return Math.round(x/step)*step; },
    x => (2/Math.PI)*Math.atan(x*(1+D*12)),
    x => { const k=1+D*3; return Math.tanh(x*k+x*x*0.2*k)/Math.tanh(k+0.01); },
  ].forEach((fn, i) => { zones[i].shaper.curve = mk(fn); });

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

  function calcZoneWeights(angleDeg) {
    const w = ZONE_ANGLES.map(a => { let d=Math.abs(angleDeg-a)%360; if(d>180)d=360-d; return Math.max(0,Math.cos((Math.min(d,45)/45)*(Math.PI/2))); });
    const sum = w.reduce((a,b)=>a+b,0);
    return sum > 0 ? w.map(v=>v/sum) : w;
  }

  let _angle = 270, _dist = 0, _mix = 0;

  function _update() {
    const t = ctx.currentTime;
    const drive = _dist;
    const weights = calcZoneWeights(_angle);
    drivePreGain.gain.setTargetAtTime(drive < 0.01 ? 0.001 : 0.3 + drive * 3.2, t, 0.05);
    zones.forEach((z, i) => { z.zoneGain.gain.setTargetAtTime(weights[i], t, 0.06); });
    noiseGain.gain.setTargetAtTime(weights[7] * drive * 0.03, t, 0.05);
    dryGain.gain.setTargetAtTime(1 - _mix, t, 0.05);
    wetBus.gain.setTargetAtTime(_mix, t, 0.05);
  }

  function setPosition(angleDeg, dist) { _angle = angleDeg; _dist = dist; _update(); }
  function setMix(v)        { _mix = v; _update(); }
  function setTone(v)       { toneFilter.frequency.setTargetAtTime(600 * Math.pow(35, v), ctx.currentTime, 0.05); }
  function setInputGain(v)  { inputGainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,    ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,   ctx.currentTime, 0.02); }
  function setEqBand(i, gainDb) { eqFilters[i].gain.setTargetAtTime(gainDb, ctx.currentTime, 0.02); }

  // Bypass-state guard: prevents the duplicate-connect bug where calling
  // setBypass(false) on a fresh engine would re-issue inputGainNode→dryGain
  // and inputGainNode→drivePreGain, summing the input signal multiple times.
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { inputGainNode.disconnect(dryGain);     } catch {}
      try { inputGainNode.disconnect(drivePreGain); } catch {}
      try { input.connect(outputGain); } catch {}
    } else {
      try { input.disconnect(outputGain); } catch {}
      try { inputGainNode.connect(dryGain);      } catch {}
      try { inputGainNode.connect(drivePreGain); } catch {}
    }
  }

  let iPeak=0, oPeak=0, iPeakT=0, oPeakT=0;
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

  function destroy() { try { noiseSrc.stop(); } catch {} }

  return {
    ctx, input, output, chainOutput, reconnectAnalysers,
    setPosition, setMix, setTone, setInputGain, setOutputGain, setPan, setBypass, setEqBand, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak, getReactiveData,
  };
}
