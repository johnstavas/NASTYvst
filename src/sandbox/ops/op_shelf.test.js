// op_shelf.test.js — real-math tests for op_shelf.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_filters.md §9 (RBJ shelving
// cookbook). Tests cover: gainDb=0 → unity passthrough (bypass contract),
// low shelf boost lifts LF / leaves HF untouched, low shelf cut inverse,
// high shelf symmetric behavior, plateau gain equals gainDb at DC/Nyquist,
// frequency retune, reset clears state, denormal flush, defensive null.

import { ShelfOp } from './op_shelf.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new ShelfOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return out;
}

function tailRms(buf, skip) {
  let s = 0, n = 0;
  for (let i = skip; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

const tests = [
  // ---- bypass contract (gainDb=0) -----------------------------------
  {
    name: 'gainDb=0 (low): output ≈ input (bypass contract)',
    run() {
      const op = freshOp({ mode: 'low', freq: 200, gainDb: 0 });
      const out = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR), 4096);
      // Allow settling transient.
      for (let i = 512; i < out.length; i++) {
        const ref = Math.sin(2 * Math.PI * 1000 * i / SR);
        if (Math.abs(out[i] - ref) > 1e-4) return { pass: false, why: `i=${i}: ${out[i]} vs ${ref}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'gainDb=0 (high): output ≈ input (bypass contract)',
    run() {
      const op = freshOp({ mode: 'high', freq: 5000, gainDb: 0 });
      const out = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR), 4096);
      for (let i = 512; i < out.length; i++) {
        const ref = Math.sin(2 * Math.PI * 1000 * i / SR);
        if (Math.abs(out[i] - ref) > 1e-4) return { pass: false, why: `i=${i}: ${out[i]} vs ${ref}` };
      }
      return { pass: true };
    },
  },

  // ---- low shelf boost ----------------------------------------------
  {
    name: 'low shelf +12 dB: 50 Hz lifted ≈ +12 dB',
    run() {
      const op = freshOp({ mode: 'low', freq: 500, gainDb: 12 });
      const out = render(op, i => Math.sin(2 * Math.PI * 50 * i / SR), 4 * SR);
      const rms = tailRms(out, 2 * SR);
      const expected = (1 / Math.sqrt(2)) * Math.pow(10, 12 / 20);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.3) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'low shelf +12 dB: 10 kHz untouched (≈ 0 dB)',
    run() {
      const op = freshOp({ mode: 'low', freq: 200, gainDb: 12 });
      const out = render(op, i => Math.sin(2 * Math.PI * 10000 * i / SR), 8192);
      const rms = tailRms(out, 4096);
      const expected = 1 / Math.sqrt(2);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.5) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'low shelf −12 dB: 50 Hz attenuated ≈ −12 dB',
    run() {
      const op = freshOp({ mode: 'low', freq: 500, gainDb: -12 });
      const out = render(op, i => Math.sin(2 * Math.PI * 50 * i / SR), 4 * SR);
      const rms = tailRms(out, 2 * SR);
      const expected = (1 / Math.sqrt(2)) * Math.pow(10, -12 / 20);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.3) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },

  // ---- high shelf ----------------------------------------------------
  {
    name: 'high shelf +12 dB: 15 kHz lifted ≈ +12 dB',
    run() {
      const op = freshOp({ mode: 'high', freq: 5000, gainDb: 12 });
      const out = render(op, i => Math.sin(2 * Math.PI * 15000 * i / SR), 8192);
      const rms = tailRms(out, 4096);
      const expected = (1 / Math.sqrt(2)) * Math.pow(10, 12 / 20);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.5) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'high shelf +12 dB: 100 Hz untouched (≈ 0 dB)',
    run() {
      const op = freshOp({ mode: 'high', freq: 5000, gainDb: 12 });
      const out = render(op, i => Math.sin(2 * Math.PI * 100 * i / SR), 4 * SR);
      const rms = tailRms(out, 2 * SR);
      const expected = 1 / Math.sqrt(2);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.5) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'high shelf −12 dB: 15 kHz attenuated ≈ −12 dB',
    run() {
      const op = freshOp({ mode: 'high', freq: 5000, gainDb: -12 });
      const out = render(op, i => Math.sin(2 * Math.PI * 15000 * i / SR), 8192);
      const rms = tailRms(out, 4096);
      const expected = (1 / Math.sqrt(2)) * Math.pow(10, -12 / 20);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.5) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },

  // ---- frequency retune ----------------------------------------------
  {
    name: 'low shelf higher freq boosts more of the band (1 kHz vs 200 Hz corner, +12 dB)',
    run() {
      const opLo = freshOp({ mode: 'low', freq: 200,  gainDb: 12 });
      const opHi = freshOp({ mode: 'low', freq: 1000, gainDb: 12 });
      const a = render(opLo, i => Math.sin(2 * Math.PI * 400 * i / SR), 4 * SR);
      const b = render(opHi, i => Math.sin(2 * Math.PI * 400 * i / SR), 4 * SR);
      const rmsA = tailRms(a, 2 * SR);
      const rmsB = tailRms(b, 2 * SR);
      if (!(rmsB > rmsA)) return { pass: false, why: `rmsA=${rmsA} !< rmsB=${rmsB}` };
      return { pass: true };
    },
  },
  {
    name: 'setParam(gainDb) takes effect on subsequent samples',
    run() {
      const op = freshOp({ mode: 'low', freq: 500, gainDb: 0 });
      render(op, i => Math.sin(2 * Math.PI * 50 * i / SR), 4096);  // settle at 0 dB
      op.setParam('gainDb', 12);
      const out = render(op, i => Math.sin(2 * Math.PI * 50 * i / SR), 4 * SR);
      const rms = tailRms(out, 2 * SR);
      const expected = (1 / Math.sqrt(2)) * Math.pow(10, 12 / 20);
      const dbErr = 20 * Math.log10(rms / expected);
      if (Math.abs(dbErr) > 0.5) return { pass: false, why: `err=${dbErr.toFixed(2)} dB` };
      return { pass: true };
    },
  },

  // ---- reset ---------------------------------------------------------
  {
    name: 'reset() clears filter state',
    run() {
      const op = freshOp({ mode: 'low', freq: 200, gainDb: 12 });
      render(op, 1, 4096);  // accumulate state
      op.reset();
      const inBuf = new Float32Array(1); inBuf[0] = 0;
      const out   = new Float32Array(1);
      op.process({ in: inBuf }, { out }, 1);
      // Fresh state + zero input → zero output.
      if (!approx(out[0], 0, 1e-9)) return { pass: false, why: `post-reset y[0]=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush ------------------------------------------------
  {
    name: 'denormal flush: tiny state + zero input → state → 0',
    run() {
      const op = freshOp({ mode: 'low', freq: 200, gainDb: 6 });
      op._y1 = 1e-35; op._y2 = 1e-35;
      render(op, 0, 32);
      if (op._y1 !== 0) return { pass: false, why: `y1=${op._y1}, expected 0` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ mode: 'low', freq: 200, gainDb: 6 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'freq > Nyquist still produces finite output',
    run() {
      const op = freshOp({ mode: 'high', freq: 100000, gainDb: 6 });
      const out = render(op, 0.5, 512);
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- determinism ---------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = render(freshOp({ mode: 'low', freq: 200, gainDb: 6 }), i => Math.sin(2 * Math.PI * 100 * i / SR), 2048);
      const b = render(freshOp({ mode: 'low', freq: 200, gainDb: 6 }), i => Math.sin(2 * Math.PI * 100 * i / SR), 2048);
      for (let i = 0; i < 2048; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'shelf', tests };
