// op_scatteringJunction.test.js — real-math tests for the bare 2-port
// scattering junction (JOS PASP §7 one-multiply form).
// Run via: node scripts/check_op_math.mjs

import { ScatteringJunctionOp } from './op_scatteringJunction.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new ScatteringJunctionOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function run(op, fp, fm, n = N) {
  const oP = new Float32Array(n);
  const oM = new Float32Array(n);
  op.process({ fInPlus: fp, fInMinus: fm }, { fOutPlus: oP, fOutMinus: oM }, n);
  return { oP, oM };
}

const tests = [
  // ---- k=0 transparency ---------------------------------------------------
  {
    name: 'k=0: junction is transparent (outputs equal inputs)',
    run() {
      const fp = new Float32Array(N);
      const fm = new Float32Array(N);
      for (let i = 0; i < N; i++) { fp[i] = Math.sin(i * 0.1); fm[i] = Math.cos(i * 0.07); }
      const { oP, oM } = run(freshOp({ k: 0 }), fp, fm);
      for (let i = 0; i < N; i++) {
        if (!approx(oP[i], fp[i])) return { pass: false, why: `oP[${i}]=${oP[i]} vs ${fp[i]}` };
        if (!approx(oM[i], fm[i])) return { pass: false, why: `oM[${i}]=${oM[i]} vs ${fm[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- defining equation --------------------------------------------------
  {
    name: 'one-multiply equation: oP = fp + k(fp-fm), oM = fm + k(fp-fm)',
    run() {
      const k = 0.4;
      const fp = new Float32Array(N);
      const fm = new Float32Array(N);
      for (let i = 0; i < N; i++) { fp[i] = (i % 7) * 0.1; fm[i] = (i % 5) * 0.15 - 0.3; }
      const { oP, oM } = run(freshOp({ k }), fp, fm);
      for (let i = 0; i < N; i++) {
        const d = k * (fp[i] - fm[i]);
        if (!approx(oP[i], fp[i] + d, 1e-5)) return { pass: false, why: `oP[${i}]: ${oP[i]} vs ${fp[i]+d}` };
        if (!approx(oM[i], fm[i] + d, 1e-5)) return { pass: false, why: `oM[${i}]: ${oM[i]} vs ${fm[i]+d}` };
      }
      return { pass: true };
    },
  },

  // ---- k=+1 edge case (clamped to 0.99) ----------------------------------
  {
    name: 'k=+1 clamped to 0.99: fp=1, fm=0 → outputs bounded',
    run() {
      const fp = new Float32Array(N); fp.fill(1);
      const fm = new Float32Array(N);
      const { oP, oM } = run(freshOp({ k: 1 }), fp, fm);
      // d = 0.99*(1-0) = 0.99; oP = 1.99; oM = 0.99
      if (!approx(oP[0], 1.99, 1e-5)) return { pass: false, why: `oP=${oP[0]}` };
      if (!approx(oM[0], 0.99, 1e-5)) return { pass: false, why: `oM=${oM[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'k=-2 clamped to -0.99',
    run() {
      const fp = new Float32Array(N); fp.fill(1);
      const fm = new Float32Array(N);
      const { oP, oM } = run(freshOp({ k: -2 }), fp, fm);
      // d = -0.99 * 1 = -0.99; oP = 1-0.99=0.01; oM=-0.99
      if (!approx(oP[0], 0.01, 1e-5)) return { pass: false, why: `oP=${oP[0]}` };
      if (!approx(oM[0], -0.99, 1e-5)) return { pass: false, why: `oM=${oM[0]}` };
      return { pass: true };
    },
  },

  // ---- energy balance at matched condition (fp=fm → no scattering) -------
  {
    name: 'matched waves (fp=fm): Δ=0 regardless of k → outputs pass through',
    run() {
      const k = 0.75;
      const fp = new Float32Array(N);
      const fm = new Float32Array(N);
      for (let i = 0; i < N; i++) { fp[i] = Math.sin(i * 0.2); fm[i] = fp[i]; }
      const { oP, oM } = run(freshOp({ k }), fp, fm);
      for (let i = 0; i < N; i++) {
        if (!approx(oP[i], fp[i], 1e-6)) return { pass: false, why: `oP[${i}]=${oP[i]} vs ${fp[i]}` };
        if (!approx(oM[i], fm[i], 1e-6)) return { pass: false, why: `oM[${i}]=${oM[i]} vs ${fm[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- reflection behavior (fm=0: only right-going wave entering) --------
  {
    name: 'k>0, fm=0: right-going wave amplified by (1+k), left-going reflection = k·fp',
    run() {
      const k = 0.5;
      const fp = new Float32Array(N); fp.fill(1);
      const fm = new Float32Array(N);
      const { oP, oM } = run(freshOp({ k }), fp, fm);
      // d = k*(1-0) = 0.5;  oP = 1 + 0.5 = 1.5 = (1+k);  oM = 0 + 0.5 = k
      if (!approx(oP[0], 1.5, 1e-5)) return { pass: false, why: `oP=${oP[0]}` };
      if (!approx(oM[0], 0.5, 1e-5)) return { pass: false, why: `oM=${oM[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'k<0, fm=0: reflected wave inverted (oM negative for positive fp)',
    run() {
      const k = -0.5;
      const fp = new Float32Array(N); fp.fill(1);
      const fm = new Float32Array(N);
      const { oP, oM } = run(freshOp({ k }), fp, fm);
      // d = -0.5 * 1 = -0.5; oP = 1 - 0.5 = 0.5; oM = -0.5
      if (!approx(oP[0], 0.5, 1e-5)) return { pass: false, why: `oP=${oP[0]}` };
      if (!approx(oM[0], -0.5, 1e-5)) return { pass: false, why: `oM=${oM[0]}` };
      return { pass: true };
    },
  },

  // ---- latency + reset ----------------------------------------------------
  {
    name: 'getLatencySamples() === 0 (memoryless)',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
  {
    name: 'reset is a no-op (no state to clear)',
    run() {
      const op = freshOp({ k: 0.3 });
      const fp = new Float32Array(N); fp.fill(0.5);
      const fm = new Float32Array(N); fm.fill(0.2);
      const a = run(op, fp, fm);
      op.reset();
      const b = run(op, fp, fm);
      for (let i = 0; i < N; i++) {
        if (a.oP[i] !== b.oP[i]) return { pass: false, why: `oP differs at ${i}` };
        if (a.oM[i] !== b.oM[i]) return { pass: false, why: `oM differs at ${i}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------------
  {
    name: 'missing fInPlus: treated as 0',
    run() {
      const op = freshOp({ k: 0.5 });
      const fm = new Float32Array(N); fm.fill(1);
      const oP = new Float32Array(N);
      const oM = new Float32Array(N);
      op.process({ fInMinus: fm }, { fOutPlus: oP, fOutMinus: oM }, N);
      // d = 0.5*(0 - 1) = -0.5; oP = 0 - 0.5 = -0.5; oM = 1 - 0.5 = 0.5
      if (!approx(oP[0], -0.5, 1e-5)) return { pass: false, why: `oP=${oP[0]}` };
      if (!approx(oM[0],  0.5, 1e-5)) return { pass: false, why: `oM=${oM[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing both outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'non-finite k ignored (falls back to 0)',
    run() {
      const op = freshOp({ k: 0.5 });
      op.setParam('k', NaN);
      const fp = new Float32Array(N); fp.fill(1);
      const fm = new Float32Array(N);
      const { oP, oM } = run(op, fp, fm);
      // NaN → 0, so transparent: oP=1, oM=0
      if (!approx(oP[0], 1, 1e-6)) return { pass: false, why: `oP=${oP[0]}` };
      if (!approx(oM[0], 0, 1e-6)) return { pass: false, why: `oM=${oM[0]}` };
      return { pass: true };
    },
  },

  // ---- deterministic ------------------------------------------------------
  {
    name: 'two fresh instances, same params → identical output',
    run() {
      const fp = new Float32Array(N);
      const fm = new Float32Array(N);
      for (let i = 0; i < N; i++) { fp[i] = Math.sin(i); fm[i] = Math.cos(i); }
      const a = run(freshOp({ k: 0.3 }), fp, fm);
      const b = run(freshOp({ k: 0.3 }), fp, fm);
      for (let i = 0; i < N; i++) {
        if (a.oP[i] !== b.oP[i]) return { pass: false, why: `oP diff @${i}` };
        if (a.oM[i] !== b.oM[i]) return { pass: false, why: `oM diff @${i}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'scatteringJunction', tests };
