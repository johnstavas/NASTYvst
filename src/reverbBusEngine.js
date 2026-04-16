// reverbBusEngine.js — REVERB BUS ENGINE: Bus-Friendly Reverb for Stems/Mix Glue
//
// Gentle room/plate hybrid with built-in reverb compression,
// harmonic saturation, dynamic tuck filtering, and stereo width.
//
// Controls:
//   SPACE  — reverb amount/size (0-1)
//   TUCK   — dynamic LP filter that follows input energy (0-1)
//   GLUE   — reverb compression ratio + threshold (0-1)
//   COLOR  — tilt EQ dark-warm-open (0-1)
//   WIDTH  — mid-side width on reverb only (0-1)
//   MIX    — dry/wet (0-1)
//   BYPASS

const PROCESSOR_VERSION = 'reverbbus-v1';

const PROCESSOR_CODE = `
class ReverbBusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'space',  defaultValue: 0.35, minValue: 0, maxValue: 1 },
      { name: 'tuck',   defaultValue: 0.4,  minValue: 0, maxValue: 1 },
      { name: 'glue',   defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'color',  defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'width',  defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 0.2,  minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth', defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const scale = this.sr / 44100;

    // 3 comb filters (shorter delays for room-like character)
    this.combLens = [
      Math.round(743 * scale),
      Math.round(929 * scale),
      Math.round(1103 * scale),
    ];
    this.combBufL = []; this.combBufR = [];
    this.combPos = [];
    this.combLpL = [0, 0, 0]; this.combLpR = [0, 0, 0];
    const maxComb = Math.round(1600 * scale) + 16;
    for (let i = 0; i < 3; i++) {
      this.combBufL.push(new Float32Array(maxComb));
      this.combBufR.push(new Float32Array(maxComb));
      this.combPos.push(0);
    }

    // 2 allpass filters
    this.apLens = [Math.round(241 * scale), Math.round(557 * scale)];
    this.apBufL = []; this.apBufR = [];
    this.apPos = [];
    const maxAp = Math.round(700 * scale) + 16;
    for (let i = 0; i < 2; i++) {
      this.apBufL.push(new Float32Array(maxAp));
      this.apBufR.push(new Float32Array(maxAp));
      this.apPos.push(0);
    }

    // Compressor state (on reverb output)
    this.compEnv = 0;

    // Input envelope for tuck
    this.tuckEnv = 0;
    this.tuckLpL = 0; this.tuckLpR = 0;

    // Tilt EQ state
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Metering
    this._peak = 0;
    this._grLevel = 0; // gain reduction in dB
    this._reverbLevel = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const space  = params.space[0];
    const tuck   = params.tuck[0];
    const glue   = params.glue[0];
    const color  = params.color[0];
    const width  = params.width[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;
    let reverbAccum = 0;
    let maxGr = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._grLevel = 0; this._reverbLevel = 0;
      this.port.postMessage({ peak: peakAccum, gr: 0, reverbLevel: 0 });
      return true;
    }

    // Comb feedback based on space
    const combFb = 0.65 + space * 0.25;
    const sizeScale = 0.8 + space * 0.4;

    // Damping
    const dampFreq = 3000 + color * 9000;
    const dampCoef = Math.exp(-2 * Math.PI * dampFreq / sr);
    const apCoef = 0.55;

    // Compressor parameters
    const threshLin = Math.pow(10, (-18 - glue * 12) / 20); // -18 to -30 dB
    const ratio = 2 + glue * 4; // 2:1 to 6:1
    const compAttack = Math.exp(-1 / (sr * 0.003));
    const compRelease = Math.exp(-1 / (sr * 0.08));
    const makeupGain = 1 + glue * 0.4;

    // Tuck: dynamic LP that follows input
    const tuckAttack = Math.exp(-1 / (sr * 0.01));
    const tuckRelease = Math.exp(-1 / (sr * 0.1));

    // Tilt EQ (color)
    const tiltFreq = 800;
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);
    const tiltGainLow = 1 + (0.5 - color) * 1.4;
    const tiltGainHigh = 1 + (color - 0.5) * 1.4;

    // Tape saturation drive (very subtle)
    const satDrive = 0.8 + glue * 0.4;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];
      const monoIn = (dryL + dryR) * 0.5;

      // Input envelope for tuck
      const inLevel = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (inLevel > this.tuckEnv) {
        this.tuckEnv = tuckAttack * this.tuckEnv + (1 - tuckAttack) * inLevel;
      } else {
        this.tuckEnv = tuckRelease * this.tuckEnv + (1 - tuckRelease) * inLevel;
      }

      // 3 parallel combs
      let reverbL = 0, reverbR = 0;
      for (let c = 0; c < 3; c++) {
        const len = Math.round(this.combLens[c] * sizeScale);
        const bs = this.combBufL[c].length;
        const pos = this.combPos[c];
        const readIdx = (pos - len + bs) % bs;
        let cL = this.combBufL[c][readIdx];
        let cR = this.combBufR[c][readIdx];

        // LP damping
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * cL;
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * cR;
        cL = this.combLpL[c];
        cR = this.combLpR[c];

        this.combBufL[c][pos] = monoIn + cL * combFb;
        this.combBufR[c][pos] = monoIn + cR * combFb;
        this.combPos[c] = (pos + 1) % bs;

        reverbL += cL;
        reverbR += cR;
      }
      reverbL /= 3;
      reverbR /= 3;

      // 2 series allpass
      for (let a = 0; a < 2; a++) {
        const len = this.apLens[a];
        const bs = this.apBufL[a].length;
        const pos = this.apPos[a];
        const readIdx = (pos - len + bs) % bs;
        const delL = this.apBufL[a][readIdx];
        const delR = this.apBufR[a][readIdx];

        const outL = -apCoef * reverbL + delL;
        const outR = -apCoef * reverbR + delR;
        this.apBufL[a][pos] = reverbL + apCoef * delL;
        this.apBufR[a][pos] = reverbR + apCoef * delR;
        this.apPos[a] = (pos + 1) % bs;

        reverbL = outL;
        reverbR = outR;
      }

      // Harmonic saturation (subtle tanh)
      reverbL = Math.tanh(reverbL * satDrive) / satDrive;
      reverbR = Math.tanh(reverbR * satDrive) / satDrive;

      // Tuck: dynamic LP filter — when input is loud, reverb gets filtered
      const tuckCutoff = 16000 - this.tuckEnv * tuck * 14000; // 16k down to 2k
      const tuckC = Math.exp(-2 * Math.PI * Math.max(200, tuckCutoff) / sr);
      this.tuckLpL = tuckC * this.tuckLpL + (1 - tuckC) * reverbL;
      this.tuckLpR = tuckC * this.tuckLpR + (1 - tuckC) * reverbR;
      if (tuck > 0.01) {
        reverbL = reverbL * (1 - tuck * 0.7) + this.tuckLpL * tuck * 0.7;
        reverbR = reverbR * (1 - tuck * 0.7) + this.tuckLpR * tuck * 0.7;
      }

      // Compressor on reverb output
      const revLevel = Math.max(Math.abs(reverbL), Math.abs(reverbR));
      if (revLevel > this.compEnv) {
        this.compEnv = compAttack * this.compEnv + (1 - compAttack) * revLevel;
      } else {
        this.compEnv = compRelease * this.compEnv + (1 - compRelease) * revLevel;
      }

      let gr = 1;
      if (this.compEnv > threshLin) {
        const overDb = 20 * Math.log10(this.compEnv / threshLin);
        const reducedDb = overDb * (1 - 1 / ratio);
        gr = Math.pow(10, -reducedDb / 20);
      }
      if ((1 - gr) > maxGr) maxGr = 1 - gr;

      reverbL *= gr * makeupGain;
      reverbR *= gr * makeupGain;

      // Tilt EQ (color)
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * reverbL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * reverbR;
      const lowL = this.tiltLpL, lowR = this.tiltLpR;
      const highL = reverbL - lowL, highR = reverbR - lowR;
      reverbL = lowL * tiltGainLow + highL * tiltGainHigh;
      reverbR = lowR * tiltGainLow + highR * tiltGainHigh;

      // Width: mid-side on reverb only
      const mid  = (reverbL + reverbR) * 0.5;
      const side = (reverbL - reverbR) * 0.5;
      const widthScale = width * 2; // 0 = mono, 1 = stereo, 2 = wide
      let wetL = mid + side * widthScale;
      let wetR = mid - side * widthScale;

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

      const rl = Math.max(Math.abs(reverbL), Math.abs(reverbR));
      if (rl > reverbAccum) reverbAccum = rl;
      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._grLevel = maxGr;
    this._reverbLevel = reverbAccum;
    this.port.postMessage({ peak: peakAccum, gr: maxGr, reverbLevel: reverbAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', ReverbBusProcessor);
`;

export async function createReverbBusEngine(audioCtx) {
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

  let _peak = 0, _gr = 0, _reverbLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.gr !== undefined) _gr = e.data.gr;
    if (e.data?.reverbLevel !== undefined) _reverbLevel = e.data.reverbLevel;
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
    setSpace:  v => { p('space').value  = v; },
    setTuck:   v => { p('tuck').value   = v; },
    setGlue:   v => { p('glue').value   = v; },
    setColor:  v => { p('color').value  = v; },
    setWidth:  v => { p('width').value  = v; },
    setMix:    v => { p('mix').value    = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getGR: () => _gr,
    getReverbLevel: () => _reverbLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
