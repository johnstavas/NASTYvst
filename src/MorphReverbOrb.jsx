import { useState, useEffect, useRef, useCallback } from 'react';
import { createMorphReverbEngine } from './morphReverbEngine';

// ─── MORPHREVERB: Two Contrasting Realms ─────────────────────────────────────
// Left realm (Engine A — Classic Schroeder): cool, geometric, crystalline.
// Right realm (Engine B — Nested Allpass): warm, diffuse, organic nebula.
// Morph line slides between them, warp shimmers the boundary.

// ─── MorphCanvas ─────────────────────────────────────────────────────────────
function MorphCanvas({ morph, size, decay, tone, density, warp, peakLevel = 0, bypassed }) {
  const canvasRef = useRef(null);
  const phaseRef  = useRef(0);
  const valRef    = useRef({ morph: 0.5, size: 0.55, decay: 0.5, tone: 0.55, density: 0.6, warp: 0.3, peakLevel: 0, bypassed: false });

  valRef.current = { morph, size, decay, tone, density, warp, peakLevel, bypassed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // ── Engine A particles (left realm): geometric, bright cyan/ice ──
    var aParticles = [];
    for (var i = 0; i < 40; i++) {
      aParticles.push({
        x: 5 + Math.random() * (W * 0.5 - 10),
        y: 5 + Math.random() * (H - 10),
        vx: (Math.random() - 0.5) * 1.4,
        vy: (Math.random() - 0.5) * 1.4,
        size: 1.2 + Math.random() * 1.8,
        opacity: 0.5 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        // Geometric: bouncing rectangular patterns
        bounceX: Math.random() < 0.5,
      });
    }

    // ── Engine B particles (right realm): large, warm, organic drift ──
    var bParticles = [];
    for (var i = 0; i < 40; i++) {
      bParticles.push({
        x: W * 0.5 + 5 + Math.random() * (W * 0.5 - 10),
        y: 5 + Math.random() * (H - 10),
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: 2.5 + Math.random() * 4.5,
        opacity: 0.25 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
        driftPhase: Math.random() * Math.PI * 2,
        driftRate: 0.3 + Math.random() * 0.4,
      });
    }

    // ── Warm nebula orbs for B realm ──
    var nebulaOrbs = [];
    for (var i = 0; i < 6; i++) {
      nebulaOrbs.push({
        x: W * 0.6 + Math.random() * W * 0.35,
        y: H * 0.15 + Math.random() * H * 0.7,
        r: 18 + Math.random() * 28,
        phase: Math.random() * Math.PI * 2,
        pulseRate: 0.4 + Math.random() * 0.6,
      });
    }

    var raf;
    var draw = function() {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.006;
      var phase = phaseRef.current;

      var v = valRef.current;
      var _mo = v.morph, _sz = v.size, _dc = v.decay, _tn = v.tone, _dn = v.density, _wp = v.warp;
      var _peak = v.peakLevel || 0, _bypassed = v.bypassed;
      var dimFactor = _bypassed ? 0.18 : (0.5 + _peak * 0.5);

      // Morph line x position (0=far left, 1=far right)
      var morphX = W * _mo;

      // ── LEFT REALM BACKGROUND (Engine A — geometric, navy/midnight) ──
      var bgA = ctx.createLinearGradient(0, 0, morphX, 0);
      bgA.addColorStop(0, 'rgba(4,8,22,1)');
      bgA.addColorStop(1, 'rgba(6,12,30,1)');
      ctx.fillStyle = bgA;
      ctx.fillRect(0, 0, morphX, H);

      // Faint cyan geometric grid in A realm
      var gridAlpha = 0.045 * dimFactor;
      ctx.strokeStyle = 'rgba(60,180,220,' + gridAlpha + ')';
      ctx.lineWidth = 0.5;
      var gridSpacing = 18;
      for (var gx = 0; gx < morphX; gx += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (var gy = 0; gy < H; gy += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(morphX, gy); ctx.stroke();
      }

      // ── RIGHT REALM BACKGROUND (Engine B — deep purple/burgundy/void) ──
      var bgB = ctx.createLinearGradient(morphX, 0, W, 0);
      bgB.addColorStop(0, 'rgba(18,6,28,1)');
      bgB.addColorStop(0.5, 'rgba(22,8,32,1)');
      bgB.addColorStop(1, 'rgba(10,4,18,1)');
      ctx.fillStyle = bgB;
      ctx.fillRect(morphX, 0, W - morphX, H);

      // ── Nebula orbs in B realm (slow-pulsing warm glows) ──
      for (var ni = 0; ni < nebulaOrbs.length; ni++) {
        var orb = nebulaOrbs[ni];
        if (orb.x < morphX + 5) continue;
        orb.phase += orb.pulseRate * 0.008;
        var orbPulse = 1.0 + Math.sin(orb.phase) * 0.18 * (0.5 + _wp * 0.5);
        var orbR = orb.r * orbPulse * (0.8 + _sz * 0.4);
        var nebHue = 15 + _tn * 25;  // amber to gold range
        var nebAlpha = 0.08 * dimFactor * (0.6 + _dc * 0.4);
        var nebGrad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orbR);
        nebGrad.addColorStop(0, 'hsla(' + nebHue + ',70%,55%,' + (nebAlpha * 1.4) + ')');
        nebGrad.addColorStop(0.45, 'hsla(' + nebHue + ',55%,40%,' + (nebAlpha * 0.7) + ')');
        nebGrad.addColorStop(1, 'hsla(' + (nebHue + 20) + ',50%,35%,0)');
        ctx.fillStyle = nebGrad;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orbR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── ENGINE A particles — geometric cyan/ice, fast, tight ──
      for (var pi = 0; pi < aParticles.length; pi++) {
        var p = aParticles[pi];
        p.phase += 0.04;

        // Geometric movement: bounce/rectangular paths
        if (p.bounceX) {
          p.x += p.vx;
          p.y += Math.sin(phase * 2 + p.phase) * 0.5;
        } else {
          p.x += Math.cos(phase * 1.5 + p.phase) * 0.5;
          p.y += p.vy;
        }

        // Keep in A realm (left of morphX)
        var aRight = Math.max(8, morphX - 4);
        if (p.x > aRight)  { p.x = aRight;  p.vx = -Math.abs(p.vx); }
        if (p.x < 4)       { p.x = 4;       p.vx =  Math.abs(p.vx); }
        if (p.y > H - 4)   { p.y = H - 4;   p.vy = -Math.abs(p.vy); }
        if (p.y < 4)       { p.y = 4;        p.vy =  Math.abs(p.vy); }

        // Brightness pulses with peak
        var twinkle = 0.6 + 0.4 * Math.sin(p.phase * 2.5);
        var aAlpha  = p.opacity * twinkle * dimFactor * (0.7 + _peak * 0.3);
        var aSz     = p.size * (0.9 + _dn * 0.25 + _peak * 0.3);

        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, aSz * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,210,240,' + (aAlpha * 0.12) + ')';
        ctx.fill();
        // Core: ice blue / cyan
        ctx.beginPath();
        ctx.arc(p.x, p.y, aSz * twinkle, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(140,230,255,' + aAlpha + ')';
        ctx.fill();
      }

      // ── ENGINE B particles — amber/gold, large, organic drift ──
      for (var pi = 0; pi < bParticles.length; pi++) {
        var bp = bParticles[pi];
        bp.driftPhase += bp.driftRate * 0.012;
        bp.x += bp.vx + Math.sin(bp.driftPhase) * 0.4 * (1 + _wp * 0.8);
        bp.y += bp.vy + Math.cos(bp.driftPhase * 0.7) * 0.3;

        // Keep in B realm (right of morphX)
        var bLeft = Math.min(W - 8, morphX + 4);
        if (bp.x < bLeft)   { bp.x = bLeft;   bp.vx =  Math.abs(bp.vx); }
        if (bp.x > W - 4)   { bp.x = W - 4;   bp.vx = -Math.abs(bp.vx); }
        if (bp.y > H - 4)   { bp.y = H - 4;   bp.vy = -Math.abs(bp.vy); }
        if (bp.y < 4)       { bp.y = 4;        bp.vy =  Math.abs(bp.vy); }

        var bAlpha = bp.opacity * dimFactor * (0.6 + _peak * 0.4);
        var bSz    = bp.size * (1 + _sz * 0.3 + _dc * 0.2);
        var bHue   = 28 + _tn * 20;

        // Soft glow
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, bSz * 2.8, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + bHue + ',60%,50%,' + (bAlpha * 0.1) + ')';
        ctx.fill();
        // Amber core
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, bSz, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + bHue + ',75%,62%,' + bAlpha + ')';
        ctx.fill();
      }

      // ── MORPH LINE — vertical glowing boundary ──
      var warpShimmer = _wp * (1.0 - Math.abs(_mo - 0.5) * 2.0);  // peaks at mo=0.5

      // Ripple/shimmer the line with warp LFO
      for (var ly = 0; ly < H; ly += 2) {
        var lxOff = Math.sin(ly * 0.08 + phase * 2.5) * warpShimmer * 6;
        var lx    = morphX + lxOff;
        var lAlpha = (0.28 + _peak * 0.2) * dimFactor;

        // Gradient: bright white/cyan center
        var lineGrad = ctx.createLinearGradient(lx - 4, ly, lx + 4, ly);
        lineGrad.addColorStop(0,   'rgba(60,180,255,0)');
        lineGrad.addColorStop(0.35,'rgba(180,230,255,' + lAlpha + ')');
        lineGrad.addColorStop(0.5, 'rgba(255,255,255,' + (lAlpha * 1.5) + ')');
        lineGrad.addColorStop(0.65,'rgba(180,230,255,' + lAlpha + ')');
        lineGrad.addColorStop(1,   'rgba(60,180,255,0)');
        ctx.fillStyle = lineGrad;
        ctx.fillRect(lx - 4, ly, 8, 2);
      }

      // ── Bypass overlay ──
      if (_bypassed) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
      }
    };

    raf = requestAnimationFrame(draw);
    return function() { cancelAnimationFrame(raf); };
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── ArcKnob ─────────────────────────────────────────────────────────────────
// Purple/violet scheme bridging both realms
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
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,8,18,0.9)"
        stroke="rgba(120,80,180,0.1)" strokeWidth="1.5" />
      {/* Filled arc */}
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke="rgba(120,80,200,0.9)"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      {/* Indicator dot */}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill="rgba(160,110,230,0.95)" />
      <circle cx={dotX} cy={dotY} r="4"
        fill="rgba(120,80,200,0.14)" />
      {/* Center */}
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(140,100,200,0.2)" />
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size + 2, cursor: dragging ? 'grabbing' : 'grab' }}>
        <ArcKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(180,140,220,0.65)', fontWeight: 700, textAlign: 'center',
        fontFamily: 'system-ui', lineHeight: 1, marginTop: 2,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(150,110,190,0.45)', fontFamily: '"Courier New",monospace',
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
      <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(150,110,190,0.4)', width: 38, textAlign: 'right', fontFamily: 'system-ui', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ flex: 1, height: 3, background: 'rgba(100,70,150,0.06)', borderRadius: 2, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${norm * 100}%`, background: 'rgba(120,80,180,0.15)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: '50%', left: `${norm * 100}%`, transform: 'translate(-50%, -50%)', width: 7, height: 7, borderRadius: '50%', background: 'rgba(140,100,200,0.5)', boxShadow: '0 0 4px rgba(120,80,180,0.3)' }} />
      </div>
      <span style={{ fontSize: 7, color: 'rgba(140,100,180,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600, width: 26, textAlign: 'left', flexShrink: 0 }}>{display}</span>
    </div>
  );
}

function BypassToggle({ active, onClick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <button onClick={onClick} style={{
        height: 26, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
        padding: '0 11px', borderRadius: 4, cursor: 'pointer',
        background: active ? 'rgba(120,80,200,0.14)' : 'rgba(10,8,18,0.9)',
        color: active ? 'rgba(190,150,240,0.95)' : 'rgba(120,90,160,0.4)',
        border: `1.5px solid ${active ? 'rgba(120,80,200,0.45)' : 'rgba(90,60,130,0.22)'}`,
        boxShadow: active ? '0 0 10px rgba(120,80,200,0.25), inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 3px 7px rgba(0,0,0,0.7)',
        fontFamily: 'system-ui',
      }}>
        {active ? 'ACTIVE' : 'BYPASS'}
      </button>
      <span style={{
        fontSize: 7, letterSpacing: '0.18em', fontFamily: 'system-ui', fontWeight: 700,
        color: active ? 'rgba(190,150,240,0.6)' : 'rgba(120,90,160,0.35)',
      }}>{active ? 'ON' : 'OFF'}</span>
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',        morph: 0.5,  size: 0.45, decay: 0.55, tone: 0.6,  density: 0.7,  warp: 0.3, mix: 0.6, smooth: 0 },
  { name: 'PLATE ROOM',  morph: 0.1,  size: 0.35, decay: 0.4,  tone: 0.75, density: 0.7,  warp: 0.1, mix: 0.9, smooth: 0 },
  { name: 'HALL',        morph: 0.85, size: 0.75, decay: 0.72, tone: 0.4,  density: 0.65, warp: 0.2, mix: 1.0, smooth: 1 },
  { name: 'MORPH SPACE', morph: 0.5,  size: 0.65, decay: 0.6,  tone: 0.5,  density: 0.7,  warp: 0.7, mix: 1.0, smooth: 2 },
  { name: 'DARK NEBULA', morph: 0.9,  size: 0.85, decay: 0.85, tone: 0.2,  density: 0.8,  warp: 0.4, mix: 0.9, smooth: 3 },
];


export default function MorphReverbOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [morph,      setMorph]      = useState(initialState?.morph      ?? 0.5);
  const [size,       setSize]       = useState(initialState?.size       ?? 0.55);
  const [decay,      setDecay]      = useState(initialState?.decay      ?? 0.5);
  const [tone,       setTone]       = useState(initialState?.tone       ?? 0.55);
  const [density,    setDensity]    = useState(initialState?.density    ?? 0.6);
  const [warp,       setWarp]       = useState(initialState?.warp       ?? 0.3);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 0.6);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [smooth,     setSmooth]     = useState(initialState?.smooth     ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel]   = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, morph, size, decay, tone, density, warp, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createMorphReverbEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setMorph(s.morph); eng.setSize(s.size); eng.setDecay(s.decay);
      eng.setTone(s.tone); eng.setDensity(s.density); eng.setWarp(s.warp);
      eng.setMix(s.mix); eng.setBypass(s.bypassed); eng.setSmooth(s.smooth);
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
      if (engineRef.current) setPeakLevel(engineRef.current.getInputPeak());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, morph, size, decay, tone, density, warp, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, morph, size, decay, tone, density, warp, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setMorph(p.morph); setSize(p.size); setDecay(p.decay);
    setTone(p.tone); setDensity(p.density); setWarp(p.warp);
    setMix(p.mix); setActivePreset(p.name);
    if (p.smooth !== undefined) setSmooth(p.smooth);
    const e = engineRef.current;
    if (e) {
      e.setMorph(p.morph); e.setSize(p.size); e.setDecay(p.decay);
      e.setTone(p.tone); e.setDensity(p.density); e.setWarp(p.warp);
      e.setMix(p.mix);
      if (p.smooth !== undefined) e.setSmooth(p.smooth);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt  = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #0d0a14 0%, #0a0810 35%, #080610 70%, #060408 100%)',
      border: '1.5px solid rgba(120,80,180,0.18)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 25px rgba(100,60,180,0.1), inset 0 1px 0 rgba(160,120,220,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(120,80,180,0.12)',
        background: 'linear-gradient(180deg, rgba(100,60,180,0.05) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.1em',
            background: 'linear-gradient(135deg, #60c0f0, #b060e8)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(100,80,200,0.4))',
          }}>MORPH / REVERB</span>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(140,100,200,0.4)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>DUAL REALM MORPHING</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(140,100,200,0.4)' }}>...</span>}
          {onRemove && (
            <span onClick={onRemove} style={{
              fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)',
              fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
            }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; }}
            >&times;</span>
          )}
        </div>
      </div>

      {/* Preset pill row */}
      <div style={{
        padding: '5px 10px', display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'nowrap',
        borderBottom: '1px solid rgba(120,80,180,0.1)',
        background: 'rgba(8,6,14,0.6)',
        overflowX: 'auto',
      }}>
        {PRESETS.map(p => {
          const isActive = activePreset === p.name;
          return (
            <button key={p.name} onClick={() => loadPreset(p)} style={{
              fontSize: 7, fontWeight: 700, letterSpacing: '0.09em',
              padding: '4px 9px', borderRadius: 3, cursor: 'pointer',
              flexShrink: 0, fontFamily: 'system-ui',
              background: isActive ? 'rgba(120,80,200,0.22)' : 'rgba(20,14,36,0.9)',
              color: isActive ? 'rgba(200,160,255,0.95)' : 'rgba(140,100,180,0.5)',
              border: `1px solid ${isActive ? 'rgba(130,80,210,0.5)' : 'rgba(100,70,150,0.18)'}`,
              boxShadow: isActive ? '0 0 8px rgba(120,80,200,0.25)' : 'none',
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = 'rgba(180,140,230,0.8)'; e.currentTarget.style.borderColor = 'rgba(120,80,180,0.35)'; }}}
            onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = 'rgba(140,100,180,0.5)'; e.currentTarget.style.borderColor = 'rgba(100,70,150,0.18)'; }}}
            >{p.name}</button>
          );
        })}
      </div>

      {/* Visual */}
      <div style={{ borderBottom: '1px solid rgba(120,80,180,0.1)', flex: 1, minHeight: 0 }}>
        <MorphCanvas
          morph={morph} size={size} decay={decay} tone={tone}
          density={density} warp={warp} peakLevel={peakLevel} bypassed={bypassed}
        />
      </div>

      {/* I/O Sliders */}
      <div style={{
        padding: '6px 12px', display: 'flex', gap: 12,
        borderBottom: '1px solid rgba(120,80,180,0.08)', flexShrink: 0,
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

      {/* Knob Row 1: MORPH, SIZE, DECAY */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(120,80,180,0.06)', flexShrink: 0,
      }}>
        <Knob label="MORPH" value={morph} defaultValue={0.5} size={28}
          format={v => v < 0.12 ? 'A' : v > 0.88 ? 'B' : pctFmt(v)}
          onChange={v => { setMorph(v); engineRef.current?.setMorph(v); setActivePreset(null); }} />
        <Knob label="SIZE" value={size} defaultValue={0.55} size={28} format={pctFmt}
          onChange={v => { setSize(v); engineRef.current?.setSize(v); setActivePreset(null); }} />
        <Knob label="DECAY" value={decay} defaultValue={0.5} size={28} format={pctFmt}
          onChange={v => { setDecay(v); engineRef.current?.setDecay(v); setActivePreset(null); }} />
      </div>

      {/* Knob Row 2: TONE, DENSITY, WARP, MIX */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(120,80,180,0.06)', flexShrink: 0,
      }}>
        <Knob label="TONE" value={tone} defaultValue={0.55} size={28}
          format={v => v < 0.25 ? 'DARK' : v > 0.75 ? 'BRIGHT' : pctFmt(v)}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="DENSITY" value={density} defaultValue={0.6} size={28} format={pctFmt}
          onChange={v => { setDensity(v); engineRef.current?.setDensity(v); setActivePreset(null); }} />
        <Knob label="WARP" value={warp} defaultValue={0.3} size={28} format={pctFmt}
          onChange={v => { setWarp(v); engineRef.current?.setWarp(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.6} size={28} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer: BYPASS + SMOOTH */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0,
      }}>
        <BypassToggle active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => {
              const n = smooth >= 5 ? 0 : smooth + 1;
              setSmooth(n); engineRef.current?.setSmooth(n);
            }}
            style={{
              height: 26, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', padding: '0 11px', borderRadius: 4, cursor: 'pointer',
              background: smooth > 0 ? 'rgba(120,80,200,0.14)' : 'rgba(10,8,18,0.9)',
              color: smooth > 0 ? 'rgba(190,150,240,0.95)' : 'rgba(120,90,160,0.4)',
              border: `1.5px solid ${smooth > 0 ? 'rgba(120,80,200,0.45)' : 'rgba(90,60,130,0.22)'}`,
              boxShadow: smooth > 0 ? '0 0 10px rgba(120,80,200,0.25), inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 3px 7px rgba(0,0,0,0.7)',
              fontFamily: 'system-ui',
            }}
          >{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
          <span style={{
            fontSize: 7, letterSpacing: '0.18em', fontFamily: 'system-ui', fontWeight: 700,
            color: smooth > 0 ? 'rgba(190,150,240,0.6)' : 'rgba(120,90,160,0.35)',
          }}>{smooth > 0 ? `${smooth}X ON` : 'OFF'}</span>
        </div>
      </div>
    </div>
  );
}
