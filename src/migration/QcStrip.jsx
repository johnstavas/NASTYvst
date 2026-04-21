// src/migration/QcStrip.jsx
//
// Horizontal QC strip rendered ABOVE each plugin instance when QC Mode is on.
// Replaces the old absolute-positioned QcPanel that was sitting on top of
// plugin knobs and blocking clicks.
//
// Structure (left → right):
//   [Plugin name]  [Status badge]  [Variant dropdown]  [QC Steps ▾]  [Open QC]
//
// When QC Mode is off, this component is NOT mounted — nothing renders.
// When the Steps row is collapsed, the strip is a thin single line so
// plugin positions don't jump.

import React, { useState, useMemo } from 'react';
import { useProductStatus } from './store.js';
import { useParity } from './parity.js';

// ── conformance-spec existence check (Vite build-time glob) ────────────────
// `as: 'raw'` pulls the markdown body at build time so we can check existence
// without filesystem access at runtime.
const CONFORMANCE_MODULES = import.meta.glob('/src/**/CONFORMANCE.md', { as: 'raw', eager: true });
function conformanceDirFor(product) {
  // registry legacyType and productId both often match the folder name.
  // We search by productId first, then legacyType, then displayLabel-slug.
  const candidates = [product.productId, product.legacyType];
  for (const path of Object.keys(CONFORMANCE_MODULES)) {
    for (const c of candidates) {
      if (c && path.toLowerCase().includes(`/${c.toLowerCase()}/`)) return path;
    }
  }
  // nastybeast has productId='flapjackman' but lives in src/nastybeast/
  // — handle known aliases explicitly.
  const alias = { flapjackman: 'nastybeast' }[product.productId];
  if (alias) {
    for (const path of Object.keys(CONFORMANCE_MODULES)) {
      if (path.toLowerCase().includes(`/${alias}/`)) return path;
    }
  }
  return null;
}

// ── palettes ───────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  prototype_only: { fg: '#9aa5b1', bg: 'rgba(80,90,100,0.22)',  bd: 'rgba(160,170,180,0.35)' },
  in_qc:          { fg: '#ffd040', bg: 'rgba(120,90,20,0.25)',  bd: 'rgba(255,200,64,0.40)' },
  approved_v1:    { fg: '#7fff8f', bg: 'rgba(30,100,40,0.28)',  bd: 'rgba(127,255,143,0.45)' },
  needs_work:     { fg: '#ff7070', bg: 'rgba(110,30,30,0.30)',  bd: 'rgba(255,112,112,0.45)' },
  deferred:       { fg: '#a0a0c0', bg: 'rgba(60,60,90,0.25)',   bd: 'rgba(160,160,200,0.35)' },
};
const STATUS_LABEL = {
  prototype_only: 'PROTOTYPE ONLY',
  in_qc:          'IN QC',
  approved_v1:    'APPROVED · V1',
  needs_work:     'NEEDS WORK',
  deferred:       'DEFERRED',
};

// ── main component ─────────────────────────────────────────────────────────

export function QcStrip({ product, variant, engine, onSwitchVariant, onOpenQc }) {
  const [status, setStatus] = useProductStatus(product.productId);
  const [stepsOpen, setStepsOpen] = useState(false);
  const parity = useParity(product.productId);

  const color = STATUS_COLOR[status] || STATUS_COLOR.prototype_only;
  const versions = Object.keys(product.variants);
  const showVariantSwitcher = versions.length > 1;
  const hasV1Variant = !!product.variants.v1;

  // Lifecycle button visibility — one switch, not a dozen scattered flags.
  // Rules:
  //   START QC      → only when a v1 exists and we haven't started yet
  //   APPROVE       → only when the current instance is on v1 and unapproved
  //   NEEDS WORK    → when in_qc or approved (lets you flag a regression after ship)
  //   DEFER         → anytime except already-deferred (parks the plugin, no regrets)
  //   RESUME QC     → when deferred or needs_work, to put it back in the queue
  const canStartQc  = hasV1Variant && status === 'prototype_only';
  const canApprove  = hasV1Variant && variant.version === 'v1' && status !== 'approved_v1';
  const canNeedsWk  = status === 'in_qc' || status === 'approved_v1';
  const canDefer    = status !== 'deferred';
  const canResume   = status === 'deferred' || status === 'needs_work';

  const approve = () => {
    if (parity?.status === 'DRIFT') {
      const ok = window.confirm(
        `Parity audit shows DRIFT — v1 is missing: ${parity.legacyOnly.join(', ')}\n\n` +
        'Approve anyway? (Only do this if those features were intentionally retired.)'
      );
      if (!ok) return;
    }
    setStatus('approved_v1');
  };
  const startQc = () => {
    setStatus('in_qc');
    // If a v1 exists but the instance is on prototype, nudge it to v1 so the
    // user can actually hear what they're QC'ing.
    if (variant.version !== 'v1' && hasV1Variant) onSwitchVariant?.('v1');
  };

  return (
    <div style={{
      // The strip is ABOVE the plugin — its own row, not an overlay.
      // No absolute positioning, no z-index fighting.
      marginBottom: 4,
      padding: '6px 10px',
      borderRadius: 6,
      background: 'rgba(10,14,18,0.72)',
      border: '1px solid rgba(255,255,255,0.10)',
      fontFamily: '"Courier New", monospace',
      fontSize: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    }}>
      {/* ── header row ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          color: '#e6eef5', fontWeight: 700, letterSpacing: '0.12em',
          fontFamily: '"Courier New", monospace', fontSize: 11,
        }}>
          {product.displayLabel.toUpperCase()}
        </span>

        <Badge color={color}>{STATUS_LABEL[status] || status}</Badge>

        {showVariantSwitcher && (
          <VariantSwitcher
            product={product}
            currentId={variant.version}
            onChange={onSwitchVariant}
          />
        )}

        <button
          onClick={() => setStepsOpen(v => !v)}
          style={btnStyle(stepsOpen)}
          title="Show QC checklist for this plugin"
        >
          {stepsOpen ? '▴' : '▾'} QC STEPS
        </button>

        <button
          onClick={onOpenQc}
          style={btnStyle(false, 'primary')}
          title="Open the QC Analyzer (sweeps, snapshots, findings)"
        >
          OPEN QC ▸
        </button>

        <div style={{ flex: 1 }} />

        {canStartQc && (
          <button onClick={startQc} style={btnStyle(false, 'primary')}
            title="Begin QC: moves this product into IN QC and switches the instance to v1.">
            ▶ START QC
          </button>
        )}
        {canApprove && (
          <button onClick={approve} style={btnStyle(false, 'ok')}
            title="Mark v1 as approved. The non-QC menu will load v1 for this product from now on.">
            ✓ APPROVE V1
          </button>
        )}
        {canNeedsWk && (
          <button onClick={() => setStatus('needs_work')} style={btnStyle(false, 'warn')}
            title="Flag a regression. Drops approval and sends back to the work queue.">
            ✗ NEEDS WORK
          </button>
        )}
        {canDefer && (
          <button onClick={() => setStatus('deferred')} style={btnStyle(false)}
            title="Park this product. Won't appear as ready-for-QC until resumed.">
            ⏸ DEFER
          </button>
        )}
        {canResume && (
          <button onClick={() => setStatus('in_qc')} style={btnStyle(false, 'primary')}
            title="Put this product back into the QC queue.">
            ▶ RESUME QC
          </button>
        )}
      </div>

      {/* ── steps (collapsible) ─────────────────────────────────────── */}
      {stepsOpen && <Steps product={product} variant={variant} engine={engine} parity={parity} />}
    </div>
  );
}

// ── variant switcher ──────────────────────────────────────────────────────

function VariantSwitcher({ product, currentId, onChange }) {
  return (
    <select
      value={currentId}
      onChange={(e) => {
        const next = e.target.value;
        if (next !== currentId) onChange?.(next);
      }}
      style={{
        padding: '3px 6px',
        background: 'rgba(20,26,34,0.95)',
        color: '#cfd6dc',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 3,
        fontFamily: '"Courier New", monospace',
        fontSize: 10,
        cursor: 'pointer',
      }}
      title="Switch this instance between Prototype and V1"
    >
      {Object.values(product.variants).map(v => (
        <option key={v.version} value={v.version} style={{ background: '#0a0d12' }}>
          {v.displayLabel.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

// ── steps checklist ───────────────────────────────────────────────────────

function Steps({ product, variant, engine, parity }) {
  // Build the real step list from what's actually present on the engine
  // and what's on disk. No guessing — each row is a live check.
  const rows = useMemo(() => {
    const r = [];

    // Helper: each row has a tri-state { state: 'ok' | 'fail' | 'na', ... }
    // 'na' renders as a neutral dash — for checks that can't be evaluated
    // in the current registry context (e.g. parity when no engine_v1 exists).
    const push = (state, label, detail) => r.push({ state, label, detail });

    // 1. paramSchema declared
    const schema = engine && Array.isArray(engine.paramSchema) ? engine.paramSchema : null;
    push(schema ? 'ok' : 'fail', 'paramSchema declared',
      schema ? `${schema.length} params` : 'missing — engine has no paramSchema export');

    // 2. getState()
    const hasGetState = engine && typeof engine.getState === 'function';
    let stateFields = 0;
    if (hasGetState) {
      try { stateFields = Object.keys(engine.getState() || {}).length; } catch {}
    }
    push(hasGetState ? 'ok' : 'fail', 'getState() implemented',
      hasGetState ? `returns ${stateFields} fields` : 'missing — harness cannot read engine state');

    // 3. getLatency()
    const hasLatency = engine && typeof engine.getLatency === 'function';
    let latVal = null;
    if (hasLatency) {
      try { latVal = engine.getLatency(); } catch {}
    }
    const latOk = hasLatency && Number.isFinite(latVal) && latVal >= 0;
    push(latOk ? 'ok' : 'fail', 'getLatency() implemented',
      hasLatency
        ? (Number.isFinite(latVal) ? `${(latVal * 1000).toFixed(1)} ms` : 'returned non-finite')
        : 'missing — PDC cannot be reported');

    // 4. setBypass present
    const hasBypass = engine && typeof engine.setBypass === 'function';
    push(hasBypass ? 'ok' : 'fail', 'setBypass() present',
      hasBypass ? 'ok' : 'missing — universal contract incomplete');

    // 5. dispose present
    const hasDispose = engine && typeof engine.dispose === 'function';
    push(hasDispose ? 'ok' : 'fail', 'dispose() present',
      hasDispose ? 'ok' : 'missing — leaks on unmount');

    // 6. CONFORMANCE.md exists on disk
    const confPath = conformanceDirFor(product);
    push(confPath ? 'ok' : 'fail', 'CONFORMANCE.md spec exists',
      confPath ? confPath.replace(/^\/src\//, 'src/') : 'no spec file found');

    // 7. parity against prototype (from migration/parity.js)
    //    When the registry has no v1 variant yet, this check is N/A,
    //    not a failure — promoting to v1 is a deliberate act, not a bug.
    const hasV1Variant = !!product.variants.v1;
    if (!hasV1Variant) {
      push('na', 'V1 parity with prototype', 'N/A — no v1 registered yet');
    } else if (parity) {
      const s = parity.status;
      const state =
          s === 'OK' || s === 'EXTENDED' ? 'ok'
        : s === 'LEGACY_ONLY'             ? 'na'
        :                                   'fail';
      const detail =
          s === 'OK'           ? 'OK'
        : s === 'EXTENDED'     ? `EXTENDED (+${parity.v1Only.length} new)`
        : s === 'DRIFT'        ? `DRIFT — missing: ${parity.legacyOnly.join(', ')}`
        : s === 'LEGACY_ONLY'  ? 'no V1 engine yet'
        :                        s;
      push(state, 'V1 parity with prototype', detail);
    } else {
      push('na', 'V1 parity with prototype', 'parity report not loaded');
    }

    return r;
  }, [engine, product, parity]);

  return (
    <div style={{
      marginTop: 2,
      padding: '8px 10px',
      borderRadius: 4,
      background: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: 12,
      rowGap: 4,
      fontSize: 10,
      lineHeight: 1.5,
    }}>
      {rows.map((row, i) => {
        const glyph   = row.state === 'ok' ? '✓' : row.state === 'fail' ? '✗' : '–';
        const iconCol = row.state === 'ok' ? '#7fff8f'
                      : row.state === 'fail' ? '#ff8080'
                      : 'rgba(180,190,200,0.55)';
        const labelCol = row.state === 'na' ? 'rgba(200,210,220,0.55)' : '#c8d0d8';
        const detCol   = row.state === 'ok'   ? 'rgba(200,220,200,0.7)'
                       : row.state === 'fail' ? 'rgba(255,160,160,0.85)'
                       :                        'rgba(180,190,200,0.55)';
        return (
          <React.Fragment key={i}>
            <span style={{ width: 14, textAlign: 'center', color: iconCol, fontWeight: 700 }}>
              {glyph}
            </span>
            <span style={{ color: labelCol, fontStyle: row.state === 'na' ? 'italic' : 'normal' }}>
              {row.label}
            </span>
            <span style={{
              color: detCol,
              fontFamily: '"Courier New", monospace',
              textAlign: 'right',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 320,
            }} title={row.detail}>
              {row.detail}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── little UI atoms ───────────────────────────────────────────────────────

function Badge({ color, children }) {
  return (
    <span style={{
      color: color.fg,
      background: color.bg,
      border: `1px solid ${color.bd}`,
      padding: '2px 7px',
      borderRadius: 3,
      fontWeight: 700,
      letterSpacing: '0.08em',
      fontSize: 10,
    }}>
      {children}
    </span>
  );
}

function btnStyle(active, tone) {
  const palette =
      tone === 'primary' ? { fg: '#cfe8ff', bg: 'rgba(40,80,140,0.45)', bd: 'rgba(127,180,255,0.55)' }
    : tone === 'ok'      ? { fg: '#7fff8f', bg: 'rgba(30,100,40,0.28)', bd: 'rgba(127,255,143,0.45)' }
    : tone === 'warn'    ? { fg: '#ff9080', bg: 'rgba(110,40,30,0.30)', bd: 'rgba(255,144,128,0.45)' }
    : active             ? { fg: '#fff',     bg: 'rgba(255,255,255,0.12)', bd: 'rgba(255,255,255,0.35)' }
    :                      { fg: 'rgba(220,230,240,0.85)', bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.18)' };
  return {
    cursor: 'pointer',
    padding: '3px 9px',
    borderRadius: 3,
    color: palette.fg,
    background: palette.bg,
    border: `1px solid ${palette.bd}`,
    fontFamily: '"Courier New", monospace',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
  };
}
