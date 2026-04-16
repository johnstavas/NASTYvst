// transientReverbEngine.js — TRANSIENT REVERB: Punch-Safe Reverb
//
// Protects transients by ducking early reflections during attacks,
// then letting the tail bloom back. Schroeder reverb core.
//
// Controls:
//   PROTECT     — transient protection amount
//   TAIL        — tail reverb level
//   ATTACKCLEAR — how aggressively early reflections are gated during transients
//   SIZE        — reverb size (scales delay lengths)
//   TONE        — post-reverb tilt EQ
//   MIX         — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'transientreverb-v1';

const PROCESSOR_CODE = `
class TransientReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'protect',     defaultValue: 0.6, minValue: 0, maxValue: 1 },
      { name: 'tail',        defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'attackClear', defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'size',        defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'tone',        defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mix',         defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'bypass',      defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'smooth',      defaultValue: 0,   minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const scale = this.sr / 44100;

    // NESTED ALLPASS CHAINS — 3 chains, each with an inner allpass nested inside
    // This creates a dense, smooth reverb fundamentally different from parallel combs
    // Outer allpass lengths (long)
    this.outerApLens = [
      Math.round(1117 * scale),
      Math.round(1481 * scale),
      Math.round(1789 * scale),
    ];
    this.maxOuterLen = Math.round(4000 * scale);
    // Inner allpass lengths (short, nested inside outer)
    this.innerApLens = [
      Math.round(379 * scale),
      Math.round(509 * scale),
      Math.round(631 * scale),
    ];
    this.maxInnerLen = Math.round(1400 * scale);

    // Outer allpass buffers
    this.outerBufL = []; this.outerBufR = [];
    this.outerIdxL = []; this.outerIdxR = [];
    this.outerDampL = []; this.outerDampR = [];
    for (let i = 0; i < 3; i++) {
      this.outerBufL.push(new Float32Array(this.maxOuterLen));
      this.outerBufR.push(new Float32Array(this.maxOuterLen));
      this.outerIdxL.push(0);
      this.outerIdxR.push(0);
      this.outerDampL.push(0);
      this.outerDampR.push(0);
    }
    // Inner allpass buffers
    this.innerBufL = []; this.innerBufR = [];
    this.innerIdxL = []; this.innerIdxR = [];
    for (let i = 0; i < 3; i++) {
      this.innerBufL.push(new Float32Array(this.maxInnerLen));
      this.innerBufR.push(new Float32Array(this.maxInnerLen));
      this.innerIdxL.push(0);
      this.innerIdxR.push(0);
    }
    // Feedback around the chain
    this.chainFbL = 0;
    this.chainFbR = 0;

    // Early reflection buffer (for gating)
    this.erMaxLen = Math.ceil(this.sr * 0.06); // 60ms max
    this.erBufL = new Float32Array(this.erMaxLen);
    this.erBufR = new Float32Array(this.erMaxLen);
    this.erWritePos = 0;
    // ER taps (ms)
    this.erTaps = [2.1, 5.3, 8.7, 13.1, 18.9];
    this.erGains = [0.6, 0.45, 0.35, 0.25, 0.18];

    // Transient detector: fast and slow envelope followers
    this.envFast = 0;
    this.envSlow = 0;
    this.transientEnv = 0; // smoothed transient detection signal

    // Bloom envelope: after transient passes, reverb blooms back
    this.bloomEnv = 1;

    // Tilt EQ state
    this.tiltLpL = 0;
    this.tiltLpR = 0;

    this._peak = 0;
    this._transientAmount = 0;
    this._bloomAmount = 1;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const protect = params.protect[0];
    const tail = params.tail[0];
    const attackClear = params.attackClear[0];
    const size = params.size[0];
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
      this.port.postMessage({ peak: peakAccum, transient: 0, bloom: 1 });
      return true;
    }

    // Transient detector coefficients
    const fastAttackCoeff = Math.exp(-1 / (sr * 0.0001)); // 0.1ms
    const fastReleaseCoeff = Math.exp(-1 / (sr * 0.03));  // 30ms
    const slowAttackCoeff = Math.exp(-1 / (sr * 0.005));   // 5ms
    const slowReleaseCoeff = Math.exp(-1 / (sr * 0.1));    // 100ms

    // Size-scaled nested allpass lengths — wider range
    const sizeScale = 0.5 + size * 2.0; // 0.5x to 2.5x
    const outerLens = this.outerApLens.map(l => Math.min(Math.round(l * sizeScale), this.maxOuterLen - 1));
    const innerLens = this.innerApLens.map(l => Math.min(Math.round(l * sizeScale), this.maxInnerLen - 1));

    // Allpass coefficients — more dramatic with size
    const outerG = 0.55 + size * 0.2;
    const innerG = 0.45 + size * 0.15;
    // Chain feedback
    const chainFb = Math.min(0.90, 0.72 + size * 0.15 + tail * 0.03);
    // Damping — wider tone range
    const dampFreq = 2000 + tone * 14000;
    const dampCoeff = Math.exp(-2 * Math.PI * dampFreq / sr);

    // Tilt EQ — more dramatic range
    const tiltCrossover = Math.exp(-2 * Math.PI * 1500 / sr);
    const tiltGain = (tone - 0.5) * 2;
    const tiltScale = 1.5;

    // Bloom recovery speed: 20-50ms window
    const bloomRecoverRate = 1 / (sr * (0.02 + (1 - attackClear) * 0.03));
    // Transient detection smoothing
    const transientSmooth = Math.exp(-1 / (sr * 0.003));

    let transientAccum = 0;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;
      const monoAbs = Math.abs(mono);

      // Fast/slow envelope followers
      if (monoAbs > this.envFast) {
        this.envFast = fastAttackCoeff * this.envFast + (1 - fastAttackCoeff) * monoAbs;
      } else {
        this.envFast = fastReleaseCoeff * this.envFast;
      }
      if (monoAbs > this.envSlow) {
        this.envSlow = slowAttackCoeff * this.envSlow + (1 - slowAttackCoeff) * monoAbs;
      } else {
        this.envSlow = slowReleaseCoeff * this.envSlow;
      }

      // Transient detection
      const rawTransient = Math.max(0, this.envFast - this.envSlow * 1.1);
      this.transientEnv = transientSmooth * this.transientEnv + (1 - transientSmooth) * rawTransient;
      const isTransient = this.transientEnv * protect * 10;
      transientAccum += this.transientEnv;

      // Bloom envelope: dips during transient, recovers after
      if (isTransient > 0.1) {
        // Duck the bloom
        const duckAmount = Math.min(1, isTransient * attackClear * 3);
        this.bloomEnv = Math.max(0, this.bloomEnv - duckAmount * 0.3);
      } else {
        // Recover
        this.bloomEnv = Math.min(1, this.bloomEnv + bloomRecoverRate);
      }

      // Write to early reflection buffer
      this.erBufL[this.erWritePos] = dryL;
      this.erBufR[this.erWritePos] = dryR;

      // Early reflections with transient gating
      let erL = 0, erR = 0;
      const erGate = 1 - Math.min(1, isTransient * attackClear * 2);
      for (let t = 0; t < 5; t++) {
        const delaySamples = Math.min(Math.floor(this.erTaps[t] * sr / 1000 * sizeScale), this.erMaxLen - 1);
        const readIdx = (this.erWritePos - delaySamples + this.erMaxLen) % this.erMaxLen;
        const g = this.erGains[t] * erGate;
        erL += this.erBufL[readIdx] * g;
        erR += this.erBufR[readIdx] * g;
      }
      this.erWritePos = (this.erWritePos + 1) % this.erMaxLen;

      // Tail reverb: 3 NESTED ALLPASS CHAINS in series with feedback
      // Input to chain: dry + feedback from previous iteration
      let chainInL = dryL * 0.5 + this.chainFbL * chainFb;
      let chainInR = dryR * 0.5 + this.chainFbR * chainFb;
      chainInL = Math.tanh(chainInL);
      chainInR = Math.tanh(chainInR);

      let tailL = 0, tailR = 0;

      for (let c = 0; c < 3; c++) {
        // INNER allpass first (short delay inside the outer feedback path)
        const iLen = innerLens[c];
        const iIdxL = this.innerIdxL[c];
        const iIdxR = this.innerIdxR[c];
        const iReadL = (iIdxL - iLen + this.maxInnerLen * 2) % this.maxInnerLen;
        const iReadR = (iIdxR - iLen + this.maxInnerLen * 2) % this.maxInnerLen;
        const iDelL = this.innerBufL[c][iReadL];
        const iDelR = this.innerBufR[c][iReadR];
        const iOutL = -innerG * chainInL + iDelL;
        const iOutR = -innerG * chainInR + iDelR;
        this.innerBufL[c][iIdxL] = chainInL + innerG * iDelL;
        this.innerBufR[c][iIdxR] = chainInR + innerG * iDelR;
        this.innerIdxL[c] = (iIdxL + 1) % this.maxInnerLen;
        this.innerIdxR[c] = (iIdxR + 1) % this.maxInnerLen;

        // OUTER allpass (long delay, wraps around inner result)
        const oLen = outerLens[c];
        const oIdxL = this.outerIdxL[c];
        const oIdxR = this.outerIdxR[c];
        const oReadL = (oIdxL - oLen + this.maxOuterLen * 2) % this.maxOuterLen;
        const oReadR = (oIdxR - oLen + this.maxOuterLen * 2) % this.maxOuterLen;
        const oDelL = this.outerBufL[c][oReadL];
        const oDelR = this.outerBufR[c][oReadR];
        const oOutL = -outerG * iOutL + oDelL;
        const oOutR = -outerG * iOutR + oDelR;

        // Damping in the outer write path
        this.outerDampL[c] = dampCoeff * this.outerDampL[c] + (1 - dampCoeff) * (iOutL + outerG * oDelL);
        this.outerDampR[c] = dampCoeff * this.outerDampR[c] + (1 - dampCoeff) * (iOutR + outerG * oDelR);
        this.outerBufL[c][oIdxL] = this.outerDampL[c];
        this.outerBufR[c][oIdxR] = this.outerDampR[c];
        this.outerIdxL[c] = (oIdxL + 1) % this.maxOuterLen;
        this.outerIdxR[c] = (oIdxR + 1) % this.maxOuterLen;

        // Feed output to next chain stage
        chainInL = oOutL;
        chainInR = oOutR;

        // Tap each stage for output
        tailL += oOutL * (0.35 - c * 0.04);
        tailR += oOutR * (0.35 - c * 0.04);
      }

      // Store feedback for next sample
      this.chainFbL = chainInL;
      this.chainFbR = chainInR;

      // Apply bloom envelope to tail (transient protection)
      tailL *= this.bloomEnv * tail;
      tailR *= this.bloomEnv * tail;

      // Combine ER + tail
      let wetL = erL + tailL;
      let wetR = erR + tailR;

      // Tilt EQ
      this.tiltLpL = tiltCrossover * this.tiltLpL + (1 - tiltCrossover) * wetL;
      this.tiltLpR = tiltCrossover * this.tiltLpR + (1 - tiltCrossover) * wetR;
      const hpL = wetL - this.tiltLpL;
      const hpR = wetR - this.tiltLpR;
      if (tiltGain > 0) {
        wetL = this.tiltLpL + hpL * (1 + tiltGain * tiltScale);
        wetR = this.tiltLpR + hpR * (1 + tiltGain * tiltScale);
      } else {
        wetL = this.tiltLpL * (1 - tiltGain * 1.5) + hpL;
        wetR = this.tiltLpR * (1 - tiltGain * 1.5) + hpR;
      }

      // Soft-clip wet signal to prevent distortion
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
    this._transientAmount = transientAccum / iL.length;
    this._bloomAmount = this.bloomEnv;
    this.port.postMessage({ peak: peakAccum, transient: this._transientAmount, bloom: this._bloomAmount });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', TransientReverbProcessor);
`;

export async function createTransientReverbEngine(audioCtx) {
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

  let _peak = 0, _transient = 0, _bloom = 1;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.transient !== undefined) _transient = e.data.transient;
    if (e.data?.bloom !== undefined) _bloom = e.data.bloom;
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
    setProtect: v => { p('protect').value = v; },
    setTail: v => { p('tail').value = v; },
    setAttackClear: v => { p('attackClear').value = v; },
    setSize: v => { p('size').value = v; },
    setTone: v => { p('tone').value = v; },
    setMix: v => { p('mix').value = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak: () => { _peakIn = Math.max(getPeakAn(analyserIn), _peakIn * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getTransient: () => _transient,
    getBloom: () => _bloom,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
