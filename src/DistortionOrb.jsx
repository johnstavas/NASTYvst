import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createDistortionEngine } from './distortionEngine';
import ClipMeter from './ClipMeter';

const SliderRow = ({ label, value, set, min = 0, max = 1, step = 0.01, fmt, ac, labelWidth = 38 }) => (
  <div className="flex items-center gap-2">
    <span className="shrink-0" style={{ fontSize: 7.5, color: ac(45, 55, 0.55), width: labelWidth }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => set(parseFloat(e.target.value))}
      style={{ accentColor: ac(70, 60, 1), height: '3px', flex: 1 }} />
    <span className="text-right" style={{ fontSize: 7, color: ac(50, 60, 0.65), width: 28 }}>
      {fmt ? fmt(value) : `${Math.round(value * 100)}%`}
    </span>
  </div>
);

const size        = 380;
const center      = size / 2;
const innerRadius = 45;
const outerRadius = 145;
const CLEAN_ZONE  = innerRadius / outerRadius;

const ZONE_NAMES  = ['Tape', 'Tube', 'Diode', 'Fold', 'Fuzz', 'Crush', 'Drive', 'Vinyl'];
const ZONE_ANGLES = [270,   315,    0,      45,    90,    135,    180,    225   ]; // screen degrees
const ZONE_HUES   = [  5,    18,    0,     160,   345,    200,      8,     12   ]; // hue per zone — red/crimson palette

export default function DistortionOrb({ instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState }) {
  // Orb position
  const [point, setPoint]       = useState(() => initialState ? { x: initialState.orbX ?? center, y: initialState.orbY ?? center } : { x: center, y: center });
  const [orbAngle, setOrbAngle] = useState(() => {
    if (!initialState) return Math.PI * 1.5;
    const dx = (initialState.orbX ?? center) - center, dy = (initialState.orbY ?? center) - center;
    return Math.atan2(dy, dx);
  });
  const lastRef = useRef({ x: center, y: center, t: 0 });
  const wrapRef = useRef(null);

  // Controls
  // Mix starts at 0 → module is fully transparent when first added.
  // User must dial Mix up to hear the distortion zones.
  const [mix,          setMix         ] = useState(initialState?.mix ?? 0);
  const [tone,         setToneVal      ] = useState(initialState?.tone ?? 0.7);
  const [inputGain,    setInputGainVal ] = useState(initialState?.inputGain ?? 1.0);
  const [outputGainVal,setOutputGainVal] = useState(initialState?.outputGain ?? 1.0);
  const [pan,          setPanVal       ] = useState(initialState?.pan ?? 0);
  const [bypassed,     setBypassed     ] = useState(initialState?.bypassed ?? false);
  const [showPanel,    setShowPanel    ] = useState(false);
  const [dragging,     setDragging     ] = useState(false);

  const [eqBands, setEqBands] = useState(() => initialState?.eqBands ? [...initialState.eqBands] : new Array(10).fill(0));
  const [eqBypassed, setEqBypassed] = useState(initialState?.eqBypassed ?? true);
  const [eqPreset, setEqPreset] = useState(initialState?.eqPreset ?? 'Flat');

  const EQ_PRESETS = {
    'Flat':           [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Bass Boost':     [8, 6, 4, 1, 0, 0, 0, 0, 0, 0],
    'Treble Boost':   [0, 0, 0, 0, 0, 0, 2, 5, 7, 8],
    'Scoop':          [4, 3, 0, -4, -5, -4, 0, 3, 5, 4],
    'Vocal Presence': [0, 0, -1, -2, 0, 3, 5, 4, 2, 0],
    'Loudness':       [6, 4, 0, -2, -1, 0, -1, 0, 4, 6],
    'De-Mud':         [0, 0, -2, -5, -3, 0, 1, 2, 1, 0],
    'Bright & Airy':  [-2, -1, 0, 0, 0, 1, 3, 5, 7, 8],
    'Dark & Warm':    [4, 5, 3, 1, 0, -1, -2, -4, -5, -6],
    'Sub Bass':       [10, 7, 3, 0, -1, -1, 0, 0, 0, 0],
    'Custom':         null,
  };
  const applyEqPreset = name => {
    setEqPreset(name);
    if (EQ_PRESETS[name]) { setEqBands([...EQ_PRESETS[name]]); if (name !== 'Flat') setEqBypassed(false); }
  };

  // Per-module preset system — distortion presets are isolated from other module types
  const PRESET_KEY = 'nasty-orbs-distortion-presets';
  const [userPresets, setUserPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch { return {}; }
  });
  const [selectedPreset, setSelectedPreset] = useState('');

  const getSnapshot = () => ({
    mix, tone, inputGain, outputGain: outputGainVal, pan, bypassed,
    orbX: point.x, orbY: point.y, eqBands: [...eqBands], eqBypassed,
  });
  const applySnapshot = s => {
    if (s.mix !== undefined) setMix(s.mix);
    if (s.tone !== undefined) setToneVal(s.tone);
    if (s.inputGain !== undefined) setInputGainVal(s.inputGain);
    if (s.outputGain !== undefined) setOutputGainVal(s.outputGain);
    if (s.pan !== undefined) setPanVal(s.pan);
    if (s.bypassed !== undefined) setBypassed(s.bypassed);
    if (s.orbX !== undefined) setPoint({ x: s.orbX, y: s.orbY });
    if (Array.isArray(s.eqBands)) setEqBands([...s.eqBands]);
    if (s.eqBypassed !== undefined) setEqBypassed(s.eqBypassed);
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

  // Audio reactive
  const [wobbleTime, setWobbleTime] = useState(0);
  const wobbleTimeRef = useRef(0);
  const [reactive,   setReactive  ] = useState({ rms: 0, peak: 0, transient: 0 });
  const [inLevel,    setInLevel   ] = useState(0);
  const [outLevel,   setOutLevel  ] = useState(0);
  const [inPeak,     setInPeak    ] = useState(0);
  const [outPeak,    setOutPeak   ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  // Init engine
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createDistortionEngine(sharedSource.ctx);
    engineRef.current = engine;
    registerEngine(instanceId, engine);

    const tick = () => {
      animRef.current = requestAnimationFrame(tick);
      if (!engineRef.current) return;
      wobbleTimeRef.current += 0.016;
      setWobbleTime(wobbleTimeRef.current);
      setReactive(engine.getReactiveData());
      setInLevel(engine.getInputLevel());
      setOutLevel(engine.getOutputLevel());
      setInPeak(engine.getInputPeak());
      setOutPeak(engine.getOutputPeak());
    };
    tick();

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]);

  // Derived position values
  const dx           = point.x - center;
  const dy           = point.y - center;
  const distFromCenter = Math.min(1, Math.sqrt(dx * dx + dy * dy) / outerRadius);
  const angleDeg     = ((orbAngle * 180 / Math.PI) + 360) % 360;
  const drive        = Math.max(0, (distFromCenter - CLEAN_ZONE) / (1 - CLEAN_ZONE)); // 0 in clean zone
  const inCleanZone  = distFromCenter < CLEAN_ZONE;

  // Zone weights (normalized, sum=1 when outside clean zone)
  const zoneWeights = useMemo(() => {
    if (inCleanZone) return ZONE_ANGLES.map(() => 0);
    const w = ZONE_ANGLES.map(a => {
      let diff = Math.abs(angleDeg - a) % 360;
      if (diff > 180) diff = 360 - diff;
      return Math.max(0, Math.cos((Math.min(diff, 45) / 45) * (Math.PI / 2)));
    });
    const sum = w.reduce((a, b) => a + b, 0);
    return sum > 0 ? w.map(v => v / sum) : w;
  }, [angleDeg, inCleanZone]);

  // Active zone (highest weight)
  const activeZoneIdx = zoneWeights.indexOf(Math.max(...zoneWeights));
  const activeZoneName = inCleanZone ? 'Clean' : ZONE_NAMES[activeZoneIdx];

  // Blended hue from active zones (circular average)
  const blendedHue = useMemo(() => {
    if (inCleanZone) return 25;
    let wx = 0, wy = 0;
    ZONE_HUES.forEach((h, i) => {
      wx += Math.cos(h * Math.PI / 180) * zoneWeights[i];
      wy += Math.sin(h * Math.PI / 180) * zoneWeights[i];
    });
    return ((Math.atan2(wy, wx) * 180 / Math.PI) + 360) % 360;
  }, [zoneWeights, inCleanZone]);

  const hue    = inCleanZone ? 5 : blendedHue;
  const accent = (s, l, a) => `hsla(${hue}, ${s}%, ${l}%, ${a})`;

  // Audio reactive values
  const rLow       = Math.min(1, reactive.rms * 8);
  const rMid       = Math.min(1, reactive.rms * 5);
  const rTransient = Math.min(1, reactive.transient * 12);

  // Orb visual
  const coreScale  = 1 + rLow * 0.1 + drive * 0.06 + rTransient * 0.05;
  const fracture   = drive * drive;                // quadratic — more jagged as drive increases
  const orbRadius  = 24;
  const modWobble  = drive * 6 + (rMid * 2 + rLow * 1.5) * (0.2 + drive * 0.8);
  const totalWobble = Math.min(14, modWobble);

  const orbPath = useMemo(() => {
    const t = wobbleTime;
    const points = 64;
    const p1 = Math.sin(t * 0.13) * 4.5 + Math.cos(t * 0.07) * 3.2;
    const p2 = Math.cos(t * 0.11) * 5.1 + Math.sin(t * 0.19) * 2.8;
    const p3 = Math.sin(t * 0.17) * 3.8 + Math.cos(t * 0.23) * 4.1;
    const p4 = Math.cos(t * 0.09) * 4.7 + Math.sin(t * 0.29) * 3.5;
    const w2 = 0.3 + 0.3 * Math.sin(t * 0.31 + 1.0);
    const w3 = 0.3 + 0.3 * Math.sin(t * 0.37 + 2.5);
    const w4 = 0.2 + 0.25 * Math.sin(t * 0.43 + 4.0);
    const w5 = 0.15 + 0.2 * Math.sin(t * 0.29 + 5.5);
    let d = '';
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const smooth = (
        Math.sin(angle * 2 + p1) * w2 +
        Math.sin(angle * 3 + p2) * w3 +
        Math.sin(angle * 4 + p3) * w4 +
        Math.sin(angle * 5 + p4) * w5
      );
      const fractureEdge = fracture * (
        Math.sin(angle * 8  + p1 * 1.5) * 0.35 +
        Math.sin(angle * 13 - p2 * 1.3) * 0.28 +
        Math.sin(angle * 19 + p3 * 0.9) * 0.22
      );
      const r = orbRadius + totalWobble * (smooth + fractureEdge);
      d += (i === 0 ? 'M' : 'L') + `${38 + Math.cos(angle) * r},${38 + Math.sin(angle) * r}`;
    }
    return d + 'Z';
  }, [totalWobble, wobbleTime, fracture]);

  // Sync to engine
  useEffect(() => { engineRef.current?.setPosition(angleDeg, drive); }, [angleDeg, drive]);
  useEffect(() => { engineRef.current?.setMix(mix); }, [mix]);
  useEffect(() => { engineRef.current?.setTone(tone); }, [tone]);
  useEffect(() => { engineRef.current?.setInputGain(inputGain); }, [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGainVal); }, [outputGainVal]);
  useEffect(() => { engineRef.current?.setPan(pan); }, [pan]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); }, [bypassed]);

  useEffect(() => {
    if (!engineRef.current) return;
    eqBands.forEach((gain, i) => engineRef.current.setEqBand(i, eqBypassed ? 0 : gain));
  }, [eqBands, eqBypassed]);

  useEffect(() => {
    onStateChange?.(instanceId, {
      mix, tone, inputGain, outputGain: outputGainVal, pan, bypassed,
      orbX: point.x, orbY: point.y, eqBands: [...eqBands], eqBypassed,
    });
  }, [mix, tone, inputGain, outputGainVal, pan, bypassed, point.x, point.y, eqBands, eqBypassed]);

  // Drag handling
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const updateFromPointer = useCallback((clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = clientX - rect.left;
    const ry = clientY - rect.top;
    const ddx = rx - center, ddy = ry - center;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    const angle = Math.atan2(ddy, ddx);
    const clamped = Math.min(dist, outerRadius);
    setPoint({ x: center + Math.cos(angle) * clamped, y: center + Math.sin(angle) * clamped });
    setOrbAngle(angle);
  }, []);

  const handleMouseDown = e => { e.preventDefault(); setDragging(true); updateFromPointer(e.clientX, e.clientY); };
  const handleMouseMove = e => { if (dragging) updateFromPointer(e.clientX, e.clientY); };
  const handleTouchStart = e => { e.preventDefault(); setDragging(true); updateFromPointer(e.touches[0].clientX, e.touches[0].clientY); };
  const handleTouchMove  = e => { e.preventDefault(); updateFromPointer(e.touches[0].clientX, e.touches[0].clientY); };

  // VU meter bar
  const MeterBar = ({ level, peak, label }) => (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>{label}</span>
      <div style={{ width: 5, height: 28, background: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${clamp(level * 400, 0, 100)}%`, background: accent(65, 58, 0.85), borderRadius: 3, transition: 'height 0.04s' }} />
        <div style={{ position: 'absolute', bottom: `${clamp(peak * 400, 0, 100)}%`, width: '100%', height: 1, background: accent(60, 80, 0.9) }} />
      </div>
    </div>
  );


  return (
    <div className="flex flex-col rounded-2xl overflow-hidden"
      style={{
        width: size, height: 500, overflow: 'hidden',
        background: `linear-gradient(160deg, ${accent(20, 8, 0.65)}, ${accent(15, 5, 0.85)})`,
        border: `1px solid ${accent(40, 40, 0.2)}`,
      }}>

      {/* ===== HEADER BAR ===== */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${accent(30, 30, 0.12)}` }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: accent(50, 60, 0.5) }}>Distortion</span>
        <div className="flex items-center gap-2">
          <span className="text-[8px] uppercase tracking-[0.25em]" style={{ color: accent(50, 60, 0.4) }}>
            {inCleanZone ? 'Clean' : `${activeZoneName}${drive > 0.01 ? ` · ${Math.round(drive * 100)}%` : ''}`}
          </span>
          {onRemove && (
            <button onClick={onRemove} className="w-5 h-5 rounded-full text-[11px] flex items-center justify-center transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)' }}>×</button>
          )}
        </div>
      </div>

      {/* ===== ORB PAD ===== */}
      <div ref={wrapRef} className="relative select-none"
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => setDragging(false)}
      >
        {/* Background — clipped separately so zone labels/arcs can overflow without being cut */}
        <div className="absolute inset-0" style={{
          background: `radial-gradient(circle at ${point.x}px ${point.y}px, ${accent(30, 10, 1)}, ${accent(15, 5, 1)} 65%)`,
          clipPath: 'inset(0 round 0px)',
        }} />

        {/* ── Mod rings ── */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'hidden', pointerEvents: 'none' }}>
          {[...Array(40)].map((_, i) => {
            const baseR = 6 + i * 4.2;
            // Rings come in earlier and outer rings reveal faster
            const revealThreshold = (i / 40) * 0.15; // was *0.4 — now appear much sooner
            const ringReveal = Math.max(0, (drive - revealThreshold) / (1 - revealThreshold + 0.01));
            const modAlpha = 0.05 + drive * 0.18 + ringReveal * 0.3 - i * 0.003;
            if (modAlpha < 0.01) return null;
            const t = wobbleTime;
            const driver = drive + rLow * 0.5;
            const breathe = Math.sin(t * (1.2 + i * 0.15) + i * 0.5) * driver * (4 + i * 0.5);
            const ringR = baseR + breathe + rMid * driver * (1.5 + i * 0.2) + rLow * driver * 1.5;
            if (driver < 0.03) return (
              <circle key={i} cx={center} cy={center} r={ringR} fill="none"
                stroke={`hsla(${hue}, ${15 + driver * 40}%, ${55 - i * 1.2}%, ${modAlpha})`}
                strokeWidth={0.5} />
            );
            // Crazier distortion: more harmonics, larger amplitude, higher-frequency warping
            const d3 = driver * driver * driver;
            const pts = 96; let d = ''; // more points = smoother crazy shapes
            for (let p = 0; p <= pts; p++) {
              const a = (p / pts) * Math.PI * 2;
              const distort = (
                driver  * (3  + i * 0.5)  * Math.sin(a * 2 + t * 0.7) * 0.4 +
                driver  * (4  + i * 0.6)  * Math.sin(a * 3 - t * 1.1) * 0.35 +
                driver  * (5  + i * 0.7)  * Math.sin(a * 5 + t * 0.8) * 0.25 +
                d3      * (8  + i * 1.0)  * Math.sin(a * 7 - t * 1.3) * 0.25 +
                d3      * (10 + i * 1.2)  * Math.sin(a * 11 + t * 0.6) * 0.2 +
                fracture * (12 + i * 1.5) * Math.sin(a * 13 - t * 0.9) * 0.18
              );
              const r = ringR + distort;
              d += (p === 0 ? 'M' : 'L') + `${center + Math.cos(a) * r},${center + Math.sin(a) * r}`;
            }
            return <path key={i} d={d + 'Z'} fill="none"
              stroke={`hsla(${hue}, ${15 + driver * 45}%, ${55 - i * 1.2}%, ${modAlpha})`}
              strokeWidth={0.5} />;
          })}
        </svg>

        {/* ── Zone arcs + labels (single SVG, overflow visible so edges aren't clipped) ── */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          {ZONE_ANGLES.map((angleDegZ, i) => {
            const w   = zoneWeights[i];
            const la  = angleDegZ * Math.PI / 180;
            const lr  = outerRadius + 22;
            // Tick mark: small line segment pointing inward at zone center
            const t1  = outerRadius - 2,  t2 = outerRadius + 6;
            const tx1 = center + Math.cos(la) * t1, ty1 = center + Math.sin(la) * t1;
            const tx2 = center + Math.cos(la) * t2, ty2 = center + Math.sin(la) * t2;
            return (
              <g key={i}>
                <line x1={tx1} y1={ty1} x2={tx2} y2={ty2}
                  stroke={`hsla(${ZONE_HUES[i]}, 70%, 65%, ${0.15 + w * 0.8})`}
                  strokeWidth={1 + w * 2} />
                <text
                  x={center + Math.cos(la) * lr} y={center + Math.sin(la) * lr}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="8" letterSpacing="1.5"
                  fill={`hsla(${ZONE_HUES[i]}, 65%, 68%, ${0.28 + w * 0.72})`}
                  style={{ fontFamily: 'monospace', textTransform: 'uppercase' }}>
                  {ZONE_NAMES[i]}
                </text>
              </g>
            );
          })}
        </svg>

        {/* ── Drive harmonic rings ── */}
        {drive > 0.08 && [1, 2, 3].map(ring => (
          <div key={ring} className="absolute rounded-full pointer-events-none" style={{
            left:   point.x - innerRadius * coreScale * ring * 1.8,
            top:    point.y - innerRadius * coreScale * ring * 1.8,
            width:  innerRadius * coreScale * ring * 3.6,
            height: innerRadius * coreScale * ring * 3.6,
            border: `${0.8 + drive}px solid hsla(${hue}, 70%, 62%, ${drive * 0.18 / ring})`,
            filter: `blur(${ring * 2.5}px)`,
          }} />
        ))}

        {/* ── Orb glow + polygon ── */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <radialGradient id={`dg-${instanceId}`} cx={`${(point.x / size) * 100}%`} cy={`${(point.y / size) * 100}%`} r="20%">
              <stop offset="0%"   stopColor={`hsla(${hue}, 80%, 88%, 0.95)`} />
              <stop offset="45%"  stopColor={`hsla(${hue}, 70%, 62%, 0.5)`} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          {/* Glow halo */}
          <circle cx={point.x} cy={point.y} r={innerRadius * coreScale * 2.2}
            fill={`url(#dg-${instanceId})`}
            style={{ filter: `blur(${10 + drive * 18}px)`, opacity: 0.45 + drive * 0.4 }} />
        </svg>

        {/* Orb polygon (positioned SVG) */}
        <svg className="absolute" style={{
          left: point.x - 38, top: point.y - 38, width: 76, height: 76, overflow: 'visible', pointerEvents: 'none',
        }}>
          <path d={orbPath}
            fill={accent(55, 55, 0.35)} stroke={accent(65, 78, 0.72 + drive * 0.25)}
            strokeWidth={1.5 + drive * 2}
            style={{ filter: `blur(0.5px) drop-shadow(0 0 ${8 + drive * 22}px ${accent(70, 68, 0.65)})` }} />
        </svg>

        {/* Drive % shown near orb */}
        {drive > 0.01 && (
          <div className="absolute pointer-events-none text-[7.5px]" style={{
            left: point.x, top: point.y - innerRadius * coreScale - 14,
            transform: 'translateX(-50%)', color: accent(55, 65, 0.6),
          }}>{Math.round(drive * 100)}%</div>
        )}
      </div>

      {/* Clip-visibility meter — big dB numbers so clipping is unmissable */}
      <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />

      {/* ===== BOTTOM BAR ===== */}
      <div className="flex items-center gap-2.5 px-3 py-2 shrink-0"
        style={{ borderTop: `1px solid ${accent(30, 30, 0.15)}` }}>

        {/* Mix slider */}
        <div className="flex items-center gap-1.5 flex-1">
          <span className="shrink-0" style={{ fontSize: 7.5, color: accent(45, 55, 0.5) }}>Mix</span>
          <input type="range" min="0" max="1" step="0.01" value={mix}
            onChange={e => setMix(parseFloat(e.target.value))}
            style={{ accentColor: accent(70, 60, 1), height: '3px', flex: 1 }} />
          <span style={{ fontSize: 7, color: accent(50, 62, 0.65), width: 28, textAlign: 'right' }}>{Math.round(mix * 100)}%</span>
        </div>

        {/* Settings toggle */}
        <button onClick={() => setShowPanel(p => !p)}
          className="rounded px-2 py-1 border transition-colors"
          style={{ fontSize: 7.5, ...(showPanel
            ? { background: accent(50, 50, 0.2), borderColor: accent(50, 55, 0.4), color: accent(60, 70, 1) }
            : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }) }}>⚙</button>
      </div>

      {/* ===== SETTINGS PANEL ===== */}
      {showPanel && (
        <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-col gap-2 rounded-xl p-3 backdrop-blur-xl"
          style={{ background: `linear-gradient(160deg, ${accent(20, 8, 0.6)}, ${accent(15, 5, 0.8)})`, border: `1px solid ${accent(40, 40, 0.2)}` }}>

          {/* Presets */}
          <div className="flex items-center gap-2">
            <select value={selectedPreset} onChange={e => { setSelectedPreset(e.target.value); if (e.target.value) applySnapshot(userPresets[e.target.value] || {}); }}
              className="flex-1 text-[7.5px] rounded px-2 py-1 outline-none cursor-pointer"
              style={{ WebkitAppearance: 'none', background: 'rgba(0,0,0,0.4)', border: `1px solid ${accent(40, 30, 0.25)}`, color: 'rgba(255,255,255,0.6)' }}>
              <option value="" style={{ background: '#050a06' }}>— Load preset —</option>
              {Object.keys(userPresets).sort().map(name => (
                <option key={name} value={name} style={{ background: '#050a06' }}>{name}</option>
              ))}
            </select>
            <button onClick={savePreset}
              className="text-[7.5px] font-medium px-2 py-1 rounded whitespace-nowrap"
              style={{ background: accent(30, 12, 0.5), border: `1px solid ${accent(50, 40, 0.3)}`, color: accent(60, 75, 0.9) }}>Save</button>
            <button onClick={() => deletePreset(selectedPreset)} disabled={!selectedPreset}
              className="text-[7.5px] font-medium px-2 py-1 rounded whitespace-nowrap disabled:opacity-30"
              style={{ background: accent(30, 12, 0.5), border: `1px solid ${accent(50, 40, 0.3)}`, color: accent(60, 75, 0.9) }}>Delete</button>
          </div>

          <SliderRow label="Tone"   value={tone}          set={setToneVal}       ac={accent} />
          <SliderRow label="Input"  value={inputGain}     set={setInputGainVal}  min={0} max={2} fmt={v => `${Math.round(v * 100)}%`} ac={accent} />
          <SliderRow label="Output" value={outputGainVal} set={setOutputGainVal} min={0} max={2} fmt={v => `${Math.round(v * 100)}%`} ac={accent} />

          <div className="flex items-center gap-2">
            <span className="shrink-0" style={{ fontSize: 7.5, color: accent(45, 55, 0.55), width: 38 }}>Pan</span>
            <input type="range" min="-100" max="100" step="1" value={Math.round(pan * 100)}
              onChange={e => setPanVal(parseInt(e.target.value) / 100)}
              onDoubleClick={() => setPanVal(0)}
              style={{ accentColor: accent(70, 60, 1), height: '3px', flex: 1 }} />
            <span className="text-right" style={{ fontSize: 7, color: accent(50, 62, 0.65), width: 28 }}>
              {Math.abs(pan) < 0.01 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}
            </span>
          </div>

          {/* EQ */}
          <div className="pt-1" style={{ borderTop: `1px solid ${accent(40, 30, 0.15)}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] uppercase tracking-[0.25em]" style={{ color: accent(45, 50, 0.4) }}>EQ</span>
                <button onClick={() => setEqBypassed(b => !b)}
                  className="text-[8px] font-medium px-1.5 py-0.5 rounded border transition-colors"
                  style={eqBypassed
                    ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
                    : { background: accent(30, 10, 0.4), border: `1px solid ${accent(40, 30, 0.25)}`, color: accent(50, 60, 0.7) }}>
                  {eqBypassed ? 'Off' : 'On'}
                </button>
              </div>
              <select value={eqPreset} onChange={e => applyEqPreset(e.target.value)}
                className="flex-1 text-[7.5px] rounded px-1.5 py-0.5 outline-none cursor-pointer"
                style={{ WebkitAppearance: 'none', background: accent(20, 8, 0.6), border: `1px solid ${accent(40, 30, 0.25)}`, color: 'rgba(255,255,255,0.6)' }}>
                {Object.keys(EQ_PRESETS).map(name => (
                  <option key={name} value={name} style={{ background: '#050a06' }}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-[3px] h-20 px-1">
              {['32','64','125','250','500','1K','2K','4K','8K','16K'].map((lbl, i) => (
                <div key={i} className="flex flex-col items-center flex-1 h-full">
                  <div className="flex-1 relative w-full flex items-center justify-center">
                    <div className="absolute h-full w-[3px] rounded-full" style={{ background: accent(40, 25, 0.2) }} />
                    <div className="absolute w-full h-[1px] top-1/2" style={{ background: accent(40, 25, 0.1) }} />
                    <input type="range" min="-12" max="12" step="0.5" value={eqBands[i]}
                      onChange={e => {
                        const next = [...eqBands]; next[i] = parseFloat(e.target.value); setEqBands(next);
                        setEqPreset('Custom'); if (eqBypassed) setEqBypassed(false);
                      }}
                      style={{ position: 'absolute', width: '100%', height: '100%', WebkitAppearance: 'none', appearance: 'none', background: 'transparent', writingMode: 'vertical-lr', direction: 'rtl', cursor: 'pointer', accentColor: accent(70, 60, 1) }} />
                  </div>
                  <span className="text-[7px] mt-0.5 leading-none" style={{ color: accent(40, 50, 0.4) }}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setBypassed(b => !b)}
            className="w-full rounded-lg py-1 text-[7.5px] font-medium border mt-1"
            style={bypassed
              ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
              : { background: accent(30, 10, 0.3), border: `1px solid ${accent(40, 30, 0.2)}`, color: accent(50, 60, 0.6) }}>
            {bypassed ? 'Bypassed' : 'Bypass'}
          </button>
        </div>
        </div>
      )}
    </div>
  );
}
