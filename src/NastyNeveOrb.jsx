// NastyNeveOrb.jsx — NASTY NEVE: 5-stage 1073 preamp + 1073D-style EQ
//
// Visual & functional reference: BAE / Neve 1073D
// Controls: Drive · Thick · Output (preamp) + HPF / Low / Mid / High / EQL (eq)

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createNastyNeveEngine, NASTY_NEVE_VERSION } from './bae73Engine';
import ClipMeter from './ClipMeter';
import PresetSelector from './PresetSelector';

const PRESETS = [
  { name: 'INIT', drive: 0, thickness: 0, outputTrim: 0, eqlOn: false, hpfIdx: 0, lowFreq: 60, lowGain: 0, midIdx: 2, midGain: 0, highGain: 0, pad: false },
  { name: 'WARM PUSH', drive: 6, thickness: 0.4, outputTrim: -3, eqlOn: false, hpfIdx: 0, lowFreq: 60, lowGain: 0, midIdx: 2, midGain: 0, highGain: 0, pad: false },
  { name: 'DIRTY VOCAL', drive: 10, thickness: 0.3, outputTrim: -5, eqlOn: true, hpfIdx: 2, lowFreq: 220, lowGain: -4, midIdx: 4, midGain: 6, highGain: 3, pad: false },
  { name: 'FAT SNARE', drive: 12, thickness: 0.6, outputTrim: -6, eqlOn: true, hpfIdx: 1, lowFreq: 110, lowGain: 3, midIdx: 2, midGain: 4, highGain: 2, pad: false },
  { name: 'NASTY BASS', drive: 8, thickness: 0.7, outputTrim: -4, eqlOn: true, hpfIdx: 0, lowFreq: 60, lowGain: 5, midIdx: 1, midGain: 3, highGain: -4, pad: false },
  { name: 'CRUSHED', drive: 16, thickness: 0.5, outputTrim: -10, eqlOn: true, hpfIdx: 2, lowFreq: 110, lowGain: 0, midIdx: 3, midGain: 2, highGain: 0, pad: true },
];

// ── Palette — 1073D medium steel-blue + white labels ─────────────────────────
// Panel:        medium steel-blue  (the actual chassis colour in the photo)
// Text:         near-white / bright cream
// Drive ring:   dark burgundy-red  (large MIC-gain knob)
// HPF ring:     bright blue        (blue HPF knob)
// EQ/Thick/Out: light steel-grey   (smaller EQ rotaries)
const PANEL_BG  = 'linear-gradient(180deg, #3a4f62 0%, #273848 100%)';
const FRAME     = 'rgba(120,165,195,0.55)';
const FG        = 'rgba(242,250,255,0.96)';          // near-white
const FG_DIM    = 'rgba(175,210,230,0.62)';
const STEEL     = '#a8c8de';          // light steel ring
const STEEL_H   = '#c8e0f0';          // steel highlight
const BLUE      = '#4a82e0';          // HPF blue
const MIC_RED   = 'hsl(2, 62%, 46%)'; // Drive — burgundy-red
const EQ_RING   = '#88b8d4';          // EQ band knobs

const KNOB_BG   = `radial-gradient(circle at 35% 30%, #536878 0%, #354858 70%, #202e3a 100%)`;
const PREAMP_BG = `radial-gradient(circle at 35% 30%, #536878 0%, #354858 70%, #202e3a 100%)`;
const EQ_BG     = `radial-gradient(circle at 35% 30%, #536878 0%, #354858 70%, #202e3a 100%)`;
const DIV_CLR   = 'rgba(120,165,195,0.30)';

// ── NeveKnobSVG — shared Neve hardware knob rendering ───────────────────────
// Renders a dark cylindrical body with a flat face, white pointer line, and
// dot position markers — matching the physical 1073 hardware aesthetic.
function NeveKnobSVG({ size, norm, accentColor = '#e8e8e8', faceColor = null, nDots = 11 }) {
  const id = useRef(`ng-${Math.random().toString(36).slice(2, 7)}`).current;
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 1;
  const faceR  = outerR * 0.68;

  // Pointer direction (norm 0 = bottom-left, 1 = bottom-right, 0.5 = top)
  const angleDeg = -135 + norm * 270;
  const angleRad = (angleDeg - 90) * Math.PI / 180;
  // Dots sit at outerR - 3. Pointer starts from a small center hub and extends
  // just inside the dot ring, so it clearly points AT the active dot.
  const dotR = outerR - 3;
  const px  = cx + (dotR - 2) * Math.cos(angleRad);
  const py  = cy + (dotR - 2) * Math.sin(angleRad);
  const psx = cx + faceR * 0.12 * Math.cos(angleRad);
  const psy = cy + faceR * 0.12 * Math.sin(angleRad);
  const dots = Array.from({ length: nDots }, (_, i) => {
    const a   = (-135 + (i / (nDots - 1)) * 270) * Math.PI / 180;
    const act = i <= Math.round(norm * (nDots - 1));
    return (
      <circle key={i}
        cx={(cx + dotR * Math.cos(a)).toFixed(2)}
        cy={(cy + dotR * Math.sin(a)).toFixed(2)}
        r={act ? 1.5 : 1.0}
        fill={act ? accentColor : 'rgba(255,255,255,0.30)'}
      />
    );
  });

  // Face gradient — grey by default, tinted if faceColor supplied
  const faceStop0 = faceColor ? faceColor       : '#52606c';
  const faceStop1 = faceColor ? faceColor + 'aa': '#2c3a46';
  const faceStop2 = faceColor ? faceColor + '66': '#1a2830';

  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={id} cx="38%" cy="32%" r="72%">
          <stop offset="0%"   stopColor={faceStop0} />
          <stop offset="55%"  stopColor={faceStop1} />
          <stop offset="100%" stopColor={faceStop2} />
        </radialGradient>
        <filter id={`${id}-sh`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.85)" />
        </filter>
      </defs>

      {/* Outer body — very dark, acts as the knob's cylindrical skirt */}
      <circle cx={cx} cy={cy} r={outerR}
        fill="#0e1520"
        filter={`url(#${id}-sh)`} />
      {/* Subtle top-edge highlight */}
      <circle cx={cx} cy={cy} r={outerR}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

      {/* Position dots */}
      {dots}

      {/* Flat face */}
      <circle cx={cx} cy={cy} r={faceR} fill={`url(#${id})`} />
      {/* Face rim — slight shadow for depth */}
      <circle cx={cx} cy={cy} r={faceR}
        fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.5} />
      {/* Face sheen — top-left highlight */}
      <ellipse
        cx={(cx - faceR * 0.22).toFixed(2)} cy={(cy - faceR * 0.26).toFixed(2)}
        rx={(faceR * 0.48).toFixed(2)} ry={(faceR * 0.32).toFixed(2)}
        fill="rgba(255,255,255,0.05)" />

      {/* Pointer line — center to face edge, like real 1073 hardware */}
      <line
        x1={psx.toFixed(2)} y1={psy.toFixed(2)}
        x2={px.toFixed(2)}  y2={py.toFixed(2)}
        stroke="rgba(255,255,255,0.92)" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

// ── StepKnob — discrete stepped rotary (click cycles, drag steps) ───────────
function StepKnob({ label, steps, selectedIndex, onChange, size = 28, accentColor = '#e8e8e8', faceColor = null }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, idx: 0, changed: false });
  const n    = steps.length;
  const norm = n > 1 ? selectedIndex / (n - 1) : 0;

  const onDown = (e) => {
    e.preventDefault();
    setDragging(true);
    ref.current = { y: e.clientY, idx: selectedIndex, changed: false };
    const onMove = (ev) => {
      const delta = Math.round((ref.current.y - ev.clientY) / 18);
      const next  = Math.max(0, Math.min(n - 1, ref.current.idx + delta));
      if (next !== ref.current.idx) ref.current.changed = true;
      onChange(next);
    };
    const onUp = () => {
      if (!ref.current.changed) onChange((ref.current.idx + 1) % n);
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size + 10 }}>
      <div className="tracking-[0.20em] font-semibold mb-1" style={{ color: FG_DIM, fontSize: '6.5px' }}>
        {label}
      </div>
      <div
        onMouseDown={onDown}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'pointer' }}
      >
        <NeveKnobSVG size={size} norm={norm} accentColor={accentColor} faceColor={faceColor} nDots={n} />
      </div>
      <div className="mt-1 font-mono font-bold" style={{ color: FG, fontSize: '5.5px' }}>
        {steps[selectedIndex]}
      </div>
    </div>
  );
}

// ── NastyKnob — continuous drag knob, Neve hardware style ───────────────────
function NastyKnob({
  label, value, onChange,
  min = 0, max = 1, defaultValue,
  size = 28, accentColor = '#e8e8e8', faceColor = null, format,
  // legacy props ignored (ringColor / knobBg) — kept for call-site compat
  ringColor, knobBg,
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ y: 0, v: 0 });

  const norm  = (value - min) / (max - min);

  const onDown = (e) => {
    e.preventDefault();
    setDragging(true);
    startRef.current = { y: e.clientY, v: value };
    const onMove = (ev) => {
      const dy = startRef.current.y - ev.clientY;
      onChange(Math.max(min, Math.min(max, startRef.current.v + (dy / 140) * (max - min))));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size + 10 }}>
      <div className="tracking-[0.20em] font-semibold mb-1" style={{ color: FG_DIM, fontSize: '6.5px' }}>
        {label}
      </div>
      <div
        onMouseDown={onDown}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <NeveKnobSVG size={size} norm={norm} accentColor={accentColor} faceColor={faceColor} />
      </div>
      <div className="mt-1 font-mono tabular-nums" style={{ color: FG, fontSize: '5.5px' }}>
        {format ? format(value) : value.toFixed(2)}
      </div>
    </div>
  );
}

// ── SectionLabel ─────────────────────────────────────────────────────────────
function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[7px] tracking-[0.24em] font-bold uppercase" style={{ color: FG_DIM }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: DIV_CLR }} />
      {right}
    </div>
  );
}

// ── NastyNeveOrb ─────────────────────────────────────────────────────────────
export default function NastyNeveOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  // Preamp
  const [drive,      setDriveS     ] = useState(initialState?.drive      ?? 0);
  const [thickness,  setThicknessS ] = useState(initialState?.thickness  ?? 0);
  const [outputTrim, setOutputTrimS] = useState(initialState?.outputTrim ?? 0);
  const mix = 1; // always full wet — no parallel blend on a Neve
  const autoMakeup = false;
  const [pad,        setPad        ] = useState(initialState?.pad        ?? false);
  const [bypassed,   setBypassed   ] = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? 'INIT');

  // EQ
  const HPF_STEPS  = ['OFF', '50Hz', '80Hz', '160Hz', '300Hz'];
  const HPF_VALUES = [0, 50, 80, 160, 300];
  const MID_STEPS  = ['360', '700', '1.6k', '3.2k', '4.8k', '7.2k'];
  const MID_VALUES = [360, 700, 1600, 3200, 4800, 7200];

  const [eqlOn,    setEqlOn   ] = useState(initialState?.eqlOn    ?? false);
  const [hpfIdx,   setHpfIdx  ] = useState(initialState?.hpfIdx   ?? 0);
  const [lowFreq,  setLowFreq ] = useState(initialState?.lowFreq  ?? 60);
  const [lowGain,  setLowGain ] = useState(initialState?.lowGain  ?? 0);
  const [midIdx,   setMidIdx  ] = useState(initialState?.midIdx   ?? 2);
  const [midGain,  setMidGain ] = useState(initialState?.midGain  ?? 0);
  const [highGain, setHighGain] = useState(initialState?.highGain ?? 0);

  const loadPreset = useCallback((preset) => {
    setDriveS(preset.drive); setThicknessS(preset.thickness);
    setOutputTrimS(preset.outputTrim); setEqlOn(preset.eqlOn);
    setHpfIdx(preset.hpfIdx); setLowFreq(preset.lowFreq);
    setLowGain(preset.lowGain); setMidIdx(preset.midIdx);
    setMidGain(preset.midGain); setHighGain(preset.highGain);
    setPad(preset.pad); setActivePreset(preset.name);
  }, []);

  // Meters
  const [inLevel,  setInLevel ] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak  ] = useState(0);
  const [outPeak,  setOutPeak ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  // Refs for initial engine setup (avoids stale closure)
  const initRef = useRef({
    drive, thickness, outputTrim, mix, autoMakeup, bypassed,
    eqlOn, hpfIdx, lowFreq, lowGain, midIdx, midGain, highGain,
  });

  // Engine lifecycle
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createNastyNeveEngine(sharedSource.ctx);
    engineRef.current = engine;

    const s = initRef.current;
    engine.setDrive(s.drive);
    engine.setThickness(s.thickness);
    engine.setOutputTrim(s.outputTrim);
    engine.setMix(s.mix);
    engine.setAutoMakeup(s.autoMakeup);
    engine.setBypass(s.bypassed);
    engine.setEQLOn(s.eqlOn);
    engine.setHPF(HPF_VALUES[s.hpfIdx]);
    engine.setLowShelf(s.lowFreq, s.lowGain);
    engine.setMidPeak(MID_VALUES[s.midIdx], s.midGain);
    engine.setHighShelf(s.highGain);

    registerEngine(instanceId, engine);

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

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Param sync
  useEffect(() => { engineRef.current?.setDrive(drive);              }, [drive]);
  useEffect(() => { engineRef.current?.setThickness(thickness);      }, [thickness]);
  useEffect(() => { engineRef.current?.setOutputTrim(outputTrim);    }, [outputTrim]);
  useEffect(() => { engineRef.current?.setInputGain(pad ? 0.1 : 1);  }, [pad]);
  useEffect(() => { engineRef.current?.setBypass(bypassed);          }, [bypassed]);
  useEffect(() => { engineRef.current?.setEQLOn(eqlOn);              }, [eqlOn]);
  useEffect(() => { engineRef.current?.setHPF(HPF_VALUES[hpfIdx]);   }, [hpfIdx]); // eslint-disable-line
  useEffect(() => { engineRef.current?.setLowShelf(lowFreq, lowGain);  }, [lowFreq, lowGain]);
  useEffect(() => { engineRef.current?.setMidPeak(MID_VALUES[midIdx], midGain); }, [midIdx, midGain]); // eslint-disable-line
  useEffect(() => { engineRef.current?.setHighShelf(highGain);       }, [highGain]);

  // State persistence
  useEffect(() => {
    onStateChange?.(instanceId, {
      drive, thickness, outputTrim, mix, autoMakeup, bypassed,
      eqlOn, hpfIdx, lowFreq, lowGain, midIdx, midGain, highGain,
      preset: activePreset,
    });
  }, [drive, thickness, outputTrim, mix, autoMakeup, bypassed, // eslint-disable-line
      eqlOn, hpfIdx, lowFreq, lowGain, midIdx, midGain, highGain, activePreset]);

  // Clear preset on any manual parameter change
  const clearPreset = useCallback(() => setActivePreset(null), []);
  const wDriveS      = useCallback(v => { setDriveS(v);      clearPreset(); }, [clearPreset]);
  const wThicknessS  = useCallback(v => { setThicknessS(v);  clearPreset(); }, [clearPreset]);
  const wOutputTrimS = useCallback(v => { setOutputTrimS(v); clearPreset(); }, [clearPreset]);
  const wEqlOn       = useCallback(v => { setEqlOn(v);       clearPreset(); }, [clearPreset]);
  const wHpfIdx      = useCallback(v => { setHpfIdx(v);      clearPreset(); }, [clearPreset]);
  const wLowFreq     = useCallback(v => { setLowFreq(v);     clearPreset(); }, [clearPreset]);
  const wLowGain     = useCallback(v => { setLowGain(v);     clearPreset(); }, [clearPreset]);
  const wMidIdx      = useCallback(v => { setMidIdx(v);      clearPreset(); }, [clearPreset]);
  const wMidGain     = useCallback(v => { setMidGain(v);     clearPreset(); }, [clearPreset]);
  const wHighGain    = useCallback(v => { setHighGain(v);    clearPreset(); }, [clearPreset]);
  const wPad         = useCallback(v => { setPad(v);         clearPreset(); }, [clearPreset]);

  const fmtGain = v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`;

  return (
    <div style={{
      width: 380,
      height: 500,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRadius: 12,
      padding: '12px 14px 10px',
      background: PANEL_BG,
      border: `1px solid ${FRAME}`,
      boxShadow: 'inset 0 1px 0 rgba(180,215,235,0.14), 0 4px 20px rgba(0,0,0,0.65)',
      color: FG,
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3" style={{ flexShrink: 0 }}>
        <div>
          <div className="font-black tracking-[0.10em]" style={{ fontSize: 14,
            color: STEEL_H,
            textShadow: `0 0 10px ${STEEL}, 0 0 2px rgba(200,230,248,0.4)`,
          }}>
            NASTY NEVE
          </div>
          <div className="text-[7px] tracking-[0.24em] uppercase mt-[1px]" style={{ color: FG_DIM }}>
            5-stage 1073 preamp · <span style={{ color: STEEL_H, fontWeight: 700 }}>{NASTY_NEVE_VERSION}</span>
          </div>
        </div>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset}
          colors={{ bg: 'rgba(140,200,230,0.15)', text: '#c8e0f0', textDim: 'rgba(175,210,230,0.5)', border: 'rgba(140,200,230,0.3)', hoverBg: 'rgba(140,200,230,0.2)', activeBg: 'rgba(140,200,230,0.12)' }} />
        <div className="flex items-center gap-1.5">
          {/* PAD — -20 dB input attenuator */}
          <button
            onClick={() => wPad(!pad)}
            title="-20 dB input pad"
            className="text-[9px] font-black tracking-[0.14em] rounded-md px-2 py-1 border"
            style={{
              background:  pad ? 'rgba(210,160,40,0.28)'  : 'rgba(255,255,255,0.06)',
              borderColor: pad ? 'rgba(240,190,60,0.75)'  : 'rgba(255,255,255,0.15)',
              color:       pad ? '#ffe8a0'                : 'rgba(175,205,225,0.45)',
              boxShadow:   pad ? '0 0 8px rgba(240,190,60,0.45)' : 'none',
              transition: 'all 0.12s',
            }}>
            -20
          </button>
          {/* BYPASS — lit red when engaged so it's unmistakable */}
          <button
            onClick={() => setBypassed(b => !b)}
            title={bypassed ? 'Bypass engaged — click to enable' : 'Click to bypass'}
            className="text-[9px] font-black tracking-[0.14em] rounded-md px-2 py-1 border"
            style={{
              background:  bypassed ? 'rgba(200,70,55,0.30)'   : 'rgba(100,165,200,0.22)',
              borderColor: bypassed ? 'rgba(230,110,90,0.75)'  : 'rgba(140,200,230,0.55)',
              color:       bypassed ? '#ffd9d3'                : STEEL_H,
              boxShadow:   bypassed ? '0 0 8px rgba(230,110,90,0.55)' : 'none',
              transition: 'all 0.12s',
            }}>
            {bypassed ? 'BYPASS' : 'ACTIVE'}
          </button>
          {/* X close button */}
          {onRemove && (
            <button
              onClick={onRemove}
              title="Remove module"
              className="text-[12px] leading-none font-bold rounded-md border flex items-center justify-center"
              style={{
                width: 22, height: 22,
                background: 'rgba(255,255,255,0.05)',
                borderColor: 'rgba(140,200,230,0.30)',
                color: 'rgba(200,225,240,0.65)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(220,90,75,0.25)';
                e.currentTarget.style.borderColor = 'rgba(230,110,90,0.65)';
                e.currentTarget.style.color = '#ffd9d3';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(140,200,230,0.30)';
                e.currentTarget.style.color = 'rgba(200,225,240,0.65)';
              }}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── PREAMP section ── */}
      <SectionLabel>PREAMP</SectionLabel>
      <div className="flex items-end justify-around mb-4" style={{ flex: 1, minHeight: 0 }}>
        <NastyKnob
          label="DRIVE" value={drive} onChange={wDriveS}
          min={0} max={18} defaultValue={0} size={38}
          accentColor={MIC_RED} faceColor="#3a1a1a"
          format={v => `${v.toFixed(1)} dB`}
        />
        <NastyKnob
          label="THICK" value={thickness} onChange={wThicknessS}
          min={0} max={1} defaultValue={0} size={38}
          format={v => `${(v * 100).toFixed(0)}%`}
        />
        <NastyKnob
          label="OUT" value={outputTrim} onChange={wOutputTrimS}
          min={-24} max={20} defaultValue={0} size={38}
          format={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`}
        />
      </div>

      {/* ── EQ section ── */}
      <SectionLabel right={
        <button
          onClick={() => wEqlOn(!eqlOn)}
          className="text-[8px] font-black tracking-[0.18em] rounded px-2 py-[3px] border"
          style={{
            background:  eqlOn ? 'rgba(100,165,210,0.28)' : 'rgba(255,255,255,0.06)',
            borderColor: eqlOn ? 'rgba(140,200,235,0.65)' : 'rgba(255,255,255,0.15)',
            color:       eqlOn ? STEEL_H : 'rgba(175,205,225,0.45)',
            boxShadow:   eqlOn ? `0 0 8px ${STEEL}99` : 'none',
            transition: 'all 0.15s',
          }}>
          EQL
        </button>
      }>EQ</SectionLabel>

      {/* EQ controls row */}
      <div
        className="flex items-start mb-3"
        style={{
          flexShrink: 0,
          gap: 6,
          opacity: eqlOn ? 1 : 0.42,
          transition: 'opacity 0.2s',
          pointerEvents: eqlOn ? 'auto' : 'none',
        }}
      >
        {/* HPF */}
        <StepKnob
          label="HPF"
          steps={HPF_STEPS}
          selectedIndex={hpfIdx}
          onChange={wHpfIdx}
          size={28}
          accentColor={BLUE}
          faceColor="#1a2a4a"
        />

        <div style={{ width: 1, alignSelf: 'stretch', background: DIV_CLR, margin: '4px 0' }} />

        {/* LOW: gain knob + freq selector below */}
        <div className="flex flex-col items-center gap-1">
          <NastyKnob
            label="LOW" value={lowGain} onChange={wLowGain}
            min={-16} max={16} defaultValue={0} size={28}
            format={fmtGain}
          />
          <div className="flex gap-[3px] flex-wrap justify-center" style={{ maxWidth: 80 }}>
            {[35, 60, 110, 220].map(f => (
              <button key={f}
                onClick={() => wLowFreq(f)}
                className="text-[7px] font-bold rounded px-[5px] py-[1px] border"
                style={{
                  background:  lowFreq === f ? 'rgba(100,165,210,0.28)' : 'rgba(255,255,255,0.05)',
                  borderColor: lowFreq === f ? 'rgba(140,200,235,0.60)' : 'rgba(255,255,255,0.12)',
                  color:       lowFreq === f ? STEEL_H : FG_DIM,
                  cursor: 'pointer',
                }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div style={{ width: 1, alignSelf: 'stretch', background: DIV_CLR, margin: '4px 0' }} />

        {/* MID: freq step knob + gain knob side-by-side */}
        <div className="flex gap-1 items-start">
          <StepKnob
            label="MID"
            steps={MID_STEPS}
            selectedIndex={midIdx}
            onChange={wMidIdx}
            size={28}
          />
          <NastyKnob
            label="GAIN" value={midGain} onChange={wMidGain}
            min={-18} max={18} defaultValue={0} size={28}
            format={fmtGain}
          />
        </div>

        <div style={{ width: 1, alignSelf: 'stretch', background: DIV_CLR, margin: '4px 0' }} />

        {/* HIGH: gain only, fixed 12 kHz */}
        <NastyKnob
          label="12k" value={highGain} onChange={wHighGain}
          min={-16} max={16} defaultValue={0} size={28}
          format={fmtGain}
        />
      </div>


      <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />
    </div>
  );
}
