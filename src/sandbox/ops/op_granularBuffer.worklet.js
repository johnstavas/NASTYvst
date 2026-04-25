// op_granularBuffer.worklet.js — Catalog #69 (Delay/Time family).
//
// Self-contained granular buffer: capture input to a circular buffer, spawn
// windowed grains that re-read the buffer at controllable offset / rate /
// jitter, sum to a single mono output. Live granulator topology (no host
// SndBuf dependency).
//
// PRIMARIES (algorithm, open):
//   · SuperCollider · server/plugins/GrainUGens.cpp · GrainBuf_next_play_active
//     (lines 1070-1115) and GrainBuf_next_start_new (lines 1119-1185, GPLv3).
//     Algorithm copied (active-grain pool + per-grain phase advance + window
//     mul + accumulate + retire), code NOT copied.
//   · Bencina, R. "Implementing Real-Time Granular Synthesis" (open chapter
//     at rossbencina.com/static/code/granular-synthesis/) — same structure
//     restated for self-contained granulators.
//   · Window envelope: Hann w[t] = 0.5·(1 − cos(2π·t/(N−1))) (math-by-def).
//   · Linear-interp fractional read: y = (1−α)·b[i] + α·b[i+1] (DAFX §3.5).
//
// VERBATIM PASSAGE (SC structural shape, for diff only):
//   per active grain: advance phase by `rate`; sample window at counter/dur;
//                     out += amp · window · interp(buf, phase);
//                     decrement counter; cleanup when ≤ 0.
//   on trigger:       allocate new grain { counter=durSamples, phase=startOffset,
//                                          rate=pitchRatio, winType=Hann };
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) Self-contained circular write buffer (sized at construction by the
//       user-facing `bufMs` cap of 2000 ms). SC reads from an external host
//       SndBuf; we own the buffer because sandbox ops are stateless w.r.t.
//       host objects. Upgrade path: external buffer-port if/when sandbox
//       grows that kind (debt row).
//  (ii) Window = Hann only. SC supports custom windows via host buffer +
//       internal Hann/Triangle/Sine. Hann gives smooth bell shape, low
//       sidelobes, common default. Upgrade: window enum (debt row).
// (iii) Interp = linear only. SC offers cubic; cubic costs ~3× the lookup
//       and matters most for extreme stretch/pitch — typical granular use
//       is short grains where linear is fine. Upgrade: interp enum (debt).
//  (iv) Pool size = 16 grains. Bencina recommends ≥ density·grainSec for
//       no-clip scheduling. At density=20 Hz, grainMs=50 ms → expected
//       active = 1.0 grain. 16 covers density·grainMs up to ~16/0.001 (16
//       short grains). New triggers when pool is full are silently dropped
//       (matches SC "Too many grains!" logic, but without the print).
//   (v) Trigger source = internal Poisson-style sampling at `density` Hz.
//       Each sample, prob(trigger) = density / sr. Reuses feldkirch PRNG
//       (shared with #58/#124/#125/#60). Upgrade: external trig input
//       port (debt row).
//  (vi) Jitter = ±jitterMs random offset added to each grain's start phase,
//       uniform [-jitter, +jitter] from PRNG. SC handles this as a `pos`
//       audio-rate input; we fold it into the param surface.
// (vii) Detune = ±detuneCents random pitch offset per grain, uniform.
//       Combined with `pitchCents` (deterministic shift) → final rate =
//       2^((pitchCents + jitter_cents)/1200).
//(viii) Output normalised by 1/√maxGrains — keeps RMS bounded as density
//       rises (statistical sum of independent grains). Slight under-gain
//       for sparse grains, slight over-gain for dense — known trade.
//
// PARAMS
//   bufMs        — circular buffer length    [10, 2000]     default 1000  (cap; allocates at ctor)
//   delayMs      — read offset (lag behind write head) [0, 2000] default 100
//   grainMs      — grain duration            [1, 500]       default 50
//   density      — trigger rate (Hz)         [0.1, 200]     default 20
//   jitterMs     — random read offset spread [0, 1000]      default 0
//   pitchCents   — fixed pitch shift         [-2400, 2400]  default 0
//   detuneCents  — random pitch spread       [0, 1200]      default 0
//   level        — output level (linear)     [0, 1]         default 1
//
// I/O
//   inputs:  in  (audio — captured to ring buffer)
//   outputs: out (audio — sum of active windowed grains)
//
// LATENCY: 0 (output is generated from past samples; no algorithmic delay
//             beyond the user-set `delayMs`).

const SCALE     = 2.0 / 0xffffffff;   // PRNG → [-1, 1)
const MAX_GRAINS = 16;
const MAX_BUF_MS = 2000;
const POOL_NORM  = 1 / Math.sqrt(MAX_GRAINS);

export class GranularBufferOp {
  static opId = 'granularBuffer';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'bufMs',       default: 1000 },
    { id: 'delayMs',     default: 100  },
    { id: 'grainMs',     default: 50   },
    { id: 'density',     default: 20   },
    { id: 'jitterMs',    default: 0    },
    { id: 'pitchCents',  default: 0    },
    { id: 'detuneCents', default: 0    },
    { id: 'level',       default: 1    },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    // allocate worst-case buffer at construction (param-time changes can't grow it)
    this._bufFrames = Math.max(1, Math.ceil(MAX_BUF_MS * 0.001 * sampleRate));
    this._buf       = new Float32Array(this._bufFrames);
    this._w         = 0;  // write head

    // params (defaults; clamped on setParam)
    this._delayS    = 0.1;
    this._grainS    = 0.05;
    this._density   = 20;
    this._jitterS   = 0;
    this._pitchR    = 1;        // ratio = 2^(cents/1200)
    this._detuneC   = 0;        // cents (will be converted per-grain)
    this._level     = 1;

    // grain pool: parallel arrays for tight loops
    this._gPhase   = new Float64Array(MAX_GRAINS);  // fractional read pos in buf
    this._gRate    = new Float64Array(MAX_GRAINS);  // playback rate (samples/sample)
    this._gCount   = new Int32Array(MAX_GRAINS);    // samples remaining
    this._gDur     = new Int32Array(MAX_GRAINS);    // total grain length samples
    this._gActive  = new Uint8Array(MAX_GRAINS);    // 0/1 flag

    // PRNG (feldkirch, shared seed family with #58/#124/#125/#60)
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
  }

  reset() {
    this._buf.fill(0);
    this._w = 0;
    this._gActive.fill(0);
    this._gPhase.fill(0);
    this._gCount.fill(0);
    this._gDur.fill(0);
    this._gRate.fill(0);
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'bufMs':       /* cap-only; allocated at ctor (debt row) */ break;
      case 'delayMs':     this._delayS  = Math.max(0,    Math.min(MAX_BUF_MS, v)) * 0.001; break;
      case 'grainMs':     this._grainS  = Math.max(1,    Math.min(500,        v)) * 0.001; break;
      case 'density':     this._density = Math.max(0.1,  Math.min(200,        v)); break;
      case 'jitterMs':    this._jitterS = Math.max(0,    Math.min(1000,       v)) * 0.001; break;
      case 'pitchCents':  this._pitchR  = Math.pow(2, Math.max(-2400, Math.min(2400, v)) / 1200); break;
      case 'detuneCents': this._detuneC = Math.max(0,    Math.min(1200,       v)); break;
      case 'level':       this._level   = Math.max(0,    Math.min(1,          v)); break;
    }
  }

  // PRNG → uniform [-1, 1)
  _rand() {
    this._x1 = (this._x1 ^ this._x2) | 0;
    const u = this._x2 * SCALE;
    this._x2 = (this._x2 + this._x1) | 0;
    return u;
  }

  // Spawn a new grain into the first inactive slot. Silently drop if pool full.
  // wHead is passed explicitly so the caller can hand us its block-local write
  // position — `this._w` is only flushed back at end-of-block.
  _spawn(wHead) {
    let slot = -1;
    for (let i = 0; i < MAX_GRAINS; i++) {
      if (!this._gActive[i]) { slot = i; break; }
    }
    if (slot < 0) return;  // pool exhausted (matches SC "too many grains" path)

    const sr  = this.sr;
    const dur = Math.max(4, Math.round(this._grainS * sr));
    const jitterSamples = this._jitterS * sr * this._rand();      // [-jitter, +jitter]
    const detuneCents   = this._detuneC * this._rand();           // [-detuneC, +detuneC]
    const rate          = this._pitchR * Math.pow(2, detuneCents / 1200);

    // Start phase = (write head − delay − jitter), wrapped into buf
    const N      = this._bufFrames;
    const offset = this._delayS * sr + jitterSamples;
    let phase    = wHead - offset;
    phase = phase - N * Math.floor(phase / N);  // positive modulo

    this._gPhase[slot]  = phase;
    this._gRate[slot]   = rate;
    this._gCount[slot]  = dur;
    this._gDur[slot]    = dur;
    this._gActive[slot] = 1;
  }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const inBuf = inputs && inputs.in ? inputs.in : null;
    const buf   = this._buf;
    const M     = this._bufFrames;
    const lvl   = this._level;
    const triggerProb = this._density / this.sr;

    let w = this._w;

    for (let n = 0; n < N; n++) {
      // 1) capture input sample to ring buffer
      buf[w] = inBuf ? inBuf[n] : 0;
      w++;
      if (w >= M) w = 0;

      // 2) probabilistic spawn (Bernoulli trigger at density Hz)
      // Use uniform [0,1) from feldkirch via (rand+1)/2
      const u = (this._rand() + 1) * 0.5;
      if (u < triggerProb) this._spawn(w);

      // 3) play active grains; sum to acc
      let acc = 0;
      for (let g = 0; g < MAX_GRAINS; g++) {
        if (!this._gActive[g]) continue;

        const dur   = this._gDur[g];
        const t     = dur - this._gCount[g];   // samples elapsed: 0 .. dur-1
        // Hann window: w[t] = 0.5 · (1 − cos(2π·t/(dur−1)))  (math-by-def)
        const win   = 0.5 * (1 - Math.cos(2 * Math.PI * t / Math.max(1, dur - 1)));

        // linear-interp read at fractional phase
        let p = this._gPhase[g];
        p = p - M * Math.floor(p / M);  // wrap positive
        const i0 = p | 0;
        const i1 = (i0 + 1) % M;
        const a  = p - i0;
        const sample = (1 - a) * buf[i0] + a * buf[i1];

        acc += win * sample;

        // advance phase + counter
        this._gPhase[g] = p + this._gRate[g];
        this._gCount[g]--;
        if (this._gCount[g] <= 0) this._gActive[g] = 0;
      }

      out[n] = acc * POOL_NORM * lvl;
    }

    this._w = w;
  }

  getLatencySamples() { return 0; }
}
