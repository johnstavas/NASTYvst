// op_allpass.test.js — real-math tests for op_allpass.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_filters.md (1st-order allpass) /
// DAFX §5.2. Tests cover: unity magnitude across frequencies (THE allpass
// property), DC passthrough at +1, Nyquist sign-flip at −1, frequency
// retune changes phase (verified indirectly via output divergence from
// input), reset clears state, denormal flush, defensive null,
// determinism.

import { AllpassOp } from './op_allpass.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new AllpassOp(SR);
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
  // ---- unity magnitude property --------------------------------------
  {
    name: 'unity magnitude: 100 Hz sine RMS out ≈ RMS in',
    run() {
      const op = freshOp({ freq: 1000 });
      const { inBuf, out } = render(op, i => Math.sin(2 * Math.PI * 100 * i / SR), 8192);
      const inRms  = tailRms(inBuf, 4096);
      const outRms = tailRms(out,   4096);
      const dbErr = 20 * Math.log10(outRms / inRms);
      if (Math.abs(dbErr) > 0.1) return { pass: false, why: `err=${dbErr.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'unity magnitude: 1 kHz sine (at break freq) RMS preserved',
    run() {
      const op = freshOp({ freq: 1000 });
      const { inBuf, out } = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR), 8192);
      const inRms  = tailRms(inBuf, 4096);
      const outRms = tailRms(out,   4096);
      const dbErr = 20 * Math.log10(outRms / inRms);
      if (Math.abs(dbErr) > 0.1) return { pass: false, why: `err=${dbErr.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'unity magnitude: 10 kHz sine RMS preserved',
    run() {
      const op = freshOp({ freq: 1000 });
      const { inBuf, out } = render(op, i => Math.sin(2 * Math.PI * 10000 * i / SR), 8192);
      const inRms  = tailRms(inBuf, 4096);
      const outRms = tailRms(out,   4096);
      const dbErr = 20 * Math.log10(outRms / inRms);
      if (Math.abs(dbErr) > 0.1) return { pass: false, why: `err=${dbErr.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'unity magnitude across f ∈ {50, 500, 2k, 8k}: RMS preserved',
    run() {
      for (const f of [50, 500, 2000, 8000]) {
        const op = freshOp({ freq: 1000 });
        const { inBuf, out } = render(op, i => Math.sin(2 * Math.PI * f * i / SR), 8192);
        const inRms  = tailRms(inBuf, 4096);
        const outRms = tailRms(out,   4096);
        const dbErr = 20 * Math.log10(outRms / inRms);
        if (Math.abs(dbErr) > 0.15) return { pass: false, why: `f=${f}: err=${dbErr.toFixed(3)} dB` };
      }
      return { pass: true };
    },
  },

  // ---- DC & Nyquist --------------------------------------------------
  {
    name: 'DC: constant +1 passes to +1 at steady state',
    run() {
      const op = freshOp({ freq: 1000 });
      const { out } = render(op, 1, 4096);
      if (!approx(out[4095], 1, 1e-3)) return { pass: false, why: `out=${out[4095]}` };
      return { pass: true };
    },
  },
  {
    name: 'Nyquist: alternating ±1 input → output magnitude 1 (sign-flipped)',
    run() {
      const op = freshOp({ freq: 1000 });
      const { inBuf, out } = render(op, i => (i % 2 === 0 ? 1 : -1), 2048);
      // After settling, |out| should be 1 at every sample.
      for (let i = 1024; i < 2048; i++) {
        if (!approx(Math.abs(out[i]), 1, 1e-3)) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- phase shift is frequency-dependent ---------------------------
  {
    name: 'frequency retune changes phase: two different break freqs → different outputs',
    run() {
      const fSig = 1000;
      const a = render(freshOp({ freq:  500 }), i => Math.sin(2 * Math.PI * fSig * i / SR), 4096).out;
      const b = render(freshOp({ freq: 5000 }), i => Math.sin(2 * Math.PI * fSig * i / SR), 4096).out;
      // Outputs should have same RMS but different sample-by-sample values.
      let diffCount = 0;
      for (let i = 2048; i < 4096; i++) if (Math.abs(a[i] - b[i]) > 1e-3) diffCount++;
      if (diffCount < 1000) return { pass: false, why: `only ${diffCount}/2048 samples differ` };
      return { pass: true };
    },
  },
  {
    name: 'setParam(freq) takes effect on subsequent samples',
    run() {
      const op = freshOp({ freq: 1000 });
      const f1 = render(op, i => Math.sin(2 * Math.PI * 500 * i / SR), 4096).out;
      op.setParam('freq', 10000);
      const f2 = render(op, i => Math.sin(2 * Math.PI * 500 * i / SR), 4096).out;
      let diffCount = 0;
      for (let i = 2048; i < 4096; i++) if (Math.abs(f1[i] - f2[i]) > 1e-3) diffCount++;
      if (diffCount < 500) return { pass: false, why: `only ${diffCount}/2048 differ` };
      return { pass: true };
    },
  },

  // ---- no DC offset induced ------------------------------------------
  {
    name: 'sine input → near-zero DC mean (no asymmetric bias)',
    run() {
      const op = freshOp({ freq: 1000 });
      const { out } = render(op, i => Math.sin(2 * Math.PI * 100 * i / SR), 8 * SR);
      let s = 0;
      for (let i = 4 * SR; i < 8 * SR; i++) s += out[i];
      const mean = s / (4 * SR);
      if (Math.abs(mean) > 1e-3) return { pass: false, why: `mean=${mean}` };
      return { pass: true };
    },
  },

  // ---- reset --------------------------------------------------------
  {
    name: 'reset() clears x1 and y1 state',
    run() {
      const op = freshOp({ freq: 1000 });
      render(op, 1, 4096);
      op.reset();
      const { out } = render(op, 0, 1);
      if (out[0] !== 0) return { pass: false, why: `post-reset y[0]=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush -----------------------------------------------
  {
    name: 'denormal flush: tiny y1 state + zero input → state → 0',
    run() {
      const op = freshOp({ freq: 1000 });
      op._y1 = 1e-35;
      op._x1 = 0;
      render(op, 0, 32);
      if (op._y1 !== 0) return { pass: false, why: `y1=${op._y1}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ freq: 1000 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'freq > Nyquist still produces finite output',
    run() {
      const op = freshOp({ freq: 100000 });
      const { out } = render(op, 0.5, 512);
      for (let i = 0; i < 512; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- determinism --------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = render(freshOp({ freq: 1500 }), i => Math.sin(i * 0.01), 1024).out;
      const b = render(freshOp({ freq: 1500 }), i => Math.sin(i * 0.01), 1024).out;
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'allpass', tests };
