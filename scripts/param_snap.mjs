// param_snap.mjs — mirror JUCE AudioParameterFloat round-trip.
//
// Why this exists: APVTS hands params to the host as 0..1 float32 norm.
// The plugin reads them back via NormalisableRange::convertFrom0to1 + step
// snap. Both legs are float32. So a "raw" spec value the orchestrator
// supplies will be quantized by that pipeline before the plugin uses it.
//
// snapParamValue(raw, range) returns the actual value the plugin sees,
// so the JS reference and the .vst3 evaluate at the SAME number — no
// quantization-induced parity mismatch.
//
// JUCE order (mirrored exactly):
//   norm   = clamp01(float32((raw - min) / (max - min)))
//   back   = float32(min + norm * (max - min))
//   if (step > 0)
//       back = float32(round((back - min) / step) * step + min)
//
// All Math.fround() calls are deliberate — they collapse the value to
// the same float32 representation the host transports through.

export function snapParamValue(raw, range) {
  const min  = Number(range.min);
  const max  = Number(range.max);
  const step = Number(range.step ?? 0);
  if (!(max > min)) return Math.fround(min);
  let norm = (Number(raw) - min) / (max - min);
  if (norm < 0) norm = 0;
  if (norm > 1) norm = 1;
  norm = Math.fround(norm);
  let back = Math.fround(min + norm * (max - min));
  if (step > 0) {
    const k = Math.round((back - min) / step);
    back = Math.fround(k * step + min);
  }
  return back;
}

// Compute the float32 norm the orchestrator should hand to parity_host
// for a given raw value — i.e. the FIRST half of the round-trip above.
// This is what we send via params.json so the plugin's convertFrom0to1
// reproduces our snapped value bit-for-bit.
export function rawToNorm(raw, range) {
  const min = Number(range.min);
  const max = Number(range.max);
  if (!(max > min)) return 0;
  let norm = (Number(raw) - min) / (max - min);
  if (norm < 0) norm = 0;
  if (norm > 1) norm = 1;
  return Math.fround(norm);
}
