import { useState, useEffect, useRef, useCallback } from 'react';
import { createFlangerEngine } from './flangerEngine';
import PresetSelector from './PresetSelector';

// ─── Dual theme — MX = blue sparkle, SBF = black + gold ────────────────────
const THEMES = {
  mx: {
    accent: '#4da8ff', accentHi: '#7ec8ff', accentDim: 'rgba(77,168,255,0.4)',
    accentVdim: 'rgba(77,168,255,0.18)', accentBg: 'rgba(77,168,255,0.05)',
    label: '#e8dcc8', labelDim: 'rgba(232,220,200,0.45)',
    panelGrad: 'linear-gradient(170deg, #122a48 0%, #0d1b30 25%, #0b1420 50%, #081220 75%, #0a1828 100%)',
    borderColor: 'rgba(100,180,255,0.25)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.8), 0 0 20px rgba(77,168,255,0.15), 0 0 60px rgba(77,168,255,0.06), inset 0 1px 0 rgba(150,210,255,0.12)',
    headerGrad: 'linear-gradient(180deg, rgba(77,168,255,0.06) 0%, transparent 100%)',
    titleGrad: 'linear-gradient(135deg, #7ec8ff 0%, #4da8ff 40%, #a0d8ff 70%, #4da8ff 100%)',
    titleGlow: 'drop-shadow(0 0 8px rgba(77,168,255,0.5))',
    knobTop: '#a0b8cc', knobMid: '#334455', knobDark: '#0d1520',
    knobSpec: 'rgba(180,220,255,0.35)', knobStroke: 'rgba(140,190,230,0.18)',
    pointer: '#e8dcc8', labelShadow: '0 0 6px rgba(77,168,255,0.3)',
    sliderBg: '#080e18', sliderBorder: 'rgba(77,168,255,0.12)', sliderFill: 'rgba(77,168,255,0.12)',
    sliderGlow: '0 0 6px rgba(77,168,255,0.5)',
    meterBg: '#080e18', meterBorder: 'rgba(77,168,255,0.1)', meterOff: 'rgba(77,168,255,0.06)',
    btnGlow: '0 0 8px rgba(77,168,255,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
    divider: 'rgba(77,168,255,0.08)', dividerStrong: 'rgba(77,168,255,0.12)',
    sparkHue: [200, 230], sparkSat: 80,
    presetBg: '#0c1525',
  },
  sbf: {
    accent: '#e8a830', accentHi: '#ffd060', accentDim: 'rgba(232,168,48,0.45)',
    accentVdim: 'rgba(232,168,48,0.18)', accentBg: 'rgba(232,168,48,0.05)',
    label: '#f0e6d0', labelDim: 'rgba(240,230,208,0.45)',
    panelGrad: 'linear-gradient(170deg, #161210 0%, #0e0c08 25%, #0a0806 50%, #080604 75%, #0c0a06 100%)',
    borderColor: 'rgba(232,168,48,0.2)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(232,168,48,0.1), 0 0 60px rgba(232,168,48,0.04), inset 0 1px 0 rgba(255,220,140,0.08)',
    headerGrad: 'linear-gradient(180deg, rgba(232,168,48,0.04) 0%, transparent 100%)',
    titleGrad: 'linear-gradient(135deg, #ffd060 0%, #e8a830 40%, #ffe080 70%, #e8a830 100%)',
    titleGlow: 'drop-shadow(0 0 8px rgba(232,168,48,0.5))',
    knobTop: '#c0a880', knobMid: '#4a3a28', knobDark: '#1a1208',
    knobSpec: 'rgba(255,220,160,0.3)', knobStroke: 'rgba(200,170,120,0.15)',
    pointer: '#f0e6d0', labelShadow: '0 0 6px rgba(232,168,48,0.25)',
    sliderBg: '#0a0806', sliderBorder: 'rgba(232,168,48,0.1)', sliderFill: 'rgba(232,168,48,0.1)',
    sliderGlow: '0 0 6px rgba(232,168,48,0.45)',
    meterBg: '#0a0806', meterBorder: 'rgba(232,168,48,0.1)', meterOff: 'rgba(232,168,48,0.05)',
    btnGlow: '0 0 8px rgba(232,168,48,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
    divider: 'rgba(232,168,48,0.07)', dividerStrong: 'rgba(232,168,48,0.1)',
    sparkHue: [35, 50], sparkSat: 75,
    presetBg: '#12100a',
  },
};

// ─── Animated sparkle canvas — adapts hue per engine ────────────────────────
function SparkleOverlay({ theme }) {
  const canvasRef = useRef(null);
  const particles = useRef(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 500;
    canvas.width = W * 2;
    canvas.height = H * 2;
    ctx.scale(2, 2);

    // Generate sparkle particles once — hue is applied at draw time from theme
    if (!particles.current) {
      const pts = [];
      for (let i = 0; i < 350; i++) {
        pts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.3 + Math.random() * 1.2,
          brightness: 0.15 + Math.random() * 0.85,
          speed: 0.3 + Math.random() * 2.5,
          phase: Math.random() * Math.PI * 2,
          hueOffset: Math.random(),  // 0..1 mapped to hue range at draw time
          isBright: Math.random() < 0.15,
        });
      }
      particles.current = pts;
    }

    let raf;
    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      const th = themeRef.current;
      const [hMin, hMax] = th.sparkHue;
      const sat = th.sparkSat;
      const pts = particles.current;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const hue = hMin + p.hueOffset * (hMax - hMin);
        const twinkle = 0.3 + 0.7 * Math.pow((Math.sin(t * 0.001 * p.speed + p.phase) + 1) * 0.5, 2);
        const alpha = p.brightness * twinkle;

        if (p.isBright && twinkle > 0.7) {
          const flareAlpha = alpha * 0.8;
          const flareLen = p.r * 4 * twinkle;
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 85%, ${flareAlpha})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x - flareLen, p.y);
          ctx.lineTo(p.x + flareLen, p.y);
          ctx.moveTo(p.x, p.y - flareLen);
          ctx.lineTo(p.x, p.y + flareLen);
          ctx.stroke();
          const d = flareLen * 0.6;
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 85%, ${flareAlpha * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(p.x - d, p.y - d);
          ctx.lineTo(p.x + d, p.y + d);
          ctx.moveTo(p.x + d, p.y - d);
          ctx.lineTo(p.x - d, p.y + d);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (p.isBright ? twinkle * 1.5 : 1), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, ${sat}%, ${p.isBright ? 90 : 75}%, ${alpha})`;
        ctx.fill();

        if (alpha > 0.4) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, ${sat - 10}%, 70%, ${alpha * 0.15})`;
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: 1, borderRadius: 6,
      mixBlendMode: 'screen', opacity: 0.9,
    }} />
  );
}

// ─── Theme-aware knob ───────────────────────────────────────────────────────
function FlangerKnob({ size = 40, norm = 0, theme }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const id = useRef(`fl-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  const lx1 = cx + r * 0.15 * Math.cos(rad);
  const ly1 = cy + r * 0.15 * Math.sin(rad);
  const lx2 = cx + r * 0.82 * Math.cos(rad);
  const ly2 = cy + r * 0.82 * Math.sin(rad);

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-b`} cx="35%" cy="25%" r="75%">
          <stop offset="0%" stopColor={theme.knobTop} />
          <stop offset="35%" stopColor={theme.knobMid} />
          <stop offset="80%" stopColor={theme.knobDark} />
          <stop offset="100%" stopColor={theme.knobDark} />
        </radialGradient>
        <radialGradient id={`${id}-spec`} cx="30%" cy="20%" r="40%">
          <stop offset="0%" stopColor={theme.knobSpec} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="rgba(0,0,0,0.65)" />
        </filter>
      </defs>
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-b)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-spec)`} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="none" stroke={theme.knobStroke} strokeWidth={0.8} />
      <line x1={lx1 + 4} y1={ly1 + 4} x2={lx2 + 4} y2={ly2 + 4}
        stroke={theme.pointer} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 40, format, step, sensitivity = 160, theme }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <FlangerKnob size={size} norm={norm} theme={theme} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.label, fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1.2, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', textShadow: theme.labelShadow }}>{label}</span>
      <span style={{ fontSize: 5.5, color: theme.accentDim, fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Theme-aware vertical slider ────────────────────────────────────────────
function VSlider({ value, onChange, label, min = 0, max = 1, defaultValue = 1, height = 52, format, theme }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{ width: 10, height, background: theme.sliderBg, borderRadius: 2, border: `1px solid ${theme.sliderBorder}`, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: theme.sliderFill, borderRadius: 1, transition: dragging ? 'none' : 'height 0.05s' }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: theme.accent, bottom: `calc(${norm * 100}% - 2px)`, boxShadow: theme.sliderGlow }} />
      </div>
      <span style={{ fontSize: 5, color: theme.labelDim, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: theme.accentDim, fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── Theme-aware LED meter ──────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeterDom({ meterRef, theme }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: theme.meterBg, padding: '3px 2px', borderRadius: 2, border: `1px solid ${theme.meterBorder}`, position: 'relative', zIndex: 2 }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: theme.meterOff }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef, theme }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: theme.accentDim, letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2 }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level, theme) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#ffaa30' : theme.accent;
    segmentEls[i].style.background = lit ? col : theme.meterOff;
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-∞';
    const color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#ffaa30' : theme.accentDim;
    dbEl.style.color = color;
    dbEl.firstChild.textContent = display;
  }
}

// ─── Theme-aware mode button ────────────────────────────────────────────────
function ModeButton({ label, active, onClick, theme }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 6.5, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      letterSpacing: '0.12em', padding: '2.5px 7px', borderRadius: 2,
      background: active ? theme.accent : 'transparent',
      color: active ? '#060c14' : theme.labelDim,
      border: `1px solid ${active ? theme.accent : theme.accentVdim}`,
      cursor: 'pointer', transition: 'all 0.15s ease',
      minWidth: 28, textAlign: 'center',
      boxShadow: active ? theme.btnGlow : 'none',
      position: 'relative', zIndex: 2,
    }}>{label}</button>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',             engine: 0, mode: 0, manual: 0.5, rate: 0.3, depth: 0.5, regen: 0.5, mix: 0.5, width: 0.5, color: 0.5, drive: 0 },
  { name: 'JET PEDAL',       engine: 0, mode: 0, manual: 0.35,rate: 0.25,depth: 0.7, regen: 0.8, mix: 0.6, width: 0,   color: 0.4, drive: 0.15 },
  { name: 'WIDE RACK',       engine: 1, mode: 0, manual: 0.5, rate: 0.35,depth: 0.6, regen: 0.55,mix: 0.5, width: 0.7, color: 0.55,drive: 0 },
  { name: 'CROSSFIRE',       engine: 1, mode: 2, manual: 0.45,rate: 0.4, depth: 0.55,regen: 0.5, mix: 0.55,width: 0.8, color: 0.5, drive: 0 },
  { name: 'SOFT CHORUS',     engine: 1, mode: 3, manual: 0.6, rate: 0.2, depth: 0.35,regen: 0.2, mix: 0.45,width: 0.6, color: 0.6, drive: 0 },
  { name: 'THROUGH ZERO',    engine: 0, mode: 2, manual: 0.4, rate: 0.3, depth: 0.8, regen: 0.7, mix: 0.65,width: 0.4, color: 0.45,drive: 0.1 },
  { name: 'TAPE FLANGE',     engine: 0, mode: 1, manual: 0.55,rate: 0.15,depth: 0.9, regen: 0.6, mix: 0.7, width: 0.5, color: 0.35,drive: 0.25 },
  { name: 'METALLIC',        engine: 0, mode: 0, manual: 0.2, rate: 0.5, depth: 0.4, regen: 0.9, mix: 0.55,width: 0.3, color: 0.7, drive: 0.2 },
];

const MX_MODES  = ['CLASSIC', 'WIDE', 'TZ'];
const SBF_MODES = ['FL1', 'FL2', 'FL3', 'CHO'];

// ─── Main Flanger Orb ───────────────────────────────────────────────────────
export default function FlangerOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [engine,  setEngine]  = useState(initialState?.engine  ?? 0);
  const [mode,    setMode]    = useState(initialState?.mode    ?? 0);
  const [manual,  setManual]  = useState(initialState?.manual  ?? 0.5);
  const [rate,    setRate]    = useState(initialState?.rate    ?? 0.3);
  const [depth,   setDepth]   = useState(initialState?.depth   ?? 0.5);
  const [regen,   setRegen]   = useState(initialState?.regen   ?? 0.5);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 0.5);
  const [width,   setWidth]   = useState(initialState?.width   ?? 0.5);
  const [color,   setColor]   = useState(initialState?.color   ?? 0.5);
  const [drive,   setDrive]   = useState(initialState?.drive   ?? 0);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);

  // Current theme based on engine
  const th = engine === 0 ? THEMES.mx : THEMES.sbf;
  const presetColors = {
    bg: th.presetBg, text: th.accentHi, textDim: th.accentDim,
    border: th.accentVdim, hoverBg: th.accentBg, activeBg: th.accentBg,
  };

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);
  const themeRef    = useRef(th);
  themeRef.current  = th;

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, engine, mode, manual, rate, depth, regen, mix, width, color, drive, bypassed };

  // ── Engine init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createFlangerEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setEngine(s.engine);
      eng.setMode(s.mode);
      eng.setManual(s.manual);
      eng.setRate(s.rate);
      eng.setDepth(s.depth);
      eng.setRegen(s.regen);
      eng.setMix(s.mix);
      eng.setWidth(s.width);
      eng.setColor(s.color);
      eng.setDrive(s.drive);
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

  // ── Meter RAF — uses themeRef so meter colors follow engine switch ─────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak(), themeRef.current);
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak(), themeRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, engine, mode, manual, rate, depth, regen, mix, width, color, drive, bypassed, preset: activePreset });
  }, [inputGain, outputGain, engine, mode, manual, rate, depth, regen, mix, width, color, drive, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setEngine(p.engine); setMode(p.mode); setManual(p.manual); setRate(p.rate);
    setDepth(p.depth); setRegen(p.regen); setMix(p.mix); setWidth(p.width);
    setColor(p.color); setDrive(p.drive ?? 0);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setEngine(p.engine); e.setMode(p.mode); e.setManual(p.manual); e.setRate(p.rate);
      e.setDepth(p.depth); e.setRegen(p.regen); e.setMix(p.mix); e.setWidth(p.width);
      e.setColor(p.color); e.setDrive(p.drive ?? 0);
    }
  }, []);

  const switchEngine = useCallback((eng) => {
    setEngine(eng);
    setMode(0);
    engineRef.current?.setEngine(eng);
    engineRef.current?.setMode(0);
    setActivePreset(null);
  }, []);

  const switchMode = useCallback((m) => {
    setMode(m);
    engineRef.current?.setMode(m);
    setActivePreset(null);
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const modes = engine === 0 ? MX_MODES : SBF_MODES;

  return (
    <div style={{
      width: 380, borderRadius: 6, position: 'relative',
      background: th.panelGrad,
      border: `1.5px solid ${th.borderColor}`,
      boxShadow: th.outerGlow,
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
      transition: 'background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease',
    }}>
      {/* Sparkle overlay — reads theme in real time */}
      <SparkleOverlay theme={th} />

      {/* Header — z-index 10 so preset dropdown renders above knob/meter rows */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${th.dividerStrong}`,
        position: 'relative', zIndex: 10,
        background: th.headerGrad,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span key={engine} style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
            background: th.titleGrad,
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: th.titleGlow,
          }}>Dual Flanger</span>
          <span style={{ fontSize: 6, fontWeight: 700, color: th.labelDim, letterSpacing: '0.35em', marginTop: 2, textTransform: 'uppercase', transition: 'color 0.4s ease' }}>MXR + SBF-325</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: th.accentDim }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; e.currentTarget.style.background = 'transparent'; }}>×</span>}
        </div>
      </div>

      {/* Engine + Mode selector */}
      <div style={{
        padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: `1px solid ${th.divider}`,
        position: 'relative', zIndex: 2,
      }}>
        <div style={{ display: 'flex', gap: 3 }}>
          <ModeButton label="MX" active={engine === 0} onClick={() => switchEngine(0)} theme={th} />
          <ModeButton label="SBF" active={engine === 1} onClick={() => switchEngine(1)} theme={th} />
        </div>
        <div style={{ width: 1, height: 14, background: th.dividerStrong, margin: '0 2px' }} />
        <div style={{ display: 'flex', gap: 3 }}>
          {modes.map((m, i) => (
            <ModeButton key={m} label={m} active={mode === i} onClick={() => switchMode(i)} theme={th} />
          ))}
        </div>
      </div>

      {/* Meters + gain sliders */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: `1px solid ${th.divider}`, position: 'relative', zIndex: 2,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} theme={th}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }}
          format={v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'; }} />
        <LedMeterDom meterRef={inMeterRef} theme={th} />
        <DbReadoutDom dbRef={inDbRef} theme={th} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} theme={th} />
        <LedMeterDom meterRef={outMeterRef} theme={th} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} theme={th}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }}
          format={v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'; }} />
      </div>

      {/* Knobs row 1: MANUAL, RATE, DEPTH, REGEN */}
      <div style={{ padding: '7px 4px 3px', display: 'flex', justifyContent: 'space-around', borderBottom: `1px solid ${th.divider}`, position: 'relative', zIndex: 2 }}>
        <Knob label="MANUAL" value={manual} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setManual(v); engineRef.current?.setManual(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="RATE" value={rate} min={0} max={1} defaultValue={0.3} theme={th}
          onChange={v => { setRate(v); engineRef.current?.setRate(v); setActivePreset(null); }}
          size={28} format={v => {
            const hz = engine === 0 ? 0.05 * Math.pow(100, v) : 0.03 * Math.pow(333, v);
            return hz < 1 ? `${(hz * 1000).toFixed(0)}m` : `${hz.toFixed(1)}Hz`;
          }} />
        <Knob label="DEPTH" value={depth} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setDepth(v); engineRef.current?.setDepth(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="REGEN" value={regen} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setRegen(v); engineRef.current?.setRegen(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
      </div>

      {/* Knobs row 2: MIX, WIDTH, COLOR, DRIVE */}
      <div style={{ padding: '4px 4px 6px', display: 'flex', justifyContent: 'space-around', borderBottom: `1px solid ${th.divider}`, position: 'relative', zIndex: 2 }}>
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="WIDTH" value={width} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="COLOR" value={color} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setColor(v); engineRef.current?.setColor(v); setActivePreset(null); }}
          size={28} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'FLAT'} />
        <Knob label="DRIVE" value={drive} min={0} max={1} defaultValue={0} theme={th}
          onChange={v => { setDrive(v); engineRef.current?.setDrive(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
      </div>

      {/* Bypass */}
      <div style={{ padding: '5px 12px', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 2 }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          fontSize: 7, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 2,
          background: bypassed ? 'transparent' : th.accent,
          color: bypassed ? th.accentDim : '#060c14',
          border: `1.5px solid ${bypassed ? th.accentVdim : th.accent}`,
          cursor: 'pointer', transition: 'all 0.15s ease',
          boxShadow: bypassed ? 'none' : th.btnGlow,
        }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</button>
      </div>
    </div>
  );
}
