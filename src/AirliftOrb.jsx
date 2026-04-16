import { useState, useEffect, useRef, useCallback } from 'react';
import { createAirliftEngine } from './airliftEngine';
import PresetSelector from './PresetSelector';

// ─── AIRLIFT: Cloud / Sky Atmosphere ────────────────────────────────────────
// Luminous clouds that glow brighter with more air, golden light rays piercing
// through, particles drifting upward. Silk makes clouds softer/dreamier.
// Colors: gold, white, pale blue sky gradient.

// ─── Cloud Particle System ──────────────────────────────────────────────────
function SkyCanvas({ air, silk, shine, guard, mix, peakLevel, airLevel, guardActive }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ air: 0.4, silk: 0.5, shine: 0.3, guard: 0.5, mix: 1, peakLevel: 0, airLevel: 0, guardActive: 0 });
  const cloudsRef = useRef([]);
  const raysRef = useRef([]);
  const particlesRef = useRef([]);
  const phaseRef = useRef(0);

  valRef.current = { air, silk, shine, guard, mix, peakLevel, airLevel, guardActive };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 280;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize golden cloud puffs
    if (cloudsRef.current.length === 0) {
      for (let i = 0; i < 18; i++) {
        cloudsRef.current.push({
          x: Math.random() * W,
          y: H * 0.4 + Math.random() * H * 0.5,
          rx: 10 + Math.random() * 22,
          ry: 6 + Math.random() * 10,
          speed: 0.08 + Math.random() * 0.2,
          phase: Math.random() * Math.PI * 2,
          brightness: 0.5 + Math.random() * 0.5,
          vy: -(0.05 + Math.random() * 0.15),
        });
      }
    }

    // Initialize aurora curtain control points
    if (raysRef.current.length === 0) {
      for (let i = 0; i < 5; i++) {
        raysRef.current.push({
          baseX: W * 0.1 + (i / 4) * W * 0.8,
          amplitude: 15 + Math.random() * 25,
          speed: 0.3 + Math.random() * 0.5,
          hue: [140, 280, 320, 180, 300][i],
          width: 25 + Math.random() * 35,
          offset: Math.random() * Math.PI * 2,
        });
      }
    }

    // Initialize star field
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 60; i++) {
        particlesRef.current.push({
          x: Math.random() * W,
          y: Math.random() * H * 0.6,
          size: 0.3 + Math.random() * 1.5,
          twinkleSpeed: 1 + Math.random() * 3,
          twinklePhase: Math.random() * Math.PI * 2,
          brightness: 0.4 + Math.random() * 0.6,
          type: 'star',
        });
      }
    }

    // Sparkle burst array (dynamic)
    var sparkles = [];

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.014;
      const phase = phaseRef.current;
      const v = valRef.current;
      const reactivity = 0.3 + v.peakLevel * 0.7;

      // ── Dramatic sky gradient: deep space top to deep blue bottom ──
      var skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, 'rgba(5,3,20,1)');
      skyGrad.addColorStop(0.25, 'rgba(8,5,35,1)');
      skyGrad.addColorStop(0.5, 'rgba(10,15,55,1)');
      skyGrad.addColorStop(0.75, 'rgba(15,25,70,1)');
      skyGrad.addColorStop(1, 'rgba(20,35,80,1)');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Twinkling background stars ──
      var stars = particlesRef.current;
      for (var si = 0; si < stars.length; si++) {
        var st = stars[si];
        if (st.type !== 'star') continue;
        var twinkle = 0.3 + 0.7 * Math.pow(Math.sin(phase * st.twinkleSpeed + st.twinklePhase), 2);
        var sAlpha = st.brightness * twinkle * (0.5 + v.shine * 0.5);
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.size * (0.6 + twinkle * 0.4), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + sAlpha.toFixed(3) + ')';
        ctx.fill();
        // Cross sparkle on bright stars
        if (st.size > 1.0 && twinkle > 0.7) {
          var spkLen = st.size * 3 * twinkle;
          ctx.strokeStyle = 'rgba(255,255,255,' + (sAlpha * 0.4).toFixed(3) + ')';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(st.x - spkLen, st.y); ctx.lineTo(st.x + spkLen, st.y);
          ctx.moveTo(st.x, st.y - spkLen); ctx.lineTo(st.x, st.y + spkLen);
          ctx.stroke();
        }
      }

      // ── Aurora borealis curtains ──
      var auroraIntensity = 0.3 + v.air * 0.7;
      var silkSmooth = 0.3 + v.silk * 0.7;
      var curtains = raysRef.current;
      for (var ci = 0; ci < curtains.length; ci++) {
        var curtain = curtains[ci];
        var cHue = curtain.hue;
        var cWidth = curtain.width * (0.6 + v.air * 0.6);
        var cAlpha = auroraIntensity * (0.15 + reactivity * 0.2);

        // Draw curtain as a series of vertical strips with flowing motion
        for (var strip = 0; strip < 20; strip++) {
          var stripT = strip / 20;
          var stripX = curtain.baseX + Math.sin(phase * curtain.speed + stripT * 4 + curtain.offset) * curtain.amplitude * silkSmooth;
          stripX += Math.sin(phase * 0.3 + ci * 2) * 15;
          var stripTop = 5 + Math.sin(phase * 0.5 + stripT * 3 + ci) * 8;
          var stripBot = H * (0.5 + v.air * 0.35) + Math.sin(phase * 0.4 + stripT * 2) * 10;
          var stripW = cWidth / 20;

          var stripGrad = ctx.createLinearGradient(0, stripTop, 0, stripBot);
          var hShift = Math.sin(phase * 0.7 + stripT * 5 + ci) * 20;
          var h1 = cHue + hShift;
          var h2 = cHue + hShift + 30;
          stripGrad.addColorStop(0, 'hsla(' + Math.round(h1) + ',90%,70%,0)');
          stripGrad.addColorStop(0.2, 'hsla(' + Math.round(h1) + ',85%,65%,' + (cAlpha * 0.5).toFixed(3) + ')');
          stripGrad.addColorStop(0.5, 'hsla(' + Math.round(h2) + ',80%,60%,' + cAlpha.toFixed(3) + ')');
          stripGrad.addColorStop(0.8, 'hsla(' + Math.round(h2) + ',75%,55%,' + (cAlpha * 0.6).toFixed(3) + ')');
          stripGrad.addColorStop(1, 'hsla(' + Math.round(h1) + ',70%,50%,0)');

          ctx.fillStyle = stripGrad;
          ctx.fillRect(stripX - stripW * 0.5, stripTop, stripW + 1, stripBot - stripTop);
        }

        // Bright core line of the curtain
        ctx.beginPath();
        ctx.moveTo(curtain.baseX + Math.sin(phase * curtain.speed + curtain.offset) * curtain.amplitude * silkSmooth, 10);
        for (var pt = 1; pt <= 15; pt++) {
          var ptt = pt / 15;
          var px = curtain.baseX + Math.sin(phase * curtain.speed + ptt * 4 + curtain.offset) * curtain.amplitude * silkSmooth;
          px += Math.sin(phase * 0.3 + ci * 2) * 15;
          var py = 10 + ptt * (H * 0.55);
          ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'hsla(' + Math.round(cHue) + ',95%,80%,' + (cAlpha * 0.6).toFixed(3) + ')';
        ctx.lineWidth = 1.5 * silkSmooth;
        ctx.stroke();
      }

      // ── Wide aurora glow overlay ──
      var glowGrad = ctx.createLinearGradient(0, 0, W, 0);
      var g1a = 0.05 + v.air * 0.1;
      glowGrad.addColorStop(0, 'rgba(0,255,130,' + (g1a * reactivity).toFixed(3) + ')');
      glowGrad.addColorStop(0.3, 'rgba(100,0,255,' + (g1a * 0.7 * reactivity).toFixed(3) + ')');
      glowGrad.addColorStop(0.6, 'rgba(255,0,200,' + (g1a * 0.6 * reactivity).toFixed(3) + ')');
      glowGrad.addColorStop(1, 'rgba(0,220,255,' + (g1a * 0.8 * reactivity).toFixed(3) + ')');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, W, H * 0.7);

      // ── Golden cloud puffs drifting upward ──
      var clouds = cloudsRef.current;
      for (var i = 0; i < clouds.length; i++) {
        var c = clouds[i];
        c.x += c.speed * (0.4 + v.air * 0.6);
        c.y += c.vy * (0.5 + v.air * 0.5);
        if (c.x - c.rx > W + 15) { c.x = -c.rx - 10; c.y = H * 0.5 + Math.random() * H * 0.4; }
        if (c.y < -c.ry * 2) { c.y = H + c.ry; c.x = Math.random() * W; }

        var cy2 = c.y + Math.sin(phase * 0.4 + c.phase) * (3 + v.silk * 8);
        var bright = c.brightness * (0.5 + v.air * 0.6 + v.peakLevel * 0.3);
        var alpha2 = Math.min(0.85, bright);
        var rx2 = c.rx * (0.8 + v.silk * 0.5 + v.air * 0.3);
        var ry2 = c.ry * (0.8 + v.silk * 0.6);

        // Outer golden glow
        var cGrad = ctx.createRadialGradient(c.x, cy2, 0, c.x, cy2, rx2 * 1.8);
        cGrad.addColorStop(0, 'rgba(255,220,80,' + (alpha2 * 0.5).toFixed(3) + ')');
        cGrad.addColorStop(0.4, 'rgba(255,200,60,' + (alpha2 * 0.25).toFixed(3) + ')');
        cGrad.addColorStop(0.7, 'rgba(255,180,40,' + (alpha2 * 0.1).toFixed(3) + ')');
        cGrad.addColorStop(1, 'rgba(255,160,20,0)');
        ctx.beginPath();
        ctx.ellipse(c.x, cy2, rx2 * 1.8, ry2 * 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = cGrad;
        ctx.fill();

        // Cloud body
        for (var j = 0; j < 3; j++) {
          var ox = (j - 1) * rx2 * 0.35;
          var oy = (j === 1 ? -ry2 * 0.12 : ry2 * 0.08);
          var sr = 0.65 + j * 0.18;
          var cGrad2 = ctx.createRadialGradient(c.x + ox, cy2 + oy, 0, c.x + ox, cy2 + oy, rx2 * sr);
          var gR = Math.round(255);
          var gG = Math.round(210 + v.shine * 30);
          var gB = Math.round(80 + v.silk * 40);
          cGrad2.addColorStop(0, 'rgba(' + gR + ',' + gG + ',' + gB + ',' + (alpha2 * 0.6).toFixed(3) + ')');
          cGrad2.addColorStop(0.6, 'rgba(' + gR + ',' + (gG - 20) + ',' + (gB + 20) + ',' + (alpha2 * 0.25).toFixed(3) + ')');
          cGrad2.addColorStop(1, 'rgba(' + (gR - 30) + ',' + (gG - 30) + ',' + gB + ',0)');
          ctx.beginPath();
          ctx.ellipse(c.x + ox, cy2 + oy, rx2 * sr, ry2 * sr, 0, 0, Math.PI * 2);
          ctx.fillStyle = cGrad2;
          ctx.fill();
        }
      }

      // ── Sparkle bursts from SHINE ──
      if (v.shine > 0.2 && Math.random() < v.shine * 0.5 + v.peakLevel * 0.4) {
        sparkles.push({
          x: Math.random() * W,
          y: Math.random() * H * 0.7,
          size: 2 + Math.random() * 4 * v.shine,
          alpha: 0.8 + Math.random() * 0.2,
          decay: 0.03 + Math.random() * 0.04,
          hue: Math.random() > 0.5 ? 50 : (Math.random() > 0.5 ? 180 : 300),
        });
      }
      for (var k = sparkles.length - 1; k >= 0; k--) {
        var sp = sparkles[k];
        sp.alpha -= sp.decay;
        if (sp.alpha <= 0) { sparkles.splice(k, 1); continue; }
        // 4-point star shape
        var spR = sp.size * sp.alpha;
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(phase * 2 + k);
        ctx.beginPath();
        for (var ray = 0; ray < 4; ray++) {
          var rAngle = (ray / 4) * Math.PI * 2;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(rAngle) * spR * 2, Math.sin(rAngle) * spR * 2);
        }
        ctx.strokeStyle = 'hsla(' + sp.hue + ',100%,90%,' + sp.alpha.toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, spR * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + (sp.alpha * 0.9).toFixed(3) + ')';
        ctx.fill();
        ctx.restore();
      }
      if (sparkles.length > 60) sparkles.splice(0, sparkles.length - 60);

      // ── Guard shield barrier: cyan/red energy band ──
      if (v.guardActive > 0.05 || v.guard > 0.3) {
        var guardY = H * (0.65 + (1 - v.guard) * 0.2);
        var guardAlpha = 0.15 + (v.guardActive > 0.05 ? v.guardActive * 0.5 : 0);
        var guardWidth = 6 + v.guard * 8;
        // Shield line
        ctx.beginPath();
        for (var gx = 0; gx < W; gx += 2) {
          var gy = guardY + Math.sin(gx * 0.05 + phase * 3) * 3;
          if (gx === 0) ctx.moveTo(gx, gy); else ctx.lineTo(gx, gy);
        }
        ctx.strokeStyle = 'rgba(255,80,60,' + Math.min(0.8, guardAlpha).toFixed(3) + ')';
        ctx.lineWidth = 2 + v.guardActive * 3;
        ctx.stroke();
        // Shield glow
        var shieldGrad = ctx.createLinearGradient(0, guardY - guardWidth, 0, guardY + guardWidth);
        shieldGrad.addColorStop(0, 'rgba(255,60,40,0)');
        shieldGrad.addColorStop(0.4, 'rgba(255,100,60,' + (guardAlpha * 0.3).toFixed(3) + ')');
        shieldGrad.addColorStop(0.5, 'rgba(0,220,255,' + (guardAlpha * 0.2).toFixed(3) + ')');
        shieldGrad.addColorStop(0.6, 'rgba(255,100,60,' + (guardAlpha * 0.3).toFixed(3) + ')');
        shieldGrad.addColorStop(1, 'rgba(255,60,40,0)');
        ctx.fillStyle = shieldGrad;
        ctx.fillRect(0, guardY - guardWidth, W, guardWidth * 2);
      }

      // ── Floating rising particles (lifted air) ──
      if (Math.random() < v.air * 0.5 + v.peakLevel * 0.4) {
        var pHue = Math.random() > 0.6 ? 45 : (Math.random() > 0.5 ? 160 : 290);
        sparkles.push({
          x: Math.random() * W,
          y: H + 3,
          size: 1.5 + Math.random() * 2.5,
          alpha: 0.6 + Math.random() * 0.4,
          decay: 0.005 + Math.random() * 0.005,
          hue: pHue,
          isParticle: true,
          vy: -(0.4 + Math.random() * 0.8 + v.air * 0.6),
          vx: (Math.random() - 0.5) * 0.4,
        });
      }
      for (var pi = sparkles.length - 1; pi >= 0; pi--) {
        var pp = sparkles[pi];
        if (!pp.isParticle) continue;
        pp.x += pp.vx + Math.sin(phase * 1.5 + pp.x * 0.02) * 0.3;
        pp.y += pp.vy;
        pp.alpha -= pp.decay;
        if (pp.y < -5 || pp.alpha <= 0) { sparkles.splice(pi, 1); continue; }
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.size, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + pp.hue + ',80%,75%,' + pp.alpha.toFixed(3) + ')';
        ctx.fill();
        // Glow
        var pGlow = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, pp.size * 3);
        pGlow.addColorStop(0, 'hsla(' + pp.hue + ',90%,80%,' + (pp.alpha * 0.3).toFixed(3) + ')');
        pGlow.addColorStop(1, 'hsla(' + pp.hue + ',80%,60%,0)');
        ctx.fillStyle = pGlow;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.size * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (sparkles.length > 120) sparkles.splice(0, sparkles.length - 120);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 280, display: 'block', borderRadius: 2 }} />;
}

// ─── Knob Component ─────────────────────────────────────────────────────────
function AirliftKnob({ size = 36, norm = 0 }) {
  const pillW = Math.round(size * 0.45);
  const pillH = size;
  const fillPct = norm * 100;
  const id = useRef(`ak-${Math.random().toString(36).slice(2, 7)}`).current;

  return (
    <div style={{ width: pillW, height: pillH, pointerEvents: 'none', position: 'relative', borderRadius: pillW / 2, border: '1px solid rgba(100,200,255,0.3)', overflow: 'hidden', background: 'rgba(8,12,30,0.92)', boxShadow: '0 0 8px rgba(30,80,220,0.25), inset 0 0 6px rgba(0,0,0,0.5)' }}>
      {/* Aurora fill from bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: `${fillPct}%`,
        background: `linear-gradient(to top, rgba(30,60,180,1) 0%, rgba(60,200,120,0.8) 55%, rgba(220,200,80,0.6) 100%)`,
        borderRadius: `0 0 ${pillW / 2}px ${pillW / 2}px`,
        transition: 'height 0.04s',
      }} />
      {/* Bright horizontal line at top of fill */}
      {norm > 0.01 && (
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          bottom: `calc(${fillPct}% - 1px)`,
          height: 2,
          background: 'rgba(160,240,255,0.95)',
          boxShadow: '0 0 5px rgba(120,220,255,0.9)',
        }} />
      )}
    </div>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 36, format, sensitivity = 160 }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : Math.round(norm * 100);

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  const onDblClick = () => onChange(defaultValue ?? (min + max) / 2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: Math.max(size + 14, Math.round(size * 0.45) + 14) }}>
      <div onPointerDown={onDown} onDoubleClick={onDblClick}
        style={{ width: Math.round(size * 0.45), height: size, cursor: dragging ? 'grabbing' : 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AirliftKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: '#e0d8c0', fontWeight: 700, textAlign: 'center', lineHeight: 1.1,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(255,210,120,0.5)', fontFamily: '"Courier New",monospace', fontWeight: 600,
      }}>{display}</span>
    </div>
  );
}

// ─── Vertical slider ────────────────────────────────────────────────────────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{ width: 10, height, background: '#0c0a14', borderRadius: 2, border: '1px solid rgba(200,180,120,0.12)', position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: 'rgba(255,210,100,0.06)', borderRadius: 1, transition: dragging ? 'none' : 'height 0.05s' }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: '#ffd870', bottom: `calc(${norm * 100}% - 2px)`, boxShadow: '0 0 6px rgba(255,210,100,0.3)' }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(220,210,180,0.45)', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(255,210,120,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── LED Meter ──────────────────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeter({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: '#0a0812', padding: '3px 2px', borderRadius: 2, border: '1px solid rgba(200,180,120,0.08)' }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: 'rgba(255,210,100,0.05)' }} />
      ))}
    </div>
  );
}

function DbReadout({ dbRef }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: 'rgba(255,210,120,0.4)', letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block' }}>-\u221E<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff6040' : i >= METER_SEGMENTS - 4 ? '#ffc060' : '#ffd870';
    segmentEls[i].style.background = lit ? col : 'rgba(255,210,100,0.05)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
    const clr = dbVal > -1 ? '#ff6040' : dbVal > -6 ? '#ffc060' : 'rgba(255,210,120,0.4)';
    dbEl.style.color = clr;
    dbEl.firstChild.textContent = display;
  }
}

// ─── Presets ────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'POP AIR',          air: 0.55, silk: 0.4,  shine: 0.5, guard: 0.5, mix: 1.0, output: 0.5 },
  { name: 'SILK VOCAL LIFT',  air: 0.35, silk: 0.8,  shine: 0.3, guard: 0.6, mix: 0.85, output: 0.52 },
  { name: 'BRIGHT BUT SAFE',  air: 0.7,  silk: 0.35, shine: 0.7, guard: 0.75, mix: 0.9, output: 0.48 },
  { name: 'BREATHY HOOK',     air: 0.45, silk: 0.65, shine: 0.2, guard: 0.4, mix: 1.0, output: 0.5 },
];

// ─── Main Airlift Orb ──────────────────────────────────────────────────────
export default function AirliftOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [air,        setAir]        = useState(initialState?.air        ?? 0.4);
  const [silk,       setSilk]       = useState(initialState?.silk       ?? 0.5);
  const [shine,      setShine]      = useState(initialState?.shine      ?? 0.3);
  const [guard,      setGuard]      = useState(initialState?.guard      ?? 0.5);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 1.0);
  const [outputLevel, setOutputLevel] = useState(initialState?.outputLevel ?? 0.5);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel,  setPeakLevel]  = useState(0);
  const [airLevel,   setAirLevel]   = useState(0);
  const [guardActive, setGuardActive] = useState(0);

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, air, silk, shine, guard, mix, outputLevel, bypassed };

  // ── Engine init ──
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createAirliftEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setAir(s.air);
      eng.setSilk(s.silk);
      eng.setShine(s.shine);
      eng.setGuard(s.guard);
      eng.setMix(s.mix);
      eng.setOutput(s.outputLevel);
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
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setPeakLevel(engineRef.current.getInputPeak());
        setAirLevel(engineRef.current.getAirLevel());
        setGuardActive(engineRef.current.getGuardActive());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ──
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, air, silk, shine, guard, mix, outputLevel, bypassed, preset: activePreset });
  }, [inputGain, outputGain, air, silk, shine, guard, mix, outputLevel, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setAir(p.air); setSilk(p.silk); setShine(p.shine);
    setGuard(p.guard); setMix(p.mix); setOutputLevel(p.output);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setAir(p.air); e.setSilk(p.silk); e.setShine(p.shine);
      e.setGuard(p.guard); e.setMix(p.mix); e.setOutput(p.output);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outFmt = v => { const db = -18 + v * 36; return `${db >= 0 ? '+' : ''}${db.toFixed(1)}dB`; };

  const presetColors = {
    bg: '#141018', text: '#ffd870', textDim: 'rgba(255,210,100,0.5)',
    border: 'rgba(255,210,100,0.15)', hoverBg: 'rgba(255,210,100,0.1)', activeBg: 'rgba(255,210,100,0.06)',
  };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #1a1428 0%, #120e20 30%, #0e0a18 60%, #0a0814 100%)',
      border: '1.5px solid rgba(255,210,100,0.15)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(255,210,100,0.08), inset 0 1px 0 rgba(255,230,160,0.06)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,210,100,0.1)',
        background: 'linear-gradient(180deg, rgba(255,210,100,0.03) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.06em',
            background: 'linear-gradient(135deg, #ffd870, #ffe8a0, #ffcc50)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            textShadow: 'none', filter: 'drop-shadow(0 0 6px rgba(255,210,100,0.3))',
          }}>AIRLIFT</span>
          <span style={{
            fontSize: 6, fontWeight: 700, color: 'rgba(200,190,160,0.4)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>VOCAL AIR ENHANCER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(255,210,100,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; e.currentTarget.style.background = 'transparent'; }}
          >&times;</span>}
        </div>
      </div>

      {/* Visual */}
      <div style={{ borderBottom: '1px solid rgba(255,210,100,0.08)' }}>
        <SkyCanvas air={air} silk={silk} shine={shine} guard={guard} mix={mix}
          peakLevel={peakLevel} airLevel={airLevel} guardActive={guardActive} />
      </div>

      {/* Meters + gain sliders */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(255,210,100,0.08)',
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeter meterRef={inMeterRef} />
        <DbReadout dbRef={inDbRef} />
        <div style={{ width: 8 }} />
        <DbReadout dbRef={outDbRef} />
        <LedMeter meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Main knobs row 1: AIR, SILK, SHINE */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(255,210,100,0.06)',
      }}>
        <Knob label="AIR" value={air} min={0} max={1} defaultValue={0.4} size={28}
          onChange={v => { setAir(v); engineRef.current?.setAir(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="SILK" value={silk} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setSilk(v); engineRef.current?.setSilk(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="SHINE" value={shine} min={0} max={1} defaultValue={0.3} size={28}
          onChange={v => { setShine(v); engineRef.current?.setShine(v); setActivePreset(null); }} format={pctFmt} />
      </div>

      {/* Main knobs row 2: GUARD, MIX, OUTPUT */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(255,210,100,0.06)',
      }}>
        <Knob label="GUARD" value={guard} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setGuard(v); engineRef.current?.setGuard(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={1.0} size={28}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="OUTPUT" value={outputLevel} min={0} max={1} defaultValue={0.5} size={28}
          onChange={v => { setOutputLevel(v); engineRef.current?.setOutput(v); setActivePreset(null); }} format={outFmt} />
      </div>

      {/* Bypass */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6,
      }}>
        {/* Guard active indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginRight: 'auto' }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: guardActive > 0.1 ? '#ff8060' : 'rgba(255,128,96,0.15)',
            boxShadow: guardActive > 0.1 ? '0 0 6px rgba(255,128,96,0.5)' : 'none',
            transition: 'all 0.1s',
          }} />
          <span style={{ fontSize: 5, color: 'rgba(200,180,150,0.35)', letterSpacing: '0.1em', fontWeight: 600 }}>GUARD</span>
        </div>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
          style={{
            fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
            padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
            background: bypassed ? 'rgba(60,50,40,0.5)' : 'rgba(255,210,100,0.12)',
            color: bypassed ? 'rgba(180,170,150,0.3)' : '#ffd870',
            border: `1px solid ${bypassed ? 'rgba(80,70,60,0.2)' : 'rgba(255,210,100,0.25)'}`,
            boxShadow: bypassed ? 'none' : '0 0 8px rgba(255,210,100,0.1)',
          }}>
          {bypassed ? 'BYPASSED' : 'ACTIVE'}
        </button>
      </div>
    </div>
  );
}
