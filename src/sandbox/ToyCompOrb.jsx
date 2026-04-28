// ToyCompOrb — second sandbox-native dogfood. See sandbox_core_scope.md
// Stage B + sandbox_modulation_roadmap.md § 10.
//
// Purpose: prove the gainComputer op end-to-end through a minimal comp
// graph (detector → envelope → gainComputer → VCA gain → makeup gain).
// Matches the structure of any real downward compressor, just without
// the accumulated feature creep (lookahead, AB sidechain, auto-release,
// TC state machines, multiband). Those all land as more ops on the
// same substrate.
//
// If a recorded before/after of ToyComp vs. a hand-coded comp (same
// threshold/ratio/knee/attack/release) nulls to silence, the sandbox
// compiler passes its first dynamics-family conformance test.
//
// Known v0 limitations:
//  • Self-sidechain only (no external SC port on the brick).
//  • No lookahead — attack <1 ms can pass transients through unclipped.
//  • No auto-release, no knee override, no stereo-link (mono-per-channel
//    via WebAudio's default channel handling).

import React, { useEffect, useRef, useState } from 'react';
import { TOY_COMP } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph, setLiveSetParam, clearLiveSetParam } from './liveGraphStore';
import { runToyCompSanityTest, runToyCompMasterNullTest, runGainOnlyMasterNullTest } from './nullTestHarness';

const ACCENT       = '#7ae1c1';               // muted teal — distinct from ModDuck violet
const ACCENT_FAINT = 'rgba(122,225,193,';

export default function ToyCompOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of TOY_COMP.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[ToyComp] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(TOY_COMP, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ToyComp] compile failed:', e);
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
        __graph: TOY_COMP,
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
    const liveNodes = TOY_COMP.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of TOY_COMP.panel.knobs) {
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
    setLiveGraph(instanceId, { ...TOY_COMP, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(20,32,28,0.96), rgba(10,20,18,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.25)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(220,245,235,0.9)',
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
          }}>Sandbox-native · gain computer</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>ToyComp</div>
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
        <button onMouseDown={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // eslint-disable-next-line no-console
                  console.log('[ToyComp] running compiler sanity test…');
                  try {
                    const r = await runToyCompSanityTest();
                    // eslint-disable-next-line no-console
                    console.log('[ToyComp] sanity test result:', r);
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[ToyComp] sanity test error:', err);
                  }
                }}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                title="Run compiler null-test — compare compiled TOY_COMP vs hand-wired reference; result in console"
                style={{
                  fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
                  fontWeight: 700, padding: '5px 10px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 4,
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                }}>NULL</button>
        <button onMouseDown={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // eslint-disable-next-line no-console
                  console.log('[ToyComp] running MASTER-worklet null-test (Stage 3-a exit gate)…');
                  try {
                    const r = await runToyCompMasterNullTest();
                    // eslint-disable-next-line no-console
                    console.log(
                      `[ToyComp] MASTER null-test: ${r.verdict}  ` +
                      `maxErr=${r.maxErrorDb.toFixed(1)} dB  rms=${r.rmsErrorDb.toFixed(1)} dB  ` +
                      `offset=${r.offsetSamples} samples`,
                    );
                    console.log(`[ToyComp]   chain:  peak=${r.chain.peakDb.toFixed(1)} dB  rms=${r.chain.rmsDb.toFixed(1)} dB`);
                    console.log(`[ToyComp]   master: peak=${r.master.peakDb.toFixed(1)} dB  rms=${r.master.rmsDb.toFixed(1)} dB`);
                    console.log(`[ToyComp]   chain  first16: [${r.chainFirst16.map(v => v.toFixed(4)).join(', ')}]`);
                    console.log(`[ToyComp]   master first16: [${r.masterFirst16.map(v => v.toFixed(4)).join(', ')}]`);
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[ToyComp] MASTER null-test error:', err);
                  }
                }}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                title="Stage-3a exit gate — compare chain-of-worklets TOY_COMP vs emitted master-worklet; result in console"
                style={{
                  fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
                  fontWeight: 700, padding: '5px 10px',
                  marginLeft: 6,
                  background: 'rgba(122,225,193,0.10)',
                  border: '1px solid rgba(122,225,193,0.35)',
                  borderRadius: 4,
                  color: ACCENT,
                  cursor: 'pointer',
                }}>MASTER</button>
        <button onMouseDown={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // eslint-disable-next-line no-console
                  console.log('[ToyComp] running PURE (gain-only static) null-test…');
                  try {
                    const r = await runGainOnlyMasterNullTest();
                    // eslint-disable-next-line no-console
                    console.log(
                      `[ToyComp] PURE null-test: ${r.verdict}  ` +
                      `maxErr=${r.maxErrorDb.toFixed(1)} dB  rms=${r.rmsErrorDb.toFixed(1)} dB  ` +
                      `offset=${r.offsetSamples} samples  (threshold: -120 dB)`,
                    );
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[ToyComp] PURE null-test error:', err);
                  }
                }}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                title="Gain-only static graph — proves master-worklet is mechanically bit-identical to chain (no dynamics, no sidechain latency). Expect < -120 dB."
                style={{
                  fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
                  fontWeight: 700, padding: '5px 10px',
                  marginLeft: 6,
                  background: 'rgba(180,140,255,0.10)',
                  border: '1px solid rgba(180,140,255,0.35)',
                  borderRadius: 4,
                  color: 'rgb(200,170,255)',
                  cursor: 'pointer',
                }}>PURE</button>
        </div>
      </div>

      <PresetRow panel={TOY_COMP.panel} onApply={(v01Map) => setKnobs(v01Map)} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {TOY_COMP.panel.knobs.map(k => (
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
        5 knobs · detector → env → gainComputer → vca
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
  if (m.paramId === 'thresholdDb' || m.paramId === 'gainDb') {
    return `${mapped >= 0 ? '+' : ''}${mapped.toFixed(1)} dB`;
  }
  if (m.paramId === 'ratio')   return `${mapped.toFixed(1)}:1`;
  if (m.paramId === 'attack' || m.paramId === 'release') {
    return `${mapped < 10 ? mapped.toFixed(1) : Math.round(mapped)} ms`;
  }
  return mapped.toFixed(2);
}

// Preset chip row. Each preset is expressed in DSP-domain values (dB, ms,
// ratio) — we invert each knob's mapping to recover the normalized 0..1
// slider position. Keeps presets readable while surviving future range
// tweaks: change the panel mapping, presets still point at the same
// sonic settings.
//
// Five classic starting points. Not production-precise — they're meant
// to sound like the thing their name implies within 2–3 knob tweaks.
const TOY_COMP_PRESETS = [
  { id: 'vocal',    label: 'Vocal',    values: { thresholdDb: -18, ratio: 3,  attack: 10, release: 150, gainDb: 4 } },
  { id: 'drum-bus', label: 'Drum Bus', values: { thresholdDb: -14, ratio: 4,  attack: 30, release: 100, gainDb: 3 } },
  { id: 'glue',     label: 'Glue',     values: { thresholdDb: -20, ratio: 2,  attack: 30, release: 250, gainDb: 3 } },
  { id: 'pump',     label: 'Pump',     values: { thresholdDb: -24, ratio: 8,  attack:  1, release:  80, gainDb: 6 } },
  { id: 'limit',    label: 'Limit',    values: { thresholdDb: -10, ratio: 20, attack:  1, release:  50, gainDb: 3 } },
];

/** Invert a panel mapping: given a DSP-domain target, return 0..1. */
function unmapToNorm(mapping, target) {
  const [lo, hi] = mapping.range || [0, 1];
  const t = Math.max(Math.min(target, Math.max(lo, hi)), Math.min(lo, hi));
  if (mapping.curve === 'log' && lo > 0 && hi > 0) {
    return Math.log(t / lo) / Math.log(hi / lo);
  }
  if (mapping.curve === 'pow') {
    return Math.sqrt((t - lo) / (hi - lo));
  }
  return (t - lo) / (hi - lo);
}

/** Map preset DSP values → normalized knob values by walking panel mappings. */
function presetToKnobs(panel, presetValues) {
  // Reverse index: paramId on each mapping → (knobId, mapping).
  const paramIndex = {};
  for (const k of panel.knobs) {
    for (const m of k.mappings) paramIndex[m.paramId] = { knobId: k.id, mapping: m };
  }
  const out = {};
  for (const [paramId, target] of Object.entries(presetValues)) {
    const hit = paramIndex[paramId];
    if (!hit) continue;
    out[hit.knobId] = Math.max(0, Math.min(1, unmapToNorm(hit.mapping, target)));
  }
  return out;
}

function PresetRow({ panel, onApply, accent, accentFaint }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: `${accentFaint}0.55)`, alignSelf: 'center', marginRight: 4,
      }}>Presets</span>
      {TOY_COMP_PRESETS.map(p => (
        <button
          key={p.id}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onApply(presetToKnobs(panel, p.values)); }}
          title={`${p.label} — ${p.values.thresholdDb} dB · ${p.values.ratio}:1 · atk ${p.values.attack}ms · rel ${p.values.release}ms · +${p.values.gainDb} dB`}
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
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: 'rgba(220,245,235,0.7)',
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
