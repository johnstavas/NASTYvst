import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createAmpEngine } from './ampEngine';
import ClipMeter from './ClipMeter';

const size   = 380;
const center = size / 2;
const PAD    = 30; // inner padding from edge

// accent() is called with a dynamic hue inside the component — module-level helpers use a default
const accent = (s, l, a, hue = 32) => `hsla(${hue}, ${s}%, ${l}%, ${a})`;

const SliderRow = ({ label, value, set, min = 0, max = 1, step = 0.01, fmt }) => (
  <div className="flex items-center gap-2">
    <span className="shrink-0" style={{ fontSize: 7.5, color: accent(45, 55, 0.55), width: 48 }}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => set(parseFloat(e.target.value))}
      style={{ accentColor: accent(70, 60, 1), height: '3px', flex: 1 }} />
    <span className="text-right" style={{ fontSize: 7, color: accent(50, 60, 0.65), width: 28 }}>
      {fmt ? fmt(value) : `${Math.round(value * 100)}%`}
    </span>
  </div>
);

// MeterBar is also stable — module-level so React doesn't remount it each render
const MeterBar = ({ level, peak, label }) => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>{label}</span>
      <div style={{ width: 5, height: 28, background: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${clamp(level * 400, 0, 100)}%`, background: accent(65, 58, 0.85), borderRadius: 3, transition: 'height 0.04s' }} />
        <div style={{ position: 'absolute', bottom: `${clamp(peak * 400, 0, 100)}%`, width: '100%', height: 1, background: accent(60, 80, 0.9) }} />
      </div>
    </div>
  );
};

export default function AmpOrb({ instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState }) {
  // Point tracks freely in 2D within the pad
  const [point, setPoint] = useState(() => initialState ? { x: initialState.pointX ?? center, y: initialState.pointY ?? center } : { x: center, y: center });
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef(null);

  // Panel controls
  const [bass,     setBassVal    ] = useState(initialState?.bass ?? 0.5);
  const [mid,      setMidVal     ] = useState(initialState?.mid ?? 0.5);
  const [treble,   setTrebleVal  ] = useState(initialState?.treble ?? 0.5);
  const [presence, setPresenceVal] = useState(initialState?.presence ?? 0.5);
  // Sag + Mix start at 0 → Amp module is transparent when first added.
  // Sag > 0 routes sagComp into the wet path; Mix > 0 fades the full
  // preamp + tonestack + cab sim chain in. User has to engage both to
  // hear any of the amp coloration.
  const [sag,      setSagVal     ] = useState(initialState?.sag ?? 0);
  const [mix,      setMix        ] = useState(initialState?.mix ?? 0);
  const [inputGain,    setInputGainVal ] = useState(initialState?.inputGain ?? 1.0);
  const [outputGainVal,setOutputGainVal] = useState(initialState?.outputGain ?? 1.0);
  const [pan,      setPanVal     ] = useState(initialState?.pan ?? 0);
  const [bypassed, setBypassed   ] = useState(initialState?.bypassed ?? false);
  const [showPanel,setShowPanel  ] = useState(false);

  const [muLaw, setMuLaw] = useState(initialState?.muLaw ?? 0);
  const [buzz,  setBuzz ] = useState(initialState?.buzz  ?? 0);
  const [eqBands, setEqBands] = useState(() => initialState?.eqBands ? [...initialState.eqBands] : new Array(10).fill(0));
  const [eqBypassed, setEqBypassed] = useState(initialState?.eqBypassed ?? true);
  const [eqPreset, setEqPreset] = useState(initialState?.eqPreset ?? 'Flat');

  const EQ_PRESETS = {
    'Flat':           [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Bass Boost':     [8, 6, 4, 1, 0, 0, 0, 0, 0, 0],
    'Treble Boost':   [0, 0, 0, 0, 0, 0, 2, 5, 7, 8],
    'Scoop':          [4, 3, 0, -4, -5, -4, 0, 3, 5, 4],
    'Vocal Presence': [0, 0, -1, -2, 0, 3, 5, 4, 2, 0],
    'Loudness':       [6, 4, 0, -2, -1, 0, -1, 0, 4, 6],
    'De-Mud':         [0, 0, -2, -5, -3, 0, 1, 2, 1, 0],
    'Bright & Airy':  [-2, -1, 0, 0, 0, 1, 3, 5, 7, 8],
    'Dark & Warm':    [4, 5, 3, 1, 0, -1, -2, -4, -5, -6],
    'Sub Bass':       [10, 7, 3, 0, -1, -1, 0, 0, 0, 0],
    'Custom':         null,
  };
  const applyEqPreset = name => {
    setEqPreset(name);
    if (EQ_PRESETS[name]) { setEqBands([...EQ_PRESETS[name]]); if (name !== 'Flat') setEqBypassed(false); }
  };

  const PRESET_KEY = 'nasty-orbs-amp-presets';
  const [userPresets, setUserPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch { return {}; }
  });
  const [selectedPreset, setSelectedPreset] = useState('');

  const getSnapshot = () => ({
    bass, mid, treble, presence, sag, mix, inputGain, outputGain: outputGainVal,
    pan, bypassed, pointX: point.x, pointY: point.y, eqBands: [...eqBands], eqBypassed, muLaw, buzz,
  });
  const applySnapshot = s => {
    if (s.bass !== undefined) setBassVal(s.bass);
    if (s.mid !== undefined) setMidVal(s.mid);
    if (s.treble !== undefined) setTrebleVal(s.treble);
    if (s.presence !== undefined) setPresenceVal(s.presence);
    if (s.sag !== undefined) setSagVal(s.sag);
    if (s.mix !== undefined) setMix(s.mix);
    if (s.inputGain !== undefined) setInputGainVal(s.inputGain);
    if (s.outputGain !== undefined) setOutputGainVal(s.outputGain);
    if (s.pan !== undefined) setPanVal(s.pan);
    if (s.bypassed !== undefined) setBypassed(s.bypassed);
    if (s.pointX !== undefined) setPoint({ x: s.pointX, y: s.pointY });
    if (Array.isArray(s.eqBands)) setEqBands([...s.eqBands]);
    if (s.eqBypassed !== undefined) setEqBypassed(s.eqBypassed);
    if (s.muLaw !== undefined) setMuLaw(s.muLaw);
    if (s.buzz  !== undefined) setBuzz(s.buzz);
  };
  const savePreset = () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const next = { ...userPresets, [name]: getSnapshot() };
    setUserPresets(next);
    setSelectedPreset(name);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
  };
  const deletePreset = name => {
    if (!name) return;
    const next = { ...userPresets };
    delete next[name];
    setUserPresets(next);
    setSelectedPreset('');
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
  };

  // Audio reactive
  const [wobbleTime,setWobbleTime] = useState(0);
  const wobbleRef = useRef(0);
  const [reactive, setReactive  ] = useState({ rms: 0, peak: 0, transient: 0 });
  const [inLevel,  setInLevel   ] = useState(0);
  const [outLevel, setOutLevel  ] = useState(0);
  const [inPeak,   setInPeak    ] = useState(0);
  const [outPeak,  setOutPeak   ] = useState(0);

  const engineRef = useRef(null);
  const animRef   = useRef(null);

  useEffect(() => {
    if (!sharedSource) return;
    const engine = createAmpEngine(sharedSource.ctx);
    engineRef.current = engine;
    registerEngine(instanceId, engine);
    const tick = () => {
      animRef.current = requestAnimationFrame(tick);
      if (!engineRef.current) return;
      wobbleRef.current += 0.016;
      setWobbleTime(wobbleRef.current);
      setReactive(engine.getReactiveData());
      setInLevel(engine.getInputLevel());
      setOutLevel(engine.getOutputLevel());
      setInPeak(engine.getInputPeak());
      setOutPeak(engine.getOutputPeak());
    };
    tick();
    return () => { cancelAnimationFrame(animRef.current); unregisterEngine(instanceId); engine.destroy(); engineRef.current = null; };
  }, [sharedSource]);

  // Derive drive (Y) and tone tilt (X) from point position
  const driveNorm  = 1 - Math.max(0, Math.min(1, (point.y - PAD) / (size - PAD * 2))); // 0=bottom, 1=top
  const tiltNorm   = Math.max(0, Math.min(1, (point.x - PAD) / (size - PAD * 2)));      // 0=dark, 1=bright
  const tilt       = tiltNorm * 2 - 1; // -1=dark, +1=bright

  // Sync to engine
  useEffect(() => { engineRef.current?.setDrive(driveNorm); },           [driveNorm]);
  useEffect(() => { engineRef.current?.setToneTilt(tilt); },             [tilt]);
  useEffect(() => { engineRef.current?.setBass(bass); },                 [bass]);
  useEffect(() => { engineRef.current?.setMid(mid); },                   [mid]);
  useEffect(() => { engineRef.current?.setTreble(treble); },             [treble]);
  useEffect(() => { engineRef.current?.setPresence(presence); },         [presence]);
  useEffect(() => { engineRef.current?.setSag(sag); },                   [sag]);
  useEffect(() => { engineRef.current?.setMix(mix); },                   [mix]);
  useEffect(() => { engineRef.current?.setInputGain(inputGain); },       [inputGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outputGainVal); },  [outputGainVal]);
  useEffect(() => { engineRef.current?.setPan(pan); },                   [pan]);
  useEffect(() => { engineRef.current?.setBypass(bypassed); },           [bypassed]);
  useEffect(() => { engineRef.current?.setMuLaw(muLaw); },               [muLaw]);
  useEffect(() => { engineRef.current?.setBuzz(buzz); },                  [buzz]);

  useEffect(() => {
    if (!engineRef.current) return;
    eqBands.forEach((gain, i) => engineRef.current.setEqBand(i, eqBypassed ? 0 : gain));
  }, [eqBands, eqBypassed]);

  // Drag
  const updateFromPointer = useCallback((clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(PAD, Math.min(size - PAD, clientX - rect.left));
    const y = Math.max(PAD, Math.min(size - PAD, clientY - rect.top));
    setPoint({ x, y });
  }, []);

  const onMouseDown = e => { e.preventDefault(); setDragging(true); updateFromPointer(e.clientX, e.clientY); };
  const onMouseMove = e => { if (dragging) updateFromPointer(e.clientX, e.clientY); };

  // Visual values
  const rLow   = Math.min(1, reactive.rms * 8);
  const rMid   = Math.min(1, reactive.rms * 5);
  const t      = wobbleTime;

  // Dynamic hue: yellow (58°) at clean → deep orange-red (12°) at hi-gain, tilt shifts ±8°
  const hue = 58 - driveNorm * 46 + tilt * 8;
  const ac  = (s, l, a) => accent(s, l, a, hue);

  // Glow hue: follows drive but can redden further with audio transients
  const glowHue = hue - rLow * 8;

  // "Amp glow" — radiates from point, intensity = drive
  const glowSize  = 60 + driveNorm * 120 + rLow * 40;
  const glowAlpha = 0.08 + driveNorm * 0.35 + rLow * 0.15;

  // Crosshair lines (axis guides)
  const showGuides = true;

  // Drive label
  const driveLabel = driveNorm < 0.05 ? 'Clean' : driveNorm < 0.3 ? 'Crunch' : driveNorm < 0.65 ? 'Lead' : 'Hi‑Gain';
  const toneLabel  = Math.abs(tilt) < 0.15 ? 'Neutral' : tilt < 0 ? 'Dark' : 'Bright';

  // Mod rings — driven by driveNorm and audio
  const rings = useMemo(() => {
    return [...Array(30)].map((_, i) => {
      const baseR = 8 + i * 5.5;
      const reveal = Math.max(0, driveNorm * 1.5 - (i / 30) * 0.8);
      const alpha  = 0.03 + reveal * 0.2 - i * 0.004;
      if (alpha < 0.01) return null;
      const driver = driveNorm + rLow * 0.4;
      const breathe = Math.sin(t * (1.1 + i * 0.12) + i * 0.6) * driver * (3 + i * 0.4);
      const ringR = baseR + breathe + rMid * driver * (1 + i * 0.15);
      if (driver < 0.05) return { type: 'circle', r: ringR, alpha, i };
      const pts = 80; const pts2 = pts + 1;
      let d = '';
      for (let p = 0; p < pts2; p++) {
        const a = (p / pts) * Math.PI * 2;
        const dist = driver * (2 + i * 0.3) * (
          Math.sin(a * 2 + t * 0.6) * 0.4 + Math.sin(a * 3 - t * 0.9) * 0.3 +
          Math.sin(a * 5 + t * 0.7) * 0.2 + driveNorm * driveNorm * Math.sin(a * 7 - t * 0.5) * 0.2
        );
        const r = ringR + dist;
        d += (p === 0 ? 'M' : 'L') + `${center + Math.cos(a) * r},${center + Math.sin(a) * r}`;
      }
      return { type: 'path', d: d + 'Z', alpha, i };
    });
  }, [driveNorm, rLow, rMid, t]);

  useEffect(() => {
    onStateChange?.(instanceId, {
      bass, mid, treble, presence, sag, mix, inputGain, outputGain: outputGainVal,
      pan, bypassed, pointX: point.x, pointY: point.y, eqBands: [...eqBands], eqBypassed, muLaw, buzz,
    });
  }, [bass, mid, treble, presence, sag, mix, inputGain, outputGainVal, pan, bypassed, point.x, point.y, eqBands, eqBypassed]);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));




  return (
    <div className="flex flex-col rounded-2xl overflow-hidden"
      style={{ width: size, background: `linear-gradient(160deg, ${ac(20, 8, 0.65)}, ${ac(15, 5, 0.85)})`, border: `1px solid ${ac(40, 35, 0.2)}` }}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${ac(30, 30, 0.12)}` }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: ac(50, 60, 0.5) }}>Amp</span>
        <div className="flex items-center gap-2">
          <span className="text-[8px] uppercase tracking-[0.25em]" style={{ color: ac(50, 55, 0.4) }}>
            {driveLabel} · {toneLabel}
          </span>
          {onRemove && (
            <button onClick={onRemove} className="w-5 h-5 rounded-full text-[11px] flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)' }}>×</button>
          )}
        </div>
      </div>

      {/* ===== AMP PAD ===== */}
      <div ref={wrapRef} className="relative select-none"
        style={{ width: size, height: size, cursor: 'crosshair' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}>

        {/* Background */}
        <div className="absolute inset-0" style={{
          background: `radial-gradient(ellipse at ${point.x}px ${point.y}px, ${ac(25, 10, 1)}, ${ac(15, 5, 1)} 70%)`,
        }} />

        {/* Axis labels */}
        <div className="absolute pointer-events-none" style={{ left: center, top: PAD - 16, transform: 'translateX(-50%)', fontSize: 8, letterSpacing: '0.2em', color: ac(40, 50, 0.35), textTransform: 'uppercase' }}>Drive ↑</div>
        <div className="absolute pointer-events-none" style={{ left: center, bottom: PAD - 16, transform: 'translateX(-50%)', fontSize: 8, letterSpacing: '0.2em', color: ac(40, 50, 0.25), textTransform: 'uppercase' }}>Clean</div>
        <div className="absolute pointer-events-none" style={{ left: PAD - 4, top: center, transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center', fontSize: 8, letterSpacing: '0.2em', color: ac(40, 50, 0.25), textTransform: 'uppercase' }}>Dark</div>
        <div className="absolute pointer-events-none" style={{ right: PAD - 4, top: center, transform: 'translateY(-50%) rotate(90deg)', transformOrigin: 'center', fontSize: 8, letterSpacing: '0.2em', color: ac(40, 50, 0.25), textTransform: 'uppercase' }}>Bright</div>

        {/* Mod rings */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'hidden', pointerEvents: 'none' }}>
          {rings.map((ring, i) => {
            if (!ring) return null;
            const stroke = `hsla(${glowHue}, ${20 + driveNorm * 40}%, ${55 - i * 1.2}%, ${ring.alpha})`;
            return ring.type === 'circle'
              ? <circle key={i} cx={center} cy={center} r={ring.r} fill="none" stroke={stroke} strokeWidth={0.5} />
              : <path   key={i} d={ring.d}                          fill="none" stroke={stroke} strokeWidth={0.5} />;
          })}
        </svg>

        {/* Axis grid lines */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, pointerEvents: 'none' }}>
          <line x1={center} y1={PAD} x2={center} y2={size - PAD}
            stroke={ac(30, 40, 0.08)} strokeWidth={0.5} strokeDasharray="4 6" />
          <line x1={PAD} y1={center} x2={size - PAD} y2={center}
            stroke={ac(30, 40, 0.08)} strokeWidth={0.5} strokeDasharray="4 6" />
          <line x1={point.x} y1={PAD} x2={point.x} y2={size - PAD}
            stroke={ac(50, 55, 0.12 + driveNorm * 0.1)} strokeWidth={0.5} />
          <line x1={PAD} y1={point.y} x2={size - PAD} y2={point.y}
            stroke={ac(50, 55, 0.12 + driveNorm * 0.1)} strokeWidth={0.5} />
        </svg>

        {/* Drive glow at point */}
        <div className="absolute pointer-events-none rounded-full" style={{
          left: point.x - glowSize, top: point.y - glowSize,
          width: glowSize * 2, height: glowSize * 2,
          background: `radial-gradient(circle, hsla(${glowHue}, 80%, 65%, ${glowAlpha}), transparent 65%)`,
          filter: `blur(${16 + driveNorm * 24}px)`,
        }} />

        {/* Point indicator */}
        <svg className="absolute" style={{ left: 0, top: 0, width: size, height: size, overflow: 'visible', pointerEvents: 'none' }}>
          <circle cx={point.x} cy={point.y} r={10 + driveNorm * 6 + rLow * 4}
            fill="none"
            stroke={`hsla(${glowHue}, 75%, 70%, ${0.4 + driveNorm * 0.4})`}
            strokeWidth={1 + driveNorm * 1}
            style={{ filter: `drop-shadow(0 0 ${4 + driveNorm * 8}px hsla(${glowHue}, 75%, 65%, 0.6))` }} />
          <circle cx={point.x} cy={point.y} r={3 + rLow * 2}
            fill={`hsla(${glowHue}, 85%, 80%, ${0.7 + driveNorm * 0.3})`}
            style={{ filter: `blur(1px) drop-shadow(0 0 ${4 + driveNorm * 8}px hsla(${glowHue}, 85%, 75%, 0.8))` }} />
        </svg>

        {driveNorm > 0.02 && (
          <div className="absolute pointer-events-none text-[7.5px]" style={{
            left: point.x + 14, top: point.y - 6, color: ac(55, 65, 0.55),
          }}>{Math.round(driveNorm * 100)}%</div>
        )}
      </div>

      {/* Clip-visibility meter — big dB numbers so clipping is unmissable */}
      <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />

      {/* Bottom bar */}
      <div className="flex items-center gap-2.5 px-3 py-2 shrink-0"
        style={{ borderTop: `1px solid ${ac(30, 30, 0.15)}` }}>
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[7.5px] shrink-0" style={{ color: ac(45, 55, 0.5) }}>Mix</span>
          <input type="range" min="0" max="1" step="0.01" value={mix}
            onChange={e => setMix(parseFloat(e.target.value))}
            style={{ accentColor: ac(70, 60, 1), height: '3px', flex: 1 }} />
          <span className="text-[7.5px]" style={{ color: ac(50, 62, 0.65), width: 28, textAlign: 'right' }}>{Math.round(mix * 100)}%</span>
        </div>
        <button onClick={() => setShowPanel(p => !p)}
          className="rounded px-2 py-1 text-[7.5px] border transition-colors"
          style={showPanel
            ? { background: ac(50, 50, 0.2), borderColor: ac(50, 55, 0.4), color: ac(60, 70, 1) }
            : { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}>⚙</button>
      </div>

      {/* Settings panel */}
      {showPanel && (
        <div className="px-3 py-2.5">
        <div className="flex flex-col gap-2 rounded-xl p-3 backdrop-blur-xl"
          style={{ background: `linear-gradient(160deg, ${ac(20, 8, 0.6)}, ${ac(15, 5, 0.8)})`, border: `1px solid ${ac(40, 40, 0.2)}` }}>
          <div className="flex items-center gap-2">
            <select value={selectedPreset} onChange={e => { setSelectedPreset(e.target.value); if (e.target.value) applySnapshot(userPresets[e.target.value] || {}); }}
              className="flex-1 text-[7.5px] rounded px-2 py-1 outline-none cursor-pointer"
              style={{ WebkitAppearance: 'none', background: 'rgba(0,0,0,0.4)', border: `1px solid ${ac(40, 30, 0.25)}`, color: 'rgba(255,255,255,0.6)' }}>
              <option value="" style={{ background: '#1a0f00' }}>— Load preset —</option>
              {Object.keys(userPresets).sort().map(name => (
                <option key={name} value={name} style={{ background: '#1a0f00' }}>{name}</option>
              ))}
            </select>
            <button onClick={savePreset}
              className="text-[7.5px] font-medium px-2 py-1 rounded whitespace-nowrap"
              style={{ background: ac(30, 12, 0.5), border: `1px solid ${ac(50, 40, 0.3)}`, color: ac(60, 75, 0.9) }}>Save</button>
            <button onClick={() => deletePreset(selectedPreset)} disabled={!selectedPreset}
              className="text-[7.5px] font-medium px-2 py-1 rounded whitespace-nowrap disabled:opacity-30"
              style={{ background: ac(30, 12, 0.5), border: `1px solid ${ac(50, 40, 0.3)}`, color: ac(60, 75, 0.9) }}>Delete</button>
          </div>

          <div className="text-[8px] uppercase tracking-[0.25em] mb-1" style={{ color: ac(45, 50, 0.4) }}>Tonestack</div>
          <SliderRow label="Bass"     value={bass}     set={setBassVal}     />
          <SliderRow label="Mid"      value={mid}      set={setMidVal}      />
          <SliderRow label="Treble"   value={treble}   set={setTrebleVal}   />
          <SliderRow label="Presence" value={presence} set={setPresenceVal} />
          <SliderRow label="Sag"      value={sag}      set={setSagVal}      />
          <div className="text-[8px] uppercase tracking-[0.25em] mt-1 mb-1" style={{ color: ac(45, 50, 0.4) }}>Character</div>
          <SliderRow label="μ-law" value={muLaw} set={setMuLaw} />
          <SliderRow label="Buzz"  value={buzz}  set={setBuzz}  />

          <div className="text-[8px] uppercase tracking-[0.25em] mt-1 mb-1" style={{ color: ac(45, 50, 0.4) }}>Levels</div>
          <SliderRow label="Input"  value={inputGain}     set={setInputGainVal}  min={0} max={2} fmt={v => `${Math.round(v * 100)}%`} />
          <SliderRow label="Output" value={outputGainVal} set={setOutputGainVal} min={0} max={2} fmt={v => `${Math.round(v * 100)}%`} />

          <div className="flex items-center gap-2">
            <span className="text-[7.5px] shrink-0" style={{ color: ac(45, 55, 0.55), width: 48 }}>Pan</span>
            <input type="range" min="-100" max="100" step="1" value={Math.round(pan * 100)}
              onChange={e => setPanVal(parseInt(e.target.value) / 100)}
              onDoubleClick={() => setPanVal(0)}
              style={{ accentColor: ac(70, 60, 1), height: '3px', flex: 1 }} />
            <span className="text-[7.5px] text-right" style={{ color: ac(50, 62, 0.65), width: 28 }}>
              {Math.abs(pan) < 0.01 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}
            </span>
          </div>

          <button onClick={() => setBypassed(b => !b)}
            className="w-full rounded-lg py-1 text-[7.5px] font-medium border mt-1"
            style={bypassed
              ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
              : { background: ac(30, 10, 0.3), border: `1px solid ${ac(40, 30, 0.2)}`, color: ac(50, 60, 0.6) }}>
            {bypassed ? 'Bypassed' : 'Bypass'}
          </button>

          {/* EQ */}
          <div className="pt-1" style={{ borderTop: `1px solid ${ac(40, 30, 0.15)}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] uppercase tracking-[0.25em]" style={{ color: ac(45, 50, 0.4) }}>EQ</span>
                <button onClick={() => setEqBypassed(b => !b)}
                  className="text-[8px] font-medium px-1.5 py-0.5 rounded border transition-colors"
                  style={eqBypassed
                    ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'rgb(252,211,77)' }
                    : { background: ac(30, 10, 0.4), border: `1px solid ${ac(40, 30, 0.25)}`, color: ac(50, 60, 0.7) }}>
                  {eqBypassed ? 'Off' : 'On'}
                </button>
              </div>
              <select value={eqPreset} onChange={e => applyEqPreset(e.target.value)}
                className="flex-1 text-[7.5px] rounded px-1.5 py-0.5 outline-none cursor-pointer"
                style={{ WebkitAppearance: 'none', background: ac(20, 8, 0.6), border: `1px solid ${ac(40, 30, 0.25)}`, color: 'rgba(255,255,255,0.6)' }}>
                {Object.keys(EQ_PRESETS).map(name => (
                  <option key={name} value={name} style={{ background: '#1a0f00' }}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-[3px] h-20 px-1">
              {['32','64','125','250','500','1K','2K','4K','8K','16K'].map((lbl, i) => (
                <div key={i} className="flex flex-col items-center flex-1 h-full">
                  <div className="flex-1 relative w-full flex items-center justify-center">
                    <div className="absolute h-full w-[3px] rounded-full" style={{ background: ac(40, 25, 0.2) }} />
                    <div className="absolute w-full h-[1px] top-1/2" style={{ background: ac(40, 25, 0.1) }} />
                    <input type="range" min="-12" max="12" step="0.5" value={eqBands[i]}
                      onChange={e => {
                        const next = [...eqBands]; next[i] = parseFloat(e.target.value); setEqBands(next);
                        setEqPreset('Custom'); if (eqBypassed) setEqBypassed(false);
                      }}
                      style={{ position: 'absolute', width: '100%', height: '100%', WebkitAppearance: 'none', appearance: 'none', background: 'transparent', writingMode: 'vertical-lr', direction: 'rtl', cursor: 'pointer', accentColor: ac(70, 60, 1) }} />
                  </div>
                  <span className="text-[7px] mt-0.5 leading-none" style={{ color: ac(40, 50, 0.4) }}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
