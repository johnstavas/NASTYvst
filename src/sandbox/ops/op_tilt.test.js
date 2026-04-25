// op_tilt.test.js — real-math tests for op_tilt.
// Primary: musicdsp archive #267 (Lubomir I. Ivanov, 2009).

import { TiltOp } from './op_tilt.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new TiltOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, signalFn, nSamples) {
  const CHUNK = 256;
  const out = new Float32Array(nSamples);
  let pos = 0;
  while (pos < nSamples) {
    const c = Math.min(CHUNK, nSamples - pos);
    const inp = new Float32Array(c);
    for (let i = 0; i < c; i++) inp[i] = signalFn(pos + i);
    const bOut = new Float32Array(c);
    op.process({ in: inp }, { out: bOut }, c);
    out.set(bOut, pos);
    pos += c;
  }
  return out;
}

function rms(arr, start, end) {
  let s = 0;
  for (let i = start; i < end; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / (end - start));
}

function sine(freqHz, amp = 0.5) {
  return (n) => amp * Math.sin(2 * Math.PI * freqHz * n / SR);
}

const tests = [
  {
    name: 'gain=0 → passthrough (output ≈ input)',
    run() {
      const op = freshOp({ f0: 630, gain: 0 });
      const out = drive(op, sine(1000), 4096);
      for (let i = 1000; i < 4096; i++) {
        const exp = sine(1000)(i);
        if (Math.abs(out[i] - exp) > 1e-5) return { pass: false, why: `diverge at ${i}: out=${out[i]} exp=${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'positive gain boosts highs, cuts lows',
    run() {
      const op = freshOp({ f0: 1000, gain: 6 });
      const low  = drive(op, sine(100), 8192);  // well below pivot
      op.reset();
      op.setParam('gain', 6); // reapply
      const high = drive(op, sine(8000), 8192); // well above pivot
      const rLow  = rms(low,  4000, 8192);
      const rHigh = rms(high, 4000, 8192);
      // Input RMS is same (0.5/√2 ≈ 0.3536) for both.
      // Expect high > input_rms > low.
      if (!(rLow < 0.3)) return { pass: false, why: `low band not cut: rms=${rLow}` };
      if (!(rHigh > 0.4)) return { pass: false, why: `high band not boosted: rms=${rHigh}` };
      return { pass: true };
    },
  },
  {
    name: 'negative gain cuts highs, boosts lows',
    run() {
      const op = freshOp({ f0: 1000, gain: -6 });
      const low  = drive(op, sine(100), 8192);
      op.reset();
      op.setParam('gain', -6);
      const high = drive(op, sine(8000), 8192);
      const rLow  = rms(low,  4000, 8192);
      const rHigh = rms(high, 4000, 8192);
      if (!(rLow > 0.4))  return { pass: false, why: `low band not boosted: rms=${rLow}` };
      if (!(rHigh < 0.3)) return { pass: false, why: `high band not cut: rms=${rHigh}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output, no NaN',
    run() {
      const op = freshOp({ gain: 6 });
      const out = drive(op, () => 0, 2048);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i]) || out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pivot frequency position: RMS at f0 changes smoothly with gain',
    run() {
      // At pivot, LP and HP contributions should partly cancel. Check that
      // near-pivot sine is less affected than far-from-pivot.
      const f0 = 1000;
      const far = (() => {
        const op = freshOp({ f0, gain: 6 });
        return rms(drive(op, sine(10000), 8192), 4000, 8192);
      })();
      const near = (() => {
        const op = freshOp({ f0, gain: 6 });
        return rms(drive(op, sine(1000), 8192), 4000, 8192);
      })();
      // Input RMS = 0.5/√2 ≈ 0.3536. Near pivot → smaller deviation than far.
      const dFar  = Math.abs(far  - 0.3536);
      const dNear = Math.abs(near - 0.3536);
      if (!(dNear < dFar)) return { pass: false, why: `near dev ${dNear} >= far dev ${dFar}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const a = drive(freshOp({ f0: 800, gain: 3 }), sine(500), 2048);
      const b = drive(freshOp({ f0: 800, gain: 3 }), sine(500), 2048);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ gain: 6 });
      drive(op, sine(500), 4096);
      op.reset();
      if (op._lp_out !== 0) return { pass: false, why: `lp_out=${op._lp_out}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps — f0, gain, gfactor, NaN ignored',
    run() {
      const op = freshOp();
      op.setParam('f0', -100);       if (op._f0 !== 1)     return { pass: false, why: `f0 min ${op._f0}` };
      op.setParam('f0', 1e9);        if (op._f0 !== SR*0.49) return { pass: false, why: `f0 max ${op._f0}` };
      op.setParam('gain', 100);      if (op._gain !== 24)  return { pass: false, why: `gain max ${op._gain}` };
      op.setParam('gain', -100);     if (op._gain !== -24) return { pass: false, why: `gain min ${op._gain}` };
      op.setParam('gfactor', 0);     if (op._gfactor !== 0.01) return { pass: false, why: `gfactor min ${op._gfactor}` };
      op.setParam('gfactor', 1e9);   if (op._gfactor !== 100)  return { pass: false, why: `gfactor max ${op._gfactor}` };
      op.setParam('gain', NaN);      if (op._gain !== -24) return { pass: false, why: `NaN should be ignored` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output, no NaN',
    run() {
      const op = freshOp({ gain: 6 });
      const out = new Float32Array(512);
      op.process({}, { out }, 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(out[i]) || out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
  {
    name: 'latency = 0',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'output stays finite on loud broadband input',
    run() {
      const op = freshOp({ gain: 12 });
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const out = drive(op, () => rng() * 0.8, 8192);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 100)   return { pass: false, why: `runaway at ${i}=${out[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'tilt', tests };
