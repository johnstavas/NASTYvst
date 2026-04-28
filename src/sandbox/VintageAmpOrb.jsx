// VintageAmpOrb — sandbox-native vintage tube guitar amp homage.
// Three-tube signal path: preamp (12AX7) → tone stack → driver (12AT7)
// → power amp (EL34/6L6) → cab sim → master.
//
// Recipes #1–#4 from memory/recipe_library.md (Marshall JTM45, Vox AC30,
// Fender Twin, Fender Tweed/Bassman) all map to this one chassis with
// different presets — that's the whole point of building the topology
// generic. Each preset is a different harmonic balance / tone-stack
// position / cab voicing.
//
// Topology + design notes live on the VINTAGE_AMP graph in mockGraphs.js.
// This component is just the panel + WebAudio compile surface, modeled
// on PultecLiteOrb.

import React, { useEffect, useRef, useState } from 'react';
import { VINTAGE_AMP } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph, setLiveSetParam, clearLiveSetParam } from './liveGraphStore';

const ACCENT       = '#e89853';                   // warm tweed-orange
const ACCENT_FAINT = 'rgba(232,152,83,';

export default function VintageAmpOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of VINTAGE_AMP.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[VintageAmp] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(VINTAGE_AMP, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[VintageAmp] compile failed:', e);
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
        __graph: VINTAGE_AMP,
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

  // Live-graph mirror.
  useEffect(() => {
    const liveNodes = VINTAGE_AMP.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of VINTAGE_AMP.panel.knobs) {
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
    setLiveGraph(instanceId, { ...VINTAGE_AMP, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 480, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(38,24,14,0.96), rgba(22,14,8,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.28)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,200,140,0.06)',
      color: 'rgba(245,228,205,0.92)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div>
          <div style={{
            fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase',
            color: `${ACCENT_FAINT}0.7)`,
          }}>Sandbox-native · 3-tube guitar amp</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>VintageAmp</div>
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

      {/* Tube-glow indicator row — three little orange dots that brighten with drive/master */}
      <TubeGlowRow knobs={knobs} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      <PresetRow panel={VINTAGE_AMP.panel} onApply={(v01Map) => setKnobs(v01Map)} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {/* Knobs — DRIVE first (the personality knob), then tone, then power. */}
      {VINTAGE_AMP.panel.knobs.map(k => (
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
        12AX7 → tone → 12AT7 → EL34 → cab → glue · hum bed
      </div>
    </div>
  );
}

function TubeGlowRow({ knobs, accent, accentFaint }) {
  // Glow brightness = knob position. Tube 1 follows DRIVE, tube 2 is
  // always-on at moderate brightness (driver tube), tube 3 follows MASTER.
  const t1 = Math.max(0.15, knobs.drive ?? 0.25);
  const t2 = 0.55;
  const t3 = Math.max(0.15, knobs.master ?? 0.3);
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      marginBottom: 14, padding: '6px 12px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.35)',
      border: `1px solid ${accentFaint}0.15)`,
    }}>
      {[
        { id: 't1', label: 'V1', sub: '12AX7', glow: t1 },
        { id: 't2', label: 'V2', sub: '12AT7', glow: t2 },
        { id: 't3', label: 'V3', sub: 'EL34',  glow: t3 },
      ].map(t => (
        <div key={t.id} style={{ textAlign: 'center' }}>
          <div style={{
            width: 18, height: 26, borderRadius: '50% 50% 30% 30%',
            background: `radial-gradient(ellipse at 50% 60%, rgba(255,${Math.round(140 + 80*t.glow)},${Math.round(40 + 60*t.glow)},${0.3 + 0.55*t.glow}) 10%, rgba(60,30,10,0.4) 70%)`,
            margin: '0 auto 2px',
            boxShadow: `0 0 ${4 + 8*t.glow}px rgba(255,160,60,${0.2 + 0.4*t.glow})`,
            border: '1px solid rgba(120,70,30,0.55)',
          }} />
          <div style={{
            fontSize: 8, letterSpacing: '0.2em', fontWeight: 700,
            color: `${accentFaint}0.75)`,
          }}>{t.label}</div>
          <div style={{
            fontSize: 7, letterSpacing: '0.12em',
            color: `${accentFaint}0.45)`,
          }}>{t.sub}</div>
        </div>
      ))}
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

  if (knob.id === 'drive')   return `×${mapped.toFixed(2)}`;
  if (knob.id === 'master')  return `${Math.round(v01 * 10)}`;        // amp-style 0..10
  if (knob.id === 'hum')     return v01 < 0.02 ? 'OFF' : `${Math.round(v01 * 10)}`; // amp-style 0..10
  if (m.paramId === 'gainDb') return `${mapped >= 0 ? '+' : ''}${mapped.toFixed(1)} dB`;
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

// Four classic amp voicings. Knob-domain values for clarity.
//   drive    = preamp tube drive (1..8)
//   bass/mid/treble = tone stack ±dB (-12..+12)
//   presence = cab peak boost (0..9 dB)
//   master   = power section drive + master vol (0..1 normalized)
const VINTAGE_AMP_PRESETS = [
  { id: 'fender-clean', label: 'Fender Clean',
    values: { drive: 1.8, bass: 4,  mid: -1, treble: 3,  presence: 4, master: 0.4 } },
  { id: 'tweed-break',  label: 'Tweed Break',
    values: { drive: 4.5, bass: 2,  mid: 4,  treble: 2,  presence: 3, master: 0.55 } },
  { id: 'jtm45',        label: 'JTM45',
    values: { drive: 5.5, bass: 3,  mid: 5,  treble: 4,  presence: 5, master: 0.6 } },
  { id: 'ac30',         label: 'AC30 Chime',
    values: { drive: 4.0, bass: 1,  mid: 3,  treble: 6,  presence: 7, master: 0.55 } },
  { id: 'plexi-burn',   label: 'Plexi Burn',
    values: { drive: 7.0, bass: 4,  mid: 6,  treble: 5,  presence: 6, master: 0.7 } },
];

function PresetRow({ panel, onApply, accent, accentFaint }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: `${accentFaint}0.55)`, alignSelf: 'center', marginRight: 4,
      }}>Voicing</span>
      {VINTAGE_AMP_PRESETS.map(p => (
        <button
          key={p.id}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onApply(presetToKnobs(panel, p.values)); }}
          title={`${p.label} — drive ×${p.values.drive} · bass ${p.values.bass}/mid ${p.values.mid}/treble ${p.values.treble} · presence ${p.values.presence} · master ${p.values.master}`}
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
        color: 'rgba(245,228,205,0.7)',
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
