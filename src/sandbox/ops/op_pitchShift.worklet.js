// op_pitchShift.worklet.js — Stage-3 op sidecar for the `pitchShift` op.
//
// Catalog #28 (Delay / Time). Streaming phase-vocoder pitch shifter with
// internal FIFO + windowed-STFT + Overlap-Add. Distinct from #68
// phaseVocoder (which is one-frame-in / one-frame-out, orchestrated
// externally); this op is the user-facing shifter you drop into a chain.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   Stephan M. Bernsee, "smbPitchShift.cpp", (C) 1999-2015.
//   Downloaded via curl to: C:/Users/HEAT2/Downloads/smbPitchShift.cpp
//   Function body lines 60–219 read verbatim before transcription.
//   License: "... this source code is provided as is, without any express
//   or implied warranty of any kind ... free to use or re-use" (file header).
//
// PASSAGES VERBATIM (from the downloaded file — see lines quoted above):
//
//   stepSize     = fftFrameSize/osamp
//   freqPerBin   = sampleRate/fftFrameSize
//   expct        = 2π · stepSize/fftFrameSize
//   inFifoLatency = fftFrameSize - stepSize
//
//   Hann window:  w[k] = -0.5·cos(2π·k/fftFrameSize) + 0.5
//
//   ANALYSIS:
//     magn  = 2·√(re²+im²)
//     phase = atan2(im, re)
//     tmp   = phase − lastPhase[k];  lastPhase[k] = phase
//     tmp  -= k·expct
//     qpd   = tmp/π;  if(qpd≥0) qpd+=qpd&1 else qpd-=qpd&1
//     tmp  -= π·qpd
//     tmp   = osamp·tmp/(2π)
//     trueFreq = k·freqPerBin + tmp·freqPerBin
//
//   BIN SHIFT:
//     index = ⌊k·pitchShift⌋
//     synMagn[index] += anaMagn[k]
//     synFreq[index]  = anaFreq[k] · pitchShift
//
//   SYNTHESIS:
//     tmp   = synFreq[k] − k·freqPerBin
//     tmp  /= freqPerBin
//     tmp   = 2π·tmp/osamp
//     tmp  += k·expct
//     sumPhase[k] += tmp
//     re = magn·cos(sumPhase[k]);  im = magn·sin(sumPhase[k])
//
//   OLA:
//     outAccum[k] += 2·w[k]·ifft[k] / (fftFrameSize2 · osamp)
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **FFT_SIZE fixed at 2048, osamp fixed at 4.** Bernsee exposes
//      both as function args; v1 hardcodes to the most common setting.
//      stepSize = 512, latency = 1536 samples (~32 ms @ 48 kHz).
//      Debt row: expose as params; add 1024/4096 options.
//   2. **Self-contained radix-2 Cooley-Tukey FFT** matching Bernsee's
//      `smbFft` in-place bit-reverse + butterfly form (lines 224–279
//      of source). Same sign convention (sign=-1 forward, +1 inverse).
//   3. **pitchShift param clamp** [0.25, 4.0] — two-octave range.
//      Outside this, severe artifacts from excessive bin-stretch /
//      aliasing. Bernsee puts no clamp; we add it defensively.
//   4. **Denormal flush** on FIFO reads and accumulator taps.
//   5. **Equal-power dry/wet mix** in-op per dry_wet_mix_rule.md.
//   6. **Instance-local state.** Bernsee uses file-static arrays;
//      obviously we can't — each op instance has its own FIFO /
//      lastPhase / sumPhase / outAccum.
//   7. **Float32 I/O, Float64 internals.** Bernsee uses float
//      throughout; we upcast to double for phase accumulation
//      (sumPhase grows without bound; f32 loses precision in hours).

const DENORMAL = 1e-30;
const FFT_SIZE   = 2048;
const FFT_SIZE_2 = FFT_SIZE / 2;
const OSAMP      = 4;
const STEP_SIZE  = FFT_SIZE / OSAMP;          // 512
const LATENCY    = FFT_SIZE - STEP_SIZE;      // 1536
const TWO_PI     = Math.PI * 2;
const EXPCT      = TWO_PI * STEP_SIZE / FFT_SIZE;

// Precomputed Hann window.
const WINDOW = new Float64Array(FFT_SIZE);
for (let k = 0; k < FFT_SIZE; k++) {
  WINDOW[k] = -0.5 * Math.cos(TWO_PI * k / FFT_SIZE) + 0.5;
}

// --- In-place radix-2 Cooley-Tukey FFT (matches Bernsee smbFft). ---
// Buffer is interleaved re/im, length 2*N. sign=-1 forward, +1 inverse.
function smbFft(buf, N, sign) {
  // bit reversal
  for (let i = 2, j = 0; i < 2 * N - 2; i += 2) {
    let bitm = N;
    for (; bitm >= 2; bitm >>= 1) {
      if (!(j & bitm)) break;
      j ^= bitm;
    }
    j ^= bitm;
    if (i < j) {
      let t = buf[i];     buf[i]     = buf[j];     buf[j]     = t;
      t     = buf[i + 1]; buf[i + 1] = buf[j + 1]; buf[j + 1] = t;
    }
  }
  const kMax = Math.log(N) / Math.log(2);
  for (let k = 0, le = 2; k < kMax; k++) {
    le <<= 1;
    const le2 = le >> 1;
    let ur = 1.0, ui = 0.0;
    const arg = Math.PI / (le2 >> 1);
    const wr  = Math.cos(arg);
    const wi  = sign * Math.sin(arg);
    for (let j = 0; j < le2; j += 2) {
      for (let i = j; i < 2 * N; i += le) {
        const tr = buf[i + le2]     * ur - buf[i + le2 + 1] * ui;
        const ti = buf[i + le2]     * ui + buf[i + le2 + 1] * ur;
        buf[i + le2]     = buf[i]     - tr;
        buf[i + le2 + 1] = buf[i + 1] - ti;
        buf[i]           = buf[i]     + tr;
        buf[i + 1]       = buf[i + 1] + ti;
      }
      const tr = ur * wr - ui * wi;
      ui       = ur * wi + ui * wr;
      ur       = tr;
    }
  }
}

export class PitchShiftOp {
  static opId    = 'pitchShift';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'pitch', default: 1.0 }, // 1.0 = unison, 2.0 = +1 oct, 0.5 = -1 oct
    { id: 'mix',   default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this.freqPerBin = sampleRate / FFT_SIZE;

    this._pitch = 1.0;
    this._mix   = 1.0;

    this._inFIFO    = new Float64Array(FFT_SIZE);
    this._outFIFO   = new Float64Array(FFT_SIZE);
    this._fft       = new Float64Array(2 * FFT_SIZE);
    this._lastPhase = new Float64Array(FFT_SIZE_2 + 1);
    this._sumPhase  = new Float64Array(FFT_SIZE_2 + 1);
    this._outAccum  = new Float64Array(2 * FFT_SIZE);
    this._anaFreq   = new Float64Array(FFT_SIZE);
    this._anaMagn   = new Float64Array(FFT_SIZE);
    this._synFreq   = new Float64Array(FFT_SIZE);
    this._synMagn   = new Float64Array(FFT_SIZE);
    this._rover     = LATENCY;
  }

  reset() {
    this._inFIFO.fill(0);
    this._outFIFO.fill(0);
    this._fft.fill(0);
    this._lastPhase.fill(0);
    this._sumPhase.fill(0);
    this._outAccum.fill(0);
    this._anaFreq.fill(0);
    this._anaMagn.fill(0);
    this._synFreq.fill(0);
    this._synMagn.fill(0);
    this._rover = LATENCY;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'pitch') {
      this._pitch = n < 0.25 ? 0.25 : (n > 4.0 ? 4.0 : n);
    } else if (id === 'mix') {
      this._mix = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return LATENCY; }

  _processFrame() {
    const fft       = this._fft;
    const inFIFO    = this._inFIFO;
    const lastPhase = this._lastPhase;
    const sumPhase  = this._sumPhase;
    const outAccum  = this._outAccum;
    const anaFreq   = this._anaFreq;
    const anaMagn   = this._anaMagn;
    const synFreq   = this._synFreq;
    const synMagn   = this._synMagn;
    const freqPerBin = this.freqPerBin;
    const pitchShift = this._pitch;

    // Windowed re/im interleave.
    for (let k = 0; k < FFT_SIZE; k++) {
      fft[2 * k]     = inFIFO[k] * WINDOW[k];
      fft[2 * k + 1] = 0;
    }

    // Forward transform.
    smbFft(fft, FFT_SIZE, -1);

    // Analysis: magn, true frequency per bin.
    for (let k = 0; k <= FFT_SIZE_2; k++) {
      const real = fft[2 * k];
      const imag = fft[2 * k + 1];
      const magn = 2.0 * Math.sqrt(real * real + imag * imag);
      const phase = Math.atan2(imag, real);

      let tmp = phase - lastPhase[k];
      lastPhase[k] = phase;
      tmp -= k * EXPCT;

      let qpd = tmp / Math.PI | 0;
      if (qpd >= 0) qpd += qpd & 1;
      else          qpd -= qpd & 1;
      tmp -= Math.PI * qpd;

      tmp = OSAMP * tmp / TWO_PI;
      tmp = k * freqPerBin + tmp * freqPerBin;

      anaMagn[k] = magn;
      anaFreq[k] = tmp;
    }

    // Pitch-shift: remap bins.
    synMagn.fill(0, 0, FFT_SIZE);
    synFreq.fill(0, 0, FFT_SIZE);
    for (let k = 0; k <= FFT_SIZE_2; k++) {
      const index = Math.floor(k * pitchShift);
      if (index <= FFT_SIZE_2) {
        synMagn[index] += anaMagn[k];
        synFreq[index]  = anaFreq[k] * pitchShift;
      }
    }

    // Synthesis: accumulate phase, build re/im.
    for (let k = 0; k <= FFT_SIZE_2; k++) {
      const magn = synMagn[k];
      let tmp = synFreq[k];
      tmp -= k * freqPerBin;
      tmp /= freqPerBin;
      tmp = TWO_PI * tmp / OSAMP;
      tmp += k * EXPCT;
      sumPhase[k] += tmp;
      const phase = sumPhase[k];
      fft[2 * k]     = magn * Math.cos(phase);
      fft[2 * k + 1] = magn * Math.sin(phase);
    }
    // Zero negative frequencies.
    for (let k = FFT_SIZE + 2; k < 2 * FFT_SIZE; k++) fft[k] = 0;

    // Inverse transform.
    smbFft(fft, FFT_SIZE, 1);

    // OLA: window and accumulate.
    const olaScale = 2.0 / (FFT_SIZE_2 * OSAMP);
    for (let k = 0; k < FFT_SIZE; k++) {
      outAccum[k] += olaScale * WINDOW[k] * fft[2 * k];
    }

    // Copy stepSize to outFIFO.
    const outFIFO = this._outFIFO;
    for (let k = 0; k < STEP_SIZE; k++) outFIFO[k] = outAccum[k];

    // Shift accumulator left by stepSize.
    outAccum.copyWithin(0, STEP_SIZE);
    outAccum.fill(0, FFT_SIZE - STEP_SIZE + STEP_SIZE, 2 * FFT_SIZE);
    // Guard: explicitly zero the tail region that copyWithin leaves.
    for (let k = FFT_SIZE; k < 2 * FFT_SIZE; k++) outAccum[k] = 0;

    // Shift inFIFO left by stepSize.
    inFIFO.copyWithin(0, STEP_SIZE);
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const mix  = this._mix;
    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;
      this._inFIFO[this._rover] = x;
      let y = this._outFIFO[this._rover - LATENCY];
      if (y > -DENORMAL && y < DENORMAL) y = 0;
      out[i] = gDry * x + gWet * y;
      this._rover++;
      if (this._rover >= FFT_SIZE) {
        this._rover = LATENCY;
        this._processFrame();
      }
    }
  }
}
