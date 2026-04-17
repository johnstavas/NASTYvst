import { useState, useEffect, useRef, useCallback } from 'react';
import { createEchoformEngine } from './echoformEngine';
import PresetSelector from './PresetSelector';

// ─── ECHOFORM: Infinite Echo Chamber ──────────────────────────────────────────
// Visual: CRAZY RAINBOW TUNNEL — dark void, full spectrum cycling rings
// Hero: Infinite perspective tunnel with rainbow echo rings, hyperspace particles
// Knobs: Rainbow arc rings with bloom glow
// Bypass: Smooth analog toggle switch

// ─── Infinite Tunnel Canvas ───────────────────────────────────────────────────
function InfiniteTunnel({ feedback, degrade, motion, fbLevel, time, blur, width = 1, peak = 0, outPeak = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const ringsRef = useRef([]);
  const starsRef = useRef(null);
  const lastPeakRef = useRef(0);
  const crystalsRef = useRef(null);
  const valRef = useRef({ feedback: 0, degrade: 0, motion: 0, fbLevel: 0, time: 0, blur: 0, width: 1, peak: 0, outPeak: 0 });

  valRef.current = { feedback, degrade, motion, fbLevel, time, blur, width, peak, outPeak };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 178;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize stars with individual hue
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
          hue: Math.random() * 360,
        });
      }
      starsRef.current = stars;
    }

    // Initialize crystals with hue per branch
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
            hue: corner * 90 + Math.random() * 60,
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

      const { feedback: _feedback, degrade: _degrade, motion: _motion, fbLevel: _fbLevel, time: _time, blur: _blur, width: _width, peak: _peak, outPeak: _outPeak } = valRef.current;

      // Audio transient → spawn pulse ring with current rainbow hue
      const currentPeak = _peak || 0;
      if (currentPeak > lastPeakRef.current + 0.05 && currentPeak > 0.1) {
        ringsRef.current.push({
          birth: phase,
          intensity: Math.min(1, currentPeak * 1.5),
          scale: 0,
          hue: (phase * 80) % 360,
        });
        if (ringsRef.current.length > 20) ringsRef.current.shift();
      }
      lastPeakRef.current = currentPeak * 0.9 + lastPeakRef.current * 0.1;

      const breathe = 1 + currentPeak * 0.08;

      // Background — dark void with very slow hue drift
      const bgHue = (phase * 7) % 360;
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7);
      bgGrad.addColorStop(0, `hsla(${bgHue}, 55%, 5%, 0.75)`);
      bgGrad.addColorStop(0.5, `hsla(${(bgHue + 40) % 360}, 40%, 3%, 0.5)`);
      bgGrad.addColorStop(1, `hsla(${(bgHue + 80) % 360}, 30%, 1%, 0.25)`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);


      // Wobble/spiral from MOTION/FEEDBACK
      const wobbleAngle = _motion * Math.sin(phase * 0.4) * 0.15;
      const spiralAngle = _feedback > 0.8 ? (_feedback - 0.8) * 5 * phase * 0.3 : 0;

      // ── Rainbow concentric tunnel rings ──
      // Each ring gets a different hue; the whole spectrum rotates over time
      const numRings = Math.floor(3 + _feedback * 12);
      for (let i = numRings; i >= 0; i--) {
        const progress = i / numRings;
        const perspectiveScale = 0.05 + progress * 0.95;

        // Width stretches rings horizontally: 0=circular, 1=normal, 2=very wide
        const widthStretch = 0.65 + _width * 0.35;
        const ringW = (W * 0.85 * perspectiveScale) * breathe * widthStretch;
        const ringH = (H * 0.75 * perspectiveScale) * breathe * (1 / Math.max(0.5, widthStretch * 0.85));

        const degradeNoise = _degrade * progress * 4;

        // Full spectrum, one full rainbow per tunnel depth, rotating over time
        const hue = (phase * 35 + (i / Math.max(1, numRings)) * 360) % 360;
        const sat = 90;
        const lightness = 65 - progress * 30;
        const alpha = (0.22 + _fbLevel * 0.38) * (1 - progress * 0.52);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(wobbleAngle * progress + spiralAngle * progress);

        ctx.beginPath();
        const sides = 40;
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const noiseOff = degradeNoise > 0.1
            ? Math.sin(a * 7 + phase * 2 + i) * degradeNoise * 3
              + Math.sin(a * 13 + phase * 3.7) * degradeNoise * 2
            : 0;
          const rx = ringW / 2 + noiseOff;
          const ry = ringH / 2 + noiseOff * 0.7;
          const px = Math.cos(a) * rx;
          const py = Math.sin(a) * ry;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();

        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha})`;
        ctx.lineWidth = 1.2 - progress * 0.5;
        ctx.shadowColor = `hsla(${hue}, ${sat}%, ${lightness + 18}%, ${alpha * 0.9})`;
        ctx.shadowBlur = 8 + (1 - progress) * 14;
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (progress < 0.3) {
          ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lightness}%, ${alpha * 0.06})`;
          ctx.fill();
        }

        ctx.restore();
      }

      // ── Rainbow pulse rings (audio-triggered) ──
      const rings = ringsRef.current;
      for (let r = rings.length - 1; r >= 0; r--) {
        const ring = rings[r];
        ring.scale += 0.02;
        if (ring.scale > 1.2) { rings.splice(r, 1); continue; }

        const ringProgress = ring.scale;
        const ringAlpha = ring.intensity * (1 - ringProgress) * 0.7;
        const ringW2 = W * 0.85 * ringProgress * breathe;
        const ringH2 = H * 0.75 * ringProgress * breathe;
        const rHue = (ring.hue + ring.scale * 80) % 360;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(wobbleAngle * ringProgress);
        ctx.beginPath();
        ctx.ellipse(0, 0, ringW2 / 2, ringH2 / 2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${rHue}, 92%, 72%, ${ringAlpha})`;
        ctx.lineWidth = 2 - ringProgress * 1.5;
        ctx.shadowColor = `hsla(${rHue}, 92%, 80%, ${ringAlpha * 0.85})`;
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ── Center flash on loud hits ──
      if (currentPeak > 0.3) {
        const flashAlpha = (currentPeak - 0.3) * 1.4;
        const flashHue = (phase * 70) % 360;
        const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30 + currentPeak * 20);
        flashGrad.addColorStop(0, `hsla(${flashHue}, 60%, 92%, ${flashAlpha * 0.5})`);
        flashGrad.addColorStop(0.5, `hsla(${(flashHue + 40) % 360}, 80%, 70%, ${flashAlpha * 0.2})`);
        flashGrad.addColorStop(1, `hsla(${(flashHue + 80) % 360}, 80%, 50%, 0)`);
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Rainbow hyperspace star particles ──
      const stars = starsRef.current;
      const starSpeedMult = 1 + currentPeak * 3;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.dist += s.speed * starSpeedMult;
        if (s.dist > 1) { s.dist = 0; s.angle = Math.random() * Math.PI * 2; }
        s.hue = (s.hue + 0.35) % 360; // slowly cycle each star's color

        const perspective = s.dist * s.dist;
        const starSpreadX = 0.45 + _width * 0.25; // wider spread at high width
        const starSpreadY = 0.55 / Math.max(0.5, _width * 0.55 + 0.45);
        const sx = cx + Math.cos(s.angle + wobbleAngle) * perspective * W * starSpreadX;
        const sy = cy + Math.sin(s.angle + wobbleAngle) * perspective * H * starSpreadY;

        if (sx < -5 || sx > W + 5 || sy < -5 || sy > H + 5) continue;

        const starAlpha = s.brightness * perspective * (0.4 + _fbLevel * 0.5);
        const starSize = s.size * (0.2 + perspective * 1.5);

        if (s.dist > 0.15) {
          const trailLen = 4 + perspective * 12 + currentPeak * 8;
          const tx = sx - Math.cos(s.angle + wobbleAngle) * trailLen;
          const ty = sy - Math.sin(s.angle + wobbleAngle) * trailLen;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = `hsla(${s.hue}, 85%, 65%, ${starAlpha * 0.35})`;
          ctx.lineWidth = starSize * 0.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(sx, sy, starSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, 92%, 72%, ${starAlpha})`;
        ctx.fill();
      }

      // ── Rainbow corner crystal formations ──
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
            const cHue = (br.hue + phase * 22) % 360;
            const cAlpha = 0.12 + crystalGrowth * 0.20;

            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = `hsla(${cHue}, 88%, 68%, ${cAlpha})`;
            ctx.stroke();

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
              ctx.strokeStyle = `hsla(${(cHue + 40) % 360}, 80%, 60%, ${cAlpha * 0.6})`;
              ctx.stroke();
            }
          }
        }
      }

      // ── Rainbow waveform preview at bottom ──
      const waveY = H - 14;
      const waveHue = (phase * 50) % 360;
      ctx.beginPath();
      for (let x = 0; x < W; x += 2) {
        const t = x / W;
        const amp = 3 + (_outPeak || 0) * 6;
        const y = waveY + Math.sin(t * 20 + phase * 4) * amp * Math.sin(t * Math.PI)
          + Math.sin(t * 35 + phase * 6) * amp * 0.3;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${waveHue}, 88%, 68%, ${0.12 + (_outPeak || 0) * 0.28})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // ── Rainbow feedback intensity bar ──
      const barY = H - 3;
      const fbIntensity = Math.min(1, _fbLevel * 1.2);
      if (fbIntensity > 0.01) {
        const glowGrad = ctx.createLinearGradient(20, barY, W - 20, barY);
        glowGrad.addColorStop(0,    `hsla(0,   88%, 62%, 0)`);
        glowGrad.addColorStop(0.08, `hsla(0,   88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(0.22, `hsla(60,  88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(0.38, `hsla(120, 88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(0.5,  `hsla(180, 88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(0.62, `hsla(240, 88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(0.78, `hsla(300, 88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(0.92, `hsla(360, 88%, 62%, ${fbIntensity * 0.52})`);
        glowGrad.addColorStop(1,    `hsla(360, 88%, 62%, 0)`);
        ctx.fillStyle = glowGrad;
        ctx.fillRect(20, barY - 2, W - 40, 4);

        const lineHue = (phase * 28) % 360;
        ctx.beginPath();
        ctx.moveTo(30, barY);
        ctx.lineTo(W - 30, barY);
        ctx.strokeStyle = `hsla(${lineHue}, 92%, 68%, ${fbIntensity * 0.9})`;
        ctx.lineWidth = 0.8;
        ctx.shadowColor = `hsla(${lineHue}, 92%, 72%, ${fbIntensity * 0.7})`;
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

// ─── Smooth Analog Toggle (bypass) ────────────────────────────────────────────
function AnalogToggle({ active, onClick }) {
  return (
    <div
      onClick={onClick}
      title={active ? 'Active' : 'Bypassed'}
      style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}
    >
      {/* Dark recessed track — always dark, feels like a physical slot */}
      <div style={{
        width: 90, height: 28, borderRadius: 5, position: 'relative',
        background: 'linear-gradient(180deg, #0e0809 0%, #160c10 50%, #0e0809 100%)',
        border: '1.5px solid rgba(180,130,150,0.28)',
        boxShadow: [
          'inset 0 3px 7px rgba(0,0,0,0.75)',
          'inset 0 -1px 2px rgba(255,255,255,0.03)',
          active ? '0 0 18px rgba(200,120,155,0.55), 0 0 38px rgba(180,90,130,0.22)' : '',
        ].filter(Boolean).join(', '),
        transition: 'box-shadow 0.25s ease',
      }}>

        {/* BYP label left */}
        <span style={{
          position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
          fontSize: 6.5, fontWeight: 800, letterSpacing: '0.06em',
          color: active ? 'rgba(165,130,145,0.30)' : 'rgba(210,155,170,0.62)',
          fontFamily: 'system-ui', pointerEvents: 'none', zIndex: 1,
          transition: 'color 0.2s',
        }}>BYP</span>

        {/* ON label right */}
        <span style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          fontSize: 6.5, fontWeight: 800, letterSpacing: '0.06em',
          color: active ? 'rgba(235,188,202,0.92)' : 'rgba(165,130,145,0.28)',
          fontFamily: 'system-ui', pointerEvents: 'none', zIndex: 1,
          transition: 'color 0.2s',
        }}>ON</span>

        {/* Silver knob — clearly 3-D, slides left↔right */}
        <div style={{
          position: 'absolute', top: 2, bottom: 2,
          left: active ? 50 : 2,
          width: 36, borderRadius: 4,
          background: 'linear-gradient(180deg, #e8e8f2 0%, #c4c4d0 22%, #9a9aa8 52%, #c4c4d0 78%, #e8e8f2 100%)',
          boxShadow: [
            '0 3px 8px rgba(0,0,0,0.65)',
            'inset 0 1px 0 rgba(255,255,255,0.50)',
            'inset 0 -1px 0 rgba(0,0,0,0.28)',
            'inset 1px 0 0 rgba(255,255,255,0.20)',
            'inset -1px 0 0 rgba(0,0,0,0.15)',
          ].join(', '),
          border: '0.5px solid rgba(80,60,120,0.25)',
          transition: 'left 0.18s cubic-bezier(0.34,1.2,0.64,1)',
          zIndex: 2,
        }}>
          {/* Rainbow LED strip on face */}
          <div style={{
            position: 'absolute', top: '50%', left: 5, right: 5, height: 4,
            transform: 'translateY(-50%)',
            borderRadius: 2,
            background: active
              ? 'linear-gradient(90deg, #ff0040, #ff8800, #ffee00, #00ff80, #00ccff, #9040ff)'
              : 'rgba(150,105,125,0.18)',
            boxShadow: active
              ? '0 0 5px rgba(255,200,100,0.9), 0 0 14px rgba(160,80,255,0.70), 0 0 24px rgba(80,200,255,0.40)'
              : 'none',
            transition: 'all 0.2s ease',
          }} />
        </div>
      </div>

      {/* State label */}
      <span style={{
        fontSize: 7, letterSpacing: '0.20em', fontFamily: 'system-ui', fontWeight: 700,
        color: active ? 'rgba(230,170,185,0.72)' : 'rgba(175,130,145,0.42)',
        transition: 'color 0.25s',
      }}>{active ? 'ACTIVE' : 'BYPASSED'}</span>
    </div>
  );
}

// ─── Holographic Rainbow Ring Knob ────────────────────────────────────────────
function HoloKnob({ size = 26, norm = 0 }) {
  const cx = size / 2 + 3, cy = size / 2 + 3;
  const r = size / 2;
  const arcR = r + 2;
  const id = useRef(`hk-${Math.random().toString(36).slice(2, 7)}`).current;

  const startAngle = -225;
  const endAngle = startAngle + norm * 270;
  const toRad = d => (d * Math.PI) / 180;

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

  const dotAngle = toRad(endAngle);
  const dotX = cx + arcR * Math.cos(dotAngle);
  const dotY = cy + arcR * Math.sin(dotAngle);

  // Hue at current position (0 → red, full turn → violet/magenta)
  const dotHue = Math.round(norm * 300);

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
      hue: Math.round((i / ticks) * 300),
    });
  }

  const pAngle = toRad(startAngle + norm * 270);
  const pInner = r * 0.15;
  const pOuter = r * 0.55;

  return (
    <svg width={size + 6} height={size + 6} style={{ display: 'block', overflow: 'visible', margin: '-3px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgba(20,15,35,0.7)" />
          <stop offset="60%" stopColor="rgba(10,6,20,0.85)" />
          <stop offset="100%" stopColor="rgba(5,3,10,0.95)" />
        </radialGradient>
        {/* Rainbow arc gradient */}
        <linearGradient id={`${id}-rainbow`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="hsl(0,92%,62%)" />
          <stop offset="16%"  stopColor="hsl(60,92%,62%)" />
          <stop offset="33%"  stopColor="hsl(120,92%,62%)" />
          <stop offset="50%"  stopColor="hsl(180,92%,62%)" />
          <stop offset="66%"  stopColor="hsl(240,92%,62%)" />
          <stop offset="83%"  stopColor="hsl(300,92%,62%)" />
          <stop offset="100%" stopColor="hsl(330,92%,62%)" />
        </linearGradient>
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
        stroke="rgba(210,148,168,0.06)"
        strokeWidth="0.5"
      />

      {/* Rainbow tick marks */}
      {tickMarks.map((t, i) => (
        <line key={i}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={`hsla(${t.hue}, 80%, 65%, ${i % 6 === 0 ? 0.28 : 0.10})`}
          strokeWidth="0.3"
        />
      ))}

      {/* Rainbow value arc with bloom */}
      {arcPath && (
        <path d={arcPath}
          fill="none"
          stroke={`url(#${id}-rainbow)`}
          strokeWidth="1.8"
          strokeLinecap="round"
          filter={`url(#${id}-bloom)`}
        />
      )}

      {/* Bright rainbow endpoint dot */}
      {norm > 0.005 && (
        <circle cx={dotX} cy={dotY} r="2"
          fill={`hsl(${dotHue}, 95%, 72%)`}
          filter={`url(#${id}-bloom)`}
        />
      )}

      {/* Rainbow pointer line */}
      <line
        x1={cx + pInner * Math.cos(pAngle)}
        y1={cy + pInner * Math.sin(pAngle)}
        x2={cx + pOuter * Math.cos(pAngle)}
        y2={cy + pOuter * Math.sin(pAngle)}
        stroke={`hsl(${dotHue}, 90%, 72%)`}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Knob wrapper ────────────────────────────────────────────────────────────
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
      <span style={{ fontSize: Math.max(6.5, size * 0.175), letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(225,165,182,0.88)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: Math.max(5.5, size * 0.145), color: 'rgba(205,152,168,0.68)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Tiny gain knob for header ─────────────────────────────────────────────────
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
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(205,152,168,0.58)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
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
  bg: '#100c0e', text: '#dfa0b5', textDim: 'rgba(210,148,168,0.55)',
  border: 'rgba(205,148,165,0.16)', hoverBg: 'rgba(205,148,165,0.10)', activeBg: 'rgba(205,148,165,0.07)',
};

// ─── Sci-fi LCD Time Readout ──────────────────────────────────────────────────
function LCDReadout({ value }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(14,9,11,0.88)',
      border: '1px solid rgba(210,148,168,0.22)',
      borderRadius: 3,
      padding: '3px 10px',
      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.5), 0 0 8px rgba(210,148,168,0.08)',
    }}>
      <span style={{
        fontSize: 13, fontWeight: 700, fontFamily: '"Courier New", monospace',
        color: 'rgba(232,172,188,0.92)',
        letterSpacing: '0.12em',
        textShadow: '0 0 8px rgba(215,150,170,0.55), 0 0 20px rgba(200,135,155,0.20)',
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
          background: 'rgba(210, 148, 165, 0.06)',
          border: '0.5px solid rgba(210, 148, 165, 0.13)',
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
  const [width,    setWidth]    = useState(initialState?.width    ?? 1.0);
  const [smooth,   setSmooth]   = useState(initialState?.smooth   ?? 0);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [fbLevel, setFbLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, time, feedback, degrade, motion, blur, tone, mix, width, smooth, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createEchoformEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setTime(s.time); eng.setFeedback(s.feedback); eng.setDegrade(s.degrade);
      eng.setMotion(s.motion); eng.setBlur(s.blur); eng.setTone(s.tone); eng.setMix(s.mix);
      eng.setWidth(s.width);
      eng.setSmooth(s.smooth);
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
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, time, feedback, degrade, motion, blur, tone, mix, width, smooth, bypassed, preset: activePreset });
  }, [inputGain, outputGain, time, feedback, degrade, motion, blur, tone, mix, width, smooth, bypassed, activePreset]);

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
      background: 'linear-gradient(170deg, #221820 0%, #1c1219 20%, #180f17 45%, #140d15 70%, #100b12 100%)',
      border: '1.5px solid rgba(210,148,168,0.22)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.88), 0 0 28px rgba(210,148,168,0.10), 0 0 55px rgba(200,130,155,0.05), inset 0 1px 0 rgba(225,165,180,0.08)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Dark vignette overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(3,2,8,0.5) 100%)',
        borderRadius: 5,
      }} />

      {/* Film sprocket borders */}
      <FilmBorder side="left" />
      <FilmBorder side="right" />

      {/* Header */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(210,148,168,0.10)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(210,140,160,0.02) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
            background: 'linear-gradient(135deg, #ff0040 0%, #ff8800 16%, #ffee00 32%, #00ff80 50%, #00c8ff 67%, #8040ff 83%, #ff00a0 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 10px rgba(200,100,255,0.45))',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>ECHOFORM</span>
          <span style={{
            fontSize: 6, fontWeight: 400, color: 'rgba(215,155,172,0.48)',
            letterSpacing: '0.3em', marginTop: 1.5,
            fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif',
          }}>infinite echo chamber</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Preset selector row */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(210,150,168,0.09)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(210,148,168,0.50)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* HERO: Infinite Tunnel canvas — fixed height preserves aspect ratio */}
      <div style={{ position: 'relative', zIndex: 2, height: 178, flexShrink: 0 }}>
        <InfiniteTunnel
          feedback={feedback} degrade={degrade} motion={motion}
          fbLevel={fbLevel} time={time} blur={blur} width={width}
          peak={peak} outPeak={outPeak}
        />
      </div>

      {/* LCD time readout */}
      <div style={{
        padding: '4px 0 3px', display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 2,
        borderBottom: '1px solid rgba(210,150,168,0.09)', flexShrink: 0,
      }}>
        <LCDReadout value={timeDisplay} />
      </div>

      {/* Knob row 1: TIME · FDBK · DEGRADE · MOTION */}
      <div style={{
        padding: '8px 18px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="TIME" value={time} defaultValue={0.4} size={42}
          format={v => { const ms = 50 + v * 1150; return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`; }}
          onChange={v => { setTime(v); engineRef.current?.setTime(v); setActivePreset(null); }} />
        <Knob label="FDBK" value={feedback} defaultValue={0.4} size={42} format={pctFmt}
          onChange={v => { setFeedback(v); engineRef.current?.setFeedback(v); setActivePreset(null); }} />
        <Knob label="DEGRADE" value={degrade} defaultValue={0.3} size={42} format={pctFmt}
          onChange={v => { setDegrade(v); engineRef.current?.setDegrade(v); setActivePreset(null); }} />
        <Knob label="MOTION" value={motion} defaultValue={0} size={42} format={pctFmt}
          onChange={v => { setMotion(v); engineRef.current?.setMotion(v); setActivePreset(null); }} />
      </div>

      {/* Knob row 2: BLUR · TONE · WIDTH · MIX */}
      <div style={{
        padding: '4px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(210,150,168,0.09)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="BLUR" value={blur} defaultValue={0} size={42} format={pctFmt}
          onChange={v => { setBlur(v); engineRef.current?.setBlur(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={42} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="WIDTH" value={width} min={0} max={2} defaultValue={1.0} size={42}
          format={v => v < 0.08 ? 'MONO' : v < 0.95 ? 'NARROW' : v < 1.05 ? 'STEREO' : v > 1.7 ? 'PING-PONG' : 'WIDE'}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.35} size={42} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer: smooth button + analog toggle bypass */}
      <div style={{ padding: '6px 18px 8px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 18, position: 'relative', zIndex: 2, flexShrink: 0, marginTop: 'auto' }}>
        {/* SMOOTH — same column structure as AnalogToggle */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <button
            onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
            style={{
              height: 28, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
              padding: '0 12px', borderRadius: 5, cursor: 'pointer',
              background: smooth > 0 ? 'rgba(210,148,168,0.14)' : 'rgba(14,9,11,0.88)',
              color: smooth > 0 ? 'rgba(230,170,185,0.95)' : 'rgba(175,130,145,0.45)',
              border: `1.5px solid ${smooth > 0 ? 'rgba(210,148,168,0.42)' : 'rgba(180,130,150,0.28)'}`,
              boxShadow: smooth > 0 ? '0 0 10px rgba(210,148,168,0.25), inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 3px 7px rgba(0,0,0,0.75)',
              fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
            }}
          >{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
          <span style={{
            fontSize: 7, letterSpacing: '0.20em', fontFamily: 'system-ui', fontWeight: 700,
            color: smooth > 0 ? 'rgba(230,170,185,0.72)' : 'rgba(175,130,145,0.42)',
            transition: 'color 0.25s',
          }}>{smooth > 0 ? `${smooth}X ON` : 'OFF'}</span>
        </div>
        <AnalogToggle
          active={!bypassed}
          onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
        />
      </div>
    </div>
  );
}
