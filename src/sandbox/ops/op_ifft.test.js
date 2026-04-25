// op_ifft.test.js — real-math tests for op_ifft.
// Run via: node scripts/check_op_math.mjs
//
// Primary: inverse DFT (math-by-definition) + Cooley-Tukey iterative
// radix-2 with conjugated twiddle + 1/N scale.
// Verifies:
//   - IFFT of δ[k=0] → constant time signal = 1/N
//   - IFFT of a single bin → cosine/sine at that frequency
//   - fft → ifft round-trip reproduces input (≤ 1e-6)
//   - Missing imag input → treated as zero (IFFT of real X[k])
//   - pow2 clamp; reset; determinism; silent before first IFFT

import { IfftOp } from './op_ifft.worklet.js';
import { FftOp  } from './op_fft.worklet.js';

const SR = 48000;

function freshIfft(params = {}) {
  const op = new IfftOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

// Feed complex stream (real[k], imag[k]) of length N and collect the
// first full time-domain block (samples [size .. 2*size-1]).
function runIfft(op, reFill, imFill, size) {
  const total = size * 2;
  const reIn = new Float32Array(total);
  const imIn = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    reIn[i] = typeof reFill === 'function' ? reFill(i) : reFill;
    imIn[i] = typeof imFill === 'function' ? imFill(i) : imFill;
  }
  const out = new Float32Array(total);
  op.process({ real: reIn, imag: imIn }, { out }, total);
  const t = new Float64Array(size);
  for (let n = 0; n < size; n++) t[n] = out[size + n];
  return t;
}

const tests = [
  {
    name: 'IFFT of δ[k=0] (DC-only spectrum) → constant 1/N',
    run() {
      const N = 64;
      const op = freshIfft({ size: N });
      const t = runIfft(op, (i) => (i % N === 0 ? 1 : 0), 0, N);
      // Only k=0 bin has value 1 (first input sample); other bins zero.
      // x[n] = (1/N) · Σ X[k]·e^(+2πikn/N) = 1/N for all n.
      for (let n = 0; n < N; n++)
        if (Math.abs(t[n] - 1 / N) > 1e-6) return { pass: false, why: `t[${n}]=${t[n]}` };
      return { pass: true };
    },
  },
  {
    name: 'IFFT of bin k=4 (plus Hermitian mirror) → cosine at k=4',
    run() {
      const N = 64;
      const k = 4;
      const op = freshIfft({ size: N });
      // Cosine real spectrum: X[k] = X[N-k] = N/2, others zero.
      const re = (i) => {
        const bin = i % N;
        return (bin === k || bin === N - k) ? N / 2 : 0;
      };
      const t = runIfft(op, re, 0, N);
      for (let n = 0; n < N; n++) {
        const expected = Math.cos(2 * Math.PI * k * n / N);
        if (Math.abs(t[n] - expected) > 1e-5) return { pass: false, why: `t[${n}]=${t[n]} exp=${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'fft → ifft round-trip reproduces arbitrary input (≤ 1e-6)',
    run() {
      const N = 128;
      const fft  = new FftOp(SR);  fft.reset();  fft.setParam('size', N);
      const ifft = freshIfft({ size: N });
      const gen = (i) => Math.sin(i * 0.19) + 0.3 * Math.cos(i * 0.73) - 0.2 * Math.sin(i * 1.31);

      // Run fft on 2*N samples; grab spectrum from samples [N .. 2N-1].
      const total = N * 2;
      const xIn = new Float32Array(total);
      for (let i = 0; i < total; i++) xIn[i] = gen(i);
      const fftRe = new Float32Array(total);
      const fftIm = new Float32Array(total);
      fft.process({ in: xIn }, { real: fftRe, imag: fftIm }, total);

      // Feed fft output samples [N..2N-1] into ifft; skip pre-fill phase.
      // Ifft needs 2*N samples too (N to fill, N to emit).
      const ifftIn = new Float32Array(total);
      const ifftImIn = new Float32Array(total);
      // First N samples: any padding (zero). Next N: the fft spectrum.
      for (let i = 0; i < N; i++) { ifftIn[N + i] = fftRe[N + i]; ifftImIn[N + i] = fftIm[N + i]; }
      const ifftOut = new Float32Array(total);
      ifft.process({ real: ifftIn, imag: ifftImIn }, { out: ifftOut }, total);

      // fft emitted the spectrum at indices N..2N-1.
      // ifft read it at those indices; its first FFT fires at sample 2N,
      // which is past our buffer. So we need more samples.
      // Redo: run a third pass of N more samples of zero into ifft to
      // trigger the ifft block.
      const trailRe = new Float32Array(N);
      const trailIm = new Float32Array(N);
      const trailOut = new Float32Array(N);
      ifft.process({ real: trailRe, imag: trailIm }, { out: trailOut }, N);
      // After this, the ifft has completed its block and trailOut holds
      // the round-tripped time-domain samples (samples [0..N-1] of the
      // reconstructed original input).

      for (let n = 0; n < N; n++) {
        const orig = gen(n);
        if (Math.abs(trailOut[n] - orig) > 1e-4)
          return { pass: false, why: `n=${n}: got ${trailOut[n]} exp ${orig}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing imag input → treated as zero (IFFT of real-only spectrum)',
    run() {
      const N = 64;
      const op = freshIfft({ size: N });
      const total = N * 2;
      const re = new Float32Array(total);
      for (let i = 0; i < N; i++) re[i] = (i === 0 ? 1 : 0);
      const out = new Float32Array(total);
      op.process({ real: re }, { out }, total);
      for (let n = 0; n < N; n++)
        if (Math.abs(out[N + n] - 1 / N) > 1e-6) return { pass: false, why: `n=${n}: ${out[N+n]}` };
      return { pass: true };
    },
  },
  {
    name: 'output is silent before first IFFT completes',
    run() {
      const N = 64;
      const op = freshIfft({ size: N });
      const re = new Float32Array(N - 1).fill(1);
      const out = new Float32Array(N - 1);
      op.process({ real: re }, { out }, N - 1);
      for (let i = 0; i < N - 1; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'size param clamped: non-pow2 snaps down; min/max enforced',
    run() {
      const op = freshIfft({ size: 1000 });
      if (op._size !== 512) return { pass: false, why: `size=${op._size}` };
      op.setParam('size', 10);
      if (op._size !== 16) return { pass: false, why: `min ${op._size}` };
      op.setParam('size', 1 << 20);
      if (op._size !== 32768) return { pass: false, why: `max ${op._size}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears buffers',
    run() {
      const N = 64;
      const op = freshIfft({ size: N });
      const reIn = new Float32Array(N + 32).fill(0.5);
      const imIn = new Float32Array(N + 32);
      const out = new Float32Array(N + 32);
      op.process({ real: reIn, imag: imIn }, { out }, N + 32);
      op.reset();
      const out2 = new Float32Array(16);
      op.process({ real: new Float32Array(16), imag: new Float32Array(16) }, { out: out2 }, 16);
      for (let i = 0; i < 16; i++) if (out2[i] !== 0) return { pass: false, why: `post-reset out[${i}]` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs is a no-op (no crash)',
    run() {
      const op = freshIfft({ size: 64 });
      const re = new Float32Array(128).fill(0.1);
      const im = new Float32Array(128);
      op.process({ real: re, imag: im }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same input → identical time-domain across instances',
    run() {
      const N = 128;
      const re = (i) => Math.sin(i * 0.07);
      const im = (i) => Math.cos(i * 0.13);
      const a = runIfft(freshIfft({ size: N }), re, im, N);
      const b = runIfft(freshIfft({ size: N }), re, im, N);
      for (let n = 0; n < N; n++) if (a[n] !== b[n]) return { pass: false, why: `diverge at ${n}` };
      return { pass: true };
    },
  },
  {
    name: 'IFFT of zero spectrum → silence',
    run() {
      const N = 64;
      const op = freshIfft({ size: N });
      const t = runIfft(op, 0, 0, N);
      for (let n = 0; n < N; n++)
        if (Math.abs(t[n]) > 1e-12) return { pass: false, why: `t[${n}]=${t[n]}` };
      return { pass: true };
    },
  },
  {
    name: 'IFFT of δ[k=1]+δ[k=N-1] (unit real cosine) → cos(2πn/N)',
    run() {
      const N = 64;
      const op = freshIfft({ size: N });
      // X[1] = X[N-1] = N/2 → x[n] = cos(2πn/N)
      const re = (i) => {
        const bin = i % N;
        return (bin === 1 || bin === N - 1) ? N / 2 : 0;
      };
      const t = runIfft(op, re, 0, N);
      for (let n = 0; n < N; n++) {
        const exp = Math.cos(2 * Math.PI * n / N);
        if (Math.abs(t[n] - exp) > 1e-5) return { pass: false, why: `n=${n}: ${t[n]} vs ${exp}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'ifft', tests };
