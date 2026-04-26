// MLRuntime.web.js — browser/sandbox wiring for the host-side ML runner.
//
// Thin adapter that wires `MLRuntime` to ORT-Web + `fetch('/models/...')`.
// Use this in NastyOrbsCanvas (sandbox) or any WAM host page; do NOT import
// it from anything that runs inside an `AudioWorkletGlobalScope`.
//
// Usage:
//   import { createBrowserMLRuntime } from '@/sandbox/host/MLRuntime.web.js';
//   const ml = await createBrowserMLRuntime();
//   ml.attachWorkletPort(crepeWorkletNode.port);
//
// The sandbox host owns the runtime's lifetime — call `ml.dispose()` on
// teardown (e.g., when an `AudioContext` is closed) to release ORT
// sessions cleanly.
//
// === Why ORT-Web here, not in the worklet ===
// See codegen_design.md §13 (Async ML ops). ORT-Web's WASM bundle assumes
// `globalThis.self` and inspects `os.cpus()` to pick a backend, which
// `AudioWorkletGlobalScope` lacks. Inference must run on the main thread
// (or a SharedArrayBuffer Worker spun up from the main thread).

import * as ort from 'onnxruntime-web';
import { MLRuntime } from './MLRuntime.js';

/**
 * Default model loader: `fetch('/models/<opId>.onnx')` → ArrayBuffer.
 *
 * The `/models/` path resolves against the bundle root (codegen_design.md
 * §12). In dev (Vite) this maps to `public/models/<opId>.onnx`. In a
 * `.shagsplug` bundle deployed via WAM this maps to the bundle's `models/`
 * directory (the WAM host serves bundle assets under their bundle-relative
 * paths).
 */
async function defaultLoadModel(opId) {
  const url = `/models/${opId}.onnx`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`MLRuntime.web: fetch ${url} failed (${res.status} ${res.statusText})`);
  }
  return await res.arrayBuffer();
}

/**
 * Build a browser-tier `MLRuntime` ready to receive worklet `ml.frame`
 * messages. Returns the live runtime instance; call `dispose()` on
 * teardown.
 *
 * @param {object}   [opts]
 * @param {function} [opts.loadModel]  Override the default fetch-based loader
 *                                     (e.g., to load from an OPFS bundle).
 * @param {function} [opts.onError]    Per-frame inference error sink
 *                                     (default: console.error).
 */
export function createBrowserMLRuntime(opts = {}) {
  return new MLRuntime({
    ort,
    loadModel: opts.loadModel || defaultLoadModel,
    onError:   opts.onError,
  });
}

export { MLRuntime };
export default createBrowserMLRuntime;
