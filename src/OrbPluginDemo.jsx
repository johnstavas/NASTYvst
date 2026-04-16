import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import ClipMeter from './ClipMeter';

const SliderRow = ({ label, value, set, min = 0, max = 1, step = 0.01, fmt, ac, labelWidth = 48 }) => (
  <div className="flex items-center gap-2">
    <span className="text-[9px] shrink-0" style={{ color: ac(45, 55, 0.55), width: labelWidth }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => set(parseFloat(e.target.value))}
      style={{ accentColor: ac(70, 60, 1), height: '3px', flex: 1 }} />
    <span className="text-[9px] text-right" style={{ color: ac(50, 60, 0.65), width: 28 }}>
      {fmt ? fmt(value) : `${Math.round(value * 100)}%`}
    </span>
  </div>
);
import { Slider } from 'reshaped';
import 'reshaped/bundle.css';
import { createAudioEngine } from './audioEngine';

export default function OrbPluginDemo({ instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState, onAudioControls }) {
  const size = 380;
  const center = size / 2;
  const innerRadius = 45;
  const outerRadius = 145; // leave margin for orb glow/fracture visuals

  const [dragging, setDragging] = useState(false);
  const [point, setPoint] = useState(() => initialState ? { x: initialState.orbX, y: initialState.orbY } : { x: center, y: center });
  const [tone, setTone] = useState(initialState?.tone ?? 0.5);
  const [space, setSpace] = useState(() => {
    if (!initialState) return 0;
    const dx = initialState.orbX - center, dy = initialState.orbY - center;
    const r = Math.sqrt(dx*dx + dy*dy);
    if (r > innerRadius) { const rr = Math.min(r, outerRadius)/outerRadius; return Math.max(0, Math.min(1, (rr - innerRadius/outerRadius)/(1 - innerRadius/outerRadius))); }
    return 0;
  });
  const [modulation, setModulation] = useState(0);
  const [tape, setTape] = useState(initialState?.tape ?? 0.0);
  const [glue, setGlue] = useState(initialState?.glue ?? 0.0);
  const [limit, setLimit] = useState(initialState?.limit ?? 0.0);
  const [mix, setMix] = useState(initialState?.mix ?? 1.0);
  const [character, setCharacter] = useState(initialState?.character ?? 0.0);
  const [spaceMode, setSpaceMode] = useState(initialState?.spaceMode ?? 'Room');
  const [orbAngle, setOrbAngle] = useState(() => {
    if (!initialState) return Math.PI * 1.5;
    const dx = initialState.orbX - center, dy = initialState.orbY - center;
    return Math.atan2(dy, dx);
  });
  const [inputGain, setInputGain] = useState(initialState?.inputGain ?? 1.0);
  const [outputGainVal, setOutputGainVal] = useState(initialState?.outputGain ?? 1.0);
  const [pan, setPan] = useState(initialState?.pan ?? 0);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [showPanel, setShowPanel] = useState(false);
  const [eqBands, setEqBands] = useState(() => initialState?.eqBands ? [...initialState.eqBands] : [0,0,0,0,0,0,0,0,0,0]);
  const [eqPreset, setEqPreset] = useState(initialState?.eqPreset ?? 'Flat');
  const [eqBypassed, setEqBypassed] = useState(initialState?.eqBypassed ?? true);

  // === PRESETS — localStorage-based ===
  const PRESET_KEY = 'nasty-orbs-presets';
  const [userPresets, setUserPresets] = useState(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [selectedPreset, setSelectedPreset] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const loadingPresetRef = useRef(!!initialState); // suppress dirty flag during preset load
  useEffect(() => { if (initialState) setTimeout(() => { loadingPresetRef.current = false; }, 50); }, []);
  const [hasInteracted, setHasInteracted] = useState(false);

  function saveCurrentPreset() {
    setSaveNameInput('');
    setShowSaveModal(true);
  }

  function confirmSavePreset() {
    const trimmed = saveNameInput.trim();
    if (!trimmed) return;
    const snapshot = {
      tone, character, tape, glue, limit, mix, inputGain, outputGainVal,
      eqBands: [...eqBands], eqPreset, eqBypassed,
      orbX: point.x, orbY: point.y,
    };
    const next = { ...userPresets, [trimmed]: snapshot };
    setUserPresets(next);
    setSelectedPreset(trimmed);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
    setShowSaveModal(false);
  }

  const DEFAULT_PRESET = {
    tone: 0.5, character: 0.0, tape: 0.0, glue: 0.0, limit: 0.0,
    mix: 1.0, inputGain: 1.0, outputGainVal: 1.0,
    eqBands: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'Flat', eqBypassed: true,
    orbX: center, orbY: center,
  };

  function loadPreset(name) {
    const p = name === 'Default' ? DEFAULT_PRESET : userPresets[name];
    if (!p) return;
    loadingPresetRef.current = true;
    setSelectedPreset(name);
    setTone(p.tone ?? 0.5);
    setCharacter(p.character ?? 0.0);
    setTape(p.tape ?? 0.0);
    setGlue(p.glue ?? 0.0);
    setLimit(p.limit ?? 0.0);
    setMix(p.mix ?? 1.0);
    setInputGain(p.inputGain ?? 1.0);
    setOutputGainVal(p.outputGainVal ?? 1.0);
    if (Array.isArray(p.eqBands)) setEqBands([...p.eqBands]);
    if (p.eqPreset) setEqPreset(p.eqPreset);
    if (typeof p.eqBypassed === 'boolean') setEqBypassed(p.eqBypassed);
    const ox = p.orbX ?? center;
    const oy = p.orbY ?? center;
    setPoint({ x: ox, y: oy });
    const dx = ox - center, dy = oy - center;
    const r = Math.sqrt(dx * dx + dy * dy);
    setOrbAngle(Math.atan2(dy, dx));
    if (r > innerRadius) {
      const rr = Math.min(r, outerRadius) / outerRadius;
      setSpace(clamp((rr - innerRadius / outerRadius) / (1 - innerRadius / outerRadius), 0, 1));
    } else {
      setSpace(0);
    }
    // Clear flag after all state updates have been queued
    setTimeout(() => { loadingPresetRef.current = false; }, 50);
  }

  // Mark preset as "Custom Preset" when user changes anything after loading
  useEffect(() => {
    if (loadingPresetRef.current) return;
    setHasInteracted(true);
    if (selectedPreset !== '') setSelectedPreset('');
  }, [tone, character, tape, glue, limit, mix, inputGain, outputGainVal, eqBands, point.x, point.y]);

  function deletePreset(name) {
    if (!name || !userPresets[name]) return;
    // no confirm dialog — delete directly
    const next = { ...userPresets };
    delete next[name];
    setUserPresets(next);
    if (selectedPreset === name) setSelectedPreset('');
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
  }


  const [audioSource, setAudioSource] = useState('none'); // 'none' | 'file' | 'mic'
  const [fileName, setFileName] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(0);
  const [meterData, setMeterData] = useState(null);
  const [inputLevel, setInputLevel] = useState(-60);
  const [outputLevel, setOutputLevel] = useState(-60);
  const [inputPeak, setInputPeak] = useState(-60);
  const [outputPeak, setOutputPeak] = useState(-60);

  // Audio-reactive visuals
  const [reactive, setReactive] = useState({ low: 0, mid: 0, high: 0, energy: 0, transient: 0 });
  const [wobbleTime, setWobbleTime] = useState(0);

  const lastRef = useRef({ x: point.x, y: point.y, t: performance.now() });
  const wrapRef = useRef(null);
  const engineRef = useRef(null);
  const fileInputRef = useRef(null);
  const meterRef = useRef(null);
  const wobbleTimeRef = useRef(0);

  // Initialize audio engine
  useEffect(() => {
    const engine = createAudioEngine(instanceId, sharedSource);
    engineRef.current = engine;
    // Register with App for series chaining
    registerEngine?.(instanceId, engine);
    // If shared source is already playing, sync local state
    if (sharedSource?.getIsPlaying()) {
      setIsPlaying(true);
      setAudioSource('file');
    }
    return () => {
      unregisterEngine?.(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Sync all params to engine
  useEffect(() => { engineRef.current?.setTone(tone); }, [tone]);
  useEffect(() => { engineRef.current?.setModulation(modulation); }, [modulation]);
  useEffect(() => { engineRef.current?.setTape(tape); }, [tape]);
  useEffect(() => { engineRef.current?.setGlue(glue); }, [glue]);
  useEffect(() => { engineRef.current?.setLimit(limit); }, [limit]);
  useEffect(() => { engineRef.current?.setMix(mix); }, [mix]);
  useEffect(() => { engineRef.current?.setCharacter(character); }, [character]);
  useEffect(() => { engineRef.current?.setInputGain(inputGain); }, [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGainVal); }, [outputGainVal]);
  useEffect(() => { engineRef.current?.setPan(pan); }, [pan]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); }, [bypassed]);
  useEffect(() => { engineRef.current?.setEQ(eqBands); }, [eqBands]);
  useEffect(() => { engineRef.current?.setEQBypass(eqBypassed); }, [eqBypassed]);

  // Meter animation
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current?.getIsPlaying()) {
        setMeterData(engineRef.current.getAnalyserData());
        setInputLevel(engineRef.current.getInputLevel());
        setOutputLevel(engineRef.current.getOutputLevel());
        setInputPeak(engineRef.current.getInputPeak());
        setOutputPeak(engineRef.current.getOutputPeak());
        setReactive(engineRef.current.getReactiveData());
      }
      wobbleTimeRef.current += 0.016;
      setWobbleTime(wobbleTimeRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file || !engineRef.current) return;
    setFileName(file.name);
    // Try to extract BPM from filename (e.g. "MO_TENNY_110_drums.wav" → 110)
    const bpmMatch = file.name.match(/[_\-\s](\d{2,3})[_\-\s.]/);
    if (bpmMatch) {
      const detected = parseInt(bpmMatch[1]);
      if (detected >= 60 && detected <= 200) {
        setBpm(detected);
        engineRef.current.setBPM(detected);
      }
    }
    await engineRef.current.loadFile(file);
    setAudioSource('file');
    setIsPlaying(true);
  }, []);

  const handleMic = useCallback(async () => {
    if (!engineRef.current) return;
    await engineRef.current.useMic();
    setAudioSource('mic');
    setFileName('');
    setIsPlaying(true);
  }, []);

  const handleStop = useCallback(() => {
    engineRef.current?.stop();
    setAudioSource('none');
    setIsPlaying(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) handleFile(file);
  }, [handleFile]);

  const handleBpmChange = useCallback((v) => {
    setBpm(v);
    engineRef.current?.setBPM(v);
  }, []);

  // Report audio controls state to parent (for master bar rendering)
  useEffect(() => {
    onAudioControls?.({ isPlaying, fileName, audioSource, bpm, handleFile, handleStop, handleDrop, handleBpmChange, fileInputRef });
  }, [isPlaying, fileName, audioSource, bpm]);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const dbToLinear = v => Math.pow(10, v / 20);

  const MeterBar = ({ level, peak, label }) => (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>{label}</span>
      <div style={{ width: 5, height: 28, background: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${clamp(level * 400, 0, 100)}%`, background: accentColor(65, 58, 0.85), borderRadius: 3, transition: 'height 0.04s' }} />
        <div style={{ position: 'absolute', bottom: `${clamp(peak * 400, 0, 100)}%`, width: '100%', height: 1, background: accentColor(60, 80, 0.9) }} />
      </div>
    </div>
  );


  const computeSpaceMode = (angle) => {
    const deg = ((angle * 180) / Math.PI + 360) % 360;
    if (deg >= 225 && deg < 315) return 'Bloom';  // top (270° center)
    if (deg >= 315 || deg < 45) return 'Delay';   // right (0° center)
    if (deg >= 45 && deg < 135) return 'Room';     // bottom (90° center)
    return 'Smear';                                 // left (180° center)
  };

  const updateFromPointer = (clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    let x = clientX - rect.left;
    let y = clientY - rect.top;

    const dx = x - center;
    const dy = y - center;
    const r = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    const now = performance.now();
    const last = lastRef.current;
    const dist = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2);
    const dt = Math.max(16, now - last.t);
    const velocity = clamp(dist / dt / 1.2, 0, 1);
    lastRef.current = { x, y, t: now };

    // Distance from center normalized 0-1 (0 = dead center, 1 = outer edge)
    const distNorm = clamp(r / outerRadius, 0, 1);

    // Always update angle and tone so nothing gets stuck
    setOrbAngle(angle);
    // Tone from horizontal position — works everywhere on the pad
    setTone(clamp((dx / outerRadius + 1) / 2, 0, 1));

    if (r <= innerRadius) {
      setPoint({ x, y });
      // Moving back to center — fade space out
      setSpace(s => Math.max(0, s * 0.8 - 0.02));
      // In clean zone: modulation nearly zero; beyond: ramps with distance + velocity
      const beyondClean = Math.max(0, distNorm - 0.15) / 0.85;
      setModulation(clamp(beyondClean * 0.5 + velocity * 0.3, 0, 1));
    } else {
      const clampedR = clamp(r, innerRadius, outerRadius);
      const rr = clampedR / outerRadius;
      const nx = center + Math.cos(angle) * clampedR;
      const ny = center + Math.sin(angle) * clampedR;
      setPoint({ x: nx, y: ny });
      setSpace(clamp((rr - innerRadius / outerRadius) / (1 - innerRadius / outerRadius), 0, 1));
      setSpaceMode(computeSpaceMode(angle));
      // Outer zone: higher base modulation from distance + velocity
      setModulation(clamp(distNorm * 0.7 + velocity * 0.3, 0, 1));
    }
  };

  // Track orb distance from center for modulation baseline
  const distFromCenter = useMemo(() => {
    const dx = point.x - center;
    const dy = point.y - center;
    return Math.min(1, Math.sqrt(dx * dx + dy * dy) / outerRadius);
  }, [point.x, point.y, center, outerRadius]);

  const distRef = useRef(distFromCenter);
  distRef.current = distFromCenter;

  // Clean zone: center radius where everything stays calm
  const CLEAN_ZONE = 0.15; // 15% of outerRadius

  // Modulation stays alive — distance sets floor, audio adds on top
  // Clean zone suppresses modulation floor to keep orb still at center
  const reactiveRef = useRef(reactive);
  reactiveRef.current = reactive;
  useEffect(() => {
    const id = setInterval(() => {
      const r = reactiveRef.current;
      const d = distRef.current;
      // Outside clean zone: ramp up modulation floor
      const beyondClean = Math.max(0, (d - CLEAN_ZONE) / (1 - CLEAN_ZONE));
      const positionFloor = beyondClean * 0.45;
      // Audio reactivity scales with distance — very subtle at center, full at edges
      const audioScale = beyondClean * 0.85 + 0.05;
      const audioFeed = (r.mid * 0.2 + r.transient * 0.12 + r.energy * 0.08) * audioScale;
      setModulation((m) => {
        const decayed = m * 0.88; // faster decay
        return Math.max(positionFloor, Math.min(1, decayed + audioFeed));
      });
    }, 30);
    return () => clearInterval(id);
  }, []);

  // COLOR SYSTEM: Tone → Blue(220) → Green(145) → Yellow(50) → Red(0)
  const hue = useMemo(() => {
    if (tone <= 0.5) {
      // Blue(220) → Green(145)
      return 220 - (tone / 0.5) * 75;
    } else if (tone <= 0.75) {
      // Green(145) → Yellow(50)
      return 145 - ((tone - 0.5) / 0.25) * 95;
    } else {
      // Yellow(50) → Red(0)
      return 50 - ((tone - 0.75) / 0.25) * 50;
    }
  }, [tone]);
  // Audio-reactive visual drivers
  const { low: rLow, mid: rMid, high: rHigh, energy: rEnergy, transient: rTransient } = reactive;

  // Raw target weights from angle + space
  const targetWeights = useMemo(() => {
    const deg = ((orbAngle * 180) / Math.PI + 360) % 360;
    const angleDist = (a, b) => {
      const d = Math.abs(a - b);
      return Math.min(d, 360 - d);
    };
    const falloff = (dist) => Math.max(0, Math.cos((Math.min(dist, 90) / 90) * Math.PI / 2));
    return {
      bloom: Math.pow(falloff(angleDist(deg, 270)) * space, 2.1),  // top — power curve slows early buildup
      delay: falloff(angleDist(deg, 0)) * space,    // right
      room: falloff(angleDist(deg, 90)) * space,    // bottom (screen y-down = 90°)
      smear: falloff(angleDist(deg, 180)) * space,  // left
    };
  }, [orbAngle, space]);

  // Smoothly interpolate mode weights so they never snap
  const [modeWeights, setModeWeights] = useState({ bloom: 0, delay: 0, room: 0, smear: 0 });
  const targetWeightsRef = useRef(targetWeights);
  targetWeightsRef.current = targetWeights;
  useEffect(() => {
    const id = setInterval(() => {
      const t = targetWeightsRef.current;
      setModeWeights(prev => {
        const lerp = (a, b, riseRate = 0.12, fallRate = 0.18) => {
          const rate = b < a ? fallRate : riseRate;
          const v = a + (b - a) * rate;
          return v < 0.005 ? 0 : v;
        };
        return {
          bloom: lerp(prev.bloom, t.bloom, 0.08, 0.12), // bloom fades slowest — lush
          delay: lerp(prev.delay, t.delay, 0.12, 0.18),
          room: lerp(prev.room, t.room, 0.12, 0.18),
          smear: lerp(prev.smear, t.smear, 0.10, 0.15),
        };
      });
    }, 16);
    return () => clearInterval(id);
  }, []);
  // Sync blended space weights to audio engine
  useEffect(() => { engineRef.current?.setSpaceWeights(modeWeights); }, [modeWeights]);
  useEffect(() => {
    onStateChange?.(instanceId, {
      tone, character, tape, glue, limit, mix, inputGain, outputGain: outputGainVal,
      pan, bypassed, spaceMode, orbX: point.x, orbY: point.y,
      eqBands: [...eqBands], eqPreset, eqBypassed,
    });
  }, [tone, character, tape, glue, limit, mix, inputGain, outputGainVal, pan, bypassed, spaceMode, point.x, point.y, eqBands, eqPreset, eqBypassed]);
  // "Wildness" — 0 in clean zone, ramps 0→1 from clean edge to outer edge
  const wild = Math.max(0, (distFromCenter - CLEAN_ZONE) / (1 - CLEAN_ZONE));
  const wild2 = wild * wild; // exponential ramp for dramatic outer edge
  const inCleanZone = distFromCenter < CLEAN_ZONE;

  // === DRIVE / DISTORTION VISUAL SYSTEM ===
  // Drive = tape + glue + limit combined (character is tonal, not drive)
  // Only visible when really pushing — needs knobs past ~50% to start showing
  const driveAmount = Math.min(1, tape * 0.8 + glue * 0.7 + limit * 0.5);
  const drivePressure = driveAmount * driveAmount * driveAmount; // cubic — stays near zero until cranked
  // Fracture lines only appear when drive is pushed hard (past 50%)
  const fracture = Math.max(0, driveAmount - 0.5) / 0.5; // 0 until 50% drive, then ramps to 1

  // === CORE SCALE — driven by modulation + audio, NOT by wild/space ===
  const coreScale = 1 + modulation * 0.08 + rLow * 0.08 + rTransient * 0.06 + drivePressure * 0.04;
  const halo = 20 + space * 180 + modeWeights.bloom * 120 + rLow * (10 + space * 60);

  // Label reflects clean zone vs character states
  const label = useMemo(() => {
    if (inCleanZone) {
      if (tone < 0.45) return 'Analog Clean';
      if (tone > 0.55) return 'Modern Clean';
      return 'Clean';
    }
    if (tone > 0.62 && space < 0.28) return 'Break Vibe';
    if (tone > 0.68 && space < 0.18) return 'Funk Punch';
    if (tone < 0.42 && space > 0.4) return 'Dream Wash';
    if (spaceMode === 'Delay' && space > 0.35) return 'Echo Glow';
    if (spaceMode === 'Smear' && space > 0.3) return 'Soft Haze';
    return 'Modern Clean';
  }, [tone, space, spaceMode]);

  // === ORB SHAPE ===
  // Motion = Modulation (the spec says motion belongs to modulation only)
  // Drive adds jagged fracture on top
  const orbRadius = 24;
  const modWobble = modulation * 8 + (rMid * 2 + rLow * 1.5) * (0.2 + modulation * 0.8);
  const driveJagged = fracture * fracture * 6; // quadratic — only jagged when really pushed
  const totalWobble = Math.min(16, modWobble + driveJagged);
  const orbPath = useMemo(() => {
    const t = wobbleTime;
    const points = 64;
    let d = '';
    // Drifting phase offsets for organic motion
    const p1 = Math.sin(t * 0.13) * 4.5 + Math.cos(t * 0.07) * 3.2;
    const p2 = Math.cos(t * 0.11) * 5.1 + Math.sin(t * 0.19) * 2.8;
    const p3 = Math.sin(t * 0.17) * 3.8 + Math.cos(t * 0.23) * 4.1;
    const p4 = Math.cos(t * 0.09) * 4.7 + Math.sin(t * 0.29) * 3.5;
    // Cycling shape weights
    const w2 = 0.3 + 0.3 * Math.sin(t * 0.31 + 1.0);
    const w3 = 0.3 + 0.3 * Math.sin(t * 0.37 + 2.5);
    const w4 = 0.2 + 0.25 * Math.sin(t * 0.43 + 4.0);
    const w5 = 0.15 + 0.2 * Math.sin(t * 0.29 + 5.5);
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      // Smooth modulation shape morphing
      const smooth = (
        Math.sin(angle * 2 + p1) * w2 +
        Math.sin(angle * 3 + p2) * w3 +
        Math.sin(angle * 4 + p3) * w4 +
        Math.sin(angle * 5 + p4) * w5
      );
      // Drive fracture: high-frequency jagged edges (tension/pressure)
      const fractureEdge = fracture * (
        Math.sin(angle * 8 + p1 * 1.5) * 0.3 +
        Math.sin(angle * 11 - p2 * 1.3) * 0.25 +
        Math.sin(angle * 15 + p3 * 0.9) * 0.2
      );
      const wobbleOffset = totalWobble * (smooth + fractureEdge);
      const r = orbRadius + wobbleOffset;
      const x = 38 + Math.cos(angle) * r;
      const y = 38 + Math.sin(angle) * r;
      d += (i === 0 ? 'M' : 'L') + `${x},${y}`;
    }
    return d + 'Z';
  }, [totalWobble, wobbleTime, fracture]);

  // === BACKGROUND — COLOR = TONE ONLY ===
  // Tone density: how saturated/bright the background is (driven by tone character, not position)
  const toneDensity = rEnergy * 0.3 + rLow * 0.15; // audio makes tone more visible
  const bgColor1 = `hsla(${hue}, ${25 + toneDensity * 25}%, ${7 + toneDensity * 4}%, 1)`;
  const bgColor2 = `hsla(${hue}, ${18 + toneDensity * 20}%, ${5 + toneDensity * 3}%, 1)`;
  // Color helpers — hue is always from tone
  const accentColor = (sat, light, alpha) => `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
  const activeZoneColor = `hsla(${hue}, 70%, 70%, 0.8)`;

  // EQ presets — bands: 32, 64, 125, 250, 500, 1K, 2K, 4K, 8K, 16K
  const eqPresets = {
    'Custom':         null, // placeholder — user-modified bands
    'Flat':           [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Bass Boost':     [8, 6, 4, 1, 0, 0, 0, 0, 0, 0],
    'Treble Boost':   [0, 0, 0, 0, 0, 0, 2, 5, 7, 8],
    'Vocal Presence': [0, 0, -1, -2, 0, 3, 5, 4, 2, 0],
    'Scoop':          [4, 3, 0, -4, -5, -4, 0, 3, 5, 4],
    'Loudness':       [6, 4, 0, -2, -1, 0, -1, 0, 4, 6],
    'De-Mud':         [0, 0, -2, -5, -3, 0, 1, 2, 1, 0],
    'Bright & Airy':  [-2, -1, 0, 0, 0, 1, 3, 5, 7, 8],
    'Dark & Warm':    [4, 5, 3, 1, 0, -1, -2, -4, -5, -6],
    'Sub Bass':       [10, 7, 3, 0, -1, -1, 0, 0, 0, 0],
  };

  const applyPreset = (name) => {
    setEqPreset(name);
    if (eqPresets[name]) {
      setEqBands([...eqPresets[name]]);
      // Auto-enable EQ when selecting a non-flat preset
      if (name !== 'Flat' && name !== 'Custom') setEqBypassed(false);
    }
  };

  return (
    <div className="text-white rounded-2xl overflow-hidden relative flex flex-col" style={{
      background: `radial-gradient(ellipse at 30% 20%, ${bgColor1}, transparent 55%), radial-gradient(ellipse at 70% 80%, ${bgColor2}, transparent 55%), #0a0f0c`,
      border: '1px solid rgba(255,255,255,0.06)',
      width: size,
    }}>
      {/* Save Preset Modal */}
      {showSaveModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="rounded-2xl border border-white/10 p-5 w-64" style={{ background: 'rgba(10,15,12,0.95)' }}>
            <div className="text-[11px] uppercase tracking-[0.3em] text-white/50 mb-3">Save Preset</div>
            <input
              autoFocus
              type="text"
              placeholder="Preset name..."
              value={saveNameInput}
              onChange={e => setSaveNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmSavePreset(); if (e.key === 'Escape') setShowSaveModal(false); }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 outline-none focus:border-white/25 placeholder-white/20 mb-3"
            />
            <div className="flex gap-2">
              <button onClick={confirmSavePreset} disabled={!saveNameInput.trim()}
                className="flex-1 rounded-lg py-1.5 text-[11px] font-medium border transition-colors bg-white/10 border-white/15 text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed">
                Save
              </button>
              <button onClick={() => setShowSaveModal(false)}
                className="flex-1 rounded-lg py-1.5 text-[11px] font-medium border transition-colors bg-white/5 border-white/8 text-white/40 hover:text-white/60">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="w-full">
        {/* Hidden file input — triggered from master bar */}
        <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
          onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
        {/* Header */}
        <div className="grid items-center px-3 py-2"
          style={{ gridTemplateColumns: '1fr auto 1fr', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Left */}
          <span className="text-[8px] uppercase tracking-[0.35em]" style={{ color: accentColor(50, 60, 0.5) }}>Space</span>

          {/* Center — BPM input */}
          <div className="flex items-center gap-1">
            <span className="text-[8px]" style={{ color: accentColor(45, 50, 0.4) }}>BPM</span>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              value={bpm || ''}
              placeholder="—"
              onChange={e => { const v = parseInt(e.target.value) || 0; setBpm(v); engineRef.current?.setBPM(v); }}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-center outline-none"
              style={{
                width: 38,
                background: bpm ? accentColor(30, 12, 0.4) : 'rgba(255,255,255,0.04)',
                border: `1px solid ${bpm ? accentColor(50, 40, 0.35) : 'rgba(255,255,255,0.08)'}`,
                color: bpm ? accentColor(60, 78, 1) : 'rgba(255,255,255,0.25)',
              }}
            />
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 justify-end">
            <span className="text-[8px] uppercase tracking-[0.25em]" style={{ color: accentColor(50, 55, 0.4) }}>
              {spaceMode} · {Math.round(space * 100)}%
            </span>
            {onRemove && (
              <button onClick={onRemove} className="w-5 h-5 rounded-full text-white/20 hover:text-white/60 hover:bg-white/10 transition-all text-xs flex items-center justify-center">&times;</button>
            )}
          </div>
        </div>

          <div
            ref={wrapRef}
            className="relative select-none mx-auto"
            style={{ width: size, height: size, contain: 'strict', background: `radial-gradient(circle at 50% 45%, ${accentColor(30, 12, 0.2 + toneDensity * 0.3)}, ${accentColor(20, 5, 0.8)} 45%, #050a06 70%)` }}
            onMouseDown={(e) => {
              setDragging(true);
              updateFromPointer(e.clientX, e.clientY);
            }}
            onMouseMove={(e) => dragging && updateFromPointer(e.clientX, e.clientY)}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
          >
            {/* ============ LAYER 1: SPACE AURA (outermost) ============ */}
            {/* Space = where the sound lives. Bloom/Room/Delay/Smear each have distinct auras */}

            {/* Bloom aura: lush expanding fog — pink (320°) */}
            <div className="absolute rounded-full" style={{
              left: center - (200 + modeWeights.bloom * 100 + rLow * 50),
              top: center - (200 + modeWeights.bloom * 100 + rLow * 50),
              width: (400 + modeWeights.bloom * 200 + rLow * 100),
              height: (400 + modeWeights.bloom * 200 + rLow * 100),
              background: `radial-gradient(circle, hsla(320, 70%, 65%, ${modeWeights.bloom * 0.35 + rLow * modeWeights.bloom * 0.2}), hsla(310, 60%, 50%, ${modeWeights.bloom * 0.15}) 45%, transparent 70%)`,
              filter: `blur(${20 + modeWeights.bloom * 45}px)`,
              opacity: modeWeights.bloom > 0.01 ? 1 : 0,
            }} />

            {/* Room aura: tight, close halo — purple (275°) */}
            <div className="absolute rounded-full" style={{
              left: center - (130 + modeWeights.room * 40 + rMid * 15),
              top: center - (130 + modeWeights.room * 40 + rMid * 15),
              width: (260 + modeWeights.room * 80 + rMid * 30),
              height: (260 + modeWeights.room * 80 + rMid * 30),
              border: `${1.5 + modeWeights.room * 2}px solid hsla(275, 55%, 60%, ${modeWeights.room * 0.25})`,
              background: `radial-gradient(circle, hsla(275, 45%, 40%, ${modeWeights.room * 0.15}), transparent 55%)`,
              filter: `blur(${6 + modeWeights.room * 10}px)`,
              opacity: modeWeights.room > 0.01 ? 1 : 0,
            }} />

            {/* Delay ghosts: actual orb copies trailing behind */}
            {modeWeights.delay > 0.01 && [1, 2, 3, 4].map(g => {
              const ghostAlpha = modeWeights.delay * (0.4 - g * 0.08);
              if (ghostAlpha < 0.01) return null;
              const ghostOffset = g * (35 + modeWeights.delay * 25);
              const ghostAngle = orbAngle + Math.PI; // trail behind
              const ghostSize = 76 * (1 - g * 0.1); // each ghost slightly smaller
              const gx = point.x + Math.cos(ghostAngle) * ghostOffset;
              const gy = point.y + Math.sin(ghostAngle) * ghostOffset;
              return (
                <svg key={`ghost-${g}`} className="absolute" viewBox="0 0 76 76" style={{
                  left: gx - ghostSize / 2, top: gy - ghostSize / 2,
                  width: ghostSize, height: ghostSize,
                  opacity: ghostAlpha,
                  filter: `blur(${g * 2}px) drop-shadow(0 0 ${10 + modeWeights.delay * 14}px ${accentColor(50, 55, 0.3)})`,
                }}>
                  <path d={orbPath} fill={accentColor(35, 50, 0.3)} stroke={accentColor(50, 70, 0.6 + modeWeights.delay * 0.3)} strokeWidth={2 + modeWeights.delay * 1} />
                </svg>
              );
            })}

            {/* Smear atmosphere: thick blurred diffusion cloud */}
            <div className="absolute inset-0" style={{
              background: `radial-gradient(ellipse at ${(point.x/size)*100}% ${(point.y/size)*100}%, ${accentColor(25, 40, modeWeights.smear * 0.2)}, ${accentColor(20, 30, modeWeights.smear * 0.06)} 40%, transparent ${50 + modeWeights.smear * 20}%)`,
              filter: `blur(${modeWeights.smear * 60}px)`,
              opacity: modeWeights.smear > 0.01 ? 1 : 0,
            }} />

            {/* Outer boundary ring — SPACE driven, breathes with audio */}
            <div className="absolute rounded-full" style={{
              width: (outerRadius + space * 15 + rLow * space * 12) * 2,
              height: (outerRadius + space * 15 + rLow * space * 12) * 2,
              left: center - outerRadius - space * 15 - rLow * space * 12,
              top: center - outerRadius - space * 15 - rLow * space * 12,
              border: `${1 + space * 2 + rEnergy * space}px solid ${accentColor(30, 55, 0.06 + space * 0.18 + rEnergy * space * 0.1)}`,
              boxShadow: `0 0 ${space * 35 + rLow * space * 25}px ${accentColor(45, 50, space * 0.12 + rLow * space * 0.1)}, inset 0 0 ${space * 20}px ${accentColor(30, 40, space * 0.04)}`,
            }} />

            {/* ============ LAYER 2: MODULATION RINGS (inner) ============ */}
            {/* Motion = Modulation. Rings pulse, oscillate, breathe with mod amount */}
            <svg className="absolute" style={{
              left: 0, top: 0, width: size, height: size,
              pointerEvents: 'none',
              willChange: 'contents',
              transform: 'translateZ(0)',
            }}>
              {[...Array(40)].map((_, i) => {
                const baseR = 6 + i * 4.2;
                // Rings reveal progressively as orb moves out — epic buildup
                const revealThreshold = i / 40; // 0..1 — outer rings need more wild to appear
                const ringReveal = Math.max(0, (wild - revealThreshold * 0.5) / (1 - revealThreshold * 0.5));
                const modAlpha = 0.04 + modulation * 0.15 + ringReveal * 0.3 - i * 0.004;
                if (modAlpha < 0.01) return null;

                const t = wobbleTime;
                // Distance drives everything harder — exponential intensity at edges
                const distortDriver = modulation + wild * 0.8;
                const wild3 = wild * wild * wild; // cubic ramp for epic outer intensity
                const breathe = Math.sin(t * (1.2 + i * 0.15) + i * 0.5) * distortDriver * (4 + i * 0.6 + wild3 * 8);
                const ringR = baseR + breathe + rMid * distortDriver * (2 + i * 0.3) + rLow * distortDriver * 2 + rTransient * wild * 3;

                // Perfect circles only when orb is centered and calm
                if (distortDriver < 0.1) {
                  return (
                    <circle key={`mod-ring-${i}`}
                      cx={center} cy={center} r={ringR}
                      fill="none"
                      stroke={`hsla(${hue}, ${15 + distortDriver * 35}%, ${55 - i * 1.2}%, ${modAlpha})`}
                      strokeWidth={0.6 + modulation * 0.3}
                    />
                  );
                }

                // Smooth distorted rings — low-frequency waves, organic not jagged
                const pts = 64;
                let d = '';
                for (let p = 0; p <= pts; p++) {
                  const a = (p / pts) * Math.PI * 2;
                  const modDistort = distortDriver * (2 + i * 0.4 + wild3 * 6) * (
                    Math.sin(a * 2 + t * (0.7 + i * 0.1)) * 0.45 +
                    Math.sin(a * 3 + t * (1.0 + i * 0.08)) * 0.35 +
                    Math.sin(a * 4 - t * (0.5 + i * 0.06)) * 0.2 +
                    wild * Math.sin(a * 5 + t * (0.9 - i * 0.05)) * 0.2 +
                    wild3 * Math.sin(a * 6 - t * (0.6 + i * 0.04)) * 0.15
                  );
                  const r = ringR + modDistort;
                  const px = center + Math.cos(a) * r;
                  const py = center + Math.sin(a) * r;
                  d += (p === 0 ? 'M' : 'L') + `${px},${py}`;
                }
                d += 'Z';

                return (
                  <path key={`mod-ring-${i}`} d={d} fill="none"
                    stroke={`hsla(${hue}, ${15 + distortDriver * 45}%, ${55 - i * 1.2}%, ${modAlpha})`}
                    strokeWidth={0.5 + modulation * 0.3}
                  />
                );
              })}
            </svg>

            {/* ============ LAYER 3: DRIVE FRACTURE LINES ============ */}
            {/* Fracture/Tension = Drive. Cracks appear when tape/glue/limit are pushed */}
            {fracture > 0.05 && (
              <svg className="absolute" style={{
                left: point.x - 46, top: point.y - 46, width: 92, height: 92,
                pointerEvents: 'none',
              }}>
                {[...Array(Math.floor(fracture * 8))].map((_, i) => {
                  const t = wobbleTime;
                  const baseAngle = (i / Math.max(1, Math.floor(fracture * 8))) * Math.PI * 2 + t * 0.3;
                  const innerR = orbRadius * 0.6 + Math.sin(t * 0.7 + i * 2.1) * 3;
                  const outerR = orbRadius + 6 + fracture * 10 + Math.sin(t * 1.1 + i * 1.7) * 4;
                  const jitter = Math.sin(t * 2.3 + i * 3.7) * fracture * 3;
                  const x1 = 46 + Math.cos(baseAngle) * innerR;
                  const y1 = 46 + Math.sin(baseAngle) * innerR;
                  const x2 = 46 + Math.cos(baseAngle + jitter * 0.05) * outerR;
                  const y2 = 46 + Math.sin(baseAngle + jitter * 0.05) * outerR;
                  // Mid-point with crack offset
                  const mx = (x1 + x2) / 2 + jitter;
                  const my = (y1 + y2) / 2 + Math.cos(t * 1.9 + i * 2.3) * fracture * 3;
                  return (
                    <path key={`crack-${i}`}
                      d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
                      fill="none"
                      stroke={`hsla(${hue}, ${40 + fracture * 30}%, ${70 + fracture * 15}%, ${0.15 + fracture * 0.35 + rTransient * 0.2})`}
                      strokeWidth={0.5 + fracture * 1.5}
                    />
                  );
                })}
              </svg>
            )}

            {/* ============ LAYER 4: THE ORB CORE ============ */}
            {/* Core = Tone (color/density) + Drive (pressure/tightness) */}

            {/* Orb glow — tone color, space makes it softer/wider */}
            <div className="absolute rounded-full" style={{
              left: point.x - (45 + space * 25 + modulation * 15) - rLow * 10,
              top: point.y - (45 + space * 25 + modulation * 15) - rLow * 10,
              width: (90 + space * 50 + modulation * 30) + rLow * 20,
              height: (90 + space * 50 + modulation * 30) + rLow * 20,
              background: `radial-gradient(circle, ${accentColor(55 + drivePressure * 20, 50, 0.08 + toneDensity * 0.2 + drivePressure * 0.12 + modulation * 0.1)}, ${accentColor(40, 40, 0.03 + space * 0.06)} 50%, transparent 70%)`,
              filter: `blur(${14 + space * 20 + modulation * 8}px)`,
              willChange: 'transform, filter',
              transform: 'translateZ(0)',
            }} />

            {/* THE ORB — Color=Tone, Motion=Modulation, Fracture=Drive */}
            <svg className="absolute" style={{
              left: point.x - 38, top: point.y - 38, width: 76, height: 76,
              transform: `scale(${coreScale}) translateZ(0)`,
              filter: `drop-shadow(0 0 ${8 + modulation * 16 + drivePressure * 12 + rEnergy * 6}px ${accentColor(55 + drivePressure * 15, 55, 0.2 + modulation * 0.25 + drivePressure * 0.2)})`,
              willChange: 'transform, filter',
            }}>
              <defs>
                <radialGradient id="orbFill" cx="42%" cy="40%">
                  {/* Core: brighter with more tone density, tighter with drive */}
                  <stop offset="0%" stopColor={`hsla(${hue}, ${25 + toneDensity * 45 + drivePressure * 15}%, ${90 - drivePressure * 15}%, 1)`} />
                  <stop offset="50%" stopColor={`hsla(${hue}, ${30 + toneDensity * 35 + drivePressure * 10}%, ${75 - drivePressure * 20}%, ${0.85 + drivePressure * 0.15})`} />
                  <stop offset="100%" stopColor={`hsla(${hue}, ${20 + toneDensity * 25}%, ${45 - drivePressure * 15}%, ${0.4 + drivePressure * 0.35})`} />
                </radialGradient>
              </defs>
              <path d={orbPath}
                fill="url(#orbFill)"
                stroke={`hsla(${hue}, ${30 + drivePressure * 30}%, ${70 + drivePressure * 10}%, ${0.4 + drivePressure * 0.4 + modulation * 0.15})`}
                strokeWidth={1 + drivePressure * 1}
              />
            </svg>

            {/* Center dot — flashes on transients */}
            <div className="absolute rounded-full bg-white" style={{
              left: point.x - 2 - rTransient * 2, top: point.y - 2 - rTransient * 2,
              width: 4 + rTransient * 4, height: 4 + rTransient * 4,
              opacity: 0.4 + rTransient * 0.4 + drivePressure * 0.2,
              boxShadow: `0 0 ${4 + rTransient * 12}px ${accentColor(50, 80, 0.3 + rTransient * 0.4)}`
            }} />

            {/* Zone labels — only the dominant mode highlights */}
            {(() => {
              const max = Math.max(modeWeights.bloom, modeWeights.delay, modeWeights.room, modeWeights.smear);
              const labelColor = (w) => max > 0.05 && w === max ? `hsla(${hue}, 70%, 70%, ${Math.min(0.8, w * 1.5)})` : 'rgba(255,255,255,0.15)';
              return (<>
                <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[8px] tracking-[0.2em] uppercase transition-all duration-300" style={{ color: labelColor(modeWeights.bloom) }}>Bloom</div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] tracking-[0.2em] uppercase rotate-90 transition-all duration-300" style={{ color: labelColor(modeWeights.delay) }}>Delay</div>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] tracking-[0.2em] uppercase transition-all duration-300" style={{ color: labelColor(modeWeights.room) }}>Room</div>
                <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] tracking-[0.2em] uppercase -rotate-90 transition-all duration-300" style={{ color: labelColor(modeWeights.smear) }}>Smear</div>
              </>);
            })()}
          </div>

        {/* Clip-visibility meter — big dB numbers so clipping is unmissable */}
        <ClipMeter
          inRms={dbToLinear(inputLevel)}   inPeak={dbToLinear(inputPeak)}
          outRms={dbToLinear(outputLevel)} outPeak={dbToLinear(outputPeak)}
        />

        {/* Bottom bar — mix + settings toggle */}
        <div className="flex items-center gap-2.5 px-3 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-[9px] shrink-0" style={{ color: accentColor(45, 55, 0.5) }}>Mix</span>
            <input type="range" min="0" max="1" step="0.01" value={mix}
              onChange={e => setMix(parseFloat(e.target.value))}
              style={{ accentColor: accentColor(70, 60, 1), height: '3px', flex: 1 }} />
            <span className="text-[9px]" style={{ color: accentColor(50, 62, 0.65), width: 28, textAlign: 'right' }}>{Math.round(mix * 100)}%</span>
          </div>
          <button onClick={() => setShowPanel(p => !p)}
            className="rounded px-2 py-1 text-[9px] border transition-colors"
            style={showPanel
              ? { background: accentColor(50, 50, 0.2), borderColor: accentColor(50, 55, 0.4), color: accentColor(60, 70, 1) }
              : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}>⚙</button>
        </div>

        {/* Collapsible detail panel */}
        {showPanel && (
          <div className="px-3 py-2.5">
          <div className="rounded-xl backdrop-blur-xl p-3 flex flex-col gap-2" style={{
            background: `linear-gradient(160deg, ${accentColor(20, 8, 0.6)}, ${accentColor(15, 5, 0.8)})`,
            border: `1px solid ${accentColor(40, 40, 0.2)}`,
          }}>

            {/* Presets — top of panel */}
            <div className="flex items-center gap-2 mb-3">
              <select
                value={selectedPreset}
                onChange={(e) => loadPreset(e.target.value)}
                className="flex-1 text-[10px] rounded px-2 py-1 text-white/70 outline-none cursor-pointer"
                style={{ WebkitAppearance: 'none', MozAppearance: 'none', background: accentColor(20, 8, 0.6), border: `1px solid ${accentColor(40, 30, 0.25)}` }}
              >
                <option value="" style={{ background: '#0f1a10' }}>— Load preset —</option>
                <option value="Default" style={{ background: '#0f1a10' }}>Default</option>
                {Object.keys(userPresets).sort().map(name => (
                  <option key={name} value={name} style={{ background: '#0f1a10' }}>{name}</option>
                ))}
              </select>
              <button onClick={saveCurrentPreset}
                className="text-[9px] font-medium px-2 py-1 rounded transition-colors whitespace-nowrap"
                style={{ background: accentColor(30, 12, 0.5), border: `1px solid ${accentColor(50, 40, 0.3)}`, color: accentColor(60, 75, 0.9) }}>
                Save
              </button>
              <button onClick={() => deletePreset(selectedPreset)} disabled={!selectedPreset || selectedPreset === 'Default'}
                className="text-[9px] font-medium px-2 py-1 rounded transition-colors whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: accentColor(30, 12, 0.5), border: `1px solid ${accentColor(50, 40, 0.3)}`, color: accentColor(60, 75, 0.9) }}>
                Delete
              </button>
            </div>

            {/* Sliders */}
            <div className="flex flex-col gap-1.5">
              <SliderRow label="Input"  value={inputGain}    set={setInputGain}    min={0} max={2} fmt={v => `${Math.round(v*100)}%`} ac={accentColor} />
              <SliderRow label="Output" value={outputGainVal} set={setOutputGainVal} min={0} max={2} fmt={v => `${Math.round(v*100)}%`} ac={accentColor} />
              <div className="flex items-center gap-2">
                <span className="text-[9px] shrink-0" style={{ color: accentColor(45, 55, 0.55), width: 48 }}>Pan</span>
                <input type="range" min="-100" max="100" step="1"
                  value={Math.round(pan * 100)}
                  onChange={e => setPan(parseInt(e.target.value) / 100)}
                  onDoubleClick={() => setPan(0)}
                  style={{ accentColor: accentColor(70, 60, 1), height: '3px', flex: 1 }} />
                <span className="text-[9px] text-right" style={{ color: accentColor(50, 60, 0.65), width: 28 }}>
                  {Math.abs(pan) < 0.01 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan)*100)}` : `R${Math.round(pan*100)}`}
                </span>
              </div>
              <div className="h-px" style={{ background: accentColor(40, 30, 0.15) }} />
              <SliderRow label="Character" value={character} set={setCharacter} ac={accentColor} />
              <SliderRow label="Tape"      value={tape}      set={setTape}      ac={accentColor} />
              <SliderRow label="Glue"      value={glue}      set={setGlue}      ac={accentColor} />
              <SliderRow label="Limiter"   value={limit}     set={setLimit}     ac={accentColor} />
            </div>

            {/* EQ — condensed */}
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${accentColor(40, 30, 0.15)}` }}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] uppercase tracking-[0.25em]" style={{ color: accentColor(45, 50, 0.4) }}>EQ</span>
                  <button onClick={() => setEqBypassed(b => !b)}
                    className="text-[8px] font-medium px-1.5 py-0.5 rounded border transition-colors"
                    style={eqBypassed
                      ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
                      : { background: accentColor(30, 10, 0.4), border: `1px solid ${accentColor(40, 30, 0.25)}`, color: accentColor(50, 60, 0.7) }}>
                    {eqBypassed ? 'Off' : 'On'}
                  </button>
                </div>
                <select value={eqPreset} onChange={e => applyPreset(e.target.value)}
                  className="flex-1 text-[9px] rounded px-1.5 py-0.5 outline-none cursor-pointer"
                  style={{ WebkitAppearance: 'none', background: accentColor(20, 8, 0.6), border: `1px solid ${accentColor(40, 30, 0.25)}`, color: 'rgba(255,255,255,0.6)' }}>
                  {Object.keys(eqPresets).map(name => (
                    <option key={name} value={name} style={{ background: '#0f1a10' }}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end justify-between gap-[3px] h-20 px-1">
                {['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'].map((lbl, i) => (
                  <div key={i} className="flex flex-col items-center flex-1 h-full">
                    <div className="flex-1 relative w-full flex items-center justify-center">
                      <div className="absolute h-full w-[3px] rounded-full" style={{ background: accentColor(40, 25, 0.2) }} />
                      <div className="absolute w-full h-[1px] top-1/2" style={{ background: accentColor(40, 25, 0.1) }} />
                      <input
                        type="range" min="-12" max="12" step="0.5"
                        value={eqBands[i]}
                        onChange={(e) => {
                          const newBands = [...eqBands];
                          newBands[i] = parseFloat(e.target.value);
                          setEqBands(newBands);
                          setEqPreset('Custom');
                          if (eqBypassed) setEqBypassed(false);
                        }}
                        className="eq-slider"
                        style={{
                          position: 'absolute', width: '100%', height: '100%',
                          WebkitAppearance: 'none', appearance: 'none',
                          background: 'transparent', writingMode: 'vertical-lr',
                          direction: 'rtl', cursor: 'pointer',
                        }}
                      />
                    </div>
                    <span className="text-[7px] mt-0.5 leading-none" style={{ color: accentColor(40, 50, 0.4) }}>{lbl}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bypass — inline at bottom */}
            <button onClick={() => setBypassed(b => !b)}
              className="w-full mt-2 rounded-lg py-1 text-[10px] font-medium transition-colors"
              style={bypassed
                ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
                : { background: accentColor(30, 10, 0.3), border: `1px solid ${accentColor(40, 30, 0.2)}`, color: accentColor(50, 60, 0.6) }}>
              {bypassed ? 'Bypassed' : 'Bypass'}
            </button>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hue }) {
  const pct = Math.round(value * 100);
  return (
    <div className="rounded-2xl border border-white/8 bg-black/30 p-3 backdrop-blur-sm">
      <div className="text-white/40 text-[10px] uppercase tracking-[0.3em]">{label}</div>
      <div className="mt-2 h-2.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-150" style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, hsla(${hue}, 60%, 55%, 0.8), hsla(${hue}, 80%, 65%, 0.9))`,
          boxShadow: `0 0 8px hsla(${hue}, 70%, 55%, ${value * 0.4})`
        }} />
      </div>
      <div className="mt-2 text-white/90 font-medium text-sm">{pct}%</div>
    </div>
  );
}

function VUMeter({ label, level, peak, active, hue = 120 }) {
  const pct = active ? Math.max(0, ((level + 60) / 60) * 100) : 0;
  const peakPct = active ? Math.max(0, ((peak + 60) / 60) * 100) : 0;
  const dbDisplay = active ? Math.round(level) : '-inf';
  const clipping = peak > -1;
  const segments = 24;

  return (
    <div className="rounded-lg px-2 py-1.5" style={{ border: `1px solid hsla(${hue}, 40%, 30%, 0.2)`, background: `hsla(${hue}, 20%, 5%, 0.5)` }}>
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.2em] w-5 shrink-0" style={{ color: `hsla(${hue}, 50%, 60%, 0.5)` }}>{label}</span>
        <div className="flex gap-[1px] h-3 flex-1 items-end">
          {Array.from({ length: segments }, (_, i) => {
            const segThreshold = (i / segments) * 100;
            const lit = pct > segThreshold;
            const peakSeg = Math.floor((peakPct / 100) * segments);
            const isPeak = i === peakSeg && active;
            const ratio = i / segments;
            let color, glow;
            if (ratio >= 0.85) {
              color = lit || isPeak ? 'bg-red-400' : 'bg-red-400/10';
              glow = lit ? '0 0 4px rgba(248,113,113,0.6)' : 'none';
            } else if (ratio >= 0.7) {
              color = lit || isPeak ? 'bg-amber-400' : 'bg-amber-400/10';
              glow = lit ? '0 0 3px rgba(251,191,36,0.4)' : 'none';
            } else {
              color = null; // use inline style for hue-based color
              glow = lit ? `0 0 3px hsla(${hue}, 70%, 55%, 0.4)` : 'none';
            }
            const inlineStyle = color === null ? {
              height: '100%',
              background: lit || isPeak ? `hsla(${hue}, 70%, 55%, ${0.75 + ratio * 0.25})` : `hsla(${hue}, 50%, 40%, 0.12)`,
              opacity: 1,
              boxShadow: glow,
            } : {
              height: '100%',
              opacity: lit ? (0.75 + ratio * 0.25) : isPeak ? 0.9 : 0.15,
              boxShadow: glow,
            };
            return (
              <div key={i} className={`flex-1 rounded-[1px] transition-all duration-75 ${color || ''}`}
                style={inlineStyle}
              />
            );
          })}
        </div>
        <span className="text-[9px] font-mono w-10 text-right shrink-0" style={{ color: clipping ? 'rgb(248,113,113)' : `hsla(${hue}, 40%, 55%, 0.5)` }}>
          {clipping ? 'CLIP' : `${dbDisplay === '-inf' ? '-∞' : dbDisplay}dB`}
        </span>
      </div>
    </div>
  );
}

function CompactSlider({ label, value, setValue, hue = 120 }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-[52px] shrink-0" style={{ color: `hsla(${hue}, 40%, 60%, 0.6)` }}>{label}</span>
      <div className="flex-1">
        <Slider
          name={label}
          value={Math.round(value * 100)}
          onChange={({ value: v }) => setValue(v / 100)}
          min={0}
          max={100}
          step={1}
          renderValue={false}
        />
      </div>
      <span className="text-[9px] font-mono w-[24px] text-right" style={{ color: `hsla(${hue}, 40%, 55%, 0.5)` }}>{Math.round(value * 100)}</span>
    </div>
  );
}
