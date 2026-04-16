import { useState, useEffect, useRef, useCallback } from 'react';
import { createEchoformEngine } from './echoformEngine';
import PresetSelector from './PresetSelector';

// ─── ECHOFORM: Infinite Echo Chamber ──────────────────────────────────────────
// Visual: DEEP SPACE TUNNEL — matte black, electric blue / ice blue
// Hero: Infinite perspective tunnel with pulsing echo rings, hyperspace particles
// Knobs: Holographic arc rings with bloom glow
// Bypass: Sci-fi portal ring with rotating dashes

// ─── Infinite Tunnel Canvas ───────────────────────────────────────────────────
function InfiniteTunnel({ feedback, degrade, motion, fbLevel, time, blur, peak = 0, outPeak = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const ringsRef = useRef([]);
  const starsRef = useRef(null);
  const lastPeakRef = useRef(0);
  const crystalsRef = useRef(null);
  const valRef = useRef({ feedback: 0, degrade: 0, motion: 0, fbLevel: 0, time: 0, blur: 0, peak: 0, outPeak: 0 });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { feedback, degrade, motion, fbLevel, time, blur, peak, outPeak };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize stars
    if (!starsRef.current) {
      const stars = [];
      for (let i = 0; i < 120; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random();
        stars.push({
          angle, dist,
          speed: 0.002 + Math.random() * 0.008,
          size: 0.3 + Math.random() * 1.5,
          brightness: 0.3 + Math.random() * 0.7,
        });
      }
      starsRef.current = stars;
    }

    // Initialize ice crystals for corners
    if (!crystalsRef.current) {
      const c = [];
      for (let corner = 0; corner < 4; corner++) {
        const branches = [];
        for (let b = 0; b < 5; b++) {
          branches.push({
            angle: (corner * Math.PI / 2) + Math.PI / 4 + (Math.random() - 0.5) * 0.8,
            length: 8 + Math.random() * 20,
            width: 0.3 + Math.random() * 0.7,
            subBranches: Math.floor(1 + Math.random() * 3),
          });
        }
        c.push({ corner, branches });
      }
      crystalsRef.current = c;
    }

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.006;
      const phase = phaseRef.current;
      const cx = W / 2;
      const cy = H / 2;

      // Read LIVE values from ref (not stale closure!)
      const { feedback: _feedback, degrade: _degrade, motion: _motion, fbLevel: _fbLevel, time: _time, blur: _blur, peak: _peak, outPeak: _outPeak } = valRef.current;

      // Audio transient detection -> spawn new pulse ring
      const currentPeak = _peak || 0;
      if (currentPeak > lastPeakRef.current + 0.05 && currentPeak > 0.1) {
        ringsRef.current.push({
          birth: phase,
          intensity: Math.min(1, currentPeak * 1.5),
          scale: 0,
        });
        if (ringsRef.current.length > 20) ringsRef.current.shift();
      }
      lastPeakRef.current = currentPeak * 0.9 + lastPeakRef.current * 0.1;

      // Breathing factor from audio
      const breathe = 1 + (currentPeak || 0) * 0.08;

      // Background — deep space gradient
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7);
      bgGrad.addColorStop(0, 'rgba(8,20,40,0.6)');
      bgGrad.addColorStop(0.5, 'rgba(4,10,20,0.4)');
      bgGrad.addColorStop(1, 'rgba(2,4,8,0.2)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── "ECHO CHAMBER" stencil text ──
      ctx.save();
      ctx.font = 'bold 42px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(40, 140, 255, 0.04)`;
      ctx.fillText('ECHO', cx, cy - 14);
      ctx.fillText('CHAMBER', cx, cy + 22);
      ctx.restore();

      // ── Tunnel rotation/wobble from MOTION ──
      const wobbleAngle = _motion * Math.sin(phase * 0.4) * 0.15;
      const spiralAngle = _feedback > 0.8 ? (_feedback - 0.8) * 5 * phase * 0.3 : 0;

      // ── Draw concentric tunnel rings ──
      const numRings = Math.floor(3 + _feedback * 12);
      for (let i = numRings; i >= 0; i--) {
        const progress = i / numRings; // 0 = center, 1 = outermost
        const perspectiveScale = 0.05 + progress * 0.95;

        // Ring dimensions with breathing
        const ringW = (W * 0.85 * perspectiveScale) * breathe;
        const ringH = (H * 0.75 * perspectiveScale) * breathe;

        // Degrade: rings get rougher/noisier
        const degradeNoise = _degrade * progress * 4;

        // Color: bright ice blue center -> deep dark blue edges
        const hue = 210 - progress * 15;
        const sat = 80 - progress * 30;
        const lightness = 70 - progress * 45;
        const alpha = (0.15 + _fbLevel * 0.3) * (1 - progress * 0.6);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(wobbleAngle * progress + spiralAngle * progress);

        // Rough edges from degrade
        ctx.beginPath();
        const sides = 40;
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const noiseOff = degradeNoise > 0.1
            ? Math.sin(a * 7 + phase * 2 + i) * degradeNoise * 3
              + Math.sin(a * 13 + phase * 3.7) * degradeNoise * 2
            : 0;
          const rx = (ringW / 2 + noiseOff);
          const ry = (ringH / 2 + noiseOff * 0.7);
          const px = Math.cos(a) * rx;
          const py = Math.sin(a) * ry;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();

        // Glow stroke
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
        ctx.lineWidth = 1.2 - progress * 0.6;
        ctx.shadowColor = `hsla(${hue}, ${sat}%, ${lightness + 20}%, ${alpha * 0.8})`;
        ctx.shadowBlur = 6 + (1 - progress) * 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Very faint fill for inner rings
        if (progress < 0.3) {
          ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha * 0.05})`;
          ctx.fill();
        }

        ctx.restore();
      }

      // ── Pulse rings from audio transients ──
      const rings = ringsRef.current;
      for (let r = rings.length - 1; r >= 0; r--) {
        const ring = rings[r];
        ring.scale += 0.02;
        if (ring.scale > 1.2) { rings.splice(r, 1); continue; }

        const ringProgress = ring.scale;
        const ringAlpha = ring.intensity * (1 - ringProgress) * 0.6;
        const ringW2 = W * 0.85 * ringProgress * breathe;
        const ringH2 = H * 0.75 * ringProgress * breathe;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(wobbleAngle * ringProgress);
        ctx.beginPath();
        ctx.ellipse(0, 0, ringW2 / 2, ringH2 / 2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(120, 200, 255, ${ringAlpha})`;
        ctx.lineWidth = 2 - ringProgress * 1.5;
        ctx.shadowColor = `rgba(100, 200, 255, ${ringAlpha * 0.8})`;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ── Center flash on loud hits ──
      if (currentPeak > 0.3) {
        const flashAlpha = (currentPeak - 0.3) * 1.4;
        const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30 + currentPeak * 20);
        flashGrad.addColorStop(0, `rgba(180, 220, 255, ${flashAlpha * 0.5})`);
        flashGrad.addColorStop(0.5, `rgba(80, 160, 255, ${flashAlpha * 0.2})`);
        flashGrad.addColorStop(1, 'rgba(40, 100, 255, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Hyperspace star particles ──
      const stars = starsRef.current;
      const starSpeedMult = 1 + (currentPeak || 0) * 3;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.dist += s.speed * starSpeedMult;
        if (s.dist > 1) { s.dist = 0; s.angle = Math.random() * Math.PI * 2; }

        const perspective = s.dist * s.dist; // accelerating perspective
        const sx = cx + Math.cos(s.angle + wobbleAngle) * perspective * W * 0.55;
        const sy = cy + Math.sin(s.angle + wobbleAngle) * perspective * H * 0.55;

        if (sx < -5 || sx > W + 5 || sy < -5 || sy > H + 5) continue;

        const starAlpha = s.brightness * perspective * (0.4 + _fbLevel * 0.5);
        const starSize = s.size * (0.2 + perspective * 1.5);

        // Star trail
        if (s.dist > 0.15) {
          const trailLen = 4 + perspective * 12 + currentPeak * 8;
          const tx = sx - Math.cos(s.angle + wobbleAngle) * trailLen;
          const ty = sy - Math.sin(s.angle + wobbleAngle) * trailLen;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = `rgba(100, 180, 255, ${starAlpha * 0.3})`;
          ctx.lineWidth = starSize * 0.5;
          ctx.stroke();
        }

        // Star dot
        ctx.beginPath();
        ctx.arc(sx, sy, starSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(160, 210, 255, ${starAlpha})`;
        ctx.fill();
      }

      // ── Ice crystal formations at corners ──
      const crystalGrowth = Math.min(1, _feedback * 1.2);
      if (crystalGrowth > 0.1) {
        const crystals = crystalsRef.current;
        const corners = [
          [8, 8], [W - 8, 8], [W - 8, H - 8], [8, H - 8]
        ];
        ctx.lineWidth = 0.5;
        for (let ci = 0; ci < crystals.length; ci++) {
          const crystal = crystals[ci];
          const [ox, oy] = corners[ci];
          for (let b = 0; b < crystal.branches.length; b++) {
            const br = crystal.branches[b];
            const len = br.length * crystalGrowth;
            const ex = ox + Math.cos(br.angle) * len;
            const ey = oy + Math.sin(br.angle) * len;
            const cAlpha = 0.1 + crystalGrowth * 0.15;

            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = `rgba(120, 200, 255, ${cAlpha})`;
            ctx.stroke();

            // Sub-branches
            for (let sb = 0; sb < br.subBranches; sb++) {
              const frac = 0.3 + (sb / br.subBranches) * 0.5;
              const mx = ox + (ex - ox) * frac;
              const my = oy + (ey - oy) * frac;
              const subAngle = br.angle + (sb % 2 === 0 ? 0.5 : -0.5);
              const subLen = len * 0.3 * crystalGrowth;
              const sbx = mx + Math.cos(subAngle) * subLen;
              const sby = my + Math.sin(subAngle) * subLen;
              ctx.beginPath();
              ctx.moveTo(mx, my);
              ctx.lineTo(sbx, sby);
              ctx.strokeStyle = `rgba(100, 180, 255, ${cAlpha * 0.6})`;
              ctx.stroke();
            }
          }
        }
      }

      // ── Waveform preview squiggle at bottom ──
      const waveY = H - 14;
      ctx.beginPath();
      for (let x = 0; x < W; x += 2) {
        const t = x / W;
        const amp = 3 + (_outPeak || 0) * 6;
        const y = waveY + Math.sin(t * 20 + phase * 4) * amp * Math.sin(t * Math.PI)
          + Math.sin(t * 35 + phase * 6) * amp * 0.3;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(60, 160, 255, ${0.1 + (_outPeak || 0) * 0.25})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // ── Feedback intensity bar (thin glow line at very bottom) ──
      const barY = H - 3;
      const fbIntensity = Math.min(1, _fbLevel * 1.2);
      if (fbIntensity > 0.01) {
        const glowGrad = ctx.createLinearGradient(20, barY, W - 20, barY);
        glowGrad.addColorStop(0, `rgba(40, 140, 255, 0)`);
        glowGrad.addColorStop(0.15, `rgba(40, 140, 255, ${fbIntensity * 0.4})`);
        glowGrad.addColorStop(0.5, `rgba(80, 200, 255, ${fbIntensity * 0.6})`);
        glowGrad.addColorStop(0.85, `rgba(40, 140, 255, ${fbIntensity * 0.4})`);
        glowGrad.addColorStop(1, `rgba(40, 140, 255, 0)`);
        ctx.fillStyle = glowGrad;
        ctx.fillRect(20, barY - 2, W - 40, 4);

        ctx.beginPath();
        ctx.moveTo(30, barY);
        ctx.lineTo(W - 30, barY);
        ctx.strokeStyle = `rgba(100, 200, 255, ${fbIntensity * 0.9})`;
        ctx.lineWidth = 0.8;
        ctx.shadowColor = `rgba(80, 180, 255, ${fbIntensity * 0.7})`;
        ctx.shadowBlur = fbIntensity * 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── Portal Ring Bypass Button ────────────────────────────────────────────────
function PortalBypass({ active, onClick }) {
  const size = 28;
  const id = useRef(`portal-${Math.random().toString(36).slice(2, 7)}`).current;
  const circumference = Math.PI * 22; // ~69

  return (
    <div
      onClick={onClick}
      style={{ cursor: 'pointer', position: 'relative', width: size, height: size }}
      title={active ? 'Active' : 'Bypassed'}
    >
      <svg width={size} height={size} viewBox="0 0 28 28" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <filter id={`${id}-glow`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Outer glow when active */}
        {active && (
          <circle cx="14" cy="14" r="12"
            fill="none" stroke="rgba(60,180,255,0.2)" strokeWidth="4"
            filter={`url(#${id}-glow)`}
          />
        )}

        {/* Main ring */}
        <circle cx="14" cy="14" r="11"
          fill="none"
          stroke={active ? 'rgba(60,180,255,0.7)' : 'rgba(40,80,120,0.25)'}
          strokeWidth="1.5"
        />

        {/* Rotating dashes */}
        <circle cx="14" cy="14" r="11"
          fill="none"
          stroke={active ? 'rgba(120,210,255,0.8)' : 'rgba(40,80,120,0.15)'}
          strokeWidth="1"
          strokeDasharray="4 6"
          strokeLinecap="round"
          style={{
            transformOrigin: '14px 14px',
            animation: active ? 'portalSpin 3s linear infinite' : 'none',
          }}
        />

        {/* Center glow */}
        {active && (
          <circle cx="14" cy="14" r="5"
            fill="rgba(60,180,255,0.15)"
          />
        )}

        {/* Center dot */}
        <circle cx="14" cy="14" r="2"
          fill={active ? 'rgba(120,210,255,0.9)' : 'rgba(40,80,120,0.3)'}
        />
      </svg>

      <style>{`
        @keyframes portalSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Holographic Ring Knob ────────────────────────────────────────────────────
function HoloKnob({ size = 26, norm = 0 }) {
  const cx = size / 2 + 3, cy = size / 2 + 3;
  const r = size / 2;
  const arcR = r + 2;
  const id = useRef(`hk-${Math.random().toString(36).slice(2, 7)}`).current;

  // Arc angles: -135deg to +135deg (270deg range)
  const startAngle = -225; // degrees (pointing ~7 o'clock)
  const endAngle = startAngle + norm * 270;
  const toRad = d => (d * Math.PI) / 180;

  // Arc path
  const arcStart = toRad(startAngle);
  const arcEnd = toRad(endAngle);
  const arcX1 = cx + arcR * Math.cos(arcStart);
  const arcY1 = cy + arcR * Math.sin(arcStart);
  const arcX2 = cx + arcR * Math.cos(arcEnd);
  const arcY2 = cy + arcR * Math.sin(arcEnd);
  const largeArc = (norm * 270) > 180 ? 1 : 0;
  const arcPath = norm > 0.005
    ? `M ${arcX1} ${arcY1} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcX2} ${arcY2}`
    : '';

  // Endpoint dot position
  const dotAngle = toRad(endAngle);
  const dotX = cx + arcR * Math.cos(dotAngle);
  const dotY = cy + arcR * Math.sin(dotAngle);

  // Tick marks
  const ticks = 24;
  const tickMarks = [];
  for (let i = 0; i <= ticks; i++) {
    const tickAngle = toRad(startAngle + (i / ticks) * 270);
    const inner = arcR - 1.5;
    const outer = arcR + 0.5;
    tickMarks.push({
      x1: cx + inner * Math.cos(tickAngle),
      y1: cy + inner * Math.sin(tickAngle),
      x2: cx + outer * Math.cos(tickAngle),
      y2: cy + outer * Math.sin(tickAngle),
    });
  }

  // Pointer line
  const pAngle = toRad(startAngle + norm * 270);
  const pInner = r * 0.15;
  const pOuter = r * 0.55;

  return (
    <svg width={size + 6} height={size + 6} style={{ display: 'block', overflow: 'visible', margin: '-3px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgba(20,40,60,0.6)" />
          <stop offset="60%" stopColor="rgba(8,16,28,0.8)" />
          <stop offset="100%" stopColor="rgba(4,8,16,0.9)" />
        </radialGradient>
        <filter id={`${id}-bloom`}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.7)" />
        </filter>
      </defs>

      {/* Dark void center */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-bg)`} filter={`url(#${id}-sh)`} />

      {/* Subtle pulse ring */}
      <circle cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(40,120,200,0.08)"
        strokeWidth="0.5"
      />

      {/* Tick marks around outer edge */}
      {tickMarks.map((t, i) => (
        <line key={i}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={`rgba(60,160,255,${i % 6 === 0 ? 0.2 : 0.08})`}
          strokeWidth="0.3"
        />
      ))}

      {/* Value arc with bloom */}
      {arcPath && (
        <path d={arcPath}
          fill="none"
          stroke="rgba(60,180,255,0.8)"
          strokeWidth="1.8"
          strokeLinecap="round"
          filter={`url(#${id}-bloom)`}
        />
      )}

      {/* Bright endpoint dot */}
      {norm > 0.005 && (
        <circle cx={dotX} cy={dotY} r="2"
          fill="rgba(140,220,255,1)"
          filter={`url(#${id}-bloom)`}
        />
      )}

      {/* Pointer line */}
      <line
        x1={cx + pInner * Math.cos(pAngle)}
        y1={cy + pInner * Math.sin(pAngle)}
        x2={cx + pOuter * Math.cos(pAngle)}
        y2={cy + pOuter * Math.sin(pAngle)}
        stroke="rgba(120,200,255,0.7)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Knob wrapper (drag behavior + label/display) ────────────────────────────
function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 26, format, sensitivity = 140 }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 14, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size + 6, height: size + 6, cursor: dragging ? 'grabbing' : 'grab' }}>
        <HoloKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(80,180,255,0.75)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 5.5, color: 'rgba(60,160,255,0.45)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Tiny gain knob for header (20px) ─────────────────────────────────────────
function GainKnob({ value, onChange, label, defaultValue = 1 }) {
  const size = 20;
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = Math.min(1, value / 2);
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221e'; };

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(0, Math.min(2, ref.current.v + (ref.current.y - ev.clientY) * 2 / 100)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)} style={{ width: size + 4, height: size + 4, cursor: dragging ? 'grabbing' : 'grab' }}>
        <HoloKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(60,160,255,0.45)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',        time: 0.4, feedback: 0.4, degrade: 0.3, motion: 0,   blur: 0,   tone: 0.5, mix: 0.35 },
  { name: 'TAPE ECHO',   time: 0.35,feedback: 0.5, degrade: 0.6, motion: 0.2, blur: 0.1, tone: 0.4, mix: 0.35 },
  { name: 'PRISTINE',    time: 0.4, feedback: 0.4, degrade: 0,   motion: 0,   blur: 0,   tone: 0.7, mix: 0.3 },
  { name: 'MEMORY FADE', time: 0.5, feedback: 0.65,degrade: 0.7, motion: 0.15,blur: 0.3, tone: 0.35,mix: 0.4 },
  { name: 'DRIFT ECHO',  time: 0.45,feedback: 0.5, degrade: 0.4, motion: 0.6, blur: 0.2, tone: 0.5, mix: 0.35 },
  { name: 'SMEARED',     time: 0.6, feedback: 0.55,degrade: 0.5, motion: 0.3, blur: 0.7, tone: 0.4, mix: 0.4 },
  { name: 'DISSOLVE',    time: 0.7, feedback: 0.75,degrade: 0.8, motion: 0.4, blur: 0.5, tone: 0.3, mix: 0.45 },
  { name: 'ARTIFACT',    time: 0.3, feedback: 0.85,degrade: 0.9, motion: 0.7, blur: 0.6, tone: 0.3, mix: 0.5 },
];

const PRESET_COLORS = {
  bg: '#080c14', text: '#60a8e0', textDim: 'rgba(40,140,255,0.5)',
  border: 'rgba(40,140,255,0.12)', hoverBg: 'rgba(40,140,255,0.1)', activeBg: 'rgba(40,140,255,0.06)',
};

// ─── Sci-fi LCD Time Readout ──────────────────────────────────────────────────
function LCDReadout({ value }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(4,10,20,0.8)',
      border: '1px solid rgba(40,140,255,0.15)',
      borderRadius: 3,
      padding: '3px 10px',
      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.5), 0 0 8px rgba(40,140,255,0.06)',
    }}>
      <span style={{
        fontSize: 13, fontWeight: 700, fontFamily: '"Courier New", monospace',
        color: 'rgba(80,200,255,0.85)',
        letterSpacing: '0.12em',
        textShadow: '0 0 8px rgba(40,180,255,0.5), 0 0 20px rgba(40,140,255,0.15)',
      }}>{value}</span>
    </div>
  );
}

// ─── Film sprocket holes ──────────────────────────────────────────────────────
function FilmBorder({ side }) {
  const holes = 18;
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0, [side]: 0, width: 10,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', alignItems: 'center',
      pointerEvents: 'none', zIndex: 1,
    }}>
      {Array.from({ length: holes }).map((_, i) => (
        <div key={i} style={{
          width: 3.5, height: 3.5, borderRadius: 1,
          background: 'rgba(60, 120, 180, 0.06)',
          border: '0.5px solid rgba(60, 120, 180, 0.1)',
        }} />
      ))}
    </div>
  );
}

export default function EchoformOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [time,     setTime]     = useState(initialState?.time     ?? 0.4);
  const [feedback, setFeedback] = useState(initialState?.feedback ?? 0.4);
  const [degrade,  setDegrade]  = useState(initialState?.degrade  ?? 0.3);
  const [motion,   setMotion]   = useState(initialState?.motion   ?? 0);
  const [blur,     setBlur]     = useState(initialState?.blur     ?? 0);
  const [tone,     setTone]     = useState(initialState?.tone     ?? 0.5);
  const [mix,      setMix]      = useState(initialState?.mix      ?? 0.35);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [fbLevel, setFbLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, time, feedback, degrade, motion, blur, tone, mix, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createEchoformEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setTime(s.time); eng.setFeedback(s.feedback); eng.setDegrade(s.degrade);
      eng.setMotion(s.motion); eng.setBlur(s.blur); eng.setTone(s.tone); eng.setMix(s.mix);
      eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        setFbLevel(engineRef.current.getFbLevel());
        const p = engineRef.current.getInputPeak?.() ?? 0;
        const op = engineRef.current.getPeakOutput?.() ?? engineRef.current.getOutputPeak?.() ?? 0;
        setPeak(p);
        setOutPeak(op);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, time, feedback, degrade, motion, blur, tone, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, time, feedback, degrade, motion, blur, tone, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setTime(p.time); setFeedback(p.feedback); setDegrade(p.degrade);
    setMotion(p.motion); setBlur(p.blur); setTone(p.tone); setMix(p.mix);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setTime(p.time); e.setFeedback(p.feedback); e.setDegrade(p.degrade); e.setMotion(p.motion); e.setBlur(p.blur); e.setTone(p.tone); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const delayMs = Math.round(50 + time * 1150);
  const timeDisplay = delayMs < 1000 ? `${delayMs}ms` : `${(delayMs / 1000).toFixed(2)}s`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #0e1220 0%, #0b0f1a 20%, #090d16 45%, #080c14 70%, #060a10 100%)',
      border: '1.5px solid rgba(40,140,255,0.15)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 20px rgba(40,140,255,0.08), inset 0 1px 0 rgba(60,160,255,0.06)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* ── Dark blue vignette overlay ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(4,6,14,0.5) 100%)',
        borderRadius: 5,
      }} />

      {/* ── Film sprocket borders ── */}
      <FilmBorder side="left" />
      <FilmBorder side="right" />

      {/* ── Header: title flanked by IN/OUT gain knobs ── */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(40,140,255,0.08)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(40,140,255,0.025) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
            background: 'linear-gradient(135deg, #4090ff 0%, #5098ff 30%, #80c0ff 50%, #60a8ff 70%, #4090ff 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(40,140,255,0.3))',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>ECHOFORM</span>
          <span style={{
            fontSize: 6, fontWeight: 400, color: 'rgba(60,150,255,0.35)',
            letterSpacing: '0.3em', marginTop: 1.5,
            fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif',
          }}>infinite echo chamber</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* ── Preset selector row ── */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(40,140,255,0.06)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(40,140,255,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* ── HERO: Infinite Tunnel canvas (340x180) ── */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0 }}>
        <InfiniteTunnel
          feedback={feedback} degrade={degrade} motion={motion}
          fbLevel={fbLevel} time={time} blur={blur}
          peak={peak} outPeak={outPeak}
        />
      </div>

      {/* ── Sci-fi LCD time readout ── */}
      <div style={{
        padding: '4px 0 3px', display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 2,
        borderBottom: '1px solid rgba(40,140,255,0.06)', flexShrink: 0,
      }}>
        <LCDReadout value={timeDisplay} />
      </div>

      {/* ── All 7 knobs in one row (holographic arc knobs) ── */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(40,140,255,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="TIME" value={time} defaultValue={0.4} size={28}
          format={v => { const ms = 50 + v * 1150; return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`; }}
          onChange={v => { setTime(v); engineRef.current?.setTime(v); setActivePreset(null); }} />
        <Knob label="FDBK" value={feedback} defaultValue={0.4} size={28} format={pctFmt}
          onChange={v => { setFeedback(v); engineRef.current?.setFeedback(v); setActivePreset(null); }} />
        <Knob label="DEGRADE" value={degrade} defaultValue={0.3} size={28} format={pctFmt}
          onChange={v => { setDegrade(v); engineRef.current?.setDegrade(v); setActivePreset(null); }} />
        <Knob label="MOTION" value={motion} defaultValue={0} size={28} format={pctFmt}
          onChange={v => { setMotion(v); engineRef.current?.setMotion(v); setActivePreset(null); }} />
        <Knob label="BLUR" value={blur} defaultValue={0} size={28} format={pctFmt}
          onChange={v => { setBlur(v); engineRef.current?.setBlur(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={28} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.35} size={28} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* ── Footer: Portal bypass ring ── */}
      <div style={{ padding: '4px 18px 5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <PortalBypass
          active={!bypassed}
          onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
        />
      </div>
    </div>
  );
}
