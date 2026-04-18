// FLAP JACK MAN — pancake-stack creature.
// Each pancake reacts to a different macro and to live audio signals.
// Turning a knob makes that pancake "flap" (wobble/spin briefly).
// BEAST = full stack flip + syrup splash.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReactiveCore } from '../reactive/useReactiveCore.js';
import { createNastyBeastEngine } from './nastyBeastEngine.js';

// delayBeats = musical delay length in quarter-note beats (0.5 = 1/8, 0.75 = dotted-1/8,
// 1.0 = 1/4, 0.25 = 1/16). When a scene has delayBeats, its haunt macro is computed
// from the current BPM so the delay locks to the groove instead of a free-running ms value.
const SCENES = {
  // BUTTER — breakbeat pocket. Dotted-8th delay, steady feedback, low jitter.
  BUTTER: {
    delayBeats: 0.75,
    macros: { feed: 0.05, roam: 0.32, haunt: 0.00 /*set from bpm*/, breath: 0.04, snarl: 0.00, spread: 0.18 },
    coreOpts: { pulseSlowHz: 1.0, pulseMidHz: 2.0, pulseSlowAmp: 0.6, pulseMidAmp: 0.2,
                rageThreshold: 0.18, rageRange: 0.30, rageCurve: 0.85 },
  },
  // SYRUP — quarter-note lush.
  SYRUP: {
    delayBeats: 1.0,
    macros: { feed: 0.28, roam: 0.45, haunt: 0.00, breath: 0.40, snarl: 0.15, spread: 0.45 },
    coreOpts: { pulseSlowHz: 2.0, pulseMidHz: 4.0, pulseSlowAmp: 1.0, pulseMidAmp: 0.35,
                rageThreshold: 0.10, rageRange: 0.45, rageCurve: 0.7 },
  },
  // GRIDDLE — 1/16 stutter, hot.
  GRIDDLE: {
    delayBeats: 0.25,
    macros: { feed: 0.55, roam: 0.50, haunt: 0.00, breath: 0.25, snarl: 0.40, spread: 0.70 },
    coreOpts: { pulseSlowHz: 4.0, pulseMidHz: 8.0, pulseSlowAmp: 0.8, pulseMidAmp: 0.3,
                rageThreshold: 0.06, rageRange: 0.4,  rageCurve: 0.65 },
  },
};

// haunt macro range: 80 ms .. 1200 ms (must match engine applyAll).
function hauntForBeats(bpm, beats) {
  const sec = (60 / Math.max(40, Math.min(240, bpm))) * beats;
  const clamped = Math.max(0.080, Math.min(1.20, sec));
  return (clamped - 0.080) / (1.20 - 0.080);
}
function macrosForScene(name, bpm) {
  const s = SCENES[name];
  if (!s.delayBeats) return { ...s.macros };
  return { ...s.macros, haunt: hauntForBeats(bpm, s.delayBeats) };
}

// Pancake roles: which macro drives each cake.
//   top    → FEED   (browning / sizzle)
//   second → BREATH (squish on pitch ghost)
//   third  → HAUNT  (delay time = horizontal lag)
//   fourth → ROAM   (bounce = feedback)
//   bottom → SPREAD (lateral split = stereo width)
//   butter → SNARL  (melt/drip)
const MACRO_NAMES = ['feed', 'roam', 'haunt', 'breath', 'snarl', 'spread'];
// Pancake-themed display names for the bottom knobs.
//   FEED   → SIZZLE  (heat / drive)
//   ROAM   → STACK   (feedback = pancakes piling up / repeating)
//   HAUNT  → DRIZZLE (delay time = syrup drizzle)
//   BREATH → FLUFF   (pitch ghost = airy lift)
//   SNARL  → CRISP   (asymmetric clip = burnt edges)
//   SPREAD → BUTTER  (stereo width = butter spreading across)
const MACRO_LABELS = {
  feed: 'SIZZLE', roam: 'STACK', haunt: 'DRIZZLE',
  breath: 'FLUFF', snarl: 'CRISP', spread: 'BUTTER',
};
// Background dancers — syrup people bopping on the beat behind the stack.
// Spread across the SVG width, each at slightly different sizes/heights.
// Butter people dancing in the back row.
const SYRUP_PEOPLE = [
  { id: 'd0', x:  50, y: 180, scale: 0.85, beatOffset: 0 },
  { id: 'd1', x: 105, y: 192, scale: 1.00, beatOffset: 1 },
  { id: 'd2', x: 165, y: 178, scale: 0.90, beatOffset: 2 },
  { id: 'd3', x: 215, y: 195, scale: 1.05, beatOffset: 3 },
  { id: 'd4', x: 345, y: 195, scale: 1.00, beatOffset: 0 },
  { id: 'd5', x: 395, y: 178, scale: 0.92, beatOffset: 2 },
  { id: 'd6', x: 455, y: 192, scale: 1.05, beatOffset: 1 },
  { id: 'd7', x: 510, y: 184, scale: 0.85, beatOffset: 3 },
];

const PANCAKES = [
  { id: 'top',    macro: 'feed',   y: 92,  baseW: 130, baseH: 18 },
  { id: 'p2',     macro: 'breath', y: 118, baseW: 150, baseH: 20 },
  { id: 'p3',     macro: 'haunt',  y: 146, baseW: 168, baseH: 22 },
  { id: 'p4',     macro: 'roam',   y: 176, baseW: 180, baseH: 24 },
  { id: 'bottom', macro: 'spread', y: 208, baseW: 196, baseH: 26 },
];

export default function NastyBeastOrb({ sharedSource, registerEngine, unregisterEngine, instanceId = 'flapjack' }) {
  const engineRef = useRef(null);
  const chamberRef= useRef(null);
  const splashRef = useRef(null);
  const panRefs   = useRef({});  // id → SVG g
  const dancerRefs= useRef({});  // syrup-people refs
  const forkRef   = useRef(null);
  const knifeRef  = useRef(null);
  const flapRefs  = useRef({});  // id → { until, dir }
  const envRefs   = useRef({});  // id → { punch, low, sway, bright }
  const lastTickRef = useRef(performance.now());
  const lastSinceBeatRef = useRef(0);
  const beatCountRef = useRef(0);
  const beatPulseRef = useRef(0);
  const bpmRef = useRef(120);
  const autoBpmRef = useRef(false);
  const lastMacroRef = useRef({});

  const [scene, setScene]     = useState('BUTTER');
  const [macros, setMacros]   = useState(() => macrosForScene('BUTTER', 120));
  const [bpm, setBpm]         = useState(120);
  const [bpmInput, setBpmInput] = useState('120');   // raw text while editing
  const [autoBpm, setAutoBpm] = useState(false);
  const [hpfHz, setHpfHz] = useState(20);
  const [lpfHz, setLpfHz] = useState(20000);
  const [tune, setTune]   = useState(0);
  useEffect(() => { engineRef.current?.setHpf?.(hpfHz); }, [hpfHz]);
  useEffect(() => { engineRef.current?.setLpf?.(lpfHz); }, [lpfHz]);
  useEffect(() => { engineRef.current?.setTune?.(tune); }, [tune]);
  // Onset-tracker state for live BPM detection
  const onsetRef = useRef({
    lastOnsetT: 0,
    lastTrans: 0,
    intervals: [],          // sliding window of inter-onset intervals (ms)
    floor: 0.04,            // adaptive transient threshold
  });
  const [pendingScene, setPendingScene] = useState(null);  // queued for next bar
  const beatPhaseRef = useRef(performance.now());           // beat-clock origin
  const tapTimesRef  = useRef([]);                          // tap-tempo history
  const macrosRef = useRef(macros);
  macrosRef.current = macros;

  const [inDb,   setInDb]   = useState(0);
  const [outDb,  setOutDb]  = useState(0);
  const [mix,    setMix]    = useState(0.35);
  const [bypass, setBypass] = useState(false);

  const [beastDown, setBeastDown] = useState(false);
  const beastAmtRef = useRef(0);
  const lastTransRef = useRef(0);
  const lastSplashRef = useRef(0);
  const lastPourRef   = useRef(0);

  useEffect(() => {
    if (!sharedSource) return;
    let alive = true;
    (async () => {
      const eng = createNastyBeastEngine(sharedSource.ctx);
      if (!alive) { eng.dispose(); return; }
      engineRef.current = eng;
      eng.setFeed(macros.feed); eng.setRoam(macros.roam); eng.setHaunt(macros.haunt);
      eng.setBreath(macros.breath); eng.setSnarl(macros.snarl); eng.setSpread(macros.spread);
      eng.setIn(Math.pow(10, inDb / 20));
      eng.setOut(Math.pow(10, outDb / 20));
      eng.setMix(mix);
      eng.setBypass(bypass);
      registerEngine?.(instanceId, eng);
    })();
    return () => {
      alive = false;
      unregisterEngine?.(instanceId);
      engineRef.current?.dispose();
      engineRef.current = null;
      if (queueTimerRef.current) { clearTimeout(queueTimerRef.current); queueTimerRef.current = null; }
      if (morphRef.current) { cancelAnimationFrame(morphRef.current); morphRef.current = null; }
    };
  }, [sharedSource]);

  const sceneOpts = SCENES[scene].coreOpts;
  const core = useReactiveCore(engineRef, useMemo(() => ({
    ...sceneOpts,
    onTick: (s) => {
      const beast = beastAmtRef.current;
      const m = macrosRef.current;
      const now = performance.now();
      const t = now / 1000;

      const energy = s.energy;
      const pulse  = s.pulse;
      const rage   = Math.min(1, Math.max(s.rage, 0.85 * beast));
      const trans  = s.transient;
      const boom   = s.boom;

      // ── Per-pancake animation ───────────────────────────────────────────
      // Pancakes are AUDIO-DRIVEN. No autonomous time-based wobble.
      // Each cake holds 3 envelopes that follow live signals:
      //   punch — fast attack on transient, ~150ms decay (kick → squash)
      //   low   — boom-driven, slower (sustained low energy → vertical bob)
      //   bright— overall energy follower (continuous breathe)
      // Macro value scales each cake's sensitivity to its signal.
      const dt = Math.max(0.001, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      // ── Beat clock: detect beat boundary, fire a beat-pulse envelope ─────
      const beatLenMs = 60000 / Math.max(40, Math.min(240, bpmRef.current));
      const sinceBeat = ((now - beatPhaseRef.current) % beatLenMs + beatLenMs) % beatLenMs;
      const lastSince = lastSinceBeatRef.current;
      const beatHit   = sinceBeat < lastSince;   // wrapped → new beat
      lastSinceBeatRef.current = sinceBeat;
      if (beatHit) {
        beatCountRef.current = (beatCountRef.current + 1) % 4;
        beatPulseRef.current = 1.0;     // fresh pulse — stack-wide
      } else {
        // exponential decay over ~ half a beat
        const tau = (beatLenMs / 1000) * 0.45;
        beatPulseRef.current *= Math.exp(-dt / tau);
      }
      const beatBar  = beatCountRef.current;     // 0..3
      const isDownbeat = beatBar === 0;
      const beatPulse = beatPulseRef.current;
      // one-pole follower coeffs — softer / smoother now
      const followAtk = 1 - Math.exp(-dt / 0.045);  // 45ms attack — gentler
      const followRel = 1 - Math.exp(-dt / 0.380);  // 380ms release — buttery decay
      const lowAtk    = 1 - Math.exp(-dt / 0.090);
      const lowRel    = 1 - Math.exp(-dt / 0.500);
      const brightCoef= 1 - Math.exp(-dt / 0.180);

      for (const cake of PANCAKES) {
        const node = panRefs.current[cake.id];
        if (!node) continue;
        const macroVal = m[cake.macro] || 0;

        const env = envRefs.current[cake.id] || (envRefs.current[cake.id] = { punch: 0, low: 0, bright: 0 });
        // peak-style follower for punch (attacks fast, releases slow)
        const punchTarget = trans * (0.6 + macroVal * 1.4);
        if (punchTarget > env.punch) env.punch += (punchTarget - env.punch) * followAtk;
        else                          env.punch += (punchTarget - env.punch) * followRel;
        const lowTarget = boom * (0.5 + macroVal * 0.8);
        if (lowTarget > env.low) env.low += (lowTarget - env.low) * lowAtk;
        else                      env.low += (lowTarget - env.low) * lowRel;
        env.bright += (energy - env.bright) * brightCoef;

        const punch  = env.punch;
        const low    = env.low;
        const bright = env.bright;

        // flap envelope from recent knob movement (preserved as a real input)
        const flap = flapRefs.current[cake.id];
        let flapScale = 0, flapRot = 0;
        if (flap && flap.until > now) {
          const k = (flap.until - now) / flap.dur;       // 1 → 0
          const ease = k * k;
          flapScale = ease * 0.18 * flap.strength;
          flapRot   = Math.sin((1 - k) * Math.PI * 4) * 14 * ease * flap.dir;
        }

        // BEAT-driven base motion — every cake bobs to the BPM.
        // Each cake gets its own beat in the bar (round-robin), so the stack
        // ripples beat-by-beat instead of all moving in lockstep.
        // beatBar 0..3 → cake index in PANCAKES; pulse hits hardest on its turn.
        const cakeIdx = PANCAKES.indexOf(cake);
        const myTurn = (cakeIdx % 4) === beatBar;
        const beatBob = beatPulse * (myTurn ? 1.0 : 0.35);
        // Downbeat is heavier on every cake.
        const downbeatBoost = isDownbeat ? beatPulse * 0.25 : 0;

        // Transient squashes the cake (sx grows, sy shrinks). Boom lifts it.
        // Beat adds a rhythmic squash + lift on top of the audio response.
        let sxExtra = 1 + punch * 0.22 + bright * 0.04 + beatBob * 0.10 + downbeatBoost * 0.06;
        let syExtra = 1 - punch * 0.14 + bright * 0.05 - beatBob * 0.06 - downbeatBoost * 0.04;
        let lift    = -low * 6 - punch * 2 - beatBob * 5 - downbeatBoost * 3;
        let lateral = 0, rotExtra = 0, browning = 0;

        if (cake.macro === 'feed') {
          // browning is a slow level meter on the FEED'd signal
          browning = Math.min(1, env.bright * (0.6 + macroVal * 1.8) + punch * 0.5);
        }
        if (cake.macro === 'breath') {
          // pitch-ghost cake: deep low-driven squish
          syExtra -= low * 0.18 * (0.4 + macroVal);
          sxExtra += low * 0.10 * (0.4 + macroVal);
        }
        if (cake.macro === 'haunt') {
          // delay TIME → physical lateral lag. Pulse is the engine's beat
          // signal, so this maps "delay" → "drag side-to-side on the beat."
          lateral = (pulse - 0.5) * 2 * (macroVal * 22) + (punch - bright) * macroVal * 6;
        }
        if (cake.macro === 'roam') {
          // ROAM = feedback. Each transient leaves a residual bounce that
          // decays slower as ROAM grows (feedback ≈ memory of the kick).
          syExtra += punch * (0.10 + macroVal * 0.45);
          lift    -= punch * macroVal * 5;
        }
        if (cake.macro === 'spread') {
          // SPREAD = stereo width → physical horizontal stretch +
          // a tilt that reverses sign with each transient.
          sxExtra += macroVal * (0.10 + punch * 0.35);
          // alternating tilt: store last sign
          env.spreadSign = env.spreadSign || 1;
          if (trans > 0.10 && env.lastTrans <= 0.10) env.spreadSign *= -1;
          env.lastTrans = trans;
          rotExtra = punch * macroVal * 12 * env.spreadSign;
        }

        // ── FLIP MODE: each pancake does real flips, staggered around the bar
        // Trigger a new flip on the cake whose turn it is on the beat.
        // A flip = full vertical scaleY swing 1 → -1 → 1 + arc up + spin.
        if (beast > 0.05 && beatHit && myTurn && (!env.flipUntil || env.flipUntil < now)) {
          // flip duration scales with beast; faster, more chaotic at full beast
          const flipDur = beatLenMs * (1.0 - beast * 0.4);  // ~1 beat → ~0.6 beat
          env.flipStart = now;
          env.flipUntil = now + flipDur;
          env.flipDur   = flipDur;
          env.flipDir   = (cakeIdx % 2 === 0) ? 1 : -1;     // alternate spin dir
        }
        let flipSy = 0, flipRot = 0, flipLift = 0, flipPunchX = 0;
        if (env.flipUntil && env.flipUntil > now) {
          const k = (now - env.flipStart) / env.flipDur;    // 0 → 1
          // scaleY swings smoothly through -1 (this is the "pancake flip in pan")
          flipSy = Math.cos(k * Math.PI * 2);               // 1 → -1 → 1
          // arc up (parabolic): peak at k=0.5
          flipLift = -Math.sin(k * Math.PI) * 30 * (0.6 + beast * 0.6);
          // a little horizontal toss
          flipPunchX = Math.sin(k * Math.PI) * 6 * env.flipDir * beast;
          // a quarter-spin rotation overlay
          flipRot = k * 360 * env.flipDir * 0.25 * beast;
        } else if (env.flipUntil && env.flipUntil <= now) {
          env.flipUntil = 0;
        }

        const tx = lateral + flipPunchX;
        const ty = lift + flipLift;
        // Replace sy with cos-flip when flipping; otherwise normal envelope
        const flipping = env.flipUntil && env.flipUntil > now;
        const sx = sxExtra + flapScale;
        const sy = flipping
          ? flipSy * (syExtra + flapScale * 0.6)
          : (syExtra + flapScale * 0.6);
        const rot = rotExtra + flapRot + flipRot;

        node.style.transformOrigin = '50% 50%';
        node.style.transformBox = 'fill-box';
        node.setAttribute('transform',
          `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${rot.toFixed(2)} 280 ${cake.y}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`);

        // browning fill modulation on top pancake
        if (cake.macro === 'feed') {
          const cake_path = node.querySelector('.cake-body');
          const cake_top  = node.querySelector('.cake-top');
          if (cake_path) {
            const bR = Math.round(232 - browning * 60);
            const bG = Math.round(180 - browning * 90);
            const bB = Math.round(110 - browning * 75);
            cake_path.setAttribute('fill', `rgb(${bR},${bG},${bB})`);
          }
          if (cake_top) {
            const tR = Math.round(248 - browning * 60);
            const tG = Math.round(208 - browning * 90);
            const tB = Math.round(140 - browning * 80);
            cake_top.setAttribute('fill', `rgb(${tR},${tG},${tB})`);
          }
        }
      }

      // ── Syrup-people dancers (background) ────────────────────────────────
      // Each dancer bobs on its assigned beat in the bar, plus a smaller bob
      // on every beat. Energy adds groove (head shake side-to-side).
      for (const dancer of SYRUP_PEOPLE) {
        const node = dancerRefs.current[dancer.id];
        if (!node) continue;
        const myBeat = dancer.beatOffset === beatBar;
        const bob = beatPulse * (myBeat ? 1.0 : 0.35);
        // arms/head sway with energy + small per-dancer phase via x position
        const sway = (energy * 4 + bob * 3) * Math.sign(Math.sin((dancer.x + beatBar * 30) * 0.05));
        const dy = -bob * 8 - energy * 2;
        const tilt = sway * 0.6;
        node.setAttribute('transform',
          `translate(${dancer.x.toFixed(1)} ${(dancer.y + dy).toFixed(2)}) scale(${dancer.scale}) rotate(${tilt.toFixed(2)})`);
      }

      // ── Fork / knife (foreground) — gentle sway with energy & beat ───────
      const fork = forkRef.current;
      if (fork) {
        const tilt = -6 + Math.sin(beatBar * 1.6) * 1 - beatPulse * 4 - energy * 3;
        fork.setAttribute('transform', `translate(60 280) rotate(${tilt.toFixed(2)})`);
      }
      const knife = knifeRef.current;
      if (knife) {
        const tilt = 6 - Math.sin(beatBar * 1.6) * 1 + beatPulse * 4 + energy * 3;
        knife.setAttribute('transform', `translate(500 280) rotate(${tilt.toFixed(2)})`);
      }

      // ── Syrup splash on transient + FLIP downpour ────────────────────────
      const TR = 0.08;
      if (splashRef.current && trans > TR && lastTransRef.current <= TR && now - lastSplashRef.current > 120) {
        spawnSyrupDrop(splashRef.current, beast);
        lastSplashRef.current = now;
      }
      lastTransRef.current = trans;

      // ── Auto-BPM: onset detector ─────────────────────────────────────────
      // When AUTO is on, watch the transient signal for sharp rises above an
      // adaptive floor. Inter-onset intervals → median → BPM. Refractory
      // period: 180 ms (≈333 BPM ceiling — way above music range, prevents
      // double-triggers from kick body). Window: last 16 intervals.
      if (autoBpmRef.current) {
        const o = onsetRef.current;
        // gentle floor decay so quiet sources still trigger
        o.floor = Math.max(0.025, o.floor * 0.997);
        const isOnset = trans > o.floor && trans > o.lastTrans * 1.6
                        && (now - o.lastOnsetT) > 180;
        o.lastTrans = trans;
        if (isOnset) {
          if (o.lastOnsetT > 0) {
            const dt = now - o.lastOnsetT;
            if (dt > 200 && dt < 1500) {           // 40–300 BPM raw range
              o.intervals.push(dt);
              while (o.intervals.length > 16) o.intervals.shift();
            }
          }
          o.lastOnsetT = now;
          o.floor = Math.max(o.floor, trans * 0.55);   // raise floor toward peak
        }
        // Recompute BPM every ~half second once we have enough data
        if (o.intervals.length >= 4 && now - (o.lastBpmAt || 0) > 500) {
          o.lastBpmAt = now;
          // Median is robust to spurious fast-doubles or missed beats
          const sorted = [...o.intervals].sort((a, b) => a - b);
          let median = sorted[Math.floor(sorted.length / 2)];
          let detected = 60000 / median;
          // Fold into 70-180 BPM "musical" window
          while (detected < 70)  detected *= 2;
          while (detected > 180) detected /= 2;
          const rounded = Math.round(detected);
          if (rounded >= 40 && rounded <= 240 && Math.abs(rounded - bpmRef.current) >= 1) {
            setBpm(rounded);
            beatPhaseRef.current = o.lastOnsetT;     // align to most recent onset
          }
        }
      }

      // FLIP MODE → pour syrup everywhere. Rate scales with beast amount:
      // ~5 drops/sec at beast=0.1, ~40 drops/sec at beast=1.0. Drops spawn
      // across the full width and from arbitrary heights for a real downpour.
      if (splashRef.current && beast > 0.05) {
        const rate = 5 + beast * 35;        // drops per second
        const interval = 1000 / rate;
        if (now - lastPourRef.current > interval) {
          // spawn 1-3 drops at once when beast is high
          const burst = 1 + Math.floor(beast * 2 + Math.random() * beast);
          for (let i = 0; i < burst; i++) {
            spawnSyrupPour(splashRef.current, beast);
          }
          lastPourRef.current = now;
        }
      }

      // ── Chamber halo on beast ────────────────────────────────────────────
      const chamber = chamberRef.current;
      if (chamber) {
        if (beast > 0.05) {
          chamber.style.boxShadow = `0 0 ${50 + beast * 60}px rgba(255,160,40,${(0.25 * beast).toFixed(3)})`;
          chamber.style.borderColor = `rgba(255,160,40,${(0.5 * beast).toFixed(3)})`;
        } else {
          chamber.style.boxShadow = '';
          chamber.style.borderColor = 'rgba(255,255,255,0.06)';
        }
      }
    },
  }), [scene]));

  useEffect(() => { bpmRef.current = bpm; setBpmInput(String(bpm)); }, [bpm]);

  // BPM-locked delay: when BPM (or scene) changes, retarget haunt so the delay
  // stays glued to the scene's musical division (BUTTER=dotted-1/8, SYRUP=1/4,
  // GRIDDLE=1/16). User-driven DRIZZLE knob still overrides freely.
  useEffect(() => {
    const s = SCENES[scene];
    if (!s?.delayBeats) return;
    const h = hauntForBeats(bpm, s.delayBeats);
    engineRef.current?.setHaunt(h);
    setMacros(m => ({ ...m, haunt: h }));
  }, [bpm, scene]);
  useEffect(() => { autoBpmRef.current = autoBpm;
    if (autoBpm) onsetRef.current = { lastOnsetT: 0, lastTrans: 0, intervals: [], floor: 0.04 };
  }, [autoBpm]);
  useEffect(() => { core.setDrive(macros.feed + macros.snarl * 0.4); }, [macros.feed, macros.snarl]);
  useEffect(() => { engineRef.current?.setIn(Math.pow(10, inDb / 20)); }, [inDb]);
  useEffect(() => { engineRef.current?.setOut(Math.pow(10, outDb / 20)); }, [outDb]);
  useEffect(() => { engineRef.current?.setMix(mix); }, [mix]);
  useEffect(() => { engineRef.current?.setBypass(bypass); }, [bypass]);

  // Macro change → engine + trigger flap on the matching pancake
  const onMacro = (name, v) => {
    const prev = lastMacroRef.current[name] ?? v;
    const delta = v - prev;
    lastMacroRef.current[name] = v;

    const next = { ...macrosRef.current, [name]: v };
    setMacros(next);
    const eng = engineRef.current;
    if (eng) {
      if (name === 'feed')   eng.setFeed(v);
      if (name === 'roam')   eng.setRoam(v);
      if (name === 'haunt')  eng.setHaunt(v);
      if (name === 'breath') eng.setBreath(v);
      if (name === 'snarl')  eng.setSnarl(v);
      if (name === 'spread') eng.setSpread(v);
    }
    // find which cake this knob drives, trigger a flap
    const cake = PANCAKES.find(c => c.macro === name);
    if (cake) {
      const dur = 380;
      flapRefs.current[cake.id] = {
        until: performance.now() + dur,
        dur,
        dir: delta >= 0 ? 1 : -1,
        strength: Math.min(1, Math.abs(delta) * 8 + 0.3),
      };
    }
  };

  // ── BPM-synced scene morph ──────────────────────────────────────────────
  // Click a scene → it queues, then starts at the next beat and morphs over
  // one full bar (4 beats). To keep the morph from causing chaos:
  //   - HAUNT (delay time) is morphed slowly (whole bar) so no whistling
  //   - ROAM (feedback) ramps DOWN first, then up to its target, so the
  //     loop never overshoots while other params are mid-flight
  //   - changes are applied at one engine update per RAF only
  const morphRef = useRef(null);
  const queueTimerRef = useRef(null);
  const startMorph = (name) => {
    const tgt = macrosForScene(name, bpmRef.current);
    if (!engineRef.current) { setScene(name); setMacros(tgt); return; }
    const from = { ...macrosRef.current };
    const to   = tgt;
    const beatLen = 60000 / Math.max(40, Math.min(240, bpm));
    const DUR = beatLen * 4;     // one bar
    const t0  = performance.now();
    if (morphRef.current) cancelAnimationFrame(morphRef.current);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DUR);
      // smoothstep — no aggressive midpoint
      const ease = k * k * (3 - 2 * k);
      const cur = {};
      for (const m of MACRO_NAMES) cur[m] = from[m] + (to[m] - from[m]) * ease;
      // ROAM bias: dip to min(from,to)*0.5 at midpoint to prevent fb spike
      const roamFloor = Math.min(from.roam, to.roam) * 0.5;
      const dip = 1 - 4 * (k - 0.5) * (k - 0.5); // 0→1→0 across morph
      cur.roam = cur.roam - dip * (cur.roam - roamFloor) * 0.5;
      const eng = engineRef.current;
      eng?.setFeed(cur.feed);   eng?.setRoam(cur.roam);   eng?.setHaunt(cur.haunt);
      eng?.setBreath(cur.breath); eng?.setSnarl(cur.snarl); eng?.setSpread(cur.spread);
      setMacros(cur);
      if (k < 1) morphRef.current = requestAnimationFrame(step);
      else { morphRef.current = null; setPendingScene(null); setScene(name); }
    };
    morphRef.current = requestAnimationFrame(step);
  };
  const onScene = (name) => {
    if (name === scene || pendingScene === name) return;
    if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
    setPendingScene(name);
    const beatLen = 60000 / Math.max(40, Math.min(240, bpm));
    const now = performance.now();
    const sinceBeat = (now - beatPhaseRef.current) % beatLen;
    const wait = beatLen - sinceBeat;
    queueTimerRef.current = setTimeout(() => startMorph(name), wait);
  };
  const onTapTempo = () => {
    const now = performance.now();
    const arr = tapTimesRef.current;
    arr.push(now);
    while (arr.length > 5) arr.shift();
    if (arr.length >= 2) {
      const deltas = [];
      for (let i = 1; i < arr.length; i++) deltas.push(arr[i] - arr[i-1]);
      const avg = deltas.reduce((a,b) => a+b, 0) / deltas.length;
      const newBpm = Math.round(60000 / avg);
      if (newBpm >= 40 && newBpm <= 240) {
        setBpm(newBpm);
        beatPhaseRef.current = now;
      }
    } else {
      beatPhaseRef.current = now;
    }
  };

  useEffect(() => {
    let raf;
    let target = beastDown ? 1 : 0;
    const tau  = beastDown ? 0.080 : 0.250;
    let lastT  = performance.now();
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - lastT) / 1000; lastT = now;
      const a = 1 - Math.exp(-dt / Math.max(0.005, tau));
      beastAmtRef.current += (target - beastAmtRef.current) * a;
      if (Math.abs(target - beastAmtRef.current) < 0.001) beastAmtRef.current = target;
      engineRef.current?.setBeast(beastAmtRef.current);
      if (!beastDown && beastAmtRef.current < 0.001) {
        engineRef.current?.setBeast(0);
        cancelAnimationFrame(raf); return;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [beastDown]);

  useEffect(() => {
    const dn = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setBeastDown(true); } };
    const up = (e) => { if (e.code === 'Space') { e.preventDefault(); setBeastDown(false); } };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  return (
    <div ref={chamberRef} style={{
      width: 380, height: 500, boxSizing: 'border-box', padding: 12, borderRadius: 5, overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 60%, #2a1808 0%, #150a04 70%, #08050b 100%)',
      border: '1px solid rgba(255,255,255,0.06)',
      fontFamily: '"Courier New", monospace', color: '#f3e8cc',
      transition: 'box-shadow 0.05s, border-color 0.05s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.35em', color: 'rgba(255,210,140,0.85)' }}>FLAP JACK MAN</span>
        <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,160,80,0.75)' }}>SCENE: {scene}</span>
      </div>

      {/* IN / OUT / MIX / BYPASS */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto',
        gap: 10, marginBottom: 6, padding: '6px 10px',
        background: 'rgba(255,255,255,0.025)', borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.05)', alignItems: 'center',
      }}>
        <Knob label="IN"  value={inDb}  min={-24} max={12} fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={setInDb}  size={36} accent="#ffb347" defaultVal={0} />
        <Knob label="OUT" value={outDb} min={-24} max={12} fmt={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={setOutDb} size={36} accent="#ffb347" defaultVal={0} />
        <Knob label="MIX" value={mix}   min={0}   max={1}  fmt={v => `${(v*100).toFixed(0)}%`}                onChange={setMix}    size={36} accent="#ffb347" defaultVal={0.35} />
        <button onClick={() => setBypass(b => !b)}
          title={bypass ? 'Bypass ON' : 'Click to bypass'}
          style={{
            padding: '4px 8px', borderRadius: 5, alignSelf: 'center',
            background: bypass ? 'rgba(245,158,11,0.18)' : 'rgba(100,220,130,0.10)',
            border: bypass ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(100,220,130,0.35)',
            color:  bypass ? 'rgba(252,211,77,0.95)' : 'rgba(180,235,190,0.9)',
            fontFamily: 'inherit', fontSize: 7, letterSpacing: '0.2em', cursor: 'pointer',
          }}>{bypass ? 'BYPASSED' : 'ACTIVE'}</button>
      </div>

      {/* Plate + flap jack stack */}
      <div style={{ position: 'relative', height: 170, marginBottom: 4, borderRadius: 10, overflow: 'visible',
                    background: 'radial-gradient(ellipse at 50% 75%, rgba(80,50,30,0.6) 0%, rgba(0,0,0,0) 70%)' }}>
        <svg viewBox="0 0 560 280" width="100%" height="170" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
          <defs>
            <radialGradient id="plate" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#f5ebdc" />
              <stop offset="80%"  stopColor="#b4a08c" />
              <stop offset="100%" stopColor="#5a4030" />
            </radialGradient>
            <radialGradient id="syrup" cx="50%" cy="30%" r="80%">
              <stop offset="0%"  stopColor="rgba(120,60,20,0.9)" />
              <stop offset="100%" stopColor="rgba(60,25,8,1.0)" />
            </radialGradient>
            <linearGradient id="cakeShade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
            </linearGradient>
            <linearGradient id="butterBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#fff2a0" />
              <stop offset="55%"  stopColor="#ffe066" />
              <stop offset="100%" stopColor="#d8a420" />
            </linearGradient>
            <linearGradient id="utensil" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#f6f3ee" />
              <stop offset="50%" stopColor="#cdc7be" />
              <stop offset="100%" stopColor="#8a857a" />
            </linearGradient>
            <linearGradient id="utensilHandle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3a2510" />
              <stop offset="100%" stopColor="#1a1006" />
            </linearGradient>
          </defs>

          {/* ─── BACKGROUND: happy butter people dancing ────────────────── */}
          <g>
            {SYRUP_PEOPLE.map(d => (
              <g key={d.id} ref={el => { dancerRefs.current[d.id] = el; }}
                 style={{ transition: 'none' }}>
                {/* tiny shadow */}
                <ellipse cx="0" cy="34" rx="10" ry="2" fill="rgba(0,0,0,0.35)" />
                {/* body — butter pat (chunky rectangle with rounded corners) */}
                <path d="M -9 32 L -11 -2 Q -12 -10 -4 -11 L 4 -11 Q 12 -10 11 -2 L 9 32 Q 0 36 -9 32 Z"
                  fill="url(#butterBody)" stroke="rgba(150,100,15,0.7)" strokeWidth="0.7" />
                {/* body highlight stripe */}
                <path d="M -7 28 L -9 -2 Q -9 -8 -4 -9" stroke="rgba(255,250,200,0.55)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                {/* head — round butter pat */}
                <circle cx="0" cy="-18" r="8" fill="url(#butterBody)" stroke="rgba(150,100,15,0.7)" strokeWidth="0.7" />
                {/* head highlight */}
                <ellipse cx="-2.5" cy="-20.5" rx="2.2" ry="2.8" fill="rgba(255,255,220,0.7)" />
                {/* eyes — happy dots */}
                <circle cx="-2.6" cy="-18.5" r="0.95" fill="#3a2410" />
                <circle cx=" 2.6" cy="-18.5" r="0.95" fill="#3a2410" />
                {/* big smiley */}
                <path d="M -3.4 -16 Q 0 -13 3.4 -16" stroke="#3a2410" strokeWidth="1.1" fill="none" strokeLinecap="round" />
                {/* rosy cheeks */}
                <circle cx="-4.5" cy="-16.5" r="1.4" fill="rgba(255,140,120,0.55)" />
                <circle cx=" 4.5" cy="-16.5" r="1.4" fill="rgba(255,140,120,0.55)" />
                {/* arms — chunky butter sticks */}
                <path d="M -10 2 Q -16 -2 -18 -10" stroke="#e7b840" strokeWidth="3" fill="none" strokeLinecap="round" />
                <path d="M  10 2 Q  16 -2  18 -10" stroke="#e7b840" strokeWidth="3" fill="none" strokeLinecap="round" />
                {/* tiny hands */}
                <circle cx="-18" cy="-10" r="2" fill="#ffe680" stroke="rgba(150,100,15,0.6)" strokeWidth="0.5" />
                <circle cx=" 18" cy="-10" r="2" fill="#ffe680" stroke="rgba(150,100,15,0.6)" strokeWidth="0.5" />
                {/* legs */}
                <path d="M -4 32 L -5 42" stroke="#c89020" strokeWidth="3" strokeLinecap="round" />
                <path d="M  4 32 L  5 42" stroke="#c89020" strokeWidth="3" strokeLinecap="round" />
                {/* shoes */}
                <ellipse cx="-5.5" cy="42" rx="3" ry="1.4" fill="#3a2410" />
                <ellipse cx=" 5.5" cy="42" rx="3" ry="1.4" fill="#3a2410" />
              </g>
            ))}
          </g>

          {/* Plate */}
          <ellipse cx="280" cy="240" rx="220" ry="22" fill="url(#plate)" />
          <ellipse cx="280" cy="234" rx="200" ry="14" fill="#dccdb9" />

          {/* Syrup splash container — drops drift down/across */}
          <g ref={splashRef} />

          {/* Pancake stack (bottom-up rendering for proper z-order) */}
          {[...PANCAKES].reverse().map(cake => (
            <g key={cake.id} ref={el => { panRefs.current[cake.id] = el; }} style={{ transition: 'none' }}>
              {/* shadow under cake */}
              <ellipse cx="280" cy={cake.y + cake.baseH/2 + 2} rx={cake.baseW/2 - 4} ry={4}
                fill="rgba(0,0,0,0.35)" />
              {/* cake body (side) */}
              <ellipse className="cake-body" cx="280" cy={cake.y} rx={cake.baseW/2} ry={cake.baseH/2}
                fill="rgb(232,180,110)" stroke="rgba(120,70,30,0.6)" strokeWidth="1.2" />
              {/* cake top (lighter) */}
              <ellipse className="cake-top" cx="280" cy={cake.y - cake.baseH/2 + 4} rx={cake.baseW/2 - 6} ry={5}
                fill="rgb(248,208,140)" />
              {/* shading overlay */}
              <ellipse cx="280" cy={cake.y} rx={cake.baseW/2} ry={cake.baseH/2}
                fill="url(#cakeShade)" opacity="0.35" pointerEvents="none" />
            </g>
          ))}

          {/* ─── FOREGROUND: fork (left) and knife (right) ──────────────── */}
          <g ref={forkRef} style={{ transition: 'none' }}>
            {/* shadow on plate behind fork */}
            <ellipse cx="0" cy="-10" rx="14" ry="3" fill="rgba(0,0,0,0.35)" />
            {/* handle */}
            <rect x="-7" y="-110" width="14" height="105" rx="4" fill="url(#utensilHandle)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.6" />
            {/* handle highlight */}
            <rect x="-5" y="-108" width="2" height="100" fill="rgba(255,200,140,0.18)" />
            {/* neck */}
            <path d="M -8 -110 Q -10 -130 -8 -150 L 8 -150 Q 10 -130 8 -110 Z"
              fill="url(#utensil)" stroke="rgba(60,55,45,0.7)" strokeWidth="0.6" />
            {/* tines (4) */}
            <path d="M -9 -150 L -9 -200 Q -8 -204 -7 -200 L -6 -150 Z" fill="url(#utensil)" stroke="rgba(60,55,45,0.7)" strokeWidth="0.5" />
            <path d="M -3 -150 L -3 -204 Q -2 -208 -1 -204 L 0 -150 Z"  fill="url(#utensil)" stroke="rgba(60,55,45,0.7)" strokeWidth="0.5" />
            <path d="M  1 -150 L  1 -204 Q  2 -208  3 -204 L  4 -150 Z" fill="url(#utensil)" stroke="rgba(60,55,45,0.7)" strokeWidth="0.5" />
            <path d="M  6 -150 L  6 -200 Q  7 -204  8 -200 L  9 -150 Z" fill="url(#utensil)" stroke="rgba(60,55,45,0.7)" strokeWidth="0.5" />
          </g>

          <g ref={knifeRef} style={{ transition: 'none' }}>
            <ellipse cx="0" cy="-10" rx="14" ry="3" fill="rgba(0,0,0,0.35)" />
            {/* handle */}
            <rect x="-7" y="-110" width="14" height="105" rx="4" fill="url(#utensilHandle)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.6" />
            <rect x="-5" y="-108" width="2" height="100" fill="rgba(255,200,140,0.18)" />
            {/* blade — long taper to a tip */}
            <path d="M -7 -110 L -3 -210 Q 0 -214 3 -210 L 7 -110 Z"
              fill="url(#utensil)" stroke="rgba(60,55,45,0.7)" strokeWidth="0.6" />
            {/* blade edge highlight */}
            <path d="M -3 -210 Q 0 -214 3 -210 L 1 -160 Z" fill="rgba(255,255,255,0.45)" />
          </g>

        </svg>
      </div>

      {/* BPM strip */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6,
                    padding: '4px 8px', background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,210,160,0.7)' }}>BPM</span>
        <input type="number" min={40} max={240} value={bpmInput}
          onChange={e => setBpmInput(e.target.value)}
          onBlur={() => {
            const v = parseInt(bpmInput, 10);
            if (!isNaN(v)) {
              const c = Math.max(40, Math.min(240, v));
              setBpm(c); setBpmInput(String(c));
              beatPhaseRef.current = performance.now();
            } else {
              setBpmInput(String(bpm));   // revert on garbage
            }
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
          style={{ width: 42, padding: '2px 4px', background: '#1a1208', color: '#ffd2a0',
                   border: '1px solid rgba(255,180,80,0.3)', borderRadius: 3,
                   fontFamily: 'inherit', fontSize: 9, textAlign: 'center' }} />
        <button onClick={onTapTempo}
          style={{ padding: '3px 6px', background: 'rgba(255,180,80,0.12)',
                   border: '1px solid rgba(255,180,80,0.35)', color: '#ffd2a0',
                   borderRadius: 3, fontFamily: 'inherit', fontSize: 7,
                   letterSpacing: '0.2em', cursor: 'pointer' }}>TAP</button>
        <button onClick={() => setAutoBpm(a => !a)}
          title={autoBpm ? 'Auto-BPM ON — listening to incoming audio' : 'Detect BPM from incoming audio'}
          style={{ padding: '3px 6px',
                   background: autoBpm ? 'rgba(120,220,140,0.18)' : 'rgba(255,180,80,0.06)',
                   border: autoBpm ? '1px solid rgba(120,220,140,0.6)' : '1px solid rgba(255,180,80,0.25)',
                   color: autoBpm ? '#bff0c8' : 'rgba(255,210,160,0.55)',
                   borderRadius: 3, fontFamily: 'inherit', fontSize: 7,
                   letterSpacing: '0.2em', cursor: 'pointer' }}>
          {autoBpm ? 'AUTO•ON' : 'AUTO'}
        </button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <Knob label="HPF"  value={hpfHz} min={20} max={2000}  fmt={v => `${v|0}`}
                onChange={setHpfHz} size={28} accent="#7fdcff" defaultVal={20} showValue={false} />
          <Knob label="LPF"  value={lpfHz} min={500} max={20000} fmt={v => `${v|0}`}
                onChange={setLpfHz} size={28} accent="#7fdcff" defaultVal={20000} showValue={false} />
          <Knob label="TUNE" value={tune} min={-1} max={1} fmt={v => `${(v*12).toFixed(1)}st`}
                onChange={setTune} size={28} accent="#ffd2a0" defaultVal={0} showValue={false} />
        </div>
      </div>

      {/* Scene + Beast strip */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        {Object.keys(SCENES).map(s => {
          const isActive = scene === s;
          const isPending = pendingScene === s;
          return (
            <button key={s} onClick={() => onScene(s)}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: 5,
                background: isActive ? 'rgba(255,210,140,0.18)' : isPending ? 'rgba(255,180,80,0.12)' : 'rgba(255,255,255,0.02)',
                border: isActive ? '1px solid rgba(255,210,140,0.6)'
                       : isPending ? '1px dashed rgba(255,180,80,0.7)'
                       : '1px solid rgba(255,255,255,0.08)',
                color: isActive ? '#fff' : isPending ? 'rgba(255,210,140,0.85)' : 'rgba(255,255,255,0.5)',
                fontFamily: 'inherit', fontSize: 8, letterSpacing: '0.18em', cursor: 'pointer',
              }}>{s}{isPending ? ' …' : ''}</button>
          );
        })}
        <button
          onClick={() => setBeastDown(b => !b)}
          style={{
            padding: '5px 12px', borderRadius: 5,
            background: beastDown ? 'rgba(255,140,40,0.55)' : 'rgba(110,60,20,0.6)',
            border: beastDown ? '1px solid rgba(255,160,40,0.95)' : '1px solid rgba(180,90,30,0.6)',
            color: beastDown ? '#fff' : 'rgba(255,210,160,0.9)',
            fontFamily: 'inherit', fontSize: 8, letterSpacing: '0.22em', cursor: 'pointer',
            boxShadow: beastDown ? '0 0 22px rgba(255,140,40,0.75)' : 'none',
            userSelect: 'none', fontWeight: 'bold',
          }}
          title="Click to toggle FLIP MODE (Space = momentary)">
          {beastDown ? 'FLIP · ON' : 'FLIP'}
        </button>
      </div>

      {/* Macros — knobs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4,
                    padding: '8px 4px', background: 'rgba(255,255,255,0.02)',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
        {MACRO_NAMES.map(name => (
          <div key={name} style={{ display: 'flex', justifyContent: 'center' }}>
            <Knob label={MACRO_LABELS[name]} value={macros[name]} min={0} max={1}
              fmt={v => `${(v*100).toFixed(0)}`}
              onChange={(v) => onMacro(name, v)}
              size={42} accent="#ffb347" defaultVal={SCENES[scene].macros[name]} />
          </div>
        ))}
      </div>

    </div>
  );
}

// ── Knob component (drag vertical, shift=fine, double=reset) ────────────────
function Knob({ label, value, min, max, fmt, onChange, size = 56, accent = '#ffb347', defaultVal, showValue = true }) {
  const startRef = useRef({ y: 0, v: 0 });
  const norm = (max - min === 0) ? 0 : (value - min) / (max - min);
  const startAngle = -135, endAngle = 135;
  const angle = startAngle + (endAngle - startAngle) * norm;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  const ind = (angle - 90) * Math.PI / 180;
  const ix = cx + Math.cos(ind) * r * 0.78;
  const iy = cy + Math.sin(ind) * r * 0.78;
  function arc(a1, a2) {
    const s = (a1 - 90) * Math.PI / 180, e = (a2 - 90) * Math.PI / 180;
    const x1 = cx + Math.cos(s)*r, y1 = cy + Math.sin(s)*r;
    const x2 = cx + Math.cos(e)*r, y2 = cy + Math.sin(e)*r;
    const large = (a2 - a1) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }
  const onPointerDown = (e) => {
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    startRef.current = { y: e.clientY, v: value };
  };
  const onPointerMove = (e) => {
    if (!e.buttons) return;
    const dy = startRef.current.y - e.clientY;
    const range = max - min;
    const speed = (e.shiftKey ? 0.0015 : 0.006) * range;
    let nv = startRef.current.v + dy * speed;
    nv = Math.max(min, Math.min(max, nv));
    onChange(nv);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, userSelect: 'none' }}>
      <svg width={size} height={size}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={() => defaultVal !== undefined && onChange(defaultVal)}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}>
        <circle cx={cx} cy={cy} r={r + 2} fill="rgba(0,0,0,0.5)" />
        <circle cx={cx} cy={cy} r={r} fill="#241a10" stroke="rgba(255,200,140,0.18)" strokeWidth="1" />
        <path d={arc(startAngle, endAngle)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
        <path d={arc(startAngle, angle)} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={ix} y2={iy} stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={2.2} fill={accent} />
      </svg>
      <div style={{ fontSize: 8, letterSpacing: '0.25em', color: 'rgba(255,210,160,0.85)' }}>{label}</div>
      {showValue && <div style={{ fontSize: 9, color: 'rgba(255,210,160,0.5)', minHeight: 12 }}>{fmt(value)}</div>}
    </div>
  );
}

// ── Syrup splash drop ───────────────────────────────────────────────────────
function spawnSyrupDrop(container, beast) {
  const NS = 'http://www.w3.org/2000/svg';
  const drop = document.createElementNS(NS, 'circle');
  const startX = 200 + Math.random() * 160;
  const startY = 60 + Math.random() * 30;
  drop.setAttribute('cx', String(startX));
  drop.setAttribute('cy', String(startY));
  drop.setAttribute('r', String(2 + Math.random() * 2 + beast * 1.5));
  drop.setAttribute('fill', 'url(#syrup)');
  drop.setAttribute('opacity', '0.95');
  container.appendChild(drop);

  const lifeMs = 700 + Math.random() * 400;
  const driftX = (Math.random() - 0.5) * 40;
  const fallY  = 120 + Math.random() * 60 + beast * 50;
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / lifeMs);
    drop.setAttribute('cx', String(startX + driftX * k));
    drop.setAttribute('cy', String(startY + fallY * (k * k)));   // gravity ease
    drop.setAttribute('opacity', String((1 - k) * 0.95));
    if (k < 1) requestAnimationFrame(tick);
    else container.removeChild(drop);
  };
  requestAnimationFrame(tick);
}

// Bigger, longer-lived stream-style drop for FLIP-mode downpour.
// Spawns from anywhere along the top edge; can be a teardrop or a streak.
function spawnSyrupPour(container, beast) {
  const NS = 'http://www.w3.org/2000/svg';
  // 30% chance: a long streak (rect) for "stream of syrup"
  // 70%: a fat falling teardrop (ellipse)
  const isStreak = Math.random() < 0.3;
  const startX = 30 + Math.random() * 500;
  const startY = -20 + Math.random() * 60;
  let el;
  if (isStreak) {
    el = document.createElementNS(NS, 'rect');
    const w = 1.5 + Math.random() * 2.5 + beast;
    const h = 14 + Math.random() * 24 + beast * 12;
    el.setAttribute('x', String(startX - w/2));
    el.setAttribute('y', String(startY));
    el.setAttribute('width', String(w));
    el.setAttribute('height', String(h));
    el.setAttribute('rx', String(w/2));
    el.setAttribute('fill', 'url(#syrup)');
  } else {
    el = document.createElementNS(NS, 'ellipse');
    const r = 2.5 + Math.random() * 3 + beast * 2;
    el.setAttribute('cx', String(startX));
    el.setAttribute('cy', String(startY));
    el.setAttribute('rx', String(r * 0.7));
    el.setAttribute('ry', String(r * 1.3));     // teardrop-tall
    el.setAttribute('fill', 'url(#syrup)');
  }
  el.setAttribute('opacity', '0.92');
  container.appendChild(el);

  const lifeMs = 900 + Math.random() * 700;
  const driftX = (Math.random() - 0.5) * 30 * (1 + beast);
  const fallY  = 260 + Math.random() * 120 + beast * 80;   // fall well past plate
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / lifeMs);
    const ease = k * k;                  // gravity acceleration
    if (isStreak) {
      el.setAttribute('x', String(startX - parseFloat(el.getAttribute('width'))/2 + driftX * k));
      el.setAttribute('y', String(startY + fallY * ease));
    } else {
      el.setAttribute('cx', String(startX + driftX * k));
      el.setAttribute('cy', String(startY + fallY * ease));
    }
    // hold full opacity longer, fade only at the end
    const opac = k < 0.7 ? 0.92 : 0.92 * (1 - (k - 0.7) / 0.3);
    el.setAttribute('opacity', String(opac));
    if (k < 1) requestAnimationFrame(tick);
    else container.removeChild(el);
  };
  requestAnimationFrame(tick);
}
