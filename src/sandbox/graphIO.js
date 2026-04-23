// Graph IO — Step 2d of sandbox core.
// See memory/sandbox_core_scope.md.
//
// Serialize / deserialize a sandbox graph to a stable JSON form. Round
// trips losslessly: serialize(deserialize(s)) === s after normalization.
//
// What gets serialized:
//   - id, label
//   - canvas { width, height }
//   - terminals[]
//   - nodes[] (id, op, x, y, w?, h?, params)
//   - wires[]
//   - feedback[]
//   - legendOps[] (or legend[] if present)
//
// What does NOT get serialized:
//   - compiled WebAudio nodes (live runtime state — created fresh from JSON)
//   - selection / view state (UI ephemeral)
//
// On import, the graph is run through validateGraph(). Errors throw.
// Warnings are returned alongside the parsed graph so the caller can
// surface them.

import { validateGraph } from './validateGraph';

// Schema version — bump when the shape changes in a non-back-compat way.
// Step 2d ships v1; Step 2c-only graphs without a version are treated as v1.
const SCHEMA_VERSION = 1;

/** Serialize a graph object to a pretty JSON string ready for clipboard
 *  / disk. Stable key order keeps diffs readable. */
export function serializeGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    throw new Error('serializeGraph: expected object, got ' + typeof graph);
  }
  const out = {
    schemaVersion: SCHEMA_VERSION,
    id:    graph.id    ?? null,
    label: graph.label ?? null,
    canvas: graph.canvas
      ? { width: graph.canvas.width, height: graph.canvas.height }
      : { width: 720, height: 340 },
    terminals: (graph.terminals || []).map(t => ({
      id: t.id, kind: t.kind, x: t.x, y: t.y,
    })),
    nodes: (graph.nodes || []).map(n => ({
      id: n.id, op: n.op, x: n.x, y: n.y,
      ...(n.w != null ? { w: n.w } : {}),
      ...(n.h != null ? { h: n.h } : {}),
      params: n.params ? { ...n.params } : {},
    })),
    wires:    (graph.wires    || []).map(w => ({ from: w.from, to: w.to })),
    feedback: (graph.feedback || []).map(f => ({
      from: f.from, to: f.to,
      ...(f.label != null ? { label: f.label } : {}),
      ...(f.value != null ? { value: f.value } : {}),
    })),
    ...(graph.legendOps ? { legendOps: graph.legendOps.slice() } : {}),
    ...(graph.legend    ? { legend:    graph.legend.map(l => ({ ...l })) } : {}),
  };
  return JSON.stringify(out, null, 2);
}

/** Parse + validate a graph from JSON text. Returns { graph, warnings }.
 *  Throws on parse error or validation error. */
export function deserializeGraph(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error('deserializeGraph: invalid JSON — ' + e.message); }

  if (!raw || typeof raw !== 'object') {
    throw new Error('deserializeGraph: parsed value is not an object');
  }
  // Forward compatibility hook — bump SCHEMA_VERSION + add a migrator
  // here when the shape changes.
  const version = raw.schemaVersion ?? 1;
  if (version > SCHEMA_VERSION) {
    throw new Error(`deserializeGraph: schema v${version} newer than supported v${SCHEMA_VERSION}`);
  }

  // Build a normalized graph object — drop any unknown top-level fields
  // and supply defaults where the input was lenient.
  const graph = {
    id:        raw.id    ?? `imported-${Date.now()}`,
    label:     raw.label ?? 'Imported',
    canvas:    raw.canvas    || { width: 720, height: 340 },
    terminals: raw.terminals || [],
    nodes:     raw.nodes     || [],
    wires:     raw.wires     || [],
    feedback:  raw.feedback  || [],
    ...(raw.legendOps ? { legendOps: raw.legendOps } : {}),
    ...(raw.legend    ? { legend:    raw.legend    } : {}),
  };

  const v = validateGraph(graph);
  if (!v.ok) {
    throw new Error('deserializeGraph: validation failed — ' + v.errors.join('; '));
  }
  return { graph, warnings: v.warnings };
}

/** Convenience: clone a graph by round-tripping through serialization.
 *  Used by the undo stack to take immutable snapshots cheaply. */
export function cloneGraph(graph) {
  return JSON.parse(serializeGraph(graph));
}
