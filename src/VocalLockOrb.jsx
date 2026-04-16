import { useState, useEffect, useRef, useCallback } from 'react';
import { createVocalLockEngine } from './vocalLockEngine';
import PresetSelector from './PresetSelector';

// ─── VOCALLOCK: Holographic Targeting Reticle ─────────────────────────────
// Visual world: dark void, cyan/teal holographic rings, crosshairs, lock indicator
// Hero: Concentric rings that lock onto vocal signal, crosshairs tracking presence/body

// ─── Holographic Reticle Canvas ───────────────────────────────────────────
function HoloReticle({ lock, presence, body, stability, gainReduction, peak }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ lock: 0.45, presence: 0.4, body: 0.5, stability: 0.5, gainReduction: 0, peak: 0 });
  const phaseRef = useRef(0);
  const lockPulseRef = useRef(0);
  const ringOffsetsRef = useRef([0, 0, 0, 0, 0, 0, 0]);
  const dataRainRef = useRef(
    Array.from({ length: 60 }, () => ({
      x: Math.random() * 260, y: Math.random() * 160,
      speed: 0.5 + Math.random() * 2, char: Math.floor(Math.random() * 94) + 33,
      alpha: 0.3 + Math.random() * 0.7, size: 4 + Math.random() * 4,
    }))
  );
  const scanBeamsRef = useRef([
    { angle: 0, speed: 0.02, len: 90, hue: 180 },
    { angle: Math.PI, speed: -0.015, len: 85, hue: 300 },
    { angle: Math.PI * 0.5, speed: 0.025, len: 80, hue: 160 },
    { angle: Math.PI * 1.5, speed: -0.018, len: 75, hue: 310 },
  ]);

  useEffect(() => { valRef.current = { lock, presence, body, stability, gainReduction, peak }; }, [lock, presence, body, stability, gainReduction, peak]);

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
      phaseRef.current += 0.018;
      const t = phaseRef.current;
      const v = valRef.current;

      const cx = W / 2;
      const cy = H / 2;

      // ── Deep dark background with cyan-tinted radial ──
      ctx.fillStyle = 'rgba(2, 6, 14, 0.92)';
      ctx.fillRect(0, 0, W, H);

      // Subtle grid overlay
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.06)';
      ctx.lineWidth = 0.3;
      for (var gx = 0; gx < W; gx += 12) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (var gy = 0; gy < H; gy += 12) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // Lock pulse (intensifies when gain reduction active)
      var grNorm = Math.min(1, v.gainReduction * 8);
      lockPulseRef.current += (grNorm - lockPulseRef.current) * 0.08;
      var lockPulse = lockPulseRef.current;
      var peakBright = Math.min(1, v.peak * 2.5);

      // ── Matrix-style data rain background ──
      var rain = dataRainRef.current;
      for (var ri = 0; ri < rain.length; ri++) {
        var drop = rain[ri];
        drop.y += drop.speed * (0.5 + v.peak * 2);
        if (drop.y > H + 10) {
          drop.y = -10;
          drop.x = Math.random() * W;
          drop.char = Math.floor(Math.random() * 94) + 33;
        }
        var rainAlpha = drop.alpha * (0.15 + v.lock * 0.15 + peakBright * 0.2);
        ctx.font = '600 ' + drop.size + 'px monospace';
        ctx.fillStyle = 'rgba(0, 255, 140, ' + rainAlpha + ')';
        ctx.fillText(String.fromCharCode(drop.char), drop.x, drop.y);
      }

      // ── Central glow (massive cyan/magenta core) ──
      var coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70 + peakBright * 30);
      coreGlow.addColorStop(0, 'rgba(0, 255, 255, ' + (0.15 + lockPulse * 0.2 + peakBright * 0.15) + ')');
      coreGlow.addColorStop(0.3, 'rgba(255, 0, 200, ' + (0.06 + lockPulse * 0.08) + ')');
      coreGlow.addColorStop(0.6, 'rgba(0, 200, 255, ' + (0.03 + peakBright * 0.04) + ')');
      coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = coreGlow;
      ctx.fillRect(0, 0, W, H);

      // ── Rotating scanning beams (bright cyan/magenta) ──
      var beams = scanBeamsRef.current;
      for (var bi = 0; bi < beams.length; bi++) {
        var beam = beams[bi];
        beam.angle += beam.speed * (0.8 + v.lock * 0.6);
        var bLen = beam.len + peakBright * 20;
        var bx = cx + Math.cos(beam.angle) * bLen;
        var by = cy + Math.sin(beam.angle) * bLen;
        var beamGrad = ctx.createLinearGradient(cx, cy, bx, by);
        if (beam.hue < 200) {
          beamGrad.addColorStop(0, 'rgba(0, 255, 255, ' + (0.9 + peakBright * 0.1) + ')');
          beamGrad.addColorStop(0.5, 'rgba(0, 200, 255, 0.5)');
          beamGrad.addColorStop(1, 'rgba(0, 100, 255, 0)');
        } else {
          beamGrad.addColorStop(0, 'rgba(255, 0, 200, ' + (0.8 + peakBright * 0.2) + ')');
          beamGrad.addColorStop(0.5, 'rgba(255, 50, 180, 0.4)');
          beamGrad.addColorStop(1, 'rgba(200, 0, 150, 0)');
        }
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = beamGrad;
        ctx.lineWidth = 2.5 + peakBright * 2;
        ctx.stroke();
        // Beam glow
        ctx.lineWidth = 8 + peakBright * 4;
        ctx.globalAlpha = 0.15;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ── Concentric targeting reticle rings (7 bright rings) ──
      var ringCount = 7;
      var maxR = 60 + v.lock * 15;
      var offsets = ringOffsetsRef.current;
      for (var i = 0; i < ringCount; i++) {
        var targetOff = (Math.sin(t * (0.5 + i * 0.3) + i * 1.2) * 4) * (1 - v.lock * 0.7);
        offsets[i] += (targetOff - offsets[i]) * 0.05;
        var r = maxR * ((i + 1) / ringCount);
        var wobble = offsets[i];
        var ringCx = cx + wobble;
        var ringCy = cy + Math.sin(t * 0.3 + i * 0.8) * wobble * 0.5;
        var ringAlpha = 0.3 + (1 - i / ringCount) * 0.4 + lockPulse * 0.2 + peakBright * 0.15;
        ringAlpha = Math.min(1, ringAlpha);
        var rotOff = t * (0.15 + i * 0.06) * (i % 2 === 0 ? 1 : -1);

        // Dashed neon ring
        var dashLen = 6 + i * 3;
        var gapLen = 3 + i * 1.5;
        var circ = 2 * Math.PI * r;
        var segCount = Math.max(4, Math.floor(circ / (dashLen + gapLen)));
        var segAngle = (2 * Math.PI) / segCount;
        for (var s = 0; s < segCount; s++) {
          var sa = s * segAngle + rotOff;
          var ea = sa + segAngle * (dashLen / (dashLen + gapLen));
          ctx.beginPath();
          ctx.arc(ringCx, ringCy, r, sa, ea);
          var hue = i % 2 === 0 ? 180 : 300;
          ctx.strokeStyle = 'hsla(' + hue + ', 100%, ' + (60 + lockPulse * 20 + peakBright * 10) + '%, ' + ringAlpha + ')';
          ctx.lineWidth = i === 0 ? 2.5 : 1.2;
          ctx.stroke();
        }

        // Tick marks at 8 points
        for (var tick = 0; tick < 8; tick++) {
          var tickAngle = (tick * Math.PI / 4) + rotOff;
          var ix = ringCx + Math.cos(tickAngle) * (r - 4);
          var iy = ringCy + Math.sin(tickAngle) * (r - 4);
          var ox = ringCx + Math.cos(tickAngle) * (r + 4);
          var oy = ringCy + Math.sin(tickAngle) * (r + 4);
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.lineTo(ox, oy);
          ctx.strokeStyle = 'rgba(0, 255, 255, ' + (ringAlpha * 0.5) + ')';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      // ── Crosshairs tracking presence (X) and body (Y) ──
      var crossX = cx + (v.presence - 0.5) * 70;
      var crossY = cy + (0.5 - v.body) * 50;
      var crossAlpha = 0.5 + v.lock * 0.3 + peakBright * 0.2;

      // Horizontal crosshair (full width, bright cyan)
      ctx.beginPath();
      ctx.setLineDash([6, 3]);
      ctx.moveTo(0, crossY);
      ctx.lineTo(W, crossY);
      ctx.strokeStyle = 'rgba(0, 255, 255, ' + crossAlpha + ')';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Vertical crosshair
      ctx.beginPath();
      ctx.moveTo(crossX, 0);
      ctx.lineTo(crossX, H);
      ctx.strokeStyle = 'rgba(255, 0, 220, ' + crossAlpha + ')';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);

      // Crosshair intersection -- pulsating targeting diamond
      var dSize = 6 + v.peak * 12 + Math.sin(t * 4) * 2;
      ctx.beginPath();
      ctx.moveTo(crossX, crossY - dSize);
      ctx.lineTo(crossX + dSize, crossY);
      ctx.lineTo(crossX, crossY + dSize);
      ctx.lineTo(crossX - dSize, crossY);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.7 + lockPulse * 0.3) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 255, 255, ' + (0.15 + lockPulse * 0.2 + peakBright * 0.15) + ')';
      ctx.fill();

      // Inner diamond
      var dSize2 = dSize * 0.5;
      ctx.beginPath();
      ctx.moveTo(crossX, crossY - dSize2);
      ctx.lineTo(crossX + dSize2, crossY);
      ctx.lineTo(crossX, crossY + dSize2);
      ctx.lineTo(crossX - dSize2, crossY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 0, 220, ' + (0.2 + lockPulse * 0.3) + ')';
      ctx.fill();

      // ── Central lock indicator (big bright circle) ──
      var lockR = 12 + v.lock * 10;
      // Massive glow
      var lockGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, lockR * 4);
      lockGlow.addColorStop(0, 'rgba(0, 255, 255, ' + (0.25 + lockPulse * 0.3) + ')');
      lockGlow.addColorStop(0.3, 'rgba(255, 0, 200, ' + (0.1 + lockPulse * 0.15) + ')');
      lockGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = lockGlow;
      ctx.fillRect(cx - lockR * 4, cy - lockR * 4, lockR * 8, lockR * 8);

      // Lock circle outer
      ctx.beginPath();
      ctx.arc(cx, cy, lockR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 255, 255, ' + (0.7 + lockPulse * 0.3) + ')';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Lock circle inner
      ctx.beginPath();
      ctx.arc(cx, cy, lockR * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 0, 220, ' + (0.5 + lockPulse * 0.3) + ')';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Lock fill arc (fills up as lock increases)
      var lockFillAngle = v.lock * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, lockR - 2, -Math.PI / 2, -Math.PI / 2 + lockFillAngle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 255, 255, ' + (0.25 + lockPulse * 0.2) + ')';
      ctx.fill();

      // ── Stability indicators: bright orbiting dots ──
      var orbitR = maxR + 12;
      var orbDots = 12;
      for (var d = 0; d < orbDots; d++) {
        var angle = (d / orbDots) * Math.PI * 2 + t * (0.3 + v.stability * 0.5);
        var dotX = cx + Math.cos(angle) * orbitR;
        var dotY = cy + Math.sin(angle) * orbitR;
        var dotAlpha = 0.4 + v.stability * 0.4 + Math.sin(t * 3 + d) * 0.1;
        var dotR2 = 1.5 + v.stability * 2 + peakBright * 1.5;
        var dotHue = d % 2 === 0 ? 180 : 300;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR2, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + dotHue + ', 100%, 65%, ' + dotAlpha + ')';
        ctx.fill();
        // Dot glow
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR2 * 3, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + dotHue + ', 100%, 50%, ' + (dotAlpha * 0.15) + ')';
        ctx.fill();
      }

      // ── Peak signal spikes (radial bursts -- bright neon) ──
      if (v.peak > 0.05) {
        var spikeCount = 24;
        for (var sp = 0; sp < spikeCount; sp++) {
          var spAngle = (sp / spikeCount) * Math.PI * 2 + t * 0.3;
          var spikeLen = 8 + v.peak * 40;
          var innerR = maxR * 0.25;
          var spix = cx + Math.cos(spAngle) * innerR;
          var spiy = cy + Math.sin(spAngle) * innerR;
          var spox = cx + Math.cos(spAngle) * (innerR + spikeLen);
          var spoy = cy + Math.sin(spAngle) * (innerR + spikeLen);
          var spHue = sp % 3 === 0 ? 180 : sp % 3 === 1 ? 300 : 120;
          ctx.beginPath();
          ctx.moveTo(spix, spiy);
          ctx.lineTo(spox, spoy);
          ctx.strokeStyle = 'hsla(' + spHue + ', 100%, 65%, ' + (v.peak * 0.6) + ')';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ── Holographic HUD data readouts (bright, large) ──
      ctx.font = '700 7px system-ui';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
      ctx.fillText('LOCK ' + Math.round(v.lock * 100) + '%', 8, 14);
      ctx.fillStyle = 'rgba(0, 255, 180, 0.6)';
      ctx.fillText('PRES ' + Math.round(v.presence * 100), 8, 24);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255, 0, 220, 0.7)';
      ctx.fillText('BODY ' + Math.round(v.body * 100), W - 8, 14);
      ctx.fillStyle = 'rgba(180, 0, 255, 0.6)';
      ctx.fillText('STAB ' + Math.round(v.stability * 100), W - 8, 24);

      // GR indicator bottom center (flashing when active)
      if (v.gainReduction > 0.001) {
        ctx.textAlign = 'center';
        ctx.font = '700 8px "Courier New", monospace';
        var grFlash = 0.6 + Math.sin(t * 6) * 0.3;
        ctx.fillStyle = 'rgba(0, 255, 255, ' + (grFlash + lockPulse * 0.3) + ')';
        ctx.fillText('GR ' + (v.gainReduction * 20).toFixed(1) + 'dB', cx, H - 8);
      }

      // ── Scanline sweep (bright, visible) ──
      var scanY = (t * 40) % H;
      var scanGrad = ctx.createLinearGradient(0, scanY - 4, 0, scanY + 4);
      scanGrad.addColorStop(0, 'rgba(0, 255, 255, 0)');
      scanGrad.addColorStop(0.5, 'rgba(0, 255, 255, 0.12)');
      scanGrad.addColorStop(1, 'rgba(0, 255, 255, 0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 4, W, 8);

      // Horizontal scanlines (CRT effect)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
      for (var sl = 0; sl < H; sl += 3) {
        ctx.fillRect(0, sl, W, 1);
      }

      // ── Corner brackets (HUD frame - bright neon) ──
      var bLen = 18;
      var bOff = 4;
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      // TL
      ctx.beginPath(); ctx.moveTo(bOff, bOff + bLen); ctx.lineTo(bOff, bOff); ctx.lineTo(bOff + bLen, bOff); ctx.stroke();
      // TR
      ctx.beginPath(); ctx.moveTo(W - bOff - bLen, bOff); ctx.lineTo(W - bOff, bOff); ctx.lineTo(W - bOff, bOff + bLen); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 0, 220, 0.6)';
      // BL
      ctx.beginPath(); ctx.moveTo(bOff, H - bOff - bLen); ctx.lineTo(bOff, H - bOff); ctx.lineTo(bOff + bLen, H - bOff); ctx.stroke();
      // BR
      ctx.beginPath(); ctx.moveTo(W - bOff - bLen, H - bOff); ctx.lineTo(W - bOff, H - bOff); ctx.lineTo(W - bOff, H - bOff - bLen); ctx.stroke();

      // ── "LOCKED ON" indicator when lock > 0.7 ──
      if (v.lock > 0.7) {
        ctx.font = '900 9px system-ui';
        ctx.textAlign = 'center';
        var lockedFlash = 0.5 + Math.sin(t * 8) * 0.5;
        ctx.fillStyle = 'rgba(0, 255, 255, ' + lockedFlash + ')';
        ctx.fillText('LOCKED ON', cx, H - 18);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 160, display: 'block', borderRadius: 6 }} />;
}

// ─── GR Meter Bar ─────────────────────────────────────────────────────────
function GrMeter({ gainReduction }) {
  const norm = Math.min(1, gainReduction * 10);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      padding: '2px 10px', position: 'relative', zIndex: 2,
    }}>
      <span style={{
        fontSize: 5, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(80, 200, 200, 0.4)', fontFamily: 'system-ui',
        textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>GR</span>
      <div style={{
        flex: 1, height: 5, borderRadius: 10,
        background: 'rgba(10, 20, 25, 0.6)',
        border: '0.5px solid rgba(80, 200, 200, 0.1)',
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: `${norm * 100}%`,
          background: `linear-gradient(270deg, rgba(80, 200, 200, 0.3), rgba(60, 240, 220, 0.6))`,
          borderRadius: 10,
          boxShadow: `0 0 6px rgba(80, 220, 220, ${norm * 0.4})`,
          transition: 'width 0.06s ease-out',
        }} />
      </div>
      <span style={{
        fontSize: 5, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(80, 200, 200, 0.4)', fontFamily: 'system-ui',
        whiteSpace: 'nowrap', minWidth: 20, textAlign: 'right',
      }}>{norm > 0.01 ? `${(norm * 20).toFixed(1)}dB` : '0.0dB'}</span>
    </div>
  );
}

// ─── Crosshair Targeting Knob ─────────────────────────────────────────────
function HoloKnobVisual({ size = 38, norm = 0 }) {
  const s = size;
  const cx = s / 2, cy = s / 2;
  // The inner circle rotates — notch angle maps norm 0→-135deg, norm 1→135deg
  const rotateDeg = -135 + norm * 270;
  // Corner bracket arm length
  const bArm = s * 0.18;
  const bOff = s * 0.06;
  // Inner circle radius
  const cr = s * 0.28;

  return (
    <svg width={s} height={s} style={{ display: 'block', pointerEvents: 'none' }}>
      {/* Outer square frame */}
      <rect x={bOff} y={bOff} width={s - bOff * 2} height={s - bOff * 2}
        fill="none" stroke="rgba(0,220,210,0.35)" strokeWidth="1" />
      {/* Crosshair horizontal line */}
      <line x1={bOff} y1={cy} x2={s - bOff} y2={cy}
        stroke="rgba(0,255,240,0.45)" strokeWidth="0.8" />
      {/* Crosshair vertical line */}
      <line x1={cx} y1={bOff} x2={cx} y2={s - bOff}
        stroke="rgba(0,255,240,0.45)" strokeWidth="0.8" />
      {/* Corner bracket TL */}
      <path d={`M ${bOff} ${bOff + bArm} L ${bOff} ${bOff} L ${bOff + bArm} ${bOff}`}
        fill="none" stroke="rgba(0,240,220,0.8)" strokeWidth="1.5" strokeLinecap="square" />
      {/* Corner bracket TR */}
      <path d={`M ${s - bOff - bArm} ${bOff} L ${s - bOff} ${bOff} L ${s - bOff} ${bOff + bArm}`}
        fill="none" stroke="rgba(0,240,220,0.8)" strokeWidth="1.5" strokeLinecap="square" />
      {/* Corner bracket BL */}
      <path d={`M ${bOff} ${s - bOff - bArm} L ${bOff} ${s - bOff} L ${bOff + bArm} ${s - bOff}`}
        fill="none" stroke="rgba(0,240,220,0.8)" strokeWidth="1.5" strokeLinecap="square" />
      {/* Corner bracket BR */}
      <path d={`M ${s - bOff - bArm} ${s - bOff} L ${s - bOff} ${s - bOff} L ${s - bOff} ${s - bOff - bArm}`}
        fill="none" stroke="rgba(0,240,220,0.8)" strokeWidth="1.5" strokeLinecap="square" />
      {/* Rotating inner circle with notch */}
      <g transform={`rotate(${rotateDeg}, ${cx}, ${cy})`}>
        {/* Circle track */}
        <circle cx={cx} cy={cy} r={cr} fill="rgba(0,180,180,0.06)"
          stroke="rgba(0,220,210,0.5)" strokeWidth="1.2" />
        {/* Notch gap — a short bright line from center toward top of circle */}
        <line x1={cx} y1={cy - cr + 2} x2={cx} y2={cy - cr - 4}
          stroke="rgba(0,255,240,1)" strokeWidth="2" strokeLinecap="round" />
        {/* Small dot at notch */}
        <circle cx={cx} cy={cy - cr} r="1.8" fill="rgba(0,255,240,0.9)" />
      </g>
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="1.5" fill={`rgba(0,255,240,${0.3 + norm * 0.5})`} />
    </svg>
  );
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = { x: cx + Math.cos(startAngle) * r, y: cy + Math.sin(startAngle) * r };
  const end = { x: cx + Math.cos(endAngle) * r, y: cy + Math.sin(endAngle) * r };
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
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
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab', position: 'relative' }}>
        <HoloKnobVisual size={size} norm={norm} dragging={dragging} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'rgba(80, 210, 200, 0.6)', fontWeight: 600, textAlign: 'center',
        width: '100%', lineHeight: 1.2, fontFamily: 'system-ui',
        textShadow: '0 0 8px rgba(60, 200, 200, 0.15)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(80, 200, 200, 0.35)',
        fontFamily: '"Courier New",monospace', fontWeight: 600, textAlign: 'center', width: '100%',
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
          background: 'rgba(5, 15, 20, 0.8)',
          border: '0.5px solid rgba(60, 180, 180, 0.1)',
        }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 1, right: 1,
          height: `${norm * 100}%`,
          background: 'linear-gradient(to top, rgba(60, 180, 180, 0.15), rgba(80, 220, 210, 0.08))',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 3,
          background: 'rgba(80, 220, 210, 0.5)',
          bottom: `calc(${norm * 100}% - 2px)`,
          boxShadow: '0 0 6px rgba(80, 220, 210, 0.25)',
        }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(80, 200, 200, 0.3)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(80, 200, 200, 0.25)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
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
      background: 'rgba(5, 12, 16, 0.8)', padding: '3px 2px', borderRadius: 3,
      border: '0.5px solid rgba(60, 180, 180, 0.06)', position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 1, background: 'rgba(60, 180, 180, 0.04)' }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{
    fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700,
    color: 'rgba(80, 200, 200, 0.3)', letterSpacing: '0.05em',
    width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2,
  }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    segmentEls[i].style.background = dB > threshDb
      ? (i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#60ddd0' : 'rgba(80, 200, 200, 0.5)')
      : 'rgba(60, 180, 180, 0.04)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#60ddd0' : 'rgba(80, 200, 200, 0.3)';
    dbEl.firstChild.textContent = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',             lock: 0.45, presence: 0.40, body: 0.50, stability: 0.50, mix: 1,   outputDb: 0 },
  { name: 'LEAD VOCAL SIT',   lock: 0.60, presence: 0.55, body: 0.50, stability: 0.60, mix: 1,   outputDb: 0 },
  { name: 'POP HOOK FORWARD', lock: 0.70, presence: 0.70, body: 0.40, stability: 0.55, mix: 1,   outputDb: 1 },
  { name: 'RAP CONTROL',      lock: 0.80, presence: 0.45, body: 0.55, stability: 0.75, mix: 1,   outputDb: 0 },
  { name: 'INDIE INTIMATE',   lock: 0.35, presence: 0.30, body: 0.60, stability: 0.40, mix: 0.8, outputDb: -1 },
  { name: 'BACKGROUND TUCK',  lock: 0.50, presence: 0.25, body: 0.45, stability: 0.65, mix: 1,   outputDb: -3 },
];

const PRESET_COLORS = {
  bg: '#081418', text: 'rgba(100,220,210,0.75)', textDim: 'rgba(80,200,200,0.4)',
  border: 'rgba(60,180,180,0.1)', hoverBg: 'rgba(60,180,180,0.06)', activeBg: 'rgba(60,180,180,0.05)',
};

// ─── CSS Keyframes ────────────────────────────────────────────────────────
const STYLE_ID = 'vocallock-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes vlockPulse {
      0%, 100% { box-shadow: 0 0 8px rgba(80,220,210,0.15); }
      50% { box-shadow: 0 0 16px rgba(80,220,210,0.3); }
    }
    @keyframes vlockScan {
      0% { top: 0; } 100% { top: 100%; }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main VocalLock Orb ──────────────────────────────────────────────────
export default function VocalLockOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [lock,       setLock]       = useState(initialState?.lock       ?? 0.45);
  const [presence,   setPresence]   = useState(initialState?.presence   ?? 0.40);
  const [body,       setBody]       = useState(initialState?.body       ?? 0.50);
  const [stability,  setStability]  = useState(initialState?.stability  ?? 0.50);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1);
  const [outputDb,   setOutputDb]   = useState(initialState?.outputDb   ?? 0);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [gainReduction, setGainReduction] = useState(0);
  const [peak, setPeak] = useState(0);

  const inMeterRef = useRef(null), outMeterRef = useRef(null);
  const inDbRef = useRef(null), outDbRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, lock, presence, body, stability, mix, outputDb, bypassed };

  // ── Engine init ──
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createVocalLockEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setLock(s.lock); eng.setPresence(s.presence); eng.setBody(s.body);
      eng.setStability(s.stability); eng.setMix(s.mix); eng.setOutputDb(s.outputDb);
      eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  // ── Meter RAF ──
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setGainReduction(engineRef.current.getGainReduction());
        setPeak(engineRef.current.getInputPeak());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, lock, presence, body, stability, mix, outputDb, bypassed, preset: activePreset });
  }, [inputGain, outputGain, lock, presence, body, stability, mix, outputDb, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setLock(p.lock); setPresence(p.presence); setBody(p.body);
    setStability(p.stability); setMix(p.mix); setOutputDb(p.outputDb); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setLock(p.lock); e.setPresence(p.presence); e.setBody(p.body); e.setStability(p.stability); e.setMix(p.mix); e.setOutputDb(p.outputDb); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outDbFmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`;

  return (
    <div style={{
      width: 380, borderRadius: 8, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #081418 0%, #060f14 25%, #040a0e 50%, #030810 75%, #061014 100%)',
      border: '1.5px solid rgba(60,180,180,0.12)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 30px rgba(60,200,200,0.06), inset 0 1px 0 rgba(80,220,220,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(60,180,180,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(60,180,180,0.03) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.12em',
            background: 'linear-gradient(135deg, #60ddd0 0%, #40b8b0 40%, #80fff0 70%, #60ddd0 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 10px rgba(80,220,210,0.3))',
          }}>VOCALLOCK</span>
          <span style={{
            fontSize: 6, fontWeight: 600, color: 'rgba(80,200,200,0.3)',
            letterSpacing: '0.4em', marginTop: 3, textTransform: 'uppercase',
          }}>targeting reticle</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(80,200,200,0.3)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 3, transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
          >×</span>}
        </div>
      </div>

      {/* Holographic Reticle (Hero) */}
      <div style={{ borderBottom: '1px solid rgba(60,180,180,0.05)', position: 'relative', zIndex: 2 }}>
        <HoloReticle lock={lock} presence={presence} body={body} stability={stability} gainReduction={gainReduction} peak={peak} />
      </div>

      {/* GR Meter */}
      <div style={{ borderBottom: '1px solid rgba(60,180,180,0.05)', position: 'relative', zIndex: 2 }}>
        <GrMeter gainReduction={gainReduction} />
      </div>

      {/* Meters + gain sliders */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(60,180,180,0.05)', position: 'relative', zIndex: 2,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs row 1: LOCK, PRESENCE, BODY */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(60,180,180,0.05)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="LOCK" value={lock} defaultValue={0.45} size={28} format={pctFmt} onChange={v => { setLock(v); engineRef.current?.setLock(v); setActivePreset(null); }} />
        <Knob label="PRESENCE" value={presence} defaultValue={0.40} size={28} format={pctFmt} onChange={v => { setPresence(v); engineRef.current?.setPresence(v); setActivePreset(null); }} />
        <Knob label="BODY" value={body} defaultValue={0.50} size={28} format={pctFmt} onChange={v => { setBody(v); engineRef.current?.setBody(v); setActivePreset(null); }} />
      </div>

      {/* Knobs row 2: STABILITY, MIX, OUTPUT */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(60,180,180,0.05)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="STABILITY" value={stability} defaultValue={0.50} size={28} format={pctFmt} onChange={v => { setStability(v); engineRef.current?.setStability(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1} size={28} format={pctFmt} onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
        <Knob label="OUTPUT" value={outputDb} min={-18} max={18} defaultValue={0} size={28} format={outDbFmt} sensitivity={120} onChange={v => { setOutputDb(v); engineRef.current?.setOutputDb(v); setActivePreset(null); }} />
      </div>

      {/* Bypass */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        position: 'relative', zIndex: 2,
      }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
          background: bypassed ? 'rgba(10, 20, 25, 0.5)' : 'rgba(15, 30, 35, 0.7)',
          border: `1.5px solid ${bypassed ? 'rgba(60, 160, 160, 0.12)' : 'rgba(80, 220, 210, 0.35)'}`,
          boxShadow: bypassed ? 'none' : '0 0 12px rgba(80, 220, 210, 0.2)',
          animation: bypassed ? 'none' : 'vlockPulse 3s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'border-color 0.3s, box-shadow 0.3s',
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ opacity: bypassed ? 0.2 : 0.7 }}>
            <circle cx="7" cy="7" r="5" fill="none" stroke="rgba(80,220,210,0.6)" strokeWidth="1" />
            <circle cx="7" cy="7" r="2" fill="rgba(80,220,210,0.4)" />
          </svg>
        </button>
        <span style={{
          fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
          color: bypassed ? 'rgba(60, 160, 160, 0.25)' : 'rgba(80, 220, 210, 0.45)',
          marginLeft: 6, textTransform: 'uppercase', fontFamily: 'system-ui',
        }}>{bypassed ? 'OFFLINE' : 'LOCKED'}</span>
      </div>
    </div>
  );
}
