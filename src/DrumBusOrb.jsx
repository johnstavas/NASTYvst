import { useState, useEffect, useRef, useCallback } from 'react';
import { createDrumBusEngine } from './drumBusEngine';
import PresetSelector from './PresetSelector';

// ─── DRUM BUS — HYPER PANTHER ─────────────────────────────────────────────────
// Visual concept: hyper-realistic black panther face, jaw opens with signal,
// rainbow teeth glow, eyes burn gold, whiskers sway, fur texture reacts to audio.
//
// Layout:  Header(52) + Presets(26) + Canvas(280) + DriveMode(27) + Knobs(62) + Footer(53) = 500px

const CAR_W = 380, CAR_H = 280;
const PANTHER_W = 380, PANTHER_H = 280;

// ─── Race Knob ────────────────────────────────────────────────────────────────
// Carbon-fiber dark body, teal indicator + arc
function RaceKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2;
  const trackR = size / 2 - 1.8;
  const knobR  = size / 2 - 4;
  const startAngle  = Math.PI * 0.75;
  const totalSweep  = Math.PI * 1.5;
  const angle       = startAngle + norm * totalSweep;
  const large       = norm * totalSweep > Math.PI ? 1 : 0;

  const tX1 = cx + Math.cos(startAngle) * trackR,           tY1 = cy + Math.sin(startAngle) * trackR;
  const tX2 = cx + Math.cos(startAngle + totalSweep) * trackR, tY2 = cy + Math.sin(startAngle + totalSweep) * trackR;
  const fX2 = cx + Math.cos(angle) * trackR,                fY2 = cy + Math.sin(angle) * trackR;
  const iX1 = cx + Math.cos(angle) * (knobR * 0.28),        iY1 = cy + Math.sin(angle) * (knobR * 0.28);
  const iX2 = cx + Math.cos(angle) * (knobR * 0.85),        iY2 = cy + Math.sin(angle) * (knobR * 0.85);

  const gId = `dbkg${Math.round(size * 10 + norm * 100)}`;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={gId} cx="38%" cy="32%" r="65%">
          <stop offset="0%"   stopColor="#0e2428" />
          <stop offset="50%"  stopColor="#081418" />
          <stop offset="100%" stopColor="#060e12" />
        </radialGradient>
      </defs>
      {/* Outer dark ring */}
      <circle cx={cx} cy={cy} r={size/2 - 0.5} fill="rgba(0,0,0,0.6)" />
      {/* Dark track */}
      <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 1 1 ${tX2} ${tY2}`}
        fill="none" stroke="rgba(40,30,10,0.7)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Orange fill arc */}
      {norm > 0.005 && (
        <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 ${large} 1 ${fX2} ${fY2}`}
          fill="none" stroke="#00d4c0" strokeWidth="2.5" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 2px rgba(0,212,192,0.8))' }} />
      )}
      {/* Carbon body */}
      <circle cx={cx} cy={cy} r={knobR} fill={`url(#${gId})`}
        stroke="rgba(0,0,0,0.5)" strokeWidth="0.8" />
      {/* Subtle carbon rings */}
      <circle cx={cx} cy={cy} r={knobR * 0.75} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5" />
      <circle cx={cx} cy={cy} r={knobR * 0.50} fill="none" stroke="rgba(255,255,255,0.02)"  strokeWidth="0.5" />
      {/* Orange indicator line */}
      <line x1={iX1} y1={iY1} x2={iX2} y2={iY2}
        stroke="#00d4c0" strokeWidth="2.0" strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 1px rgba(0,212,192,0.6))' }} />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="2.2" fill="rgba(0,212,192,0.3)" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 26, format, sensitivity = 140 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp   = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 14, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <RaceKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,220,200,0.75)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 7, color: 'rgba(0,212,192,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

function GainKnob({ value, onChange, label, defaultValue = 1 }) {
  const size = 20;
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = Math.min(1, value / 2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(0, Math.min(2, ref.current.v + (ref.current.y - ev.clientY) * 2 / 100)));
    const onUp   = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <RaceKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(0,212,192,0.5)', fontWeight: 700, fontFamily: 'system-ui, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

// ─── CompToggle ───────────────────────────────────────────────────────────────
function CompToggle({ active, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer', padding: '3px 9px', borderRadius: 3,
      background: active ? 'rgba(0,212,192,0.22)' : 'rgba(255,255,255,0.03)',
      color: active ? '#00d4c0' : 'rgba(0,130,120,0.45)',
      border: `1px solid ${active ? 'rgba(0,212,192,0.5)' : 'rgba(0,80,75,0.2)'}`,
      boxShadow: active ? '0 0 8px rgba(0,212,192,0.4), inset 0 0 4px rgba(0,212,192,0.08)' : 'none',
      fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
      fontFamily: '"Courier New", monospace',
      userSelect: 'none', transition: 'all 0.13s',
    }}>COMP</div>
  );
}

// ─── Stop Sign Bypass ────────────────────────────────────────────────────────
function RaceBypass({ active, onClick }) {
  const size = 32;
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  }).join(' ');
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active — click to bypass' : 'Bypassed — click to activate'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <polygon points={pts}
          fill={active ? 'rgba(210,25,25,0.88)' : 'rgba(80,30,30,0.35)'}
          stroke={active ? 'rgba(255,255,255,0.7)' : 'rgba(120,60,60,0.3)'}
          strokeWidth="1.2" />
        {active && <polygon points={pts} fill="none" stroke="rgba(255,60,60,0.25)" strokeWidth="3" />}
        <text x={cx} y={cy + 2.5} textAnchor="middle"
          fontSize="6.5" fontWeight="800" fontFamily="Arial,sans-serif"
          fill={active ? 'white' : 'rgba(180,100,100,0.5)'} letterSpacing="0.5">
          {active ? 'ACTIVE' : 'BYPSS'}
        </text>
      </svg>
    </div>
  );
}

// ─── Panther Graphic ──────────────────────────────────────────────────────────
// Reactive glow system. All glow layers sit BELOW the SVG (Z1).
// SVG artwork (Z2) always paints on top — glow enhances, never covers.
//
// Demo mode: when all audio inputs are idle (drive=0, boom=0, transient=0)
// a slow 0.25 Hz sine oscillator drives the glow so behaviour is visible
// without a live audio source.
function PantherCanvas({ drive = 0, crunch = 0, boom = 0, decay = 0, damp = 0.75, transient = 0, engineActive = false }) {
  const [markup, setMarkup] = useState('');

  // ── SVG load — colour mapping + material gradient pass
  useEffect(() => {
    fetch('/panther-v2.svg')
      .then(r => r.text())
      .then(rawSvg => {

        // ── Step 1: global colour remapping ──────────────────────────────
        let svg = rawSvg
          .replaceAll('fill="#1a1816"',   'fill="#0d0b09"')
          .replaceAll('fill="#e0f8ff"',   'fill="#0d0b09"')   // mislabeled group — render as black fur
          .replaceAll('fill="#f2e7d1"',   'fill="#ddd8cc"')   // ivory + teeth (pre-gradient base)
          .replaceAll('fill="#efc88d"',   'fill="#d4b27e"')
          .replaceAll('fill="#de3c40"',   'fill="#c02828"')
          .replaceAll('stroke="#868074"', 'stroke="#2a2520"')
          .replaceAll('stroke="#7c2a2b"', 'stroke="#2a2520"')
          .replaceAll('stroke="#857052"', 'stroke="#2a2520"')
          .replaceAll('stroke="#e89289"', 'stroke="#2a2520"')
          .replaceAll('stroke="#f1d8af"', 'stroke="#c8b890"')
          .replace('id="linework">', 'id="linework" opacity="0.5">');

        // ── Step 2: per-group gradient application ────────────────────────
        // Scan line-by-line so we only replace fills inside the target group.
        // No path geometry is touched; only fill="..." attribute values change.
        function applyToGroup(text, groupId, lineTransform) {
          let inside = false;
          return text.split('\n').map(line => {
            if (line.includes(`id="${groupId}"`))    { inside = true;  return line; }
            if (inside && line.includes('</g>'))     { inside = false; return line; }
            return inside ? lineTransform(line) : line;
          }).join('\n');
        }

        // ivory_shapes — directional: top-left cool light, bottom warm shadow
        svg = applyToGroup(svg, 'ivory_shapes', l =>
          l.replace(/fill="#ddd8cc"/g, 'fill="url(#mat_ivory)"'));

        // teeth — tip-to-base: cool bright tip, neutral mid, warm root
        svg = applyToGroup(svg, 'teeth', l =>
          l.replace(/fill="#ddd8cc"/g, 'fill="url(#mat_teeth)"'));

        // #eyes group is mislabeled nose-area marks — no gradient, stays as black fur

        // ── Step 3: inject <defs> immediately after opening <svg> tag ────
        //    gradientUnits="userSpaceOnUse" coords match the SVG viewBox
        //    (-313 2 2400 1769). All values are deliberately understated.
        const defs = [
          '  <defs>',
          '    <!-- Ivory material: warm top highlight, neutral centre, warm lower shadow — no cyan -->',
          '    <linearGradient id="mat_ivory" x1="-100" y1="0" x2="1800" y2="1600"',
          '        gradientUnits="userSpaceOnUse">',
          '      <stop offset="0%"   stop-color="#ede8df"/>',
          '      <stop offset="40%"  stop-color="#ddd8cc"/>',
          '      <stop offset="100%" stop-color="#c8bba6"/>',
          '    </linearGradient>',
          '    <!-- Teeth material: bright warm-white tips, high contrast to warm root -->',
          '    <linearGradient id="mat_teeth" x1="886" y1="1050" x2="886" y2="1570"',
          '        gradientUnits="userSpaceOnUse">',
          '      <stop offset="0%"   stop-color="#f0eeea"/>',
          '      <stop offset="40%"  stop-color="#ddd8cc"/>',
          '      <stop offset="100%" stop-color="#b8a888"/>',
          '    </linearGradient>',
          '    <!-- Eyes material: bright inner highlight, dark outer iris rim -->',
          '    <radialGradient id="mat_eyes" cx="50%" cy="38%" r="52%"',
          '        gradientUnits="objectBoundingBox">',
          '      <stop offset="0%"   stop-color="#f4fcff"/>',
          '      <stop offset="55%"  stop-color="#dff7ff"/>',
          '      <stop offset="100%" stop-color="#7aacbe"/>',
          '    </radialGradient>',
          '  </defs>',
        ].join('\n');

        svg = svg.replace(/(<svg[^>]*>)/, `$1\n${defs}`);

        // Let CSS drop-shadows bleed outside the SVG viewport boundary
        svg = svg.replace(
          'style="background:transparent;display:block;"',
          'style="background:transparent;display:block;overflow:visible;"'
        );

        setMarkup(svg);
      });
  }, []);

  // ── Glow state — aura/rim/rage/pulse go through React (drive div renders).
  //    Eye + mouth filters applied directly on SVG groups via RAF DOM mutation.
  const [glow, setGlow] = useState({ aura: 0.10, rim1: 0.45, rim2: 0.28, rage: 0, pulse: 0 });

  // Ref to the div that contains the dangerouslySetInnerHTML SVG
  const svgRef = useRef(null);

  const vRef = useRef({ drive, crunch, boom, decay, damp, transient, engineActive });
  vRef.current = { drive, crunch, boom, decay, damp, transient, engineActive };

  const S = useRef({ energy: 0, boomSm: 0, transSm: 0, t: 0, frame: 0 });

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = vRef.current;
      const s = S.current;
      s.t     += 1 / 60;
      s.frame += 1;

      // Demo breath when no engine connected
      const demoBreath = Math.sin(s.t * 0.25 * Math.PI * 2) * 0.5 + 0.5;
      const demo       = v.engineActive ? 0 : demoBreath;

      // Combined drive+crunch+boom rage — 0 to 1, primary visual fuel
      const driveI = Math.min(1.0, v.drive * 0.35 + v.crunch * 0.35 + v.boom * 0.30);

      // Energy — all three heavy hitters feed it
      const rawE = 0.12 + v.drive * 0.36 + v.crunch * 0.30 + v.boom * 0.24 + v.transient * 0.06;
      s.energy = s.energy + (Math.max(rawE, demo) - s.energy) * 0.18;

      if (v.boom > s.boomSm) s.boomSm = s.boomSm * 0.05 + v.boom * 0.95;
      else                   s.boomSm = s.boomSm * 0.88 + v.boom * 0.12;
      const boomV = Math.max(s.boomSm, demo * 0.8);

      if (v.transient > s.transSm) s.transSm = s.transSm * 0.02 + v.transient * 0.98;
      else                         s.transSm = s.transSm * 0.78 + v.transient * 0.22;
      const tranFlash = v.engineActive && s.transSm > 0.3
        ? (s.transSm - 0.3) / 0.7 : 0;

      const e = s.energy;

      // ── Pulse — smooth laser throb, no high-freq strobe ─────────────────
      // slowBeat: 1.5→8 Hz — deep power surge rhythm
      // midSwell: 4→14 Hz  — subtle mid texture (was 50 Hz fastFlick, killed)
      const slowBeat = Math.sin(s.t * (1.5 + driveI * 6.5) * Math.PI * 2) * 0.5 + 0.5;
      const midSwell = Math.sin(s.t * (4.0 + driveI * 10.0) * Math.PI * 2) * 0.5 + 0.5;
      const rawPulse = driveI * (slowBeat * 1.2 + midSwell * 0.4); // 0–1.6

      // Lerp smoothing — kills residual flicker, preserves slow throb shape
      if (!s.pulseSm) s.pulseSm = 0;
      s.pulseSm = s.pulseSm + (rawPulse - s.pulseSm) * 0.08;
      const pulseMod = s.pulseSm;

      // Aura pulse value — full 0–1 swing
      const pulseVal = slowBeat * 0.70 + midSwell * 0.30;

      // ── Rage — hits blood red FAST ────────────────────────────────────────
      // Any drive+crunch above 10% starts bleeding red. Full red at 60%.
      const rage = Math.min(1.0, Math.pow(Math.max(0, driveI - 0.08) / 0.55, 0.7));

      // Eye tight core:  amber(255,185,30) → blood(255,0,0)
      const eR1 = 255, eG1 = Math.round(185 * (1 - rage)), eB1 = Math.round(30 * (1 - rage));
      // Eye outer bloom: orange(255,110,0) → dark blood(150,0,0)
      const eR2 = Math.round(255 - 105 * rage), eG2 = Math.round(110 * (1 - rage)), eB2 = 0;

      // ── Direct DOM filter updates ─────────────────────────────────────────
      const svgEl = svgRef.current?.querySelector('svg');
      if (svgEl) {
        const eyeE   = Math.min(1.0, 0.20 + e * 1.2 + pulseMod * 0.8 + tranFlash * 0.8);
        const mouthE = Math.min(1.0, 0.18 + e * 1.2 + pulseMod * 0.6 + boomV * 1.1);

        const eyeGroup = svgEl.querySelector('#ear_inner');
        if (eyeGroup) {
          // FULLY UNCLAMPED — pulse peaks far above 1.0 = laser overexposure
          // boom now feeds directly into the eye blast radius
          const boomBlast = v.boom * 2.8;
          const eyeRaw = 0.20 + e * 2.8 + pulseMod * 3.5 + boomBlast + tranFlash * 2.5;

          // White-hot core: pure white → searing red-white at rage
          const wcR = 255, wcG = Math.round(240 * (1 - rage * 0.85)), wcB = Math.round(240 * (1 - rage));

          // Layer 0 — white-hot searing pinpoint
          const r0 = (1.5 + eyeRaw * 8).toFixed(1);
          const a0 = Math.min(0.99, eyeRaw * 0.99).toFixed(3);
          // Layer 1 — tight blood core
          const r1 = (3.0 + eyeRaw * 28).toFixed(1);
          const a1 = Math.min(0.99, 0.30 + eyeRaw * 0.69).toFixed(3);
          // Layer 2 — wide searing bloom (7× r1)
          const r2 = (parseFloat(r1) * 7).toFixed(1);
          const a2 = Math.min(0.99, eyeRaw * 0.88).toFixed(3);
          // Layer 3 — MASSIVE deep corona — paints the entire upper half
          const r3 = (40 + eyeRaw * 320).toFixed(1);
          const a3 = Math.min(0.92, eyeRaw * 0.75).toFixed(3);

          eyeGroup.style.filter = [
            `drop-shadow(0 0 ${r0}px rgba(${wcR},${wcG},${wcB},${a0}))`,
            `drop-shadow(0 0 ${r1}px rgba(${eR1},${eG1},${eB1},${a1}))`,
            `drop-shadow(0 0 ${r2}px rgba(${eR2},${eG2},${eB2},${a2}))`,
            `drop-shadow(0 0 ${r3}px rgba(${Math.round(eR2 * 0.55)},0,0,${a3}))`,
          ].join(' ');
        }

        const mouthGroup = svgEl.querySelector('#mouth_red');
        if (mouthGroup) {
          const mouthRaw = 0.18 + e * 2.2 + pulseMod * 2.0 + boomV * 2.5;
          const r1 = (3 + mouthRaw * 35 + driveI * 18).toFixed(1);
          const a1 = Math.min(0.99, 0.25 + mouthRaw * 0.74).toFixed(3);
          const r2 = (parseFloat(r1) * 4).toFixed(1);
          const a2 = Math.min(0.95, mouthRaw * 0.80).toFixed(3);
          const r3 = (parseFloat(r1) * 10).toFixed(1);
          const a3 = Math.min(0.70, mouthRaw * 0.55).toFixed(3);
          mouthGroup.style.filter =
            `drop-shadow(0 0 ${r1}px rgba(255,20,0,${a1})) ` +
            `drop-shadow(0 0 ${r2}px rgba(200,0,0,${a2})) ` +
            `drop-shadow(0 0 ${r3}px rgba(120,0,0,${a3}))`;
        }
      }

      const rim1 = Math.min(0.99, 0.38 + e * 0.61 + pulseMod * 0.25);
      const rim2 = Math.min(0.99, 0.22 + e * 0.77 + pulseMod * 0.20);
      const aura = Math.min(0.99, 0.12 + e * 0.65 + driveI * 0.55 + boomV * 0.45 + pulseMod * 0.35);

      if (s.frame % 2 === 0) {
        setGlow({ aura, rim1, rim2, rage, pulse: pulseVal });
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{
      width: PANTHER_W, height: PANTHER_H,
      background: 'transparent',
      overflow: 'visible', position: 'relative',
    }}>

      {/* ── Z1: Aura — cyan at idle, BLOOD RED FLOOD at max rage, throbs with pulse ── */}
      {(() => {
        const r  = glow.rage;
        const p  = glow.pulse;
        // Color: cyan → deep blood red
        const aR = Math.round(r * 210);
        const aG = Math.round(30  * (1 - r));
        const aB = Math.round(255 * (1 - r));
        // Opacity throbs: base aura × (1 + pulse × rage) — booms now push it further
        const op = Math.min(1.0, glow.aura * (1 + p * r * 3.5));
        // Blur expands massively at high rage — flood the whole face
        const bl = 45 + r * 140;
        return (
          <div style={{
            position: 'absolute', inset: -(60 + r * 200),
            zIndex: 1, pointerEvents: 'none',
            opacity: op,
            background: `radial-gradient(ellipse 92% 85% at 50% 52%,
              rgba(${aR},${aG},${aB},1) 0%,
              rgba(${Math.round(aR*0.80)},0,${Math.round(aB*0.35)},0.65) 35%,
              transparent 68%)`,
            filter: `blur(${bl.toFixed(0)}px)`,
          }} />
        );
      })()}

      {/* ── Z2: SVG — rim shifts cyan → red with rage ── */}
      {(() => {
        const r  = glow.rage;
        // Rim color: cyan → blood red
        const rR = Math.round(r * 255);
        const rG = Math.round(210 * (1 - r));
        const rB = Math.round(255 * (1 - r));
        const c  = `${rR},${rG},${rB}`;
        return (
      <div style={{
        position: 'absolute', inset: 0, zIndex: 2,
        filter: [
          `drop-shadow(0 0 5px  rgba(${c},${glow.rim1.toFixed(3)}))`,
          `drop-shadow(0 0 18px rgba(${c},${glow.rim2.toFixed(3)}))`,
          `drop-shadow(0 0 55px rgba(${c},${(glow.rim2 * 0.70).toFixed(3)}))`,
          `drop-shadow(0 0 110px rgba(${c},${(glow.rim2 * 0.40).toFixed(3)}))`,
        ].join(' '),
      }}>
        <div ref={svgRef} dangerouslySetInnerHTML={{ __html: markup }} />
      </div>
        );
      })()}

    </div>
  );
}

// ─── Vertical Level Meter ────────────────────────────────────────────────────
// Overlays on the left or right edge of the panther canvas.
// Fills bottom→top. Cyan→yellow→orange-red color zones.
function VerticalMeter({ peak, label, side }) {
  const db = peak > 0.00001 ? 20 * Math.log10(peak) : -Infinity;
  const dbClamped = isFinite(db) ? Math.max(-48, Math.min(3, db)) : -48;
  const fill = (dbClamped + 48) / 51;
  const dbStr = !isFinite(db) || db < -47.9 ? '-∞' : (db >= 0 ? '+' : '') + db.toFixed(1);

  const segs = 20;
  // Yellow: above -6dBFS  (fill > 0.824)
  // Red:    above -3dBFS  (fill > 0.882)
  const isHotFill  = fill > 0.882;
  const isWarmFill = fill > 0.824;
  const color = isHotFill ? '#ff6020' : isWarmFill ? '#ffd040' : '#00d4c0';
  const glow  = isHotFill ? 'rgba(255,80,0,0.55)' : isWarmFill ? 'rgba(255,200,0,0.5)' : 'rgba(0,212,192,0.4)';

  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0, [side]: 0,
      width: 18, zIndex: 6, pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 12, paddingBottom: 6,
      background: side === 'left'
        ? 'linear-gradient(90deg, rgba(4,10,12,0.86) 0%, rgba(4,10,12,0.25) 100%)'
        : 'linear-gradient(270deg, rgba(4,10,12,0.86) 0%, rgba(4,10,12,0.25) 100%)',
      borderRight: side === 'left'  ? '1px solid rgba(0,212,192,0.10)' : 'none',
      borderLeft:  side === 'right' ? '1px solid rgba(0,212,192,0.10)' : 'none',
    }}>
      {/* LED segments — column-reverse so i=0 is at bottom, fills upward */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column-reverse',
        alignItems: 'center', gap: 1.5, width: '100%',
      }}>
        {Array.from({ length: segs }, (_, i) => {
          const lit    = fill >= (i / segs) + 0.001;
          const isHot  = i >= 18; // top 2 segs  → above -3dBFS
          const isWarm = i >= 16; // segs 16-17  → -6 to -3dBFS
          return (
            <div key={i} style={{
              flex: 1, width: 8, borderRadius: 1, minHeight: 2,
              background: lit
                ? (isHot ? '#ff5010' : isWarm ? '#ffd040' : '#00d4c0')
                : (isHot ? 'rgba(255,80,16,0.07)' : isWarm ? 'rgba(255,208,0,0.07)' : 'rgba(0,212,192,0.07)'),
              boxShadow: lit
                ? (isHot ? '0 0 4px rgba(255,80,0,0.9)' : isWarm ? '0 0 3px rgba(255,200,0,0.8)' : '0 0 3px rgba(0,212,192,0.7)')
                : 'none',
            }} />
          );
        })}
      </div>
      {/* dB — vertical text, reads bottom-to-top */}
      <span style={{
        marginTop: 4,
        fontSize: 5.5, fontFamily: '"Courier New", monospace', fontWeight: 700,
        color, textShadow: `0 0 4px ${glow}`,
        letterSpacing: '0.04em', lineHeight: 1,
        writingMode: 'vertical-rl', transform: 'rotate(180deg)',
      }}>{dbStr}</span>
      {/* Label */}
      <span style={{
        marginTop: 3, fontSize: 7, fontWeight: 800, letterSpacing: '0.12em',
        color: 'rgba(0,212,192,0.58)', fontFamily: 'system-ui', lineHeight: 1,
      }}>{label}</span>
    </div>
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'PUNCHY DRUMS',   drive: 0.45, crunch: 0.15, boom: 0.30, freq: 0.25, damp: 0.75, transients: 0.65, decay: 0.50, comp: 1, driveMode: 0, mix: 1.0, trim: 0 },
  { name: 'HEAVY KICK',     drive: 0.35, crunch: 0.05, boom: 0.70, freq: 0.15, damp: 0.80, transients: 0.50, decay: 0.65, comp: 1, driveMode: 1, mix: 1.0, trim: 0 },
  { name: 'SNARE CRACK',    drive: 0.55, crunch: 0.40, boom: 0.10, freq: 0.30, damp: 0.65, transients: 0.80, decay: 0.35, comp: 0, driveMode: 2, mix: 1.0, trim: 0 },
  { name: 'PARALLEL SMASH', drive: 0.60, crunch: 0.35, boom: 0.50, freq: 0.20, damp: 0.70, transients: 0.70, decay: 0.55, comp: 1, driveMode: 2, mix: 0.80, trim: 0 },
  { name: 'WARM TAPE BUS',  drive: 0.30, crunch: 0.05, boom: 0.40, freq: 0.25, damp: 0.60, transients: 0.50, decay: 0.60, comp: 1, driveMode: 0, mix: 1.0, trim: 0 },
  { name: 'MODERN POP KIT', drive: 0.40, crunch: 0.25, boom: 0.25, freq: 0.30, damp: 0.80, transients: 0.65, decay: 0.45, comp: 1, driveMode: 1, mix: 1.0, trim: 0 },
  { name: 'LO-FI CRUNCH',   drive: 0.70, crunch: 0.60, boom: 0.35, freq: 0.20, damp: 0.45, transients: 0.55, decay: 0.50, comp: 0, driveMode: 2, mix: 0.85, trim: -1 },
  { name: 'TIGHT ROOM KIT', drive: 0.25, crunch: 0.10, boom: 0.20, freq: 0.35, damp: 0.85, transients: 0.60, decay: 0.40, comp: 1, driveMode: 0, mix: 1.0, trim: 0 },
];

const PRESET_COLORS = {
  bg: '#060e10', text: '#00c8b8', textDim: 'rgba(0,200,185,0.5)',
  border: 'rgba(0,212,192,0.15)', hoverBg: 'rgba(0,212,192,0.08)', activeBg: 'rgba(0,212,192,0.05)',
};

const DRIVE_MODES = ['SOFT', 'MEDIUM', 'HARD'];

// ─── Main component ───────────────────────────────────────────────────────────
export default function DrumBusOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [drive,      setDrive]      = useState(initialState?.drive      ?? 0.3);
  const [crunch,     setCrunch]     = useState(initialState?.crunch     ?? 0.0);
  const [boom,       setBoom]       = useState(initialState?.boom       ?? 0.0);
  const [freq,       setFreq]       = useState(initialState?.freq       ?? 0.25);
  const [damp,       setDamp]       = useState(initialState?.damp       ?? 0.75);
  const [transients, setTransients] = useState(initialState?.transients ?? 0.5);
  const [decay,      setDecay]      = useState(initialState?.decay      ?? 0.5);
  const [comp,       setComp]       = useState(initialState?.comp       ?? 0);
  const [driveMode,  setDriveMode]  = useState(initialState?.driveMode  ?? 0);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1.0);
  const [trim,       setTrim]       = useState(initialState?.trim       ?? 0);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);

  // metering
  const [peakIn,    setPeakIn]    = useState(0);
  const [peakOut,   setPeakOut]   = useState(0);
  const [gr,        setGr]        = useState(0);
  const [bassLevel, setBassLevel] = useState(0);
  const [transient, setTransient] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, drive, crunch, boom, freq, damp, transients, decay, comp, driveMode, mix, trim, bypassed };

  // ── Inject button pulse keyframes once ──────────────────────────────────
  useEffect(() => {
    if (document.getElementById('drivemode-kf')) return;
    const s = document.createElement('style');
    s.id = 'drivemode-kf';
    s.textContent = '@keyframes drivePulse { 0%,100%{filter:brightness(1) opacity(1)} 50%{filter:brightness(2.6) opacity(0.88)} }';
    document.head.appendChild(s);
  }, []);

  // Engine init
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createDrumBusEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setDrive(s.drive);
      eng.setCrunch(s.crunch);
      eng.setBoom(s.boom);
      eng.setFreq(s.freq);
      eng.setDamp(s.damp);
      eng.setTransients(s.transients);
      eng.setDecay(s.decay);
      eng.setComp(s.comp);
      eng.setDriveMode(s.driveMode);
      eng.setMix(s.mix);
      eng.setTrim(s.trim);
      eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        if (unregisterEngine) unregisterEngine(instanceId);
        engineRef.current = null;
      }
    };
  }, [sharedSource]);

  // RAF metering loop
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (engineRef.current) {
        setPeakIn(engineRef.current.getInputPeak?.()  ?? 0);
        setPeakOut(engineRef.current.getOutputPeak?.() ?? 0);
        setGr(engineRef.current.getGR?.()             ?? 0);
        setBassLevel(engineRef.current.getBassLevel?.() ?? 0);
        setTransient(engineRef.current.getTransient?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // State change notification
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, {
      inputGain, outputGain, drive, crunch, boom, freq, damp,
      transients, decay, comp, driveMode, mix, trim, bypassed, preset: activePreset,
    });
  }, [inputGain, outputGain, drive, crunch, boom, freq, damp, transients, decay, comp, driveMode, mix, trim, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setDrive(p.drive);          engineRef.current?.setDrive(p.drive);
    setCrunch(p.crunch);        engineRef.current?.setCrunch(p.crunch);
    setBoom(p.boom);            engineRef.current?.setBoom(p.boom);
    setFreq(p.freq);            engineRef.current?.setFreq(p.freq);
    setDamp(p.damp);            engineRef.current?.setDamp(p.damp);
    setTransients(p.transients); engineRef.current?.setTransients(p.transients);
    setDecay(p.decay);          engineRef.current?.setDecay(p.decay);
    setComp(p.comp);            engineRef.current?.setComp(p.comp);
    setDriveMode(p.driveMode);  engineRef.current?.setDriveMode(p.driveMode);
    setMix(p.mix);              engineRef.current?.setMix(p.mix);
    setTrim(p.trim);            engineRef.current?.setTrim(p.trim);
    setActivePreset(p.name);
  }, []);

  const pctFmt  = v => `${Math.round(v * 100)}%`;
  const trimFmt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + 'dB';

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #060e10 0%, #081418 40%, #040c0e 100%)',
      border: '1.5px solid rgba(0,212,192,0.25)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.95), 0 0 14px rgba(0,212,192,0.06), inset 0 1px 0 rgba(0,212,192,0.03)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Vignette overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(8,6,12,0.35) 100%)',
        borderRadius: 5,
      }} />

      {/* ── Header: IN | Logo | OUT ── */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,212,192,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(0,212,192,0.01) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        {/* PANTHER BUSS logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <span style={{
            fontSize: 20, fontWeight: 900, letterSpacing: '0.12em',
            background: 'linear-gradient(180deg, #ff6020 0%, #ff3800 45%, #cc1800 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 2px 8px rgba(255,40,0,0.65)) drop-shadow(0 0 18px rgba(220,20,0,0.35))',
            fontFamily: '"Arial Black", "Arial Bold", Impact, sans-serif',
            textTransform: 'uppercase', lineHeight: 1,
          }}>PANTHER</span>
          <span style={{
            fontSize: 13, fontWeight: 900, letterSpacing: '0.55em',
            background: 'linear-gradient(180deg, #d4b27e 0%, #a07840 60%, #7a5520 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 1px 4px rgba(180,120,20,0.5))',
            fontFamily: '"Arial Black", "Arial Bold", Impact, sans-serif',
            textTransform: 'uppercase', lineHeight: 1,
          }}>BUSS</span>
          <span style={{
            fontSize: 5.5, fontWeight: 400, color: 'rgba(212,178,126,0.35)',
            letterSpacing: '0.3em', fontFamily: 'system-ui, Arial, sans-serif',
          }}>drive · crunch · slam</span>
        </div>

        <GainKnob label="OUT" value={outputGain} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
      </div>

      {/* ── Preset row ── */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,212,192,0.04)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(0,212,192,0.4)' }}>...</span>}
          {onRemove && (
            <span onClick={onRemove}
              style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2 }}
              title="Remove"
              onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div style={{ position: 'relative', zIndex: 2, height: PANTHER_H, flexShrink: 0, overflow: 'visible' }}>
        <PantherCanvas
          drive={drive} crunch={crunch} boom={boom}
          decay={decay} damp={damp} transient={transient}
          engineActive={!!engineRef.current}
        />
        {/* IN meter — left edge of panther */}
        <VerticalMeter peak={peakIn}  label="IN"  side="left" />
        {/* OUT meter — right edge of panther */}
        <VerticalMeter peak={peakOut} label="OUT" side="right" />
      </div>

      {/* ── DriveMode row + COMP toggle ── */}
      <div style={{
        padding: '4px 14px 3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px solid rgba(0,212,192,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
        gap: 6,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(() => {
            const driveI = Math.min(1, drive * 0.5 + crunch * 0.5);
            const rage   = Math.min(1, Math.pow(Math.max(0, driveI - 0.08) / 0.55, 0.7));
            const cR = Math.round(rage * 255);
            const cG = Math.round(212 * (1 - rage));
            const cB = Math.round(192 * (1 - rage));
            // Pulse speed: 0.75s idle → 0.10s at max
            const spd = Math.max(0.10, 0.75 - driveI * 0.65).toFixed(2) + 's';
            return DRIVE_MODES.map((m, i) => {
              const active = driveMode === i;
              return (
                <button key={m}
                  onClick={() => { setDriveMode(i); engineRef.current?.setDriveMode(i); setActivePreset(null); }}
                  style={{
                    fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', padding: '3px 8px',
                    borderRadius: 3, cursor: 'pointer', outline: 'none',
                    fontFamily: '"Courier New", monospace',
                    background:  active ? `rgba(${cR},${cG},${cB},0.16)` : 'rgba(255,255,255,0.02)',
                    color:       active ? `rgb(255,${Math.round(225*(1-rage*0.9))},${Math.round(225*(1-rage))})` : `rgba(${cR},${cG},${cB},0.30)`,
                    border:      `1px solid rgba(${cR},${cG},${cB},${active ? 0.65 : 0.14})`,
                    boxShadow:   active ? `0 0 10px rgba(${cR},${cG},${cB},0.70), inset 0 0 6px rgba(${cR},${cG},${cB},0.18)` : 'none',
                    animation:       active ? `drivePulse ${spd} ease-in-out infinite` : 'none',
                  }}>{m}</button>
              );
            });
          })()}
        </div>
        <CompToggle
          active={comp > 0.5}
          onClick={() => {
            const newComp = comp > 0.5 ? 0 : 1;
            setComp(newComp);
            engineRef.current?.setComp(newComp);
            setActivePreset(null);
          }}
        />
      </div>

      {/* ── Knob row: DRIVE | CRUNCH | BOOM | DAMP | TRANS | DECAY ── */}
      <div style={{
        padding: '6px 10px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderTop: '1px solid rgba(0,212,192,0.04)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="DRIVE" value={drive} defaultValue={0.3} size={26} format={pctFmt}
          onChange={v => { setDrive(v); engineRef.current?.setDrive(v); setActivePreset(null); }} />
        <Knob label="CRUNCH" value={crunch} defaultValue={0} size={26} format={pctFmt}
          onChange={v => { setCrunch(v); engineRef.current?.setCrunch(v); setActivePreset(null); }} />
        <Knob label="BOOM" value={boom} defaultValue={0} size={26} format={pctFmt}
          onChange={v => { setBoom(v); engineRef.current?.setBoom(v); setActivePreset(null); }} />
        <Knob label="DAMP" value={damp} defaultValue={0.75} size={26} format={pctFmt}
          onChange={v => { setDamp(v); engineRef.current?.setDamp(v); setActivePreset(null); }} />
        <Knob label="TRANS" value={transients} defaultValue={0.5} size={26}
          format={v => v < 0.45 ? 'SOFT' : v > 0.55 ? 'PUNCH' : 'FLAT'}
          onChange={v => { setTransients(v); engineRef.current?.setTransients(v); setActivePreset(null); }} />
        <Knob label="DECAY" value={decay} defaultValue={0.5} size={26}
          format={v => v < 0.45 ? 'TIGHT' : v > 0.55 ? 'LONG' : 'MID'}
          onChange={v => { setDecay(v); engineRef.current?.setDecay(v); setActivePreset(null); }} />
      </div>

      {/* ── Footer row: FREQ | MIX | TRIM | BYPASS ── */}
      <div style={{
        padding: '4px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px solid rgba(0,212,192,0.04)', position: 'relative', zIndex: 2, flexShrink: 0,
        gap: 6,
      }}>
        <Knob label="FREQ" value={freq} defaultValue={0.25} size={20}
          format={v => Math.round(40 + v * 160) + 'Hz'}
          onChange={v => { setFreq(v); engineRef.current?.setFreq(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1.0} size={20} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
          <div style={{
            fontSize: 9, color: 'rgba(0,212,192,0.85)', fontFamily: '"Courier New",monospace',
            fontWeight: 700, letterSpacing: '0.05em',
            background: 'rgba(0,212,192,0.06)', border: '1px solid rgba(0,212,192,0.2)',
            borderRadius: 3, padding: '2px 6px',
          }}>{trimFmt(trim)}</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
            <span onClick={() => { const v = Math.max(-12, trim - 1); setTrim(v); engineRef.current?.setTrim(v); }}
              style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(0,212,192,0.55)', fontWeight: 700, padding: '0 3px', borderRadius: 2,
                transition: 'color 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#00d4c0'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,212,192,0.55)'}>-</span>
            <span style={{ fontSize: 7.5, color: 'rgba(0,212,192,0.4)', fontFamily: '"Courier New",monospace' }}>TRIM</span>
            <span onClick={() => { const v = Math.min(12, trim + 1); setTrim(v); engineRef.current?.setTrim(v); }}
              style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(0,212,192,0.55)', fontWeight: 700, padding: '0 3px', borderRadius: 2,
                transition: 'color 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#00d4c0'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,212,192,0.55)'}>+</span>
          </div>
        </div>
        <RaceBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
