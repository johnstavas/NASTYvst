import { useState, useEffect, useRef, useCallback } from 'react';
import { createVibeMicEngine } from './vibemicEngine';
import PresetSelector from './PresetSelector';

// ─── VIBEMIC: Vintage Microphone Studio ───────────────────────────────────
// Visual world: rotating mic silhouette morphing per mode, tube glow,
// sound waves wrapping the mic. Colors: warm gold/copper.

// ─── Mic Studio Canvas (Hero) ─────────────────────────────────────────────
function MicStudio({ micType, proximity, presShape, character, focus, peak }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ micType: 0, proximity: 0.5, presShape: 0.5, character: 0.4, focus: 0.5, peak: 0 });
  const phaseRef = useRef(0);
  const tubeGlowRef = useRef(0);
  const waveHistRef = useRef(new Float32Array(80).fill(0));
  const dustParticlesRef = useRef(
    Array.from({ length: 45 }, () => ({
      x: Math.random() * 260, y: Math.random() * 165,
      vx: (Math.random() - 0.5) * 0.3, vy: -0.1 - Math.random() * 0.4,
      size: 0.8 + Math.random() * 2.5, alpha: 0.3 + Math.random() * 0.6,
      shimmer: Math.random() * Math.PI * 2,
    }))
  );
  const vuNeedleRef = useRef(0);
  const grainSeedRef = useRef(Math.random() * 1000);

  useEffect(() => { valRef.current = { micType, proximity, presShape, character, focus, peak }; },
    [micType, proximity, presShape, character, focus, peak]);

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
      phaseRef.current += 0.015;
      const t = phaseRef.current;
      const v = valRef.current;

      // ── Rich warm studio background ──
      var bg = ctx.createRadialGradient(W / 2, H / 2 - 10, 0, W / 2, H / 2, W * 0.7);
      bg.addColorStop(0, 'rgba(40, 25, 10, 0.94)');
      bg.addColorStop(0.4, 'rgba(25, 15, 5, 0.96)');
      bg.addColorStop(1, 'rgba(10, 6, 2, 1)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      var cx = W / 2;
      var cy = H / 2;
      var mt = Math.round(v.micType);
      var peakBright = Math.min(1, v.peak * 2.5);

      // Tube glow follows character
      tubeGlowRef.current += (v.character - tubeGlowRef.current) * 0.05;
      var tubeGlow = tubeGlowRef.current;

      // ── Film grain texture overlay ──
      grainSeedRef.current += 1;
      var grainSeed = grainSeedRef.current;
      for (var gi = 0; gi < 300; gi++) {
        var gx = ((grainSeed * 13 + gi * 97) % W);
        var gy = ((grainSeed * 7 + gi * 53) % H);
        var gAlpha = 0.03 + Math.sin(gi * 0.1 + grainSeed * 0.01) * 0.02;
        ctx.fillStyle = 'rgba(255, 220, 150, ' + gAlpha + ')';
        ctx.fillRect(gx, gy, 1, 1);
      }

      // ── Large warm amber/tube glow behind mic ──
      var ambGlow = ctx.createRadialGradient(cx, cy - 5, 0, cx, cy, 80 + peakBright * 30);
      ambGlow.addColorStop(0, 'rgba(255, 180, 60, ' + (0.12 + tubeGlow * 0.15 + peakBright * 0.1) + ')');
      ambGlow.addColorStop(0.3, 'rgba(230, 140, 40, ' + (0.06 + tubeGlow * 0.08) + ')');
      ambGlow.addColorStop(0.6, 'rgba(200, 100, 20, ' + (0.03 + tubeGlow * 0.04) + ')');
      ambGlow.addColorStop(1, 'rgba(120, 60, 10, 0)');
      ctx.fillStyle = ambGlow;
      ctx.fillRect(0, 0, W, H);

      // ── Sound wave rings emanating from center (bright gold) ──
      var hist = waveHistRef.current;
      for (var hi = hist.length - 1; hi > 0; hi--) hist[hi] = hist[hi - 1];
      hist[0] = v.peak;

      for (var w = 0; w < hist.length; w++) {
        var waveR = 30 + w * 2;
        var waveAlpha = Math.max(0, (0.35 - w * 0.004) * (0.3 + hist[w] * 4));
        if (waveAlpha < 0.008) continue;
        // Full circle wave rings
        ctx.beginPath();
        ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
        var waveHue = 35 + w * 0.5;
        ctx.strokeStyle = 'hsla(' + waveHue + ', 90%, ' + (55 + peakBright * 15) + '%, ' + waveAlpha + ')';
        ctx.lineWidth = 1.5 - w * 0.012;
        ctx.stroke();
      }

      // ── Draw mic silhouette (morphs per mode) -- BRIGHT VERSION ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(t * 0.2) * 0.04);

      var micShapes = [
        // 0: Vintage Tube -- large, round, warm glow
        function() {
          ctx.beginPath();
          ctx.ellipse(0, 0, 18, 32, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(220, 170, 80, ' + (0.25 + tubeGlow * 0.15) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 210, 120, ' + (0.6 + tubeGlow * 0.2) + ')';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Grille lines
          for (var g = -24; g <= 24; g += 4) {
            var gw = Math.sqrt(Math.max(0, 324 - g * g)) * (18 / 18);
            ctx.beginPath();
            ctx.moveTo(-gw, g); ctx.lineTo(gw, g);
            ctx.strokeStyle = 'rgba(255, 200, 100, ' + (0.15 + peakBright * 0.1) + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
          // BIG tube glow inside
          var tg = ctx.createRadialGradient(0, 5, 0, 0, 5, 18);
          tg.addColorStop(0, 'rgba(255, 180, 50, ' + (0.3 + tubeGlow * 0.35 + peakBright * 0.2) + ')');
          tg.addColorStop(0.5, 'rgba(255, 120, 20, ' + (0.1 + tubeGlow * 0.15) + ')');
          tg.addColorStop(1, 'rgba(200, 80, 10, 0)');
          ctx.fillStyle = tg;
          ctx.fillRect(-20, -15, 40, 35);
          // Stand
          ctx.beginPath();
          ctx.moveTo(-3, 32); ctx.lineTo(-3, 55); ctx.lineTo(3, 55); ctx.lineTo(3, 32);
          ctx.fillStyle = 'rgba(180, 130, 60, 0.3)';
          ctx.fill();
        },
        // 1: Broadcast -- SM7B rectangular
        function() {
          ctx.beginPath();
          ctx.roundRect(-16, -32, 32, 64, 8);
          ctx.fillStyle = 'rgba(160, 145, 120, ' + (0.2 + tubeGlow * 0.08) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(220, 200, 160, ' + (0.5 + tubeGlow * 0.2) + ')';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          for (var gy = -26; gy <= 26; gy += 4) {
            for (var gx2 = -12; gx2 <= 12; gx2 += 4) {
              ctx.beginPath();
              ctx.arc(gx2, gy, 1, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(200, 180, 140, ' + (0.2 + peakBright * 0.15) + ')';
              ctx.fill();
            }
          }
          ctx.beginPath();
          ctx.moveTo(-8, 32); ctx.lineTo(-8, 55); ctx.lineTo(8, 55); ctx.lineTo(8, 32);
          ctx.fillStyle = 'rgba(160, 130, 80, 0.2)';
          ctx.fill();
        },
        // 2: Modern Condenser -- tall, slim
        function() {
          ctx.beginPath();
          ctx.ellipse(0, -5, 12, 36, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(200, 200, 210, ' + (0.15 + tubeGlow * 0.06) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(240, 240, 250, ' + (0.4 + tubeGlow * 0.15) + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(0, -22, 10, 12, 0, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.3 + peakBright * 0.2) + ')';
          ctx.lineWidth = 0.8;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, 31); ctx.lineTo(0, 55);
          ctx.strokeStyle = 'rgba(200, 200, 210, 0.3)';
          ctx.lineWidth = 2;
          ctx.stroke();
        },
        // 3: Dark Ribbon -- figure-8
        function() {
          // Top lobe
          ctx.beginPath();
          ctx.ellipse(0, -16, 14, 18, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(140, 110, 70, ' + (0.2 + tubeGlow * 0.08) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(200, 160, 100, ' + (0.5 + tubeGlow * 0.2) + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          // Bottom lobe (figure 8)
          ctx.beginPath();
          ctx.ellipse(0, 16, 14, 18, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(130, 100, 60, ' + (0.15 + tubeGlow * 0.06) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(190, 150, 90, ' + (0.4 + tubeGlow * 0.15) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
          // Side slots
          for (var s = -12; s <= 12; s += 3) {
            ctx.beginPath();
            ctx.moveTo(-13, -16 + s); ctx.lineTo(-10, -16 + s);
            ctx.moveTo(10, -16 + s); ctx.lineTo(13, -16 + s);
            ctx.strokeStyle = 'rgba(200, 160, 90, 0.25)';
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        },
        // 4: Phone/Lo-Fi
        function() {
          ctx.beginPath();
          ctx.roundRect(-10, -22, 20, 44, 5);
          ctx.fillStyle = 'rgba(120, 120, 130, ' + (0.2 + tubeGlow * 0.08) + ')';
          ctx.fill();
          ctx.strokeStyle = 'rgba(180, 180, 190, ' + (0.5 + tubeGlow * 0.15) + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          for (var row = -16; row <= 16; row += 3) {
            for (var col = -6; col <= 6; col += 3) {
              ctx.beginPath();
              ctx.arc(col, row, 1, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(80, 80, 90, ' + (0.3 + peakBright * 0.2) + ')';
              ctx.fill();
            }
          }
          ctx.beginPath();
          ctx.moveTo(5, -22); ctx.lineTo(10, -38);
          ctx.strokeStyle = 'rgba(180, 180, 190, 0.3)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        },
      ];

      (micShapes[mt] || micShapes[0])();
      ctx.restore();

      // ── Proximity warm glow ring ──
      if (v.proximity > 0.1) {
        var proxR = 40 + v.proximity * 25;
        var proxGlow = ctx.createRadialGradient(cx, cy, proxR * 0.3, cx, cy, proxR);
        proxGlow.addColorStop(0, 'rgba(255, 180, 60, ' + (v.proximity * 0.15 + peakBright * 0.08) + ')');
        proxGlow.addColorStop(0.5, 'rgba(230, 140, 30, ' + (v.proximity * 0.06) + ')');
        proxGlow.addColorStop(1, 'rgba(180, 100, 20, 0)');
        ctx.fillStyle = proxGlow;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Focus ring (bright dashed gold) ──
      var focusR = 40 + (1 - v.focus) * 30;
      ctx.beginPath();
      ctx.arc(cx, cy, focusR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 210, 100, ' + (0.15 + v.focus * 0.2) + ')';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Floating golden dust particles ──
      var dust = dustParticlesRef.current;
      for (var di = 0; di < dust.length; di++) {
        var dp = dust[di];
        dp.x += dp.vx + Math.sin(t * 0.3 + di) * 0.15;
        dp.y += dp.vy;
        dp.shimmer += 0.05;
        if (dp.y < -5) { dp.y = H + 5; dp.x = Math.random() * W; }
        if (dp.x < -5) dp.x = W + 5;
        if (dp.x > W + 5) dp.x = -5;

        var dAlpha = dp.alpha * (0.4 + 0.4 * Math.sin(dp.shimmer)) * (0.5 + peakBright * 0.5);
        var dSize = dp.size * (0.8 + peakBright * 0.5);

        // Golden dust with bright shimmer
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dSize, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 220, 100, ' + dAlpha + ')';
        ctx.fill();
        // Glow halo
        var dGlow = ctx.createRadialGradient(dp.x, dp.y, 0, dp.x, dp.y, dSize * 5);
        dGlow.addColorStop(0, 'rgba(255, 200, 60, ' + (dAlpha * 0.25) + ')');
        dGlow.addColorStop(1, 'rgba(200, 150, 30, 0)');
        ctx.fillStyle = dGlow;
        ctx.fillRect(dp.x - dSize * 5, dp.y - dSize * 5, dSize * 10, dSize * 10);
      }

      // ── Analog VU meter (drawn on canvas) ──
      var vuCx = cx;
      var vuCy = 22;
      var vuR = 18;
      // VU background arc
      ctx.beginPath();
      ctx.arc(vuCx, vuCy + 8, vuR, Math.PI * 1.15, Math.PI * 1.85);
      ctx.strokeStyle = 'rgba(255, 210, 120, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // VU scale marks
      for (var vm = 0; vm <= 10; vm++) {
        var vmAngle = Math.PI * 1.15 + (vm / 10) * (Math.PI * 0.7);
        var vmIx = vuCx + Math.cos(vmAngle) * (vuR - 3);
        var vmIy = vuCy + 8 + Math.sin(vmAngle) * (vuR - 3);
        var vmOx = vuCx + Math.cos(vmAngle) * vuR;
        var vmOy = vuCy + 8 + Math.sin(vmAngle) * vuR;
        ctx.beginPath();
        ctx.moveTo(vmIx, vmIy);
        ctx.lineTo(vmOx, vmOy);
        ctx.strokeStyle = vm >= 8 ? 'rgba(255, 80, 60, 0.7)' : 'rgba(255, 210, 120, 0.5)';
        ctx.lineWidth = vm % 5 === 0 ? 1.2 : 0.5;
        ctx.stroke();
      }
      // VU needle (animated, swinging with audio)
      var targetNeedle = Math.min(1, v.peak * 3);
      vuNeedleRef.current += (targetNeedle - vuNeedleRef.current) * 0.12;
      var needlePos = vuNeedleRef.current;
      var needleAngle = Math.PI * 1.15 + needlePos * (Math.PI * 0.7);
      var needleEndX = vuCx + Math.cos(needleAngle) * (vuR + 2);
      var needleEndY = vuCy + 8 + Math.sin(needleAngle) * (vuR + 2);
      ctx.beginPath();
      ctx.moveTo(vuCx, vuCy + 8);
      ctx.lineTo(needleEndX, needleEndY);
      var needleColor = needlePos > 0.8 ? 'rgba(255, 80, 50, 0.9)' : 'rgba(255, 200, 80, 0.8)';
      ctx.strokeStyle = needleColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Needle pivot dot
      ctx.beginPath();
      ctx.arc(vuCx, vuCy + 8, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 210, 100, 0.8)';
      ctx.fill();

      // ── Mic type label (bright) ──
      var modeNames = ['VINTAGE TUBE', 'BROADCAST', 'MODERN COND', 'DARK RIBBON', 'PHONE/LO-FI'];
      ctx.font = '700 7px system-ui';
      ctx.fillStyle = 'rgba(255, 210, 120, 0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(modeNames[mt] || 'VINTAGE TUBE', cx, H - 10);

      // ── Character warm bar at bottom (thick, bright) ──
      var charNorm = Math.min(1, v.character);
      var charBarW = W * 0.5;
      var charBarX = cx - charBarW / 2;
      ctx.fillStyle = 'rgba(30, 18, 8, 0.6)';
      ctx.fillRect(charBarX, H - 5, charBarW, 4);
      var charGrad = ctx.createLinearGradient(charBarX, 0, charBarX + charBarW * charNorm, 0);
      charGrad.addColorStop(0, 'rgba(255, 180, 50, ' + (0.6 + peakBright * 0.3) + ')');
      charGrad.addColorStop(1, 'rgba(255, 120, 20, ' + (0.5 + peakBright * 0.3) + ')');
      ctx.fillStyle = charGrad;
      ctx.fillRect(charBarX, H - 5, charBarW * charNorm, 4);

      // ── Warm vignette border ──
      var vignette = ctx.createRadialGradient(cx, cy, W * 0.3, cx, cy, W * 0.7);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 160, display: 'block', borderRadius: 6 }} />;
}

// ─── Copper/Gold Arc Knob ─────────────────────────────────────────────────
// Vintage bakelite studio dial — CSS rotary knob with pointer dot, no SVG
function CopperKnobVisual({ size = 38, norm = 0, dragging }) {
  const rotateDeg = -135 + norm * 270;
  return (
    <div style={{ width: size, height: size, position: 'relative', borderRadius: '50%', pointerEvents: 'none' }}>
      {/* Outer ring glow */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 25%, rgba(220,165,55,0.18), rgba(30,18,8,0.85))',
        border: `1px solid rgba(180,130,45,${dragging ? 0.55 : 0.28})`,
        boxShadow: dragging ? '0 0 10px rgba(220,160,50,0.25), inset 0 0 6px rgba(0,0,0,0.7)' : 'inset 0 0 6px rgba(0,0,0,0.7)',
      }} />
      {/* Rotating face with pointer dot */}
      <div style={{
        position: 'absolute', inset: 3, borderRadius: '50%',
        background: 'radial-gradient(circle at 40% 30%, rgba(60,38,12,0.9), rgba(14,8,2,0.95))',
        border: '0.5px solid rgba(140,95,28,0.2)',
        transform: `rotate(${rotateDeg}deg)`,
      }}>
        {/* Pointer dot near top */}
        <div style={{
          position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)',
          width: dragging ? 5 : 4, height: dragging ? 5 : 4, borderRadius: '50%',
          background: dragging ? 'rgba(255,210,80,1)' : 'rgba(220,168,55,0.9)',
          boxShadow: dragging ? '0 0 6px rgba(255,200,60,0.7)' : '0 0 3px rgba(200,150,40,0.4)',
        }} />
      </div>
      {/* Center cap */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 6, height: 6, borderRadius: '50%',
        background: 'rgba(180,130,45,0.4)',
        border: '0.5px solid rgba(220,170,60,0.3)',
      }} />
    </div>
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
        <CopperKnobVisual size={size} norm={norm} dragging={dragging} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(210, 160, 80, 0.6)', fontWeight: 600, textAlign: 'center',
        width: '100%', lineHeight: 1.2, fontFamily: 'system-ui',
        textShadow: '0 0 8px rgba(200, 140, 50, 0.1)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(190, 140, 70, 0.35)',
        fontFamily: '"Courier New",monospace', fontWeight: 600, textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

// ─── Mic Type Selector ───────────────────────────────────────────────────
function MicTypeSelector({ value, onChange }) {
  const types = ['TUBE', 'BCAST', 'COND', 'RIBBON', 'LO-FI'];
  return (
    <div style={{ display: 'flex', gap: 1, padding: '0 6px', position: 'relative', zIndex: 2 }}>
      {types.map((name, i) => (
        <button key={i} onClick={() => onChange(i)} style={{
          flex: 1, fontSize: 5.5, fontWeight: 700, fontFamily: 'system-ui',
          letterSpacing: '0.06em', padding: '4px 1px', cursor: 'pointer',
          background: i === value ? 'rgba(200, 150, 60, 0.15)' : 'rgba(18, 12, 6, 0.5)',
          color: i === value ? 'rgba(240, 190, 90, 0.85)' : 'rgba(180, 130, 60, 0.3)',
          border: `1px solid ${i === value ? 'rgba(200, 150, 60, 0.25)' : 'rgba(140, 100, 40, 0.08)'}`,
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
          background: 'rgba(15, 10, 5, 0.8)',
          border: '0.5px solid rgba(180, 130, 50, 0.1)',
        }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`,
          background: 'linear-gradient(to top, rgba(200, 150, 60, 0.15), rgba(180, 130, 50, 0.06))',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 3,
          background: 'rgba(220, 170, 70, 0.5)', bottom: `calc(${norm * 100}% - 2px)`,
          boxShadow: '0 0 6px rgba(200, 150, 50, 0.25)',
        }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(200, 150, 70, 0.3)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(180, 130, 60, 0.25)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
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
      background: 'rgba(12, 8, 4, 0.8)', padding: '3px 2px', borderRadius: 3,
      border: '0.5px solid rgba(180, 130, 50, 0.06)', position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 1, background: 'rgba(180, 130, 50, 0.04)' }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{
    fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700,
    color: 'rgba(200, 150, 70, 0.3)', letterSpacing: '0.05em',
    width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2,
  }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    segmentEls[i].style.background = dB > threshDb
      ? (i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#e0b050' : 'rgba(200, 150, 60, 0.5)')
      : 'rgba(180, 130, 50, 0.04)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#e0b050' : 'rgba(200, 150, 70, 0.3)';
    dbEl.firstChild.textContent = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',              micType: 0, proximity: 0.50, presShape: 0.50, character: 0.40, focus: 0.50, mix: 1,   outputDb: 0 },
  { name: 'CHEAP MIC RESCUE',  micType: 2, proximity: 0.40, presShape: 0.60, character: 0.30, focus: 0.65, mix: 1,   outputDb: 1 },
  { name: 'MODERN AIR VOCAL',  micType: 2, proximity: 0.25, presShape: 0.70, character: 0.20, focus: 0.80, mix: 0.9, outputDb: 0 },
  { name: 'WARM TUBE LEAD',    micType: 0, proximity: 0.60, presShape: 0.45, character: 0.55, focus: 0.50, mix: 1,   outputDb: 0 },
  { name: 'PODCAST BROADCAST', micType: 1, proximity: 0.45, presShape: 0.55, character: 0.35, focus: 0.60, mix: 1,   outputDb: 0 },
  { name: 'LO-FI HOOK',        micType: 4, proximity: 0.30, presShape: 0.40, character: 0.70, focus: 0.30, mix: 0.8, outputDb: 2 },
];

const PRESET_COLORS = {
  bg: '#120c06', text: 'rgba(220,170,80,0.75)', textDim: 'rgba(190,140,60,0.4)',
  border: 'rgba(180,130,50,0.1)', hoverBg: 'rgba(180,130,50,0.06)', activeBg: 'rgba(180,130,50,0.05)',
};

const STYLE_ID = 'vibemic-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes vmicGlow {
      0%, 100% { box-shadow: 0 0 8px rgba(200,150,50,0.12); }
      50% { box-shadow: 0 0 14px rgba(220,170,60,0.25); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main VibeMic Orb ────────────────────────────────────────────────────
export default function VibeMicOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [micType,    setMicType]    = useState(initialState?.micType    ?? 0);
  const [proximity,  setProximity]  = useState(initialState?.proximity  ?? 0.50);
  const [presShape,  setPresShape]  = useState(initialState?.presShape  ?? 0.50);
  const [character,  setCharacter]  = useState(initialState?.character  ?? 0.40);
  const [focus,      setFocus]      = useState(initialState?.focus      ?? 0.50);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1);
  const [outputDb,   setOutputDb]   = useState(initialState?.outputDb   ?? 0);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak, setPeak] = useState(0);

  const inMeterRef = useRef(null), outMeterRef = useRef(null);
  const inDbRef = useRef(null), outDbRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, micType, proximity, presShape, character, focus, mix, outputDb, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createVibeMicEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setMicType(s.micType); eng.setProximity(s.proximity); eng.setPresShape(s.presShape);
      eng.setCharacter(s.character); eng.setFocus(s.focus); eng.setMix(s.mix); eng.setOutputDb(s.outputDb);
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
        setPeak(engineRef.current.getInputPeak());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, micType, proximity, presShape, character, focus, mix, outputDb, bypassed, preset: activePreset });
  }, [inputGain, outputGain, micType, proximity, presShape, character, focus, mix, outputDb, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setMicType(p.micType); setProximity(p.proximity); setPresShape(p.presShape);
    setCharacter(p.character); setFocus(p.focus); setMix(p.mix); setOutputDb(p.outputDb); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setMicType(p.micType); e.setProximity(p.proximity); e.setPresShape(p.presShape); e.setCharacter(p.character); e.setFocus(p.focus); e.setMix(p.mix); e.setOutputDb(p.outputDb); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outDbFmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`;

  return (
    <div style={{
      width: 380, borderRadius: 8, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #1a1008 0%, #140c04 25%, #0e0804 50%, #0a0603 75%, #100a06 100%)',
      border: '1.5px solid rgba(200,150,60,0.12)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 30px rgba(200,140,40,0.05), inset 0 1px 0 rgba(240,180,60,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(200,150,60,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(200,150,60,0.03) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.12em',
            background: 'linear-gradient(135deg, #e0b050 0%, #c09030 40%, #f0d070 70%, #d0a040 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 10px rgba(200,150,50,0.25))',
          }}>VIBEMIC</span>
          <span style={{
            fontSize: 6, fontWeight: 600, color: 'rgba(200,150,60,0.3)',
            letterSpacing: '0.35em', marginTop: 3, textTransform: 'uppercase',
          }}>studio character</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(200,150,60,0.3)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 3, transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
          >×</span>}
        </div>
      </div>

      {/* Mic Studio (Hero) */}
      <div style={{ borderBottom: '1px solid rgba(200,150,60,0.05)', position: 'relative', zIndex: 2 }}>
        <MicStudio micType={micType} proximity={proximity} presShape={presShape} character={character} focus={focus} peak={peak} />
      </div>

      {/* Mic Type Selector */}
      <div style={{ padding: '5px 0', borderBottom: '1px solid rgba(200,150,60,0.05)' }}>
        <MicTypeSelector value={micType} onChange={v => { setMicType(v); engineRef.current?.setMicType(v); setActivePreset(null); }} />
      </div>

      {/* Meters */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(200,150,60,0.05)', position: 'relative', zIndex: 2,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs row 1: PROXIMITY, PRESENCE, CHARACTER */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(200,150,60,0.05)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="PROXIMITY" value={proximity} defaultValue={0.50} size={28} format={pctFmt} onChange={v => { setProximity(v); engineRef.current?.setProximity(v); setActivePreset(null); }} />
        <Knob label="PRESENCE" value={presShape} defaultValue={0.50} size={28} format={pctFmt} onChange={v => { setPresShape(v); engineRef.current?.setPresShape(v); setActivePreset(null); }} />
        <Knob label="CHARACTER" value={character} defaultValue={0.40} size={28} format={pctFmt} onChange={v => { setCharacter(v); engineRef.current?.setCharacter(v); setActivePreset(null); }} />
      </div>

      {/* Knobs row 2: FOCUS, MIX, OUTPUT */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(200,150,60,0.05)', position: 'relative', zIndex: 2,
      }}>
        <Knob label="FOCUS" value={focus} defaultValue={0.50} size={28} format={pctFmt} onChange={v => { setFocus(v); engineRef.current?.setFocus(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1} size={28} format={pctFmt} onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
        <Knob label="OUTPUT" value={outputDb} min={-18} max={18} defaultValue={0} size={28} format={outDbFmt} sensitivity={120} onChange={v => { setOutputDb(v); engineRef.current?.setOutputDb(v); setActivePreset(null); }} />
      </div>

      {/* Bypass */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', position: 'relative', zIndex: 2,
      }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
          background: bypassed ? 'rgba(18, 12, 6, 0.5)' : 'rgba(25, 18, 10, 0.7)',
          border: `1.5px solid ${bypassed ? 'rgba(160, 110, 40, 0.12)' : 'rgba(220, 170, 70, 0.35)'}`,
          boxShadow: bypassed ? 'none' : '0 0 12px rgba(200, 150, 50, 0.15)',
          animation: bypassed ? 'none' : 'vmicGlow 3s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'border-color 0.3s, box-shadow 0.3s',
        }}>
          {/* Mic icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ opacity: bypassed ? 0.2 : 0.6 }}>
            <ellipse cx="6" cy="4" rx="3" ry="4" fill="none" stroke="rgba(220,170,70,0.6)" strokeWidth="0.8" />
            <line x1="6" y1="8" x2="6" y2="11" stroke="rgba(220,170,70,0.6)" strokeWidth="0.8" />
            <line x1="4" y1="11" x2="8" y2="11" stroke="rgba(220,170,70,0.6)" strokeWidth="0.8" />
          </svg>
        </button>
        <span style={{
          fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
          color: bypassed ? 'rgba(160, 110, 40, 0.25)' : 'rgba(220, 170, 70, 0.45)',
          marginLeft: 6, textTransform: 'uppercase', fontFamily: 'system-ui',
        }}>{bypassed ? 'MUTED' : 'ON AIR'}</span>
      </div>
    </div>
  );
}
