// TapeSatOrb — sandbox-native magnetic tape saturation. Recipe #13
// (Studer / Ampex tape compression family).
//
// Three-layer character stack: pre/de-emphasis HF trick + 75 Hz head
// bump + HF gap-loss rolloff + tanh saturation in the middle. Net
// frequency response stays flat-ish at low drive while the saturator's
// distortion energy lives mostly in the highs (where the ear is more
// forgiving).
//
// Topology + design notes live on the TAPE_SAT graph in mockGraphs.js.
// This component is the panel + WebAudio compile surface, modeled on
// the PultecLite / VintageAmp orbs.

import React, { useEffect, useRef, useState } from 'react';
import { TAPE_SAT } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';

const ACCENT       = '#c8866a';                   // dusty tape-reel rust
const ACCENT_FAINT = 'rgba(200,134,106,';

export default function TapeSatOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
  bypassed, onToggleBypass,
}) {
  const ctx = sharedSource?.ctx;

  const initial = initialState?.knobs || {};
  const [knobs, setKnobs] = useState(() => {
    const out = {};
    for (const k of TAPE_SAT.panel.knobs) out[k.id] = initial[k.id] ?? k.default;
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
        console.error('[TapeSat] worklet registration failed:', e);
        return;
      }
      if (cancelled) return;

      let inst;
      try { inst = compileGraphToWebAudio(TAPE_SAT, ctx); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[TapeSat] compile failed:', e);
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
        __graph: TAPE_SAT,
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
    const liveNodes = TAPE_SAT.nodes.map(n => ({ ...n, params: { ...n.params } }));
    for (const k of TAPE_SAT.panel.knobs) {
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
    setLiveGraph(instanceId, { ...TAPE_SAT, nodes: liveNodes });
  }, [instanceId, knobs]);
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  useEffect(() => {
    onStateChange?.(instanceId, { knobs });
  }, [knobs, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 460, margin: '0 auto',
      padding: '20px 24px',
      background: 'linear-gradient(180deg, rgba(34,28,22,0.96), rgba(20,16,12,0.96))',
      borderRadius: 16,
      border: `1px solid ${ACCENT_FAINT}0.28)`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      color: 'rgba(245,228,210,0.92)',
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
          }}>Sandbox-native · magnetic tape saturation</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>TapeSat</div>
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

      {/* Two-reel "tape machine" indicator. Reels rotate in CSS based on
          DRIVE — light at idle, fast spin at hot drive. Pure visual reward. */}
      <ReelRow drive={knobs.drive ?? 0.35} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      <PresetRow panel={TAPE_SAT.panel} onApply={(v01Map) => setKnobs(v01Map)} accent={ACCENT} accentFaint={ACCENT_FAINT} />

      {TAPE_SAT.panel.knobs.map(k => (
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
        6 knobs · ToTape9 · comp · warmth · bump · HF · noise floor
      </div>
    </div>
  );
}

function ReelRow({ drive, accent, accentFaint }) {
  // CSS-animation duration scales inversely with drive — fast at hot, slow at cold.
  const dur = `${(2.5 / Math.max(0.1, drive * 1.8 + 0.3)).toFixed(2)}s`;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      marginBottom: 14, padding: '10px 18px',
      borderRadius: 8,
      background: 'rgba(0,0,0,0.4)',
      border: `1px solid ${accentFaint}0.18)`,
    }}>
      {['L', 'R'].map(side => (
        <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 8, letterSpacing: '0.3em', fontWeight: 700,
            color: `${accentFaint}0.6)`,
          }}>{side}</span>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: `radial-gradient(circle, ${accentFaint}0.35) 8%, rgba(0,0,0,0.85) 12%, rgba(0,0,0,0.85) 28%, ${accentFaint}0.45) 32%, rgba(40,28,20,0.9) 38%, rgba(20,14,10,0.9) 100%)`,
            border: `1px solid ${accentFaint}0.4)`,
            position: 'relative',
            animation: `tapeReelSpin ${dur} linear infinite`,
            boxShadow: `inset 0 0 6px rgba(0,0,0,0.6), 0 0 4px ${accentFaint}0.2)`,
          }}>
            {/* Three spokes radiating from center */}
            {[0, 60, 120].map(deg => (
              <div key={deg} style={{
                position: 'absolute', left: '50%', top: '50%',
                width: 1, height: 11,
                background: `${accentFaint}0.55)`,
                transform: `translate(-50%, -100%) rotate(${deg}deg)`,
                transformOrigin: '50% 100%',
              }} />
            ))}
          </div>
        </div>
      ))}
      <style>{`@keyframes tapeReelSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
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

  if (knob.id === 'hf') {
    return mapped >= 1000 ? `${(mapped / 1000).toFixed(1)} kHz` : `${Math.round(mapped)} Hz`;
  }
  if (knob.id === 'mix') return `${Math.round(v01 * 100)}%`;
  if (knob.id === 'hiss') return v01 < 0.02 ? 'OFF' : `${Math.round(v01 * 100)}%`;
  if (m.paramId === 'gainDb') return `${mapped >= 0 ? '+' : ''}${mapped.toFixed(1)} dB`;
  if (knob.id === 'drive') return `${Math.round(v01 * 10)}`;     // tape-machine 0..10
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

// Five tape voicings. Knob-domain values for clarity.
//   drive = saturation amount (input gain + sat drive)
//   head  = head bump dB at 75 Hz
//   hf    = HF rolloff freq Hz
//   mix   = wet/dry crossfade (1 = full wet)
//   trim  = output ±12 dB
// Voicing presets — DSP-domain values. The preset inverter walks each
// knob's mapping to recover the 0..1 knob position. `hiss` is now in
// `amount` domain on n_humSrc (mapping range [0, 4] linear).
//   knob 0%  ≈ amount 0.0  (off)
//   knob 25% ≈ amount 1.0  (light)
//   knob 50% ≈ amount 2.0  (warm)
//   knob 75% ≈ amount 3.0  (audible)
//   knob 100%≈ amount 4.0  (rented machine)
const TAPE_PRESETS = [
  { id: 'studer',    label: 'Studer A800',
    values: { drive: 3,  head: 4,  hf: 16000, mix: 1.0, hiss: 0.4, trim: 0 } },
  { id: 'two-inch',  label: '2-Inch 24',
    values: { drive: 6,  head: 6,  hf: 11000, mix: 1.0, hiss: 1.3, trim: 0 } },
  { id: 'mastering', label: 'Mastering 1/4"',
    values: { drive: 4,  head: 1,  hf: 17000, mix: 1.0, hiss: 0.3, trim: 0 } },
  { id: 'cassette',  label: 'Cassette',
    values: { drive: 7,  head: 2,  hf: 6500,  mix: 1.0, hiss: 2.4, trim: 0 } },
  { id: 'slammed',   label: 'Slammed',
    values: { drive: 11, head: 5,  hf: 8500,  mix: 1.0, hiss: 1.7, trim: -2 } },
];

function PresetRow({ panel, onApply, accent, accentFaint }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      <span style={{
        fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
        color: `${accentFaint}0.55)`, alignSelf: 'center', marginRight: 4,
      }}>Voicing</span>
      {TAPE_PRESETS.map(p => (
        <button
          key={p.id}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onApply(presetToKnobs(panel, p.values)); }}
          title={`${p.label} — drive ${p.values.drive} · head +${p.values.head}dB · hf ${p.values.hf}Hz · mix ${Math.round(p.values.mix*100)}%`}
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
        color: 'rgba(245,228,210,0.7)',
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
