// op_dcBlock.test.js — real-math tests for op_dcBlock.
// Run via: node scripts/check_op_math.mjs
//
// Ship-gate: DC rejection under feedback (memory/ship_blockers.md).
// Tests cover: infinite DC attenuation (zero at z=1), sub-cutoff rolloff,
// mid-band unity pass, Nyquist near-unity, cutoff-param retune, reset
// clears state, denormal flush, defensive null input.

import { DcBlockOp } from './op_dcBlock.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DcBlockOp(SR);
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

function tailPeak(buf, skip) {
  let m = 0;
  for (let i = skip; i < buf.length; i++) if (Math.abs(buf[i]) > m) m = Math.abs(buf[i]);
  return m;
}

function tailRms(buf, skip) {
  let s = 0, n = 0;
  for (let i = skip; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

const tests = [
  // ---- DC rejection -------------------------------------------------
  {
    name: 'DC: constant input decays to zero',
    run() {
      const op = freshOp({ cutoff: 10 });
      const out = render(op, 0.5, 4 * SR);  // 4 seconds
      const peak = tailPeak(out, 3 * SR);
      if (peak > 1e-3) return { pass: false, why: `tail peak=${peak}` };
      return { pass: true };
    },
  },
  {
    name: 'DC step: output has zero at z=1 (DC gain = 0)',
    run() {
      // Drive constant +1 long enough that transient dies, verify settled.
      const op = freshOp({ cutoff: 10 });
      const out = render(op, 1, 5 * SR);
      const last = out[out.length - 1];
      if (Math.abs(last) > 1e-3) return { pass: false, why: `last=${last}` };
      return { pass: true };
    },
  },

  // ---- midband / Nyquist --------------------------------------------
  {
    name: 'midband (1 kHz sine): passes at ≈ unity amplitude',
    run() {
      const op = freshOp({ cutoff: 10 });
      const out = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR), 4096);
      const rms = tailRms(out, 2048);
      const expected = 1 / Math.sqrt(2);  // RMS of unit-amplitude sine
      if (!approx(rms, expected, 0.01)) return { pass: false, why: `rms=${rms} expected ≈${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'Nyquist (alternating ±1): passes near-unity',
    run() {
      const op = freshOp({ cutoff: 10 });
      const out = render(op, i => (i % 2 === 0 ? 1 : -1), 4096);
      const peak = tailPeak(out, 2048);
      // Nyquist gain = 2/(1+R); R≈0.999, so gain ≈ 1.0.
      if (peak < 0.95 || peak > 2.05) return { pass: false, why: `peak=${peak}` };
      return { pass: true };
    },
  },

  // ---- sub-cutoff rolloff -------------------------------------------
  {
    name: 'sub-cutoff sine (1 Hz) attenuated vs midband (1 kHz)',
    run() {
      const opLow  = freshOp({ cutoff: 10 });
      const opMid  = freshOp({ cutoff: 10 });
      const low  = render(opLow,  i => Math.sin(2 * Math.PI *   1 * i / SR), 8 * SR);
      const mid  = render(opMid,  i => Math.sin(2 * Math.PI * 1000 * i / SR), 8 * SR);
      const lowRms = tailRms(low, 4 * SR);
      const midRms = tailRms(mid, 4 * SR);
      // 1 Hz is decade below 10 Hz cutoff → expect ≥ 20 dB attenuation vs midband.
      const attDb = 20 * Math.log10(lowRms / midRms);
      if (attDb > -20) return { pass: false, why: `att=${attDb.toFixed(1)} dB, expected ≤ -20` };
      return { pass: true };
    },
  },

  // ---- cutoff retune ------------------------------------------------
  {
    name: 'higher cutoff rejects more low-mid (cutoff=100 kills 50 Hz > cutoff=10)',
    run() {
      const op10  = freshOp({ cutoff: 10  });
      const op100 = freshOp({ cutoff: 100 });
      const out10  = render(op10,  i => Math.sin(2 * Math.PI * 50 * i / SR), 4 * SR);
      const out100 = render(op100, i => Math.sin(2 * Math.PI * 50 * i / SR), 4 * SR);
      const rms10  = tailRms(out10,  2 * SR);
      const rms100 = tailRms(out100, 2 * SR);
      if (!(rms100 < rms10)) return { pass: false, why: `rms100=${rms100} not < rms10=${rms10}` };
      return { pass: true };
    },
  },
  {
    name: 'setParam(cutoff) takes effect on subsequent samples',
    run() {
      const op = freshOp({ cutoff: 10 });
      render(op, 0, 1024);   // settle
      op.setParam('cutoff', 100);
      // Feed DC after cutoff change — should still decay (DC gain = 0 regardless).
      const out = render(op, 1, 4 * SR);
      const peak = tailPeak(out, 2 * SR);
      if (peak > 1e-3) return { pass: false, why: `tail peak=${peak}` };
      return { pass: true };
    },
  },

  // ---- transient / impulse ------------------------------------------
  {
    name: 'impulse response: y[0] = 1 for unit impulse (b0 = 1)',
    run() {
      const op = freshOp({ cutoff: 10 });
      const inBuf = new Float32Array(64);
      inBuf[0] = 1;
      const out = new Float32Array(64);
      op.process({ in: inBuf }, { out }, 64);
      if (!approx(out[0], 1, 1e-9)) return { pass: false, why: `y[0]=${out[0]}` };
      // y[1] = 0 - 1 + R*1 = R - 1 (small negative).
      const expected1 = Math.exp(-2 * Math.PI * 10 / SR) - 1;
      if (!approx(out[1], expected1, 1e-6)) return { pass: false, why: `y[1]=${out[1]} expected ${expected1}` };
      return { pass: true };
    },
  },

  // ---- reset / state --------------------------------------------------
  {
    name: 'reset() clears x1 and y1 state',
    run() {
      const op = freshOp({ cutoff: 10 });
      render(op, 1, 4096);   // accumulate state
      op.reset();
      const inBuf = new Float32Array(1); inBuf[0] = 1;
      const out   = new Float32Array(1);
      op.process({ in: inBuf }, { out }, 1);
      // y[0] on fresh state = 1 - 0 + R*0 = 1.
      if (!approx(out[0], 1, 1e-9)) return { pass: false, why: `post-reset y[0]=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush -----------------------------------------------
  {
    name: 'denormal flush: tiny state + zero input → state → 0',
    run() {
      const op = freshOp({ cutoff: 10 });
      op._y1 = 1e-35;
      op._x1 = 0;
      render(op, 0, 16);
      if (op._y1 !== 0) return { pass: false, why: `y1=${op._y1}, expected flushed to 0` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ cutoff: 10 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'cutoff clamp: cutoff > Nyquist still produces finite output',
    run() {
      const op = freshOp({ cutoff: 100000 });
      const out = render(op, 0.5, 512);
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- determinism --------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = render(freshOp({ cutoff: 10 }), i => Math.sin(2 * Math.PI * 100 * i / SR), 2048);
      const b = render(freshOp({ cutoff: 10 }), i => Math.sin(2 * Math.PI * 100 * i / SR), 2048);
      for (let i = 0; i < 2048; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'dcBlock', tests };
