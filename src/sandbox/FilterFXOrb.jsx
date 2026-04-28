// FilterFXOrb — Step 2e demo of the panel-mapping layer.
// See memory/sandbox_core_scope.md.
//
// Same gain/filter/mix ops as SandboxToyOrb. Identical audio. But the
// UI is driven entirely by `graph.panel.knobs` — one TONE knob, log
// taper from 200 Hz → 12 kHz. The user never sees the gain or mix; the
// brick author baked those in.
//
// The brick-zoom view still shows the underlying ops (truth is truth).
// A small "Panel" badge in the orb header makes the abstraction visible.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FILTER_FX } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { setLiveGraph, clearLiveGraph, setLiveSetParam, clearLiveSetParam } from './liveGraphStore';

export default function FilterFXOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  // Knob state — keyed by panel knob id, normalized 0..1.
  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of FILTER_FX.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
    return out;
  });

  const compiledRef = useRef(null);

  useEffect(() => {
    if (!ctx) return;
    let inst;
    try { inst = compileGraphToWebAudio(FILTER_FX, ctx); }
    catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FilterFX] compile failed:', e);
      return;
    }
    compiledRef.current = inst;
    // Apply current knob values (in case initialState differs from defaults).
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);

    // Bypass topology is owned by compileGraphToWebAudio — see its header.
    const engine = {
      input:        inst.inputNode,
      output:       inst.outputNode,
      chainOutput:  inst.outputNode,
      setBypass:    inst.setBypass,
      dispose:      inst.dispose,
      __sandboxCompiled: inst,
      __graph: FILTER_FX,
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

  // Live knob updates → fan out through compiler.setKnob.
  useEffect(() => {
    const inst = compiledRef.current;
    if (!inst) return;
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);
  }, [knobs]);

  // Publish a "live graph" with the panel-applied param values so the
  // brick-zoom view shows what's actually flowing under the hood.
  useEffect(() => {
    const liveNodes = FILTER_FX.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of FILTER_FX.panel.knobs) {
      const v = knobs[k.id];
      if (v == null) continue;
      for (const m of k.mappings) {
        const [lo, hi] = m.range || [0, 1];
        const mapped = m.curve === 'log' && lo > 0 && hi > 0
          ? lo * Math.pow(hi / lo, v)
          : lo + (hi - lo) * v;
        const node = liveNodes.find(n => n.id === m.nodeId);
        if (node) node.params[m.paramId] = +mapped.toFixed(3);
      }
    }
    setLiveGraph(instanceId, { ...FILTER_FX, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(34,28,22,0.96), rgba(20,14,10,0.96))',
      borderRadius: 16,
      border: '1px solid rgba(231,180,120,0.25)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(255,235,210,0.9)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18,
      }}>
        <div>
          <div style={{
            fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase',
            color: 'rgba(231,180,120,0.7)',
          }}>Sandbox-native · panel-mapped</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>FilterFX</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {onToggleBypass && (
          <button onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onToggleBypass(); }}
                  title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass (A/B)'}
                  style={{
                    fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
                    fontWeight: 700, padding: '5px 10px',
                    background: bypassed ? 'rgba(255,255,255,0.12)' : 'rgba(231,180,120,0.18)',
                    border: `1px solid ${bypassed ? 'rgba(255,255,255,0.25)' : 'rgba(231,180,120,0.45)'}`,
                    borderRadius: 4,
                    color: bypassed ? 'rgba(255,255,255,0.55)' : '#e7b478',
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

      {FILTER_FX.panel.knobs.map(k => (
        <BigKnob
          key={k.id}
          label={k.label}
          value={knobs[k.id]}
          onChange={(v) => setKnobs(prev => ({ ...prev, [k.id]: v }))}
          format={(v01) => formatKnobValue(k, v01)}
        />
      ))}

      <div style={{
        marginTop: 14, padding: '8px 10px', borderRadius: 6,
        background: 'rgba(231,180,120,0.05)',
        border: '1px dashed rgba(231,180,120,0.2)',
        fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'rgba(231,180,120,0.55)', textAlign: 'center',
      }}>
        1 knob · 3 ops underneath · double-click to inspect
      </div>
    </div>
  );
}

/** Compute the displayed value for a knob position, using the first
 *  mapping's range/curve (good enough for single-mapping knobs; multi-
 *  mapping macros would want a custom format function). */
function formatKnobValue(knob, v01) {
  const m = knob.mappings[0];
  if (!m) return `${Math.round(v01 * 100)}%`;
  const [lo, hi] = m.range || [0, 1];
  const mapped = m.curve === 'log' && lo > 0 && hi > 0
    ? lo * Math.pow(hi / lo, v01)
    : lo + (hi - lo) * v01;
  if (m.paramId === 'cutoff') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(2)} kHz` : `${Math.round(mapped)} Hz`;
  }
  return mapped.toFixed(2);
}

function BigKnob({ label, value, onChange, format }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: 'rgba(255,235,210,0.7)',
        marginBottom: 6,
      }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#e7b478' }}>
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range" min={0} max={1} step={0.0001}
        value={value}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#e7b478' }}
      />
    </div>
  );
}
