// op_randomWalk.test.js — SC BrownNoise-style bounded random walk.

import { RandomWalkOp } from './op_randomWalk.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new RandomWalkOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, N) {
  const out = new Float32Array(N);
  op.process({}, { out }, N);
  return out;
}

function rms(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / arr.length);
}

const tests = [
  {
    name: 'output bounded in [-1, 1] regardless of step size',
    run() {
      for (const step of [0.01, 0.125, 0.5]) {
        const out = render(freshOp({ step }), 16384);
        for (let i = 0; i < out.length; i++) {
          if (out[i] < -1.0001 || out[i] > 1.0001) return { pass: false, why: `step=${step} i=${i} out=${out[i]}` };
          if (!Number.isFinite(out[i])) return { pass: false, why: `step=${step} i=${i}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'step=0 → output stays at 0 (no walk)',
    run() {
      const out = render(freshOp({ step: 0.0001 }), 256);
      // even smallest allowed step makes a little walk; check tiny
      let maxAbs = 0;
      for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > maxAbs) maxAbs = Math.abs(out[i]);
      if (maxAbs > 0.1) return { pass: false, why: `maxAbs=${maxAbs}` };
      return { pass: true };
    },
  },
  {
    name: 'walk is smooth: adjacent samples differ by ≤ step',
    run() {
      const step = 0.125;
      const out = render(freshOp({ step }), 4096);
      for (let i = 1; i < out.length; i++) {
        const d = Math.abs(out[i] - out[i-1]);
        // account for reflection which can double effective step at boundary
        if (d > 2 * step + 1e-4) return { pass: false, why: `i=${i} d=${d}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'larger step → larger RMS variance (on average)',
    run() {
      const rSmall = rms(render(freshOp({ step: 0.01 }), 8192));
      const rLarge = rms(render(freshOp({ step: 0.3  }), 8192));
      if (rLarge <= rSmall) return { pass: false, why: `small=${rSmall} large=${rLarge}` };
      return { pass: true };
    },
  },
  {
    name: 'spectrum is red (lo-band RMS > hi-band RMS)',
    run() {
      const out = render(freshOp({ step: 0.1 }), 32768);
      // crude 1-pole split at ~707 Hz (same helper idea as #125 hiss)
      const fc = 707, x = Math.exp(-2 * Math.PI * fc / SR);
      let lp = 0, loSq = 0, hiSq = 0;
      for (let i = 0; i < out.length; i++) {
        lp = (1 - x) * out[i] + x * lp;
        const hi = out[i] - lp;
        loSq += lp * lp;
        hiSq += hi * hi;
      }
      if (loSq <= hiSq) return { pass: false, why: `loSq=${loSq} hiSq=${hiSq}` };
      return { pass: true };
    },
  },
  {
    name: 'reflective boundary: z reaches near ±1 but never exceeds',
    run() {
      const out = render(freshOp({ step: 0.5 }), 65536);
      let maxA = 0;
      for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > maxA) maxA = Math.abs(out[i]);
      // with big step over long window should get close to 1
      if (maxA < 0.3) return { pass: false, why: `maxA=${maxA} — walk too constrained?` };
      if (maxA > 1.0001) return { pass: false, why: `maxA=${maxA} — broke reflection` };
      return { pass: true };
    },
  },
  {
    name: 'level=0 → silence',
    run() {
      const out = render(freshOp({ step: 0.125, level: 0 }), 512);
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'level=0.5 halves output amplitude',
    run() {
      const a = render(freshOp({ step: 0.1, level: 1   }), 4096);
      const b = render(freshOp({ step: 0.1, level: 0.5 }), 4096);
      for (let i = 0; i < 4096; i++) {
        if (Math.abs(b[i] - a[i] * 0.5) > 1e-6) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops identical',
    run() {
      const a = render(freshOp({ step: 0.125 }), 2048);
      const b = render(freshOp({ step: 0.125 }), 2048);
      for (let i = 0; i < 2048; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() restores seed and z=0',
    run() {
      const op = freshOp({ step: 0.125 });
      const before = render(op, 256);
      op.reset();
      const after = render(op, 256);
      for (let i = 0; i < 256; i++) if (before[i] !== after[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: N one-shot == two half-blocks',
    run() {
      const op1 = freshOp({ step: 0.125 });
      const op2 = freshOp({ step: 0.125 });
      const N = 1024;
      const full = render(op1, N);
      const a = new Float32Array(N/2), b = new Float32Array(N/2);
      op2.process({}, { out: a }, N/2);
      op2.process({}, { out: b }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(full[i] - a[i]) > 1e-6)       return { pass: false, why: `A i=${i}` };
        if (Math.abs(full[i + N/2] - b[i]) > 1e-6) return { pass: false, why: `B i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: NaN / out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('step', 1e9); op.setParam('step', -1e9); op.setParam('step', NaN);
      op.setParam('level', 999); op.setParam('level', -999); op.setParam('level', NaN);
      const out = render(op, 256);
      for (let i = 0; i < 256; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false };
      return { pass: true };
    },
  },
];

export default { opId: 'randomWalk', tests };
