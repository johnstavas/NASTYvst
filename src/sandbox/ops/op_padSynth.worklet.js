// op_padSynth.worklet.js — Stage-3 op sidecar for the `padSynth` op.
//
// PADsynth algorithm by Paul Nasca. Generates a long single-cycle sample
// in the frequency domain (per-harmonic Gaussian bandwidth profile +
// random phase) then IFFTs into time domain, which is played back as a
// looped wavetable.
//
// PRIMARIES (synth-family rule = 2 minimum):
//
//   A. zynaddsubfx PADsynth documentation §3.2.1, Paul Nasca.
//      https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm
//      Verbatim pseudocode:
//          profile(fi,bwi){
//              x=fi/bwi;
//              return exp(-x*x)/bwi;
//          };
//          FOR nh = 1 to number_harmonics
//              bw_Hz=(pow(2,bw/1200)-1.0)*f*nh;
//              bwi=bw_Hz/(2.0*samplerate);
//              fi=f*nh/samplerate;
//              FOR i=0 to N/2-1
//                  hprofile=profile((i/N)-fi,bwi);
//                  freq_amp[i]=freq_amp[i]+hprofile*A[nh];
//              ENDFOR
//          ENDFOR
//          FOR i=0 to N/2-1  freq_phase[i]=RND()*2*PI;  ENDFOR
//          smp=IFFT(N,freq_amp,freq_phase);
//          normalize_sample(N,smp);
//
//   B. zynaddsubfx `src/Params/PADnoteParameters.cpp` —
//      `getprofile()` (Gaussian default `expf(-x*x)`) and
//      `generatespectrum_bandwidthMode()` (per-harmonic bandwidth
//      `(2^(bw/1200)-1)·basefreq·power(realfreq/basefreq, power)`
//      with linear-interp fill of the spectrum bin). Confirms the
//      Nasca pseudocode is what production zynaddsubfx ships.
//
// Deviations from Primary A (listed here, diffed in chat):
//   - N = 2^14 (16384) — compromise between spectral resolution and
//     build cost. zynaddsubfx defaults to 2^18 (262144) = ~5.5s @ 48k.
//     Logged as debt.
//   - RND() = deterministic 32-bit LCG seeded from `seed` param, NOT
//     runtime non-deterministic `rand()`. Keeps golden-hash stable
//     and audio reproducible. Canon:synthesis §10 LCG pattern.
//   - `A[nh]` comes from a small set of named harmonic profiles
//     (saw / square / organ / bell) rather than user-editable. Filed
//     as debt.
//   - Inline radix-2 Cooley-Tukey IFFT (same as #82 minBLEP); no FFTW.
//   - Table regenerated on any param change affecting content; freq
//     change just retunes playback (the reason we use bandwidth-in-
//     cents — same table is reusable across pitches).

const TWO_PI   = 2 * Math.PI;
const DENORMAL = 1e-30;
const N        = 16384;          // table length (2^14)
const N_HARM   = 64;             // harmonic count (plenty for bright pads)

// ---- inline radix-2 Cooley-Tukey FFT (used for IFFT during build) -------
function fft(re, im, inverse) {
  const M = re.length;
  for (let i = 1, j = 0; i < M; i++) {
    let bit = M >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t     = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= M; len <<= 1) {
    const half = len >> 1;
    const step = (inverse ? 2 : -2) * Math.PI / len;
    for (let i = 0; i < M; i += len) {
      for (let k = 0; k < half; k++) {
        const ang = step * k;
        const cs  = Math.cos(ang), sn = Math.sin(ang);
        const rR  = re[i + k + half] * cs - im[i + k + half] * sn;
        const rI  = re[i + k + half] * sn + im[i + k + half] * cs;
        re[i + k + half] = re[i + k] - rR;
        im[i + k + half] = im[i + k] - rI;
        re[i + k]         += rR;
        im[i + k]         += rI;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < M; i++) { re[i] /= M; im[i] /= M; }
  }
}

// ---- Nasca Gaussian profile ---------------------------------------------
// profile(fi, bwi) = exp(-(fi/bwi)²) / bwi
function profile(fi, bwi) {
  if (bwi <= 0) return 0;
  const x = fi / bwi;
  return Math.exp(-x * x) / bwi;
}

// ---- harmonic amplitude profiles ----------------------------------------
// A[nh] — amplitude of harmonic nh (1-indexed, nh=1 is fundamental).
// Named profiles deliberately mirror #80 wavetable bank conceptually, but
// the PAD timbre is defined by HARMONIC amplitudes — not a waveform shape.
const SHAPE_NAMES = ['saw', 'square', 'organ', 'bell'];
function harmonicAmps(shapeIndex) {
  const A = new Float64Array(N_HARM + 1);  // 1..N_HARM
  const shape = SHAPE_NAMES[shapeIndex | 0] || 'saw';
  for (let nh = 1; nh <= N_HARM; nh++) {
    if (shape === 'saw') {
      A[nh] = 1 / nh;
    } else if (shape === 'square') {
      A[nh] = (nh & 1) ? 1 / nh : 0;
    } else if (shape === 'organ') {
      // drawbar-style: fundamental + octaves weighted
      A[nh] = (nh === 1) ? 1
             : (nh === 2) ? 0.5
             : (nh === 3) ? 0.3
             : (nh === 4) ? 0.4
             : (nh === 6) ? 0.2
             : (nh === 8) ? 0.15
             : 0;
    } else { // bell — inharmonic-ish falloff, accent odd partials
      A[nh] = (1 / (nh * nh)) * (nh & 1 ? 1.2 : 0.6);
    }
  }
  return A;
}

// ---- deterministic LCG (Canon:synthesis §10 pattern) --------------------
function makeRng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    // Map to [0,1): use high 24 bits / 2^24
    return ((s >>> 8) & 0xFFFFFF) / 0x1000000;
  };
}

// ---- build the PAD table per Nasca pseudocode ---------------------------
function buildTable(basefreq, bwCents, shapeIndex, seed, sampleRate) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  const A = harmonicAmps(shapeIndex);

  // Nasca's outer loop: accumulate Gaussian-profiled harmonic energy.
  for (let nh = 1; nh <= N_HARM; nh++) {
    const amp = A[nh];
    if (amp === 0) continue;
    const f_nh   = basefreq * nh;
    if (f_nh >= sampleRate * 0.5) break;     // harmonic above Nyquist
    const bw_Hz  = (Math.pow(2, bwCents / 1200) - 1) * f_nh;
    const bwi    = bw_Hz / (2 * sampleRate);
    const fi     = f_nh / sampleRate;
    // Paper walks i from 0 to N/2−1; i/N is the normalized frequency.
    for (let i = 0; i < N / 2; i++) {
      const hprofile = profile((i / N) - fi, bwi);
      re[i] += hprofile * amp;
    }
  }

  // Random phase fill ∈ [0, 2π).
  const rnd = makeRng(seed);
  for (let i = 0; i < N / 2; i++) {
    const phase = rnd() * TWO_PI;
    const mag   = re[i];
    re[i] = mag * Math.cos(phase);
    im[i] = mag * Math.sin(phase);
  }
  // Zero the Nyquist bin and upper (negative-freq) half. Real signal
  // comes out of IFFT because we'll mirror upper half as conjugate.
  re[N / 2] = 0; im[N / 2] = 0;
  for (let i = 1; i < N / 2; i++) {
    re[N - i] =  re[i];
    im[N - i] = -im[i];
  }

  // IFFT → time domain.
  fft(re, im, true);

  // Normalize — Nasca's `normalize_sample` just peak-normalizes.
  let peak = 0;
  for (let i = 0; i < N; i++) { const a = Math.abs(re[i]); if (a > peak) peak = a; }
  const inv = peak > 0 ? (1 / peak) : 1;
  const out = new Float32Array(N + 1);
  for (let i = 0; i < N; i++) out[i] = re[i] * inv;
  out[N] = out[0];  // guard sample for branch-free lookup
  return out;
}

// -------------------------------------------------------------------------
export class PadSynthOp {
  static opId = 'padSynth';
  static inputs  = Object.freeze([{ id: 'freqMod', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',     kind: 'audio'   }]);
  static params  = Object.freeze([
    { id: 'freq',      default: 220 },
    { id: 'bandwidth', default: 40  },  // cents
    { id: 'shape',     default: 0   },  // 0..3 index
    { id: 'seed',      default: 1   },
    { id: 'amp',       default: 1   },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._freq      = 220;
    this._bw        = 40;
    this._shape     = 0;
    this._seed      = 1;
    this._amp       = 1;
    this._phase     = 0;
    // Table is pitched to `_tableBaseFreq` when built. Playback rate
    // retunes via `(freq / _tableBaseFreq) * N / sr` per sample.
    this._tableBaseFreq = this._freq;
    this._table = buildTable(this._freq, this._bw, this._shape, this._seed, this.sr);
    this._dirty = false;
  }

  reset() { this._phase = 0; }

  setParam(id, v) {
    if (id === 'freq') {
      let f = +v;
      if (!(f > 0.01))         f = 0.01;
      const nyq = this.sr * 0.5;
      if (f > nyq - 1)         f = nyq - 1;
      this._freq = f;
      // Playback-rate change only; no rebuild.
    } else if (id === 'bandwidth') {
      let bw = +v;
      if (!Number.isFinite(bw)) bw = 40;
      if (bw < 0)    bw = 0;
      if (bw > 1200) bw = 1200;
      if (bw !== this._bw) { this._bw = bw; this._dirty = true; }
    } else if (id === 'shape') {
      let s = (v | 0);
      if (s < 0) s = 0;
      if (s >= SHAPE_NAMES.length) s = SHAPE_NAMES.length - 1;
      if (s !== this._shape) { this._shape = s; this._dirty = true; }
    } else if (id === 'seed') {
      const s = (v | 0) || 1;
      if (s !== this._seed) { this._seed = s; this._dirty = true; }
    } else if (id === 'amp') {
      this._amp = +v;
    }
    if (this._dirty) {
      this._tableBaseFreq = this._freq;
      this._table = buildTable(this._freq, this._bw, this._shape, this._seed, this.sr);
      this._dirty = false;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, Nblock) {
    const out = outputs && outputs.out;
    if (!out) return;
    const fm  = inputs && inputs.freqMod;
    const sr  = this.sr;
    const nyq = sr * 0.5;
    const amp = this._amp;
    const table = this._table;
    const tableBase = this._tableBaseFreq;
    let phase = this._phase;

    for (let n = 0; n < Nblock; n++) {
      let f = this._freq;
      if (fm) {
        f += fm[n];
        if (!(f > 0.01))      f = 0.01;
        else if (f > nyq - 1) f = nyq - 1;
      }
      // Table is sampled at `sr` with fundamental at `tableBase` Hz.
      // To pitch to freq `f`, advance through the table at rate
      // `f / tableBase` samples per output sample (resampling).
      const rate = f / tableBase;
      const idx  = phase * N;
      const i    = idx | 0;
      const ff   = idx - i;
      const s0   = table[i];
      const s1   = table[i + 1];
      out[n] = amp * (s0 + ff * (s1 - s0));
      // Advance phase in fractions of the table length.
      phase += rate / N;
      while (phase >= 1) phase -= 1;
      while (phase <  0) phase += 1;
    }

    if (Math.abs(phase) < DENORMAL) phase = 0;
    this._phase = phase;
  }
}
