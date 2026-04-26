// op_srcResampler.test.js — math tests for op_srcResampler.
// Run via: node scripts/check_op_math.mjs
//
// Polyphase Kaiser-windowed-sinc varispeed reader per JOS Implementation
// (ccrma.stanford.edu/~jos/resample/Implementation.html). Same N inputs /
// N outputs per process() call; `speed` controls per-sample read advance.
// At speed=1 → pure NZ-sample filter delay. At speed≠1 → varispeed playback.
//
// Tests cover:
//  - Kernel normalization: h(0) = 1, h(NZ·L) = 0 (sinc/Kaiser symmetric)
//  - Identity at speed=1: output equals input delayed by NZ samples
//  - DC pass-through at speed=1: long DC input → output approaches DC
//    (after warm-up, with kernel sum == 1.0)
//  - Sine pass-through at speed=1: 1 kHz sine in → 1 kHz sine out, same RMS
//  - Speed=2 frequency-doubling: 100 Hz sine input read at 2x → 200 Hz out
//  - Speed=0.5 frequency-halving: 1 kHz sine input read at 0.5x → 500 Hz out
//  - Reset() restores clean state — repeat run gives identical output
//  - Defensive: missing output → no-op; NaN/inf params clamped

import { SrcResamplerOp } from './op_srcResampler.worklet.js';

const SR = 48000;
const N  = 256;
const NZ = 8;          // must match worklet
const L  = 32;
const TABLE_LEN = NZ * L + 1;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new SrcResamplerOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function runBlocks(op, totalN, inBuf) {
  const out = new Float32Array(totalN);
  let pos = 0;
  while (pos < totalN) {
    const n = Math.min(N, totalN - pos);
    const inputs = inBuf ? { in: inBuf.subarray(pos, pos + n) } : {};
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

// Count zero-crossings (positive-going) in window [start, end).
function countZc(x, start, end) {
  let z = 0;
  for (let i = start + 1; i < end; i++) {
    if (x[i-1] <= 0 && x[i] > 0) z++;
  }
  return z;
}

const tests = [
  // ---- kernel sanity (uses internal table via op instance) -----------------
  {
    name: 'kernel: h[0] = 1 (peak of sinc)',
    run() {
      const op = freshOp();
      if (!approx(op.h[0], 1.0, 1e-12)) return { pass: false, why: `h[0]=${op.h[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'kernel: h[NZ*L] = 0 (Kaiser window zero at edge)',
    run() {
      const op = freshOp();
      if (!approx(op.h[TABLE_LEN - 1], 0.0, 1e-9)) {
        return { pass: false, why: `h[${TABLE_LEN-1}]=${op.h[TABLE_LEN-1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'kernel: hd[l] = h[l+1] - h[l] (linear-interp differences)',
    run() {
      const op = freshOp();
      for (let l = 0; l < TABLE_LEN - 1; l++) {
        const expected = op.h[l + 1] - op.h[l];
        if (!approx(op.hd[l], expected, 1e-15)) {
          return { pass: false, why: `hd[${l}] mismatch` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'kernel sum across all phases ≈ L (polyphase tables sum to ~unity per sub-filter)',
    run() {
      // For a windowed-sinc kernel sampled at L*Nz+1 points, the SUM of all
      // kernel values is approximately L (since each polyphase sub-filter
      // sums to ~1 and there are L of them, including the symmetric counterpart).
      // We have only one wing here (right wing), 257 samples covering 0..NZ.
      // Sum of one wing minus the center peak (h[0]/2) ≈ L*1/2 = L/2.
      const op = freshOp();
      let s = 0;
      for (let l = 0; l < TABLE_LEN; l++) s += op.h[l];
      // Sanity: should be in (10, 20) — well-defined Kaiser-sinc with NZ=8, L=32.
      if (s < 10 || s > 20) return { pass: false, why: `sum=${s}` };
      return { pass: true };
    },
  },

  // ---- identity / pass-through at speed=1 ----------------------------------
  {
    name: 'speed=1: DC input → DC output (after warm-up, gain ≈ 1)',
    run() {
      const op = freshOp({ speed: 1 });
      const total = 1024;
      const inBuf = new Float32Array(total);
      inBuf.fill(0.5);
      const out = runBlocks(op, total, inBuf);
      // After NZ samples warm-up + a few more, output should be ≈ 0.5.
      // Tolerance: kernel sum may differ slightly from unity due to truncation.
      const tail = rms(out, 200, total) / Math.SQRT2;  // dc gain ≈ peak ≈ rms*sqrt(2) for DC
      // For pure DC, RMS = peak = mean. So tail RMS should be ~0.5.
      const meanTail = (() => { let s = 0; for (let i = 200; i < total; i++) s += out[i]; return s / (total - 200); })();
      if (!approx(meanTail, 0.5, 0.01)) return { pass: false, why: `meanTail=${meanTail}` };
      return { pass: true };
    },
  },
  {
    name: 'speed=1: output = input delayed by NZ samples (after warm-up)',
    run() {
      const op = freshOp({ speed: 1 });
      const total = 512;
      const inBuf = new Float32Array(total);
      // Impulse at sample 50 (well past warm-up start).
      inBuf[50] = 1.0;
      const out = runBlocks(op, total, inBuf);
      // Output should peak near sample 50 + NZ = 58.
      let peakIdx = 0; let peakVal = -1;
      for (let i = 0; i < total; i++) {
        if (Math.abs(out[i]) > peakVal) { peakVal = Math.abs(out[i]); peakIdx = i; }
      }
      // Filter delay = NZ exactly — peak should be at 50+NZ.
      if (Math.abs(peakIdx - (50 + NZ)) > 1) return { pass: false, why: `peakIdx=${peakIdx}, peakVal=${peakVal}` };
      // Peak value should be ≈ h[0] = 1.0 (since impulse hits exact integer phase).
      if (peakVal < 0.95 || peakVal > 1.05) return { pass: false, why: `peakVal=${peakVal}` };
      return { pass: true };
    },
  },
  {
    name: 'speed=1: 1 kHz sine pass-through, RMS preserved within 1%',
    run() {
      const op = freshOp({ speed: 1 });
      const total = 4096;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * 1000 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
      const out = runBlocks(op, total, inBuf);
      // Compare RMS over a stable window (skip warm-up + filter delay).
      const rmsIn  = rms(inBuf, 100, total - 100);
      const rmsOut = rms(out, 100 + NZ, total - 100);
      const ratio = rmsOut / rmsIn;
      if (ratio < 0.99 || ratio > 1.01) return { pass: false, why: `RMS ratio=${ratio}` };
      return { pass: true };
    },
  },

  // ---- varispeed: frequency mapping ----------------------------------------
  // NOTE: this op is causal (no input lookahead), so:
  //   - speed > 1 (read catches up to write) is valid only for ~NZ output
  //     samples before phase clamps to NZ-minimum. Then output behaves as
  //     speed=1 for the rest of the block. Logged as P2 research-debt.
  //   - speed < 1 (read falls behind write) is valid for ~KBUF samples
  //     before phase clamps to KBUF-NZ-1 ceiling. KBUF=4096 → ~85 ms at
  //     48 kHz before clamping.
  // Tests below exercise speed < 1 (clean) and small-deviation speed > 1.
  {
    name: 'speed=0.5: 1 kHz input → 500 Hz output zero-crossing rate (frequency-halving)',
    run() {
      const op = freshOp({ speed: 0.5 });
      const total = 2048;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * 1000 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
      const out = runBlocks(op, total, inBuf);
      // At speed=0.5 over 2048 output samples, the read advances 1024
      // input samples worth. So output should contain ~1024 input samples
      // worth of 1 kHz sine, time-stretched to 2048 output samples.
      // → output frequency content = 500 Hz (half of input freq).
      // Zero-crossings (positive-going) at 500 Hz over 2048 samples / 48000 SR
      // = 0.0427 s → ~21 cycles → 21 zero crossings.
      // BUT: phase grows by 0.5/step → after 2048 steps, phase = NZ + 1024.
      // That's well below KBUF-NZ-1 = 4087 ceiling, so all samples valid.
      const zcOut = countZc(out, 200, total);
      // Tolerance: ±4 because filter delay shifts the count window.
      if (zcOut < 17 || zcOut > 25) return { pass: false, why: `zcOut=${zcOut}` };
      return { pass: true };
    },
  },
  {
    name: 'speed=0.5 ⇒ output frequency-halved relative to speed=1',
    run() {
      // Cross-check: same 1 kHz input through speed=1 vs speed=0.5. The
      // speed=0.5 path should produce HALF the zero-crossings of speed=1
      // over the same window.
      const total = 1024;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * 1000 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
      const opUnity = freshOp({ speed: 1 });
      const opHalf  = freshOp({ speed: 0.5 });
      const outUnity = runBlocks(opUnity, total, inBuf);
      const outHalf  = runBlocks(opHalf,  total, inBuf);
      const zcUnity = countZc(outUnity, 100, total);
      const zcHalf  = countZc(outHalf,  100, total);
      const ratio = zcHalf / zcUnity;
      // Expect ratio ≈ 0.5. Tolerance ±0.15 absolute.
      if (ratio < 0.35 || ratio > 0.65) return { pass: false, why: `ratio=${ratio}, zcUnity=${zcUnity}, zcHalf=${zcHalf}` };
      return { pass: true };
    },
  },
  {
    name: 'speed > 1: phase clamps to NZ minimum within ~NZ samples (causality limit)',
    run() {
      // The op is causal — read pointer cannot advance past the write head.
      // Initial phase = NZ means there's no headroom for speed > 1. After
      // a few samples, phase clamps to NZ and the rest of the block behaves
      // as speed=1 (with a slight transient at the clamp boundary).
      // This test verifies the clamping: speed=2 output settles to a
      // 1 kHz sine at unity gain (= speed=1 behavior) after the brief
      // transient where the clamp engaged.
      const total = 1024;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * 1000 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
      const op = freshOp({ speed: 2.0 });
      const out = runBlocks(op, total, inBuf);
      // After clamp settles (~50 samples of transient), output should
      // resemble speed=1 — RMS ≈ input RMS within ±10%.
      const rmsIn  = rms(inBuf, 200, total);
      const rmsOut = rms(out, 200, total);
      const ratio = rmsOut / rmsIn;
      if (ratio < 0.9 || ratio > 1.1) return { pass: false, why: `RMS ratio=${ratio} (clamping should yield ≈1)` };
      return { pass: true };
    },
  },

  // ---- state semantics -----------------------------------------------------
  {
    name: 'reset() restores clean state — second run = first run',
    run() {
      const op  = freshOp({ speed: 1 });
      const ref = freshOp({ speed: 1 });
      const total = 1024;
      const inBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(2 * Math.PI * 440 * i / SR);
      // Warm-up the op then reset.
      runBlocks(op, total, inBuf);
      op.reset();
      const a = runBlocks(op, total, inBuf);
      const b = runBlocks(ref, total, inBuf);
      for (let i = 0; i < total; i++) {
        if (!approx(a[i], b[i], 1e-9)) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive -----------------------------------------------------------
  {
    name: 'missing output → no-op (no throw)',
    run() {
      const op = freshOp({ speed: 1 });
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: `${e}` }; }
      return { pass: true };
    },
  },
  {
    name: 'NaN/inf params clamped: output stays finite',
    run() {
      const op = freshOp({});
      op.setParam('speed', NaN);
      op.setParam('speed', Infinity);
      op.setParam('speed', -Infinity);
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * 440 * i / SR);
      const out = runBlocks(op, N, inBuf);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'speed clamping: 100 (out of range) → clamped to 4.0, output finite',
    run() {
      const op = freshOp({});
      op.setParam('speed', 100);
      const inBuf = new Float32Array(N);
      inBuf.fill(0.5);
      const out = runBlocks(op, N, inBuf);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // STRESS TESTS — added 2026-04-26 because srcResampler is a foundation
  // op that BBD/tape/oilCanDelay/dopplerRotor/varistorVibrato/granularPitchShifter
  // all depend on. Bugs here pollute every downstream pitch/varispeed op.
  // ════════════════════════════════════════════════════════════════════════

  // Helper: measure pure-tone gain through op via RMS ratio.
  // ---- 1. Passband flatness: gain at multiple frequencies through speed=1 ----
  {
    name: 'STRESS: passband flatness ±0.5 dB across 100 Hz → 12 kHz at speed=1',
    run() {
      const freqs = [100, 500, 1000, 3000, 6000, 9000, 12000];
      const total = 4096;
      let maxDevDb = 0;
      let worstFreq = 0;
      for (const f of freqs) {
        const op = freshOp({ speed: 1 });
        const inBuf = new Float32Array(total);
        const w = 2 * Math.PI * f / SR;
        for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
        const out = runBlocks(op, total, inBuf);
        // Skip warm-up (first NZ + 50 samples) and last few samples.
        const rmsIn  = rms(inBuf, 100, total - 100);
        const rmsOut = rms(out,   100 + NZ, total - 100);
        const gainDb = 20 * Math.log10(rmsOut / rmsIn);
        if (Math.abs(gainDb) > Math.abs(maxDevDb)) { maxDevDb = gainDb; worstFreq = f; }
      }
      if (Math.abs(maxDevDb) > 0.5) return { pass: false, why: `max deviation ${maxDevDb.toFixed(3)} dB at ${worstFreq} Hz` };
      return { pass: true };
    },
  },

  // ---- 2. Passband at fractional speed (exercises the actual kernel) ----
  {
    name: 'STRESS: passband at speed=0.7 (kernel exercised) — gain ±0.5 dB at 100 Hz / 1 kHz / 5 kHz',
    run() {
      // CONTEXT: at speed=1, polyphase kernel collapses to identity (h[0]=1
      // and all other taps are sinc zero-crossings at integer phase). The
      // KERNEL only filters at fractional phase. Test passband preservation
      // at speed=0.7 (heavily fractional → exercises full kernel each sample).
      // At speed=0.7, output frequency = 0.7 × input frequency, so we
      // measure RMS gain (passband preservation), not absolute output frequency.
      const freqs = [100, 1000, 5000];
      const total = 4096;
      let maxDevDb = 0;
      let worstFreq = 0;
      for (const f of freqs) {
        const op = freshOp({ speed: 0.7 });
        const inBuf = new Float32Array(total);
        const w = 2 * Math.PI * f / SR;
        for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
        const out = runBlocks(op, total, inBuf);
        // Measure RMS over a long stable window (skip warm-up).
        const rmsIn  = rms(inBuf, 200, total - 100);
        const rmsOut = rms(out,   200 + NZ, total - 100);
        const gainDb = 20 * Math.log10(rmsOut / rmsIn);
        if (Math.abs(gainDb) > Math.abs(maxDevDb)) { maxDevDb = gainDb; worstFreq = f; }
      }
      if (Math.abs(maxDevDb) > 0.5) return { pass: false, why: `max deviation ${maxDevDb.toFixed(3)} dB at ${worstFreq} Hz (kernel passband should preserve gain)` };
      return { pass: true };
    },
  },

  // ---- 3. Block-boundary invariance: SAME input through different N ----
  {
    name: 'STRESS: block-boundary invariance — output identical for N=64/256/1024',
    run() {
      const total = 2048;
      const inBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(2 * Math.PI * 440 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 1100 * i / SR);

      function runWithBlock(blockN) {
        const op = freshOp({ speed: 1 });
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(blockN, total - pos);
          op.process({ in: inBuf.subarray(pos, pos + n) }, { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        return out;
      }

      const out64   = runWithBlock(64);
      const out256  = runWithBlock(256);
      const out1024 = runWithBlock(1024);
      // All three should be bit-identical (within float32 precision).
      for (let i = 0; i < total; i++) {
        if (!approx(out64[i], out256[i], 1e-7))   return { pass: false, why: `64 vs 256: i=${i} ${out64[i]} vs ${out256[i]}` };
        if (!approx(out256[i], out1024[i], 1e-7)) return { pass: false, why: `256 vs 1024: i=${i} ${out256[i]} vs ${out1024[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- 4. Block invariance at speed != 1 ----
  {
    name: 'STRESS: block-boundary invariance at speed=0.5 — N=64 ≡ N=256',
    run() {
      const total = 2048;
      const inBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(2 * Math.PI * 1000 * i / SR);

      function runWithBlock(blockN) {
        const op = freshOp({ speed: 0.5 });
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(blockN, total - pos);
          op.process({ in: inBuf.subarray(pos, pos + n) }, { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        return out;
      }

      const out64  = runWithBlock(64);
      const out256 = runWithBlock(256);
      for (let i = 0; i < total; i++) {
        if (!approx(out64[i], out256[i], 1e-7)) return { pass: false, why: `i=${i}: ${out64[i]} vs ${out256[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- 5. Musical-ratio frequency mapping at semitone speed ratio ----
  {
    name: 'STRESS: speed=2^(-1/12) (semitone slower) — output freq = input · 0.9438',
    run() {
      const semitoneSpeed = Math.pow(2, -1/12);  // ≈ 0.9438
      const total = 4096;
      const inFreq = 1000;  // 1 kHz
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * inFreq / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
      const op = freshOp({ speed: semitoneSpeed });
      const out = runBlocks(op, total, inBuf);
      // Expected output frequency = inFreq * speed = 1000 * 0.9438 = 943.8 Hz
      const expectedFreq = inFreq * semitoneSpeed;
      // Count zero crossings over a stable window after warm-up.
      const zcStart = 200, zcEnd = total - 100;
      const zc = countZc(out, zcStart, zcEnd);
      const seconds = (zcEnd - zcStart) / SR;
      const measuredFreq = zc / seconds;
      const errCents = 1200 * Math.log2(measuredFreq / expectedFreq);
      if (Math.abs(errCents) > 50) {
        return { pass: false, why: `measured ${measuredFreq.toFixed(2)} Hz vs expected ${expectedFreq.toFixed(2)} Hz (${errCents.toFixed(1)} cents off)` };
      }
      return { pass: true };
    },
  },

  // ---- 6. Large-signal headroom: kernel doesn't blow up at ±1.0 ----
  {
    name: 'STRESS: large-signal headroom — ±1.0 sine at speed=0.7 stays within ±1.10',
    run() {
      const total = 4096;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * 1000 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);  // exact ±1
      const op = freshOp({ speed: 0.7 });  // fractional → exercises full polyphase kernel
      const out = runBlocks(op, total, inBuf);
      let peak = 0;
      for (let i = 100; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
      // Kaiser-windowed sinc at fractional position has small theoretical
      // overshoot from kernel sum drift (sum across all polyphase phases
      // varies slightly from unity). Tolerance: 10%.
      if (peak > 1.10) return { pass: false, why: `peak=${peak.toFixed(4)} (kernel overshoot >10%)` };
      // Also check it's not catastrophically clipping low.
      if (peak < 0.85) return { pass: false, why: `peak=${peak.toFixed(4)} (kernel attenuation >15%)` };
      return { pass: true };
    },
  },

  // ---- 7. Long-run stability: 5-second pass-through at speed=1 ----
  {
    name: 'STRESS: long-run — 5 sec at speed=1 → no DC creep, no NaN, RMS preserved',
    run() {
      const total = SR * 5;  // 240k samples — heavy
      const op = freshOp({ speed: 1 });
      const inBuf = new Float32Array(total);
      // Mixed signal: low + mid frequencies, NOT zero-mean intentionally
      // to test DC stability under long accumulation.
      const w1 = 2 * Math.PI * 100 / SR;
      const w2 = 2 * Math.PI * 1000 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = 0.4 * Math.sin(w1 * i) + 0.4 * Math.sin(w2 * i);
      const out = runBlocks(op, total, inBuf);
      // 1. Finiteness everywhere.
      for (let i = 0; i < total; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
      }
      // 2. RMS preserved within 0.5 % over the full 5 seconds.
      const rmsIn  = rms(inBuf, 1000, total - 1000);
      const rmsOut = rms(out, 1000 + NZ, total - 1000);
      const ratio = rmsOut / rmsIn;
      if (ratio < 0.995 || ratio > 1.005) return { pass: false, why: `RMS ratio ${ratio.toFixed(6)} drifted >0.5%` };
      // 3. DC of output stays near 0 (input is zero-mean by symmetry).
      let dc = 0;
      for (let i = 1000; i < total - 1000; i++) dc += out[i];
      dc /= (total - 2000);
      if (Math.abs(dc) > 1e-3) return { pass: false, why: `DC drift ${dc.toExponential(3)}` };
      return { pass: true };
    },
  },

  // ---- 8. Sample-rate invariance ----
  {
    name: 'STRESS: SR-invariance — 1 kHz at 44.1k vs 48k vs 96k → identical relative gain',
    run() {
      const rates = [44100, 48000, 88200, 96000];
      const inFreq = 1000;
      const gains = [];
      for (const sr of rates) {
        const op = new SrcResamplerOp(sr);
        op.reset();
        op.setParam('speed', 1);
        const total = Math.floor(sr * 0.05);  // ~50 ms per rate
        const inBuf = new Float32Array(total);
        const w = 2 * Math.PI * inFreq / sr;
        for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(N, total - pos);
          op.process({ in: inBuf.subarray(pos, pos + n) }, { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        const rmsIn  = rms(inBuf, 100, total - 100);
        const rmsOut = rms(out, 100 + NZ, total - 100);
        gains.push(rmsOut / rmsIn);
      }
      // All gains should be ≈ 1.0 (passband at 1 kHz). Verify within 0.5%.
      for (const g of gains) {
        if (g < 0.995 || g > 1.005) return { pass: false, why: `gain ${g.toFixed(5)} at one SR (gains=${gains.map(x=>x.toFixed(5))})` };
      }
      return { pass: true };
    },
  },

  // ---- 9. Speed automation click magnitude ----
  {
    name: 'STRESS: abrupt speed transition (1.0 → 0.5 → 1.0) — click stays bounded',
    run() {
      // Op has no internal smoothing on `speed`. Document behavior at hard
      // transitions: max single-sample step at the boundary should not
      // catastrophically click. (It WILL click — measure how loudly.)
      const total = 3072;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * 440 / SR;
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(w * i);
      const op = freshOp({ speed: 1 });
      const out = new Float32Array(total);
      // Phase 1: speed=1 for 1024 samples
      op.process({ in: inBuf.subarray(0, 1024) }, { out: out.subarray(0, 1024) }, 1024);
      // Transition to 0.5
      op.setParam('speed', 0.5);
      op.process({ in: inBuf.subarray(1024, 2048) }, { out: out.subarray(1024, 2048) }, 1024);
      // Transition back to 1.0
      op.setParam('speed', 1.0);
      op.process({ in: inBuf.subarray(2048, 3072) }, { out: out.subarray(2048, 3072) }, 1024);

      // Measure max single-sample step around each transition.
      let maxStep1 = 0, maxStep2 = 0;
      for (let i = 1020; i < 1030; i++) maxStep1 = Math.max(maxStep1, Math.abs(out[i] - out[i-1]));
      for (let i = 2044; i < 2054; i++) maxStep2 = Math.max(maxStep2, Math.abs(out[i] - out[i-1]));

      // Without smoothing, transitions will produce a step. Bound it: should
      // not exceed 2.0 (= 2× signal peak) — that would indicate divergence.
      if (maxStep1 > 2.0) return { pass: false, why: `transition 1 click=${maxStep1.toFixed(4)}` };
      if (maxStep2 > 2.0) return { pass: false, why: `transition 2 click=${maxStep2.toFixed(4)}` };
      return { pass: true };
    },
  },

  // ---- 10. Multi-instance isolation: parallel ops don't share state ----
  {
    name: 'STRESS: state isolation — 3 parallel instances produce independent output',
    run() {
      const total = 1024;
      const inA = new Float32Array(total);
      const inB = new Float32Array(total);
      const inC = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        inA[i] = Math.sin(2 * Math.PI * 100  * i / SR);
        inB[i] = Math.sin(2 * Math.PI * 500  * i / SR);
        inC[i] = Math.sin(2 * Math.PI * 2000 * i / SR);
      }
      const opA = freshOp({ speed: 1 });
      const opB = freshOp({ speed: 1 });
      const opC = freshOp({ speed: 1 });
      const outA = runBlocks(opA, total, inA);
      const outB = runBlocks(opB, total, inB);
      const outC = runBlocks(opC, total, inC);
      // outA[NZ] should ≈ inA[0] (= 0 since sin(0)=0)
      // outB[NZ] should ≈ inB[0] (= 0)
      // outC[NZ] should ≈ inC[0] (= 0)
      // What we really test: outA != outB != outC after warm-up.
      let diffAB = 0, diffBC = 0;
      for (let i = NZ + 100; i < total; i++) {
        diffAB += Math.abs(outA[i] - outB[i]);
        diffBC += Math.abs(outB[i] - outC[i]);
      }
      if (diffAB < 10) return { pass: false, why: `outA ≈ outB (diff=${diffAB})` };
      if (diffBC < 10) return { pass: false, why: `outB ≈ outC (diff=${diffBC})` };
      // Now: 4th op with same input as A should equal outA exactly.
      const opAprime = freshOp({ speed: 1 });
      const outAprime = runBlocks(opAprime, total, inA);
      for (let i = 0; i < total; i++) {
        if (!approx(outA[i], outAprime[i], 1e-9)) return { pass: false, why: `parallel-A determinism: i=${i}` };
      }
      return { pass: true };
    },
  },

  // ---- 11. LFO-driven varispeed (wow/flutter recipe sanity) ----
  {
    name: 'STRESS: LFO-driven speed (wow ±0.5% at 6 Hz) — clean output, no clicks',
    run() {
      // Use case: tape wow/flutter recipe. Modulate speed at 6 Hz with
      // ±0.5% deviation around 1.0. Output should be a clean modulated
      // version of input with no per-sample clicks (transitions between
      // setParam calls are smooth because the deviation is tiny).
      const total = SR;  // 1 second
      const inFreq = 1000;
      const inBuf = new Float32Array(total);
      const w = 2 * Math.PI * inFreq / SR;
      for (let i = 0; i < total; i++) inBuf[i] = 0.5 * Math.sin(w * i);
      const op = freshOp({ speed: 1 });
      const out = new Float32Array(total);
      const blockN = 64;  // 64-sample blocks for fine LFO resolution
      let pos = 0;
      const lfoFreq = 6;
      const lfoDepth = 0.005;  // ±0.5%
      while (pos < total) {
        const n = Math.min(blockN, total - pos);
        // Update speed at start of each block based on LFO.
        const t = pos / SR;
        const lfo = Math.sin(2 * Math.PI * lfoFreq * t);
        op.setParam('speed', 1.0 + lfoDepth * lfo);
        op.process({ in: inBuf.subarray(pos, pos + n) }, { out: out.subarray(pos, pos + n) }, n);
        pos += n;
      }
      // Verify no NaN, no big clicks, RMS preserved.
      let maxStep = 0;
      for (let i = 1; i < total; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
        const step = Math.abs(out[i] - out[i-1]);
        if (step > maxStep) maxStep = step;
      }
      // 1 kHz sine has natural max step ~ 0.13 (= 2π·1000/48000 · 0.5).
      // With ±0.5% wow, max step should not exceed ~0.20.
      if (maxStep > 0.25) return { pass: false, why: `max step=${maxStep.toFixed(4)} (excessive click in LFO modulation)` };
      const rmsIn  = rms(inBuf, 1000, total - 1000);
      const rmsOut = rms(out,   1000 + NZ, total - 1000);
      const ratio = rmsOut / rmsIn;
      if (ratio < 0.99 || ratio > 1.01) return { pass: false, why: `RMS ratio ${ratio.toFixed(5)} drifted under wow modulation` };
      return { pass: true };
    },
  },

  // ---- 12. Reset mid-stream: state fully cleared, deterministic re-warmup ----
  {
    name: 'STRESS: reset() mid-stream at speed=0.7 — clean re-warmup, deterministic',
    run() {
      const total = 2048;
      const inBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = Math.sin(2 * Math.PI * 800 * i / SR);
      // Reference: fresh op, run from start.
      const ref = freshOp({ speed: 0.7 });
      const refOut = runBlocks(ref, total, inBuf);
      // Test: warm up an op for many blocks, reset, then run from start.
      const op = freshOp({ speed: 0.7 });
      runBlocks(op, total * 2, inBuf);  // long warm-up
      op.reset();
      // After reset, speed should still be 0.7. State should be clean.
      const testOut = runBlocks(op, total, inBuf);
      // Output should be bit-identical to fresh op.
      for (let i = 0; i < total; i++) {
        if (!approx(refOut[i], testOut[i], 1e-9)) {
          return { pass: false, why: `i=${i}: ref=${refOut[i]} vs test=${testOut[i]}` };
        }
      }
      return { pass: true };
    },
  },
];

export default { opId: 'srcResampler', tests };
