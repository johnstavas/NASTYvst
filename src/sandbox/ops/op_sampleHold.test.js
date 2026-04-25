// op_sampleHold.test.js — SC Latch semantics.

import { SampleHoldOp } from './op_sampleHold.worklet.js';

const SR = 48000;

function freshOp() {
  const op = new SampleHoldOp(SR);
  op.reset();
  return op;
}

function render(op, inArr, trigArr) {
  const N = inArr.length;
  const out = new Float32Array(N);
  op.process({ in: inArr, trig: trigArr }, { out }, N);
  return out;
}

const EPS = 1e-6;
function eq(a, b) { return Math.abs(a - b) < EPS; }

const tests = [
  {
    name: 'initial output = 0 before any trigger',
    run() {
      const inBuf   = Float32Array.from({ length: 8 }, (_, i) => i + 1);  // 1,2,3,...
      const trigBuf = new Float32Array(8);  // all zero
      const out = render(freshOp(), inBuf, trigBuf);
      for (let i = 0; i < 8; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'rising edge latches current input',
    run() {
      const inBuf   = Float32Array.of(0.1, 0.2, 0.3, 0.4, 0.5);
      const trigBuf = Float32Array.of(0,   1,   0,   0,   0);  // rising at i=1
      const out = render(freshOp(), inBuf, trigBuf);
      if (out[0] !== 0)   return { pass: false, why: `out[0]=${out[0]}` };
      if (!eq(out[1], 0.2)) return { pass: false, why: `out[1]=${out[1]}` };
      if (!eq(out[2], 0.2)) return { pass: false, why: `out[2]=${out[2]}` };
      if (!eq(out[3], 0.2)) return { pass: false, why: `out[3]=${out[3]}` };
      if (!eq(out[4], 0.2)) return { pass: false, why: `out[4]=${out[4]}` };
      return { pass: true };
    },
  },
  {
    name: 'hold between triggers',
    run() {
      const inBuf   = Float32Array.of(0.1, 0.2, 0.3, 0.4, 0.5, 0.6);
      const trigBuf = Float32Array.of(1,   0,   0,   1,   0,   0);
      const out = render(freshOp(), inBuf, trigBuf);
      // i=0: prevTrig=0, curT=1 → latch in[0]=0.1
      // i=1..2: hold 0.1
      // i=3: prevTrig=0 (from i=2), curT=1 → latch in[3]=0.4
      // i=4..5: hold 0.4
      if (!eq(out[0], 0.1)) return { pass: false, why: `out[0]=${out[0]}` };
      if (!eq(out[1], 0.1)) return { pass: false, why: `out[1]=${out[1]}` };
      if (!eq(out[2], 0.1)) return { pass: false, why: `out[2]=${out[2]}` };
      if (!eq(out[3], 0.4)) return { pass: false, why: `out[3]=${out[3]}` };
      if (!eq(out[4], 0.4)) return { pass: false, why: `out[4]=${out[4]}` };
      if (!eq(out[5], 0.4)) return { pass: false, why: `out[5]=${out[5]}` };
      return { pass: true };
    },
  },
  {
    name: 'trigger held high → only fires on the rising edge',
    run() {
      const inBuf   = Float32Array.of(0.1, 0.2, 0.3, 0.4, 0.5);
      const trigBuf = Float32Array.of(0,   1,   1,   1,   1);  // only rising at i=1
      const out = render(freshOp(), inBuf, trigBuf);
      if (!eq(out[1], 0.2)) return { pass: false, why: `out[1]=${out[1]}` };
      for (let i = 2; i < 5; i++) {
        if (!eq(out[i], 0.2)) return { pass: false, why: `i=${i} out=${out[i]} (should stay latched at first edge)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'negative→positive counts as rising edge (SC semantics)',
    run() {
      const inBuf   = Float32Array.of(0.5, 0.5, 0.5);
      const trigBuf = Float32Array.of(-1,  1,   0);  // rising at i=1
      const out = render(freshOp(), inBuf, trigBuf);
      if (!eq(out[1], 0.5)) return { pass: false, why: `out[1]=${out[1]}` };
      return { pass: true };
    },
  },
  {
    name: 'zero→positive counts as rising (prevTrig <= 0 inclusive)',
    run() {
      const inBuf   = Float32Array.of(0.7, 0.8, 0.9);
      const trigBuf = Float32Array.of(0,   0.01, 0);
      const out = render(freshOp(), inBuf, trigBuf);
      if (!eq(out[1], 0.8)) return { pass: false, why: `out[1]=${out[1]}` };
      return { pass: true };
    },
  },
  {
    name: 'positive→larger-positive does NOT retrigger',
    run() {
      const inBuf   = Float32Array.of(0.1, 0.2, 0.3);
      const trigBuf = Float32Array.of(0.5, 1.0, 2.0);  // prevTrig always > 0 after i=0
      const out = render(freshOp(), inBuf, trigBuf);
      // i=0: prevTrig=0 (init), curT=0.5 → rising, latch 0.1
      // i=1: prevTrig=0.5, curT=1.0 → not rising-through-zero → hold
      // i=2: prevTrig=1.0, curT=2.0 → hold
      if (!eq(out[0], 0.1)) return { pass: false, why: `out[0]=${out[0]}` };
      if (!eq(out[1], 0.1)) return { pass: false, why: `out[1]=${out[1]}` };
      if (!eq(out[2], 0.1)) return { pass: false, why: `out[2]=${out[2]}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary state: prevTrig carries',
    run() {
      const op = freshOp();
      const N = 4;
      // Block A: in=1,2,3,4  trig=0,0,0,1 → latch 4 at final sample
      const inA = Float32Array.of(1, 2, 3, 4), trA = Float32Array.of(0, 0, 0, 1);
      const outA = new Float32Array(N); op.process({ in: inA, trig: trA }, { out: outA }, N);
      // Block B: in=5,6,7,8  trig=1,1,0,1 → first sample: prevTrig=1 (carried), curT=1 → no rising; level stays 4
      // i=1: prevTrig=1 curT=1 → no
      // i=2: prevTrig=1 curT=0 → no
      // i=3: prevTrig=0 curT=1 → latch 8
      const inB = Float32Array.of(5, 6, 7, 8), trB = Float32Array.of(1, 1, 0, 1);
      const outB = new Float32Array(N); op.process({ in: inB, trig: trB }, { out: outB }, N);
      if (outB[0] !== 4) return { pass: false, why: `B[0]=${outB[0]} (prevTrig should carry across blocks)` };
      if (outB[1] !== 4) return { pass: false, why: `B[1]=${outB[1]}` };
      if (outB[2] !== 4) return { pass: false, why: `B[2]=${outB[2]}` };
      if (outB[3] !== 8) return { pass: false, why: `B[3]=${outB[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears held level and prevTrig',
    run() {
      const op = freshOp();
      op.process({ in: Float32Array.of(0.9), trig: Float32Array.of(1) }, { out: new Float32Array(1) }, 1);
      op.reset();
      const out = new Float32Array(2);
      op.process({ in: Float32Array.of(0.5, 0.5), trig: Float32Array.of(0, 0) }, { out }, 2);
      if (!eq(out[0], 0)) return { pass: false, why: `out[0]=${out[0]} after reset` };
      if (!eq(out[1], 0)) return { pass: false, why: `out[1]=${out[1]} after reset` };
      return { pass: true };
    },
  },
  {
    name: 'missing inputs → zero hold, no throw',
    run() {
      const op = freshOp();
      const out = new Float32Array(8);
      try { op.process({}, { out }, 8); }
      catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < 8; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp();
      try { op.process({ in: Float32Array.of(1), trig: Float32Array.of(1) }, {}, 1); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'finite + bounded for any input',
    run() {
      const op = freshOp();
      const N = 256;
      const inBuf   = new Float32Array(N);
      const trigBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        inBuf[i]   = Math.sin(2 * Math.PI * i / 32) * 1e6;
        trigBuf[i] = (i % 7 === 0) ? 1 : 0;
      }
      const out = render(op, inBuf, trigBuf);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: identical input + trig → identical output',
    run() {
      const N = 128;
      const inBuf   = new Float32Array(N);
      const trigBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        inBuf[i]   = Math.sin(i * 0.1);
        trigBuf[i] = (i % 13 === 0) ? 1 : 0;
      }
      const a = render(freshOp(), inBuf, trigBuf);
      const b = render(freshOp(), inBuf, trigBuf);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp().getLatencySamples() !== 0) return { pass: false };
      return { pass: true };
    },
  },
];

export default { opId: 'sampleHold', tests };
