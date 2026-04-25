// op_tubeSim.test.js — math tests for #113 Koren triode model.
// Run via: node scripts/check_op_math.mjs

import { TubeSimOp } from './op_tubeSim.worklet.js';

const SR = 48000;
const N  = 2048;

function freshOp(params = {}) {
  const op = new TubeSimOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input) {
  const out = new Float32Array(input.length);
  op.process({ in: input }, { out }, input.length);
  return out;
}
function sine(freq, n, amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.sin(2 * Math.PI * freq * i / SR) * amp;
  return b;
}
function rms(buf, start = 0) {
  let s = 0, cnt = 0;
  for (let i = start; i < buf.length; i++) { s += buf[i] * buf[i]; cnt++; }
  return Math.sqrt(s / cnt);
}
function dcOffset(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  return s / buf.length;
}

const tests = [
  {
    name: 'silence → silence (quiescent subtracted)',
    run() {
      const out = render(freshOp({}), new Float32Array(N));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'Koren eq.4 at EG=0: known value for 12AX7 defaults',
    run() {
      // Manually compute Koren for EG=0, EP=250, μ=100, X=1.4, kG1=1060, kP=600, kVB=300:
      //   inner = 600·(1/100 + 0/sqrt(300 + 62500)) = 600·0.01 = 6
      //   softplus = log(1 + e^6) ≈ 6.00248
      //   E1 = (250/600)·6.00248 ≈ 2.5010
      //   IP = (2.5010^1.4 / 1060)·2 ≈ 6.66e-3
      const op = freshOp({ bias: 0, drive: 0, trim: 1 });
      // With bias=0 and drive=0, input x=0 gives EG=0 which equals the quiescent,
      // so output IS zero (ip - ip0) with ip0 = koren(0). Good — that's the null.
      // Test: set bias=1 (quiescent EG=-1), inject constant DC so EG=0.
      const op2 = freshOp({ bias: 1, drive: 1, trim: 1 });
      const dc = new Float32Array(N); dc.fill(1.0); // x=1 with drive=1 and bias=1 → EG = -1 + 1 = 0
      const out = render(op2, dc);
      // Compute expected:
      const inner = 600 * (1/100 + 0/Math.sqrt(300 + 250*250));
      const softplus = Math.log(1 + Math.exp(inner));
      const E1 = (250/600) * softplus;
      const ip_eg0 = (Math.pow(E1, 1.4) / 1060) * 2;
      const inner0 = 600 * (1/100 + (-1)/Math.sqrt(300 + 250*250));
      const softplus0 = Math.log(1 + Math.exp(inner0));
      const E1_0 = (250/600) * softplus0;
      const ip0 = E1_0 > 0 ? (Math.pow(E1_0, 1.4) / 1060) * 2 : 0;
      const expected = (ip_eg0 - ip0) * (1060 / 400) * 1;
      const got = out[N-1]; // steady state
      if (Math.abs(got - expected) > 1e-4) return { pass: false, why: `got=${got.toExponential(3)} expected=${expected.toExponential(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'asymmetric saturation: positive and negative peak RMS differ',
    run() {
      // A tube model should NOT be perfectly symmetric. Feed a sine,
      // measure pos-half RMS vs neg-half RMS.
      const op = freshOp({ drive: 2.0, bias: 1.5 });
      const inp = sine(1000, N, 0.8);
      const out = render(op, inp);
      let rmsPos = 0, cntP = 0, rmsNeg = 0, cntN = 0;
      for (let i = 512; i < N; i++) {
        if (out[i] > 0) { rmsPos += out[i]*out[i]; cntP++; }
        else if (out[i] < 0) { rmsNeg += out[i]*out[i]; cntN++; }
      }
      rmsPos = Math.sqrt(rmsPos / Math.max(cntP,1));
      rmsNeg = Math.sqrt(rmsNeg / Math.max(cntN,1));
      // Asymmetry should be measurable
      if (Math.abs(rmsPos - rmsNeg) / Math.max(rmsPos, rmsNeg) < 0.05) {
        return { pass: false, why: `rmsPos=${rmsPos.toFixed(4)} rmsNeg=${rmsNeg.toFixed(4)} — too symmetric` };
      }
      return { pass: true };
    },
  },
  {
    name: 'negative-cutoff hard clip: large negative input → output floor',
    run() {
      // Strong negative grid swing drives EG well past -bias, into cutoff.
      // Output should floor (flat at -ip0·gain) — not overshoot.
      const op = freshOp({ drive: 5.0, bias: 1.0 });
      const dc = new Float32Array(N); dc.fill(-1.0); // EG = -1 - 5 = -6, deep cutoff
      const out = render(op, dc);
      // After settle, output should be constant
      const a = out[N-10], b = out[N-1];
      if (Math.abs(a - b) > 1e-6) return { pass: false, why: `not settled: ${a} vs ${b}` };
      // Should be negative (cutoff reduces plate current below quiescent)
      if (a >= 0) return { pass: false, why: `expected negative cutoff floor, got ${a}` };
      return { pass: true };
    },
  },
  {
    name: 'negative-half clipping: peak-negative saturates with drive',
    run() {
      // At high drive, negative half of sine clips to cutoff floor while
      // positive half keeps growing. So peak-to-peak doesn't scale with
      // drive — the neg peak is pinned. Measure: neg peak should be
      // bounded as drive increases.
      const op2 = freshOp({ drive: 2, bias: 1.5 });
      const op8 = freshOp({ drive: 8, bias: 1.5 });
      const inp = sine(1000, N, 0.8);
      const o2 = render(op2, inp);
      const o8 = render(op8, inp);
      let minO2 = Infinity, minO8 = Infinity;
      for (let i = 512; i < N; i++) {
        if (o2[i] < minO2) minO2 = o2[i];
        if (o8[i] < minO8) minO8 = o8[i];
      }
      // Neg-peak ratio should be far less than drive ratio (4×)
      // — that's the cutoff saturation.
      const ratio = minO8 / minO2;
      if (!(ratio < 2.0)) return { pass: false, why: `neg-peak ratio=${ratio.toFixed(3)} expected <2 (drive ratio is 4)` };
      return { pass: true };
    },
  },
  {
    name: 'finite + bounded under extreme params',
    run() {
      const op = freshOp({ drive: 20, bias: 5, plateV: 500, mu: 200, ex: 2, kg1: 100 });
      const inp = sine(500, N, 0.99);
      const out = render(op, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
        if (Math.abs(out[i]) > 50) return { pass: false, why: `i=${i}: ${out[i]} (unbounded)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'softplus overflow guard: inner > 30 stays finite',
    run() {
      // Push kp·(1/μ + EG/sqrt(…)) > 30 to exercise the inner>30 branch.
      // With default μ=100, kp=600 → 1/μ·kp=6. Need EG/sqrt(kvb+EP²)·kp > 24
      // i.e. EG > 24·sqrt(kvb+EP²)/kp ≈ 24·250/600 ≈ 10V.
      const op = freshOp({ drive: 20, bias: 0 });
      const dc = new Float32Array(N); dc.fill(1.0); // EG = 20
      const out = render(op, dc);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const inp = sine(440, N, 0.5);
      const a = render(freshOp({ drive: 2, bias: 1 }), inp);
      const b = render(freshOp({ drive: 2, bias: 1 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('drive', 999); op.setParam('drive', -5);
      op.setParam('bias',  999); op.setParam('bias',  -5);
      op.setParam('plateV', 1e6); op.setParam('plateV', -5);
      op.setParam('mu', 1e6); op.setParam('mu', -5);
      op.setParam('ex', 999); op.setParam('ex', -5);
      op.setParam('kg1', 1e9); op.setParam('kg1', -5);
      op.setParam('kp', 1e9); op.setParam('kp', -5);
      op.setParam('kvb', 1e9); op.setParam('kvb', -5);
      op.setParam('trim', 999); op.setParam('trim', -5);
      op.setParam('drive', NaN);
      const out = render(op, sine(500, N, 0.3));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'trim=0 → silence',
    run() {
      const op = freshOp({ drive: 3, trim: 0 });
      const out = render(op, sine(440, N, 0.5));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'drive=0 → silence (grid stuck at -bias, no deviation)',
    run() {
      const op = freshOp({ drive: 0, bias: 1.5 });
      const out = render(op, sine(440, N, 0.9));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() is no-op (memoryless op)',
    run() {
      const op = freshOp({ drive: 2, bias: 1 });
      render(op, sine(500, N, 0.5));
      op.reset();
      const out = render(op, new Float32Array(32));
      for (let i = 0; i < 32; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence',
    run() {
      const op = freshOp({});
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, 128); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
];

export default { opId: 'tubeSim', tests };
