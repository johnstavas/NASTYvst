// op_peak.test.js — real-math tests for op_peak.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against Canon:loudness §1 (IEC 60268-10 peak ballistics).
// Tests cover: instant attack on transients, 60 dB release semantics,
// polarity-agnostic |x| tracking, hold-then-decay shape, param retune,
// reset, denormal flush, defensive null, determinism.

import { PeakOp } from './op_peak.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new PeakOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { peak: out }, n);
  return { inBuf, out };
}

const tests = [
  // ---- instant attack -----------------------------------------------
  {
    name: 'instant attack: step 0 → 0.8 latches on sample 0',
    run() {
      const op = freshOp({ release: 1000 });
      const { out } = render(op, 0.8, 4);
      if (!approx(out[0], 0.8, 1e-6)) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'instant attack: transient spike captured in one sample',
    run() {
      const op = freshOp({ release: 1000 });
      const inBuf = new Float32Array(128);
      inBuf[50] = 0.95;
      const out = new Float32Array(128);
      op.process({ in: inBuf }, { peak: out }, 128);
      if (!approx(out[50], 0.95, 1e-6)) return { pass: false, why: `out[50]=${out[50]}` };
      return { pass: true };
    },
  },
  {
    name: 'polarity-agnostic: negative spike tracked as |x|',
    run() {
      const op = freshOp({ release: 1000 });
      const inBuf = new Float32Array(64);
      inBuf[10] = -0.7;
      const out = new Float32Array(64);
      op.process({ in: inBuf }, { peak: out }, 64);
      if (!approx(out[10], 0.7, 1e-6)) return { pass: false, why: `out[10]=${out[10]}` };
      return { pass: true };
    },
  },

  // ---- peak hold (no new peak → decay) -----------------------------
  {
    name: 'held peak: higher sample overrides lower',
    run() {
      const op = freshOp({ release: 10000 });
      const inBuf = new Float32Array(10);
      inBuf[0] = 0.5;
      inBuf[5] = 0.9;
      const out = new Float32Array(10);
      op.process({ in: inBuf }, { peak: out }, 10);
      if (!(out[5] >= 0.9 - 1e-6)) return { pass: false, why: `out[5]=${out[5]}` };
      // Before the new peak, output still ≈ 0.5 (very slow release over 5 samples).
      if (out[4] < 0.49) return { pass: false, why: `out[4]=${out[4]}` };
      return { pass: true };
    },
  },

  // ---- 60 dB release semantics -------------------------------------
  {
    name: 'release 100 ms: output falls 60 dB in exactly 100 ms',
    run() {
      const op = freshOp({ release: 100 });
      // Prime with a unit peak, then zero-drive long enough to observe decay.
      const n = Math.floor(0.1 * SR);  // 100 ms = 4800 samples
      const inBuf = new Float32Array(n + 16);
      for (let i = 0; i < 8; i++) inBuf[i] = 1.0;  // hold at 1 for 8 samples
      const out = new Float32Array(n + 16);
      op.process({ in: inBuf }, { peak: out }, n + 16);
      // At sample n+8 (100 ms after the last peak), expect ≈ 0.001 (60 dB down).
      const val = out[n + 7];
      const dbDown = 20 * Math.log10(val);
      // Allow ±1 dB tolerance (float rounding + sample quantization).
      if (Math.abs(dbDown - (-60)) > 1.0) return { pass: false, why: `${dbDown.toFixed(2)} dB (val=${val})` };
      return { pass: true };
    },
  },
  {
    name: 'release 500 ms: output falls 60 dB in exactly 500 ms',
    run() {
      const op = freshOp({ release: 500 });
      const n = Math.floor(0.5 * SR);
      const inBuf = new Float32Array(n + 16);
      for (let i = 0; i < 8; i++) inBuf[i] = 1.0;
      const out = new Float32Array(n + 16);
      op.process({ in: inBuf }, { peak: out }, n + 16);
      const dbDown = 20 * Math.log10(out[n + 7]);
      if (Math.abs(dbDown - (-60)) > 1.0) return { pass: false, why: `${dbDown.toFixed(2)} dB` };
      return { pass: true };
    },
  },

  // ---- release shape is exponential, monotonic ----------------------
  {
    name: 'release is monotonically non-increasing after last peak',
    run() {
      const op = freshOp({ release: 200 });
      const n = 8000;
      const inBuf = new Float32Array(n);
      inBuf[0] = 1.0;
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { peak: out }, n);
      for (let i = 1; i < n; i++) {
        if (out[i] > out[i - 1] + 1e-7) return { pass: false, why: `rise at ${i}: ${out[i - 1]} → ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- tracks peak of a sine wave -----------------------------------
  {
    name: 'sine amplitude 0.5: peak reading settles at ≈ 0.5',
    run() {
      const op = freshOp({ release: 100 });
      const n = SR;  // 1 s — many cycles of any audible freq
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR);
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { peak: out }, n);
      // In steady state, peak reading bounces between 0.5 (each crest) and
      // something slightly lower (between crests, small release). Max should be 0.5.
      let maxSeen = 0;
      for (let i = SR / 2; i < n; i++) maxSeen = Math.max(maxSeen, out[i]);
      if (Math.abs(maxSeen - 0.5) > 1e-3) return { pass: false, why: `max=${maxSeen}` };
      return { pass: true };
    },
  },

  // ---- param retune --------------------------------------------------
  {
    name: 'release retune: longer release decays slower',
    run() {
      // Prime both ops with a peak of 1, then compare after 50 ms.
      const a = freshOp({ release: 100  });
      const b = freshOp({ release: 2000 });
      const primeN = 8;
      const tailN  = Math.floor(0.05 * SR);  // 50 ms
      const inBuf = new Float32Array(primeN + tailN);
      for (let i = 0; i < primeN; i++) inBuf[i] = 1.0;
      const outA = new Float32Array(primeN + tailN);
      const outB = new Float32Array(primeN + tailN);
      a.process({ in: inBuf }, { peak: outA }, primeN + tailN);
      b.process({ in: inBuf }, { peak: outB }, primeN + tailN);
      const lastA = outA[primeN + tailN - 1];
      const lastB = outB[primeN + tailN - 1];
      if (!(lastB > lastA * 2)) return { pass: false, why: `A=${lastA} B=${lastB}` };
      return { pass: true };
    },
  },

  // ---- missing input continues release ------------------------------
  {
    name: 'missing input: held state decays through release (not slammed to zero)',
    run() {
      const op = freshOp({ release: 1000 });
      const inBuf = new Float32Array(8); inBuf[0] = 1.0;
      const out1 = new Float32Array(8);
      op.process({ in: inBuf }, { peak: out1 }, 8);
      // Now call with no input — should continue the exponential release, not zero.
      const out2 = new Float32Array(8);
      op.process({}, { peak: out2 }, 8);
      if (out2[0] === 0) return { pass: false, why: 'missing input slammed to 0' };
      if (out2[0] >= out1[7]) return { pass: false, why: 'did not decay' };
      return { pass: true };
    },
  },

  // ---- reset --------------------------------------------------------
  {
    name: 'reset() clears held peak',
    run() {
      const op = freshOp({ release: 1000 });
      render(op, 1.0, 512);
      op.reset();
      const { out } = render(op, 0, 1);
      if (out[0] !== 0) return { pass: false, why: `post-reset out[0]=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush -----------------------------------------------
  {
    name: 'denormal flush: tiny held state + zero input → state → 0',
    run() {
      const op = freshOp({ release: 1000 });
      op._y1 = 1e-35;
      const inBuf = new Float32Array(32);  // all zeros
      op.process({ in: inBuf }, { peak: new Float32Array(32) }, 32);
      if (op._y1 !== 0) return { pass: false, why: `y1=${op._y1}` };
      return { pass: true };
    },
  },

  // ---- defensive -----------------------------------------------------
  {
    name: 'no output buffer → early return, no throw',
    run() {
      const op = freshOp({ release: 100 });
      try {
        op.process({ in: new Float32Array(8) }, {}, 8);
      } catch (e) {
        return { pass: false, why: `threw: ${e.message}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'extreme release (50000 ms) clamped, stays finite',
    run() {
      const op = freshOp({ release: 50000 });
      const inBuf = new Float32Array(128); inBuf[0] = 0.5;
      const out = new Float32Array(128);
      op.process({ in: inBuf }, { peak: out }, 128);
      for (let i = 0; i < 128; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme release (0.1 ms) clamped, stays finite and decays fast',
    run() {
      const op = freshOp({ release: 0.1 });
      const inBuf = new Float32Array(SR); inBuf[0] = 1.0;
      const out = new Float32Array(SR);
      op.process({ in: inBuf }, { peak: out }, SR);
      for (let i = 0; i < SR; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      // Should be essentially gone by 10 ms.
      if (out[Math.floor(0.01 * SR)] > 1e-6) return { pass: false, why: 'did not decay' };
      return { pass: true };
    },
  },

  // ---- determinism --------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const mk = () => {
        const op = freshOp({ release: 250 });
        const inBuf = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) inBuf[i] = Math.sin(i * 0.03) * 0.7;
        const out = new Float32Array(1024);
        op.process({ in: inBuf }, { peak: out }, 1024);
        return out;
      };
      const a = mk();
      const b = mk();
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'peak', tests };
