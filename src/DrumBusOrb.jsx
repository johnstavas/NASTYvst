import { useState, useEffect, useRef, useCallback } from 'react';
import { createDrumBusEngine } from './drumBusEngine';
import PresetSelector from './PresetSelector';

// ─── DRUM BUS — HYPER RACE CAR ────────────────────────────────────────────────
// Visual concept: sleek black panther energy, F1/hypercar side-profile,
// dark night circuit, amber/orange neon, exhaust flame scales with signal.
//
// Layout:  Header(52) + Presets(26) + Canvas(280) + DriveMode(27) + Knobs(62) + Footer(53) = 500px

const CAR_W = 380, CAR_H = 280;

// ─── Race Knob ────────────────────────────────────────────────────────────────
// Carbon-fiber dark body, orange indicator + arc
function RaceKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2;
  const trackR = size / 2 - 1.8;
  const knobR  = size / 2 - 4;
  const startAngle  = Math.PI * 0.75;
  const totalSweep  = Math.PI * 1.5;
  const angle       = startAngle + norm * totalSweep;
  const large       = norm * totalSweep > Math.PI ? 1 : 0;

  const tX1 = cx + Math.cos(startAngle) * trackR,           tY1 = cy + Math.sin(startAngle) * trackR;
  const tX2 = cx + Math.cos(startAngle + totalSweep) * trackR, tY2 = cy + Math.sin(startAngle + totalSweep) * trackR;
  const fX2 = cx + Math.cos(angle) * trackR,                fY2 = cy + Math.sin(angle) * trackR;
  const iX1 = cx + Math.cos(angle) * (knobR * 0.28),        iY1 = cy + Math.sin(angle) * (knobR * 0.28);
  const iX2 = cx + Math.cos(angle) * (knobR * 0.85),        iY2 = cy + Math.sin(angle) * (knobR * 0.85);

  const gId = `dbkg${Math.round(size * 10 + norm * 100)}`;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={gId} cx="38%" cy="32%" r="65%">
          <stop offset="0%"   stopColor="#2a2830" />
          <stop offset="50%"  stopColor="#1a1820" />
          <stop offset="100%" stopColor="#0e0c12" />
        </radialGradient>
      </defs>
      {/* Outer dark ring */}
      <circle cx={cx} cy={cy} r={size/2 - 0.5} fill="rgba(0,0,0,0.6)" />
      {/* Dark track */}
      <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 1 1 ${tX2} ${tY2}`}
        fill="none" stroke="rgba(40,30,10,0.7)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Orange fill arc */}
      {norm > 0.005 && (
        <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 ${large} 1 ${fX2} ${fY2}`}
          fill="none" stroke="#FF8C00" strokeWidth="2.5" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 2px rgba(255,140,0,0.8))' }} />
      )}
      {/* Carbon body */}
      <circle cx={cx} cy={cy} r={knobR} fill={`url(#${gId})`}
        stroke="rgba(0,0,0,0.5)" strokeWidth="0.8" />
      {/* Subtle carbon rings */}
      <circle cx={cx} cy={cy} r={knobR * 0.75} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5" />
      <circle cx={cx} cy={cy} r={knobR * 0.50} fill="none" stroke="rgba(255,255,255,0.02)"  strokeWidth="0.5" />
      {/* Orange indicator line */}
      <line x1={iX1} y1={iY1} x2={iX2} y2={iY2}
        stroke="#FF8C00" strokeWidth="2.0" strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 1px rgba(255,140,0,0.6))' }} />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="2.2" fill="rgba(255,140,0,0.3)" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 26, format, sensitivity = 140 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp   = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 14, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <RaceKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,160,50,0.75)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 7, color: 'rgba(255,140,0,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

function GainKnob({ value, onChange, label, defaultValue = 1 }) {
  const size = 20;
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = Math.min(1, value / 2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(0, Math.min(2, ref.current.v + (ref.current.y - ev.clientY) * 2 / 100)));
    const onUp   = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <RaceKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(255,140,0,0.5)', fontWeight: 700, fontFamily: 'system-ui, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

// ─── CompToggle ───────────────────────────────────────────────────────────────
function CompToggle({ active, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer', padding: '3px 9px', borderRadius: 3,
      background: active ? 'rgba(255,140,0,0.22)' : 'rgba(255,255,255,0.03)',
      color: active ? '#FF8C00' : 'rgba(160,90,10,0.45)',
      border: `1px solid ${active ? 'rgba(255,140,0,0.5)' : 'rgba(100,60,10,0.2)'}`,
      boxShadow: active ? '0 0 8px rgba(255,140,0,0.4), inset 0 0 4px rgba(255,140,0,0.08)' : 'none',
      fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
      fontFamily: '"Courier New", monospace',
      userSelect: 'none', transition: 'all 0.13s',
    }}>COMP</div>
  );
}

// ─── Stop Sign Bypass ────────────────────────────────────────────────────────
function RaceBypass({ active, onClick }) {
  const size = 32;
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  }).join(' ');
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active — click to bypass' : 'Bypassed — click to activate'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <polygon points={pts}
          fill={active ? 'rgba(210,25,25,0.88)' : 'rgba(80,30,30,0.35)'}
          stroke={active ? 'rgba(255,255,255,0.7)' : 'rgba(120,60,60,0.3)'}
          strokeWidth="1.2" />
        {active && <polygon points={pts} fill="none" stroke="rgba(255,60,60,0.25)" strokeWidth="3" />}
        <text x={cx} y={cy + 2.5} textAnchor="middle"
          fontSize="6.5" fontWeight="800" fontFamily="Arial,sans-serif"
          fill={active ? 'white' : 'rgba(180,100,100,0.5)'} letterSpacing="0.5">
          {active ? 'ACTIVE' : 'BYPSS'}
        </text>
      </svg>
    </div>
  );
}

// ─── Race Car Canvas ──────────────────────────────────────────────────────────
function RaceCarCanvas({ peakIn = 0, peakOut = 0, gr = 0, bassLevel = 0, transient = 0 }) {
  const canvasRef  = useRef(null);
  const histRef    = useRef(null);
  const valRef     = useRef({ peakIn: 0, peakOut: 0, gr: 0, bassLevel: 0, transient: 0 });

  valRef.current = { peakIn, peakOut, gr, bassLevel, transient };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = CAR_W, H = CAR_H;
    canvas.width  = W * 2;
    canvas.height = H * 2;
    ctx.scale(2, 2);

    if (!histRef.current) {
      histRef.current = {
        wheelAngle:  0,
        sig:         0,
        grSmooth:    0,
        transSmooth: 0,
        flameLen:    0,
        phase:       0,
      };
    }

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { peakIn: _pi, peakOut: _po, gr: _gr, bassLevel: _bl, transient: _tr } = valRef.current;
      const h = histRef.current;

      h.phase += 0.016;
      const ph = h.phase;

      // signal level — very fast attack for drums
      const rawSig = Math.max(_pi, _po);
      if (rawSig > h.sig) h.sig = h.sig * 0.45 + rawSig * 0.55;
      else                h.sig = h.sig * 0.92 + rawSig * 0.08;

      h.grSmooth    = h.grSmooth    * 0.88 + (_gr || 0) * 0.12;
      h.transSmooth = h.transSmooth * 0.60 + (_tr || 0) * 0.40;
      const bounce  = h.transSmooth * 4;   // strong shake on transient hits

      // wheel speed proportional to signal
      h.wheelAngle += 0.022 + h.sig * 0.18;

      // flame length
      const targetFlame = h.sig * 38 + (_bl || 0) * 15;
      h.flameLen = h.flameLen * 0.75 + targetFlame * 0.25;

      // ── Layout constants ────────────────────────────────────────────
      const roadY = H - 18;
      const carY  = roadY - 45 - bounce * 0.5;  // car top, bounces slightly
      const carH2 = 30;                           // car body height (low profile)
      const carL  = 20;                           // car left (rear)
      const carR  = 330;                          // car right (nose)
      const carW2 = carR - carL;
      const diffY = roadY - 8;                    // diffuser/undertray

      // wheel positions
      const rWx = carL + 55;   // rear wheel center x
      const fWx = carR - 55;   // front wheel center x
      const wR  = 14;          // wheel radius
      const wCy = roadY - wR;  // wheel center y

      // ── Clear / background ──────────────────────────────────────────
      const bgG = ctx.createLinearGradient(0, 0, 0, H);
      bgG.addColorStop(0,   '#0e0c10');
      bgG.addColorStop(0.4, '#12101a');
      bgG.addColorStop(1,   '#0a0810');
      ctx.fillStyle = bgG;
      ctx.fillRect(0, 0, W, H);

      // ── Night sky stars ─────────────────────────────────────────────
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      const stars = [
        [18,12],[60,8],[95,18],[140,5],[190,15],[240,6],[285,20],[320,9],[355,14],[370,4],
        [42,30],[115,25],[175,32],[230,22],[305,28],[348,38],[30,45],[160,40],[270,35],[340,48],
      ];
      for (const [sx, sy] of stars) {
        ctx.beginPath();
        ctx.arc(sx, sy, 0.6 + Math.sin(ph + sx * 0.3) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Track surface ───────────────────────────────────────────────
      const roadG = ctx.createLinearGradient(0, roadY, 0, H);
      roadG.addColorStop(0, '#1a1818');
      roadG.addColorStop(1, '#0e0c0c');
      ctx.fillStyle = roadG;
      ctx.fillRect(0, roadY, W, H - roadY);

      // Neon orange track stripe lines
      ctx.strokeStyle = 'rgba(255,140,0,0.35)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.moveTo(0, roadY + 4);  ctx.lineTo(W, roadY + 4);  ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, roadY + 9);  ctx.lineTo(W, roadY + 9);  ctx.stroke();
      ctx.strokeStyle = 'rgba(255,140,0,0.1)';
      ctx.lineWidth   = 0.5;
      ctx.beginPath(); ctx.moveTo(0, roadY + 14); ctx.lineTo(W, roadY + 14); ctx.stroke();

      // ── Speed lines (motion blur behind car) ────────────────────────
      const speedLineCount = 8;
      for (let sl = 0; sl < speedLineCount; sl++) {
        const slY   = carY + 8 + sl * (carH2 / speedLineCount);
        const slLen = (20 + h.sig * 80 + Math.sin(ph * 2.2 + sl) * 8) * (0.5 + sl * 0.06);
        const slX   = carL - slLen - (ph * 18 % 30);
        const slA   = (0.06 - sl * 0.006) * h.sig;
        ctx.strokeStyle = `rgba(255,140,0,${slA})`;
        ctx.lineWidth   = 0.8 + sl * 0.1;
        ctx.beginPath();
        ctx.moveTo(Math.max(0, slX), slY);
        ctx.lineTo(Math.max(0, slX) + slLen * 0.7, slY);
        ctx.stroke();
      }

      // ── Motion trail afterimages ─────────────────────────────────────
      for (let tr = 1; tr <= 3; tr++) {
        const trOff = tr * (8 + h.sig * 6);
        const trA   = 0.04 - tr * 0.012;
        if (trA <= 0) continue;
        ctx.fillStyle = `rgba(12,10,14,${1 - trA})`;
        // draw ghost car body at offset
        ctx.save();
        ctx.globalAlpha = trA;
        ctx.fillStyle = '#0a0a0e';
        ctx.beginPath();
        ctx.moveTo(carL - trOff, carY);
        ctx.lineTo(carR - trOff - 12, carY);
        ctx.lineTo(carR - trOff, carY + carH2 * 0.3);
        ctx.lineTo(carR - trOff, carY + carH2);
        ctx.lineTo(carL - trOff, carY + carH2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // ── Ground effect glow under diffuser ───────────────────────────
      if (h.sig > 0.02 || h.flameLen > 2) {
        const gGlow = ctx.createRadialGradient(
          (carL + carR) / 2, diffY + 4, 0,
          (carL + carR) / 2, diffY + 4, carW2 * 0.55
        );
        const gA = (h.sig * 0.4 + h.flameLen * 0.008).toFixed(3);
        gGlow.addColorStop(0, `rgba(255,140,0,${gA})`);
        gGlow.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = gGlow;
        ctx.fillRect(carL, diffY, carW2, 14);
      }

      // ── Car shadow ───────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse((carL + carR) / 2, roadY + 4, carW2 * 0.42, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // ── Rear wing ───────────────────────────────────────────────────
      const rwgX = carL + 8;
      const rwgBotY = carY - 2;
      const rwgTopY = carY - 28;
      ctx.fillStyle = '#0c0c12';
      ctx.fillRect(rwgX - 2, rwgTopY, 5, rwgBotY - rwgTopY);
      ctx.fillStyle = '#161620';
      ctx.fillRect(rwgX - 10, rwgTopY, 20, 5);
      ctx.fillRect(rwgX - 8,  rwgTopY + 8, 16, 4);
      // orange DRS indicator stripe
      ctx.fillStyle = `rgba(255,140,0,${0.3 + h.sig * 0.5})`;
      ctx.fillRect(rwgX - 10, rwgTopY + 1, 20, 2);

      // ── Car body (sleek low hypercar) ────────────────────────────────
      // Main body silhouette
      ctx.fillStyle = '#0a0a0e';
      ctx.beginPath();
      // rear (left) to nose (right), top edge
      ctx.moveTo(carL,      carY + carH2 * 0.35);    // rear top
      ctx.lineTo(carL + 18, carY);                    // rear top shoulder
      ctx.lineTo(carR - 20, carY);                    // cockpit top line
      ctx.lineTo(carR - 6,  carY + carH2 * 0.4);     // nose slope
      ctx.lineTo(carR,      carY + carH2 * 0.55);     // nose tip
      ctx.lineTo(carR,      carY + carH2);             // nose bottom
      ctx.lineTo(carL,      carY + carH2);             // body bottom
      ctx.closePath();
      ctx.fill();

      // Car body gradient highlight (top specular)
      const bodyHL = ctx.createLinearGradient(carL, carY, carL, carY + carH2);
      bodyHL.addColorStop(0,    'rgba(60,55,80,0.18)');
      bodyHL.addColorStop(0.12, 'rgba(40,35,60,0.06)');
      bodyHL.addColorStop(0.5,  'rgba(0,0,0,0.0)');
      bodyHL.addColorStop(1,    'rgba(0,0,0,0.25)');
      ctx.fillStyle = bodyHL;
      ctx.beginPath();
      ctx.moveTo(carL,      carY + carH2 * 0.35);
      ctx.lineTo(carL + 18, carY);
      ctx.lineTo(carR - 20, carY);
      ctx.lineTo(carR - 6,  carY + carH2 * 0.4);
      ctx.lineTo(carR,      carY + carH2 * 0.55);
      ctx.lineTo(carR,      carY + carH2);
      ctx.lineTo(carL,      carY + carH2);
      ctx.closePath();
      ctx.fill();

      // ── Livery: amber/orange stripe lines along body ─────────────────
      const stripeY1 = carY + carH2 * 0.58;
      const stripeY2 = carY + carH2 * 0.65;
      const stripeY3 = carY + carH2 * 0.72;
      const liveryA = 0.5 + h.sig * 0.3;
      ctx.strokeStyle = `rgba(255,140,0,${liveryA})`;
      ctx.lineWidth   = 1.2;
      ctx.beginPath(); ctx.moveTo(carL + 20, stripeY1); ctx.lineTo(carR - 10, stripeY1); ctx.stroke();
      ctx.strokeStyle = `rgba(255,160,50,${liveryA * 0.6})`;
      ctx.lineWidth   = 0.8;
      ctx.beginPath(); ctx.moveTo(carL + 20, stripeY2); ctx.lineTo(carR - 10, stripeY2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(carL + 20, stripeY3); ctx.lineTo(carR - 14, stripeY3); ctx.stroke();

      // ── Cockpit canopy ───────────────────────────────────────────────
      const cockpitCX   = (carL + carR) * 0.45;
      const cockpitW    = carW2 * 0.28;
      const cockpitBotY = carY + 1;
      const cockpitTopY = carY - 12;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cockpitCX - cockpitW * 0.5, cockpitBotY);
      ctx.bezierCurveTo(
        cockpitCX - cockpitW * 0.4, cockpitTopY,
        cockpitCX + cockpitW * 0.4, cockpitTopY,
        cockpitCX + cockpitW * 0.5, cockpitBotY
      );
      ctx.closePath();
      const canopyG = ctx.createLinearGradient(cockpitCX - cockpitW * 0.5, cockpitTopY, cockpitCX + cockpitW * 0.5, cockpitBotY);
      canopyG.addColorStop(0, 'rgba(20,16,30,0.88)');
      canopyG.addColorStop(1, 'rgba(30,22,40,0.82)');
      ctx.fillStyle = canopyG;
      ctx.fill();
      // orange tint from hot dashboard
      if (h.sig > 0.05) {
        ctx.fillStyle = `rgba(255,120,0,${h.sig * 0.12})`;
        ctx.fill();
      }
      // canopy glare
      ctx.fillStyle = 'rgba(255,240,200,0.06)';
      ctx.beginPath();
      ctx.moveTo(cockpitCX - cockpitW * 0.25, cockpitBotY);
      ctx.bezierCurveTo(
        cockpitCX - cockpitW * 0.2, cockpitTopY + 3,
        cockpitCX - cockpitW * 0.05, cockpitTopY + 2,
        cockpitCX + cockpitW * 0.05, cockpitBotY
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ── Front wing ───────────────────────────────────────────────────
      const fwgX    = carR - 4;
      const fwgTopY = carY + carH2 * 0.5;
      ctx.fillStyle = '#0d0d14';
      ctx.fillRect(fwgX - 18, fwgTopY + 4, 22, 4);
      ctx.fillRect(fwgX - 12, fwgTopY,     16, 4);
      ctx.fillStyle = `rgba(255,140,0,${0.25 + h.sig * 0.4})`;
      ctx.fillRect(fwgX - 18, fwgTopY + 4, 22, 1);

      // ── Undertray / diffuser ─────────────────────────────────────────
      ctx.fillStyle = '#080810';
      ctx.fillRect(carL, diffY, carW2, roadY - diffY);
      // diffuser strakes
      ctx.strokeStyle = 'rgba(255,100,0,0.2)';
      ctx.lineWidth   = 0.5;
      for (let ds = 0; ds < 6; ds++) {
        const dsx = carL + 20 + ds * (carW2 - 40) / 5;
        ctx.beginPath(); ctx.moveTo(dsx, diffY); ctx.lineTo(dsx, roadY); ctx.stroke();
      }

      // ── LED meter strips on car body ─────────────────────────────────
      // 3 thin strips at different heights, 8 LEDs each
      const strips = [
        { y: carY + carH2 * 0.20, driven: h.sig },
        { y: carY + carH2 * 0.40, driven: Math.min(1, h.sig * 1.1 + _bl * 0.3) },
        { y: carY + carH2 * 0.60, driven: Math.min(1, rawSig * 1.2) },
      ];
      const ledW = 50, ledH = 6, nLeds = 8;
      const ledStartX = carL + 40;

      for (const strip of strips) {
        const segW = (ledW - (nLeds - 1)) / nLeds;
        for (let li = 0; li < nLeds; li++) {
          const lx  = ledStartX + li * (segW + 1);
          const lN  = li / (nLeds - 1);
          const lit = strip.driven > lN * 0.75;
          let lr, lg, lb;
          if      (lN < 0.5)  { lr = 30;  lg = 220; lb = 80; }
          else if (lN < 0.75) { lr = 255; lg = 180; lb = 0; }
          else                { lr = 255; lg = 40;  lb = 20; }
          // dim track
          ctx.fillStyle = `rgba(${lr},${lg},${lb},0.08)`;
          ctx.fillRect(lx, strip.y, segW, ledH);
          if (lit) {
            ctx.fillStyle = `rgba(${lr},${lg},${lb},0.9)`;
            ctx.shadowColor = `rgba(${lr},${lg},${lb},0.6)`;
            ctx.shadowBlur  = 3;
            ctx.fillRect(lx, strip.y, segW, ledH);
            ctx.shadowBlur  = 0;
          }
        }
      }

      // ── Exhaust / rocket boost flame (rear left) ─────────────────────
      const exX  = carL - 2;
      const exY  = carY + carH2 * 0.7;
      const fLen = h.flameLen;
      if (fLen > 1) {
        // outer flame (orange)
        const fGo = ctx.createRadialGradient(exX - fLen * 0.5, exY, 0, exX - fLen * 0.5, exY, fLen * 0.7);
        fGo.addColorStop(0,   `rgba(255,220,0,${Math.min(0.9, h.sig * 1.2)})`);
        fGo.addColorStop(0.4, `rgba(255,100,0,${Math.min(0.7, h.sig)})`);
        fGo.addColorStop(1,   'rgba(200,40,0,0)');
        ctx.fillStyle = fGo;
        ctx.beginPath();
        ctx.moveTo(exX,          exY - 5);
        ctx.lineTo(exX - fLen,   exY + Math.sin(ph * 5.3) * 3);
        ctx.lineTo(exX - fLen * 0.7, exY + 7);
        ctx.lineTo(exX,          exY + 5);
        ctx.closePath();
        ctx.fill();

        // inner core (white-yellow)
        const fGi = ctx.createLinearGradient(exX, exY, exX - fLen * 0.6, exY);
        fGi.addColorStop(0, `rgba(255,255,220,${Math.min(1, h.sig * 1.5)})`);
        fGi.addColorStop(1, 'rgba(255,200,0,0)');
        ctx.fillStyle = fGi;
        ctx.beginPath();
        ctx.moveTo(exX, exY - 2.5);
        ctx.lineTo(exX - fLen * 0.5, exY + Math.sin(ph * 8) * 1.5);
        ctx.lineTo(exX, exY + 2.5);
        ctx.closePath();
        ctx.fill();
      }

      // ── Neon headlight beam ──────────────────────────────────────────
      const hlX = carR + 1;
      const hlY = carY + carH2 * 0.45;
      // headlight lens
      ctx.fillStyle = `rgba(255,230,180,${0.5 + h.sig * 0.45})`;
      ctx.shadowColor = `rgba(255,200,80,${0.3 + h.sig * 0.6})`;
      ctx.shadowBlur  = 4 + h.sig * 10;
      ctx.fillRect(hlX - 8, hlY - 4, 8, 8);
      ctx.shadowBlur  = 0;

      // beam cone
      if (h.sig > 0.02) {
        const blmG = ctx.createRadialGradient(hlX, hlY, 1, hlX + 55, hlY, 85);
        blmG.addColorStop(0, `rgba(255,230,180,${h.sig * 0.14})`);
        blmG.addColorStop(1, 'rgba(255,180,60,0)');
        ctx.fillStyle = blmG;
        ctx.beginPath();
        ctx.moveTo(hlX, hlY - 5);
        ctx.lineTo(hlX + 95, hlY - 30);
        ctx.lineTo(hlX + 95, hlY + 30);
        ctx.lineTo(hlX, hlY + 5);
        ctx.closePath();
        ctx.fill();
      }

      // ── Tail light ───────────────────────────────────────────────────
      const tlA = 0.3 + h.sig * 0.7;
      ctx.fillStyle   = `rgba(220,20,20,${tlA})`;
      ctx.shadowColor = `rgba(255,40,40,${tlA * 0.7})`;
      ctx.shadowBlur  = 3 + h.sig * 8;
      ctx.fillRect(carL - 2, carY + carH2 * 0.32, 5, 10);
      ctx.shadowBlur  = 0;

      // ── Wheels ───────────────────────────────────────────────────────
      const wheelDefs = [
        { cx2: rWx, speed: 1.0 },
        { cx2: fWx, speed: 1.02 },
      ];
      for (const wd of wheelDefs) {
        const cx2  = wd.cx2;
        const wAng = h.wheelAngle * wd.speed;

        // wheel well arch (black)
        ctx.fillStyle = '#08080d';
        ctx.beginPath();
        ctx.arc(cx2, wCy, wR + 5, Math.PI, 0);
        ctx.closePath();
        ctx.fill();

        // drop shadow
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(cx2 + 2, roadY + 3, wR * 0.9, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // tire
        ctx.fillStyle = '#0d0d10';
        ctx.beginPath();
        ctx.arc(cx2, wCy, wR, 0, Math.PI * 2);
        ctx.fill();

        // tire sidewall ring
        ctx.strokeStyle = 'rgba(30,28,40,0.8)';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.arc(cx2, wCy, wR - 1.5, 0, Math.PI * 2);
        ctx.stroke();

        // brake glow (orange when signal is high)
        if (h.sig > 0.3) {
          const brakeA = (h.sig - 0.3) * 1.4;
          ctx.fillStyle = `rgba(255,80,0,${brakeA * 0.25})`;
          ctx.beginPath();
          ctx.arc(cx2, wCy, wR - 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // rim (dark with orange accent)
        const rimR = wR - 4;
        const rimG = ctx.createRadialGradient(cx2 - 2, wCy - 2, 0, cx2, wCy, rimR);
        rimG.addColorStop(0, 'rgba(60,55,75,0.95)');
        rimG.addColorStop(0.5, 'rgba(35,30,50,0.92)');
        rimG.addColorStop(1, 'rgba(20,16,30,0.9)');
        ctx.fillStyle = rimG;
        ctx.beginPath();
        ctx.arc(cx2, wCy, rimR, 0, Math.PI * 2);
        ctx.fill();

        // 5 spokes
        ctx.strokeStyle = 'rgba(80,70,100,0.85)';
        ctx.lineWidth   = 1.5;
        for (let sp = 0; sp < 5; sp++) {
          const sa = wAng + (sp / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx2 + Math.cos(sa) * 2,           wCy + Math.sin(sa) * 2);
          ctx.lineTo(cx2 + Math.cos(sa) * (rimR - 2),  wCy + Math.sin(sa) * (rimR - 2));
          ctx.stroke();
        }

        // center cap with orange accent
        const ccG = ctx.createRadialGradient(cx2 - 1, wCy - 1, 0, cx2, wCy, 4);
        ccG.addColorStop(0, 'rgba(255,140,0,0.8)');
        ccG.addColorStop(1, 'rgba(180,80,0,0.6)');
        ctx.fillStyle = ccG;
        ctx.beginPath();
        ctx.arc(cx2, wCy, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── GR readout ────────────────────────────────────────────────────
      if (h.grSmooth > 0.004) {
        const grDb = (h.grSmooth * 30).toFixed(1);
        ctx.font      = 'bold 6px "Courier New",monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = `rgba(255,140,0,${(0.2 + Math.min(1, h.grSmooth * 5)).toFixed(2)})`;
        ctx.fillText('GR -' + grDb + 'dB', W - 6, H - 5);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: CAR_W + 'px', height: CAR_H + 'px', display: 'block' }}
    />
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'PUNCHY DRUMS',   drive: 0.45, crunch: 0.15, boom: 0.30, freq: 0.25, damp: 0.75, transients: 0.65, decay: 0.50, comp: 1, driveMode: 0, mix: 1.0, trim: 0 },
  { name: 'HEAVY KICK',     drive: 0.35, crunch: 0.05, boom: 0.70, freq: 0.15, damp: 0.80, transients: 0.50, decay: 0.65, comp: 1, driveMode: 1, mix: 1.0, trim: 0 },
  { name: 'SNARE CRACK',    drive: 0.55, crunch: 0.40, boom: 0.10, freq: 0.30, damp: 0.65, transients: 0.80, decay: 0.35, comp: 0, driveMode: 2, mix: 1.0, trim: 0 },
  { name: 'PARALLEL SMASH', drive: 0.60, crunch: 0.35, boom: 0.50, freq: 0.20, damp: 0.70, transients: 0.70, decay: 0.55, comp: 1, driveMode: 2, mix: 0.80, trim: 0 },
  { name: 'WARM TAPE BUS',  drive: 0.30, crunch: 0.05, boom: 0.40, freq: 0.25, damp: 0.60, transients: 0.50, decay: 0.60, comp: 1, driveMode: 0, mix: 1.0, trim: 0 },
  { name: 'MODERN POP KIT', drive: 0.40, crunch: 0.25, boom: 0.25, freq: 0.30, damp: 0.80, transients: 0.65, decay: 0.45, comp: 1, driveMode: 1, mix: 1.0, trim: 0 },
  { name: 'LO-FI CRUNCH',   drive: 0.70, crunch: 0.60, boom: 0.35, freq: 0.20, damp: 0.45, transients: 0.55, decay: 0.50, comp: 0, driveMode: 2, mix: 0.85, trim: -1 },
  { name: 'TIGHT ROOM KIT', drive: 0.25, crunch: 0.10, boom: 0.20, freq: 0.35, damp: 0.85, transients: 0.60, decay: 0.40, comp: 1, driveMode: 0, mix: 1.0, trim: 0 },
];

const PRESET_COLORS = {
  bg: '#0e0c10', text: '#e08020', textDim: 'rgba(224,128,32,0.5)',
  border: 'rgba(255,140,0,0.15)', hoverBg: 'rgba(255,140,0,0.08)', activeBg: 'rgba(255,140,0,0.05)',
};

const DRIVE_MODES = ['SOFT', 'MEDIUM', 'HARD'];

// ─── Main component ───────────────────────────────────────────────────────────
export default function DrumBusOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [drive,      setDrive]      = useState(initialState?.drive      ?? 0.3);
  const [crunch,     setCrunch]     = useState(initialState?.crunch     ?? 0.0);
  const [boom,       setBoom]       = useState(initialState?.boom       ?? 0.0);
  const [freq,       setFreq]       = useState(initialState?.freq       ?? 0.25);
  const [damp,       setDamp]       = useState(initialState?.damp       ?? 0.75);
  const [transients, setTransients] = useState(initialState?.transients ?? 0.5);
  const [decay,      setDecay]      = useState(initialState?.decay      ?? 0.5);
  const [comp,       setComp]       = useState(initialState?.comp       ?? 0);
  const [driveMode,  setDriveMode]  = useState(initialState?.driveMode  ?? 0);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1.0);
  const [trim,       setTrim]       = useState(initialState?.trim       ?? 0);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);

  // metering
  const [peakIn,    setPeakIn]    = useState(0);
  const [peakOut,   setPeakOut]   = useState(0);
  const [gr,        setGr]        = useState(0);
  const [bassLevel, setBassLevel] = useState(0);
  const [transient, setTransient] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, drive, crunch, boom, freq, damp, transients, decay, comp, driveMode, mix, trim, bypassed };

  // Engine init
  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createDrumBusEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setDrive(s.drive);
      eng.setCrunch(s.crunch);
      eng.setBoom(s.boom);
      eng.setFreq(s.freq);
      eng.setDamp(s.damp);
      eng.setTransients(s.transients);
      eng.setDecay(s.decay);
      eng.setComp(s.comp);
      eng.setDriveMode(s.driveMode);
      eng.setMix(s.mix);
      eng.setTrim(s.trim);
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

  // RAF metering loop
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (engineRef.current) {
        setPeakIn(engineRef.current.getInputPeak?.()  ?? 0);
        setPeakOut(engineRef.current.getOutputPeak?.() ?? 0);
        setGr(engineRef.current.getGR?.()             ?? 0);
        setBassLevel(engineRef.current.getBassLevel?.() ?? 0);
        setTransient(engineRef.current.getTransient?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // State change notification
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, {
      inputGain, outputGain, drive, crunch, boom, freq, damp,
      transients, decay, comp, driveMode, mix, trim, bypassed, preset: activePreset,
    });
  }, [inputGain, outputGain, drive, crunch, boom, freq, damp, transients, decay, comp, driveMode, mix, trim, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setDrive(p.drive);          engineRef.current?.setDrive(p.drive);
    setCrunch(p.crunch);        engineRef.current?.setCrunch(p.crunch);
    setBoom(p.boom);            engineRef.current?.setBoom(p.boom);
    setFreq(p.freq);            engineRef.current?.setFreq(p.freq);
    setDamp(p.damp);            engineRef.current?.setDamp(p.damp);
    setTransients(p.transients); engineRef.current?.setTransients(p.transients);
    setDecay(p.decay);          engineRef.current?.setDecay(p.decay);
    setComp(p.comp);            engineRef.current?.setComp(p.comp);
    setDriveMode(p.driveMode);  engineRef.current?.setDriveMode(p.driveMode);
    setMix(p.mix);              engineRef.current?.setMix(p.mix);
    setTrim(p.trim);            engineRef.current?.setTrim(p.trim);
    setActivePreset(p.name);
  }, []);

  const pctFmt  = v => `${Math.round(v * 100)}%`;
  const trimFmt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + 'dB';

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #0e0c10 0%, #12101a 40%, #0a0810 100%)',
      border: '1.5px solid rgba(255,140,0,0.25)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.95), 0 0 14px rgba(255,140,0,0.06), inset 0 1px 0 rgba(255,140,0,0.03)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Vignette overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(8,6,12,0.35) 100%)',
        borderRadius: 5,
      }} />

      {/* ── Header: IN | Logo | OUT ── */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,140,0,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(255,140,0,0.01) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />

        {/* DRUM BUS stacked logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <span style={{
            fontSize: 9, fontWeight: 900, letterSpacing: '0.45em',
            color: 'rgba(200,100,10,0.55)',
            fontFamily: '"Arial Black", "Arial Bold", Impact, sans-serif',
            textTransform: 'uppercase', lineHeight: 1,
          }}>DRUM</span>
          <span style={{
            fontSize: 20, fontWeight: 900, letterSpacing: '0.08em',
            background: 'linear-gradient(180deg, #FFA040 0%, #FF8C00 40%, #c05000 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 2px 6px rgba(255,140,0,0.55)) drop-shadow(0 0 14px rgba(255,100,0,0.3))',
            fontFamily: '"Arial Black", "Arial Bold", Impact, sans-serif',
            textTransform: 'uppercase', lineHeight: 1,
          }}>BUS</span>
          <span style={{
            fontSize: 5.5, fontWeight: 400, color: 'rgba(255,140,0,0.28)',
            letterSpacing: '0.3em', fontFamily: 'system-ui, Arial, sans-serif',
          }}>punch · body · drive</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} defaultValue={1}
            onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* ── Preset row ── */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,140,0,0.04)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(255,140,0,0.4)' }}>...</span>}
          {onRemove && (
            <span onClick={onRemove}
              style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2 }}
              title="Remove"
              onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div style={{ position: 'relative', zIndex: 2, height: CAR_H, flexShrink: 0, overflow: 'hidden' }}>
        <RaceCarCanvas
          peakIn={peakIn} peakOut={peakOut} gr={gr} bassLevel={bassLevel} transient={transient}
        />
      </div>

      {/* ── DriveMode row + COMP toggle ── */}
      <div style={{
        padding: '4px 14px 3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px solid rgba(255,140,0,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
        gap: 6,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {DRIVE_MODES.map((m, i) => {
            const active = driveMode === i;
            return (
              <button key={m} onClick={() => { setDriveMode(i); engineRef.current?.setDriveMode(i); setActivePreset(null); }}
                style={{
                  fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', padding: '3px 8px',
                  borderRadius: 3, cursor: 'pointer', border: 'none', outline: 'none',
                  background: active ? 'rgba(255,140,0,0.2)' : 'rgba(255,255,255,0.03)',
                  color: active ? 'white' : 'rgba(160,90,10,0.45)',
                  boxShadow: active ? '0 0 7px rgba(255,140,0,0.4), inset 0 0 4px rgba(255,140,0,0.08)' : 'none',
                  border: active ? '1px solid rgba(255,140,0,0.5)' : '1px solid rgba(100,60,10,0.18)',
                  transition: 'all 0.13s',
                  fontFamily: '"Courier New", monospace',
                }}>{m}</button>
            );
          })}
        </div>
        <CompToggle
          active={comp > 0.5}
          onClick={() => {
            const newComp = comp > 0.5 ? 0 : 1;
            setComp(newComp);
            engineRef.current?.setComp(newComp);
            setActivePreset(null);
          }}
        />
      </div>

      {/* ── Knob row: DRIVE | CRUNCH | BOOM | DAMP | TRANS | DECAY ── */}
      <div style={{
        padding: '6px 10px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderTop: '1px solid rgba(255,140,0,0.04)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="DRIVE" value={drive} defaultValue={0.3} size={26} format={pctFmt}
          onChange={v => { setDrive(v); engineRef.current?.setDrive(v); setActivePreset(null); }} />
        <Knob label="CRUNCH" value={crunch} defaultValue={0} size={26} format={pctFmt}
          onChange={v => { setCrunch(v); engineRef.current?.setCrunch(v); setActivePreset(null); }} />
        <Knob label="BOOM" value={boom} defaultValue={0} size={26} format={pctFmt}
          onChange={v => { setBoom(v); engineRef.current?.setBoom(v); setActivePreset(null); }} />
        <Knob label="DAMP" value={damp} defaultValue={0.75} size={26} format={pctFmt}
          onChange={v => { setDamp(v); engineRef.current?.setDamp(v); setActivePreset(null); }} />
        <Knob label="TRANS" value={transients} defaultValue={0.5} size={26}
          format={v => v < 0.45 ? 'SOFT' : v > 0.55 ? 'PUNCH' : 'FLAT'}
          onChange={v => { setTransients(v); engineRef.current?.setTransients(v); setActivePreset(null); }} />
        <Knob label="DECAY" value={decay} defaultValue={0.5} size={26}
          format={v => v < 0.45 ? 'TIGHT' : v > 0.55 ? 'LONG' : 'MID'}
          onChange={v => { setDecay(v); engineRef.current?.setDecay(v); setActivePreset(null); }} />
      </div>

      {/* ── Footer row: FREQ | MIX | TRIM | BYPASS ── */}
      <div style={{
        padding: '4px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px solid rgba(255,140,0,0.04)', position: 'relative', zIndex: 2, flexShrink: 0,
        gap: 6,
      }}>
        <Knob label="FREQ" value={freq} defaultValue={0.25} size={20}
          format={v => Math.round(40 + v * 160) + 'Hz'}
          onChange={v => { setFreq(v); engineRef.current?.setFreq(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={1.0} size={20} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
          <div style={{
            fontSize: 9, color: 'rgba(255,140,0,0.85)', fontFamily: '"Courier New",monospace',
            fontWeight: 700, letterSpacing: '0.05em',
            background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.2)',
            borderRadius: 3, padding: '2px 6px',
          }}>{trimFmt(trim)}</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
            <span onClick={() => { const v = Math.max(-12, trim - 1); setTrim(v); engineRef.current?.setTrim(v); }}
              style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(255,140,0,0.55)', fontWeight: 700, padding: '0 3px', borderRadius: 2,
                transition: 'color 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#FF8C00'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,140,0,0.55)'}>-</span>
            <span style={{ fontSize: 7.5, color: 'rgba(255,140,0,0.4)', fontFamily: '"Courier New",monospace' }}>TRIM</span>
            <span onClick={() => { const v = Math.min(12, trim + 1); setTrim(v); engineRef.current?.setTrim(v); }}
              style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(255,140,0,0.55)', fontWeight: 700, padding: '0 3px', borderRadius: 2,
                transition: 'color 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#FF8C00'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,140,0,0.55)'}>+</span>
          </div>
        </div>
        <RaceBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
