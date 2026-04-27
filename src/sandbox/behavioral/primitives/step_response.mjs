// step_response.mjs — attack/release timing extraction.
//
// Citation: IEC 60268-3 (amplifier measurement) defines attack as "time for
// output to reach within 2 dB of new steady state." The 1/e (63.2%) and 90%
// conventions are also industry-common. Per design doc § 5.5, harness uses
// **90% reach time** ("T90") to match plugin GUI labeling convention used
// by SSL, FabFilter, iZotope datasheets.

/**
 * Build a level-step stimulus sine wave: amplitude levelA for the first
 * stepAtSec seconds, then jumps to levelB for the remainder.
 *
 * @param {number} N         total sample count
 * @param {number} sr        sample rate
 * @param {number} freqHz    sine carrier frequency
 * @param {number} levelA    initial amplitude (linear)
 * @param {number} levelB    post-step amplitude (linear)
 * @param {number} stepAtSec time of step
 * @returns {Float32Array}
 */
export function levelStepSine(N, sr, freqHz, levelA, levelB, stepAtSec) {
  const out = new Float32Array(N);
  const stepSample = Math.floor(stepAtSec * sr);
  const w = 2 * Math.PI * freqHz / sr;
  for (let i = 0; i < N; i++) {
    const amp = i < stepSample ? levelA : levelB;
    out[i] = amp * Math.sin(w * i);
  }
  return out;
}

/**
 * Build a level-step DC stimulus (positive constant levelA, jump to levelB).
 * Used for compressor CV-input characterization where we feed a known cv level
 * directly without going through an envelope follower.
 */
export function levelStepDC(N, sr, levelA, levelB, stepAtSec) {
  const out = new Float32Array(N);
  const stepSample = Math.floor(stepAtSec * sr);
  for (let i = 0; i < N; i++) out[i] = i < stepSample ? levelA : levelB;
  return out;
}

/**
 * Compute envelope (RMS or absolute-peak) of a buffer at hopSize sample
 * intervals. Window size set to ~5 ms by default for fine resolution.
 *
 * @returns {{ times: Float32Array, env: Float32Array }} times in seconds, env in linear
 */
export function envelopeRMS(buf, sr, windowSec = 0.005, hopSec = 0.001) {
  const win = Math.max(1, Math.round(windowSec * sr));
  const hop = Math.max(1, Math.round(hopSec * sr));
  const half = Math.floor(win / 2);
  const M = Math.floor((buf.length - win) / hop) + 1;
  const times = new Float32Array(M);
  const env   = new Float32Array(M);
  for (let m = 0; m < M; m++) {
    const center = m * hop + half;
    let sum = 0;
    const start = m * hop;
    for (let i = 0; i < win; i++) {
      const s = buf[start + i];
      sum += s * s;
    }
    env[m]   = Math.sqrt(sum / win);
    times[m] = center / sr;
  }
  return { times, env };
}

/**
 * Find the time at which an envelope first crosses (and stays at) a target
 * level, expressed in dB relative to the post-step steady state. Used for T90
 * (target = -1 dB from final ≈ 90% in linear) or similar fractional reach.
 *
 * Method:
 *   1. Estimate steady-state envelope from the last 20% of the trace
 *   2. Compute target level = steady · 10^(thresholdDb/20)
 *   3. Walk forward from stepAtSec; first sample where env crosses the target
 *      AND stays within thresholdDb for at least settleSec is the reach time
 *
 * @param {Float32Array} times       envelope times (seconds)
 * @param {Float32Array} env         envelope values (linear)
 * @param {number} stepAtSec         time of input step
 * @param {number} thresholdDb       target dB from steady (e.g. -1 for T90;
 *                                   for compressor release where envelope is
 *                                   FALLING, pass -1 and the function detects
 *                                   the direction)
 * @param {number} settleSec         minimum dwell time at target to confirm
 * @returns {{ reachSec: number|null, steadyLinear: number, direction: 'rise'|'fall' }}
 */
export function findReachTime(times, env, stepAtSec, thresholdDb = -1, settleSec = 0.005) {
  // Steady = mean of last 20% of envelope (post-step settled value).
  const M = env.length;
  const lastStart = Math.floor(M * 0.8);
  let sum = 0, n = 0;
  for (let i = lastStart; i < M; i++) { sum += env[i]; n++; }
  const steady = n > 0 ? sum / n : 0;

  // Initial level = mean of envelope BEFORE step.
  let stepIdx = 0;
  while (stepIdx < M && times[stepIdx] < stepAtSec) stepIdx++;
  let preSum = 0, preN = 0;
  for (let i = 0; i < stepIdx; i++) { preSum += env[i]; preN++; }
  const initial = preN > 0 ? preSum / preN : 0;

  const direction = steady > initial ? 'rise' : 'fall';

  // Target: thresholdDb (negative) below steady for rises = approaching from below.
  // For falls (release), target is thresholdDb (negative) above steady = approaching from above.
  const ratio = Math.pow(10, thresholdDb / 20);
  // For rise (target between initial and steady): target = steady · ratio (slightly below steady from above-1 dir)
  // We want the first time env reaches at least 90% of (steady - initial) past initial.
  // Use 0.9-of-span method universally — more robust than dB-relative-to-steady when steady ≈ 0.
  const span = steady - initial;
  const target = initial + 0.9 * span; // 90% of total excursion
  // For a fall, span < 0, target is below initial. The "first crossing" logic flips.

  const settleSamples = Math.max(1, Math.round(settleSec * (1 / (times[1] - times[0] || 0.001))));

  for (let i = stepIdx; i < M - settleSamples; i++) {
    const v = env[i];
    const crossed = direction === 'rise' ? v >= target : v <= target;
    if (!crossed) continue;
    // Confirm dwell — every sample for the next settleSamples must remain on the target side.
    let stayed = true;
    for (let j = 1; j <= settleSamples && i + j < M; j++) {
      const u = env[i + j];
      const ok = direction === 'rise' ? u >= target * 0.95 : u <= target / 0.95;
      if (!ok) { stayed = false; break; }
    }
    if (stayed) {
      return { reachSec: times[i] - stepAtSec, steadyLinear: steady, direction };
    }
  }

  return { reachSec: null, steadyLinear: steady, direction };
}

/**
 * Helper: convert a measured T90 value to PASS/FAIL against a declared
 * attack/release time within tolerance.
 */
export function withinTolerance(measuredMs, declaredMs, tolerancePct) {
  if (measuredMs == null) return false;
  const lower = declaredMs * (1 - tolerancePct / 100);
  const upper = declaredMs * (1 + tolerancePct / 100);
  return measuredMs >= lower && measuredMs <= upper;
}
