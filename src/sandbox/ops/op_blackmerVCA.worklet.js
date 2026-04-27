// op_blackmerVCA.worklet.js — Stage-3 op sidecar for the `blackmerVCA` op.
//
// #142 Dynamics — Log-add-antilog VCA gain cell modeling the Blackmer
// (dbx / THAT 2180) topology. Linear voltage-controlled multiplier with
// optional class-AB Vbe-mismatch character (asymmetric 2nd-harmonic
// distortion, signed by bias param).
//
// PRIMARY (opened 2026-04-26 via WebFetch, Google Patents):
//   1. Blackmer, David E., "Multiplier Circuits," US Patent 3,714,462,
//      filed 1971-06-14, issued 1973-01-30 (assignee: D. E. Blackmer,
//      later reassigned dbx, Inc.).
//      VERBATIM (abstract): "A gain control or multiplier circuit in
//      which an input operational amplifier has a pair of feedback
//      paths through respective collector-emitter circuits of opposite
//      conductivity type transistors to form a first bipolar circuit
//      for converting an input signal to a log form."
//      VERBATIM (claim): "Each transistor of the first circuit has
//      connected to it another transistor for converting the log
//      signal into its antilog... Q₁ and Q₂ are of opposite conductivity
//      types... function as logarithmic converters respectively to
//      convert the positive and negative portions of the input signal...
//      into logarithmic form... Transistors Q₃ and Q₄ serve as antilog
//      converters which reconvert the signals from transistors Q₁ and
//      Q₂ into linear currents."
//      VERBATIM (transfer function): "Output = antilog(log(Input) +
//      Control)"
//      VERBATIM (matching spec): "Transistors Q₃ and Q₄ are both PNP
//      type and are preferably matched for V_be within 1 mV at 40 µA"
//      mounted on "a common heat sink." The 1 mV mismatch produces
//      audible character (bias-induced 2nd harmonic).
//      VERBATIM (range): "excellent gain control over at least a ±50
//      decibel range with very low distortion."
//      Tier: S (named-inventor patent, expired).
//
//   2. THAT Corporation 2180/2181 Series Datasheet (Tier-A modern
//      implementation reference). Canonical control law: **-6 mV/dB**
//      at the cv input (6 mV positive cv → 1 dB gain decrease in the
//      original PNP-bias convention; we expose +cv = +gain-dB to be
//      ergonomic for sandbox composition).
//
// MATH-BY-DEFINITION (declared per ship-protocol):
//   The PATENT specifies topology and ±50 dB range with "very low
//   distortion" — but does NOT specify the exact shape of the harmonic
//   distortion vs signal level. The class-AB Vbe-mismatch character
//   below (`bias · y · |y|` 2nd-harmonic generator) is a phenomenological
//   model anchored to the patent's matching tolerance: a 1 mV mismatch
//   at 40 µA forward current corresponds to ~2.5% relative current
//   asymmetry → on the order of bias=0.025 in our parameterization.
//   Logged as research-debt P2 — when measured-distortion data on
//   real Blackmer VCAs surfaces, V2 upgrade tunes the curve shape.
//
// AUTHORING SHAPE:
//   Inputs  : audio  (audio — signal to gain-control)
//             cv     (audio — gain control in dB; 0 = unity gain,
//                              +6 = +6 dB, -12 = -12 dB)
//   Outputs : out    (audio)
//   Params  :
//     bias  (default 0.0,  range -0.5..0.5)  — class-AB asymmetry /
//                                              2nd-harmonic amount.
//                                              0 = ideal multiplier;
//                                              ±0.025 ≈ patent-spec'd
//                                              1 mV mismatch character;
//                                              ±0.2 = strong audible
//                                              "warm" coloration.
//     trim  (default 0.0,  range -24..+24)   — output trim in dB.
//                                              Compensates cv-driven
//                                              gain offsets at chain
//                                              composition.
//
// State: NONE — memoryless. Output depends only on current sample's
// (audio, cv) plus param values. getLatencySamples() = 0.
//
// Algorithm (per-sample):
//   1. gain = exp(cv · ln10/20)              // dB → linear (10^(cv/20))
//   2. y_clean = x · gain                    // linear gain stage
//   3. y_char  = bias · |y_clean|            // class-AB asymmetry term:
//                                            //   |y| has Fourier series
//                                            //   (2/π) − (4/3π)·cos(2ωt)
//                                            //   − (4/15π)·cos(4ωt) − ...
//                                            //   → produces DC + 2H + 4H
//                                            //   (true even-order distortion
//                                            //   from PNP/NPN mismatch)
//   4. out = (y_clean + y_char) · trimLin    // apply output trim
//
// NOTE on DC: this model produces a DC offset of (bias · 2/π · |peak|).
// For real Blackmer cells, this is the documented "control feedthrough."
// For applications needing strict 0-DC output, compose with #17 dcBlock
// after this op (sandbox convention: ops are minimal; cleanup is wired
// at the brick layer).

const LN10_OVER_20 = 0.11512925464970228;  // ln(10) / 20

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export class BlackmerVCAOp {
  static opId = 'blackmerVCA';
  static inputs  = Object.freeze([
    { id: 'audio', kind: 'audio' },
    { id: 'cv',    kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'bias', default: 0.0 },
    { id: 'trim', default: 0.0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._bias = 0.0;
    this._trim = 0.0;
    this._trimLin = 1.0;
  }

  reset() { /* memoryless — nothing to reset */ }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'bias': this._bias = clip(x, -0.5,  0.5);  break;
      case 'trim':
        this._trim    = clip(x, -24, 24);
        this._trimLin = Math.exp(this._trim * LN10_OVER_20);
        break;
      default: return;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;
    const audioCh = inputs.audio;
    const cvCh    = inputs.cv;
    const bias    = this._bias;
    const trimLin = this._trimLin;

    if (!audioCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x  = audioCh[i];
      const cv = cvCh ? cvCh[i] : 0;
      // Skip exp() if cv is non-finite — fall through to unity gain.
      const gain = Number.isFinite(cv) ? Math.exp(cv * LN10_OVER_20) : 1.0;
      const yClean = x * gain;
      // Class-AB even-order distortion: bias · |y|. Fourier series
      // (2/π − 4/(3π)·cos(2ωt) − ...) produces DC + 2H + 4H content.
      const absY  = yClean < 0 ? -yClean : yClean;
      const yChar = bias * absY;
      outCh[i] = (yClean + yChar) * trimLin;
    }
  }
}
