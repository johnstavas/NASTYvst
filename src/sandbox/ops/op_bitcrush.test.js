// op_bitcrush.test.js — real-math tests for op_bitcrush.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_character.md §8 (quantization;
// dither/NS excluded — those are separate ops). Tests cover: bits=0 true
// bypass, step grid correctness at bits ∈ {4,8,12,16}, monotonicity,
// deterministic output, input clamping behavior, defensive null.

import { BitcrushOp } from './op_bitcrush.worklet.js';

const SR  = 48000;
const N   = 128;
const EPS = 1e-9;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new BitcrushOp(SR);
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

const tests = [
  // ---- bypass contract (bits=0) -------------------------------------
  {
    name: 'bits=0: bit-exact passthrough (bypass contract)',
    run() {
      const op = freshOp({ bits: 0 });
      const { inBuf, out } = drive(op, i => Math.sin(2 * Math.PI * 440 * i / SR));
      for (let i = 0; i < N; i++) {
        if (out[i] !== inBuf[i]) return { pass: false, why: `i=${i}: ${out[i]} vs ${inBuf[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bits=0: zero input → zero output',
    run() {
      const op = freshOp({ bits: 0 });
      const { out } = drive(op, 0);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- step grid correctness -----------------------------------------
  {
    name: 'bits=4: output on 16-level grid (step = 0.125)',
    run() {
      const op = freshOp({ bits: 4 });
      const step = 2 / 16;  // 0.125
      // Sweep input across [-1, 1], every output must be k*step for some int k.
      for (let i = 0; i < 400; i++) {
        const x = -1 + (i / 200);
        const { out } = drive(op, x, 1);
        const k = out[0] / step;
        if (Math.abs(k - Math.round(k)) > 1e-5) return { pass: false, why: `x=${x} out=${out[0]} not on grid` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bits=8: output on 256-level grid',
    run() {
      const op = freshOp({ bits: 8 });
      const step = 2 / 256;
      for (let i = 0; i < 1000; i++) {
        const x = Math.sin(i * 0.01) * 0.9;
        const { out } = drive(op, x, 1);
        const k = out[0] / step;
        if (Math.abs(k - Math.round(k)) > 1e-5) return { pass: false, why: `x=${x} out=${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bits=16: max quantization error ≤ step/2 ≈ 1.53e-5',
    run() {
      const op = freshOp({ bits: 16 });
      const step = 2 / 65536;
      const maxErr = step / 2;
      for (let i = 0; i < 1000; i++) {
        const x = Math.sin(i * 0.01) * 0.9;
        const { out } = drive(op, x, 1);
        const err = Math.abs(out[0] - x);
        if (err > maxErr + 1e-7) return { pass: false, why: `x=${x} err=${err} > ${maxErr}` };
      }
      return { pass: true };
    },
  },

  // ---- specific rounding sanity --------------------------------------
  {
    name: 'bits=4: x=0 → y=0 (exact zero grid point)',
    run() {
      const op = freshOp({ bits: 4 });
      const { out } = drive(op, 0, 1);
      if (out[0] !== 0) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'bits=4: x exactly on grid passes through unchanged',
    run() {
      const op = freshOp({ bits: 4 });
      const step = 2 / 16;
      for (const x of [-1, -0.5, -0.125, 0, 0.125, 0.5, 0.875]) {
        const { out } = drive(op, x, 1);
        if (!approx(out[0], x, 1e-6)) return { pass: false, why: `x=${x} out=${out[0]}` };
      }
      return { pass: true };
    },
  },

  // ---- monotonicity --------------------------------------------------
  {
    name: 'bits=6: monotonic non-decreasing over input sweep',
    run() {
      const op = freshOp({ bits: 6 });
      let prev = -Infinity;
      for (let x = -1; x <= 1; x += 0.001) {
        const { out } = drive(op, x, 1);
        if (out[0] < prev - 1e-6) return { pass: false, why: `x=${x.toFixed(3)}: ${out[0]} < ${prev}` };
        prev = out[0];
      }
      return { pass: true };
    },
  },

  // ---- fewer bits = coarser step -------------------------------------
  {
    name: 'lower bits → coarser grid: bits=4 has larger step than bits=8',
    run() {
      const op4 = freshOp({ bits: 4 });
      const op8 = freshOp({ bits: 8 });
      const x = 0.173;  // arbitrary non-grid point
      const { out: out4 } = drive(op4, x, 1);
      const { out: out8 } = drive(op8, x, 1);
      const err4 = Math.abs(out4[0] - x);
      const err8 = Math.abs(out8[0] - x);
      if (!(err4 > err8)) return { pass: false, why: `err4=${err4} err8=${err8}` };
      return { pass: true };
    },
  },

  // ---- param retune --------------------------------------------------
  {
    name: 'setParam(bits) takes effect on subsequent samples',
    run() {
      const op = freshOp({ bits: 0 });
      // Use an input that is exactly representable in Float32 to avoid
      // precision artefacts in the bypass comparison.
      const X = 0.25;  // exactly representable
      const { out: a } = drive(op, X, 1);
      if (a[0] !== X) return { pass: false, why: `bypass broken: ${a[0]}` };
      op.setParam('bits', 4);
      const { out: b } = drive(op, X, 1);
      // 0.25 / (2/16) = 2 → round(2)=2 → 2*0.125 = 0.25 (on grid)
      if (!approx(b[0], 0.25, 1e-6)) return { pass: false, why: `expected 0.25 got ${b[0]}` };
      // Switch to a value off-grid at bits=4.
      op.setParam('bits', 2);  // step = 0.5
      const { out: c } = drive(op, X, 1);
      // 0.25 / 0.5 = 0.5 → round(0.5)=1 (banker's? Math.round rounds up) → 1*0.5 = 0.5
      // Math.round(0.5) in JS returns 1, so output = 0.5, NOT 0.25.
      if (!approx(c[0], 0.5, 1e-6)) return { pass: false, why: `expected 0.5 got ${c[0]}` };
      return { pass: true };
    },
  },

  // ---- input clamp behavior -----------------------------------------
  {
    name: 'out-of-range bits (>16) falls to bypass',
    run() {
      const op = freshOp({ bits: 999 });
      const X = 0.25;
      const { out } = drive(op, X, 1);
      if (out[0] !== X) return { pass: false, why: `${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative bits falls to bypass',
    run() {
      const op = freshOp({ bits: -4 });
      const X = 0.25;
      const { out } = drive(op, X, 1);
      if (out[0] !== X) return { pass: false, why: `${out[0]}` };
      return { pass: true };
    },
  },

  // ---- input outside [-1, 1] remains on grid -------------------------
  {
    name: 'input > 1: output stays on the step grid (no saturation)',
    run() {
      const op = freshOp({ bits: 4 });
      const step = 2 / 16;
      for (const x of [1.3, -1.3, 2.5, -2.5]) {
        const { out } = drive(op, x, 1);
        const k = out[0] / step;
        if (Math.abs(k - Math.round(k)) > 1e-5) return { pass: false, why: `x=${x} out=${out[0]}` };
      }
      return { pass: true };
    },
  },

  // ---- stateless / reset --------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ bits: 4 });
      drive(op, 0.9, N);
      op.reset();
      const ref = freshOp({ bits: 4 });
      const { out: a } = drive(op, 0.3, 1);
      const { out: b } = drive(ref, 0.3, 1);
      if (a[0] !== b[0]) return { pass: false, why: `${a[0]} vs ${b[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive -----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ bits: 4 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = drive(freshOp({ bits: 6 }), i => Math.sin(i * 0.01) * 0.9, 1024).out;
      const b = drive(freshOp({ bits: 6 }), i => Math.sin(i * 0.01) * 0.9, 1024).out;
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'bitcrush', tests };
