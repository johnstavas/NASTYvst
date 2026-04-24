// op_saturate.test.js — real-math tests for op_saturate.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_character.md §11 (Padé rational
// tanh). Tests cover: unity passthrough at drive=1 & trim=0, drive
// increases harmonic content, output bounded to ±1 at all drive values,
// trim is pure post-gain (no coloration), odd symmetry, monotonicity,
// hard-clip at |u/drive... wait: |drive·x| > 3, stateless reset,
// defensive null.

import { SaturateOp } from './op_saturate.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new SaturateOp(SR);
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

// Reference Padé with drive + trim (Canon §11) — expected values in tests.
function padeRef(x, driveAmt, trimDb) {
  let u = x * driveAmt;
  if (u >  3) u =  3;
  else if (u < -3) u = -3;
  const trimLin = Math.pow(10, trimDb / 20);
  return trimLin * u * (27 + u * u) / (27 + 9 * u * u);
}

const tests = [
  // ---- default transparency ------------------------------------------
  {
    name: 'default (drive=1, trim=0): small signal near-unity passthrough',
    run() {
      const op = freshOp();
      const { out } = drive(op, 0.1);
      const rel = Math.abs(out[0] - 0.1) / 0.1;
      if (rel > 0.005) return { pass: false, why: `rel err=${(rel * 100).toFixed(3)}%` };
      return { pass: true };
    },
  },
  {
    name: 'very small input at drive=1: slope ≈ 1 (unity gain through zero)',
    run() {
      const op = freshOp();
      const { out: a } = drive(op, 1e-4);
      const { out: b } = drive(op, 2e-4);
      const ratio = b[0] / a[0];
      if (!approx(ratio, 2, 1e-3)) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },

  // ---- Padé formula --------------------------------------------------
  {
    name: 'Padé formula matches reference at drive=1, various x',
    run() {
      const op = freshOp({ drive: 1, trim: 0 });
      for (const x of [-2, -1, -0.5, 0.1, 0.5, 1, 2]) {
        const { out } = drive(op, x);
        const expected = padeRef(x, 1, 0);
        if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `x=${x}: ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Padé formula matches reference at drive=4, trim=-6 dB',
    run() {
      const op = freshOp({ drive: 4, trim: -6 });
      for (const x of [-0.3, -0.1, 0.1, 0.3, 0.5]) {
        const { out } = drive(op, x);
        const expected = padeRef(x, 4, -6);
        if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `x=${x}: ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },

  // ---- asymptote / bounded -------------------------------------------
  {
    name: 'asymptote: large positive input → ≈ +trimLin',
    run() {
      const op = freshOp({ drive: 1, trim: 0 });
      const { out } = drive(op, 10);
      if (!approx(out[0], 1, 1e-4)) return { pass: false, why: `out=${out[0]} expected 1` };
      return { pass: true };
    },
  },
  {
    name: 'bounded: output ≤ trimLin for any drive/input combination',
    run() {
      for (const d of [1, 2, 4, 8, 16]) {
        const op = freshOp({ drive: d, trim: 0 });
        for (const x of [-100, -10, -1, 0, 1, 10, 100]) {
          const { out } = drive(op, x);
          if (Math.abs(out[0]) > 1 + 1e-5) return { pass: false, why: `d=${d} x=${x} out=${out[0]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'hard-clip at |drive·x| > 3 saturates to ±trimLin',
    run() {
      const op = freshOp({ drive: 2, trim: 0 });
      // At drive=2, u=3 when x=1.5; past that should pin.
      const { out: at  } = drive(op, 1.5);
      const { out: far } = drive(op, 100);
      if (!approx(at[0],  1, 1e-5)) return { pass: false, why: `at x=1.5: ${at[0]}` };
      if (!approx(far[0], 1, 1e-5)) return { pass: false, why: `far: ${far[0]}` };
      return { pass: true };
    },
  },

  // ---- odd symmetry / monotonicity ----------------------------------
  {
    name: 'odd-symmetric: f(-x) = -f(x) at any drive',
    run() {
      for (const d of [1, 2, 8]) {
        const op = freshOp({ drive: d, trim: 0 });
        for (const x of [0.1, 0.5, 1, 3]) {
          const { out: pos } = drive(op, x);
          const { out: neg } = drive(op, -x);
          if (!approx(pos[0], -neg[0], 1e-6)) return { pass: false, why: `d=${d} x=${x}: ${pos[0]} vs ${-neg[0]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'monotonic non-decreasing over input sweep at drive=4',
    run() {
      const op = freshOp({ drive: 4, trim: 0 });
      let prev = -Infinity;
      for (let x = -5; x <= 5; x += 0.01) {
        const { out } = drive(op, x);
        if (out[0] < prev - 1e-6) return { pass: false, why: `x=${x.toFixed(2)}: ${out[0]} < prev ${prev}` };
        prev = out[0];
      }
      return { pass: true };
    },
  },

  // ---- drive increases harmonic content ------------------------------
  {
    name: 'higher drive → more bending: same small input, drive=8 deviates more from linear than drive=1',
    run() {
      const x = 0.3;
      const op1 = freshOp({ drive: 1, trim: 0 });
      const op8 = freshOp({ drive: 8, trim: 0 });
      const { out: a } = drive(op1, x);
      const { out: b } = drive(op8, x);
      // At drive=1 x=0.3, padé(0.3) ≈ 0.2979 → ≈ 0.3 (nearly linear).
      // At drive=8 x=0.3, u=2.4, padé(2.4) ≈ 0.98 → significant bend.
      const linDev1 = Math.abs(a[0] - x);
      const linDev8 = Math.abs(b[0] - x);
      if (!(linDev8 > linDev1 * 10)) return { pass: false, why: `dev1=${linDev1} dev8=${linDev8}` };
      return { pass: true };
    },
  },

  // ---- trim is pure post-gain ---------------------------------------
  {
    name: 'trim is pure post-gain: output scales linearly in trimLin, shape unchanged',
    run() {
      const opA = freshOp({ drive: 4, trim: 0  });
      const opB = freshOp({ drive: 4, trim: 6  });  // +6 dB ≈ 1.9953
      const trimLin = Math.pow(10, 6 / 20);
      for (const x of [-0.5, -0.1, 0.2, 0.7]) {
        const { out: a } = drive(opA, x);
        const { out: b } = drive(opB, x);
        if (!approx(b[0], a[0] * trimLin, 1e-5)) return { pass: false, why: `x=${x}: ${b[0]} vs ${a[0] * trimLin}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'trim = -∞ dB (very negative) attenuates output toward zero',
    run() {
      const op = freshOp({ drive: 1, trim: -80 });
      const { out } = drive(op, 0.5);
      // 10^(-80/20) = 1e-4, so out should be ~0.5e-4.
      if (Math.abs(out[0]) > 1e-3) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- drive retune --------------------------------------------------
  {
    name: 'setParam(drive) takes effect on subsequent samples',
    run() {
      const op = freshOp({ drive: 1, trim: 0 });
      const { out: a } = drive(op, 0.3);
      op.setParam('drive', 8);
      const { out: b } = drive(op, 0.3);
      // b should be nearly pinned to 1 (u=2.4, padé≈0.98).
      if (!(b[0] > a[0] + 0.1)) return { pass: false, why: `a=${a[0]} b=${b[0]}` };
      return { pass: true };
    },
  },

  // ---- stateless / reset --------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ drive: 8, trim: 0 });
      drive(op, 10);  // saturate
      op.reset();
      const { out } = drive(op, 0.2);
      const ref = freshOp({ drive: 8, trim: 0 });
      const { out: refOut } = drive(ref, 0.2);
      if (!approx(out[0], refOut[0], 1e-9)) return { pass: false, why: `${out[0]} vs ${refOut[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ drive: 4, trim: 0 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'drive clamp: drive=0 falls to safe non-zero (no collapse)',
    run() {
      const op = freshOp({ drive: 0, trim: 0 });
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- low-amplitude sine preserves shape ---------------------------
  {
    name: 'low-amplitude sine at drive=1 preserves shape (THD negligible)',
    run() {
      const op = freshOp({ drive: 1, trim: 0 });
      const { inBuf, out } = drive(op, i => 0.01 * Math.sin(2 * Math.PI * 440 * i / SR), 2048);
      for (let i = 0; i < out.length; i++) {
        const rel = Math.abs(out[i] - inBuf[i]);
        if (rel > 1e-4) return { pass: false, why: `i=${i}: diff=${rel}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'saturate', tests };
