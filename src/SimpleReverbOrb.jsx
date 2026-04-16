import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createSimpleReverbEngine } from './simpleReverbEngine';
import ClipMeter from './ClipMeter';

const size   = 380;
const center = size / 2;
const radius = 146;

export default function SimpleReverbOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const [point, setPoint] = useState(() => ({
    x: initialState?.orbX ?? center,
    y: initialState?.orbY ?? center,
  }));
  const [mix,        setMix       ] = useState(initialState?.mix        ?? 0);
  const [inputGain,  setInputGain ] = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [pan,        setPan       ] = useState(initialState?.pan        ?? 0);
  const [bypassed,   setBypassed  ] = useState(initialState?.bypassed   ?? false);
  const [showPanel,  setShowPanel ] = useState(false);
  const [dragging,   setDragging  ] = useState(false);

  const [reactive, setReactive] = useState({ rms: 0, peak: 0 });
  const [inLevel,  setInLevel ] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak  ] = useState(0);
  const [outPeak,  setOutPeak ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);
  const wrapRef   = useRef(null);

  // Derived: X axis = tone (-1..+1), Y axis = decay (0..1, top = long)
  const tone  = (point.x - center) / radius;
  const decay = 1 - Math.max(0, Math.min(1, (point.y - (center - radius)) / (radius * 2)));

  // Refs so the engine init can read current state before the setter useEffects fire
  const toneRef       = useRef(tone);       toneRef.current       = tone;
  const decayRef      = useRef(decay);      decayRef.current      = decay;
  const mixRef        = useRef(mix);        mixRef.current        = mix;
  const inputGainRef  = useRef(inputGain);  inputGainRef.current  = inputGain;
  const outputGainRef = useRef(outputGain); outputGainRef.current = outputGain;
  const panRef        = useRef(pan);        panRef.current        = pan;
  const bypassedRef   = useRef(bypassed);   bypassedRef.current   = bypassed;

  useEffect(() => {
    if (!sharedSource) return;
    const engine = createSimpleReverbEngine(sharedSource.ctx);
    engineRef.current = engine;

    engine.setTone(toneRef.current);
    engine.setDecay(decayRef.current);
    engine.setMix(mixRef.current);
    engine.setInputGain(inputGainRef.current);
    engine.setOutputGain(outputGainRef.current);
    engine.setPan(panRef.current);
    engine.setBypass(bypassedRef.current);

    registerEngine(instanceId, engine);

    let _tickN = 0;
    const tick = () => {
      animRef.current = requestAnimationFrame(tick);
      if (!engineRef.current) return;
      setReactive(engineRef.current.getReactiveData());
      if (++_tickN % 2 === 0) {
        setInLevel(engineRef.current.getInputLevel());
        setOutLevel(engineRef.current.getOutputLevel());
        setInPeak(engineRef.current.getInputPeak());
        setOutPeak(engineRef.current.getOutputPeak());
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]);

  useEffect(() => { engineRef.current?.setTone(tone); },             [tone]);
  useEffect(() => { engineRef.current?.setDecay(decay); },           [decay]);
  useEffect(() => { engineRef.current?.setMix(mix); },               [mix]);
  useEffect(() => { engineRef.current?.setInputGain(inputGain); },   [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGain); }, [outputGain]);
  useEffect(() => { engineRef.current?.setPan(pan); },               [pan]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); },       [bypassed]);

  useEffect(() => {
    onStateChange?.(instanceId, { orbX: point.x, orbY: point.y, mix, inputGain, outputGain, pan, bypassed });
  }, [point.x, point.y, mix, inputGain, outputGain, pan, bypassed]);

  const updateFromPointer = useCallback((clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ddx = clientX - rect.left - center;
    const ddy = clientY - rect.top  - center;
    const d   = Math.sqrt(ddx*ddx + ddy*ddy);
    const ang = Math.atan2(ddy, ddx);
    const cl  = Math.min(d, radius);
    setPoint({ x: center + Math.cos(ang) * cl, y: center + Math.sin(ang) * cl });
  }, []);

  const onPD = useCallback(e => { e.preventDefault(); wrapRef.current?.setPointerCapture(e.pointerId); setDragging(true); updateFromPointer(e.clientX, e.clientY); }, [updateFromPointer]);
  const onPM = useCallback(e => { if (!dragging) return; updateFromPointer(e.clientX, e.clientY); }, [dragging, updateFromPointer]);
  const onPU = useCallback(e => { wrapRef.current?.releasePointerCapture(e.pointerId); setDragging(false); }, []);

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

  const rLow = Math.min(1, reactive.rms * 8);
  const orbR = 14 + rLow * 6 + decay * 7;

  const BLUE = '#5aa0ff';
  const CYAN = '#40d0e0';

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
        <circle cx={cx2} cy={cy2} r={ks * 0.28} fill="url(#rkbg)" />
        <line x1={cx2} y1={cy2} x2={ptr.x} y2={ptr.y} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        <circle cx={ptr.x} cy={ptr.y} r={2} fill={color} />
      </svg>
    );
  };

  return (
    <div style={{ width: size, height: 500, fontFamily: 'sans-serif', userSelect: 'none', borderRadius: 6, overflow: 'hidden', boxShadow: '0 6px 40px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column' }}>
      {/* Top wood */}
      <div style={{ flexShrink: 0, height: 8, background: 'linear-gradient(180deg, #0a1628, #050a14)', borderBottom: '1px solid #1a3050' }} />

      {/* Header */}
      <div style={{
        flexShrink: 0,
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', padding: '5px 10px',
        background: 'linear-gradient(180deg, #161616 0%, #0f0f0f 100%)',
        borderBottom: '1px solid #1e1e1e',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.25)' }}>Reverb</span>
        <div />
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
      <div ref={wrapRef} style={{ position: 'relative', width: size, flex: 1, minHeight: 0, aspectRatio: '1/1', maxWidth: '100%', margin: '0 auto', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}>

        {/* Background */}
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at ${point.x}px ${point.y}px, #081828, #030810 60%)` }} />

        <svg style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <clipPath id={`rc-${instanceId}`}><circle cx={center} cy={center} r={radius} /></clipPath>
            <radialGradient id="rkbg" cx="40%" cy="35%" r="65%">
              <stop offset="0%"   stopColor="#555" />
              <stop offset="60%"  stopColor="#2a2a2a" />
              <stop offset="100%" stopColor="#111" />
            </radialGradient>
            <radialGradient id={`rg-${instanceId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={`${BLUE}f0`} />
              <stop offset="55%"  stopColor={`${CYAN}70`} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          <g clipPath={`url(#rc-${instanceId})`}>
            {[0.25, 0.5, 0.75, 1].map(k => (
              <circle key={k} cx={center} cy={center} r={radius * k}
                fill="none" stroke={`${CYAN}${Math.round(k*0.15*255).toString(16).padStart(2,'0')}`} strokeWidth={0.5} strokeDasharray="3 4" />
            ))}
            <line x1={center - radius} y1={center} x2={center + radius} y2={center}
              stroke={`${BLUE}28`} strokeWidth={0.5} strokeDasharray="2 5" />
            <line x1={center} y1={center - radius} x2={center} y2={center + radius}
              stroke={`${CYAN}28`} strokeWidth={0.5} strokeDasharray="2 5" />
          </g>

          <circle cx={center} cy={center} r={radius} fill="none" stroke={`${BLUE}25`} strokeWidth={1} />

          <text x={center - radius - 8} y={center} textAnchor="end" dominantBaseline="middle"
            style={{ fontSize: 7, fill: `${BLUE}60`, fontFamily: 'monospace' }}>DARK</text>
          <text x={center + radius + 8} y={center} textAnchor="start" dominantBaseline="middle"
            style={{ fontSize: 7, fill: `${BLUE}60`, fontFamily: 'monospace' }}>BRITE</text>
          <text x={center} y={center - radius - 6} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 7, fill: `${CYAN}60`, fontFamily: 'monospace' }}>LONG</text>
          <text x={center} y={center + radius + 10} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 7, fill: `${CYAN}60`, fontFamily: 'monospace' }}>TIGHT</text>
        </svg>

        {/* Aura — expands with decay */}
        <div style={{
          position: 'absolute', pointerEvents: 'none',
          left: point.x - radius * 0.6, top: point.y - radius * 0.6,
          width: radius * 1.2, height: radius * 1.2, borderRadius: '50%',
          background: `radial-gradient(circle, ${BLUE}${Math.round((0.08 + decay * 0.28 + rLow * 0.08) * 255).toString(16).padStart(2,'0')}, transparent 70%)`,
          filter: `blur(${16 + decay * 24}px)`,
        }} />

        {/* Orb */}
        <svg style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <circle cx={point.x} cy={point.y} r={orbR * 2.6}
            fill={`url(#rg-${instanceId})`}
            style={{ filter: `blur(${10 + decay * 16}px)`, opacity: 0.3 + decay * 0.45 }} />
          <circle cx={point.x} cy={point.y} r={orbR}
            fill={`${BLUE}40`}
            stroke={`${CYAN}${Math.round((0.65 + decay * 0.3) * 255).toString(16).padStart(2,'0')}`}
            strokeWidth={1.5 + decay * 1.5}
            style={{ filter: `drop-shadow(0 0 ${6 + decay * 18}px ${BLUE}a0)` }} />
        </svg>

        {/* Readout */}
        <div style={{
          position: 'absolute', left: 12, top: 12,
          fontSize: 8, fontFamily: '"Courier New", monospace',
          letterSpacing: '0.1em',
        }}>
          <div style={{ color: `${BLUE}99` }}>TONE {tone >= 0 ? '+' : ''}{Math.round(tone * 100)}</div>
          <div style={{ color: `${CYAN}99` }}>DECAY {Math.round(decay * 100)}</div>
        </div>
      </div>

      {/* BOTTOM CONTROLS */}
      <div style={{
        flexShrink: 0,
        background: 'linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)',
        borderTop: '1px solid #1e1e1e',
      }}>
        {/* Clip-visibility meter — big dB numbers so you can actually tell when you're hitting 0 */}
        <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />

        <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #151515' }}>

          {/* MIX */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 6px 4px',
            borderRight: '1px solid #1e1e1e',
            background: `linear-gradient(160deg, #081522 0%, #040a14 100%)`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 4 }}>
              <span style={{ fontSize: 7, color: '#183050', letterSpacing: '0.15em' }}>DRY</span>
              <span style={{ fontSize: 8, color: `${BLUE}99`, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Mix</span>
              <span style={{ fontSize: 7, color: '#183050', letterSpacing: '0.15em' }}>WET</span>
            </div>
            <div style={{ touchAction: 'none', cursor: 'ns-resize' }}
              onPointerDown={onMixPD} onPointerMove={onMixPM} onPointerUp={onMixPU} onDoubleClick={() => setMix(0)}>
              <KnobArc value={mix} color={BLUE} size={44} />
            </div>
            <div style={{ fontFamily: '"Courier New", monospace', fontSize: 8, color: BLUE, marginTop: 3 }}>
              {mix < 0.01 ? 'DRY' : mix > 0.99 ? 'WET' : `${Math.round(mix * 100)}%`}
            </div>
          </div>

          {/* Settings */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 10px', gap: 6 }}>
            <button onClick={() => setShowPanel(p => !p)} style={{
              width: 24, height: 24, borderRadius: 3, cursor: 'pointer',
              background: showPanel ? 'rgba(90,160,255,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showPanel ? BLUE : '#222'}`,
              color: showPanel ? BLUE : '#444', fontSize: 12,
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
                style={{ flex: 1, accentColor: BLUE, height: 2 }} />
              <span style={{ fontSize: 7, color: '#888', width: 32, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(val)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom wood */}
      <div style={{ flexShrink: 0, height: 8, background: 'linear-gradient(180deg, #050a14, #0a1628)', borderTop: '1px solid #1a3050' }} />
    </div>
  );
}
