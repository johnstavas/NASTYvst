// pitchShifterProcessor.js — AudioWorklet granular pitch shifter
// Two overlapping Hann-windowed grains.  Both heads start at the SAME
// readOffset so that at pitchRatio=1 both read the same sample → perfect
// unity pass-through (no comb filter).  Processes stereo (2 channels).

class ChannelState {
  constructor(BUFSIZE, GRAIN) {
    this.BUFSIZE = BUFSIZE;
    this.BUFMASK = BUFSIZE - 1;
    this.buf      = new Float32Array(BUFSIZE);
    this.writePos = 0;
    this.GRAIN    = GRAIN;
    // Both heads at the same initial readOffset, half-grain phase offset.
    // At ratio=1 → both read same position → w0+w1=1 → transparent delay.
    this.heads = [
      { readOffset: -GRAIN,       phase: 0.0 },
      { readOffset: -GRAIN,       phase: 0.5 },
    ];
  }

  process(inp, out, ratio) {
    const GRAIN   = this.GRAIN;
    const MASK    = this.BUFMASK;
    const INV_G   = 1.0 / GRAIN;
    const MIN_LAG = GRAIN * 0.5;
    const MAX_LAG = this.BUFSIZE * 0.45;

    for (let i = 0; i < inp.length; i++) {
      this.buf[this.writePos & MASK] = inp[i];
      this.writePos++;

      let s = 0;
      for (const h of this.heads) {
        // Hann window — 0 at phase 0/1, peak 1 at phase 0.5
        const w  = 0.5 - 0.5 * Math.cos(2 * Math.PI * h.phase);

        // Linear-interpolated read from ring buffer
        const rp = this.writePos + h.readOffset;
        const ri = Math.floor(rp);
        const rf = rp - ri;
        const s0 = this.buf[ ri      & MASK];
        const s1 = this.buf[(ri + 1) & MASK];
        s += (s0 + (s1 - s0) * rf) * w;

        // Read position advances at pitchRatio (not 1) — this is the pitch shift
        h.readOffset += ratio;

        // Advance grain phase
        const prev  = h.phase;
        h.phase     = (h.phase + INV_G) % 1.0;

        // At grain boundary (phase just wrapped to ~0), window ≈ 0 → safe to jump.
        // The OTHER head is at phase ~0.5 (window = 1) and carries full signal.
        if (h.phase < prev) {
          const lag = -h.readOffset;
          if (lag < MIN_LAG) h.readOffset -= GRAIN; // too close to write → jump back
          if (lag > MAX_LAG) h.readOffset += GRAIN; // too far behind    → jump forward
        }
      }

      out[i] = s;
    }
  }
}

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'pitchRatio',
      defaultValue: 1.0,
      minValue: 0.25,
      maxValue: 4.0,
      automationRate: 'k-rate',
    }];
  }

  constructor() {
    super();
    const BUFSIZE = 8192;  // ~185ms at 44.1 kHz
    const GRAIN   = 2048;  // ~46ms grain — bigger grain = fewer artifacts on pitched voices
    this.ch = [new ChannelState(BUFSIZE, GRAIN), new ChannelState(BUFSIZE, GRAIN)];
  }

  process(inputs, outputs, parameters) {
    const ratio  = parameters.pitchRatio[0];
    const inChans = inputs[0]?.length ?? 0;
    const nCh    = Math.max(inChans, 1);

    for (let c = 0; c < Math.min(nCh, 2); c++) {
      const inp = inputs[0]?.[c] ?? inputs[0]?.[0]; // mono fallback
      const out = outputs[0]?.[c];
      if (!inp || !out) continue;
      this.ch[c].process(inp, out, ratio);
    }
    return true;
  }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
