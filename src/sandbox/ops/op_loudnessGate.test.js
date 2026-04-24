// op_loudnessGate.test.js — real-math tests for op_loudnessGate.
// Run via: node scripts/check_op_math.mjs
//
// BS.1770-5 §5.1 two-stage gating (abs -70 LUFS, rel -10 LU below
// ungated). This op takes K-weighted audio (we feed raw for the tests —
// spectral side is covered by op #51); output is integrated LUFS held
// between 100 ms hop boundaries.
//
// Coverage:
//   - Before first 400 ms block elapses → floor
//   - Steady sine 0 dBFS (single channel) → -3 LUFS within ~0.1
//   - DC 1.0 → -0.691 LUFS
//   - Silence → floor (abs gate rejects all blocks)
//   - Quiet tail doesn't drag integrated down (abs gate protects) —
//     programme at -20 LUFS with a tail at -80 LUFS still reads -20
//   - Loud transient within silence (-70 LUFS sine burst, rest silence):
//     shows relative gate at work
//   - G=0 → floor
//   - reset() reverts to floor
//   - sample-rate independence (44.1k vs 48k → same integrated)
//   - determinism

import { LoudnessGateOp } from './op_loudnessGate.worklet.js';

const approx = (a, b, eps = 0.1) => Math.abs(a - b) <= eps;

function freshOp(sr = 48000) {
  const op = new LoudnessGateOp(sr);
  op.reset();
  return op;
}

function render(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { lufs: out }, n);
  return { inBuf, out };
}

const tests = [
  // ---- floor behaviours ---------------------------------------------
  {
    name: 'before first 400 ms block elapses → LUFS_FLOOR (~-120.7)',
    run() {
      const op = freshOp(48000);
      const sr = 48000;
      // 300 ms — no full 400 ms block yet
      const { out } = render(op, 1.0, Math.floor(sr * 0.3));
      if (out[out.length - 1] > -100) {
        return { pass: false, why: `final=${out[out.length-1]} (expected near floor)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'total silence → integrated stays at floor (abs gate rejects)',
    run() {
      const op = freshOp(48000);
      const { out } = render(op, 0, 48000 * 3);
      if (out[out.length - 1] > -100) {
        return { pass: false, why: `final=${out[out.length-1]}` };
      }
      return { pass: true };
    },
  },

  // ---- calibration --------------------------------------------------
  {
    name: 'DC 1.0 for 3 s → ~-0.691 LUFS (MS=1, G=1)',
    run() {
      const op = freshOp(48000);
      const { out } = render(op, 1.0, 48000 * 3);
      const final = out[out.length - 1];
      if (!approx(final, -0.691, 0.01)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },
  {
    name: 'Sine 1 kHz 0 dBFS 3 s → ~-3.70 LUFS (MS=0.5 per channel)',
    run() {
      const op = freshOp(48000);
      const sr = 48000;
      const N = sr * 3;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * 1000 * i / sr);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { lufs: out }, N);
      const final = out[N - 1];
      // -0.691 + 10·log10(0.5) = -3.70
      if (!approx(final, -3.70, 0.1)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },

  // ---- abs gate (−70 LUFS) ------------------------------------------
  {
    name: 'abs gate: programme at -20 LUFS with -80 LUFS tail stays ≈-20',
    run() {
      const op = freshOp(48000);
      const sr = 48000;
      // -20 LUFS means 10·log10(MS) = -20 + 0.691 = -19.309
      // MS = 10^(-1.9309) = 0.01173 → rms = 0.1083, sine amp = 0.1531
      const ampProg = Math.sqrt(2) * Math.sqrt(Math.pow(10, (-20 + 0.691) / 10));
      // -80 LUFS is below abs gate (-70), should be rejected
      const ampTail = Math.sqrt(2) * Math.sqrt(Math.pow(10, (-80 + 0.691) / 10));
      const N1 = sr * 3; // programme
      const N2 = sr * 3; // tail
      const buf1 = new Float32Array(N1);
      const buf2 = new Float32Array(N2);
      for (let i = 0; i < N1; i++) buf1[i] = ampProg * Math.sin(2 * Math.PI * 500 * i / sr);
      for (let i = 0; i < N2; i++) buf2[i] = ampTail * Math.sin(2 * Math.PI * 500 * i / sr);
      const out1 = new Float32Array(N1);
      const out2 = new Float32Array(N2);
      op.process({ in: buf1 }, { lufs: out1 }, N1);
      op.process({ in: buf2 }, { lufs: out2 }, N2);
      const final = out2[N2 - 1];
      if (!approx(final, -20, 0.5)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },

  // ---- rel gate (−10 LU below ungated) ------------------------------
  {
    name: 'rel gate: -10 LUFS + -25 LUFS sections → integrated ≈ loud section (rel gate drops quiet)',
    run() {
      const op = freshOp(48000);
      const sr = 48000;
      // Loud section at -10 LUFS
      const ampLoud = Math.sqrt(2) * Math.sqrt(Math.pow(10, (-10 + 0.691) / 10));
      // Quiet section at -25 LUFS — passes abs gate (-70) but
      // ungated mean will be ≈halfway; -10 LU relative threshold
      // should drop the quiet section.
      const ampQuiet = Math.sqrt(2) * Math.sqrt(Math.pow(10, (-25 + 0.691) / 10));
      const N = sr * 3;
      const bufL = new Float32Array(N);
      const bufQ = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        bufL[i] = ampLoud  * Math.sin(2 * Math.PI * 500 * i / sr);
        bufQ[i] = ampQuiet * Math.sin(2 * Math.PI * 500 * i / sr);
      }
      const outL = new Float32Array(N);
      const outQ = new Float32Array(N);
      op.process({ in: bufL }, { lufs: outL }, N);
      op.process({ in: bufQ }, { lufs: outQ }, N);
      const final = outQ[N - 1];
      // Without rel gate, mean of the two MS values (in dB terms ≈-14.5 LUFS)
      // With rel gate dropping the quiet section, integrated → loud section (-10)
      if (!approx(final, -10, 0.5)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },

  // ---- channel weight -----------------------------------------------
  {
    name: 'G=0 → all MS products zero → integrated = floor',
    run() {
      const op = freshOp(48000);
      op.setParam('channelWeight', 0);
      const { out } = render(op, 1.0, 48000 * 3);
      if (out[out.length - 1] > -100) return { pass: false, why: `final=${out[out.length-1]}` };
      return { pass: true };
    },
  },

  // ---- sample-rate independence ------------------------------------
  {
    name: 'Fs=44.1k gives same integrated as 48k for steady sine',
    run() {
      const op441 = freshOp(44100);
      const op480 = freshOp(48000);
      const freq = 500;
      const run = (op, sr) => {
        const N = sr * 3;
        const buf = new Float32Array(N);
        for (let i = 0; i < N; i++) buf[i] = Math.sin(2 * Math.PI * freq * i / sr);
        const out = new Float32Array(N);
        op.process({ in: buf }, { lufs: out }, N);
        return out[N - 1];
      };
      const f441 = run(op441, 44100);
      const f480 = run(op480, 48000);
      if (!approx(f441, f480, 0.05)) return { pass: false, why: `441=${f441} 480=${f480}` };
      return { pass: true };
    },
  },

  // ---- infrastructure -----------------------------------------------
  {
    name: 'reset() reverts integrated to floor and clears pool',
    run() {
      const op = freshOp(48000);
      render(op, 1.0, 48000 * 3);
      if (op._integratedLufs > -100 === false) {
        // First sanity: we should be near -0.691 here
        return { pass: false, why: `pre-reset int=${op._integratedLufs} (expected non-floor)` };
      }
      op.reset();
      if (op._integratedLufs > -100) return { pass: false, why: `post-reset int=${op._integratedLufs}` };
      if (op._absPassN !== 0) return { pass: false, why: `absPassN=${op._absPassN}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input advances block clock, output holds at current integrated',
    run() {
      const op = freshOp(48000);
      render(op, 1.0, 48000 * 2); // charge
      const held = op._integratedLufs;
      const out = new Float32Array(48000);
      op.process({}, { lufs: out }, 48000);
      // out is Float32Array, held is double — compare via Math.fround.
      if (out[0] !== Math.fround(held)) return { pass: false, why: `first=${out[0]} held=${held}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp(48000);
      op.process({ in: new Float32Array(64).fill(1) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'G clamped to [0, 2]',
    run() {
      const op = freshOp(48000);
      op.setParam('channelWeight', -5);
      if (op._G !== 0) return { pass: false, why: `neg→${op._G}` };
      op.setParam('channelWeight', 99);
      if (op._G !== 2) return { pass: false, why: `big→${op._G}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const opA = freshOp(48000);
      const opB = freshOp(48000);
      const N = 48000 * 2;
      const buf = new Float32Array(N);
      for (let i = 0; i < N; i++) buf[i] = Math.sin(i * 0.01) * 0.5;
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      opA.process({ in: buf }, { lufs: oA }, N);
      opB.process({ in: buf }, { lufs: oB }, N);
      for (let i = 0; i < N; i++) {
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} ${oA[i]}≠${oB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'denormal flush on sub-block accumulator',
    run() {
      const op = freshOp(48000);
      render(op, 1e-20, 10000);
      render(op, 0, 10000);
      if (op._subAcc !== 0) return { pass: false, why: `subAcc=${op._subAcc}` };
      return { pass: true };
    },
  },
];

export default { opId: 'loudnessGate', tests };
