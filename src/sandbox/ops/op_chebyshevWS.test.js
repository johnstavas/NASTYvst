// op_chebyshevWS.test.js — real-math tests for op_chebyshevWS.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against Canon:character §4 (musicdsp #230) +
// Wikipedia Chebyshev polynomials. Tests cover:
// - Default identity: g1=1, others=0 → output = input (clamped to ±1)
// - Each T_k matches its closed form for known x
// - Recurrence T_{k+1}=2x·T_k − T_{k−1} satisfied
// - Boundary values: T_k(1) = 1, T_k(-1) = (-1)^k
// - Unit-amplitude cosine input through T_k produces k-th harmonic
// - level scales output linearly
// - Input clamping to [-1, 1]
// - Stateless reset, defensive nulls

import { ChebyshevWSOp } from './op_chebyshevWS.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new ChebyshevWSOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inFill, n = N) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

// Closed-form T_k.
const T1 = (x) => x;
const T2 = (x) => 2 * x * x - 1;
const T3 = (x) => 4 * x * x * x - 3 * x;
const T4 = (x) => 8 * x ** 4 - 8 * x * x + 1;
const T5 = (x) => 16 * x ** 5 - 20 * x ** 3 + 5 * x;

const tests = [
  // ---- defaults / identity ---------------------------------------------
  {
    name: 'defaults: g1=1, others=0 → output = input (clamped)',
    run() {
      const op = freshOp({});
      for (const x of [-0.9, -0.5, 0, 0.5, 0.9]) {
        const { out } = drive(op, x);
        if (!approx(out[0], x, 1e-6)) return { pass: false, why: `x=${x}: ${out[0]}` };
      }
      return { pass: true };
    },
  },

  // ---- per-T_k closed-form match ---------------------------------------
  {
    name: 'g1=1: y = T_1(x) = x',
    run() {
      const op = freshOp({ g1: 1, g2: 0, g3: 0, g4: 0, g5: 0 });
      for (const x of [-1, -0.5, 0.3, 1]) {
        const { out } = drive(op, x);
        if (!approx(out[0], T1(x), 1e-6)) return { pass: false, why: `x=${x}: ${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'g2=1 only: y = T_2(x) = 2x²−1',
    run() {
      const op = freshOp({ g1: 0, g2: 1, g3: 0, g4: 0, g5: 0 });
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const { out } = drive(op, x);
        if (!approx(out[0], T2(x), 1e-6)) return { pass: false, why: `x=${x}: ${out[0]} vs ${T2(x)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'g3=1 only: y = T_3(x) = 4x³−3x',
    run() {
      const op = freshOp({ g1: 0, g2: 0, g3: 1, g4: 0, g5: 0 });
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const { out } = drive(op, x);
        if (!approx(out[0], T3(x), 1e-6)) return { pass: false, why: `x=${x}: ${out[0]} vs ${T3(x)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'g4=1 only: y = T_4(x) = 8x⁴−8x²+1',
    run() {
      const op = freshOp({ g1: 0, g2: 0, g3: 0, g4: 1, g5: 0 });
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const { out } = drive(op, x);
        if (!approx(out[0], T4(x), 1e-6)) return { pass: false, why: `x=${x}: ${out[0]} vs ${T4(x)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'g5=1 only: y = T_5(x) = 16x⁵−20x³+5x',
    run() {
      const op = freshOp({ g1: 0, g2: 0, g3: 0, g4: 0, g5: 1 });
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const { out } = drive(op, x);
        if (!approx(out[0], T5(x), 1e-6)) return { pass: false, why: `x=${x}: ${out[0]} vs ${T5(x)}` };
      }
      return { pass: true };
    },
  },

  // ---- recurrence relation ---------------------------------------------
  {
    name: 'recurrence T_{k+1} = 2x·T_k − T_{k−1} holds',
    run() {
      // Verify by using the op to evaluate each T_k separately, then
      // check 2x·T_2(x) − T_1(x) = T_3(x), etc.
      for (const x of [0.13, -0.42, 0.71, -0.91]) {
        const opT2 = freshOp({ g1: 0, g2: 1, g3: 0, g4: 0, g5: 0 });
        const opT3 = freshOp({ g1: 0, g2: 0, g3: 1, g4: 0, g5: 0 });
        const opT4 = freshOp({ g1: 0, g2: 0, g3: 0, g4: 1, g5: 0 });
        const opT5 = freshOp({ g1: 0, g2: 0, g3: 0, g4: 0, g5: 1 });
        const { out: t2 } = drive(opT2, x);
        const { out: t3 } = drive(opT3, x);
        const { out: t4 } = drive(opT4, x);
        const { out: t5 } = drive(opT5, x);
        // T_3 = 2x·T_2 − T_1 (T_1 = x)
        if (!approx(t3[0], 2 * x * t2[0] - x, 1e-5)) return { pass: false, why: `T_3 recurrence x=${x}` };
        // T_4 = 2x·T_3 − T_2
        if (!approx(t4[0], 2 * x * t3[0] - t2[0], 1e-5)) return { pass: false, why: `T_4 recurrence x=${x}` };
        // T_5 = 2x·T_4 − T_3
        if (!approx(t5[0], 2 * x * t4[0] - t3[0], 1e-5)) return { pass: false, why: `T_5 recurrence x=${x}` };
      }
      return { pass: true };
    },
  },

  // ---- boundary values --------------------------------------------------
  {
    name: 'T_k(1) = 1 for all k',
    run() {
      for (const k of [1, 2, 3, 4, 5]) {
        const params = { g1: 0, g2: 0, g3: 0, g4: 0, g5: 0 };
        params['g' + k] = 1;
        const op = freshOp(params);
        const { out } = drive(op, 1);
        if (!approx(out[0], 1, 1e-6)) return { pass: false, why: `T_${k}(1) = ${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'T_k(-1) = (-1)^k',
    run() {
      for (const k of [1, 2, 3, 4, 5]) {
        const params = { g1: 0, g2: 0, g3: 0, g4: 0, g5: 0 };
        params['g' + k] = 1;
        const op = freshOp(params);
        const { out } = drive(op, -1);
        const expected = (k % 2 === 0) ? 1 : -1;
        if (!approx(out[0], expected, 1e-6)) return { pass: false, why: `T_${k}(-1) = ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },

  // ---- harmonic isolation property -------------------------------------
  {
    name: 'cos(ωt) through T_2 produces 2× harmonic (cos(2ωt))',
    run() {
      // T_2(cos θ) = cos(2θ). Drive cos(ω) through T_2 and verify the
      // dominant frequency in output is 2ω. Use FFT-free method: count
      // sign changes (zero crossings) — twice as many at 2× frequency.
      const op = freshOp({ g1: 0, g2: 1, g3: 0, g4: 0, g5: 0 });
      // T_2 has DC offset (T_2(cos θ) = cos 2θ but pre-DC: cos θ → 2cos²θ − 1).
      // Output = cos(2θ), which has zero mean and oscillates at 2ω.
      const NWIN = 4096;
      const f = SR / 256;  // 187.5 Hz
      const { out } = drive(op, i => Math.cos(2 * Math.PI * f * i / SR), NWIN);
      // Count zero crossings.
      let zc = 0;
      for (let i = 1; i < NWIN; i++) {
        if ((out[i-1] >= 0) !== (out[i] >= 0)) zc++;
      }
      // 16 cycles of input → 32 cycles of 2nd harmonic → ~64 zero crossings.
      if (zc < 60 || zc > 68) return { pass: false, why: `zc=${zc} (expected ~64 for 2× harmonic over 16 input cycles)` };
      return { pass: true };
    },
  },

  // ---- linear-combination property -------------------------------------
  {
    name: 'output = Σ g_k · T_k(x)',
    run() {
      const op = freshOp({ g1: 0.5, g2: 0.3, g3: -0.2, g4: 0.1, g5: -0.05 });
      for (const x of [-0.7, -0.3, 0.1, 0.5, 0.9]) {
        const { out } = drive(op, x);
        const expected = 0.5 * T1(x) + 0.3 * T2(x) - 0.2 * T3(x) + 0.1 * T4(x) - 0.05 * T5(x);
        if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `x=${x}: ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },

  // ---- level / clamp ----------------------------------------------------
  {
    name: 'level scales output linearly',
    run() {
      const opA = freshOp({ g1: 1, level: 1 });
      const opB = freshOp({ g1: 1, level: 2 });
      for (const x of [-0.5, 0, 0.3]) {
        const { out: a } = drive(opA, x);
        const { out: b } = drive(opB, x);
        if (!approx(b[0], a[0] * 2, 1e-6)) return { pass: false, why: `x=${x}: ${b[0]} vs ${a[0]*2}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'input |x|>1 clamped before T_k evaluation',
    run() {
      // At x=2, would naively give T_2(2) = 7. Clamp to x=1 → T_2(1) = 1.
      const op = freshOp({ g1: 0, g2: 1 });
      const { out } = drive(op, 2);
      if (!approx(out[0], 1, 1e-6)) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- stateless / reset ------------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ g1: 0.5, g2: 0.3, g3: 0.2 });
      drive(op, 0.7);
      op.reset();
      const { out } = drive(op, 0.3);
      const ref = freshOp({ g1: 0.5, g2: 0.3, g3: 0.2 });
      const { out: refOut } = drive(ref, 0.3);
      if (!approx(out[0], refOut[0], 1e-9)) return { pass: false, why: `${out[0]} vs ${refOut[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ g1: 1, g2: 1, g3: 1 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param NaN/inf clamp: stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['g1', 'g2', 'g3', 'g4', 'g5', 'level']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'chebyshevWS', tests };
