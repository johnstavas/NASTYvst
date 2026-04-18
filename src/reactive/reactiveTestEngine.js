// reactiveTestEngine — minimal validation engine for useReactiveCore.
//
// Audibly: a soft tanh drive + makeup gain. Existence is justified only
// because the hook needs a real engine handle to read peak / bass / transient.
//
// Exposes:
//   getOutputPeak()  — host-smoothed analyser peak (linear)
//   getBassLevel()   — low-band peak (drives boom)
//   getTransient()   — peak − rms over a short window
//   setDrive(v)      — 0..1 → tanh drive amount
//   input, output    — AudioNodes for the host wrapper contract
//   dispose()
//
// Uses native nodes only — no AudioWorklet — to keep the validation rig
// installation-free.

export function createReactiveTestEngine(ctx) {
  const input  = ctx.createGain();
  const drive  = ctx.createWaveShaper();
  const makeup = ctx.createGain();
  const output = ctx.createGain();

  // tanh shaper, refreshed when drive changes
  function buildCurve(amount) {
    const k = 1 + amount * 24; // 1..25
    const N = 2048, c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    drive.curve = c;
    drive.oversample = '4x';
    makeup.gain.value = 1 / (1 + amount * 0.6);
  }
  buildCurve(0);

  input.connect(drive); drive.connect(makeup); makeup.connect(output);

  // ── analysers ─────────────────────────────────────────────────────────────
  const outAna = ctx.createAnalyser();
  outAna.fftSize = 1024;
  outAna.smoothingTimeConstant = 0;
  output.connect(outAna);

  // bass band: low-pass at ~120 Hz feeding its own analyser
  const bassLP  = ctx.createBiquadFilter();
  bassLP.type   = 'lowpass';
  bassLP.frequency.value = 120;
  bassLP.Q.value         = 0.7;
  const bassAna = ctx.createAnalyser();
  bassAna.fftSize = 1024;
  bassAna.smoothingTimeConstant = 0;
  output.connect(bassLP); bassLP.connect(bassAna);

  // host-side smoothing buffers
  const buf     = new Float32Array(outAna.fftSize);
  const bassBuf = new Float32Array(bassAna.fftSize);
  let peakSm    = 0;
  let bassSm    = 0;
  let rmsSm     = 0;
  const DECAY   = 0.94;

  function readPeak(ana, b) {
    ana.getFloatTimeDomainData(b);
    let m = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i] < 0 ? -b[i] : b[i];
      if (v > m) m = v;
    }
    return m;
  }
  function readRms(b) {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    return Math.sqrt(s / b.length);
  }

  return {
    input, output,
    chainOutput: output,
    setBypass() {},
    setDrive(v) { buildCurve(Math.max(0, Math.min(1, v))); },

    getOutputPeak() {
      const p = readPeak(outAna, buf);
      peakSm = Math.max(p, peakSm * DECAY);
      return peakSm;
    },
    getBassLevel() {
      const p = readPeak(bassAna, bassBuf);
      bassSm = Math.max(p, bassSm * DECAY);
      return bassSm;
    },
    getTransient() {
      // peak − smoothed RMS, both from the output buffer already filled by
      // the most recent getOutputPeak() call. Cheap and good enough for a
      // validation rig.
      const r = readRms(buf);
      rmsSm += (r - rmsSm) * 0.1;
      return Math.max(0, peakSm - rmsSm);
    },

    dispose() {
      try { input.disconnect();  } catch {}
      try { drive.disconnect();  } catch {}
      try { makeup.disconnect(); } catch {}
      try { output.disconnect(); } catch {}
      try { bassLP.disconnect(); } catch {}
    },
  };
}
