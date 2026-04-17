// PantherBussOrb.jsx — minimal test UI for Panther Buss on the new
// FxEngine. Five knobs (DRIVE / GLUE / TONE / OUTPUT / MIX), nothing
// else. All updates go through the engine's setter methods, which call
// fx.setParam under the hood — no direct DSP access.

import React, { useEffect, useRef, useState } from 'react';
import { createPantherBussEngine } from './pantherBussEngine.js';

const MACROS = [
  { key: 'drive',  label: 'DRIVE',  setter: 'setDrive',  bipolar: false },
  { key: 'glue',   label: 'GLUE',   setter: 'setGlue',   bipolar: false },
  { key: 'tone',   label: 'TONE',   setter: 'setTone',   bipolar: true  },
  { key: 'output', label: 'OUTPUT', setter: 'setOutput', bipolar: true  },
  { key: 'mix',    label: 'MIX',    setter: 'setMix',    bipolar: false },
];

const DEFAULTS = { drive: 0.30, glue: 0.40, tone: 0.50, output: 0.50, mix: 1.00 };

function Slider({ label, value, onChange, bipolar }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 120 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.2em',
        color: 'rgba(255,255,255,0.65)', fontFamily: 'system-ui',
      }}>{label}</div>
      <input
        type="range"
        min={0} max={1} step={0.001}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>
        {bipolar
          ? ((value - 0.5) * 2).toFixed(2)
          : value.toFixed(2)}
      </div>
    </div>
  );
}

export default function PantherBussOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState({ ...DEFAULTS, ...(initialState || {}) });

  // Create engine once — async because the worklet has to load.
  useEffect(() => {
    let disposed = false;
    (async () => {
      if (!sharedSource) return;
      const eng = await createPantherBussEngine(sharedSource.ctx);
      if (disposed) { eng.dispose(); return; }
      engineRef.current = eng;
      // Push initial state through setters so the DSP reflects UI state.
      eng.setDrive (state.drive);
      eng.setGlue  (state.glue);
      eng.setTone  (state.tone);
      eng.setOutput(state.output);
      eng.setMix   (state.mix);
      registerEngine(instanceId, eng);
      setReady(true);
    })();
    return () => {
      disposed = true;
      unregisterEngine(instanceId);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSource]);

  // Persist state up to the App's preset layer
  useEffect(() => { onStateChange?.(instanceId, state); }, [state, instanceId, onStateChange]);

  const setMacro = (key, setter) => v => {
    setState(s => ({ ...s, [key]: v }));
    engineRef.current?.[setter](v);
  };

  return (
    <div style={{
      width: 680, padding: 18, borderRadius: 14,
      background: 'rgba(20,28,22,0.85)',
      border: '1px solid rgba(255,255,255,0.08)',
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'system-ui',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 800, letterSpacing: '0.3em',
          color: '#9fff8f',
        }}>PANTHER BUSS</div>
        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.2em' }}>
          {ready ? 'FX ENGINE · READY' : 'LOADING…'}
        </div>
        {onRemove && (
          <button onClick={onRemove} style={{
            fontSize: 10, background: 'transparent', color: 'rgba(255,255,255,0.35)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
            padding: '2px 8px', cursor: 'pointer',
          }}>×</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        {MACROS.map(m => (
          <Slider
            key={m.key}
            label={m.label}
            value={state[m.key]}
            onChange={setMacro(m.key, m.setter)}
            bipolar={m.bipolar}
          />
        ))}
      </div>
    </div>
  );
}
