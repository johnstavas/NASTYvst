// Standalone mount for NastyBeast Phase 1.

import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import NastyBeastOrb from './nastybeast/NastyBeastOrb.jsx';

function Shell() {
  const [shared, setShared] = useState(null);
  const engineRef = useRef(null);
  const srcRef    = useRef(null);
  const bufRef    = useRef(null);
  const padRef    = useRef(null);     // GainNode: source → pad → engine.input
  const [padDb, setPadDb] = useState(-10); // 0 | -5 | -10 (default -10)
  const [status, setStatus] = useState('load a file or PLAY for built-in loop · hold SPACE for BEAST');

  const ensureCtx = async () => {
    if (shared) { if (shared.ctx.state === 'suspended') await shared.ctx.resume(); return shared; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const s = { ctx };
    setShared(s);
    return s;
  };

  const registerEngine = (_id, eng) => {
    engineRef.current = eng;
    const ctx = eng.output.context;
    // Build the input pad once and route source → pad → engine.input
    if (!padRef.current) {
      const pad = ctx.createGain();
      pad.gain.value = Math.pow(10, padDb / 20);
      pad.connect(eng.input);
      padRef.current = pad;
    }
    try { eng.output.connect(shared?.ctx?.destination || ctx.destination); } catch {}
  };
  const unregisterEngine = () => {
    try { engineRef.current?.output?.disconnect(); } catch {}
    try { padRef.current?.disconnect(); } catch {}
    padRef.current = null;
    engineRef.current = null;
  };

  // Apply pad dB whenever selection changes
  React.useEffect(() => {
    const pad = padRef.current; if (!pad) return;
    const t = pad.context.currentTime;
    pad.gain.cancelScheduledValues(t);
    pad.gain.setValueAtTime(pad.gain.value, t);
    pad.gain.linearRampToValueAtTime(Math.pow(10, padDb / 20), t + 0.01);
  }, [padDb]);

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
      // built-in loop: kick at 1 Hz + sustained chord pad — exercises boom AND sustain
      const dur = 4.0, sr = s.ctx.sampleRate;
      const buf = s.ctx.createBuffer(2, sr * dur, sr);
      const chord = [220, 277, 330, 415]; // A minor 7
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const beatT = t % 1.0;
          const kick  = beatT < 0.18 ? Math.sin(2*Math.PI*55*beatT) * Math.exp(-beatT*10) * 0.85 : 0;
          let pad = 0;
          for (const f of chord) pad += Math.sin(2*Math.PI*f*t) * 0.05;
          pad *= 0.6 + 0.4 * Math.sin(2*Math.PI*0.25*t);
          d[i] = kick + pad;
        }
      }
      bufRef.current = buf;
    }
    try { srcRef.current?.stop(); } catch {}
    const src = s.ctx.createBufferSource();
    src.buffer = bufRef.current; src.loop = true;
    // Route through pad if available, else direct.
    src.connect(padRef.current || engineRef.current.input);
    src.start();
    srcRef.current = src;
    setStatus('PLAYING — try BEAST · switch SCENE · push macros');
  };

  const stop = () => {
    try { srcRef.current?.stop(); } catch {}
    srcRef.current = null;
    setStatus('stopped — push FEED+SNARL with no audio to confirm rage is parameter-driven');
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#040608', padding: 28,
      color: '#eaeaea', fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="audio/*" onChange={loadFile}
          style={{ background: '#111', color: '#ddd', border: '1px solid #333', padding: '6px 10px', borderRadius: 6 }} />
        <button onClick={play} style={btn}>▶ PLAY</button>
        <button onClick={stop} style={btn}>■ STOP</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid #333', borderRadius: 6, overflow: 'hidden' }}>
          <span style={{ padding: '6px 8px', fontSize: 9, letterSpacing: '0.2em', color: '#888', background: '#0c0c0c' }}>PAD</span>
          {[0, -5, -10].map(db => (
            <button key={db} onClick={() => setPadDb(db)}
              style={{
                padding: '6px 10px', background: padDb === db ? 'rgba(168,200,58,0.18)' : 'transparent',
                color: padDb === db ? '#a8c83a' : '#aaa',
                border: 'none', borderLeft: '1px solid #333',
                fontFamily: 'inherit', fontSize: 10, cursor: 'pointer',
              }}>{db === 0 ? '0' : db}</button>
          ))}
        </div>
        <span style={{ fontSize: 10, letterSpacing: '0.18em', color: '#a8c83a' }}>{status}</span>
      </div>

      <NastyBeastOrb
        instanceId="nastybeast-solo"
        sharedSource={shared}
        registerEngine={registerEngine}
        unregisterEngine={unregisterEngine}
      />
    </div>
  );
}

const btn = {
  background: '#111', color: '#ff6a2e', border: '1px solid #5a2238',
  padding: '6px 14px', borderRadius: 6, fontFamily: 'inherit',
  letterSpacing: '0.2em', fontSize: 11, cursor: 'pointer',
};

createRoot(document.getElementById('root')).render(<Shell />);
