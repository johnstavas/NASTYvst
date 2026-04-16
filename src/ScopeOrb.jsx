import React, { useState, useRef, useEffect } from 'react';
import { createScopeEngine } from './scopeEngine';

// ─── Layout constants ─────────────────────────────────────────────────────
// 380 wide to match Space module; spectrum fills the width minus a 64 px
// L/R meter strip on the right.
const W          = 380;
const SPEC_W     = 316;                 // spectrum canvas width
const SPEC_H     = 200;                 // spectrum canvas height
const METER_W    = 64;                  // stereo meter strip width
const METER_H    = SPEC_H;
const SCOPE_H    = 74;
const GONIO_SIZE = 140;

// ─── Axis helpers ─────────────────────────────────────────────────────────
const F_MIN = 20, F_MAX = 20000;
const freqToX = (f, w) => (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * w;
const xToFreq = (x, w) => F_MIN * Math.pow(F_MAX / F_MIN, x / w);

// Spectrum dB axis: -72 → 0
const SPEC_DB_MIN = -72, SPEC_DB_MAX = 0;
const dbToYSpec = (db, h) => {
  const t = (db - SPEC_DB_MIN) / (SPEC_DB_MAX - SPEC_DB_MIN);
  return h * (1 - Math.max(0, Math.min(1, t)));
};

// Meter dB axis: -60 → +6
const METER_DB_MIN = -60, METER_DB_MAX = 6;
const dbToYMeter = (db, h) => {
  const t = (db - METER_DB_MIN) / (METER_DB_MAX - METER_DB_MIN);
  return h * (1 - Math.max(0, Math.min(1, t)));
};

const amp2db = a => a > 1e-6 ? 20 * Math.log10(a) : -Infinity;

// ─── Scope color system (Space module idiom) ─────────────────────────────
// Fixed analyzer hue (150° = pale mint) with lifted lightness so the analyzer
// reads as a frosted/white-green — distinct from Space's saturated tone hue
// while still speaking the same accentColor(sat, light, alpha) language.
const HUE = 150;
const accentColor = (sat, light, alpha) => `hsla(${HUE}, ${sat}%, ${light}%, ${alpha})`;
const CLIP_RED    = 'rgb(239, 68, 68)';
const WARN_AMBER  = 'rgb(252, 211, 77)';
const SAFE_MINT   = accentColor(55, 85, 1);          // pale mint-white (safe readouts)
const TRACE_MINT  = `hsla(${HUE}, 45%, 92%, 1)`;     // near-white live spectrum stroke
const SCOPE_CYAN  = `hsla(180, 40%, 90%, 1)`;        // ice-cyan oscilloscope

// ─── Draw: Spectrum ───────────────────────────────────────────────────────
function drawSpectrum(ctx, w, h, live, hold, sampleRate, fftSize) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = '#050a06';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = accentColor(55, 55, 0.06);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000].forEach(f => {
    const x = Math.round(freqToX(f, w)) + 0.5;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  });
  [-12, -24, -36, -48, -60].forEach(db => {
    const y = Math.round(dbToYSpec(db, h)) + 0.5;
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  });
  ctx.stroke();

  // Axis labels
  ctx.fillStyle    = accentColor(50, 60, 0.38);
  ctx.font         = '8px "Courier New", monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';
  [['100', 100], ['1k', 1000], ['10k', 10000]].forEach(([label, f]) => {
    const x = freqToX(f, w);
    ctx.fillText(label, x + 2, h - 10);
  });
  [-12, -24, -36, -48, -60].forEach(db => {
    const y = dbToYSpec(db, h);
    ctx.fillText(`${db}`, 2, y + 1);
  });

  // Peak-hold trace
  ctx.strokeStyle = 'rgba(252, 211, 77, 0.5)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  drawSpectrumPath(ctx, w, h, hold, sampleRate, fftSize);
  ctx.stroke();

  // Fill under live spectrum
  ctx.fillStyle = accentColor(50, 80, 0.16);
  ctx.beginPath();
  drawSpectrumPath(ctx, w, h, live, sampleRate, fftSize);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Live outline — near-white mint so the trace pops off the background
  ctx.strokeStyle = TRACE_MINT;
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  drawSpectrumPath(ctx, w, h, live, sampleRate, fftSize);
  ctx.stroke();
}

function drawSpectrumPath(ctx, w, h, data, sampleRate, fftSize) {
  const binCount = data.length;
  let started = false;
  for (let px = 0; px < w; px++) {
    const fLo   = xToFreq(px, w);
    const fHi   = xToFreq(px + 1, w);
    const binLo = Math.max(0, Math.floor(fLo * fftSize / sampleRate));
    const binHi = Math.min(binCount, Math.max(binLo + 1, Math.ceil(fHi * fftSize / sampleRate)));
    let maxDb = -Infinity;
    for (let b = binLo; b < binHi; b++) {
      if (data[b] > maxDb) maxDb = data[b];
    }
    const y = dbToYSpec(maxDb === -Infinity ? SPEC_DB_MIN : maxDb, h);
    if (!started) { ctx.moveTo(px, y); started = true; }
    else          { ctx.lineTo(px, y); }
  }
}

// ─── Draw: Stereo L/R meter bars ──────────────────────────────────────────
function drawMeters(ctx, w, h, levels) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = '#050a06';
  ctx.fillRect(0, 0, w, h);

  const padX  = 6;
  const barW  = (w - padX * 3) / 2;
  const barX1 = padX;
  const barX2 = padX + barW + padX;
  const topY  = 12, botY = h - 10;
  const barH  = botY - topY;

  // Wells
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(barX1, topY, barW, barH);
  ctx.fillRect(barX2, topY, barW, barH);

  // Ticks
  ctx.strokeStyle = accentColor(50, 55, 0.12);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  [-60, -48, -36, -24, -18, -12, -6, -3, 0].forEach(db => {
    const y = Math.round(topY + dbToYMeter(db, barH)) + 0.5;
    ctx.moveTo(barX1 - 2, y); ctx.lineTo(barX1 + barW + 2, y);
    ctx.moveTo(barX2 - 2, y); ctx.lineTo(barX2 + barW + 2, y);
  });
  ctx.stroke();

  // Tick labels
  ctx.fillStyle    = accentColor(45, 55, 0.42);
  ctx.font         = '7px "Courier New", monospace';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  [0, -6, -12, -24, -48].forEach(db => {
    const y = topY + dbToYMeter(db, barH);
    ctx.fillText(`${db}`, barX2 + barW + 4, y);
  });

  const drawBar = (x, rms, peak) => {
    const rmsDb  = amp2db(rms);
    const peakDb = amp2db(peak);
    const rmsY   = Math.round(topY + dbToYMeter(rmsDb,  barH));
    const peakY  = Math.round(topY + dbToYMeter(peakDb, barH));

    // Pale-mint → amber → red gradient (matches the lightened scope palette)
    const grad = ctx.createLinearGradient(0, topY, 0, botY);
    grad.addColorStop(0.00, '#ef4444');              // 0 dB — clip
    grad.addColorStop(0.10, '#fcd34d');              // -6
    grad.addColorStop(0.28, accentColor(55, 80, 0.95));  // -18 pale mint
    grad.addColorStop(1.00, accentColor(45, 35, 0.95));  // floor (muted)
    ctx.fillStyle = grad;
    ctx.fillRect(x, rmsY, barW, botY - rmsY);

    // Peak-hold line
    ctx.fillStyle = peak >= 0.98 ? CLIP_RED : '#ffffff';
    ctx.fillRect(x, peakY - 1, barW, 2);
  };

  drawBar(barX1, levels.lRms, levels.lPeakHold);
  drawBar(barX2, levels.rRms, levels.rPeakHold);

  // L/R header
  ctx.fillStyle    = accentColor(45, 60, 0.55);
  ctx.font         = 'bold 8px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('L', barX1 + barW / 2, 1);
  ctx.fillText('R', barX2 + barW / 2, 1);
}

// ─── Draw: Oscilloscope (zero-cross triggered) ────────────────────────────
function drawScopeCanvas(ctx, w, h, buf) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = '#050a06';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(127, 220, 255, 0.08)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
  [0.25, 0.5, 0.75].forEach(k => {
    const x = Math.round(w * k) + 0.5;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  });
  ctx.stroke();

  // Zero-cross trigger
  const N = buf.length;
  let trigger = 0;
  for (let i = 1; i < (N >> 1); i++) {
    if (buf[i - 1] < 0 && buf[i] >= 0) { trigger = i; break; }
  }
  const samplesToDraw = Math.min(w, N - trigger);

  ctx.strokeStyle = SCOPE_CYAN;
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  for (let i = 0; i < samplesToDraw; i++) {
    const sample = buf[trigger + i];
    const x = (i / (samplesToDraw - 1 || 1)) * w;
    const y = h / 2 - sample * (h / 2) * 0.95;
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ─── Draw: Goniometer (stereo Lissajous with persistence trail) ───────────
function drawGonio(ctx, w, h, lBuf, rBuf) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);

  // Persistence fade
  ctx.fillStyle = 'rgba(5, 10, 6, 0.28)';
  ctx.fillRect(0, 0, w, h);

  const cx    = w / 2;
  const cy    = h / 2;
  const scale = Math.min(w, h) * 0.42;

  // Reference circle
  ctx.strokeStyle = accentColor(55, 55, 0.18);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, scale, 0, Math.PI * 2);
  ctx.stroke();

  // Axis lines
  ctx.beginPath();
  ctx.moveTo(cx, cy - scale); ctx.lineTo(cx, cy + scale);
  ctx.moveTo(cx - scale, cy); ctx.lineTo(cx + scale, cy);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle    = accentColor(50, 60, 0.45);
  ctx.font         = 'bold 8px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('M', cx, 2);
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  ctx.fillText('+S', cx + scale + 3, cy);
  ctx.textAlign    = 'right';
  ctx.fillText('-S', cx - scale - 3, cy);

  // Samples
  ctx.fillStyle = accentColor(75, 70, 0.95);
  const N = Math.min(lBuf.length, rBuf.length);
  for (let i = 0; i < N; i += 2) {
    const l = lBuf[i];
    const r = rBuf[i];
    const px = cx + (l - r) * 0.7071 * scale;
    const py = cy - (l + r) * 0.7071 * scale;
    ctx.fillRect(px, py, 1.5, 1.5);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmtDb = v => !isFinite(v) ? '−∞' : v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
const fmtCorr = c => (c >= 0 ? '+' : '') + c.toFixed(2);

// Color-code a dB reading by proximity to 0 dBFS.
// safe: < -6, warn: -6 to 0, clip: ≥ 0
function dbColor(db) {
  if (!isFinite(db)) return 'rgba(255,255,255,0.25)';
  if (db >= 0)  return CLIP_RED;
  if (db > -6)  return WARN_AMBER;
  return SAFE_MINT;
}

// ─── SliderRow (matches OrbPluginDemo.jsx) ────────────────────────────────
const SliderRow = ({ label, value, set, min = 0, max = 1, step = 0.01, fmt, labelWidth = 48 }) => (
  <div className="flex items-center gap-2">
    <span className="shrink-0" style={{ fontSize: 7.5, color: accentColor(45, 55, 0.55), width: labelWidth }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => set(parseFloat(e.target.value))}
      style={{ accentColor: accentColor(70, 60, 1), height: '3px', flex: 1 }} />
    <span className="text-right" style={{ fontSize: 7, color: accentColor(50, 60, 0.65), width: 28 }}>
      {fmt ? fmt(value) : `${Math.round(value * 100)}%`}
    </span>
  </div>
);

// ─── Component ────────────────────────────────────────────────────────────
export default function ScopeOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const [inputGain,  setInputGain ] = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [pan,        setPan       ] = useState(initialState?.pan        ?? 0);
  const [bypassed,   setBypassed  ] = useState(initialState?.bypassed   ?? false);
  const [showPanel,  setShowPanel ] = useState(false);

  // Numeric readouts — updated at ~15 Hz
  const [readout, setReadout] = useState({
    lPeakDb: -Infinity, rPeakDb: -Infinity,
    lRmsDb:  -Infinity, rRmsDb:  -Infinity,
    lCrest:  0,         rCrest:  0,
    corr:    1,
  });

  const engineRef      = useRef(null);
  const rafRef         = useRef(null);
  const specCanvasRef  = useRef(null);
  const meterCanvasRef = useRef(null);
  const scopeCanvasRef = useRef(null);
  const gonioCanvasRef = useRef(null);

  const inputGainRef  = useRef(inputGain);  inputGainRef.current  = inputGain;
  const outputGainRef = useRef(outputGain); outputGainRef.current = outputGain;
  const panRef        = useRef(pan);        panRef.current        = pan;
  const bypassedRef   = useRef(bypassed);   bypassedRef.current   = bypassed;

  useEffect(() => {
    if (!sharedSource) return;
    const engine = createScopeEngine(sharedSource.ctx);
    engineRef.current = engine;

    engine.setInputGain (inputGainRef.current);
    engine.setOutputGain(outputGainRef.current);
    engine.setPan       (panRef.current);
    engine.setBypass    (bypassedRef.current);

    registerEngine(instanceId, engine);

    const specCtx  = specCanvasRef.current.getContext('2d');
    const meterCtx = meterCanvasRef.current.getContext('2d');
    const scopeCtx = scopeCanvasRef.current.getContext('2d');
    const gonioCtx = gonioCanvasRef.current.getContext('2d');

    const sr  = engine.sampleRate;
    const fft = engine.spectrumFftSize;

    let tickN = 0;
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const eng = engineRef.current;
      if (!eng) return;

      // getScope must run before getLevels (both read _lBuf/_rBuf)
      const { live, hold } = eng.getSpectrum();
      const { l, r }       = eng.getScope();
      const levels         = eng.getLevels();

      drawSpectrum   (specCtx,  SPEC_W,     SPEC_H,     live, hold, sr, fft);
      drawMeters     (meterCtx, METER_W,    METER_H,    levels);
      drawScopeCanvas(scopeCtx, W,          SCOPE_H,    l);
      drawGonio      (gonioCtx, GONIO_SIZE, GONIO_SIZE, l, r);

      if (++tickN % 4 === 0) {
        setReadout({
          lPeakDb: amp2db(levels.lPeakHold),
          rPeakDb: amp2db(levels.rPeakHold),
          lRmsDb:  amp2db(levels.lRms),
          rRmsDb:  amp2db(levels.rRms),
          lCrest:  levels.lCrest,
          rCrest:  levels.rCrest,
          corr:    levels.correlation,
        });
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]);

  useEffect(() => { engineRef.current?.setInputGain(inputGain); },   [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGain); }, [outputGain]);
  useEffect(() => { engineRef.current?.setPan(pan); },               [pan]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); },       [bypassed]);

  useEffect(() => {
    onStateChange?.(instanceId, { inputGain, outputGain, pan, bypassed });
  }, [inputGain, outputGain, pan, bypassed]);

  // Big clip indicator — flashes when either channel hits or exceeds 0 dBFS
  const anyClip = readout.lPeakDb >= 0 || readout.rPeakDb >= 0;

  return (
    <div
      className="text-white rounded-2xl relative flex flex-col"
      style={{
        width: W, minHeight: 500, overflow: 'visible',
        display: 'flex', flexDirection: 'column',
        background: `radial-gradient(ellipse at 30% 20%, ${accentColor(30, 9, 1)}, transparent 55%), radial-gradient(ellipse at 70% 80%, ${accentColor(22, 6, 1)}, transparent 55%), #0a0f0c`,
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Header */}
      <div
        className="grid items-center px-3 py-2"
        style={{ flexShrink: 0, gridTemplateColumns: '1fr auto 1fr', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: accentColor(50, 60, 0.5) }}>Scope</span>
        <div
          className="text-[8px] uppercase tracking-[0.25em] px-1.5 py-0.5 rounded"
          style={
            anyClip
              ? { background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.4)', color: CLIP_RED }
              : { background: accentColor(30, 12, 0.4), border: `1px solid ${accentColor(45, 35, 0.25)}`, color: accentColor(50, 60, 0.5) }
          }
        >
          {anyClip ? '⚠ Clipping' : 'Analyzer'}
        </div>
        <div className="flex items-center gap-2 justify-end">
          {onRemove && (
            <button onClick={onRemove} className="w-5 h-5 rounded-full text-white/20 hover:text-white/60 hover:bg-white/10 transition-all text-xs flex items-center justify-center">&times;</button>
          )}
        </div>
      </div>

      {/* PEAK dB band — large, color-coded. THE clipping-visibility row. */}
      <div
        className="grid items-center px-3 py-2"
        style={{
          flexShrink: 0,
          gridTemplateColumns: '1fr 1fr',
          columnGap: 10,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: anyClip ? 'rgba(239,68,68,0.08)' : 'transparent',
          transition: 'background 0.08s',
        }}
      >
        {[
          { ch: 'L', peak: readout.lPeakDb, rms: readout.lRmsDb, crest: readout.lCrest },
          { ch: 'R', peak: readout.rPeakDb, rms: readout.rRmsDb, crest: readout.rCrest },
        ].map(({ ch, peak, rms, crest }) => (
          <div key={ch} className="flex items-baseline gap-1.5">
            <span className="text-[7.5px] uppercase tracking-[0.2em]" style={{ color: accentColor(45, 55, 0.5) }}>{ch}</span>
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: dbColor(peak),
                letterSpacing: '-0.02em',
                minWidth: 62,
              }}
            >
              {fmtDb(peak)}
            </span>
            <span className="text-[8px]" style={{ color: accentColor(45, 55, 0.45) }}>dB</span>
            <div className="ml-auto flex flex-col items-end" style={{ fontFamily: '"Courier New", monospace' }}>
              <span className="text-[8px]" style={{ color: accentColor(45, 55, 0.55) }}>
                RMS {fmtDb(rms)}
              </span>
              <span className="text-[8px]" style={{ color: accentColor(45, 55, 0.4) }}>
                CF {crest > 0 ? crest.toFixed(1) : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Spectrum + stereo meter strip */}
      <div className="flex" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <canvas
          ref={specCanvasRef}
          width={SPEC_W * 2} height={SPEC_H * 2}
          style={{ width: SPEC_W, height: SPEC_H, display: 'block' }}
        />
        <canvas
          ref={meterCanvasRef}
          width={METER_W * 2} height={METER_H * 2}
          style={{ width: METER_W, height: METER_H, display: 'block', borderLeft: '1px solid rgba(255,255,255,0.06)' }}
        />
      </div>

      {/* Oscilloscope */}
      <canvas
        ref={scopeCanvasRef}
        width={W * 2} height={SCOPE_H * 2}
        style={{ flexShrink: 0, width: W, height: SCOPE_H, display: 'block', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      />

      {/* Goniometer + correlation readout */}
      <div className="flex" style={{ flexShrink: 0 }}>
        <canvas
          ref={gonioCanvasRef}
          width={GONIO_SIZE * 2} height={GONIO_SIZE * 2}
          style={{ width: GONIO_SIZE, height: GONIO_SIZE, display: 'block', borderRight: '1px solid rgba(255,255,255,0.06)' }}
        />
        <div className="flex-1 flex flex-col justify-center gap-2 px-3 py-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[7.5px] uppercase tracking-[0.2em]" style={{ color: accentColor(45, 55, 0.5) }}>Correlation</span>
              <span
                className="font-mono tabular-nums text-[8px]"
                style={{ color: readout.corr >= 0 ? SAFE_MINT : CLIP_RED }}
              >
                {fmtCorr(readout.corr)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'rgba(0,0,0,0.5)',
                border: `1px solid ${accentColor(40, 30, 0.25)}`,
                borderRadius: 3,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.25)' }} />
              {(() => {
                const c       = Math.max(-1, Math.min(1, readout.corr));
                const leftPct = c >= 0 ? 50 : 50 + c * 50;
                const widPct  = Math.abs(c) * 50;
                const color   =
                  c >=  0.5 ? SAFE_MINT :
                  c >=  0   ? accentColor(60, 60, 0.9) :
                  c >= -0.3 ? WARN_AMBER :
                              CLIP_RED;
                return (
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: `${leftPct}%`, width: `${widPct}%`,
                    background: color,
                  }} />
                );
              })()}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[7px]" style={{ color: accentColor(40, 50, 0.45) }}>−1</span>
              <span className="text-[7px]" style={{ color: accentColor(40, 50, 0.45) }}>MONO</span>
              <span className="text-[7px]" style={{ color: accentColor(40, 50, 0.45) }}>+1</span>
            </div>
          </div>

        </div>
      </div>

      {/* Settings — always visible */}
      <div className="px-3 pb-3" style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
        <span className="text-[8px] uppercase tracking-[0.3em]" style={{ color: accentColor(40, 45, 0.35), display: 'block', marginBottom: 8 }}>Settings</span>
        <div className="flex flex-col gap-1.5">
          <SliderRow label="Input"  value={inputGain}  set={setInputGain}  min={0} max={2} fmt={v => `${Math.round(v*100)}%`} />
          <SliderRow label="Output" value={outputGain} set={setOutputGain} min={0} max={2} fmt={v => `${Math.round(v*100)}%`} />
          <div className="flex items-center gap-2">
            <span className="text-[7.5px] shrink-0" style={{ color: accentColor(45, 55, 0.55), width: 48 }}>Pan</span>
            <input type="range" min="-100" max="100" step="1"
              value={Math.round(pan * 100)}
              onChange={e => setPan(parseInt(e.target.value) / 100)}
              onDoubleClick={() => setPan(0)}
              style={{ accentColor: accentColor(70, 60, 1), height: '3px', flex: 1 }} />
            <span className="text-[7.5px] text-right" style={{ color: accentColor(50, 60, 0.65), width: 28 }}>
              {Math.abs(pan) < 0.01 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan)*100)}` : `R${Math.round(pan*100)}`}
            </span>
          </div>
        </div>
        <button
          onClick={() => setBypassed(b => !b)}
          className="w-full mt-2 rounded-lg py-1 text-[7.5px] font-medium transition-colors"
          style={bypassed
            ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
            : { background: accentColor(30, 10, 0.3), border: `1px solid ${accentColor(40, 30, 0.2)}`, color: accentColor(50, 60, 0.6) }}
        >
          {bypassed ? 'Bypassed' : 'Bypass'}
        </button>
      </div>
    </div>
  );
}
