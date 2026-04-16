import { useState, useEffect, useRef } from 'react';
import { createTapeDelayEngine } from './tapeDelayEngine';

// ─── Chrome Knob ──────────────────────────────────────────────────────────────
function ChromeKnob({ size = 28, norm = 0 }) {
  const id  = useRef(`ck-${Math.random().toString(36).slice(2,7)}`).current;
  const cx = size / 2, cy = size / 2;
  const r  = size / 2 - 2;
  const startDeg = -135, endDeg = startDeg + norm * 270;
  const toRad = d => (d - 90) * Math.PI / 180;
  const arcX  = (rd, d) => (cx + rd * Math.cos(toRad(d))).toFixed(2);
  const arcY  = (rd, d) => (cy + rd * Math.sin(toRad(d))).toFixed(2);
  const largeArc = norm * 270 > 180 ? 1 : 0;
  const lineAngle = toRad(endDeg);
  const lx1 = (cx + r * 0.25 * Math.cos(lineAngle)).toFixed(2);
  const ly1 = (cy + r * 0.25 * Math.sin(lineAngle)).toFixed(2);
  const lx2 = (cx + r * 0.82 * Math.cos(lineAngle)).toFixed(2);
  const ly2 = (cy + r * 0.82 * Math.sin(lineAngle)).toFixed(2);
  const arcR = r + 3;
  const trackPath = `M ${arcX(arcR,startDeg)} ${arcY(arcR,startDeg)} A ${arcR} ${arcR} 0 1 1 ${arcX(arcR,startDeg+269.9)} ${arcY(arcR,startDeg+269.9)}`;
  const valPath   = norm > 0.001 ? `M ${arcX(arcR,startDeg)} ${arcY(arcR,startDeg)} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcX(arcR,endDeg)} ${arcY(arcR,endDeg)}` : null;

  return (
    <svg width={size+8} height={size+8} style={{ display:'block', overflow:'visible', margin:'-4px', pointerEvents:'none' }}>
      <defs>
        <radialGradient id={`${id}-rg`} cx="40%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#e8e8e0" />
          <stop offset="40%"  stopColor="#b0b0a8" />
          <stop offset="75%"  stopColor="#787870" />
          <stop offset="100%" stopColor="#404040" />
        </radialGradient>
        <radialGradient id={`${id}-hi`} cx="35%" cy="25%" r="50%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.55)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}><feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.7)" /></filter>
      </defs>
      {/* Track arc */}
      <path d={trackPath} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={2.5} strokeLinecap="round" transform="translate(4,4)" />
      {valPath && <path d={valPath} fill="none" stroke="#c8a84a" strokeWidth={2.5} strokeLinecap="round" opacity={0.9} transform="translate(4,4)" />}
      {/* Knob body */}
      <circle cx={cx+4} cy={cy+4} r={r} fill={`url(#${id}-rg)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx+4} cy={cy+4} r={r}   fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      <circle cx={cx+4} cy={cy+4} r={r-2} fill="none" stroke="rgba(0,0,0,0.25)"       strokeWidth={1} />
      {/* Highlight */}
      <circle cx={cx+4} cy={cy+4} r={r} fill={`url(#${id}-hi)`} />
      {/* Pointer line */}
      <line x1={+lx1+4} y1={+ly1+4} x2={+lx2+4} y2={+ly2+4} stroke="rgba(30,30,20,0.9)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

// ─── Knob wrapper ─────────────────────────────────────────────────────────────
function Knob({ label, value, onChange, min=0, max=1, defaultValue, size=28, format, hideValue }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y:0, v:0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max-min) / 160)));
    const onUp   = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, userSelect:'none', width: size + 16 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min+max)/2)} style={{ width:size+8, height:size+8, cursor: dragging?'grabbing':'grab' }}>
        <ChromeKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize:6.5, letterSpacing:'0.10em', textTransform:'uppercase', color:'rgba(210,230,170,0.85)', fontWeight:800, fontFamily:'sans-serif', textAlign:'center', width:'100%', lineHeight:1.2 }}>{label}</span>
      {!hideValue && <span style={{ fontSize:5.5, color:'rgba(180,220,140,0.55)', fontFamily:'"Courier New",monospace', fontWeight:700, textAlign:'center', width:'100%', overflow:'hidden', display:'block' }}>{display}</span>}
    </div>
  );
}

// ─── VU Meter ─────────────────────────────────────────────────────────────────
function VuMeter({ level }) {
  const norm   = Math.min(1, Math.max(0, level * 1.5));
  const angle  = -50 + norm * 100;
  const cx = 28, cy = 32, r = 22;
  const toRad  = d => d * Math.PI / 180;
  const nx = (cx + r * Math.sin(toRad(angle))).toFixed(1);
  const ny = (cy - r * Math.cos(toRad(angle))).toFixed(1);
  // Color shifts green → amber → red as needle pushes right
  const needleColor = norm < 0.6 ? '#44ee44' : norm < 0.85 ? '#ffaa00' : '#ff3322';
  const glowColor   = norm < 0.6 ? '#44ee4466' : norm < 0.85 ? '#ffaa0066' : '#ff332266';
  const ticks = [-50, -30, -10, 10, 30, 50];
  return (
    <svg width={56} height={44} style={{ display:'block' }}>
      <defs>
        <radialGradient id="vu-bg" cx="50%" cy="80%" r="70%">
          <stop offset="0%"   stopColor="#f0e8c0" />
          <stop offset="100%" stopColor="#d4c890" />
        </radialGradient>
      </defs>
      <rect x={1} y={1} width={54} height={42} rx={3} fill="url(#vu-bg)" stroke="#8a7850" strokeWidth={1} />
      {/* Red zone arc */}
      <path d={`M ${(cx+(r-2)*Math.sin(toRad(20))).toFixed(1)} ${(cy-(r-2)*Math.cos(toRad(20))).toFixed(1)} A ${r-2} ${r-2} 0 0 1 ${(cx+(r-2)*Math.sin(toRad(50))).toFixed(1)} ${(cy-(r-2)*Math.cos(toRad(50))).toFixed(1)}`}
        fill="none" stroke="#dd220044" strokeWidth={5} />
      {/* Scale ticks */}
      {ticks.map((a, i) => {
        const ra = toRad(a), long = i % 2 === 0;
        const x1 = (cx+(r-1)*Math.sin(ra)).toFixed(1), y1 = (cy-(r-1)*Math.cos(ra)).toFixed(1);
        const x2 = (cx+(r-(long?7:3))*Math.sin(ra)).toFixed(1), y2 = (cy-(r-(long?7:3))*Math.cos(ra)).toFixed(1);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={a > 20 ? '#cc2200' : '#555'} strokeWidth={1} />;
      })}
      <text x={cx} y={cy+9} textAnchor="middle" fontSize={5.5} fontWeight={900} fill="#666" fontFamily="sans-serif" letterSpacing="1">VU</text>
      {/* Needle glow */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={glowColor} strokeWidth={4} strokeLinecap="round" />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2.5} fill="#333" />
    </svg>
  );
}

// ─── LED Bar Meter ────────────────────────────────────────────────────────────
function LedMeter({ level, label }) {
  // Convert RMS to dB
  const db = level > 0.00001 ? 20 * Math.log10(level) + 2 : -60;
  const clampedDb = Math.max(-48, Math.min(6, db));
  // Map -48..+6 dB to 0..1
  const norm = (clampedDb + 48) / 54;

  const totalSegs = 28;
  const litSegs = Math.round(norm * totalSegs);

  const segColor = (i) => {
    const segDb = -48 + (i / totalSegs) * 54;
    if (segDb >= 0)   return i < litSegs ? '#ff3322' : '#3a1008';
    if (segDb >= -6)  return i < litSegs ? '#ffaa00' : '#2a2000';
    return i < litSegs ? '#44ee44' : '#0a2008';
  };

  const dbText = clampedDb <= -47 ? '-∞' : (clampedDb >= 0 ? `+${clampedDb.toFixed(1)}` : clampedDb.toFixed(1)) + ' dBFS';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <span style={{ fontSize:6.5, letterSpacing:'0.16em', color:'rgba(180,220,140,0.6)', fontWeight:700 }}>{label}</span>
        <span style={{ fontSize:8, fontFamily:'"Courier New",monospace', fontWeight:900, color: clampedDb >= 0 ? '#ff5533' : clampedDb >= -6 ? '#ffaa00' : '#44ee44', minWidth:52, textAlign:'right' }}>{dbText}</span>
      </div>
      <div style={{ display:'flex', gap:1.5 }}>
        {Array.from({ length: totalSegs }, (_, i) => (
          <div key={i} style={{ flex:1, height:8, borderRadius:1, background: segColor(i), boxShadow: i < litSegs ? `0 0 3px ${segColor(i)}88` : 'none', transition:'background 0.04s' }} />
        ))}
      </div>
    </div>
  );
}

// ─── Tape Reel ────────────────────────────────────────────────────────────────
function TapeReel({ level, size=56 }) {
  const angle = useRef(0);
  const [rot, setRot] = useState(0);
  useEffect(() => {
    let raf;
    const tick = () => { angle.current += 0.4 + level * 5; setRot(angle.current % 360); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  const cx=size/2, cy=size/2, R=size/2-3, ri=R*0.26, spokes=6;
  return (
    <svg width={size} height={size}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={R}      fill="#222" stroke="#555" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={R-3}    fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle cx={cx} cy={cy} r={R*0.48} fill="#1a1a1a" stroke="#444" strokeWidth={1.5} />
      {/* Spokes */}
      <g transform={`rotate(${rot},${cx},${cy})`}>
        {Array.from({length:spokes},(_,i)=>{
          const a=(i/spokes)*Math.PI*2;
          return <line key={i} x1={(cx+ri*Math.cos(a)).toFixed(1)} y1={(cy+ri*Math.sin(a)).toFixed(1)} x2={(cx+R*0.44*Math.cos(a)).toFixed(1)} y2={(cy+R*0.44*Math.sin(a)).toFixed(1)} stroke="#888" strokeWidth={2.5} strokeLinecap="round" />;
        })}
      </g>
      <circle cx={cx} cy={cy} r={ri}   fill="#2a2a2a" stroke="#666" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={4}    fill="#aaa" />
      <circle cx={cx} cy={cy} r={2}    fill="#333" />
    </svg>
  );
}

// ─── Head Button ──────────────────────────────────────────────────────────────
function HeadBtn({ n, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      width:52, padding:'5px 0', borderRadius:3, cursor:'pointer',
      border: on ? '1px solid #8a7a40' : '1px solid #3a3a30',
      background: on
        ? 'linear-gradient(180deg,#5a6a30 0%,#3a5020 100%)'
        : 'linear-gradient(180deg,#3a3a30 0%,#252520 100%)',
      boxShadow: on
        ? 'inset 0 1px 0 rgba(255,255,255,0.15), 0 0 8px #c8a84a33'
        : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      fontSize:7, fontWeight:900, letterSpacing:'0.16em',
      color: on ? '#e0d880' : '#555',
      transition:'all 0.12s',
    }}>HEAD {n}</button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TapeDelayOrb({ instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState }) {

  // repeatRate: 0 = slowest (longest delay), 1 = fastest (shortest delay)
  // Center (0.5) = ~300ms on head 1 — a natural medium echo
  // Mapped exponentially so sweep feels musical (octave-per-inch feel)
  const rateToTime = r => 0.04 * Math.pow(1.2 / 0.04, 1 - r); // 1.2s → 40ms exponential
  const [repeatRate, setRepeatRate] = useState(initialState?.repeatRate ?? 0.5);
  const [feedback,   setFeedback]   = useState(initialState?.feedback   ?? 0.42);
  const [wow,        setWow]        = useState(initialState?.wow        ?? 0.35);

  // Derive per-head times from master repeatRate
  // RE-201 head ratios: 1 : 1.8 : 2.7 (approximate tape head spacing)
  const time1 = rateToTime(repeatRate);
  const time2 = Math.min(1.2, time1 * 1.8);
  const time3 = Math.min(1.2, time1 * 2.7);
  const [treble,   setTreble]   = useState(initialState?.treble   ?? 0.5);
  const [bass,     setBass]     = useState(initialState?.bass     ?? 0.5);
  const [drive,    setDrive]    = useState(initialState?.drive    ?? 0.30);
  const [spread,   setSpread]   = useState(initialState?.spread   ?? 0.5);
  const [mix,      setMix]      = useState(initialState?.mix      ?? 0.45);
  const [head1,    setHead1]    = useState(initialState?.head1    ?? true);
  const [head2,    setHead2]    = useState(initialState?.head2    ?? false);
  const [head3,    setHead3]    = useState(initialState?.head3    ?? false);
  const [head1vol, setHead1vol] = useState(initialState?.head1vol ?? 0.75);
  const [head2vol, setHead2vol] = useState(initialState?.head2vol ?? 0.75);
  const [head3vol, setHead3vol] = useState(initialState?.head3vol ?? 0.75);
  const [analogMix,  setAnalogMix]  = useState(initialState?.analogMix  ?? 0.25);
  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 0.5);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 0.5);
  const [bypassed, setBypassed] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [inLevel,  setInLevel]  = useState(0);   // RMS — for VU needles
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak]   = useState(0);   // peak — for LED bars
  const [outPeak,  setOutPeak]  = useState(0);

  // ── Presets ──────────────────────────────────────────────────────────────────
  const PRESET_KEY = 'spaceEcho_presets';
  const [presetName,    setPresetName]    = useState('');
  const [presets,       setPresets]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || {}; } catch { return {}; }
  });
  const [selectedPreset, setSelectedPreset] = useState('');

  const getCurrentState = () => ({
    repeatRate, feedback, wow, treble, bass, drive, spread, mix,
    head1, head2, head3, head1vol, head2vol, head3vol,
    analogMix, inputGain, outputGain,
  });

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const updated = { ...presets, [name]: getCurrentState() };
    setPresets(updated);
    localStorage.setItem(PRESET_KEY, JSON.stringify(updated));
    setSelectedPreset(name);
    setPresetName('');
  };

  const loadPreset = (name) => {
    const p = presets[name];
    if (!p) return;
    const eng = engineRef.current;
    setSelectedPreset(name);
    setRepeatRate(p.repeatRate ?? 0.5);
    setFeedback(p.feedback ?? 0.42);   eng?.setFeedback(p.feedback ?? 0.42);
    setWow(p.wow ?? 0.35);             eng?.setWow(p.wow ?? 0.35);
    setTreble(p.treble ?? 0.5);        eng?.setTreble(p.treble ?? 0.5);
    setBass(p.bass ?? 0.5);            eng?.setBass(p.bass ?? 0.5);
    setDrive(p.drive ?? 0.3);          eng?.setDrive(p.drive ?? 0.3);
    setSpread(p.spread ?? 0.5);        eng?.setSpread(p.spread ?? 0.5);
    setMix(p.mix ?? 0.45);             eng?.setMix(p.mix ?? 0.45);
    setHead1(p.head1 ?? true);         eng?.setHead1(p.head1 ?? true);
    setHead2(p.head2 ?? false);        eng?.setHead2(p.head2 ?? false);
    setHead3(p.head3 ?? false);        eng?.setHead3(p.head3 ?? false);
    setHead1vol(p.head1vol ?? 0.75);   eng?.setHead1Vol(p.head1vol ?? 0.75);
    setHead2vol(p.head2vol ?? 0.75);   eng?.setHead2Vol(p.head2vol ?? 0.75);
    setHead3vol(p.head3vol ?? 0.75);   eng?.setHead3Vol(p.head3vol ?? 0.75);
    setAnalogMix(p.analogMix ?? 0.25); eng?.setAnalogMix(p.analogMix ?? 0.25);
    setInputGain(p.inputGain ?? 0.5);  eng?.setInputGain((p.inputGain ?? 0.5) * 2);
    setOutputGain(p.outputGain ?? 0.5); eng?.setOutputGain((p.outputGain ?? 0.5) * 2);
  };

  const deletePreset = (name) => {
    const updated = { ...presets };
    delete updated[name];
    setPresets(updated);
    localStorage.setItem(PRESET_KEY, JSON.stringify(updated));
    if (selectedPreset === name) setSelectedPreset('');
  };

  const engineRef = useRef(null);
  const stateRefs = useRef({});
  Object.assign(stateRefs.current, { time1, time2, time3, feedback, wow, treble, bass, drive, spread, mix, head1, head2, head3, head1vol, head2vol, head3vol, analogMix, inputGain, outputGain });

  // Push derived times to engine whenever repeatRate changes
  useEffect(() => {
    engineRef.current?.setTime1(time1);
    engineRef.current?.setTime2(time2);
    engineRef.current?.setTime3(time3);
  }, [time1, time2, time3]);

  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createTapeDelayEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setTime1(s.time1); eng.setTime2(s.time2); eng.setTime3(s.time3);
      eng.setFeedback(s.feedback); eng.setWow(s.wow);
      eng.setTreble(s.treble); eng.setBass(s.bass); eng.setDrive(s.drive);
      eng.setSpread(s.spread); eng.setMix(s.mix);
      eng.setHead1(s.head1); eng.setHead2(s.head2); eng.setHead3(s.head3);
      eng.setHead1Vol(s.head1vol ?? 0.75); eng.setHead2Vol(s.head2vol ?? 0.75); eng.setHead3Vol(s.head3vol ?? 0.75);
      eng.setAnalogMix(s.analogMix ?? 1.0);
      eng.setInputGain((s.inputGain ?? 0.5) * 2);
      eng.setOutputGain((s.outputGain ?? 0.5) * 2);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => {
      if (engineRef.current) {
        try { sharedSource.disconnect(engineRef.current.input); } catch {}
        engineRef.current.dispose();
        if (unregisterEngine) unregisterEngine(instanceId);
      }
    };
  }, [sharedSource]);

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        setInLevel(engineRef.current.getInputLevel());
        setOutLevel(engineRef.current.getOutputLevel());
        setInPeak(engineRef.current.getInputPeak());
        setOutPeak(engineRef.current.getOutputPeak());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => { engineRef.current?.setBypass(bypassed); }, [bypassed]);

  const bind = (setter, fn) => v => { setter(v); engineRef.current?.[fn]?.(v); };

  const fmtRate = v => `${Math.round(rateToTime(v) * 1000)}ms`;
  const fmtGain = v => `${Math.round(v * 200 - 100)}%`; // -100% to +100%, 0 at center
  const fmtPct  = v => `${Math.round(v * 100)}%`;
  const fmtDb   = v => { const g=(v-0.5)*16; return g>=0?`+${g.toFixed(0)}dB`:`${g.toFixed(0)}dB`; };

  // ms readouts for head buttons — derived from master rate
  const h1ms = `${Math.round(time1 * 1000)}`;
  const h2ms = `${Math.round(time2 * 1000)}`;
  const h3ms = `${Math.round(time3 * 1000)}`;

  // ── Space Echo color palette ──────────────────────────────────────────────────
  const acc      = '#c8a84a';                          // gold accent (knob arcs)
  const greenBg  = 'linear-gradient(180deg,#2e4a28 0%,#1e3418 100%)'; // green panel
  const greenBorder = '#3a5a30';
  const facePlate = 'linear-gradient(180deg,#cac6b8 0%,#b8b3a6 50%,#aaa598 100%)'; // silver/cream
  const secLabel = { fontSize:7, letterSpacing:'0.22em', color:'rgba(200,220,160,0.65)', fontWeight:700, textTransform:'uppercase', marginBottom:6, display:'block' };
  const greenPanel = { background:greenBg, border:`1px solid ${greenBorder}`, borderRadius:5, padding:'8px 10px', marginBottom:8 };

  return (
    <div style={{
      width: 380,
      height: 500,
      background: '#181814',
      borderRadius: 10,
      overflow: 'hidden',
      fontFamily: 'sans-serif',
      userSelect: 'none',
      border: '2px solid #111',
      boxShadow: '0 10px 50px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>

      {/* ── Header — silver faceplate ── */}
      <div style={{ background: facePlate, padding:'9px 12px 8px', borderBottom:'2px solid #888' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            <span style={{ fontSize:14, fontWeight:900, letterSpacing:'0.12em', color:'#1a1a10', fontFamily:'serif', textShadow:'0 1px 0 rgba(255,255,255,0.4)' }}>SPACE ECHO</span>
            <span style={{ fontSize:6.5, fontWeight:700, letterSpacing:'0.28em', color:'#5a5040' }}>TAPE DELAY  ·  RE-201</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {loading && <span style={{ fontSize:7, color:'#888' }}>…</span>}
            <button onClick={() => {
              const eng = engineRef.current;
              setRepeatRate(0.82);
              setFeedback(0.04); eng?.setFeedback(0.04);
              setHead1(true);  eng?.setHead1(true);
              setHead2(false); eng?.setHead2(false);
              setHead3(false); eng?.setHead3(false);
              setMix(0.5);     eng?.setMix(0.5);
            }} style={{ padding:'2px 8px', borderRadius:2, cursor:'pointer', fontSize:6.5, fontWeight:900, letterSpacing:'0.14em', border:'1px solid #8a7050', background:'linear-gradient(180deg,#c8a84a22 0%,#9a7c2a22 100%)', color:'#7a5a20' }}>SLAP</button>
            <div style={{ width:8, height:8, borderRadius:'50%', background: bypassed?'#888':'#dd2200', boxShadow: bypassed?'none':'0 0 7px #ff330099', border:'1px solid rgba(0,0,0,0.3)' }} />
            <button onClick={() => setBypassed(b=>!b)} style={{ padding:'2px 8px', borderRadius:2, cursor:'pointer', fontSize:6.5, fontWeight:900, letterSpacing:'0.14em', border:'1px solid #8a7870', background:'linear-gradient(180deg,#d8d0c0 0%,#b8b0a0 100%)', color: bypassed?'#c04020':'#444' }}>{bypassed?'BYPASS':'ACTIVE'}</button>
            {onRemove && <button onClick={onRemove} style={{ width:16, height:16, borderRadius:'50%', background:'transparent', border:'1px solid #888', color:'#666', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>×</button>}
          </div>
        </div>
      </div>

      {/* ── Body — dark housing with green panel inserts ── */}
      <div style={{ padding:'10px 10px 12px', background:'#1c1c18' }}>

        {/* Meters — green panel */}
        <div style={greenPanel}>
          {/* Top row: LEVEL label + VU needle meters + gain knobs */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <span style={{ ...secLabel, marginBottom:0 }}>Level</span>
            <div style={{ display:'flex', gap:6 }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                <VuMeter level={inPeak} />
                <span style={{ fontSize:6, color:'rgba(180,220,140,0.5)', letterSpacing:'0.12em' }}>IN</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                <VuMeter level={outPeak} />
                <span style={{ fontSize:6, color:'rgba(180,220,140,0.5)', letterSpacing:'0.12em' }}>OUT</span>
              </div>
            </div>
            <div style={{ flex:1, display:'flex', justifyContent:'flex-end', gap:8 }}>
              <Knob label="In"  value={inputGain}  onChange={v=>{setInputGain(v); engineRef.current?.setInputGain(v*2);}}  defaultValue={0.5} size={28} format={fmtDb} />
              <Knob label="Out" value={outputGain} onChange={v=>{setOutputGain(v); engineRef.current?.setOutputGain(v*2);}} defaultValue={0.5} size={28} format={fmtDb} />
            </div>
          </div>
          {/* LED bar meters below */}
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            <LedMeter level={inPeak}  label="IN" />
            <LedMeter level={outPeak} label="OUT" />
          </div>
        </div>

        {/* Echo Heads — green panel */}
        <div style={greenPanel}>
          <span style={secLabel}>Echo Heads</span>
          <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
            {/* Head on/off buttons */}
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <HeadBtn n={1} on={head1} onClick={()=>{const v=!head1;setHead1(v);engineRef.current?.setHead1(v);}} />
              <HeadBtn n={2} on={head2} onClick={()=>{const v=!head2;setHead2(v);engineRef.current?.setHead2(v);}} />
              <HeadBtn n={3} on={head3} onClick={()=>{const v=!head3;setHead3(v);engineRef.current?.setHead3(v);}} />
            </div>
            {/* Per-head volume faders */}
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4, justifyContent:'center' }}>
              {[
                { vol: head1vol, set: v => { setHead1vol(v); engineRef.current?.setHead1Vol(v); }, on: head1 },
                { vol: head2vol, set: v => { setHead2vol(v); engineRef.current?.setHead2Vol(v); }, on: head2 },
                { vol: head3vol, set: v => { setHead3vol(v); engineRef.current?.setHead3Vol(v); }, on: head3 },
              ].map((h, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:5, height:20 }}>
                  <input
                    type="range" min={0} max={1} step={0.01} value={h.vol}
                    onChange={e => h.set(parseFloat(e.target.value))}
                    style={{ flex:1, accentColor: h.on ? '#a0d060' : '#4a6a40', cursor:'pointer', height:3, opacity: h.on ? 1 : 0.4 }}
                  />
                  <span style={{ fontSize:6, color:'rgba(180,220,140,0.55)', fontFamily:'"Courier New",monospace', width:22, textAlign:'right' }}>
                    {Math.round(h.vol * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Controls — green panel */}
        <div style={greenPanel}>
          <span style={secLabel}>Controls</span>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <Knob label="Rate"      value={repeatRate} onChange={v=>setRepeatRate(v)}                  defaultValue={0.5}  size={28} format={fmtRate} />
            <Knob label="Intensity" value={feedback}   onChange={bind(setFeedback,'setFeedback')}       defaultValue={0.42} size={28} format={fmtPct} />
            <Knob label="Echo Vol"  value={mix}        onChange={bind(setMix,'setMix')}                 defaultValue={0.45} size={28} format={fmtPct} />
            <Knob label="Wow"       value={wow}        onChange={bind(setWow,'setWow')}                 defaultValue={0.35} size={28} format={fmtPct} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <Knob label="Bass"   value={bass}   onChange={bind(setBass,'setBass')}     defaultValue={0.5} size={28} format={fmtDb} />
            <Knob label="Treble" value={treble} onChange={bind(setTreble,'setTreble')} defaultValue={0.5} size={28} format={fmtDb} />
            <Knob label="Drive"  value={drive}  onChange={bind(setDrive,'setDrive')}   defaultValue={0.3} size={28} format={fmtPct} />
            <Knob label="Spread" value={spread} onChange={bind(setSpread,'setSpread')} defaultValue={0.5} size={28} format={fmtPct} />
          </div>
        </div>

        {/* Analog Tone — green panel */}
        <div style={{ ...greenPanel, marginBottom:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={secLabel}>Analog Tone</span>
            <span style={{ fontSize:6.5, color: analogMix > 0.01 ? '#c8e888' : 'rgba(180,220,140,0.3)', fontWeight:700, letterSpacing:'0.14em' }}>{Math.round(analogMix*100)}%</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:6, color:'rgba(180,220,140,0.4)', letterSpacing:'0.12em' }}>CLEAN</span>
            <input type="range" min={0} max={1} step={0.01} value={analogMix}
              onChange={e=>{const v=parseFloat(e.target.value);setAnalogMix(v);engineRef.current?.setAnalogMix(v);}}
              style={{ flex:1, accentColor:'#a0d060', cursor:'pointer' }}
            />
            <span style={{ fontSize:6, color: analogMix>0.5?'#c8e888':'rgba(180,220,140,0.4)', letterSpacing:'0.12em' }}>ANALOG</span>
          </div>
        </div>

        {/* ── Presets — green panel */}
        <div style={{ ...greenPanel, marginBottom:0, marginTop:8 }}>
          <span style={secLabel}>Presets</span>

          {/* Save row */}
          <div style={{ display:'flex', gap:5, marginBottom:6 }}>
            <input
              type="text"
              placeholder="Name preset…"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && savePreset()}
              style={{
                flex:1, fontSize:8, padding:'3px 6px', borderRadius:3,
                background:'#111e0e', border:'1px solid #3a5a30',
                color:'rgba(200,230,160,0.9)', outline:'none',
                fontFamily:'"Courier New",monospace',
              }}
            />
            <button onClick={savePreset} style={{
              padding:'3px 10px', borderRadius:3, cursor:'pointer',
              fontSize:7, fontWeight:900, letterSpacing:'0.14em',
              border:'1px solid #4a7a40',
              background: presetName.trim() ? 'linear-gradient(180deg,#3a6030 0%,#264020 100%)' : '#1a2a14',
              color: presetName.trim() ? '#a0d860' : '#3a5a30',
            }}>SAVE</button>
          </div>

          {/* Preset list */}
          {Object.keys(presets).length === 0
            ? <span style={{ fontSize:7, color:'rgba(180,220,140,0.25)', fontStyle:'italic' }}>No presets saved yet</span>
            : <div style={{ display:'flex', flexDirection:'column', gap:3, maxHeight:90, overflowY:'auto' }}>
                {Object.keys(presets).map(name => (
                  <div key={name} onClick={() => loadPreset(name)} style={{
                    display:'flex', alignItems:'center', justifyContent:'space-between',
                    padding:'3px 7px', borderRadius:3, cursor:'pointer',
                    background: selectedPreset === name
                      ? 'linear-gradient(180deg,#3a6030 0%,#264020 100%)'
                      : 'rgba(0,0,0,0.25)',
                    border: `1px solid ${selectedPreset === name ? '#4a7a40' : '#2a4020'}`,
                  }}>
                    <span style={{ fontSize:8, fontWeight:700, color: selectedPreset===name ? '#c0e880' : 'rgba(180,220,140,0.7)', letterSpacing:'0.08em', fontFamily:'"Courier New",monospace' }}>{name}</span>
                    <button onClick={e => { e.stopPropagation(); deletePreset(name); }} style={{
                      background:'transparent', border:'none', cursor:'pointer',
                      fontSize:10, color:'rgba(200,100,80,0.5)', lineHeight:1, padding:'0 2px',
                    }}>×</button>
                  </div>
                ))}
              </div>
          }
        </div>

      </div>
    </div>
  );
}
