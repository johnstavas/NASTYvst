// NeveOrb.jsx — 1073 Neve-style warm analog saturation + EQ UI
//
// Aesthetic brief:
//   The real Neve 1073 (and its EQ1979 cousin) lives in a desaturated
//   cool blue-grey chassis. The Drive / INPUT knob is a big red cap.
//   The HPF knob is bright royal blue. The EQ band knobs are machined
//   silver-grey with coloured skirts. That's the palette we're matching.
//
// The fun part — "juicing":
//   As Drive sweeps from 0 → 18 dB the whole module warms up. The panel
//   base hue interpolates from cool blue-grey toward warm amber, the
//   saturation climbs, the Drive knob cap glows hotter (radial bloom +
//   box-shadow halo), and an orange vignette fades in around the edges.
//   At max drive the module looks like it's genuinely overheating — in
//   a GOOD way. It's the visual analogue of what the waveshaper is
//   doing to the signal.
//
// Layout:
//   ┌────────────────────────────── wood trim ──────────────────────────┐
//   │  1073 NEVE PREAMP                                      ON   ×     │
//   ├───────────────────────────────────────────────────────────────────┤
//   │                                                                   │
//   │                         ╔═════════════╗                           │
//   │                         ║  DRIVE (red)║   <— hero knob            │
//   │                         ╚═════════════╝                           │
//   │                                                                   │
//   │    ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                              │
//   │    │ HPF │  │ LOW │  │ MID │  │HIGH │   <— 4 knobs, silver/blue    │
//   │    └─────┘  └─────┘  └─────┘  └─────┘                              │
//   │                                                                   │
//   │   freq chips for HPF / LOW / MID (HIGH is fixed at 12 kHz)        │
//   │                                                                   │
//   │   Output trim slider                                              │
//   │   ClipMeter                                                       │
//   └──────────────────────────── wood trim ────────────────────────────┘

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createNeveEngine } from './neveEngine';
import ClipMeter from './ClipMeter';
import PresetSelector from './PresetSelector';

// ─────────────────────────────────────────────────────────────────────────────
// Palette — Neve grey-blue base, accent caps for the knobs
// ─────────────────────────────────────────────────────────────────────────────
const DRIVE_RED   = 'hsl(358, 72%, 48%)';
const DRIVE_RED_H = 'hsl(8, 88%, 58%)';          // brighter "hot" red for glow
const HPF_BLUE    = 'hsl(212, 78%, 52%)';
const HPF_BLUE_H  = 'hsl(205, 90%, 62%)';
const SILVER_A    = 'hsl(212, 8%, 82%)';
const SILVER_B    = 'hsl(212, 10%, 58%)';
const CREAM       = 'hsl(42, 30%, 92%)';
const INK         = 'hsl(212, 20%, 10%)';

// 1073 switched-frequency positions — exactly like the hardware
const HPF_POSITIONS = [
  { label: 'OFF', hz: 10  },
  { label: '50',  hz: 50  },
  { label: '80',  hz: 80  },
  { label: '160', hz: 160 },
  { label: '300', hz: 300 },
];
const LOW_POSITIONS = [
  { label: '35',  hz: 35  },
  { label: '60',  hz: 60  },
  { label: '110', hz: 110 },
  { label: '220', hz: 220 },
];
const MID_POSITIONS = [
  { label: '.36k', hz: 360  },
  { label: '.7k',  hz: 700  },
  { label: '1.6k', hz: 1600 },
  { label: '3.2k', hz: 3200 },
  { label: '4.8k', hz: 4800 },
  { label: '7.2k', hz: 7200 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Juice helper — the visual drive feedback
// ─────────────────────────────────────────────────────────────────────────────
// driveDb in [0, 18]  →  "juice" parameters for the whole module.
//
// Now that the module lives on the family-standard dark panel (#09090f), the
// juice effect works by OVERLAYING warm accent glow rather than warping the
// whole panel's base hue. The dark background stays put — the drive knob
// glows hotter, a warm radial bloom fades in behind it, a thin amber rim
// creeps along the borders, and the 1073 badge picks up a red-orange heat
// halo. That keeps the module visually consistent with MixBusOrb etc. while
// still delivering the "really juicing the colors" fun the user asked for.
function computeJuice(driveDb) {
  const f = Math.max(0, Math.min(1, driveDb / 18));
  // Ease-out cubic — a little drive juice kicks in fast, the top end asymptotes
  const e = 1 - Math.pow(1 - f, 3);

  return {
    frac: f, ease: e,
    // Drive cap: mild red at rest → screaming hot at max
    driveCap:    `hsl(${358 - 12 * e}, ${72 + 18 * e}%, ${48 + 14 * e}%)`,
    driveGlow:   `hsla(${12 - 10 * e}, 90%, 60%, ${0.15 + 0.75 * e})`,
    // Module-wide halo (box-shadow on the outer frame) — warm bloom
    moduleHalo:  `0 8px ${32 + 40 * e}px ${6 * e}px hsla(20, 90%, 55%, ${0.04 + 0.32 * e})`,
    // Warm inner-glow overlay (a radial gradient that lives ON TOP of the
    // dark panel). Opacity scales with drive so the dark surface stays
    // recognizable at rest and heats visibly as you push drive.
    innerGlowOp: 0.0 + 0.55 * e,
    innerGlowHue: 18 - 8 * e,   // pure orange at rest → red-orange at max
    // Amber rim glow along the inner border of the panel — barely visible
    // at rest, a firm amber frame at max drive.
    rimOp:       0.0 + 0.55 * e,
    // Emboss text accent on the 1073 badge
    badgeGlow:   `0 0 ${2 + 10 * e}px hsla(18, 100%, 60%, ${0.1 + 0.6 * e})`,
    // Color of the "hot" accent on the drive readout
    readoutCol:  `hsl(${18 - 8 * e}, ${60 + 30 * e}%, ${72 + 14 * e}%)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Knob — rotary control with pointer drag
// ─────────────────────────────────────────────────────────────────────────────
// Vertical drag changes the value; shift-drag is fine mode; double-click
// resets to the provided default. The SVG is drawn with a coloured "cap"
// (top disc) and a machined "skirt" (bottom ring), plus an optional glow
// halo for the Drive knob when it's being juiced.
//
// Props:
//   label    — shown above the knob
//   value    — current value
//   min,max  — range
//   default  — double-click reset target
//   onChange — called with the new value
//   size     — pixels
//   cap      — top-disc colour (red for drive, silver for EQ, blue for HPF)
//   glow     — CSS colour for the radial halo behind the knob, or null
//   bipolar  — if true, indicator starts at 12 o'clock when value = (min+max)/2
//   format   — function to render the current value under the knob
// ─────────────────────────────────────────────────────────────────────────────
function Knob({
  label, value, min, max, default: def, onChange,
  size = 56, cap = SILVER_A, capDark = SILVER_B, glow = null, bloom = null,
  bipolar = false, format,
}) {
  const dragRef = useRef(null);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      startY: e.clientY,
      startVal: value,
      fine: e.shiftKey,
    };
    const onMove = (ev) => {
      const d = dragRef.current; if (!d) return;
      const dy = d.startY - ev.clientY;
      const scale = (d.fine || ev.shiftKey) ? 0.0015 : 0.0075;
      const next = Math.max(min, Math.min(max, d.startVal + dy * scale * (max - min)));
      onChange(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [value, min, max, onChange]);

  const onDouble = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (def !== undefined) onChange(def);
  }, [def, onChange]);

  // Map value → knob rotation angle.
  // Pointer sweeps from -135° (full CCW) to +135° (full CW), which gives
  // the classic 270° throw of a real potentiometer.
  const t = bipolar
    ? ((value - (min + max) / 2) / ((max - min) / 2)) * 0.5 + 0.5
    : (value - min) / (max - min);
  const angle = -135 + Math.max(0, Math.min(1, t)) * 270;

  const r = size / 2;
  const capR = r * 0.74;
  const capInnerR = r * 0.60;

  // Arc track: draws a faint grey arc behind, and a coloured arc from
  // the zero position to the current value. For bipolar knobs (EQ gains)
  // the coloured arc grows out from 12 o'clock in either direction.
  const toXY = (ang, rad) => {
    const a = (ang - 90) * Math.PI / 180;
    return [r + Math.cos(a) * rad, r + Math.sin(a) * rad];
  };
  const arcR = r - 3;
  const makeArc = (a1, a2) => {
    const [x1, y1] = toXY(a1, arcR);
    const [x2, y2] = toXY(a2, arcR);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return `M ${x1} ${y1} A ${arcR} ${arcR} 0 ${large} ${sweep} ${x2} ${y2}`;
  };

  const arcStartAng = bipolar ? 0 : -135;       // 0° is top (12 o'clock)
  const arcEndAng   = angle;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 3, userSelect: 'none',
    }}>
      <div style={{
        fontSize: 7, fontWeight: 800, letterSpacing: '0.22em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
      }}>{label}</div>

      <div
        onPointerDown={onPointerDown}
        onDoubleClick={onDouble}
        style={{
          width: size, height: size, position: 'relative',
          cursor: 'ns-resize',
          // Outer halo — only visible when glow is non-null (Drive knob)
          // bloom adds a second wider drop-shadow for the "red lightbulb" effect
          filter: bloom
            ? `drop-shadow(0 0 ${5 + size * 0.14}px ${bloom}) drop-shadow(0 0 ${14 + size * 0.38}px ${bloom})`
            : glow ? `drop-shadow(0 0 ${6 + size * 0.18}px ${glow})` : 'none',
          transition: 'filter 0.12s ease',
        }}
      >
        <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
          {/* Machined steel skirt ring — the outer collar of the knob */}
          <defs>
            <radialGradient id={`skirt-${label}`} cx="50%" cy="38%" r="65%">
              <stop offset="0%"  stopColor="hsla(212, 10%, 40%, 1)" />
              <stop offset="60%" stopColor="hsla(212, 14%, 20%, 1)" />
              <stop offset="100%" stopColor="hsla(212, 18%, 8%, 1)" />
            </radialGradient>
            <radialGradient id={`cap-${label}`} cx="45%" cy="38%" r="70%">
              <stop offset="0%"  stopColor={cap} />
              <stop offset="70%" stopColor={cap} />
              <stop offset="100%" stopColor={capDark} />
            </radialGradient>
          </defs>

          {/* Skirt */}
          <circle cx={r} cy={r} r={r - 1} fill={`url(#skirt-${label})`}
                  stroke="rgba(0,0,0,0.6)" strokeWidth="1" />

          {/* Faint full-sweep track */}
          <path
            d={makeArc(-135, 135)}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          {/* Active value arc */}
          {Math.abs(arcEndAng - arcStartAng) > 0.5 && (
            <path
              d={makeArc(Math.min(arcStartAng, arcEndAng), Math.max(arcStartAng, arcEndAng))}
              stroke={cap}
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
              opacity={0.85}
            />
          )}

          {/* Coloured cap */}
          <circle cx={r} cy={r} r={capR} fill={`url(#cap-${label})`}
                  stroke="rgba(0,0,0,0.5)" strokeWidth="0.8" />

          {/* Inner cap ridge / dished top */}
          <circle cx={r} cy={r} r={capInnerR} fill="none"
                  stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />

          {/* Pointer line — drawn from center out along the current angle */}
          <g transform={`rotate(${angle} ${r} ${r})`}>
            <line
              x1={r} y1={r - capInnerR + 1}
              x2={r} y2={r - r + 2}
              stroke={INK}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* Highlight pip at the tip */}
            <circle cx={r} cy={r - r + 3} r={1.4} fill={CREAM} opacity={0.8} />
          </g>

          {/* Specular highlight on the cap */}
          <ellipse
            cx={r - capR * 0.25} cy={r - capR * 0.35}
            rx={capR * 0.55} ry={capR * 0.25}
            fill="rgba(255,255,255,0.22)"
          />
        </svg>
      </div>

      <div style={{
        fontSize: 9, fontFamily: '"Courier New", monospace',
        fontVariantNumeric: 'tabular-nums',
        color: CREAM, minHeight: 12,
        letterSpacing: '-0.02em',
      }}>
        {format ? format(value) : value.toFixed(1)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chip — freq selector button for switched-frequency rows
// ─────────────────────────────────────────────────────────────────────────────
function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 0,
        padding: '3px 2px',
        fontSize: 8, fontWeight: 700,
        letterSpacing: '0.05em',
        fontFamily: '"Courier New", monospace',
        fontVariantNumeric: 'tabular-nums',
        background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 2,
        color: active ? CREAM : 'rgba(255,255,255,0.4)',
        cursor: 'pointer',
        boxShadow: active ? 'inset 0 0 4px rgba(255,255,255,0.08)' : 'none',
        transition: 'all 0.08s',
      }}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory presets
// ─────────────────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',       drive: 0,  hpfHz: 10,  lowHz: 110, lowGain: 0,  midHz: 1600, midGain: 0,  highGain: 0,  outputTrim: 0  },
  { name: 'WARM VOCAL', drive: 6,  hpfHz: 80,  lowHz: 220, lowGain: -4, midHz: 3200, midGain: 4,  highGain: 2,  outputTrim: -4 },
  { name: 'FAT DRUMS',  drive: 10, hpfHz: 50,  lowHz: 60,  lowGain: 6,  midHz: 1600, midGain: -2, highGain: 4,  outputTrim: -6 },
  { name: 'BRIGHT GTR', drive: 4,  hpfHz: 160, lowHz: 110, lowGain: -2, midHz: 4800, midGain: 3,  highGain: 6,  outputTrim: -3 },
  { name: 'BASS DI',    drive: 3,  hpfHz: 10,  lowHz: 60,  lowGain: 4,  midHz: 700,  midGain: 2,  highGain: -4, outputTrim: -2 },
  { name: 'THICK KEYS', drive: 8,  hpfHz: 80,  lowHz: 110, lowGain: 3,  midHz: 1600, midGain: 0,  highGain: -2, outputTrim: -5 },
  { name: 'PUSH IT',    drive: 14, hpfHz: 80,  lowHz: 110, lowGain: 0,  midHz: 3200, midGain: 2,  highGain: 0,  outputTrim: -7 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main module
// ─────────────────────────────────────────────────────────────────────────────
export default function NeveOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  hotLevel = 0,
}) {
  // ── Parameter state ────────────────────────────────────────────────────────
  const [drive,       setDrive      ] = useState(initialState?.drive       ?? 0);
  const [hpfHz,       setHpfHz      ] = useState(initialState?.hpfHz       ?? 10);   // OFF
  const [lowHz,       setLowHz      ] = useState(initialState?.lowHz       ?? 110);
  const [lowGain,     setLowGain    ] = useState(initialState?.lowGain     ?? 0);
  const [midHz,       setMidHz      ] = useState(initialState?.midHz       ?? 1600);
  const [midGain,     setMidGain    ] = useState(initialState?.midGain     ?? 0);
  const [highGain,    setHighGain   ] = useState(initialState?.highGain    ?? 0);
  const [outputTrim,  setOutputTrim ] = useState(initialState?.outputTrim  ?? 0);
  const [bypassed,    setBypassed   ] = useState(initialState?.bypassed    ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? 'INIT');

  // ── Metering state ─────────────────────────────────────────────────────────
  const [inLevel,  setInLevel ] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak  ] = useState(0);
  const [outPeak,  setOutPeak ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  // Refs so the engine init useEffect can read the latest state without
  // depending on it (avoids re-creating the engine on every param change).
  const stateRefs = {
    drive:      useRef(drive),      hpfHz:      useRef(hpfHz),
    lowHz:      useRef(lowHz),      lowGain:    useRef(lowGain),
    midHz:      useRef(midHz),      midGain:    useRef(midGain),
    highGain:   useRef(highGain),   outputTrim: useRef(outputTrim),
    bypassed:   useRef(bypassed),
  };
  stateRefs.drive.current      = drive;
  stateRefs.hpfHz.current      = hpfHz;
  stateRefs.lowHz.current      = lowHz;
  stateRefs.lowGain.current    = lowGain;
  stateRefs.midHz.current      = midHz;
  stateRefs.midGain.current    = midGain;
  stateRefs.highGain.current   = highGain;
  stateRefs.outputTrim.current = outputTrim;
  stateRefs.bypassed.current   = bypassed;

  // ── Engine lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createNeveEngine(sharedSource.ctx);
    engineRef.current = engine;

    // Push initial state into the engine before registering so the first
    // frame of audio through the chain reflects the user's saved params.
    engine.setDrive(stateRefs.drive.current);
    engine.setHpfFreq(stateRefs.hpfHz.current);
    engine.setLowFreq(stateRefs.lowHz.current);
    engine.setLowGain(stateRefs.lowGain.current);
    engine.setMidFreq(stateRefs.midHz.current);
    engine.setMidGain(stateRefs.midGain.current);
    engine.setHighGain(stateRefs.highGain.current);
    engine.setOutputTrim(stateRefs.outputTrim.current);
    engine.setBypass(stateRefs.bypassed.current);

    registerEngine(instanceId, engine);

    // Level-meter loop at ~30 fps (every other RAF frame)
    let tick = 0;
    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      if (++tick % 2 !== 0) return;
      const e = engineRef.current; if (!e) return;
      setInLevel(e.getInputLevel());
      setOutLevel(e.getOutputLevel());
      setInPeak(e.getInputPeak());
      setOutPeak(e.getOutputPeak());
    };
    loop();

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Param → engine bridge effects
  useEffect(() => { engineRef.current?.setDrive(drive);           }, [drive]);
  useEffect(() => { engineRef.current?.setHpfFreq(hpfHz);         }, [hpfHz]);
  useEffect(() => { engineRef.current?.setLowFreq(lowHz);         }, [lowHz]);
  useEffect(() => { engineRef.current?.setLowGain(lowGain);       }, [lowGain]);
  useEffect(() => { engineRef.current?.setMidFreq(midHz);         }, [midHz]);
  useEffect(() => { engineRef.current?.setMidGain(midGain);       }, [midGain]);
  useEffect(() => { engineRef.current?.setHighGain(highGain);     }, [highGain]);
  useEffect(() => { engineRef.current?.setOutputTrim(outputTrim); }, [outputTrim]);
  useEffect(() => { engineRef.current?.setBypass(bypassed);       }, [bypassed]);

  // Persist state for master-preset save/load
  useEffect(() => {
    onStateChange?.(instanceId, {
      drive, hpfHz, lowHz, lowGain, midHz, midGain, highGain, outputTrim, bypassed,
      preset: activePreset,
    });
  }, [drive, hpfHz, lowHz, lowGain, midHz, midGain, highGain, outputTrim, bypassed, activePreset]);
  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drive → Out auto-compensation ──────────────────────────────────────────
  // When you crank Drive, the Output Trim slider visibly slides DOWN by the
  // *effective* post-shaper gain so the net level through the module stays
  // flat and the user can literally see the makeup happening on the panel.
  //
  // The naive thing is to compensate 1:1 (subtract exactly `drive` dB from
  // Out), but the tanh soft-limiter in the waveshaper squashes peaks more
  // and more as you push into it. The effective post-shaper gain for a
  // signal of typical headroom x̂ pre-gained by A = 10^(d/20) follows an
  // analytic soft-clip curve:
  //
  //   effLin(A) = A / √(1 + (A · k)²)
  //
  // where k is the "typical peak headroom" of the signal (≈ 0.42 for music
  // content with -6 dBFS peaks). This is the closed-form soft-clipper gain
  // from filter theory — it's what tanh approximates in the audio band, so
  // it matches the actual shaper behaviour much better than a quadratic fit.
  //
  // Sampled values against the current curve + pre/de-emphasis stack
  // (k=0.38, calibrated so the output meter stays within ~1 dB of its rest
  // level across the entire drive sweep on typical music content):
  //
  //     drive  →  effGain (dB)   what Out slides to
  //       0    →   0.00           0.0
  //       3    →   1.90          −1.90
  //       6    →   4.03          −4.03
  //       9    →   5.68          −5.68
  //      12    →   6.82          −6.82
  //      15    →   7.55          −7.55
  //      18    →   7.95          −7.95
  //
  // The curve is very close to 1:1 at low drive (where the shaper is still
  // in its linear region) and asymptotes toward the hard-limit ceiling at
  // the top. The constant k is the one tuning knob — bigger k means the
  // compensation asymptotes lower (Out slides down less at high drive),
  // smaller k means closer to raw-dB compensation. 0.38 matches the tanh
  // squash of the curve in neveEngine.js on typical -6 dBFS-peak material.
  const SATURATION_K = 0.38;
  const compensationDb = (d) => {
    if (d <= 0) return 0;
    const A      = Math.pow(10, d / 20);
    const Ak     = A * SATURATION_K;
    const effLin = A / Math.sqrt(1 + Ak * Ak);
    return 20 * Math.log10(Math.max(1, effLin));
  };

  // Track the last-seen drive value in a ref (NOT state) so we compute clean
  // deltas during rapid pointer drags — the Knob's drag closure is captured
  // at pointerdown and won't see state updates mid-drag, but a ref is always
  // current.
  const lastDriveRef = useRef(drive);
  const OUT_MIN = -24, OUT_MAX = 12;
  const handleDriveChange = useCallback((newDrive) => {
    const compOld = compensationDb(lastDriveRef.current);
    const compNew = compensationDb(newDrive);
    const delta   = compNew - compOld;
    lastDriveRef.current = newDrive;
    setDrive(newDrive);
    setOutputTrim(t => Math.max(OUT_MIN, Math.min(OUT_MAX, t - delta)));
    setActivePreset(null);
  }, []);

  // ── Reset-all — restore every parameter to its factory default ───────────
  const resetAll = useCallback(() => {
    setDrive(0);
    setHpfHz(10);        // OFF
    setLowHz(110);
    setLowGain(0);
    setMidHz(1600);
    setMidGain(0);
    setHighGain(0);
    setOutputTrim(0);
    setBypassed(false);
    lastDriveRef.current = 0;
    setActivePreset('INIT');
  }, []);

  // ── Load preset — set all params directly (bypasses handleDriveChange) ──
  const loadPreset = useCallback((preset) => {
    setDrive(preset.drive);
    setHpfHz(preset.hpfHz);
    setLowHz(preset.lowHz);
    setLowGain(preset.lowGain);
    setMidHz(preset.midHz);
    setMidGain(preset.midGain);
    setHighGain(preset.highGain);
    setOutputTrim(preset.outputTrim);
    lastDriveRef.current = preset.drive;
    setActivePreset(preset.name);
  }, []);

  // ── Juice — drive-reactive visual state ────────────────────────────────────
  const juice = computeJuice(drive);

  // ── Hot-signal Drive knob lightbulb glow ───────────────────────────────────
  // hotLevel: 0=cool, 1=amber (near clip), 2=red (clipping)
  // Blends on top of the drive-position glow so the knob lights up like a
  // red incandescent bulb when the signal pushes into saturation.
  const hotGlow = hotLevel === 2
    ? `hsla(4, 95%, 55%, 0.95)`   // screaming red — actively clipping
    : hotLevel === 1
    ? `hsla(32, 92%, 54%, 0.70)`  // amber warmth — approaching clip
    : null;
  // When hot: bloom replaces glow (two-layer lightbulb effect).
  // When cool: drive-position juice.driveGlow handles the knob halo as normal.

  // HPF knob position: use the index of the current HPF band as the value,
  // then snap it on commit. The Knob component is continuous, so we map
  // its value → nearest HPF_POSITIONS index.
  const hpfIdx = Math.max(0, HPF_POSITIONS.findIndex(p => p.hz === hpfHz));
  const onHpfKnob = (v) => {
    const i = Math.round(Math.max(0, Math.min(HPF_POSITIONS.length - 1, v)));
    const next = HPF_POSITIONS[i].hz;
    if (next !== hpfHz) { setHpfHz(next); setActivePreset(null); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: 360,
      fontFamily: 'sans-serif',
      userSelect: 'none',
      borderRadius: 6,
      overflow: 'hidden',
      // Dark slate blue-grey — a nod to the real BAE 1073D chassis while
      // staying dark enough to sit cleanly next to MixBusOrb et al. The
      // subtle top→bottom gradient gives the panel a very gentle beveled
      // feel (lighter at the top, darker toward the bottom) like real
      // anodised steel catching overhead room light.
      background: `linear-gradient(180deg,
        hsl(212, 14%, 22%) 0%,
        hsl(212, 15%, 17%) 50%,
        hsl(212, 16%, 12%) 100%)`,
      boxShadow: `${juice.moduleHalo}, 0 8px 48px rgba(0,0,0,0.9)`,
      border: '1px solid rgba(255,255,255,0.06)',
      transition: 'box-shadow 0.12s linear',
      position: 'relative',
    }}>

      {/* Main panel — dark slate surface */}
      <div style={{ position: 'relative' }}>

        {/* Warm inner-glow overlay — sits ON TOP of the dark panel and
            fades in with drive. At rest this is invisible (op = 0); at
            max drive it's a substantial orange bloom centered on the
            Drive knob. mix-blend-mode: screen so it lifts the dark base
            rather than muddying it. */}
        <div style={{
          position: 'absolute', inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(ellipse at 50% 28%,
            hsla(${juice.innerGlowHue}, 95%, 50%, ${juice.innerGlowOp * 0.5}) 0%,
            hsla(${juice.innerGlowHue}, 90%, 45%, ${juice.innerGlowOp * 0.22}) 30%,
            transparent 70%)`,
          mixBlendMode: 'screen',
          transition: 'background 0.12s linear',
          zIndex: 0,
        }} />

        {/* Amber rim glow — inset box-shadow pretending to be a beveled
            edge heating up. Invisible at rest, visible amber frame at max. */}
        <div style={{
          position: 'absolute', inset: 0,
          pointerEvents: 'none',
          boxShadow: `inset 0 0 ${6 + 14 * juice.ease}px hsla(20, 95%, 55%, ${juice.rimOp * 0.35})`,
          transition: 'box-shadow 0.12s linear',
          zIndex: 0,
        }} />

        {/* Header — brand badge + bypass + close */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: '6px 10px 5px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 900,
              color: CREAM,
              letterSpacing: '0.14em',
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic',
              textShadow: juice.badgeGlow,
              transition: 'text-shadow 0.12s linear',
            }}>1073</span>
            <span style={{
              fontSize: 7, color: 'rgba(255,255,255,0.3)',
              letterSpacing: '0.24em', textTransform: 'uppercase',
              fontWeight: 700,
            }}>Neve Preamp</span>
          </div>

          <PresetSelector
            presets={PRESETS}
            activePreset={activePreset}
            onSelect={loadPreset}
            colors={{
              bg: 'rgba(255,255,255,0.08)',
              text: 'hsl(42, 30%, 92%)',
              textDim: 'rgba(255,255,255,0.4)',
              border: 'rgba(255,255,255,0.15)',
              hoverBg: 'rgba(255,255,255,0.12)',
              activeBg: 'rgba(255,255,255,0.08)',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setBypassed(b => !b)}
              style={{
                fontSize: 8, fontWeight: 800, padding: '2px 6px',
                borderRadius: 2, cursor: 'pointer',
                letterSpacing: '0.1em',
                ...(bypassed
                  ? { background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.55)' }
                  : { background: DRIVE_RED, border: '1px solid rgba(0,0,0,0.6)', color: CREAM, boxShadow: '0 0 4px rgba(255,60,30,0.5)' })
              }}
            >{bypassed ? 'BYP' : 'ON'}</button>
            <button
              onClick={resetAll}
              title="Reset all knobs to default"
              style={{
                width: 18, height: 18, borderRadius: '50%',
                background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,0,0,0.5)',
                color: 'rgba(255,255,255,0.55)', fontSize: 11, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}
            >↻</button>
            <button
              onClick={onRemove}
              disabled={!onRemove}
              title={onRemove ? 'Remove from chain' : 'Cannot remove — this is the last module'}
              style={{
                width: 18, height: 18, borderRadius: '50%',
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(0,0,0,0.5)',
                color: onRemove ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)',
                fontSize: 12, cursor: onRemove ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        </div>

        {/* Hero row — big Drive knob, centered */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'flex', justifyContent: 'center',
          padding: '14px 0 10px',
        }}>
          <Knob
            label="Drive"
            value={drive}
            min={0} max={18} default={0}
            onChange={handleDriveChange}
            size={78}
            cap={juice.driveCap}
            capDark={`hsl(0, 60%, 22%)`}
            glow={hotGlow ? null : juice.driveGlow}
            bloom={hotGlow}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
          />
        </div>

        {/* EQ knob row — HPF (blue), Low (silver), Mid (silver), High (silver) */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          padding: '4px 10px 10px',
          gap: 4,
        }}>
          <Knob
            label="HPF"
            value={hpfIdx}
            min={0} max={HPF_POSITIONS.length - 1} default={0}
            onChange={onHpfKnob}
            size={52}
            cap={HPF_BLUE_H}
            capDark={'hsl(212, 70%, 22%)'}
            format={() => HPF_POSITIONS[hpfIdx].label}
          />
          <Knob
            label="Low"
            value={lowGain}
            min={-16} max={16} default={0}
            onChange={(v) => { setLowGain(v); setActivePreset(null); }}
            size={52}
            cap={SILVER_A}
            capDark={SILVER_B}
            bipolar
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
          />
          <Knob
            label="Mid"
            value={midGain}
            min={-16} max={16} default={0}
            onChange={(v) => { setMidGain(v); setActivePreset(null); }}
            size={52}
            cap={SILVER_A}
            capDark={SILVER_B}
            bipolar
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
          />
          <Knob
            label="High"
            value={highGain}
            min={-18} max={18} default={0}
            onChange={(v) => { setHighGain(v); setActivePreset(null); }}
            size={52}
            cap={SILVER_A}
            capDark={SILVER_B}
            bipolar
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
          />
        </div>

        {/* Freq chip rows — LOW and MID have selectable frequencies.
            HPF is already on its own knob above, HIGH is fixed at 12 kHz.
            We split into two labelled columns so the chips read cleanly. */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 6, padding: '2px 10px 8px',
        }}>
          <div>
            <div style={{
              fontSize: 6, fontWeight: 800, letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.3)', marginBottom: 3,
            }}>Low Hz</div>
            <div style={{ display: 'flex', gap: 3 }}>
              {LOW_POSITIONS.map(p => (
                <Chip key={p.label} label={p.label} active={lowHz === p.hz} onClick={() => { setLowHz(p.hz); setActivePreset(null); }} />
              ))}
            </div>
          </div>
          <div>
            <div style={{
              fontSize: 6, fontWeight: 800, letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.3)', marginBottom: 3,
            }}>Mid Hz</div>
            <div style={{ display: 'flex', gap: 3 }}>
              {MID_POSITIONS.map(p => (
                <Chip key={p.label} label={p.label} active={midHz === p.hz} onClick={() => { setMidHz(p.hz); setActivePreset(null); }} />
              ))}
            </div>
          </div>
        </div>

        {/* Output trim knob — attenuates the signal coming OUT of the
            output transformer stage. This is what "Trim" means on a real
            1073: a post-iron fine level control. Visibly drops as Drive
            goes up, so users can see the makeup compensation rather than
            it being hidden. See handleDriveChange + compensationDb above. */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'flex', justifyContent: 'center',
          padding: '10px 0 14px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(0,0,0,0.25)',
        }}>
          <Knob
            label="Trim"
            value={outputTrim}
            min={-24} max={12} default={0}
            onChange={(v) => { setOutputTrim(v); setActivePreset(null); }}
            size={58}
            cap={SILVER_A}
            capDark={SILVER_B}
            bipolar
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
          />
        </div>
      </div>

      {/* Clip meter — matches every other module */}
      <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />
    </div>
  );
}
