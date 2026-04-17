# DEFERRED — SYNTHESIS / INSTRUMENT ENGINE (FUTURE PHASE)

**Status:** Deferred. Do not process now. Keep separate from FX DSP system.

## Scope when resumed
Focus on synthesizer / instrument-engine concerns, not effect-processing:
- **Oscillators** — wavetable, FM (linear / exponential / through-zero), additive, BLEP/PolyBLEP/feedback-delay-loop antialiased classic waveforms
- **Filters** — analog-modeling VCF (Moog ladder, MS-20 diode-bridge, OTA, SEM, state-variable), self-oscillation, drive
- **Envelopes & voice architecture** — ADSR / DAHDSR / multi-segment, voice allocation, polyphony, voice stealing, unison, glide
- **MIDI → sound generation** — note-on/off pipeline, velocity curves, MPE, tuning tables, pitch-bend, aftertouch routing
- **Modulation system integration** — LFOs, envelopes, mod matrix, macro controls, MIDI CC mapping, audio-rate modulation routing

## Source material already in memory (when resuming, start here)
- `dafx_modulation_batch1.md` — AdaptiveFM, ExpFM bandwidth criterion, Practical Lin/Exp FM, alias-free feedback-delay-loop oscillators
- `dafx_distortion_batch1.md`–`batch3.md` — Moog ladder Volterra, MS-20 diode-bridge VCF WDF, OTA WDF, JFET / Ge-BJT / CMOS analog-stage models, ADAA family for oscillator/filter aliasing
- `dafx_distortion_batch3.md` — Buchla low-pass-gate (vactrol VCA+VCF combo), diode-VCA modeling
- `dafx_dynamics_batch1.md` — vactrol envelope archetype (reusable for synth amp envelopes with opto character)
- `jos_pasp_dsp_reference.md` and `jos_pasp_physical_modeling.md` — physical-modeling synthesis (strings, winds, voice, mesh) — pull when adding physical-model voice types
- `audio_engineer_mental_model.md` — six-systems framework still applies; instrument engine adds Pitch + Articulation + Voice-management as new primitives

## What is INTENTIONALLY excluded from this deferred item
- Effect-bus DSP (delay/reverb/distortion/dynamics/modulation/spatial) — those are the active FX system, already covered by `dafx_*_batch*.md` files.

## Resume signal
User will say something like: "Start synthesis engine" or "Move to instrument engine phase". Until then, keep all FX work and instrument-engine work in separate files; do not cross-pollinate architecture decisions.
