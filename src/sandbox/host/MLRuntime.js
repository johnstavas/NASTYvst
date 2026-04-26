// MLRuntime.js — host-side inference runner for `kind: 'neural'` ops.
//
// Owned by the sandbox host (NastyOrbsCanvas) and the WAM host. Receives
// `ml.frame` MessagePort messages from neural-op worklet sidecars, runs
// inference via an injected ONNX Runtime (ORT-Web in browser, ORT-Node in
// Node tests), decodes the model output to op-specific result shapes, and
// posts `ml.result` back to the worklet.
//
// === DESIGN: isomorphic, dependency-injected ===
//
// The runtime is intentionally agnostic about WHERE the ORT module comes
// from and WHERE the weights bytes come from. Both are passed in at
// construction time:
//
//   new MLRuntime({
//     ort:        // a loaded ORT module (ort-web in browser, ort-node in Node)
//     loadModel:  async (opId) => Uint8Array | ArrayBuffer
//   });
//
// This decouples MLRuntime from bundler magic and lets the same code
// power production (browser fetch from /models/<opId>.onnx) and tests
// (Node fs.readFileSync). Browser-side wiring lives in the calling host
// page (see codegen_design.md §13 — emitted as `ml-host.js` adapter at
// codegen time).
//
// === DECODE PIPELINE ===
//
// Each opId has a registered DECODER that turns the ORT session output
// into the result object the worklet expects. For `crepe` the decoder
// runs the CREPE-canonical local-average-cents pipeline:
//
//   1. Find argmax bin in the 360-bin sigmoid output.
//   2. Local-average over 9 bins centered on argmax (±4) — verbatim
//      from marl/crepe/core.py:to_local_average_cents.
//   3. Convert cents → Hz: 10 * 2^(cents/1200).
//   4. confidence = max activation value.
//
// The cents grid uses `(N-1)=359` denominator (linspace(0, 7180, 360)
// has 359 intervals between 360 endpoints). Validated against
// onnxruntime-node 1.24 on a 440 Hz sine: local-avg-Hz = 440.424
// (1.7¢ from truth, well within RPA target).
//
// === LICENSE NOTES ===
// - onnxruntime-web / onnxruntime-node: MIT (Microsoft).
// - crepe-tiny.onnx: MIT (yqzhishen/onnxcrepe; weights converted from
//   marl/crepe Keras checkpoints, also MIT).
//
// === REFERENCES ===
// - codegen_design.md §12 (Neural assets / bundle layout)
// - codegen_design.md §13 (Async ML ops / MessagePort protocol)
// - sandbox_op_ship_protocol.md "Neural Op Exception clause"

const CREPE_N_BINS     = 360;
const CREPE_CENTS_BASE = 1997.3794084376191;
const CREPE_CENTS_RANGE = 7180;
const CREPE_LOCAL_AVG_HALF = 4;  // ±4 → 9-bin local average

/**
 * Decoders are registered per opId. A decoder takes the raw ORT output
 * tensor data (Float32Array) and returns the result object the worklet
 * caches in `_latestResult`.
 *
 * Adding a new neural op = register its decoder here.
 */
export const DECODERS = {
  crepe(salience) {
    if (!salience || salience.length !== CREPE_N_BINS) {
      return { f0: 0, confidence: 0 };
    }
    // 1. argmax + max value → confidence.
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < CREPE_N_BINS; i++) {
      const v = salience[i];
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }
    if (!Number.isFinite(maxVal) || maxVal <= 0) {
      return { f0: 0, confidence: 0 };
    }
    // 2. Local-average over 9 bins (±4) centered on argmax — verbatim
    //    from marl/crepe/core.py:to_local_average_cents.
    const start = Math.max(0, maxIdx - CREPE_LOCAL_AVG_HALF);
    const end   = Math.min(CREPE_N_BINS, maxIdx + CREPE_LOCAL_AVG_HALF + 1);
    let sumW = 0, sumWX = 0;
    for (let i = start; i < end; i++) {
      // cents grid: linspace(0, 7180, 360) + 1997.3794084376191
      // → step = 7180/(360-1) = 7180/359
      const cents = (CREPE_CENTS_RANGE * i / (CREPE_N_BINS - 1)) + CREPE_CENTS_BASE;
      const w = salience[i];
      sumWX += w * cents;
      sumW  += w;
    }
    if (sumW <= 0) return { f0: 0, confidence: 0 };
    const cents = sumWX / sumW;
    // 3. cents → Hz.
    const f0 = 10 * Math.pow(2, cents / 1200);
    // 4. Sigmoid max value as confidence (already in [0, 1]).
    const confidence = Math.max(0, Math.min(1, maxVal));
    return {
      f0:         Number.isFinite(f0) ? f0 : 0,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    };
  },
};

/**
 * Per-op input-tensor shape + dtype + name. The MLRuntime uses these to
 * package the worklet's frame Float32Array into an ORT.Tensor without
 * embedding op-specific knowledge in the run loop.
 *
 * Adding a new neural op = register its input contract here.
 */
export const INPUT_CONTRACTS = {
  crepe: {
    inputName: 'frames',
    dims:      (frame) => [1, frame.length],   // [batch, samples]
    outputName: 'probabilities',
  },
};

export class MLRuntime {
  /**
   * @param {object}  opts
   * @param {object}  opts.ort        ORT module (onnxruntime-web | onnxruntime-node).
   * @param {function} opts.loadModel async (opId) → Uint8Array | ArrayBuffer
   * @param {object}  [opts.decoders]      Override DECODERS map (advanced).
   * @param {object}  [opts.inputContracts] Override INPUT_CONTRACTS map.
   * @param {function}[opts.onError]       Called on per-frame inference failure.
   */
  constructor(opts = {}) {
    if (!opts.ort)        throw new Error('MLRuntime: opts.ort required (onnxruntime-{web,node} module)');
    if (typeof opts.loadModel !== 'function') {
      throw new Error('MLRuntime: opts.loadModel required (async (opId) → bytes)');
    }
    this._ort        = opts.ort;
    this._loadModel  = opts.loadModel;
    this._decoders   = opts.decoders        || DECODERS;
    this._contracts  = opts.inputContracts  || INPUT_CONTRACTS;
    this._onError    = opts.onError         || ((err, ctx) => {
      // eslint-disable-next-line no-console
      console.error('[MLRuntime]', ctx, err);
    });

    /** Map<opId, Promise<InferenceSession>> — lazy + memoized */
    this._sessions   = new Map();
    /** Set<MessagePort> attached worklet ports (for cleanup) */
    this._ports      = new Set();
    this._disposed   = false;
  }

  /**
   * Load (or return cached) ORT session for `opId`. Sessions are kept
   * warm for the lifetime of the runtime.
   */
  async getSession(opId) {
    if (this._disposed) throw new Error('MLRuntime: disposed');
    let p = this._sessions.get(opId);
    if (p) return p;
    p = (async () => {
      const bytes = await this._loadModel(opId);
      // ORT accepts Uint8Array or ArrayBuffer; normalise to Uint8Array.
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return this._ort.InferenceSession.create(u8);
    })();
    this._sessions.set(opId, p);
    // If load fails, drop from cache so a retry can re-attempt.
    p.catch(() => { this._sessions.delete(opId); });
    return p;
  }

  /**
   * Run one inference + decode for `opId`. Returns the decoded result
   * object the worklet expects (e.g., `{f0, confidence}` for crepe).
   *
   * Frame Float32Array length must match the op's input contract dims.
   */
  async run(opId, frame) {
    const session  = await this.getSession(opId);
    const contract = this._contracts[opId];
    const decoder  = this._decoders[opId];
    if (!contract) throw new Error(`MLRuntime: no input contract for opId="${opId}"`);
    if (!decoder)  throw new Error(`MLRuntime: no decoder for opId="${opId}"`);
    const dims = contract.dims(frame);
    const tensor = new this._ort.Tensor('float32', frame, dims);
    const feeds  = { [contract.inputName]: tensor };
    const out    = await session.run(feeds);
    const probs  = out[contract.outputName];
    if (!probs) {
      throw new Error(`MLRuntime: session output missing "${contract.outputName}"`);
    }
    // probs.data is Float32Array (ORT's TypedTensor wraps a typed array).
    return decoder(probs.data);
  }

  /**
   * Wire a worklet's MessagePort to this runtime. The port should be
   * the AudioWorkletNode.port from the host side; the worklet sidecar
   * has already attached its own listener via `op.bindPort(workletPort)`.
   *
   * On `ml.frame`: run inference, post `ml.result` back. Errors are
   * surfaced via `onError` but never break the message stream — a single
   * bad frame should not stall future inference.
   */
  attachWorkletPort(port) {
    if (!port || typeof port.addEventListener !== 'function') {
      throw new Error('MLRuntime.attachWorkletPort: invalid port');
    }
    if (this._disposed) throw new Error('MLRuntime: disposed');
    const handler = async (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== 'ml.frame') return;
      const { opId, nodeId, frame, seq } = msg;
      if (typeof opId !== 'string' || !(frame instanceof Float32Array)) return;
      try {
        const result = await this.run(opId, frame);
        // Reply on the SAME port the frame arrived on.
        port.postMessage({ type: 'ml.result', opId, nodeId, seq, result });
      } catch (err) {
        this._onError(err, { phase: 'run', opId, nodeId, seq });
        // Optional: notify worklet so it can hold last value or reset.
        try {
          port.postMessage({
            type: 'ml.error', opId, nodeId, seq,
            message: String(err?.message || err),
          });
        } catch { /* port may be dead — swallow */ }
      }
    };
    port.addEventListener('message', handler);
    if (typeof port.start === 'function') port.start();   // MessageChannel ports need .start()
    this._ports.add(port);
    return () => {
      // Detach helper — call to stop listening on this port.
      try { port.removeEventListener('message', handler); } catch { /* ignore */ }
      this._ports.delete(port);
    };
  }

  /**
   * Drop all sessions + listeners. After this, run() and getSession()
   * throw; further attachWorkletPort() calls also throw.
   */
  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    // Best-effort release each session.
    for (const [opId, p] of this._sessions) {
      try {
        const s = await p;
        if (s && typeof s.release === 'function') await s.release();
      } catch (err) {
        this._onError(err, { phase: 'dispose', opId });
      }
    }
    this._sessions.clear();
    this._ports.clear();   // listeners auto-collected with port objects
  }
}

export default MLRuntime;
