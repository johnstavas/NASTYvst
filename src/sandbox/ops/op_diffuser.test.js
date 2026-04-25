// op_diffuser.test.js — real-math tests for op_diffuser.
// Primary: JOS PASP "Allpass as Two-Comb Cascade" + "Schroeder Allpass Sections".

import { DiffuserOp } from './op_diffuser.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new DiffuserOp(SR);
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
    const buf = new Float32Array(c);
    op.process({ in: inp }, { out: buf }, c);
    out.set(buf, pos);
    pos += c;
  }
  return out;
}

function rms(arr, start = 0, end = arr.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / (end - start));
}

const tests = [
  {
    name: 'silent input → silent output',
    run() {
      const out = drive(freshOp({ g: 0.7 }), () => 0, 4096);
      for (let i = 0; i < 4096; i++) {
        if (out[i] !== 0) return { pass: false, why: `[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'allpass: flat magnitude at multiple frequencies (RMS preserved)',
    run() {
      // True allpass: steady-state sine RMS_out ≈ RMS_in for any frequency.
      // JOS: "Allpass when b_0 = a_M". Test cascade at 4 well-separated freqs.
      const INPUT_RMS = 0.5 / Math.SQRT2;  // for amp=0.5 sine
      for (const f of [200, 1000, 4000, 10000]) {
        const op = freshOp({ g: 0.7 });
        const N = 16384;
        const out = drive(op, (n) => 0.5 * Math.sin(2 * Math.PI * f * n / SR), N);
        // Measure after transient (tail half of buffer).
        const r = rms(out, N / 2, N);
        if (Math.abs(r - INPUT_RMS) > 0.02) {
          return { pass: false, why: `f=${f}: out RMS ${r.toFixed(4)} vs expected ${INPUT_RMS.toFixed(4)}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse response is not a single impulse (diffusion)',
    run() {
      // Schroeder allpass cascade spreads an impulse into a dense pattern.
      const op = freshOp({ g: 0.7 });
      const N = 4096;
      const inp = new Float32Array(N); inp[0] = 1;
      const out = new Float32Array(N);
      op.process({ in: inp }, { out }, N);
      // Count samples with |value| > 0.001 — should be many, not just 1.
      let nonZero = 0;
      for (let i = 0; i < N; i++) if (Math.abs(out[i]) > 0.001) nonZero++;
      if (nonZero < 20) return { pass: false, why: `only ${nonZero} non-zero samples — not diffusing` };
      return { pass: true };
    },
  },
  {
    name: 'g=0 → passthrough (allpass collapses to pure delay line cascade with 0-coef feedback)',
    run() {
      // With g=0, v(n) = x(n), y(n) = v(n-M) — each section is a pure delay.
      // So the full cascade is just input delayed by (M0+M1+M2+M3) samples.
      const op = freshOp({ g: 0 });
      const N = 4096;
      const inp = new Float32Array(N); inp[0] = 1;
      const out = new Float32Array(N);
      op.process({ in: inp }, { out }, N);
      // Latency should equal the sum of delays; the impulse should land at
      // exactly that sample index, and nowhere else.
      const lat = op.getLatencySamples();
      if (lat <= 0 || lat >= N) return { pass: false, why: `latency=${lat}` };
      if (Math.abs(out[lat] - 1) > 1e-6) return { pass: false, why: `no impulse at lat=${lat}: out[lat]=${out[lat]}` };
      // all other samples should be zero
      for (let i = 0; i < N; i++) {
        if (i !== lat && Math.abs(out[i]) > 1e-6) return { pass: false, why: `extra energy at ${i}=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'g clamps to ±0.99',
    run() {
      const op = freshOp();
      op.setParam('g', 5);     if (op._g !== 0.99) return { pass: false, why: `g upper ${op._g}` };
      op.setParam('g', -5);    if (op._g !== -0.99) return { pass: false, why: `g lower ${op._g}` };
      op.setParam('g', NaN);   if (op._g !== -0.99) return { pass: false, why: `NaN not ignored` };
      return { pass: true };
    },
  },
  {
    name: 'size clamps to [0.5, 2.0]',
    run() {
      const op = freshOp();
      op.setParam('size', 10);    if (op._size !== 2.0) return { pass: false, why: `size upper ${op._size}` };
      op.setParam('size', 0.01);  if (op._size !== 0.5) return { pass: false, why: `size lower ${op._size}` };
      return { pass: true };
    },
  },
  {
    name: 'size scales delays: latency increases with size',
    run() {
      const sm = freshOp({ size: 0.5 });
      const lg = freshOp({ size: 2.0 });
      if (lg.getLatencySamples() <= sm.getLatencySamples()) {
        return { pass: false, why: `lg.lat=${lg.getLatencySamples()} sm.lat=${sm.getLatencySamples()}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset clears all 4 section states',
    run() {
      const op = freshOp({ g: 0.7 });
      drive(op, (n) => Math.sin(n * 0.1), 8192);
      op.reset();
      for (const v of [op._v0, op._v1, op._v2, op._v3]) {
        for (let i = 0; i < v.length; i++) {
          if (v[i] !== 0) return { pass: false, why: `state not cleared: [${i}]=${v[i]}` };
        }
      }
      if (op._w[0] !== 0 || op._w[1] !== 0 || op._w[2] !== 0 || op._w[3] !== 0) {
        return { pass: false, why: `write indices not zeroed: ${Array.from(op._w)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output, no NaN',
    run() {
      const op = freshOp({ g: 0.7 });
      const out = new Float32Array(512);
      op.process({}, { out }, 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(out[i]) || out[i] !== 0) return { pass: false, why: `[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no crash',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const a = drive(freshOp({ g: 0.7 }), (n) => Math.sin(n * 0.1), 2048);
      const b = drive(freshOp({ g: 0.7 }), (n) => Math.sin(n * 0.1), 2048);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'stability on loud noise — no runaway',
    run() {
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const out = drive(freshOp({ g: 0.99 }), () => rng() * 0.9, 16384);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i]) || Math.abs(out[i]) > 10) return { pass: false, why: `[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'diffuser', tests };
