// HarmonyPadOrb — instant 4-voice chord pad. Single note in → arena-rock
// vocal stack out. Four parallel Bernsee pitch shifters tuned to chord
// intervals + a Valhalla-style fdnReverb wash to soften the digital edge.
//
// Topology + design notes live on the HARMONY_PAD graph in mockGraphs.js.
// Voicing presets reset the four pitchShift `pitch` ratios via direct
// per-node param injection (different from other orbs which only modify
// panel knob values).

import React, { useEffect, useRef, useState } from 'react';
import { HARMONY_PAD } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';

const ACCENT       = '#f0a8d8';                   // soft pink-pad
const ACCENT_FAINT = 'rgba(240,168,216,';

// Voicing tables — pitch ratios for the four voices (v1=unison always).
// Ratios computed from semitones via 2^(st/12).
//   M3=4st=1.2599, m3=3st=1.1892, P5=7st=1.4983, P4=5st=1.3348,
//   M2=2st=1.1225, m7=10st=1.7818, M7=11st=1.8877, b5=6st=1.4142,
//   oct=12st=2.0, 2oct=24st=4.0, m6=8st=1.5874
const VOICINGS = [
  { id: 'major', label: 'Major',
    pitches: [1.0, 1.2599, 1.4983, 2.0],
    note: 'Root + maj 3rd + 5th + octave' },
  { id: 'minor', label: 'Minor',
    pitches: [1.0, 1.1892, 1.4983, 2.0],
    note: 'Root + min 3rd + 5th + octave' },
  { id: 'sus2',  label: 'Sus2',
    pitches: [1.0, 1.1225, 1.4983, 2.0],
    note: 'Root + 2nd + 5th + octave (open / airy)' },
  { id: 'power', label: 'Power',
    pitches: [1.0, 1.4983, 2.0, 4.0],
    note: 'Root + 5th + octave + double octave (fifth stack)' },
  { id: 'maj7',  label: 'Maj7',
    pitches: [1.0, 1.2599, 1.4983, 1.8877],
    note: 'Root + maj 3rd + 5th + maj 7th (jazz)' },
  { id: 'dim',   label: 'Dim',
    pitches: [1.0, 1.1892, 1.4142, 1.6818],
    note: 'Root + min 3rd + flat 5th + dim 7th (creepy)' },
];

const VOICE_NODE_IDS = ['n_v1', 'n_v2', 'n_v3', 'n_v4'];

export default function HarmonyPadOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of HARMONY_PAD.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
    return out;
  });
  const [voicing, setVoicing] = useState(() => initialState?.voicing ?? 'major');

  const compiledRef = useRef(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try { await ensureSandboxWorklets(ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[HarmonyPad] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(HARMONY_PAD, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[HarmonyPad] compile failed:', e);
        return;
      }
      if (cancelled) { try { inst.dispose(); } catch {} return; }

      compiledRef.current = inst;
      // Initial knob push
      for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);
      // Initial voicing push (direct per-node param mutation, NOT a knob)
      applyVoicing(inst, voicing);

      const engine = {
        input:        inst.inputNode,
        output:       inst.outputNode,
        chainOutput:  inst.outputNode,
        setBypass:    inst.setBypass,
        dispose:      inst.dispose,
        __sandboxCompiled: inst,
        __graph: HARMONY_PAD,
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

  // Knob updates
  useEffect(() => {
    const inst = compiledRef.current;
    if (!inst) return;
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);
  }, [knobs]);

  // Voicing updates — write directly to each voice node's `pitch` param.
  useEffect(() => {
    const inst = compiledRef.current;
    if (!inst) return;
    applyVoicing(inst, voicing);
  }, [voicing]);

  // Live-graph mirror (knobs + voicing → node params for graph view)
  useEffect(() => {
    const liveNodes = HARMONY_PAD.nodes.map(n => ({ ...n, params: { ...n.params } }));
    // Knob mappings
    for (const k of HARMONY_PAD.panel.knobs) {
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
    // Voicing pitches
    const v = VOICINGS.find(x => x.id === voicing);
    if (v) {
      for (let i = 0; i < 4; i++) {
        const node = liveNodes.find(n => n.id === VOICE_NODE_IDS[i]);
        if (node) node.params.pitch = +v.pitches[i].toFixed(4);
      }
    }
    setLiveGraph(instanceId, { ...HARMONY_PAD, nodes: liveNodes });
  }, [instanceId, knobs, voicing]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs, voicing });
  }, [knobs, voicing, instanceId, onStateChange]);

  const currentVoicing = VOICINGS.find(v => v.id === voicing) || VOICINGS[0];

  return (
    <div style={{
      width: '100%', maxWidth: 480, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(34,22,32,0.96), rgba(20,12,20,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.3)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(248,232,242,0.92)',
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
          }}>Sandbox-native · 4-voice harmonizer + wash</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>HarmonyPad</div>
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

      {/* Voice indicator — shows the current chord intervals as semitone offsets */}
      <VoiceRow voicing={currentVoicing} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {/* Voicing preset chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <span style={{
          fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
          color: `${ACCENT_FAINT}0.55)`, alignSelf: 'center', marginRight: 4,
        }}>Voicing</span>
        {VOICINGS.map(v => (
          <button
            key={v.id}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setVoicing(v.id); }}
            title={v.note}
            style={{
              fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
              fontWeight: 700, padding: '5px 9px',
              background: v.id === voicing ? `${ACCENT_FAINT}0.28)` : `${ACCENT_FAINT}0.08)`,
              border: `1px solid ${v.id === voicing ? `${ACCENT_FAINT}0.6)` : `${ACCENT_FAINT}0.3)`}`,
              borderRadius: 4,
              color: ACCENT,
              cursor: 'pointer',
            }}
          >{v.label}</button>
        ))}
      </div>

      {HARMONY_PAD.panel.knobs.map(k => (
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
        4× pitchShift → tone → fdnReverb wash
      </div>
    </div>
  );
}

function applyVoicing(inst, voicingId) {
  const v = VOICINGS.find(x => x.id === voicingId);
  if (!v) return;
  for (let i = 0; i < 4; i++) {
    inst.setParam(VOICE_NODE_IDS[i], 'pitch', v.pitches[i]);
  }
}

function VoiceRow({ voicing, accent, accentFaint }) {
  // Convert each ratio to semitones for display.
  const semis = voicing.pitches.map(p => Math.round(12 * Math.log2(p)));
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      marginBottom: 14, padding: '10px 16px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.4)',
      border: `1px solid ${accentFaint}0.18)`,
    }}>
      {semis.map((s, i) => (
        <div key={i} style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 16, fontWeight: 800,
            color: accent,
            fontVariantNumeric: 'tabular-nums',
            textShadow: `0 0 8px ${accentFaint}0.55)`,
          }}>{s === 0 ? '◆' : (s > 0 ? '+' : '') + s}</div>
          <div style={{
            fontSize: 7, letterSpacing: '0.2em', fontWeight: 700,
            color: `${accentFaint}0.5)`, marginTop: 2,
          }}>V{i + 1}</div>
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

  if (knob.id === 'tone') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(1)} kHz` : `${Math.round(mapped)} Hz`;
  }
  if (knob.id === 'mix' || knob.id === 'blend' || knob.id === 'wash' || knob.id === 'size') {
    return `${Math.round(v01 * 100)}%`;
  }
  return mapped.toFixed(2);
}

function BigKnob({ label, value, onChange, format, accent }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'rgba(248,232,242,0.7)',
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
