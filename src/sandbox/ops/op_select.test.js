// op_select.test.js — real-math tests for op_select.
// Math-by-definition: out = in_k, k = clamp(floor(index), 0, 3).

import { SelectOp } from './op_select.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new SelectOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function run(op, inputs, nSamples) {
  const out = new Float32Array(nSamples);
  op.process(inputs, { out }, nSamples);
  return out;
}

function makeInputs() {
  const N = 16;
  const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = 0.10 * (i + 1);
  const b = new Float32Array(N); for (let i = 0; i < N; i++) b[i] = 0.20 * (i + 1);
  const c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = 0.30 * (i + 1);
  const d = new Float32Array(N); for (let i = 0; i < N; i++) d[i] = 0.40 * (i + 1);
  return { in0: a, in1: b, in2: c, in3: d, N };
}

const tests = [
  {
    name: 'index=0 → passes in0',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: 0 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in0[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in0[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'index=1 → passes in1',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: 1 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in1[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in1[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'index=2 → passes in2',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: 2 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in2[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in2[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'index=3 → passes in3',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: 3 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in3[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in3[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'fractional index 2.7 → floors to 2 (selects in2)',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: 2.7 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in2[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in2[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'index < 0 clamps to 0',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: -5 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in0[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in0[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'index > 3 clamps to 3',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const out = run(freshOp({ index: 99 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in3[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in3[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN index ignored — holds previous',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const op = freshOp({ index: 2 });
      op.setParam('index', NaN);
      const out = run(op, { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== in2[i]) return { pass: false, why: `[${i}] ${out[i]} vs ${in2[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'selected input missing → silent output',
    run() {
      const { in0, in1, N } = makeInputs();
      const out = run(freshOp({ index: 3 }), { in0, in1 }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `[${i}] ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'other inputs do not bleed into output',
    run() {
      // Only in1 connected but index=2 → must be silent (no sum-leak).
      const in1 = new Float32Array(16); in1.fill(1);
      const out = run(freshOp({ index: 2 }), { in1 }, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 0) return { pass: false, why: `[${i}]=${out[i]} (no bleed allowed)` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no crash',
    run() {
      const { in0, in1, in2, in3 } = makeInputs();
      const op = freshOp({ index: 1 });
      op.process({ in0, in1, in2, in3 }, {}, 16);
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const { in0, in1, in2, in3, N } = makeInputs();
      const a = run(freshOp({ index: 2 }), { in0, in1, in2, in3 }, N);
      const b = run(freshOp({ index: 2 }), { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'latency = 0',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'stateless — reset is a no-op',
    run() {
      const op = freshOp({ index: 1 });
      const { in0, in1, in2, in3, N } = makeInputs();
      const o1 = run(op, { in0, in1, in2, in3 }, N);
      op.reset();
      const o2 = run(op, { in0, in1, in2, in3 }, N);
      for (let i = 0; i < N; i++) if (o1[i] !== o2[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'select', tests };
