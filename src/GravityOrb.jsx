import { useState, useEffect, useRef, useCallback } from 'react';
import { createGravityEngine } from './gravityEngine';
import PresetSelector from './PresetSelector';

// ─── GRAVITY: Black Hole / Gravitational Field Visualization ────────────────
// Particles orbiting a center point, pulled tighter or floating wider based on gravity.
// Bloom creates expanding nebula-like clouds. Space size changes orbit radius.
// Colors: deep space indigo/purple with white particle trails and blue lensing.

// ─── Gravitational Field Canvas ─────────────────────────────────────────────
function GravityField({ space, gravity, bloom, density, color, width, mix, peakLevel, reverbLevel }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ space: 0.4, gravity: 0.5, bloom: 0.3, density: 0.5, color: 0.5, width: 0.6, mix: 0.3, peakLevel: 0, reverbLevel: 0 });
  const particlesRef = useRef([]);
  const nebulaRef = useRef([]);
  const phaseRef = useRef(0);

  valRef.current = { space, gravity, bloom, density, color, width, mix, peakLevel, reverbLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 280, H = 160;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Initialize orbiting particles (increased to 90)
    if (particlesRef.current.length === 0) {
      for (var pi = 0; pi < 90; pi++) {
        var angle = Math.random() * Math.PI * 2;
        var dist = 15 + Math.random() * 70;
        particlesRef.current.push({
          angle: angle, dist: dist,
          baseSpeed: 0.004 + Math.random() * 0.012,
          size: 0.5 + Math.random() * 2.0,
          brightness: 0.4 + Math.random() * 0.6,
          trail: [],
          hueOffset: Math.random() * 60 - 30,
          layer: pi < 30 ? 0 : (pi < 60 ? 1 : 2),
        });
      }
    }

    // Stars array for background
    var stars = [];
    for (var si = 0; si < 60; si++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        size: 0.3 + Math.random() * 1.2,
        twinkleSpeed: 0.8 + Math.random() * 2.5,
        phase: Math.random() * 6.28,
      });
    }

    // Jet flare state
    var jetTimer = 0;
    var jetActive = 0;

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      phaseRef.current += 0.012;
      var phase = phaseRef.current;
      var v = valRef.current;
      var cx = W * 0.5, cy = H * 0.5;
      var reactivity = 0.2 + v.peakLevel * 0.8;
      var rvLevel = Math.min(1, v.reverbLevel * 3);

      // ── Deep space background with purple/indigo nebula ──
      var bgGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, W * 0.65);
      bgGrad.addColorStop(0, 'rgba(10,5,30,1)');
      bgGrad.addColorStop(0.3, 'rgba(8,3,25,1)');
      bgGrad.addColorStop(0.6, 'rgba(5,2,18,1)');
      bgGrad.addColorStop(1, 'rgba(2,1,8,1)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Background nebula color clouds ──
      var nebR1 = 60 + Math.sin(phase * 0.2) * 15;
      var nebGrad1 = ctx.createRadialGradient(W * 0.25, H * 0.3, 0, W * 0.25, H * 0.3, nebR1);
      nebGrad1.addColorStop(0, 'rgba(100,20,160,' + (0.06 + v.bloom * 0.08).toFixed(3) + ')');
      nebGrad1.addColorStop(0.6, 'rgba(60,10,120,' + (0.03 + v.bloom * 0.04).toFixed(3) + ')');
      nebGrad1.addColorStop(1, 'rgba(30,5,80,0)');
      ctx.fillStyle = nebGrad1;
      ctx.beginPath(); ctx.arc(W * 0.25, H * 0.3, nebR1, 0, Math.PI * 2); ctx.fill();

      var nebGrad2 = ctx.createRadialGradient(W * 0.78, H * 0.65, 0, W * 0.78, H * 0.65, nebR1 * 0.8);
      nebGrad2.addColorStop(0, 'rgba(20,40,160,' + (0.05 + v.bloom * 0.07).toFixed(3) + ')');
      nebGrad2.addColorStop(0.6, 'rgba(10,20,100,' + (0.03 + v.bloom * 0.04).toFixed(3) + ')');
      nebGrad2.addColorStop(1, 'rgba(5,10,60,0)');
      ctx.fillStyle = nebGrad2;
      ctx.beginPath(); ctx.arc(W * 0.78, H * 0.65, nebR1 * 0.8, 0, Math.PI * 2); ctx.fill();

      // ── Twinkling stars ──
      for (var sti = 0; sti < stars.length; sti++) {
        var star = stars[sti];
        var twinkle = 0.3 + 0.7 * Math.pow(Math.sin(phase * star.twinkleSpeed + star.phase), 2);
        var stAlpha = twinkle * 0.7;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * (0.5 + twinkle * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220,230,255,' + stAlpha.toFixed(3) + ')';
        ctx.fill();
        if (star.size > 0.9 && twinkle > 0.75) {
          var sLen = star.size * 3;
          ctx.strokeStyle = 'rgba(200,220,255,' + (stAlpha * 0.3).toFixed(3) + ')';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.moveTo(star.x - sLen, star.y); ctx.lineTo(star.x + sLen, star.y);
          ctx.moveTo(star.x, star.y - sLen); ctx.lineTo(star.x, star.y + sLen);
          ctx.stroke();
        }
      }

      // ── Bloom nebula clouds (dynamic, spawning) ──
      if (v.bloom > 0.05) {
        var lensR2 = 25 + v.space * 40;
        if (Math.random() < v.bloom * 0.15 + rvLevel * 0.1) {
          var nAngle = Math.random() * Math.PI * 2;
          var nDist = lensR2 * 0.4 + Math.random() * lensR2 * 0.8;
          nebulaRef.current.push({
            x: cx + Math.cos(nAngle) * nDist,
            y: cy + Math.sin(nAngle) * nDist,
            r: 6 + Math.random() * 20 * v.bloom,
            alpha: 0.08 + Math.random() * 0.12,
            hue: 220 + Math.random() * 100 - 30,
            life: 1,
          });
        }
        var neb = nebulaRef.current;
        for (var ni = neb.length - 1; ni >= 0; ni--) {
          var nb = neb[ni];
          nb.r += 0.15 * v.bloom;
          nb.life -= 0.004;
          if (nb.life <= 0) { neb.splice(ni, 1); continue; }
          var nGrad = ctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
          nGrad.addColorStop(0, 'hsla(' + Math.round(nb.hue) + ',70%,55%,' + (nb.alpha * nb.life).toFixed(3) + ')');
          nGrad.addColorStop(0.5, 'hsla(' + Math.round(nb.hue + 30) + ',60%,40%,' + (nb.alpha * nb.life * 0.5).toFixed(3) + ')');
          nGrad.addColorStop(1, 'hsla(' + Math.round(nb.hue) + ',50%,30%,0)');
          ctx.fillStyle = nGrad;
          ctx.beginPath(); ctx.arc(nb.x, nb.y, nb.r, 0, Math.PI * 2); ctx.fill();
        }
        if (neb.length > 60) neb.splice(0, neb.length - 60);
      }

      // ── Accretion disk (elliptical, multi-layered, colorful) ──
      var holeR = 8 + v.gravity * 8 - v.space * 2;
      var diskR = holeR + 8 + v.space * 35 + v.peakLevel * 10;
      var diskSquash = 0.35 + v.width * 0.25;

      // Outer disk glow bands (orange -> yellow -> white hot)
      for (var dri = 5; dri >= 0; dri--) {
        var drFrac = dri / 5;
        var drR = diskR * (0.5 + drFrac * 0.6);
        var drHue = 30 - drFrac * 30;
        var drLightness = 50 + (1 - drFrac) * 35;
        var drAlpha = (0.1 + rvLevel * 0.2 + reactivity * 0.15) * (0.5 + drFrac * 0.5);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, diskSquash);
        ctx.rotate(0.1 + phase * 0.02);
        ctx.beginPath();
        ctx.arc(0, 0, drR, 0, Math.PI * 2);
        ctx.strokeStyle = 'hsla(' + Math.round(drHue) + ',100%,' + Math.round(drLightness) + '%,' + drAlpha.toFixed(3) + ')';
        ctx.lineWidth = 3 + (1 - drFrac) * 5 + v.peakLevel * 3;
        ctx.stroke();
        ctx.restore();
      }

      // Inner white-hot ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, diskSquash);
      ctx.rotate(0.1 + phase * 0.02);
      ctx.beginPath();
      ctx.arc(0, 0, holeR + 3 + v.peakLevel * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,240,' + (0.2 + rvLevel * 0.4 + v.peakLevel * 0.3).toFixed(3) + ')';
      ctx.lineWidth = 2 + v.peakLevel * 2;
      ctx.stroke();
      ctx.restore();

      // ── Chromatic gravitational lensing (rainbow arcs near event horizon) ──
      var lensColors = [[255,60,60],[255,180,40],[255,255,60],[60,255,100],[60,180,255],[140,80,255]];
      for (var li = 0; li < lensColors.length; li++) {
        var lc = lensColors[li];
        var llR = holeR * 1.6 + li * 2.5 + Math.sin(phase * 0.5 + li) * 1.5;
        var llAlpha = (0.08 + rvLevel * 0.15 + v.peakLevel * 0.1) * (0.4 + v.gravity * 0.6);
        ctx.beginPath();
        var lStart = phase * 0.15 + li * 0.5;
        ctx.arc(cx, cy, llR, lStart, lStart + Math.PI * 0.6 + v.gravity * 0.5);
        ctx.strokeStyle = 'rgba(' + lc[0] + ',' + lc[1] + ',' + lc[2] + ',' + llAlpha.toFixed(3) + ')';
        ctx.lineWidth = 1.5 + v.peakLevel;
        ctx.stroke();
      }

      // ── Orbiting particles with long trails ──
      var orbitRadius = 20 + v.space * 55;
      var gravPull = 0.3 + v.gravity * 0.7;
      var pts = particlesRef.current;

      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var speedMult = 0.5 + gravPull * 2.0 + reactivity * 0.6;
        pt.angle += pt.baseSpeed * speedMult;

        var targetDist = pt.dist * (1 - v.gravity * 0.55) * (0.5 + v.space * 0.75);
        var wobble = Math.sin(phase * 0.5 + i * 0.3) * (5 + v.bloom * 18);
        var currentDist = targetDist + wobble;
        var vertSquash = 0.5 + v.width * 0.5;

        var px = cx + Math.cos(pt.angle) * currentDist;
        var py = cy + Math.sin(pt.angle) * currentDist * vertSquash;

        // Longer trails (up to 16 points)
        pt.trail.push({ x: px, y: py });
        if (pt.trail.length > 16) pt.trail.shift();

        // Draw trail with gradient fade
        if (pt.trail.length > 2) {
          for (var t = 1; t < pt.trail.length; t++) {
            var tAlpha = (t / pt.trail.length) * pt.brightness * 0.25 * reactivity;
            var tHue = 20 + pt.hueOffset + v.color * 60 + t * 3;
            ctx.beginPath();
            ctx.moveTo(pt.trail[t - 1].x, pt.trail[t - 1].y);
            ctx.lineTo(pt.trail[t].x, pt.trail[t].y);
            ctx.strokeStyle = 'hsla(' + Math.round(tHue) + ',70%,75%,' + tAlpha.toFixed(3) + ')';
            ctx.lineWidth = pt.size * (0.3 + t / pt.trail.length * 0.7);
            ctx.stroke();
          }
        }

        // Draw particle with glow
        var pAlpha = pt.brightness * (0.5 + reactivity * 0.5);
        var pHue = 20 + pt.hueOffset + v.color * 60;
        ctx.beginPath();
        ctx.arc(px, py, pt.size * (0.8 + reactivity * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + Math.round(pHue) + ',60%,85%,' + pAlpha.toFixed(3) + ')';
        ctx.fill();

        // Hot glow on closer particles
        if (currentDist < orbitRadius * 0.5) {
          var hotGlow = ctx.createRadialGradient(px, py, 0, px, py, pt.size * 4);
          hotGlow.addColorStop(0, 'rgba(255,200,100,' + (pAlpha * 0.3).toFixed(3) + ')');
          hotGlow.addColorStop(1, 'rgba(255,150,50,0)');
          ctx.fillStyle = hotGlow;
          ctx.beginPath(); ctx.arc(px, py, pt.size * 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ── Center black hole with deep shadow ──
      var holeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, holeR * 3.5);
      holeGrad.addColorStop(0, 'rgba(0,0,0,1)');
      holeGrad.addColorStop(0.25, 'rgba(2,0,8,0.95)');
      holeGrad.addColorStop(0.5, 'rgba(20,10,50,' + (0.15 + rvLevel * 0.2).toFixed(3) + ')');
      holeGrad.addColorStop(0.75, 'rgba(40,15,80,' + (0.06 + rvLevel * 0.08).toFixed(3) + ')');
      holeGrad.addColorStop(1, 'rgba(30,10,60,0)');
      ctx.fillStyle = holeGrad;
      ctx.beginPath(); ctx.arc(cx, cy, holeR * 3.5, 0, Math.PI * 2); ctx.fill();

      // Core absolute black
      ctx.beginPath();
      ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();

      // Edge ring glow (white-hot inner edge)
      ctx.beginPath();
      ctx.arc(cx, cy, holeR + 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,240,200,' + (0.15 + rvLevel * 0.3 + v.peakLevel * 0.3).toFixed(3) + ')';
      ctx.lineWidth = 1.5 + v.peakLevel * 2;
      ctx.stroke();

      // ── Polar jets (occasional bright flares) ──
      jetTimer += 0.016;
      if (v.peakLevel > 0.6 && jetTimer > 2) {
        jetActive = 1;
        jetTimer = 0;
      }
      if (jetActive > 0) {
        jetActive -= 0.02;
        var jetAlpha = jetActive * 0.6;
        var jetLen = 30 + v.peakLevel * 30;
        // Top jet
        var topJet = ctx.createLinearGradient(cx, cy - holeR, cx, cy - holeR - jetLen);
        topJet.addColorStop(0, 'rgba(180,160,255,' + jetAlpha.toFixed(3) + ')');
        topJet.addColorStop(0.3, 'rgba(100,140,255,' + (jetAlpha * 0.6).toFixed(3) + ')');
        topJet.addColorStop(1, 'rgba(60,80,200,0)');
        ctx.fillStyle = topJet;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy - holeR);
        ctx.lineTo(cx, cy - holeR - jetLen);
        ctx.lineTo(cx + 3, cy - holeR);
        ctx.closePath();
        ctx.fill();
        // Bottom jet
        var botJet = ctx.createLinearGradient(cx, cy + holeR, cx, cy + holeR + jetLen);
        botJet.addColorStop(0, 'rgba(180,160,255,' + jetAlpha.toFixed(3) + ')');
        botJet.addColorStop(0.3, 'rgba(100,140,255,' + (jetAlpha * 0.6).toFixed(3) + ')');
        botJet.addColorStop(1, 'rgba(60,80,200,0)');
        ctx.fillStyle = botJet;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + holeR);
        ctx.lineTo(cx, cy + holeR + jetLen);
        ctx.lineTo(cx + 3, cy + holeR);
        ctx.closePath();
        ctx.fill();
      }

      // ── Inner glow pulse ──
      if (v.peakLevel > 0.15) {
        var pulseR = holeR + 2 + v.peakLevel * 12;
        var pGrad = ctx.createRadialGradient(cx, cy, holeR, cx, cy, pulseR);
        pGrad.addColorStop(0, 'rgba(160,120,255,' + (v.peakLevel * 0.4).toFixed(3) + ')');
        pGrad.addColorStop(0.5, 'rgba(100,60,220,' + (v.peakLevel * 0.2).toFixed(3) + ')');
        pGrad.addColorStop(1, 'rgba(60,30,160,0)');
        ctx.fillStyle = pGrad;
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2); ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 280, height: 160, display: 'block', borderRadius: 2 }} />;
}

// ─── Knob ───────────────────────────────────────────────────────────────────
function GravityKnob({ size = 36, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,14,20,0.9)"
        stroke="rgba(120,140,180,0.08)" strokeWidth="1.5" />
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke="hsla(270,65%,55%,0.7)"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill="hsla(270,80%,70%,0.9)" />
      <circle cx={dotX} cy={dotY} r="4"
        fill="hsla(270,80%,70%,0.12)" />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
    </svg>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 8 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <GravityKnob size={size} norm={norm} />
      </div>
      <span style={{
        fontSize: 6, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'rgba(180,170,220,0.7)', fontWeight: 700, textAlign: 'center', lineHeight: 1.1,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: 'rgba(140,120,220,0.45)', fontFamily: '"Courier New",monospace', fontWeight: 600,
      }}>{display}</span>
    </div>
  );
}

// ─── VSlider ────────────────────────────────────────────────────────────────
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
        style={{ width: 10, height, background: '#06040e', borderRadius: 2, border: '1px solid rgba(120,100,200,0.1)', position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: 'rgba(120,100,220,0.06)', borderRadius: 1 }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: '#8070c0', bottom: `calc(${norm * 100}% - 2px)`, boxShadow: '0 0 6px rgba(120,100,200,0.3)' }} />
      </div>
      <span style={{ fontSize: 5, color: 'rgba(160,150,200,0.4)', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: 'rgba(140,120,220,0.35)', fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── LED Meter ──────────────────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeter({ meterRef }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: '#06040e', padding: '3px 2px', borderRadius: 2, border: '1px solid rgba(120,100,200,0.08)' }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: 'rgba(120,100,220,0.05)' }} />
      ))}
    </div>
  );
}

function DbReadout({ dbRef }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: 'rgba(140,120,220,0.4)', width: 28, textAlign: 'center', display: 'inline-block' }}>-{'\u221E'}<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#c080ff' : '#8070c0';
    segmentEls[i].style.background = lit ? col : 'rgba(120,100,220,0.05)';
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
    dbEl.style.color = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#c080ff' : 'rgba(140,120,220,0.4)';
    dbEl.firstChild.textContent = display;
  }
}

// ─── Presets ────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'VOCAL GRAVITY PLATE',    space: 0.3,  gravity: 0.6, bloom: 0.2,  density: 0.6, color: 0.55, width: 0.5,  mix: 0.25, output: 0.5,  smooth: 0 },
  { name: 'CINEMATIC BLOOM HALL',   space: 0.75, gravity: 0.3, bloom: 0.7,  density: 0.5, color: 0.45, width: 0.7,  mix: 0.35, output: 0.48, smooth: 0 },
  { name: 'TIGHT CHAMBER PULL',     space: 0.15, gravity: 0.8, bloom: 0.1,  density: 0.7, color: 0.5,  width: 0.4,  mix: 0.3,  output: 0.52, smooth: 0 },
  { name: 'FLOATING AMBIENT SPACE', space: 0.9,  gravity: 0.15,bloom: 0.8,  density: 0.4, color: 0.4,  width: 0.85, mix: 0.45, output: 0.46, smooth: 0 },
  { name: 'DRUM GRAVITY ROOM',      space: 0.25, gravity: 0.7, bloom: 0.15, density: 0.8, color: 0.6,  width: 0.55, mix: 0.2,  output: 0.52, smooth: 0 },
];

// ─── Main Gravity Orb ──────────────────────────────────────────────────────
export default function GravityOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [space,      setSpace]      = useState(initialState?.space      ?? 0.4);
  const [gravity,    setGravity]    = useState(initialState?.gravity    ?? 0.5);
  const [bloom,      setBloom]      = useState(initialState?.bloom      ?? 0.3);
  const [density,    setDensity]    = useState(initialState?.density    ?? 0.5);
  const [color,      setColor]      = useState(initialState?.color      ?? 0.5);
  const [width,      setWidth]      = useState(initialState?.width      ?? 0.6);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 0.3);
  const [outputLevel, setOutputLevel] = useState(initialState?.outputLevel ?? 0.5);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [smooth,     setSmooth]     = useState(initialState?.smooth     ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel,  setPeakLevel]  = useState(0);
  const [reverbLevel, setReverbLevel] = useState(0);

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, space, gravity, bloom, density, color, width, mix, outputLevel, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createGravityEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSpace(s.space); eng.setGravity(s.gravity); eng.setBloom(s.bloom);
      eng.setDensity(s.density); eng.setColor(s.color); eng.setWidth(s.width);
      eng.setMix(s.mix); eng.setOutput(s.outputLevel); eng.setBypass(s.bypassed); eng.setSmooth(s.smooth);
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

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak());
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak());
        setPeakLevel(engineRef.current.getInputPeak());
        setReverbLevel(engineRef.current.getReverbLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, space, gravity, bloom, density, color, width, mix, outputLevel, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, space, gravity, bloom, density, color, width, mix, outputLevel, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setSpace(p.space); setGravity(p.gravity); setBloom(p.bloom);
    setDensity(p.density); setColor(p.color); setWidth(p.width);
    setMix(p.mix); setOutputLevel(p.output); setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    const e = engineRef.current;
    if (e) {
      e.setSpace(p.space); e.setGravity(p.gravity); e.setBloom(p.bloom);
      e.setDensity(p.density); e.setColor(p.color); e.setWidth(p.width);
      e.setMix(p.mix); e.setOutput(p.output);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outFmt = v => { const db = -18 + v * 36; return `${db >= 0 ? '+' : ''}${db.toFixed(1)}dB`; };

  const presetColors = {
    bg: '#08061a', text: '#b0a0e0', textDim: 'rgba(160,140,220,0.5)',
    border: 'rgba(120,100,200,0.15)', hoverBg: 'rgba(120,100,220,0.1)', activeBg: 'rgba(120,100,220,0.06)',
  };

  return (
    <div style={{
      width: 300, borderRadius: 6, position: 'relative',
      background: 'linear-gradient(170deg, #0e0a20 0%, #08061a 35%, #050312 70%, #030210 100%)',
      border: '1.5px solid rgba(120,100,200,0.15)',
      boxShadow: '0 4px 30px rgba(0,0,0,0.9), 0 0 25px rgba(80,60,160,0.1), inset 0 1px 0 rgba(160,140,220,0.05)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(120,100,200,0.1)',
        background: 'linear-gradient(180deg, rgba(80,60,160,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 15, fontWeight: 900, letterSpacing: '0.1em',
            background: 'linear-gradient(135deg, #a090e0, #c0b0ff, #8070c0)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 8px rgba(120,100,220,0.3))',
          }}>GRAVITY</span>
          <span style={{
            fontSize: 5, fontWeight: 700, color: 'rgba(160,140,200,0.35)',
            letterSpacing: '0.35em', marginTop: 1,
          }}>BEHAVIORAL REVERB</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: 'rgba(140,120,220,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; }}
          >&times;</span>}
        </div>
      </div>

      {/* Visual */}
      <div style={{ borderBottom: '1px solid rgba(120,100,200,0.08)' }}>
        <GravityField space={space} gravity={gravity} bloom={bloom} density={density}
          color={color} width={width} mix={mix} peakLevel={peakLevel} reverbLevel={reverbLevel} />
      </div>

      {/* Meters */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: '1px solid rgba(120,100,200,0.08)',
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeter meterRef={inMeterRef} />
        <DbReadout dbRef={inDbRef} />
        <div style={{ width: 6 }} />
        <DbReadout dbRef={outDbRef} />
        <LedMeter meterRef={outMeterRef} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs Row 1: SPACE, GRAVITY, BLOOM, DENSITY */}
      <div style={{
        padding: '7px 4px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(120,100,200,0.06)',
      }}>
        <Knob label="SPACE" value={space} min={0} max={1} defaultValue={0.4} size={34}
          onChange={v => { setSpace(v); engineRef.current?.setSpace(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="GRAVITY" value={gravity} min={0} max={1} defaultValue={0.5} size={34}
          onChange={v => { setGravity(v); engineRef.current?.setGravity(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="BLOOM" value={bloom} min={0} max={1} defaultValue={0.3} size={34}
          onChange={v => { setBloom(v); engineRef.current?.setBloom(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="DENSITY" value={density} min={0} max={1} defaultValue={0.5} size={34}
          onChange={v => { setDensity(v); engineRef.current?.setDensity(v); setActivePreset(null); }} format={pctFmt} />
      </div>

      {/* Knobs Row 2: COLOR, WIDTH, MIX, OUTPUT */}
      <div style={{
        padding: '4px 4px 7px', display: 'flex', justifyContent: 'space-around',
        borderBottom: '1px solid rgba(120,100,200,0.06)',
      }}>
        <Knob label="COLOR" value={color} min={0} max={1} defaultValue={0.5} size={32}
          onChange={v => { setColor(v); engineRef.current?.setColor(v); setActivePreset(null); }}
          format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'NEUTRAL'} />
        <Knob label="WIDTH" value={width} min={0} max={1} defaultValue={0.6} size={32}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={0.3} size={32}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="OUTPUT" value={outputLevel} min={0} max={1} defaultValue={0.5} size={32}
          onChange={v => { setOutputLevel(v); engineRef.current?.setOutput(v); setActivePreset(null); }} format={outFmt} />
      </div>

      {/* Bypass */}
      <div style={{ padding: '5px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 4, height: 4, borderRadius: '50%',
            background: reverbLevel > 0.02 ? '#8070c0' : 'rgba(120,100,200,0.15)',
            boxShadow: reverbLevel > 0.02 ? '0 0 6px rgba(120,100,220,0.4)' : 'none',
          }} />
          <span style={{ fontSize: 5, color: 'rgba(160,150,200,0.3)', letterSpacing: '0.1em', fontWeight: 600 }}>FIELD</span>
        </div>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
          style={{
            fontSize: 6, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(120,100,220,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(180,160,255,0.95)' : 'rgba(120,100,180,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(120,100,220,0.45)' : 'rgba(80,60,140,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(120,100,220,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s', marginRight: 6,
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
          style={{
            fontSize: 6, fontWeight: 700, letterSpacing: '0.12em',
            padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
            background: bypassed ? 'rgba(40,35,60,0.5)' : 'rgba(120,100,220,0.1)',
            color: bypassed ? 'rgba(140,130,170,0.3)' : '#b0a0e0',
            border: `1px solid ${bypassed ? 'rgba(80,70,120,0.2)' : 'rgba(120,100,220,0.2)'}`,
            boxShadow: bypassed ? 'none' : '0 0 8px rgba(120,100,220,0.08)',
          }}>
          {bypassed ? 'BYPASSED' : 'ACTIVE'}
        </button>
      </div>
    </div>
  );
}
