// workletLoader.js — one-shot AudioWorklet registration for sandbox ops.
//
// Mirrors the Blob + addModule pattern used in src/core/fxEngine.js. We
// don't touch Vite's worklet plugin — the source is a string, we wrap it
// in a Blob, register it, done. Keeps the build config dumb.
//
// WeakSet cache is keyed by AudioContext, so a context that goes away
// frees its entry automatically. Callers must await before compiling a
// graph that contains any sandbox worklet op.

import { SANDBOX_WORKLET_SOURCE } from './workletSources.js';

const _registered = new WeakSet();
const _pending    = new WeakMap(); // ctx → Promise (dedupe concurrent calls)

export async function ensureSandboxWorklets(ctx) {
  if (!ctx) throw new Error('ensureSandboxWorklets: ctx required');
  if (_registered.has(ctx)) return;
  const existing = _pending.get(ctx);
  if (existing) return existing;

  const p = (async () => {
    const blob = new Blob([SANDBOX_WORKLET_SOURCE], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
      _registered.add(ctx);
    } finally {
      URL.revokeObjectURL(url);
      _pending.delete(ctx);
    }
  })();

  _pending.set(ctx, p);
  return p;
}

export function isSandboxWorkletReady(ctx) {
  return _registered.has(ctx);
}
