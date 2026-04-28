// PultecLiteOrb — sandbox-native homage to the Pultec EQP-1A passive
// program EQ. Recipe #19 from memory/recipe_library.md, with the
// manufacturer manual locked at docs/primary_sources/pultec/.
//
// Topology + design notes live on the PULTEC_LITE graph in mockGraphs.js.
// This component is the panel + WebAudio compile surface — same shape as
// ToyCompOrb. New peaking-filter mode (added 2026-04-28) is the load-
// bearing primitive — the "Pultec trick" needs peaking filters with
// asymmetric Q (boost Q≈0.7 wider, atten Q≈1.0 narrower) at the same
// frequency to produce the signature shelf-with-dip shape.
//
// Known v1 limitations:
//  • LF + HF freq sweeps are continuous (real unit is rotary-stepped).
//  • HF Q (BANDWIDTH on the real unit) is fixed at 1.5.
//  • Output transformer (xformerSat #139 with `tubeOT` preset) skipped —
//    tubeSim alone provides makeup-stage character. v2 adds OT.
//  • Tube is post-EQ here; real Pultec has the makeup amp inside the EQ
//    feedback loop. Static frequency response identical; dynamic
//    coupling simplified — declared deviation.

import React, { useEffect, useRef, useState } from 'react';
import { PULTEC_LITE } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph, setLiveSetParam, clearLiveSetParam } from './liveGraphStore';

const ACCENT       = '#d4b370';                   // warm tube-amber
const ACCENT_FAINT = 'rgba(212,179,112,';

export default function PultecLiteOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of PULTEC_LITE.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[PultecLite] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(PULTEC_LITE, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[PultecLite] compile failed:', e);
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
        __graph: PULTEC_LITE,
      };
      registerEngine?.(instanceId, engine);
      // Publish live setParam dispatcher so BrickZoomView's NodeDetailPanel
      // can mutate this brick's node params directly (bypassing the panel
      // knobs). Cleared on cleanup.
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

  // Live-graph mirror so BrickZoom's op-graph view shows current values.
  useEffect(() => {
    const liveNodes = PULTEC_LITE.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of PULTEC_LITE.panel.knobs) {
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
    setLiveGraph(instanceId, { ...PULTEC_LITE, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(34,26,18,0.96), rgba(20,15,10,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.25)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(245,232,210,0.9)',
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
          }}>Sandbox-native · passive program EQ</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>PultecLite</div>
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

      <PresetRow panel={PULTEC_LITE.panel} onApply={(v01Map) => setKnobs(v01Map)} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {/* Two-column layout: LF section on the left, HF on the right, drive across the bottom. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <SectionLabel text="LOW FREQUENCY" accent={ACCENT} accentFaint={ACCENT_FAINT} />
          {PULTEC_LITE.panel.knobs.filter(k => k.id.startsWith('lf')).map(k => (
            <BigKnob
              key={k.id}
              label={k.label}
              value={knobs[k.id]}
              onChange={(v) => setKnobs(prev => ({ ...prev, [k.id]: v }))}
              format={(v01) => formatKnobValue(k, v01)}
              accent={ACCENT}
            />
          ))}
        </div>
        <div>
          <SectionLabel text="HIGH FREQUENCY" accent={ACCENT} accentFaint={ACCENT_FAINT} />
          {PULTEC_LITE.panel.knobs.filter(k => k.id.startsWith('hf')).map(k => (
            <BigKnob
              key={k.id}
              label={k.label}
              value={knobs[k.id]}
              onChange={(v) => setKnobs(prev => ({ ...prev, [k.id]: v }))}
              format={(v01) => formatKnobValue(k, v01)}
              accent={ACCENT}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <SectionLabel text="MAKEUP" accent={ACCENT} accentFaint={ACCENT_FAINT} />
        {PULTEC_LITE.panel.knobs.filter(k => k.id === 'drive').map(k => (
          <BigKnob
            key={k.id}
            label={k.label}
            value={knobs[k.id]}
            onChange={(v) => setKnobs(prev => ({ ...prev, [k.id]: v }))}
            format={(v01) => formatKnobValue(k, v01)}
            accent={ACCENT}
          />
        ))}
      </div>

      <div style={{
        marginTop: 14, padding: '8px 10px', borderRadius: 6,
        background: `${ACCENT_FAINT}0.05)`,
        border: `1px dashed ${ACCENT_FAINT}0.2)`,
        fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: `${ACCENT_FAINT}0.55)`, textAlign: 'center',
      }}>
        7 knobs · peaking × 3 → shelf → 4× OS tanh
      </div>
    </div>
  );
}

function SectionLabel({ text, accent, accentFaint }) {
  return (
    <div style={{
      fontSize: 8, letterSpacing: '0.32em', textTransform: 'uppercase',
      fontWeight: 700,
      color: `${accentFaint}0.7)`,
      marginBottom: 8,
      paddingBottom: 4,
      borderBottom: `1px solid ${accentFaint}0.18)`,
    }}>{text}</div>
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

  if (knob.id === 'lfFreq' || knob.id === 'hfFreq') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(1)} kHz` : `${Math.round(mapped)} Hz`;
  }
  if (m.paramId === 'gainDb') {
    // Atten knobs map to negative dB; show absolute value with the right sign.
    return `${mapped >= 0 ? '+' : ''}${mapped.toFixed(1)} dB`;
  }
  if (knob.id === 'drive') return `×${mapped.toFixed(2)}`;
  return mapped.toFixed(2);
}

/** Invert a panel mapping: given a DSP-domain target, return 0..1. */
function unmapToNorm(mapping, target) {
  const [lo, hi] = mapping.range || [0, 1];
  // Allow negative ranges (atten knobs map 0..-12 dB).
  const sign = (hi < lo) ? -1 : 1;
  if (mapping.curve === 'log' && lo > 0 && hi > 0) {
    return Math.log(target / lo) / Math.log(hi / lo);
  }
  if (mapping.curve === 'pow') {
    const t = sign > 0 ? Math.max(lo, Math.min(hi, target)) : Math.max(hi, Math.min(lo, target));
    return Math.sqrt((t - lo) / (hi - lo));
  }
  // Linear, possibly negative range.
  return (target - lo) / (hi - lo);
}

function presetToKnobs(panel, presetValues) {
  const paramIndex = {};
  for (const k of panel.knobs) {
    for (const m of k.mappings) {
      // Index by knob id (multi-mapping knobs like lfFreq write to two
      // nodes; we use the knob id directly so presets target the knob,
      // not the underlying DSP param).
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

// Five iconic Pultec moves. Knob-domain (not DSP-domain) for clarity.
// "trick" = boost AND atten engaged at the same LF freq — the move that
// made this EQ a legend.
const PULTEC_PRESETS = [
  { id: 'flat',        label: 'Flat',
    values: { lfFreq: 60,    lfBoost: 0, lfAtten: 0,   hfFreq: 8000,  hfBoost: 0, hfAtten: 0,   drive: 1.5 } },
  { id: 'kick-trick',  label: 'Kick Trick',
    values: { lfFreq: 60,    lfBoost: 8, lfAtten: -6,  hfFreq: 10000, hfBoost: 4, hfAtten: 0,   drive: 1.8 } },
  { id: 'air',         label: 'Air',
    values: { lfFreq: 30,    lfBoost: 0, lfAtten: 0,   hfFreq: 16000, hfBoost: 6, hfAtten: 0,   drive: 1.5 } },
  { id: 'mastering',   label: 'Mastering',
    values: { lfFreq: 30,    lfBoost: 4, lfAtten: -2,  hfFreq: 12000, hfBoost: 3, hfAtten: -2,  drive: 1.6 } },
  { id: 'darken',      label: 'Darken',
    values: { lfFreq: 100,   lfBoost: 6, lfAtten: 0,   hfFreq: 5000,  hfBoost: 0, hfAtten: -8,  drive: 2.2 } },
];

function PresetRow({ panel, onApply, accent, accentFaint }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: `${accentFaint}0.55)`, alignSelf: 'center', marginRight: 4,
      }}>Presets</span>
      {PULTEC_PRESETS.map(p => (
        <button
          key={p.id}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onApply(presetToKnobs(panel, p.values)); }}
          title={`${p.label} — LF ${p.values.lfFreq}Hz +${p.values.lfBoost}/${p.values.lfAtten}dB · HF ${p.values.hfFreq}Hz +${p.values.hfBoost}/${p.values.hfAtten}dB · drive ×${p.values.drive}`}
          style={{
            fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
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
        color: 'rgba(245,232,210,0.7)',
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
