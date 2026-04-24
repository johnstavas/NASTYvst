// op_curve.worklet.js — Stage-3 op sidecar for the `curve` op.
//
// Universal parametric-curve primitive. See opRegistry.js `curve` entry and
// memory/sandbox_modulation_roadmap.md § 3 for the governing doctrine.
//
// ONE primitive authors all five documented contexts:
//   - knob tapers (audio-rate or control-rate)
//   - gain-reduction transfer curves
//   - LFO / envelope shapes
//   - saturation / waveshaping transfer
//   - crossfade laws
//
// Contract:
//   params:
//     points  : ordered list of { x, y, tIn, tOut }, x strictly ascending,
//               first.x = 0, last.x = 1 (endpoints implicit identity).
//     interp  : 'hermite' | 'catmull' | 'linear'
//     bipolar : bool — when true, apply curve to |x| and restore sign.
//
// Evaluator (hermite):
//   For sample x in [p_i.x, p_{i+1}.x], let
//     Δx = p_{i+1}.x - p_i.x
//     t  = (x - p_i.x) / Δx                       ∈ [0, 1]
//     m0 = p_i.tOut          (outgoing slope at left point)
//     m1 = p_{i+1}.tIn       (incoming slope at right point)
//   Cubic Hermite basis:
//     H(t) = ( 2t³ − 3t² + 1)·y0
//          + (  t³ − 2t² + t)·m0·Δx
//          + (−2t³ + 3t²    )·y1
//          + (  t³ −  t²    )·m1·Δx
//
// Evaluator (catmull):
//   Tangent per point derived automatically:
//     m_i = (y_{i+1} − y_{i−1}) / (x_{i+1} − x_{i−1})
//   Endpoints use one-sided difference. Then same Hermite basis.
//
// Evaluator (linear):
//   y = y0 + (y1 − y0) · t       (piecewise linear between points)
//
// Cubic Hermite = cubic Bézier for 1D y=f(x) splines when parametrized by
// slopes. We use Hermite because tangent-based authoring maps cleanly to
// a per-point editor (handle = outgoing slope, in-handle = incoming slope).

export class CurveOp {
  static opId = 'curve';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'points',  default: [
        { x: 0, y: 0, tIn: 1, tOut: 1 },
        { x: 1, y: 1, tIn: 1, tOut: 1 },
      ] },
    { id: 'interp',  default: 'hermite' },
    { id: 'bipolar', default: false },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._points  = [
      { x: 0, y: 0, tIn: 1, tOut: 1 },
      { x: 1, y: 1, tIn: 1, tOut: 1 },
    ];
    this._interp  = 'hermite';
    this._bipolar = false;
    this._rebuildTangents();
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    switch (id) {
      case 'points':
        if (Array.isArray(v) && v.length >= 2) {
          // Deep-copy + normalize: default missing tangents to 1 (identity-ish).
          this._points = v.map(p => ({
            x:    +p.x,
            y:    +p.y,
            tIn:  p.tIn  == null ? 1 : +p.tIn,
            tOut: p.tOut == null ? 1 : +p.tOut,
          }));
          this._rebuildTangents();
        }
        break;
      case 'interp':
        if (v === 'hermite' || v === 'catmull' || v === 'linear') {
          this._interp = v;
          this._rebuildTangents();
        }
        break;
      case 'bipolar':
        this._bipolar = !!v;
        break;
    }
  }

  getLatencySamples() { return 0; }

  // Catmull-Rom derives tangents from neighbors. Precompute so process() is
  // a flat per-sample evaluator with no per-sample branching on interp mode.
  _rebuildTangents() {
    const P = this._points;
    const N = P.length;
    this._cmM = new Float64Array(N);
    if (this._interp !== 'catmull') return;
    for (let i = 0; i < N; i++) {
      let m;
      if (i === 0)          m = (P[1].y - P[0].y) / (P[1].x - P[0].x);
      else if (i === N - 1) m = (P[N-1].y - P[N-2].y) / (P[N-1].x - P[N-2].x);
      else                  m = (P[i+1].y - P[i-1].y) / (P[i+1].x - P[i-1].x);
      this._cmM[i] = m;
    }
  }

  // Binary search: return index i such that points[i].x <= x < points[i+1].x.
  // Clamps to first / last-1 segment at ends.
  _segIndex(x) {
    const P = this._points;
    const N = P.length;
    if (x <= P[0].x)     return 0;
    if (x >= P[N-1].x)   return N - 2;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (P[mid].x <= x) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Evaluate curve at unipolar x ∈ [0, 1].
  _evalUnipolar(x) {
    const P = this._points;
    if (x <= P[0].x)                return P[0].y;
    if (x >= P[P.length - 1].x)     return P[P.length - 1].y;

    const i  = this._segIndex(x);
    const p0 = P[i], p1 = P[i + 1];
    const dx = p1.x - p0.x;
    if (dx <= 0) return p0.y;          // guard degenerate
    const t  = (x - p0.x) / dx;

    if (this._interp === 'linear') {
      return p0.y + (p1.y - p0.y) * t;
    }

    let m0, m1;
    if (this._interp === 'catmull') {
      m0 = this._cmM[i];
      m1 = this._cmM[i + 1];
    } else { // 'hermite'
      m0 = p0.tOut;
      m1 = p1.tIn;
    }

    const t2 = t  * t;
    const t3 = t2 * t;
    const h00 =  2*t3 - 3*t2 + 1;
    const h10 =     t3 - 2*t2 + t;
    const h01 = -2*t3 + 3*t2;
    const h11 =     t3 -   t2;

    return h00 * p0.y + h10 * m0 * dx + h01 * p1.y + h11 * m1 * dx;
  }

  // inputs:  { in?: Float32Array }
  // outputs: { out: Float32Array }
  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!inCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }

    if (this._bipolar) {
      for (let i = 0; i < N; i++) {
        const x   = inCh[i];
        const mag = x < 0 ? -x : x;
        const clamped = mag > 1 ? 1 : mag;
        const y   = this._evalUnipolar(clamped);
        outCh[i]  = x < 0 ? -y : y;
      }
    } else {
      for (let i = 0; i < N; i++) {
        const x = inCh[i];
        const clamped = x < 0 ? 0 : (x > 1 ? 1 : x);
        outCh[i] = this._evalUnipolar(clamped);
      }
    }
  }
}
