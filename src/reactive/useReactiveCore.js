// useReactiveCore — opt-in helper that names the five reactive signals already
// proven by Panther / Neve / DrumBus / MorphReverb shells.
//
//   energy    — signal-driven, smoothed output peak (one-pole IIR)
//   pulse     — time-driven, two summed sinusoids (slow beat + mid swell), smoothed
//   rage      — parameter-driven (drive), thresholded power S-curve, no audio
//   boom      — signal-driven low-band peak with asymmetric attack/release
//   transient — engine-supplied if available, else derived (peak − smoothed peak)
//
// Contract:
//   - One hook = one RAF (no central clock).
//   - Pull-based read of engineRef.current each frame.
//   - Returns signalsRef (mutable, NOT React state) so callers keep doing direct
//     DOM mutations, exactly like the existing shells. React is bypassed for
//     visuals on purpose.
//   - Engine methods are all optional. Missing methods leave signals at 0.
//   - Defaults are taken from Panther's tuning. All overridable via opts.
//
// This file is OPT-IN. Existing shells must not import it.

import { useEffect, useRef } from 'react';

const DEFAULTS = {
  // energy
  energyAlpha:   0.18,
  // pulse
  pulseAlpha:    0.08,
  pulseSlowHz:   2.4,
  pulseSlowAmp:  1.2,
  pulseMidHz:    7.0,
  pulseMidAmp:   0.4,
  // rage (parameter-driven; caller pushes drive via setDrive)
  rageThreshold: 0.08,
  rageRange:     0.55,
  rageCurve:     0.7,
  // boom (asymmetric on bass band)
  boomAttack:    0.95,
  boomRelease:   0.12,
  // transient derivation when engine doesn't supply one
  peakSmAlpha:   0.25,
};

export function useReactiveCore(engineRef, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  // Mutable signal bag. Callers read .current inside their own onTick / RAF /
  // DOM-mutation code. Never put these in React state — they update at 60 fps.
  const signalsRef = useRef({
    energy: 0, pulse: 0, rage: 0, boom: 0, transient: 0,
    peak:   0, peakSm: 0,
  });

  // Drive lives in a ref because rage is parameter-driven, not audio-driven —
  // the caller sets it from a knob handler. Keeping it in a ref avoids
  // re-subscribing the RAF every time the user wiggles a knob.
  const driveRef = useRef(0);
  const tickRef  = useRef(opts.onTick || null);

  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const eng = engineRef.current;
      const s   = signalsRef.current;
      const t   = (now - t0) / 1000;

      // ── energy: smoothed output peak ────────────────────────────────────
      const peak = (eng && eng.getOutputPeak) ? (eng.getOutputPeak() || 0) : 0;
      s.peak    = peak;
      s.energy += (peak - s.energy) * cfg.energyAlpha;

      // ── pulse: time-driven, audio-independent aliveness ─────────────────
      const raw =
          Math.sin(2 * Math.PI * cfg.pulseSlowHz * t) * cfg.pulseSlowAmp
        + Math.sin(2 * Math.PI * cfg.pulseMidHz  * t) * cfg.pulseMidAmp;
      s.pulse += (raw - s.pulse) * cfg.pulseAlpha;

      // ── rage: parameter-driven S-curve on drive ─────────────────────────
      const d = driveRef.current;
      s.rage = Math.min(1, Math.pow(
        Math.max(0, d - cfg.rageThreshold) / cfg.rageRange,
        cfg.rageCurve,
      ));

      // ── boom: low-band peak with asymmetric A/R ─────────────────────────
      const rawBoom = (eng && eng.getBassLevel) ? (eng.getBassLevel() || 0) : 0;
      const a = rawBoom > s.boom ? cfg.boomAttack : cfg.boomRelease;
      s.boom = s.boom * (1 - a) + rawBoom * a;

      // ── transient: prefer engine value, else derive from peak − smoothed ─
      s.peakSm += (peak - s.peakSm) * cfg.peakSmAlpha;
      const trDerived = Math.max(0, peak - s.peakSm);
      s.transient = (eng && eng.getTransient)
        ? (eng.getTransient() || 0)
        : trDerived;

      const cb = tickRef.current;
      if (cb) cb(s);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engineRef]);

  return {
    signalsRef,
    setDrive:  (v) => { driveRef.current = v; },
    setOnTick: (fn) => { tickRef.current = fn; },
  };
}
