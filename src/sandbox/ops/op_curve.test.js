// op_curve.test.js — real-math tests for op_curve.
//
// First op test sidecar. Pattern to follow for future ops:
//   - Default export: { opId, tests: [{ name, run(ctx) }] }
//   - `run(ctx)` returns { pass: bool, why?: string }.
//   - ctx provides: { SidecarClass, SR, N, approx, makeBuf, drive(inst, inBuf) }
//   - A future scripts/check_op_math.mjs harness discovers op_<id>.test.js
//     files and executes tests uniformly. For now this file is also directly
//     runnable with `node src/sandbox/ops/op_curve.test.js` (self-hosted ctx
//     when invoked as main).

import { CurveOp } from './op_curve.worklet.js';

const SR = 48000;
const N  = 128;
const EPS = 1e-5;

const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function makeBuf(fillFn) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = fillFn(i);
  return buf;
}

function drive(inst, inBuf) {
  const out = new Float32Array(N);
  inst.process({ in: inBuf }, { out }, N);
  return out;
}

function freshOp(params = {}) {
  const op = new CurveOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

const tests = [
  // ---- endpoints ------------------------------------------------------
  {
    name: 'identity default: x=0 -> 0, x=1 -> 1',
    run() {
      const op = freshOp();
      const inBuf = makeBuf(i => (i === 0 ? 0 : i === 1 ? 1 : 0.5));
      const out = drive(op, inBuf);
      if (!approx(out[0], 0)) return { pass: false, why: `out[0]=${out[0]} expected 0` };
      if (!approx(out[1], 1)) return { pass: false, why: `out[1]=${out[1]} expected 1` };
      return { pass: true };
    },
  },

  // ---- identity is monotonic ----------------------------------------
  {
    name: 'identity default: ramp input → monotonic non-decreasing output',
    run() {
      const op = freshOp();
      const inBuf = makeBuf(i => i / (N - 1));
      const out = drive(op, inBuf);
      for (let i = 1; i < N; i++) {
        if (out[i] + EPS < out[i - 1]) {
          return { pass: false, why: `out[${i}]=${out[i]} < out[${i-1}]=${out[i-1]}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- identity preserves values (within f32 rounding) --------------
  {
    name: 'identity default: y ≈ x across ramp',
    run() {
      const op = freshOp();
      const inBuf = makeBuf(i => i / (N - 1));
      const out = drive(op, inBuf);
      for (let i = 0; i < N; i++) {
        if (!approx(out[i], inBuf[i], 1e-4)) {
          return { pass: false, why: `out[${i}]=${out[i]} ≠ in=${inBuf[i]}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- hermite midpoint with known tangents -------------------------
  {
    name: 'hermite [[0,0,t=0][1,1,t=0]]: midpoint = smoothstep(0.5) = 0.5',
    run() {
      // With zero tangents at both endpoints, cubic Hermite reduces to
      // h00·0 + h01·1 = (−2t³+3t²), which is the smoothstep polynomial.
      // smoothstep(0.5) = 3·0.25 − 2·0.125 = 0.75 − 0.25 = 0.5 exactly.
      const op = freshOp({
        points: [
          { x: 0, y: 0, tIn: 0, tOut: 0 },
          { x: 1, y: 1, tIn: 0, tOut: 0 },
        ],
      });
      const inBuf = makeBuf(() => 0.5);
      const out = drive(op, inBuf);
      if (!approx(out[0], 0.5, 1e-5)) return { pass: false, why: `got ${out[0]} expected 0.5` };
      return { pass: true };
    },
  },

  {
    name: 'hermite [[0,0,t=0][1,1,t=0]]: t=0.25 = smoothstep(0.25) = 0.15625',
    run() {
      const op = freshOp({
        points: [
          { x: 0, y: 0, tIn: 0, tOut: 0 },
          { x: 1, y: 1, tIn: 0, tOut: 0 },
        ],
      });
      const inBuf = makeBuf(() => 0.25);
      const out = drive(op, inBuf);
      const expected = 3 * 0.25 * 0.25 - 2 * 0.25 * 0.25 * 0.25; // 0.15625
      if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `got ${out[0]} expected ${expected}` };
      return { pass: true };
    },
  },

  // ---- linear interp mode -------------------------------------------
  {
    name: 'linear interp with 3 points: midpoints hit exact segment lerps',
    run() {
      const op = freshOp({
        interp: 'linear',
        points: [
          { x: 0,   y: 0,   tIn: 0, tOut: 0 },
          { x: 0.5, y: 0.2, tIn: 0, tOut: 0 },
          { x: 1,   y: 1,   tIn: 0, tOut: 0 },
        ],
      });
      // x=0.25 → 0.1 (lerp of (0,0)..(0.5,0.2))
      // x=0.75 → 0.6 (lerp of (0.5,0.2)..(1,1))
      const inBuf = new Float32Array(N);
      inBuf[0] = 0.25;
      inBuf[1] = 0.75;
      const out = drive(op, inBuf);
      if (!approx(out[0], 0.1, 1e-5)) return { pass: false, why: `x=0.25 out=${out[0]} expected 0.1` };
      if (!approx(out[1], 0.6, 1e-5)) return { pass: false, why: `x=0.75 out=${out[1]} expected 0.6` };
      return { pass: true };
    },
  },

  // ---- catmull auto-tangent vs hand-computed ------------------------
  {
    name: 'catmull: 3-point tangents match (y[i+1]-y[i-1])/(x[i+1]-x[i-1])',
    run() {
      // Points (0,0), (0.5, 0.3), (1, 1). Catmull tangent at middle point =
      // (1 - 0) / (1 - 0) = 1. Segment 0..0.5 evaluated at t=0.5 (x=0.25)
      // uses m0 = one-sided = (0.3-0)/(0.5-0) = 0.6, m1 = 1, Δx = 0.5.
      // H(0.5): h00=.5, h10=.125, h01=.5, h11=-.125
      //   = .5·0 + .125·0.6·0.5 + .5·0.3 + (-.125)·1·0.5
      //   = 0 + 0.0375 + 0.15 − 0.0625 = 0.125
      const op = freshOp({
        interp: 'catmull',
        points: [
          { x: 0,   y: 0,   tIn: 0, tOut: 0 },
          { x: 0.5, y: 0.3, tIn: 0, tOut: 0 },
          { x: 1,   y: 1,   tIn: 0, tOut: 0 },
        ],
      });
      const inBuf = new Float32Array(N);
      inBuf[0] = 0.25;
      const out = drive(op, inBuf);
      if (!approx(out[0], 0.125, 1e-5)) return { pass: false, why: `got ${out[0]} expected 0.125` };
      return { pass: true };
    },
  },

  // ---- bipolar sign preservation ------------------------------------
  {
    name: 'bipolar=true: f(-x) = -f(x) for identity curve',
    run() {
      const op = freshOp({ bipolar: true });
      const inBuf = new Float32Array(N);
      inBuf[0] = -0.3;
      inBuf[1] =  0.3;
      inBuf[2] = -0.9;
      inBuf[3] =  0.9;
      const out = drive(op, inBuf);
      if (!approx(out[0], -out[1], 1e-5)) return { pass: false, why: `±0.3: ${out[0]} vs ${out[1]}` };
      if (!approx(out[2], -out[3], 1e-5)) return { pass: false, why: `±0.9: ${out[2]} vs ${out[3]}` };
      return { pass: true };
    },
  },

  // ---- clamp behavior -----------------------------------------------
  {
    name: 'unipolar clamps input <0 → y(0); input >1 → y(1)',
    run() {
      const op = freshOp();
      const inBuf = new Float32Array(N);
      inBuf[0] = -0.5;
      inBuf[1] =  1.5;
      const out = drive(op, inBuf);
      if (!approx(out[0], 0, 1e-5)) return { pass: false, why: `x=-0.5 → ${out[0]} expected 0` };
      if (!approx(out[1], 1, 1e-5)) return { pass: false, why: `x=1.5 → ${out[1]} expected 1` };
      return { pass: true };
    },
  },

  // ---- unwired input defensively zeros -------------------------------
  {
    name: 'null input → all-zero output',
    run() {
      const op = freshOp();
      const out = new Float32Array(N);
      out.fill(999);
      op.process({ /* no in */ }, { out }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'curve', tests };
// Run via: node scripts/check_op_math.mjs (copies into ESM tmp dir).
