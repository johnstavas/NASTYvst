// nastyBeastEngine.worklet.js — B1 worklet-refactor build.
//
// This is the NEW engine for Flap Jack Man. It replaces the native
// WebAudio graph in nastyBeastEngine.js with a single master worklet that
// owns dry/wet mix, bypass, and eventually all DSP stages.
//
// The old nastyBeastEngine.js stays intact until every stage is ported and
// the user signs off on sonic parity. Switch is flipped in
// src/migration/registry.js by pointing prototype / v1 at this factory.
//
// Port plan: memory/flapjackman_port_scope.md
//
// STAGE 0 — worklet shell.
//   Worklet is a pass-through (input → output identity). DSP stages will be
//   added one at a time. At Stage 0, null-test against raw input must be
//   bit-exact (< −120 dB or floor), verifying the compliance scaffold
//   (in-worklet cos/sin mix + binary bypassRelay + denormal-guard-ready
//   processor class + pre-inGain bypass tap) is correct before any DSP
//   lands.
//
// Compliance template inherited from ManChild:
//   - dry/wet mix is IN the worklet (same-sample cos/sin)
//   - bypass is external but BINARY (0 or 1 only, never fractional)
//   - bypass tap is pre-inGain (so IN knob cannot leak into bypass path)
//   - denormal guard pattern reserved for feedback state
//     (x = Math.abs(x) < 1e-30 ? 0 : x) — unused at Stage 0, required Stage 6
//
// External graph:
//   input ──┬─→ bypassRelay (binary) ────────────────→ sumNode
//           └─→ inTrim → worklet → outTrim → wetGain → sumNode
//   sumNode → fadeIn → output
//
// Note: wetGain stays at unity during operation. Parallel-mix blending is
// handled by the worklet's internal dry/wet crossfade. bypassRelay only
// ever carries signal at bypass=ON (wetGain=0), so it cannot comb-filter.

const PROCESSOR_VERSION = 'fjm-v1';

// ── Worklet processor source ────────────────────────────────────────────
//
// STAGES 1–3 + 6 body:
//   Stage 1 — 4-biquad BODY chain + Master HPF/LPF, wet-path-only.
//   Stage 2 — FANG saturator between BODY and Master. Fixed-curve tanh LUT
//             (byte-for-byte identical formula to the prototype
//             WaveShaperNode) + smooth preDrive from FEED, SNARL DC bias,
//             5500 Hz fangPostLP darkening, 1/√drive makeup, equal-power
//             wet/dry crossfade so FEED=0 skips the shaper entirely.
//   Stage 3 — DOUBLER micro-detune thickening. Two mono-summed delay-
//             modulated voices (11 ms / 15 ms centers, 4 slow LFOs),
//             panned L/R, mixed back into wet bus at 6%. Byte-for-byte
//             port of prototype makeDoublerVoice() parameters.
//   Stage 6 — DELAY ENGINE. 3-tap Memory-Man / Space-Echo-style delay
//             fed from the post-DOUBLER wet bus. DRIZZLE (haunt) =
//             time 80..1200 ms; STACK (roam) = feedback 0..95%.
//             Feedback path runs through the FANG tanh LUT (pre-
//             attenuated by 0.5 so small-signal loop gain stays ≤ 1,
//             tanh ceiling self-limits blow-up at max feedback — this
//             is the "repeats thicken and hit a wall" Memory Man
//             trick). 3 taps at ratios 1.0 / 0.667 / 0.333 of main
//             time, gains 1.0 / 0.5 / 0.3 — multi-head feel without
//             a true multi-head topology. Sum mixed into wet bus at
//             DLY_WET = 0.5 before Master HP/LP. Flips hasFeedback
//             true and bumps nonlinearStages (FANG + in-loop sat).
//
// All filters, shaper, DOUBLER delay lines, and the delay engine live
// on the WET leg, BEFORE the dry/wet sum. The mix itself stays a pure
// cos·wet + sin·dry — Mix=0 returns input bit-exactly, satisfying the
// Dry/Wet Mix Rule (this is what fixed the mix_null_series −28 dB
// regression after the first Stage-1 sweep).
//
// Stage 5  — PITCH GHOST granular OLA, dual-voice (octave-up shimmer +
//            octave-down sub-shadow blended by FLUFF). LANDED.
// Stage 7  — PING-PONG stereo delay with BUTTER-scaled depth/xfb. LANDED.
// Stage 8  — GLUE comp (feedforward peak detector, soft knee, stereo-
//            linked) + FLIP CHORUS (single-voice modulated delay,
//            parallel wet add, same LFO L/R) + BEAST auto-makeup
//            (per-sample RMS follower with refRms latched at engage,
//            clamp [0.6, 1.3], 180 ms smoothing). All three quiescent
//            at beast=0; scale together as beast rises, giving FLIP
//            its "tighten + shimmer + level-match" character. LANDED.
// Stage 9  — TUNE (granular shifter, ±12 semitones, wet-bus cross-
//             fade with dry/down/up amounts = 1−|t|/−t/+t). LANDED.
const PROCESSOR_CODE = `
// ── Biquad filter indexing ────────────────────────────────────────────
// Order is fixed across BIQ_COEF and state arrays:
//   0  subHP       highpass 30 Hz   Q=0.5        (BODY)
//   1  body        peaking  160 Hz  Q=0.7 +1.5dB (BODY)
//   2  lowMid      peaking  380 Hz  Q=0.9 +0.5dB (BODY)
//   3  harshCut    peaking  3200 Hz Q=1.2 -2.0dB (BODY)
//   4  fangPostLP  lowpass  5500 Hz Q=0.5        (FANG — darker lid)
//   5  masterHP    highpass hpfHz   Q=0.5        (wet chain, user-controlled)
//   6  masterLP    lowpass  lpfHz   Q=0.5        (wet chain, user-controlled)
const NBQ = 7;

// FANG shaper LUT size — matches prototype WaveShaperNode.curve.length.
const FANG_LUT_N = 4096;
const FANG_K     = 2.0;

// ── DOUBLER constants ────────────────────────────────────────────────
// Byte-for-byte port of prototype makeDoublerVoice() calls:
//   voice1: center 11 ms, pan −0.20, LFO-A 0.27 Hz / 0.5 ms,
//                              LFO-B 0.83 Hz / 0.25 ms
//   voice2: center 15 ms, pan +0.20, LFO-A 0.41 Hz / 0.6 ms,
//                              LFO-B 0.59 Hz / 0.30 ms
//   voice-gain = 0.5, doublerWet = 0.06 → final contribution per voice
//   = 0.03·mono after panning. "Felt, not heard."
// Buffer size: max delay ≈ 16 ms + modulation = ~800 samples at 48 kHz.
// 2048 gives headroom through 96 kHz hosts.
const DBL_BUF = 2048;
const DBL_MASK = DBL_BUF - 1;
const DBL_V1_CENTER_MS = 11.0, DBL_V1_FA_HZ = 0.27, DBL_V1_FB_HZ = 0.83;
const DBL_V1_DEPTH_A   = 0.5,  DBL_V1_DEPTH_B = 0.25, DBL_V1_PAN = -0.20;
const DBL_V2_CENTER_MS = 15.0, DBL_V2_FA_HZ = 0.41, DBL_V2_FB_HZ = 0.59;
const DBL_V2_DEPTH_A   = 0.6,  DBL_V2_DEPTH_B = 0.30, DBL_V2_PAN = +0.20;
const DBL_VOICE_GAIN   = 0.5;
const DBL_WET          = 0.06;
const TWO_PI           = Math.PI * 2;

// ── DELAY ENGINE constants (Stage 6) ─────────────────────────────────
// Memory-Man / Space-Echo inspired 3-tap delay with in-loop tanh sat.
//   Buffer: 262144 samples = 2^18 → headroom for 1200 ms at 192 kHz
//           (1200·192 = 230 400, next pow-of-2 is 262 144). Mask wrap
//           keeps the inner-loop branchless.
//   DLY_MIN_MS 80 / DLY_MAX_MS 1200: classic Memory Man time range.
//           haunt=0 is a tight 80 ms slapback, not silence — the delay
//           is always engaged once the plugin is off bypass. User
//           mutes via setMix=0.
//   Tap ratios/gains: ratios 1.0 / 0.667 / 0.333 give a multi-head
//           cascade feel from a single time control. Gains 1.0/0.5/0.3
//           picked by ear so the sum sits at roughly the main-tap
//           loudness without crowding the bus.
//   DLY_FB_PRE_GAIN 0.5: the FANG tanh LUT has small-signal gain ≈ 2
//           (K=2 shaping normalized by tanh(K)), so the feedback path
//           pre-attenuates by 0.5 to land loop gain near 1. Math:
//           loop_gain = 0.5 · 2.07 · fb_max = 0.5·2.07·0.95 ≈ 0.98.
//           Small signals decay slightly, large signals get caught by
//           the tanh ceiling. Stable at max STACK.
//   DLY_WET 0.5: delay bus contribution to wet sum. Picked so a
//           single repeat at moderate haunt / zero roam / zero feed
//           sits clearly audible alongside the dry-leg at default
//           Mix, without swamping it.
const DLY_BUF         = 262144;
const DLY_MASK        = DLY_BUF - 1;
const DLY_MIN_MS      = 80;
const DLY_MAX_MS      = 1200;
const DLY_TAP1_RATIO  = 1.0;
const DLY_TAP2_RATIO  = 0.667;
const DLY_TAP3_RATIO  = 0.333;
const DLY_TAP1_GAIN   = 1.0;
const DLY_TAP2_GAIN   = 0.5;
const DLY_TAP3_GAIN   = 0.3;
const DLY_WET         = 0.5;
const DLY_FB_PRE_GAIN = 0.5;
const DLY_FB_MAX      = 0.95;
// Damping lowpass on the feedback signal — Memory Man / Space Echo
// analog models lose top end every circulation (BBD rolloff / tape
// head loss), which is what keeps high-STACK settings musical. Without
// it, FANG-distorted content re-saturates through the in-loop tanh
// each pass and high-freq hash piles up = buzz. 3.5 kHz is in the
// Memory Man ballpark; tune later if needed.
const DLY_FB_LP_HZ    = 3500;

// ── STAGE 7: PING-PONG stereo delay constants ─────────────────────
// Brings BUTTER (spread) to life. Topology: two delay lines (L at
// 260 ms, R at 330 ms — prime-ish ratio so taps don't align into a
// comb), each fed from the wet bus with a per-channel send, modulated
// by independent slow LFOs (0.27 / 0.39 Hz — irrational-ish pair,
// inspired by prototype :300-371). Cross-feedback = opposite-channel
// tap run through a tanh soft-sat (K=1.1), panned hard L/R into the
// wet bus. BUTTER (spread) scales send/mix/xfb/depth together so a
// single knob sweep moves from "off" → "wide stereo dub" without
// needing four sliders. 90° LFO phase offset (pingLfoR = π/2) keeps
// the two channels from breathing in lockstep — subtle chorus-like
// shimmer on sustained tones.
const PING_BUF        = 131072;             // power of 2, ≥ 2.7 s @ 48 kHz
const PING_MASK       = PING_BUF - 1;
const PING_BASE_L_MS  = 260;
const PING_BASE_R_MS  = 330;
const PING_LFO_L_HZ   = 0.27;
const PING_LFO_R_HZ   = 0.39;
const PING_DEPTH_MS   = 6;                  // peak modulation depth at full BUTTER
const PING_SAT_K      = 1.1;                // tanh(K·x) / tanh(K) soft-sat on xfb
const PING_SEND_MAX   = 0.40;
// MIX ceiling reduced 0.60 → 0.45. Gain audit on drum material with BUTTER
// + STACK cranked showed wL peaks near ±1.0 pre-Stage-7, and adding
// pingMix·pTap at 0.60 overshot unity into the master filters and the
// final mix sum — audible as a "touch of clipping." 0.45 keeps the
// effect loud enough to be the star of BUTTER's character without
// stacking beyond the ceiling. Further protected by equal-power
// wet-bus duck (see wetDuck below) so BUTTER-up doesn't simply
// pile energy on top of an already-hot wet bus.
const PING_MIX_MAX    = 0.45;
const PING_XFB_MAX    = 0.35;

// ── STAGE 5: PITCH GHOST (granular OLA, dual-voice blend) constants ──
// Brings FLUFF (breath) to life. Worklet port collapses the prototype's
// DelayNode + sawtooth-ramp + Hann-gate pattern into four ring-buffer
// reads per sample: two DOWN-voice grains (ratio 0.5, octave down) and
// two UP-voice grains (ratio 2.0, octave up), each pair half-period
// offset for Hann-COLA crossfade.
//
// Grain = 80 ms. Period_DN = 160 ms (delay ramps 0→grain), period_UP =
// 80 ms (delay ramps grain→0). Shared mono ring buffer (GHOST_BUF) fed
// by pre-LP'd mono sum of the wet bus.
//
// FLUFF macro drives a two-stage blend curve:
//   0..50% knob  → shimmer (UP) ramps 0→max, DOWN stays off
//   50..100%     → shimmer stays at max, sub-shadow (DOWN) fades 0→max
// At full knob both voices stack, giving air + body. DOWN runs through
// post-LP @ 1800 Hz to read as a dark sub-shadow; UP skips post-LP so it
// keeps its airy character. Ceilings: UP 0.22, DOWN 0.14.
//
// Ghost output is summed BOTH into the delay input (for cascade/dub
// smear with DRIZZLE+STACK) AND directly into the wet bus, so FLUFF is
// audible at clean-mix settings without requiring delay to be up.
const GHOST_BUF        = 8192;              // power of 2, covers 80ms+slack @ 48kHz
const GHOST_MASK       = GHOST_BUF - 1;
const GHOST_GRAIN_MS   = 80;
// Dual-voice blend (Option C — user-requested, 2026-04-21):
//   Low FLUFF (0..50%)  → octave-up shimmer only (airy "breath")
//   High FLUFF (50..100%) → sub-octave shadow joins in (doubles weight/body)
// Both voices share the ghostBuf (pre-LP'd input). Down-voice runs through
// post-LP @ 1800Hz (darkens into a sub-shadow). Up-voice skips post-LP so
// it retains its high-frequency air character.
const GHOST_RATIO_DN   = 0.5;               // one octave down (sub shadow)
const GHOST_RATIO_UP   = 2.0;               // one octave up (airy breath)
const GHOST_PERIOD_MS_DN = GHOST_GRAIN_MS / Math.abs(1 - GHOST_RATIO_DN); // 160 ms
const GHOST_PERIOD_MS_UP = GHOST_GRAIN_MS / Math.abs(1 - GHOST_RATIO_UP); //  80 ms
const GHOST_MIX_MAX_DN = 0.14;              // sub-shadow ceiling (original)
const GHOST_MIX_MAX_UP = 0.22;              // breath ceiling — up-voice gets louder because
                                            // it carries perceptual weight (air, not body).
const GHOST_PRE_LP_HZ  = 2400;
const GHOST_POST_LP_HZ = 1800;              // applied only to DOWN voice

// ── STAGE 8: GLUE comp + FLIP chorus + Beast auto-makeup constants ──
// Brings FLIP/BEAST to life. Quiescent at beast=0 (comp threshold high
// enough to never trigger, chorus wet=0, auto-makeup inactive). As BEAST
// rises, all three engage in lockstep to "tighten" the wet bus.
//
// Prototype used a WebAudio DynamicsCompressor node; we port to an in-
// loop feedforward peak-detector with soft-knee gain-reduction. Same
// threshold/ratio/attack/release values as prototype.
//   GLUE thresh  sweeps -3 dB → -20 dB   (transparent at rest, firm at max)
//   GLUE ratio   sweeps 1.5   → 5.0      (glue, not limiter)
//   GLUE attack  = 3 ms        (catches transients without ringing)
//   GLUE release = 60 ms       (tight glue release)
//   GLUE knee    = 4 dB        (firm shoulder, not razor)
const GLUE_ATK_MS       = 3;
const GLUE_REL_MS       = 60;
const GLUE_KNEE_DB      = 4;
const GLUE_TH_DB_MIN    = -3;               // beast=0  threshold
const GLUE_TH_DB_RANGE  = -17;              // beast=1  → -20 dB
const GLUE_RATIO_MIN    = 1.5;
const GLUE_RATIO_RANGE  = 3.5;              // beast=1  → 5.0

// CHORUS — single voice modulated delay, same LFO on both channels
// (stereo-parallel, identical modulation). Subtle shimmer; not vibrato.
//   base delay   = 12 ms
//   depth        = 0 → 3.5 ms   (beast-driven swing)
//   LFO          = 0.55 Hz sine
//   wet amount   = 0 → 0.22     (beast-driven parallel mix)
const CHORUS_BASE_MS    = 12;
const CHORUS_DEPTH_MS   = 3.5;
const CHORUS_LFO_HZ     = 0.55;
const CHORUS_WET_MAX    = 0.22;
const CHORUS_BUF        = 8192;             // power of 2, >> worst-case 15.5ms @ 48kHz
const CHORUS_MASK       = CHORUS_BUF - 1;

// ── STAGE 9: TUNE (granular OLA, ±12 semi, wet-bus crossfade) ─────
// Prototype wiring: wDelay (post-glue/post-chorus wet bus) fans into
// three legs — dry (amount 1-|tune|), down-shifter (−12 semi, amount
// max(0,−tune)), up-shifter (+12 semi, amount max(0,+tune)) — summed
// back onto the wet bus before the final mix. Tune ∈ [−1, +1].
//
// Reuses the same granular OLA math as Stage 5 ghost — two voices per
// direction, Hann-windowed, half-period-offset for crossfade. Grain
// 80 ms, period 160 ms (down) / 80 ms (up). DIFFERENCES from ghost:
//   (1) Stereo — Stage 5 ghost is mono-summed; TUNE preserves L/R
//       because it sits on the wet bus (ping-pong + chorus already
//       decorrelated L/R) and collapsing to mono at this stage would
//       kill stereo width.
//   (2) No LP darkening — ghost sub-shadow gets 2.4 kHz pre-LP +
//       1.8 kHz post-LP to hide grain edges at low mix levels. TUNE
//       is the featured voice at ±1, so it needs full bandwidth.
//   (3) Linear crossfade on the knob (matches prototype setTune) —
//       dry = 1−|tune|, dn = max(0,−tune), up = max(0,+tune). At
//       tune=0, dry=1 exactly → zero-cost bypass.
// Shares grain+period samples with ghost, but runs independent phase
// accumulators and its own stereo ring buffers (can't alias ghost's
// buffer — it's fed from a different node in the signal chain).
const TUNE_BUF          = 8192;
const TUNE_MASK         = TUNE_BUF - 1;
const TUNE_GRAIN_MS     = 80;
const TUNE_PERIOD_MS_DN = 160;               // ratio 0.5 → period = grain/|1-0.5|
const TUNE_PERIOD_MS_UP = 80;                // ratio 2.0 → period = grain/|1-2.0|

// BEAST auto-makeup — peak-tracked inverse-GR level compensation.
// DIVERGES FROM PROTOTYPE by design (see Stage 8 notes 2026-04-21).
//
// Prototype used a slow RMS follower with a hard clamp [0.6, 1.3] to
// push wet bus back toward a reference RMS. Two failure modes:
//   (a) Clamp couldn't restore full GR at heavy FLIP (capped at +2.3 dB
//       makeup vs −4…−5 dB of sustained GR → net perceived drop).
//   (b) Asymmetric response: RMS-chase pushed level on sustain but
//       couldn't compensate transient-only GR → "sustain collapse"
//       feel (body gets grabbed, peaks stay capped, makeup can't tell
//       the difference).
//
// V2 tracks the comp's instantaneous GR directly in dB, smooths it with
// a symmetric time constant, and applies the inverse as makeup gain.
// Result: whatever the comp pulls down for longer than ~180 ms gets
// restored exactly; shorter transient GR passes through untouched so
// GLUE's attack-shaping character is preserved. No clamp needed —
// inverse of 0 dB GR is 0 dB makeup, so silence does not chase.
//
//   Makeup smoothing TC = 180 ms  (faster than GR → pump; slower → flat)
const BEAST_MAKEUP_TC_S  = 0.18;

// Equal-power stereo pan: pan ∈ [−1,+1], returns [L, R] gains.
function panLR(pan) {
  const t = (pan + 1) * 0.25 * Math.PI;     // 0 when pan=−1, π/2 when pan=+1
  return [Math.cos(t), Math.sin(t)];
}

class NastyBeastProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Globals
      { name: 'mix',    defaultValue: 1, minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1 },
      // Stage-0 stubs — preserved so main-thread setters can write
      // without errors, even though the DSP that consumes them hasn't
      // been ported yet. Ranges mirror the prototype engine.
      { name: 'feed',   defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'snarl',  defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'haunt',  defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'roam',   defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'breath', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'spread', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'beast',  defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'tune',   defaultValue: 0, minValue: -1, maxValue: 1 },
      { name: 'hpf',    defaultValue: 20,    minValue: 20,  maxValue: 2000 },
      { name: 'lpf',    defaultValue: 20000, minValue: 500, maxValue: 20000 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Scalar feedback-state slots — reserved for any DSP that needs
    // single-sample state across the feedback boundary (e.g. a future
    // DC-blocker on the feedback tap). The Stage 6 delay engine holds
    // all its state in the ring buffer + write index, so these slots
    // stay unused but remain declared to document the compliance
    // contract for later stages.
    this.fbStateL = 0;
    this.fbStateR = 0;

    // ── Biquad state (Direct Form I): [x1, x2, y1, y2] per filter per channel
    this.bqL = new Float32Array(NBQ * 4);
    this.bqR = new Float32Array(NBQ * 4);

    // ── Biquad coefficients: [b0, b1, b2, a1, a2] per filter (normalized)
    this.bqC = new Float32Array(NBQ * 5);

    // Cached frequencies for master filters — only recompute coeffs on change
    this.lastHpf = -1;
    this.lastLpf = -1;

    // Static BODY coefficients — frequencies + gains never change at runtime.
    // subHP lowered 55 Hz → 30 Hz vs prototype — prototype's 55 Hz was
    // protecting the (not-yet-ported) delay feedback loop from sub-rumble
    // compounding through the in-loop saturator. At Stage 3 with no FB
    // loop, 55 Hz was just stripping kick fundamentals audibly. 30 Hz
    // still catches true sub-sonic DC / rumble while preserving musical
    // bass. Revisit if/when Stage 6 delay-loop sat proves unstable and
    // wants more HP margin.
    this._setCoef(0, 'highpass', 30,   0.5,  0.0);
    this._setCoef(1, 'peaking',  160,  0.7, +1.5);
    this._setCoef(2, 'peaking',  380,  0.9, +0.5);
    this._setCoef(3, 'peaking',  3200, 1.2, -2.0);
    // Static FANG post-shaper lowpass — tames metallic upper harmonics.
    this._setCoef(4, 'lowpass',  5500, 0.5,  0.0);
    // masterHP/LP coefficients are computed per-block from params.hpf/lpf.

    // ── FANG shaper LUT ───────────────────────────────────────────────
    // Byte-for-byte same formula as prototype WaveShaperNode.curve:
    //     c[i] = tanh(k·x) / tanh(k),  x = i/(N-1)*2 − 1,  k = 2.0
    // Built once at construction; FEED modulates preDrive in front of the
    // lookup, never the curve itself (zipper-free, per prototype note).
    this.fangLut = new Float32Array(FANG_LUT_N);
    {
      const kt = Math.tanh(FANG_K);
      for (let i = 0; i < FANG_LUT_N; i++) {
        const x = (i / (FANG_LUT_N - 1)) * 2 - 1;
        this.fangLut[i] = Math.tanh(FANG_K * x) / kt;
      }
    }

    // ── DOUBLER state ─────────────────────────────────────────────────
    // Mono delay lines (prototype summed L+R via default channel mix).
    // Ring buffer with bit-mask wrap; write index advances each sample,
    // read is (write − delay_samples) with linear interpolation.
    this.dblBuf1 = new Float32Array(DBL_BUF);
    this.dblBuf2 = new Float32Array(DBL_BUF);
    this.dblIdx1 = 0;
    this.dblIdx2 = 0;
    // LFO phases (radians)
    this.dbl1PhaseA = 0; this.dbl1PhaseB = 0;
    this.dbl2PhaseA = 0; this.dbl2PhaseB = 0;
    // Pre-compute pan gains — centers never change
    const pan1 = panLR(DBL_V1_PAN);
    const pan2 = panLR(DBL_V2_PAN);
    this.dblPanL1 = pan1[0]; this.dblPanR1 = pan1[1];
    this.dblPanL2 = pan2[0]; this.dblPanR2 = pan2[1];
    // Pre-compute phase-advance-per-sample constants
    this.dbl1IncA = TWO_PI * DBL_V1_FA_HZ / this.sr;
    this.dbl1IncB = TWO_PI * DBL_V1_FB_HZ / this.sr;
    this.dbl2IncA = TWO_PI * DBL_V2_FA_HZ / this.sr;
    this.dbl2IncB = TWO_PI * DBL_V2_FB_HZ / this.sr;

    // ── DELAY state (Stage 6) ─────────────────────────────────────────
    // Stereo ring buffers, shared write index. Per-sample chain:
    //   read 3 taps (linear interp) → sum taps → mix into wet bus;
    //   feedback = _shape(tap1 · DLY_FB_PRE_GAIN) · dlyFb;
    //   write (wet_bus_pre_delay + feedback) to buffer; advance idx.
    // Write-after-read ordering means minimum effective delay is 1
    // sample. The user-exposed minimum (80 ms · 0.333 ≈ 27 ms) is
    // far larger, so the 1-sample edge case never actually fires.
    // Denormal guard on write protects the long tail at high STACK.
    this.dlyBufL = new Float32Array(DLY_BUF);
    this.dlyBufR = new Float32Array(DLY_BUF);
    this.dlyIdx  = 0;

    // One-pole LP state for the feedback damping filter. Coefficient
    // a = exp(-2*pi*fc/SR); topology is y[n] = (1-a)*x[n] + a*y[n-1]
    // so DC gain = 1 and cutoff = DLY_FB_LP_HZ.
    this.dlyFbLpA = Math.exp(-2 * Math.PI * DLY_FB_LP_HZ / sampleRate);
    this.dlyFbLpL = 0;
    this.dlyFbLpR = 0;

    // Per-sample smoothing for delay TIME. Scrubbing DRIZZLE would
    // otherwise jump the read pointer by huge amounts per sample →
    // zipper buzz. Smoothing at ~20 ms time constant makes the read
    // position glide continuously, giving a tape-style pitch bend as
    // the knob moves (a feature, not a bug, for this plugin class).
    this.dlyMsSmoothA  = 1 - Math.exp(-1 / (sampleRate * 0.020));
    this.dlyMsSmoothed = DLY_MIN_MS;

    // ── PING-PONG state (Stage 7) ─────────────────────────────────────
    // Two mono ring buffers (one per channel of the ping-pong pair).
    // pingIdx is shared so the L and R write/read positions stay aligned
    // — the topology only cross-feeds reads, not indices. LFO phases
    // start offset by π/2 (90°) so L and R modulators do not breathe in
    // lockstep; combined with the different base times, this keeps the
    // ping-pong from collapsing to a mono-equivalent comb filter under
    // DC input.
    this.pingBufL = new Float32Array(PING_BUF);
    this.pingBufR = new Float32Array(PING_BUF);
    this.pingIdx  = 0;
    this.pingLfoL = 0;
    this.pingLfoR = Math.PI * 0.5;
    this.pingLfoIncL = TWO_PI * PING_LFO_L_HZ / this.sr;
    this.pingLfoIncR = TWO_PI * PING_LFO_R_HZ / this.sr;
    // Pre-computed soft-sat normalizer — tanh(PING_SAT_K · 1) / tanh(K) = 1
    // at full scale, ensuring x=1 → 1 (no makeup gain loss from the sat).
    this.pingSatNorm = 1 / Math.tanh(PING_SAT_K);
    // Per-sample smoothing on BUTTER. Without this, send/mix/xfb/depth
    // all stepped at block boundaries (128-sample jumps), and scrubbing
    // BUTTER over a loud ping-pong tap produced audible zipper ticks.
    // 20 ms time constant matches the DELAY's dlyMsSmoothA — consistent
    // scrub feel across knobs.
    this.pingSpSmoothA  = 1 - Math.exp(-1 / (sampleRate * 0.020));
    this.pingSpSmoothed = 0;

    // ── PITCH GHOST state (Stage 5) ───────────────────────────────────
    // Mono ring buffer — ghost is a sub-shadow, stereo width for it
    // comes from being fed into the stereo delay loop, not from being
    // computed per-channel. Two phase accumulators (voice 1 starts at 0,
    // voice 2 starts at half-period). Grain/period samples are
    // pre-computed at construction so the inner loop only does integer
    // + float adds.
    this.ghostBuf    = new Float32Array(GHOST_BUF);
    this.ghostIdx    = 0;
    this.ghostGrainSa   = GHOST_GRAIN_MS  * this.sr * 0.001;
    // Down-voice: period = 160 ms (ratio 0.5). Delay grows 0 → grainSa
    // over period → read advances at 0.5 × write rate → octave down.
    this.ghostPeriodSa  = GHOST_PERIOD_MS_DN * this.sr * 0.001;
    this.ghostPeriodInv = 1 / this.ghostPeriodSa;
    // Up-voice: period = 80 ms (ratio 2.0). Delay shrinks grainSa → 0
    // over period → read advances at 2× write rate → octave up.
    this.ghostPeriodSaUp  = GHOST_PERIOD_MS_UP * this.sr * 0.001;
    this.ghostPeriodInvUp = 1 / this.ghostPeriodSaUp;
    // Voice 1 phase starts at 0. Voice 2 starts at half-period so Hann
    // envelopes crossfade — while voice 1 fades out at grain end, voice
    // 2 is peaking at grain middle. Same pattern for up-voice pair.
    this.ghostPhase1   = 0;
    this.ghostPhase2   = this.ghostPeriodSa   * 0.5;
    this.ghostPhase1Up = 0;
    this.ghostPhase2Up = this.ghostPeriodSaUp * 0.5;

    // Pre-LP and post-LP biquads for the ghost path. These are SEPARATE
    // from the main bqL/bqR banks because ghost is mono and the main
    // biquad bank is sized + channel-allocated for the BODY + FANG-post
    // + master HP/LP set. Reusing a main slot would collide with Stage 1.
    // Two filter coefficient slots (b0 b1 b2 a1 a2 each) + two state
    // slots (x1 x2 y1 y2 each).
    this.ghostC = new Float32Array(2 * 5);
    this.ghostS = new Float32Array(2 * 4);
    // Use the same RBJ cookbook we built for the main bank — lowpass
    // at Q=0.5 (matches prototype). Write directly into ghostC with a
    // minimal inlined computer to avoid touching the main _setCoef
    // path (main path writes into bqC, different array).
    this._setGhostCoef = (idx, fc) => {
      const sr = this.sr;
      const fc_ = Math.max(10, Math.min(sr * 0.49, fc));
      const w0 = 2 * Math.PI * fc_ / sr;
      const cw = Math.cos(w0);
      const sw = Math.sin(w0);
      const alpha = sw / (2 * 0.5);   // Q = 0.5
      const b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = (1 - cw) / 2;
      const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
      const i = idx * 5;
      this.ghostC[i  ] = b0 / a0;
      this.ghostC[i+1] = b1 / a0;
      this.ghostC[i+2] = b2 / a0;
      this.ghostC[i+3] = a1 / a0;
      this.ghostC[i+4] = a2 / a0;
    };
    this._setGhostCoef(0, GHOST_PRE_LP_HZ);
    this._setGhostCoef(1, GHOST_POST_LP_HZ);

    // ── STAGE 8 state ─────────────────────────────────────────────────
    // GLUE comp — 1-pole attack/release coefficients on a peak detector.
    // aA / aR are the one-pole "follower" coefficients:
    //   y[n] = y[n-1] + a · (x[n] - y[n-1])
    // a = 1 - exp(-1/(sr·τ)). Smaller a = slower follow.
    this.glueAtkA = 1 - Math.exp(-1 / (sampleRate * GLUE_ATK_MS * 0.001));
    this.glueRelA = 1 - Math.exp(-1 / (sampleRate * GLUE_REL_MS * 0.001));
    this.glueEnv  = 0;     // smoothed peak magnitude (linear, post-detector)

    // CHORUS state — two mono ring buffers (L & R fed identically; reads
    // use the same LFO-modulated tap so stereo chorus here is equivalent
    // to the prototype's single DelayNode handling each channel in
    // parallel). Shared write index and LFO phase.
    this.chorusBufL = new Float32Array(CHORUS_BUF);
    this.chorusBufR = new Float32Array(CHORUS_BUF);
    this.chorusIdx  = 0;
    this.chorusLfo  = 0;
    this.chorusInc  = TWO_PI * CHORUS_LFO_HZ / this.sr;

    // BEAST auto-makeup state — smoothed GR (dB) follower, symmetric TC.
    // beastGrSm is a one-pole-smoothed representation of the GLUE comp's
    // instantaneous gain-reduction amount (in dB, always ≥ 0, 0 = no GR).
    // Inverse is applied as output makeup. At beast=0, the result is
    // force-collapsed to unity so the makeup never runs unless engaged.
    this.beastTrimA = 1 - Math.exp(-1 / (sampleRate * BEAST_MAKEUP_TC_S));
    this.beastGrSm  = 0;

    // ── STAGE 9 state — TUNE granular shifter (±12 semi, stereo) ─────
    // Two ring buffers (L, R) fed from the post-BEAST-makeup wet bus.
    // Four phase accumulators — down-voice pair + up-voice pair.
    // Voice 2 phase starts at half-period so Hann envelopes crossfade.
    this.tuneBufL    = new Float32Array(TUNE_BUF);
    this.tuneBufR    = new Float32Array(TUNE_BUF);
    this.tuneIdx     = 0;
    this.tuneGrainSa      = TUNE_GRAIN_MS     * this.sr * 0.001;
    this.tunePeriodSaDn   = TUNE_PERIOD_MS_DN * this.sr * 0.001;
    this.tunePeriodInvDn  = 1 / this.tunePeriodSaDn;
    this.tunePeriodSaUp   = TUNE_PERIOD_MS_UP * this.sr * 0.001;
    this.tunePeriodInvUp  = 1 / this.tunePeriodSaUp;
    this.tunePhase1Dn = 0;
    this.tunePhase2Dn = this.tunePeriodSaDn * 0.5;
    this.tunePhase1Up = 0;
    this.tunePhase2Up = this.tunePeriodSaUp * 0.5;

    this.port.postMessage({ ready: true });
  }

  // Denormal guard — required at Stage 6 for feedback loop state.
  // Scrubs subnormal values that would otherwise pin a CPU core.
  _dn(x) { return Math.abs(x) < 1e-30 ? 0 : x; }

  // RBJ biquad cookbook coefficients — writes [b0,b1,b2,a1,a2]/a0 into bqC[idx]
  _setCoef(idx, type, f, Q, dB) {
    const sr = this.sr;
    // Clamp frequency well inside Nyquist — prevents NaN from cos/sin at edges
    const fc = Math.max(10, Math.min(sr * 0.49, f));
    const w0 = 2 * Math.PI * fc / sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Math.max(0.1, Q));
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha;    a1 = -2 * cw;   a2 = 1 - alpha;
    } else if (type === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw;    b2 = (1 - cw) / 2;
      a0 = 1 + alpha;    a1 = -2 * cw;   a2 = 1 - alpha;
    } else { // peaking
      const A = Math.pow(10, dB / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw;  b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw;  a2 = 1 - alpha / A;
    }
    const c = this.bqC, i = idx * 5;
    c[i  ] = b0 / a0;
    c[i+1] = b1 / a0;
    c[i+2] = b2 / a0;
    c[i+3] = a1 / a0;
    c[i+4] = a2 / a0;
  }

  // FANG waveshaper — 4096-sample tanh LUT with linear interpolation.
  // Input outside [-1, +1] is clamped (the LUT's end-points ARE the
  // saturator's ceiling by design — tanh asymptotes, hard-clamp is
  // indistinguishable past |x|=1). Bias is added by the caller before
  // invocation (SNARL DC offset → asymmetric clip).
  _shape(x) {
    const lut = this.fangLut;
    const N   = FANG_LUT_N;
    const cx  = x > 1 ? 1 : (x < -1 ? -1 : x);
    const fi  = (cx + 1) * 0.5 * (N - 1);
    const i0  = fi | 0;
    const i1  = i0 >= N - 1 ? N - 1 : i0 + 1;
    const f   = fi - i0;
    return lut[i0] + (lut[i1] - lut[i0]) * f;
  }

  // Direct Form I biquad: y[n] = b0·x + b1·x1 + b2·x2 - a1·y1 - a2·y2
  // Returns the denormal-scrubbed y so downstream stages and the output
  // chain never see subnormal values generated by long asymptotic decays.
  // (Stage 1 QC caught 8 subnormals in a 30s silence tail — filter state
  // was clean but the return value wasn't, so they leaked into oL/oR.)
  _biq(idx, s, x) {
    const c = this.bqC, ci = idx * 5;
    const si = idx * 4;
    const x1 = s[si], x2 = s[si+1], y1 = s[si+2], y2 = s[si+3];
    const yRaw = c[ci] * x + c[ci+1] * x1 + c[ci+2] * x2
                           - c[ci+3] * y1 - c[ci+4] * y2;
    const y = this._dn(yRaw);
    s[si  ] = x;
    s[si+1] = x1;
    s[si+2] = y;
    s[si+3] = y1;
    return y;
  }

  // Ghost biquad — same Direct Form I as _biq, but reads from ghostC
  // (coefficient bank) and ghostS (state bank). Kept as a distinct
  // method so the main _biq's hot path isn't disrupted by an extra
  // array parameter.
  _biqG(idx, x) {
    const c = this.ghostC, ci = idx * 5;
    const s = this.ghostS, si = idx * 4;
    const x1 = s[si], x2 = s[si+1], y1 = s[si+2], y2 = s[si+3];
    const yRaw = c[ci] * x + c[ci+1] * x1 + c[ci+2] * x2
                           - c[ci+3] * y1 - c[ci+4] * y2;
    const y = this._dn(yRaw);
    s[si  ] = x;
    s[si+1] = x1;
    s[si+2] = y;
    s[si+3] = y1;
    return y;
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !outBufs?.length) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    // k-rate reads
    const mixP    = params.mix[0];
    // bypass is a smoothly-ramped 0..1 param, NOT a threshold. Using it
    // as a boolean (> 0.5) created a discontinuous step at the midpoint
    // of the external setTargetAtTime ramp while the external bypassRelay
    // + wetGain were still mid-crossfade — audible pop on toggle.
    // We now multiply the worklet output by (1 - bypass) so it fades
    // smoothly in lockstep with the external ramps. The external wetGain
    // continues to be the authoritative mute; the multiplier here just
    // prevents any discontinuity during the transient.
    const bypassRamp = Math.min(1, Math.max(0, params.bypass[0]));
    const wetScale   = 1 - bypassRamp;

    // Master HPF/LPF coefficients — recompute only when frequency changes.
    // Params are a-rate but we treat them k-rate (read [0]) to keep coefs
    // stable across the block. Per-block refresh means any slider move is
    // reflected within 128 samples max — inaudible latency.
    const hpfHz = params.hpf[0];
    const lpfHz = params.lpf[0];
    if (hpfHz !== this.lastHpf) {
      this._setCoef(5, 'highpass', hpfHz, 0.5, 0.0);
      this.lastHpf = hpfHz;
    }
    if (lpfHz !== this.lastLpf) {
      this._setCoef(6, 'lowpass', lpfHz, 0.5, 0.0);
      this.lastLpf = lpfHz;
    }

    // ── FANG macros (block-rate reads — smoothing already lives on the
    // main-thread setTargetAtTime ramps, so [0] is the smoothed value).
    const feedP  = params.feed[0];
    const snarlP = params.snarl[0];
    const beastP = params.beast[0];

    // Derivations mirror the prototype's applyAll(), with ONE deviation:
    //   drive    = 1.0 + feed · 1.2         (1.0 .. 2.2)
    //   makeup   = 1 / √drive               (unity-gain compensation)
    //   bias     = snarl · 0.25             (asymmetric DC offset — see note)
    //   beastDr  = 1.0 + beast · 0.30       (mild drive push from beast)
    //   fangAmt  = min(1, feed + beast·0.2) (equal-power shaper crossfade)
    //
    // CRISP / SNARL bias range, final value 0.78 — ~15.6× the prototype's
    // 0.05. Tuning trail: 0.05 (inaudible) → 0.25 (polite) → 0.5 (honky at
    // max) → 0.6 (+20%, still a hair tame) → 0.78 (+30% more, final).
    // Ceiling check: with drive·beastDrive peaking at 2.2·1.3 ≈ 2.86 and
    // a full-scale signal, input to tanh peaks at |2.86 + 0.78| = 3.64
    // → tanh(3.64) = 0.9988. Still inside the shape's legal envelope, not
    // DC-rail-pinning at 1.0. Positive clip hits the ceiling first;
    // negative clip lags behind, so the asymmetry grows even-order
    // harmonics with a bark characteristic (vs tanh's symmetric grit).
    const drive      = 1.0 + feedP * 1.2;
    const fangMakeup = 1.0 / Math.sqrt(drive);
    const fangBias   = snarlP * 0.78;
    const beastDrive = 1.0 + beastP * 0.30;
    const drivePre   = drive * beastDrive;
    const fangAmt    = Math.min(1, feedP + beastP * 0.2);
    const fangWet    = Math.sin(fangAmt * Math.PI * 0.5);
    const fangDry    = Math.cos(fangAmt * Math.PI * 0.5);
    const fangPadAmt = 0.7;

    // Equal-power mix (cos/sin). Per ManChild compliance template:
    // dry and wet are both internal to this processor, so their sample
    // timing is identical by construction — summing is phase-coherent at
    // every mix value.
    const theta  = (1 - mixP) * Math.PI * 0.5;
    const mixWet = Math.cos(theta);
    const mixDry = Math.sin(theta);

    const N = iL.length;
    const bqL = this.bqL;
    const bqR = this.bqR;

    // DOUBLER — pull locals for inner-loop hot path
    const dblBuf1 = this.dblBuf1, dblBuf2 = this.dblBuf2;
    const dblPanL1 = this.dblPanL1, dblPanR1 = this.dblPanR1;
    const dblPanL2 = this.dblPanL2, dblPanR2 = this.dblPanR2;
    const dbl1IncA = this.dbl1IncA, dbl1IncB = this.dbl1IncB;
    const dbl2IncA = this.dbl2IncA, dbl2IncB = this.dbl2IncB;
    const SR_MS   = this.sr * 0.001;    // samples per millisecond
    let dbl1PhaseA = this.dbl1PhaseA, dbl1PhaseB = this.dbl1PhaseB;
    let dbl2PhaseA = this.dbl2PhaseA, dbl2PhaseB = this.dbl2PhaseB;
    let dblIdx1 = this.dblIdx1, dblIdx2 = this.dblIdx2;

    // ── DELAY hoists (Stage 6) ─────────────────────────────────────
    // k-rate reads — setTargetAtTime smoothing lives on the main-thread
    // setters, so [0] is the smoothed value. Block refresh means any
    // slider move is reflected within ≤ 128 samples: inaudible.
    // dlyMs interpolates linearly across DRIZZLE; dlyFb caps STACK at
    // 0.95 (last 5% of knob travel stays below 1.0 so the tanh ceiling
    // always wins against runaway).
    const hauntP       = params.haunt[0];
    const roamP        = params.roam[0];
    const dlyMsTarget  = DLY_MIN_MS + (DLY_MAX_MS - DLY_MIN_MS) * hauntP;
    const dlyFb        = roamP * DLY_FB_MAX;
    const dlyBufL      = this.dlyBufL;
    const dlyBufR      = this.dlyBufR;
    let   dlyIdx       = this.dlyIdx;
    // Per-sample smoothing on delay time (see constructor). Target is
    // dlyMsTarget; smoothed value is what actually drives read pointers.
    const dlyMsSmoothA = this.dlyMsSmoothA;
    let   dlyMsSm      = this.dlyMsSmoothed;
    // Feedback-damping LP state (hoisted for tight inner loop).
    const fbLpA        = this.dlyFbLpA;
    const fbLpA1       = 1 - fbLpA;
    let   fbLpL        = this.dlyFbLpL;
    let   fbLpR        = this.dlyFbLpR;

    // ── PING-PONG hoists (Stage 7) ─────────────────────────────────
    // BUTTER (spread) is the master scale for send/mix/xfb/depth. Only
    // the *target* lives at block rate — derived multipliers are now
    // recomputed per sample from the smoothed pingSp so BUTTER scrubs
    // glide instead of stepping. BEAST adds a small push (+15%, capped
    // at 1.0) so cranking BEAST brings the ping-pong slightly forward
    // without needing a second knob move.
    const spreadP         = params.spread[0];
    const pingSpTarget    = Math.min(1, spreadP + beastP * 0.15);
    const pingSpSmoothA   = this.pingSpSmoothA;
    let   pingSpSm        = this.pingSpSmoothed;
    const pingBaseLSa     = PING_BASE_L_MS * SR_MS;
    const pingBaseRSa     = PING_BASE_R_MS * SR_MS;
    const pingDepthMaxSa  = PING_DEPTH_MS * SR_MS;
    const pingBufL        = this.pingBufL;
    const pingBufR        = this.pingBufR;
    let   pingIdx         = this.pingIdx;
    let   pingLfoL        = this.pingLfoL;
    let   pingLfoR        = this.pingLfoR;
    const pingIncL        = this.pingLfoIncL;
    const pingIncR        = this.pingLfoIncR;
    const pingSatNorm     = this.pingSatNorm;

    // ── PITCH GHOST hoists (Stage 5) ───────────────────────────────
    // BREATH is the primary scale; BEAST pushes +15% like other macros
    // for a unified "beast mode" feel. Ceiling of 0.14 keeps ghost as
    // a sub-shadow — higher and it competes with the fundamental. Ghost
    // is mono-fed (post-DOUBLER wet sum) and mono-summed into delInL/R.
    const breathP         = params.breath[0];
    // Dual-voice blend curve:
    //   breathEff = breathP + 0.15·beastP  (BEAST nudge like other macros)
    //   UP gain   = min(1, 2·breathEff)                 — full by 50% knob
    //   DN gain   = max(0, 2·breathEff − 1)             — kicks in >50% knob
    // Result: 0..50% knob = shimmer only (airy); 50..100% = shimmer +
    // growing sub-shadow beneath it. At full knob both voices are at max.
    const breathEff       = Math.min(1, breathP + beastP * 0.15);
    const ghostAmtUpTarget = Math.min(1, breathEff * 2)           * GHOST_MIX_MAX_UP;
    const ghostAmtDnTarget = Math.max(0, breathEff * 2 - 1)       * GHOST_MIX_MAX_DN;
    // Wet-duck: same equal-power pattern used for PING-PONG (Stage 7).
    // When FLUFF is at max, ghost adds up to ~0.36 peak onto the wet bus.
    // On hot material (pads + SIZZLE) that stacks into clipping. Carve
    // cos(breathEff · π/4) worth of headroom out of the wet bus so ghost
    // fits instead of overflowing.
    const ghostDuckTheta  = breathEff * Math.PI * 0.25;
    const ghostWetDuck    = Math.cos(ghostDuckTheta);
    const ghostBuf        = this.ghostBuf;
    let   ghostIdx        = this.ghostIdx;
    let   ghostPhase1     = this.ghostPhase1;
    let   ghostPhase2     = this.ghostPhase2;
    let   ghostPhase1Up   = this.ghostPhase1Up;
    let   ghostPhase2Up   = this.ghostPhase2Up;
    const ghostGrainSa    = this.ghostGrainSa;
    const ghostPeriodSa   = this.ghostPeriodSa;
    const ghostPeriodInv  = this.ghostPeriodInv;
    const ghostPeriodSaUp  = this.ghostPeriodSaUp;
    const ghostPeriodInvUp = this.ghostPeriodInvUp;

    // ── STAGE 8 hoists ─────────────────────────────────────────────
    // GLUE threshold/ratio follow beast. Precompute linear threshold and
    // the (1 - 1/ratio) gain-reduction slope so the inner loop only does
    // one log + one exp per above-knee sample.
    const glueThDB     = GLUE_TH_DB_MIN + GLUE_TH_DB_RANGE * beastP;   // -3..-20
    const glueThLin    = Math.pow(10, glueThDB / 20);                   // 0.707..0.1
    const glueRatio    = GLUE_RATIO_MIN + GLUE_RATIO_RANGE * beastP;   // 1.5..5.0
    const glueSlope    = 1 - 1 / glueRatio;                             // 0.333..0.8
    const glueKneeHalf = GLUE_KNEE_DB * 0.5;
    const glueKneeInv2 = 1 / (2 * GLUE_KNEE_DB);
    // Knee floor (linear) — skip log/exp entirely below (th - knee/2) dB
    const glueKneeFloor = Math.pow(10, (glueThDB - glueKneeHalf) / 20);
    const glueAtkA     = this.glueAtkA;
    const glueRelA    = this.glueRelA;
    let   glueEnv     = this.glueEnv;

    // CHORUS block-rate scalars
    const chorusBufL       = this.chorusBufL;
    const chorusBufR       = this.chorusBufR;
    let   chorusIdx        = this.chorusIdx;
    let   chorusLfo        = this.chorusLfo;
    const chorusInc        = this.chorusInc;
    const chorusBaseSa     = CHORUS_BASE_MS  * SR_MS;
    const chorusDepthSa_s  = beastP * CHORUS_DEPTH_MS * SR_MS;
    const chorusWet_s      = beastP * CHORUS_WET_MAX;

    // BEAST auto-makeup — smoothed GR follower. No edge detect, no ref
    // latch: makeup is a pure function of the comp's instantaneous GR,
    // so silence → GR=0 → makeup=1, no runaway possible.
    const beastTrimA = this.beastTrimA;
    let   beastGrSm  = this.beastGrSm;

    // ── STAGE 9 hoists ─────────────────────────────────────────────
    // Tune param is block-rate here (main-thread setter uses a 40 ms
    // setTargetAtTime ramp, so per-sample change is negligible within
    // a 128-sample block). Compute the three crossfade gains once per
    // block. Skip voice math entirely when |tune| ≈ 0 (tuneActive=false).
    const tuneP          = params.tune[0];
    const tuneAbs_s      = tuneP >= 0 ? tuneP : -tuneP;
    const tuneDryAmt_s   = 1 - tuneAbs_s;
    const tuneDnAmt_s    = tuneP < 0 ? -tuneP : 0;
    const tuneUpAmt_s    = tuneP > 0 ?  tuneP : 0;
    const tuneActive     = tuneAbs_s > 1e-4;
    const tuneBufL       = this.tuneBufL;
    const tuneBufR       = this.tuneBufR;
    let   tuneIdx        = this.tuneIdx;
    let   tunePhase1Dn   = this.tunePhase1Dn;
    let   tunePhase2Dn   = this.tunePhase2Dn;
    let   tunePhase1Up   = this.tunePhase1Up;
    let   tunePhase2Up   = this.tunePhase2Up;
    const tuneGrainSa    = this.tuneGrainSa;
    const tunePeriodSaDn = this.tunePeriodSaDn;
    const tunePeriodInvDn = this.tunePeriodInvDn;
    const tunePeriodSaUp = this.tunePeriodSaUp;
    const tunePeriodInvUp = this.tunePeriodInvUp;

    for (let n = 0; n < N; n++) {
      const xL = iL[n];
      const xR = iR[n];

      // ── STAGE 1: BODY chain on wet path ─────────────────────────────
      let bL = this._biq(0, bqL, xL);
      bL    = this._biq(1, bqL, bL);
      bL    = this._biq(2, bqL, bL);
      bL    = this._biq(3, bqL, bL);
      let bR = this._biq(0, bqR, xR);
      bR    = this._biq(1, bqR, bR);
      bR    = this._biq(2, bqR, bR);
      bR    = this._biq(3, bqR, bR);

      // ── STAGE 2: FANG saturator ─────────────────────────────────────
      // Equal-power crossfade between fangPad-dry and shaper-wet by FEED.
      // At FEED=0 the LUT is still evaluated but weighted to zero — this
      // matches the prototype's gain-crossfade topology. A future opt
      // could skip the lookup entirely when fangWet is below a threshold.
      const pL  = fangPadAmt * bL;
      const pR  = fangPadAmt * bR;
      let   sL  = this._shape(pL * drivePre + fangBias);
      let   sR  = this._shape(pR * drivePre + fangBias);
      sL = this._biq(4, bqL, sL);
      sR = this._biq(4, bqR, sR);
      sL *= fangMakeup;
      sR *= fangMakeup;
      let wL = fangDry * pL + fangWet * sL;
      let wR = fangDry * pR + fangWet * sR;

      // ── STAGE 2 PAD MAKEUP (deliberate V2 divergence from prototype).
      // The prototype applied fangPad = 0.7 to protect the WaveShaperNode
      // from early clipping but never compensated the lost −3 dB, relying
      // on the delay engine + pitch ghost + doubler to refill the level.
      // Stages 5–7 aren't ported yet, so at default settings the wet leg
      // sat ~3 dB below dry and had the 55 Hz subHP hole exposed —
      // audible as "thin, no low end" on drums. This one-mult restores
      // unity so V2 feels full even before the later stages land, at the
      // deliberate cost of no longer matching prototype's thin character.
      const fangPadMakeup = 1 / fangPadAmt;      // 1 / 0.7 ≈ 1.4286
      wL *= fangPadMakeup;
      wR *= fangPadMakeup;

      // ── STAGE 3: DOUBLER (mono-summed micro-detune thickening) ──────
      // Two delay-modulated voices. Mono-sum fed into each delay line,
      // tapped-out with LFO-modulated delay time, panned, summed back
      // into the wet bus at DBL_WET (6%). Subtle by design — adds body
      // without becoming a distinct chorus.
      const mono = (wL + wR) * 0.5;

      // Advance LFO phases
      dbl1PhaseA += dbl1IncA; if (dbl1PhaseA > TWO_PI) dbl1PhaseA -= TWO_PI;
      dbl1PhaseB += dbl1IncB; if (dbl1PhaseB > TWO_PI) dbl1PhaseB -= TWO_PI;
      dbl2PhaseA += dbl2IncA; if (dbl2PhaseA > TWO_PI) dbl2PhaseA -= TWO_PI;
      dbl2PhaseB += dbl2IncB; if (dbl2PhaseB > TWO_PI) dbl2PhaseB -= TWO_PI;

      // Modulated delay times (in milliseconds, then to samples)
      const ms1 = DBL_V1_CENTER_MS
                + DBL_V1_DEPTH_A * Math.sin(dbl1PhaseA)
                + DBL_V1_DEPTH_B * Math.sin(dbl1PhaseB);
      const ms2 = DBL_V2_CENTER_MS
                + DBL_V2_DEPTH_A * Math.sin(dbl2PhaseA)
                + DBL_V2_DEPTH_B * Math.sin(dbl2PhaseB);
      const d1 = ms1 * SR_MS;
      const d2 = ms2 * SR_MS;

      // Read with linear interpolation — ring buffer, mask-wrapped
      const rp1  = dblIdx1 - d1;
      const rp1F = Math.floor(rp1);
      const rp1f = rp1 - rp1F;
      const v1a  = dblBuf1[rp1F       & DBL_MASK];
      const v1b  = dblBuf1[(rp1F + 1) & DBL_MASK];
      const v1   = v1a + (v1b - v1a) * rp1f;

      const rp2  = dblIdx2 - d2;
      const rp2F = Math.floor(rp2);
      const rp2f = rp2 - rp2F;
      const v2a  = dblBuf2[rp2F       & DBL_MASK];
      const v2b  = dblBuf2[(rp2F + 1) & DBL_MASK];
      const v2   = v2a + (v2b - v2a) * rp2f;

      // Write current mono sample (denormal scrub — delay lines are
      // linear and only decay to 0, but input could already be subnormal
      // if an earlier stage leaked — cheap insurance)
      dblBuf1[dblIdx1] = this._dn(mono);
      dblBuf2[dblIdx2] = this._dn(mono);
      dblIdx1 = (dblIdx1 + 1) & DBL_MASK;
      dblIdx2 = (dblIdx2 + 1) & DBL_MASK;

      // Pan voices + mix into wet (0.5 voice-gain folded into DBL_WET)
      const v1L = v1 * dblPanL1;
      const v1R = v1 * dblPanR1;
      const v2L = v2 * dblPanL2;
      const v2R = v2 * dblPanR2;
      const dblScale = DBL_WET * DBL_VOICE_GAIN;
      wL += dblScale * (v1L + v2L);
      wR += dblScale * (v1R + v2R);

      // ── STAGE 6: DELAY ENGINE (3-tap + in-loop tanh sat) ─────────────
      // Branch the post-DOUBLER wet bus into the delay input; the delay
      // output is summed back into the same bus at DLY_WET. Capturing
      // delInL/R before the additions below keeps the feedback loop's
      // input isolated from its own output (no write-then-immediate-
      // read instability).
      //
      // ── STAGE 5: PITCH GHOST (octave-down granular OLA) ─────────────
      // Input = mono-sum of post-DOUBLER wet, pre-LP'd to 2400 Hz so
      // grain-edge hash can't compound. Two voices with sawtooth-ramped
      // fractional delay, each gated by a phase-derived Hann envelope.
      // Voice 2 phase is offset by half-period (constructor init) so
      // grain crossfade is continuous.
      //
      // Per voice per sample:
      //   phase ∈ [0, period_samples), normalized p = phase/period
      //   delay = p · grain_samples       (sawtooth ramp 0 → grain)
      //   env   = 0.5 - 0.5 · cos(2π·p)   (Hann window)
      //   voice = lin-interp(ringBuf, writeIdx − delay) · env
      // Sum both voices for the OLA output.
      const ghostIn  = this._biqG(0, (wL + wR) * 0.5);

      // DOWN-voice 1 — delay grows 0 → grainSa over period (octave down)
      const gp1      = ghostPhase1 * ghostPeriodInv;   // normalized [0,1)
      const gd1      = gp1 * ghostGrainSa;              // delay in samples
      const ge1      = 0.5 - 0.5 * Math.cos(TWO_PI * gp1);
      const grp1     = ghostIdx - gd1;
      const grp1F    = Math.floor(grp1);
      const grp1f    = grp1 - grp1F;
      const gv1a     = ghostBuf[grp1F       & GHOST_MASK];
      const gv1b     = ghostBuf[(grp1F + 1) & GHOST_MASK];
      const gv1      = (gv1a + (gv1b - gv1a) * grp1f) * ge1;

      // DOWN-voice 2 (half-period-offset phase → crossfade)
      const gp2      = ghostPhase2 * ghostPeriodInv;
      const gd2      = gp2 * ghostGrainSa;
      const ge2      = 0.5 - 0.5 * Math.cos(TWO_PI * gp2);
      const grp2     = ghostIdx - gd2;
      const grp2F    = Math.floor(grp2);
      const grp2f    = grp2 - grp2F;
      const gv2a     = ghostBuf[grp2F       & GHOST_MASK];
      const gv2b     = ghostBuf[(grp2F + 1) & GHOST_MASK];
      const gv2      = (gv2a + (gv2b - gv2a) * grp2f) * ge2;

      // UP-voice 1 — delay shrinks grainSa → 0 over period (octave up)
      const gp1U     = ghostPhase1Up * ghostPeriodInvUp;
      const gd1U     = (1 - gp1U) * ghostGrainSa;       // inverse ramp
      const ge1U     = 0.5 - 0.5 * Math.cos(TWO_PI * gp1U);
      const grp1U    = ghostIdx - gd1U;
      const grp1UF   = Math.floor(grp1U);
      const grp1Uf   = grp1U - grp1UF;
      const gv1Ua    = ghostBuf[grp1UF       & GHOST_MASK];
      const gv1Ub    = ghostBuf[(grp1UF + 1) & GHOST_MASK];
      const gv1U     = (gv1Ua + (gv1Ub - gv1Ua) * grp1Uf) * ge1U;

      // UP-voice 2 (half-period-offset)
      const gp2U     = ghostPhase2Up * ghostPeriodInvUp;
      const gd2U     = (1 - gp2U) * ghostGrainSa;
      const ge2U     = 0.5 - 0.5 * Math.cos(TWO_PI * gp2U);
      const grp2U    = ghostIdx - gd2U;
      const grp2UF   = Math.floor(grp2U);
      const grp2Uf   = grp2U - grp2UF;
      const gv2Ua    = ghostBuf[grp2UF       & GHOST_MASK];
      const gv2Ub    = ghostBuf[(grp2UF + 1) & GHOST_MASK];
      const gv2U     = (gv2Ua + (gv2Ub - gv2Ua) * grp2Uf) * ge2U;

      // Write input to ring, advance write pointer (shared by both voices)
      ghostBuf[ghostIdx] = this._dn(ghostIn);
      ghostIdx = (ghostIdx + 1) & GHOST_MASK;

      // Advance phases, wrap at period
      ghostPhase1   += 1; if (ghostPhase1   >= ghostPeriodSa)   ghostPhase1   -= ghostPeriodSa;
      ghostPhase2   += 1; if (ghostPhase2   >= ghostPeriodSa)   ghostPhase2   -= ghostPeriodSa;
      ghostPhase1Up += 1; if (ghostPhase1Up >= ghostPeriodSaUp) ghostPhase1Up -= ghostPeriodSaUp;
      ghostPhase2Up += 1; if (ghostPhase2Up >= ghostPeriodSaUp) ghostPhase2Up -= ghostPeriodSaUp;

      // OLA sums, separately scaled. Down-voice runs through post-LP
      // (darkens into sub-shadow). Up-voice skips post-LP so it keeps
      // its air. Both are mono and summed equally into L/R.
      const ghostDn  = this._biqG(1, gv1 + gv2) * ghostAmtDnTarget;
      const ghostUp  = (gv1U + gv2U) * ghostAmtUpTarget;
      const ghostOut = ghostDn + ghostUp;

      // Delay line receives ONLY the DOWN voice (sub-shadow cascades
      // through feedback for dub-wobble character). UP voice skips the
      // delay entirely — its grain-edge hash would become a zipper when
      // DRIZZLE scrubs the read-head, and its high-frequency air is
      // better served straight to the wet bus anyway.
      const delInL = wL + ghostDn;
      const delInR = wR + ghostDn;
      // Direct-to-wet ghost with equal-power duck — wet gets cos(θ)·wL
      // so the ghost add (up to ~0.36 peak at FLUFF=100%) fits inside
      // unity instead of stacking on top of a hot FANG/DOUBLER output.
      wL = ghostWetDuck * wL + ghostOut;
      wR = ghostWetDuck * wR + ghostOut;

      // Per-sample smooth toward target delay time. This turns slider
      // scrubs into smooth pitch glides (tape-style) and eliminates
      // the read-pointer-jump buzz on parameter moves.
      dlyMsSm += (dlyMsTarget - dlyMsSm) * dlyMsSmoothA;
      const dlyD1 = dlyMsSm * SR_MS * DLY_TAP1_RATIO;
      const dlyD2 = dlyMsSm * SR_MS * DLY_TAP2_RATIO;
      const dlyD3 = dlyMsSm * SR_MS * DLY_TAP3_RATIO;

      // Read 3 taps — shared fractional positions across L/R.
      // drp* = delay-read-pointer. Named with 'd' prefix to avoid
      // clashing with DOUBLER's rp* vars which live in this same
      // function scope. (Also: PROCESSOR_CODE is a template literal,
      // so backticks in comments close it early — do NOT use them.)
      const drp1   = dlyIdx - dlyD1;
      const drp1F  = Math.floor(drp1);
      const drp1f  = drp1 - drp1F;
      const t1La   = dlyBufL[drp1F       & DLY_MASK];
      const t1Lb   = dlyBufL[(drp1F + 1) & DLY_MASK];
      const tap1L  = t1La + (t1Lb - t1La) * drp1f;
      const t1Ra   = dlyBufR[drp1F       & DLY_MASK];
      const t1Rb   = dlyBufR[(drp1F + 1) & DLY_MASK];
      const tap1R  = t1Ra + (t1Rb - t1Ra) * drp1f;

      const drp2   = dlyIdx - dlyD2;
      const drp2F  = Math.floor(drp2);
      const drp2f  = drp2 - drp2F;
      const t2La   = dlyBufL[drp2F       & DLY_MASK];
      const t2Lb   = dlyBufL[(drp2F + 1) & DLY_MASK];
      const tap2L  = t2La + (t2Lb - t2La) * drp2f;
      const t2Ra   = dlyBufR[drp2F       & DLY_MASK];
      const t2Rb   = dlyBufR[(drp2F + 1) & DLY_MASK];
      const tap2R  = t2Ra + (t2Rb - t2Ra) * drp2f;

      const drp3   = dlyIdx - dlyD3;
      const drp3F  = Math.floor(drp3);
      const drp3f  = drp3 - drp3F;
      const t3La   = dlyBufL[drp3F       & DLY_MASK];
      const t3Lb   = dlyBufL[(drp3F + 1) & DLY_MASK];
      const tap3L  = t3La + (t3Lb - t3La) * drp3f;
      const t3Ra   = dlyBufR[drp3F       & DLY_MASK];
      const t3Rb   = dlyBufR[(drp3F + 1) & DLY_MASK];
      const tap3R  = t3Ra + (t3Rb - t3Ra) * drp3f;

      const tapSumL = tap1L * DLY_TAP1_GAIN
                    + tap2L * DLY_TAP2_GAIN
                    + tap3L * DLY_TAP3_GAIN;
      const tapSumR = tap1R * DLY_TAP1_GAIN
                    + tap2R * DLY_TAP2_GAIN
                    + tap3R * DLY_TAP3_GAIN;

      // Feedback = tanh(tap1 · 0.5) · dlyFb. Pre-attenuation keeps
      // small-signal loop gain under unity (shape's K=2 curve has
      // small-signal gain ≈ 2×, so halving the input lands near 1×
      // before the fb scale). Large signals land in the tanh plateau
      // and get self-limited, regardless of STACK setting.
      // Raw saturated feedback from tap 1.
      const fbRawL = this._shape(tap1L * DLY_FB_PRE_GAIN) * dlyFb;
      const fbRawR = this._shape(tap1R * DLY_FB_PRE_GAIN) * dlyFb;
      // Damping LP on the feedback path — each repeat gets darker,
      // matching Memory Man / Space Echo analog behavior. Keeps
      // FANG-driven content musical at high STACK instead of buzzy.
      fbLpL = fbLpA1 * fbRawL + fbLpA * fbLpL;
      fbLpR = fbLpA1 * fbRawR + fbLpA * fbLpR;
      const fbInL = fbLpL;
      const fbInR = fbLpR;

      // Write input + feedback into ring buffer (scrub denormals to
      // protect the CPU on long decays at high STACK).
      dlyBufL[dlyIdx] = this._dn(delInL + fbInL);
      dlyBufR[dlyIdx] = this._dn(delInR + fbInR);
      dlyIdx = (dlyIdx + 1) & DLY_MASK;

      // Mix tap sum back into wet bus. Gate wet amount by DRIZZLE
      // (hauntP) so the knob at 0 = no audible delay, not "shortest
      // delay at 50% wet." Delay TIME still maps 80→1200 ms across
      // the knob; TIME floor stays at 80 ms so pushing the knob back
      // up never lands sub-frame.
      wL += DLY_WET * hauntP * tapSumL;
      wR += DLY_WET * hauntP * tapSumR;

      // ── STAGE 7: PING-PONG stereo delay ─────────────────────────────
      // Reads come from the current wet bus (post-DELAY sum), so the
      // ping-pong hears the delay's tap sum if DRIZZLE is up — they
      // compound musically. Writes are cross-fed: L buffer receives
      // tapSumL*send + saturated-R-read*xfb, R buffer receives
      // tapSumR*send + saturated-L-read*xfb. This is what gives the
      // bounce-to-the-other-side character (impulse on L returns on R
      // after base_R, then back to L after base_L, etc.).
      //
      // LFO modulation: independent sine on each side creates subtle
      // detune over time. Depth scales with BUTTER so at 0 the base
      // times are stable (tight doubled slap) and at full the taps
      // wander ±6 ms (dub-style pitch drift).
      //
      // Soft-sat on the cross-feed arm (tanh with K=1.1) keeps the
      // xfb loop from compounding at high BUTTER + high STACK. The
      // normalizer (1/tanh(K)) keeps unity gain at |x|=1 so small
      // signals aren't attenuated — the sat only bites when levels
      // exceed ~0.7, shaping peaks without cost to body.
      //
      // Per-sample smoothing on pingSp: block-rate steps on a loud
      // ping-pong tap were audible as zipper ticks during BUTTER
      // scrubs (drum material exposed this hard on HP'd listens).
      // Smoothing the master scalar and deriving per-sample keeps the
      // glide sonically continuous.
      pingSpSm += (pingSpTarget - pingSpSm) * pingSpSmoothA;
      const pingSend_s    = pingSpSm * PING_SEND_MAX;
      const pingMix_s     = pingSpSm * PING_MIX_MAX;
      const pingXfb_s     = pingSpSm * PING_XFB_MAX;
      const pingDepthSa_s = pingSpSm * pingDepthMaxSa;
      // Equal-power wet-bus duck — as BUTTER comes up, the pre-ping-pong
      // wet level rolls off by cos curve while ping-pong mix rises by
      // sin curve. Prevents "stacking headroom" where adding ping-pong
      // on top of an already-hot wet bus overshoots unity. At pingSp=0
      // duck=1 (no change). At pingSp=1 duck=cos(π/4)≈0.707 (wet bus
      // drops 3 dB while ping-pong peaks at 0.45·pTap). This keeps the
      // master wet sum inside [-1, +1] on full-crank drum content.
      const pingTheta  = pingSpSm * Math.PI * 0.5 * 0.5;   // max π/4 at full
      const wetDuck    = Math.cos(pingTheta);

      const pingDelL = pingBaseLSa + pingDepthSa_s * Math.sin(pingLfoL);
      const pingDelR = pingBaseRSa + pingDepthSa_s * Math.sin(pingLfoR);

      // Lin-interp read, L channel
      const pRpL   = pingIdx - pingDelL;
      const pRpLF  = Math.floor(pRpL);
      const pRpLf  = pRpL - pRpLF;
      const pLa    = pingBufL[pRpLF       & PING_MASK];
      const pLb    = pingBufL[(pRpLF + 1) & PING_MASK];
      const pTapL  = pLa + (pLb - pLa) * pRpLf;

      // Lin-interp read, R channel
      const pRpR   = pingIdx - pingDelR;
      const pRpRF  = Math.floor(pRpR);
      const pRpRf  = pRpR - pRpRF;
      const pRa    = pingBufR[pRpRF       & PING_MASK];
      const pRb    = pingBufR[(pRpRF + 1) & PING_MASK];
      const pTapR  = pRa + (pRb - pRa) * pRpRf;

      // Cross-feed soft-sat (normalized so |x|=1 → 1)
      const pSatL  = Math.tanh(pTapL * PING_SAT_K) * pingSatNorm;
      const pSatR  = Math.tanh(pTapR * PING_SAT_K) * pingSatNorm;

      // Writes: send from own channel + xfb from opposite saturated tap
      pingBufL[pingIdx] = this._dn(tapSumL * pingSend_s + pSatR * pingXfb_s);
      pingBufR[pingIdx] = this._dn(tapSumR * pingSend_s + pSatL * pingXfb_s);
      pingIdx = (pingIdx + 1) & PING_MASK;

      // Advance LFOs and wrap
      pingLfoL += pingIncL; if (pingLfoL > TWO_PI) pingLfoL -= TWO_PI;
      pingLfoR += pingIncR; if (pingLfoR > TWO_PI) pingLfoR -= TWO_PI;

      // Equal-power mix of pre-ping-pong wet (ducked by wetDuck) with
      // hard-panned ping-pong taps. L tap → L out, R tap → R out.
      // At BUTTER=0: wetDuck=1, pingMix=0 → untouched. At BUTTER=1:
      // wetDuck≈0.707 and pingMix=0.45 on ±0.8 peak tap → total wet
      // stays inside unity.
      wL = wetDuck * wL + pingMix_s * pTapL;
      wR = wetDuck * wR + pingMix_s * pTapR;

      // ── STAGE 8A: GLUE comp (feedforward peak detector, soft knee) ──
      // Detector runs on max-magnitude of L/R (stereo-linked — classic
      // glue comp behavior, no stereo image wobble from independent GR).
      // Envelope follows with fast attack / slow release per prototype.
      const absL8 = wL >= 0 ? wL : -wL;
      const absR8 = wR >= 0 ? wR : -wR;
      const peak8 = absL8 > absR8 ? absL8 : absR8;
      if (peak8 > glueEnv) glueEnv += (peak8 - glueEnv) * glueAtkA;
      else                 glueEnv += (peak8 - glueEnv) * glueRelA;
      // Gain reduction curve (soft knee):
      //   env_dB < th - knee/2   → GR = 0
      //   env_dB inside knee     → GR = ((over + knee/2)^2 / (2·knee)) · slope
      //   env_dB > th + knee/2   → GR = over · slope
      // slope = 1 - 1/ratio. Output linear gain = 10^(-GR/20).
      // Cheap early-out: below the knee floor, gain = 1 (no log/exp).
      let gainLin8 = 1.0;
      if (glueEnv > glueKneeFloor) {
        const envDb = 20 * Math.log10(glueEnv + 1e-24);
        const over  = envDb - glueThDB;
        let grDb;
        if (over > glueKneeHalf) {
          grDb = over * glueSlope;
        } else {
          // Inside knee — quadratic blend from 0 to full slope
          const x = over + glueKneeHalf;    // [0, knee]
          grDb = (x * x) * glueKneeInv2 * glueSlope;
        }
        gainLin8 = Math.pow(10, -grDb / 20);
      }
      // Capture pre-glue wet for the chorus tap (matches prototype: both
      // GLUE and CHORUS tap delayOut in parallel, then sum into wDelay).
      const preGlueL8 = wL;
      const preGlueR8 = wR;
      wL *= gainLin8;
      wR *= gainLin8;

      // ── STAGE 8B: CHORUS (single-voice modulated delay, stereo-parallel) ──
      // Same LFO drives both channels; L/R tap reads identical delays.
      // Chorus input is pre-glue wet (captured above) so GLUE's transient
      // shaping doesn't feed the chorus line. Chorus output sums into
      // post-glue wet bus with beast-scaled wet amount.
      const chorusDelSa8 = chorusBaseSa + chorusDepthSa_s * Math.sin(chorusLfo);
      const crp8   = chorusIdx - chorusDelSa8;
      const crp8F  = Math.floor(crp8);
      const crp8f  = crp8 - crp8F;
      const cLa8   = chorusBufL[crp8F       & CHORUS_MASK];
      const cLb8   = chorusBufL[(crp8F + 1) & CHORUS_MASK];
      const chorL8 = cLa8 + (cLb8 - cLa8) * crp8f;
      const cRa8   = chorusBufR[crp8F       & CHORUS_MASK];
      const cRb8   = chorusBufR[(crp8F + 1) & CHORUS_MASK];
      const chorR8 = cRa8 + (cRb8 - cRa8) * crp8f;
      // Write pre-glue wet into chorus ring (denormal-scrubbed)
      chorusBufL[chorusIdx] = this._dn(preGlueL8);
      chorusBufR[chorusIdx] = this._dn(preGlueR8);
      chorusIdx = (chorusIdx + 1) & CHORUS_MASK;
      // Parallel chorus add
      wL += chorusWet_s * chorL8;
      wR += chorusWet_s * chorR8;
      // Advance LFO, wrap at 2π
      chorusLfo += chorusInc; if (chorusLfo > TWO_PI) chorusLfo -= TWO_PI;

      // ── Master HPF/LPF on wet chain ─────────────────────────────────
      wL = this._biq(5, bqL, wL);
      wL = this._biq(6, bqL, wL);
      wR = this._biq(5, bqR, wR);
      wR = this._biq(6, bqR, wR);

      // ── STAGE 8C: BEAST auto-makeup (inverse-GR peak-tracked makeup) ──
      // Replaces the prototype's RMS-chase with a direct inverse-GR
      // tracker. The GR amount in dB (from Stage 8A's gainLin8) is
      // smoothed symmetrically with a 180 ms time constant, and its
      // inverse is applied as makeup gain.
      //
      // Why this is better than prototype:
      //   • No clamp required — inverse of 0 dB GR is 0 dB makeup, so
      //     silence → makeup=1 naturally (no runaway chase on one-shot
      //     loop gaps).
      //   • Symmetric TC → no pump. GR attack (3 ms) and release (60 ms)
      //     are both faster than 180 ms smoother, so transient-only GR
      //     (≤ ~180 ms duration) stays UNCOMPENSATED → GLUE's transient-
      //     shaping character is preserved. Sustained GR (> 180 ms)
      //     gets restored 1:1 → no perceived loudness drop.
      //   • Scales with beastP so at FLIP=0 the makeup collapses to
      //     unity regardless of whatever mild GR the comp is still doing
      //     at its rest threshold/ratio.
      //
      // Math:
      //   grDbNow    = -20·log10(gainLin8)   (≥ 0, 0 when gainLin8=1)
      //   beastGrSm  ← smoothed grDbNow      (one-pole, TC 180 ms)
      //   makeupDb   = beastGrSm · beastP    (scale by knob)
      //   makeupLin  = 10^(makeupDb/20)
      const grDbNow = gainLin8 < 1 ? -20 * Math.log10(gainLin8) : 0;
      beastGrSm += (grDbNow - beastGrSm) * beastTrimA;
      const makeupDb8  = beastGrSm * beastP;
      const makeupLin8 = makeupDb8 > 0 ? Math.pow(10, makeupDb8 * 0.05) : 1;
      wL *= makeupLin8;
      wR *= makeupLin8;

      // ── STAGE 9: TUNE (granular ±12 semi crossfade on wet bus) ──────
      // Write current wet to ring buffers (always, so phases+buf stay
      // coherent when tune is scrubbed off→on mid-signal). Denormal-
      // scrub on write — ring buffer holds wet bus state across long
      // silence gaps, subnormals here cascade into makeup math.
      tuneBufL[tuneIdx] = this._dn(wL);
      tuneBufR[tuneIdx] = this._dn(wR);

      if (tuneActive) {
        // Down-voice pair — delay ramps 0 → grainSa over period (ratio
        // 0.5 → read head lags at half-speed → one octave down).
        const tp1D    = tunePhase1Dn * tunePeriodInvDn;              // [0, 1)
        const td1D    = tp1D * tuneGrainSa;                          // delay in samples
        const trp1D   = tuneIdx - td1D;
        const trp1DF  = Math.floor(trp1D);
        const trp1Df  = trp1D - trp1DF;
        const tv1DLa  = tuneBufL[trp1DF       & TUNE_MASK];
        const tv1DLb  = tuneBufL[(trp1DF + 1) & TUNE_MASK];
        const tv1DL   = tv1DLa + (tv1DLb - tv1DLa) * trp1Df;
        const tv1DRa  = tuneBufR[trp1DF       & TUNE_MASK];
        const tv1DRb  = tuneBufR[(trp1DF + 1) & TUNE_MASK];
        const tv1DR   = tv1DRa + (tv1DRb - tv1DRa) * trp1Df;
        const tw1D    = 0.5 - 0.5 * Math.cos(TWO_PI * tp1D);         // Hann

        const tp2D    = tunePhase2Dn * tunePeriodInvDn;
        const td2D    = tp2D * tuneGrainSa;
        const trp2D   = tuneIdx - td2D;
        const trp2DF  = Math.floor(trp2D);
        const trp2Df  = trp2D - trp2DF;
        const tv2DLa  = tuneBufL[trp2DF       & TUNE_MASK];
        const tv2DLb  = tuneBufL[(trp2DF + 1) & TUNE_MASK];
        const tv2DL   = tv2DLa + (tv2DLb - tv2DLa) * trp2Df;
        const tv2DRa  = tuneBufR[trp2DF       & TUNE_MASK];
        const tv2DRb  = tuneBufR[(trp2DF + 1) & TUNE_MASK];
        const tv2DR   = tv2DRa + (tv2DRb - tv2DRa) * trp2Df;
        const tw2D    = 0.5 - 0.5 * Math.cos(TWO_PI * tp2D);

        const tuneDnL = tv1DL * tw1D + tv2DL * tw2D;
        const tuneDnR = tv1DR * tw1D + tv2DR * tw2D;

        // Up-voice pair — inverse ramp (delay shrinks grainSa → 0 over
        // period, ratio 2.0 → read head races at 2× → one octave up).
        const tp1U    = tunePhase1Up * tunePeriodInvUp;
        const td1U    = (1 - tp1U) * tuneGrainSa;
        const trp1U   = tuneIdx - td1U;
        const trp1UF  = Math.floor(trp1U);
        const trp1Uf  = trp1U - trp1UF;
        const tv1ULa  = tuneBufL[trp1UF       & TUNE_MASK];
        const tv1ULb  = tuneBufL[(trp1UF + 1) & TUNE_MASK];
        const tv1UL   = tv1ULa + (tv1ULb - tv1ULa) * trp1Uf;
        const tv1URa  = tuneBufR[trp1UF       & TUNE_MASK];
        const tv1URb  = tuneBufR[(trp1UF + 1) & TUNE_MASK];
        const tv1UR   = tv1URa + (tv1URb - tv1URa) * trp1Uf;
        const tw1U    = 0.5 - 0.5 * Math.cos(TWO_PI * tp1U);

        const tp2U    = tunePhase2Up * tunePeriodInvUp;
        const td2U    = (1 - tp2U) * tuneGrainSa;
        const trp2U   = tuneIdx - td2U;
        const trp2UF  = Math.floor(trp2U);
        const trp2Uf  = trp2U - trp2UF;
        const tv2ULa  = tuneBufL[trp2UF       & TUNE_MASK];
        const tv2ULb  = tuneBufL[(trp2UF + 1) & TUNE_MASK];
        const tv2UL   = tv2ULa + (tv2ULb - tv2ULa) * trp2Uf;
        const tv2URa  = tuneBufR[trp2UF       & TUNE_MASK];
        const tv2URb  = tuneBufR[(trp2UF + 1) & TUNE_MASK];
        const tv2UR   = tv2URa + (tv2URb - tv2URa) * trp2Uf;
        const tw2U    = 0.5 - 0.5 * Math.cos(TWO_PI * tp2U);

        const tuneUpL = tv1UL * tw1U + tv2UL * tw2U;
        const tuneUpR = tv1UR * tw1U + tv2UR * tw2U;

        // Crossfade blend — linear on the knob (matches prototype):
        //   tune=0   → dry=1, dn=0, up=0  (identity — but tuneActive=false already bypasses here)
        //   tune=−1  → dry=0, dn=1, up=0  (full octave down)
        //   tune=+1  → dry=0, dn=0, up=1  (full octave up)
        wL = wL * tuneDryAmt_s + tuneDnL * tuneDnAmt_s + tuneUpL * tuneUpAmt_s;
        wR = wR * tuneDryAmt_s + tuneDnR * tuneDnAmt_s + tuneUpR * tuneUpAmt_s;
      }

      // Advance write head + phase counters unconditionally so the ring
      // buffer and voice cursors stay aligned whether or not TUNE is
      // active this sample. Modulo fold matches Stage 5 ghost pattern.
      tuneIdx = (tuneIdx + 1) & TUNE_MASK;
      tunePhase1Dn += 1; if (tunePhase1Dn >= tunePeriodSaDn) tunePhase1Dn -= tunePeriodSaDn;
      tunePhase2Dn += 1; if (tunePhase2Dn >= tunePeriodSaDn) tunePhase2Dn -= tunePeriodSaDn;
      tunePhase1Up += 1; if (tunePhase1Up >= tunePeriodSaUp) tunePhase1Up -= tunePeriodSaUp;
      tunePhase2Up += 1; if (tunePhase2Up >= tunePeriodSaUp) tunePhase2Up -= tunePeriodSaUp;

      // Equal-power dry/wet sum — in-worklet, phase-coherent.
      // At Mix=0 → mixWet=0, mixDry=1, out = xL/xR untouched.
      const mL = mixWet * wL + mixDry * xL;
      const mR = mixWet * wR + mixDry * xR;

      // Final safety soft-knee clipper — transparent below ±0.9, smoothly
      // rounds into ±1.0 above. Catches transient overshoot when several
      // stages stack (hot FANG + DOUBLER + ghost on a polyphonic piano
      // attack is a realistic worst case). Piecewise so it doesn't color
      // the tonal body at normal levels — only the last 1 dB of headroom.
      //   |x| < 0.9          → pass through
      //   |x| ≥ 0.9          → sign · (0.9 + 0.1·tanh((|x|−0.9)·10))
      // Asymptotes to ±1.0 for any input; transparent below threshold.
      const axL = mL >= 0 ? mL : -mL;
      const axR = mR >= 0 ? mR : -mR;
      const cL  = axL < 0.9 ? mL : (mL >= 0 ? 1 : -1) * (0.9 + 0.1 * Math.tanh((axL - 0.9) * 10));
      const cR  = axR < 0.9 ? mR : (mR >= 0 ? 1 : -1) * (0.9 + 0.1 * Math.tanh((axR - 0.9) * 10));

      oL[n] = wetScale * cL;
      oR[n] = wetScale * cR;
    }

    // Persist DOUBLER state back to instance
    this.dbl1PhaseA = dbl1PhaseA; this.dbl1PhaseB = dbl1PhaseB;
    this.dbl2PhaseA = dbl2PhaseA; this.dbl2PhaseB = dbl2PhaseB;
    this.dblIdx1 = dblIdx1;       this.dblIdx2 = dblIdx2;

    // Persist DELAY state back to instance
    this.dlyIdx        = dlyIdx;
    this.dlyFbLpL      = this._dn(fbLpL);
    this.dlyFbLpR      = this._dn(fbLpR);
    this.dlyMsSmoothed = dlyMsSm;

    // Persist PING-PONG state back to instance
    this.pingIdx         = pingIdx;
    this.pingLfoL        = pingLfoL;
    this.pingLfoR        = pingLfoR;
    this.pingSpSmoothed  = pingSpSm;

    // Persist PITCH GHOST state back to instance
    this.ghostIdx      = ghostIdx;
    this.ghostPhase1   = ghostPhase1;
    this.ghostPhase2   = ghostPhase2;
    this.ghostPhase1Up = ghostPhase1Up;
    this.ghostPhase2Up = ghostPhase2Up;

    // Persist STAGE 8 state back to instance
    this.glueEnv    = this._dn(glueEnv);
    this.chorusIdx  = chorusIdx;
    this.chorusLfo  = chorusLfo;
    this.beastGrSm  = this._dn(beastGrSm);

    // Persist STAGE 9 state back to instance
    this.tuneIdx      = tuneIdx;
    this.tunePhase1Dn = tunePhase1Dn;
    this.tunePhase2Dn = tunePhase2Dn;
    this.tunePhase1Up = tunePhase1Up;
    this.tunePhase2Up = tunePhase2Up;

    return true;
  }
}

try {
  registerProcessor('nastybeast-processor-${PROCESSOR_VERSION}', NastyBeastProcessor);
} catch (err) {
  if (!/already registered/i.test(String(err && err.message))) throw err;
}
`;

// ── Public factory ─────────────────────────────────────────────────────
export async function createNastyBeastEngineWorklet(ctx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  // ── Graph nodes ─────────────────────────────────────────────────────
  const input       = ctx.createGain();
  const output      = ctx.createGain();
  const chainOutput = output;                // compat with engine contract

  const inTrim  = ctx.createGain(); inTrim.gain.value  = 1;
  const outTrim = ctx.createGain(); outTrim.gain.value = 1;

  // Silent fade-in (DEV_RULES H2) — matches ManChild.
  const fadeIn = ctx.createGain();
  const now = ctx.currentTime;
  fadeIn.gain.value = 0;
  fadeIn.gain.setValueAtTime(0, now);
  fadeIn.gain.setValueAtTime(0, now + 0.180);
  fadeIn.gain.linearRampToValueAtTime(1, now + 0.240);

  // Explicit 2-channel topology throughout, matching the prototype so
  // L/R carry independently through every stage once DSP lands.
  for (const n of [input, output, inTrim, outTrim, fadeIn]) {
    n.channelCount         = 2;
    n.channelCountMode     = 'explicit';
    n.channelInterpretation = 'speakers';
  }

  // Worklet node
  const worklet = new AudioWorkletNode(ctx, `nastybeast-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs:  1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });

  // wetGain stays at unity; the worklet handles dry/wet blending
  // internally. wetGain exists as a single choke point so bypassRelay can
  // cut it cleanly on bypass ON.
  const wetGain = ctx.createGain(); wetGain.gain.value = 1;
  wetGain.channelCount = 2;
  wetGain.channelCountMode = 'explicit';
  wetGain.channelInterpretation = 'speakers';

  // ── Binary bypass relay (pre-inTrim tap) ────────────────────────────
  // Routes input → sumNode directly on bypass=ON. Never fractional, so
  // there is zero comb-filter risk — see ManChild v6 note.
  const bypassRelay = ctx.createGain(); bypassRelay.gain.value = 0;
  bypassRelay.channelCount = 2;
  bypassRelay.channelCountMode = 'explicit';
  bypassRelay.channelInterpretation = 'speakers';

  const sumNode = ctx.createGain(); sumNode.gain.value = 1;
  sumNode.channelCount = 2;
  sumNode.channelCountMode = 'explicit';
  sumNode.channelInterpretation = 'speakers';

  // Wiring
  //   input → bypassRelay → sumNode   (only active on bypass ON)
  //   input → inTrim → worklet → outTrim → wetGain → sumNode
  //   sumNode → fadeIn → output
  input.connect(bypassRelay);
  input.connect(inTrim);
  bypassRelay.connect(sumNode);

  inTrim.connect(worklet);
  worklet.connect(outTrim);
  outTrim.connect(wetGain);
  wetGain.connect(sumNode);

  sumNode.connect(fadeIn);
  fadeIn.connect(output);

  // ── Meters (external, main-thread) ──────────────────────────────────
  // Matches the prototype's meter surface so the Orb UI keeps working.
  const outAna = ctx.createAnalyser(); outAna.fftSize = 1024; outAna.smoothingTimeConstant = 0;
  output.connect(outAna);
  const bassLP = ctx.createBiquadFilter(); bassLP.type = 'lowpass'; bassLP.frequency.value = 120;
  const bassAna = ctx.createAnalyser(); bassAna.fftSize = 1024; bassAna.smoothingTimeConstant = 0;
  output.connect(bassLP); bassLP.connect(bassAna);

  const buf  = new Float32Array(outAna.fftSize);
  const bbuf = new Float32Array(bassAna.fftSize);
  let peakSm = 0, bassSm = 0, rmsSm = 0;
  const DECAY = 0.94;
  function readPeak(ana, b) {
    ana.getFloatTimeDomainData(b);
    let m = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i] < 0 ? -b[i] : b[i];
      if (v > m) m = v;
    }
    return m;
  }
  function readRms(b) {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    return Math.sqrt(s / b.length);
  }

  // ── Worklet param handles ───────────────────────────────────────────
  const pMix    = worklet.parameters.get('mix');
  const pBypass = worklet.parameters.get('bypass');
  const pFeed   = worklet.parameters.get('feed');
  const pSnarl  = worklet.parameters.get('snarl');
  const pHaunt  = worklet.parameters.get('haunt');
  const pRoam   = worklet.parameters.get('roam');
  const pBreath = worklet.parameters.get('breath');
  const pSpread = worklet.parameters.get('spread');
  const pBeast  = worklet.parameters.get('beast');
  const pTune   = worklet.parameters.get('tune');
  const pHpf    = worklet.parameters.get('hpf');
  const pLpf    = worklet.parameters.get('lpf');

  // ── Main-thread state mirrors (for getState) ────────────────────────
  let mixVal     = 1.0;
  let bypassed   = false;
  let beastAmt   = 0;
  const macros = { feed: 0, roam: 0, haunt: 0, breath: 0, snarl: 0, spread: 0 };
  let tuneVal   = 0;
  let hpfHz     = 20;
  let lpfHz     = 20000;

  function applyMixAndBypass() {
    const t = ctx.currentTime;
    const tau = 0.04;
    if (bypassed) {
      bypassRelay.gain.setTargetAtTime(1, t, 0.005);
      wetGain.gain.setTargetAtTime(0, t, 0.005);
      pBypass.setTargetAtTime(1, t, 0.005);
    } else {
      bypassRelay.gain.setTargetAtTime(0, t, 0.005);
      wetGain.gain.setTargetAtTime(1, t, 0.005);
      pBypass.setTargetAtTime(0, t, 0.005);
    }
    pMix.setTargetAtTime(mixVal, t, tau);
  }
  applyMixAndBypass();

  // ── paramSchema (QC harness contract — mirrors prototype) ───────────
  const paramSchema = [
    { name: 'setIn',     label: 'Input (lin)',  kind: 'unit',  min: 0,    max: 2,    step: 0.01, def: 1 },
    { name: 'setOut',    label: 'Output (lin)', kind: 'unit',  min: 0,    max: 2,    step: 0.01, def: 1 },
    { name: 'setMix',    label: 'Mix',          kind: 'unit',  min: 0,    max: 1,    step: 0.01, def: 1 },
    { name: 'setBypass', label: 'Bypass',       kind: 'bool',  def: 0 },
    { name: 'setFeed',   label: 'SIZZLE (Feed/Drive)',      kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setRoam',   label: 'STACK (Feedback)',         kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setHaunt',  label: 'DRIZZLE (Delay Time)',     kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setBreath', label: 'FLUFF (Ghost/Breath)',     kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setSnarl',  label: 'CRISP (Asymmetric Clip)',  kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setSpread', label: 'BUTTER (Stereo Spread)',   kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setHpf',    label: 'Master HPF (Hz)', kind: 'hz', min: 20,  max: 2000,  step: 1, def: 20 },
    { name: 'setLpf',    label: 'Master LPF (Hz)', kind: 'hz', min: 500, max: 20000, step: 1, def: 20000 },
    { name: 'setTune',   label: 'Tune (-1..+1)',   kind: 'float', min: -1, max: 1, step: 0.01, def: 0,
      note: '-1 = full octave down, 0 = no shift, +1 = full octave up' },
    { name: 'setBeast',  label: 'FLIP/Beast', kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
  ];

  return {
    input, output, chainOutput,

    paramSchema,

    // ── QC capabilities declaration ──
    // NOTE — hasFeedback / hasPitchDetector / hasLFO diverge from the
    // prototype on purpose: those capabilities flip TRUE only once the
    // corresponding stage actually lands in this worklet. Declaring them
    // early makes QC run stage-specific rules (fb_mix_coupling, pitch_idle)
    // against DSP that doesn't exist yet, producing false positives that
    // obscure real bugs.
    //
    // Stage ladder for capability activation:
    //   Stage 3 (DOUBLER LFOs)   → hasLFO: true  (LANDED)
    //   Stage 6 (DELAY ENGINE)   → hasFeedback: true, nonlinearStages: 3
    //                              (LANDED — in-loop tanh sat is the 2nd
    //                              NL stage; third slot reserved for the
    //                              Stage 8 GLUE comp's soft-knee detector
    //                              so T4 OS boundary scheduling covers it)
    //   Stage 7 (PING-PONG)      → nonlinearStages: 4 (LANDED — cross-
    //                              feedback tanh soft-sat adds one NL
    //                              stage; xfb is capped at PING_XFB_MAX
    //                              = 0.35 so even at full BUTTER the
    //                              loop is stable, but the sat is still
    //                              a real nonlinearity QC must schedule
    //                              oversampling around.)
    //   Stage 5 (PITCH GHOST)    → hasPitchDetector stays false (LANDED
    //                              — granular OLA shifts by fixed ratio
    //                              0.5, no pitch tracking; no new NL
    //                              stage; ghost mono-summed into delay
    //                              input at ceiling 0.14 so feedback
    //                              headroom stays inside current -3.3 dB
    //                              margin).
    //   Stage 8 (GLUE + CHORUS)  → nonlinearStages stays 4 (LANDED —
    //                              GLUE's soft-knee gain-reduction is
    //                              the 4th NL slot we'd reserved; the
    //                              chorus is a linear modulated delay
    //                              so no new NL stage). BEAST auto-
    //                              makeup is a slow RMS → gain trim
    //                              (linear trim output, no NL). Feed-
    //                              back loop count stays 1 (chorus is
    //                              open-loop).
    capabilities: {
      categories: ['Time', 'Character'],
      subcategories: ['delay-feedback', 'distortion', 'pitch-granular'],
      hasSidechain: false,
      hasFeedback: true,               // Stage 6: in-loop tanh-sat delay loop
      hasFreeze: false,
      hasLFO: true,                    // Stage 3: DOUBLER runs 4 LFOs
      hasStereoWidth: true,
      hasMultiband: false,
      hasLookahead: false,
      hasTruePeak: false,
      hasPitchDetector: false,
      hasLPC: false,
      hasFFT: false,
      hasWDF: false,
      nonlinearStages: 4,              // FANG + delay in-loop sat + ping-pong xfb sat + Stage 8 GLUE soft-knee GR
      osThresholds: null,
      latencySamples: 0,
      crossoverPhase: null,
      dryLegHasColoration: false,
      // Stereo behavior — declared honestly for QC `pathological_stereo`:
      // The Stage 3 DOUBLER micro-detune thickener intentionally mono-sums
      // L+R before the 4×LFO detune network, then re-spreads the thickened
      // signal back to both channels. That means L-only / R-only input
      // produces near-equal output on both channels (not a bleed bug) and
      // side-only (L=−R) input collapses by design (not a mono-sum bug).
      // Rule reads this field and downgrades to INFO when declared.
      // Values: 'per-channel' | 'mono-sum-thickener' | 'stereo-enhancer' | 'mono'.
      stereoBehavior: 'mono-sum-thickener',
    },

    getLatency: () => 0,

    getState: () => ({
      in:       inTrim.gain.value,
      out:      outTrim.gain.value,
      mix:      mixVal,
      bypass:   bypassed ? 1 : 0,
      feed:     macros.feed,
      roam:     macros.roam,
      haunt:    macros.haunt,
      breath:   macros.breath,
      snarl:    macros.snarl,
      spread:   macros.spread,
      hpfHz,
      lpfHz,
      tune:     tuneVal,
      beast:    beastAmt,
      // Telemetry stubs carried forward from prototype for QC parity —
      // values derive from main-thread mirrors so QC rules that read them
      // still see something structurally consistent at Stage 0.
      dryGainLevel:    bypassed ? 1 : 0,
      wetGainLevel:    bypassed ? 0 : 1,
      bypassGainLevel: bypassed ? 1 : 0,
    }),

    setIn: v => {
      const t = ctx.currentTime;
      inTrim.gain.setTargetAtTime(Math.max(0, v), t, 0.05);
    },
    setOut: v => {
      const t = ctx.currentTime;
      outTrim.gain.setTargetAtTime(Math.max(0, v), t, 0.05);
    },
    setMix: v => {
      mixVal = Math.max(0, Math.min(1, v));
      applyMixAndBypass();
    },
    setBypass: (on) => {
      bypassed = !!on;
      applyMixAndBypass();
    },
    isBypassed: () => bypassed,

    // Macro setters — forward to worklet AudioParams. At Stage 0 the
    // worklet ignores them; later stages will consume them.
    setFeed:   v => { macros.feed   = v; pFeed.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setRoam:   v => { macros.roam   = v; pRoam.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setHaunt:  v => { macros.haunt  = v; pHaunt.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setBreath: v => { macros.breath = v; pBreath.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setSnarl:  v => { macros.snarl  = v; pSnarl.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setSpread: v => { macros.spread = v; pSpread.setTargetAtTime(v, ctx.currentTime, 0.05); },

    setHpf: (hz) => {
      hpfHz = Math.max(20, Math.min(2000, hz));
      pHpf.setTargetAtTime(hpfHz, ctx.currentTime, 0.04);
    },
    setLpf: (hz) => {
      lpfHz = Math.max(500, Math.min(20000, hz));
      pLpf.setTargetAtTime(lpfHz, ctx.currentTime, 0.04);
    },

    setTune: (v) => {
      tuneVal = Math.max(-1, Math.min(1, v));
      pTune.setTargetAtTime(tuneVal, ctx.currentTime, 0.04);
    },

    setBeast: (amt) => {
      beastAmt = Math.max(0, Math.min(1, amt));
      pBeast.setTargetAtTime(beastAmt, ctx.currentTime, 0.05);
    },
    getBeast: () => beastAmt,

    getOutputPeak() {
      const p = readPeak(outAna, buf);
      peakSm = Math.max(p, peakSm * DECAY);
      return peakSm;
    },
    getBassLevel() {
      const p = readPeak(bassAna, bbuf);
      bassSm = Math.max(p, bassSm * DECAY);
      return bassSm;
    },
    getTransient() {
      const r = readRms(buf);
      rmsSm += (r - rmsSm) * 0.1;
      return Math.max(0, peakSm - rmsSm);
    },

    dispose() {
      try { worklet.disconnect(); } catch {}
      try { input.disconnect(); } catch {}
      try { output.disconnect(); } catch {}
    },
  };
}
