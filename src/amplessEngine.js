// amplessEngine.js — AMPLESS: Harmonic Tone Engine
//
// Amp tone without the amp.
// Touch-responsive harmonic saturation + cabinet-like tone shaping
//
// Controls:
//   BODY   — low/mid thickness
//   BITE   — upper harmonic edge
//   SAG    — dynamic compression (slow attack = bloom)
//   DRIVE  — harmonic density
//   TONE   — output tilt
//   GATE   — noise gate threshold
//   MIX    — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'ampless-v1';

const PROCESSOR_CODE = `
class AmplessProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'body',   defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'bite',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'sag',    defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'drive',  defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'tone',   defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'gate',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 1,   minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Body filter (2-pole LP for warmth)
    this.bodyLp1L = 0; this.bodyLp2L = 0;
    this.bodyLp1R = 0; this.bodyLp2R = 0;

    // Bite filter (HP for edge)
    this.biteHpL = 0; this.biteHpR = 0;

    // Sag envelope (slow compressor)
    this.sagEnv = 0;

    // Tone tilt
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Gate
    this.gateEnv = 0;
    this.gateOpen = true;

    // Cabinet sim LP
    this.cabLpL = 0; this.cabLpR = 0;

    this._peakOut = 0;
    this._inputPeak = 0;
    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const body  = params.body[0];
    const bite  = params.bite[0];
    const sag   = params.sag[0];
    const drive = params.drive[0];
    const tone  = params.tone[0];
    const gate  = params.gate[0];
    const mix   = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;
    let inPeakAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this.bodyLp1L=0;this.bodyLp2L=0;this.bodyLp1R=0;this.bodyLp2R=0;
      this.biteHpL=0;this.biteHpR=0;this.sagEnv=0;
      this.tiltLpL=0;this.tiltLpR=0;this.cabLpL=0;this.cabLpR=0;
      this._peakOut = peakAccum; this._inputPeak = 0;
      this.port.postMessage({ peak: peakAccum, inp: 0 });
      return true;
    }

    // Drive gain
    const driveGain = 1 + drive * 8; // 1x to 9x

    // Body: LP at 200-600Hz
    const bodyFreq = 200 + body * 400;
    const bodyCoef = Math.exp(-2 * Math.PI * bodyFreq / sr);
    const bodyGain = 1 + body * 2;

    // Bite: HP emphasis at 2-5kHz
    const biteFreq = 2000 + bite * 3000;
    const biteCoef = Math.exp(-2 * Math.PI * biteFreq / sr);
    const biteGain = bite * 2.5;

    // Sag: slow attack compressor
    const sagAtk = Math.exp(-1 / (sr * (0.01 + sag * 0.1))); // 10-110ms
    const sagRel = Math.exp(-1 / (sr * (0.1 + sag * 0.5)));  // 100-600ms
    const sagThresh = 0.3 - sag * 0.2;
    const sagRatio = 2 + sag * 6;

    // Tone
    const toneFreq = 600 * Math.pow(10, (tone - 0.5) * 2);
    const toneCoef = Math.exp(-2 * Math.PI * toneFreq / sr);

    // Cabinet sim: gentle LP at 5-8kHz
    const cabFreq = 5000 + tone * 3000;
    const cabCoef = Math.exp(-2 * Math.PI * cabFreq / sr);

    // Gate threshold — maps 0..1 to -60dB..-16dB (practical noise gate range)
    const gateThreshDb = -60 + gate * 44;
    const gateThresh = Math.pow(10, gateThreshDb / 20);
    const gateAtkCoef = Math.exp(-1 / (sr * 0.0005)); // 0.5ms attack (fast open)
    const gateRelCoef = Math.exp(-1 / (sr * 0.02));   // 20ms release

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];
      let outL = dryL, outR = dryR;

      const inPeak = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (inPeak > inPeakAccum) inPeakAccum = inPeak;

      // ── Gate ──
      if (gate > 0.01) {
        if (inPeak > this.gateEnv) {
          this.gateEnv = gateAtkCoef * this.gateEnv + (1 - gateAtkCoef) * inPeak;
        } else {
          this.gateEnv = gateRelCoef * this.gateEnv + (1 - gateRelCoef) * inPeak;
        }
        this.gateOpen = this.gateEnv > gateThresh;
        if (!this.gateOpen) {
          // Hard gate: ratio squared for sharp cutoff below threshold
          const gateGain = (this.gateEnv / Math.max(gateThresh, 0.0001));
          const gateAtten = gateGain * gateGain; // squared for sharper close
          outL *= Math.min(gateAtten, 1);
          outR *= Math.min(gateAtten, 1);
        }
      }

      // ── Drive saturation ──
      outL = Math.tanh(outL * driveGain) / Math.tanh(driveGain);
      outR = Math.tanh(outR * driveGain) / Math.tanh(driveGain);

      // ── Body: add low warmth ──
      this.bodyLp1L = bodyCoef * this.bodyLp1L + (1 - bodyCoef) * outL;
      this.bodyLp2L = bodyCoef * this.bodyLp2L + (1 - bodyCoef) * this.bodyLp1L;
      this.bodyLp1R = bodyCoef * this.bodyLp1R + (1 - bodyCoef) * outR;
      this.bodyLp2R = bodyCoef * this.bodyLp2R + (1 - bodyCoef) * this.bodyLp1R;
      outL += this.bodyLp2L * (bodyGain - 1);
      outR += this.bodyLp2R * (bodyGain - 1);

      // ── Bite: add upper edge ──
      if (bite > 0.01) {
        this.biteHpL = biteCoef * this.biteHpL + (1 - biteCoef) * outL;
        this.biteHpR = biteCoef * this.biteHpR + (1 - biteCoef) * outR;
        outL += (outL - this.biteHpL) * biteGain;
        outR += (outR - this.biteHpR) * biteGain;
      }

      // ── Sag: dynamic bloom ──
      if (sag > 0.01) {
        const peak = Math.max(Math.abs(outL), Math.abs(outR));
        if (peak > this.sagEnv) {
          this.sagEnv = sagAtk * this.sagEnv + (1 - sagAtk) * peak;
        } else {
          this.sagEnv = sagRel * this.sagEnv + (1 - sagRel) * peak;
        }
        if (this.sagEnv > sagThresh) {
          const overDb = 20 * Math.log10(this.sagEnv / sagThresh);
          const reducDb = overDb * (1 - 1 / sagRatio);
          const gain = Math.pow(10, -reducDb / 20);
          outL *= gain; outR *= gain;
        }
      }

      // ── Cabinet sim LP ──
      this.cabLpL = cabCoef * this.cabLpL + (1 - cabCoef) * outL;
      this.cabLpR = cabCoef * this.cabLpR + (1 - cabCoef) * outR;
      outL = this.cabLpL;
      outR = this.cabLpR;

      // ── Tone tilt ──
      this.tiltLpL = toneCoef * this.tiltLpL + (1 - toneCoef) * outL;
      this.tiltLpR = toneCoef * this.tiltLpR + (1 - toneCoef) * outR;
      if (tone < 0.5) {
        const amt = (0.5 - tone) * 2;
        outL = outL * (1 - amt * 0.5) + this.tiltLpL * amt * 0.5;
        outR = outR * (1 - amt * 0.5) + this.tiltLpR * amt * 0.5;
      } else {
        const amt = (tone - 0.5) * 2;
        outL += (outL - this.tiltLpL) * amt * 0.3;
        outR += (outR - this.tiltLpR) * amt * 0.3;
      }

      // ── Mix ──
      oL[n] = dryL * (1 - mix) + outL * mix;
      oR[n] = dryR * (1 - mix) + outR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peakOut = peakAccum;
    this._inputPeak = inPeakAccum;
    this.port.postMessage({ peak: peakAccum, inp: inPeakAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', AmplessProcessor);
`;

export async function createAmplessEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input = audioCtx.createGain(), output = audioCtx.createGain(), chainOutput = audioCtx.createGain();
  const inputTrim = audioCtx.createGain(), outputTrim = audioCtx.createGain();
  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });
  const analyserIn = audioCtx.createAnalyser(); analyserIn.fftSize = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim); inputTrim.connect(analyserIn); analyserIn.connect(worklet);
  worklet.connect(analyserOut); analyserOut.connect(outputTrim);
  outputTrim.connect(output); outputTrim.connect(chainOutput);

  let _peak = 0, _inp = 0;
  worklet.port.onmessage = e => { if (e.data?.peak !== undefined) _peak = e.data.peak; if (e.data?.inp !== undefined) _inp = e.data.inp; };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }
  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; }, setOutputGain: v => { outputTrim.gain.value = v; },
    setBody: v => { p('body').value = v; }, setBite: v => { p('bite').value = v; },
    setSag: v => { p('sag').value = v; }, setDrive: v => { p('drive').value = v; },
    setTone: v => { p('tone').value = v; }, setGate: v => { p('gate').value = v; },
    setMix: v => { p('mix').value = v; }, setBypass: v => { p('bypass').value = v ? 1 : 0; },
    getInputPeak: () => { _peakIn = Math.max(getPeak(analyserIn), _peakIn * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn), getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak, getInputDrive: () => _inp,
    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
