// ManChildOrb.jsx — MANchild · Fairchild 670 (UnFairchild 670M II reference)
// ════════════════════════════════════════════════════════════════════════════════
// Two-rack hardware portrait, matched to the user-provided reference photo.
//
//   TOP RACK
//     Left edge: ON toggle, VU Meter A (amber glow), red lamp, VU Meter B
//     Then a 2-row mirrored grid (CH A on top, CH B on bottom). Each row has:
//       BYP/VU/GR/BAL chicken-head + 3 LEDs · INPUT GAIN · THRESHOLD
//     Right column (between the two rows): TC A · MODE rotary · TC B
//
//   BOTTOM RACK
//     SC INSERT (CH A IN/OUT, CH B IN/OUT) · CH A VAR (Atk + Rel)
//     · CH B VAR (Atk + Rel) · DC THRESHOLD A · DC THRESHOLD B
//
// Width: 1280 px  ·  Height: 500 px  (matches Panther/Lofi envelope on height;
// width grown horizontally to fit the Fairchild's twin-channel control set)
// ════════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';

// Engine + presets are loaded dynamically per `variantId` so the UI is
// always paired with the exact engine the registry/migration store says
// should run. See registry.js (engineFactory lazy imports) + store.js
// (defaultVariantFor). Hardcoding `./manChildEngine.js` here caused the
// QC report to label runs as "engine_v1" while the legacy engine was
// actually playing audio — silent variant drift. The QC harness also
// enforces this via the `variant_drift` rule (qcAnalyzer.js) by diffing
// engine.getPreset(name) against engine.getState() post-apply.
async function loadVariantModule(variantId) {
  if (variantId === 'engine_v1') {
    const m = await import('./manChildEngine.v1.js');
    return { createEngine: m.createManChildEngineV1, PRESETS: m.MANCHILD_PRESETS };
  }
  const m = await import('./manChildEngine.js');
  return { createEngine: m.createManChildEngine, PRESETS: m.MANCHILD_PRESETS };
}

// ── Palette (sampled from the reference photo) ───────────────────────────────
const COL = {
  rail:        '#A9A9AC',
  railHi:      '#D0D0D3',
  railLo:      '#7C7C7F',
  railShadow:  '#5A5A5C',
  panel:       '#0E0E0F',
  panelLift:   '#171717',
  panelEdge:   '#040404',
  text:        '#E6E6E6',
  textRed:     '#E13030',
  textDim:     '#5A5A5A',
  textMid:     '#888',
  knobOuter:   '#000',
  knobBody:    '#101010',
  knobShine:   '#333',
  knobIndicator: '#FFFFFF',
  skirtText:   '#D8D8D8',
  vuFace:      '#F5E8B5',
  vuFaceHot:   '#FFC060',
  vuGlow:      '#FF8420',
  vuNeedle:    '#1A1A1A',
  vuRed:       '#CC2020',
  vuArc:       '#9A6A20',
  vuBezel:     '#080808',
  vuBezelEdge: '#1E1E1E',
  ledRedOn:    '#FF3838',
  ledRedOff:   '#3A0A0A',
  ledWhiteOn:  '#FFFFE0',
  ledWhiteOff: '#252520',
  screw:       '#5C5C5E',
  screwHi:     '#9C9C9E',
  active:      '#FFA040',
  toggleStem:  '#C8C8CC',
  toggleBody:  '#1A1A1A',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isVarTc  = (id) => ['VAR1','VAR2','VAR3','VAR4'].includes(id);
const isMsMode = (m)  => m === 'M-S' || m === 'M-S LINK';

const TC_POSITIONS   = ['TC1','TC2','TC3','TC4','TC5','TC6','VAR1','VAR2','VAR3','VAR4'];
const MODE_POSITIONS = ['M-S LINK','M-S','LINK','IND'];
// Short display labels — engine values stay the same; only the rendered text
// is shortened so all 4 fit inside the chicken-head's label ring without clipping.
const MODE_LABELS    = ['MSL',     'M-S','LNK', 'IND'];
// Meter-mode selector — only positions with REAL behavior. BYP/BAL were
// removed in repair v1 because they were either silent or didn't actually
// route around the cell. The remaining positions both drive the VU needle
// from a real engine signal: VU = input peak, GR = gain reduction depth.
const MTR_POSITIONS  = ['VU','GR'];

// ═════════════════════════════════════════════════════════════════════════════
// RACK SCREW (Phillips head)
// ═════════════════════════════════════════════════════════════════════════════
function Screw({ size = 12 }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display:'block' }}>
      <defs>
        <radialGradient id={`screw-${size}`} cx="32%" cy="28%">
          <stop offset="0%"   stopColor={COL.screwHi} />
          <stop offset="55%"  stopColor={COL.screw} />
          <stop offset="100%" stopColor="#3A3A3C" />
        </radialGradient>
      </defs>
      <circle cx={r} cy={r} r={r - 0.5} fill={`url(#screw-${size})`} stroke="#2A2A2C" strokeWidth={0.5} />
      <line x1={r * 0.55} y1={r * 0.95} x2={r * 1.45} y2={r * 1.05}
            stroke="#1A1A1C" strokeWidth={size * 0.13} strokeLinecap="round" />
      <line x1={r * 0.95} y1={r * 0.55} x2={r * 1.05} y2={r * 1.45}
            stroke="#1A1A1C" strokeWidth={size * 0.13} strokeLinecap="round" />
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// VU METER (amber glow, cream face, square bezel with vent slits)
// ═════════════════════════════════════════════════════════════════════════════
function useSpringNeedle(targetDb, minDb, maxDb, stiffness = 0.07, damping = 0.78) {
  // PERF: keep the RAF stable across renders — pulling deps into a ref
  // lets useEffect run exactly once per mount instead of cancelling +
  // re-registering ~60 times per second (every time `targetDb` updates
  // from the parent meter RAF). Parent can update these props freely
  // without restarting the animation loop.
  const stateRef  = useRef({ pos: minDb, vel: 0 });
  const paramsRef = useRef({ targetDb, minDb, maxDb, stiffness, damping });
  paramsRef.current = { targetDb, minDb, maxDb, stiffness, damping };
  const [pos, setPos] = useState(minDb);
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { targetDb:t, minDb:lo, maxDb:hi, stiffness:k, damping:d } = paramsRef.current;
      const s = stateRef.current;
      s.vel  = s.vel * d + (t - s.pos) * k;
      s.pos += s.vel;
      s.pos  = clamp(s.pos, lo - 2, hi + 3);
      // Skip setState if movement is imperceptibly small — cuts React
      // render work when the needle is resting.
      if (Math.abs(s.pos - pos) > 0.02 || Math.abs(s.vel) > 0.01) setPos(s.pos);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pos;
}

function VUMeter({ peakLinear, channelLabel, width = 200, height = 170 }) {
  // PERF: needle motion is driven by CSS `transition` on the `<g>`
  // rotation, NOT by a JS RAF spring. The meter state updates at ~30 Hz
  // (throttled parent RAF). Between updates, the GPU compositor
  // interpolates rotation with an ease-out curve — same ballistic VU
  // feel, zero main-thread work per frame, and animation smoothness is
  // no longer coupled to audio-thread pressure. Critical when running
  // alongside a heavy plugin like Lofi Loofy.
  const peakDb = peakLinear > 0 ? 20 * Math.log10(clamp(peakLinear, 1e-6, 4)) : -60;
  const needleDb = clamp(peakDb, -22, 5);

  // Layout — needle pivot pulled inward so the arc + scale labels stay inside the face.
  const bzPad = 5;                                  // bezel padding
  const fw = width - bzPad * 2;
  const fh = height - bzPad * 2 - 14;               // vent slits at bottom
  const cx = fw / 2;
  const cy = fh * 0.92;                             // pivot near bottom (slight inset)
  // Needle length must leave room for the outer tick + label ring (radius * 1.04 / 0.85).
  // Cap it so the leftmost "20" label cannot exit either edge.
  const maxByWidth  = (fw / 2) / Math.sin(50 * Math.PI / 180) / 1.05; // 50° = sweep/2
  const maxByHeight = cy / 1.05;
  const needleLen = Math.min(fh * 0.74, maxByWidth, maxByHeight);

  // Scale: -20 .. +3 mapped over 100° sweep
  const sweep = 100;
  const tickAngle = (db) => {
    const t = (db - (-20)) / 23;
    return (t * sweep - sweep / 2) * Math.PI / 180;
  };

  const ticks = [
    { db: -20, label: '20', major: true,  red: false },
    { db: -10, label: '10', major: true,  red: false },
    { db: -7,  label: '7',  major: false, red: false },
    { db: -5,  label: '5',  major: false, red: false },
    { db: -3,  label: '3',  major: true,  red: false },
    { db: -1,  label: '1',  major: false, red: false },
    { db: 0,   label: '0',  major: true,  red: true  },
    { db: 1,   label: '1',  major: false, red: true  },
    { db: 2,   label: '2',  major: false, red: true  },
    { db: 3,   label: '3',  major: false, red: true  },
  ];

  const needleAngleRad = tickAngle(clamp(needleDb, -22, 5));
  // Degrees for CSS transform (SVG rotates clockwise from +x; we convert
  // our math-frame angle so 0° points "up" through cy).
  const needleAngleDeg = needleAngleRad * 180 / Math.PI;

  return (
    <div style={{
      width, height, position:'relative',
      background: COL.vuBezel,
      borderRadius: 6,
      border: `2px solid ${COL.vuBezelEdge}`,
      boxShadow: `inset 0 0 8px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.6)`,
      padding: bzPad,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* Cream face with amber glow */}
      <div style={{
        width: fw, height: fh, position:'relative', borderRadius: 4,
        background: `radial-gradient(ellipse at 50% 100%, ${COL.vuFaceHot} 0%, ${COL.vuFace} 55%, #C9B070 100%)`,
        boxShadow: `inset 0 0 16px rgba(255,140,40,0.35), inset 0 0 32px rgba(255,180,80,0.2)`,
        overflow: 'hidden',
      }}>
        <svg width={fw} height={fh} style={{ position:'absolute', top:0, left:0 }}>
          {/* Curved baseline */}
          {(() => {
            const r = needleLen * 1.0;
            const a1 = -sweep / 2 * Math.PI / 180;
            const a2 =  sweep / 2 * Math.PI / 180;
            const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
            const x2 = cx + r * Math.sin(a2), y2 = cy - r * Math.cos(a2);
            return <path d={`M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}`}
                         fill="none" stroke={COL.vuArc} strokeWidth={1.2} opacity={0.9} />;
          })()}
          {/* Red zone (>=0) */}
          {(() => {
            const r = needleLen * 1.0;
            const a1 = tickAngle(0);
            const a2 = tickAngle(3);
            const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
            const x2 = cx + r * Math.sin(a2), y2 = cy - r * Math.cos(a2);
            return <path d={`M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}`}
                         fill="none" stroke={COL.vuRed} strokeWidth={2.8} />;
          })()}
          {/* Ticks + labels */}
          {ticks.map(tk => {
            const ar = tickAngle(tk.db);
            const r1 = needleLen * 0.95;
            const r2 = needleLen * (tk.major ? 1.04 : 1.00);
            const tr = needleLen * 0.85;
            return (
              <g key={tk.db}>
                <line
                  x1={cx + r1 * Math.sin(ar)} y1={cy - r1 * Math.cos(ar)}
                  x2={cx + r2 * Math.sin(ar)} y2={cy - r2 * Math.cos(ar)}
                  stroke={tk.red ? COL.vuRed : '#3A2A10'}
                  strokeWidth={tk.major ? 1.6 : 1} />
                <text
                  x={cx + tr * Math.sin(ar)} y={cy - tr * Math.cos(ar)}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={tk.major ? 10 : 8}
                  fontFamily="serif"
                  fill={tk.red ? COL.vuRed : '#3A2A10'}>
                  {tk.label}
                </text>
              </g>
            );
          })}
          {/* (VU and UNFAIRCHILD branding removed for clarity) */}
          {/* Needle — translate to pivot, then rotate. Geometry is
              fixed (pointing up from origin); only the rotation angle
              animates, so the GPU compositor can handle interpolation
              independently of the main thread. */}
          <g style={{
            transform: `translate(${cx}px, ${cy}px) rotate(${needleAngleDeg}deg)`,
            // 280 ms ease-out ≈ the ~300 ms integration time of a true
            // VU meter (IEC 60268-17). Any shorter and the needle reads
            // as peak, not VU — and it looks twitchy when the meter
            // updates at 30 Hz between interpolation points.
            transition: 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)',
            willChange: 'transform',
          }}>
            <line
              x1={0} y1={0} x2={0} y2={-needleLen}
              stroke={COL.vuNeedle} strokeWidth={1.4} strokeLinecap="round" />
          </g>
          {/* Pivot */}
          <circle cx={cx} cy={cy} r={4} fill="#1A1A1A" />
          <circle cx={cx} cy={cy} r={1.5} fill="#888" />
        </svg>
      </div>
      {/* Vent slits below */}
      <div style={{
        position:'absolute', left: bzPad, right: bzPad,
        bottom: bzPad, height: 14,
        display:'flex', justifyContent:'center', alignItems:'center', gap:4,
      }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            width: 2, height: 8, background:'#000',
            boxShadow:'inset 0 0 1px rgba(0,0,0,0.8)',
          }} />
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// RED LAMP (small round indicator)
// ═════════════════════════════════════════════════════════════════════════════
function RedLamp({ on }) {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26">
      <defs>
        <radialGradient id={`lamp-${on?'on':'off'}`} cx="35%" cy="30%">
          <stop offset="0%"   stopColor={on ? '#FF8888' : '#552020'} />
          <stop offset="60%"  stopColor={on ? '#FF2020' : '#330808'} />
          <stop offset="100%" stopColor={on ? '#880808' : '#1A0404'} />
        </radialGradient>
      </defs>
      <circle cx={13} cy={13} r={11} fill="#1A1A1A" />
      <circle cx={13} cy={13} r={9}  fill={`url(#lamp-${on?'on':'off'})`}
              style={on ? { filter:'drop-shadow(0 0 4px rgba(255,40,40,0.85))' } : {}} />
      {on && <ellipse cx={11} cy={10} rx={3} ry={1.5} fill="rgba(255,255,255,0.4)" />}
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ON TOGGLE (silver bat-handle)
// ═════════════════════════════════════════════════════════════════════════════
function OnToggle({ on, onChange, label = 'ON' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
      <div style={{ fontSize:9, fontFamily:'monospace', color:COL.text, letterSpacing:1 }}>{label}</div>
      <div onClick={() => onChange(!on)}
           style={{ cursor:'pointer', userSelect:'none' }}>
        <svg width={22} height={36} viewBox="0 0 22 36">
          {/* Body */}
          <rect x={4} y={10} width={14} height={16} rx={2} fill={COL.toggleBody}
                stroke="#000" strokeWidth={0.5} />
          {/* Stem */}
          <line x1={11} y1={on ? 4 : 32}
                x2={11} y2={on ? 18 : 18}
                stroke={COL.toggleStem} strokeWidth={3.5} strokeLinecap="round" />
          {/* Stem tip */}
          <circle cx={11} cy={on ? 4 : 32} r={2.5} fill={COL.toggleStem} stroke="#5A5A5C" strokeWidth={0.5} />
        </svg>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SC INSERT TOGGLE (small bat-handle, vertical)
// ═════════════════════════════════════════════════════════════════════════════
function SCToggle({ on, onChange, label = '' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
      <div style={{ fontSize:8, fontFamily:'monospace', color:COL.text, letterSpacing:0.6 }}>IN</div>
      <div onClick={() => onChange(!on)} style={{ cursor:'pointer', userSelect:'none' }}>
        <svg width={18} height={32} viewBox="0 0 18 32">
          <rect x={3} y={8} width={12} height={16} rx={2} fill={COL.toggleBody} stroke="#000" strokeWidth={0.5} />
          <line x1={9} y1={on ? 3 : 29} x2={9} y2={on ? 16 : 16}
                stroke={COL.toggleStem} strokeWidth={3} strokeLinecap="round" />
          <circle cx={9} cy={on ? 3 : 29} r={2.2} fill={COL.toggleStem} stroke="#5A5A5C" strokeWidth={0.5} />
        </svg>
      </div>
      <div style={{ fontSize:8, fontFamily:'monospace', color:COL.text, letterSpacing:0.6 }}>OUT</div>
      {label && <div style={{ fontSize:8, color:COL.textRed, letterSpacing:1, marginTop:2 }}>{label}</div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// BIG SKIRTED KNOB (Input Gain, Threshold, DC Threshold)
// Numbered scale around the perimeter, glossy black knob on top.
// ═════════════════════════════════════════════════════════════════════════════
function SkirtKnob({
  paramValue, paramMin, paramMax, onChange,
  scaleMin, scaleMax, scaleStep,
  size = 130, sweepDeg = 270,
  unique,
}) {
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    e.preventDefault();
    dragRef.current = { y: e.clientY, v: paramValue };
    const range = paramMax - paramMin;
    const move = (e2) => {
      const dy = dragRef.current.y - e2.clientY;
      let nv = dragRef.current.v + (dy / 200) * range;
      onChange(clamp(nv, paramMin, paramMax));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const range = paramMax - paramMin;
    const d = (e.deltaY < 0 ? 1 : -1) * range * 0.02;
    onChange(clamp(paramValue + d, paramMin, paramMax));
  };

  const r = size / 2;
  const knobR = r * 0.50;
  const tickInner = r * 0.65;
  const tickOuterMaj = r * 0.78;
  const tickOuterMin = r * 0.74;
  const numR = r * 0.90;

  // Map paramValue → angle
  const t = (paramValue - paramMin) / (paramMax - paramMin);
  const startDeg = -sweepDeg / 2;
  const angleDeg = startDeg + t * sweepDeg;
  const angleRad = angleDeg * Math.PI / 180;

  // Generate scale numbers (every scaleStep)
  const numbers = [];
  for (let n = scaleMin; n <= scaleMax + 0.0001; n += scaleStep) {
    const tn = (n - scaleMin) / (scaleMax - scaleMin);
    const ad = startDeg + tn * sweepDeg;
    numbers.push({ value: Math.round(n * 10) / 10, ad });
  }

  // Indicator dot near edge of knob
  const indR = knobR * 0.78;
  const indX = r + indR * Math.sin(angleRad);
  const indY = r - indR * Math.cos(angleRad);

  return (
    <svg width={size} height={size} onMouseDown={onMouseDown} onWheel={onWheel}
         style={{ cursor:'ns-resize', userSelect:'none', display:'block' }}>
      <defs>
        <radialGradient id={`sk-${unique}`} cx="35%" cy="25%">
          <stop offset="0%"   stopColor="#3A3A3A" />
          <stop offset="35%"  stopColor="#1A1A1A" />
          <stop offset="100%" stopColor="#020202" />
        </radialGradient>
      </defs>
      {/* Numbered scale */}
      {numbers.map((n, i) => {
        const ar = n.ad * Math.PI / 180;
        const isMaj = (i === 0) || (i === numbers.length - 1) || (n.value % (scaleStep * 2) === 0);
        return (
          <g key={i}>
            <line
              x1={r + tickInner * Math.sin(ar)} y1={r - tickInner * Math.cos(ar)}
              x2={r + (isMaj ? tickOuterMaj : tickOuterMin) * Math.sin(ar)}
              y2={r - (isMaj ? tickOuterMaj : tickOuterMin) * Math.cos(ar)}
              stroke={COL.skirtText} strokeWidth={isMaj ? 1.2 : 0.8} />
            <text
              x={r + numR * Math.sin(ar)} y={r - numR * Math.cos(ar)}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={8.5} fill={COL.skirtText} fontFamily="monospace">
              {n.value}
            </text>
          </g>
        );
      })}
      {/* Knob outer ring */}
      <circle cx={r} cy={r} r={knobR + 3} fill="#000" />
      {/* Knob body */}
      <circle cx={r} cy={r} r={knobR} fill={`url(#sk-${unique})`} stroke="#000" strokeWidth={0.8} />
      {/* Glossy highlight */}
      <ellipse cx={r - knobR * 0.25} cy={r - knobR * 0.42} rx={knobR * 0.5} ry={knobR * 0.16}
               fill="rgba(255,255,255,0.07)" />
      {/* Indicator dot */}
      <circle cx={indX} cy={indY} r={3} fill={COL.knobIndicator}
              style={{ filter:'drop-shadow(0 0 1px rgba(255,255,255,0.6))' }} />
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CHICKEN-HEAD ROTARY (multi-position selector)
// Triangular pointer + position labels in arc.
// Used for: BYP/VU/GR/BAL · TIME CONSTANT · CHANNEL MODE
// ═════════════════════════════════════════════════════════════════════════════
function ChickenHead({
  positions,           // array of label strings
  selectedIndex,
  onChange,
  size = 100,
  sweepDeg,            // total arc sweep
  startDeg,            // angle of position 0
  unique,
  labelDistance = 0.95,
  labelSize = 9,
  labelColor = COL.text,
}) {
  const r = size / 2;
  const knobR = r * 0.40;

  if (sweepDeg === undefined) sweepDeg = (positions.length - 1) * 30;
  if (startDeg === undefined) startDeg = -sweepDeg / 2;

  const angleAt = (i) => {
    const t = positions.length === 1 ? 0 : i / (positions.length - 1);
    return startDeg + t * sweepDeg;
  };
  const ad = angleAt(selectedIndex);
  const ar = ad * Math.PI / 180;

  // Triangle pointer (relative to knob center)
  const ptR = knobR * 1.15;
  const baseHalfW = knobR * 0.45;
  const tipX = r + ptR * Math.sin(ar);
  const tipY = r - ptR * Math.cos(ar);
  const baseAngLeft  = ar + Math.PI / 2;
  const baseAngRight = ar - Math.PI / 2;
  const baseLX = r + baseHalfW * Math.sin(baseAngLeft);
  const baseLY = r - baseHalfW * Math.cos(baseAngLeft);
  const baseRX = r + baseHalfW * Math.sin(baseAngRight);
  const baseRY = r - baseHalfW * Math.cos(baseAngRight);
  // Back of pointer (opposite tip)
  const backX = r - knobR * 0.5 * Math.sin(ar);
  const backY = r + knobR * 0.5 * Math.cos(ar);

  const onLabelClick = (i) => onChange(i);

  // Drag + wheel control — chicken-heads were previously click-only on the
  // label text, which made them feel uncontrollable. Vertical drag and wheel
  // both step through positions and snap to the nearest one.
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    e.preventDefault();
    // Track current position so each step requires a fresh stepPx of travel
    // from the LAST step, not from the original mousedown. This prevents the
    // "fast flick blows past your target" feel — the knob steps deliberately,
    // one position at a time, in step with the cursor.
    dragRef.current = { y: e.clientY, idx: selectedIndex };
    const move = (e2) => {
      const stepPx = 36;                                   // ↑ from 18; deliberate per-step travel
      const dy     = dragRef.current.y - e2.clientY;       // up = +
      if (Math.abs(dy) < stepPx) return;
      const dir    = dy > 0 ? 1 : -1;
      const ni     = Math.max(0, Math.min(positions.length - 1, dragRef.current.idx + dir));
      if (ni !== dragRef.current.idx) {
        onChange(ni);
        // Re-anchor: next step requires another full stepPx in the same dir.
        dragRef.current.idx = ni;
        dragRef.current.y   = e2.clientY;
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const ni  = Math.max(0, Math.min(positions.length - 1, selectedIndex + dir));
    if (ni !== selectedIndex) onChange(ni);
  };

  // Pad the SVG box so labels positioned beyond the knob radius (labelDistance
  // close to or above 1.0) have room to render without clipping at the edge.
  // Coordinates inside the SVG still use (r,r) as center because the viewBox
  // is shifted by -PAD to match.
  const PAD = Math.max(14, labelSize * 2.4);
  const boxW = size + PAD * 2;

  return (
    <svg width={boxW} height={boxW}
         viewBox={`${-PAD} ${-PAD} ${boxW} ${boxW}`}
         onMouseDown={onMouseDown} onWheel={onWheel}
         style={{ display:'block', userSelect:'none', cursor:'ns-resize', overflow:'visible' }}>
      <defs>
        <radialGradient id={`ch-${unique}`} cx="35%" cy="25%">
          <stop offset="0%"   stopColor="#2A2A2A" />
          <stop offset="100%" stopColor="#0A0A0A" />
        </radialGradient>
      </defs>
      {/* Position labels around the perimeter */}
      {positions.map((p, i) => {
        const a = angleAt(i) * Math.PI / 180;
        const lx = r + r * labelDistance * Math.sin(a);
        const ly = r - r * labelDistance * Math.cos(a);
        const isSel = i === selectedIndex;
        return (
          <g key={p + i} style={{ cursor:'pointer' }} onClick={() => onLabelClick(i)}>
            <text x={lx} y={ly}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={labelSize}
                  fill={isSel ? COL.active : labelColor}
                  fontFamily="monospace" letterSpacing={0.5}>
              {p}
            </text>
          </g>
        );
      })}
      {/* Tick marks behind labels */}
      {positions.map((_, i) => {
        const a = angleAt(i) * Math.PI / 180;
        const ri = r * 0.62, ro = r * 0.72;
        return <line key={i}
          x1={r + ri * Math.sin(a)} y1={r - ri * Math.cos(a)}
          x2={r + ro * Math.sin(a)} y2={r - ro * Math.cos(a)}
          stroke="#444" strokeWidth={1} />;
      })}
      {/* Knob backing */}
      <circle cx={r} cy={r} r={knobR + 2} fill="#000" />
      {/* Pointer (chicken head) */}
      <polygon
        points={`${tipX},${tipY} ${baseLX},${baseLY} ${backX},${backY} ${baseRX},${baseRY}`}
        fill={`url(#ch-${unique})`} stroke="#000" strokeWidth={0.8}
      />
      {/* Centre highlight */}
      <circle cx={r - knobR * 0.15} cy={r - knobR * 0.3} r={knobR * 0.15} fill="rgba(255,255,255,0.08)" />
      {/* Centre cap dot */}
      <circle cx={r} cy={r} r={2} fill="#FFF" opacity={0.4} />
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// VAR KNOB (chicken-head with numbered fan scale 1-12 + FAST/SLOW labels)
// ═════════════════════════════════════════════════════════════════════════════
function VarKnob({
  paramValue, paramMin = 0, paramMax = 1, onChange,
  size = 90, disabled, unique,
}) {
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    dragRef.current = { y: e.clientY, v: paramValue };
    const range = paramMax - paramMin;
    const move = (e2) => {
      const dy = dragRef.current.y - e2.clientY;
      let nv = dragRef.current.v + (dy / 180) * range;
      onChange(clamp(nv, paramMin, paramMax));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onWheel = (e) => {
    if (disabled) return;
    e.preventDefault();
    const range = paramMax - paramMin;
    const d = (e.deltaY < 0 ? 1 : -1) * range * 0.02;
    onChange(clamp(paramValue + d, paramMin, paramMax));
  };

  const r = size / 2;
  const knobR = r * 0.36;
  const sweepDeg = 220;
  const startDeg = -sweepDeg / 2;

  const t = (paramValue - paramMin) / (paramMax - paramMin);
  const ad = startDeg + t * sweepDeg;
  const ar = ad * Math.PI / 180;

  // 12 positions (1..12)
  const ticks = [];
  for (let i = 1; i <= 12; i++) {
    const tn = (i - 1) / 11;
    const ta = (startDeg + tn * sweepDeg) * Math.PI / 180;
    ticks.push({ n: i, a: ta });
  }

  // Pointer triangle
  const ptR = knobR * 1.2;
  const baseHalfW = knobR * 0.45;
  const tipX = r + ptR * Math.sin(ar);
  const tipY = r - ptR * Math.cos(ar);
  const baseLX = r + baseHalfW * Math.sin(ar + Math.PI/2);
  const baseLY = r - baseHalfW * Math.cos(ar + Math.PI/2);
  const baseRX = r + baseHalfW * Math.sin(ar - Math.PI/2);
  const baseRY = r - baseHalfW * Math.cos(ar - Math.PI/2);
  const backX = r - knobR * 0.45 * Math.sin(ar);
  const backY = r + knobR * 0.45 * Math.cos(ar);

  return (
    <svg width={size} height={size + 14} onMouseDown={onMouseDown} onWheel={onWheel}
         style={{ cursor: disabled ? 'default' : 'ns-resize', opacity: disabled ? 0.4 : 1, display:'block' }}>
      <defs>
        <radialGradient id={`vk-${unique}`} cx="35%" cy="25%">
          <stop offset="0%"   stopColor="#2A2A2A" />
          <stop offset="100%" stopColor="#080808" />
        </radialGradient>
      </defs>
      {/* Tick marks */}
      {ticks.map(tk => {
        const ri = r * 0.60, ro = r * 0.72;
        return <line key={tk.n}
          x1={r + ri * Math.sin(tk.a)} y1={r - ri * Math.cos(tk.a)}
          x2={r + ro * Math.sin(tk.a)} y2={r - ro * Math.cos(tk.a)}
          stroke={COL.skirtText} strokeWidth={tk.n === 1 || tk.n === 12 ? 1.4 : 0.8} />;
      })}
      {/* Numbers */}
      {ticks.map(tk => {
        const rN = r * 0.86;
        return (
          <text key={`n${tk.n}`}
                x={r + rN * Math.sin(tk.a)} y={r - rN * Math.cos(tk.a)}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={7} fill={COL.skirtText} fontFamily="monospace">
            {tk.n}
          </text>
        );
      })}
      {/* FAST / SLOW labels at the bottom */}
      <text x={r - r * 0.55} y={size - 2} fontSize={8} fill={COL.text}
            textAnchor="middle" fontFamily="monospace" letterSpacing={1}>FAST</text>
      <text x={r + r * 0.55} y={size - 2} fontSize={8} fill={COL.text}
            textAnchor="middle" fontFamily="monospace" letterSpacing={1}>SLOW</text>
      {/* Pointer */}
      <circle cx={r} cy={r} r={knobR + 2} fill="#000" />
      <polygon
        points={`${tipX},${tipY} ${baseLX},${baseLY} ${backX},${backY} ${baseRX},${baseRY}`}
        fill={`url(#vk-${unique})`} stroke="#000" strokeWidth={0.6}
      />
      <circle cx={r} cy={r} r={1.5} fill="#FFF" opacity={0.4} />
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MICRO LED (small round indicator with label below)
// ═════════════════════════════════════════════════════════════════════════════
function MicroLed({ on, label, color = 'white' }) {
  const onCol = color === 'red' ? COL.ledRedOn : COL.ledWhiteOn;
  const offCol = color === 'red' ? COL.ledRedOff : COL.ledWhiteOff;
  const glow = color === 'red' ? 'rgba(255,40,40,0.7)' : 'rgba(255,255,200,0.6)';
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
      <div style={{
        width:9, height:9, borderRadius:'50%',
        background: on ? onCol : offCol,
        border: '1px solid #000',
        boxShadow: on ? `0 0 6px ${glow}` : 'none',
      }} />
      <div style={{ fontSize:9, fontFamily:'"Helvetica Neue", Arial, sans-serif',
                    color:'#F2F2F2', letterSpacing:1, fontWeight:700,
                    whiteSpace:'nowrap', textTransform:'uppercase' }}>
        {label}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LABEL ROW (white text + red side-designator)
// ═════════════════════════════════════════════════════════════════════════════
function ChannelLabel({ channel, side, title, align = 'center' }) {
  return (
    <div style={{ textAlign: align, lineHeight:1.15, padding:'0 4px' }}>
      <div style={{ fontSize:9, fontFamily:'monospace', color:COL.text, letterSpacing:1.2 }}>
        CHANNEL {channel} – <span style={{ color:COL.textRed }}>{side}</span>
      </div>
      <div style={{ fontSize:9, fontFamily:'monospace', color:COL.text, letterSpacing:1.4, fontWeight:'bold' }}>
        {title}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DEFAULTS
// ═════════════════════════════════════════════════════════════════════════════
const DEFAULTS = Object.freeze({
  inA:0, inB:0, thA:0.45, thB:0.45,
  tcA:'TC2', tcB:'TC2',
  scA:true, scB:true,
  meterA:'VU', meterB:'VU',
  chanMode:'LINK',
  dcA:0.50, dcB:0.50,
  varAtkA:0.50, varAtkB:0.50,
  varRelA:0.50, varRelB:0.50,
  fb:true, txDrive:0,
  inDb:0, outDb:0, mix:1.0, bypass:false, character:null,
});
const PERSISTED_KEYS = Object.keys(DEFAULTS);

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function ManChildOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  // variantId selects which engine module to load. Default 'legacy' keeps
  // older main.jsx call sites working; main.jsx should pass inst.variantId
  // so the registry's approved variant drives the UI.
  variantId = 'legacy',
}) {
  const init = initialState || {};
  const D    = DEFAULTS;

  // ── State ──
  const [inA, setInA]           = useState(init.inA      ?? D.inA);
  const [inB, setInB]           = useState(init.inB      ?? D.inB);
  const [thA, setThA]           = useState(init.thA      ?? D.thA);
  const [thB, setThB]           = useState(init.thB      ?? D.thB);
  const [tcA, setTcA]           = useState(init.tcA      ?? D.tcA);
  const [tcB, setTcB]           = useState(init.tcB      ?? D.tcB);
  const [scA, setScA]           = useState(init.scA      ?? D.scA);
  const [scB, setScB]           = useState(init.scB      ?? D.scB);
  const [meterA, setMeterA]     = useState(init.meterA   ?? D.meterA);
  const [meterB, setMeterB]     = useState(init.meterB   ?? D.meterB);
  const [chanMode, setChanMode] = useState(init.chanMode ?? D.chanMode);
  const [dcA, setDcA]           = useState(init.dcA      ?? D.dcA);
  const [dcB, setDcB]           = useState(init.dcB      ?? D.dcB);
  const [varAtkA, setVarAtkA]   = useState(init.varAtkA  ?? D.varAtkA);
  const [varAtkB, setVarAtkB]   = useState(init.varAtkB  ?? D.varAtkB);
  const [varRelA, setVarRelA]   = useState(init.varRelA  ?? D.varRelA);
  const [varRelB, setVarRelB]   = useState(init.varRelB  ?? D.varRelB);
  const [fb, setFb]             = useState(init.fb       ?? D.fb);
  const [txDrive, setTxDrive]   = useState(init.txDrive  ?? D.txDrive);
  const [inDb, setInDb]         = useState(init.inDb     ?? D.inDb);
  const [outDb, setOutDb]       = useState(init.outDb    ?? D.outDb);
  const [mix, setMix]           = useState(init.mix      ?? D.mix);
  const [bypass, setBypass]     = useState(init.bypass   ?? D.bypass);
  const [character, setCharacter] = useState(init.character ?? D.character);
  const [onPower, setOnPower]   = useState(true);

  const [meter, setMeter] = useState({
    peakInA:0, peakInB:0, peakOutA:0, peakOutB:0, grDbA:0, grDbB:0,
  });

  const applyingPreset = useRef(false);
  const engineRef      = useRef(null);
  const [ready, setReady] = useState(false);
  // Preset dictionary for the ACTIVE variant, loaded async with the engine
  // factory so the UI can't drift from the DSP (the exact bug the
  // variant_drift QC rule now catches). Used only for the dropdown + name
  // lookup in applyCharacter; the engine has its own copy for setCharacter.
  const [presets, setPresets] = useState(null);
  const ctx = sharedSource?.ctx;

  // ── Engine mount ──
  // Re-runs when ctx OR variantId changes. Variant switch → Orb remounts
  // this effect via new module load → new engine instance → fresh audio
  // graph wired into the shared context. Cleanup disposes the prior one.
  useEffect(() => {
    if (!ctx) return;
    let disposed = false;
    (async () => {
      const { createEngine, PRESETS } = await loadVariantModule(variantId);
      if (disposed) return;
      setPresets(PRESETS);
      const eng = await createEngine(ctx);
      if (disposed) { eng.dispose(); return; }
      engineRef.current = eng;
      eng.applyBulk({
        inA, inB, thA, thB, dcA, dcB,
        varAtkA, varRelA, varAtkB, varRelB,
        fb, txDrive, tcA, tcB, chanMode, scA, scB,
        inDb, outDb, mix, bypass,
      });
      if (character) eng.setCharacter(character);
      registerEngine?.(instanceId, eng);
      setReady(true);
    })();
    return () => {
      disposed = true;
      if (engineRef.current) {
        unregisterEngine?.(instanceId, engineRef.current);
        engineRef.current.dispose();
        engineRef.current = null;
      }
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, variantId]);

  // ── Reactive bindings ──
  const g = (fn) => { if (!applyingPreset.current) fn(); };
  useEffect(() => g(() => engineRef.current?.setInputGainA(inA)),       [inA]);
  useEffect(() => g(() => engineRef.current?.setInputGainB(inB)),       [inB]);
  useEffect(() => g(() => engineRef.current?.setThresholdA(thA)),       [thA]);
  useEffect(() => g(() => engineRef.current?.setThresholdB(thB)),       [thB]);
  useEffect(() => g(() => engineRef.current?.setDcA(dcA)),              [dcA]);
  useEffect(() => g(() => engineRef.current?.setDcB(dcB)),              [dcB]);
  useEffect(() => g(() => engineRef.current?.setVarAtkA(varAtkA)),      [varAtkA]);
  useEffect(() => g(() => engineRef.current?.setVarRelA(varRelA)),      [varRelA]);
  useEffect(() => g(() => engineRef.current?.setVarAtkB(varAtkB)),      [varAtkB]);
  useEffect(() => g(() => engineRef.current?.setVarRelB(varRelB)),      [varRelB]);
  useEffect(() => g(() => engineRef.current?.setFB(fb)),                [fb]);
  useEffect(() => g(() => engineRef.current?.setTxDrive(txDrive)),      [txDrive]);
  useEffect(() => g(() => engineRef.current?.setTcA(tcA)),              [tcA]);
  useEffect(() => g(() => engineRef.current?.setTcB(tcB)),              [tcB]);
  useEffect(() => g(() => engineRef.current?.setChannelMode(chanMode)), [chanMode]);
  useEffect(() => g(() => engineRef.current?.setScA(scA)),              [scA]);
  useEffect(() => g(() => engineRef.current?.setScB(scB)),              [scB]);
  useEffect(() => g(() => engineRef.current?.setIn(inDb)),              [inDb]);
  useEffect(() => g(() => engineRef.current?.setOut(outDb)),            [outDb]);
  useEffect(() => g(() => engineRef.current?.setMix(mix)),              [mix]);
  useEffect(() => g(() => engineRef.current?.setBypass(bypass)), [bypass]);

  // ── Persistence ──
  useEffect(() => {
    if (!onStateChange) return;
    const map = {
      inA, inB, thA, thB, tcA, tcB, scA, scB, meterA, meterB,
      chanMode, dcA, dcB, varAtkA, varRelA, varAtkB, varRelB,
      fb, txDrive, inDb, outDb, mix, bypass, character,
    };
    const payload = {};
    for (const k of PERSISTED_KEYS) if (k in map) payload[k] = map[k];
    onStateChange(instanceId, payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inA,inB,thA,thB,tcA,tcB,scA,scB,meterA,meterB,
      chanMode,dcA,dcB,varAtkA,varRelA,varAtkB,varRelB,
      fb,txDrive,inDb,outDb,mix,bypass,character]);

  // ── Meter RAF ──
  // PERF: throttled to ~30 Hz + wider change threshold. The spring-needle
  // hook does its own 60 Hz smoothing, so polling the engine at 60 Hz
  // just doubles React render work with no perceivable benefit.
  useEffect(() => {
    let raf;
    let lastT = 0;
    const MIN_MS = 1000 / 30;  // 30 Hz poll
    const prev = {};
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      if (t - lastT < MIN_MS) return;
      lastT = t;
      const eng = engineRef.current; if (!eng) return;
      const m = {
        peakInA:  eng.getInputPeakA()  ?? 0,
        peakInB:  eng.getInputPeakB()  ?? 0,
        peakOutA: eng.getOutputPeakA() ?? 0,
        peakOutB: eng.getOutputPeakB() ?? 0,
        grDbA:    eng.getGrDbA()       ?? 0,
        grDbB:    eng.getGrDbB()       ?? 0,
      };
      let changed = false;
      for (const k of Object.keys(m)) {
        // 0.005 threshold = ignore sub-half-percent wiggles. Keeps React
        // from re-rendering on noise-floor fluctuations when the plugin
        // is idle or at steady-state.
        if (Math.abs((m[k]??0) - (prev[k]??0)) > 0.005) { changed = true; prev[k] = m[k]; }
      }
      if (changed) setMeter({ ...m });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Preset apply ──
  const applyCharacter = (name) => {
    const p = presets?.[name]; if (!p) return;
    applyingPreset.current = true;
    setCharacter(name);
    setInA(p.inA);     setInB(p.inB);
    setThA(p.thA);     setThB(p.thB);
    setTcA(p.tcA);     setTcB(p.tcB);
    setChanMode(p.chanMode);
    setDcA(p.dcA);     setDcB(p.dcB);
    setScA(p.scA);     setScB(p.scB);
    setVarAtkA(p.varAtkA); setVarAtkB(p.varAtkB);
    setVarRelA(p.varRelA); setVarRelB(p.varRelB);
    setTxDrive(p.txDrive); setFb(p.fb);
    setMix(p.mix);     setInDb(p.inDb);  setOutDb(p.outDb);
    setBypass(p.bypass);
    engineRef.current?.setCharacter(name);
    queueMicrotask(() => { applyingPreset.current = false; });
  };
  const edit = (setter) => (v) => { setter(v); setCharacter(null); };

  // ── Derived ──
  const sideA = isMsMode(chanMode) ? 'M'    : 'LEFT/M';
  const sideB = isMsMode(chanMode) ? 'S'    : 'RIGHT/S';
  const lmsA  = isMsMode(chanMode) ? 'M'    : 'L/M';
  const lmsB  = isMsMode(chanMode) ? 'S'    : 'R/S';
  const sideLabelA = isMsMode(chanMode) ? 'MID'  : 'LEFT/M';
  const sideLabelB = isMsMode(chanMode) ? 'SIDE' : 'RIGHT/S';

  // Meter-mode → signal source (linear amplitude consumed by VUMeter, which
  // converts to dB internally via 20·log10).
  //   VU : input peak (post-encode, post-input-gain — what the cell sees).
  //   GR : gain-reduction depth, mapped 10^(grDb/20) so the needle deflects
  //        toward "20" in proportion to actual GR (e.g. -10 dB GR → needle
  //        at -10 on the scale). Light GR → small move; heavy GR → big move.
  const grToLinear = (grDb) => Math.pow(10, Math.min(0, grDb) / 20);
  const meterSignalA = meterA === 'GR' ? grToLinear(meter.grDbA) : meter.peakInA;
  const meterSignalB = meterB === 'GR' ? grToLinear(meter.grDbB) : meter.peakInB;

  const mtrAIdx = Math.max(0, MTR_POSITIONS.indexOf(meterA));
  const mtrBIdx = Math.max(0, MTR_POSITIONS.indexOf(meterB));

  // LED states (cosmetic — match hardware idiom)
  const gainTrimAOn = Math.abs(inA) > 0.5;
  const balAOn      = isMsMode(chanMode);
  const grZeroAOn   = meter.grDbA > -0.1 && !bypass;
  const gainTrimBOn = Math.abs(inB) > 0.5;
  const balBOn      = isMsMode(chanMode);
  const grZeroBOn   = meter.grDbB > -0.1 && !bypass;

  const tcAIdx = Math.max(0, TC_POSITIONS.indexOf(tcA));
  const tcBIdx = Math.max(0, TC_POSITIONS.indexOf(tcB));
  const modeIdx = Math.max(0, MODE_POSITIONS.indexOf(chanMode));

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────────────────────────────────
  // Column wrapper — bright title above, control below.
  // `primary` = dominant control (INPUT / THRESH / TIME CONST) → larger, brighter title.
  const Col = ({ title, side, channel, children, w = 110, primary = false }) => {
    const titleSize = primary ? 13 : 11;
    const titleColor = '#F2F2F2';                 // bright off-white, high contrast
    const channelColor = primary ? '#FF5050' : COL.textRed;
    return (
      <div style={{
        width: w, display:'flex', flexDirection:'column',
        alignItems:'center', gap: primary ? 8 : 6,
      }}>
        {(title || channel) && (
          <div style={{
            fontSize: titleSize, color: titleColor,
            letterSpacing: primary ? 1.6 : 1.3,
            fontFamily:'"Helvetica Neue", Arial, sans-serif',
            fontWeight: primary ? 800 : 700,
            textTransform:'uppercase',
            textAlign:'center', lineHeight:1, height: primary ? 22 : 18,
            display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            textShadow: primary ? '0 1px 2px rgba(0,0,0,0.9)' : 'none',
          }}>
            {channel && <span style={{ color: channelColor, fontWeight:900 }}>{channel}</span>}
            {title}
            {side && <span style={{ color: channelColor, fontSize: titleSize - 2, fontWeight:700 }}>{side}</span>}
          </div>
        )}
        {children}
      </div>
    );
  };

  return (
    <div style={{
      width:1280, height:500, position:'relative',
      background: `linear-gradient(to right, ${COL.railLo} 0%, ${COL.rail} 4%, ${COL.railHi} 8%, ${COL.rail} 12%, ${COL.rail} 88%, ${COL.railHi} 92%, ${COL.rail} 96%, ${COL.railLo} 100%)`,
      borderRadius:4,
      overflow:'hidden', userSelect:'none',
      boxShadow:`0 4px 28px rgba(0,0,0,0.7)`,
      fontFamily:'monospace',
    }}>
      {/* ── LEFT RAIL SCREWS ── */}
      <div style={{
        position:'absolute', left:8, top:8, bottom:8, width:18,
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        alignItems:'center', pointerEvents:'none',
      }}>
        {[0,1,2,3].map(i => <Screw key={i} size={12} />)}
      </div>
      {/* ── RIGHT RAIL SCREWS ── */}
      <div style={{
        position:'absolute', right:8, top:8, bottom:8, width:18,
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        alignItems:'center', pointerEvents:'none',
      }}>
        {[0,1,2,3].map(i => <Screw key={i} size={12} />)}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SINGLE HORIZONTAL RACK PANEL (between rails)                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div style={{
        position:'absolute', left:32, right:32, top:8, bottom:8,
        display:'flex', flexDirection:'column',
      }}>
        {/* ┌─────────────────────────────────────────────────────────────┐ */}
        {/* │ SINGLE RACK PANEL (full height)                              │ */}
        {/* └─────────────────────────────────────────────────────────────┘ */}
        <div style={{
          flex:1,
          background: COL.panel,
          border:`1px solid ${COL.panelEdge}`,
          borderRadius:3,
          position:'relative',
          boxShadow:`inset 0 0 18px rgba(0,0,0,0.7)`,
        }}>
          {/* Corner screws */}
          {[
            {top:6,left:6}, {top:6,right:6},
            {bottom:6,left:6}, {bottom:6,right:6},
          ].map((p,i) => (
            <div key={i} style={{ position:'absolute', ...p }}><Screw size={12} /></div>
          ))}

          {/* ── BOTTOM GAIN-STAGE STRIP ──
              Layout per cell:  [ ▮ L+R dB bar ]  [ KNOB + readout ]
              MIX and DRIVE are knob-only. IN and OUT get a tiny stereo dB
              meter to their LEFT so the user can see actual level without
              hunting the big VU. Strip has a subtle background panel and
              breathing room around each cell to relieve the cramp. */}
          {(() => {
            // Tiny vertical stereo dB meter (-40..+6 dBFS).
            const linToDb = (v) => v > 1e-5 ? 20 * Math.log10(v) : -80;
            const MiniDbMeter = ({ peakL, peakR }) => {
              const W = 14, H = 56, padX = 1, barW = (W - padX * 3) / 2;
              const dbMin = -40, dbMax = 6;
              const dbToY = (db) => {
                const t = (Math.max(dbMin, Math.min(dbMax, db)) - dbMin) / (dbMax - dbMin);
                return H - t * H;
              };
              const dbL = linToDb(peakL), dbR = linToDb(peakR);
              const yL = dbToY(dbL), yR = dbToY(dbR);
              const y0  = dbToY(0);     // 0 dBFS line
              const yM6 = dbToY(-6);    // -6 dB tick
              const seg = (x, yTop) => {
                // Three colour zones: green to -6, amber to 0, red above.
                const segs = [];
                const zRed   = Math.max(yTop, y0);
                const zAmber = Math.max(yTop, yM6);
                if (yTop < y0)   segs.push(<rect key="r" x={x} y={yTop} width={barW} height={y0 - yTop} fill="#FF4040" />);
                if (zRed < yM6)  segs.push(<rect key="a" x={x} y={zRed} width={barW} height={yM6 - zRed} fill="#FFB040" />);
                segs.push(<rect key="g" x={x} y={zAmber} width={barW} height={H - zAmber} fill="#3ACB6E" />);
                return segs;
              };
              return (
                <svg width={W} height={H} style={{ display:'block' }}>
                  <rect x={0} y={0} width={W} height={H} fill="#0A0A0A" stroke="#2A2A2A" />
                  {seg(padX, yL)}
                  {seg(padX * 2 + barW, yR)}
                  {/* 0 dBFS reference line */}
                  <line x1={0} y1={y0} x2={W} y2={y0} stroke="#FF6060" strokeWidth={0.5} opacity={0.7} />
                </svg>
              );
            };

            const labelStyle = {
              fontSize:10, color:'#F2F2F2', letterSpacing:1.4,
              fontFamily:'"Helvetica Neue",Arial,sans-serif', fontWeight:700,
            };
            const readStyle = {
              fontSize:9, color:'#D6D6D6',
              fontFamily:'"Helvetica Neue",Arial,sans-serif',
              fontWeight:700, letterSpacing:0.4, marginTop:2,
            };

            const KnobCell = ({ title, value, fmt, onChange, min, max, sMin, sMax, sStep, unique }) => (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, minWidth:54 }}>
                <div style={labelStyle}>{title}</div>
                <SkirtKnob paramValue={value} paramMin={min} paramMax={max}
                  onChange={onChange} scaleMin={sMin} scaleMax={sMax} scaleStep={sStep}
                  size={42} unique={unique} />
                <div style={readStyle}>{fmt(value)}</div>
              </div>
            );

            const MeteredKnob = ({ peakL, peakR, ...knobProps }) => (
              <div style={{ display:'flex', flexDirection:'row', alignItems:'flex-end', gap:6 }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <div style={{ ...labelStyle, fontSize:7, color:'#888', letterSpacing:0.6 }}>dB</div>
                  <MiniDbMeter peakL={peakL} peakR={peakR} />
                </div>
                <KnobCell {...knobProps} />
              </div>
            );

            return (
              <div style={{
                position:'absolute', bottom:6, left:200, right:240,
                display:'flex', alignItems:'flex-end', justifyContent:'space-around',
                gap:14,
                padding:'8px 18px 6px',
              }}>
                <MeteredKnob title="IN" peakL={meter.peakInA} peakR={meter.peakInB}
                  value={inDb} onChange={edit(setInDb)}
                  min={-24} max={24} sMin={-20} sMax={20} sStep={10} unique="inDb"
                  fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`} />

                <KnobCell title="MIX" value={mix} onChange={edit(setMix)}
                  min={0} max={1} sMin={0} sMax={100} sStep={25} unique="mix"
                  fmt={v => `${Math.round(v * 100)}%`} />

                <KnobCell title="DRIVE" value={txDrive} onChange={edit(setTxDrive)}
                  min={0} max={1} sMin={0} sMax={10} sStep={2} unique="drv"
                  fmt={v => `${Math.round(v * 100)}%`} />

                <MeteredKnob title="OUT" peakL={meter.peakOutA} peakR={meter.peakOutB}
                  value={outDb} onChange={edit(setOutDb)}
                  min={-24} max={24} sMin={-20} sMax={20} sStep={10} unique="outDb"
                  fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`} />
              </div>
            );
          })()}

          {/* Bottom-right branding */}
          <div style={{ position:'absolute', bottom:14, right:30,
                        display:'flex', alignItems:'baseline', gap:14, pointerEvents:'none' }}>
            <div style={{
              fontSize:11, color:COL.text, letterSpacing:2, fontFamily:'serif',
              border:`1px solid ${COL.text}`, borderRadius:14, padding:'1px 12px',
            }}>NASTY</div>
            <div style={{ fontSize:18, fontFamily:'serif', fontStyle:'italic', color:COL.text }}>
              Man<span style={{ color:COL.textRed }}>Child</span>
            </div>
            <div style={{ fontSize:9, color:COL.text, letterSpacing:1.5, fontFamily:'monospace' }}>
              MODEL <span style={{ color:COL.textRed }}>670-Λ</span>
            </div>
          </div>

          {/* Inner layout (1280x500: VU column left, 2 channel rows mid, global col right)
              bottom padding leaves room for the global gain-stage strip + branding row. */}
          <div style={{
            position:'absolute', left:30, right:54, top:30, bottom:96,
            display:'flex', flexDirection:'row', gap:18,
          }}>
            {/* ─── LEFT: stacked VUs + power ─── */}
            <div style={{
              width:180, display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'space-between', gap:10,
            }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                <VUMeter peakLinear={meterSignalA} channelLabel="A" width={170} height={135} />
                <div style={{ display:'flex', gap:6 }}>
                  <MicroLed on={gainTrimAOn} label="GT" />
                  <MicroLed on={balAOn}      label="BL" />
                  <MicroLed on={grZeroAOn}   label="0" />
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                <VUMeter peakLinear={meterSignalB} channelLabel="B" width={170} height={135} />
                <div style={{ display:'flex', gap:6 }}>
                  <MicroLed on={gainTrimBOn} label="GT" />
                  <MicroLed on={balBOn}      label="BL" />
                  <MicroLed on={grZeroBOn}   label="0" />
                </div>
              </div>

              {/* DETECTOR mode (FB / FF) — Classic = hardware-authentic feedback
                  topology, Modern = feed-forward. Sits in the empty space at
                  the bottom of the left column, matches MODE button styling. */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, marginTop:10 }}>
                <div style={{
                  fontSize:8, color:'#BFBFBF', letterSpacing:1.2,
                  fontFamily:'"Helvetica Neue",Arial,sans-serif', fontWeight:700,
                  textTransform:'uppercase',
                }}>DETECTOR</div>
                <div style={{
                  display:'grid', gridTemplateColumns:'1fr 1fr', gap:4,
                  width:106, pointerEvents:'auto',
                }}>
                  {[
                    { label:'CLASSIC', val:true  },
                    { label:'MODERN',  val:false },
                  ].map(({ label, val }) => {
                    const active = fb === val;
                    return (
                      <button key={label} type="button"
                        onClick={(e) => { e.stopPropagation(); edit(setFb)(val); }}
                        style={{
                          fontSize:8, fontFamily:'"Helvetica Neue",Arial,sans-serif',
                          fontWeight: label === 'MODERN' ? 900 : 800, letterSpacing:0.9,
                          background: active ? COL.active : '#1A1A1A',
                          color:      active ? '#000'     : '#F2F2F2',
                          border:`1px solid ${active ? COL.active : '#3A3A3A'}`,
                          boxShadow: active ? `0 0 4px ${COL.active}88` : 'none',
                          borderRadius:2, padding:'4px 0', cursor:'pointer',
                          textAlign:'center', pointerEvents:'auto',
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ─── MIDDLE: two stacked channel rows ─── */}
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
              {/* CH A row */}
              <div style={{ flex:1, display:'flex', flexDirection:'row',
                            alignItems:'center', justifyContent:'space-around', gap:14 }}>
                <Col title="MTR MODE" channel="A" w={104}>
                  <ChickenHead positions={MTR_POSITIONS} selectedIndex={mtrAIdx}
                    onChange={(i) => setMeterA(MTR_POSITIONS[i])}
                    size={72} sweepDeg={80} startDeg={-40}
                    unique="mtrA" labelSize={9} />
                </Col>
                <Col title="INPUT" channel="A" side={sideA} w={120} primary>
                  <SkirtKnob paramValue={inA} paramMin={-12} paramMax={24}
                    onChange={edit(setInA)} scaleMin={0} scaleMax={20} scaleStep={4}
                    size={104} unique="inA" />
                </Col>
                <Col title="THRESH" channel="A" w={120} primary>
                  <SkirtKnob paramValue={thA} paramMin={0} paramMax={1}
                    onChange={edit(setThA)} scaleMin={0} scaleMax={10} scaleStep={2}
                    size={104} unique="thA" />
                </Col>
                <Col title="TIME CONST" channel="A" w={124} primary>
                  <ChickenHead positions={TC_POSITIONS} selectedIndex={tcAIdx}
                    onChange={(i) => edit(setTcA)(TC_POSITIONS[i])}
                    size={108} sweepDeg={260} startDeg={-130}
                    unique="tcA" labelSize={9} labelDistance={0.95} />
                </Col>
                <Col title="DC THR" channel="A" w={100}>
                  <SkirtKnob paramValue={dcA} paramMin={0} paramMax={1}
                    onChange={edit(setDcA)} scaleMin={0} scaleMax={10} scaleStep={2}
                    size={80} unique="dcA" />
                </Col>
                <Col title="VAR ATK" channel="A" w={92}>
                  <VarKnob paramValue={varAtkA} onChange={edit(setVarAtkA)}
                    disabled={!isVarTc(tcA)} unique="vAtkA" size={68} />
                </Col>
                <Col title="VAR REL" channel="A" w={92}>
                  <VarKnob paramValue={varRelA} onChange={edit(setVarRelA)}
                    disabled={!isVarTc(tcA)} unique="vRelA" size={68} />
                </Col>
              </div>

              {/* divider — bright orange hairline + soft glow, separates channels */}
              <div style={{
                height:2, margin:'4px 0',
                background:`linear-gradient(to right, transparent 0%, ${COL.vuGlow} 12%, ${COL.vuGlow} 88%, transparent 100%)`,
                boxShadow:`0 0 6px ${COL.vuGlow}55`,
                borderRadius:1,
              }} />

              {/* CH B row */}
              <div style={{ flex:1, display:'flex', flexDirection:'row',
                            alignItems:'center', justifyContent:'space-around', gap:14 }}>
                <Col title="MTR MODE" channel="B" w={104}>
                  <ChickenHead positions={MTR_POSITIONS} selectedIndex={mtrBIdx}
                    onChange={(i) => setMeterB(MTR_POSITIONS[i])}
                    size={72} sweepDeg={80} startDeg={-40}
                    unique="mtrB" labelSize={9} />
                </Col>
                <Col title="INPUT" channel="B" side={sideB} w={120} primary>
                  <SkirtKnob paramValue={inB} paramMin={-12} paramMax={24}
                    onChange={edit(setInB)} scaleMin={0} scaleMax={20} scaleStep={4}
                    size={104} unique="inB" />
                </Col>
                <Col title="THRESH" channel="B" w={120} primary>
                  <SkirtKnob paramValue={thB} paramMin={0} paramMax={1}
                    onChange={edit(setThB)} scaleMin={0} scaleMax={10} scaleStep={2}
                    size={104} unique="thB" />
                </Col>
                <Col title="TIME CONST" channel="B" w={124} primary>
                  <ChickenHead positions={TC_POSITIONS} selectedIndex={tcBIdx}
                    onChange={(i) => edit(setTcB)(TC_POSITIONS[i])}
                    size={108} sweepDeg={260} startDeg={-130}
                    unique="tcB" labelSize={9} labelDistance={0.95} />
                </Col>
                <Col title="DC THR" channel="B" w={100}>
                  <SkirtKnob paramValue={dcB} paramMin={0} paramMax={1}
                    onChange={edit(setDcB)} scaleMin={0} scaleMax={10} scaleStep={2}
                    size={80} unique="dcB" />
                </Col>
                <Col title="VAR ATK" channel="B" w={92}>
                  <VarKnob paramValue={varAtkB} onChange={edit(setVarAtkB)}
                    disabled={!isVarTc(tcB)} unique="vAtkB" size={68} />
                </Col>
                <Col title="VAR REL" channel="B" w={92}>
                  <VarKnob paramValue={varRelB} onChange={edit(setVarRelB)}
                    disabled={!isVarTc(tcB)} unique="vRelB" size={68} />
                </Col>
              </div>
            </div>

            {/* ─── RIGHT: global column (MODE + SC) ─── */}
            {/* Lofi-Loofy precedent: decorative overlays (branding row,
                corner screws, rail gradients) were winning hit-tests over
                the controls even with pointerEvents:'none' because of
                their stacking. Force this column into its own elevated
                stacking context so MODE/BYPASS/SC always win the click. */}
            <div style={{
              width:140, display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'space-around', gap:14,
              borderLeft:`1px solid #2A2A2A`, paddingLeft:12, paddingRight:6,
              boxSizing:'border-box',
              position:'relative', zIndex:50,
            }}>
              <Col title="MODE" w={120} primary>
                {/* 2x2 button grid — orange-active state matches COL.active
                    (#FFA040), the chassis's accent colour used by the
                    chicken-head selectors. Explicit pointerEvents:auto and
                    type="button" so the click handler always fires. */}
                <div style={{
                  display:'grid', gridTemplateColumns:'1fr 1fr', gap:6,
                  width:120, pointerEvents:'auto',
                }}>
                  {MODE_POSITIONS.map((mode, i) => {
                    const active = chanMode === mode;
                    const fire = (e) => { e.preventDefault(); e.stopPropagation(); edit(setChanMode)(mode); };
                    return (
                      <button key={mode} type="button"
                        onMouseDown={fire}
                        onTouchStart={fire}
                        onClick={(e) => { e.stopPropagation(); }}
                        style={{
                          fontSize:11, fontFamily:'"Helvetica Neue",Arial,sans-serif',
                          fontWeight:800, letterSpacing:1.2,
                          background: active ? COL.active : '#1A1A1A',
                          color:      active ? '#000'     : '#F2F2F2',
                          border:`1px solid ${active ? COL.active : '#3A3A3A'}`,
                          boxShadow: active ? `0 0 6px ${COL.active}88` : 'none',
                          borderRadius:3, padding:'8px 0', cursor:'pointer',
                          textAlign:'center', pointerEvents:'auto',
                        }}>
                        {MODE_LABELS[i]}
                      </button>
                    );
                  })}
                </div>
              </Col>
              {/* BYPASS — sits above SIDECHAIN in the right global column */}
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <button onClick={() => edit(setBypass)(!bypass)}
                  style={{
                    fontSize:10, fontFamily:'"Helvetica Neue",Arial,sans-serif',
                    fontWeight:800, letterSpacing:1.2,
                    background: bypass ? COL.textRed : '#1A1A1A',
                    color: bypass ? '#000' : '#F2F2F2',
                    border:`1px solid ${bypass ? COL.textRed : '#3A3A3A'}`,
                    borderRadius:3, padding:'5px 14px', cursor:'pointer',
                  }}>
                  {bypass ? 'BYPASSED' : 'BYPASS'}
                </button>
                <RedLamp on={bypass} />
              </div>

              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                <div style={{
                  fontSize:13, color:'#F2F2F2', letterSpacing:2,
                  fontFamily:'"Helvetica Neue", Arial, sans-serif',
                  fontWeight:800, textTransform:'uppercase',
                  textShadow:'0 1px 2px rgba(0,0,0,0.9)',
                }}>
                  SIDECHAIN
                </div>
                <div style={{ display:'flex', gap:16 }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                    <span style={{ fontSize:13, color:'#FF5050', fontFamily:'"Helvetica Neue", Arial, sans-serif', fontWeight:900 }}>A</span>
                    <SCToggle on={scA} onChange={edit(setScA)} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                    <span style={{ fontSize:13, color:'#FF5050', fontFamily:'"Helvetica Neue", Arial, sans-serif', fontWeight:900 }}>B</span>
                    <SCToggle on={scB} onChange={edit(setScB)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hidden host controls (preset + remove + ready indicator) ──
          zIndex:100 is REQUIRED: the outer rack wrapper in main.jsx
          renders InfoIcon (zIndex:20) at top-left and QcPanel (zIndex:20)
          at top-right of every orb. Without this lift, the QcPanel
          badge sits on top of our ✕ button and swallows clicks.
          See button_click_fix.md — "Orb top-bar rule". */}
      <div style={{
        position:'absolute', top:10, left:38, right:56,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        pointerEvents:'none', zIndex:100,
      }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', pointerEvents:'auto' }}>
          <select
            value={character || ''}
            onChange={e => { if (e.target.value) applyCharacter(e.target.value); }}
            style={{
              fontSize:9, fontFamily:'monospace',
              background:'#1A1A1A', color:COL.text,
              border:`1px solid #2A2A2A`, borderRadius:2, padding:'1px 6px',
              cursor:'pointer',
            }}>
            <option value="" style={{ background:'#1A1A1A', color:'#F0ECE0' }}>— preset —</option>
            {presets && Object.keys(presets).map(n => (
              <option key={n} value={n} style={{ background:'#1A1A1A', color:'#F0ECE0' }}>{n}</option>
            ))}
          </select>
        </div>
        <div style={{ display:'flex', gap:14, alignItems:'center', pointerEvents:'auto' }}>
          <span style={{ fontSize:8, color: ready ? '#3A8A3A' : '#7A3A3A',
                         fontFamily:'monospace', letterSpacing:1 }}>
            {ready ? '● READY' : '○ INIT'}
          </span>
          {/* (BYPASS lives in the gain-stage strip — single source of truth) */}
          {onRemove && (
            <button type="button"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
                    onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
                    onClick={(e) => { e.stopPropagation(); }}
                    style={{
                      fontSize:9, fontFamily:'monospace',
                      background:'#1A1A1A', color:COL.textRed,
                      border:`1px solid ${COL.textRed}`, borderRadius:2,
                      padding:'2px 6px', cursor:'pointer',
                    }}>✕</button>
          )}
        </div>
      </div>
    </div>
  );
}
