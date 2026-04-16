import { useState, useEffect, useRef, useCallback } from 'react';
import { createOrbitEngine } from './orbitEngine';
import PresetSelector from './PresetSelector';

// ─── ORBIT: Spatial Movement Reverb ──────────────────────────────────────────
// Visual: PLANETARY ORBIT / SOLAR SYSTEM
// Deep space black, electric blue/cyan/white orbiting bodies + trails
// Path visualization matches selected orbit pattern

const PATH_NAMES = ['CIRCLE', 'FIG-8', 'DRIFT', 'SPIRAL'];

// ─── Orbit Canvas ────────────────────────────────────────────────────────────
function OrbitCanvas({ speed, path, width, depth, peak = 0, outPeak = 0, orbX = 0, orbY = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const trailsRef = useRef([]);
  const starsRef = useRef(null);
  const valRef = useRef({ speed: 0, path: 0, width: 0, depth: 0, peak: 0, outPeak: 0, orbX: 0, orbY: 0 });

  valRef.current = { speed, path, width, depth, peak, outPeak, orbX, orbY };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 340, H = 180;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Background stars
    if (!starsRef.current) {
      var stars = [];
      for (var si = 0; si < 160; si++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          size: 0.3 + Math.random() * 1.8,
          brightness: 0.3 + Math.random() * 0.7,
          twinkleRate: 0.5 + Math.random() * 3,
          colorR: 180 + Math.floor(Math.random() * 75),
          colorG: 180 + Math.floor(Math.random() * 75),
          colorB: 220 + Math.floor(Math.random() * 35),
        });
      }
      starsRef.current = stars;
    }

    // Shooting star state
    var shootingStar = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, trail: [] };
    var shootTimer = 0;

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const { speed: _speed, path: _path, width: _width, depth: _depth, peak: _peak, outPeak: _outPeak, orbX: _orbX, orbY: _orbY } = valRef.current;

      phaseRef.current += 0.008 + _speed * 0.018;
      var phase = phaseRef.current;
      var cx = W / 2, cy = H / 2;

      // Fade for trail persistence (long-exposure look)
      ctx.fillStyle = 'rgba(2, 3, 15, 0.08)';
      ctx.fillRect(0, 0, W, H);

      // Deep space base with nebula tones
      ctx.fillStyle = 'rgba(2, 3, 15, 0.92)';
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      // === Nebula clouds in background ===
      var nebPhase = phase * 0.15;
      // Purple nebula cloud
      var neb1x = W * 0.25 + Math.sin(nebPhase) * 30;
      var neb1y = H * 0.35 + Math.cos(nebPhase * 0.7) * 20;
      var neb1r = 60 + Math.sin(nebPhase * 0.5) * 15;
      var nebGrad1 = ctx.createRadialGradient(neb1x, neb1y, 0, neb1x, neb1y, neb1r);
      nebGrad1.addColorStop(0, 'rgba(100, 40, 180, 0.06)');
      nebGrad1.addColorStop(0.5, 'rgba(60, 20, 140, 0.03)');
      nebGrad1.addColorStop(1, 'rgba(30, 10, 80, 0)');
      ctx.fillStyle = nebGrad1;
      ctx.fillRect(0, 0, W, H);

      // Blue nebula cloud
      var neb2x = W * 0.75 + Math.cos(nebPhase * 0.8) * 25;
      var neb2y = H * 0.6 + Math.sin(nebPhase * 0.6) * 18;
      var neb2r = 55 + Math.cos(nebPhase * 0.4) * 12;
      var nebGrad2 = ctx.createRadialGradient(neb2x, neb2y, 0, neb2x, neb2y, neb2r);
      nebGrad2.addColorStop(0, 'rgba(20, 60, 180, 0.06)');
      nebGrad2.addColorStop(0.5, 'rgba(10, 40, 120, 0.03)');
      nebGrad2.addColorStop(1, 'rgba(5, 20, 60, 0)');
      ctx.fillStyle = nebGrad2;
      ctx.fillRect(0, 0, W, H);

      // Teal nebula wisps
      var neb3x = W * 0.5 + Math.sin(nebPhase * 1.2) * 40;
      var neb3y = H * 0.2 + Math.cos(nebPhase * 0.9) * 15;
      var nebGrad3 = ctx.createRadialGradient(neb3x, neb3y, 0, neb3x, neb3y, 45);
      nebGrad3.addColorStop(0, 'rgba(0, 180, 160, 0.04)');
      nebGrad3.addColorStop(1, 'rgba(0, 80, 100, 0)');
      ctx.fillStyle = nebGrad3;
      ctx.fillRect(0, 0, W, H);

      // Background stars with twinkle — colorful
      var starArr = starsRef.current;
      for (var si2 = 0; si2 < starArr.length; si2++) {
        var s = starArr[si2];
        var twinkle = 0.4 + Math.sin(phase * s.twinkleRate + si2 * 1.7) * 0.6;
        var alpha = s.brightness * twinkle;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * (0.7 + twinkle * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + s.colorR + ',' + s.colorG + ',' + s.colorB + ',' + alpha.toFixed(3) + ')';
        ctx.fill();
        // Bright stars get cross-spike
        if (s.size > 1.3 && alpha > 0.5) {
          ctx.strokeStyle = 'rgba(' + s.colorR + ',' + s.colorG + ',' + s.colorB + ',' + (alpha * 0.3).toFixed(3) + ')';
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(s.x - s.size * 2, s.y);
          ctx.lineTo(s.x + s.size * 2, s.y);
          ctx.moveTo(s.x, s.y - s.size * 2);
          ctx.lineTo(s.x, s.y + s.size * 2);
          ctx.stroke();
        }
      }

      // === Central star (sun) — bright white-yellow, pulses with audio ===
      var peakVal = _peak || 0;
      var centralGlow = 14 + peakVal * 25 + _depth * 8;
      var centralGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, centralGlow);
      centralGrad.addColorStop(0, 'rgba(255, 255, 240, ' + (0.95 + peakVal * 0.05).toFixed(3) + ')');
      centralGrad.addColorStop(0.15, 'rgba(255, 240, 180, ' + (0.7 + peakVal * 0.2).toFixed(3) + ')');
      centralGrad.addColorStop(0.4, 'rgba(255, 180, 60, ' + (0.3 + peakVal * 0.2).toFixed(3) + ')');
      centralGrad.addColorStop(0.7, 'rgba(200, 100, 30, 0.1)');
      centralGrad.addColorStop(1, 'rgba(100, 40, 10, 0)');
      ctx.fillStyle = centralGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, centralGlow, 0, Math.PI * 2);
      ctx.fill();

      // Star cross-flare spikes
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(phase * 0.05);
      var spikeLen = 10 + peakVal * 20 + _depth * 6;
      for (var sp = 0; sp < 4; sp++) {
        var spAngle = (sp / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(spAngle) * spikeLen, Math.sin(spAngle) * spikeLen);
        ctx.strokeStyle = 'rgba(255, 240, 200, ' + (0.2 + peakVal * 0.3).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();

      // Solid white-hot core
      ctx.beginPath();
      ctx.arc(cx, cy, 4 + peakVal * 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fill();

      // === Orbit path guides (visible glowing rings) ===
      var orbitRx = 40 + _width * 90;
      var orbitRy = 25 + _width * 55;
      var pathMode = Math.round(_path);

      // Draw multiple orbit rings for each planet
      var planetCount = 6;
      var bodyColors = [
        { r: 255, g: 80, b: 80 },   // Mars red
        { r: 80, g: 160, b: 255 },  // Neptune blue
        { r: 80, g: 220, b: 100 },  // green
        { r: 255, g: 210, b: 60 },  // Saturn gold
        { r: 180, g: 80, b: 255 },  // purple
        { r: 255, g: 140, b: 60 },  // orange
      ];
      var planetSizes = [5, 4, 3.5, 6, 3, 4.5];
      var orbitScales = [0.35, 0.5, 0.65, 0.8, 0.92, 1.08];

      for (var b = 0; b < planetCount; b++) {
        var orbScale = orbitScales[b];
        var bRx = orbitRx * orbScale;
        var bRy = orbitRy * orbScale;

        // Draw visible orbit path (glowing)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(' + bodyColors[b].r + ',' + bodyColors[b].g + ',' + bodyColors[b].b + ',0.12)';
        ctx.lineWidth = 1;
        for (var oi = 0; oi <= 120; oi++) {
          var ot = (oi / 120) * Math.PI * 2;
          var opx, opy;
          if (pathMode === 0) {
            opx = cx + Math.cos(ot) * bRx;
            opy = cy + Math.sin(ot) * bRy;
          } else if (pathMode === 1) {
            opx = cx + Math.sin(ot) * bRx;
            opy = cy + Math.sin(ot * 2) * bRy;
          } else if (pathMode === 2) {
            opx = cx + Math.cos(ot + Math.sin(ot * 0.3) * 0.5) * bRx * (0.6 + Math.sin(ot * 0.5) * 0.3);
            opy = cy + Math.sin(ot + Math.cos(ot * 0.4) * 0.5) * bRy * (0.6 + Math.cos(ot * 0.5) * 0.3);
          } else {
            var spr = 0.5 + ot / (Math.PI * 2) * 0.5;
            opx = cx + Math.cos(ot) * bRx * spr;
            opy = cy + Math.sin(ot) * bRy * spr;
          }
          if (oi === 0) ctx.moveTo(opx, opy); else ctx.lineTo(opx, opy);
        }
        if (pathMode === 0) ctx.closePath();
        ctx.stroke();

        // Planet position
        var speedMul = 1.3 - b * 0.15;
        var bPhase = phase * (0.4 + _speed * 2.0) * speedMul + (b / planetCount) * Math.PI * 2;
        var bx, by;

        if (pathMode === 0) {
          bx = cx + Math.cos(bPhase) * bRx;
          by = cy + Math.sin(bPhase) * bRy;
        } else if (pathMode === 1) {
          bx = cx + Math.sin(bPhase) * bRx;
          by = cy + Math.sin(bPhase * 2) * bRy;
        } else if (pathMode === 2) {
          var drift = Math.sin(phase * 0.12 + b * 2.5) * 0.5;
          bx = cx + Math.cos(bPhase + drift) * bRx * (0.5 + Math.sin(phase * 0.08 + b) * 0.35);
          by = cy + Math.sin(bPhase + drift) * bRy * (0.5 + Math.cos(phase * 0.06 + b) * 0.35);
        } else {
          var spirR = 0.5 + Math.sin(bPhase * 0.25) * 0.45;
          bx = cx + Math.cos(bPhase) * bRx * spirR;
          by = cy + Math.sin(bPhase) * bRy * spirR;
        }

        // 3D depth effect: planet size changes as it orbits (near=bigger, far=smaller)
        var depthFactor = 1 + _depth * 0.6 * Math.sin(bPhase);
        var pSize = planetSizes[b] * depthFactor;

        // Add to trails for long-exposure glow
        var trails = trailsRef.current;
        trails.push({ x: bx, y: by, color: bodyColors[b], age: 0, body: b, size: pSize * 0.5 });
        if (trails.length > 500) trails.splice(0, trails.length - 500);

        // Planet outer glow (atmosphere)
        var glowSize = pSize * 4;
        var cr = bodyColors[b].r;
        var cg = bodyColors[b].g;
        var cb = bodyColors[b].b;
        var bodyGrad = ctx.createRadialGradient(bx, by, 0, bx, by, glowSize);
        bodyGrad.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.9)');
        bodyGrad.addColorStop(0.2, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.5)');
        bodyGrad.addColorStop(0.5, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.15)');
        bodyGrad.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(bx, by, glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Planet body with shading
        var planetGrad = ctx.createRadialGradient(bx - pSize * 0.3, by - pSize * 0.3, pSize * 0.1, bx, by, pSize);
        planetGrad.addColorStop(0, 'rgba(' + Math.min(255, cr + 80) + ',' + Math.min(255, cg + 60) + ',' + Math.min(255, cb + 60) + ',1)');
        planetGrad.addColorStop(0.6, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.95)');
        planetGrad.addColorStop(1, 'rgba(' + Math.floor(cr * 0.4) + ',' + Math.floor(cg * 0.4) + ',' + Math.floor(cb * 0.4) + ',0.9)');
        ctx.fillStyle = planetGrad;
        ctx.beginPath();
        ctx.arc(bx, by, pSize, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight
        ctx.beginPath();
        ctx.arc(bx - pSize * 0.25, by - pSize * 0.25, pSize * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fill();

        // Ring for Saturn-like planet (index 3)
        if (b === 3) {
          ctx.save();
          ctx.translate(bx, by);
          ctx.scale(1, 0.35);
          ctx.beginPath();
          ctx.arc(0, 0, pSize * 2.2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 220, 120, 0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, pSize * 1.7, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(220, 190, 100, 0.3)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw trails (long-exposure orbital trails)
      var trArr = trailsRef.current;
      for (var ti = trArr.length - 1; ti >= 0; ti--) {
        var tr = trArr[ti];
        tr.age += 0.008 + _speed * 0.01;
        if (tr.age > 1) { trArr.splice(ti, 1); continue; }

        var trAlpha = (1 - tr.age) * (0.4 + _depth * 0.5);
        var trSize = (tr.size || 1) * (1 - tr.age * 0.6);
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, Math.max(0.3, trSize), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + tr.color.r + ',' + tr.color.g + ',' + tr.color.b + ',' + trAlpha.toFixed(3) + ')';
        ctx.fill();
      }

      // === Shooting star / comet ===
      shootTimer++;
      if (!shootingStar.active && (shootTimer > 300 || (peakVal > 0.5 && Math.random() < 0.05))) {
        shootingStar.active = true;
        shootingStar.x = Math.random() < 0.5 ? -10 : W + 10;
        shootingStar.y = Math.random() * H * 0.5;
        shootingStar.vx = shootingStar.x < 0 ? (3 + Math.random() * 4) : -(3 + Math.random() * 4);
        shootingStar.vy = 1 + Math.random() * 2;
        shootingStar.life = 1;
        shootingStar.trail = [];
        shootTimer = 0;
      }
      if (shootingStar.active) {
        shootingStar.x += shootingStar.vx;
        shootingStar.y += shootingStar.vy;
        shootingStar.life -= 0.015;
        shootingStar.trail.push({ x: shootingStar.x, y: shootingStar.y, life: shootingStar.life });
        if (shootingStar.trail.length > 30) shootingStar.trail.shift();

        // Draw comet trail
        for (var ct = 0; ct < shootingStar.trail.length; ct++) {
          var tp = shootingStar.trail[ct];
          var tAlpha = (ct / shootingStar.trail.length) * shootingStar.life * 0.8;
          var tSize = (ct / shootingStar.trail.length) * 2.5;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, tSize, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 220, ' + tAlpha.toFixed(3) + ')';
          ctx.fill();
        }
        // Comet head
        ctx.beginPath();
        ctx.arc(shootingStar.x, shootingStar.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (shootingStar.life * 0.9).toFixed(3) + ')';
        ctx.fill();
        // Comet glow
        var cometGrad = ctx.createRadialGradient(shootingStar.x, shootingStar.y, 0, shootingStar.x, shootingStar.y, 10);
        cometGrad.addColorStop(0, 'rgba(200, 230, 255, ' + (shootingStar.life * 0.4).toFixed(3) + ')');
        cometGrad.addColorStop(1, 'rgba(100, 150, 255, 0)');
        ctx.fillStyle = cometGrad;
        ctx.beginPath();
        ctx.arc(shootingStar.x, shootingStar.y, 10, 0, Math.PI * 2);
        ctx.fill();

        if (shootingStar.life <= 0 || shootingStar.x < -50 || shootingStar.x > W + 50) {
          shootingStar.active = false;
        }
      }

      // Width indicators (L/R markers)
      var wAlpha = 0.15 + _width * 0.2;
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(100, 200, 255, ' + wAlpha.toFixed(3) + ')';
      ctx.fillText('L', cx - orbitRx * 1.08 - 8, cy + 3);
      ctx.fillText('R', cx + orbitRx * 1.08 + 8, cy + 3);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 340, height: 180, display: 'block' }} />;
}

// ─── Orbit Ring Bypass ───────────────────────────────────────────────────────
function OrbitBypass({ active, onClick }) {
  const size = 28;
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active' : 'Bypassed'}>
      <svg width={size} height={size} viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="11" fill="none"
          stroke={active ? 'rgba(60,180,255,0.5)' : 'rgba(30,50,80,0.2)'}
          strokeWidth="1" />
        <ellipse cx="14" cy="14" rx="10" ry="6" fill="none"
          stroke={active ? 'rgba(40,200,220,0.4)' : 'rgba(30,50,80,0.15)'}
          strokeWidth="0.8"
          style={{ transformOrigin: '14px 14px', transform: 'rotate(-20deg)' }} />
        <circle cx="14" cy="14" r="2.5"
          fill={active ? 'rgba(200,230,255,0.9)' : 'rgba(30,50,80,0.3)'} />
        {active && <circle cx="20" cy="9" r="1.5" fill="rgba(80,180,255,0.7)" />}
      </svg>
    </div>
  );
}

// ─── Space Knob (Saturn Planet) ─────────────────────────────────────────────
function SpaceKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,14,20,0.9)"
        stroke="rgba(120,140,180,0.08)" strokeWidth="1.5" />
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke="hsla(210,65%,55%,0.7)"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill="hsla(210,80%,70%,0.9)" />
      <circle cx={dotX} cy={dotY} r="4"
        fill="hsla(210,80%,70%,0.12)" />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
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
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <SpaceKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(60,180,255,0.7)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(40,140,255,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
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
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <SpaceKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(60,160,255,0.45)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

// ─── Path Selector Buttons ───────────────────────────────────────────────────
function PathSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {PATH_NAMES.map((name, i) => (
        <button key={i} onClick={() => onChange(i)} style={{
          fontSize: 5.5, fontWeight: 700, letterSpacing: '0.08em',
          padding: '2px 5px', borderRadius: 2, cursor: 'pointer',
          background: value === i ? 'rgba(60,180,255,0.15)' : 'transparent',
          color: value === i ? 'rgba(100,200,255,0.9)' : 'rgba(60,140,200,0.4)',
          border: `1px solid ${value === i ? 'rgba(60,180,255,0.3)' : 'rgba(40,80,140,0.15)'}`,
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          transition: 'all 0.15s',
        }}>{name}</button>
      ))}
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',                speed: 0.3, path: 0, width: 0.6, depth: 0.4, tone: 0.5, mix: 0.3, smooth: 0 },
  { name: 'SLOW HALO VOCAL',     speed: 0.15, path: 0, width: 0.7, depth: 0.3, tone: 0.55, mix: 0.35, smooth: 0 },
  { name: 'WIDE ORBIT PAD',      speed: 0.25, path: 0, width: 0.9, depth: 0.5, tone: 0.45, mix: 0.4, smooth: 0 },
  { name: 'SPIRAL DREAM TAIL',   speed: 0.4, path: 3, width: 0.7, depth: 0.6, tone: 0.4, mix: 0.45, smooth: 0 },
  { name: 'FIGURE 8 MOTION',     speed: 0.35, path: 1, width: 0.8, depth: 0.5, tone: 0.5, mix: 0.35, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#060a14', text: '#60b0ff', textDim: 'rgba(60,180,255,0.5)',
  border: 'rgba(40,120,255,0.12)', hoverBg: 'rgba(40,120,255,0.1)', activeBg: 'rgba(40,120,255,0.06)',
};

export default function OrbitOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [speed,  setSpeed]  = useState(initialState?.speed  ?? 0.3);
  const [path,   setPath]   = useState(initialState?.path   ?? 0);
  const [width,  setWidth]  = useState(initialState?.width  ?? 0.6);
  const [depth,  setDepth]  = useState(initialState?.depth  ?? 0.4);
  const [tone,   setTone]   = useState(initialState?.tone   ?? 0.5);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 0.3);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);
  const [orbX, setOrbX] = useState(0);
  const [orbY, setOrbY] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, speed, path, width, depth, tone, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createOrbitEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSpeed(s.speed); eng.setPath(s.path); eng.setWidth(s.width);
      eng.setDepth(s.depth); eng.setTone(s.tone); eng.setMix(s.mix);
      eng.setBypass(s.bypassed);
      eng.setSmooth(s.smooth);
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
        setPeak(engineRef.current.getInputPeak?.() ?? 0);
        setOutPeak(engineRef.current.getPeakOutput?.() ?? engineRef.current.getOutputPeak?.() ?? 0);
        setOrbX(engineRef.current.getOrbX?.() ?? 0);
        setOrbY(engineRef.current.getOrbY?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, speed, path, width, depth, tone, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, speed, path, width, depth, tone, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setSpeed(p.speed); setPath(p.path); setWidth(p.width);
    setDepth(p.depth); setTone(p.tone); setMix(p.mix);
    if (p.smooth !== undefined) setSmooth(p.smooth);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setSpeed(p.speed); e.setPath(p.path); e.setWidth(p.width); e.setDepth(p.depth); e.setTone(p.tone); e.setMix(p.mix); if (p.smooth !== undefined) e.setSmooth(p.smooth); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;

  return (
    <div style={{
      width: 340, borderRadius: 5, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #0a1020 0%, #060c1a 30%, #040816 60%, #020410 100%)',
      border: '1.5px solid rgba(40,120,255,0.15)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 20px rgba(40,120,255,0.06), inset 0 1px 0 rgba(60,160,255,0.06)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(2,4,10,0.5) 100%)',
        borderRadius: 5,
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(40,120,255,0.08)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(40,120,255,0.02) 0%, transparent 100%)',
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 15, fontWeight: 800, letterSpacing: '0.15em',
            background: 'linear-gradient(135deg, #3090ff 0%, #40c0e0 50%, #80d0ff 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(40,140,255,0.3))',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>ORBIT</span>
          <span style={{
            fontSize: 5.5, fontWeight: 400, color: 'rgba(60,150,255,0.35)',
            letterSpacing: '0.3em', marginTop: 1.5,
            fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif',
          }}>spatial movement reverb</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Preset + Path row */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(40,120,255,0.06)', position: 'relative', zIndex: 10,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(40,140,255,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* Hero canvas */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <OrbitCanvas speed={speed} path={path} width={width} depth={depth} peak={peak} outPeak={outPeak} orbX={orbX} orbY={orbY} />
      </div>

      {/* Path selector row */}
      <div style={{
        padding: '4px 18px', display: 'flex', justifyContent: 'center',
        borderTop: '1px solid rgba(40,120,255,0.06)', position: 'relative', zIndex: 2,
      }}>
        <PathSelector value={Math.round(path)} onChange={v => { setPath(v); engineRef.current?.setPath(v); setActivePreset(null); }} />
      </div>

      {/* Knob row */}
      <div style={{
        padding: '5px 10px 3px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderTop: '1px solid rgba(40,120,255,0.06)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="SPEED" value={speed} defaultValue={0.3} size={26} format={v => `${(0.05 + v * 1.95).toFixed(2)}Hz`}
          onChange={v => { setSpeed(v); engineRef.current?.setSpeed(v); setActivePreset(null); }} />
        <Knob label="WIDTH" value={width} defaultValue={0.6} size={26} format={pctFmt}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <Knob label="DEPTH" value={depth} defaultValue={0.4} size={26} format={pctFmt}
          onChange={v => { setDepth(v); engineRef.current?.setDepth(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={26} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.3} size={26} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 18px 5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, position: 'relative', zIndex: 2 }}>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }} style={{
          fontSize: 6, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
          background: smooth > 0 ? 'rgba(60,180,255,0.18)' : 'transparent',
          color: smooth > 0 ? 'rgba(100,210,255,0.95)' : 'rgba(60,140,200,0.4)',
          border: `1px solid ${smooth > 0 ? 'rgba(60,180,255,0.45)' : 'rgba(40,80,140,0.2)'}`,
          boxShadow: smooth > 0 ? '0 0 8px rgba(60,180,255,0.25)' : 'none',
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
        }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <OrbitBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
