// src/migration/QcWizard.jsx
//
// 4-step progress strip that replaces QcStrip.
// Shows exactly what step you're on. Click any step to open its popup.
//
// Steps:
//   1. FORK    — register engine_v1 in registry.js (code edit)
//   2. PARITY  — structural checks: schema, getState, getLatency, etc.
//   3. AUDIO   — sweep every parameter, listen, tick off the checklist
//   4. APPROVE — ship engine_v1 as the new default
//
// Same props as QcStrip so the mount in main.jsx is a 1-line import swap.

import React, { useState, useMemo } from 'react';
import { useProductStatus } from './store.js';
import { useParity } from './parity.js';

// ── Conformance spec lookup (Vite build-time glob) ────────────────────────
const CONFORMANCE_MODULES = import.meta.glob('/src/**/CONFORMANCE.md', { as: 'raw', eager: true });
function conformanceDirFor(product) {
  const candidates = [product.productId, product.legacyType];
  for (const path of Object.keys(CONFORMANCE_MODULES)) {
    for (const c of candidates) {
      if (c && path.toLowerCase().includes(`/${c.toLowerCase()}/`)) return path;
    }
  }
  const alias = { flapjackman: 'nastybeast' }[product.productId];
  if (alias) {
    for (const path of Object.keys(CONFORMANCE_MODULES)) {
      if (path.toLowerCase().includes(`/${alias}/`)) return path;
    }
  }
  return null;
}

// ── Parity rows (runs against the live engine) ────────────────────────────
function buildParityRows(product, engine, parity) {
  const rows = [];
  const push = (state, label, detail) => rows.push({ state, label, detail });

  const schema = engine && Array.isArray(engine.paramSchema) ? engine.paramSchema : null;
  push(schema ? 'ok' : 'fail', 'paramSchema', schema ? `${schema.length} params` : 'missing');

  const hasGetState = engine && typeof engine.getState === 'function';
  let stateFields = 0;
  if (hasGetState) { try { stateFields = Object.keys(engine.getState() || {}).length; } catch {} }
  push(hasGetState ? 'ok' : 'fail', 'getState()', hasGetState ? `${stateFields} fields` : 'missing');

  const hasLatency = engine && typeof engine.getLatency === 'function';
  let latVal = null;
  if (hasLatency) { try { latVal = engine.getLatency(); } catch {} }
  const latOk = hasLatency && Number.isFinite(latVal) && latVal >= 0;
  push(latOk ? 'ok' : 'fail', 'getLatency()', latOk ? `${(latVal * 1000).toFixed(1)} ms` : 'missing');

  const hasBypass = engine && typeof engine.setBypass === 'function';
  push(hasBypass ? 'ok' : 'fail', 'setBypass()', hasBypass ? 'ok' : 'missing');

  const hasDispose = engine && typeof engine.dispose === 'function';
  push(hasDispose ? 'ok' : 'fail', 'dispose()', hasDispose ? 'ok' : 'missing');

  const confPath = conformanceDirFor(product);
  push(confPath ? 'ok' : 'fail', 'CONFORMANCE.md', confPath ? confPath.replace(/^\/src\//, 'src/') : 'not found');

  const hasV1 = !!product.variants.engine_v1;
  if (!hasV1) {
    push('na', 'V1 parity', 'N/A — no engine_v1 yet');
  } else if (parity) {
    const s = parity.status;
    const state = (s === 'OK' || s === 'EXTENDED') ? 'ok' : s === 'LEGACY_ONLY' ? 'na' : 'fail';
    const detail = s === 'OK' ? 'OK'
      : s === 'EXTENDED'    ? `+${parity.v1Only?.length ?? 0} new`
      : s === 'DRIFT'       ? `DRIFT: ${parity.legacyOnly?.join(', ')}`
      : s === 'LEGACY_ONLY' ? 'no v1 yet'
      : s;
    push(state, 'V1 parity', detail);
  } else {
    push('na', 'V1 parity', 'loading…');
  }

  return rows;
}

// ── Audio checklist tasks ─────────────────────────────────────────────────
const AUDIO_TASKS = [
  { id: 'bypass',  label: 'Bypass null test — toggle bypass, signal should collapse below −120 dBFS' },
  { id: 'sweeps',  label: 'Parameter sweeps — drag every knob end-to-end, no clicks or distortion' },
  { id: 'presets', label: 'Preset audit — load each preset, confirm it sounds right and sliders reflect state' },
  { id: 'dynamic', label: 'Dynamic range — loud, quiet, and silence all behave correctly, no stuck DC' },
];

// ── Step-node palette ─────────────────────────────────────────────────────
const NODE_PALETTE = {
  locked:  { bg: '#111519', border: '#252c38', text: '#3a4455', label: '#3a4455' },
  ready:   { bg: '#0f1e34', border: '#3a6aaa', text: '#6aaad8', label: '#7ab8e8' },
  active:  { bg: '#152540', border: '#6aa8f8', text: '#b8d8ff', label: '#b8d8ff' },
  done:    { bg: '#0a2016', border: '#2a8a4a', text: '#60c878', label: '#60c878' },
  failed:  { bg: '#200e14', border: '#8a2a2a', text: '#d86868', label: '#d86868' },
};

// ── Status labels / colours ────────────────────────────────────────────────
const STATUS_LABEL = {
  prototype_only: 'PROTOTYPE ONLY',
  in_qc:          'IN QC',
  approved_v1:    'APPROVED',
  needs_work:     'NEEDS WORK',
  deferred:       'DEFERRED',
};
const STATUS_COLOR = {
  prototype_only: '#5a6470',
  in_qc:          '#ffc840',
  approved_v1:    '#60c878',
  needs_work:     '#d86868',
  deferred:       '#9090b8',
};

// ── Main component ─────────────────────────────────────────────────────────
export function QcWizard({ product, variant, engine, onSwitchVariant, onOpenQc }) {
  const [status, setStatus] = useProductStatus(product.productId);
  const parity              = useParity(product.productId);
  const [openStep, setOpenStep]     = useState(null);
  const [audioChecks, setAudioChecks] = useState({});

  const hasV1       = !!product.variants.v1;
  const onV1        = variant.version === 'v1';
  const approved    = status === 'approved_v1';

  const parityRows  = useMemo(() => buildParityRows(product, engine, parity), [product, engine, parity]);
  const parityAllOk = parityRows.every(r => r.state !== 'fail');
  const audioAllOk  = AUDIO_TASKS.every(t => !!audioChecks[t.id]);

  // Step states — locked / ready / done / failed
  let s1 = hasV1 ? 'done' : 'ready';
  let s2 = !hasV1 ? 'locked' : parityAllOk ? 'done' : 'ready';
  let s3 = (!hasV1 || !parityAllOk) ? 'locked' : audioAllOk ? 'done' : 'ready';
  let s4 = approved ? 'done'
         : (!hasV1 || !parityAllOk || !audioAllOk) ? 'locked'
         : 'ready';
  if (status === 'needs_work') { s4 = 'failed'; }
  if (approved) { s1 = s2 = s3 = s4 = 'done'; }

  const stepDefs = [
    { id: 1, label: 'FORK',   hint: 'Register v1',         state: s1 },
    { id: 2, label: 'PARITY', hint: 'Structural checks',  state: s2 },
    { id: 3, label: 'AUDIO',  hint: 'Sweep & listen',     state: s3 },
    { id: 4, label: 'APPROVE',hint: 'Ship it',            state: s4 },
  ];

  // Current active step = first non-done, non-locked
  const currentStep = stepDefs.find(s => s.state === 'ready' || s.state === 'failed');

  function toggleStep(id) {
    const s = stepDefs.find(x => x.id === id);
    if (!s || s.state === 'locked') return;
    setOpenStep(prev => prev === id ? null : id);
  }

  const doApprove = () => {
    if (parity?.status === 'DRIFT') {
      if (!window.confirm(`Parity DRIFT — missing: ${parity.legacyOnly?.join(', ')}\n\nApprove anyway?`)) return;
    }
    setStatus('approved_v1');
    setOpenStep(null);
  };

  return (
    <div style={{ position: 'relative', marginBottom: 5 }}>

      {/* ── STRIP ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '8px 14px',
        background: 'rgba(8,11,16,0.90)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderBottom: openStep ? '1px solid rgba(255,255,255,0.03)' : undefined,
        borderRadius: openStep ? '7px 7px 0 0' : 7,
        fontFamily: '"Courier New", monospace',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}>

        {/* Plugin name */}
        <span style={{ color: '#dde6ee', fontWeight: 700, fontSize: 11,
          letterSpacing: '0.12em', minWidth: 90 }}>
          {product.displayLabel.toUpperCase()}
        </span>

        {/* 4-step progress rail */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {stepDefs.map((step, i) => (
            <React.Fragment key={step.id}>
              {i > 0 && (
                <div style={{
                  width: 24, height: 2, margin: '0 1px',
                  background: (stepDefs[i].state === 'done' && stepDefs[i-1].state === 'done')
                    ? '#2a8a4a' : '#1c232e',
                  transition: 'background 0.3s',
                }} />
              )}
              <StepNode
                step={step}
                isOpen={openStep === step.id}
                isCurrent={currentStep?.id === step.id && openStep === null}
                onClick={() => toggleStep(step.id)}
              />
            </React.Fragment>
          ))}
        </div>

        {/* Hint — what to do next */}
        <span style={{ color: 'rgba(160,180,200,0.40)', fontSize: 10, fontStyle: 'italic' }}>
          {approved ? '— all done' : currentStep ? `← ${currentStep.hint}` : ''}
        </span>

        <div style={{ flex: 1 }} />

        {/* Defer / Resume */}
        {!approved && status !== 'deferred' && (
          <button onClick={() => { setStatus('deferred'); setOpenStep(null); }}
            style={ghostBtn} title="Park this plugin — you can resume later">
            ⏸ DEFER
          </button>
        )}
        {status === 'deferred' && (
          <button onClick={() => setStatus('in_qc')}
            style={{ ...ghostBtn, color: '#6aaad8', borderColor: 'rgba(106,170,216,0.4)' }}>
            ▶ RESUME
          </button>
        )}

        {/* Status badge */}
        <span style={{
          color: STATUS_COLOR[status] || '#5a6470',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          paddingLeft: 12, whiteSpace: 'nowrap',
        }}>
          {STATUS_LABEL[status] || status}
        </span>
      </div>

      {/* ── POPUP ─────────────────────────────────────────────────── */}
      {openStep !== null && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500,
          background: 'rgba(8,11,16,0.97)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
          padding: '18px 20px',
          fontFamily: '"Courier New", monospace',
        }}>
          {openStep === 1 && (
            <ForkPopup product={product} hasV1={hasV1} onClose={() => setOpenStep(null)} />
          )}
          {openStep === 2 && (
            <ParityPopup
              parityRows={parityRows}
              parityAllOk={parityAllOk}
              hasV1={hasV1}
              onV1={onV1}
              onSwitchToV1={() => onSwitchVariant?.('v1')}
              onPass={() => setOpenStep(3)}
              onClose={() => setOpenStep(null)}
            />
          )}
          {openStep === 3 && (
            <AudioPopup
              audioChecks={audioChecks}
              onCheck={(id, v) => setAudioChecks(p => ({ ...p, [id]: v }))}
              audioAllOk={audioAllOk}
              onOpenQc={() => { onOpenQc?.(); setOpenStep(null); }}
              onNeedsWork={() => { setStatus('needs_work'); setOpenStep(null); }}
              onPass={() => { setStatus('in_qc'); setOpenStep(4); }}
              onClose={() => setOpenStep(null)}
            />
          )}
          {openStep === 4 && (
            <ApprovePopup
              canApprove={onV1 && audioAllOk && hasV1}
              onApprove={doApprove}
              onNeedsWork={() => { setStatus('needs_work'); setOpenStep(null); }}
              onClose={() => setOpenStep(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Step circle node ───────────────────────────────────────────────────────
function StepNode({ step, isOpen, isCurrent, onClick }) {
  const effectiveState = isOpen ? 'active' : step.state;
  const c = NODE_PALETTE[effectiveState] || NODE_PALETTE.locked;
  const isClickable = step.state !== 'locked';

  return (
    <div onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      cursor: isClickable ? 'pointer' : 'not-allowed',
      userSelect: 'none',
    }} title={step.state === 'locked' ? `${step.label} — complete step ${step.id - 1} first` : step.label}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: c.bg,
        border: `2px solid ${c.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: c.text,
        fontFamily: '"Courier New", monospace',
        boxShadow: isCurrent ? `0 0 12px ${c.border}88` : 'none',
        transition: 'all 0.2s',
        transform: isOpen ? 'scale(1.08)' : 'scale(1)',
      }}>
        {step.state === 'done' ? '✓' : step.state === 'failed' ? '✗' : step.id}
      </div>
      <span style={{
        fontSize: 8, color: c.label,
        letterSpacing: '0.1em', fontWeight: 700,
      }}>
        {step.label}
      </span>
    </div>
  );
}

// ── Step 1: Fork ───────────────────────────────────────────────────────────
function ForkPopup({ product, hasV1, onClose }) {
  const pid = product.productId;
  const lt  = product.legacyType || pid;

  if (hasV1) {
    return (
      <PopupShell step={1} title="FORK" subtitle="Engine V1 registered ✓" onClose={onClose}>
        <CheckRow ok>engine_v1 variant found in registry.js</CheckRow>
        <CheckRow ok>Ready to run parity checks — click step 2</CheckRow>
      </PopupShell>
    );
  }

  return (
    <PopupShell step={1} title="FORK" subtitle="Register a frozen v1 snapshot — 3 edits in your editor" onClose={onClose}>
      <p style={P}>These are <em>code edits</em>. Make them in your editor, then reload — this step turns green automatically.</p>

      <StepLabel>1 · Copy the engine file</StepLabel>
      <Code>{`cp src/${pid}/${lt}Engine.js src/${pid}/${lt}Engine.v1.js`}</Code>

      <StepLabel>2 · Rename the export in the copy</StepLabel>
      <Code>{`// in ${lt}Engine.v1.js — change:
export async function create${cap(lt)}Engine(ctx) { … }
// to:
export async function create${cap(lt)}EngineV1(ctx) { … }`}</Code>

      <StepLabel>3 · Register it in registry.js</StepLabel>
      <p style={P}>In <Mono>src/migration/registry.js</Mono>, find the <Mono>{pid}</Mono> block and add a <Mono>v1</Mono> entry to <Mono>variants</Mono>:</p>
      <Code>{`v1: {
  version:       'v1',
  displayLabel:  VERSION_LABELS.v1,
  component:     ${cap(lt)}Orb,          // same UI
  componentName: '${cap(lt)}Orb',
  engineFactory: create${cap(lt)}EngineV1,
  engineName:    '${lt}Engine.v1',
},`}</Code>

      <StepLabel>4 · Stub the spec file</StepLabel>
      <p style={P}>Create <Mono>src/{pid}/CONFORMANCE.md</Mono> (even empty is fine — fill it in during audio QC).</p>

      <p style={{ ...P, color: '#ffc840', marginTop: 10 }}>↻ Reload after all 4 edits. Step 1 turns green and step 2 unlocks.</p>
    </PopupShell>
  );
}

// ── Step 2: Parity ─────────────────────────────────────────────────────────
function ParityPopup({ parityRows, parityAllOk, hasV1, onV1, onSwitchToV1, onPass, onClose }) {
  const failCount = parityRows.filter(r => r.state === 'fail').length;
  return (
    <PopupShell step={2} title="PARITY" subtitle="Every contract method from prototype must exist on v1" onClose={onClose}>

      {!onV1 && hasV1 && (
        <div style={{
          marginBottom: 14, padding: '9px 13px',
          background: 'rgba(255,200,50,0.08)', border: '1px solid rgba(255,200,50,0.25)',
          borderRadius: 5, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: '#ffc840', fontSize: 11 }}>
            Switch to ENGINE V1 — checks run against the live engine.
          </span>
          <button onClick={onSwitchToV1} style={actionBtn('primary')}>→ SWITCH TO V1</button>
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: '18px 1fr auto',
        gap: '6px 12px', alignItems: 'start', marginBottom: 14,
      }}>
        {parityRows.map((r, i) => {
          const g  = r.state === 'ok' ? '✓' : r.state === 'fail' ? '✗' : '–';
          const gc = r.state === 'ok' ? '#60c878' : r.state === 'fail' ? '#d86868' : '#4a5870';
          return (
            <React.Fragment key={i}>
              <span style={{ color: gc, fontWeight: 700, fontSize: 13 }}>{g}</span>
              <span style={{ color: r.state === 'na' ? '#4a5870' : '#b0bcc8', fontSize: 11,
                fontStyle: r.state === 'na' ? 'italic' : 'normal' }}>{r.label}</span>
              <span style={{ color: gc, fontSize: 10, textAlign: 'right', whiteSpace: 'nowrap' }}>{r.detail}</span>
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: failCount > 0 ? '#d86868' : '#60c878', fontSize: 11 }}>
          {failCount > 0
            ? `${failCount} check${failCount > 1 ? 's' : ''} failing — fix in the engine file, then reload`
            : 'All checks passing ✓'}
        </span>
        <button onClick={onPass} disabled={!parityAllOk || !onV1}
          style={actionBtn(parityAllOk && onV1 ? 'ok' : 'disabled')}>
          PARITY PASSED → AUDIO QC
        </button>
      </div>
    </PopupShell>
  );
}

// ── Step 3: Audio QC ───────────────────────────────────────────────────────
function AudioPopup({ audioChecks, onCheck, audioAllOk, onOpenQc, onNeedsWork, onPass, onClose }) {
  return (
    <PopupShell step={3} title="AUDIO QC" subtitle="Open the drawer, sweep everything, tick each task" onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <button onClick={onOpenQc} style={{ ...actionBtn('primary'), fontSize: 12, padding: '8px 18px' }}>
          ▸ OPEN QC DRAWER
        </button>
        <span style={{ ...P, display: 'inline', marginLeft: 12, verticalAlign: 'middle' }}>
          Analyzer + all sliders are inside the drawer.
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
        {AUDIO_TASKS.map(task => (
          <label key={task.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            cursor: 'pointer', padding: '6px 10px',
            background: audioChecks[task.id] ? 'rgba(40,80,50,0.25)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${audioChecks[task.id] ? 'rgba(96,200,120,0.25)' : 'rgba(255,255,255,0.05)'}`,
            borderRadius: 4, transition: 'all 0.15s',
          }}>
            <input type="checkbox"
              checked={!!audioChecks[task.id]}
              onChange={e => onCheck(task.id, e.target.checked)}
              style={{ width: 15, height: 15, marginTop: 1, accentColor: '#60c878', cursor: 'pointer', flexShrink: 0 }}
            />
            <span style={{ color: audioChecks[task.id] ? '#60c878' : '#8a9aaa', fontSize: 11, lineHeight: 1.5 }}>
              {task.label}
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onNeedsWork} style={actionBtn('warn')}>✗ NEEDS WORK</button>
        <button onClick={onPass} disabled={!audioAllOk}
          style={actionBtn(audioAllOk ? 'ok' : 'disabled')}>
          {audioAllOk ? 'AUDIO PASSED → APPROVE' : `TICK ALL ${AUDIO_TASKS.length} TASKS TO CONTINUE`}
        </button>
      </div>
    </PopupShell>
  );
}

// ── Step 4: Approve ────────────────────────────────────────────────────────
function ApprovePopup({ canApprove, onApprove, onNeedsWork, onClose }) {
  return (
    <PopupShell step={4} title="APPROVE" subtitle="Ship engine_v1 as the default for this product" onClose={onClose}>
      <p style={P}>Parity is clean. Audio QC passed.</p>
      <p style={P}>
        Once approved, the non-QC plugin menu loads engine_v1 for this product.
        The legacy variant stays available for any saved sessions that pinned it.
      </p>
      {!canApprove && (
        <p style={{ ...P, color: '#ffc840' }}>Make sure the variant dropdown on the strip is set to ENGINE V1 before approving.</p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
        <button onClick={onNeedsWork} style={actionBtn('warn')}>✗ NEEDS WORK — SEND BACK</button>
        <button onClick={onApprove} disabled={!canApprove}
          style={actionBtn(canApprove ? 'ok' : 'disabled')}>
          ✓ APPROVE ENGINE V1
        </button>
      </div>
    </PopupShell>
  );
}

// ── Chrome helpers ─────────────────────────────────────────────────────────

function PopupShell({ step, title, subtitle, children, onClose }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <span style={{ color: '#4a7ab0', fontSize: 10, fontWeight: 700 }}>STEP {step}</span>
        <span style={{ color: '#dde6ee', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}>{title}</span>
        <span style={{ color: '#4a5870', fontSize: 10 }}>{subtitle}</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }}>✕</button>
      </div>
      {children}
    </div>
  );
}

function CheckRow({ ok, children }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 11, marginBottom: 5 }}>
      <span style={{ color: ok ? '#60c878' : '#d86868', fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
      <span style={{ color: '#8a9aaa' }}>{children}</span>
    </div>
  );
}

function StepLabel({ children }) {
  return (
    <p style={{ color: '#7ab8e8', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      margin: '10px 0 4px' }}>
      {children}
    </p>
  );
}

function Code({ children }) {
  return (
    <pre style={{
      background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 4, padding: '9px 13px',
      fontSize: 10, color: '#7ab8e8',
      fontFamily: '"Courier New", monospace',
      whiteSpace: 'pre-wrap', marginBottom: 8, lineHeight: 1.65,
    }}>{children}</pre>
  );
}

function Mono({ children }) {
  return <span style={{ fontFamily: '"Courier New", monospace', color: '#7ab8e8', fontSize: 10 }}>{children}</span>;
}

const P = { color: '#7a8a9a', fontSize: 11, marginBottom: 8, lineHeight: 1.55, margin: '0 0 8px' };

const ghostBtn = {
  cursor: 'pointer', padding: '3px 9px',
  background: 'transparent',
  color: 'rgba(190,205,220,0.50)',
  border: '1px solid rgba(255,255,255,0.11)',
  borderRadius: 3,
  fontFamily: '"Courier New", monospace',
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
};

function actionBtn(tone) {
  const P = {
    primary:  { fg: '#b8d8ff', bg: 'rgba(30,70,140,0.55)', bd: 'rgba(100,160,255,0.5)' },
    ok:       { fg: '#60c878', bg: 'rgba(15,70,35,0.55)',  bd: 'rgba(96,200,120,0.5)'  },
    warn:     { fg: '#e08878', bg: 'rgba(90,25,25,0.50)',  bd: 'rgba(220,136,120,0.5)' },
    disabled: { fg: '#364050', bg: 'rgba(15,18,24,0.50)',  bd: 'rgba(50,60,75,0.4)'    },
  };
  const c = P[tone] || P.primary;
  return {
    cursor: tone === 'disabled' ? 'not-allowed' : 'pointer',
    padding: '6px 14px',
    background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
    borderRadius: 3,
    fontFamily: '"Courier New", monospace',
    fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
  };
}

// capitalise first letter of a camelCase or kebab identifier
function cap(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
