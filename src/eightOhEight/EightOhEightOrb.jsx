// EightOhEightOrb.jsx — UI for the 808 Kick Rhythm plugin.
//
// 380 × 500 chassis, 5 px radius, TR-808 palette. Rack-standard props:
//   instanceId, sharedSource, registerEngine, unregisterEngine,
//   onRemove, onStateChange, initialState
//
// Layout (top → bottom):
//   1. Header           : title + bypass
//   2. Transport row    : Trigger Mode | ON/OFF | BPM | Quantize
//   3. Pattern grid     : 10 patterns (2 × 5)
//   4. Trigger Knob     : huge centered orange pad (click to fire, drag for velocity)
//   5. Character row    : Warm / Saturate / Punch / Tight / Boom / Crunch
//   6. Sound shaping    : TUNE / DECAY / CLICK / DRIVE / TONE / MIX
//   7. Bottom strip     : output meter + step indicator + IN/OUT trim
//
// Sequencer drives `engine.setOnStep` to flash the active step in real time
// (audio-clock-aligned via setTimeout offset).

import React, {
  useEffect, useMemo, useRef, useState, useCallback,
} from 'react';
import { createEightOhEightEngine, PATTERNS, patternById, CHARACTERS } from './eightOhEightEngine.js';

// TR-808 palette
const COL = {
  orange:    '#FF5A1F',
  deep:      '#FF6A00',
  warm:      '#FF8C00',
  amber:     '#FFB000',
  golden:    '#FFD23A',
  soft:      '#FFF2A6',
  panel:     '#0F0F0F',
  charcoal:  '#1A1A1A',
  mid:       '#2A2A2A',
  off:       '#EAEAEA',
  muted:     '#9A9A9A',
};

const TRIGGER_MODES = [
  { id: 'free',   label: 'FREE',   tip: 'Sequencer free-runs while ON. Manual Trigger always works.' },
  { id: 'host',   label: 'HOST',   tip: 'Sequencer follows host transport: runs only when DAW (or rack) is playing.' },
  { id: 'manual', label: 'MAN',    tip: 'Sequencer disabled. Only manual hits via the Trigger Knob.' },
  { id: 'hybrid', label: 'HYBRID', tip: 'Sequencer + manual hits layer on top.' },
];

const INPUT_MODES = [
  { id: 'gen',      label: 'GEN',  tip: 'Generate only — input muted.' },
  { id: 'genPass',  label: 'PASS', tip: 'Generate + input pass-through.' },
  { id: 'duck',     label: 'DUCK', tip: 'Sidechain duck: kick ducks the input pass on every hit.' },
];

export default function EightOhEightOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const init = initialState || {};
  // Transport / mode
  const [triggerMode, setTriggerMode] = useState(init.triggerMode ?? 'hybrid');
  const [inputMode,   setInputMode]   = useState(init.inputMode ?? 'genPass');
  const [running,     setRunning]     = useState(false);
  const [hostPlaying, setHostPlaying] = useState(false);
  const [bpm,         setBpm]         = useState(init.bpm ?? 120);
  const [bpmInput,    setBpmInput]    = useState(String(init.bpm ?? 120));
  const [quantize,    setQuantize]    = useState(init.quantize ?? 'beat');
  const [patternId,   setPatternId]   = useState(init.patternId ?? '4onfloor');

  // Voice
  const [tune,      setTune]      = useState(init.tune      ?? 48);
  const [ampDec,    setAmpDec]    = useState(init.ampDec    ?? 1.20);
  const [pitchDrop, setPitchDrop] = useState(init.pitchDrop ?? 0.40);
  const [punch,     setPunch]     = useState(init.punch     ?? 0.25);
  const [click,     setClick]     = useState(init.click     ?? 0.10);
  const [drive,     setDrive]     = useState(init.drive     ?? 0.22);
  const [toneDb,    setToneDb]    = useState(init.toneDb    ?? 3);
  const [analog,    setAnalog]    = useState(init.analog    ?? 0.65);
  const [character, setCharacter] = useState(init.character ?? null);

  // Mix
  const [inDb,    setInDb]    = useState(init.inDb  ?? 0);
  const [outDb,   setOutDb]   = useState(init.outDb ?? 0);
  const [mix,     setMix]     = useState(init.mix   ?? 1.0);
  const [bypass,  setBypass]  = useState(false);

  // UI state
  const [stepIdx, setStepIdx] = useState(-1);
  const [hitFlash, setHitFlash] = useState(0); // 0..1 envelope on visual pad
  const [meterPk,  setMeterPk]  = useState(0);

  // Refs
  const engineRef    = useRef(null);
  const flashTimerRef = useRef(null);
  const stepTimersRef = useRef([]);

  // ── Engine creation ──────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = sharedSource?.ctx;
    if (!ctx) return;
    const eng = createEightOhEightEngine(ctx);
    engineRef.current = eng;

    // Push initial state in
    eng.setBpm(bpm);
    eng.setTune(tune); eng.setAmpDecay(ampDec); eng.setClick(click);
    eng.setDrive(drive); eng.setToneShelf(toneDb);
    eng.setPitchDrop(pitchDrop); eng.setPunch(punch); eng.setAnalog(analog);
    if (character) eng.setCharacter(character);
    eng.setIn(Math.pow(10, inDb / 20));
    eng.setOut(Math.pow(10, outDb / 20));
    eng.setMix(mix);
    eng.setTriggerMode(triggerMode);
    eng.setInputMode(inputMode);
    eng.setQuantize(quantize);
    eng.setPattern(patternById(patternId), true);

    // Hit + step callbacks: convert audio time → wall time and schedule
    // a UI flash exactly when the audio fires.
    eng.setOnHit((audioWhen, vel) => {
      const dt = (audioWhen - ctx.currentTime) * 1000;
      const wait = Math.max(0, dt);
      const tm = setTimeout(() => {
        setHitFlash(1);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setHitFlash(0), 120);
      }, wait);
      stepTimersRef.current.push(tm);
    });
    eng.setOnStep((idx, audioWhen) => {
      const dt = (audioWhen - ctx.currentTime) * 1000;
      const wait = Math.max(0, dt);
      const tm = setTimeout(() => setStepIdx(idx), wait);
      stepTimersRef.current.push(tm);
    });

    registerEngine?.(instanceId, eng);
    return () => {
      unregisterEngine?.(instanceId, eng);
      eng.dispose();
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
      engineRef.current = null;
    };
    // Engine is created once per shared context. State sync handled by individual effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSource]);

  // Param sync effects
  useEffect(() => engineRef.current?.setBpm(bpm), [bpm]);
  useEffect(() => engineRef.current?.setTune(tune), [tune]);
  useEffect(() => engineRef.current?.setAmpDecay(ampDec), [ampDec]);
  useEffect(() => engineRef.current?.setClick(click), [click]);
  useEffect(() => engineRef.current?.setDrive(drive), [drive]);
  useEffect(() => engineRef.current?.setToneShelf(toneDb), [toneDb]);
  useEffect(() => engineRef.current?.setPitchDrop(pitchDrop), [pitchDrop]);
  useEffect(() => engineRef.current?.setPunch(punch), [punch]);
  useEffect(() => engineRef.current?.setAnalog(analog), [analog]);
  useEffect(() => engineRef.current?.setIn(Math.pow(10, inDb / 20)), [inDb]);
  useEffect(() => engineRef.current?.setOut(Math.pow(10, outDb / 20)), [outDb]);
  useEffect(() => engineRef.current?.setMix(mix), [mix]);
  useEffect(() => engineRef.current?.setBypass(bypass), [bypass]);
  useEffect(() => engineRef.current?.setTriggerMode(triggerMode), [triggerMode]);
  useEffect(() => engineRef.current?.setInputMode(inputMode), [inputMode]);
  useEffect(() => engineRef.current?.setQuantize(quantize), [quantize]);
  useEffect(() => engineRef.current?.setHostPlaying(hostPlaying), [hostPlaying]);
  useEffect(() => {
    if (character) engineRef.current?.setCharacter(character);
  }, [character]);

  // Pattern switch — queue to bar boundary unless first
  useEffect(() => {
    const eng = engineRef.current; if (!eng) return;
    eng.setPattern(patternById(patternId));
  }, [patternId]);

  // Run / stop
  useEffect(() => {
    const eng = engineRef.current; if (!eng) return;
    if (running) eng.start(); else eng.stop();
  }, [running]);

  // State persistence
  useEffect(() => {
    onStateChange?.(instanceId, {
      triggerMode, inputMode, bpm, quantize, patternId,
      tune, ampDec, pitchDrop, punch, click, drive, toneDb, analog, character,
      inDb, outDb, mix,
    });
  }, [triggerMode, inputMode, bpm, quantize, patternId, tune, ampDec, pitchDrop,
      punch, click, drive, toneDb, analog, character, inDb, outDb, mix,
      instanceId, onStateChange]);

  // Output meter polling
  useEffect(() => {
    let raf = null;
    const tick = () => {
      const p = engineRef.current?.getOutputPeak?.() || 0;
      setMeterPk(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, []);

  // Manual trigger (Trigger Knob click)
  const triggerVelRef = useRef(1.0);
  const onTriggerDown = useCallback((e) => {
    e.preventDefault();
    engineRef.current?.trigger(triggerVelRef.current);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const activePat = patternById(patternId);

  return (
    <div style={{
      width: 380, height: 500, boxSizing: 'border-box', padding: 10,
      borderRadius: 5, overflow: 'hidden',
      background: `linear-gradient(180deg, ${COL.charcoal} 0%, ${COL.panel} 100%)`,
      border: '1px solid rgba(255,90,31,0.15)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      color: COL.off, position: 'relative', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.18em', color: COL.orange }}>
            808 KICK
          </span>
          <span style={{ fontSize: 8, letterSpacing: '0.2em', color: COL.muted }}>
            RHYTHM · {activePat.label.toUpperCase()}
          </span>
        </div>
        <button onClick={() => setBypass(b => !b)}
          title={bypass ? 'Bypassed — click to activate' : 'Active — click to bypass'}
          style={btnSmall(bypass ? COL.muted : COL.orange, bypass)}>
          {bypass ? 'BYP' : 'ON'}
        </button>
      </div>

      {/* TRANSPORT ROW */}
      <div style={panel}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Trigger mode */}
          {TRIGGER_MODES.map(m => (
            <button key={m.id} onClick={() => setTriggerMode(m.id)}
              title={m.tip}
              style={btnTiny(triggerMode === m.id)}>{m.label}</button>
          ))}

          <span style={divider} />

          {/* On / Off */}
          <button onClick={() => setRunning(r => !r)}
            title="Start / stop the sequencer (manual trigger always works)"
            style={{
              ...btnTiny(running),
              padding: '4px 10px',
              background: running
                ? `linear-gradient(180deg, ${COL.deep}, ${COL.warm})`
                : COL.mid,
              color: running ? '#000' : COL.muted,
              fontWeight: 800,
            }}>{running ? '■ STOP' : '▶ RUN'}</button>

          <span style={divider} />

          {/* BPM */}
          <span style={{ fontSize: 8, letterSpacing: '0.2em', color: COL.muted }}>BPM</span>
          <input type="number" min={40} max={240} value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={() => {
              const v = parseInt(bpmInput, 10);
              if (!isNaN(v)) {
                const c = Math.max(40, Math.min(240, v));
                setBpm(c); setBpmInput(String(c));
              } else setBpmInput(String(bpm));
            }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            title="Internal BPM (active when Host Sync is OFF)"
            style={{
              width: 38, padding: '2px 4px', background: COL.charcoal,
              color: COL.golden, border: `1px solid ${COL.mid}`,
              borderRadius: 3, fontSize: 9, textAlign: 'center', fontFamily: 'inherit',
            }} />

          {/* Quantize */}
          <button onClick={() => setQuantize(q => q === 'beat' ? 'bar' : q === 'bar' ? 'instant' : 'beat')}
            title="Pattern start quantize: BEAT / BAR / INSTANT"
            style={btnTiny(false)}>Q:{quantize.toUpperCase().slice(0,3)}</button>

          {/* Host play sim */}
          {triggerMode === 'host' && (
            <button onClick={() => setHostPlaying(p => !p)}
              title="Host transport state (stub — wire to DAW bridge or rack transport)"
              style={btnTiny(hostPlaying)}>
              HOST {hostPlaying ? '▶' : '⏸'}
            </button>
          )}
        </div>
      </div>

      {/* PATTERN GRID */}
      <div style={panel}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3,
        }}>
          {PATTERNS.map((p, i) => {
            const active = p.id === patternId;
            // Step gradient by index
            const stops = [COL.deep, COL.warm, COL.amber, COL.golden, COL.soft];
            const c = stops[i % stops.length];
            return (
              <button key={p.id} onClick={() => setPatternId(p.id)}
                title={`${p.label} — quantized switch on next bar boundary`}
                style={{
                  padding: '5px 2px', borderRadius: 3, cursor: 'pointer',
                  border: active ? `1px solid ${c}` : `1px solid ${COL.mid}`,
                  background: active
                    ? `linear-gradient(180deg, ${c}33, ${c}11)`
                    : COL.charcoal,
                  color: active ? c : COL.muted,
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
                  fontFamily: 'inherit',
                  boxShadow: active ? `0 0 8px ${c}55` : 'none',
                  transition: 'background 0.1s, box-shadow 0.1s',
                }}>{p.label.toUpperCase()}</button>
            );
          })}
        </div>
      </div>

      {/* TRIGGER KNOB (centered drum pad) */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <TriggerPad
          flash={hitFlash}
          onDown={onTriggerDown}
          onVelocity={(v) => { triggerVelRef.current = v; }}
        />
      </div>

      {/* CHARACTER ROW */}
      <div style={panel}>
        <div style={{ display: 'flex', gap: 3 }}>
          {['Warm','Saturate','Punch','Tight','Boom','Crunch'].map(name => {
            const active = character === name;
            return (
              <button key={name} onClick={() => {
                  const next = active ? null : name;
                  setCharacter(next);
                  // Sync knob state to the preset so the UI reflects what
                  // the engine just applied (single source of truth = CHARACTERS).
                  if (next) {
                    const p = CHARACTERS[next];
                    if (p) {
                      setAmpDec(p.ampDecay);
                      setPitchDrop(p.pitchDrop);
                      setPunch(p.punch);
                      setClick(p.click);
                      setDrive(p.drive);
                      setToneDb(p.toneShelfDb);
                      if (p.analog != null) setAnalog(p.analog);
                    }
                  }
                }}
                title={CHAR_TIPS[name]}
                style={{
                  flex: 1, padding: '4px 0', borderRadius: 3, cursor: 'pointer',
                  border: active ? `1px solid ${COL.amber}` : `1px solid ${COL.mid}`,
                  background: active
                    ? `linear-gradient(180deg, ${COL.amber}22, ${COL.deep}22)`
                    : COL.charcoal,
                  color: active ? COL.golden : COL.muted,
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
                  fontFamily: 'inherit',
                  boxShadow: active ? `0 0 6px ${COL.amber}66` : 'none',
                }}>{name.toUpperCase()}</button>
            );
          })}
        </div>
      </div>

      {/* SOUND SHAPING — synth voice (row 1) */}
      <div style={{ ...panel, padding: '5px 4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
          <Knob label="TUNE"   value={tune}      min={30}   max={120}  fmt={v => `${v|0}Hz`}
                onChange={setTune}      defaultVal={55}    size={32}
                tip="Sub fundamental (30–120 Hz). Low = subby 808, high = poppy/click-forward." />
          <Knob label="DECAY"  value={ampDec}    min={0.10} max={3.00} fmt={v => `${(v*1000)|0}`}
                onChange={setAmpDec}    defaultVal={1.20}  size={32}
                tip="Amp decay (ms). Short = tight punch, long = massive 808 sub tail (up to 3 s)." />
          <Knob label="DROP"   value={pitchDrop} min={0}    max={1}    fmt={v => `${(v*100)|0}`}
                onChange={setPitchDrop} defaultVal={0.55}  size={32}
                tip="Pitch sweep depth. Low = round thump, high = aggressive analog snap." />
          <Knob label="PUNCH"  value={punch}     min={0}    max={1}    fmt={v => `${(v*100)|0}`}
                onChange={setPunch}     defaultVal={0.45}  size={32}
                tip="Attack emphasis: faster pitch sweep + extra transient. High = drum-machine front edge." />
          <Knob label="CLICK"  value={click}     min={0}    max={1}    fmt={v => `${(v*100)|0}`}
                onChange={setClick}     defaultVal={0.30}  size={32}
                tip="Beater attack layer. Adds snap that translates on small speakers." />
        </div>
      </div>

      {/* SOUND SHAPING — tone & output (row 2) */}
      <div style={{ ...panel, padding: '5px 4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
          <Knob label="TONE"   value={toneDb}    min={-6}   max={9}    fmt={v => `${v>=0?'+':''}${v.toFixed(1)}`}
                onChange={setToneDb}    defaultVal={0}     size={32}
                tip="Low-shelf @80 Hz. Cut = tight & dark, boost = thick low-mid weight." />
          <Knob label="DRIVE"  value={drive}     min={0}    max={1}    fmt={v => `${(v*100)|0}`}
                onChange={setDrive}     defaultVal={0.10}  size={32}
                tip="Saturation. Low = clean sine, high = crunchy harmonic body." />
          <Knob label="ANALOG" value={analog}    min={0}    max={1}    fmt={v => `${(v*100)|0}`}
                onChange={setAnalog}    defaultVal={0.35}  size={32}
                tip="Drift + harmonic warmth + asymmetric nonlinearity + soft tone. Low = pristine, high = vintage drum-machine character." />
          <Knob label="OUT"    value={outDb}     min={-24}  max={12}   fmt={v => `${v>=0?'+':''}${v.toFixed(1)}`}
                onChange={setOutDb}     defaultVal={0}     size={32}
                tip="Output gain (dB). Final stage trim — set last to balance with mix." />
        </div>
      </div>

      {/* BOTTOM — meter + step indicator + IN/OUT + input mode */}
      <div style={{ ...panel, padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 2 }}>
          {activePat.steps.map((v, i) => {
            const isStep = i === stepIdx;
            const has = v > 0;
            const bg = isStep
              ? COL.golden
              : has ? COL.deep + '88' : COL.mid;
            return <div key={i} style={{
              flex: 1, height: 6, borderRadius: 2,
              background: bg,
              boxShadow: isStep ? `0 0 6px ${COL.soft}` : 'none',
              transition: 'background 0.05s',
            }} />;
          })}
        </div>

        {/* Output meter */}
        <div title="Output peak level (orange → yellow gradient)" style={{
          height: 6, background: COL.charcoal, borderRadius: 2, overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            width: `${Math.min(100, meterPk * 140)}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${COL.deep}, ${COL.amber} 70%, ${COL.golden})`,
            transition: 'width 0.04s',
          }}/>
          {meterPk > 0.99 && (
            <div style={{ position: 'absolute', right: 2, top: 1, width: 3, height: 4,
                          background: '#fff', borderRadius: 1 }} />
          )}
        </div>

        {/* IN / OUT trims + input mode */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Knob label="IN"  value={inDb}  min={-24} max={12} fmt={v => `${v>=0?'+':''}${v.toFixed(1)}`}
                onChange={setInDb}  defaultVal={0} size={26} showValue={false}
                tip="Input trim (dB)." />
          <Knob label="OUT" value={outDb} min={-24} max={12} fmt={v => `${v>=0?'+':''}${v.toFixed(1)}`}
                onChange={setOutDb} defaultVal={0} size={26} showValue={false}
                tip="Output trim (dB)." />
          <span style={divider} />
          {INPUT_MODES.map(m => (
            <button key={m.id} onClick={() => setInputMode(m.id)}
              title={m.tip}
              style={btnTiny(inputMode === m.id)}>{m.label}</button>
          ))}
          {onRemove && (
            <button onClick={onRemove}
              title="Remove plugin"
              style={{ ...btnTiny(false), marginLeft: 'auto', color: COL.muted }}>✕</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Trigger Pad (large central drum pad) ─────────────────────────────────────
function TriggerPad({ flash, onDown, onVelocity }) {
  const startRef = useRef({ y: 0, v: 1 });
  const [vel, setVel] = useState(1.0);

  const onPointerDown = (e) => {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    startRef.current = { y: e.clientY, v: vel };
    onDown(e);
  };
  const onPointerMove = (e) => {
    if (!e.buttons) return;
    const dy = startRef.current.y - e.clientY;
    let nv = startRef.current.v + dy * 0.005;
    nv = Math.max(0.1, Math.min(1, nv));
    setVel(nv);
    onVelocity(nv);
  };

  const SIZE = 110;
  const r = SIZE / 2 - 6;
  const cx = SIZE / 2, cy = SIZE / 2;
  const pulseR = r + flash * 6;
  const innerC = `rgba(255,90,31, ${0.55 + flash * 0.35})`;

  return (
    <div title="Drum pad — click to fire kick. Drag up/down to set velocity."
         onPointerDown={onPointerDown}
         onPointerMove={onPointerMove}
         style={{
           width: SIZE, height: SIZE, cursor: 'pointer',
           userSelect: 'none', touchAction: 'none', position: 'relative',
         }}>
      <svg width={SIZE} height={SIZE}>
        {/* outer halo */}
        <circle cx={cx} cy={cy} r={pulseR + 4}
                fill="none" stroke={COL.deep}
                strokeWidth={1 + flash * 2}
                opacity={0.25 + flash * 0.6} />
        {/* main pad */}
        <defs>
          <radialGradient id="padGrad" cx="50%" cy="40%" r="60%">
            <stop offset="0%"  stopColor={COL.golden} stopOpacity={0.5 + flash * 0.5} />
            <stop offset="55%" stopColor={COL.deep}   stopOpacity={0.7 + flash * 0.3} />
            <stop offset="100%" stopColor={COL.charcoal} />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r}
                fill="url(#padGrad)"
                stroke={innerC} strokeWidth={1.5} />
        {/* velocity arc */}
        <circle cx={cx} cy={cy} r={r - 6}
                fill="none" stroke={COL.charcoal} strokeWidth={3} />
        <circle cx={cx} cy={cy} r={r - 6}
                fill="none" stroke={COL.amber} strokeWidth={3}
                strokeDasharray={`${vel * 2 * Math.PI * (r - 6)} ${2 * Math.PI * (r - 6)}`}
                strokeDashoffset={Math.PI * (r - 6) * 0.5}
                transform={`rotate(-90 ${cx} ${cy})`}
                opacity={0.85} />
        {/* center label */}
        <text x={cx} y={cy + 2} textAnchor="middle"
              fontSize="14" fontWeight="800" fontFamily="system-ui"
              letterSpacing="2"
              fill={flash > 0.5 ? '#fff' : COL.soft}>
          808
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle"
              fontSize="7" fontFamily="system-ui" letterSpacing="2"
              fill={COL.muted}>
          VEL {(vel * 100) | 0}
        </text>
      </svg>
    </div>
  );
}

// ── Knob (drag vertical, double-click reset, hidden value optional) ─────────
function Knob({ label, value, min, max, fmt, onChange, size = 36, defaultVal,
                showValue = true, accent = COL.amber, tip = '' }) {
  const startRef = useRef({ y: 0, v: 0 });
  const norm = (max - min === 0) ? 0 : (value - min) / (max - min);
  const startA = -135, endA = 135;
  const a = startA + (endA - startA) * norm;
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  const ind = (a - 90) * Math.PI / 180;
  const ix = cx + Math.cos(ind) * r * 0.78;
  const iy = cy + Math.sin(ind) * r * 0.78;
  function arc(a1, a2) {
    const s = (a1 - 90) * Math.PI / 180, e = (a2 - 90) * Math.PI / 180;
    const x1 = cx + Math.cos(s) * r, y1 = cy + Math.sin(s) * r;
    const x2 = cx + Math.cos(e) * r, y2 = cy + Math.sin(e) * r;
    const large = (a2 - a1) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }
  const onDown = (e) => {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    startRef.current = { y: e.clientY, v: value };
  };
  const onMove = (e) => {
    if (!e.buttons) return;
    const dy = startRef.current.y - e.clientY;
    const range = max - min;
    const speed = (e.shiftKey ? 0.0015 : 0.006) * range;
    let nv = startRef.current.v + dy * speed;
    nv = Math.max(min, Math.min(max, nv));
    onChange(nv);
  };
  return (
    <div title={tip} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                              gap: 1, userSelect: 'none' }}>
      <svg width={size} height={size}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onDoubleClick={() => defaultVal !== undefined && onChange(defaultVal)}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}>
        <circle cx={cx} cy={cy} r={r + 1} fill={COL.charcoal} />
        <circle cx={cx} cy={cy} r={r}     fill={COL.mid} stroke={COL.charcoal} strokeWidth={0.5} />
        <path d={arc(startA, endA)}      fill="none" stroke={COL.charcoal} strokeWidth={1.5} />
        <path d={arc(startA, a)}         fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={ix} y2={iy} stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={1.6} fill={accent} />
      </svg>
      <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.15em', color: COL.muted }}>{label}</div>
      {showValue && (
        <div style={{ fontSize: 7, color: COL.muted, minHeight: 9 }}>{fmt(value)}</div>
      )}
    </div>
  );
}

// ── Style helpers ───────────────────────────────────────────────────────────
const panel = {
  background: COL.charcoal,
  border: `1px solid ${COL.mid}`,
  borderRadius: 4,
  padding: '5px 6px',
};
const divider = {
  display: 'inline-block', width: 1, height: 14,
  background: COL.mid, margin: '0 3px',
};
function btnSmall(c, dim) {
  return {
    padding: '3px 8px', borderRadius: 3, cursor: 'pointer',
    background: dim ? COL.charcoal : `linear-gradient(180deg, ${c}, ${c}cc)`,
    color: dim ? COL.muted : '#000',
    border: `1px solid ${dim ? COL.mid : c}`,
    fontFamily: 'inherit', fontSize: 8, fontWeight: 800, letterSpacing: '0.18em',
  };
}
function btnTiny(active) {
  return {
    padding: '3px 6px', borderRadius: 3, cursor: 'pointer',
    background: active
      ? `linear-gradient(180deg, ${COL.deep}, ${COL.warm})`
      : COL.charcoal,
    color: active ? '#000' : COL.muted,
    border: `1px solid ${active ? COL.deep : COL.mid}`,
    fontFamily: 'inherit', fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
    boxShadow: active ? `0 0 5px ${COL.deep}88` : 'none',
  };
}

const CHAR_TIPS = {
  Warm:     'Soft lowshelf boost, gentle drive, longer body. Round and easy.',
  Saturate: 'Heavier tanh saturation. Adds harmonic bite without losing low end.',
  Punch:    'Steeper pitch sweep, harder click, shorter body. Forward and slappy.',
  Tight:    'Short decay, slight cut. Cuts through busy mixes.',
  Boom:     'Long body, low pitch, +5 dB sub shelf. Big sub 808.',
  Crunch:   'Heavy drive + darker tone. Lo-fi, trap-style distorted kick.',
};
