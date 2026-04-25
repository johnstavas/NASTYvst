// op_busSum.test.js — real-math tests for op_busSum.
// Math-by-definition: out = in0 + in1 + in2 + in3.

import { BusSumOp } from './op_busSum.worklet.js';

const SR = 48000;

function freshOp() {
  const op = new BusSumOp(SR);
  op.reset();
  return op;
}

function run(inputs, nSamples) {
  const op = freshOp();
  const out = new Float32Array(nSamples);
  op.process(inputs, { out }, nSamples);
  return out;
}

const tests = [
  {
    name: 'all four connected: out = Σ',
    run() {
      const N = 8;
      const a = new Float32Array(N); a.fill(0.1);
      const b = new Float32Array(N); b.fill(0.2);
      const c = new Float32Array(N); c.fill(0.3);
      const d = new Float32Array(N); d.fill(-0.4);
      const out = run({ in0: a, in1: b, in2: c, in3: d }, N);
      for (let i = 0; i < N; i++) {
        const exp = a[i] + b[i] + c[i] + d[i]; // compute in Float32 space
        if (Math.abs(out[i] - exp) > 1e-7) return { pass: false, why: `out[${i}]=${out[i]} vs ${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'only in0 connected → passes through',
    run() {
      const N = 16;
      const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = Math.sin(i * 0.1);
      const out = run({ in0: a }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== a[i]) return { pass: false, why: `out[${i}]=${out[i]} vs ${a[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'only in3 connected → passes through',
    run() {
      const N = 16;
      const d = new Float32Array(N); for (let i = 0; i < N; i++) d[i] = Math.cos(i * 0.1);
      const out = run({ in3: d }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== d[i]) return { pass: false, why: `out[${i}]=${out[i]} vs ${d[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'two inputs with opposite sign cancel to zero',
    run() {
      const N = 32;
      const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = Math.sin(i * 0.2);
      const b = new Float32Array(N); for (let i = 0; i < N; i++) b[i] = -a[i];
      const out = run({ in0: a, in1: b }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]} (expected 0)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'no inputs connected → silence',
    run() {
      const out = run({}, 64);
      for (let i = 0; i < 64; i++) {
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no crash',
    run() {
      const op = freshOp();
      const a = new Float32Array(8); a.fill(1);
      op.process({ in0: a }, {}, 8);
      return { pass: true };
    },
  },
  {
    name: 'unity gain (not 1/N averaging) — two unity inputs sum to 2',
    run() {
      const N = 8;
      const a = new Float32Array(N); a.fill(1);
      const b = new Float32Array(N); b.fill(1);
      const out = run({ in0: a, in1: b }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== 2) return { pass: false, why: `out[${i}]=${out[i]} (expected 2, confirming no averaging)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'port order independence: in2-only == in0-only (of same signal)',
    run() {
      const N = 16;
      const x = new Float32Array(N); for (let i = 0; i < N; i++) x[i] = i * 0.05;
      const a = run({ in0: x }, N);
      const c = run({ in2: x }, N);
      for (let i = 0; i < N; i++) {
        if (a[i] !== c[i]) return { pass: false, why: `port-order mismatch at ${i}: ${a[i]} vs ${c[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const N = 128;
      const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = Math.sin(i * 0.13);
      const b = new Float32Array(N); for (let i = 0; i < N; i++) b[i] = Math.cos(i * 0.17);
      const o1 = run({ in0: a, in2: b }, N);
      const o2 = run({ in0: a, in2: b }, N);
      for (let i = 0; i < N; i++) {
        if (o1[i] !== o2[i]) return { pass: false, why: `diverge at ${i}` };
      }
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
      const op = freshOp();
      const a = new Float32Array(8); a[0] = 0.5;
      const o1 = new Float32Array(8);
      op.process({ in0: a }, { out: o1 }, 8);
      op.reset();
      const o2 = new Float32Array(8);
      op.process({ in0: a }, { out: o2 }, 8);
      for (let i = 0; i < 8; i++) {
        if (o1[i] !== o2[i]) return { pass: false, why: `diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'loud noise on all four → no NaN / no runaway (bounded by 4·max)',
    run() {
      const N = 2048;
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rng() * 2;
      const b = new Float32Array(N); for (let i = 0; i < N; i++) b[i] = rng() * 2;
      const c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = rng() * 2;
      const d = new Float32Array(N); for (let i = 0; i < N; i++) d[i] = rng() * 2;
      const out = run({ in0: a, in1: b, in2: c, in3: d }, N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i]) || Math.abs(out[i]) > 8) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'busSum', tests };
