// op_plate.test.js — math tests for #108 Dattorro 1997 plate.
// Run via: node scripts/check_op_math.mjs

import { PlateOp } from './op_plate.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new PlateOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, inL, inR, N) {
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  op.process({ l: inL, r: inR }, { l: outL, r: outR }, N);
  return { outL, outR };
}
function impulse(N, at = 0, amp = 1.0) {
  const b = new Float32Array(N); b[at] = amp; return b;
}
function rms(buf, start = 0, end = buf.length) {
  let s = 0, c = 0;
  for (let i = start; i < end; i++) { s += buf[i] * buf[i]; c++; }
  return Math.sqrt(s / Math.max(c, 1));
}

const tests = [
  {
    name: 'silence in → silence out',
    run() {
      const { outL, outR } = render(freshOp({}), new Float32Array(512), new Float32Array(512), 512);
      for (let i = 0; i < 512; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `i=${i}: L=${outL[i]} R=${outR[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse in → tail begins (not immediate; minimum latency ≈ id chain)',
    run() {
      const N = 4096;
      const { outL, outR } = render(freshOp({}), impulse(N, 0, 1.0), impulse(N, 0, 1.0), N);
      // First 100 samples should be silent (input diffusion + tank fill).
      for (let i = 0; i < 100; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `early non-zero at ${i}` };
      }
      // Later window should have energy.
      const e = rms(outL, 500, 4000) + rms(outR, 500, 4000);
      if (e <= 0) return { pass: false, why: 'no late energy' };
      return { pass: true };
    },
  },
  {
    name: 'stereo synthesis: L ≠ R (plate produces synthetic stereo per Dattorro)',
    run() {
      const N = 4096;
      const imp = impulse(N);
      const { outL, outR } = render(freshOp({}), imp, imp, N);
      let diff = 0;
      for (let i = 0; i < N; i++) diff += Math.abs(outL[i] - outR[i]);
      if (diff < 1e-3) return { pass: false, why: `L≈R, diff=${diff.toExponential(2)} — mono collapse` };
      return { pass: true };
    },
  },
  {
    name: 'decay=0.99 late tail exceeds decay=0.1 late tail',
    run() {
      // Early window is dominated by the input tap paths and is independent
      // of decay. The decay multiplier only affects tank circulations, so
      // measure far past the initial fill (0.4 s in at 48 kHz).
      const N = 32768;
      const impL = impulse(N, 0, 1);
      const impR = impulse(N, 0, 1);
      const hi = render(freshOp({ decay: 0.99, modDepth: 0 }), impL, impR, N);
      const lo = render(freshOp({ decay: 0.10, modDepth: 0 }), impL.slice(), impR.slice(), N);
      const eHi = rms(hi.outL, 20000, N) + rms(hi.outR, 20000, N);
      const eLo = rms(lo.outL, 20000, N) + rms(lo.outR, 20000, N);
      if (!(eHi > eLo * 2)) return { pass: false, why: `eHi=${eHi.toExponential(2)} eLo=${eLo.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'damping=0.5 darkens the tail (more LF than HF)',
    run() {
      const N = 4096;
      const impL = impulse(N), impR = impulse(N);
      // Compare tail spectra crudely via one-pole HP/LP split on tail window.
      const { outL } = render(freshOp({ decay: 0.9, damping: 0.5, modDepth: 0 }), impL, impR, N);
      let lp = 0, hp = 0, z = 0;
      for (let i = 1000; i < N; i++) {
        z = 0.99 * z + 0.01 * outL[i];
        lp += z * z;
        hp += (outL[i] - z) * (outL[i] - z);
      }
      if (!(lp > hp)) return { pass: false, why: `lp=${lp.toExponential(2)} hp=${hp.toExponential(2)} — not dark` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 1024;
      const imp = impulse(N);
      const a = render(freshOp({ decay: 0.7, modDepth: 0 }), imp, imp.slice(), N);
      const b = render(freshOp({ decay: 0.7, modDepth: 0 }), imp.slice(), imp.slice(), N);
      for (let i = 0; i < N; i++) {
        if (a.outL[i] !== b.outL[i] || a.outR[i] !== b.outR[i]) {
          return { pass: false, why: `i=${i}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state — no residual tail after reset',
    run() {
      const N = 512;
      const op = freshOp({ decay: 0.9 });
      render(op, impulse(N, 0, 1), impulse(N, 0, 1), N); // excite
      op.reset();
      const { outL, outR } = render(op, new Float32Array(N), new Float32Array(N), N);
      for (let i = 0; i < N; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('decay', 99); op.setParam('decay', -5);
      op.setParam('predelayMs', 9999); op.setParam('predelayMs', -1);
      op.setParam('bandwidth', 99); op.setParam('damping', 99);
      op.setParam('size', 99); op.setParam('size', -1);
      op.setParam('modDepth', 999); op.setParam('modRateHz', 9999);
      op.setParam('decay', NaN); op.setParam('modRateHz', Infinity);
      const N = 1024;
      const { outL, outR } = render(op, impulse(N, 0, 0.5), impulse(N, 0, 0.5), N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) {
          return { pass: false, why: `i=${i}: L=${outL[i]} R=${outR[i]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'extreme decay stays bounded (no runaway)',
    run() {
      const N = 16384;
      const impL = new Float32Array(N); impL[0] = 1;
      const impR = new Float32Array(N); impR[0] = 1;
      const { outL, outR } = render(freshOp({ decay: 0.99 }), impL, impR, N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) return { pass: false, why: `nan at ${i}` };
        if (Math.abs(outL[i]) > 20 || Math.abs(outR[i]) > 20) return { pass: false, why: `runaway at ${i}: ${outL[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'predelay delays the tail onset',
    run() {
      const N = 4096;
      const imp = impulse(N);
      const no = render(freshOp({ predelayMs: 0, decay: 0.9 }), imp, imp.slice(), N);
      const yes = render(freshOp({ predelayMs: 20, decay: 0.9 }), imp.slice(), imp.slice(), N);
      const onsetNo  = no.outL.findIndex(v => Math.abs(v) > 1e-5);
      const onsetYes = yes.outL.findIndex(v => Math.abs(v) > 1e-5);
      // 20ms at 48k = 960 samples. Allow slack for input diffusion.
      if (!(onsetYes > onsetNo + 800)) return { pass: false, why: `onsetNo=${onsetNo} onsetYes=${onsetYes}` };
      return { pass: true };
    },
  },
  {
    name: 'missing inputs → silence',
    run() {
      const N = 256;
      const op = freshOp({});
      const outL = new Float32Array(N), outR = new Float32Array(N);
      op.process({}, { l: outL, r: outR }, N);
      for (let i = 0; i < N; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ l: new Float32Array(128), r: new Float32Array(128) }, {}, 128); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
];

export default { opId: 'plate', tests };
