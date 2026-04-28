// ShimmerDelayOrb — wild pitch-shift delay. Bernsee phase-vocoder
// pitch shifter inside a feedback delay loop.
//
// Topology + design notes live on the SHIMMER_DLY graph in mockGraphs.js.
// This component is the panel + WebAudio compile surface, modeled on
// the EchoformLiteOrb / TapeSatOrb / VintageAmpOrb pattern.

import React, { useEffect, useRef, useState } from 'react';
import { SHIMMER_DLY } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';

const ACCENT       = '#a48bff';                   // ethereal violet
const ACCENT_FAINT = 'rgba(164,139,255,';

export default function ShimmerDelayOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of SHIMMER_DLY.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[ShimmerDly] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(SHIMMER_DLY, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ShimmerDly] compile failed:', e);
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
        __graph: SHIMMER_DLY,
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
    const liveNodes = SHIMMER_DLY.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of SHIMMER_DLY.panel.knobs) {
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
    setLiveGraph(instanceId, { ...SHIMMER_DLY, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(28,22,42,0.96), rgba(16,12,28,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.3)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(180,160,255,0.06)',
      color: 'rgba(232,222,255,0.92)',
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
          }}>Sandbox-native · pitch-shift delay</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>ShimmerDly</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {onToggleBypass && (
            <button onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onToggleBypass(); }}
                    title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass (A/B)'}
                    style={{
                      fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
                      fontWeight: 700, padding: '5px 10px',
                      background: bypassed ? 'rgba(255,255,255,0.12)' : `${ACCENT_FAINT}0.22)`,
                      border: `1px solid ${bypassed ? 'rgba(255,255,255,0.25)' : `${ACCENT_FAINT}0.5)`}`,
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

      {/* Pitch indicator: shows current semitone offset, glows brighter
          the further from unison you are. Pure visual reward. */}
      <PitchIndicator pitch01={knobs.pitch ?? 0.625} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      <PresetRow panel={SHIMMER_DLY.panel} onApply={(v01Map) => setKnobs(v01Map)} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {SHIMMER_DLY.panel.knobs.map(k => (
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
        delay → LP → shifter → HP → fb loop
      </div>
    </div>
  );
}

function PitchIndicator({ pitch01, accent, accentFaint }) {
  // Convert knob 0..1 with log curve [0.5..4.0] back to ratio, then to semitones.
  const ratio = 0.5 * Math.pow(4.0 / 0.5, pitch01);
  const semis = 12 * Math.log2(ratio);
  const glow = Math.min(1, Math.abs(semis) / 18); // brighter the further from unison

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 12, padding: '10px 16px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.4)',
      border: `1px solid ${accentFaint}0.18)`,
    }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.3em', fontWeight: 700,
        color: `${accentFaint}0.55)`,
      }}>SHIFT</span>
      <span style={{
        fontSize: 22, fontWeight: 800,
        color: accent,
        textShadow: `0 0 ${4 + 16 * glow}px rgba(180,160,255,${0.25 + 0.55 * glow})`,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
      }}>
        {semis >= 0 ? '+' : ''}{semis.toFixed(2)} st
      </span>
      <span style={{
        fontSize: 8, letterSpacing: '0.2em', fontWeight: 700,
        color: `${accentFaint}0.4)`,
      }}>×{ratio.toFixed(2)}</span>
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
  if (knob.id === 'pitch') {
    const semis = 12 * Math.log2(mapped);
    return `${semis >= 0 ? '+' : ''}${semis.toFixed(1)} st`;
  }
  if (knob.id === 'tone' || knob.id === 'hp') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(1)} kHz` : `${Math.round(mapped)} Hz`;
  }
  if (knob.id === 'feedback' || knob.id === 'mix') return `${Math.round(v01 * 100)}%`;
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

// Five wild voicings. DSP-domain values.
//   time     = ms
//   feedback = 0..0.85
//   pitch    = ratio (1 = unison, 2 = +oct, 0.5 = -oct)
//   tone     = LP cutoff Hz
//   mix      = 0..1
const SHIMMER_PRESETS = [
  // Shimmer presets HP at 120 Hz to keep the rising-octave tail clean
  // (the +12 shifter can introduce some sub-rumble as bins stretch).
  { id: 'shimmer',   label: 'Shimmer',
    values: { time: 600, feedback: 0.65, pitch: 2.0,    tone: 5500, hp: 120, mix: 0.45 } },
  // Sub Dive WANTS the sub buildup, so HP is barely engaged.
  { id: 'sub-dive',  label: 'Sub Dive',
    values: { time: 750, feedback: 0.55, pitch: 0.5,    tone: 2200, hp: 30,  mix: 0.40 } },
  // Fifth stack — moderate HP keeps the harmony cleaner as it ascends.
  { id: 'fifth',     label: 'Fifth Stack',
    values: { time: 380, feedback: 0.55, pitch: 1.4983, tone: 6500, hp: 100, mix: 0.40 } },
  // Detune is subtle — minimal HP.
  { id: 'detune',    label: 'Detune',
    values: { time: 220, feedback: 0.45, pitch: 1.029,  tone: 8000, hp: 60,  mix: 0.35 } },
  // Inception leans into the dive, but HP at 80 keeps it from total mud.
  { id: 'inception', label: 'Inception',
    values: { time: 900, feedback: 0.75, pitch: 0.7937, tone: 3200, hp: 80,  mix: 0.50 } },
];

function PresetRow({ panel, onApply, accent, accentFaint }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: `${accentFaint}0.55)`, alignSelf: 'center', marginRight: 4,
      }}>Voicing</span>
      {SHIMMER_PRESETS.map(p => {
        const semis = 12 * Math.log2(p.values.pitch);
        return (
          <button
            key={p.id}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onApply(presetToKnobs(panel, p.values)); }}
            title={`${p.label} — ${p.values.time}ms · fb ${Math.round(p.values.feedback*100)}% · pitch ${semis>=0?'+':''}${semis.toFixed(1)}st · tone ${p.values.tone}Hz · mix ${Math.round(p.values.mix*100)}%`}
            style={{
              fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
              fontWeight: 700, padding: '5px 9px',
              background: `${accentFaint}0.1)`,
              border: `1px solid ${accentFaint}0.32)`,
              borderRadius: 4,
              color: accent,
              cursor: 'pointer',
            }}
          >{p.label}</button>
        );
      })}
    </div>
  );
}

function BigKnob({ label, value, onChange, format, accent }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'rgba(232,222,255,0.7)',
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
