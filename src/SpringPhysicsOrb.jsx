// SpringPhysicsOrb.jsx — Spring reverb tank
// UI inspired by Selector Spring Reverb VST:
//   industrial dark panel, white knobs, digital readouts, LED meter bars

import React, { useState, useRef, useEffect } from 'react';
import { createSpringPhysicsEngine } from './springPhysicsEngine';

// ─── LED Meter Bar ────────────────────────────────────────────────────────────
function LedMeter({ level, peak, label, accent, n = 20 }) {
  const lit = Math.round(Math.min(1, level) * n);
  const pk  = Math.min(n - 1, Math.round(Math.min(1, peak) * n));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontSize: 7, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.30)', fontWeight: 700, width: 42, flexShrink: 0,
      }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} style={{
            width: 7, height: 5, borderRadius: 1,
            background: i < lit
              ? (i >= n * 0.85 ? '#ff4444' : i >= n * 0.70 ? '#ffaa00' : accent)
              : 'rgba(255,255,255,0.07)',
            boxShadow: i < lit && i >= n * 0.70 ? `0 0 3px ${i >= n*0.85 ? '#ff4444' : '#ffaa00'}` : 'none',
            outline: i === pk && peak > 0.05 ? `1px solid ${accent}` : 'none',
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── Knob SVG ─────────────────────────────────────────────────────────────────
function SelectorKnobSVG({ size, norm }) {
  const id  = useRef(`sk-${Math.random().toString(36).slice(2,7)}`).current;
  const cx  = size / 2, cy = size / 2;
  const outerR = size / 2 - 1;
  const faceR  = outerR * 0.78;
  const arcR   = outerR + 2.5;  // arc drawn just outside the knob face

  // Arc from -135° to current angle (270° sweep total)
  const startDeg = -135;
  const endDeg   = startDeg + norm * 270;
  const toRad = d => (d - 90) * Math.PI / 180;
  const arcX = (r, deg) => (cx + r * Math.cos(toRad(deg))).toFixed(2);
  const arcY = (r, deg) => (cy + r * Math.sin(toRad(deg))).toFixed(2);
  const largeArc = norm * 270 > 180 ? 1 : 0;

  // Pointer
  const angleRad = toRad(endDeg);
  const px  = (cx + (faceR - 4) * Math.cos(angleRad)).toFixed(2);
  const py  = (cy + (faceR - 4) * Math.sin(angleRad)).toFixed(2);
  const psx = (cx + faceR * 0.22 * Math.cos(angleRad)).toFixed(2);
  const psy = (cy + faceR * 0.22 * Math.sin(angleRad)).toFixed(2);

  // Track arc path (full 270° dimmed)
  const trackPath = `M ${arcX(arcR, startDeg)} ${arcY(arcR, startDeg)} A ${arcR} ${arcR} 0 1 1 ${arcX(arcR, startDeg + 269.9)} ${arcY(arcR, startDeg + 269.9)}`;
  // Value arc path
  const valuePath = norm > 0.001
    ? `M ${arcX(arcR, startDeg)} ${arcY(arcR, startDeg)} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcX(arcR, endDeg)} ${arcY(arcR, endDeg)}`
    : null;

  return (
    <svg width={size + 6} height={size + 6} style={{ display: 'block', pointerEvents: 'none', overflow: 'visible', margin: '-3px' }}>
      <defs>
        <filter id={`${id}-sh`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.7)" />
        </filter>
      </defs>
      {/* Track arc */}
      <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1.2} strokeLinecap="round" transform={`translate(3,3)`} />
      {/* Value arc */}
      {valuePath && <path d={valuePath} fill="none" stroke="rgba(245,166,35,0.45)" strokeWidth={1.2} strokeLinecap="round" transform={`translate(3,3)`} />}
      {/* Knob face — flat dark */}
      <circle cx={cx+3} cy={cy+3} r={outerR} fill="#222" filter={`url(#${id}-sh)`} />
      <circle cx={cx+3} cy={cy+3} r={outerR} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      {/* Pointer */}
      <line x1={+psx+3} y1={+psy+3} x2={+px+3} y2={+py+3}
        stroke="rgba(255,255,255,0.70)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

// ─── Knob wrapper ─────────────────────────────────────────────────────────────
function SelectorKnob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, accent, format }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const displayVal = format ? format(value) : value.toFixed(2);

  const onDown = (e) => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = (ev) => {
      const dy = ref.current.y - ev.clientY;
      const newV = Math.max(min, Math.min(max, ref.current.v + dy * (max - min) / 150));
      onChange(newV);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, userSelect: 'none' }}>
      {/* Value badge — like Selector's green readouts */}
      <div style={{
        background: accent,
        color: '#000',
        fontSize: 5.5,
        fontFamily: '"Courier New", monospace',
        fontWeight: 900,
        padding: '2px 6px',
        borderRadius: 3,
        letterSpacing: '0.04em',
        minWidth: 30,
        textAlign: 'center',
        boxShadow: `0 0 6px ${accent}55`,
      }}>{displayVal}</div>
      {/* Knob */}
      <div
        onPointerDown={onDown}
        onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <SelectorKnobSVG size={size} norm={norm} accent={accent} />
      </div>
      {/* Label */}
      <span style={{
        fontSize: 6.5, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.38)', fontWeight: 700,
      }}>{label}</span>
    </div>
  );
}

// ─── Spring coil SVG ──────────────────────────────────────────────────────────
function SpringCoilSVG({ width = 22, height = 120, accent, level = 0 }) {
  const coils = 9, cx = width / 2;
  const gap   = (height - 10) / coils;
  const rx = width * 0.42, ry = gap * 0.30;
  const jiggle  = Math.min(level * 16, 4);
  const glowOp  = Math.min(level * 3, 0.55);
  const back = [], front = [];
  for (let i = 0; i < coils; i++) {
    const y0 = 5 + i * gap, y2 = 5 + (i + 1) * gap;
    const ph = Math.sin(Date.now() * 0.009 + i * 0.75) * jiggle;
    const cxW = cx + ph;
    back.push(`M ${(cxW - rx).toFixed(1)} ${y0.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${(cxW + rx).toFixed(1)} ${y0.toFixed(1)}`);
    front.push(`M ${(cxW + rx).toFixed(1)} ${y0.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${(cxW - rx).toFixed(1)} ${y2.toFixed(1)}`);
  }
  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0 }}>
      <line x1={cx} y1={0}          x2={cx} y2={5}      stroke={accent} strokeWidth={1.5} opacity={0.4} />
      <line x1={cx} y1={height - 5} x2={cx} y2={height} stroke={accent} strokeWidth={1.5} opacity={0.4} />
      {glowOp > 0.05 && front.map((d, i) => (
        <path key={`g${i}`} d={d} fill="none" stroke={accent} strokeWidth={5} strokeLinecap="round" opacity={glowOp * 0.35} />
      ))}
      {back.map((d, i)  => <path key={`b${i}`} d={d} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={1.5} />)}
      {front.map((d, i) => <path key={`f${i}`} d={d} fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.55 + glowOp * 0.45} />)}
    </svg>
  );
}

// ─── Format helpers ───────────────────────────────────────────────────────────
const fmtDecay  = v => `${Math.round((0.40 + v * v * 0.55) * 100)}%`;
const fmtPct    = v => `${Math.round(v * 100)}%`;
const fmtLen    = v => { const ms = Math.round((0.4 + v * 1.6) * 1000 * 0.037); return `${ms}ms`; };
const fmtDamp   = v => { const f = Math.round(800 + v * 5200); return f < 1000 ? `${f}Hz` : `${(f / 1000).toFixed(1)}k`; };
const fmtDb     = v => { const g = (v - 0.5) * 22; return g >= 0 ? `+${g.toFixed(0)}dB` : `${g.toFixed(0)}dB`; };

// ─── Main component ───────────────────────────────────────────────────────────
export default function SpringPhysicsOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const [decay,    setDecay   ] = useState(initialState?.decay    ?? 0.38);
  const [length,   setLength  ] = useState(initialState?.length   ?? 0.35);
  const [damp,     setDamp    ] = useState(initialState?.damp     ?? 0.55);
  const [shape,    setShape   ] = useState(initialState?.shape    ?? 0.50);
  const [scatter,  setScatter ] = useState(initialState?.scatter  ?? 0.50);
  const [chaos,    setChaos   ] = useState(initialState?.chaos    ?? 0.15);
  const [tone,     setTone    ] = useState(initialState?.tone     ?? 0.5);
  const [width,    setWidth   ] = useState(initialState?.width    ?? 1.0);
  const [smooth,   setSmooth  ] = useState(initialState?.smooth   ?? 0.50);
  const [mix,      setMix     ] = useState(initialState?.mix      ?? 0.30);
  const [mode,     setMode    ] = useState(initialState?.mode     ?? 0);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);

  const [inLevel,  setInLevel ] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak  ] = useState(0);
  const [outPeak,  setOutPeak ] = useState(0);
  const [loading,  setLoading ] = useState(true);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  const stateRefs = {
    decay: useRef(decay), length: useRef(length), damp: useRef(damp),
    shape: useRef(shape), scatter: useRef(scatter), chaos: useRef(chaos),
    tone: useRef(tone), width: useRef(width), mix: useRef(mix),
    smooth: useRef(smooth), mode: useRef(mode), bypassed: useRef(bypassed),
  };
  stateRefs.decay.current    = decay;    stateRefs.length.current  = length;
  stateRefs.damp.current     = damp;     stateRefs.shape.current   = shape;
  stateRefs.scatter.current  = scatter;  stateRefs.chaos.current   = chaos;
  stateRefs.tone.current     = tone;     stateRefs.width.current   = width;
  stateRefs.smooth.current   = smooth;   stateRefs.mix.current     = mix;
  stateRefs.mode.current     = mode;     stateRefs.bypassed.current = bypassed;

  useEffect(() => {
    onStateChange?.(instanceId, { decay, length, damp, shape, scatter, chaos, tone, width, mix, mode, bypassed });
  }, [decay, length, damp, shape, scatter, chaos, tone, width, mix, bypassed]); // eslint-disable-line

  useEffect(() => {
    if (!sharedSource) return;
    let cancelled = false;
    createSpringPhysicsEngine(sharedSource.ctx).then(engine => {
      if (cancelled) { engine.destroy(); return; }
      engineRef.current = engine;
      const s = {
        decay:    stateRefs.decay.current,
        length:   stateRefs.length.current,
        damp:     stateRefs.damp.current,
        shape:    stateRefs.shape.current,
        scatter:  stateRefs.scatter.current,
        chaos:    stateRefs.chaos.current,
        tone:     stateRefs.tone.current,
        width:    stateRefs.width.current,
        smooth:   stateRefs.smooth?.current ?? 0.5,
        mix:      stateRefs.mix.current,
        mode:     stateRefs.mode.current,
        bypassed: stateRefs.bypassed.current,
      };
      engine.setDecay(s.decay);
      engine.setLength(s.length);
      engine.setDamp(s.damp);
      engine.setShape(s.shape);
      engine.setScatter(s.scatter);
      engine.setChaos(s.chaos);
      engine.setTone(s.tone);
      engine.setWidth(s.width);
      engine.setSmooth(s.smooth);
      engine.setMix(s.mix);
      engine.setMode(s.mode);
      engine.setBypass(s.bypassed);
      registerEngine(instanceId, engine);
      setLoading(false);

      let tick = 0;
      const loop = () => {
        animRef.current = requestAnimationFrame(loop);
        if (++tick % 2 !== 0) return;
        const e = engineRef.current; if (!e) return;
        setInLevel(e.getInputLevel());
        setOutLevel(e.getOutputLevel());
        setInPeak(e.getInputPeak());
        setOutPeak(e.getOutputPeak());
      };
      loop();
    }).catch(err => {
      console.error('Spring Reverb (physics) init failed:', err);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
      if (engineRef.current) {
        unregisterEngine(instanceId);
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [sharedSource]); // eslint-disable-line

  useEffect(() => { engineRef.current?.setDecay(decay);     }, [decay]);
  useEffect(() => { engineRef.current?.setLength(length);   }, [length]);
  useEffect(() => { engineRef.current?.setDamp(damp);       }, [damp]);
  useEffect(() => { engineRef.current?.setShape(shape);     }, [shape]);
  useEffect(() => { engineRef.current?.setScatter(scatter); }, [scatter]);
  useEffect(() => { engineRef.current?.setChaos(chaos);     }, [chaos]);
  useEffect(() => { engineRef.current?.setTone(tone);       }, [tone]);
  useEffect(() => { engineRef.current?.setWidth(width);     }, [width]);
  useEffect(() => { engineRef.current?.setSmooth(smooth);   }, [smooth]);
  useEffect(() => { engineRef.current?.setMix(mix);         }, [mix]);
  useEffect(() => { engineRef.current?.setMode(mode);       }, [mode]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); }, [bypassed]);

  const isB = mode === 1;

  // Theme: A = warm amber, B = electric violet
  const accent     = isB ? 'hsl(275,80%,65%)' : 'hsl(40,85%,58%)';
  const accentDim  = isB ? 'hsl(275,50%,40%)' : 'hsl(40,55%,38%)';
  const coilAccent = isB ? 'hsl(275,65%,52%)' : 'hsl(36,55%,42%)';
  const titleSub   = 'REVERB TANK';

  return (
    <div style={{
      width: 380,
      height: 500,
      background: '#0e0e0e',
      borderRadius: 8,
      overflow: 'hidden',
      fontFamily: 'sans-serif',
      userSelect: 'none',
      boxShadow: `0 6px 40px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.06)`,
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 9px',
        borderBottom: `1px solid ${accentDim}44`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0) 100%)`,
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
            color: accent, fontFamily: 'Georgia, serif', fontStyle: 'italic',
            textShadow: `0 0 18px ${accent}88`,
            transition: 'color 0.3s, text-shadow 0.3s',
          }}>Spring</span>
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.30em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)',
            transition: 'color 0.3s',
          }}>{titleSub}</span>
          {loading && (
            <span style={{ fontSize: 7, color: accent, opacity: 0.7, letterSpacing: '0.12em' }}>LOADING…</span>
          )}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* A / B */}
          {[0, 1].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontSize: 8, fontWeight: 900, width: 24, height: 18,
              borderRadius: 3, cursor: 'pointer', letterSpacing: '0.08em', border: 'none',
              background: mode === m ? (m === 0 ? 'hsl(40,55%,28%)' : 'hsl(270,45%,28%)') : 'rgba(255,255,255,0.05)',
              color:      mode === m ? accent : 'rgba(255,255,255,0.25)',
              boxShadow:  mode === m ? `0 0 8px ${accent}55` : 'none',
              outline:    mode === m ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.07)',
              transition: 'all 0.15s',
            }}>{m === 0 ? 'A' : 'B'}</button>
          ))}
          {/* Bypass dot */}
          <button onClick={() => setBypassed(b => !b)} title="Bypass" style={{
            width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', border: 'none',
            background: bypassed ? 'rgba(255,255,255,0.05)' : accentDim,
            boxShadow:  bypassed ? 'none' : `0 0 7px ${accent}66`,
            transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: bypassed ? 'rgba(255,255,255,0.15)' : accent,
            }} />
          </button>
          {onRemove && (
            <button onClick={onRemove} style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.25)', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          )}
        </div>
      </div>

      {/* ── LED Meters (like Selector) ── */}
      <div style={{
        padding: '8px 12px 6px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <LedMeter label="Input"  level={inLevel  * 5} peak={inPeak  * 5} accent={accent} />
        <LedMeter label="Output" level={outLevel * 5} peak={outPeak * 5} accent={accent} />
      </div>

      {/* ── Body: knob rows + coil column ── */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>

        {/* Left: both knob rows stacked */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

          {/* Main knobs row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 14,
            padding: '14px 20px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(0,0,0,0.18)',
          }}>
            <SelectorKnob label="Decay"  value={decay}  onChange={setDecay}  min={0} max={1} defaultValue={0.38} size={28} accent={accent} format={fmtDecay} />
            <SelectorKnob label="Length" value={length} onChange={setLength} min={0} max={1} defaultValue={0.35} size={28} accent={accent} format={fmtLen}   />
            <SelectorKnob label="Damp"   value={damp}   onChange={setDamp}   min={0} max={1} defaultValue={0.55} size={28} accent={accent} format={fmtDamp}  />
            <SelectorKnob label="LFO"    value={chaos}  onChange={setChaos}  min={0} max={1} defaultValue={0.15} size={28} accent={accent} format={fmtPct}   />
            <SelectorKnob label="Mix"    value={mix}    onChange={setMix}    min={0} max={1} defaultValue={0.30} size={28} accent={accent} format={fmtPct}   />
          </div>

          {/* ── Secondary row: B-mode params + WIDTH + TONE ── */}
          <div style={{
            display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', gap: 14,
            padding: '10px 20px 14px',
            background: 'rgba(255,255,255,0.01)',
          }}>
            {/* SHAPE / SCATTER — dimmed in A mode */}
            <div style={{
              display: 'flex', gap: 8,
              opacity: isB ? 1 : 0.20, pointerEvents: isB ? 'auto' : 'none',
              transition: 'opacity 0.25s',
            }}>
              <SelectorKnob label="Shape"   value={shape}   onChange={setShape}   min={0} max={1} defaultValue={0.5}  size={28} accent={accent} format={fmtPct} />
              <SelectorKnob label="Scatter" value={scatter} onChange={setScatter} min={0} max={1} defaultValue={0.5}  size={28} accent={accent} format={fmtPct} />
            </div>
            <SelectorKnob label="Smooth" value={smooth} onChange={setSmooth} min={0} max={1} defaultValue={0.5} size={28} accent={accent} format={fmtPct} />
            <SelectorKnob label="Width"  value={width}  onChange={setWidth}  min={0} max={1} defaultValue={1.0} size={28} accent={accent} format={fmtPct} />
            <SelectorKnob label="Tone"   value={tone}   onChange={setTone}   min={0} max={1} defaultValue={0.5} size={28} accent={accent} format={fmtDb}  />
          </div>

        </div>{/* end left knob column */}

        {/* Right: spring coil — spans full height of both rows */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '10px 12px',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
        }}>
          <SpringCoilSVG width={20} height={130} accent={coilAccent} level={outLevel} />
        </div>

      </div>{/* end body flex */}

    </div>
  );
}
