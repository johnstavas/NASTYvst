// SpringReverbOrb.jsx — Interactive spring reverb module
//
// Three physical springs hang inside a dark "tank" window.
// Each spring controls one reverb parameter:
//   LEFT   — DECAY   (tail length)
//   CENTER — WOBBLE  (spring character / boing factor)
//   RIGHT  — MIX     (dry/wet)
//
// Interaction:
//   • Grab the bob (circle at the bottom of each spring) and drag up/down
//   • Release → the bob bounces back with real damped spring physics
//   • The displacement maps directly to the parameter value
//   • The further you pull, the more you hear the effect change in real time
//
// Aesthetic: matches Scope/Space orbs — near-black panel, subtle matrix grid,
// phosphor-green accents, monospace readouts.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createSpringReverbEngine } from './springReverbEngine';
import ClipMeter from './ClipMeter';

// ─── Palette ──────────────────────────────────────────────────────────────
const BG       = '#07090f';
const GRID     = 'rgba(100,255,150,0.04)';
const DIM      = 'rgba(255,255,255,0.22)';
const CREAM    = 'rgba(255,255,255,0.85)';

const SPRING_DEFS = [
  { id: 'decay',  label: 'DECAY',  color: 'hsl(196,80%,58%)',  glow: 'hsla(196,80%,58%,0.55)', default: 0.38 },
  { id: 'wobble', label: 'WOBBLE', color: 'hsl(46, 90%,60%)',  glow: 'hsla(46, 90%,60%,0.55)', default: 0.35 },
  { id: 'mix',    label: 'MIX',    color: 'hsl(140,70%,52%)',  glow: 'hsla(140,70%,52%,0.55)', default: 0.30 },
];

// ─── Spring physics constants ──────────────────────────────────────────────
const SPRING_K    = 0.18;   // stiffness — how fast it snaps back
const SPRING_DAMP = 0.14;   // damping — how quickly the bounce dies

// ─── Circular knob (local, matches TapeOrb/NeveOrb style) ────────────────
// Drag vertically to change, double-click to reset to default.
// Supports bipolar mode (ring fills from 12-o'clock center outward).
function SpringKnob({
  label, value, onChange, defaultValue = 0.5,
  size = 28, ringColor = 'hsl(46, 90%, 60%)',
  bipolar = false, format,
}) {
  const dragRef = useRef(null);
  const gradId  = `spring-knob-grad-${label}`;

  const onPointerDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { startY: e.clientY, startVal: value, fine: e.shiftKey };
    const onMove = (ev) => {
      const d = dragRef.current; if (!d) return;
      const dy = d.startY - ev.clientY;
      const scale = (d.fine || ev.shiftKey) ? 0.0015 : 0.0075;
      onChange(Math.max(0, Math.min(1, d.startVal + dy * scale)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [value, onChange]);

  const onDouble = useCallback((e) => { e.preventDefault(); e.stopPropagation(); onChange(defaultValue); }, [onChange, defaultValue]);

  const angle = -135 + Math.max(0, Math.min(1, value)) * 270;
  const r = size / 2, ringR = r - 3, capR = r * 0.62;

  const toXY = (a, rad) => { const rad2 = (a - 90) * Math.PI / 180; return [r + Math.cos(rad2) * rad, r + Math.sin(rad2) * rad]; };
  const makeArc = (a1, a2) => {
    if (Math.abs(a2 - a1) < 0.5) return '';
    const [x1, y1] = toXY(a1, ringR);
    const [x2, y2] = toXY(a2, ringR);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return `M ${x1} ${y1} A ${ringR} ${ringR} 0 ${large} ${sweep} ${x2} ${y2}`;
  };

  // Bipolar fills from center (0°) outward, unipolar fills from start (-135°)
  const filledStart = bipolar ? 0 : -135;
  const lo = Math.min(filledStart, angle), hi = Math.max(filledStart, angle);

  const valLabel = format
    ? format(value)
    : bipolar
      ? (Math.abs(value - 0.5) < 0.02 ? 'flat' : `${((value - 0.5) * 200).toFixed(0)}%`)
      : `${Math.round(value * 100)}%`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, userSelect: 'none' }}>
      <div style={{ fontSize: 5.5, fontFamily: '"Courier New", monospace', color: ringColor, minHeight: 10 }}>{valLabel}</div>
      <div onPointerDown={onPointerDown} onDoubleClick={onDouble}
        style={{ width: size, height: size, position: 'relative', cursor: 'ns-resize' }}
      >
        <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <radialGradient id={gradId} cx="42%" cy="38%" r="78%">
              <stop offset="0%"  stopColor="hsl(220, 14%, 24%)" />
              <stop offset="55%" stopColor="hsl(220, 18%, 14%)" />
              <stop offset="100%" stopColor="hsl(220, 22%, 6%)" />
            </radialGradient>
          </defs>
          <path d={makeArc(-135, 135)} stroke="rgba(255,255,255,0.07)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          {hi - lo > 0.5 && (
            <path d={makeArc(lo, hi)} stroke={ringColor} strokeWidth="2.4" strokeLinecap="round" fill="none"
              opacity="0.95" style={{ filter: `drop-shadow(0 0 3px ${ringColor})` }} />
          )}
          {bipolar && <line x1={r} y1={3} x2={r} y2={6} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />}
          <circle cx={r} cy={r} r={capR} fill={`url(#${gradId})`} stroke="rgba(0,0,0,0.6)" strokeWidth="0.8" />
          <circle cx={r} cy={r} r={capR - 1} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
          <g transform={`rotate(${angle} ${r} ${r})`}>
            <circle cx={r} cy={r - capR + 3} r={1.5} fill={ringColor}
              style={{ filter: `drop-shadow(0 0 2px ${ringColor})` }} />
          </g>
          <ellipse cx={r - capR * 0.2} cy={r - capR * 0.45} rx={capR * 0.5} ry={capR * 0.18}
            fill="rgba(255,255,255,0.10)" />
        </svg>
      </div>
      <div style={{ fontSize: 6.5, fontWeight: 800, letterSpacing: '0.2em', color: DIM, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

// ─── Spring SVG path generator ────────────────────────────────────────────
// Draws a coil between (x, topY) and (x, botY).
// Amplitude scales with lateral "squish" so a stretched spring looks thinner.
// shimmerAmp/shimmerPhase add a high-freq ripple driven by audio level.
function makeCoilPath(x, topY, botY, coils = 9, baseAmp = 11, shimmerAmp = 0, shimmerPhase = 0) {
  const height = botY - topY;
  const stretch = Math.max(0.3, Math.min(1, height / (coils * 14)));
  const amp    = baseAmp * Math.sqrt(stretch);
  const steps  = coils * 24;
  const pts    = [];
  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    const py = topY + t * height;
    // Main coil shape + audio shimmer (2.7× harmonic so it doesn't alias the coil)
    const px = x
      + Math.sin(t * coils * Math.PI * 2) * amp
      + Math.sin(t * coils * Math.PI * 2 * 2.7 + shimmerPhase) * shimmerAmp;
    pts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  return pts.join(' ');
}

// ─── Individual InteractiveSpring ─────────────────────────────────────────
function InteractiveSpring({ def, value, onChange, width, totalH, audioLevel = 0, shimmerPhase = 0 }) {
  // Bob position in pixels, relative to the center of the travel range.
  // Range: -TRAVEL/2 (top = min value) to +TRAVEL/2 (bottom = max value)
  const TRAVEL    = totalH * 0.62;
  const ANCHOR_Y  = totalH * 0.06;   // fixed attachment point
  const REST_Y    = ANCHOR_Y + totalH * 0.52;  // natural hang position
  const BOB_R     = 9;

  // Physics state lives in refs so we don't re-render on every frame
  const posRef    = useRef((value - 0.5) * TRAVEL);  // current bob offset from rest
  const velRef    = useRef(0);
  const targetRef = useRef((value - 0.5) * TRAVEL);  // where physics wants to settle
  const dragging  = useRef(false);
  const dragStartY = useRef(0);
  const dragStartPos = useRef(0);
  const rafRef    = useRef(null);

  // Render state — only position of the bob needs to trigger SVG re-draw
  const [bobOffset, setBobOffset] = useState((value - 0.5) * TRAVEL);

  // Sync external value → bob position when not dragging
  useEffect(() => {
    if (!dragging.current) {
      targetRef.current = (value - 0.5) * TRAVEL;
    }
  }, [value, TRAVEL]);

  // Physics loop — runs while there's motion
  const startPhysics = useCallback(() => {
    if (rafRef.current) return;
    const tick = () => {
      if (dragging.current) { rafRef.current = null; return; }
      const pos    = posRef.current;
      const vel    = velRef.current;
      const target = targetRef.current;
      const acc    = -SPRING_K * (pos - target) - SPRING_DAMP * vel;
      velRef.current = vel + acc;
      posRef.current = pos + velRef.current;
      setBobOffset(posRef.current);
      // Stop when settled
      if (Math.abs(posRef.current - target) < 0.08 && Math.abs(velRef.current) < 0.08) {
        posRef.current = target;
        velRef.current = 0;
        setBobOffset(target);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const onPointerDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragging.current    = true;
    dragStartY.current  = e.clientY;
    dragStartPos.current = posRef.current;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    const onMove = (ev) => {
      const dy  = ev.clientY - dragStartY.current;
      const raw = Math.max(-TRAVEL / 2, Math.min(TRAVEL / 2, dragStartPos.current + dy));
      posRef.current  = raw;
      velRef.current  = 0;
      setBobOffset(raw);
      // Map position → value [0,1] and notify parent
      const v = Math.max(0, Math.min(1, (raw + TRAVEL / 2) / TRAVEL));
      onChange(v);
    };
    const onUp = () => {
      dragging.current = false;
      // Snap target to current position so the spring settles there
      targetRef.current = posRef.current;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      startPhysics();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [TRAVEL, onChange, startPhysics]);

  // Double-click to reset to default
  const onDouble = useCallback(() => {
    targetRef.current = (def - 0.5) * TRAVEL;
    startPhysics();
    onChange(def);
  }, [def, TRAVEL, onChange, startPhysics]);

  const bobY       = REST_Y + bobOffset;
  const shimmerAmp = Math.min(audioLevel * 18, 5);  // max 5px shimmer at loud signal
  const coilD      = makeCoilPath(width / 2, ANCHOR_Y + 4, bobY - BOB_R - 1, 9, 11, shimmerAmp, shimmerPhase);
  const glowOp     = Math.min(1, Math.abs(bobOffset) / (TRAVEL * 0.4));

  const gradId = `bob-grad-${def.id}`;

  return (
    <svg
      width={width} height={totalH}
      style={{ display: 'block', cursor: 'ns-resize', overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={gradId} cx="38%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="hsl(220,14%,32%)" />
          <stop offset="100%" stopColor="hsl(220,18%,10%)" />
        </radialGradient>
      </defs>
      {/* Anchor bolt */}
      <rect x={width/2 - 4} y={ANCHOR_Y - 3} width={8} height={6} rx={1.5}
        fill="hsl(220,12%,22%)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
      <line x1={width/2} y1={ANCHOR_Y + 3} x2={width/2} y2={ANCHOR_Y + 8}
        stroke="rgba(255,255,255,0.18)" strokeWidth="1" />

      {/* Coil glow — blooms as you pull */}
      {glowOp > 0.05 && (
        <path d={coilD} stroke={def.glow ?? 'rgba(100,220,150,0.3)'} strokeWidth={5}
          fill="none" strokeLinecap="round" opacity={glowOp * 0.7} />
      )}
      {/* Coil shadow */}
      <path d={coilD} stroke="rgba(0,0,0,0.5)" strokeWidth={3.5}
        fill="none" strokeLinecap="round" transform="translate(0.5,1)" />
      {/* Coil */}
      <path d={coilD} stroke={def.color} strokeWidth={2}
        fill="none" strokeLinecap="round" />

      {/* Bob glow ring */}
      {glowOp > 0.05 && (
        <circle cx={width/2} cy={bobY} r={BOB_R + 4}
          fill="none" stroke={def.glow} strokeWidth={2} opacity={glowOp * 0.6} />
      )}
      {/* Bob shadow */}
      <circle cx={width/2 + 0.8} cy={bobY + 1} r={BOB_R} fill="rgba(0,0,0,0.4)" />
      {/* Bob */}
      <circle cx={width/2} cy={bobY} r={BOB_R}
        fill={`url(#${gradId})`}
        stroke={def.color} strokeWidth={1.5}
        onPointerDown={onPointerDown}
        onDoubleClick={onDouble}
        style={{ cursor: 'grab' }}
      />
      {/* Bob highlight */}
      <circle cx={width/2 - 2.5} cy={bobY - 2.5} r={2.5}
        fill="rgba(255,255,255,0.18)" style={{ pointerEvents: 'none' }} />

      {/* Value readout below bob */}
      <text x={width/2} y={bobY + BOB_R + 12}
        fontSize="8" fontFamily='"Courier New", monospace'
        fontWeight="600" textAnchor="middle"
        fill={def.color} opacity="0.9"
        style={{ pointerEvents: 'none' }}
      >
        {def.id === 'decay'
          ? `${(0.6 + value * 3.4).toFixed(1)}s`
          : `${Math.round(value * 100)}%`}
      </text>

      {/* Label at bottom */}
      <text x={width/2} y={totalH - 4}
        fontSize="7" fontFamily='"Courier New", monospace'
        fontWeight="800" letterSpacing="2" textAnchor="middle"
        fill={DIM} style={{ pointerEvents: 'none' }}
      >{def.label}</text>
    </svg>
  );
}

// ─── Main module ─────────────────────────────────────────────────────────
export default function SpringReverbOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const [decay,    setDecay   ] = useState(initialState?.decay    ?? 0.38);
  const [wobble,   setWobble  ] = useState(initialState?.wobble   ?? 0.35);
  const [mix,      setMix     ] = useState(initialState?.mix      ?? 0.30);
  const [tone,     setTone    ] = useState(initialState?.tone     ?? 0.5);
  const [inGain,   setInGainN ] = useState(initialState?.inGain   ?? 0.5);  // 0..1 → 0..2 linear
  const [outGain,  setOutGainN] = useState(initialState?.outGain  ?? 0.5);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);

  const [inLevel,      setInLevel     ] = useState(0);
  const [outLevel,     setOutLevel    ] = useState(0);
  const [inPeak,       setInPeak      ] = useState(0);
  const [outPeak,      setOutPeak     ] = useState(0);
  const [shimmerPhase, setShimmerPhase] = useState(0);

  const engineRef    = useRef(null);
  const animRef      = useRef(null);
  const shimmerRef   = useRef(0);

  const stateRefs = {
    decay:    useRef(decay),
    wobble:   useRef(wobble),
    mix:      useRef(mix),
    tone:     useRef(tone),
    inGain:   useRef(inGain),
    outGain:  useRef(outGain),
    bypassed: useRef(bypassed),
  };
  stateRefs.decay.current    = decay;
  stateRefs.wobble.current   = wobble;
  stateRefs.mix.current      = mix;
  stateRefs.tone.current     = tone;
  stateRefs.inGain.current   = inGain;
  stateRefs.outGain.current  = outGain;
  stateRefs.bypassed.current = bypassed;

  useEffect(() => {
    onStateChange?.(instanceId, { decay, wobble, mix, tone, inGain, outGain, bypassed });
  }, [decay, wobble, mix, tone, inGain, outGain, bypassed]); // eslint-disable-line

  useEffect(() => {
    if (!sharedSource) return;
    const engine = createSpringReverbEngine(sharedSource.ctx);
    engineRef.current = engine;

    engine.setDecay(stateRefs.decay.current);
    engine.setWobble(stateRefs.wobble.current);
    engine.setMix(stateRefs.mix.current);
    engine.setTone(stateRefs.tone.current);
    engine.setInputGain(stateRefs.inGain.current * 2);
    engine.setOutputGain(stateRefs.outGain.current * 2);
    engine.setBypass(stateRefs.bypassed.current);

    registerEngine(instanceId, engine);

    let tick = 0;
    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      shimmerRef.current += 0.15;
      setShimmerPhase(shimmerRef.current);
      if (++tick % 2 !== 0) return;
      const e = engineRef.current; if (!e) return;
      setInLevel(e.getInputLevel());
      setOutLevel(e.getOutputLevel());
      setInPeak(e.getInputPeak());
      setOutPeak(e.getOutputPeak());
    };
    loop();

    return () => {
      cancelAnimationFrame(animRef.current);
      unregisterEngine(instanceId);
      engine.destroy();
      engineRef.current = null;
    };
  }, [sharedSource]); // eslint-disable-line

  useEffect(() => { engineRef.current?.setDecay(decay);                  }, [decay]);
  useEffect(() => { engineRef.current?.setWobble(wobble);                }, [wobble]);
  useEffect(() => { engineRef.current?.setMix(mix);                      }, [mix]);
  useEffect(() => { engineRef.current?.setTone(tone);                    }, [tone]);
  useEffect(() => { engineRef.current?.setInputGain(inGain * 2);         }, [inGain]);
  useEffect(() => { engineRef.current?.setOutputGain(outGain * 2);       }, [outGain]);
  useEffect(() => { engineRef.current?.setBypass(bypassed);              }, [bypassed]);

  // Panel width matches Scope/Space orbs
  const W       = 380;
  const TANK_H  = 220;
  const SPRING_W = W / 3;

  return (
    <>
      <div style={{
        width: W,
        height: 500,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        userSelect: 'none',
        borderRadius: 6,
        overflow: 'hidden',
        background: BG,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 28px rgba(0,0,0,0.7)`,
      }}>

        {/* Header */}
        <div style={{
          flexShrink: 0,
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: '6px 10px 5px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 14, fontWeight: 900, color: CREAM,
              letterSpacing: '0.12em', fontFamily: 'Georgia, serif', fontStyle: 'italic',
            }}>Wabble</span>
            <span style={{
              fontSize: 7, color: 'rgba(255,255,255,0.28)',
              letterSpacing: '0.24em', textTransform: 'uppercase', fontWeight: 700,
            }}>Spring</span>
          </div>
          <div />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setBypassed(b => !b)} style={{
              fontSize: 8, fontWeight: 800, padding: '2px 6px',
              borderRadius: 2, cursor: 'pointer', letterSpacing: '0.1em',
              ...(bypassed
                ? { background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)' }
                : { background: 'hsl(140,65%,35%)', border: '1px solid rgba(0,0,0,0.5)', color: 'hsl(140,70%,85%)', boxShadow: '0 0 6px hsl(140,65%,35%)' })
            }}>{bypassed ? 'BYP' : 'ON'}</button>
            {onRemove && (
              <button onClick={onRemove} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,0,0,0.5)',
                color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>×</button>
            )}
          </div>
        </div>

        {/* Tank window — the main interactive area */}
        <div style={{
          position: 'relative',
          flex: 1, minHeight: 0,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(100,200,150,0.04) 0%, rgba(0,0,0,0) 70%)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          overflow: 'hidden',
        }}>

          {/* Matrix grid */}
          <svg width={W} height={TANK_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {Array.from({ length: 12 }, (_, i) => (
              <line key={`v${i}`} x1={(i + 1) * (W / 13)} y1={0} x2={(i + 1) * (W / 13)} y2={TANK_H}
                stroke={GRID} strokeWidth="1" />
            ))}
            {Array.from({ length: 8 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(i + 1) * (TANK_H / 9)} x2={W} y2={(i + 1) * (TANK_H / 9)}
                stroke={GRID} strokeWidth="1" />
            ))}
            {/* Divider lines between spring columns */}
            <line x1={SPRING_W}     y1={8} x2={SPRING_W}     y2={TANK_H - 8} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 4" />
            <line x1={SPRING_W * 2} y1={8} x2={SPRING_W * 2} y2={TANK_H - 8} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 4" />
          </svg>

          {/* Three springs */}
          {SPRING_DEFS.map((def, i) => {
            const val = i === 0 ? decay : i === 1 ? wobble : mix;
            const setter = i === 0 ? setDecay : i === 1 ? setWobble : setMix;
            return (
              <div key={def.id} style={{
                position: 'absolute',
                left: i * SPRING_W, top: 0,
                width: SPRING_W, height: TANK_H,
              }}>
                <InteractiveSpring
                  def={def}
                  value={val}
                  onChange={setter}
                  width={SPRING_W}
                  totalH={TANK_H}
                  audioLevel={inLevel}
                  shimmerPhase={shimmerPhase}
                />
              </div>
            );
          })}
        </div>

        {/* Knob row — IN / TONE / OUT */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-around',
          padding: '10px 14px 9px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
          <SpringKnob
            label="IN"
            value={inGain}
            onChange={setInGainN}
            defaultValue={0.5}
            ringColor="hsl(196, 80%, 58%)"
            format={v => `${(v * 200).toFixed(0)}%`}
          />
          <SpringKnob
            label="TONE"
            value={tone}
            onChange={setTone}
            defaultValue={0.5}
            bipolar
            ringColor="hsl(46, 90%, 60%)"
            format={v => {
              const dB = (v - 0.5) * 22;
              return Math.abs(dB) < 0.5 ? 'flat' : dB > 0 ? `+${dB.toFixed(0)}dB` : `${dB.toFixed(0)}dB`;
            }}
          />
          <SpringKnob
            label="OUT"
            value={outGain}
            onChange={setOutGainN}
            defaultValue={0.5}
            ringColor="hsl(140, 70%, 52%)"
            format={v => `${(v * 200).toFixed(0)}%`}
          />
        </div>

        {/* Clip meter */}
        <ClipMeter inRms={inLevel} inPeak={inPeak} outRms={outLevel} outPeak={outPeak} />
      </div>
    </>
  );
}
