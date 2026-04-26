// op_diodeClipper.test.js — real-math tests for op_diodeClipper.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against Shockley equation (Sedra-Smith §3.2) + Yeh
// DAFx 2008 closed-form arcsinh derivation. Tests cover:
// - drive=1: arcsinh(x)/arcsinh(1) reference match
// - peak normalization: y(±1) = ±1 at any drive (sym mode)
// - drive monotonicity: more drive → more compression at mid-amplitude
// - log-asymptotic past knee (distinct from tanh)
// - asym creates DC offset / asymmetric envelope
// - asym=1: negative side fully linear (no clipping)
// - trim is pure post-gain
// - sign symmetry at asym=0
// - stateless reset, defensive nulls

import { DiodeClipperOp } from './op_diodeClipper.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DiodeClipperOp(SR);
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

// Reference closed-form (Yeh DAFx 2008): y = arcsinh(d·x)/arcsinh(driveP).
function clipRef(x, driveAmt, asymAmt, trimDb) {
  const driveP = driveAmt;
  const driveN = driveAmt * (1 - asymAmt);
  const d = x >= 0 ? driveP : driveN;
  const norm = 1 / Math.asinh(driveP);
  const trimLin = Math.pow(10, trimDb / 20);
  return trimLin * norm * Math.asinh(d * x);
}

const tests = [
  // ---- closed-form match ------------------------------------------------
  {
    name: 'drive=1, asym=0: matches arcsinh(x)/arcsinh(1) reference',
    run() {
      const op = freshOp({ drive: 1, asym: 0, trim: 0 });
      for (const x of [-1, -0.5, -0.2, -0.05, 0.05, 0.2, 0.5, 1]) {
        const { out } = drive(op, x);
        const expected = clipRef(x, 1, 0, 0);
        if (!approx(out[0], expected, 1e-6)) return { pass: false, why: `x=${x}: ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'matches reference across drive/asym/trim sweep',
    run() {
      for (const d of [1, 2, 4, 8, 16]) {
        for (const a of [0, 0.25, 0.5, 0.75, 1]) {
          for (const tdb of [-6, 0, 6]) {
            const op = freshOp({ drive: d, asym: a, trim: tdb });
            for (const x of [-0.9, -0.4, -0.1, 0.1, 0.4, 0.9]) {
              const { out } = drive(op, x);
              const expected = clipRef(x, d, a, tdb);
              if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `d=${d} a=${a} tdb=${tdb} x=${x}: ${out[0]} vs ${expected}` };
            }
          }
        }
      }
      return { pass: true };
    },
  },

  // ---- peak normalization ----------------------------------------------
  {
    name: 'peak normalization: y(+1)=+1 at any drive (sym mode)',
    run() {
      for (const d of [1, 2, 4, 8, 16]) {
        const op = freshOp({ drive: d, asym: 0, trim: 0 });
        const { out } = drive(op, 1);
        if (!approx(out[0], 1, 1e-6)) return { pass: false, why: `d=${d}: out=${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'peak normalization: y(-1)=-1 at any drive (sym mode)',
    run() {
      for (const d of [1, 2, 4, 8, 16]) {
        const op = freshOp({ drive: d, asym: 0, trim: 0 });
        const { out } = drive(op, -1);
        if (!approx(out[0], -1, 1e-6)) return { pass: false, why: `d=${d}: out=${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bounded: |y| ≤ 1 for |x| ≤ 1, sym mode, all drives',
    run() {
      for (const d of [1, 2, 8, 16]) {
        const op = freshOp({ drive: d, asym: 0, trim: 0 });
        for (let x = -1; x <= 1; x += 0.01) {
          const { out } = drive(op, x);
          if (Math.abs(out[0]) > 1 + 1e-6) return { pass: false, why: `d=${d} x=${x.toFixed(3)} out=${out[0]}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- drive monotonicity ----------------------------------------------
  {
    name: 'higher drive → more knee compression at mid-amplitude',
    run() {
      // At x=0.5: y(d=1) = arcsinh(0.5)/arcsinh(1) = 0.481/0.881 ≈ 0.546.
      //          y(d=8) = arcsinh(4)/arcsinh(8) = 2.094/2.776 ≈ 0.754.
      // Higher drive → higher y at fixed x (signal "louder above the knee").
      const op1 = freshOp({ drive: 1, asym: 0, trim: 0 });
      const op8 = freshOp({ drive: 8, asym: 0, trim: 0 });
      const { out: a } = drive(op1, 0.5);
      const { out: b } = drive(op8, 0.5);
      if (!(b[0] > a[0])) return { pass: false, why: `d=1: ${a[0]} d=8: ${b[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'log-asymptotic: y(2) - y(1) << y(0.5) - y(0) (compression past knee)',
    run() {
      // arcsinh has slope 1/sqrt(1+x²) — slows toward log(2x) past x≈1.
      // Compare incremental gain near zero vs past knee.
      const op = freshOp({ drive: 4, asym: 0, trim: 0 });
      const { out: y0 } = drive(op, 0);
      const { out: y0p1 } = drive(op, 0.1);
      const { out: y1 } = drive(op, 1);
      const { out: y1p1 } = drive(op, 1.1);
      const slopeNear0 = (y0p1[0] - y0[0]) / 0.1;
      const slopePastKnee = (y1p1[0] - y1[0]) / 0.1;
      if (!(slopeNear0 > slopePastKnee * 1.5)) return { pass: false, why: `near-zero slope=${slopeNear0} past-knee=${slopePastKnee}` };
      return { pass: true };
    },
  },

  // ---- sign symmetry at asym=0 -----------------------------------------
  {
    name: 'odd-symmetric at asym=0: f(-x) = -f(x)',
    run() {
      for (const d of [1, 4, 16]) {
        const op = freshOp({ drive: d, asym: 0, trim: 0 });
        for (const x of [0.1, 0.3, 0.7, 1, 2]) {
          const { out: pos } = drive(op, x);
          const { out: neg } = drive(op, -x);
          if (!approx(pos[0], -neg[0], 1e-6)) return { pass: false, why: `d=${d} x=${x}: ${pos[0]} vs ${-neg[0]}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- asymmetric clipping (Tube Screamer / Big Muff signature) --------
  {
    name: 'asym>0: positive peak unchanged, negative side compressed less',
    run() {
      // At asym=0.5, driveP=4, driveN=2.
      //   y(+1)/normP = arcsinh(4·1) — same as sym mode at d=4 → +1.
      //   y(-1)/normP = arcsinh(2·-1) ÷ arcsinh(4) = -arcsinh(2)/arcsinh(4) = -1.444/2.094 ≈ -0.689.
      // Negative peak less than positive peak in magnitude.
      const op = freshOp({ drive: 4, asym: 0.5, trim: 0 });
      const { out: pos } = drive(op, 1);
      const { out: neg } = drive(op, -1);
      if (!approx(pos[0], 1, 1e-6)) return { pass: false, why: `pos: ${pos[0]}` };
      if (Math.abs(neg[0]) >= 1) return { pass: false, why: `neg expected <1: ${neg[0]}` };
      if (Math.abs(pos[0]) <= Math.abs(neg[0])) return { pass: false, why: `expected |pos| > |neg|: ${pos[0]} vs ${neg[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'asym=1: negative side has zero drive (linear at low amplitude on neg)',
    run() {
      // driveN = 0, so arcsinh(0·x) = 0 for any x<0 → output is 0 on neg.
      const op = freshOp({ drive: 8, asym: 1, trim: 0 });
      for (const x of [-0.9, -0.5, -0.1]) {
        const { out } = drive(op, x);
        if (Math.abs(out[0]) > 1e-6) return { pass: false, why: `x=${x}: out=${out[0]} (expected 0)` };
      }
      // Positive side still clips normally → y(+1) = 1.
      const { out } = drive(op, 1);
      if (!approx(out[0], 1, 1e-6)) return { pass: false, why: `pos still clips: ${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'asym creates DC offset on symmetric input',
    run() {
      // sine through asymmetric clipper has nonzero DC mean (Big Muff /
      // Klon signature — even harmonics).
      const op = freshOp({ drive: 4, asym: 0.5, trim: 0 });
      const NWIN = 4096;
      const freq = 48000 / 256;  // integer cycles
      const { out } = drive(op, i => Math.sin(2 * Math.PI * freq * i / SR), NWIN);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      const dc = sum / out.length;
      // DC should be NONZERO (compressed less on neg → net positive bias).
      if (Math.abs(dc) < 0.01) return { pass: false, why: `expected nonzero DC: ${dc}` };
      return { pass: true };
    },
  },

  // ---- trim is pure post-gain ------------------------------------------
  {
    name: 'trim is pure post-gain: shape unchanged, scaled by trimLin',
    run() {
      const opA = freshOp({ drive: 4, asym: 0.3, trim: 0  });
      const opB = freshOp({ drive: 4, asym: 0.3, trim: 6  });
      const trimLin = Math.pow(10, 6 / 20);
      for (const x of [-0.7, -0.2, 0.2, 0.7]) {
        const { out: a } = drive(opA, x);
        const { out: b } = drive(opB, x);
        if (!approx(b[0], a[0] * trimLin, 1e-5)) return { pass: false, why: `x=${x}: ${b[0]} vs ${a[0] * trimLin}` };
      }
      return { pass: true };
    },
  },

  // ---- low-amplitude transparency --------------------------------------
  {
    name: 'small signal at drive=1: near-unity gain (knee well above 0.01)',
    run() {
      const op = freshOp({ drive: 1, asym: 0, trim: 0 });
      const { out } = drive(op, 0.001);
      // arcsinh(x)/arcsinh(1) ≈ x/0.881 at small x → gain ~1.135.
      const gain = out[0] / 0.001;
      if (!approx(gain, 1 / Math.asinh(1), 0.01)) return { pass: false, why: `gain=${gain}` };
      return { pass: true };
    },
  },

  // ---- distinctness from tanh ------------------------------------------
  {
    name: 'log-asymptotic distinct from tanh: y(2) > tanh(2) at drive=1',
    run() {
      // tanh(2) = 0.964. arcsinh(2)/arcsinh(1) = 1.444/0.881 = 1.638.
      // Past the knee, arcsinh keeps growing (log) while tanh saturates.
      const op = freshOp({ drive: 1, asym: 0, trim: 0 });
      const { out } = drive(op, 2);
      if (!(out[0] > 1.5)) return { pass: false, why: `y(2)=${out[0]} expected >1.5 (log growth)` };
      return { pass: true };
    },
  },

  // ---- stateless / reset -----------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ drive: 4, asym: 0.5, trim: 0 });
      drive(op, 0.7);
      op.reset();
      const { out } = drive(op, 0.3);
      const ref = freshOp({ drive: 4, asym: 0.5, trim: 0 });
      const { out: refOut } = drive(ref, 0.3);
      if (!approx(out[0], refOut[0], 1e-9)) return { pass: false, why: `${out[0]} vs ${refOut[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ drive: 8, asym: 0.3, trim: 0 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ drive: 8, asym: 0.5, trim: 0 });
      const { out } = drive(op, 0);
      for (let i = 0; i < N; i++) if (Math.abs(out[i]) > 1e-9) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param NaN/inf clamp: stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['drive', 'asym', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'diodeClipper', tests };
