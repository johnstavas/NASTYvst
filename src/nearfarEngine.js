// nearfarEngine.js — NEARFAR: Distance Designer
//
// Psychoacoustic spatial cues: early reflections, tail reverb, air absorption,
// transient softening, focus preservation
//
// Controls:
//   DISTANCE — near-far macro (0=close, 1=far)
//   ROOM     — room size / reflection spread
//   FOCUS    — source clarity preservation
//   AIRLOSS  — HF absorption over distance
//   TAIL     — reverb tail level
//   MIX      — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'nearfar-v1';

const PROCESSOR_CODE = `
class NearFarProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'distance', defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'room',     defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'focus',    defaultValue: 0.6, minValue: 0, maxValue: 1 },
      { name: 'airLoss',  defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'tail',     defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'mix',      defaultValue: 1.0, minValue: 0, maxValue: 1 },
      { name: 'bypass',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'smooth',   defaultValue: 0,   minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // 12-TAP EARLY REFLECTION MODEL — simulates real room geometry
    // Max delay: 120ms for distant reflections
    this.erMaxLen = Math.ceil(this.sr * 0.12);
    this.erBufL = new Float32Array(this.erMaxLen);
    this.erBufR = new Float32Array(this.erMaxLen);
    this.erWritePos = 0;

    // 12 reflection taps at specific time spacings simulating room geometry
    // Times in ms — modeled after first-order reflections in a real room
    this.erBaseTimes = [0.8, 1.9, 3.4, 5.1, 7.3, 10.2, 14.7, 19.8, 26.3, 35.1, 47.2, 63.0];
    this.erBaseGains = [0.82, 0.71, 0.63, 0.55, 0.48, 0.42, 0.35, 0.29, 0.23, 0.18, 0.14, 0.10];
    // Alternating stereo pan simulating wall reflections L/R/ceiling/floor
    this.erPans = [0.4, -0.5, 0.2, -0.3, 0.7, -0.6, 0.15, -0.8, 0.5, -0.2, 0.6, -0.4];

    // Short FDN tail (just 2 allpass for minimal late reverb, NOT parallel combs)
    const scale = this.sr / 44100;
    this.tailApLens = [Math.round(887 * scale), Math.round(1151 * scale)];
    this.tailMaxLen = Math.round(1500 * scale);
    this.tailBufL = []; this.tailBufR = [];
    this.tailIdxL = []; this.tailIdxR = [];
    this.tailDampL = [0, 0]; this.tailDampR = [0, 0];
    for (let i = 0; i < 2; i++) {
      this.tailBufL.push(new Float32Array(this.tailMaxLen));
      this.tailBufR.push(new Float32Array(this.tailMaxLen));
      this.tailIdxL.push(0);
      this.tailIdxR.push(0);
    }
    this.tailFbL = 0; this.tailFbR = 0;

    // Air absorption LP filter state
    this.airLpL = 0;
    this.airLpR = 0;

    // Transient detector / envelope followers
    this.envFast = 0;
    this.envSlow = 0;
    this.transientGain = 1;

    this._peak = 0;
    this._transientAmount = 0;

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

    const distance = params.distance[0];
    const room = params.room[0];
    const focus = params.focus[0];
    const airLoss = params.airLoss[0];
    const tail = params.tail[0];
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
      this.port.postMessage({ peak: peakAccum, transient: 0 });
      return true;
    }

    // Compute distance-dependent parameters — MUCH wider ranges
    // Air absorption cutoff: near=20kHz, far=1.5kHz — very dramatic at distance
    const airCutoff = 20000 - airLoss * distance * 18500;
    const airCoeff = Math.exp(-2 * Math.PI * airCutoff / sr);

    // Early reflection time scaling: near = tight (0.8x), far = very spread (5x)
    const erTimeScale = 0.8 + distance * 4.2;
    // ER gain: near is louder, far is quieter but more spread
    const erGainScale = 1.2 - distance * 0.7;
    // ER room spread — wider range
    const roomSpread = 0.8 + room * 2.5;

    // Tail allpass feedback: increases with distance
    const tailFb = 0.5 + distance * 0.35 + tail * 0.1;
    const tailApG = 0.5 + distance * 0.15;
    // Tail damping — wider range
    const tailDampFreq = 3000 + (1 - distance) * 12000;
    const tailDampCoeff = Math.exp(-2 * Math.PI * tailDampFreq / sr);

    // Transient detector coefficients
    const fastAttack = Math.exp(-1 / (sr * 0.0001)); // 0.1ms attack
    const fastRelease = Math.exp(-1 / (sr * 0.03));   // 30ms release
    const slowAttack = Math.exp(-1 / (sr * 0.01));     // 10ms
    const slowRelease = Math.exp(-1 / (sr * 0.15));    // 150ms

    // Transient softening amount: increases with distance
    const transientSoften = distance * (1 - focus * 0.8);

    let transientAccum = 0;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;
      const monoAbs = Math.abs(mono);

      // Envelope followers for transient detection
      if (monoAbs > this.envFast) {
        this.envFast = fastAttack * this.envFast + (1 - fastAttack) * monoAbs;
      } else {
        this.envFast = fastRelease * this.envFast;
      }
      if (monoAbs > this.envSlow) {
        this.envSlow = slowAttack * this.envSlow + (1 - slowAttack) * monoAbs;
      } else {
        this.envSlow = slowRelease * this.envSlow;
      }

      // Transient detection: fast > slow means transient
      const transientDetect = Math.max(0, this.envFast - this.envSlow * 1.2);
      transientAccum += transientDetect;

      // Transient gain reduction for far sounds
      const targetGain = 1 - transientSoften * Math.min(1, transientDetect * 10);
      this.transientGain += (targetGain - this.transientGain) * 0.01;

      // Apply transient softening to input
      let procL = dryL * this.transientGain;
      let procR = dryR * this.transientGain;

      // Write to early reflection buffer
      this.erBufL[this.erWritePos] = procL;
      this.erBufR[this.erWritePos] = procR;

      // Sum 12 early reflections — the core of the distance model
      let erL = 0, erR = 0;
      for (let t = 0; t < 12; t++) {
        const delayMs = this.erBaseTimes[t] * erTimeScale * roomSpread;
        const delaySamples = Math.min(Math.floor(delayMs * sr / 1000), this.erMaxLen - 1);
        const readIdx = (this.erWritePos - delaySamples + this.erMaxLen) % this.erMaxLen;
        const gain = this.erBaseGains[t] * erGainScale;
        const pan = this.erPans[t] * (0.5 + room * 0.5); // pan spread widens with room

        const erSample = this.erBufL[readIdx] * (1 - pan) * 0.5 + this.erBufR[readIdx] * (1 + pan) * 0.5;
        erL += erSample * gain * (1 - pan * 0.5);
        erR += erSample * gain * (1 + pan * 0.5);
      }

      this.erWritePos = (this.erWritePos + 1) % this.erMaxLen;

      // Short allpass tail — minimal, just for late decay smoothness
      let tailInL = procL * 0.3 + this.tailFbL * tailFb;
      let tailInR = procR * 0.3 + this.tailFbR * tailFb;
      tailInL = Math.tanh(tailInL);
      tailInR = Math.tanh(tailInR);

      let tailL = 0, tailR = 0;
      for (let a = 0; a < 2; a++) {
        const len = this.tailApLens[a];
        const idxL = this.tailIdxL[a];
        const idxR = this.tailIdxR[a];
        const readL = (idxL - len + this.tailMaxLen * 2) % this.tailMaxLen;
        const readR = (idxR - len + this.tailMaxLen * 2) % this.tailMaxLen;
        const delL = this.tailBufL[a][readL];
        const delR = this.tailBufR[a][readR];
        const outL = -tailApG * tailInL + delL;
        const outR = -tailApG * tailInR + delR;
        // Damped write
        this.tailDampL[a] = tailDampCoeff * this.tailDampL[a] + (1 - tailDampCoeff) * (tailInL + tailApG * delL);
        this.tailDampR[a] = tailDampCoeff * this.tailDampR[a] + (1 - tailDampCoeff) * (tailInR + tailApG * delR);
        this.tailBufL[a][idxL] = this.tailDampL[a];
        this.tailBufR[a][idxR] = this.tailDampR[a];
        this.tailIdxL[a] = (idxL + 1) % this.tailMaxLen;
        this.tailIdxR[a] = (idxR + 1) % this.tailMaxLen;
        tailInL = outL;
        tailInR = outR;
        tailL += outL * 0.4;
        tailR += outR * 0.4;
      }
      this.tailFbL = tailInL;
      this.tailFbR = tailInR;

      // Mix ER and tail — ER dominant, tail just adds smoothness
      const tailMix = distance * tail * 0.6;
      let wetL = erL * 0.7 + tailL * tailMix;
      let wetR = erR * 0.7 + tailR * tailMix;
      // Soft limit to prevent feedback explosion
      wetL = Math.tanh(wetL * 0.9) * 1.05;
      wetR = Math.tanh(wetR * 0.9) * 1.05;

      // Air absorption LP filter
      this.airLpL = airCoeff * this.airLpL + (1 - airCoeff) * wetL;
      this.airLpR = airCoeff * this.airLpR + (1 - airCoeff) * wetR;
      wetL = this.airLpL;
      wetR = this.airLpR;

      // Focus: blend in dry for clarity (small amount only)
      const focusDry = focus * 0.2;
      wetL += dryL * focusDry;
      wetR += dryR * focusDry;

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

      // Final mix
      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._transientAmount = transientAccum / iL.length;
    this.port.postMessage({ peak: peakAccum, transient: this._transientAmount, distance: distance });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', NearFarProcessor);
`;

export async function createNearFarEngine(audioCtx) {
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

  let _peak = 0, _transient = 0, _distance = 0.3;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.transient !== undefined) _transient = e.data.transient;
    if (e.data?.distance !== undefined) _distance = e.data.distance;
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
    setDistance: v => { p('distance').value = v; },
    setRoom: v => { p('room').value = v; },
    setFocus: v => { p('focus').value = v; },
    setAirLoss: v => { p('airLoss').value = v; },
    setTail: v => { p('tail').value = v; },
    setMix: v => { p('mix').value = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak: () => { _peakIn = Math.max(getPeakAn(analyserIn), _peakIn * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getTransient: () => _transient,
    getDistance: () => _distance,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
