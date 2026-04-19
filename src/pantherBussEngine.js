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

  // Input-side analyser for the IN meter on the Panther UI.
  const analyserIn = ctx.createAnalyser();
  analyserIn.fftSize = 512;
  analyserIn.smoothingTimeConstant = 0;
  fx.input.connect(analyserIn);

  const _buf    = new Float32Array(analyser.fftSize);
  const _bufIn  = new Float32Array(analyserIn.fftSize);
  const DECAY = 0.94;
  let _smoothPeak = 0, _smoothPeakIn = 0;
  function _peakFrom(node, buf, prev) {
    node.getFloatTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > m) m = a;
    }
    return Math.max(m, prev * DECAY);
  }
  function getOutputPeak() { _smoothPeak   = _peakFrom(analyser,   _buf,   _smoothPeak);   return _smoothPeak;   }
  function getInputPeak()  { _smoothPeakIn = _peakFrom(analyserIn, _bufIn, _smoothPeakIn); return _smoothPeakIn; }

  return {
    // Host graph contract
    input:       fx.input,
    output:      fx.output,
    chainOutput: fx.output,

    // ── QC HARNESS SCHEMA ─────────────────────────────────────────────────
    // v1 Panther Buss intentionally collapses the legacy drumBus knobs into
    // 5 macros + bypass. DRIFT against legacy is tracked by the parity lens.
    paramSchema: [
      { name: 'setDrive',  label: 'Drive',  kind: 'unit', min: 0, max: 1, step: 0.01, def: 0.3 },
      { name: 'setGlue',   label: 'Glue',   kind: 'unit', min: 0, max: 1, step: 0.01, def: 0.3 },
      { name: 'setTone',   label: 'Tone',   kind: 'unit', min: 0, max: 1, step: 0.01, def: 0.5 },
      { name: 'setOutput', label: 'Output', kind: 'unit', min: 0, max: 1, step: 0.01, def: 0.5 },
      { name: 'setMix',    label: 'Mix',    kind: 'unit', min: 0, max: 1, step: 0.01, def: 1   },
      { name: 'setBypass', label: 'Bypass', kind: 'bool', def: 0 },
    ],

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
    getInputPeak,
    connect(dest)  { fx.output.connect(dest); },
    disconnect()   { try { fx.output.disconnect(); } catch {} },
    dispose() {
      try { product.dispose?.(); } catch {}
      try { fx.output.disconnect(); } catch {}
      try { fx.input.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      try { analyserIn.disconnect(); } catch {}
    },
  };
}
