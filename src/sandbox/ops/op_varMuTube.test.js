// op_varMuTube.test.js — math + stress tests for op_varMuTube.
// Run via: node scripts/check_op_math.mjs
//
// Phenomenological variable-mu tube GR cell. Memoryless. Tier-S character
// op (named-gear class) — 15-20 tests target per ship-protocol §5.1.

import { VarMuTubeOp } from './op_varMuTube.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new VarMuTubeOp(SR);
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
      const cv    = new Float32Array(total);  // all zeros
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: out=${out[i]} vs audio=${audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv < 0 → unity gain (negative cv ignored, vari-mu only compresses on positive cv)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
      cv.fill(-15);  // strongly negative cv
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: negative cv should be ignored` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: gain curve --------------------------------------------
  {
    name: 'cv = cutoffScale → gain = 0.5 (-6 dB) at default knee',
    run() {
      const op = freshOp({});  // cutoffScale=10 default, β=1.5
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      cv.fill(10);  // = cutoffScale
      const out = runBlocks(op, total, audio, cv);
      // gain = 1/(1 + 1^1.5) = 0.5; out = audio * 0.5 + small distortion.
      // distortion: distScale = 0.1 * (1 - 0.5) = 0.05. dist contribution =
      //   0.05 * |audio * 0.5| = 0.05 * 0.25 = 0.0125. So out ≈ 0.25 + 0.0125 = 0.2625.
      // For DC input (no harmonic), out = yClean + dist*|yClean| (constant).
      const expected = 0.5 * 0.5 + 0.05 * Math.abs(0.5 * 0.5);
      // Check sample 100 (well past warm-up, even though memoryless).
      if (!approx(out[100], expected, 1e-3)) return { pass: false, why: `out[100]=${out[100]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'cv = 0 → gain = 1.0; cv → ∞ → gain → 0 (monotonic)',
    run() {
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      const cvValues = [0, 5, 10, 20, 40, 100];
      const gains = [];
      for (const cvVal of cvValues) {
        const op = freshOp({ distortion: 0 });  // disable distortion for clean gain measurement
        const cv = new Float32Array(total);
        cv.fill(cvVal);
        const out = runBlocks(op, total, audio, cv);
        gains.push(out[100] / 0.5);  // gain = out / input
      }
      // Should be monotonically decreasing with cv.
      for (let i = 1; i < gains.length; i++) {
        if (gains[i] >= gains[i - 1]) return { pass: false, why: `not monotonic: ${gains}` };
      }
      // Specific boundaries: cv=0 → 1.0, cv=10 → 0.5
      if (!approx(gains[0], 1.0, 1e-6)) return { pass: false, why: `cv=0: gain=${gains[0]}` };
      if (!approx(gains[2], 0.5, 1e-3)) return { pass: false, why: `cv=10: gain=${gains[2]} expected 0.5` };
      // cv=100 (10× cutoff) → gain = 1/(1 + 10^1.5) ≈ 1/32.6 ≈ 0.030
      if (gains[5] > 0.05) return { pass: false, why: `cv=100: gain=${gains[5]} (expected ~0.03)` };
      return { pass: true };
    },
  },
  {
    name: 'curveExponent: β=3 produces sharper knee than β=1',
    run() {
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      const cv = new Float32Array(total);
      cv.fill(10);  // = cutoffScale → gain at knee point
      const opSoft  = freshOp({ curveExponent: 1.0, distortion: 0 });
      const opSharp = freshOp({ curveExponent: 3.0, distortion: 0 });
      const outSoft  = runBlocks(opSoft,  total, audio, cv);
      const outSharp = runBlocks(opSharp, total, audio, cv);
      // At cv = cutoffScale, both should be 0.5.
      if (!approx(outSoft[100]  / 0.5, 0.5, 1e-3)) return { pass: false, why: `soft: ${outSoft[100]/0.5}` };
      if (!approx(outSharp[100] / 0.5, 0.5, 1e-3)) return { pass: false, why: `sharp: ${outSharp[100]/0.5}` };
      // Now test BELOW the knee (cv = 5) — sharp should give MORE gain (knee
      // hasn't engaged), soft should compress more.
      cv.fill(5);
      const outSoft2  = runBlocks(opSoft,  total, audio, cv);
      const outSharp2 = runBlocks(opSharp, total, audio, cv);
      const gainSoft  = outSoft2[100]  / 0.5;
      const gainSharp = outSharp2[100] / 0.5;
      if (gainSharp <= gainSoft) return { pass: false, why: `at cv<knee: sharp gain=${gainSharp} should be > soft gain=${gainSoft}` };
      return { pass: true };
    },
  },

  // ---- correctness: distortion couples with compression depth -------------
  {
    name: 'distortion=0 → no harmonics regardless of cv (clean compression)',
    run() {
      const op = freshOp({ distortion: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(20);  // heavy compression
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      if (mag2 > 1e-5) return { pass: false, why: `2H = ${mag2} (expected ~0 with distortion=0)` };
      return { pass: true };
    },
  },
  {
    name: 'distortion>0: 2H/1H ratio increases with compression (vari-mu signature)',
    run() {
      // Light compression: cv=5, gain ≈ 0.74, comprDepth ≈ 0.26
      // Heavy compression: cv=20, gain ≈ 0.18, comprDepth ≈ 0.82
      // 1H amplitude scales as gain; 2H scales as distortion·comprDepth·gain·(4/3π).
      // Ratio 2H/1H = distortion·comprDepth·(4/3π) — depends only on comprDepth.
      // So at heavier compression, ratio is LARGER (signature of vari-mu).
      // Note: absolute 2H may DECREASE at heavy compression (because 1H is so small),
      // but the RATIO always increases — that's the audible character.
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      const cvLight = new Float32Array(total); cvLight.fill(5);
      const outLight = runBlocks(freshOp({ distortion: 0.3 }), total, audio, cvLight);
      const mag1L = bin(outLight, 0, total, f,     SR);
      const mag2L = bin(outLight, 0, total, 2 * f, SR);
      const ratioL = mag2L / mag1L;
      const cvHeavy = new Float32Array(total); cvHeavy.fill(20);
      const outHeavy = runBlocks(freshOp({ distortion: 0.3 }), total, audio, cvHeavy);
      const mag1H = bin(outHeavy, 0, total, f,     SR);
      const mag2H = bin(outHeavy, 0, total, 2 * f, SR);
      const ratioH = mag2H / mag1H;
      if (ratioH <= ratioL) {
        return { pass: false, why: `2H/1H ratio: light=${ratioL.toFixed(4)} heavy=${ratioH.toFixed(4)} — should rise with compression` };
      }
      // Roughly, ratioH/ratioL should ≈ comprDepthH/comprDepthL ≈ 0.82/0.26 ≈ 3.15
      const ratioOfRatios = ratioH / ratioL;
      if (ratioOfRatios < 2.5 || ratioOfRatios > 4.0) {
        return { pass: false, why: `ratio of ratios = ${ratioOfRatios.toFixed(2)} (expected ~3.15)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'distortion produces 2H + 4H (even-only spectrum, like blackmerVCA)',
    run() {
      const op = freshOp({ distortion: 0.3 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(15);  // moderate compression
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      const mag4 = bin(out, 0, total, 4 * f, SR);
      // 2H and 4H should both be measurable; 3H should be ~0.
      if (mag2 < 1e-3) return { pass: false, why: `2H = ${mag2} (expected nonzero)` };
      if (mag4 < 1e-5) return { pass: false, why: `4H = ${mag4} (expected nonzero, smaller than 2H)` };
      if (mag3 > 1e-4) return { pass: false, why: `3H = ${mag3} (expected ~0; even-symmetric model)` };
      // 4H should be smaller than 2H.
      if (mag4 >= mag2) return { pass: false, why: `4H ≥ 2H: ${mag4} ≥ ${mag2}` };
      return { pass: true };
    },
  },

  // ---- correctness: trim --------------------------------------------------
  {
    name: 'trim = +6 dB doubles output (independent of cv)',
    run() {
      const op = freshOp({ trim: 6.0206, distortion: 0 });
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      cv.fill(0);  // no compression
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
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing cv input → unity gain (cv=0 implicit)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.4;
      const out = runBlocks(op, total, audio, null);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: out=${out[i]} vs audio=${audio[i]}` };
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
      for (const p of ['cutoffScale', 'curveExponent', 'distortion', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const audio = new Float32Array(N); audio.fill(0.5);
      const cv    = new Float32Array(N); cv.fill(15);
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
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: out=${out[i]}` };
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
        cv[i]    = 5 + 10 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * i / SR));  // 5..15 LFO
      }
      function runWithBlock(blockN) {
        const op = freshOp({ distortion: 0.15 });
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
        cv[i]    = 10 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.0 * i / SR));  // 1 Hz LFO
      }
      const op = freshOp({ distortion: 0.1 });
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
      // Memoryless + 1-Hz period-aligned LFO → RMS bit-identical at integer-sec offsets.
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
        const op = new VarMuTubeOp(sr);
        op.reset();
        op.setParam('distortion', 0);  // pure gain measurement
        const total = Math.round(sr * 0.05);
        const audio = new Float32Array(total);
        const cv    = new Float32Array(total);
        for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / sr) * 0.4;
        cv.fill(7);  // moderate compression
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(N, total - pos);
          op.process({ audio: audio.subarray(pos, pos + n), cv: cv.subarray(pos, pos + n) },
                     { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        const rmsIn  = rms(audio, 100, total - 100);
        const rmsOut = rms(out,   100, total - 100);
        gains.push(rmsOut / rmsIn);
      }
      // gain at cv=7, β=1.5, V0=10: norm=0.7, norm^1.5=0.586, gain=1/(1+0.586)=0.631
      const expected = 1 / (1 + Math.pow(0.7, 1.5));
      for (const g of gains) {
        if (!approx(g, expected, 0.005)) return { pass: false, why: `g=${g} expected ${expected}` };
      }
      // SR variance.
      const maxDiff = Math.max(...gains) - Math.min(...gains);
      if (maxDiff > 0.001) return { pass: false, why: `SR variance: ${gains}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: state isolation — 3 parallel ops with different params produce independent output',
    run() {
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 500 * i / SR) * 0.3;
      cv.fill(10);
      const opA = freshOp({ cutoffScale: 5,   distortion: 0.1 });
      const opB = freshOp({ cutoffScale: 20,  distortion: 0.1 });
      const opC = freshOp({ cutoffScale: 10,  distortion: 0.4 });
      const outA = runBlocks(opA, total, audio, cv);
      const outB = runBlocks(opB, total, audio, cv);
      const outC = runBlocks(opC, total, audio, cv);
      let dAB = 0, dAC = 0;
      for (let i = 0; i < total; i++) {
        dAB += Math.abs(outA[i] - outB[i]);
        dAC += Math.abs(outA[i] - outC[i]);
      }
      if (dAB < 5)   return { pass: false, why: `A≈B (diff=${dAB})` };
      if (dAC < 5)   return { pass: false, why: `A≈C (diff=${dAC})` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: gain output bounded — heavy compression stays well within 1.0',
    run() {
      const op = freshOp({ distortion: 0.5 });
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR);
      cv.fill(40);  // very heavy compression (gain ≈ 0.04)
      const out = runBlocks(op, total, audio, cv);
      let peak = 0;
      for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
      // gain at cv=40 (β=1.5, V0=10): norm=4, norm^1.5=8, gain=1/9=0.111.
      // distScale=0.5·0.889=0.444. Output peak: 0.111 + 0.444·0.111 = 0.16.
      if (peak > 0.20) return { pass: false, why: `peak=${peak} (heavy comp should attenuate strongly)` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: time-varying cv — gain tracks cv envelope instantaneously (memoryless)',
    run() {
      const op = freshOp({ distortion: 0 });
      const total = 1000;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      // Step cv from 0 to 20 mid-buffer
      for (let i = 0; i < 500; i++) cv[i] = 0;
      for (let i = 500; i < total; i++) cv[i] = 20;
      const out = runBlocks(op, total, audio, cv);
      // Before step: cv=0 → gain=1 → out=0.5
      if (!approx(out[100], 0.5, 1e-6)) return { pass: false, why: `pre-step out=${out[100]}` };
      // After step: cv=20 → gain=1/(1 + 2^1.5)=1/3.828≈0.261 → out=0.130
      const expected = 0.5 / (1 + Math.pow(2, 1.5));
      if (!approx(out[600], expected, 1e-4)) return { pass: false, why: `post-step out=${out[600]} expected ${expected}` };
      // Step transition: out[500] = first sample under new cv → instantaneous (memoryless).
      if (!approx(out[500], expected, 1e-4)) return { pass: false, why: `transition not instantaneous: out[500]=${out[500]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: vari-mu signature — 2H/1H ratio increases with compression',
    run() {
      // Named-gear claim verification: vari-mu compressors are characterized
      // by harmonic content that grows with compression depth (unlike clean
      // VCAs where THD is independent of GR). Verify with two cv levels.
      const f = 500;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      // Light: cv=5 → gain ≈ 0.74
      const opLight = freshOp({ distortion: 0.2 });
      const cvLight = new Float32Array(total); cvLight.fill(5);
      const outLight = runBlocks(opLight, total, audio, cvLight);
      const mag1L = bin(outLight, 0, total, f,     SR);
      const mag2L = bin(outLight, 0, total, 2 * f, SR);
      const ratioL = mag2L / mag1L;
      // Heavy: cv=20 → gain ≈ 0.18
      const opHeavy = freshOp({ distortion: 0.2 });
      const cvHeavy = new Float32Array(total); cvHeavy.fill(20);
      const outHeavy = runBlocks(opHeavy, total, audio, cvHeavy);
      const mag1H = bin(outHeavy, 0, total, f,     SR);
      const mag2H = bin(outHeavy, 0, total, 2 * f, SR);
      const ratioH = mag2H / mag1H;
      // Heavy compression should produce a higher 2H/1H ratio (vari-mu signature).
      if (ratioH <= ratioL) return { pass: false, why: `ratioH=${ratioH.toFixed(4)} should > ratioL=${ratioL.toFixed(4)}` };
      // Sanity: both ratios should be measurable.
      if (ratioL < 0.01) return { pass: false, why: `light comp 2H/1H=${ratioL} too small` };
      return { pass: true };
    },
  },
];

export default { opId: 'varMuTube', tests };
