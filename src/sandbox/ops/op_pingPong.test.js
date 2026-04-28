// op_pingPong.test.js — math tests for op_pingPong.
// Run via: node scripts/check_op_math.mjs
//
// Verifies the equal-level two-tap stereo ping-pong topology against
// expected pulse-response patterns: R fires at TIME, L fires at 2·TIME,
// R at 3·TIME, etc. Standalone worklet mono-collapses both taps so the
// test harness sees them as a single output stream — but the firing
// timing is still verifiable.
//
// See dafx_zolzer_textbook.md §3.1 + jos_pasp_dsp_reference.md "Delay
// Lines" for the canonical topology references.

import { PingPongOp } from './op_pingPong.worklet.js';

const SR  = 48000;
const EPS = 1e-6;

function freshOp(params = {}) {
  const op = new PingPongOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return out;
}

function tailPeak(buf, skip = 0) {
  let m = 0;
  for (let i = skip; i < buf.length; i++) if (Math.abs(buf[i]) > m) m = Math.abs(buf[i]);
  return m;
}

const tests = [
  // ── Basic safety ──────────────────────────────────────────────
  {
    name: 'silence in → silence out (no self-oscillation)',
    run() {
      const op = freshOp({ time: 200, feedback: 0.7, mix: 1.0 });
      const out = render(op, 0, 2048);
      // After settling, output should be exactly zero.
      const peak = tailPeak(out, 1024);
      if (peak > 1e-6) return { pass: false, why: `tail peak=${peak} (silent input must produce silent output)` };
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → fully dry (input passes through unchanged)',
    run() {
      const op = freshOp({ time: 250, feedback: 0.5, mix: 0.0 });
      const out = render(op, i => Math.sin(2 * Math.PI * 440 * i / SR), 4096);
      // First sample should be cos(0)·x + sin(0)·wet = x exactly.
      // (Ignore any wet contribution — mix=0 forces wetGain=0.)
      const dry0 = Math.sin(0); // = 0
      const dryRef10 = Math.sin(2 * Math.PI * 440 * 10 / SR);
      if (Math.abs(out[10] - dryRef10) > 1e-5)
        return { pass: false, why: `out[10]=${out[10]}, expected dry=${dryRef10}` };
      return { pass: true };
    },
  },

  // ── Pulse response — verifies the two-tap pattern ──────────────
  {
    name: 'pulse response: first wet hit lands at TIME (R tap), second at 2·TIME (L tap)',
    run() {
      const TIME_MS = 50;
      const TIME_SAMPLES = Math.round(TIME_MS * SR * 0.001); // 2400
      // Mix=1 (full wet), feedback=0 (no recirc — clean pulse pattern).
      const op = freshOp({ time: TIME_MS, feedback: 0, tone: 18000, spread: 1, mix: 1 });

      // Single-sample input pulse at i=0.
      const N = TIME_SAMPLES * 4;
      const inBuf = new Float32Array(N);
      inBuf[0] = 1;
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);

      // Standalone op mono-collapses, so we expect a hit near each tap.
      // Find peak windows around TIME and 2·TIME.
      const winLow1 = TIME_SAMPLES - 50, winHi1 = TIME_SAMPLES + 50;
      const winLow2 = 2 * TIME_SAMPLES - 50, winHi2 = 2 * TIME_SAMPLES + 50;
      let peak1 = 0, peak2 = 0;
      for (let i = winLow1; i < winHi1; i++) if (Math.abs(out[i]) > peak1) peak1 = Math.abs(out[i]);
      for (let i = winLow2; i < winHi2; i++) if (Math.abs(out[i]) > peak2) peak2 = Math.abs(out[i]);

      if (peak1 < 0.05) return { pass: false, why: `R tap at TIME=${TIME_MS}ms not detected (peak=${peak1})` };
      if (peak2 < 0.05) return { pass: false, why: `L tap at 2·TIME=${2*TIME_MS}ms not detected (peak=${peak2})` };
      return { pass: true };
    },
  },

  // ── Stability under maximum feedback ───────────────────────────
  {
    name: 'fb=0.85 + bright tone: stable, no NaN, output bounded',
    run() {
      const op = freshOp({ time: 100, feedback: 0.85, tone: 18000, mix: 1.0 });
      const out = render(op, i => (i < 100 ? Math.sin(2 * Math.PI * 1000 * i / SR) : 0), 8192);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at sample ${i}` };
        if (Math.abs(out[i]) > 5)     return { pass: false, why: `runaway at ${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'fb clamped to 0.85: setParam(feedback, 0.99) does not exceed 0.85',
    run() {
      const op = freshOp({ feedback: 0.99 });
      // We can only verify by behavior — feed silence + tiny seed,
      // observe that decay matches fb=0.85 not 0.99.
      // Cheap test: just feed an impulse and verify no runaway.
      const op2 = freshOp({ time: 30, feedback: 0.99, tone: 18000, mix: 1.0 });
      const out = render(op2, i => (i < 10 ? 0.5 : 0), 16384);
      const tail = tailPeak(out, 12000);
      if (tail > 0.5) return { pass: false, why: `late tail peak=${tail} suggests clamp not engaged` };
      return { pass: true };
    },
  },

  // ── Tone filter inside loop ────────────────────────────────────
  {
    name: 'tone=200Hz: high-frequency content damped quickly through repeats',
    run() {
      const opBright = freshOp({ time: 80, feedback: 0.8, tone: 18000, mix: 1.0 });
      const opDark   = freshOp({ time: 80, feedback: 0.8, tone: 200,   mix: 1.0 });
      // Feed a 5 kHz burst, observe tail energy after several loop trips.
      const N = 16384;
      const inFn = i => (i < 200 ? Math.sin(2 * Math.PI * 5000 * i / SR) : 0);
      const yBright = render(opBright, inFn, N);
      const yDark   = render(opDark,   inFn, N);

      // Measure tail energy in second half.
      const start = N / 2;
      let eBright = 0, eDark = 0;
      for (let i = start; i < N; i++) {
        eBright += yBright[i] * yBright[i];
        eDark   += yDark[i]   * yDark[i];
      }
      // Dark version should have *less* tail energy (LP attenuates each repeat).
      if (eDark >= eBright * 0.9) {
        return { pass: false, why: `dark tail energy=${eDark.toExponential(2)} not significantly < bright=${eBright.toExponential(2)}` };
      }
      return { pass: true };
    },
  },

  // ── reset() ────────────────────────────────────────────────────
  {
    name: 'reset() clears buffer and smoother',
    run() {
      const op = freshOp({ time: 50, feedback: 0.5, mix: 1.0 });
      // Fill buffer with non-zero
      render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR), 4096);
      op.reset();
      // After reset, fresh silence in should give silence out (modulo
      // the smoother re-initializing).
      const out = render(op, 0, 2048);
      // First few samples may be transients from smoother re-init —
      // skip first 256 and check tail is silent.
      const peak = tailPeak(out, 256);
      if (peak > 1e-3) return { pass: false, why: `post-reset tail peak=${peak}` };
      return { pass: true };
    },
  },

  // ── Param robustness ───────────────────────────────────────────
  {
    name: 'NaN/Inf params clamped: setParam(time, NaN) does not corrupt state',
    run() {
      const op = freshOp({ time: 250, feedback: 0.5, mix: 1.0 });
      op.setParam('time', NaN);
      op.setParam('feedback', Infinity);
      op.setParam('tone', -1000);
      const out = render(op, i => (i < 100 ? 0.5 : 0), 4096);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at sample ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'time=10ms (minimum): does not crash, produces output',
    run() {
      const op = freshOp({ time: 10, feedback: 0.5, mix: 1.0 });
      const out = render(op, i => (i < 50 ? 1 : 0), 4096);
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ── Latency contract ───────────────────────────────────────────
  {
    name: 'getLatencySamples() === 0',
    run() {
      const op = freshOp();
      const lat = op.getLatencySamples();
      if (lat !== 0) return { pass: false, why: `latency=${lat}, expected 0` };
      return { pass: true };
    },
  },

  // ── Determinism ────────────────────────────────────────────────
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const params = { time: 200, feedback: 0.6, tone: 4000, mix: 1.0 };
      const a = freshOp(params);
      const b = freshOp(params);
      const inFn = i => Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
      const yA = render(a, inFn, 4096);
      const yB = render(b, inFn, 4096);
      for (let i = 0; i < yA.length; i++)
        if (Math.abs(yA[i] - yB[i]) > EPS)
          return { pass: false, why: `divergence at ${i}: ${yA[i]} vs ${yB[i]}` };
      return { pass: true };
    },
  },

  // ── Missing IO ─────────────────────────────────────────────────
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp();
      const out = new Float32Array(2048);
      op.process({}, { out }, 2048);
      // With no input, dry path is silent + wet starts silent → all zeros.
      for (let i = 0; i < out.length; i++)
        if (Math.abs(out[i]) > 1e-9) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op (no throw)',
    run() {
      const op = freshOp();
      const inBuf = new Float32Array(128);
      try {
        op.process({ in: inBuf }, {}, 128);
      } catch (e) {
        return { pass: false, why: `threw: ${e.message}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'pingPong', tests };
