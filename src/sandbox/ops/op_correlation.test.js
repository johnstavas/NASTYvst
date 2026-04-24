// op_correlation.test.js — real-math tests for op_correlation.
// Run via: node scripts/check_op_math.mjs
//
// Pearson correlation ρ = E[LR]/√(E[L²]·E[R²]) with one-pole-smoothed
// expectations. Tests cover:
//   - Perfect correlation (L = R) → ρ → +1
//   - Perfect anti-correlation (L = -R) → ρ → -1
//   - Uncorrelated (independent noise) → ρ → ~0
//   - Silence → ρ = 0 (not NaN)
//   - Scale invariance: ρ(L, 10R) = ρ(L, R)
//   - Missing channel → ρ = 0 (safe)
//   - Output bounded to [-1, +1]
//   - Window time clamp
//   - One-pole convergence time
//   - reset / denormal flush / determinism

import { CorrelationOp } from './op_correlation.worklet.js';

const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

function freshOp(sr = 48000, timeMs = 300) {
  const op = new CorrelationOp(sr);
  op.setParam('timeMs', timeMs);
  op.reset();
  return op;
}

function renderLR(op, fillL, fillR, n) {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = typeof fillL === 'function' ? fillL(i) : fillL;
    R[i] = typeof fillR === 'function' ? fillR(i) : fillR;
  }
  const out = new Float32Array(n);
  op.process({ l: L, r: R }, { corr: out }, n);
  return { L, R, out };
}

// Deterministic pseudo-random (so tests are reproducible).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 196314165) + 907633515) >>> 0;
    return ((s >>> 8) / 0x1000000) * 2 - 1; // [-1, 1)
  };
}

const tests = [
  // ---- extremes of ρ ------------------------------------------------
  {
    name: 'L = R → ρ → +1 (perfect correlation)',
    run() {
      const op = freshOp(48000, 50); // faster window to converge in test
      const sr = 48000;
      const { out } = renderLR(op,
        (i) => Math.sin(2 * Math.PI * 500 * i / sr),
        (i) => Math.sin(2 * Math.PI * 500 * i / sr),
        sr); // 1 s
      const final = out[out.length - 1];
      if (!approx(final, 1.0, 0.01)) return { pass: false, why: `ρ=${final}` };
      return { pass: true };
    },
  },
  {
    name: 'L = -R → ρ → -1 (phase inverted)',
    run() {
      const op = freshOp(48000, 50);
      const sr = 48000;
      const { out } = renderLR(op,
        (i) =>  Math.sin(2 * Math.PI * 500 * i / sr),
        (i) => -Math.sin(2 * Math.PI * 500 * i / sr),
        sr);
      const final = out[out.length - 1];
      if (!approx(final, -1.0, 0.01)) return { pass: false, why: `ρ=${final}` };
      return { pass: true };
    },
  },
  {
    name: 'independent noise → ρ ≈ 0 (within ±0.1 at 500ms window)',
    run() {
      const op = freshOp(48000, 500);
      const rL = lcg(12345);
      const rR = lcg(67890);
      const sr = 48000;
      const N = sr * 3; // 3 s
      const L = new Float32Array(N);
      const R = new Float32Array(N);
      for (let i = 0; i < N; i++) { L[i] = rL(); R[i] = rR(); }
      const out = new Float32Array(N);
      op.process({ l: L, r: R }, { corr: out }, N);
      // Average last 1 s
      let sum = 0;
      for (let i = N - sr; i < N; i++) sum += out[i];
      const avg = sum / sr;
      if (Math.abs(avg) > 0.1) return { pass: false, why: `avg=${avg}` };
      return { pass: true };
    },
  },

  // ---- silence / zero -----------------------------------------------
  {
    name: 'silence on both channels → ρ = 0 (not NaN)',
    run() {
      const op = freshOp(48000, 100);
      const { out } = renderLR(op, 0, 0, 48000);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at ${i}` };
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'silence on L only → ρ = 0 (not NaN)',
    run() {
      const op = freshOp(48000, 100);
      const sr = 48000;
      const { out } = renderLR(op,
        0,
        (i) => Math.sin(2 * Math.PI * 500 * i / sr),
        sr);
      // Wait for convergence window past
      for (let i = sr - 100; i < sr; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at ${i}` };
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- scale invariance ---------------------------------------------
  {
    name: 'scale invariance: ρ(L, 10R) = ρ(L, R)',
    run() {
      const opA = freshOp(48000, 50);
      const opB = freshOp(48000, 50);
      const sr = 48000;
      const { out: oA } = renderLR(opA,
        (i) => Math.sin(2 * Math.PI * 500 * i / sr),
        (i) => Math.sin(2 * Math.PI * 500 * i / sr),
        sr);
      const { out: oB } = renderLR(opB,
        (i) => Math.sin(2 * Math.PI * 500 * i / sr),
        (i) => 10 * Math.sin(2 * Math.PI * 500 * i / sr),
        sr);
      const fA = oA[oA.length - 1], fB = oB[oB.length - 1];
      if (!approx(fA, fB, 0.001)) return { pass: false, why: `${fA} vs ${fB}` };
      return { pass: true };
    },
  },

  // ---- bounds -------------------------------------------------------
  {
    name: 'output is bounded to [-1, +1] across adversarial inputs',
    run() {
      const op = freshOp(48000, 20);
      const rL = lcg(111);
      const rR = lcg(222);
      const sr = 48000;
      const N = sr;
      const L = new Float32Array(N);
      const R = new Float32Array(N);
      // Mix of huge + tiny + sign-alternating
      for (let i = 0; i < N; i++) {
        L[i] = (i % 100 === 0 ? 1e-10 : 100) * rL();
        R[i] = (i % 77  === 0 ? 1e-10 : 100) * rR();
      }
      const out = new Float32Array(N);
      op.process({ l: L, r: R }, { corr: out }, N);
      for (let i = 0; i < N; i++) {
        if (out[i] > 1 || out[i] < -1) return { pass: false, why: `out[${i}]=${out[i]}` };
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite ${i}` };
      }
      return { pass: true };
    },
  },

  // ---- window time --------------------------------------------------
  {
    name: 'shorter window reacts faster to correlation transition',
    run() {
      // Note: with L=R from zero state, ρ=1 from sample 1 regardless of τ
      // (numerator and denominator scale together). To expose τ-dependence
      // we pre-charge with uncorrelated noise (ρ→0), then flip to L=R
      // and measure how fast ρ climbs back to 1.
      const opFast = freshOp(48000, 20);
      const opSlow = freshOp(48000, 2000);
      const sr = 48000;
      const PRE = Math.floor(sr * 0.5); // 500 ms pre-charge
      const RUN = Math.floor(sr * 0.05); // 50 ms measurement window
      const rL = lcg(9999), rR = lcg(11111);
      // Pre-charge with uncorrelated noise
      const Lp = new Float32Array(PRE);
      const Rp = new Float32Array(PRE);
      for (let i = 0; i < PRE; i++) { Lp[i] = rL(); Rp[i] = rR(); }
      const discard = new Float32Array(PRE);
      opFast.process({ l: Lp, r: Rp }, { corr: discard }, PRE);
      opSlow.process({ l: Lp, r: Rp }, { corr: discard }, PRE);
      // Now flip to fully correlated
      const L = new Float32Array(RUN);
      const R = new Float32Array(RUN);
      for (let i = 0; i < RUN; i++) {
        L[i] = Math.sin(2 * Math.PI * 500 * i / sr);
        R[i] = Math.sin(2 * Math.PI * 500 * i / sr);
      }
      const oF = new Float32Array(RUN);
      const oS = new Float32Array(RUN);
      opFast.process({ l: L, r: R }, { corr: oF }, RUN);
      opSlow.process({ l: L, r: R }, { corr: oS }, RUN);
      // At 50 ms the 20-ms-τ meter should be past half-rise (>0.5)
      // while the 2000-ms-τ meter is still near its initial uncorrelated value.
      if (!(oF[RUN - 1] > oS[RUN - 1] + 0.2)) {
        return { pass: false, why: `fast=${oF[RUN-1]} slow=${oS[RUN-1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'timeMs clamped: 0 → min 1, 99999 → max 10000',
    run() {
      const op = freshOp(48000, 300);
      op.setParam('timeMs', 0);
      if (op._tauS !== 0.001) return { pass: false, why: `min τ=${op._tauS}` };
      op.setParam('timeMs', 99999);
      if (op._tauS !== 10) return { pass: false, why: `max τ=${op._tauS}` };
      return { pass: true };
    },
  },

  // ---- missing I/O --------------------------------------------------
  {
    name: 'missing L → ρ = 0',
    run() {
      const op = freshOp(48000, 100);
      const N = 48000;
      const R = new Float32Array(N);
      for (let i = 0; i < N; i++) R[i] = Math.sin(i * 0.01);
      const out = new Float32Array(N);
      op.process({ r: R }, { corr: out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp(48000, 100);
      const L = new Float32Array(64).fill(0.5);
      const R = new Float32Array(64).fill(0.5);
      op.process({ l: L, r: R }, {}, 64);
      return { pass: true };
    },
  },

  // ---- infrastructure -----------------------------------------------
  {
    name: 'reset() zeroes all three running expectations',
    run() {
      const op = freshOp(48000, 100);
      renderLR(op, 0.5, 0.5, 24000);
      op.reset();
      if (op._eLL !== 0 || op._eRR !== 0 || op._eLR !== 0) {
        return { pass: false, why: `eLL=${op._eLL} eRR=${op._eRR} eLR=${op._eLR}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'denormal flush on expectations',
    run() {
      const op = freshOp(48000, 100);
      // Charge with tiny signal, then silence
      renderLR(op, 1e-20, 1e-20, 10000);
      renderLR(op, 0, 0, 1000);
      if (op._eLL !== 0 || op._eRR !== 0 || op._eLR !== 0) {
        return { pass: false, why: `eLL=${op._eLL} eRR=${op._eRR} eLR=${op._eLR}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const opA = freshOp(48000, 100);
      const opB = freshOp(48000, 100);
      const N = 4096;
      const L = new Float32Array(N), R = new Float32Array(N);
      for (let i = 0; i < N; i++) { L[i] = Math.sin(i * 0.01); R[i] = Math.sin(i * 0.013); }
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      opA.process({ l: L, r: R }, { corr: oA }, N);
      opB.process({ l: L, r: R }, { corr: oB }, N);
      for (let i = 0; i < N; i++) {
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} ${oA[i]}≠${oB[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'correlation', tests };
