import { useState, useEffect, useRef, useCallback } from 'react';
import { createFinisherEngine } from './finisherEngine';
import PresetSelector from './PresetSelector';

// ─── FINISHER: Premium Mastering Console ─────────────────────────────────
// Brushed aluminum, real-time spectrum analyzer, stepped attenuators,
// motorized console faders with LED strips, toggle bypass switch,
// LUFS readout, phase meter, Lissajous scope.

// Brushed aluminum texture
const BRUSHED_AL = `
  repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 0.5px,
    rgba(180,180,195,0.03) 0.5px,
    rgba(180,180,195,0.03) 1px
  )
`;

// ─── Real-Time Spectrum Analyzer Canvas ──────────────────────────────────
function SpectrumAnalyzer({ engineRef, signalLevel }) {
  const canvasRef = useRef(null);
  const fftDataRef = useRef(null);
  const peakHoldRef = useRef(null);
  const peakDecayRef = useRef(null);
  const rmsHistoryRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 280, H = 80;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    const NUM_BARS = 48;
    if (!peakHoldRef.current) peakHoldRef.current = new Float32Array(NUM_BARS);
    if (!peakDecayRef.current) peakDecayRef.current = new Float32Array(NUM_BARS);

    // Log frequency mapping (20Hz to 20kHz)
    const freqMap = [];
    const minF = Math.log10(20), maxF = Math.log10(20000);
    for (let i = 0; i < NUM_BARS; i++) {
      const f = Math.pow(10, minF + (i / (NUM_BARS - 1)) * (maxF - minF));
      freqMap.push(f);
    }

    // Frequency grid labels
    const gridFreqs = [100, 1000, 5000, 10000, 20000];
    const gridLabels = ['100', '1k', '5k', '10k', '20k'];

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = '#08080c';
      ctx.fillRect(0, 0, W, H);

      // Get FFT data from engine analyser
      const eng = engineRef.current;
      let fftData = null;
      if (eng && eng.analyserOut) {
        if (!fftDataRef.current) {
          fftDataRef.current = new Uint8Array(eng.analyserOut.frequencyBinCount);
        }
        eng.analyserOut.getByteFrequencyData(fftDataRef.current);
        fftData = fftDataRef.current;
      }

      // Draw grid lines
      ctx.strokeStyle = 'rgba(180,180,195,0.06)';
      ctx.lineWidth = 0.5;
      // Horizontal grid (dB levels)
      for (let i = 1; i <= 4; i++) {
        const y = (i / 5) * H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      // Vertical grid (frequency markers)
      for (let g = 0; g < gridFreqs.length; g++) {
        const fLog = (Math.log10(gridFreqs[g]) - minF) / (maxF - minF);
        const x = fLog * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        // Frequency label
        ctx.fillStyle = 'rgba(180,180,195,0.2)';
        ctx.font = '4px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(gridLabels[g], x, H - 2);
      }

      const barW = (W - 4) / NUM_BARS - 0.8;
      const sampleRate = eng?.analyserOut ? (eng.analyserOut.context?.sampleRate || 44100) : 44100;
      const binCount = fftData ? fftData.length : 1024;

      // RMS line data
      let rmsSum = 0;
      let rmsCount = 0;

      for (let i = 0; i < NUM_BARS; i++) {
        let value = 0;
        if (fftData) {
          // Map log-frequency bar to FFT bin
          const freq = freqMap[i];
          const bin = Math.round(freq * binCount * 2 / sampleRate);
          const binClamped = Math.min(bin, binCount - 1);
          // Average a few bins for smoothing
          let sum = 0, count = 0;
          const spread = Math.max(1, Math.floor(binClamped * 0.1));
          for (let b = Math.max(0, binClamped - spread); b <= Math.min(binCount - 1, binClamped + spread); b++) {
            sum += fftData[b];
            count++;
          }
          value = count > 0 ? sum / count / 255 : 0;
        }

        rmsSum += value * value;
        rmsCount++;

        const barH = value * (H - 10);
        const x = 2 + i * ((W - 4) / NUM_BARS);
        const y = H - barH;

        // Bar gradient (brighter at top)
        if (barH > 0.5) {
          const grad = ctx.createLinearGradient(x, y, x, H);
          grad.addColorStop(0, `rgba(230,232,245,${0.6 + value * 0.4})`);
          grad.addColorStop(0.3, `rgba(200,205,220,${0.4 + value * 0.3})`);
          grad.addColorStop(0.7, `rgba(160,165,185,${0.25 + value * 0.15})`);
          grad.addColorStop(1, `rgba(120,125,150,${0.1})`);
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, barW, barH);

          // Reflection below (mirror, 30% opacity)
          const reflGrad = ctx.createLinearGradient(x, H, x, H + barH * 0.3);
          reflGrad.addColorStop(0, `rgba(200,205,220,${0.08 * value})`);
          reflGrad.addColorStop(1, 'rgba(200,205,220,0)');
          ctx.fillStyle = reflGrad;
          ctx.fillRect(x, H, barW, barH * 0.3);
        }

        // Peak hold dot
        if (value > peakHoldRef.current[i]) {
          peakHoldRef.current[i] = value;
          peakDecayRef.current[i] = 0;
        } else {
          peakDecayRef.current[i] += 0.003;
          peakHoldRef.current[i] -= peakDecayRef.current[i] * 0.02;
          if (peakHoldRef.current[i] < 0) peakHoldRef.current[i] = 0;
        }
        const peakY = H - peakHoldRef.current[i] * (H - 10);
        if (peakHoldRef.current[i] > 0.01) {
          ctx.fillStyle = `rgba(255,255,255,${0.5 + peakHoldRef.current[i] * 0.5})`;
          ctx.fillRect(x, peakY - 1, barW, 1.5);
        }
      }

      // RMS line overlay
      const rmsLevel = rmsCount > 0 ? Math.sqrt(rmsSum / rmsCount) : 0;
      const rmsY = H - rmsLevel * (H - 10);
      ctx.beginPath();
      ctx.moveTo(0, rmsY);
      ctx.lineTo(W, rmsY);
      ctx.strokeStyle = `rgba(255,200,100,${0.25 + rmsLevel * 0.3})`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 280, height: 80, display: 'block' }} />;
}

// ─── Stepped Attenuator Knob ─────────────────────────────────────────────
function SteppedAttenuator({ size = 28, norm = 0 }) {
  const cx = size / 2 + 4, cy = size / 2 + 4;
  const r = size / 2 - 2;
  const id = useRef(`sa-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  const steps = 24;

  // Active step index
  const activeStep = Math.round(norm * steps);

  // Pointer line
  const lx1 = cx + r * 0.15 * Math.cos(rad);
  const ly1 = cy + r * 0.15 * Math.sin(rad);
  const lx2 = cx + r * 0.85 * Math.cos(rad);
  const ly2 = cy + r * 0.85 * Math.sin(rad);

  const detents = [];
  for (let i = 0; i <= steps; i++) {
    const stepNorm = i / steps;
    const stepAngle = (-135 + stepNorm * 270 - 90) * Math.PI / 180;
    const isActive = i === activeStep;
    const dx = cx + Math.cos(stepAngle) * (r + 4);
    const dy = cy + Math.sin(stepAngle) * (r + 4);
    detents.push(
      <circle key={i} cx={dx} cy={dy}
        r={isActive ? 1.2 : 0.5}
        fill={isActive ? '#ffffff' : 'rgba(180,180,195,0.2)'}
        style={isActive ? { filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.6))' } : {}}
      />
    );
  }

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-b`} cx="35%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#d0d0d8" />
          <stop offset="25%" stopColor="#808088" />
          <stop offset="60%" stopColor="#404048" />
          <stop offset="85%" stopColor="#1a1a20" />
          <stop offset="100%" stopColor="#101014" />
        </radialGradient>
        <radialGradient id={`${id}-spec`} cx="30%" cy="20%" r="40%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.5)" />
        </filter>
      </defs>
      {/* Detent markers */}
      {detents}
      {/* Knob body */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-b)`} filter={`url(#${id}-sh)`} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-spec)`} />
      {/* Engraved edge ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(200,200,215,0.12)" strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={r * 0.7} fill="none" stroke="rgba(180,180,195,0.08)" strokeWidth={0.3} />
      {/* Pointer line */}
      <line x1={lx1} y1={ly1} x2={lx2} y2={ly2}
        stroke="#ffffff" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 28, format, sensitivity = 160 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 24, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <SteppedAttenuator size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: size <= 22 ? 5 : 6, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#a0a0a8', fontWeight: 600, textAlign: 'center', width: '100%',
        lineHeight: 1.2, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      }}>{label}</span>
      {/* LCD-style digital readout */}
      <div style={{
        fontSize: size <= 22 ? 5 : 5.5,
        color: '#c0d0e0',
        fontFamily: '"Courier New", monospace', fontWeight: 700,
        textAlign: 'center', width: '100%',
        background: 'rgba(0,5,15,0.5)',
        border: '0.5px solid rgba(100,120,150,0.15)',
        borderRadius: 1, padding: '0.5px 2px',
        letterSpacing: '0.05em',
      }}>{display}</div>
    </div>
  );
}

// ─── Motorized Console Fader ─────────────────────────────────────────────
function ConsoleFader({ label, value, onChange, min = 0, max = 1, defaultValue, format, sensitivity = 1.5 }) {
  const ref = useRef({ x: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;
  const trackWidth = 240;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { x: e.clientX, v: value };
    const onMove = ev => {
      const dx = ev.clientX - ref.current.x;
      onChange(Math.max(min, Math.min(max, ref.current.v + dx * (max - min) / (trackWidth * sensitivity))));
    };
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  // LED strip segments
  const LED_COUNT = 20;
  const litLeds = Math.round(norm * LED_COUNT);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none', position: 'relative', zIndex: 2, padding: '0 14px' }}>
      <span style={{
        fontSize: 6.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: '#a0a0a8', fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
        width: 36, textAlign: 'right', flexShrink: 0,
      }}>{label}</span>
      <div
        onPointerDown={onDown}
        onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{
          flex: 1, height: 20, position: 'relative', cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        {/* Recessed fader channel/groove */}
        <div style={{
          position: 'absolute', top: 6, left: 0, right: 0, height: 8,
          background: '#06060a',
          borderRadius: 2,
          border: '1px solid rgba(30,30,40,0.8)',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 2px rgba(0,0,0,0.3)',
        }} />
        {/* LED strip along the slot */}
        <div style={{
          position: 'absolute', top: 7, left: 2, right: 2, height: 6,
          display: 'flex', gap: 1.2, alignItems: 'center',
        }}>
          {Array.from({ length: LED_COUNT }).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 0.5,
              background: i < litLeds
                ? `rgba(220,225,245,${0.3 + (i / LED_COUNT) * 0.5})`
                : 'rgba(180,180,195,0.04)',
              boxShadow: i < litLeds ? `0 0 3px rgba(220,225,245,${0.15 + (i / LED_COUNT) * 0.2})` : 'none',
              transition: 'background 0.05s',
            }} />
          ))}
        </div>
        {/* Fader cap — wide flat metallic rectangle */}
        <div style={{
          position: 'absolute', top: 2, height: 16,
          left: `calc(${norm * 100}% - 10px)`,
          width: 20, borderRadius: 2,
          background: `linear-gradient(180deg,
            #c8c8d0 0%, #b0b0b8 15%, #909098 30%,
            #808088 50%, #909098 70%, #b0b0b8 85%, #c8c8d0 100%)`,
          boxShadow: `
            0 0 8px rgba(220,220,240,0.12),
            0 2px 6px rgba(0,0,0,0.5),
            inset 0 1px 0 rgba(255,255,255,0.25),
            inset 0 -1px 0 rgba(0,0,0,0.2)
          `,
          border: '0.5px solid rgba(255,255,255,0.15)',
          transition: dragging ? 'none' : 'left 0.02s',
        }}>
          {/* Grip texture — tiny horizontal lines */}
          <div style={{
            position: 'absolute', inset: 3, borderRadius: 1,
            background: `repeating-linear-gradient(
              0deg,
              transparent 0px, transparent 1.5px,
              rgba(0,0,0,0.08) 1.5px, rgba(0,0,0,0.08) 2px
            )`,
          }} />
          {/* Center groove */}
          <div style={{
            position: 'absolute', top: '50%', left: 4, right: 4,
            height: 0.5, background: 'rgba(0,0,0,0.2)',
            transform: 'translateY(-50%)',
          }} />
        </div>
      </div>
      {/* LCD readout for fader value */}
      <div style={{
        fontSize: 6, color: '#c0d0e0',
        fontFamily: '"Courier New", monospace', fontWeight: 700,
        width: 32, textAlign: 'left', flexShrink: 0,
        background: 'rgba(0,5,15,0.5)',
        border: '0.5px solid rgba(100,120,150,0.15)',
        borderRadius: 1, padding: '1px 3px',
        letterSpacing: '0.05em',
      }}>{display}</div>
    </div>
  );
}

// ─── Wide Horizontal LED Meter Bar ───────────────────────────────────────
const HMETER_SEGMENTS = 40;
function HLedMeterDom({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{
      display: 'flex', gap: 1, height: 16, width: '100%',
      background: '#08080c', padding: '3px 3px', borderRadius: 2,
      border: '1px solid rgba(180,180,195,0.06)',
      position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: HMETER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: 0.5,
          background: 'rgba(180,180,195,0.04)',
        }} />
      ))}
    </div>
  );
}

function updateHMeter(segmentEls, level) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < HMETER_SEGMENTS; i++) {
    const threshDb = -40 + (i / HMETER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= HMETER_SEGMENTS - 3 ? '#ff4040' : i >= HMETER_SEGMENTS - 6 ? 'rgba(255,200,180,0.5)' : 'rgba(220,220,230,0.5)';
    segmentEls[i].style.background = lit ? col : 'rgba(180,180,195,0.04)';
  }
}

// ─── Toggle Bypass Switch ────────────────────────────────────────────────
function ToggleSwitch({ active, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 0,
      cursor: 'pointer', userSelect: 'none', position: 'relative',
    }}>
      {/* Track */}
      <div style={{
        width: 52, height: 16, borderRadius: 3, position: 'relative',
        background: `linear-gradient(180deg,
          #0a0a0e 0%, #14141a 40%, #0e0e14 100%)`,
        border: '1px solid rgba(180,180,195,0.12)',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
        transition: 'all 0.2s ease',
      }}>
        {/* Labels */}
        <span style={{
          position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
          fontSize: 4.5, fontWeight: 700, letterSpacing: '0.1em',
          color: active ? 'rgba(160,160,170,0.2)' : 'rgba(160,160,170,0.5)',
          fontFamily: 'system-ui', transition: 'color 0.2s',
        }}>BYP</span>
        <span style={{
          position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)',
          fontSize: 4.5, fontWeight: 700, letterSpacing: '0.1em',
          color: active ? 'rgba(200,210,230,0.7)' : 'rgba(160,160,170,0.2)',
          fontFamily: 'system-ui', transition: 'color 0.2s',
        }}>ON</span>
        {/* Slider knob */}
        <div style={{
          position: 'absolute', top: 1, bottom: 1,
          left: active ? 30 : 2,
          width: 20, borderRadius: 2,
          background: `linear-gradient(180deg,
            #c0c0c8 0%, #a0a0a8 30%, #808088 60%, #a0a0a8 80%, #c0c0c8 100%)`,
          boxShadow: `
            0 1px 4px rgba(0,0,0,0.4),
            inset 0 1px 0 rgba(255,255,255,0.25),
            inset 0 -1px 0 rgba(0,0,0,0.15)
          `,
          border: '0.5px solid rgba(255,255,255,0.1)',
          transition: 'left 0.15s ease',
        }}>
          {/* LED strip on knob */}
          <div style={{
            position: 'absolute', top: 5, left: 4, right: 4, height: 2,
            borderRadius: 1,
            background: active ? '#ffffff' : 'rgba(180,180,195,0.1)',
            boxShadow: active ? '0 0 6px rgba(255,255,255,0.5), 0 0 12px rgba(200,210,240,0.25)' : 'none',
            transition: 'all 0.2s ease',
          }} />
        </div>
      </div>
    </div>
  );
}

// ─── LUFS Readout ────────────────────────────────────────────────────────
function LufsReadout({ level }) {
  // Approximate LUFS from RMS level
  const lufs = level > 1e-6 ? 20 * Math.log10(level) - 10 : -99;
  const display = lufs > -60 ? lufs.toFixed(1) : '--.-';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
    }}>
      <div style={{
        background: 'rgba(0,5,15,0.7)',
        border: '0.5px solid rgba(100,120,150,0.2)',
        borderRadius: 2, padding: '2px 6px',
        display: 'flex', alignItems: 'baseline', gap: 2,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700,
          fontFamily: '"Courier New", monospace',
          color: '#c0d8f0',
          letterSpacing: '0.02em',
        }}>{display}</span>
        <span style={{
          fontSize: 4.5, fontWeight: 700,
          color: 'rgba(160,180,210,0.5)',
          fontFamily: 'system-ui',
          letterSpacing: '0.1em',
        }}>LUFS</span>
      </div>
    </div>
  );
}

// ─── Phase Correlation Meter ─────────────────────────────────────────────
function PhaseMeter() {
  // Decorative — shows center (mono-compatible)
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    }}>
      <div style={{
        width: 50, height: 5, borderRadius: 1,
        background: '#06060a',
        border: '0.5px solid rgba(180,180,195,0.08)',
        position: 'relative',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
      }}>
        {/* Center marker */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: '50%', width: 0.5,
          background: 'rgba(180,180,195,0.2)',
          transform: 'translateX(-50%)',
        }} />
        {/* Phase indicator dot */}
        <div style={{
          position: 'absolute', top: 1, bottom: 1,
          left: 'calc(50% + 4px)', width: 4, borderRadius: 1,
          background: 'rgba(100,220,160,0.5)',
          boxShadow: '0 0 4px rgba(100,220,160,0.3)',
        }} />
        {/* L/R labels */}
        <span style={{
          position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)',
          fontSize: 3.5, color: 'rgba(180,180,195,0.3)', fontWeight: 700, fontFamily: 'system-ui',
        }}>L</span>
        <span style={{
          position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)',
          fontSize: 3.5, color: 'rgba(180,180,195,0.3)', fontWeight: 700, fontFamily: 'system-ui',
        }}>R</span>
      </div>
      <span style={{
        fontSize: 3.5, color: 'rgba(180,180,195,0.25)',
        fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.15em',
      }}>PHASE</span>
    </div>
  );
}

// ─── Lissajous Scope (decorative tiny) ───────────────────────────────────
function LissajousScope() {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 24; canvas.height = 24;

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, 24, 24);
      ctx.fillStyle = '#06060a';
      ctx.fillRect(0, 0, 24, 24);
      phaseRef.current += 0.03;
      const p = phaseRef.current;
      // Decorative Lissajous figure
      ctx.beginPath();
      for (let t = 0; t < Math.PI * 2; t += 0.1) {
        const x = 12 + Math.sin(t + p * 0.3) * 8;
        const y = 12 + Math.sin(t * 1.5 + p * 0.2) * 8;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(100,220,160,0.25)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Center dot
      ctx.beginPath();
      ctx.arc(12 + Math.sin(p * 0.5) * 2, 12 + Math.cos(p * 0.4) * 2, 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100,220,160,0.5)';
      ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} style={{
        width: 12, height: 12, display: 'block',
        border: '0.5px solid rgba(180,180,195,0.08)',
        borderRadius: 1,
      }} />
      <span style={{
        position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)',
        fontSize: 3, color: 'rgba(180,180,195,0.2)', fontWeight: 600,
        fontFamily: 'system-ui', letterSpacing: '0.1em', whiteSpace: 'nowrap',
      }}>XY</span>
    </div>
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',         finish: 0.3, width: 0.5, polish: 0.3, tone: 0.5, loud: 0,   mix: 1 },
  { name: 'GENTLE',       finish: 0.15,width: 0.4, polish: 0.2, tone: 0.5, loud: 0,   mix: 0.8 },
  { name: 'RADIO READY',  finish: 0.55,width: 0.5, polish: 0.5, tone: 0.55,loud: 0.3, mix: 1 },
  { name: 'WIDE MASTER',  finish: 0.4, width: 0.85,polish: 0.35,tone: 0.5, loud: 0.1, mix: 1 },
  { name: 'LOUD FINISH',  finish: 0.7, width: 0.5, polish: 0.4, tone: 0.55,loud: 0.6, mix: 1 },
  { name: 'TRANSPARENT',  finish: 0.2, width: 0.45,polish: 0.15,tone: 0.5, loud: 0,   mix: 0.6 },
  { name: 'WARM POLISH',  finish: 0.45,width: 0.5, polish: 0.65,tone: 0.35,loud: 0.1, mix: 1 },
  { name: 'FULL SEND',    finish: 0.85,width: 0.6, polish: 0.5, tone: 0.5, loud: 0.8, mix: 1 },
];

const PRESET_COLORS = {
  bg: '#161618', text: '#a0a0a8', textDim: 'rgba(160,160,170,0.4)',
  border: 'rgba(180,180,195,0.08)', hoverBg: 'rgba(180,180,195,0.06)', activeBg: 'rgba(180,180,195,0.04)',
};

// ─── Main FinisherOrb ─────────────────────────────────────────────────────
export default function FinisherOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [finish,  setFinish]  = useState(initialState?.finish  ?? 0.3);
  const [width,   setWidth]   = useState(initialState?.width   ?? 0.5);
  const [polish,  setPolish]  = useState(initialState?.polish  ?? 0.3);
  const [tone,    setTone]    = useState(initialState?.tone    ?? 0.5);
  const [loud,    setLoud]    = useState(initialState?.loud    ?? 0);
  const [mix,     setMix]     = useState(initialState?.mix     ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [outputLevel, setOutputLevel] = useState(0);

  const outMeterRef = useRef(null);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, finish, width, polish, tone, loud, mix, bypassed };

  // ── Engine init ──
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createFinisherEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setFinish(s.finish); eng.setWidth(s.width); eng.setPolish(s.polish);
      eng.setTone(s.tone); eng.setLoud(s.loud); eng.setMix(s.mix);
      eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        if (unregisterEngine) unregisterEngine(instanceId);
        engineRef.current = null;
      }
    };
  }, [sharedSource]);

  // ── Meter RAF ──
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        const peak = engineRef.current.getOutputPeak();
        updateHMeter(outMeterRef.current, peak);
        setOutputLevel(engineRef.current.getOutputLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, finish, width, polish, tone, loud, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, finish, width, polish, tone, loud, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setFinish(p.finish); setWidth(p.width); setPolish(p.polish);
    setTone(p.tone); setLoud(p.loud); setMix(p.mix);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setFinish(p.finish); e.setWidth(p.width); e.setPolish(p.polish);
      e.setTone(p.tone); e.setLoud(p.loud); e.setMix(p.mix);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-inf'; };
  const isActive = !bypassed;

  return (
    <div style={{
      width: 280, borderRadius: 4, position: 'relative',
      background: 'linear-gradient(175deg, #1c1c20 0%, #18181c 25%, #161618 50%, #141416 75%, #18181c 100%)',
      border: '1px solid rgba(180,180,195,0.1)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6), 0 0 20px rgba(180,180,200,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Brushed aluminum texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 4,
        backgroundImage: BRUSHED_AL,
        pointerEvents: 'none', zIndex: 1,
        opacity: 0.6,
      }} />

      {/* ── Ultra-thin header ── */}
      <div style={{
        padding: '7px 12px 5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(180,180,195,0.06)',
        position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 300, letterSpacing: '0.3em',
            color: '#a0a0a8',
          }}>FINISHER</span>
          <span style={{
            fontSize: 4, fontWeight: 600, color: 'rgba(160,160,170,0.3)',
            letterSpacing: '0.25em', marginTop: 2, textTransform: 'uppercase',
          }}>mastering grade</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative', zIndex: 200 }}>
            <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          </div>
          {loading && <span style={{ fontSize: 6, color: 'rgba(160,160,170,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s',
          }} title="Remove"
          onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* ── "MASTERING GRADE" label + LUFS readout ── */}
      <div style={{
        padding: '4px 12px 2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 2,
      }}>
        <span style={{
          fontSize: 4, fontWeight: 300, letterSpacing: '0.35em',
          color: 'rgba(180,180,195,0.25)', fontFamily: 'system-ui',
          textTransform: 'uppercase',
        }}>MASTERING GRADE</span>
        <LufsReadout level={outputLevel} />
      </div>

      {/* ── Spectrum Analyzer (hero visual) ── */}
      <div style={{
        padding: '2px 10px 4px', position: 'relative', zIndex: 2,
      }}>
        <div style={{
          border: '1px solid rgba(180,180,195,0.06)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <SpectrumAnalyzer engineRef={engineRef} signalLevel={outputLevel} />
        </div>
      </div>

      {/* ── Wide horizontal LED meter bar ── */}
      <div style={{ padding: '2px 10px 4px', position: 'relative', zIndex: 2 }}>
        <HLedMeterDom meterRef={outMeterRef} />
      </div>

      {/* ── Main faders: FINISH, WIDTH, POLISH — motorized console style ── */}
      <div style={{
        padding: '6px 0 4px', display: 'flex', flexDirection: 'column', gap: 6,
        borderTop: '1px solid rgba(180,180,195,0.05)',
        borderBottom: '1px solid rgba(180,180,195,0.05)',
        position: 'relative', zIndex: 2,
      }}>
        <ConsoleFader label="FINISH" value={finish} defaultValue={0.3} format={pctFmt}
          onChange={v => { setFinish(v); engineRef.current?.setFinish(v); setActivePreset(null); }} />
        <ConsoleFader label="WIDTH" value={width} defaultValue={0.5} format={pctFmt}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <ConsoleFader label="POLISH" value={polish} defaultValue={0.3} format={pctFmt}
          onChange={v => { setPolish(v); engineRef.current?.setPolish(v); setActivePreset(null); }} />
      </div>

      {/* ── Secondary row: 3 stepped attenuator knobs — TONE, LOUD, MIX ── */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(180,180,195,0.05)',
        position: 'relative', zIndex: 2,
      }}>
        <Knob label="TONE" value={tone} defaultValue={0.5} size={26}
          format={v => v < 0.35 ? 'WARM' : v > 0.65 ? 'BRIGHT' : 'NEUTRAL'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="LOUD" value={loud} defaultValue={0} size={26} format={pctFmt}
          onChange={v => { setLoud(v); engineRef.current?.setLoud(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1} size={26} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* ── Bottom bar: IN/OUT knobs + toggle switch + phase meter + scope ── */}
      <div style={{
        padding: '5px 10px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 2,
      }}>
        <Knob label="IN" value={inputGain} min={0} max={2} defaultValue={1} size={22}
          format={dbFmt} sensitivity={120}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhaseMeter />
          <ToggleSwitch active={isActive} onClick={() => {
            const n = !bypassed;
            setBypassed(n);
            engineRef.current?.setBypass(n);
          }} />
          <LissajousScope />
        </div>

        <Knob label="OUT" value={outputGain} min={0} max={2} defaultValue={1} size={22}
          format={dbFmt} sensitivity={120}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
      </div>
    </div>
  );
}
