import { useState, useEffect, useRef, useCallback } from 'react';
import { createSplitdriveEngine } from './splitdriveEngine';
import PresetSelector from './PresetSelector';

// ─── SPLITDRIVE: Hot Rod Muscle Car Dashboard ───────────────────────────────
// Visual: THREE TACHOMETER GAUGES, chrome knobs, ignition switch, flames
// Hero: Side-by-side tach gauges for LOW / MID / HIGH with spring-physics needles

// ─── Three Tachometer Gauges Canvas ─────────────────────────────────────────
function TachometerGauges({ lowDrive, midDrive, highDrive, crossLo, crossHi, peak }) {
  const canvasRef = useRef(null);
  const needlesRef = useRef(null);
  const flameRef = useRef(null);
  const sparksRef = useRef(null);
  const valRef = useRef({ lowDrive: 0, midDrive: 0, highDrive: 0, crossLo: 0, crossHi: 0, peak: 0 });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { lowDrive, midDrive, highDrive, crossLo, crossHi, peak };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Spring physics for needles: { current, velocity, target }
    if (!needlesRef.current) {
      needlesRef.current = [
        { current: 0, velocity: 0 },
        { current: 0, velocity: 0 },
        { current: 0, velocity: 0 },
      ];
    }

    // Flame particles
    if (!flameRef.current) {
      flameRef.current = [];
      for (let i = 0; i < 60; i++) {
        flameRef.current.push({
          x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, gauge: 0,
        });
      }
    }

    // Spark particles
    if (!sparksRef.current) {
      sparksRef.current = [];
      for (let i = 0; i < 20; i++) {
        sparksRef.current.push({
          x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, gauge: -1,
        });
      }
    }

    let raf;
    let frameTime = -1;

    const draw = (t) => {
      raf = requestAnimationFrame(draw); // schedule next frame FIRST so errors can't kill the loop
      const dt = frameTime < 0 ? 0.016 : Math.min((t - frameTime) / 1000, 0.05);
      if (dt <= 0 || isNaN(dt)) { frameTime = t; return; }
      frameTime = t;
      ctx.clearRect(0, 0, W, H);

      // Read LIVE values from ref (not stale closure!) — NaN-guard everything
      const { lowDrive: _low, midDrive: _mid, highDrive: _high, peak: _peak } = valRef.current;
      const pk = (typeof _peak === 'number' && !isNaN(_peak)) ? _peak : 0;
      const drives = [_low || 0, _mid || 0, _high || 0];
      const labels = ['LOW', 'MID', 'HIGH'];
      const colors = [
        { main: '#cc2020', bright: '#ff4040', dim: '#801515' },  // deep red
        { main: '#e88020', bright: '#ffaa40', dim: '#8a4a10' },  // orange
        { main: '#eedd60', bright: '#ffffaa', dim: '#8a8030' },  // yellow-white
      ];

      // ── Subtle checkered flag background ──
      const checkSize = 14;
      for (let cx = 0; cx < W; cx += checkSize) {
        for (let cy = 0; cy < H; cy += checkSize) {
          const isEven = ((cx / checkSize) + (cy / checkSize)) % 2 === 0;
          ctx.fillStyle = isEven ? 'rgba(255,255,255,0.008)' : 'rgba(0,0,0,0.008)';
          ctx.fillRect(cx, cy, checkSize, checkSize);
        }
      }

      // ── Racing stripes (two vertical) ──
      const stripeAlpha = 0.03;
      ctx.fillStyle = `rgba(200, 50, 30, ${stripeAlpha})`;
      ctx.fillRect(W / 2 - 18, 0, 8, H);
      ctx.fillStyle = `rgba(230, 100, 40, ${stripeAlpha})`;
      ctx.fillRect(W / 2 + 10, 0, 8, H);

      const needles = needlesRef.current;

      // ── Draw 3 tachometer gauges ──
      const gaugeR = 34;
      const gaugeSpacing = W / 3;
      const gaugeCY = H / 2 + 6;

      for (let g = 0; g < 3; g++) {
        const gaugeCX = gaugeSpacing * g + gaugeSpacing / 2;
        const target = drives[g];
        const col = colors[g];

        // Spring physics update — needles bounce hard with audio
        const spring = 18;
        const damping = 5;
        // Needle target blends drive knob with live audio peak for reactive bounce
        const audioBoost = pk * 0.4 + (pk > 0.6 ? (pk - 0.6) * 0.8 : 0);
        const effectiveTarget = Math.min(1.05, target * (0.6 + audioBoost) + audioBoost * 0.3);
        const force = (effectiveTarget - needles[g].current) * spring - needles[g].velocity * damping;
        needles[g].velocity += force * dt;
        needles[g].current += needles[g].velocity * dt;
        // NaN recovery — reset if physics breaks
        if (isNaN(needles[g].current) || isNaN(needles[g].velocity)) {
          needles[g].current = drives[g] || 0;
          needles[g].velocity = 0;
        }
        needles[g].current = Math.max(-0.02, Math.min(1.05, needles[g].current));

        const needleVal = needles[g].current;

        // Gauge sweep: 7 o'clock (-225deg) to 5 o'clock (45deg) = 270 degrees
        const startDeg = -225;
        const endDeg = 45;
        const toRad = deg => deg * Math.PI / 180;

        // ── Gauge face (dark circle) ──
        ctx.beginPath();
        ctx.arc(gaugeCX, gaugeCY, gaugeR + 2, 0, Math.PI * 2);
        const faceGrad = ctx.createRadialGradient(gaugeCX, gaugeCY - 5, 0, gaugeCX, gaugeCY, gaugeR + 2);
        faceGrad.addColorStop(0, '#1a1a1a');
        faceGrad.addColorStop(0.7, '#0e0e0e');
        faceGrad.addColorStop(1, '#080808');
        ctx.fillStyle = faceGrad;
        ctx.fill();

        // ── Chrome bezel ring ──
        ctx.beginPath();
        ctx.arc(gaugeCX, gaugeCY, gaugeR + 2, 0, Math.PI * 2);
        const bezelGrad = ctx.createLinearGradient(gaugeCX, gaugeCY - gaugeR, gaugeCX, gaugeCY + gaugeR);
        bezelGrad.addColorStop(0, 'rgba(200,200,200,0.4)');
        bezelGrad.addColorStop(0.3, 'rgba(120,120,120,0.2)');
        bezelGrad.addColorStop(0.7, 'rgba(60,60,60,0.15)');
        bezelGrad.addColorStop(1, 'rgba(180,180,180,0.3)');
        ctx.strokeStyle = bezelGrad;
        ctx.lineWidth = 2;
        ctx.stroke();

        // ── Redline zone (last 20% of sweep) ──
        const redlineStart = startDeg + (endDeg - startDeg) * 0.8;
        ctx.beginPath();
        ctx.arc(gaugeCX, gaugeCY, gaugeR - 3, toRad(redlineStart), toRad(endDeg));
        const redAlpha = needleVal > 0.8 ? 0.3 + (needleVal - 0.8) * 2 + pk * 0.3 : 0.12;
        ctx.strokeStyle = `rgba(255, 40, 40, ${redAlpha})`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Redline glow when needle is in redline
        if (needleVal > 0.8) {
          const glowIntensity = (needleVal - 0.8) * 5 * (1 + pk * 0.5);
          const glowGrad = ctx.createRadialGradient(gaugeCX, gaugeCY, gaugeR * 0.5, gaugeCX, gaugeCY, gaugeR + 5);
          glowGrad.addColorStop(0, `rgba(255, 40, 40, 0)`);
          glowGrad.addColorStop(0.7, `rgba(255, 40, 40, ${glowIntensity * 0.08})`);
          glowGrad.addColorStop(1, `rgba(255, 40, 40, ${glowIntensity * 0.15})`);
          ctx.beginPath();
          ctx.arc(gaugeCX, gaugeCY, gaugeR + 5, 0, Math.PI * 2);
          ctx.fillStyle = glowGrad;
          ctx.fill();
        }

        // ── Tick marks + numbers ──
        const totalTicks = 10;
        for (let tick = 0; tick <= totalTicks; tick++) {
          const ratio = tick / totalTicks;
          const deg = startDeg + ratio * (endDeg - startDeg);
          const rad = toRad(deg);
          const isRedline = ratio >= 0.8;
          const isMajor = tick % 2 === 0;

          const innerR = isMajor ? gaugeR - 10 : gaugeR - 7;
          const outerR = gaugeR - 3;

          ctx.beginPath();
          ctx.moveTo(gaugeCX + innerR * Math.cos(rad), gaugeCY + innerR * Math.sin(rad));
          ctx.lineTo(gaugeCX + outerR * Math.cos(rad), gaugeCY + outerR * Math.sin(rad));
          ctx.strokeStyle = isRedline ? '#ff4040' : 'rgba(220,220,220,0.7)';
          ctx.lineWidth = isMajor ? 1.2 : 0.5;
          ctx.stroke();

          // Numbers on major ticks
          if (isMajor) {
            const numR = gaugeR - 14;
            const numX = gaugeCX + numR * Math.cos(rad);
            const numY = gaugeCY + numR * Math.sin(rad);
            ctx.font = '600 5.5px system-ui, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isRedline ? '#ff6060' : 'rgba(220,220,220,0.75)';
            ctx.fillText(`${tick}`, numX, numY);
          }
        }

        // ── Needle ──
        const needleDeg = startDeg + needleVal * (endDeg - startDeg);
        const needleRad = toRad(needleDeg);
        const needleLen = gaugeR - 6;
        const needleTailLen = 6;

        // Needle shadow
        ctx.beginPath();
        ctx.moveTo(
          gaugeCX - needleTailLen * Math.cos(needleRad) + 1,
          gaugeCY - needleTailLen * Math.sin(needleRad) + 1
        );
        ctx.lineTo(
          gaugeCX + needleLen * Math.cos(needleRad) + 1,
          gaugeCY + needleLen * Math.sin(needleRad) + 1
        );
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Needle body
        ctx.beginPath();
        ctx.moveTo(
          gaugeCX - needleTailLen * Math.cos(needleRad),
          gaugeCY - needleTailLen * Math.sin(needleRad)
        );
        ctx.lineTo(
          gaugeCX + needleLen * Math.cos(needleRad),
          gaugeCY + needleLen * Math.sin(needleRad)
        );
        const inRedline = needleVal > 0.8;
        ctx.strokeStyle = inRedline ? '#ff3030' : col.main;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Needle glow
        ctx.beginPath();
        ctx.moveTo(
          gaugeCX + (needleLen * 0.5) * Math.cos(needleRad),
          gaugeCY + (needleLen * 0.5) * Math.sin(needleRad)
        );
        ctx.lineTo(
          gaugeCX + needleLen * Math.cos(needleRad),
          gaugeCY + needleLen * Math.sin(needleRad)
        );
        ctx.strokeStyle = `rgba(${inRedline ? '255,80,80' : '255,160,80'}, 0.3)`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // ── Center hub (chrome) ──
        ctx.beginPath();
        ctx.arc(gaugeCX, gaugeCY, 3.5, 0, Math.PI * 2);
        const hubGrad = ctx.createRadialGradient(gaugeCX - 1, gaugeCY - 1, 0, gaugeCX, gaugeCY, 3.5);
        hubGrad.addColorStop(0, '#ffffff');
        hubGrad.addColorStop(0.3, '#cccccc');
        hubGrad.addColorStop(0.7, '#666666');
        hubGrad.addColorStop(1, '#333333');
        ctx.fillStyle = hubGrad;
        ctx.fill();

        // ── Band label ──
        ctx.font = '700 6px system-ui, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = col.dim;
        ctx.fillText(labels[g], gaugeCX, gaugeCY + gaugeR + 10);

        // ── RPM readout below gauge ──
        const rpm = Math.round(needleVal * 8000 + 1000);
        ctx.font = '700 5px "Courier New", monospace';
        ctx.fillStyle = `rgba(${g === 0 ? '200,80,80' : g === 1 ? '220,150,60' : '220,200,100'}, 0.5)`;
        ctx.fillText(`${rpm} RPM`, gaugeCX, gaugeCY + gaugeR + 17);

        // ── Sparks from needle tip in redline ──
        if (needleVal > 0.8 && pk > 0.3) {
          const tipX = gaugeCX + needleLen * Math.cos(needleRad);
          const tipY = gaugeCY + needleLen * Math.sin(needleRad);
          const sparks = sparksRef.current;
          for (let s = 0; s < sparks.length; s++) {
            if (sparks[s].life <= 0 && sparks[s].gauge === -1 && Math.random() < 0.3) {
              sparks[s].x = tipX;
              sparks[s].y = tipY;
              sparks[s].vx = (Math.random() - 0.5) * 40;
              sparks[s].vy = (Math.random() - 0.5) * 40 - 15;
              sparks[s].life = 0.3 + Math.random() * 0.3;
              sparks[s].maxLife = sparks[s].life;
              sparks[s].gauge = g;
              break;
            }
          }
        }

        // ── Flames at bottom of each gauge ──
        const flameBudget = Math.floor(drives[g] * 6 + pk * 4);
        const flames = flameRef.current;
        for (let f = 0; f < flames.length; f++) {
          if (flames[f].life <= 0 && flames[f].gauge === 0 && flameBudget > 0) {
            // Only spawn for this gauge
          }
        }
      }

      // ── Update & draw flame particles ──
      const flames = flameRef.current;
      // Spawn new flames
      for (let g = 0; g < 3; g++) {
        const gaugeCX = gaugeSpacing * g + gaugeSpacing / 2;
        const intensity = drives[g] * (0.3 + pk * 1.2);
        if (intensity > 0.05) {
          for (let f = 0; f < flames.length; f++) {
            if (flames[f].life <= 0 && Math.random() < intensity * 0.15) {
              flames[f].x = gaugeCX + (Math.random() - 0.5) * 20;
              flames[f].y = gaugeCY + gaugeR + 2;
              flames[f].vx = (Math.random() - 0.5) * 8;
              flames[f].vy = -(5 + Math.random() * 15 * intensity);
              flames[f].life = 0.2 + Math.random() * 0.4 * intensity;
              flames[f].maxLife = flames[f].life;
              flames[f].size = 1.5 + Math.random() * 2 * intensity;
              flames[f].gauge = g;
              break;
            }
          }
        }
      }

      // Draw flames
      for (let f = 0; f < flames.length; f++) {
        const fl = flames[f];
        if (fl.life <= 0) continue;
        fl.life -= dt;
        fl.x += fl.vx * dt;
        fl.y += fl.vy * dt;
        fl.vy -= 20 * dt; // gravity pulls up (flames rise)

        const lifeRatio = fl.life / fl.maxLife;
        const col = fl.gauge === 0 ? [220, 40, 30] : fl.gauge === 1 ? [255, 140, 30] : [255, 220, 80];
        // Flame triangular shape
        const s = fl.size * lifeRatio;
        ctx.beginPath();
        ctx.moveTo(fl.x, fl.y - s * 2);
        ctx.lineTo(fl.x - s, fl.y + s);
        ctx.lineTo(fl.x + s, fl.y + s);
        ctx.closePath();
        ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${lifeRatio * 0.6})`;
        ctx.fill();
      }

      // Draw sparks
      const sparks = sparksRef.current;
      for (let s = 0; s < sparks.length; s++) {
        const sp = sparks[s];
        if (sp.life <= 0) { sp.gauge = -1; continue; }
        sp.life -= dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 50 * dt; // gravity

        const lifeRatio = sp.life / sp.maxLife;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 0.8 * lifeRatio, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 220, 100, ${lifeRatio * 0.8})`;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 4 }} />;
}

// ─── Chrome Shift Knob ──────────────────────────────────────────────────────
function ChromeKnob({ size = 38, norm = 0, elongated = false }) {
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 2;
  const id = useRef(`ck-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;

  // Shift pattern number (1-7 mapped from norm)
  const shiftNum = Math.max(1, Math.min(7, Math.round(norm * 6) + 1));

  const rx = elongated ? r * 1.3 : r;
  const ry = r;

  return (
    <svg width={size + 12} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px -2px', pointerEvents: 'none' }}>
      <defs>
        {/* Chrome gradient — bright specular top, dark bottom */}
        <radialGradient id={`${id}-chrome`} cx="35%" cy="22%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="15%" stopColor="#e8e8e8" />
          <stop offset="40%" stopColor="#aaaaaa" />
          <stop offset="65%" stopColor="#666666" />
          <stop offset="85%" stopColor="#333333" />
          <stop offset="100%" stopColor="#1a1a1a" />
        </radialGradient>
        {/* Specular highlight */}
        <radialGradient id={`${id}-spec`} cx="32%" cy="18%" r="35%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.2)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        {/* Chrome base ring */}
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cccccc" />
          <stop offset="30%" stopColor="#888888" />
          <stop offset="70%" stopColor="#444444" />
          <stop offset="100%" stopColor="#999999" />
        </linearGradient>
        <filter id={`${id}-sh`}><feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,0.6)" /></filter>
      </defs>
      {/* Base plate ring */}
      <ellipse cx={cx + 6} cy={cy + 5} rx={rx + 3} ry={ry + 3} fill={`url(#${id}-ring)`} opacity={0.5} />
      {/* Shadow */}
      <ellipse cx={cx + 6} cy={cy + 4} rx={rx} ry={ry} fill={`url(#${id}-chrome)`} filter={`url(#${id}-sh)`} />
      {/* Main chrome ball */}
      <ellipse cx={cx + 6} cy={cy + 4} rx={rx} ry={ry} fill={`url(#${id}-chrome)`} />
      {/* Specular highlight */}
      <ellipse cx={cx + 6} cy={cy + 4} rx={rx * 0.6} ry={ry * 0.6} fill={`url(#${id}-spec)`} />
      {/* Chrome rim */}
      <ellipse cx={cx + 6} cy={cy + 4} rx={rx} ry={ry} fill="none" stroke="rgba(200,200,200,0.3)" strokeWidth={0.6} />
      {/* Position indicator — engraved line */}
      <line
        x1={cx + 6 + rx * 0.2 * Math.cos(rad)}
        y1={cy + 4 + ry * 0.2 * Math.sin(rad)}
        x2={cx + 6 + rx * 0.75 * Math.cos(rad)}
        y2={cy + 4 + ry * 0.75 * Math.sin(rad)}
        stroke="rgba(40,40,40,0.6)" strokeWidth={1.5} strokeLinecap="round"
      />
      {/* Engraved shift number */}
      <text x={cx + 6} y={cy + 6} textAnchor="middle" fontSize={elongated ? 6 : 7} fontWeight="800" fontFamily="system-ui, Arial, sans-serif" fill="rgba(60,60,60,0.5)">{shiftNum}</text>
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 38, format, sensitivity = 160, elongated = false }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 20, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size + 12, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <ChromeKnob size={size} norm={norm} elongated={elongated} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(220,180,140,0.7)', fontWeight: 700, textAlign: 'center', width: '100%',
        lineHeight: 1.2, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
        textShadow: '0 1px 2px rgba(0,0,0,0.4)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(200,150,100,0.45)', fontFamily: '"Courier New",monospace',
        fontWeight: 700, textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

// ─── Ignition Switch Bypass ──────────────────────────────────────────────────
function IgnitionSwitch({ bypassed, onToggle, totalDrive }) {
  const [sweeping, setSweeping] = useState(false);

  const handleClick = () => {
    if (bypassed) {
      // Turning ON — trigger gauge sweep animation
      setSweeping(true);
      setTimeout(() => setSweeping(false), 600);
    }
    onToggle();
  };

  const checkEngine = totalDrive > 0.8;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, position: 'relative', zIndex: 2 }}>
      <span style={{
        fontSize: 5.5, fontWeight: 800, letterSpacing: '0.2em', color: 'rgba(220,180,140,0.5)',
        fontFamily: 'system-ui, Arial, sans-serif',
      }}>ENGINE</span>

      {/* Ignition switch body */}
      <div
        onClick={handleClick}
        style={{
          width: 22, height: 40, borderRadius: 11,
          background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 40%, #0e0e0e 100%)',
          border: '1.5px solid rgba(120,120,120,0.25)',
          position: 'relative', cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        {/* Key slot */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 6, height: 14, borderRadius: 3,
          background: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%)',
          border: '0.5px solid rgba(80,80,80,0.3)',
        }} />

        {/* Toggle indicator — slides up/down */}
        <div style={{
          position: 'absolute', left: 3, right: 3,
          height: 14, borderRadius: 7,
          top: bypassed ? 3 : 23,
          background: bypassed
            ? 'linear-gradient(180deg, #333 0%, #222 100%)'
            : 'linear-gradient(180deg, #cc4020 0%, #aa2010 100%)',
          boxShadow: bypassed
            ? 'none'
            : '0 0 8px rgba(220,60,20,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
          transition: 'all 0.2s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 4.5, fontWeight: 900, color: bypassed ? 'rgba(150,150,150,0.4)' : 'rgba(255,220,200,0.9)',
            letterSpacing: '0.08em',
          }}>{bypassed ? 'OFF' : 'ON'}</span>
        </div>
      </div>

      {/* Check engine LED */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <div style={{
          width: 4, height: 4, borderRadius: '50%',
          background: checkEngine ? '#ff3020' : 'rgba(80,30,20,0.3)',
          boxShadow: checkEngine ? '0 0 6px rgba(255,48,32,0.6)' : 'none',
          transition: 'all 0.3s',
        }} />
        <span style={{
          fontSize: 3.5, color: checkEngine ? 'rgba(255,100,80,0.6)' : 'rgba(120,80,60,0.3)',
          fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'system-ui, Arial, sans-serif',
        }}>CHK ENG</span>
      </div>
    </div>
  );
}

// ─── Vertical Slider ─────────────────────────────────────────────────────────
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
          width: 10, height, background: 'linear-gradient(180deg, #0e0808 0%, #1a0c0c 100%)', borderRadius: 2,
          border: '1px solid rgba(200,120,60,0.1)', position: 'relative', cursor: dragging ? 'grabbing' : 'grab',
        }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`,
          background: 'linear-gradient(to top, rgba(200,80,30,0.15), rgba(200,80,30,0.05))',
          borderRadius: 1, transition: dragging ? 'none' : 'height 0.05s',
        }} />
        {/* Chrome thumb */}
        <div style={{
          position: 'absolute', left: -2, right: -2, height: 5, borderRadius: 2.5,
          background: 'linear-gradient(180deg, #ddd 0%, #999 40%, #666 100%)',
          bottom: `calc(${norm * 100}% - 2.5px)`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
        }} />
      </div>
      <span style={{
        fontSize: 5, color: 'rgba(200,140,80,0.45)', fontFamily: 'system-ui, Arial, sans-serif',
        fontWeight: 600, letterSpacing: '0.1em',
      }}>{label}</span>
      <span style={{
        fontSize: 5, color: 'rgba(200,120,60,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600,
      }}>{display}</span>
    </div>
  );
}

// ─── LED Meter ───────────────────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeterDom({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{
      display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52,
      background: '#0e0606', padding: '3px 2px', borderRadius: 2,
      border: '1px solid rgba(200,80,30,0.06)', position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: 'rgba(200,80,30,0.05)' }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{
    fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700,
    color: 'rgba(200,120,60,0.4)', letterSpacing: '0.05em', width: 28,
    textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2,
  }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff3020' : i >= METER_SEGMENTS - 4 ? '#ff6030' : '#e87830';
    segmentEls[i].style.background = lit ? col : 'rgba(200,80,30,0.05)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-∞';
    dbEl.style.color = dbVal > -1 ? '#ff3020' : dbVal > -6 ? '#ff6030' : 'rgba(200,120,60,0.4)';
    dbEl.firstChild.textContent = display;
  }
}

// ─── Speedometer (output level as MPH) ───────────────────────────────────────
function Speedometer({ peak }) {
  const mph = Math.round(peak * 120);
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 2,
      fontFamily: '"Courier New", monospace',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 900, color: 'rgba(220,180,140,0.6)',
        textShadow: '0 0 4px rgba(200,120,60,0.2)',
      }}>{mph}</span>
      <span style={{
        fontSize: 5, fontWeight: 700, color: 'rgba(200,140,80,0.35)',
        letterSpacing: '0.05em',
      }}>MPH</span>
    </div>
  );
}

// ─── Exhaust Flames (side decorations) ──────────────────────────────────────
function ExhaustFlames({ totalDrive, side }) {
  const [flames, setFlames] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (totalDrive < 0.1) { setFlames([]); return; }
      const count = Math.floor(totalDrive * 5) + 1;
      const newFlames = [];
      for (let i = 0; i < count; i++) {
        newFlames.push({
          height: 4 + Math.random() * 12 * totalDrive,
          width: 2 + Math.random() * 3,
          offset: Math.random() * 8,
          color: Math.random() < 0.3 ? '#ffdd40' : Math.random() < 0.6 ? '#ff8820' : '#ff4010',
          opacity: 0.3 + Math.random() * 0.4 * totalDrive,
        });
      }
      setFlames(newFlames);
    }, 80);
    return () => clearInterval(interval);
  }, [totalDrive]);

  return (
    <div style={{
      position: 'absolute', [side]: -1, top: '40%', bottom: '20%',
      width: 8, pointerEvents: 'none', zIndex: 1, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 0,
    }}>
      {flames.map((f, i) => (
        <div key={i} style={{
          width: 0, height: 0,
          borderLeft: `${f.width}px solid transparent`,
          borderRight: `${f.width}px solid transparent`,
          borderBottom: `${f.height}px solid ${f.color}`,
          opacity: f.opacity,
          marginTop: f.offset,
          transform: side === 'left' ? 'rotate(90deg)' : 'rotate(-90deg)',
          filter: 'blur(0.5px)',
        }} />
      ))}
    </div>
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',        lowDrive: 0.2, midDrive: 0.4, highDrive: 0.2, crossLo: 0.3, crossHi: 0.6, tone: 0.5, mix: 1 },
  { name: 'WARM LOWS',   lowDrive: 0.6, midDrive: 0.15,highDrive: 0.05,crossLo: 0.4, crossHi: 0.5, tone: 0.4, mix: 1 },
  { name: 'MID CRUNCH',  lowDrive: 0.1, midDrive: 0.7, highDrive: 0.15,crossLo: 0.25,crossHi: 0.55,tone: 0.55,mix: 1 },
  { name: 'BRIGHT EDGE', lowDrive: 0.05,midDrive: 0.2, highDrive: 0.65,crossLo: 0.3, crossHi: 0.5, tone: 0.65,mix: 0.85 },
  { name: 'FULL BURN',   lowDrive: 0.8, midDrive: 0.85,highDrive: 0.75,crossLo: 0.3, crossHi: 0.6, tone: 0.5, mix: 1 },
  { name: 'BASS GROWL',  lowDrive: 0.7, midDrive: 0.3, highDrive: 0,   crossLo: 0.5, crossHi: 0.7, tone: 0.35,mix: 1 },
  { name: 'SURGICAL',    lowDrive: 0,   midDrive: 0.5, highDrive: 0,   crossLo: 0.35,crossHi: 0.45,tone: 0.5, mix: 0.7 },
  { name: 'MELT',        lowDrive: 0.9, midDrive: 0.95,highDrive: 0.9, crossLo: 0.2, crossHi: 0.7, tone: 0.45,mix: 1 },
];

const PRESET_COLORS = {
  bg: '#1a0a08', text: 'rgba(220,160,100,0.85)', textDim: 'rgba(200,120,70,0.5)',
  border: 'rgba(200,100,40,0.12)', hoverBg: 'rgba(200,100,40,0.1)', activeBg: 'rgba(200,100,40,0.06)',
};

// ─── Main SplitdriveOrb ──────────────────────────────────────────────────────
export default function SplitdriveOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [lowDrive,   setLowDrive]   = useState(initialState?.lowDrive   ?? 0.2);
  const [midDrive,   setMidDrive]   = useState(initialState?.midDrive   ?? 0.4);
  const [highDrive,  setHighDrive]  = useState(initialState?.highDrive  ?? 0.2);
  const [crossLo,    setCrossLo]    = useState(initialState?.crossLo    ?? 0.3);
  const [crossHi,    setCrossHi]    = useState(initialState?.crossHi    ?? 0.6);
  const [tone,       setTone]       = useState(initialState?.tone       ?? 0.5);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak, setPeak] = useState(0);

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, lowDrive, midDrive, highDrive, crossLo, crossHi, tone, mix, bypassed };

  const totalDrive = (lowDrive + midDrive + highDrive) / 3;

  // ── Engine init ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createSplitdriveEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setLowDrive(s.lowDrive); eng.setMidDrive(s.midDrive); eng.setHighDrive(s.highDrive);
      eng.setCrossLo(s.crossLo); eng.setCrossHi(s.crossHi);
      eng.setTone(s.tone); eng.setMix(s.mix); eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => {
      if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; }
    };
  }, [sharedSource]);

  // ── Meter RAF + peak for audio reactivity ──────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        const inPeak = engineRef.current.getInputPeak();
        updateMeter(inMeterRef.current, inDbRef.current, inPeak);
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setPeak(inPeak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ───────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, lowDrive, midDrive, highDrive, crossLo, crossHi, tone, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, lowDrive, midDrive, highDrive, crossLo, crossHi, tone, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setLowDrive(p.lowDrive); setMidDrive(p.midDrive); setHighDrive(p.highDrive);
    setCrossLo(p.crossLo); setCrossHi(p.crossHi); setTone(p.tone); setMix(p.mix);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setLowDrive(p.lowDrive); e.setMidDrive(p.midDrive); e.setHighDrive(p.highDrive);
      e.setCrossLo(p.crossLo); e.setCrossHi(p.crossHi); e.setTone(p.tone); e.setMix(p.mix);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'; };
  const crossLoFmt = v => { const hz = 100 * Math.pow(8, v); return hz < 1000 ? `${Math.round(hz)}Hz` : `${(hz / 1000).toFixed(1)}k`; };
  const crossHiFmt = v => { const hz = 1000 * Math.pow(8, v); return hz < 1000 ? `${Math.round(hz)}Hz` : `${(hz / 1000).toFixed(1)}k`; };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #1c0e0a 0%, #180a08 25%, #140806 50%, #100604 75%, #140a08 100%)',
      border: '1.5px solid rgba(180,90,40,0.18)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 20px rgba(200,60,20,0.06), inset 0 1px 0 rgba(255,200,150,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Exhaust flames on sides */}
      <ExhaustFlames totalDrive={totalDrive} side="left" />
      <ExhaustFlames totalDrive={totalDrive} side="right" />

      {/* Chrome trim lines (top and bottom) */}
      <div style={{
        position: 'absolute', top: 0, left: 20, right: 20, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(200,200,200,0.15), rgba(255,255,255,0.25), rgba(200,200,200,0.15), transparent)',
        pointerEvents: 'none', zIndex: 5,
      }} />

      {/* Header — chrome embossed */}
      <div style={{
        padding: '8px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(180,90,40,0.08)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(200,100,40,0.03) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Chrome embossed title */}
            <span style={{
              fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
              background: 'linear-gradient(180deg, #ffffff 0%, #dddddd 35%, #888888 55%, #666666 70%, #999999 100%)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))',
            }}>SPLITDRIVE</span>
            {/* V8 badge */}
            <span style={{
              fontSize: 4.5, fontWeight: 900, letterSpacing: '0.08em',
              color: 'rgba(200,160,120,0.4)',
              border: '0.5px solid rgba(200,160,120,0.2)',
              padding: '1px 3px', borderRadius: 1,
            }}>V8 POWERED</span>
          </div>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(200,140,80,0.3)', letterSpacing: '0.35em',
            marginTop: 2, textTransform: 'uppercase',
          }}>frequency forge</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(200,120,60,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; e.currentTarget.style.background = 'transparent'; }}>×</span>}
        </div>
      </div>

      {/* Tachometer gauges — the hero visual */}
      <div style={{
        borderBottom: '1px solid rgba(180,90,40,0.06)', position: 'relative', zIndex: 2, flex: 1, minHeight: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.15) 100%)',
      }}>
        <TachometerGauges lowDrive={lowDrive} midDrive={midDrive} highDrive={highDrive} crossLo={crossLo} crossHi={crossHi} peak={peak} />
      </div>

      {/* Meters + gain + speedometer */}
      <div style={{
        padding: '5px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(180,90,40,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <Speedometer peak={peak} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Chrome trim separator */}
      <div style={{
        height: 1, margin: '0 15px', flexShrink: 0,
        background: 'linear-gradient(90deg, transparent, rgba(200,200,200,0.12), rgba(255,255,255,0.18), rgba(200,200,200,0.12), transparent)',
      }} />

      {/* Knobs row 1: LOW, MID, HIGH drive — chrome shifter knobs */}
      <div style={{
        padding: '7px 6px 3px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(180,90,40,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="LOW" value={lowDrive} defaultValue={0.2} size={28} format={pctFmt}
          onChange={v => { setLowDrive(v); engineRef.current?.setLowDrive(v); setActivePreset(null); }} />
        <Knob label="MID" value={midDrive} defaultValue={0.4} size={28} format={pctFmt}
          onChange={v => { setMidDrive(v); engineRef.current?.setMidDrive(v); setActivePreset(null); }} />
        <Knob label="HIGH" value={highDrive} defaultValue={0.2} size={28} format={pctFmt}
          onChange={v => { setHighDrive(v); engineRef.current?.setHighDrive(v); setActivePreset(null); }} />
      </div>

      {/* Knobs row 2: GEAR 1 (crossLo), GEAR 2 (crossHi), TONE (elongated), MIX */}
      <div style={{
        padding: '4px 4px 6px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(180,90,40,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="GEAR 1" value={crossLo} defaultValue={0.3} size={28} format={crossLoFmt}
          onChange={v => { setCrossLo(v); engineRef.current?.setCrossLo(v); setActivePreset(null); }} />
        <Knob label="GEAR 2" value={crossHi} defaultValue={0.6} size={28} format={crossHiFmt}
          onChange={v => { setCrossHi(v); engineRef.current?.setCrossHi(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={28}
          format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'FLAT'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1} size={28} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bottom: Ignition switch bypass */}
      <div style={{
        padding: '5px 12px 8px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        position: 'relative', zIndex: 2, gap: 10, flexShrink: 0,
      }}>
        <IgnitionSwitch
          bypassed={bypassed}
          totalDrive={totalDrive}
          onToggle={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
        />
      </div>

      {/* Bottom chrome trim */}
      <div style={{
        position: 'absolute', bottom: 0, left: 20, right: 20, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(200,200,200,0.1), rgba(255,255,255,0.15), rgba(200,200,200,0.1), transparent)',
        pointerEvents: 'none', zIndex: 5,
      }} />
    </div>
  );
}
