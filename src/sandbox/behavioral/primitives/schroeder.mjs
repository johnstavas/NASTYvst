// schroeder.mjs — Schroeder backward integration for reverb decay (RT60).
//
// Citation: Schroeder, M. R. "New Method of Measuring Reverberation Time."
// JASA 37, 1965. ISO 3382-1:2009 codifies the procedure.
//
// EDC(t) = ∫_t^∞ h²(τ) dτ — backward integration of squared IR.
// Convert to dB: 10 · log10(EDC(t) / EDC(0)).
// T20: best-fit slope between -5 and -25 dB, extrapolated to -60 dB.
// T30: best-fit slope between -5 and -35 dB.
// EDT: 0 to -10 dB, extrapolated to 60 dB.
//
// Day 1 status: STUB. Reverb metric module lands Day 2 or later. This file
// reserved so reverb authors who jump ahead get a clear "not yet" signal
// rather than silent missing import.

export function schroederEDC(/* ir */) {
  throw new Error('schroederEDC: Day 2+ — Reverb metric module pending');
}

export function rt60FromEDC(/* edcDb */) {
  throw new Error('rt60FromEDC: Day 2+ — Reverb metric module pending');
}

export function edt(/* edcDb */) {
  throw new Error('edt: Day 2+ — Reverb metric module pending');
}
