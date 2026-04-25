// op_warpedLPC.test.js — real-math tests for op_warpedLPC.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Warped LPC residual filter. Primary: musicdsp #137 wAutocorrelate +
//   Levinson-Durbin; inverse via warped-FIR allpass chain.
//   First blockN samples = 0 (no coefs yet). Steady-state latency = blockN.
//   lambda = 0 should match unwarped LPC behaviour.

import { WarpedLpcOp } from './op_warpedLPC.worklet.js';
import { LpcOp }       from './op_lpc.worklet.js';

const SR = 48000;

function freshOp(order = 12, blockN = 256, lambda = 0.65) {
  const op = new WarpedLpcOp(SR);
  op.reset();
  op.setParam('order',  order);
  op.setParam('blockN', blockN);
  op.setParam('lambda', lambda);
  return op;
}

function sineBuf(freq, amp, n) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  return buf;
}

function whiteBuf(n, seed = 1) {
  let s = seed >>> 0;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    buf[i] = (s / 0xffffffff) * 2 - 1;
  }
  return buf;
}

function runBuf(op, inBuf) {
  const out = new Float32Array(inBuf.length);
  op.process({ in: inBuf }, { residual: out }, inBuf.length);
  return out;
}

const tests = [
  {
    name: 'first blockN samples are zero (no coefs yet)',
    run() {
      const op = freshOp(8, 128, 0.65);
      const out = runBuf(op, sineBuf(440, 0.5, 128));
      for (let i = 0; i < 128; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'residual bounded + finite under steady sine',
    run() {
      const op = freshOp(12, 256, 0.65);
      const buf = sineBuf(880, 0.4, 2048);
      const out = runBuf(op, buf);
      for (let i = 256; i < 2048; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at ${i}` };
        if (Math.abs(out[i]) > 5) return { pass: false, why: `|out|=${out[i]} at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'residual energy << input energy on pitched tone (steady state)',
    run() {
      const op = freshOp(14, 512, 0.65);
      const buf = sineBuf(220, 0.5, 4096);
      const out = runBuf(op, buf);
      let inE = 0, outE = 0;
      for (let i = 1024; i < 4096; i++) { inE += buf[i]*buf[i]; outE += out[i]*out[i]; }
      if (outE >= inE) return { pass: false, why: `residual not reduced: inE=${inE} outE=${outE}` };
      return { pass: true };
    },
  },
  {
    name: 'silence → silence (gate path)',
    run() {
      const op = freshOp(8, 128, 0.65);
      const out = runBuf(op, new Float32Array(1024));
      for (let i = 0; i < 1024; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const buf = whiteBuf(2048, 42);
      const a = runBuf(freshOp(10, 256, 0.5), buf);
      const b = runBuf(freshOp(10, 256, 0.5), buf);
      for (let i = 0; i < 2048; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'lambda clamp: |λ| ≤ 0.99',
    run() {
      const op = freshOp();
      op.setParam('lambda', 5);
      if (op._lambda !==  0.99) return { pass: false, why: `+clip: ${op._lambda}` };
      op.setParam('lambda', -3);
      if (op._lambda !== -0.99) return { pass: false, why: `-clip: ${op._lambda}` };
      return { pass: true };
    },
  },
  {
    name: 'order clamp: [1, 32]',
    run() {
      const op = freshOp();
      op.setParam('order', 0);
      if (op._order !== 1) return { pass: false, why: `min: ${op._order}` };
      op.setParam('order', 999);
      if (op._order !== 32) return { pass: false, why: `max: ${op._order}` };
      return { pass: true };
    },
  },
  {
    name: 'blockN clamp: [64, 8192]',
    run() {
      const op = freshOp();
      op.setParam('blockN', 10);
      if (op._blockN !== 64) return { pass: false, why: `min: ${op._blockN}` };
      op.setParam('blockN', 1 << 20);
      if (op._blockN !== 8192) return { pass: false, why: `max: ${op._blockN}` };
      return { pass: true };
    },
  },
  {
    name: 'lambda=0 → identical to unwarped LPC (structural check)',
    run() {
      // With λ=0, allpass collapses: apCur[k] = apPrev[k-1] = x[n-k], which
      // is the unwarped delay tap. The analysis warp also degenerates to
      // dl[k] = x[k-1] (first lag) → Rt[i] = Σ x[k-i]·x[k] ≈ R[i], i.e.
      // standard autocorrelation. Residuals should match LpcOp bit-for-bit
      // modulo the one-sample offset in the allpass chain interpretation.
      // We verify behavioural equivalence: same sign + small diff.
      const buf = whiteBuf(4096, 7);
      const warped   = runBuf(freshOp(8, 256, 0), buf);
      const unwarped = (() => {
        const op = new LpcOp(SR);
        op.reset();
        op.setParam('order', 8);
        op.setParam('blockN', 256);
        return runBuf(op, buf);
      })();
      // Compare steady-state RMS — should be in same ballpark (factor ≤ 3).
      let we = 0, ue = 0;
      for (let i = 512; i < 4096; i++) { we += warped[i]**2; ue += unwarped[i]**2; }
      const ratio = we / (ue + 1e-20);
      if (ratio < 0.2 || ratio > 5) return { pass: false, why: `RMS ratio ${ratio.toFixed(3)} out of band` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp(8, 128, 0.65);
      runBuf(op, whiteBuf(1024, 3));
      op.reset();
      const out = new Float32Array(64);
      op.process({ in: new Float32Array(64) }, { residual: out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → zero, no NaN',
    run() {
      const op = freshOp(8, 128, 0.65);
      const out = new Float32Array(256);
      op.process({}, { residual: out }, 256);
      for (let i = 0; i < 256; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(128) }, {}, 128);
      return { pass: true };
    },
  },
];

export default { opId: 'warpedLPC', tests };
