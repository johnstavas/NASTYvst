import { useState, useEffect, useRef, useCallback } from 'react';
import { createSmootherEngine } from './smootherEngine';
import PresetSelector from './PresetSelector';

// ─── SMOOTHER: Zen Garden / Water Pool ─────────────────────────────────────
// Visual world: dark water pool, lavender-purple tints, caustic light, ripples
// Hero: Water Ripple Pool — surface responds to harshness with expanding ripples

// ─── Watercolor Wash Background (canvas) ───────────────────────────────────
function WatercolorWash({ width, height }) {
  const canvasRef = useRef(null);
  const drawnRef = useRef(false);

  useEffect(() => {
    if (drawnRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);

    // Paint soft watercolor blotches
    const blotches = [
      { x: width * 0.2, y: height * 0.15, r: 60, h: 270, s: 30, l: 12, a: 0.08 },
      { x: width * 0.7, y: height * 0.3, r: 80, h: 260, s: 25, l: 10, a: 0.06 },
      { x: width * 0.5, y: height * 0.7, r: 70, h: 280, s: 20, l: 14, a: 0.07 },
      { x: width * 0.15, y: height * 0.85, r: 50, h: 250, s: 35, l: 11, a: 0.05 },
      { x: width * 0.85, y: height * 0.8, r: 55, h: 290, s: 22, l: 13, a: 0.06 },
    ];
    for (const b of blotches) {
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      grad.addColorStop(0, `hsla(${b.h}, ${b.s}%, ${b.l}%, ${b.a})`);
      grad.addColorStop(0.6, `hsla(${b.h}, ${b.s}%, ${b.l}%, ${b.a * 0.5})`);
      grad.addColorStop(1, `hsla(${b.h}, ${b.s}%, ${b.l}%, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
    drawnRef.current = true;
  }, []);

  return <canvas ref={canvasRef} style={{
    position: 'absolute', top: 0, left: 0, width, height,
    borderRadius: 6, pointerEvents: 'none', zIndex: 0,
  }} />;
}

// ─── Water Ripple Pool (Hero Visual) ───────────────────────────────────────
function WaterRipplePool({ smooth, focus, width, air, harshLevel, peak }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const harshRef = useRef(0);
  const peakRef = useRef(0);
  const smoothHarshRef = useRef(0);
  const ripplesRef = useRef([]); // active ripples: { x, y, radius, maxRadius, alpha, speed, birth }
  const lastPeakRef = useRef(0);
  const stonesRef = useRef([
    { x: 0.72, y: 0.35, w: 14, h: 8, rot: 0.3, phase: 0 },
    { x: 0.25, y: 0.6, w: 10, h: 6, rot: -0.2, phase: 1.5 },
    { x: 0.55, y: 0.75, w: 12, h: 7, rot: 0.15, phase: 3.1 },
  ]);
  const mistRef = useRef(
    Array.from({ length: 20 }, (_, i) => ({
      x: Math.random(), y: Math.random() * 0.3 + 0.7,
      speed: 0.2 + Math.random() * 0.5, size: 0.5 + Math.random() * 1.5,
      alpha: 0.1 + Math.random() * 0.2, phase: Math.random() * Math.PI * 2,
    }))
  );

  useEffect(() => { harshRef.current = harshLevel; }, [harshLevel]);
  useEffect(() => { peakRef.current = peak; }, [peak]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    let raf;
    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.006;
      const phase = phaseRef.current;
      const rawHarsh = harshRef.current;
      const currentPeak = peakRef.current;

      // Smooth harsh for visuals
      const target = rawHarsh;
      const current = smoothHarshRef.current;
      smoothHarshRef.current = target > current
        ? current + (target - current) * 0.3
        : current + (target - current) * 0.06;
      const harsh = smoothHarshRef.current;

      // ── Spawn ripples on transients ──
      const peakDelta = currentPeak - lastPeakRef.current;
      lastPeakRef.current = currentPeak * 0.95; // decay for next comparison
      if (peakDelta > 0.02 || harsh > 0.1) {
        const spawnChance = Math.min(1, peakDelta * 8 + harsh * 0.3);
        if (Math.random() < spawnChance) {
          const focusX = focus * W * 0.6 + W * 0.2; // focus positions ripple origin
          const jitter = (Math.random() - 0.5) * 40;
          ripplesRef.current.push({
            x: focusX + jitter,
            y: H * 0.45 + (Math.random() - 0.5) * 30,
            radius: 2,
            maxRadius: 20 + currentPeak * 60 + harsh * 40,
            alpha: 0.4 + currentPeak * 0.4,
            speed: 0.4 + currentPeak * 0.8,
            birth: t,
          });
        }
      }

      // ── Dark water background ──
      const waterGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
      waterGrad.addColorStop(0, 'rgba(20, 12, 35, 0.95)');
      waterGrad.addColorStop(0.5, 'rgba(12, 8, 25, 0.97)');
      waterGrad.addColorStop(1, 'rgba(6, 4, 16, 1)');
      ctx.fillStyle = waterGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Subtle purple water tint ──
      const tintGrad = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6);
      tintGrad.addColorStop(0, `rgba(100, 60, 160, ${0.06 + smooth * 0.04})`);
      tintGrad.addColorStop(1, 'rgba(60, 30, 100, 0)');
      ctx.fillStyle = tintGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Caustic light patterns (wavy light refraction on water) ──
      const causticIntensity = 0.08 + currentPeak * 0.12;
      const causticCount = 6;
      for (let c = 0; c < causticCount; c++) {
        ctx.beginPath();
        const cPhase = phase * (0.3 + c * 0.15) + c * 1.7;
        const cy = H * 0.3 + c * (H * 0.08);
        for (let x = 0; x < W; x += 2) {
          const nx = x / W;
          const y1 = Math.sin(nx * 6 + cPhase) * 8;
          const y2 = Math.sin(nx * 10 + cPhase * 1.3 + c) * 4;
          const y3 = Math.cos(nx * 14 + cPhase * 0.7) * 3 * currentPeak;
          const y = cy + y1 + y2 + y3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const hue = 260 + c * 8;
        ctx.strokeStyle = `hsla(${hue}, 50%, 70%, ${causticIntensity * (1 - c * 0.12)})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      // ── Caustic cell pattern (the cellular light pattern at pool bottom) ──
      for (let i = 0; i < 12; i++) {
        const cx2 = (Math.sin(phase * 0.2 + i * 2.1) * 0.4 + 0.5) * W;
        const cy2 = (Math.cos(phase * 0.15 + i * 1.7) * 0.35 + 0.5) * H;
        const r = 8 + Math.sin(phase * 0.3 + i) * 4;
        const alpha = (0.02 + currentPeak * 0.03) * (0.5 + 0.5 * Math.sin(phase * 0.4 + i * 0.9));
        ctx.beginPath();
        ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(140, 100, 200, ${alpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── Ripples — concentric circles expanding and fading ──
      const smoothDamping = 1 + smooth * 2; // higher smooth = ripples fade faster
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rip = ripples[i];
        rip.radius += rip.speed;
        rip.alpha -= (0.004 + 0.004 * smoothDamping); // smooth absorbs ripples faster

        if (rip.alpha <= 0 || rip.radius > rip.maxRadius) {
          ripples.splice(i, 1);
          continue;
        }

        // Draw 2-3 concentric rings per ripple
        for (let ring = 0; ring < 3; ring++) {
          const ringR = rip.radius - ring * 4;
          if (ringR <= 0) continue;
          const ringAlpha = rip.alpha * (1 - ring * 0.35);
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(170, 130, 230, ${ringAlpha})`;
          ctx.lineWidth = 1.2 - ring * 0.3;
          ctx.stroke();
        }
      }

      // ── Gentle ambient ripples (always present, more when calm) ──
      const ambientCount = 3;
      for (let a = 0; a < ambientCount; a++) {
        const ax = W * 0.3 + a * W * 0.2 + Math.sin(phase * 0.1 + a * 2) * 15;
        const ay = H * 0.4 + Math.cos(phase * 0.08 + a * 1.5) * 10;
        const ar = (10 + a * 8 + Math.sin(phase * 0.15 + a) * 5) * (0.5 + smooth * 0.5);
        const aa = (0.03 + smooth * 0.02) * (0.5 + 0.5 * Math.sin(phase * 0.2 + a * 1.1));
        ctx.beginPath();
        ctx.arc(ax, ay, ar, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(150, 120, 200, ${aa})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── Zen stones floating on surface ──
      const stones = stonesRef.current;
      for (const stone of stones) {
        const sx = stone.x * W;
        const sy = stone.y * H + Math.sin(phase * 0.4 + stone.phase) * 2; // gentle bob
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(stone.rot + Math.sin(phase * 0.2 + stone.phase) * 0.05);

        // Stone body — smooth oval
        ctx.beginPath();
        ctx.ellipse(0, 0, stone.w / 2, stone.h / 2, 0, 0, Math.PI * 2);
        const stoneGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, stone.w / 2);
        stoneGrad.addColorStop(0, 'rgba(80, 65, 95, 0.6)');
        stoneGrad.addColorStop(0.6, 'rgba(50, 40, 65, 0.5)');
        stoneGrad.addColorStop(1, 'rgba(30, 25, 45, 0.4)');
        ctx.fillStyle = stoneGrad;
        ctx.fill();

        // Highlight on stone
        ctx.beginPath();
        ctx.ellipse(-stone.w * 0.15, -stone.h * 0.15, stone.w * 0.2, stone.h * 0.15, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(160, 130, 200, 0.15)';
        ctx.fill();

        // Stone shadow/reflection in water
        ctx.beginPath();
        ctx.ellipse(0, stone.h * 0.55, stone.w * 0.4, stone.h * 0.15, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fill();

        ctx.restore();
      }

      // ── Air sparkle/mist dots above water ──
      if (air > 0.05) {
        const mist = mistRef.current;
        for (const m of mist) {
          m.y -= m.speed * 0.001; // rise upward
          if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
          const mx = m.x * W + Math.sin(phase * 0.5 + m.phase) * 8;
          const my = m.y * H;
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.003 + m.phase);
          const dotAlpha = air * m.alpha * twinkle;
          const dotSize = m.size * (0.6 + air * 0.4);

          // Sparkle dot
          ctx.beginPath();
          ctx.arc(mx, my, dotSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200, 170, 255, ${dotAlpha})`;
          ctx.fill();

          // Sparkle glow
          if (dotAlpha > 0.08) {
            ctx.beginPath();
            ctx.arc(mx, my, dotSize * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180, 150, 240, ${dotAlpha * 0.15})`;
            ctx.fill();
          }
        }
      }

      // ── Steam/mist rising (tiny particles moving up) ──
      for (let i = 0; i < 8; i++) {
        const steamX = W * 0.1 + (i / 8) * W * 0.8 + Math.sin(phase * 0.3 + i * 1.7) * 10;
        const steamY = H * 0.15 + ((phase * 8 + i * 40) % H) * 0.15;
        const steamAlpha = 0.02 + smooth * 0.015;
        const steamSize = 0.8 + Math.sin(phase * 0.2 + i) * 0.3;
        ctx.beginPath();
        ctx.arc(steamX, steamY, steamSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 160, 220, ${steamAlpha})`;
        ctx.fill();
      }

      // ── Focus glow — where ripples originate ──
      const focusXpx = focus * W * 0.6 + W * 0.2;
      const focusGlow = ctx.createRadialGradient(focusXpx, H * 0.45, 0, focusXpx, H * 0.45, 25 + width * 30);
      focusGlow.addColorStop(0, `rgba(140, 100, 200, ${0.06 + smooth * 0.04})`);
      focusGlow.addColorStop(0.5, `rgba(120, 80, 180, ${0.02 + smooth * 0.02})`);
      focusGlow.addColorStop(1, 'rgba(100, 60, 160, 0)');
      ctx.fillStyle = focusGlow;
      ctx.fillRect(0, 0, W, H);

      // ── Dewdrop decorations at corners ──
      const dewdrops = [
        { x: 8, y: 8 }, { x: W - 8, y: 8 },
        { x: 8, y: H - 8 }, { x: W - 8, y: H - 8 },
      ];
      for (const dew of dewdrops) {
        const dewPhase = Math.sin(phase * 0.5 + dew.x * 0.1) * 0.3;
        const dewR = 2.5 + dewPhase;
        // Dewdrop body
        const dewGrad = ctx.createRadialGradient(dew.x - 0.8, dew.y - 0.8, 0, dew.x, dew.y, dewR);
        dewGrad.addColorStop(0, 'rgba(200, 180, 240, 0.25)');
        dewGrad.addColorStop(0.5, 'rgba(140, 110, 200, 0.12)');
        dewGrad.addColorStop(1, 'rgba(100, 70, 160, 0)');
        ctx.beginPath();
        ctx.arc(dew.x, dew.y, dewR, 0, Math.PI * 2);
        ctx.fillStyle = dewGrad;
        ctx.fill();
        // Dewdrop highlight
        ctx.beginPath();
        ctx.arc(dew.x - 0.5, dew.y - 0.5, dewR * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220, 200, 255, 0.3)';
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 6 }} />;
}

// ─── Harshness Thermometer ─────────────────────────────────────────────────
function HarshThermometer({ harshLevel }) {
  const norm = Math.min(1, harshLevel * 5); // amplify for visibility
  // Color from cool purple (smooth) to angry red (harsh)
  const r = Math.round(100 + norm * 155);
  const g = Math.round(60 + (1 - norm) * 60);
  const b = Math.round(200 * (1 - norm) + 60);
  const barColor = `rgb(${r}, ${g}, ${b})`;
  const glowColor = `rgba(${r}, ${g}, ${b}, 0.4)`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      padding: '2px 10px', position: 'relative', zIndex: 2,
    }}>
      <span style={{
        fontSize: 5, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(160, 130, 200, 0.4)', fontFamily: 'system-ui',
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>HARSH</span>
      <div style={{
        flex: 1, height: 5, borderRadius: 10,
        background: 'rgba(20, 15, 30, 0.6)',
        border: '0.5px solid rgba(120, 80, 180, 0.1)',
        overflow: 'hidden', position: 'relative',
      }}>
        {/* Thermometer bulb left */}
        <div style={{
          position: 'absolute', left: -1, top: -1, bottom: -1, width: 7,
          borderRadius: '10px 0 0 10px',
          background: `rgba(${100 + norm * 100}, 60, ${180 - norm * 120}, 0.3)`,
        }} />
        {/* Fill bar */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${norm * 100}%`,
          background: `linear-gradient(90deg, rgba(140, 100, 200, 0.4), ${barColor})`,
          borderRadius: 10,
          boxShadow: `0 0 6px ${glowColor}`,
          transition: 'width 0.08s ease-out',
        }} />
      </div>
      <span style={{
        fontSize: 5, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(160, 130, 200, 0.4)', fontFamily: 'system-ui',
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>CALM</span>
    </div>
  );
}

// ─── Liquid Bubble Knob ────────────────────────────────────────────────────
function BubbleKnob({ size = 38, norm = 0, dragging }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const id = useRef(`bk-${Math.random().toString(36).slice(2, 7)}`).current;

  // Fill level (liquid inside bubble from bottom)
  const fillY = cy + r - norm * r * 2; // top of liquid

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        {/* Bubble body gradient — translucent soap bubble */}
        <radialGradient id={`${id}-bg`} cx="30%" cy="25%" r="80%">
          <stop offset="0%" stopColor="rgba(180, 150, 230, 0.15)" />
          <stop offset="40%" stopColor="rgba(120, 80, 180, 0.06)" />
          <stop offset="70%" stopColor="rgba(80, 50, 140, 0.04)" />
          <stop offset="100%" stopColor="rgba(60, 30, 120, 0.12)" />
        </radialGradient>
        {/* Specular highlight top-left */}
        <radialGradient id={`${id}-spec`} cx="28%" cy="22%" r="35%">
          <stop offset="0%" stopColor="rgba(220, 200, 255, 0.35)" />
          <stop offset="60%" stopColor="rgba(180, 150, 240, 0.1)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        {/* Liquid fill gradient */}
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(160, 120, 220, 0.35)" />
          <stop offset="50%" stopColor="rgba(130, 90, 200, 0.25)" />
          <stop offset="100%" stopColor="rgba(100, 60, 180, 0.4)" />
        </linearGradient>
        {/* Clip to circle */}
        <clipPath id={`${id}-clip`}>
          <circle cx={cx + 4} cy={cy + 4} r={r - 1} />
        </clipPath>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="rgba(120, 80, 200, 0.25)" />
        </filter>
        {/* Wobble for dragging */}
        {dragging && (
          <filter id={`${id}-wobble`}>
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="2" seed="1" />
            <feDisplacementMap in="SourceGraphic" scale="1.5" />
          </filter>
        )}
      </defs>

      {/* Outer bubble ring */}
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="none"
        stroke="rgba(160, 130, 220, 0.2)" strokeWidth={1}
        filter={`url(#${id}-sh)`} />

      {/* Bubble body */}
      <circle cx={cx + 4} cy={cy + 4} r={r - 0.5}
        fill={`url(#${id}-bg)`}
        filter={dragging ? `url(#${id}-wobble)` : undefined} />

      {/* Liquid fill inside bubble */}
      <g clipPath={`url(#${id}-clip)`}>
        {/* Water surface wave */}
        <path d={(() => {
          const waveY = (cy + 4) + r - norm * r * 2;
          let d = `M ${cx + 4 - r} ${waveY}`;
          for (let x = -r; x <= r; x += 2) {
            const wave = Math.sin(x * 0.3 + (dragging ? Date.now() * 0.01 : 0)) * 1.5;
            d += ` L ${cx + 4 + x} ${waveY + wave}`;
          }
          d += ` L ${cx + 4 + r} ${cy + 4 + r + 5} L ${cx + 4 - r} ${cy + 4 + r + 5} Z`;
          return d;
        })()}
          fill={`url(#${id}-fill)`} />
      </g>

      {/* Specular highlight */}
      <circle cx={cx + 4} cy={cy + 4} r={r - 0.5} fill={`url(#${id}-spec)`} />

      {/* Thin rim */}
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="none"
        stroke="rgba(180, 150, 240, 0.12)" strokeWidth={0.5} />

      {/* Small bottom-right dark accent */}
      <circle cx={cx + 4 + r * 0.3} cy={cy + 4 + r * 0.3} r={r * 0.5}
        fill="rgba(40, 20, 80, 0.08)" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 38, format, sensitivity = 160 }) {
  const [dragging, setDragging] = useState(false);
  const [ripple, setRipple] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);

  const onDown = e => {
    e.preventDefault(); setDragging(true); setRipple(true);
    setTimeout(() => setRipple(false), 300);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2,
    }}>
      <div
        onPointerDown={onDown}
        onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{
          width: size + 8, height: size + 8,
          cursor: dragging ? 'grabbing' : 'grab',
          position: 'relative',
        }}
      >
        {/* Ripple effect on drag start */}
        {ripple && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: size * 1.5, height: size * 1.5,
            borderRadius: '50%',
            border: '1px solid rgba(160, 130, 220, 0.3)',
            transform: 'translate(-50%, -50%) scale(0.5)',
            animation: 'knobRipple 0.3s ease-out forwards',
            pointerEvents: 'none',
          }} />
        )}
        <BubbleKnob size={size} norm={norm} dragging={dragging} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'rgba(160, 140, 200, 0.65)', fontWeight: 600, textAlign: 'center',
        width: '100%', lineHeight: 1.2,
        fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
        textShadow: '0 0 8px rgba(130, 100, 200, 0.15)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(140, 110, 200, 0.35)',
        fontFamily: '"Courier New",monospace', fontWeight: 600,
        textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

function VSlider({ value, onChange, label, min = 0, max = 1, defaultValue = 1, height = 52, format }) {
  const ref = useRef({ y: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / (height * 1.5))));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{
          width: 10, height, borderRadius: 5, position: 'relative',
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'rgba(15, 10, 25, 0.8)',
          border: '0.5px solid rgba(130, 100, 200, 0.1)',
        }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 1, right: 1,
          height: `${norm * 100}%`,
          background: 'linear-gradient(to top, rgba(130, 100, 200, 0.15), rgba(160, 130, 220, 0.08))',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 3,
          background: 'rgba(170, 140, 230, 0.5)',
          bottom: `calc(${norm * 100}% - 2px)`,
          boxShadow: '0 0 6px rgba(140, 110, 210, 0.25)',
        }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(160, 140, 210, 0.3)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(140, 110, 200, 0.25)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

const METER_SEGMENTS = 16;
function LedMeterDom({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{
      display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52,
      background: 'rgba(12, 8, 20, 0.8)', padding: '3px 2px', borderRadius: 3,
      border: '0.5px solid rgba(130, 100, 200, 0.06)', position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 1, background: 'rgba(140, 110, 200, 0.04)' }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{
    fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700,
    color: 'rgba(140, 110, 200, 0.3)', letterSpacing: '0.05em',
    width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2,
  }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    segmentEls[i].style.background = dB > threshDb
      ? (i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#c090e0' : 'rgba(150, 120, 220, 0.5)')
      : 'rgba(140, 110, 200, 0.04)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#c090e0' : 'rgba(140, 110, 200, 0.3)';
    dbEl.firstChild.textContent = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
  }
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',         smooth: 0.4, focus: 0.5, width: 0.4, air: 0.3, body: 0.5, mix: 1   },
  { name: 'GENTLE',       smooth: 0.2, focus: 0.5, width: 0.5, air: 0.2, body: 0.4, mix: 0.7 },
  { name: 'DE-HARSH',     smooth: 0.7, focus: 0.5, width: 0.4, air: 0.4, body: 0.5, mix: 1   },
  { name: 'VOCAL SMOOTH', smooth: 0.5, focus: 0.6, width: 0.3, air: 0.5, body: 0.6, mix: 0.9 },
  { name: 'MIX POLISH',   smooth: 0.35,focus: 0.4, width: 0.6, air: 0.3, body: 0.5, mix: 0.8 },
  { name: 'BRIGHT TAME',  smooth: 0.6, focus: 0.7, width: 0.3, air: 0.2, body: 0.4, mix: 1   },
  { name: 'WARM BLANKET', smooth: 0.8, focus: 0.4, width: 0.7, air: 0.1, body: 0.7, mix: 1   },
  { name: 'FULL CALM',    smooth: 0.9, focus: 0.5, width: 0.5, air: 0.4, body: 0.6, mix: 1   },
];

const PRESET_COLORS = {
  bg: '#0c0a14', text: 'rgba(160,140,220,0.75)', textDim: 'rgba(130,100,200,0.4)',
  border: 'rgba(130,100,200,0.1)', hoverBg: 'rgba(130,100,200,0.06)', activeBg: 'rgba(130,100,200,0.05)',
};

// ─── CSS Keyframes (injected once) ──────────────────────────────────────────
const STYLE_ID = 'smoother-zen-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes zenBreathe {
      0%, 100% { transform: scale(0.95); }
      50% { transform: scale(1.05); }
    }
    @keyframes knobRipple {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }
    @keyframes waterReflect {
      0%, 100% { opacity: 0.12; transform: scaleY(-1) translateY(0px); }
      50% { opacity: 0.08; transform: scaleY(-1) translateY(1px); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main Smoother Orb ──────────────────────────────────────────────────────
export default function SmootherOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0.4);
  const [focus,  setFocus]  = useState(initialState?.focus  ?? 0.5);
  const [width,  setWidth]  = useState(initialState?.width  ?? 0.4);
  const [air,    setAir]    = useState(initialState?.air    ?? 0.3);
  const [body,   setBody]   = useState(initialState?.body   ?? 0.5);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [harshLevel, setHarshLevel] = useState(0);
  const [peak, setPeak] = useState(0);

  const inMeterRef = useRef(null), outMeterRef = useRef(null);
  const inDbRef = useRef(null), outDbRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, smooth, focus, width, air, body, mix, bypassed };

  // ── Engine init ──
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createSmootherEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSmooth(s.smooth); eng.setFocus(s.focus); eng.setWidth(s.width);
      eng.setAir(s.air); eng.setBody(s.body); eng.setMix(s.mix);
      eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  // ── Meter + harshLevel + peak RAF ──
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        const inPeak = engineRef.current.getInputPeak();
        updateMeter(inMeterRef.current, inDbRef.current, inPeak);
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setHarshLevel(engineRef.current.getHarshLevel());
        setPeak(inPeak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, smooth, focus, width, air, body, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, smooth, focus, width, air, body, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setSmooth(p.smooth); setFocus(p.focus); setWidth(p.width);
    setAir(p.air); setBody(p.body); setMix(p.mix); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setSmooth(p.smooth); e.setFocus(p.focus); e.setWidth(p.width); e.setAir(p.air); e.setBody(p.body); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const freqFmt = v => { const f = 2000 + v * 4000; return f >= 1000 ? `${(f/1000).toFixed(1)}k` : `${Math.round(f)}`; };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 8, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #0e0a18 0%, #0a0814 25%, #08060f 50%, #06050c 75%, #0a0814 100%)',
      border: '1.5px solid rgba(130,100,200,0.12)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 30px rgba(120,80,200,0.06), inset 0 1px 0 rgba(180,150,240,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Watercolor wash background texture */}
      <WatercolorWash width={380} height={600} />

      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(130,100,200,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(120,80,200,0.03) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          {/* Water-reflected title */}
          <div style={{ position: 'relative' }}>
            <span style={{
              fontSize: 14, fontWeight: 900, letterSpacing: '0.12em',
              background: 'linear-gradient(135deg, #b890e0 0%, #9070c0 40%, #d0b0f0 70%, #b890e0 100%)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 10px rgba(130,100,200,0.25))',
              display: 'block',
            }}>SMOOTHER</span>
            {/* Reflected text (upside-down water reflection) */}
            <span style={{
              fontSize: 14, fontWeight: 900, letterSpacing: '0.12em',
              background: 'linear-gradient(135deg, #b890e0 0%, #9070c0 40%, #d0b0f0 70%, #b890e0 100%)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              display: 'block', position: 'absolute', top: '100%', left: 0,
              transform: 'scaleY(-1)',
              opacity: 0.1,
              filter: 'blur(1px)',
              animation: 'waterReflect 4s ease-in-out infinite',
              pointerEvents: 'none',
            }}>SMOOTHER</span>
          </div>
          <span style={{
            fontSize: 6, fontWeight: 600, color: 'rgba(150,120,200,0.3)',
            letterSpacing: '0.4em', marginTop: 4, textTransform: 'uppercase',
          }}>zen water pool</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(130,100,200,0.3)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 3,
            transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
          >×</span>}
        </div>
      </div>

      {/* Water Ripple Pool (Hero Visual) */}
      <div style={{ borderBottom: '1px solid rgba(130,100,200,0.05)', position: 'relative', zIndex: 2, flex: 1, minHeight: 0 }}>
        <WaterRipplePool smooth={smooth} focus={focus} width={width} air={air} harshLevel={harshLevel} peak={peak} />
      </div>

      {/* Harshness Thermometer */}
      <div style={{ borderBottom: '1px solid rgba(130,100,200,0.05)', position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <HarshThermometer harshLevel={harshLevel} />
      </div>

      {/* Meters + gain sliders */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(130,100,200,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs row 1: SMOOTH, FOCUS, WIDTH */}
      <div style={{
        padding: '7px 4px 3px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(130,100,200,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="SMOOTH" value={smooth} defaultValue={0.4} size={28} format={pctFmt} onChange={v => { setSmooth(v); engineRef.current?.setSmooth(v); setActivePreset(null); }} />
        <Knob label="FOCUS" value={focus} defaultValue={0.5} size={28} format={freqFmt} onChange={v => { setFocus(v); engineRef.current?.setFocus(v); setActivePreset(null); }} />
        <Knob label="WIDTH" value={width} defaultValue={0.4} size={28} format={v => v < 0.3 ? 'NARROW' : v > 0.7 ? 'WIDE' : 'MED'} onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
      </div>

      {/* Knobs row 2: AIR, BODY, MIX */}
      <div style={{
        padding: '4px 4px 6px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(130,100,200,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="AIR" value={air} defaultValue={0.3} size={28} format={pctFmt} onChange={v => { setAir(v); engineRef.current?.setAir(v); setActivePreset(null); }} />
        <Knob label="BODY" value={body} defaultValue={0.5} size={28} format={pctFmt} onChange={v => { setBody(v); engineRef.current?.setBody(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1} size={28} format={pctFmt} onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bypass — Zen Breathing Circle */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
          background: bypassed ? 'rgba(20, 15, 30, 0.5)' : 'rgba(25, 18, 40, 0.7)',
          border: `1.5px solid ${bypassed ? 'rgba(100, 70, 160, 0.12)' : 'rgba(150, 120, 220, 0.35)'}`,
          boxShadow: bypassed ? 'none' : '0 0 12px rgba(130, 100, 200, 0.2), inset 0 0 8px rgba(150, 120, 220, 0.1)',
          animation: bypassed ? 'none' : 'zenBreathe 4s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'border-color 0.3s, box-shadow 0.3s',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Inner glow */}
          {!bypassed && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              width: 16, height: 16, borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(circle, rgba(160, 130, 220, 0.2) 0%, transparent 70%)',
              pointerEvents: 'none',
            }} />
          )}
          <span style={{
            fontSize: 11, lineHeight: 1,
            color: bypassed ? 'rgba(100, 70, 160, 0.2)' : 'rgba(180, 150, 240, 0.6)',
            fontFamily: 'serif',
            transition: 'color 0.3s',
          }}>{'\u221E'}</span>
        </button>
        <span style={{
          fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
          color: bypassed ? 'rgba(100, 70, 160, 0.25)' : 'rgba(150, 120, 220, 0.45)',
          marginLeft: 6, textTransform: 'uppercase',
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
        }}>{bypassed ? 'STILL' : 'FLOWING'}</span>
      </div>
    </div>
  );
}
