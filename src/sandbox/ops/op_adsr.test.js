// op_adsr.test.js — real-math tests for op_adsr.
// Run via: node scripts/check_op_math.mjs
//
// Primary: musicdsp.org/en/latest/Synthesis/189-fast-exponential-envelope-generator.html
// Verifies:
//   - Idle output is zero before any gate
//   - Rising edge triggers attack 0→1 within ~attackMs
//   - After attack, decay approaches sustain
//   - Sustain holds while gate high
//   - Falling edge triggers release to 0
//   - Output stays in [0, 1]; reset clears; determinism; null-gate safe

import { AdsrOp } from './op_adsr.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new AdsrOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function run(op, gateFill, n) {
  const gate = new Float32Array(n);
  for (let i = 0; i < n; i++) gate[i] = typeof gateFill === 'function' ? gateFill(i) : gateFill;
  const out = new Float32Array(n);
  op.process({ gate }, { out }, n);
  return { gate, out };
}

const tests = [
  {
    name: 'idle output is zero before any gate',
    run() {
      const op = freshOp();
      const { out } = run(op, 0, 128);
      for (let i = 0; i < 128; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'rising gate triggers attack; reaches ≥0.99 within ~attackMs',
    run() {
      const op = freshOp({ attackMs: 5, decayMs: 1000, sustain: 1.0, releaseMs: 200 });
      const n = Math.ceil(SR * 0.010); // 10 ms window
      const { out } = run(op, 1, n);
      // By sample = attackSamples we should have hit ~1
      const target = Math.ceil(SR * 0.005) + 2;
      if (out[target] < 0.99) return { pass: false, why: `at ${target}: ${out[target].toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'attack is monotonically non-decreasing',
    run() {
      const op = freshOp({ attackMs: 10, decayMs: 100, sustain: 1.0, releaseMs: 200 });
      const n = Math.ceil(SR * 0.009);
      const { out } = run(op, 1, n);
      for (let i = 1; i < n; i++)
        if (out[i] + 1e-9 < out[i-1]) return { pass: false, why: `out[${i}]=${out[i]} < out[${i-1}]=${out[i-1]}` };
      return { pass: true };
    },
  },
  {
    name: 'after attack+decay, level settles near sustain',
    run() {
      const op = freshOp({ attackMs: 2, decayMs: 20, sustain: 0.5, releaseMs: 200 });
      const n = Math.ceil(SR * 0.2); // well past attack+decay
      const { out } = run(op, 1, n);
      const tail = out[n - 1];
      if (Math.abs(tail - 0.5) > 0.01) return { pass: false, why: `tail=${tail.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'sustain holds steady while gate remains high',
    run() {
      const op = freshOp({ attackMs: 1, decayMs: 5, sustain: 0.3, releaseMs: 200 });
      const n = Math.ceil(SR * 0.1);
      const { out } = run(op, 1, n);
      const a = out[n - 2000];
      const b = out[n - 1];
      if (Math.abs(a - b) > 1e-6) return { pass: false, why: `drift ${a}→${b}` };
      if (Math.abs(b - 0.3) > 0.005) return { pass: false, why: `sus=${b}` };
      return { pass: true };
    },
  },
  {
    name: 'falling gate triggers release toward 0',
    run() {
      const op = freshOp({ attackMs: 1, decayMs: 5, sustain: 0.5, releaseMs: 20 });
      const nHold = Math.ceil(SR * 0.05);
      const nRel  = Math.ceil(SR * 0.1);
      run(op, 1, nHold);                          // hold high → sustain
      const { out } = run(op, 0, nRel);           // drop → release
      if (out[0] < 0.4) return { pass: false, why: `release start ${out[0]}` };
      if (out[nRel - 1] > 0.01) return { pass: false, why: `release tail ${out[nRel-1]}` };
      return { pass: true };
    },
  },
  {
    name: 'output always in [0, 1]',
    run() {
      const op = freshOp({ attackMs: 3, decayMs: 30, sustain: 0.8, releaseMs: 50 });
      const n1 = Math.ceil(SR * 0.1);
      const a = run(op, 1, n1);
      for (let i = 0; i < n1; i++) if (a.out[i] < 0 || a.out[i] > 1.0001)
        return { pass: false, why: `out[${i}]=${a.out[i]}` };
      const b = run(op, 0, n1);
      for (let i = 0; i < n1; i++) if (b.out[i] < 0 || b.out[i] > 1.0001)
        return { pass: false, why: `rel out[${i}]=${b.out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() returns to idle (no output until next gate)',
    run() {
      const op = freshOp({ attackMs: 2, decayMs: 10, sustain: 0.5, releaseMs: 50 });
      run(op, 1, 4096);
      op.reset();
      const { out } = run(op, 0, 128);
      for (let i = 0; i < 128; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'retrigger mid-release restarts attack from current level',
    run() {
      const op = freshOp({ attackMs: 2, decayMs: 5, sustain: 0.5, releaseMs: 500 });
      run(op, 1, Math.ceil(SR * 0.05));     // hold → sustain 0.5
      run(op, 0, Math.ceil(SR * 0.05));     // release partway
      const a = run(op, 1, Math.ceil(SR * 0.01)).out; // retrigger
      let peak = 0;
      for (let i = 0; i < a.length; i++) peak = Math.max(peak, a[i]);
      if (peak < 0.95) return { pass: false, why: `post-retrigger peak ${peak}` };
      return { pass: true };
    },
  },
  {
    name: 'missing gate input → zero output, idle state',
    run() {
      const op = freshOp();
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same gate → identical output across fresh instances',
    run() {
      const mk = () => freshOp({ attackMs: 3, decayMs: 20, sustain: 0.6, releaseMs: 80 });
      const gate = (i) => i < 2000 ? 1 : 0;
      const a = run(mk(), gate, 8000).out;
      const b = run(mk(), gate, 8000).out;
      for (let i = 0; i < 8000; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'adsr', tests };
