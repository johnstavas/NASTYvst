// BrickZoomView — Step 1 of sandbox core (see memory/sandbox_core_scope.md).
//
// This is the "zoomed-in" view of a single brick. In v1 every brick is
// still a hand-coded worklet, so this view shows an honest placeholder
// explaining that the brick's internal graph hasn't been published to
// the sandbox yet. The *interaction pattern* is what matters at this
// stage — double-click brick → canvas swaps to this view → back button
// returns to chain. Audio behavior is 100% unchanged.
//
// Step 2 will replace the placeholder body with an actual op-graph
// canvas once the op registry + graph.json + first sandbox-native brick
// exist. Nothing else in this component should need to change at that
// point beyond swapping <PlaceholderBody/> for <OpGraphCanvas/>.

import React, { useEffect, useMemo, useState } from 'react';
import OpGraphCanvas from './sandbox/OpGraphCanvas';
import { getMockGraphForBrick } from './sandbox/mockGraphs';
import {
  getLiveGraph, subscribeLiveGraph, getLiveSetParam,
  getEditLayout, setEditOverride, commitEditLayout, subscribeEditLayout,
} from './sandbox/liveGraphStore';
import { OPS, getOp } from './sandbox/opRegistry';
import { validateGraph, SCHEMA_VERSION } from './sandbox/validateGraph';

/** Type → display label. Mirrors the inline lookup in main.jsx chain-pill
 *  rendering. Kept local for now — will move to a shared util when the
 *  sandbox op registry lands. */
const BRICK_LABELS = {
  amp: 'Amp', distortion: 'Distortion', modulation: 'Modulation', vocal: 'Vocal',
  mixbus: 'Mix Bus', reverb: 'Reverb', scope: 'Scope', neve: '1073 Neve',
  iron1073: 'Iron 1073', nastyneve: 'Nasty Neve', tape: '424 Tape',
  spring: 'Wabble Spring', spring2: 'Spring Reverb', eightOhEight: '808 Kick',
  lofiLoofy: 'Lofi Loofy', flapjackman: 'Flap Jack Man', tapedelay: 'Tape Delay',
  analogglue: 'Analog Glue', la2a: 'LA-2A', shagatron: 'Shagatron',
  flanger: 'Flanger', phaser: 'Phaser', gluesmash: 'GlueSmash',
  bassmind: 'BassMind', echoform: 'EchoForm', drift: 'Drift',
  ampless: 'Ampless', finisher: 'Finisher', reactor: 'Reactor',
  splitdrive: 'SplitDrive', smoother: 'Smoother', playbox: 'PlayBox',
  pitchshift: 'Pitch Shifter', vocallock: 'VocalLock', deharsh: 'DeHarsh',
  vibemic: 'VibeMic', phraserider: 'PhraseRider', airlift: 'AirLift',
  character: 'CharacterBox', gravity: 'Gravity', focusreverb: 'Focus Reverb',
  nearfar: 'Near/Far', morphreverb: 'MorphReverb',
  transientreverb: 'TransientVerb', smear: 'Smear', orbit: 'Orbit',
  platex: 'Plate-X', reverbbus: 'ReverbBus', drumbus: 'Panther Buss',
  manchild: 'ManChild', simplereverb: 'Simple Reverb',
  sandboxToy:   'SandboxToy',
  filterFx:     'FilterFX',
  echoformLite: 'EchoformLite',
  modDuck:      'ModDuck',
};

const brickLabel = (type) => BRICK_LABELS[type] || type || 'Unknown';

/** The placeholder body shown for every brick that has no mock graph yet. */
function PlaceholderBody({ instance }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 18, padding: '64px 32px',
      minHeight: 360,
      color: 'rgba(255,255,255,0.45)',
      textAlign: 'center',
    }}>
      {/* Stylized "closed brick" glyph — three stacked rounded boxes */}
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none"
           style={{ opacity: 0.35 }}>
        <rect x="8"  y="10" width="48" height="12" rx="3"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
        <rect x="8"  y="26" width="48" height="12" rx="3"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
        <rect x="8"  y="42" width="48" height="12" rx="3"
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
      </svg>

      <div style={{
        fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.55)', fontWeight: 600,
      }}>
        Opaque brick
      </div>

      <div style={{
        fontSize: 13, lineHeight: 1.6, maxWidth: 520,
        color: 'rgba(255,255,255,0.45)',
      }}>
        <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{brickLabel(instance.type)}</strong>{' '}
        is a hand-coded brick. Its internal DSP graph hasn't been published
        to the sandbox yet, so there's nothing to show inside here.
      </div>

      <div style={{
        fontSize: 10, lineHeight: 1.5, maxWidth: 460,
        color: 'rgba(255,255,255,0.3)',
        padding: '10px 14px', borderRadius: 6,
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed rgba(255,255,255,0.08)',
      }}>
        Future work: once this brick is decomposed into ops (delay · feedback ·
        tone filter · mix · …) you'll see and rewire its internal graph right
        here. Track progress in <code>memory/sandbox_core_scope.md</code>.
      </div>

      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          // Back-nav is driven by the parent via Esc or the breadcrumb;
          // expose a secondary button here for discoverability.
          window.dispatchEvent(new CustomEvent('brick-zoom:close'));
        }}
        style={{
          marginTop: 4,
          fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
          fontWeight: 600,
          padding: '8px 18px', borderRadius: 6,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.65)',
          cursor: 'pointer',
        }}>
        ← Back to chain
      </button>
    </div>
  );
}

/** Op palette — visible parts bin next to the graph. Read-only for now
 *  (authoring mutation lands with Step 2d / the real graph-editing pass);
 *  this just makes the full op catalog visible when the user zooms into
 *  a brick so they can see what's available. Highlights ops already
 *  present in the current graph. */
function OpPalette({ graph }) {
  const inUse = new Set((graph?.nodes || []).map(n => n.op));
  const entries = Object.values(OPS);
  return (
    <div style={{
      width: 200, flexShrink: 0,
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(0,0,0,0.25)',
      display: 'flex', flexDirection: 'column',
      maxHeight: 520, overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px',
        fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.45)', fontWeight: 700,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Op Palette</span>
        <span style={{
          fontSize: 7, letterSpacing: '0.18em',
          padding: '2px 5px', borderRadius: 3,
          color: 'rgba(255,200,120,0.7)',
          background: 'rgba(255,200,120,0.08)',
          border: '1px solid rgba(255,200,120,0.18)',
        }}>read-only</span>
      </div>
      <div style={{ overflow: 'auto', padding: '6px 0' }}>
        {entries.map(op => {
          const used = inUse.has(op.id);
          const nIn  = op.ports.inputs.length;
          const nOut = op.ports.outputs.length;
          return (
            <div key={op.id}
              title={op.description}
              style={{
                padding: '8px 12px',
                borderLeft: used ? '2px solid rgba(127,255,143,0.6)' : '2px solid transparent',
                background: used ? 'rgba(127,255,143,0.04)' : 'transparent',
                cursor: 'default',
              }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 6,
                fontSize: 11, fontWeight: 600,
                color: used ? 'rgba(127,255,143,0.9)' : 'rgba(255,255,255,0.75)',
              }}>
                {op.label}
                <span style={{
                  fontSize: 8, letterSpacing: '0.1em',
                  color: 'rgba(255,255,255,0.3)', fontWeight: 400,
                }}>
                  {nIn}→{nOut}
                </span>
              </div>
              <div style={{
                fontSize: 9, lineHeight: 1.4, marginTop: 2,
                color: 'rgba(255,255,255,0.38)',
              }}>
                {op.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** T6 Validate-IR strip — shown below the op-graph canvas.
 *
 *  Surfaces the same rule output that validateGraphLoud prints to the console
 *  at module load and that the three scripts/check_*.mjs harnesses gate CI on.
 *  When a graph is green we render a tiny single-line confirmation; when red
 *  we expand and enumerate every error / warning inline so the authoring loop
 *  is "edit graph → see rule output" without leaving the zoom view.
 *
 *  This is the QC-rack-side of T6. Rule bodies live in validateGraph.js; this
 *  component is purely a surface.
 *
 *  STAGE-2D NOTE: sandbox_core_scope.md DoD requires T6 to "run on every
 *  graph mutation." Today the graph is read-only, so this useMemo on the
 *  zoom view plus module-load validateGraphLoud in mockGraphs.js cover both
 *  paths. When Stage 2d lands in-canvas drag/wire authoring, the validator
 *  must ALSO fire from the authoring action (op insert, wire connect, param
 *  edit) — not just when the zoom view happens to be mounted. Re-check this
 *  doctrine before shipping Stage 2d. */
function ValidationPanel({ graph }) {
  const result = useMemo(() => {
    try { return validateGraph(graph); }
    catch (err) { return { ok: false, errors: [`validator threw: ${err.message}`], warnings: [] }; }
  }, [graph]);
  const { ok, errors, warnings } = result;

  const tone = ok
    ? (warnings.length === 0 ? 'green' : 'amber')
    : 'red';
  const PAL = {
    green: { accent: 'rgba(127,255,143,0.75)', bg: 'rgba(127,255,143,0.04)', border: 'rgba(127,255,143,0.2)' },
    amber: { accent: 'rgba(255,200,120,0.85)', bg: 'rgba(255,200,120,0.04)', border: 'rgba(255,200,120,0.22)' },
    red:   { accent: 'rgba(255,130,130,0.9)',  bg: 'rgba(255,110,110,0.05)', border: 'rgba(255,110,110,0.28)' },
  }[tone];

  const summary = ok
    ? `PASS · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
    : `FAIL · ${errors.length} error${errors.length === 1 ? '' : 's'} · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;

  return (
    <div style={{
      borderTop: `1px solid ${PAL.border}`,
      background: PAL.bg,
      padding: '8px 14px 10px',
      fontFamily: 'Courier New, monospace',
      fontSize: 11, lineHeight: 1.55,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        color: PAL.accent, fontWeight: 600, letterSpacing: '0.16em',
        textTransform: 'uppercase', fontSize: 9,
      }}>
        <span>T6 · Validate IR</span>
        <span style={{
          padding: '1px 6px', borderRadius: 3,
          background: 'rgba(255,255,255,0.04)',
          color: 'rgba(255,255,255,0.55)', letterSpacing: '0.12em',
        }}>schema v{SCHEMA_VERSION}</span>
        <span style={{ flex: 1 }} />
        <span style={{ letterSpacing: '0.1em', color: PAL.accent }}>{summary}</span>
      </div>
      {(errors.length > 0 || warnings.length > 0) && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {errors.map((e, i) => (
            <div key={`e${i}`} style={{ color: 'rgba(255,150,150,0.95)' }}>
              <span style={{ opacity: 0.6 }}>error ·</span> {e}
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w${i}`} style={{ color: 'rgba(255,210,140,0.9)' }}>
              <span style={{ opacity: 0.6 }}>warn  ·</span> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** SaveControls — small inline header strip showing the dirty indicator
 *  and a SAVE button that snapshots the current edit layout into the
 *  store's `committed` slot. Shows a brief "saved" flash on click.
 *
 *  Future: SAVE will also push the layout into the brick's persistent
 *  state via onStateChange so it survives full app reload. For now it
 *  commits to the in-session store only — close/reopen still preserves,
 *  but a hard page refresh resets to the original mockGraph layout. */
function SaveControls({ instanceId }) {
  const [layout, setLayout] = useState(() => getEditLayout(instanceId));
  const [flash,  setFlash]  = useState(null); // 'saved' | null
  useEffect(() => {
    const unsub = subscribeEditLayout(instanceId, setLayout);
    setLayout(getEditLayout(instanceId));
    return unsub;
  }, [instanceId]);

  const dirty = !!layout?.dirty;
  const hasEdits = layout && (
    Object.keys(layout.nodes || {}).length > 0 ||
    Object.keys(layout.terminals || {}).length > 0 ||
    Object.keys(layout.overrides || {}).length > 0
  );

  const onSave = (e) => {
    e.stopPropagation();
    commitEditLayout(instanceId);
    setFlash('saved');
    setTimeout(() => setFlash(null), 1100);
  };

  if (!hasEdits && !flash) return null;

  return (
    <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* Dirty indicator */}
      {dirty && !flash && (
        <span style={{
          fontSize: 8, letterSpacing: '0.22em',
          padding: '2px 6px', borderRadius: 3,
          color: 'rgba(255,160,90,0.85)',
          background: 'rgba(255,160,90,0.08)',
          border: '1px solid rgba(255,160,90,0.25)',
        }}>
          unsaved
        </span>
      )}
      {/* "Saved" flash */}
      {flash === 'saved' && (
        <span style={{
          fontSize: 8, letterSpacing: '0.22em',
          padding: '2px 6px', borderRadius: 3,
          color: 'rgba(127,255,143,0.85)',
          background: 'rgba(127,255,143,0.08)',
          border: '1px solid rgba(127,255,143,0.3)',
        }}>
          ✓ saved
        </span>
      )}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onSave}
        disabled={!dirty}
        style={{
          fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
          padding: '4px 10px', borderRadius: 3,
          background: dirty ? 'rgba(127,255,143,0.14)' : 'rgba(255,255,255,0.04)',
          border: dirty
            ? '1px solid rgba(127,255,143,0.5)'
            : '1px solid rgba(255,255,255,0.1)',
          color: dirty ? 'rgba(127,255,143,0.95)' : 'rgba(255,255,255,0.3)',
          cursor: dirty ? 'pointer' : 'default',
          letterSpacing: '0.22em',
        }}
      >
        Save
      </button>
    </span>
  );
}

/** Body picker. Subscribes to the live-graph store for sandbox-native
 *  bricks so the view re-renders when the parent's knobs move. Falls
 *  back to the static mock for hand-coded bricks (or the opaque
 *  placeholder when no mock exists). Graph view gets the op palette;
 *  opaque-brick view doesn't (nothing to highlight against).
 *
 *  Now also supports per-node click-to-edit: clicking a node opens
 *  NodeDetailPanel showing all the op's params with sliders. Slider
 *  changes dispatch live setParam through liveGraphStore — bypasses
 *  the brick's panel knobs entirely (parameters can be tweaked even
 *  if no knob is mapped to them). */
function ZoomBody({ instance }) {
  const [liveGraph, setLive] = useState(() => getLiveGraph(instance.id));
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  useEffect(() => {
    const unsub = subscribeLiveGraph(instance.id, setLive);
    setLive(getLiveGraph(instance.id));
    return unsub;
  }, [instance.id]);

  // Clear selection when switching bricks.
  useEffect(() => { setSelectedNodeId(null); }, [instance.id]);

  const graph = liveGraph || getMockGraphForBrick(instance.type);
  if (!graph) return <PlaceholderBody instance={instance} />;

  const selectedNode = selectedNodeId
    ? graph.nodes.find(n => n.id === selectedNodeId)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <OpGraphCanvas
            graph={graph}
            instanceId={instance.id}
            selectedNodeId={selectedNodeId}
            onNodeClick={setSelectedNodeId}
          />
        </div>
        {selectedNode ? (
          <NodeDetailPanel
            instanceId={instance.id}
            node={selectedNode}
            panel={graph.panel}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : (
          <OpPalette graph={graph} />
        )}
      </div>
      <ValidationPanel graph={graph} />
    </div>
  );
}

/** NodeDetailPanel — opens when a node is clicked. Shows the op's full
 *  params list (per opRegistry) with sliders that dispatch live setParam
 *  on the brick's compiled engine via getLiveSetParam(instanceId).
 *
 *  Param value display reads from `node.params` — which is the live-graph
 *  mirror, not the static template. So when a knob on the parent brick
 *  moves and the live-graph re-publishes, we see the updated values here.
 *
 *  Direct setParam from this panel does NOT update the parent brick's
 *  knobs — it's a separate authoring channel. Closing the panel and then
 *  moving a parent knob will overwrite our edits because the knob's
 *  mapping reasserts. That's the right behavior for v1 — if user wants
 *  per-node persistence they save the modified graph as a new brick.
 *  Tracked in qc_backlog. */
function NodeDetailPanel({ instanceId, node, onClose, panel }) {
  const opDef = getOp(node.op);
  const setParam = getLiveSetParam(instanceId);

  // Per-node param overrides live in the editLayout store (persist
  // across close/reopen). We mirror them in local state so React
  // re-renders on each slider tweak.
  const [overrides, setOverrides] = useState(() => {
    const layout = getEditLayout(instanceId);
    return layout?.overrides?.[node.id] || {};
  });

  // Re-load overrides when the user selects a different node.
  useEffect(() => {
    const layout = getEditLayout(instanceId);
    setOverrides(layout?.overrides?.[node.id] || {});
  }, [instanceId, node.id]);

  // Subscribe to external layout changes (e.g., "reset" wiping overrides).
  useEffect(() => {
    if (!instanceId) return;
    const unsub = subscribeEditLayout(instanceId, (layout) => {
      if (!layout) return;
      setOverrides(layout.overrides?.[node.id] || {});
    });
    return unsub;
  }, [instanceId, node.id]);

  // On mount, replay the persisted overrides into the audio engine via
  // setParam. This handles the case: user opens inside-view, edits a
  // param, closes, opens again — the audio should match what the slider
  // shows. Without this replay, the audio engine forgets between opens.
  useEffect(() => {
    if (!setParam) return;
    const layout = getEditLayout(instanceId);
    const myOv = layout?.overrides?.[node.id];
    if (!myOv) return;
    for (const [paramId, value] of Object.entries(myOv)) {
      try { setParam(node.id, paramId, value); } catch {}
    }
    // intentionally only on (instanceId, node.id) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, node.id]);

  if (!opDef) {
    return (
      <div style={panelShellStyle}>
        <PanelHeader node={node} opDef={null} onClose={onClose} />
        <div style={{ padding: '16px', color: 'rgba(255,140,140,0.8)', fontSize: 11 }}>
          Unknown op <code>{node.op}</code> — not in registry.
        </div>
      </div>
    );
  }

  const params = opDef.params || [];

  // Build a quick index: paramId → panel knob that drives this node.paramId.
  // Used to label each ParamRow with "driven by knob X" so the user knows
  // their direct edit will fight the panel knob.
  const knobIndex = {};
  if (panel?.knobs) {
    for (const k of panel.knobs) {
      for (const m of k.mappings || []) {
        if (m.nodeId === node.id) {
          if (!knobIndex[m.paramId]) knobIndex[m.paramId] = [];
          knobIndex[m.paramId].push(k);
        }
      }
    }
  }

  return (
    <div style={panelShellStyle}>
      <PanelHeader node={node} opDef={opDef} onClose={onClose} />

      {!setParam && (
        <div style={{
          margin: '10px 12px', padding: '8px 10px', borderRadius: 4,
          background: 'rgba(255,200,120,0.06)',
          border: '1px solid rgba(255,200,120,0.2)',
          fontSize: 10, lineHeight: 1.5,
          color: 'rgba(255,210,150,0.85)',
        }}>
          Read-only — this brick doesn't expose live setParam yet.
        </div>
      )}

      {params.length === 0 && (
        <div style={{ padding: '16px', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          No params — this op has fixed behavior.
        </div>
      )}

      <div style={{ padding: '6px 12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {params.map(p => {
          const hasOverride = Object.prototype.hasOwnProperty.call(overrides, p.id);
          const liveValue = hasOverride
            ? overrides[p.id]
            : (node.params?.[p.id] ?? p.default);
          const drivers = knobIndex[p.id] || [];
          return (
            <ParamRow key={p.id}
              param={p}
              value={liveValue}
              drivers={drivers}
              onChange={(v) => {
                setOverrides(prev => ({ ...prev, [p.id]: v }));
                // Push to live audio engine.
                if (setParam) setParam(node.id, p.id, v);
                // Persist into editLayout store (auto-save).
                if (instanceId) setEditOverride(instanceId, node.id, p.id, v);
              }}
              disabled={!setParam}
            />
          );
        })}
      </div>
    </div>
  );
}

const panelShellStyle = {
  width: 280, flexShrink: 0,
  borderLeft: '1px solid rgba(255,255,255,0.07)',
  background: 'rgba(10,14,18,0.55)',
  display: 'flex', flexDirection: 'column',
  fontFamily: 'Inter, system-ui, sans-serif',
};

function PanelHeader({ node, opDef, onClose }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{
          fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase',
          color: 'rgba(255,213,106,0.85)', fontWeight: 700,
        }}>
          Edit node
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.92)',
          marginTop: 2,
        }}>
          {opDef?.label ?? node.op}
        </div>
        <div style={{
          fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 1,
          fontFamily: 'Courier New, monospace',
        }}>
          {node.id}
        </div>
      </div>
      <button onClick={onClose}
        style={{
          fontSize: 14, padding: '2px 8px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 3,
          color: 'rgba(255,255,255,0.6)',
          cursor: 'pointer', lineHeight: 1,
        }}>×</button>
    </div>
  );
}

function ParamRow({ param, value, drivers, onChange, disabled }) {
  const isEnum   = param.type === 'enum';
  const isNumber = !isEnum;
  const hasDrivers = Array.isArray(drivers) && drivers.length > 0;

  // Format the displayed value. Use the registry-supplied format() if
  // present, otherwise a sensible default.
  const display = (() => {
    if (isEnum) return String(value);
    if (typeof param.format === 'function') {
      try { return param.format(value); }
      catch { return String(value); }
    }
    if (typeof value === 'number') {
      return param.unit ? `${value.toFixed(2)} ${param.unit}` : value.toFixed(3);
    }
    return String(value);
  })();

  return (
    <div style={{ opacity: disabled ? 0.55 : 1 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.7)',
        marginBottom: 4, fontWeight: 600,
      }}>
        <span>{param.label || param.id}</span>
        <span style={{
          fontVariantNumeric: 'tabular-nums',
          color: 'rgba(255,213,106,0.85)',
          fontFamily: 'Courier New, monospace',
          fontSize: 10,
          letterSpacing: 0,
        }}>
          {display}
        </span>
      </div>

      {isNumber && (
        <input
          type="range"
          min={param.min ?? 0}
          max={param.max ?? 1}
          step={param.step ?? ((param.max ?? 1) - (param.min ?? 0)) / 1000}
          value={typeof value === 'number' ? value : (param.default ?? 0)}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            width: '100%',
            accentColor: 'rgba(255,213,106,0.85)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      )}

      {isEnum && (
        <select
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', padding: '4px 6px',
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.85)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 3,
            fontSize: 11,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}>
          {(param.options || []).map(o => (
            <option key={o.value} value={o.value}
              style={{ background: '#1a1f25' }}>
              {o.label || o.value}
            </option>
          ))}
        </select>
      )}

      {param.min != null && param.max != null && isNumber && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 8, color: 'rgba(255,255,255,0.3)',
          marginTop: 1, fontFamily: 'Courier New, monospace',
        }}>
          <span>{param.min}</span>
          <span>{param.max}</span>
        </div>
      )}

      {hasDrivers && (
        <div style={{
          marginTop: 6,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'rgba(180,235,200,0.95)',
        }}>
          <span style={{ marginRight: 4, opacity: 0.7 }}>◀</span>
          driven by panel knob{drivers.length > 1 ? 's' : ''}: {' '}
          <span style={{ color: 'rgba(220,250,230,1)', fontWeight: 700 }}>
            {drivers.map(d => d.label || d.id).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

export default function BrickZoomView({ instance, onClose }) {
  // Esc closes the zoom view. Also listen for the custom event fired by the
  // placeholder's back button so the button doesn't need to know about
  // onClose prop wiring.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onEvt = () => onClose?.();
    window.addEventListener('keydown', onKey);
    window.addEventListener('brick-zoom:close', onEvt);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('brick-zoom:close', onEvt);
    };
  }, [onClose]);

  if (!instance) return null;

  return (
    <div style={{
      // Wide canvas — bricks will get dense once they have 10+ ops.
      // Bumped from 1400 → 1760 to fit the wider amp/tape graph layouts
      // alongside the 280px NodeDetailPanel side panel without clipping.
      width: '100%', maxWidth: 1760,
      margin: '0 auto',
      borderRadius: 12,
      background: 'rgba(10,14,18,0.85)',
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
      boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
    }}>
      {/* Breadcrumb header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            }}
            style={{
              fontSize: 10, letterSpacing: '0.22em', fontWeight: 600,
              color: 'rgba(255,255,255,0.6)',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              cursor: 'pointer',
              padding: '4px 10px',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'all 0.12s',
            }}
            title="Back to chain (Esc)"
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>←</span>
            Chain
          </button>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>›</span>
          <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
            {brickLabel(instance.type)}
          </span>
          <span style={{
            marginLeft: 8, fontSize: 8, letterSpacing: '0.22em',
            padding: '2px 6px', borderRadius: 3,
            color: 'rgba(255,200,120,0.75)',
            background: 'rgba(255,200,120,0.08)',
            border: '1px solid rgba(255,200,120,0.2)',
          }}>
            inside view · preview
          </span>
          <SaveControls instanceId={instance.id} />
        </div>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          className="w-5 h-5 rounded-full text-[11px]"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.55)',
            cursor: 'pointer',
          }}
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      {/* Body — op-graph mock if we've drawn one for this brick type,
          otherwise the opaque-brick placeholder. When the real Step 2
          pipeline lands, both branches collapse into <OpGraphCanvas/>
          driven by graph.json. */}
      <ZoomBody instance={instance} />
    </div>
  );
}
