// emitMasterWorklet.js — Stage-3 step 5 of codegen bring-up.
//
// Takes the same (pcof, sidecarSources) pair that createMasterProcessor
// consumes as a factory, but returns a *source-code string* suitable for
// `audioWorklet.addModule(new Blob([source], {type: 'text/javascript'}))`.
//
// The emitted file:
//   1. Inlines every sidecar class source verbatim (stripped of the
//      `export` keyword so the module-scope is a plain script body).
//   2. Pre-bakes the PCOF as a JS literal — node specs, feedback buffer
//      index list, terminal descriptors, node-spec `single`/`multi`/`unwired`
//      flags. The render loop reads these constants directly; no PCOF
//      parsing at runtime.
//   3. Defines a class extending AudioWorkletProcessor that performs the
//      same 4-phase render as createMasterProcessor (Gather → Node loop →
//      Drain → Snapshot feedback). MessagePort accepts {type:'setParam',
//      nodeId, paramId, value}.
//   4. Calls registerProcessor(processorName, <class>).
//
// Parity contract:
//   Running the emitted source in a mock AudioWorkletGlobalScope and
//   feeding the same drive signal MUST produce the same output hash as
//   createMasterProcessor (check_master_emit_parity.mjs enforces this).
//   If the hashes ever diverge, one of the two code paths has drifted
//   from the render algorithm spec in memory/codegen_design.md.
//
// Why a single string instead of a module graph:
//   AudioWorklet.addModule() takes one URL. Browser-side we create a
//   Blob URL from this string. Node side (testing / pre-ship T8
//   conformance) writes it to a tmp file and imports it under a mock
//   global scope. Either way: one file in, one `registerProcessor` out.

const SIDECAR_CLASS_NAMES = {
  gain:         'GainOp',
  filter:       'FilterOp',
  detector:     'DetectorOp',
  envelope:     'EnvelopeOp',
  gainComputer: 'GainComputerOp',
  mix:          'MixOp',
  // add future ops here as sidecars land
};

/** Strip `export ` prefixes so the concatenated source is a plain script. */
function stripExport(src) {
  return src.replace(/^export\s+(class|function|const|let|var)\b/gm, '$1');
}

/** Quote a string for inclusion in JS source (conservative — identifiers only). */
function jsIdent(s) {
  if (typeof s !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) {
    throw new Error(`[emitMasterWorklet] not a valid JS identifier: ${JSON.stringify(s)}`);
  }
  return s;
}

/**
 * Pre-bake the per-node input-port resolution that createMasterProcessor
 * does at factory-time. Emitting this as a JS literal means the render
 * loop doesn't have to re-derive single/multi/unwired status per block.
 */
function bakeNodeSpecs(pcof) {
  return pcof.nodes.map(n => {
    const ins = n.inputs.map(p => {
      const sources = p.sources || [];
      return {
        port:    p.port,
        kind:    p.kind,
        sources,
        single:  sources.length === 1,
        multi:   sources.length  >  1,
        unwired: sources.length === 0,
      };
    });
    const outs = n.outputs.map(p => ({
      port:      p.port,
      kind:      p.kind,
      bufferIdx: p.bufferIdx,
    }));
    return {
      id:     n.id,
      op:     n.op,
      params: n.params || {},
      ins,
      outs,
    };
  });
}

/**
 * @param {object} args
 * @param {object} args.pcof            — output of buildPCOF()
 * @param {object} args.sidecarSources  — { [opId]: "source string of op_<id>.worklet.js" }
 * @param {string} [args.processorName] — registered processor name (default: `master-${pcof-graphId}`)
 * @returns {string}                    — self-contained worklet source
 */
export function emitMasterWorklet({ pcof, sidecarSources, processorName }) {
  if (!pcof || !Array.isArray(pcof.nodes)) throw new Error('[emitMasterWorklet] pcof missing/malformed');
  if (!sidecarSources || typeof sidecarSources !== 'object') throw new Error('[emitMasterWorklet] sidecarSources missing');

  // Collect every op used by the graph (ensures we only inline what's needed).
  const usedOps = [...new Set(pcof.nodes.map(n => n.op))];
  for (const op of usedOps) {
    if (!sidecarSources[op]) throw new Error(`[emitMasterWorklet] sidecarSources missing op "${op}"`);
    if (!SIDECAR_CLASS_NAMES[op]) throw new Error(`[emitMasterWorklet] unknown sidecar class-name mapping for op "${op}"`);
  }

  const name = processorName || `master-${pcof.graphId || 'graph'}`;
  if (!/^[A-Za-z0-9_.\-]+$/.test(name)) throw new Error(`[emitMasterWorklet] invalid processor name "${name}"`);

  const nodeSpecs       = bakeNodeSpecs(pcof);
  const feedbackBufIdx  = [...new Set((pcof.feedbackEdges || []).map(f => f.bufferIdx))];
  const inputTerminals  = (pcof.terminals?.inputs)  || [];
  const outputTerminals = (pcof.terminals?.outputs) || [];
  const bufferCount     = pcof.buffers.length;

  // -- Sidecar source blocks ------------------------------------------------
  const sidecarBlocks = usedOps.map(op => {
    const src = stripExport(sidecarSources[op]).trim();
    return `// ---- inlined op: ${op} --------------------------------------\n${src}`;
  }).join('\n\n');

  // -- SIDECAR_CLASSES map literal -----------------------------------------
  const sidecarMapEntries = usedOps.map(op => {
    return `  ${JSON.stringify(op)}: ${jsIdent(SIDECAR_CLASS_NAMES[op])}`;
  }).join(',\n');

  // -- Pre-baked constants as JSON literals --------------------------------
  const NODE_SPECS_LIT       = JSON.stringify(nodeSpecs, null, 2);
  const FB_BUF_IDX_LIT       = JSON.stringify(feedbackBufIdx);
  const INPUT_TERMINALS_LIT  = JSON.stringify(inputTerminals);
  const OUTPUT_TERMINALS_LIT = JSON.stringify(outputTerminals);

  // -- Render body ---------------------------------------------------------
  // NB: the render algorithm below MUST stay bit-identical to
  // createMasterProcessor.process() or the parity harness trips.
  return `// AUTO-GENERATED by emitMasterWorklet.js — DO NOT EDIT BY HAND.
// Source graph PCOF v${pcof.pcofVersion} / graphId=${pcof.graphId ?? '(n/a)'}
// Processor name: ${name}

${sidecarBlocks}

// ---- pre-baked graph constants ---------------------------------------
const NODE_SPECS = ${NODE_SPECS_LIT};
const FB_BUF_IDX = ${FB_BUF_IDX_LIT};
const INPUT_TERMINALS  = ${INPUT_TERMINALS_LIT};
const OUTPUT_TERMINALS = ${OUTPUT_TERMINALS_LIT};
const BUFFER_COUNT = ${bufferCount};

const SIDECAR_CLASSES = {
${sidecarMapEntries}
};

class MasterAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = (typeof sampleRate === 'number') ? sampleRate : 48000;
    this.sampleRate = sr;

    // Allocate one buffer per PCOF buffer index (render-quantum length).
    this.buffers = new Array(BUFFER_COUNT);
    for (let i = 0; i < BUFFER_COUNT; i++) this.buffers[i] = new Float32Array(128);

    // Previous-block snapshots for feedback-sourced buffers.
    this.fbSnapshots = new Map();
    for (const idx of FB_BUF_IDX) this.fbSnapshots.set(idx, new Float32Array(128));

    // Per-port summing scratch (multi-fanin), keyed "nodeIdx/portId".
    this.sumScratch = new Map();

    // Instantiate every sidecar and apply declared params.
    this.nodes = NODE_SPECS.map(spec => {
      const Cls = SIDECAR_CLASSES[spec.op];
      const inst = new Cls(sr);
      if (typeof inst.reset === 'function') inst.reset();
      if (spec.params) {
        for (const pid of Object.keys(spec.params)) {
          if (typeof inst.setParam === 'function') inst.setParam(pid, spec.params[pid]);
        }
      }
      return inst;
    });

    // MessagePort: live panel-knob updates.
    this.port.onmessage = (e) => {
      const msg = e && e.data;
      if (!msg) return;
      if (msg.type === 'setParam') this._setParam(msg.nodeId, msg.paramId, msg.value);
    };
  }

  _setParam(nodeId, paramId, value) {
    const i = NODE_SPECS.findIndex(s => s.id === nodeId);
    if (i < 0) return;
    const inst = this.nodes[i];
    if (typeof inst.setParam === 'function') inst.setParam(paramId, value);
    NODE_SPECS[i].params[paramId] = value;
  }

  // AudioWorkletProcessor signature: (inputs, outputs, parameters)
  // We consume input[0][0] (mono) and write output[0][0] (mono).
  process(inputs, outputs) {
    const inputCh  = (inputs[0]  && inputs[0][0])  || null;
    const outputCh = (outputs[0] && outputs[0][0]) || null;
    if (!outputCh) return true;
    const N = outputCh.length;

    // Grow allocated buffers if render quantum is non-default. Cheap on
    // miss (one-time), zero-cost on the steady-state 128 path.
    if (this.buffers[0].length !== N) {
      for (let i = 0; i < BUFFER_COUNT; i++) this.buffers[i] = new Float32Array(N);
      for (const idx of FB_BUF_IDX) this.fbSnapshots.set(idx, new Float32Array(N));
      this.sumScratch.clear();
    }

    const buffers     = this.buffers;
    const fbSnapshots = this.fbSnapshots;

    // ===== (a) Gather =====
    for (const t of INPUT_TERMINALS) {
      const buf = buffers[t.bufferIdx];
      if (inputCh) {
        for (let i = 0; i < N; i++) buf[i] = inputCh[i];
      } else {
        for (let i = 0; i < N; i++) buf[i] = 0;
      }
    }

    // ===== (b) Node loop =====
    for (let nIdx = 0; nIdx < this.nodes.length; nIdx++) {
      const spec = NODE_SPECS[nIdx];
      const inst = this.nodes[nIdx];

      const ins = {};
      for (const ip of spec.ins) {
        if (ip.unwired) continue;
        if (ip.single) {
          const s = ip.sources[0];
          ins[ip.port] = (s.source === 'feedback' ? fbSnapshots.get(s.bufferIdx) : buffers[s.bufferIdx]);
          continue;
        }
        const key = nIdx + '/' + ip.port;
        let scratch = this.sumScratch.get(key);
        if (!scratch) { scratch = new Float32Array(N); this.sumScratch.set(key, scratch); }
        for (let i = 0; i < N; i++) scratch[i] = 0;
        for (const s of ip.sources) {
          const buf = (s.source === 'feedback' ? fbSnapshots.get(s.bufferIdx) : buffers[s.bufferIdx]);
          for (let i = 0; i < N; i++) scratch[i] += buf[i];
        }
        ins[ip.port] = scratch;
      }

      const outs = {};
      for (const op of spec.outs) outs[op.port] = buffers[op.bufferIdx];

      inst.process(ins, outs, N);
    }

    // ===== (c) Drain =====
    for (let i = 0; i < N; i++) outputCh[i] = 0;
    for (const t of OUTPUT_TERMINALS) {
      const srcs = t.sources || [];
      for (const s of srcs) {
        const buf = (s.source === 'feedback' ? fbSnapshots.get(s.bufferIdx) : buffers[s.bufferIdx]);
        for (let i = 0; i < N; i++) outputCh[i] += buf[i];
      }
    }

    // ===== (d) Snapshot feedback =====
    for (const idx of FB_BUF_IDX) {
      const src = buffers[idx];
      const dst = fbSnapshots.get(idx);
      for (let i = 0; i < N; i++) dst[i] = src[i];
    }

    return true;
  }
}

registerProcessor(${JSON.stringify(name)}, MasterAudioProcessor);
`;
}
