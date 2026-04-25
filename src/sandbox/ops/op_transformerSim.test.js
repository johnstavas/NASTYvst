// op_transformerSim.test.js — real-math tests for Jiles-Atherton anhysteretic
// Langevin transformer waveshaper.
// Run via: node scripts/check_op_math.mjs

import { TransformerSimOp } from './op_transformerSim.worklet.js';

const SR = 48000;
const N  = 1024;
const approx = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new TransformerSimOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input) {
  const out = new Float32Array(input.length);
  op.process({ in: input }, { out }, input.length);
  return out;
}

// Reference Langevin
function L(x) {
  if (Math.abs(x) < 1e-4) return x / 3 - (x*x*x) / 45;
  return 1 / Math.tanh(x) - 1 / x;
}

const tests = [
  {
    name: 'silence in → silence out (bias=0)',
    run() {
      const inp = new Float32Array(N);
      const out = render(freshOp({ drive: 2, bias: 0, output: 1 }), inp);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'silence in → silence out (bias=0.5, DC offset removed)',
    run() {
      const inp = new Float32Array(N);
      const out = render(freshOp({ drive: 1, bias: 0.5, output: 1 }), inp);
      for (let i = 0; i < N; i++) if (Math.abs(out[i]) > 1e-6) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'bias=0: output matches L(drive·x) exactly',
    run() {
      const d = 1.5;
      const op = freshOp({ drive: d, bias: 0, output: 1 });
      const inp = new Float32Array([-0.9, -0.3, -1e-5, 0, 1e-5, 0.3, 0.9]);
      const out = render(op, inp);
      for (let i = 0; i < inp.length; i++) {
        const exp = L(d * inp[i]);
        if (!approx(out[i], exp, 1e-6)) return { pass: false, why: `i=${i} x=${inp[i]} got=${out[i]} exp=${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bias=0 symmetric: y(-x) = -y(x)',
    run() {
      const op = freshOp({ drive: 2, bias: 0, output: 1 });
      const xs = new Float32Array([0.1, 0.3, 0.5, 0.8, 1.2, 2.0]);
      const pos = render(op, xs);
      const negIn = new Float32Array(xs.length);
      for (let i = 0; i < xs.length; i++) negIn[i] = -xs[i];
      const neg = render(op, negIn);
      for (let i = 0; i < xs.length; i++) {
        if (!approx(neg[i], -pos[i], 1e-6)) return { pass: false, why: `i=${i}: -pos=${-pos[i]} neg=${neg[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'saturation: |y(x=10)| < |y(x=large)| ceiling (Langevin bounded by 1)',
    run() {
      const op = freshOp({ drive: 1, bias: 0, output: 1 });
      const out = render(op, new Float32Array([10, 50, 100]));
      for (let i = 0; i < 3; i++) {
        if (out[i] >= 1 || out[i] <= 0.85) return { pass: false, why: `saturated value out of range: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'small-signal: y ≈ drive·x/3 (Langevin linear region)',
    run() {
      const d = 1;
      const op = freshOp({ drive: d, bias: 0, output: 1 });
      const inp = new Float32Array([0.001, 0.002, 0.005]);
      const out = render(op, inp);
      for (let i = 0; i < inp.length; i++) {
        const exp = d * inp[i] / 3;
        if (!approx(out[i], exp, 1e-7)) return { pass: false, why: `i=${i} got=${out[i]} exp=${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bias≠0: produces asymmetric response (even-harmonic test)',
    run() {
      const op = freshOp({ drive: 2, bias: 0.4, output: 1 });
      const pos = render(op, new Float32Array([0.5]));
      const neg = render(op, new Float32Array([-0.5]));
      // With bias, +x and -x should NOT be negatives of each other
      if (approx(pos[0], -neg[0], 1e-3)) return { pass: false, why: `symmetry not broken: pos=${pos[0]} neg=${neg[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'output gain scales linearly',
    run() {
      const base = render(freshOp({ drive: 2, bias: 0, output: 1 }), new Float32Array([0.5]));
      const doubled = render(freshOp({ drive: 2, bias: 0, output: 2 }), new Float32Array([0.5]));
      if (!approx(doubled[0], 2 * base[0], 1e-6)) return { pass: false, why: `base=${base[0]} doubled=${doubled[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'output=0 → silence',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1);
      const out = render(freshOp({ drive: 2, bias: 0.1, output: 0 }), inp);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'clamps: non-finite params → defaults; out-of-range → clamped',
    run() {
      const op = freshOp({});
      op.setParam('drive', NaN);    // → 1
      op.setParam('bias',  Infinity); // → 0
      op.setParam('output', -5);   // → 0
      const out = render(op, new Float32Array([0.5, -0.3, 0.1]));
      for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'no NaN at x=0 with bias=0 (Langevin removable singularity)',
    run() {
      const inp = new Float32Array(16); // all zeros
      const out = render(freshOp({ drive: 1, bias: 0, output: 1 }), inp);
      for (let i = 0; i < 16; i++) if (!Number.isFinite(out[i]) || out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.17) * 0.6;
      const a = render(freshOp({ drive: 3, bias: 0.2, output: 1.5 }), inp);
      const b = render(freshOp({ drive: 3, bias: 0.2, output: 1.5 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() no-op: output before/after reset identical',
    run() {
      const op = freshOp({ drive: 2, bias: 0.3, output: 1 });
      const inp = new Float32Array([0.4, -0.2, 0.7]);
      const a = render(op, inp);
      op.reset();
      const b = render(op, inp);
      for (let i = 0; i < inp.length; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → zeros (bias=0)',
    run() {
      const op = freshOp({ drive: 2, bias: 0, output: 1 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
];

export default { opId: 'transformerSim', tests };
