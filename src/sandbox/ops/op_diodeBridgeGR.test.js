// op_diodeBridgeGR.test.js — math + stress tests for op_diodeBridgeGR.
// Run via: node scripts/check_op_math.mjs
//
// Phenomenological diode-bridge GR cell (Neve 33609/2254). Memoryless.
// Tier-S character op — 15-20 tests target. Distinct from other Cluster A
// members by PURE-ODD distortion (3H + 5H from cubic, no 2H by topology
// symmetry) plus optional asymmetry knob for component-mismatch realism.

import { DiodeBridgeGROp } from './op_diodeBridgeGR.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DiodeBridgeGROp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function runBlocks(op, totalN, audioBuf, cvBuf) {
  const out = new Float32Array(totalN);
  let pos = 0;
  while (pos < totalN) {
    const n = Math.min(N, totalN - pos);
    const inputs = {};
    if (audioBuf) inputs.audio = audioBuf.subarray(pos, pos + n);
    if (cvBuf)    inputs.cv    = cvBuf.subarray(pos, pos + n);
    op.process(inputs, { out: out.subarray(pos, pos + n) }, n);
    pos += n;
  }
  return out;
}

function rms(x, start, end) {
  let s = 0; const n = end - start;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

function bin(x, start, end, f, sr) {
  const N = end - start;
  let re = 0, im = 0;
  const w = 2 * Math.PI * f / sr;
  for (let i = 0; i < N; i++) {
    re += x[start + i] * Math.cos(w * i);
    im -= x[start + i] * Math.sin(w * i);
  }
  return 2 * Math.sqrt(re * re + im * im) / N;
}

function intCycleWindow(sr, fundamental, approxLen) {
  const period = sr / fundamental;
  const cycles = Math.round(approxLen / period);
  return Math.round(cycles * period);
}

const tests = [
  // ---- correctness: identity ----------------------------------------------
  {
    name: 'cv=0 → output = audio (unity gain, no compression)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: out=${out[i]} vs audio=${audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv < 0 → unity gain (bridge only attenuates on positive control commands)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
      cv.fill(-10);
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: gain curve --------------------------------------------
  {
    name: 'cv = cutoffScale → gain = 0.5 at default β=1.8',
    run() {
      const op = freshOp({ distortion: 0, asymmetry: 0 });
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      cv.fill(8);  // = cutoffScale
      const out = runBlocks(op, total, audio, cv);
      // gain = 1/(1 + 1^1.8) = 0.5 exactly
      if (!approx(out[100], 0.25, 1e-4)) return { pass: false, why: `out[100]=${out[100]} expected 0.25` };
      return { pass: true };
    },
  },
  {
    name: 'gain curve monotonic across cv range',
    run() {
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      const cvValues = [0, 2, 4, 8, 16, 32];
      const gains = [];
      for (const cvVal of cvValues) {
        const op = freshOp({ distortion: 0, asymmetry: 0 });
        const cv = new Float32Array(total);
        cv.fill(cvVal);
        const out = runBlocks(op, total, audio, cv);
        gains.push(out[100] / 0.5);
      }
      for (let i = 1; i < gains.length; i++) {
        if (gains[i] >= gains[i - 1]) return { pass: false, why: `not monotonic: ${gains}` };
      }
      if (!approx(gains[0], 1.0, 1e-6)) return { pass: false, why: `cv=0: ${gains[0]}` };
      if (!approx(gains[3], 0.5, 1e-3)) return { pass: false, why: `cv=8: ${gains[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'knee SOFTER than fetVVR β=2 but SHARPER than varMuTube β=1.5',
    run() {
      // diodeBridgeGR β=1.8 sits between varMuTube (1.5) and fetVVR (2.0).
      // At cv = 2*cutoffScale (norm=2):
      //   β=1.5 → gain = 1/(1+2.83) = 0.261
      //   β=1.8 → gain = 1/(1+3.48) = 0.223
      //   β=2.0 → gain = 1/(1+4.00) = 0.200
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      const opSoft = freshOp({ cutoffScale: 10, curveExponent: 1.5, distortion: 0, asymmetry: 0 });
      const opMid  = freshOp({ cutoffScale: 10, curveExponent: 1.8, distortion: 0, asymmetry: 0 });
      const opHard = freshOp({ cutoffScale: 10, curveExponent: 2.0, distortion: 0, asymmetry: 0 });
      const cv = new Float32Array(total);
      cv.fill(20);  // 2× cutoff
      const gSoft = runBlocks(opSoft, total, audio, cv)[100] / 0.5;
      const gMid  = runBlocks(opMid,  total, audio, cv)[100] / 0.5;
      const gHard = runBlocks(opHard, total, audio, cv)[100] / 0.5;
      // β=1.8 should produce gain BETWEEN 1.5 and 2.0 results.
      if (!(gMid < gSoft && gMid > gHard)) {
        return { pass: false, why: `β=1.8 should sit between β=1.5 (${gSoft}) and β=2.0 (${gHard}); got ${gMid}` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: PURE-ODD distortion (signature of diode bridge) -------
  {
    name: 'distortion=0, asymmetry=0 → clean output (no harmonics)',
    run() {
      const op = freshOp({ distortion: 0, asymmetry: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(20);
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      if (mag2 > 1e-5) return { pass: false, why: `2H = ${mag2} (expected ~0)` };
      if (mag3 > 1e-5) return { pass: false, why: `3H = ${mag3} (expected ~0)` };
      return { pass: true };
    },
  },
  {
    name: 'distortion>0 produces 3H, NO 2H, NO 4H (diode-bridge topology symmetry)',
    run() {
      // KEY signature vs other Cluster A members:
      // - varMuTube: pure even (2H + 4H, no 3H)
      // - fetVVR: mixed (independent 2H + 3H)
      // - blackmerVCA: clean by default
      // - diodeBridgeGR: pure ODD 3H (cubic y³ for sine input → 1H + 3H only;
      //   no 5H because Fourier of sin³ truncates at 3H exactly).
      const op = freshOp({ distortion: 0.3, asymmetry: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(8);  // moderate compression
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      const mag4 = bin(out, 0, total, 4 * f, SR);
      // 3H must be present; 2H + 4H must be ~0 by topology symmetry.
      if (mag3 < 1e-4) return { pass: false, why: `3H = ${mag3} (expected nonzero)` };
      if (mag2 > 1e-5) return { pass: false, why: `2H = ${mag2} (DIODE BRIDGE → expected ~0)` };
      if (mag4 > 1e-5) return { pass: false, why: `4H = ${mag4} (pure-odd distortion → expected ~0)` };
      return { pass: true };
    },
  },
  {
    name: 'asymmetry > 0 introduces 2H + 4H (component-mismatch realism)',
    run() {
      const op = freshOp({ distortion: 0, asymmetry: 0.05 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(8);
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      // asymmetry · |y| Fourier: DC + 2H + 4H + ...
      // No 3H from asymmetry alone (distortion=0 here).
      if (mag2 < 1e-4) return { pass: false, why: `2H = ${mag2} (expected nonzero from asymmetry)` };
      if (mag3 > 1e-5) return { pass: false, why: `3H = ${mag3} (expected ~0 with distortion=0)` };
      return { pass: true };
    },
  },

  // ---- correctness: trim --------------------------------------------------
  {
    name: 'trim = +6 dB doubles output (independent of cv)',
    run() {
      const op = freshOp({ trim: 6.0206, distortion: 0, asymmetry: 0 });
      const total = 1024;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      const cv = new Float32Array(total);  // cv=0
      const out = runBlocks(op, total, audio, cv);
      if (!approx(out[100], 1.0, 1e-4)) return { pass: false, why: `out[100]=${out[100]} expected 1.0` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------------
  {
    name: 'missing audio input → silent output',
    run() {
      const op = freshOp({});
      const out = new Float32Array(N);
      try { op.process({}, { out }, N); } catch (e) { return { pass: false, why: `${e}` }; }
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing cv input → unity gain',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.4;
      const out = runBlocks(op, total, audio, null);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no throw)',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: `${e}` }; }
      return { pass: true };
    },
  },
  {
    name: 'NaN/inf params clamped: output stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['cutoffScale', 'curveExponent', 'distortion', 'asymmetry', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const audio = new Float32Array(N); audio.fill(0.5);
      const cv    = new Float32Array(N); cv.fill(10);
      const out = runBlocks(op, N, audio, cv);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN cv falls through to unity gain',
    run() {
      const op = freshOp({});
      const audio = new Float32Array(N); audio.fill(0.5);
      const cv    = new Float32Array(N); for (let i = 0; i < N; i++) cv[i] = NaN;
      const out = runBlocks(op, N, audio, cv);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
        if (!approx(out[i], 0.5, 1e-7)) return { pass: false, why: `i=${i}: NaN cv didn't fall to unity` };
      }
      return { pass: true };
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // STRESS TESTS — Tier-S character op.
  // ════════════════════════════════════════════════════════════════════════

  {
    name: 'STRESS: block-boundary invariance — N=64/256/1024 produce identical output',
    run() {
      const total = 4096;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
        cv[i]    = 8 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * i / SR));
      }
      function runWithBlock(blockN) {
        const op = freshOp({ distortion: 0.15, asymmetry: 0.02 });
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(blockN, total - pos);
          op.process({ audio: audio.subarray(pos, pos + n), cv: cv.subarray(pos, pos + n) },
                     { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        return out;
      }
      const out64   = runWithBlock(64);
      const out256  = runWithBlock(256);
      const out1024 = runWithBlock(1024);
      for (let i = 0; i < total; i++) {
        if (!approx(out64[i], out256[i], 1e-7))   return { pass: false, why: `64 vs 256: i=${i}` };
        if (!approx(out256[i], out1024[i], 1e-7)) return { pass: false, why: `256 vs 1024: i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: long-run — 5 sec memoryless, period-aligned RMS match',
    run() {
      const total = SR * 5;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
        cv[i]    = 8 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.0 * i / SR));
      }
      const op = freshOp({});
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
      const rmsA = rms(out, SR * 1, SR * 2);
      const rmsB = rms(out, SR * 4, SR * 5);
      if (!approx(rmsA, rmsB, 1e-6)) return { pass: false, why: `memoryless violation: rmsA=${rmsA} rmsB=${rmsB}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: SR-invariance — gain curve identical across 44.1/48/96k',
    run() {
      const rates = [44100, 48000, 96000];
      const gains = [];
      for (const sr of rates) {
        const op = new DiodeBridgeGROp(sr);
        op.reset();
        op.setParam('distortion', 0); op.setParam('asymmetry', 0);
        const total = Math.round(sr * 0.05);
        const audio = new Float32Array(total);
        const cv    = new Float32Array(total);
        for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / sr) * 0.4;
        cv.fill(4);
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(N, total - pos);
          op.process({ audio: audio.subarray(pos, pos + n), cv: cv.subarray(pos, pos + n) },
                     { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        gains.push(rms(out, 100, total - 100) / rms(audio, 100, total - 100));
      }
      // gain at cv=4, β=1.8, V0=8: norm=0.5, norm^1.8 = 0.287, gain=1/(1+0.287)=0.777
      const expected = 1 / (1 + Math.pow(0.5, 1.8));
      for (const g of gains) {
        if (!approx(g, expected, 0.005)) return { pass: false, why: `g=${g} expected ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: state isolation — 3 parallel ops with different params',
    run() {
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 500 * i / SR) * 0.3;
      cv.fill(8);
      const opA = freshOp({ cutoffScale: 4,  distortion: 0.1 });
      const opB = freshOp({ cutoffScale: 16, distortion: 0.1 });
      const opC = freshOp({ cutoffScale: 8,  distortion: 0.4, asymmetry: 0.1 });
      const outA = runBlocks(opA, total, audio, cv);
      const outB = runBlocks(opB, total, audio, cv);
      const outC = runBlocks(opC, total, audio, cv);
      let dAB = 0, dAC = 0;
      for (let i = 0; i < total; i++) {
        dAB += Math.abs(outA[i] - outB[i]);
        dAC += Math.abs(outA[i] - outC[i]);
      }
      if (dAB < 5) return { pass: false, why: `A≈B (diff=${dAB})` };
      if (dAC < 5) return { pass: false, why: `A≈C (diff=${dAC})` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: time-varying cv — gain tracks instantaneously (memoryless)',
    run() {
      const op = freshOp({ distortion: 0, asymmetry: 0 });
      const total = 1000;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      for (let i = 0; i < 500; i++) cv[i] = 0;
      for (let i = 500; i < total; i++) cv[i] = 16;
      const out = runBlocks(op, total, audio, cv);
      // pre-step: gain=1 → out=0.5
      if (!approx(out[100], 0.5, 1e-6)) return { pass: false, why: `pre-step out=${out[100]}` };
      // post-step: cv=16, V0=8, β=1.8: norm=2, norm^1.8 = 3.482, gain=1/4.482=0.223 → out=0.112
      const expected = 0.5 / (1 + Math.pow(2, 1.8));
      if (!approx(out[600], expected, 1e-4)) return { pass: false, why: `post-step out=${out[600]} expected ${expected}` };
      // Transition is instantaneous.
      if (!approx(out[500], expected, 1e-4)) return { pass: false, why: `transition out[500]=${out[500]}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: distortion couples with comprDepth (3H rises with GR)',
    run() {
      const f = 500;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      // Light compression: cv=2
      const opLight = freshOp({ distortion: 0.3, asymmetry: 0 });
      const cvLight = new Float32Array(total); cvLight.fill(2);
      const outLight = runBlocks(opLight, total, audio, cvLight);
      const ratioL = bin(outLight, 0, total, 3 * f, SR) / bin(outLight, 0, total, f, SR);
      // Heavy compression: cv=24
      const opHeavy = freshOp({ distortion: 0.3, asymmetry: 0 });
      const cvHeavy = new Float32Array(total); cvHeavy.fill(24);
      const outHeavy = runBlocks(opHeavy, total, audio, cvHeavy);
      const ratioH = bin(outHeavy, 0, total, 3 * f, SR) / bin(outHeavy, 0, total, f, SR);
      if (ratioH <= ratioL) return { pass: false, why: `light=${ratioL.toFixed(4)} heavy=${ratioH.toFixed(4)} — should rise with GR` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: pure-odd signature — 2H/3H ratio < 0.05 even at heavy compression',
    run() {
      // Named-gear claim verification: diode-bridge topology should produce
      // dramatically less 2H than 3H. Test that 2H/3H ratio stays small
      // across the full param range (with asymmetry=0).
      const op = freshOp({ distortion: 0.4, asymmetry: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.6;
      cv.fill(16);  // heavy compression
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      const ratio23 = mag2 / mag3;
      // Diode-bridge symmetry → 2H should be << 3H (≪0.05 with asymmetry=0).
      if (ratio23 > 0.05) return { pass: false, why: `2H/3H=${ratio23.toFixed(5)} (expected <<0.05 by bridge topology)` };
      return { pass: true };
    },
  },
];

export default { opId: 'diodeBridgeGR', tests };
