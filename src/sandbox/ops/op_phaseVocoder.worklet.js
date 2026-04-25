// op_phaseVocoder.worklet.js — Stage-3 op sidecar for the `phaseVocoder` op.
//
// Catalog #68 (Analysis/Spectral family). Phase-vocoder bin-shift pitch
// shifter. Input/output: complex (re,im) streams. Composes between
// #66 stft (analysis) and #67 istft (resynthesis) to form a complete
// spectral pitch-shift pipeline:
//
//     audio → stft → phaseVocoder(pitchShift) → istft → audio
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   Bernsee smbPitchShift — phase vocoder pitch shift (WOL license).
//   Cited via TarsosDSP port (Bernsee's original site intermittent):
//     URL: https://raw.githubusercontent.com/JorenSix/TarsosDSP/master/core/src/main/java/be/tarsos/dsp/PitchShifter.java
//   Canon:time_interp §6 points here.
//
// PASSAGES VERBATIM:
//
//   // --- ANALYSIS ---
//   // magn = 2·sqrt(re·re + im·im); phase = atan2(im, re)
//   // tmp = phase - previousPhase[i];
//   // tmp -= (double)i * excpt;                        // expected phase advance
//   // long qpd = (long)(tmp/Math.PI);
//   // if (qpd >= 0) qpd += qpd & 1; else qpd -= qpd & 1;
//   // tmp -= Math.PI * (double)qpd;                    // wrap to ±π
//   // tmp = osamp * tmp / (2.*Math.PI);
//   // tmp = (double)i * freqPerBin + tmp * freqPerBin; // true frequency
//   // currentFrequencies[i] = (float) tmp;
//
//   // --- SYNTHESIS ---
//   // magn = newMagnitudes[i];
//   // tmp = newFrequencies[i];
//   // tmp -= (double)i * freqPerBin;
//   // tmp /= freqPerBin;
//   // tmp = 2.*Math.PI * tmp / osamp;
//   // tmp += (double)i * excpt;                        // expected phase back
//   // summedPhase[i] += tmp;                           // phase accumulation
//   // phase = summedPhase[i];
//   // newFFTData[2*i]   = magn * cos(phase);
//   // newFFTData[2*i+1] = magn * sin(phase);
//
//   where:
//     freqPerBin = sampleRate / fftFrameSize
//     excpt      = 2·π · hopSize / fftFrameSize
//
// DEVIATIONS from primary passages:
//   1. Fixed osamp = 1, hop = size. Contract: full frame at a time,
//      no analysis/synthesis overlap. This makes the sandbox op
//      self-contained (no coordination with stft/istft hop). The
//      real-world quality use case (osamp≥4) needs OLA coordination
//      that belongs at the graph level; tracked as P2 debt.
//   2. `excpt = 2π·hop/size = 2π` with osamp=1, hop=size. The `i*excpt`
//      term simplifies to `2π·i` which is exactly 0 modulo 2π, but
//      we keep the subtraction and re-addition for clarity and
//      numerical parity with the cited code.
//   3. Bin-shift: magnitude-accumulate form (`synMagn[bin] += anaMagn[k]`)
//      matching Bernsee. Multiple analysis bins landing on the same
//      synthesis bin sum their magnitudes; true-frequency from the
//      most-recently-written bin wins. This is the original behavior.
//   4. `pitchShift` clamped [0.25, 4.0] to keep destination bins
//      inside the spectrum. Outside this range bins mostly fall off
//      the edge and output is near-silent.
//   5. Defensive null I/O + denormal flush on phase state arrays.
//
// CONTRACT:
//   - Inputs: `real`, `imag` — one complex sample per cycle
//   - Outputs: `real`, `imag` — one complex sample per cycle
//   - Every `size` input samples constitutes one frame. On frame
//     boundary: fire PV transform; begin emitting transformed
//     spectrum over the next `size` cycles.
//   - Latency = size (one frame of buffering).

const DENORMAL = 1e-30;

export class PhaseVocoderOp {
  static opId = 'phaseVocoder';
  static inputs  = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static outputs = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static params  = Object.freeze([
    { id: 'size',       default: 1024 },
    { id: 'pitchShift', default: 1.0  },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._size      = 0;
    this._pitch     = 1.0;
    this._inRe      = null;   // current frame (re, im) as collected
    this._inIm      = null;
    this._outRe     = null;   // transformed frame, emitted bin-by-bin
    this._outIm     = null;
    this._lastPhase = null;   // analysis phase memory
    this._sumPhase  = null;   // synthesis phase accumulator
    this._anaMagn   = null;   // analysis magnitudes
    this._anaFreq   = null;   // analysis true-frequencies
    this._synMagn   = null;   // synthesis-shifted magnitudes
    this._synFreq   = null;   // synthesis-shifted frequencies
    this._writeIdx  = 0;      // cursor into inRe/inIm
    this._readIdx   = 0;      // cursor into outRe/outIm
    this._filled    = 0;      // samples collected into current frame
    this._alloc(1024);
  }

  reset() {
    if (this._inRe)      this._inRe.fill(0);
    if (this._inIm)      this._inIm.fill(0);
    if (this._outRe)     this._outRe.fill(0);
    if (this._outIm)     this._outIm.fill(0);
    if (this._lastPhase) this._lastPhase.fill(0);
    if (this._sumPhase)  this._sumPhase.fill(0);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
  }

  setParam(id, v) {
    if (id === 'size') {
      const n = +v;
      if (n !== this._size) this._alloc(n);
      return;
    }
    if (id === 'pitchShift') {
      this._pitch = Math.min(Math.max(+v, 0.25), 4.0);
      return;
    }
  }

  getLatencySamples() { return this._size; }

  _alloc(n) {
    const isPow2 = (x) => x > 0 && (x & (x - 1)) === 0;
    const floorPow2 = (x) => { let p = 1; while (p * 2 <= x) p *= 2; return p; };
    const size = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size      = size;
    this._inRe      = new Float64Array(size);
    this._inIm      = new Float64Array(size);
    this._outRe     = new Float64Array(size);
    this._outIm     = new Float64Array(size);
    this._lastPhase = new Float64Array(size);
    this._sumPhase  = new Float64Array(size);
    this._anaMagn   = new Float64Array(size);
    this._anaFreq   = new Float64Array(size);
    this._synMagn   = new Float64Array(size);
    this._synFreq   = new Float64Array(size);
    this._writeIdx  = 0;
    this._readIdx   = 0;
    this._filled    = 0;
  }

  process(inputs, outputs, N) {
    const inRe  = inputs.real;
    const inIm  = inputs.imag;
    const outRe = outputs.real;
    const outIm = outputs.imag;
    if (!outRe && !outIm) return;

    const size = this._size;
    for (let i = 0; i < N; i++) {
      // Top-of-loop fire when a full frame is buffered.
      if (this._filled >= size) {
        this._processFrame();
        this._filled  = 0;
        this._readIdx = 0;
      }

      // Emit transformed spectrum bin-by-bin.
      const r = this._readIdx;
      if (outRe) outRe[i] = this._outRe[r];
      if (outIm) outIm[i] = this._outIm[r];
      this._readIdx = (r + 1) % size;

      // Collect current sample into the incoming frame buffer.
      this._inRe[this._writeIdx] = inRe ? inRe[i] : 0;
      this._inIm[this._writeIdx] = inIm ? inIm[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % size;
      this._filled++;
    }
  }

  _processFrame() {
    const N           = this._size;
    const osamp       = 1;
    const freqPerBin  = this.sr / N;
    const excpt       = 2 * Math.PI * N / N / osamp;   // = 2π (osamp=1)
    const pitch       = this._pitch;
    const inRe        = this._inRe;
    const inIm        = this._inIm;
    const outRe       = this._outRe;
    const outIm       = this._outIm;
    const lastPhase   = this._lastPhase;
    const sumPhase    = this._sumPhase;
    const anaMagn     = this._anaMagn;
    const anaFreq     = this._anaFreq;
    const synMagn     = this._synMagn;
    const synFreq     = this._synFreq;

    // Zero synthesis bins before accumulation.
    for (let k = 0; k < N; k++) { synMagn[k] = 0; synFreq[k] = 0; }

    // --- ANALYSIS (verbatim from Bernsee/TarsosDSP) ---
    for (let k = 0; k < N; k++) {
      const re = inRe[k];
      const im = inIm[k];
      const magn  = 2 * Math.sqrt(re * re + im * im);
      const phase = Math.atan2(im, re);

      let tmp = phase - lastPhase[k];
      lastPhase[k] = phase;

      tmp -= k * excpt;
      let qpd = Math.trunc(tmp / Math.PI);
      if (qpd >= 0) qpd += qpd & 1;
      else          qpd -= qpd & 1;
      tmp -= Math.PI * qpd;

      tmp = osamp * tmp / (2 * Math.PI);
      tmp = k * freqPerBin + tmp * freqPerBin;

      anaMagn[k] = magn;
      anaFreq[k] = tmp;
    }

    // --- BIN SHIFT ---
    for (let k = 0; k < N; k++) {
      const bin = Math.round(k * pitch);
      if (bin >= 0 && bin < N) {
        synMagn[bin] += anaMagn[k];
        synFreq[bin]  = anaFreq[k] * pitch;
      }
    }

    // --- SYNTHESIS (verbatim from Bernsee/TarsosDSP) ---
    for (let k = 0; k < N; k++) {
      const magn = synMagn[k];
      let tmp = synFreq[k];
      tmp -= k * freqPerBin;
      tmp /= freqPerBin;
      tmp = 2 * Math.PI * tmp / osamp;
      tmp += k * excpt;
      sumPhase[k] += tmp;

      // Denormal flush on accumulated phase.
      if (sumPhase[k] < DENORMAL && sumPhase[k] > -DENORMAL) sumPhase[k] = 0;

      const phase = sumPhase[k];
      outRe[k] = magn * Math.cos(phase);
      outIm[k] = magn * Math.sin(phase);
    }
  }
}
