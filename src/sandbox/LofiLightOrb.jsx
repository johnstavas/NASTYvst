// LofiLightOrb — first shipping-plugin-shaped dogfood of the sandbox.
//
// Not a toy this time: this is a minimal slice of Lofi Loofy rebuilt as
// a sandbox graph. Purpose: prove the compiler can host real-world
// character-plugin DSP (tone + drive + delay-modulation + noise bed +
// dry/wet). Scope per LOFI_LIGHT comment in mockGraphs.js.
//
// What to listen for:
//  • DRIVE pushing the saturate op into warmth.
//  • DRIFT adding audible wobble on sustained notes (LFO → delay.timeMod).
//  • DUST raising a pink-noise bed that sits under the signal.
//  • TONE dark↔bright sweep.
//  • MIX dry↔wet crossfade.
//
// Known limits (v0):
//  • Mix=0 will NOT null-test — wet path has ~1 quantum of latency.
//    Same class of issue LL engine_v1 has (CONFORMANCE §8.6). Fixed
//    later by moving mix into a master worklet.
//  • No character presets, no parallel comp, no dream reverb yet.

import React, { useEffect, useRef, useState } from 'react';
import { LOFI_LIGHT } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';

const ACCENT       = '#e8b87a';               // warm sand — reads "tape era"
const ACCENT_FAINT = 'rgba(232,184,122,';

export default function LofiLightOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of LOFI_LIGHT.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[LofiLight] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(LOFI_LIGHT, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[LofiLight] compile failed:', e);
        return;
      }
      if (cancelled) { try { inst.dispose(); } catch {} return; }

      compiledRef.current = inst;
      for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);

      const bypassPath = ctx.createGain();
      bypassPath.gain.value = 0;
      inst.inputNode.connect(bypassPath);
      bypassPath.connect(inst.outputNode);

      const engine = {
        input:        inst.inputNode,
        output:       inst.outputNode,
        chainOutput:  inst.outputNode,
        setBypass: (on) => {
          bypassPath.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.005);
        },
        dispose: () => {
          try { bypassPath.disconnect(); } catch {}
          inst.dispose();
        },
        __sandboxCompiled: inst,
        __graph: LOFI_LIGHT,
      };
      registerEngine?.(instanceId, engine);

      cleanup = () => {
        try { bypassPath.disconnect(); } catch {}
        inst.dispose();
        unregisterEngine?.(instanceId);
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
    const liveNodes = LOFI_LIGHT.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of LOFI_LIGHT.panel.knobs) {
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
        if (node) node.params[m.paramId] = +mapped.toFixed(4);
      }
    }
    setLiveGraph(instanceId, { ...LOFI_LIGHT, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(38,28,18,0.96), rgba(22,14,8,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.25)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(250,232,205,0.9)',
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
          }}>Sandbox-native · LL slice</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>LofiLight</div>
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

      {LOFI_LIGHT.panel.knobs.map(k => (
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
        11 ops · 35 % of LL · double-click to inspect
      </div>
    </div>
  );
}

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
  if (m.paramId === 'drive') return `${mapped.toFixed(2)}×`;
  if (knob.id === 'mix')     return `${Math.round(v01 * 100)}%`;
  if (knob.id === 'drift' || knob.id === 'dust') {
    return `${Math.round(v01 * 100)}%`;
  }
  if (knob.id === 'bits') {
    const b = Math.round(mapped);
    return b >= 16 ? 'off' : `${b}-bit`;
  }
  if (knob.id === 'rate') {
    return mapped >= 18000 ? 'off'
         : mapped >= 1000  ? `${(mapped / 1000).toFixed(1)} kHz`
                           : `${Math.round(mapped)} Hz`;
  }
  return mapped.toFixed(3);
}

function BigKnob({ label, value, onChange, format, accent }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: 'rgba(250,232,205,0.7)',
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
