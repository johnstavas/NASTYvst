// PingPongOrb — classic stereo ping-pong delay. Single dedicated worklet
// handles cross-coupled topology + built-in tone filter inside the loop.
//
// Pattern: a single input pulse fires L, R, L, R alternating, each repeat
// quieter. SPREAD knob blends between full ping-pong (1.0) and mono-summed
// wet (0.0) for in-the-mix usage.
//
// Topology + design notes live on the PINGPONG_DLY graph in mockGraphs.js.

import React, { useEffect, useRef, useState } from 'react';
import { PINGPONG_DLY } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';

const ACCENT       = '#7adcc8';                   // mint stereo-bounce
const ACCENT_FAINT = 'rgba(122,220,200,';

export default function PingPongOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of PINGPONG_DLY.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[PingPong] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(PINGPONG_DLY, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[PingPong] compile failed:', e);
        return;
      }
      if (cancelled) { try { inst.dispose(); } catch {} return; }

      compiledRef.current = inst;
      for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);

      const engine = {
        input:        inst.inputNode,
        output:       inst.outputNode,
        chainOutput:  inst.outputNode,
        setBypass:    inst.setBypass,
        dispose:      inst.dispose,
        __sandboxCompiled: inst,
        __graph: PINGPONG_DLY,
      };
      registerEngine?.(instanceId, engine);

      cleanup = () => {
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

  // Live-graph mirror.
  useEffect(() => {
    const liveNodes = PINGPONG_DLY.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of PINGPONG_DLY.panel.knobs) {
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
    setLiveGraph(instanceId, { ...PINGPONG_DLY, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(18,30,28,0.96), rgba(10,20,18,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.28)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(220,245,238,0.92)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase',
            color: `${ACCENT_FAINT}0.7)`,
          }}>Sandbox-native · stereo ping-pong delay</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>PingPong</div>
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

      {/* L↔R bouncing dots — visual representation of the stereo bounce.
          Animation period is locked to the TIME knob. */}
      <BounceRow time01={knobs.time ?? 0.4} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      <PresetRow panel={PINGPONG_DLY.panel} onApply={(v01Map) => setKnobs(v01Map)} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {PINGPONG_DLY.panel.knobs.map(k => (
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
        marginTop: 12, padding: '8px 10px', borderRadius: 6,
        background: `${ACCENT_FAINT}0.05)`,
        border: `1px dashed ${ACCENT_FAINT}0.2)`,
        fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: `${ACCENT_FAINT}0.55)`, textAlign: 'center',
      }}>
        cross-coupled · LP tone · stereo out
      </div>
    </div>
  );
}

function BounceRow({ time01, accent, accentFaint }) {
  // CSS animation period locked to the TIME knob — log map [50, 2000] ms × 2
  // for the L→R→L round-trip.
  const ms = 50 * Math.pow(2000 / 50, time01);
  const periodS = (ms * 2) / 1000;
  return (
    <div style={{
      position: 'relative',
      height: 30, marginBottom: 12, padding: '0 24px',
      borderRadius: 6,
      background: 'rgba(0,0,0,0.4)',
      border: `1px solid ${accentFaint}0.18)`,
      overflow: 'hidden',
    }}>
      <span style={{
        position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
        fontSize: 8, letterSpacing: '0.3em', fontWeight: 700,
        color: `${accentFaint}0.6)`,
      }}>L</span>
      <span style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        fontSize: 8, letterSpacing: '0.3em', fontWeight: 700,
        color: `${accentFaint}0.6)`,
      }}>R</span>
      <div style={{
        position: 'absolute', left: 30, right: 30, top: '50%', height: 2,
        transform: 'translateY(-50%)',
        background: `linear-gradient(90deg, ${accentFaint}0.0), ${accentFaint}0.25), ${accentFaint}0.0))`,
      }} />
      <div style={{
        position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
        width: 10, height: 10, borderRadius: '50%',
        background: accent,
        boxShadow: `0 0 8px ${accent}, 0 0 18px ${accentFaint}0.55)`,
        animation: `pingPongBounce ${periodS.toFixed(2)}s linear infinite`,
      }} />
      <style>{`@keyframes pingPongBounce {
          0%   { left: 30px; }
          50%  { left: calc(100% - 30px); }
          100% { left: 30px; }
      }`}</style>
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

  if (knob.id === 'time') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(2)} s` : `${Math.round(mapped)} ms`;
  }
  if (knob.id === 'tone') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(1)} kHz` : `${Math.round(mapped)} Hz`;
  }
  if (knob.id === 'feedback' || knob.id === 'mix' || knob.id === 'spread') return `${Math.round(v01 * 100)}%`;
  return mapped.toFixed(2);
}

function unmapToNorm(mapping, target) {
  const [lo, hi] = mapping.range || [0, 1];
  if (mapping.curve === 'log' && lo > 0 && hi > 0) {
    return Math.log(target / lo) / Math.log(hi / lo);
  }
  if (mapping.curve === 'pow') {
    return Math.sqrt((target - lo) / (hi - lo));
  }
  return (target - lo) / (hi - lo);
}

function presetToKnobs(panel, presetValues) {
  const paramIndex = {};
  for (const k of panel.knobs) {
    for (const m of k.mappings) {
      paramIndex[k.id] = paramIndex[k.id] || { knobId: k.id, mapping: m };
    }
  }
  const out = {};
  for (const [knobId, target] of Object.entries(presetValues)) {
    const hit = paramIndex[knobId];
    if (!hit) continue;
    out[hit.knobId] = Math.max(0, Math.min(1, unmapToNorm(hit.mapping, target)));
  }
  return out;
}

const PINGPONG_PRESETS = [
  { id: 'classic', label: 'Classic',
    values: { time: 380, feedback: 0.55, tone: 4500, spread: 1.0, mix: 0.4 } },
  { id: 'dub',     label: 'Dub Echo',
    values: { time: 600, feedback: 0.7,  tone: 1800, spread: 1.0, mix: 0.5 } },
  { id: 'slap',    label: 'Slap',
    values: { time: 130, feedback: 0.25, tone: 7000, spread: 1.0, mix: 0.35 } },
  { id: 'fast',    label: 'Fast Pan',
    values: { time: 220, feedback: 0.6,  tone: 6000, spread: 1.0, mix: 0.45 } },
  { id: 'mix-it',  label: 'In Mix',
    values: { time: 320, feedback: 0.45, tone: 4000, spread: 0.4, mix: 0.3 } },
];

function PresetRow({ panel, onApply, accent, accentFaint }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: `${accentFaint}0.55)`, alignSelf: 'center', marginRight: 4,
      }}>Voicing</span>
      {PINGPONG_PRESETS.map(p => (
        <button
          key={p.id}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onApply(presetToKnobs(panel, p.values)); }}
          title={`${p.label} — ${p.values.time}ms · fb ${Math.round(p.values.feedback*100)}% · tone ${p.values.tone}Hz · spread ${Math.round(p.values.spread*100)}%`}
          style={{
            fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
            fontWeight: 700, padding: '5px 9px',
            background: `${accentFaint}0.08)`,
            border: `1px solid ${accentFaint}0.3)`,
            borderRadius: 4,
            color: accent,
            cursor: 'pointer',
          }}
        >{p.label}</button>
      ))}
    </div>
  );
}

function BigKnob({ label, value, onChange, format, accent }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'rgba(220,245,238,0.7)',
        marginBottom: 4,
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
