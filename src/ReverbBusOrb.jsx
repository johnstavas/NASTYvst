import { useState, useEffect, useRef, useCallback } from 'react';
import { createReverbBusEngine } from './reverbBusEngine';
import PresetSelector from './PresetSelector';

// ─── REVERB BUS ENGINE: Bus-Friendly Reverb ──────────────────────────────────
// Visual: MIXING CONSOLE / BUS METER STYLE
// Stacked horizontal VU meters, glue compression indicator, tuck ceiling line
// Professional, utilitarian: dark charcoal, green/amber/red meter, blue bus indicators

// ─── Monster Truck School Bus Canvas ─────────────────────────────────────────
// Canvas is drawn at EXACTLY W×H matching the CSS display size to avoid oval circles.
// Header≈42 + Presets≈26 + Canvas + Modes≈27 + Knobs≈62 + Footer≈46 = ~203px non-canvas
// Plugin is 500px → canvas gets 500 - 203 = 297px
const BUS_W = 380, BUS_H = 297;

function BusMeterCanvas({ space, tuck, glue, color, width, peak = 0, outPeak = 0, gr = 0, reverbLevel = 0 }) {
  const canvasRef = useRef(null);
  const phaseRef  = useRef(0);
  const histRef   = useRef(null);
  const valRef    = useRef({ peak: 0, outPeak: 0, gr: 0, reverbLevel: 0 });

  valRef.current = { peak, outPeak, gr, reverbLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = BUS_W, H = BUS_H;
    // Draw at 2× for retina but CSS size stays W×H exactly — NO aspect distortion
    canvas.width  = W * 2;
    canvas.height = H * 2;
    ctx.scale(2, 2);

    if (!histRef.current) histRef.current = {
      winLevels: new Float32Array(6),
      wheelAngle: 0,
      sig: 0,      // combined signal level 0–1
      grSmooth: 0,
      lightning: 0,
      boltTimer: 0,
    };

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { peak: _pk, outPeak: _op, reverbLevel: _rv, gr: _gr } = valRef.current;
      phaseRef.current += 0.014;
      var ph  = phaseRef.current;
      var h   = histRef.current;

      // ── signal level: drive from BOTH input peak AND reverb level, fast attack
      var rawSig = Math.max(_pk, _op, _rv);
      if (rawSig > h.sig) h.sig = h.sig * 0.55 + rawSig * 0.45; // fast attack
      else                h.sig = h.sig * 0.88 + rawSig * 0.12; // slow decay
      h.grSmooth = h.grSmooth * 0.86 + (_gr || 0) * 0.14;
      h.wheelAngle += 0.028 + h.sig * 0.12;

      // ── per-window LED levels: oscillate independently, fully driven by signal
      for (var wi = 0; wi < 6; wi++) {
        var osc = 0.5 + Math.sin(ph * (1.3 + wi * 0.38) + wi * 1.1) * 0.5; // 0–1
        var target = h.sig * osc * (1.0 + wi * 0.06); // higher windows = slightly brighter
        target = Math.min(1, target);
        if (target > h.winLevels[wi]) h.winLevels[wi] = h.winLevels[wi] * 0.60 + target * 0.40;
        else                          h.winLevels[wi] = h.winLevels[wi] * 0.88 + target * 0.12;
      }

      // ── lightning bolt (random, more likely at high signal)
      h.boltTimer--;
      if (h.boltTimer <= 0) {
        h.lightning = (Math.random() < 0.008 + h.sig * 0.04) ? 1.0 : 0;
        h.boltTimer = Math.floor(8 + Math.random() * 40);
      } else {
        h.lightning *= 0.72;
      }

      var bounce = Math.sin(ph * 4.8) * h.sig * 2.5;

      function rr(x, y, w, hh, r) {
        ctx.beginPath();
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
        ctx.arcTo(x+w,y, x+w,y+r, r); ctx.lineTo(x+w,hh+y-r);
        ctx.arcTo(x+w,y+hh, x+w-r,y+hh, r); ctx.lineTo(x+r,y+hh);
        ctx.arcTo(x,y+hh, x,y+hh-r, r); ctx.lineTo(x,y+r);
        ctx.arcTo(x,y, x+r,y, r); ctx.closePath();
      }

      // ════════════════════════════════════════════════════════════════
      // LAYOUT CONSTANTS — all derived so nothing stretches
      var roadY = H - 18;           // road surface
      var wR    = 42;               // monster truck tire radius — chunky but fits the frame
      var wCy   = roadY - wR;       // axle center
      var lift  = 22;               // suspension clearance above tire tops (lifted)
      var bBot  = wCy - wR - lift;  // bottom of bus body
      var bY    = 16 + bounce;      // top of bus body
      var bL    = 10;               // bus left edge
      var hoodW = 55;               // hood sticks out right
      var bR    = W - 10 - hoodW;   // bus body right edge
      var bW    = bR - bL;          // body width
      var bH    = bBot - bY;        // body height
      var midY  = bY + bH * 0.60;   // belt-line stripe top
      var rWx   = bL + 72;          // rear axle x
      var fWx   = bR - 58;          // front axle x
      var hR    = W - 10;           // hood right edge
      var hTop  = bY + bH * 0.28;   // hood top junction

      // ── STORMY SKY ──────────────────────────────────────────────────
      var skyG = ctx.createLinearGradient(0,0,0,H*0.72);
      skyG.addColorStop(0, '#1a1e2e');
      skyG.addColorStop(0.4,'#2a3045');
      skyG.addColorStop(1, '#3d4a5c');
      ctx.fillStyle = skyG; ctx.fillRect(0,0,W,H);

      // Lightning flash overlay
      if (h.lightning > 0.05) {
        ctx.fillStyle = 'rgba(200,220,255,' + (h.lightning * 0.18) + ')';
        ctx.fillRect(0,0,W,H);
        // Bolt
        var bltX = 60 + (ph * 77 % (W - 120));
        ctx.strokeStyle = 'rgba(200,230,255,' + (h.lightning * 0.9) + ')';
        ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(bltX, 0); ctx.lineTo(bltX+8, 18); ctx.lineTo(bltX+3, 18);
        ctx.lineTo(bltX+12, 38); ctx.stroke();
      }

      // ── STORM CLOUDS ────────────────────────────────────────────────
      var cOff = (ph * 4) % (W + 120);
      var cDefs = [{x:40,y:18,s:0.9},{x:160,y:10,s:0.7},{x:270,y:20,s:1.0},{x:380,y:12,s:0.75},{x:480,y:22,s:0.85}];
      for (var ci=0;ci<cDefs.length;ci++){
        var cfx=((cDefs[ci].x - cOff + W+120)%(W+120))-50, cfy=cDefs[ci].y, cs=cDefs[ci].s;
        // dark shadow base
        var csp=[cfx+cs*8,cfx+cs*20,cfx+cs*33];
        for(var si=0;si<3;si++){ctx.fillStyle='rgba(30,35,55,0.55)';ctx.beginPath();ctx.arc(csp[si],cfy+cs*9,cs*11,0,Math.PI*2);ctx.fill();}
        // main cloud puffs (dark grey)
        var pf=[[cfx,cfy,cs*8,0.65],[cfx+cs*8,cfy-cs*5,cs*10,0.72],[cfx+cs*19,cfy-cs*8,cs*12,0.78],
                [cfx+cs*30,cfy-cs*6,cs*10,0.72],[cfx+cs*40,cfy,cs*8,0.65],[cfx+cs*13,cfy,cs*11,0.80],[cfx+cs*26,cfy,cs*10,0.76]];
        for(var pi=0;pi<pf.length;pi++){
          ctx.fillStyle='rgba(75,85,110,'+pf[pi][3]+')';
          ctx.beginPath();ctx.arc(pf[pi][0],pf[pi][1],pf[pi][2],0,Math.PI*2);ctx.fill();
        }
      }

      // ── DISTANT CITY SILHOUETTE ──────────────────────────────────────
      ctx.fillStyle='rgba(20,25,40,0.6)';
      var skyline=[{x:20,w:12,h:38},{x:40,w:18,h:52},{x:64,w:10,h:30},{x:78,w:22,h:62},{x:106,w:14,h:44},
                   {x:250,w:20,h:55},{x:276,w:12,h:38},{x:295,w:25,h:70},{x:326,w:16,h:42},{x:348,w:10,h:35}];
      for(var sk=0;sk<skyline.length;sk++){
        ctx.fillRect(skyline[sk].x, H*0.62-skyline[sk].h, skyline[sk].w, skyline[sk].h+10);
      }

      // ── ROAD ─────────────────────────────────────────────────────────
      var roadG = ctx.createLinearGradient(0,roadY,0,H);
      roadG.addColorStop(0,'#383840'); roadG.addColorStop(1,'#252528');
      ctx.fillStyle=roadG; ctx.fillRect(0,roadY,W,H-roadY);
      // road edge highlight
      ctx.fillStyle='rgba(255,220,0,0.35)'; ctx.fillRect(0,roadY,W,2);
      // dashed center line
      ctx.setLineDash([22,15]); ctx.lineDashOffset=-(ph*22%37);
      ctx.strokeStyle='rgba(255,240,100,0.45)'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(0,roadY+(H-roadY)*0.5); ctx.lineTo(W,roadY+(H-roadY)*0.5); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset=0;

      // ── BUS SHADOW ───────────────────────────────────────────────────
      ctx.fillStyle='rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(bL+bW*0.44, roadY+5, bW*0.44, 6, 0, 0, Math.PI*2); ctx.fill();

      // ── SUSPENSION STRUTS ────────────────────────────────────────────
      var strutW=8, strutH=bBot+bounce-wCy+wR; // strut from body bottom to above axle
      [[rWx,0],[fWx,0]].forEach(function(s){
        var sx=s[0];
        // coil spring (zigzag)
        ctx.strokeStyle='rgba(180,180,200,0.7)'; ctx.lineWidth=2;
        ctx.beginPath();
        var sy0=bBot+bounce, sy1=wCy-wR+14;
        var nCoils=5, coilH=(sy1-sy0)/nCoils;
        ctx.moveTo(sx,sy0);
        for(var ci2=0;ci2<nCoils;ci2++){
          ctx.lineTo(sx+(ci2%2===0?strutW:-strutW), sy0+coilH*(ci2+0.5));
          ctx.lineTo(sx, sy0+coilH*(ci2+1));
        }
        ctx.stroke();
        // strut body
        ctx.fillStyle='rgba(100,100,120,0.55)'; ctx.fillRect(sx-3,sy0,6,sy1-sy0);
      });

      // ── EXHAUST PIPES (vertical chrome stacks) ────────────────────────
      var exX = bL + 8;
      ctx.fillStyle='rgba(160,160,180,0.7)'; ctx.fillRect(exX-3,bY+4+bounce,6,bH*0.45);
      ctx.fillStyle='rgba(200,200,220,0.5)'; ctx.fillRect(exX-3,bY+4+bounce,6,2); // chrome top rim
      // smoke puffs from exhaust
      if (h.sig > 0.05) {
        for(var sm=0;sm<3;sm++){
          var smA=h.sig*(0.15-sm*0.04);
          var smY=bY+4+bounce-(sm*12+ph*8%10);
          ctx.fillStyle='rgba(80,80,90,'+smA+')';
          ctx.beginPath(); ctx.arc(exX,smY,4+sm*2,0,Math.PI*2); ctx.fill();
        }
      }

      // ── YELLOW BUS BODY ───────────────────────────────────────────────
      ctx.fillStyle='#FFD800';
      rr(bL, bY, bW, bH, 4); ctx.fill();
      // body shading gradient
      var bShG=ctx.createLinearGradient(bL,bY,bL,bY+bH);
      bShG.addColorStop(0,'rgba(255,255,200,0.22)'); bShG.addColorStop(0.15,'rgba(255,255,120,0.05)');
      bShG.addColorStop(0.7,'rgba(0,0,0,0.06)');     bShG.addColorStop(1,'rgba(0,0,0,0.22)');
      ctx.fillStyle=bShG; rr(bL,bY,bW,bH,4); ctx.fill();

      // ── HOOD / NOSE ───────────────────────────────────────────────────
      ctx.fillStyle='#FFD800';
      ctx.beginPath();
      ctx.moveTo(bR,bY); ctx.lineTo(hR-5,hTop); ctx.lineTo(hR,hTop+6);
      ctx.lineTo(hR,bBot+bounce); ctx.lineTo(bR,bBot+bounce); ctx.closePath(); ctx.fill();
      var hShG=ctx.createLinearGradient(bR,0,hR,0);
      hShG.addColorStop(0,'rgba(0,0,0,0)'); hShG.addColorStop(1,'rgba(0,0,0,0.18)');
      ctx.fillStyle=hShG;
      ctx.beginPath();
      ctx.moveTo(bR,bY); ctx.lineTo(hR-5,hTop); ctx.lineTo(hR,hTop+6);
      ctx.lineTo(hR,bBot+bounce); ctx.lineTo(bR,bBot+bounce); ctx.closePath(); ctx.fill();

      // ── ROOF RACK ─────────────────────────────────────────────────────
      ctx.fillStyle='#c8a800'; ctx.fillRect(bL+4, bY-8+bounce, bW-6, 8);
      ctx.fillStyle='rgba(255,255,180,0.22)'; ctx.fillRect(bL+4,bY-8+bounce,bW-6,1.5);
      // roof rack spikes (punk)
      ctx.fillStyle='#888';
      for(var ri=0;ri<8;ri++){
        var rx=bL+20+ri*32;
        ctx.beginPath(); ctx.moveTo(rx-3,bY-8+bounce); ctx.lineTo(rx,bY-16+bounce); ctx.lineTo(rx+3,bY-8+bounce); ctx.closePath(); ctx.fill();
      }

      // ── BELT-LINE BLACK STRIPE ────────────────────────────────────────
      ctx.fillStyle='#141414'; ctx.fillRect(bL, midY, bW, bBot+bounce-midY);
      ctx.beginPath(); ctx.moveTo(bR,midY); ctx.lineTo(hR,midY+(hTop-bY)*0.9+bounce*0.5);
      ctx.lineTo(hR,bBot+bounce); ctx.lineTo(bR,bBot+bounce); ctx.closePath(); ctx.fill();
      // REVERB BUS stencil text in stripe
      ctx.save(); ctx.font='bold 7px "Arial Narrow","Arial",sans-serif'; ctx.textAlign='center';
      ctx.fillStyle='rgba(255,216,0,0.7)'; ctx.letterSpacing='2px';
      ctx.fillText('REVERB  BUS', bL+bW*0.46, midY+(bBot+bounce-midY)*0.55+2); ctx.restore();

      // ── CHROME REAR BUMPER ────────────────────────────────────────────
      var chromeG=ctx.createLinearGradient(0,bBot+bounce,0,bBot+bounce+7);
      chromeG.addColorStop(0,'rgba(200,200,215,0.9)'); chromeG.addColorStop(0.5,'rgba(255,255,255,0.95)'); chromeG.addColorStop(1,'rgba(140,140,160,0.8)');
      ctx.fillStyle=chromeG; ctx.fillRect(bL-3, bBot+bounce, bW+6, 7);

      // ── WINDOWS + LED METERS ──────────────────────────────────────────
      var nW=6, winT=bY+8, winH2=midY-bY-13;
      var winW2=(bW-24-(nW-1)*5)/nW, winSX=bL+12;
      for(var w=0;w<nW;w++){
        var wx2=winSX+w*(winW2+5), wLvl=h.winLevels[w];
        // black bezel
        ctx.fillStyle='#0a0a0a'; rr(wx2-2,winT-2,winW2+4,winH2+4,3); ctx.fill();
        // window tint
        var wGrd=ctx.createLinearGradient(wx2,winT,wx2,winT+winH2);
        wGrd.addColorStop(0,'rgba(15,22,38,0.97)'); wGrd.addColorStop(1,'rgba(8,14,26,0.99)');
        ctx.fillStyle=wGrd; rr(wx2,winT,winW2,winH2,2); ctx.fill();
        // LED bars (5 vertical bars per window)
        var nB=5, barW=(winW2-7)/nB-1, barH=winH2-7;
        for(var b=0;b<nB;b++){
          var bN=b/(nB-1);
          var bx3=wx2+3.5+b*(barW+1), bTop3=winT+3.5;
          // dim track
          var tr,tg,tb;
          if(bN<0.55){tr=20;tg=140;tb=50;}else if(bN<0.82){tr=180;tg=150;tb=0;}else{tr=160;tg=25;tb=25;}
          ctx.fillStyle='rgba('+tr+','+tg+','+tb+',0.09)'; ctx.fillRect(bx3,bTop3,barW,barH);
          // lit portion — threshold per bar so low bars light first
          var thresh=bN*0.65; // bar N only lights when level > thresh
          if(wLvl>thresh){
            var fillFrac=Math.min(1,(wLvl-thresh)/(1-thresh+0.001));
            var fillH2=Math.max(2,barH*fillFrac);
            var bTopLit=bTop3+(barH-fillH2);
            var lr,lg,lb;
            if(bN<0.55){lr=30;lg=230;lb=90;}else if(bN<0.82){lr=255;lg=200;lb=0;}else{lr=255;lg=40;lb=30;}
            ctx.fillStyle='rgba('+lr+','+lg+','+lb+',0.92)';
            ctx.shadowColor='rgba('+lr+','+lg+','+lb+',0.55)'; ctx.shadowBlur=4;
            ctx.fillRect(bx3,bTopLit,barW,fillH2);
            ctx.shadowBlur=0;
          }
        }
        // window glare
        ctx.fillStyle='rgba(255,255,255,0.04)'; rr(wx2+1.5,winT+1.5,winW2*0.38,winH2*0.32,1.5); ctx.fill();
      }

      // ── BODY OUTLINE ─────────────────────────────────────────────────
      ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.2; rr(bL,bY,bW,bH,4); ctx.stroke();

      // ── TAIL LIGHTS ──────────────────────────────────────────────────
      var tlA=0.25+h.sig*0.75;
      ctx.fillStyle='rgba(220,30,30,'+tlA+')';
      ctx.shadowColor='rgba(255,50,50,'+(tlA*0.6)+')'; ctx.shadowBlur=4+h.sig*10;
      ctx.fillRect(bL-2, bY+bH*0.35+bounce, 6, 16); ctx.shadowBlur=0;
      ctx.fillStyle='rgba(255,130,0,'+(tlA*0.6)+')'; ctx.fillRect(bL-2,bY+bH*0.35+bounce+18,6,9);

      // ── HEADLIGHT + BEAM ─────────────────────────────────────────────
      var hlX=hR-2, hlY=hTop+10+bounce;
      ctx.fillStyle='rgba(255,252,220,'+(0.5+h.sig*0.5)+')';
      ctx.shadowColor='rgba(255,250,200,'+(h.sig*0.8+0.15)+')'; ctx.shadowBlur=5+h.sig*14;
      ctx.fillRect(hlX-12,hlY-6,12,12); ctx.shadowBlur=0;
      if(h.sig>0.03){
        var blmG=ctx.createRadialGradient(hlX,hlY,2,hlX+48,hlY,80);
        blmG.addColorStop(0,'rgba(255,252,200,'+(h.sig*0.12)+')');
        blmG.addColorStop(1,'rgba(255,252,200,0)');
        ctx.fillStyle=blmG;
        ctx.beginPath(); ctx.moveTo(hlX,hlY-7); ctx.lineTo(hlX+88,hlY-28); ctx.lineTo(hlX+88,hlY+28); ctx.lineTo(hlX,hlY+7); ctx.closePath(); ctx.fill();
      }

      // ── WHEEL WELLS ──────────────────────────────────────────────────
      [[rWx],[fWx]].forEach(function(ww){
        ctx.fillStyle='#0c0c0e';
        ctx.beginPath(); ctx.arc(ww[0],wCy,wR+10,Math.PI,0); ctx.closePath(); ctx.fill();
      });

      // ── MONSTER TRUCK WHEELS (true circles in W×H pixel space) ───────
      [[rWx,1],[fWx,1.018]].forEach(function(ww){
        var cx2=ww[0], spd=ww[1], wAng=h.wheelAngle*spd;

        // drop shadow
        ctx.fillStyle='rgba(0,0,0,0.30)';
        ctx.beginPath(); ctx.ellipse(cx2+3,roadY+5,wR*0.82,5,0,0,Math.PI*2); ctx.fill();

        // KNOBBY TIRE outer ring
        var tireR=wR, innerR=wR*0.72;
        ctx.fillStyle='#111114';
        ctx.beginPath(); ctx.arc(cx2,wCy,tireR,0,Math.PI*2); ctx.fill();
        // knob lugs (8 around the tire)
        ctx.fillStyle='#1e1e22';
        for(var kn=0;kn<10;kn++){
          var ka=wAng+(kn/10)*Math.PI*2;
          var kx=cx2+Math.cos(ka)*(tireR-4), ky=wCy+Math.sin(ka)*(tireR-4);
          ctx.save(); ctx.translate(kx,ky); ctx.rotate(ka+Math.PI/2);
          ctx.beginPath(); ctx.roundRect(-3,-5,6,10,1); ctx.fill();
          ctx.restore();
        }
        // tire sidewall (outer ring)
        ctx.strokeStyle='rgba(40,40,50,0.7)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(cx2,wCy,tireR-2,0,Math.PI*2); ctx.stroke();

        // RIM — chrome multi-ring
        var rimR=innerR;
        var rimG=ctx.createRadialGradient(cx2-rimR*0.3,wCy-rimR*0.3,rimR*0.1,cx2,wCy,rimR);
        rimG.addColorStop(0,'rgba(240,240,255,0.97)'); rimG.addColorStop(0.35,'rgba(180,180,200,0.92)');
        rimG.addColorStop(0.7,'rgba(110,110,135,0.9)'); rimG.addColorStop(1,'rgba(60,60,80,0.85)');
        ctx.fillStyle=rimG; ctx.beginPath(); ctx.arc(cx2,wCy,rimR,0,Math.PI*2); ctx.fill();

        // 6 chrome spokes
        ctx.strokeStyle='rgba(200,200,220,0.85)'; ctx.lineWidth=3;
        for(var sp=0;sp<6;sp++){
          var sa=wAng+(sp/6)*Math.PI*2;
          ctx.beginPath();
          ctx.moveTo(cx2+Math.cos(sa)*4,   wCy+Math.sin(sa)*4);
          ctx.lineTo(cx2+Math.cos(sa)*(rimR-3),wCy+Math.sin(sa)*(rimR-3));
          ctx.stroke();
        }
        // spoke shadow
        ctx.strokeStyle='rgba(60,60,80,0.4)'; ctx.lineWidth=1;
        for(var sp2=0;sp2<6;sp2++){
          var sa2=wAng+(sp2/6)*Math.PI*2+0.08;
          ctx.beginPath();
          ctx.moveTo(cx2+Math.cos(sa2)*4,    wCy+Math.sin(sa2)*4);
          ctx.lineTo(cx2+Math.cos(sa2)*(rimR-3),wCy+Math.sin(sa2)*(rimR-3));
          ctx.stroke();
        }

        // lug nuts ring
        ctx.fillStyle='rgba(60,65,80,0.88)';
        for(var ln=0;ln<6;ln++){
          var la=wAng+(ln/6)*Math.PI*2;
          ctx.beginPath(); ctx.arc(cx2+Math.cos(la)*(rimR*0.62),wCy+Math.sin(la)*(rimR*0.62),2.2,0,Math.PI*2); ctx.fill();
        }

        // center cap
        var ccG=ctx.createRadialGradient(cx2-2,wCy-2,0,cx2,wCy,7);
        ccG.addColorStop(0,'rgba(255,255,255,1)'); ccG.addColorStop(1,'rgba(160,160,185,0.9)');
        ctx.fillStyle=ccG; ctx.beginPath(); ctx.arc(cx2,wCy,7,0,Math.PI*2); ctx.fill();
        // center Y emblem
        ctx.fillStyle='rgba(255,216,0,0.9)'; ctx.font='bold 6px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('Y',cx2,wCy+0.5); ctx.textBaseline='alphabetic';
      });

      // ── GR READOUT ───────────────────────────────────────────────────
      var grDb=h.grSmooth>0.005?(h.grSmooth*30).toFixed(1):'0.0';
      ctx.font='bold 6px "Courier New",monospace'; ctx.textAlign='right';
      ctx.fillStyle='rgba(255,216,0,'+(0.22+Math.min(1,h.grSmooth*4)).toFixed(2)+')';
      ctx.fillText('GR -'+grDb+'dB', W-6, H-5);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: BUS_W+'px', height: BUS_H+'px', display: 'block' }} />;
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

// MODE labels and indices
const MODES = ['ROOM', 'PLATE', 'HALL', 'AMBIENT', 'DIRTY'];

const PRESETS = [
  { name: 'VOCAL PLATE',     space: 0.38, tuck: 0.50, glue: 0.25, color: 0.55, width: 0.60, mix: 0.28, smooth: 0, mode: 1 },
  { name: 'DRUM ROOM',       space: 0.30, tuck: 0.60, glue: 0.65, color: 0.40, width: 0.35, mix: 0.18, smooth: 0, mode: 0 },
  { name: 'SNARE BLOOM',     space: 0.42, tuck: 0.45, glue: 0.45, color: 0.50, width: 0.55, mix: 0.30, smooth: 0, mode: 0 },
  { name: 'GUITAR CLOUD',    space: 0.58, tuck: 0.30, glue: 0.20, color: 0.62, width: 0.72, mix: 0.35, smooth: 3, mode: 3 },
  { name: 'WIDE HALL',       space: 0.70, tuck: 0.35, glue: 0.15, color: 0.45, width: 0.85, mix: 0.22, smooth: 3, mode: 2 },
  { name: 'AMBIENT WASH',    space: 0.85, tuck: 0.20, glue: 0.10, color: 0.70, width: 0.90, mix: 0.40, smooth: 5, mode: 3 },
  { name: 'DIRTY CHAMBER',   space: 0.45, tuck: 0.55, glue: 0.50, color: 0.80, width: 0.45, mix: 0.32, smooth: 0, mode: 4 },
  { name: 'MIX BUS GLUE',    space: 0.28, tuck: 0.65, glue: 0.75, color: 0.38, width: 0.40, mix: 0.15, smooth: 0, mode: 0 },
  { name: 'BACKSEAT VOCAL',  space: 0.50, tuck: 0.42, glue: 0.30, color: 0.58, width: 0.65, mix: 0.25, smooth: 3, mode: 1 },
  { name: 'CINEMATIC TAIL',  space: 0.92, tuck: 0.25, glue: 0.08, color: 0.60, width: 0.95, mix: 0.38, smooth: 5, mode: 2 },
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
  const [mode, setMode] = useState(initialState?.mode ?? 0);
  const [activePreset, setActivePreset] = useState(initialState?.preset ?? null);
  const [peak, setPeak] = useState(0);
  const [outPeak, setOutPeak] = useState(0);
  const [gr, setGr] = useState(0);
  const [reverbLevel, setReverbLevel] = useState(0);

  const stateRefs = useRef({});
  stateRefs.current = { inputGain, outputGain, space, tuck, glue, color, width, mix, bypassed, smooth, mode };

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
      eng.setMode?.(s.mode);
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
    if (onStateChange) onStateChange(instanceId, { inputGain, outputGain, space, tuck, glue, color, width, mix, bypassed, smooth, mode, preset: activePreset });
  }, [inputGain, outputGain, space, tuck, glue, color, width, mix, bypassed, smooth, mode, activePreset]);

  const loadPreset = useCallback((p) => {
    setSpace(p.space); setTuck(p.tuck); setGlue(p.glue);
    setColor(p.color); setWidth(p.width); setMix(p.mix);
    setActivePreset(p.name);
    if (p.smooth !== undefined) { setSmooth(p.smooth); engineRef.current?.setSmooth(p.smooth); }
    if (p.mode !== undefined) { setMode(p.mode); engineRef.current?.setMode?.(p.mode); }
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

      {/* Hero canvas — fixed pixel size matching drawn W×H so circles stay round */}
      <div style={{ position: 'relative', zIndex: 2, height: BUS_H, flexShrink: 0, overflow: 'hidden' }}>
        <BusMeterCanvas space={space} tuck={tuck} glue={glue} color={color} width={width} peak={peak} outPeak={outPeak} gr={gr} reverbLevel={reverbLevel} />
      </div>

      {/* MODE selector */}
      <div style={{
        padding: '5px 14px 4px', display: 'flex', justifyContent: 'center', gap: 5,
        borderTop: '1px solid rgba(140,150,165,0.04)', position: 'relative', zIndex: 2, flexShrink: 0,
      }}>
        {MODES.map((m, i) => {
          const active = mode === i;
          return (
            <button key={m} onClick={() => { setMode(i); engineRef.current?.setMode?.(i); setActivePreset(null); }}
              style={{
                fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 7px',
                borderRadius: 3, cursor: 'pointer', border: 'none', outline: 'none',
                background: active ? 'rgba(255,216,0,0.22)' : 'rgba(255,255,255,0.03)',
                color: active ? '#FFD800' : 'rgba(180,145,20,0.45)',
                boxShadow: active ? '0 0 7px rgba(255,216,0,0.35), inset 0 0 4px rgba(255,216,0,0.08)' : 'none',
                border: active ? '1px solid rgba(255,216,0,0.4)' : '1px solid rgba(100,80,20,0.18)',
                transition: 'all 0.13s',
                fontFamily: '"Courier New", monospace',
              }}>{m}</button>
          );
        })}
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
