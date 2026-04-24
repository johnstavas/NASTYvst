// op_gainComputer.test.js — real-math tests for op_gainComputer.
// Run via: node scripts/check_op_math.mjs
//
// Zölzer DAFX §4.2.2 soft-knee static gain computer. Input: linear envelope
// magnitude. Output: delta-from-unity GR signal in [-1, 0], sums into
// gain.gainMod where base = 1.0. Tests cover: below-threshold passthrough
// (GR=0), above-threshold ratio compression, knee midpoint smoothness,
// monotonicity (T6.GAINCOMP_MONOTONIC contract), ratio=1 = no compression,
// and polarity (GR always ≤ 0).

import { GainComputerOp } from './op_gainComputer.worklet.js';

const SR  = 48000;
const N   = 32;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (lin) => 20 * Math.log10(Math.max(1e-12, lin));

function freshOp(params = {}) {
  const op = new GainComputerOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, envFill) {
  const envBuf = new Float32Array(N);
  for (let i = 0; i < N; i++) envBuf[i] = typeof envFill === 'function' ? envFill(i) : envFill;
  const out = new Float32Array(N);
  op.process({ env: envBuf }, { gr: out }, N);
  return out;
}

const tests = [
  {
    name: 'below threshold: GR = 0 (no reduction)',
    run() {
      const op = freshOp({ thresholdDb: -12, ratio: 4, kneeDb: 0 });
      const out = drive(op, dbToLin(-24));  // well below threshold
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'well above threshold: GR matches ratio compression (hard knee)',
    run() {
      // thr=-12, ratio=4, knee=0. Input at 0 dB → output = -12 + 12/4 = -9 dB.
      // Therefore GR dB = -9 - 0 = -9 dB → grLin - 1 = 10^(-9/20) - 1 ≈ -0.6456.
      const op = freshOp({ thresholdDb: -12, ratio: 4, kneeDb: 0 });
      const out = drive(op, 1.0);  // 0 dB
      const expected = Math.pow(10, -9 / 20) - 1;
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 5e-4)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'at threshold (hard knee): GR ≈ 0',
    run() {
      const op = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 0 });
      const out = drive(op, dbToLin(-18));
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0, 5e-3)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'GR is always ≤ 0 (never adds gain)',
    run() {
      const op = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 6 });
      for (const dB of [-60, -30, -18, -12, -6, 0, +6]) {
        const out = drive(op, dbToLin(dB));
        if (out[0] > 1e-6) return { pass: false, why: `at ${dB} dB, GR=${out[0]} > 0` };
      }
      return { pass: true };
    },
  },
  {
    name: 'monotonicity: GR non-increasing as input grows',
    run() {
      // T6.GAINCOMP_MONOTONIC — hotter input must not produce LESS reduction.
      const op = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 6 });
      let prev = 0;
      for (let dB = -60; dB <= 6; dB += 0.5) {
        const out = drive(op, dbToLin(dB));
        if (out[0] > prev + 1e-6) return { pass: false, why: `non-monotonic at ${dB} dB: ${out[0]} > prev ${prev}` };
        prev = out[0];
      }
      return { pass: true };
    },
  },
  {
    name: 'ratio=1: no compression regardless of level',
    run() {
      const op = freshOp({ thresholdDb: -18, ratio: 1, kneeDb: 0 });
      for (const dB of [-30, -18, -6, 0, +6]) {
        const out = drive(op, dbToLin(dB));
        if (!approx(out[0], 0, 1e-4)) return { pass: false, why: `at ${dB} dB, GR=${out[0]} (ratio=1 should be 0)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'higher ratio → more reduction at same input',
    run() {
      const op4  = freshOp({ thresholdDb: -18, ratio: 4,  kneeDb: 0 });
      const op20 = freshOp({ thresholdDb: -18, ratio: 20, kneeDb: 0 });
      const out4  = drive(op4,  dbToLin(0));
      const out20 = drive(op20, dbToLin(0));
      // More negative = more reduction.
      if (!(out20[0] < out4[0])) return { pass: false, why: `ratio 20 GR=${out20[0]} not < ratio 4 GR=${out4[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'soft knee: midpoint smoother than hard knee at threshold',
    run() {
      // At exact threshold, hard knee = break point (GR=0), soft knee starts
      // reducing earlier. Soft knee midpoint should have *some* negative GR.
      const opHard = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 0 });
      const opSoft = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 12 });
      const grHard = drive(opHard, dbToLin(-18))[0];
      const grSoft = drive(opSoft, dbToLin(-18))[0];
      if (!(grSoft < grHard)) return { pass: false, why: `soft knee GR=${grSoft} not < hard knee GR=${grHard}` };
      return { pass: true };
    },
  },
  {
    name: 'negative envelope input treated as magnitude',
    run() {
      const op = freshOp({ thresholdDb: -12, ratio: 4, kneeDb: 0 });
      const pos = drive(op, 0.5);
      const neg = drive(op, -0.5);
      if (!approx(pos[0], neg[0], 1e-6)) return { pass: false, why: `pos=${pos[0]} neg=${neg[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing env input → GR = 0 (no reduction)',
    run() {
      const op = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 6 });
      const out = new Float32Array(N);
      op.process({}, { gr: out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() is no-op for stateless computer',
    run() {
      const op = freshOp({ thresholdDb: -18, ratio: 4, kneeDb: 0 });
      drive(op, 1);
      op.reset();
      const a = drive(op, 1);
      const b = drive(op, 1);
      if (!approx(a[0], b[0], 1e-9)) return { pass: false, why: `post-reset mismatch` };
      return { pass: true };
    },
  },
  {
    name: 'ratio clamp: ratio<1 treated as 1 (no negative-compression)',
    run() {
      const op = freshOp({ thresholdDb: -18, ratio: 0.5, kneeDb: 0 });
      // Should behave like ratio=1 → GR=0 always.
      const out = drive(op, 1);
      if (!approx(out[0], 0, 1e-4)) return { pass: false, why: `GR=${out[0]} not 0 for ratio<1` };
      return { pass: true };
    },
  },
];

export default { opId: 'gainComputer', tests };
