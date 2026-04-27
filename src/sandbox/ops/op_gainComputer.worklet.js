// op_gainComputer.worklet.js — Stage-3 op sidecar for the `gainComputer` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Threshold / ratio / knee → delta-from-unity gain-reduction signal.
// Pure sidechain math — no audio path. Stub today: shape locked, inner loop
// zeros. Real implementation will port sandbox-gain-computer worklet body
// (workletSources.js:258) — Zölzer soft-knee form, dB-domain.
//
// Curve-monotonicity is enforced at the graph validator tier
// (T6.GAINCOMP_MONOTONIC in validateGraph.js). Any inner-loop change here
// that breaks monotonicity for valid (threshold, ratio, knee) will also
// show up as a golden-vector delta.

export class GainComputerOp {
  static opId = 'gainComputer';
  static inputs  = Object.freeze([{ id: 'env', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'gr',  kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'thresholdDb', default: -18 },
    { id: 'ratio',       default:   4 },
    { id: 'kneeDb',      default:   6 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._thr   = -18;
    this._ratio = 4;
    this._knee  = 6;
    // Per-sample smoothing state — primed on first block from reset.
    this._thrSmoothed   = -1e30;
    this._ratioSmoothed = -1;
    this._kneeSmoothed  = -1;
  }

  reset() {
    this._thrSmoothed   = -1e30;
    this._ratioSmoothed = -1;
    this._kneeSmoothed  = -1;
  }

  setParam(id, v) {
    if (id === 'thresholdDb') this._thr   = v;
    if (id === 'ratio')       this._ratio = Math.max(1, v);
    if (id === 'kneeDb')      this._knee  = Math.max(0, v);
  }

  getLatencySamples() { return 0; }

  // Zölzer DAFX §4.2.2 soft-knee static gain computer — same form used in
  // the validator's T6.GAINCOMP_MONOTONIC monotonicity sweep (validateGraph.js)
  // so the numerical contract here is sealed against both that rule and the
  // golden-vector hash.
  //
  // Piecewise curve in dB-domain (input level x → output level y):
  //   below knee:  y = x                                  (1:1)
  //   above knee:  y = thr + (x - thr) / ratio            (compressed)
  //   in  knee:    y = x + (1/ratio - 1) · k · t² / 2,    t = (x - thr + K/2)/K
  // where K = kneeDb, k = 1/ratio − 1 (negative for compression), giving
  // the classic quadratic soft-knee blend (Bristow-Johnson / Zölzer).
  //
  // Input (`env`) is a LINEAR magnitude (e.g. output of envelope + abs or
  // sqrt of RMS power). Converted to dB with a small floor to avoid
  // log10(0). Output (`gr`) is a DELTA-FROM-UNITY control signal in [-1, 0]
  // (0 = no reduction, negative = duck). This matches the canonical sandbox
  // runtime convention (workletSources.js sandbox-gain-computer:250) so the
  // signal sums directly into gain.gainMod where the gain op's base is 1.0.
  //   effective_gain = base + gainMod = 1 + (grLin - 1) = grLin
  process(inputs, outputs, N) {
    const envCh = inputs.env;
    const outCh = outputs.gr;
    if (!envCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    // Prime smoothed values on first block from reset.
    if (this._thrSmoothed   < -1e29) this._thrSmoothed   = this._thr;
    if (this._ratioSmoothed < 0)     this._ratioSmoothed = this._ratio;
    if (this._kneeSmoothed  < 0)     this._kneeSmoothed  = this._knee;
    const thrInc   = (this._thr   - this._thrSmoothed)   / (N > 0 ? N : 1);
    const ratioInc = (this._ratio - this._ratioSmoothed) / (N > 0 ? N : 1);
    const kneeInc  = (this._knee  - this._kneeSmoothed)  / (N > 0 ? N : 1);
    let thr   = this._thrSmoothed;
    let ratio = this._ratioSmoothed;
    let knee  = this._kneeSmoothed;
    const LOG10 = 2.302585092994046;
    const FLOOR = 1e-12;
    for (let i = 0; i < N; i++) {
      thr   += thrInc;
      ratio += ratioInc;
      knee  += kneeInc;
      const halfK  = knee * 0.5;
      const invRm1 = (1 / ratio) - 1;
      const lin = envCh[i];
      const mag = lin >= 0 ? lin : -lin;
      const xDb = 20 * Math.log(mag + FLOOR) / LOG10;
      let yDb;
      if (knee > 0 && xDb > thr - halfK && xDb < thr + halfK) {
        const t = (xDb - thr + halfK) / knee;
        yDb = xDb + invRm1 * knee * t * t * 0.5;
      } else if (xDb >= thr + halfK) {
        yDb = thr + (xDb - thr) / ratio;
      } else {
        yDb = xDb;
      }
      const grDb = yDb - xDb;
      outCh[i] = Math.exp(grDb * LOG10 / 20) - 1;
    }
    this._thrSmoothed   = this._thr;
    this._ratioSmoothed = this._ratio;
    this._kneeSmoothed  = this._knee;
  }
}
