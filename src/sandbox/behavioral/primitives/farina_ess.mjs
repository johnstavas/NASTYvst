// farina_ess.mjs — Exponential sine sweep + harmonic separation.
//
// Citation: Farina, A. "Simultaneous Measurement of Impulse Response and
// Distortion with a Swept-Sine Technique." AES 108th Convention, 2000.
// https://www.aes.org/e-lib/browse.cfm?elib=10211
//
// Method:
//   Logarithmic sweep f(t) = f1 · exp(t · ln(f2/f1) / T) for t ∈ [0, T].
//   Convolve output with the time-reversed amplitude-equalized inverse sweep.
//   Result has linear impulse response at t=0 and nth-harmonic IRs at
//   negative offsets Δt_n = T · ln(n) / ln(f2/f1).
//
// Day 1 scope: generate sweep + inverse + provide convolve helper. Magnitude
// response and harmonic separation extraction land in Day 2 when the filter
// metric module needs them. Today's compressor module does not require these.

const TAU = 2 * Math.PI;

/**
 * Generate a Farina exponential sine sweep.
 * @param {number} N        sample count of the sweep portion (excludes pre/post silence)
 * @param {number} sr       sample rate
 * @param {number} f1       start frequency, Hz
 * @param {number} f2       end frequency, Hz
 * @param {number} amp      peak amplitude (linear, e.g. 0.25 = -12 dBFS)
 * @returns {Float32Array}  the sweep
 */
export function farinaSweep(N, sr, f1 = 20, f2 = 20000, amp = 0.25) {
  const out = new Float32Array(N);
  const T = N / sr;
  const lnRatio = Math.log(f2 / f1);
  const K = (T * TAU * f1) / lnRatio;
  const L = T / lnRatio;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    out[i] = amp * Math.sin(K * (Math.exp(t / L) - 1));
  }
  return out;
}

/**
 * Generate the inverse (matched) filter for a Farina sweep.
 * Matched-filter: time-reverse the sweep, multiply by exponential envelope
 * to compensate for the +3 dB/oct of the log sweep, so deconvolution gives
 * a flat-magnitude impulse response.
 *
 * envelope(t) = exp(-t · ln(f2/f1) / T)
 */
export function farinaInverse(N, sr, f1 = 20, f2 = 20000, amp = 0.25) {
  const sweep = farinaSweep(N, sr, f1, f2, amp);
  const inv = new Float32Array(N);
  const T = N / sr;
  const lnRatio = Math.log(f2 / f1);
  // Time-reverse + amplitude correct.
  // Amplitude correction: at sample i of inverse (corresponds to sweep sample N-1-i),
  // sweep is at time t = (N-1-i)/sr. Envelope = f1/f(t) = exp(-t·lnRatio/T).
  for (let i = 0; i < N; i++) {
    const tRev = (N - 1 - i) / sr;
    const env  = Math.exp(-tRev * lnRatio / T);
    inv[i] = sweep[N - 1 - i] * env;
  }
  return inv;
}

// FFT-based linear convolution (Day 2 land).
import { fftRadix2 } from './thd.mjs';

function nextPow2(n) {
  let p = 1; while (p < n) p <<= 1; return p;
}

/**
 * Linear convolution of two real-valued buffers via FFT.
 * Returns Float32Array of length a.length + b.length - 1.
 */
export function convolve(a, b) {
  const M = a.length + b.length - 1;
  const N = nextPow2(M);
  const aRe = new Float32Array(N), aIm = new Float32Array(N);
  const bRe = new Float32Array(N), bIm = new Float32Array(N);
  for (let i = 0; i < a.length; i++) aRe[i] = a[i];
  for (let i = 0; i < b.length; i++) bRe[i] = b[i];
  fftRadix2(aRe, aIm);
  fftRadix2(bRe, bIm);
  // Multiply pointwise.
  const cRe = new Float32Array(N), cIm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    cRe[i] = aRe[i] * bRe[i] - aIm[i] * bIm[i];
    cIm[i] = aRe[i] * bIm[i] + aIm[i] * bRe[i];
  }
  // Inverse FFT = conjugate, FFT, conjugate, scale by 1/N.
  for (let i = 0; i < N; i++) cIm[i] = -cIm[i];
  fftRadix2(cRe, cIm);
  const out = new Float32Array(M);
  const inv = 1 / N;
  for (let i = 0; i < M; i++) out[i] = cRe[i] * inv;
  return out;
}

/**
 * Extract the linear impulse response from a Farina deconvolution result.
 *
 * After convolving (output, inverse), the linear IR sits centered at index
 * (sweepLen - 1) — the end of the sweep + start of the inverse aligns there.
 * We take a window around that point.
 *
 * @param {Float32Array} deconv  output of convolve(processedSweep, inverse)
 * @param {number} sweepLen      length of the original sweep in samples
 * @param {number} irLen         length of IR window to extract (default 8192)
 * @returns {Float32Array}       length irLen
 */
export function extractLinearIR(deconv, sweepLen, irLen = 8192) {
  const ir = new Float32Array(irLen);
  const center = sweepLen - 1;
  const start = center;
  for (let i = 0; i < irLen && start + i < deconv.length; i++) {
    ir[i] = deconv[start + i];
  }
  return ir;
}

/**
 * Compute magnitude response (dB) from an impulse response.
 * Returns frequencies + magnitude in dB at logarithmically-spaced frequencies.
 *
 * @param {Float32Array} ir
 * @param {number} sr
 * @param {number} numFreqBins  number of log-spaced output frequencies
 * @param {number} fMin, fMax   frequency range
 * @returns {{ freqs: Float32Array, magsDb: Float32Array }}
 */
export function magnitudeResponse(ir, sr, { numFreqBins = 64, fMin = 20, fMax = 20000 } = {}) {
  const N = nextPow2(ir.length);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < ir.length; i++) re[i] = ir[i];
  fftRadix2(re, im);

  const freqs = new Float32Array(numFreqBins);
  const magsDb = new Float32Array(numFreqBins);
  const lnRatio = Math.log(fMax / fMin);
  for (let k = 0; k < numFreqBins; k++) {
    const f = fMin * Math.exp(k * lnRatio / (numFreqBins - 1));
    freqs[k] = f;
    const bin = Math.round(f * N / sr);
    if (bin >= N / 2) { magsDb[k] = -120; continue; }
    const mag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
    magsDb[k] = mag > 0 ? 20 * Math.log10(mag) : -120;
  }
  return { freqs, magsDb };
}

/**
 * Find the −3 dB cutoff frequency in a magnitude response.
 * Looks for the lowest frequency where magsDb drops by 3 dB from the
 * passband peak.
 *
 * @param {{freqs, magsDb}} response
 * @param {'lp'|'hp'|'bp'|'notch'} kind
 * @returns {number|null} cutoff frequency, or null if not found
 */
export function findCutoff(response, kind = 'lp') {
  const { freqs, magsDb } = response;
  // Reference: passband mean for LP = first 25% of bins, HP = last 25%.
  let refStart, refEnd;
  if (kind === 'lp') { refStart = 0; refEnd = Math.floor(freqs.length * 0.25); }
  else if (kind === 'hp') { refStart = Math.floor(freqs.length * 0.75); refEnd = freqs.length; }
  else { refStart = 0; refEnd = freqs.length; }

  let refSum = 0, refCount = 0;
  for (let i = refStart; i < refEnd; i++) {
    if (Number.isFinite(magsDb[i])) { refSum += magsDb[i]; refCount++; }
  }
  const refDb = refCount > 0 ? refSum / refCount : 0;
  const targetDb = refDb - 3;

  if (kind === 'lp' || kind === 'notch') {
    // Find first frequency where mags drops below target.
    for (let i = 0; i < freqs.length; i++) {
      if (magsDb[i] < targetDb) return freqs[i];
    }
  } else if (kind === 'hp') {
    // Find last frequency (walking backward) where mag is above target,
    // then the next one below it.
    for (let i = freqs.length - 1; i >= 0; i--) {
      if (magsDb[i] < targetDb) return freqs[Math.min(i + 1, freqs.length - 1)];
    }
  }
  return null;
}
