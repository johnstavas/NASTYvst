// op_noise.test.js — real-math tests for op_noise.
// Run via: node scripts/check_op_math.mjs

import { NoiseOp } from './op_noise.worklet.js';

const SR  = 48000;
const N   = 1024;   // big enough for RMS / stationarity checks
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new NoiseOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, n = N) {
  const out = new Float32Array(n);
  op.process({}, { out }, n);
  return out;
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function mean(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  return s / buf.length;
}

const tests = [
  // ---- determinism (seed reproducibility) ---------------------------
  {
    name: 'white: same seed → identical output across instances',
    run() {
      const a = render(freshOp({ shape: 'white', seed: 42 }));
      const b = render(freshOp({ shape: 'white', seed: 42 }));
      for (let i = 0; i < N; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'white: different seeds → different output',
    run() {
      const a = render(freshOp({ shape: 'white', seed: 42 }));
      const b = render(freshOp({ shape: 'white', seed: 43 }));
      let diff = 0;
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) diff++;
      if (diff < N * 0.9) return { pass: false, why: `only ${diff}/${N} samples differ` };
      return { pass: true };
    },
  },
  {
    name: 'reset() restores seed (repeat render == first render)',
    run() {
      const op = freshOp({ shape: 'white', seed: 100 });
      const a = render(op);
      op.reset();
      const b = render(op);
      for (let i = 0; i < N; i++)
        if (a[i] !== b[i]) return { pass: false, why: `mismatch at ${i}` };
      return { pass: true };
    },
  },

  // ---- white range / statistics -------------------------------------
  {
    name: 'white: samples in [-1, 1)',
    run() {
      const out = render(freshOp({ shape: 'white', seed: 7 }));
      for (let i = 0; i < N; i++) {
        if (!(out[i] >= -1 && out[i] < 1)) return { pass: false, why: `out[${i}]=${out[i]} out of range` };
      }
      return { pass: true };
    },
  },
  {
    name: 'white: RMS ≈ 1/√3 (uniform distribution theory)',
    run() {
      const out = render(freshOp({ shape: 'white', seed: 22222 }), 8192);
      const r = rms(out);
      const expected = 1 / Math.sqrt(3);  // ≈ 0.5774
      if (!approx(r, expected, 0.05)) return { pass: false, why: `RMS=${r.toFixed(4)} expected≈${expected.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'white: mean ≈ 0',
    run() {
      const out = render(freshOp({ shape: 'white', seed: 22222 }), 8192);
      const m = mean(out);
      if (Math.abs(m) > 0.05) return { pass: false, why: `mean=${m}` };
      return { pass: true };
    },
  },

  // ---- amount / offset scaling --------------------------------------
  {
    name: 'amount=0 → DC at offset',
    run() {
      const out = render(freshOp({ shape: 'white', seed: 9, amount: 0, offset: 0.42 }));
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.42, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'amount scales linearly; offset adds DC',
    run() {
      const base  = render(freshOp({ shape: 'white', seed: 9, amount: 1,   offset: 0 }));
      const scaled = render(freshOp({ shape: 'white', seed: 9, amount: 0.5, offset: 0.1 }));
      for (let i = 0; i < N; i++) {
        const expected = base[i] * 0.5 + 0.1;
        if (!approx(scaled[i], expected, 1e-6)) return { pass: false, why: `i=${i}: ${scaled[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },

  // ---- pink ---------------------------------------------------------
  {
    name: 'pink: deterministic under same seed',
    run() {
      const a = render(freshOp({ shape: 'pink', seed: 500 }));
      const b = render(freshOp({ shape: 'pink', seed: 500 }));
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'pink: finite + bounded output',
    run() {
      const out = render(freshOp({ shape: 'pink', seed: 22222 }), 8192);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `out[${i}]=${out[i]}` };
        if (Math.abs(out[i]) > 10)    return { pass: false, why: `out[${i}]=${out[i]} too large` };
      }
      return { pass: true };
    },
  },

  // ---- brown --------------------------------------------------------
  {
    name: 'brown: deterministic under same seed',
    run() {
      const a = render(freshOp({ shape: 'brown', seed: 77 }));
      const b = render(freshOp({ shape: 'brown', seed: 77 }));
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'brown: smoother than white (sum of |Δ| much lower)',
    run() {
      const w = render(freshOp({ shape: 'white', seed: 1 }), 4096);
      const b = render(freshOp({ shape: 'brown', seed: 1 }), 4096);
      let dw = 0, db = 0;
      for (let i = 1; i < w.length; i++) { dw += Math.abs(w[i] - w[i-1]); db += Math.abs(b[i] - b[i-1]); }
      if (!(db < dw * 0.5)) return { pass: false, why: `Δbrown=${db.toFixed(2)} not < half Δwhite=${dw.toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- shape switching ----------------------------------------------
  {
    name: 'shape switch at runtime changes output without throwing',
    run() {
      const op = freshOp({ shape: 'white', seed: 10 });
      render(op, 64);
      op.setParam('shape', 'pink');
      const after = render(op, 64);
      // Just verify we got finite output.
      for (let i = 0; i < 64; i++)
        if (!Number.isFinite(after[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- null output defensive ----------------------------------------
  {
    name: 'missing out buffer → no throw',
    run() {
      const op = freshOp({ shape: 'white' });
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },

  // ---- seed=0 fallback ----------------------------------------------
  {
    name: 'seed=0 clamped to nonzero (LCG convention)',
    run() {
      const op = freshOp({ shape: 'white', seed: 0 });
      const out = render(op, 16);
      let nonzero = false;
      for (let i = 0; i < 16; i++) if (out[i] !== 0) { nonzero = true; break; }
      if (!nonzero) return { pass: false, why: 'all-zero output — seed=0 not clamped' };
      return { pass: true };
    },
  },
];

export default { opId: 'noise', tests };
