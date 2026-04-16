// ClipMeter.jsx — drop-in clip-visibility meter for every module.
//
// Design goal: make it obvious at a glance whether the signal is clipping.
// The big numeric dB readout is the primary info; the bar is secondary context.
//
// Usage (inputs are LINEAR amplitudes, matching every engine's getRMS/getPeak):
//
//   <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />
//
// For Space-style modules that store dB in state, just convert at the call site:
//
//   <ClipMeter
//     inRms={dbToLinear(inputLevel)}  inPeak={dbToLinear(inputPeak)}
//     outRms={dbToLinear(outputLevel)} outPeak={dbToLinear(outputPeak)}
//   />
//
// Color-code contract (peak value is what we color on — it's the clip-critical one):
//   • ≥  0  dBFS → red       (clipping)
//   • -6 → 0 dB  → amber     (hot)
//   • < -6 dB    → pale mint (safe)
//
// When either channel goes red, the whole strip tints red as a peripheral-vision
// warning — you should see it even if you're not reading the numbers.

import React from 'react';

const amp2db = a => (a > 1e-6 ? 20 * Math.log10(a) : -Infinity);

const fmtDb = v => {
  if (!isFinite(v)) return '−∞';
  if (v >= 0)       return `+${v.toFixed(1)}`;
  return v.toFixed(1);
};

const SAFE  = 'rgb(134, 239, 172)';   // pale mint
const WARN  = 'rgb(252, 211, 77)';    // amber
const CLIP  = 'rgb(239, 68, 68)';     // red

const dbColor = v => {
  if (!isFinite(v)) return 'rgba(255,255,255,0.25)';
  if (v >= 0)       return CLIP;
  if (v > -6)       return WARN;
  return SAFE;
};

// -60 dB → +3 dB linear mapping for the bar fill. We extend past 0 so the red
// "clip" zone actually has pixels to render into when the signal pushes over,
// giving you a visible red sliver at the right edge instead of just pinning at 100%.
const DBMIN = -60;
const DBMAX = 3;
const dbToFrac = v => {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(1, (v - DBMIN) / (DBMAX - DBMIN)));
};

function Strip({ label, rmsAmp, peakAmp }) {
  const rmsDb   = amp2db(rmsAmp  ?? 0);
  const peakDb  = amp2db(peakAmp ?? 0);
  const rmsFrac = dbToFrac(rmsDb);
  const peakF   = dbToFrac(peakDb);
  const clipping = peakDb >= 0;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Label + BIG dB peak number (the glance-read) */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{
          fontSize: 7,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.4)',
          flexShrink: 0,
        }}>{label}</span>
        <span style={{
          flex: 1,
          textAlign: 'right',
          fontSize: 14,
          fontFamily: '"Courier New", monospace',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          color: dbColor(peakDb),
          lineHeight: 1,
        }}>{fmtDb(peakDb)}</span>
        <span style={{
          fontSize: 7,
          color: 'rgba(255,255,255,0.35)',
          flexShrink: 0,
        }}>dB</span>
      </div>

      {/* Horizontal bar. Fill is zone-coloured — you only see amber when you're
          actually pushing past -6 dB and red only when you're actually ≥ 0 dB. */}
      <div style={{
        height: 5,
        background: 'rgba(0,0,0,0.55)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 2,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Faint threshold ticks so you can see where -6 and 0 sit even at rest */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${dbToFrac(-6) * 100}%`, width: 1,
          background: 'rgba(252,211,77,0.22)',
        }} />
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `calc(${dbToFrac(0) * 100}% - 1px)`, width: 1,
          background: 'rgba(239,68,68,0.35)',
        }} />

        {/* Zone-coloured fill: hard colour stops at the -6 dB and 0 dB frac
            positions. The gradient is painted in the coordinate space of the
            FULL bar (via backgroundSize scaling), then the div's width clips
            it. Result: only mint shows at quiet levels; amber only appears once
            rms crosses -6 dB; red only appears when you're genuinely over. */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${rmsFrac * 100}%`,
          backgroundImage: `linear-gradient(90deg,
            ${SAFE} 0%,
            ${SAFE} ${dbToFrac(-6) * 100}%,
            ${WARN} ${dbToFrac(-6) * 100}%,
            ${WARN} ${dbToFrac(0)  * 100}%,
            ${CLIP} ${dbToFrac(0)  * 100}%,
            ${CLIP} 100%)`,
          backgroundSize: `${(1 / Math.max(rmsFrac, 0.001)) * 100}% 100%`,
          backgroundRepeat: 'no-repeat',
          transition: 'width 0.05s linear',
        }} />

        {/* Peak-hold marker — colour matches the zone it's landed in */}
        {peakF > 0.01 && (
          <div style={{
            position: 'absolute', top: -1, bottom: -1,
            left: `calc(${peakF * 100}% - 1px)`,
            width: 2,
            background: dbColor(peakDb),
            boxShadow: clipping ? '0 0 4px rgba(239,68,68,0.9)' : 'none',
          }} />
        )}
      </div>
    </div>
  );
}

export default function ClipMeter({ inRms, inPeak, outRms, outPeak, style }) {
  const maxPeakDb = Math.max(amp2db(inPeak ?? 0), amp2db(outPeak ?? 0));
  const anyClip   = maxPeakDb >= 0;

  return (
    <div style={{
      padding: '7px 10px',
      background: anyClip ? 'rgba(239,68,68,0.09)' : 'rgba(0,0,0,0.28)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      gap: 14,
      transition: 'background 0.08s',
      ...style,
    }}>
      <Strip label="IN"  rmsAmp={inRms}  peakAmp={inPeak} />
      <Strip label="OUT" rmsAmp={outRms} peakAmp={outPeak} />
    </div>
  );
}
