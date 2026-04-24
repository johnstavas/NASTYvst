// op_softLimit.test.js — real-math tests for op_softLimit.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_character.md §11 (Padé rational
// tanh). Tests cover: near-unity passthrough in linear region, asymptote
// at ±threshold, odd symmetry, monotonicity, hard-clip at |x/T| > 3,
// threshold retune scales both clip point and linear region, defensive
// null, stateless reset.

import { SoftLimitOp } from './op_softLimit.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new SoftLimitOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inFill, n = N) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

// Reference Padé (Canon §11) — used to derive expected values in tests.
function padeRef(x, T) {
  let u = x / T;
  if (u >  3) u =  3;
  else if (u < -3) u = -3;
  return T * u * (27 + u * u) / (27 + 9 * u * u);
}

const tests = [
  // ---- linear region -------------------------------------------------
  {
    name: 'linear region (|x| ≪ T): near-unity passthrough',
    run() {
      const op = freshOp({ threshold: 0.95 });
      const { out } = drive(op, 0.1);
      // At u = 0.1/0.95 ≈ 0.105, padé(u) ≈ u very closely.
      // Relative error should be < 1%.
      const rel = Math.abs(out[0] - 0.1) / 0.1;
      if (rel > 0.01) return { pass: false, why: `rel err=${(rel * 100).toFixed(2)}%` };
      return { pass: true };
    },
  },
  {
    name: 'very small input: slope ≈ 1 (unity gain through zero)',
    run() {
      const op = freshOp({ threshold: 1 });
      const { out: a } = drive(op, 1e-4);
      const { out: b } = drive(op, 2e-4);
      // For |x| << T, output ≈ x, so doubling input doubles output.
      const ratio = b[0] / a[0];
      if (!approx(ratio, 2, 1e-3)) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },

  // ---- asymptote / clip ----------------------------------------------
  {
    name: 'asymptote: large positive input → ≈ +threshold',
    run() {
      const T = 0.95;
      const op = freshOp({ threshold: T });
      const { out } = drive(op, 10);  // well past 3T saturation region
      if (!approx(out[0], T, 1e-4)) return { pass: false, why: `out=${out[0]} expected ${T}` };
      return { pass: true };
    },
  },
  {
    name: 'asymptote: large negative input → ≈ −threshold',
    run() {
      const T = 0.95;
      const op = freshOp({ threshold: T });
      const { out } = drive(op, -10);
      if (!approx(out[0], -T, 1e-4)) return { pass: false, why: `out=${out[0]} expected ${-T}` };
      return { pass: true };
    },
  },
  {
    name: 'output never exceeds threshold for any input',
    run() {
      const T = 0.5;
      const op = freshOp({ threshold: T });
      for (const x of [-100, -10, -3, -1, -0.5, 0, 0.5, 1, 3, 10, 100]) {
        const { out } = drive(op, x);
        if (Math.abs(out[0]) > T + 1e-6) return { pass: false, why: `x=${x} out=${out[0]}` };
      }
      return { pass: true };
    },
  },

  // ---- odd symmetry / monotonicity ----------------------------------
  {
    name: 'odd-symmetric: f(-x) = -f(x)',
    run() {
      const op = freshOp({ threshold: 0.8 });
      for (const x of [0.1, 0.5, 1, 2, 5]) {
        const { out: pos } = drive(op, x);
        const { out: neg } = drive(op, -x);
        if (!approx(pos[0], -neg[0], 1e-6)) return { pass: false, why: `x=${x}: ${pos[0]} vs ${-neg[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'monotonic non-decreasing over input sweep',
    run() {
      const op = freshOp({ threshold: 0.95 });
      let prev = -Infinity;
      for (let x = -5; x <= 5; x += 0.01) {
        const { out } = drive(op, x);
        if (out[0] < prev - 1e-6) return { pass: false, why: `x=${x.toFixed(2)}: ${out[0]} < prev ${prev}` };
        prev = out[0];
      }
      return { pass: true };
    },
  },

  // ---- Padé formula check -------------------------------------------
  {
    name: 'Padé formula: matches reference at u ∈ {0.5, 1, 2} (|u| ≤ 3)',
    run() {
      const T = 1;
      const op = freshOp({ threshold: T });
      for (const u of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        const { out } = drive(op, u * T);
        const expected = padeRef(u * T, T);
        if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `u=${u}: ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Hard-clip at |u| > 3: saturates to ±T',
    run() {
      const T = 0.95;
      const op = freshOp({ threshold: T });
      // At u=3: padé(3) = 3·(27+9)/(27+81) = 108/108 = 1, so T·1 = T.
      const { out: at3  } = drive(op, 3 * T);
      const { out: past } = drive(op, 100 * T);
      // Past 3T, output should equal value at 3T (hard clip).
      if (!approx(at3[0], T, 1e-5)) return { pass: false, why: `at 3T: ${at3[0]}` };
      if (!approx(past[0], T, 1e-5)) return { pass: false, why: `past 3T: ${past[0]}` };
      return { pass: true };
    },
  },

  // ---- threshold retune ---------------------------------------------
  {
    name: 'threshold retune: output asymptote tracks threshold',
    run() {
      const op = freshOp({ threshold: 0.5 });
      const { out: a } = drive(op, 10);
      if (!approx(a[0], 0.5, 1e-4)) return { pass: false, why: `T=0.5 out=${a[0]}` };
      op.setParam('threshold', 1.2);
      const { out: b } = drive(op, 10);
      if (!approx(b[0], 1.2, 1e-4)) return { pass: false, why: `T=1.2 out=${b[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'smaller threshold → earlier clip (same input)',
    run() {
      const op1 = freshOp({ threshold: 0.5 });
      const op2 = freshOp({ threshold: 1.0 });
      const { out: a } = drive(op1, 0.8);
      const { out: b } = drive(op2, 0.8);
      // At x=0.8, threshold=1.0 is more linear (output ≈ 0.8), threshold=0.5
      // has already bent significantly (output < 0.5 well below x).
      if (!(a[0] < b[0])) return { pass: false, why: `a=${a[0]} not < b=${b[0]}` };
      return { pass: true };
    },
  },

  // ---- stateless / reset --------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ threshold: 0.95 });
      drive(op, 10);  // saturate
      op.reset();
      const { out } = drive(op, 0.3);
      // No state means output is purely a function of input. Should match
      // fresh-op output at same input.
      const ref = freshOp({ threshold: 0.95 });
      const { out: refOut } = drive(ref, 0.3);
      if (!approx(out[0], refOut[0], 1e-9)) return { pass: false, why: `${out[0]} vs ${refOut[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ threshold: 0.95 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'threshold clamp: threshold=0 falls to safe non-zero (no divide-by-zero)',
    run() {
      const op = freshOp({ threshold: 0 });
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- sine waveform preservation near linear region -----------------
  {
    name: 'low-amplitude sine preserves shape (THD negligible near zero)',
    run() {
      const op = freshOp({ threshold: 1 });
      const { inBuf, out } = drive(op, i => 0.01 * Math.sin(2 * Math.PI * 440 * i / SR), 2048);
      // Output should track input ≈ identically for small amplitudes.
      for (let i = 0; i < out.length; i++) {
        const rel = Math.abs(out[i] - inBuf[i]);
        if (rel > 1e-4) return { pass: false, why: `i=${i}: diff=${rel}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'softLimit', tests };
