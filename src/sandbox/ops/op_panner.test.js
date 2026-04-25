// op_panner.test.js — panner law + hard-position tests.
// Primary: CMU ICM "Loudness Concepts & Panning Laws" — verbatim formulas.

import { PannerOp } from './op_panner.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new PannerOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, input, N, input2 = null) {
  const l = new Float32Array(N), r = new Float32Array(N);
  op.process({ in: input, in2: input2 }, { l, r }, N);
  return { l, r };
}

function ones(N, v = 1) { const a = new Float32Array(N); a.fill(v); return a; }

function peak(buf) { let m = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; } return m; }

const tests = [
  // ───────── CONSTANT-POWER LAW (default, law=1) ─────────
  {
    name: 'const-power center (pan=0): gL = gR = √½ ≈ 0.7071',
    run() {
      const op = freshOp({ pan: 0, law: 1 });
      const { l, r } = render(op, ones(64), 64);
      if (Math.abs(l[0] - Math.SQRT1_2) > 1e-6) return { pass: false, why: `L=${l[0]}` };
      if (Math.abs(r[0] - Math.SQRT1_2) > 1e-6) return { pass: false, why: `R=${r[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'const-power center: L² + R² = 1 (0 dB power)',
    run() {
      const op = freshOp({ pan: 0, law: 1 });
      const { l, r } = render(op, ones(8), 8);
      const pow = l[0]*l[0] + r[0]*r[0];
      if (Math.abs(pow - 1) > 1e-6) return { pass: false, why: `power=${pow}` };
      return { pass: true };
    },
  },
  {
    name: 'const-power constant-sum-of-squares across all pan values',
    run() {
      const op = freshOp({ law: 1 });
      for (let p = -1; p <= 1; p += 0.05) {
        op.setParam('pan', p);
        const { l, r } = render(op, ones(4), 4);
        const pow = l[0]*l[0] + r[0]*r[0];
        if (Math.abs(pow - 1) > 1e-5) return { pass: false, why: `pan=${p.toFixed(2)} pow=${pow}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'const-power pan=-1: gL = 1, gR = 0',
    run() {
      const op = freshOp({ pan: -1, law: 1 });
      const { l, r } = render(op, ones(4), 4);
      if (Math.abs(l[0] - 1) > 1e-6) return { pass: false, why: `L=${l[0]}` };
      if (Math.abs(r[0]) > 1e-6)     return { pass: false, why: `R=${r[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'const-power pan=+1: gL = 0, gR = 1',
    run() {
      const op = freshOp({ pan: 1, law: 1 });
      const { l, r } = render(op, ones(4), 4);
      if (Math.abs(l[0]) > 1e-6)     return { pass: false, why: `L=${l[0]}` };
      if (Math.abs(r[0] - 1) > 1e-6) return { pass: false, why: `R=${r[0]}` };
      return { pass: true };
    },
  },
  // ───────── LINEAR LAW (law=0) ─────────
  {
    name: 'linear center: gL = gR = 0.5 (−6 dB center dip)',
    run() {
      const op = freshOp({ pan: 0, law: 0 });
      const { l, r } = render(op, ones(4), 4);
      if (Math.abs(l[0] - 0.5) > 1e-6) return { pass: false, why: `L=${l[0]}` };
      if (Math.abs(r[0] - 0.5) > 1e-6) return { pass: false, why: `R=${r[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'linear hard-left: gL=1, gR=0',
    run() {
      const op = freshOp({ pan: -1, law: 0 });
      const { l, r } = render(op, ones(4), 4);
      if (Math.abs(l[0] - 1) > 1e-6) return { pass: false, why: `L=${l[0]}` };
      if (Math.abs(r[0]) > 1e-6)     return { pass: false, why: `R=${r[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'linear: gL + gR = 1 for all pan (constant amplitude sum)',
    run() {
      const op = freshOp({ law: 0 });
      for (let p = -1; p <= 1; p += 0.1) {
        op.setParam('pan', p);
        const { l, r } = render(op, ones(4), 4);
        if (Math.abs(l[0] + r[0] - 1) > 1e-6) return { pass: false, why: `pan=${p} sum=${l[0]+r[0]}` };
      }
      return { pass: true };
    },
  },
  // ───────── -4.5 dB COMPROMISE (law=2) ─────────
  {
    name: '-4.5 dB center: gL = gR ≈ 0.59',
    run() {
      const op = freshOp({ pan: 0, law: 2 });
      const { l, r } = render(op, ones(4), 4);
      // Expected: sqrt(0.5 · cos(π/4)) = sqrt(0.5 · √½) = sqrt(0.3536) ≈ 0.5946
      const expected = Math.sqrt(0.5 * Math.SQRT1_2);
      if (Math.abs(l[0] - expected) > 1e-6) return { pass: false, why: `L=${l[0]} want=${expected}` };
      if (Math.abs(r[0] - expected) > 1e-6) return { pass: false, why: `R=${r[0]}` };
      return { pass: true };
    },
  },
  {
    name: '-4.5 dB hard-edges: gains go to 0/1 bounds',
    run() {
      const op = freshOp({ pan: -1, law: 2 });
      const { l, r } = render(op, ones(4), 4);
      if (Math.abs(l[0] - 1) > 1e-6) return { pass: false, why: `L(-1)=${l[0]}` };
      if (Math.abs(r[0]) > 1e-6)     return { pass: false, why: `R(-1)=${r[0]}` };
      op.setParam('pan', 1);
      const { l: l2, r: r2 } = render(op, ones(4), 4);
      if (Math.abs(r2[0] - 1) > 1e-6) return { pass: false, why: `R(+1)=${r2[0]}` };
      if (Math.abs(l2[0]) > 1e-6)     return { pass: false, why: `L(+1)=${l2[0]}` };
      return { pass: true };
    },
  },
  // ───────── MECHANICAL / GUARD RAILS ─────────
  {
    name: 'stereo input sums pre-pan at ×0.5',
    run() {
      const op = freshOp({ pan: 0, law: 1 });
      const a = ones(4, 1), b = ones(4, 1);
      const { l } = render(op, a, 4, b);
      // (1+1)·0.5 · √½ = √½
      if (Math.abs(l[0] - Math.SQRT1_2) > 1e-6) return { pass: false, why: `L=${l[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: pan out-of-range stays finite',
    run() {
      const op = freshOp({});
      op.setParam('pan', 99); op.setParam('pan', -99); op.setParam('pan', NaN);
      op.setParam('law', 99); op.setParam('law', -99);
      const { l, r } = render(op, ones(128), 128);
      for (let i = 0; i < 128; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pan sweep stays bounded |L|,|R| ≤ 1',
    run() {
      const op = freshOp({ law: 1 });
      for (let p = -1; p <= 1; p += 0.05) {
        op.setParam('pan', p);
        const { l, r } = render(op, ones(4), 4);
        if (peak(l) > 1.0001 || peak(r) > 1.0001) return { pass: false, why: `pan=${p}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0 (stateless)',
    run() {
      const op = freshOp({});
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ pan: 0.3, law: 2 });
      const before = render(op, ones(64), 64);
      op.reset();
      const after = render(op, ones(64), 64);
      for (let i = 0; i < 64; i++) {
        if (before.l[i] !== after.l[i] || before.r[i] !== after.r[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence',
    run() {
      const op = freshOp({ pan: 0.5 });
      const l = new Float32Array(64), r = new Float32Array(64);
      try { op.process({}, { l, r }, 64); } catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < 64; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: ones(64) }, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops identical',
    run() {
      const a = render(freshOp({ pan: 0.3 }), ones(256), 256);
      const b = render(freshOp({ pan: 0.3 }), ones(256), 256);
      for (let i = 0; i < 256; i++) {
        if (a.l[i] !== b.l[i] || a.r[i] !== b.r[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'panner', tests };
