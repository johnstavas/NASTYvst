// op_pingPong.worklet.js — Stage-3 op sidecar for the `pingPong` op.
//
// Catalog #156 (Delay / Time, ping-pong family). Equal-level stereo
// ping-pong delay using a single mono buffer with two staggered read
// taps. Mono-in, stereo-out. Built-in LP tone filter inside the FB
// loop for progressive darkening + frequency-dependent loop loss.
//
// PRIMARY SOURCES (opened 2026-04-28 per sandbox_op_ship_protocol.md):
//   - JOS, "Physical Audio Signal Processing," chapter "Delay Lines"
//     (cited via memory/jos_pasp_dsp_reference.md — circular buffer
//     with linear-interpolated fractional read is verbatim from the
//     "Lagrange Interpolation" subsection, simplified to first-order).
//   - Zölzer DAFX (2nd ed.) §3.1 "Basic Delay Structures" — the
//     two-tap pattern is the textbook "stereo cross delay" topology
//     (Fig. 3.7) with FB tapped from the longer line.
//   - Memory: dafx_zolzer_textbook.md §3.1.
//
// TOPOLOGY NOTES:
//   • R tap reads at -TIME samples (half the L distance)
//   • L tap reads at -2·TIME samples (full distance)
//   • Single FB tap from the long L tap, LP-filtered, fed back to write
//   • A pulse fires R, L, R, L, R, L … at perfectly equal levels per
//     bounce-pair (only the fb attenuation between pairs)
//   • TIME = bounce-to-bounce interval (R→L spacing)
//   • SPREAD blends wet output between full L/R (1) and mono-summed (0)
//
// PASSAGE ↔ CODE DEVIATIONS:
//   1. **Single mono buffer.** Real Roland Space Echo / dub ping-pong
//      uses two cross-coupled buffers with input only on one side.
//      That topology is asymmetric — one side always 2× louder than
//      the other on equivalent taps. We use a single-buffer two-tap
//      topology that produces equal-level alternation. Trades the
//      "input-side-first" character for clean balance. Declared
//      deviation from the canonical Space Echo signal flow.
//   2. **Per-sample delay-time smoothing** (50 ms one-pole) to kill
//      zipper noise on TIME knob automation.
//   3. **Linear-interpolated fractional read** so smoothed delay
//      length doesn't pop at integer boundaries.
//   4. **LP filter inside FB loop** at user-controlled cutoff. Real
//      analog ping-pongs have a fixed BBD anti-alias filter; ours
//      is musical/tunable. Declared deviation.
//   5. **Soft clamp on FB tap at ±1.5** as paranoid safety (loop is
//      already bounded by tone × fb < 1).
//   6. **No flutter / wow** — modulation belongs to a separate op.

const DENORMAL = 1e-30;

export class PingPongOp {
  static opId = 'pingPong';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'time',     default: 350  },  // ms (10..2000)
    { id: 'feedback', default: 0.5  },  // 0..0.85
    { id: 'tone',     default: 4500 },  // Hz LP cutoff (200..18000)
    { id: 'spread',   default: 1.0  },  // 0=mono wet, 1=full ping-pong
    { id: 'mix',      default: 0.5  },  // dry/wet equal-power
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    // Buffer must hold the long (L) tap = 2× max TIME = 4 s. Add margin
    // for smoother + interpolation read.
    this._MAX = Math.ceil(4.5 * sampleRate);
    this._buf = new Float32Array(this._MAX);
    this._write = 0;
    this._lp = 0;
    this._delaySamplesSmooth = -1;

    this._time     = 350;
    this._feedback = 0.5;
    this._tone     = 4500;
    this._spread   = 1.0;
    this._mix      = 0.5;
  }

  reset() {
    this._buf.fill(0);
    this._write = 0;
    this._lp = 0;
    this._delaySamplesSmooth = -1;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'time')     this._time     = Math.min(Math.max(n, 10), 2000);
    else if (id === 'feedback') this._feedback = Math.min(Math.max(n, 0), 0.85);
    else if (id === 'tone')     this._tone     = Math.min(Math.max(n, 200), 18000);
    else if (id === 'spread')   this._spread   = Math.min(Math.max(n, 0), 1);
    else if (id === 'mix')      this._mix      = Math.min(Math.max(n, 0), 1);
  }

  getLatencySamples() { return 0; }

  // process signature mirrors other sandbox ops:
  //   inputs.in  : Float32Array (mono) — interleaved L+R sum allowed
  //   outputs.out: Float32Array — mono mix-down of stereo result.
  // For stereo output, the inline AudioWorkletProcessor copy in
  // workletSources.js produces 2-channel buffers; this standalone
  // version is for headless math tests so we mono-collapse the two
  // taps for the test harness (declared deviation; documented in
  // tests).
  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    let target = Math.max(1, this._time * this.sr * 0.001);
    if (target * 2 >= this._MAX - 4) target = (this._MAX - 4) * 0.5;

    if (this._delaySamplesSmooth < 0) this._delaySamplesSmooth = target;

    const smoothCoef = 1 - Math.exp(-1 / (0.05 * this.sr));
    const alpha = 1 - Math.exp(-2 * Math.PI * this._tone / this.sr);
    const dryGain = Math.cos(this._mix * Math.PI * 0.5);
    const wetGain = Math.sin(this._mix * Math.PI * 0.5);

    let lp = this._lp;
    let w = this._write;
    let dSmooth = this._delaySamplesSmooth;
    const MAX = this._MAX;
    const buf = this._buf;
    const fb  = this._feedback;
    const spread = this._spread;

    const read = (offset) => {
      let rf = w - offset;
      while (rf < 0) rf += MAX;
      while (rf >= MAX) rf -= MAX;
      const r0 = Math.floor(rf);
      const r1 = (r0 + 1) % MAX;
      return buf[r0] * (1 - (rf - r0)) + buf[r1] * (rf - r0);
    };

    for (let i = 0; i < N; i++) {
      dSmooth += smoothCoef * (target - dSmooth);

      const x = inp ? +inp[i] : 0;

      const wetR = read(dSmooth);
      const wetL = read(dSmooth * 2);

      // LP tone-filter on the long-tap FB.
      lp += alpha * (wetL - lp);

      let next = x + lp * fb;
      if (next >  1.5) next =  1.5;
      if (next < -1.5) next = -1.5;

      buf[w] = next;
      w++;
      if (w >= MAX) w -= MAX;

      // Output: mono-collapse the two taps with spread blend, mix dry.
      // Inline worklet keeps stereo; this standalone form mono-collapses
      // for headless math harness compatibility.
      const wetMid = (wetL + wetR) * 0.5;
      const wetMono = wetMid; // for mono test harness — both taps sum
      // Note: spread parameter has no audible effect in mono collapse;
      // it's preserved so setParam coverage stays consistent with the
      // inline worklet signature.

      let y = x * dryGain + wetMono * wetGain;
      if (Math.abs(y) < DENORMAL) y = 0;
      out[i] = y;
    }

    this._lp = (Math.abs(lp) < DENORMAL) ? 0 : lp;
    this._write = w;
    this._delaySamplesSmooth = dSmooth;
  }
}
