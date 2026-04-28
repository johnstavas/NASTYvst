// OpVerificationLedgerView.jsx — full-takeover view rendering all 132 ops
// with their 7-gate verification status. Read-only for now (Phase A2);
// per-op QC actions land in Phase B.
//
// Status colors (Stav's instinct: pink-square for "in progress, not trusted",
// green for verified, white for not started):
//   ✅ all 7 green        — emerald
//   🟢 6/6 auto + listen  — emerald (treated as gold-pending-disk-sync)
//   🟡 partial            — amber
//   🚧 only structural    — pink (the "looks shipped, isn't verified" state)
//   ⬜ nothing built       — neutral

import React, { useMemo, useState } from 'react';
import {
  useVerificationLedger, gatesPassed, statusEmoji,
  saveLedgerToDisk, clearAllSignoffs, getLocalSignoffs,
} from './opVerificationLedger.js';
import OpQcView from './OpQcView.jsx';

const GATE_COLS = [
  { key: 'worklet',    label: 'W', tip: 'Worklet exists (real, not a TODO stub)' },
  { key: 'cpp',        label: 'C', tip: 'C++ port exists (real, not zero-fill)' },
  { key: 'smoke',      label: 'S', tip: 'Smoke graph fixture exists' },
  { key: 't1_t7',      label: 'T', tip: 'T1–T7 sweep passes' },
  { key: 'parity',     label: 'P', tip: 'T8 native parity green' },
  { key: 'behavioral', label: 'B', tip: 'T8-B behavioral spec passes' },
  { key: 'listen',     label: 'L', tip: 'Listen sign-off (manual)' },
];

// Color palette for status emoji.
const STATUS_COLOR = {
  '✅': '#5ed184',
  '🟢': '#5ed184',
  '🟡': '#e5b85a',
  '🚧': '#d99fcf',     // pink — Stav's "not trusted" cue
  '⬜': 'rgba(255,255,255,0.25)',
};

function GateDot({ on, label, tip }) {
  return (
    <span
      title={tip + (on ? ' — green' : ' — pending')}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, marginRight: 3, borderRadius: 4,
        fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
        background: on ? 'rgba(94,209,132,0.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${on ? 'rgba(94,209,132,0.6)' : 'rgba(255,255,255,0.12)'}`,
        color: on ? '#5ed184' : 'rgba(255,255,255,0.35)',
      }}
    >
      {label}
    </span>
  );
}

function ListenCell({ value }) {
  if (!value) return <GateDot on={false} label="L" tip="Listen sign-off (manual)" />;
  return (
    <span
      title={`Signed off: ${value}`}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
        background: 'rgba(94,209,132,0.18)',
        border: '1px solid rgba(94,209,132,0.6)',
        color: '#5ed184',
      }}
    >
      L · {value}
    </span>
  );
}

export default function OpVerificationLedgerView({ onClose }) {
  const { ledger, loading, error, refresh } = useVerificationLedger();
  const [filter, setFilter] = useState('all');     // all | gold | partial | pink | empty
  const [search, setSearch] = useState('');
  const [selectedOpId, setSelectedOpId] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' });
  // status: 'idle' | 'saving' | 'ok' | 'err'

  const localSignoffCount = useMemo(() => Object.keys(getLocalSignoffs()).length, [ledger]);
  const handleSave = async () => {
    if (!ledger) return;
    setSaveState({ status: 'saving', message: 'writing ledger…' });
    try {
      const r = await saveLedgerToDisk(ledger);
      // Disk now has the merged truth — clear local signoffs so the next
      // fetch isn't a double-merge, then re-fetch to pick up savedAt.
      clearAllSignoffs();
      await refresh();
      setSaveState({
        status: 'ok',
        message: `saved ${r.opCount} ops · ${new Date(r.savedAt).toLocaleTimeString()}`,
      });
      setTimeout(() => setSaveState({ status: 'idle', message: '' }), 4000);
    } catch (err) {
      setSaveState({ status: 'err', message: String(err.message || err) });
    }
  };

  // NOTE: ALL hooks must run unconditionally on every render — the early
  // return for selectedOpId comes AFTER the useMemos to satisfy rules-of-hooks.
  const ops = useMemo(() => {
    if (!ledger) return [];
    let list = ledger.ops.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o => o.id.toLowerCase().includes(q));
    }
    if (filter === 'gold')    list = list.filter(o => gatesPassed(o) === 7);
    if (filter === 'partial') list = list.filter(o => o.autoPassed >= 3 && o.autoPassed < 6);
    if (filter === 'pink')    list = list.filter(o => o.autoPassed >= 1 && o.autoPassed < 3);
    if (filter === 'auto6')   list = list.filter(o => o.autoPassed === 6 && !o.gates.listen);
    list.sort((a, b) => {
      // Most-progressed first (so user sees what's closest to done at the top).
      const ag = gatesPassed(a), bg = gatesPassed(b);
      if (bg !== ag) return bg - ag;
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [ledger, filter, search]);

  const totals = useMemo(() => {
    if (!ledger) return null;
    const t = { gold: 0, auto6: 0, partial: 0, pink: 0, empty: 0 };
    for (const o of ledger.ops) {
      const n = gatesPassed(o);
      if (n === 7) t.gold++;
      else if (o.autoPassed === 6) t.auto6++;
      else if (o.autoPassed >= 3) t.partial++;
      else if (o.autoPassed >= 1) t.pink++;
      else t.empty++;
    }
    return t;
  }, [ledger]);

  // Per-op view takes over when a row is clicked. Conditional render AFTER
  // all hooks so rules-of-hooks is satisfied.
  if (selectedOpId) {
    return (
      <OpQcView
        opId={selectedOpId}
        onClose={() => setSelectedOpId(null)}
      />
    );
  }

  return (
    <div style={{
      width: '100%', padding: '24px 32px 80px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 1280,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18,
      }}>
        <div>
          <div style={{
            fontSize: 10, letterSpacing: '0.32em', textTransform: 'uppercase',
            color: '#d99fcf', fontWeight: 700, marginBottom: 6,
          }}>
            Verification · Ledger
          </div>
          <div style={{
            fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
            letterSpacing: '0.01em',
          }}>
            Op verification status
          </div>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6,
            maxWidth: 720, lineHeight: 1.5,
          }}>
            Live state of the 7-gate verification protocol per op. After the
            2026-04-26 trust reset, every op needs to earn its green checkmark
            individually. Gates W·C·S·T·P·B are auto-detected from disk;
            gate L (listen sign-off) is manual.
            {' '}<span style={{ color: 'rgba(255,255,255,0.3)' }}>
              Refresh after running <code style={{
                fontFamily: 'monospace', fontSize: 10,
                background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3,
              }}>node scripts/generate_verification_ledger.mjs</code>.
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveState.message && (
            <span style={{
              fontSize: 10, letterSpacing: '0.06em',
              color: saveState.status === 'ok' ? '#5ed184'
                   : saveState.status === 'err' ? '#e57b7b'
                   : 'rgba(255,255,255,0.5)',
              maxWidth: 260, textAlign: 'right',
            }}>
              {saveState.message}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!ledger || saveState.status === 'saving'}
            title={
              localSignoffCount > 0
                ? `Persist ${localSignoffCount} unsaved sign-off${localSignoffCount === 1 ? '' : 's'} to public/verification_ledger.json`
                : 'Persist current ledger state to public/verification_ledger.json'
            }
            style={{
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
              fontWeight: 600, padding: '8px 14px', borderRadius: 6,
              background: localSignoffCount > 0
                ? 'rgba(94,209,132,0.18)'
                : 'rgba(94,209,132,0.08)',
              border: `1px solid ${localSignoffCount > 0 ? 'rgba(94,209,132,0.7)' : 'rgba(94,209,132,0.3)'}`,
              color: '#5ed184',
              cursor: saveState.status === 'saving' ? 'wait' : 'pointer',
              opacity: saveState.status === 'saving' ? 0.6 : 1,
              position: 'relative',
            }}
          >
            {saveState.status === 'saving' ? '… Saving' : '💾 Save'}
            {localSignoffCount > 0 && saveState.status !== 'saving' && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: '#5ed184', color: '#0a0a0a',
                fontSize: 9, fontWeight: 700,
                width: 16, height: 16, borderRadius: 8,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {localSignoffCount}
              </span>
            )}
          </button>
          <button
            onClick={refresh}
            style={{
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
              fontWeight: 600, padding: '8px 14px', borderRadius: 6,
              background: 'rgba(217,159,207,0.1)',
              border: '1px solid rgba(217,159,207,0.4)',
              color: '#d99fcf', cursor: 'pointer',
            }}
            title="Re-fetch verification_ledger.json"
          >
            ↻ Refresh
          </button>
          <button
            onClick={onClose}
            style={{
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
              fontWeight: 600, padding: '8px 16px', borderRadius: 6,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
            }}
            title="Back to chain"
          >
            ← Back to chain
          </button>
        </div>
      </div>

      {/* Status summary chips */}
      {totals && (
        <div style={{
          width: '100%', maxWidth: 1280, display: 'flex', gap: 10, marginBottom: 14,
          flexWrap: 'wrap',
        }}>
          {[
            { id: 'all',     label: `All (${ledger.totalOps})`,                color: 'rgba(255,255,255,0.5)' },
            { id: 'gold',    label: `✅ Gold (${totals.gold})`,                color: STATUS_COLOR['✅'] },
            { id: 'auto6',   label: `🟢 6/6 awaiting listen (${totals.auto6})`, color: STATUS_COLOR['🟢'] },
            { id: 'partial', label: `🟡 Partial (${totals.partial})`,           color: STATUS_COLOR['🟡'] },
            { id: 'pink',    label: `🚧 Pink (untrusted) (${totals.pink})`,    color: STATUS_COLOR['🚧'] },
          ].map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              style={{
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                fontWeight: 600, padding: '6px 10px', borderRadius: 4,
                background: filter === c.id ? `${c.color}22` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${filter === c.id ? c.color : 'rgba(255,255,255,0.1)'}`,
                color: filter === c.id ? c.color : 'rgba(255,255,255,0.5)', cursor: 'pointer',
              }}>
              {c.label}
            </button>
          ))}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search op id…"
            style={{
              flex: 1, minWidth: 200, padding: '6px 10px', borderRadius: 4,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.8)', fontSize: 12, outline: 'none',
            }}
          />
        </div>
      )}

      {loading && <div style={{ color: 'rgba(255,255,255,0.5)', marginTop: 40 }}>Loading ledger…</div>}
      {error && (
        <div style={{ color: '#e5b85a', marginTop: 40, fontSize: 12 }}>
          ledger unavailable — run{' '}
          <code style={{ fontFamily: 'monospace' }}>
            node scripts/generate_verification_ledger.mjs
          </code>{' '}
          and refresh.
        </div>
      )}

      {/* Table */}
      {ledger && (
        <div style={{
          width: '100%', maxWidth: 1280,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px 1fr 80px repeat(7, 32px) 220px',
            gap: 8, padding: '10px 14px',
            fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)', fontWeight: 600,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.2)',
          }}>
            <div>·</div>
            <div>op id</div>
            <div style={{ textAlign: 'center' }}>auto</div>
            {GATE_COLS.map(g => <div key={g.key} title={g.tip} style={{ textAlign: 'center' }}>{g.label}</div>)}
            <div>notes</div>
          </div>
          {ops.map(op => {
            const emoji = statusEmoji(op);
            const color = STATUS_COLOR[emoji];
            return (
              <div key={op.id} onClick={() => setSelectedOpId(op.id)} style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 80px repeat(7, 32px) 220px',
                gap: 8, padding: '8px 14px', alignItems: 'center',
                fontSize: 12, color: 'rgba(255,255,255,0.85)',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                cursor: 'pointer',
                transition: 'background 80ms',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                title="Click to open per-op QC view"
              >
                <div style={{ fontSize: 14, color }}>{emoji}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 500 }}>{op.id}</div>
                <div style={{ textAlign: 'center', fontFamily: 'monospace',
                  color: op.autoPassed === 6 ? '#5ed184' : 'rgba(255,255,255,0.5)',
                  fontWeight: 600,
                }}>
                  {op.autoPassed}/6
                </div>
                {GATE_COLS.slice(0, 6).map(g => (
                  <div key={g.key} style={{ textAlign: 'center' }}>
                    <GateDot on={op.gates[g.key]} label={g.label} tip={g.tip} />
                  </div>
                ))}
                <div style={{ textAlign: 'center' }}>
                  <ListenCell value={op.gates.listen} />
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{op.notes || '—'}</div>
              </div>
            );
          })}
          {ops.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
              no ops match filter
            </div>
          )}
        </div>
      )}

      {ledger && (
        <div style={{
          marginTop: 14, fontSize: 9, color: 'rgba(255,255,255,0.3)',
          letterSpacing: '0.05em',
        }}>
          generated {new Date(ledger.generatedAt).toLocaleString()} · {ledger.totalOps} ops total
        </div>
      )}
    </div>
  );
}
