import { useState, useEffect, useRef, useCallback } from 'react';
import { createCharacterEngine } from './characterEngine';
import PresetSelector from './PresetSelector';

// ─── CHARACTER VOCAL BOX: Neon CRT / Retro TV Channel Selector ─────────────
// Each style shows a different animated pattern on the "screen":
// radio waves, dream clouds, glitch pixels, warm vinyl, aggressive waveform, static
// Scanlines, phosphor glow. Colors: neon green CRT with mode-specific accents.

const MODE_THEMES = [
  { name: 'RADIO',    accent: '#40ff60', accentDim: 'rgba(64,255,96,0.3)',  hue: 130, icon: '\u{1F4FB}', screenBg: '#041208' },
  { name: 'DREAM',    accent: '#c080ff', accentDim: 'rgba(192,128,255,0.3)', hue: 270, icon: '\u{2601}',  screenBg: '#0a0418' },
  { name: 'HYPER',    accent: '#ff40e0', accentDim: 'rgba(255,64,224,0.3)',  hue: 310, icon: '\u{26A1}',  screenBg: '#180414' },
  { name: 'INDIE',    accent: '#ffa040', accentDim: 'rgba(255,160,64,0.3)',  hue: 30,  icon: '\u{1F3B6}', screenBg: '#181008' },
  { name: 'RAP',      accent: '#ff4040', accentDim: 'rgba(255,64,64,0.3)',   hue: 0,   icon: '\u{1F525}', screenBg: '#180808' },
  { name: 'PHONE',    accent: '#80ff80', accentDim: 'rgba(128,255,128,0.3)', hue: 120, icon: '\u{260E}',  screenBg: '#041808' },
];

const STYLE_VALUES = [0.0, 0.25, 0.42, 0.58, 0.75, 0.92];

// ─── CRT Screen Canvas ─────────────────────────────────────────────────────
function CRTScreen({ mode, intensity, tone, motion, peakLevel }) {
  const canvasRef = useRef(null);
  const valRef = useRef({ mode: 0, intensity: 0.5, tone: 0.5, motion: 0.3, peakLevel: 0 });
  const phaseRef = useRef(0);
  const waveHistRef = useRef(new Float32Array(64));

  valRef.current = { mode, intensity, tone, motion, peakLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 280;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Persistent per-mode state
    var dreamClouds = [];
    for (var dc = 0; dc < 14; dc++) {
      dreamClouds.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 8 + Math.random() * 18, speed: 0.15 + Math.random() * 0.3,
        hue: [330, 270, 200, 50, 160, 290][dc % 6], phase: Math.random() * 6.28,
      });
    }
    var fireParticles = [];

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.018;
      var phase = phaseRef.current;
      var v = valRef.current;
      var th = MODE_THEMES[v.mode];
      var reactivity = 0.2 + v.peakLevel * 0.8;
      var motionSpeed = 0.5 + v.motion * 1.5;

      if (v.mode === 0) {
        // ═══ RADIO: Analog TV static, scan lines, warm amber CRT glow, radio tower ═══
        // Warm amber background
        var radBg = ctx.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.5, W * 0.6);
        radBg.addColorStop(0, 'rgba(40,25,5,1)');
        radBg.addColorStop(0.5, 'rgba(25,15,3,1)');
        radBg.addColorStop(1, 'rgba(10,6,2,1)');
        ctx.fillStyle = radBg;
        ctx.fillRect(0, 0, W, H);

        // Analog TV static noise
        var staticCount = Math.round(800 + v.intensity * 1500 + v.peakLevel * 500);
        for (var si = 0; si < staticCount; si++) {
          var sx = Math.random() * W;
          var sy = Math.random() * H;
          var sb = 120 + Math.random() * 135;
          var sa = 0.1 + Math.random() * 0.25 * reactivity;
          ctx.fillStyle = 'rgba(' + Math.round(sb) + ',' + Math.round(sb * 0.85) + ',' + Math.round(sb * 0.5) + ',' + sa.toFixed(3) + ')';
          ctx.fillRect(sx, sy, 1 + Math.random() * 2, 1);
        }

        // Horizontal scan lines (thick, CRT style)
        for (var scy = 0; scy < H; scy += 3) {
          var scanAlpha = 0.08 + Math.sin(phase * 2 + scy * 0.1) * 0.04;
          ctx.fillStyle = 'rgba(255,180,60,' + scanAlpha.toFixed(3) + ')';
          ctx.fillRect(0, scy, W, 1);
        }

        // Rolling scan bar
        var scanBarY = ((phase * 30 * motionSpeed) % (H + 30)) - 15;
        var scanBarGrad = ctx.createLinearGradient(0, scanBarY - 10, 0, scanBarY + 10);
        scanBarGrad.addColorStop(0, 'rgba(255,200,80,0)');
        scanBarGrad.addColorStop(0.5, 'rgba(255,200,80,' + (0.15 + v.intensity * 0.15).toFixed(3) + ')');
        scanBarGrad.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = scanBarGrad;
        ctx.fillRect(0, scanBarY - 10, W, 20);

        // Radio tower icon (center)
        var towerX = W * 0.5;
        var towerBase = H * 0.85;
        ctx.strokeStyle = 'rgba(255,180,60,' + (0.6 + reactivity * 0.4).toFixed(3) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(towerX, towerBase); ctx.lineTo(towerX, towerBase - 40);
        ctx.moveTo(towerX - 10, towerBase); ctx.lineTo(towerX, towerBase - 30);
        ctx.moveTo(towerX + 10, towerBase); ctx.lineTo(towerX, towerBase - 30);
        ctx.stroke();

        // Radio waves from tower tip
        for (var rw = 0; rw < 8; rw++) {
          var rwT = (phase * 0.8 * motionSpeed + rw * 0.35) % 3;
          var rwR = rwT * (20 + v.intensity * 25);
          var rwA = Math.max(0, (1 - rwT * 0.35)) * 0.5 * reactivity;
          ctx.beginPath();
          ctx.arc(towerX, towerBase - 42, rwR, -0.8, 0.8);
          ctx.strokeStyle = 'rgba(255,200,80,' + rwA.toFixed(3) + ')';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Signal strength meter top-right
        for (var sb2 = 0; sb2 < 6; sb2++) {
          var bh = (5 + sb2 * 4) * reactivity * v.intensity;
          ctx.fillStyle = 'rgba(255,180,60,' + (0.3 + sb2 * 0.1).toFixed(3) + ')';
          ctx.fillRect(W - 50 + sb2 * 7, H * 0.25 - bh, 5, bh);
        }

        // Amber CRT vignette glow
        var vigGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.15, W * 0.5, H * 0.5, W * 0.55);
        vigGrad.addColorStop(0, 'rgba(255,160,40,' + (0.05 + v.intensity * 0.08).toFixed(3) + ')');
        vigGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, W, H);

      } else if (v.mode === 1) {
        // ═══ DREAM POP: Pastel clouds floating, soft rainbow gradient, dreamy particles ═══
        // Soft pastel rainbow sky gradient
        var dreamGrad = ctx.createLinearGradient(0, 0, W, H);
        var dShift = Math.sin(phase * 0.2) * 30;
        dreamGrad.addColorStop(0, 'hsla(' + Math.round(280 + dShift) + ',60%,75%,1)');
        dreamGrad.addColorStop(0.25, 'hsla(' + Math.round(330 + dShift) + ',65%,80%,1)');
        dreamGrad.addColorStop(0.5, 'hsla(' + Math.round(200 + dShift) + ',55%,78%,1)');
        dreamGrad.addColorStop(0.75, 'hsla(' + Math.round(50 + dShift) + ',60%,82%,1)');
        dreamGrad.addColorStop(1, 'hsla(' + Math.round(160 + dShift) + ',50%,76%,1)');
        ctx.fillStyle = dreamGrad;
        ctx.fillRect(0, 0, W, H);

        // Darken to medium tone
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, W, H);

        // Floating pastel cloud blobs
        for (var dci = 0; dci < dreamClouds.length; dci++) {
          var dcl = dreamClouds[dci];
          dcl.x += Math.sin(phase * 0.3 + dcl.phase) * 0.4 * motionSpeed;
          dcl.y += Math.cos(phase * 0.2 + dcl.phase * 1.3) * 0.3 * motionSpeed;
          if (dcl.x > W + 20) dcl.x = -20;
          if (dcl.x < -20) dcl.x = W + 20;
          if (dcl.y > H + 20) dcl.y = -20;
          if (dcl.y < -20) dcl.y = H + 20;

          var dcR = dcl.r * (0.8 + v.intensity * 0.6 + Math.sin(phase * 0.4 + dci) * 0.2);
          var dcGrad = ctx.createRadialGradient(dcl.x, dcl.y, 0, dcl.x, dcl.y, dcR);
          var dcH = dcl.hue + Math.sin(phase * 0.3 + dci * 0.7) * 20;
          dcGrad.addColorStop(0, 'hsla(' + Math.round(dcH) + ',70%,80%,' + (0.35 * reactivity).toFixed(3) + ')');
          dcGrad.addColorStop(0.5, 'hsla(' + Math.round(dcH + 20) + ',60%,75%,' + (0.18 * reactivity).toFixed(3) + ')');
          dcGrad.addColorStop(1, 'hsla(' + Math.round(dcH) + ',50%,70%,0)');
          ctx.fillStyle = dcGrad;
          ctx.beginPath();
          ctx.arc(dcl.x, dcl.y, dcR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Dreamy sparkle particles everywhere
        for (var dpi = 0; dpi < 30; dpi++) {
          var dpx = (dpi * 31 + phase * 8 * motionSpeed) % W;
          var dpy = (dpi * 19 + Math.sin(phase * 0.7 + dpi) * 15 + H * 0.5) % H;
          var dps = 0.5 + Math.sin(phase * 2.5 + dpi * 0.9) * 0.5;
          var dpHue = (dpi * 60 + phase * 20) % 360;
          ctx.beginPath();
          ctx.arc(dpx, dpy, (1 + dps * 2) * reactivity, 0, Math.PI * 2);
          ctx.fillStyle = 'hsla(' + Math.round(dpHue) + ',70%,85%,' + (dps * 0.7).toFixed(3) + ')';
          ctx.fill();
          if (dps > 0.7) {
            var spkL = 4 * dps;
            ctx.strokeStyle = 'hsla(' + Math.round(dpHue) + ',80%,90%,' + (dps * 0.3).toFixed(3) + ')';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(dpx - spkL, dpy); ctx.lineTo(dpx + spkL, dpy);
            ctx.moveTo(dpx, dpy - spkL); ctx.lineTo(dpx, dpy + spkL);
            ctx.stroke();
          }
        }

        // Soft rainbow arc
        ctx.lineWidth = 4 + v.intensity * 4;
        for (var rai = 0; rai < 6; rai++) {
          var raH = [0, 30, 60, 140, 220, 280][rai];
          ctx.beginPath();
          ctx.arc(W * 0.5, H + 15 + rai * 3, 55 + rai * 5, Math.PI, 0);
          ctx.strokeStyle = 'hsla(' + raH + ',80%,70%,' + (0.12 + v.intensity * 0.12).toFixed(3) + ')';
          ctx.stroke();
        }

      } else if (v.mode === 2) {
        // ═══ HYPER POP: AGGRESSIVE neon glitch art, RGB split, pixel fragments, rapid cycling ═══
        // Black base
        ctx.fillStyle = 'rgba(5,0,10,1)';
        ctx.fillRect(0, 0, W, H);

        // Rapid color cycling background flash
        var cycleHue = (phase * 120 * motionSpeed) % 360;
        ctx.fillStyle = 'hsla(' + Math.round(cycleHue) + ',100%,50%,' + (0.05 + v.peakLevel * 0.15).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);

        // Glitch pixel blocks - MASSIVE amount
        var blockSize = 3 + Math.round((1 - v.intensity) * 5);
        var glitchCount = Math.round(40 + v.intensity * 80 + v.peakLevel * 60);
        for (var gi = 0; gi < glitchCount; gi++) {
          var gx = Math.random() * W;
          var gy = Math.random() * H;
          var gw = blockSize + Math.random() * blockSize * 3;
          var gh = blockSize * 0.3 + Math.random() * blockSize * 1.5;
          var gHue = (cycleHue + Math.random() * 180) % 360;
          ctx.fillStyle = 'hsla(' + Math.round(gHue) + ',100%,' + Math.round(50 + Math.random() * 40) + '%,' + (0.3 + Math.random() * 0.5 * reactivity).toFixed(3) + ')';
          ctx.fillRect(gx, gy, gw, gh);
        }

        // RGB split text "HYPER" - 3 offset copies
        ctx.font = 'bold 22px monospace';
        var hx = W * 0.5 - 35;
        var hy = H * 0.55;
        var shiftX = Math.sin(phase * 8) * 5 * v.motion;
        var shiftY = Math.cos(phase * 6) * 3 * v.motion;
        ctx.fillStyle = 'rgba(255,0,0,' + (0.5 + reactivity * 0.4).toFixed(3) + ')';
        ctx.fillText('HYPER', hx - 3 + shiftX, hy - 1 + shiftY);
        ctx.fillStyle = 'rgba(0,255,0,' + (0.5 + reactivity * 0.4).toFixed(3) + ')';
        ctx.fillText('HYPER', hx + 1 - shiftX, hy + 2 - shiftY);
        ctx.fillStyle = 'rgba(80,80,255,' + (0.5 + reactivity * 0.4).toFixed(3) + ')';
        ctx.fillText('HYPER', hx + shiftX * 0.5, hy + shiftY * 0.5);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.8 + reactivity * 0.2).toFixed(3) + ')';
        ctx.fillText('HYPER', hx, hy);

        // Aggressive horizontal glitch tears
        for (var gli = 0; gli < 8; gli++) {
          if (Math.random() < v.intensity * 0.6 + v.peakLevel * 0.4) {
            var gly = Math.random() * H;
            var glh = 1 + Math.random() * 4;
            var glOff = (Math.random() - 0.5) * 30 * v.intensity;
            var glHue = (cycleHue + gli * 45) % 360;
            ctx.fillStyle = 'hsla(' + Math.round(glHue) + ',100%,60%,' + (0.25 + Math.random() * 0.35).toFixed(3) + ')';
            ctx.fillRect(glOff, gly, W, glh);
          }
        }

        // Neon border flash
        var borderHue = (cycleHue + 180) % 360;
        ctx.strokeStyle = 'hsla(' + Math.round(borderHue) + ',100%,60%,' + (0.3 + v.peakLevel * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 2 + v.peakLevel * 3;
        ctx.strokeRect(2, 2, W - 4, H - 4);

      } else if (v.mode === 3) {
        // ═══ INDIE WARM: Sunset gradient, warm film grain, gentle floating embers, vintage ═══
        // Beautiful sunset gradient background
        var sunGrad = ctx.createLinearGradient(0, 0, 0, H);
        var sunShift = Math.sin(phase * 0.15) * 10;
        sunGrad.addColorStop(0, 'hsla(' + Math.round(30 + sunShift) + ',80%,55%,1)');
        sunGrad.addColorStop(0.3, 'hsla(' + Math.round(15 + sunShift) + ',85%,45%,1)');
        sunGrad.addColorStop(0.5, 'hsla(' + Math.round(350 + sunShift) + ',70%,35%,1)');
        sunGrad.addColorStop(0.75, 'hsla(' + Math.round(280 + sunShift) + ',50%,25%,1)');
        sunGrad.addColorStop(1, 'hsla(' + Math.round(250 + sunShift) + ',40%,15%,1)');
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, W, H);

        // Sun orb
        var sunOrbX = W * 0.5 + Math.sin(phase * 0.1) * 20;
        var sunOrbY = H * 0.35;
        var sunOrbR = 18 + v.intensity * 10 + v.peakLevel * 5;
        var sGrad = ctx.createRadialGradient(sunOrbX, sunOrbY, 0, sunOrbX, sunOrbY, sunOrbR * 2.5);
        sGrad.addColorStop(0, 'rgba(255,220,120,' + (0.6 + reactivity * 0.3).toFixed(3) + ')');
        sGrad.addColorStop(0.3, 'rgba(255,180,80,' + (0.35 + reactivity * 0.2).toFixed(3) + ')');
        sGrad.addColorStop(0.6, 'rgba(255,120,60,' + (0.15 + reactivity * 0.1).toFixed(3) + ')');
        sGrad.addColorStop(1, 'rgba(255,80,40,0)');
        ctx.fillStyle = sGrad;
        ctx.beginPath();
        ctx.arc(sunOrbX, sunOrbY, sunOrbR * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Warm film grain
        var grainCount = Math.round(200 + v.intensity * 400);
        for (var gri = 0; gri < grainCount; gri++) {
          var grx = Math.random() * W;
          var gry = Math.random() * H;
          var grb = Math.random() > 0.5 ? 1 : -1;
          ctx.fillStyle = 'rgba(' + (grb > 0 ? '255,220,180' : '0,0,0') + ',' + (0.03 + Math.random() * 0.06).toFixed(3) + ')';
          ctx.fillRect(grx, gry, 1, 1);
        }

        // Floating embers rising gently
        for (var ei = 0; ei < 20; ei++) {
          var ex = (ei * 29 + Math.sin(phase * 0.5 + ei * 0.8) * 15 + phase * 3 * motionSpeed) % (W + 20) - 10;
          var ey = H - ((phase * 10 * motionSpeed + ei * 17) % (H + 20)) + 10;
          var eAlpha = 0.4 + Math.sin(phase * 2 + ei) * 0.3;
          var eSize = 1 + Math.sin(phase + ei * 0.5) * 0.5;
          ctx.beginPath();
          ctx.arc(ex, ey, eSize * reactivity, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,200,80,' + eAlpha.toFixed(3) + ')';
          ctx.fill();
          var eGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, eSize * 4);
          eGlow.addColorStop(0, 'rgba(255,150,50,' + (eAlpha * 0.3).toFixed(3) + ')');
          eGlow.addColorStop(1, 'rgba(255,100,30,0)');
          ctx.fillStyle = eGlow;
          ctx.beginPath();
          ctx.arc(ex, ey, eSize * 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Vintage rounded corners vignette
        var vinGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.2, W * 0.5, H * 0.5, W * 0.6);
        vinGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vinGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = vinGrad;
        ctx.fillRect(0, 0, W, H);

      } else if (v.mode === 4) {
        // ═══ AGGRESSIVE RAP: Red/black energy, bass waveform pulses, fire, hard edges ═══
        // Deep red/black background
        ctx.fillStyle = 'rgba(15,2,2,1)';
        ctx.fillRect(0, 0, W, H);

        // Pulsing red vignette
        var rapPulse = 0.3 + v.peakLevel * 0.7;
        var rapGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, 5, W * 0.5, H * 0.5, W * 0.55);
        rapGrad.addColorStop(0, 'rgba(80,0,0,' + (rapPulse * 0.3).toFixed(3) + ')');
        rapGrad.addColorStop(0.5, 'rgba(40,0,0,' + (rapPulse * 0.15).toFixed(3) + ')');
        rapGrad.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = rapGrad;
        ctx.fillRect(0, 0, W, H);

        // Bass waveform pulses
        var wh = waveHistRef.current;
        for (var wi = wh.length - 1; wi > 0; wi--) wh[wi] = wh[wi - 1];
        wh[0] = v.peakLevel;

        // Fill waveform (aggressive thick)
        ctx.beginPath();
        ctx.moveTo(0, H * 0.5);
        for (var wdi = 0; wdi < wh.length; wdi++) {
          var wx = (wdi / wh.length) * W;
          var wamp = wh[wdi] * H * 0.4 * (1 + v.intensity * 0.8);
          var wy = H * 0.5 + Math.sin(phase * 4 + wdi * 0.4) * wamp;
          ctx.lineTo(wx, wy);
        }
        ctx.lineTo(W, H * 0.5);
        for (var wdi2 = wh.length - 1; wdi2 >= 0; wdi2--) {
          var wx2 = (wdi2 / wh.length) * W;
          var wamp2 = wh[wdi2] * H * 0.4 * (1 + v.intensity * 0.8);
          var wy2 = H * 0.5 - Math.sin(phase * 4 + wdi2 * 0.4) * wamp2;
          ctx.lineTo(wx2, wy2);
        }
        ctx.closePath();
        var wGrad = ctx.createLinearGradient(0, 0, 0, H);
        wGrad.addColorStop(0, 'rgba(255,40,0,' + (0.4 * reactivity).toFixed(3) + ')');
        wGrad.addColorStop(0.5, 'rgba(255,0,0,' + (0.6 * reactivity).toFixed(3) + ')');
        wGrad.addColorStop(1, 'rgba(200,0,0,' + (0.4 * reactivity).toFixed(3) + ')');
        ctx.fillStyle = wGrad;
        ctx.fill();

        // Bright edge strokes
        ctx.beginPath();
        for (var wsi = 0; wsi < wh.length; wsi++) {
          var wsx = (wsi / wh.length) * W;
          var wsamp = wh[wsi] * H * 0.4 * (1 + v.intensity * 0.8);
          var wsy = H * 0.5 + Math.sin(phase * 4 + wsi * 0.4) * wsamp;
          if (wsi === 0) ctx.moveTo(wsx, wsy); else ctx.lineTo(wsx, wsy);
        }
        ctx.strokeStyle = 'rgba(255,120,40,' + (0.7 + reactivity * 0.3).toFixed(3) + ')';
        ctx.lineWidth = 2.5 + v.peakLevel * 3;
        ctx.stroke();

        // Fire particles rising from bottom
        if (Math.random() < 0.3 + v.peakLevel * 0.5 + v.intensity * 0.3) {
          fireParticles.push({
            x: Math.random() * W, y: H + 2,
            vy: -(1 + Math.random() * 2 + v.peakLevel * 2),
            vx: (Math.random() - 0.5) * 1.5,
            size: 2 + Math.random() * 3, life: 1,
          });
        }
        for (var fi = fireParticles.length - 1; fi >= 0; fi--) {
          var fp = fireParticles[fi];
          fp.x += fp.vx;
          fp.y += fp.vy;
          fp.life -= 0.025;
          if (fp.life <= 0 || fp.y < -5) { fireParticles.splice(fi, 1); continue; }
          var fHue = 0 + fp.life * 40;
          ctx.beginPath();
          ctx.arc(fp.x, fp.y, fp.size * fp.life, 0, Math.PI * 2);
          ctx.fillStyle = 'hsla(' + Math.round(fHue) + ',100%,' + Math.round(40 + fp.life * 30) + '%,' + (fp.life * 0.8).toFixed(3) + ')';
          ctx.fill();
        }
        if (fireParticles.length > 80) fireParticles.splice(0, fireParticles.length - 80);

        // Impact flash on loud peaks
        if (v.peakLevel > 0.5) {
          var impR = 20 + v.peakLevel * 40;
          var impGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, impR);
          impGrad.addColorStop(0, 'rgba(255,200,100,' + (v.peakLevel * 0.5).toFixed(3) + ')');
          impGrad.addColorStop(0.5, 'rgba(255,60,20,' + (v.peakLevel * 0.3).toFixed(3) + ')');
          impGrad.addColorStop(1, 'rgba(200,0,0,0)');
          ctx.fillStyle = impGrad;
          ctx.beginPath();
          ctx.arc(W * 0.5, H * 0.5, impR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Hard edge border
        ctx.strokeStyle = 'rgba(255,40,0,' + (0.3 + v.peakLevel * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, H - 2);

      } else {
        // ═══ TELEPHONE: Green terminal text scrolling, old phone receiver, digital noise ═══
        // Dark terminal green-black background
        ctx.fillStyle = 'rgba(0,8,0,1)';
        ctx.fillRect(0, 0, W, H);

        // Matrix-style falling characters
        ctx.font = '8px monospace';
        var colCount = Math.round(W / 8);
        for (var col = 0; col < colCount; col++) {
          var chars = '0123456789ABCDEF>_|/+*#@$';
          var charIdx = Math.floor((phase * 3 * motionSpeed + col * 7.3) % chars.length);
          var yOffset = ((phase * 20 * motionSpeed + col * 23) % (H + 16)) - 8;
          for (var row = 0; row < 5; row++) {
            var chy = yOffset + row * 10;
            if (chy < 0 || chy > H) continue;
            var chA = (1 - row * 0.2) * (0.15 + v.intensity * 0.25) * reactivity;
            var ch = chars[(charIdx + row * 3) % chars.length];
            ctx.fillStyle = 'rgba(0,255,0,' + chA.toFixed(3) + ')';
            ctx.fillText(ch, col * 8, chy);
          }
        }

        // Phone receiver icon center
        ctx.save();
        ctx.translate(W * 0.5, H * 0.5);
        ctx.rotate(Math.sin(phase * 1.5) * 0.1 * v.motion);
        ctx.strokeStyle = 'rgba(0,255,0,' + (0.5 + reactivity * 0.4).toFixed(3) + ')';
        ctx.lineWidth = 2.5;
        // Receiver shape
        ctx.beginPath();
        ctx.arc(0, 0, 12, Math.PI * 0.8, Math.PI * 2.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-10, 6, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(10, 6, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Digital noise blocks
        for (var dni = 0; dni < Math.round(30 + v.intensity * 50); dni++) {
          var dnx = Math.random() * W;
          var dny = Math.random() * H;
          var dna = 0.05 + Math.random() * 0.15 * reactivity;
          ctx.fillStyle = 'rgba(0,' + Math.round(150 + Math.random() * 105) + ',0,' + dna.toFixed(3) + ')';
          ctx.fillRect(dnx, dny, 2 + Math.random() * 4, 1 + Math.random() * 2);
        }

        // Telephone waveform
        ctx.beginPath();
        for (var twx = 0; twx < W; twx += 2) {
          var twy = H * 0.5 + Math.sin(twx * 0.06 + phase * 5) * (8 + v.peakLevel * 15) + Math.sin(twx * 0.15 + phase * 2) * 4;
          if (twx === 0) ctx.moveTo(twx, twy); else ctx.lineTo(twx, twy);
        }
        ctx.strokeStyle = 'rgba(0,255,80,' + (0.4 + reactivity * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Green CRT glow border
        ctx.strokeStyle = 'rgba(0,255,0,' + (0.15 + v.peakLevel * 0.2).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(1, 1, W - 2, H - 2);

        // Phosphor glow vignette
        var phosGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.15, W * 0.5, H * 0.5, W * 0.55);
        phosGrad.addColorStop(0, 'rgba(0,40,0,' + (0.08 + v.intensity * 0.08).toFixed(3) + ')');
        phosGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = phosGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Scanlines overlay (CRT effect) — all modes ──
      for (var sly = 0; sly < H; sly += 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(0, sly, W, 1);
      }

      // ── Phosphor border glow on edges ──
      ctx.strokeStyle = th.accent + '33';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: 380, height: 280, display: 'block', borderRadius: 2, border: '2px solid #1a1a1a' }} />;
}

// ─── Channel Button ─────────────────────────────────────────────────────────
function ChannelButton({ label, icon, active, onClick, theme }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 28, borderRadius: 3, cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
      background: active ? `${theme.accent}18` : 'rgba(20,20,30,0.8)',
      border: `1.5px solid ${active ? theme.accent : 'rgba(60,60,80,0.3)'}`,
      boxShadow: active ? `0 0 8px ${theme.accentDim}, inset 0 0 4px ${theme.accentDim}` : 'none',
      transition: 'all 0.15s',
      padding: 0,
    }}>
      <span style={{ fontSize: 9, lineHeight: 1 }}>{icon}</span>
      <span style={{
        fontSize: 4.5, fontWeight: 800, letterSpacing: '0.06em',
        color: active ? theme.accent : 'rgba(120,120,140,0.5)',
        fontFamily: 'monospace',
      }}>{label}</span>
    </button>
  );
}

// ─── Knob ───────────────────────────────────────────────────────────────────
function CRTKnob({ size = 34, norm = 0, accent = '#40ff60' }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const angle = -135 + norm * 270;
  const rad = (angle - 90) * Math.PI / 180;
  const ptrLen = r * 0.7;
  const px = cx + ptrLen * Math.cos(rad);
  const py = cy + ptrLen * Math.sin(rad);

  return (
    <svg width={size + 8} height={size + 8} style={{ display: 'block', overflow: 'visible', margin: '-4px', pointerEvents: 'none' }}>
      <circle cx={cx + 4} cy={cy + 4} r={r} fill="#0a0a14" stroke="rgba(80,80,100,0.2)" strokeWidth="1" />
      <circle cx={cx + 4} cy={cy + 4} r={r - 3} fill="#060610" stroke={`${accent}20`} strokeWidth="0.5" />
      <line x1={cx + 4} y1={cy + 4} x2={px + 4} y2={py + 4}
        stroke={accent} strokeWidth={2} strokeLinecap="round" opacity="0.85" />
      <circle cx={cx + 4} cy={cy + 4} r="2" fill={`${accent}40`} />
    </svg>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, defaultValue, size = 34, format, sensitivity = 160, accent = '#40ff60' }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none', width: size + 12 }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)}
        style={{ width: size + 8, height: size + 8, cursor: dragging ? 'grabbing' : 'grab' }}>
        <CRTKnob size={size} norm={norm} accent={accent} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.12em', color: `${accent}aa`, fontWeight: 700, fontFamily: 'monospace' }}>{label}</span>
      <span style={{ fontSize: 5.5, color: `${accent}60`, fontFamily: 'monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── Vertical Slider ────────────────────────────────────────────────────────
function VSlider({ value, onChange, label, min = 0, max = 1, defaultValue = 1, height = 50, format, accent = '#40ff60' }) {
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
        style={{ width: 10, height, background: '#060610', borderRadius: 2, border: `1px solid ${accent}15`, position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 1, right: 1, height: `${norm * 100}%`, background: `${accent}08`, borderRadius: 1 }} />
        <div style={{ position: 'absolute', left: -1, right: -1, height: 4, borderRadius: 1, background: accent, bottom: `calc(${norm * 100}% - 2px)`, boxShadow: `0 0 6px ${accent}40` }} />
      </div>
      <span style={{ fontSize: 5, color: `${accent}50`, fontWeight: 600, letterSpacing: '0.1em', fontFamily: 'monospace' }}>{label}</span>
      <span style={{ fontSize: 5, color: `${accent}40`, fontFamily: 'monospace', fontWeight: 600 }}>{display}</span>
    </div>
  );
}

// ─── LED Meter ──────────────────────────────────────────────────────────────
const METER_SEGMENTS = 16;
function LedMeter({ meterRef, accent }) {
  const containerRef = useRef(null);
  useEffect(() => { if (containerRef.current) meterRef.current = containerRef.current.children; }, []);
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 50, background: '#060610', padding: '3px 2px', borderRadius: 2, border: `1px solid ${accent}10` }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 2, borderRadius: 0.5, background: `${accent}08` }} />
      ))}
    </div>
  );
}

function DbReadout({ dbRef, accent }) {
  return <span ref={dbRef} style={{ fontSize: 6, fontFamily: 'monospace', fontWeight: 700, color: `${accent}50`, letterSpacing: '0.05em', width: 28, textAlign: 'center', display: 'inline-block' }}>-{'\u221E'}<span style={{ fontSize: 4.5, opacity: 0.6 }}>dB</span></span>;
}

function updateMeter(segmentEls, dbEl, level, accent) {
  if (!segmentEls || !segmentEls.length) return;
  const dB = level > 1e-6 ? 20 * Math.log10(level) + 2 : -999;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const threshDb = -40 + (i / METER_SEGMENTS) * 46;
    const lit = dB > threshDb;
    const col = i >= METER_SEGMENTS - 2 ? '#ff4040' : i >= METER_SEGMENTS - 4 ? '#ffaa30' : accent;
    segmentEls[i].style.background = lit ? col : `${accent}08`;
  }
  if (dbEl) {
    const dbVal = level > 1e-6 ? 20 * Math.log10(level) : -Infinity;
    const display = dbVal > -60 ? `${dbVal >= 0 ? '+' : ''}${dbVal.toFixed(1)}` : '-\u221E';
    const clr = dbVal > -1 ? '#ff4040' : dbVal > -6 ? '#ffaa30' : `${accent}50`;
    dbEl.style.color = clr;
    dbEl.firstChild.textContent = display;
  }
}

// ─── Presets ────────────────────────────────────────────────────────────────
const PRESETS = [
  { name: 'RADIO READY',       style: 0, intensity: 0.5, tone: 0.5, motion: 0.2, mix: 0.7, output: 0.5 },
  { name: 'DREAM HOOK',        style: 1, intensity: 0.6, tone: 0.6, motion: 0.5, mix: 0.6, output: 0.52 },
  { name: 'HYPER LEAD',        style: 2, intensity: 0.7, tone: 0.7, motion: 0.6, mix: 0.65, output: 0.48 },
  { name: 'INDIE LO-FI VOCAL', style: 3, intensity: 0.5, tone: 0.35, motion: 0.3, mix: 0.55, output: 0.52 },
  { name: 'HARD RAP FORWARD',  style: 4, intensity: 0.7, tone: 0.6, motion: 0.2, mix: 0.75, output: 0.5 },
  { name: 'TELEPHONE EFFECT',  style: 5, intensity: 0.6, tone: 0.5, motion: 0.1, mix: 0.8, output: 0.5 },
];

// ─── Main Character Orb ────────────────────────────────────────────────────
export default function CharacterOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [style,      setStyle]      = useState(initialState?.style      ?? 0);
  const [intensity,  setIntensity]  = useState(initialState?.intensity  ?? 0.5);
  const [tone,       setTone]       = useState(initialState?.tone       ?? 0.5);
  const [motion,     setMotion]     = useState(initialState?.motion     ?? 0.3);
  const [mix,        setMix]        = useState(initialState?.mix        ?? 0.5);
  const [outputLevel, setOutputLevel] = useState(initialState?.outputLevel ?? 0.5);
  const [bypassed,   setBypassed]   = useState(initialState?.bypassed   ?? false);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peakLevel,  setPeakLevel]  = useState(0);

  const th = MODE_THEMES[style];
  const inMeterRef  = useRef(null);
  const outMeterRef = useRef(null);
  const inDbRef     = useRef(null);
  const outDbRef    = useRef(null);
  const accentRef   = useRef(th.accent);
  accentRef.current = th.accent;

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, style, intensity, tone, motion, mix, outputLevel, bypassed };

  useEffect(() => {
    if (!sharedSource) return;
    const ctx = sharedSource.ctx;
    setLoading(true);
    createCharacterEngine(ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain);
      eng.setOutputGain(s.outputGain);
      eng.setStyle(STYLE_VALUES[s.style]);
      eng.setIntensity(s.intensity);
      eng.setTone(s.tone);
      eng.setMotion(s.motion);
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

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        updateMeter(inMeterRef.current, inDbRef.current, engineRef.current.getInputPeak(), accentRef.current);
        updateMeter(outMeterRef.current, outDbRef.current, engineRef.current.getOutputPeak(), accentRef.current);
        setPeakLevel(engineRef.current.getInputPeak());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, style, intensity, tone, motion, mix, outputLevel, bypassed, preset: activePreset });
  }, [inputGain, outputGain, style, intensity, tone, motion, mix, outputLevel, bypassed, activePreset]);

  const loadPreset = useCallback((p) => {
    setStyle(p.style); setIntensity(p.intensity); setTone(p.tone);
    setMotion(p.motion); setMix(p.mix); setOutputLevel(p.output);
    setActivePreset(p.name);
    const e = engineRef.current;
    if (e) {
      e.setStyle(STYLE_VALUES[p.style]); e.setIntensity(p.intensity);
      e.setTone(p.tone); e.setMotion(p.motion); e.setMix(p.mix); e.setOutput(p.output);
    }
  }, []);

  const switchStyle = useCallback((idx) => {
    setStyle(idx);
    engineRef.current?.setStyle(STYLE_VALUES[idx]);
    setActivePreset(null);
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;
  const dbFmt = v => { const db = v > 0.001 ? 20 * Math.log10(v) : -Infinity; return db > -60 ? `${db >= 0 ? '+' : ''}${db.toFixed(1)}` : '-\u221E'; };
  const outFmt = v => { const db = -18 + v * 36; return `${db >= 0 ? '+' : ''}${db.toFixed(1)}dB`; };

  const presetColors = {
    bg: '#0a0a14', text: th.accent, textDim: th.accentDim,
    border: `${th.accent}20`, hoverBg: `${th.accent}15`, activeBg: `${th.accent}10`,
  };

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 6, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg, #0e0e1a 0%, #0a0a14 40%, #080810 100%)',
      border: `1.5px solid ${th.accent}22`,
      boxShadow: `0 4px 30px rgba(0,0,0,0.9), 0 0 15px ${th.accentDim}, inset 0 1px 0 ${th.accent}08`,
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      userSelect: 'none',
      transition: 'border-color 0.3s, box-shadow 0.3s',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${th.accent}15`,
        background: `linear-gradient(180deg, ${th.accent}05 0%, transparent 100%)`,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 900, letterSpacing: '0.05em',
            color: th.accent, fontFamily: 'monospace',
            textShadow: `0 0 10px ${th.accentDim}`,
          }}>CHARACTER</span>
          <span style={{
            fontSize: 6, fontWeight: 700, color: `${th.accent}40`,
            letterSpacing: '0.3em', marginTop: 1, fontFamily: 'monospace',
          }}>VOCAL BOX</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={presetColors} />
          {loading && <span style={{ fontSize: 6, color: th.accentDim }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{
            fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.7)',
            fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.7)'; }}
          >&times;</span>}
        </div>
      </div>

      {/* Channel selector */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', gap: 5,
        borderBottom: `1px solid ${th.accent}10`,
      }}>
        {MODE_THEMES.map((mt, i) => (
          <ChannelButton key={i} label={mt.name} icon={mt.icon}
            active={style === i} onClick={() => switchStyle(i)} theme={mt} />
        ))}
      </div>

      {/* CRT Screen */}
      <div style={{ padding: '4px 10px', borderBottom: `1px solid ${th.accent}10` }}>
        <CRTScreen mode={style} intensity={intensity} tone={tone} motion={motion} peakLevel={peakLevel} />
      </div>

      {/* Meters */}
      <div style={{
        padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5,
        borderBottom: `1px solid ${th.accent}10`,
      }}>
        <VSlider label="IN" value={inputGain} min={0} max={2} defaultValue={1} accent={th.accent}
          onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} format={dbFmt} />
        <LedMeter meterRef={inMeterRef} accent={th.accent} />
        <DbReadout dbRef={inDbRef} accent={th.accent} />
        <div style={{ width: 6 }} />
        <DbReadout dbRef={outDbRef} accent={th.accent} />
        <LedMeter meterRef={outMeterRef} accent={th.accent} />
        <VSlider label="OUT" value={outputGain} min={0} max={2} defaultValue={1} accent={th.accent}
          onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} format={dbFmt} />
      </div>

      {/* Knobs */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around',
        borderBottom: `1px solid ${th.accent}08`,
      }}>
        <Knob label="INTENSITY" value={intensity} min={0} max={1} defaultValue={0.5} accent={th.accent} size={28}
          onChange={v => { setIntensity(v); engineRef.current?.setIntensity(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="TONE" value={tone} min={0} max={1} defaultValue={0.5} accent={th.accent} size={28}
          onChange={v => { setTone(v); engineRef.current?.setTone(v); setActivePreset(null); }}
          format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'BRIGHT' : 'WARM'} />
        <Knob label="MOTION" value={motion} min={0} max={1} defaultValue={0.3} accent={th.accent} size={28}
          onChange={v => { setMotion(v); engineRef.current?.setMotion(v); setActivePreset(null); }} format={pctFmt} />
      </div>

      {/* Mix, Output, Bypass row */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end',
        borderBottom: `1px solid ${th.accent}08`,
      }}>
        <Knob label="MIX" value={mix} min={0} max={1} defaultValue={0.5} accent={th.accent} size={28}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} format={pctFmt} />
        <Knob label="OUTPUT" value={outputLevel} min={0} max={1} defaultValue={0.5} accent={th.accent} size={28}
          onChange={v => { setOutputLevel(v); engineRef.current?.setOutput(v); setActivePreset(null); }} format={outFmt} />
      </div>

      {/* Bypass */}
      <div style={{ padding: '5px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: bypassed ? 'rgba(80,80,100,0.3)' : th.accent,
            boxShadow: bypassed ? 'none' : `0 0 6px ${th.accentDim}`,
          }} />
          <span style={{ fontSize: 5, color: `${th.accent}50`, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.1em' }}>
            CH {style + 1}
          </span>
        </div>
        <button onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }}
          style={{
            fontSize: 6, fontWeight: 700, letterSpacing: '0.12em', fontFamily: 'monospace',
            padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
            background: bypassed ? 'rgba(40,40,50,0.5)' : `${th.accent}15`,
            color: bypassed ? 'rgba(120,120,140,0.4)' : th.accent,
            border: `1px solid ${bypassed ? 'rgba(60,60,80,0.2)' : th.accent + '30'}`,
            boxShadow: bypassed ? 'none' : `0 0 8px ${th.accentDim}`,
          }}>
          {bypassed ? 'OFF AIR' : 'ON AIR'}
        </button>
      </div>
    </div>
  );
}
