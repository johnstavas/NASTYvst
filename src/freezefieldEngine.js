// freezefieldEngine.js — FREEZEFIELD: Freeze/Texture Reverb Instrument
//
// 4-line FDN with allpass diffusers, freeze capture, smear, drift, spectral shape, width
//
// Controls:
//   FREEZE  — capture reverb tail (>0.5 = frozen)
//   SMEAR   — time-blur modulation when frozen
//   DRIFT   — slow pitch modulation depth
//   SHAPE   — spectral tilt (dark-bright)
//   WIDTH   — mid-side stereo width
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'freezefield-v1';

const PROCESSOR_CODE = `
class FreezeFieldProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freeze', defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'smear',  defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'drift',  defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: 'shape',  defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'width',  defaultValue: 0.6, minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'smooth', defaultValue: 0,   minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const scale = this.sr / 44100;

    // 6 ALLPASS DIFFUSERS IN SERIES — fundamentally different from Gravity's FDN
    // Using prime-number delay lengths for maximal diffusion density
    this.apLens = [
      Math.round(1087 * scale),
      Math.round(1327 * scale),
      Math.round(1559 * scale),
      Math.round(1877 * scale),
      Math.round(2113 * scale),
      Math.round(2381 * scale),
    ];
    this.maxApLen = Math.round(2800 * scale) + 512; // extra room for smear modulation

    // 6 allpass buffers, stereo
    this.apBufL = []; this.apBufR = [];
    this.apPosL = []; this.apPosR = [];
    for (let i = 0; i < 6; i++) {
      this.apBufL.push(new Float32Array(this.maxApLen));
      this.apBufR.push(new Float32Array(this.maxApLen));
      this.apPosL.push(0);
      this.apPosR.push(0);
    }

    // Feedback path: output of chain feeds back to input
    this.fbL = 0;
    this.fbR = 0;

    // Damping LP per allpass in feedback
    this.dampL = [0, 0, 0, 0, 0, 0];
    this.dampR = [0, 0, 0, 0, 0, 0];

    // Smear LFOs (slow modulation per allpass line)
    this.smearPhase = [0, 0.17, 0.33, 0.50, 0.67, 0.83];
    this.smearRate = [0.07, 0.11, 0.05, 0.09, 0.06, 0.13]; // Hz

    // Drift LFO
    this.driftPhase = 0;
    this.driftRate = 0.1; // Hz

    // Tilt EQ (1-pole crossover at 1kHz)
    this.tiltLpL = 0;
    this.tiltLpR = 0;

    this._peak = 0;
    this._freezeLevel = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  // Hermite interpolation for fractional delay reads
  hermite(buf, pos, size) {
    let p = pos;
    while (p < 0) p += size;
    const i = Math.floor(p) % size;
    const f = p - Math.floor(p);
    const xm1 = buf[(i - 1 + size) % size];
    const x0 = buf[i];
    const x1 = buf[(i + 1) % size];
    const x2 = buf[(i + 2) % size];
    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + c0;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const freeze = params.freeze[0] > 0.5;
    const smear = params.smear[0];
    const drift = params.drift[0];
    const shape = params.shape[0];
    const width = params.width[0];
    const mix = params.mix[0];
    const bypass = params.bypass[0] > 0.5;

    const sr = this.sr;
    const feedback = freeze ? 0.998 : 0.88;
    const inputScale = freeze ? 0.0 : 1.0;

    // Damping: shape 0=dark (1.5kHz), 0.5=neutral (7kHz), 1=bright (19kHz) — wider range
    const dampFreq = 1500 + shape * shape * 17500;
    const dampCoeff = Math.exp(-2 * Math.PI * dampFreq / sr);

    // Allpass coefficient — higher = denser diffusion
    const apCoeff = 0.55 + shape * 0.15;

    // Tilt EQ crossover at 1kHz — more dramatic
    const tiltCoeff = Math.exp(-2 * Math.PI * 1000 / sr);
    const tiltGain = (shape - 0.5) * 2; // -1 to +1

    // Smear depth — dramatically increased
    const smearDepthSamples = smear * 180;

    // Drift depth — dramatically increased
    const driftDepthSamples = drift * 40;

    let peakAccum = 0;

    if (bypass) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, frozen: false });
      return true;
    }

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];

      // 6 ALLPASS DIFFUSERS IN SERIES with feedback around the chain
      // Start with input + feedback from previous iteration
      let chainL = dryL * inputScale * 0.5 + this.fbL * feedback;
      let chainR = dryR * inputScale * 0.5 + this.fbR * feedback;

      // Soft clip input to chain to prevent runaway
      chainL = Math.tanh(chainL);
      chainR = Math.tanh(chainR);

      let outL = 0, outR = 0;

      for (let i = 0; i < 6; i++) {
        const len = this.apLens[i];
        const bs = this.maxApLen;

        // Smear: modulate read position when frozen
        let smearOffset = 0;
        if (freeze && smear > 0.01) {
          this.smearPhase[i] += this.smearRate[i] / sr;
          if (this.smearPhase[i] >= 1) this.smearPhase[i] -= 1;
          smearOffset = Math.sin(2 * Math.PI * this.smearPhase[i]) * smearDepthSamples;
        }

        // Drift: pitch modulation
        let driftOffset = 0;
        if (drift > 0.01) {
          driftOffset = Math.sin(2 * Math.PI * this.driftPhase + i * 1.047) * driftDepthSamples;
        }

        const effLen = Math.max(10, len + Math.round(smearOffset + driftOffset));

        // Read from allpass delay
        const rpL = (this.apPosL[i] - effLen + bs * 2) % bs;
        const rpR = (this.apPosR[i] - effLen + bs * 2) % bs;

        const delL = this.hermite(this.apBufL[i], rpL, bs);
        const delR = this.hermite(this.apBufR[i], rpR, bs);

        // Allpass: out = -g*in + delayed; write = in + g*delayed
        const apOutL = -apCoeff * chainL + delL;
        const apOutR = -apCoeff * chainR + delR;

        // Damping LP in feedback path
        this.dampL[i] = dampCoeff * this.dampL[i] + (1 - dampCoeff) * (chainL + apCoeff * delL);
        this.dampR[i] = dampCoeff * this.dampR[i] + (1 - dampCoeff) * (chainR + apCoeff * delR);

        this.apBufL[i][this.apPosL[i]] = this.dampL[i];
        this.apBufR[i][this.apPosR[i]] = this.dampR[i];
        this.apPosL[i] = (this.apPosL[i] + 1) % bs;
        this.apPosR[i] = (this.apPosR[i] + 1) % bs;

        chainL = apOutL;
        chainR = apOutR;

        // Tap outputs from each allpass for a dense sum
        outL += apOutL * (0.2 - i * 0.015);
        outR += apOutR * (0.2 - i * 0.015);
      }

      // Store feedback for next sample
      this.fbL = chainL;
      this.fbR = chainR;

      // Advance drift LFO
      this.driftPhase += (this.driftRate * (0.5 + drift * 2)) / sr;
      if (this.driftPhase >= 1) this.driftPhase -= 1;

      let wetL = outL;
      let wetR = outR;

      // Tilt EQ: split into LP and HP, adjust balance — more dramatic
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

      // Width: mid-side processing
      const mid = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5;
      const sideGain = 0.5 + width * 1.2; // 0.5 = mono, 1.7 = wide
      wetL = mid + side * sideGain;
      wetR = mid - side * sideGain;

      // Soft limit wet signal before mix — prevents feedback explosion
      wetL = Math.tanh(wetL * 0.8) * 1.1;
      wetR = Math.tanh(wetR * 0.8) * 1.1;

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

    // Track freeze energy level for visual
    let freezeEnergy = 0;
    if (freeze) {
      for (let i = 0; i < 6; i++) {
        for (let s = 0; s < 64; s++) {
          const idx = (this.apPosL[i] - s - 1 + this.maxApLen) % this.maxApLen;
          freezeEnergy += this.apBufL[i][idx] * this.apBufL[i][idx];
        }
      }
      freezeEnergy = Math.sqrt(freezeEnergy / 384);
    }

    this._peak = peakAccum;
    this._freezeLevel = freezeEnergy;
    this.port.postMessage({ peak: peakAccum, frozen: freeze, freezeLevel: freezeEnergy });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', FreezeFieldProcessor);
`;

export async function createFreezeFieldEngine(audioCtx) {
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

  let _peak = 0, _frozen = false, _freezeLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.frozen !== undefined) _frozen = e.data.frozen;
    if (e.data?.freezeLevel !== undefined) _freezeLevel = e.data.freezeLevel;
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
    setFreeze: v => { p('freeze').value = v; },
    setSmear: v => { p('smear').value = v; },
    setDrift: v => { p('drift').value = v; },
    setShape: v => { p('shape').value = v; },
    setWidth: v => { p('width').value = v; },
    setMix: v => { p('mix').value = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak: () => { _peakIn = Math.max(getPeakAn(analyserIn), _peakIn * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getFrozen: () => _frozen,
    getFreezeLevel: () => _freezeLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
