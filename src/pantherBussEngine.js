// pantherBussEngine.js — host-side wrapper that runs the NEW FxEngine
// locked-core worklet and loads the Panther Buss product.
//
// Replaces the legacy drumBusEngine DSP entirely for the 'drumbus' slot.
// All parameter updates flow through fx.setParam (control-layer policy,
// STEP 24). No direct DSP state access; no UI-thread per-sample work.
//
// Exposes the same minimal contract the host App expects from every
// engine: { input, output, chainOutput, setBypass, getOutputPeak,
// dispose }, plus the five Panther macros.

import { createFxEngine } from './core/fxEngine.js';
import { createPantherBuss } from './core/products/pantherBuss.js';

export async function createPantherBussEngine(ctx) {
  const fx = await createFxEngine(ctx);
  const product = createPantherBuss(fx);

  // Peak analyser on the FX output — used only by the host's clip-glow
  // polling loop (read on UI thread at rAF rate; never writes DSP state).
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0;
  fx.output.connect(analyser);

  const _buf = new Float32Array(analyser.fftSize);
  const DECAY = 0.94;
  let _smoothPeak = 0;
  function getOutputPeak() {
    analyser.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) {
      const a = Math.abs(_buf[i]);
      if (a > m) m = a;
    }
    _smoothPeak = Math.max(m, _smoothPeak * DECAY);
    return _smoothPeak;
  }

  return {
    // Host graph contract
    input:       fx.input,
    output:      fx.output,
    chainOutput: fx.output,

    // Panther macros — all go through fx.setParam inside the product
    setDrive : v => product.setDrive(v),
    setGlue  : v => product.setGlue(v),
    setTone  : v => product.setTone(v),
    setOutput: v => product.setOutput(v),
    setMix   : v => product.setMix(v),

    setBypass: on => fx.setBypass(!!on),
    getState : () => product.getState(),
    loadPreset: p => product.loadPreset(p),

    getOutputPeak,
    connect(dest)  { fx.output.connect(dest); },
    disconnect()   { try { fx.output.disconnect(); } catch {} },
    dispose() {
      try { product.dispose?.(); } catch {}
      try { fx.output.disconnect(); } catch {}
      try { fx.input.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
    },
  };
}
