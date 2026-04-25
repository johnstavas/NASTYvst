// op_haas.worklet.js — Catalog #105 (Spatial family).
//
// Haas stereo widener — single-reflection precedence-effect trick.
//
// PRIMARY (psychoacoustic thresholds):
//   Haas 1951, "Über den Einfluss eines Einfachechos auf die Hörsamkeit von
//   Sprache", Acustica 1(2):49–58. English: "The Influence of a Single Echo
//   on the Audibility of Speech", JAES 20(2):146–159 (1972). AES-paywalled.
//
//   Accessible secondary: Wikipedia "Precedence effect" (fetched 2026-04-24)
//   restating Haas's time-window thresholds:
//     < 2 ms       — summing localization (single fused image between L/R)
//     2–5 ms       — localization dominance (precedence): single image at
//                    the location of the leading (earlier) channel
//     5–30 ms      — echo suppression: delayed copy can be up to +10 dB
//                    hotter than the lead and still fuse into a single event
//     > ~30–50 ms  — perceived as discrete echo
//
// DSP: CORE is math-by-definition (ring-buf delay + scalar gain + routing
// + crossfade). Two sub-decisions are NOT math-by-def — they are design
// picks from a documented menu, shipped without opening the primaries:
//
//   (1) FRACTIONAL-DELAY TAP = first-order linear interpolation.
//       Menu of alternatives (with documented tradeoffs):
//         JOS *Physical Audio Signal Processing* Ch.4 "Delay-Line
//         Interpolation"; Zölzer *DAFX* §11.3; Canon:time §1–3
//         (Hermite, Niemitalo cubic, Bielik). Linear introduces HF
//         rolloff and amplitude modulation near fractional boundaries;
//         acceptable default for a 5–30 ms reflection where the delayed
//         leg is already a creative effect, not a transparent path.
//         Upgrade logged in research_debt #105(i).
//
//   (2) STEREO SUMMING of optional `in2` = scalar ×0.5 (simple sum/2).
//       Equal-power (×1/√2) is the correlated-source alternative and is
//       what most mixers use for LCR-to-L fold. Our ×0.5 is more correct
//       for two decorrelated sources (stereo program). Upgrade logged
//       in research_debt #105(j).
//
// Haas 1951 passage constrains ONLY defaults and param ranges.
//
// TOPOLOGY (per-sample, no allocs):
//   in  ──┬────────────────────────────▶  direct side (L if side='L' else R)
//         └── delay(delayMs) · 10^(lvl/20) ▶  delayed side
//
// If `input2` is connected, we sum L+R mono-first to avoid pre-existing
// width breaking the fused-image assumption; otherwise mono-in duplicated.
//
// PARAMS
//   delayMs     — single-reflection delay                [0, 50]    default 18   (mid precedence window)
//   levelDb     — delayed-side trim relative to direct   [-24, +10] default 0    (Haas ceiling = +10 dB)
//   side        — which side is delayed (0=R, 1=L)       {0, 1}     default 0    (R delayed → L "leads")
//   mix         — dry/wet of delayed leg                 [0, 1]     default 1    (1 = full Haas; 0 = mono passthrough)
//
// OUTPUTS (audio-rate)
//   l, r — stereo pair. Left and right always present. When mix=0 both
//          channels equal the mono input (bypass-style).
//
// NOT in scope (research debt):
//   · Low-pass on delayed leg (Blauert ch.3 — reflection filtering).
//   · Per-frequency decorrelation (all-pass diffusion for wider image).
//   · True precedence-effect compensation on transients (echo-suppression
//     breaks down on impulsive material; could compress delayed side).

const MAX_DELAY_MS = 50;

export class HaasOp {
  static opId = 'haas';
  static inputs = Object.freeze([
    { id: 'in',  kind: 'audio' },
    { id: 'in2', kind: 'audio', optional: true },
  ]);
  static outputs = Object.freeze([
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'delayMs', default: 18 },
    { id: 'levelDb', default: 0  },
    { id: 'side',    default: 0  },
    { id: 'mix',     default: 1  },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._delayMs = 18;
    this._levelDb = 0;
    this._side    = 0;
    this._mix     = 1;

    // Ring buffer sized to max delay + 1 sample.
    const n = 1 << Math.ceil(Math.log2(Math.max(4, Math.ceil(MAX_DELAY_MS * 0.001 * sampleRate) + 2)));
    this.buf  = new Float32Array(n);
    this.mask = n - 1;
    this.w    = 0;
  }

  reset() {
    this.buf.fill(0);
    this.w = 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'delayMs': this._delayMs = Math.max(0,   Math.min(MAX_DELAY_MS, v)); break;
      case 'levelDb': this._levelDb = Math.max(-24, Math.min(10,          v)); break;
      case 'side':    this._side    = v >= 0.5 ? 1 : 0; break;
      case 'mix':     this._mix     = Math.max(0,   Math.min(1,           v)); break;
    }
  }

  process(inputs, outputs, N) {
    const inA = inputs && inputs.in  ? inputs.in  : null;
    const inB = inputs && inputs.in2 ? inputs.in2 : null;
    const lOut = outputs && outputs.l ? outputs.l : null;
    const rOut = outputs && outputs.r ? outputs.r : null;
    if (!lOut && !rOut) return;

    const buf = this.buf, mask = this.mask;
    const delaySamp = this._delayMs * 0.001 * this.sr;
    const d0 = Math.floor(delaySamp);
    const frac = delaySamp - d0;  // linear-interp fraction
    const gain = Math.pow(10, this._levelDb / 20);
    const mix = this._mix;
    const delayedIsR = this._side === 0;

    for (let n = 0; n < N; n++) {
      // Mono input: sum of A+B if both connected (*0.5 to avoid clip), else A.
      const a = inA ? inA[n] : 0;
      const b = inB ? inB[n] : 0;
      const x = inB ? (a + b) * 0.5 : a;

      // Write into ring.
      buf[this.w] = x;

      // Tap with fractional delay (linear interp).
      const r0 = (this.w - d0)     & mask;
      const r1 = (this.w - d0 - 1) & mask;
      const delayed = buf[r0] + (buf[r1] - buf[r0]) * frac;

      const delayedScaled = delayed * gain;
      const wet = delayedScaled * mix + x * (1 - mix);

      if (delayedIsR) {
        if (lOut) lOut[n] = x;
        if (rOut) rOut[n] = wet;
      } else {
        if (lOut) lOut[n] = wet;
        if (rOut) rOut[n] = x;
      }

      this.w = (this.w + 1) & mask;
    }
  }

  // Delay side introduces delayMs of latency vs direct side. Return that as
  // a worst-case figure; the direct side has zero latency.
  getLatencySamples() { return Math.ceil(this._delayMs * 0.001 * this.sr); }
}
