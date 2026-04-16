import { useState, useEffect, useRef, useCallback } from 'react';
import { createAmplessEngine } from './amplessEngine';
import PresetSelector from './PresetSelector';

// ─── AMPLESS: Vintage Tube Pedal ── HAND-WIRED TONE MACHINE ──────────────
// Cream tolex enclosure, glowing vacuum tube, chicken head knobs,
// 3D stomp footswitch with jewel LED, vintage silk-screened graphics.

// Tolex-style repeating texture via CSS
const TOLEX_BG = `
  repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    rgba(60,50,30,0.03) 2px,
    rgba(60,50,30,0.03) 3px
  ),
  repeating-linear-gradient(
    90deg,
    transparent 0px,
    transparent 3px,
    rgba(60,50,30,0.02) 3px,
    rgba(60,50,30,0.02) 4px
  )
`;

// ─── Vacuum Tube Glow Canvas ─────────────────────────────────────────────
function VacuumTubeGlow({ drive, body, bite, sag, inputLevel, peak }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const sagGlowRef = useRef(1);
  const sparkPoolRef = useRef([]);
  const valRef = useRef({ drive: 0, body: 0, bite: 0, sag: 0, inputLevel: 0, peak: 0 });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { drive, body, bite, sag, inputLevel, peak };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 150;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.008;
      const phase = phaseRef.current;
      const cx = W / 2, cy = H / 2 + 5;

      // Read LIVE values from ref (not stale closure!)
      const { drive: _drive, sag: _sag, inputLevel: _inputLevel, peak: _peak } = valRef.current;
      const heat = Math.min(_drive + _peak * 0.5, 1);
      const audioPulse = _peak * 0.4 + _inputLevel * 0.3;

      // Sag glow recovery — dims with high sag, recovers slowly
      const sagTarget = 1 - _sag * 0.5;
      sagGlowRef.current += (sagTarget - sagGlowRef.current) * 0.02;
      const sagMul = sagGlowRef.current;

      // === TUBE SOCKET BASE ===
      const socketY = cy + 40;
      const socketW = 52, socketH = 16;
      // Socket body
      ctx.fillStyle = '#1a1815';
      ctx.beginPath();
      ctx.roundRect(cx - socketW/2, socketY - 2, socketW, socketH + 4, 3);
      ctx.fill();
      // Socket rim
      const socketGrad = ctx.createLinearGradient(cx - socketW/2, socketY, cx + socketW/2, socketY);
      socketGrad.addColorStop(0, '#2a2520');
      socketGrad.addColorStop(0.3, '#3a3530');
      socketGrad.addColorStop(0.7, '#3a3530');
      socketGrad.addColorStop(1, '#1a1815');
      ctx.fillStyle = socketGrad;
      ctx.beginPath();
      ctx.roundRect(cx - socketW/2, socketY, socketW, socketH, 3);
      ctx.fill();
      ctx.strokeStyle = '#4a4540';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Socket pins (8 pins)
      for (let i = 0; i < 8; i++) {
        const pinX = cx - 18 + i * 5.2;
        const pinY = socketY + socketH/2;
        ctx.beginPath();
        ctx.arc(pinX, pinY, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#70685a';
        ctx.fill();
        ctx.strokeStyle = '#908878';
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }

      // === GLASS ENVELOPE ===
      const glassTop = cy - 45;
      const glassBot = socketY + 2;
      const glassW = 36;
      // Glass body shape
      ctx.save();
      ctx.beginPath();
      // Bulb top (rounded)
      ctx.moveTo(cx - glassW/2 + 4, glassBot);
      ctx.lineTo(cx - glassW/2, cy - 10);
      ctx.quadraticCurveTo(cx - glassW/2, glassTop + 5, cx - glassW/2 + 10, glassTop);
      ctx.quadraticCurveTo(cx, glassTop - 8, cx + glassW/2 - 10, glassTop);
      ctx.quadraticCurveTo(cx + glassW/2, glassTop + 5, cx + glassW/2, cy - 10);
      ctx.lineTo(cx + glassW/2 - 4, glassBot);
      ctx.closePath();
      // Glass fill — very transparent
      const glassGrad = ctx.createLinearGradient(cx - glassW/2, glassTop, cx + glassW/2, glassTop);
      glassGrad.addColorStop(0, 'rgba(180,170,150,0.06)');
      glassGrad.addColorStop(0.3, 'rgba(200,190,170,0.03)');
      glassGrad.addColorStop(0.7, 'rgba(200,190,170,0.03)');
      glassGrad.addColorStop(1, 'rgba(180,170,150,0.08)');
      ctx.fillStyle = glassGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,190,170,0.15)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // Glass reflection highlight
      ctx.beginPath();
      ctx.moveTo(cx - glassW/2 + 6, glassBot - 10);
      ctx.quadraticCurveTo(cx - glassW/2 + 4, cy - 5, cx - glassW/2 + 8, glassTop + 10);
      ctx.strokeStyle = `rgba(255,255,240,${0.06 + audioPulse * 0.03})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // === PLATE STRUCTURE inside tube ===
      const plateY = cy - 25;
      const plateH = 40;
      const plateW = 18;
      ctx.fillStyle = `rgba(80,70,60,${0.3 + heat * 0.2})`;
      ctx.fillRect(cx - plateW/2 - 2, plateY, 3, plateH);
      ctx.fillRect(cx + plateW/2 - 1, plateY, 3, plateH);
      // Top plate connector
      ctx.fillStyle = `rgba(90,80,70,${0.25 + heat * 0.15})`;
      ctx.fillRect(cx - plateW/2 - 2, plateY - 2, plateW + 4, 3);

      // === GRID WIRES (filament grid) ===
      const gridLines = 6;
      for (let i = 0; i < gridLines; i++) {
        const gy = plateY + 6 + i * (plateH - 12) / (gridLines - 1);
        ctx.beginPath();
        ctx.moveTo(cx - plateW/2 + 1, gy);
        ctx.lineTo(cx + plateW/2 - 1, gy);
        ctx.strokeStyle = `rgba(120,100,80,${0.15 + heat * 0.2})`;
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }

      // === FILAMENT GLOW ===
      const filGlow = (0.3 + _drive * 0.7) * sagMul;
      const filPulse = filGlow + audioPulse * 0.3;
      // Central filament glow
      const filGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 25 + filPulse * 10);
      const r = Math.round(255 * Math.min(filPulse, 1));
      const g = Math.round(140 * Math.min(filPulse * 0.8, 1));
      const b = Math.round(30 * Math.min(filPulse * 0.5, 1));
      filGrad.addColorStop(0, `rgba(${r},${g},${b},${0.6 * filPulse})`);
      filGrad.addColorStop(0.3, `rgba(${Math.round(r*0.8)},${Math.round(g*0.6)},${Math.round(b*0.5)},${0.3 * filPulse})`);
      filGrad.addColorStop(0.6, `rgba(${Math.round(r*0.5)},${Math.round(g*0.3)},0,${0.12 * filPulse})`);
      filGrad.addColorStop(1, 'rgba(40,15,0,0)');
      ctx.fillStyle = filGrad;
      ctx.fillRect(cx - 30, cy - 30, 60, 60);

      // Filament wire (V-shape)
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy + 15);
      ctx.lineTo(cx, cy - 15 + Math.sin(phase * 2) * 1);
      ctx.lineTo(cx + 3, cy + 15);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.7 * filPulse + 0.2})`;
      ctx.lineWidth = 1.2 + filPulse * 0.5;
      ctx.shadowColor = `rgba(255,${Math.round(g)},0,${filPulse * 0.8})`;
      ctx.shadowBlur = 6 + filPulse * 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // === ORANGE GLOW HALO around tube (breathes with signal) ===
      const haloGrad = ctx.createRadialGradient(cx, cy, 15, cx, cy, 55 + audioPulse * 15);
      haloGrad.addColorStop(0, `rgba(255,140,30,${0.03 * filPulse})`);
      haloGrad.addColorStop(0.5, `rgba(255,100,10,${0.015 * filPulse})`);
      haloGrad.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 55 + audioPulse * 15, 0, Math.PI * 2);
      ctx.fill();

      // === HEAT WAVES above tube ===
      const heatIntensity = heat * 0.5 + audioPulse * 0.3;
      if (heatIntensity > 0.1) {
        for (let w = 0; w < 3; w++) {
          const waveY = glassTop - 5 - w * 7;
          const waveAmp = 3 + heatIntensity * 4;
          const waveSpeed = phase * (1.5 + w * 0.3);
          ctx.beginPath();
          for (let x = cx - 20; x <= cx + 20; x += 1) {
            const xn = (x - cx) / 20;
            const y = waveY + Math.sin(xn * 4 + waveSpeed) * waveAmp * (1 - Math.abs(xn));
            if (x === cx - 20) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(255,180,80,${0.04 * heatIntensity * (1 - w * 0.3)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // === ELECTRICAL SPARKS at high drive ===
      if (_drive > 0.8 || (_peak > 0.5 && _drive > 0.5)) {
        const sparkChance = (_drive - 0.5) * 2 + _peak * 0.5;
        // Manage spark pool
        if (Math.random() < sparkChance * 0.15) {
          sparkPoolRef.current.push({
            x: cx + (Math.random() - 0.5) * 30,
            y: cy + (Math.random() - 0.5) * 30,
            dx: (Math.random() - 0.5) * 3,
            dy: (Math.random() - 0.5) * 3,
            life: 1,
          });
        }
        sparkPoolRef.current = sparkPoolRef.current.filter(s => {
          s.x += s.dx;
          s.y += s.dy;
          s.life -= 0.06;
          if (s.life <= 0) return false;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 0.8 + s.life * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,220,100,${s.life * 0.8})`;
          ctx.shadowColor = `rgba(255,200,50,${s.life * 0.6})`;
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
          // Spark trail
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - s.dx * 2, s.y - s.dy * 2);
          ctx.strokeStyle = `rgba(255,200,80,${s.life * 0.3})`;
          ctx.lineWidth = 0.4;
          ctx.stroke();
          return true;
        });
      }

      // === TOP GETTER FLASH (silver disc at top of tube) ===
      ctx.beginPath();
      ctx.ellipse(cx, glassTop + 8, 8, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60,55,50,${0.4 + heat * 0.2})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(100,90,80,${0.2})`;
      ctx.lineWidth = 0.3;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── Chicken Head Knob (SVG) ─────────────────────────────────────────────
function ChickenHeadKnob({ size = 48, norm = 0, color = '#1a1a1a' }) {
  const cx = size / 2 + 4, cy = size / 2 + 4;
  const r = size / 2 - 2;
  const id = useRef(`ch-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  // Pointer tip
  const tipLen = r * 1.1;
  const tipX = cx + Math.cos(rad) * tipLen;
  const tipY = cy + Math.sin(rad) * tipLen;
  // Pointer base width
  const baseW = r * 0.45;
  const perpRad = rad + Math.PI / 2;
  const bx1 = cx + Math.cos(perpRad) * baseW;
  const by1 = cy + Math.sin(perpRad) * baseW;
  const bx2 = cx - Math.cos(perpRad) * baseW;
  const by2 = cy - Math.sin(perpRad) * baseW;

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-base`} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f0e8d8" />
          <stop offset="40%" stopColor="#e8dfc8" />
          <stop offset="80%" stopColor="#d8d0b8" />
          <stop offset="100%" stopColor="#c8c0a8" />
        </radialGradient>
        <radialGradient id={`${id}-spec`} cx="35%" cy="25%" r="45%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,0.45)" />
        </filter>
      </defs>
      {/* Shadow disc */}
      <circle cx={cx} cy={cy + 2} r={r + 1} fill="rgba(0,0,0,0.15)" />
      {/* Base disc — cream plastic */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-base)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-spec)`} />
      {/* Edge ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(150,140,120,0.3)" strokeWidth={0.8} />
      {/* Skirt ring (inner) */}
      <circle cx={cx} cy={cy} r={r * 0.75} fill="none" stroke="rgba(160,150,130,0.15)" strokeWidth={0.5} />
      {/* CHICKEN HEAD POINTER — triangular */}
      <polygon
        points={`${tipX},${tipY} ${bx1},${by1} ${bx2},${by2}`}
        fill={color}
        stroke="rgba(0,0,0,0.3)"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      {/* Pointer highlight */}
      <line
        x1={cx + Math.cos(rad) * r * 0.2}
        y1={cy + Math.sin(rad) * r * 0.2}
        x2={cx + Math.cos(rad) * tipLen * 0.7}
        y2={cy + Math.sin(rad) * tipLen * 0.7}
        stroke={color === '#cc2222' ? 'rgba(255,120,120,0.3)' : 'rgba(255,255,255,0.12)'}
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Center screw */}
      <circle cx={cx} cy={cy} r={2.5} fill="rgba(80,75,65,0.6)" />
      <circle cx={cx} cy={cy} r={1.8} fill="rgba(60,55,45,0.8)" />
    </svg>
  );
}

// ─── Position Dots (printed on panel around a knob) ──────────────────────
function PositionDots({ size, steps = 10, showNumbers = false }) {
  const cx = size / 2 + 4, cy = size / 2 + 4;
  const dotR = size / 2 + 6;
  const dots = [];
  for (let i = 0; i <= steps; i++) {
    const norm = i / steps;
    const angle = (-135 + norm * 270 - 90) * Math.PI / 180;
    const x = cx + Math.cos(angle) * dotR;
    const y = cy + Math.sin(angle) * dotR;
    dots.push(
      <circle key={`d${i}`} cx={x} cy={y} r={0.8} fill="rgba(60,50,40,0.35)" />
    );
    if (showNumbers) {
      const nx = cx + Math.cos(angle) * (dotR + 5);
      const ny = cy + Math.sin(angle) * (dotR + 5);
      dots.push(
        <text key={`n${i}`} x={nx} y={ny} textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: 4.5, fill: 'rgba(60,50,40,0.4)', fontFamily: 'system-ui', fontWeight: 700 }}>
          {i}
        </text>
      );
    }
  }
  return (
    <svg width={size + 8} height={size + 8} style={{
      position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none',
    }}>
      {dots}
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format, sensitivity = 160,
  chickenColor = '#1a1a1a', showDots = false, showNumbers = false }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 24, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab', position: 'relative' }}>
        {(showDots || showNumbers) && <PositionDots size={size} steps={showNumbers ? 10 : 11} showNumbers={showNumbers} />}
        <ChickenHeadKnob size={size} norm={norm} color={chickenColor} />
      </div>
      <span style={{
        fontSize: 6.5,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#2a2a2a', fontWeight: 800, textAlign: 'center', width: '100%',
        lineHeight: 1.2, fontFamily: 'system-ui',
        textShadow: '0 0.5px 0 rgba(255,255,255,0.4)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(0,0,0,0.35)',
        fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

// ─── Jewel LED Indicator ─────────────────────────────────────────────────
function JewelLED({ active }) {
  return (
    <div style={{
      width: 10, height: 8, position: 'relative',
    }}>
      {/* Gem shape — polygon-like with CSS clip-path */}
      <div style={{
        width: 10, height: 8,
        clipPath: 'polygon(20% 0%, 80% 0%, 100% 40%, 50% 100%, 0% 40%)',
        background: active
          ? 'linear-gradient(135deg, #ff4040 0%, #ff1010 40%, #cc0000 70%, #ff3030 100%)'
          : 'linear-gradient(135deg, #3a1515 0%, #2a0a0a 50%, #1a0505 100%)',
        boxShadow: active
          ? '0 0 8px #ff2020, 0 0 16px rgba(255,32,32,0.5), 0 0 24px rgba(255,32,32,0.2)'
          : 'none',
        transition: 'all 0.15s ease',
      }} />
      {/* Refraction sparkle */}
      {active && (
        <div style={{
          position: 'absolute', top: 1, left: 3,
          width: 3, height: 2, borderRadius: '50%',
          background: 'rgba(255,255,255,0.7)',
          filter: 'blur(0.3px)',
        }} />
      )}
    </div>
  );
}

// ─── 3D Stomp Footswitch ─────────────────────────────────────────────────
function StompSwitch({ active, onClick }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        width: 50, height: 50, borderRadius: '50%', border: 'none',
        cursor: 'pointer', position: 'relative',
        // Outer chrome ring
        background: `radial-gradient(circle at 35% 28%,
          #6a6a68 0%, #4a4a48 15%, #3a3a38 30%, #2a2a28 50%, #1a1a18 80%, #0e0e0c 100%)`,
        boxShadow: pressed
          ? `0 1px 4px rgba(0,0,0,0.7),
             inset 0 3px 6px rgba(0,0,0,0.5),
             inset 0 -1px 2px rgba(255,255,255,0.05)`
          : `0 4px 12px rgba(0,0,0,0.8),
             0 2px 4px rgba(0,0,0,0.5),
             inset 0 2px 4px rgba(255,255,255,0.08),
             inset 0 -2px 5px rgba(0,0,0,0.4)`,
        transform: pressed ? 'translateY(2px)' : 'translateY(0)',
        transition: 'all 0.06s ease',
        outline: 'none',
      }}
    >
      {/* Concentric ring 1 — outer chrome */}
      <div style={{
        position: 'absolute', inset: 2, borderRadius: '50%',
        border: '2px solid rgba(120,120,115,0.25)',
        background: 'transparent', pointerEvents: 'none',
      }} />
      {/* Concentric ring 2 — mid band */}
      <div style={{
        position: 'absolute', inset: 5, borderRadius: '50%',
        background: `radial-gradient(circle at 40% 35%,
          #5a5a58 0%, #3e3e3c 40%, #2a2a28 70%, #1e1e1c 100%)`,
        border: '1px solid rgba(100,100,95,0.2)',
        pointerEvents: 'none',
      }} />
      {/* Concentric ring 3 — inner grove */}
      <div style={{
        position: 'absolute', inset: 9, borderRadius: '50%',
        border: '1px solid rgba(80,80,75,0.2)',
        background: 'transparent', pointerEvents: 'none',
      }} />
      {/* Center grip — rubberized texture */}
      <div style={{
        position: 'absolute', inset: 12, borderRadius: '50%',
        background: `radial-gradient(circle at 42% 38%,
          #484846 0%, #363634 50%, #242422 100%)`,
        pointerEvents: 'none',
      }} />
      {/* Grip crosshatch */}
      <div style={{
        position: 'absolute', inset: 13, borderRadius: '50%',
        background: `
          repeating-linear-gradient(45deg, transparent, transparent 1.5px, rgba(255,255,255,0.025) 1.5px, rgba(255,255,255,0.025) 3px),
          repeating-linear-gradient(-45deg, transparent, transparent 1.5px, rgba(255,255,255,0.025) 1.5px, rgba(255,255,255,0.025) 3px)
        `,
        pointerEvents: 'none',
      }} />
      {/* Specular highlight */}
      <div style={{
        position: 'absolute', top: 4, left: 8, width: 16, height: 10,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.08) 0%, transparent 100%)',
        pointerEvents: 'none',
      }} />
    </button>
  );
}

// ─── Input Level LED ─────────────────────────────────────────────────────
function InputLevelLED({ level }) {
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  let color, shadow;
  if (dB > -3) { color = '#ff2020'; shadow = '0 0 8px #ff2020, 0 0 14px rgba(255,32,32,0.6)'; }
  else if (dB > -12) { color = '#f0b020'; shadow = '0 0 7px #f0b020, 0 0 12px rgba(240,176,32,0.5)'; }
  else if (dB > -50) { color = '#20dd20'; shadow = '0 0 6px #20dd20, 0 0 10px rgba(32,221,32,0.4)'; }
  else { color = '#1a3a1a'; shadow = 'none'; }
  return (
    <div style={{
      width: 6, height: 6, borderRadius: '50%',
      background: color, boxShadow: shadow,
      border: '0.5px solid rgba(0,0,0,0.3)',
      transition: 'background 0.08s, box-shadow 0.08s',
    }} />
  );
}

// ─── 1/4" Jack Illustration ──────────────────────────────────────────────
function JackSocket() {
  return (
    <svg width={12} height={16} style={{ display: 'block', opacity: 0.35 }}>
      <rect x={3} y={0} width={6} height={16} rx={3} fill="#2a2520" />
      <ellipse cx={6} cy={4} rx={3.5} ry={2} fill="#1a1815" />
      <circle cx={6} cy={4} r={1.5} fill="#0a0a08" />
      <ellipse cx={6} cy={4} rx={3.5} ry={2} fill="none" stroke="#3a3530" strokeWidth={0.3} />
    </svg>
  );
}

const PRESETS = [
  { name: 'INIT',       body: 0.5, bite: 0.3, sag: 0.3, drive: 0.3, tone: 0.5, gate: 0, mix: 1 },
  { name: 'CLEAN WARM', body: 0.6, bite: 0.15,sag: 0.2, drive: 0.15,tone: 0.45,gate: 0, mix: 1 },
  { name: 'CRUNCH',     body: 0.5, bite: 0.4, sag: 0.3, drive: 0.5, tone: 0.55,gate: 0.2, mix: 1 },
  { name: 'FAT LEAD',   body: 0.7, bite: 0.5, sag: 0.5, drive: 0.65,tone: 0.5, gate: 0.3, mix: 1 },
  { name: 'EDGE',       body: 0.3, bite: 0.7, sag: 0.2, drive: 0.4, tone: 0.65,gate: 0.15, mix: 1 },
  { name: 'BLOOM',      body: 0.55,bite: 0.3, sag: 0.8, drive: 0.35,tone: 0.5, gate: 0, mix: 0.8 },
  { name: 'HIGH GAIN',  body: 0.6, bite: 0.6, sag: 0.4, drive: 0.85,tone: 0.55,gate: 0.5, mix: 1 },
  { name: 'DARK FUZZ',  body: 0.8, bite: 0.2, sag: 0.6, drive: 0.9, tone: 0.3, gate: 0.4, mix: 1 },
];

const PRESET_COLORS = { bg: '#d8d0c0', text: '#2a2a2a', textDim: 'rgba(0,0,0,0.4)', border: 'rgba(60,50,40,0.15)', hoverBg: 'rgba(60,50,40,0.08)', activeBg: 'rgba(60,50,40,0.05)' };

export default function AmplessOrb({ instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState }) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [inputGain, setInputGain] = useState(initialState?.inputGain ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [body, setBody] = useState(initialState?.body ?? 0.5);
  const [bite, setBite] = useState(initialState?.bite ?? 0.3);
  const [sag, setSag] = useState(initialState?.sag ?? 0.3);
  const [drive, setDrive] = useState(initialState?.drive ?? 0.3);
  const [tone, setTone] = useState(initialState?.tone ?? 0.5);
  const [gate, setGate] = useState(initialState?.gate ?? 0);
  const [mix, setMix] = useState(initialState?.mix ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [inputLevel, setInputLevel] = useState(0);
  const [peak, setPeak] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, body, bite, sag, drive, tone, gate, mix, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createAmplessEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng; const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setBody(s.body); eng.setBite(s.bite); eng.setSag(s.sag);
      eng.setDrive(s.drive); eng.setTone(s.tone); eng.setGate(s.gate);
      eng.setMix(s.mix); eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        setInputLevel(engineRef.current.getInputDrive());
        setPeak(engineRef.current.getInputPeak());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => { if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, body, bite, sag, drive, tone, gate, mix, bypassed, preset: activePreset }); }, [inputGain, outputGain, body, bite, sag, drive, tone, gate, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setBody(p.body); setBite(p.bite); setSag(p.sag); setDrive(p.drive);
    setTone(p.tone); setGate(p.gate); setMix(p.mix); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setBody(p.body); e.setBite(p.bite); e.setSag(p.sag); e.setDrive(p.drive); e.setTone(p.tone); e.setGate(p.gate); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };
  const isActive = !bypassed;
  const inPeak = engineRef.current ? engineRef.current.getInputPeak() : 0;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 8, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      // 3D box pedal depth
      background: 'linear-gradient(175deg, #ece4d2 0%, #e6ddc8 20%, #e0d8c2 50%, #dbd3be 80%, #ddd5c0 100%)',
      border: '2px solid rgba(60,50,40,0.35)',
      boxShadow: `
        0 8px 30px rgba(0,0,0,0.5),
        0 4px 12px rgba(0,0,0,0.3),
        0 1px 2px rgba(0,0,0,0.2),
        inset 0 1px 0 rgba(255,255,255,0.5),
        inset 0 -2px 0 rgba(100,90,70,0.15),
        4px 0 8px rgba(0,0,0,0.15),
        -4px 0 8px rgba(0,0,0,0.15)
      `,
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Tolex texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 8,
        backgroundImage: TOLEX_BG,
        pointerEvents: 'none', zIndex: 1,
        opacity: 0.8,
      }} />

      {/* Rubber feet at corners */}
      {[{ top: 4, left: 4 }, { top: 4, right: 4 }, { bottom: 4, left: 4 }, { bottom: 4, right: 4 }].map((pos, i) => (
        <div key={i} style={{
          position: 'absolute', ...pos, width: 8, height: 8, borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 35%, #3a3530 0%, #1a1815 80%)',
          border: '0.5px solid rgba(60,50,40,0.3)', zIndex: 3,
        }} />
      ))}

      {/* ── HEADER: Brand Badge + Preset + IN/OUT + Level LED ── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 10px 7px', position: 'relative', zIndex: 10,
        borderBottom: '1px solid rgba(60,50,40,0.12)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* IN knob - small cream chicken head */}
        <Knob label="IN" value={inputGain} min={0} max={2} defaultValue={1} size={28}
          format={dbFmt} sensitivity={120} chickenColor="#e8dfc8"
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        {/* Center: brand badge + preset */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 }}>
          {/* Retro rounded-rectangle badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(40,35,25,0.08)',
            border: '1px solid rgba(60,50,40,0.15)',
            borderRadius: 12, padding: '2px 10px',
          }}>
            <span style={{
              fontSize: 14, fontWeight: 900, letterSpacing: '0.15em',
              color: '#1a1a18',
              textShadow: '0 1px 0 rgba(255,255,255,0.5)',
              fontFamily: 'system-ui',
            }}>AMPLESS</span>
            <InputLevelLED level={inPeak} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
            {loading && <span style={{ fontSize: 6, color: 'rgba(40,30,20,0.5)' }}>...</span>}
          </div>
        </div>

        {/* OUT knob + remove */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onRemove && (
            <span onClick={onRemove} style={{
              fontSize: 11, cursor: 'pointer', color: 'rgba(200,60,60,0.6)',
              fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
              transition: 'all 0.12s',
            }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#cc2020'; e.currentTarget.style.background = 'rgba(200,40,40,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(200,60,60,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>
          )}
          <Knob label="OUT" value={outputGain} min={0} max={2} defaultValue={1} size={28}
            format={dbFmt} sensitivity={120} chickenColor="#e8dfc8"
            onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* ── 1/4" Jack Left + VACUUM TUBE CANVAS + 1/4" Jack Right ── */}
      <div style={{
        flex: 1, minHeight: 0,
        position: 'relative', zIndex: 2,
        borderBottom: '1px solid rgba(60,50,40,0.12)',
        background: '#0c0808',
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{ position: 'absolute', left: 3, top: '50%', transform: 'translateY(-50%)', zIndex: 3 }}>
          <JackSocket />
        </div>
        <VacuumTubeGlow drive={drive} body={body} bite={bite} sag={sag} inputLevel={inputLevel} peak={peak} />
        <div style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', zIndex: 3 }}>
          <JackSocket />
        </div>
      </div>

      {/* ── DRIVE: THE BIG RED CHICKEN HEAD ── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 0 4px', display: 'flex', justifyContent: 'center',
        position: 'relative', zIndex: 2,
      }}>
        <Knob label="DRIVE" value={drive} defaultValue={0.3} size={38} format={pctFmt}
          sensitivity={200} chickenColor="#cc2222" showDots showNumbers
          onChange={v => { setDrive(v); engineRef.current?.setDrive(v); setActivePreset(null); }} />
      </div>

      {/* ── BODY + BITE: Medium BLACK chicken heads ── */}
      <div style={{
        flexShrink: 0,
        padding: '4px 16px', display: 'flex', justifyContent: 'space-around',
        position: 'relative', zIndex: 2,
      }}>
        <Knob label="BODY" value={body} defaultValue={0.5} size={28} format={pctFmt}
          chickenColor="#1a1a1a" showDots
          onChange={v => { setBody(v); engineRef.current?.setBody(v); setActivePreset(null); }} />
        <Knob label="BITE" value={bite} defaultValue={0.3} size={28} format={pctFmt}
          chickenColor="#1a1a1a" showDots
          onChange={v => { setBite(v); engineRef.current?.setBite(v); setActivePreset(null); }} />
      </div>

      {/* ── SAG + TONE: Smaller cream chicken heads ── */}
      <div style={{
        flexShrink: 0,
        padding: '4px 26px', display: 'flex', justifyContent: 'space-around',
        position: 'relative', zIndex: 2,
      }}>
        <Knob label="SAG" value={sag} defaultValue={0.3} size={28} format={pctFmt}
          chickenColor="#e8dfc8"
          onChange={v => { setSag(v); engineRef.current?.setSag(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={28}
          format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'}
          chickenColor="#e8dfc8"
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
      </div>

      {/* ── GATE + MIX: Tiny cream chicken heads ── */}
      <div style={{
        flexShrink: 0,
        padding: '4px 36px 6px', display: 'flex', justifyContent: 'space-around',
        position: 'relative', zIndex: 2,
      }}>
        <Knob label="GATE" value={gate} defaultValue={0} size={28} format={pctFmt}
          sensitivity={130} chickenColor="#e8dfc8"
          onChange={v => { setGate(v); engineRef.current?.setGate(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1} size={28} format={pctFmt}
          sensitivity={130} chickenColor="#e8dfc8"
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* ── Separator ── */}
      <div style={{
        margin: '0 20px', height: 1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(60,50,40,0.15) 30%, rgba(60,50,40,0.15) 70%, transparent 100%)',
        position: 'relative', zIndex: 2,
      }} />

      {/* ── JEWEL LED + STOMP FOOTSWITCH ── */}
      <div style={{
        flexShrink: 0,
        padding: '10px 0 10px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 8, position: 'relative', zIndex: 2,
      }}>
        <JewelLED active={isActive} />
        <StompSwitch active={isActive} onClick={() => {
          const n = !bypassed;
          setBypassed(n);
          engineRef.current?.setBypass(n);
        }} />
        <span style={{
          fontSize: 6, fontWeight: 800, letterSpacing: '0.2em',
          color: isActive ? 'rgba(40,30,20,0.5)' : 'rgba(40,30,20,0.25)',
          fontFamily: 'system-ui', textTransform: 'uppercase',
          transition: 'color 0.15s',
        }}>{isActive ? 'ACTIVE' : 'BYPASSED'}</span>
      </div>

      {/* ── HAND WIRED + Battery screw detail ── */}
      <div style={{
        flexShrink: 0,
        padding: '0 0 6px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12,
        position: 'relative', zIndex: 2,
      }}>
        <span style={{
          fontSize: 4, fontWeight: 700, letterSpacing: '0.3em',
          color: 'rgba(60,50,40,0.25)', fontFamily: 'system-ui',
          textTransform: 'uppercase',
        }}>HAND WIRED</span>
        {/* Battery screw */}
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #8a8578 0%, #5a5548 60%, #3a3530 100%)',
          border: '0.3px solid rgba(60,50,40,0.3)',
        }} />
      </div>
    </div>
  );
}
