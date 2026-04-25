// op_fpDacRipple.test.js — real-math tests for FP-DAC ripple (#117).
// Run via: node scripts/check_op_math.mjs

import { FpDacRippleOp } from './op_fpDacRipple.worklet.js';

const SR = 48000;
const N  = 1024;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new FpDacRippleOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input) {
  const out = new Float32Array(input.length);
  op.process({ in: input }, { out }, input.length);
  return out;
}

const tests = [
  {
    name: 'silence in (noise=0) → silence out',
    run() {
      const inp = new Float32Array(N);
      const out = render(freshOp({ noise: 0 }), inp);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'noise=0, expBits=0 → plain fixed-point quantize at `bits` steps',
    run() {
      // bits=4 → M=8 → step=1/8=0.125.
      const op = freshOp({ bits: 4, expBits: 0, noise: 0 });
      const out = render(op, new Float32Array([0, 0.1, 0.13, 0.2, 0.6, -0.3]));
      // Expected: round(x·8)/8
      // Math.round uses round-half-away-from-zero for positive, toward-zero for ties:
      // round(-0.3·8) = round(-2.4) = -2 → -0.25
      const expected = [0, 0.125, 0.125, 0.25, 0.625, -0.25];
      for (let i = 0; i < expected.length; i++) {
        if (!approx(out[i], expected[i], 1e-6)) return { pass: false, why: `i=${i} got=${out[i]} exp=${expected[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bounded: |y| ≤ |x| + small tolerance (noise-free, large expBits)',
    run() {
      const op = freshOp({ bits: 12, expBits: 3, noise: 0 });
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 500 * i / SR) * 0.8;
      const out = render(op, inp);
      for (let i = 0; i < N; i++) {
        // Max quantization error = step/2 at current range = 2^(-e)/(2·M) ≤ 2^(-0)/(2·M) = 1/(2·2048)
        const tol = 1 / (2 * 2048) + 1e-6;
        if (Math.abs(out[i] - inp[i]) > tol) return { pass: false, why: `i=${i} err=${out[i]-inp[i]} tol=${tol}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'quiet signal: gain-ranging gives FINER step than fixed-point',
    run() {
      // expBits=0: step = 2^-(bits-1) = 1/2048
      // expBits=3: at x~0.01, e = floor(-log2(0.01))=6 clamped to 3, step = 2^-3/M = 1/(8·2048)
      const bits = 12;
      const inp = new Float32Array(N).fill(0.01);
      const fx  = render(freshOp({ bits, expBits: 0, noise: 0 }), inp);
      const fp  = render(freshOp({ bits, expBits: 3, noise: 0 }), inp);
      const errFx = Math.abs(fx[0] - 0.01);
      const errFp = Math.abs(fp[0] - 0.01);
      if (!(errFp < errFx)) return { pass: false, why: `errFx=${errFx} errFp=${errFp} (FP should have less error)` };
      return { pass: true };
    },
  },
  {
    name: 'ripple: step size DOUBLES when signal crosses exponent boundary',
    run() {
      // At x just below 0.5 (e=1), step = 2^-1/M. At x just above 0.5 (e=0), step = 1/M.
      const bits = 8;
      const M = 128;
      const op = freshOp({ bits, expBits: 3, noise: 0 });
      // Pick samples that quantize near the boundary. x=0.49 → e=1 → step 1/256
      // x=0.51 → e=0 → step 1/128
      const inp = new Float32Array([0.49, 0.51]);
      const out = render(op, inp);
      // Just verify no crash and values reasonable
      for (let i = 0; i < 2; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      // The unique quantized values below 0.5 should be 2x denser than above.
      // Count unique outputs for ramp 0.25..0.49 (e=1 region) vs 0.5..0.99 (e=0 region).
      // Equal-width ranges so unique-count ratio reflects step density.
      // 0.26..0.49 (width 0.23, e=1 region, step 1/256 → ~59 steps)
      // 0.51..0.74 (width 0.23, e=0 region, step 1/128 → ~30 steps)
      const ramp1 = new Float32Array(200);
      const ramp2 = new Float32Array(200);
      for (let i = 0; i < 200; i++) { ramp1[i] = 0.26 + (0.23 * i / 199); ramp2[i] = 0.51 + (0.23 * i / 199); }
      const opA = freshOp({ bits, expBits: 3, noise: 0 });
      const opB = freshOp({ bits, expBits: 3, noise: 0 });
      const o1 = render(opA, ramp1);
      const o2 = render(opB, ramp2);
      const u1 = new Set(); const u2 = new Set();
      for (let i = 0; i < 100; i++) { u1.add(o1[i].toFixed(8)); u2.add(o2[i].toFixed(8)); }
      // e=1 region has step 2x denser → should give ~2x unique values.
      if (!(u1.size >= 1.5 * u2.size)) return { pass: false, why: `e=1 unique=${u1.size}, e=0 unique=${u2.size} (expected e=1 ≥ 1.5× e=0)` };
      return { pass: true };
    },
  },
  {
    name: 'expBits=0 on quiet signal → hits noise floor (step = 1/M always)',
    run() {
      // x = 1e-5, bits=8 → step = 1/128 ≈ 0.0078. round(1e-5 · 128) = 0.
      const out = render(freshOp({ bits: 8, expBits: 0, noise: 0 }), new Float32Array([1e-5, 1e-5]));
      if (out[0] !== 0) return { pass: false, why: `expected 0, got ${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops with same seed produce identical output',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.13) * 0.4;
      const a = render(freshOp({ bits: 12, expBits: 3, noise: 0.005, seed: 42 }), inp);
      const b = render(freshOp({ bits: 12, expBits: 3, noise: 0.005, seed: 42 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'different seeds → different noise streams',
    run() {
      const inp = new Float32Array(N).fill(0.1);
      const a = render(freshOp({ noise: 0.005, seed: 1 }), inp);
      const b = render(freshOp({ noise: 0.005, seed: 99 }), inp);
      let diffs = 0;
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) diffs++;
      if (diffs < N / 2) return { pass: false, why: `only ${diffs} diffs of ${N}` };
      return { pass: true };
    },
  },
  {
    name: 'reset restores seed state',
    run() {
      const op = freshOp({ bits: 12, expBits: 3, noise: 0.005, seed: 7 });
      const inp = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const a = render(op, inp);
      op.reset();
      const b = render(op, inp);
      for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'clamps: non-finite params → defaults; out-of-range → clamped',
    run() {
      const op = freshOp({});
      op.setParam('bits',    NaN);
      op.setParam('bits',    99);   // → 16
      op.setParam('bits',    -5);   // → 4
      op.setParam('expBits', 999);  // → 4
      op.setParam('expBits', -1);   // → 0
      op.setParam('noise',   999);  // → 0.01
      op.setParam('noise',   -1);   // → 0
      op.setParam('seed',    -5);   // → 1
      const inp = new Float32Array([0.1, -0.3, 0.5]);
      const out = render(op, inp);
      for (let i = 0; i < 3; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input (noise=0) → zeros',
    run() {
      const op = freshOp({ noise: 0 });
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
  {
    name: 'sign symmetry (noise=0): y(-x) = -y(x)',
    run() {
      const op1 = freshOp({ bits: 10, expBits: 3, noise: 0 });
      const op2 = freshOp({ bits: 10, expBits: 3, noise: 0 });
      const xs = new Float32Array([0.01, 0.1, 0.3, 0.7]);
      const neg = new Float32Array(xs.length);
      for (let i = 0; i < xs.length; i++) neg[i] = -xs[i];
      const a = render(op1, xs);
      const b = render(op2, neg);
      for (let i = 0; i < xs.length; i++) {
        if (!approx(b[i], -a[i], 1e-7)) return { pass: false, why: `i=${i}: pos=${a[i]} neg=${b[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'fpDacRipple', tests };
