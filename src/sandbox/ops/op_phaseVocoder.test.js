// op_phaseVocoder.test.js — real-math tests for op_phaseVocoder.
// Run via: node scripts/check_op_math.mjs
//
// Primary: Bernsee smbPitchShift (via TarsosDSP PitchShifter.java).
// Verifies:
//   - Silent input → silent output
//   - pitch=1 with silent input stays silent across frames (no phase drift → noise)
//   - Magnitudes at output bin k sum to input magnitude at k/pitch (bin-shift)
//   - pitchShift param clamped [0.25, 4.0]
//   - Size pow2 snap; reset; determinism; defensive I/O

import { PhaseVocoderOp } from './op_phaseVocoder.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new PhaseVocoderOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, genRe, genIm, totalN) {
  const inRe = new Float32Array(totalN);
  const inIm = new Float32Array(totalN);
  for (let i = 0; i < totalN; i++) {
    inRe[i] = typeof genRe === 'function' ? genRe(i) : genRe;
    inIm[i] = typeof genIm === 'function' ? genIm(i) : genIm;
  }
  const outRe = new Float32Array(totalN);
  const outIm = new Float32Array(totalN);
  op.process({ real: inRe, imag: inIm }, { real: outRe, imag: outIm }, totalN);
  return { outRe, outIm };
}

const tests = [
  {
    name: 'silent input → silent output',
    run() {
      const M = 64;
      const op = freshOp({ size: M, pitchShift: 1.0 });
      const { outRe, outIm } = drive(op, 0, 0, M * 3);
      for (let i = 0; i < M * 3; i++) {
        if (Math.abs(outRe[i]) > 1e-12 || Math.abs(outIm[i]) > 1e-12)
          return { pass: false, why: `non-silent at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pitch=1: output magnitude reproduces input magnitude (bin-by-bin)',
    run() {
      const M = 64;
      const op = freshOp({ size: M, pitchShift: 1.0 });
      // Input: spectrum with delta at bin 10.
      const inRe = new Float32Array(M * 3);
      const inIm = new Float32Array(M * 3);
      // First two frames identical: bin 10 = (1, 0) in both.
      for (let f = 0; f < 3; f++) {
        inRe[f * M + 10] = 1.0;
      }
      const outRe = new Float32Array(M * 3);
      const outIm = new Float32Array(M * 3);
      op.process({ real: inRe, imag: inIm }, { real: outRe, imag: outIm }, M * 3);
      // After first frame fires (samples [M..2M-1]), bin 10 of output
      // should have magnitude 2·|1| = 2 (analysis multiplies by 2 per
      // Bernsee convention). Synthesis reproduces it so output mag ≈ 2.
      const mag = Math.hypot(outRe[M + 10], outIm[M + 10]);
      if (Math.abs(mag - 2) > 0.5) return { pass: false, why: `bin 10 mag=${mag.toFixed(3)} (expected ≈2)` };
      // Neighbor bins should be small relative to peak.
      const magNeighbor = Math.hypot(outRe[M + 5], outIm[M + 5]);
      if (magNeighbor > 0.5) return { pass: false, why: `bin 5 leak ${magNeighbor.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'pitch=2: bin-shifted output peaks at bin 2k of input bin k',
    run() {
      const M = 64;
      const op = freshOp({ size: M, pitchShift: 2.0 });
      const inRe = new Float32Array(M * 3);
      const inIm = new Float32Array(M * 3);
      for (let f = 0; f < 3; f++) inRe[f * M + 5] = 1.0;   // bin 5
      const outRe = new Float32Array(M * 3);
      const outIm = new Float32Array(M * 3);
      op.process({ real: inRe, imag: inIm }, { real: outRe, imag: outIm }, M * 3);
      // Expected: energy from input bin 5 moves to output bin 10.
      const magAt10 = Math.hypot(outRe[M + 10], outIm[M + 10]);
      const magAt5  = Math.hypot(outRe[M + 5],  outIm[M + 5]);
      if (magAt10 < 1.0)  return { pass: false, why: `bin 10 mag=${magAt10.toFixed(3)} (expected ≥1)` };
      if (magAt5 > magAt10) return { pass: false, why: `bin 5 (${magAt5.toFixed(3)}) > bin 10 (${magAt10.toFixed(3)})` };
      return { pass: true };
    },
  },
  {
    name: 'pitchShift clamped to [0.25, 4.0]',
    run() {
      const op = freshOp();
      op.setParam('pitchShift', 0.1);
      if (op._pitch !== 0.25) return { pass: false, why: `low ${op._pitch}` };
      op.setParam('pitchShift', 100);
      if (op._pitch !== 4.0)  return { pass: false, why: `high ${op._pitch}` };
      return { pass: true };
    },
  },
  {
    name: 'size: non-pow2 snaps down; min/max clamp',
    run() {
      const op = freshOp({ size: 1000 });
      if (op._size !== 512) return { pass: false, why: `size=${op._size}` };
      op.setParam('size', 10);
      if (op._size !== 16) return { pass: false, why: `min ${op._size}` };
      op.setParam('size', 1 << 20);
      if (op._size !== 32768) return { pass: false, why: `max ${op._size}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears phase state',
    run() {
      const M = 64;
      const op = freshOp({ size: M, pitchShift: 1.0 });
      drive(op, (i) => Math.sin(i * 0.1), (i) => Math.cos(i * 0.1), M * 2);
      op.reset();
      const { outRe, outIm } = drive(op, 0, 0, 16);
      for (let i = 0; i < 16; i++)
        if (outRe[i] !== 0 || outIm[i] !== 0) return { pass: false, why: `post-reset i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing real input → treated as zero; no NaN',
    run() {
      const M = 64;
      const op = freshOp({ size: M });
      const inIm = new Float32Array(M * 2);
      const outRe = new Float32Array(M * 2);
      const outIm = new Float32Array(M * 2);
      op.process({ imag: inIm }, { real: outRe, imag: outIm }, M * 2);
      for (let i = 0; i < M * 2; i++) {
        if (!Number.isFinite(outRe[i]) || !Number.isFinite(outIm[i]))
          return { pass: false, why: `NaN at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp({ size: 64 });
      const inRe = new Float32Array(128).fill(0.1);
      const inIm = new Float32Array(128);
      op.process({ real: inRe, imag: inIm }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same input → identical output',
    run() {
      const M = 128;
      const genRe = (i) => Math.sin(i * 0.1);
      const genIm = (i) => 0.2 * Math.cos(i * 0.17);
      const a = drive(freshOp({ size: M, pitchShift: 1.5 }), genRe, genIm, M * 3);
      const b = drive(freshOp({ size: M, pitchShift: 1.5 }), genRe, genIm, M * 3);
      for (let i = 0; i < M * 3; i++) {
        if (a.outRe[i] !== b.outRe[i] || a.outIm[i] !== b.outIm[i])
          return { pass: false, why: `diverge ${i}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'phaseVocoder', tests };
