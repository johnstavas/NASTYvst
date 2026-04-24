// op_kWeighting.test.js — real-math tests for op_kWeighting.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against ITU-R BS.1770-5 Annex 1 (K-weighting) and
// Mansbridge et al. 2012 reference coefficient set. Tests cover:
//   - Canonical 48 kHz coefficient match to BS.1770-5 reference table
//   - K-curve frequency response: ~0 dB @ 1 kHz, ~+4 dB @ 10 kHz,
//     attenuation below 100 Hz, strong sub-audio suppression
//   - Sample-rate independence (44.1k and 96k give same K-curve shape
//     at the same freqs)
//   - DC rejection (RLB HP drives DC → 0)
//   - Impulse response is stable and decays
//   - Standard: reset, denormal flush, defensive null, determinism

import { KWeightingOp } from './op_kWeighting.worklet.js';

const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(sr = 48000) {
  const op = new KWeightingOp(sr);
  op.reset();
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

function tailRms(buf, skip) {
  let s = 0, n = 0;
  for (let i = skip; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

function gainDb(sr, freq, n = 16384, skip = 10000) {
  const op = freshOp(sr);
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = Math.sin(2 * Math.PI * freq * i / sr);
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return 20 * Math.log10(tailRms(out, skip) / tailRms(inBuf, skip));
}

const tests = [
  // ---- canonical 48 kHz coefficients ---------------------------------
  {
    name: 'Fs=48k canonical Stage-1 coefs match BS.1770-5 reference to 1e-8',
    run() {
      const op = freshOp(48000);
      // Reference (BS.1770-5 Annex 1, as cited in Mansbridge 2012 Table 1):
      //   b0 = 1.53512485958697, b1 = -2.69169618940638, b2 = 1.19839281085285
      //   a1 = -1.69065929318241, a2 = 0.73248077421585
      const { b0, b1, b2, a1, a2 } = op._s1;
      const tol = 1e-8;
      if (Math.abs(b0 - 1.53512485958697)  > tol) return { pass: false, why: `s1.b0=${b0}` };
      if (Math.abs(b1 - (-2.69169618940638)) > tol) return { pass: false, why: `s1.b1=${b1}` };
      if (Math.abs(b2 - 1.19839281085285)  > tol) return { pass: false, why: `s1.b2=${b2}` };
      if (Math.abs(a1 - (-1.69065929318241)) > tol) return { pass: false, why: `s1.a1=${a1}` };
      if (Math.abs(a2 - 0.73248077421585)  > tol) return { pass: false, why: `s1.a2=${a2}` };
      return { pass: true };
    },
  },
  {
    name: 'Fs=48k canonical Stage-2 coefs match BS.1770-5 reference to 1e-8',
    run() {
      const op = freshOp(48000);
      // Reference: b = [1, -2, 1] (pure HP numerator),
      //           a1 = -1.99004745483398, a2 = 0.99007225036621
      const { b0, b1, b2, a1, a2 } = op._s2;
      const tol = 1e-8;
      if (Math.abs(b0 - 1)  > tol) return { pass: false, why: `s2.b0=${b0}` };
      if (Math.abs(b1 - (-2)) > tol) return { pass: false, why: `s2.b1=${b1}` };
      if (Math.abs(b2 - 1)  > tol) return { pass: false, why: `s2.b2=${b2}` };
      if (Math.abs(a1 - (-1.99004745483398)) > tol) return { pass: false, why: `s2.a1=${a1}` };
      if (Math.abs(a2 - 0.99007225036621)  > tol) return { pass: false, why: `s2.a2=${a2}` };
      return { pass: true };
    },
  },

  // ---- K-curve shape ----------------------------------------------
  //
  // Reference K-curve values (published BS.1770-5 magnitude response):
  //   20 Hz  ≈ −14 dB     (RLB HP rolloff deep)
  //   30 Hz  ≈  −8 dB
  //   100 Hz ≈  −1 dB     (RLB shoulder)
  //   500 Hz ≈   0 dB
  //   1 kHz  ≈ +0.7 dB    (shelf starting to engage — NOT 0 dB contrary
  //                        to popular belief; only equals 0 at ~500 Hz)
  //   10 kHz ≈ +4 dB      (shelf HF asymptote)
  {
    name: 'K-curve: gain at 1 kHz ≈ +0.7 dB (shelf partially engaged)',
    run() {
      const g = gainDb(48000, 1000);
      if (Math.abs(g - 0.7) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'K-curve: gain at 10 kHz ≈ +4 dB (shelf asymptote)',
    run() {
      const g = gainDb(48000, 10000);
      if (Math.abs(g - 4.0) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'K-curve: gain at 500 Hz ≈ 0 dB (K-curve crossover)',
    run() {
      const g = gainDb(48000, 500);
      if (Math.abs(g) > 0.3) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'K-curve: gain at 100 Hz ≈ −1 dB (RLB shoulder)',
    run() {
      const g = gainDb(48000, 100);
      if (Math.abs(g - (-1.0)) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'K-curve: gain at 30 Hz strongly attenuated (sub-audio rejection)',
    run() {
      const g = gainDb(48000, 30);
      if (g > -5) return { pass: false, why: `${g.toFixed(3)} dB (want ≪ 0)` };
      return { pass: true };
    },
  },
  {
    name: 'K-curve: 10 kHz louder than 1 kHz (positive shelf slope)',
    run() {
      const g10k = gainDb(48000, 10000);
      const g1k  = gainDb(48000, 1000);
      if (g10k - g1k < 2.5) return { pass: false, why: `${(g10k - g1k).toFixed(3)} dB diff` };
      return { pass: true };
    },
  },
  {
    name: 'K-curve: 100 Hz quieter than 1 kHz (negative LF slope)',
    run() {
      const g100 = gainDb(48000, 100);
      const g1k  = gainDb(48000, 1000);
      if (g1k - g100 < 1.0) return { pass: false, why: `${(g1k - g100).toFixed(3)} dB diff` };
      return { pass: true };
    },
  },

  // ---- sample-rate independence ------------------------------------
  {
    name: 'Fs=44.1 kHz: 1 kHz gain still ≈ +0.7 dB',
    run() {
      const g = gainDb(44100, 1000);
      if (Math.abs(g - 0.7) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'Fs=96 kHz: 1 kHz gain still ≈ +0.7 dB',
    run() {
      const g = gainDb(96000, 1000);
      if (Math.abs(g - 0.7) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'Fs=96 kHz: 10 kHz gain still ≈ +4 dB (shelf pre-warped correctly)',
    run() {
      const g = gainDb(96000, 10000);
      if (Math.abs(g - 4.0) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },

  // ---- DC behavior --------------------------------------------------
  {
    name: 'DC input: output decays to 0 (RLB HP kills DC)',
    run() {
      const op = freshOp(48000);
      const { out } = render(op, 1.0, 96000);   // 2 seconds of DC at 48k
      // With fc = 38 Hz HP, DC reaches −∞ dB at steady state.
      if (Math.abs(out[95999]) > 1e-3) return { pass: false, why: `end=${out[95999]}` };
      return { pass: true };
    },
  },

  // ---- impulse response stable -------------------------------------
  {
    name: 'impulse response: finite, decays, bounded',
    run() {
      const op = freshOp(48000);
      const n = 8192;
      const inBuf = new Float32Array(n);
      inBuf[0] = 1.0;
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { out }, n);
      let peak = 0;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        peak = Math.max(peak, Math.abs(out[i]));
      }
      if (peak > 3) return { pass: false, why: `unbounded peak=${peak}` };
      // Tail should be tiny (impulse response has decayed).
      const tailPeak = Math.max(...Array.from(out.subarray(7000, 8000)).map(Math.abs));
      if (tailPeak > 0.01) return { pass: false, why: `tail peak=${tailPeak}` };
      return { pass: true };
    },
  },

  // ---- reset -------------------------------------------------------
  {
    name: 'reset() clears all 8 filter state taps',
    run() {
      const op = freshOp(48000);
      render(op, 1.0, 2048);
      op.reset();
      if (op._s1x1 !== 0 || op._s1y1 !== 0 || op._s2x1 !== 0 || op._s2y1 !== 0) {
        return { pass: false, why: 'state not cleared' };
      }
      const { out } = render(op, 0, 4);
      for (let i = 0; i < 4; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush ---------------------------------------------
  {
    name: 'denormal flush: tiny state + zero input → state → 0',
    run() {
      const op = freshOp(48000);
      op._s1y1 = 1e-35; op._s1y2 = 1e-35;
      op._s2y1 = 1e-35; op._s2y2 = 1e-35;
      render(op, 0, 128);
      if (op._s1y1 !== 0 || op._s1y2 !== 0 || op._s2y1 !== 0 || op._s2y2 !== 0) {
        return { pass: false, why: `state: ${op._s1y1},${op._s1y2},${op._s2y1},${op._s2y2}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive ---------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp(48000);
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'very loud sine (amp=5) stays finite (no internal blowup)',
    run() {
      const op = freshOp(48000);
      const n = 4096;
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = 5 * Math.sin(2 * Math.PI * 1000 * i / 48000);
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { out }, n);
      for (let i = 0; i < n; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- determinism ------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const mk = () => {
        const op = freshOp(48000);
        const inBuf = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) inBuf[i] = Math.sin(i * 0.03) * 0.7;
        const out = new Float32Array(1024);
        op.process({ in: inBuf }, { out }, 1024);
        return out;
      };
      const a = mk();
      const b = mk();
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'kWeighting', tests };
