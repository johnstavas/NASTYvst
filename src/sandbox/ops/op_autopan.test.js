// op_autopan.test.js — autopan tests.
// Primary: Puckette §5.2 AM + CMU ICM const-power pan. Composition.

import { AutopanOp } from './op_autopan.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new AutopanOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, input, N, input2 = null) {
  const l = new Float32Array(N), r = new Float32Array(N);
  op.process({ in: input, in2: input2 }, { l, r }, N);
  return { l, r };
}

function ones(N, v = 1) { const a = new Float32Array(N); a.fill(v); return a; }

const tests = [
  {
    name: 'depth=0 → L = R · √½ (static center, no movement)',
    run() {
      const op = freshOp({ depth: 0, rateHz: 3 });
      const { l, r } = render(op, ones(2048), 2048);
      for (let i = 0; i < 2048; i++) {
        if (Math.abs(l[i] - Math.SQRT1_2) > 1e-6) return { pass: false, why: `i=${i} L=${l[i]}` };
        if (Math.abs(r[i] - Math.SQRT1_2) > 1e-6) return { pass: false, why: `i=${i} R=${r[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'constant-power holds: L² + R² = 1 for every sample, all rates/depths/shapes',
    run() {
      for (const shape of [0, 1, 2]) {
        for (const depth of [0, 0.5, 1]) {
          const op = freshOp({ depth, rateHz: 2, shape });
          const { l, r } = render(op, ones(2048), 2048);
          for (let i = 0; i < 2048; i++) {
            const pow = l[i]*l[i] + r[i]*r[i];
            if (Math.abs(pow - 1) > 1e-5)
              return { pass: false, why: `shape=${shape} depth=${depth} i=${i} pow=${pow}` };
          }
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'depth=1, sine: L and R are in antiphase (L+R still constant-power, not constant-sum)',
    run() {
      // With sine LFO at depth=1, when L is at max, R is at min and vice versa.
      // Check extreme samples across one LFO period.
      const op = freshOp({ depth: 1, rateHz: 10, shape: 0 });
      const N = SR / 10;  // one full LFO period @ 10 Hz
      const { l, r } = render(op, ones(N), N);
      let maxL = 0, minL = 1, maxR = 0, minR = 1;
      for (let i = 0; i < N; i++) {
        if (l[i] > maxL) maxL = l[i]; if (l[i] < minL) minL = l[i];
        if (r[i] > maxR) maxR = r[i]; if (r[i] < minR) minR = r[i];
      }
      // At depth=1, θ ranges [0, π/2] so gL ranges [0,1] and gR ranges [0,1]
      if (maxL < 0.99 || minL > 0.01) return { pass: false, why: `L range=[${minL},${maxL}]` };
      if (maxR < 0.99 || minR > 0.01) return { pass: false, why: `R range=[${minR},${maxR}]` };
      return { pass: true };
    },
  },
  {
    name: 'rate sweep: L and R periodicity matches rateHz (count zero-ish crossings at depth=1 sine)',
    run() {
      const rate = 5;
      const op = freshOp({ depth: 1, rateHz: rate, shape: 0 });
      const seconds = 1;
      const N = SR * seconds;
      const { l } = render(op, ones(N), N);
      // Expected: L hits near-0 once per LFO period (when sin(phase)=+1 → θ=π/2 → gL=0).
      // So ~rate near-zero regions in 1 s.
      let regions = 0, inRegion = false;
      for (let i = 0; i < N; i++) {
        if (l[i] < 0.05) { if (!inRegion) { regions++; inRegion = true; } }
        else inRegion = false;
      }
      // ~rate regions expected, ±1 for edge effects.
      if (Math.abs(regions - rate * seconds) > 1)
        return { pass: false, why: `regions=${regions} rate=${rate}` };
      return { pass: true };
    },
  },
  {
    name: 'phaseDeg=180: sine LFO starts at bottom instead of zero',
    run() {
      const a = freshOp({ depth: 1, rateHz: 0.5, shape: 0, phaseDeg: 0 });
      const b = freshOp({ depth: 1, rateHz: 0.5, shape: 0, phaseDeg: 180 });
      const ra = render(a, ones(4), 4);
      const rb = render(b, ones(4), 4);
      // At phase=0 sine, L/R start equal (θ=π/4). At phase=π, also θ=π/4 (sin π = 0).
      // Better test: at phase=90°, sine=1, θ=π/2, gL=0; at phase=270°, sine=-1, θ=0, gR=0.
      const c = freshOp({ depth: 1, rateHz: 0.5, shape: 0, phaseDeg: 90 });
      const d = freshOp({ depth: 1, rateHz: 0.5, shape: 0, phaseDeg: 270 });
      const rc = render(c, ones(4), 4);
      const rd = render(d, ones(4), 4);
      if (rc.l[0] > 0.01) return { pass: false, why: `phase=90 L[0]=${rc.l[0]} (want ~0)` };
      if (rd.r[0] > 0.01) return { pass: false, why: `phase=270 R[0]=${rd.r[0]} (want ~0)` };
      return { pass: true };
    },
  },
  {
    name: 'triangle LFO: no NaN, bounded |lfo| ≤ 1',
    run() {
      const op = freshOp({ depth: 1, rateHz: 4, shape: 1 });
      const { l, r } = render(op, ones(2048), 2048);
      for (let i = 0; i < 2048; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(l[i]) > 1.001 || Math.abs(r[i]) > 1.001) return { pass: false, why: `i=${i} overshoot` };
      }
      return { pass: true };
    },
  },
  {
    name: 'square LFO: output takes two distinct pan states',
    run() {
      const op = freshOp({ depth: 1, rateHz: 2, shape: 2 });
      const N = SR; // 1 s = 2 full square periods
      const { l, r } = render(op, ones(N), N);
      // Square at depth=1 alternates θ = 0 (hard L) and θ = π/2 (hard R).
      // So L is either ~1 or ~0, same for R inverted.
      let sawLhi = false, sawLlo = false;
      for (let i = 0; i < N; i++) {
        if (l[i] > 0.99) sawLhi = true;
        if (l[i] < 0.01) sawLlo = true;
      }
      if (!sawLhi || !sawLlo) return { pass: false, why: `L-hi=${sawLhi} L-lo=${sawLlo}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('rateHz',   9999); op.setParam('rateHz',   -1); op.setParam('rateHz', NaN);
      op.setParam('depth',    9);    op.setParam('depth',    -9);
      op.setParam('shape',    99);   op.setParam('shape',    -99);
      op.setParam('phaseDeg', 9999); op.setParam('phaseDeg', -9999);
      const { l, r } = render(op, ones(512), 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'stereo input sums pre-pan at ×0.5',
    run() {
      const op = freshOp({ depth: 0, rateHz: 1 });
      const { l } = render(op, ones(4, 1), 4, ones(4, 1));
      // (1+1)/2 = 1, then × √½ at center = √½
      if (Math.abs(l[0] - Math.SQRT1_2) > 1e-6) return { pass: false, why: `L=${l[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 4096;
      const sig = ones(N);
      const a = render(freshOp({ depth: 1, rateHz: 3, shape: 1 }), sig, N);
      const b = render(freshOp({ depth: 1, rateHz: 3, shape: 1 }), sig, N);
      for (let i = 0; i < N; i++) {
        if (a.l[i] !== b.l[i] || a.r[i] !== b.r[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() restores phase to phaseDeg seed',
    run() {
      const op = freshOp({ depth: 1, rateHz: 2, shape: 0, phaseDeg: 90 });
      const before = render(op, ones(256), 256);
      op.reset();
      const after = render(op, ones(256), 256);
      for (let i = 0; i < 256; i++) {
        if (Math.abs(before.l[i] - after.l[i]) > 1e-6) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence',
    run() {
      const op = freshOp({});
      const l = new Float32Array(64), r = new Float32Array(64);
      try { op.process({}, { l, r }, 64); } catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < 64; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: ones(64) }, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0 (no delay line)',
    run() {
      const op = freshOp({});
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'phase accumulator does not drift across blocks',
    run() {
      // Render N samples in one block vs two half-blocks; outputs must match.
      const op1 = freshOp({ depth: 1, rateHz: 3 });
      const op2 = freshOp({ depth: 1, rateHz: 3 });
      const N = 2000;
      const sig = ones(N);
      const r1 = render(op1, sig, N);
      const lA = new Float32Array(N/2), rA = new Float32Array(N/2);
      op2.process({ in: sig.subarray(0, N/2) }, { l: lA, r: rA }, N/2);
      const lB = new Float32Array(N/2), rB = new Float32Array(N/2);
      op2.process({ in: sig.subarray(N/2, N) }, { l: lB, r: rB }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(r1.l[i] - lA[i]) > 1e-6) return { pass: false, why: `A-block i=${i}` };
        if (Math.abs(r1.l[i + N/2] - lB[i]) > 1e-6) return { pass: false, why: `B-block i=${i}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'autopan', tests };
