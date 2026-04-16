// airliftEngine.js — AIRLIFT: High-End Vocal Air Enhancer
//
// Harmonic lift in 8-16kHz via half-wave rectification + bandpass
// Dynamic high shelf that follows envelope
// Harshness guard: dynamic notch 2-5kHz
// Silk smoothing: 1-pole LP on generated harmonics
// Output polish: subtle tape-like soft clipping
//
// Controls:
//   AIR     — harmonic lift amount (0-1)
//   SILK    — smoothing on generated harmonics (0-1)
//   SHINE   — dynamic high shelf brightness (0-1)
//   GUARD   — harshness notch sensitivity (0-1)
//   MIX     — dry/wet (0-1)
//   OUTPUT  — output gain in dB mapped 0-1 => -18..+18dB
//   BYPASS

const PROCESSOR_VERSION = 'airlift-v1';

const PROCESSOR_CODE = `
class AirliftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'air',    defaultValue: 0.4,  minValue: 0, maxValue: 1 },
      { name: 'silk',   defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'shine',  defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'guard',  defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 1.0,  minValue: 0, maxValue: 1 },
      { name: 'output', defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Harmonic generation bandpass (8-16kHz region) ──
    // 2nd-order BPF state per channel
    // Pre-compute for ~11kHz center
    this.bpL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bpR = { x1: 0, x2: 0, y1: 0, y2: 0 };

    // ── Dynamic high shelf state ──
    // 1-pole shelf filter states
    this.shelfL = 0;
    this.shelfR = 0;

    // ── Harshness guard notch (2-5kHz) ──
    this.notchL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.notchR = { x1: 0, x2: 0, y1: 0, y2: 0 };

    // ── Envelope followers ──
    this.envHigh = 0;    // for dynamic shelf
    this.envHarsh = 0;   // for harshness guard
    this.envSource = 0;  // source level

    // ── Silk smoothing state ──
    this.silkL = 0;
    this.silkR = 0;

    // ── Metering ──
    this._peak = 0;
    this._airLevel = 0;
    this._guardActive = 0;

    this.port.postMessage({ ready: true });
  }

  // Biquad processing helper
  biquad(state, b0, b1, b2, a1, a2, x) {
    const y = b0 * x + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
    state.x2 = state.x1; state.x1 = x;
    state.y2 = state.y1; state.y1 = y;
    return y;
  }

  // Compute BPF coefficients (constant-Q)
  bpfCoeffs(fc, Q) {
    const w0 = 2 * Math.PI * fc / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return {
      b0: (alpha) / a0,
      b1: 0,
      b2: (-alpha) / a0,
      a1: (-2 * Math.cos(w0)) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  // Compute notch coefficients
  notchCoeffs(fc, Q) {
    const w0 = 2 * Math.PI * fc / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return {
      b0: 1 / a0,
      b1: (-2 * Math.cos(w0)) / a0,
      b2: 1 / a0,
      a1: (-2 * Math.cos(w0)) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  // High shelf coefficients
  highShelfCoeffs(fc, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * fc / this.sr;
    const cs = Math.cos(w0);
    const sn = Math.sin(w0);
    const alpha = sn / (2 * 0.707);
    const a0 = (A + 1) - (A - 1) * cs + 2 * Math.sqrt(A) * alpha;
    return {
      b0: (A * ((A + 1) + (A - 1) * cs + 2 * Math.sqrt(A) * alpha)) / a0,
      b1: (-2 * A * ((A - 1) + (A + 1) * cs)) / a0,
      b2: (A * ((A + 1) + (A - 1) * cs - 2 * Math.sqrt(A) * alpha)) / a0,
      a1: (2 * ((A - 1) - (A + 1) * cs)) / a0,
      a2: ((A + 1) - (A - 1) * cs - 2 * Math.sqrt(A) * alpha) / a0,
    };
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const air    = params.air[0];
    const silk   = params.silk[0];
    const shine  = params.shine[0];
    const guard  = params.guard[0];
    const mix    = params.mix[0];
    const outRaw = params.output[0];
    const bypass = params.bypass[0] > 0.5;

    // Output gain: 0-1 maps to -18..+18 dB
    const outDb = -18 + outRaw * 36;
    const outGain = Math.pow(10, outDb / 20);

    let peakAccum = 0;
    let airAccum = 0;
    let guardAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this._airLevel = 0;
      this._guardActive = 0;
      this.port.postMessage({ peak: peakAccum, airLevel: 0, guardActive: 0 });
      return true;
    }

    const sr = this.sr;

    // ── Bandpass for harmonic region: center ~11kHz, Q=1.2 ──
    const bpCenter = Math.min(11000, sr * 0.42);
    const bp = this.bpfCoeffs(bpCenter, 1.2);

    // ── Harshness guard notch: center sweeps 2.5-4.5kHz based on energy ──
    const guardSens = 0.2 + guard * 0.6;

    // ── Dynamic shelf: 6-8kHz shelf, gain based on envelope ──
    const shelfFreq = 7000;
    const maxShelfGain = 3 + shine * 9; // 3-12dB

    // ── Envelope time constants ──
    const atkFast = Math.exp(-1 / (sr * 0.001));   // 1ms attack
    const relFast = Math.exp(-1 / (sr * 0.05));    // 50ms release
    const atkSlow = Math.exp(-1 / (sr * 0.01));    // 10ms
    const relSlow = Math.exp(-1 / (sr * 0.15));    // 150ms release

    // ── Silk smoothing coefficient ──
    const silkFreq = 20000 - silk * 14000; // 20kHz down to 6kHz
    const silkCoef = Math.exp(-2 * Math.PI * silkFreq / sr);

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];
      const mono = (dryL + dryR) * 0.5;
      const absMono = Math.abs(mono);

      // ── Envelope followers ──
      // Source envelope
      if (absMono > this.envSource) {
        this.envSource = atkFast * this.envSource + (1 - atkFast) * absMono;
      } else {
        this.envSource = relSlow * this.envSource;
      }

      // ── Step 1: Harmonic generation via half-wave rectification ──
      const hwL = dryL > 0 ? dryL : 0;
      const hwR = dryR > 0 ? dryR : 0;

      // Bandpass the rectified signal to isolate 8-16kHz harmonics
      let harmL = this.biquad(this.bpL, bp.b0, bp.b1, bp.b2, bp.a1, bp.a2, hwL);
      let harmR = this.biquad(this.bpR, bp.b0, bp.b1, bp.b2, bp.a1, bp.a2, hwR);

      // ── Step 2: Silk smoothing on harmonics ──
      this.silkL = silkCoef * this.silkL + (1 - silkCoef) * harmL;
      this.silkR = silkCoef * this.silkR + (1 - silkCoef) * harmR;
      harmL = this.silkL;
      harmR = this.silkR;

      // Scale harmonics by air amount
      const airGain = air * 3.0;
      harmL *= airGain;
      harmR *= airGain;

      // Track air energy
      const airEnergy = Math.abs(harmL) + Math.abs(harmR);
      airAccum += airEnergy;

      // ── Step 3: Envelope for dynamic shelf ──
      const highEnergy = airEnergy * 0.5;
      if (highEnergy > this.envHigh) {
        this.envHigh = atkFast * this.envHigh + (1 - atkFast) * highEnergy;
      } else {
        this.envHigh = relFast * this.envHigh;
      }

      // Dynamic shelf gain: only boosts when signal supports it
      const dynShelfGain = Math.min(maxShelfGain, maxShelfGain * Math.min(1, this.envSource * 6));
      const shelf = this.highShelfCoeffs(shelfFreq, dynShelfGain * shine);

      // Apply shelf to the combined signal
      let procL = dryL + harmL;
      let procR = dryR + harmR;

      // Simple 1-pole high shelf approximation for efficiency
      const shelfMix = Math.min(1, this.envSource * 4) * shine;
      this.shelfL += (procL - this.shelfL) * 0.15;
      this.shelfR += (procR - this.shelfR) * 0.15;
      const shelfSigL = procL + (procL - this.shelfL) * shelfMix * 2;
      const shelfSigR = procR + (procR - this.shelfR) * shelfMix * 2;
      procL = shelfSigL;
      procR = shelfSigR;

      // ── Step 4: Harshness guard ──
      // Detect energy in 2-5kHz range
      const harshBand = Math.abs(dryL - this.shelfL); // crude high-mid energy
      if (harshBand > this.envHarsh) {
        this.envHarsh = atkSlow * this.envHarsh + (1 - atkSlow) * harshBand;
      } else {
        this.envHarsh = relSlow * this.envHarsh;
      }

      const guardAmount = Math.min(1, this.envHarsh * 10) * guardSens;
      guardAccum += guardAmount;

      if (guardAmount > 0.05) {
        // Dynamic notch centered around 3.5kHz
        const notchFreq = 3500;
        const notchQ = 1.5 + (1 - guard) * 3; // narrower when guard is high
        const nc = this.notchCoeffs(notchFreq, notchQ);

        // Apply notch proportionally
        const notchL = this.biquad(this.notchL, nc.b0, nc.b1, nc.b2, nc.a1, nc.a2, procL);
        const notchR = this.biquad(this.notchR, nc.b0, nc.b1, nc.b2, nc.a1, nc.a2, procR);
        procL = procL * (1 - guardAmount) + notchL * guardAmount;
        procR = procR * (1 - guardAmount) + notchR * guardAmount;
      }

      // ── Step 5: Output polish — subtle tape saturation ──
      const satAmount = 0.15 + air * 0.15;
      procL = Math.tanh(procL * (1 + satAmount)) / (1 + satAmount);
      procR = Math.tanh(procR * (1 + satAmount)) / (1 + satAmount);

      // ── Mix and output ──
      const finalL = (dryL * (1 - mix) + procL * mix) * outGain;
      const finalR = (dryR * (1 - mix) + procR * mix) * outGain;

      oL[n] = finalL;
      oR[n] = finalR;

      const ap = Math.max(Math.abs(finalL), Math.abs(finalR));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._airLevel = airAccum / iL.length;
    this._guardActive = guardAccum / iL.length;

    this.port.postMessage({
      peak: peakAccum,
      airLevel: this._airLevel,
      guardActive: this._guardActive
    });

    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', AirliftProcessor);
`;

export async function createAirliftEngine(audioCtx) {
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

  let _peak = 0, _airLevel = 0, _guardActive = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.airLevel !== undefined) _airLevel = e.data.airLevel;
    if (e.data?.guardActive !== undefined) _guardActive = e.data.guardActive;
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
    setAir:        v => { p('air').value    = v; },
    setSilk:       v => { p('silk').value   = v; },
    setShine:      v => { p('shine').value  = v; },
    setGuard:      v => { p('guard').value  = v; },
    setMix:        v => { p('mix').value    = v; },
    setOutput:     v => { p('output').value = v; },
    setBypass:     v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getAirLevel:    () => _airLevel,
    getGuardActive: () => _guardActive,

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
