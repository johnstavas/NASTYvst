import { useState, useEffect, useRef, useCallback } from 'react';
import { createLA2AEngine } from './la2aEngine';
import PresetSelector from './PresetSelector';

// ─── Chicken-head knob (Audioscape AS-2A style) ──────────────────────────────
// Black trapezoid pointer with white indicator stripe. Around it lives a
// printed cream scale ring with 0-100 numbers in an italic serif — exactly
// like the photo. The ring is a separate layer so the knob rotates over it.
function ChickenHeadKnob({ size = 54, norm = 0 }) {
  const cx = size / 2, cy = size / 2;
  const sweep = 270;
  const startDeg = -135;
  const angle = startDeg + norm * sweep;
  const id = useRef(`ck-${Math.random().toString(36).slice(2, 7)}`).current;

  return (
    <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        {/* Black plastic body with top-left highlight */}
        <radialGradient id={`${id}-body`} cx="35%" cy="28%" r="75%">
          <stop offset="0%"   stopColor="#4a4a4a" />
          <stop offset="45%"  stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#000000" />
        </radialGradient>
        <radialGradient id={`${id}-hi`} cx="32%" cy="22%" r="48%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.45)" />
          <stop offset="60%"  stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="rgba(0,0,0,0.6)" />
        </filter>
      </defs>

      {/* Knob body */}
      <g transform={`rotate(${angle} ${cx} ${cy})`}>
        {/* Chicken-head pointer — wedge shape, points outward toward the scale */}
        <path
          d={`
            M ${cx - size*0.11} ${cy + size*0.08}
            L ${cx + size*0.11} ${cy + size*0.08}
            L ${cx + size*0.05} ${cy - size*0.42}
            L ${cx - size*0.05} ${cy - size*0.42}
            Z
          `}
          fill={`url(#${id}-body)`}
          stroke="#000"
          strokeWidth={0.6}
          filter={`url(#${id}-sh)`}
        />
        {/* Central hub */}
        <circle cx={cx} cy={cy} r={size * 0.22} fill={`url(#${id}-body)`} stroke="#000" strokeWidth={0.6} />
        <circle cx={cx} cy={cy} r={size * 0.22} fill={`url(#${id}-hi)`} />
        {/* White indicator line on the pointer tip */}
        <line
          x1={cx} y1={cy - size*0.1}
          x2={cx} y2={cy - size*0.38}
          stroke="#fafafa"
          strokeWidth={1.3}
          strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={size * 0.035} fill="rgba(255,255,255,0.4)" />
      </g>
    </svg>
  );
}

// ─── Scale ring — printed 0..100 numbers and tick marks around a knob ───────
// Sans-serif numbers. Ring is sized RELATIVE to the knob so centering is
// exact regardless of knob size.
function ScaleRing({ knobSize }) {
  const ringSize = knobSize + 36;           // outer scale SVG
  const cx = ringSize / 2;
  const cy = ringSize / 2;
  const rTick = knobSize / 2 + 5;           // tick outer radius
  const rText = knobSize / 2 + 13;          // number centerline radius
  const numbers = [0, 20, 40, 60, 80, 100]; // show fewer numbers — cleaner
  const sweep = 270;
  const startDeg = -135;

  return (
    <svg
      width={ringSize}
      height={ringSize}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      {/* Tick marks */}
      {Array.from({ length: 21 }).map((_, i) => {
        const t = i / 20;
        const a = startDeg + t * sweep;
        const rr = (a - 90) * Math.PI / 180;
        const major = i % 2 === 0;
        const len = major ? 4 : 2;
        return (
          <line key={i}
            x1={cx + Math.cos(rr) * (rTick - len)} y1={cy + Math.sin(rr) * (rTick - len)}
            x2={cx + Math.cos(rr) * rTick}         y2={cy + Math.sin(rr) * rTick}
            stroke="#1a1410" strokeWidth={major ? 0.9 : 0.5}
          />
        );
      })}
      {/* Numbers — clean sans-serif */}
      {numbers.map((n, i) => {
        const t = i / (numbers.length - 1);
        const a = startDeg + t * sweep;
        const rr = (a - 90) * Math.PI / 180;
        const lx = cx + Math.cos(rr) * rText;
        const ly = cy + Math.sin(rr) * rText + 2;
        return (
          <text key={n}
            x={lx} y={ly}
            fontSize={6}
            fill="#1a1410"
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, Arial, sans-serif"
            fontWeight={600}>
            {n}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Drag wrapper for the knob ───────────────────────────────────────────────
// Outer wrapper is the scale-ring size. Knob is absolutely centered inside
// via flex — no fragile offset math. Label + readout live as DOM siblings
// below so their font is controlled by CSS, not SVG.
function Knob({ label, value, min = 0, max = 1, defaultValue, onChange, size = 54, format }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const ringSize = size + 36;

  const onDown = e => {
    e.preventDefault();
    setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => {
      const dy = ref.current.y - ev.clientY;
      onChange(Math.max(min, Math.min(max, ref.current.v + dy * (max - min) / 160)));
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
      <div style={{
        position: 'relative',
        width: ringSize,
        height: ringSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <ScaleRing knobSize={size} />
        <div
          onPointerDown={onDown}
          onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
          style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab', position: 'relative', zIndex: 1 }}
        >
          <ChickenHeadKnob size={size} norm={norm} />
        </div>
      </div>
      <span style={{
        fontSize: 6.5,
        color: '#1a1410',
        fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        marginTop: 2,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5,
        color: 'rgba(26,20,16,0.55)',
        fontFamily: '"Courier New",monospace',
        fontWeight: 700,
        marginTop: 1,
      }}>{display}</span>
    </div>
  );
}

// ─── Mini toggle switch — silver bat handle ──────────────────────────────────
function ToggleSwitch({ up, onToggle, labelTop, labelBot }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none', gap: 1 }}>
      <span style={{ fontSize: 6, color: '#1a1410', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 700, letterSpacing: '0.1em', minHeight: 8 }}>
        {labelTop}
      </span>
      <svg width={14} height={24} onClick={onToggle} style={{ cursor: 'pointer' }}>
        <defs>
          <radialGradient id="tgl-base" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#ddd" />
            <stop offset="70%" stopColor="#555" />
            <stop offset="100%" stopColor="#222" />
          </radialGradient>
          <linearGradient id="tgl-bat" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#bbb" />
            <stop offset="45%"  stopColor="#f4f4f4" />
            <stop offset="100%" stopColor="#444" />
          </linearGradient>
        </defs>
        {/* Base bezel */}
        <circle cx={7} cy={12} r={5} fill="url(#tgl-base)" stroke="#000" strokeWidth={0.5} />
        <circle cx={7} cy={12} r={3} fill="#111" />
        {/* Bat handle */}
        <rect
          x={5}
          y={up ? 1 : 12}
          width={4}
          height={11}
          rx={1.2}
          fill="url(#tgl-bat)"
          stroke="#000"
          strokeWidth={0.4}
        />
        {/* Tip highlight */}
        <circle cx={7} cy={up ? 2 : 22} r={1.6} fill="#e8e8e8" stroke="#000" strokeWidth={0.3} />
      </svg>
      <span style={{ fontSize: 6, color: '#1a1410', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 700, letterSpacing: '0.1em', minHeight: 8 }}>
        {labelBot}
      </span>
    </div>
  );
}

// ─── HF button — small round black push button ──────────────────────────────
function HfButton({ active, onClick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none', gap: 3 }}>
      <button
        onClick={onClick}
        style={{
          width: 32, height: 16, borderRadius: 8,
          background: active
            ? 'linear-gradient(180deg, #c8944a 0%, #a87530 50%, #8a5e20 100%)'
            : 'linear-gradient(180deg, #4a4540 0%, #2a2520 50%, #1a1510 100%)',
          border: `1.5px solid ${active ? '#d4a050' : '#0a0805'}`,
          boxShadow: active
            ? 'inset 0 1px 1px rgba(255,255,255,0.3), 0 0 6px rgba(200,148,74,0.5)'
            : 'inset 0 1px 1px rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.5)',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.15s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="R37 mod — HF sidechain emphasis"
      >
        <span style={{
          fontSize: 7, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          fontWeight: 800, letterSpacing: '0.08em', color: active ? '#fff' : '#888',
          textShadow: active ? '0 0 3px rgba(255,255,255,0.3)' : 'none',
        }}>R37</span>
      </button>
      <span style={{ fontSize: 5.5, color: '#6a6050', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.08em' }}>
        HF EMPH
      </span>
    </div>
  );
}

// ─── Juice button — LF harmonic sweetener ───────────────────────────────────
function JuiceButton({ active, onClick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none', gap: 3 }}>
      <button
        onClick={onClick}
        style={{
          width: 32, height: 16, borderRadius: 8,
          background: active
            ? 'linear-gradient(180deg, #c06030 0%, #a04820 50%, #803818 100%)'
            : 'linear-gradient(180deg, #4a4540 0%, #2a2520 50%, #1a1510 100%)',
          border: `1.5px solid ${active ? '#d07040' : '#0a0805'}`,
          boxShadow: active
            ? 'inset 0 1px 1px rgba(255,255,255,0.3), 0 0 6px rgba(192,96,48,0.5)'
            : 'inset 0 1px 1px rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.5)',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.15s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="LF harmonic sweetener — subtle low-end warmth"
      >
        <span style={{
          fontSize: 6.5, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          fontWeight: 800, letterSpacing: '0.06em', color: active ? '#fff' : '#888',
          textShadow: active ? '0 0 3px rgba(255,255,255,0.3)' : 'none',
        }}>JUICE</span>
      </button>
      <span style={{ fontSize: 5.5, color: '#6a6050', fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.08em' }}>
        LF WARM
      </span>
    </div>
  );
}

// ─── VU meter — dark navy face, white scale, red zone, hanging needle ───────
// Shows Gain Reduction scale (0 at right, up to -20 at left). Matches the
// centered VU on the real Audioscape AS-2A.
function VuMeter({ grDb, outLevel, mode /* 'gr' | 'out4' | 'out10' */ }) {
  // When mode === 'gr' we show gain reduction. The needle sits at the RIGHT
  // (0 dB) at rest and swings LEFT as GR increases.
  // When mode === 'out4' / 'out10' we show output VU (RMS-ish).
  let norm;
  if (mode === 'gr') {
    norm = Math.min(1, Math.max(0, (-grDb) / 20));  // 0..20 dB GR
  } else {
    // VU from RMS — cal ×4 is more sensitive than ×10
    const db = outLevel > 1e-6 ? 20 * Math.log10(outLevel) : -80;
    const refDb = mode === 'out4' ? -24 : -18;   // ×4 shows lower levels
    norm = Math.min(1, Math.max(0, (db - refDb) / 24 + 0.5));
  }
  // For GR: 0 norm → needle far right, 1 norm → needle far left
  // For VU: 0 norm → needle far left, 1 norm → needle far right
  const angleDeg = mode === 'gr'
    ? (50 - norm * 100)   // right → left
    : (-50 + norm * 100); // left → right

  // Geometry — arc must fit inside the viewport with the edge number labels
  // (0 and 20 for GR) still visible. cy is slightly BELOW the SVG so the
  // pivot point is hidden and the needle appears to sweep from offscreen.
  const W = 150, H = 88;
  const cx = W / 2, cy = H + 4;
  const r = 70;
  const rad = (angleDeg - 90) * Math.PI / 180;
  const nx = cx + Math.cos(rad) * r;
  const ny = cy + Math.sin(rad) * r;

  // Tick positions. GR uses 0..20 scale; VU uses -20..+3
  const grTicks = [0, 5, 10, 15, 20];
  const vuTicks = [-20, -10, -7, -5, -3, -1, 0, 1, 2, 3];

  return (
    <svg width={W} height={H} style={{
      display: 'block',
      background: '#f8f2e0',
      border: '2px solid #000',
      borderRadius: 1,
      boxShadow: 'inset 0 0 6px rgba(0,0,0,0.35)',
    }}>
      <defs>
        <linearGradient id="vu-face" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#f8efd0" />
          <stop offset="50%"  stopColor="#f4e8c4" />
          <stop offset="100%" stopColor="#e8dab0" />
        </linearGradient>
        <radialGradient id="vu-gloss" cx="50%" cy="0%" r="80%">
          <stop offset="0%"  stopColor="rgba(255,255,255,0.25)" />
          <stop offset="70%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#vu-face)" />

      {/* Scale arc */}
      <path
        d={`M ${cx + Math.cos((-50-90)*Math.PI/180)*r} ${cy + Math.sin((-50-90)*Math.PI/180)*r}
            A ${r} ${r} 0 0 1 ${cx + Math.cos((50-90)*Math.PI/180)*r} ${cy + Math.sin((50-90)*Math.PI/180)*r}`}
        fill="none" stroke="#1a1410" strokeWidth={0.9}
      />
      {/* Red zone on the hot side (right for VU modes, left for GR mode) */}
      {mode !== 'gr' && (
        <path
          d={`M ${cx + Math.cos((25-90)*Math.PI/180)*r} ${cy + Math.sin((25-90)*Math.PI/180)*r}
              A ${r} ${r} 0 0 1 ${cx + Math.cos((50-90)*Math.PI/180)*r} ${cy + Math.sin((50-90)*Math.PI/180)*r}`}
          fill="none" stroke="#c53025" strokeWidth={1.8}
        />
      )}
      {/* No red zone for GR mode — red only applies to VU output clipping */}

      {/* Tick marks (41 total — major every 10 aligns with 0/5/10/15/20 GR labels) */}
      {Array.from({ length: 41 }).map((_, i) => {
        const t = i / 40;
        const a = -50 + t * 100;
        const rr = (a - 90) * Math.PI / 180;
        const major = i % 10 === 0;
        const mid = i % 5 === 0 && !major;
        const len = major ? 7 : mid ? 4 : 2;
        return (
          <line key={i}
            x1={cx + Math.cos(rr) * (r + 1)} y1={cy + Math.sin(rr) * (r + 1)}
            x2={cx + Math.cos(rr) * (r + 1 + len)} y2={cy + Math.sin(rr) * (r + 1 + len)}
            stroke="#1a1410"
            strokeWidth={major ? 0.9 : 0.5}
          />
        );
      })}

      {/* Scale numbers */}
      {(mode === 'gr' ? grTicks : vuTicks).map((n, i) => {
        let t;
        if (mode === 'gr') {
          t = 1 - (n / 20);   // 0 at right, 20 at left
        } else {
          t = (n - (-20)) / 23;  // -20..+3 mapped to 0..1
        }
        const a = -50 + t * 100;
        const rr = (a - 90) * Math.PI / 180;
        const lx = cx + Math.cos(rr) * (r + 12);
        const ly = cy + Math.sin(rr) * (r + 12) + 2;
        const isRed = mode !== 'gr' && n > 0;  // red zone only on VU output modes (clipping), never on GR
        return (
          <text key={n}
            x={lx} y={ly}
            fontSize={6}
            fill={isRed ? '#c53025' : '#1a1410'}
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, Arial, sans-serif"
            fontWeight={600}>
            {n}
          </text>
        );
      })}

      {/* Label — VU */}
      <text x={cx} y={H - 20}
        fontSize={9}
        fill="#1a1410"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, Arial, sans-serif"
        fontWeight={800}
        letterSpacing="0.08em">
        VU
      </text>
      <text x={cx} y={H - 11}
        fontSize={5}
        fill="rgba(26,20,16,0.6)"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, Arial, sans-serif"
        fontWeight={600}
        letterSpacing="0.18em">
        {mode === 'gr' ? 'GAIN REDUCTION' : mode === 'out4' ? 'OUTPUT ×4' : 'OUTPUT ×10'}
      </text>

      {/* Needle */}
      <line x1={cx + 0.5} y1={cy + 0.5} x2={nx + 0.5} y2={ny + 0.5}
        stroke="rgba(0,0,0,0.45)" strokeWidth={1.8} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx} y2={ny}
        stroke="#1a1410" strokeWidth={1.2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="#1a1410" />

      {/* Glass gloss */}
      <rect x={0} y={0} width={W} height={H} fill="url(#vu-gloss)" />
    </svg>
  );
}

// ─── Rack ear — silver tab with bolt dots ────────────────────────────────────
function RackEar({ side }) {
  return (
    <div style={{
      width: 14,
      background: 'linear-gradient(180deg,#d4d0c4 0%,#b8b4a8 50%,#98948c 100%)',
      borderLeft: side === 'right' ? '1px solid #000' : 'none',
      borderRight: side === 'left' ? '1px solid #000' : 'none',
      boxShadow: 'inset 0 0 4px rgba(0,0,0,0.3)',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 0',
    }}>
      {[0, 1].map(i => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, #666 0%, #000 80%)',
          border: '0.5px solid #000',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.15)',
        }} />
      ))}
    </div>
  );
}

// ─── Factory presets ─────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',        peakReduction: 0.45, gain:  0, limitMode: false, hfEmphasis: false, juice: false },
  { name: 'GENTLE',      peakReduction: 0.25, gain:  5, limitMode: false, hfEmphasis: false, juice: false },
  { name: 'VOCAL',       peakReduction: 0.5,  gain:  8, limitMode: false, hfEmphasis: true,  juice: false },
  { name: 'BASS GLUE',   peakReduction: 0.4,  gain:  6, limitMode: false, hfEmphasis: false, juice: true  },
  { name: 'DRUM CRUSH',  peakReduction: 0.75, gain: 12, limitMode: true,  hfEmphasis: false, juice: false },
  { name: 'WARM LIMIT',  peakReduction: 0.6,  gain: 10, limitMode: true,  hfEmphasis: true,  juice: true  },
  { name: 'TRANSPARENT', peakReduction: 0.2,  gain:  3, limitMode: false, hfEmphasis: false, juice: false },
];

// ─── Main component ──────────────────────────────────────────────────────────
export default function LA2AOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  // Controls — LA-2A is famously minimal
  const [peakReduction, setPeakReduction] = useState(initialState?.peakReduction ?? 0.45);
  const [gain,          setGain]          = useState(initialState?.gain          ?? 0);
  const [limitMode,     setLimitMode]     = useState(initialState?.limitMode     ?? false);  // false=Compress, true=Limit
  const [hfEmphasis,    setHfEmphasis]    = useState(initialState?.hfEmphasis    ?? false);
  const [juice,         setJuice]         = useState(initialState?.juice         ?? false);
  const [bypassed,      setBypassed]      = useState(initialState?.bypassed      ?? false);
  const [meterMode,     setMeterMode]     = useState(initialState?.meterMode     ?? 'gr');  // 'gr' | 'out4' | 'out10'
  const [activePreset,  setActivePreset]  = useState(initialState?.preset        ?? 'INIT');

  // Meters
  const [grDb, setGrDb] = useState(0);
  const [outLevel, setOutLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { peakReduction, gain, limitMode, hfEmphasis, juice, bypassed, meterMode };

  // ── Engine init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createLA2AEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setPeakReduction(s.peakReduction);
      eng.setGain(s.gain);
      eng.setMode(s.limitMode);
      eng.setHfEmphasis(s.hfEmphasis ? 1 : 0);
      eng.setJuice(s.juice);
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

  // ── Meter RAF ────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        setGrDb(engineRef.current.getGainReduction());
        setOutLevel(engineRef.current.getOutputLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ────────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { ...stateRefs.current, preset: activePreset });
  }, [peakReduction, gain, limitMode, hfEmphasis, juice, bypassed, meterMode, activePreset]);

  const resetAll = useCallback(() => {
    setPeakReduction(0.45);
    setGain(0);
    setLimitMode(false);
    setHfEmphasis(false);
    setJuice(false);
    setBypassed(false);
    setMeterMode('gr');
    const e = engineRef.current;
    if (e) {
      e.setPeakReduction(0.45);
      e.setGain(0);
      e.setMode(false);
      e.setHfEmphasis(0);
      e.setJuice(false);
      e.setBypass(false);
    }
  }, []);

  const loadPreset = useCallback((preset) => {
    setPeakReduction(preset.peakReduction);
    setGain(preset.gain);
    setLimitMode(preset.limitMode);
    setHfEmphasis(preset.hfEmphasis);
    setJuice(preset.juice);
    setActivePreset(preset.name);
    const e = engineRef.current;
    if (e) {
      e.setPeakReduction(preset.peakReduction);
      e.setGain(preset.gain);
      e.setMode(preset.limitMode);
      e.setHfEmphasis(preset.hfEmphasis ? 1 : 0);
      e.setJuice(preset.juice);
    }
  }, []);

  // Cycle meter mode: gr → out4 → out10 → gr
  const cycleMeterMode = () => {
    setMeterMode(m => m === 'gr' ? 'out4' : m === 'out4' ? 'out10' : 'gr');
  };

  // Format helpers
  const prFmt = v => `${Math.round(v * 100)}`;
  const gnFmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}dB`;

  // Shared panel style (cream sub-panels) — echoes the Nasty Glue layout pattern
  const panel = {
    background: 'linear-gradient(180deg,#f0e9d6 0%,#e6dec8 100%)',
    border: '1px solid rgba(26,20,16,0.3)',
    borderRadius: 3,
    padding: '8px 10px',
    marginBottom: 6,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 2px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.3)',
  };

  return (
    <div style={{
      width: 380,
      background: 'linear-gradient(180deg,#e8e0c8 0%,#d8cfb4 100%)',
      borderRadius: 6,
      overflow: 'hidden',
      fontFamily: 'sans-serif',
      userSelect: 'none',
      border: '2px solid #000',
      boxShadow: '0 10px 40px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.45)',
    }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(180deg,#f4eed8 0%,#e8e0c8 100%)',
        padding: '9px 12px 8px',
        borderBottom: '1px solid rgba(26,20,16,0.35)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 14, fontWeight: 900, color: '#1a1410',
                fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
                letterSpacing: '0.08em',
                textShadow: '0 1px 0 rgba(255,255,255,0.5)',
              }}>LVL-2A</span>
              <div style={{
                width: 18, height: 2.5, background: '#c53025',
                boxShadow: '0 0 1px rgba(0,0,0,0.4)',
              }} />
              <span style={{
                fontSize: 7.5, fontWeight: 700, color: '#1a1410',
                letterSpacing: '0.24em',
                fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
              }}>LEVELING AMPLIFIER</span>
            </div>
            <span style={{
              fontSize: 5.5, fontWeight: 600, color: 'rgba(26,20,16,0.55)',
              letterSpacing: '0.38em', marginTop: 2,
              fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
            }}>MODEL LVL-2A · T4 OPTO</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {loading && <span style={{ fontSize: 6, color: '#888' }}>…</span>}
            <PresetSelector
              presets={PRESETS}
              activePreset={activePreset}
              onSelect={loadPreset}
              colors={{
                bg: 'rgba(26,20,16,0.8)',
                text: '#e8dcc0',
                textDim: 'rgba(232,220,192,0.5)',
                border: 'rgba(26,20,16,0.5)',
                hoverBg: 'rgba(26,20,16,0.6)',
                activeBg: 'rgba(26,20,16,0.4)',
              }}
            />
            {/* Power LED */}
            <div style={{
              width: 9, height: 9, borderRadius: '50%',
              background: bypassed ? '#5a5248' : '#e89a3c',
              boxShadow: bypassed ? 'inset 0 1px 1px rgba(0,0,0,0.6)' : '0 0 7px #e89a3caa, inset 0 1px 1px rgba(255,255,255,0.4)',
              border: '1px solid #000',
            }} />
            <button
              onClick={resetAll}
              title="Reset all knobs to default"
              style={{
                width: 16, height: 16, borderRadius: '50%',
                background: 'rgba(0,0,0,0.06)',
                border: '1px solid rgba(26,20,16,0.35)',
                color: 'rgba(26,20,16,0.6)',
                fontSize: 10, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, fontWeight: 700,
              }}
            >↻</button>
            <button
              onClick={onRemove}
              disabled={!onRemove}
              title={onRemove ? 'Remove from chain' : 'Cannot remove — only module'}
              style={{
                width: 16, height: 16, borderRadius: '50%',
                background: 'rgba(0,0,0,0.06)',
                border: '1px solid rgba(26,20,16,0.35)',
                color: onRemove ? 'rgba(26,20,16,0.6)' : 'rgba(26,20,16,0.15)',
                fontSize: 11, cursor: onRemove ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700,
              }}
            >×</button>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '7px 10px 9px' }}>

        {/* VU meter panel — the hero, centered, mode-switchable */}
        <div style={panel}>
          <div
            onClick={cycleMeterMode}
            title="Click to cycle: Gain Reduction / Output ×4 / Output ×10"
            style={{
              display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', marginBottom: 4,
              fontSize: 7, color: '#1a1410',
              fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
              letterSpacing: '0.14em', fontWeight: 700,
            }}>
            <span style={{ opacity: meterMode === 'gr'    ? 1 : 0.3 }}>GR</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: meterMode === 'out4'  ? 1 : 0.3 }}>×4</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: meterMode === 'out10' ? 1 : 0.3 }}>×10</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <VuMeter grDb={grDb} outLevel={outLevel} mode={meterMode} />
          </div>
        </div>

        {/* Big knobs panel — GAIN + PEAK REDUCTION side by side */}
        <div style={{ ...panel, padding: '10px 10px 6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start' }}>
            <Knob
              label="GAIN"
              value={gain}
              min={0}
              max={40}
              defaultValue={0}
              onChange={v => { setGain(v); engineRef.current?.setGain(v); setActivePreset(null); }}
              size={38}
              format={gnFmt}
            />
            <Knob
              label="PEAK REDUCTION"
              value={peakReduction}
              min={0}
              max={1}
              defaultValue={0.45}
              onChange={v => { setPeakReduction(v); engineRef.current?.setPeakReduction(v); setActivePreset(null); }}
              size={38}
              format={prFmt}
            />
          </div>
        </div>

        {/* Mode row — LIMIT/COMPRESS toggle + HF button + POWER toggle */}
        <div style={panel}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '2px 8px',
          }}>
            <ToggleSwitch
              up={limitMode}
              onToggle={() => {
                const n = !limitMode;
                setLimitMode(n);
                engineRef.current?.setMode(n);
                setActivePreset(null);
              }}
              labelTop="LIMIT"
              labelBot="COMPRESS"
            />
            <HfButton
              active={hfEmphasis}
              onClick={() => {
                const n = !hfEmphasis;
                setHfEmphasis(n);
                engineRef.current?.setHfEmphasis(n ? 1 : 0);
                setActivePreset(null);
              }}
            />
            <JuiceButton
              active={juice}
              onClick={() => {
                const n = !juice;
                setJuice(n);
                engineRef.current?.setJuice(n);
                setActivePreset(null);
              }}
            />
            <ToggleSwitch
              up={!bypassed}
              onToggle={() => {
                const n = !bypassed;
                setBypassed(n);
                engineRef.current?.setBypass(n);
              }}
              labelTop="ON"
              labelBot="POWER"
            />
          </div>
        </div>

        {/* Bottom vent strip — a nod to the rack aesthetic */}
        <div style={{
          marginTop: 2,
          height: 4,
          background: `repeating-linear-gradient(
            90deg,
            rgba(26,20,16,0.5) 0px,
            rgba(26,20,16,0.5) 1px,
            rgba(255,255,255,0.1) 1px,
            rgba(255,255,255,0.1) 3px
          )`,
          borderTop: '1px solid rgba(26,20,16,0.35)',
          borderBottom: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 1,
        }} />
      </div>
    </div>
  );
}
