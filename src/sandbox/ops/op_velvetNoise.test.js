// op_velvetNoise.test.js — real-math tests for op_velvetNoise.
// Run via: node scripts/check_op_math.mjs
//
// Velvet noise per Karjalainen-Järveläinen 2007 / Välimäki et al. 2017.
// Tests cover:
//  - Each Td-sample cell contains exactly ONE non-zero sample
//  - Non-zero samples are exactly ±amp (no fractional values)
//  - Average impulse density approximates the `density` param
//  - Seed reproducibility (same seed → identical sequence)
//  - Seed differentiation (different seed → different sequence)
//  - amp scales impulse magnitude linearly
//  - reset() restores LCG seed → re-runs produce identical stream
//  - Density change applies on next cell boundary (current cell unaffected)
//  - Defensive: missing output → no-op; NaN/inf params clamped/ignored

import { VelvetNoiseOp } from './op_velvetNoise.worklet.js';

const SR = 48000;
const N  = 256;

function freshOp(params = {}) {
  const op = new VelvetNoiseOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function runBlocks(op, totalN) {
  const out = new Float32Array(totalN);
  let pos = 0;
  while (pos < totalN) {
    const n = Math.min(N, totalN - pos);
    op.process({}, { out: out.subarray(pos, pos + n) }, n);
    pos += n;
  }
  return out;
}

const tests = [
  // ---- structural: one impulse per Td-sample cell ---------------------
  {
    name: 'each Td-sample cell contains exactly one non-zero sample',
    run() {
      const density = 1500;
      const op = freshOp({ density, amp: 1, seed: 12345 });
      const Td = Math.round(SR / density);   // 32 at 48 kHz
      const cells = 200;
      const out = runBlocks(op, Td * cells);
      for (let m = 0; m < cells; m++) {
        let nz = 0;
        for (let k = 0; k < Td; k++) if (out[m * Td + k] !== 0) nz++;
        if (nz !== 1) return { pass: false, why: `cell ${m}: ${nz} impulses` };
      }
      return { pass: true };
    },
  },
  {
    name: 'non-zero samples are exactly ±1 (binary impulses, no fractions)',
    run() {
      const op = freshOp({ density: 1500, amp: 1, seed: 7 });
      const out = runBlocks(op, 4096);
      for (let i = 0; i < out.length; i++) {
        const v = out[i];
        if (v !== 0 && v !== 1 && v !== -1) {
          return { pass: false, why: `out[${i}]=${v}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'sign distribution roughly balanced over many cells',
    run() {
      const op = freshOp({ density: 1500, amp: 1, seed: 99 });
      const out = runBlocks(op, 32 * 4000);   // ~4000 cells
      let pos = 0, neg = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i] === 1) pos++;
        else if (out[i] === -1) neg++;
      }
      // Expect roughly 50/50; allow ±10% drift over 4000 trials (~3.5σ).
      const total = pos + neg;
      const ratio = pos / total;
      if (ratio < 0.4 || ratio > 0.6) return { pass: false, why: `pos=${pos} neg=${neg} ratio=${ratio}` };
      return { pass: true };
    },
  },

  // ---- density measurement --------------------------------------------
  {
    name: 'measured impulse rate ≈ density param at 1500 Hz',
    run() {
      const density = 1500;
      const op = freshOp({ density, amp: 1, seed: 5 });
      const total = SR;                  // 1 second
      const out = runBlocks(op, total);
      let nz = 0;
      for (let i = 0; i < total; i++) if (out[i] !== 0) nz++;
      // Td = round(48000/1500) = 32 → exact rate = 48000/32 = 1500 imp/s.
      if (nz < 1490 || nz > 1510) return { pass: false, why: `nz=${nz}` };
      return { pass: true };
    },
  },
  {
    name: 'measured impulse rate ≈ density param at 500 Hz',
    run() {
      const density = 500;
      const op = freshOp({ density, amp: 1, seed: 11 });
      const total = SR;
      const out = runBlocks(op, total);
      let nz = 0;
      for (let i = 0; i < total; i++) if (out[i] !== 0) nz++;
      // Td = 96 → rate = 500.
      if (nz < 495 || nz > 505) return { pass: false, why: `nz=${nz}` };
      return { pass: true };
    },
  },

  // ---- reproducibility / determinism ----------------------------------
  {
    name: 'same seed → identical sequence',
    run() {
      const a = runBlocks(freshOp({ density: 1500, seed: 42 }), 4096);
      const b = runBlocks(freshOp({ density: 1500, seed: 42 }), 4096);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'different seed → different sequence',
    run() {
      const a = runBlocks(freshOp({ density: 1500, seed: 42 }), 4096);
      const b = runBlocks(freshOp({ density: 1500, seed: 43 }), 4096);
      let diffs = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
      // Expect many disagreements (impulses move and/or flip).
      if (diffs < 50) return { pass: false, why: `only ${diffs} samples differ` };
      return { pass: true };
    },
  },
  {
    name: 'reset() returns to seed-equivalent state',
    run() {
      const op = freshOp({ density: 1500, seed: 1234 });
      const a = runBlocks(op, 1024);
      op.reset();
      const b = runBlocks(op, 1024);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- amp scaling -----------------------------------------------------
  {
    name: 'amp=0.5 halves impulse magnitudes',
    run() {
      const opA = freshOp({ density: 1500, amp: 1,   seed: 7 });
      const opB = freshOp({ density: 1500, amp: 0.5, seed: 7 });
      const a = runBlocks(opA, 1024);
      const b = runBlocks(opB, 1024);
      for (let i = 0; i < a.length; i++) {
        const expected = a[i] * 0.5;
        if (Math.abs(b[i] - expected) > 1e-7) return { pass: false, why: `i=${i}: ${b[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'amp=0 → all zeros',
    run() {
      const op = freshOp({ density: 1500, amp: 0, seed: 7 });
      const out = runBlocks(op, 1024);
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- density change behavior ----------------------------------------
  {
    name: 'density change takes effect at next cell boundary',
    run() {
      // Run a few cells at density=1500 (Td=32), then switch to density=500
      // (Td=96), continue. After switch, expect Td=96 cells until end.
      const op = freshOp({ density: 1500, amp: 1, seed: 101 });
      const phase1 = 32 * 5;   // 5 full cells at Td=32
      const phase2 = 96 * 10;  // 10 full cells at Td=96
      const a = runBlocks(op, phase1);
      // Verify phase1: 5 cells × 1 impulse each.
      let nzA = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== 0) nzA++;
      if (nzA !== 5) return { pass: false, why: `phase1: ${nzA} impulses, expected 5` };
      // Switch density.
      op.setParam('density', 500);
      const b = runBlocks(op, phase2);
      let nzB = 0;
      for (let i = 0; i < b.length; i++) if (b[i] !== 0) nzB++;
      if (nzB !== 10) return { pass: false, why: `phase2: ${nzB} impulses, expected 10` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing output → no-op (no throw)',
    run() {
      const op = freshOp({ density: 1500 });
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: `${e}` }; }
      return { pass: true };
    },
  },
  {
    name: 'NaN/Infinity params ignored: output stays finite, ±1, or 0',
    run() {
      const op = freshOp({ density: 1500, amp: 1, seed: 5 });
      // Should be ignored (Number.isFinite check).
      op.setParam('density', NaN);
      op.setParam('density', Infinity);
      op.setParam('amp', -Infinity);
      op.setParam('amp', NaN);
      const out = runBlocks(op, N);
      for (let i = 0; i < N; i++) {
        const v = out[i];
        if (!Number.isFinite(v)) return { pass: false, why: `i=${i}: ${v}` };
        if (v !== 0 && Math.abs(Math.abs(v) - 1) > 1e-7) {
          return { pass: false, why: `i=${i}: ${v}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'density clamped to [50, 5000]',
    run() {
      const op = freshOp({ density: 1500, amp: 1, seed: 7 });
      op.setParam('density', 999999);   // → clamped to 5000
      // Td = round(48000/5000) = 10. Run 1000 cells = 10000 samples.
      const out = runBlocks(op, 10 * 1000);
      let nz = 0;
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) nz++;
      // Expect exactly 1000 impulses (one per cell).
      if (nz !== 1000) return { pass: false, why: `nz=${nz}` };
      return { pass: true };
    },
  },
];

export default { opId: 'velvetNoise', tests };
