// OpQcView.jsx — per-op verification panel.
// Picks an op, loads its declared spec, runs the browser metric live,
// renders charts + plain-English explanations + pass/fail.
// This is the heart of the per-op verification flow (Phase A3 of op-qc-rig).

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { runBrowserMetric } from './behavioral/runBrowserMetric.js';
import { getSpec } from './behavioral/specs.browser.js';
import { useVerificationLedger, getOpVerification, gatesPassed, statusEmoji,
         recordSignoff, clearSignoff } from './opVerificationLedger.js';
import OpQcChart from './OpQcChart.jsx';
import OpListenPanel from './OpListenPanel.jsx';

const STATUS_COLOR = {
  '✅': '#5ed184',
  '🟢': '#5ed184',
  '🟡': '#e5b85a',
  '🚧': '#d99fcf',
  '⬜': 'rgba(255,255,255,0.25)',
};

const GATE_DEFS = [
  { key: 'worklet',    label: 'Worklet',     desc: 'JS reference exists and is real (not a TODO stub).' },
  { key: 'cpp',        label: 'C++',         desc: 'C++ port exists and is real (not zero-fill).' },
  { key: 'smoke',      label: 'Smoke graph', desc: 'Single-op test fixture exists in test/fixtures/codegen/.' },
  { key: 't1_t7',      label: 'T1–T7',       desc: 'JS-side validation rules pass (DC rejection, denormal, FB safety).' },
  { key: 'parity',     label: 'T8 parity',   desc: 'Compiled C++ output matches JS within tolerance, sample-by-sample.' },
  { key: 'behavioral', label: 'T8-B',        desc: 'Declared audio behavior (e.g. attack T90, threshold) matches measurement.' },
  { key: 'listen',     label: 'Listen',      desc: 'Stav personally heard it in a session and signed off.' },
];

export default function OpQcView({ opId, onClose, onSignOff }) {
  const { ledger } = useVerificationLedger();
  const opRecord = useMemo(() => getOpVerification(ledger, opId), [ledger, opId]);
  const spec = useMemo(() => getSpec(opId), [opId]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [signing, setSigning] = useState(false);

  const runBehavioral = useCallback(async () => {
    if (!spec) {
      setError(`No declared behavioral spec for "${opId}" yet. Add one in src/sandbox/behavioral/specs/.`);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await runBrowserMetric(opId, spec);
      setResult(r);
    } catch (e) {
      setError(e.message + '\n\n' + (e.stack || ''));
    } finally {
      setRunning(false);
    }
  }, [opId, spec]);

  // Auto-run when opId changes — gives instant feedback.
  useEffect(() => { runBehavioral(); }, [runBehavioral]);

  const emoji = statusEmoji(opRecord);
  const passed = opRecord ? gatesPassed(opRecord) : 0;
  const behavioralGreen = result?.summary.verdict === 'PASS';
  // Sign-off is gated on: structural gates (worklet/cpp/smoke/t1_t7/parity)
  // are green on disk, AND the live behavioral run we just watched passed.
  // We don't require disk-gate-6 (behavioral) because that's exactly what
  // the live run is providing right now — disk hasn't caught up yet, but the
  // user just watched the proof pass on screen.
  const structuralGates = opRecord?.gates ? (
    !!opRecord.gates.worklet && !!opRecord.gates.cpp && !!opRecord.gates.smoke &&
    !!opRecord.gates.t1_t7 && !!opRecord.gates.parity
  ) : false;
  const allAutoGreen = structuralGates && behavioralGreen;

  return (
    <div style={{
      width: '100%', padding: '24px 32px 80px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      {/* Header */}
      <div style={{
        width: '100%', maxWidth: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18,
      }}>
        <div>
          <div style={{
            fontSize: 10, letterSpacing: '0.32em', textTransform: 'uppercase',
            color: '#d99fcf', fontWeight: 700, marginBottom: 6,
          }}>
            Op verification · Per-op view
          </div>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            fontSize: 28, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
          }}>
            <span style={{ fontSize: 22, color: STATUS_COLOR[emoji] }}>{emoji}</span>
            <code style={{ fontFamily: 'monospace' }}>{opId}</code>
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 400,
            }}>
              · {passed}/7 gates · category: <code>{spec?.category || '—'}</code>
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
            fontWeight: 600, padding: '8px 16px', borderRadius: 6,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
          }}
          title="Back to ledger"
        >
          ← Back to ledger
        </button>
      </div>

      {/* Gate strip */}
      <div style={{
        width: '100%', maxWidth: 1100,
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 16,
      }}>
        {GATE_DEFS.map(g => {
          const value = opRecord?.gates?.[g.key];
          const on = !!value && value !== false;
          const isListen = g.key === 'listen';
          return (
            <div key={g.key} style={{
              padding: '10px 12px', borderRadius: 6,
              background: on ? 'rgba(94,209,132,0.10)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${on ? 'rgba(94,209,132,0.45)' : 'rgba(255,255,255,0.1)'}`,
            }}>
              <div style={{
                fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
                color: on ? '#5ed184' : 'rgba(255,255,255,0.45)', fontWeight: 700,
                marginBottom: 4,
              }}>{on ? '✓' : '·'} {g.label}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>
                {isListen && value ? `signed off: ${value}` : g.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* TLDR — what this op sounds like, one human-readable sentence.
          Shown prominently above the technical spec block so anyone scanning
          knows what to listen for before reading the math. */}
      {spec?.tldr && (
        <div style={{
          width: '100%', maxWidth: 1100,
          padding: '12px 16px', marginBottom: 14, borderRadius: 6,
          background: 'rgba(217,159,207,0.08)',
          border: '1px solid rgba(217,159,207,0.35)',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 13, lineHeight: 1.5,
        }}>
          <span style={{
            fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#d99fcf', fontWeight: 700, marginRight: 10,
          }}>What it does</span>
          {spec.tldr}
        </div>
      )}

      {/* Spec block */}
      {spec && (
        <div style={{
          width: '100%', maxWidth: 1100,
          padding: 14, marginBottom: 16, borderRadius: 6,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.5)', marginBottom: 6, fontWeight: 700,
          }}>Declared behavior</div>
          <pre style={{
            margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.75)',
            fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{JSON.stringify({
            category: spec.category,
            defaultParams: spec.defaultParams,
            declared: spec.declared,
          }, (k, v) => typeof v === 'function' ? v.toString() : v, 2)}</pre>
        </div>
      )}

      {/* Run controls */}
      <div style={{
        width: '100%', maxWidth: 1100, display: 'flex', gap: 10,
        marginBottom: 16, alignItems: 'center',
      }}>
        <button
          onClick={runBehavioral}
          disabled={running || !spec}
          style={{
            fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
            fontWeight: 700, padding: '10px 18px', borderRadius: 6,
            background: running ? 'rgba(255,255,255,0.1)' : 'rgba(94,209,132,0.15)',
            border: `1px solid ${running ? 'rgba(255,255,255,0.2)' : 'rgba(94,209,132,0.5)'}`,
            color: running ? 'rgba(255,255,255,0.5)' : '#5ed184',
            cursor: running ? 'wait' : 'pointer',
          }}
        >
          {running ? '⟳ Running…' : '▶ Run T8-B behavioral'}
        </button>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          Worklet arm only (browser). Native parity stays headless.
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          width: '100%', maxWidth: 1100,
          padding: 14, marginBottom: 16, borderRadius: 6,
          background: 'rgba(217,159,207,0.08)',
          border: '1px solid rgba(217,159,207,0.4)',
          color: '#d99fcf', fontSize: 11, fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
        }}>{error}</div>
      )}

      {/* Test results */}
      {result && (
        <div style={{ width: '100%', maxWidth: 1100 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px', marginBottom: 12, borderRadius: 6,
            background: behavioralGreen ? 'rgba(94,209,132,0.08)' : 'rgba(217,159,207,0.08)',
            border: `1px solid ${behavioralGreen ? 'rgba(94,209,132,0.45)' : 'rgba(217,159,207,0.4)'}`,
          }}>
            <span style={{ fontSize: 18 }}>{behavioralGreen ? '✓' : '✗'}</span>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: behavioralGreen ? '#5ed184' : '#d99fcf',
              }}>
                {result.summary.verdict} — {result.summary.passed} of {result.summary.total} tests passed
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                Worklet-arm behavioral run completed.
              </div>
            </div>
          </div>

          {result.tests.map((t, i) => (
            <div key={i} style={{
              padding: 14, marginBottom: 12, borderRadius: 6,
              background: 'rgba(255,255,255,0.02)',
              border: `1px solid ${t.pass ? 'rgba(94,209,132,0.3)' : 'rgba(217,159,207,0.3)'}`,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6,
              }}>
                <span style={{
                  fontSize: 14, color: t.pass ? '#5ed184' : '#d99fcf',
                }}>{t.pass ? '✓' : '✗'}</span>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
                }}>{t.name}</div>
              </div>
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5,
                marginBottom: 8,
              }}>
                {t.explanation}
              </div>

              {/* Declared vs measured */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8,
              }}>
                <div>
                  <div style={{
                    fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase',
                    color: '#5ed184', marginBottom: 4, fontWeight: 700,
                  }}>Declared</div>
                  <pre style={{
                    margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.75)',
                    fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{JSON.stringify(t.declared, null, 2)}</pre>
                </div>
                <div>
                  <div style={{
                    fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase',
                    color: '#d99fcf', marginBottom: 4, fontWeight: 700,
                  }}>Measured</div>
                  <pre style={{
                    margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.75)',
                    fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{JSON.stringify(t.measured, null, 2)}</pre>
                </div>
              </div>

              {t.diagnostic && !t.pass && (
                <div style={{
                  fontSize: 11, color: '#d99fcf', padding: 8, marginTop: 6,
                  background: 'rgba(217,159,207,0.06)', borderRadius: 4,
                  fontFamily: 'monospace',
                }}>{t.diagnostic}</div>
              )}

              {/* Plot */}
              {t.plot && <OpQcChart plot={t.plot} />}
            </div>
          ))}

          {/* Listen panel — actually drives audio through the op so user can hear it.
              For compressor / GR-cell ops, pass a cvPort so the panel also drives a
              4 Hz CV pump (else the cell is silent at cv=0 = unity).
              For analyzer / envelope / gainCurve ops, the output is a control
              signal not audio — pass controlSignalOp=true so the panel shows the
              "listen is informational only" banner. */}
          <OpListenPanel
            opId={opId}
            // listenParams: optional spec override for the listen rig only.
            // Used when defaultParams puts the op at an "off" or inaudible
            // setting (e.g. microDetune cents=0 = no shift; smooth τ=50ms = LP
            // at 3 Hz). Math tests still run at defaultParams; ear-tests use
            // listenParams when present.
            params={spec?.listenParams || spec?.defaultParams || {}}
            defaultPort={
              spec?.category === 'compressor' ? (spec?.declared?.audioPort || 'audio')
              : (spec?.declared?.inputPort || 'in')
            }
            cvPort={
              spec?.category === 'compressor' ? (spec?.declared?.cvPort || 'cv') : null
            }
            cvPumpPeak={(() => {
              const sweep = spec?.declared?.cv_sweep_linear;
              if (!Array.isArray(sweep)) return -12;     // default: VCA convention
              const max = Math.max(...sweep);
              const min = Math.min(...sweep);
              // If the sweep ranges into negatives, this cell uses negative cv (VCA-style).
              if (min < 0) return Math.max(min, -12);
              // Otherwise positive cv = compression depth. Use a peak that gives
              // ~6 dB GR (cv_for_6db_gr if declared, else 1.0).
              return spec?.declared?.cv_for_6db_gr ?? 1.0;
            })()}
            controlSignalOp={
              spec?.controlSignalOp === true ||
              ['analyzer', 'envelope', 'gainCurve'].includes(spec?.category)
            }
          />

          {/* Listen sign-off panel */}
          <div style={{
            padding: 14, marginTop: 16, borderRadius: 6,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)', fontWeight: 700, marginBottom: 8,
            }}>Gate 7 — Listen sign-off</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 10, lineHeight: 1.5 }}>
              Drop the op into a sandbox brick (LAB), play through it with sources you trust,
              and confirm it sounds the way the declared behavior describes. This is the only
              gate that requires your ears — the others are math.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                disabled={!allAutoGreen}
                onClick={() => {
                  // Record sign-off — persists to localStorage, broadcasts to
                  // the ledger hook so all gate views update immediately.
                  const stamp = `JS ${new Date().toISOString().slice(0, 10)}`;
                  recordSignoff(opId, stamp, behavioralGreen);
                  setSigning(true);
                  setTimeout(() => setSigning(false), 1500);
                }}
                title={
                  !structuralGates ? 'Disk-side gates 1–5 must be green before sign-off.' :
                  !behavioralGreen ? 'Behavioral run must pass before sign-off.' :
                  'Record listen sign-off in the ledger (local until disk-write lands)'
                }
                style={{
                  fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
                  fontWeight: 700, padding: '10px 18px', borderRadius: 6,
                  background: allAutoGreen ? 'rgba(94,209,132,0.18)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${allAutoGreen ? 'rgba(94,209,132,0.55)' : 'rgba(255,255,255,0.15)'}`,
                  color: allAutoGreen ? '#5ed184' : 'rgba(255,255,255,0.4)',
                  cursor: allAutoGreen ? 'pointer' : 'not-allowed',
                }}
              >
                ✓ Approve & sign off
              </button>
              {opRecord?.gates?.listen && (
                <span style={{ fontSize: 11, color: '#5ed184', fontFamily: 'monospace' }}>
                  signed off: {opRecord.gates.listen}
                </span>
              )}
              {opRecord?.gates?.listen && (
                <button
                  onClick={() => clearSignoff(opId)}
                  style={{
                    fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase',
                    fontWeight: 600, padding: '6px 10px', borderRadius: 4,
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
                  }}
                  title="Revoke sign-off (local only)"
                >
                  ↶ revoke
                </button>
              )}
              {signing && (
                <span style={{ fontSize: 11, color: '#5ed184', fontWeight: 700,
                  letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  ✓ recorded — gate L now green
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
