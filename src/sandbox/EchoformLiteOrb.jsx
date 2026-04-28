// EchoformLiteOrb — Step 3 dogfood of sandbox core.
// See memory/sandbox_core_scope.md.
//
// First sandbox-native brick that uses an *external* feedback loop —
// saturation + tone filter live inside the loop, so each delay repeat
// gets darker and grittier. Same design trick as the hand-coded Echoform
// worklet, but built from the MVP 6 ops.
//
// Panel: TIME · FEEDBACK · TONE · DRIVE · MIX (five knobs, all mapped).
// Underlying audio = delay → filter → saturate (in loop) → mix.
//
// This is NOT audio-identical to the shipping Echoform — it's missing
// stereo width, allpass blur, LFO motion, and a 2-pole filter. Those
// ops are the next batch of registry work (tracked in sandbox_core_scope).
// The value here is proving the authoring pattern: external-FB loops,
// character-in-the-loop, panel mapping, all end-to-end.

import React, { useEffect, useRef, useState } from 'react';
import { ECHOFORM_LITE } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { setLiveGraph, clearLiveGraph, setLiveSetParam, clearLiveSetParam } from './liveGraphStore';

const ACCENT = '#7fd4b3';               // muted mint — distinct from FilterFX (#e7b478)
const ACCENT_FAINT = 'rgba(127,212,179,';

export default function EchoformLiteOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of ECHOFORM_LITE.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
    return out;
  });

  const compiledRef = useRef(null);

  useEffect(() => {
    if (!ctx) return;
    let inst;
    try { inst = compileGraphToWebAudio(ECHOFORM_LITE, ctx); }
    catch (e) {
      // eslint-disable-next-line no-console
      console.error('[EchoformLite] compile failed:', e);
      return;
    }
    compiledRef.current = inst;
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);

    // Bypass topology is owned by compileGraphToWebAudio — see its header.
    const engine = {
      input:        inst.inputNode,
      output:       inst.outputNode,
      chainOutput:  inst.outputNode,
      setBypass:    inst.setBypass,
      dispose:      inst.dispose,
      __sandboxCompiled: inst,
      __graph: ECHOFORM_LITE,
    };
    registerEngine?.(instanceId, engine);

    setLiveSetParam(instanceId, (nodeId, paramId, v) => inst.setParam(nodeId, paramId, v));
    return () => {
      inst.dispose();
      unregisterEngine?.(instanceId);

      clearLiveSetParam(instanceId);
      compiledRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Fan knob changes → compiler.
  useEffect(() => {
    const inst = compiledRef.current;
    if (!inst) return;
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);
  }, [knobs]);

  // Publish live graph with mapped values so brick-zoom reflects reality.
  useEffect(() => {
    const liveNodes = ECHOFORM_LITE.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of ECHOFORM_LITE.panel.knobs) {
      const v = knobs[k.id];
      if (v == null) continue;
      for (const m of k.mappings) {
        const [lo, hi] = m.range || [0, 1];
        let mapped;
        if (m.curve === 'log' && lo > 0 && hi > 0) {
          mapped = lo * Math.pow(hi / lo, v);
        } else if (m.curve === 'pow') {
          mapped = lo + (hi - lo) * (v * v);
        } else {
          mapped = lo + (hi - lo) * v;
        }
        const node = liveNodes.find(n => n.id === m.nodeId);
        if (node) node.params[m.paramId] = +mapped.toFixed(3);
      }
    }
    setLiveGraph(instanceId, { ...ECHOFORM_LITE, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(22,30,28,0.96), rgba(12,18,16,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.25)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(220,245,236,0.9)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18,
      }}>
        <div>
          <div style={{
            fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase',
            color: `${ACCENT_FAINT}0.7)`,
          }}>Sandbox-native · external-FB loop</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>EchoformLite</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {onToggleBypass && (
          <button onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onToggleBypass(); }}
                  title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass (A/B)'}
                  style={{
                    fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
                    fontWeight: 700, padding: '5px 10px',
                    background: bypassed ? 'rgba(255,255,255,0.12)' : `${ACCENT_FAINT}0.18)`,
                    border: `1px solid ${bypassed ? 'rgba(255,255,255,0.25)' : `${ACCENT_FAINT}0.45)`}`,
                    borderRadius: 4,
                    color: bypassed ? 'rgba(255,255,255,0.55)' : ACCENT,
                    cursor: 'pointer',
                  }}>{bypassed ? 'BYP' : 'ON'}</button>
        )}
        {onRemove && (
          <button onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  style={{
                    fontSize: 14, padding: '4px 10px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 4,
                    color: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer',
                  }}>×</button>
        )}
        </div>
      </div>

      {ECHOFORM_LITE.panel.knobs.map(k => (
        <BigKnob
          key={k.id}
          label={k.label}
          value={knobs[k.id]}
          onChange={(v) => setKnobs(prev => ({ ...prev, [k.id]: v }))}
          format={(v01) => formatKnobValue(k, v01)}
          accent={ACCENT}
        />
      ))}

      <div style={{
        marginTop: 14, padding: '8px 10px', borderRadius: 6,
        background: `${ACCENT_FAINT}0.05)`,
        border: `1px dashed ${ACCENT_FAINT}0.2)`,
        fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: `${ACCENT_FAINT}0.55)`, textAlign: 'center',
      }}>
        5 knobs · 4 ops · character lives in the loop
      </div>
    </div>
  );
}

/** Format the displayed value using the first mapping's range/curve. */
function formatKnobValue(knob, v01) {
  const m = knob.mappings[0];
  if (!m) return `${Math.round(v01 * 100)}%`;
  const [lo, hi] = m.range || [0, 1];
  let mapped;
  if (m.curve === 'log' && lo > 0 && hi > 0) mapped = lo * Math.pow(hi / lo, v01);
  else if (m.curve === 'pow')                 mapped = lo + (hi - lo) * (v01 * v01);
  else                                        mapped = lo + (hi - lo) * v01;
  if (m.paramId === 'cutoff') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(2)} kHz` : `${Math.round(mapped)} Hz`;
  }
  if (m.paramId === 'time')     return `${Math.round(mapped)} ms`;
  if (m.paramId === 'feedback') return `${Math.round(mapped * 100)}%`;
  if (m.paramId === 'amount')   return `${Math.round(mapped * 100)}%`;
  if (m.paramId === 'drive')    return `${mapped.toFixed(2)}×`;
  return mapped.toFixed(2);
}

function BigKnob({ label, value, onChange, format, accent }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: 'rgba(220,245,236,0.7)',
        marginBottom: 6,
      }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: accent }}>
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range" min={0} max={1} step={0.0001}
        value={value}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: accent }}
      />
    </div>
  );
}
