// op_oversample2x — #12. 2× polyphase IIR halfband oversampler roundtrip.
//
// Primary source (opened 2026-04-24, WTFPL — ship-safe verbatim):
//   hiir by Laurent de Soras (https://github.com/unevens/hiir mirror)
//   • StageProcFpu.hpp            L60–L80   — polyphase allpass cascade core
//   • Upsampler2xFpuTpl.hpp       L106–L121 — process_sample (1 → 2)
//   • Downsampler2xFpuTpl.hpp     L104–L122 — process_sample (2 → 1)
//   • PolyphaseIir2Designer.h     L451–L585 — compute_coefs designer
//   Author: Laurent de Soras, 2005. License: WTFPL v2 (Sam Hocevar).
//
// VERBATIM — StageProcFpu L60–L75 (pair stage at offset cnt):
//   const DT temp_0 = (spl_0 - y[cnt+0]) * coef[cnt+0] + x[cnt+0];
//   const DT temp_1 = (spl_1 - y[cnt+1]) * coef[cnt+1] + x[cnt+1];
//   x[cnt+0] = spl_0;   x[cnt+1] = spl_1;
//   y[cnt+0] = temp_0;  y[cnt+1] = temp_1;
//   spl_0 = temp_0;     spl_1 = temp_1;
//
// VERBATIM — Upsampler2x L106–L121:
//   DataType even = input; DataType odd = input;
//   StageProc::process_sample_pos(NBR_COEFS, even, odd, _coef, _x, _y);
//   out_0 = even; out_1 = odd;
//
// VERBATIM — Downsampler2x L104–L122:
//   DataType spl_0(in_ptr[1]); DataType spl_1(in_ptr[0]);
//   StageProc::process_sample_pos(NBR_COEFS, spl_0, spl_1, _coef, _x, _y);
//   return 0.5 * (spl_0 + spl_1);
//
// Algorithm (hiir polyphase halfband):
//   Coefficient array c[0..M-1] is interleaved: even indices (0,2,4,…)
//   process lane 0 (spl_0), odd indices (1,3,5,…) process lane 1 (spl_1).
//   Each lane is an allpass cascade in the ONE-delay form y = (x - y_prev)*c
//   + x_prev; the implicit z⁻¹ at the lane level IS the polyphase
//   half-sample phase offset that makes the pair a halfband filter.
//
// Semantics of this op:
//   Input → 2× upsample (one lane) → pair (prevOdd, curEven) → 2× downsample
//   → output. Near-allpass on its own; exists so #13 saturate / #112 tape /
//   #113 tube / #114 noiseShaper can share a single audited OS cascade.
//
// Deviations from hiir:
//   A. Template/recursion unrolled to a flat for-loop over coef indices,
//      manually alternating lane-0 vs lane-1 state. Algebraically identical
//      (compiler would unroll hiir's template recursion to the same).
//   B. Coefficient designer ported directly from L451–L585. `ipowp(q, n)`
//      with integer n replaced by `Math.pow(q, n)` — identical for n≥0.
//   C. Two independent state sets (_xU/_yU up-path, _xD/_yD down-path); in
//      hiir these live in separate Upsampler/Downsampler class instances.
//   D. Denormal flush at end of each process() block (ship_blockers.md).
//      hiir does not do this.
//   E. Order forced to odd ≥ 3 (hiir compute_order identical behaviour).

const DENORMAL = 1e-30;

// -------- designer (ported from PolyphaseIir2Designer.h L451–L585) ---------
function computeTransitionParam(transition) {
  let k = Math.tan((1 - transition * 2) * Math.PI / 4);
  k *= k;
  const kksqrt = Math.pow(1 - k * k, 0.25);
  const e  = 0.5 * (1 - kksqrt) / (1 + kksqrt);
  const e2 = e * e;
  const e4 = e2 * e2;
  const q  = e * (1 + e4 * (2 + e4 * (15 + 150 * e4)));
  return { k, q };
}

function computeOrder(attenuation, q) {
  const attn_p2 = Math.pow(10.0, -attenuation / 10);
  const a = attn_p2 / (1 - attn_p2);
  let order = Math.ceil(Math.log(a * a / 16) / Math.log(q));
  if ((order & 1) === 0) order++;
  if (order === 1) order = 3;
  return order;
}

function computeAccNum(q, order, c) {
  let i = 0, j = 1, acc = 0, qii1;
  do {
    qii1 = Math.pow(q, i * (i + 1));
    qii1 *= Math.sin((i * 2 + 1) * c * Math.PI / order) * j;
    acc += qii1;
    j = -j; i++;
  } while (Math.abs(qii1) > 1e-100 && i < 64);
  return acc;
}

function computeAccDen(q, order, c) {
  let i = 1, j = -1, acc = 0, qi2;
  do {
    qi2 = Math.pow(q, i * i);
    qi2 *= Math.cos(i * 2 * c * Math.PI / order) * j;
    acc += qi2;
    j = -j; i++;
  } while (Math.abs(qi2) > 1e-100 && i < 64);
  return acc;
}

function computeCoef(index, k, q, order) {
  const c    = index + 1;
  const num  = computeAccNum(q, order, c) * Math.pow(q, 0.25);
  const den  = computeAccDen(q, order, c) + 0.5;
  const ww   = num / den;
  const wwsq = ww * ww;
  const x    = Math.sqrt((1 - wwsq * k) * (1 - wwsq / k)) / (1 + wwsq);
  return (1 - x) / (1 + x);
}

function designCoefs(attenuation, transition) {
  const { k, q } = computeTransitionParam(transition);
  const order    = computeOrder(attenuation, q);
  // hiir designer: for (index=0; index*2 < order; ++index) coef[index]=...
  // Length = ceil(order/2).
  const len = (order + 1) >> 1;
  const coef = new Float64Array(len);
  for (let i = 0; i < len; i++) coef[i] = computeCoef(i, k, q, order);
  return coef;
}

// -------- op ---------------------------------------------------------------

export class Oversample2xOp {
  static opId   = 'oversample2x';
  static inputs = [{ id: 'in',  kind: 'audio' }];
  static outputs = [{ id: 'out', kind: 'audio' }];
  static params = [
    { id: 'attenuationDb', default: 100 },
    { id: 'transitionBw',  default: 0.01 },
  ];

  constructor(sampleRate = 48000) {
    this._sr    = sampleRate;
    this._atten = 100;
    this._tbw   = 0.01;
    this._design();
    this._pendingOdd = 0;
  }

  _design() {
    this._coef = designCoefs(this._atten, this._tbw);
    this._N    = this._coef.length;
    // hiir StageProcFpu packs coefs as pairs: coef[0]=lane0, coef[1]=lane1,
    // coef[2]=lane0, etc. Our designCoefs returns the same interleaved
    // layout (ceil(order/2) values, ordered by `index`).
    this._xU = new Float64Array(this._N);
    this._yU = new Float64Array(this._N);
    this._xD = new Float64Array(this._N);
    this._yD = new Float64Array(this._N);
  }

  reset() {
    this._xU.fill(0); this._yU.fill(0);
    this._xD.fill(0); this._yD.fill(0);
    this._pendingOdd = 0;
  }

  setParam(id, v) {
    if (id === 'attenuationDb') {
      const nv = Math.max(20, Math.min(200, +v || 100));
      if (nv !== this._atten) { this._atten = nv; this._design(); this._pendingOdd = 0; }
    } else if (id === 'transitionBw') {
      const nv = Math.max(0.001, Math.min(0.45, +v || 0.01));
      if (nv !== this._tbw) { this._tbw = nv; this._design(); this._pendingOdd = 0; }
    }
  }

  getLatencySamples() { return 1; }

  // Faithful polyphase stage: operate on BOTH lanes, alternating coef
  // assignment (lane0 ← even indices, lane1 ← odd indices). Matches hiir
  // StageProcFpu pair-processing exactly.
  _stage(s0, s1, x, y) {
    const c = this._coef;
    const N = this._N;
    let i = 0;
    // Pairs (i, i+1): i → lane0, i+1 → lane1
    for (; i + 1 < N; i += 2) {
      const t0 = (s0 - y[i])     * c[i]     + x[i];
      const t1 = (s1 - y[i + 1]) * c[i + 1] + x[i + 1];
      x[i] = s0;     x[i + 1] = s1;
      y[i] = t0;     y[i + 1] = t1;
      s0 = t0;       s1 = t1;
    }
    // Trailing single coef (N odd): applied to lane0
    if (i < N) {
      const t0 = (s0 - y[i]) * c[i] + x[i];
      x[i] = s0; y[i] = t0;
      s0 = t0;
    }
    return [s0, s1];
  }

  process(inputs, outputs, blockLen) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;
    if (!inp) { out.fill(0); return; }

    const N = blockLen;
    for (let n = 0; n < N; n++) {
      const input = inp[n];

      // Upsample: input → (even, odd)
      const [evenU, oddU] = this._stage(input, input, this._xU, this._yU);

      // Downsample expects (in[1]=s0, in[0]=s1). Pair = (pendingOdd, evenU)
      // with in[0]=pendingOdd, in[1]=evenU → s0=evenU, s1=pendingOdd.
      const [d0, d1] = this._stage(evenU, this._pendingOdd, this._xD, this._yD);
      out[n] = 0.5 * (d0 + d1);

      this._pendingOdd = oddU;
    }

    // Denormal flush
    for (let i = 0; i < this._N; i++) {
      if (Math.abs(this._xU[i]) < DENORMAL) this._xU[i] = 0;
      if (Math.abs(this._yU[i]) < DENORMAL) this._yU[i] = 0;
      if (Math.abs(this._xD[i]) < DENORMAL) this._xD[i] = 0;
      if (Math.abs(this._yD[i]) < DENORMAL) this._yD[i] = 0;
    }
    if (Math.abs(this._pendingOdd) < DENORMAL) this._pendingOdd = 0;
  }
}
