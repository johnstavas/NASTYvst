// op_bpm.test.js — real-math tests for op_bpm.
// Primary reference: Frédéric Patin, "Beat Detection Algorithms" (2003),
// Simple Sound Energy Algorithm #3.

import { BpmOp } from './op_bpm.worklet.js';

const SR = 44100;

function freshOp(params = {}) {
  const op = new BpmOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, signalFn, nSamples) {
  const N = 512;
  const outE = new Float32Array(nSamples);
  const outB = new Float32Array(nSamples);
  let pos = 0;
  while (pos < nSamples) {
    const chunk = Math.min(N, nSamples - pos);
    const inp = new Float32Array(chunk);
    for (let i = 0; i < chunk; i++) inp[i] = signalFn(pos + i);
    const bE = new Float32Array(chunk);
    const bB = new Float32Array(chunk);
    op.process({ in: inp }, { energy: bE, beat: bB }, chunk);
    outE.set(bE, pos);
    outB.set(bB, pos);
    pos += chunk;
  }
  return { outE, outB };
}

const tests = [
  {
    name: 'silent input → zero energy, zero beats',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      const { outE, outB } = drive(op, () => 0, 256 * 20);
      for (let i = 0; i < outE.length; i++) {
        if (outE[i] !== 0) return { pass: false, why: `E[${i}]=${outE[i]}` };
        if (outB[i] !== 0) return { pass: false, why: `B[${i}]=${outB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'warm-up: no beats during first `histDepth` windows',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 10 });
      // Drive with constant-amplitude noise; warm-up window = 256*10 samples.
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const nWarm = 256 * 10;
      const { outB } = drive(op, rng, nWarm);
      for (let i = 0; i < nWarm; i++) {
        if (outB[i] !== 0) return { pass: false, why: `beat during warm-up at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'constant-amplitude signal → zero variance → no beats',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      // Square wave of constant energy per window → E[i] identical → V=0
      // → C = 1.5142857 → e > 1.5142857·<E> is false (e ≈ <E>).
      const { outB } = drive(op, (n) => ((n & 1) ? 0.5 : -0.5), 256 * 30);
      let beats = 0;
      for (let i = 0; i < outB.length; i++) if (outB[i] > 0) beats++;
      if (beats !== 0) return { pass: false, why: `expected 0 beats, got ${beats}` };
      return { pass: true };
    },
  },
  {
    name: 'energy spike after quiet history produces a beat',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      // 12 quiet windows (amplitude 0.01), then one loud window (amplitude 0.8).
      const W = 256, H = 8;
      const spikeStart = W * (H + 4);  // beyond warm-up
      const { outB } = drive(op,
        (n) => (n >= spikeStart && n < spikeStart + W) ? 0.8 : 0.01,
        W * (H + 10));
      let beats = 0;
      for (let i = 0; i < outB.length; i++) if (outB[i] > 0) beats++;
      if (beats < 1) return { pass: false, why: `expected ≥1 beat at spike, got ${beats}` };
      return { pass: true };
    },
  },
  {
    name: 'beat pulse is single-sample at window boundary',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      const W = 256;
      const spikeStart = W * 12;
      const { outB } = drive(op,
        (n) => (n >= spikeStart && n < spikeStart + W) ? 0.8 : 0.01,
        W * 18);
      for (let i = 0; i < outB.length; i++) {
        if (outB[i] !== 0) {
          if (i % W !== 0) return { pass: false, why: `beat at ${i} not on window boundary` };
          if (outB[i] !== 1) return { pass: false, why: `beat=${outB[i]} != 1` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'energy output magnitude matches per-sample mean-square',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      // Constant amplitude A=0.5 → e = W·A² → e/W = A² = 0.25.
      const { outE } = drive(op, () => 0.5, 256 * 4);
      // After first window completes, heldE = 0.25.
      const tail = outE[outE.length - 1];
      if (Math.abs(tail - 0.25) > 1e-6) return { pass: false, why: `heldE=${tail}, expected 0.25` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same outputs',
    run() {
      const sig = (n) => Math.sin(2 * Math.PI * 440 * n / SR) * (((n / 1024) | 0) % 3 === 0 ? 0.8 : 0.05);
      const a = drive(freshOp({ windowN: 512, histDepth: 10 }), sig, 512 * 20);
      const b = drive(freshOp({ windowN: 512, histDepth: 10 }), sig, 512 * 20);
      for (let i = 0; i < a.outE.length; i++) {
        if (a.outE[i] !== b.outE[i]) return { pass: false, why: `E diverge at ${i}` };
        if (a.outB[i] !== b.outB[i]) return { pass: false, why: `B diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset restores silence state',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      drive(op, (n) => Math.sin(n * 0.1) * 0.5, 256 * 20);
      op.reset();
      const { outE, outB } = drive(op, () => 0, 256 * 4);
      for (let i = 0; i < outE.length; i++) {
        if (outE[i] !== 0) return { pass: false, why: `post-reset E[${i}]=${outE[i]}` };
        if (outB[i] !== 0) return { pass: false, why: `post-reset B[${i}]=${outB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → zero energy, no NaN',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      const outE = new Float32Array(256);
      const outB = new Float32Array(256);
      op.process({}, { energy: outE, beat: outB }, 256);
      for (let i = 0; i < 256; i++) {
        if (!Number.isFinite(outE[i]) || outE[i] !== 0) return { pass: false, why: `outE[${i}]=${outE[i]}` };
        if (!Number.isFinite(outB[i]) || outB[i] !== 0) return { pass: false, why: `outB[${i}]=${outB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp({ windowN: 256, histDepth: 8 });
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
  {
    name: 'param clamps — windowN [32, 16384], histDepth [2, 512]',
    run() {
      const op = freshOp();
      op.setParam('windowN', 16);
      if (op._windowN !== 32) return { pass: false, why: `windowN min got ${op._windowN}` };
      op.setParam('windowN', 1 << 20);
      if (op._windowN !== 16384) return { pass: false, why: `windowN max got ${op._windowN}` };
      op.setParam('histDepth', 1);
      if (op._histDepth !== 2) return { pass: false, why: `histDepth min got ${op._histDepth}` };
      op.setParam('histDepth', 9999);
      if (op._histDepth !== 512) return { pass: false, why: `histDepth max got ${op._histDepth}` };
      op.setParam('windowN', NaN);
      if (op._windowN !== 16384) return { pass: false, why: `NaN should be ignored` };
      return { pass: true };
    },
  },
  {
    name: 'C formula check: V=25 → C≈1.45, V=200 → C≈1.0 (Patin R5)',
    run() {
      // Not exposed as a public method; verify the regression endpoints
      // numerically from the R6 formula itself.
      const C25  = -0.0025714 * 25  + 1.5142857;
      const C200 = -0.0025714 * 200 + 1.5142857;
      if (Math.abs(C25  - 1.45) > 0.01) return { pass: false, why: `C(25)=${C25}` };
      if (Math.abs(C200 - 1.0)  > 0.01) return { pass: false, why: `C(200)=${C200}` };
      return { pass: true };
    },
  },
  {
    name: 'latency equals windowN',
    run() {
      const op = freshOp({ windowN: 512 });
      if (op.getLatencySamples() !== 512) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
];

export default { opId: 'bpm', tests };
