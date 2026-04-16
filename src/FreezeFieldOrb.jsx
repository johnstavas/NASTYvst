import { useState, useEffect, useRef, useCallback } from 'react';
import { createFreezeFieldEngine } from './freezefieldEngine';
import PresetSelector from './PresetSelector';

// ─── FREEZEFIELD: Frozen Crystal Ice Cave ────────────────────────────────────
// Crystalline structures grow when frozen, ice particles shimmer, cold blue/white.
// Smear blurs crystals, drift sways them. Unfrozen shows flowing water/mist.

// ─── Ice Cave Canvas ─────────────────────────────────────────────────────────
function IceCaveCanvas({ freeze, smear, drift, shape, width, peakLevel = 0, bypassed }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const crystalsRef = useRef(null);
  const particlesRef = useRef(null);
  const valRef = useRef({ freeze: 0, smear: 0, drift: 0, shape: 0, width: 0, peakLevel: 0, bypassed: false });

  valRef.current = { freeze, smear, drift, shape, width, peakLevel, bypassed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 280;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize crystals growing from ALL edges toward center
    if (!crystalsRef.current) {
      var crysts = [];
      for (var i = 0; i < 30; i++) {
        var edge = Math.floor(Math.random() * 4);
        var sx, sy, baseAngle;
        if (edge === 0) { sx = Math.random() * W; sy = 0; baseAngle = Math.PI / 2 + (Math.random() - 0.5) * 0.6; }
        else if (edge === 1) { sx = Math.random() * W; sy = H; baseAngle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6; }
        else if (edge === 2) { sx = 0; sy = 40 + Math.random() * (H - 80); baseAngle = (Math.random() - 0.5) * 0.6; }
        else { sx = W; sy = 40 + Math.random() * (H - 80); baseAngle = Math.PI + (Math.random() - 0.5) * 0.6; }
        crysts.push({
          x: sx, y: sy, baseAngle: baseAngle,
          length: 25 + Math.random() * 70,
          thickness: 1.5 + Math.random() * 4,
          branches: Math.floor(2 + Math.random() * 4),
          branchAngle: 0.3 + Math.random() * 0.6,
          branchLen: 0.3 + Math.random() * 0.5,
          hue: 190 + Math.random() * 40,
          growPhase: Math.random() * Math.PI * 2,
          growSpeed: 0.5 + Math.random() * 2,
          subBranches: Math.floor(1 + Math.random() * 3),
        });
      }
      crystalsRef.current = crysts;
    }

    // Initialize ice particles with more variety
    if (!particlesRef.current) {
      var parts = [];
      for (var i = 0; i < 90; i++) {
        parts.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.15 + Math.random() * 0.5),
          size: 0.8 + Math.random() * 3,
          sparkle: Math.random() * Math.PI * 2,
          sparkleRate: 1.5 + Math.random() * 4,
          prismatic: Math.random() > 0.6,
          hue: 180 + Math.random() * 60,
          frozenX: Math.random() * W,
          frozenY: Math.random() * H,
        });
      }
      particlesRef.current = parts;
    }

    var frostCoverRef = { value: 0 };
    var crackLinesRef = { lines: [] };
    var prevFrozenRef = { value: false };

    var raf;
    var draw = function(t) {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.006;
      var phase = phaseRef.current;

      var v = valRef.current;
      var _freeze = v.freeze, _smear = v.smear, _drift = v.drift, _shape = v.shape, _width = v.width, _peak = v.peakLevel, _bypassed = v.bypassed;
      var frozen = _freeze > 0.5;
      var peak = _peak || 0;
      var dimFactor = _bypassed ? 0.18 : (0.5 + peak * 0.5);

      // Frost cover target
      var frostTarget = frozen ? 1.0 : 0.0;
      frostCoverRef.value += (frostTarget - frostCoverRef.value) * 0.02;
      var frostCover = frostCoverRef.value;

      // Crack detection on freeze transitions
      if (frozen && !prevFrozenRef.value) {
        for (var c = 0; c < 8; c++) {
          var cx = W * 0.3 + Math.random() * W * 0.4;
          var cy = H * 0.3 + Math.random() * H * 0.4;
          var segs = [];
          var px = cx, py = cy;
          for (var s = 0; s < 5 + Math.floor(Math.random() * 6); s++) {
            var nx = px + (Math.random() - 0.5) * 30;
            var ny = py + (Math.random() - 0.5) * 30;
            segs.push({ x1: px, y1: py, x2: nx, y2: ny });
            px = nx; py = ny;
          }
          crackLinesRef.lines.push({ segs: segs, birth: phase, life: 2 + Math.random() * 2 });
        }
      }
      if (!frozen && prevFrozenRef.value) {
        for (var c = 0; c < 5; c++) {
          var cx = Math.random() * W;
          var cy = Math.random() * H;
          var segs = [];
          var px = cx, py = cy;
          for (var s = 0; s < 4 + Math.floor(Math.random() * 4); s++) {
            var nx = px + (Math.random() - 0.5) * 25;
            var ny = py + (Math.random() - 0.5) * 25;
            segs.push({ x1: px, y1: py, x2: nx, y2: ny });
            px = nx; py = ny;
          }
          crackLinesRef.lines.push({ segs: segs, birth: phase, life: 1.5 + Math.random() });
        }
      }
      prevFrozenRef.value = frozen;

      // ── Background: deep midnight blue with aurora ──
      var bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, 'rgba(5,10,30,1)');
      bgGrad.addColorStop(0.3, 'rgba(8,15,45,1)');
      bgGrad.addColorStop(0.6, 'rgba(4,12,35,1)');
      bgGrad.addColorStop(1, 'rgba(2,6,18,1)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Aurora borealis hints at top ──
      for (var a = 0; a < 5; a++) {
        var auroraX = W * 0.1 + a * W * 0.2;
        var auroraY = 10 + Math.sin(phase * 0.3 + a * 1.3) * 15;
        var auroraW = 40 + Math.sin(phase * 0.5 + a) * 15;
        var auroraH = 30 + Math.sin(phase * 0.7 + a * 0.8) * 10;
        var aHue = (phase * 20 + a * 60) % 360;
        var auroraGrad = ctx.createRadialGradient(auroraX, auroraY, 0, auroraX, auroraY, auroraW);
        auroraGrad.addColorStop(0, 'hsla(' + aHue + ', 80%, 60%, ' + (0.15 * dimFactor * (1 - frostCover * 0.5)) + ')');
        auroraGrad.addColorStop(0.5, 'hsla(' + ((aHue + 30) % 360) + ', 70%, 50%, ' + (0.08 * dimFactor) + ')');
        auroraGrad.addColorStop(1, 'hsla(' + aHue + ', 60%, 40%, 0)');
        ctx.fillStyle = auroraGrad;
        ctx.fillRect(auroraX - auroraW, auroraY - auroraH, auroraW * 2, auroraH * 2);
      }

      // ── Flowing water/mist when NOT frozen ──
      if (!frozen) {
        for (var layer = 0; layer < 6; layer++) {
          ctx.beginPath();
          var baseY = H * 0.25 + layer * H * 0.12;
          ctx.moveTo(0, baseY);
          for (var x = 0; x <= W; x += 2) {
            var wave = Math.sin(x * 0.04 + phase * 2.5 + layer * 1.5) * 10;
            var wave2 = Math.sin(x * 0.08 + phase * 1.8 + layer) * 5;
            ctx.lineTo(x, baseY + wave + wave2);
          }
          ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
          var layerHue = 200 + layer * 8;
          ctx.fillStyle = 'hsla(' + layerHue + ', 70%, 60%, ' + (0.04 * dimFactor * (1 + peak * 3)) + ')';
          ctx.fill();
        }
      }

      // ── Frost spreading across surface (fractal branching) ──
      if (frostCover > 0.02) {
        ctx.save();
        ctx.globalAlpha = frostCover * dimFactor * 0.7;
        for (var fi = 0; fi < 12; fi++) {
          var fx = (fi % 4) * (W / 3) + 15;
          var fy = Math.floor(fi / 4) * (H / 3) + 30;
          var frostSize = 20 + frostCover * 40;
          ctx.strokeStyle = 'rgba(180,220,255,0.5)';
          ctx.lineWidth = 0.8;
          // Fractal frost lines
          for (var fb = 0; fb < 6; fb++) {
            var fAngle = (fb / 6) * Math.PI * 2 + phase * 0.1;
            var fLen = frostSize * (0.5 + 0.5 * Math.sin(phase * 0.5 + fi + fb));
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            var tx = fx + Math.cos(fAngle) * fLen;
            var ty = fy + Math.sin(fAngle) * fLen;
            ctx.lineTo(tx, ty);
            ctx.stroke();
            // Sub-branches
            for (var sb = 0; sb < 3; sb++) {
              var st = 0.3 + sb * 0.25;
              var sx2 = fx + (tx - fx) * st;
              var sy2 = fy + (ty - fy) * st;
              var sbAngle = fAngle + (sb % 2 === 0 ? 0.5 : -0.5);
              var sbLen = fLen * 0.3;
              ctx.beginPath();
              ctx.moveTo(sx2, sy2);
              ctx.lineTo(sx2 + Math.cos(sbAngle) * sbLen, sy2 + Math.sin(sbAngle) * sbLen);
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }

      // ── Crystal structures ──
      var crystals = crystalsRef.current;
      for (var ci = 0; ci < crystals.length; ci++) {
        var cr = crystals[ci];
        var growCycle = 0.5 + 0.5 * Math.sin(phase * cr.growSpeed + cr.growPhase);
        var currentGrow = frozen ? (0.7 + growCycle * 0.3) : (0.1 + peak * 0.5);
        var len = cr.length * currentGrow;

        var sway = _drift * 0.2 * Math.sin(phase * 0.8 + cr.x * 0.03 + cr.y * 0.02);
        var blurAmount = _smear * 4;
        var angle = cr.baseAngle + sway;
        var tipX = cr.x + Math.cos(angle) * len;
        var tipY = cr.y + Math.sin(angle) * len;

        var bright = 50 + _shape * 45;
        var alpha = (0.3 + currentGrow * 0.6) * dimFactor;

        ctx.save();
        if (blurAmount > 0.2) {
          ctx.filter = 'blur(' + blurAmount + 'px)';
        }

        // Wide crystal glow
        ctx.beginPath();
        ctx.moveTo(cr.x, cr.y);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = 'hsla(' + cr.hue + ', 90%, ' + (bright + 15) + '%, ' + (alpha * 0.25) + ')';
        ctx.lineWidth = cr.thickness * 5 + blurAmount * 1.5;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Main crystal shaft (bright)
        ctx.beginPath();
        ctx.moveTo(cr.x, cr.y);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = 'hsla(' + cr.hue + ', 80%, ' + bright + '%, ' + alpha + ')';
        ctx.lineWidth = cr.thickness * (frozen ? 1.8 : 0.6);
        ctx.lineCap = 'round';
        ctx.stroke();

        // Inner bright core
        ctx.beginPath();
        ctx.moveTo(cr.x, cr.y);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = 'rgba(220,240,255,' + (alpha * 0.6) + ')';
        ctx.lineWidth = Math.max(0.5, cr.thickness * 0.4);
        ctx.stroke();

        // Branches with sub-branches
        for (var b = 0; b < cr.branches; b++) {
          var bt = 0.2 + (b / cr.branches) * 0.6;
          var bx = cr.x + (tipX - cr.x) * bt;
          var by = cr.y + (tipY - cr.y) * bt;
          var bAngle1 = angle + cr.branchAngle;
          var bAngle2 = angle - cr.branchAngle;
          var bLen = len * cr.branchLen * (1 - bt * 0.4);
          var bAlpha = alpha * 0.8;

          // Branch A
          var bTipX1 = bx + Math.cos(bAngle1) * bLen;
          var bTipY1 = by + Math.sin(bAngle1) * bLen;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bTipX1, bTipY1);
          ctx.strokeStyle = 'hsla(' + (cr.hue + 15) + ', 70%, ' + bright + '%, ' + bAlpha + ')';
          ctx.lineWidth = cr.thickness * 0.7;
          ctx.stroke();

          // Branch B
          var bTipX2 = bx + Math.cos(bAngle2) * bLen;
          var bTipY2 = by + Math.sin(bAngle2) * bLen;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bTipX2, bTipY2);
          ctx.stroke();

          // Sub-branches
          for (var sb = 0; sb < cr.subBranches; sb++) {
            var sbt = 0.4 + sb * 0.25;
            var sbx = bx + (bTipX1 - bx) * sbt;
            var sby = by + (bTipY1 - by) * sbt;
            var sbA = bAngle1 + (sb % 2 === 0 ? 0.4 : -0.4);
            var sbL = bLen * 0.35;
            ctx.beginPath();
            ctx.moveTo(sbx, sby);
            ctx.lineTo(sbx + Math.cos(sbA) * sbL, sby + Math.sin(sbA) * sbL);
            ctx.strokeStyle = 'hsla(' + (cr.hue + 25) + ', 65%, ' + (bright + 5) + '%, ' + (bAlpha * 0.6) + ')';
            ctx.lineWidth = cr.thickness * 0.35;
            ctx.stroke();
          }

          // Prismatic rainbow sparkle at branch tips
          if (frozen || peak > 0.3) {
            var sparkHue = (phase * 80 + b * 90 + ci * 45) % 360;
            var sparkAlpha = (frozen ? 0.7 : peak) * dimFactor * 0.6;
            ctx.beginPath();
            ctx.arc(bTipX1, bTipY1, 2 + peak * 2, 0, Math.PI * 2);
            ctx.fillStyle = 'hsla(' + sparkHue + ', 100%, 80%, ' + sparkAlpha + ')';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(bTipX1, bTipY1, 5 + peak * 3, 0, Math.PI * 2);
            ctx.fillStyle = 'hsla(' + sparkHue + ', 100%, 80%, ' + (sparkAlpha * 0.2) + ')';
            ctx.fill();
          }
        }

        // Crystal tip prismatic refraction
        if (currentGrow > 0.3) {
          var refractHue = (phase * 60 + ci * 30) % 360;
          var refractAlpha = currentGrow * dimFactor * 0.5;
          ctx.beginPath();
          ctx.arc(tipX, tipY, 3 + peak * 3, 0, Math.PI * 2);
          ctx.fillStyle = 'hsla(' + refractHue + ', 100%, 85%, ' + refractAlpha + ')';
          ctx.fill();
          // Rainbow refraction rays
          for (var ray = 0; ray < 4; ray++) {
            var rayAngle = angle + (ray - 1.5) * 0.4;
            var rayLen = 8 + peak * 10;
            var rayHue = (refractHue + ray * 70) % 360;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX + Math.cos(rayAngle) * rayLen, tipY + Math.sin(rayAngle) * rayLen);
            ctx.strokeStyle = 'hsla(' + rayHue + ', 100%, 75%, ' + (refractAlpha * 0.4) + ')';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      // ── Crack/fracture effects ──
      var cracks = crackLinesRef.lines;
      for (var ci2 = cracks.length - 1; ci2 >= 0; ci2--) {
        var crack = cracks[ci2];
        var age = phase - crack.birth;
        if (age > crack.life) { cracks.splice(ci2, 1); continue; }
        var crackAlpha = (1 - age / crack.life) * dimFactor * 0.9;
        for (var si = 0; si < crack.segs.length; si++) {
          var seg = crack.segs[si];
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.strokeStyle = 'rgba(200,240,255,' + crackAlpha + ')';
          ctx.lineWidth = 2 * (1 - age / crack.life);
          ctx.stroke();
          // Bright glow along crack
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.strokeStyle = 'rgba(150,200,255,' + (crackAlpha * 0.3) + ')';
          ctx.lineWidth = 6 * (1 - age / crack.life);
          ctx.stroke();
        }
      }

      // ── Ice particles ──
      var particles = particlesRef.current;
      var partCount = frozen ? particles.length : Math.floor(30 + peak * 50);
      for (var i = 0; i < Math.min(partCount, particles.length); i++) {
        var p = particles[i];

        if (frozen) {
          // Particles freeze mid-air: slowly drift toward frozen position
          p.x += (p.frozenX - p.x) * 0.01 + _drift * Math.sin(phase * 0.3 + p.sparkle) * 0.15;
          p.y += (p.frozenY - p.y) * 0.01;
        } else {
          p.x += p.vx + _drift * Math.sin(phase + p.sparkle) * 0.5;
          p.y += p.vy;
        }
        p.sparkle += p.sparkleRate * 0.025;

        if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
        if (p.x < -5) p.x = W + 5;
        if (p.x > W + 5) p.x = -5;

        var sparkle = 0.4 + 0.6 * ((Math.sin(p.sparkle) + 1) * 0.5);
        var pAlpha = sparkle * dimFactor * (frozen ? 0.9 : 0.6);

        // Outer glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(140,200,255,' + (pAlpha * 0.12) + ')';
        ctx.fill();

        // Core particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * sparkle, 0, Math.PI * 2);
        if (p.prismatic) {
          var pHue = (phase * 50 + i * 20) % 360;
          ctx.fillStyle = 'hsla(' + pHue + ', 100%, 85%, ' + pAlpha + ')';
        } else {
          ctx.fillStyle = 'rgba(200,235,255,' + pAlpha + ')';
        }
        ctx.fill();

        // Bright center spark
        if (sparkle > 0.8) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + (pAlpha * 0.8) + ')';
          ctx.fill();
        }
      }

      // ── Frozen state: full frost border with ice thickness ──
      if (frozen) {
        var frostAlpha = 0.3 + 0.15 * Math.sin(phase * 1.5);
        // Thick outer frost
        ctx.strokeStyle = 'rgba(140,200,255,' + (frostAlpha * dimFactor * 0.4) + ')';
        ctx.lineWidth = 8;
        var r = 6;
        ctx.beginPath();
        ctx.moveTo(r, 0); ctx.lineTo(W - r, 0); ctx.quadraticCurveTo(W, 0, W, r);
        ctx.lineTo(W, H - r); ctx.quadraticCurveTo(W, H, W - r, H);
        ctx.lineTo(r, H); ctx.quadraticCurveTo(0, H, 0, H - r);
        ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.stroke();
        // Inner bright frost line
        ctx.strokeStyle = 'rgba(200,235,255,' + (frostAlpha * dimFactor * 0.7) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Corner ice buildup
        var corners = [[0, 0], [W, 0], [0, H], [W, H]];
        for (var co = 0; co < corners.length; co++) {
          var corner = corners[co];
          var iceGrad = ctx.createRadialGradient(corner[0], corner[1], 0, corner[0], corner[1], 35);
          iceGrad.addColorStop(0, 'rgba(180,220,255,' + (0.2 * dimFactor) + ')');
          iceGrad.addColorStop(0.5, 'rgba(120,180,240,' + (0.08 * dimFactor) + ')');
          iceGrad.addColorStop(1, 'rgba(80,140,220,0)');
          ctx.fillStyle = iceGrad;
          ctx.fillRect(corner[0] - 35, corner[1] - 35, 70, 70);
        }
      }

      // ── Title text ──
      ctx.save();
      ctx.font = '600 8px system-ui, -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      var titleAlpha = frozen ? 0.8 * dimFactor : 0.5 * dimFactor;
      ctx.fillStyle = frozen
        ? 'rgba(180,225,255,' + titleAlpha + ')'
        : 'rgba(120,180,240,' + titleAlpha + ')';
      ctx.fillText('FREEZEFIELD', W / 2, 16);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return function() { cancelAnimationFrame(raf); };
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 280, display: 'block' }} />;
}

// ─── Hex Crystal Knob ────────────────────────────────────────────────────────
function CrystalKnob({ size = 26, norm = 0 }) {
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
          stroke="hsla(190,65%,55%,0.7)"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill="hsla(190,80%,70%,0.9)" />
      <circle cx={dotX} cy={dotY} r="4"
        fill="hsla(190,80%,70%,0.12)" />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
    </svg>
  );
}

// ─── Knob Component ──────────────────────────────────────────────────────────
function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format, sensitivity = 120 }) {
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
        <CrystalKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(120,180,220,0.6)', fontWeight: 600, textAlign: 'center',
        fontFamily: 'system-ui', lineHeight: 1, marginTop: 1,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(100,160,200,0.4)', fontFamily: '"Courier New",monospace',
        fontWeight: 600, textAlign: 'center',
      }}>{display}</span>
    </div>
  );
}

// ─── Freeze Toggle Button ────────────────────────────────────────────────────
function FreezeButton({ frozen, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer', padding: '3px 10px', borderRadius: 3,
      background: frozen ? 'rgba(100,180,255,0.15)' : 'rgba(40,60,90,0.2)',
      border: `1px solid ${frozen ? 'rgba(140,200,255,0.4)' : 'rgba(80,120,160,0.15)'}`,
      transition: 'all 0.2s ease', userSelect: 'none',
      boxShadow: frozen ? '0 0 12px rgba(100,180,255,0.15)' : 'none',
    }}>
      <span style={{
        fontSize: 8, fontWeight: 700, letterSpacing: '0.2em',
        color: frozen ? 'rgba(180,220,255,0.9)' : 'rgba(100,140,180,0.4)',
        fontFamily: 'system-ui',
      }}>FREEZE</span>
    </div>
  );
}

// ─── HSlider ─────────────────────────────────────────────────────────────────
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
      <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(100,160,220,0.4)', width: 34, textAlign: 'right', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ flex: 1, height: 3, background: 'rgba(80,140,200,0.06)', borderRadius: 2, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${norm * 100}%`, background: 'rgba(100,180,255,0.15)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: '50%', left: `${norm * 100}%`, transform: 'translate(-50%, -50%)', width: 7, height: 7, borderRadius: '50%', background: 'rgba(140,200,255,0.5)', boxShadow: '0 0 4px rgba(100,180,255,0.3)' }} />
      </div>
      <span style={{ fontSize: 7, color: 'rgba(100,160,220,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600, width: 26, textAlign: 'left', flexShrink: 0 }}>{display}</span>
    </div>
  );
}

// ─── Bypass Button ───────────────────────────────────────────────────────────
function BypassDot({ active, onClick }) {
  return (
    <div onClick={onClick} title={active ? 'Active' : 'Bypassed'}
      style={{ cursor: 'pointer', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: active ? 'radial-gradient(circle at 35% 35%, rgba(180,220,255,0.9), rgba(80,160,255,0.6))' : 'rgba(40,60,80,0.3)',
        boxShadow: active ? '0 0 8px rgba(100,180,255,0.4)' : 'none',
        transition: 'all 0.3s ease',
      }} />
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',              freeze: 0, smear: 0.3, drift: 0.2, shape: 0.5, width: 0.6, mix: 0.4, smooth: 0 },
  { name: 'FROZEN CHOIR PAD',  freeze: 1, smear: 0.6, drift: 0.3, shape: 0.6, width: 0.8, mix: 0.7, smooth: 0 },
  { name: 'DREAM BLOOM HOLD', freeze: 1, smear: 0.8, drift: 0.5, shape: 0.7, width: 0.9, mix: 0.6, smooth: 0 },
  { name: 'HAUNTED AMBIENT',   freeze: 1, smear: 0.4, drift: 0.15, shape: 0.25, width: 0.7, mix: 0.5, smooth: 0 },
  { name: 'GLASS FIELD',       freeze: 1, smear: 0.2, drift: 0.1, shape: 0.85, width: 0.5, mix: 0.55, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#0a1520', text: 'rgba(140,200,255,0.8)', textDim: 'rgba(80,140,200,0.45)',
  border: 'rgba(80,140,200,0.12)', hoverBg: 'rgba(60,120,180,0.08)', activeBg: 'rgba(60,120,180,0.05)',
};

export default function FreezeFieldOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [inputGain, setInputGain] = useState(initialState?.inputGain ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [freeze, setFreeze] = useState(initialState?.freeze ?? 0);
  const [smear, setSmear] = useState(initialState?.smear ?? 0.3);
  const [drift, setDrift] = useState(initialState?.drift ?? 0.2);
  const [shape, setShape] = useState(initialState?.shape ?? 0.5);
  const [width, setWidth] = useState(initialState?.width ?? 0.6);
  const [mix, setMix] = useState(initialState?.mix ?? 0.4);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, freeze, smear, drift, shape, width, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createFreezeFieldEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setFreeze(s.freeze); eng.setSmear(s.smear); eng.setDrift(s.drift);
      eng.setShape(s.shape); eng.setWidth(s.width); eng.setMix(s.mix);
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
      if (engineRef.current) {
        const peak = engineRef.current.getInputPeak();
        setPeakLevel(peak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, freeze, smear, drift, shape, width, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, freeze, smear, drift, shape, width, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setFreeze(p.freeze); setSmear(p.smear); setDrift(p.drift);
    setShape(p.shape); setWidth(p.width); setMix(p.mix);
    if (p.smooth !== undefined) setSmooth(p.smooth);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setFreeze(p.freeze); e.setSmear(p.smear); e.setDrift(p.drift); e.setShape(p.shape); e.setWidth(p.width); e.setMix(p.mix); if (p.smooth !== undefined) e.setSmooth(p.smooth); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #0a1520 0%, #081018 35%, #060c14 70%, #040810 100%)',
      border: '1.5px solid rgba(80,160,240,0.15)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 25px rgba(60,120,200,0.1), inset 0 1px 0 rgba(120,180,255,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(80,160,240,0.1)',
        background: 'linear-gradient(180deg, rgba(60,120,200,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.1em',
            background: 'linear-gradient(135deg, #80c0ff, #40a0e0, #a0d0ff)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(60,120,200,0.3))',
          }}>FREEZEFIELD</span>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(100,160,220,0.35)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>FREEZE / TEXTURE REVERB</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(80,160,240,0.4)' }}>...</span>}
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
      <div style={{ borderBottom: '1px solid rgba(80,160,240,0.08)' }}>
        <IceCaveCanvas freeze={freeze} smear={smear} drift={drift} shape={shape} width={width} peakLevel={peakLevel} bypassed={bypassed} />
      </div>

      {/* Freeze Button + I/O */}
      <div style={{
        padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(80,160,240,0.08)',
      }}>
        <FreezeButton frozen={freeze > 0.5} onClick={() => {
          const n = freeze > 0.5 ? 0 : 1;
          setFreeze(n); engineRef.current?.setFreeze(n); setActivePreset(null);
        }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <HSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} format={dbFmt}
            onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
          <HSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} format={dbFmt}
            onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Knobs Row 1: SMEAR, DRIFT, SHAPE */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(80,160,240,0.06)',
      }}>
        <Knob label="SMEAR" value={smear} defaultValue={0.3} format={pctFmt}
          onChange={v => { setSmear(v); engineRef.current?.setSmear(v); setActivePreset(null); }} />
        <Knob label="DRIFT" value={drift} defaultValue={0.2} format={pctFmt}
          onChange={v => { setDrift(v); engineRef.current?.setDrift(v); setActivePreset(null); }} />
        <Knob label="SHAPE" value={shape} defaultValue={0.5}
          format={v => v < 0.3 ? 'DARK' : v > 0.7 ? 'BRIGHT' : 'NEUTRAL'}
          onChange={v => { setShape(v); engineRef.current?.setShape(v); setActivePreset(null); }} />
      </div>

      {/* Knobs Row 2: WIDTH, MIX */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(80,160,240,0.06)',
      }}>
        <Knob label="WIDTH" value={width} defaultValue={0.6} format={pctFmt}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.4} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bypass footer */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <BypassDot active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }} style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(80,160,240,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(120,200,255,0.95)' : 'rgba(80,140,200,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(80,160,240,0.45)' : 'rgba(60,100,160,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(80,160,240,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.15em',
            color: bypassed ? 'rgba(100,160,220,0.4)' : freeze > 0.5 ? 'rgba(140,220,255,0.7)' : 'rgba(100,200,180,0.5)',
            fontFamily: 'system-ui',
          }}>{bypassed ? 'BYPASSED' : freeze > 0.5 ? 'FROZEN' : 'ACTIVE'}</span>
        </div>
      </div>
    </div>
  );
}
