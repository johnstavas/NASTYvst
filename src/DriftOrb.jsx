import { useState, useEffect, useRef, useCallback } from 'react';
import { createDriftEngine } from './driftEngine';
import PresetSelector from './PresetSelector';

// ─── DRIFT: Aurora Field ──────────────────────────────────────────────────────
// ETHEREAL OTHERWORLDLY — full-canvas aurora borealis with floating glass orb controls
// No visible borders. Controls float like constellations over the northern lights.
// Everything soft, organic, no sharp edges anywhere.

// ─── Aurora Borealis Canvas ───────────────────────────────────────────────────
function AuroraCanvas({ motion, speed, random, stereo, peakLevel = 0, depth, bypassed }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const firefliesRef = useRef(null);
  const shootingStarRef = useRef({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  const lastPeakRef = useRef(0);
  const rippleRef = useRef([]);
  const valRef = useRef({ motion: 0, speed: 0, random: 0, stereo: 0, peakLevel: 0, depth: 0, bypassed: false });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { motion, speed, random, stereo, peakLevel, depth, bypassed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 200, H = 280;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize fireflies
    if (!firefliesRef.current) {
      const ff = [];
      for (let i = 0; i < 40; i++) {
        ff.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vy: -(0.1 + Math.random() * 0.4),
          size: 0.5 + Math.random() * 1.5,
          phase: Math.random() * Math.PI * 2,
          hue: 300 + Math.random() * 60, // pink -> magenta -> purple
          brightness: 0.3 + Math.random() * 0.7,
        });
      }
      firefliesRef.current = ff;
    }

    let raf;
    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.004;
      const phase = phaseRef.current;

      // Read LIVE values from ref (not stale closure!)
      const { motion: _motion, speed: _speed, random: _random, stereo: _stereo, peakLevel: _peakLevel, depth: _depth, bypassed: _bypassed } = valRef.current;
      const peak = _peakLevel || 0;

      // Audio transient -> ripple
      if (peak > lastPeakRef.current + 0.04 && peak > 0.08) {
        rippleRef.current.push({
          x: W / 2 + (Math.random() - 0.5) * W * 0.5,
          y: H * 0.4 + Math.random() * H * 0.3,
          birth: phase,
          intensity: Math.min(1, peak * 1.5),
          radius: 0,
        });
        if (rippleRef.current.length > 8) rippleRef.current.shift();
      }
      lastPeakRef.current = peak * 0.85 + lastPeakRef.current * 0.15;

      // Audio-reactive brightness
      const audioBright = 0.3 + peak * 0.7;
      const dimFactor = _bypassed ? 0.15 : audioBright;

      // ── Background: deep void ──
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, `rgba(8,4,12,${0.3 * dimFactor + 0.1})`);
      bgGrad.addColorStop(0.5, `rgba(12,6,16,${0.2 * dimFactor + 0.05})`);
      bgGrad.addColorStop(1, `rgba(6,3,8,${0.3 * dimFactor + 0.1})`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── "DRIFT" text rendered IN the aurora ──
      ctx.save();
      ctx.font = '800 36px system-ui, -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(200, 100, 160, ${0.03 * dimFactor})`;
      ctx.fillText('DRIFT', W / 2, H * 0.14);
      ctx.restore();

      // ── Aurora curtain layers ──
      const curtainLayers = 5;
      for (let layer = 0; layer < curtainLayers; layer++) {
        const layerProgress = layer / curtainLayers;
        const layerY = H * 0.15 + layerProgress * H * 0.55;
        const swayAmount = (4 + _motion * 18) * (1 + layerProgress * 0.5);
        const flowSpeed = 0.3 + _speed * 1.2;

        // Each curtain is a filled shape with varying heights
        ctx.beginPath();
        const points = [];
        for (let x = -5; x <= W + 5; x += 2) {
          const nx = x / W;

          // Multiple sine waves for organic flow
          const wave1 = Math.sin(nx * 3 + phase * flowSpeed + layer * 1.7) * swayAmount;
          const wave2 = Math.sin(nx * 7 + phase * flowSpeed * 1.3 + layer * 0.9) * swayAmount * 0.4;
          const wave3 = Math.sin(nx * 13 + phase * flowSpeed * 0.7) * _random * swayAmount * 0.3;
          const turbulence = _random > 0.1
            ? Math.sin(nx * 20 + phase * 2.5 + layer * 3.1) * _random * 6
            : 0;

          // Audio ripple influence
          let rippleEffect = 0;
          for (const rip of rippleRef.current) {
            const dist = Math.abs(x - rip.x);
            const age = phase - rip.birth;
            const ripRadius = age * 80;
            if (dist < ripRadius + 30) {
              const wave = Math.sin((dist - ripRadius) * 0.15) * rip.intensity * Math.max(0, 1 - age * 1.5);
              rippleEffect += wave * 8;
            }
          }

          const curtainHeight = 20 + _depth * 30 + Math.sin(nx * 5 + phase * 0.5) * 10;
          const y = layerY + wave1 + wave2 + wave3 + turbulence + rippleEffect;
          points.push({ x, y, h: curtainHeight });
        }

        // Draw curtain as gradient-filled shape
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y - points[0].h / 2);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y - points[i].h / 2);
        }
        for (let i = points.length - 1; i >= 0; i--) {
          ctx.lineTo(points[i].x, points[i].y + points[i].h / 2);
        }
        ctx.closePath();

        // Color per layer: pink -> magenta -> purple -> green touches
        const hues = [330, 310, 290, 270, 140]; // last is green
        const hue = hues[layer];
        const sat = 50 + layer * 5;
        const light = 55 + peak * 15;
        const alpha = (0.04 + _motion * 0.06 + peak * 0.05) * dimFactor * (1 - layerProgress * 0.3);

        const curtainGrad = ctx.createLinearGradient(0, layerY - 30, 0, layerY + 30);
        curtainGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${alpha * 0.3})`);
        curtainGrad.addColorStop(0.3, `hsla(${hue}, ${sat + 10}%, ${light + 5}%, ${alpha})`);
        curtainGrad.addColorStop(0.5, `hsla(${hue + 10}, ${sat + 15}%, ${light + 10}%, ${alpha * 1.2})`);
        curtainGrad.addColorStop(0.7, `hsla(${hue}, ${sat + 10}%, ${light + 5}%, ${alpha})`);
        curtainGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${light}%, ${alpha * 0.3})`);
        ctx.fillStyle = curtainGrad;
        ctx.fill();

        // Soft edge glow on curtains
        if (peak > 0.2 && layer < 3) {
          ctx.strokeStyle = `hsla(${hue}, ${sat + 20}%, ${light + 15}%, ${alpha * 0.5 * peak})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // ── Clean up old ripples ──
      rippleRef.current = rippleRef.current.filter(r => (phase - r.birth) < 1.5);

      // ── Firefly particles drifting upward ──
      const fireflies = firefliesRef.current;
      const ffSpeedMult = 1 + peak * 2.5;
      const ffCount = Math.min(fireflies.length, Math.floor(10 + peak * 30));
      for (let i = 0; i < ffCount; i++) {
        const ff = fireflies[i];
        ff.y += ff.vy * ffSpeedMult;
        ff.x += Math.sin(phase * 0.5 + ff.phase) * _motion * 0.3;

        if (ff.y < -5) { ff.y = H + 5; ff.x = Math.random() * W; }

        const twinkle = 0.4 + 0.6 * ((Math.sin(t * 0.002 + ff.phase) + 1) * 0.5);
        const alpha = twinkle * ff.brightness * dimFactor * (0.3 + peak * 0.5);

        if (alpha < 0.02) continue;

        // Soft glow
        ctx.beginPath();
        ctx.arc(ff.x, ff.y, ff.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${ff.hue}, 50%, 75%, ${alpha * 0.08})`;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(ff.x, ff.y, ff.size * twinkle, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${ff.hue}, 60%, 80%, ${alpha})`;
        ctx.fill();
      }

      // ── Shooting star (occasional) ──
      const ss = shootingStarRef.current;
      if (!ss.active && Math.random() < 0.002) {
        ss.active = true;
        ss.x = Math.random() * W * 0.3;
        ss.y = Math.random() * H * 0.3;
        ss.vx = 3 + Math.random() * 4;
        ss.vy = 1 + Math.random() * 2;
        ss.life = 1;
      }
      if (ss.active) {
        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.life -= 0.025;
        if (ss.life <= 0) { ss.active = false; }
        else {
          const ssAlpha = ss.life * dimFactor;
          // Trail
          ctx.beginPath();
          ctx.moveTo(ss.x, ss.y);
          ctx.lineTo(ss.x - ss.vx * 8, ss.y - ss.vy * 8);
          const trailGrad = ctx.createLinearGradient(ss.x, ss.y, ss.x - ss.vx * 8, ss.y - ss.vy * 8);
          trailGrad.addColorStop(0, `rgba(255,200,240,${ssAlpha * 0.8})`);
          trailGrad.addColorStop(1, `rgba(255,200,240,0)`);
          ctx.strokeStyle = trailGrad;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Bright head
          ctx.beginPath();
          ctx.arc(ss.x, ss.y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,240,255,${ssAlpha})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{
    width: 200, height: 280, display: 'block',
    position: 'absolute', top: 0, left: 0,
  }} />;
}

// ─── Floating Glass Orb Knob ──────────────────────────────────────────────────
function GlassOrb({ size = 24, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 1;
  const id = useRef(`go-${Math.random().toString(36).slice(2, 7)}`).current;

  // Orbiting dot position (full 360 based on norm)
  const orbitAngle = -135 + norm * 270;
  const orbitRad = (orbitAngle - 90) * Math.PI / 180;
  const dotR = r * 0.5;
  const dotX = cx + dotR * Math.cos(orbitRad);
  const dotY = cy + dotR * Math.sin(orbitRad);

  return (
    <svg width={size} height={size + 4} style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        {/* Glass sphere gradient */}
        <radialGradient id={`${id}-glass`} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="rgba(200,140,180,0.12)" />
          <stop offset="40%" stopColor="rgba(120,60,100,0.08)" />
          <stop offset="80%" stopColor="rgba(40,20,35,0.15)" />
          <stop offset="100%" stopColor="rgba(20,10,20,0.2)" />
        </radialGradient>
        {/* Glass highlight (refraction arc) */}
        <radialGradient id={`${id}-highlight`} cx="30%" cy="25%" r="35%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.2)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`${id}-shadow`}>
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.4)" />
        </filter>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Float shadow underneath */}
      <ellipse cx={cx} cy={size + 1} rx={r * 0.6} ry={1.5}
        fill="rgba(0,0,0,0.15)"
      />

      {/* Glass sphere body */}
      <circle cx={cx} cy={cy} r={r}
        fill={`url(#${id}-glass)`}
        filter={`url(#${id}-shadow)`}
      />

      {/* Subtle border ring */}
      <circle cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(200,120,160,0.12)"
        strokeWidth="0.4"
      />

      {/* Glass refraction highlight (top-left arc) */}
      <circle cx={cx} cy={cy} r={r}
        fill={`url(#${id}-highlight)`}
      />

      {/* White arc highlight */}
      <path
        d={`M ${cx - r * 0.5} ${cy - r * 0.3} A ${r * 0.7} ${r * 0.7} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.65}`}
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="0.8"
        strokeLinecap="round"
      />

      {/* Orbiting glow dot inside */}
      <circle cx={dotX} cy={dotY} r="2.5"
        fill="rgba(255,120,200,0.15)"
        filter={`url(#${id}-glow)`}
      />
      <circle cx={dotX} cy={dotY} r="1.2"
        fill="rgba(255,140,210,0.8)"
      />
    </svg>
  );
}

// ─── Knob with hover-reveal label ─────────────────────────────────────────────
function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 24, format, sensitivity = 120 }) {
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
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none', position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size + 4, cursor: dragging ? 'grabbing' : 'grab' }}>
        <GlassOrb size={size} norm={norm} />
      </div>
      {/* Label fades in on hover */}
      <span style={{
        fontSize: 6, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(240,120,180,0.65)', fontWeight: 600, textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, Arial, sans-serif', lineHeight: 1,
        opacity: showLabel ? 1 : 0,
        transition: 'opacity 0.2s ease',
        marginTop: 1,
      }}>{label}</span>
      <span style={{
        fontSize: 5, color: 'rgba(200,100,160,0.4)', fontFamily: '"Courier New",monospace',
        fontWeight: 600, textAlign: 'center',
        opacity: showLabel ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}>{display}</span>
    </div>
  );
}

// ─── Horizontal slider for the hidden drawer ──────────────────────────────────
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
      <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(200,80,150,0.4)', width: 34, textAlign: 'right', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      <div
        onPointerDown={onDown}
        onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{
          flex: 1, height: 3, background: 'rgba(200,80,150,0.06)', borderRadius: 2,
          position: 'relative', cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%', width: `${norm * 100}%`,
          background: 'rgba(200,80,150,0.15)', borderRadius: 2,
        }} />
        <div style={{
          position: 'absolute', top: '50%', left: `${norm * 100}%`, transform: 'translate(-50%, -50%)',
          width: 7, height: 7, borderRadius: '50%', background: 'rgba(240,120,180,0.5)',
          boxShadow: '0 0 4px rgba(200,60,140,0.3)',
        }} />
      </div>
      <span style={{ fontSize: 7, color: 'rgba(200,80,150,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600, width: 26, textAlign: 'left', flexShrink: 0 }}>{display}</span>
    </div>
  );
}

// ─── Breathing Orb Bypass ─────────────────────────────────────────────────────
function BreathingOrb({ active, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={active ? 'Active' : 'Bypassed'}
      style={{
        position: 'relative', cursor: 'pointer',
        width: 18, height: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Halo glow */}
      {active && (
        <div style={{
          position: 'absolute',
          width: 16, height: 16, borderRadius: '50%',
          background: 'rgba(255,120,200,0.08)',
          animation: 'breatheHalo 3s ease-in-out infinite',
        }} />
      )}

      {/* Core orb */}
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: active
          ? 'radial-gradient(circle at 35% 35%, rgba(255,180,220,0.9), rgba(255,80,160,0.7))'
          : 'rgba(80,40,60,0.3)',
        boxShadow: active
          ? '0 0 8px rgba(255,100,180,0.4), 0 0 16px rgba(255,80,160,0.15)'
          : 'none',
        animation: active ? 'breatheOrb 3s ease-in-out infinite' : 'none',
        transition: 'background 0.3s ease, box-shadow 0.3s ease',
      }} />

      {/* Hover text */}
      {hovered && (
        <span style={{
          position: 'absolute', top: -10,
          fontSize: 5, letterSpacing: '0.15em', color: 'rgba(240,120,180,0.4)',
          fontFamily: 'system-ui', fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>{active ? 'ON' : 'OFF'}</span>
      )}

      <style>{`
        @keyframes breatheOrb {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.25); }
        }
        @keyframes breatheHalo {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.6); opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}

// Meter update (kept for engine integration)
function updateMeterHidden(level) {
  return level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
}

const PRESETS = [
  { name: 'INIT',      motion: 0.3, speed: 0.3, random: 0.2, stereo: 0.4, tone: 0.6, depth: 0.3, mix: 0.5 },
  { name: 'SUBTLE',    motion: 0.15,speed: 0.2, random: 0.1, stereo: 0.3, tone: 0.7, depth: 0.2, mix: 0.4 },
  { name: 'BREATHE',   motion: 0.4, speed: 0.15,random: 0.3, stereo: 0.5, tone: 0.6, depth: 0.35,mix: 0.5 },
  { name: 'SHIMMER',   motion: 0.5, speed: 0.5, random: 0.1, stereo: 0.6, tone: 0.8, depth: 0.4, mix: 0.45 },
  { name: 'GHOST',     motion: 0.3, speed: 0.1, random: 0.5, stereo: 0.7, tone: 0.5, depth: 0.25,mix: 0.6 },
  { name: 'UNSTABLE',  motion: 0.6, speed: 0.4, random: 0.7, stereo: 0.5, tone: 0.55,depth: 0.5, mix: 0.5 },
  { name: 'WIDE AIR',  motion: 0.35,speed: 0.25,random: 0.2, stereo: 0.9, tone: 0.75,depth: 0.3, mix: 0.55 },
  { name: 'DEEP DRIFT',motion: 0.7, speed: 0.2, random: 0.4, stereo: 0.6, tone: 0.4, depth: 0.6, mix: 0.5 },
];

const PRESET_COLORS = {
  bg: '#100a10', text: 'rgba(240,120,180,0.8)', textDim: 'rgba(200,80,150,0.45)',
  border: 'rgba(200,60,140,0.12)', hoverBg: 'rgba(200,60,140,0.08)', activeBg: 'rgba(200,60,140,0.05)',
};

export default function DriftOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [motion, setMotion] = useState(initialState?.motion ?? 0.3);
  const [speed,  setSpeed]  = useState(initialState?.speed  ?? 0.3);
  const [random, setRandom] = useState(initialState?.random ?? 0.2);
  const [stereo, setStereo] = useState(initialState?.stereo ?? 0.4);
  const [tone,   setTone]   = useState(initialState?.tone   ?? 0.6);
  const [depth,  setDepth]  = useState(initialState?.depth  ?? 0.3);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 0.5);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, motion, speed, random, stereo, tone, depth, mix, bypassed };

  // Engine init
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createDriftEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setMotion(s.motion); eng.setSpeed(s.speed); eng.setRandom(s.random);
      eng.setStereo(s.stereo); eng.setTone(s.tone); eng.setDepth(s.depth);
      eng.setMix(s.mix); eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  // Meter polling
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        const peak = engineRef.current.getInputPeak();
        updateMeterHidden(peak);
        updateMeterHidden(engineRef.current.getOutputPeak());
        setPeakLevel(peak);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // State sync
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, motion, speed, random, stereo, tone, depth, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, motion, speed, random, stereo, tone, depth, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setMotion(p.motion); setSpeed(p.speed); setRandom(p.random); setStereo(p.stereo);
    setTone(p.tone); setDepth(p.depth); setMix(p.mix); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setMotion(p.motion); e.setSpeed(p.speed); e.setRandom(p.random); e.setStereo(p.stereo); e.setTone(p.tone); e.setDepth(p.depth); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 200, position: 'relative',
      background: 'linear-gradient(170deg, #100a10 0%, #0e0810 50%, #0c080e 100%)',
      borderRadius: 0,
      border: 'none',
      boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 30px rgba(200,60,140,0.06)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
      overflow: 'hidden',
      animation: 'driftSway 8s ease-in-out infinite',
    }}>

      <style>{`
        @keyframes driftSway {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(0.5px, -0.5px); }
          50% { transform: translate(-0.5px, 0.5px); }
          75% { transform: translate(0.5px, 0.5px); }
        }
        @keyframes constellationPulse {
          0%, 100% { opacity: 0.08; }
          50% { opacity: 0.2; }
        }
      `}</style>

      {/* ── Full-canvas aurora (behind everything) ── */}
      <div style={{ position: 'relative', width: 200, height: 280 }}>
        <AuroraCanvas
          motion={motion} speed={speed} random={random}
          stereo={stereo} peakLevel={peakLevel} depth={depth}
          bypassed={bypassed}
        />

        {/* ── Constellation lines connecting some knob positions ── */}
        <svg width="200" height="280" style={{
          position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 4,
        }}>
          <line x1="100" y1="152" x2="40" y2="182" stroke="rgba(200,120,180,0.08)" strokeWidth="0.5"
            style={{ animation: 'constellationPulse 5s ease-in-out infinite' }} />
          <line x1="100" y1="152" x2="160" y2="182" stroke="rgba(200,120,180,0.08)" strokeWidth="0.5"
            style={{ animation: 'constellationPulse 5s ease-in-out infinite 1s' }} />
          <line x1="40" y1="182" x2="100" y2="212" stroke="rgba(200,120,180,0.08)" strokeWidth="0.5"
            style={{ animation: 'constellationPulse 5s ease-in-out infinite 2s' }} />
          <line x1="160" y1="182" x2="100" y2="212" stroke="rgba(200,120,180,0.08)" strokeWidth="0.5"
            style={{ animation: 'constellationPulse 5s ease-in-out infinite 3s' }} />
          {/* Small constellation dots at intersections */}
          <circle cx="100" cy="152" r="1" fill="rgba(200,120,180,0.12)" />
          <circle cx="40" cy="182" r="1" fill="rgba(200,120,180,0.12)" />
          <circle cx="160" cy="182" r="1" fill="rgba(200,120,180,0.12)" />
          <circle cx="100" cy="212" r="1" fill="rgba(200,120,180,0.12)" />
        </svg>

        {/* ── Loading indicator ── */}
        {loading && <span style={{
          position: 'absolute', top: 7, left: 52, zIndex: 15,
          fontSize: 7, color: 'rgba(200,80,150,0.2)',
        }}>...</span>}

        {/* ── Breathing Orb bypass — top-right ── */}
        <div style={{ position: 'absolute', top: 4, right: 18, zIndex: 15 }}>
          <BreathingOrb
            active={!bypassed}
            onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
          />
        </div>

        {/* ── X button — top-right corner ── */}
        {onRemove && (
          <span
            onClick={onRemove}
            style={{
              position: 'absolute', top: 3, right: 4, zIndex: 15,
              fontSize: 10, cursor: 'pointer', color: 'rgba(200,80,150,0.15)',
              fontWeight: 400, lineHeight: 1, transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,120,120,0.5)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(200,80,150,0.15)'}
          >&times;</span>
        )}

        {/* ── 4 main knobs in diamond/constellation, floating over aurora ── */}
        {/* Organic scattered positions — not rigid rows */}

        {/* Top center: MOTION */}
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 138, zIndex: 10,
          background: 'rgba(16,10,16,0.25)', borderRadius: 12, padding: '2px 4px',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Knob label="MOTION" value={motion} defaultValue={0.3} size={24} format={pctFmt}
            onChange={v => { setMotion(v); engineRef.current?.setMotion(v); setActivePreset(null); }} />
        </div>

        {/* Left: DEPTH */}
        <div style={{
          position: 'absolute', left: 18, top: 168, zIndex: 10,
          background: 'rgba(16,10,16,0.25)', borderRadius: 12, padding: '2px 4px',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Knob label="DEPTH" value={depth} defaultValue={0.3} size={24} format={pctFmt}
            onChange={v => { setDepth(v); engineRef.current?.setDepth(v); setActivePreset(null); }} />
        </div>

        {/* Right: STEREO */}
        <div style={{
          position: 'absolute', right: 18, top: 168, zIndex: 10,
          background: 'rgba(16,10,16,0.25)', borderRadius: 12, padding: '2px 4px',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Knob label="STEREO" value={stereo} defaultValue={0.4} size={24} format={pctFmt}
            onChange={v => { setStereo(v); engineRef.current?.setStereo(v); setActivePreset(null); }} />
        </div>

        {/* Bottom center: MIX */}
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 200, zIndex: 10,
          background: 'rgba(16,10,16,0.25)', borderRadius: 12, padding: '2px 4px',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Knob label="MIX" value={mix} defaultValue={0.5} size={24} format={pctFmt}
            onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
        </div>

        {/* Extra organic scattered knobs -- TONE top-left, RANDOM offset right */}
        <div style={{
          position: 'absolute', left: 14, top: 95, zIndex: 10,
          background: 'rgba(16,10,16,0.2)', borderRadius: 12, padding: '2px 4px',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Knob label="TONE" value={tone} defaultValue={0.6} size={22}
            format={v => v < 0.3 ? 'DARK' : v > 0.7 ? 'AIR' : 'WARM'}
            onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        </div>

        <div style={{
          position: 'absolute', right: 14, top: 100, zIndex: 10,
          background: 'rgba(16,10,16,0.2)', borderRadius: 12, padding: '2px 4px',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Knob label="RANDOM" value={random} defaultValue={0.2} size={22} format={pctFmt}
            onChange={v => { setRandom(v); engineRef.current?.setRandom(v); setActivePreset(null); }} />
        </div>

        {/* Extra constellation lines for the new knobs */}
        <svg width="200" height="280" style={{
          position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 3,
        }}>
          <line x1="30" y1="110" x2="100" y2="152" stroke="rgba(200,120,180,0.05)" strokeWidth="0.4" />
          <line x1="170" y1="115" x2="160" y2="182" stroke="rgba(200,120,180,0.05)" strokeWidth="0.4" />
          <line x1="30" y1="110" x2="40" y2="182" stroke="rgba(200,120,180,0.05)" strokeWidth="0.4" />
        </svg>
      </div>

      {/* ── "..." drawer toggle ── */}
      <div style={{
        display: 'flex', justifyContent: 'center', padding: '3px 0',
        background: 'rgba(16,10,16,0.6)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}>
        <span
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={{
            fontSize: 10, cursor: 'pointer', color: 'rgba(200,80,150,0.25)',
            letterSpacing: '0.2em', lineHeight: 1, padding: '0 4px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'rgba(240,120,180,0.5)'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(200,80,150,0.25)'}
        >{drawerOpen ? '\u2013' : '\u2026'}</span>
      </div>

      {/* ── Hidden drawer: SPEED, IN/OUT gain, Presets ── */}
      <div style={{
        maxHeight: drawerOpen ? 200 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.3s ease',
        background: 'rgba(12,8,14,0.9)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      }}>
        <div style={{ padding: '6px 12px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <HSlider label="SPEED" value={speed} defaultValue={0.3}
            format={v => { const hz = 0.1 * Math.pow(60, v); return hz < 1 ? `${(hz*1000).toFixed(0)}m` : `${hz.toFixed(1)}Hz`; }}
            onChange={v => { setSpeed(v); engineRef.current?.setSpeed(v); setActivePreset(null); }} />

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(200,60,140,0.06)', margin: '2px 0' }} />

          <HSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} format={dbFmt}
            onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
          <HSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} format={dbFmt}
            onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(200,60,140,0.06)', margin: '2px 0' }} />

          {/* Preset selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(200,80,150,0.3)', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>PRESET</span>
            <div style={{ flex: 1 }}>
              <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
