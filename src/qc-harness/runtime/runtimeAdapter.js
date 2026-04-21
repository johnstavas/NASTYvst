// src/qc-harness/runtime/runtimeAdapter.js
//
// RuntimeAdapter — the workbench's audio-runtime boundary.
//
// The QC subsystem of the workbench runs offline renders to measure plugin
// behaviour. Today that means OfflineAudioContext in a browser. Tomorrow
// (when the workbench ships as a standalone app) it means a native audio
// runtime (JUCE headless, Rust + CPAL, whatever). Everything above this
// boundary — rules, Finding shape, userFix, state machine, Repair pane —
// is runtime-agnostic by design. This file locks that agnosticism in.
//
// ── Adapter contract ────────────────────────────────────────────────────
//
//   adapter.isAvailable(): boolean
//     True when this runtime can perform offline renders in the current
//     environment. Tests run their own, the web runtime checks for
//     OfflineAudioContext, etc.
//
//   adapter.renderOffline({
//     sampleRate:  number,
//     length:      number,                    // samples
//     stimulus:    { L: Float32Array, R: Float32Array, length: number },
//     buildChain:  (ctx) => Promise<{ input: AudioNode, output: AudioNode }>,
//                                              // ctx is adapter-specific;
//                                              // web = OfflineAudioContext.
//   }) → Promise<RenderedBuffer>
//
//   RenderedBuffer must expose an AudioBuffer-compatible subset:
//     numberOfChannels: number
//     length:           number
//     sampleRate:       number
//     getChannelData(c: number): Float32Array
//
//   We keep the AudioBuffer API rather than inventing a new one because
//   every capture hook already reads `buf.numberOfChannels` and
//   `buf.getChannelData(c)`. A native adapter can return a plain object
//   { numberOfChannels, length, sampleRate, getChannelData } with the
//   same signatures — no callsite changes.
//
// ── Why buildChain takes a ctx ──────────────────────────────────────────
//
// Each engine factory builds its own graph (AudioWorkletNode today,
// whatever equivalent tomorrow) and needs access to the rendering
// context for createBufferSource, createBuffer, etc. Passing `ctx`
// through keeps engine factories runtime-aware without the adapter
// needing to know about specific engine internals. When the runtime
// is native, engine factories get the native context; when web,
// OfflineAudioContext. The adapter is just the switchboard.
//
// ── Current adapters ────────────────────────────────────────────────────
//
//   WebAudioRuntimeAdapter — default. OfflineAudioContext-based.
//   (future) NativeRuntimeAdapter — Tauri/Electron host with native I/O.
//   (future) MockRuntimeAdapter — tests / deterministic fixtures.

import { webAudioRuntimeAdapter } from './webAudioRuntimeAdapter.js';

let _current = webAudioRuntimeAdapter;

/** Return the active runtime adapter. */
export function getRuntimeAdapter() {
  return _current;
}

/**
 * Swap the active runtime adapter. Intended for tests and for the
 * standalone-app boot path (Tauri/Electron would set the native adapter
 * before any QC render runs).
 * @param {object} adapter  implements { isAvailable, renderOffline }
 */
export function setRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter.renderOffline !== 'function') {
    throw new Error('setRuntimeAdapter: adapter must implement renderOffline()');
  }
  _current = adapter;
}

/** Restore the default (web) adapter. Test-helper convenience. */
export function resetRuntimeAdapter() {
  _current = webAudioRuntimeAdapter;
}
