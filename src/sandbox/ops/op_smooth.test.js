// op_smooth.test.js — real-math tests for op_smooth.
// Run via: node scripts/check_op_math.mjs

import { SmoothOp } from './op_smooth.worklet.js';

const SR  = 48000;
const N   = 128;
const EPS = 1e-5;

const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new SmoothOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function driveN(op, fillFn, n) {
  const inBuf  = new Float32Array(n);
  const outBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = fillFn(i);
  op.process({ in: inBuf }, { out: outBuf }, n);
  return outBuf;
}

const tests = [
  {
    name: 'step response: y reaches (1 − 1/e) ≈ 0.632 at n = τ·sr',
    run() {
      const tau = 0.01;                // 10 ms
      const nTau = Math.round(tau * SR); // 480 samples
      const n = nTau + 8;              // a few extra to land exactly at τ
      const op = freshOp({ time: tau });
      const out = driveN(op, () => 1, n);
      const target = 1 - 1 / Math.E;    // 0.63212...
      // Within 1% tolerance — exact value depends on α discretization.
      if (!approx(out[nTau - 1], target, 0.01)) {
        return { pass: false, why: `y[${nTau-1}]=${out[nTau-1]} expected ~${target}` };
      }
      return { pass: true };
    },
  },

  {
    name: 'zero input → zero output',
    run() {
      const op = freshOp({ time: 0.01 });
      const out = driveN(op, () => 0, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },

  {
    name: 'long-run convergence: constant input → y → target within 1e-4',
    run() {
      const op = freshOp({ time: 0.001 });          // 1 ms, converges fast
      const out = driveN(op, () => 0.7, SR * 0.05); // 50 ms = 50τ
      const last = out[out.length - 1];
      if (!approx(last, 0.7, 1e-4)) return { pass: false, why: `final=${last} expected 0.7` };
      return { pass: true };
    },
  },

  {
    name: 'time=0 → bit-exact passthrough',
    run() {
      const op = freshOp({ time: 0 });
      const out = driveN(op, i => Math.sin(i * 0.1) * 0.5, N);
      for (let i = 0; i < N; i++) {
        const expected = Math.fround(Math.sin(i * 0.1) * 0.5);
        if (out[i] !== expected) {
          return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
        }
      }
      return { pass: true };
    },
  },

  {
    name: 'monotonic approach: step-up input, output never overshoots',
    run() {
      const op = freshOp({ time: 0.005 });
      const out = driveN(op, () => 0.5, SR * 0.03); // 30 ms, plenty to converge
      for (let i = 0; i < out.length; i++) {
        if (out[i] > 0.5 + EPS) {
          return { pass: false, why: `overshoot: out[${i}]=${out[i]} > 0.5` };
        }
        if (i > 0 && out[i] + EPS < out[i - 1]) {
          return { pass: false, why: `non-monotonic: out[${i}]=${out[i]} < out[${i-1}]=${out[i-1]}` };
        }
      }
      return { pass: true };
    },
  },

  {
    name: 'denormal flush: tiny state + zero input → state → 0',
    run() {
      const op = freshOp({ time: 0.01 });
      op._y = 1e-35;                    // seed sub-normal
      const out = driveN(op, () => 0, 16);
      // With α ≈ 2e-3 and input 0, y decays. Without flush, y would be
      // a denormal forever (µs-level slow on many CPUs). With flush it hits 0.
      const last = out[out.length - 1];
      if (last !== 0) return { pass: false, why: `last=${last} expected 0 (denormal not flushed)` };
      return { pass: true };
    },
  },

  {
    name: 'reset() clears state',
    run() {
      const op = freshOp({ time: 0.01 });
      driveN(op, () => 1, 500);         // drive toward 1
      if (!(op._y > 0.3)) return { pass: false, why: `pre-reset state=${op._y} should be ramped up` };
      op.reset();
      if (op._y !== 0) return { pass: false, why: `post-reset state=${op._y} expected 0` };
      // Verify next render starts fresh from 0.
      const out = driveN(op, () => 0.5, 4);
      if (!(out[0] < 0.1)) return { pass: false, why: `post-reset out[0]=${out[0]} not a fresh ramp` };
      return { pass: true };
    },
  },

  {
    name: 'null input → all-zero output',
    run() {
      const op = freshOp({ time: 0.01 });
      const out = new Float32Array(N).fill(999);
      op.process({ /* no in */ }, { out }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },

  {
    name: 'larger τ converges slower than smaller τ',
    run() {
      const fast = freshOp({ time: 0.001 });
      const slow = freshOp({ time: 0.050 });
      const n = Math.round(0.01 * SR); // sample at 10 ms
      const outFast = driveN(fast, () => 1, n);
      const outSlow = driveN(slow, () => 1, n);
      const yFast = outFast[n - 1];
      const ySlow = outSlow[n - 1];
      if (!(yFast > ySlow)) return { pass: false, why: `at 10 ms: fast=${yFast} slow=${ySlow} — expected fast > slow` };
      if (!(yFast > 0.99)) return { pass: false, why: `fast τ=1ms should be near 1 at 10 ms, got ${yFast}` };
      if (!(ySlow < 0.3))  return { pass: false, why: `slow τ=50ms should be <0.3 at 10 ms, got ${ySlow}` };
      return { pass: true };
    },
  },
];

export default { opId: 'smooth', tests };
