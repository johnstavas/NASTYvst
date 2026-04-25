// op_onset.test.js — real-math tests for op_onset.
// Primary reference: librosa onset.onset_strength + util.peak_pick (ISC);
// Böck-Widmer 2013; Böck-Krebs-Schedl 2012.

import { OnsetOp } from './op_onset.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new OnsetOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

// Drive `nFrames` full size-sample frames into the op. Only the first
// `binCols` bins are read at the frame boundary; we pack re/im for all k.
function driveFrames(op, nFrames, frameFn) {
  const N = op._size;
  const strengthSamples = new Float32Array(nFrames * N);
  const onsetSamples    = new Float32Array(nFrames * N);
  for (let f = 0; f < nFrames; f++) {
    const inRe = new Float32Array(N);
    const inIm = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const [re, im] = frameFn(f, k);
      inRe[k] = re; inIm[k] = im;
    }
    const outS = new Float32Array(N);
    const outO = new Float32Array(N);
    op.process({ real: inRe, imag: inIm }, { strength: outS, onset: outO }, N);
    strengthSamples.set(outS, f * N);
    onsetSamples.set(outO, f * N);
  }
  return { strengthSamples, onsetSamples };
}

const tests = [
  {
    name: 'silent spectrum → zero strength and no triggers',
    run() {
      const op = freshOp({ size: 128 });
      const { strengthSamples, onsetSamples } = driveFrames(op, 30, () => [0, 0]);
      for (let i = 0; i < strengthSamples.length; i++)
        if (strengthSamples[i] !== 0) return { pass: false, why: `strength[${i}]=${strengthSamples[i]}` };
      for (let i = 0; i < onsetSamples.length; i++)
        if (onsetSamples[i] !== 0) return { pass: false, why: `onset[${i}]=${onsetSamples[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'step-up in energy produces onset trigger and positive strength',
    run() {
      const op = freshOp({ size: 128, preMax: 2, preAvg: 4, delta: 0.01, wait: 2 });
      const { strengthSamples, onsetSamples } = driveFrames(op, 40, (f, k) =>
        f >= 15 && k < 20 ? [0.5, 0] : [0, 0]);
      let triggers = 0, maxS = 0;
      for (let i = 0; i < onsetSamples.length; i++) if (onsetSamples[i] > 0) triggers++;
      for (let i = 0; i < strengthSamples.length; i++) if (strengthSamples[i] > maxS) maxS = strengthSamples[i];
      if (triggers < 1) return { pass: false, why: `expected ≥1 trigger, got ${triggers}` };
      if (!(maxS > 0))  return { pass: false, why: `expected maxS>0, got ${maxS}` };
      return { pass: true };
    },
  },
  {
    name: 'onset output is a single-sample pulse at frame boundary',
    run() {
      const op = freshOp({ size: 128, preMax: 2, preAvg: 4, delta: 0.01, wait: 2 });
      const { onsetSamples } = driveFrames(op, 40, (f, k) =>
        f >= 15 && k < 20 ? [0.5, 0] : [0, 0]);
      for (let i = 0; i < onsetSamples.length; i++) {
        if (onsetSamples[i] !== 0) {
          if (i % 128 !== 0) return { pass: false, why: `trigger at ${i} not on frame boundary` };
          if (onsetSamples[i] !== 1) return { pass: false, why: `trigger=${onsetSamples[i]} != 1` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'wait param enforces min frames between onsets',
    run() {
      const frameFn = (f, k) => (f % 3 === 0 && k < 20) ? [0.8, 0] : [0, 0];
      const op1 = freshOp({ size: 128, preMax: 1, preAvg: 2, delta: 0.001, wait: 1 });
      const op2 = freshOp({ size: 128, preMax: 1, preAvg: 2, delta: 0.001, wait: 10 });
      const r1 = driveFrames(op1, 40, frameFn);
      const r2 = driveFrames(op2, 40, frameFn);
      let c1 = 0, c2 = 0;
      for (let i = 0; i < r1.onsetSamples.length; i++) if (r1.onsetSamples[i] > 0) c1++;
      for (let i = 0; i < r2.onsetSamples.length; i++) if (r2.onsetSamples[i] > 0) c2++;
      if (!(c1 > c2)) return { pass: false, why: `expected wait=1(${c1}) > wait=10(${c2})` };
      return { pass: true };
    },
  },
  {
    name: 'delta threshold suppresses quiet peaks',
    run() {
      const frameFn = (f, k) => (f >= 15 && k < 5) ? [0.001, 0] : [0, 0];
      const opLow  = freshOp({ size: 128, preMax: 2, preAvg: 4, delta: 0.0001, wait: 2 });
      const opHigh = freshOp({ size: 128, preMax: 2, preAvg: 4, delta: 10.0,   wait: 2 });
      const r1 = driveFrames(opLow,  40, frameFn);
      const r2 = driveFrames(opHigh, 40, frameFn);
      let cLow = 0, cHigh = 0;
      for (let i = 0; i < r1.onsetSamples.length; i++) if (r1.onsetSamples[i] > 0) cLow++;
      for (let i = 0; i < r2.onsetSamples.length; i++) if (r2.onsetSamples[i] > 0) cHigh++;
      if (!(cHigh <= cLow)) return { pass: false, why: `cHigh=${cHigh} > cLow=${cLow}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same outputs',
    run() {
      const frameFn = (f, k) => (f >= 10 && k < 15) ? [0.3, 0.1] : [0, 0];
      const a = driveFrames(freshOp({ size: 128 }), 20, frameFn);
      const b = driveFrames(freshOp({ size: 128 }), 20, frameFn);
      for (let i = 0; i < a.strengthSamples.length; i++) {
        if (a.strengthSamples[i] !== b.strengthSamples[i]) return { pass: false, why: `strength diverge at ${i}` };
        if (a.onsetSamples[i]    !== b.onsetSamples[i])    return { pass: false, why: `onset diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset restores silence state',
    run() {
      const op = freshOp({ size: 128, preMax: 2, preAvg: 4, delta: 0.01, wait: 2 });
      driveFrames(op, 30, (f, k) => f >= 10 && k < 20 ? [0.5, 0] : [0, 0]);
      op.reset();
      const { strengthSamples, onsetSamples } = driveFrames(op, 5, () => [0, 0]);
      for (let i = 0; i < strengthSamples.length; i++)
        if (strengthSamples[i] !== 0) return { pass: false, why: `post-reset strength[${i}]=${strengthSamples[i]}` };
      for (let i = 0; i < onsetSamples.length; i++)
        if (onsetSamples[i] !== 0) return { pass: false, why: `post-reset onset[${i}]=${onsetSamples[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → zero, no NaN',
    run() {
      const op = freshOp({ size: 128 });
      const outS = new Float32Array(128);
      const outO = new Float32Array(128);
      op.process({}, { strength: outS, onset: outO }, 128);
      for (let i = 0; i < 128; i++) {
        if (!Number.isFinite(outS[i]) || outS[i] !== 0) return { pass: false, why: `outS[${i}]=${outS[i]}` };
        if (!Number.isFinite(outO[i]) || outO[i] !== 0) return { pass: false, why: `outO[${i}]=${outO[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp({ size: 128 });
      op.process({ real: new Float32Array(128), imag: new Float32Array(128) }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'param clamps — size pow2, lag, maxSize odd, delta ≥0',
    run() {
      const op = freshOp();
      op.setParam('size', 1000);
      if (op._size !== 512) return { pass: false, why: `size got ${op._size}, expected 512` };
      op.setParam('size', 4);
      if (op._size !== 16) return { pass: false, why: `size min got ${op._size}` };
      op.setParam('size', 1 << 20);
      if (op._size !== 32768) return { pass: false, why: `size max got ${op._size}` };
      op.setParam('lag', 0);
      if (op._lag !== 1) return { pass: false, why: `lag min got ${op._lag}` };
      op.setParam('lag', 999);
      if (op._lag !== 128) return { pass: false, why: `lag max got ${op._lag}` };
      op.setParam('maxSize', 4);
      if ((op._maxSize & 1) !== 1) return { pass: false, why: `maxSize must be odd, got ${op._maxSize}` };
      op.setParam('delta', -5);
      if (op._delta !== 0) return { pass: false, why: `delta ≥0, got ${op._delta}` };
      op.setParam('delta', NaN);
      if (op._delta !== 0) return { pass: false, why: `NaN delta should be ignored` };
      return { pass: true };
    },
  },
  {
    name: 'latency equals frame size',
    run() {
      const op = freshOp({ size: 256 });
      if (op.getLatencySamples() !== 256) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
];

export default { opId: 'onset', tests };
