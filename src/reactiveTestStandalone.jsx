// Standalone mount for the reactive-core validation rig. Mirrors
// pantherStandalone.jsx so it runs without touching main.jsx.

import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactiveTestOrb from './reactive/ReactiveTestOrb.jsx';

function Shell() {
  const [shared, setShared] = useState(null);
  const engineRef = useRef(null);
  const srcRef    = useRef(null);
  const bufRef    = useRef(null);
  const [status, setStatus] = useState('click PLAY or load a file');

  const ensureCtx = async () => {
    if (shared) { if (shared.ctx.state === 'suspended') await shared.ctx.resume(); return shared; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const s = { ctx };
    setShared(s);
    return s;
  };

  const registerEngine = (_id, eng) => {
    engineRef.current = eng;
    try { eng.output.connect(shared?.ctx?.destination || eng.output.context.destination); } catch {}
  };
  const unregisterEngine = () => {
    try { engineRef.current?.output?.disconnect(); } catch {}
    engineRef.current = null;
  };

  const loadFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const s = await ensureCtx();
    const ab = await f.arrayBuffer();
    bufRef.current = await s.ctx.decodeAudioData(ab);
    setStatus(`loaded: ${f.name} — click PLAY`);
  };

  const play = async () => {
    const s = await ensureCtx();
    if (!engineRef.current) { setStatus('engine not ready'); return; }
    if (!bufRef.current) {
      // Built-in test loop: kick at 1 Hz + a steady ride to exercise boom + transient
      const dur = 2.0, sr = s.ctx.sampleRate;
      const buf = s.ctx.createBuffer(2, sr * dur, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const beatT = t % 1.0;
          const kick  = beatT < 0.18 ? Math.sin(2*Math.PI*60*beatT) * Math.exp(-beatT*12) * 0.9 : 0;
          const ride  = (Math.random()*2 - 1) * 0.06;
          d[i] = kick + ride;
        }
      }
      bufRef.current = buf;
    }
    try { srcRef.current?.stop(); } catch {}
    const src = s.ctx.createBufferSource();
    src.buffer = bufRef.current; src.loop = true;
    src.connect(engineRef.current.input);
    src.start();
    srcRef.current = src;
    setStatus('PLAYING — try the DRIVE knob with audio off too');
  };

  const stop = () => {
    try { srcRef.current?.stop(); } catch {}
    srcRef.current = null;
    setStatus('stopped — pulse should still breathe');
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#050507', padding: 28,
      color: '#eaeaea', fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="audio/*" onChange={loadFile}
          style={{ background: '#111', color: '#ddd', border: '1px solid #333', padding: '6px 10px', borderRadius: 6 }} />
        <button onClick={play} style={btn}>▶ PLAY</button>
        <button onClick={stop} style={btn}>■ STOP</button>
        <span style={{ fontSize: 10, letterSpacing: '0.2em', color: '#8df' }}>{status}</span>
      </div>

      <ReactiveTestOrb
        instanceId="reactive-test"
        sharedSource={shared}
        registerEngine={registerEngine}
        unregisterEngine={unregisterEngine}
      />

      <div style={{ fontSize: 10, color: '#556', letterSpacing: '0.15em', textAlign: 'center', maxWidth: 480 }}>
        no file? PLAY uses a kick + ride loop. STOP and watch pulse keep breathing.
        Push DRIVE with no audio playing to confirm rage is parameter-driven only.
      </div>
    </div>
  );
}

const btn = {
  background: '#111', color: '#7fdfff', border: '1px solid #234555',
  padding: '6px 14px', borderRadius: 6, fontFamily: 'inherit',
  letterSpacing: '0.2em', fontSize: 11, cursor: 'pointer',
};

createRoot(document.getElementById('root')).render(<Shell />);
