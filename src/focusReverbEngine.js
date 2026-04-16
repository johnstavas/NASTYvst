// focusReverbEngine.js — FOCUS REVERB: Clarity-Preserving Reverb
//
// Reverb around the source, not on top:
//   - Source detector: envelope follower on mid-frequency band (500Hz-4kHz)
//   - Reverb core: Schroeder-style (4 parallel comb filters + 2 series allpass)
//   - Dynamic clarity manager: frequency-dependent ducking in 500Hz-4kHz when source active
//   - Masking-region duck: sidechain reverb output through dynamic EQ
//   - Wrap layer: widen reverb signal (mid-side) while keeping source centered
//
// Controls:
//   FOCUS      — clarity ducking amount (0-1)
//   WRAP       — stereo widening of reverb (0-1)
//   SEPARATION — how aggressively reverb avoids center (0-1)
//   SIZE       — room size (0-1)
//   TONE       — dark-bright (0-1)
//   MIX        — dry/wet (0-1)
//   OUTPUT     — gain in dB mapped 0-1 => -18..+18dB
//   BYPASS

const PROCESSOR_VERSION = 'focusreverb-v1';

const PROCESSOR_CODE = `
class FocusReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'focus',      defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'wrap',       defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'separation', defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'size',       defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'tone',       defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'mix',        defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'output',     defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'bypass',     defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth',     defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Source Detector: bandpass 500Hz-4kHz + envelope follower ──
    this.srcBpL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.srcBpR = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.srcEnv = 0;

    // ── Schroeder Reverb: 4 parallel comb + 2 series allpass ──
    // Comb filter delay lengths (prime-ish, scaled by size)
    this.combBaseLens = [1117, 1277, 1399, 1523];
    this.combMaxLen = 6000;
    this.combBufs = [];
    this.combPos = [];
    this.combLp = [0, 0, 0, 0]; // internal damping
    for (let i = 0; i < 4; i++) {
      this.combBufs.push(new Float32Array(this.combMaxLen));
      this.combPos.push(0);
    }

    // Allpass filters (2 in series)
    this.apBaseLens = [337, 521];
    this.apMaxLen = 1200;
    this.apBufs = [];
    this.apPos = [];
    for (let i = 0; i < 2; i++) {
      this.apBufs.push(new Float32Array(this.apMaxLen));
      this.apPos.push(0);
    }

    // ── Stereo decorrelation: second reverb instance offset ──
    this.combBufsR = [];
    this.combPosR = [];
    this.combLpR = [0, 0, 0, 0];
    this.combBaseLensR = [1187, 1307, 1429, 1553]; // slightly different primes for R
    for (let i = 0; i < 4; i++) {
      this.combBufsR.push(new Float32Array(this.combMaxLen));
      this.combPosR.push(0);
    }
    this.apBufsR = [];
    this.apPosR = [];
    for (let i = 0; i < 2; i++) {
      this.apBufsR.push(new Float32Array(this.apMaxLen));
      this.apPosR.push(0);
    }

    // ── Clarity manager: bandpass for ducking region ──
    this.clarityBpL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.clarityBpR = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.clarityLpL = 0;
    this.clarityLpR = 0;

    // ── Tone filter ──
    this.toneLpL = 0;
    this.toneLpR = 0;

    // ── Metering ──
    this._peak = 0;
    this._srcActivity = 0;
    this._reverbLevel = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  biquad(state, b0, b1, b2, a1, a2, x) {
    const y = b0 * x + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
    state.x2 = state.x1; state.x1 = x;
    state.y2 = state.y1; state.y1 = y;
    return y;
  }

  bpfCoeffs(fc, Q) {
    const w0 = 2 * Math.PI * Math.min(fc, this.sr * 0.45) / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - alpha) / a0 };
  }

  // Comb filter: write input, read delayed with feedback and damping
  processComb(bufs, pos, lpState, combLen, input, feedback, damping, idx) {
    const buf = bufs[idx];
    const p = pos[idx];
    const len = Math.min(combLen, this.combMaxLen - 1);

    // Read from delay
    let readPos = p - len;
    while (readPos < 0) readPos += this.combMaxLen;
    const delayed = buf[readPos % this.combMaxLen];

    // Damping LP
    lpState[idx] = damping * lpState[idx] + (1 - damping) * delayed;
    const dampedDelayed = lpState[idx];

    // Write back with feedback
    buf[p] = input + dampedDelayed * feedback;
    pos[idx] = (p + 1) % this.combMaxLen;

    return delayed;
  }

  // Allpass filter
  processAllpass(bufs, pos, apLen, input, gain, idx) {
    const buf = bufs[idx];
    const p = pos[idx];
    const len = Math.min(apLen, this.apMaxLen - 1);

    let readPos = p - len;
    while (readPos < 0) readPos += this.apMaxLen;
    const delayed = buf[readPos % this.apMaxLen];

    const y = -gain * input + delayed;
    buf[p] = input + gain * y;
    pos[idx] = (p + 1) % this.apMaxLen;

    return y;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const focus      = params.focus[0];
    const wrap       = params.wrap[0];
    const separation = params.separation[0];
    const size       = params.size[0];
    const tone       = params.tone[0];
    const mix        = params.mix[0];
    const outRaw     = params.output[0];
    const bypass     = params.bypass[0] > 0.5;
    const outDb      = -18 + outRaw * 36;
    const outGain    = Math.pow(10, outDb / 20);
    const sr         = this.sr;

    let peakAccum = 0;
    let srcAccum = 0;
    let reverbAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this._srcActivity = 0;
      this._reverbLevel = 0;
      this.port.postMessage({ peak: peakAccum, srcActivity: 0, reverbLevel: 0 });
      return true;
    }

    // ── Source detector bandpass coefficients (center ~1.5kHz, wide Q) ──
    const srcBp = this.bpfCoeffs(1500, 0.7);

    // ── Comb lengths scaled by size ──
    const sizeScale = 0.4 + size * 2.4;
    const combLens = this.combBaseLens.map(b => Math.round(b * sizeScale));
    const combLensR = this.combBaseLensR.map(b => Math.round(b * sizeScale));

    // ── Feedback amount ── wider range for more dramatic decay
    const feedback = 0.55 + size * 0.33; // 0.55 to 0.88

    // ── Damping: tone controls damping frequency ── wider range
    const dampFreq = 1200 + tone * 17000;
    const damping = Math.exp(-2 * Math.PI * dampFreq / sr);

    // ── Allpass lengths (slightly scaled) ──
    const apLens = this.apBaseLens.map(b => Math.round(b * (0.8 + size * 0.4)));
    const apGain = 0.5;

    // ── Source envelope constants ──
    const atkCoef = Math.exp(-1 / (sr * 0.003));
    const relCoef = Math.exp(-1 / (sr * 0.08));

    // ── Clarity band coefficients ──
    const clarBp = this.bpfCoeffs(2000, 0.6);

    // ── Tone LP ──
    const toneCutoff = 1200 + tone * 18000;
    const toneCoef = Math.exp(-2 * Math.PI * toneCutoff / sr);

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;

      // ═══════════════════════════════════════════════════════
      // Step 1: Source Detection
      // ═══════════════════════════════════════════════════════
      const srcL = this.biquad(this.srcBpL, srcBp.b0, srcBp.b1, srcBp.b2, srcBp.a1, srcBp.a2, dryL);
      const srcR = this.biquad(this.srcBpR, srcBp.b0, srcBp.b1, srcBp.b2, srcBp.a1, srcBp.a2, dryR);
      const srcMag = Math.abs(srcL) + Math.abs(srcR);

      if (srcMag > this.srcEnv) {
        this.srcEnv = atkCoef * this.srcEnv + (1 - atkCoef) * srcMag;
      } else {
        this.srcEnv = relCoef * this.srcEnv;
      }
      const srcActivity = Math.min(1, this.srcEnv * 5);
      srcAccum += srcActivity;

      // ═══════════════════════════════════════════════════════
      // Step 2: Schroeder Reverb (L channel)
      // ═══════════════════════════════════════════════════════
      // 4 parallel comb filters
      let combSumL = 0;
      for (let c = 0; c < 4; c++) {
        combSumL += this.processComb(this.combBufs, this.combPos, this.combLp, combLens[c], mono, feedback, damping, c);
      }
      combSumL *= 0.25;

      // 2 series allpass
      let revL = combSumL;
      for (let a = 0; a < 2; a++) {
        revL = this.processAllpass(this.apBufs, this.apPos, apLens[a], revL, apGain, a);
      }

      // ═══════════════════════════════════════════════════════
      // Step 2b: Schroeder Reverb (R channel — decorrelated)
      // ═══════════════════════════════════════════════════════
      let combSumR = 0;
      for (let c = 0; c < 4; c++) {
        combSumR += this.processComb(this.combBufsR, this.combPosR, this.combLpR, combLensR[c], mono, feedback, damping, c);
      }
      combSumR *= 0.25;

      let revR = combSumR;
      for (let a = 0; a < 2; a++) {
        revR = this.processAllpass(this.apBufsR, this.apPosR, apLens[a], revR, apGain, a);
      }

      // ═══════════════════════════════════════════════════════
      // Step 3: Dynamic Clarity Manager
      // Frequency-dependent ducking: reduce reverb in 500Hz-4kHz when source active
      // ═══════════════════════════════════════════════════════
      const duckAmount = focus * srcActivity;

      // Extract clarity band from reverb
      const clarL = this.biquad(this.clarityBpL, clarBp.b0, clarBp.b1, clarBp.b2, clarBp.a1, clarBp.a2, revL);
      const clarR = this.biquad(this.clarityBpR, clarBp.b0, clarBp.b1, clarBp.b2, clarBp.a1, clarBp.a2, revR);

      // Duck the clarity band proportionally — much stronger ducking
      revL = revL - clarL * duckAmount * 1.5;
      revR = revR - clarR * duckAmount * 1.5;

      // ═══════════════════════════════════════════════════════
      // Step 4: Tone Filter
      // ═══════════════════════════════════════════════════════
      this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * revL;
      this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * revR;
      revL = revL * tone + this.toneLpL * (1 - tone);
      revR = revR * tone + this.toneLpR * (1 - tone);

      // ═══════════════════════════════════════════════════════
      // Step 5: Wrap Layer (mid-side widening)
      // Keep source centered, widen reverb
      // ═══════════════════════════════════════════════════════
      const revMid  = (revL + revR) * 0.5;
      const revSide = (revL - revR) * 0.5;

      // Separation: when source is active, push reverb to sides more — much wider
      const sepFactor = 1 + separation * srcActivity * 2; // up to 3x side
      const wrapFactor = 0.3 + wrap * 1.7;

      const finalRevL = revMid * (1 - separation * srcActivity * 0.3) + revSide * wrapFactor * sepFactor;
      const finalRevR = revMid * (1 - separation * srcActivity * 0.3) - revSide * wrapFactor * sepFactor;

      // Track reverb energy
      reverbAccum += Math.abs(finalRevL) + Math.abs(finalRevR);

      // ═══════════════════════════════════════════════════════
      // Smooth LP filter on wet signal
      // ═══════════════════════════════════════════════════════
      let wetL = finalRevL;
      let wetR = finalRevR;

      // Soft-clip wet signal to prevent distortion
      wetL = Math.tanh(wetL);
      wetR = Math.tanh(wetR);

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

      // ═══════════════════════════════════════════════════════
      // Output
      // ═══════════════════════════════════════════════════════
      const outL = (dryL * (1 - mix) + wetL * mix) * outGain;
      const outR = (dryR * (1 - mix) + wetR * mix) * outGain;

      oL[n] = outL;
      oR[n] = outR;

      const ap = Math.max(Math.abs(outL), Math.abs(outR));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._srcActivity = srcAccum / iL.length;
    this._reverbLevel = reverbAccum / iL.length;

    this.port.postMessage({
      peak: peakAccum,
      srcActivity: this._srcActivity,
      reverbLevel: this._reverbLevel,
    });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', FocusReverbProcessor);
`;

export async function createFocusReverbEngine(audioCtx) {
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

  let _peak = 0, _srcActivity = 0, _reverbLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.srcActivity !== undefined) _srcActivity = e.data.srcActivity;
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
    setInputGain:   v => { inputTrim.gain.value  = v; },
    setOutputGain:  v => { outputTrim.gain.value = v; },
    setFocus:       v => { p('focus').value      = v; },
    setWrap:        v => { p('wrap').value       = v; },
    setSeparation:  v => { p('separation').value = v; },
    setSize:        v => { p('size').value       = v; },
    setTone:        v => { p('tone').value       = v; },
    setMix:         v => { p('mix').value        = v; },
    setOutput:      v => { p('output').value     = v; },
    setBypass:      v => { p('bypass').value     = v ? 1 : 0; },
    setSmooth:      v => { p('smooth').value     = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getSrcActivity: () => _srcActivity,
    getReverbLevel: () => _reverbLevel,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
