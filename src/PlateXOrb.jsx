import { useState, useEffect, useRef, useCallback } from 'react';
import { createPlatexEngine } from './platexEngine';
import PresetSelector from './PresetSelector';

// ─── PLATEX: Modern Dynamic Plate Reverb ─────────────────────────────────────
// Visual: VIBRATING METAL PLATE — Chladni nodal patterns from above
// Brushed steel grey/silver, warm golden glow on vibration, blue edge lighting
// Tension changes pattern complexity, energy makes plate glow on hits

// ─── Plate Surface Canvas ────────────────────────────────────────────────────
function PlateCanvas({ tension, size, energy, metal, peak = 0, outPeak = 0, energyLevel = 0, plateLevel = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const nodesRef = useRef(null);
  const valRef = useRef({ tension: 0, size: 0, energy: 0, metal: 0, peak: 0, outPeak: 0, energyLevel: 0, plateLevel: 0 });

  valRef.current = { tension, size, energy, metal, peak, outPeak, energyLevel, plateLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize sand particles for Chladni patterns
    if (!nodesRef.current) {
      var particles = [];
      for (var pi = 0; pi < 600; pi++) {
        particles.push({
          x: 20 + Math.random() * (W - 40),
          y: 15 + Math.random() * (H - 30),
          vx: 0,
          vy: 0,
          size: 0.8 + Math.random() * 1.5,
          brightness: 0.5 + Math.random() * 0.5,
          bounceH: 0,
        });
      }
      nodesRef.current = {
        particles: particles,
        lastHitPhase: 0,
        hitFlash: 0,
      };
    }

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const { tension: _tension, size: _size, energy: _energy, metal: _metal, peak: _peak, outPeak: _outPeak, energyLevel: _energyLevel, plateLevel: _plateLevel } = valRef.current;

      phaseRef.current += 0.006;
      var phase = phaseRef.current;
      var cxP = W / 2, cyP = H / 2;
      var peakVal = _peak || 0;
      var nodeData = nodesRef.current;

      // Plate dimensions (size affects how large)
      var plateMargin = 12 + (1 - _size) * 15;
      var plateW = W - plateMargin * 2;
      var plateH = H - plateMargin * 2;
      var plateCx = plateMargin + plateW / 2;
      var plateCy = plateMargin + plateH / 2;

      // Clear with slight fade for trails
      ctx.fillStyle = 'rgba(22, 24, 28, 0.2)';
      ctx.fillRect(0, 0, W, H);

      // Base plate surface — brushed metal gradient
      ctx.fillStyle = 'rgba(22, 24, 28, 0.9)';
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      // === Metallic plate surface with reflection ===
      var metalBrightness = 30 + _metal * 35;
      var metalGrad = ctx.createLinearGradient(plateMargin, plateMargin, plateMargin, plateMargin + plateH);
      metalGrad.addColorStop(0, 'rgba(' + Math.floor(metalBrightness + 15) + ',' + Math.floor(metalBrightness + 18) + ',' + Math.floor(metalBrightness + 22) + ',0.8)');
      metalGrad.addColorStop(0.3, 'rgba(' + Math.floor(metalBrightness) + ',' + Math.floor(metalBrightness + 3) + ',' + Math.floor(metalBrightness + 7) + ',0.6)');
      metalGrad.addColorStop(0.5, 'rgba(' + Math.floor(metalBrightness + 8) + ',' + Math.floor(metalBrightness + 10) + ',' + Math.floor(metalBrightness + 14) + ',0.65)');
      metalGrad.addColorStop(0.7, 'rgba(' + Math.floor(metalBrightness - 5) + ',' + Math.floor(metalBrightness - 2) + ',' + Math.floor(metalBrightness + 2) + ',0.55)');
      metalGrad.addColorStop(1, 'rgba(' + Math.floor(metalBrightness + 10) + ',' + Math.floor(metalBrightness + 12) + ',' + Math.floor(metalBrightness + 16) + ',0.7)');
      ctx.fillStyle = metalGrad;
      ctx.fillRect(plateMargin, plateMargin, plateW, plateH);

      // Brushed steel horizontal lines (always visible)
      ctx.strokeStyle = 'rgba(140, 145, 160, 0.04)';
      ctx.lineWidth = 0.3;
      for (var bsy = plateMargin + 2; bsy < plateMargin + plateH - 2; bsy += 2) {
        ctx.beginPath();
        ctx.moveTo(plateMargin + 2, bsy + Math.sin(bsy * 0.3) * 0.5);
        ctx.lineTo(plateMargin + plateW - 2, bsy + Math.sin(bsy * 0.3 + 2) * 0.5);
        ctx.stroke();
      }

      // Metal character: golden/bronze shimmer overlay
      if (_metal > 0.1) {
        var shimmerPhase = phase * 2;
        var shimmerX = plateCx + Math.sin(shimmerPhase) * plateW * 0.3;
        var shimmerY = plateCy + Math.cos(shimmerPhase * 0.7) * plateH * 0.2;
        var shimmerR = 30 + _metal * 60;
        var shimmerGrad = ctx.createRadialGradient(shimmerX, shimmerY, 0, shimmerX, shimmerY, shimmerR);
        // Golden/bronze depending on metal value
        var goldR = Math.floor(200 + _metal * 55);
        var goldG = Math.floor(160 + _metal * 40);
        var goldB = Math.floor(60 + _metal * 30);
        shimmerGrad.addColorStop(0, 'rgba(' + goldR + ',' + goldG + ',' + goldB + ',' + (_metal * 0.12).toFixed(3) + ')');
        shimmerGrad.addColorStop(0.5, 'rgba(' + goldR + ',' + goldG + ',' + goldB + ',' + (_metal * 0.04).toFixed(3) + ')');
        shimmerGrad.addColorStop(1, 'rgba(' + goldR + ',' + goldG + ',' + goldB + ',0)');
        ctx.fillStyle = shimmerGrad;
        ctx.fillRect(plateMargin, plateMargin, plateW, plateH);

        // Secondary shimmer spot
        var shim2x = plateCx - Math.cos(shimmerPhase * 0.6) * plateW * 0.25;
        var shim2y = plateCy - Math.sin(shimmerPhase * 0.9) * plateH * 0.15;
        var shimGrad2 = ctx.createRadialGradient(shim2x, shim2y, 0, shim2x, shim2y, shimmerR * 0.7);
        shimGrad2.addColorStop(0, 'rgba(180, 140, 50, ' + (_metal * 0.08).toFixed(3) + ')');
        shimGrad2.addColorStop(1, 'rgba(180, 140, 50, 0)');
        ctx.fillStyle = shimGrad2;
        ctx.fillRect(plateMargin, plateMargin, plateW, plateH);
      }

      // === Plate border with bevel and glow ===
      // Outer bright border (beveled edge highlight)
      ctx.strokeStyle = 'rgba(160, 165, 180, ' + (0.25 + _plateLevel * 0.2).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.strokeRect(plateMargin, plateMargin, plateW, plateH);

      // Edge glow (vibration energy)
      if (_plateLevel > 0.05) {
        ctx.shadowColor = 'rgba(100, 180, 255, ' + (_plateLevel * 0.6).toFixed(3) + ')';
        ctx.shadowBlur = 10 + _plateLevel * 15;
        ctx.strokeStyle = 'rgba(80, 150, 240, ' + (_plateLevel * 0.3).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(plateMargin, plateMargin, plateW, plateH);
        ctx.shadowBlur = 0;
      }

      // Inner bevel (dark)
      ctx.strokeStyle = 'rgba(10, 12, 16, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(plateMargin + 2, plateMargin + 2, plateW - 4, plateH - 4);

      // === Chladni pattern ===
      var mode1 = 2 + Math.floor(_tension * 5); // 2-7 modes
      var mode2 = 2 + Math.floor(_metal * 4);    // 2-6 modes
      var vibPhase = phase * (0.5 + _plateLevel * 3);
      var patternIntensity = 0.08 + _plateLevel * 0.25 + _energyLevel * _energy * 0.35;
      var gridStep = 3;

      // Draw the Chladni standing wave pattern
      for (var gx = plateMargin + 3; gx < W - plateMargin - 3; gx += gridStep) {
        for (var gy = plateMargin + 3; gy < H - plateMargin - 3; gy += gridStep) {
          var nx = (gx - plateMargin) / plateW;
          var ny = (gy - plateMargin) / plateH;

          // Chladni function
          var chladni = Math.sin(mode1 * Math.PI * nx) * Math.sin(mode2 * Math.PI * ny)
                      + Math.sin(mode2 * Math.PI * nx) * Math.sin(mode1 * Math.PI * ny);

          var vibAmp = Math.abs(chladni) * Math.sin(vibPhase + chladni * 2.5);
          var absChladni = Math.abs(chladni);

          if (absChladni < 0.18) {
            // Nodal lines — sand accumulates here — bright silver/white
            var nodeAlpha = patternIntensity * (1 - absChladni / 0.18) * 2.5;
            ctx.fillStyle = 'rgba(200, 205, 220, ' + Math.min(0.8, nodeAlpha).toFixed(3) + ')';
            ctx.fillRect(gx, gy, 2, 2);
          }

          if (Math.abs(vibAmp) > 0.25) {
            // Anti-nodes — vibration zones — white-hot glow
            var glowAlpha = patternIntensity * Math.abs(vibAmp) * 1.2;
            // Mix between golden and white-hot based on energy
            var hotR = Math.floor(255);
            var hotG = Math.floor(200 + _energy * 55);
            var hotB = Math.floor(100 + _energy * 100);
            ctx.fillStyle = 'rgba(' + hotR + ',' + hotG + ',' + hotB + ',' + Math.min(0.6, glowAlpha).toFixed(3) + ')';
            ctx.fillRect(gx - 0.5, gy - 0.5, 3, 3);
          }
        }
      }

      // === Bright resonance glow at anti-nodes ===
      // Place glowing hotspots at the centers of vibration regions
      var hotspotCount = 3 + Math.floor(_tension * 4);
      for (var hi = 0; hi < hotspotCount; hi++) {
        for (var hj = 0; hj < hotspotCount; hj++) {
          var hx = plateMargin + (hi + 0.5) / hotspotCount * plateW;
          var hy = plateMargin + (hj + 0.5) / hotspotCount * plateH;
          var hnx = (hx - plateMargin) / plateW;
          var hny = (hy - plateMargin) / plateH;
          var hChladni = Math.abs(Math.sin(mode1 * Math.PI * hnx) * Math.sin(mode2 * Math.PI * hny)
                        + Math.sin(mode2 * Math.PI * hnx) * Math.sin(mode1 * Math.PI * hny));
          if (hChladni > 0.5) {
            var hotGlowR = 8 + hChladni * 15 * (1 + _plateLevel * 2);
            var hotGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, hotGlowR);
            var hotAlpha = patternIntensity * hChladni * 0.4;
            hotGrad.addColorStop(0, 'rgba(255, 240, 200, ' + Math.min(0.5, hotAlpha).toFixed(3) + ')');
            hotGrad.addColorStop(0.4, 'rgba(255, 200, 100, ' + (hotAlpha * 0.4).toFixed(3) + ')');
            hotGrad.addColorStop(1, 'rgba(200, 150, 50, 0)');
            ctx.fillStyle = hotGrad;
            ctx.beginPath();
            ctx.arc(hx, hy, hotGlowR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // === Animate sand particles ===
      var parts = nodeData.particles;
      // Audio hit detection — scatter particles
      if (peakVal > nodeData.lastHitPhase + 0.08 && peakVal > 0.12) {
        nodeData.hitFlash = 1;
        for (var pk = 0; pk < parts.length; pk++) {
          var hitForce = _energy * peakVal * 4;
          parts[pk].vx += (Math.random() - 0.5) * hitForce;
          parts[pk].vy += (Math.random() - 0.5) * hitForce;
          parts[pk].bounceH = peakVal * _energy * 8;
        }
      }
      nodeData.lastHitPhase = peakVal * 0.85 + nodeData.lastHitPhase * 0.15;
      nodeData.hitFlash *= 0.92;

      // Move particles toward nodal lines (Chladni attractor)
      for (var pp = 0; pp < parts.length; pp++) {
        var pt = parts[pp];
        var pnx = (pt.x - plateMargin) / plateW;
        var pny = (pt.y - plateMargin) / plateH;

        if (pnx >= 0 && pnx <= 1 && pny >= 0 && pny <= 1) {
          // Chladni force field (gradient pushes toward nodal lines)
          var eps = 0.005;
          var cVal = Math.sin(mode1 * Math.PI * pnx) * Math.sin(mode2 * Math.PI * pny)
                   + Math.sin(mode2 * Math.PI * pnx) * Math.sin(mode1 * Math.PI * pny);
          var cDx = (Math.sin(mode1 * Math.PI * (pnx + eps)) * Math.sin(mode2 * Math.PI * pny)
                   + Math.sin(mode2 * Math.PI * (pnx + eps)) * Math.sin(mode1 * Math.PI * pny) - cVal) / eps;
          var cDy = (Math.sin(mode1 * Math.PI * pnx) * Math.sin(mode2 * Math.PI * (pny + eps))
                   + Math.sin(mode2 * Math.PI * pnx) * Math.sin(mode1 * Math.PI * (pny + eps)) - cVal) / eps;

          // Push particles toward where cVal = 0 (nodal lines)
          var forceStrength = 0.003 + _tension * 0.008;
          pt.vx -= cVal * cDx * forceStrength * plateW;
          pt.vy -= cVal * cDy * forceStrength * plateH;
        }

        // Energy vibration shaking
        pt.vx += (Math.random() - 0.5) * _energy * _energyLevel * 0.8;
        pt.vy += (Math.random() - 0.5) * _energy * _energyLevel * 0.8;

        // Damping
        pt.vx *= 0.92;
        pt.vy *= 0.92;

        pt.x += pt.vx;
        pt.y += pt.vy;

        // Bounce decay
        pt.bounceH *= 0.93;

        // Contain within plate
        if (pt.x < plateMargin + 3) { pt.x = plateMargin + 3; pt.vx = Math.abs(pt.vx) * 0.5; }
        if (pt.x > W - plateMargin - 3) { pt.x = W - plateMargin - 3; pt.vx = -Math.abs(pt.vx) * 0.5; }
        if (pt.y < plateMargin + 3) { pt.y = plateMargin + 3; pt.vy = Math.abs(pt.vy) * 0.5; }
        if (pt.y > H - plateMargin - 3) { pt.y = H - plateMargin - 3; pt.vy = -Math.abs(pt.vy) * 0.5; }

        // Draw particle (sand grain)
        var pBright = pt.brightness;
        var pAlpha = 0.5 + pBright * 0.4;
        var pR = Math.floor(180 + pBright * 60);
        var pG = Math.floor(175 + pBright * 55);
        var pB = Math.floor(150 + pBright * 40);

        // Shadow beneath particle for bounce effect
        if (pt.bounceH > 0.3) {
          ctx.beginPath();
          ctx.arc(pt.x + pt.bounceH * 0.3, pt.y + pt.bounceH * 0.5, pt.size * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(pt.x, pt.y - pt.bounceH, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + pR + ',' + pG + ',' + pB + ',' + pAlpha.toFixed(3) + ')';
        ctx.fill();
      }

      // === Energy hit flash — bright white/gold radiating from impact ===
      if (nodeData.hitFlash > 0.05) {
        var flashR = 50 + nodeData.hitFlash * 120;
        var flashGrad = ctx.createRadialGradient(cxP, cyP, 0, cxP, cyP, flashR);
        flashGrad.addColorStop(0, 'rgba(255, 240, 200, ' + (nodeData.hitFlash * 0.35).toFixed(3) + ')');
        flashGrad.addColorStop(0.3, 'rgba(255, 210, 120, ' + (nodeData.hitFlash * 0.15).toFixed(3) + ')');
        flashGrad.addColorStop(0.6, 'rgba(220, 180, 80, ' + (nodeData.hitFlash * 0.06).toFixed(3) + ')');
        flashGrad.addColorStop(1, 'rgba(200, 160, 60, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // === Corner rivets (large, metallic) ===
      var rivetPositions = [
        [plateMargin + 7, plateMargin + 7],
        [W - plateMargin - 7, plateMargin + 7],
        [plateMargin + 7, H - plateMargin - 7],
        [W - plateMargin - 7, H - plateMargin - 7],
      ];
      for (var ri = 0; ri < rivetPositions.length; ri++) {
        var rvx = rivetPositions[ri][0];
        var rvy = rivetPositions[ri][1];
        // Rivet shadow
        ctx.beginPath();
        ctx.arc(rvx + 0.5, rvy + 0.5, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fill();
        // Rivet body
        var rivetGrad = ctx.createRadialGradient(rvx - 1, rvy - 1, 0, rvx, rvy, 3);
        rivetGrad.addColorStop(0, 'rgba(180, 185, 200, 0.5)');
        rivetGrad.addColorStop(0.5, 'rgba(100, 105, 115, 0.4)');
        rivetGrad.addColorStop(1, 'rgba(50, 55, 65, 0.3)');
        ctx.beginPath();
        ctx.arc(rvx, rvy, 3, 0, Math.PI * 2);
        ctx.fillStyle = rivetGrad;
        ctx.fill();
        // Specular
        ctx.beginPath();
        ctx.arc(rvx - 0.8, rvy - 0.8, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220, 225, 240, 0.3)';
        ctx.fill();
      }

      // === Tension indicator: vibrating border ===
      var tensionAlpha = 0.1 + _tension * 0.25;
      var tensionOffset = Math.sin(phase * (2 + _tension * 8)) * _tension * 1.5;
      ctx.strokeStyle = 'rgba(220, 200, 100, ' + tensionAlpha.toFixed(3) + ')';
      ctx.lineWidth = 1 + _tension * 2;
      ctx.setLineDash([3 + (1 - _tension) * 6, 2 + _tension * 3]);
      ctx.strokeRect(
        plateMargin + 1 + tensionOffset,
        plateMargin + 1 - tensionOffset * 0.5,
        plateW - 2 - tensionOffset * 2,
        plateH - 2 + tensionOffset
      );
      ctx.setLineDash([]);

      // === Metal character: cross-hatch resonance lines ===
      if (_metal > 0.2) {
        var metalAlpha = (_metal - 0.2) * 0.15;
        // Copper/bronze tint lines
        var copperR = Math.floor(180 + _metal * 60);
        var copperG = Math.floor(120 + _metal * 40);
        var copperB = Math.floor(60 + _metal * 20);
        ctx.strokeStyle = 'rgba(' + copperR + ',' + copperG + ',' + copperB + ',' + metalAlpha.toFixed(3) + ')';
        ctx.lineWidth = 0.5;
        var spacing = 16 - _metal * 8;
        for (var md = -plateW; md < plateW + plateH; md += spacing) {
          ctx.beginPath();
          ctx.moveTo(plateMargin + md, plateMargin);
          ctx.lineTo(plateMargin + md + plateH, plateMargin + plateH);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(plateMargin + md + plateH, plateMargin);
          ctx.lineTo(plateMargin + md, plateMargin + plateH);
          ctx.stroke();
        }
      }

      // Watermark
      ctx.save();
      ctx.font = 'bold 32px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(150, 155, 170, 0.025)';
      ctx.fillText('PLATE', cxP, cyP);
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── Rivet Bypass Button ─────────────────────────────────────────────────────
function RivetBypass({ active, onClick }) {
  const size = 28;
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active' : 'Bypassed'}>
      <svg width={size} height={size} viewBox="0 0 28 28">
        <rect x="4" y="4" width="20" height="20" rx="2"
          fill={active ? 'rgba(200,180,120,0.12)' : 'rgba(60,62,68,0.1)'}
          stroke={active ? 'rgba(180,160,100,0.4)' : 'rgba(60,62,68,0.2)'}
          strokeWidth="1" />
        <circle cx="14" cy="14" r="4"
          fill={active ? 'rgba(200,190,150,0.3)' : 'rgba(60,62,68,0.15)'}
          stroke={active ? 'rgba(200,180,120,0.5)' : 'rgba(60,62,68,0.2)'}
          strokeWidth="0.8" />
        <circle cx="14" cy="14" r="1.5"
          fill={active ? 'rgba(240,220,160,0.8)' : 'rgba(60,62,68,0.3)'} />
      </svg>
    </div>
  );
}

// ─── Steel Knob (Hex Bolt) ───────────────────────────────────────────────────
function SteelKnob({ size = 26, norm = 0 }) {
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
          stroke="hsla(40,65%,55%,0.7)"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill="hsla(40,80%,70%,0.9)" />
      <circle cx={dotX} cy={dotY} r="4"
        fill="hsla(40,80%,70%,0.12)" />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
    </svg>
  );
}

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
        <SteelKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(180,170,130,0.7)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 5.5, color: 'rgba(150,145,120,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
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
        <SteelKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(150,145,120,0.45)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',               tension: 0.5, size: 0.5, energy: 0.3, metal: 0.25, tone: 0.55, mix: 0.25, smooth: 0 },
  { name: 'LUSH VOCAL PLATE',   tension: 0.4, size: 0.65, energy: 0.2, metal: 0.15, tone: 0.5, mix: 0.3, smooth: 0 },
  { name: 'TIGHT SNARE PLATE',  tension: 0.75, size: 0.3, energy: 0.6, metal: 0.35, tone: 0.6, mix: 0.2, smooth: 0 },
  { name: 'GLASSY PLATE BLOOM', tension: 0.3, size: 0.8, energy: 0.15, metal: 0.5, tone: 0.55, mix: 0.35, smooth: 0 },
  { name: 'DARK FILM PLATE',    tension: 0.55, size: 0.6, energy: 0.25, metal: 0.2, tone: 0.3, mix: 0.3, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#1c1e22', text: '#c8b478', textDim: 'rgba(200,180,120,0.5)',
  border: 'rgba(180,160,100,0.12)', hoverBg: 'rgba(180,160,100,0.1)', activeBg: 'rgba(180,160,100,0.06)',
};

export default function PlateXOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [tension, setTension] = useState(initialState?.tension ?? 0.5);
  const [size,    setSize]    = useState(initialState?.size    ?? 0.5);
  const [energy,  setEnergy]  = useState(initialState?.energy  ?? 0.3);
  const [metal,   setMetal]   = useState(initialState?.metal   ?? 0.25);
  const [tone,    setTone]    = useState(initialState?.tone    ?? 0.55);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 0.25);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);
  const [energyLevel, setEnergyLevel] = useState(0);
  const [plateLevel, setPlateLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, tension, size, energy, metal, tone, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createPlatexEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setTension(s.tension); eng.setSize(s.size); eng.setEnergy(s.energy);
      eng.setMetal(s.metal); eng.setTone(s.tone); eng.setMix(s.mix);
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
        setEnergyLevel(engineRef.current.getEnergy?.() ?? 0);
        setPlateLevel(engineRef.current.getPlateLevel?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, tension, size, energy, metal, tone, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, tension, size, energy, metal, tone, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setTension(p.tension); setSize(p.size); setEnergy(p.energy);
    setMetal(p.metal); setTone(p.tone); setMix(p.mix);
    if (p.smooth !== undefined) setSmooth(p.smooth);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setTension(p.tension); e.setSize(p.size); e.setEnergy(p.energy); e.setMetal(p.metal); e.setTone(p.tone); e.setMix(p.mix); if (p.smooth !== undefined) e.setSmooth(p.smooth); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #222428 0%, #1c1e22 30%, #181a1e 60%, #141618 100%)',
      border: '1.5px solid rgba(180,160,100,0.12)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 15px rgba(180,160,100,0.04), inset 0 1px 0 rgba(200,180,120,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(14,16,18,0.4) 100%)',
        borderRadius: 5,
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(180,160,100,0.08)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(200,180,120,0.015) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, letterSpacing: '0.15em',
            background: 'linear-gradient(135deg, #c8b478 0%, #a09070 30%, #e0d0a0 50%, #c0a868 70%, #b09860 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 6px rgba(200,180,120,0.2))',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>PLATEX</span>
          <span style={{
            fontSize: 6, fontWeight: 400, color: 'rgba(180,160,100,0.35)',
            letterSpacing: '0.3em', marginTop: 1.5,
            fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif',
          }}>dynamic plate reverb</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Preset row */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(180,160,100,0.06)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(180,160,100,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* Hero canvas */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0 }}>
        <PlateCanvas tension={tension} size={size} energy={energy} metal={metal} peak={peak} outPeak={outPeak} energyLevel={energyLevel} plateLevel={plateLevel} />
      </div>

      {/* Knob row */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderTop: '1px solid rgba(180,160,100,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="TENSION" value={tension} defaultValue={0.5} size={28} format={pctFmt}
          onChange={v => { setTension(v); engineRef.current?.setTension(v); setActivePreset(null); }} />
        <Knob label="SIZE" value={size} defaultValue={0.5} size={28} format={pctFmt}
          onChange={v => { setSize(v); engineRef.current?.setSize(v); setActivePreset(null); }} />
        <Knob label="ENERGY" value={energy} defaultValue={0.3} size={28} format={pctFmt}
          onChange={v => { setEnergy(v); engineRef.current?.setEnergy(v); setActivePreset(null); }} />
        <Knob label="METAL" value={metal} defaultValue={0.25} size={28} format={pctFmt}
          onChange={v => { setMetal(v); engineRef.current?.setMetal(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.55} size={28} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.25} size={28} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 18px 5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }} style={{
          fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
          background: smooth > 0 ? 'rgba(200,180,120,0.18)' : 'transparent',
          color: smooth > 0 ? 'rgba(240,220,160,0.95)' : 'rgba(150,145,120,0.4)',
          border: `1px solid ${smooth > 0 ? 'rgba(200,180,120,0.45)' : 'rgba(100,95,80,0.2)'}`,
          boxShadow: smooth > 0 ? '0 0 8px rgba(200,180,120,0.25)' : 'none',
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
        }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <RivetBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
