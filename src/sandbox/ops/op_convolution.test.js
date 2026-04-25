// op_convolution.test.js — real-math tests for op_convolution.
// Run via: node scripts/check_op_math.mjs
//
// Primary: JOS MDFT "Convolution" — y[n] = Σ_{k=0..M-1} h[k]·x[n-k].
// Verifies:
//   - Capture phase emits zero for M samples
//   - Impulse IR (h = δ) → output = input (after capture)
//   - Unit-step IR (h = [1,1,...,1]) → output is running sum (windowed)
//   - Custom IR [0.5, 0.5] → 2-sample averager
//   - reset re-enables capture
//   - Defensive null I/O; determinism; length clamp

import { ConvolutionOp } from './op_convolution.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new ConvolutionOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function run(op, inCh, irCh, n) {
  const inBuf = new Float32Array(n);
  const irBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    inBuf[i] = typeof inCh === 'function' ? inCh(i) : inCh;
    irBuf[i] = typeof irCh === 'function' ? irCh(i) : irCh;
  }
  const out = new Float32Array(n);
  op.process({ in: inBuf, ir: irBuf }, { out }, n);
  return { inBuf, irBuf, out };
}

const tests = [
  {
    name: 'capture phase: output is zero for first M samples',
    run() {
      const M = 16;
      const op = freshOp({ length: M });
      const { out } = run(op,
        (i) => 1.0,                         // in = DC
        (i) => i === 0 ? 1 : 0,             // ir = impulse
        M);
      for (let i = 0; i < M; i++) {
        if (out[i] !== 0) return { pass: false, why: `capture-phase out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse IR (δ) → output copies input (delayed by 1)',
    run() {
      const M = 8;
      const op = freshOp({ length: M });
      // IR: h = [1, 0, 0, ..., 0] → y[n] = x[n]
      const total = M + 32;
      const { out } = run(op,
        (i) => Math.sin(2 * Math.PI * 440 * i / SR),
        (i) => i === 0 ? 1 : 0,
        total);
      // After capture (samples 0..M-1 are zero), out[i] should equal in[i]
      // for i >= M (since h[0]=1, others 0 → y[n] = x[n]).
      for (let i = M; i < total; i++) {
        const expected = Math.sin(2 * Math.PI * 440 * i / SR);
        if (Math.abs(out[i] - expected) > 1e-5)
          return { pass: false, why: `i=${i}: out=${out[i]} exp=${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: '2-tap averager IR [0.5, 0.5] → output = (x[n] + x[n-1]) / 2',
    run() {
      const M = 2;
      const op = freshOp({ length: M });
      const total = 32;
      // IR = [0.5, 0.5]
      const irBuf = new Float32Array(total);
      irBuf[0] = 0.5; irBuf[1] = 0.5;
      const inBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = i + 1;   // ramp
      const out = new Float32Array(total);
      op.process({ in: inBuf, ir: irBuf }, { out }, total);
      // Capture = samples 0,1. Post-capture i>=2:
      //   y[i] = 0.5·x[i] + 0.5·x[i-1]
      for (let i = M; i < total; i++) {
        const exp = 0.5 * inBuf[i] + 0.5 * inBuf[i - 1];
        if (Math.abs(out[i] - exp) > 1e-5)
          return { pass: false, why: `i=${i}: out=${out[i]} exp=${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'shifted impulse IR [0, 1, 0, ...] → output = x[n-1]',
    run() {
      const M = 4;
      const op = freshOp({ length: M });
      const total = 24;
      const irBuf = new Float32Array(total);
      irBuf[1] = 1;   // h[1] = 1, others 0 → y[n] = x[n-1]
      const inBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = i * 0.1;
      const out = new Float32Array(total);
      op.process({ in: inBuf, ir: irBuf }, { out }, total);
      for (let i = M; i < total; i++) {
        const exp = inBuf[i - 1];
        if (Math.abs(out[i] - exp) > 1e-5)
          return { pass: false, why: `i=${i}: out=${out[i]} exp=${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'unit-step IR → running sum (windowed by M)',
    run() {
      const M = 4;
      const op = freshOp({ length: M });
      const total = 20;
      const irBuf = new Float32Array(total); irBuf.fill(1);
      const inBuf = new Float32Array(total); inBuf.fill(1);   // x = 1 DC
      const out = new Float32Array(total);
      op.process({ in: inBuf, ir: irBuf }, { out }, total);
      // After capture, steady state: y = sum of M ones = M = 4
      for (let i = M * 2; i < total; i++) {
        if (Math.abs(out[i] - M) > 1e-5)
          return { pass: false, why: `i=${i}: out=${out[i]} exp=${M}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'length param clamps to [1, 4096]',
    run() {
      const op = freshOp({ length: 0 });
      if (op._length !== 1) return { pass: false, why: `min ${op._length}` };
      op.setParam('length', 100000);
      if (op._length !== 4096) return { pass: false, why: `max ${op._length}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() re-enables capture',
    run() {
      const M = 4;
      const op = freshOp({ length: M });
      run(op, 1, (i) => i === 0 ? 1 : 0, M + 8);
      op.reset();
      const { out } = run(op, 1, (i) => i === 0 ? 1 : 0, M);
      for (let i = 0; i < M; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset capture i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → all-zero output (no NaN)',
    run() {
      const op = freshOp({ length: 8 });
      const out = new Float32Array(32);
      op.process({}, { out }, 32);
      for (let i = 0; i < 32; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (out[i] !== 0) return { pass: false, why: `non-zero out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer → no-op (no crash)',
    run() {
      const op = freshOp({ length: 8 });
      const inBuf = new Float32Array(32).fill(0.1);
      const irBuf = new Float32Array(32).fill(0.1);
      op.process({ in: inBuf, ir: irBuf }, {}, 32);
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same IR + input → identical output',
    run() {
      const M = 16;
      const gen  = (i) => Math.sin(i * 0.13);
      const irFn = (i) => i < M ? (i * 0.01) : 0;
      const a = run(freshOp({ length: M }), gen, irFn, 128).out;
      const b = run(freshOp({ length: M }), gen, irFn, 128).out;
      for (let i = 0; i < 128; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'convolution', tests };
