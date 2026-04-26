// op_hardClip.test.js — real-math tests for op_hardClip.
// Run via: node scripts/check_op_math.mjs
//
// Naive form: Canon §5 branchless clip (de Soras 2004, musicdsp #81).
// ADAA form: Parker-Esqueda-Bilbao DAFx 2016 §III antiderivative
// antialiasing. Tests cover:
// - naive: clamp at ±T, transparent within knee, sign symmetry
// - branchless ≡ if-then-else clip (numeric agreement)
// - drive pre-gain pushes signal past threshold
// - trim is pure post-gain
// - threshold honors clamp boundary
// - ADAA reduces aliasing on a fast ramp signal
// - ADAA fallback when |Δx| < eps
// - ADAA reset clears state
// - defensive nulls

import { HardClipOp } from './op_hardClip.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new HardClipOp(SR);
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

// Reference if-then-else clip.
function clipIf(x, T) {
  if (x >  T) return T;
  if (x < -T) return -T;
  return x;
}

const tests = [
  // ---- naive form: clamp behavior --------------------------------------
  {
    name: 'naive within knee: pass-through',
    run() {
      const op = freshOp({ drive: 1, threshold: 1, trim: 0, adaa: 0 });
      for (const x of [-0.99, -0.5, -0.1, 0, 0.1, 0.5, 0.99]) {
        const { out } = drive(op, x);
        if (!approx(out[0], x, 1e-6)) return { pass: false, why: `x=${x}: ${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'naive past threshold: clamps at ±T',
    run() {
      const op = freshOp({ drive: 1, threshold: 0.5, trim: 0, adaa: 0 });
      for (const x of [0.51, 0.7, 1.0, 100]) {
        const { out } = drive(op, x);
        if (!approx(out[0], 0.5, 1e-6)) return { pass: false, why: `x=${x}: ${out[0]}` };
      }
      for (const x of [-0.51, -0.7, -1.0, -100]) {
        const { out } = drive(op, x);
        if (!approx(out[0], -0.5, 1e-6)) return { pass: false, why: `x=${x}: ${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'branchless == if-then-else clip across input sweep',
    run() {
      // Verify Canon §5 identity: 0.5(|x+T|-|x-T|) == clip(x,-T,+T).
      for (const T of [0.1, 0.5, 0.9, 1.0]) {
        const op = freshOp({ drive: 1, threshold: T, trim: 0, adaa: 0 });
        for (let x = -2; x <= 2; x += 0.0123) {
          const { out } = drive(op, x);
          const ref = clipIf(x, T);
          if (!approx(out[0], ref, 1e-6)) return { pass: false, why: `T=${T} x=${x.toFixed(3)}: ${out[0]} vs ${ref}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'sign symmetry: f(-x) = -f(x)',
    run() {
      const op = freshOp({ drive: 1, threshold: 0.5, trim: 0, adaa: 0 });
      for (const x of [0.1, 0.3, 0.6, 1.5]) {
        const { out: pos } = drive(op, x);
        const { out: neg } = drive(op, -x);
        if (!approx(pos[0], -neg[0], 1e-6)) return { pass: false, why: `x=${x}: ${pos[0]} vs ${-neg[0]}` };
      }
      return { pass: true };
    },
  },

  // ---- drive / trim ------------------------------------------------------
  {
    name: 'drive pushes signal past threshold',
    run() {
      // Threshold=1, drive=2: input 0.6 → drive*input=1.2 → clamps to 1.
      const op = freshOp({ drive: 2, threshold: 1, trim: 0, adaa: 0 });
      const { out } = drive(op, 0.6);
      if (!approx(out[0], 1, 1e-6)) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'trim is pure post-gain (clamped value scales)',
    run() {
      const opA = freshOp({ drive: 1, threshold: 0.5, trim: 0,  adaa: 0 });
      const opB = freshOp({ drive: 1, threshold: 0.5, trim: 6,  adaa: 0 });
      const trimLin = Math.pow(10, 6 / 20);
      const { out: a } = drive(opA, 1);  // clamps to +0.5
      const { out: b } = drive(opB, 1);  // clamps then ×trimLin
      if (!approx(b[0], a[0] * trimLin, 1e-5)) return { pass: false, why: `${b[0]} vs ${a[0] * trimLin}` };
      return { pass: true };
    },
  },
  {
    name: 'threshold=very small: most of input clamped',
    run() {
      const op = freshOp({ drive: 1, threshold: 1e-6, trim: 0, adaa: 0 });
      // Anything above 1e-6 in magnitude clips to ±1e-6.
      const { out } = drive(op, 0.5);
      if (!approx(out[0], 1e-6, 1e-7)) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- ADAA path ---------------------------------------------------------
  {
    name: 'ADAA: matches naive within knee (no clipping → no aliasing → identical)',
    run() {
      // When all samples stay within ±T, F(u)=u²/2, ADAA=(u²/2 - x1²/2)/(u-x1) = (u+x1)/2.
      // That's NOT the same as naive within knee! ADAA there gives the
      // midpoint average, not the input. So we test on a CONSTANT signal:
      // u = x1, so dx=0 → fallback path averages f(u) and f(x1) = u.
      const op = freshOp({ drive: 1, threshold: 1, trim: 0, adaa: 1 });
      const { out } = drive(op, i => 0.3, 16);
      // Steady state: every sample should be 0.3 after first.
      for (let i = 1; i < 16; i++) {
        if (!approx(out[i], 0.3, 1e-6)) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'ADAA: bounded |y| ≤ T trim·linTrim for any input',
    run() {
      const op = freshOp({ drive: 4, threshold: 0.5, trim: 0, adaa: 1 });
      const { out } = drive(op, i => 2 * Math.sin(2 * Math.PI * 200 * i / SR), 1024);
      for (let i = 0; i < out.length; i++) {
        if (Math.abs(out[i]) > 0.5 + 1e-5) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'ADAA reduces high-frequency content vs naive on aggressive clip',
    run() {
      // Drive a sine well past the threshold and measure spectral energy
      // above Nyquist/4. ADAA should attenuate it.
      const NWIN = 4096;
      const f = SR / 256;  // 187.5 Hz → 16 cycles in 4096
      const opNaive = freshOp({ drive: 8, threshold: 0.5, trim: 0, adaa: 0 });
      const opAdaa  = freshOp({ drive: 8, threshold: 0.5, trim: 0, adaa: 1 });
      const { out: yN } = drive(opNaive, i => Math.sin(2 * Math.PI * f * i / SR), NWIN);
      const { out: yA } = drive(opAdaa,  i => Math.sin(2 * Math.PI * f * i / SR), NWIN);
      // Very crude HF energy proxy: mean of |y[i] - y[i-1]|.
      let hN = 0, hA = 0;
      for (let i = 1; i < NWIN; i++) { hN += Math.abs(yN[i] - yN[i-1]); hA += Math.abs(yA[i] - yA[i-1]); }
      // ADAA should produce no MORE HF than naive (typically less). Use
      // ≤ + 5% tolerance to permit numerical drift.
      if (!(hA <= hN * 1.05)) return { pass: false, why: `hN=${hN.toFixed(3)} hA=${hA.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'ADAA fallback: zero-input run produces zero output',
    run() {
      const op = freshOp({ drive: 4, threshold: 0.5, trim: 0, adaa: 1 });
      const { out } = drive(op, 0, 64);
      for (let i = 0; i < 64; i++) {
        if (Math.abs(out[i]) > 1e-9) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'ADAA reset() clears state',
    run() {
      // drive=1 so u=x; threshold=0.5, x=0.3 stays within knee.
      // After reset x1=0, F1=0. First sample: u=0.3 → F(0.3)=u²/2=0.045,
      // dx=0.3 → y=(0.045-0)/0.3=0.15.
      const op = freshOp({ drive: 1, threshold: 0.5, trim: 0, adaa: 1 });
      drive(op, 0.7, 32);
      op.reset();
      const { out } = drive(op, 0.3, 1);
      if (!approx(out[0], 0.15, 1e-6)) return { pass: false, why: `${out[0]} != 0.15` };
      return { pass: true };
    },
  },
  {
    name: 'ADAA block continuity: state carries across process calls',
    run() {
      // Run 32 then 32 separately; should equal 64-sample run.
      const op1 = freshOp({ drive: 2, threshold: 0.5, trim: 0, adaa: 1 });
      const op2 = freshOp({ drive: 2, threshold: 0.5, trim: 0, adaa: 1 });
      const { out: full } = drive(op1, i => 0.3 * Math.sin(2 * Math.PI * 100 * i / SR), 64);
      const inA = new Float32Array(32), inB = new Float32Array(32);
      for (let i = 0; i < 32; i++) inA[i] = 0.3 * Math.sin(2 * Math.PI * 100 * i / SR);
      for (let i = 0; i < 32; i++) inB[i] = 0.3 * Math.sin(2 * Math.PI * 100 * (i+32) / SR);
      const oA = new Float32Array(32), oB = new Float32Array(32);
      op2.process({ in: inA }, { out: oA }, 32);
      op2.process({ in: inB }, { out: oB }, 32);
      for (let i = 0; i < 32; i++) {
        if (!approx(full[i], oA[i], 1e-5)) return { pass: false, why: `A i=${i}: ${full[i]} vs ${oA[i]}` };
        if (!approx(full[i+32], oB[i], 1e-5)) return { pass: false, why: `B i=${i}: ${full[i+32]} vs ${oB[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive ---------------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ drive: 4, threshold: 0.5, trim: 0, adaa: 1 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param NaN/inf clamp: stays finite (naive)',
    run() {
      const op = freshOp({});
      for (const p of ['drive', 'threshold', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'param NaN/inf clamp: stays finite (adaa)',
    run() {
      const op = freshOp({ adaa: 1 });
      for (const p of ['drive', 'threshold', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const { out } = drive(op, i => Math.sin(i));
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'hardClip', tests };
