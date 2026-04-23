// Graph Validator — Step 2b of sandbox core.
// See memory/sandbox_core_scope.md, qc_family_map.md § 1 (T6).
//
// Pure function. Walks a graph object (see mockGraphs.js for the schema)
// and returns { ok, errors[], warnings[] }. No throws. Used by:
//
//   - dev-time console.warn at module load (this file) so authoring-time
//     mistakes are loud during sandbox construction
//   - eventual T6 IR / pre-compile validator (gate before codegen)
//
// Step 2b only enforces what we can with the current registry: op exists,
// params live in the schema, param values fit type/range, terminal/wire
// references resolve. Step 2c will add port-type checks (audio↔audio).
// Step 2d will add cycle/feedback-loop legality once we have an actual
// runtime semantics.

import { getOp } from './opRegistry';

/** Top-level entry point. */
export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  const push = (sev, msg) => (sev === 'error' ? errors : warnings).push(msg);

  if (!graph || typeof graph !== 'object') {
    return { ok: false, errors: ['graph is null/not an object'], warnings: [] };
  }
  if (!graph.id) push('warning', 'graph has no id');
  if (!Array.isArray(graph.nodes))     push('error', 'graph.nodes must be an array');
  if (!Array.isArray(graph.terminals)) push('error', 'graph.terminals must be an array');
  if (!Array.isArray(graph.wires))     push('error', 'graph.wires must be an array');

  if (errors.length) return { ok: false, errors, warnings };

  // --- Build id index for reference checks ---------------------------------
  const ids = new Map(); // id -> 'node' | 'terminal'
  for (const t of graph.terminals) {
    if (!t.id) push('error', `terminal missing id: ${JSON.stringify(t)}`);
    else if (ids.has(t.id)) push('error', `duplicate id: ${t.id}`);
    else ids.set(t.id, 'terminal');
  }
  for (const n of graph.nodes) {
    if (!n.id) push('error', `node missing id: ${JSON.stringify(n)}`);
    else if (ids.has(n.id)) push('error', `duplicate id: ${n.id}`);
    else ids.set(n.id, 'node');
  }

  // --- Per-node op + param validation --------------------------------------
  for (const n of graph.nodes) {
    const op = getOp(n.op);
    if (!op) {
      push('error', `node "${n.id}" uses unknown op "${n.op}"`);
      continue;
    }
    if (n.params) {
      const knownIds = new Set(op.params.map(p => p.id));
      for (const k of Object.keys(n.params)) {
        if (!knownIds.has(k)) {
          push('warning', `node "${n.id}" (op "${n.op}") has unknown param "${k}"`);
        }
      }
      for (const p of op.params) {
        const v = n.params[p.id];
        if (v == null) continue; // missing → use default at runtime
        const err = validateParamValue(p, v);
        if (err) push('error', `node "${n.id}" param "${p.id}": ${err}`);
      }
    }
  }

  // --- Wire / feedback reference checks ------------------------------------
  // Endpoints may be "<id>" or "<id>.<port>". Strip the dotted port for
  // existence checks; the compiler validates port names per-op.
  const refNode = (s) => String(s).split('.')[0];
  for (const w of graph.wires) {
    if (!ids.has(refNode(w.from))) push('error', `wire.from references unknown id "${w.from}"`);
    if (!ids.has(refNode(w.to)))   push('error', `wire.to references unknown id "${w.to}"`);
  }
  for (const fb of (graph.feedback || [])) {
    if (ids.get(fb.from) !== 'node') push('error', `feedback.from must be a node id, got "${fb.from}"`);
    if (ids.get(fb.to)   !== 'node') push('error', `feedback.to must be a node id, got "${fb.to}"`);
  }

  // --- Panel (Step 2e) ----------------------------------------------------
  // Optional. If present: each knob has id/label/default/mappings[].
  // Each mapping points at a real node + that node's op param.
  if (graph.panel) {
    if (!Array.isArray(graph.panel.knobs)) {
      push('error', 'panel.knobs must be an array');
    } else {
      const knobIds = new Set();
      for (const k of graph.panel.knobs) {
        if (!k.id) push('error', `panel knob missing id: ${JSON.stringify(k)}`);
        else if (knobIds.has(k.id)) push('error', `duplicate panel knob id: ${k.id}`);
        else knobIds.add(k.id);
        if (typeof k.default !== 'number' || k.default < 0 || k.default > 1) {
          push('warning', `panel knob "${k.id}" default should be 0..1, got ${k.default}`);
        }
        if (!Array.isArray(k.mappings) || k.mappings.length === 0) {
          push('error', `panel knob "${k.id}" has no mappings`);
          continue;
        }
        for (const m of k.mappings) {
          if (ids.get(m.nodeId) !== 'node') {
            push('error', `panel knob "${k.id}" mapping → unknown node "${m.nodeId}"`);
            continue;
          }
          const node = graph.nodes.find(n => n.id === m.nodeId);
          const op   = getOp(node.op);
          const p    = op?.params.find(p => p.id === m.paramId);
          if (!p) {
            push('error', `panel knob "${k.id}" mapping → op "${node.op}" has no param "${m.paramId}"`);
            continue;
          }
          if (p.type !== 'number') {
            push('error', `panel knob "${k.id}" can only map to number params (op "${node.op}" param "${m.paramId}" is "${p.type}")`);
          }
          if (m.range && (!Array.isArray(m.range) || m.range.length !== 2)) {
            push('error', `panel knob "${k.id}" mapping range must be [min, max]`);
          }
          if (m.curve && !['lin', 'log', 'pow'].includes(m.curve)) {
            push('warning', `panel knob "${k.id}" mapping curve "${m.curve}" unknown — using lin`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateParamValue(p, v) {
  if (p.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `expected finite number, got ${typeof v} (${v})`;
    if (p.min != null && v < p.min) return `${v} < min ${p.min}`;
    if (p.max != null && v > p.max) return `${v} > max ${p.max}`;
    return null;
  }
  if (p.type === 'enum') {
    if (!p.options.some(o => o.value === v)) return `"${v}" not in enum [${p.options.map(o => o.value).join(', ')}]`;
    return null;
  }
  if (p.type === 'bool') {
    if (typeof v !== 'boolean') return `expected boolean, got ${typeof v}`;
    return null;
  }
  return `unknown param type "${p.type}"`;
}

/** Convenience: validate and console.warn in dev. Returns the result so
 *  callers can still react. Safe in prod — silent on success. */
export function validateGraphLoud(graph, source = 'graph') {
  const r = validateGraph(graph);
  if (!r.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[sandbox] ${source} failed validation:`, r.errors);
  }
  if (r.warnings.length) {
    // eslint-disable-next-line no-console
    console.warn(`[sandbox] ${source} warnings:`, r.warnings);
  }
  return r;
}
