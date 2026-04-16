import { useState, useEffect, useRef, useCallback } from 'react';
import { createTransientReverbEngine } from './transientReverbEngine';
import PresetSelector from './PresetSelector';

// ─── TRANSIENT REVERB: Impact Shockwave Visualization ────────────────────────
// Sharp white/yellow impact points with expanding teal/green shockwave rings.
// Transient protect shows a shield/barrier at impact. Bloom recovery visible.

// ─── Shockwave Canvas ────────────────────────────────────────────────────────
function ShockwaveCanvas({ protect, tail, attackClear, size, peakLevel = 0, bloom = 1, transient = 0, bypassed }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const impactsRef = useRef([]);
  const lastPeakRef = useRef(0);
  const valRef = useRef({ protect: 0.6, tail: 0.5, attackClear: 0.4, size: 0.4, peakLevel: 0, bloom: 1, transient: 0, bypassed: false });

  valRef.current = { protect, tail, attackClear, size, peakLevel, bloom, transient, bypassed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 280;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    let raf;
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.004;
      const phase = phaseRef.current;

      const { protect: _prot, tail: _tail, attackClear: _ac, size: _size, peakLevel: _peak, bloom: _bloom, transient: _trans, bypassed: _bypassed } = valRef.current;
      const peak = _peak || 0;
      const dimFactor = _bypassed ? 0.25 : (0.75 + peak * 0.25);

      // ── Background: dark with subtle radial gradient from center ──
      const bgGrad = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.8);
      bgGrad.addColorStop(0, `rgba(12,16,14,${0.3 * dimFactor + 0.15})`);
      bgGrad.addColorStop(0.5, `rgba(8,12,10,${0.35 * dimFactor + 0.12})`);
      bgGrad.addColorStop(1, `rgba(5,8,6,${0.45 * dimFactor + 0.15})`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Ambient tail energy visualization (background rings) ──
      const tailEnergy = _tail * _bloom * dimFactor;
      if (tailEnergy > 0.05) {
        for (let ring = 0; ring < 5; ring++) {
          const ringR = 30 + ring * 20 + Math.sin(phase * 0.5 + ring) * 5;
          const ringAlpha = tailEnergy * 0.03 * (1 - ring * 0.15);
          ctx.beginPath();
          ctx.arc(W / 2, H * 0.45, ringR * (0.8 + _size * 0.4), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(60,180,140,${ringAlpha})`;
          ctx.lineWidth = 1 + _size;
          ctx.stroke();
        }
      }

      // ── Detect and spawn new impacts ──
      if (peak > lastPeakRef.current + 0.06 && peak > 0.1) {
        impactsRef.current.push({
          x: W / 2 + (Math.random() - 0.5) * 40,
          y: H * 0.4 + (Math.random() - 0.5) * 30,
          birth: phase,
          intensity: Math.min(1, peak * 2),
          rings: [],
        });
        if (impactsRef.current.length > 6) impactsRef.current.shift();
      }
      lastPeakRef.current = peak * 0.8 + lastPeakRef.current * 0.2;

      // ── Draw impacts and shockwave rings ──
      const impacts = impactsRef.current;
      const sizeScale = 0.6 + _size * 1.4;

      for (let idx = impacts.length - 1; idx >= 0; idx--) {
        const imp = impacts[idx];
        const age = phase - imp.birth;

        if (age > 4) { impacts.splice(idx, 1); continue; }

        // ── Impact flash (sharp white/yellow at center) ──
        if (age < 0.3) {
          const flashAlpha = (1 - age / 0.3) * imp.intensity * dimFactor;

          // Bright core flash
          const flashGrad = ctx.createRadialGradient(imp.x, imp.y, 0, imp.x, imp.y, 15);
          flashGrad.addColorStop(0, `rgba(255,250,220,${flashAlpha * 0.8})`);
          flashGrad.addColorStop(0.3, `rgba(255,220,120,${flashAlpha * 0.4})`);
          flashGrad.addColorStop(1, `rgba(255,200,80,0)`);
          ctx.fillStyle = flashGrad;
          ctx.fillRect(imp.x - 15, imp.y - 15, 30, 30);

          // Cross/star at impact point
          ctx.save();
          ctx.translate(imp.x, imp.y);
          ctx.rotate(age * 2);
          for (let s = 0; s < 4; s++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -8 * (1 - age / 0.3));
            ctx.strokeStyle = `rgba(255,255,240,${flashAlpha * 0.6})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.restore();
        }

        // ── Shield/barrier at impact (transient protect visual) ──
        if (_prot > 0.1 && age < 0.5) {
          const shieldAlpha = (1 - age / 0.5) * _prot * dimFactor * 0.4;
          const shieldR = 8 + age * 20;

          // Hexagonal shield segments
          ctx.save();
          ctx.translate(imp.x, imp.y);
          for (let seg = 0; seg < 6; seg++) {
            const segAngle = (seg / 6) * Math.PI * 2 + phase * 0.5;
            const sx = Math.cos(segAngle) * shieldR;
            const sy = Math.sin(segAngle) * shieldR;
            const ex = Math.cos(segAngle + Math.PI / 3) * shieldR;
            const ey = Math.sin(segAngle + Math.PI / 3) * shieldR;

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = `rgba(200,220,255,${shieldAlpha})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.restore();

          // Attack clear: brighter shield = more gating
          if (_ac > 0.3) {
            ctx.beginPath();
            ctx.arc(imp.x, imp.y, shieldR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180,220,255,${shieldAlpha * _ac * 0.3})`;
            ctx.fill();
          }
        }

        // ── Expanding shockwave rings (reverb tail) ──
        const ringCount = 3 + Math.floor(_tail * 3);
        for (let r = 0; r < ringCount; r++) {
          const ringDelay = r * 0.15;
          const ringAge = age - ringDelay;
          if (ringAge < 0) continue;

          const maxRadius = (60 + _size * 60) * sizeScale;
          const ringRadius = ringAge * 30 * sizeScale;
          if (ringRadius > maxRadius) continue;

          const ringLife = 1 - ringRadius / maxRadius;

          // Bloom modulation: rings dim during transient protection
          const bloomMod = _bloom * 0.8 + 0.2;
          const ringAlpha = ringLife * imp.intensity * 0.25 * dimFactor * bloomMod * _tail;

          if (ringAlpha < 0.005) continue;

          // Ring color: teal/green
          const hue = 160 + r * 10; // teal -> green gradient
          ctx.beginPath();
          ctx.arc(imp.x, imp.y, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, 60%, 55%, ${ringAlpha})`;
          ctx.lineWidth = Math.max(0.5, 2 * ringLife);
          ctx.stroke();

          // Soft fill for inner rings
          if (r < 2 && ringLife > 0.5) {
            ctx.beginPath();
            ctx.arc(imp.x, imp.y, ringRadius, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${hue}, 50%, 50%, ${ringAlpha * 0.05})`;
            ctx.fill();
          }
        }
      }

      // ── Bloom indicator bar at bottom ──
      const bloomBarY = H - 22;
      const bloomBarW = W * 0.6;
      const bloomBarX = (W - bloomBarW) / 2;

      ctx.fillStyle = `rgba(40,60,50,${0.15 * dimFactor})`;
      ctx.fillRect(bloomBarX, bloomBarY, bloomBarW, 3);

      ctx.fillStyle = `rgba(60,200,140,${0.25 * dimFactor})`;
      ctx.fillRect(bloomBarX, bloomBarY, bloomBarW * _bloom, 3);

      // Bloom label
      ctx.save();
      ctx.font = '500 5px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(60,180,130,${0.25 * dimFactor})`;
      ctx.fillText('BLOOM', W / 2, bloomBarY - 2);
      ctx.restore();

      // ── Particle debris from impacts ──
      for (const imp of impacts) {
        const age = phase - imp.birth;
        if (age > 1) continue;
        const debrisCount = Math.floor(imp.intensity * 8);
        for (let d = 0; d < debrisCount; d++) {
          const angle = (d / debrisCount) * Math.PI * 2 + imp.birth * 7;
          const dist = age * (20 + d * 5);
          const dx = imp.x + Math.cos(angle) * dist;
          const dy = imp.y + Math.sin(angle) * dist;
          const debrisAlpha = (1 - age) * imp.intensity * 0.3 * dimFactor;

          ctx.beginPath();
          ctx.arc(dx, dy, 1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,240,220,${debrisAlpha})`;
          ctx.fill();
        }
      }

      // ── Title ──
      ctx.save();
      ctx.font = '600 7px system-ui, -apple-system, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(120,200,160,${0.35 * dimFactor})`;
      ctx.fillText('TRANSIENT REVERB', W / 2, 14);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 280, display: 'block' }} />;
}

// ─── Diamond Knob ────────────────────────────────────────────────────────────
function DiamondKnob({ size = 26, norm = 0 }) {
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
          stroke="hsla(160,65%,55%,0.7)"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill="hsla(160,80%,70%,0.9)" />
      <circle cx={dotX} cy={dotY} r="4"
        fill="hsla(160,80%,70%,0.12)" />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
    </svg>
  );
}

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
        <DiamondKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'rgba(80,180,140,0.55)', fontWeight: 600, textAlign: 'center',
        fontFamily: 'system-ui', lineHeight: 1, marginTop: 1,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(60,160,120,0.4)', fontFamily: '"Courier New",monospace',
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
      <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(60,160,120,0.4)', width: 38, textAlign: 'right', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ flex: 1, height: 3, background: 'rgba(50,140,100,0.06)', borderRadius: 2, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${norm * 100}%`, background: 'rgba(60,180,130,0.15)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: '50%', left: `${norm * 100}%`, transform: 'translate(-50%, -50%)', width: 7, height: 7, borderRadius: '50%', background: 'rgba(80,200,150,0.5)', boxShadow: '0 0 4px rgba(60,180,120,0.3)' }} />
      </div>
      <span style={{ fontSize: 7, color: 'rgba(60,160,120,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600, width: 26, textAlign: 'left', flexShrink: 0 }}>{display}</span>
    </div>
  );
}

function BypassDot({ active, onClick }) {
  return (
    <div onClick={onClick} title={active ? 'Active' : 'Bypassed'}
      style={{ cursor: 'pointer', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: active ? 'radial-gradient(circle at 35% 35%, rgba(120,240,180,0.9), rgba(60,180,120,0.6))' : 'rgba(30,50,40,0.3)',
        boxShadow: active ? '0 0 8px rgba(60,200,140,0.4)' : 'none',
        transition: 'all 0.3s ease',
      }} />
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',              protect: 0.6, tail: 0.5, attackClear: 0.4, size: 0.4, tone: 0.5, mix: 0.3, smooth: 0 },
  { name: 'PUNCH SAFE SNARE', protect: 0.8, tail: 0.6, attackClear: 0.7, size: 0.5, tone: 0.55, mix: 0.35, smooth: 0 },
  { name: 'VOCAL CONSONANT',  protect: 0.5, tail: 0.4, attackClear: 0.5, size: 0.35, tone: 0.6, mix: 0.25, smooth: 0 },
  { name: 'TIGHT DRUM ROOM', protect: 0.7, tail: 0.35, attackClear: 0.6, size: 0.25, tone: 0.5, mix: 0.3, smooth: 0 },
  { name: 'PERCUSSION SHINE', protect: 0.4, tail: 0.55, attackClear: 0.3, size: 0.45, tone: 0.7, mix: 0.3, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#0a140e', text: 'rgba(80,200,150,0.8)', textDim: 'rgba(50,150,100,0.45)',
  border: 'rgba(50,140,90,0.12)', hoverBg: 'rgba(50,140,90,0.08)', activeBg: 'rgba(50,140,90,0.05)',
};

export default function TransientReverbOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [inputGain, setInputGain] = useState(initialState?.inputGain ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [protect, setProtect] = useState(initialState?.protect ?? 0.6);
  const [tail, setTail] = useState(initialState?.tail ?? 0.5);
  const [attackClear, setAttackClear] = useState(initialState?.attackClear ?? 0.4);
  const [size, setSize] = useState(initialState?.size ?? 0.4);
  const [tone, setTone] = useState(initialState?.tone ?? 0.5);
  const [mix, setMix] = useState(initialState?.mix ?? 0.3);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel] = useState(0);
  const [bloom, setBloom] = useState(1);
  const [transientAmt, setTransientAmt] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, protect, tail, attackClear, size, tone, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createTransientReverbEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setProtect(s.protect); eng.setTail(s.tail); eng.setAttackClear(s.attackClear);
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
      if (engineRef.current) {
        setPeakLevel(engineRef.current.getInputPeak());
        setBloom(engineRef.current.getBloom());
        setTransientAmt(engineRef.current.getTransient());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, protect, tail, attackClear, size, tone, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, protect, tail, attackClear, size, tone, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setProtect(p.protect); setTail(p.tail); setAttackClear(p.attackClear);
    setSize(p.size); setTone(p.tone); setMix(p.mix); setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    const e = engineRef.current;
    if (e) { e.setProtect(p.protect); e.setTail(p.tail); e.setAttackClear(p.attackClear); e.setSize(p.size); e.setTone(p.tone); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #12100a 0%, #0e0c08 35%, #0a0a06 70%, #080808 100%)',
      border: '1.5px solid rgba(220,180,60,0.15)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 25px rgba(220,160,40,0.08), inset 0 1px 0 rgba(240,200,100,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(220,180,60,0.1)',
        background: 'linear-gradient(180deg, rgba(220,160,40,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
            background: 'linear-gradient(135deg, #e0c040, #40c0c0)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(220,160,40,0.3))',
          }}>TRANSIENT REVERB</span>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(220,180,80,0.35)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>PUNCH-SAFE REVERB</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(220,180,60,0.4)' }}>...</span>}
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
      <div style={{ borderBottom: '1px solid rgba(220,180,60,0.08)' }}>
        <ShockwaveCanvas protect={protect} tail={tail} attackClear={attackClear} size={size}
          peakLevel={peakLevel} bloom={bloom} transient={transientAmt} bypassed={bypassed} />
      </div>

      {/* I/O */}
      <div style={{
        padding: '6px 12px', display: 'flex', gap: 12,
        borderBottom: '1px solid rgba(220,180,60,0.08)',
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

      {/* Knobs Row 1: PROTECT, TAIL, ATK CLEAR */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(220,180,60,0.06)',
      }}>
        <Knob label="PROTECT" value={protect} defaultValue={0.6} size={28} format={pctFmt}
          onChange={v => { setProtect(v); engineRef.current?.setProtect(v); setActivePreset(null); }} />
        <Knob label="TAIL" value={tail} defaultValue={0.5} format={pctFmt}
          onChange={v => { setTail(v); engineRef.current?.setTail(v); setActivePreset(null); }} />
        <Knob label="ATK CLEAR" value={attackClear} defaultValue={0.4} format={pctFmt}
          onChange={v => { setAttackClear(v); engineRef.current?.setAttackClear(v); setActivePreset(null); }} />
      </div>

      {/* Knobs Row 2: SIZE, TONE, MIX */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(220,180,60,0.06)',
      }}>
        <Knob label="SIZE" value={size} defaultValue={0.4}
          format={v => v < 0.25 ? 'TIGHT' : v > 0.75 ? 'LARGE' : 'MED'}
          onChange={v => { setSize(v); engineRef.current?.setSize(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5}
          format={v => v < 0.3 ? 'DARK' : v > 0.7 ? 'BRIGHT' : 'NEUTRAL'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.3} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bypass footer */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
          style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(60,200,140,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(100,240,180,0.95)' : 'rgba(60,160,120,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(60,200,140,0.45)' : 'rgba(40,100,80,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(60,200,140,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <BypassDot active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
        <span style={{
          fontSize: 7, fontWeight: 700, letterSpacing: '0.15em',
          color: bypassed ? 'rgba(200,160,40,0.4)' : 'rgba(120,200,140,0.5)',
          fontFamily: 'system-ui',
        }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</span>
      </div>
    </div>
  );
}
