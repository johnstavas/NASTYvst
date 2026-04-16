// morphReverbEngine.js — MORPHREVERB: Morphing Dual-Space Reverb
//
// Two independent reverb engines (Space A & B) with parameter interpolation morphing.
// Space types: Plate, Hall, Chamber, Room, Cloud
// Each space: 3 comb filters + 2 allpass diffusers
//
// Controls:
//   SPACEA   — space type A (0-4)
//   SPACEB   — space type B (0-4)
//   MORPH    — crossfade + parameter interpolation between A and B
//   TEXTURE  — allpass modulation depth
//   TONE     — post-morph tilt EQ
//   MIX      — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'morphreverb-v1';

const PROCESSOR_CODE = `
// Space type definitions: [comb1Len, comb2Len, comb3Len, ap1Len, ap2Len, feedback, damping, brightness]
// Lengths in samples at 44100Hz reference
const SPACE_DEFS = [
  // Plate: short delays, high density, bright
  { combLens: [743, 877, 1013],  apLens: [241, 307],  feedback: 0.82, damping: 0.15, brightness: 0.8 },
  // Hall: long delays, moderate feedback, warm
  { combLens: [1567, 1847, 2113], apLens: [443, 571],  feedback: 0.85, damping: 0.35, brightness: 0.5 },
  // Chamber: medium delays, moderate density
  { combLens: [1097, 1277, 1487], apLens: [347, 431],  feedback: 0.80, damping: 0.25, brightness: 0.6 },
  // Room: short, low feedback, natural
  { combLens: [557, 691, 823],    apLens: [179, 223],  feedback: 0.68, damping: 0.30, brightness: 0.65 },
  // Cloud: very long, high feedback, ethereal
  { combLens: [2237, 2687, 3109], apLens: [601, 773],  feedback: 0.88, damping: 0.45, brightness: 0.4 },
];

class MorphReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'spaceA',  defaultValue: 0,   minValue: 0, maxValue: 4 },
      { name: 'spaceB',  defaultValue: 1,   minValue: 0, maxValue: 4 },
      { name: 'morph',   defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'texture', defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'smooth',  defaultValue: 0,   minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const scale = this.sr / 44100;

    // Find maximum delay length needed across all spaces
    let maxComb = 0, maxAp = 0;
    for (const sp of SPACE_DEFS) {
      for (const l of sp.combLens) if (l > maxComb) maxComb = l;
      for (const l of sp.apLens) if (l > maxAp) maxAp = l;
    }
    this.maxCombLen = Math.ceil(maxComb * scale) + 4;
    this.maxApLen = Math.ceil(maxAp * scale) + 4;

    // Space A: 3 combs + 2 allpass (stereo)
    this.combBufAL = []; this.combBufAR = [];
    this.combIdxA = [];
    for (let i = 0; i < 3; i++) {
      this.combBufAL.push(new Float32Array(this.maxCombLen));
      this.combBufAR.push(new Float32Array(this.maxCombLen));
      this.combIdxA.push(0);
    }
    this.apBufAL = []; this.apBufAR = [];
    this.apIdxA = [];
    for (let i = 0; i < 2; i++) {
      this.apBufAL.push(new Float32Array(this.maxApLen));
      this.apBufAR.push(new Float32Array(this.maxApLen));
      this.apIdxA.push(0);
    }
    this.combDampAL = [0, 0, 0];
    this.combDampAR = [0, 0, 0];

    // Space B: 3 combs + 2 allpass (stereo)
    this.combBufBL = []; this.combBufBR = [];
    this.combIdxB = [];
    for (let i = 0; i < 3; i++) {
      this.combBufBL.push(new Float32Array(this.maxCombLen));
      this.combBufBR.push(new Float32Array(this.maxCombLen));
      this.combIdxB.push(0);
    }
    this.apBufBL = []; this.apBufBR = [];
    this.apIdxB = [];
    for (let i = 0; i < 2; i++) {
      this.apBufBL.push(new Float32Array(this.maxApLen));
      this.apBufBR.push(new Float32Array(this.maxApLen));
      this.apIdxB.push(0);
    }
    this.combDampBL = [0, 0, 0];
    this.combDampBR = [0, 0, 0];

    // Texture LFO
    this.texPhase = 0;
    this.texRate = 0.3; // Hz

    // Tilt EQ state
    this.tiltLpL = 0;
    this.tiltLpR = 0;

    this._peak = 0;
    this._scale = scale;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  // Interpolate space parameters
  lerpSpace(idxA, idxB, morph) {
    const sA = SPACE_DEFS[Math.round(Math.max(0, Math.min(4, idxA)))];
    const sB = SPACE_DEFS[Math.round(Math.max(0, Math.min(4, idxB)))];
    const m = morph;
    const im = 1 - m;
    const scale = this._scale;
    return {
      combLensA: sA.combLens.map(l => Math.round(l * scale)),
      combLensB: sB.combLens.map(l => Math.round(l * scale)),
      apLensA: sA.apLens.map(l => Math.round(l * scale)),
      apLensB: sB.apLens.map(l => Math.round(l * scale)),
      feedbackA: sA.feedback,
      feedbackB: sB.feedback,
      dampingA: sA.damping,
      dampingB: sB.damping,
    };
  }

  processComb(buf, idx, len, maxLen, input, feedback, dampState, dampCoeff) {
    const readIdx = (idx[0] - len + maxLen * 2) % maxLen;
    const out = buf[readIdx];
    // Damped feedback
    dampState[0] = dampCoeff * dampState[0] + (1 - dampCoeff) * out;
    buf[idx[0]] = input + dampState[0] * feedback;
    idx[0] = (idx[0] + 1) % maxLen;
    return out;
  }

  processAllpass(buf, idx, len, maxLen, input, coeff) {
    const readIdx = (idx[0] - len + maxLen * 2) % maxLen;
    const delayed = buf[readIdx];
    const out = -coeff * input + delayed;
    buf[idx[0]] = input + coeff * out;
    idx[0] = (idx[0] + 1) % maxLen;
    return out;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const spaceA = params.spaceA[0];
    const spaceB = params.spaceB[0];
    const morph = params.morph[0];
    const texture = params.texture[0];
    const tone = params.tone[0];
    const mix = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;

    if (bypass) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, morph: morph });
      return true;
    }

    const sp = this.lerpSpace(spaceA, spaceB, morph);
    const maxCL = this.maxCombLen;
    const maxAL = this.maxApLen;

    // Texture modulation: modulate allpass coefficient
    const baseApCoeff = 0.5;

    // Tilt EQ crossover
    const tiltCoeff = Math.exp(-2 * Math.PI * 1200 / sr);
    const tiltGain = (tone - 0.5) * 2;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];

      // Texture LFO for allpass modulation
      this.texPhase += this.texRate / sr;
      if (this.texPhase >= 1) this.texPhase -= 1;
      const texMod = Math.sin(2 * Math.PI * this.texPhase) * texture * 0.3;
      const apCoeffA = Math.max(0.1, Math.min(0.9, baseApCoeff + texMod));
      const apCoeffB = Math.max(0.1, Math.min(0.9, baseApCoeff - texMod * 0.7));

      // ---- Space A processing ----
      let spAL = 0, spAR = 0;
      for (let c = 0; c < 3; c++) {
        const idxArrL = [this.combIdxA[c]];
        const dampArrL = [this.combDampAL[c]];
        const cOutL = this.processComb(this.combBufAL[c], idxArrL, sp.combLensA[c], maxCL, dryL, sp.feedbackA, dampArrL, sp.dampingA);
        this.combIdxA[c] = idxArrL[0];
        this.combDampAL[c] = dampArrL[0];

        const idxArrR = [this.combIdxA[c]]; // Note: sharing idx for simplicity but offset R
        const dampArrR = [this.combDampAR[c]];
        const cOutR = this.processComb(this.combBufAR[c], [this.combBufAR[c]._idx || 0], sp.combLensA[c], maxCL, dryR, sp.feedbackA, dampArrR, sp.dampingA);
        // Manual R index tracking
        if (!this.combBufAR[c]._idx) this.combBufAR[c]._idx = 0;
        const rIdx = (this.combBufAR[c]._idx - sp.combLensA[c] + maxCL * 2) % maxCL;
        const rOut = this.combBufAR[c][rIdx];
        this.combDampAR[c] = sp.dampingA * this.combDampAR[c] + (1 - sp.dampingA) * rOut;
        this.combBufAR[c][this.combBufAR[c]._idx] = dryR + this.combDampAR[c] * sp.feedbackA;
        this.combBufAR[c]._idx = (this.combBufAR[c]._idx + 1) % maxCL;

        spAL += cOutL;
        spAR += rOut;
      }
      spAL /= 3; spAR /= 3;

      // Allpass diffusion for Space A
      for (let a = 0; a < 2; a++) {
        const idxL = [this.apIdxA[a]];
        spAL = this.processAllpass(this.apBufAL[a], idxL, sp.apLensA[a], maxAL, spAL, apCoeffA);
        this.apIdxA[a] = idxL[0];

        if (!this.apBufAR[a]._idx) this.apBufAR[a]._idx = 0;
        const arIdx = (this.apBufAR[a]._idx - sp.apLensA[a] + maxAL * 2) % maxAL;
        const arDel = this.apBufAR[a][arIdx];
        const arOut = -apCoeffA * spAR + arDel;
        this.apBufAR[a][this.apBufAR[a]._idx] = spAR + apCoeffA * arOut;
        this.apBufAR[a]._idx = (this.apBufAR[a]._idx + 1) % maxAL;
        spAR = arOut;
      }

      // ---- Space B processing ----
      let spBL = 0, spBR = 0;
      for (let c = 0; c < 3; c++) {
        const idxArrL = [this.combIdxB[c]];
        const dampArrL = [this.combDampBL[c]];
        const cOutL = this.processComb(this.combBufBL[c], idxArrL, sp.combLensB[c], maxCL, dryL, sp.feedbackB, dampArrL, sp.dampingB);
        this.combIdxB[c] = idxArrL[0];
        this.combDampBL[c] = dampArrL[0];

        if (!this.combBufBR[c]._idx) this.combBufBR[c]._idx = 0;
        const rIdx = (this.combBufBR[c]._idx - sp.combLensB[c] + maxCL * 2) % maxCL;
        const rOut = this.combBufBR[c][rIdx];
        this.combDampBR[c] = sp.dampingB * this.combDampBR[c] + (1 - sp.dampingB) * rOut;
        this.combBufBR[c][this.combBufBR[c]._idx] = dryR + this.combDampBR[c] * sp.feedbackB;
        this.combBufBR[c]._idx = (this.combBufBR[c]._idx + 1) % maxCL;

        spBL += cOutL;
        spBR += rOut;
      }
      spBL /= 3; spBR /= 3;

      // Allpass diffusion for Space B
      for (let a = 0; a < 2; a++) {
        const idxL = [this.apIdxB[a]];
        spBL = this.processAllpass(this.apBufBL[a], idxL, sp.apLensB[a], maxAL, spBL, apCoeffB);
        this.apIdxB[a] = idxL[0];

        if (!this.apBufBR[a]._idx) this.apBufBR[a]._idx = 0;
        const brIdx = (this.apBufBR[a]._idx - sp.apLensB[a] + maxAL * 2) % maxAL;
        const brDel = this.apBufBR[a][brIdx];
        const brOut = -apCoeffB * spBR + brDel;
        this.apBufBR[a][this.apBufBR[a]._idx] = spBR + apCoeffB * brOut;
        this.apBufBR[a]._idx = (this.apBufBR[a]._idx + 1) % maxAL;
        spBR = brOut;
      }

      // Morph crossfade
      const im = 1 - morph;
      let wetL = spAL * im + spBL * morph;
      let wetR = spAR * im + spBR * morph;

      // Tilt EQ
      this.tiltLpL = tiltCoeff * this.tiltLpL + (1 - tiltCoeff) * wetL;
      this.tiltLpR = tiltCoeff * this.tiltLpR + (1 - tiltCoeff) * wetR;
      const hpL = wetL - this.tiltLpL;
      const hpR = wetR - this.tiltLpR;
      if (tiltGain > 0) {
        wetL = this.tiltLpL + hpL * (1 + tiltGain * 1.5);
        wetR = this.tiltLpR + hpR * (1 + tiltGain * 1.5);
      } else {
        wetL = this.tiltLpL * (1 - tiltGain * 1.2) + hpL;
        wetR = this.tiltLpR * (1 - tiltGain * 1.2) + hpR;
      }

      // Soft clip
      wetL = Math.tanh(wetL);
      wetR = Math.tanh(wetR);

      // Smooth LP filter on wet signal
      const smooth = params.smooth[0];
      if (smooth > 0.5) {
        const smoothFreq = 6500 - smooth * 900;
        const smoothCoef = Math.exp(-2 * Math.PI * smoothFreq / sr);
        this.smoothLpL1 = smoothCoef * this.smoothLpL1 + (1 - smoothCoef) * wetL;
        this.smoothLpR1 = smoothCoef * this.smoothLpR1 + (1 - smoothCoef) * wetR;
        this.smoothLpL2 = smoothCoef * this.smoothLpL2 + (1 - smoothCoef) * this.smoothLpL1;
        this.smoothLpR2 = smoothCoef * this.smoothLpR2 + (1 - smoothCoef) * this.smoothLpR1;
        wetL = this.smoothLpL2;
        wetR = this.smoothLpR2;
      }

      // Mix
      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this.port.postMessage({ peak: peakAccum, morph: morph });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', MorphReverbProcessor);
`;

export async function createMorphReverbEngine(audioCtx) {
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

  let _peak = 0, _morph = 0.5;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.morph !== undefined) _morph = e.data.morph;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s = 0; for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i]; return Math.sqrt(s / _buf.length); }
  function getPeakAn(an) { an.getFloatTimeDomainData(_buf); let m = 0; for (let i = 0; i < _buf.length; i++) { const a = Math.abs(_buf[i]); if (a > m) m = a; } return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setSpaceA: v => { p('spaceA').value = v; },
    setSpaceB: v => { p('spaceB').value = v; },
    setMorph: v => { p('morph').value = v; },
    setTexture: v => { p('texture').value = v; },
    setTone: v => { p('tone').value = v; },
    setMix: v => { p('mix').value = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak: () => { _peakIn = Math.max(getPeakAn(analyserIn), _peakIn * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getMorph: () => _morph,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
