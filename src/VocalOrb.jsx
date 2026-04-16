import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createVocalEngine } from './vocalEngine';
import ClipMeter from './ClipMeter';

// ── Scale definitions ────────────────────────────────────────────────────────
const SCALES = {
  chromatic:  [0,1,2,3,4,5,6,7,8,9,10,11],
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  pentatonic: [0,2,4,7,9],
  blues:      [0,3,5,6,7,10],
  wholetone:  [0,2,4,6,8,10],
};

function getScaleSemitones(scaleName, range = 12) {
  const intervals = SCALES[scaleName] || SCALES.chromatic;
  const out = new Set();
  for (let oct = -2; oct <= 2; oct++) {
    for (const iv of intervals) {
      const s = oct * 12 + iv;
      if (s >= -range && s <= range) out.add(s);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function snapToScale(semitones, scaleName) {
  const degs = getScaleSemitones(scaleName);
  return degs.reduce((best, d) => Math.abs(d - semitones) < Math.abs(best - semitones) ? d : best, degs[0]);
}

// Harmony interval presets: label → semitones offset
const HARMONY_PRESETS = [
  { label: 'Off', value: 0 },
  { label: 'm3',  value: 3 },
  { label: 'M3',  value: 4 },
  { label: '5th', value: 7 },
  { label: 'Oct', value: 12 },
];

// ── LAB-style mode LED ───────────────────────────────────────────────────────
const ModeLED = ({ label, active, color, onClick }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
  }}>
    <div style={{
      width: 9, height: 9, borderRadius: 2,
      background: active ? color : '#151515',
      border: `1px solid ${active ? color : '#2a2a2a'}`,
      boxShadow: active ? `0 0 5px ${color}80` : 'none',
      transition: 'all 0.08s',
      flexShrink: 0,
    }} />
    <span style={{
      fontSize: 7.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
      color: active ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.22)',
      transition: 'color 0.08s',
    }}>{label}</span>
  </button>
);

const size   = 380;
const center = size / 2;
const radius = 146;

export default function VocalOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const [point,      setPoint     ] = useState(() => ({
    x: initialState?.orbX ?? center,
    y: initialState?.orbY ?? center,
  }));
  const [mode,       setMode      ] = useState(initialState?.mode       ?? 'transpose');
  const [scale,      setScale     ] = useState(initialState?.scale      ?? 'chromatic');
  const [harmony,    setHarmony   ] = useState(initialState?.harmony    ?? 0);
  const [drive,      setDrive     ] = useState(initialState?.drive      ?? 0);
  const [mix,        setMix       ] = useState(initialState?.mix        ?? 0.5);
  const [inputGain,  setInputGain ] = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [pan,        setPan       ] = useState(initialState?.pan        ?? 0);
  const [bypassed,   setBypassed  ] = useState(initialState?.bypassed   ?? false);
  const [showPanel,  setShowPanel ] = useState(false);
  const [dragging,   setDragging  ] = useState(false);

  const [reactive,  setReactive ] = useState({ rms: 0, peak: 0 });
  const [inLevel,   setInLevel  ] = useState(0);
  const [outLevel,  setOutLevel ] = useState(0);
  const [inPeak,    setInPeak   ] = useState(0);
  const [outPeak,   setOutPeak  ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);
  const wrapRef   = useRef(null);
  const modeRef   = useRef(mode);  modeRef.current  = mode;
  const scaleRef  = useRef(scale); scaleRef.current = scale;

  // Derived pitch / formant
  const rawPitch   = -(point.y - center) / radius * 12;
  const rawFormant =  (point.x - center) / radius;
  const pitch      = mode === 'quantize' ? snapToScale(rawPitch, scale) : rawPitch;
  const formant    = rawFormant;

  const displayY  = mode === 'quantize' ? center - (pitch / 12) * radius : point.y;
  const displayPt = { x: point.x, y: displayY };

  // Refs so the async engine init can read current state even after React updates
  const pitchRef      = useRef(0);
  const formantRef    = useRef(0);
  const harmonyRef    = useRef(harmony);
  const driveValRef   = useRef(drive);
  const mixRef        = useRef(mix);
  const inputGainRef  = useRef(inputGain);
  const outputGainRef = useRef(outputGain);
  const panRef        = useRef(pan);
  const bypassedRef   = useRef(bypassed);
  // Keep refs in sync
  pitchRef.current      = -(point.y - center) / radius * 12;
  formantRef.current    = (point.x - center) / radius;
  harmonyRef.current    = harmony;
  driveValRef.current   = drive;
  mixRef.current        = mix;
  inputGainRef.current  = inputGain;
  outputGainRef.current = outputGain;
  panRef.current        = pan;
  bypassedRef.current   = bypassed;

  // Engine init — async because AudioWorklet module must be loaded first.
  // The module load is cached per AudioContext, so only the first VocalOrb
  // pays the async cost; subsequent ones resolve immediately.
  useEffect(() => {
    if (!sharedSource) return;
    let engine = null;
    let cancelled = false;

    createVocalEngine(sharedSource.ctx).then(eng => {
      if (cancelled) { eng.destroy(); return; }
      engine = eng;
      engineRef.current = engine;

      // Apply current state — the setter useEffects fired before the engine
      // was ready (engineRef was null), so we replay them here.
      eng.setPitch(pitchRef.current);
      eng.setFormant(formantRef.current);
      eng.setMode(modeRef.current);
      eng.setHarmonyInterval(modeRef.current === 'quantize' ? harmonyRef.current : 0);
      eng.setDrive(driveValRef.current);
      eng.setMix(mixRef.current);
      eng.setInputGain(inputGainRef.current);
      eng.setOutputGain(outputGainRef.current);
      eng.setPan(panRef.current);
      eng.setBypass(bypassedRef.current);

      registerEngine(instanceId, engine);

      let _tickN = 0;
      const tick = () => {
        animRef.current = requestAnimationFrame(tick);
        if (!engineRef.current) return;
        // Orb reactive data at full 60fps — drives smooth visual animation
        setReactive(engineRef.current.getReactiveData());
        // Level meters at 30fps — human eye can't distinguish faster
        if (++_tickN % 2 === 0) {
          setInLevel(engineRef.current.getInputLevel());
          setOutLevel(engineRef.current.getOutputLevel());
          setInPeak(engineRef.current.getInputPeak());
          setOutPeak(engineRef.current.getOutputPeak());
        }
      };
      tick();
    }).catch(err => {
      console.error('[VocalOrb] engine init failed:', err);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      if (engine) { engine.destroy(); engineRef.current = null; }
    };
  }, [sharedSource]);

  useEffect(() => { engineRef.current?.setPitch(pitch); },          [pitch]);
  useEffect(() => { engineRef.current?.setFormant(formant); },      [formant]);
  useEffect(() => { engineRef.current?.setMode(mode); },            [mode]);
  useEffect(() => { engineRef.current?.setHarmonyInterval(mode === 'quantize' ? harmony : 0); }, [mode, harmony]);
  useEffect(() => { engineRef.current?.setDrive(drive); },          [drive]);
  useEffect(() => { engineRef.current?.setMix(mix); },              [mix]);
  useEffect(() => { engineRef.current?.setInputGain(inputGain); },  [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGain); },[outputGain]);
  useEffect(() => { engineRef.current?.setPan(pan); },              [pan]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); },      [bypassed]);

  useEffect(() => {
    onStateChange?.(instanceId, { orbX: point.x, orbY: point.y, mode, scale, harmony, drive, mix, inputGain, outputGain, pan, bypassed });
  }, [point.x, point.y, mode, scale, harmony, drive, mix, inputGain, outputGain, pan, bypassed]);

  const updateFromPointer = useCallback((clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ddx = clientX - rect.left - center;
    const ddy = clientY - rect.top  - center;
    const d   = Math.sqrt(ddx*ddx + ddy*ddy);
    const ang = Math.atan2(ddy, ddx);
    const cl  = Math.min(d, radius);
    let nx = center + Math.cos(ang) * cl;
    let ny = center + Math.sin(ang) * cl;
    if (modeRef.current === 'quantize') {
      const rawSemi = -(ny - center) / radius * 12;
      const snapped = snapToScale(rawSemi, scaleRef.current);
      ny = center - (snapped / 12) * radius;
      const dx2 = nx - center, dy2 = ny - center;
      const d2 = Math.sqrt(dx2*dx2 + dy2*dy2);
      if (d2 > radius) nx = center + (dx2 / d2) * radius;
    }
    setPoint({ x: nx, y: ny });
  }, []);

  const onPD = useCallback(e => { e.preventDefault(); wrapRef.current?.setPointerCapture(e.pointerId); setDragging(true); updateFromPointer(e.clientX, e.clientY); }, [updateFromPointer]);
  const onPM = useCallback(e => { if (!dragging) return; updateFromPointer(e.clientX, e.clientY); }, [dragging, updateFromPointer]);
  const onPU = useCallback(e => { wrapRef.current?.releasePointerCapture(e.pointerId); setDragging(false); }, []);

  const rLow      = Math.min(1, reactive.rms * 8);
  const depthNorm = Math.min(1, Math.abs(rawPitch) / 12);
  const orbR      = 14 + rLow * 6 + depthNorm * 7;

  const pitchDisplay   = Math.abs(pitch) < 0.08 ? null : `${pitch > 0 ? '+' : ''}${(Math.round(pitch * 10) / 10)}st`;
  const formantDisplay = Math.abs(formant) < 0.04 ? null : formant > 0 ? `♀ ${Math.round(Math.abs(formant) * 100)}` : `♂ ${Math.round(Math.abs(formant) * 100)}`;

  // ── Amber = pitch axis, Teal = formant axis, Red = drive accent
  const AMBER = '#d4940a';
  const TEAL  = '#40c0a0';
  const RED   = '#e03030';

  // Drive knob drag
  const driveRef = useRef(null);
  const driveStartY = useRef(null);
  const driveStartV = useRef(null);
  const onDrivePD = e => { e.currentTarget.setPointerCapture(e.pointerId); driveStartY.current = e.clientY; driveStartV.current = drive; };
  const onDrivePM = e => {
    if (driveStartY.current === null) return;
    const d = (driveStartY.current - e.clientY) / 120;
    setDrive(Math.max(0, Math.min(1, driveStartV.current + d)));
  };
  const onDrivePU = e => { e.currentTarget.releasePointerCapture(e.pointerId); driveStartY.current = null; };

  // Mix knob drag
  const mixStartY = useRef(null);
  const mixStartV = useRef(null);
  const onMixPD = e => { e.currentTarget.setPointerCapture(e.pointerId); mixStartY.current = e.clientY; mixStartV.current = mix; };
  const onMixPM = e => {
    if (mixStartY.current === null) return;
    const d = (mixStartY.current - e.clientY) / 120;
    setMix(Math.max(0, Math.min(1, mixStartV.current + d)));
  };
  const onMixPU = e => { e.currentTarget.releasePointerCapture(e.pointerId); mixStartY.current = null; };

  const KnobArc = ({ value, color, size: ks = 44 }) => {
    const norm = Math.max(0, Math.min(1, value));
    const deg  = -150 + norm * 300;
    const r    = ks * 0.36;
    const cx2  = ks / 2, cy2 = ks / 2;
    const polar = a => ({ x: cx2 + r * Math.cos((a - 90) * Math.PI / 180), y: cy2 + r * Math.sin((a - 90) * Math.PI / 180) });
    const tS = polar(-150), tE = polar(150), aE = polar(deg);
    const large = (deg + 150) > 180 ? 1 : 0;
    const ptr = polar(deg);
    return (
      <svg width={ks} height={ks} style={{ overflow: 'visible' }}>
        <path d={`M ${tS.x} ${tS.y} A ${r} ${r} 0 1 1 ${tE.x} ${tE.y}`} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={2.5} strokeLinecap="round" />
        {norm > 0.01 && <path d={`M ${tS.x} ${tS.y} A ${r} ${r} 0 ${large} 1 ${aE.x} ${aE.y}`} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />}
        <circle cx={cx2} cy={cy2} r={ks * 0.28} fill="url(#kbg)" />
        <line x1={cx2} y1={cy2} x2={ptr.x} y2={ptr.y} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        <circle cx={ptr.x} cy={ptr.y} r={2} fill={color} />
      </svg>
    );
  };

  return (
    <div style={{ width: size, fontFamily: 'sans-serif', userSelect: 'none', borderRadius: 6, overflow: 'hidden', boxShadow: '0 6px 40px rgba(0,0,0,0.8)' }}>

      {/* Top wood */}
      <div style={{ height: 8, background: 'linear-gradient(180deg, #3d2608, #2a1804)', borderBottom: '1px solid #5a380c' }} />

      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', padding: '5px 10px',
        background: 'linear-gradient(180deg, #161616 0%, #0f0f0f 100%)',
        borderBottom: '1px solid #1e1e1e',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.25)' }}>Vocal</span>

        {/* Mode LEDs */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ModeLED label="T" active={mode === 'transpose'} color="#aaaaaa" onClick={() => setMode('transpose')} />
          <ModeLED label="Q" active={mode === 'quantize'}  color={RED}     onClick={() => setMode('quantize')}  />
          <ModeLED label="R" active={mode === 'robot'}     color={TEAL}    onClick={() => setMode('robot')}     />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={() => setBypassed(b => !b)} style={{
            fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 2, cursor: 'pointer',
            ...(bypassed
              ? { background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.45)', color: '#fcd34d' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.25)' })
          }}>{bypassed ? 'BYP' : 'ON'}</button>
          {onRemove && (
            <button onClick={onRemove} style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          )}
        </div>
      </div>

      {/* XY Pad */}
      <div ref={wrapRef} style={{ position: 'relative', width: size, height: size, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}>

        {/* Background */}
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at ${displayPt.x}px ${displayPt.y}px, #1a1208, #0a0a0a 60%)` }} />

        <svg style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <clipPath id={`vc-${instanceId}`}><circle cx={center} cy={center} r={radius} /></clipPath>
            <radialGradient id="kbg" cx="40%" cy="35%" r="65%">
              <stop offset="0%"   stopColor="#555" />
              <stop offset="60%"  stopColor="#2a2a2a" />
              <stop offset="100%" stopColor="#111" />
            </radialGradient>
          </defs>

          {/* Semitone grid — in Q mode highlight only scale degrees */}
          <g clipPath={`url(#vc-${instanceId})`}>
            {Array.from({ length: 25 }, (_, k) => k - 12).map(s => {
              const y = center - (s / 12) * radius;
              const isCenter  = s === 0;
              const inScale   = mode === 'quantize' ? getScaleSemitones(scale).includes(s) : true;
              const isOctave  = Math.abs(s) === 12;
              if (mode === 'quantize' && !inScale) return null;
              return (
                <line key={s} x1={0} y1={y} x2={size} y2={y}
                  stroke={isCenter ? `${AMBER}70` : isOctave ? `${AMBER}40` : inScale && mode === 'quantize' ? `${RED}35` : `${AMBER}0e`}
                  strokeWidth={isCenter || isOctave ? 1 : 0.5}
                  strokeDasharray={isCenter || isOctave ? undefined : mode === 'quantize' ? '4 4' : '2 5'} />
              );
            })}
            {/* Vertical formant zero */}
            <line x1={center} y1={center - radius} x2={center} y2={center + radius}
              stroke={`${TEAL}18`} strokeWidth={0.5} strokeDasharray="2 5" />
            {/* Formant gradient — left (♂ dark) to right (♀ bright) */}
            <rect x={0} y={0} width={size} height={size}
              fill="url(#fgrad)" opacity={0.04} />
          </g>

          {/* Formant gradient def */}
          <defs>
            <linearGradient id="fgrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#1a6060" />
              <stop offset="50%"  stopColor="transparent" />
              <stop offset="100%" stopColor="#60c0a0" />
            </linearGradient>
          </defs>

          {/* Outer ring */}
          <circle cx={center} cy={center} r={radius} fill="none" stroke={`${AMBER}25`} strokeWidth={1} />

          {/* Pitch labels */}
          {[-12, -6, 0, 6, 12].map(s => {
            const y = center - (s / 12) * radius;
            return (
              <text key={s} x={center - radius - 8} y={y} textAnchor="end" dominantBaseline="middle"
                style={{ fontSize: 7, fill: `${AMBER}${s === 0 ? '70' : '38'}`, fontFamily: 'monospace' }}>
                {s > 0 ? `+${s}` : s === 0 ? '0' : s}
              </text>
            );
          })}

          {/* ♂ / ♀ formant labels */}
          <text x={center - radius - 3} y={center + radius + 14} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 10, fill: `${TEAL}50`, fontFamily: 'sans-serif' }}>♂</text>
          <text x={center + radius + 3} y={center + radius + 14} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 10, fill: `${TEAL}70`, fontFamily: 'sans-serif' }}>♀</text>

          {/* Quantize snap line */}
          {mode === 'quantize' && Math.abs(point.y - displayPt.y) > 2 && (
            <line x1={point.x} y1={point.y} x2={displayPt.x} y2={displayPt.y}
              stroke={`${RED}50`} strokeWidth={1} strokeDasharray="3 3" />
          )}
        </svg>

        {/* Aura */}
        <div style={{
          position: 'absolute', pointerEvents: 'none',
          left: displayPt.x - radius * 0.5, top: displayPt.y - radius * 0.5,
          width: radius, height: radius, borderRadius: '50%',
          background: `radial-gradient(circle, ${AMBER}${Math.round((0.10 + depthNorm * 0.22 + rLow * 0.08) * 255).toString(16).padStart(2,'0')}, transparent 70%)`,
          filter: `blur(${14 + depthNorm * 18}px)`,
        }} />

        {/* Orb */}
        <svg style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <radialGradient id={`vg-${instanceId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={`${AMBER}f0`} />
              <stop offset="55%"  stopColor={`${AMBER}70`} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <circle cx={displayPt.x} cy={displayPt.y} r={orbR * 2.6}
            fill={`url(#vg-${instanceId})`}
            style={{ filter: `blur(${9 + depthNorm * 14}px)`, opacity: 0.3 + depthNorm * 0.45 }} />
          <circle cx={displayPt.x} cy={displayPt.y} r={orbR}
            fill={`${AMBER}40`}
            stroke={`${AMBER}${Math.round((0.65 + depthNorm * 0.3) * 255).toString(16).padStart(2,'0')}`}
            strokeWidth={1.5 + depthNorm * 1.5}
            style={{ filter: `drop-shadow(0 0 ${6 + depthNorm * 16}px ${AMBER}a0)` }} />
        </svg>

        {/* Pitch overlay */}
        {pitchDisplay && (
          <div style={{
            position: 'absolute', pointerEvents: 'none',
            left: displayPt.x, top: displayPt.y - orbR - 16,
            transform: 'translateX(-50%)',
            color: AMBER, fontSize: 8, fontFamily: '"Courier New", monospace', fontWeight: 'bold',
            textShadow: `0 0 8px ${AMBER}80`,
          }}>{pitchDisplay}</div>
        )}
        {/* Formant overlay */}
        {formantDisplay && (
          <div style={{
            position: 'absolute', pointerEvents: 'none',
            left: formant > 0 ? displayPt.x + orbR + 7 : displayPt.x - orbR - 7,
            top: displayPt.y, transform: `translateY(-50%)${formant < 0 ? ' translateX(-100%)' : ''}`,
            color: TEAL, fontSize: 8, fontFamily: '"Courier New", monospace',
          }}>{formantDisplay}</div>
        )}
      </div>

      {/* ── BOTTOM CONTROLS ── */}
      <div style={{
        background: 'linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)',
        borderTop: '1px solid #1e1e1e',
      }}>

        {/* ── QUANTIZE controls (visible only in Q mode) ── */}
        {mode === 'quantize' && (
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid #1e1e1e',
            background: 'linear-gradient(160deg, #1a0808 0%, #100505 100%)',
          }}>
            {/* Scale row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 8, color: `${RED}80`, letterSpacing: '0.2em', width: 38, flexShrink: 0, textTransform: 'uppercase' }}>Scale</span>
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                {Object.keys(SCALES).map(s => (
                  <button key={s} onClick={() => setScale(s)} style={{
                    flex: 1, fontSize: 7, fontWeight: 700, padding: '2px 0',
                    borderRadius: 2, cursor: 'pointer', letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    background: scale === s ? `${RED}25` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${scale === s ? RED : 'rgba(255,255,255,0.06)'}`,
                    color: scale === s ? RED : 'rgba(255,255,255,0.3)',
                  }}>
                    {s === 'pentatonic' ? 'Pent' : s === 'wholetone' ? 'WT' : s.slice(0,4)}
                  </button>
                ))}
              </div>
            </div>

            {/* Harmony row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 8, color: `${RED}80`, letterSpacing: '0.2em', width: 38, flexShrink: 0, textTransform: 'uppercase' }}>+Voice</span>
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                {HARMONY_PRESETS.map(({ label, value }) => (
                  <button key={label} onClick={() => setHarmony(value)} style={{
                    flex: 1, fontSize: 8, fontWeight: 700, padding: '2px 0',
                    borderRadius: 2, cursor: 'pointer',
                    background: harmony === value ? `${RED}30` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${harmony === value ? RED : 'rgba(255,255,255,0.06)'}`,
                    color: harmony === value ? RED : 'rgba(255,255,255,0.3)',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Clip-visibility meter — big dB numbers so clipping is unmissable */}
        <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />

        {/* Drive + Mix row */}
        <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #151515' }}>

          {/* DRIVE */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 6px 4px',
            borderRight: '1px solid #1e1e1e',
            background: `linear-gradient(160deg, #1e0808 0%, #130505 100%)`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 4 }}>
              <span style={{ fontSize: 7, color: '#601818', letterSpacing: '0.15em' }}>MIN</span>
              <span style={{ fontSize: 8, color: `${RED}99`, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Drive</span>
              <span style={{ fontSize: 7, color: '#601818', letterSpacing: '0.15em' }}>MAX</span>
            </div>
            <div style={{ touchAction: 'none', cursor: 'ns-resize' }}
              onPointerDown={onDrivePD} onPointerMove={onDrivePM} onPointerUp={onDrivePU} onDoubleClick={() => setDrive(0)}>
              <KnobArc value={drive} color={RED} size={44} />
            </div>
            <div style={{ fontFamily: '"Courier New", monospace', fontSize: 8, color: RED, marginTop: 3 }}>
              {drive < 0.01 ? 'OFF' : Math.round(drive * 100)}
            </div>
          </div>

          {/* MIX */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 6px 4px',
            borderRight: '1px solid #1e1e1e',
            background: `linear-gradient(160deg, #0d1a10 0%, #080d08 100%)`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 4 }}>
              <span style={{ fontSize: 7, color: '#1a4020', letterSpacing: '0.15em' }}>DRY</span>
              <span style={{ fontSize: 8, color: `${TEAL}99`, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Mix</span>
              <span style={{ fontSize: 7, color: '#1a4020', letterSpacing: '0.15em' }}>WET</span>
            </div>
            <div style={{ touchAction: 'none', cursor: 'ns-resize' }}
              onPointerDown={onMixPD} onPointerMove={onMixPM} onPointerUp={onMixPU} onDoubleClick={() => setMix(0.5)}>
              <KnobArc value={mix} color={TEAL} size={44} />
            </div>
            <div style={{ fontFamily: '"Courier New", monospace', fontSize: 8, color: TEAL, marginTop: 3 }}>
              {mix < 0.01 ? 'DRY' : mix > 0.99 ? 'WET' : `${Math.round(mix * 100)}%`}
            </div>
          </div>

          {/* Mode panel */}
          <div style={{
            flex: '0 0 90px', padding: '8px 10px',
            background: 'linear-gradient(160deg, #0d1f1e 0%, #080f0f 100%)',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
          }}>
            <span style={{ fontSize: 7, color: `${TEAL}60`, letterSpacing: '0.2em', marginBottom: 4, textTransform: 'uppercase' }}>Mode</span>
            <ModeLED label="Transpose" active={mode === 'transpose'} color="#aaaaaa" onClick={() => setMode('transpose')} />
            <ModeLED label="Quantize"  active={mode === 'quantize'}  color={RED}     onClick={() => setMode('quantize')}  />
            <ModeLED label="Robot"     active={mode === 'robot'}     color={TEAL}    onClick={() => setMode('robot')}     />
          </div>

          {/* Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px', gap: 6 }}>
            <button onClick={() => setShowPanel(p => !p)} style={{
              width: 24, height: 24, borderRadius: 3, cursor: 'pointer',
              background: showPanel ? 'rgba(212,148,10,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showPanel ? AMBER : '#222'}`,
              color: showPanel ? AMBER : '#444', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⚙</button>
          </div>
        </div>
      </div>

      {/* Settings panel */}
      {showPanel && (
        <div style={{ background: '#0a0a0a', borderTop: '1px solid #1a1a1a', padding: '10px 14px' }}>
          {[
            ['In Gain',  inputGain,  setInputGain,  0, 2, v => `${Math.round(v*100)}%`],
            ['Out Gain', outputGain, setOutputGain, 0, 2, v => `${Math.round(v*100)}%`],
            ['Pan',      pan,        setPan,        -1, 1, v => v === 0 ? 'C' : v > 0 ? `R${Math.round(v*100)}` : `L${Math.round(-v*100)}`],
          ].map(([label, val, setter, mn, mx, fmt]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 7.5, color: '#555', width: 50, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
              <input type="range" min={mn} max={mx} step={0.01} value={val}
                onChange={e => setter(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: AMBER, height: 2 }} />
              <span style={{ fontSize: 7, color: '#888', width: 32, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(val)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom wood */}
      <div style={{ height: 8, background: 'linear-gradient(180deg, #2a1804, #3d2608)', borderTop: '1px solid #5a380c' }} />
    </div>
  );
}
