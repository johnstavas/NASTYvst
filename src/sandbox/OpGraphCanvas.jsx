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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getOp, primaryParamDisplay, enumParamDisplay } from './opRegistry';
import {
  getEditLayout,
  setEditNodePos,
  setEditTerminalPos,
  subscribeEditLayout,
} from './liveGraphStore';

// Node footprint sized to fit existing graph layouts (most graphs space
// nodes 120px apart). Title bar + 2-line body + port markers all fit in
// 120×80 with a touch of breathing room. Wider nodes were tried at 140
// and bumped into adjacent neighbors — slimmed back to 120.
const DEFAULT_NODE_W = 120;
const DEFAULT_NODE_H = 78;
const TITLE_BAR_H    = 22;
const PORT_RADIUS    = 4;

// Subtle muted accent — same tone as the breadcrumb highlight in
// BrickZoomView so the zoom view reads as one coherent surface.
const ACCENT = '#e7d19b';
const FEEDBACK_COLOR = 'rgba(255,160,90,0.55)';
const WIRE_COLOR     = 'rgba(231,209,155,0.55)';
// Control-rate signals (Stage B-0 ModDuck) render in violet to distinguish
// from audio signal flow. Same "modulation" palette used by ModDuckOrb.
const CONTROL_COLOR  = 'rgba(196,164,255,0.7)';

// Port colors — DaVinci-Resolve style: green for inputs, blue for outputs.
const INPUT_COLOR    = 'rgba(127,255,143,0.95)';
const OUTPUT_COLOR   = 'rgba(120,200,255,0.95)';
const CTL_PORT_COLOR = 'rgba(196,164,255,0.95)';

/** Compute the relative (x,y) of a port within its node, given the
 *  port's index in the inputs[] or outputs[] array and the total count.
 *  Inputs land on the LEFT edge, outputs on the RIGHT, distributed
 *  evenly inside the body region (below the title bar). */
function portRelPos(side, idx, total, node) {
  const w = node.w || DEFAULT_NODE_W;
  const h = node.h || DEFAULT_NODE_H;
  const bodyTop    = TITLE_BAR_H;
  const bodyBottom = h;
  const bodyH      = bodyBottom - bodyTop;
  // Stack ports evenly inside the body region.
  const step = bodyH / (total + 1);
  const y = bodyTop + step * (idx + 1);
  const x = side === 'in' ? 0 : w;
  return { x, y };
}

/** Find a port by ref (e.g. "n_mix.wet" → wet input on n_mix) and return
 *  absolute graph-coord (cx, cy) on the node's edge. Falls back to
 *  default-side midpoint if port not found. */
function pointFor(graph, idRef, which /* 'out' | 'in' */) {
  const [id, portId] = String(idRef).split('.');
  const term = graph.terminals.find(t => t.id === id);
  if (term) return { cx: term.x + 6, cy: term.y };
  const node = graph.nodes.find(n => n.id === id);
  if (!node) return { cx: 0, cy: 0 };

  const w = node.w || DEFAULT_NODE_W;
  const opDef = getOp(node.op);
  const ports = (which === 'in' ? opDef?.ports?.inputs : opDef?.ports?.outputs) || [];

  // Find the indexed port. If portId given, match by id; otherwise pick
  // the first audio port (or first port if no audio).
  let idx = -1;
  if (portId) {
    idx = ports.findIndex(p => p.id === portId);
  }
  if (idx < 0) {
    idx = ports.findIndex(p => p.kind === 'audio');
    if (idx < 0) idx = 0;
  }
  if (ports.length === 0) {
    // Old-fashioned fallback: side midpoint.
    const h = node.h || DEFAULT_NODE_H;
    return { cx: which === 'in' ? node.x : node.x + w, cy: node.y + h / 2 };
  }

  const rel = portRelPos(which, idx, ports.length, node);
  return { cx: node.x + rel.x, cy: node.y + rel.y };
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

function OpNode({ node, selected, onClick, drivingKnobs, onDragStart, consumeDragMoved }) {
  const w = node.w || DEFAULT_NODE_W;
  const h = node.h || DEFAULT_NODE_H;
  const opDef = getOp(node.op);
  const labelText = opDef?.label ?? node.op;
  const enumText  = enumParamDisplay(node);
  const valueText = primaryParamDisplay(node);
  const hasEnum = enumText != null;
  const hasKnob = Array.isArray(drivingKnobs) && drivingKnobs.length > 0;

  const inputs  = opDef?.ports?.inputs  || [];
  const outputs = opDef?.ports?.outputs || [];

  // DaVinci Resolve-ish color treatment:
  //   - Title bar darker (a band across the top)
  //   - Body slightly lighter
  //   - Selection: red-orange outline (Resolve uses red on the selected node)
  const strokeColor = selected ? '#ff8a4a' : 'rgba(120,135,150,0.7)';
  const strokeWidth = selected ? 2 : 1;
  const titleFill   = 'rgba(38,44,52,0.96)';
  const bodyFill    = 'rgba(26,30,36,0.96)';

  const handleClick = (e) => {
    e.stopPropagation();
    if (consumeDragMoved && consumeDragMoved()) return;
    if (!onClick) return;
    onClick(node.id);
  };
  const handleMouseDown = (e) => {
    e.stopPropagation();
    if (onDragStart) onDragStart(node.id, e);
  };

  const knobTitle = hasKnob
    ? `Driven by panel knob${drivingKnobs.length > 1 ? 's' : ''}: ${drivingKnobs.map(k => k.label || k.id).join(' · ')}`
    : null;

  return (
    <g transform={`translate(${node.x}, ${node.y})`}
       onMouseDown={handleMouseDown}
       onClick={handleClick}
       style={{ cursor: onDragStart ? 'grab' : (onClick ? 'pointer' : 'default') }}>
      {knobTitle && <title>{knobTitle}</title>}

      {/* Outer body card */}
      <rect width={w} height={h} rx="4"
            fill={bodyFill}
            stroke={strokeColor} strokeWidth={strokeWidth} />

      {/* Title bar — darker band across the top */}
      <rect width={w} height={TITLE_BAR_H} rx="4"
            fill={titleFill} />
      {/* Cover the bottom rounded corners of the title bar so it joins the body cleanly */}
      <rect y={TITLE_BAR_H - 4} width={w} height="4"
            fill={titleFill} />
      {/* Hairline separator between title and body */}
      <line x1="0" y1={TITLE_BAR_H} x2={w} y2={TITLE_BAR_H}
            stroke="rgba(0,0,0,0.5)" strokeWidth="0.7" />

      {/* Title text — op label */}
      <text x={w / 2} y={TITLE_BAR_H - 7} textAnchor="middle"
            fontSize="10.5" fontWeight="700"
            fill="rgba(255,255,255,0.92)"
            style={{ letterSpacing: '0.08em', pointerEvents: 'none' }}>
        {labelText}
      </text>

      {/* Body content: enum subtitle (if present) + primary value */}
      {hasEnum && (
        <text x={w / 2} y={TITLE_BAR_H + 16} textAnchor="middle"
              fontSize="9" fill="rgba(255,255,255,0.55)"
              style={{ letterSpacing: '0.16em', textTransform: 'uppercase', pointerEvents: 'none' }}>
          {enumText}
        </text>
      )}
      {valueText != null && (
        <text x={w / 2} y={hasEnum ? TITLE_BAR_H + 36 : TITLE_BAR_H + 28} textAnchor="middle"
              fontSize="11" fontWeight="600"
              fill={selected ? '#ffd56a' : ACCENT} opacity="0.95"
              style={{ letterSpacing: '0.06em', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>
          {valueText}
        </text>
      )}

      {/* Footer strip with node id (small, dim) */}
      <text x={8} y={h - 5} textAnchor="start"
            fontSize="7.5" fill="rgba(255,255,255,0.28)"
            style={{ letterSpacing: '0.1em', fontFamily: 'Courier New, monospace', pointerEvents: 'none' }}>
        {node.id}
      </text>

      {/* "K" badge for knob-driven nodes */}
      {hasKnob && (
        <g transform={`translate(${w - 12}, ${h - 11})`} pointerEvents="none">
          <rect x="-7" y="-7" width="14" height="14" rx="2"
                fill="rgba(127,255,143,0.18)"
                stroke="rgba(127,255,143,0.7)" strokeWidth="0.7" />
          <text x="0" y="2.5" textAnchor="middle"
                fontSize="8" fontWeight="700"
                fill="rgba(127,255,143,0.95)"
                style={{ letterSpacing: '0.04em' }}>
            K
          </text>
        </g>
      )}

      {/* Input port markers — left edge, green triangles pointing right */}
      {inputs.map((p, i) => {
        const rel = portRelPos('in', i, inputs.length, node);
        const color = p.kind === 'control' ? CTL_PORT_COLOR : INPUT_COLOR;
        return (
          <g key={`in-${p.id}`} transform={`translate(${rel.x}, ${rel.y})`} pointerEvents="none">
            <title>{`in: ${p.id} (${p.kind || 'audio'})`}</title>
            {/* Triangle pointing right (►) */}
            <path d="M -5 -4 L 1 0 L -5 4 Z"
                  fill={color}
                  stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />
          </g>
        );
      })}

      {/* Output port markers — right edge, blue squares */}
      {outputs.map((p, i) => {
        const rel = portRelPos('out', i, outputs.length, node);
        const color = p.kind === 'control' ? CTL_PORT_COLOR : OUTPUT_COLOR;
        return (
          <g key={`out-${p.id}`} transform={`translate(${rel.x}, ${rel.y})`} pointerEvents="none">
            <title>{`out: ${p.id} (${p.kind || 'audio'})`}</title>
            <rect x="-1" y="-3.5" width="6" height="7" rx="1"
                  fill={color}
                  stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />
          </g>
        );
      })}
    </g>
  );
}

function TerminalDot({ terminal, onDragStart, consumeDragMoved }) {
  // Match the per-node port colors so the eye reads the chain end-to-end
  // as one consistent pipe: input terminals = green (like input ports),
  // output terminals = blue (like output ports).
  const color = terminal.kind === 'input' ? INPUT_COLOR : OUTPUT_COLOR;
  const draggable = !!onDragStart;

  const handleMouseDown = (e) => {
    if (!draggable) return;
    e.stopPropagation();
    onDragStart(terminal.id, e);
  };
  const handleClick = (e) => {
    e.stopPropagation();
    if (consumeDragMoved) consumeDragMoved();
  };

  return (
    <g transform={`translate(${terminal.x}, ${terminal.y})`}
       onMouseDown={handleMouseDown}
       onClick={handleClick}
       style={{ cursor: draggable ? 'grab' : 'default' }}>
      {/* Larger invisible hit-area so the user can grab the terminal
          without needing pixel-perfect aim on the ring. */}
      <circle cx="0" cy="0" r="14" fill="transparent" />
      <circle cx="0" cy="0" r="7" fill="rgba(20,24,30,0.95)"
              stroke={color} strokeWidth="1.6" />
      <circle cx="0" cy="0" r="3" fill={color} opacity="0.85" />
      <text x="0" y="22" textAnchor="middle"
            fontSize="8" fill="rgba(255,255,255,0.55)"
            fontWeight="700"
            style={{ letterSpacing: '0.22em', textTransform: 'uppercase', pointerEvents: 'none' }}>
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

export default function OpGraphCanvas({ graph, instanceId, selectedNodeId, onNodeClick }) {
  if (!graph) return null;
  const { width, height } = graph.canvas || { width: 720, height: 340 };
  const gridId = `opgraph-grid-${graph.id}`;

  // ── Per-node + per-terminal position overrides ─────────────────────────
  // Persisted across close/reopen of the inside-view via the editLayout
  // map in liveGraphStore (keyed by instanceId). Cleared explicitly via
  // a "Reset" action — closing the modal does NOT discard.
  const initLayout = instanceId ? getEditLayout(instanceId) : null;
  const [nodePositions, setNodePositions]         = useState(() => initLayout?.nodes     || {});
  const [terminalPositions, setTerminalPositions] = useState(() => initLayout?.terminals || {});

  // Subscribe to external updates (e.g., Save button might trigger a
  // re-snapshot, or another panel could modify the layout).
  useEffect(() => {
    if (!instanceId) return;
    const unsub = subscribeEditLayout(instanceId, (layout) => {
      if (!layout) return;
      setNodePositions(layout.nodes || {});
      setTerminalPositions(layout.terminals || {});
    });
    return unsub;
  }, [instanceId]);

  // When the underlying brick (instanceId) changes, re-init from the
  // store. Don't wipe — just reload from whatever's already stored.
  useEffect(() => {
    if (!instanceId) {
      setNodePositions({});
      setTerminalPositions({});
      return;
    }
    const layout = getEditLayout(instanceId);
    setNodePositions(layout?.nodes || {});
    setTerminalPositions(layout?.terminals || {});
  }, [instanceId, graph.id]);
  const effectivePos = (n) => {
    const o = nodePositions[n.id];
    return o ? { ...n, x: o.x, y: o.y } : n;
  };
  const effectiveTerminalPos = (t) => {
    const o = terminalPositions[t.id];
    return o ? { ...t, x: o.x, y: o.y } : t;
  };
  // Build a graph mirror with effective positions for wire/feedback math.
  const effGraph = useMemo(() => ({
    ...graph,
    nodes:     (graph.nodes     || []).map(effectivePos),
    terminals: (graph.terminals || []).map(effectiveTerminalPos),
  }), [graph, nodePositions, terminalPositions]);

  // ── Pan / zoom on the SVG viewBox ─────────────────────────────────────
  // Wheel zooms (toward cursor); left-drag on empty area pans the canvas.
  // Drag on a node moves that node. FIT recomputes a fit-to-content box.
  //
  // FIT-TO-CONTENT (vs fit-to-canvas): the canvas.{width,height} declared
  // in mockGraphs is just a working area — actual nodes occupy a much
  // smaller bbox. Zooming to canvas wastes most of the SVG on empty
  // space. We compute the union bbox of node rects + a margin so nodes
  // fill the viewport at a comfortable scale.
  const svgRef = useRef(null);
  const computeFitBox = (g) => {
    const nodes = (g.nodes || []).map(effectivePos);
    if (nodes.length === 0) return { x: 0, y: 0, w: width, h: height };
    let minX =  Infinity, minY =  Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const nw = n.w || DEFAULT_NODE_W;
      const nh = n.h || DEFAULT_NODE_H;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + nw > maxX) maxX = n.x + nw;
      if (n.y + nh > maxY) maxY = n.y + nh;
    }
    // Include the IN/OUT terminals so they're visible too.
    for (const t of (g.terminals || [])) {
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x > maxX) maxX = t.x;
      if (t.y > maxY) maxY = t.y;
    }
    // Padding so nothing kisses the edge — generous since the SVG is
    // letterbox-fit and extra margin reads as breathing room.
    const padX = 100;
    const padY = 80;
    return {
      x: minX - padX,
      y: minY - padY,
      w: (maxX - minX) + padX * 2,
      h: (maxY - minY) + padY * 2,
    };
  };
  const [vb, setVb] = useState(() => computeFitBox(graph));
  useEffect(() => { setVb(computeFitBox(graph)); }, [graph.id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // drag.current = { mode: 'pan'|'node', ... }
  const drag = useRef(null);

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

  // Pan-drag start — fires from empty SVG area. Node mousedown stops
  // propagation and uses startNodeDrag instead.
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    drag.current = {
      mode: 'pan',
      startX: e.clientX, startY: e.clientY,
      vbX: vb.x, vbY: vb.y,
    };
    e.preventDefault();
  };

  // Node-drag start — called from OpNode's mousedown. Records the node's
  // current position so onMouseMove can apply the screen→graph delta.
  const startNodeDrag = (nodeId, e) => {
    if (e.button !== 0) return;
    const n = (graph.nodes || []).find(x => x.id === nodeId);
    if (!n) return;
    const eff = effectivePos(n);
    drag.current = {
      mode: 'node',
      nodeId,
      startX: e.clientX, startY: e.clientY,
      nodeX: eff.x, nodeY: eff.y,
      moved: false,
    };
    e.preventDefault();
  };

  // Terminal-drag start — called from TerminalDot's mousedown. Same
  // mechanic as node-drag but writes to terminalPositions instead.
  const startTerminalDrag = (terminalId, e) => {
    if (e.button !== 0) return;
    const t = (graph.terminals || []).find(x => x.id === terminalId);
    if (!t) return;
    const eff = effectiveTerminalPos(t);
    drag.current = {
      mode: 'terminal',
      terminalId,
      startX: e.clientX, startY: e.clientY,
      tX: eff.x, tY: eff.y,
      moved: false,
    };
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    const dx = dxScreen * (vb.w / rect.width);
    const dy = dyScreen * (vb.h / rect.height);

    if (d.mode === 'pan') {
      const vbX = d.vbX;
      const vbY = d.vbY;
      setVb(v => ({ ...v, x: vbX - dx, y: vbY - dy }));
      return;
    }
    if (d.mode === 'node') {
      // Track whether the user actually moved (so a click-without-drag
      // still triggers selection rather than being eaten).
      if (Math.abs(dxScreen) > 2 || Math.abs(dyScreen) > 2) d.moved = true;
      const nodeId = d.nodeId;
      const nx = d.nodeX + dx;
      const ny = d.nodeY + dy;
      setNodePositions(prev => ({ ...prev, [nodeId]: { x: nx, y: ny } }));
      // Auto-save to store (session-scope, persists across close/reopen).
      if (instanceId) setEditNodePos(instanceId, nodeId, nx, ny);
      return;
    }
    if (d.mode === 'terminal') {
      if (Math.abs(dxScreen) > 2 || Math.abs(dyScreen) > 2) d.moved = true;
      const tId = d.terminalId;
      const nx = d.tX + dx;
      const ny = d.tY + dy;
      setTerminalPositions(prev => ({ ...prev, [tId]: { x: nx, y: ny } }));
      if (instanceId) setEditTerminalPos(instanceId, tId, nx, ny);
    }
  };
  // After mouseup we remember if the most-recent node/terminal drag
  // actually moved — so OpNode/TerminalDot's onClick (which fires AFTER
  // mouseup) can suppress the click when it was actually a drag.
  const dragWasMoveRef = useRef(false);
  const onMouseUp = () => {
    const d = drag.current;
    dragWasMoveRef.current = !!(d && (d.mode === 'node' || d.mode === 'terminal') && d.moved);
    drag.current = null;
  };
  const onMouseLeave = onMouseUp;
  const consumeDragMoved = () => {
    const wasMove = dragWasMoveRef.current;
    dragWasMoveRef.current = false;
    return wasMove;
  };

  const resetView = () => setVb(computeFitBox(graph));

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
           preserveAspectRatio="xMidYMid meet"
           style={{
             display: 'block',
             // Fixed height so the canvas doesn't collapse to a thin
             // strip when the EDIT panel opens, and stays the same size
             // across bricks regardless of canvas.height in the graph.
             // 65vh feels right — leaves room for breadcrumb + legend +
             // validation panel without the SVG dominating the screen.
             height: 'clamp(420px, 65vh, 760px)',
             cursor: drag.current ? 'grabbing' : 'grab',
             touchAction: 'none',
             background: 'rgba(8,11,15,0.45)',
           }}>
        <defs>
          <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none"
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
          {/* Coarser secondary grid every 120 — gives a sense of scale
              when zoomed out, like Resolve / Figma / draw.io. */}
          <pattern id={`${gridId}-coarse`} width="120" height="120" patternUnits="userSpaceOnUse">
            <path d="M 120 0 L 0 0 0 120" fill="none"
                  stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          </pattern>
        </defs>
        {/* Grid is sized HUGE — feels like an infinite canvas you can
            pan around and drag nodes into freely. Centered roughly on
            the original canvas so panning in any direction still shows
            the pattern. */}
        <rect x={-2000} y={-1500} width={Math.max(width, 6000)} height={Math.max(height, 4500)}
              fill={`url(#${gridId})`} />
        <rect x={-2000} y={-1500} width={Math.max(width, 6000)} height={Math.max(height, 4500)}
              fill={`url(#${gridId}-coarse)`} />

        <text x="24" y="32" fontSize="9" fill="rgba(255,255,255,0.35)"
              style={{ letterSpacing: '0.28em', textTransform: 'uppercase' }}>
          Signal graph
        </text>
        <text x="24" y="50" fontSize="8" fill="rgba(255,255,255,0.22)"
              style={{ letterSpacing: '0.18em' }}>
          Drag empty area to pan · drag node to move · click to edit · scroll to zoom
        </text>

        {/* Feedback arcs first — they sit behind node labels.
            Use effGraph so arcs follow dragged nodes. */}
        {(effGraph.feedback || []).map((fb, i) => {
          const pts = feedbackPoints(effGraph, fb);
          if (!pts) return null;
          return (
            <FeedbackArc key={`fb-${i}`}
              x1={pts.from.cx} y1={pts.from.cy}
              x2={pts.to.cx}   y2={pts.to.cy}
            />
          );
        })}
        {(effGraph.feedback || []).map((fb, i) => (
          <FeedbackLabel key={`fbl-${i}`} fb={fb} graph={effGraph} />
        ))}

        {/* Signal-path wires (audio solid, control dotted-violet).
            Use effGraph so wires follow dragged nodes. */}
        {(effGraph.wires || []).map((w, i) => {
          const p1 = pointFor(effGraph, w.from, 'out');
          const p2 = pointFor(effGraph, w.to,   'in');
          const ctl = isControlWire(effGraph, w);
          return <WirePath key={`w-${i}`}
            x1={p1.cx} y1={p1.cy} x2={p2.cx} y2={p2.cy}
            color={ctl ? CONTROL_COLOR : WIRE_COLOR}
            dashed={ctl} />;
        })}

        {/* Terminals — draggable, same mechanic as nodes. */}
        {(effGraph.terminals || []).map(t => (
          <TerminalDot key={t.id} terminal={t}
            onDragStart={startTerminalDrag}
            consumeDragMoved={consumeDragMoved}
          />
        ))}

        {/* Nodes — draggable + clickable. Use effGraph.nodes so a node
            renders at its dragged position. */}
        {(() => {
          const nodeKnobs = new Map();
          for (const k of (graph.panel?.knobs) || []) {
            for (const m of k.mappings || []) {
              if (!m.nodeId) continue;
              const arr = nodeKnobs.get(m.nodeId) || [];
              if (!arr.includes(k)) arr.push(k);
              nodeKnobs.set(m.nodeId, arr);
            }
          }
          return (effGraph.nodes || []).map(n => (
            <OpNode key={n.id}
              node={n}
              selected={n.id === selectedNodeId}
              onClick={onNodeClick}
              drivingKnobs={nodeKnobs.get(n.id)}
              onDragStart={startNodeDrag}
              consumeDragMoved={consumeDragMoved}
            />
          ));
        })()}
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
