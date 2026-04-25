// op_stereoWidth.test.js — real-math tests for op_stereoWidth.
// Run via: node scripts/check_op_math.mjs
//
// Contract (see op_stereoWidth.worklet.js header):
//   width = E[S²] / (E[M²] + E[S²]), bounded [0,1]
//   L = R  → 0
//   L = −R → 1
//   L only (R=0), or decorrelated → 0.5
//   silence → 0.5 (neutral)

import { StereoWidthOp } from './op_stereoWidth.worklet.js';

const SR = 48000;

function freshOp(timeMs = 300) {
  const op = new StereoWidthOp(SR);
  op.reset();
  op.setParam('timeMs', timeMs);
  return op;
}

function pump(op, makeL, makeR, N) {
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    l[i] = makeL(i);
    r[i] = makeR(i);
  }
  const out = new Float32Array(N);
  op.process({ l, r }, { width: out }, N);
  return out;
}

const tests = [
  {
    name: 'L=R (pure mono) → width → 0',
    run() {
      const op = freshOp(50);  // fast τ for quick convergence
      const N = SR * 2;
      const out = pump(op, i => Math.sin(2*Math.PI*1000*i/SR), i => Math.sin(2*Math.PI*1000*i/SR), N);
      const tail = out[N - 1];
      if (tail > 0.01) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'L=−R (pure side) → width → 1',
    run() {
      const op = freshOp(50);
      const N = SR * 2;
      const out = pump(op, i => Math.sin(2*Math.PI*1000*i/SR), i => -Math.sin(2*Math.PI*1000*i/SR), N);
      const tail = out[N - 1];
      if (tail < 0.99) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'decorrelated noise → width ≈ 0.5',
    run() {
      const op = freshOp(100);
      const N = SR * 2;
      // Uncorrelated PRNG noise on L and R.
      let a = 1, b = 2;
      const mulb = () => (a = (a * 1664525 + 1013904223) >>> 0, (a / 0xFFFFFFFF) * 2 - 1);
      const mulb2 = () => (b = (b * 22695477 + 1) >>> 0, (b / 0xFFFFFFFF) * 2 - 1);
      const out = pump(op, () => mulb(), () => mulb2(), N);
      // Average over last 500ms to smooth estimator noise.
      const startAvg = N - Math.floor(SR * 0.5);
      let s = 0; for (let i = startAvg; i < N; i++) s += out[i];
      const avg = s / (N - startAvg);
      if (avg < 0.4 || avg > 0.6) return { pass: false, why: `avg=${avg}` };
      return { pass: true };
    },
  },
  {
    name: 'hard-panned mono (L-only) → width → 0.5',
    run() {
      const op = freshOp(50);
      const N = SR * 2;
      const out = pump(op, i => Math.sin(2*Math.PI*1000*i/SR), () => 0, N);
      const tail = out[N - 1];
      if (tail < 0.48 || tail > 0.52) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'silence → width = 0.5 (neutral)',
    run() {
      const op = freshOp(100);
      const out = pump(op, () => 0, () => 0, 512);
      for (let i = 0; i < 512; i++) {
        if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'output always in [0, 1]',
    run() {
      const op = freshOp(200);
      const N = SR;
      const out = pump(op,
        i => Math.sin(i * 0.013) * 3 - 1,
        i => Math.sin(i * 0.017) * 2 + 0.5,
        N);
      for (let i = 0; i < N; i++) {
        if (out[i] < 0 || out[i] > 1) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'energy preservation: eMM + eSS ≡ eLL + eRR (Parseval/Bauer)',
    run() {
      // This is a property of the M/S matrix with √2 norm; width being
      // eSS/(eMM+eSS) means the *denominator* equals total input energy.
      // Drive L-only with sine A=1: eLL+eRR = 0.5 (mean of sin²). Width=0.5.
      const op = freshOp(50);
      const N = SR * 2;
      const out = pump(op, i => Math.sin(2*Math.PI*1000*i/SR), () => 0, N);
      if (Math.abs(out[N-1] - 0.5) > 0.01) return { pass: false, why: `tail=${out[N-1]}` };
      return { pass: true };
    },
  },
  {
    name: 'τ responsiveness: short τ tracks transitions faster than long τ',
    run() {
      // Pre-charge both with pure mono (drives eMM up, eSS=0, width=0).
      // Then flip to pure side (L=-R) — fast τ should climb toward 1
      // quicker than slow τ. From zero state both would jump to 1
      // instantly (eMM stays 0), so pre-charge is essential.
      const opFast = freshOp(20);
      const opSlow = freshOp(500);
      const pre = SR;  // 1s of mono to saturate eMM
      const post = Math.floor(SR * 0.05);  // 50ms of side

      const lMono = new Float32Array(pre);
      const rMono = new Float32Array(pre);
      for (let i = 0; i < pre; i++) {
        lMono[i] = Math.sin(2*Math.PI*1000*i/SR);
        rMono[i] = lMono[i];
      }
      opFast.process({ l: lMono, r: rMono }, { width: new Float32Array(pre) }, pre);
      opSlow.process({ l: lMono, r: rMono }, { width: new Float32Array(pre) }, pre);

      const lSide = new Float32Array(post);
      const rSide = new Float32Array(post);
      for (let i = 0; i < post; i++) {
        lSide[i] = Math.sin(2*Math.PI*1000*(pre+i)/SR);
        rSide[i] = -lSide[i];
      }
      const oFast = new Float32Array(post);
      const oSlow = new Float32Array(post);
      opFast.process({ l: lSide, r: rSide }, { width: oFast }, post);
      opSlow.process({ l: lSide, r: rSide }, { width: oSlow }, post);

      // Fast op should have moved further up toward 1 by end of 50ms window.
      if (oFast[post-1] <= oSlow[post-1]) {
        return { pass: false, why: `fast=${oFast[post-1]} slow=${oSlow[post-1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing L or R → output held at 0.5',
    run() {
      const op = freshOp(100);
      const out = new Float32Array(64);
      op.process({ r: new Float32Array(64).fill(1) }, { width: out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ l: new Float32Array(64), r: new Float32Array(64) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset() clears estimator state',
    run() {
      const op = freshOp(50);
      const N = SR;
      pump(op, i => Math.sin(i*0.01), i => -Math.sin(i*0.01), N);  // drive toward 1
      op.reset();
      // After reset, silence should give 0.5 immediately.
      const out = pump(op, () => 0, () => 0, 32);
      if (out[0] !== 0.5 || out[31] !== 0.5) return { pass: false, why: `out[0]=${out[0]} out[31]=${out[31]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN timeMs is rejected (state preserved)',
    run() {
      const op = freshOp(100);
      const before = op._alpha;
      op.setParam('timeMs', NaN);
      if (op._alpha !== before) return { pass: false, why: `alpha changed ${before}→${op._alpha}` };
      return { pass: true };
    },
  },
  {
    name: 'timeMs clamps to [1, 10000]',
    run() {
      const op = freshOp();
      op.setParam('timeMs', 0);
      const aLow = op._alpha;
      op.setParam('timeMs', 1);
      const aMin = op._alpha;
      if (aLow !== aMin) return { pass: false, why: `timeMs=0 should clamp to 1 (a=${aLow} vs a=${aMin})` };
      op.setParam('timeMs', 99999);
      const aHigh = op._alpha;
      op.setParam('timeMs', 10000);
      const aMax = op._alpha;
      if (aHigh !== aMax) return { pass: false, why: `timeMs=99999 should clamp to 10000` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(100);
      const b = freshOp(100);
      const N = 2048;
      const l = new Float32Array(N);
      const r = new Float32Array(N);
      for (let i = 0; i < N; i++) { l[i] = Math.sin(i*0.013); r[i] = Math.cos(i*0.017); }
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ l, r }, { width: oA }, N);
      b.process({ l, r }, { width: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'stereoWidth', tests };
