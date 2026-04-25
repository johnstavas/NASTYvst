// op_padSynth.test.js — real-math tests for op_padSynth.
// Run via: node scripts/check_op_math.mjs
// Primaries in op_padSynth.worklet.js header (Nasca zynaddsubfx).

import { PadSynthOp } from './op_padSynth.worklet.js';

const SR  = 48000;
const N   = 1024;
const approx = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new PadSynthOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, n = N, extra = {}) {
  const out = new Float32Array(n);
  op.process(extra, { out }, n);
  return out;
}
function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}
function dftMag(buf, k) {
  const M = buf.length;
  let re = 0, im = 0;
  for (let i = 0; i < M; i++) {
    const a = -2 * Math.PI * k * i / M;
    re += buf[i] * Math.cos(a);
    im += buf[i] * Math.sin(a);
  }
  return Math.hypot(re, im);
}

const tests = [
  // ---- finite + bounded ----------------------------------------------
  {
    name: 'finite output across 1 second @ 220 Hz',
    run() {
      const out = render(freshOp({ freq: 220 }), SR);
      for (let i = 0; i < SR; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `NaN at i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'peak-normalized: |y| ≤ amp within float slop',
    run() {
      const out = render(freshOp({ freq: 220, amp: 1 }), SR);
      const p = peak(out);
      if (p > 1.01)   return { pass: false, why: `peak=${p}` };
      // Should also saturate near 1 since normalization targets it.
      if (p < 0.5)    return { pass: false, why: `peak too low=${p}` };
      return { pass: true };
    },
  },

  // ---- bandwidth=0 collapse: behaves like phase-random additive tone --
  {
    name: 'bandwidth=20c, shape=saw: fundamental stronger than 2nd harmonic',
    run() {
      // Narrow Gaussian — each harmonic lands in a few bins. Saw
      // decays 1/n, fundamental is strongest.
      const f0 = 200;
      const op  = freshOp({ freq: f0, bandwidth: 20, shape: 0, seed: 7 });
      const out = render(op, 1024);
      const fundBin = Math.round(f0 * 1024 / SR);   // 4
      const magFund = dftMag(out, fundBin);
      // Check 2nd harmonic is weaker than fundamental (saw slope).
      const harm2   = dftMag(out, Math.round(2 * f0 * 1024 / SR));
      if (!(magFund > harm2))
        return { pass: false, why: `f=${magFund.toFixed(2)} 2nd=${harm2.toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- determinism ---------------------------------------------------
  {
    name: 'same seed + params → identical output (no non-deterministic RNG)',
    run() {
      const a = render(freshOp({ freq: 220, seed: 42 }));
      const b = render(freshOp({ freq: 220, seed: 42 }));
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'different seeds → different waveforms (phase randomization is active)',
    run() {
      const a = render(freshOp({ freq: 220, seed: 1 }));
      const b = render(freshOp({ freq: 220, seed: 2 }));
      let maxDiff = 0;
      for (let i = 0; i < N; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff < 0.1) return { pass: false, why: `seeds too similar: maxDiff=${maxDiff}` };
      return { pass: true };
    },
  },

  // ---- different shape profiles produce distinct timbres --------------
  {
    name: 'shape=saw vs shape=square: different spectra',
    run() {
      const a = render(freshOp({ freq: 200, bandwidth: 20, shape: 0, seed: 3 }));
      const b = render(freshOp({ freq: 200, bandwidth: 20, shape: 1, seed: 3 }));
      // Even harmonics should be strong in saw, near-zero in square.
      const evenBin = Math.round(2 * 200 * N / SR);
      if (!(dftMag(a, evenBin) > dftMag(b, evenBin) * 3))
        return { pass: false, why: `saw-2nd=${dftMag(a, evenBin).toFixed(2)} sq-2nd=${dftMag(b, evenBin).toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- amp linearity -------------------------------------------------
  {
    name: 'amp=0.25 scales output linearly',
    run() {
      const a = render(freshOp({ freq: 220, amp: 1,    seed: 9 }));
      const b = render(freshOp({ freq: 220, amp: 0.25, seed: 9 }));
      for (let i = 0; i < N; i++)
        if (Math.abs(b[i] - 0.25 * a[i]) > 1e-6)
          return { pass: false, why: `i=${i}: ${b[i]} vs ${0.25*a[i]}` };
      return { pass: true };
    },
  },

  // ---- freq change does NOT rebuild table (playback-rate only) -------
  {
    name: 'changing freq does not rebuild the table (determinism across pitches)',
    run() {
      // If freq change rebuilt, we'd land in a different phase and the
      // first output would not depend purely on the pitched playback.
      // We verify that setParam('freq', ...) preserves determinism by
      // seeding, pitching up, re-pitching back down, and checking the
      // buffer equals the unmoved version.
      const op1 = freshOp({ freq: 220, seed: 13 });
      const a   = render(op1, 64);

      const op2 = freshOp({ freq: 220, seed: 13 });
      op2.setParam('freq', 440);
      op2.setParam('freq', 220);
      op2.reset();
      const b = render(op2, 64);
      for (let i = 0; i < 64; i++) if (!approx(a[i], b[i], 1e-6))
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- reset --------------------------------------------------------
  {
    name: 'reset() restores phase-0 start',
    run() {
      const op = freshOp({ freq: 220, seed: 7 });
      const a = render(op, 512);
      op.reset();
      const b = render(op, 512);
      for (let i = 0; i < 512; i++) if (!approx(a[i], b[i], 1e-6))
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- zero latency --------------------------------------------------
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },

  // ---- clamps --------------------------------------------------------
  {
    name: 'freq below floor clamped — no NaN',
    run() {
      const out = render(freshOp({ freq: -50, seed: 1 }));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'freq above Nyquist clamped — bounded',
    run() {
      const out = render(freshOp({ freq: 500000, seed: 1 }));
      const p = peak(out);
      if (!Number.isFinite(p) || p > 1.01) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },
  {
    name: 'bandwidth out-of-range clamps',
    run() {
      const out = render(freshOp({ freq: 220, bandwidth: 99999 }));
      const p = peak(out);
      if (!Number.isFinite(p) || p > 1.01) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },
  {
    name: 'shape out-of-range clamps (negative / huge)',
    run() {
      const a = render(freshOp({ freq: 220, shape: -5, seed: 1 }));
      const b = render(freshOp({ freq: 220, shape: 99, seed: 1 }));
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(a[i])) return { pass: false, why: `a[${i}] nan` };
        if (!Number.isFinite(b[i])) return { pass: false, why: `b[${i}] nan` };
      }
      return { pass: true };
    },
  },

  // ---- control-rate input -------------------------------------------
  {
    name: 'freqMod=0 tracks constant-freq path within float eps',
    run() {
      const fm = new Float32Array(N);
      const a = render(freshOp({ freq: 220, seed: 5 }), N, { freqMod: fm });
      const b = render(freshOp({ freq: 220, seed: 5 }), N);
      for (let i = 0; i < N; i++) if (Math.abs(a[i] - b[i]) > 1e-5)
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing out buffer → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
];

export default { opId: 'padSynth', tests };
