import { useState, useEffect, useRef, useCallback } from 'react';
import { createPhraseRiderEngine } from './phraseRiderEngine';
import PresetSelector from './PresetSelector';

// ─── PHRASERIDER: Audio Waveform Automation Lane ──────────────────────────
// Visual: live waveform with animated "riding fader" line showing gain
// Colors: electric purple with green gain line

// ─── Waveform Automation Canvas (Hero) ────────────────────────────────────
function WaveformLane({ speed, smoothness, phraseWord, presComp, peak, waveform, gainCurve, waveformIdx, currentGainDb }) {
  const canvasRef = useRef(null);
  const valRef = useRef({
    speed: 0.5, smoothness: 0.6, phraseWord: 0.5, presComp: 0.3,
    peak: 0, waveform: null, gainCurve: null, waveformIdx: 0, currentGainDb: 0,
  });
  const phaseRef = useRef(0);
  const smoothGainDbRef = useRef(0);
  const sparkParticlesRef = useRef(
    Array.from({ length: 40 }, () => ({
      x: Math.random() * 260, y: Math.random() * 140,
      vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
      life: Math.random(), hue: 260 + Math.random() * 60,
      size: 0.5 + Math.random() * 2,
    }))
  );
  const lightningRef = useRef([]);

  useEffect(() => {
    valRef.current = { speed, smoothness, phraseWord, presComp, peak, waveform, gainCurve, waveformIdx, currentGainDb };
  }, [speed, smoothness, phraseWord, presComp, peak, waveform, gainCurve, waveformIdx, currentGainDb]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    let raf;
    var frameCount = 0;

    var makeBolt = function(x1, y1, x2, y2, segments) {
      var pts = [{x: x1, y: y1}];
      for (var i = 1; i < segments; i++) {
        var frac = i / segments;
        var mx = x1 + (x2 - x1) * frac + (Math.random() - 0.5) * 15;
        var my = y1 + (y2 - y1) * frac + (Math.random() - 0.5) * 10;
        pts.push({x: mx, y: my});
      }
      pts.push({x: x2, y: y2});
      return pts;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      phaseRef.current += 0.012;
      frameCount++;
      const t = phaseRef.current;
      const v = valRef.current;
      var peakBright = Math.min(1, v.peak * 2.5);

      // ── Dark background with electric purple/blue ──
      ctx.fillStyle = 'rgba(6, 2, 18, 0.88)';
      ctx.fillRect(0, 0, W, H);

      // ── Electric grid background ──
      ctx.strokeStyle = 'rgba(120, 40, 220, 0.08)';
      ctx.lineWidth = 0.4;
      for (var gx = 0; gx < W; gx += 14) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (var gy = 0; gy < H; gy += 14) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // ── Pulsing grid intersections ──
      for (var ix = 14; ix < W; ix += 14) {
        for (var iy = 14; iy < H; iy += 14) {
          var iAlpha = 0.05 + peakBright * 0.08 + Math.sin(t * 2 + ix * 0.1 + iy * 0.1) * 0.03;
          ctx.beginPath();
          ctx.arc(ix, iy, 0.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(180, 80, 255, ' + iAlpha + ')';
          ctx.fill();
        }
      }

      // ── Dual waveform lanes (phrase=top slow wave, word=bottom fast wave) ──
      var phraseY = H * 0.3;
      var wordY = H * 0.7;
      var waveAmpBase = H * 0.15;

      // Lane separator lines
      ctx.beginPath();
      ctx.moveTo(0, phraseY); ctx.lineTo(W, phraseY);
      ctx.strokeStyle = 'rgba(180, 60, 255, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, wordY); ctx.lineTo(W, wordY);
      ctx.strokeStyle = 'rgba(255, 40, 180, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      var waveData = v.waveform;
      var gainData = v.gainCurve;
      var wIdx = v.waveformIdx;

      // ── PHRASE lane (slow, wide, purple wave) ──
      var phraseAmp = waveAmpBase * (0.6 + (1 - v.phraseWord) * 0.8);
      ctx.beginPath();
      for (var pi = 0; pi < W; pi++) {
        var pWave = 0;
        if (waveData) {
          var pIdx = Math.floor((pi / W) * waveData.length);
          pIdx = (wIdx + pIdx) % waveData.length;
          pWave = waveData[pIdx] * 4;
        }
        // Slow sine overlay
        pWave += Math.sin(t * 0.5 + pi * 0.02) * 0.3 * (1 - v.phraseWord);
        var py = phraseY - pWave * phraseAmp;
        if (pi === 0) ctx.moveTo(pi, py);
        else ctx.lineTo(pi, py);
      }
      var phraseGrad = ctx.createLinearGradient(0, phraseY - phraseAmp, 0, phraseY + phraseAmp);
      phraseGrad.addColorStop(0, 'rgba(160, 50, 255, ' + (0.7 + peakBright * 0.3) + ')');
      phraseGrad.addColorStop(1, 'rgba(100, 20, 200, 0.2)');
      ctx.strokeStyle = phraseGrad;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Phrase glow
      ctx.lineWidth = 8;
      ctx.globalAlpha = 0.12;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Phrase filled area
      ctx.beginPath();
      for (var pi2 = 0; pi2 < W; pi2++) {
        var pW2 = 0;
        if (waveData) {
          var pI2 = Math.floor((pi2 / W) * waveData.length);
          pI2 = (wIdx + pI2) % waveData.length;
          pW2 = waveData[pI2] * 4;
        }
        pW2 += Math.sin(t * 0.5 + pi2 * 0.02) * 0.3 * (1 - v.phraseWord);
        var py2 = phraseY - pW2 * phraseAmp;
        if (pi2 === 0) ctx.moveTo(pi2, py2);
        else ctx.lineTo(pi2, py2);
      }
      ctx.lineTo(W, phraseY);
      ctx.lineTo(0, phraseY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(140, 40, 240, ' + (0.08 + peakBright * 0.08) + ')';
      ctx.fill();

      // ── WORD lane (fast, sharp, pink wave) ──
      var wordAmp = waveAmpBase * (0.6 + v.phraseWord * 0.8);
      ctx.beginPath();
      for (var wi = 0; wi < W; wi++) {
        var wWave = 0;
        if (waveData) {
          var wI = Math.floor((wi / W) * waveData.length);
          wI = (wIdx + wI) % waveData.length;
          wWave = waveData[wI] * 5;
        }
        // Fast sine overlay
        wWave += Math.sin(t * 2 + wi * 0.08) * 0.2 * v.phraseWord;
        var wy = wordY - wWave * wordAmp;
        if (wi === 0) ctx.moveTo(wi, wy);
        else ctx.lineTo(wi, wy);
      }
      var wordGrad = ctx.createLinearGradient(0, wordY - wordAmp, 0, wordY + wordAmp);
      wordGrad.addColorStop(0, 'rgba(255, 40, 180, ' + (0.7 + peakBright * 0.3) + ')');
      wordGrad.addColorStop(1, 'rgba(200, 20, 140, 0.2)');
      ctx.strokeStyle = wordGrad;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Word glow
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Word filled area
      ctx.beginPath();
      for (var wi2 = 0; wi2 < W; wi2++) {
        var wW2 = 0;
        if (waveData) {
          var wI2 = Math.floor((wi2 / W) * waveData.length);
          wI2 = (wIdx + wI2) % waveData.length;
          wW2 = waveData[wI2] * 5;
        }
        wW2 += Math.sin(t * 2 + wi2 * 0.08) * 0.2 * v.phraseWord;
        var wy2 = wordY - wW2 * wordAmp;
        if (wi2 === 0) ctx.moveTo(wi2, wy2);
        else ctx.lineTo(wi2, wy2);
      }
      ctx.lineTo(W, wordY);
      ctx.lineTo(0, wordY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 20, 160, ' + (0.06 + peakBright * 0.06) + ')';
      ctx.fill();

      // ── Gain riding line (neon pulse trail, cyan) ──
      if (gainData) {
        var len = gainData.length;
        ctx.beginPath();
        for (var gi = 0; gi < len; gi++) {
          var gIdx = (wIdx + gi) % len;
          var gx2 = (gi / len) * W;
          var gVal = gainData[gIdx];
          var gDb = gVal > 0.0001 ? 20 * Math.log10(gVal) : -60;
          var gNorm = Math.max(-12, Math.min(12, gDb)) / 12;
          var gY = H * 0.5 - gNorm * (H * 0.25);
          if (gi === 0) ctx.moveTo(gx2, gY);
          else ctx.lineTo(gx2, gY);
        }
        ctx.strokeStyle = 'rgba(0, 255, 255, ' + (0.7 + peakBright * 0.3) + ')';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Cyan glow
        ctx.lineWidth = 10;
        ctx.globalAlpha = 0.08;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ── Lightning bolts connecting the two lanes ──
      if (frameCount % 3 === 0 && peakBright > 0.05) {
        lightningRef.current = [];
        var boltCount = Math.floor(2 + peakBright * 5);
        for (var bi = 0; bi < boltCount; bi++) {
          var bx = Math.random() * W;
          var by1 = phraseY + (Math.random() - 0.3) * 15;
          var by2 = wordY + (Math.random() - 0.7) * 15;
          lightningRef.current.push(makeBolt(bx, by1, bx + (Math.random() - 0.5) * 20, by2, 5 + Math.floor(Math.random() * 4)));
        }
      }

      var bolts = lightningRef.current;
      for (var bli = 0; bli < bolts.length; bli++) {
        var bolt = bolts[bli];
        if (bolt.length < 2) continue;
        // Main bolt
        ctx.beginPath();
        ctx.moveTo(bolt[0].x, bolt[0].y);
        for (var bpi = 1; bpi < bolt.length; bpi++) {
          ctx.lineTo(bolt[bpi].x, bolt[bpi].y);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.5 + peakBright * 0.4) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Bolt glow (purple/pink)
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(180, 60, 255, ' + (0.15 + peakBright * 0.15) + ')';
        ctx.stroke();
        // Outer glow (cyan)
        ctx.lineWidth = 12;
        ctx.strokeStyle = 'rgba(0, 200, 255, ' + (0.04 + peakBright * 0.06) + ')';
        ctx.stroke();
      }

      // ── Energy spark particles along waveform paths ──
      var sparks = sparkParticlesRef.current;
      for (var si = 0; si < sparks.length; si++) {
        var sp = sparks[si];
        sp.x += sp.vx * (0.5 + v.speed * 1.5);
        sp.y += sp.vy * 0.5;
        sp.life -= 0.015;
        if (sp.life <= 0 || sp.x < -5 || sp.x > W + 5 || sp.y < -5 || sp.y > H + 5) {
          // Respawn on one of the two lanes
          sp.x = Math.random() * W;
          sp.y = Math.random() > 0.5 ? phraseY : wordY;
          sp.vx = (Math.random() - 0.5) * 3;
          sp.vy = (Math.random() - 0.5) * 2;
          sp.life = 0.5 + Math.random() * 0.5;
          sp.hue = Math.random() > 0.5 ? (260 + Math.random() * 40) : (300 + Math.random() * 40);
          sp.size = 0.5 + Math.random() * 2 + peakBright * 2;
        }
        var spAlpha = sp.life * (0.5 + peakBright * 0.5);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + sp.hue + ', 100%, 70%, ' + spAlpha + ')';
        ctx.fill();
        // Spark glow
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + sp.hue + ', 100%, 60%, ' + (spAlpha * 0.12) + ')';
        ctx.fill();
      }

      // ── Sparking electricity at waveform intersections ──
      if (peakBright > 0.15 && frameCount % 2 === 0) {
        for (var ei = 0; ei < 6; ei++) {
          var ex = Math.random() * W;
          var ey = (phraseY + wordY) / 2 + (Math.random() - 0.5) * 20;
          var eSize = 1 + peakBright * 4;
          // Star spark
          for (var er = 0; er < 4; er++) {
            var eAngle = (er / 4) * Math.PI + t * 3;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex + Math.cos(eAngle) * eSize, ey + Math.sin(eAngle) * eSize);
            ctx.strokeStyle = 'rgba(0, 255, 255, ' + (0.3 + peakBright * 0.5) + ')';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // ── Playhead (current position -- bright electric) ──
      if (waveData) {
        var playX = W - 2;
        ctx.beginPath();
        ctx.moveTo(playX, 0);
        ctx.lineTo(playX, H);
        var playGrad = ctx.createLinearGradient(0, 0, 0, H);
        playGrad.addColorStop(0, 'rgba(180, 60, 255, ' + (0.5 + peakBright * 0.4) + ')');
        playGrad.addColorStop(0.5, 'rgba(255, 40, 200, ' + (0.6 + peakBright * 0.3) + ')');
        playGrad.addColorStop(1, 'rgba(0, 200, 255, ' + (0.5 + peakBright * 0.4) + ')');
        ctx.strokeStyle = playGrad;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Playhead glow
        ctx.lineWidth = 8;
        ctx.globalAlpha = 0.1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Playhead diamond
        ctx.beginPath();
        ctx.moveTo(playX, 4);
        ctx.lineTo(playX + 5, 10);
        ctx.lineTo(playX, 16);
        ctx.lineTo(playX - 5, 10);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 100, 255, ' + (0.7 + peakBright * 0.3) + ')';
        ctx.fill();
      }

      // ── Current gain indicator (large, glowing readout) ──
      smoothGainDbRef.current += (v.currentGainDb - smoothGainDbRef.current) * 0.1;
      var displayDb = smoothGainDbRef.current;
      var isBoost = displayDb > 0.1;
      var isCut = displayDb < -0.1;

      ctx.font = '900 12px "Courier New", monospace';
      ctx.textAlign = 'right';
      var gainStr = (displayDb >= 0 ? '+' : '') + displayDb.toFixed(1) + 'dB';
      if (isBoost) {
        ctx.fillStyle = 'rgba(0, 255, 200, ' + (0.7 + Math.abs(displayDb) * 0.03) + ')';
      } else if (isCut) {
        ctx.fillStyle = 'rgba(255, 80, 120, ' + (0.7 + Math.abs(displayDb) * 0.03) + ')';
      } else {
        ctx.fillStyle = 'rgba(180, 180, 200, 0.4)';
      }
      ctx.fillText(gainStr, W - 6, 18);

      // ── Labels (bright, visible) ──
      ctx.font = '700 6px system-ui';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(180, 80, 255, 0.7)';
      ctx.fillText('RIDE', 6, 12);
      ctx.fillStyle = 'rgba(0, 220, 255, 0.6)';
      ctx.fillText('SPD ' + Math.round(v.speed * 100), 6, 22);

      // Lane labels
      ctx.font = '600 5px system-ui';
      ctx.fillStyle = 'rgba(160, 60, 255, 0.5)';
      ctx.fillText('PHRASE', 6, phraseY - 5);
      ctx.fillStyle = 'rgba(255, 60, 180, 0.5)';
      ctx.fillText('WORD', 6, wordY - 5);

      // Phrase/Word balance
      ctx.textAlign = 'right';
      ctx.font = '700 6px system-ui';
      var bias = v.phraseWord < 0.4 ? 'PHRASE' : v.phraseWord > 0.6 ? 'WORD' : 'BLEND';
      ctx.fillStyle = 'rgba(200, 100, 255, 0.6)';
      ctx.fillText(bias, W - 6, H - 6);

      // ── dB scale on left edge (bright) ──
      ctx.font = '600 4.5px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(140, 80, 240, 0.35)';
      var dbLabels = ['+12', '+6', '0', '-6', '-12'];
      for (var d = 0; d < dbLabels.length; d++) {
        var dY = H * 0.2 + d * (H * 0.6 / 4);
        ctx.fillText(dbLabels[d], 2, dY + 2);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 6 }} />;
}

// ─── Purple Arc Knob ──────────────────────────────────────────────────────
// Electric squircle knob — CSS-only, rotates with a neon stripe, no SVG
function PurpleKnobVisual({ size = 38, norm = 0, dragging }) {
  const rotateDeg = -135 + norm * 270;
  const borderR = Math.round(size * 0.22);
  return (
    <div style={{ width: size, height: size, position: 'relative', borderRadius: borderR, pointerEvents: 'none' }}>
      {/* Body */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: borderR,
        background: 'linear-gradient(145deg, rgba(35,15,65,0.95), rgba(12,5,26,0.98))',
        border: `1px solid rgba(140,60,220,${dragging ? 0.55 : 0.22})`,
        boxShadow: dragging
          ? '0 0 12px rgba(160,80,255,0.35), inset 0 0 8px rgba(0,0,0,0.8)'
          : 'inset 0 0 8px rgba(0,0,0,0.8)',
      }} />
      {/* Rotating stripe indicator */}
      <div style={{
        position: 'absolute', inset: 4, borderRadius: Math.max(2, borderR - 4),
        transform: `rotate(${rotateDeg}deg)`,
        background: 'transparent',
      }}>
        {/* Top edge neon stripe */}
        <div style={{
          position: 'absolute', top: 0, left: '25%', right: '25%', height: 3,
          borderRadius: 2,
          background: dragging
            ? 'linear-gradient(90deg, transparent, rgba(200,100,255,1), transparent)'
            : 'linear-gradient(90deg, transparent, rgba(160,70,240,0.8), transparent)',
          boxShadow: dragging ? '0 0 8px rgba(200,100,255,0.8)' : '0 0 4px rgba(150,70,230,0.4)',
        }} />
      </div>
      {/* Corner accent dots */}
      {[[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dy], i) => (
        <div key={i} style={{
          position: 'absolute',
          top: dy < 0 ? 3 : 'auto', bottom: dy > 0 ? 3 : 'auto',
          left: dx < 0 ? 3 : 'auto', right: dx > 0 ? 3 : 'auto',
          width: 2, height: 2, borderRadius: '50%',
          background: `rgba(130,55,210,${dragging ? 0.6 : 0.25})`,
        }} />
      ))}
    </div>
  );
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const s = { x: cx + Math.cos(startAngle) * r, y: cy + Math.sin(startAngle) * r };
  const e = { x: cx + Math.cos(endAngle) * r, y: cy + Math.sin(endAngle) * r };
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${endAngle - startAngle > Math.PI ? 1 : 0} 1 ${e.x} ${e.y}`;
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 38, format, sensitivity = 160 }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <PurpleKnobVisual size={size} norm={norm} dragging={dragging} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(170, 110, 240, 0.6)', fontWeight: 600, textAlign: 'center',
        width: '100%', lineHeight: 1.2, fontFamily: 'system-ui',
        textShadow: '0 0 8px rgba(140, 70, 220, 0.1)',
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(150, 90, 230, 0.35)',
        fontFamily: '"Courier New",monospace', fontWeight: 600, textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

// ─── Speed Slider (horizontal) ───────────────────────────────────────────
function SpeedSlider({ value, onChange }) {
  const ref = useRef({ x: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = value;
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { x: e.clientX, v: value };
    const onMove = ev => onChange(Math.max(0, Math.min(1, ref.current.v + (ev.clientX - ref.current.x) / 180)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', position: 'relative', zIndex: 2 }}>
      <span style={{ fontSize: 5.5, color: 'rgba(150, 90, 230, 0.35)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.08em', minWidth: 24 }}>SLOW</span>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(0.5)}
        style={{
          flex: 1, height: 8, borderRadius: 4, position: 'relative',
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'rgba(8, 4, 16, 0.8)',
          border: '0.5px solid rgba(120, 60, 200, 0.1)',
        }}>
        <div style={{
          position: 'absolute', left: 0, top: 1, bottom: 1,
          width: `${norm * 100}%`,
          background: 'linear-gradient(90deg, rgba(120, 60, 200, 0.15), rgba(160, 90, 250, 0.25))',
          borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute', top: -1, bottom: -1, width: 6, borderRadius: 3,
          background: `rgba(170, 100, 255, ${dragging ? 0.7 : 0.5})`,
          left: `calc(${norm * 100}% - 3px)`,
          boxShadow: '0 0 6px rgba(150, 80, 240, 0.25)',
        }} />
      </div>
      <span style={{ fontSize: 5.5, color: 'rgba(150, 90, 230, 0.35)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.08em', minWidth: 24, textAlign: 'right' }}>FAST</span>
    </div>
  );
}

function VSlider({ value, onChange, label, min = 0, max = 1, defaultValue = 1, height = 52, format }) {
  const ref = useRef({ y: 0, v: 0 });
  const [dragging, setDragging] = useState(false);
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : `${Math.round(norm * 100)}%`;
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / (height * 1.5))));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{
          width: 10, height, borderRadius: 5, position: 'relative',
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'rgba(8, 4, 16, 0.8)',
          border: '0.5px solid rgba(120, 60, 200, 0.1)',
        }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`,
          background: 'linear-gradient(to top, rgba(140, 70, 220, 0.15), rgba(160, 90, 240, 0.06))',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 3,
          background: 'rgba(170, 100, 255, 0.5)', bottom: `calc(${norm * 100}% - 2px)`,
          boxShadow: '0 0 6px rgba(150, 80, 240, 0.25)',
        }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(160, 100, 240, 0.3)', fontFamily: 'system-ui', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(140, 80, 220, 0.25)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

const METER_SEGMENTS = 16;
function LedMeterDom({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{
      display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52,
      background: 'rgba(8, 4, 14, 0.8)', padding: '3px 2px', borderRadius: 3,
      border: '0.5px solid rgba(120, 60, 200, 0.06)', position: 'relative', zIndex: 2,
    }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 1, background: 'rgba(120, 60, 200, 0.04)' }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef }) {
  return <span ref={dbRef} style={{
    fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700,
    color: 'rgba(160, 100, 240, 0.3)', letterSpacing: '0.05em',
    width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2,
  }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls?.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    segmentEls[i].style.background = dB > threshDb
      ? (i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#b080f0' : 'rgba(150, 80, 240, 0.5)')
      : 'rgba(120, 60, 200, 0.04)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#b080f0' : 'rgba(160, 100, 240, 0.3)';
    dbEl.firstChild.textContent = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',               speed: 0.50, smoothness: 0.60, phraseWord: 0.50, presComp: 0.30, outputDb: 0 },
  { name: 'POP PHRASE RIDE',    speed: 0.40, smoothness: 0.65, phraseWord: 0.30, presComp: 0.40, outputDb: 0 },
  { name: 'RAP CONTROL TIGHT',  speed: 0.70, smoothness: 0.50, phraseWord: 0.70, presComp: 0.35, outputDb: 0 },
  { name: 'BALLAD SMOOTH',      speed: 0.25, smoothness: 0.80, phraseWord: 0.20, presComp: 0.50, outputDb: 0 },
  { name: 'PODCAST WORD RIDER', speed: 0.60, smoothness: 0.55, phraseWord: 0.80, presComp: 0.20, outputDb: 0 },
];

const PRESET_COLORS = {
  bg: '#0c0618', text: 'rgba(170,110,250,0.75)', textDim: 'rgba(140,80,220,0.4)',
  border: 'rgba(120,60,200,0.1)', hoverBg: 'rgba(120,60,200,0.06)', activeBg: 'rgba(120,60,200,0.05)',
};

const STYLE_ID = 'phraserider-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes priderPulse {
      0%, 100% { box-shadow: 0 0 8px rgba(150,80,240,0.12); }
      50% { box-shadow: 0 0 14px rgba(150,80,240,0.25); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main PhraseRider Orb ────────────────────────────────────────────────
export default function PhraseRiderOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [speed,      setSpeed]      = useState(initialState?.speed      ?? 0.50);
  const [smoothness, setSmoothness] = useState(initialState?.smoothness ?? 0.60);
  const [phraseWord, setPhraseWord] = useState(initialState?.phraseWord ?? 0.50);
  const [presComp,   setPresComp]   = useState(initialState?.presComp   ?? 0.30);
  const [outputDb,   setOutputDb]   = useState(initialState?.outputDb   ?? 0);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak,       setPeak]       = useState(0);
  const [waveform,   setWaveform]   = useState(null);
  const [gainCurve,  setGainCurve]  = useState(null);
  const [waveformIdx, setWaveformIdx] = useState(0);
  const [currentGainDb, setCurrentGainDb] = useState(0);

  const inMeterRef = useRef(null), outMeterRef = useRef(null);
  const inDbRef = useRef(null), outDbRef = useRef(null);
  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, speed, smoothness, phraseWord, presComp, outputDb, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createPhraseRiderEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSpeed(s.speed); eng.setSmoothness(s.smoothness);
      eng.setPhraseWord(s.phraseWord); eng.setPresComp(s.presComp);
      eng.setOutputDb(s.outputDb); eng.setBypass(s.bypassed);
      if (registerEngine) registerEngine(instanceId, eng);
      setLoading(false);
    });
    return () => { if (engineRef.current) { engineRef.current.dispose(); if (unregisterEngine) unregisterEngine(instanceId); engineRef.current = null; } };
  }, [sharedSource]);

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setPeak(engineRef.current.getInputPeak());
        setWaveform(engineRef.current.getWaveform());
        setGainCurve(engineRef.current.getGainCurve());
        setWaveformIdx(engineRef.current.getWaveformIdx());
        setCurrentGainDb(engineRef.current.getCurrentGainDb());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, speed, smoothness, phraseWord, presComp, outputDb, bypassed, preset: activePreset });
  }, [inputGain, outputGain, speed, smoothness, phraseWord, presComp, outputDb, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setSpeed(p.speed); setSmoothness(p.smoothness); setPhraseWord(p.phraseWord);
    setPresComp(p.presComp); setOutputDb(p.outputDb); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) { e.setSpeed(p.speed); e.setSmoothness(p.smoothness); e.setPhraseWord(p.phraseWord); e.setPresComp(p.presComp); e.setOutputDb(p.outputDb); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outDbFmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`;
  const biasFmt = v => v < 0.35 ? 'PHRASE' : v > 0.65 ? 'WORD' : `${Math.round(v * 100)}%`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 8, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #100820 0%, #0c0618 25%, #080412 50%, #06030e 75%, #0a0618 100%)',
      border: '1.5px solid rgba(140,70,220,0.12)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 30px rgba(140,60,220,0.05), inset 0 1px 0 rgba(180,100,255,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(140,70,220,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(140,70,220,0.03) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.08em',
            background: 'linear-gradient(135deg, #c070ff 0%, #9040e0 35%, #60e080 70%, #c070ff 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 10px rgba(150,80,240,0.25))',
          }}>PHRASERIDER</span>
          <span style={{
            fontSize: 6, fontWeight: 600, color: 'rgba(150,90,230,0.3)',
            letterSpacing: '0.35em', marginTop: 3, textTransform: 'uppercase',
          }}>automation lane</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(150,90,230,0.3)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 3, transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
          >×</span>}
        </div>
      </div>

      {/* Waveform Automation Lane (Hero) */}
      <div style={{ borderBottom: '1px solid rgba(140,70,220,0.05)', position: 'relative', zIndex: 2, flex: 1, minHeight: 0 }}>
        <WaveformLane speed={speed} smoothness={smoothness} phraseWord={phraseWord} presComp={presComp}
          peak={peak} waveform={waveform} gainCurve={gainCurve} waveformIdx={waveformIdx} currentGainDb={currentGainDb} />
      </div>

      {/* Speed Slider */}
      <div style={{ padding: '6px 0', borderBottom: '1px solid rgba(140,70,220,0.05)', flexShrink: 0 }}>
        <SpeedSlider value={speed} onChange={v => { setSpeed(v); engineRef.current?.setSpeed(v); setActivePreset(null); }} />
      </div>

      {/* Meters */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(140,70,220,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} />
        <DbReadoutDom dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} />
        <LedMeterDom meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs row 1: SMOOTHNESS, PHRASE<>WORD, PRES COMP */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(140,70,220,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="SMOOTH" value={smoothness} defaultValue={0.60} size={28} format={pctFmt} onChange={v => { setSmoothness(v); engineRef.current?.setSmoothness(v); setActivePreset(null); }} />
        <Knob label="PH\u2194WD" value={phraseWord} defaultValue={0.50} size={28} format={biasFmt} onChange={v => { setPhraseWord(v); engineRef.current?.setPhraseWord(v); setActivePreset(null); }} />
        <Knob label="PRES COMP" value={presComp} defaultValue={0.30} size={28} format={pctFmt} onChange={v => { setPresComp(v); engineRef.current?.setPresComp(v); setActivePreset(null); }} />
      </div>

      {/* Knobs row 2: OUTPUT */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'center',
        borderBottom: '1px solid rgba(140,70,220,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="OUTPUT" value={outputDb} min={-18} max={18} defaultValue={0} size={28} format={outDbFmt} sensitivity={120} onChange={v => { setOutputDb(v); engineRef.current?.setOutputDb(v); setActivePreset(null); }} />
      </div>

      {/* Bypass */}
      <div style={{
        padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} style={{
          width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
          background: bypassed ? 'rgba(10, 6, 18, 0.5)' : 'rgba(16, 10, 28, 0.7)',
          border: `1.5px solid ${bypassed ? 'rgba(120, 60, 200, 0.12)' : 'rgba(170, 100, 255, 0.35)'}`,
          boxShadow: bypassed ? 'none' : '0 0 12px rgba(150, 80, 240, 0.15)',
          animation: bypassed ? 'none' : 'priderPulse 3s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'border-color 0.3s, box-shadow 0.3s',
        }}>
          {/* Fader icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ opacity: bypassed ? 0.2 : 0.6 }}>
            <line x1="3" y1="2" x2="3" y2="10" stroke="rgba(170,100,255,0.6)" strokeWidth="0.8" />
            <line x1="6" y1="2" x2="6" y2="10" stroke="rgba(170,100,255,0.6)" strokeWidth="0.8" />
            <line x1="9" y1="2" x2="9" y2="10" stroke="rgba(170,100,255,0.6)" strokeWidth="0.8" />
            <rect x="1.5" y="4" width="3" height="2" rx="0.5" fill="rgba(170,100,255,0.5)" />
            <rect x="4.5" y="6" width="3" height="2" rx="0.5" fill="rgba(60,200,120,0.5)" />
            <rect x="7.5" y="3" width="3" height="2" rx="0.5" fill="rgba(170,100,255,0.5)" />
          </svg>
        </button>
        <span style={{
          fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
          color: bypassed ? 'rgba(120, 60, 200, 0.25)' : 'rgba(170, 100, 255, 0.45)',
          marginLeft: 6, textTransform: 'uppercase', fontFamily: 'system-ui',
        }}>{bypassed ? 'PARKED' : 'RIDING'}</span>
      </div>
    </div>
  );
}
