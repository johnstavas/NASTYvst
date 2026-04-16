import { useState, useEffect, useRef, useCallback } from 'react';
import { createAnalogGlueEngine } from './analogGlueEngine';
import PresetSelector from './PresetSelector';

const AG_PRESETS = [
  { name: 'INIT', threshold: -12, ratio: 2, attack: 10, release: 'Auto', knee: 6, makeup: 0, mix: 1, inputGain: 0.5, outputGain: 0.5, drive: 0.3, scFilter: 0, linkMode: 1, lookahead: false },
  { name: 'GENTLE GLUE', threshold: -18, ratio: 1.5, attack: 10, release: 'Auto', knee: 12, makeup: 2, mix: 1, inputGain: 0.5, outputGain: 0.5, drive: 0.2, scFilter: 2, linkMode: 1, lookahead: false },
  { name: 'PUNCHY MIX', threshold: -8, ratio: 4, attack: 0.3, release: 200, knee: 4, makeup: 4, mix: 1, inputGain: 0.5, outputGain: 0.5, drive: 0.4, scFilter: 3, linkMode: 2, lookahead: false },
  { name: 'DRUM BUS', threshold: -6, ratio: 4, attack: 0.1, release: 100, knee: 2, makeup: 6, mix: 0.8, inputGain: 0.5, outputGain: 0.5, drive: 0.5, scFilter: 4, linkMode: 2, lookahead: false },
  { name: 'PARALLEL SMASH', threshold: -30, ratio: 10, attack: 0, release: 200, knee: 0, makeup: 12, mix: 0.4, inputGain: 0.5, outputGain: 0.5, drive: 0.6, scFilter: 3, linkMode: 1, lookahead: true },
  { name: 'MASTER BUS', threshold: -16, ratio: 2, attack: 10, release: 'Auto', knee: 8, makeup: 3, mix: 1, inputGain: 0.5, outputGain: 0.5, drive: 0.15, scFilter: 2, linkMode: 1, lookahead: false },
];

// ─── Chrome Knob ──────────────────────────────────────────────────────────────
function ChromeKnob({ size = 44, norm = 0 }) {
  const id  = useRef(`ag-${Math.random().toString(36).slice(2,7)}`).current;
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
        {/* SSL blue-cap knob — glossy sky-blue top, dark body */}
        <radialGradient id={`${id}-rg`} cx="38%" cy="30%" r="75%">
          <stop offset="0%"   stopColor="#b8d8ec" />
          <stop offset="25%"  stopColor="#6fa8cf" />
          <stop offset="60%"  stopColor="#2d4a66" />
          <stop offset="100%" stopColor="#0a1420" />
        </radialGradient>
        <radialGradient id={`${id}-hi`} cx="35%" cy="22%" r="45%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.55)" />
          <stop offset="60%"  stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}><feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.85)" /></filter>
      </defs>
      <path d={trackPath} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={2.5} strokeLinecap="round" transform="translate(4,4)" />
      {valPath && <path d={valPath} fill="none" stroke="#b8d8ec" strokeWidth={2.5} strokeLinecap="round" opacity={0.95} transform="translate(4,4)" />}
      <circle cx={cx+4} cy={cy+4} r={r} fill={`url(#${id}-rg)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx+4} cy={cy+4} r={r}   fill="none" stroke="rgba(180,216,236,0.35)" strokeWidth={1} />
      <circle cx={cx+4} cy={cy+4} r={r-2} fill="none" stroke="rgba(0,0,0,0.45)"         strokeWidth={1} />
      <circle cx={cx+4} cy={cy+4} r={r} fill={`url(#${id}-hi)`} />
      <line x1={+lx1+4} y1={+ly1+4} x2={+lx2+4} y2={+ly2+4} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

// ─── Knob wrapper ─────────────────────────────────────────────────────────────
function Knob({ label, value, onChange, min=0, max=1, defaultValue, size=28, format }) {
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
      <span style={{ fontSize:6.5, letterSpacing:'0.14em', textTransform:'uppercase', color:'rgba(230,235,240,0.92)', fontWeight:700, textAlign:'center', width:'100%', lineHeight:1.2 }}>{label}</span>
      <span style={{ fontSize:5.5, color:'rgba(180,200,220,0.55)', fontFamily:'"Courier New",monospace', fontWeight:700, textAlign:'center', width:'100%' }}>{display}</span>
    </div>
  );
}

// ─── VU Needle ────────────────────────────────────────────────────────────────
function VuMeter({ level }) {
  const norm   = Math.min(1, Math.max(0, level * 1.5));
  const angle  = -45 + norm * 90;
  const W = 60, H = 34;
  const cx = W/2, cy = H - 3;
  const r  = 28;
  const rad = (angle - 90) * Math.PI / 180;
  const nx = cx + Math.cos(rad) * r;
  const ny = cy + Math.sin(rad) * r;
  const col = norm > 0.85 ? '#ff4020' : norm > 0.6 ? '#ffb040' : '#a8d860';
  return (
    <svg width={W} height={H} style={{ background: 'linear-gradient(180deg,#14181c 0%,#080a0c 100%)', border: '1px solid rgba(180,216,236,0.22)', borderRadius: 3 }}>
      {/* scale arc */}
      <path d={`M ${cx + Math.cos((-45-90)*Math.PI/180)*r} ${cy + Math.sin((-45-90)*Math.PI/180)*r} A ${r} ${r} 0 0 1 ${cx + Math.cos((45-90)*Math.PI/180)*r} ${cy + Math.sin((45-90)*Math.PI/180)*r}`}
        fill="none" stroke="rgba(180,216,236,0.3)" strokeWidth={1} />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2} fill="#888" />
    </svg>
  );
}

// ─── LED bar meter ────────────────────────────────────────────────────────────
function LedMeter({ level, label }) {
  const segments = 28;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  const minDb = -48, maxDb = 6;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <span style={{ fontSize:6, color:'rgba(200,215,230,0.7)', letterSpacing:'0.15em', fontWeight:700, width:16 }}>{label}</span>
      <div style={{ display:'flex', gap:1, flex:1 }}>
        {Array.from({ length: segments }, (_, i) => {
          const segDb = minDb + (i * (maxDb - minDb) / (segments - 1));
          const lit = dB >= segDb;
          const col = segDb > 0 ? '#ff3020' : segDb > -6 ? '#ffa030' : '#a8d860';
          return (
            <div key={i} style={{
              flex:1, height:5, borderRadius:1,
              background: lit ? col : 'rgba(255,255,255,0.05)',
              boxShadow: lit ? `0 0 3px ${col}88` : 'none',
            }} />
          );
        })}
      </div>
      <span style={{ fontSize:6, color:'rgba(200,215,230,0.6)', fontFamily:'"Courier New",monospace', width:22, textAlign:'right' }}>
        {dB > -90 ? `${dB.toFixed(0)}` : '-∞'}
      </span>
    </div>
  );
}

// ─── GR History Scope — scrolling input/output envelope ──────────────────────
// Shows the actual input signal envelope (filled blue) and output envelope
// (amber outline) over the last ~2 seconds. The gap between them IS the
// gain reduction you're hearing — wider gap = more compression.
function GRHistoryScope({ inPeak, outPeak, grDb }) {
  const canvasRef = useRef(null);
  const propsRef  = useRef({ inPeak: 0, outPeak: 0, grDb: 0 });
  const stateRef  = useRef({
    inBuf:  new Float32Array(380),
    outBuf: new Float32Array(380),
    grBuf:  new Float32Array(380),
    head: 0,
  });

  propsRef.current = { inPeak, outPeak, grDb };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const H2 = H / 2;
    const st = stateRef.current;
    const LEN = st.inBuf.length;
    let raf;

    const draw = () => {
      // Push one sample of history per frame (~60Hz → ~4.7s total window)
      st.inBuf[st.head]  = propsRef.current.inPeak;
      st.outBuf[st.head] = propsRef.current.outPeak;
      st.grBuf[st.head]  = propsRef.current.grDb;
      st.head = (st.head + 1) % LEN;

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0f1418'); bg.addColorStop(1, '#06090c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Center line + subtle grid
      ctx.strokeStyle = 'rgba(180,216,236,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H2); ctx.lineTo(W, H2); ctx.stroke();
      ctx.strokeStyle = 'rgba(180,216,236,0.04)';
      for (let q = 1; q < 4; q++) {
        ctx.beginPath(); ctx.moveTo(0, (H*q)/4); ctx.lineTo(W, (H*q)/4); ctx.stroke();
      }

      // Scale: amp * 1.2 maps 0.833 → full height
      const amp = (v) => Math.min(1, v * 1.2) * H2 * 0.92;

      // ── Input envelope — filled cool blue (the signal coming in) ────────
      ctx.fillStyle = 'rgba(111,168,207,0.38)';
      ctx.strokeStyle = 'rgba(180,216,236,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const i = (st.head + x) % LEN;
        const a = amp(st.inBuf[i]);
        if (x === 0) ctx.moveTo(x, H2 - a);
        else         ctx.lineTo(x, H2 - a);
      }
      for (let x = W - 1; x >= 0; x--) {
        const i = (st.head + x) % LEN;
        const a = amp(st.inBuf[i]);
        ctx.lineTo(x, H2 + a);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // ── Output envelope — amber outline on top (what's leaving the plug) ─
      ctx.strokeStyle = 'rgba(232,154,60,0.95)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const i = (st.head + x) % LEN;
        const a = amp(st.outBuf[i]);
        if (x === 0) ctx.moveTo(x, H2 - a);
        else         ctx.lineTo(x, H2 - a);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const i = (st.head + x) % LEN;
        const a = amp(st.outBuf[i]);
        if (x === 0) ctx.moveTo(x, H2 + a);
        else         ctx.lineTo(x, H2 + a);
      }
      ctx.stroke();

      // ── Legend dot + current GR readout ──────────────────────────────────
      const { grDb } = propsRef.current;
      if (grDb < -0.3) {
        ctx.fillStyle = 'rgba(232,154,60,0.85)';
        ctx.font = 'bold 8px "Courier New",monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${grDb.toFixed(1)} dB GR`, W - 4, 10);
      }
      ctx.fillStyle = 'rgba(111,168,207,0.55)';
      ctx.font = '7px "Courier New",monospace';
      ctx.textAlign = 'left';
      ctx.fillText('IN', 4, 9);
      ctx.fillStyle = 'rgba(232,154,60,0.7)';
      ctx.fillText('OUT', 4, H - 3);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={380} height={54}
    style={{ width:'100%', borderRadius:3, border:'1px solid rgba(180,216,236,0.18)' }} />;
}

// ─── GR Needle (SSL-style VU: dark navy face, white scale + needle) ──────────
function GRNeedle({ grDb }) {
  const id = useRef(`gr-${Math.random().toString(36).slice(2,7)}`).current;
  const norm = Math.min(1, Math.max(0, (-grDb) / 20));
  // Needle sweeps from -55° (rest at 0 dB) to +55° (pinned at 20 dB)
  const angle = -55 + norm * 110;
  const W = 244, H = 72;
  const cx = W/2, cy = H + 22;      // pivot below the visible area → long throw
  const r  = 74;                      // arc radius
  const rad = (angle - 90) * Math.PI / 180;
  const nx = cx + Math.cos(rad) * r;
  const ny = cy + Math.sin(rad) * r;
  const ticks = [0, 4, 8, 12, 16, 20];

  return (
    <svg width={W} height={H} style={{ display:'block', borderRadius:4, overflow:'hidden' }}>
      <defs>
        {/* Dark indigo face with top-left light bloom */}
        <radialGradient id={`${id}-face`} cx="28%" cy="18%" r="110%">
          <stop offset="0%"   stopColor="#2a3850" />
          <stop offset="35%"  stopColor="#162238" />
          <stop offset="75%"  stopColor="#0a1020" />
          <stop offset="100%" stopColor="#05080f" />
        </radialGradient>
        {/* Inner bezel shadow */}
        <filter id={`${id}-inner`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      {/* Face */}
      <rect x="0" y="0" width={W} height={H} fill={`url(#${id}-face)`} />
      {/* Subtle inner bezel */}
      <rect x="1" y="1" width={W-2} height={H-2} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      <rect x="0" y="0" width={W} height={H} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth={1} />

      {/* Tick marks — full + half */}
      {Array.from({ length: 41 }, (_, i) => {
        const t = i / 40;
        const a = -55 + t * 110;
        const rr = (a - 90) * Math.PI / 180;
        const major = i % 8 === 0;
        const mid   = i % 4 === 0 && !major;
        const tickLen = major ? 7 : mid ? 4 : 2;
        const tickOpacity = major ? 0.95 : mid ? 0.7 : 0.35;
        return (
          <line key={i}
            x1={cx + Math.cos(rr)*(r+1)} y1={cy + Math.sin(rr)*(r+1)}
            x2={cx + Math.cos(rr)*(r+1+tickLen)} y2={cy + Math.sin(rr)*(r+1+tickLen)}
            stroke={`rgba(240,245,250,${tickOpacity})`} strokeWidth={major ? 1 : 0.7} />
        );
      })}

      {/* Scale numbers */}
      {ticks.map(db => {
        const a = -55 + (db/20)*110;
        const rr = (a - 90) * Math.PI / 180;
        const lx = cx + Math.cos(rr)*(r+14);
        const ly = cy + Math.sin(rr)*(r+14) + 2.5;
        return (
          <text key={db}
            x={lx} y={ly}
            fontSize="7" fill="rgba(240,245,250,0.92)" textAnchor="middle"
            fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic">
            {db}
          </text>
        );
      })}

      {/* dB / COMPRESSION label */}
      <text x={cx} y={H - 14} fontSize="9" fill="rgba(240,245,250,0.9)" textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight="600">dB</text>
      <text x={cx} y={H - 5} fontSize="5" fill="rgba(200,215,230,0.65)" textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif" letterSpacing="0.18em">COMPRESSION</text>

      {/* Needle with shadow */}
      <line x1={cx+1} y1={cy+1} x2={nx+1} y2={ny+1}
        stroke="rgba(0,0,0,0.55)" strokeWidth={2.4} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx} y2={ny}
        stroke="#f4f8fc" strokeWidth={1.6} strokeLinecap="round" />

      {/* Pivot cap (just barely visible at bottom edge) */}
      <circle cx={cx} cy={cy} r={4} fill="#1a1a1a" stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />
      <circle cx={cx} cy={cy} r={1.5} fill="#888" />

      {/* Top-left gloss overlay */}
      <ellipse cx={W*0.25} cy={H*0.15} rx={W*0.45} ry={H*0.4}
        fill="rgba(255,255,255,0.05)" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const RATIO_OPTIONS   = [1.5, 2, 4, 10];
const ATTACK_OPTIONS  = [0, 0.1, 0.3, 1, 3, 10, 30];
const RELEASE_OPTIONS = [100, 200, 400, 800, 1600, 'Auto'];
const SC_FILTERS = [
  { id: 0, label: 'OFF' },
  { id: 1, label: '30' },
  { id: 2, label: '60' },
  { id: 3, label: '90' },
  { id: 4, label: '120' },
  { id: 5, label: '150' },
];
const LINK_MODES = [
  { id: 0, label: 'DUAL' },
  { id: 1, label: 'AVG'  },
  { id: 2, label: 'MAX'  },
];

export default function AnalogGlueOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  // Controls
  const [threshold,  setThreshold]  = useState(initialState?.threshold  ?? -12);
  const [ratio,      setRatio]      = useState(initialState?.ratio      ?? 2);
  const [attack,     setAttack]     = useState(initialState?.attack     ?? 10);
  const [release,    setRelease]    = useState(initialState?.release    ?? 'Auto');
  const [knee,       setKnee]       = useState(initialState?.knee       ?? 6);
  const [makeup,     setMakeup]     = useState(initialState?.makeup     ?? 0);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1);
  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 0.5);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 0.5);
  const [drive,      setDrive]      = useState(initialState?.drive      ?? initialState?.analog ?? 0.3);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [scFilter,   setScFilter]   = useState(initialState?.scFilter   ?? 0);
  const [linkMode,   setLinkMode]   = useState(initialState?.linkMode   ?? 1);
  const [lookahead,  setLookahead]  = useState(initialState?.lookahead  ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? 'INIT');

  const loadPreset = useCallback((preset) => {
    setThreshold(preset.threshold); setRatio(preset.ratio);
    setAttack(preset.attack); setRelease(preset.release);
    setKnee(preset.knee); setMakeup(preset.makeup);
    setMix(preset.mix); setInputGain(preset.inputGain);
    setOutputGain(preset.outputGain); setDrive(preset.drive);
    setScFilter(preset.scFilter); setLinkMode(preset.linkMode);
    setLookahead(preset.lookahead); setActivePreset(preset.name);
    const e = engineRef.current;
    if (e) {
      e.setThreshold(preset.threshold); e.setRatio(preset.ratio);
      e.setAttack(preset.attack);
      e.setRelease(preset.release === 'Auto' ? 200 : preset.release);
      e.setKnee(preset.knee); e.setMakeup(preset.makeup);
      e.setMix(preset.mix); e.setInputGain(preset.inputGain * 2);
      e.setOutputGain(preset.outputGain * 2); e.setDrive(preset.drive);
      e.setSidechainFilter(preset.scFilter); e.setStereoLink(preset.linkMode);
      e.setLookahead(preset.lookahead);
    }
  }, []);

  const clearPreset = useCallback(() => setActivePreset(null), []);

  // Meters
  const [inPeak,  setInPeak]  = useState(0);
  const [outPeak, setOutPeak] = useState(0);
  const [grDb,    setGrDb]    = useState(0);
  const [latency, setLatency] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { threshold, ratio, attack, release, knee, makeup, mix, inputGain, outputGain, drive, bypassed, scFilter, linkMode, lookahead };

  // ── Engine init — matches TapeDelayOrb pattern ──
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createAnalogGlueEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setThreshold(s.threshold);
      eng.setRatio(s.ratio);
      eng.setKnee(s.knee);
      eng.setAttack(s.attack);
      eng.setRelease(s.release === 'Auto' ? 200 : s.release);
      eng.setMakeup(s.makeup);
      eng.setMix(s.mix);
      eng.setInputGain(s.inputGain * 2);
      eng.setOutputGain(s.outputGain * 2);
      eng.setDrive(s.drive);
      eng.setBypass(s.bypassed);
      eng.setSidechainFilter(s.scFilter);
      eng.setStereoLink(s.linkMode);
      eng.setLookahead(s.lookahead);
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

  // ── Meter RAF ──
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        setInPeak(engineRef.current.getInputPeak());
        setOutPeak(engineRef.current.getOutputPeak());
        setGrDb(engineRef.current.getGainReduction());
        setLatency(engineRef.current.getLatency());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { ...stateRefs.current, preset: activePreset });
  }, [threshold, ratio, attack, release, knee, makeup, mix, inputGain, outputGain, drive, bypassed, scFilter, linkMode, lookahead, activePreset]);

  // ── Palette (SSL Bus Comp — charcoal panel, blue knob caps, amber accent) ──
  const acc       = '#e89a3c';  // amber — used for active button glow (like SSL "IN")
  const blue      = '#6fa8cf';  // sky blue — knob caps / subtle highlights
  const panelBg   = 'linear-gradient(180deg,#2a2f34 0%,#1a1e22 100%)';
  const panelBord = '#3a4048';
  const facePlate = 'linear-gradient(180deg,#32383e 0%,#1e2328 50%,#14181c 100%)';
  const txt       = 'rgba(230,235,240,0.92)';
  const txtMute   = 'rgba(200,210,220,0.55)';
  const secLabel  = { fontSize:7, letterSpacing:'0.22em', color:txt, fontWeight:700, textTransform:'uppercase', marginBottom:4, display:'block' };
  const panel     = { background:panelBg, border:`1px solid ${panelBord}`, borderRadius:4, padding:'6px 8px', marginBottom:5, boxShadow:'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.6)' };

  // ── Button pills ──
  const pill = (active, color) => ({
    padding:'3px 4px', fontSize:8, fontFamily:'"Courier New",monospace', fontWeight:700, letterSpacing:'0.04em',
    border:`1px solid ${active ? color : 'rgba(200,210,220,0.15)'}`,
    borderRadius:2, background: active ? `${color}22` : 'rgba(0,0,0,0.45)',
    color: active ? color : 'rgba(200,210,220,0.45)', cursor:'pointer',
    boxShadow: active ? `0 0 5px ${color}66` : 'none', flex:1, textAlign:'center',
  });

  const pct  = v => `${Math.round(v * 100)}%`;
  const dBFmt = v => `${v>=0?'+':''}${v.toFixed(1)}dB`;
  const ioFmt = v => { const g=(v-0.5)*16; return g>=0?`+${g.toFixed(0)}dB`:`${g.toFixed(0)}dB`; };

  return (
    <div style={{
      width: 380,
      background: '#080b10',
      borderRadius: 10,
      overflow: 'hidden',
      fontFamily: 'sans-serif',
      userSelect: 'none',
      border: '2px solid #000',
      boxShadow: '0 10px 50px rgba(0,0,0,0.95), inset 0 1px 0 rgba(180,216,236,0.1)',
    }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ background: facePlate, padding:'10px 12px 9px', borderBottom:`1px solid rgba(180,216,236,0.2)` }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            <span style={{ fontSize:14, fontWeight:700, letterSpacing:'0.04em', color:'#e8ecf0', fontFamily:"Georgia,'Times New Roman',serif", fontStyle:'italic', textShadow:'0 1px 2px rgba(0,0,0,0.8)' }}>Nasty Glue Comp</span>
            <span style={{ fontSize:6.5, fontWeight:600, letterSpacing:'0.28em', color:'rgba(200,215,230,0.55)' }}>ANALOG BUS COMPRESSOR</span>
          </div>
          <PresetSelector presets={AG_PRESETS} activePreset={activePreset} onSelect={loadPreset}
            colors={{ bg: 'rgba(232,154,60,0.15)', text: '#e8ecf0', textDim: 'rgba(200,215,230,0.5)', border: 'rgba(232,154,60,0.3)', hoverBg: 'rgba(232,154,60,0.2)', activeBg: 'rgba(232,154,60,0.12)' }} />
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {loading && <span style={{ fontSize:7, color:'#888' }}>…</span>}
            <div style={{ width:8, height:8, borderRadius:'50%', background: bypassed?'#444':acc, boxShadow: bypassed?'none':`0 0 7px ${acc}99`, border:'1px solid rgba(0,0,0,0.4)' }} />
            <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
              style={{ padding:'2px 8px', borderRadius:2, cursor:'pointer', fontSize:6.5, fontWeight:800, letterSpacing:'0.14em',
                border:`1px solid ${bypassed ? 'rgba(200,215,230,0.3)' : acc}`, background: bypassed ? 'rgba(0,0,0,0.35)' : `${acc}22`,
                color: bypassed ? 'rgba(200,215,230,0.5)' : acc, boxShadow: bypassed ? 'none' : `0 0 6px ${acc}55` }}>
              {bypassed ? 'BYPASS' : 'ACTIVE'}
            </button>
            {onRemove && <button onClick={onRemove} style={{ width:16, height:16, borderRadius:'50%', background:'transparent', border:'1px solid #555', color:'#888', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>×</button>}
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div style={{ padding:'6px 8px 8px' }}>

        {/* Meters panel — LED bars + In/Out gain knobs */}
        <div style={panel}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:3 }}>
              <LedMeter level={inPeak}  label="IN"  />
              <LedMeter level={outPeak} label="OUT" />
            </div>
            <Knob label="In"  value={inputGain}  onChange={v=>{setInputGain(v); engineRef.current?.setInputGain(v*2); clearPreset();}}  defaultValue={0.5} size={28} format={ioFmt} />
            <Knob label="Out" value={outputGain} onChange={v=>{setOutputGain(v); engineRef.current?.setOutputGain(v*2); clearPreset();}} defaultValue={0.5} size={28} format={ioFmt} />
          </div>
        </div>

        {/* Gain reduction panel — SSL VU hero + scrolling I/O scope */}
        <div style={panel}>
          <div style={{ display:'flex', justifyContent:'center' }}>
            <GRNeedle grDb={grDb} />
          </div>
          <div style={{ marginTop:5 }}>
            <GRHistoryScope inPeak={inPeak} outPeak={outPeak} grDb={grDb} />
          </div>
        </div>

        {/* Main knobs — threshold/makeup/mix + knee/analog */}
        <div style={panel}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <Knob label="Threshold" value={threshold} onChange={v=>{setThreshold(v); engineRef.current?.setThreshold(v); clearPreset();}}
              min={-60} max={0} defaultValue={-12} size={28} format={v=>`${v.toFixed(1)}dB`} />
            <Knob label="Makeup" value={makeup} onChange={v=>{setMakeup(v); engineRef.current?.setMakeup(v); clearPreset();}}
              min={-6} max={24} defaultValue={0} size={28} format={dBFmt} />
            <Knob label="Mix" value={mix} onChange={v=>{setMix(v); engineRef.current?.setMix(v); clearPreset();}}
              min={0} max={1} defaultValue={1} size={28} format={pct} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <Knob label="Knee" value={knee} onChange={v=>{setKnee(v); engineRef.current?.setKnee(v); clearPreset();}}
              min={0} max={24} defaultValue={6} size={28} format={v=>`${v.toFixed(0)}dB`} />
            <Knob label="Drive" value={drive} onChange={v=>{setDrive(v); engineRef.current?.setDrive(v); clearPreset();}}
              min={0} max={1} defaultValue={0.3} size={28} format={pct} />
            <Knob label="Ratio" value={RATIO_OPTIONS.indexOf(ratio)} onChange={v=>{
              const idx = Math.round(v);
              const r = RATIO_OPTIONS[idx];
              setRatio(r); engineRef.current?.setRatio(r); clearPreset();
            }} min={0} max={RATIO_OPTIONS.length-1} defaultValue={1} size={28}
              format={() => `${ratio}:1`} />
          </div>
        </div>

        {/* Attack & Release panel */}
        <div style={panel}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
            <span style={{ ...secLabel, marginBottom:0, width:36 }}>Atk</span>
            <div style={{ display:'flex', gap:2, flex:1 }}>
              {ATTACK_OPTIONS.map(v => (
                <button key={v} onClick={() => { setAttack(v); engineRef.current?.setAttack(v); clearPreset(); }}
                  style={pill(attack === v, acc)}>
                  {v === 0 ? '0!' : v}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ ...secLabel, marginBottom:0, width:36 }}>Rel</span>
            <div style={{ display:'flex', gap:2, flex:1 }}>
              {RELEASE_OPTIONS.map(v => (
                <button key={v} onClick={() => { setRelease(v); engineRef.current?.setRelease(v === 'Auto' ? 200 : v); clearPreset(); }}
                  style={pill(release === v, acc)}>
                  {v === 'Auto' ? 'A' : v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sidechain HP + stereo link + lookahead panel */}
        <div style={panel}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
            <span style={{ ...secLabel, marginBottom:0, width:36 }}>S/C HP</span>
            <div style={{ display:'flex', gap:2, flex:1 }}>
              {SC_FILTERS.map(f => (
                <button key={f.id} onClick={() => { setScFilter(f.id); engineRef.current?.setSidechainFilter(f.id); clearPreset(); }}
                  style={pill(scFilter === f.id, acc)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
            <span style={{ ...secLabel, marginBottom:0, width:36 }}>Link</span>
            <div style={{ display:'flex', gap:2, flex:1 }}>
              {LINK_MODES.map(m => (
                <button key={m.id} onClick={() => { setLinkMode(m.id); engineRef.current?.setStereoLink(m.id); clearPreset(); }}
                  style={pill(linkMode === m.id, acc)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={() => { const n = !lookahead; setLookahead(n); engineRef.current?.setLookahead(n); clearPreset(); }}
              style={{
                padding:'3px 8px', fontSize:7.5, fontFamily:'"Courier New",monospace', fontWeight:800, letterSpacing:'0.1em',
                border:`1px solid ${lookahead ? acc : 'rgba(200,215,230,0.18)'}`,
                borderRadius:2, background: lookahead ? `${acc}22` : 'rgba(0,0,0,0.45)',
                color: lookahead ? acc : 'rgba(200,215,230,0.45)', cursor:'pointer',
                boxShadow: lookahead ? `0 0 6px ${acc}55` : 'none',
              }}>
              FIR LOOKAHEAD
            </button>
            <span style={{ fontSize:6.5, color:'rgba(200,215,230,0.55)', fontFamily:'"Courier New",monospace' }}>
              {lookahead ? `${latency} smp lat` : 'zero latency'}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
