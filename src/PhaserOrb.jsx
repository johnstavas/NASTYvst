import { useState, useEffect, useRef, useCallback } from 'react';
import { createPhaserEngine } from './phaserEngine';
import PresetSelector from './PresetSelector';

// ─── Theme — deep violet/indigo with electric magenta ───────────────────────
const TH = {
  accent:       '#c855ff',
  accentHi:     '#e090ff',
  accentDim:    'rgba(200,85,255,0.45)',
  accentVdim:   'rgba(200,85,255,0.18)',
  accentBg:     'rgba(200,85,255,0.06)',
  label:        '#f0e8ff',
  labelDim:     'rgba(240,232,255,0.45)',
  panelGrad:    'linear-gradient(170deg, #1a0a2e 0%, #120820 25%, #0e0618 50%, #0a0414 75%, #12071e 100%)',
  borderColor:  'rgba(180,80,255,0.22)',
  outerGlow:    '0 4px 30px rgba(0,0,0,0.88), 0 0 24px rgba(160,60,255,0.14), 0 0 60px rgba(160,60,255,0.05), inset 0 1px 0 rgba(210,130,255,0.10)',
  headerGrad:   'linear-gradient(180deg, rgba(160,60,255,0.07) 0%, transparent 100%)',
  titleGrad:    'linear-gradient(135deg, #e090ff 0%, #c855ff 40%, #f5c8ff 70%, #c855ff 100%)',
  titleGlow:    'drop-shadow(0 0 10px rgba(200,85,255,0.55))',
  knobTop:      '#b898cc',
  knobMid:      '#3a2450',
  knobDark:     '#160a22',
  knobSpec:     'rgba(220,160,255,0.30)',
  knobStroke:   'rgba(180,120,240,0.15)',
  pointer:      '#f0e8ff',
  labelShadow:  '0 0 6px rgba(200,85,255,0.3)',
  sliderBg:     '#0a0414',
  sliderBorder: 'rgba(200,85,255,0.12)',
  sliderFill:   'rgba(200,85,255,0.12)',
  sliderGlow:   '0 0 6px rgba(200,85,255,0.5)',
  meterBg:      '#0a0414',
  meterBorder:  'rgba(200,85,255,0.1)',
  meterOff:     'rgba(200,85,255,0.06)',
  btnGlow:      '0 0 8px rgba(200,85,255,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
  divider:      'rgba(200,85,255,0.08)',
  dividerStrong:'rgba(200,85,255,0.13)',
  sparkHue:     [270, 325],  // violet → magenta
  sparkSat:     85,
  presetBg:     '#0e0620',
};

// ─── Phase wheel — 6 orbiting dots represent 6 allpass stages ───────────────
// Each dot orbits at the LFO phase, inner dots slightly behind (trail effect)
function PhaseWheel({ lfoPhaseRef, feedbackRef, stagesRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 90, H = 90;
    canvas.width = W * 2;
    canvas.height = H * 2;
    ctx.scale(2, 2);

    const cx = W / 2, cy = H / 2;

    let raf;
    const draw = () => {
      // Phosphor fade — dark fill for trail glow
      ctx.fillStyle = 'rgba(10,4,18,0.32)';
      ctx.fillRect(0, 0, W, H);

      const phase = lfoPhaseRef.current || 0;
      const fb    = feedbackRef.current || 0;
      const N     = stagesRef?.current || 6;
      const TWO_PI = Math.PI * 2;

      // N concentric guide rings
      for (let i = 0; i < N; i++) {
        const r = 6 + i * (36 / N);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TWO_PI);
        ctx.strokeStyle = `rgba(160,60,255,${0.05 + i * 0.02})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // N orbiting dots — each on its ring, slight spiral phase offset
      for (let i = 0; i < N; i++) {
        const r = 6 + i * (36 / N);
        const trailOffset = (N - 1 - i) * 0.018;
        const dotPhase = phase - trailOffset;
        const angle = dotPhase * TWO_PI - Math.PI / 2;

        const dx = cx + Math.cos(angle) * r;
        const dy = cy + Math.sin(angle) * r;

        const hue   = 270 + fb * 70 + i * (50 / N);
        const norm  = i / (N - 1);
        const size  = 1.6 + norm * 1.6 + fb * 1.0;
        const alpha = 0.3 + norm * 0.5 + fb * 0.18;

        // Glow halo
        ctx.beginPath();
        ctx.arc(dx, dy, size * 2.5, 0, TWO_PI);
        ctx.fillStyle = `hsla(${hue}, 100%, 65%, ${alpha * 0.14})`;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(dx, dy, size, 0, TWO_PI);
        ctx.fillStyle = `hsla(${hue}, 100%, 75%, ${alpha})`;
        ctx.fill();
      }

      // Center glow orb
      const centerHue = 280 + fb * 50;
      const centerSize = 2.5 + fb * 2.0;
      ctx.beginPath();
      ctx.arc(cx, cy, centerSize * 2.2, 0, TWO_PI);
      ctx.fillStyle = `hsla(${centerHue}, 80%, 60%, 0.12)`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, centerSize, 0, TWO_PI);
      ctx.fillStyle = `hsla(${centerHue}, 80%, 78%, 0.7)`;
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      width: 90, height: 90,
      borderRadius: '50%',
      border: '1px solid rgba(160,60,255,0.25)',
      background: 'rgba(10,4,18,0.6)',
      boxShadow: '0 0 18px rgba(160,60,255,0.15)',
    }} />
  );
}

// ─── Sparkle overlay ─────────────────────────────────────────────────────────
function SparkleOverlay() {
  const canvasRef = useRef(null);
  const particles = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 500;
    canvas.width = W * 2;
    canvas.height = H * 2;
    ctx.scale(2, 2);

    if (!particles.current) {
      const pts = [];
      const [hMin, hMax] = TH.sparkHue;
      for (let i = 0; i < 320; i++) {
        pts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.3 + Math.random() * 1.1,
          brightness: 0.12 + Math.random() * 0.85,
          speed: 0.3 + Math.random() * 2.2,
          phase: Math.random() * Math.PI * 2,
          hue: hMin + Math.random() * (hMax - hMin),
          bright: Math.random() < 0.12,
        });
      }
      particles.current = pts;
    }

    let raf;
    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      const pts = particles.current;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const twinkle = 0.3 + 0.7 * Math.pow((Math.sin(t * 0.001 * p.speed + p.phase) + 1) * 0.5, 2);
        const alpha = p.brightness * twinkle;

        if (p.bright && twinkle > 0.72) {
          const fl = p.r * 4 * twinkle;
          ctx.strokeStyle = `hsla(${p.hue}, ${TH.sparkSat}%, 85%, ${alpha * 0.75})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x - fl, p.y); ctx.lineTo(p.x + fl, p.y);
          ctx.moveTo(p.x, p.y - fl); ctx.lineTo(p.x, p.y + fl);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (p.bright ? twinkle * 1.5 : 1), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, ${TH.sparkSat}%, ${p.bright ? 90 : 75}%, ${alpha})`;
        ctx.fill();

        if (alpha > 0.4) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, ${TH.sparkSat - 10}%, 70%, ${alpha * 0.14})`;
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
      mixBlendMode: 'screen', opacity: 0.85,
    }} />
  );
}

// ─── Knob ────────────────────────────────────────────────────────────────────
function PhaserKnob({ size = 40, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const id = useRef(`ph-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  const lx1 = cx + r * 0.15 * Math.cos(rad), ly1 = cy + r * 0.15 * Math.sin(rad);
  const lx2 = cx + r * 0.82 * Math.cos(rad), ly2 = cy + r * 0.82 * Math.sin(rad);
  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-b`} cx="35%" cy="25%" r="75%">
          <stop offset="0%"   stopColor={TH.knobTop} />
          <stop offset="35%"  stopColor={TH.knobMid} />
          <stop offset="80%"  stopColor={TH.knobDark} />
          <stop offset="100%" stopColor={TH.knobDark} />
        </radialGradient>
        <radialGradient id={`${id}-s`} cx="30%" cy="20%" r="40%">
          <stop offset="0%"   stopColor={TH.knobSpec} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="rgba(0,0,0,0.65)" />
        </filter>
      </defs>
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-b)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill={`url(#${id}-s)`} />
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="none" stroke={TH.knobStroke} strokeWidth={0.8} />
      <line x1={lx1 + 4} y1={ly1 + 4} x2={lx2 + 4} y2={ly2 + 4}
        stroke={TH.pointer} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 38, format, sensitivity = 160 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => {
      const raw = ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity;
      onChange(Math.max(min, Math.min(max, raw)));
    };
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <PhaserKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: TH.label, fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1.2, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', textShadow: TH.labelShadow }}>{label}</span>
      <span style={{ fontSize: 5.5, color: TH.accentDim, fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// ─── Vertical slider ─────────────────────────────────────────────────────────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{ width: 10, height, background: TH.sliderBg, borderRadius: 2, border: `1px solid ${TH.sliderBorder}`, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: TH.sliderFill, borderRadius: 1 }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: TH.accent, bottom: `calc(${norm * 100}% - 2px)`, boxShadow: TH.sliderGlow }} />
      </div>
      <span style={{ fontSize: 5, color: TH.labelDim, fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: TH.accentDim, fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── LED meter ───────────────────────────────────────────────────────────────
const SEGS = 16;
function LedMeterDom({ meterRef }) {
  const cRef = useRef(null);
  useEffect(() => { if (cRef.current) meterRef.current = cRef.current.children; }, []);
  return (
    <div ref={cRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: TH.meterBg, padding: '3px 2px', borderRadius: 2, border: `1px solid ${TH.meterBorder}`, position: 'relative', zIndex: 2 }}>
      {Array.from({ length: SEGS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: TH.meterOff }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: TH.accentDim, letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2 }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(els, dbEl, level) {
  if (!els?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < SEGS; i++) {
    const t = -40 + (i / SEGS) * 46;
    const lit = dB > t;
    const col = i >= SEGS - 2 ? '#ff4040' : i >= SEGS - 4 ? '#ffaa30' : TH.accent;
    els[i].style.background = lit ? col : TH.meterOff;
  }
  if (dbEl) {
    const v = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const s = v > -60 ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '-∞';
    const c = v > -1 ? '#ff4040' : v > -6 ? '#ffaa30' : TH.accentDim;
    dbEl.style.color = c;
    dbEl.firstChild.textContent = s;
  }
}

// ─── Mode button ─────────────────────────────────────────────────────────────
function ModeBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 6.5, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      letterSpacing: '0.12em', padding: '2.5px 9px', borderRadius: 2,
      background: active ? TH.accent : 'transparent',
      color: active ? '#0e0618' : TH.labelDim,
      border: `1px solid ${active ? TH.accent : TH.accentVdim}`,
      cursor: 'pointer', transition: 'all 0.15s ease',
      boxShadow: active ? TH.btnGlow : 'none',
      position: 'relative', zIndex: 2,
    }}>{label}</button>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',        rate: 0.30, depth: 0.70, feedback: 0.55, mix: 0.50, freq: 0.35, spread: 0.50, phase: 0.25, mode: 0 },
  { name: 'CLASSIC 70S', rate: 0.25, depth: 0.80, feedback: 0.62, mix: 0.50, freq: 0.30, spread: 0.45, phase: 0.20, mode: 0 },
  { name: 'JET SWEEP',   rate: 0.65, depth: 0.95, feedback: 0.75, mix: 0.55, freq: 0.25, spread: 0.65, phase: 0.30, mode: 1 },
  { name: 'SLOW HAZE',   rate: 0.15, depth: 0.60, feedback: 0.45, mix: 0.48, freq: 0.40, spread: 0.40, phase: 0.35, mode: 0 },
  { name: 'RESONANT',    rate: 0.30, depth: 0.65, feedback: 0.88, mix: 0.50, freq: 0.45, spread: 0.30, phase: 0.20, mode: 0 },
  { name: 'WIDE STEREO', rate: 0.38, depth: 0.75, feedback: 0.60, mix: 0.52, freq: 0.38, spread: 0.55, phase: 0.50, mode: 1 },
  { name: 'DEEP SPACE',  rate: 0.12, depth: 0.90, feedback: 0.70, mix: 0.55, freq: 0.22, spread: 0.65, phase: 0.30, mode: 1 },
];

const presetColors = {
  bg: TH.presetBg, text: TH.accentHi, textDim: TH.accentDim,
  border: TH.accentVdim, hoverBg: TH.accentBg, activeBg: TH.accentBg,
};

// ─── Rate display helper ──────────────────────────────────────────────────────
function fmtRate(v) {
  const hz = 0.03 * Math.pow(333.0, v);
  if (hz < 1.0) return `${(hz * 1000).toFixed(0)}m`;
  return `${hz.toFixed(1)}Hz`;
}

function fmtPct(v) { return `${Math.round(v * 100)}%`; }

function fmtFreq(v) {
  const hz = 100 * Math.pow(40.0, v);
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
}

function fmtSpread(v) {
  const r = 2.0 + v * v * 13.0;
  return `${r.toFixed(1)}×`;
}

function fmtDeg(v) { return `${Math.round(v * 180)}°`; }

// ─── Main PhaserOrb ──────────────────────────────────────────────────────────
export default function PhaserOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [rate,     setRate]     = useState(initialState?.rate     ?? 0.30);
  const [depth,    setDepth]    = useState(initialState?.depth    ?? 0.70);
  const [feedback, setFeedback] = useState(initialState?.feedback ?? 0.55);
  const [mix,      setMix]      = useState(initialState?.mix      ?? 0.50);
  const [freq,     setFreq]     = useState(initialState?.freq     ?? 0.35);
  const [spread,   setSpread]   = useState(initialState?.spread   ?? 0.50);
  const [phase,    setPhase]    = useState(initialState?.phase    ?? 0.25);
  const [mode,     setMode]     = useState(initialState?.mode     ?? 0);
  const [stages,   setStages]   = useState(initialState?.stages   ?? 6);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);

  // Refs for phase wheel canvas
  const lfoPhaseRef  = useRef(0);
  const feedbackRef  = useRef(feedback);
  const stagesRef    = useRef(stages);
  feedbackRef.current = feedback;
  stagesRef.current   = stages;

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, rate, depth, feedback, mix, freq, spread, phase, mode, stages, bypassed };

  // ── Engine init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createPhaserEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setRate(s.rate);
      eng.setDepth(s.depth);
      eng.setFeedback(s.feedback);
      eng.setMix(s.mix);
      eng.setFreq(s.freq);
      eng.setSpread(s.spread);
      eng.setPhase(s.phase);
      eng.setMode(s.mode);
      eng.setStages(s.stages);
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

  // ── Meter + LFO phase RAF ─────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        lfoPhaseRef.current = engineRef.current.getLfoPhase();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, {
      inputGain, outputGain, rate, depth, feedback, mix, freq, spread, phase, mode, stages, bypassed, preset: activePreset,
    });
  }, [inputGain, outputGain, rate, depth, feedback, mix, freq, spread, phase, mode, stages, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setRate(p.rate); setDepth(p.depth); setFeedback(p.feedback); setMix(p.mix);
    setFreq(p.freq); setSpread(p.spread); setPhase(p.phase); setMode(p.mode ?? 0);
    if (p.stages !== undefined) setStages(p.stages);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setRate(p.rate); e.setDepth(p.depth); e.setFeedback(p.feedback); e.setMix(p.mix);
      e.setFreq(p.freq); e.setSpread(p.spread); e.setPhase(p.phase); e.setMode(p.mode ?? 0);
      if (p.stages !== undefined) e.setStages(p.stages);
    }
  }, []);

  const dbFmt = v => {
    const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity;
    return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞';
  };

  // Clear preset name when any knob moves
  const clearPreset = () => setActivePreset(null);

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: TH.panelGrad,
      border: `1.5px solid ${TH.borderColor}`,
      boxShadow: TH.outerGlow,
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      <SparkleOverlay />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${TH.dividerStrong}`,
        position: 'relative', zIndex: 10,
        background: TH.headerGrad, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
            background: TH.titleGrad,
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: TH.titleGlow,
          }}>Phase Orbit</span>
          <span style={{ fontSize: 6, fontWeight: 700, color: TH.labelDim, letterSpacing: '0.35em', marginTop: 2, textTransform: 'uppercase' }}>6-Stage Allpass</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: TH.accentDim }}>...</span>}
          {onRemove && (
            <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; e.currentTarget.style.background = 'transparent'; }}
              title="Remove">×</span>
          )}
        </div>
      </div>

      {/* ── Mode row ────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: `1px solid ${TH.divider}`,
        position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <span style={{ fontSize: 6, fontWeight: 700, color: TH.labelDim, letterSpacing: '0.2em', marginRight: 2 }}>SWEEP</span>
        <ModeBtn label="LIN" active={mode === 0} onClick={() => { setMode(0); engineRef.current?.setMode(0); clearPreset(); }} />
        <ModeBtn label="EXP" active={mode === 1} onClick={() => { setMode(1); engineRef.current?.setMode(1); clearPreset(); }} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 6, fontWeight: 600, color: TH.accentDim, letterSpacing: '0.1em' }}>
          {fmtRate(rate)} • {Math.round(Math.pow(feedback, 0.5) * 90)}% FB
        </span>
      </div>

      {/* ── Meters + gain sliders ────────────────────────────────────────────── */}
      <div style={{
        padding: '5px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: `1px solid ${TH.divider}`, position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }}
          format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }}
          format={dbFmt} />
      </div>

      {/* ── Phase wheel visualization ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: '7px 0 5px',
        borderBottom: `1px solid ${TH.divider}`,
        position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <PhaseWheel lfoPhaseRef={lfoPhaseRef} feedbackRef={feedbackRef} stagesRef={stagesRef} />
        <div style={{ position: 'absolute', right: 14, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <span style={{ fontSize: 5.5, color: TH.accentDim, fontFamily: '"Courier New",monospace', letterSpacing: '0.05em' }}>{stages} STAGES</span>
          <span style={{ fontSize: 5.5, color: TH.accentDim, fontFamily: '"Courier New",monospace', letterSpacing: '0.05em' }}>{fmtRate(rate)}</span>
          <span style={{ fontSize: 5.5, color: TH.accentDim, fontFamily: '"Courier New",monospace', letterSpacing: '0.05em' }}>{fmtFreq(freq)}–{fmtFreq(Math.min(0.99, freq + 0.3))}Hz</span>
        </div>
      </div>

      {/* ── Knobs row 1: RATE, DEPTH, FEEDBACK, MIX ─────────────────────────── */}
      <div style={{
        padding: '7px 4px 3px', display: 'flex', justifyContent: 'space-around',
        borderBottom: `1px solid ${TH.divider}`, position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="RATE" value={rate} defaultValue={0.30}
          onChange={v => { setRate(v); engineRef.current?.setRate(v); clearPreset(); }}
          size={34} format={fmtRate} />
        <Knob label="DEPTH" value={depth} defaultValue={0.70}
          onChange={v => { setDepth(v); engineRef.current?.setDepth(v); clearPreset(); }}
          size={34} format={fmtPct} />
        <Knob label="FEEDBACK" value={feedback} defaultValue={0.55}
          onChange={v => { setFeedback(v); engineRef.current?.setFeedback(v); clearPreset(); }}
          size={34} format={v => `${Math.round(Math.pow(v, 0.5) * 90)}%`} />
        <Knob label="MIX" value={mix} defaultValue={0.50}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); clearPreset(); }}
          size={34} format={fmtPct} />
      </div>

      {/* ── Knobs row 2: FREQ, SPREAD, PHASE ────────────────────────────────── */}
      <div style={{
        padding: '4px 4px 6px', display: 'flex', justifyContent: 'space-around',
        borderBottom: `1px solid ${TH.divider}`, position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="FREQ" value={freq} defaultValue={0.35}
          onChange={v => { setFreq(v); engineRef.current?.setFreq(v); clearPreset(); }}
          size={34} format={v => `${fmtFreq(v)}Hz`} />
        <Knob label="SPREAD" value={spread} defaultValue={0.50}
          onChange={v => { setSpread(v); engineRef.current?.setSpread(v); clearPreset(); }}
          size={34} format={fmtSpread} />
        <Knob label="PHASE" value={phase} defaultValue={0.25}
          onChange={v => { setPhase(v); engineRef.current?.setPhase(v); clearPreset(); }}
          size={34} format={fmtDeg} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, userSelect: 'none', position: 'relative', zIndex: 2, width: 34 + 16, justifyContent: 'center' }}>
          <span style={{ fontSize: 6, fontWeight: 700, color: TH.labelDim, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>STAGES</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {[4, 6, 8].map(n => (
              <button key={n} onClick={() => { setStages(n); engineRef.current?.setStages(n); clearPreset(); }} style={{
                fontSize: 7, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
                letterSpacing: '0.05em', padding: '3px 5px', borderRadius: 2,
                background: stages === n ? TH.accent : 'transparent',
                color: stages === n ? '#0e0618' : TH.labelDim,
                border: `1px solid ${stages === n ? TH.accent : TH.accentVdim}`,
                cursor: 'pointer', transition: 'all 0.12s ease',
                boxShadow: stages === n ? TH.btnGlow : 'none',
                minWidth: 14,
              }}>{n}</button>
            ))}
          </div>
          <span style={{ fontSize: 5, color: TH.accentDim, fontFamily: '"Courier New",monospace', fontWeight: 600 }}>
            {stages === 4 ? '2 notch' : stages === 6 ? '3 notch' : '4 notch'}
          </span>
        </div>
      </div>

      {/* ── Bypass ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '5px 12px', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          fontSize: 7, fontWeight: 800, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 2,
          background: bypassed ? 'transparent' : TH.accent,
          color: bypassed ? TH.accentDim : '#0e0618',
          border: `1.5px solid ${bypassed ? TH.accentVdim : TH.accent}`,
          cursor: 'pointer', transition: 'all 0.15s ease',
          boxShadow: bypassed ? 'none' : TH.btnGlow,
        }}>{bypassed ? 'BYPASSED' : 'ACTIVE'}</button>
      </div>
    </div>
  );
}
