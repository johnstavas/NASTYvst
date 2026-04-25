// op_slew.test.js — real-math tests for op_slew.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Linear rate limit. step_up = 1/(riseMs·sr/1000), step_down = 1/(fallMs·sr/1000).
//   |delta| > step → y advances by ±step.
//   |delta| ≤ step → y snaps to target (sharp corner, no exponential tail).
//   Asymmetric rise/fall supported.
//   Missing input → glide toward 0 at fall rate.

import { SlewOp } from './op_slew.worklet.js';

const SR = 48000;

function freshOp(rise = 10, fall = 50) {
  const op = new SlewOp(SR);
  op.reset();
  op.setParam('riseMs', rise);
  op.setParam('fallMs', fall);
  return op;
}

function run(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return out;
}

const tests = [
  {
    name: 'step input → linear ramp up at step_up rate',
    run() {
      const riseMs = 10;
      const op = freshOp(riseMs, 50);
      const expectedStep = 1 / (riseMs * SR * 0.001);
      const N = 64;
      const out = run(op, 1.0, N);
      // First sample: y was 0, target 1, delta=1 >> step → y += step.
      if (Math.abs(out[0] - expectedStep) > 1e-7) {
        return { pass: false, why: `out[0]=${out[0]} expected ${expectedStep}` };
      }
      // Sample k: y = (k+1) * step, until it reaches 1.
      for (let k = 0; k < N; k++) {
        const expected = Math.min((k + 1) * expectedStep, 1.0);
        if (Math.abs(out[k] - expected) > 1e-6) {
          return { pass: false, why: `k=${k} out=${out[k]} expected=${expected}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'step input → reaches target in ceil(riseMs·sr/1000) samples',
    run() {
      const riseMs = 10;
      const op = freshOp(riseMs, 50);
      const expectedSamples = Math.ceil(riseMs * SR * 0.001);  // 480
      const out = run(op, 1.0, expectedSamples + 4);
      // By sample expectedSamples-1, y should be 1 (or within one step).
      const step = 1 / (riseMs * SR * 0.001);
      if (out[expectedSamples - 1] < 1 - step * 1.5) {
        return { pass: false, why: `at N-1=${expectedSamples - 1} y=${out[expectedSamples - 1]} not near 1` };
      }
      // By sample expectedSamples+1, y must be exactly 1 (snap branch hit).
      if (Math.abs(out[expectedSamples + 1] - 1) > 1e-7) {
        return { pass: false, why: `after rise y=${out[expectedSamples + 1]}, expected 1` };
      }
      return { pass: true };
    },
  },
  {
    name: 'asymmetric: fall slower than rise',
    run() {
      const riseMs = 10;
      const fallMs = 50;  // 5× slower
      const op = freshOp(riseMs, fallMs);
      // Charge to 1.
      run(op, 1.0, 600);
      // Now drop target to 0.
      const stepDown = 1 / (fallMs * SR * 0.001);
      const out = run(op, 0.0, 64);
      // First sample: y was 1, target 0, delta=-1 < -stepDown → y -= stepDown.
      const expect0 = 1 - stepDown;
      if (Math.abs(out[0] - expect0) > 1e-6) {
        return { pass: false, why: `out[0]=${out[0]} expected ${expect0}` };
      }
      // After 64 samples, should still be nowhere near 0 (since fall is slow).
      if (out[63] < 0.9) {
        return { pass: false, why: `fall too fast: out[63]=${out[63]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'within-rate delta snaps to target (no exponential tail)',
    run() {
      const riseMs = 10;
      const op = freshOp(riseMs, 10);
      const step = 1 / (riseMs * SR * 0.001);
      // Target smaller than step — should snap immediately.
      const target = step * 0.5;
      const expect = Math.fround(target);  // Float32 round-trip.
      const out = run(op, target, 8);
      for (let i = 0; i < 8; i++) {
        if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]} expect=${expect}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'fast transient is attenuated, not delayed',
    run() {
      const op = freshOp(10, 10);
      const step = 1 / (10 * SR * 0.001);
      // Impulse of height 1 for one sample, then 0.
      const inBuf = new Float32Array(16);
      inBuf[0] = 1;
      const out = new Float32Array(16);
      op.process({ in: inBuf }, { out }, 16);
      // y[0] should be +step (rate-limited toward 1, not 1).
      if (Math.abs(out[0] - step) > 1e-7) return { pass: false, why: `out[0]=${out[0]}` };
      // y[1]: target=0, delta=-step. |delta|=step is NOT > step_down=step,
      // so the else-branch wins → snap to 0.
      if (out[1] !== 0) return { pass: false, why: `out[1]=${out[1]} expected 0 (snap)` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp();
      run(op, 1.0, 1000);  // saturate
      op.reset();
      const step = 1 / (10 * SR * 0.001);
      const out = run(op, 1.0, 4);
      if (Math.abs(out[0] - step) > 1e-7) {
        return { pass: false, why: `after reset out[0]=${out[0]} expected ${step}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'negative target: symmetric behavior',
    run() {
      const op = freshOp(10, 10);
      const step = 1 / (10 * SR * 0.001);
      const out = run(op, -1.0, 4);
      if (Math.abs(out[0] + step) > 1e-7) {
        return { pass: false, why: `out[0]=${out[0]} expected ${-step}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input: glides toward 0 from non-zero state',
    run() {
      const op = freshOp(10, 50);
      run(op, 1.0, 1000);  // charge to 1
      const stepDown = 1 / (50 * SR * 0.001);
      const out = new Float32Array(4);
      op.process({}, { out }, 4);
      // y was ~1, target=0 (implicit via !inCh), delta=-1, |delta|>stepDown.
      const expect0 = 1 - stepDown;
      if (Math.abs(out[0] - expect0) > 1e-6) {
        return { pass: false, why: `out[0]=${out[0]} expected ${expect0}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input from zero state stays at zero',
    run() {
      const op = freshOp();
      const out = new Float32Array(16);
      op.process({}, { out }, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(64).fill(1) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'param clamping: zero/negative riseMs clamped to 0.001',
    run() {
      const op = freshOp();
      op.setParam('riseMs', 0);
      // Implicit: step_up = 1/(0.001 · 48000 · 0.001) = 1/0.048 ≈ 20.8
      // So any delta < 20.8 falls into snap branch (pure passthrough).
      const out = run(op, 0.5, 4);
      if (out[0] !== 0.5) return { pass: false, why: `out[0]=${out[0]} expected 0.5 (passthrough)` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored (sticky last-good)',
    run() {
      const op = freshOp(10, 10);
      op.setParam('riseMs', Number.NaN);
      op.setParam('fallMs', Number.POSITIVE_INFINITY);
      const step = 1 / (10 * SR * 0.001);  // unchanged
      const out = run(op, 1.0, 4);
      if (Math.abs(out[0] - step) > 1e-7) {
        return { pass: false, why: `out[0]=${out[0]} expected ${step}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'denormal flush on block end',
    run() {
      // Drive toward 0 from a tiny positive value, end in denormal range.
      const op = freshOp(10, 10);
      // Prime y to a tiny positive value just below DENORMAL by tracking a
      // tiny target and letting snap put us there.
      const step = 1 / (10 * SR * 0.001);
      const tiny = 1e-35;  // below DENORMAL (1e-30)
      const out = run(op, tiny, 1);  // snap to tiny (< step)
      // Flush should have fired; internal _y must be 0.
      // Verify by running with target=0 and checking out[0] === 0 (snap).
      const out2 = run(op, 0, 1);
      if (out2[0] !== 0) return { pass: false, why: `post-flush out2[0]=${out2[0]}` };
      // And out[0] from prior pass equals tiny (Float32 cast).
      if (out[0] !== Math.fround(tiny)) return { pass: false, why: `out[0]=${out[0]} expected ${Math.fround(tiny)}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp();
      const b = freshOp();
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) * 0.8;
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ in: inBuf }, { out: oA }, N);
      b.process({ in: inBuf }, { out: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'zero latency declared',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
];

export default { opId: 'slew', tests };
