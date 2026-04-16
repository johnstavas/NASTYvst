import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createMixBusEngine } from './mixBusEngine';

// ─────────────────────────────────────────────────────────────────────────────
// EQ canvas constants
// ─────────────────────────────────────────────────────────────────────────────
// The canvas fills the FULL module width. Previously EQ_W (344) was narrower
// than MODULE_W (360), and with a left-aligned display:block canvas that left
// 16 px of dead space on the right edge — the "everything pushed left" look.
//
// Labels live in outer padding (PAD_L/R/T/B) so the plottable area is a clean
// inner rect (GRAPH_W × GRAPH_H). All drawing and hit-testing happens in that
// inset coordinate space via freqToX / dbToY helpers.
const MODULE_W = 380;
const EQ_W   = MODULE_W;   // canvas = module width, zero horizontal dead space
const EQ_H   = 160;
const DB_MAX = 15;

const PAD_L = 24;   // room for "+12" / "-12" dB labels down the left
const PAD_R = 14;   // room for the "20k" label at the right edge
const PAD_T = 10;   // room for "+12" label at the top
const PAD_B = 14;   // room for freq labels along the bottom

const GRAPH_W = EQ_W - PAD_L - PAD_R;
const GRAPH_H = EQ_H - PAD_T - PAD_B;
const N       = GRAPH_W;   // one response sample per pixel column of the graph

// Module-level pre-allocated arrays sized to N — never reallocated per-frame
const FREQ_ARR     = new Float32Array(N);
const _magCombined = new Float32Array(N);
const _tmpMag      = new Float32Array(N);
const _tmpPh       = new Float32Array(N);
const _specBuf     = new Float32Array(2048);

;(function buildFreqArr() {
  const logMin = Math.log10(20), logMax = Math.log10(20000);
  for (let i = 0; i < N; i++)
    FREQ_ARR[i] = Math.pow(10, logMin + (i / (N - 1)) * (logMax - logMin));
})();

const LOG_DECADES = Math.log10(1000);   // 20 Hz → 20 kHz = 3 decades
function freqToX(f) { return PAD_L + (Math.log10(f / 20) / LOG_DECADES) * GRAPH_W; }
function xToFreq(x) { return 20 * Math.pow(1000, (x - PAD_L) / GRAPH_W); }
function dbToY(db)  { return PAD_T + (GRAPH_H / 2) * (1 - db / DB_MAX); }
function yToDb(y)   { return (1 - (y - PAD_T) / (GRAPH_H / 2)) * DB_MAX; }

// ─────────────────────────────────────────────────────────────────────────────
// Band definitions
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_BANDS = [
  // HPF parked at 20 Hz — the left edge of the visible frequency range, so the
  // drag node sits right at the edge of the canvas instead of off-screen. At
  // 20 Hz the filter is still effectively transparent to audible content; drag
  // it right to 30–80 Hz to engage a real sub-rumble cut.
  { id:'hpf',     label:'HPF',   color:'#ff6b6b', freq:20,    gain:0, q:0.7, hasGain:false, freqMin:20,   freqMax:500   },
  { id:'low',     label:'LOW',   color:'#ffa94d', freq:100,   gain:0, q:1.0, hasGain:true,  freqMin:30,   freqMax:600   },
  { id:'lowMid',  label:'L·MID', color:'#74c0fc', freq:500,   gain:0, q:1.0, hasGain:true,  freqMin:150,  freqMax:3000  },
  { id:'highMid', label:'H·MID', color:'#b197fc', freq:3000,  gain:0, q:1.0, hasGain:true,  freqMin:800,  freqMax:12000 },
  { id:'high',    label:'AIR',   color:'#63e6be', freq:10000, gain:0, q:1.0, hasGain:true,  freqMin:3000, freqMax:20000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stereo VU Meter  — broadcast-style, clear dB scale
// ─────────────────────────────────────────────────────────────────────────────
// Convert linear RMS → dBFS
const toDb = rms => rms < 1e-5 ? -80 : 20 * Math.log10(rms);

// Map dBFS (-60 … +3) to a 0-1 fill fraction
const DB_MIN = -60, DB_MAX_VU = 3;
const dbToFrac = db => Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX_VU - DB_MIN)));

// Colour gradient stops matching pro-audio convention
function levelColor(frac) {
  if (frac > 0.97) return '#ff2222';       // clip
  if (frac > 0.92) return '#ff6600';       // hot
  if (frac > 0.84) return '#ffd43b';       // yellow
  if (frac > 0.65) return '#a8e63d';       // yellow-green
  return '#2edd55';                         // green
}

function VUMeter({ leftRms, rightRms, leftPeak, rightPeak }) {
  const lDb  = toDb(leftRms);   const rDb  = toDb(rightRms);
  const lpDb = toDb(leftPeak);  const rpDb = toDb(rightPeak);
  const lF   = dbToFrac(lDb);   const rF   = dbToFrac(rDb);
  const lpF  = dbToFrac(lpDb);  const rpF  = dbToFrac(rpDb);

  const SCALE = [-48,-24,-12,-6,-3,0,3];

  // IMPORTANT: Bar must receive its own dB value via props. Previously it
  // closed over `lDb` from the enclosing scope, so the R row's numeric readout
  // was showing the L channel's value — making the meters look mono even when
  // the engine was reporting true stereo levels.
  const Bar = ({ frac, peakFrac, label, db }) => (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:8, width:8, textAlign:'right', color:'rgba(255,255,255,0.35)',
        letterSpacing:'0.1em', flexShrink:0 }}>{label}</span>
      <div style={{ flex:1, height:14, background:'rgba(255,255,255,0.04)',
        borderRadius:3, position:'relative', overflow:'visible',
        border:'1px solid rgba(255,255,255,0.07)' }}>
        {/* Segmented fill */}
        <div style={{
          position:'absolute', inset:0, borderRadius:2,
          width:`${frac*100}%`,
          background: frac > 0.97
            ? 'linear-gradient(to right,#1a6e1a,#2edd55 40%,#a8e63d 65%,#ffd43b 78%,#ff6600 90%,#ff2222)'
            : frac > 0.84
            ? 'linear-gradient(to right,#1a6e1a,#2edd55 40%,#a8e63d 65%,#ffd43b 78%,#ff9900 90%)'
            : frac > 0.65
            ? 'linear-gradient(to right,#1a6e1a,#2edd55 45%,#a8e63d 75%)'
            : 'linear-gradient(to right,#1a6e1a,#2edd55)',
          transition:'width 0.04s linear',
        }} />
        {/* Peak hold tick */}
        {peakFrac > 0.01 && (
          <div style={{
            position:'absolute', top:-1, bottom:-1,
            left:`calc(${peakFrac*100}% - 1px)`, width:2,
            background: peakFrac > 0.92 ? '#ff4444' : 'rgba(255,255,255,0.7)',
            borderRadius:1,
          }} />
        )}
      </div>
      <span style={{ fontSize:8, width:34, textAlign:'right',
        color: db > 0 ? '#ff4444' : 'rgba(255,255,255,0.4)',
        fontVariantNumeric:'tabular-nums', flexShrink:0 }}>
        {db > -79 ? `${db.toFixed(1)}` : '—'} <span style={{fontSize:7,color:'rgba(255,255,255,0.2)'}}>dB</span>
      </span>
    </div>
  );

  return (
    <div style={{ padding:'10px 12px 4px' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        <Bar frac={lF} peakFrac={lpF} label="L" db={lDb} />
        <Bar frac={rF} peakFrac={rpF} label="R" db={rDb} />
      </div>
      {/* dB scale */}
      <div style={{ marginLeft:16, marginTop:3, position:'relative', height:12 }}>
        <div style={{ position:'absolute', inset:0, display:'flex', pointerEvents:'none' }}>
          {SCALE.map(db => {
            const frac = dbToFrac(db);
            return (
              <div key={db} style={{ position:'absolute', left:`${frac*100}%`, transform:'translateX(-50%)',
                display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                <div style={{ width:1, height:4, background:'rgba(255,255,255,0.15)' }} />
                <span style={{ fontSize:7, color: db >= 0 ? 'rgba(255,100,100,0.6)' : 'rgba(255,255,255,0.22)',
                  whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>
                  {db === 0 ? '0' : db > 0 ? `+${db}` : db}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact param slider (comp/limiter rows)
// ─────────────────────────────────────────────────────────────────────────────
function ParamRow({ label, value, min, max, step=0.01, display, onChange, color='#ffa94d' }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ fontSize:7, letterSpacing:'0.14em', textTransform:'uppercase',
        color:'rgba(255,255,255,0.25)', width:26, flexShrink:0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ accentColor:color, flex:1, height:3, cursor:'pointer' }} />
      <span style={{ fontSize:8, color:'rgba(255,255,255,0.38)', width:44,
        textAlign:'right', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{display}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GR bar (vertical, fills top-down for gain reduction)
// ─────────────────────────────────────────────────────────────────────────────
function GRBar({ reduction, maxGr=20 }) {
  const gr  = Math.max(0, Math.min(maxGr, -(reduction ?? 0)));
  const pct = (gr / maxGr) * 100;
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, flexShrink:0 }}>
      <span style={{ fontSize:7, color:'rgba(255,255,255,0.22)', letterSpacing:'0.12em' }}>GR</span>
      <div style={{ width:5, height:44, background:'rgba(255,255,255,0.04)',
        borderRadius:2, position:'relative', overflow:'hidden',
        border:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:`${pct}%`,
          background: pct > 70 ? '#ff4444' : pct > 40 ? '#ff9900' : '#ff6b6b',
          transition:'height 0.04s linear', borderRadius:1 }} />
      </div>
      <span style={{ fontSize:7, color:'rgba(255,100,100,0.55)', fontVariantNumeric:'tabular-nums',
        minWidth:24, textAlign:'center' }}>
        {gr > 0.3 ? `-${gr.toFixed(1)}` : '—'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LED mode button (matches VocalOrb ModeLED style)
// ─────────────────────────────────────────────────────────────────────────────
function ModeLED({ label, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:5,
      background:'none', border:'none', cursor:'pointer', padding:'2px 0',
    }}>
      <div style={{
        width:9, height:9, borderRadius:2,
        background: active ? color : '#151515',
        border: `1px solid ${active ? color : '#2a2a2a'}`,
        boxShadow: active ? `0 0 5px ${color}80` : 'none',
        transition:'all 0.08s', flexShrink:0,
      }} />
      <span style={{
        fontSize:7.5, fontWeight:700, letterSpacing:'0.18em', textTransform:'uppercase',
        color: active ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.22)',
        transition:'color 0.08s',
      }}>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function MixBusOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const [bands, setBands] = useState(() =>
    DEFAULT_BANDS.map((d, i) => ({ ...d, ...(initialState?.bands?.[i] ?? {}) }))
  );

  const [outputGain,      setOutputGain     ] = useState(initialState?.outputGain      ?? 1.0);
  const [bypassed,        setBypassed       ] = useState(initialState?.bypassed        ?? false);
  const [compEnabled,     setCompEnabled    ] = useState(initialState?.compEnabled     ?? false);
  const [compThreshold,   setCompThreshold  ] = useState(initialState?.compThreshold   ?? -18);
  const [compRatio,       setCompRatio      ] = useState(initialState?.compRatio       ?? 2);
  const [compAttack,      setCompAttack     ] = useState(initialState?.compAttack      ?? 30);
  const [compRelease,     setCompRelease    ] = useState(initialState?.compRelease     ?? 150);
  const [compMakeup,      setCompMakeup     ] = useState(initialState?.compMakeup      ?? 0);
  const [compGR,          setCompGR         ] = useState(0);
  const [limiterEnabled,  setLimiterEnabled ] = useState(initialState?.limiterEnabled  ?? false);
  const [limiterThreshold,setLimiterThreshold]= useState(initialState?.limiterThreshold ?? -1);
  const [limiterGR,       setLimiterGR      ] = useState(0);

  // VU meter state (separate L/R)
  const [leftRms,   setLeftRms  ] = useState(0);
  const [rightRms,  setRightRms ] = useState(0);
  const [leftPeak,  setLeftPeak ] = useState(0);
  const [rightPeak, setRightPeak] = useState(0);

  const engineRef    = useRef(null);
  const animRef      = useRef(null);
  const canvasRef    = useRef(null);
  const draggingBand = useRef(null);
  const hoveredBand  = useRef(-1);
  const bandsRef     = useRef(bands); bandsRef.current = bands;

  // ── Draw EQ ────────────────────────────────────────────────────────────────
  const drawEQ = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const c = canvas.getContext('2d');

    // Module background — full canvas.
    c.fillStyle = '#09090f'; c.fillRect(0, 0, EQ_W, EQ_H);

    // Subtle plot-area background so the graph rect is visually distinct
    // from the label gutters.
    c.fillStyle = 'rgba(255,255,255,0.012)';
    c.fillRect(PAD_L, PAD_T, GRAPH_W, GRAPH_H);

    // Horizontal dB grid — drawn only inside the plot rect so the lines
    // don't shoot through the label columns.
    for (const db of [-12,-6,0,6,12]) {
      const y = dbToY(db);
      c.beginPath(); c.moveTo(PAD_L, y); c.lineTo(PAD_L + GRAPH_W, y);
      c.strokeStyle = db === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
      c.setLineDash(db === 0 ? [5,4] : []); c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    }
    // Vertical freq grid
    c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1;
    for (const f of [50,100,200,500,1000,2000,5000,10000]) {
      const x = freqToX(f);
      c.beginPath(); c.moveTo(x, PAD_T); c.lineTo(x, PAD_T + GRAPH_H); c.stroke();
    }

    // Freq labels — edge labels get anchored alignment so the rightmost
    // "20k" can't clip off the canvas edge.
    c.font = '8px sans-serif'; c.fillStyle = 'rgba(255,255,255,0.3)';
    const yFL = PAD_T + GRAPH_H + 10;
    const freqLabels = [
      [50,    '50',  'center'],
      [100,   '100', 'center'],
      [500,   '500', 'center'],
      [1000,  '1k',  'center'],
      [5000,  '5k',  'center'],
      [10000, '10k', 'center'],
      [20000, '20k', 'right' ],
    ];
    for (const [f, l, anchor] of freqLabels) {
      c.textAlign = anchor;
      c.fillText(l, freqToX(f), yFL);
    }

    // dB labels — right-anchored against the right edge of the left gutter.
    c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,0.3)';
    for (const [db, l] of [[12,'+12'],[6,'+6'],[0,'0'],[-6,'-6'],[-12,'-12']])
      c.fillText(l, PAD_L - 3, dbToY(db) + 3);

    const eng = engineRef.current;
    if (!eng) return;

    // Spectrum analyzer (behind curve).
    // -100 dB → bottom of plot rect, 0 dB → top. Loud content rises from the
    // baseline the way a normal spectrogram should.
    eng.specAnalyser.getFloatFrequencyData(_specBuf);
    const binCount = eng.specAnalyser.frequencyBinCount;
    const nyq      = eng.ctx.sampleRate / 2;
    const baseY    = PAD_T + GRAPH_H;
    c.beginPath();
    c.moveTo(PAD_L, baseY);
    for (let i = 1; i < binCount; i++) {
      const f = (i / binCount) * nyq;
      if (f < 20 || f > 20000) continue;
      const db = Math.max(-100, Math.min(0, _specBuf[i]));
      const y  = PAD_T + (-db / 100) * GRAPH_H;
      c.lineTo(freqToX(f), y);
    }
    c.lineTo(PAD_L + GRAPH_W, baseY); c.closePath();
    const sg = c.createLinearGradient(0, PAD_T, 0, baseY);
    sg.addColorStop(0, 'rgba(255,165,60,0.14)');
    sg.addColorStop(1, 'rgba(255,165,60,0)');
    c.fillStyle = sg; c.fill();

    // Combined EQ curve — product of all five filters' magnitude responses.
    for (let i = 0; i < N; i++) _magCombined[i] = 1;
    for (const fid of ['hpf','low','lowMid','highMid','high']) {
      eng.filters[fid].getFrequencyResponse(FREQ_ARR, _tmpMag, _tmpPh);
      for (let i = 0; i < N; i++) _magCombined[i] *= _tmpMag[i];
    }

    // Curve fill
    c.beginPath();
    for (let i = 0; i < N; i++) {
      const db = 20 * Math.log10(Math.max(1e-6, _magCombined[i]));
      const y  = dbToY(Math.max(-DB_MAX, Math.min(DB_MAX, db)));
      const x  = PAD_L + i;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.lineTo(PAD_L + N - 1, baseY);
    c.lineTo(PAD_L,         baseY);
    c.closePath();
    c.fillStyle = 'rgba(255,165,60,0.08)'; c.fill();

    // Curve stroke
    c.beginPath();
    for (let i = 0; i < N; i++) {
      const db = 20 * Math.log10(Math.max(1e-6, _magCombined[i]));
      const y  = dbToY(Math.max(-DB_MAX, Math.min(DB_MAX, db)));
      const x  = PAD_L + i;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(255,165,60,0.9)'; c.lineWidth = 1.5; c.stroke();

    // Band nodes.
    // Draw position is clamped so a node at a frequency extreme (HPF at 20 Hz,
    // AIR at 20 kHz) doesn't get half-clipped by the plot-area edge.
    const bs = bandsRef.current;
    for (let bi = 0; bi < bs.length; bi++) {
      const b        = bs[bi];
      const rawX     = freqToX(b.freq);
      const y        = b.hasGain ? dbToY(b.gain) : dbToY(0);
      const active   = (bi === hoveredBand.current || bi === draggingBand.current);
      const r        = active ? 7 : 5;   // 25% smaller than before (was 9/7)
      const x        = Math.max(PAD_L + r, Math.min(PAD_L + GRAPH_W - r, rawX));

      c.beginPath(); c.arc(x, y, r, 0, Math.PI*2);
      c.fillStyle   = b.color + (active ? 'ee' : 'bb');
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1;
      c.fill(); c.stroke();

      // Label above the node, or below if there's no room at the top.
      const labelY = (y - r - 4 < PAD_T + 8) ? y + r + 10 : y - r - 4;
      c.font = '7px sans-serif'; c.textAlign = 'center'; c.fillStyle = b.color;
      c.fillText(b.label, x, labelY);

      // Live drag readout (freq + gain) above the band label.
      if (bi === draggingBand.current) {
        const fl = b.freq >= 1000 ? `${(b.freq/1000).toFixed(1)}k` : `${Math.round(b.freq)}`;
        const gl = b.hasGain ? `  ${b.gain >= 0 ? '+' : ''}${b.gain.toFixed(1)}dB` : '';
        c.font = '8px sans-serif'; c.fillStyle = 'rgba(255,255,255,0.78)';
        c.fillText(`${fl}Hz${gl}`, x, labelY - 11);
      }
    }
  }, []);

  // ── Engine init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createMixBusEngine(sharedSource.ctx);
    engineRef.current = engine;

    for (const b of bandsRef.current) {
      engine.setBandFreq(b.id, b.freq);
      if (b.hasGain) engine.setBandGain(b.id, b.gain);
      engine.setBandQ(b.id, b.q);
    }
    engine.setOutputGain(initialState?.outputGain ?? 1.0);
    engine.setBypass(initialState?.bypassed ?? false);
    engine.setCompThreshold(initialState?.compThreshold ?? -18);
    engine.setCompRatio(initialState?.compRatio ?? 2);
    engine.setCompAttack((initialState?.compAttack ?? 30) / 1000);
    engine.setCompRelease((initialState?.compRelease ?? 150) / 1000);
    engine.setCompMakeup(initialState?.compMakeup ?? 0);
    engine.setCompEnabled(initialState?.compEnabled ?? false);
    engine.setLimiterThreshold(initialState?.limiterThreshold ?? -1);
    engine.setLimiterEnabled(initialState?.limiterEnabled ?? false);

    registerEngine(instanceId, engine);

    let tickN = 0;
    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      drawEQ();

      if (++tickN % 2 !== 0) return; // levels at 30fps
      // True stereo reads — each channel has its own analyser in the engine now,
      // so L and R can actually differ (mono-centred signal will still show
      // matching bars, but a panned or wide source will show two different
      // values the way a proper bus meter should).
      const l  = engine.getLeftLevel();
      const r  = engine.getRightLevel();
      const lp = engine.getLeftPeak();
      const rp = engine.getRightPeak();

      setLeftRms(l);   setRightRms(r);
      setLeftPeak(lp); setRightPeak(rp);
      setCompGR(engine.getCompReduction());
      setLimiterGR(engine.getLimiterReduction());
    };
    loop();

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]); // eslint-disable-line

  useEffect(() => { onStateChange?.(instanceId, {
    bands, outputGain, bypassed,
    compEnabled, compThreshold, compRatio, compAttack, compRelease, compMakeup,
    limiterEnabled, limiterThreshold,
  }); }, [bands, outputGain, bypassed, compEnabled, compThreshold, compRatio,
          compAttack, compRelease, compMakeup, limiterEnabled, limiterThreshold]);

  // ── Canvas pointer ─────────────────────────────────────────────────────────
  const getPos = e => { const r=canvasRef.current.getBoundingClientRect(); return{x:e.clientX-r.left,y:e.clientY-r.top}; };

  // Hit-test against the EXACT same position the node is drawn at:
  //   • x is the draw-clamped x (so HPF at 20 Hz / AIR at 20 kHz can be
  //     grabbed where they're visually drawn, not where freqToX() would put
  //     the unclamped target)
  //   • y uses dbToY(0) for non-gain bands so it matches the draw y
  // Threshold is generous so you don't have to pixel-hunt the small dots.
  const nearestBand = (x, y, th = 22) => {
    let best = -1, bd = Infinity;
    const bs = bandsRef.current;
    for (let i = 0; i < bs.length; i++) {
      const b    = bs[i];
      const rawX = freqToX(b.freq);
      const by   = b.hasGain ? dbToY(b.gain) : dbToY(0);
      const bx   = Math.max(PAD_L + 7, Math.min(PAD_L + GRAPH_W - 7, rawX));
      const d    = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
      if (d < th && d < bd) { best = i; bd = d; }
    }
    return best;
  };

  const onPD = e => { e.preventDefault(); canvasRef.current.setPointerCapture(e.pointerId); const{x,y}=getPos(e); draggingBand.current=nearestBand(x,y); };
  const onPM = e => {
    const{x,y}=getPos(e); hoveredBand.current=nearestBand(x,y,18);
    const bi=draggingBand.current; if(bi<0||bi===null) return;
    const b=bandsRef.current[bi];
    const nf=Math.max(b.freqMin,Math.min(b.freqMax,xToFreq(x)));
    const ng=b.hasGain?Math.max(-DB_MAX,Math.min(DB_MAX,yToDb(y))):b.gain;
    engineRef.current?.setBandFreq(b.id,nf);
    if(b.hasGain) engineRef.current?.setBandGain(b.id,ng);
    setBands(prev=>{ const n=[...prev]; n[bi]={...n[bi],freq:nf,gain:ng}; return n; });
  };
  const onPU = e => { canvasRef.current?.releasePointerCapture(e.pointerId); draggingBand.current=null; };

  // ── Render ─────────────────────────────────────────────────────────────────
  const WOOD = 'linear-gradient(90deg,#3a2800,#6b4400,#3a2800)';

  return (
    <div style={{ width:MODULE_W, height:500, fontFamily:'sans-serif', userSelect:'none',
      borderRadius:6, overflow:'hidden', background:'#09090f',
      boxShadow:'0 8px 48px rgba(0,0,0,0.9)' }}>

      {/* Wood top */}
      <div style={{ height:6, background:WOOD }} />

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'5px 10px',
        borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize:14, fontWeight:700, letterSpacing:'0.04em',
          color:'rgba(255,255,255,0.3)' }}>Mix Bus</span>

        {/* Mode LEDs */}
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <ModeLED label="EQ"    active={!bypassed}      color="#ffa94d"
            onClick={() => { const n=!bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
          <ModeLED label="COMP"  active={compEnabled}    color="#ff9f43"
            onClick={() => { const n=!compEnabled; setCompEnabled(n); engineRef.current?.setCompEnabled(n); }} />
          <ModeLED label="LIMIT" active={limiterEnabled}  color="#ff6b6b"
            onClick={() => { const n=!limiterEnabled; setLimiterEnabled(n); engineRef.current?.setLimiterEnabled(n); }} />
        </div>

        {/* ON / remove */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:7, height:7, borderRadius:'50%',
            background: bypassed?'rgba(245,158,11,0.7)':'rgba(46,221,85,0.8)',
            boxShadow: bypassed?'0 0 5px rgba(245,158,11,0.5)':'0 0 6px rgba(46,221,85,0.5)' }} />
          {onRemove && (
            <button onClick={onRemove} style={{ width:18,height:18,borderRadius:'50%',
              background:'rgba(255,255,255,0.05)',border:'none',
              color:'rgba(255,255,255,0.25)',fontSize:13,cursor:'pointer',
              display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
          )}
        </div>
      </div>

      {/* EQ Canvas */}
      <div style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <canvas ref={canvasRef} width={EQ_W} height={EQ_H}
          style={{ display:'block', touchAction:'none', cursor:'crosshair' }}
          onPointerDown={onPD} onPointerMove={onPM}
          onPointerUp={onPU} onPointerCancel={onPU} />
      </div>

      {/* Compressor row */}
      <div style={{ padding:'8px 12px 6px', borderTop:'1px solid rgba(255,255,255,0.06)',
        opacity: compEnabled ? 1 : 0.45, transition:'opacity 0.15s' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
            <ParamRow label="THR" value={compThreshold} min={-60} max={0}   step={0.5}
              display={`${compThreshold}dB`}
              onChange={v=>{setCompThreshold(v);engineRef.current?.setCompThreshold(v);}} />
            <ParamRow label="RTO" value={compRatio}     min={1}   max={20}  step={0.1}
              display={`${compRatio.toFixed(1)}:1`}
              onChange={v=>{setCompRatio(v);engineRef.current?.setCompRatio(v);}} />
            <ParamRow label="ATK" value={compAttack}    min={1}   max={300} step={1}
              display={`${compAttack}ms`}
              onChange={v=>{setCompAttack(v);engineRef.current?.setCompAttack(v/1000);}} />
            <ParamRow label="REL" value={compRelease}   min={10}  max={1000} step={5}
              display={`${compRelease}ms`}
              onChange={v=>{setCompRelease(v);engineRef.current?.setCompRelease(v/1000);}} />
            <ParamRow label="MKP" value={compMakeup}    min={0}   max={24}  step={0.5}
              display={`+${compMakeup.toFixed(1)}dB`}
              onChange={v=>{setCompMakeup(v);engineRef.current?.setCompMakeup(v);}} />
          </div>
          <GRBar reduction={compGR} />
        </div>
      </div>

      {/* Limiter row */}
      <div style={{ padding:'6px 12px 8px', borderTop:'1px solid rgba(255,255,255,0.06)',
        opacity: limiterEnabled ? 1 : 0.45, transition:'opacity 0.15s',
        display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1 }}>
          <ParamRow label="LIM" value={limiterThreshold} min={-12} max={0} step={0.1} color="#ff6b6b"
            display={`${limiterThreshold.toFixed(1)}dB`}
            onChange={v=>{setLimiterThreshold(v);engineRef.current?.setLimiterThreshold(v);}} />
        </div>
        <GRBar reduction={limiterGR} />
      </div>

      {/* VU meter */}
      <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
        <VUMeter leftRms={leftRms} rightRms={rightRms}
                 leftPeak={leftPeak} rightPeak={rightPeak} />
      </div>

      {/* Output gain */}
      <div style={{ padding:'6px 12px 8px', borderTop:'1px solid rgba(255,255,255,0.06)',
        display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:7, letterSpacing:'0.18em', textTransform:'uppercase',
          color:'rgba(255,255,255,0.25)', width:28, flexShrink:0 }}>OUT</span>
        <input type="range" min={0} max={1.5} step={0.01} value={outputGain}
          onChange={e=>{ const v=parseFloat(e.target.value); setOutputGain(v); engineRef.current?.setOutputGain(v); }}
          style={{ accentColor:'#ffa94d', flex:1, height:3 }} />
        <span style={{ fontSize:8, color:'rgba(255,255,255,0.35)', width:36,
          textAlign:'right', fontVariantNumeric:'tabular-nums' }}>
          {Math.round(outputGain*100)}%
        </span>
      </div>

      {/* Wood bottom */}
      <div style={{ height:6, background:WOOD }} />
    </div>
  );
}
