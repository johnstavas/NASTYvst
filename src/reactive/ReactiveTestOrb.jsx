// ReactiveTestOrb — VALIDATION RIG, not a production plugin.
//
// One surface, one knob (drive), one mute. Every visual change is layered from
// useReactiveCore signals — no inline reactive math, no copy-paste from existing
// plugins. The point is to see whether the named signals feel correct when
// combined.
//
// Visual layering map (read this alongside the file):
//
//   core circle    : radius     = base + boom * thump            (BOOM)
//                    scale      = 1 + transient * 0.18           (TRANSIENT)
//                    color hue  = lerp(cyan → red, rage)         (RAGE)
//                    brightness = 0.35 + energy * 0.65           (ENERGY)
//                    drop-shadow: 4 layers, radii scale with
//                                 energy + pulse*rage*1.5        (ENERGY × PULSE × RAGE)
//
//   outer ring     : opacity    = 0.25 + pulse * 0.35            (PULSE alone)
//                    blur       = 8 + rage * 40                  (RAGE)
//
//   transient flash: ring stroke alpha spikes with transient     (TRANSIENT)
//
//   readout panel  : five numeric bars showing each raw signal so you can
//                    correlate the felt visual with the actual values.

import React, { useEffect, useRef, useState } from 'react';
import { useReactiveCore } from './useReactiveCore.js';
import { createReactiveTestEngine } from './reactiveTestEngine.js';

export default function ReactiveTestOrb({ sharedSource, registerEngine, unregisterEngine, instanceId = 'reactive-test' }) {
  const engineRef = useRef(null);
  const coreRef   = useRef(null);   // SVG ring + circle wrapper
  const ringRef   = useRef(null);
  const circleRef = useRef(null);
  const barsRef   = useRef([]);     // five bar fill rects

  const [drive, setDrive] = useState(0);

  // ── engine lifecycle (matches the existing shell pattern) ─────────────────
  useEffect(() => {
    if (!sharedSource) return;
    let alive = true;
    (async () => {
      const eng = createReactiveTestEngine(sharedSource.ctx);
      if (!alive) { eng.dispose(); return; }
      engineRef.current = eng;
      registerEngine?.(instanceId, eng);
    })();
    return () => {
      alive = false;
      unregisterEngine?.(instanceId);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [sharedSource]);

  // ── reactive core, with onTick that owns all DOM mutation ─────────────────
  const core = useReactiveCore(engineRef, {
    onTick: (s) => {
      const circle = circleRef.current;
      const ring   = ringRef.current;
      if (!circle || !ring) return;

      // BOOM: radius thump (felt, not seen — use sparingly)
      const baseR = 70;
      const r     = baseR + s.boom * 22;

      // TRANSIENT: brief scale spike
      const scale = 1 + Math.min(0.18, s.transient * 0.45);

      // RAGE: color lerp cyan → red
      const t   = s.rage;
      const r8  = Math.round( 90  + (255 -  90) * t);
      const g8  = Math.round(220  + ( 70 - 220) * t);
      const b8  = Math.round(220  + ( 60 - 220) * t);
      const fill = `rgba(${r8},${g8},${b8},${(0.35 + s.energy * 0.65).toFixed(3)})`;

      // ENERGY × PULSE × RAGE: layered drop-shadow bloom
      const heat = Math.min(1, s.energy + s.pulse * s.rage * 1.5);
      const r0 = 6  + heat * 14;   // hot core
      const r1 = 18 + heat * 40;   // tight bloom
      const r2 = 38 + heat * 90;   // wide bloom
      const r3 = 70 + heat * 180;  // corona
      const a0 = Math.min(0.99, 0.35 + heat * 0.55);
      const a1 = Math.min(0.99, 0.20 + heat * 0.55);
      const a2 = Math.min(0.99, 0.10 + heat * 0.45);
      const a3 = Math.min(0.99, 0.05 + heat * 0.35);

      circle.setAttribute('r', r);
      circle.setAttribute('fill', fill);
      circle.style.transform = `scale(${scale})`;
      circle.style.transformOrigin = '50% 50%';
      circle.style.filter =
        `drop-shadow(0 0 ${r0}px rgba(255,255,255,${a0}))` +
        ` drop-shadow(0 0 ${r1}px rgba(${r8},${g8},${b8},${a1}))` +
        ` drop-shadow(0 0 ${r2}px rgba(${r8},${g8},${b8},${a2}))` +
        ` drop-shadow(0 0 ${r3}px rgba(${r8},${g8},${b8},${a3}))`;

      // PULSE: outer ring opacity breathing, RAGE: ring blur
      const ringOpacity = (0.25 + Math.max(0, s.pulse) * 0.35).toFixed(3);
      const ringBlur    = 8 + s.rage * 40;
      const trFlash     = Math.min(0.95, s.transient * 1.6);
      ring.style.opacity = ringOpacity;
      ring.style.filter  = `blur(${ringBlur * 0.05}px) drop-shadow(0 0 ${ringBlur}px rgba(${r8},${g8},${b8},${trFlash.toFixed(3)}))`;

      // ── readout bars: raw signal values, normalized and clamped ──────────
      const vals = [
        Math.min(1, s.energy),
        (s.pulse + 1.6) / 3.2,        // pulse is bipolar-ish, map to 0..1
        s.rage,
        Math.min(1, s.boom),
        Math.min(1, s.transient * 4), // transient is small; visually amplify
      ];
      const bars = barsRef.current;
      for (let i = 0; i < bars.length; i++) {
        if (bars[i]) bars[i].setAttribute('width', `${(vals[i] * 100).toFixed(1)}%`);
      }
    },
  });

  // Drive knob → engine + reactive-core (rage is parameter-driven)
  const onDrive = (v) => {
    setDrive(v);
    engineRef.current?.setDrive(v);
    core.setDrive(v);
  };

  // ── render ────────────────────────────────────────────────────────────────
  const labels = ['energy', 'pulse', 'rage', 'boom', 'transient'];
  const colors = ['#7fdfff', '#bfbfff', '#ff8060', '#ffd060', '#ffffff'];

  return (
    <div style={{
      width: 360, padding: 16, borderRadius: 12,
      background: 'rgba(10,14,18,0.85)',
      border: '1px solid rgba(255,255,255,0.08)',
      fontFamily: '"Courier New", monospace', color: '#cfd8e0',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
        REACTIVE CORE — VALIDATION
      </div>

      <div ref={coreRef} style={{ position: 'relative', height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 320 240" width="320" height="240" style={{ overflow: 'visible' }}>
          <circle ref={ringRef} cx="160" cy="120" r="100"
            fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2"
            style={{ transition: 'none' }} />
          <circle ref={circleRef} cx="160" cy="120" r="70"
            fill="rgba(120,220,220,0.5)"
            style={{ transition: 'none', willChange: 'filter,transform' }} />
        </svg>
      </div>

      {/* drive knob — keep minimal: a slider, not a hand-drawn knob */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.7 }}>
          <span>DRIVE</span><span>{(drive * 100).toFixed(0)}%</span>
        </div>
        <input type="range" min="0" max="1" step="0.001" value={drive}
          onChange={(e) => onDrive(parseFloat(e.target.value))}
          style={{ width: '100%' }} />
      </div>

      {/* readout bars */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {labels.map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9 }}>
            <span style={{ width: 64, color: colors[i], opacity: 0.85 }}>{label}</span>
            <svg width="100%" height="8" style={{ flex: 1 }}>
              <rect x="0" y="0" width="100%" height="8" fill="rgba(255,255,255,0.06)" rx="2" />
              <rect ref={el => barsRef.current[i] = el} x="0" y="0" width="0%" height="8"
                fill={colors[i]} opacity="0.85" rx="2" />
            </svg>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, fontSize: 8, opacity: 0.45, lineHeight: 1.4 }}>
        Load audio. Push DRIVE to see rage independent of signal.<br/>
        Pulse breathes on idle. Boom thumps with low end. Transient flashes the ring.
      </div>
    </div>
  );
}
