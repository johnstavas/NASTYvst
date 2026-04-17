// drumBusEngine.js — DRUM BUS v2
// DSP chain per sample stereo:
//   Drive+Crunch saturation → Boom low-end → Damp hi rolloff
//   → Transients shaping → Glue compressor → Width M/S → Trim + Mix

const PROCESSOR_VERSION = 'drumbusv3';

const PROCESSOR_CODE = `
class DrumBusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive',      defaultValue: 0.3,  minValue: 0,   maxValue: 1 },
      { name: 'crunch',     defaultValue: 0.0,  minValue: 0,   maxValue: 1 },
      { name: 'boom',       defaultValue: 0.0,  minValue: 0,   maxValue: 1 },
      { name: 'freq',       defaultValue: 0.25, minValue: 0,   maxValue: 1 },
      { name: 'damp',       defaultValue: 0.75, minValue: 0,   maxValue: 1 },
      { name: 'transients', defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'decay',      defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'comp',       defaultValue: 0,    minValue: 0,   maxValue: 1 },
      { name: 'driveMode',  defaultValue: 0,    minValue: 0,   maxValue: 2 },
      { name: 'mix',        defaultValue: 1.0,  minValue: 0,   maxValue: 1 },
      { name: 'trim',       defaultValue: 0,    minValue: -12, maxValue: 12 },
      { name: 'bypass',     defaultValue: 0,    minValue: 0,   maxValue: 1 },
      { name: 'width',      defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // hi-freq LP for crunch (3 kHz one-pole) — L + R
    this.hiLPL = 0; this.hiLPR = 0;

    // ── Low-End Generator (dynamic sine oscillator system) ───────────
    // Detect low-freq transient energy → trigger envelope → drive sine
    this.boomDetLP  = 0;        // LP for low-band energy detection
    this.boomEnvState = 0;      // triggered envelope (0–1)
    this.boomPhase  = 0;        // sine oscillator phase (0–1)
    this.boomWasLow = true;     // rising-edge detector for phase sync
    // Static LP for body feel (blended under the sine)
    this.boomLPL = 0; this.boomLPR = 0;

    // damp LP — L + R
    this.dampLPL = 0; this.dampLPR = 0;

    // transient envelopes (combined mono tracking for stable detection)
    this.fastEnv = 0; this.slowEnv = 0;

    // glue compressor gain
    this.glueGain = 1.0;

    // width M/S side HPF state
    this.sideHP = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0], outBufs = outputs[0];
    if (!inBufs || !inBufs.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];
    const N  = iL.length, sr = this.sr;

    const drive      = params.drive[0];
    const crunch     = params.crunch[0];
    const boom       = params.boom[0];
    const freq       = params.freq[0];
    const damp       = params.damp[0];
    const transients = params.transients[0];
    const decay      = params.decay[0];
    const comp       = params.comp[0];
    const driveMode  = Math.round(Math.max(0, Math.min(2, params.driveMode[0])));
    const mix        = params.mix[0];
    const trim       = params.trim[0];
    const bypass     = params.bypass[0] > 0.5;
    const width      = params.width[0];

    if (bypass) {
      for (let n = 0; n < N; n++) { oL[n] = iL[n]; oR[n] = iR[n]; }
      this.port.postMessage({ peakIn: 0, peakOut: 0, bassLevel: 0, gr: 0, transient: 0 });
      return true;
    }

    // ── Pre-compute coefficients ──────────────────────────────────────
    const hiLPCoeff = Math.exp(-2 * Math.PI * 3000 / sr);

    // Low-End Generator coefficients
    const boomFreqHz   = 20 + freq * 100;                              // 20–120Hz oscillator freq
    const boomDetCoeff = 1 - Math.exp(-2 * Math.PI * boomFreqHz * 1.5 / sr); // detection LP (tracks low band)
    const boomEnvAtk   = Math.exp(-1 / (sr * 0.002));                 // 2ms attack — snappy
    const boomEnvRel   = Math.exp(-1 / (sr * (0.04 + decay * 0.46))); // 40ms–500ms release (DECAY knob)
    // Static body layer (gentle LP shelf under the sine)
    const boomBodyCoeff = 1 - Math.exp(-2 * Math.PI * 120 / sr);
    const boomBodyGain  = boom * 0.18;

    const dampFreqHz = 2000 + damp * 18000;
    const dampCoeff  = Math.exp(-2 * Math.PI * dampFreqHz / sr);

    // transient envelopes
    const fastAtk = Math.exp(-1 / (sr * 0.001));
    const fastRel = Math.exp(-1 / (sr * 0.050));
    const slowAtk = Math.exp(-1 / (sr * 0.100));
    const slowRel = Math.exp(-1 / (sr * 0.400));
    const transAmt = (transients - 0.5) * 2;
    const decayAmt = (decay - 0.5) * 2;

    // glue compressor — threshold -20dBFS, 4:1, auto makeup
    const glueAtk    = Math.exp(-1 / (sr * 0.008));  // 8ms attack
    const glueRel    = Math.exp(-1 / (sr * 0.180));  // 180ms release
    const glueThresh = 0.100;   // -20dBFS — catches programme material
    const glueRatio  = 4.0;     // 4:1 — noticeable glue without squashing
    const useGlue    = comp > 0.5;

    // width — side HPF above 150Hz
    const sideHPCoeff = Math.exp(-2 * Math.PI * 150 / sr);
    const widthScale  = width * 2;

    // output trim
    const trimLin = Math.pow(10, trim / 20);

    let peakIn     = 0;
    let peakOut    = 0;
    let bassLevel  = 0;
    let grAmount   = 0;
    let transLevel = 0;

    for (let n = 0; n < N; n++) {
      const dryL = iL[n], dryR = iR[n];

      // track input peak
      const absIn = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (absIn > peakIn) peakIn = absIn;

      let xL = dryL, xR = dryR;

      // ── 1. Drive saturation ───────────────────────────────────────────
      if (driveMode === 0) {
        // soft: tanh
        const ds = 1 + drive * 2;
        const dc = 1 + drive * 0.8;
        xL = Math.tanh(xL * ds) / dc;
        xR = Math.tanh(xR * ds) / dc;
      } else if (driveMode === 1) {
        // medium: x/(1+|x|) with slight mid push
        const ds = 1.5 + drive * 2.5;
        xL = (xL * ds) / (1 + Math.abs(xL * ds)) * (1 + drive * 0.25);
        xR = (xR * ds) / (1 + Math.abs(xR * ds)) * (1 + drive * 0.25);
      } else {
        // hard: hard clip with slight asymmetry
        const ds = 1 + drive * 4;
        xL = (xL >= 0 ? 1 : -1) * Math.min(1, Math.abs(xL) * ds) + xL * 0.04;
        xR = (xR >= 0 ? 1 : -1) * Math.min(1, Math.abs(xR) * ds) + xR * 0.04;
      }

      // crunch: hi-freq harmonic distortion
      // one-pole LP to isolate hi band
      this.hiLPL = hiLPCoeff * this.hiLPL + (1 - hiLPCoeff) * xL;
      this.hiLPR = hiLPCoeff * this.hiLPR + (1 - hiLPCoeff) * xR;
      if (crunch > 0.0001) {
        const hiL  = xL - this.hiLPL;
        const hiR  = xR - this.hiLPR;
        const csc  = 1 + crunch * 4;
        xL = xL + (Math.tanh(hiL * csc) - hiL) * crunch * 0.6;
        xR = xR + (Math.tanh(hiR * csc) - hiR) * crunch * 0.6;
      }

      // ── 2. Low-End Generator (dynamic triggered sine oscillator) ─────
      // Step A: detect low-frequency transient energy
      this.boomDetLP += boomDetCoeff * ((Math.abs(xL) + Math.abs(xR)) * 0.5 - this.boomDetLP);
      const boomEnvIn = this.boomDetLP;

      // Step B: envelope follower — fast attack, DECAY-controlled release
      if (boomEnvIn > this.boomEnvState) {
        this.boomEnvState = boomEnvAtk * this.boomEnvState + (1 - boomEnvAtk) * boomEnvIn;
      } else {
        this.boomEnvState = boomEnvRel * this.boomEnvState + (1 - boomEnvRel) * boomEnvIn;
      }

      // Step C: rising-edge phase sync — when a new kick transient arrives,
      // reset oscillator phase so the sine always starts at the same point
      // (phase alignment: sine begins at -π/2 → rises cleanly on attack)
      const trigThresh = 0.04;
      const isHigh = this.boomEnvState > trigThresh;
      if (this.boomWasLow && isHigh) {
        this.boomPhase = 0.75; // sin(0.75*2π) = -1 → rises to peak = clean punch shape
      }
      this.boomWasLow = !isHigh;

      // Step D: advance oscillator
      this.boomPhase += boomFreqHz / sr;
      if (this.boomPhase >= 1) this.boomPhase -= 1;
      const boomAngle = this.boomPhase * 6.283185;

      // Step E: sine + harmonics
      let boomSine = Math.sin(boomAngle);                          // fundamental
      boomSine    += Math.sin(boomAngle * 2) * 0.28;              // 2nd harmonic — warmth
      boomSine    += Math.sin(boomAngle * 3) * 0.09;              // 3rd harmonic — subtle grit

      // Step F: amplitude = envelope × boom knob; soft-clip limiter
      const boomAmp = this.boomEnvState * boom * 0.75;
      let boomOut   = boomSine * boomAmp;
      boomOut       = Math.tanh(boomOut * 1.8) * 0.6; // soft clip — prevents buildup

      // Step G: add generated bass to signal (mono sub — summed equally to L+R)
      if (boom > 0.0001) {
        xL += boomOut;
        xR += boomOut;
      }

      // Step H: static LP body layer (thin — just fills the static low shelf)
      this.boomLPL += boomBodyCoeff * (xL - this.boomLPL);
      this.boomLPR += boomBodyCoeff * (xR - this.boomLPR);
      if (boom > 0.0001) {
        xL += this.boomLPL * boomBodyGain;
        xR += this.boomLPR * boomBodyGain;
      }

      const bassNow = Math.max(Math.abs(boomOut), Math.abs(this.boomLPL));
      if (bassNow > bassLevel) bassLevel = bassNow;

      // ── 3. Damp (high-freq rolloff) ──────────────────────────────────
      this.dampLPL += (1 - dampCoeff) * (xL - this.dampLPL);
      this.dampLPR += (1 - dampCoeff) * (xR - this.dampLPR);
      xL = this.dampLPL;
      xR = this.dampLPR;

      // ── 4. Transients shaping ─────────────────────────────────────────
      const absX = Math.max(Math.abs(xL), Math.abs(xR));

      if (absX > this.fastEnv) {
        this.fastEnv = fastAtk * this.fastEnv + (1 - fastAtk) * absX;
      } else {
        this.fastEnv = fastRel * this.fastEnv + (1 - fastRel) * absX;
      }
      if (absX > this.slowEnv) {
        this.slowEnv = slowAtk * this.slowEnv + (1 - slowAtk) * absX;
      } else {
        this.slowEnv = slowRel * this.slowEnv + (1 - slowRel) * absX;
      }

      const transientSig = Math.max(0, this.fastEnv - this.slowEnv);
      if (transientSig > transLevel) transLevel = transientSig;

      const transGain  = 1.0 + transAmt * transientSig * 3.0;
      xL *= transGain;
      xR *= transGain;

      const sustainSig = Math.max(0, this.slowEnv - transientSig);
      const decayGain  = 1.0 + decayAmt * sustainSig * 1.5;
      xL *= decayGain;
      xR *= decayGain;

      // ── 5. Glue compressor ───────────────────────────────────────────
      if (useGlue) {
        const level = Math.max(Math.abs(xL), Math.abs(xR));
        let targetGain;
        if (level > glueThresh) {
          const overDb = 20 * Math.log10(level / glueThresh);
          const gainDb = -overDb * (1 - 1 / glueRatio);
          targetGain   = Math.min(1.0, Math.pow(10, gainDb / 20));
        } else {
          targetGain = 1.0;
        }
        if (targetGain < this.glueGain) {
          this.glueGain = glueAtk * this.glueGain + (1 - glueAtk) * targetGain;
        } else {
          this.glueGain = glueRel * this.glueGain + (1 - glueRel) * targetGain;
        }
        // Auto makeup: compensate for gain reduction so level-matched vs bypass.
        // At full ratio/threshold engagement, makeup of ~+4dB keeps things even.
        const makeupDb  = (1 - this.glueGain) * 14; // scales with actual GR
        const makeupLin = Math.pow(10, makeupDb / 20);
        xL *= this.glueGain * makeupLin;
        xR *= this.glueGain * makeupLin;
        const gr = 1 - this.glueGain;
        if (gr > grAmount) grAmount = gr;
      } else {
        // decay glueGain toward 1 smoothly when toggled off
        this.glueGain = glueRel * this.glueGain + (1 - glueRel) * 1.0;
      }

      // ── 6. Width (M/S) ───────────────────────────────────────────────
      const Mm  = (xL + xR) * 0.5;
      const Ss  = (xL - xR) * 0.5;
      // HPF side above 150 Hz to protect LF mono
      this.sideHP += (1 - sideHPCoeff) * (Ss - this.sideHP);
      const Ss_hp = Ss - this.sideHP;
      xL = Mm + Ss_hp * widthScale;
      xR = Mm - Ss_hp * widthScale;

      // ── 7. Trim + Mix ────────────────────────────────────────────────
      oL[n] = dryL * (1 - mix) + xL * mix * trimLin;
      oR[n] = dryR * (1 - mix) + xR * mix * trimLin;

      const absOut = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (absOut > peakOut) peakOut = absOut;
    }

    this.port.postMessage({ peakIn, peakOut, bassLevel, gr: grAmount, transient: transLevel });
    return true;
  }
}
registerProcessor('drumbusv3', DrumBusProcessor);
`;

export async function createDrumBusEngine(audioCtx) {
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
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelCount: 2, channelCountMode: 'explicit',
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

  let _peakIn = 0, _peakOut = 0, _bassLevel = 0, _gr = 0, _transient = 0;

  worklet.port.onmessage = e => {
    if (e.data?.peakIn    !== undefined) _peakIn    = e.data.peakIn;
    if (e.data?.peakOut   !== undefined) _peakOut   = e.data.peakOut;
    if (e.data?.bassLevel !== undefined) _bassLevel = e.data.bassLevel;
    if (e.data?.gr        !== undefined) _gr        = e.data.gr;
    if (e.data?.transient !== undefined) _transient = e.data.transient;
  };

  const _buf  = new Float32Array(2048);
  const DECAY = 0.94;
  let _smoothPeakIn = 0, _smoothPeakOut = 0;

  function getPeakFromAnalyser(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) { const a = Math.abs(_buf[i]); if (a > m) m = a; }
    return m;
  }

  const p = name => worklet.parameters.get(name);

  return {
    input, output, chainOutput,

    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setDrive:      v => { p('drive').value      = v; },
    setCrunch:     v => { p('crunch').value     = v; },
    setBoom:       v => { p('boom').value       = v; },
    setFreq:       v => { p('freq').value       = v; },
    setDamp:       v => { p('damp').value       = v; },
    setTransients: v => { p('transients').value = v; },
    setDecay:      v => { p('decay').value      = v; },
    setComp:       v => { p('comp').value       = v ? 1 : 0; },
    setDriveMode:  v => { p('driveMode').value  = v; },
    setMix:        v => { p('mix').value        = v; },
    setTrim:       v => { p('trim').value       = v; },
    setBypass:     v => { p('bypass').value     = v ? 1 : 0; },
    setWidth:      v => { p('width').value      = v; },

    getInputPeak: () => {
      _smoothPeakIn  = Math.max(getPeakFromAnalyser(analyserIn),  _smoothPeakIn  * DECAY);
      return _smoothPeakIn;
    },
    getOutputPeak: () => {
      _smoothPeakOut = Math.max(getPeakFromAnalyser(analyserOut), _smoothPeakOut * DECAY);
      return _smoothPeakOut;
    },
    getPeakIn:    () => _peakIn,
    getPeakOut:   () => _peakOut,
    getBassLevel: () => _bassLevel,
    getGR:        () => _gr,
    getTransient: () => _transient,

    connect(dest)  { output.connect(dest); },
    disconnect()   { output.disconnect(); },
    dispose() {
      worklet.disconnect();
      input.disconnect();
      inputTrim.disconnect();
      analyserIn.disconnect();
      analyserOut.disconnect();
      outputTrim.disconnect();
      output.disconnect();
      chainOutput.disconnect();
    },
  };
}
