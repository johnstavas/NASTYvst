// QcOverlay — per-instance overlay widgets.
//
//   <InfoIcon ...>   always rendered (QC on or off). Small ⓘ glyph; tooltip
//                    on hover shows the full engine-truth block.
//
//   <QcPanel ...>    rendered only when QC Mode is on. Shows the status
//                    badge, Approve / Revoke, and "Load Alternate Variant".
//
// Both read from the registry + store only. No UI assumption about which
// menu spawned the instance.

import React, { useState } from 'react';
import { useProductStatus } from './store.js';

const STATUS_COLOR = {
  legacy_only:        { fg: '#9aa5b1', bg: 'rgba(80,90,100,0.22)',  bd: 'rgba(160,170,180,0.35)' },
  in_qc:              { fg: '#ffd040', bg: 'rgba(120,90,20,0.25)',  bd: 'rgba(255,200,64,0.40)' },
  approved_engine_v1: { fg: '#7fff8f', bg: 'rgba(30,100,40,0.28)',  bd: 'rgba(127,255,143,0.45)' },
  needs_work:         { fg: '#ff7070', bg: 'rgba(110,30,30,0.30)',  bd: 'rgba(255,112,112,0.45)' },
  deferred:           { fg: '#a0a0c0', bg: 'rgba(60,60,90,0.25)',   bd: 'rgba(160,160,200,0.35)' },
};

const STATUS_LABEL = {
  legacy_only:        'LEGACY ONLY',
  in_qc:              'IN QC',
  approved_engine_v1: 'APPROVED · ENGINE V1',
  needs_work:         'NEEDS WORK',
  deferred:           'DEFERRED',
};

// ── ⓘ icon (always visible) ──────────────────────────────────────────────

export function InfoIcon({ product, variant, status }) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute', top: 6, left: 6, zIndex: 20,
        width: 18, height: 18, borderRadius: '50%',
        background: 'rgba(0,0,0,0.55)',
        border: '1px solid rgba(255,255,255,0.25)',
        color: 'rgba(255,255,255,0.7)',
        fontSize: 11, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'help', userSelect: 'none',
      }}
      title=""
    >
      i
      {hover && (
        <div style={{
          position: 'absolute', top: 22, left: 0, zIndex: 30,
          padding: '8px 10px', borderRadius: 6, whiteSpace: 'nowrap',
          background: 'rgba(10,14,18,0.96)',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 6px 22px rgba(0,0,0,0.6)',
          color: 'rgba(230,235,240,0.92)',
          fontFamily: '"Courier New", monospace', fontSize: 10, fontStyle: 'normal',
          lineHeight: 1.55, pointerEvents: 'none',
        }}>
          <div style={{ color: '#fff', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>
            {product.displayLabel}
          </div>
          <Row k="Variant"   v={variant.variantId} />
          <Row k="Display"   v={variant.displayLabel} />
          <Row k="Component" v={variant.componentName} />
          <Row k="Engine"    v={variant.engineName} />
          <Row k="Status"    v={status} highlight={STATUS_COLOR[status]?.fg} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v, highlight }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: 'rgba(160,170,180,0.85)', minWidth: 74 }}>{k}:</span>
      <span style={{ color: highlight || 'rgba(230,235,240,0.92)' }}>{v}</span>
    </div>
  );
}

// ── QC Panel (QC Mode only) ──────────────────────────────────────────────

export function QcPanel({ product, variant, onLoadAlternate }) {
  const [status, setStatus] = useProductStatus(product.productId);
  const color = STATUS_COLOR[status] || STATUS_COLOR.legacy_only;

  // Alternate variant: the one that isn't current.
  const altVariantId = variant.variantId === 'legacy' ? 'engine_v1' : 'legacy';
  const altVariant   = product.variants[altVariantId];

  const canApprove = variant.variantId === 'engine_v1' && status !== 'approved_engine_v1';
  const canRevoke  = status === 'approved_engine_v1';

  return (
    <div style={{
      position: 'absolute', top: 6, right: 6, zIndex: 20,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 4px 3px 7px', borderRadius: 6,
      background: 'rgba(10,14,18,0.75)',
      border: '1px solid rgba(255,255,255,0.12)',
      fontFamily: '"Courier New", monospace', fontSize: 9,
    }}>
      <span style={{
        color: color.fg, background: color.bg, border: `1px solid ${color.bd}`,
        padding: '2px 6px', borderRadius: 3, fontWeight: 700, letterSpacing: '0.08em',
      }}>
        {STATUS_LABEL[status] || status}
      </span>

      {canApprove && (
        <Btn label="Approve" tone="ok"
          onClick={() => setStatus('approved_engine_v1')} />
      )}
      {canRevoke && (
        <Btn label="Revoke" tone="warn"
          onClick={() => setStatus('needs_work')} />
      )}
      {altVariant && (
        <Btn label={`Load ${altVariant.displayLabel}`} tone="dim"
          onClick={() => onLoadAlternate?.(altVariantId)} />
      )}
    </div>
  );
}

function Btn({ label, tone, onClick }) {
  const palette = tone === 'ok'
      ? { fg: '#7fff8f', bd: 'rgba(127,255,143,0.4)', bg: 'rgba(30,100,40,0.25)' }
    : tone === 'warn'
      ? { fg: '#ff9080', bd: 'rgba(255,144,128,0.4)', bg: 'rgba(110,40,30,0.25)' }
    :   { fg: 'rgba(220,230,240,0.8)', bd: 'rgba(255,255,255,0.18)', bg: 'rgba(255,255,255,0.04)' };
  return (
    <button onClick={onClick} style={{
      color: palette.fg, background: palette.bg, border: `1px solid ${palette.bd}`,
      padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
      fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
    }}>{label}</button>
  );
}
