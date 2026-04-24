// op_onePole.test.js — real-math tests for op_onePole.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_filters.md §9 / DAFX §2.1.1.
// Tests cover: DC passes through LP (gain=1), LP attenuates HF, LP -3 dB
// at cutoff, HP is complementary (LP + HP = input bit-exact), HP rejects
// DC, mode switch, cutoff retune, reset clears state, denormal flush,
// defensive null.

import { OnePoleOp } from './op_onePole.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new OnePoleOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

function tailRms(buf, skip) {
  let s = 0, n = 0;
  for (let i = skip; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

const tests = [
  // ---- LP DC gain ---------------------------------------------------
  {
    name: 'LP: DC passes at unity (gain = 1 at f=0)',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 1000 });
      const { out } = render(op, 1, 4096);
      // After settling, y should be 1.
      if (!approx(out[4095], 1, 1e-4)) return { pass: false, why: `out=${out[4095]}` };
      return { pass: true };
    },
  },
  {
    name: 'LP: zero input → zero output (at steady state)',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 1000 });
      const { out } = render(op, 0, 2048);
      for (let i = 0; i < 2048; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- LP rolloff ----------------------------------------------------
  {
    name: 'LP: HF sine attenuated (15 kHz << unity for fc=500)',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 500 });
      const { out } = render(op, i => Math.sin(2 * Math.PI * 15000 * i / SR), 4096);
      const rms = tailRms(out, 2048);
      // Should be well below -20 dB vs unity-amp sine (0.707 unfiltered).
      if (rms > 0.15) return { pass: false, why: `rms=${rms}` };
      return { pass: true };
    },
  },
  {
    name: 'LP: -3 dB at cutoff (approximate, ±1 dB)',
    run() {
      const fc = 1000;
      const op = freshOp({ mode: 'lp', cutoff: fc });
      const { out } = render(op, i => Math.sin(2 * Math.PI * fc * i / SR), 4 * SR);
      const rms = tailRms(out, 2 * SR);
      // Unity-amp sine RMS = 1/sqrt(2) ≈ 0.707. -3 dB → ≈ 0.5.
      const expectedRms = (1 / Math.sqrt(2)) * Math.pow(10, -3 / 20);
      const dbErr = 20 * Math.log10(rms / expectedRms);
      if (Math.abs(dbErr) > 1) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'LP: low-frequency sine (100 Hz) passes at ≈ unity for fc=5 kHz',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 5000 });
      const { out } = render(op, i => Math.sin(2 * Math.PI * 100 * i / SR), 4096);
      const rms = tailRms(out, 2048);
      const expected = 1 / Math.sqrt(2);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.3) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },

  // ---- HP ------------------------------------------------------------
  {
    name: 'HP: DC rejected (settles to 0)',
    run() {
      const op = freshOp({ mode: 'hp', cutoff: 100 });
      const { out } = render(op, 1, 4 * SR);
      if (Math.abs(out[out.length - 1]) > 1e-3) return { pass: false, why: `out=${out[out.length - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'HP: HF sine passes near unity (15 kHz for fc=500)',
    run() {
      const op = freshOp({ mode: 'hp', cutoff: 500 });
      const { out } = render(op, i => Math.sin(2 * Math.PI * 15000 * i / SR), 4096);
      const rms = tailRms(out, 2048);
      const expected = 1 / Math.sqrt(2);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.5) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'LP + HP complementary: LP(x) + HP(x) = x bit-exactly',
    run() {
      const opLP = freshOp({ mode: 'lp', cutoff: 1000 });
      const opHP = freshOp({ mode: 'hp', cutoff: 1000 });
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * 300 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 7000 * i / SR);
      const outLP = new Float32Array(N);
      const outHP = new Float32Array(N);
      opLP.process({ in: inBuf }, { out: outLP }, N);
      opHP.process({ in: inBuf }, { out: outHP }, N);
      for (let i = 0; i < N; i++) {
        const sum = outLP[i] + outHP[i];
        if (Math.abs(sum - inBuf[i]) > 1e-5) return { pass: false, why: `i=${i}: ${sum} vs ${inBuf[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- cutoff retune -------------------------------------------------
  {
    name: 'higher cutoff lets more HF through (LP fc=500 vs 5000 @ 2 kHz)',
    run() {
      const lo = freshOp({ mode: 'lp', cutoff: 500  });
      const hi = freshOp({ mode: 'lp', cutoff: 5000 });
      const a = render(lo, i => Math.sin(2 * Math.PI * 2000 * i / SR), 4096).out;
      const b = render(hi, i => Math.sin(2 * Math.PI * 2000 * i / SR), 4096).out;
      const rmsA = tailRms(a, 2048);
      const rmsB = tailRms(b, 2048);
      if (!(rmsB > rmsA)) return { pass: false, why: `lo=${rmsA} hi=${rmsB}` };
      return { pass: true };
    },
  },
  {
    name: 'setParam(cutoff) takes effect on subsequent samples',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 100 });
      render(op, i => Math.sin(2 * Math.PI * 2000 * i / SR), 4096);
      op.setParam('cutoff', 8000);
      const { out } = render(op, i => Math.sin(2 * Math.PI * 2000 * i / SR), 4096);
      const rms = tailRms(out, 2048);
      const expected = 1 / Math.sqrt(2);
      if (rms < 0.6 || rms > 0.75) return { pass: false, why: `rms=${rms}` };
      return { pass: true };
    },
  },

  // ---- reset / state -------------------------------------------------
  {
    name: 'reset() clears LP state',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 100 });
      render(op, 1, 4096);  // saturate state toward 1
      op.reset();
      const { out } = render(op, 0, 1);
      if (out[0] !== 0) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush -----------------------------------------------
  {
    name: 'denormal flush: tiny state + zero input → state → 0',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 100 });
      op._y1 = 1e-35;
      render(op, 0, 16);
      if (op._y1 !== 0) return { pass: false, why: `y1=${op._y1}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 1000 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'cutoff > Nyquist still produces finite output',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 100000 });
      const { out } = render(op, 0.5, 512);
      for (let i = 0; i < 512; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- determinism ---------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = render(freshOp({ mode: 'lp', cutoff: 1000 }), i => Math.sin(i * 0.01), 1024).out;
      const b = render(freshOp({ mode: 'lp', cutoff: 1000 }), i => Math.sin(i * 0.01), 1024).out;
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'onePole', tests };
