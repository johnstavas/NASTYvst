// src/qc-harness/Controls.jsx
//
// Shared slider / toggle / enum / preset renderers for the QC UI.
// Used by BOTH:
//   - QcHarness.jsx (standalone ?qc= route)
//   - QcDrawer.jsx  (docked drawer inside the main app)
//
// The goal is that whichever entry-point you use, the *same* engine produces
// the *same* control rendering. Extracted verbatim from the QcHarness
// internals so appearance stays identical.

import React from 'react';
import { groupEntries } from './entries.js';

// ── Public: render a full control panel for a set of entries ──────────────
//
// Auto-splits into a COMMON section plus per-base A/B sections.
//
//   <ControlPanel
//     entries={entries}
//     values={values}
//     onChange={setParam}
//   />
export function ControlPanel({ entries, values, onChange, commonTitle = 'COMMON' }) {
  const { common, pairs } = React.useMemo(() => groupEntries(entries), [entries]);

  return (
    <>
      {common.length > 0 && (
        <Section title={commonTitle}>
          {common.map(e => (
            <Control key={e.name} entry={e} value={values[e.name]}
              onChange={v => onChange(e.name, v)} />
          ))}
        </Section>
      )}
      {pairs.map(({ base, A, B }) => (
        <Section key={base} title={`${base.replace(/^set/, '').toUpperCase()} · A / B`}>
          <Control entry={A} value={values[A.name]} onChange={v => onChange(A.name, v)} />
          <Control entry={B} value={values[B.name]} onChange={v => onChange(B.name, v)} />
        </Section>
      ))}
    </>
  );
}

// ── Control router (one entry → one rendered row) ──────────────────────────

export function Control({ entry, value, onChange }) {
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

// ── Chrome helpers ─────────────────────────────────────────────────────────

export function Row({ name, readout, readoutColor, children }) {
  return (
    <div style={ST.row}>
      <div style={ST.rowLabel}>{name}</div>
      <div style={ST.rowCtl}>{children}</div>
      <div style={{ ...ST.rowReadout, color: readoutColor || '#d0d8e0' }}>{readout}</div>
    </div>
  );
}
export function Section({ title, children }) {
  return (
    <div style={ST.section}>
      <div style={ST.sectionTitle}>{title}</div>
      <div style={{ padding: '4px 0' }}>{children}</div>
    </div>
  );
}
export function Btn({ children, on, onClick, small }) {
  return (
    <button onClick={onClick}
      style={{ ...ST.btn, ...(on ? ST.btnOn : {}), ...(small ? ST.btnSmall : {}) }}>
      {children}
    </button>
  );
}

// ── Styles (extracted from QcHarness.jsx) ──────────────────────────────────
export const ST = {
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

// Inject the slider-thumb CSS once for the whole app. Both QcHarness and
// QcDrawer need this; doing it here means neither duplicates it.
export function SliderThumbStyle() {
  return (
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
  );
}
