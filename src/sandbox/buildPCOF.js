// buildPCOF.js — Graph → Portable-Chain Object File (PCOF).
//
// Stage-3 codegen pipeline step 1 of 2 (memory/codegen_design.md § 4):
//
//   graph.json  ──buildPCOF──▶  pcof.json  ──emit──▶  master-worklet.js
//                                                       OR
//                                                       native .cpp
//
// PCOF is the *flat, resolved, topologically-ordered* intermediate between
// the author-facing graph IR and either the JS master-worklet or the C++
// JUCE emitter. Crucially it is *still JSON-serialisable* — the emitter
// stage can run in Node, the browser, or an offline build step without
// carrying live WebAudio objects.
//
// What PCOF adds on top of graph.json:
//   1. Topological node order       — `nodes` is sorted so any node's
//                                     inputs come from earlier indices
//                                     (or terminals / feedback taps).
//   2. Stable numeric node indices  — codegen emits `nodes[idx]` arrays.
//   3. Resolved port references     — ".port" defaults expanded, kind
//                                     recorded per edge.
//   4. Explicit scratch-buffer plan — one float32 buffer per (node.output
//                                     port) + one per input terminal.
//                                     Emitter allocates exactly these.
//   5. Feedback edges broken out    — wires whose dest-port is `fb`
//                                     become delayed `feedbackEdges[]`
//                                     the emitter wires via one-block
//                                     delay (matches compileGraphToWebAudio
//                                     FB semantics).
//
// What PCOF deliberately does NOT do:
//   - Buffer lifetime / aliasing reuse. Every node-output gets its own
//     scratch slot. Codegen simplicity > memory efficiency for the MVP;
//     a 40-op TOY_COMP worklet uses maybe 10 kB of scratch, a rounding
//     error on the render-quantum Float32 pressure.
//   - Buffer-summing *optimization*. Multi-fanin input ports are represented
//     as `sources: [{bufferIdx, source}, ...]` — emitter sums the buffers
//     at runtime. No clever buffer reuse; one scratch slot per producer
//     output. Matches canonical WebAudio AudioParam input-summing semantics
//     (ModDuck: env + LFO both drive gain.gainMod; LofiLight: wet + dry
//     both sum into output terminal).
//   - Panel curve evaluation. PCOF passes `panel` straight through; the
//     host evaluates knob→param mapping at runtime.
//
// Contract with the caller:
//   - Graph MUST already have passed validateGraph() (T6). buildPCOF
//     assumes OP_KNOWN / PORT_RESOLVES / FB_CYCLE_DECLARED / etc. hold
//     and throws on violation rather than producing a half-valid PCOF.
//   - Output is frozen shape — any change bumps PCOF_VERSION.

import { getOp } from './opRegistry';
import { SCHEMA_VERSION } from './validateGraph';

/** PCOF shape version. Bump on breaking change to the emitted JSON. */
export const PCOF_VERSION = '1';

// Default port resolution MUST match validateGraph.js and
// compileGraphToWebAudio.js exactly — drift here = PCOF rejects graphs the
// validator approved, or vice versa.
function defaultPortId(bucket) {
  const audio = bucket.find(p => p.kind === 'audio');
  return audio ? audio.id : bucket[0]?.id;
}

function splitRef(s) {
  const str = String(s);
  const dot = str.indexOf('.');
  if (dot < 0) return { id: str, port: null };
  return { id: str.slice(0, dot), port: str.slice(dot + 1) };
}

function err(msg) { throw new Error(`[buildPCOF] ${msg}`); }

/**
 * Build a PCOF from a validated graph.
 *
 * @param {object} graph — graph.json, must have passed validateGraph().
 * @returns {object}     — PCOF (JSON-serialisable).
 */
export function buildPCOF(graph) {
  if (!graph || typeof graph !== 'object') err('graph is null/not an object');
  if (graph.schemaVersion !== SCHEMA_VERSION) {
    err(`graph.schemaVersion "${graph.schemaVersion}" must equal "${SCHEMA_VERSION}"`);
  }
  if (!Array.isArray(graph.nodes))     err('graph.nodes must be an array');
  if (!Array.isArray(graph.terminals)) err('graph.terminals must be an array');
  if (!Array.isArray(graph.wires))     err('graph.wires must be an array');

  // --- Index nodes + terminals -------------------------------------------
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
  const termById = new Map(graph.terminals.map(t => [t.id, t]));
  for (const id of nodeById.keys()) {
    if (termById.has(id)) err(`id "${id}" used by both a node and a terminal`);
  }

  // --- Expand every wire into canonical form -----------------------------
  // Each wire: { fromId, fromPort, toId, toPort, kind }
  //   - fromPort/toPort never null (defaults expanded)
  //   - kind decided by the source port (or 'audio' for input terminals)
  const wires = graph.wires.map((w, i) => {
    const from = splitRef(w.from);
    const to   = splitRef(w.to);

    // Resolve source port + kind.
    let fromPort, fromKind;
    if (termById.has(from.id)) {
      // Terminals are audio-only in v1.0.
      fromPort = null;   // sentinel for "terminal"
      fromKind = 'audio';
    } else {
      const node = nodeById.get(from.id);
      if (!node) err(`wire[${i}] from="${w.from}": unknown id`);
      const op = getOp(node.op);
      if (!op) err(`wire[${i}] from="${w.from}": unknown op "${node.op}"`);
      const bucket = op.ports.outputs;
      const pid = from.port ?? defaultPortId(bucket);
      const p   = bucket.find(pp => pp.id === pid);
      if (!p) err(`wire[${i}] from="${w.from}": no output port "${pid}" on op "${node.op}"`);
      fromPort = pid;
      fromKind = p.kind;
    }

    // Resolve dest port + kind.
    let toPort, toKind;
    if (termById.has(to.id)) {
      toPort = null;
      toKind = 'audio';
    } else {
      const node = nodeById.get(to.id);
      if (!node) err(`wire[${i}] to="${w.to}": unknown id`);
      const op = getOp(node.op);
      if (!op) err(`wire[${i}] to="${w.to}": unknown op "${node.op}"`);
      const bucket = op.ports.inputs;
      const pid = to.port ?? defaultPortId(bucket);
      const p   = bucket.find(pp => pp.id === pid);
      if (!p) err(`wire[${i}] to="${w.to}": no input port "${pid}" on op "${node.op}"`);
      toPort = pid;
      toKind = p.kind;
    }

    return { fromId: from.id, fromPort, toId: to.id, toPort, fromKind, toKind };
  });

  // --- Separate feedback edges (dest-port === 'fb') from forward wires ---
  const forwardWires  = [];
  const feedbackEdges = [];
  for (const w of wires) {
    if (w.toPort === 'fb') feedbackEdges.push(w);
    else forwardWires.push(w);
  }

  // --- Topological sort over FORWARD edges only --------------------------
  // Kahn's algorithm. Feedback edges are allowed to violate order (that's
  // what the one-block delay in the emitter covers).
  const indeg = new Map();
  const adj   = new Map();
  for (const n of graph.nodes) { indeg.set(n.id, 0); adj.set(n.id, []); }
  for (const t of graph.terminals) { indeg.set(t.id, 0); adj.set(t.id, []); }
  for (const w of forwardWires) {
    if (!termById.has(w.toId)) {        // terminal outputs don't need ordering
      indeg.set(w.toId, (indeg.get(w.toId) || 0) + 1);
    }
    adj.get(w.fromId).push(w.toId);
  }
  const queue = [];
  // Seed: input terminals first, then any orphans with indeg 0.
  for (const t of graph.terminals) if (t.kind === 'input') queue.push(t.id);
  for (const n of graph.nodes)     if (indeg.get(n.id) === 0) queue.push(n.id);

  const order = [];
  const seen  = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const nx of adj.get(id) || []) {
      indeg.set(nx, (indeg.get(nx) || 0) - 1);
      if (indeg.get(nx) === 0) queue.push(nx);
    }
  }
  // Stragglers (nodes never reached) — usually orphans. Append in source
  // order so codegen still sees them (but the validator should have
  // warned earlier).
  for (const n of graph.nodes) if (!seen.has(n.id)) order.push(n.id);
  for (const t of graph.terminals) if (!seen.has(t.id)) order.push(t.id);

  // --- Allocate scratch buffers -----------------------------------------
  // One buffer per (node, outputPort). One per input terminal. Output
  // terminals don't own a buffer — they read from whatever writes to them.
  /** @type {Array<{id:string, kind:string, producer:string, producerPort:string|null}>} */
  const buffers = [];
  const bufIndex = new Map();   // "nodeId/portId" -> buffer array index
  function allocBuffer(nodeId, portId, kind) {
    const key = `${nodeId}/${portId ?? '_'}`;
    if (bufIndex.has(key)) return bufIndex.get(key);
    const b = {
      id: `b${buffers.length}`,
      kind,
      producer: nodeId,
      producerPort: portId,
    };
    buffers.push(b);
    bufIndex.set(key, buffers.length - 1);
    return buffers.length - 1;
  }
  // Input-terminal buffers.
  for (const t of graph.terminals) {
    if (t.kind === 'input') allocBuffer(t.id, null, 'audio');
  }
  // Node-output buffers.
  for (const n of graph.nodes) {
    const op = getOp(n.op);
    if (!op) err(`node "${n.id}" unknown op "${n.op}"`); // should be impossible post-validate
    for (const p of op.ports.outputs) allocBuffer(n.id, p.id, p.kind);
  }

  // --- Resolve every wire → buffer id ------------------------------------
  // Multi-fanin on the same input port is REQUIRED for canonical patterns:
  //   - ModDuck: n_envDepth → n_gain.gainMod and n_lfoDepth → n_gain.gainMod
  //     both sum into the same AudioParam
  //   - LofiLight: wet + dry both sum into the output terminal
  // Emitter sums all source buffers into the destination input pre-process.
  const resolvedWires = forwardWires.map((w, i) => {
    const srcBufKey = `${w.fromId}/${w.fromPort ?? '_'}`;
    const srcBufIdx = bufIndex.get(srcBufKey);
    if (srcBufIdx == null) err(`wire[${i}]: source buffer missing for ${srcBufKey}`);
    return {
      bufferId: buffers[srcBufIdx].id,
      bufferIdx: srcBufIdx,
      fromId: w.fromId,
      fromPort: w.fromPort,
      toId: w.toId,
      toPort: w.toPort,
      kind: w.fromKind,
    };
  });

  // Feedback edges resolve the same way but point at the *previous-block*
  // value of the source buffer — emitter handles that by holding a 1-block
  // delay copy. Still recorded here for traceability.
  const resolvedFeedback = feedbackEdges.map((w, i) => {
    const srcBufKey = `${w.fromId}/${w.fromPort ?? '_'}`;
    const srcBufIdx = bufIndex.get(srcBufKey);
    if (srcBufIdx == null) err(`feedback[${i}]: source buffer missing for ${srcBufKey}`);
    return {
      bufferId: buffers[srcBufIdx].id,
      bufferIdx: srcBufIdx,
      fromId: w.fromId,
      fromPort: w.fromPort,
      toId: w.toId,
      toPort: w.toPort,   // always 'fb'
      kind: w.fromKind,
      delayBlocks: 1,
    };
  });

  // --- Emit topologically-ordered nodes ---------------------------------
  // For each node, compute the indices in pcof.nodes[] where its inputs
  // come from, and the buffer indices its outputs write to.
  const idToPcofIdx = new Map();
  // Index -1 reserved for "external terminal"; codegen special-cases it.
  // We record terminal buffer indices directly on pcof.terminals.
  const pcofNodes = [];
  for (const id of order) {
    if (termById.has(id)) continue; // terminals aren't ops — tracked separately
    const n = nodeById.get(id);
    if (!n) continue;
    const op = getOp(n.op);
    const idx = pcofNodes.length;
    idToPcofIdx.set(id, idx);

    // Resolve inputs — each input port may have zero or more incoming
    // wires. Multi-fanin represented as `sources: [{bufferIdx, source}, ...]`
    // which the emitter reduces by summing buffers into the port pre-process.
    const inputs = op.ports.inputs.map(p => {
      const wires = resolvedWires.filter(w => w.toId === n.id && w.toPort === p.id);
      const fbs   = resolvedFeedback.filter(w => w.toId === n.id && w.toPort === p.id);
      const sources = [
        ...wires.map(w => ({ bufferIdx: w.bufferIdx, source: 'forward'  })),
        ...fbs.map(  f => ({ bufferIdx: f.bufferIdx, source: 'feedback' })),
      ];
      return { port: p.id, kind: p.kind, sources };
    });

    const outputs = op.ports.outputs.map(p => {
      const bufIdx = bufIndex.get(`${n.id}/${p.id}`);
      return { port: p.id, kind: p.kind, bufferIdx: bufIdx };
    });

    pcofNodes.push({
      idx,
      id: n.id,
      op: n.op,
      params: { ...(n.params || {}) },
      inputs,
      outputs,
    });
  }

  // --- Terminal buffer indices ------------------------------------------
  const pcofTerminals = {
    inputs: graph.terminals
      .filter(t => t.kind === 'input')
      .map(t => ({ id: t.id, bufferIdx: bufIndex.get(`${t.id}/_`) })),
    // Output terminals can have multiple incoming wires (wet + dry both sum
    // into the bus — LofiLight pattern). Represented as `sources[]` with
    // the same summing semantics as multi-fanin input ports.
    outputs: graph.terminals
      .filter(t => t.kind === 'output')
      .map(t => {
        const wires = resolvedWires.filter(w => w.toId === t.id);
        return {
          id: t.id,
          sources: wires.map(w => ({ bufferIdx: w.bufferIdx, source: 'forward' })),
        };
      }),
  };

  return {
    pcofVersion: PCOF_VERSION,
    schemaVersion: SCHEMA_VERSION,
    graphId: graph.id || null,
    label: graph.label || null,
    buffers: buffers.map(b => ({ id: b.id, kind: b.kind, producer: b.producer, producerPort: b.producerPort })),
    nodes: pcofNodes,
    terminals: pcofTerminals,
    feedbackEdges: resolvedFeedback,
    panel: graph.panel || null,
    // Cumulative latency is codegen-target-dependent (DelayNode vs manual
    // ring buffer); leave the field present but zeroed until Stage-Cg.
    latencySamples: 0,
  };
}
