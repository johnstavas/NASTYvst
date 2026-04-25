// op_chamberlinZeroCross.test.js — real-math tests for sign-magnitude
// DAC character simulator.
// Run via: node scripts/check_op_math.mjs

import { ChamberlinZeroCrossOp } from './op_chamberlinZeroCross.worklet.js';

const SR = 48000;
const N  = 1024;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new ChamberlinZeroCrossOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input) {
  const out = new Float32Array(input.length);
  op.process({ in: input }, { out }, input.length);
  return out;
}

const tests = [
  // ---- dead zone --------------------------------------------------------
  {
    name: 'dead zone: |x| < dz → 0; |x| ≥ dz → x (passthrough outside DZ)',
    run() {
      const dz = 0.01;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = (i - N/2) / (N/2) * 0.2;  // -0.2..+0.2 ramp
      const out = render(freshOp({ deadZone: dz, glitch: 0 }), inp);
      for (let i = 0; i < N; i++) {
        const ax = Math.abs(inp[i]);
        // Zero crossings produce glitches; with glitch=0 the only
        // effect is dead zone → on slow linear ramp, only the sign-
        // change sample gets crossed over (prev<0 → x≥0) and that's
        // when glitch would fire. glitch=0 so no spike. Just check DZ.
        if (ax < dz) {
          if (out[i] !== 0) return { pass: false, why: `i=${i} x=${inp[i]} → ${out[i]} (should be 0)` };
        } else {
          if (!approx(out[i], inp[i], 1e-6)) return { pass: false, why: `i=${i} x=${inp[i]} → ${out[i]} (should pass)` };
        }
      }
      return { pass: true };
    },
  },

  // ---- zero-crossing spike ---------------------------------------------
  {
    name: 'zero crossing: one-sample spike of amplitude +glitch when x goes − → +',
    run() {
      const gl = 0.3;
      const inp = new Float32Array(16);
      // Negative then positive, with dz tiny so DZ doesn't kick in
      inp[0] = -0.4; inp[1] = -0.3; inp[2] = -0.2; inp[3] = -0.1;
      inp[4] = 0.1;   // sign flip here
      inp[5] = 0.2; inp[6] = 0.3; inp[7] = 0.4;
      const out = render(freshOp({ deadZone: 0, glitch: gl }), inp);
      // At the first positive sample, we expect spike added: x + gl*(+1) = 0.1 + 0.3 = 0.4
      if (!approx(out[4], 0.4, 1e-5)) return { pass: false, why: `i=4 out=${out[4]} expected 0.4` };
      // Neighboring samples unchanged (no further sign changes)
      if (!approx(out[5], 0.2, 1e-5)) return { pass: false, why: `i=5 out=${out[5]} expected 0.2` };
      if (!approx(out[3], -0.1, 1e-5)) return { pass: false, why: `i=3 out=${out[3]} expected -0.1` };
      return { pass: true };
    },
  },
  {
    name: 'zero crossing: + → − produces negative spike',
    run() {
      const inp = new Float32Array(8);
      inp[0] = 0.3; inp[1] = 0.1;
      inp[2] = -0.1;  // + → −
      inp[3] = -0.3;
      const out = render(freshOp({ deadZone: 0, glitch: 0.2 }), inp);
      // -0.1 + (-0.2) = -0.3
      if (!approx(out[2], -0.3, 1e-5)) return { pass: false, why: `out[2]=${out[2]} expected -0.3` };
      return { pass: true };
    },
  },

  // ---- no spurious spikes ---------------------------------------------
  {
    name: 'DC-offset sine (no zero crossings) → dead-zone only, no spikes',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 + Math.sin(2 * Math.PI * 200 * i / SR) * 0.3;  // 0.2..0.8
      const out = render(freshOp({ deadZone: 0.001, glitch: 0.3 }), inp);
      // No sample should differ from input by anywhere near glitch amount
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i] - inp[i]) > 0.01) return { pass: false, why: `i=${i} diff=${out[i]-inp[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- spike count equals crossing count -------------------------------
  {
    name: 'pure sine: 1 spike per zero crossing',
    run() {
      const freq = 440;
      const duration = 1;
      const nSamples = Math.round(SR * duration);
      const inp = new Float32Array(nSamples);
      for (let i = 0; i < nSamples; i++) inp[i] = Math.sin(2 * Math.PI * freq * i / SR) * 0.5;
      const out = render(freshOp({ deadZone: 0, glitch: 0.3 }), inp);
      // Count samples where |out - in| >= 0.2 (spike threshold)
      let spikes = 0;
      for (let i = 0; i < nSamples; i++) if (Math.abs(out[i] - inp[i]) > 0.2) spikes++;
      // 440 Hz for 1s → 880 zero crossings (2 per cycle). Allow off-by-small.
      if (spikes < 870 || spikes > 890) return { pass: false, why: `spikes=${spikes} expected ≈880` };
      return { pass: true };
    },
  },

  // ---- determinism ------------------------------------------------------
  {
    name: 'no-state-drift: two fresh ops on same input produce identical output',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.2) * 0.4;
      const a = render(freshOp({ deadZone: 0.001, glitch: 0.1 }), inp);
      const b = render(freshOp({ deadZone: 0.001, glitch: 0.1 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- reset ------------------------------------------------------------
  {
    name: 'reset() clears prev-sign tracking',
    run() {
      const op = freshOp({ deadZone: 0, glitch: 0.3 });
      const pos = new Float32Array(4); pos.fill(0.5);
      const neg = new Float32Array(4); neg.fill(-0.5);
      // Seed prev=-0.5 via processing neg first
      render(op, neg);
      // Now reset: prev should go to 0, so first positive sample should
      // NOT trigger a spike (0 → 0.5 is not a sign change per our rule:
      // only when both signs are nonzero).
      op.reset();
      const out = render(op, pos);
      if (!approx(out[0], 0.5, 1e-6)) return { pass: false, why: `out[0]=${out[0]} expected 0.5 (no spike after reset)` };
      return { pass: true };
    },
  },

  // ---- clamps -----------------------------------------------------------
  {
    name: 'deadZone out-of-range clamped; no NaN',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1);
      const op = freshOp({});
      op.setParam('deadZone', -5);    // → 0
      op.setParam('deadZone', 99);    // → 0.5
      op.setParam('glitch',   -5);    // → 0
      op.setParam('glitch',   99);    // → 1
      const out = render(op, inp);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → zeros',
    run() {
      const op = freshOp({ deadZone: 0.001, glitch: 0.1 });
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
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },

  // ---- latency ----------------------------------------------------------
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },

  // ---- bounded ---------------------------------------------------------
  {
    name: 'output bounded: |y| ≤ |x| + glitch for all samples',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2*Math.PI*500*i/SR) * 0.9;
      const out = render(freshOp({ deadZone: 0.001, glitch: 0.2 }), inp);
      for (let i = 0; i < N; i++) {
        const bound = Math.abs(inp[i]) + 0.2 + 1e-5;
        if (Math.abs(out[i]) > bound) return { pass: false, why: `i=${i}: |${out[i]}| > ${bound}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'chamberlinZeroCross', tests };
