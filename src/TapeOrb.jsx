// TapeOrb.jsx — Tascam 424 / 244 Portastudio "tape preamp" UI
//
// Faithful to the 424 schematic: 4 audio controls (INPUT, BASS, TREBLE,
// VOLUME) plus two extra "tape mechanism" sliders (WOW/FLUT, HISS) for
// the cassette vibe the user originally asked for.
//
// Layout:
//   ┌──────────────── (dark slate panel) ────────────────┐
//   │  TASCAM 424     PORTASTUDIO            ON   ×       │
//   │   ╭─VU─╮                              [reels]       │
//   │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                  │
//   │  │INPUT│  │BASS │  │TREB │  │VOL  │                  │
//   │  │ red │  │ yel │  │ yel │  │ wht │                  │
//   │  └─────┘  └─────┘  └─────┘  └─────┘                  │
//   │                                                      │
//   │  WOW/FLUT [───────●─]    HISS [─●───────]            │
//   │                                                      │
//   │  ──────── ClipMeter ────────                        │
//   └─────────────────────────────────────────────────────┘
//
// Aesthetic: dark slate panel matching Neve / MixBus family. The 244's
// signature multi-coloured knob caps live in the four hero knobs:
//   • INPUT  = red    (the "Trim" pot — drive control)
//   • BASS   = yellow (matches the EQ row on the real unit)
//   • TREBLE = yellow
//   • VOLUME = white  (master, also where the visible auto-comp lives)
//
// Drive juice effect: as INPUT climbs, the panel picks up a warm orange
// inner glow and the spinning tape reels speed up, just like how the real
// hardware feels "alive" when you push it.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createTapeEngine } from './tapeEngine';
import ClipMeter from './ClipMeter';
import PresetSelector from './PresetSelector';

// ─────────────────────────────────────────────────────────────────────────────
// Palette — Tascam 244 multi-coloured knob caps
// ─────────────────────────────────────────────────────────────────────────────
// The 244's visual signature is a vertical rainbow of caps per channel strip:
// red → orange → yellow → green → blue (top to bottom). We use four of those
// colours for our four hero knobs to evoke the unit at a glance.
const INPUT_RED    = 'hsl(358, 72%, 48%)';
const INPUT_RED_D  = 'hsl(0, 60%, 22%)';
const EQ_ORANGE    = 'hsl(28, 92%, 54%)';
const EQ_ORANGE_D  = 'hsl(20, 70%, 28%)';
const EQ_GREEN     = 'hsl(110, 58%, 42%)';
const EQ_GREEN_D   = 'hsl(120, 50%, 18%)';
const VOL_BLUE     = 'hsl(208, 72%, 52%)';
const VOL_BLUE_D   = 'hsl(212, 60%, 22%)';
const SILVER_A     = 'hsl(212, 8%, 82%)';
const SILVER_B     = 'hsl(212, 10%, 58%)';
const CREAM        = 'hsl(42, 30%, 92%)';
const INK          = 'hsl(212, 20%, 10%)';
const TASCAM_RED   = 'hsl(8, 92%, 52%)';

// ─────────────────────────────────────────────────────────────────────────────
// Juice helper — drive-reactive visual state
// ─────────────────────────────────────────────────────────────────────────────
// The panel itself stays NEUTRAL no matter how hard you push — no orange
// halo, no rim glow, no breathing bloom. The only visible drive feedback
// lives in the VU meters (which redden as you push) and the tape reels
// (which spin faster). That keeps the panel calm and lets the meters do
// the work.
function computeJuice(driveDb) {
  const f = Math.max(0, Math.min(1, driveDb / 18));
  const e = 1 - Math.pow(1 - f, 3);
  return {
    frac: f, ease: e,
    // Tape reel spin period in seconds. At rest 6s/rev (slow drift), at full
    // drive 1.2s/rev (fast spin) — gives a fun "loading up the tape" feel.
    reelPeriod:  6 - 4.8 * e,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Knob — Caelum-style dark cap with a colored ring arc on the outside
// ─────────────────────────────────────────────────────────────────────────────
// Layout:
//   ┌─── value ───┐   ← number above (white, monospace)
//   │     ╭─╮     │
//   │    ╱ • ╲    │   ← dark cap with subtle indicator dot
//   │   ╲     ╱   │     surrounded by a colored ring arc
//   │     ╰─╯     │     (filled portion = current value)
//   │  · LABEL ·  │   ← label below (white, small caps)
//   └─────────────┘
//
// The colored ring is the visible state — the indicator dot is just a hint
// of where the knob is "pointing". This is the modern flat-VST style used
// by Caelum, Baby Audio, Soundtoys etc., and it photographs beautifully on
// a dark atmospheric panel.
function Knob({
  label, value, min, max, default: def, onChange,
  size = 56, ringColor = 'hsl(28, 92%, 54%)',
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

  // Normalized value 0..1; for bipolar knobs we still map linearly so the
  // ring arc grows from 12 o'clock either left or right.
  const t = (value - min) / (max - min);
  const angle = -135 + Math.max(0, Math.min(1, t)) * 270;

  const r       = size / 2;
  const ringR   = r - 3;            // arc radius
  const capR    = r * 0.66;         // dark cap radius

  const toXY = (ang, rad) => {
    const a = (ang - 90) * Math.PI / 180;
    return [r + Math.cos(a) * rad, r + Math.sin(a) * rad];
  };
  const makeArc = (a1, a2) => {
    if (Math.abs(a2 - a1) < 0.5) return '';
    const [x1, y1] = toXY(a1, ringR);
    const [x2, y2] = toXY(a2, ringR);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return `M ${x1} ${y1} A ${ringR} ${ringR} 0 ${large} ${sweep} ${x2} ${y2}`;
  };

  // For bipolar knobs the ring fills FROM CENTER outward (12 o'clock = 0).
  // For unipolar knobs the ring fills from the start (-135°) to angle.
  const fullStart = -135, fullEnd = 135, center = 0;
  const filledStart = bipolar ? center           : fullStart;
  const filledEnd   = bipolar ? angle            : angle;
  const lo = Math.min(filledStart, filledEnd);
  const hi = Math.max(filledStart, filledEnd);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 4, userSelect: 'none',
    }}>
      {/* Value number — sits ABOVE the knob, big and clear */}
      <div style={{
        fontSize: 7.5, fontFamily: '"Inter", "Helvetica Neue", sans-serif',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        color: 'rgba(255,255,255,0.85)', minHeight: 12,
        letterSpacing: '-0.01em',
      }}>
        {format ? format(value) : value.toFixed(1)}
      </div>

      <div
        onPointerDown={onPointerDown}
        onDoubleClick={onDouble}
        style={{
          width: size, height: size, position: 'relative',
          cursor: 'ns-resize',
        }}
      >
        <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            {/* Subtle 3D dome on the dark cap so it doesn't read as a flat circle */}
            <radialGradient id={`tape-cap-${label}`} cx="42%" cy="38%" r="78%">
              <stop offset="0%"  stopColor="hsl(220, 14%, 24%)" />
              <stop offset="55%" stopColor="hsl(220, 18%, 14%)" />
              <stop offset="100%" stopColor="hsl(220, 22%, 6%)" />
            </radialGradient>
          </defs>

          {/* Background ring track (full 270° sweep, very dim) */}
          <path
            d={makeArc(fullStart, fullEnd)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />

          {/* Filled portion of the ring — colored, with a soft glow */}
          {hi - lo > 0.5 && (
            <>
              <path
                d={makeArc(lo, hi)}
                stroke={ringColor}
                strokeWidth="2.6"
                strokeLinecap="round"
                fill="none"
                opacity="0.95"
                style={{ filter: `drop-shadow(0 0 3px ${ringColor})` }}
              />
            </>
          )}

          {/* Dark cap */}
          <circle
            cx={r} cy={r} r={capR}
            fill={`url(#tape-cap-${label})`}
            stroke="rgba(0,0,0,0.6)"
            strokeWidth="0.8"
          />

          {/* Subtle inner ring for depth */}
          <circle
            cx={r} cy={r} r={capR - 1}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="0.6"
          />

          {/* Indicator dot — small bright dot near the cap edge that shows
              where the knob is "pointing". Less mechanical than a line. */}
          <g transform={`rotate(${angle} ${r} ${r})`}>
            <circle
              cx={r}
              cy={r - capR + 4}
              r={1.6}
              fill={ringColor}
              style={{ filter: `drop-shadow(0 0 2px ${ringColor})` }}
            />
          </g>

          {/* Tiny top highlight for cap dome */}
          <ellipse
            cx={r - capR * 0.2} cy={r - capR * 0.45}
            rx={capR * 0.5} ry={capR * 0.18}
            fill="rgba(255,255,255,0.10)"
          />
        </svg>
      </div>

      {/* Label — sits BELOW the knob, small caps */}
      <div style={{
        fontSize: 7, fontWeight: 700, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
      }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SmallSlider — for the WOW/FLUT and HISS controls (not main signal path)
// ─────────────────────────────────────────────────────────────────────────────
function SmallSlider({ label, value, onChange, min = 0, max = 1, step = 0.01, format }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontSize: 7, fontWeight: 800, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)',
        width: 50, flexShrink: 0,
      }}>{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(0)}
        style={{ flex: 1, accentColor: TASCAM_RED, height: 3, cursor: 'pointer' }}
      />
      <span style={{
        fontSize: 7, color: value > 0 ? CREAM : 'rgba(255,255,255,0.35)',
        width: 32, textAlign: 'right', flexShrink: 0,
        fontFamily: '"Courier New", monospace', fontVariantNumeric: 'tabular-nums',
      }}>
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VuMeter — cream-faced analog VU like the four meters across the top of a 244
// ─────────────────────────────────────────────────────────────────────────────
// True moving-needle style: the needle has its OWN physics state (lag toward
// the audio level) so it sweeps with that recognizable analog VU "lazy then
// snappy" feel instead of jittering frame-by-frame with the raw RMS.
//
//   ┌───────────────────────────┐
//   │ -20 -10 -5 -3   +1 +3 +5  │   ← black tick marks on cream face
//   │   ╲      ╲    │  ▓▓▓▓     │   ← red zone past 0 VU
//   │    ╲      ╲   │  ▓▓       │
//   │     ╲      ╲ ─┴──         │
//   │            ●              │   ← pivot
//   │           VU              │   ← cream label
//   └───────────────────────────┘
function VuMeter({ level, peak, label = 'VU', width = 170, height = 90, drive = 0 }) {
  // ── Drive heat ────────────────────────────────────────────────────────────
  // 0..1 normalized drive amount. As the user pushes INPUT, the meter face
  // backlight warms toward red and the needle picks up a red tint — that's
  // the "VU meters get red when you push it" feedback the user asked for.
  const heat = Math.max(0, Math.min(1, drive / 18));
  // ── Needle physics ────────────────────────────────────────────────────────
  // Real VUs follow a "300 ms to 99% rise" ballistic. We approximate with an
  // asymmetric exponential follower (rises ~2× faster than it falls). Key
  // detail: the smoothing runs every frame, NOT just when level changes,
  // so the needle relaxes back to zero on its own when audio stops.
  const needleRef = useRef(0);
  const [needle, setNeedle] = useState(0);
  const levelRef = useRef(level);
  const peakRef  = useRef(peak);
  levelRef.current = level;
  peakRef.current  = peak;
  useEffect(() => {
    let raf;
    const tick = () => {
      // Drive needle from the same peak value the bottom ClipMeter uses —
      // this keeps top & bottom meters reading the same dB number.
      // Blend in a little RMS so the needle has that classic analog "weight".
      const target = Math.max(peakRef.current * 0.85, levelRef.current * 1.1);
      const cur    = needleRef.current;
      const a      = target > cur ? 0.28 : 0.07;  // fast rise, slow fall (VU ballistic)
      const next   = cur + (target - cur) * a;
      needleRef.current = next;
      setNeedle(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── dBFS mapping — same scale as the bottom ClipMeter ────────────────────
  // needle is a linear amplitude [0..1+]. Convert directly to dBFS.
  // Scale: -20 dBFS (full left) → 0 dBFS (full right), center at -10 dBFS.
  // This means when the bottom bar says "-5.9 dB", the needle points at -5.9.
  const dB     = 20 * Math.log10(Math.max(1e-6, needle));
  const mapped = Math.max(-20, Math.min(0, dB));
  const SWEEP  = 50;
  // Linear: mapped=-20 → angle=-50°,  mapped=-10 → 0°,  mapped=0 → +50°
  const angle  = ((mapped + 10) / 10) * SWEEP;
  const a      = Math.max(-SWEEP - 2, Math.min(SWEEP + 2, angle));

  // ── Geometry (size-relative so the meter scales cleanly) ─────────────────
  // The pivot sits below the visible face but only just — pulling it closer
  // than the old ×0.55 shortens the needle and shrinks the arc's horizontal
  // projection so everything fits inside the wider 184×96 face cleanly.
  const cx        = width / 2;
  const cy        = height * 1.25;
  const needleLen = height * 1.15;
  const needleX   = cx + Math.sin(a * Math.PI / 180) * needleLen;
  const needleY   = cy - Math.cos(a * Math.PI / 180) * needleLen;

  // Tick marks — same dBFS scale as bottom ClipMeter (-20 to 0)
  const ticks = [
    { db: -20, major: true,  label: '20' },
    { db: -15, major: false },
    { db: -10, major: true,  label: '10' },
    { db: -7,  major: false },
    { db: -5,  major: true,  label: '5'  },
    { db: -3,  major: true,  label: '3'  },
    { db: -1,  major: false },
    { db:  0,  major: true,  label: '0'  },
  ];
  // Same linear mapping as the needle: -20→-50°, -10→0°, 0→+50°
  const tickAng = (db) => ((Math.max(-20, Math.min(0, db)) + 10) / 10) * SWEEP;
  const arcR    = needleLen - height * 0.04;
  const arcRIn  = arcR - height * 0.18;
  const arcRTxt = arcRIn - height * 0.13;

  const peaking = dB >= -3;  // needle turns red when signal hits the hot zone (-3 dBFS and above)

  // ── Signal heat color — green → amber → red tracks the needle position ────
  // signalFrac: 0 = -20 dBFS (full left), 1 = 0 dBFS (full right)
  const signalFrac = Math.max(0, Math.min(1, (mapped + 20) / 20));
  // Three-stop color ramp: green (quiet) → amber (warm) → red (hot)
  // Stop 1: 0.0 – 0.55  →  green to yellow-green
  // Stop 2: 0.55 – 0.80  →  yellow-green to amber
  // Stop 3: 0.80 – 1.00  →  amber to red
  let sH, sS, sL, sGlow;
  if (signalFrac <= 0.55) {
    const t = signalFrac / 0.55;
    sH = 42  - t * 6;           // 42° warm white → 36° amber-yellow
    sS = 20  + t * 55;          // near-white (low sat) → saturated amber
    sL = 92  - t * 52;          // bright white → mid amber
    sGlow = `hsla(${sH}, ${sS}%, ${sL + 10}%, ${0.20 + t * 0.30})`;
  } else if (signalFrac <= 0.80) {
    const t = (signalFrac - 0.55) / 0.25;
    sH = 36  - t * 16;          // 36° amber → 20° orange
    sS = 75  + t * 15;
    sL = 40  - t * 4;
    sGlow = `hsla(${sH}, ${sS}%, ${sL + 18}%, ${0.50 + t * 0.25})`;
  } else {
    const t = (signalFrac - 0.80) / 0.20;
    sH = 20  - t * 18;          // 20° orange → 2° red
    sS = 90  + t * 5;
    sL = 36  + t * 4;
    sGlow = `hsla(${sH}, 95%, 60%, ${0.72 + t * 0.23})`;
  }
  const signalColor = `hsl(${sH}, ${sS}%, ${sL}%)`;

  // Bezel / chrome ring sizes (relative)
  const bezelInset = 3;

  return (
    <div style={{
      width, height: height + 14,
      position: 'relative',
      // Outer chrome bezel — the dark ring that surrounds the meter face on
      // every real Tascam unit. Two-tone gradient to simulate brushed metal.
      background: 'linear-gradient(180deg, hsl(220, 8%, 28%) 0%, hsl(220, 12%, 12%) 100%)',
      borderRadius: 5,
      padding: bezelInset,
      boxShadow: `
        inset 0 1px 0 rgba(255,255,255,0.18),
        inset 0 -1px 0 rgba(0,0,0,0.7),
        0 2px 4px rgba(0,0,0,0.6),
        0 0 0 1px rgba(0,0,0,0.7)`,
    }}>
      {/* Inner cream face — backlight reddens with drive */}
      <div style={{
        width: '100%', height: '100%',
        position: 'relative',
        // Curved cream face with a subtle warm backlight gradient that
        // shifts from yellow-cream toward red as drive comes up. At rest:
        // soft incandescent cream. At max drive: angry red glow like a
        // VU bulb behind a red filter.
        background: `radial-gradient(ellipse at 50% 18%,
          hsl(${sH + 10}, ${sS - 10}%, ${92 - signalFrac * 12}%) 0%,
          hsl(${sH},      ${sS - 5}%,  ${84 - signalFrac * 18}%) 50%,
          hsl(${sH - 8},  ${sS}%,      ${72 - signalFrac * 22}%) 100%)`,
        borderRadius: 3,
        boxShadow: `
          inset 0 1px 3px rgba(0,0,0,0.35),
          inset 0 -2px 2px rgba(255,255,255,${0.45 - signalFrac * 0.25}),
          inset 0 0 ${14 + 12 * signalFrac}px ${sGlow}`,
        overflow: 'hidden',
        transition: 'background 0.08s linear, box-shadow 0.08s linear',
      }}>
        <svg width={width - bezelInset * 2} height={height + 14 - bezelInset * 2}
             viewBox={`0 0 ${width} ${height + 14}`}
             preserveAspectRatio="none"
             style={{ display: 'block', position: 'absolute', inset: 0 }}>
          <defs>
            <linearGradient id={`vu-glass-${label}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"  stopColor="rgba(255,255,255,0.55)" />
              <stop offset="35%" stopColor="rgba(255,255,255,0.10)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
            {/* Brass jewel for the pivot bearing */}
            <radialGradient id={`vu-pivot-${label}`} cx="40%" cy="35%" r="60%">
              <stop offset="0%"   stopColor="hsl(48, 90%, 75%)" />
              <stop offset="50%"  stopColor="hsl(40, 70%, 45%)" />
              <stop offset="100%" stopColor="hsl(28, 55%, 22%)" />
            </radialGradient>
          </defs>

          {/* The big sweep baseline arc — the heavy dark line under all the ticks */}
          <path
            d={(() => {
              const a1 = tickAng(-20) * Math.PI / 180;
              const a2 = tickAng(0)   * Math.PI / 180;
              const x1 = cx + Math.sin(a1) * arcR;
              const y1 = cy - Math.cos(a1) * arcR;
              const x2 = cx + Math.sin(a2) * arcR;
              const y2 = cy - Math.cos(a2) * arcR;
              return `M ${x1} ${y1} A ${arcR} ${arcR} 0 0 1 ${x2} ${y2}`;
            })()}
            stroke="hsl(220, 30%, 14%)"
            strokeWidth="1.2"
            fill="none"
            opacity="0.9"
          />

          {/* Active signal arc — sweeps from -20 dBFS to the needle tip,
              colored green→amber→red with the signal level.
              Two layers: a dim wide glow underneath + a sharp bright line on top. */}
          {signalFrac > 0.01 && (() => {
            const a1 = tickAng(-20) * Math.PI / 180;
            const a2 = a * Math.PI / 180;
            const x1 = cx + Math.sin(a1) * arcR;
            const y1 = cy - Math.cos(a1) * arcR;
            const x2 = cx + Math.sin(a2) * arcR;
            const y2 = cy - Math.cos(a2) * arcR;
            const large = Math.abs(a - tickAng(-20)) > 180 ? 1 : 0;
            const d = `M ${x1} ${y1} A ${arcR} ${arcR} 0 ${large} 1 ${x2} ${y2}`;
            return (
              <g>
                {/* Glow layer — wide, semi-transparent */}
                <path d={d} stroke={sGlow} strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.7" />
                {/* Sharp fill line */}
                <path d={d} stroke={signalColor} strokeWidth="2" fill="none" strokeLinecap="round" />
              </g>
            );
          })()}

          {/* Tick marks + numerals */}
          {ticks.map((t, i) => {
            const ang = tickAng(t.db);
            const x1 = cx + Math.sin(ang * Math.PI / 180) * arcR;
            const y1 = cy - Math.cos(ang * Math.PI / 180) * arcR;
            const x2 = cx + Math.sin(ang * Math.PI / 180) * arcRIn;
            const y2 = cy - Math.cos(ang * Math.PI / 180) * arcRIn;
            const tx = cx + Math.sin(ang * Math.PI / 180) * arcRTxt;
            const ty = cy - Math.cos(ang * Math.PI / 180) * arcRTxt;
            const isRed = t.db >= 0;
            return (
              <g key={i}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isRed ? 'hsl(0, 78%, 38%)' : 'hsl(220, 35%, 12%)'}
                  strokeWidth={t.major ? 1.8 : 0.9}
                  strokeLinecap="round"
                />
                {t.label && (
                  <text
                    x={tx} y={ty + 3}
                    fontSize="10"
                    fontFamily='"Helvetica Neue", Arial, sans-serif'
                    fontWeight="700"
                    textAnchor="middle"
                    fill={isRed ? 'hsl(0, 75%, 35%)' : 'hsl(220, 35%, 16%)'}
                  >{t.label}</text>
                )}
              </g>
            );
          })}

          {/* Red zone — fat solid arc from 0 to +5, like the real VU red zone */}
          <path
            d={(() => {
              const a1 = tickAng(0) * Math.PI / 180;
              const a2 = tickAng(5) * Math.PI / 180;
              const r  = arcR + 4;
              const x1 = cx + Math.sin(a1) * r;
              const y1 = cy - Math.cos(a1) * r;
              const x2 = cx + Math.sin(a2) * r;
              const y2 = cy - Math.cos(a2) * r;
              return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
            })()}
            stroke="hsl(0, 82%, 42%)"
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />

          {/* Big channel label — INPUT or OUTPUT — sits on the lower face */}
          <text
            x={cx} y={height - height * 0.06}
            fontSize="11"
            fontFamily='"Helvetica Neue", Arial, sans-serif'
            fontWeight="800"
            textAnchor="middle"
            fill="hsl(220, 35%, 14%)"
            letterSpacing="2.5"
          >{label}</text>

          {/* "VU" italic mark — the canonical VU meter typography in the lower right */}
          <text
            x={width - 14} y={height - height * 0.06}
            fontSize="11"
            fontFamily='"Times New Roman", serif'
            fontStyle="italic"
            fontWeight="700"
            textAnchor="end"
            fill="hsl(220, 35%, 14%)"
            opacity="0.7"
          >VU</text>

          {/* Needle drop shadow */}
          <line
            x1={cx + 0.5} y1={cy + 0.7}
            x2={needleX + 0.5} y2={needleY + 0.7}
            stroke="rgba(0,0,0,0.22)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          {/* Needle — classic black pointer */}
          <line
            x1={cx} y1={cy}
            x2={needleX} y2={needleY}
            stroke="hsl(220, 20%, 10%)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Counterweight on the far side of the pivot */}
          <line
            x1={cx} y1={cy}
            x2={cx - Math.sin(a * Math.PI / 180) * 5}
            y2={cy + Math.cos(a * Math.PI / 180) * 5}
            stroke="hsl(220, 20%, 10%)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />

          {/* Pivot bearing — brass jewel inside a black housing */}
          <circle cx={cx} cy={cy} r="4" fill="hsl(220, 35%, 8%)" />
          <circle cx={cx} cy={cy} r="2.6" fill={`url(#vu-pivot-${label})`} />

          {/* Glass overlay — diagonal sheen across the top */}
          <rect x="0" y="0" width={width} height={height * 0.45}
                fill={`url(#vu-glass-${label})`} pointerEvents="none" />
        </svg>

        {/* Signal LED — tiny dot in the upper-right corner that tracks signal heat */}
        <div style={{
          position: 'absolute', top: 4, right: 4,
          width: 5, height: 5, borderRadius: '50%',
          background: signalFrac > 0.01 ? signalColor : 'hsl(220, 25%, 18%)',
          boxShadow: signalFrac > 0.01
            ? `0 0 ${4 + signalFrac * 6}px ${sGlow}, inset 0 0 1px rgba(255,255,255,0.5)`
            : 'inset 0 0 1px rgba(0,0,0,0.5)',
          transition: 'background 0.08s, box-shadow 0.08s',
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TapeReel — animated SVG cassette reel that spins faster with drive
// ─────────────────────────────────────────────────────────────────────────────
function TapeReel({ size = 26, periodSec = 6, active = true }) {
  const r = size / 2;
  // Six-spoke hub like a real cassette reel
  const spokes = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i * 60) * Math.PI / 180;
    spokes.push(
      <line
        key={i}
        x1={r} y1={r}
        x2={r + Math.cos(ang) * (r * 0.62)}
        y2={r + Math.sin(ang) * (r * 0.62)}
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    );
  }
  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      // Warm-tinted dark hub matching the new Space-style panel
      background: 'radial-gradient(circle at 40% 35%, hsl(18, 14%, 16%) 0%, hsl(15, 22%, 5%) 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.6)',
      overflow: 'hidden',
    }}>
      <svg
        width={size} height={size}
        style={{
          display: 'block',
          animation: active ? `tape-reel-spin ${periodSec}s linear infinite` : 'none',
          transition: 'animation-duration 0.3s linear',
        }}
      >
        <circle cx={r} cy={r} r={r * 0.18} fill="rgba(255,255,255,0.32)" />
        {spokes}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory presets
// ─────────────────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',           drive: 0,  bassGain: 0,  trebleGain: 0,  volume: 0,  wowFlut: 0,    hiss: 0    },
  { name: 'WARM TAPE',      drive: 6,  bassGain: 2,  trebleGain: -1, volume: -3, wowFlut: 0.1,  hiss: 0.05 },
  { name: 'HOT PRINT',      drive: 12, bassGain: 1,  trebleGain: -3, volume: -6, wowFlut: 0,    hiss: 0    },
  { name: 'LO-FI CASSETTE', drive: 8,  bassGain: -2, trebleGain: -4, volume: -4, wowFlut: 0.4,  hiss: 0.3  },
  { name: 'CRISPY VOCALS',  drive: 4,  bassGain: -1, trebleGain: 3,  volume: -2, wowFlut: 0,    hiss: 0    },
  { name: 'DRUM SMASH',     drive: 14, bassGain: 3,  trebleGain: 1,  volume: -8, wowFlut: 0.05, hiss: 0    },
  { name: 'VINTAGE VIBES',  drive: 5,  bassGain: 1,  trebleGain: -2, volume: -2, wowFlut: 0.25, hiss: 0.15 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main module
// ─────────────────────────────────────────────────────────────────────────────
export default function TapeOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  // ── Parameter state ────────────────────────────────────────────────────────
  const [drive,      setDrive     ] = useState(initialState?.drive      ?? 0);
  const [bassGain,   setBassGain  ] = useState(initialState?.bassGain   ?? 0);
  const [trebleGain, setTrebleGain] = useState(initialState?.trebleGain ?? 0);
  const [volume,     setVolume    ] = useState(initialState?.volume     ?? 0);
  // Default wow/flutter and hiss to ZERO so the module is transparent on
  // insertion. The user opts into the cassette-mechanism flavor by dialing
  // these up — they shouldn't be forced on every track.
  const [wowFlut,    setWowFlut   ] = useState(initialState?.wowFlut    ?? 0);
  const [hiss,       setHiss      ] = useState(initialState?.hiss       ?? 0);
  const [bypassed,   setBypassed  ] = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? 'INIT');

  // ── Metering state ─────────────────────────────────────────────────────────
  const [inLevel,  setInLevel ] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak  ] = useState(0);
  const [outPeak,  setOutPeak ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  // Refs so the engine init useEffect reads the latest state without
  // depending on it (avoids re-creating the engine on every param change).
  const stateRefs = {
    drive:      useRef(drive),
    bassGain:   useRef(bassGain),
    trebleGain: useRef(trebleGain),
    volume:     useRef(volume),
    wowFlut:    useRef(wowFlut),
    hiss:       useRef(hiss),
    bypassed:   useRef(bypassed),
  };
  stateRefs.drive.current      = drive;
  stateRefs.bassGain.current   = bassGain;
  stateRefs.trebleGain.current = trebleGain;
  stateRefs.volume.current     = volume;
  stateRefs.wowFlut.current    = wowFlut;
  stateRefs.hiss.current       = hiss;
  stateRefs.bypassed.current   = bypassed;

  // ── Engine lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createTapeEngine(sharedSource.ctx);
    engineRef.current = engine;

    engine.setDrive(stateRefs.drive.current);
    engine.setBass(stateRefs.bassGain.current);
    engine.setTreble(stateRefs.trebleGain.current);
    engine.setOutputTrim(stateRefs.volume.current);
    engine.setWowFlutter(stateRefs.wowFlut.current);
    engine.setHiss(stateRefs.hiss.current);
    engine.setBypass(stateRefs.bypassed.current);

    registerEngine(instanceId, engine);

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

  // Param → engine bridges
  useEffect(() => { engineRef.current?.setDrive(drive);            }, [drive]);
  useEffect(() => { engineRef.current?.setBass(bassGain);          }, [bassGain]);
  useEffect(() => { engineRef.current?.setTreble(trebleGain);      }, [trebleGain]);
  useEffect(() => { engineRef.current?.setOutputTrim(volume);      }, [volume]);
  useEffect(() => { engineRef.current?.setWowFlutter(wowFlut);     }, [wowFlut]);
  useEffect(() => { engineRef.current?.setHiss(hiss);              }, [hiss]);
  useEffect(() => { engineRef.current?.setBypass(bypassed);        }, [bypassed]);

  const loadPreset = useCallback((preset) => {
    setDrive(preset.drive);
    setBassGain(preset.bassGain);
    setTrebleGain(preset.trebleGain);
    setVolume(preset.volume);
    setWowFlut(preset.wowFlut);
    setHiss(preset.hiss);
    setActivePreset(preset.name);
  }, []);

  useEffect(() => {
    onStateChange?.(instanceId, {
      drive, bassGain, trebleGain, volume, wowFlut, hiss, bypassed, preset: activePreset,
    });
  }, [drive, bassGain, trebleGain, volume, wowFlut, hiss, bypassed, activePreset]);
  // eslint-disable-line react-hooks/exhaustive-deps

  // ── INPUT and VOLUME are independent ──────────────────────────────────────
  // On a real tape preamp INPUT (drive) and VOLUME (master) are independent
  // controls, so we treat them that way here. The new unity-slope clipper
  // doesn't add significant midrange gain when pushed — it only rounds off
  // peaks — so dragging INPUT up doesn't slam the output, and there's no
  // need for the auto-makeup compensation we use on the Neve. The user just
  // sets each knob to taste.
  const VOL_MIN = -24, VOL_MAX = 12;
  const handleDriveChange = useCallback((newDrive) => {
    setDrive(newDrive);
    setActivePreset(null);
  }, []);

  // ── Juice ──────────────────────────────────────────────────────────────────
  const juice = computeJuice(drive);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Inject the reel-spin keyframe once per render. CSS-in-JS via a
          dedicated <style> block is the simplest way to hand a keyframe
          to a single component without polluting global CSS. */}
      <style>{`
        @keyframes tape-reel-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <div style={{
        width: 380, height: 500,
        fontFamily: 'sans-serif',
        userSelect: 'none',
        // rounded-2xl (16 px) like the Space module — soft, atmospheric,
        // not the boxy hardware-chassis look of the Neve.
        borderRadius: 16,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        // Neutral dark panel — DOES NOT change with drive. The user only
        // sees drive feedback in the VU meters and the spinning reels;
        // the panel itself stays calm and consistent so the colored knob
        // rings + cream meters do all the visual work.
        background: `radial-gradient(ellipse at 30% 20%, hsla(220, 18%, 9%, 1), transparent 55%),
                     radial-gradient(ellipse at 70% 80%, hsla(220, 14%, 6%, 1), transparent 55%),
                     #0a0c10`,
        boxShadow: '0 8px 48px rgba(0,0,0,0.85)',
        border: bypassed
          ? '1px solid rgba(255,255,255,0.04)'
          : '1px solid rgba(255,255,255,0.06)',
        // The whole panel desaturates and dims when bypassed. Combined with
        // the big BYPASSED button at the top, you can tell at a glance from
        // across the room whether the module is engaged.
        filter: bypassed ? 'saturate(0.25) brightness(0.55)' : 'none',
        transition: 'filter 0.18s ease',
        position: 'relative',
      }}>

        {/* "BYPASSED" diagonal stamp across the panel — only visible when
            bypassed, big enough to be unmistakable but at low opacity so
            it doesn't fight the controls underneath. */}
        {bypassed && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 50,
          }}>
            <div style={{
              fontSize: 36, fontWeight: 900,
              letterSpacing: '0.3em',
              color: 'rgba(255,255,255,0.10)',
              border: '3px solid rgba(255,255,255,0.10)',
              padding: '6px 22px',
              borderRadius: 6,
              transform: 'rotate(-8deg)',
              fontFamily: '"Helvetica Neue", Arial, sans-serif',
              textShadow: '0 0 20px rgba(0,0,0,0.6)',
            }}>BYPASSED</div>
          </div>
        )}

        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Header — TASCAM brand row + bypass + remove */}
          <div style={{
            flexShrink: 0,
            position: 'relative', zIndex: 1,
            display: 'grid', gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            padding: '7px 10px 6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              {/* Red TEAC-style badge — boxy, sans-serif, the unmistakable
                  livery of every Portastudio ever made */}
              <span style={{
                fontSize: 14, fontWeight: 900,
                color: CREAM,
                letterSpacing: '0.08em',
                fontFamily: '"Helvetica Neue", Arial, sans-serif',
                background: TASCAM_RED,
                padding: '1px 4px',
                borderRadius: 1,
              }}>TASCAM</span>
              <span style={{
                fontSize: 8, fontWeight: 800,
                color: CREAM,
                letterSpacing: '0.18em',
                fontFamily: '"Courier New", monospace',
              }}>424</span>
              <span style={{
                fontSize: 6, color: 'rgba(255,255,255,0.3)',
                letterSpacing: '0.24em', textTransform: 'uppercase',
                fontWeight: 700,
              }}>Portastudio</span>
            </div>

            {/* Tiny tape reels + preset selector in the middle */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TapeReel size={14} periodSec={juice.reelPeriod} active={!bypassed} />
              <TapeReel size={14} periodSec={juice.reelPeriod} active={!bypassed} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
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
              {/* Big, unmistakable bypass button. ACTIVE = green pill with
                  glowing dot, BYPASSED = grey pill with dim dot. The state
                  reads instantly without squinting. */}
              <button
                onClick={() => setBypassed(b => !b)}
                title={bypassed ? 'Click to enable' : 'Click to bypass'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 7.5, fontWeight: 800, padding: '4px 9px',
                  borderRadius: 10, cursor: 'pointer',
                  letterSpacing: '0.12em',
                  transition: 'all 0.15s',
                  ...(bypassed
                    ? {
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        color: 'rgba(255,255,255,0.4)',
                      }
                    : {
                        background: 'hsla(140, 70%, 30%, 0.25)',
                        border: '1px solid hsla(140, 80%, 50%, 0.5)',
                        color: 'hsl(140, 80%, 75%)',
                        boxShadow: '0 0 8px hsla(140, 80%, 50%, 0.3)',
                      }),
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: bypassed ? 'rgba(255,255,255,0.25)' : 'hsl(140, 90%, 60%)',
                  boxShadow: bypassed ? 'none' : '0 0 5px hsl(140, 90%, 60%)',
                }} />
                {bypassed ? 'BYPASSED' : 'ACTIVE'}
              </button>
              {onRemove && (
                <button
                  onClick={onRemove}
                  style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,0,0,0.5)',
                    color: 'rgba(255,255,255,0.55)', fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
              )}
            </div>
          </div>

          {/* VU bridge — two big cream-faced analog VU meters showing the
              signal as it ENTERS the module (INPUT) and LEAVES the module
              (OUTPUT). That's the only thing meters need to tell you for a
              single-channel processor: "what's coming in" and "what's going
              out". The 244 had four meters because it was a four-track
              recorder; we have one stereo channel so we have two meters. */}
          <div style={{
            flexShrink: 0,
            position: 'relative', zIndex: 1,
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 8,
            padding: '6px 12px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <VuMeter level={inLevel}  peak={inPeak}  label="SAT"    drive={drive} />
            <VuMeter level={outLevel} peak={outPeak} label="OUTPUT" drive={drive} />
          </div>

          {/* Knob row — INPUT (red), BASS (yel), TREBLE (yel), VOLUME (white).
              All four are evenly distributed across the panel width to mimic
              the 244's neat horizontal control layout. */}
          <div style={{
            flexShrink: 0,
            position: 'relative', zIndex: 1,
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            padding: '14px 10px 10px',
            gap: 4,
          }}>
            <Knob
              label="Saturation"
              value={drive}
              min={0} max={18} default={0}
              onChange={handleDriveChange}
              size={56}
              ringColor={INPUT_RED}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
            />
            <Knob
              label="Bass"
              value={bassGain}
              min={-10} max={10} default={0}
              onChange={(v) => { setBassGain(v); setActivePreset(null); }}
              size={56}
              ringColor={EQ_GREEN}
              bipolar
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
            />
            <Knob
              label="Treble"
              value={trebleGain}
              min={-10} max={10} default={0}
              onChange={(v) => { setTrebleGain(v); setActivePreset(null); }}
              size={56}
              ringColor={EQ_ORANGE}
              bipolar
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
            />
            <Knob
              label="Volume"
              value={volume}
              min={VOL_MIN} max={VOL_MAX} default={0}
              onChange={(v) => { setVolume(v); setActivePreset(null); }}
              size={56}
              ringColor={VOL_BLUE}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
            />
          </div>

          {/* Tape mechanism extras — wow/flutter and hiss as small sliders.
              These don't exist on the real 424 schematic (it's just the dry
              audio path) but the user originally asked for "tape feel", so
              we expose them here so they can dial in as much or as little
              of the cassette wobble + hiss as they want. */}
          <div style={{
            flexShrink: 0,
            position: 'relative', zIndex: 1,
            padding: '6px 12px 8px',
            display: 'flex', flexDirection: 'column', gap: 4,
            borderTop: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(0,0,0,0.18)',
          }}>
            <SmallSlider
              label="Wow/Flut"
              value={wowFlut}
              onChange={(v) => { setWowFlut(v); setActivePreset(null); }}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <SmallSlider
              label="Hiss"
              value={hiss}
              onChange={(v) => { setHiss(v); setActivePreset(null); }}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </div>
        </div>

        <div style={{ flexShrink: 0 }}>
          <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />
        </div>
      </div>
    </>
  );
}
