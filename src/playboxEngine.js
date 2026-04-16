// playboxEngine.js — PLAYBOX: Creative FX That Just Works
//
// Multi-effect box with selectable chains, each controlled by simple macros.
//
// Chains:
//   0 FLANGE  — short delay with LFO + feedback
//   1 ECHO    — delay with feedback and LP on repeats
//   2 FILTER  — resonant LP filter sweep
//   3 WIDEN   — stereo micro-delay decorrelation
//   4 CRUSH   — bitcrush + sample rate reduction
//
// Controls:
//   CHAIN     — selects effect chain (0-4 mapped 0-1)
//   INTENSITY — main macro controlling chain depth
//   SPEED     — rate/time control
//   COLOR     — tone/character control
//   MIX       — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'playbox-v1';

const PROCESSOR_CODE = `
class PlayboxProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'chain',     defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'intensity', defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'speed',     defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'color',     defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mix',       defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'bypass',    defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Delay buffer — max ~0.6s for echo chain
    this.maxDelaySamples = Math.ceil(this.sr * 0.6);
    this.bufL = new Float32Array(this.maxDelaySamples + 4);
    this.bufR = new Float32Array(this.maxDelaySamples + 4);
    this.writePos = 0;

    // LFO phase (0..1)
    this.lfoPhase = 0;

    // Feedback state
    this.fbL = 0;
    this.fbR = 0;

    // Filter state (resonant LP for FILTER chain)
    this.filtLpL = 0; this.filtLpR = 0;
    this.filtBpL = 0; this.filtBpR = 0;

    // Color filter state (LP on echo repeats / crush output)
    this.colorLpL = 0;
    this.colorLpR = 0;

    // Crush state
    this.crushHoldL = 0;
    this.crushHoldR = 0;
    this.crushCounter = 0;

    // Metering
    this._peakOut = 0;

    this.port.postMessage({ ready: true });
  }

  // Hermite interpolation for smooth delay reads
  hermite(buf, pos, size) {
    let p = pos;
    while (p < 0) p += size;
    const i = Math.floor(p) % size;
    const f = p - Math.floor(p);

    const xm1 = buf[(i - 1 + size) % size];
    const x0  = buf[i];
    const x1  = buf[(i + 1) % size];
    const x2  = buf[(i + 2) % size];

    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);

    return ((c3 * f + c2) * f + c1) * f + c0;
  }

  // Chain selection: 0=FLANGE, 1=ECHO, 2=FILTER, 3=WIDEN, 4=CRUSH
  getChain(v) {
    if (v < 0.2) return 0;
    if (v < 0.4) return 1;
    if (v < 0.6) return 2;
    if (v < 0.8) return 3;
    return 4;
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const chain     = this.getChain(params.chain[0]);
    const intensity = params.intensity[0];
    const speed     = params.speed[0];
    const color     = params.color[0];
    const mix       = params.mix[0];
    const bypass    = params.bypass[0] > 0.5;

    const sr = this.sr;
    const bs = this.maxDelaySamples;

    let peakAccum = 0;

    // ── True passthrough ──
    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      // Reset DSP state
      this.fbL = 0; this.fbR = 0;
      this.filtLpL = 0; this.filtLpR = 0;
      this.filtBpL = 0; this.filtBpR = 0;
      this.colorLpL = 0; this.colorLpR = 0;
      this.crushHoldL = 0; this.crushHoldR = 0;
      this.crushCounter = 0;
      this.bufL.fill(0); this.bufR.fill(0);
      // Keep LFO running
      const lfoRate = 0.1 + speed * 8;
      this.lfoPhase += (lfoRate / sr) * iL.length;
      while (this.lfoPhase >= 1) this.lfoPhase -= 1;

      this._peakOut = peakAccum;
      this.port.postMessage({ peak: this._peakOut });
      return true;
    }

    // ── Process per chain ──
    if (chain === 0) {
      // ════════════════════════════════════════════════════════════════════
      // FLANGE: short delay (1-8ms) with LFO + feedback
      // intensity = depth + feedback, speed = LFO rate, color = feedback tone
      // ════════════════════════════════════════════════════════════════════
      const lfoRate = 0.1 + speed * 5; // 0.1..5.1 Hz
      const lfoInc = lfoRate / sr;
      const fbAmount = intensity * 0.88;
      const depthMs = 1 + intensity * 7; // 1..8ms sweep range
      const centerMs = 2 + (1 - intensity) * 3; // center point

      // Color filter coeff for feedback tone
      const colorFreq = 600 * Math.pow(25, color);
      const colorCoef = Math.exp(-2 * Math.PI * colorFreq / sr);

      for (let n = 0; n < iL.length; n++) {
        const dryL = iL[n], dryR = iR[n];

        // LFO — triangle
        let lfo = this.lfoPhase < 0.5 ? this.lfoPhase * 4 - 1 : 3 - this.lfoPhase * 4;
        lfo = 1.5 * lfo - 0.5 * lfo * lfo * lfo; // soften peaks

        const delayMs = Math.max(0.1, centerMs + lfo * depthMs * 0.5);
        const delaySamp = Math.min(delayMs * sr / 1000, bs - 2);

        // Color filter on feedback
        this.colorLpL = colorCoef * this.colorLpL + (1 - colorCoef) * this.fbL;
        this.colorLpR = colorCoef * this.colorLpR + (1 - colorCoef) * this.fbR;
        const filtFbL = color < 0.5 ? this.colorLpL : this.fbL + (this.fbL - this.colorLpL) * (color - 0.5) * 2;
        const filtFbR = color < 0.5 ? this.colorLpR : this.fbR + (this.fbR - this.colorLpR) * (color - 0.5) * 2;

        // Write with feedback
        this.bufL[this.writePos] = dryL + Math.tanh(filtFbL * 1.2) * fbAmount;
        this.bufR[this.writePos] = dryR + Math.tanh(filtFbR * 1.2) * fbAmount;

        // Read with Hermite
        const readPos = this.writePos - delaySamp;
        const wetL = this.hermite(this.bufL, readPos, bs);
        const wetR = this.hermite(this.bufR, readPos, bs);

        this.fbL = wetL;
        this.fbR = wetR;

        const finalL = dryL * (1 - mix) + wetL * mix;
        const finalR = dryR * (1 - mix) + wetR * mix;
        oL[n] = finalL;
        oR[n] = finalR;

        const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
        if (ap > peakAccum) peakAccum = ap;

        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= 1;
        this.writePos = (this.writePos + 1) % bs;
      }

    } else if (chain === 1) {
      // ════════════════════════════════════════════════════════════════════
      // ECHO: delay (100-500ms) with feedback
      // intensity = feedback amount, speed = delay time, color = LP on repeats
      // ════════════════════════════════════════════════════════════════════
      const delayMs = 100 + speed * 400; // 100..500ms
      const delaySamp = Math.min(delayMs * sr / 1000, bs - 2);
      const fbAmount = intensity * 0.82;

      // Color LP on repeats
      const lpFreq = 800 + color * 14000; // 800..14800 Hz
      const lpCoef = Math.exp(-2 * Math.PI * lpFreq / sr);

      for (let n = 0; n < iL.length; n++) {
        const dryL = iL[n], dryR = iR[n];

        // LP filter on feedback
        this.colorLpL = lpCoef * this.colorLpL + (1 - lpCoef) * this.fbL;
        this.colorLpR = lpCoef * this.colorLpR + (1 - lpCoef) * this.fbR;

        // Write with filtered feedback
        this.bufL[this.writePos] = dryL + this.colorLpL * fbAmount;
        this.bufR[this.writePos] = dryR + this.colorLpR * fbAmount;

        // Read
        const readPos = this.writePos - delaySamp;
        const wetL = this.hermite(this.bufL, readPos, bs);
        const wetR = this.hermite(this.bufR, readPos, bs);

        this.fbL = wetL;
        this.fbR = wetR;

        const finalL = dryL * (1 - mix) + wetL * mix;
        const finalR = dryR * (1 - mix) + wetR * mix;
        oL[n] = finalL;
        oR[n] = finalR;

        const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
        if (ap > peakAccum) peakAccum = ap;

        this.writePos = (this.writePos + 1) % bs;
      }

    } else if (chain === 2) {
      // ════════════════════════════════════════════════════════════════════
      // FILTER: resonant LP filter sweep
      // intensity = resonance, speed = LFO rate, color = base frequency
      // ════════════════════════════════════════════════════════════════════
      const lfoRate = 0.05 + speed * 6; // 0.05..6 Hz
      const lfoInc = lfoRate / sr;
      const reso = 0.3 + intensity * 3.5; // Q: 0.3..3.8
      const baseFreq = 120 + color * 4000; // 120..4120 Hz base

      for (let n = 0; n < iL.length; n++) {
        const dryL = iL[n], dryR = iR[n];

        // LFO — sine
        const lfo = Math.sin(2 * Math.PI * this.lfoPhase);

        // Sweep cutoff: base +/- sweep range
        const sweepRange = 2000 + intensity * 6000;
        const cutoff = Math.max(40, Math.min(sr * 0.45, baseFreq + lfo * sweepRange));

        // SVF coefficients
        const f = 2 * Math.sin(Math.PI * cutoff / sr);
        const q = 1 / reso;

        // Left channel SVF
        this.filtLpL += f * this.filtBpL;
        const hpL = dryL - this.filtLpL - q * this.filtBpL;
        this.filtBpL += f * hpL;

        // Right channel SVF
        this.filtLpR += f * this.filtBpR;
        const hpR = dryR - this.filtLpR - q * this.filtBpR;
        this.filtBpR += f * hpR;

        // Soft clip to prevent resonance runaway
        this.filtBpL = Math.tanh(this.filtBpL);
        this.filtBpR = Math.tanh(this.filtBpR);

        const wetL = this.filtLpL;
        const wetR = this.filtLpR;

        const finalL = dryL * (1 - mix) + wetL * mix;
        const finalR = dryR * (1 - mix) + wetR * mix;
        oL[n] = finalL;
        oR[n] = finalR;

        const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
        if (ap > peakAccum) peakAccum = ap;

        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= 1;
      }

    } else if (chain === 3) {
      // ════════════════════════════════════════════════════════════════════
      // WIDEN: stereo micro-delay decorrelation
      // intensity = delay amount, speed = modulation, color = tone
      // ════════════════════════════════════════════════════════════════════
      const maxDelayMs = 1 + intensity * 25; // 1..26ms
      const lfoRate = 0.2 + speed * 3; // 0.2..3.2 Hz modulation
      const lfoInc = lfoRate / sr;

      // Color LP
      const toneFreq = 1000 + color * 18000;
      const toneCoef = Math.exp(-2 * Math.PI * toneFreq / sr);

      for (let n = 0; n < iL.length; n++) {
        const dryL = iL[n], dryR = iR[n];

        // LFO — different phase per channel for stereo
        const lfoL = Math.sin(2 * Math.PI * this.lfoPhase);
        const lfoR = Math.sin(2 * Math.PI * this.lfoPhase + Math.PI * 0.6);

        const delMsL = Math.max(0.05, maxDelayMs * 0.5 + lfoL * maxDelayMs * 0.3);
        const delMsR = Math.max(0.05, maxDelayMs * 0.7 + lfoR * maxDelayMs * 0.3);
        const delSampL = Math.min(delMsL * sr / 1000, bs - 2);
        const delSampR = Math.min(delMsR * sr / 1000, bs - 2);

        // Write
        this.bufL[this.writePos] = dryL;
        this.bufR[this.writePos] = dryR;

        // Read with Hermite
        const wL = this.hermite(this.bufL, this.writePos - delSampL, bs);
        const wR = this.hermite(this.bufR, this.writePos - delSampR, bs);

        // Tone filter
        this.colorLpL = toneCoef * this.colorLpL + (1 - toneCoef) * wL;
        this.colorLpR = toneCoef * this.colorLpR + (1 - toneCoef) * wR;
        const wetL = color < 0.5 ? this.colorLpL : wL;
        const wetR = color < 0.5 ? this.colorLpR : wR;

        const finalL = dryL * (1 - mix) + wetL * mix;
        const finalR = dryR * (1 - mix) + wetR * mix;
        oL[n] = finalL;
        oR[n] = finalR;

        const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
        if (ap > peakAccum) peakAccum = ap;

        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= 1;
        this.writePos = (this.writePos + 1) % bs;
      }

    } else {
      // ════════════════════════════════════════════════════════════════════
      // CRUSH: bitcrush + sample rate reduction
      // intensity = crush amount, speed = sample rate reduction, color = LP filter
      // ════════════════════════════════════════════════════════════════════
      // Bit depth: 16 down to 2 bits
      const bits = Math.max(2, Math.round(16 - intensity * 14));
      const levels = Math.pow(2, bits);

      // Sample rate reduction: 1x down to 1/40x
      const srReduce = Math.max(1, Math.round(1 + speed * 39));

      // Color LP
      const lpFreq = 1000 + color * 18000;
      const lpCoef = Math.exp(-2 * Math.PI * lpFreq / sr);

      for (let n = 0; n < iL.length; n++) {
        const dryL = iL[n], dryR = iR[n];

        // Sample rate reduction
        this.crushCounter++;
        if (this.crushCounter >= srReduce) {
          this.crushCounter = 0;
          // Bit crush
          this.crushHoldL = Math.round(dryL * levels) / levels;
          this.crushHoldR = Math.round(dryR * levels) / levels;
        }

        let wetL = this.crushHoldL;
        let wetR = this.crushHoldR;

        // Color LP filter
        this.colorLpL = lpCoef * this.colorLpL + (1 - lpCoef) * wetL;
        this.colorLpR = lpCoef * this.colorLpR + (1 - lpCoef) * wetR;
        wetL = color < 0.7 ? this.colorLpL : wetL * (1 - (color - 0.7) * 1.5) + this.colorLpL * ((color - 0.7) * 1.5);
        wetR = color < 0.7 ? this.colorLpR : wetR * (1 - (color - 0.7) * 1.5) + this.colorLpR * ((color - 0.7) * 1.5);

        const finalL = dryL * (1 - mix) + wetL * mix;
        const finalR = dryR * (1 - mix) + wetR * mix;
        oL[n] = finalL;
        oR[n] = finalR;

        const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
        if (ap > peakAccum) peakAccum = ap;
      }
    }

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: this._peakOut });

    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', PlayboxProcessor);
`;

export async function createPlayboxEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const inputTrim  = audioCtx.createGain();
  const outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  // Chain: input -> inputTrim -> analyserIn -> worklet -> analyserOut -> outputTrim -> output/chainOutput
  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
  };

  const _buf = new Float32Array(2048);

  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0;
    for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) {
      const a = Math.abs(_buf[i]); if (a > m) m = a;
    }
    return m;
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,

    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setChain:     v => { p('chain').value     = v; },
    setIntensity: v => { p('intensity').value = v; },
    setSpeed:     v => { p('speed').value     = v; },
    setColor:     v => { p('color').value     = v; },
    setMix:       v => { p('mix').value       = v; },
    setBypass:    v => { p('bypass').value    = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,

    destroy() {
      worklet.disconnect();
      input.disconnect();
      inputTrim.disconnect();
      output.disconnect();
      outputTrim.disconnect();
      chainOutput.disconnect();
      analyserIn.disconnect();
      analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
