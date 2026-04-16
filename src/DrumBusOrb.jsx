import { useState, useEffect, useRef, useCallback } from 'react';
import { createDrumBusEngine } from './drumBusEngine';
import PresetSelector from './PresetSelector';

// ─── DRUM BUS ENGINE: Military Tank ──────────────────────────────────────────
// Visual: Dark armored tank on muddy ground. Gun recoils on transients.
// Heavy, industrial, aggressive. Completely distinct from yellow school bus.

// Canvas dimensions — same fixed size as ReverbBusOrb
const BUS_W = 380, BUS_H = 280;

function TankCanvas({ punch, smack, body, tone, width, peakIn = 0, peakOut = 0, gr = 0, transient = 0 }) {
  const canvasRef   = useRef(null);
  const phaseRef    = useRef(0);
  const histRef     = useRef(null);
  const valRef      = useRef({ peakIn: 0, peakOut: 0, gr: 0, transient: 0 });

  valRef.current = { peakIn, peakOut, gr, transient };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = BUS_W, H = BUS_H;
    canvas.width  = W * 2;
    canvas.height = H * 2;
    ctx.scale(2, 2);

    if (!histRef.current) histRef.current = {
      sig: 0,
      transSmooth: 0,
      grSmooth: 0,
      recoil: 0,
      turretPhase: 0,
      treadOffset: 0,
      dustPuffs: [],
      muzzleFlash: 0,
      smokeParticles: [],
    };

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { peakIn: _pi, peakOut: _po, gr: _gr, transient: _tr } = valRef.current;
      phaseRef.current += 0.013;
      const ph = phaseRef.current;
      const h  = histRef.current;

      // ── Signal level: fast attack from both in and out peaks
      const rawSig = Math.max(_pi, _po);
      if (rawSig > h.sig) h.sig = h.sig * 0.50 + rawSig * 0.50;
      else                h.sig = h.sig * 0.90 + rawSig * 0.10;

      // ── Transient smoothing
      h.transSmooth = h.transSmooth * 0.65 + _tr * 0.35;

      // ── GR smoothing
      h.grSmooth = h.grSmooth * 0.88 + (_gr || 0) * 0.12;

      // ── Turret rotation (slow, scale with signal)
      h.turretPhase += 0.0015 + h.sig * 0.003;

      // ── Tread animation
      h.treadOffset = (h.treadOffset + 0.8 + h.sig * 2.5) % 12;

      // ── Gun recoil from transients
      h.recoil = h.recoil * 0.82 + h.transSmooth * 18;

      // ── Muzzle flash
      if (h.transSmooth > 0.12) {
        h.muzzleFlash = Math.min(1.0, h.transSmooth * 3.0);
      } else {
        h.muzzleFlash *= 0.75;
      }

      // ── Spawn dust puffs when signal is loud
      if (h.sig > 0.15 && Math.random() < 0.12 + h.sig * 0.2) {
        h.dustPuffs.push({
          x: 40 + Math.random() * 280,
          y: H - 20 + Math.random() * 4,
          r: 3 + Math.random() * 6,
          life: 1.0,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.4 - Math.random() * 0.6,
        });
      }
      // Update dust puffs
      for (let i = h.dustPuffs.length - 1; i >= 0; i--) {
        const d = h.dustPuffs[i];
        d.x += d.vx; d.y += d.vy;
        d.r  += 0.18;
        d.life -= 0.035;
        if (d.life <= 0) h.dustPuffs.splice(i, 1);
      }

      // ── Spawn exhaust smoke
      if (h.sig > 0.04 && Math.random() < 0.18 + h.sig * 0.3) {
        h.smokeParticles.push({
          x: 42 + (Math.random() - 0.5) * 4,
          y: H - 58 + Math.random() * 4,
          r: 2 + Math.random() * 3,
          life: 1.0,
          vx: -0.3 - Math.random() * 0.4,
          vy: -0.6 - Math.random() * 0.8,
        });
      }
      for (let i = h.smokeParticles.length - 1; i >= 0; i--) {
        const s = h.smokeParticles[i];
        s.x += s.vx; s.y += s.vy;
        s.r  += 0.15;
        s.life -= 0.025;
        if (s.life <= 0) h.smokeParticles.splice(i, 1);
      }

      // ── Impact bounce from transients
      const bounce = h.transSmooth * 3;

      // ════════════════════════════════════════════════════════════════
      // LAYOUT CONSTANTS
      const roadY       = H - 20;
      const treadH      = 22;
      const treadY      = roadY - treadH;
      const tankBodyY   = treadY - 50 - bounce;
      const tankBodyH   = 55;
      const tankBodyX   = 35;
      const tankBodyW   = 280;
      const turretX     = tankBodyX + tankBodyW * 0.45;
      const turretY     = tankBodyY - 18;
      const turretR     = 28;
      const barrelLen   = 85;
      const barrelAngle = Math.sin(h.turretPhase * 0.6) * 0.06; // subtle oscillation

      // ── BACKGROUND: smoke/dust haze ──────────────────────────────────
      const bgG = ctx.createLinearGradient(0, 0, 0, H);
      bgG.addColorStop(0,   '#1a1b1e');
      bgG.addColorStop(0.5, '#141516');
      bgG.addColorStop(1,   '#0d0e0f');
      ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

      // Haze overlay — brownish-grey atmospheric
      const hazeG = ctx.createLinearGradient(0, H * 0.3, 0, H);
      hazeG.addColorStop(0, 'rgba(40,32,18,0)');
      hazeG.addColorStop(1, 'rgba(40,32,18,0.22)');
      ctx.fillStyle = hazeG; ctx.fillRect(0, 0, W, H);

      // ── DISTANT HILLS / RUBBLE silhouette ────────────────────────────
      ctx.fillStyle = 'rgba(22,20,16,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, roadY);
      // left rubble pile
      ctx.lineTo(0, H * 0.68);
      ctx.lineTo(15, H * 0.55);
      ctx.lineTo(28, H * 0.62);
      ctx.lineTo(42, H * 0.48);
      ctx.lineTo(58, H * 0.56);
      ctx.lineTo(72, H * 0.60);
      ctx.lineTo(88, H * 0.50);
      ctx.lineTo(105, H * 0.58);
      // center distant hill
      ctx.lineTo(140, H * 0.44);
      ctx.lineTo(180, H * 0.40);
      ctx.lineTo(220, H * 0.43);
      // right rubble
      ctx.lineTo(255, H * 0.52);
      ctx.lineTo(272, H * 0.46);
      ctx.lineTo(290, H * 0.54);
      ctx.lineTo(310, H * 0.60);
      ctx.lineTo(330, H * 0.52);
      ctx.lineTo(350, H * 0.58);
      ctx.lineTo(370, H * 0.64);
      ctx.lineTo(W,   H * 0.68);
      ctx.lineTo(W, roadY); ctx.closePath(); ctx.fill();

      // ── SMOKE PARTICLES (exhaust) ────────────────────────────────────
      for (let i = 0; i < h.smokeParticles.length; i++) {
        const sp = h.smokeParticles[i];
        ctx.fillStyle = 'rgba(20,20,22,' + (sp.life * 0.55) + ')';
        ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2); ctx.fill();
      }

      // ── ROAD / MUDDY GROUND ──────────────────────────────────────────
      const roadG = ctx.createLinearGradient(0, roadY, 0, H);
      roadG.addColorStop(0, '#2a2820');
      roadG.addColorStop(0.4, '#232118');
      roadG.addColorStop(1, '#1a1912');
      ctx.fillStyle = roadG; ctx.fillRect(0, roadY, W, H - roadY);

      // Mud texture marks on road
      ctx.fillStyle = 'rgba(12,10,8,0.55)';
      const mudMarks = [20, 55, 90, 140, 195, 250, 295, 340];
      for (let i = 0; i < mudMarks.length; i++) {
        ctx.fillRect(mudMarks[i], roadY + 2, 18 + (i % 3) * 8, 4);
      }
      // Road edge
      ctx.fillStyle = 'rgba(255,120,0,0.08)'; ctx.fillRect(0, roadY, W, 1.5);

      // ── DUST PUFFS ───────────────────────────────────────────────────
      for (let i = 0; i < h.dustPuffs.length; i++) {
        const dp = h.dustPuffs[i];
        ctx.fillStyle = 'rgba(60,48,28,' + (dp.life * 0.40) + ')';
        ctx.beginPath(); ctx.arc(dp.x, dp.y, dp.r, 0, Math.PI * 2); ctx.fill();
      }

      // ── TANK SHADOW ──────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(tankBodyX + tankBodyW * 0.5, roadY + 6, tankBodyW * 0.45, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // ── TANK TREADS (two long rectangles at bottom) ──────────────────
      // Draw tread background
      const treadColors = ['#1c1e20', '#22242a'];
      for (let side = 0; side < 2; side++) {
        const ty = treadY + (side === 0 ? 0 : -bounce);
        const tx = tankBodyX - 8;
        const tw = tankBodyW + 16;

        // Tread outer body — rounded rect
        ctx.fillStyle = '#181a1e';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, treadH, 4);
        ctx.fill();

        // Animated tread links
        const linkW = 12, linkGap = 2;
        const linkCount = Math.floor(tw / (linkW + linkGap)) + 2;
        for (let li = 0; li < linkCount; li++) {
          const lx = tx + (li * (linkW + linkGap) - h.treadOffset % (linkW + linkGap));
          if (lx < tx - linkW || lx > tx + tw) continue;
          ctx.fillStyle = (li % 2 === 0) ? '#2a2c32' : '#242628';
          ctx.fillRect(Math.max(tx, lx), ty + 2, Math.min(linkW, tx + tw - lx), treadH - 4);
          // Link bolt highlights
          ctx.fillStyle = 'rgba(255,120,0,0.1)';
          ctx.fillRect(Math.max(tx, lx + linkW * 0.3), ty + treadH * 0.25, 3, 3);
        }

        // Tread outline
        ctx.strokeStyle = 'rgba(255,100,0,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(tx, ty, tw, treadH, 4); ctx.stroke();
      }

      // ── TANK BODY ─────────────────────────────────────────────────────
      // Main hull — dark olive/charcoal
      const hullG = ctx.createLinearGradient(tankBodyX, tankBodyY, tankBodyX, tankBodyY + tankBodyH);
      hullG.addColorStop(0,   '#353828');
      hullG.addColorStop(0.3, '#2e3122');
      hullG.addColorStop(0.7, '#272a1e');
      hullG.addColorStop(1,   '#1e2018');
      ctx.fillStyle = hullG;
      ctx.beginPath();
      ctx.moveTo(tankBodyX + 12, tankBodyY);
      ctx.lineTo(tankBodyX + tankBodyW - 18, tankBodyY);
      ctx.lineTo(tankBodyX + tankBodyW + 10, tankBodyY + tankBodyH * 0.25);
      ctx.lineTo(tankBodyX + tankBodyW + 10, tankBodyY + tankBodyH);
      ctx.lineTo(tankBodyX - 8, tankBodyY + tankBodyH);
      ctx.lineTo(tankBodyX - 8, tankBodyY + tankBodyH * 0.25);
      ctx.closePath(); ctx.fill();

      // Armor panel lines on hull
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
      // Horizontal panel seam
      const panelSeamY = tankBodyY + tankBodyH * 0.42;
      ctx.beginPath();
      ctx.moveTo(tankBodyX - 8, panelSeamY);
      ctx.lineTo(tankBodyX + tankBodyW + 10, panelSeamY);
      ctx.stroke();
      // Vertical panel divisions
      const vPanels = [tankBodyX + 60, tankBodyX + 130, tankBodyX + 200];
      for (let vi = 0; vi < vPanels.length; vi++) {
        ctx.beginPath();
        ctx.moveTo(vPanels[vi], tankBodyY);
        ctx.lineTo(vPanels[vi], tankBodyY + tankBodyH);
        ctx.stroke();
      }

      // Hull outline
      ctx.strokeStyle = 'rgba(255,100,0,0.2)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(tankBodyX + 12, tankBodyY);
      ctx.lineTo(tankBodyX + tankBodyW - 18, tankBodyY);
      ctx.lineTo(tankBodyX + tankBodyW + 10, tankBodyY + tankBodyH * 0.25);
      ctx.lineTo(tankBodyX + tankBodyW + 10, tankBodyY + tankBodyH);
      ctx.lineTo(tankBodyX - 8, tankBodyY + tankBodyH);
      ctx.lineTo(tankBodyX - 8, tankBodyY + tankBodyH * 0.25);
      ctx.closePath(); ctx.stroke();

      // ── LED METER SLITS (3 windows on tank body) ─────────────────────
      const winH  = 14;
      const winW  = 55;
      const slitY = tankBodyY + 8;
      const slitXPositions = [tankBodyX + 18, tankBodyX + 100, tankBodyX + 192];
      const barsPerSlit = 4;

      for (let si = 0; si < 3; si++) {
        const sx = slitXPositions[si];

        // Slit bezel
        ctx.fillStyle = '#0a0b0c';
        ctx.beginPath(); ctx.roundRect(sx - 2, slitY - 2, winW + 4, winH + 4, 2); ctx.fill();

        // Slit background (dark glass)
        ctx.fillStyle = 'rgba(8,10,12,0.97)';
        ctx.beginPath(); ctx.roundRect(sx, slitY, winW, winH, 1.5); ctx.fill();

        // 4 horizontal bar segments
        const barW  = (winW - 6) / barsPerSlit - 1;
        const barH2 = winH - 6;
        for (let bi = 0; bi < barsPerSlit; bi++) {
          const bx    = sx + 3 + bi * (barW + 1);
          const bNorm = bi / (barsPerSlit - 1); // 0=left=green, 1=right=red
          let tr, tg, tb;
          if (bNorm < 0.4)      { tr = 20;  tg = 160; tb = 50; }
          else if (bNorm < 0.75){ tr = 200; tg = 140; tb = 0;  }
          else                   { tr = 180; tg = 30;  tb = 10; }

          // Dim track
          ctx.fillStyle = 'rgba(' + tr + ',' + tg + ',' + tb + ',0.08)';
          ctx.fillRect(bx, slitY + 3, barW, barH2);

          // Lit portion — signal level fills from left
          const threshold = bNorm * 0.70;
          if (h.sig > threshold) {
            const fillFrac = Math.min(1, (h.sig - threshold) / (1 - threshold + 0.001));
            const fillH3   = Math.max(2, barH2 * fillFrac);
            let lr, lg, lb;
            if (bNorm < 0.4)      { lr = 30;  lg = 240; lb = 90; }
            else if (bNorm < 0.75){ lr = 255; lg = 190; lb = 0;  }
            else                   { lr = 255; lg = 45;  lb = 20; }
            ctx.fillStyle = 'rgba(' + lr + ',' + lg + ',' + lb + ',0.90)';
            ctx.shadowColor = 'rgba(' + lr + ',' + lg + ',' + lb + ',0.50)';
            ctx.shadowBlur  = 3;
            ctx.fillRect(bx, slitY + 3, barW, fillH3);
            ctx.shadowBlur = 0;
          }
        }

        // Slit glare
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(sx + 1, slitY + 1, winW * 0.5, winH * 0.35);
      }

      // ── TURRET ────────────────────────────────────────────────────────
      const turretG = ctx.createRadialGradient(
        turretX - turretR * 0.3, turretY - turretR * 0.3, turretR * 0.1,
        turretX, turretY, turretR
      );
      turretG.addColorStop(0,   '#2e3028');
      turretG.addColorStop(0.5, '#252720');
      turretG.addColorStop(1,   '#1c1e18');
      ctx.fillStyle = turretG;
      ctx.beginPath();
      ctx.ellipse(turretX, turretY, turretR, turretR * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();

      // Turret armor ridges
      ctx.strokeStyle = 'rgba(255,100,0,0.12)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(turretX, turretY, turretR * 0.75, turretR * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(turretX, turretY, turretR * 0.45, turretR * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Turret outline
      ctx.strokeStyle = 'rgba(255,100,0,0.25)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(turretX, turretY, turretR, turretR * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();

      // ── GUN BARREL ────────────────────────────────────────────────────
      const barrelBaseX = turretX + turretR * 0.85;
      const barrelBaseY = turretY + Math.sin(barrelAngle) * turretR * 0.72 * 0.4;
      const recoilOffset = h.recoil * 0.6; // barrel pulls back during recoil
      const barrelTipX  = barrelBaseX + barrelLen - recoilOffset;
      const barrelTipY  = barrelBaseY + Math.tan(barrelAngle) * barrelLen;
      const barrelW     = 7;

      // Barrel shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(barrelBaseX, barrelBaseY + barrelW * 0.5 + 2);
      ctx.lineTo(barrelTipX,  barrelTipY  + barrelW * 0.3 + 2);
      ctx.lineTo(barrelTipX,  barrelTipY  + barrelW * 0.3 + 5);
      ctx.lineTo(barrelBaseX, barrelBaseY + barrelW * 0.5 + 5);
      ctx.closePath(); ctx.fill();

      // Main barrel tube
      const barrelG = ctx.createLinearGradient(barrelBaseX, barrelBaseY - barrelW, barrelBaseX, barrelBaseY + barrelW);
      barrelG.addColorStop(0, '#3a3c40');
      barrelG.addColorStop(0.3, '#4a4c52');
      barrelG.addColorStop(0.7, '#2e3034');
      barrelG.addColorStop(1, '#1c1e20');
      ctx.fillStyle = barrelG;
      ctx.beginPath();
      ctx.moveTo(barrelBaseX, barrelBaseY - barrelW * 0.5);
      ctx.lineTo(barrelTipX,  barrelTipY  - barrelW * 0.32);
      ctx.lineTo(barrelTipX,  barrelTipY  + barrelW * 0.32);
      ctx.lineTo(barrelBaseX, barrelBaseY + barrelW * 0.5);
      ctx.closePath(); ctx.fill();

      // Barrel rings
      ctx.strokeStyle = 'rgba(255,100,0,0.18)'; ctx.lineWidth = 1;
      const ringPositions = [0.25, 0.5, 0.75];
      for (let ri = 0; ri < ringPositions.length; ri++) {
        const rx = barrelBaseX + (barrelTipX - barrelBaseX) * ringPositions[ri];
        const ry = barrelBaseY + (barrelTipY - barrelBaseY) * ringPositions[ri];
        ctx.beginPath();
        ctx.moveTo(rx, ry - barrelW * 0.55); ctx.lineTo(rx, ry + barrelW * 0.55);
        ctx.stroke();
      }

      // Barrel outline
      ctx.strokeStyle = 'rgba(255,100,0,0.2)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(barrelBaseX, barrelBaseY - barrelW * 0.5);
      ctx.lineTo(barrelTipX,  barrelTipY  - barrelW * 0.32);
      ctx.lineTo(barrelTipX,  barrelTipY  + barrelW * 0.32);
      ctx.lineTo(barrelBaseX, barrelBaseY + barrelW * 0.5);
      ctx.closePath(); ctx.stroke();

      // ── MUZZLE FLASH ──────────────────────────────────────────────────
      if (h.muzzleFlash > 0.05) {
        const mfX = barrelTipX + 6;
        const mfY = barrelTipY;
        const mfR = h.muzzleFlash * 16;

        // Outer glow
        const mfG = ctx.createRadialGradient(mfX, mfY, 0, mfX, mfY, mfR * 2);
        mfG.addColorStop(0, 'rgba(255,200,50,' + (h.muzzleFlash * 0.9) + ')');
        mfG.addColorStop(0.35, 'rgba(255,100,0,' + (h.muzzleFlash * 0.55) + ')');
        mfG.addColorStop(1,  'rgba(255,60,0,0)');
        ctx.fillStyle = mfG;
        ctx.beginPath(); ctx.arc(mfX, mfY, mfR * 2, 0, Math.PI * 2); ctx.fill();

        // Core flash
        ctx.fillStyle = 'rgba(255,240,180,' + (h.muzzleFlash * 0.85) + ')';
        ctx.beginPath(); ctx.arc(mfX, mfY, mfR * 0.5, 0, Math.PI * 2); ctx.fill();

        // Spiky flash rays
        ctx.strokeStyle = 'rgba(255,180,50,' + (h.muzzleFlash * 0.7) + ')';
        ctx.lineWidth = 1.5;
        const rayAngles = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
        for (let ri = 0; ri < rayAngles.length; ri++) {
          const ra   = rayAngles[ri];
          const rLen = mfR * (0.8 + Math.random() * 0.6);
          ctx.beginPath();
          ctx.moveTo(mfX, mfY);
          ctx.lineTo(mfX + Math.cos(ra) * rLen, mfY + Math.sin(ra) * rLen);
          ctx.stroke();
        }
      }

      // ── EXHAUST PIPE (rear of tank, vertical) ─────────────────────────
      const exPipeX = tankBodyX - 3;
      const exPipeTop = tankBodyY + 6;
      const exPipeBot = tankBodyY + tankBodyH * 0.55;
      ctx.fillStyle = '#282a2c';
      ctx.fillRect(exPipeX, exPipeTop, 5, exPipeBot - exPipeTop);
      // Chrome cap
      ctx.fillStyle = 'rgba(180,180,200,0.55)';
      ctx.fillRect(exPipeX - 1, exPipeTop, 7, 2.5);

      // ── GR READOUT (bottom-right) ─────────────────────────────────────
      const grDb = h.grSmooth > 0.005 ? (h.grSmooth * 30).toFixed(1) : '0.0';
      ctx.font = 'bold 6px "Courier New",monospace'; ctx.textAlign = 'right';
      const grAlpha = (0.22 + Math.min(1, h.grSmooth * 4)).toFixed(2);
      ctx.fillStyle = 'rgba(255,100,0,' + grAlpha + ')';
      ctx.fillText('GR -' + grDb + 'dB', W - 6, H - 5);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: BUS_W + 'px', height: BUS_H + 'px', display: 'block' }} />;
}

// ─── Stop Sign Bypass Button ─────────────────────────────────────────────────
function ConsolBypass({ active, onClick }) {
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

// ─── TankKnob — dark gunmetal, orange indicator, flat industrial ──────────────
function TankKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2;
  const trackR = size / 2 - 1.8;
  const knobR  = size / 2 - 4;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const angle = startAngle + norm * totalSweep;
  const large = norm * totalSweep > Math.PI ? 1 : 0;

  const tX1 = cx + Math.cos(startAngle) * trackR, tY1 = cy + Math.sin(startAngle) * trackR;
  const tX2 = cx + Math.cos(startAngle + totalSweep) * trackR, tY2 = cy + Math.sin(startAngle + totalSweep) * trackR;
  const fX2 = cx + Math.cos(angle) * trackR, fY2 = cy + Math.sin(angle) * trackR;
  const iX1 = cx + Math.cos(angle) * (knobR * 0.28), iY1 = cy + Math.sin(angle) * (knobR * 0.28);
  const iX2 = cx + Math.cos(angle) * (knobR * 0.84), iY2 = cy + Math.sin(angle) * (knobR * 0.84);
  const gId = `tkng${Math.round(size * 10 + norm * 100)}`;

  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={gId} cx="42%" cy="38%" r="62%">
          <stop offset="0%"   stopColor="#3a3c45" />
          <stop offset="45%"  stopColor="#252730" />
          <stop offset="100%" stopColor="#1a1c22" />
        </radialGradient>
      </defs>
      {/* Dark outer track */}
      <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 1 1 ${tX2} ${tY2}`}
        fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Orange fill arc */}
      {norm > 0.005 && (
        <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 ${large} 1 ${fX2} ${fY2}`}
          fill="none" stroke="rgba(255,106,0,0.85)" strokeWidth="2.5" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 2px rgba(255,100,0,0.7))' }} />
      )}
      {/* Gunmetal dome body — NO dome highlight for flat industrial look */}
      <circle cx={cx} cy={cy} r={knobR} fill={`url(#${gId})`}
        stroke="rgba(255,100,0,0.15)" strokeWidth="0.8" />
      {/* Orange indicator line */}
      <line x1={iX1} y1={iY1} x2={iX2} y2={iY2}
        stroke="#FF6A00" strokeWidth="2.2" strokeLinecap="round" />
      {/* Center bolt */}
      <circle cx={cx} cy={cy} r="2.0" fill="rgba(0,0,0,0.5)" stroke="rgba(255,100,0,0.2)" strokeWidth="0.6" />
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
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, userSelect: 'none', width: size + 14, position: 'relative', zIndex: 2 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <TankKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,140,60,0.75)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 7, color: 'rgba(220,100,30,0.45)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
    </div>
  );
}

// GainKnob uses TankKnob visuals
function GainKnob({ value, onChange, label, defaultValue = 1 }) {
  const size = 20;
  const [dragging, setDragging] = useState(false);
  const ref = useRef({ y: 0, v: 0 });
  const norm = Math.min(1, value / 2);
  const onDown = e => {
    e.preventDefault(); setDragging(true);
    ref.current = { y: e.clientY, v: value };
    const onMove = ev => onChange(Math.max(0, Math.min(2, ref.current.v + (ref.current.y - ev.clientY) * 2 / 100)));
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)}
        style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <TankKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(220,100,30,0.5)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

// Drive mode labels
const DRIVE_MODES = ['CLEAN', 'TAPE', 'CRUNCH'];

const PRESETS = [
  { name: 'PUNCHY DRUMS',   punch: 0.70, smack: 0.55, body: 0.45, tone: 0.55, width: 0.50, mix: 0.80, drive: 1 },
  { name: 'HEAVY KICK',     punch: 0.50, smack: 0.40, body: 0.80, tone: 0.35, width: 0.30, mix: 0.85, drive: 1 },
  { name: 'SNARE CRACK',    punch: 0.85, smack: 0.75, body: 0.30, tone: 0.70, width: 0.50, mix: 0.75, drive: 2 },
  { name: 'PARALLEL SMASH', punch: 0.90, smack: 0.80, body: 0.60, tone: 0.50, width: 0.50, mix: 0.65, drive: 2 },
  { name: 'WARM TAPE BUS',  punch: 0.45, smack: 0.30, body: 0.55, tone: 0.38, width: 0.50, mix: 0.88, drive: 1 },
  { name: 'MODERN POP KIT', punch: 0.65, smack: 0.60, body: 0.45, tone: 0.68, width: 0.65, mix: 0.82, drive: 1 },
  { name: 'LO-FI CRUNCH',   punch: 0.55, smack: 0.70, body: 0.50, tone: 0.42, width: 0.40, mix: 0.78, drive: 2 },
  { name: 'TIGHT ROOM KIT', punch: 0.60, smack: 0.45, body: 0.40, tone: 0.52, width: 0.35, mix: 0.80, drive: 0 },
];

const PRESET_COLORS = {
  bg: '#131518', text: '#e06020', textDim: 'rgba(224,96,32,0.5)',
  border: 'rgba(255,100,0,0.15)', hoverBg: 'rgba(255,100,0,0.08)', activeBg: 'rgba(255,100,0,0.05)',
};

export default function DrumBusOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [punch,  setPunch]  = useState(initialState?.punch  ?? 0.5);
  const [smack,  setSmack]  = useState(initialState?.smack  ?? 0.5);
  const [body,   setBody]   = useState(initialState?.body   ?? 0.5);
  const [tone,   setTone]   = useState(initialState?.tone   ?? 0.5);
  const [width,  setWidth]  = useState(initialState?.width  ?? 0.5);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 0.8);
  const [drive,  setDrive]  = useState(initialState?.drive  ?? 1);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakIn,    setPeakIn]    = useState(0);
  const [peakOut,   setPeakOut]   = useState(0);
  const [gr,        setGr]        = useState(0);
  const [transient, setTransient] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, punch, smack, body, tone, width, mix, drive, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createDrumBusEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setPunch(s.punch); eng.setSmack(s.smack); eng.setBody(s.body);
      eng.setTone(s.tone); eng.setWidth(s.width); eng.setMix(s.mix);
      eng.setDrive(s.drive);
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

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (engineRef.current) {
        setPeakIn(engineRef.current.getInputPeak?.() ?? 0);
        setPeakOut(engineRef.current.getOutputPeak?.() ?? engineRef.current.getPeakOut?.() ?? 0);
        setGr(engineRef.current.getGR?.() ?? 0);
        setTransient(engineRef.current.getTransient?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, punch, smack, body, tone, width, mix, drive, bypassed, preset: activePreset });
  }, [inputGain, outputGain, punch, smack, body, tone, width, mix, drive, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setPunch(p.punch); setSmack(p.smack); setBody(p.body);
    setTone(p.tone);   setWidth(p.width); setMix(p.mix);
    setDrive(p.drive); setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setPunch(p.punch); e.setSmack(p.smack); e.setBody(p.body);
      e.setTone(p.tone);   e.setWidth(p.width); e.setMix(p.mix);
      e.setDrive(p.drive);
    }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #161820 0%, #131518 40%, #0f1012 100%)',
      border: '1.5px solid rgba(255,100,0,0.22)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.95), 0 0 14px rgba(255,80,0,0.06), inset 0 1px 0 rgba(255,100,0,0.04)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      {/* Vignette overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(10,10,12,0.35) 100%)',
        borderRadius: 5,
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,100,0,0.08)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(255,80,0,0.02) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, gap: 3 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{
              fontSize: 9, fontWeight: 900, letterSpacing: '0.45em',
              color: 'rgba(200,80,10,0.55)',
              fontFamily: '"Arial Black", "Arial Bold", Impact, sans-serif',
              textTransform: 'uppercase', lineHeight: 1,
            }}>DRUM</span>
            <span style={{
              fontSize: 20, fontWeight: 900, letterSpacing: '0.08em',
              background: 'linear-gradient(180deg, #FF9040 0%, #FF5500 40%, #cc3800 100%)',
              backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 2px 6px rgba(255,80,0,0.55)) drop-shadow(0 0 14px rgba(255,100,0,0.30))',
              fontFamily: '"Arial Black", "Arial Bold", Impact, sans-serif',
              textTransform: 'uppercase', lineHeight: 1,
            }}>BUS</span>
          </div>
          <span style={{
            fontSize: 5.5, fontWeight: 400, color: 'rgba(200,90,20,0.28)',
            letterSpacing: '0.3em', fontFamily: 'system-ui, Arial, sans-serif',
          }}>punch · smack · body</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Preset row */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,100,0,0.05)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(255,120,60,0.4)' }}>...</span>}
          {onRemove && (
            <span
              onClick={onRemove}
              style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }}
              title="Remove"
              onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}
            >x</span>
          )}
        </div>
      </div>

      {/* Hero canvas */}
      <div style={{ position: 'relative', zIndex: 2, height: BUS_H, flexShrink: 0, overflow: 'hidden' }}>
        <TankCanvas
          punch={punch} smack={smack} body={body} tone={tone} width={width}
          peakIn={peakIn} peakOut={peakOut} gr={gr} transient={transient}
        />
      </div>

      {/* Drive mode toggle — 3-way button strip */}
      <div style={{
        padding: '5px 14px 4px', display: 'flex', justifyContent: 'center', gap: 5,
        borderTop: '1px solid rgba(255,100,0,0.06)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        {DRIVE_MODES.map((m, i) => {
          const active = drive === i;
          return (
            <button key={m} onClick={() => { setDrive(i); engineRef.current?.setDrive(i); setActivePreset(null); }}
              style={{
                fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 10px',
                borderRadius: 3, cursor: 'pointer', outline: 'none',
                background: active ? 'rgba(255,100,0,0.25)' : 'rgba(255,255,255,0.02)',
                color: active ? '#FF7730' : 'rgba(180,80,30,0.4)',
                boxShadow: active ? '0 0 7px rgba(255,100,0,0.38), inset 0 0 4px rgba(255,100,0,0.08)' : 'none',
                border: active ? '1px solid rgba(255,100,0,0.50)' : '1px solid rgba(120,50,10,0.18)',
                transition: 'all 0.13s',
                fontFamily: '"Courier New", monospace',
              }}>{m}</button>
          );
        })}
      </div>

      {/* Knob row */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderTop: '1px solid rgba(255,100,0,0.05)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="PUNCH" value={punch} defaultValue={0.5} size={32} format={pctFmt}
          onChange={v => { setPunch(v); engineRef.current?.setPunch(v); setActivePreset(null); }} />
        <Knob label="SMACK" value={smack} defaultValue={0.5} size={32} format={pctFmt}
          onChange={v => { setSmack(v); engineRef.current?.setSmack(v); setActivePreset(null); }} />
        <Knob label="BODY" value={body} defaultValue={0.5} size={32} format={pctFmt}
          onChange={v => { setBody(v); engineRef.current?.setBody(v); setActivePreset(null); }} />
        <Knob label="TONE" value={tone} defaultValue={0.5} size={32} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRITE' : 'WARM'}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }} />
        <Knob label="WIDTH" value={width} defaultValue={0.5} size={32} format={pctFmt}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.8} size={32} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 18px 5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <ConsolBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
