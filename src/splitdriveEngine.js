// splitdriveEngine.js — SPLITDRIVE: Frequency-Selective 3-Band Drive
//
// "Drive only what matters."
// Split into 3 bands → independent tanh saturation → recombine
//
// Controls:
//   LOW DRIVE   — drive amount for low band
//   MID DRIVE   — drive amount for mid band
//   HIGH DRIVE  — drive amount for high band
//   CROSS-LO    — low/mid crossover point (100-800Hz)
//   CROSS-HI    — mid/high crossover point (1k-8kHz)
//   TONE        — output tilt
//   MIX         — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'splitdrive-v1';

const PROCESSOR_CODE = `
class SplitdriveProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lowDrive',  defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: 'midDrive',  defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'highDrive', defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: 'crossLo',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'crossHi',   defaultValue: 0.6, minValue: 0, maxValue: 1 },
      { name: 'tone',      defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mix',       defaultValue: 1,   minValue: 0, maxValue: 1 },
      { name: 'bypass',    defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Crossover filter state — one-pole LP/HP pairs for 2 crossovers
    // Crossover 1: low/mid split
    this.xo1LpL = 0; this.xo1LpR = 0;
    // Crossover 2: mid/high split
    this.xo2LpL = 0; this.xo2LpR = 0;

    // Output tone tilt
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Metering
    this._peakOut = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const lowDrive  = params.lowDrive[0];
    const midDrive  = params.midDrive[0];
    const highDrive = params.highDrive[0];
    const crossLo   = params.crossLo[0];
    const crossHi   = params.crossHi[0];
    const tone       = params.tone[0];
    const mix        = params.mix[0];
    const bypass     = params.bypass[0] > 0.5;

    const sr = this.sr;

    // ── Crossover frequency mapping ─────────────────────────────────────
    // crossLo 0..1 → 100..800 Hz (exponential)
    const loFreq = 100 * Math.pow(8, crossLo);
    // crossHi 0..1 → 1000..8000 Hz (exponential)
    const hiFreq = 1000 * Math.pow(8, crossHi);

    // One-pole filter coefficients
    const loCoef = Math.exp(-2 * Math.PI * loFreq / sr);
    const hiCoef = Math.exp(-2 * Math.PI * hiFreq / sr);

    // ── Drive gain mapping (1x to 10x) ──────────────────────────────────
    const lowGain  = 1 + lowDrive  * 9;
    const midGain  = 1 + midDrive  * 9;
    const highGain = 1 + highDrive * 9;

    // ── Tone tilt filter ────────────────────────────────────────────────
    const tiltFreq = 800;
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);

    let peakAccum = 0;

    // ── True passthrough ────────────────────────────────────────────────
    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      // Reset filter state
      this.xo1LpL = 0; this.xo1LpR = 0;
      this.xo2LpL = 0; this.xo2LpR = 0;
      this.tiltLpL = 0; this.tiltLpR = 0;
      this._peakOut = peakAccum;
      this.port.postMessage({ peak: peakAccum });
      return true;
    }

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];

      // ── Band split using one-pole crossover filters ──────────────────
      // Crossover 1: separate low from (mid+high)
      this.xo1LpL = loCoef * this.xo1LpL + (1 - loCoef) * dryL;
      this.xo1LpR = loCoef * this.xo1LpR + (1 - loCoef) * dryR;
      const lowL = this.xo1LpL;
      const lowR = this.xo1LpR;
      const midHiL = dryL - lowL;
      const midHiR = dryR - lowR;

      // Crossover 2: separate mid from high
      this.xo2LpL = hiCoef * this.xo2LpL + (1 - hiCoef) * midHiL;
      this.xo2LpR = hiCoef * this.xo2LpR + (1 - hiCoef) * midHiR;
      const midL = this.xo2LpL;
      const midR = this.xo2LpR;
      const hiL  = midHiL - midL;
      const hiR  = midHiR - midR;

      // ── Per-band tanh saturation ─────────────────────────────────────
      // Low band
      let satLowL, satLowR;
      if (lowDrive > 0.01) {
        satLowL = Math.tanh(lowL * lowGain) / Math.tanh(lowGain);
        satLowR = Math.tanh(lowR * lowGain) / Math.tanh(lowGain);
      } else {
        satLowL = lowL;
        satLowR = lowR;
      }

      // Mid band
      let satMidL, satMidR;
      if (midDrive > 0.01) {
        satMidL = Math.tanh(midL * midGain) / Math.tanh(midGain);
        satMidR = Math.tanh(midR * midGain) / Math.tanh(midGain);
      } else {
        satMidL = midL;
        satMidR = midR;
      }

      // High band
      let satHiL, satHiR;
      if (highDrive > 0.01) {
        satHiL = Math.tanh(hiL * highGain) / Math.tanh(highGain);
        satHiR = Math.tanh(hiR * highGain) / Math.tanh(highGain);
      } else {
        satHiL = hiL;
        satHiR = hiR;
      }

      // ── Recombine bands ──────────────────────────────────────────────
      let outL = satLowL + satMidL + satHiL;
      let outR = satLowR + satMidR + satHiR;

      // ── Tone tilt ────────────────────────────────────────────────────
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * outL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * outR;
      if (tone < 0.5) {
        const amt = (0.5 - tone) * 2;
        outL = outL * (1 - amt * 0.5) + this.tiltLpL * amt * 0.5;
        outR = outR * (1 - amt * 0.5) + this.tiltLpR * amt * 0.5;
      } else {
        const amt = (tone - 0.5) * 2;
        outL += (outL - this.tiltLpL) * amt * 0.3;
        outR += (outR - this.tiltLpR) * amt * 0.3;
      }

      // ── Mix ──────────────────────────────────────────────────────────
      oL[n] = dryL * (1 - mix) + outL * mix;
      oR[n] = dryR * (1 - mix) + outR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: peakAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', SplitdriveProcessor);
`;

export async function createSplitdriveEngine(audioCtx) {
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

  let _peak = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setLowDrive:   v => { p('lowDrive').value  = v; },
    setMidDrive:   v => { p('midDrive').value  = v; },
    setHighDrive:  v => { p('highDrive').value = v; },
    setCrossLo:    v => { p('crossLo').value   = v; },
    setCrossHi:    v => { p('crossHi').value   = v; },
    setTone:       v => { p('tone').value      = v; },
    setMix:        v => { p('mix').value       = v; },
    setBypass:     v => { p('bypass').value     = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getAnalyserIn:  () => analyserIn,
    getPeakOutput:  () => _peak,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
