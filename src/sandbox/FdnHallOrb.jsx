// FdnHallOrb — Tier-3 dogfood, first sandbox-native reverb.
//
// Monolithic `fdnReverb` op port of morphReverbEngine.js inside a
// one-node sandbox graph. Proves the compiler can host stereo
// feedback-heavy DSP archetypes before the master-worklet compiler
// lands to enable graph-visible feedback cycles.
//
// Cloned from LofiLightOrb with the 7 reverb knobs wired straight
// through the sandbox panel-mapping layer (all 0..1 → worklet param).

import React, { useEffect, useRef, useState } from 'react';
import { FDN_HALL } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph, setLiveSetParam, clearLiveSetParam } from './liveGraphStore';

const ACCENT       = '#8cd4e8';               // cool hall blue
const ACCENT_FAINT = 'rgba(140,212,232,';

export default function FdnHallOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of FDN_HALL.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
    return out;
  });

  const compiledRef = useRef(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try { await ensureSandboxWorklets(ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[FdnHall] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(FDN_HALL, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[FdnHall] compile failed:', e);
        return;
      }
      if (cancelled) { try { inst.dispose(); } catch {} return; }

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
        __graph: FDN_HALL,
      };
      registerEngine?.(instanceId, engine);

      setLiveSetParam(instanceId, (nodeId, paramId, v) => inst.setParam(nodeId, paramId, v));

      cleanup = () => {
        inst.dispose();
        unregisterEngine?.(instanceId);

        clearLiveSetParam(instanceId);
        compiledRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    const inst = compiledRef.current;
    if (!inst) return;
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);
  }, [knobs]);

  useEffect(() => {
    const liveNodes = FDN_HALL.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of FDN_HALL.panel.knobs) {
      const v = knobs[k.id];
      if (v == null) continue;
      for (const m of k.mappings) {
        const [lo, hi] = m.range || [0, 1];
        let mapped;
        if (m.curve === 'log' && lo > 0 && hi > 0) mapped = lo * Math.pow(hi / lo, v);
        else if (m.curve === 'pow')                 mapped = lo + (hi - lo) * (v * v);
        else                                        mapped = lo + (hi - lo) * v;
        const node = liveNodes.find(n => n.id === m.nodeId);
        if (node) node.params[m.paramId] = +mapped.toFixed(4);
      }
    }
    setLiveGraph(instanceId, { ...FDN_HALL, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(18,28,38,0.96), rgba(8,14,22,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.25)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(220,240,250,0.9)',
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
          }}>Sandbox-native · FDN reverb</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>FdnHall</div>
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

      {FDN_HALL.panel.knobs.map(k => (
        <BigKnob
          key={k.id}
          label={k.label}
          value={knobs[k.id]}
          onChange={(v) => setKnobs(prev => ({ ...prev, [k.id]: v }))}
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
        1 op · Geraint Luff FDN · Tier-3 port
      </div>
    </div>
  );
}

function BigKnob({ label, value, onChange, accent }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: 'rgba(220,240,250,0.7)',
        marginBottom: 6,
      }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: accent }}>
          {`${Math.round(value * 100)}%`}
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
