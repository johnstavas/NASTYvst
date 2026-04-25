// op_spring.test.js — math tests for #109 Parker 2011 / Välimäki 2010
// parametric spring reverb.
// Run via: node scripts/check_op_math.mjs

import { SpringOp } from './op_spring.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new SpringOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input, N) {
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  op.process({ in: input }, { l: outL, r: outR }, N);
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
      const { outL, outR } = render(freshOp({}), new Float32Array(1024), 1024);
      for (let i = 0; i < 1024; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse → dispersive tail (late energy non-zero)',
    run() {
      const N = 16384;
      const { outL, outR } = render(freshOp({}), impulse(N), N);
      const late = rms(outL, 2000, N) + rms(outR, 2000, N);
      if (late <= 1e-8) return { pass: false, why: `late=${late.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'dispersion spreads the impulse (dispersed output has lower crest factor)',
    run() {
      // Allpasses conserve energy; "dispersion" means peak is smeared
      // over time. So RMS stays similar but peak/RMS (crest) drops
      // substantially as dispersion increases.
      const N = 8192;
      const noDisp = render(freshOp({ dispersion: 0.0, decay: 0.5, numStagesHF: 0 }), impulse(N), N);
      const hiDisp = render(freshOp({ dispersion: 0.8, decay: 0.5, numStagesHF: 0 }), impulse(N), N);
      const crest = (buf) => {
        let pk = 0, s = 0;
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > pk) pk = a;
          s += buf[i] * buf[i];
        }
        const r = Math.sqrt(s / buf.length);
        return r > 0 ? pk / r : Infinity;
      };
      const c0 = crest(noDisp.outL);
      const c1 = crest(hiDisp.outL);
      if (!(c1 < c0 * 0.8)) return { pass: false, why: `crest no-disp=${c0.toFixed(2)} hi-disp=${c1.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'decay=0.9 tail exceeds decay=0.1 tail at late window',
    run() {
      const N = 24000;
      const hi = render(freshOp({ decay: 0.9,  dispersion: 0.6 }), impulse(N), N);
      const lo = render(freshOp({ decay: 0.1,  dispersion: 0.6 }), impulse(N), N);
      const eHi = rms(hi.outL, 12000, N);
      const eLo = rms(lo.outL, 12000, N);
      if (!(eHi > eLo * 2)) return { pass: false, why: `eHi=${eHi.toExponential(2)} eLo=${eLo.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'transitionHz: low cutoff removes more HF than high cutoff',
    run() {
      // Isolate C_lf branch (mixHF=0) and compare HF energy between a low
      // transition and a high transition. The low-cutoff run must have
      // less HF content. Reference-to-reference comparison is more
      // robust than LP/HP ratio, which depends on the 1-pole split point.
      const N = 12000;
      const op = { decay: 0.85, mixHF: 0, mixLF: 1 };
      const lo = render(freshOp({ ...op, transitionHz: 1500 }),  impulse(N), N);
      const hi = render(freshOp({ ...op, transitionHz: 10000 }), impulse(N), N);
      // Approximate HF energy: signal minus a 1-pole LP at ~800 Hz.
      const hfEnergy = (buf) => {
        let z = 0, s = 0;
        for (let i = 500; i < buf.length; i++) {
          z = 0.9 * z + 0.1 * buf[i];     // very gentle LP ≈ 800 Hz at 48k
          const hp = buf[i] - z;
          s += hp * hp;
        }
        return s;
      };
      const hLo = hfEnergy(lo.outL);
      const hHi = hfEnergy(hi.outL);
      if (!(hLo < hHi * 0.5)) return { pass: false, why: `HF@1.5k=${hLo.toExponential(2)} HF@10k=${hHi.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 1024;
      const a = render(freshOp({ decay: 0.7 }), impulse(N), N);
      const b = render(freshOp({ decay: 0.7 }), impulse(N), N);
      for (let i = 0; i < N; i++) {
        if (a.outL[i] !== b.outL[i] || a.outR[i] !== b.outR[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state — no residual tail after reset',
    run() {
      const op = freshOp({ decay: 0.9 });
      render(op, impulse(512), 512);
      op.reset();
      const { outL, outR } = render(op, new Float32Array(512), 512);
      for (let i = 0; i < 512; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'numStagesLF=0 and numStagesHF=0: cascade is identity',
    run() {
      // No AP stages → each branch is just a feedback delay + (LPF on lo).
      // Output must be finite and non-blowing.
      const N = 4000;
      const op = freshOp({ numStagesLF: 0, numStagesHF: 0, decay: 0.7 });
      const { outL, outR } = render(op, impulse(N), N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('decay', 99); op.setParam('decay', -1);
      op.setParam('dispersion', 99); op.setParam('dispersion', -1);
      op.setParam('transitionHz', 1e6); op.setParam('transitionHz', 0);
      op.setParam('chirpRate', 99); op.setParam('chirpRate', -1);
      op.setParam('numStagesLF', 9999); op.setParam('numStagesHF', 9999);
      op.setParam('numStagesLF', -5); op.setParam('numStagesHF', -5);
      op.setParam('mixLF', 99); op.setParam('mixHF', 99);
      op.setParam('decay', NaN); op.setParam('dispersion', Infinity);
      const N = 2048;
      const { outL, outR } = render(op, impulse(N, 0, 0.5), N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'extreme decay stays bounded (no runaway)',
    run() {
      const N = 65536;
      const { outL, outR } = render(freshOp({ decay: 0.95, dispersion: 0.85 }), impulse(N), N);
      let mx = 0;
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) return { pass: false, why: `nan at ${i}` };
        mx = Math.max(mx, Math.abs(outL[i]), Math.abs(outR[i]));
      }
      if (mx > 50) return { pass: false, why: `peak=${mx}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence',
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
      try { op.process({ in: new Float32Array(128) }, {}, 128); }
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

export default { opId: 'spring', tests };
