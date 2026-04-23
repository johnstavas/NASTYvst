// createMasterProcessor.js — Stage-3 step 4 of codegen bring-up.
//
// Takes a PCOF (portable-chain object file, see buildPCOF.js) + a map of
// { opId → sidecar class } and returns a *processor class* whose
// `process(inputs, outputs, N)` behaves like a single flat
// AudioWorkletProcessor stitched from all the per-op sidecars in that
// graph.
//
// This is the numerical heart of the master-worklet emitter. Source-code
// string emission for browser `registerProcessor` / CPU `.cpp` is a
// separate serialisation concern (Stage-3 steps 5 + 6); once this
// factory's behaviour is locked against a golden vector, both emitters
// serialise *this* logic.
//
// Why a factory instead of an emitted string:
//   1. Testable under Node without stubbing AudioWorkletGlobalScope.
//   2. Easier to debug — set a breakpoint in the reducer.
//   3. String emission can lift each branch verbatim once the shape is
//      frozen — we aren't regressing future work.
//
// Render algorithm, one block of N samples:
//   (a) Gather: copy the processor's own input[0][0] into each input-
//       terminal buffer.
//   (b) For each node in topo order (pcof.nodes order):
//       i.   Zero the node's per-port input scratch.
//       ii.  For each declared input port with sources.length > 0:
//            sum each source buffer into the port scratch (multi-fanin
//            = AudioParam summing convention). `forward` sources use
//            THIS block's value; `feedback` sources use previous block.
//       iii. Build the `inputs` hashmap the sidecar expects:
//              { [portId]: Float32Array-or-undefined }
//            Unwired ports (sources.length === 0) are undefined so the
//            sidecar can short-circuit (e.g. gain's `if (!inCh) zero`).
//       iv.  Build outputs hashmap from the node's output buffers.
//       v.   Call sidecar.process(inputs, outputs, N).
//   (c) Drain: sum each output terminal's source buffers into
//       processor's output[0][0].
//   (d) Snapshot the previous-block feedback buffers so the NEXT block's
//       feedback reads see today's values (one-block delay).
//
// FB semantics match compileGraphToWebAudio's external-delay approach —
// a 1-block latency on FB paths, which is also what a DelayNode-based
// graph yields in practice.

/**
 * @param {object} pcof             — output of buildPCOF()
 * @param {object} sidecarClasses   — { [opId]: class } (shape-compatible with opRegistry)
 * @returns {object}                — { MasterProcessor, bufferCount, nodeCount }
 */
export function createMasterProcessor(pcof, sidecarClasses) {
  if (!pcof || !Array.isArray(pcof.nodes)) {
    throw new Error('[createMasterProcessor] pcof missing or malformed');
  }
  if (!sidecarClasses || typeof sidecarClasses !== 'object') {
    throw new Error('[createMasterProcessor] sidecarClasses must be an object map');
  }

  // Sanity: every op referenced in pcof must have a sidecar class.
  for (const n of pcof.nodes) {
    if (!sidecarClasses[n.op]) {
      throw new Error(`[createMasterProcessor] missing sidecar class for op "${n.op}" (node ${n.id})`);
    }
  }

  // --- pre-bake node specs --------------------------------------------
  // Done once at construction; hot loop pulls from these arrays.
  const nodeSpecs = pcof.nodes.map(n => {
    const SidecarClass = sidecarClasses[n.op];
    // Pre-resolve each input port:
    //   sources: [{bufferIdx, source: 'forward'|'feedback'}]
    //   multi: true when sources.length > 1 (need sum buffer)
    //   single: when sources.length === 1 we can alias the source buffer
    //           directly into `inputs[portId]` without a copy — big win
    //           since forward ports dominate and the sidecar is free to
    //           only read the buffer (never mutates).
    const ins = n.inputs.map(p => {
      const sources = p.sources || [];
      return {
        port: p.port,
        kind: p.kind,
        sources,
        single: sources.length === 1,
        multi:  sources.length  >  1,
        unwired: sources.length === 0,
      };
    });
    const outs = n.outputs.map(p => ({
      port: p.port,
      kind: p.kind,
      bufferIdx: p.bufferIdx,
    }));
    return { id: n.id, op: n.op, params: n.params || {}, SidecarClass, ins, outs };
  });

  // Which buffer indices are sourced by feedback edges → they need a
  // previous-block snapshot each render.
  const feedbackBufferIdx = new Set();
  for (const f of (pcof.feedbackEdges || [])) {
    feedbackBufferIdx.add(f.bufferIdx);
  }

  // Terminal plumbing
  const inputTerminals  = pcof.terminals.inputs  || [];
  const outputTerminals = pcof.terminals.outputs || [];

  class MasterProcessor {
    constructor(sampleRate) {
      this.sampleRate = sampleRate;
      this.N = 128;

      // Allocate every buffer as a Float32Array of render-quantum length.
      // Size matches AudioWorklet render quantum (128); emitter can size
      // up for larger quanta trivially.
      this.buffers = pcof.buffers.map(() => new Float32Array(this.N));
      // Previous-block snapshots for feedback-sourced buffers.
      this.fbSnapshots = new Map();
      for (const idx of feedbackBufferIdx) {
        this.fbSnapshots.set(idx, new Float32Array(this.N));
      }

      // Per-port summing scratch — multi-fanin reduces into these.
      // Key: "nodeIdx/portId". Allocated lazily; one Float32Array each.
      this.sumScratch = new Map();

      // Instantiate every sidecar and apply declared params.
      this.nodes = nodeSpecs.map(spec => {
        const inst = new spec.SidecarClass(sampleRate);
        inst.reset();
        // Apply params: prefer graph value, else sidecar default (constructor
        // already set this, so we only push explicit overrides).
        for (const [pid, v] of Object.entries(spec.params)) {
          inst.setParam(pid, v);
        }
        return inst;
      });
    }

    /** Called when a panel knob → param mapping updates live. */
    setParam(nodeId, paramId, value) {
      const i = nodeSpecs.findIndex(s => s.id === nodeId);
      if (i < 0) return;
      this.nodes[i].setParam(paramId, value);
      // Keep the baked-in spec in sync so subsequent inspections read truth.
      nodeSpecs[i].params[paramId] = value;
    }

    /**
     * Render one block.
     * @param {Float32Array} inputCh   — processor input[0][0] (mono)
     * @param {Float32Array} outputCh  — processor output[0][0] (mono)
     * @param {number} N                — frame count (usually 128)
     */
    process(inputCh, outputCh, N) {
      const buffers      = this.buffers;
      const fbSnapshots  = this.fbSnapshots;

      // ===== (a) Gather — copy processor input into each input terminal ====
      for (const t of inputTerminals) {
        const buf = buffers[t.bufferIdx];
        if (inputCh) {
          for (let i = 0; i < N; i++) buf[i] = inputCh[i];
        } else {
          for (let i = 0; i < N; i++) buf[i] = 0;
        }
      }

      // ===== (b) Node loop ================================================
      for (let nIdx = 0; nIdx < this.nodes.length; nIdx++) {
        const spec = nodeSpecs[nIdx];
        const inst = this.nodes[nIdx];

        // Build input hashmap for this render call.
        const inputs = {};
        for (const ip of spec.ins) {
          if (ip.unwired) {
            // Leave undefined — sidecar short-circuits.
            continue;
          }
          if (ip.single) {
            // Zero-copy path: alias the single source buffer (forward = this
            // block's buffer; feedback = last block's snapshot).
            const s = ip.sources[0];
            const buf = (s.source === 'feedback' ? fbSnapshots.get(s.bufferIdx) : buffers[s.bufferIdx]);
            inputs[ip.port] = buf;
            continue;
          }
          // Multi-fanin: sum sources into a per-port scratch buffer.
          const key = `${nIdx}/${ip.port}`;
          let scratch = this.sumScratch.get(key);
          if (!scratch) { scratch = new Float32Array(N); this.sumScratch.set(key, scratch); }
          for (let i = 0; i < N; i++) scratch[i] = 0;
          for (const s of ip.sources) {
            const buf = (s.source === 'feedback' ? fbSnapshots.get(s.bufferIdx) : buffers[s.bufferIdx]);
            for (let i = 0; i < N; i++) scratch[i] += buf[i];
          }
          inputs[ip.port] = scratch;
        }

        // Output hashmap points at the node's per-output buffers.
        const outputs = {};
        for (const op of spec.outs) {
          outputs[op.port] = buffers[op.bufferIdx];
        }

        inst.process(inputs, outputs, N);
      }

      // ===== (c) Drain — sum output terminal sources to processor output ===
      for (let i = 0; i < N; i++) outputCh[i] = 0;
      for (const t of outputTerminals) {
        for (const s of (t.sources || [])) {
          const buf = (s.source === 'feedback' ? fbSnapshots.get(s.bufferIdx) : buffers[s.bufferIdx]);
          for (let i = 0; i < N; i++) outputCh[i] += buf[i];
        }
      }

      // ===== (d) Snapshot feedback buffers for next block ==================
      for (const idx of feedbackBufferIdx) {
        const src = buffers[idx];
        const dst = fbSnapshots.get(idx);
        for (let i = 0; i < N; i++) dst[i] = src[i];
      }
    }
  }

  return {
    MasterProcessor,
    bufferCount: pcof.buffers.length,
    nodeCount: pcof.nodes.length,
  };
}
