import { useState, useEffect, useRef, useCallback } from 'react';
import { createDeHarshEngine } from './deharshEngine';
import PresetSelector from './PresetSelector';

// ─── DEHARSHPROVOCAL: Crystal Prism Light Refraction ──────────────────────
// Visual world: harsh red beams diffused into soft rainbow patterns
// Colors: warm amber to cool blue gradient

// ─── Crystal Prism Canvas ─────────────────────────────────────────────────
function CrystalPrism({ smooth, focusMode, airReturn, sibilance, harshLevel, sibLevel, peak }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ smooth: 0.4, focusMode: 1, airReturn: 0.35, sibilance: 0.4, harshLevel: 0, sibLevel: 0, peak: 0 });
  const phaseRef = useRef(0);
  const beamsRef = useRef([]);
  const particlesRef = useRef(
    Array.from({ length: 50 }, () => ({
      x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.003,
      vy: (Math.random() - 0.5) * 0.003, hue: Math.random() * 360,
      size: 1 + Math.random() * 3, alpha: 0.3 + Math.random() * 0.6,
      rotSpeed: (Math.random() - 0.5) * 0.04, angle: Math.random() * Math.PI * 2,
    }))
  );
  const causticsRef = useRef(
    Array.from({ length: 20 }, () => ({
      x: Math.random() * 260, y: Math.random() * 155,
      r: 8 + Math.random() * 25, phase: Math.random() * Math.PI * 2,
      hue: Math.random() * 360, speed: 0.005 + Math.random() * 0.015,
    }))
  );
  const diamondRotRef = useRef(0);

  useEffect(() => { valRef.current = { smooth, focusMode, airReturn, sibilance, harshLevel, sibLevel, peak }; },
    [smooth, focusMode, airReturn, sibilance, harshLevel, sibLevel, peak]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      phaseRef.current += 0.014;
      const t = phaseRef.current;
      const v = valRef.current;

      // ── Deep indigo background ──
      var bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
      bg.addColorStop(0, 'rgba(15, 5, 35, 0.93)');
      bg.addColorStop(0.5, 'rgba(8, 2, 25, 0.96)');
      bg.addColorStop(1, 'rgba(3, 1, 12, 1)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      var cx = W / 2;
      var cy = H / 2;
      var harshNorm = Math.min(1, v.harshLevel * 5);
      var sibNorm = Math.min(1, v.sibLevel * 8);
      var peakBright = Math.min(1, v.peak * 2.5);

      // ── Caustic light patterns (like light through water) ──
      var caustics = causticsRef.current;
      for (var ci = 0; ci < caustics.length; ci++) {
        var c = caustics[ci];
        c.phase += c.speed;
        c.hue += 0.3;
        var cx2 = c.x + Math.sin(c.phase * 1.3) * 15;
        var cy2 = c.y + Math.cos(c.phase * 0.9) * 10;
        var cAlpha = (0.04 + peakBright * 0.06 + v.smooth * 0.04) * (0.5 + 0.5 * Math.sin(c.phase * 2));
        var cGrad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, c.r);
        cGrad.addColorStop(0, 'hsla(' + (c.hue % 360) + ', 80%, 70%, ' + cAlpha + ')');
        cGrad.addColorStop(0.5, 'hsla(' + ((c.hue + 60) % 360) + ', 70%, 60%, ' + (cAlpha * 0.4) + ')');
        cGrad.addColorStop(1, 'hsla(' + ((c.hue + 120) % 360) + ', 60%, 50%, 0)');
        ctx.fillStyle = cGrad;
        ctx.fillRect(cx2 - c.r, cy2 - c.r, c.r * 2, c.r * 2);
      }

      // ── Incoming harsh light beams (bright white-red from left) ──
      var beamCount = 7;
      for (var b = 0; b < beamCount; b++) {
        var by = cy - 35 + b * 10;
        var beamWidth = 2 + harshNorm * 3 + peakBright * 1.5;
        var beamAlpha = (0.3 + harshNorm * 0.5 + peakBright * 0.2) * (1 - v.smooth * 0.4);
        ctx.beginPath();
        ctx.moveTo(-5, by + Math.sin(t * 0.7 + b) * 3);
        ctx.lineTo(cx - 18, cy + (b - beamCount / 2) * 2 + Math.sin(t * 0.4 + b * 0.7) * 2);
        var beamGrad = ctx.createLinearGradient(0, by, cx - 18, cy);
        beamGrad.addColorStop(0, 'rgba(255, 255, 255, ' + (beamAlpha * 0.2) + ')');
        beamGrad.addColorStop(0.3, 'rgba(255, 120, 60, ' + (beamAlpha * 0.6) + ')');
        beamGrad.addColorStop(0.7, 'rgba(255, 80, 40, ' + beamAlpha + ')');
        beamGrad.addColorStop(1, 'rgba(255, 200, 150, ' + (beamAlpha * 0.8) + ')');
        ctx.strokeStyle = beamGrad;
        ctx.lineWidth = beamWidth;
        ctx.stroke();
        // Glow
        ctx.lineWidth = beamWidth * 3;
        ctx.globalAlpha = 0.08;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ── Large spinning diamond/prism at center ──
      diamondRotRef.current += 0.008 + v.peak * 0.02;
      var dRot = diamondRotRef.current;
      var dSize = 32 + v.smooth * 10 + peakBright * 8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(dRot);

      // Diamond shape (octagonal for crystal facets)
      var facets = 8;
      ctx.beginPath();
      for (var fi = 0; fi <= facets; fi++) {
        var fAngle = (fi / facets) * Math.PI * 2;
        var fR = dSize * (fi % 2 === 0 ? 1 : 0.7);
        var fx = Math.cos(fAngle) * fR;
        var fy = Math.sin(fAngle) * fR;
        if (fi === 0) ctx.moveTo(fx, fy);
        else ctx.lineTo(fx, fy);
      }
      ctx.closePath();

      // Crystal fill with rainbow gradient
      var crystalGrad = ctx.createLinearGradient(-dSize, -dSize, dSize, dSize);
      crystalGrad.addColorStop(0, 'rgba(255, 100, 100, ' + (0.15 + v.smooth * 0.1) + ')');
      crystalGrad.addColorStop(0.2, 'rgba(255, 200, 50, ' + (0.12 + v.smooth * 0.08) + ')');
      crystalGrad.addColorStop(0.4, 'rgba(50, 255, 100, ' + (0.12 + v.smooth * 0.08) + ')');
      crystalGrad.addColorStop(0.6, 'rgba(50, 150, 255, ' + (0.15 + v.smooth * 0.1) + ')');
      crystalGrad.addColorStop(0.8, 'rgba(180, 50, 255, ' + (0.12 + v.smooth * 0.08) + ')');
      crystalGrad.addColorStop(1, 'rgba(255, 50, 200, ' + (0.1 + v.smooth * 0.06) + ')');
      ctx.fillStyle = crystalGrad;
      ctx.fill();

      // Crystal edges -- bright white
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.5 + v.smooth * 0.3 + peakBright * 0.2) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Internal facet lines
      for (var fl = 0; fl < facets; fl++) {
        var flAngle = (fl / facets) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(flAngle) * dSize, Math.sin(flAngle) * dSize);
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.08 + peakBright * 0.1) + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Crystal inner glow
      var innerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, dSize * 0.8);
      innerGlow.addColorStop(0, 'rgba(255, 255, 255, ' + (0.15 + peakBright * 0.2 + v.smooth * 0.1) + ')');
      innerGlow.addColorStop(0.5, 'rgba(200, 150, 255, ' + (0.05 + peakBright * 0.08) + ')');
      innerGlow.addColorStop(1, 'rgba(100, 50, 200, 0)');
      ctx.fillStyle = innerGlow;
      ctx.fillRect(-dSize, -dSize, dSize * 2, dSize * 2);

      ctx.restore();

      // ── Full rainbow light rays scattering outward from prism ──
      var rayCount = 14;
      var spreadFactor = 0.4 + v.smooth * 0.8;
      for (var ri = 0; ri < rayCount; ri++) {
        var rayHue = (ri / rayCount) * 360;
        var rayAngle = (ri / rayCount) * Math.PI * 2 * spreadFactor + Math.PI * 0.3;
        // Focus mode shifts the ray spread pattern
        rayAngle += v.focusMode * 0.15;
        var rayLen = 60 + v.smooth * 40 + peakBright * 30;
        var rayStartR = dSize * 0.5;
        var rsx = cx + Math.cos(rayAngle + dRot * 0.3) * rayStartR;
        var rsy = cy + Math.sin(rayAngle + dRot * 0.3) * rayStartR;
        var rex = cx + Math.cos(rayAngle + dRot * 0.3) * (rayStartR + rayLen);
        var rey = cy + Math.sin(rayAngle + dRot * 0.3) * (rayStartR + rayLen);

        var diffuseAlpha = 0.25 + v.smooth * 0.3 + peakBright * 0.2;
        // When smoothing is high, rays become softer (wider, lower alpha)
        var rayWidth = v.smooth > 0.5 ? (3 + v.smooth * 5) : (2 + v.smooth * 2);
        if (v.smooth > 0.5) diffuseAlpha *= 0.7;

        var rayGrad = ctx.createLinearGradient(rsx, rsy, rex, rey);
        rayGrad.addColorStop(0, 'hsla(' + rayHue + ', 100%, 75%, ' + diffuseAlpha + ')');
        rayGrad.addColorStop(0.5, 'hsla(' + rayHue + ', 90%, 65%, ' + (diffuseAlpha * 0.6) + ')');
        rayGrad.addColorStop(1, 'hsla(' + rayHue + ', 80%, 55%, 0)');

        ctx.beginPath();
        ctx.moveTo(rsx, rsy);
        // Slight wave in the ray
        var rcpx = (rsx + rex) / 2 + Math.sin(t * 2 + ri) * 8 * v.smooth;
        var rcpy = (rsy + rey) / 2 + Math.cos(t * 1.5 + ri) * 6 * v.smooth;
        ctx.quadraticCurveTo(rcpx, rcpy, rex, rey);
        ctx.strokeStyle = rayGrad;
        ctx.lineWidth = rayWidth;
        ctx.stroke();

        // Broader glow
        ctx.lineWidth = rayWidth * 3;
        ctx.globalAlpha = 0.1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ── Glass shard particles floating and catching light ──
      var particles = particlesRef.current;
      for (var pi = 0; pi < particles.length; pi++) {
        var p = particles[pi];
        p.x += p.vx + Math.sin(t * 0.5 + pi) * 0.001;
        p.y += p.vy + Math.cos(t * 0.4 + pi) * 0.0008;
        p.angle += p.rotSpeed;
        if (p.x < -0.05 || p.x > 1.05) p.vx *= -1;
        if (p.y < -0.05 || p.y > 1.05) p.vy *= -1;
        p.hue += 0.5;

        var px = p.x * W;
        var py = p.y * H;
        var pAlpha = p.alpha * (0.3 + v.airReturn * 0.5 + peakBright * 0.3);
        var pSize = p.size * (1 + peakBright * 0.8);

        // Draw as diamond shard
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.moveTo(0, -pSize);
        ctx.lineTo(pSize * 0.5, 0);
        ctx.lineTo(0, pSize);
        ctx.lineTo(-pSize * 0.5, 0);
        ctx.closePath();
        ctx.fillStyle = 'hsla(' + (p.hue % 360) + ', 90%, 75%, ' + pAlpha + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (pAlpha * 0.6) + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();

        // Particle glow
        var pGlow = ctx.createRadialGradient(px, py, 0, px, py, pSize * 4);
        pGlow.addColorStop(0, 'hsla(' + (p.hue % 360) + ', 80%, 70%, ' + (pAlpha * 0.2) + ')');
        pGlow.addColorStop(1, 'hsla(' + (p.hue % 360) + ', 60%, 50%, 0)');
        ctx.fillStyle = pGlow;
        ctx.fillRect(px - pSize * 4, py - pSize * 4, pSize * 8, pSize * 8);
      }

      // ── Sibilance sparks (bright white/yellow star bursts) ──
      if (sibNorm > 0.03) {
        for (var si = 0; si < 10; si++) {
          var sx = Math.random() * W;
          var sy = Math.random() * H;
          var sparkSize = 2 + sibNorm * 5 + peakBright * 3;
          var sparkAlpha = sibNorm * 0.6 * (1 - v.sibilance * 0.4);
          // 4-point star
          ctx.beginPath();
          ctx.moveTo(sx, sy - sparkSize);
          ctx.lineTo(sx + sparkSize * 0.2, sy);
          ctx.lineTo(sx, sy + sparkSize);
          ctx.lineTo(sx - sparkSize * 0.2, sy);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 200, ' + sparkAlpha + ')';
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(sx - sparkSize, sy);
          ctx.lineTo(sx, sy + sparkSize * 0.2);
          ctx.lineTo(sx + sparkSize, sy);
          ctx.lineTo(sx, sy - sparkSize * 0.2);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 200, ' + sparkAlpha + ')';
          ctx.fill();
        }
      }

      // ── Prism outer glow bloom ──
      var outerGlow = ctx.createRadialGradient(cx, cy, dSize * 0.3, cx, cy, dSize * 2);
      outerGlow.addColorStop(0, 'rgba(200, 150, 255, ' + (0.08 + peakBright * 0.12) + ')');
      outerGlow.addColorStop(0.5, 'rgba(150, 100, 255, ' + (0.03 + peakBright * 0.05) + ')');
      outerGlow.addColorStop(1, 'rgba(100, 50, 200, 0)');
      ctx.fillStyle = outerGlow;
      ctx.fillRect(0, 0, W, H);

      // ── Mode indicator text (bright) ──
      var modeNames = ['LOW BITE', 'PRES EDGE', 'SIZZLE', 'BROAD'];
      ctx.font = '700 7px system-ui';
      ctx.fillStyle = 'rgba(255, 180, 100, 0.7)';
      ctx.textAlign = 'left';
      ctx.fillText(modeNames[Math.round(v.focusMode)] || 'PRES EDGE', 8, 14);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(180, 140, 255, 0.7)';
      ctx.fillText('SMOOTH ' + Math.round(v.smooth * 100) + '%', W - 8, 14);

      // ── Spectral rainbow bar at bottom (full-width, bright) ──
      var barY2 = H - 6;
      var barW2 = W - 16;
      for (var bi2 = 0; bi2 < barW2; bi2++) {
        var freq = (bi2 / barW2);
        var hue2 = freq * 360;
        var harshBoost = freq > 0.3 && freq < 0.7 ? harshNorm * 0.4 : 0;
        var smoothDip = freq > 0.3 && freq < 0.7 ? v.smooth * 0.25 : 0;
        var bH = 5 * (0.4 + peakBright * 0.6 + harshBoost - smoothDip + Math.sin(t * 0.8 + bi2 * 0.15) * 0.1);
        ctx.fillStyle = 'hsla(' + hue2 + ', 100%, 65%, ' + (0.5 + peakBright * 0.3) + ')';
        ctx.fillRect(8 + bi2, barY2 - bH, 1, bH);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 160, display: 'block', borderRadius: 6 }} />;
}

// ─── Octagon Crystal Knob ─────────────────────────────────────────────────
function PrismKnobVisual({ size = 38, norm = 0 }) {
  const s = size;
  const cx = s / 2, cy = s / 2;
  // Build octagon points
  const numSides = 8;
  const outerR = s * 0.46;
  const octPts = Array.from({ length: numSides }, (_, i) => {
    const a = (i / numSides) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR];
  });
  const octStr = octPts.map(([x, y]) => `${x},${y}`).join(' ');

  // Active facet index based on norm (0–7)
  const activeFacet = Math.min(7, Math.floor(norm * 8));
  // Active hue
  const activeHue = norm * 280;

  // Each facet: triangle from center to edge midpoint (between vertex i and i+1)
  const facets = Array.from({ length: numSides }, (_, i) => {
    const [x0, y0] = octPts[i];
    const [x1, y1] = octPts[(i + 1) % numSides];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const dist = Math.abs(i - activeFacet);
    const wrap = Math.min(dist, numSides - dist);
    // Brightness falloff: 0=full, 1=half, 2+=dim
    const brightness = wrap === 0 ? 1 : wrap === 1 ? 0.45 : 0.08;
    const hue = Math.round(activeHue) % 360;
    const alpha = brightness;
    return { pts: `${cx},${cy} ${x0},${y0} ${mx},${my} ${x1},${y1}`, hue, alpha, active: wrap === 0 };
  });

  return (
    <svg width={s} height={s} style={{ display: 'block', pointerEvents: 'none' }}>
      {/* Dark background octagon */}
      <polygon points={octStr} fill="rgba(10,6,18,0.85)" stroke="rgba(180,100,255,0.15)" strokeWidth="0.5" />
      {/* Facet triangles */}
      {facets.map(({ pts, hue, alpha, active }, i) => (
        <polygon key={i} points={pts}
          fill={`hsla(${hue},85%,65%,${alpha})`}
          stroke={active ? `hsla(${hue},100%,80%,0.6)` : 'rgba(255,255,255,0.04)'}
          strokeWidth={active ? '0.8' : '0.3'} />
      ))}
      {/* Octagon border on top */}
      <polygon points={octStr} fill="none"
        stroke={`hsla(${Math.round(activeHue % 360)},80%,70%,0.5)`} strokeWidth="1" />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="2" fill={`hsla(${Math.round(activeHue % 360)},100%,85%,0.8)`} />
    </svg>
  );
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const s = { x: cx + Math.cos(startAngle) * r, y: cy + Math.sin(startAngle) * r };
  const e = { x: cx + Math.cos(endAngle) * r, y: cy + Math.sin(endAngle) * r };
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${endAngle - startAngle > Math.PI ? 1 : 0} 1 ${e.x} ${e.y}`;
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 38, format, sensitivity = 160 }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <PrismKnobVisual size={size} norm={norm} dragging={dragging} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'rgba(200, 160, 120, 0.6)', fontWeight: 600, textAlign: 'center',
        width: '100%', lineHeight: 1.2, fontFamily: 'system-ui',
        textShadow: '0 0 8px rgba(200, 140, 80, 0.1)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(180, 140, 100, 0.35)',
        fontFamily: '"Courier New",monospace', fontWeight: 600, textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

// ─── Focus Mode Selector (segmented button) ──────────────────────────────
function FocusModeSelector({ value, onChange }) {
  const modes = ['LOW BITE', 'PRES EDGE', 'SIZZLE', 'BROAD'];
  return (
    <div style={{
      display: 'flex', gap: 1, padding: '0 8px', position: 'relative', zIndex: 2,
    }}>
      {modes.map((name, i) => (
        <button key={i} onClick={() => onChange(i)} style={{
          flex: 1, fontSize: 5.5, fontWeight: 700, fontFamily: 'system-ui',
          letterSpacing: '0.08em', padding: '4px 2px', cursor: 'pointer',
          background: i === value ? 'rgba(200, 140, 80, 0.12)' : 'rgba(15, 10, 8, 0.5)',
          color: i === value ? 'rgba(220, 170, 110, 0.8)' : 'rgba(160, 120, 80, 0.3)',
          border: `1px solid ${i === value ? 'rgba(200, 140, 80, 0.2)' : 'rgba(120, 80, 50, 0.08)'}`,
          borderRadius: 2, transition: 'all 0.15s',
        }}>{name}</button>
      ))}
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
          background: 'rgba(12, 8, 6, 0.8)',
          border: '0.5px solid rgba(160, 110, 60, 0.1)',
        }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`,
          background: 'linear-gradient(to top, rgba(180, 120, 60, 0.15), rgba(120, 140, 180, 0.08))',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 3,
          background: 'rgba(200, 150, 80, 0.5)', bottom: `calc(${norm * 100}% - 2px)`,
          boxShadow: '0 0 6px rgba(200, 140, 70, 0.25)',
        }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(180, 140, 100, 0.3)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(160, 120, 80, 0.25)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
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
      background: 'rgba(10, 6, 4, 0.8)', padding: '3px 2px', borderRadius: 3,
      border: '0.5px solid rgba(160, 110, 60, 0.06)', position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 1, background: 'rgba(160, 110, 60, 0.04)' }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{
    fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700,
    color: 'rgba(180, 140, 100, 0.3)', letterSpacing: '0.05em',
    width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2,
  }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    segmentEls[i].style.background = dB > threshDb
      ? (i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#d0a060' : 'rgba(180, 130, 70, 0.5)')
      : 'rgba(160, 110, 60, 0.04)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#d0a060' : 'rgba(180, 140, 100, 0.3)';
    dbEl.firstChild.textContent = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',                smooth: 0.40, focusMode: 1, airReturn: 0.35, sibilance: 0.40, mix: 1,   outputDb: 0 },
  { name: 'BRIGHT POP VOCAL',    smooth: 0.55, focusMode: 2, airReturn: 0.50, sibilance: 0.50, mix: 1,   outputDb: 0 },
  { name: 'RAP PRESENCE TAME',   smooth: 0.50, focusMode: 1, airReturn: 0.30, sibilance: 0.35, mix: 1,   outputDb: 0 },
  { name: 'AGG FEMALE SOOTHE',   smooth: 0.65, focusMode: 2, airReturn: 0.45, sibilance: 0.60, mix: 0.9, outputDb: 0 },
  { name: 'SIBILANT NARRATION',  smooth: 0.35, focusMode: 1, airReturn: 0.25, sibilance: 0.75, mix: 1,   outputDb: 0 },
  { name: 'VOCAL AIR SMOOTH',    smooth: 0.45, focusMode: 3, airReturn: 0.60, sibilance: 0.30, mix: 0.8, outputDb: 1 },
];

const PRESET_COLORS = {
  bg: '#0f0a08', text: 'rgba(210,160,100,0.75)', textDim: 'rgba(180,130,80,0.4)',
  border: 'rgba(160,110,60,0.1)', hoverBg: 'rgba(160,110,60,0.06)', activeBg: 'rgba(160,110,60,0.05)',
};

// ─── CSS ──────────────────────────────────────────────────────────────────
const STYLE_ID = 'deharsh-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes prismGlow {
      0%, 100% { box-shadow: 0 0 8px rgba(200,140,80,0.12); }
      50% { box-shadow: 0 0 14px rgba(200,140,80,0.25); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main DeHarsh Orb ────────────────────────────────────────────────────
export default function DeHarshOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [smooth,     setSmooth]     = useState(initialState?.smooth     ?? 0.40);
  const [focusMode,  setFocusMode]  = useState(initialState?.focusMode  ?? 1);
  const [airReturn,  setAirReturn]  = useState(initialState?.airReturn  ?? 0.35);
  const [sibilance,  setSibilance]  = useState(initialState?.sibilance  ?? 0.40);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1);
  const [outputDb,   setOutputDb]   = useState(initialState?.outputDb   ?? 0);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [harshLevel, setHarshLevel] = useState(0);
  const [sibLevel,   setSibLevel]   = useState(0);
  const [peak,       setPeak]       = useState(0);

  const inMeterRef = useRef(null), outMeterRef = useRef(null);
  const inDbRef = useRef(null), outDbRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, smooth, focusMode, airReturn, sibilance, mix, outputDb, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createDeHarshEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSmooth(s.smooth); eng.setFocusMode(s.focusMode); eng.setAirReturn(s.airReturn);
      eng.setSibilance(s.sibilance); eng.setMix(s.mix); eng.setOutputDb(s.outputDb);
      eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setHarshLevel(engineRef.current.getHarshLevel());
        setSibLevel(engineRef.current.getSibLevel());
        setPeak(engineRef.current.getInputPeak());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, smooth, focusMode, airReturn, sibilance, mix, outputDb, bypassed, preset: activePreset });
  }, [inputGain, outputGain, smooth, focusMode, airReturn, sibilance, mix, outputDb, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setSmooth(p.smooth); setFocusMode(p.focusMode); setAirReturn(p.airReturn);
    setSibilance(p.sibilance); setMix(p.mix); setOutputDb(p.outputDb); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setSmooth(p.smooth); e.setFocusMode(p.focusMode); e.setAirReturn(p.airReturn); e.setSibilance(p.sibilance); e.setMix(p.mix); e.setOutputDb(p.outputDb); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outDbFmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`;

  return (
    <div style={{
      width: 380, borderRadius: 8, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #120a06 0%, #0e0810 25%, #0a060f 50%, #08050a 75%, #0c0810 100%)',
      border: '1.5px solid rgba(180,120,60,0.12)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 30px rgba(180,120,60,0.05), inset 0 1px 0 rgba(220,160,80,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(180,120,60,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(180,120,60,0.03) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
            background: 'linear-gradient(135deg, #e0a060 0%, #c08040 30%, #80a0d0 70%, #60a0e0 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(200,140,80,0.2))',
          }}>DEHARSH</span>
          <span style={{
            fontSize: 6, fontWeight: 600, color: 'rgba(180,130,80,0.3)',
            letterSpacing: '0.35em', marginTop: 3, textTransform: 'uppercase',
          }}>crystal prism</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(180,130,80,0.3)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 3, transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
          >×</span>}
        </div>
      </div>

      {/* Crystal Prism (Hero) */}
      <div style={{ borderBottom: '1px solid rgba(180,120,60,0.05)', position: 'relative', zIndex: 2 }}>
        <CrystalPrism smooth={smooth} focusMode={focusMode} airReturn={airReturn} sibilance={sibilance} harshLevel={harshLevel} sibLevel={sibLevel} peak={peak} />
      </div>

      {/* Focus Mode Selector */}
      <div style={{ padding: '5px 0', borderBottom: '1px solid rgba(180,120,60,0.05)' }}>
        <FocusModeSelector value={focusMode} onChange={v => { setFocusMode(v); engineRef.current?.setFocusMode(v); setActivePreset(null); }} />
      </div>

      {/* Meters + gain sliders */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(180,120,60,0.05)', position: 'relative', zIndex: 2,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs row 1: SMOOTH, SIBILANCE, AIR RETURN */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(180,120,60,0.05)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="SMOOTH" value={smooth} defaultValue={0.40} size={28} format={pctFmt} onChange={v => { setSmooth(v); engineRef.current?.setSmooth(v); setActivePreset(null); }} />
        <Knob label="SIBILANCE" value={sibilance} defaultValue={0.40} size={28} format={pctFmt} onChange={v => { setSibilance(v); engineRef.current?.setSibilance(v); setActivePreset(null); }} />
        <Knob label="AIR" value={airReturn} defaultValue={0.35} size={28} format={pctFmt} onChange={v => { setAirReturn(v); engineRef.current?.setAirReturn(v); setActivePreset(null); }} />
      </div>

      {/* Knobs row 2: MIX, OUTPUT */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(180,120,60,0.05)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="MIX" value={mix} defaultValue={1} size={28} format={pctFmt} onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
        <Knob label="OUTPUT" value={outputDb} min={-18} max={18} defaultValue={0} size={28} format={outDbFmt} sensitivity={120} onChange={v => { setOutputDb(v); engineRef.current?.setOutputDb(v); setActivePreset(null); }} />
      </div>

      {/* Bypass */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', position: 'relative', zIndex: 2,
      }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
          background: bypassed ? 'rgba(15, 10, 8, 0.5)' : 'rgba(20, 14, 10, 0.7)',
          border: `1.5px solid ${bypassed ? 'rgba(160, 100, 50, 0.12)' : 'rgba(200, 140, 80, 0.35)'}`,
          boxShadow: bypassed ? 'none' : '0 0 12px rgba(200, 140, 80, 0.15)',
          animation: bypassed ? 'none' : 'prismGlow 3s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'border-color 0.3s, box-shadow 0.3s',
        }}>
          {/* Prism icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ opacity: bypassed ? 0.2 : 0.6 }}>
            <polygon points="6,1 1,11 11,11" fill="none" stroke="rgba(200,150,80,0.6)" strokeWidth="1" />
          </svg>
        </button>
        <span style={{
          fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
          color: bypassed ? 'rgba(160, 100, 50, 0.25)' : 'rgba(200, 140, 80, 0.45)',
          marginLeft: 6, textTransform: 'uppercase', fontFamily: 'system-ui',
        }}>{bypassed ? 'BYPASS' : 'ACTIVE'}</span>
      </div>
    </div>
  );
}
