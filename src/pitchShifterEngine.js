// pitchShifterEngine.js — Lo-Fi Granular Pitch Shifter (MPC style)
//
// Shifts pitch up/down using two overlapping Hann-windowed grains
// reading from a circular delay buffer. Adds MPC-style lo-fi character
// via sample rate decimation + bit crushing.
//
// Controls:
//   PITCH  — semitones (-12 to +12)
//   MIX    — dry/wet blend
//   GRAIN  — grain size (small=tight, large=smooth)
//   LOFI   — sample rate reduction + bit crush (MPC grit)
//   TONE   — post-shift LP filter

const PROCESSOR_VERSION = 'v9';

const PROCESSOR_CODE = `
class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch',  defaultValue: 0,   minValue: -12, maxValue: 12 },
      { name: 'mix',    defaultValue: 1,    minValue: 0,   maxValue: 1 },
      { name: 'grain',  defaultValue: 0.5,  minValue: 0,   maxValue: 1 },
      { name: 'time',   defaultValue: 0,    minValue: 0,   maxValue: 1 },  // read offset / stretch
      { name: 'lofi',   defaultValue: 0,    minValue: 0,   maxValue: 1 },
      { name: 'drive',  defaultValue: 0,    minValue: 0,   maxValue: 1 },  // analog saturation
      { name: 'tone',   defaultValue: 1,    minValue: 0,   maxValue: 1 },
      { name: 'bypass', defaultValue: 0,    minValue: 0,   maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Circular delay buffer — 1 second
    this.bufSize = Math.ceil(this.sr);
    this.bufL = new Float32Array(this.bufSize);
    this.bufR = new Float32Array(this.bufSize);
    this.writePos = 0;

    // Two grain taps with phase + offset tracking
    this.grain1Phase = 0;
    this.grain2Phase = 0;
    this.grain1Offset = 0;
    this.grain2Offset = 0;
    this.needsInit = true;

    // Lo-fi: sample-and-hold state for decimation
    this.holdL = 0;
    this.holdR = 0;
    this.holdCounter = 0;

    // Tone LP state
    this.toneLpL = 0;
    this.toneLpR = 0;

    // Metering
    this._peakOut = 0;

    this.port.postMessage({ ready: true });
  }

  // Linear interpolation read from circular buffer
  readBuf(buf, pos) {
    const bs = this.bufSize;
    let p = pos % bs;
    if (p < 0) p += bs;
    const i = Math.floor(p);
    const f = p - i;
    return buf[i] * (1 - f) + buf[(i + 1) % bs] * f;
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const pitch  = params.pitch[0];
    const mix    = params.mix[0];
    const grain  = params.grain[0];
    const time   = params.time[0];
    const lofi   = params.lofi[0];
    const drive  = params.drive[0];
    const tone   = params.tone[0];
    const bypass = params.bypass[0] > 0.5;

    // Pitch ratio
    const ratio = Math.pow(2, pitch / 12);

    // Grain size in samples: 20ms (tight) to 120ms (smooth) — crossfade quality
    const grainSize = Math.round((20 + grain * 100) * this.sr / 1000);

    // Read offset in samples: TIME knob controls how far behind write head
    // 0 = minimal (64 samples ~1.3ms, tight), 1 = 500ms (slushy stretch)
    // Minimum must be >= grainSize so grains have valid data to read
    const timeOffset = Math.max(grainSize, Math.round(64 + time * 0.5 * this.sr));

    // Offset drift per sample: write advances by 1, read by ratio
    const drift = 1 - ratio;

    // Initialize grain phases
    if (this.needsInit) {
      this.grain1Phase = 0;
      this.grain2Phase = Math.floor(grainSize / 2);
      this.grain1Offset = timeOffset;
      this.grain2Offset = timeOffset;
      this.needsInit = false;
    }

    // Lo-fi: decimation factor — at lofi=1, downsample to ~6kHz (SP-1200 territory)
    // At lofi=0, no decimation (every sample). Exponential curve for musical feel.
    const decimFactor = lofi > 0.01 ? Math.round(1 + lofi * lofi * (this.sr / 6000)) : 1;

    // Lo-fi: bit depth — 16 bit (clean) down to ~6 bit (crunchy MPC)
    // quantization levels decrease exponentially
    const bitDepth = lofi > 0.01 ? Math.pow(2, 16 - lofi * 10) : 0;  // 0 = off

    // Tone LP coefficient
    const toneCutoff = 2000 + tone * 16000;
    const toneCoef = Math.exp(-2 * Math.PI * toneCutoff / this.sr);

    // True passthrough when pitch=0, lofi=0, drive=0 — zero latency, zero coloring
    const pitchActive = Math.abs(pitch) > 0.01;
    const lofiActive  = lofi > 0.01;
    const driveActive = drive > 0.01;
    const toneActive  = tone < 0.99;

    const bs = this.bufSize;
    const TWO_PI = 2 * Math.PI;
    let peakAccum = 0;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];

      let wetL, wetR;

      if (pitchActive) {
        // Write to circular buffer
        this.bufL[this.writePos] = dryL;
        this.bufR[this.writePos] = dryR;

        // Advance grain phases
        this.grain1Phase++;
        this.grain2Phase++;

        // Drift the offsets
        this.grain1Offset += drift;
        this.grain2Offset += drift;

        // Reset grains when their windows complete
        if (this.grain1Phase >= grainSize) {
          this.grain1Phase = 0;
          this.grain1Offset = timeOffset;
        }
        if (this.grain2Phase >= grainSize) {
          this.grain2Phase = 0;
          this.grain2Offset = timeOffset;
        }

        // Clamp offsets to valid range
        const maxOff = bs - 1;
        const off1 = Math.max(1, Math.min(maxOff, this.grain1Offset));
        const off2 = Math.max(1, Math.min(maxOff, this.grain2Offset));

        // Read positions
        const rp1 = this.writePos - off1;
        const rp2 = this.writePos - off2;

        // Read with interpolation
        const s1L = this.readBuf(this.bufL, rp1);
        const s1R = this.readBuf(this.bufR, rp1);
        const s2L = this.readBuf(this.bufL, rp2);
        const s2R = this.readBuf(this.bufR, rp2);

        // Hann windows — offset by half, sum to ~1.0
        const w1 = 0.5 - 0.5 * Math.cos(TWO_PI * this.grain1Phase / grainSize);
        const w2 = 0.5 - 0.5 * Math.cos(TWO_PI * this.grain2Phase / grainSize);
        // Normalize so windows always sum to 1.0 (prevents amplitude modulation)
        const wSum = w1 + w2 || 1;

        // Overlap-add with normalized windows
        wetL = (s1L * w1 + s2L * w2) / wSum;
        wetR = (s1R * w1 + s2R * w2) / wSum;

        // Advance write head
        this.writePos = (this.writePos + 1) % bs;
      } else {
        // No pitch shift — clean passthrough, zero latency
        wetL = dryL;
        wetR = dryR;
      }

      // ── Lo-fi: sample rate decimation (sample-and-hold) ───────────
      if (lofiActive) {
        if (decimFactor > 1) {
          this.holdCounter++;
          if (this.holdCounter >= decimFactor) {
            this.holdCounter = 0;
            this.holdL = wetL;
            this.holdR = wetR;
          }
          wetL = this.holdL;
          wetR = this.holdR;
        }

        // Bit crushing
        if (bitDepth > 0) {
          wetL = Math.round(wetL * bitDepth) / bitDepth;
          wetR = Math.round(wetR * bitDepth) / bitDepth;
        }
      }

      // ── Analog saturation — asymmetric tanh for H2 warmth ─────────
      if (driveActive) {
        const dGain = 1 + drive * 7;
        const bias = drive * 0.12;
        const dL = (wetL + bias * wetL * wetL) * dGain;
        const dR = (wetR + bias * wetR * wetR) * dGain;
        const norm = Math.tanh(dGain) || 1;
        wetL = Math.tanh(dL) / norm;
        wetR = Math.tanh(dR) / norm;
      }

      // Tone LP filter — skip when fully open for transparency
      if (toneActive) {
        this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * wetL;
        this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * wetR;
        wetL = this.toneLpL;
        wetR = this.toneLpR;
      }

      // Mix
      const outL = dryL * (1 - mix) + wetL * mix;
      const outR = dryR * (1 - mix) + wetR * mix;

      if (bypass) {
        oL[n] = dryL;
        oR[n] = dryR;
      } else {
        oL[n] = outL;
        oR[n] = outR;
      }

      const ap = Math.max(Math.abs(outL), Math.abs(outR));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: this._peakOut });

    return true;
  }
}

registerProcessor('pitch-shifter-processor-${PROCESSOR_VERSION}', PitchShifterProcessor);
`;

export async function createPitchShifterEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();  // chain routing — don't touch gain
  const output      = audioCtx.createGain();  // chain routing — don't touch gain
  const chainOutput = audioCtx.createGain();  // chain routing — don't touch gain

  // Separate trim nodes inside the signal path
  const inputTrim  = audioCtx.createGain();
  const outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, `pitch-shifter-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  // Chain: input → inputTrim → analyserIn → worklet → analyserOut → outputTrim → output/chainOutput
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
    setPitch:   v => { p('pitch').value  = v; },
    setMix:     v => { p('mix').value    = v; },
    setGrain:   v => { p('grain').value  = v; },
    setTime:    v => { p('time').value   = v; },
    setLofi:    v => { p('lofi').value   = v; },
    setDrive:   v => { p('drive').value  = v; },
    setTone:    v => { p('tone').value   = v; },
    setBypass:  v => { p('bypass').value = v ? 1 : 0; },

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
