// thd.mjs — total harmonic distortion via FFT bin-summing.
//
// Citation: AES17-2020 "AES standard method for digital audio engineering —
// Measurement of digital audio equipment". Test signal: 997 Hz sine
// (non-harmonic with common sample rates) at 0 dBFS RMS. Bandlimit 20 kHz.
// THD = sqrt(Σ V²_k for k=2..N) / V_fundamental.
//
// Day 1 minimal implementation: provides Hann-windowed FFT, harmonic
// power summing, single-tone THD at given frequency. Day 2 adds the AES17
// 20 kHz brick-wall filter.

const TAU = 2 * Math.PI;

/**
 * Hann window of length N.
 */
function hann(N) {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(TAU * i / (N - 1)));
  return w;
}

/**
 * Iterative radix-2 FFT. In-place over real (re) / imag (im) arrays of equal
 * power-of-two length. Standard textbook implementation.
 */
export function fftRadix2(re, im) {
  const N = re.length;
  if ((N & (N - 1)) !== 0) throw new Error(`fftRadix2: N (${N}) is not power of 2`);
  // Bit-reverse permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Cooley-Tukey
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const angle = -TAU / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < halfLen; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + halfLen] * curRe - im[i + k + halfLen] * curIm;
        const bIm = re[i + k + halfLen] * curIm + im[i + k + halfLen] * curRe;
        re[i + k]           = aRe + bRe;
        im[i + k]           = aIm + bIm;
        re[i + k + halfLen] = aRe - bRe;
        im[i + k + halfLen] = aIm - bIm;
        const nRe = curRe * wRe - curIm * wIm;
        const nIm = curRe * wIm + curIm * wRe;
        curRe = nRe; curIm = nIm;
      }
    }
  }
}

/**
 * Compute magnitude spectrum of a real-valued signal. Pads or truncates to
 * the nearest power-of-two ≤ buffer length. Applies Hann window unless told
 * otherwise.
 */
export function magnitudeSpectrum(buf, options = {}) {
  const useWindow = options.window !== false;
  // Pick largest power of two ≤ buf.length.
  let N = 1;
  while ((N << 1) <= buf.length) N <<= 1;
  if (N < 16) throw new Error(`magnitudeSpectrum: buffer too short (${buf.length})`);

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const offset = options.offset || 0;
  if (useWindow) {
    const w = hann(N);
    for (let i = 0; i < N; i++) re[i] = buf[offset + i] * w[i];
  } else {
    for (let i = 0; i < N; i++) re[i] = buf[offset + i];
  }
  fftRadix2(re, im);

  const half = N / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return { mag, N };
}

/**
 * Find the bin index of a given frequency for a given FFT length and SR.
 */
function freqToBin(freq, N, sr) {
  return freq * N / sr;
}

/**
 * Sum power in a small neighborhood (±halfBins) around a target bin. Used
 * to capture spectral leakage from windowing while avoiding harmonic
 * cross-talk.
 */
function binPower(mag, centerBin, halfBins = 2) {
  const lo = Math.max(0, Math.round(centerBin) - halfBins);
  const hi = Math.min(mag.length - 1, Math.round(centerBin) + halfBins);
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += mag[i] * mag[i];
  return sum;
}

/**
 * Compute THD on a steady single-tone output. Pass the section of the
 * output buffer AFTER the op has settled (skip ~0.5 s of warm-up). Returns
 * THD as a fraction (0.01 = 1%).
 *
 * @param {Float32Array} buf      output samples (post-settle)
 * @param {number} sr             sample rate
 * @param {number} fundamentalHz  fundamental frequency
 * @param {number} maxHarmonic    highest harmonic to include (default 10)
 * @returns {{ thd: number, fundamentalPower: number, harmonicPower: number,
 *             harmonicLevels: number[] }}
 */
export function thdSingleTone(buf, sr, fundamentalHz, maxHarmonic = 10) {
  const { mag, N } = magnitudeSpectrum(buf);
  const halfFreq = sr / 2;

  const f1Bin = freqToBin(fundamentalHz, N, sr);
  const fundamentalPower = binPower(mag, f1Bin);

  let harmonicPower = 0;
  const harmonicLevels = [];
  for (let n = 2; n <= maxHarmonic; n++) {
    const fn = fundamentalHz * n;
    if (fn >= halfFreq) { harmonicLevels.push(0); continue; }
    const bin = freqToBin(fn, N, sr);
    const p = binPower(mag, bin);
    harmonicPower += p;
    harmonicLevels.push(Math.sqrt(p));
  }

  const thd = fundamentalPower > 0 ? Math.sqrt(harmonicPower / fundamentalPower) : 0;
  return {
    thd,
    fundamentalPower,
    harmonicPower,
    harmonicLevels, // [|2H|, |3H|, ..., |maxHarmonic H|]
  };
}

/**
 * Convert linear amplitude to dBFS (assumes full-scale = 1.0).
 */
export function linearToDb(linear) {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/**
 * Convert dBFS to linear amplitude.
 */
export function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * RMS over a buffer (or sub-range).
 */
export function rms(buf, start = 0, end = buf.length) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += buf[i] * buf[i];
  const n = end - start;
  return n > 0 ? Math.sqrt(sum / n) : 0;
}
