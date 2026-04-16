import { useState, useEffect, useRef, useCallback } from 'react';
import { createBassmindEngine } from './bassmindEngine';
import PresetSelector from './PresetSelector';

// ─── BASSMIND: Mass Stabilizer ─────────────────────────────────────────────
// DEEP SEA SUBMARINE SONAR — Circular sonar display, valve wheel knobs,
// dive klaxon toggle, bubble particles, depth gauge, classified watermark

// ─── Sonar Sweep Display (canvas) ─────────────────────────────────────────
function SonarDisplay({ weight, tight, focus, growl, subLevel, peak }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ weight: 0, tight: 0, focus: 0, growl: 0, subLevel: 0, peak: 0 });
  const animRef = useRef({
    sweepAngle: 0, sweepSpeed: 0.8,
    blips: [], shockwaves: [], bubbles: [],
    ringDistortions: new Array(5).fill(0),
    phase: 0,
  });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { weight, tight, focus, growl, subLevel, peak };

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
      const sonarR = 118;
      state.phase += 0.008;

      // Read LIVE values from ref (not stale closure!)
      const { weight: _weight, tight: _tight, focus: _focus, growl: _growl, subLevel: _subLevel, peak: _peak } = valRef.current;
      const peakAmt = _peak || 0;
      const subAmt = _subLevel || 0;

      // ── Dark ocean background ──
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sonarR + 10);
      bgGrad.addColorStop(0, '#0a1a28');
      bgGrad.addColorStop(0.5, '#061018');
      bgGrad.addColorStop(1, '#020810');
      ctx.beginPath();
      ctx.arc(cx, cy, sonarR + 8, 0, Math.PI * 2);
      ctx.fillStyle = bgGrad;
      ctx.fill();

      // Outer ring bezel
      ctx.beginPath();
      ctx.arc(cx, cy, sonarR + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 200, 220, 0.2)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, sonarR + 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 100, 120, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // ── Concentric range rings (wobble with bass) ──
      const numRings = 5;
      for (let i = 1; i <= numRings; i++) {
        const baseR = (sonarR / numRings) * i;

        // Wobble distortion from bass
        state.ringDistortions[i - 1] += (subAmt * 4 - state.ringDistortions[i - 1]) * 0.06;
        const distort = state.ringDistortions[i - 1];

        ctx.beginPath();
        const segments = 64;
        for (let s = 0; s <= segments; s++) {
          const angle = (s / segments) * Math.PI * 2;
          const wobble = Math.sin(angle * 3 + state.phase * 2 + i) * distort +
                         Math.cos(angle * 5 - state.phase * 1.5) * distort * 0.5;
          const r = baseR + wobble;
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(0, 180, 200, ${0.08 + (i === numRings ? 0.06 : 0)})`;
        ctx.lineWidth = i === numRings ? 1.2 : 0.6;
        ctx.stroke();

        // Range label
        const depthLabel = `${i * 40}m`;
        ctx.font = '6px "Courier New", monospace';
        ctx.fillStyle = 'rgba(0, 180, 200, 0.2)';
        ctx.textAlign = 'right';
        ctx.fillText(depthLabel, cx + baseR - 3, cy - 2);
      }

      // ── Cross-hair lines ──
      ctx.strokeStyle = 'rgba(0, 180, 200, 0.06)';
      ctx.lineWidth = 0.5;
      // Horizontal
      ctx.beginPath(); ctx.moveTo(cx - sonarR, cy); ctx.lineTo(cx + sonarR, cy); ctx.stroke();
      // Vertical
      ctx.beginPath(); ctx.moveTo(cx, cy - sonarR); ctx.lineTo(cx, cy + sonarR); ctx.stroke();

      // ── Sweep line (rotating radar arm) ──
      // Speed scales with peak level
      const targetSpeed = 0.6 + peakAmt * 2.5;
      state.sweepSpeed += (targetSpeed - state.sweepSpeed) * 0.08;
      state.sweepAngle += state.sweepSpeed * 0.03;
      if (state.sweepAngle > Math.PI * 2) state.sweepAngle -= Math.PI * 2;

      // Sweep trail (fading arc behind the line)
      const trailSegments = 30;
      for (let t = 0; t < trailSegments; t++) {
        const trailAngle = state.sweepAngle - (t / trailSegments) * (Math.PI * 0.4);
        const alpha = (1 - t / trailSegments) * 0.15;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(
          cx + Math.cos(trailAngle) * sonarR,
          cy + Math.sin(trailAngle) * sonarR
        );
        ctx.strokeStyle = `rgba(0, 220, 240, ${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Main sweep line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const sweepEndX = cx + Math.cos(state.sweepAngle) * sonarR;
      const sweepEndY = cy + Math.sin(state.sweepAngle) * sonarR;
      ctx.lineTo(sweepEndX, sweepEndY);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 220, 240, 0.8)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ── Blips (bass energy dots) ──
      // Spawn blips near the sweep line based on sub energy
      if (subAmt > 0.1 && Math.random() < subAmt * 0.3) {
        const blipDist = 15 + Math.random() * (sonarR - 25);
        const blipAngle = state.sweepAngle + (Math.random() - 0.5) * 0.3;
        state.blips.push({
          x: cx + Math.cos(blipAngle) * blipDist,
          y: cy + Math.sin(blipAngle) * blipDist,
          alpha: 0.5 + subAmt * 0.5,
          life: 1,
          size: 2 + subAmt * 3,
        });
      }
      // Also spawn from weight/focus activity
      if (_weight > 0.3 && Math.random() < _weight * 0.1) {
        const blipDist = 30 + Math.random() * (sonarR - 40);
        const blipAngle = Math.random() * Math.PI * 2;
        state.blips.push({
          x: cx + Math.cos(blipAngle) * blipDist,
          y: cy + Math.sin(blipAngle) * blipDist,
          alpha: 0.3 + _weight * 0.3,
          life: 1,
          size: 1.5 + _weight * 2,
        });
      }

      // Draw and age blips
      for (let i = state.blips.length - 1; i >= 0; i--) {
        const blip = state.blips[i];
        blip.life -= 0.008;
        if (blip.life <= 0) { state.blips.splice(i, 1); continue; }

        const alpha = blip.alpha * blip.life;
        ctx.beginPath();
        ctx.arc(blip.x, blip.y, blip.size * blip.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
        if (alpha > 0.3) {
          ctx.shadowColor = 'rgba(0, 220, 240, 0.6)';
          ctx.shadowBlur = 6;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        // Dot outline
        if (blip.size > 3) {
          ctx.beginPath();
          ctx.arc(blip.x, blip.y, blip.size * blip.life + 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 220, 240, ${alpha * 0.3})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      if (state.blips.length > 60) state.blips.splice(0, state.blips.length - 60);

      // ── Shockwaves on transients ──
      if (peakAmt > 0.7 && Math.random() < (peakAmt - 0.7) * 2) {
        state.shockwaves.push({ r: 5, alpha: 0.8, speed: 2 + peakAmt * 3 });
      }
      for (let i = state.shockwaves.length - 1; i >= 0; i--) {
        const sw = state.shockwaves[i];
        sw.r += sw.speed;
        sw.alpha -= 0.015;
        if (sw.alpha <= 0 || sw.r > sonarR) { state.shockwaves.splice(i, 1); continue; }

        ctx.beginPath();
        ctx.arc(cx, cy, sw.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 220, 240, ${sw.alpha * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Second ring
        if (sw.r > 15) {
          ctx.beginPath();
          ctx.arc(cx, cy, sw.r - 8, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 200, 220, ${sw.alpha * 0.2})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      if (state.shockwaves.length > 8) state.shockwaves.splice(0, state.shockwaves.length - 8);

      // ── Center dot ──
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${0.4 + peakAmt * 0.4})`;
      ctx.shadowColor = 'rgba(0, 220, 240, 0.5)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── Depth pressure indicators on edges ──
      const pressureMarks = ['N', 'E', 'S', 'W'];
      const pressAngles = [- Math.PI / 2, 0, Math.PI / 2, Math.PI];
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      pressureMarks.forEach((mark, idx) => {
        const a = pressAngles[idx];
        const mx = cx + Math.cos(a) * (sonarR + 1);
        const my = cy + Math.sin(a) * (sonarR + 1);
        ctx.fillStyle = 'rgba(0, 180, 200, 0.2)';
        ctx.fillText(mark, mx, my);
      });

      // ── Status text ──
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0, 200, 220, 0.35)';
      ctx.fillText('SONAR ACTIVE', cx, cy + sonarR + 18);

      // ── Sub level readout ──
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = subAmt > 0.5 ? 'rgba(0, 240, 255, 0.8)' : 'rgba(0, 200, 220, 0.5)';
      if (subAmt > 0.5) {
        ctx.shadowColor = 'rgba(0, 220, 240, 0.5)';
        ctx.shadowBlur = 6;
      }
      const subDb = subAmt > 0.01 ? (20 * Math.log10(subAmt)).toFixed(1) : '-inf';
      ctx.fillText(`SUB: ${subDb} dB`, cx, cy + 45);
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 260, height: 260, display: 'block' }} />;
}

// ─── Bubble Particles Layer ───────────────────────────────────────────────
function BubbleLayer({ subLevel }) {
  const canvasRef = useRef(null);
  const bubblesRef = useRef([]);
  const valRef = useRef({ subLevel: 0 });

  // Keep live value in ref so canvas draw loop always sees latest
  valRef.current = { subLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 260, H = 40;
    const DPR = 2;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.scale(DPR, DPR);

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const bubbles = bubblesRef.current;
      const sub = valRef.current.subLevel || 0;

      // Spawn bubbles proportional to bass
      if (sub > 0.05 && Math.random() < sub * 0.5) {
        bubbles.push({
          x: 10 + Math.random() * (W - 20),
          y: H,
          vy: -0.3 - Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 0.3,
          size: 1 + Math.random() * 3 * sub,
          alpha: 0.3 + Math.random() * 0.5,
        });
      }

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y += b.vy;
        b.x += b.vx + Math.sin(b.y * 0.1) * 0.2;
        b.alpha -= 0.008;
        if (b.alpha <= 0 || b.y < -5) { bubbles.splice(i, 1); continue; }

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 220, 240, ${b.alpha * 0.6})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        // Highlight
        ctx.beginPath();
        ctx.arc(b.x - b.size * 0.25, b.y - b.size * 0.25, b.size * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 240, 255, ${b.alpha * 0.4})`;
        ctx.fill();
      }
      if (bubbles.length > 80) bubbles.splice(0, bubbles.length - 80);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      width: 260, height: 40, display: 'block',
      position: 'absolute', bottom: 0, left: 0,
      pointerEvents: 'none', opacity: 0.8,
    }} />
  );
}

// ─── Submarine Valve Wheel Knob ───────────────────────────────────────────
function ValveWheelKnob({ size = 28, norm = 0, spokes = 4 }) {
  const cx = (size + 8) / 2, cy = (size + 8) / 2, r = size / 2 - 1;
  const id = useRef(`vw-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const innerR = r * 0.35;

  // Build spoke paths that rotate
  const spokeElements = [];
  for (let i = 0; i < spokes; i++) {
    const a = (angle + (i / spokes) * 360) * Math.PI / 180;
    spokeElements.push(
      <line key={i}
        x1={cx + Math.cos(a) * innerR}
        y1={cy + Math.sin(a) * innerR}
        x2={cx + Math.cos(a) * (r - 3)}
        y2={cy + Math.sin(a) * (r - 3)}
        stroke="rgba(0,200,220,0.5)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    );
  }

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-base`} cx="35%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#406878" />
          <stop offset="40%" stopColor="#1a3848" />
          <stop offset="80%" stopColor="#0a1820" />
          <stop offset="100%" stopColor="#060e14" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="rgba(0,0,0,0.7)" />
        </filter>
      </defs>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke="rgba(0,180,200,0.15)" strokeWidth={1.5} />
      {/* Main wheel body */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-base)`} filter={`url(#${id}-sh)`} />
      {/* Rim */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,200,220,0.2)" strokeWidth={2} />
      {/* Inner hub */}
      <circle cx={cx} cy={cy} r={innerR} fill="#0a1820" stroke="rgba(0,200,220,0.25)" strokeWidth={1} />
      {/* Spokes */}
      {spokeElements}
      {/* Center bolt */}
      <circle cx={cx} cy={cy} r={3} fill="#1a3848" stroke="rgba(0,200,220,0.3)" strokeWidth={0.8} />
    </svg>
  );
}

// Large valve wheel (for WEIGHT - 6 spokes)
function LargeValveWheelKnob({ size = 60, norm = 0 }) {
  return <ValveWheelKnob size={size} norm={norm} spokes={6} />;
}

// ─── Generic draggable knob wrapper ────────────────────────────────────────
function RotaryControl({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format, sensitivity = 160, Visual, spokes }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const KnobVisual = Visual || ValveWheelKnob;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none' }}>
      <span style={{ fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,220,240,0.8)', fontWeight: 800, fontFamily: '"Courier New", monospace', lineHeight: 1 }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ cursor: dragging ? 'grabbing' : 'grab', lineHeight: 0 }}>
        <KnobVisual size={size} norm={norm} spokes={spokes || 4} />
      </div>
      {/* Pressure readout number in monospace cyan */}
      <span style={{ fontSize: 7, color: 'rgba(0,220,240,0.55)', fontFamily: '"Courier New", monospace', fontWeight: 700, letterSpacing: '0.05em' }}>{display}</span>
    </div>
  );
}

// ─── Thick Horizontal Slider ─────────────────────────────────────────────
function HeavySlider({ label, value, onChange, min = 0, max = 1, defaultValue = 0.5, format }) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef(null);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    const track = trackRef.current;
    const rect = track.getBoundingClientRect();
    const update = (clientX) => {
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(min + x * (max - min));
    };
    update(e.clientX);
    const onMove = ev => update(ev.clientX);
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, userSelect: 'none', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 2px' }}>
        <span style={{ fontSize: 7, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,220,240,0.8)', fontWeight: 900, fontFamily: '"Courier New", monospace' }}>{label}</span>
        <span style={{ fontSize: 7, color: 'rgba(0,220,240,0.5)', fontFamily: '"Courier New", monospace', fontWeight: 700 }}>{display}</span>
      </div>
      <div ref={trackRef} onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{
          width: '100%', height: 8, borderRadius: 2,
          background: '#060a14',
          border: '1px solid rgba(0,200,220,0.1)',
          position: 'relative', cursor: dragging ? 'grabbing' : 'pointer',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
        }}>
        <div style={{
          position: 'absolute', top: 1, bottom: 1, left: 1,
          width: `calc(${norm * 100}% - 2px)`,
          background: `linear-gradient(90deg, rgba(0,160,200,0.2) 0%, rgba(0,200,220,${0.2 + norm * 0.3}) 100%)`,
          borderRadius: 1,
          transition: dragging ? 'none' : 'width 0.05s',
        }} />
        <div style={{
          position: 'absolute', top: -2, width: 14, height: 12, borderRadius: 2,
          left: `calc(${norm * 100}% - 7px)`,
          background: 'linear-gradient(180deg, #406878 0%, #1a3848 40%, #0a1820 100%)',
          border: '1px solid rgba(0,200,220,0.3)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(0,220,240,0.15)',
          transition: dragging ? 'none' : 'left 0.05s',
        }}>
          <div style={{ position: 'absolute', top: 3, left: 4, right: 4, height: 0.5, background: 'rgba(0,220,240,0.2)' }} />
          <div style={{ position: 'absolute', top: 5, left: 4, right: 4, height: 0.5, background: 'rgba(0,220,240,0.15)' }} />
          <div style={{ position: 'absolute', top: 7, left: 4, right: 4, height: 0.5, background: 'rgba(0,220,240,0.1)' }} />
        </div>
      </div>
    </div>
  );
}

// ─── Small Toggle Slider (for TONE, AIR) ──────────────────────────────────
function ToggleSlider({ label, value, onChange, min = 0, max = 1, defaultValue = 0.5, format }) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef(null);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    const track = trackRef.current;
    const rect = track.getBoundingClientRect();
    const update = (clientX) => {
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(min + x * (max - min));
    };
    update(e.clientX);
    const onMove = ev => update(ev.clientX);
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none', flex: 1 }}>
      <span style={{ fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,200,220,0.7)', fontWeight: 800, fontFamily: '"Courier New", monospace', minWidth: 26 }}>{label}</span>
      <div ref={trackRef} onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{
          flex: 1, height: 5, borderRadius: 1.5,
          background: '#060a14',
          border: '1px solid rgba(0,200,220,0.08)',
          position: 'relative', cursor: dragging ? 'grabbing' : 'pointer',
        }}>
        <div style={{
          position: 'absolute', top: 0.5, bottom: 0.5, left: 0.5,
          width: `calc(${norm * 100}% - 1px)`,
          background: `rgba(0,200,220,${0.12 + norm * 0.25})`,
          borderRadius: 1,
          transition: dragging ? 'none' : 'width 0.05s',
        }} />
        <div style={{
          position: 'absolute', top: -2, width: 9, height: 9, borderRadius: 1.5,
          left: `calc(${norm * 100}% - 4.5px)`,
          background: 'linear-gradient(180deg, #306878 0%, #102838 100%)',
          border: '1px solid rgba(0,200,220,0.25)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
          transition: dragging ? 'none' : 'left 0.05s',
        }} />
      </div>
      <span style={{ fontSize: 6, color: 'rgba(0,220,240,0.45)', fontFamily: '"Courier New", monospace', fontWeight: 700, minWidth: 28, textAlign: 'right' }}>{display}</span>
    </div>
  );
}

// ─── Horizontal VU Bar ──────────────────────────────────────────────────
function HVuBar({ label, barRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) barRef.current = containerRef.current; }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
      <span style={{ fontSize: 6, color: 'rgba(0,200,220,0.5)', fontFamily: '"Courier New", monospace', fontWeight: 800, letterSpacing: '0.1em', minWidth: 14 }}>{label}</span>
      <div ref={containerRef} style={{
        flex: 1, height: 3, borderRadius: 1,
        background: '#040810',
        border: '1px solid rgba(0,200,220,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '0%',
          borderRadius: 1,
          background: 'linear-gradient(90deg, rgba(0,140,180,0.6) 0%, rgba(0,200,220,0.8) 60%, rgba(64,224,192,0.9) 85%, rgba(255,80,60,0.9) 95%)',
          transition: 'width 0.06s',
        }} />
      </div>
    </div>
  );
}

function updateHVuBar(containerEl, level) {
  if (!containerEl) return;
  const fill = containerEl.querySelector('div');
  if (!fill) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -80;
  const norm = Math.max(0, Math.min(1, (dB + 40) / 46));
  fill.style.width = `${norm * 100}%`;
  if (dB > -1) {
    fill.style.background = 'linear-gradient(90deg, rgba(0,140,180,0.6) 0%, rgba(0,200,220,0.8) 50%, rgba(255,80,60,0.95) 90%)';
  } else {
    fill.style.background = 'linear-gradient(90deg, rgba(0,140,180,0.6) 0%, rgba(0,200,220,0.8) 60%, rgba(64,224,192,0.9) 85%, rgba(255,80,60,0.9) 95%)';
  }
}

// ─── Submarine Dive/Surface Toggle ────────────────────────────────────────
function DiveToggle({ active, onToggle }) {
  const [pingAnim, setPingAnim] = useState(false);

  const handleClick = () => {
    onToggle();
    setPingAnim(true);
    setTimeout(() => setPingAnim(false), 800);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={handleClick}
        style={{
          width: 72, height: 28,
          borderRadius: 4,
          background: active
            ? 'linear-gradient(180deg, #0a2838 0%, #061820 50%, #040e14 100%)'
            : 'linear-gradient(180deg, #1a1018 0%, #140810 50%, #0a0408 100%)',
          border: `1.5px solid ${active ? 'rgba(0,200,220,0.35)' : 'rgba(120,60,60,0.2)'}`,
          cursor: 'pointer',
          position: 'relative',
          boxShadow: active
            ? 'inset 0 1px 4px rgba(0,0,0,0.4), 0 0 8px rgba(0,200,220,0.12)'
            : 'inset 0 1px 4px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          userSelect: 'none',
          transition: 'all 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Red/cyan stripe at top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: active
            ? 'linear-gradient(90deg, transparent 0%, rgba(0,200,220,0.6) 30%, rgba(0,240,255,0.8) 50%, rgba(0,200,220,0.6) 70%, transparent 100%)'
            : 'linear-gradient(90deg, transparent 0%, rgba(200,50,50,0.3) 30%, rgba(200,50,50,0.4) 50%, rgba(200,50,50,0.3) 70%, transparent 100%)',
          boxShadow: active ? '0 0 6px rgba(0,200,220,0.4)' : 'none',
        }} />

        {/* Status text */}
        <span style={{
          fontSize: 8, fontWeight: 900, letterSpacing: '0.2em',
          color: active ? 'rgba(0,220,240,0.85)' : 'rgba(200,80,80,0.5)',
          fontFamily: '"Courier New", monospace',
          marginTop: 2,
          textShadow: active ? '0 0 6px rgba(0,200,220,0.4)' : 'none',
        }}>{active ? 'DIVE' : 'SURFACE'}</span>

        {/* Small sub-text */}
        <span style={{
          fontSize: 4.5, fontWeight: 700, letterSpacing: '0.15em',
          color: active ? 'rgba(0,200,220,0.35)' : 'rgba(200,60,60,0.2)',
          fontFamily: '"Courier New", monospace',
        }}>{active ? 'ACTIVE' : 'BYPASSED'}</span>
      </div>

      {/* Sonar ping ripple animation */}
      {pingAnim && (
        <>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 10, height: 10, marginTop: -5, marginLeft: -5,
            borderRadius: '50%',
            border: '2px solid rgba(0,220,240,0.6)',
            animation: 'sonarPing 0.8s ease-out forwards',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 10, height: 10, marginTop: -5, marginLeft: -5,
            borderRadius: '50%',
            border: '1px solid rgba(0,220,240,0.3)',
            animation: 'sonarPing 0.8s ease-out 0.15s forwards',
            pointerEvents: 'none',
          }} />
        </>
      )}

      <style>{`
        @keyframes sonarPing {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Hull Pressure Bar ────────────────────────────────────────────────────
function HullPressureBar({ peak }) {
  const norm = Math.min(peak || 0, 1);
  const barColor = norm < 0.5 ? 'rgba(0,200,220,0.6)' : norm < 0.8 ? 'rgba(0,220,200,0.7)' : 'rgba(255,80,60,0.8)';

  return (
    <div style={{ width: '100%', padding: '0 2px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 5.5, fontWeight: 900, color: 'rgba(0,200,220,0.4)', letterSpacing: '0.15em', fontFamily: '"Courier New", monospace' }}>HULL PRESSURE</span>
        <span style={{ fontSize: 5.5, fontWeight: 700, color: barColor, fontFamily: '"Courier New", monospace' }}>{Math.round(norm * 100)}%</span>
      </div>
      <div style={{
        width: '100%', height: 4, borderRadius: 1,
        background: '#040810',
        border: '1px solid rgba(0,200,220,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${norm * 100}%`,
          background: `linear-gradient(90deg, rgba(0,140,180,0.5) 0%, ${barColor} 100%)`,
          borderRadius: 1,
          transition: 'width 0.08s',
          boxShadow: norm > 0.6 ? `0 0 6px ${barColor}` : 'none',
        }} />
      </div>
    </div>
  );
}

// ─── Depth Gauge (left side vertical) ─────────────────────────────────────
function DepthGauge({ weight }) {
  const depths = [0, 50, 100, 200];
  const norm = weight || 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      height: '100%', padding: '4px 0',
    }}>
      {depths.map((d, i) => {
        const t = i / (depths.length - 1);
        const isActive = norm >= t * 0.8;
        return (
          <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{
              fontSize: 5.5, fontWeight: 800,
              color: isActive ? 'rgba(0,220,240,0.7)' : 'rgba(0,180,200,0.2)',
              fontFamily: '"Courier New", monospace',
              minWidth: 22, textAlign: 'right',
              transition: 'color 0.2s',
            }}>{d}m</span>
            <div style={{
              width: 6, height: 1,
              background: isActive ? 'rgba(0,220,240,0.5)' : 'rgba(0,180,200,0.15)',
              transition: 'background 0.2s',
            }} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Riveted Plate Border ─────────────────────────────────────────────────
function RivetedSeam() {
  return (
    <div style={{
      width: '100%', height: 3, position: 'relative',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,60,80,0.08) 40%, rgba(0,0,0,0.25) 60%, rgba(0,80,100,0.05) 100%)',
    }}>
      {/* Rivets */}
      {[16, 50, 84].map((pct, i) => (
        <div key={i} style={{
          position: 'absolute', top: 0.5,
          left: `${pct}%`, marginLeft: -1.5,
          width: 3, height: 2, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #304858 0%, #102030 100%)',
          boxShadow: '0 0.5px 1px rgba(0,0,0,0.5)',
        }} />
      ))}
    </div>
  );
}

// ─── Presets ───────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',        weight: 0.4, tight: 0.3, focus: 0.3, growl: 0,   tone: 0.5, air: 0,   mix: 1 },
  { name: 'SUB HOLD',    weight: 0.7, tight: 0.5, focus: 0.1, growl: 0,   tone: 0.4, air: 0,   mix: 1 },
  { name: 'TIGHT BASS',  weight: 0.5, tight: 0.7, focus: 0.4, growl: 0.1, tone: 0.5, air: 0,   mix: 1 },
  { name: 'GROWL TONE',  weight: 0.4, tight: 0.3, focus: 0.5, growl: 0.6, tone: 0.55,air: 0.1, mix: 1 },
  { name: 'NOTE DEFINE', weight: 0.3, tight: 0.4, focus: 0.7, growl: 0.3, tone: 0.6, air: 0.2, mix: 0.8 },
  { name: 'DI WARMTH',   weight: 0.5, tight: 0.2, focus: 0.3, growl: 0.4, tone: 0.45,air: 0.15,mix: 1 },
  { name: 'HEAVY MASS',  weight: 0.85,tight: 0.6, focus: 0.2, growl: 0.5, tone: 0.4, air: 0,   mix: 1 },
  { name: 'FULL SEND',   weight: 0.7, tight: 0.5, focus: 0.6, growl: 0.7, tone: 0.55,air: 0.3, mix: 1 },
];

const PRESET_COLORS = {
  bg: '#060a14', text: 'rgba(0,220,240,0.8)', textDim: 'rgba(0,200,220,0.4)',
  border: 'rgba(0,200,220,0.1)', hoverBg: 'rgba(0,200,220,0.08)', activeBg: 'rgba(0,200,220,0.05)',
};

// ─── Main Component ───────────────────────────────────────────────────────
export default function BassmindOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [weight, setWeight] = useState(initialState?.weight ?? 0.4);
  const [tight,  setTight]  = useState(initialState?.tight  ?? 0.3);
  const [focus,  setFocus]  = useState(initialState?.focus  ?? 0.3);
  const [growl,  setGrowl]  = useState(initialState?.growl  ?? 0);
  const [tone,   setTone]   = useState(initialState?.tone   ?? 0.5);
  const [air,    setAir]    = useState(initialState?.air    ?? 0);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [subLevel, setSubLevel] = useState(0);
  const [peak, setPeak] = useState(0);

  const inBarRef  = useRef(null);
  const outBarRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, weight, tight, focus, growl, tone, air, mix, bypassed };

  // ── Engine lifecycle ──
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createBassmindEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setWeight(s.weight); eng.setTight(s.tight); eng.setFocus(s.focus);
      eng.setGrowl(s.growl); eng.setTone(s.tone); eng.setAir(s.air);
      eng.setMix(s.mix); eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => {
      if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; }
    };
  }, [sharedSource]);

  // ── Metering animation loop ──
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        const inPeak = engineRef.current.getInputPeak();
        updateHVuBar(inBarRef.current, inPeak);
        updateHVuBar(outBarRef.current, engineRef.current.getOutputPeak());
        setSubLevel(engineRef.current.getSubLevel());
        setPeak(inPeak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State change propagation ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, weight, tight, focus, growl, tone, air, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, weight, tight, focus, growl, tone, air, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setWeight(p.weight); setTight(p.tight); setFocus(p.focus); setGrowl(p.growl);
    setTone(p.tone); setAir(p.air); setMix(p.mix); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setWeight(p.weight); e.setTight(p.tight); e.setFocus(p.focus); e.setGrowl(p.growl); e.setTone(p.tone); e.setAir(p.air); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };
  const toneFmt = v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'FLAT';

  return (
    <div style={{
      width: 320, borderRadius: 5, position: 'relative', overflow: 'hidden',
      background: `
        linear-gradient(180deg, #0c1828 0%, #081420 15%, #060e18 40%, #040a12 60%, #060e18 80%, #081420 100%)
      `,
      border: '1.5px solid rgba(0,200,220,0.18)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 20px rgba(0,180,220,0.1), inset 0 1px 0 rgba(0,220,240,0.05)',
      fontFamily: '"Courier New", monospace',
      userSelect: 'none',
    }}>
      {/* Subtle brushed horizontal line texture */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        opacity: 0.02,
        backgroundImage: `repeating-linear-gradient(
          0deg,
          transparent, transparent 2px,
          rgba(0,180,220,0.3) 2px, rgba(0,180,220,0.3) 3px
        )`,
        backgroundSize: '100% 5px',
      }} />

      {/* CLASSIFIED watermark */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%) rotate(-25deg)',
        fontSize: 38, fontWeight: 900, letterSpacing: '0.3em',
        color: 'rgba(0,200,220,0.04)',
        fontFamily: '"Courier New", monospace',
        pointerEvents: 'none', zIndex: 1,
        whiteSpace: 'nowrap',
      }}>CLASSIFIED</div>

      {/* ════════ HEADER: Title flanked by IN/OUT valve knobs ════════ */}
      <div style={{
        padding: '8px 10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(180deg, rgba(0,200,220,0.04) 0%, transparent 100%)',
        position: 'relative', zIndex: 2,
      }}>
        {/* IN gain valve */}
        <RotaryControl label="IN" value={inputGain} min={0} max={2} defaultValue={1} size={26}
          format={dbFmt} sensitivity={120}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        {/* Title block */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 17, fontWeight: 900, letterSpacing: '0.1em',
            background: 'linear-gradient(180deg, #00d0e0 0%, #40f0ff 50%, #00a0c0 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 0 10px rgba(0,200,220,0.4))',
          }}>BASSMIND</span>
          <div style={{
            width: 70, height: 1.5, marginTop: 3, borderRadius: 1,
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,200,220,0.5) 30%, rgba(0,220,240,0.8) 50%, rgba(0,200,220,0.5) 70%, transparent 100%)',
            boxShadow: '0 0 8px rgba(0,200,220,0.3)',
          }} />
          <span style={{ fontSize: 5, fontWeight: 700, color: 'rgba(0,180,200,0.35)', letterSpacing: '0.4em', marginTop: 2, textTransform: 'uppercase' }}>mass stabilizer</span>
        </div>

        {/* OUT gain valve */}
        <RotaryControl label="OUT" value={outputGain} min={0} max={2} defaultValue={1} size={26}
          format={dbFmt} sensitivity={120}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
      </div>

      <RivetedSeam />

      {/* ════════ VU BARS + HULL PRESSURE ════════ */}
      <div style={{
        padding: '5px 14px', display: 'flex', flexDirection: 'column', gap: 4,
        position: 'relative', zIndex: 2,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <HVuBar label="IN" barRef={inBarRef} />
          <HVuBar label="OUT" barRef={outBarRef} />
        </div>
        <HullPressureBar peak={peak} />
      </div>

      <RivetedSeam />

      {/* ════════ PRESET ROW ════════ */}
      <div style={{
        padding: '4px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', zIndex: 2,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        {loading && <span style={{ fontSize: 6, color: 'rgba(0,200,220,0.4)', marginLeft: 6 }}>...</span>}
      </div>

      <RivetedSeam />

      {/* ════════ SONAR DISPLAY with Depth Gauge ════════ */}
      <div style={{
        display: 'flex', position: 'relative', zIndex: 2,
        background: 'radial-gradient(ellipse at center, rgba(8,14,24,1) 0%, rgba(4,8,16,1) 100%)',
      }}>
        {/* Depth gauge left side */}
        <div style={{ padding: '8px 4px 8px 10px', minWidth: 34 }}>
          <DepthGauge weight={weight} />
        </div>

        {/* Sonar display center */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '4px 0', position: 'relative' }}>
          <SonarDisplay weight={weight} tight={tight} focus={focus} growl={growl} subLevel={subLevel} peak={peak} />
          {/* Bubble particles */}
          <BubbleLayer subLevel={subLevel} />
        </div>
      </div>

      <RivetedSeam />

      {/* ════════ HEAVY SLIDERS: WEIGHT, TIGHT, FOCUS ════════ */}
      <div style={{
        padding: '8px 16px 4px', display: 'flex', flexDirection: 'column', gap: 6,
        position: 'relative', zIndex: 2,
      }}>
        <HeavySlider label="WEIGHT" value={weight} defaultValue={0.4} format={pctFmt}
          onChange={v => { setWeight(v); engineRef.current?.setWeight(v); setActivePreset(null); }} />
        <HeavySlider label="TIGHT" value={tight} defaultValue={0.3} format={pctFmt}
          onChange={v => { setTight(v); engineRef.current?.setTight(v); setActivePreset(null); }} />
        <HeavySlider label="FOCUS" value={focus} defaultValue={0.3} format={pctFmt}
          onChange={v => { setFocus(v); engineRef.current?.setFocus(v); setActivePreset(null); }} />
      </div>

      <RivetedSeam />

      {/* ════════ GROWL: large centered valve wheel (6 spokes) ════════ */}
      <div style={{
        padding: '8px 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        position: 'relative', zIndex: 2,
      }}>
        <RotaryControl label="GROWL" value={growl} defaultValue={0} size={56} format={pctFmt}
          sensitivity={140} Visual={LargeValveWheelKnob} spokes={6}
          onChange={v => { setGrowl(v); engineRef.current?.setGrowl(v); setActivePreset(null); }} />
      </div>

      <RivetedSeam />

      {/* ════════ TONE / AIR ════════ */}
      <div style={{
        padding: '6px 16px', display: 'flex', gap: 12,
        position: 'relative', zIndex: 2,
      }}>
        <ToggleSlider label="TONE" value={tone} defaultValue={0.5} format={toneFmt}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <ToggleSlider label="AIR" value={air} defaultValue={0} format={pctFmt}
          onChange={v => { setAir(v); engineRef.current?.setAir(v); setActivePreset(null); }} />
      </div>

      <RivetedSeam />

      {/* ════════ FOOTER: MIX valve + DIVE toggle + X button ════════ */}
      <div style={{
        padding: '6px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 2,
      }}>
        {/* MIX valve knob */}
        <RotaryControl label="MIX" value={mix} defaultValue={1} size={24} format={pctFmt}
          sensitivity={140}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Dive/Surface toggle */}
          <DiveToggle active={!bypassed} onToggle={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />

          {/* Remove (X) button */}
          {onRemove && (
            <span onClick={onRemove} style={{
              fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700,
              lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s',
            }} title="Remove"
              onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
            >x</span>
          )}
        </div>
      </div>

      {/* Model number */}
      <div style={{
        textAlign: 'center', padding: '0 0 5px',
        position: 'relative', zIndex: 2,
      }}>
        <span style={{
          fontSize: 4.5, color: 'rgba(0,180,200,0.2)', letterSpacing: '0.2em',
          fontFamily: '"Courier New", monospace',
        }}>MODEL DSS-400 // DEEP SEA SYSTEMS</span>
      </div>
    </div>
  );
}
