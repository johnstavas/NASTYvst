// src/qc-harness/runtime/webAudioRuntimeAdapter.js
//
// The default RuntimeAdapter — backed by OfflineAudioContext.
//
// This is exactly the code that used to live inline inside captureHooks.js
// as `renderGraph()`. Lifting it behind the adapter interface means when
// the workbench ships as a standalone app, the equivalent native adapter
// slots in without touching a single capture hook, rule, or Finding.
//
// Contract mirrors runtimeAdapter.js — see that file for the full shape.

/** True iff OfflineAudioContext is constructible in this environment. */
function isAvailable() {
  return typeof OfflineAudioContext !== 'undefined';
}

function bufferSourceFromStimulus(ctx, stimulus) {
  const buf = ctx.createBuffer(2, stimulus.length, ctx.sampleRate);
  buf.getChannelData(0).set(stimulus.L);
  buf.getChannelData(1).set(stimulus.R);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

/**
 * Render one offline graph: source → buildChain(ctx) → destination.
 * Resolves to the rendered AudioBuffer (which already satisfies the
 * RenderedBuffer contract: numberOfChannels + getChannelData).
 */
async function renderOffline({ sampleRate, length, stimulus, buildChain }) {
  if (!isAvailable()) {
    throw new Error('webAudioRuntimeAdapter: OfflineAudioContext unavailable');
  }
  // eslint-disable-next-line no-undef
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const src = bufferSourceFromStimulus(ctx, stimulus);
  const chain = await buildChain(ctx);
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

export const webAudioRuntimeAdapter = Object.freeze({
  id: 'web-audio',
  isAvailable,
  renderOffline,
});
