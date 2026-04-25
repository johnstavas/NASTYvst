// op_envelopeFollower.test.js — Bram de Jong AR envelope follower (musicdsp #136).

import { EnvelopeFollowerOp } from './op_envelopeFollower.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new EnvelopeFollowerOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, input, N) {
  const out = new Float32Array(N);
  op.process({ in: input }, { out }, N);
  return out;
}

function ones(N, v = 1) { const a = new Float32Array(N); a.fill(v); return a; }

const tests = [
  {
    name: 'DC step rises toward |x|=1 (peak mode)',
    run() {
      const op = freshOp({ attack: 5, release: 120, mode: 0 });
      const out = render(op, ones(SR), SR); // 1 second @ 1.0 DC
      // After ~5 attack time constants (25 ms = 1200 samples), envelope ≥ 0.99·1.
      if (out[2400] < 0.99) return { pass: false, why: `after 50ms env=${out[2400]}` };
      if (out[SR - 1] < 0.999) return { pass: false, why: `steady-state env=${out[SR - 1]}` };
      return { pass: true };
    },
  },
  {
    name: "Bram's -40dB convention: env falls to ≤1% within release_ms after input removal",
    run() {
      const relMs = 50;
      const op = freshOp({ attack: 0.1, release: relMs, mode: 0 });
      // Prime to env=1, then feed zeros for exactly relMs.
      render(op, ones(4800), 4800);
      const relSamples = Math.round(SR * relMs * 0.001);
      const out = render(op, new Float32Array(relSamples), relSamples);
      // Bram's claim: env ≈ 1% at end of release window.
      // Allow ±1% slack around the 1% target.
      if (out[relSamples - 1] > 0.02) return { pass: false, why: `env=${out[relSamples - 1]} > 2% at release boundary` };
      if (out[relSamples - 1] < 0.003) return { pass: false, why: `env=${out[relSamples - 1]} < 0.3% (too fast)` };
      return { pass: true };
    },
  },
  {
    name: 'attack > 0: envelope does not instantly jump to |x|',
    run() {
      const op = freshOp({ attack: 50, release: 500, mode: 0 });
      const out = render(op, ones(16), 16);
      // 50ms attack @ 48kHz → 2400 samples. 16 samples ≪ 1 τ, so env ≪ 1.
      if (out[15] > 0.05) return { pass: false, why: `env jumps too fast: ${out[15]}` };
      return { pass: true };
    },
  },
  {
    name: 'release > 0: envelope decays gradually after input drops',
    run() {
      const op = freshOp({ attack: 0.1, release: 500, mode: 0 });
      render(op, ones(4800), 4800); // prime
      const out = render(op, new Float32Array(16), 16);
      // 16 samples ≪ 500ms release; env should still be near 1.
      if (out[15] < 0.98) return { pass: false, why: `env decays too fast: ${out[15]}` };
      return { pass: true };
    },
  },
  {
    name: 'full-wave rectification: sign-flipped input produces identical envelope',
    run() {
      const a = freshOp({ attack: 5, release: 120, mode: 0 });
      const b = freshOp({ attack: 5, release: 120, mode: 0 });
      const sig = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) sig[i] = Math.sin(2 * Math.PI * 100 * i / SR);
      const neg = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) neg[i] = -sig[i];
      const ea = render(a, sig, 1024);
      const eb = render(b, neg, 1024);
      for (let i = 0; i < 1024; i++) {
        if (Math.abs(ea[i] - eb[i]) > 1e-6) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'RMS mode: DC 1.0 → env → 1.0 (sqrt(1²) = 1)',
    run() {
      const op = freshOp({ attack: 0.5, release: 5, mode: 1 });
      const out = render(op, ones(4096), 4096);
      if (Math.abs(out[4000] - 1) > 0.02) return { pass: false, why: `env=${out[4000]}` };
      return { pass: true };
    },
  },
  {
    name: 'RMS mode: 0.5-amplitude sine settles near sqrt(1/2)·0.5 ≈ 0.354',
    run() {
      const op = freshOp({ attack: 1, release: 100, mode: 1 });
      const sig = new Float32Array(SR);
      for (let i = 0; i < SR; i++) sig[i] = 0.5 * Math.sin(2 * Math.PI * 200 * i / SR);
      const out = render(op, sig, SR);
      // RMS of 0.5·sin is 0.5/√2 ≈ 0.3536.
      // With a slow release coef the smoothed output ripples around this.
      let sum = 0;
      for (let i = SR - 4800; i < SR; i++) sum += out[i];
      const avg = sum / 4800;
      if (Math.abs(avg - 0.3536) > 0.05) return { pass: false, why: `avg env=${avg}` };
      return { pass: true };
    },
  },
  {
    name: 'zero input → zero output',
    run() {
      const op = freshOp({});
      const out = render(op, new Float32Array(256), 256);
      for (let i = 0; i < 256; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'env is always ≥ 0 (one-sided)',
    run() {
      const op = freshOp({});
      const sig = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) sig[i] = Math.sin(2 * Math.PI * 440 * i / SR);
      const out = render(op, sig, 1024);
      for (let i = 0; i < 1024; i++) if (out[i] < 0) return { pass: false, why: `i=${i} env=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range / NaN stay finite',
    run() {
      const op = freshOp({});
      op.setParam('attack',  9999); op.setParam('attack',  -1); op.setParam('attack',  NaN);
      op.setParam('release', 9999); op.setParam('release', -1); op.setParam('release', NaN);
      op.setParam('mode',    9);    op.setParam('mode',    -1); op.setParam('mode',    NaN);
      const out = render(op, ones(256), 256);
      for (let i = 0; i < 256; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent, state flushed',
    run() {
      const op = freshOp({});
      const out = new Float32Array(64);
      try { op.process({}, { out }, 64); } catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: ones(64) }, {}, 64); }
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
    name: 'determinism: two fresh ops identical',
    run() {
      const sig = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) sig[i] = Math.sin(2 * Math.PI * 300 * i / SR);
      const a = render(freshOp({ attack: 5, release: 120 }), sig, 2048);
      const b = render(freshOp({ attack: 5, release: 120 }), sig, 2048);
      for (let i = 0; i < 2048; i++) {
        if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({});
      render(op, ones(4800), 4800); // prime env → 1
      op.reset();
      const out = render(op, new Float32Array(64), 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} env=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: N in one block == two half-blocks',
    run() {
      const sig = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) sig[i] = Math.sin(2 * Math.PI * 150 * i / SR);
      const r1 = render(freshOp({}), sig, 1024);
      const op2 = freshOp({});
      const a = new Float32Array(512), b = new Float32Array(512);
      op2.process({ in: sig.subarray(0, 512) }, { out: a }, 512);
      op2.process({ in: sig.subarray(512, 1024) }, { out: b }, 512);
      for (let i = 0; i < 512; i++) {
        if (Math.abs(r1[i]       - a[i]) > 1e-6) return { pass: false, why: `A i=${i}` };
        if (Math.abs(r1[i + 512] - b[i]) > 1e-6) return { pass: false, why: `B i=${i}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'envelopeFollower', tests };
