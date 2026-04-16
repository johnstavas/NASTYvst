// smearEngine.js — SMEAR: Dream/Lo-Fi Unstable Reverb
//
// Blur reality with dense, overlapping reflections that smear together.
// 4 parallel comb filters with crossfeed, slow random-walk pitch drift,
// bit-depth degradation, noise injection, and tilt EQ.
//
// Controls:
//   SMEAR   — comb feedback + crossfeed density (0-1)
//   DRIFT   — pitch instability / warble depth (0-1)
//   DEGRADE — bit crush + noise + LP aging (0-1)
//   SIZE    — comb delay length scaling (0-1)
//   TONE    — tilt EQ dark-bright (0-1)
//   MIX     — dry/wet (0-1)
//   BYPASS

const PROCESSOR_VERSION = 'smear-v1';

const PROCESSOR_CODE = `
class SmearProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'smear',   defaultValue: 0.4,  minValue: 0, maxValue: 1 },
      { name: 'drift',   defaultValue: 0.2,  minValue: 0, maxValue: 1 },
      { name: 'degrade', defaultValue: 0.15, minValue: 0, maxValue: 1 },
      { name: 'size',    defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.45, minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth',  defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Base comb delay lengths at 44.1k, scaled by actual sample rate
    const scale = this.sr / 44100;
    this.combLens = [
      Math.round(1091 * scale),
      Math.round(1327 * scale),
      Math.round(1559 * scale),
      Math.round(1733 * scale),
    ];

    // Allocate comb buffers (L+R per comb)
    this.combBufL = [];
    this.combBufR = [];
    this.combPos  = [];
    this.combLpL  = [0, 0, 0, 0];
    this.combLpR  = [0, 0, 0, 0];

    const maxLen = Math.round(2400 * scale) + 64;
    for (let i = 0; i < 4; i++) {
      this.combBufL.push(new Float32Array(maxLen));
      this.combBufR.push(new Float32Array(maxLen));
      this.combPos.push(0);
    }

    // Drift LFOs — slow random walk per comb
    this.driftPhase = [0, 0.25, 0.5, 0.75];
    this.driftRate  = [0.08, 0.073, 0.061, 0.091];
    this.driftWalk  = [0, 0, 0, 0];
    this.driftTarget = [0, 0, 0, 0];
    this.driftCounter = [0, 0, 0, 0];

    // Output tilt EQ state
    this.tiltLpL = 0; this.tiltLpR = 0;
    this.tiltHpL = 0; this.tiltHpR = 0;

    // Metering
    this._peak = 0;
    this._smearLevel = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  hermite(buf, pos, size) {
    let p = pos; while (p < 0) p += size;
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

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const smear   = params.smear[0];
    const drift   = params.drift[0];
    const degrade = params.degrade[0];
    const size    = params.size[0];
    const tone    = params.tone[0];
    const mix     = params.mix[0];
    const bypass  = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;
    let smearAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._smearLevel = 0;
      this.port.postMessage({ peak: peakAccum, smearLevel: 0 });
      return true;
    }

    // Comb feedback: 0.6 to 0.97 based on smear
    const baseFb = 0.6 + smear * 0.28;
    // Crossfeed amount
    const crossfeed = smear * 0.10;
    // Size scaling: 0.6x to 1.5x base delay lengths
    const sizeScale = 0.6 + size * 0.9;
    // LP damping cutoff in comb feedback path
    const dampFreq = 2000 + (1 - smear * 0.5) * 8000;
    const dampCoef = Math.exp(-2 * Math.PI * dampFreq / sr);
    // Drift modulation depth (in samples)
    const driftDepth = drift * 12;
    // Degrade: bit levels, noise, LP
    const bitLevels = degrade > 0.01 ? Math.max(8, Math.floor(256 * (1 - degrade * 0.9))) : 0;
    const noiseAmt = degrade * 0.015;
    const degradeLpFreq = 16000 - degrade * 12000;
    const degradeLpCoef = Math.exp(-2 * Math.PI * degradeLpFreq / sr);
    // Tilt EQ coefficients
    const tiltFreq = 800;
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);
    const tiltGainLow = 1 + (0.5 - tone) * 1.6;
    const tiltGainHigh = 1 + (tone - 0.5) * 1.6;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];
      let wetL = 0, wetR = 0;

      // Previous comb outputs for crossfeed
      const prevOutL = [0, 0, 0, 0];
      const prevOutR = [0, 0, 0, 0];

      // Process 4 parallel comb filters
      for (let c = 0; c < 4; c++) {
        const baseLen = Math.round(this.combLens[c] * sizeScale);
        const bufSize = this.combBufL[c].length;

        // Update drift random walk
        this.driftPhase[c] += this.driftRate[c] / sr;
        if (this.driftPhase[c] > 1) this.driftPhase[c] -= 1;
        this.driftCounter[c]++;
        if (this.driftCounter[c] > sr * 0.3) {
          this.driftCounter[c] = 0;
          this.driftTarget[c] = (Math.random() * 2 - 1);
        }
        this.driftWalk[c] += (this.driftTarget[c] - this.driftWalk[c]) * 0.0001;
        const lfoVal = Math.sin(2 * Math.PI * this.driftPhase[c]) * 0.7 + this.driftWalk[c] * 0.3;
        const modOffset = lfoVal * driftDepth;

        // Read from comb with modulated position
        const readPos = this.combPos[c] - baseLen + modOffset;
        let cOutL = this.hermite(this.combBufL[c], readPos, bufSize);
        let cOutR = this.hermite(this.combBufR[c], readPos, bufSize);

        // LP damping in feedback
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * cOutL;
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * cOutR;
        cOutL = this.combLpL[c];
        cOutR = this.combLpR[c];

        prevOutL[c] = cOutL;
        prevOutR[c] = cOutR;

        // Write to comb: input + feedback + crossfeed from previous comb
        const prevC = (c + 3) % 4; // previous comb
        const xfL = c > 0 ? prevOutL[prevC] * crossfeed : 0;
        const xfR = c > 0 ? prevOutR[prevC] * crossfeed : 0;
        this.combBufL[c][this.combPos[c]] = dryL + cOutL * baseFb + xfL;
        this.combBufR[c][this.combPos[c]] = dryR + cOutR * baseFb + xfR;

        this.combPos[c] = (this.combPos[c] + 1) % bufSize;

        wetL += cOutL;
        wetR += cOutR;
      }

      // Normalize comb sum
      wetL *= 0.25;
      wetR *= 0.25;

      // Degrade layer
      if (degrade > 0.01) {
        // Bit reduction
        if (bitLevels > 0) {
          wetL = Math.round(wetL * bitLevels) / bitLevels;
          wetR = Math.round(wetR * bitLevels) / bitLevels;
        }
        // Noise injection
        wetL += (Math.random() * 2 - 1) * noiseAmt;
        wetR += (Math.random() * 2 - 1) * noiseAmt;
        // LP aging (applied in-place via simple 1-pole)
        this.tiltLpL = degradeLpCoef * this.tiltLpL + (1 - degradeLpCoef) * wetL;
        this.tiltLpR = degradeLpCoef * this.tiltLpR + (1 - degradeLpCoef) * wetR;
        wetL = wetL * (1 - degrade * 0.5) + this.tiltLpL * degrade * 0.5;
        wetR = wetR * (1 - degrade * 0.5) + this.tiltLpR * degrade * 0.5;
      }

      // Tilt EQ post
      this.tiltHpL = tiltCoef * this.tiltHpL + (1 - tiltCoef) * wetL;
      this.tiltHpR = tiltCoef * this.tiltHpR + (1 - tiltCoef) * wetR;
      const lowL = this.tiltHpL, lowR = this.tiltHpR;
      const highL = wetL - lowL, highR = wetR - lowR;
      wetL = lowL * tiltGainLow + highL * tiltGainHigh;
      wetR = lowR * tiltGainLow + highR * tiltGainHigh;

      // Soft clip before smoothing
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

      const sl = Math.max(Math.abs(wetL), Math.abs(wetR));
      if (sl > smearAccum) smearAccum = sl;
      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._smearLevel = smearAccum;
    this.port.postMessage({ peak: peakAccum, smearLevel: smearAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', SmearProcessor);
`;

export async function createSmearEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
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

  let _peak = 0, _smearLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.smearLevel !== undefined) _smearLevel = e.data.smearLevel;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setSmear:   v => { p('smear').value   = v; },
    setDrift:   v => { p('drift').value   = v; },
    setDegrade: v => { p('degrade').value = v; },
    setSize:    v => { p('size').value    = v; },
    setTone:    v => { p('tone').value    = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },
    setSmooth:  v => { p('smooth').value  = v; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getSmearLevel: () => _smearLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
