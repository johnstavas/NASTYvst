import { useState, useEffect, useRef, useCallback } from 'react';
import { createGluesmashEngine } from './gluesmashEngine';
import PresetSelector from './PresetSelector';

// ─── GLUESMASH: Pressure Machine ───────────────────────────────────────────
// INDUSTRIAL PRESSURE GAUGE — Giant analog VU meter with spring-physics needle
// Hex bolt knobs, emergency stop bypass, warning tape, riveted steel panels

// ─── Giant Analog Pressure Gauge (canvas) ─────────────────────────────────
function PressureGauge({ macro, gr, smash, punch, peak, outPeak }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ macro: 0, gr: 0, smash: 0, punch: 0, peak: 0, outPeak: 0 });
  const animRef = useRef({
    needleAngle: 0, needleVel: 0,
    rimGlow: 0, shakeX: 0, shakeY: 0,
    cracks: [], ledStates: new Array(24).fill(0),
    phase: 0,
  });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { macro, gr, smash, punch, peak, outPeak };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const SIZE = 260;
    const DPR = 2;
    canvas.width = SIZE * DPR;
    canvas.height = SIZE * DPR;
    ctx.scale(DPR, DPR);

    const state = animRef.current;
    let raf;

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const cx = SIZE / 2, cy = SIZE / 2;
      const gaugeR = 115;
      state.phase += 0.01;

      // Read LIVE values from ref (not stale closure!)
      const { gr: _gr, peak: _peak, outPeak: _outPeak, macro: _macro, smash: _smash } = valRef.current;
      const grNorm = Math.min(_gr / 24, 1);
      const peakAmt = _peak || 0;
      const outAmt = _outPeak || 0;

      // ── Spring physics needle ──
      const targetAngle = -135 + grNorm * 270; // sweep from -135 to +135 deg
      const stiffness = 0.08;
      const damping = 0.78;
      state.needleVel += (targetAngle - state.needleAngle) * stiffness;
      state.needleVel *= damping;
      state.needleAngle += state.needleVel;

      // ── Screen shake on transients ──
      if (peakAmt > 0.8) {
        state.shakeX = (Math.random() - 0.5) * 3 * peakAmt;
        state.shakeY = (Math.random() - 0.5) * 3 * peakAmt;
      } else {
        state.shakeX *= 0.85;
        state.shakeY *= 0.85;
      }

      ctx.save();
      ctx.translate(state.shakeX, state.shakeY);

      // ── Rim glow with peak ──
      state.rimGlow += (peakAmt - state.rimGlow) * 0.15;

      // ── Outer bezel shadow ──
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR + 8, 0, Math.PI * 2);
      const bezelGrad = ctx.createRadialGradient(cx - 15, cy - 15, gaugeR - 10, cx, cy, gaugeR + 10);
      bezelGrad.addColorStop(0, '#3a3e44');
      bezelGrad.addColorStop(0.5, '#222628');
      bezelGrad.addColorStop(1, '#0e1014');
      ctx.fillStyle = bezelGrad;
      ctx.fill();

      // ── Pulsing red rim glow on loud hits ──
      if (state.rimGlow > 0.1) {
        ctx.beginPath();
        ctx.arc(cx, cy, gaugeR + 6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 40, 20, ${state.rimGlow * 0.6})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = `rgba(255, 30, 10, ${state.rimGlow * 0.8})`;
        ctx.shadowBlur = 15 + state.rimGlow * 20;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // ── LED dots around rim ──
      const numLEDs = 24;
      const ledStartAngle = -225;
      const ledSweepAngle = 270;
      for (let i = 0; i < numLEDs; i++) {
        const t = i / (numLEDs - 1);
        const ledAngle = (ledStartAngle + t * ledSweepAngle) * Math.PI / 180;
        const lx = cx + (gaugeR + 2) * Math.cos(ledAngle);
        const ly = cy + (gaugeR + 2) * Math.sin(ledAngle);

        // LED lights up progressively with GR
        const shouldLight = t <= grNorm;
        const targetBright = shouldLight ? 1 : 0.08;
        state.ledStates[i] += (targetBright - state.ledStates[i]) * 0.2;
        const bright = state.ledStates[i];

        // Color: green -> yellow -> red
        let r, g, b;
        if (t < 0.4) { r = 40; g = 200; b = 40; }
        else if (t < 0.7) { r = 220; g = 200; b = 20; }
        else { r = 255; g = 40; b = 20; }

        ctx.beginPath();
        ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 + bright * 0.9})`;
        if (bright > 0.5) {
          ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${bright * 0.8})`;
          ctx.shadowBlur = 6;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── Gauge face - brushed metal texture ──
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR - 4, 0, Math.PI * 2);
      const faceGrad = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, gaugeR);
      faceGrad.addColorStop(0, '#4a4e54');
      faceGrad.addColorStop(0.3, '#2a2e34');
      faceGrad.addColorStop(0.7, '#1a1e24');
      faceGrad.addColorStop(1, '#141618');
      ctx.fillStyle = faceGrad;
      ctx.fill();

      // Brushed metal lines
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR - 5, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.04;
      for (let i = 0; i < 200; i++) {
        const y = cy - gaugeR + i * (gaugeR * 2 / 200);
        ctx.beginPath();
        ctx.moveTo(cx - gaugeR, y + Math.sin(i * 0.8) * 0.5);
        ctx.lineTo(cx + gaugeR, y + Math.cos(i * 1.1) * 0.5);
        ctx.strokeStyle = i % 3 === 0 ? '#909498' : '#606468';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      ctx.restore();

      // ── Tick marks and numbers ──
      const dbMarks = [
        { db: 0, label: '0' },
        { db: 3, label: '-3' },
        { db: 6, label: '-6' },
        { db: 12, label: '-12' },
        { db: 20, label: '-20' },
      ];

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Minor ticks
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const angle = (-225 + t * 270) * Math.PI / 180;
        const innerR = gaugeR - (i % 3 === 0 ? 22 : 18);
        const outerR = gaugeR - 12;
        ctx.beginPath();
        ctx.moveTo(cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle));
        ctx.lineTo(cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle));
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(200, 200, 200, 0.5)' : 'rgba(150, 150, 150, 0.25)';
        ctx.lineWidth = i % 3 === 0 ? 1.5 : 0.8;
        ctx.stroke();
      }

      // dB labels
      dbMarks.forEach(({ db, label }) => {
        const t = db / 24;
        const angle = (-225 + t * 270) * Math.PI / 180;
        const labelR = gaugeR - 32;
        const lx = cx + labelR * Math.cos(angle);
        const ly = cy + labelR * Math.sin(angle);

        // Danger zone coloring
        const isDanger = db >= 12;
        ctx.font = `bold ${isDanger ? 10 : 9}px "Courier New", monospace`;
        ctx.fillStyle = isDanger ? 'rgba(255, 60, 40, 0.85)' : 'rgba(200, 200, 200, 0.6)';
        ctx.fillText(label, lx, ly);
      });

      // "dB" unit text
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.fillStyle = 'rgba(200, 60, 60, 0.4)';
      ctx.fillText('dB', cx, cy + 35);

      // ── Danger zone arc (red arc from -12 to -24) ──
      const dangerStart = (-225 + (12 / 24) * 270) * Math.PI / 180;
      const dangerEnd = (-225 + 270) * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR - 10, dangerStart, dangerEnd);
      ctx.strokeStyle = 'rgba(255, 40, 20, 0.25)';
      ctx.lineWidth = 6;
      ctx.stroke();

      // ── Glass crack effect when GR > 10dB ──
      if (_gr > 10) {
        const crackIntensity = Math.min((_gr - 10) / 14, 1);
        // Generate cracks if we don't have enough
        if (state.cracks.length < Math.floor(crackIntensity * 8) + 1) {
          const angle = Math.random() * Math.PI * 2;
          const startR = 20 + Math.random() * 40;
          const segments = [];
          let curX = cx + Math.cos(angle) * startR;
          let curY = cy + Math.sin(angle) * startR;
          const numSegs = 4 + Math.floor(Math.random() * 6);
          for (let s = 0; s < numSegs; s++) {
            const dx = (Math.random() - 0.5) * 30;
            const dy = (Math.random() - 0.5) * 30;
            segments.push({ x: curX + dx, y: curY + dy });
            curX += dx; curY += dy;
          }
          state.cracks.push({ segments, alpha: crackIntensity });
        }

        state.cracks.forEach(crack => {
          if (crack.segments.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(crack.segments[0].x, crack.segments[0].y);
          for (let s = 1; s < crack.segments.length; s++) {
            ctx.lineTo(crack.segments[s].x, crack.segments[s].y);
          }
          ctx.strokeStyle = `rgba(255, 255, 255, ${crackIntensity * 0.3})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
          // Secondary lighter crack line
          ctx.strokeStyle = `rgba(200, 200, 220, ${crackIntensity * 0.15})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      } else {
        state.cracks = [];
      }

      // ── Needle ──
      const needleRad = (state.needleAngle - 90) * Math.PI / 180;
      const needleLen = gaugeR - 18;

      // Needle shadow
      ctx.save();
      ctx.translate(2, 2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(needleRad) * needleLen,
        cy + Math.sin(needleRad) * needleLen
      );
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Needle body - tapered
      ctx.beginPath();
      const needleTipX = cx + Math.cos(needleRad) * needleLen;
      const needleTipY = cy + Math.sin(needleRad) * needleLen;
      const needlePerp = needleRad + Math.PI / 2;
      const baseW = 4;
      ctx.moveTo(cx + Math.cos(needlePerp) * baseW, cy + Math.sin(needlePerp) * baseW);
      ctx.lineTo(needleTipX, needleTipY);
      ctx.lineTo(cx - Math.cos(needlePerp) * baseW, cy - Math.sin(needlePerp) * baseW);
      ctx.closePath();

      const needleGrad = ctx.createLinearGradient(cx, cy, needleTipX, needleTipY);
      needleGrad.addColorStop(0, '#cc2020');
      needleGrad.addColorStop(0.7, '#ff3030');
      needleGrad.addColorStop(1, '#ff5050');
      ctx.fillStyle = needleGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,200,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Needle center cap
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      const capGrad = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, 8);
      capGrad.addColorStop(0, '#606468');
      capGrad.addColorStop(0.5, '#3a3e44');
      capGrad.addColorStop(1, '#1a1e24');
      ctx.fillStyle = capGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,60,60,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Tiny red dot on cap center
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3030';
      ctx.shadowColor = 'rgba(255,40,20,0.8)';
      ctx.shadowBlur = 4;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── "GAIN REDUCTION" text ──
      ctx.font = 'bold 7px system-ui, -apple-system, Arial, sans-serif';
      ctx.fillStyle = 'rgba(200, 60, 60, 0.5)';
      ctx.letterSpacing = '2px';
      ctx.fillText('GAIN REDUCTION', cx, cy + 48);

      // ── GR readout ──
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = _gr > 10 ? '#ff4040' : _gr > 3 ? '#e06040' : 'rgba(200,200,200,0.7)';
      if (_gr > 10) {
        ctx.shadowColor = 'rgba(255,40,20,0.6)';
        ctx.shadowBlur = 8;
      }
      ctx.fillText(_gr > 0.1 ? `-${_gr.toFixed(1)}` : '0.0', cx, cy + 65);
      ctx.shadowBlur = 0;

      // ── "DANGER: HIGH PRESSURE" stencil ──
      if (_macro > 0.6) {
        ctx.save();
        ctx.font = 'bold 5px system-ui, Arial, sans-serif';
        ctx.fillStyle = `rgba(255, 60, 40, ${0.15 + (_macro - 0.6) * 0.4})`;
        ctx.translate(cx, cy - 72);
        ctx.fillText('DANGER: HIGH PRESSURE', 0, 0);
        ctx.restore();
      }

      ctx.restore(); // end shake transform

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      width: 260, height: 260, display: 'block',
    }} />
  );
}

// ─── Hex Bolt Knob ─────────────────────────────────────────────────────────
function HexBoltKnob({ size = 32, norm = 0, hexSize }) {
  const cx = (size + 8) / 2, cy = (size + 8) / 2, r = size / 2 - 1;
  const id = useRef(`hx-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const hexR = hexSize || (size * 0.32);

  // Build hexagonal bolt shape
  const hexPoints = [];
  for (let i = 0; i < 6; i++) {
    const a = (angle + i * 60) * Math.PI / 180;
    hexPoints.push(`${cx + Math.cos(a) * hexR},${cy + Math.sin(a) * hexR}`);
  }

  // LED position dot at edge
  const ledAngle = (angle - 90) * Math.PI / 180;
  const ledX = cx + Math.cos(ledAngle) * (r - 1);
  const ledY = cy + Math.sin(ledAngle) * (r - 1);

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-base`} cx="35%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#707478" />
          <stop offset="30%" stopColor="#404448" />
          <stop offset="70%" stopColor="#222628" />
          <stop offset="100%" stopColor="#141618" />
        </radialGradient>
        <linearGradient id={`${id}-hex`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#808488" />
          <stop offset="40%" stopColor="#505458" />
          <stop offset="100%" stopColor="#303438" />
        </linearGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="rgba(0,0,0,0.7)" />
        </filter>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation="2" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Brushed metal base ring */}
      <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="rgba(80,86,96,0.3)" strokeWidth={1} />
      {/* Main knob body */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-base)`} filter={`url(#${id}-sh)`} />
      {/* Subtle ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(100,106,116,0.2)" strokeWidth={0.6} />
      {/* Hex bolt - rotates with value */}
      <polygon points={hexPoints.join(' ')} fill={`url(#${id}-hex)`} stroke="rgba(0,0,0,0.4)" strokeWidth={0.8} />
      {/* Hex bolt inner shadow */}
      <polygon points={hexPoints.join(' ')} fill="none" stroke="rgba(140,148,160,0.15)" strokeWidth={0.4} />
      {/* LED dot */}
      <circle cx={ledX} cy={ledY} r={1.8} fill="#ff3030" filter={`url(#${id}-glow)`} />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, hexSize, format, step, sensitivity = 140 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => {
      let raw = ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity;
      if (step) raw = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, raw)));
    };
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2 }}>
      <span style={{ fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(220,80,80,0.8)', fontWeight: 900, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: '"Courier New", monospace' }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <HexBoltKnob size={size} norm={norm} hexSize={hexSize} />
      </div>
      <span style={{ fontSize: 5.5, color: 'rgba(200,60,60,0.5)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── HERO Macro Slider (140px tall, 20px wide, center of plugin) ──────────
function MacroSlider({ value, onChange }) {
  const ref = useRef({ y: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const height = 140;
  const norm = value;

  const fillColor = value < 0.3 ? 'rgba(140,148,160,0.2)'
    : value < 0.55 ? 'rgba(200,50,50,0.15)'
    : value < 0.8 ? 'rgba(200,50,50,0.25)'
    : 'rgba(255,40,30,0.35)';
  const thumbColor = value < 0.3 ? '#909498'
    : value < 0.55 ? '#d04040'
    : value < 0.8 ? '#e04040'
    : '#ff3030';
  const glowColor = value < 0.3 ? '0 0 8px rgba(140,148,160,0.4)'
    : value < 0.55 ? '0 0 12px rgba(200,50,50,0.5)'
    : value < 0.8 ? '0 0 16px rgba(220,50,40,0.6)'
    : '0 0 20px rgba(255,40,30,0.7), 0 0 40px rgba(255,20,0,0.3)';

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(0, Math.min(1, ref.current.v + (ref.current.y - ev.clientY) / (height * 1.3))));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const label = value < 0.25 ? 'GLUE' : value < 0.55 ? 'PUNCH' : value < 0.8 ? 'CRUSH' : 'DESTROY';
  const labelColor = value < 0.25 ? '#909498'
    : value < 0.55 ? '#d04040'
    : value < 0.8 ? '#e04040'
    : '#ff3030';

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, userSelect: 'none', position: 'relative', zIndex: 5 }}>
      <span style={{
        fontSize: 10, fontWeight: 900, letterSpacing: '0.25em',
        color: labelColor,
        fontFamily: '"Courier New", monospace',
        transition: 'color 0.2s',
        textShadow: value > 0.7 ? `0 0 12px ${labelColor}` : 'none',
      }}>{label}</span>

      <div style={{ position: 'relative' }}>
        {ticks.map((t, i) => (
          <div key={i} style={{
            position: 'absolute', right: -8, width: 5, height: 1,
            background: 'rgba(200,60,60,0.15)',
            bottom: t * height - 0.5, zIndex: 1,
          }} />
        ))}
        {ticks.map((t, i) => (
          <div key={`l${i}`} style={{
            position: 'absolute', left: -8, width: 5, height: 1,
            background: 'rgba(200,60,60,0.15)',
            bottom: t * height - 0.5, zIndex: 1,
          }} />
        ))}

        <div onPointerDown={onDown} onDoubleClick={() => onChange(0.3)}
          style={{
            width: 20, height, background: '#101214',
            borderRadius: 4,
            border: '1.5px solid rgba(200,60,60,0.12)',
            position: 'relative', cursor: dragging ? 'grabbing' : 'grab',
            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.6)',
          }}>
          <div style={{
            position: 'absolute', bottom: 0, left: 2, right: 2,
            height: `${norm * 100}%`,
            background: fillColor,
            borderRadius: 2,
            transition: dragging ? 'none' : 'height 0.05s',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: 4, bottom: 4,
            width: 1, marginLeft: -0.5,
            background: 'rgba(200,60,60,0.06)',
          }} />
          <div style={{
            position: 'absolute', left: -4, right: -4, height: 10,
            borderRadius: 2,
            background: `linear-gradient(180deg, ${thumbColor} 0%, ${thumbColor}cc 100%)`,
            bottom: `calc(${norm * 100}% - 5px)`,
            boxShadow: glowColor,
            transition: 'background 0.2s, box-shadow 0.2s',
            border: '1px solid rgba(255,255,255,0.15)',
          }}>
            <div style={{ position: 'absolute', top: 3, left: 4, right: 4, height: 1, background: 'rgba(0,0,0,0.3)' }} />
            <div style={{ position: 'absolute', top: 6, left: 4, right: 4, height: 1, background: 'rgba(0,0,0,0.3)' }} />
          </div>
        </div>
      </div>

      <span style={{
        fontSize: 8, fontWeight: 900, letterSpacing: '0.2em',
        color: 'rgba(220,80,80,0.5)',
        fontFamily: '"Courier New", monospace',
      }}>MACRO</span>
      <span style={{
        fontSize: 8, color: 'rgba(200,60,60,0.4)',
        fontFamily: '"Courier New",monospace', fontWeight: 700,
      }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

// ─── Horizontal Input/Output Slider ────────────────────────────────────────
function HSlider({ value, onChange, label, min = 0, max = 2, defaultValue = 1, width = 110, format }) {
  const ref = useRef({ x: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { x: e.clientX, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ev.clientX - ref.current.x) * (max - min) / (width * 1.3))));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, userSelect: 'none', flex: 1, position: 'relative', zIndex: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 6.5, fontWeight: 900, color: 'rgba(220,80,80,0.6)', letterSpacing: '0.14em', fontFamily: '"Courier New", monospace' }}>{label}</span>
        <span style={{ fontSize: 6.5, color: 'rgba(200,60,60,0.5)', fontFamily: '"Courier New",monospace', fontWeight: 700 }}>{display}</span>
      </div>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{
          width: '100%', height: 10, background: '#101214',
          borderRadius: 2, border: '1px solid rgba(200,60,60,0.08)',
          position: 'relative', cursor: dragging ? 'grabbing' : 'grab',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
        }}>
        <div style={{
          position: 'absolute', top: 1, bottom: 1, left: 1,
          width: `${norm * 100}%`,
          background: 'rgba(200,50,50,0.08)',
          borderRadius: 1,
          transition: dragging ? 'none' : 'width 0.05s',
        }} />
        <div style={{
          position: 'absolute', top: -2, width: 8, height: 14,
          borderRadius: 2,
          background: 'linear-gradient(180deg, #909498 0%, #505560 100%)',
          left: `calc(${norm * 100}% - 4px)`,
          boxShadow: '0 0 6px rgba(200,50,50,0.3)',
          border: '1px solid rgba(255,255,255,0.1)',
        }} />
      </div>
    </div>
  );
}

// ─── dB Readouts ──────────────────────────────────────────────────────────
function DbReadout({ dbRef, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 6, fontWeight: 900, color: 'rgba(200,60,60,0.4)', letterSpacing: '0.12em', fontFamily: '"Courier New", monospace' }}>{label}</span>
      <span ref={dbRef} style={{
        fontSize: 7.5, fontFamily: '"Courier New",monospace', fontWeight: 700,
        color: 'rgba(200,60,60,0.5)', letterSpacing: '0.05em',
      }}>-inf<span style={{ fontSize: 5, opacity: 0.6 }}>dB</span></span>
    </div>
  );
}

function updateDbReadout(dbEl, level) {
  if (!dbEl) return;
  const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
  const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-inf';
  const color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#e06040' : 'rgba(200,60,60,0.4)';
  dbEl.style.color = color;
  dbEl.firstChild.textContent = display;
}

// ─── Big Red Emergency STOP Button (Bypass) ───────────────────────────────
function EmergencyStopButton({ active, onToggle }) {
  const [pressed, setPressed] = useState(false);

  return (
    <div
      onClick={onToggle}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        position: 'relative',
        width: 52, height: 52,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Warning stripes ring (yellow/black) */}
      <svg width={52} height={52} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          <pattern id="warn-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill="#ccaa00" />
            <rect x="3" width="3" height="6" fill="#1a1a1a" />
          </pattern>
        </defs>
        <circle cx="26" cy="26" r="25" fill="url(#warn-stripe)" />
        <circle cx="26" cy="26" r="25" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
      </svg>

      {/* Button body */}
      <div style={{
        position: 'absolute',
        top: pressed ? 9 : 7,
        left: pressed ? 9 : 7,
        width: pressed ? 34 : 38,
        height: pressed ? 34 : 38,
        borderRadius: '50%',
        background: active
          ? `radial-gradient(circle at 40% 35%, #ff4040 0%, #cc2020 40%, #881010 80%, #661010 100%)`
          : `radial-gradient(circle at 40% 35%, #884040 0%, #552020 40%, #331010 80%, #220808 100%)`,
        border: `2px solid ${active ? 'rgba(255,100,100,0.4)' : 'rgba(100,50,50,0.3)'}`,
        boxShadow: active
          ? `0 2px 8px rgba(0,0,0,0.6), 0 0 20px rgba(255,40,20,0.4), inset 0 -2px 4px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,150,150,0.2)`
          : `0 1px 4px rgba(0,0,0,0.4), inset 0 2px 4px rgba(0,0,0,0.5)`,
        transition: 'all 0.1s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* STOP text */}
        <span style={{
          fontSize: active ? 7 : 6.5,
          fontWeight: 900,
          color: active ? 'rgba(255,255,255,0.9)' : 'rgba(200,150,150,0.4)',
          letterSpacing: '0.15em',
          fontFamily: '"Courier New", monospace',
          textShadow: active ? '0 0 6px rgba(255,50,50,0.5)' : 'none',
        }}>{active ? 'STOP' : 'OFF'}</span>
      </div>

      {/* Pulsing glow animation when active */}
      {active && (
        <div style={{
          position: 'absolute', top: 5, left: 5, right: 5, bottom: 5,
          borderRadius: '50%',
          boxShadow: '0 0 15px rgba(255,40,20,0.5), 0 0 30px rgba(255,20,0,0.25)',
          animation: 'emergencyPulse 1.2s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      <style>{`
        @keyframes emergencyPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Hex Bolt (corner bolts) ───────────────────────────────────────────────
function HexBolt({ top, left, right, bottom }) {
  const hexR = 5;
  const cx = 6, cy = 6;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 - 30) * Math.PI / 180;
    pts.push(`${cx + Math.cos(a) * hexR},${cy + Math.sin(a) * hexR}`);
  }
  return (
    <div style={{ position: 'absolute', top, left, right, bottom, width: 12, height: 12, zIndex: 20 }}>
      <svg width={12} height={12} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="bolt-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#606468" />
            <stop offset="50%" stopColor="#3a3e44" />
            <stop offset="100%" stopColor="#1a1e22" />
          </linearGradient>
        </defs>
        <polygon points={pts.join(' ')} fill="url(#bolt-grad)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.6" />
        {/* Socket detail */}
        <polygon points={pts.map((p, i) => {
          const a = (i * 60 - 30) * Math.PI / 180;
          return `${cx + Math.cos(a) * 2.5},${cy + Math.sin(a) * 2.5}`;
        }).join(' ')} fill="rgba(0,0,0,0.3)" />
      </svg>
    </div>
  );
}

// ─── Warning Tape Stripe ──────────────────────────────────────────────────
function WarningTape() {
  return (
    <div style={{
      width: '100%', height: 8, position: 'relative', overflow: 'hidden',
      zIndex: 15,
    }}>
      <svg width="100%" height="8" style={{ display: 'block' }}>
        <defs>
          <pattern id="warning-tape" width="12" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="8" fill="#ccaa00" />
            <rect x="6" width="6" height="8" fill="#1a1a00" />
          </pattern>
        </defs>
        <rect width="100%" height="8" fill="url(#warning-tape)" opacity="0.7" />
      </svg>
    </div>
  );
}

// ─── Metal Panel Seam ─────────────────────────────────────────────────────
function PanelSeam() {
  return (
    <div style={{
      width: '100%', height: 3, position: 'relative',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(60,64,70,0.15) 40%, rgba(0,0,0,0.3) 60%, rgba(80,86,96,0.1) 100%)',
      boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.3), 0 1px 0 rgba(100,106,116,0.05)',
    }}>
      {/* Rivet dots */}
      <div style={{ position: 'absolute', top: 0.5, left: 20, width: 3, height: 2, borderRadius: '50%', background: 'radial-gradient(circle at 40% 30%, #505560 0%, #303438 100%)', boxShadow: '0 0.5px 1px rgba(0,0,0,0.5)' }} />
      <div style={{ position: 'absolute', top: 0.5, right: 20, width: 3, height: 2, borderRadius: '50%', background: 'radial-gradient(circle at 40% 30%, #505560 0%, #303438 100%)', boxShadow: '0 0.5px 1px rgba(0,0,0,0.5)' }} />
      <div style={{ position: 'absolute', top: 0.5, left: '50%', marginLeft: -1.5, width: 3, height: 2, borderRadius: '50%', background: 'radial-gradient(circle at 40% 30%, #505560 0%, #303438 100%)', boxShadow: '0 0.5px 1px rgba(0,0,0,0.5)' }} />
    </div>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',       macro: 0.3, attack: 0.3, release: 0.4, tone: 0.5, punch: 0,   smash: 0,   mix: 1 },
  { name: 'BUS GLUE',   macro: 0.15,attack: 0.4, release: 0.35,tone: 0.5, punch: 0.1, smash: 0,   mix: 1 },
  { name: 'DRUM PUNCH', macro: 0.45,attack: 0.15,release: 0.3, tone: 0.55,punch: 0.5, smash: 0.1, mix: 1 },
  { name: 'FAT BUS',    macro: 0.35,attack: 0.5, release: 0.45,tone: 0.4, punch: 0.2, smash: 0.2, mix: 0.7 },
  { name: 'NY CRUSH',   macro: 0.6, attack: 0.1, release: 0.2, tone: 0.6, punch: 0.3, smash: 0.6, mix: 0.8 },
  { name: 'PARALLEL',   macro: 0.5, attack: 0.2, release: 0.3, tone: 0.5, punch: 0.2, smash: 0.8, mix: 0.5 },
  { name: 'SQUEEZE',    macro: 0.75,attack: 0.35,release: 0.5, tone: 0.45,punch: 0.4, smash: 0.3, mix: 1 },
  { name: 'DESTROY',    macro: 0.95,attack: 0.05,release: 0.15,tone: 0.6, punch: 0.5, smash: 0.9, mix: 1 },
];

const PRESET_COLORS = {
  bg: '#101216', text: 'rgba(220,80,80,0.8)', textDim: 'rgba(200,60,60,0.4)',
  border: 'rgba(200,60,60,0.1)', hoverBg: 'rgba(200,60,60,0.08)', activeBg: 'rgba(200,60,60,0.05)',
};

// ─── Main GluesmashOrb ──────────────────────────────────────────────────────
export default function GluesmashOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [macro,   setMacro]   = useState(initialState?.macro   ?? 0.3);
  const [attack,  setAttack]  = useState(initialState?.attack  ?? 0.3);
  const [release, setRelease] = useState(initialState?.release ?? 0.4);
  const [tone,    setTone]    = useState(initialState?.tone    ?? 0.5);
  const [punch,   setPunch]   = useState(initialState?.punch   ?? 0);
  const [smash,   setSmash]   = useState(initialState?.smash   ?? 0);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [gr, setGr] = useState(0);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);

  const inDbRef  = useRef(null);
  const outDbRef = useRef(null);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, macro, attack, release, tone, punch, smash, mix, bypassed };

  // ── Engine init ──
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createGluesmashEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setMacro(s.macro); eng.setAttack(s.attack); eng.setRelease(s.release);
      eng.setTone(s.tone); eng.setPunch(s.punch); eng.setSmash(s.smash);
      eng.setMix(s.mix); eng.setBypass(s.bypassed);
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

  // ── Meter + GR polling ──
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        const inPeak = engineRef.current.getInputPeak();
        const oPeak = engineRef.current.getOutputPeak?.() || engineRef.current.getPeakOutput?.() || 0;
        updateDbReadout(inDbRef.current, inPeak);
        updateDbReadout(outDbRef.current, oPeak);
        setGr(engineRef.current.getGR());
        setPeak(inPeak);
        setOutPeak(oPeak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, macro, attack, release, tone, punch, smash, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, macro, attack, release, tone, punch, smash, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setMacro(p.macro); setAttack(p.attack); setRelease(p.release);
    setTone(p.tone); setPunch(p.punch); setSmash(p.smash); setMix(p.mix);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setMacro(p.macro); e.setAttack(p.attack); e.setRelease(p.release);
      e.setTone(p.tone); e.setPunch(p.punch); e.setSmash(p.smash); e.setMix(p.mix);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 380, borderRadius: 4, position: 'relative',
      background: `
        linear-gradient(170deg, #1e2024 0%, #181a1e 20%, #141618 50%, #101214 80%, #141618 100%)
      `,
      border: '1.5px solid rgba(180,40,40,0.18)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(200,50,50,0.08), inset 0 1px 0 rgba(160,168,180,0.06)',
      fontFamily: '"Courier New", monospace',
      userSelect: 'none',
      overflow: 'hidden',
    }}>
      {/* Brushed metal noise texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        opacity: 0.035,
        backgroundImage: `repeating-linear-gradient(
          90deg,
          transparent, transparent 1px,
          rgba(160,168,180,0.5) 1px, rgba(160,168,180,0.5) 2px
        )`,
        backgroundSize: '3px 100%',
      }} />
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        opacity: 0.018,
        backgroundImage: `repeating-linear-gradient(
          0deg,
          transparent, transparent 2px,
          rgba(120,126,136,0.4) 2px, rgba(120,126,136,0.4) 3px
        )`,
        backgroundSize: '100% 5px',
      }} />

      {/* Corner Hex Bolts */}
      <HexBolt top={5} left={5} />
      <HexBolt top={5} right={5} />
      <HexBolt bottom={5} left={5} />
      <HexBolt bottom={5} right={5} />

      {/* ═══ WARNING TAPE TOP EDGE ═══ */}
      <WarningTape />

      {/* ═══ HEADER ═══ */}
      <div style={{
        padding: '8px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.12em',
            background: 'linear-gradient(180deg, #ff4040 0%, #cc2020 50%, #ff6060 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 1px 4px rgba(200,50,50,0.4))',
            fontFamily: '"Courier New", monospace',
          }}>GLUESMASH</span>
          <span style={{
            fontSize: 5.5, fontWeight: 700, color: 'rgba(200,60,60,0.4)',
            letterSpacing: '0.5em', marginTop: 2, textTransform: 'uppercase',
          }}>pressure machine</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', zIndex: 10 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(200,60,60,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 12, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700,
            lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
          >x</span>}
        </div>
      </div>

      <PanelSeam />

      {/* ═══ GIANT PRESSURE GAUGE ═══ */}
      <div style={{
        display: 'flex', justifyContent: 'center', padding: '4px 0',
        background: 'radial-gradient(ellipse at center, rgba(20,22,26,1) 0%, rgba(16,18,20,1) 100%)',
        position: 'relative', zIndex: 2,
      }}>
        <PressureGauge macro={macro} gr={gr} smash={smash} punch={punch} peak={peak} outPeak={outPeak} />
      </div>

      <PanelSeam />

      {/* ═══ MAIN CONTROL ZONE: left knobs | MACRO slider | right knobs ═══ */}
      <div style={{
        position: 'relative',
      }}>
        <div style={{
          position: 'relative', zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '10px 16px',
          gap: 12,
          minHeight: 180,
        }}>
          {/* LEFT COLUMN: ATK, REL, TONE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <Knob label="ATK" value={attack} min={0} max={1} defaultValue={0.3} size={28} hexSize={10}
              onChange={v => { setAttack(v); engineRef.current?.setAttack(v); setActivePreset(null); }}
              format={v => { const ms = 0.1 * Math.pow(1000, v); return ms < 1 ? `${(ms * 1000).toFixed(0)}us` : ms < 10 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`; }} />
            <Knob label="REL" value={release} min={0} max={1} defaultValue={0.4} size={28} hexSize={10}
              onChange={v => { setRelease(v); engineRef.current?.setRelease(v); setActivePreset(null); }}
              format={v => { const ms = 20 * Math.pow(40, v); return ms < 100 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`; }} />
            <Knob label="TONE" value={tone} min={0} max={1} defaultValue={0.5} size={28} hexSize={9}
              onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }}
              format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'FLAT'} />
          </div>

          {/* CENTER: HERO MACRO SLIDER */}
          <MacroSlider value={macro} onChange={v => { setMacro(v); engineRef.current?.setMacro(v); setActivePreset(null); }} />

          {/* RIGHT COLUMN: PUNCH, SMASH, MIX */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <Knob label="PUNCH" value={punch} min={0} max={1} defaultValue={0} size={28} hexSize={10}
              onChange={v => { setPunch(v); engineRef.current?.setPunch(v); setActivePreset(null); }}
              format={pctFmt} />
            <Knob label="SMASH" value={smash} min={0} max={1} defaultValue={0} size={28} hexSize={10}
              onChange={v => { setSmash(v); engineRef.current?.setSmash(v); setActivePreset(null); }}
              format={pctFmt} />
            <Knob label="MIX" value={mix} min={0} max={1} defaultValue={1} size={28} hexSize={9}
              onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }}
              format={pctFmt} />
          </div>
        </div>
      </div>

      <PanelSeam />

      {/* ═══ dB READOUTS ═══ */}
      <div style={{
        display: 'flex', justifyContent: 'space-around', padding: '5px 22px',
        position: 'relative', zIndex: 2,
      }}>
        <DbReadout dbRef={inDbRef} label="IN" />
        <DbReadout dbRef={outDbRef} label="OUT" />
      </div>

      {/* ═══ HORIZONTAL IN/OUT SLIDERS ═══ */}
      <div style={{
        display: 'flex', gap: 12, padding: '6px 22px',
        position: 'relative', zIndex: 2,
      }}>
        <HSlider label="INPUT" value={inputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <HSlider label="OUTPUT" value={outputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      <PanelSeam />

      {/* ═══ BOTTOM BAR: Emergency Stop + status ═══ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 22px 8px',
        position: 'relative', zIndex: 10,
      }}>
        <EmergencyStopButton active={!bypassed} onToggle={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          {/* Status LED row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: bypassed ? '#442222' : '#44cc44',
              boxShadow: bypassed ? 'none' : '0 0 6px rgba(60,200,60,0.6)',
            }} />
            <span style={{
              fontSize: 6, fontWeight: 900, letterSpacing: '0.2em',
              color: bypassed ? 'rgba(200,60,60,0.3)' : 'rgba(60,200,60,0.7)',
              fontFamily: '"Courier New", monospace',
            }}>{bypassed ? 'BYPASSED' : 'ENGAGED'}</span>
          </div>
          <span style={{
            fontSize: 4.5, color: 'rgba(200,60,60,0.25)', letterSpacing: '0.15em',
            fontFamily: '"Courier New", monospace',
          }}>MODEL 7700 REV.B</span>
        </div>
      </div>

      {/* ═══ WARNING TAPE BOTTOM EDGE ═══ */}
      <WarningTape />
    </div>
  );
}
