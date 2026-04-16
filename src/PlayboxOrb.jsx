import { useState, useEffect, useRef, useCallback } from 'react';
import { createPlayboxEngine } from './playboxEngine';
import PresetSelector from './PresetSelector';

// ─── PLAYBOX: Arcade Machine / Toy Box ─────────────────────────────────────
// Visual world: chunky arcade buttons, animated mascots per chain, coin slot, confetti

// ─── Chain themes — each chain gets its own color world ────────────────────
const CHAIN_THEMES = [
  // 0 FLANGE — blue
  {
    name: 'FLANGE', accent: '#4080ff', accentHi: '#70a8ff', accentDim: 'rgba(64,128,255,0.4)',
    accentVdim: 'rgba(64,128,255,0.18)', accentBg: 'rgba(64,128,255,0.05)',
    label: '#c8d8f0', labelDim: 'rgba(200,216,240,0.45)',
    panelGrad: 'linear-gradient(170deg, #0e1a38 0%, #0a1228 25%, #080e20 50%, #060a18 75%, #0a1230 100%)',
    borderColor: 'rgba(64,128,255,0.22)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(64,128,255,0.12), inset 0 1px 0 rgba(120,170,255,0.1)',
    headerGrad: 'linear-gradient(180deg, rgba(64,128,255,0.05) 0%, transparent 100%)',
    knobTop: '#90a8cc', knobMid: '#2e3e55', knobDark: '#0c1420',
    knobSpec: 'rgba(140,190,255,0.3)', knobStroke: 'rgba(100,160,230,0.15)',
    pointer: '#d0ddf0', meterOff: 'rgba(64,128,255,0.06)',
    presetBg: '#0a1020', hue: 220,
    icon: '\uD83C\uDFB5', // music note
  },
  // 1 ECHO — purple
  {
    name: 'ECHO', accent: '#a060e0', accentHi: '#c090ff', accentDim: 'rgba(160,96,224,0.4)',
    accentVdim: 'rgba(160,96,224,0.18)', accentBg: 'rgba(160,96,224,0.05)',
    label: '#d8c8f0', labelDim: 'rgba(216,200,240,0.45)',
    panelGrad: 'linear-gradient(170deg, #1a1030 0%, #120a24 25%, #0e081c 50%, #0a0618 75%, #140e28 100%)',
    borderColor: 'rgba(160,96,224,0.22)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(160,96,224,0.1), inset 0 1px 0 rgba(200,160,255,0.08)',
    headerGrad: 'linear-gradient(180deg, rgba(160,96,224,0.05) 0%, transparent 100%)',
    knobTop: '#a898c0', knobMid: '#403060', knobDark: '#140e20',
    knobSpec: 'rgba(180,150,240,0.28)', knobStroke: 'rgba(160,120,220,0.15)',
    pointer: '#dcd0f0', meterOff: 'rgba(160,96,224,0.06)',
    presetBg: '#120a1c', hue: 270,
    icon: '\uD83D\uDD0A', // speaker
  },
  // 2 FILTER — green
  {
    name: 'FILTER', accent: '#40c070', accentHi: '#70e0a0', accentDim: 'rgba(64,192,112,0.4)',
    accentVdim: 'rgba(64,192,112,0.18)', accentBg: 'rgba(64,192,112,0.05)',
    label: '#c8f0d8', labelDim: 'rgba(200,240,216,0.45)',
    panelGrad: 'linear-gradient(170deg, #0a2018 0%, #081812 25%, #06120e 50%, #040e0a 75%, #081a14 100%)',
    borderColor: 'rgba(64,192,112,0.22)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(64,192,112,0.1), inset 0 1px 0 rgba(120,230,170,0.08)',
    headerGrad: 'linear-gradient(180deg, rgba(64,192,112,0.05) 0%, transparent 100%)',
    knobTop: '#90c0a0', knobMid: '#2e5540', knobDark: '#0c2018',
    knobSpec: 'rgba(130,220,170,0.28)', knobStroke: 'rgba(100,200,150,0.15)',
    pointer: '#d0f0dc', meterOff: 'rgba(64,192,112,0.06)',
    presetBg: '#081410', hue: 150,
    icon: '\uD83C\uDFDB', // knobs
  },
  // 3 WIDEN — cyan
  {
    name: 'WIDEN', accent: '#40d0d0', accentHi: '#70f0f0', accentDim: 'rgba(64,208,208,0.4)',
    accentVdim: 'rgba(64,208,208,0.18)', accentBg: 'rgba(64,208,208,0.05)',
    label: '#c8f0f0', labelDim: 'rgba(200,240,240,0.45)',
    panelGrad: 'linear-gradient(170deg, #0a2028 0%, #081820 25%, #06141c 50%, #041018 75%, #081a22 100%)',
    borderColor: 'rgba(64,208,208,0.22)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(64,208,208,0.1), inset 0 1px 0 rgba(120,240,240,0.08)',
    headerGrad: 'linear-gradient(180deg, rgba(64,208,208,0.05) 0%, transparent 100%)',
    knobTop: '#90c0c0', knobMid: '#2e5555', knobDark: '#0c2020',
    knobSpec: 'rgba(130,230,230,0.28)', knobStroke: 'rgba(100,210,210,0.15)',
    pointer: '#d0f0f0', meterOff: 'rgba(64,208,208,0.06)',
    presetBg: '#081418', hue: 180,
    icon: '\uD83D\uDCE1', // satellite
  },
  // 4 CRUSH — red-orange
  {
    name: 'CRUSH', accent: '#e06040', accentHi: '#ff8870', accentDim: 'rgba(224,96,64,0.4)',
    accentVdim: 'rgba(224,96,64,0.18)', accentBg: 'rgba(224,96,64,0.05)',
    label: '#f0d0c8', labelDim: 'rgba(240,208,200,0.45)',
    panelGrad: 'linear-gradient(170deg, #281410 0%, #200e0a 25%, #1a0a08 50%, #140806 75%, #22100c 100%)',
    borderColor: 'rgba(224,96,64,0.22)',
    outerGlow: '0 4px 30px rgba(0,0,0,0.85), 0 0 20px rgba(224,96,64,0.1), inset 0 1px 0 rgba(255,150,120,0.08)',
    headerGrad: 'linear-gradient(180deg, rgba(224,96,64,0.05) 0%, transparent 100%)',
    knobTop: '#c09080', knobMid: '#553830', knobDark: '#201210',
    knobSpec: 'rgba(240,160,130,0.28)', knobStroke: 'rgba(220,130,100,0.15)',
    pointer: '#f0dcd0', meterOff: 'rgba(224,96,64,0.06)',
    presetBg: '#180c08', hue: 15,
    icon: '\uD83D\uDCA5', // explosion
  },
];

const CHAIN_VALUES = [0.0, 0.3, 0.5, 0.7, 0.9];

// ─── Chain Stage Display — Animated Characters/Mascots per chain ──────────
function ChainStageDisplay({ chain, intensity, speed, color, mix, peakLevel }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const confettiRef = useRef([]); // star confetti particles
  const valRef = useRef({ chain: 0, intensity: 0, speed: 0, color: 0, mix: 0, peakLevel: 0 });

  // Keep live values in ref so canvas draw loop always sees latest
  valRef.current = { chain, intensity, speed, color, mix, peakLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    let raf;
    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.01;
      const phase = phaseRef.current;

      // Read LIVE values from ref (not stale closure!)
      const { chain: _chain, intensity: _intensity, speed: _speed, color: _color, mix: _mix, peakLevel: _peakLevel } = valRef.current;
      const th = CHAIN_THEMES[_chain];
      const hue = th.hue;
      const reactivity = 0.3 + _peakLevel * 0.7;

      // ── Background: subtle grid lines (arcade CRT feel) ──
      ctx.strokeStyle = `hsla(${hue}, 30%, 30%, 0.04)`;
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 12) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 12) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // ── Spawn star confetti on loud audio ──
      if (_peakLevel > 0.5 && Math.random() < _peakLevel * 0.3) {
        confettiRef.current.push({
          x: Math.random() * W,
          y: -5,
          vy: 0.5 + Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 1.5,
          size: 2 + Math.random() * 3,
          hue: hue + Math.random() * 60 - 30,
          alpha: 0.6 + Math.random() * 0.4,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.1,
        });
      }

      // Update and draw confetti
      const confetti = confettiRef.current;
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.x += c.vx;
        c.y += c.vy;
        c.rotation += c.rotSpeed;
        c.alpha -= 0.005;
        if (c.y > H + 10 || c.alpha <= 0) { confetti.splice(i, 1); continue; }

        // Draw 4-pointed star
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.beginPath();
        for (let p = 0; p < 8; p++) {
          const angle = (p / 8) * Math.PI * 2;
          const r = p % 2 === 0 ? c.size : c.size * 0.4;
          const sx = Math.cos(angle) * r;
          const sy = Math.sin(angle) * r;
          if (p === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fillStyle = `hsla(${c.hue}, 80%, 65%, ${c.alpha})`;
        ctx.fill();
        ctx.restore();
      }
      // Limit confetti count
      if (confetti.length > 60) confetti.splice(0, confetti.length - 60);

      if (_chain === 0) {
        // ── FLANGE: Spinning DJ Turntable with wobbling tone arm ──
        const cx = W * 0.5, cy = H * 0.52;
        const plateR = 32 + reactivity * 8;
        const spinAngle = phase * (1 + _speed * 3) * reactivity;

        // Turntable platter
        ctx.save();
        ctx.translate(cx, cy);

        // Platter shadow
        ctx.beginPath();
        ctx.arc(2, 3, plateR + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fill();

        // Platter body
        const platterGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, plateR);
        platterGrad.addColorStop(0, `hsla(${hue}, 50%, 25%, 0.9)`);
        platterGrad.addColorStop(0.3, `hsla(${hue}, 40%, 18%, 0.85)`);
        platterGrad.addColorStop(0.8, `hsla(${hue}, 35%, 12%, 0.9)`);
        platterGrad.addColorStop(1, `hsla(${hue}, 30%, 8%, 1)`);
        ctx.beginPath();
        ctx.arc(0, 0, plateR, 0, Math.PI * 2);
        ctx.fillStyle = platterGrad;
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue}, 60%, 50%, 0.3)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Vinyl grooves (concentric circles that spin)
        ctx.rotate(spinAngle);
        for (let g = 0; g < 8; g++) {
          const gr = 8 + g * (plateR - 10) / 8;
          ctx.beginPath();
          ctx.arc(0, 0, gr, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, 40%, 40%, ${0.08 + (g % 2) * 0.05})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }

        // Label in center
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.6)`;
        ctx.fill();

        // Spindle dot
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 80%, 75%, 0.8)`;
        ctx.fill();

        ctx.restore();

        // Tone arm — wobbles with audio
        const armBaseX = cx + plateR + 8;
        const armBaseY = cy - plateR * 0.4;
        const armAngle = -0.6 + Math.sin(phase * 0.5) * 0.1 + _peakLevel * 0.15 * Math.sin(phase * 3);
        const armLen = plateR * 0.9;

        ctx.save();
        ctx.translate(armBaseX, armBaseY);
        ctx.rotate(armAngle);

        // Arm base
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 30%, 40%, 0.7)`;
        ctx.fill();

        // Arm body
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-armLen * 0.85, armLen * 0.3);
        ctx.strokeStyle = `hsla(${hue}, 40%, 55%, 0.6)`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Cartridge/needle
        ctx.beginPath();
        ctx.arc(-armLen * 0.85, armLen * 0.3, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 60%, 65%, 0.7)`;
        ctx.fill();

        ctx.restore();

        // Speed indicator ring
        const glowR = plateR + 4 + Math.sin(phase * 2) * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${0.1 * reactivity})`;
        ctx.lineWidth = 1;
        ctx.stroke();

      } else if (_chain === 1) {
        // ── ECHO: Cartoon ghost that duplicates itself ──
        const cx = W * 0.25, cy = H * 0.5;
        const copies = 3 + Math.round(_intensity * 5);

        for (let i = copies; i >= 0; i--) {
          const prog = i / copies;
          const spacing = 22 + _intensity * 10;
          const gx = cx + i * spacing;
          const gy = cy + Math.sin(phase * 1.5 + i * 0.8) * (5 + _speed * 10) * reactivity;
          const alpha = (1 - prog * 0.6) * (0.3 + _peakLevel * 0.5);
          const scale = 1 - prog * 0.15;
          const h = hue + i * 15 * _color;

          if (gx > W + 20) continue;

          ctx.save();
          ctx.translate(gx, gy);
          ctx.scale(scale, scale);

          // Ghost body
          ctx.beginPath();
          ctx.moveTo(0, -12);
          ctx.bezierCurveTo(-10, -12, -12, -4, -12, 4);
          ctx.lineTo(-12, 10);
          // Wavy bottom
          for (let w = -12; w <= 12; w += 6) {
            ctx.quadraticCurveTo(w + 3, 10 + Math.sin(phase * 3 + w + i) * 3 * reactivity, w + 6, 10);
          }
          ctx.lineTo(12, 4);
          ctx.bezierCurveTo(12, -4, 10, -12, 0, -12);
          ctx.closePath();

          const ghostGrad = ctx.createLinearGradient(0, -12, 0, 12);
          ghostGrad.addColorStop(0, `hsla(${h}, 60%, 75%, ${alpha})`);
          ghostGrad.addColorStop(1, `hsla(${h}, 50%, 55%, ${alpha * 0.6})`);
          ctx.fillStyle = ghostGrad;
          ctx.fill();
          ctx.strokeStyle = `hsla(${h}, 70%, 80%, ${alpha * 0.5})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();

          // Eyes (only on first 3)
          if (i < 3) {
            const eyeY = -3 + Math.sin(phase * 2 + i) * 1;
            // Left eye
            ctx.beginPath();
            ctx.arc(-4, eyeY, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.7})`;
            ctx.fill();
            // Right eye
            ctx.beginPath();
            ctx.arc(4, eyeY, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.7})`;
            ctx.fill();
            // Eye highlights
            ctx.beginPath();
            ctx.arc(-3.5, eyeY - 0.8, 0.8, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(4.5, eyeY - 0.8, 0.8, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
            ctx.fill();
          }

          // Glow aura
          if (i === 0) {
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${h}, 60%, 60%, ${0.05 * reactivity})`;
            ctx.fill();
          }

          ctx.restore();
        }

      } else if (_chain === 2) {
        // ── FILTER: Dancing EQ curve (snake) ──
        const sweepPhase = phase * (0.5 + _speed * 2.5);
        const snakeAmplitude = 25 + _intensity * 25;

        // Draw the dancing snake/EQ curve
        ctx.beginPath();
        for (let x = 0; x < W; x += 1) {
          const nx = x / W;
          const baseY = H * 0.5;
          const wave1 = Math.sin(nx * 6 + sweepPhase) * snakeAmplitude * reactivity;
          const wave2 = Math.sin(nx * 12 + sweepPhase * 1.5) * snakeAmplitude * 0.3 * _intensity * reactivity;
          const wave3 = Math.cos(nx * 3 + sweepPhase * 0.7) * 8 * reactivity;
          const y = baseY + wave1 + wave2 + wave3;

          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${hue}, 75%, 60%, ${0.5 * reactivity})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Fill under curve
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, H * 0.3, 0, H);
        fillGrad.addColorStop(0, `hsla(${hue}, 70%, 55%, ${0.15 * reactivity})`);
        fillGrad.addColorStop(1, `hsla(${hue}, 60%, 40%, 0)`);
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Snake "eyes" at the leading edge
        const eyeX = ((sweepPhase * 0.1) % 1) * W;
        const eyeY = H * 0.5 + Math.sin(eyeX / W * 6 + sweepPhase) * snakeAmplitude * reactivity;
        // Head
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, 5 * reactivity, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 80%, 65%, ${0.6 * reactivity})`;
        ctx.fill();
        // Eyes
        ctx.beginPath();
        ctx.arc(eyeX - 2, eyeY - 2, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * reactivity})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(eyeX + 2, eyeY - 2, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * reactivity})`;
        ctx.fill();
        // Tongue
        const tongueLen = 4 + _peakLevel * 4;
        ctx.beginPath();
        ctx.moveTo(eyeX + 4, eyeY);
        ctx.quadraticCurveTo(eyeX + 4 + tongueLen, eyeY + Math.sin(phase * 5) * 3, eyeX + 4 + tongueLen, eyeY + 2);
        ctx.strokeStyle = `hsla(0, 70%, 55%, ${0.4 * reactivity})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Frequency markers along bottom
        for (let i = 0; i < 8; i++) {
          const fx = 15 + (i / 8) * (W - 30);
          const fh = 3 + Math.sin(sweepPhase + i * 0.5) * 5 * reactivity;
          ctx.fillStyle = `hsla(${hue + i * _color * 8}, 60%, 50%, 0.15)`;
          ctx.fillRect(fx, H - fh, 4, fh);
        }

      } else if (_chain === 3) {
        // ── WIDEN: Two speakers pushing apart ──
        const cx = W * 0.5, cy = H * 0.5;
        const spread = 20 + _intensity * 40 + _peakLevel * 20 * reactivity;
        const breathe = Math.sin(phase * (0.5 + _speed)) * 5 * reactivity;

        // Draw left speaker
        const drawSpeaker = (sx, dir) => {
          ctx.save();
          ctx.translate(sx, cy);
          ctx.scale(dir, 1);

          // Speaker cabinet
          const cabW = 28, cabH = 40;
          ctx.fillStyle = `hsla(${hue}, 30%, 15%, 0.8)`;
          ctx.strokeStyle = `hsla(${hue}, 50%, 40%, 0.4)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(-cabW / 2, -cabH / 2, cabW, cabH, 3);
          ctx.fill();
          ctx.stroke();

          // Woofer cone
          const wooferR = 10 + _peakLevel * 3 * reactivity;
          const wooferBounce = Math.sin(phase * 4) * _peakLevel * 2;
          ctx.beginPath();
          ctx.arc(0, 3 + wooferBounce, wooferR, 0, Math.PI * 2);
          const coneGrad = ctx.createRadialGradient(0, 3 + wooferBounce, 0, 0, 3 + wooferBounce, wooferR);
          coneGrad.addColorStop(0, `hsla(${hue}, 40%, 30%, 0.8)`);
          coneGrad.addColorStop(0.7, `hsla(${hue}, 35%, 20%, 0.9)`);
          coneGrad.addColorStop(1, `hsla(${hue}, 30%, 15%, 1)`);
          ctx.fillStyle = coneGrad;
          ctx.fill();

          // Woofer dust cap
          ctx.beginPath();
          ctx.arc(0, 3 + wooferBounce, 3, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 50%, 45%, 0.6)`;
          ctx.fill();

          // Tweeter
          ctx.beginPath();
          ctx.arc(0, -12, 4, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 60%, 55%, 0.5)`;
          ctx.fill();

          // Sound waves emanating outward
          for (let w = 0; w < 3; w++) {
            const waveR = 15 + w * 10 + breathe;
            const wAlpha = (0.1 - w * 0.025) * reactivity;
            ctx.beginPath();
            ctx.arc(0, 0, waveR, -Math.PI * 0.4, Math.PI * 0.4);
            ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${wAlpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          ctx.restore();
        };

        drawSpeaker(cx - spread / 2 - breathe, -1);
        drawSpeaker(cx + spread / 2 + breathe, 1);

        // Stereo field indicator
        const fieldW = spread + breathe * 2;
        ctx.beginPath();
        ctx.moveTo(cx - fieldW / 2, cy + 25);
        ctx.lineTo(cx, cy + 30);
        ctx.lineTo(cx + fieldW / 2, cy + 25);
        ctx.strokeStyle = `hsla(${hue}, 60%, 55%, ${0.2 * reactivity})`;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Center diamond
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 4, cy);
        ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 4, cy);
        ctx.closePath();
        ctx.fillStyle = `hsla(${hue}, 70%, 65%, ${0.3 * reactivity})`;
        ctx.fill();

      } else {
        // ── CRUSH: Pixel art that gets chunkier ──
        const blockSize = 3 + Math.round(_intensity * 10);
        const cols = Math.ceil(W / blockSize);
        const rows = Math.ceil(H / blockSize);
        const glitchSeed = Math.floor(phase * (2 + _speed * 6));

        // Generate pixel art pattern
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const hash = Math.sin(glitchSeed * 0.1 + row * 7.31 + col * 3.17) * 43758.5453;
            const val = hash - Math.floor(hash);

            // Only draw some blocks based on intensity
            if (val > 0.3 + (1 - _intensity) * 0.4) {
              const x = col * blockSize;
              const y = row * blockSize;
              const h = hue + val * _color * 50 - 15;
              const alpha = (0.1 + val * 0.3) * reactivity;

              ctx.fillStyle = `hsla(${h}, 65%, 50%, ${alpha})`;
              ctx.fillRect(x, y, blockSize - 1, blockSize - 1);
            }
          }
        }

        // Glitch displacement lines
        const numGlitchLines = Math.floor(3 + _intensity * 8);
        for (let g = 0; g < numGlitchLines; g++) {
          const gHash = Math.sin(glitchSeed * 0.2 + g * 5.43) * 28461.2341;
          const gy = ((gHash - Math.floor(gHash)) * H);
          const gShift = (Math.sin(glitchSeed * 0.3 + g * 2.1) * 20) * _intensity * reactivity;
          const gHeight = 2 + Math.floor(_intensity * blockSize);

          ctx.save();
          ctx.translate(gShift, 0);
          ctx.fillStyle = `hsla(${hue + 20}, 70%, 55%, ${0.15 * reactivity})`;
          ctx.fillRect(0, gy, W, gHeight);
          ctx.restore();
        }

        // Scanline effect
        for (let y = 0; y < H; y += 3) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
          ctx.fillRect(0, y, W, 1);
        }

        // "BIT DEPTH" indicator
        const bits = Math.round(16 - _intensity * 12);
        ctx.font = `bold 8px "Courier New", monospace`;
        ctx.textAlign = 'right';
        ctx.fillStyle = `hsla(${hue}, 50%, 60%, ${0.3 * reactivity})`;
        ctx.fillText(`${bits}bit`, W - 8, 14);

        // Resolution display
        const res = Math.round(48000 / (1 + _intensity * 15));
        ctx.fillText(`${(res / 1000).toFixed(1)}k`, W - 8, 24);
      }

      // Chain name label bottom
      ctx.font = '700 8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `hsla(${hue}, 50%, 65%, 0.35)`;
      ctx.fillText(CHAIN_THEMES[_chain].name, W * 0.5, H - 5);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [chain]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 4 }} />;
}

// ─── Arcade Button (3D raised circle) ──────────────────────────────────────
function ArcadeButton({ label, active, onClick, chainTheme, icon }) {
  return (
    <button onClick={onClick} style={{
      width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
      padding: 0, border: 'none', position: 'relative', zIndex: 2,
      background: active
        ? `radial-gradient(circle at 50% 40%, ${chainTheme.accentHi}, ${chainTheme.accent} 60%, rgba(0,0,0,0.3) 100%)`
        : `radial-gradient(circle at 50% 35%, rgba(60,60,80,0.8), rgba(25,25,35,0.9) 70%, rgba(0,0,0,0.5) 100%)`,
      boxShadow: active
        ? `0 2px 0 rgba(0,0,0,0.4), 0 0 12px ${chainTheme.accentDim}, inset 0 1px 2px rgba(255,255,255,0.2)`
        : `0 3px 0 rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.05)`,
      transform: active ? 'translateY(2px)' : 'translateY(0)',
      transition: 'all 0.1s ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 0,
    }}>
      {/* Inner dome highlight */}
      <div style={{
        position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)',
        width: 12, height: 6, borderRadius: '50%',
        background: active
          ? 'rgba(255,255,255,0.25)'
          : 'rgba(255,255,255,0.06)',
        pointerEvents: 'none',
      }} />
      {/* Button ring */}
      <div style={{
        position: 'absolute', inset: -2, borderRadius: '50%',
        border: `2px solid ${active ? chainTheme.accent : 'rgba(40,40,55,0.8)'}`,
        pointerEvents: 'none',
      }} />
      <span style={{
        fontSize: 7, fontWeight: 900,
        color: active ? '#fff' : chainTheme.labelDim,
        textShadow: active ? `0 0 4px ${chainTheme.accent}` : 'none',
        letterSpacing: '0.05em',
        lineHeight: 1,
        fontFamily: '"Courier New", monospace',
      }}>{label.charAt(0)}</span>
    </button>
  );
}

// ─── Toy Box Knob ──────────────────────────────────────────────────────────
function ToyKnob({ size = 38, norm = 0, theme, sparkle }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const id = useRef(`tk-${Math.random().toString(36).slice(2, 7)}`).current;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  const ptrLen = r * 0.75;
  const px = cx + ptrLen * Math.cos(rad);
  const py = cy + ptrLen * Math.sin(rad);

  return (
    <svg width={size + 12} height={size + 12} style={{ display: 'block', overflow: 'visible', margin: '-6px', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor={theme.accentHi} stopOpacity="0.9" />
          <stop offset="50%" stopColor={theme.accent} stopOpacity="0.8" />
          <stop offset="100%" stopColor={theme.knobDark} stopOpacity="1" />
        </radialGradient>
        <filter id={`${id}-sh`}>
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.5)" />
        </filter>
      </defs>

      {/* Sparkle decorations when >0.9 */}
      {sparkle && [0, 1, 2, 3, 4, 5].map(i => {
        const sa = (i / 6) * Math.PI * 2 + Date.now() * 0.002;
        const sr = r + 6 + Math.sin(Date.now() * 0.005 + i) * 3;
        const sx = (cx + 6) + Math.cos(sa) * sr;
        const sy = (cy + 6) + Math.sin(sa) * sr;
        return (
          <g key={i}>
            <line x1={sx - 2} y1={sy} x2={sx + 2} y2={sy} stroke={theme.accentHi} strokeWidth="1" opacity="0.6" />
            <line x1={sx} y1={sy - 2} x2={sx} y2={sy + 2} stroke={theme.accentHi} strokeWidth="1" opacity="0.6" />
          </g>
        );
      })}

      {/* Knob body — chunky colored circle */}
      <circle cx={cx + 6} cy={cy + 6} r={r + 1}
        fill={`url(#${id}-bg)`} filter={`url(#${id}-sh)`} />

      {/* White pointer line — thick and visible */}
      <line x1={cx + 6} y1={cy + 6} x2={px + 6} y2={py + 6}
        stroke="white" strokeWidth={3} strokeLinecap="round"
        opacity="0.85" />

      {/* Top highlight */}
      <ellipse cx={cx + 6} cy={cy + 6 - r * 0.25} rx={r * 0.5} ry={r * 0.25}
        fill="rgba(255,255,255,0.15)" />

      {/* Outer ring */}
      <circle cx={cx + 6} cy={cy + 6} r={r + 1}
        fill="none" stroke={theme.accent} strokeWidth={1.5} opacity="0.4" />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 38, format, sensitivity = 160, theme }) {
  const [dragging, setDragging] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const display = format ? format(value) : value.toFixed(2);
  const sparkle = norm > 0.9;

  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(min, Math.min(max, ref.current.v + (ref.current.y - ev.clientY) * (max - min) / sensitivity)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  const onDblClick = () => {
    onChange(defaultValue ?? (min + max) / 2);
    setBouncing(true);
    setTimeout(() => setBouncing(false), 300);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      userSelect: 'none', width: size + 16, position: 'relative', zIndex: 2,
    }}>
      <div
        onPointerDown={onDown}
        onDoubleClick={onDblClick}
        style={{
          width: size + 12, height: size + 12,
          cursor: dragging ? 'grabbing' : 'grab',
          transform: bouncing ? 'scale(1.15)' : 'scale(1)',
          transition: bouncing ? 'transform 0.15s ease-out' : 'transform 0.15s ease-in',
        }}
      >
        <ToyKnob size={size} norm={norm} theme={theme} sparkle={sparkle} />
      </div>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: theme.label, fontWeight: 800, textAlign: 'center',
        width: '100%', lineHeight: 1.2,
        fontFamily: '"Courier New", monospace',
        textShadow: `0 0 6px ${theme.accentDim}`,
      }}>{label}</span>
      <span style={{
        fontSize: 5.5, color: theme.accentDim,
        fontFamily: '"Courier New",monospace', fontWeight: 700,
        textAlign: 'center', width: '100%',
      }}>{display}</span>
    </div>
  );
}

// ─── Theme-aware vertical slider ────────────────────────────────────────────
function VSlider({ value, onChange, label, min = 0, max = 1, defaultValue = 1, height = 52, format, theme }) {
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
        style={{ width: 10, height, background: '#080c14', borderRadius: 2, border: `1px solid ${theme.accentVdim}`, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: theme.accentBg, borderRadius: 1, transition: dragging ? 'none' : 'height 0.05s' }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: theme.accent, bottom: `calc(${norm * 100}% - 2px)`, boxShadow: `0 0 6px ${theme.accentDim}` }} />
      </div>
      <span style={{ fontSize: 5, color: theme.labelDim, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', fontWeight: 600, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 5, color: theme.accentDim, fontFamily: '"Courier New",monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── Theme-aware LED meter ──────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeterDom({ meterRef, theme }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 52, background: '#080c14', padding: '3px 2px', borderRadius: 2, border: `1px solid ${theme.accentVdim}`, position: 'relative', zIndex: 2 }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: theme.meterOff }} />
      ))}
    </div>
  );
}

function DbReadoutDom({ dbRef, theme }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: '"Courier New",monospace', fontWeight: 700, color: theme.accentDim, letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block', position: 'relative', zIndex: 2 }}>-∞<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level, theme) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#ffaa30' : theme.accent;
    segmentEls[i].style.background = lit ? col : theme.meterOff;
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
    const clr = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#ffaa30' : theme.accentDim;
    dbEl.style.color = clr;
    dbEl.firstChild.textContent = display;
  }
}

// ─── Coin Slot Bypass ──────────────────────────────────────────────────────
function CoinSlotBypass({ bypassed, onClick, theme }) {
  const [coinDrop, setCoinDrop] = useState(false);

  const handleClick = () => {
    setCoinDrop(true);
    setTimeout(() => setCoinDrop(false), 500);
    onClick();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <button onClick={handleClick} style={{
        width: 56, height: 16, borderRadius: 8, cursor: 'pointer',
        padding: 0, position: 'relative', overflow: 'hidden',
        background: bypassed
          ? 'linear-gradient(180deg, rgba(30,30,40,0.9), rgba(20,20,30,0.95))'
          : `linear-gradient(180deg, ${theme.accentBg}, rgba(20,20,30,0.8))`,
        border: `1.5px solid ${bypassed ? 'rgba(60,60,80,0.3)' : theme.accent}`,
        boxShadow: bypassed
          ? 'inset 0 2px 4px rgba(0,0,0,0.4)'
          : `inset 0 2px 4px rgba(0,0,0,0.2), 0 0 8px ${theme.accentDim}`,
        transition: 'all 0.2s ease',
      }}>
        {/* Slot groove */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 24, height: 3, borderRadius: 2,
          background: 'rgba(0,0,0,0.5)',
          border: '0.5px solid rgba(80,80,100,0.3)',
        }} />
        {/* Coin animation */}
        {coinDrop && (
          <div style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            width: 8, height: 8, borderRadius: '50%',
            background: `linear-gradient(135deg, #ffdd44, #cc9900)`,
            border: '1px solid #aa8800',
            animation: 'coinDrop 0.5s ease-in forwards',
          }} />
        )}
        {/* Label */}
        <span style={{
          position: 'absolute', bottom: -1, left: 0, right: 0,
          textAlign: 'center', fontSize: 4.5, fontWeight: 900,
          letterSpacing: '0.15em',
          color: bypassed ? 'rgba(80,80,100,0.4)' : theme.accentHi,
          fontFamily: '"Courier New", monospace',
          textShadow: bypassed ? 'none' : `0 0 4px ${theme.accentDim}`,
        }}>{bypassed ? 'INSERT COIN' : 'PLAYING'}</span>
      </button>
      {/* Blinking dot when active */}
      {!bypassed && (
        <div style={{
          width: 4, height: 4, borderRadius: '50%',
          background: theme.accent,
          boxShadow: `0 0 6px ${theme.accent}`,
          animation: 'blink 1s ease-in-out infinite',
        }} />
      )}
    </div>
  );
}

// ─── Score Counter ─────────────────────────────────────────────────────────
function ScoreCounter({ peakLevel, theme }) {
  const scoreRef = useRef(0);
  const displayRef = useRef(null);

  useEffect(() => {
    scoreRef.current += Math.round(peakLevel * 100);
    if (displayRef.current) {
      displayRef.current.textContent = String(scoreRef.current).padStart(6, '0');
    }
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      fontFamily: '"Courier New", monospace',
    }}>
      <span style={{
        fontSize: 5, fontWeight: 800, letterSpacing: '0.15em',
        color: theme.labelDim, textTransform: 'uppercase',
      }}>SCORE:</span>
      <span ref={displayRef} style={{
        fontSize: 7, fontWeight: 900, letterSpacing: '0.08em',
        color: theme.accentHi,
        textShadow: `0 0 4px ${theme.accentDim}`,
      }}>000000</span>
    </div>
  );
}

// ─── High Score Display ────────────────────────────────────────────────────
function HighScoreDisplay({ peakLevel, theme }) {
  const highRef = useRef(0);
  const elRef = useRef(null);

  useEffect(() => {
    if (peakLevel > highRef.current) {
      highRef.current = peakLevel;
      if (elRef.current) {
        const dbVal = peakLevel > 1e-6 ? 20 * Math.log10(peakLevel) : -Infinity;
        elRef.current.textContent = dbVal > -60 ? `${dbVal.toFixed(1)}dB` : '--';
      }
    }
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      fontFamily: '"Courier New", monospace',
    }}>
      <span style={{
        fontSize: 4.5, fontWeight: 800, letterSpacing: '0.12em',
        color: 'rgba(255, 200, 60, 0.5)', textTransform: 'uppercase',
      }}>HI-SCORE:</span>
      <span ref={elRef} style={{
        fontSize: 5.5, fontWeight: 900,
        color: 'rgba(255, 200, 60, 0.6)',
        textShadow: '0 0 4px rgba(255, 200, 60, 0.2)',
      }}>--</span>
    </div>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'INIT',        chain: 0, intensity: 0.4, speed: 0.3, color: 0.5, mix: 0.5 },
  { name: 'SWEEP',       chain: 0, intensity: 0.7, speed: 0.35, color: 0.6, mix: 0.6 },
  { name: 'SPACE OUT',   chain: 1, intensity: 0.6, speed: 0.5, color: 0.4, mix: 0.45 },
  { name: 'FILTER JAM',  chain: 2, intensity: 0.65, speed: 0.4, color: 0.55, mix: 0.7 },
  { name: 'SUPER WIDE',  chain: 3, intensity: 0.7, speed: 0.25, color: 0.6, mix: 0.65 },
  { name: 'LO-FI',       chain: 4, intensity: 0.5, speed: 0.4, color: 0.35, mix: 0.55 },
  { name: 'TAPE WASH',   chain: 0, intensity: 0.55, speed: 0.15, color: 0.3, mix: 0.7 },
  { name: 'GLITCH BOX',  chain: 4, intensity: 0.8, speed: 0.7, color: 0.5, mix: 0.6 },
];

const CHAIN_NAMES = ['FLANGE', 'ECHO', 'FILTER', 'WIDEN', 'CRUSH'];

// ─── CSS Keyframes ──────────────────────────────────────────────────────────
const STYLE_ID = 'playbox-arcade-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes coinDrop {
      0% { top: -10px; opacity: 1; }
      60% { top: 50%; opacity: 1; }
      80% { top: 45%; opacity: 0.8; }
      100% { top: 50%; opacity: 0; transform: translateX(-50%) scale(0.3); }
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.2; }
    }
    @keyframes rainbowBorder {
      0% { border-color: hsla(0, 60%, 50%, 0.25); }
      16% { border-color: hsla(60, 60%, 50%, 0.25); }
      33% { border-color: hsla(120, 60%, 50%, 0.25); }
      50% { border-color: hsla(180, 60%, 50%, 0.25); }
      66% { border-color: hsla(240, 60%, 50%, 0.25); }
      83% { border-color: hsla(300, 60%, 50%, 0.25); }
      100% { border-color: hsla(360, 60%, 50%, 0.25); }
    }
    @keyframes chainWipe {
      0% { clip-path: inset(0 100% 0 0); }
      100% { clip-path: inset(0 0 0 0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main Playbox Orb ───────────────────────────────────────────────────────
export default function PlayboxOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [chain,     setChain]     = useState(initialState?.chain     ?? 0);
  const [intensity, setIntensity] = useState(initialState?.intensity ?? 0.4);
  const [speed,     setSpeed]     = useState(initialState?.speed     ?? 0.3);
  const [color,     setColor]     = useState(initialState?.color     ?? 0.5);
  const [mix,       setMix]       = useState(initialState?.mix       ?? 0.5);
  const [bypassed,  setBypassed]  = useState(initialState?.bypassed  ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel, setPeakLevel] = useState(0);

  const th = CHAIN_THEMES[chain];
  const presetColors = {
    bg: th.presetBg, text: th.accentHi, textDim: th.accentDim,
    border: th.accentVdim, hoverBg: th.accentBg, activeBg: th.accentBg,
  };

  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);
  const themeRef    = useRef(th);
  themeRef.current  = th;

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, chain, intensity, speed, color, mix, bypassed };

  // ── Engine init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createPlayboxEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setChain(CHAIN_VALUES[s.chain]);
      eng.setIntensity(s.intensity);
      eng.setSpeed(s.speed);
      eng.setColor(s.color);
      eng.setMix(s.mix);
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

  // ── Meter RAF ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak(), themeRef.current);
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak(), themeRef.current);
        setPeakLevel(engineRef.current.getInputPeak());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── State persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, chain, intensity, speed, color, mix, bypassed, preset: activePreset });
  }, [inputGain, outputGain, chain, intensity, speed, color, mix, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setChain(p.chain); setIntensity(p.intensity); setSpeed(p.speed);
    setColor(p.color); setMix(p.mix);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setChain(CHAIN_VALUES[p.chain]); e.setIntensity(p.intensity);
      e.setSpeed(p.speed); e.setColor(p.color); e.setMix(p.mix);
    }
  }, []);

  const switchChain = useCallback((idx) => {
    setChain(idx);
    engineRef.current?.setChain(CHAIN_VALUES[idx]);
    setActivePreset(null);
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };

  // Title with per-letter chain colors
  const titleColors = [
    CHAIN_THEMES[0].accent, CHAIN_THEMES[1].accent, CHAIN_THEMES[2].accent,
    CHAIN_THEMES[3].accent, CHAIN_THEMES[4].accent, CHAIN_THEMES[0].accentHi,
    CHAIN_THEMES[1].accentHi,
  ];

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: th.panelGrad,
      border: `1.5px solid ${th.borderColor}`,
      boxShadow: th.outerGlow,
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
      transition: 'background 0.4s ease, box-shadow 0.4s ease',
      animation: 'rainbowBorder 6s linear infinite',
    }}>
      {/* Pixel art border decorations — top corners */}
      <div style={{
        position: 'absolute', top: 3, left: 3, zIndex: 1, pointerEvents: 'none', opacity: 0.3,
      }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            position: 'absolute', top: i * 3, left: i * 3,
            width: 3, height: 3, background: th.accent,
          }} />
        ))}
      </div>
      <div style={{
        position: 'absolute', top: 3, right: 3, zIndex: 1, pointerEvents: 'none', opacity: 0.3,
      }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            position: 'absolute', top: i * 3, right: i * 3,
            width: 3, height: 3, background: th.accent,
          }} />
        ))}
      </div>

      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${th.borderColor}`,
        position: 'relative', zIndex: 10,
        background: th.headerGrad, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          {/* PLAYBOX title — each letter different color */}
          <div style={{ display: 'flex', gap: 1 }}>
            {'PLAYBOX'.split('').map((letter, i) => (
              <span key={i} style={{
                fontSize: 14, fontWeight: 900, letterSpacing: '0.04em',
                color: titleColors[i % titleColors.length],
                textShadow: `0 0 8px ${titleColors[i % titleColors.length]}44`,
                fontFamily: '"Courier New", monospace',
              }}>{letter}</span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{
              fontSize: 6, fontWeight: 700, color: th.labelDim,
              letterSpacing: '0.35em', textTransform: 'uppercase',
              transition: 'color 0.4s ease',
              fontFamily: '"Courier New", monospace',
            }}>PLAYER 1</span>
            <HighScoreDisplay peakLevel={peakLevel} theme={th} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: th.accentDim }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
            transition: 'all 0.12s',
          }} title="Remove"
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; e.currentTarget.style.background = 'transparent'; }}
          >×</span>}
        </div>
      </div>

      {/* Chain selector — Arcade Buttons */}
      <div style={{
        padding: '8px 8px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        borderBottom: `1px solid ${th.accentVdim}`,
        position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        {CHAIN_NAMES.map((name, i) => (
          <ArcadeButton key={name} label={name} active={chain === i}
            onClick={() => switchChain(i)} chainTheme={CHAIN_THEMES[i]}
            icon={CHAIN_THEMES[i].icon} />
        ))}
      </div>

      {/* Stage Visual with score overlay */}
      <div style={{ borderBottom: `1px solid ${th.accentVdim}`, position: 'relative', zIndex: 2, flex: 1, minHeight: 0 }}>
        <ChainStageDisplay chain={chain} intensity={intensity} speed={speed} color={color} mix={mix} peakLevel={peakLevel} />
        {/* Score counter overlay */}
        <div style={{
          position: 'absolute', top: 4, right: 6, zIndex: 3,
        }}>
          <ScoreCounter peakLevel={peakLevel} theme={th} />
        </div>
      </div>

      {/* Meters + gain sliders */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: `1px solid ${th.accentVdim}`, position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} theme={th}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeterDom meterRef={inMeterRef} theme={th} />
        <DbReadoutDom dbRef={inDbRef} theme={th} />
        <div style={{ width: 8 }} />
        <DbReadoutDom dbRef={outDbRef} theme={th} />
        <LedMeterDom meterRef={outMeterRef} theme={th} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} theme={th}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs: INTENSITY / SPEED / COLOR / MIX */}
      <div style={{
        padding: '7px 4px 6px', display: 'flex', justifyContent: 'space-around',
        borderBottom: `1px solid ${th.accentVdim}`, position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="INTENSITY" value={intensity} min={0} max={1} defaultValue={0.4} theme={th}
          onChange={v => { setIntensity(v); engineRef.current?.setIntensity(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="SPEED" value={speed} min={0} max={1} defaultValue={0.3} theme={th}
          onChange={v => { setSpeed(v); engineRef.current?.setSpeed(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
        <Knob label="COLOR" value={color} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setColor(v); engineRef.current?.setColor(v); setActivePreset(null); }}
          size={28} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'} />
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={0.5} theme={th}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }}
          size={28} format={pctFmt} />
      </div>

      {/* Bypass — Coin Slot */}
      <div style={{
        padding: '5px 12px', display: 'flex', justifyContent: 'flex-end',
        alignItems: 'center', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <CoinSlotBypass bypassed={bypassed} theme={th}
          onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>

      {/* Pixel art border decorations — bottom corners */}
      <div style={{
        position: 'absolute', bottom: 3, left: 3, zIndex: 1, pointerEvents: 'none', opacity: 0.3,
      }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            position: 'absolute', bottom: i * 3, left: i * 3,
            width: 3, height: 3, background: th.accent,
          }} />
        ))}
      </div>
      <div style={{
        position: 'absolute', bottom: 3, right: 3, zIndex: 1, pointerEvents: 'none', opacity: 0.3,
      }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            position: 'absolute', bottom: i * 3, right: i * 3,
            width: 3, height: 3, background: th.accent,
          }} />
        ))}
      </div>
    </div>
  );
}
