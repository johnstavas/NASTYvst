// OpGraphCanvas — Step 2a of sandbox core.
// See memory/sandbox_core_scope.md.
//
// Renders a graph object (see mockGraphs.js for the schema) as an SVG
// canvas showing nodes, wires, feedback arcs, terminals, and a legend.
// This is the rendering half of the IR — the data half is graph.json.
//
// Visually identical to the hand-drawn Echoform mock from Step 1b; that
// SVG is now produced from data instead of being baked into JSX. Proves
// the IR shape end-to-end before any audio wiring lands.
//
// Interaction model: currently read-only. Step 2b adds param typing from
// an op registry; Step 2c adds drag / wire / select for a toy brick.

import React, { useEffect, useRef, useState } from 'react';
import { getOp, primaryParamDisplay, enumParamDisplay } from './opRegistry';

const DEFAULT_NODE_W = 112;
const DEFAULT_NODE_H = 54;

// Subtle muted accent — same tone as the breadcrumb highlight in
// BrickZoomView so the zoom view reads as one coherent surface.
const ACCENT = '#e7d19b';
const FEEDBACK_COLOR = 'rgba(255,160,90,0.55)';
const WIRE_COLOR     = 'rgba(231,209,155,0.4)';
// Control-rate signals (Stage B-0 ModDuck) render in violet to distinguish
// from audio signal flow. Same "modulation" palette used by ModDuckOrb.
const CONTROL_COLOR  = 'rgba(196,164,255,0.65)';

/** Resolve a terminal or node id to { cx, cy } for wire endpoints. */
function pointFor(graph, idRef, which /* 'out' | 'in' */) {
  // Strip optional port suffix (e.g. "n_mix.wet" → "n_mix"). Visual
  // positioning ignores the port for now — Step 2c+ may offset by port.
  const id = String(idRef).split('.')[0];
  const term = graph.terminals.find(t => t.id === id);
  if (term) return { cx: term.x + 6, cy: term.y };
  const node = graph.nodes.find(n => n.id === id);
  if (node) {
    const w = node.w || DEFAULT_NODE_W;
    const h = node.h || DEFAULT_NODE_H;
    return {
      cx: which === 'in' ? node.x : node.x + w,
      cy: node.y + h / 2,
    };
  }
  return { cx: 0, cy: 0 };
}

/** Feedback-specific endpoints: source = tap point (slightly inside/above
 *  the source node's output side); target = aim point at top-center of the
 *  target node. Assumes the feedback flows right→left (i.e. source is
 *  downstream of target in the signal path). */
function feedbackPoints(graph, fb) {
  const src = graph.nodes.find(n => n.id === fb.from);
  const dst = graph.nodes.find(n => n.id === fb.to);
  if (!src || !dst) return null;
  const srcH = src.h || DEFAULT_NODE_H;
  const dstW = dst.w || DEFAULT_NODE_W;
  const dstH = dst.h || DEFAULT_NODE_H;
  return {
    from: { cx: src.x - 6, cy: src.y + srcH / 2 - 12 },
    to:   { cx: dst.x + dstW / 2, cy: dst.y + dstH / 2 - 6 },
  };
}

function OpNode({ node }) {
  const w = node.w || DEFAULT_NODE_W;
  const h = node.h || DEFAULT_NODE_H;
  // Display label + primary param hint come from the op registry so the
  // node face stays in lockstep with the canonical op definition.
  // Layout (top → bottom): op name, optional enum subtitle (e.g. "low-pass"),
  // numeric primary value (e.g. "4.00 kHz"). Falls back gracefully when
  // a node has no enum or no numeric param.
  const opDef = getOp(node.op);
  const labelText = opDef?.label ?? node.op;
  const enumText  = enumParamDisplay(node);
  const valueText = primaryParamDisplay(node);
  // If both lines are present we shift the value down a row.
  const hasEnum = enumText != null;
  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <rect width={w} height={h} rx="6"
            fill="rgba(20,24,30,0.95)"
            stroke={ACCENT} strokeWidth="1" opacity="0.9" />
      <text x={w / 2} y={hasEnum ? 18 : 22} textAnchor="middle"
            fontSize="10" fontWeight="600"
            fill="rgba(255,255,255,0.85)"
            style={{ letterSpacing: '0.05em' }}>
        {labelText}
      </text>
      {hasEnum && (
        <text x={w / 2} y={32} textAnchor="middle"
              fontSize="8.5" fill="rgba(255,255,255,0.55)"
              style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {enumText}
        </text>
      )}
      {valueText != null && (
        <text x={w / 2} y={hasEnum ? 46 : 40} textAnchor="middle"
              fontSize="9" fill={ACCENT} opacity="0.9"
              style={{ letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }}>
          {valueText}
        </text>
      )}
    </g>
  );
}

function TerminalDot({ terminal }) {
  const color = terminal.kind === 'input'
    ? 'rgba(180,220,255,0.9)'
    : 'rgba(180,255,200,0.9)';
  return (
    <g transform={`translate(${terminal.x}, ${terminal.y})`}>
      <circle cx="0" cy="0" r="6" fill="rgba(10,14,18,0.95)"
              stroke={color} strokeWidth="1.5" />
      <circle cx="0" cy="0" r="2.5" fill={color} opacity="0.8" />
      <text x="0" y="22" textAnchor="middle"
            fontSize="8" fill="rgba(255,255,255,0.45)"
            style={{ letterSpacing: '0.22em', textTransform: 'uppercase' }}>
        {terminal.kind === 'input' ? 'IN' : 'OUT'}
      </text>
    </g>
  );
}

/** Zoom helper used by the +/− buttons — zooms about the viewBox center. */
function zoomAt(vb, factor, baseW, baseH) {
  const nextW = Math.min(Math.max(vb.w * factor, 80), baseW * 8);
  const nextH = nextW * (vb.h / vb.w);
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  return { x: cx - nextW / 2, y: cy - nextH / 2, w: nextW, h: nextH };
}

const zoomBtnStyle = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: 'rgba(255,255,255,0.7)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  letterSpacing: '0.1em',
  cursor: 'pointer',
  fontWeight: 600,
};

function WirePath({ x1, y1, x2, y2, color = WIRE_COLOR, width = 1.25, dashed = false }) {
  const dx = Math.max(24, (x2 - x1) * 0.45);
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={width}
               strokeDasharray={dashed ? '4 3' : undefined} />;
}

/** Walk the graph + op registry to decide whether a wire endpoint is
 *  control-rate. A wire is drawn as control if EITHER side resolves to
 *  a `kind: 'control'` port. */
function isControlWire(graph, wire) {
  const sideKind = (ref, which) => {
    const [id, port] = String(ref).split('.');
    if (id === 'in' || id === 'out') return 'audio';
    const node = graph.nodes.find(n => n.id === id);
    if (!node) return 'audio';
    const op = getOp(node.op);
    if (!op) return 'audio';
    const ports = which === 'in' ? op.ports.inputs : op.ports.outputs;
    const p = port
      ? ports.find(pp => pp.id === port)
      : ports.find(pp => pp.kind === 'audio') || ports[0];
    return p?.kind || 'audio';
  };
  return sideKind(wire.from, 'out') === 'control'
      || sideKind(wire.to,   'in')  === 'control';
}

/** Feedback arc — curves up and over from source to target with an
 *  arrowhead at the target. Assumes source is downstream (rightward)
 *  of the target in the signal path. */
function FeedbackArc({ x1, y1, x2, y2, color = FEEDBACK_COLOR }) {
  const peakY = Math.min(y1, y2) - 38;
  const midX  = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${x1} ${peakY}, ${midX} ${peakY - 4}, ${midX} ${peakY} S ${x2} ${peakY}, ${x2} ${y2}`;
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeWidth="1.25"
            strokeDasharray="3 2" />
      {/* Arrowhead pointing down into the target */}
      <path d={`M ${x2 - 3.5} ${y2 - 5} L ${x2} ${y2} L ${x2 + 3.5} ${y2 - 5}`}
            fill="none" stroke={color} strokeWidth="1.25"
            strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Floating label above the feedback arc's apex. */
function FeedbackLabel({ fb, graph }) {
  const pts = feedbackPoints(graph, fb);
  if (!pts) return null;
  const { from, to } = pts;
  const midX = (from.cx + to.cx) / 2;
  const apexY = Math.min(from.cy, to.cy) - 60;
  return (
    <g transform={`translate(${midX}, ${apexY})`}>
      <rect x="-34" y="-12" width="68" height="22" rx="4"
            fill="rgba(10,14,18,0.95)"
            stroke="rgba(255,160,90,0.45)" strokeWidth="1" />
      {fb.label && (
        <text x="0" y="-1" textAnchor="middle"
              fontSize="8" fill="rgba(255,255,255,0.75)" fontWeight="600"
              style={{ letterSpacing: '0.1em' }}>{fb.label}</text>
      )}
      {fb.value && (
        <text x="0" y="9" textAnchor="middle"
              fontSize="9" fill="rgba(255,160,90,0.85)"
              style={{ letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }}>
          {fb.value}
        </text>
      )}
    </g>
  );
}

export default function OpGraphCanvas({ graph }) {
  if (!graph) return null;
  const { width, height } = graph.canvas || { width: 720, height: 340 };
  const gridId = `opgraph-grid-${graph.id}`;

  // ── Pan / zoom on the SVG viewBox ─────────────────────────────────────
  // Wheel zooms (toward cursor); left-drag pans. Reset returns to fit.
  // viewBox state is { x, y, w, h } in graph coordinates.
  const svgRef = useRef(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: width, h: height });
  // Reset whenever the underlying graph changes dimensions.
  useEffect(() => { setVb({ x: 0, y: 0, w: width, h: height }); }, [width, height, graph.id]);

  const drag = useRef(null); // {startX, startY, startVbX, startVbY}

  const screenToGraph = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top)  / rect.height;
    return { x: vb.x + fx * vb.w, y: vb.y + fy * vb.h };
  };

  const onWheel = (e) => {
    e.preventDefault();
    // Zoom factor per notch — feels right at ~1.15
    const zoom = e.deltaY < 0 ? 1 / 1.15 : 1.15;
    const nextW = Math.min(Math.max(vb.w * zoom, 80), width * 8);
    const nextH = nextW * (vb.h / vb.w); // preserve aspect
    const { x: gx, y: gy } = screenToGraph(e.clientX, e.clientY);
    const fx = (gx - vb.x) / vb.w;
    const fy = (gy - vb.y) / vb.h;
    setVb({ x: gx - fx * nextW, y: gy - fy * nextH, w: nextW, h: nextH });
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startY: e.clientY, vbX: vb.x, vbY: vb.y };
    e.preventDefault();
  };
  const onMouseMove = (e) => {
    if (!drag.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dxScreen = e.clientX - drag.current.startX;
    const dyScreen = e.clientY - drag.current.startY;
    // Convert screen-px delta into graph units.
    const dx = dxScreen * (vb.w / rect.width);
    const dy = dyScreen * (vb.h / rect.height);
    setVb(v => ({ ...v, x: drag.current.vbX - dx, y: drag.current.vbY - dy }));
  };
  const onMouseUp   = () => { drag.current = null; };
  const onMouseLeave = onMouseUp;

  const resetView = () => setVb({ x: 0, y: 0, w: width, h: height });

  // Handy zoom % for the on-canvas badge.
  const zoomPct = Math.round((width / vb.w) * 100);

  return (
    <div style={{ padding: '8px 4px 14px', position: 'relative' }}>
      {/* Zoom controls — minimal floating cluster */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 5,
        display: 'flex', gap: 4, alignItems: 'center',
        background: 'rgba(10,14,18,0.7)', backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6, padding: '4px 6px',
        fontSize: 9, letterSpacing: '0.18em',
        color: 'rgba(255,255,255,0.55)', fontFamily: 'system-ui',
      }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>{zoomPct}%</span>
        <button onClick={() => setVb(v => zoomAt(v, 1 / 1.25, width, height))}
                style={zoomBtnStyle}>−</button>
        <button onClick={() => setVb(v => zoomAt(v, 1.25,     width, height))}
                style={zoomBtnStyle}>+</button>
        <button onClick={resetView} style={zoomBtnStyle}>FIT</button>
      </div>
      <svg ref={svgRef}
           width="100%"
           viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
           onWheel={onWheel}
           onMouseDown={onMouseDown}
           onMouseMove={onMouseMove}
           onMouseUp={onMouseUp}
           onMouseLeave={onMouseLeave}
           style={{ display: 'block', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}>
        <defs>
          <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none"
                  stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </pattern>
        </defs>
        {/* Grid sized to the *original* canvas, not the viewBox, so it
            stays visually anchored as the user pans/zooms. */}
        <rect x="0" y="0" width={width} height={height} fill={`url(#${gridId})`} />

        <text x="24" y="32" fontSize="9" fill="rgba(255,255,255,0.35)"
              style={{ letterSpacing: '0.28em', textTransform: 'uppercase' }}>
          Signal graph
        </text>
        <text x="24" y="50" fontSize="8" fill="rgba(255,255,255,0.22)"
              style={{ letterSpacing: '0.18em' }}>
          Drag to pan · scroll to zoom · FIT to reset
        </text>

        {/* Feedback arcs first — they sit behind node labels */}
        {(graph.feedback || []).map((fb, i) => {
          const pts = feedbackPoints(graph, fb);
          if (!pts) return null;
          return (
            <FeedbackArc key={`fb-${i}`}
              x1={pts.from.cx} y1={pts.from.cy}
              x2={pts.to.cx}   y2={pts.to.cy}
            />
          );
        })}
        {(graph.feedback || []).map((fb, i) => (
          <FeedbackLabel key={`fbl-${i}`} fb={fb} graph={graph} />
        ))}

        {/* Signal-path wires (audio solid, control dotted-violet) */}
        {(graph.wires || []).map((w, i) => {
          const p1 = pointFor(graph, w.from, 'out');
          const p2 = pointFor(graph, w.to,   'in');
          const ctl = isControlWire(graph, w);
          return <WirePath key={`w-${i}`}
            x1={p1.cx} y1={p1.cy} x2={p2.cx} y2={p2.cy}
            color={ctl ? CONTROL_COLOR : WIRE_COLOR}
            dashed={ctl} />;
        })}

        {/* Terminals */}
        {(graph.terminals || []).map(t => <TerminalDot key={t.id} terminal={t} />)}

        {/* Nodes */}
        {(graph.nodes || []).map(n => <OpNode key={n.id} node={n} />)}
      </svg>

      {/* Legend strip — one row per op used. Sourced from registry by
          legendOps[]; falls back to inline graph.legend[] if a graph
          provides its own descriptions. */}
      {(() => {
        const rows = (graph.legendOps || [])
          .map(opId => {
            const op = getOp(opId);
            return op ? { op: op.label, description: op.description } : null;
          })
          .filter(Boolean)
          .concat(graph.legend || []);
        if (rows.length === 0) return null;
        return (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(rows.length, 3)}, 1fr)`,
            gap: 8,
            padding: '10px 16px 2px',
            fontSize: 9, color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.08em',
          }}>
            {rows.map((l, i) => (
              <div key={i}>
                <strong style={{ color: 'rgba(255,255,255,0.65)' }}>{l.op}</strong>
                {' — '}{l.description}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
