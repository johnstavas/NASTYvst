import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createModulationEngine } from './modulationEngine';
import ClipMeter from './ClipMeter';

const SliderRow = ({ label, value, set, min = 0, max = 1, step = 0.01, fmt, ac, labelWidth = 42 }) => (
  <div className="flex items-center gap-2">
    <span style={{ color: ac(50, 62, 0.6), fontSize: 7.5, width: labelWidth, flexShrink: 0 }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => set(parseFloat(e.target.value))}
      className="flex-1 h-1 rounded-full appearance-none cursor-pointer outline-none"
      style={{ accentColor: ac(70, 65, 1) }} />
    <span style={{ color: ac(50, 65, 0.8), fontSize: 7, width: 30, textAlign: 'right' }}>
      {fmt ? fmt(value) : Math.round(value * 100) + '%'}
    </span>
  </div>
);

const size   = 380;
const center = size / 2;
const radius = 148;

// 8 waveform zones by angle (0=top, clockwise)
const ZONE_ANGLES = [270, 315, 0, 45, 90, 135, 180, 225];
const ZONE_LABELS = ['Sine', 'Tri', 'Saw↑', 'Saw↓', 'Sqr', 'Pulse', 'S&H', '~Rnd'];
const HUES = [272, 280, 260, 285, 265, 290, 255, 275];

const MODES = [['tremolo', 'A', 'Tremolo'], ['filter', 'B', 'Filter'], ['vibrato', 'C', 'Vibrato']];

const DIVISIONS = [
  { label: '1/32', beats: 0.125 },
  { label: '1/16', beats: 0.25  },
  { label: '1/8',  beats: 0.5   },
  { label: '1/4',  beats: 1     },
  { label: '1/2',  beats: 2     },
  { label: '1bar', beats: 4     },
  { label: '2bar', beats: 8     },
  { label: '4bar', beats: 16    },
];

// Waveform display functions (per-zone)
const WAVEFORM_FNS = [
  t => Math.sin(2 * Math.PI * t),
  t => 1 - 4 * Math.abs(((t % 1) + 1) % 1 - 0.5),
  t => (((t % 1) + 1) % 1) * 2 - 1,
  t => 1 - (((t % 1) + 1) % 1) * 2,
  t => (((t % 1) + 1) % 1) < 0.5 ? 1 : -1,
  t => (((t % 1) + 1) % 1) < 0.25 ? 1 : -1,
  t => Math.sign(Math.sin(2 * Math.PI * t * 4.1 + 0.3)) * 0.8,
  t => 0.6 * Math.sin(2.1 * Math.PI * t) + 0.25 * Math.sin(5.7 * Math.PI * t) + 0.15 * Math.sin(12.3 * Math.PI * t),
];

function buildWavePath(weights, phase, cx, cy, r, depth) {
  const N = 80;
  let d = '';
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * 2 + phase;
    let v = 0;
    weights.forEach((w, zi) => { v += w * WAVEFORM_FNS[zi](t); });
    const x = cx - r * 0.8 + (i / (N - 1)) * r * 1.6;
    const y = cy + v * r * 0.28 * depth;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return d.trim();
}

// 8-zone cosine blend by angle
function calcZoneWeightsLocal(angleDeg) {
  const w = ZONE_ANGLES.map(a => {
    let d = Math.abs(angleDeg - a) % 360;
    if (d > 180) d = 360 - d;
    return Math.max(0, Math.cos((Math.min(d, 45) / 45) * (Math.PI / 2)));
  });
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map(v => v / sum) : w;
}

export default function ModulationOrb({ instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState }) {
  const [point,       setPoint      ] = useState(() => initialState ? { x: initialState.orbX ?? center, y: initialState.orbY ?? center } : { x: center, y: center });
  // Depth + Mix start at 0 so the module is completely transparent when first
  // added. User dials these up to engage the modulation effect.
  const [depth,       setDepth      ] = useState(initialState?.depth     ?? 0);
  const [mix,         setMix        ] = useState(initialState?.mix       ?? 0);
  const [divisionIdx, setDivisionIdx] = useState(initialState?.divisionIdx ?? 3);
  const [bpm,         setBpm        ] = useState(initialState?.bpm       ?? 120);
  const [bypassed,    setBypassed   ] = useState(initialState?.bypassed  ?? false);
  const [activeEffects, setActiveEffects] = useState(initialState?.activeEffects ?? { tremolo: true, filter: false, vibrato: false });
  const [inputGain,    setInputGain    ] = useState(initialState?.inputGain     ?? 1);
  const [outputGain,   setOutputGain   ] = useState(initialState?.outputGain    ?? 1);
  const [pan,          setPan          ] = useState(initialState?.pan           ?? 0);
  const [pingPong,     setPingPong     ] = useState(initialState?.pingPong      ?? 0);
  const [showPanel,   setShowPanel  ] = useState(false);
  const [dragging,    setDragging   ] = useState(false);

  const [lfoPhase,  setLfoPhase ] = useState(0);
  const [reactive,  setReactive ] = useState({ rms: 0, peak: 0, transient: 0 });
  const [inLevel,   setInLevel  ] = useState(0);
  const [outLevel,  setOutLevel ] = useState(0);
  const [inPeak,    setInPeak   ] = useState(0);
  const [outPeak,   setOutPeak  ] = useState(0);
  const [weights,   setWeights  ] = useState(() => new Array(8).fill(0).map((_, i) => i === 0 ? 1 : 0));

  const engineRef = useRef(null);
  const animRef   = useRef(null);
  const wrapRef   = useRef(null);
  const pointRef  = useRef(point);
  pointRef.current = point;

  // Per-module preset system
  const PRESET_KEY = 'nasty-orbs-modulation-presets';
  const [userPresets,    setUserPresets   ] = useState(() => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch { return {}; } });
  const [selectedPreset, setSelectedPreset] = useState('');

  const getSnapshot = () => ({
    orbX: point.x, orbY: point.y, depth, mix, divisionIdx, bpm, bypassed, activeEffects, inputGain, outputGain, pan, pingPong,
  });
  const applySnapshot = s => {
    if (s.orbX     !== undefined) setPoint({ x: s.orbX, y: s.orbY });
    if (s.depth    !== undefined) setDepth(s.depth);
    if (s.mix      !== undefined) setMix(s.mix);
    if (s.divisionIdx !== undefined) setDivisionIdx(s.divisionIdx);
    if (s.bpm      !== undefined) setBpm(s.bpm);
    if (s.bypassed     !== undefined) setBypassed(s.bypassed);
    if (s.activeEffects !== undefined) setActiveEffects(s.activeEffects);
    if (s.inputGain    !== undefined) setInputGain(s.inputGain);
    if (s.outputGain   !== undefined) setOutputGain(s.outputGain);
    if (s.pan          !== undefined) setPan(s.pan);
    if (s.pingPong     !== undefined) setPingPong(s.pingPong);
  };
  const savePreset = () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const next = { ...userPresets, [name]: getSnapshot() };
    setUserPresets(next);
    setSelectedPreset(name);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
  };
  const deletePreset = name => {
    if (!name) return;
    const next = { ...userPresets };
    delete next[name];
    setUserPresets(next);
    setSelectedPreset('');
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
  };

  // Init engine
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createModulationEngine(sharedSource.ctx);
    engineRef.current = engine;
    registerEngine(instanceId, engine);

    const tick = () => {
      animRef.current = requestAnimationFrame(tick);
      if (!engineRef.current) return;
      setLfoPhase(engineRef.current.getLfoPhase());
      setReactive(engineRef.current.getReactiveData());
      setInLevel(engineRef.current.getInputLevel());
      setOutLevel(engineRef.current.getOutputLevel());
      setInPeak(engineRef.current.getInputPeak());
      setOutPeak(engineRef.current.getOutputPeak());
      const p = pointRef.current;
      const dx = p.x - center, dy = p.y - center;
      const ang = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360 + 90) % 360;
      setWeights(calcZoneWeightsLocal(ang));
    };
    tick();

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]);

  // Derived orb position
  const dx       = point.x - center;
  const dy       = point.y - center;
  const dist     = Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius);
  const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360 + 90) % 360;

  // Blended hue from zone weights
  const blendedHue = useMemo(() => {
    let wx = 0, wy = 0;
    HUES.forEach((h, i) => {
      wx += Math.cos(h * Math.PI / 180) * weights[i];
      wy += Math.sin(h * Math.PI / 180) * weights[i];
    });
    const h = ((Math.atan2(wy, wx) * 180 / Math.PI) + 360) % 360;
    return isNaN(h) ? 272 : h;
  }, [weights]);

  const ac = useCallback((s, l, a) => `hsla(${blendedHue}, ${s}%, ${l}%, ${a})`, [blendedHue]);

  const rLow       = Math.min(1, reactive.rms * 8);
  const rTransient = Math.min(1, reactive.transient * 12);

  // Sync to engine
  useEffect(() => { engineRef.current?.setPosition(angleDeg, dist); }, [angleDeg, dist]);
  useEffect(() => { engineRef.current?.setDepth(depth); }, [depth]);
  useEffect(() => { engineRef.current?.setMix(mix); }, [mix]);
  useEffect(() => { engineRef.current?.setRate(bpm, DIVISIONS[divisionIdx].beats); }, [bpm, divisionIdx]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); }, [bypassed]);
  useEffect(() => { engineRef.current?.setInputGain(inputGain); }, [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGain); }, [outputGain]);
  useEffect(() => { engineRef.current?.setPan(pan); }, [pan]);
  useEffect(() => { engineRef.current?.setPingPong(pingPong); }, [pingPong]);
  useEffect(() => {
    engineRef.current?.setEffectActive('tremolo', activeEffects.tremolo);
    engineRef.current?.setEffectActive('filter',  activeEffects.filter);
    engineRef.current?.setEffectActive('vibrato', activeEffects.vibrato);
  }, [activeEffects]);

  useEffect(() => {
    onStateChange?.(instanceId, getSnapshot());
  }, [point.x, point.y, depth, mix, divisionIdx, bpm, bypassed, activeEffects, inputGain, outputGain, pan, pingPong]);

  // Drag handling
  const updateFromPointer = useCallback((clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = clientX - rect.left;
    const ry = clientY - rect.top;
    const ddx = rx - center, ddy = ry - center;
    const d2  = Math.sqrt(ddx * ddx + ddy * ddy);
    const ang = Math.atan2(ddy, ddx);
    const clamped = Math.min(d2, radius);
    setPoint({ x: center + Math.cos(ang) * clamped, y: center + Math.sin(ang) * clamped });
  }, []);

  const handlePointerDown = useCallback(e => {
    e.preventDefault();
    wrapRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromPointer(e.clientX, e.clientY);
  }, [updateFromPointer]);

  const handlePointerMove = useCallback(e => {
    if (!dragging) return;
    updateFromPointer(e.clientX, e.clientY);
  }, [dragging, updateFromPointer]);

  const handlePointerUp = useCallback(e => {
    wrapRef.current?.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  const wavePath = useMemo(() => buildWavePath(weights, lfoPhase, center, center, radius, depth), [weights, lfoPhase, depth]);

  const orbR = 14 + rLow * 6 + dist * 8;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MeterBar = ({ level, peak, label }) => (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>{label}</span>
      <div style={{ width: 5, height: 28, background: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${clamp(level * 400, 0, 100)}%`, background: ac(65, 58, 0.85), borderRadius: 3, transition: 'height 0.04s' }} />
        <div style={{ position: 'absolute', bottom: `${clamp(peak * 400, 0, 100)}%`, width: '100%', height: 1, background: ac(60, 80, 0.9) }} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden"
      style={{
        width: size, height: 500, overflow: 'hidden',
        background: `linear-gradient(160deg, ${ac(20, 8, 0.65)}, ${ac(15, 5, 0.85)})`,
        border: `1px solid ${ac(40, 40, 0.2)}`,
      }}>

      {/* ===== HEADER ===== */}
      <div className="grid items-center px-3 py-2 shrink-0"
        style={{ gridTemplateColumns: '1fr auto 1fr', borderBottom: `1px solid ${ac(30, 30, 0.12)}` }}>
        {/* Left */}
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: ac(50, 60, 0.5) }}>Mod</span>

        {/* Center — A/B/C buttons always stay centred */}
        <div className="flex items-center gap-1">
          {MODES.map(([mode, letter, label]) => {
            const on = activeEffects[mode];
            return (
              <button key={mode}
                onClick={() => setActiveEffects(prev => ({ ...prev, [mode]: !prev[mode] }))}
                className="text-[8px] font-semibold rounded border"
                style={{
                  width: 22, height: 18,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  ...(on
                    ? { background: ac(45, 35, 0.4), borderColor: ac(55, 55, 0.5), color: ac(65, 82, 1) }
                    : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.2)' })
                }}
                title={`${on ? 'Disable' : 'Enable'} ${label}`}>
                {letter}
              </button>
            );
          })}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => setBypassed(b => !b)}
            className="text-[8px] font-medium px-1.5 py-0.5 rounded border transition-colors"
            style={bypassed
              ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
              : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' }}>
            {bypassed ? 'BYP' : 'ON'}
          </button>
          {onRemove && (
            <button onClick={onRemove} className="w-5 h-5 rounded-full text-[11px] flex items-center justify-center transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)' }}>×</button>
          )}
        </div>
      </div>

      {/* ===== ORB PAD ===== */}
      <div ref={wrapRef} className="relative select-none"
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Background */}
        <div className="absolute inset-0" style={{
          background: `radial-gradient(circle at ${point.x}px ${point.y}px, ${ac(30, 10, 1)}, ${ac(15, 5, 1)} 65%)`,
        }} />

        {/* Distance rings */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'hidden', pointerEvents: 'none' }}>
          {[0.33, 0.66, 1.0].map((f, i) => (
            <circle key={i} cx={center} cy={center} r={radius * f} fill="none"
              stroke={ac(50, 40, 0.08 + dist * 0.1)} strokeWidth={0.5} strokeDasharray={i < 2 ? '3 5' : undefined} />
          ))}
        </svg>

        {/* Zone tick marks + labels around outer ring */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          {ZONE_ANGLES.map((angleDegZ, i) => {
            const w = weights[i];
            // SVG angle: our 0=top convention → SVG 0=right: subtract 90
            const rad = (angleDegZ - 90) * Math.PI / 180;
            const tickInner = radius - 6;
            const tickOuter = radius + 4;
            const labelR    = radius + 18;
            const lx = center + Math.cos(rad) * labelR;
            const ly = center + Math.sin(rad) * labelR;
            const tx1 = center + Math.cos(rad) * tickInner;
            const ty1 = center + Math.sin(rad) * tickInner;
            const tx2 = center + Math.cos(rad) * tickOuter;
            const ty2 = center + Math.sin(rad) * tickOuter;
            return (
              <g key={i}>
                <line x1={tx1} y1={ty1} x2={tx2} y2={ty2}
                  stroke={`hsla(${HUES[i]}, 60%, 65%, ${0.15 + w * 0.7})`}
                  strokeWidth={1 + w * 1.5} />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  style={{
                    fontSize: 7.5,
                    fill: `hsla(${HUES[i]}, 55%, 72%, ${0.2 + w * 0.75})`,
                    fontFamily: 'monospace',
                    fontWeight: w > 0.4 ? 'bold' : 'normal',
                  }}>
                  {ZONE_LABELS[i]}
                </text>
              </g>
            );
          })}
          {/* Bright dot at current angle on outer ring */}
          {(() => {
            const svgRad = (angleDeg - 90) * Math.PI / 180;
            const dotX = center + Math.cos(svgRad) * radius;
            const dotY = center + Math.sin(svgRad) * radius;
            return <circle cx={dotX} cy={dotY} r={3.5}
              fill={ac(70, 88, 0.95)}
              style={{ filter: `drop-shadow(0 0 4px ${ac(75, 70, 0.8)})` }} />;
          })()}
        </svg>

        {/* LFO aura glow */}
        <div className="absolute pointer-events-none" style={{
          left: point.x - radius * 0.5, top: point.y - radius * 0.5,
          width: radius, height: radius,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${ac(70, 55, 0.18 + dist * 0.18 + rLow * 0.12)}, transparent 70%)`,
          filter: `blur(${18 + dist * 14}px)`,
          transform: `scale(${1 + Math.sin(lfoPhase * Math.PI * 2) * 0.06 * depth})`,
          transition: 'transform 0.05s',
        }} />

        {/* Waveform path */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'hidden', pointerEvents: 'none' }}>
          <path d={wavePath} fill="none"
            stroke={ac(65, 68, 0.45 + dist * 0.3)}
            strokeWidth={1.5}
            style={{ filter: `blur(0.5px) drop-shadow(0 0 4px ${ac(70, 65, 0.4)})` }} />
        </svg>

        {/* LFO phase dot */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'hidden', pointerEvents: 'none' }}>
          {(() => {
            const phaseAngle = lfoPhase * Math.PI * 2 - Math.PI / 2;
            const pr = 12;
            const px = point.x + Math.cos(phaseAngle) * pr;
            const py = point.y + Math.sin(phaseAngle) * pr;
            return <circle cx={px} cy={py} r={2.5} fill={ac(70, 75, 0.8 + rTransient * 0.2)}
              style={{ filter: `blur(0.5px) drop-shadow(0 0 5px ${ac(75, 70, 0.7)})` }} />;
          })()}
        </svg>

        {/* Orb dot */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <radialGradient id={`mg-${instanceId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={`hsla(${blendedHue}, 80%, 92%, 0.95)`} />
              <stop offset="50%"  stopColor={`hsla(${blendedHue}, 70%, 65%, 0.55)`} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <circle cx={point.x} cy={point.y} r={orbR * 2.5}
            fill={`url(#mg-${instanceId})`}
            style={{ filter: `blur(${10 + dist * 14}px)`, opacity: 0.4 + dist * 0.35 }} />
          <circle cx={point.x} cy={point.y} r={orbR}
            fill={ac(55, 55, 0.35)} stroke={ac(65, 78, 0.72 + dist * 0.25)}
            strokeWidth={1.5 + dist * 1.5}
            style={{ filter: `blur(0.5px) drop-shadow(0 0 ${8 + dist * 18}px ${ac(70, 68, 0.65)})` }} />
        </svg>

        {/* Dist % near orb */}
        {dist > 0.02 && (
          <div className="absolute pointer-events-none text-[7.5px]" style={{
            left: point.x, top: point.y - orbR - 12,
            transform: 'translateX(-50%)', color: ac(55, 65, 0.6),
          }}>{Math.round(dist * 100)}%</div>
        )}
      </div>

      {/* Clip-visibility meter — big dB numbers so clipping is unmissable */}
      <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />

      {/* ===== BOTTOM BAR ===== */}
      <div className="flex items-center gap-2.5 px-3 py-2 shrink-0"
        style={{ borderTop: `1px solid ${ac(30, 30, 0.15)}` }}>

        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[7.5px] shrink-0" style={{ color: ac(45, 55, 0.5) }}>Mix</span>
          <input type="range" min="0" max="1" step="0.01" value={mix}
            onChange={e => setMix(parseFloat(e.target.value))}
            style={{ accentColor: ac(70, 60, 1), height: '3px', flex: 1 }} />
          <span className="text-[7.5px]" style={{ color: ac(50, 62, 0.65), width: 28, textAlign: 'right' }}>{Math.round(mix * 100)}%</span>
        </div>

        <button onClick={() => setShowPanel(p => !p)}
          className="rounded px-2 py-1 text-[7.5px] border transition-colors"
          style={showPanel
            ? { background: ac(50, 50, 0.2), borderColor: ac(50, 55, 0.4), color: ac(60, 70, 1) }
            : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}>⚙</button>
      </div>

      {/* ===== SETTINGS PANEL ===== */}
      {showPanel && (
        <div className="px-3 py-2.5">
          <div className="rounded-xl p-3 flex flex-col gap-2"
            style={{ background: 'rgba(120,80,255,0.06)', border: '1px solid rgba(150,100,255,0.12)', backdropFilter: 'blur(12px)' }}>

            <div className="flex items-center gap-2">
              <select value={selectedPreset}
                onChange={e => { setSelectedPreset(e.target.value); if (e.target.value) applySnapshot(userPresets[e.target.value] || {}); }}
                className="flex-1 text-[7.5px] rounded px-2 py-1 outline-none cursor-pointer"
                style={{ WebkitAppearance: 'none', background: 'rgba(0,0,0,0.4)', border: `1px solid ${ac(40, 30, 0.25)}`, color: 'rgba(255,255,255,0.6)' }}>
                <option value="" style={{ background: '#050a06' }}>— Load preset —</option>
                {Object.keys(userPresets).sort().map(name => (
                  <option key={name} value={name} style={{ background: '#050a06' }}>{name}</option>
                ))}
              </select>
              <button onClick={savePreset}
                className="text-[7.5px] font-medium px-2 py-1 rounded whitespace-nowrap"
                style={{ background: ac(30, 12, 0.5), border: `1px solid ${ac(50, 40, 0.3)}`, color: ac(60, 75, 0.9) }}>Save</button>
              <button onClick={() => deletePreset(selectedPreset)} disabled={!selectedPreset}
                className="text-[7.5px] font-medium px-2 py-1 rounded whitespace-nowrap disabled:opacity-30"
                style={{ background: ac(30, 12, 0.5), border: `1px solid ${ac(50, 40, 0.3)}`, color: ac(60, 75, 0.9) }}>Delete</button>
            </div>

            <SliderRow label="In Gain"   value={inputGain}  set={setInputGain}  min={0} max={2} ac={ac}
              fmt={v => `${Math.round(v * 100)}%`} />
            <SliderRow label="Out Gain"  value={outputGain} set={setOutputGain} min={0} max={2} ac={ac}
              fmt={v => `${Math.round(v * 100)}%`} />
            <SliderRow label="Depth"     value={depth}    set={setDepth}    ac={ac} />
            <SliderRow label="Pan"       value={pan}      set={setPan}      min={-1} max={1} ac={ac}
              fmt={v => v === 0 ? 'C' : (v > 0 ? `R${Math.round(v*100)}` : `L${Math.round(-v*100)}`)} />
            <SliderRow label="Ping-Pong" value={pingPong} set={setPingPong} ac={ac}
              fmt={v => Math.round(v * 100) + '%'} />
            <SliderRow label="BPM"   value={bpm}   set={setBpm}   min={40} max={240} step={1}
              fmt={v => `${Math.round(v)}`} ac={ac} labelWidth={42} />

            <div className="flex flex-col gap-1">
              <span style={{ color: ac(50, 62, 0.5), fontSize: 7.5 }}>Division</span>
              <div className="flex flex-wrap gap-1">
                {DIVISIONS.map((div, i) => (
                  <button key={i} onClick={() => setDivisionIdx(i)}
                    className="px-2 py-0.5 rounded text-[8px] border transition-colors"
                    style={divisionIdx === i
                      ? { background: ac(50, 40, 0.35), borderColor: ac(60, 55, 0.5), color: ac(65, 80, 1) }
                      : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
                    {div.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
