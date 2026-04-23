// ModDuckOrb — Stage B-0 dogfood of the modulation layer.
// See memory/sandbox_modulation_roadmap.md § 10.
//
// First sandbox-native brick that proves modulated op-params end-to-end.
// Audio signal rectified → smoothed → scaled → feeds gain's `gainMod`
// AudioParam (port-level control wire). Self-sidechain for now — Stage
// B-1 will split sidechain vs. main-signal paths.
//
// Panel: AMOUNT · ATTACK · RELEASE (three knobs, all mapped).
//
// Known B-0 limitations (tracked in sandbox_modulation_roadmap.md):
//  • attack/release are not truly asymmetric — a single 1-pole LP uses
//    the faster knob as its cutoff. Sounds okay for mild ducking but
//    won't satisfy a "punchy" attack vs "slow" release. Fixes with
//    Stage B-1's proper AR follower (worklet).
//  • No gainComputer (threshold/ratio/knee) — linear amount only.
//  • No external sidechain — ducks off own input.

import React, { useEffect, useRef, useState } from 'react';
import { MOD_DUCK } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';

const ACCENT = '#c4a4ff';               // muted violet — distinct from EchoLite (mint) + FilterFX (amber)
const ACCENT_FAINT = 'rgba(196,164,255,';

export default function ModDuckOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of MOD_DUCK.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
    return out;
  });

  const compiledRef = useRef(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try {
        await ensureSandboxWorklets(ctx);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ModDuck] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(MOD_DUCK, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ModDuck] compile failed:', e);
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
        __graph: MOD_DUCK,
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

  // Fan knob changes → compiler.
  useEffect(() => {
    const inst = compiledRef.current;
    if (!inst) return;
    for (const [id, v] of Object.entries(knobs)) inst.setKnob(id, v);
  }, [knobs]);

  // Publish live graph with mapped values so brick-zoom reflects reality.
  useEffect(() => {
    const liveNodes = MOD_DUCK.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of MOD_DUCK.panel.knobs) {
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
    setLiveGraph(instanceId, { ...MOD_DUCK, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(28,22,38,0.96), rgba(16,10,24,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.25)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(232,220,255,0.9)',
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
          }}>Sandbox-native · modulated param</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>ModDuck</div>
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

      {MOD_DUCK.panel.knobs.map(k => (
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
        5 knobs · 6 ops · env + lfo → gain.gainMod
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
  if (m.paramId === 'attack' || m.paramId === 'release') {
    return `${Math.round(mapped)} ms`;
  }
  if (m.paramId === 'rateHz') {
    return mapped >= 1 ? `${mapped.toFixed(2)} Hz` : `${(1 / mapped).toFixed(2)} s`;
  }
  if (knob.id === 'amount' || knob.id === 'mod') {
    // Surface as 0..100% of the knob's max magnitude.
    const [lo, hi] = m.range || [0, 1];
    const magMax   = Math.max(Math.abs(lo), Math.abs(hi));
    const pct      = magMax ? Math.round((Math.abs(mapped) / magMax) * 100) : 0;
    return `${Math.max(0, Math.min(100, pct))}%`;
  }
  return mapped.toFixed(2);
}

function BigKnob({ label, value, onChange, format, accent }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: 'rgba(232,220,255,0.7)',
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
