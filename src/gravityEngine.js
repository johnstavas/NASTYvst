// gravityEngine.js — GRAVITY: Behavior-Based Reverb with Physical Rules
//
// Flagship reverb with:
//   - 8-tap early reflections with variable spacing (SPACE SIZE)
//   - 4x4 Feedback Delay Network using Hadamard matrix
//   - Bloom: time-varying modulation of FDN delay lengths
//   - Gravity: controls feedback distribution (dense/concentrated vs. floaty/spread)
//   - Color: tilt EQ (crossover ~1kHz)
//   - Stereo: mid-side width on output
//
// Controls:
//   SPACE   — room size (0-1)
//   GRAVITY — feedback concentration (0-1)
//   BLOOM   — modulation depth + decay (0-1)
//   DENSITY — early ref density (0-1)
//   COLOR   — dark-bright tilt (0-1)
//   WIDTH   — stereo width (0-1)
//   MIX     — dry/wet (0-1)
//   OUTPUT  — gain in dB mapped 0-1 => -18..+18dB
//   BYPASS

const PROCESSOR_VERSION = 'gravity-v4';

const PROCESSOR_CODE = `
class GravityProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'space',   defaultValue: 0.4,  minValue: 0, maxValue: 1 },
      { name: 'gravity', defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'bloom',   defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'density', defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'color',   defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'width',   defaultValue: 0.6,  minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'output',  defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth',  defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Early Reflections: 8 taps ──
    // Base tap times in ms (will be scaled by space size)
    this.erBaseTimes = [3.1, 7.3, 11.7, 17.9, 23.3, 31.1, 41.7, 53.9];
    this.erGains = [0.85, 0.72, 0.65, 0.55, 0.48, 0.38, 0.30, 0.22];
    // Alternating pan: -1, +1 for stereo spread
    this.erPan = [-0.6, 0.7, -0.4, 0.5, -0.8, 0.3, -0.2, 0.9];
    // ER buffer (shared, max 80ms)
    this.erMaxSamp = Math.ceil(this.sr * 0.08);
    this.erBufL = new Float32Array(this.erMaxSamp + 4);
    this.erBufR = new Float32Array(this.erMaxSamp + 4);
    this.erWritePos = 0;

    // ── FDN: 4x4 Feedback Delay Network — separate L/R for true stereo ──
    // Prime-number delay lengths (L channel)
    this.fdnBaseLengths  = [1031, 1327, 1559, 1877];
    // R channel uses slightly offset lengths — prime offsets create decorrelation
    // without audible comb filtering (~0.7–1ms offset at 44.1k)
    this.fdnBaseLengthsR = [1060, 1296, 1596, 1836];
    this.fdnMaxLen = Math.ceil(Math.max(...this.fdnBaseLengths) * 3) + 100;
    this.fdnBufsL = []; this.fdnBufsR = [];
    this.fdnPos   = [];
    this.fdnLpL   = [0, 0, 0, 0]; // damping LP state per line — L
    this.fdnLpR   = [0, 0, 0, 0]; // damping LP state per line — R
    for (let i = 0; i < 4; i++) {
      this.fdnBufsL.push(new Float32Array(this.fdnMaxLen));
      this.fdnBufsR.push(new Float32Array(this.fdnMaxLen));
      this.fdnPos.push(0);
    }

    // Hadamard mixing matrix (4x4, normalized)
    // H4 = 0.5 * [[1,1,1,1],[1,-1,1,-1],[1,1,-1,-1],[1,-1,-1,1]]
    this.hadamard = [
      [ 0.5,  0.5,  0.5,  0.5],
      [ 0.5, -0.5,  0.5, -0.5],
      [ 0.5,  0.5, -0.5, -0.5],
      [ 0.5, -0.5, -0.5,  0.5],
    ];

    // ── Bloom LFO phases (one per FDN line) ──
    this.bloomPhases = [0, 0.25, 0.5, 0.75];
    this.bloomRates = [0.13, 0.17, 0.23, 0.11]; // Hz

    // ── Color tilt EQ state ──
    this.tiltLpL = 0;
    this.tiltLpR = 0;

    // ── Metering ──
    this._peak = 0;
    this._reverbLevel = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const space   = params.space[0];
    const gravity = params.gravity[0];
    const bloom   = params.bloom[0];
    const density = params.density[0];
    const color   = params.color[0];
    const width   = params.width[0];
    const mix     = params.mix[0];
    const outRaw  = params.output[0];
    const bypass  = params.bypass[0] > 0.5;
    const outDb   = -18 + outRaw * 36;
    const outGain = Math.pow(10, outDb / 20);
    const sr      = this.sr;

    let peakAccum = 0;
    let reverbAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this._reverbLevel = 0;
      this.port.postMessage({ peak: peakAccum, reverbLevel: 0 });
      return true;
    }

    // ── Compute FDN delay lengths (scaled by space) — wider range ──
    const sizeScale = 0.3 + space * 3.2; // 0.3x to 3.5x
    const fdnLens  = this.fdnBaseLengths.map(b  => Math.min(this.fdnMaxLen - 2, Math.round(b * sizeScale)));
    const fdnLensR = this.fdnBaseLengthsR.map(b => Math.min(this.fdnMaxLen - 2, Math.round(b * sizeScale)));

    // ── Gravity => feedback gain. High gravity = shorter denser, low = longer floatier ──
    const baseFeedback = 0.35 + space * 0.55;
    const gravFactor = 1 - gravity * 0.6;
    const bloomFactor = 1 + bloom * 0.5;
    const feedbackGain = Math.min(0.92, baseFeedback * gravFactor * bloomFactor);

    // ── Damping frequency: lower = darker ──
    const dampFreq = 800 + color * 15000; // 0.8-15.8kHz — wider
    const dampCoef = Math.exp(-2 * Math.PI * dampFreq / sr);

    // ── Color tilt EQ coefficient (crossover ~1kHz) ──
    const tiltFreq = 1000;
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);
    const tiltGainLow = color < 0.5 ? 1 + (0.5 - color) * 1.5 : 1;
    const tiltGainHigh = color > 0.5 ? 1 + (color - 0.5) * 1.5 : 1;

    // ── ER gain scaling with density ──
    const erGainScale = 0.3 + density * 0.7;

    // ── Bloom modulation depth (in samples) ──
    const bloomDepth = bloom * 110; // ±110 samples — audible chorus/shimmer at bloom > 0.3

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;

      // ════════════════════════════════════════════════════
      // Stage 1: Early Reflections
      // ════════════════════════════════════════════════════
      this.erBufL[this.erWritePos] = dryL;
      this.erBufR[this.erWritePos] = dryR;

      let erL = 0, erR = 0;
      const erMax = this.erMaxSamp;
      for (let t = 0; t < 8; t++) {
        // Scale tap time by space, add density variation
        const tapMs = this.erBaseTimes[t] * (0.3 + space * 0.7) * (0.8 + density * 0.4);
        const tapSamp = Math.min(erMax - 2, Math.round(tapMs * sr / 1000));
        let readPos = this.erWritePos - tapSamp;
        while (readPos < 0) readPos += erMax;

        const tapL = this.erBufL[readPos % erMax];
        const tapR = this.erBufR[readPos % erMax];
        const g = this.erGains[t] * erGainScale;
        const pan = this.erPan[t];

        // Pan: -1=full left, +1=full right
        const panL = Math.cos((pan + 1) * 0.25 * Math.PI);
        const panR = Math.sin((pan + 1) * 0.25 * Math.PI);
        erL += tapL * g * panL + tapR * g * (1 - panR) * 0.3;
        erR += tapR * g * panR + tapL * g * (1 - panL) * 0.3;
      }
      this.erWritePos = (this.erWritePos + 1) % erMax;

      // ════════════════════════════════════════════════════
      // Stage 2: FDN Core (4x4 Hadamard)
      // ════════════════════════════════════════════════════

      // Read from FDN delay lines — L and R separately
      const fdnOutL = [0, 0, 0, 0];
      const fdnOutR = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const bloomMod = Math.sin(2 * Math.PI * this.bloomPhases[i]) * bloomDepth;

        // L channel
        const effLenL = Math.max(10, fdnLens[i]  + Math.round(bloomMod));
        let rpL = this.fdnPos[i] - effLenL;
        while (rpL < 0) rpL += this.fdnMaxLen;
        fdnOutL[i] = this.fdnBufsL[i][rpL % this.fdnMaxLen];
        this.fdnLpL[i] = dampCoef * this.fdnLpL[i] + (1 - dampCoef) * fdnOutL[i];
        fdnOutL[i] = this.fdnLpL[i];

        // R channel (offset lengths = decorrelated tail)
        const effLenR = Math.max(10, fdnLensR[i] + Math.round(bloomMod));
        let rpR = this.fdnPos[i] - effLenR;
        while (rpR < 0) rpR += this.fdnMaxLen;
        fdnOutR[i] = this.fdnBufsR[i][rpR % this.fdnMaxLen];
        this.fdnLpR[i] = dampCoef * this.fdnLpR[i] + (1 - dampCoef) * fdnOutR[i];
        fdnOutR[i] = this.fdnLpR[i];

        this.bloomPhases[i] += this.bloomRates[i] * (0.5 + bloom) / sr;
        if (this.bloomPhases[i] >= 1) this.bloomPhases[i] -= 1;
      }

      // Hadamard mix — L and R independently
      const fdnMixedL = [0, 0, 0, 0];
      const fdnMixedR = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          fdnMixedL[i] += this.hadamard[i][j] * fdnOutL[j];
          fdnMixedR[i] += this.hadamard[i][j] * fdnOutR[j];
        }
      }

      // Gravity: redistribute energy. High gravity concentrates into first lines
      const gravitySkew = gravity * 1.0;
      const fdnScaledL = [
        fdnMixedL[0] * (1 + gravitySkew),         fdnMixedL[1] * (1 + gravitySkew * 0.3),
        fdnMixedL[2] * (1 - gravitySkew * 0.3),   fdnMixedL[3] * (1 - gravitySkew),
      ];
      const fdnScaledR = [
        fdnMixedR[0] * (1 + gravitySkew),         fdnMixedR[1] * (1 + gravitySkew * 0.3),
        fdnMixedR[2] * (1 - gravitySkew * 0.3),   fdnMixedR[3] * (1 - gravitySkew),
      ];

      // Write back — L fed from dryL+erL, R fed from dryR+erR (true stereo injection)
      const injL = dryL * 0.4 + erL * 0.35;
      const injR = dryR * 0.4 + erR * 0.35;
      for (let i = 0; i < 4; i++) {
        this.fdnBufsL[i][this.fdnPos[i]] = Math.tanh((injL + fdnScaledL[i] * feedbackGain) * 0.8);
        this.fdnBufsR[i][this.fdnPos[i]] = Math.tanh((injR + fdnScaledR[i] * feedbackGain) * 0.8);
        this.fdnPos[i] = (this.fdnPos[i] + 1) % this.fdnMaxLen;
      }

      // Sum FDN — L and R are now genuinely different signals
      let fdnL = (fdnOutL[0] + fdnOutL[1] + fdnOutL[2] + fdnOutL[3]) * 0.25;
      let fdnR = (fdnOutR[0] + fdnOutR[1] + fdnOutR[2] + fdnOutR[3]) * 0.25;

      // ════════════════════════════════════════════════════
      // Stage 3: Combine ER + FDN
      // ════════════════════════════════════════════════════
      let wetL = erL * 0.5 + fdnL;
      let wetR = erR * 0.5 + fdnR;

      // ════════════════════════════════════════════════════
      // Stage 4: Color (Tilt EQ)
      // ════════════════════════════════════════════════════
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * wetL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * wetR;
      const lowL = this.tiltLpL;
      const lowR = this.tiltLpR;
      const highL = wetL - lowL;
      const highR = wetR - lowR;
      wetL = lowL * tiltGainLow + highL * tiltGainHigh;
      wetR = lowR * tiltGainLow + highR * tiltGainHigh;

      // ════════════════════════════════════════════════════
      // Stage 5: Stereo Width (mid-side)
      // ════════════════════════════════════════════════════
      const mid  = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5;
      const widthFactor = 0.3 + width * 1.7; // 0.3 to 2.0
      wetL = mid + side * widthFactor;
      wetR = mid - side * widthFactor;

      // Soft-clip wet signal to prevent distortion
      wetL = Math.tanh(wetL);
      wetR = Math.tanh(wetR);

      // Track reverb level
      const rvLvl = Math.abs(wetL) + Math.abs(wetR);
      reverbAccum += rvLvl;

      // ════════════════════════════════════════════════════
      // Smooth LP filter on wet signal
      // ════════════════════════════════════════════════════
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

      // ════════════════════════════════════════════════════
      // Output: mix + gain
      // ════════════════════════════════════════════════════
      const finalL = (dryL * (1 - mix) + wetL * mix) * outGain;
      const finalR = (dryR * (1 - mix) + wetR * mix) * outGain;

      oL[n] = finalL;
      oR[n] = finalR;

      const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._reverbLevel = reverbAccum / iL.length;
    this.port.postMessage({ peak: peakAccum, reverbLevel: this._reverbLevel });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', GravityProcessor);
`;

export async function createGravityEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();
  const inputTrim   = audioCtx.createGain();
  const outputTrim  = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1,
    outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0, _reverbLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.reverbLevel !== undefined) _reverbLevel = e.data.reverbLevel;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0; for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0; for (let i = 0; i < _buf.length; i++) { const a = Math.abs(_buf[i]); if (a > m) m = a; }
    return m;
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setSpace:      v => { p('space').value   = v; },
    setGravity:    v => { p('gravity').value = v; },
    setBloom:      v => { p('bloom').value   = v; },
    setDensity:    v => { p('density').value = v; },
    setColor:      v => { p('color').value   = v; },
    setWidth:      v => { p('width').value   = v; },
    setMix:        v => { p('mix').value     = v; },
    setOutput:     v => { p('output').value  = v; },
    setBypass:     v => { p('bypass').value  = v ? 1 : 0; },
    setSmooth:     v => { p('smooth').value  = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getReverbLevel: () => _reverbLevel,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
