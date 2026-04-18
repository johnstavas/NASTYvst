// analyzer.js — visual-only inspection tap for the QC rack.
//
// Attaches to any AudioNode and reports:
//   - waveform (time-domain)
//   - peak dBFS (with decay hold + clip light)
//   - RMS  dBFS (windowed)
//   - "LUFS ~"  momentary loudness, K-weighted approximation (400ms window)
//   - L/R peak difference (dB)
//   - stereo correlation (+1 mono, 0 decorrelated, -1 inverted)
//
// Strictly visual. Signal fans out to AnalyserNodes; nothing in the audio
// path changes. AnalyserNodes process their input regardless of whether
// their output is connected, so no silent-pull plumbing is required.
//
// K-weighting (BS.1770) is approximated with two biquads chained on a
// silent analysis branch:
//   HPF  ~38 Hz (stage 1)
//   high-shelf +4 dB @ ~1.5 kHz (stage 2)
// Close enough for eyeballing loudness deltas across a plugin; not a
// certified LUFS meter — UI labels it as "LUFS ~".

export function createAnalyzer(ctx, sourceNode) {
  // --- stereo split: L and R analysers for peak diff + correlation ------
  const splitter = ctx.createChannelSplitter(2);
  sourceNode.connect(splitter);

  const anL = ctx.createAnalyser(); anL.fftSize = 2048; anL.smoothingTimeConstant = 0;
  const anR = ctx.createAnalyser(); anR.fftSize = 2048; anR.smoothingTimeConstant = 0;
  splitter.connect(anL, 0);
  splitter.connect(anR, 1);

  // --- mono (mixed) analyser for waveform + peak/RMS --------------------
  const anMono = ctx.createAnalyser();
  anMono.fftSize = 2048; anMono.smoothingTimeConstant = 0;
  sourceNode.connect(anMono);

  // --- K-weighting branch for LUFS approx -------------------------------
  const hp  = ctx.createBiquadFilter(); hp.type  = 'highpass';  hp.frequency.value = 38;  hp.Q.value = 0.5;
  const hs  = ctx.createBiquadFilter(); hs.type  = 'highshelf'; hs.frequency.value = 1500; hs.gain.value = 4;
  const anK = ctx.createAnalyser();     anK.fftSize = 4096; anK.smoothingTimeConstant = 0;
  sourceNode.connect(hp); hp.connect(hs); hs.connect(anK);

  const bufL = new Float32Array(anL.fftSize);
  const bufR = new Float32Array(anR.fftSize);
  const bufM = new Float32Array(anMono.fftSize);
  const bufK = new Float32Array(anK.fftSize);

  function peakOf(buf) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
    return m;
  }
  function rmsOf(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function correlationOf(L, R) {
    let sLR = 0, sLL = 0, sRR = 0;
    for (let i = 0; i < L.length; i++) { sLR += L[i]*R[i]; sLL += L[i]*L[i]; sRR += R[i]*R[i]; }
    const d = Math.sqrt(sLL * sRR);
    return d > 1e-9 ? sLR / d : 1;
  }
  const toDb = v => v > 1e-6 ? 20 * Math.log10(v) : -Infinity;

  // Peak hold with decay so the number doesn't flicker.
  let peakHold = 0, clipUntil = 0;

  function sample() {
    anMono.getFloatTimeDomainData(bufM);
    anL   .getFloatTimeDomainData(bufL);
    anR   .getFloatTimeDomainData(bufR);
    anK   .getFloatTimeDomainData(bufK);

    const pk = peakOf(bufM);
    peakHold = Math.max(pk, peakHold * 0.93);
    if (pk >= 0.999) clipUntil = performance.now() + 300;

    const pkL = peakOf(bufL), pkR = peakOf(bufR);
    const rms = rmsOf(bufM);
    const rmsK = rmsOf(bufK);
    // LUFS momentary approx: -0.691 + 10·log10(meanSquare)
    const lufs = rmsK > 1e-6 ? (-0.691 + 10 * Math.log10(rmsK * rmsK)) : -Infinity;

    return {
      wave: bufM,
      peakDb: toDb(peakHold),
      rmsDb:  toDb(rms),
      lufs,
      clipping: performance.now() < clipUntil,
      lrDiffDb: toDb(pkL) - toDb(pkR),
      correlation: correlationOf(bufL, bufR),
    };
  }

  function dispose() {
    try { sourceNode.disconnect(splitter); } catch {}
    try { sourceNode.disconnect(anMono);   } catch {}
    try { sourceNode.disconnect(hp);       } catch {}
    try { splitter.disconnect();           } catch {}
    try { hp.disconnect(); hs.disconnect();} catch {}
  }

  return { sample, dispose };
}

// ---- canvas drawing helpers ----------------------------------------------

export function drawWave(c, buf, w, h, color) {
  c.fillStyle = '#050a06'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#102018'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, h/2); c.lineTo(w, h/2); c.stroke();
  c.strokeStyle = color; c.lineWidth = 1.3;
  c.beginPath();
  const step = buf.length / w;
  for (let x = 0; x < w; x++) {
    const v = buf[(x * step) | 0] || 0;
    const y = (1 - v) * 0.5 * h;
    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
}

export function fmtDb(v) {
  if (!isFinite(v)) return '-inf';
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}
