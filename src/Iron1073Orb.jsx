// Iron1073Orb.jsx — UI for the iron1073 transformer-coloration module.
//
// Three knobs, no EQ, no HPF. Drive · Thickness · Output. This module is
// about iron tone only — pair it with the existing 1073 (NeveOrb) when you
// want tone shaping too.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createIron1073Engine } from './iron1073Engine';
import ClipMeter from './ClipMeter';
import PresetSelector from './PresetSelector';

const PRESETS = [
  { name: 'INIT', drive: 0, thickness: 0.5, outputTrim: 0, mix: 1 },
  { name: 'SUBTLE WARMTH', drive: 3, thickness: 0.3, outputTrim: -1, mix: 0.7 },
  { name: 'IRON GRIT', drive: 10, thickness: 0.7, outputTrim: -5, mix: 1 },
  { name: 'THICK BASS', drive: 6, thickness: 0.9, outputTrim: -3, mix: 0.8 },
  { name: 'PARALLEL CRUNCH', drive: 14, thickness: 0.5, outputTrim: -7, mix: 0.5 },
  { name: 'FULL SEND', drive: 18, thickness: 0.8, outputTrim: -8, mix: 1 },
];

const PANEL_BG  = 'linear-gradient(180deg, #2a2018 0%, #1a1410 100%)';
const FRAME     = 'rgba(180, 130, 70, 0.32)';
const CREAM     = 'rgba(245, 232, 200, 0.92)';
const COPPER    = 'hsl(24, 70%, 55%)';
const COPPER_H  = 'hsl(28, 85%, 65%)';

// ───────────────────────────────────────────────────────────────────────────
// IronKnob — circular drag knob with bipolar option and double-click reset
// ───────────────────────────────────────────────────────────────────────────
function IronKnob({
  label, value, onChange,
  min = 0, max = 1, defaultValue,
  size = 28, ringColor = COPPER, format,
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ y: 0, v: 0 });

  const norm  = (value - min) / (max - min);
  const angle = -135 + norm * 270;

  const onDown = (e) => {
    e.preventDefault();
    setDragging(true);
    startRef.current = { y: e.clientY, v: value };
    const onMove = (ev) => {
      const dy = startRef.current.y - ev.clientY;
      const next = Math.max(min, Math.min(max, startRef.current.v + (dy / 140) * (max - min)));
      onChange(next);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  };

  const onDouble = () => { if (defaultValue !== undefined) onChange(defaultValue); };

  // Arc background (270° sweep) and fill arc (from start to current angle)
  const r = size * 0.42;
  const cx = size / 2, cy = size / 2;
  const a0 = -135 * Math.PI / 180;
  const a1 = angle * Math.PI / 180;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = (angle - -135) > 180 ? 1 : 0;
  const arcD = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  // Full background arc 270°
  const aE = 135 * Math.PI / 180;
  const xE = cx + r * Math.cos(aE), yE = cy + r * Math.sin(aE);
  const bgD = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 1 1 ${xE.toFixed(2)} ${yE.toFixed(2)}`;

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size + 12 }}>
      <div className="tracking-[0.18em] font-semibold mb-1" style={{ color: 'rgba(255,230,180,0.55)', fontSize: '6.5px' }}>
        {label}
      </div>
      <div
        onMouseDown={onDown}
        onDoubleClick={onDouble}
        style={{
          width: size, height: size, borderRadius: '50%',
          cursor: dragging ? 'grabbing' : 'grab',
          background: `radial-gradient(circle at 35% 30%, hsl(24,30%,28%) 0%, hsl(20,40%,15%) 70%, hsl(20,50%,8%) 100%)`,
          boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.08), inset 0 -2px 4px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.5)',
          position: 'relative',
        }}
      >
        <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
          <path d={bgD} stroke="rgba(0,0,0,0.5)" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d={arcD} stroke={ringColor} strokeWidth="3" fill="none" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 4px ${ringColor})` }} />
        </svg>
        {/* Pointer line */}
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          width: 2, height: size * 0.32,
          background: ringColor,
          transformOrigin: '1px 0',
          transform: `translate(-1px, 0) rotate(${angle + 90}deg)`,
          boxShadow: `0 0 4px ${ringColor}`,
        }} />
      </div>
      <div className="mt-1 font-mono tabular-nums" style={{ color: CREAM, fontSize: '5.5px' }}>
        {format ? format(value) : value.toFixed(2)}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Iron1073Orb — main component
// ───────────────────────────────────────────────────────────────────────────
export default function Iron1073Orb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  hotLevel = 0,
}) {
  const [drive,      setDriveS     ] = useState(initialState?.drive      ?? 0);
  const [thickness,  setThicknessS ] = useState(initialState?.thickness  ?? 0.5);
  const [outputTrim, setOutputTrimS] = useState(initialState?.outputTrim ?? 0);
  const [mix,        setMixS       ] = useState(initialState?.mix        ?? 1);
  const [bypassed,   setBypassed   ] = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? 'INIT');

  const loadPreset = useCallback((preset) => {
    setDriveS(preset.drive); setThicknessS(preset.thickness);
    setOutputTrimS(preset.outputTrim); setMixS(preset.mix);
    setActivePreset(preset.name);
  }, []);

  const clearPreset = useCallback(() => setActivePreset(null), []);
  const wDriveS      = useCallback(v => { setDriveS(v);      clearPreset(); }, [clearPreset]);
  const wThicknessS  = useCallback(v => { setThicknessS(v);  clearPreset(); }, [clearPreset]);
  const wOutputTrimS = useCallback(v => { setOutputTrimS(v); clearPreset(); }, [clearPreset]);
  const wMixS        = useCallback(v => { setMixS(v);        clearPreset(); }, [clearPreset]);

  const [inLevel,  setInLevel ] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [inPeak,   setInPeak  ] = useState(0);
  const [outPeak,  setOutPeak ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  const stateRefs = {
    drive:      useRef(drive),
    thickness:  useRef(thickness),
    outputTrim: useRef(outputTrim),
    mix:        useRef(mix),
    bypassed:   useRef(bypassed),
  };
  stateRefs.drive.current      = drive;
  stateRefs.thickness.current  = thickness;
  stateRefs.outputTrim.current = outputTrim;
  stateRefs.mix.current        = mix;
  stateRefs.bypassed.current   = bypassed;

  // Engine lifecycle
  useEffect(() => {
    if (!sharedSource) return;
    const engine = createIron1073Engine(sharedSource.ctx);
    engineRef.current = engine;

    engine.setDrive(stateRefs.drive.current);
    engine.setThickness(stateRefs.thickness.current);
    engine.setOutputTrim(stateRefs.outputTrim.current);
    engine.setMix(stateRefs.mix.current);
    engine.setBypass(stateRefs.bypassed.current);

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
  }, [sharedSource]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { engineRef.current?.setDrive(drive);           }, [drive]);
  useEffect(() => { engineRef.current?.setThickness(thickness);   }, [thickness]);
  useEffect(() => { engineRef.current?.setOutputTrim(outputTrim); }, [outputTrim]);
  useEffect(() => { engineRef.current?.setMix(mix);               }, [mix]);
  useEffect(() => { engineRef.current?.setBypass(bypassed);       }, [bypassed]);

  useEffect(() => {
    onStateChange?.(instanceId, { drive, thickness, outputTrim, mix, bypassed, preset: activePreset });
  }, [drive, thickness, outputTrim, mix, bypassed, activePreset]); // eslint-disable-line

  return (
    <div style={{
      width: 380,
      minHeight: 500,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'visible',
      borderRadius: 12,
      padding: 14,
      background: PANEL_BG,
      border: `1px solid ${FRAME}`,
      boxShadow: 'inset 0 1px 0 rgba(255,200,140,0.12), 0 4px 16px rgba(0,0,0,0.6)',
      color: CREAM,
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4" style={{ flexShrink: 0 }}>
        <div>
          <div className="font-bold tracking-wider" style={{ color: COPPER_H, fontSize: 14 }}>
            IRON 1073
          </div>
          <div className="text-[8px] tracking-[0.22em] uppercase" style={{ color: 'rgba(255,200,140,0.4)' }}>
            transformer tone
          </div>
        </div>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset}
          colors={{ bg: 'rgba(180,130,70,0.25)', text: '#f5e8c8', textDim: 'rgba(255,200,140,0.5)', border: 'rgba(180,130,70,0.4)', hoverBg: 'rgba(180,130,70,0.35)', activeBg: 'rgba(180,130,70,0.2)' }} />
        <button
          onClick={() => setBypassed(b => !b)}
          className="text-[9px] font-semibold rounded-md px-2 py-1 border"
          style={{
            background: bypassed ? 'rgba(180,180,180,0.1)' : 'rgba(220,90,30,0.18)',
            borderColor: bypassed ? 'rgba(180,180,180,0.3)' : 'rgba(220,90,30,0.5)',
            color: bypassed ? 'rgba(200,200,200,0.6)' : COPPER_H,
          }}>
          {bypassed ? 'OFF' : 'ON'}
        </button>
      </div>

      {/* Three-knob row */}
      <div className="flex items-end justify-around mb-3">
        <IronKnob
          label="DRIVE"
          value={drive}
          onChange={wDriveS}
          min={0} max={18}
          defaultValue={0}
          ringColor={COPPER}
          format={v => `${v.toFixed(1)} dB`}
        />
        <IronKnob
          label="THICK"
          value={thickness}
          onChange={wThicknessS}
          min={0} max={1}
          defaultValue={0.5}
          ringColor="hsl(34, 75%, 58%)"
          format={v => `${(v * 100).toFixed(0)}%`}
        />
        <IronKnob
          label="OUT"
          value={outputTrim}
          onChange={wOutputTrimS}
          min={-24} max={6}
          defaultValue={0}
          ringColor="hsl(46, 80%, 60%)"
          format={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`}
        />
      </div>

      {/* Mix slider — secondary control */}
      <div className="flex items-center gap-2 mb-2 px-1" style={{ flexShrink: 0 }}>
        <span className="text-[8px] tracking-[0.18em] font-semibold" style={{ color: 'rgba(255,200,140,0.5)' }}>
          MIX
        </span>
        <input
          type="range" min="0" max="1" step="0.01"
          value={mix}
          onChange={e => wMixS(parseFloat(e.target.value))}
          onDoubleClick={() => wMixS(1)}
          className="flex-1"
          style={{ accentColor: COPPER }}
        />
        <span className="text-[9px] font-mono tabular-nums w-8 text-right" style={{ color: CREAM }}>
          {(mix * 100).toFixed(0)}%
        </span>
      </div>

      <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />

      {onRemove && (
        <button onClick={onRemove}
          className="w-full mt-2 text-[8px] tracking-[0.15em] uppercase rounded py-1"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,200,140,0.4)' }}>
          remove
        </button>
      )}
    </div>
  );
}
