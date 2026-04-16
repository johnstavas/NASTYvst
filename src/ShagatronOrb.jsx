import { useState, useEffect, useRef, useCallback } from 'react';
import { createShagatronEngine } from './shagatronEngine';
import PresetSelector from './PresetSelector';

// ─── Sebatron-style Bakelite Knob — glossy black with white pointer ──────────
// Matches the VMP Quad Plus: large smooth black knobs, white indicator line,
// subtle top-left highlight, heavy drop shadow on cream faceplate.
function BakeliteKnob({ size = 44, norm = 0 }) {
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 2;
  const id = useRef(`sg-${Math.random().toString(36).slice(2, 7)}`).current;
  const sweep = 270;
  const startDeg = -135;
  const angle = startDeg + norm * sweep;
  const toRad = d => (d - 90) * Math.PI / 180;
  const lineAngle = toRad(angle);
  const lx1 = cx + r * 0.15 * Math.cos(lineAngle);
  const ly1 = cy + r * 0.15 * Math.sin(lineAngle);
  const lx2 = cx + r * 0.82 * Math.cos(lineAngle);
  const ly2 = cy + r * 0.82 * Math.sin(lineAngle);

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="28%" r="75%">
          <stop offset="0%"   stopColor="#4a4a4a" />
          <stop offset="30%"  stopColor="#2a2a2a" />
          <stop offset="65%"  stopColor="#111111" />
          <stop offset="100%" stopColor="#000000" />
        </radialGradient>
        <radialGradient id={`${id}-hi`} cx="32%" cy="22%" r="50%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.35)" />
          <stop offset="50%"  stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.6)" />
        </filter>
      </defs>
      {/* Knob body */}
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-body)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="none" stroke="rgba(80,80,80,0.25)" strokeWidth={0.8} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-hi)`} />
      {/* White pointer line */}
      <line x1={lx1 + 4} y1={ly1 + 4} x2={lx2 + 4} y2={ly2 + 4}
        stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

// ─── Knob wrapper (drag interaction + label) ─────────────────────────────────
function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / 160)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 16 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <BakeliteKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1a1a2a', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1.2, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 5.5, color: 'rgba(30,30,50,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Simple VU meter (dark inset on cream) ───────────────────────────────────
function VuMeter({ level }) {
  const norm = Math.min(1, Math.max(0, level * 1.5));
  const angle = -45 + norm * 90;
  const W = 55, H = 30;
  const cx = W / 2, cy = H - 2;
  const r = 24;
  const rad = (angle - 90) * Math.PI / 180;
  const nx = cx + Math.cos(rad) * r;
  const ny = cy + Math.sin(rad) * r;
  const col = norm > 0.85 ? '#cc3020' : norm > 0.6 ? '#c08020' : '#4a7030';
  return (
    <svg width={W} height={H} style={{ background: '#f0ece0', border: '1.5px solid #1a1a2a', borderRadius: 2, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.25)' }}>
      <path d={`M ${cx + Math.cos((-45 - 90) * Math.PI / 180) * r} ${cy + Math.sin((-45 - 90) * Math.PI / 180) * r} A ${r} ${r} 0 0 1 ${cx + Math.cos((45 - 90) * Math.PI / 180) * r} ${cy + Math.sin((45 - 90) * Math.PI / 180) * r}`}
        fill="none" stroke="rgba(30,30,50,0.3)" strokeWidth={1} />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={1.8} fill="#333" />
    </svg>
  );
}

// ─── LED Bar Meter (dark inset) ──────────────────────────────────────────────
function LedMeter({ level, label }) {
  const segments = 20;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 60, background: '#1a1a2a', padding: '3px 2px', borderRadius: 2, border: '1px solid rgba(0,0,0,0.3)' }}>
        {Array.from({ length: segments }).map((_, i) => {
          const threshDb = -40 + (i / segments) * 46;
          const lit = dB > threshDb;
          const col = i >= segments - 3 ? '#cc3020' : i >= segments - 6 ? '#c08020' : '#4a7030';
          return <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: lit ? col : 'rgba(100,100,120,0.12)' }} />;
        })}
      </div>
      {label && <span style={{ fontSize: 5, color: 'rgba(30,30,50,0.5)', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>}
    </div>
  );
}

// ─── Mode Switch (3-way: SMOOTH / THICK / ANGRY) ────────────────────────────
function ModeSwitch({ mode, onChange }) {
  const labels = ['SMOOTH', 'THICK', 'ANGRY'];
  return (
    <div style={{ display: 'flex', gap: 3, userSelect: 'none' }}>
      {labels.map((l, i) => (
        <button key={l} onClick={() => onChange(i)} style={{
          fontSize: 6.5, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          letterSpacing: '0.08em',
          padding: '3px 8px', borderRadius: 2,
          background: mode === i ? '#1a1a2a' : 'transparent',
          color: mode === i ? '#f0ece0' : 'rgba(30,30,50,0.4)',
          border: `1.5px solid ${mode === i ? '#1a1a2a' : 'rgba(30,30,50,0.2)'}`,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}>{l}</button>
      ))}
    </div>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',       shag: 0.4, level: 0, weight: 0.3, bite: 0.2, tight: 0.2, hair: 0.1, air: 0,    smooth: 0,   mix: 1, mode: 1 },
  { name: 'WARM DI',    shag: 0.25, level: 0, weight: 0.45, bite: 0.1, tight: 0.1, hair: 0.05, air: 0.1, smooth: 0.35, mix: 0.8, mode: 0 },
  { name: 'FAT BOTTOM', shag: 0.35, level: 1, weight: 0.7, bite: 0.1, tight: 0.05, hair: 0.05, air: 0,   smooth: 0.2,  mix: 1, mode: 1 },
  { name: 'PUNCHY',     shag: 0.45, level: 0, weight: 0.2, bite: 0.5, tight: 0.45, hair: 0.15, air: 0.1, smooth: 0,   mix: 1, mode: 1 },
  { name: 'GROWL',      shag: 0.65, level: -2, weight: 0.3, bite: 0.6, tight: 0.35, hair: 0.5, air: 0.15, smooth: 0,   mix: 0.85, mode: 2 },
  { name: 'SVT GRIND',  shag: 0.7, level: -3, weight: 0.4, bite: 0.4, tight: 0.3, hair: 0.35, air: 0.2, smooth: 0.15, mix: 0.7, mode: 2 },
  { name: 'SUB CLEAN',  shag: 0.2, level: 2, weight: 0.6, bite: 0.05, tight: 0.1, hair: 0,   air: 0,   smooth: 0.4,  mix: 0.6, mode: 0 },
  { name: 'BRIGHT EDGE',shag: 0.5, level: -1, weight: 0.15, bite: 0.35, tight: 0.3, hair: 0.3, air: 0.45, smooth: 0,   mix: 0.9, mode: 1 },
];

// ─── Main Shagatron Orb ──────────────────────────────────────────────────────
export default function ShagatronOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  // Controls
  const [shag,    setShag]    = useState(initialState?.shag    ?? 0.4);
  const [level,   setLevel]   = useState(initialState?.level   ?? 0);
  const [weight,  setWeight]  = useState(initialState?.weight  ?? 0.3);
  const [bite,    setBite]    = useState(initialState?.bite    ?? 0.2);
  const [tight,   setTight]   = useState(initialState?.tight   ?? 0.2);
  const [hair,    setHair]    = useState(initialState?.hair    ?? 0.1);
  const [air,     setAir]     = useState(initialState?.air     ?? 0);
  const [smooth,  setSmooth]  = useState(initialState?.smooth  ?? 0);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 1);
  const [mode,    setMode]    = useState(initialState?.mode    ?? 1);  // default THICK
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? 'INIT');

  // Meters
  const [inPeak,  setInPeak]  = useState(0);
  const [outPeak, setOutPeak] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { shag, level, weight, bite, tight, hair, air, smooth, mix, mode, bypassed };

  // ── Engine init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createShagatronEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setShag(s.shag);
      eng.setLevel(s.level);
      eng.setWeight(s.weight);
      eng.setBite(s.bite);
      eng.setTight(s.tight);
      eng.setHair(s.hair);
      eng.setAir(s.air);
      eng.setSmooth(s.smooth);
      eng.setMix(s.mix);
      eng.setMode(s.mode);
      eng.setBypass(s.bypassed);
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

  // ── Meter RAF ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        setInPeak(engineRef.current.getInputPeak());
        setOutPeak(engineRef.current.getOutputPeak());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { shag, level, weight, bite, tight, hair, air, smooth, mix, mode, bypassed, preset: activePreset });
  }, [shag, level, weight, bite, tight, hair, air, smooth, mix, mode, bypassed, activePreset]);

  const resetAll = useCallback(() => {
    setShag(0.4); setLevel(0); setWeight(0.3); setBite(0.2);
    setTight(0.2); setHair(0.1); setAir(0); setSmooth(0); setMix(1); setMode(1); setBypassed(false);
    const e = engineRef.current;
    if (e) {
      e.setShag(0.4); e.setLevel(0); e.setWeight(0.3); e.setBite(0.2);
      e.setTight(0.2); e.setHair(0.1); e.setAir(0); e.setSmooth(0); e.setMix(1); e.setMode(1); e.setBypass(false);
    }
  }, []);

  const loadPreset = useCallback((preset) => {
    setShag(preset.shag); setLevel(preset.level); setWeight(preset.weight);
    setBite(preset.bite); setTight(preset.tight); setHair(preset.hair);
    setAir(preset.air); setSmooth(preset.smooth ?? 0); setMix(preset.mix); setMode(preset.mode);
    setActivePreset(preset.name);
    const e = engineRef.current;
    if (e) {
      e.setShag(preset.shag); e.setLevel(preset.level); e.setWeight(preset.weight);
      e.setBite(preset.bite); e.setTight(preset.tight); e.setHair(preset.hair);
      e.setAir(preset.air); e.setSmooth(preset.smooth ?? 0); e.setMix(preset.mix); e.setMode(preset.mode);
    }
  }, []);

  // Format helpers
  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt  = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`;
  const shagFmt = v => `${(v * 10).toFixed(1)}`;

  // Cream faceplate panel style
  const panel = {
    borderBottom: '1px solid rgba(0,0,0,0.08)',
    padding: '6px 10px',
  };

  return (
    <div style={{
      width: 380,
      height: 500,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 6,
      overflow: 'hidden',
      // Black rack frame
      background: '#0a0a10',
      border: '2px solid #1a1a2a',
      boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Top rack ear */}
      <div style={{ flexShrink: 0, height: 8, background: 'linear-gradient(180deg, #1a1a22 0%, #0e0e14 100%)', borderBottom: '1px solid rgba(255,255,255,0.04)' }} />

      {/* Cream faceplate — the whole inner panel */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        margin: '0 6px',
        background: 'linear-gradient(180deg, #f4f0e4 0%, #ede8d8 30%, #e8e2d2 60%, #e2dccc 100%)',
        borderLeft: '1px solid rgba(0,0,0,0.12)',
        borderRight: '1px solid rgba(0,0,0,0.12)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
        position: 'relative',
      }}>
        {/* Rack screw holes — top corners */}
        {[10, null].map((left, i) => (
          <div key={i} style={{
            position: 'absolute', top: 6,
            [i === 0 ? 'left' : 'right']: 6,
            width: 7, height: 7, borderRadius: '50%',
            background: 'conic-gradient(from 45deg, #bbb 0%, #eee 25%, #999 50%, #ddd 75%, #bbb 100%)',
            boxShadow: 'inset 0 0 1px rgba(0,0,0,0.3), 0 0.5px 1px rgba(0,0,0,0.15)',
          }}>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%) rotate(30deg)', width: 4, height: 0.8, background: 'rgba(0,0,0,0.2)', borderRadius: 1 }} />
          </div>
        ))}
        {/* Header */}
        <div style={{
          ...panel,
          flexShrink: 0,
          padding: '8px 12px 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1.5px solid rgba(30,30,50,0.12)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontSize: 14, fontWeight: 900, color: '#1a1a2a',
                letterSpacing: '0.08em',
                fontStyle: 'italic',
              }}>Shagatron</span>
              <span style={{
                fontSize: 7, fontWeight: 600, color: 'rgba(30,30,50,0.35)',
                letterSpacing: '0.2em',
              }}>VMP</span>
            </div>
            <span style={{
              fontSize: 5.5, fontWeight: 600, color: 'rgba(30,30,50,0.35)',
              letterSpacing: '0.35em', marginTop: 2,
            }}>BASS TONE SHAPER · CLASS A</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} />
            {loading && <span style={{ fontSize: 6, color: '#888' }}>…</span>}
            {/* Jewel pilot light — chrome bezel, red gem */}
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: 'conic-gradient(from 135deg, #999 0%, #eee 25%, #666 50%, #ddd 75%, #999 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            }}>
              <div style={{
                width: 9, height: 9, borderRadius: '50%',
                background: bypassed
                  ? 'radial-gradient(circle at 35% 30%, #6a4040 0%, #3a1515 60%, #1a0808 100%)'
                  : 'radial-gradient(circle at 35% 30%, #ff6050 0%, #cc2015 50%, #801008 100%)',
                boxShadow: bypassed
                  ? 'inset 0 1px 2px rgba(255,255,255,0.1)'
                  : 'inset 0 1px 2px rgba(255,255,255,0.3), 0 0 6px rgba(204,32,21,0.7), 0 0 12px rgba(204,32,21,0.3)',
                border: '0.5px solid rgba(0,0,0,0.3)',
              }} />
            </div>
            {/* Reset */}
            <span onClick={resetAll} style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(30,30,50,0.3)' }} title="Reset">↻</span>
            {onRemove && <span onClick={onRemove} style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(30,30,50,0.25)' }} title="Remove">×</span>}
          </div>
        </div>

        {/* Mode selector */}
        <div style={{ ...panel, flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '5px 10px' }}>
          <ModeSwitch mode={mode} onChange={m => { setMode(m); engineRef.current?.setMode(m); setActivePreset(null); }} />
        </div>

        {/* Main row: SHAG (big) + meters + LEVEL (big) */}
        <div style={{ ...panel, flex: 1, minHeight: 0, padding: '8px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Knob label="SHAG" value={shag} min={0} max={1} defaultValue={0.4}
              onChange={v => { setShag(v); engineRef.current?.setShag(v); setActivePreset(null); }}
              size={38} format={shagFmt} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <LedMeter level={inPeak} label="IN" />
                <VuMeter level={outPeak} />
                <LedMeter level={outPeak} label="OUT" />
              </div>
            </div>
            <Knob label="LEVEL" value={level} min={-12} max={12} defaultValue={0}
              onChange={v => { setLevel(v); engineRef.current?.setLevel(v); setActivePreset(null); }}
              size={38} format={dbFmt} />
          </div>
        </div>

        {/* Tone knobs row: WEIGHT · BITE · TIGHT · HAIR */}
        <div style={{ ...panel, flexShrink: 0, padding: '6px 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start' }}>
            <Knob label="WEIGHT" value={weight} min={0} max={1} defaultValue={0.3}
              onChange={v => { setWeight(v); engineRef.current?.setWeight(v); setActivePreset(null); }}
              size={28} format={pctFmt} />
            <Knob label="BITE" value={bite} min={0} max={1} defaultValue={0.2}
              onChange={v => { setBite(v); engineRef.current?.setBite(v); setActivePreset(null); }}
              size={28} format={pctFmt} />
            <Knob label="TIGHT" value={tight} min={0} max={1} defaultValue={0.2}
              onChange={v => { setTight(v); engineRef.current?.setTight(v); setActivePreset(null); }}
              size={28} format={pctFmt} />
            <Knob label="HAIR" value={hair} min={0} max={1} defaultValue={0.1}
              onChange={v => { setHair(v); engineRef.current?.setHair(v); setActivePreset(null); }}
              size={28} format={pctFmt} />
            <Knob label="AIR" value={air} min={0} max={1} defaultValue={0}
              onChange={v => { setAir(v); engineRef.current?.setAir(v); setActivePreset(null); }}
              size={28} format={pctFmt} />
            <Knob label="SMOOTH" value={smooth} min={0} max={1} defaultValue={0}
              onChange={v => { setSmooth(v); engineRef.current?.setSmooth(v); setActivePreset(null); }}
              size={28} format={pctFmt} />
          </div>
        </div>

        {/* Bottom row: MIX + BYPASS */}
        <div style={{ ...panel, flexShrink: 0, padding: '5px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'none' }}>
          <Knob label="MIX" value={mix} min={0} max={1} defaultValue={1}
            onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }}
            size={28} format={pctFmt} />
          <button onClick={() => {
            const n = !bypassed;
            setBypassed(n);
            engineRef.current?.setBypass(n);
          }} style={{
            fontSize: 7, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
            letterSpacing: '0.1em', padding: '4px 12px', borderRadius: 2,
            background: bypassed ? 'transparent' : '#1a1a2a',
            color: bypassed ? 'rgba(30,30,50,0.35)' : '#f0ece0',
            border: `1.5px solid ${bypassed ? 'rgba(30,30,50,0.2)' : '#1a1a2a'}`,
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</button>
        </div>
      </div>

      {/* Bottom rack ear */}
      <div style={{ flexShrink: 0, height: 8, background: 'linear-gradient(180deg, #0e0e14 0%, #1a1a22 100%)', borderTop: '1px solid rgba(255,255,255,0.04)' }} />
    </div>
  );
}
