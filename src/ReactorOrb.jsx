import { useState, useEffect, useRef, useCallback } from 'react';
import { createReactorEngine } from './reactorEngine';
import PresetSelector from './PresetSelector';

// ─── REACTOR: Full Hacker Terminal ──────────────────────────────────────────
// Visual: MATRIX RAIN + OSCILLOSCOPE — CRT terminal with phosphor glow
// Hero: Falling green katakana characters with real audio waveform overlay

// ─── Katakana + random character set for matrix rain ────────────────────────
const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]!@#$%^&*';

// ─── Matrix Rain + Oscilloscope Canvas ──────────────────────────────────────
function MatrixOscilloscope({ react, speed, depth, shape, reactLevel, engineRef }) {
  const canvasRef = useRef(null);
  const columnsRef = useRef(null);
  const waveformRef = useRef(null);
  const analyserBufRef = useRef(null);
  const prevPeakRef = useRef(0);
  const gridPulseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize matrix rain columns
    if (!columnsRef.current) {
      const cols = [];
      const colWidth = 10;
      const numCols = Math.ceil(W / colWidth);
      for (let i = 0; i < numCols; i++) {
        const chars = [];
        const numChars = Math.floor(H / 11) + 4;
        for (let j = 0; j < numChars; j++) {
          chars.push({
            char: MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)],
            glitchTimer: 0,
            brightness: 0,
          });
        }
        cols.push({
          x: i * colWidth,
          y: Math.random() * -H * 2,
          speed: 0.5 + Math.random() * 1.5,
          chars,
          baseSpeed: 0.5 + Math.random() * 1.5,
        });
      }
      columnsRef.current = cols;
    }

    // Initialize waveform buffer
    if (!waveformRef.current) {
      waveformRef.current = new Float32Array(256);
    }

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // ── Background — deep black with slight green tint ──
      ctx.fillStyle = 'rgba(0, 3, 1, 0.92)';
      ctx.fillRect(0, 0, W, H);

      const rl = reactLevel;
      const pk = rl;

      // Transient detection
      const prevPeak = prevPeakRef.current;
      const isTransient = pk > 0.7 && pk > prevPeak + 0.05;
      prevPeakRef.current = pk * 0.95 + prevPeak * 0.05;

      // Grid pulse on beat
      if (isTransient) gridPulseRef.current = 1;
      gridPulseRef.current *= 0.92;
      const gridPulse = gridPulseRef.current;

      // ── Oscilloscope grid ──
      const gridAlpha = 0.025 + gridPulse * 0.06;
      ctx.strokeStyle = `rgba(0, 255, 96, ${gridAlpha})`;
      ctx.lineWidth = 0.3;
      for (let gx = 0; gx < W; gx += 20) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 0; gy < H; gy += 20) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }
      // Center crosshair brighter
      ctx.strokeStyle = `rgba(0, 255, 96, ${0.05 + gridPulse * 0.08})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

      // ── Matrix digital rain (behind waveform) ──
      const cols = columnsRef.current;
      const speedMult = 1 + rl * 3; // faster when louder
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';

      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        col.y += col.baseSpeed * speedMult;

        // Reset column when it goes off screen
        if (col.y > H + col.chars.length * 11) {
          col.y = Math.random() * -H;
          col.baseSpeed = 0.5 + Math.random() * 1.5;
        }

        for (let j = 0; j < col.chars.length; j++) {
          const charY = col.y + j * 11;
          if (charY < -11 || charY > H + 11) continue;

          const ch = col.chars[j];

          // Glitch on transients — random chars change rapidly
          if (isTransient && Math.random() < 0.3) {
            ch.char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
            ch.brightness = 1;
          }

          // Random character cycling (subtle)
          if (Math.random() < 0.002 + rl * 0.01) {
            ch.char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
          }

          // Brightness decay
          ch.brightness *= 0.93;

          // First char in column is brightest (leading edge)
          const isHead = j === 0;
          const fadeRatio = 1 - (j / col.chars.length);
          let alpha = fadeRatio * 0.25 + (isHead ? 0.4 : 0);

          // Transient flash — random chars go white
          if (ch.brightness > 0.3) {
            ctx.fillStyle = `rgba(200, 255, 220, ${ch.brightness * 0.7})`;
          } else if (isHead) {
            ctx.fillStyle = `rgba(150, 255, 170, ${alpha})`;
          } else {
            ctx.fillStyle = `rgba(0, 255, 96, ${alpha * 0.5})`;
          }

          ctx.fillText(ch.char, col.x + 5, charY);
        }
      }

      // ── Read actual waveform from engine analyser ──
      const analyser = engineRef.current?.getAnalyserIn?.();
      if (analyser) {
        if (!analyserBufRef.current || analyserBufRef.current.length !== analyser.fftSize) {
          analyserBufRef.current = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(analyserBufRef.current);
        // Downsample to waveform display buffer
        const src = analyserBufRef.current;
        const dst = waveformRef.current;
        const step = src.length / dst.length;
        for (let i = 0; i < dst.length; i++) {
          dst[i] = src[Math.floor(i * step)];
        }
      }

      // ── Draw oscilloscope waveform with phosphor glow ──
      const wf = waveformRef.current;
      if (wf) {
        // Color shifts: dim green (quiet) -> bright neon (loud) -> white (clipping)
        let r, g, b;
        if (rl > 0.9) {
          r = 200 + (rl - 0.9) * 550; g = 255; b = 200 + (rl - 0.9) * 550; // white-ish
        } else if (rl > 0.4) {
          const t = (rl - 0.4) / 0.5;
          r = t * 80; g = 180 + t * 75; b = 60 + t * 40; // green to bright neon
        } else {
          r = 0; g = 100 + rl * 200; b = 40 + rl * 50; // dim green
        }

        // Pass 1: thick glow (outer phosphor)
        ctx.beginPath();
        for (let i = 0; i < wf.length; i++) {
          const x = (i / wf.length) * W;
          const y = H / 2 + wf[i] * H * 0.42;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${Math.round(r * 0.5)}, ${Math.round(g * 0.5)}, ${Math.round(b * 0.5)}, 0.15)`;
        ctx.lineWidth = 6;
        ctx.stroke();

        // Pass 2: medium line (main phosphor)
        ctx.beginPath();
        for (let i = 0; i < wf.length; i++) {
          const x = (i / wf.length) * W;
          const y = H / 2 + wf[i] * H * 0.42;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.6)`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Pass 3: thin bright center (hot core)
        ctx.beginPath();
        for (let i = 0; i < wf.length; i++) {
          const x = (i / wf.length) * W;
          const y = H / 2 + wf[i] * H * 0.42;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${Math.min(255, Math.round(r + 100))}, 255, ${Math.min(255, Math.round(b + 100))}, 0.9)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 160, display: 'block' }} />;
}

// ─── Terminal Bypass Toggle ─────────────────────────────────────────────────
function TerminalBypass({ bypassed, onToggle }) {
  const [typing, setTyping] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const targetText = bypassed ? 'REACTOR_OFFLINE' : 'REACTOR_ACTIVE';

  useEffect(() => {
    setDisplayText(targetText);
  }, []);

  const handleClick = () => {
    setTyping(true);
    const newBypassed = !bypassed;
    const newText = newBypassed ? 'REACTOR_OFFLINE' : 'REACTOR_ACTIVE';
    setDisplayText('');

    let i = 0;
    const typeInterval = setInterval(() => {
      if (i <= newText.length) {
        setDisplayText(newText.slice(0, i));
        i++;
      } else {
        clearInterval(typeInterval);
        setTyping(false);
        onToggle();
      }
    }, 25);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        cursor: 'pointer',
        padding: '3px 8px',
        fontFamily: '"Courier New", monospace',
        fontSize: 9,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderRadius: 1,
        background: 'rgba(0,255,96,0.02)',
        border: '1px solid rgba(0,255,96,0.06)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,96,0.06)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,255,96,0.02)'}
    >
      <span style={{ color: 'rgba(0,255,96,0.4)', marginRight: 4 }}>{'>'}</span>
      <span style={{
        color: bypassed ? 'rgba(100,100,100,0.7)' : '#00ff60',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textShadow: bypassed ? 'none' : '0 0 8px rgba(0,255,96,0.4)',
      }}>
        {displayText}
      </span>
      <span style={{
        display: 'inline-block',
        width: 6,
        height: 11,
        background: bypassed ? 'rgba(100,100,100,0.4)' : '#00ff60',
        marginLeft: 2,
        animation: 'reactorCursorBlink 1s step-end infinite',
        opacity: typing ? 1 : 0.7,
      }} />
      <style>{`@keyframes reactorCursorBlink { 0%, 50% { opacity: 0.7; } 51%, 100% { opacity: 0; } }`}</style>
    </div>
  );
}

// ─── Data Dial (ring progress knob) ─────────────────────────────────────────
function DataDial({ label, value, onChange, min = 0, max = 1, defaultValue, size = 42, format, sensitivity = 160 }) {
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

  // Arc parameters
  const cx = size / 2, cy = size / 2, r = size / 2 - 3;
  const startAngle = 135; // 7 o'clock
  const endAngle = 405;   // 5 o'clock (270 degree sweep)
  const currentAngle = startAngle + norm * (endAngle - startAngle);

  const toRad = deg => (deg - 90) * Math.PI / 180;
  const arcPath = (from, to, radius) => {
    const x1 = cx + radius * Math.cos(toRad(from));
    const y1 = cy + radius * Math.sin(toRad(from));
    const x2 = cx + radius * Math.cos(toRad(to));
    const y2 = cy + radius * Math.sin(toRad(to));
    const largeArc = (to - from) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  const id = useRef(`dd-${Math.random().toString(36).slice(2, 7)}`).current;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 8, position: 'relative', zIndex: 2 }}>
      <div
        onPointerDown={onDown}
        onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab', position: 'relative' }}
      >
        <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <filter id={`${id}-glow`}>
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Background track */}
          <path d={arcPath(startAngle, endAngle, r)} fill="none" stroke="rgba(0,255,96,0.08)" strokeWidth={2.5} strokeLinecap="round" />
          {/* Active arc with glow */}
          {norm > 0.005 && (
            <path d={arcPath(startAngle, currentAngle, r)} fill="none" stroke="#00ff60" strokeWidth={2.5} strokeLinecap="round" filter={`url(#${id}-glow)`} opacity={0.8} />
          )}
          {/* Bright tip dot */}
          {norm > 0.005 && (
            <circle
              cx={cx + r * Math.cos(toRad(currentAngle))}
              cy={cy + r * Math.sin(toRad(currentAngle))}
              r={2}
              fill="#00ff60"
              filter={`url(#${id}-glow)`}
            />
          )}
        </svg>
        {/* Digital readout in center */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', pointerEvents: 'none',
        }}>
          <span style={{
            fontSize: size > 36 ? 10 : 8, fontWeight: 800, color: '#00ff60', fontFamily: '"Courier New", monospace',
            textShadow: '0 0 6px rgba(0,255,96,0.4)', lineHeight: 1,
          }}>{display}</span>
        </div>
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.15em', textTransform: 'uppercase',
        color: 'rgba(0,255,96,0.45)', fontWeight: 700, fontFamily: '"Courier New", monospace',
        textAlign: 'center', width: '100%', lineHeight: 1,
      }}>{label}</span>
    </div>
  );
}

// ─── LED Bar Graph (vertical, segmented) ────────────────────────────────────
function LedBarGraph({ value, onChange, label, min = 0, max = 1, defaultValue = 1, height = 62, format }) {
  const ref = useRef({ y: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;
  const segments = 16;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / (height * 1.5))));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  const litCount = Math.round(norm * segments);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', position: 'relative', zIndex: 2, width: 26 }}>
      {/* Digital readout at top */}
      <span style={{
        fontSize: 8, fontWeight: 800, color: '#00ff60', fontFamily: '"Courier New", monospace',
        textShadow: '0 0 6px rgba(0,255,96,0.3)', minWidth: 24, textAlign: 'center',
      }}>{display}</span>
      {/* Bar graph */}
      <div
        onPointerDown={onDown}
        onDoubleClick={() => onChange(defaultValue)}
        style={{
          width: 16, height, background: '#020604', borderRadius: 1,
          border: '1px solid rgba(0,255,96,0.08)',
          display: 'flex', flexDirection: 'column-reverse', gap: 1,
          padding: '2px 2px',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        {Array.from({ length: segments }).map((_, i) => {
          const lit = i < litCount;
          const isTop = i >= segments - 2;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                borderRadius: 0.5,
                background: lit
                  ? (isTop ? '#ff4040' : '#00ff60')
                  : 'rgba(0,255,96,0.03)',
                boxShadow: lit
                  ? (isTop ? '0 0 4px rgba(255,64,64,0.5)' : '0 0 3px rgba(0,255,96,0.3)')
                  : 'none',
                transition: dragging ? 'none' : 'background 0.05s',
              }}
            />
          );
        })}
      </div>
      <span style={{
        fontSize: 6.5, color: 'rgba(0,255,96,0.45)', fontFamily: '"Courier New", monospace',
        fontWeight: 700, letterSpacing: '0.1em',
      }}>{label}</span>
    </div>
  );
}

// ─── LED meter (green segments) ──────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeterDom({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: '#020604', padding: '3px 2px', borderRadius: 1, border: '1px solid rgba(0,255,96,0.06)', position: 'relative', zIndex: 2 }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: 'rgba(0,255,96,0.03)' }} />)}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New", monospace', fontWeight: 700, color: 'rgba(0,255,96,0.4)', letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2 }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    segmentEls[i].style.background = dB > threshDb
      ? (i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#40ff80' : 'rgba(0,255,96,0.6)')
      : 'rgba(0,255,96,0.03)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#40ff80' : 'rgba(0,255,96,0.4)';
    dbEl.firstChild.textContent = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-∞';
  }
}

// ─── Boot Sequence Overlay ───────────────────────────────────────────────────
function BootSequence() {
  const [visible, setVisible] = useState(true);
  const [text, setText] = useState('');
  const fullText = '> SYSTEM ONLINE... BOOT SEQUENCE COMPLETE';

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i <= fullText.length) {
        setText(fullText.slice(0, i));
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => setVisible(false), 800);
      }
    }, 35);
    return () => clearInterval(interval);
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'rgba(0,3,1,0.95)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      animation: 'reactorBootFade 0.5s ease-out 2.5s forwards',
    }}>
      <span style={{
        fontFamily: '"Courier New", monospace', fontSize: 8,
        color: '#00ff60', fontWeight: 700, letterSpacing: '0.12em',
        textShadow: '0 0 10px rgba(0,255,96,0.6)',
      }}>{text}</span>
      <style>{`@keyframes reactorBootFade { to { opacity: 0; } }`}</style>
    </div>
  );
}

// ─── Processed Samples Counter ───────────────────────────────────────────────
function SampleCounter() {
  const countRef = useRef(0);
  const [display, setDisplay] = useState('00000000');

  useEffect(() => {
    const interval = setInterval(() => {
      countRef.current += 256 + Math.floor(Math.random() * 512);
      setDisplay(countRef.current.toString().padStart(8, '0'));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <span style={{
      fontSize: 5, fontFamily: '"Courier New", monospace', color: 'rgba(0,255,96,0.3)',
      letterSpacing: '0.08em',
    }}>
      PKT:{display}
    </span>
  );
}

// ─── CPU Usage Indicator (fake) ──────────────────────────────────────────────
function CpuIndicator() {
  const [cpu, setCpu] = useState(24);

  useEffect(() => {
    const interval = setInterval(() => {
      setCpu(prev => {
        const drift = (Math.random() - 0.5) * 8;
        return Math.max(12, Math.min(48, prev + drift));
      });
    }, 300);
    return () => clearInterval(interval);
  }, []);

  return (
    <span style={{
      fontSize: 5, fontFamily: '"Courier New", monospace', color: 'rgba(0,255,96,0.3)',
      letterSpacing: '0.08em',
    }}>
      CPU:{Math.round(cpu)}%
    </span>
  );
}

// ─── Clip Flash Overlay ──────────────────────────────────────────────────────
function ClipFlash({ reactLevel }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (reactLevel > 0.92 && !flash) {
      setFlash(true);
      setTimeout(() => setFlash(false), 80);
    }
  }, [reactLevel]);

  if (!flash) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 90,
      background: 'rgba(255,0,0,0.08)',
      pointerEvents: 'none',
      borderRadius: 2,
    }} />
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',            react: 0.4, speed: 0.3, depth: 0.4, shape: 0,   filter: 0.5, stereo: 0.4, mix: 0.5 },
  { name: 'SUBTLE REACT',    react: 0.2, speed: 0.2, depth: 0.25,shape: 0,   filter: 0.6, stereo: 0.3, mix: 0.35 },
  { name: 'TREMOLO DRIVE',   react: 0.7, speed: 0.6, depth: 0.6, shape: 0.2, filter: 0.7, stereo: 0.2, mix: 0.6 },
  { name: 'FILTER SWEEP',    react: 0.5, speed: 0.15,depth: 0.5, shape: 0,   filter: 0.3, stereo: 0.5, mix: 0.55 },
  { name: 'STEREO PULSE',    react: 0.6, speed: 0.4, depth: 0.5, shape: 0.3, filter: 0.55,stereo: 0.9, mix: 0.5 },
  { name: 'TRANSIENT MOD',   react: 0.9, speed: 0.5, depth: 0.7, shape: 0.5, filter: 0.5, stereo: 0.4, mix: 0.55 },
  { name: 'CHAOS',           react: 1.0, speed: 0.8, depth: 0.9, shape: 1.0, filter: 0.4, stereo: 0.7, mix: 0.65 },
  { name: 'DEEP LISTEN',     react: 0.3, speed: 0.1, depth: 0.35,shape: 0.1, filter: 0.45,stereo: 0.6, mix: 0.45 },
];

const PRESET_COLORS = {
  bg: '#020604', text: 'rgba(0,255,96,0.85)', textDim: 'rgba(0,255,96,0.45)',
  border: 'rgba(0,255,96,0.1)', hoverBg: 'rgba(0,255,96,0.08)', activeBg: 'rgba(0,255,96,0.06)',
};

// ─── Main Reactor Orb ─────────────────────────────────────────────────────
export default function ReactorOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [react,  setReact]  = useState(initialState?.react  ?? 0.4);
  const [speed,  setSpeed]  = useState(initialState?.speed  ?? 0.3);
  const [depth,  setDepth]  = useState(initialState?.depth  ?? 0.4);
  const [shape,  setShape]  = useState(initialState?.shape  ?? 0);
  const [filter, setFilter] = useState(initialState?.filter ?? 0.5);
  const [stereo, setStereo] = useState(initialState?.stereo ?? 0.4);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 0.5);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [reactLevel, setReactLevel] = useState(0);

  const inMeterRef = useRef(null), outMeterRef = useRef(null);
  const inDbRef = useRef(null), outDbRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, react, speed, depth, shape, filter, stereo, mix, bypassed };

  // ── Engine init ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createReactorEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setReact(s.react); eng.setSpeed(s.speed); eng.setDepth(s.depth);
      eng.setShape(s.shape); eng.setFilter(s.filter); eng.setStereo(s.stereo);
      eng.setMix(s.mix); eng.setBypass(s.bypassed);
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

  // ── Meter + reactLevel RAF ──────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setReactLevel(engineRef.current.getReactLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ───────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, react, speed, depth, shape, filter, stereo, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, react, speed, depth, shape, filter, stereo, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setReact(p.react); setSpeed(p.speed); setDepth(p.depth); setShape(p.shape);
    setFilter(p.filter); setStereo(p.stereo); setMix(p.mix); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setReact(p.react); e.setSpeed(p.speed); e.setDepth(p.depth); e.setShape(p.shape);
      e.setFilter(p.filter); e.setStereo(p.stereo); e.setMix(p.mix);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'; };

  return (
    <div style={{
      width: 380, position: 'relative', overflow: 'hidden',
      background: '#010301',
      /* Corner bracket border via box-shadow + hard border */
      border: '1px solid rgba(0,255,96,0.2)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.95), 0 0 30px rgba(0,255,96,0.06), 0 0 80px rgba(0,255,96,0.02), inset 0 0 0 1px rgba(0,255,96,0.04)',
      fontFamily: '"Courier New", monospace', userSelect: 'none',
    }}>
      {/* Boot sequence overlay */}
      <BootSequence />

      {/* Clip flash overlay */}
      <ClipFlash reactLevel={reactLevel} />

      {/* Scanline CRT overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50,
        background: 'repeating-linear-gradient(0deg, transparent 0px, transparent 1.5px, rgba(0,0,0,0.12) 1.5px, rgba(0,0,0,0.12) 3px)',
        mixBlendMode: 'multiply',
      }} />

      {/* Corner brackets decoration */}
      <div style={{ position: 'absolute', top: 2, left: 2, width: 10, height: 10, borderTop: '1.5px solid rgba(0,255,96,0.35)', borderLeft: '1.5px solid rgba(0,255,96,0.35)', pointerEvents: 'none', zIndex: 60 }} />
      <div style={{ position: 'absolute', top: 2, right: 2, width: 10, height: 10, borderTop: '1.5px solid rgba(0,255,96,0.35)', borderRight: '1.5px solid rgba(0,255,96,0.35)', pointerEvents: 'none', zIndex: 60 }} />
      <div style={{ position: 'absolute', bottom: 2, left: 2, width: 10, height: 10, borderBottom: '1.5px solid rgba(0,255,96,0.35)', borderLeft: '1.5px solid rgba(0,255,96,0.35)', pointerEvents: 'none', zIndex: 60 }} />
      <div style={{ position: 'absolute', bottom: 2, right: 2, width: 10, height: 10, borderBottom: '1.5px solid rgba(0,255,96,0.35)', borderRight: '1.5px solid rgba(0,255,96,0.35)', pointerEvents: 'none', zIndex: 60 }} />

      {/* Header — terminal style */}
      <div style={{
        padding: '7px 10px 5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,255,96,0.08)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(0,255,96,0.02) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              fontSize: 14, fontWeight: 900, letterSpacing: '0.2em',
              color: '#00ff60', fontFamily: '"Courier New", monospace',
              textShadow: '0 0 12px rgba(0,255,96,0.6), 0 0 24px rgba(0,255,96,0.2)',
            }}>REACTOR</span>
            {/* CLASSIFIED badge */}
            <span style={{
              fontSize: 4.5, fontWeight: 800, letterSpacing: '0.15em',
              color: 'rgba(0,255,96,0.35)', border: '0.5px solid rgba(0,255,96,0.2)',
              padding: '1px 3px', borderRadius: 1,
            }}>CLASSIFIED</span>
          </div>
          <span style={{
            fontSize: 6, fontWeight: 600, color: 'rgba(0,255,96,0.25)', letterSpacing: '0.35em',
            marginTop: 2, textTransform: 'uppercase',
          }}>listening machine</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(0,255,96,0.3)' }}>INIT...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>×</span>}
        </div>
      </div>

      {/* Matrix + Oscilloscope display */}
      <div style={{ borderBottom: '1px solid rgba(0,255,96,0.06)', position: 'relative', zIndex: 2, background: '#010301' }}>
        <div style={{ border: '1px solid rgba(0,255,96,0.05)', margin: 2 }}>
          <MatrixOscilloscope react={react} speed={speed} depth={depth} shape={shape} reactLevel={reactLevel} engineRef={engineRef} />
        </div>
        {/* ACCESS GRANTED badge overlay */}
        <div style={{
          position: 'absolute', top: 6, right: 8, zIndex: 5,
          fontSize: 4.5, fontWeight: 800, letterSpacing: '0.12em',
          color: 'rgba(0,255,96,0.25)', fontFamily: '"Courier New", monospace',
        }}>ACCESS GRANTED</div>
      </div>

      {/* Status bar — CPU + Sample Counter */}
      <div style={{
        padding: '2px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid rgba(0,255,96,0.05)', position: 'relative', zIndex: 2,
      }}>
        <CpuIndicator />
        <SampleCounter />
      </div>

      {/* REACT/DEPTH as LED bar graphs + SPEED/SHAPE as data dials */}
      <div style={{
        padding: '5px 10px 4px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 8,
        borderBottom: '1px solid rgba(0,255,96,0.05)', position: 'relative', zIndex: 2,
      }}>
        <LedBarGraph label="REACT" value={react} min={0} max={1} defaultValue={0.4} height={62}
          onChange={v => { setReact(v); engineRef.current?.setReact(v); setActivePreset(null); }} format={pctFmt} />
        <LedBarGraph label="DEPTH" value={depth} min={0} max={1} defaultValue={0.4} height={62}
          onChange={v => { setDepth(v); engineRef.current?.setDepth(v); setActivePreset(null); }} format={pctFmt} />
        <div style={{ width: 4 }} />
        <DataDial label="SPEED" value={speed} defaultValue={0.3} size={36}
          format={v => { const hz = 0.1 * Math.pow(120, v); return hz < 1 ? `${(hz * 1000).toFixed(0)}m` : `${hz.toFixed(1)}`; }}
          onChange={v => { setSpeed(v); engineRef.current?.setSpeed(v); setActivePreset(null); }} />
        <DataDial label="SHAPE" value={shape} defaultValue={0} size={36}
          format={v => v < 0.33 ? 'SIN' : v < 0.66 ? 'TRI' : 'RND'}
          onChange={v => { setShape(v); engineRef.current?.setShape(v); setActivePreset(null); }} />
      </div>

      {/* FILTER, STEREO, MIX — data dial row */}
      <div style={{
        padding: '3px 10px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(0,255,96,0.05)', position: 'relative', zIndex: 2,
      }}>
        <DataDial label="FILTER" value={filter} defaultValue={0.5} size={32}
          format={v => { const f = 200 * Math.pow(90, v); return f < 1000 ? `${Math.round(f)}` : `${(f / 1000).toFixed(1)}k`; }}
          onChange={v => { setFilter(v); engineRef.current?.setFilter(v); setActivePreset(null); }} />
        <DataDial label="STEREO" value={stereo} defaultValue={0.4} size={32} format={pctFmt}
          onChange={v => { setStereo(v); engineRef.current?.setStereo(v); setActivePreset(null); }} />
        <DataDial label="MIX" value={mix} defaultValue={0.5} size={32} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Bottom: IN/OUT dials + meters + terminal bypass */}
      <div style={{
        padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 2,
      }}>
        {/* IN/OUT meters + gain */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <DataDial label="IN" value={inputGain} min={0} max={2} defaultValue={1} size={22}
            onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} sensitivity={100} />
          <LedMeterDom meterRef={inMeterRef} />
          <DbReadoutDom dbRef={inDbRef} />
          <div style={{ width: 2 }} />
          <DbReadoutDom dbRef={outDbRef} />
          <LedMeterDom meterRef={outMeterRef} />
          <DataDial label="OUT" value={outputGain} min={0} max={2} defaultValue={1} size={22}
            onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} sensitivity={100} />
        </div>

        {/* Terminal bypass command */}
        <TerminalBypass bypassed={bypassed} onToggle={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
