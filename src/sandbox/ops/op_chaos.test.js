// op_chaos.test.js — SC Logistic-map chaos.

import { ChaosOp } from './op_chaos.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new ChaosOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, N) {
  const out = new Float32Array(N);
  op.process({}, { out }, N);
  return out;
}

const EPS = 1e-5;
function eq(a, b) { return Math.abs(a - b) < EPS; }

const tests = [
  {
    name: 'output finite + bounded across r ∈ [2.5, 4.0]',
    run() {
      for (const r of [2.5, 3.0, 3.57, 3.8, 3.99, 4.0]) {
        for (const mode of [0, 1]) {
          const out = render(freshOp({ r, freq: 24000, mode, level: 1 }), 4096);
          for (let i = 0; i < out.length; i++) {
            if (!Number.isFinite(out[i])) return { pass: false, why: `r=${r} m=${mode} i=${i}` };
            const cap = mode === 1 ? 1.0001 : 1.0001;
            if (Math.abs(out[i]) > cap) return { pass: false, why: `r=${r} m=${mode} out=${out[i]}` };
          }
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'unipolar mode (mode=0): output ∈ [0, 1]',
    run() {
      const out = render(freshOp({ r: 3.99, freq: 24000, mode: 0 }), 4096);
      for (let i = 0; i < out.length; i++) {
        if (out[i] < -EPS || out[i] > 1 + EPS) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bipolar mode (mode=1): output ∈ [-1, 1] with samples on both sides',
    run() {
      const out = render(freshOp({ r: 3.99, freq: 24000, mode: 1 }), 4096);
      let neg = 0, pos = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i] < 0) neg++;
        if (out[i] > 0) pos++;
      }
      if (neg < 100 || pos < 100) return { pass: false, why: `neg=${neg} pos=${pos}` };
      return { pass: true };
    },
  },
  {
    name: 'r=3.0, y0=0.5: hits fixed-point ≈ 1 - 1/r = 0.6667 quickly',
    run() {
      // For r ∈ (1, 3) the map converges to fixed point 1 - 1/r.
      // y0=0.5, r=3 oscillates near fixed point at 2/3.
      const out = render(freshOp({ r: 2.99, freq: 24000, mode: 0 }), 4096);
      // sample a few late values: mean should be near 1 - 1/2.99 ≈ 0.6655
      let s = 0; const M = 1024;
      for (let i = out.length - M; i < out.length; i++) s += out[i];
      const mean = s / M;
      const expected = 1 - 1 / 2.99;
      if (Math.abs(mean - expected) > 0.05) return { pass: false, why: `mean=${mean} expected≈${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'r=3.99 produces non-periodic (chaotic) output',
    run() {
      const out = render(freshOp({ r: 3.99, freq: 24000, mode: 0 }), 4096);
      // Check no short period: late samples shouldn't equal early samples.
      // Compare blocks of 64 samples 1024 apart.
      let matches = 0;
      for (let i = 0; i < 64; i++) {
        if (Math.abs(out[2000 + i] - out[3000 + i]) < 1e-6) matches++;
      }
      if (matches > 8) return { pass: false, why: `matches=${matches} (looks periodic)` };
      return { pass: true };
    },
  },
  {
    name: 'sub-audio rate freq=100 Hz produces stair-step (held) output',
    run() {
      const period = Math.round(SR / 100);  // ~480 samples per step
      const op = freshOp({ r: 3.99, freq: 100, mode: 0 });
      const out = render(op, 4 * period);
      // Output should be piecewise-constant: many adjacent equal samples.
      let runLen = 1, maxRun = 0;
      for (let i = 1; i < out.length; i++) {
        if (out[i] === out[i-1]) runLen++;
        else { if (runLen > maxRun) maxRun = runLen; runLen = 1; }
      }
      if (maxRun < period - 5) return { pass: false, why: `maxRun=${maxRun} (expected ~${period})` };
      return { pass: true };
    },
  },
  {
    name: 'level=0 → silence',
    run() {
      const out = render(freshOp({ r: 3.99, freq: 100, level: 0 }), 1024);
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'level=0.5 halves output',
    run() {
      const a = render(freshOp({ r: 3.99, freq: 1000, mode: 0, level: 1   }), 4096);
      const b = render(freshOp({ r: 3.99, freq: 1000, mode: 0, level: 0.5 }), 4096);
      for (let i = 0; i < 4096; i++) {
        if (Math.abs(b[i] - a[i] * 0.5) > 1e-5) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops identical',
    run() {
      const a = render(freshOp({ r: 3.99, freq: 24000 }), 2048);
      const b = render(freshOp({ r: 3.99, freq: 24000 }), 2048);
      for (let i = 0; i < 2048; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() restores y to y0',
    run() {
      const op = freshOp({ r: 3.99, freq: 24000, y0: 0.5 });
      const before = render(op, 256);
      op.reset();
      const after = render(op, 256);
      for (let i = 0; i < 256; i++) if (before[i] !== after[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'different y0 produces different output (sensitive to init)',
    run() {
      const a = render(freshOp({ r: 3.99, freq: 24000, y0: 0.5  }), 1024);
      const b = render(freshOp({ r: 3.99, freq: 24000, y0: 0.51 }), 1024);
      let diffs = 0;
      for (let i = 0; i < 1024; i++) if (Math.abs(a[i] - b[i]) > 1e-5) diffs++;
      // Butterfly effect: trajectories should diverge within tens of iterations.
      if (diffs < 500) return { pass: false, why: `diffs=${diffs}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: N one-shot == two half-blocks',
    run() {
      const op1 = freshOp({ r: 3.99, freq: 1000 });
      const op2 = freshOp({ r: 3.99, freq: 1000 });
      const N = 1024;
      const full = render(op1, N);
      const a = new Float32Array(N/2), b = new Float32Array(N/2);
      op2.process({}, { out: a }, N/2);
      op2.process({}, { out: b }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(full[i]       - a[i]) > 1e-6) return { pass: false, why: `A i=${i}` };
        if (Math.abs(full[i + N/2] - b[i]) > 1e-6) return { pass: false, why: `B i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: NaN / out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('r', 999); op.setParam('r', -999); op.setParam('r', NaN);
      op.setParam('freq', 1e9); op.setParam('freq', -1e9); op.setParam('freq', NaN);
      op.setParam('y0', 999); op.setParam('y0', -1); op.setParam('y0', NaN);
      op.setParam('mode', 99); op.setParam('mode', NaN);
      op.setParam('level', 999); op.setParam('level', NaN);
      const out = render(op, 256);
      for (let i = 0; i < 256; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false };
      return { pass: true };
    },
  },
];

export default { opId: 'chaos', tests };
