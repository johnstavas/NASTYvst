// simpleReverbEngine.js — Simple convolution reverb module
// Signal flow:
//   input → inputGain ─┬─ dryGain ───────────────────────────────────┐
//                      │                                             │
//                      └─ preHP → preDelay → convolver               │
//                        → dampingLP → toneShelf → wetGain ──────────┤
//                                                                    ↓
//                                               outputGain → panner → output
//                                                                    ↓
//                                                                chainOutput
//
// Design notes:
//   • Transparent-at-rest: dryGain=1, wetGain=0 by default — bypass vs un-bypass
//     sounds identical until the user dials Mix up.
//   • NO per-frame WaveShaper curve reassignment (that was the Bloom stutter cause).
//   • NO DelayNode.delayTime modulation (that caused the pitch warble in spread).
//   • The IR is built ONCE at construction and never mutated.
//   • Tone/Decay are plain BiquadFilter automations — smooth setTargetAtTime ramps.

export function createSimpleReverbEngine(ctx) {

  // === I/O ===
  const input         = ctx.createGain();
  const output        = ctx.createGain();
  const chainOutput   = ctx.createGain();
  const outputGain    = ctx.createGain();         outputGain.gain.value   = 1;
  const outputPanner  = ctx.createStereoPanner(); outputPanner.pan.value  = 0;
  const inputGainNode = ctx.createGain();         inputGainNode.gain.value = 1;
  input.connect(inputGainNode);

  // === Dry path (unity — module is transparent-at-rest) ===
  const dryGain = ctx.createGain(); dryGain.gain.value = 1;
  inputGainNode.connect(dryGain);
  dryGain.connect(outputGain);

  // === Wet path ===
  // Pre-HP: remove rumble before hitting the convolver so the tail stays clean
  const preHP = ctx.createBiquadFilter();
  preHP.type = 'highpass'; preHP.frequency.value = 120; preHP.Q.value = 0.7;

  // Fixed pre-delay (25 ms) — separates dry from wet so transients breathe.
  // Never modulated — constant delayTime means no pitch-shift artifacts.
  const preDelay = ctx.createDelay(0.5);
  preDelay.delayTime.value = 0.025;

  // Convolver — stereo IR built once, never swapped
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer    = buildIR(ctx, 2.0, 3.0);

  // Damping LP — ear perceives a low-passed tail as shorter,
  // so this functions as a decay control without buffer reloading
  const dampingLP = ctx.createBiquadFilter();
  dampingLP.type = 'lowpass';
  dampingLP.frequency.value = 8000;
  dampingLP.Q.value = 0.7;

  // Tone highshelf — brightens or darkens the wet tail
  const toneShelf = ctx.createBiquadFilter();
  toneShelf.type = 'highshelf';
  toneShelf.frequency.value = 4000;
  toneShelf.gain.value = 0;

  // Wet fader — starts silent, user dials it in with the Mix knob
  const wetGain = ctx.createGain(); wetGain.gain.value = 0;

  inputGainNode.connect(preHP);
  preHP.connect(preDelay);
  preDelay.connect(convolver);
  convolver.connect(dampingLP);
  dampingLP.connect(toneShelf);
  toneShelf.connect(wetGain);
  wetGain.connect(outputGain);

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

  // === PARAMETER SETTERS ===
  // tone: -1..+1 → ±8 dB at 4 kHz shelf (negative = dark tail, positive = bright)
  function setTone(v) {
    toneShelf.gain.setTargetAtTime(v * 8, ctx.currentTime, 0.05);
  }
  // decay: 0..1 → damping LP 800 Hz → 18 kHz (quadratic, musical feel)
  function setDecay(v) {
    const hz = 800 + v * v * 17200;
    dampingLP.frequency.setTargetAtTime(hz, ctx.currentTime, 0.05);
  }
  // mix: 0 = fully dry, 1 = fully wet
  function setMix(v) {
    dryGain.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.05);
    wetGain.gain.setTargetAtTime(v,     ctx.currentTime, 0.05);
  }
  function setInputGain(v)  { inputGainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v,    ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v,   ctx.currentTime, 0.02); }

  // Bypass-state guard: prevents the duplicate-connect bug where calling
  // setBypass(false) on a freshly-constructed engine would re-issue both
  // inputGainNode → dryGain and inputGainNode → preHP connections that
  // construction already made (Web Audio sums duplicates → +6 dB phantom).
  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      // Disconnect BOTH upstream paths and insert a direct input→outputGain wire
      // so bypass level matches the dry-at-unity resting state exactly.
      try { inputGainNode.disconnect(dryGain); } catch {}
      try { inputGainNode.disconnect(preHP);   } catch {}
      try { input.connect(outputGain);         } catch {}
    } else {
      try { input.disconnect(outputGain);      } catch {}
      try { inputGainNode.connect(dryGain);    } catch {}
      try { inputGainNode.connect(preHP);      } catch {}
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
    ctx, input, output, chainOutput,
    setTone, setDecay, setMix, setInputGain, setOutputGain, setPan, setBypass, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak, getReactiveData,
  };
}

// Build a stereo IR: decorrelated noise with exponential decay + a couple of
// early reflection taps for density. Built once at construction.
function buildIR(ctx, duration, decayPower) {
  const sr     = ctx.sampleRate;
  const length = Math.floor(sr * duration);
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t   = i / length;
      const env = Math.pow(1 - t, decayPower);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    // Early reflection taps — different polarities per channel widen the image
    const r1 = Math.floor(sr * 0.011);
    const r2 = Math.floor(sr * 0.023);
    const r3 = Math.floor(sr * 0.037);
    if (r1 < length) data[r1] += 0.35 * (ch === 0 ?  1 : -1);
    if (r2 < length) data[r2] += 0.25 * (ch === 0 ? -1 :  1);
    if (r3 < length) data[r3] += 0.18;
  }
  return buffer;
}
