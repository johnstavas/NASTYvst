// validatePCOF.js — T6.5 pre-codegen validator.
//
// Runs after buildPCOF() produces the portable-chain object file. Catches
// shape regressions *between* the graph-level validator (T6) and the
// emitter stage (T7/T8). Lives at the harness tier — one more green gate
// before codegen is allowed to touch the PCOF.
//
// What T6.5 enforces that T6 can't:
//   • PCOF_VERSION_MATCHES        pcofVersion equals the validator's known version
//   • NODE_IDX_DENSE              pcofNodes[].idx is 0..N-1 in order
//   • BUFFER_ID_UNIQUE            buffers[].id is unique and matches "bK" pattern
//   • BUFFER_HAS_PRODUCER         every buffer has a producer (node or input terminal)
//   • BUFFER_CONSUMED             every buffer is consumed by ≥1 input port OR
//                                 output terminal (warn on orphans)
//   • TOPOLOGICAL_ORDER           every node's forward-input bufferIdx refers to
//                                 a buffer produced earlier in the node list
//                                 (terminals don't count as "earlier" for this
//                                 check — they're outside the ordered array)
//   • TERMINAL_OUTPUT_WIRED       every output terminal has a bufferIdx >= 0
//   • FEEDBACK_DELAYED            every feedbackEdge has delayBlocks >= 1
//   • INPUT_PORT_KIND_MATCH       buffer.kind == input-port.kind (advisory in v1
//                                 IR but enforced at PCOF level — kind is
//                                 pinned by this point)

import { PCOF_VERSION } from './buildPCOF';

export function validatePCOF(pcof) {
  const errors   = [];
  const warnings = [];
  const push = (sev, msg) => (sev === 'error' ? errors : warnings).push(msg);

  if (!pcof || typeof pcof !== 'object') {
    return { ok: false, errors: ['pcof is null/not an object'], warnings };
  }

  if (pcof.pcofVersion !== PCOF_VERSION) {
    push('error', `pcofVersion "${pcof.pcofVersion}" does not match validator "${PCOF_VERSION}"`);
  }

  if (!Array.isArray(pcof.buffers)) push('error', 'pcof.buffers must be an array');
  if (!Array.isArray(pcof.nodes))   push('error', 'pcof.nodes must be an array');
  if (!pcof.terminals || typeof pcof.terminals !== 'object') {
    push('error', 'pcof.terminals must be an object');
  }
  if (!Array.isArray(pcof.feedbackEdges)) push('error', 'pcof.feedbackEdges must be an array');
  if (errors.length) return { ok: false, errors, warnings };

  const { buffers, nodes, terminals, feedbackEdges } = pcof;

  // --- BUFFER_ID_UNIQUE + pattern ----------------------------------------
  const seenBufIds = new Set();
  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i];
    if (!b || typeof b !== 'object') { push('error', `buffers[${i}] is not an object`); continue; }
    if (!b.id || !/^b\d+$/.test(b.id)) push('error', `buffers[${i}].id "${b.id}" must match /^b\\d+$/`);
    if (seenBufIds.has(b.id))          push('error', `duplicate buffer id "${b.id}"`);
    else seenBufIds.add(b.id);
    if (b.kind !== 'audio' && b.kind !== 'control') push('error', `buffers[${i}].kind "${b.kind}" not in {audio,control}`);
    if (!b.producer) push('error', `buffers[${i}] missing producer`);
  }

  // --- NODE_IDX_DENSE ----------------------------------------------------
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].idx !== i) {
      push('error', `nodes[${i}].idx is ${nodes[i].idx}, expected ${i} (must be dense 0..N-1)`);
    }
  }

  // --- Build node-idx → buffer-idx set of outputs this node writes -------
  const nodeOutputsBufIdx = new Map(); // nodeIdx -> Set<bufIdx>
  for (const n of nodes) {
    const set = new Set();
    for (const o of (n.outputs || [])) {
      if (typeof o.bufferIdx !== 'number' || o.bufferIdx < 0 || o.bufferIdx >= buffers.length) {
        push('error', `node "${n.id}" output port "${o.port}": bufferIdx ${o.bufferIdx} out of range`);
      } else {
        set.add(o.bufferIdx);
      }
    }
    nodeOutputsBufIdx.set(n.idx, set);
  }

  // --- TOPOLOGICAL_ORDER -------------------------------------------------
  // Any forward-input buffer must be produced by either:
  //   (a) an input terminal (tracked in termInputBufIdx), or
  //   (b) a node at a strictly-lower index
  // Feedback-sourced inputs are exempt.
  const termInputBufIdx = new Set(
    (terminals.inputs || []).map(t => t.bufferIdx).filter(i => i >= 0),
  );
  for (const n of nodes) {
    for (const inp of (n.inputs || [])) {
      for (const src of (inp.sources || [])) {
        if (src.source !== 'forward') continue;
        if (src.bufferIdx < 0) continue;
        if (termInputBufIdx.has(src.bufferIdx)) continue;
        let producerIdx = -1;
        for (const [idx, set] of nodeOutputsBufIdx.entries()) {
          if (set.has(src.bufferIdx)) { producerIdx = idx; break; }
        }
        if (producerIdx < 0) {
          push('error', `node "${n.id}" input "${inp.port}": forward source buffer b${src.bufferIdx} has no producer`);
        } else if (producerIdx >= n.idx) {
          push('error', `node "${n.id}" input "${inp.port}": forward source is node #${producerIdx} (>= this node #${n.idx}) — topo order violated`);
        }
      }
    }
  }

  // --- BUFFER_HAS_PRODUCER + BUFFER_CONSUMED -----------------------------
  // Producers: already validated via nodeOutputsBufIdx + termInputBufIdx.
  const producedBufIdx = new Set([
    ...termInputBufIdx,
    ...[...nodeOutputsBufIdx.values()].flatMap(s => [...s]),
  ]);
  for (let i = 0; i < buffers.length; i++) {
    if (!producedBufIdx.has(i)) {
      push('error', `buffer b${i} has no producer (neither a node output nor an input terminal)`);
    }
  }
  const consumedBufIdx = new Set();
  for (const n of nodes) {
    for (const inp of (n.inputs || [])) {
      for (const s of (inp.sources || [])) {
        if (s.bufferIdx >= 0) consumedBufIdx.add(s.bufferIdx);
      }
    }
  }
  for (const t of (terminals.outputs || [])) {
    for (const s of (t.sources || [])) {
      if (s.bufferIdx >= 0) consumedBufIdx.add(s.bufferIdx);
    }
  }
  for (const f of feedbackEdges) {
    if (f.bufferIdx >= 0) consumedBufIdx.add(f.bufferIdx);
  }
  for (let i = 0; i < buffers.length; i++) {
    if (!consumedBufIdx.has(i)) {
      push('warning', `buffer b${i} (producer "${buffers[i].producer}") is never consumed — dead output`);
    }
  }

  // --- TERMINAL_OUTPUT_WIRED ---------------------------------------------
  for (const t of (terminals.outputs || [])) {
    if (!Array.isArray(t.sources) || t.sources.length === 0) {
      push('error', `output terminal "${t.id}" has no incoming wires`);
    } else {
      for (const s of t.sources) {
        if (typeof s.bufferIdx !== 'number' || s.bufferIdx < 0) {
          push('error', `output terminal "${t.id}" has invalid source bufferIdx=${s.bufferIdx}`);
        }
      }
    }
  }

  // --- FEEDBACK_DELAYED --------------------------------------------------
  for (const f of feedbackEdges) {
    if (!(f.delayBlocks >= 1)) {
      push('error', `feedback edge ${f.fromId}.${f.fromPort} → ${f.toId}.${f.toPort} has delayBlocks=${f.delayBlocks} (must be >= 1)`);
    }
  }

  // --- INPUT_PORT_KIND_MATCH (advisory → warn) ---------------------------
  // IR v1.0 says kind is advisory; PCOF-level mismatch likely indicates a
  // graph author wired audio → control or vice-versa. Warn, don't block.
  for (const n of nodes) {
    for (const inp of (n.inputs || [])) {
      for (const s of (inp.sources || [])) {
        if (s.bufferIdx < 0) continue;
        const b = buffers[s.bufferIdx];
        if (!b) continue;
        if (b.kind !== inp.kind) {
          push('warning', `node "${n.id}" input "${inp.port}" expects ${inp.kind}, gets ${b.kind} from ${b.producer}.${b.producerPort ?? '_'}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
