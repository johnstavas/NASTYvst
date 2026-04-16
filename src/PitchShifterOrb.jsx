import { useState, useEffect, useRef, useCallback } from 'react';
import { createPitchShifterEngine } from './pitchShifterEngine';
import PresetSelector from './PresetSelector';

// ─── Minimal dark knob ──────────────────────────────────────────────────────
function PShiftKnob({ size = 40, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const id = useRef(`ps-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  const lx1 = cx + r * 0.15 * Math.cos(rad);
  const ly1 = cy + r * 0.15 * Math.sin(rad);
  const lx2 = cx + r * 0.82 * Math.cos(rad);
  const ly2 = cy + r * 0.82 * Math.sin(rad);

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-b`} cx="38%" cy="28%" r="75%">
          <stop offset="0%" stopColor="#555" />
          <stop offset="60%" stopColor="#222" />
          <stop offset="100%" stopColor="#111" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,0.5)" />
        </filter>
      </defs>
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-b)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.8} />
      <line x1={lx1 + 4} y1={ly1 + 4} x2={lx2 + 4} y2={ly2 + 4}
        stroke="#00ddff" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 40, format, step, sensitivity = 160 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => {
      let raw = ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity;
      if (step) raw = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, raw)));
    };
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 16 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <PShiftKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#00ddff', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1.2, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 5.5, color: 'rgba(0,221,255,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Vertical Slider ────────────────────────────────────────────────────────
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
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{ width: 10, height, background: '#060a0e', borderRadius: 2, border: '1px solid rgba(0,221,255,0.1)', position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        {/* Fill */}
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: 'rgba(0,221,255,0.25)', borderRadius: 1, transition: dragging ? 'none' : 'height 0.05s' }} />
        {/* Thumb */}
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: '#00ddff', bottom: `calc(${norm * 100}% - 2px)`, boxShadow: '0 0 4px rgba(0,221,255,0.4)' }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(0,221,255,0.35)', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(0,221,255,0.3)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── LED Bar Meter — imperative DOM updates, no React re-renders ────────────
const METER_SEGMENTS = 16;
function LedMeterDom({ label, meterRef }) {
  const containerRef = useRef(null);

  // Create segment elements once, update via ref
  useEffect(() => {
    if (containerRef.current) {
      meterRef.current = containerRef.current.children;
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: '#060a0e', padding: '3px 2px', borderRadius: 2, border: '1px solid rgba(0,221,255,0.1)' }}>
        {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
          <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: 'rgba(0,221,255,0.06)' }} />
        ))}
      </div>
      {label && <span style={{ fontSize: 5, color: 'rgba(0,221,255,0.35)', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: 'rgba(0,221,255,0.5)', letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block' }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

// Updates meter segments + dB readout directly via DOM — no setState
function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff3030' : i >= METER_SEGMENTS - 4 ? '#ffaa20' : '#00ddff';
    segmentEls[i].style.background = lit ? col : 'rgba(0,221,255,0.06)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-∞';
    const color = dbVal > -1 ? '#ff3030' : dbVal > -6 ? '#ffaa20' : 'rgba(0,221,255,0.5)';
    dbEl.style.color = color;
    dbEl.firstChild.textContent = display;
  }
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',       pitch: 0,   mix: 1,   grain: 0.5, time: 0,   lofi: 0,   drive: 0,   tone: 1 },
  { name: 'OCT DOWN',   pitch: -12, mix: 1,   grain: 0.7, time: 0.15,lofi: 0.2, drive: 0.15,tone: 0.7 },
  { name: 'OCT UP',     pitch: 12,  mix: 1,   grain: 0.6, time: 0.1, lofi: 0.15,drive: 0.1, tone: 0.75 },
  { name: 'MPC CHOP',   pitch: -5,  mix: 1,   grain: 0.3, time: 0.3, lofi: 0.5, drive: 0.35,tone: 0.6 },
  { name: 'SP-1200',    pitch: -7,  mix: 1,   grain: 0.4, time: 0.4, lofi: 0.7, drive: 0.4, tone: 0.5 },
  { name: 'DETUNE',     pitch: -0.3,mix: 0.4, grain: 0.3, time: 0,   lofi: 0,   drive: 0.1, tone: 1 },
  { name: 'THICK',      pitch: -0.15,mix: 0.5, grain: 0.8, time: 0.05,lofi: 0.1, drive: 0.25,tone: 0.85 },
  { name: 'DUSTY',      pitch: 0,   mix: 1,   grain: 0.5, time: 0.5, lofi: 0.6, drive: 0.5, tone: 0.4 },
];

const PRESET_COLORS = {
  bg: '#0c1a22', text: '#00ddff', textDim: 'rgba(0,221,255,0.45)',
  border: 'rgba(0,221,255,0.15)', hoverBg: 'rgba(0,221,255,0.12)', activeBg: 'rgba(0,221,255,0.08)',
};

// ─── Main PitchShifter Orb ──────────────────────────────────────────────────
export default function PitchShifterOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [pitch,   setPitch]   = useState(initialState?.pitch   ?? 0);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 1);
  const [grain,   setGrain]   = useState(initialState?.grain   ?? 0.5);
  const [time,    setTime]    = useState(initialState?.time    ?? 0);
  const [lofi,    setLofi]    = useState(initialState?.lofi    ?? 0);
  const [drive,   setDrive]   = useState(initialState?.drive   ?? 0);
  const [tone,    setTone]    = useState(initialState?.tone    ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);

  // Meter refs — direct DOM, no re-renders
  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, pitch, mix, grain, time, lofi, drive, tone, bypassed };

  // ── Engine init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createPitchShifterEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setPitch(s.pitch);
      eng.setMix(s.mix);
      eng.setGrain(s.grain);
      eng.setTime(s.time);
      eng.setLofi(s.lofi);
      eng.setDrive(s.drive);
      eng.setTone(s.tone);
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

  // ── Meter RAF — direct DOM updates, never triggers React re-render ────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, pitch, mix, grain, time, lofi, drive, tone, bypassed, preset: activePreset });
  }, [inputGain, outputGain, pitch, mix, grain, time, lofi, drive, tone, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setPitch(p.pitch); setMix(p.mix); setGrain(p.grain); setTime(p.time ?? 0); setLofi(p.lofi ?? 0); setDrive(p.drive ?? 0); setTone(p.tone);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setPitch(p.pitch); e.setMix(p.mix); e.setGrain(p.grain); e.setTime(p.time ?? 0); e.setLofi(p.lofi ?? 0); e.setDrive(p.drive ?? 0); e.setTone(p.tone); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const stFmt  = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}st`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, overflow: 'hidden',
      background: '#0a0e12',
      border: '1.5px solid rgba(0,221,255,0.15)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(0,221,255,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,221,255,0.1)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: '#00ddff', letterSpacing: '0.06em' }}>Poly Pitch</span>
          <span style={{ fontSize: 6, fontWeight: 600, color: 'rgba(0,221,255,0.3)', letterSpacing: '0.3em', marginTop: 2 }}>GRANULAR · LO-FI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: '#00ddff55' }}>…</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(0,221,255,0.25)' }} title="Remove">×</span>}
        </div>
      </div>

      {/* PITCH knob + meters + gain sliders */}
      <div style={{ padding: '8px 8px 6px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(0,221,255,0.07)' }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }}
          format={v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'; }} />
        <LedMeterDom meterRef={inMeterRef} />
        <Knob label="PITCH" value={pitch} min={-12} max={12} defaultValue={0}
          onChange={v => { setPitch(v); engineRef.current?.setPitch(v); setActivePreset(null); }}
          size={28} format={stFmt} step={0.1} sensitivity={300} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }}
          format={v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'; }} />
      </div>

      {/* Knobs row */}
      <div style={{ padding: '6px 4px', display: 'flex', justifyContent: 'space-around', borderBottom: '1px solid rgba(0,221,255,0.07)' }}>
        <Knob label="GRAIN" value={grain} min={0} max={1} defaultValue={0.5}
          onChange={v => { setGrain(v); engineRef.current?.setGrain(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="DELAY" value={time} min={0} max={1} defaultValue={0}
          onChange={v => { setTime(v); engineRef.current?.setTime(v); setActivePreset(null); }}
          size={28} format={v => v < 0.01 ? '0ms' : `${Math.round(64 / 48 + v * 500)}ms`} />
        <Knob label="LOFI" value={lofi} min={0} max={1} defaultValue={0}
          onChange={v => { setLofi(v); engineRef.current?.setLofi(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="DRIVE" value={drive} min={0} max={1} defaultValue={0}
          onChange={v => { setDrive(v); engineRef.current?.setDrive(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="TONE" value={tone} min={0} max={1} defaultValue={1}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={1}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
      </div>

      {/* Bypass */}
      <div style={{ padding: '5px 12px', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          fontSize: 7, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 2,
          background: bypassed ? 'transparent' : '#00ddff',
          color: bypassed ? 'rgba(0,221,255,0.3)' : '#0a0e12',
          border: `1.5px solid ${bypassed ? 'rgba(0,221,255,0.15)' : '#00ddff'}`,
          cursor: 'pointer', transition: 'all 0.15s ease',
        }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</button>
      </div>
    </div>
  );
}
