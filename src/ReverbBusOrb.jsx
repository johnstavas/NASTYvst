import { useState, useEffect, useRef, useCallback } from 'react';
import { createReverbBusEngine } from './reverbBusEngine';
import PresetSelector from './PresetSelector';

// ─── REVERB BUS ENGINE: Bus-Friendly Reverb ──────────────────────────────────
// Visual: MIXING CONSOLE / BUS METER STYLE
// Stacked horizontal VU meters, glue compression indicator, tuck ceiling line
// Professional, utilitarian: dark charcoal, green/amber/red meter, blue bus indicators

// ─── School Bus Canvas ───────────────────────────────────────────────────────
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

    // School bus history
    if (!bandHistoryRef.current) {
      bandHistoryRef.current = {
        winLevels: [0,0,0,0,0,0],
        wheelAngle: 0,
        reverbSmooth: 0,
        peakSmooth: 0,
        grSmooth: 0,
      };
    }

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { peak: _peak, reverbLevel: _rv, gr: _gr } = valRef.current;
      phaseRef.current += 0.013;
      var ph = phaseRef.current;
      var hist = bandHistoryRef.current;

      hist.reverbSmooth = hist.reverbSmooth * 0.87 + (_rv || 0) * 0.13;
      hist.peakSmooth   = hist.peakSmooth   * 0.82 + (_peak || 0) * 0.18;
      hist.grSmooth     = hist.grSmooth     * 0.88 + (_gr || 0) * 0.12;
      hist.wheelAngle  += 0.025 + hist.reverbSmooth * 0.08;
      for (var wi = 0; wi < 6; wi++) {
        var wTarget = hist.reverbSmooth * (0.3 + Math.sin(ph * (1.1 + wi * 0.4) + wi * 1.2) * 0.5);
        hist.winLevels[wi] = hist.winLevels[wi] * 0.84 + Math.max(0, Math.min(1, wTarget)) * 0.16;
      }
      var bounce = Math.sin(ph * 4.5) * hist.reverbSmooth * 1.5;

      function rr(x, y, w, h, r) {
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
        ctx.arcTo(x+w,y, x+w,y+r, r); ctx.lineTo(x+w,y+h-r);
        ctx.arcTo(x+w,y+h, x+w-r,y+h, r); ctx.lineTo(x+r,y+h);
        ctx.arcTo(x,y+h, x,y+h-r, r); ctx.lineTo(x,y+r);
        ctx.arcTo(x,y, x+r,y, r); ctx.closePath();
      }

      // SKY
      var skyG = ctx.createLinearGradient(0,0,0,H);
      skyG.addColorStop(0,'#5b8fbf'); skyG.addColorStop(0.5,'#87b8d8'); skyG.addColorStop(1,'#a8cce0');
      ctx.fillStyle=skyG; ctx.fillRect(0,0,W,H);

      // CLOUDS (drifting slowly left)
      var cloudOffX = (ph * 4) % (W + 80);
      var clouds = [
        {x: 60,  y: 22, s: 1.0},
        {x: 180, y: 14, s: 0.75},
        {x: 290, y: 25, s: 1.1},
        {x: 420, y: 18, s: 0.85},
      ];
      for (var ci2=0; ci2<clouds.length; ci2++) {
        var cx2 = ((clouds[ci2].x - cloudOffX + W + 80) % (W + 80)) - 30;
        var cy2 = clouds[ci2].y, cs = clouds[ci2].s;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.beginPath(); ctx.arc(cx2,      cy2,    10*cs, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx2+14*cs,cy2+2,  13*cs, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx2+28*cs,cy2,    10*cs, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx2+14*cs,cy2-6,  9*cs,  0, Math.PI*2); ctx.fill();
        // Cloud base fill
        ctx.fillRect(cx2-1, cy2, 30*cs, 8*cs);
      }

      // BIRDS (V-shape seagulls, drifting right)
      var birdOffX = (ph * 6) % (W + 60);
      var birdGroups = [{x:100,y:38},{x:240,y:28},{x:330,y:42}];
      ctx.strokeStyle = 'rgba(30,30,60,0.55)';
      ctx.lineWidth = 1;
      for (var bi2=0; bi2<birdGroups.length; bi2++) {
        var bx = (birdGroups[bi2].x + birdOffX) % (W + 60) - 20;
        var by = birdGroups[bi2].y;
        var bFlap = Math.sin(ph * 4 + bi2) * 2.5; // wing flap
        // Left wing
        ctx.beginPath(); ctx.moveTo(bx,by); ctx.quadraticCurveTo(bx-6,by-bFlap,bx-10,by+1); ctx.stroke();
        // Right wing
        ctx.beginPath(); ctx.moveTo(bx,by); ctx.quadraticCurveTo(bx+6,by-bFlap,bx+10,by+1); ctx.stroke();
        // 2 more smaller birds nearby
        ctx.beginPath(); ctx.moveTo(bx+18,by+5); ctx.quadraticCurveTo(bx+13,by+5-bFlap*0.7,bx+9,by+6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx+18,by+5); ctx.quadraticCurveTo(bx+23,by+5-bFlap*0.7,bx+27,by+6); ctx.stroke();
      }

      // Treeline
      ctx.fillStyle='rgba(40,70,45,0.35)';
      for (var ti=0;ti<6;ti++){var tx=25+ti*62,th=20+Math.sin(ti*1.9)*8;ctx.beginPath();ctx.moveTo(tx,H*0.52);ctx.lineTo(tx-10,H*0.52+th);ctx.lineTo(tx+10,H*0.52+th);ctx.closePath();ctx.fill();}

      // ROAD
      var roadY = H - 28;
      var roadG = ctx.createLinearGradient(0,roadY,0,H);
      roadG.addColorStop(0,'#4e4e52'); roadG.addColorStop(1,'#3a3a3e');
      ctx.fillStyle=roadG; ctx.fillRect(0,roadY,W,H-roadY);
      ctx.fillStyle='rgba(255,255,200,0.22)'; ctx.fillRect(0,roadY,W,1.5);
      ctx.setLineDash([20,14]); ctx.lineDashOffset=-(ph*20%34);
      ctx.strokeStyle='rgba(255,255,180,0.5)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(0,roadY+(H-roadY)*0.55); ctx.lineTo(W,roadY+(H-roadY)*0.55); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset=0;
      ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1;
      for(var pl=0;pl<5;pl++){ctx.beginPath();ctx.moveTo(50+pl*62,roadY+4);ctx.lineTo(50+pl*62,H-2);ctx.stroke();}

      // BUS LAYOUT
      var bY=22+bounce, bL=8, bR=310, bW=bR-bL, bH=roadY-bY;
      var midY=bY+bH*0.6;
      var wR2=22, rWx=bL+60, fWx=bR-48, wCy=roadY-wR2;

      // Shadow
      ctx.fillStyle='rgba(0,0,0,0.16)';
      ctx.beginPath(); ctx.ellipse(W*0.41,roadY+5,bW*0.46,6,0,0,Math.PI*2); ctx.fill();

      // YELLOW BODY
      ctx.fillStyle='#FFD800';
      ctx.beginPath(); rr(bL,bY,bW,bH,3); ctx.fill();
      var bShG=ctx.createLinearGradient(bL,bY,bL,bY+bH);
      bShG.addColorStop(0,'rgba(255,255,180,0.18)'); bShG.addColorStop(0.18,'rgba(255,255,120,0.04)');
      bShG.addColorStop(0.75,'rgba(0,0,0,0.05)'); bShG.addColorStop(1,'rgba(0,0,0,0.18)');
      ctx.fillStyle=bShG; ctx.beginPath(); rr(bL,bY,bW,bH,3); ctx.fill();

      // HOOD
      var hL=bR,hR=W-6,hTop=bY+bH*0.27;
      ctx.fillStyle='#FFD800';
      ctx.beginPath(); ctx.moveTo(hL,bY); ctx.lineTo(hR-4,hTop); ctx.lineTo(hR,hTop+5); ctx.lineTo(hR,bY+bH); ctx.lineTo(hL,bY+bH); ctx.closePath(); ctx.fill();
      var hShG=ctx.createLinearGradient(hL,0,hR,0); hShG.addColorStop(0,'rgba(0,0,0,0)'); hShG.addColorStop(1,'rgba(0,0,0,0.13)');
      ctx.fillStyle=hShG;
      ctx.beginPath(); ctx.moveTo(hL,bY); ctx.lineTo(hR-4,hTop); ctx.lineTo(hR,hTop+5); ctx.lineTo(hR,bY+bH); ctx.lineTo(hL,bY+bH); ctx.closePath(); ctx.fill();

      // ROOF
      ctx.fillStyle='#e8c200'; ctx.fillRect(bL+3,bY-7,bW-5,7);
      ctx.fillStyle='rgba(255,255,200,0.18)'; ctx.fillRect(bL+3,bY-7,bW-5,1.5);

      // BLACK STRIPE
      ctx.fillStyle='#181818'; ctx.fillRect(bL,midY,bW,bH-(midY-bY)-1);
      ctx.beginPath(); ctx.moveTo(bR,midY); ctx.lineTo(hR,midY+(hTop-bY)*0.85); ctx.lineTo(hR,bY+bH); ctx.lineTo(bR,bY+bH); ctx.closePath(); ctx.fill();

      // REVERB BUS TEXT
      ctx.save(); ctx.font='bold 8px "Arial Narrow","Arial",sans-serif'; ctx.textAlign='center';
      ctx.fillStyle='rgba(255,216,0,0.88)';
      ctx.fillText('REVERB  BUS', bL+bW*0.46, midY+(bH-(midY-bY))*0.48+2); ctx.restore();

      // 6 WINDOWS
      var winT=bY+7, winH2=(midY-bY)-11, nW=6;
      var winW2=(bW-22-(nW-1)*5)/nW, winSX=bL+11;
      for(var w=0;w<nW;w++){
        var wx2=winSX+w*(winW2+5), wLvl=hist.winLevels[w];
        ctx.fillStyle='#111'; ctx.beginPath(); rr(wx2-1.5,winT-1.5,winW2+3,winH2+3,2); ctx.fill();
        var wGrd=ctx.createLinearGradient(wx2,winT,wx2,winT+winH2);
        wGrd.addColorStop(0,'rgba(30,45,60,0.96)'); wGrd.addColorStop(0.5,'rgba(22,35,50,0.96)'); wGrd.addColorStop(1,'rgba(18,28,40,0.98)');
        ctx.fillStyle=wGrd; ctx.beginPath(); rr(wx2,winT,winW2,winH2,1.5); ctx.fill();
        var nB=5, bW3=(winW2-6)/nB-1;
        for(var b=0;b<nB;b++){
          var bN=b/(nB-1), bx3=wx2+3+b*(bW3+1), fullBH=winH2-6;
          var fillH2=Math.max(1,fullBH*Math.min(1,wLvl*(1.6-bN*0.5)));
          var bTop3=winT+3+(fullBH-fillH2);
          var br2,bg2,bb2;
          if(bN<0.6){br2=30;bg2=200;bb2=80;}else if(bN<0.85){br2=255;bg2=216;bb2=0;}else{br2=240;bg2=50;bb2=40;}
          ctx.fillStyle='rgba('+br2+','+bg2+','+bb2+',0.07)'; ctx.fillRect(bx3,winT+3,bW3,fullBH);
          if(wLvl>bN*0.4){ctx.fillStyle='rgba('+br2+','+bg2+','+bb2+',0.88)';ctx.shadowColor='rgba('+br2+','+bg2+','+bb2+',0.3)';ctx.shadowBlur=2;ctx.fillRect(bx3,bTop3,bW3,fillH2);ctx.shadowBlur=0;}
        }
        ctx.fillStyle='rgba(255,255,255,0.05)'; ctx.beginPath(); rr(wx2+1,winT+1,winW2*0.4,winH2*0.28,1); ctx.fill();
      }

      // BODY OUTLINE
      ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1; ctx.beginPath(); rr(bL,bY,bW,bH,3); ctx.stroke();


      // HEADLIGHT
      var hlX=hR-3,hlY=hTop+9+bounce;
      ctx.fillStyle='rgba(255,252,220,'+(0.6+hist.reverbSmooth*0.4)+')';
      ctx.shadowColor='rgba(255,250,200,'+(hist.reverbSmooth*0.7+0.2)+')'; ctx.shadowBlur=4+hist.reverbSmooth*12;
      ctx.fillRect(hlX-11,hlY-5,11,10); ctx.shadowBlur=0;
      if(hist.reverbSmooth>0.04){
        var blmA=hist.reverbSmooth*0.1;
        var blmG=ctx.createRadialGradient(hlX,hlY,2,hlX+40,hlY,65);
        blmG.addColorStop(0,'rgba(255,252,200,'+blmA+')'); blmG.addColorStop(1,'rgba(255,252,200,0)');
        ctx.fillStyle=blmG; ctx.beginPath(); ctx.moveTo(hlX,hlY-5); ctx.lineTo(hlX+75,hlY-22); ctx.lineTo(hlX+75,hlY+22); ctx.lineTo(hlX,hlY+5); ctx.closePath(); ctx.fill();
      }

      // TAIL LIGHTS
      var tlA=0.3+hist.reverbSmooth*0.65;
      ctx.fillStyle='rgba(200,30,30,'+tlA+')'; ctx.shadowColor='rgba(255,40,40,'+(tlA*0.5)+')'; ctx.shadowBlur=3+hist.reverbSmooth*7;
      ctx.fillRect(bL,bY+bH*0.4+bounce,5,14); ctx.shadowBlur=0;
      ctx.fillStyle='rgba(255,140,0,'+(tlA*0.55)+')'; ctx.fillRect(bL,bY+bH*0.4+bounce+16,5,8);

      // WHEEL WELLS
      for(var ww=0;ww<2;ww++){
        var cwX2=ww===0?rWx:fWx;
        ctx.fillStyle='#141414'; ctx.beginPath(); ctx.arc(cwX2,roadY,wR2+6,Math.PI,0); ctx.closePath(); ctx.fill();
      }

      // WHEELS
      for(var ww2=0;ww2<2;ww2++){
        var cwX3=ww2===0?rWx:fWx, wAng=hist.wheelAngle*(ww2===0?1:1.015);
        ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(cwX3+2,roadY+4,wR2*0.88,4,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#1c1c1c'; ctx.beginPath(); ctx.arc(cwX3,wCy,wR2,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(45,45,45,0.6)'; ctx.lineWidth=2.5; ctx.beginPath(); ctx.arc(cwX3,wCy,wR2-3,0,Math.PI*2); ctx.stroke();
        var hR3=wR2*0.46, hcG=ctx.createRadialGradient(cwX3-2,wCy-2,0,cwX3,wCy,hR3);
        hcG.addColorStop(0,'rgba(225,225,232,0.95)'); hcG.addColorStop(0.5,'rgba(162,162,175,0.88)'); hcG.addColorStop(1,'rgba(100,100,115,0.85)');
        ctx.fillStyle=hcG; ctx.beginPath(); ctx.arc(cwX3,wCy,hR3,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(70,70,88,0.75)'; ctx.lineWidth=1.2;
        for(var sp=0;sp<5;sp++){var sa2=wAng+(sp/5)*Math.PI*2;ctx.beginPath();ctx.moveTo(cwX3+Math.cos(sa2)*2.5,wCy+Math.sin(sa2)*2.5);ctx.lineTo(cwX3+Math.cos(sa2)*(hR3-1),wCy+Math.sin(sa2)*(hR3-1));ctx.stroke();}
        var cG2=ctx.createRadialGradient(cwX3-1,wCy-1,0,cwX3,wCy,3);
        cG2.addColorStop(0,'rgba(240,240,250,1)'); cG2.addColorStop(1,'rgba(175,175,192,0.9)');
        ctx.fillStyle=cG2; ctx.beginPath(); ctx.arc(cwX3,wCy,3,0,Math.PI*2); ctx.fill();
      }

      // GR READOUT
      var grDb2=hist.grSmooth>0.005?(hist.grSmooth*30).toFixed(1):'0.0';
      ctx.font='bold 5.5px "Courier New",monospace'; ctx.textAlign='right';
      ctx.fillStyle='rgba(255,216,0,'+(0.28+hist.grSmooth*3).toFixed(2)+')';
      ctx.fillText('GR -'+grDb2+'dB',W-6,H-5);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ─── Stop Sign Bypass Button ─────────────────────────────────────────────────
function ConsolBypass({ active, onClick }) {
  const size = 32;
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  // Octagon points
  const pts = Array.from({length: 8}, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  }).join(' ');
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: size, height: size }} title={active ? 'Active — click to bypass' : 'Bypassed — click to activate'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Octagon body */}
        <polygon points={pts}
          fill={active ? 'rgba(210,25,25,0.88)' : 'rgba(80,30,30,0.35)'}
          stroke={active ? 'rgba(255,255,255,0.7)' : 'rgba(120,60,60,0.3)'}
          strokeWidth="1.2" />
        {/* Glow ring when active */}
        {active && <polygon points={pts} fill="none"
          stroke="rgba(255,60,60,0.25)" strokeWidth="3" />}
        {/* STOP text */}
        <text x={cx} y={cy + 2.5} textAnchor="middle"
          fontSize="6.5" fontWeight="800" fontFamily="Arial,sans-serif"
          fill={active ? 'white' : 'rgba(180,100,100,0.5)'} letterSpacing="0.5">
          {active ? 'ACTIVE' : 'BYPSS'}
        </text>
      </svg>
    </div>
  );
}

// ─── Bus Knob (yellow dome, black notch — school bus dashboard style) ─────────
function BusKnob({ size = 26, norm = 0 }) {
  const cx = size / 2, cy = size / 2;
  const trackR = size / 2 - 1.8;   // arc track sits near edge
  const knobR  = size / 2 - 4;     // yellow dome body
  const startAngle = Math.PI * 0.75;
  const totalSweep = Math.PI * 1.5;
  const angle = startAngle + norm * totalSweep;
  const large = norm * totalSweep > Math.PI ? 1 : 0;

  // Track arc (full, dark)
  const tX1 = cx + Math.cos(startAngle) * trackR, tY1 = cy + Math.sin(startAngle) * trackR;
  const tX2 = cx + Math.cos(startAngle + totalSweep) * trackR, tY2 = cy + Math.sin(startAngle + totalSweep) * trackR;
  // Fill arc end
  const fX2 = cx + Math.cos(angle) * trackR, fY2 = cy + Math.sin(angle) * trackR;
  // Indicator notch on dome face
  const iX1 = cx + Math.cos(angle) * (knobR * 0.28), iY1 = cy + Math.sin(angle) * (knobR * 0.28);
  const iX2 = cx + Math.cos(angle) * (knobR * 0.84), iY2 = cy + Math.sin(angle) * (knobR * 0.84);
  const gId = `bkg${Math.round(size)}`;
  return (
    <svg width={size} height={size} style={{ display: 'block', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={gId} cx="38%" cy="32%" r="65%">
          <stop offset="0%"   stopColor="#fff5b0" />
          <stop offset="42%"  stopColor="#FFD800" />
          <stop offset="100%" stopColor="#b08a00" />
        </radialGradient>
      </defs>
      {/* Dark track */}
      <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 1 1 ${tX2} ${tY2}`}
        fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Yellow fill arc */}
      {norm > 0.005 && (
        <path d={`M ${tX1} ${tY1} A ${trackR} ${trackR} 0 ${large} 1 ${fX2} ${fY2}`}
          fill="none" stroke="#FFD800" strokeWidth="2.5" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 2px rgba(255,216,0,0.7))' }} />
      )}
      {/* Yellow dome body */}
      <circle cx={cx} cy={cy} r={knobR} fill={`url(#${gId})`}
        stroke="rgba(140,100,0,0.35)" strokeWidth="0.8" />
      {/* Black indicator notch */}
      <line x1={iX1} y1={iY1} x2={iX2} y2={iY2}
        stroke="rgba(0,0,0,0.75)" strokeWidth="2.2" strokeLinecap="round" />
      {/* Center indent */}
      <circle cx={cx} cy={cy} r="2.2" fill="rgba(0,0,0,0.28)" />
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
        <BusKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(220,185,30,0.75)', fontWeight: 700, textAlign: 'center', width: '100%', lineHeight: 1, fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }}>{label}</span>
      <span style={{ fontSize: 7, color: 'rgba(200,165,20,0.45)', fontFamily: '"Courier New",monospace', fontWeight: 700, textAlign: 'center', width: '100%' }}>{display}</span>
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
        <BusKnob size={size} norm={norm} />
      </div>
      <span style={{ fontSize: 5, letterSpacing: '0.1em', color: 'rgba(200,165,20,0.5)', fontWeight: 700, fontFamily: 'system-ui, -apple-system, Arial, sans-serif', marginTop: -1 }}>{label}</span>
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
  bg: '#1a1c20', text: '#d4aa18', textDim: 'rgba(212,170,24,0.5)',
  border: 'rgba(212,170,24,0.15)', hoverBg: 'rgba(212,170,24,0.08)', activeBg: 'rgba(212,170,24,0.05)',
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
      border: '1.5px solid rgba(212,170,24,0.18)',
      boxShadow: '0 6px 40px rgba(0,0,0,0.9), 0 0 14px rgba(220,180,0,0.06), inset 0 1px 0 rgba(255,220,0,0.03)',
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
            background: 'linear-gradient(135deg, #FFD800 0%, #e8c200 35%, #FFE040 65%, #d4ae00 100%)',
            backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 7px rgba(255,216,0,0.45))',
            fontFamily: '"Courier New", monospace',
          }}>REVERB BUS</span>
          <span style={{
            fontSize: 6, fontWeight: 400, color: 'rgba(200,165,20,0.3)',
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
        <Knob label="SPACE" value={space} defaultValue={0.35} size={32} format={pctFmt}
          onChange={v => { setSpace(v); engineRef.current?.setSpace(v); setActivePreset(null); }} />
        <Knob label="TUCK" value={tuck} defaultValue={0.4} size={32} format={pctFmt}
          onChange={v => { setTuck(v); engineRef.current?.setTuck(v); setActivePreset(null); }} />
        <Knob label="GLUE" value={glue} defaultValue={0.3} size={32} format={pctFmt}
          onChange={v => { setGlue(v); engineRef.current?.setGlue(v); setActivePreset(null); }} />
        <Knob label="COLOR" value={color} defaultValue={0.5} size={32} format={v => v < 0.35 ? 'DARK' : v > 0.65 ? 'OPEN' : 'WARM'}
          onChange={v => { setColor(v); engineRef.current?.setColor(v); setActivePreset(null); }} />
        <Knob label="WIDTH" value={width} defaultValue={0.5} size={32} format={pctFmt}
          onChange={v => { setWidth(v); engineRef.current?.setWidth(v); setActivePreset(null); }} />
        <Knob label="MIX" value={mix} defaultValue={0.2} size={32} format={pctFmt}
          onChange={v => { setMix(v); engineRef.current?.setMix(v); setActivePreset(null); }} />
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 18px 5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <button onClick={() => { const n = smooth === 0 ? 3 : smooth === 3 ? 5 : 0; setSmooth(n); engineRef.current?.setSmooth(n); }}
          style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
            background: smooth > 0 ? 'rgba(220,175,0,0.18)' : 'transparent',
            color: smooth > 0 ? 'rgba(255,215,30,0.95)' : 'rgba(160,130,30,0.4)',
            border: `1px solid ${smooth > 0 ? 'rgba(220,175,0,0.45)' : 'rgba(100,80,20,0.2)'}`,
            boxShadow: smooth > 0 ? '0 0 8px rgba(220,175,0,0.3)' : 'none',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif', transition: 'all 0.15s',
          }}>{smooth > 0 ? `SMOOTH ${smooth}x` : 'SMOOTH'}</button>
        <ConsolBypass active={!bypassed} onClick={() => { const n = !bypassed; setBypassed(n); engineRef.current?.setBypass(n); }} />
      </div>
    </div>
  );
}
