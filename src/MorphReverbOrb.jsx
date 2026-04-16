import { useState, useEffect, useRef, useCallback } from 'react';
import { createMorphReverbEngine } from './morphReverbEngine';
import PresetSelector from './PresetSelector';

// ─── MORPHREVERB: Two Colliding Liquid Worlds ────────────────────────────────
// Space A = warm liquid (amber/gold) on left, Space B = cool liquid (teal/blue) on right.
// Morph blends them with fluid dynamics animation. Texture makes surface turbulent.

const SPACE_NAMES = ['PLATE', 'HALL', 'CHAMBER', 'ROOM', 'CLOUD'];
const SPACE_COLORS_A = ['#d4a040', '#c88830', '#b87828', '#a86820', '#e0b050'];
const SPACE_COLORS_B = ['#30a0b0', '#2888a0', '#207890', '#306878', '#40b0c0'];

// ─── Liquid Morph Canvas ─────────────────────────────────────────────────────
function LiquidMorphCanvas({ morph, texture, spaceA, spaceB, peakLevel = 0, bypassed }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const blobsRef = useRef(null);
  const valRef = useRef({ morph: 0.5, texture: 0.3, spaceA: 0, spaceB: 1, peakLevel: 0, bypassed: false });

  valRef.current = { morph, texture, spaceA, spaceB, peakLevel, bypassed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize metaball-like blobs for each side (more of them, bigger)
    if (!blobsRef.current) {
      var blobs = { a: [], b: [], droplets: [] };
      for (var i = 0; i < 10; i++) {
        blobs.a.push({
          x: 10 + Math.random() * (W * 0.4), y: 10 + Math.random() * (H - 20),
          r: 12 + Math.random() * 25, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
          phase: Math.random() * Math.PI * 2,
        });
        blobs.b.push({
          x: W * 0.55 + Math.random() * (W * 0.4), y: 10 + Math.random() * (H - 20),
          r: 12 + Math.random() * 25, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
          phase: Math.random() * Math.PI * 2,
        });
      }
      // Floating droplets
      for (var i = 0; i < 40; i++) {
        blobs.droplets.push({
          x: Math.random() * W, y: 10 + Math.random() * (H - 20),
          size: 1 + Math.random() * 3,
          vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.4,
          side: Math.random() < 0.5 ? 'a' : 'b',
          phase: Math.random() * Math.PI * 2,
        });
      }
      blobsRef.current = blobs;
    }

    var raf;
    var draw = function(t) {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.005;
      var phase = phaseRef.current;

      var v = valRef.current;
      var _morph = v.morph, _tex = v.texture, _spA = v.spaceA, _spB = v.spaceB, _peak = v.peakLevel, _bypassed = v.bypassed;
      var peak = _peak || 0;
      var dimFactor = _bypassed ? 0.18 : (0.5 + peak * 0.5);

      // ── Background: dark with caustic light patterns ──
      ctx.fillStyle = 'rgba(6,8,12,1)';
      ctx.fillRect(0, 0, W, H);

      // Subtle caustic light pattern
      for (var ci = 0; ci < 15; ci++) {
        var ccx = W * 0.2 + Math.sin(phase * 0.3 + ci * 1.7) * W * 0.35;
        var ccy = H * 0.3 + Math.cos(phase * 0.25 + ci * 1.3) * H * 0.35;
        var cr = 12 + Math.sin(phase * 0.5 + ci) * 6;
        var causticGrad = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, cr);
        causticGrad.addColorStop(0, 'rgba(60,80,60,' + (0.06 * dimFactor) + ')');
        causticGrad.addColorStop(1, 'rgba(40,60,40,0)');
        ctx.fillStyle = causticGrad;
        ctx.fillRect(ccx - cr, ccy - cr, cr * 2, cr * 2);
      }

      var blobs = blobsRef.current;
      var morphCenter = W * (0.15 + _morph * 0.7);
      var turbulence = _tex * 3;
      var spAIdx = Math.round(Math.max(0, Math.min(4, _spA)));
      var spBIdx = Math.round(Math.max(0, Math.min(4, _spB)));

      // ── Draw Space A liquid blobs (warm amber/gold, left side) ──
      for (var bi = 0; bi < blobs.a.length; bi++) {
        var blob = blobs.a[bi];
        blob.phase += 0.012;
        blob.x += blob.vx + Math.sin(phase * 1.5 + blob.phase) * turbulence * 0.6;
        blob.y += blob.vy + Math.cos(phase * 1.2 + blob.phase) * turbulence * 0.4;

        var targetX = morphCenter * 0.45 - 5 + _morph * 25;
        blob.x += (targetX - blob.x) * 0.008;
        blob.y += (H * 0.5 - blob.y) * 0.004;

        if (blob.x < 3) blob.vx = Math.abs(blob.vx) + 0.1;
        if (blob.x > morphCenter + 20) blob.vx = -Math.abs(blob.vx) - 0.1;
        if (blob.y < 8) blob.vy = Math.abs(blob.vy);
        if (blob.y > H - 8) blob.vy = -Math.abs(blob.vy);

        var pulseR = blob.r * (1 + peak * 0.4 + Math.sin(phase * 2 + blob.phase) * _tex * 0.25);

        // Warm liquid body - multiple layers for depth
        var grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, pulseR * 1.2);
        grad.addColorStop(0, 'rgba(255,200,60,' + (0.25 * dimFactor) + ')');
        grad.addColorStop(0.3, 'rgba(230,160,40,' + (0.18 * dimFactor) + ')');
        grad.addColorStop(0.6, 'rgba(200,120,20,' + (0.10 * dimFactor) + ')');
        grad.addColorStop(1, 'rgba(160,80,10,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, pulseR * 1.2, 0, Math.PI * 2);
        ctx.fill();

        // Inner bright core
        var coreGrad = ctx.createRadialGradient(blob.x - pulseR * 0.2, blob.y - pulseR * 0.2, 0, blob.x, blob.y, pulseR * 0.5);
        coreGrad.addColorStop(0, 'rgba(255,240,180,' + (0.3 * dimFactor) + ')');
        coreGrad.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, pulseR * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Texture: metallic shimmer highlights
        if (_tex > 0.15) {
          for (var h = 0; h < 3; h++) {
            var hAngle = phase * 3 + blob.phase + h * 2.1;
            var hx = blob.x + Math.cos(hAngle) * pulseR * 0.5;
            var hy = blob.y + Math.sin(hAngle) * pulseR * 0.5;
            var hSize = pulseR * 0.12 * (1 + _tex);
            ctx.beginPath();
            ctx.arc(hx, hy, hSize, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,240,200,' + (0.3 * _tex * dimFactor) + ')';
            ctx.fill();
          }
        }

        // Surface tension ring
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, pulseR * 0.85, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,210,100,' + (0.15 * dimFactor) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Draw Space B liquid blobs (cool teal/cyan, right side) ──
      for (var bi = 0; bi < blobs.b.length; bi++) {
        var blob = blobs.b[bi];
        blob.phase += 0.012;
        blob.x += blob.vx + Math.sin(phase * 1.3 + blob.phase) * turbulence * 0.6;
        blob.y += blob.vy + Math.cos(phase * 1.7 + blob.phase) * turbulence * 0.4;

        var targetX = morphCenter + (W - morphCenter) * 0.55 + 5 - _morph * 25;
        blob.x += (targetX - blob.x) * 0.008;
        blob.y += (H * 0.5 - blob.y) * 0.004;

        if (blob.x > W - 3) blob.vx = -Math.abs(blob.vx) - 0.1;
        if (blob.x < morphCenter - 20) blob.vx = Math.abs(blob.vx) + 0.1;
        if (blob.y < 8) blob.vy = Math.abs(blob.vy);
        if (blob.y > H - 8) blob.vy = -Math.abs(blob.vy);

        var pulseR = blob.r * (1 + peak * 0.4 + Math.sin(phase * 2.5 + blob.phase) * _tex * 0.25);

        // Cool liquid body
        var grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, pulseR * 1.2);
        grad.addColorStop(0, 'rgba(40,220,240,' + (0.25 * dimFactor) + ')');
        grad.addColorStop(0.3, 'rgba(30,180,200,' + (0.18 * dimFactor) + ')');
        grad.addColorStop(0.6, 'rgba(20,140,170,' + (0.10 * dimFactor) + ')');
        grad.addColorStop(1, 'rgba(10,100,130,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, pulseR * 1.2, 0, Math.PI * 2);
        ctx.fill();

        // Inner bright core
        var coreGrad = ctx.createRadialGradient(blob.x + pulseR * 0.2, blob.y - pulseR * 0.2, 0, blob.x, blob.y, pulseR * 0.5);
        coreGrad.addColorStop(0, 'rgba(180,255,255,' + (0.3 * dimFactor) + ')');
        coreGrad.addColorStop(1, 'rgba(80,220,240,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, pulseR * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Texture: shimmer
        if (_tex > 0.15) {
          for (var h = 0; h < 3; h++) {
            var hAngle = phase * 2.5 + blob.phase + h * 2.1;
            var hx = blob.x + Math.cos(hAngle) * pulseR * 0.5;
            var hy = blob.y + Math.sin(hAngle) * pulseR * 0.5;
            var hSize = pulseR * 0.12 * (1 + _tex);
            ctx.beginPath();
            ctx.arc(hx, hy, hSize, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(200,255,255,' + (0.3 * _tex * dimFactor) + ')';
            ctx.fill();
          }
        }

        // Surface tension ring
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, pulseR * 0.85, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(100,230,240,' + (0.15 * dimFactor) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Morph collision zone: where the two liquids merge ──
      var collisionWidth = 25 + _tex * 25 + _morph * 15;
      // Surface ripples from collision
      for (var ri = 0; ri < 6; ri++) {
        var rippleY = H * 0.15 + ri * (H * 0.7 / 6);
        var rippleAge = (phase * 2 + ri * 0.8) % 3;
        var rippleR = rippleAge * 12 * (1 + peak);
        var rippleAlpha = Math.max(0, (1 - rippleAge / 3)) * 0.3 * dimFactor;
        if (rippleAlpha < 0.01) continue;
        var rippleX = morphCenter + Math.sin(rippleY * 0.06 + phase) * 8;
        ctx.beginPath();
        ctx.ellipse(rippleX, rippleY, rippleR * 1.5, rippleR * 0.6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(120,220,140,' + rippleAlpha + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Collision zone liquid merge
      for (var y = 10; y < H - 10; y += 3) {
        var wave = Math.sin(y * 0.08 + phase * 2.5) * collisionWidth * 0.5 * (1 + _tex * 0.5);
        var wave2 = Math.sin(y * 0.15 + phase * 1.5) * collisionWidth * 0.2;
        var mcx = morphCenter + wave + wave2;
        var collAlpha = 0.18 * dimFactor * (0.6 + peak * 0.4);
        var blobSize = 3 + _tex * 3 + Math.sin(y * 0.12 + phase * 3) * 1.5;

        // Emerald green merge color
        var mergeGrad = ctx.createRadialGradient(mcx, y, 0, mcx, y, blobSize * 2);
        mergeGrad.addColorStop(0, 'rgba(80,230,120,' + (collAlpha * 0.8) + ')');
        mergeGrad.addColorStop(0.5, 'rgba(60,200,100,' + (collAlpha * 0.4) + ')');
        mergeGrad.addColorStop(1, 'rgba(40,180,80,0)');
        ctx.fillStyle = mergeGrad;
        ctx.beginPath();
        ctx.arc(mcx, y, blobSize * 2, 0, Math.PI * 2);
        ctx.fill();

        // White highlight at merge peaks
        if (Math.abs(wave) > collisionWidth * 0.3) {
          ctx.beginPath();
          ctx.arc(mcx, y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + (collAlpha * 0.5) + ')';
          ctx.fill();
        }
      }

      // ── Floating droplets pulled toward merge point ──
      var droplets = blobs.droplets;
      for (var di = 0; di < droplets.length; di++) {
        var dp = droplets[di];
        dp.phase += 0.02;
        // Pull toward morph center
        var pullStrength = 0.02 * _morph;
        dp.x += dp.vx + (morphCenter - dp.x) * pullStrength + Math.sin(phase + dp.phase) * 0.3;
        dp.y += dp.vy + Math.cos(phase * 0.7 + dp.phase) * 0.2;

        if (dp.y < 5) { dp.y = 5; dp.vy = Math.abs(dp.vy); }
        if (dp.y > H - 5) { dp.y = H - 5; dp.vy = -Math.abs(dp.vy); }
        if (dp.x < 3) { dp.x = 3; dp.vx = Math.abs(dp.vx); }
        if (dp.x > W - 3) { dp.x = W - 3; dp.vx = -Math.abs(dp.vx); }

        var distToMerge = Math.abs(dp.x - morphCenter);
        var merging = distToMerge < 20;

        var dpAlpha = (0.5 + peak * 0.3) * dimFactor;
        var dpSize = dp.size * (1 + Math.sin(dp.phase) * 0.3);

        // Glow
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dpSize * 3, 0, Math.PI * 2);
        if (merging) {
          ctx.fillStyle = 'rgba(80,230,130,' + (dpAlpha * 0.15) + ')';
        } else if (dp.side === 'a') {
          ctx.fillStyle = 'rgba(255,200,60,' + (dpAlpha * 0.15) + ')';
        } else {
          ctx.fillStyle = 'rgba(40,220,240,' + (dpAlpha * 0.15) + ')';
        }
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dpSize, 0, Math.PI * 2);
        if (merging) {
          ctx.fillStyle = 'rgba(120,255,160,' + dpAlpha + ')';
        } else if (dp.side === 'a') {
          ctx.fillStyle = 'rgba(255,220,100,' + dpAlpha + ')';
        } else {
          ctx.fillStyle = 'rgba(100,240,255,' + dpAlpha + ')';
        }
        ctx.fill();
      }

      // ── Splashing droplets at collision zone ──
      for (var si = 0; si < 5; si++) {
        var splashAge = (phase * 3 + si * 1.1) % 2;
        if (splashAge > 1) continue;
        var splashY = H * 0.15 + si * (H * 0.7 / 5);
        var splashX = morphCenter + Math.sin(si * 2.3 + phase * 0.5) * 5;
        var splashAlpha = (1 - splashAge) * 0.5 * dimFactor * (0.4 + peak * 0.6);
        for (var sd = 0; sd < 4; sd++) {
          var sdAngle = -Math.PI * 0.2 + (sd / 3) * (-Math.PI * 0.6);
          var sdDist = splashAge * 12;
          var sdx = splashX + Math.cos(sdAngle) * sdDist;
          var sdy = splashY + Math.sin(sdAngle) * sdDist - splashAge * 6;
          ctx.beginPath();
          ctx.arc(sdx, sdy, 1.5 * (1 - splashAge), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(180,255,200,' + splashAlpha + ')';
          ctx.fill();
        }
      }

      // ── Space labels ──
      ctx.save();
      ctx.font = '600 7px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,200,80,' + (0.6 * dimFactor) + ')';
      ctx.fillText(SPACE_NAMES[spAIdx], morphCenter * 0.35, 14);
      ctx.fillStyle = 'rgba(80,220,240,' + (0.6 * dimFactor) + ')';
      ctx.fillText(SPACE_NAMES[spBIdx], morphCenter + (W - morphCenter) * 0.65, 14);
      ctx.restore();

      // ── Title ──
      ctx.save();
      ctx.font = '600 8px system-ui, -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(120,220,160,' + (0.55 * dimFactor) + ')';
      ctx.fillText('MORPHREVERB', W / 2, H - 6);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return function() { cancelAnimationFrame(raf); };
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 160, display: 'block' }} />;
}

// ─── Liquid Split Knob ────────────────────────────────────────────────────────
// Simple arc knob — amber for A side, teal for B side, blends with norm
function RingKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  const ACCENT_HUE = 30;
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

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format, sensitivity = 120, colorA, colorB }) {
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
        <RingKnob size={size} norm={norm} colorA={colorA} colorB={colorB} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(180,180,160,0.6)', fontWeight: 700, textAlign: 'center',
        fontFamily: 'system-ui', lineHeight: 1, marginTop: 2,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(160,160,140,0.45)', fontFamily: '"Courier New",monospace',
        fontWeight: 600, textAlign: 'center',
      }}>{display}</span>
    </div>
  );
}

// ─── Space Selector (clickable strip) ────────────────────────────────────────
function SpaceSelector({ value, onChange, label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color, fontFamily: 'system-ui', width: 12, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 3 }}>
        {SPACE_NAMES.map((name, i) => (
          <div key={name} onClick={() => onChange(i)} style={{
            padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: Math.round(value) === i ? `${color}30` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${Math.round(value) === i ? `${color}88` : 'rgba(100,100,100,0.15)'}`,
            transition: 'all 0.15s',
          }}>
            <span style={{
              fontSize: 7, fontWeight: 700, letterSpacing: '0.08em',
              color: Math.round(value) === i ? color : 'rgba(150,150,140,0.5)',
              fontFamily: 'system-ui',
            }}>{name}</span>
          </div>
        ))}
      </div>
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
      <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(160,160,140,0.4)', width: 34, textAlign: 'right', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ flex: 1, height: 3, background: 'rgba(140,140,120,0.06)', borderRadius: 2, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${norm * 100}%`, background: 'rgba(160,160,130,0.15)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: '50%', left: `${norm * 100}%`, transform: 'translate(-50%, -50%)', width: 7, height: 7, borderRadius: '50%', background: 'rgba(180,180,150,0.5)', boxShadow: '0 0 4px rgba(150,150,120,0.3)' }} />
      </div>
      <span style={{ fontSize: 7, color: 'rgba(150,150,130,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600, width: 26, textAlign: 'left', flexShrink: 0 }}>{display}</span>
    </div>
  );
}

function BypassDot({ active, onClick }) {
  return (
    <div onClick={onClick} title={active ? 'Active' : 'Bypassed'}
      style={{ cursor: 'pointer', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: active ? 'radial-gradient(circle at 35% 35%, rgba(200,200,180,0.9), rgba(150,150,120,0.6))' : 'rgba(40,40,35,0.3)',
        boxShadow: active ? '0 0 8px rgba(180,180,140,0.4)' : 'none',
        transition: 'all 0.3s ease',
      }} />
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',           spaceA: 0, spaceB: 1, morph: 0.5, texture: 0.3, tone: 0.5, mix: 0.3,  smooth: 0 },
  { name: 'PLATE TO HALL',  spaceA: 0, spaceB: 1, morph: 0.35, texture: 0.2, tone: 0.6, mix: 0.35, smooth: 0 },
  { name: 'ROOM TO CLOUD',  spaceA: 3, spaceB: 4, morph: 0.5, texture: 0.4, tone: 0.45, mix: 0.3,  smooth: 0 },
  { name: 'CHAMBER DREAM',  spaceA: 2, spaceB: 4, morph: 0.6, texture: 0.5, tone: 0.55, mix: 0.35, smooth: 0 },
  { name: 'TIGHT TO VAST',  spaceA: 3, spaceB: 1, morph: 0.4, texture: 0.25, tone: 0.5, mix: 0.3,  smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#12120e', text: 'rgba(180,180,160,0.8)', textDim: 'rgba(140,140,120,0.45)',
  border: 'rgba(130,130,100,0.12)', hoverBg: 'rgba(130,130,100,0.08)', activeBg: 'rgba(130,130,100,0.05)',
};

export default function MorphReverbOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [inputGain, setInputGain] = useState(initialState?.inputGain ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [spaceA, setSpaceA] = useState(initialState?.spaceA ?? 0);
  const [spaceB, setSpaceB] = useState(initialState?.spaceB ?? 1);
  const [morph, setMorph] = useState(initialState?.morph ?? 0.5);
  const [texture, setTexture] = useState(initialState?.texture ?? 0.3);
  const [tone, setTone] = useState(initialState?.tone ?? 0.5);
  const [mix, setMix] = useState(initialState?.mix ?? 0.3);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, spaceA, spaceB, morph, texture, tone, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createMorphReverbEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSpaceA(s.spaceA); eng.setSpaceB(s.spaceB); eng.setMorph(s.morph);
      eng.setTexture(s.texture); eng.setTone(s.tone); eng.setMix(s.mix);
      eng.setBypass(s.bypassed); eng.setSmooth(s.smooth);
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
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, spaceA, spaceB, morph, texture, tone, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, spaceA, spaceB, morph, texture, tone, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setSpaceA(p.spaceA); setSpaceB(p.spaceB); setMorph(p.morph);
    setTexture(p.texture); setTone(p.tone); setMix(p.mix); setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    const e = engineRef.current;
    if (e) { e.setSpaceA(p.spaceA); e.setSpaceB(p.spaceB); e.setMorph(p.morph); e.setTexture(p.texture); e.setTone(p.tone); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 380, borderRadius: 6, position: 'relative',
      background: 'linear-gradient(170deg, #14120a 0%, #0e0e0c 35%, #0a0a08 70%, #08080a 100%)',
      border: '1.5px solid rgba(180,160,80,0.15)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 25px rgba(180,150,60,0.08), inset 0 1px 0 rgba(200,180,100,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(180,160,80,0.1)',
        background: 'linear-gradient(180deg, rgba(180,150,60,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.1em',
            background: 'linear-gradient(135deg, #d4a040, #40b0c0)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(180,150,60,0.3))',
          }}>MORPH REVERB</span>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(180,160,100,0.35)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>BLEND BETWEEN WORLDS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(180,160,80,0.4)' }}>...</span>}
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
      <div style={{ borderBottom: '1px solid rgba(180,160,80,0.08)' }}>
        <LiquidMorphCanvas morph={morph} texture={texture} spaceA={spaceA} spaceB={spaceB} peakLevel={peakLevel} bypassed={bypassed} />
      </div>

      {/* Space Selectors */}
      <div style={{
        padding: '8px 12px 6px', display: 'flex', flexDirection: 'column', gap: 5,
        borderBottom: '1px solid rgba(180,160,80,0.08)',
      }}>
        <SpaceSelector value={spaceA} label="A" color="rgba(220,170,80,0.85)"
          onChange={v => { setSpaceA(v); engineRef.current?.setSpaceA(v); setActivePreset(null); }} />
        <SpaceSelector value={spaceB} label="B" color="rgba(80,190,220,0.85)"
          onChange={v => { setSpaceB(v); engineRef.current?.setSpaceB(v); setActivePreset(null); }} />
      </div>

      {/* I/O Meters */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid rgba(180,160,80,0.08)',
      }}>
        <HSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} format={dbFmt}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
        <HSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} format={dbFmt}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
      </div>

      {/* Knobs Row: MORPH (big), TEXTURE, TONE, MIX */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(180,160,80,0.06)',
      }}>
        <Knob label="MORPH" value={morph} defaultValue={0.5} size={28}
          colorA="rgba(220,160,60,0.6)" colorB="rgba(60,180,220,0.6)"
          format={v => v < 0.2 ? 'A' : v > 0.8 ? 'B' : Math.round(v * 100) + '%'}
          onChange={v => { setMorph(v); engineRef.current?.setMorph(v); setActivePreset(null); }} />
        <Knob label="TEXTURE" value={texture} defaultValue={0.3} size={28} format={pctFmt}
          colorA="rgba(200,180,100,0.5)" colorB="rgba(200,180,100,0.5)"
          onChange={v => { setTexture(v); engineRef.current?.setTexture(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={28}
          colorA="rgba(200,180,100,0.5)" colorB="rgba(200,180,100,0.5)"
          format={v => v < 0.3 ? 'DARK' : v > 0.7 ? 'BRIGHT' : 'NEUTRAL'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.3} size={28} format={pctFmt}
          colorA="rgba(180,180,150,0.5)" colorB="rgba(180,180,150,0.5)"
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bypass footer */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BypassDot active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
          <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }} style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(180,150,60,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(220,190,100,0.95)' : 'rgba(160,130,60,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(180,150,60,0.45)' : 'rgba(120,100,40,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(180,150,60,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        </div>
        <span style={{
          fontSize: 7, fontWeight: 700, letterSpacing: '0.15em',
          color: bypassed ? 'rgba(200,120,40,0.5)' : 'rgba(120,200,180,0.5)',
          fontFamily: 'system-ui',
        }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</span>
      </div>
    </div>
  );
}
