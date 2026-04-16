import { useState, useEffect, useRef, useCallback } from 'react';
import { createSmearEngine } from './smearEngine';
import PresetSelector from './PresetSelector';

// ─── SMEAR: Dream / Lo-Fi Unstable Reverb ────────────────────────────────────
// Visual: WATERCOLOR PAINT — muted pastels bleeding & diffusing
// Hero: Paint drops that spread, bleed, mix organically
// Knobs: Soft brushstroke arcs with watercolor wash
// Bypass: Paint droplet ring

// ─── Watercolor Canvas ───────────────────────────────────────────────────────
function WatercolorCanvas({ smear, drift, degrade, size, tone, peak = 0, outPeak = 0, smearLevel = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const dropsRef = useRef(null);
  const lastPeakRef = useRef(0);
  const valRef = useRef({ smear: 0, drift: 0, degrade: 0, size: 0, tone: 0, peak: 0, outPeak: 0, smearLevel: 0 });

  valRef.current = { smear, drift, degrade, size, tone, peak, outPeak, smearLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // VIVID watercolor palette: hot pink, electric blue, lime green, bright orange, violet, magenta
    const palette = [
      { r: 255, g: 40, b: 130 },  // hot pink
      { r: 30, g: 144, b: 255 },  // electric blue
      { r: 80, g: 255, b: 80 },   // lime green
      { r: 255, g: 140, b: 0 },   // bright orange
      { r: 160, g: 32, b: 255 },  // violet
      { r: 255, g: 0, b: 200 },   // magenta
      { r: 255, g: 255, b: 0 },   // yellow
      { r: 0, g: 255, b: 200 },   // cyan-green
    ];

    // Initialize paint drops
    if (!dropsRef.current) {
      const drops = [];
      for (let i = 0; i < 28; i++) {
        const col = palette[i % palette.length];
        drops.push({
          x: Math.random() * W,
          y: Math.random() * H,
          radius: 12 + Math.random() * 30,
          maxRadius: 40 + Math.random() * 70,
          color: { r: col.r, g: col.g, b: col.b },
          alpha: 0.25 + Math.random() * 0.35,
          vx: (Math.random() - 0.5) * 0.6,
          vy: 0.1 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
          bleedRate: 0.02 + Math.random() * 0.04,
          swirlPhase: Math.random() * Math.PI * 2,
          hueShift: 0,
          dripY: 0,
          dripSpeed: 0.1 + Math.random() * 0.4,
        });
      }
      dropsRef.current = drops;
    }

    // Paper fiber grain texture (pre-computed positions)
    var fibers = [];
    for (var fi = 0; fi < 120; fi++) {
      fibers.push({
        x: Math.random() * W,
        y: Math.random() * H,
        len: 4 + Math.random() * 12,
        angle: Math.random() * Math.PI,
        alpha: 0.03 + Math.random() * 0.05,
      });
    }

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const { smear: _smear, drift: _drift, degrade: _degrade, size: _size, tone: _tone, peak: _peak, outPeak: _outPeak, smearLevel: _smearLevel } = valRef.current;

      phaseRef.current += 0.006;
      const phase = phaseRef.current;

      // Slow fade — let paint trails persist
      ctx.fillStyle = 'rgba(40, 36, 32, 0.04)';
      ctx.fillRect(0, 0, W, H);

      // Wet paper base with warm cream tone
      ctx.fillStyle = 'rgba(50, 44, 38, 0.88)';
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      // Paper fiber grain texture (always visible)
      ctx.strokeStyle = 'rgba(90, 80, 70, 0.06)';
      ctx.lineWidth = 0.5;
      for (var fj = 0; fj < fibers.length; fj++) {
        var fb = fibers[fj];
        ctx.beginPath();
        ctx.moveTo(fb.x, fb.y);
        ctx.lineTo(fb.x + Math.cos(fb.angle) * fb.len, fb.y + Math.sin(fb.angle) * fb.len);
        ctx.stroke();
      }

      // Degrade: paper aging, ink spots, splatter effects
      if (_degrade > 0.05) {
        var grainCount = Math.floor(_degrade * 350);
        for (var g = 0; g < grainCount; g++) {
          var gx = Math.random() * W;
          var gy = Math.random() * H;
          var gSize = 0.5 + Math.random() * (1 + _degrade * 3);
          if (Math.random() < 0.3) {
            // Dark age spots
            ctx.fillStyle = 'rgba(20, 15, 10, ' + (_degrade * 0.08).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(gx, gy, gSize, 0, Math.PI * 2);
            ctx.fill();
          } else if (Math.random() < 0.5) {
            // Colored ink splatter
            var inkCol = palette[Math.floor(Math.random() * palette.length)];
            ctx.fillStyle = 'rgba(' + inkCol.r + ',' + inkCol.g + ',' + inkCol.b + ',' + (_degrade * 0.06).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(gx, gy, gSize * 1.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Paper grain
            ctx.fillStyle = 'rgba(70, 60, 50, ' + (_degrade * 0.04).toFixed(3) + ')';
            ctx.fillRect(gx, gy, 1, 1);
          }
        }
        // Water stain rings from degrade
        if (_degrade > 0.3) {
          var stainCount = Math.floor(_degrade * 3);
          for (var si = 0; si < stainCount; si++) {
            var sx = 40 + Math.sin(phase * 0.1 + si * 2) * (W * 0.3);
            var sy = 30 + Math.cos(phase * 0.08 + si * 3) * (H * 0.3);
            var sr = 15 + _degrade * 30;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(100, 80, 50, ' + (_degrade * 0.04).toFixed(3) + ')';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }

      // Audio transient detection -> spawn BIG visible drops
      var currentPeak = _peak || 0;
      if (currentPeak > lastPeakRef.current + 0.04 && currentPeak > 0.08) {
        var numNew = 1 + Math.floor(currentPeak * 3);
        for (var ni = 0; ni < numNew; ni++) {
          var col = palette[Math.floor(Math.random() * palette.length)];
          dropsRef.current.push({
            x: 40 + Math.random() * (W - 80),
            y: 10 + Math.random() * (H - 40),
            radius: 8 + currentPeak * 25,
            maxRadius: 35 + currentPeak * 80 + _smear * 50,
            color: { r: col.r, g: col.g, b: col.b },
            alpha: 0.4 + currentPeak * 0.4,
            vx: (Math.random() - 0.5) * 1.2,
            vy: 0.3 + Math.random() * 0.8,
            phase: phase,
            bleedRate: 0.03 + _smear * 0.06,
            swirlPhase: Math.random() * Math.PI * 2,
            hueShift: 0,
            dripY: 0,
            dripSpeed: 0.2 + currentPeak * 0.6,
          });
        }
        if (dropsRef.current.length > 55) dropsRef.current.splice(0, dropsRef.current.length - 55);
      }
      lastPeakRef.current = currentPeak * 0.85 + lastPeakRef.current * 0.15;

      // Draw and animate drops
      var drops = dropsRef.current;
      for (var i = drops.length - 1; i >= 0; i--) {
        var d = drops[i];

        // Grow radius based on smear — faster bleed at higher smear
        var growSpeed = d.bleedRate * (0.8 + _smear * 2.5);
        d.radius = Math.min(d.maxRadius, d.radius + growSpeed);

        // Drift: hue cycling through rainbow
        d.hueShift += _drift * 1.8;
        var hueRad = (d.hueShift * Math.PI) / 180;
        var cosH = Math.cos(hueRad);
        var sinH = Math.sin(hueRad);
        var baseR = d.color.r;
        var baseG = d.color.g;
        var baseB = d.color.b;
        // Simple hue rotation matrix
        var rr = Math.max(0, Math.min(255, Math.floor(baseR * (0.6 + 0.4 * cosH) + baseG * (0.2 * (1 - cosH) - 0.17 * sinH) + baseB * (0.2 * (1 - cosH) + 0.35 * sinH))));
        var rg = Math.max(0, Math.min(255, Math.floor(baseR * (0.2 * (1 - cosH) + 0.17 * sinH) + baseG * (0.6 + 0.4 * cosH) + baseB * (0.2 * (1 - cosH) - 0.17 * sinH))));
        var rb = Math.max(0, Math.min(255, Math.floor(baseR * (0.2 * (1 - cosH) - 0.35 * sinH) + baseG * (0.2 * (1 - cosH) + 0.17 * sinH) + baseB * (0.6 + 0.4 * cosH))));

        // Drift: swirl movement
        d.swirlPhase += 0.008 + _drift * 0.03;
        var swirlX = Math.sin(d.swirlPhase) * _drift * 2.5;
        var swirlY = Math.cos(d.swirlPhase * 0.7 + 1) * _drift * 1.8;
        d.x += d.vx + swirlX;
        d.y += d.vy + swirlY;

        // Dripping paint effect — gravity pulls paint down
        d.dripY += d.dripSpeed * (0.3 + _smear * 0.5);
        d.vy += 0.003;

        // Slow down horizontal
        d.vx *= 0.993;

        // Fade alpha (slower to keep colors rich)
        d.alpha *= 0.998;

        // Remove fully faded
        if (d.alpha < 0.01 || d.radius >= d.maxRadius * 0.99) {
          d.alpha *= 0.97;
          if (d.alpha < 0.005) { drops.splice(i, 1); continue; }
        }

        // Wrap horizontal
        if (d.x < -d.radius) d.x += W + d.radius * 2;
        if (d.x > W + d.radius) d.x -= W + d.radius * 2;
        // Remove if dripped off bottom
        if (d.y > H + d.radius * 2) { drops.splice(i, 1); continue; }

        // === Draw watercolor blob ===
        // Outer soft bleed with VIVID colors
        var bleedRadius = d.radius * (1.5 + _smear * 1.2);
        var outerGrad = ctx.createRadialGradient(d.x, d.y, d.radius * 0.1, d.x, d.y, bleedRadius);
        outerGrad.addColorStop(0, 'rgba(' + rr + ',' + rg + ',' + rb + ',' + (d.alpha * 0.8).toFixed(3) + ')');
        outerGrad.addColorStop(0.3, 'rgba(' + rr + ',' + rg + ',' + rb + ',' + (d.alpha * 0.5).toFixed(3) + ')');
        outerGrad.addColorStop(0.6, 'rgba(' + rr + ',' + rg + ',' + rb + ',' + (d.alpha * 0.2).toFixed(3) + ')');
        outerGrad.addColorStop(1, 'rgba(' + rr + ',' + rg + ',' + rb + ',0)');
        ctx.fillStyle = outerGrad;

        // Wobbly organic edge from drift
        ctx.beginPath();
        var wobblePoints = 32;
        for (var p = 0; p <= wobblePoints; p++) {
          var a = (p / wobblePoints) * Math.PI * 2;
          var wobble = 1 + Math.sin(a * 3 + phase * 2.5 + d.phase) * (0.08 + _drift * 0.2)
                         + Math.sin(a * 5 + phase * 1.5) * _drift * 0.12
                         + Math.sin(a * 7 + phase * 3) * 0.04;
          var rx = bleedRadius * wobble;
          var px = d.x + Math.cos(a) * rx;
          var py = d.y + Math.sin(a) * rx * 0.85;
          if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Inner concentrated pigment core — BRIGHT
        var coreGrad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.radius * 0.7);
        coreGrad.addColorStop(0, 'rgba(' + Math.min(255, rr + 40) + ',' + Math.min(255, rg + 40) + ',' + Math.min(255, rb + 40) + ',' + (d.alpha * 0.95).toFixed(3) + ')');
        coreGrad.addColorStop(0.4, 'rgba(' + rr + ',' + rg + ',' + rb + ',' + (d.alpha * 0.6).toFixed(3) + ')');
        coreGrad.addColorStop(1, 'rgba(' + rr + ',' + rg + ',' + rb + ',0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();

        // White highlight spot (wet paint reflection)
        ctx.beginPath();
        ctx.arc(d.x - d.radius * 0.15, d.y - d.radius * 0.15, d.radius * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + (d.alpha * 0.25).toFixed(3) + ')';
        ctx.fill();

        // Dripping paint streaks from bottom of drops
        if (d.dripY > 2) {
          var dripLen = Math.min(d.dripY, 40 + _smear * 30);
          var dripW = 1 + d.radius * 0.08;
          var dripGrad = ctx.createLinearGradient(d.x, d.y + d.radius * 0.5, d.x, d.y + d.radius * 0.5 + dripLen);
          dripGrad.addColorStop(0, 'rgba(' + rr + ',' + rg + ',' + rb + ',' + (d.alpha * 0.6).toFixed(3) + ')');
          dripGrad.addColorStop(0.6, 'rgba(' + rr + ',' + rg + ',' + rb + ',' + (d.alpha * 0.2).toFixed(3) + ')');
          dripGrad.addColorStop(1, 'rgba(' + rr + ',' + rg + ',' + rb + ',0)');
          ctx.fillStyle = dripGrad;
          // Wavy drip
          ctx.beginPath();
          ctx.moveTo(d.x - dripW, d.y + d.radius * 0.4);
          var dSteps = 8;
          for (var ds = 0; ds <= dSteps; ds++) {
            var dt = ds / dSteps;
            var dsx = d.x + Math.sin(dt * 4 + phase + d.phase) * dripW * 0.5 - dripW;
            var dsy = d.y + d.radius * 0.4 + dt * dripLen;
            ctx.lineTo(dsx, dsy);
          }
          for (var ds2 = dSteps; ds2 >= 0; ds2--) {
            var dt2 = ds2 / dSteps;
            var dsx2 = d.x + Math.sin(dt2 * 4 + phase + d.phase) * dripW * 0.5 + dripW;
            var dsy2 = d.y + d.radius * 0.4 + dt2 * dripLen;
            ctx.lineTo(dsx2, dsy2);
          }
          ctx.closePath();
          ctx.fill();
        }

        // Color mixing: where drops overlap, draw additive blend spot
        for (var j = i - 1; j >= Math.max(0, i - 5); j--) {
          var d2 = drops[j];
          var dx = d.x - d2.x;
          var dy = d.y - d2.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var touchDist = (d.radius + d2.radius) * 0.5;
          if (dist < touchDist) {
            var mx = (d.x + d2.x) * 0.5;
            var my = (d.y + d2.y) * 0.5;
            var mr = Math.min(d.radius, d2.radius) * 0.4;
            var mixAlpha = Math.min(d.alpha, d2.alpha) * 0.3 * (1 - dist / touchDist);
            // Blend the two colors
            var mr2 = Math.floor((rr + d2.color.r) * 0.5);
            var mg2 = Math.floor((rg + d2.color.g) * 0.5);
            var mb2 = Math.floor((rb + d2.color.b) * 0.5);
            var mixGrad = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
            mixGrad.addColorStop(0, 'rgba(' + mr2 + ',' + mg2 + ',' + mb2 + ',' + mixAlpha.toFixed(3) + ')');
            mixGrad.addColorStop(1, 'rgba(' + mr2 + ',' + mg2 + ',' + mb2 + ',0)');
            ctx.fillStyle = mixGrad;
            ctx.beginPath();
            ctx.arc(mx, my, mr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Size: vignette
      var vigR = 0.45 + _size * 0.35;
      var vig = ctx.createRadialGradient(W / 2, H / 2, W * vigR * 0.3, W / 2, H / 2, W * vigR);
      vig.addColorStop(0, 'rgba(40, 36, 32, 0)');
      vig.addColorStop(1, 'rgba(30, 26, 22, ' + (0.2 + (1 - _size) * 0.25).toFixed(3) + ')');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // Tone indicator: warm/cool color wash
      var toneAlpha = 0.06 + (_outPeak || 0) * 0.04;
      if (_tone < 0.4) {
        ctx.fillStyle = 'rgba(255, 180, 60, ' + (toneAlpha * (0.4 - _tone) * 3).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      } else if (_tone > 0.6) {
        ctx.fillStyle = 'rgba(80, 180, 255, ' + (toneAlpha * (_tone - 0.6) * 3).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }

      // SmearLevel reactive glow — vivid multicolor
      if (_smearLevel > 0.03) {
        var glowR = 50 + _smearLevel * 120;
        var hueOffset = phase * 30;
        var glowR2 = Math.floor(180 + Math.sin(hueOffset * 0.017) * 75);
        var glowG2 = Math.floor(130 + Math.sin(hueOffset * 0.017 + 2) * 75);
        var glowB2 = Math.floor(200 + Math.sin(hueOffset * 0.017 + 4) * 55);
        var glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, glowR);
        glow.addColorStop(0, 'rgba(' + glowR2 + ',' + glowG2 + ',' + glowB2 + ',' + (_smearLevel * 0.2).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(' + glowR2 + ',' + glowG2 + ',' + glowB2 + ',0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      }

      // Watermark
      ctx.save();
      ctx.font = 'bold 38px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(200, 180, 160, 0.03)';
      ctx.fillText('SMEAR', W / 2, H / 2);
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── Watercolor Bypass Droplet ───────────────────────────────────────────────
function DropletBypass({ active, onClick }) {
  const size = 28;
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active' : 'Bypassed'}>
      <svg width={size} height={size} viewBox="0 0 28 28">
        <defs>
          <radialGradient id="drop-fill" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stopColor={active ? 'rgba(210,145,155,0.8)' : 'rgba(80,70,65,0.3)'} />
            <stop offset="100%" stopColor={active ? 'rgba(175,155,195,0.5)' : 'rgba(50,45,40,0.2)'} />
          </radialGradient>
        </defs>
        {/* Droplet shape */}
        <path d="M14 4 C14 4 6 14 6 18 C6 22.4 9.6 26 14 26 C18.4 26 22 22.4 22 18 C22 14 14 4 14 4Z"
          fill="url(#drop-fill)"
          stroke={active ? 'rgba(210,145,155,0.6)' : 'rgba(80,70,65,0.2)'}
          strokeWidth="1"
        />
        {active && (
          <circle cx="11" cy="16" r="2.5" fill="rgba(255,255,255,0.15)" />
        )}
      </svg>
    </div>
  );
}

// ─── Watercolor Knob ─────────────────────────────────────────────────────────
function WashKnob({ size = 26, norm = 0, hue = '210,145,155' }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  // Line pointer angle
  const ptrLen = r * 0.55;
  const ptrX = cx + Math.cos(sweepAngle) * ptrLen;
  const ptrY = cy + Math.sin(sweepAngle) * ptrLen;
  const filterId = `wash-glow-${size}`;
  const gradId = `wash-bg-${size}`;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={gradId} cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor={`rgba(${hue},0.25)`} />
          <stop offset="100%" stopColor="rgba(20,18,16,0.95)" />
        </radialGradient>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
      {/* Body with radial gradient */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${gradId})`}
        stroke={`rgba(${hue},0.12)`} strokeWidth="1" />
      {/* Arc with glow */}
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={`rgba(${hue},0.8)`}
          strokeWidth="1.8" strokeLinecap="round"
          filter={`url(#${filterId})`} />
      )}
      {/* Dot at arc end with glow */}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill={`rgba(${hue},0.95)`}
        filter={`url(#${filterId})`} />
      {/* Line pointer from center */}
      <line x1={cx} y1={cy} x2={ptrX} y2={ptrY}
        stroke={`rgba(${hue},0.5)`} strokeWidth="1" strokeLinecap="round" />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="1.5" fill={`rgba(${hue},0.25)`} />
    </svg>
  );
}

// ─── Knob wrapper ────────────────────────────────────────────────────────────
function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 26, format, sensitivity = 140, hue = '210,145,155' }) {
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
        <WashKnob size={size} norm={norm} hue={hue} />
      </div>
      <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: `rgba(${hue},0.8)`, fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 7, color: `rgba(${hue},0.5)`, fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Tiny gain knob ──────────────────────────────────────────────────────────
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
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <WashKnob size={size} norm={norm} hue="180,160,150" />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(180,160,150,0.45)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',              smear: 0.4, drift: 0.2, degrade: 0.15, size: 0.5, tone: 0.45, mix: 0.3, smooth: 0 },
  { name: 'DREAM POP WASH',    smear: 0.65, drift: 0.3, degrade: 0.1, size: 0.7, tone: 0.55, mix: 0.4, smooth: 0 },
  { name: 'LO-FI HAUNTED ROOM',smear: 0.5, drift: 0.15, degrade: 0.55, size: 0.4, tone: 0.3, mix: 0.35, smooth: 0 },
  { name: 'TAPE CLOUD',        smear: 0.75, drift: 0.45, degrade: 0.35, size: 0.6, tone: 0.4, mix: 0.45, smooth: 0 },
  { name: 'BLURRED HOOK SPACE',smear: 0.85, drift: 0.5, degrade: 0.2, size: 0.8, tone: 0.5, mix: 0.5, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#231f1d', text: '#d2919b', textDim: 'rgba(210,145,155,0.5)',
  border: 'rgba(210,145,155,0.12)', hoverBg: 'rgba(210,145,155,0.1)', activeBg: 'rgba(210,145,155,0.06)',
};

export default function SmearOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [smear,   setSmear]   = useState(initialState?.smear   ?? 0.4);
  const [drift,   setDrift]   = useState(initialState?.drift   ?? 0.2);
  const [degrade, setDegrade] = useState(initialState?.degrade ?? 0.15);
  const [size,    setSize]    = useState(initialState?.size    ?? 0.5);
  const [tone,    setTone]    = useState(initialState?.tone    ?? 0.45);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 0.3);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [smearLevel, setSmearLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, smear, drift, degrade, size, tone, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createSmearEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSmear(s.smear); eng.setDrift(s.drift); eng.setDegrade(s.degrade);
      eng.setSize(s.size); eng.setTone(s.tone); eng.setMix(s.mix);
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
        setSmearLevel(engineRef.current.getSmearLevel());
        setPeak(engineRef.current.getInputPeak?.() ?? 0);
        setOutPeak(engineRef.current.getPeakOutput?.() ?? engineRef.current.getOutputPeak?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, smear, drift, degrade, size, tone, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, smear, drift, degrade, size, tone, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setSmear(p.smear); setDrift(p.drift); setDegrade(p.degrade);
    setSize(p.size); setTone(p.tone); setMix(p.mix);
    setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    const e = engineRef.current;
    if (e) { e.setSmear(p.smear); e.setDrift(p.drift); e.setDegrade(p.degrade); e.setSize(p.size); e.setTone(p.tone); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #2a2522 0%, #231f1d 30%, #1e1b19 60%, #1a1715 100%)',
      border: '1.5px solid rgba(210,145,155,0.15)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 20px rgba(210,145,155,0.05), inset 0 1px 0 rgba(210,145,155,0.06)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(20,18,16,0.5) 100%)',
        borderRadius: 5,
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(210,145,155,0.08)', position: 'relative', zIndex: 10, flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(210,145,155,0.02) 0%, transparent 100%)',
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, letterSpacing: '0.15em',
            background: 'linear-gradient(135deg, #d2919b 0%, #9b9bc3 40%, #9bb98f 70%, #d7c38c 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 6px rgba(210,145,155,0.2))',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>SMEAR</span>
          <span style={{
            fontSize: 6, fontWeight: 400, color: 'rgba(210,145,155,0.35)',
            letterSpacing: '0.3em', marginTop: 1.5,
            fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif',
          }}>watercolor reverb</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Preset row */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(210,145,155,0.06)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(210,145,155,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* Hero canvas */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, maxHeight: 280 }}>
        <WatercolorCanvas
          smear={smear} drift={drift} degrade={degrade}
          size={size} tone={tone}
          peak={peak} outPeak={outPeak} smearLevel={smearLevel}
        />
      </div>

      {/* Knob row */}
      <div style={{
        padding: '10px 0 6px', display: 'flex', justifyContent: 'space-evenly', alignItems: 'flex-start',
        borderTop: '1px solid rgba(210,145,155,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="SMEAR" value={smear} defaultValue={0.4} size={34} format={pctFmt} hue="210,145,155"
          onChange={v => { setSmear(v); engineRef.current?.setSmear(v); setActivePreset(null); }} />
        <Knob label="DRIFT" value={drift} defaultValue={0.2} size={34} format={pctFmt} hue="155,185,145"
          onChange={v => { setDrift(v); engineRef.current?.setDrift(v); setActivePreset(null); }} />
        <Knob label="DEGRADE" value={degrade} defaultValue={0.15} size={34} format={pctFmt} hue="175,155,195"
          onChange={v => { setDegrade(v); engineRef.current?.setDegrade(v); setActivePreset(null); }} />
        <Knob label="SIZE" value={size} defaultValue={0.5} size={34} format={pctFmt} hue="215,195,140"
          onChange={v => { setSize(v); engineRef.current?.setSize(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.45} size={34} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'} hue="180,160,170"
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.3} size={34} format={pctFmt} hue="145,175,175"
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 18px 10px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
          style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', padding: '5px 10px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(210,145,155,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(240,180,190,0.95)' : 'rgba(180,130,140,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(210,145,155,0.45)' : 'rgba(140,100,110,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(210,145,155,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <DropletBypass
          active={!bypassed}
          onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
        />
      </div>
    </div>
  );
}
