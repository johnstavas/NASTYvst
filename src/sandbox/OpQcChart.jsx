// OpQcChart.jsx — minimal SVG line chart for verification metric plots.
// Hand-rolled (no chart lib) to keep bundle small + match app aesthetic.
//
// Plot data shape (see runBrowserMetric.js):
//   { kind, title, xLabel, yLabel, series: [{ name, color, points }],
//     markers: [{ x, label, color }] }

import React, { useMemo } from 'react';

export default function OpQcChart({ plot, height = 200 }) {
  const layout = useMemo(() => {
    if (!plot || !plot.series?.length) return null;
    const W = 700, H = height;
    const padL = 50, padR = 12, padT = 14, padB = 30;
    const all = plot.series.flatMap(s => s.points);
    if (all.length === 0) return null;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const [x, y] of all) {
      if (Number.isFinite(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      if (Number.isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    }
    if (xMin === xMax) xMax = xMin + 1;
    if (yMin === yMax) yMax = yMin + 1;
    const yRange = yMax - yMin;
    yMin -= yRange * 0.05;
    yMax += yRange * 0.05;
    const logX = !!plot.logX && xMin > 0;
    const xToL = logX ? Math.log10 : (x => x);
    const xMinL = xToL(xMin), xMaxL = xToL(xMax);
    const sx = (x) => padL + ((xToL(x) - xMinL) / (xMaxL - xMinL)) * (W - padL - padR);
    const sy = (y) => padT + (1 - (y - yMin) / (yMax - yMin)) * (H - padT - padB);
    return { W, H, padL, padR, padT, padB, xMin, xMax, yMin, yMax, sx, sy, logX };
  }, [plot, height]);

  if (!plot || !layout) return null;
  const { W, H, padL, padT, padB, xMin, xMax, yMin, yMax, sx, sy } = layout;

  // Y-axis ticks (5 evenly spaced).
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const y = yMin + (yMax - yMin) * (i / 4);
    yTicks.push(y);
  }
  const xTicks = [];
  if (layout.logX) {
    // Decade ticks: pick nice round numbers within [xMin, xMax].
    const startDec = Math.floor(Math.log10(xMin));
    const endDec = Math.ceil(Math.log10(xMax));
    for (let d = startDec; d <= endDec; d++) {
      const v = Math.pow(10, d);
      if (v >= xMin && v <= xMax) xTicks.push(v);
    }
    // If too few decades, add half-decade marks (3, 30, 300...).
    if (xTicks.length < 4) {
      for (let d = startDec; d <= endDec; d++) {
        const v = 3 * Math.pow(10, d);
        if (v >= xMin && v <= xMax) xTicks.push(v);
      }
      xTicks.sort((a, b) => a - b);
    }
  } else {
    for (let i = 0; i <= 4; i++) xTicks.push(xMin + (xMax - xMin) * (i / 4));
  }

  const fmt = v => Math.abs(v) >= 1000 ? v.toExponential(1)
                  : Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1)
                  : v.toFixed(Math.abs(v) < 1 ? 2 : 1);

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 8, marginTop: 8 }}>
      {plot.title && (
        <div style={{
          fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.55)', fontWeight: 600, marginBottom: 4,
        }}>{plot.title}</div>
      )}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {yTicks.map((y, i) => (
          <line key={`gy${i}`} x1={padL} x2={W - 12} y1={sy(y)} y2={sy(y)}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {xTicks.map((x, i) => (
          <line key={`gx${i}`} y1={padT} y2={H - padB} x1={sx(x)} x2={sx(x)}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(255,255,255,0.25)" />
        <line x1={padL} y1={H - padB} x2={W - 12} y2={H - padB} stroke="rgba(255,255,255,0.25)" />
        {/* Y ticks */}
        {yTicks.map((y, i) => (
          <text key={`yt${i}`} x={padL - 6} y={sy(y) + 3} textAnchor="end"
                fontSize="9" fill="rgba(255,255,255,0.45)" fontFamily="monospace">{fmt(y)}</text>
        ))}
        {xTicks.map((x, i) => (
          <text key={`xt${i}`} x={sx(x)} y={H - padB + 14} textAnchor="middle"
                fontSize="9" fill="rgba(255,255,255,0.45)" fontFamily="monospace">{fmt(x)}</text>
        ))}
        {/* Markers — stagger labels vertically to avoid overlap when markers
            land close together in x (declared vs measured cutoff, etc). */}
        {plot.markers?.map((m, i) => {
          const x = sx(m.x);
          // Detect close neighbors to decide stagger depth.
          const closeNeighbors = (plot.markers || []).filter((other, j) =>
            j < i && Math.abs(sx(other.x) - x) < 90
          ).length;
          const yOffset = padT + 10 + closeNeighbors * 13;
          // Anchor right of line if the line's near right edge so the label doesn't overflow.
          const anchorRight = x > W - 100;
          return (
            <g key={`m${i}`}>
              <line x1={x} x2={x} y1={padT} y2={H - padB}
                    stroke={m.color} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
              <text x={anchorRight ? x - 4 : x + 4} y={yOffset} fontSize="9"
                    textAnchor={anchorRight ? 'end' : 'start'}
                    fill={m.color} fontFamily="monospace">{m.label}</text>
            </g>
          );
        })}
        {/* Series */}
        {plot.series.map((s, si) => {
          if (s.points.length === 0) return null;
          const d = s.points.map(([x, y], i) =>
            `${i === 0 ? 'M' : 'L'} ${sx(x)} ${sy(y)}`).join(' ');
          return (
            <path key={`s${si}`} d={d} fill="none" stroke={s.color}
                  strokeWidth={s.name === 'expected' ? 1 : 1.5} opacity="0.95" />
          );
        })}
        {/* Axis labels */}
        {plot.xLabel && (
          <text x={(W + padL) / 2} y={H - 4} textAnchor="middle"
                fontSize="9" fill="rgba(255,255,255,0.4)"
                fontFamily="system-ui">{plot.xLabel}</text>
        )}
        {plot.yLabel && (
          <text x={12} y={H / 2} textAnchor="middle"
                transform={`rotate(-90 12 ${H / 2})`}
                fontSize="9" fill="rgba(255,255,255,0.4)"
                fontFamily="system-ui">{plot.yLabel}</text>
        )}
      </svg>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, padding: '4px 0 0 8px', flexWrap: 'wrap' }}>
        {plot.series.map((s, i) => (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
            color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace',
          }}>
            <span style={{ width: 10, height: 2, background: s.color, display: 'inline-block' }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}
