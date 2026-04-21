// src/qc-harness/QcHarness.jsx
//
// Naked test UI for DSP-first QC. Schema-driven — reads engine.paramSchema
// when present (authoritative), falls back to name heuristics only when the
// engine hasn't declared one.
//
// Entry: ?qc=<productId>&variant=legacy|engine_v1
//
// Kinds (authoritative when declared in paramSchema):
//   unit   — 0..1 float, displays as percent
//   gain   — linear gain multiplier, displays as N×
//   db     — decibel slider, displays as "N.N dB"
//   hz     — frequency slider, displays as "N Hz"
//   bool   — checkbox toggle
//   enum   — button group  (schema.values: [{ value, label }])
//   preset — string-keyed dropdown (schema.options: string[])
//   noop   — shown inert with an explanatory note

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { getProduct } from '../migration/registry.js';
import { createPinkNoise, createSineSweep, createDrumLoopStub, loadFileAsSource } from './sources.js';
import Analyzer from './Analyzer.jsx';
import { buildEntries, candidateKeys as _candidateKeys } from './entries.js';
import { ControlPanel } from './Controls.jsx';

// ── component ───────────────────────────────────────────────────────────────

export default function QcHarness({ productId, version }) {
  const product = getProduct(productId);
  if (!product) {
    return <Shell><h1 style={{ color: '#ff7070' }}>Unknown product: {productId}</h1></Shell>;
  }

  const initialVersion = version && product.variants[version] ? version
                        : (product.variants.v1 ? 'v1' : 'prototype');
  const [curVersion, setCurVersion] = useState(initialVersion);
  const variant = product.variants[curVersion];

  const [ctx]       = useState(() => new (window.AudioContext || window.webkitAudioContext)());
  const [engine,  setEngine]  = useState(null);
  const [entries, setEntries] = useState([]);
  const [values,  setValues]  = useState({});
  const [sourceKind, setSourceKind] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [droppedName, setDroppedName] = useState('');
  const sourceRef   = useRef(null);
  const analyserRef = useRef(null);
  const [meter, setMeter] = useState({ peak: -Infinity, rms: -Infinity });
  const [hasSchema, setHasSchema] = useState(true);

  // Engine lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let e = null;
    (async () => {
      const created = await variant.engineFactory(ctx);
      if (disposed) { try { created.dispose?.(); } catch {} ; return; }
      e = created;

      const built = buildEntries(created);
      const defaults = {};
      for (const en of built) {
        if (en.kind === 'noop')   continue;
        if (en.kind === 'preset') defaults[en.name] = '';    // no preset selected
        else if (en.kind === 'bool') defaults[en.name] = en.def ?? 0;
        else if (en.kind === 'enum') defaults[en.name] = en.def ?? 0;
        else                         defaults[en.name] = en.def ?? 0;
      }

      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      try { created.output.connect(an); } catch {}
      try { an.connect(ctx.destination); } catch {}
      analyserRef.current = an;

      setHasSchema(Array.isArray(created.paramSchema));
      setEngine(created);
      setEntries(built);
      setValues(defaults);
    })();
    return () => {
      disposed = true;
      try { analyserRef.current?.disconnect(); } catch {}
      try { e?.dispose?.(); } catch {}
    };
  }, [curVersion]);

  // Source lifecycle ────────────────────────────────────────────────────────
  function stopSource() {
    try { sourceRef.current?.stop?.(); } catch {}
    try { sourceRef.current?.disconnect?.(); } catch {}
    sourceRef.current = null;
  }
  async function startSource(kind, fileArg) {
    if (!engine) return;
    if (ctx.state === 'suspended') await ctx.resume();
    stopSource();
    let src;
    if (kind === 'pink')       src = createPinkNoise(ctx);
    else if (kind === 'sweep') src = createSineSweep(ctx, 8);
    else if (kind === 'drum')  src = createDrumLoopStub(ctx);
    else if (kind === 'file' && fileArg) src = await loadFileAsSource(ctx, fileArg);
    else return;
    try { src.connect(engine.input); } catch {}
    if (src.start) src.start();
    sourceRef.current = src;
    setSourceKind(kind);
  }

  // Meter RAF (30 Hz) ───────────────────────────────────────────────────────
  useEffect(() => {
    let raf, last = 0;
    const buf = new Float32Array(2048);
    const tick = (now) => {
      if (now - last > 33) {
        last = now;
        const an = analyserRef.current;
        if (an) {
          an.getFloatTimeDomainData(buf);
          let peak = 0, sumSq = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i]);
            if (v > peak) peak = v;
            sumSq += buf[i] * buf[i];
          }
          const rms = Math.sqrt(sumSq / buf.length);
          setMeter({
            peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
            rms:  rms  > 0 ? 20 * Math.log10(rms)  : -Infinity,
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Sync harness slider values back from engine.getState() after any
  // setter that can mutate more than its own knob (presets, LINK mode,
  // etc.). Matches by schema.stateKey if declared, else heuristic
  // (setFoo → state.foo, lowercase first letter).
  // Try several conventions to map a setFoo method → state key.
  // Most engines use `foo` (lowercase first letter), some use the full
  // `setFoo` name, some use snake_case.
  const candidateKeys = _candidateKeys;

  // Mirror of `values` that updates synchronously so the sweep loop can
  // read the CURRENT values right after setParam. React's setState is
  // async; without this ref, snapshots capture stale values.
  const valuesRef = useRef({});
  useEffect(() => { valuesRef.current = values; }, [values]);

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
        valuesRef.current = next; // keep ref in lock-step
        return next;
      });
    } catch {}
  }
  function setParam(name, v) {
    setValues(vs => {
      const next = { ...vs, [name]: v };
      valuesRef.current = next;
      return next;
    });
    try { engine?.[name]?.(v); } catch (err) { console.warn(`${name} threw`, err); }
    // If the caller touched a preset-kind setter, the engine probably
    // mutated lots of internal state — pull everything back.
    const entry = entries.find(e => e.name === name);
    if (entry?.kind === 'preset' || entry?.kind === 'enum') {
      // Poll for a short window — the engine may apply internal
      // setters over multiple microtasks (setTimeout, rAF, etc.).
      setTimeout(syncFromEngineState, 0);
      setTimeout(syncFromEngineState, 50);
      setTimeout(syncFromEngineState, 200);
    }
  }

  const undeclared = entries.filter(e => e._inSchema === false && hasSchema);

  // Page-wide drag & drop — drop any audio file onto the harness to play it
  // through the current engine. Same codepath as the "file…" button.
  const onDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    setDropActive(true);
  };
  const onDragLeave = (e) => {
    // Only clear when the pointer actually leaves the window
    if (e.relatedTarget === null) setDropActive(false);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDropActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    setDroppedName(f.name);
    await startSource('file', f);
  };

  return (
    <Shell onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
           overlay={dropActive}>
      <Header>
        <div>
          <div style={ST.eyebrow}>QC HARNESS {hasSchema ? '· schema' : '· heuristic'}</div>
          <div style={ST.title}>{product.displayLabel}</div>
          <div style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace', marginTop: 2 }}>
            v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'} ·
            {' '}{typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev'} ·
            {' '}{typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__.slice(5, 16).replace('T', ' ') : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.keys(product.variants).map(k => (
            <Btn key={k} on={k === curVersion} onClick={() => setCurVersion(k)}>{k}</Btn>
          ))}
        </div>
      </Header>

      {!hasSchema && (
        <Warn>
          This engine has no <code>paramSchema</code> export. Controls below are
          <b> inferred from method names </b>and may be wrong. Add a schema to the
          engine's returned object — see <code>manChildEngine.js</code> for reference.
        </Warn>
      )}
      {undeclared.length > 0 && (
        <Warn>
          <b>{undeclared.length} undeclared method(s):</b> {undeclared.map(u => u.name).join(', ')} —
          add these to the engine's <code>paramSchema</code>.
        </Warn>
      )}
      {engine && typeof engine.getState !== 'function' && (
        <Warn>
          This engine has no <code>getState()</code>. Presets will fire the DSP
          but the harness sliders won't reflect the new values. Fix by adding
          <code> getState()</code> to the engine's returned object.
        </Warn>
      )}

      {engine && (
        <Analyzer
          ctx={ctx} engine={engine}
          productId={productId} version={curVersion}
          entries={entries} values={values} valuesRef={valuesRef} setParam={setParam}
          syncFromEngineState={syncFromEngineState}
          sourceKind={sourceKind} droppedName={droppedName}
        />
      )}

      <Section title={`SOURCE`}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {['pink', 'sweep', 'drum'].map(k => (
            <Btn key={k} on={sourceKind === k} onClick={() => startSource(k)}>{k}</Btn>
          ))}
          <label style={{ ...ST.btn, ...(sourceKind === 'file' ? ST.btnOn : {}) }}>
            file…
            <input type="file" accept="audio/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) startSource('file', f); }} />
          </label>
          <Btn onClick={() => { stopSource(); setSourceKind(null); }}>stop</Btn>
          {droppedName && <span style={{ fontSize: 11, color: '#8aa', fontFamily: 'monospace' }}>↳ {droppedName}</span>}
          <div style={{ flex: 1 }} />
          <Meter label="peak" db={meter.peak} />
          <Meter label="rms"  db={meter.rms}  />
        </div>
      </Section>

      <ControlPanel
        entries={entries}
        values={values}
        onChange={setParam}
      />


      <div style={{ color: '#666', fontSize: 11, marginTop: 20, fontFamily: 'Courier New, monospace' }}>
        {entries.length} controls · {hasSchema ? 'schema-driven' : 'heuristic'}
      </div>
    </Shell>
  );
}

// ── chrome ─────────────────────────────────────────────────────────────────
// (Control router lives in Controls.jsx — shared with QcDrawer.)

function Row({ name, readout, readoutColor, children }) {
  return (
    <div style={ST.row}>
      <div style={ST.rowLabel}>{name}</div>
      <div style={ST.rowCtl}>{children}</div>
      <div style={{ ...ST.rowReadout, color: readoutColor || '#d0d8e0' }}>{readout}</div>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div style={ST.section}>
      <div style={ST.sectionTitle}>{title}</div>
      <div style={{ padding: '4px 0' }}>{children}</div>
    </div>
  );
}
function Header({ children }) { return <div style={ST.header}>{children}</div>; }
function Warn({ children }) {
  return (
    <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 5,
                  background: '#2a1f08', border: '1px solid #8a6a20', color: '#ffd080',
                  fontSize: 12, lineHeight: 1.5 }}>{children}</div>
  );
}
function Btn({ children, on, onClick, small }) {
  return (
    <button onClick={onClick}
      style={{ ...ST.btn, ...(on ? ST.btnOn : {}), ...(small ? ST.btnSmall : {}) }}>
      {children}
    </button>
  );
}
function Meter({ label, db }) {
  const disp = isFinite(db) ? db.toFixed(1) : '−∞';
  return (
    <div style={{ fontFamily: 'Courier New, monospace', fontSize: 11, color: '#888' }}>
      <span style={{ color: '#555' }}>{label}</span>{' '}
      <span style={{ color: '#aaa', minWidth: 48, display: 'inline-block', textAlign: 'right' }}>{disp} dB</span>
    </div>
  );
}

function Shell({ children, onDragOver, onDragLeave, onDrop, overlay }) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0b0d10 0%, #0a0a0c 100%)',
        color: '#cfd6dc', padding: '24px 32px',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        maxWidth: 1100, margin: '0 auto',
        position: 'relative',
        outline: overlay ? '2px dashed #7ab8ff' : 'none',
        outlineOffset: -8,
      }}>
      {overlay && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 9999,
          color: '#cfe3ff', fontSize: 22, fontWeight: 600, letterSpacing: 2,
        }}>DROP AUDIO FILE</div>
      )}
      <style>{`
        input[type="range"].qc {
          -webkit-appearance: none; appearance: none;
          height: 4px; background: #1a2028; border-radius: 2px;
          outline: none; cursor: pointer; width: 100%;
        }
        input[type="range"].qc::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: #8aa8c8; border: 1px solid #2a3a50;
          box-shadow: 0 1px 2px rgba(0,0,0,0.6);
        }
        input[type="range"].qc::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: #8aa8c8; border: 1px solid #2a3a50;
        }
      `}</style>
      {children}
    </div>
  );
}

const ST = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            marginBottom: 24, paddingBottom: 14, borderBottom: '1px solid #1a1e24' },
  eyebrow: { fontFamily: 'Courier New, monospace', fontSize: 10, letterSpacing: '0.3em',
             color: '#5a6470', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: 600, color: '#e6eef5', letterSpacing: '0.02em' },

  section: { marginBottom: 18, padding: '14px 16px',
             background: '#0e1116', border: '1px solid #1a1e24', borderRadius: 6 },
  sectionTitle: { fontFamily: 'Courier New, monospace', fontSize: 10, letterSpacing: '0.25em',
                  color: '#6a7480', marginBottom: 10 },

  row: { display: 'grid', gridTemplateColumns: '200px 1fr 130px',
         gap: 14, alignItems: 'center', padding: '5px 0' },
  rowLabel: { fontFamily: 'Courier New, monospace', fontSize: 12, color: '#a8b0b8',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowCtl: { display: 'flex', alignItems: 'center' },
  rowReadout: { fontFamily: 'Courier New, monospace', fontSize: 12, textAlign: 'right',
                whiteSpace: 'nowrap' },

  btn: { cursor: 'pointer', padding: '5px 10px',
         border: '1px solid #2a333d', background: '#141a22', color: '#bec6d0',
         fontFamily: 'Courier New, monospace', fontSize: 11,
         borderRadius: 3, letterSpacing: '0.05em' },
  btnOn: { background: '#1a3050', borderColor: '#5a85b5', color: '#e0f0ff' },
  btnSmall: { padding: '3px 7px', fontSize: 10 },

  range: { width: '100%', WebkitAppearance: 'none', appearance: 'none',
           height: 4, background: '#1a2028', borderRadius: 2, cursor: 'pointer' },
  tog: { display: 'inline-flex', alignItems: 'center',
         fontFamily: 'Courier New, monospace', fontSize: 11,
         cursor: 'pointer', userSelect: 'none' },
  select: { padding: '4px 8px', background: '#141a22', color: '#e0e6ec',
            border: '1px solid #2a333d', borderRadius: 3,
            fontFamily: 'Courier New, monospace', fontSize: 11, minWidth: 220 },
};
