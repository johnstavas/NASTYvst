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

// ── fallback inference (only if engine has NO paramSchema) ─────────────────

function inferKind(name) {
  const n = name;
  if (/^setBypass$/.test(n))        return { kind: 'bool', def: 0 };
  if (/^setFB$/.test(n))            return { kind: 'bool', def: 0 };
  if (/^setSc[AB]$/.test(n))        return { kind: 'bool', def: 1 };
  if (/^setComp$/.test(n))          return { kind: 'bool', def: 0 };
  const low = n.toLowerCase();
  if (low.includes('threshold'))    return { kind: 'db',   min: -60, max: 0,  step: 0.5, def: -18 };
  if (/^set(In|Out)$/.test(n))      return { kind: 'db',   min: -24, max: 24, step: 0.1, def: 0 };
  if (low.includes('freq') || low.endsWith('hz'))
                                    return { kind: 'hz',   min: 20,  max: 20000, step: 1, def: 1000 };
  return { kind: 'unit', min: 0, max: 1, step: 0.01, def: 0.5 };
}

function buildEntries(engine) {
  const setKeys = Object.keys(engine).filter(k => /^set[A-Z]/.test(k) && typeof engine[k] === 'function').sort();
  const schema = Array.isArray(engine.paramSchema) ? engine.paramSchema : null;

  if (schema) {
    const byName = new Map(schema.map(s => [s.name, s]));
    const out = schema.map(s => ({ ...s, _inSchema: true }));
    // Flag any setX method that exists on the engine but is missing from
    // the schema — so you SEE it and can add it to the schema.
    for (const k of setKeys) {
      if (!byName.has(k)) out.push({ name: k, label: k + ' (UNDECLARED)', ...inferKind(k), _inSchema: false });
    }
    return out;
  }
  // No schema: pure heuristics on every setX method.
  return setKeys.map(k => ({ name: k, label: k, ...inferKind(k), _inSchema: false }));
}

function groupEntries(entries) {
  // Respect explicit `group` property (e.g. 'A' / 'B'). Otherwise auto-pair
  // setXxxA / setXxxB into A/B pair sections. Everything else is common.
  const pairs = new Map();
  const common = [];
  const aByBase = new Map();
  const bByBase = new Map();

  for (const e of entries) {
    const m = e.name.match(/^(.+)([AB])$/);
    if (e.group === 'A' || (m && m[2] === 'A')) aByBase.set(m ? m[1] : e.name, e);
    else if (e.group === 'B' || (m && m[2] === 'B')) bByBase.set(m ? m[1] : e.name, e);
    else common.push(e);
  }

  const truePairs = [];
  const extraCommon = [...common];
  const seenBases = new Set();
  for (const [base, a] of aByBase) {
    const b = bByBase.get(base);
    if (b) { truePairs.push({ base, A: a, B: b }); seenBases.add(base); }
    else   { extraCommon.push(a); }
  }
  for (const [base, b] of bByBase) {
    if (!seenBases.has(base)) extraCommon.push(b);
  }
  return { common: extraCommon, pairs: truePairs };
}

// ── component ───────────────────────────────────────────────────────────────

export default function QcHarness({ productId, variantId }) {
  const product = getProduct(productId);
  if (!product) {
    return <Shell><h1 style={{ color: '#ff7070' }}>Unknown product: {productId}</h1></Shell>;
  }

  const initialVariant = variantId && product.variants[variantId] ? variantId
                        : (product.variants.engine_v1 ? 'engine_v1' : 'legacy');
  const [curVariant, setCurVariant] = useState(initialVariant);
  const variant = product.variants[curVariant];

  const [ctx]       = useState(() => new (window.AudioContext || window.webkitAudioContext)());
  const [engine,  setEngine]  = useState(null);
  const [entries, setEntries] = useState([]);
  const [values,  setValues]  = useState({});
  const [sourceKind, setSourceKind] = useState(null);
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
  }, [curVariant]);

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

  function setParam(name, v) {
    setValues(vs => ({ ...vs, [name]: v }));
    try { engine?.[name]?.(v); } catch (err) { console.warn(`${name} threw`, err); }
  }

  const { common, pairs } = useMemo(() => groupEntries(entries), [entries]);
  const undeclared = entries.filter(e => e._inSchema === false && hasSchema);

  return (
    <Shell>
      <Header>
        <div>
          <div style={ST.eyebrow}>QC HARNESS {hasSchema ? '· schema' : '· heuristic'}</div>
          <div style={ST.title}>{product.displayLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.keys(product.variants).map(k => (
            <Btn key={k} on={k === curVariant} onClick={() => setCurVariant(k)}>{k}</Btn>
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
          <div style={{ flex: 1 }} />
          <Meter label="peak" db={meter.peak} />
          <Meter label="rms"  db={meter.rms}  />
        </div>
      </Section>

      {common.length > 0 && (
        <Section title="COMMON">
          {common.map(e => (
            <Control key={e.name} entry={e} value={values[e.name]}
              onChange={v => setParam(e.name, v)} />
          ))}
        </Section>
      )}

      {pairs.map(({ base, A, B }) => (
        <Section key={base} title={`${base.replace(/^set/, '').toUpperCase()} · A / B`}>
          <Control entry={A} value={values[A.name]} onChange={v => setParam(A.name, v)} />
          <Control entry={B} value={values[B.name]} onChange={v => setParam(B.name, v)} />
        </Section>
      ))}

      <div style={{ color: '#666', fontSize: 11, marginTop: 20, fontFamily: 'Courier New, monospace' }}>
        {entries.length} controls · {hasSchema ? 'schema-driven' : 'heuristic'}
      </div>
    </Shell>
  );
}

// ── control router ─────────────────────────────────────────────────────────

function Control({ entry, value, onChange }) {
  if (entry.kind === 'noop') {
    return (
      <Row name={entry.label || entry.name} readout="no-op" readoutColor="#666">
        <div style={{ color: '#666', fontSize: 11, fontFamily: 'Courier New, monospace' }}>
          {entry.note || 'intentionally non-functional'}
        </div>
      </Row>
    );
  }
  if (entry.kind === 'bool') {
    const on = !!value;
    return (
      <Row name={entry.label || entry.name} readout={on ? 'ON' : 'OFF'} readoutColor={on ? '#7fff8f' : '#666'}>
        <label style={ST.tog}>
          <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked ? 1 : 0)}
            style={{ marginRight: 6 }} />
          <span style={{ color: on ? '#7fff8f' : '#888' }}>{on ? 'ON' : 'OFF'}</span>
        </label>
      </Row>
    );
  }
  if (entry.kind === 'enum') {
    const vals = entry.values || [];
    const cur  = vals.find(v => v.value === value);
    return (
      <Row name={entry.label || entry.name} readout={cur?.label ?? String(value)} readoutColor="#80d0ff">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {vals.map(v => (
            <Btn key={v.value} on={v.value === value} onClick={() => onChange(v.value)} small>
              {v.label}
            </Btn>
          ))}
        </div>
      </Row>
    );
  }
  if (entry.kind === 'preset') {
    const opts = entry.options || [];
    return (
      <Row name={entry.label || entry.name} readout={value || '(none)'} readoutColor="#e0c080">
        <select value={value || ''} onChange={e => onChange(e.target.value)} style={ST.select}>
          <option value="">— select preset —</option>
          {opts.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </Row>
    );
  }
  // numeric: unit | db | hz | gain | float
  const { min, max, step, kind } = entry;
  const display =
    kind === 'db'   ? `${(+value).toFixed(1)} dB`
  : kind === 'hz'   ? `${Math.round(+value)} Hz`
  : kind === 'gain' ? `${(+value).toFixed(2)}×`
  : kind === 'unit' ? `${Math.round(+value * 100)}%`
  :                   (+value).toFixed(3);
  return (
    <Row name={entry.label || entry.name} readout={display} readoutColor="#d0d8e0">
      <input type="range" className="qc" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={ST.range} />
    </Row>
  );
}

// ── chrome ─────────────────────────────────────────────────────────────────

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

function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0b0d10 0%, #0a0a0c 100%)',
      color: '#cfd6dc', padding: '24px 32px',
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      maxWidth: 1100, margin: '0 auto',
    }}>
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
