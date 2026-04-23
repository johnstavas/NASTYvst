// Graph Validator — Step 2b of sandbox core.
// See memory/sandbox_core_scope.md, qc_family_map.md § 1 (T6).
//
// Pure function. Walks a graph object (the formal shape is in
// ./graph.schema.json — IR v1.0 frozen 2026-04-23) and returns
// { ok, errors[], warnings[] }. No throws. Used by:
//
//   - dev-time console.warn at module load (mockGraphs.js) so authoring-
//     time mistakes are loud during sandbox construction
//   - T6 IR / pre-compile validator (gate before codegen)
//
// What v1.0 enforces (structural + type-level + FB-safety):
//   • T6.SCHEMA_VERSION     — schemaVersion present and equals SCHEMA_VERSION
//   • T6.OP_KNOWN           — op exists in registry
//   • T6.PARAM_KNOWN        — params live in the op's schema
//   • T6.PARAM_RANGE        — param values fit type/range
//   • T6.ID_RESOLVES        — terminal/wire/feedback references resolve
//   • T6.PORT_RESOLVES      — wire endpoints resolve to real ports on real nodes
//   • T6.PORT_KIND_MATCH    — port kinds match (audio↔audio, control↔control)
//   • T6.PANEL_MAPPING      — panel knob mappings point at real (node, numeric param) pairs
//   • T6.TERMINALS_PRESENT  — at least one input and one output terminal exist
//   • T6.ORPHAN_NODE        — every node has at least one wire touching it (warn)
//   • T6.FB_CYCLE_DECLARED  — every wire-graph cycle routes through an `fb` port
//   • T6.FB_DC_TRAP         — every `fb` input has a dcBlock op upstream
//   • T6.FB_SAFETY_NODE     — every `fb` input has a softLimit op upstream
//
// Deferred to later stages (see sandbox_modulation_roadmap.md):
//   • modulation-source DAG legality (Stage-B: signal→param, curves)
//   • capability aggregation (aggregate per-op flags into graph caps)
//   • BPM/host-sync, LFO waveform Bézier curves

import { getOp } from './opRegistry';

/** Frozen IR version. See graph.schema.json. Bump on breaking change. */
export const SCHEMA_VERSION = '1.0';

/** Top-level entry point. */
export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  const push = (sev, msg) => (sev === 'error' ? errors : warnings).push(msg);

  if (!graph || typeof graph !== 'object') {
    return { ok: false, errors: ['graph is null/not an object'], warnings: [] };
  }

  // --- schemaVersion gate (v1.0 freeze) -----------------------------------
  // Missing is a warning (legacy graphs pre-freeze); mismatch is an error
  // since a different major means this validator can't be trusted to cover
  // the consumer's expectations.
  if (graph.schemaVersion == null) {
    push('warning', `graph missing schemaVersion (expected "${SCHEMA_VERSION}") — please add it`);
  } else if (graph.schemaVersion !== SCHEMA_VERSION) {
    push('error', `graph.schemaVersion "${graph.schemaVersion}" does not match validator version "${SCHEMA_VERSION}"`);
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
  // Endpoints may be "<id>" or "<id>.<port>". Bare ids bind to the op's
  // default 'in' / 'out' port. Kind must match across the wire
  // (audio↔audio, control↔control).
  const splitRef = (s) => {
    const [id, port] = String(s).split('.');
    return { id, port };
  };
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));

  // Default-port resolution MUST match compileGraphToWebAudio.js exactly
  // (first audio port, else first port of any kind). Any drift here =
  // validator rejects graphs the compiler happily runs, or vice versa.
  const defaultPortId = (bucket) => {
    const audio = bucket.find(p => p.kind === 'audio');
    return audio ? audio.id : bucket[0]?.id;
  };
  const portKind = (ref, direction) => {
    // direction: 'out' (wire source) or 'in' (wire dest)
    const { id, port } = splitRef(ref);
    const kindFromTerminal = ids.get(id) === 'terminal';
    if (kindFromTerminal) {
      // Terminals are audio-only in v1.0 — no explicit port.
      return 'audio';
    }
    const node = nodeById.get(id);
    if (!node) return null;
    const op = getOp(node.op);
    if (!op) return null;
    const bucket = direction === 'out' ? op.ports.outputs : op.ports.inputs;
    const target = port ?? defaultPortId(bucket);
    const p = bucket.find(pp => pp.id === target);
    if (!p) {
      push('error', `wire references unknown ${direction}-port "${ref}" on op "${node.op}" (available: ${bucket.map(pp => pp.id).join(', ')})`);
      return null;
    }
    return p.kind;
  };

  for (const w of graph.wires) {
    const fromRef = splitRef(w.from);
    const toRef   = splitRef(w.to);
    if (!ids.has(fromRef.id)) { push('error', `wire.from references unknown id "${w.from}"`); continue; }
    if (!ids.has(toRef.id))   { push('error', `wire.to references unknown id "${w.to}"`);   continue; }

    const fromKind = portKind(w.from, 'out');
    const toKind   = portKind(w.to,   'in');
    if (fromKind && toKind && fromKind !== toKind) {
      // In v1.0 the `kind` field is ADVISORY. Web Audio has no real
      // distinction at the node level — detector/lfo outputs declared
      // `control` still emit audio samples at runtime; a `control` input
      // like gain.gainMod is a regular AudioNode input on the node side
      // and only becomes "control" when wired to an AudioParam.
      //
      // Stage-B of the modulation roadmap will introduce proper control-
      // rate typing (separate sample rate, ScriptProcessor-free path).
      // Until then: warn, don't block compilation.
      push('warning', `wire "${w.from}" → "${w.to}" kind mismatch: ${fromKind} → ${toKind} (v1.0 kind is advisory; Stage-B will enforce)`);
    }
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

  // --- T6.TERMINALS_PRESENT -----------------------------------------------
  // A shippable brick needs at least one input and one output terminal —
  // compileGraphToWebAudio + master-worklet codegen both rely on this.
  const termKinds = new Set(graph.terminals.map(t => t.kind));
  if (!termKinds.has('input'))  push('error', 'graph has no input terminal — add a { kind: "input" } to graph.terminals');
  if (!termKinds.has('output')) push('error', 'graph has no output terminal — add a { kind: "output" } to graph.terminals');

  // --- T6.ORPHAN_NODE -----------------------------------------------------
  // Every node should have at least one wire touching it. Warn, don't
  // error — orphans might be mid-edit. But they're dead weight at compile.
  const touched = new Set();
  for (const w of graph.wires) {
    touched.add(splitRef(w.from).id);
    touched.add(splitRef(w.to).id);
  }
  for (const n of graph.nodes) {
    if (!touched.has(n.id)) {
      push('warning', `node "${n.id}" (op "${n.op}") has no wires — orphan, will be ignored at compile`);
    }
  }

  // --- T6.FB_CYCLE_DECLARED -----------------------------------------------
  // Find cycles in the wire graph. Every cycle must route through an `fb`
  // input port — that's how feedback is declared at the schema level. A
  // cycle that closes without any fb-port edge means someone accidentally
  // wired output→input and the compiler would hang/explode at runtime.
  //
  // Algorithm: for each node, DFS forward following wires; if we revisit a
  // node already on the current stack, we have a cycle. Walk the cycle and
  // check whether any edge in it targets a `*.fb` port. If none do, error.
  {
    // Build adjacency with per-edge port info.
    const adj = new Map(); // fromId -> [{ toId, toPort, raw }]
    for (const w of graph.wires) {
      const from = splitRef(w.from);
      const to   = splitRef(w.to);
      if (!adj.has(from.id)) adj.set(from.id, []);
      // Resolve default port for the destination so we can tell if this
      // edge is an fb-port edge. Uses the same rule as the compiler.
      const node = nodeById.get(to.id);
      const op   = node ? getOp(node.op) : null;
      const toPort = to.port ?? (op ? defaultPortId(op.ports.inputs) : null);
      adj.get(from.id).push({ toId: to.id, toPort, raw: `${w.from} → ${w.to}` });
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map([...ids.keys()].map(id => [id, WHITE]));
    const parent = new Map(); // childId -> { fromId, edge }

    const cycles = []; // array of edge-arrays

    function dfs(u) {
      color.set(u, GRAY);
      for (const e of (adj.get(u) || [])) {
        const v = e.toId;
        const cv = color.get(v);
        if (cv === WHITE) {
          parent.set(v, { fromId: u, edge: e });
          dfs(v);
        } else if (cv === GRAY) {
          // Found a back-edge u → v. Reconstruct the cycle: walk parent
          // pointers from u back to v, then add the u→v edge.
          const cycleEdges = [];
          let cur = u;
          while (cur !== v) {
            const p = parent.get(cur);
            if (!p) break;
            cycleEdges.push(p.edge);
            cur = p.fromId;
          }
          cycleEdges.push(e);
          cycles.push(cycleEdges);
        }
      }
      color.set(u, BLACK);
    }

    for (const id of ids.keys()) {
      if (color.get(id) === WHITE) dfs(id);
    }

    const seenCycleKeys = new Set();
    for (const cyc of cycles) {
      // Dedupe rotations of the same cycle
      const key = [...cyc].map(e => e.raw).sort().join('|');
      if (seenCycleKeys.has(key)) continue;
      seenCycleKeys.add(key);

      const hasFbEdge = cyc.some(e => e.toPort === 'fb');
      if (!hasFbEdge) {
        const rendered = cyc.map(e => e.raw).join('  •  ');
        push('error', `undeclared feedback cycle — route this through an \`fb\` input port: ${rendered}`);
      }
    }
  }

  // --- T6.FB_DC_TRAP + T6.FB_SAFETY_NODE ----------------------------------
  // For every wire that targets an `fb` input, the upstream chain feeding
  // that edge must contain a dcBlock AND a softLimit op. This formalizes
  // the FB-safety ship-gate landed 2026-04-23 (EchoformLite Memory Man
  // topology + FdnHall softLimit at T=2.0). Without both guards:
  //   - DC offset from asymmetric saturation self-multiplies through the
  //     loop (dcBlock catches this)
  //   - Pathological input can drive fb_sig beyond safe ring-buffer range
  //     (softLimit catches this)
  //
  // Canon: reverb_engine_architecture.md + ship_blockers.md § "DC rejection
  // under FB" + "feedback runaway guard".
  {
    // Build reverse adjacency for upstream walking.
    const revAdj = new Map(); // toId -> [fromId]
    for (const w of graph.wires) {
      const from = splitRef(w.from);
      const to   = splitRef(w.to);
      if (!revAdj.has(to.id)) revAdj.set(to.id, []);
      revAdj.get(to.id).push(from.id);
    }

    // Find every wire whose destination port is `fb`. Default port uses
    // the same rule as the compiler.
    const fbWires = [];
    for (const w of graph.wires) {
      const to = splitRef(w.to);
      const node = nodeById.get(to.id);
      const op   = node ? getOp(node.op) : null;
      const toPort = to.port ?? (op ? defaultPortId(op.ports.inputs) : null);
      if (toPort === 'fb') fbWires.push({ from: splitRef(w.from), to, raw: `${w.from} → ${w.to}` });
    }

    // For each, walk upstream collecting op ids. Stop at terminals or at
    // the back-edge-from-downstream (the first node that we'd enter via a
    // forward wire from elsewhere — that's the FB tap's source).
    for (const fw of fbWires) {
      const seen = new Set();
      const stack = [fw.from.id];
      const opsUpstream = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        const node = nodeById.get(cur);
        if (node) opsUpstream.add(node.op);
        for (const pred of (revAdj.get(cur) || [])) stack.push(pred);
      }

      if (!opsUpstream.has('dcBlock')) {
        push('error', `feedback path \`${fw.raw}\` missing dcBlock op upstream — required by FB safety ship-gate`);
      }
      if (!opsUpstream.has('softLimit')) {
        push('error', `feedback path \`${fw.raw}\` missing softLimit op upstream — required by FB safety ship-gate`);
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
