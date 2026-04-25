// op_formant.test.js — real-math tests for op_formant.
// Primary reference: musicdsp archive #110 (alex@smartelectronix, 2002).

import { FormantOp } from './op_formant.worklet.js';

const SR = 44100;

function freshOp(params = {}) {
  const op = new FormantOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, signalFn, nSamples) {
  const CHUNK = 512;
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

// Sawtooth: spectrum-rich drive recommended by the reference.
function saw(freqHz) {
  let phase = 0;
  const step = freqHz / SR;
  return () => {
    const v = 2 * phase - 1;
    phase += step; if (phase >= 1) phase -= 1;
    return v * 0.05; // modest amplitude to avoid runaway (ref warns of scaling)
  };
}

const tests = [
  {
    name: 'silent input → silent output (finite)',
    run() {
      const op = freshOp({ vowel: 0 });
      const out = drive(op, () => 0, 4096);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (out[i] !== 0) return { pass: false, why: `nonzero at ${i}=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'sawtooth drive produces non-silent finite output',
    run() {
      const op = freshOp({ vowel: 0 }); // A
      const out = drive(op, saw(110), 16384); // 110 Hz saw
      let maxAbs = 0;
      for (let i = 2000; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        const a = Math.abs(out[i]); if (a > maxAbs) maxAbs = a;
      }
      if (maxAbs < 1e-6) return { pass: false, why: `output near-silent, max=${maxAbs}` };
      if (maxAbs > 1e6)  return { pass: false, why: `output runaway, max=${maxAbs}` };
      return { pass: true };
    },
  },
  {
    name: 'vowel morph (fractional param) gives smooth interpolated coefs',
    run() {
      const op = freshOp({ vowel: 0 });
      // c[0] for A = 8.11044e-06, for E = 4.36215e-06; at v=0.5 ≈ midpoint.
      op.setParam('vowel', 0.5);
      const expected = (8.11044e-06 + 4.36215e-06) / 2;
      const got = op._coef[0];
      if (Math.abs(got - expected) > 1e-15) return { pass: false, why: `c[0]=${got} exp=${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'integer vowel values select exact table rows',
    run() {
      const expC0 = [8.11044e-06, 4.36215e-06, 3.33819e-06, 1.13572e-06, 4.09431e-07];
      const op = freshOp();
      for (let v = 0; v < 5; v++) {
        op.setParam('vowel', v);
        if (op._coef[0] !== expC0[v]) return { pass: false, why: `v=${v} c[0]=${op._coef[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'each vowel A/E/I/O stays finite on sawtooth drive',
    run() {
      // 'U' omitted per author's self-oscillation warning.
      for (let v = 0; v < 4; v++) {
        const op = freshOp({ vowel: v });
        const out = drive(op, saw(110), 8192);
        for (let i = 0; i < out.length; i++) {
          if (!Number.isFinite(out[i])) return { pass: false, why: `vowel=${v} NaN at ${i}` };
          if (Math.abs(out[i]) > 1e6)    return { pass: false, why: `vowel=${v} runaway at ${i}=${out[i]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'different vowels produce different outputs on same input',
    run() {
      const inputFn = saw(110);
      const samples = 4096;
      // Reuse same input seed by recreating the saw generator.
      const outA = drive(freshOp({ vowel: 0 }), saw(110), samples);
      const outI = drive(freshOp({ vowel: 2 }), saw(110), samples);
      let diffs = 0;
      for (let i = 1000; i < samples; i++) if (Math.abs(outA[i] - outI[i]) > 1e-6) diffs++;
      if (diffs < 100) return { pass: false, why: `A vs I differ at only ${diffs} samples` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const a = drive(freshOp({ vowel: 1 }), saw(150), 4096);
      const b = drive(freshOp({ vowel: 1 }), saw(150), 4096);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ vowel: 0 });
      drive(op, saw(110), 4096);
      op.reset();
      for (let k = 0; k < 10; k++) {
        if (op._memory[k] !== 0) return { pass: false, why: `m[${k}]=${op._memory[k]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output, no NaN',
    run() {
      const op = freshOp({ vowel: 0 });
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
      const op = freshOp({ vowel: 0 });
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
  {
    name: 'param clamps — vowel ∈ [0, 4], NaN ignored',
    run() {
      const op = freshOp();
      op.setParam('vowel', -3);
      if (op._vowel !== 0) return { pass: false, why: `min got ${op._vowel}` };
      op.setParam('vowel', 99);
      if (op._vowel !== 4) return { pass: false, why: `max got ${op._vowel}` };
      op.setParam('vowel', NaN);
      if (op._vowel !== 4) return { pass: false, why: `NaN should be ignored` };
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
];

export default { opId: 'formant', tests };
