// op_lookahead.test.js — math tests for #45 lookahead primitive.
// Math-by-definition: out[n] = x[n−L]; peak[n] = max|x[k]|, k∈[n−L, n].

import { LookaheadOp } from './op_lookahead.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new LookaheadOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function driveOne(op, inp, wantPeak = false) {
  const N = inp.length;
  const outA = new Float32Array(N);
  const outP = new Float32Array(N);
  const CHUNK = 256;
  let pos = 0;
  while (pos < N) {
    const c = Math.min(CHUNK, N - pos);
    const ix = inp.slice(pos, pos + c);
    const oa = new Float32Array(c);
    const op2 = new Float32Array(c);
    op.process({ in: ix }, { out: oa, peak: op2 }, c);
    outA.set(oa, pos);
    outP.set(op2, pos);
    pos += c;
  }
  return wantPeak ? { aud: outA, peak: outP } : outA;
}

const tests = [
  {
    name: 'pure delay: out[n] = x[n-L] after priming',
    run() {
      const op = freshOp({ lookaheadMs: 1 }); // L=48
      const L = op.getLatencySamples();
      const N = 1024;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1);
      const out = driveOne(op, inp);
      for (let i = L; i < N; i++) {
        if (Math.abs(out[i] - inp[i - L]) > 1e-6) {
          return { pass: false, why: `i=${i} out=${out[i]} expected=${inp[i-L]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'L=0 degenerate: out = x, peak = |x|, latency 0',
    run() {
      const op = freshOp({ lookaheadMs: 0 });
      if (op.getLatencySamples() !== 0) return { pass: false, why: `lat=${op.getLatencySamples()}` };
      const N = 256;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = (i % 2 === 0 ? 1 : -1) * 0.3;
      const { aud, peak } = driveOne(op, inp, true);
      for (let i = 0; i < N; i++) {
        if (aud[i] !== inp[i]) return { pass: false, why: `aud diverge at ${i}` };
        if (Math.abs(peak[i] - Math.abs(inp[i])) > 1e-6) return { pass: false, why: `peak diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples matches lookaheadMs·sr/1000',
    run() {
      const op = freshOp({ lookaheadMs: 5 });
      const L = op.getLatencySamples();
      if (Math.abs(L - Math.round(5 / 1000 * SR)) > 0) return { pass: false, why: `L=${L}` };
      return { pass: true };
    },
  },
  {
    name: 'peak output tracks true windowed max',
    run() {
      const op = freshOp({ lookaheadMs: 1 }); // L=48
      const L = op.getLatencySamples();
      const N = 2048;
      const inp = new Float32Array(N);
      // Drop an impulse at i=200.
      inp[200] = 1.0;
      const { peak } = driveOne(op, inp, true);
      // Peak should be 1.0 from sample 200 through 200+L, then drop.
      for (let i = 200; i <= 200 + L; i++) {
        if (peak[i] !== 1) return { pass: false, why: `i=${i} peak=${peak[i]}` };
      }
      if (peak[200 + L + 1] >= 1) return { pass: false, why: `peak did not decay after window` };
      return { pass: true };
    },
  },
  {
    name: 'peak = 0 before any nonzero input',
    run() {
      const op = freshOp({ lookaheadMs: 2 });
      const { peak } = driveOne(op, new Float32Array(512), true);
      for (let i = 0; i < 512; i++) if (peak[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'peak leads out (transient visible in peak before in out)',
    run() {
      const op = freshOp({ lookaheadMs: 2 }); // L=96
      const L = op.getLatencySamples();
      const N = 2048;
      const inp = new Float32Array(N);
      // Transient at sample idx = 500.
      inp[500] = 1.0;
      const { aud, peak } = driveOne(op, inp, true);
      // peak at sample 500 should already be 1.0 (just saw the transient).
      if (peak[500] !== 1) return { pass: false, why: `peak[500]=${peak[500]}` };
      // aud at sample 500 should still be 0 (transient hasn't surfaced).
      if (aud[500] !== 0) return { pass: false, why: `aud[500]=${aud[500]}` };
      // aud finally emits the transient at 500 + L.
      if (aud[500 + L] !== 1) return { pass: false, why: `aud[500+L]=${aud[500+L]}` };
      return { pass: true };
    },
  },
  {
    name: 'windowed-max deque correctness on random bursts',
    run() {
      const op = freshOp({ lookaheadMs: 2 });
      const L = op.getLatencySamples();
      const N = 4096;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = (Math.random() * 2 - 1);
      const { peak } = driveOne(op, inp, true);
      // Brute-force reference.
      for (let i = 0; i < N; i++) {
        let m = 0;
        const lo = Math.max(0, i - L);
        for (let k = lo; k <= i; k++) { const a = Math.abs(inp[k]); if (a > m) m = a; }
        if (Math.abs(peak[i] - m) > 1e-5) {
          return { pass: false, why: `i=${i} deque=${peak[i]} brute=${m}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamp: lookaheadMs ≤ 50, ≥ 0',
    run() {
      const op = freshOp({ lookaheadMs: 1000 });
      const Lmax = Math.round(50 / 1000 * SR);
      if (op.getLatencySamples() !== Lmax) return { pass: false, why: `hi L=${op.getLatencySamples()}` };
      op.setParam('lookaheadMs', -5);
      if (op.getLatencySamples() !== 0) return { pass: false, why: `lo L=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ lookaheadMs: 1 });
      const N = 512;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 * Math.sin(i * 0.1);
      driveOne(op, inp);
      op.reset();
      if (op._writeI !== 0 || op._filled !== 0 || op._dqHead !== op._dqTail) {
        return { pass: false, why: `post-reset state dirty` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const N = 4000;
      const sig = new Float32Array(N);
      for (let i = 0; i < N; i++) sig[i] = Math.sin(i * 0.03) + 0.3 * Math.sin(i * 0.13);
      const a = driveOne(freshOp({ lookaheadMs: 3 }), sig);
      const b = driveOne(freshOp({ lookaheadMs: 3 }), sig);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud wideband input stays finite',
    run() {
      const op = freshOp({ lookaheadMs: 5 });
      const N = SR;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.random() * 2 - 1;
      const { aud, peak } = driveOne(op, inp, true);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(aud[i]) || !Number.isFinite(peak[i])) {
          return { pass: false, why: `NaN at ${i}` };
        }
        if (Math.abs(aud[i]) > 2 || peak[i] > 2 || peak[i] < 0) {
          return { pass: false, why: `bad magnitude at ${i}: aud=${aud[i]} peak=${peak[i]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent out + zero peak',
    run() {
      const op = freshOp({ lookaheadMs: 2 });
      const oa = new Float32Array(512);
      const op2 = new Float32Array(512);
      op.process({}, { out: oa, peak: op2 }, 512);
      for (let i = 0; i < 512; i++) {
        if (oa[i] !== 0) return { pass: false, why: `aud[${i}]=${oa[i]}` };
        if (op2[i] !== 0) return { pass: false, why: `peak[${i}]=${op2[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no-op',
    run() {
      const op = freshOp({ lookaheadMs: 2 });
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
  {
    name: 'changing lookaheadMs resets and resizes latency',
    run() {
      const op = freshOp({ lookaheadMs: 1 });
      if (op.getLatencySamples() !== Math.round(1 / 1000 * SR)) return { pass: false, why: 'initial L' };
      op.setParam('lookaheadMs', 10);
      if (op.getLatencySamples() !== Math.round(10 / 1000 * SR)) return { pass: false, why: 'resized L' };
      return { pass: true };
    },
  },
];

export default { opId: 'lookahead', tests };
