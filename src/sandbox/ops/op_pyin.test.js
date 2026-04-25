// op_pyin.test.js — pYIN pitch detector math tests.
// Run via: node scripts/check_op_math.mjs
// Primary: Mauch & Dixon 2014 ICASSP + c4dm/pyin Vamp source (GPL v2+).
//
// Note on tolerances: HMM pitch grid is 20 cents/bin (nBPS=5) and post-decode
// we emit the bin center, not a refined frequency. A 440 Hz sine lands on
// whichever bin is nearest — worst-case error is half a bin (~10 cents ≈ ±2.6 Hz
// at 440). Tolerances below reflect this quantization, unlike #76 yin which
// emits parabolic-refined τ.

import { PyinOp } from './op_pyin.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new PyinOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, input, N) {
  const f0 = new Float32Array(N);
  const vp = new Float32Array(N);
  const vf = new Float32Array(N);
  op.process({ in: input }, { f0, voicedProb: vp, voicedFlag: vf }, N);
  return { f0, vp, vf };
}

function sine(N, freq, sr = SR, amp = 0.5) {
  const out = new Float32Array(N);
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin(i * w);
  return out;
}

function harmonic(N, f0, sr = SR) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    out[i] = 0.5 * Math.sin(2*Math.PI * f0 * t)
           + 0.3 * Math.sin(2*Math.PI * 2*f0 * t)
           + 0.2 * Math.sin(2*Math.PI * 3*f0 * t);
  }
  return out;
}

// How many samples to render before the fixed-lag output is trustworthy:
// one window to fill + (lag+2) hops for Viterbi to latch.
function warmupN(op) {
  return op.W + (op._lagFrames + 4) * op.hop;
}

function lastReading(op, buf) {
  const { f0, vp, vf } = render(op, buf, buf.length);
  const i = buf.length - 1;
  return { f0: f0[i], vp: vp[i], vf: vf[i] };
}

// HMM bin-quantization tolerance: 20 cents max → ratio 2^(20/1200) ≈ 1.01163.
function withinHmmBin(fHat, fRef) {
  if (fHat <= 0) return false;
  const cents = 1200 * Math.log2(fHat / fRef);
  return Math.abs(cents) <= 12;  // ±12 cents = 1 bin (20 c) + slop
}

const tests = [
  {
    name: 'silence → f0=0, voicedProb=0, voicedFlag=0',
    run() {
      const op = freshOp({});
      const N = warmupN(op) + 512;
      const { f0, vp, vf } = render(op, new Float32Array(N), N);
      for (let i = 0; i < N; i++) {
        if (f0[i] !== 0 || vp[i] !== 0 || vf[i] !== 0)
          return { pass: false, why: `i=${i} f0=${f0[i]} vp=${vp[i]} vf=${vf[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: '440 Hz sine → f0 within one HMM bin (±12 cents)',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const { f0, vf } = lastReading(op, sine(N, 440));
      if (!vf) return { pass: false, why: `voicedFlag=0 at end` };
      if (!withinHmmBin(f0, 440)) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: '220 Hz sine → f0 within one HMM bin',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const { f0, vf } = lastReading(op, sine(N, 220));
      if (!vf) return { pass: false, why: `voicedFlag=0` };
      if (!withinHmmBin(f0, 220)) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: '110 Hz sine → f0 within one HMM bin',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const { f0, vf } = lastReading(op, sine(N, 110));
      if (!vf) return { pass: false, why: `voicedFlag=0` };
      if (!withinHmmBin(f0, 110)) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'harmonic complex @ 220 Hz → f0 at fundamental (no octave error)',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const { f0, vf } = lastReading(op, harmonic(N, 220));
      if (!vf) return { pass: false, why: `voicedFlag=0` };
      // Reject 110 Hz or 440 Hz octave errors.
      if (Math.abs(1200*Math.log2(f0/220)) > 20)
        return { pass: false, why: `f0=${f0.toFixed(3)} (octave error?)` };
      return { pass: true };
    },
  },
  {
    name: 'voiced tone → voicedFlag eventually latches to 1',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const { vf } = render(op, sine(N, 440), N);
      // Last quarter of output should be mostly voiced.
      let voiced = 0;
      for (let i = (N * 3) >> 2; i < N; i++) if (vf[i] >= 0.5) voiced++;
      const frac = voiced / (N - ((N * 3) >> 2));
      if (frac < 0.9) return { pass: false, why: `voiced frac=${frac.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'white noise → voicedFlag mostly 0 (unvoiced)',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const noise = new Float32Array(N);
      let s = 1;
      for (let i = 0; i < N; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        noise[i] = ((s / 0xFFFFFFFF) - 0.5) * 0.4;
      }
      const { vf } = render(op, noise, N);
      let unvoiced = 0;
      const start = (N * 3) >> 2;
      for (let i = start; i < N; i++) if (vf[i] < 0.5) unvoiced++;
      const frac = unvoiced / (N - start);
      if (frac < 0.5) return { pass: false, why: `unvoiced frac=${frac.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'voicedProb high for pure tone (>0.3 by end)',
    run() {
      const op = freshOp({});
      const N = 3 * warmupN(op);
      const { vp } = lastReading(op, sine(N, 440));
      if (vp < 0.3) return { pass: false, why: `voicedProb=${vp.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 4 * 2500;
      const sig = sine(N, 330);
      const a = render(freshOp({}), sig, N);
      const b = render(freshOp({}), sig, N);
      for (let i = 0; i < N; i++) {
        if (a.f0[i] !== b.f0[i] || a.vp[i] !== b.vp[i] || a.vf[i] !== b.vf[i])
          return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state',
    run() {
      const op = freshOp({});
      const N = 2 * warmupN(op);
      render(op, sine(N, 440), N);
      op.reset();
      const M = op.W + 64;
      const { f0, vp, vf } = render(op, new Float32Array(M), M);
      for (let i = 0; i < M; i++)
        if (f0[i] !== 0 || vp[i] !== 0 || vf[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('f0Min', 999999); op.setParam('f0Min', -1); op.setParam('f0Min', NaN);
      op.setParam('f0Max', 999999); op.setParam('f0Max', -1);
      op.setParam('windowMs', 99999); op.setParam('windowMs', -1); op.setParam('windowMs', Infinity);
      op.setParam('hopMs', 99999); op.setParam('hopMs', -1);
      op.setParam('prior', 99); op.setParam('prior', -5);
      op.setParam('yinTrust', 99); op.setParam('yinTrust', -1);
      op.setParam('selfTrans', 99); op.setParam('selfTrans', -1);
      op.setParam('lagFrames', 999); op.setParam('lagFrames', -1);
      const N = 2 * warmupN(op);
      const { f0, vp, vf } = render(op, sine(N, 330), N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(f0[i]) || !Number.isFinite(vp[i]) || !Number.isFinite(vf[i]))
          return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence output, no throw',
    run() {
      const op = freshOp({});
      try {
        const f0 = new Float32Array(256), vp = new Float32Array(256), vf = new Float32Array(256);
        op.process({}, { f0, voicedProb: vp, voicedFlag: vf }, 256);
        for (let i = 0; i < 256; i++)
          if (f0[i] !== 0 || vp[i] !== 0 || vf[i] !== 0) return { pass: false, why: `i=${i}` };
      } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: sine(256, 440) }, {}, 256); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() == W + lagFrames·hop',
    run() {
      const op = freshOp({});
      const expected = op.W + op._lagFrames * op.hop;
      if (op.getLatencySamples() !== expected)
        return { pass: false, why: `got ${op.getLatencySamples()} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'prior switches (0..4) all converge on 440 Hz sine',
    run() {
      for (let p = 0; p <= 4; p++) {
        const op = freshOp({ prior: p });
        const N = 3 * warmupN(op);
        const { f0, vf } = lastReading(op, sine(N, 440));
        if (!vf) return { pass: false, why: `prior=${p} unvoiced` };
        if (!withinHmmBin(f0, 440))
          return { pass: false, why: `prior=${p} f0=${f0.toFixed(3)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'HMM suppresses single-frame noise blip amid voiced tone',
    run() {
      // Voiced tone with 1 short noise burst: HMM self-transition should keep
      // f0 locked across the burst instead of flipping unvoiced.
      const op = freshOp({});
      const N = 4 * warmupN(op);
      const sig = sine(N, 440);
      // Overwrite a 1-hop noise burst near the end.
      const burstStart = N - 2 * op.hop;
      let s = 42;
      for (let i = burstStart; i < burstStart + op.hop; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        sig[i] = ((s / 0xFFFFFFFF) - 0.5) * 0.4;
      }
      const { f0, vf } = render(op, sig, N);
      // Check a point well before the burst (past warmup, no burst contamination).
      const probeIdx = warmupN(op) + op.hop;
      if (!(vf[probeIdx] >= 0.5)) return { pass: false, why: `pre-burst unvoiced @${probeIdx}` };
      if (!withinHmmBin(f0[probeIdx], 440))
        return { pass: false, why: `pre-burst f0=${f0[probeIdx].toFixed(3)}` };
      return { pass: true };
    },
  },
];

export default { opId: 'pyin', tests };
