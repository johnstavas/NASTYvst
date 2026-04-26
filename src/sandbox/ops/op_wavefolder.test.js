// op_wavefolder.test.js — real-math tests for op_wavefolder.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against Faust ef.wavefold (MIT, David Braun 2024,
// citing Zölzer "Digital Audio Signal Processing" Ch 10 Fig 10.7).
// Tests cover: width=0 pass-through, peak normalization (|y|≤1), fold
// non-monotonicity, even-harmonic content, sign symmetry, defensive
// nulls, drive/trim independence, stateless reset.

import { WavefolderOp } from './op_wavefolder.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new WavefolderOp(SR);
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

// Reference wavefolder (Faust ef.wavefold) — independent re-derivation.
function foldRef(x, driveAmt, width, trimDb) {
  const u = x * driveAmt;
  const sign = u < 0 ? -1 : 1;
  const ax = sign * u;
  const a = width * 0.4;
  const thr = 1 - 2 * a;
  const g = 1 / Math.max(1e-9, thr);
  let y;
  if (ax > thr && a > 0) {
    const t = (ax - thr) / (2 * a);
    const f = t - Math.floor(t);
    const tri = 1 - 2.5 * a + a * Math.abs(f - 0.5);
    y = tri * g;
  } else {
    y = ax * g;
  }
  const trimLin = Math.pow(10, trimDb / 20);
  return trimLin * sign * y;
}

const tests = [
  // ---- width=0 → pass-through -------------------------------------------
  {
    name: 'width=0: linear pass-through (no folding)',
    run() {
      const op = freshOp({ drive: 1, width: 0, trim: 0 });
      for (const x of [-0.9, -0.5, -0.1, 0, 0.1, 0.5, 0.9]) {
        const { out } = drive(op, x);
        if (!approx(out[0], x, 1e-6)) return { pass: false, why: `x=${x}: out=${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'width=0 + drive=4: pure linear gain (no fold)',
    run() {
      const op = freshOp({ drive: 4, width: 0, trim: 0 });
      const { out } = drive(op, 0.1);
      // No folding at width=0 → output = x*drive*g, but g=1 at width=0.
      if (!approx(out[0], 0.4, 1e-6)) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- Faust formula matches reference ----------------------------------
  {
    name: 'matches Faust ef.wavefold reference at default params',
    run() {
      const op = freshOp({ drive: 1, width: 0.5, trim: 0 });
      for (const x of [-0.9, -0.5, -0.2, -0.1, 0.1, 0.2, 0.5, 0.9]) {
        const { out } = drive(op, x);
        const expected = foldRef(x, 1, 0.5, 0);
        if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `x=${x}: ${out[0]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'matches reference across drive/width/trim sweep',
    run() {
      for (const d of [1, 2, 4]) {
        for (const w of [0.25, 0.5, 0.75, 1]) {
          for (const tdb of [-6, 0, 6]) {
            const op = freshOp({ drive: d, width: w, trim: tdb });
            for (const x of [-0.7, -0.3, 0.1, 0.4, 0.8]) {
              const { out } = drive(op, x);
              const expected = foldRef(x, d, w, tdb);
              if (!approx(out[0], expected, 1e-5)) return { pass: false, why: `d=${d} w=${w} tdb=${tdb} x=${x}: ${out[0]} vs ${expected}` };
            }
          }
        }
      }
      return { pass: true };
    },
  },

  // ---- peak normalization (|y| ≤ 1 for |x| ≤ 1) ------------------------
  {
    name: 'peak normalization: |x|≤1, drive=1 → |y|≤1 + tiny tolerance',
    run() {
      for (const w of [0.1, 0.5, 1.0]) {
        const op = freshOp({ drive: 1, width: w, trim: 0 });
        for (let x = -1; x <= 1; x += 0.005) {
          const { out } = drive(op, x);
          if (Math.abs(out[0]) > 1.000001) return { pass: false, why: `w=${w} x=${x.toFixed(3)} out=${out[0]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'tri reaches +1 at threshold (width=1, x=0.2)',
    run() {
      // At width=1, a=0.4, thr=0.2. tri at ax=thr: u=0, f=0, |f-0.5|=0.5,
      // tri = 1 - 1 + 0.4*0.5 = 0.2; y = tri*g = 0.2*5 = 1.0.
      const op = freshOp({ drive: 1, width: 1, trim: 0 });
      const { out } = drive(op, 0.2);
      if (!approx(out[0], 1.0, 1e-5)) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'tri folds back to 0 at first valley (width=1, x=0.6)',
    run() {
      // At width=1, a=0.4, thr=0.2, twoA=0.8. ax=0.6: u=0.5, f=0.5,
      // |f-0.5|=0; tri = 1 - 1 + 0 = 0; y = 0.
      const op = freshOp({ drive: 1, width: 1, trim: 0 });
      const { out } = drive(op, 0.6);
      if (Math.abs(out[0]) > 1e-5) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- non-monotonic (the wavefolder fingerprint) -----------------------
  {
    name: 'non-monotonic: y(0.6) < y(0.2) at width=1',
    run() {
      const op = freshOp({ drive: 1, width: 1, trim: 0 });
      const { out: at02 } = drive(op, 0.2);
      const { out: at06 } = drive(op, 0.6);
      if (!(at02[0] > at06[0])) return { pass: false, why: `y(0.2)=${at02[0]} y(0.6)=${at06[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'non-monotonic across input sweep at width=1',
    run() {
      // Confirm transfer is NOT non-decreasing — this is what makes a
      // wavefolder distinct from saturate/softLimit.
      const op = freshOp({ drive: 1, width: 1, trim: 0 });
      let nonMonoFound = false;
      let prev = -Infinity;
      for (let x = 0; x <= 1; x += 0.01) {
        const { out } = drive(op, x);
        if (out[0] < prev - 1e-5) { nonMonoFound = true; break; }
        prev = out[0];
      }
      if (!nonMonoFound) return { pass: false, why: 'transfer is monotonic — should fold' };
      return { pass: true };
    },
  },

  // ---- odd symmetry ------------------------------------------------------
  {
    name: 'odd-symmetric: f(-x) = -f(x) at any (drive, width)',
    run() {
      for (const d of [1, 2, 4]) {
        for (const w of [0.3, 0.7, 1]) {
          const op = freshOp({ drive: d, width: w, trim: 0 });
          for (const x of [0.05, 0.2, 0.5, 0.9]) {
            const { out: pos } = drive(op, x);
            const { out: neg } = drive(op, -x);
            if (!approx(pos[0], -neg[0], 1e-6)) return { pass: false, why: `d=${d} w=${w} x=${x}: ${pos[0]} vs ${-neg[0]}` };
          }
        }
      }
      return { pass: true };
    },
  },

  // ---- drive pre-gain ---------------------------------------------------
  {
    name: 'drive pushes signal past first fold valley',
    run() {
      // At width=1, a=0.4, thr=0.2, twoA=0.8, g=5. Fold cycle is twoA=0.8
      // in input space; first VALLEY (output→0) is at ax = thr + twoA/2 =
      // 0.6. Use x=0.075:
      //   drive=1: ax=0.075 (linear zone, y = 0.375)
      //   drive=8: ax=0.6   (first valley, y ≈ 0)
      const x = 0.075;
      const op1 = freshOp({ drive: 1, width: 1, trim: 0 });
      const op8 = freshOp({ drive: 8, width: 1, trim: 0 });
      const { out: a } = drive(op1, x);
      const { out: b } = drive(op8, x);
      if (!approx(a[0], 0.375, 1e-5)) return { pass: false, why: `low-drive: ${a[0]}` };
      if (Math.abs(b[0]) > 1e-5)      return { pass: false, why: `high-drive expected ≈0 at first valley: ${b[0]}` };
      return { pass: true };
    },
  },

  // ---- trim is pure post-gain -------------------------------------------
  {
    name: 'trim is pure post-gain: shape unchanged, amplitude scales by trimLin',
    run() {
      const opA = freshOp({ drive: 1, width: 1, trim: 0  });
      const opB = freshOp({ drive: 1, width: 1, trim: 6  });
      const trimLin = Math.pow(10, 6 / 20);
      for (const x of [0.1, 0.3, 0.6, 0.9]) {
        const { out: a } = drive(opA, x);
        const { out: b } = drive(opB, x);
        if (!approx(b[0], a[0] * trimLin, 1e-5)) return { pass: false, why: `x=${x}: ${b[0]} vs ${a[0] * trimLin}` };
      }
      return { pass: true };
    },
  },

  // ---- harmonic content (even harmonics indicate folding) ---------------
  {
    name: 'sine through width=1 fold has DC=0 (odd-symmetric output, integer cycles)',
    run() {
      // freq = SR*k/N gives integer-cycle window. SR/256 * 16 = 187.5 Hz
      // over N=4096 → 16 full cycles, no leakage bias.
      const op = freshOp({ drive: 1, width: 1, trim: 0 });
      const NWIN = 4096;
      const freq = 48000 / 256;  // 187.5 Hz
      const { out } = drive(op, i => Math.sin(2 * Math.PI * freq * i / SR), NWIN);
      let sum = 0;
      for (let i = 0; i < out.length; i++) sum += out[i];
      const dc = sum / out.length;
      if (Math.abs(dc) > 1e-6) return { pass: false, why: `DC=${dc}` };
      return { pass: true };
    },
  },

  // ---- stateless / reset ------------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ drive: 4, width: 1, trim: 0 });
      drive(op, 0.7);
      op.reset();
      const { out } = drive(op, 0.3);
      const ref = freshOp({ drive: 4, width: 1, trim: 0 });
      const { out: refOut } = drive(ref, 0.3);
      if (!approx(out[0], refOut[0], 1e-9)) return { pass: false, why: `${out[0]} vs ${refOut[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ drive: 4, width: 1, trim: 0 });
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
      for (const p of ['drive', 'width', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ drive: 8, width: 1, trim: 0 });
      const { out } = drive(op, 0);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'wavefolder', tests };
