// Standalone mount for the restored Panther Buss UI.
// Renders <PantherBussOrb /> with a minimal host shell:
//   - AudioContext created on first user gesture (play button)
//   - file picker + loop playback into the engine
//   - registerEngine wires the engine output to ctx.destination

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PantherBussOrb from './PantherBussOrb.jsx';

function Shell() {
  const [shared, setShared] = useState(null);   // { ctx }
  const engineRef = useRef(null);
  const srcRef    = useRef(null);
  const bufRef    = useRef(null);
  const [status, setStatus] = useState('click PLAY or load a file to start audio');

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
    if (!engineRef.current) { setStatus('engine not ready yet'); return; }
    if (!bufRef.current) {
      // Fallback: noise-burst loop so the panther reacts without a file.
      const dur = 2.0;
      const sr  = s.ctx.sampleRate;
      const buf = s.ctx.createBuffer(2, sr * dur, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          // pink-ish drum-ish pulse every ~500ms
          const t = i / sr;
          const beat = (t % 0.5) < 0.05 ? 1 : 0;
          d[i] = (Math.random() * 2 - 1) * 0.4 * beat + Math.sin(2 * Math.PI * 80 * t) * 0.3 * beat;
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
    setStatus('PLAYING — push DRIVE / CRUNCH / BOOM');
  };

  const stop = () => {
    try { srcRef.current?.stop(); } catch {}
    srcRef.current = null;
    setStatus('stopped');
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#050a06',
      padding: 28, color: '#eaeaea', fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="audio/*" onChange={loadFile}
          style={{ background: '#111', color: '#ddd', border: '1px solid #333', padding: '6px 10px', borderRadius: 6 }} />
        <button onClick={play} style={btn}>▶ PLAY</button>
        <button onClick={stop} style={btn}>■ STOP</button>
        <span style={{ fontSize: 10, letterSpacing: '0.2em', color: '#8f8' }}>{status}</span>
      </div>

      <PantherBussOrb
        instanceId="panther-solo"
        sharedSource={shared}
        registerEngine={registerEngine}
        unregisterEngine={unregisterEngine}
      />

      <div style={{ fontSize: 10, color: '#556', letterSpacing: '0.15em' }}>
        no file? click PLAY for the built-in pulse loop
      </div>
    </div>
  );
}

const btn = {
  background: '#111', color: '#9fff8f', border: '1px solid #2a4a30',
  padding: '6px 14px', borderRadius: 6, fontFamily: 'inherit',
  letterSpacing: '0.2em', fontSize: 11, cursor: 'pointer',
};

createRoot(document.getElementById('root')).render(<Shell />);
