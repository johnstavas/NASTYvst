// run_graph_worklet.mjs — headless graph executor for L2 recipe-level tests.
//
// Loads a graph.json (sandbox schema — same format as test/fixtures/codegen/*.graph.json),
// topologically sorts the nodes, instantiates each op's worklet class, runs
// the audio block-by-block while routing wires, and captures the buffer
// arriving at the `out` terminal.
//
// Used by:
//   - metrics/compressorRecipe.mjs (and other recipe-level metric modules)
//   - scripts/check_recipe_behavioral.mjs
//
// Limitations (v1):
//   - Feed-forward only. graph.json's `feedback` array is ignored. Cycles
//     will throw during topo-sort.
//   - Mono only. Stim is a single Float32Array, output is a single Float32Array.
//   - No latency compensation. Caller adjusts measurement window if the
//     recipe declares non-zero internal latency.
//   - Wire wires-into-same-port are SUMMED (matches WebAudio semantics).
//   - Wire suffix `.portId` selects a non-default port; absence picks the
//     class's first input/output port.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..', '..', '..', '..');
const opsDir    = resolve(repoRoot, 'src', 'sandbox', 'ops');
const tmpDir    = resolve(repoRoot, 'node_modules', '.behavioral-graph-cache');

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

const opClassCache = new Map();

async function loadOpClass(opId) {
  if (opClassCache.has(opId)) return opClassCache.get(opId);
  const src = resolve(opsDir, `op_${opId}.worklet.js`);
  const dst = resolve(tmpDir, `op_${opId}.worklet.js`);
  copyFileSync(src, dst);
  const mod = await import(pathToFileURL(dst).href);
  const klass = Object.values(mod).find(v =>
    typeof v === 'function' && v.prototype && typeof v.prototype.process === 'function'
  );
  if (!klass) throw new Error(`run_graph_worklet: no class with .process found in op_${opId}.worklet.js`);
  opClassCache.set(opId, klass);
  return klass;
}

// Parse a wire endpoint string. Accepts:
//   "nodeId"          → { id: 'nodeId', port: null }
//   "nodeId.portId"   → { id: 'nodeId', port: 'portId' }
//   "in"              → terminal source
//   "out"             → terminal sink
function splitEndpoint(s) {
  const dot = s.indexOf('.');
  if (dot < 0) return { id: s, port: null };
  return { id: s.slice(0, dot), port: s.slice(dot + 1) };
}

// Topological sort by Kahn's algorithm. Throws on cycle.
function topoSort(nodeIds, edges /* [{srcId, dstId}, ...] */) {
  const incoming = new Map(nodeIds.map(id => [id, new Set()]));
  const outgoing = new Map(nodeIds.map(id => [id, new Set()]));
  for (const { srcId, dstId } of edges) {
    if (!incoming.has(dstId) || !outgoing.has(srcId)) continue; // terminals
    incoming.get(dstId).add(srcId);
    outgoing.get(srcId).add(dstId);
  }
  const ready = nodeIds.filter(id => incoming.get(id).size === 0);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const dst of outgoing.get(id)) {
      incoming.get(dst).delete(id);
      if (incoming.get(dst).size === 0) ready.push(dst);
    }
  }
  if (order.length !== nodeIds.length) {
    throw new Error('run_graph_worklet: graph has a cycle (feedback). v1 is feed-forward only.');
  }
  return order;
}

/**
 * Instantiate every op in the graph and return a runtime structure that can
 * be reused across multiple stim runs (lets a metric reuse one compiled graph
 * for several test passes — sweep, step, bypass-null, etc.).
 *
 * @param {object} graph    parsed graph.json
 * @param {object} options  { sampleRate, blockSize }
 * @returns {Promise<object>} { run(stim) → Float32Array, reset(), nodes, order }
 */
export async function buildGraphRuntime(graph, options = {}) {
  const sr        = options.sampleRate || 48000;
  const blockSize = options.blockSize  || 256;

  // Instantiate all op nodes.
  const nodeMap = new Map();
  for (const n of graph.nodes) {
    const Klass = await loadOpClass(n.op);
    const op = new Klass(sr);
    // Apply declared params from graph.json.
    for (const [pid, v] of Object.entries(n.params || {})) {
      op.setParam(pid, v);
    }
    const inPorts  = (Klass.inputs  || []).map(p => p.id);
    const outPorts = (Klass.outputs || []).map(p => p.id.length ? p.id : 'out');
    if (outPorts.length === 0) outPorts.push('out');
    nodeMap.set(n.id, { id: n.id, opId: n.op, op, inPorts, outPorts, Klass });
  }

  // Resolve every wire to (srcId, srcPort, dstId, dstPort).
  // Default ports: source defaults to first declared output (usually "out");
  // dest defaults to first declared input (usually "in" or "env").
  const wires = graph.wires.map(w => {
    const a = splitEndpoint(w.from);
    const b = splitEndpoint(w.to);
    const srcNode = nodeMap.get(a.id);
    const dstNode = nodeMap.get(b.id);
    const srcPort = a.port ?? (srcNode ? srcNode.outPorts[0] : null);
    const dstPort = b.port ?? (dstNode ? dstNode.inPorts[0]  : null);
    return { srcId: a.id, srcPort, dstId: b.id, dstPort };
  });

  // Topologically order non-terminal nodes.
  const order = topoSort(graph.nodes.map(n => n.id), wires);

  // Per-node block-scratch buffers (allocated once, reused per block).
  for (const node of nodeMap.values()) {
    node.inBuf  = {};
    node.outBuf = {};
    for (const p of node.inPorts)  node.inBuf[p]  = new Float32Array(blockSize);
    for (const p of node.outPorts) node.outBuf[p] = new Float32Array(blockSize);
  }

  // Terminal scratch.
  const terminalIn  = new Float32Array(blockSize);   // stim slice for terminal "in"
  const terminalOut = new Float32Array(blockSize);   // captured terminal "out"

  function reset() {
    for (const node of nodeMap.values()) {
      if (typeof node.op.reset === 'function') node.op.reset();
    }
  }

  /**
   * Run audio through the graph. stim is mono Float32Array fed into the `in`
   * terminal. Returns mono Float32Array captured at the `out` terminal.
   */
  function run(stim) {
    const N = stim.length;
    const result = new Float32Array(N);

    for (let off = 0; off < N; off += blockSize) {
      const blk = Math.min(blockSize, N - off);

      // Reslice scratch to actual block length (last block may be short).
      const tIn  = terminalIn.subarray(0, blk);
      const tOut = terminalOut.subarray(0, blk);
      tOut.fill(0);

      // Copy stim slice into terminal input buffer.
      for (let i = 0; i < blk; i++) tIn[i] = stim[off + i];

      // Per-block: zero every node's input buffers (we'll sum into them).
      for (const node of nodeMap.values()) {
        for (const p of node.inPorts) {
          const buf = node.inBuf[p];
          for (let i = 0; i < blk; i++) buf[i] = 0;
        }
      }

      // Push terminal-source data into wire destinations BEFORE processing nodes.
      for (const w of wires) {
        if (w.srcId === 'in') {
          const dst = nodeMap.get(w.dstId);
          if (!dst) continue;
          const buf = dst.inBuf[w.dstPort];
          for (let i = 0; i < blk; i++) buf[i] += tIn[i];
        }
      }

      // Process nodes in topo order.
      for (const id of order) {
        const node = nodeMap.get(id);
        // Build per-block input/output dicts as subarrays (the worklet
        // process() expects views sized to the actual block).
        const inputs  = {};
        const outputs = {};
        for (const p of node.inPorts)  inputs[p]  = node.inBuf[p].subarray(0, blk);
        for (const p of node.outPorts) {
          // Zero output buffer before each call (defensive — some ops may
          // write only on 'in' presence, leaving stale data otherwise).
          const buf = node.outBuf[p];
          for (let i = 0; i < blk; i++) buf[i] = 0;
          outputs[p] = buf.subarray(0, blk);
        }
        node.op.process(inputs, outputs, blk);

        // Route this node's outputs to downstream wire destinations.
        for (const w of wires) {
          if (w.srcId !== id) continue;
          const srcBuf = node.outBuf[w.srcPort];
          if (!srcBuf) continue;
          if (w.dstId === 'out') {
            for (let i = 0; i < blk; i++) tOut[i] += srcBuf[i];
          } else {
            const dst = nodeMap.get(w.dstId);
            if (!dst) continue;
            const dstBuf = dst.inBuf[w.dstPort];
            if (!dstBuf) continue;
            for (let i = 0; i < blk; i++) dstBuf[i] += srcBuf[i];
          }
        }
      }

      // Capture terminal output for this block.
      for (let i = 0; i < blk; i++) result[off + i] = tOut[i];
    }

    return result;
  }

  return {
    run, reset, sampleRate: sr, blockSize,
    nodeIds: [...nodeMap.keys()], order,
  };
}

/**
 * One-shot convenience: load graph from path, run with stim, return output.
 */
export async function runGraphWorklet(graphPath, stim, options = {}) {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const rt = await buildGraphRuntime(graph, options);
  return rt.run(stim);
}
