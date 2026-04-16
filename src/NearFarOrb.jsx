import { useState, useEffect, useRef, useCallback } from 'react';
import { createNearFarEngine } from './nearfarEngine';
import PresetSelector from './PresetSelector';

// ─── NEARFAR: Depth/Distance Landscape ───────────────────────────────────────
// Horizon line with sound source moving foreground to background.
// Atmospheric haze increases with distance. Room shows walls/boundaries.
// Warm near (amber/orange) fading to cool far (blue/grey fog).

// ─── Distance Landscape Canvas ───────────────────────────────────────────────
function DistanceLandscape({ distance, room, focus, airLoss, tail, peakLevel = 0, bypassed }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const valRef = useRef({ distance: 0.3, room: 0.4, focus: 0.6, airLoss: 0.5, tail: 0.4, peakLevel: 0, bypassed: false });

  valRef.current = { distance, room, focus, airLoss, tail, peakLevel, bypassed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 316, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Mountain layer data (5 parallax layers, near=index 0, far=index 4)
    var mountains = [];
    for (var layer = 0; layer < 5; layer++) {
      var peaks = [];
      var numPeaks = 6 + layer * 2;
      for (var p = 0; p <= numPeaks; p++) {
        peaks.push({
          x: (p / numPeaks) * (W + 40) - 20,
          height: 15 + Math.random() * 30 + layer * 8,
          sharpness: 0.3 + Math.random() * 0.7,
        });
      }
      mountains.push({ peaks: peaks, scrollSpeed: 0.3 + (4 - layer) * 0.4 });
    }

    // Dust particles at various depths
    var dustParticles = [];
    for (var i = 0; i < 80; i++) {
      var depth = Math.random();
      dustParticles.push({
        x: Math.random() * W, y: 30 + Math.random() * (H - 50),
        depth: depth,
        size: 0.5 + (1 - depth) * 3.5,
        vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.15,
        phase: Math.random() * Math.PI * 2,
        twinkle: Math.random() * Math.PI * 2,
        twinkleRate: 1 + Math.random() * 3,
      });
    }

    var raf;
    var draw = function(t) {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.004;
      var phase = phaseRef.current;

      var v = valRef.current;
      var _dist = v.distance, _room = v.room, _focus = v.focus, _air = v.airLoss, _tail = v.tail, _peak = v.peakLevel, _bypassed = v.bypassed;
      var peak = _peak || 0;
      var dimFactor = _bypassed ? 0.18 : (0.5 + peak * 0.5);

      var horizonY = H * 0.38;

      // ── Sky: warm sunset near, cool deep blue far ──
      var skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY + 20);
      var warmAmt = 1 - _dist;
      var skyR1 = Math.round(15 + warmAmt * 50);
      var skyG1 = Math.round(8 + warmAmt * 20);
      var skyB1 = Math.round(30 + _dist * 40);
      skyGrad.addColorStop(0, 'rgba(' + skyR1 + ',' + skyG1 + ',' + skyB1 + ',1)');
      var skyR2 = Math.round(25 + warmAmt * 60);
      var skyG2 = Math.round(15 + warmAmt * 30);
      var skyB2 = Math.round(20 + _dist * 30);
      skyGrad.addColorStop(0.5, 'rgba(' + skyR2 + ',' + skyG2 + ',' + skyB2 + ',1)');
      skyGrad.addColorStop(1, 'rgba(20,18,30,1)');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, horizonY + 20);

      // ── Sun/Moon light source ──
      var sunX = W * 0.7 - _dist * W * 0.2;
      var sunY = 30 + _dist * 30;
      var sunSize = 20 - _dist * 10;
      // Sun hue: warm amber near, cool blue-white far
      var sunHue = 30 + _dist * 180;
      var sunSat = 80 - _dist * 30;
      var sunBright = 75 + peak * 15;
      var sunAlpha = (0.6 + peak * 0.4) * dimFactor;
      // Large glow
      var sunGlowR = sunSize * 5;
      var sunGlowGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunGlowR);
      sunGlowGrad.addColorStop(0, 'hsla(' + sunHue + ', ' + sunSat + '%, ' + sunBright + '%, ' + (sunAlpha * 0.5) + ')');
      sunGlowGrad.addColorStop(0.3, 'hsla(' + sunHue + ', ' + (sunSat - 10) + '%, ' + (sunBright - 10) + '%, ' + (sunAlpha * 0.15) + ')');
      sunGlowGrad.addColorStop(1, 'hsla(' + sunHue + ', ' + sunSat + '%, ' + sunBright + '%, 0)');
      ctx.fillStyle = sunGlowGrad;
      ctx.fillRect(sunX - sunGlowR, sunY - sunGlowR, sunGlowR * 2, sunGlowR * 2);
      // Sun body
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunSize, 0, Math.PI * 2);
      var sunBodyGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunSize);
      sunBodyGrad.addColorStop(0, 'hsla(' + sunHue + ', ' + sunSat + '%, 90%, ' + (sunAlpha * 0.9) + ')');
      sunBodyGrad.addColorStop(0.6, 'hsla(' + sunHue + ', ' + sunSat + '%, ' + sunBright + '%, ' + (sunAlpha * 0.6) + ')');
      sunBodyGrad.addColorStop(1, 'hsla(' + sunHue + ', ' + sunSat + '%, ' + sunBright + '%, 0)');
      ctx.fillStyle = sunBodyGrad;
      ctx.fill();
      // Sun rays
      for (var ray = 0; ray < 8; ray++) {
        var rayAngle = (ray / 8) * Math.PI * 2 + phase * 0.2;
        var rayLen = sunSize * (1.5 + Math.sin(phase * 2 + ray) * 0.5 + peak * 1.5);
        ctx.beginPath();
        ctx.moveTo(sunX, sunY);
        ctx.lineTo(sunX + Math.cos(rayAngle) * rayLen, sunY + Math.sin(rayAngle) * rayLen);
        ctx.strokeStyle = 'hsla(' + sunHue + ', ' + sunSat + '%, ' + sunBright + '%, ' + (sunAlpha * 0.2) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // ── Ground gradient ──
      var gndGrad = ctx.createLinearGradient(0, horizonY, 0, H);
      var gndR1 = Math.round(35 + warmAmt * 30);
      var gndG1 = Math.round(25 + warmAmt * 15);
      var gndB1 = Math.round(15 + _dist * 15);
      gndGrad.addColorStop(0, 'rgba(' + gndR1 + ',' + gndG1 + ',' + gndB1 + ',1)');
      gndGrad.addColorStop(1, 'rgba(12,10,8,1)');
      ctx.fillStyle = gndGrad;
      ctx.fillRect(0, horizonY, W, H - horizonY);

      // ── Mountain silhouettes (far to near, 5 parallax layers) ──
      for (var ml = 4; ml >= 0; ml--) {
        var mtn = mountains[ml];
        var layerDist = ml / 4; // 0=near, 1=far
        var visibleDist = Math.abs(layerDist - _dist);
        // Scroll offset based on distance
        var scrollOffset = _dist * mtn.scrollSpeed * 60 + phase * mtn.scrollSpeed * 2;

        // Color: near=warm, far=cool
        var mtnHue = 25 + layerDist * 200;
        var mtnSat = 50 - layerDist * 20 - _air * layerDist * 20;
        var mtnLight = 25 + (1 - layerDist) * 20 - _air * layerDist * 15;
        var mtnAlpha = (0.5 + (1 - layerDist) * 0.5) * dimFactor;
        // Air loss dims far layers
        if (layerDist > 0.5) {
          mtnAlpha *= 1 - _air * (layerDist - 0.5) * 0.8;
        }

        var mtnBaseY = horizonY + 5 + ml * 8;
        ctx.beginPath();
        ctx.moveTo(-5, mtnBaseY);
        for (var mx = -5; mx <= W + 5; mx += 3) {
          var mIdx = Math.floor(((mx + scrollOffset) % (W + 40) + W + 40) % (W + 40) / ((W + 40) / mtn.peaks.length));
          mIdx = Math.min(mIdx, mtn.peaks.length - 1);
          var mp = mtn.peaks[mIdx];
          var nextIdx = Math.min(mIdx + 1, mtn.peaks.length - 1);
          var np = mtn.peaks[nextIdx];
          var mt = ((mx + scrollOffset) % ((W + 40) / mtn.peaks.length)) / ((W + 40) / mtn.peaks.length);
          var mHeight = mp.height + (np.height - mp.height) * mt;
          var peakWobble = Math.sin(mx * 0.05 + phase * 0.5 + ml * 2) * 3;
          ctx.lineTo(mx, mtnBaseY - mHeight - peakWobble);
        }
        ctx.lineTo(W + 5, mtnBaseY + 20);
        ctx.lineTo(-5, mtnBaseY + 20);
        ctx.closePath();
        ctx.fillStyle = 'hsla(' + mtnHue + ', ' + mtnSat + '%, ' + mtnLight + '%, ' + mtnAlpha + ')';
        ctx.fill();
        // Mountain edge highlight
        ctx.strokeStyle = 'hsla(' + mtnHue + ', ' + (mtnSat + 20) + '%, ' + (mtnLight + 20) + '%, ' + (mtnAlpha * 0.4) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Room reflections (visible reflection lines on walls) ──
      if (_room > 0.1) {
        var wallAlpha = _room * 0.35 * dimFactor;
        var wallInset = 8 + (1 - _room) * 50;
        // Left wall with reflection streaks
        ctx.beginPath();
        ctx.moveTo(wallInset, horizonY);
        ctx.lineTo(0, H);
        ctx.strokeStyle = 'rgba(220,180,120,' + wallAlpha + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Reflection lines on left wall
        for (var rl = 0; rl < 5; rl++) {
          var rlT = 0.15 + rl * 0.18;
          var rlx1 = wallInset * (1 - rlT);
          var rly1 = horizonY + (H - horizonY) * rlT;
          ctx.beginPath();
          ctx.moveTo(rlx1, rly1);
          ctx.lineTo(rlx1 - 3, rly1 + 15);
          ctx.strokeStyle = 'rgba(255,220,150,' + (wallAlpha * 0.4 * (1 - rl * 0.15)) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Right wall
        ctx.beginPath();
        ctx.moveTo(W - wallInset, horizonY);
        ctx.lineTo(W, H);
        ctx.strokeStyle = 'rgba(220,180,120,' + wallAlpha + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
        for (var rl = 0; rl < 5; rl++) {
          var rlT = 0.15 + rl * 0.18;
          var rlx1 = W - wallInset * (1 - rlT);
          var rly1 = horizonY + (H - horizonY) * rlT;
          ctx.beginPath();
          ctx.moveTo(rlx1, rly1);
          ctx.lineTo(rlx1 + 3, rly1 + 15);
          ctx.strokeStyle = 'rgba(255,220,150,' + (wallAlpha * 0.4 * (1 - rl * 0.15)) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Ceiling
        ctx.beginPath();
        ctx.moveTo(wallInset, horizonY);
        ctx.lineTo(W - wallInset, horizonY);
        ctx.strokeStyle = 'rgba(220,180,120,' + (wallAlpha * 0.6) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Perspective grid on ground ──
      var vpX = W / 2;
      var vpY = horizonY;
      for (var gi = -5; gi <= 5; gi++) {
        ctx.beginPath();
        ctx.moveTo(vpX, vpY);
        ctx.lineTo(vpX + gi * 120, H);
        ctx.strokeStyle = 'rgba(180,140,80,' + (0.08 * dimFactor) + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      for (var d = 0; d < 8; d++) {
        var dt = (d + 1) / 9;
        var dy = vpY + (H - vpY) * dt;
        ctx.beginPath();
        ctx.moveTo(0, dy);
        ctx.lineTo(W, dy);
        ctx.strokeStyle = 'rgba(180,140,80,' + (0.06 * dimFactor * (1 - dt)) + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── Sound source (moves with distance) ──
      var sourceT = _dist;
      var sourceY = horizonY + (H - horizonY) * (1 - sourceT * 0.85);
      var sourceX = W / 2 + Math.sin(phase * 0.5) * (3 + _dist * 6);
      var sourceSize = 14 * (1 - sourceT * 0.7);
      var perspScale = 1 - sourceT * 0.6;
      var srcHue = 30 + _dist * 180;
      var srcSat = 70 + (1 - _dist) * 25;
      var srcLight = 55 + peak * 25;
      var srcAlpha = (0.5 + peak * 0.5 + _focus * 0.2) * dimFactor;

      // Focus spotlight effect
      if (_focus > 0.1) {
        var focusR = 30 + (1 - _focus) * 40;
        var focusGrad = ctx.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, focusR);
        focusGrad.addColorStop(0, 'rgba(255,240,200,' + (_focus * 0.15 * dimFactor) + ')');
        focusGrad.addColorStop(0.5, 'rgba(255,200,100,' + (_focus * 0.05 * dimFactor) + ')');
        focusGrad.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = focusGrad;
        ctx.fillRect(sourceX - focusR, sourceY - focusR, focusR * 2, focusR * 2);
      }

      // Source outer glow
      var glowR = sourceSize * (2.5 + peak * 4) * perspScale;
      var glowGrad = ctx.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, glowR);
      glowGrad.addColorStop(0, 'hsla(' + srcHue + ', ' + srcSat + '%, ' + srcLight + '%, ' + (srcAlpha * 0.6) + ')');
      glowGrad.addColorStop(0.4, 'hsla(' + srcHue + ', ' + srcSat + '%, ' + srcLight + '%, ' + (srcAlpha * 0.15) + ')');
      glowGrad.addColorStop(1, 'hsla(' + srcHue + ', ' + srcSat + '%, ' + srcLight + '%, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(sourceX - glowR, sourceY - glowR, glowR * 2, glowR * 2);

      // Source body: pulsing orb with rings
      for (var ring = 4; ring >= 0; ring--) {
        var rr = sourceSize * perspScale * (0.2 + ring * 0.22);
        var pulse = 1 + Math.sin(phase * 3 + ring) * 0.1 * peak;
        ctx.beginPath();
        ctx.arc(sourceX, sourceY, rr * pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + srcHue + ', ' + srcSat + '%, ' + (srcLight - ring * 8) + '%, ' + (srcAlpha * (0.25 + (4 - ring) * 0.15)) + ')';
        ctx.fill();
      }
      // White-hot center
      ctx.beginPath();
      ctx.arc(sourceX, sourceY, sourceSize * perspScale * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,240,' + (srcAlpha * 0.8) + ')';
      ctx.fill();

      // ── Reverb tail rings ──
      if (_tail > 0.1) {
        for (var ri = 0; ri < 6; ri++) {
          var ringAge = (phase * 2 + ri * 0.6) % 4;
          var ringRadius = ringAge * 20 * perspScale;
          var ringAlpha = Math.max(0, (1 - ringAge / 4)) * _tail * 0.25 * dimFactor * (0.3 + peak * 0.7);
          if (ringAlpha < 0.005) continue;
          ctx.beginPath();
          ctx.ellipse(sourceX, sourceY, ringRadius * 1.8, ringRadius * 0.4, 0, 0, Math.PI * 2);
          ctx.strokeStyle = 'hsla(' + (srcHue + 25) + ', 50%, 65%, ' + ringAlpha + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // ── Atmospheric haze (distance + air loss) ──
      var hazeAmt = _dist * 0.5 + _air * 0.5;
      if (hazeAmt > 0.05) {
        // Layered fog
        for (var f = 0; f < 8; f++) {
          var fogY = horizonY - 25 + f * 12 + Math.sin(phase * 0.25 + f * 1.5) * 6;
          var fogH = 25 + f * 8;
          var fogAlpha = hazeAmt * 0.08 * dimFactor * (1 - f * 0.1);
          // Cool-tinted fog
          var fogR = Math.round(120 + _dist * 30);
          var fogG = Math.round(130 + _dist * 20);
          var fogB = Math.round(160 + _dist * 30);
          ctx.fillStyle = 'rgba(' + fogR + ',' + fogG + ',' + fogB + ',' + fogAlpha + ')';
          ctx.fillRect(0, fogY, W, fogH);
        }
      }

      // ── Dust particles with depth-based sizing ──
      for (var di = 0; di < dustParticles.length; di++) {
        var dp = dustParticles[di];
        dp.x += dp.vx + Math.sin(phase * 0.5 + dp.phase) * 0.15;
        dp.y += dp.vy + Math.cos(phase * 0.3 + dp.phase) * 0.1;
        dp.twinkle += dp.twinkleRate * 0.02;
        if (dp.x < -5) dp.x = W + 5;
        if (dp.x > W + 5) dp.x = -5;
        if (dp.y < 20) dp.y = H - 10;
        if (dp.y > H) dp.y = 25;

        // Only show particles near the current distance setting
        var depthDiff = Math.abs(dp.depth - _dist);
        var depthVisibility = Math.max(0, 1 - depthDiff * 2);
        if (depthVisibility < 0.05) continue;

        var twinkle = 0.4 + 0.6 * ((Math.sin(dp.twinkle) + 1) * 0.5);
        var dpSize = dp.size * (1 - dp.depth * 0.6);
        var dpAlpha = twinkle * dimFactor * depthVisibility * 0.7;

        // Color: warm near, cool far
        var dpHue = 30 + dp.depth * 200;
        // Glow
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dpSize * 3, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + dpHue + ', 60%, 70%, ' + (dpAlpha * 0.15) + ')';
        ctx.fill();
        // Core
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dpSize * twinkle, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + dpHue + ', 70%, 80%, ' + dpAlpha + ')';
        ctx.fill();
      }

      // ── Title ──
      ctx.save();
      ctx.font = '600 8px system-ui, -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      var titleHue = 30 + _dist * 180;
      ctx.fillStyle = 'hsla(' + titleHue + ', 60%, 70%, ' + (0.6 * dimFactor) + ')';
      ctx.fillText('NEARFAR', W / 2, 16);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return function() { cancelAnimationFrame(raf); };
  }, []);

  return <canvas ref={canvasRef} style={{ width: 316, height: 160, display: 'block' }} />;
}

// ─── Simple Arc Knob ─────────────────────────────────────────────────────────
function ArcKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  const hue = Math.round(35 + norm * 185);
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,14,20,0.9)"
        stroke="rgba(120,140,180,0.08)" strokeWidth="1.5" />
      {/* Filled arc */}
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={`hsla(${hue},65%,55%,0.7)`}
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      {/* Indicator dot */}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill={`hsla(${hue},80%,70%,0.9)`} />
      <circle cx={dotX} cy={dotY} r="4"
        fill={`hsla(${hue},80%,70%,0.12)`} />
      {/* Center */}
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 26, format, sensitivity = 120 }) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  const showLabel = hovered || dragging;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size + 2, cursor: dragging ? 'grabbing' : 'grab' }}>
        <ArcKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 7, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(200,150,90,0.65)', fontWeight: 700, textAlign: 'center',
        fontFamily: 'system-ui', lineHeight: 1, marginTop: 2,
      }}>{label}</span>
      <span style={{
        fontSize: 6, color: 'rgba(180,130,70,0.45)', fontFamily: '"Courier New",monospace',
        fontWeight: 600, textAlign: 'center',
      }}>{display}</span>
    </div>
  );
}

function HSlider({ value, onChange, label, min = 0, max = 1, defaultValue, format }) {
  const ref = useRef({ x: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { x: e.clientX, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ev.clientX - ref.current.x) * (max - min) / 120)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none', height: 14 }}>
      <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(180,130,70,0.4)', width: 38, textAlign: 'right', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ flex: 1, height: 3, background: 'rgba(160,120,60,0.06)', borderRadius: 2, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${norm * 100}%`, background: 'rgba(200,150,70,0.15)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: '50%', left: `${norm * 100}%`, transform: 'translate(-50%, -50%)', width: 7, height: 7, borderRadius: '50%', background: 'rgba(220,170,90,0.5)', boxShadow: '0 0 4px rgba(200,140,60,0.3)' }} />
      </div>
      <span style={{ fontSize: 7, color: 'rgba(180,130,70,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600, width: 26, textAlign: 'left', flexShrink: 0 }}>{display}</span>
    </div>
  );
}

function BypassDot({ active, onClick }) {
  return (
    <div onClick={onClick} title={active ? 'Active' : 'Bypassed'}
      style={{ cursor: 'pointer', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: active ? 'radial-gradient(circle at 35% 35%, rgba(240,200,130,0.9), rgba(200,140,60,0.6))' : 'rgba(50,40,25,0.3)',
        boxShadow: active ? '0 0 8px rgba(220,160,60,0.4)' : 'none',
        transition: 'all 0.3s ease',
      }} />
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',             distance: 0.3, room: 0.4, focus: 0.6, airLoss: 0.5, tail: 0.4, mix: 1.0, smooth: 0 },
  { name: 'PUSH BACK VOCAL', distance: 0.45, room: 0.35, focus: 0.7, airLoss: 0.4, tail: 0.35, mix: 0.8, smooth: 0 },
  { name: 'FRONT MID SNARE', distance: 0.2, room: 0.5, focus: 0.8, airLoss: 0.3, tail: 0.3, mix: 0.7, smooth: 0 },
  { name: 'BACKGROUND DEPTH', distance: 0.75, room: 0.6, focus: 0.3, airLoss: 0.7, tail: 0.6, mix: 1.0, smooth: 0 },
  { name: 'CINEMATIC DIST',  distance: 0.9, room: 0.8, focus: 0.2, airLoss: 0.85, tail: 0.8, mix: 0.9, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#14100a', text: 'rgba(220,170,100,0.8)', textDim: 'rgba(180,130,70,0.45)',
  border: 'rgba(160,110,50,0.12)', hoverBg: 'rgba(160,110,50,0.08)', activeBg: 'rgba(160,110,50,0.05)',
};

export default function NearFarOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [inputGain, setInputGain] = useState(initialState?.inputGain ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [distance, setDistance] = useState(initialState?.distance ?? 0.3);
  const [room, setRoom] = useState(initialState?.room ?? 0.4);
  const [focus, setFocus] = useState(initialState?.focus ?? 0.6);
  const [airLoss, setAirLoss] = useState(initialState?.airLoss ?? 0.5);
  const [tail, setTail] = useState(initialState?.tail ?? 0.4);
  const [mix, setMix] = useState(initialState?.mix ?? 1.0);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, distance, room, focus, airLoss, tail, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createNearFarEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setDistance(s.distance); eng.setRoom(s.room); eng.setFocus(s.focus);
      eng.setAirLoss(s.airLoss); eng.setTail(s.tail); eng.setMix(s.mix);
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
      if (engineRef.current) setPeakLevel(engineRef.current.getInputPeak());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, distance, room, focus, airLoss, tail, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, distance, room, focus, airLoss, tail, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setDistance(p.distance); setRoom(p.room); setFocus(p.focus);
    setAirLoss(p.airLoss); setTail(p.tail); setMix(p.mix);
    if (p.smooth !== undefined) setSmooth(p.smooth);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setDistance(p.distance); e.setRoom(p.room); e.setFocus(p.focus); e.setAirLoss(p.airLoss); e.setTail(p.tail); e.setMix(p.mix); if (p.smooth !== undefined) e.setSmooth(p.smooth); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 340, borderRadius: 6, position: 'relative',
      background: 'linear-gradient(170deg, #14100a 0%, #100c08 35%, #0c0a06 70%, #0a0808 100%)',
      border: '1.5px solid rgba(200,150,70,0.15)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 25px rgba(200,140,50,0.08), inset 0 1px 0 rgba(220,180,100,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(200,150,70,0.1)',
        background: 'linear-gradient(180deg, rgba(200,140,50,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 15, fontWeight: 900, letterSpacing: '0.1em',
            background: 'linear-gradient(135deg, #d4a040, #8090c0)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(200,140,50,0.3))',
          }}>NEAR / FAR</span>
          <span style={{
            fontSize: 5, fontWeight: 700, color: 'rgba(200,150,90,0.35)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>DISTANCE DESIGNER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(200,150,70,0.4)' }}>...</span>}
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
      <div style={{ borderBottom: '1px solid rgba(200,150,70,0.08)' }}>
        <DistanceLandscape distance={distance} room={room} focus={focus} airLoss={airLoss} tail={tail} peakLevel={peakLevel} bypassed={bypassed} />
      </div>

      {/* I/O */}
      <div style={{
        padding: '6px 12px', display: 'flex', gap: 12,
        borderBottom: '1px solid rgba(200,150,70,0.08)',
      }}>
        <div style={{ flex: 1 }}>
          <HSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} format={dbFmt}
            onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
        </div>
        <div style={{ flex: 1 }}>
          <HSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} format={dbFmt}
            onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Knobs Row 1: DISTANCE (big), ROOM, FOCUS */}
      <div style={{
        padding: '8px 8px 4px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(200,150,70,0.06)',
      }}>
        <Knob label="DISTANCE" value={distance} defaultValue={0.3} size={34}
          format={v => v < 0.25 ? 'NEAR' : v > 0.75 ? 'FAR' : 'MID'}
          onChange={v => { setDistance(v); engineRef.current?.setDistance(v); setActivePreset(null); }} />
        <Knob label="ROOM" value={room} defaultValue={0.4} size={30} format={pctFmt}
          onChange={v => { setRoom(v); engineRef.current?.setRoom(v); setActivePreset(null); }} />
        <Knob label="FOCUS" value={focus} defaultValue={0.6} size={30} format={pctFmt}
          onChange={v => { setFocus(v); engineRef.current?.setFocus(v); setActivePreset(null); }} />
      </div>

      {/* Knobs Row 2: AIR LOSS, TAIL, MIX */}
      <div style={{
        padding: '4px 8px 8px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(200,150,70,0.06)',
      }}>
        <Knob label="AIR LOSS" value={airLoss} defaultValue={0.5} size={30} format={pctFmt}
          onChange={v => { setAirLoss(v); engineRef.current?.setAirLoss(v); setActivePreset(null); }} />
        <Knob label="TAIL" value={tail} defaultValue={0.4} size={30} format={pctFmt}
          onChange={v => { setTail(v); engineRef.current?.setTail(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1.0} size={30} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bypass footer */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <BypassDot active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }} style={{
            fontSize: 6, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(200,150,70,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(240,200,120,0.95)' : 'rgba(160,120,60,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(200,150,70,0.45)' : 'rgba(120,90,40,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(200,150,70,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.15em',
            color: bypassed ? 'rgba(200,120,40,0.5)' : 'rgba(120,200,140,0.5)',
            fontFamily: 'system-ui',
          }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</span>
        </div>
      </div>
    </div>
  );
}
