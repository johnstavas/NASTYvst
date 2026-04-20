// src/qc-harness/QcDrawer.jsx
//
// Bottom-of-screen drawer that runs the QC Analyzer against a LIVE engine
// from the main app (not a freshly-created engine the way the standalone
// ?qc= route does). You're looking at the exact same DSP you're hearing.
//
// Shares entry-building / param-sync logic with QcHarness via entries.js.
//
// Source buttons are intentionally omitted — audio is coming from the
// main app's sharedSource through the user's chain already.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getProduct } from '../migration/registry.js';
import { buildEntries, buildDefaults, candidateKeys } from './entries.js';
import { ControlPanel, SliderThumbStyle } from './Controls.jsx';
import { createPinkNoise, createSineSweep, createDrumLoopStub, loadFileAsSource } from './sources.js';
import Analyzer from './Analyzer.jsx';

export default function QcDrawer({ instanceId, instances, enginesRef, onClose, onPick, onSwitchVariant }) {
  // Resolve the live engine + the product metadata.
  const inst    = instances.find(i => i.id === instanceId) || null;
  const engine  = inst ? enginesRef.current.get(inst.id) : null;
  const product = inst?.productId ? getProduct(inst.productId) : null;

  // All instances that have a registered product — candidates for the picker.
  const candidates = instances.filter(i => i.productId && getProduct(i.productId));

  // Build entries from the LIVE engine so the drawer reflects the actual
  // methods/schema on whatever is running right now.
  const [entries, setEntries] = useState([]);
  const [values, setValues]   = useState({});
  const valuesRef             = useRef({});

  useEffect(() => {
    if (!engine) {
      setEntries([]); setValues({}); valuesRef.current = {};
      return;
    }
    const built = buildEntries(engine);
    // Seed values from engine.getState() if available, else from schema defaults.
    const defaults = buildDefaults(built);
    try {
      const st = engine.getState?.();
      if (st) {
        for (const e of built) {
          if (e.kind === 'noop') continue;
          const keys = e.stateKey ? [e.stateKey] : candidateKeys(e.name);
          for (const k of keys) {
            if (st[k] !== undefined) { defaults[e.name] = st[k]; break; }
          }
        }
      }
    } catch {}
    valuesRef.current = defaults;
    setEntries(built);
    setValues(defaults);
  }, [engine]);

  // Same setParam shape Analyzer expects.
  function setParam(name, v) {
    setValues(vs => {
      const next = { ...vs, [name]: v };
      valuesRef.current = next;
      return next;
    });
    try { engine?.[name]?.(v); } catch (err) { console.warn(`[QcDrawer] ${name} threw`, err); }
    const entry = entries.find(e => e.name === name);
    if (entry?.kind === 'preset' || entry?.kind === 'enum') {
      setTimeout(syncFromEngineState, 0);
      setTimeout(syncFromEngineState, 50);
      setTimeout(syncFromEngineState, 200);
    }
  }
  function syncFromEngineState() {
    try {
      const st = engine?.getState?.();
      if (!st) return;
      setValues(prev => {
        const next = { ...prev };
        for (const e of entries) {
          if (e.kind === 'noop') continue;
          const keys = e.stateKey ? [e.stateKey] : candidateKeys(e.name);
          for (const k of keys) {
            if (st[k] !== undefined) { next[e.name] = st[k]; break; }
          }
        }
        valuesRef.current = next;
        return next;
      });
    } catch {}
  }

  // AudioContext for the Analyzer: borrow it from the live engine's input
  // node. Every engine connects its input into the same shared context.
  const ctx = engine?.input?.context || null;

  // ── Test-stimulus lifecycle ──────────────────────────────────────────
  // Pink/sweep/drum are calibrated sources in sources.js, used for objective
  // measurement (frequency response, null tests, threshold audits). They
  // play INTO engine.input, mixing with whatever else the chain is sending.
  const [sourceKind, setSourceKind] = useState(null);
  const [droppedName, setDroppedName] = useState('');
  const sourceRef = useRef(null);

  function stopSource() {
    try { sourceRef.current?.stop?.(); } catch {}
    try { sourceRef.current?.disconnect?.(); } catch {}
    sourceRef.current = null;
    setSourceKind(null);
    setDroppedName('');
  }

  async function startSource(kind, fileArg) {
    console.log('[QcDrawer] startSource()', kind, { hasEngine: !!engine, hasInput: !!engine?.input, hasCtx: !!ctx, ctxState: ctx?.state });
    if (!engine?.input || !ctx) { console.warn('[QcDrawer] aborting — missing engine/ctx'); return; }
    // Browsers suspend AudioContext until a user gesture unlocks it. The
    // button click IS a gesture, but we have to explicitly resume — a bare
    // BufferSource.start() on a suspended context produces silence until
    // the context clock advances.
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (err) { console.warn('[QcDrawer] ctx.resume failed', err); }
    }
    if (ctx.state !== 'running') {
      console.error(`[QcDrawer] AudioContext is "${ctx.state}" after resume — reload the page to recover.`);
      return;
    }
    stopSource();
    let src = null;
    if      (kind === 'pink')         src = createPinkNoise(ctx);
    else if (kind === 'sweep')        src = createSineSweep(ctx);
    else if (kind === 'drum')         src = createDrumLoopStub(ctx);
    else if (kind === 'file' && fileArg) src = await loadFileAsSource(ctx, fileArg);
    if (!src) return;
    try { src.connect(engine.input); } catch (err) { console.warn('[QcDrawer] source.connect failed', err); }
    try { src.start?.(); } catch (err) { console.warn('[QcDrawer] source.start failed', err); }
    sourceRef.current = src;
    setSourceKind(kind);
    if (kind === 'file' && fileArg) setDroppedName(fileArg.name || '');
    // Diagnostic — helps if still silent: you'll see "running" in console.
    console.info('[QcDrawer] started', kind, '· ctx.state =', ctx.state, '· engine.input =', engine.input);
  }

  // Clean up on unmount / engine change
  useEffect(() => { return () => stopSource(); // eslint-disable-next-line
  }, [engine]);

  return (
    <div style={shellStyle}>
      {/* ── header ────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div style={eyebrowStyle}>QC HARNESS · LIVE ENGINE</div>

        <PluginPicker
          candidates={candidates}
          currentId={instanceId}
          onPick={onPick}
        />

        {/* Variant pill — only appears when the product has >1 variant in the
            registry. Lets you A/B legacy vs engine_v1 without leaving the
            analyzer. Wired to the same switchInstanceVariant() that the
            QcWizard step 2 popup uses. */}
        {product && Object.keys(product.variants).length > 1 && (
          <VariantPill
            product={product}
            currentVariantId={inst?.variantId || 'legacy'}
            onSwitch={onSwitchVariant}
          />
        )}

        <div style={{ flex: 1 }} />

        <div style={{
          fontFamily: '"Courier New", monospace', fontSize: 10,
          color: 'rgba(180,200,220,0.55)',
        }}>
          {engine ? (
            <>
              {entries.length} params ·{' '}
              {Array.isArray(engine.paramSchema) ? 'schema' : 'heuristic'} ·{' '}
              {typeof engine.getState === 'function' ? 'getState ✓' : 'getState ✗'}
            </>
          ) : 'no engine'}
        </div>

        <button onClick={onClose} style={closeBtn}>× CLOSE</button>
      </div>

      {/* ── body: Analyzer against live engine ────────────────────── */}
      {engine && ctx && product ? (
        <div style={bodyStyle}>
          <SourcePicker
            sourceKind={sourceKind}
            droppedName={droppedName}
            onPick={(k) => startSource(k)}
            onFile={(f) => startSource('file', f)}
            onStop={stopSource}
          />
          <Analyzer
            ctx={ctx}
            engine={engine}
            productId={product.productId}
            variantId={inst.variantId || 'legacy'}
            entries={entries}
            values={values}
            valuesRef={valuesRef}
            setParam={setParam}
            syncFromEngineState={syncFromEngineState}
            sourceKind={sourceKind}
            droppedName={droppedName}
          />
          <SliderThumbStyle />
          <div style={{ marginTop: 18 }}>
            <ControlPanel entries={entries} values={values} onChange={setParam} />
          </div>
        </div>
      ) : (
        <div style={emptyStyle}>
          {candidates.length === 0
            ? 'No migrated plugins in the chain. Add Lofi Loofy, MANchild, Flap Jack Man, or Panther Buss (engine_v1) to use the QC harness.'
            : 'Pick a plugin above to run QC against its live engine.'}
        </div>
      )}
    </div>
  );
}

// ── test-stimulus picker ─────────────────────────────────────────────────
//
// Calibrated sources (see sources.js):
//   pink   — -18 dBFS RMS  → gain staging, threshold accuracy, mix, bypass
//   sweep  — -6 dBFS peak  → frequency response, harmonics, tone
//   drum   — -10 dBFS peak → attack/release, transient, envelope behavior
//   file   — uncalibrated  → musical-content ear tests

function SourcePicker({ sourceKind, droppedName, onPick, onFile, onStop }) {
  const kinds = [
    { id: 'pink',  label: 'PINK',  tint: '#f090c0', hint: 'gain / thresholds / mix' },
    { id: 'sweep', label: 'SWEEP', tint: '#a080ff', hint: 'frequency response' },
    { id: 'drum',  label: 'DRUMS', tint: '#80d0ff', hint: 'attack / release' },
  ];
  return (
    <div style={{
      position: 'relative',
      zIndex: 10,                 // sit above whatever the Analyzer paints
      pointerEvents: 'auto',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 14px', marginBottom: 14,
      background: 'rgba(10,14,20,0.55)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 5,
      fontFamily: '"Courier New", monospace',
    }}>
      <span style={{ color: '#6a7888', fontSize: 10, letterSpacing: '0.2em',
        marginRight: 6, fontWeight: 700 }}>
        TEST SOURCE
      </span>

      {kinds.map(k => (
        <button key={k.id}
          onClick={(e) => { console.log('[SourcePicker] click', k.id); onPick(k.id); }}
          title={k.hint}
          style={{
            cursor: 'pointer',
            padding: '5px 11px',
            background: sourceKind === k.id ? `${k.tint}22` : 'rgba(20,26,34,0.9)',
            color: sourceKind === k.id ? k.tint : '#bec6d0',
            border: `1px solid ${sourceKind === k.id ? k.tint : 'rgba(255,255,255,0.18)'}`,
            borderRadius: 3,
            fontFamily: '"Courier New", monospace',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            boxShadow: sourceKind === k.id ? `0 0 8px ${k.tint}55` : 'none',
            transition: 'all 0.15s',
          }}>
          {sourceKind === k.id ? '▶ ' : ''}{k.label}
        </button>
      ))}

      <label style={{
        cursor: 'pointer',
        padding: '5px 11px',
        background: sourceKind === 'file' ? 'rgba(224,192,128,0.12)' : 'rgba(20,26,34,0.9)',
        color: sourceKind === 'file' ? '#e0c080' : '#bec6d0',
        border: `1px solid ${sourceKind === 'file' ? '#e0c080' : 'rgba(255,255,255,0.18)'}`,
        borderRadius: 3,
        fontFamily: '"Courier New", monospace',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      }}>
        {sourceKind === 'file' ? `▶ FILE · ${droppedName}` : 'FILE…'}
        <input type="file" accept="audio/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>

      {sourceKind && (
        <button onClick={onStop}
          style={{
            cursor: 'pointer',
            padding: '5px 11px',
            background: 'rgba(120,30,30,0.35)',
            color: '#ff9080',
            border: '1px solid rgba(255,144,128,0.45)',
            borderRadius: 3,
            fontFamily: '"Courier New", monospace',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            marginLeft: 4,
          }}>
          ■ STOP
        </button>
      )}

      <div style={{ flex: 1 }} />

      <span style={{ color: 'rgba(160,180,200,0.5)', fontSize: 10, fontStyle: 'italic' }}>
        {sourceKind === 'pink'  ? 'calibrated −18 dBFS RMS → measurements'
       : sourceKind === 'sweep' ? 'calibrated −6 dBFS peak → frequency response'
       : sourceKind === 'drum'  ? 'calibrated −10 dBFS peak → dynamics'
       : sourceKind === 'file'  ? 'uncalibrated — ear tests only'
       : 'pick a source to start measuring'}
      </span>
    </div>
  );
}

// ── variant pill — A/B legacy vs engine_v1 in place ──────────────────────

function VariantPill({ product, currentVariantId, onSwitch }) {
  const variants = Object.values(product.variants);
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: 4,
      overflow: 'hidden',
      fontFamily: '"Courier New", monospace',
    }}>
      {variants.map(v => {
        const isV1     = v.variantId === 'engine_v1';
        const active   = v.variantId === currentVariantId;
        const activeFg = isV1 ? '#7fff8f' : '#e0c080';
        const activeBg = isV1 ? 'rgba(30,100,40,0.35)' : 'rgba(120,80,20,0.35)';
        return (
          <button key={v.variantId}
            onClick={() => !active && onSwitch?.(v.variantId)}
            style={{
              cursor: active ? 'default' : 'pointer',
              padding: '5px 12px',
              background: active ? activeBg : 'rgba(20,26,34,0.9)',
              color: active ? activeFg : 'rgba(190,205,220,0.70)',
              border: 'none',
              fontFamily: '"Courier New", monospace',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              boxShadow: active ? `inset 0 0 0 1px ${activeFg}66` : 'none',
            }}
            title={active ? `currently running ${v.engineName}` : `switch to ${v.engineName}`}
          >
            {active ? '▶ ' : ''}{v.variantId === 'legacy' ? 'LEGACY' : 'V1'}
          </button>
        );
      })}
    </div>
  );
}

// ── plugin picker ────────────────────────────────────────────────────────

function PluginPicker({ candidates, currentId, onPick }) {
  if (candidates.length === 0) return null;
  return (
    <select
      value={currentId || ''}
      onChange={(e) => onPick?.(Number(e.target.value))}
      style={{
        padding: '5px 10px',
        background: 'rgba(20,26,34,0.95)',
        color: '#cfd6dc',
        border: '1px solid rgba(255,255,255,0.22)',
        borderRadius: 4,
        fontFamily: '"Courier New", monospace',
        fontSize: 11,
        cursor: 'pointer',
        minWidth: 240,
      }}
    >
      <option value="" style={{ background: '#0a0d12' }}>— pick a plugin —</option>
      {candidates.map(i => {
        const p = getProduct(i.productId);
        return (
          <option key={i.id} value={i.id} style={{ background: '#0a0d12' }}>
            {p?.displayLabel || i.productId} · {i.variantId || 'legacy'}
          </option>
        );
      })}
    </select>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

const shellStyle = {
  position: 'fixed',
  left: 0, right: 0, bottom: 0,
  height: '55vh',
  zIndex: 2000,
  background: 'linear-gradient(180deg, #0b0d10 0%, #0a0a0c 100%)',
  color: '#cfd6dc',
  borderTop: '2px solid rgba(127,180,255,0.35)',
  boxShadow: '0 -10px 30px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '10px 18px',
  borderBottom: '1px solid #1a1e24',
  background: 'rgba(10,12,15,0.95)',
  flexShrink: 0,
};

const eyebrowStyle = {
  fontFamily: '"Courier New", monospace',
  fontSize: 10, letterSpacing: '0.3em',
  color: '#6a7480',
};

const closeBtn = {
  cursor: 'pointer',
  padding: '5px 12px',
  background: 'rgba(255,255,255,0.04)',
  color: '#cfd6dc',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 3,
  fontFamily: '"Courier New", monospace',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
};

const bodyStyle = {
  flex: 1,
  overflow: 'auto',
  padding: '14px 22px',
};

const emptyStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'rgba(180,200,220,0.55)',
  fontSize: 13,
  fontStyle: 'italic',
  padding: 40,
  textAlign: 'center',
};
