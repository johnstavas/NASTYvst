// phraseRiderEngine.js — PHRASERIDER: Musical vocal riding engine.
//
// Feels like human fader automation:
// - Phrase detector (long envelope ~200-500ms for phrase-level)
// - Word/syllable detector (fast window ~20-50ms for word-level)
// - Two-layer riding engine blending phrase + word correction
// - Smooth gain application (zipper-free, organic)
// - Optional presence compensation (prevent ridden vocals sounding sleepy)
//
// Controls:
//   SPEED       — riding speed (slow phrase <-> fast word response) 0-1
//   SMOOTHNESS  — gain application smoothness 0-100
//   PHRASEWORD  — phrase vs word bias 0-100 (0=phrase, 100=word)
//   PRESCOMP    — presence compensation 0-100
//   OUTPUT      — output gain -18 to +18 dB
//   BYPASS

const PROCESSOR_VERSION = 'phraserider-v1';

const PROCESSOR_CODE = `
class PhraseRiderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'speed',      defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'smoothness', defaultValue: 0.60, minValue: 0, maxValue: 1 },
      { name: 'phraseWord', defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'presComp',   defaultValue: 0.30, minValue: 0, maxValue: 1 },
      { name: 'outputDb',   defaultValue: 0,    minValue: -18, maxValue: 18 },
      { name: 'bypass',     defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Phrase detector (long window) ──
    this.phraseEnv = 0;
    this.phraseTarget = 0;

    // ── Word/syllable detector (fast window) ──
    this.wordEnv = 0;

    // ── Target level calibration ──
    this.longTermAvg = 0.15;
    this.longTermSmooth = 0;
    this.samplesSeen = 0;

    // ── Smooth gain application ──
    this.currentGain = 1;
    this.prevGain = 1;

    // ── Presence compensation ──
    // HP at 2kHz for presence detection/boost
    this.presHpL = 0; this.presHpR = 0;
    this.presEnv = 0;

    // ── Waveform buffer for visualization ──
    this.waveformBuf = new Float32Array(128);
    this.waveformIdx = 0;
    this.gainBuf = new Float32Array(128);
    this.frameCount = 0;

    // ── Metering ──
    this._peak = 0;
    this._gainReduction = 0;
    this._phraseLevel = 0;
    this._wordLevel = 0;
    this._currentGainDb = 0;

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

    const speed      = params.speed[0];
    const smoothness = params.smoothness[0];
    const phraseWord = params.phraseWord[0];
    const presComp   = params.presComp[0];
    const outputDb   = params.outputDb[0];
    const bypass     = params.bypass[0] > 0.5;
    const sr         = this.sr;

    const outputGain = Math.pow(10, outputDb / 20);
    let peakAccum = 0;

    if (bypass) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, gainReduction: 0, phraseLevel: 0, wordLevel: 0, currentGainDb: 0, waveform: null, gainCurve: null });
      return true;
    }

    // ── Phrase envelope coefficients ──
    // Attack: 100-400ms (slower when speed is low)
    const phraseAtkTime = 0.1 + (1 - speed) * 0.3;
    const phraseRelTime = 0.3 + (1 - speed) * 0.7;
    const phraseAtkC = Math.exp(-1 / (sr * phraseAtkTime));
    const phraseRelC = Math.exp(-1 / (sr * phraseRelTime));

    // ── Word envelope coefficients ──
    // Attack: 10-40ms
    const wordAtkTime = 0.01 + (1 - speed) * 0.03;
    const wordRelTime = 0.03 + (1 - speed) * 0.05;
    const wordAtkC = Math.exp(-1 / (sr * wordAtkTime));
    const wordRelC = Math.exp(-1 / (sr * wordRelTime));

    // ── Gain smoothing coefficient ──
    const gainSmoothTime = 0.005 + smoothness * 0.04; // 5-45ms
    const gainSmoothC = Math.exp(-1 / (sr * gainSmoothTime));

    // ── Presence HP at 2kHz ──
    const presHpCoef = Math.exp(-2 * Math.PI * 2000 / sr);
    const presAtkC = Math.exp(-1 / (sr * 0.005));
    const presRelC = Math.exp(-1 / (sr * 0.05));

    // Downsample rate for waveform display
    const dsRate = Math.max(1, Math.floor(sr / (128 * 30))); // ~30fps at 128 samples

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (Math.abs(dryL) + Math.abs(dryR)) * 0.5;

      this.samplesSeen++;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 1: PHRASE DETECTOR (long envelope)
      // ═══════════════════════════════════════════════════════════════
      if (mono > this.phraseEnv) {
        this.phraseEnv = phraseAtkC * this.phraseEnv + (1 - phraseAtkC) * mono;
      } else {
        this.phraseEnv = phraseRelC * this.phraseEnv + (1 - phraseRelC) * mono;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 2: WORD/SYLLABLE DETECTOR (fast envelope)
      // ═══════════════════════════════════════════════════════════════
      if (mono > this.wordEnv) {
        this.wordEnv = wordAtkC * this.wordEnv + (1 - wordAtkC) * mono;
      } else {
        this.wordEnv = wordRelC * this.wordEnv + (1 - wordRelC) * mono;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 3: LONG-TERM TARGET CALIBRATION
      // ═══════════════════════════════════════════════════════════════
      // Slowly track the average level to set our riding target
      this.longTermSmooth = this.longTermSmooth * 0.99995 + mono * 0.00005;
      if (this.samplesSeen > sr * 0.5 && this.longTermSmooth > 0.005) {
        this.longTermAvg = this.longTermAvg * 0.9999 + this.longTermSmooth * 0.0001;
      }
      const target = Math.max(0.03, Math.min(0.5, this.longTermAvg));

      // ═══════════════════════════════════════════════════════════════
      // STAGE 4: TWO-LAYER RIDING ENGINE
      // ═══════════════════════════════════════════════════════════════
      // Blend phrase and word envelopes based on phraseWord bias
      const blendedEnv = this.phraseEnv * (1 - phraseWord) + this.wordEnv * phraseWord;

      let rideGain = 1;
      if (blendedEnv > 0.001) {
        const ratio = target / blendedEnv;
        // Riding range: boost up to 12dB, cut up to 12dB
        const maxBoost = Math.pow(10, 12 / 20); // ~4x
        const maxCut = Math.pow(10, -12 / 20);  // ~0.25x
        rideGain = Math.max(maxCut, Math.min(maxBoost, ratio));
      } else {
        // Signal is very quiet — don't boost noise floor
        rideGain = 1;
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 5: SMOOTH GAIN APPLICATION (zipper-free)
      // ═══════════════════════════════════════════════════════════════
      this.currentGain = gainSmoothC * this.currentGain + (1 - gainSmoothC) * rideGain;

      // Additional anti-zipper: limit slew rate
      const maxSlew = 0.001 + (1 - smoothness) * 0.005; // samples per step change
      const gainDiff = this.currentGain - this.prevGain;
      if (Math.abs(gainDiff) > maxSlew) {
        this.currentGain = this.prevGain + maxSlew * Math.sign(gainDiff);
      }
      this.prevGain = this.currentGain;

      let wL = dryL * this.currentGain;
      let wR = dryR * this.currentGain;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 6: PRESENCE COMPENSATION
      // ═══════════════════════════════════════════════════════════════
      if (presComp > 0.01) {
        // Detect high-frequency presence
        this.presHpL = presHpCoef * this.presHpL + (1 - presHpCoef) * wL;
        this.presHpR = presHpCoef * this.presHpR + (1 - presHpCoef) * wR;
        const hfL = wL - this.presHpL;
        const hfR = wR - this.presHpR;

        // Envelope on presence
        const presE = Math.max(Math.abs(hfL), Math.abs(hfR));
        this.presEnv = presE > this.presEnv
          ? presAtkC * this.presEnv + (1 - presAtkC) * presE
          : presRelC * this.presEnv + (1 - presRelC) * presE;

        // If gain was reduced (compression), compensate presence
        if (this.currentGain < 0.95) {
          const gainLoss = 1 - this.currentGain;
          const presBoost = gainLoss * presComp * 2.5;
          wL += hfL * presBoost;
          wR += hfR * presBoost;
        }
      }

      // Apply output gain
      oL[n] = wL * outputGain;
      oR[n] = wR * outputGain;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;

      // ── Waveform buffer (downsampled) ──
      this.frameCount++;
      if (this.frameCount % dsRate === 0) {
        this.waveformBuf[this.waveformIdx] = mono;
        this.gainBuf[this.waveformIdx] = this.currentGain;
        this.waveformIdx = (this.waveformIdx + 1) % 128;
      }
    }

    this._peak = peakAccum;
    this._gainReduction = Math.abs(1 - this.currentGain);
    this._phraseLevel = this.phraseEnv;
    this._wordLevel = this.wordEnv;
    this._currentGainDb = 20 * Math.log10(Math.max(0.0001, this.currentGain));

    // Send waveform data for visualization
    this.port.postMessage({
      peak: peakAccum,
      gainReduction: this._gainReduction,
      phraseLevel: this._phraseLevel,
      wordLevel: this._wordLevel,
      currentGainDb: this._currentGainDb,
      waveform: Array.from(this.waveformBuf),
      gainCurve: Array.from(this.gainBuf),
      waveformIdx: this.waveformIdx,
    });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', PhraseRiderProcessor);
`;

export async function createPhraseRiderEngine(audioCtx) {
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

  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0, _gainReduction = 0, _phraseLevel = 0, _wordLevel = 0, _currentGainDb = 0;
  let _waveform = null, _gainCurve = null, _waveformIdx = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.gainReduction !== undefined) _gainReduction = e.data.gainReduction;
    if (e.data?.phraseLevel !== undefined) _phraseLevel = e.data.phraseLevel;
    if (e.data?.wordLevel !== undefined) _wordLevel = e.data.wordLevel;
    if (e.data?.currentGainDb !== undefined) _currentGainDb = e.data.currentGainDb;
    if (e.data?.waveform) _waveform = e.data.waveform;
    if (e.data?.gainCurve) _gainCurve = e.data.gainCurve;
    if (e.data?.waveformIdx !== undefined) _waveformIdx = e.data.waveformIdx;
  };

  const _buf = new Float32Array(2048);

  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0;
    for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeakAn(an) {
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
    setSpeed:      v => { p('speed').value      = v; },
    setSmoothness: v => { p('smoothness').value = v; },
    setPhraseWord: v => { p('phraseWord').value = v; },
    setPresComp:   v => { p('presComp').value   = v; },
    setOutputDb:   v => { p('outputDb').value   = v; },
    setBypass:     v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak:     () => { _peakIn  = Math.max(getPeakAn(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:    () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:    () => getRms(analyserIn),
    getOutputLevel:   () => getRms(analyserOut),
    getPeakOutput:    () => _peak,
    getGainReduction: () => _gainReduction,
    getPhraseLevel:   () => _phraseLevel,
    getWordLevel:     () => _wordLevel,
    getCurrentGainDb: () => _currentGainDb,
    getWaveform:      () => _waveform,
    getGainCurve:     () => _gainCurve,
    getWaveformIdx:   () => _waveformIdx,

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
