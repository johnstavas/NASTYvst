// morphReverbEngineNew.js — host-side wrapper that runs the NEW FxEngine
// locked-core worklet and loads the MorphReverb product.
//
// Sibling of the legacy src/morphReverbEngine.js. Kept as a separate file
// so the legacy engine stays untouched and the rack can A/B between them.
// Naming: the "...EngineNew.js" suffix avoids shadowing the legacy module
// while signalling that this is the migrated path.
//
// Same pattern as pantherBussEngine.js:
//   • createFxEngine(ctx)   — locked-core worklet
//   • createMorphReverb(fx) — product macros (morph/size/decay/tone/
//                             density/warp/width/mix)
//   • expose { input, output, setBypass, dispose } + getOutputPeak
//
// No DSP changes. No architecture changes. Pure composition.

import { createFxEngine } from './core/fxEngine.js';
import { createMorphReverb } from './core/products/morphReverb.js';

export async function createMorphReverbEngineNew(ctx) {
  const fx = await createFxEngine(ctx);
  const product = createMorphReverb(fx);

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

    // Product macros — all route through fx.setParam inside the product
    setMorph  : v => product.setMorph(v),
    setSize   : v => product.setSize(v),
    setDecay  : v => product.setDecay(v),
    setTone   : v => product.setTone(v),
    setDensity: v => product.setDensity(v),
    setWarp   : v => product.setWarp(v),
    setWidth  : v => product.setWidth(v),
    setMix    : v => product.setMix(v),

    setBypass : on => fx.setBypass(!!on),
    getState  : () => product.getState(),
    loadPreset: p  => product.loadPreset(p),

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
