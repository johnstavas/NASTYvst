import { useState, useEffect, useRef, useCallback } from 'react';
import { createReverbBusEngine } from './reverbBusEngine';
import PresetSelector from './PresetSelector';

// ─── REVERB BUS ENGINE: Bus-Friendly Reverb ──────────────────────────────────
// Visual: MIXING CONSOLE / BUS METER STYLE
// Stacked horizontal VU meters, glue compression indicator, tuck ceiling line
// Professional, utilitarian: dark charcoal, green/amber/red meter, blue bus indicators

// ─── Bus Meter Canvas ────────────────────────────────────────────────────────
function BusMeterCanvas({ space, tuck, glue, color, width, peak = 0, outPeak = 0, gr = 0, reverbLevel = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(0);
  const bandHistoryRef = useRef(null);
  const valRef = useRef({ space: 0, tuck: 0, glue: 0, color: 0, width: 0, peak: 0, outPeak: 0, gr: 0, reverbLevel: 0 });

  valRef.current = { space, tuck, glue, color, width, peak, outPeak, gr, reverbLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 380, H = 200;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);

    // Band history for smoothed meters + VU needle positions
    if (!bandHistoryRef.current) {
      bandHistoryRef.current = {
        bands: [0, 0, 0, 0, 0, 0, 0, 0],
        grSmooth: 0,
        peakSmooth: 0,
        reverbSmooth: 0,
        vuLeft: 0,
        vuRight: 0,
        vuVel: 0,
        faderSmooth: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
        ledPeaks: [0, 0, 0, 0, 0, 0],
      };
    }

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const { space: _space, tuck: _tuck, glue: _glue, color: _color, width: _width, peak: _peak, outPeak: _outPeak, gr: _gr, reverbLevel: _reverbLevel } = valRef.current;

      phaseRef.current += 0.005;
      var phase = phaseRef.current;
      var hist = bandHistoryRef.current;
      var peakVal = _peak || 0;

      // Color mode: Dark=blue, Warm=amber, Open=white
      var colorMode = _color < 0.35 ? 0 : (_color > 0.65 ? 2 : 1);
      // Accent colors per mode
      var accentR, accentG, accentB;
      var ledR, ledG, ledB;
      var backlightR, backlightG, backlightB;
      if (colorMode === 0) {
        // Dark = cool blue LEDs
        accentR = 40; accentG = 120; accentB = 255;
        ledR = 30; ledG = 140; ledB = 255;
        backlightR = 20; backlightG = 40; backlightB = 100;
      } else if (colorMode === 1) {
        // Warm = amber LEDs
        accentR = 255; accentG = 180; accentB = 40;
        ledR = 255; ledG = 160; ledB = 30;
        backlightR = 100; backlightG = 60; backlightB = 15;
      } else {
        // Open = white LEDs
        accentR = 220; accentG = 230; accentB = 255;
        ledR = 255; ledG = 255; ledB = 240;
        backlightR = 80; backlightG = 80; backlightB = 90;
      }

      // === Console background ===
      ctx.fillStyle = '#18191e';
      ctx.fillRect(0, 0, W, H);

      // Console panel gradient
      var bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#22242a');
      bgGrad.addColorStop(0.3, '#1c1e24');
      bgGrad.addColorStop(0.7, '#181a20');
      bgGrad.addColorStop(1, '#14161c');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Warm backlight glow from behind console
      var blGrad = ctx.createRadialGradient(W / 2, H + 30, 10, W / 2, H + 30, H * 0.9);
      blGrad.addColorStop(0, 'rgba(' + backlightR + ',' + backlightG + ',' + backlightB + ',0.15)');
      blGrad.addColorStop(0.5, 'rgba(' + backlightR + ',' + backlightG + ',' + backlightB + ',0.05)');
      blGrad.addColorStop(1, 'rgba(' + backlightR + ',' + backlightG + ',' + backlightB + ',0)');
      ctx.fillStyle = blGrad;
      ctx.fillRect(0, 0, W, H);

      // Screw holes in console surface
      var screwPositions = [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]];
      for (var sc = 0; sc < screwPositions.length; sc++) {
        ctx.beginPath();
        ctx.arc(screwPositions[sc][0], screwPositions[sc][1], 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10, 10, 14, 0.5)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(screwPositions[sc][0] - 0.5, screwPositions[sc][1] - 0.5, 1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(60, 62, 70, 0.3)';
        ctx.fill();
      }

      // Smooth values
      for (var bi = 0; bi < 8; bi++) {
        var baseLevel = _reverbLevel * (0.6 + Math.sin(phase * 2.5 + bi * 0.9) * 0.35);
        var bandBias = bi < 3 ? (1 - _color) * 0.35 : (bi > 4 ? _color * 0.35 : 0);
        var target = Math.min(1, baseLevel * (0.7 + bandBias + Math.sin(phase * 1.8 + bi * 1.3) * 0.2));
        hist.bands[bi] = hist.bands[bi] * 0.85 + target * 0.15;
      }
      hist.grSmooth = hist.grSmooth * 0.88 + _gr * 0.12;
      hist.peakSmooth = hist.peakSmooth * 0.88 + peakVal * 0.12;
      hist.reverbSmooth = hist.reverbSmooth * 0.82 + _reverbLevel * 0.18;

      // === 6 CHANNEL STRIPS (like a mixing console) ===
      var numChannels = 6;
      var stripW = 38;
      var stripGap = 6;
      var totalStripsW = numChannels * stripW + (numChannels - 1) * stripGap;
      var stripStartX = (W - totalStripsW) / 2;
      var stripTop = 10;
      var stripH = H - 20;
      var chanLabels = ['CH1', 'CH2', 'CH3', 'CH4', 'AUX', 'BUS'];

      // Simulate per-channel fader positions from tuck/glue
      for (var ci = 0; ci < numChannels; ci++) {
        var faderTarget = 0.3 + _reverbLevel * 0.4 + Math.sin(phase * 0.8 + ci * 1.1) * 0.1;
        faderTarget = Math.min(1, faderTarget * (1 - _tuck * 0.3 * (ci < 4 ? 1 : 0.5)));
        hist.faderSmooth[ci] = hist.faderSmooth[ci] * 0.92 + faderTarget * 0.08;
      }

      for (var ch = 0; ch < numChannels; ch++) {
        var sx = stripStartX + ch * (stripW + stripGap);
        var faderVal = hist.faderSmooth[ch];

        // Channel strip background panel
        var stripGrad = ctx.createLinearGradient(sx, stripTop, sx + stripW, stripTop);
        stripGrad.addColorStop(0, 'rgba(30, 32, 38, 0.9)');
        stripGrad.addColorStop(0.5, 'rgba(36, 38, 44, 0.85)');
        stripGrad.addColorStop(1, 'rgba(28, 30, 36, 0.9)');
        ctx.fillStyle = stripGrad;
        ctx.fillRect(sx, stripTop, stripW, stripH);

        // Channel border
        ctx.strokeStyle = 'rgba(60, 65, 75, 0.35)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx, stripTop, stripW, stripH);

        // Channel label at top
        ctx.font = 'bold 5.5px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',0.6)';
        ctx.fillText(chanLabels[ch], sx + stripW / 2, stripTop + 9);

        // === Console knobs (2 per channel, top area) ===
        var knobY1 = stripTop + 17;
        var knobY2 = stripTop + 30;
        var knobCx = sx + stripW / 2;

        for (var ki = 0; ki < 2; ki++) {
          var ky = ki === 0 ? knobY1 : knobY2;
          var knobR = 5;
          // Knob body
          var kGrad = ctx.createRadialGradient(knobCx - 1, ky - 1, 0, knobCx, ky, knobR);
          kGrad.addColorStop(0, 'rgba(70, 72, 80, 0.8)');
          kGrad.addColorStop(0.7, 'rgba(40, 42, 48, 0.9)');
          kGrad.addColorStop(1, 'rgba(25, 27, 32, 0.9)');
          ctx.beginPath();
          ctx.arc(knobCx, ky, knobR, 0, Math.PI * 2);
          ctx.fillStyle = kGrad;
          ctx.fill();
          // Knob edge
          ctx.strokeStyle = 'rgba(90, 95, 105, 0.3)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
          // Knob pointer
          var knobAngle = -2.35 + (ki === 0 ? _space : (ch < 3 ? _tuck : _glue)) * 4.7;
          ctx.beginPath();
          ctx.moveTo(knobCx, ky);
          ctx.lineTo(knobCx + Math.cos(knobAngle) * (knobR - 1), ky + Math.sin(knobAngle) * (knobR - 1));
          ctx.strokeStyle = 'rgba(' + ledR + ',' + ledG + ',' + ledB + ',0.7)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // === Button (solo/mute style) ===
        var btnY = stripTop + 40;
        var btnW = 10;
        var btnH2 = 5;
        var isActive = (ch === 0 || ch === numChannels - 1);
        ctx.fillStyle = isActive
          ? 'rgba(' + ledR + ',' + ledG + ',' + ledB + ',0.35)'
          : 'rgba(40, 42, 48, 0.6)';
        ctx.fillRect(knobCx - btnW / 2, btnY, btnW, btnH2);
        ctx.strokeStyle = 'rgba(80, 85, 95, 0.3)';
        ctx.lineWidth = 0.4;
        ctx.strokeRect(knobCx - btnW / 2, btnY, btnW, btnH2);
        // Button LED dot
        if (isActive) {
          ctx.beginPath();
          ctx.arc(knobCx, btnY + btnH2 / 2, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(' + ledR + ',' + ledG + ',' + ledB + ',0.9)';
          ctx.fill();
        }

        // === LED Level Meter (vertical, segmented) ===
        var meterX = sx + 4;
        var meterW = 6;
        var meterTop2 = stripTop + 50;
        var meterH = stripH - 70;
        var numLeds = 12;
        var ledH = (meterH - (numLeds - 1)) / numLeds;

        // Simulate per-channel level
        var chanLevel = hist.bands[ch % 8] * (0.7 + faderVal * 0.3);
        // Peak hold
        if (chanLevel > hist.ledPeaks[ch]) hist.ledPeaks[ch] = chanLevel;
        else hist.ledPeaks[ch] *= 0.985;

        // Meter background
        ctx.fillStyle = 'rgba(10, 12, 16, 0.6)';
        ctx.fillRect(meterX, meterTop2, meterW, meterH);

        // LED segments (bottom to top: green -> amber -> red)
        for (var led = 0; led < numLeds; led++) {
          var ledBottom = meterTop2 + meterH - (led + 1) * (ledH + 1);
          var ledNorm = led / (numLeds - 1); // 0=bottom, 1=top
          var isLit = chanLevel > ledNorm;
          var isPeak = Math.abs(hist.ledPeaks[ch] - ledNorm) < (1.0 / numLeds) * 1.5;

          var lr, lg, lb, la;
          if (ledNorm < 0.6) {
            lr = 30; lg = 200; lb = 80; // Green
          } else if (ledNorm < 0.85) {
            lr = 230; lg = 190; lb = 30; // Amber
          } else {
            lr = 240; lg = 50; lb = 40; // Red
          }

          if (isLit || isPeak) {
            la = isLit ? 0.85 : 0.6;
            ctx.fillStyle = 'rgba(' + lr + ',' + lg + ',' + lb + ',' + la.toFixed(2) + ')';
            // LED glow
            ctx.shadowColor = 'rgba(' + lr + ',' + lg + ',' + lb + ',0.4)';
            ctx.shadowBlur = 3;
          } else {
            ctx.fillStyle = 'rgba(' + lr + ',' + lg + ',' + lb + ',0.06)';
            ctx.shadowBlur = 0;
          }
          ctx.fillRect(meterX, ledBottom, meterW, ledH);
          ctx.shadowBlur = 0;
        }

        // === Fader Track + Fader Cap ===
        var faderX = sx + stripW - 14;
        var faderTrackW = 6;
        var faderTrackTop = meterTop2;
        var faderTrackH = meterH;

        // Fader track
        ctx.fillStyle = 'rgba(10, 12, 16, 0.5)';
        ctx.fillRect(faderX, faderTrackTop, faderTrackW, faderTrackH);
        // Track center line
        ctx.strokeStyle = 'rgba(60, 65, 75, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(faderX + faderTrackW / 2, faderTrackTop + 3);
        ctx.lineTo(faderX + faderTrackW / 2, faderTrackTop + faderTrackH - 3);
        ctx.stroke();

        // Fader position (tuck pushes faders down, glue compresses range)
        var faderY = faderTrackTop + faderTrackH * (1 - faderVal);
        var faderCapH = 8;

        // Fader cap shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(faderX - 1, faderY + 1, faderTrackW + 2, faderCapH);

        // Fader cap
        var capGrad = ctx.createLinearGradient(faderX, faderY, faderX, faderY + faderCapH);
        capGrad.addColorStop(0, 'rgba(120, 125, 140, 0.9)');
        capGrad.addColorStop(0.3, 'rgba(80, 85, 95, 0.85)');
        capGrad.addColorStop(0.7, 'rgba(60, 65, 75, 0.85)');
        capGrad.addColorStop(1, 'rgba(90, 95, 105, 0.9)');
        ctx.fillStyle = capGrad;
        ctx.fillRect(faderX - 1, faderY, faderTrackW + 2, faderCapH);

        // Fader cap groove
        ctx.strokeStyle = 'rgba(150, 155, 170, 0.25)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(faderX, faderY + faderCapH / 2);
        ctx.lineTo(faderX + faderTrackW, faderY + faderCapH / 2);
        ctx.stroke();

        // Channel number at bottom
        ctx.font = 'bold 5px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(100, 105, 115, 0.45)';
        ctx.fillText(String(ch + 1), sx + stripW / 2, stripTop + stripH - 4);

        // === GLUE bridges between channels ===
        if (ch < numChannels - 1 && _glue > 0.1) {
          var nextSx = stripStartX + (ch + 1) * (stripW + stripGap);
          var bridgeY = stripTop + 50 + meterH * 0.4;
          var bridgeAlpha = _glue * 0.5;
          var bridgeGrad = ctx.createLinearGradient(sx + stripW, bridgeY, nextSx, bridgeY);
          bridgeGrad.addColorStop(0, 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + bridgeAlpha.toFixed(3) + ')');
          bridgeGrad.addColorStop(0.5, 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + (bridgeAlpha * 1.3).toFixed(3) + ')');
          bridgeGrad.addColorStop(1, 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + bridgeAlpha.toFixed(3) + ')');
          ctx.strokeStyle = bridgeGrad;
          ctx.lineWidth = 1 + _glue * 2;
          ctx.beginPath();
          ctx.moveTo(sx + stripW, bridgeY);
          ctx.lineTo(nextSx, bridgeY);
          ctx.stroke();

          // Glue glow
          ctx.shadowColor = 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + (_glue * 0.3).toFixed(3) + ')';
          ctx.shadowBlur = 4 + _glue * 6;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Double bridge line at higher glue
          if (_glue > 0.5) {
            var bridgeY2b = bridgeY + 12;
            ctx.strokeStyle = 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + (bridgeAlpha * 0.6).toFixed(3) + ')';
            ctx.lineWidth = 0.8 + (_glue - 0.5) * 2;
            ctx.beginPath();
            ctx.moveTo(sx + stripW, bridgeY2b);
            ctx.lineTo(nextSx, bridgeY2b);
            ctx.stroke();
          }
        }
      }

      // === SPACE: reverb field fog between channels ===
      if (_space > 0.1) {
        var fogAlpha = _space * 0.08 + hist.reverbSmooth * _space * 0.1;
        for (var fi = 0; fi < 4; fi++) {
          var fogX = stripStartX + Math.sin(phase * 0.3 + fi * 1.5) * totalStripsW * 0.3 + totalStripsW * 0.5;
          var fogY = stripTop + stripH * 0.3 + Math.cos(phase * 0.25 + fi * 2) * stripH * 0.2;
          var fogR = 25 + _space * 50;
          var fogGrad = ctx.createRadialGradient(fogX, fogY, 0, fogX, fogY, fogR);
          fogGrad.addColorStop(0, 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + (fogAlpha * 0.6).toFixed(3) + ')');
          fogGrad.addColorStop(0.5, 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + (fogAlpha * 0.2).toFixed(3) + ')');
          fogGrad.addColorStop(1, 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',0)');
          ctx.fillStyle = fogGrad;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // === VU Meter (bottom center area) ===
      var vuCx = W / 2;
      var vuCy = H - 14;
      var vuRadius = 22;

      // VU background arc
      ctx.beginPath();
      ctx.arc(vuCx, vuCy + 6, vuRadius + 3, Math.PI, 0);
      ctx.fillStyle = 'rgba(15, 16, 20, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(80, 85, 95, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // VU scale markings
      var vuStart = Math.PI;
      var vuEnd = 0;
      for (var vm = 0; vm <= 10; vm++) {
        var vmAngle = vuStart + (vm / 10) * (vuEnd - vuStart);
        var vmInner = vuRadius - 3;
        var vmOuter = vuRadius + 1;
        ctx.beginPath();
        ctx.moveTo(vuCx + Math.cos(vmAngle) * vmInner, vuCy + 6 + Math.sin(vmAngle) * vmInner);
        ctx.lineTo(vuCx + Math.cos(vmAngle) * vmOuter, vuCy + 6 + Math.sin(vmAngle) * vmOuter);
        ctx.strokeStyle = vm >= 8 ? 'rgba(240, 60, 40, 0.5)' : 'rgba(140, 150, 165, 0.35)';
        ctx.lineWidth = vm % 5 === 0 ? 1 : 0.4;
        ctx.stroke();
      }

      // VU needle — driven by output level with physics
      var vuTarget = Math.min(1, hist.reverbSmooth * 1.2 + peakVal * 0.5);
      hist.vuVel += (vuTarget - hist.vuLeft) * 0.15;
      hist.vuVel *= 0.75; // damping
      hist.vuLeft += hist.vuVel;
      hist.vuLeft = Math.max(0, Math.min(1, hist.vuLeft));

      var needleAngle = vuStart + hist.vuLeft * (vuEnd - vuStart);
      // Needle shadow
      ctx.beginPath();
      ctx.moveTo(vuCx + 1, vuCy + 7);
      ctx.lineTo(vuCx + Math.cos(needleAngle) * (vuRadius - 2) + 1, vuCy + 6 + Math.sin(needleAngle) * (vuRadius - 2) + 1);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Needle
      ctx.beginPath();
      ctx.moveTo(vuCx, vuCy + 6);
      ctx.lineTo(vuCx + Math.cos(needleAngle) * (vuRadius - 2), vuCy + 6 + Math.sin(needleAngle) * (vuRadius - 2));
      ctx.strokeStyle = 'rgba(240, 200, 80, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Needle pivot
      ctx.beginPath();
      ctx.arc(vuCx, vuCy + 6, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 200, 210, 0.6)';
      ctx.fill();

      // VU label
      ctx.font = 'bold 4.5px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',0.4)';
      ctx.fillText('VU', vuCx, vuCy - 2);

      // === GR readout (compression) ===
      var grDb = hist.grSmooth > 0.001 ? (hist.grSmooth * 30).toFixed(1) : '0.0';
      ctx.font = 'bold 6px "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(' + accentR + ',' + accentG + ',' + accentB + ',' + (0.35 + hist.grSmooth * 2).toFixed(2) + ')';
      ctx.fillText('GR -' + grDb + 'dB', W - 14, H - 6);

      // Watermark
      ctx.save();
      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
      ctx.fillText('REVERB BUS', W / 2, H / 2);
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── Console Bypass Button ───────────────────────────────────────────────────
function ConsolBypass({ active, onClick }) {
  const size = 28;
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active' : 'Bypassed'}>
      <svg width={size} height={size} viewBox="0 0 28 28">
        <rect x="5" y="8" width="18" height="12" rx="1.5"
          fill={active ? 'rgba(40,180,80,0.12)' : 'rgba(50,52,58,0.1)'}
          stroke={active ? 'rgba(40,180,80,0.4)' : 'rgba(50,52,58,0.2)'}
          strokeWidth="1" />
        {/* LED */}
        <circle cx="14" cy="14" r="2.5"
          fill={active ? 'rgba(40,200,80,0.8)' : 'rgba(50,52,58,0.3)'}
        />
        {active && (
          <circle cx="14" cy="14" r="4" fill="none"
            stroke="rgba(40,200,80,0.2)" strokeWidth="1" />
        )}
        {/* Label line */}
        <line x1="8" y1="18" x2="20" y2="18"
          stroke={active ? 'rgba(40,180,80,0.25)' : 'rgba(50,52,58,0.1)'}
          strokeWidth="0.5" />
      </svg>
    </div>
  );
}

// ─── Console Knob ────────────────────────────────────────────────────────────
function ConsoleKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const sweepAngle = startAngle + norm * totalSweep;
  const x1 = cx + Math.cos(startAngle) * r, y1 = cy + Math.sin(startAngle) * r;
  const x2 = cx + Math.cos(sweepAngle) * r, y2 = cy + Math.sin(sweepAngle) * r;
  const large = norm * totalSweep > Math.PI ? 1 : 0;
  const dotX = cx + Math.cos(sweepAngle) * r;
  const dotY = cy + Math.sin(sweepAngle) * r;
  const ACCENT_HUE = 140;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,14,20,0.9)"
        stroke="rgba(120,140,180,0.08)" strokeWidth="1.5" />
      {norm > 0.005 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={`hsla(${ACCENT_HUE},65%,55%,0.7)`}
          strokeWidth="1.8" strokeLinecap="round" />
      )}
      <circle cx={dotX} cy={dotY} r="2.2"
        fill={`hsla(${ACCENT_HUE},80%,70%,0.9)`} />
      <circle cx={dotX} cy={dotY} r="4"
        fill={`hsla(${ACCENT_HUE},80%,70%,0.12)`} />
      <circle cx={cx} cy={cy} r="1.5" fill="rgba(160,180,220,0.2)" />
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
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue ?? (min + max) / 2)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <ConsoleKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 6.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(140,150,165,0.7)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 5.5, color: 'rgba(120,130,145,0.4)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
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
    const onUp = () => { setDragging(false); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      <div onPointerDown={onDown} onDoubleClick={() => onChange(defaultValue)} style={{ width: size, height: size, cursor: dragging ? 'grabbing' : 'grab' }}>
        <ConsoleKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(120,130,145,0.45)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
    </div>
  );
}

const PRESETS = [
  { name: 'INIT',               space: 0.35, tuck: 0.4, glue: 0.3, color: 0.5, width: 0.5, mix: 0.2, smooth: 0 },
  { name: 'DRUM BUS GLUE ROOM', space: 0.3, tuck: 0.55, glue: 0.6, color: 0.45, width: 0.4, mix: 0.2, smooth: 0 },
  { name: 'MIX BED SPACE',      space: 0.45, tuck: 0.3, glue: 0.25, color: 0.55, width: 0.6, mix: 0.15, smooth: 0 },
  { name: 'VOCAL BUS SUPPORT',  space: 0.4, tuck: 0.45, glue: 0.35, color: 0.5, width: 0.5, mix: 0.25, smooth: 0 },
  { name: 'STEM TUCK HALL',     space: 0.55, tuck: 0.65, glue: 0.4, color: 0.4, width: 0.55, mix: 0.2, smooth: 0 },
];

const PRESET_COLORS = {
  bg: '#1a1c20', text: '#8c96a5', textDim: 'rgba(140,150,165,0.5)',
  border: 'rgba(140,150,165,0.12)', hoverBg: 'rgba(140,150,165,0.08)', activeBg: 'rgba(140,150,165,0.05)',
};

export default function ReverbBusOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine, onRemove, onStateChange, initialState,
}) {
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const [inputGain,  setInputGain]  = useState(initialState?.inputGain  ?? 1);
  const [outputGain, setOutputGain] = useState(initialState?.outputGain ?? 1);
  const [space,  setSpace]  = useState(initialState?.space  ?? 0.35);
  const [tuck,   setTuck]   = useState(initialState?.tuck   ?? 0.4);
  const [glue,   setGlue]   = useState(initialState?.glue   ?? 0.3);
  const [color,  setColor]  = useState(initialState?.color  ?? 0.5);
  const [width,  setWidth]  = useState(initialState?.width  ?? 0.5);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 0.2);
  const [bypassed, setBypassed] = useState(initialState?.bypassed ?? false);
  const [smooth, setSmooth] = useState(initialState?.smooth ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);
  const [gr, setGr] = useState(0);
  const [reverbLevel, setReverbLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, space, tuck, glue, color, width, mix, bypassed, smooth };

  useEffect(() => {
    if (!sharedSource) return;
    setLoading(true);
    createReverbBusEngine(sharedSource.ctx).then(eng => {
      engineRef.current = eng;
      const s = stateRefs.current;
      eng.setInputGain(s.inputGain); eng.setOutputGain(s.outputGain);
      eng.setSpace(s.space); eng.setTuck(s.tuck); eng.setGlue(s.glue);
      eng.setColor(s.color); eng.setWidth(s.width); eng.setMix(s.mix);
      eng.setBypass(s.bypassed);
      eng.setSmooth(s.smooth);
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
        setPeak(engineRef.current.getInputPeak?.() ?? 0);
        setOutPeak(engineRef.current.getPeakOutput?.() ?? engineRef.current.getOutputPeak?.() ?? 0);
        setGr(engineRef.current.getGR?.() ?? 0);
        setReverbLevel(engineRef.current.getReverbLevel?.() ?? 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, space, tuck, glue, color, width, mix, bypassed, smooth, preset: activePreset });
  }, [inputGain, outputGain, space, tuck, glue, color, width, mix, bypassed, smooth, activePreset]);

  const loadPreset = useCallback((p) => {
    setSpace(p.space); setTuck(p.tuck); setGlue(p.glue);
    setColor(p.color); setWidth(p.width); setMix(p.mix);
    setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    const e = engineRef.current;
    if (e) { e.setSpace(p.space); e.setTuck(p.tuck); e.setGlue(p.glue); e.setColor(p.color); e.setWidth(p.width); e.setMix(p.mix); }
  }, []);

  const pctFmt = v => `${Math.round(v * 100)}%`;

  return (
    <div style={{
      width: 380, height: 500, borderRadius: 5, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(170deg, #222428 0%, #1e2024 30%, #1a1c20 60%, #16181c 100%)',
      border: '1.5px solid rgba(140,150,165,0.1)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 10px rgba(40,180,80,0.03), inset 0 1px 0 rgba(255,255,255,0.02)',
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif', userSelect: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(16,18,20,0.3) 100%)',
        borderRadius: 5,
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(140,150,165,0.06)', position: 'relative', zIndex: 10,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.01) 0%, transparent 100%)', flexShrink: 0,
      }}>
        <GainKnob label="IN" value={inputGain} onChange={v => { setInputGain(v); engineRef.current?.setInputGain(v); }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
            color: 'rgba(160, 170, 185, 0.85)',
            textShadow: '0 0 8px rgba(40,180,80,0.15)',
            fontFamily: '"Courier New", monospace',
          }}>REVERB BUS</span>
          <span style={{
            fontSize: 6, fontWeight: 400, color: 'rgba(140,150,165,0.3)',
            letterSpacing: '0.25em', marginTop: 1.5,
            fontFamily: '"Courier New", monospace',
          }}>stem glue reverb</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GainKnob label="OUT" value={outputGain} onChange={v => { setOutputGain(v); engineRef.current?.setOutputGain(v); }} />
        </div>
      </div>

      {/* Preset row */}
      <div style={{
        padding: '3px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(140,150,165,0.04)', position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <PresetSelector presets={PRESETS} activePreset={activePreset} onSelect={loadPreset} colors={PRESET_COLORS} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && <span style={{ fontSize: 6, color: 'rgba(140,150,165,0.4)' }}>...</span>}
          {onRemove && <span onClick={onRemove} style={{ fontSize: 11, cursor: 'pointer', color: 'rgba(255,120,120,0.6)', fontWeight: 700, lineHeight: 1, padding: '0 2px', borderRadius: 2, transition: 'all 0.12s' }} title="Remove" onMouseEnter={e => { e.currentTarget.style.color = '#ff4040'; e.currentTarget.style.background = 'rgba(255,60,60,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,120,120,0.6)'; e.currentTarget.style.background = 'transparent'; }}>x</span>}
        </div>
      </div>

      {/* Hero canvas */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0 }}>
        <BusMeterCanvas space={space} tuck={tuck} glue={glue} color={color} width={width} peak={peak} outPeak={outPeak} gr={gr} reverbLevel={reverbLevel} />
      </div>

      {/* Knob row */}
      <div style={{
        padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderTop: '1px solid rgba(140,150,165,0.04)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        <Knob label="SPACE" value={space} defaultValue={0.35} size={28} format={pctFmt}
          onChange={v => { setSpace(v); engineRef.current?.setSpace(v); setActivePreset(null); }} />
        <Knob label="TUCK" value={tuck} defaultValue={0.4} size={28} format={pctFmt}
          onChange={v => { setTuck(v); engineRef.current?.setTuck(v); setActivePreset(null); }} />
        <Knob label="GLUE" value={glue} defaultValue={0.3} size={28} format={pctFmt}
          onChange={v => { setGlue(v); engineRef.current?.setGlue(v); setActivePreset(null); }} />
        <Knob label="COLOR" value={color} defaultValue={0.5} size={28} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'OPEN' : 'WARM'}
          onChange={v => { setColor(v); engineRef.current?.setColor(v); setActivePreset(null); }} />
        <Knob label="WIDTH" value={width} defaultValue={0.5} size={28} format={pctFmt}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.2} size={28} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 18px 5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
          style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(40,180,80,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(80,220,120,0.95)' : 'rgba(100,130,110,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(40,180,80,0.45)' : 'rgba(60,90,70,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(40,180,80,0.25)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <ConsolBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
