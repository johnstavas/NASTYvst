// op_rms.test.js — real-math tests for op_rms.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against Canon:loudness §1 (windowed RMS, one-pole
// averager). Tests cover: sine-wave RMS = A/√2, DC RMS = |DC|, smooth
// convergence (no discontinuity), window-length scaling, symmetric
// response to ±polarity, reset, denormal flush, defensive null,
// determinism.

import { RmsOp } from './op_rms.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new RmsOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { rms: out }, n);
  return { inBuf, out };
}

const tests = [
  // ---- defining property: sine RMS = A / √2 ------------------------
  {
    name: 'sine amplitude 1.0: steady-state RMS ≈ 1/√2 ≈ 0.707',
    run() {
      const op = freshOp({ window: 100 });
      // Run for ≫ window so the averager fully converges.
      const n = SR;
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = Math.sin(2 * Math.PI * 1000 * i / SR);
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { rms: out }, n);
      const expected = 1 / Math.sqrt(2);
      const got = out[n - 1];
      if (Math.abs(got - expected) > 0.01) return { pass: false, why: `got=${got} expected=${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'sine amplitude 0.5: steady-state RMS ≈ 0.5/√2 ≈ 0.3536',
    run() {
      const op = freshOp({ window: 100 });
      const n = SR;
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR);
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { rms: out }, n);
      const expected = 0.5 / Math.sqrt(2);
      if (Math.abs(out[n - 1] - expected) > 0.01) return { pass: false, why: `got=${out[n - 1]}` };
      return { pass: true };
    },
  },

  // ---- DC: RMS = |DC| ----------------------------------------------
  {
    name: 'DC +0.8: steady-state RMS converges to 0.8',
    run() {
      const op = freshOp({ window: 50 });
      const { out } = render(op, 0.8, SR);
      if (Math.abs(out[SR - 1] - 0.8) > 1e-3) return { pass: false, why: `got=${out[SR - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'DC −0.5: steady-state RMS converges to 0.5 (polarity-agnostic)',
    run() {
      const op = freshOp({ window: 50 });
      const { out } = render(op, -0.5, SR);
      if (Math.abs(out[SR - 1] - 0.5) > 1e-3) return { pass: false, why: `got=${out[SR - 1]}` };
      return { pass: true };
    },
  },

  // ---- startup ramp -------------------------------------------------
  {
    name: 'startup ramp: begins at 0, climbs monotonically toward target',
    run() {
      const op = freshOp({ window: 100 });
      const n = SR / 2;
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = 1.0;  // DC 1 → target RMS 1
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { rms: out }, n);
      // First few samples ≪ 1 (integrator starting from 0).
      if (out[0] >= 0.1) return { pass: false, why: `out[0]=${out[0]} (too high)` };
      // Monotonic climb — RMS averager is non-decreasing when input power is constant.
      for (let i = 1; i < n; i++) {
        if (out[i] < out[i - 1] - 1e-7) return { pass: false, why: `drop at ${i}: ${out[i - 1]} → ${out[i]}` };
      }
      // Eventually near 1.0.
      if (Math.abs(out[n - 1] - 1.0) > 0.01) return { pass: false, why: `end=${out[n - 1]}` };
      return { pass: true };
    },
  },

  // ---- window scaling ---------------------------------------------
  {
    name: 'longer window: slower convergence',
    run() {
      const a = freshOp({ window: 50  });
      const b = freshOp({ window: 500 });
      const n = Math.floor(0.1 * SR);  // 100 ms
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = 1.0;
      const outA = new Float32Array(n);
      const outB = new Float32Array(n);
      a.process({ in: inBuf }, { rms: outA }, n);
      b.process({ in: inBuf }, { rms: outB }, n);
      // After 100 ms, the shorter-window averager should be much closer to the target than the longer-window one.
      if (!(outA[n - 1] > outB[n - 1] * 1.5)) {
        return { pass: false, why: `A=${outA[n - 1]} B=${outB[n - 1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'τ = 1/e rule: after τ seconds, RMS² reaches ≈ 63% of target (step response)',
    run() {
      // Analytical: one-pole step response y(t) = target · (1 − e^(−t/τ)).
      // At t = τ, y ≈ 0.632 · target. This op averages POWER (x²), so check the
      // power (y²) hits ~0.632 of target-power after window seconds.
      const windowMs = 200;
      const op = freshOp({ window: windowMs });
      const nTau = Math.floor((windowMs * 0.001) * SR);  // τ samples
      const inBuf = new Float32Array(nTau + 4);
      for (let i = 0; i < inBuf.length; i++) inBuf[i] = 1.0;  // DC 1, target power = 1
      const out = new Float32Array(inBuf.length);
      op.process({ in: inBuf }, { rms: out }, inBuf.length);
      const powerAtTau = out[nTau - 1] * out[nTau - 1];
      // Expect 0.632 ± 0.02.
      if (Math.abs(powerAtTau - 0.632) > 0.02) return { pass: false, why: `p(τ)=${powerAtTau.toFixed(4)}` };
      return { pass: true };
    },
  },

  // ---- symmetric to polarity --------------------------------------
  {
    name: 'square wave ±1: RMS converges to 1 (independent of sign sequence)',
    run() {
      const op = freshOp({ window: 20 });
      const n = SR / 2;
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = (i % 2 === 0) ? 1 : -1;
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { rms: out }, n);
      if (Math.abs(out[n - 1] - 1) > 1e-3) return { pass: false, why: `got=${out[n - 1]}` };
      return { pass: true };
    },
  },

  // ---- release when input goes silent ------------------------------
  {
    name: 'input zeros after prime: RMS decays smoothly toward 0',
    run() {
      const op = freshOp({ window: 100 });
      const primeN = SR / 2;
      const inPrime = new Float32Array(primeN);
      for (let i = 0; i < primeN; i++) inPrime[i] = 0.5;
      op.process({ in: inPrime }, { rms: new Float32Array(primeN) }, primeN);

      const tailN = SR;
      const inTail = new Float32Array(tailN);  // zeros
      const outTail = new Float32Array(tailN);
      op.process({ in: inTail }, { rms: outTail }, tailN);

      if (outTail[0] <= 0) return { pass: false, why: `start=${outTail[0]} (should be ≈0.5)` };
      // Monotonically non-increasing.
      for (let i = 1; i < tailN; i++) {
        if (outTail[i] > outTail[i - 1] + 1e-7) return { pass: false, why: `rise at ${i}` };
      }
      // After 1 s with τ = 100 ms (10 time constants), power has decayed by
      // e^(−10) ≈ 4.5e−5, so sqrt(p) ≈ 0.5 · √4.5e−5 ≈ 0.0034. Allow ≤ 0.01.
      if (outTail[tailN - 1] > 0.01) return { pass: false, why: `end=${outTail[tailN - 1]}` };
      return { pass: true };
    },
  },

  // ---- missing input continues averaging --------------------------
  {
    name: 'missing input: state decays, not slammed to zero',
    run() {
      const op = freshOp({ window: 200 });
      op._p = 0.25;  // pre-seed running power
      const out = new Float32Array(8);
      op.process({}, { rms: out }, 8);
      if (out[0] === 0) return { pass: false, why: 'slammed to 0' };
      if (out[0] > 0.5 || out[0] < 0.499) return { pass: false, why: `unexpected start ${out[0]}` };
      return { pass: true };
    },
  },

  // ---- reset --------------------------------------------------------
  {
    name: 'reset() clears running power state',
    run() {
      const op = freshOp({ window: 100 });
      render(op, 1.0, SR);
      op.reset();
      const { out } = render(op, 0, 4);
      for (let i = 0; i < 4; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush ---------------------------------------------
  {
    name: 'denormal flush: tiny power state + zero input → state → 0',
    run() {
      const op = freshOp({ window: 100 });
      op._p = 1e-35;
      op.process({ in: new Float32Array(32) }, { rms: new Float32Array(32) }, 32);
      if (op._p !== 0) return { pass: false, why: `p=${op._p}` };
      return { pass: true };
    },
  },

  // ---- defensive -------------------------------------------------
  {
    name: 'no output buffer → early return, no throw',
    run() {
      const op = freshOp({ window: 100 });
      try { op.process({ in: new Float32Array(8) }, {}, 8); }
      catch (e) { return { pass: false, why: `threw: ${e.message}` }; }
      return { pass: true };
    },
  },
  {
    name: 'extreme window (50000 ms) clamped, stays finite',
    run() {
      const op = freshOp({ window: 50000 });
      const { out } = render(op, 0.5, 1024);
      for (let i = 0; i < 1024; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'output is always ≥ 0 (no NaN from negative sqrt argument)',
    run() {
      const op = freshOp({ window: 50 });
      const n = 2048;
      const inBuf = new Float32Array(n);
      for (let i = 0; i < n; i++) inBuf[i] = Math.sin(i * 0.01) * 0.3;
      const out = new Float32Array(n);
      op.process({ in: inBuf }, { rms: out }, n);
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (out[i] < 0) return { pass: false, why: `negative at ${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- determinism -----------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const mk = () => {
        const op = freshOp({ window: 250 });
        const inBuf = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) inBuf[i] = Math.sin(i * 0.03) * 0.7;
        const out = new Float32Array(1024);
        op.process({ in: inBuf }, { rms: out }, 1024);
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

export default { opId: 'rms', tests };
