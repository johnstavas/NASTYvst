import { useState, useEffect, useRef, useCallback } from 'react';
import { createFocusReverbEngine } from './focusReverbEngine';
import PresetSelector from './PresetSelector';

// ─── FOCUS REVERB: Magnifying Lens / Focus Ring Visualization ───────────────
// A circular lens in center shows the "source" as a sharp focused point,
// while reverb swirls around outside as bokeh-like blurred light circles.
// Focus parameter changes lens sharpness.
// Colors: warm white center, cool blue/purple reverb field outside.

// ─── Focus Lens Canvas ──────────────────────────────────────────────────────
function FocusLensCanvas({ focus, wrap, separation, size, tone, mix, peakLevel, srcActivity, reverbLevel }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ focus: 0.5, wrap: 0.5, separation: 0.5, size: 0.5, tone: 0.5, mix: 0.3, peakLevel: 0, srcActivity: 0, reverbLevel: 0 });
  const bokehRef = useRef([]);
  const phaseRef = useRef(0);

  valRef.current = { focus, wrap, separation, size, tone, mix, peakLevel, srcActivity, reverbLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize bokeh circles (more, bigger, varied)
    if (bokehRef.current.length === 0) {
      for (var bi = 0; bi < 40; bi++) {
        var bAngle = Math.random() * Math.PI * 2;
        var bDist = 25 + Math.random() * 80;
        var isWarm = bAngle > Math.PI * 0.5 && bAngle < Math.PI * 1.5;
        bokehRef.current.push({
          angle: bAngle, dist: bDist,
          baseR: 4 + Math.random() * 14,
          speed: 0.002 + Math.random() * 0.006,
          hue: isWarm ? (30 + Math.random() * 30) : (190 + Math.random() * 40),
          alpha: 0.08 + Math.random() * 0.18,
          drift: Math.random() * Math.PI * 2,
          warm: isWarm,
          layer: bi < 15 ? 0 : (bi < 30 ? 1 : 2),
        });
      }
    }

    // Dust particles in light beams
    var dustParticles = [];
    for (var di = 0; di < 40; di++) {
      dustParticles.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.2,
        size: 0.3 + Math.random() * 1.0,
        brightness: 0.3 + Math.random() * 0.7,
        phase: Math.random() * 6.28,
      });
    }

    // Lens flare state
    var flareAngle = 0;

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      phaseRef.current += 0.012;
      var phase = phaseRef.current;
      var v = valRef.current;
      var cx = W * 0.5, cy = H * 0.5;
      var reactivity = 0.2 + v.peakLevel * 0.8;
      var rvLevel = Math.min(1, v.reverbLevel * 3);
      var srcAct = Math.min(1, v.srcActivity);
      flareAngle += 0.005 + v.peakLevel * 0.02;

      // ── Background: warm/cool blend ──
      // Single smooth gradient from warm left to cool right — no hard seam
      var sepX = cx + (v.separation - 0.5) * W * 0.3;
      var sepNorm = sepX / W; // 0..1 position of transition midpoint
      var bgGrad = ctx.createLinearGradient(0, 0, W, 0);
      bgGrad.addColorStop(0, 'rgba(25,15,8,1)');
      bgGrad.addColorStop(Math.max(0.05, sepNorm - 0.18), 'rgba(20,13,8,1)');
      bgGrad.addColorStop(Math.min(0.95, sepNorm + 0.18), 'rgba(8,12,22,1)');
      bgGrad.addColorStop(1, 'rgba(5,8,18,1)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Warm/cool atmosphere overlays
      var warmGlow = ctx.createRadialGradient(W * 0.25, cy, 5, W * 0.25, cy, W * 0.4);
      warmGlow.addColorStop(0, 'rgba(60,30,10,' + (0.08 + srcAct * 0.1).toFixed(3) + ')');
      warmGlow.addColorStop(1, 'rgba(40,20,5,0)');
      ctx.fillStyle = warmGlow;
      ctx.fillRect(0, 0, W, H);

      var coolGlow = ctx.createRadialGradient(W * 0.75, cy, 5, W * 0.75, cy, W * 0.4);
      coolGlow.addColorStop(0, 'rgba(10,20,50,' + (0.08 + rvLevel * 0.1).toFixed(3) + ')');
      coolGlow.addColorStop(1, 'rgba(5,10,30,0)');
      ctx.fillStyle = coolGlow;
      ctx.fillRect(0, 0, W, H);

      // ── Light beams (diagonal, warm on left, cool on right) ──
      for (var lbi = 0; lbi < 5; lbi++) {
        var lbX = W * 0.15 + lbi * W * 0.18;
        var lbAngle = -0.4 + Math.sin(phase * 0.2 + lbi) * 0.1;
        var lbWarm = lbX < sepX;
        var lbAlpha = 0.02 + srcAct * 0.03 + rvLevel * 0.02;
        var lbW = 15 + Math.sin(phase * 0.3 + lbi * 1.5) * 5;

        ctx.save();
        ctx.translate(lbX, -10);
        ctx.rotate(lbAngle);
        var lbGrad = ctx.createLinearGradient(0, 0, 0, H + 20);
        if (lbWarm) {
          lbGrad.addColorStop(0, 'rgba(255,200,100,' + (lbAlpha * 1.5).toFixed(3) + ')');
          lbGrad.addColorStop(0.5, 'rgba(255,170,60,' + lbAlpha.toFixed(3) + ')');
          lbGrad.addColorStop(1, 'rgba(255,140,40,0)');
        } else {
          lbGrad.addColorStop(0, 'rgba(100,160,255,' + (lbAlpha * 1.5).toFixed(3) + ')');
          lbGrad.addColorStop(0.5, 'rgba(60,120,220,' + lbAlpha.toFixed(3) + ')');
          lbGrad.addColorStop(1, 'rgba(40,80,180,0)');
        }
        ctx.fillStyle = lbGrad;
        ctx.beginPath();
        ctx.moveTo(-lbW * 0.3, 0);
        ctx.lineTo(lbW * 0.5, H + 20);
        ctx.lineTo(-lbW * 0.5, H + 20);
        ctx.lineTo(lbW * 0.3, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // ── Background bokeh (layer 0 - behind focus zone) ──
      var lensR = 22 + v.focus * 15;
      var bokeh = bokehRef.current;

      for (var i = 0; i < bokeh.length; i++) {
        var bk = bokeh[i];
        if (bk.layer === 1) continue; // draw mid-layer later

        bk.angle += bk.speed * (0.5 + v.wrap * 1.2);
        bk.drift += 0.004;

        var effDist = bk.dist * (0.4 + v.size * 0.9) + Math.sin(bk.drift) * 10;
        var wrapSpread = 1 + v.wrap * 0.6;
        var sepPush = 1 + v.separation * 0.6;

        var bx = cx + Math.cos(bk.angle) * effDist * wrapSpread * (bk.warm ? -sepPush * 0.5 : sepPush * 0.5);
        var by = cy + Math.sin(bk.angle) * effDist * 0.65 * wrapSpread;

        // Bigger blur when far from focus
        var blurScale = 0.6 + (1 - v.focus) * 1.2 + rvLevel * 0.6;
        var br = bk.baseR * blurScale * (bk.layer === 2 ? 1.3 : 0.8);

        var distFromCenter = Math.sqrt((bx - cx) * (bx - cx) + (by - cy) * (by - cy));
        if (distFromCenter < lensR) continue;

        var bokehAlpha = bk.alpha * (0.5 + rvLevel * 0.8) * reactivity;
        if (bokehAlpha < 0.005) continue;

        var warmShift = v.tone * 40;
        var hue = bk.warm ? (30 + warmShift) : (200 - warmShift * 0.5);

        // Bokeh circle - large, soft, colorful
        var bGrad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        bGrad.addColorStop(0, 'hsla(' + Math.round(hue) + ',65%,75%,' + (bokehAlpha * 0.7).toFixed(3) + ')');
        bGrad.addColorStop(0.4, 'hsla(' + Math.round(hue) + ',60%,65%,' + (bokehAlpha * 0.4).toFixed(3) + ')');
        bGrad.addColorStop(0.8, 'hsla(' + Math.round(hue + 10) + ',55%,55%,' + (bokehAlpha * 0.15).toFixed(3) + ')');
        bGrad.addColorStop(1, 'hsla(' + Math.round(hue) + ',50%,50%,0)');
        ctx.fillStyle = bGrad;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();

        // Bokeh ring edge (bright outline)
        ctx.beginPath();
        ctx.arc(bx, by, br * 0.88, 0, Math.PI * 2);
        ctx.strokeStyle = 'hsla(' + Math.round(hue) + ',70%,80%,' + (bokehAlpha * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 0.8 + br * 0.05;
        ctx.stroke();

        // Inner highlight spot
        ctx.beginPath();
        ctx.arc(bx - br * 0.2, by - br * 0.2, br * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + (bokehAlpha * 0.2).toFixed(3) + ')';
        ctx.fill();
      }

      // ── Aperture blade pattern (subtle, behind focus zone) ──
      var apR = lensR + 5;
      var bladeCount = 7;
      var apAlpha = 0.06 + v.focus * 0.08;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(phase * 0.05);
      ctx.beginPath();
      for (var ai = 0; ai < bladeCount; ai++) {
        var aAngle = (ai / bladeCount) * Math.PI * 2;
        var aAngle2 = ((ai + 0.5) / bladeCount) * Math.PI * 2;
        var ax = Math.cos(aAngle) * (apR + 8);
        var ay = Math.sin(aAngle) * (apR + 8);
        var amx = Math.cos(aAngle2) * (apR - 2 + v.focus * 8);
        var amy = Math.sin(aAngle2) * (apR - 2 + v.focus * 8);
        if (ai === 0) ctx.moveTo(ax, ay);
        ctx.lineTo(amx, amy);
        ctx.lineTo(Math.cos(((ai + 1) / bladeCount) * Math.PI * 2) * (apR + 8),
                    Math.sin(((ai + 1) / bladeCount) * Math.PI * 2) * (apR + 8));
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(180,200,230,' + apAlpha.toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // ── Focus zone (sharp center) ──
      var focusGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, lensR);
      var sharpness = v.focus;
      var warmth = 0.5 + v.tone * 0.3;
      var fR = Math.round(210 + warmth * 45);
      var fG = Math.round(200 + warmth * 35);
      var fB = Math.round(180 + (1 - warmth) * 60);
      focusGrad.addColorStop(0, 'rgba(' + fR + ',' + fG + ',' + fB + ',' + (0.2 + srcAct * 0.4 * sharpness).toFixed(3) + ')');
      focusGrad.addColorStop(0.3, 'rgba(' + fR + ',' + fG + ',' + fB + ',' + (0.1 + srcAct * 0.2 * sharpness).toFixed(3) + ')');
      focusGrad.addColorStop(0.7, 'rgba(' + (fR - 40) + ',' + (fG - 30) + ',' + (fB + 20) + ',' + (0.04 + srcAct * 0.08).toFixed(3) + ')');
      focusGrad.addColorStop(1, 'rgba(60,70,100,0)');
      ctx.fillStyle = focusGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
      ctx.fill();

      // Focus lens border ring (camera-style)
      ctx.beginPath();
      ctx.arc(cx, cy, lensR + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(220,230,250,' + (0.2 + v.focus * 0.3 + srcAct * 0.1).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Focus ring tick marks
      for (var fi = 0; fi < 16; fi++) {
        var fAngle = (fi / 16) * Math.PI * 2;
        var fInner = lensR + 3;
        var fOuter = lensR + 6 + (fi % 4 === 0 ? 3 : 0);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(fAngle) * fInner, cy + Math.sin(fAngle) * fInner);
        ctx.lineTo(cx + Math.cos(fAngle) * fOuter, cy + Math.sin(fAngle) * fOuter);
        ctx.strokeStyle = 'rgba(200,210,240,' + (0.15 + v.focus * 0.15).toFixed(3) + ')';
        ctx.lineWidth = fi % 4 === 0 ? 1 : 0.5;
        ctx.stroke();
      }

      // Source point sharp dot
      if (srcAct > 0.08) {
        var dotR = 3 + srcAct * 4 * sharpness;
        var dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR * 2.5);
        dotGrad.addColorStop(0, 'rgba(255,250,230,' + (srcAct * sharpness * 0.9).toFixed(3) + ')');
        dotGrad.addColorStop(0.2, 'rgba(255,240,200,' + (srcAct * sharpness * 0.5).toFixed(3) + ')');
        dotGrad.addColorStop(0.5, 'rgba(255,220,160,' + (srcAct * sharpness * 0.2).toFixed(3) + ')');
        dotGrad.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = dotGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, dotR * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Bright core
        ctx.beginPath();
        ctx.arc(cx, cy, dotR * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,250,' + (srcAct * sharpness).toFixed(3) + ')';
        ctx.fill();
      }

      // ── Crosshairs ──
      if (v.focus > 0.25 && srcAct > 0.08) {
        var chLen = 8 + v.focus * 6;
        var chAlpha = v.focus * srcAct * 0.4;
        ctx.strokeStyle = 'rgba(230,225,210,' + chAlpha.toFixed(3) + ')';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(cx - chLen, cy); ctx.lineTo(cx - 4, cy);
        ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + chLen, cy);
        ctx.moveTo(cx, cy - chLen); ctx.lineTo(cx, cy - 4);
        ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + chLen);
        ctx.stroke();
        // Corner brackets
        var brk = chLen * 0.7;
        var brkOff = lensR * 0.65;
        ctx.strokeStyle = 'rgba(200,210,230,' + (chAlpha * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 0.5;
        // Top-left
        ctx.beginPath();
        ctx.moveTo(cx - brkOff, cy - brkOff + brk * 0.3);
        ctx.lineTo(cx - brkOff, cy - brkOff);
        ctx.lineTo(cx - brkOff + brk * 0.3, cy - brkOff);
        ctx.stroke();
        // Top-right
        ctx.beginPath();
        ctx.moveTo(cx + brkOff - brk * 0.3, cy - brkOff);
        ctx.lineTo(cx + brkOff, cy - brkOff);
        ctx.lineTo(cx + brkOff, cy - brkOff + brk * 0.3);
        ctx.stroke();
        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(cx - brkOff, cy + brkOff - brk * 0.3);
        ctx.lineTo(cx - brkOff, cy + brkOff);
        ctx.lineTo(cx - brkOff + brk * 0.3, cy + brkOff);
        ctx.stroke();
        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(cx + brkOff - brk * 0.3, cy + brkOff);
        ctx.lineTo(cx + brkOff, cy + brkOff);
        ctx.lineTo(cx + brkOff, cy + brkOff - brk * 0.3);
        ctx.stroke();
      }

      // ── Lens flare streaks (respond to audio) ──
      if (srcAct > 0.1 || rvLevel > 0.1) {
        var flareIntensity = srcAct * 0.4 + rvLevel * 0.3 + v.peakLevel * 0.3;
        // Anamorphic horizontal streak
        var streakW = 30 + flareIntensity * 80;
        var streakH = 1 + flareIntensity * 2;
        var streakGrad = ctx.createLinearGradient(cx - streakW, cy, cx + streakW, cy);
        streakGrad.addColorStop(0, 'rgba(255,200,100,0)');
        streakGrad.addColorStop(0.3, 'rgba(255,220,150,' + (flareIntensity * 0.15).toFixed(3) + ')');
        streakGrad.addColorStop(0.5, 'rgba(255,250,230,' + (flareIntensity * 0.25).toFixed(3) + ')');
        streakGrad.addColorStop(0.7, 'rgba(100,180,255,' + (flareIntensity * 0.15).toFixed(3) + ')');
        streakGrad.addColorStop(1, 'rgba(60,120,220,0)');
        ctx.fillStyle = streakGrad;
        ctx.fillRect(cx - streakW, cy - streakH, streakW * 2, streakH * 2);

        // Diagonal flare rays
        for (var fri = 0; fri < 4; fri++) {
          var frAngle = flareAngle + fri * Math.PI * 0.5;
          var frLen = 15 + flareIntensity * 25;
          var frAlpha = flareIntensity * 0.08;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(frAngle) * frLen, cy + Math.sin(frAngle) * frLen);
          ctx.strokeStyle = 'rgba(255,240,200,' + frAlpha.toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Small flare circles along the streak axis
        for (var fci = 0; fci < 3; fci++) {
          var fcDist = 20 + fci * 25;
          var fcR = 3 + fci * 2;
          var fcx = cx + fcDist * Math.cos(flareAngle * 0.3);
          var fcy = cy + fcDist * Math.sin(flareAngle * 0.3) * 0.3;
          var fcHue = [40, 200, 300][fci];
          ctx.beginPath();
          ctx.arc(fcx, fcy, fcR, 0, Math.PI * 2);
          ctx.strokeStyle = 'hsla(' + fcHue + ',70%,70%,' + (flareIntensity * 0.1).toFixed(3) + ')';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // ── Dust particles in light beams ──
      for (var dpi = 0; dpi < dustParticles.length; dpi++) {
        var dp = dustParticles[dpi];
        dp.x += dp.vx + Math.sin(phase * 0.5 + dp.phase) * 0.15;
        dp.y += dp.vy + Math.cos(phase * 0.3 + dp.phase) * 0.1;
        if (dp.x < 0) dp.x = W;
        if (dp.x > W) dp.x = 0;
        if (dp.y < 0) dp.y = H;
        if (dp.y > H) dp.y = 0;

        var dpTwinkle = 0.3 + 0.7 * Math.pow(Math.sin(phase * 1.5 + dp.phase), 2);
        var dpAlpha = dp.brightness * dpTwinkle * (0.3 + srcAct * 0.3 + rvLevel * 0.2);
        var dpWarm = dp.x < sepX;
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dp.size * (0.5 + dpTwinkle * 0.5), 0, Math.PI * 2);
        if (dpWarm) {
          ctx.fillStyle = 'rgba(255,220,150,' + dpAlpha.toFixed(3) + ')';
        } else {
          ctx.fillStyle = 'rgba(150,200,255,' + dpAlpha.toFixed(3) + ')';
        }
        ctx.fill();
      }

      // ── Separation visual indicator (dividing line) ──
      if (v.separation > 0.2) {
        var sepAlpha = v.separation * 0.12;
        var sepGrad = ctx.createLinearGradient(sepX - 15, 0, sepX + 15, 0);
        sepGrad.addColorStop(0, 'rgba(255,200,100,0)');
        sepGrad.addColorStop(0.45, 'rgba(255,220,150,' + sepAlpha.toFixed(3) + ')');
        sepGrad.addColorStop(0.5, 'rgba(255,255,255,' + (sepAlpha * 1.5).toFixed(3) + ')');
        sepGrad.addColorStop(0.55, 'rgba(100,180,255,' + sepAlpha.toFixed(3) + ')');
        sepGrad.addColorStop(1, 'rgba(60,120,220,0)');
        ctx.fillStyle = sepGrad;
        ctx.fillRect(sepX - 15, 0, 30, H);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 160, display: 'block', borderRadius: 2 }} />;
}

// ─── Knob ───────────────────────────────────────────────────────────────────
// Camera aperture knob — iris blades open/close based on norm
function FocusKnob({ size = 36, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  const ACCENT_HUE = 220;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,14,20,0.9)"
        stroke="rgba(120,140,180,0.08)" strokeWidth="1.5" />
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={`hsla(${ACCENT_HUE},65%,55%,0.7)`}
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill={`hsla(${ACCENT_HUE},80%,70%,0.9)`} />
      <circle cx={dotX} cy={dotY} r="4"
        fill={`hsla(${ACCENT_HUE},80%,70%,0.12)`} />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format, sensitivity = 160 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : Math.round(norm * 100);

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 14 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <FocusKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(180,195,220,0.65)', fontWeight: 700, textAlign: 'center', lineHeight: 1.1,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(140,160,200,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 600,
      }}>{display}</span>
    </div>
  );
}

// ─── VSlider ────────────────────────────────────────────────────────────────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{ width: 10, height, background: '#080a14', borderRadius: 2, border: '1px solid rgba(140,160,200,0.1)', position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: 'rgba(140,160,220,0.06)', borderRadius: 1 }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: '#90a8d0', bottom: `calc(${norm * 100}% - 2px)`, boxShadow: '0 0 6px rgba(140,160,210,0.3)' }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(160,175,200,0.4)', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(140,160,200,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── LED Meter ──────────────────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeter({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: '#080a14', padding: '3px 2px', borderRadius: 2, border: '1px solid rgba(140,160,200,0.08)' }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: 'rgba(140,160,220,0.05)' }} />
      ))}
    </div>
  );
}

function DbReadout({ dbRef }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: 'rgba(140,160,200,0.4)', width: 28, textAlign: 'center', display: 'inline-block' }}>-{'\u221E'}<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff5050' : i >= METER_SEGMENTS - 4 ? '#c0a0e0' : '#90a8d0';
    segmentEls[i].style.background = lit ? col : 'rgba(140,160,220,0.05)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
    dbEl.style.color = dbVal > -1 ? '#ff5050' : dbVal > -6 ? '#c0a0e0' : 'rgba(140,160,200,0.4)';
    dbEl.firstChild.textContent = display;
  }
}

// ─── Presets ────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'VOCAL WRAP PLATE',        focus: 0.6,  wrap: 0.7,  separation: 0.5,  size: 0.35, tone: 0.55, mix: 0.25, output: 0.5,  smooth: 0 },
  { name: 'CLEAR HALL VOCAL',        focus: 0.75, wrap: 0.5,  separation: 0.6,  size: 0.65, tone: 0.5,  mix: 0.3,  output: 0.48, smooth: 0 },
  { name: 'SNARE AROUND THE HIT',    focus: 0.8,  wrap: 0.4,  separation: 0.7,  size: 0.3,  tone: 0.6,  mix: 0.2,  output: 0.52, smooth: 0 },
  { name: 'PIANO SPACE WITHOUT BLUR', focus: 0.7,  wrap: 0.6,  separation: 0.45, size: 0.55, tone: 0.45, mix: 0.35, output: 0.5,  smooth: 0 },
];

// ─── Main Focus Reverb Orb ─────────────────────────────────────────────────
export default function FocusReverbOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,   setInputGain]   = useState(initialState?.inputGain   ?? 1);
  const [outputGain,  setOutputGain]  = useState(initialState?.outputGain  ?? 1);
  const [focus,       setFocus]       = useState(initialState?.focus       ?? 0.5);
  const [wrap,        setWrap]        = useState(initialState?.wrap        ?? 0.5);
  const [separation,  setSeparation]  = useState(initialState?.separation  ?? 0.5);
  const [size,        setSize]        = useState(initialState?.size        ?? 0.5);
  const [tone,        setTone]        = useState(initialState?.tone        ?? 0.5);
  const [mix,         setMix]         = useState(initialState?.mix         ?? 0.3);
  const [outputLevel, setOutputLevel] = useState(initialState?.outputLevel ?? 0.5);
  const [bypassed,    setBypassed]    = useState(initialState?.bypassed    ?? false);
  const [smooth,      setSmooth]      = useState(initialState?.smooth      ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset   ?? null);
  const [peakLevel,   setPeakLevel]   = useState(0);
  const [srcActivity, setSrcActivity] = useState(0);
  const [reverbLevel, setReverbLevel] = useState(0);

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, focus, wrap, separation, size, tone, mix, outputLevel, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createFocusReverbEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setFocus(s.focus); eng.setWrap(s.wrap); eng.setSeparation(s.separation);
      eng.setSize(s.size); eng.setTone(s.tone); eng.setMix(s.mix);
      eng.setOutput(s.outputLevel); eng.setBypass(s.bypassed); eng.setSmooth(s.smooth);
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

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setPeakLevel(engineRef.current.getInputPeak());
        setSrcActivity(engineRef.current.getSrcActivity());
        setReverbLevel(engineRef.current.getReverbLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, focus, wrap, separation, size, tone, mix, outputLevel, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, focus, wrap, separation, size, tone, mix, outputLevel, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setFocus(p.focus); setWrap(p.wrap); setSeparation(p.separation);
    setSize(p.size); setTone(p.tone); setMix(p.mix);
    setOutputLevel(p.output); setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    const e = engineRef.current;
    if (e) {
      e.setFocus(p.focus); e.setWrap(p.wrap); e.setSeparation(p.separation);
      e.setSize(p.size); e.setTone(p.tone); e.setMix(p.mix); e.setOutput(p.output);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outFmt = v => { const db = -18 + v * 36; return `${db >= 0 ? '+' : ''}${db.toFixed(1)}dB`; };

  const presetColors = {
    bg: '#0a0c1a', text: '#b0c0e0', textDim: 'rgba(160,180,220,0.5)',
    border: 'rgba(140,160,200,0.15)', hoverBg: 'rgba(140,160,220,0.1)', activeBg: 'rgba(140,160,220,0.06)',
  };

  return (
    <div style={{
      width: 380, borderRadius: 6, position: 'relative',
      background: 'linear-gradient(170deg, #0e1020 0%, #0a0c1a 35%, #060810 70%, #040610 100%)',
      border: '1.5px solid rgba(140,160,210,0.12)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 20px rgba(100,130,200,0.06), inset 0 1px 0 rgba(180,200,240,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(140,160,210,0.08)',
        background: 'linear-gradient(180deg, rgba(100,130,200,0.03) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{
              fontSize: 14, fontWeight: 900, letterSpacing: '0.06em',
              background: 'linear-gradient(135deg, #c0d0f0, #e0e8ff, #a0b8e0)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 6px rgba(140,160,220,0.25))',
            }}>FOCUS</span>
            <span style={{
              fontSize: 8, fontWeight: 800, color: 'rgba(160,180,220,0.35)',
              letterSpacing: '0.04em',
            }}>REVERB</span>
          </div>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(150,170,200,0.3)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>CLARITY PRESERVING</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(140,160,200,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; }}
          >&times;</span>}
        </div>
      </div>

      {/* Visual */}
      <div style={{ borderBottom: '1px solid rgba(140,160,210,0.06)' }}>
        <FocusLensCanvas focus={focus} wrap={wrap} separation={separation} size={size}
          tone={tone} mix={mix} peakLevel={peakLevel} srcActivity={srcActivity} reverbLevel={reverbLevel} />
      </div>

      {/* Meters */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(140,160,210,0.06)',
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeter meterRef={inMeterRef} />
        <DbReadout dbRef={inDbRef} />
        <div style={{ width: 6 }} />
        <DbReadout dbRef={outDbRef} />
        <LedMeter meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs Row 1: FOCUS, WRAP, SEPARATION */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(140,160,210,0.05)',
      }}>
        <Knob label="FOCUS" value={focus} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setFocus(v); engineRef.current?.setFocus(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="WRAP" value={wrap} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setWrap(v); engineRef.current?.setWrap(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="SEPARATION" value={separation} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setSeparation(v); engineRef.current?.setSeparation(v); setActivePreset(null); }} format={pctFmt} />
      </div>

      {/* Knobs Row 2: SIZE, TONE, MIX, OUTPUT */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(140,160,210,0.05)',
      }}>
        <Knob label="SIZE" value={size} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setSize(v); engineRef.current?.setSize(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="TONE" value={tone} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }}
          format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'NEUTRAL'} />
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={0.3} size={28}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="OUTPUT" value={outputLevel} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setOutputLevel(v); engineRef.current?.setOutput(v); setActivePreset(null); }} format={outFmt} />
      </div>

      {/* Bypass + status */}
      <div style={{ padding: '5px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Source activity indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: srcActivity > 0.15 ? '#e0d8c0' : 'rgba(200,190,170,0.15)',
              boxShadow: srcActivity > 0.15 ? '0 0 6px rgba(220,210,180,0.4)' : 'none',
            }} />
            <span style={{ fontSize: 5, color: 'rgba(180,190,210,0.3)', fontWeight: 600, letterSpacing: '0.08em' }}>SRC</span>
          </div>
          {/* Reverb activity indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: reverbLevel > 0.02 ? '#90a8d0' : 'rgba(140,160,200,0.15)',
              boxShadow: reverbLevel > 0.02 ? '0 0 6px rgba(140,160,220,0.4)' : 'none',
            }} />
            <span style={{ fontSize: 5, color: 'rgba(180,190,210,0.3)', fontWeight: 600, letterSpacing: '0.08em' }}>REV</span>
          </div>
        </div>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
          style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(140,160,220,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(180,200,255,0.95)' : 'rgba(140,160,200,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(140,160,220,0.45)' : 'rgba(80,100,160,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(140,160,220,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s', marginRight: 6,
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
          style={{
            fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
            padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
            background: bypassed ? 'rgba(40,45,60,0.5)' : 'rgba(140,160,220,0.1)',
            color: bypassed ? 'rgba(140,150,170,0.3)' : '#b0c0e0',
            border: `1px solid ${bypassed ? 'rgba(80,85,100,0.2)' : 'rgba(140,160,220,0.2)'}`,
            boxShadow: bypassed ? 'none' : '0 0 8px rgba(140,160,220,0.08)',
          }}>
          {bypassed ? 'BYPASSED' : 'FOCUSED'}
        </button>
      </div>
    </div>
  );
}
