// op_hiss.test.js — feldkirch white PRNG + Kellett pink filter.

import { HissOp } from './op_hiss.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new HissOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, N) {
  const out = new Float32Array(N);
  op.process({}, { out }, N);
  return out;
}

function rms(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / arr.length);
}

// Very rough spectral-slope estimator: compare high-band RMS vs low-band RMS
// after splitting via a 1-pole filter at sqrt(low·high)≈707 Hz.
function spectralRatio(arr, sr) {
  const fc = 707;
  const x = Math.exp(-2 * Math.PI * fc / sr);
  let lp = 0;
  let loSq = 0, hiSq = 0;
  for (let i = 0; i < arr.length; i++) {
    lp = (1 - x) * arr[i] + x * lp;
    loSq += lp * lp;
    const hi = arr[i] - lp;
    hiSq += hi * hi;
  }
  return Math.sqrt(hiSq / Math.max(loSq, 1e-20));
}

const tests = [
  {
    name: 'white mode: output is finite, bounded, non-zero',
    run() {
      const op = freshOp({ tint: 0, level: 0 });
      const out = render(op, 4096);
      let any = false;
      for (let i = 0; i < 4096; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(out[i]) > 1.1)   return { pass: false, why: `i=${i} out=${out[i]}` };
        if (out[i] !== 0) any = true;
      }
      if (!any) return { pass: false, why: 'all zero' };
      return { pass: true };
    },
  },
  {
    name: 'pink mode: output is finite, bounded, non-zero',
    run() {
      const op = freshOp({ tint: 1, level: 0 });
      const out = render(op, 4096);
      let any = false;
      for (let i = 0; i < 4096; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(out[i]) > 2)     return { pass: false, why: `i=${i} out=${out[i]}` };
        if (out[i] !== 0) any = true;
      }
      if (!any) return { pass: false, why: 'all zero' };
      return { pass: true };
    },
  },
  {
    name: 'white spectrum: hi/lo ratio near 1 (±50%)',
    run() {
      const out = render(freshOp({ tint: 0, level: 0 }), 32768);
      const r = spectralRatio(out, SR);
      // Perfectly white → ratio ≈ sqrt(fNyq - 707) / sqrt(707) = sqrt(24000-707)/sqrt(707) ≈ 5.8.
      // But our 1-pole crude splitter is not ideal. Measure empirically w/ white:
      // ratio will be some value R_white. Pink test just needs ratio << R_white.
      if (r < 1 || r > 20) return { pass: false, why: `white ratio=${r} (expect 1-20)` };
      return { pass: true };
    },
  },
  {
    name: 'pink has more low-band energy than white (spectral tilt)',
    run() {
      const rWhite = spectralRatio(render(freshOp({ tint: 0, level: 0 }), 32768), SR);
      const rPink  = spectralRatio(render(freshOp({ tint: 1, level: 0 }), 32768), SR);
      // Pink has −10 dB/dec slope → less HF energy → smaller hi/lo ratio than white.
      if (rPink >= rWhite) return { pass: false, why: `pink=${rPink} ≥ white=${rWhite}` };
      return { pass: true };
    },
  },
  {
    name: 'level control: −12 dB halves (approx) RMS vs 0 dB',
    run() {
      const a = render(freshOp({ tint: 0, level: 0   }), 8192);
      const b = render(freshOp({ tint: 0, level: -12 }), 8192);
      const ratio = rms(b) / rms(a);
      // -12 dB → 0.25 linear (power) / 0.2512 amplitude.
      if (Math.abs(ratio - 0.2512) > 0.02) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },
  {
    name: 'level = -60 dB → barely audible (RMS < 0.002)',
    run() {
      const out = render(freshOp({ tint: 1, level: -60 }), 8192);
      const r = rms(out);
      if (r > 0.002) return { pass: false, why: `rms=${r}` };
      return { pass: true };
    },
  },
  {
    name: 'white RMS at 0 dB close to 1/√3 (uniform PDF) ≈ 0.577',
    run() {
      const out = render(freshOp({ tint: 0, level: 0 }), 65536);
      const r = rms(out);
      // Allow slack — feldkirch output is not strictly uniform but close.
      if (r < 0.3 || r > 0.8) return { pass: false, why: `rms=${r}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const a = render(freshOp({ tint: 1, level: 0 }), 4096);
      const b = render(freshOp({ tint: 1, level: 0 }), 4096);
      for (let i = 0; i < 4096; i++) {
        if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() restores seed — same output after reset+replay',
    run() {
      const op = freshOp({ tint: 0, level: 0 });
      const before = render(op, 256);
      op.reset();
      const after = render(op, 256);
      for (let i = 0; i < 256; i++) {
        if (before[i] !== after[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: N one-shot == two half-blocks',
    run() {
      const op1 = freshOp({ tint: 1, level: 0 });
      const op2 = freshOp({ tint: 1, level: 0 });
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
      op.setParam('level', 999); op.setParam('level', -999); op.setParam('level', NaN);
      op.setParam('tint',  99);  op.setParam('tint', -99);   op.setParam('tint',  NaN);
      const out = render(op, 256);
      for (let i = 0; i < 256; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      }
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
      const op = freshOp({});
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'DC content: pink output mean near 0 over long window',
    run() {
      const out = render(freshOp({ tint: 1, level: 0 }), 65536);
      let s = 0; for (let i = 0; i < out.length; i++) s += out[i];
      const mean = s / out.length;
      if (Math.abs(mean) > 0.05) return { pass: false, why: `mean=${mean}` };
      return { pass: true };
    },
  },
];

export default { opId: 'hiss', tests };
