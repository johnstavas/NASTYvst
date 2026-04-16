// reverbBusEngine.js — REVERB BUS: Stem/Mix Glue Reverb (v2)
//
// 8 true-stereo comb filters (L/R offset lengths) + 4 allpass diffusers.
// Subtle pre-delay for room depth. GLUE compressor on reverb return.
// Dynamic TUCK LP that ducks high-end when input is loud (keeps mix clear).
// M/S WIDTH on reverb only. COLOR tilt EQ.
//
// Controls:
//   SPACE  — room size / decay (comb fb + delay scale)
//   TUCK   — dynamic LP that clears reverb on transients
//   GLUE   — reverb compressor ratio (knits stems together)
//   COLOR  — tilt EQ dark→warm→open
//   WIDTH  — M/S width on wet reverb only
//   MIX    — dry/wet
//   BYPASS / SMOOTH

const PROCESSOR_VERSION = 'reverbbus-v2';

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
    const sc = this.sr / 44100;

    // 4 allpass diffusers (series, pre-comb)
    this.apLens = [241, 349, 463, 557].map(l => Math.round(l * sc));
    this.apBufL = this.apLens.map(l => new Float32Array(l + 16));
    this.apBufR = this.apLens.map(l => new Float32Array(l + 16));
    this.apPos  = new Int32Array(4);

    // 8 comb filters — shorter than plate, room character
    // L and R use offset lengths for stereo decorrelation
    this.combLensL = [743, 816, 897, 958, 1024, 1091, 1147, 1201].map(l => Math.round(l * sc));
    this.combLensR = [766, 839, 920, 981, 1047, 1114, 1170, 1224].map(l => Math.round(l * sc));
    const maxComb  = Math.round(1800 * sc) + 32;
    this.combBufL  = Array.from({length:8}, () => new Float32Array(maxComb));
    this.combBufR  = Array.from({length:8}, () => new Float32Array(maxComb));
    this.combPos   = new Int32Array(8);
    this.combLpL   = new Float64Array(8);
    this.combLpR   = new Float64Array(8);

    // Temp comb read buffers (avoid GC)
    this._cL = new Float64Array(8);
    this._cR = new Float64Array(8);

    // Pre-delay (~10ms default)
    this.preDelayLen = Math.round(0.012 * this.sr);
    this.preDelayBuf = new Float32Array(Math.round(0.1 * this.sr) + 8); // 100ms max
    this.preDelayBufR = new Float32Array(Math.round(0.1 * this.sr) + 8);
    this.preDelayPos = 0;

    // Compressor (GLUE) — on reverb return
    this.compEnv = 0;

    // Input envelope for TUCK
    this.tuckEnv = 0;
    this.tuckLpL = 0; this.tuckLpR = 0;

    // Tilt EQ LP state
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Smooth LP
    this.sLpL1 = 0; this.sLpR1 = 0;
    this.sLpL2 = 0; this.sLpR2 = 0;

    // Metering
    this._peak = 0; this._grLevel = 0; this._reverbLevel = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0], outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];
    const N  = iL.length;

    const space  = params.space[0];
    const tuck   = params.tuck[0];
    const glue   = params.glue[0];
    const color  = params.color[0];
    const width  = params.width[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const smooth = params.smooth[0];
    const sr     = this.sr;

    let peakAccum = 0, reverbAccum = 0, maxGr = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < N; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._grLevel = 0; this._reverbLevel = 0;
      this.port.postMessage({ peak: peakAccum, gr: 0, reverbLevel: 0 });
      return true;
    }

    // Room size: shorter fb range than plate for room-like decay
    const combFb   = 0.68 + space * 0.22; // 0.68–0.90
    const sizeScale = 0.7 + space * 0.6;  // 0.70–1.30

    // Damping (color)
    const dampFreq = 2800 + color * 10000;
    const dampCoef = Math.exp(-6.283185 * dampFreq / sr);

    // Allpass coeff
    const apG = 0.5;

    // Tilt EQ
    const tiltCoef      = Math.exp(-6.283185 * 800 / sr);
    const tiltGainLow   = 1 + (0.5 - color) * 1.4;
    const tiltGainHigh  = 1 + (color - 0.5) * 1.4;

    // GLUE compressor on reverb return
    const threshLin    = Math.pow(10, (-18 - glue * 12) / 20); // -18 to -30dB
    const ratio        = 2 + glue * 6;   // 2:1 to 8:1
    const compAtk      = Math.exp(-1 / (sr * 0.008));
    const compRel      = Math.exp(-1 / (sr * 0.10));
    const makeupGain   = 1 + glue * 0.5; // up to +50% makeup

    // TUCK envelope
    const tuckAtk  = Math.exp(-1 / (sr * 0.008));
    const tuckRel  = Math.exp(-1 / (sr * 0.12));

    // Pre-delay read offset
    const pdLen = Math.min(this.preDelayLen, this.preDelayBuf.length - 4);
    const pdBs  = this.preDelayBuf.length;

    const cL = this._cL, cR = this._cR;

    for (let n = 0; n < N; n++) {
      const dryL = iL[n], dryR = iR[n];

      // Pre-delay
      const pdPos = this.preDelayPos;
      this.preDelayBuf[pdPos]  = dryL;
      this.preDelayBufR[pdPos] = dryR;
      const pdRead = (pdPos - pdLen + pdBs) % pdBs;
      const pdL = this.preDelayBuf[pdRead];
      const pdR = this.preDelayBufR[pdRead];
      this.preDelayPos = (pdPos + 1) % pdBs;

      // TUCK envelope follower (tracks input energy)
      const inLvl = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (inLvl > this.tuckEnv) {
        this.tuckEnv = tuckAtk * this.tuckEnv + (1 - tuckAtk) * inLvl;
      } else {
        this.tuckEnv = tuckRel * this.tuckEnv + (1 - tuckRel) * inLvl;
      }

      // 4 allpass diffusers on pre-delayed signal
      let diffL = pdL, diffR = pdR;
      for (let a = 0; a < 4; a++) {
        const bs  = this.apBufL[a].length;
        const pos = this.apPos[a];
        const ri  = (pos - this.apLens[a] + bs) % bs;
        const dL  = this.apBufL[a][ri], dR = this.apBufR[a][ri];
        const oaL = -apG * diffL + dL;
        const oaR = -apG * diffR + dR;
        this.apBufL[a][pos] = diffL + apG * dL;
        this.apBufR[a][pos] = diffR + apG * dR;
        this.apPos[a] = (pos + 1) % bs;
        diffL = oaL; diffR = oaR;
      }

      // Read all 8 comb outputs
      for (let c = 0; c < 8; c++) {
        const bs   = this.combBufL[c].length;
        const pos  = this.combPos[c];
        const lenL = Math.max(64, Math.min(bs - 8, Math.round(this.combLensL[c] * sizeScale)));
        const lenR = Math.max(64, Math.min(bs - 8, Math.round(this.combLensR[c] * sizeScale)));
        const riL  = (pos - lenL + bs) % bs;
        const riR  = (pos - lenR + bs) % bs;
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * this.combBufL[c][riL];
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * this.combBufR[c][riR];
        cL[c] = this.combLpL[c];
        cR[c] = this.combLpR[c];
      }

      // Write combs — inject L into L set, R into R set (true stereo)
      let reverbL = 0, reverbR = 0;
      for (let c = 0; c < 8; c++) {
        const bs  = this.combBufL[c].length;
        const pos = this.combPos[c];
        this.combBufL[c][pos] = diffL + cL[c] * combFb;
        this.combBufR[c][pos] = diffR + cR[c] * combFb;
        this.combPos[c] = (pos + 1) % bs;
        reverbL += cL[c];
        reverbR += cR[c];
      }
      reverbL *= 0.125;
      reverbR *= 0.125;

      // Subtle harmonic saturation (glue adds a tiny bit of drive)
      const satDrive = 0.85 + glue * 0.3;
      reverbL = Math.tanh(reverbL * satDrive) / satDrive;
      reverbR = Math.tanh(reverbR * satDrive) / satDrive;

      // TUCK: dynamic LP that clears reverb high-end on loud transients
      if (tuck > 0.01) {
        const tuckCutoff = Math.max(800, 16000 - this.tuckEnv * tuck * 14000);
        const tuckC = Math.exp(-6.283185 * tuckCutoff / sr);
        this.tuckLpL = tuckC * this.tuckLpL + (1 - tuckC) * reverbL;
        this.tuckLpR = tuckC * this.tuckLpR + (1 - tuckC) * reverbR;
        reverbL = reverbL * (1 - tuck * 0.65) + this.tuckLpL * tuck * 0.65;
        reverbR = reverbR * (1 - tuck * 0.65) + this.tuckLpR * tuck * 0.65;
      }

      // GLUE compressor on reverb return
      const revLvl = Math.max(Math.abs(reverbL), Math.abs(reverbR));
      if (revLvl > this.compEnv) {
        this.compEnv = compAtk * this.compEnv + (1 - compAtk) * revLvl;
      } else {
        this.compEnv = compRel * this.compEnv + (1 - compRel) * revLvl;
      }
      let gr = 1;
      if (this.compEnv > threshLin) {
        const overDb   = 20 * Math.log10(this.compEnv / threshLin);
        const reducDb  = overDb * (1 - 1 / ratio);
        gr = Math.pow(10, -reducDb / 20);
      }
      if ((1 - gr) > maxGr) maxGr = 1 - gr;
      reverbL *= gr * makeupGain;
      reverbR *= gr * makeupGain;

      // COLOR tilt EQ
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * reverbL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * reverbR;
      let wetL = this.tiltLpL * tiltGainLow + (reverbL - this.tiltLpL) * tiltGainHigh;
      let wetR = this.tiltLpR * tiltGainLow + (reverbR - this.tiltLpR) * tiltGainHigh;

      // WIDTH: M/S on reverb only
      const mid  = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5;
      const ws   = width * 2; // 0=mono, 1=normal stereo, 2=wide
      wetL = mid + side * ws;
      wetR = mid - side * ws;

      // Smooth
      if (smooth > 0.5) {
        const sCoef = Math.exp(-6.283185 * (6500 - smooth * 900) / sr);
        this.sLpL1 = sCoef * this.sLpL1 + (1 - sCoef) * wetL;
        this.sLpR1 = sCoef * this.sLpR1 + (1 - sCoef) * wetR;
        this.sLpL2 = sCoef * this.sLpL2 + (1 - sCoef) * this.sLpL1;
        this.sLpR2 = sCoef * this.sLpR2 + (1 - sCoef) * this.sLpR1;
        wetL = this.sLpL2; wetR = this.sLpR2;
      }

      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const rl = Math.max(Math.abs(wetL), Math.abs(wetR));
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

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim); inputTrim.connect(analyserIn); analyserIn.connect(worklet);
  worklet.connect(analyserOut); analyserOut.connect(outputTrim);
  outputTrim.connect(output); outputTrim.connect(chainOutput);

  let _peak = 0, _gr = 0, _reverbLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak         !== undefined) _peak        = e.data.peak;
    if (e.data?.gr           !== undefined) _gr          = e.data.gr;
    if (e.data?.reverbLevel  !== undefined) _reverbLevel = e.data.reverbLevel;
  };

  const _buf = new Float32Array(2048);
  function getRms(an)  { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setSpace:  v => { p('space').value  = v; },
    setTuck:   v => { p('tuck').value   = v; },
    setGlue:   v => { p('glue').value   = v; },
    setColor:  v => { p('color').value  = v; },
    setWidth:  v => { p('width').value  = v; },
    setMix:    v => { p('mix').value    = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn;  },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getGR:          () => _gr,
    getReverbLevel: () => _reverbLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose()  { this.destroy(); },
  };
}
