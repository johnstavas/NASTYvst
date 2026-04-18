import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Reshaped } from 'reshaped';
import 'reshaped/themes/slate/theme.css';
import './index.css';
import OrbPluginDemo from './OrbPluginDemo';
import DistortionOrb from './DistortionOrb';
import AmpOrb from './AmpOrb';
import ModulationOrb from './ModulationOrb';
import VocalOrb from './VocalOrb';
import MixBusOrb from './MixBusOrb';
import SimpleReverbOrb from './SimpleReverbOrb';
import ScopeOrb from './ScopeOrb';
import NeveOrb from './NeveOrb';
import Iron1073Orb from './Iron1073Orb';
import NastyNeveOrb from './NastyNeveOrb';
import TapeOrb from './TapeOrb';
import SpringReverbOrb from './SpringReverbOrb';
import SpringPhysicsOrb from './SpringPhysicsOrb';
import TapeDelayOrb from './TapeDelayOrb';
import FlapJackManOrb from './nastybeast/NastyBeastOrb.jsx';
import AnalogGlueOrb from './AnalogGlueOrb';
import LA2AOrb from './LA2AOrb';
import ShagatronOrb from './ShagatronOrb';
import PitchShifterOrb from './PitchShifterOrb';
import FlangerOrb from './FlangerOrb';
import PhaserOrb from './PhaserOrb';
import GluesmashOrb from './GluesmashOrb';
import BassmindOrb from './BassmindOrb';
import EchoformOrb from './EchoformOrb';
import DriftOrb from './DriftOrb';
import AmplessOrb from './AmplessOrb';
import FinisherOrb from './FinisherOrb';
import ReactorOrb from './ReactorOrb';
import SplitdriveOrb from './SplitdriveOrb';
import SmootherOrb from './SmootherOrb';
import PlayboxOrb from './PlayboxOrb';
import VocalLockOrb from './VocalLockOrb';
import DeHarshOrb from './DeHarshOrb';
import VibeMicOrb from './VibeMicOrb';
import PhraseRiderOrb from './PhraseRiderOrb';
import AirliftOrb from './AirliftOrb';
import CharacterOrb from './CharacterOrb';
import GravityOrb from './GravityOrb';
import FocusReverbOrb from './FocusReverbOrb';
import NearFarOrb from './NearFarOrb';
import MorphReverbOrb from './MorphReverbOrb';
import TransientReverbOrb from './TransientReverbOrb';
import SmearOrb from './SmearOrb';
import OrbitOrb from './OrbitOrb';
import PlateXOrb from './PlateXOrb';
import ReverbBusOrb from './ReverbBusOrb';
import DrumBusOrb from './DrumBusOrb';
import PantherBussOrb from './PantherBussOrb';
import { createSharedSource } from './audioEngine';
import { REGISTRY, getProduct, getProductByLegacyType, getVariant } from './migration/registry.js';
import { useQcMode, useProductStatus, getStatus, defaultVariantFor } from './migration/store.js';
import { InfoIcon, QcPanel } from './migration/QcOverlay.jsx';

// ─── Categorized Add Menu ───────────────────────────────────────────────────
const PLUGIN_CATEGORIES = [
  { name: 'Tone', color: '#7fff8f', items: [
    ['neve', '1073 Neve'],
    ['iron1073', 'Iron 1073'],
    ['nastyneve', 'Nasty Neve'],
    ['ampless', 'Ampless'],
    ['bassmind', 'BassMind'],
  ]},
  { name: 'Drive', color: '#ff6b6b', items: [
    ['distortion', 'Distortion'],
    ['amp', 'Amp'],
    ['shagatron', 'Shagatron'],
    ['splitdrive', 'SplitDrive'],
  ]},
  { name: 'Dynamics', color: '#ffaa30', items: [
    ['analogglue', 'Nasty Glue'],
    ['la2a', 'LVL-2A Opto'],
    ['mixbus', 'Mix Bus'],
    ['gluesmash', 'GlueSmash'],
    ['smoother', 'Smoother'],
    ['drumbus', 'Panther Buss'],
  ]},
  { name: 'Modulation', color: '#4da8ff', items: [
    ['modulation', 'Modulation'],
    ['flanger', 'Dual Flanger'],
    ['pitchshift', 'Poly Pitch'],
    ['drift', 'Drift'],
    ['reactor', 'Reactor'],
    ['phaser', 'Phase Orbit'],
  ]},
  { name: 'Time', color: '#c78fff', items: [
    ['space', 'Space'],
    ['reverb', 'Reverb'],
    ['spring', 'Wabble Spring'],
    ['spring2', 'Spring Reverb'],
    ['tapedelay', 'Tape Delay'],
    ['tape', '424 Tape'],
    ['echoform', 'EchoForm'],
    ['flapjackman', 'Flap Jack Man'],
  ]},
  { name: 'Vocal', color: '#e879f9', items: [
    ['vocallock', 'VocalLock'],
    ['deharsh', 'DeHarsh Pro'],
    ['vibemic', 'VibeMic'],
    ['phraserider', 'PhraseRider'],
    ['airlift', 'AirLift'],
    ['character', 'CharacterBox'],
  ]},
  { name: 'Reverb', color: '#22d3ee', items: [
    ['gravity', 'Gravity'],
    ['focusreverb', 'Focus Reverb'],
    ['nearfar', 'Near/Far'],
    ['morphreverb', 'MorphReverb'],
    ['transientreverb', 'TransientVerb'],
    ['smear', 'Smear'],
    ['orbit', 'Orbit'],
    ['platex', 'Plate-X'],
    ['reverbbus', 'ReverbBus'],
  ]},
  { name: 'Creative', color: '#ff80b0', items: [
    ['vocal', 'Vocal'],
    ['playbox', 'PlayBox'],
  ]},
  { name: 'Master', color: '#d4c8a8', items: [
    ['finisher', 'Finisher'],
  ]},
  { name: 'Utility', color: 'rgba(255,255,255,0.5)', items: [
    ['scope', 'Scope'],
  ]},
];

function AddMenu({ onAdd }) {
  const [hoveredCat, setHoveredCat] = useState(null);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3,
      padding: 8, borderRadius: 10, marginBottom: 4,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      maxWidth: 560, width: 560,
    }}>
      {PLUGIN_CATEGORIES.map(cat => (
        <div key={cat.name}
          onMouseEnter={() => setHoveredCat(cat.name)}
          onMouseLeave={() => setHoveredCat(null)}
          style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            padding: '6px 4px', borderRadius: 6,
            background: hoveredCat === cat.name ? 'rgba(255,255,255,0.04)' : 'transparent',
            transition: 'background 0.15s ease',
          }}>
          {/* Category header */}
          <div style={{
            fontSize: 7, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: cat.color, padding: '0 4px 3px',
            borderBottom: `1px solid ${cat.color}22`,
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          }}>{cat.name}</div>
          {/* Items */}
          {cat.items.map(([type, label]) => (
            <button key={type} onClick={() => onAdd(type)}
              style={{
                fontSize: 9, fontWeight: 500, fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
                padding: '4px 6px', borderRadius: 4, border: 'none',
                background: 'transparent', color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${cat.color}18`; e.currentTarget.style.color = cat.color; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
            >{label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── QC Mode: two-tab Add Menu (Legacy / Engine V1) ─────────────────────────
// Appears only when qcMode is on. Non-QC mode keeps the original AddMenu.
function AddMenuTabs({ onAdd }) {
  const [tab, setTab] = useState('legacy');

  // Legacy tab: reuse the existing PLUGIN_CATEGORIES exactly (every product
  // lives here always — legacy is the source of truth).
  // Engine V1 tab: derived from the registry, filtered by approved status.
  const engineV1Items = REGISTRY.filter(
    p => getStatus(p.productId) === 'approved_engine_v1' && !!p.variants.engine_v1,
  );

  const tabBtn = (id, label) => (
    <button key={id} onClick={() => setTab(id)}
      style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.18em',
        padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
        border: '1px solid',
        borderColor: tab === id ? 'rgba(127,255,143,0.55)' : 'rgba(255,255,255,0.12)',
        color:       tab === id ? '#9fff8f' : 'rgba(255,255,255,0.6)',
        background:  tab === id ? 'rgba(30,80,40,0.35)' : 'rgba(255,255,255,0.02)',
        fontFamily:  'system-ui, -apple-system, Arial, sans-serif',
      }}>{label}</button>
  );

  return (
    <div style={{
      padding: 8, borderRadius: 10, marginBottom: 4,
      background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(127,255,143,0.22)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      maxWidth: 560, width: 560,
    }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {tabBtn('legacy',    'LEGACY')}
        {tabBtn('engine_v1', 'ENGINE V1')}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 8, letterSpacing: '0.2em', color: '#9fff8f',
          alignSelf: 'center', paddingRight: 4 }}>QC MODE</span>
      </div>

      {tab === 'legacy' ? (
        // Legacy tab — full original grid. For products in the registry, we
        // attach productId + 'legacy' variantId so render routes correctly.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
          {PLUGIN_CATEGORIES.map(cat => (
            <div key={cat.name} style={{
              display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 4px',
            }}>
              <div style={{
                fontSize: 7, fontWeight: 800, letterSpacing: '0.2em',
                color: cat.color, padding: '0 4px 3px',
                borderBottom: `1px solid ${cat.color}22`,
                fontFamily: 'system-ui, Arial, sans-serif',
              }}>{cat.name}</div>
              {cat.items.map(([type, label]) => {
                const prod = getProductByLegacyType(type);
                return (
                  <button key={type}
                    onClick={() => onAdd({ type, productId: prod?.productId, variantId: prod ? 'legacy' : undefined })}
                    style={{
                      fontSize: 9, fontWeight: 500, padding: '4px 6px', borderRadius: 4,
                      border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.6)',
                      cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
                      fontFamily: 'system-ui, Arial, sans-serif',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${cat.color}18`; e.currentTarget.style.color = cat.color; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        // Engine V1 tab — only approved migrated products.
        <div style={{ padding: '8px 6px' }}>
          {engineV1Items.length === 0 ? (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.15em', padding: 10 }}>
              No plugins approved for Engine V1 yet. Approve from a legacy instance in QC mode.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {engineV1Items.map(p => (
                <button key={p.productId}
                  onClick={() => onAdd({
                    type: p.legacyType, productId: p.productId, variantId: 'engine_v1',
                  })}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: '6px 10px', borderRadius: 4,
                    border: '1px solid rgba(127,255,143,0.25)',
                    background: 'rgba(30,80,40,0.18)', color: '#c8ffcf',
                    cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'system-ui, Arial, sans-serif',
                  }}>
                  {p.displayLabel}
                  <span style={{ opacity: 0.55, marginLeft: 8, fontSize: 8, letterSpacing: '0.15em' }}>
                    · ENGINE V1
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  // Default chain is just a Scope at the front. The audio loader UI in the
  // top bar used to live inside the Space module (it reported controls up
  // via onAudioControls), which meant you couldn't load audio without a
  // Space in the chain. Now the file loader lives directly in main.jsx and
  // talks to `sharedSource` — no module required.
  const [instances, setInstances] = useState([{ id: 1, type: 'scope' }]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [sharedSource, setSharedSource] = useState(null);
  const [qcMode, setQcMode] = useQcMode();

  // ── Global audio loader state (was inside OrbPluginDemo) ──────────────────
  const [audioSource, setAudioSource] = useState('none'); // 'none' | 'file' | 'mic'
  const [isPlaying, setIsPlaying]     = useState(false);
  const [muted, setMuted]             = useState(false);
  const [fileName, setFileName]       = useState('');
  const [bpm, setBpm]                 = useState(0);
  const [inputPadDb, setInputPadDb]   = useState(0); // 0 | -5 | -10 (QC gain stage)
  const fileInputRef                  = useRef(null);
  const inputPadRef                   = useRef(null); // GainNode: source → pad → chain

  const handleFile = useCallback(async (file) => {
    if (!file || !sharedSource) return;
    setFileName(file.name);
    // Try to extract BPM from filename (e.g. "MO_TENNY_110_drums.wav" → 110)
    const bpmMatch = file.name.match(/[_\-\s](\d{2,3})[_\-\s.]/);
    if (bpmMatch) {
      const detected = parseInt(bpmMatch[1]);
      if (detected >= 60 && detected <= 200) setBpm(detected);
    }
    await sharedSource.loadFile(file);
    setAudioSource('file');
    setIsPlaying(true);
  }, [sharedSource]);

  const handleStop = useCallback(() => {
    sharedSource?.stop();
    setAudioSource('none');
    setIsPlaying(false);
  }, [sharedSource]);

  // Mute toggles the master gain node (5ms ramp, zipper-free).
  // Doesn't stop playback — audio keeps flowing, just silenced at master output.
  const handleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      const master = masterGainRef.current;
      if (master && sharedSource) {
        const t = sharedSource.ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(next ? 0 : 1, t + 0.005);
      }
      return next;
    });
  }, [sharedSource]);

  // Input Pad — apply dB selection to the pre-chain GainNode (5ms ramp, zipper-free).
  useEffect(() => {
    const pad = inputPadRef.current;
    if (!pad || !sharedSource) return;
    const linear = Math.pow(10, inputPadDb / 20);
    const t = sharedSource.ctx.currentTime;
    pad.gain.cancelScheduledValues(t);
    pad.gain.setValueAtTime(pad.gain.value, t);
    pad.gain.linearRampToValueAtTime(linear, t + 0.005);
  }, [inputPadDb, sharedSource]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) handleFile(file);
  }, [handleFile]);

  const handleBpmChange = useCallback((v) => { setBpm(v); }, []);

  const enginesRef = useRef(new Map()); // id -> engine
  const [chainVersion, setChainVersion] = useState(0); // trigger rewire
  const masterGainRef    = useRef(null);
  const masterAnalyserRef = useRef(null);
  const routingRef       = useRef({ pads: [], firstInput: null, lastOutput: null });

  // ── Clip detection — feeds per-module heat glow only (no toast) ─────────────
  const [hotLevel,     setHotLevel    ] = useState(0);         // master: 0/1/2
  const [moduleHeat,   setModuleHeat  ] = useState({});        // id → 0/1/2

  // Poll the master analyser for clips every animation frame
  useEffect(() => {
    const buf = new Float32Array(512);
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const analyser = masterAnalyserRef.current;
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      const peak = buf.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      // 0.5 ≈ -6 dBFS = warm, 0.999 = clipping
      setHotLevel(peak >= 0.999 ? 2 : peak >= 0.5 ? 1 : 0);

      // Per-module heat — read each engine's output peak directly from enginesRef.
      const heat = {};
      enginesRef.current.forEach((engine, id) => {
        try {
          const p = engine.getOutputPeak?.() ?? 0;
          heat[id] = p >= 0.999 ? 2 : p >= 0.5 ? 1 : 0;
        } catch { heat[id] = 0; }
      });
      setModuleHeat(heat);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const src = createSharedSource();
    setSharedSource(src);
    masterGainRef.current = null; // reset so rewire re-creates master in new context
    inputPadRef.current   = null;
    routingRef.current    = { pads: [], firstInput: null, lastOutput: null };
    return () => { src.destroy(); masterGainRef.current = null; inputPadRef.current = null; };
  }, []);

  // ─── Click-free rewire ────────────────────────────────────────────────────
  // Rule: CONNECT new routing FIRST, then fade-out + disconnect old routing.
  // This ensures the audio graph is never briefly unplugged during a rewire,
  // which was the cause of the stutter/gap heard in the Space module.
  useEffect(() => {
    if (!sharedSource) return;
    const ctx   = sharedSource.ctx;
    const chain = instances.map(inst => enginesRef.current.get(inst.id)).filter(Boolean);

    // ── One-time master chain creation ────────────────────────────────────────
    // Master is UNITY (no attenuation). A gentle brickwall at -0.3 dBFS catches
    // true clippers only, matching the per-module limiter philosophy: never
    // touch normal program material, just prevent digital overs.
    if (!masterGainRef.current) {
      const master = ctx.createGain();
      master.gain.value = 1.0;
      const masterLimiter = ctx.createDynamicsCompressor();
      masterLimiter.threshold.value = -0.3;
      masterLimiter.knee.value      =  0;
      masterLimiter.ratio.value     = 20;
      masterLimiter.attack.value    = 0.001;
      masterLimiter.release.value   = 0.1;
      master.connect(masterLimiter);
      masterLimiter.connect(ctx.destination);
      // Tap an analyser off the master (pre-limiter) for clip detection
      const masterAnalyser = ctx.createAnalyser();
      masterAnalyser.fftSize = 512;
      masterAnalyser.smoothingTimeConstant = 0;  // instant — we want true peaks
      master.connect(masterAnalyser);
      masterAnalyserRef.current = masterAnalyser;
      masterGainRef.current = master;
    }
    // ── Global Input Pad (QC gain stage) ──────────────────────────────────────
    // Lives BEFORE the plugin chain. Signal flow:
    //   sharedSource.outputNode → inputPad → chain[0].input → ... → master
    // Created once and reused; gain is updated by a separate effect on inputPadDb.
    if (!inputPadRef.current) {
      const pad = ctx.createGain();
      const linear = Math.pow(10, inputPadDb / 20);
      pad.gain.value = linear;
      sharedSource.outputNode.connect(pad);
      inputPadRef.current = pad;
    }
    const inputPad = inputPadRef.current;
    const master = masterGainRef.current;
    const t      = ctx.currentTime;

    if (chain.length === 0) {
      const prev = routingRef.current;
      if (prev.firstInput) try { inputPad.disconnect(prev.firstInput); } catch {}
      routingRef.current = { pads: [], firstInput: null, lastOutput: null };
      return;
    }

    const prev       = routingRef.current;
    const firstInput = chain[0].input;
    const lastOutput = chain[chain.length - 1].output;

    // ── STEP 1: Connect new routing (audio keeps flowing) ─────────────────────
    if (firstInput !== prev.firstInput) {
      inputPad.connect(firstInput);
    }

    // Pure series chain. Each module feeds the next at UNITY. No parallel pan
    // pad stacking — that would double-count dry signal through bypassed modules
    // and turn "N bypassed modules" into a weird boost/cut depending on N.
    // Each module has its own output gain + pan in the UI if the user wants
    // per-module stereo positioning.
    const newPads = [];
    for (let i = 0; i < chain.length - 1; i++) {
      // Series pad — start at 0, ramp to unity so there's no level spike mid-rewire
      const seriesPad = ctx.createGain();
      seriesPad.gain.value = 0;
      chain[i].chainOutput.connect(seriesPad);
      seriesPad.connect(chain[i + 1].input);
      seriesPad.gain.setTargetAtTime(1.0, t, 0.008);

      newPads.push({ chainOutput: chain[i].chainOutput, seriesPad });
    }

    if (lastOutput !== prev.lastOutput) {
      lastOutput.connect(master);
    }

    // ── STEP 2: Fade out old routing, then disconnect (30 ms later) ───────────
    const oldPads = prev.pads.slice();
    for (const p of oldPads) {
      p.seriesPad.gain.setTargetAtTime(0, t, 0.005);
    }
    setTimeout(() => {
      for (const p of oldPads) {
        try { p.chainOutput.disconnect(p.seriesPad); } catch {}
        try { p.seriesPad.disconnect(); } catch {}
      }
    }, 30);

    if (prev.firstInput && prev.firstInput !== firstInput) {
      try { inputPad.disconnect(prev.firstInput); } catch {}
    }
    if (prev.lastOutput && prev.lastOutput !== lastOutput) {
      setTimeout(() => { try { prev.lastOutput.disconnect(master); } catch {} }, 30);
    }

    routingRef.current = { pads: newPads, firstInput, lastOutput };
  }, [chainVersion, instances, sharedSource]);

  const registerEngine = useCallback((id, engine) => {
    enginesRef.current.set(id, engine);
    setChainVersion(v => v + 1);
  }, []);

  const unregisterEngine = useCallback((id) => {
    enginesRef.current.delete(id);
    setChainVersion(v => v + 1);
  }, []);

  const MASTER_KEY = 'nasty-orbs-master';
  const [masterPresets, setMasterPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MASTER_KEY) || '{}'); } catch { return {}; }
  });
  const [selectedMaster, setSelectedMaster] = useState('');
  const [initialStates, setInitialStates] = useState({});
  const instanceStatesRef = useRef(new Map());

  const handleStateChange = useCallback((id, state) => {
    instanceStatesRef.current.set(id, state);
  }, []);

  const saveMasterPreset = () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const preset = {
      instances: instances.map(i => ({ type: i.type })),
      states: instances.map(i => instanceStatesRef.current.get(i.id) || {}),
    };
    const next = { ...masterPresets, [name]: preset };
    setMasterPresets(next);
    setSelectedMaster(name);
    try { localStorage.setItem(MASTER_KEY, JSON.stringify(next)); } catch {}
  };

  const loadMasterPreset = (name) => {
    setSelectedMaster(name);
    if (!masterPresets[name]) return;
    const preset = masterPresets[name];
    const newInstances = preset.instances.map((inst, idx) => ({ id: Date.now() + idx, type: inst.type }));
    const newInitialStates = {};
    newInstances.forEach((inst, idx) => { newInitialStates[inst.id] = preset.states[idx] || {}; });
    instanceStatesRef.current.clear();
    setInitialStates(newInitialStates);
    setInstances(newInstances);
  };

  const deleteMasterPreset = (name) => {
    if (!name) return;
    const next = { ...masterPresets };
    delete next[name];
    setMasterPresets(next);
    setSelectedMaster('');
    try { localStorage.setItem(MASTER_KEY, JSON.stringify(next)); } catch {}
  };

  // addInstance accepts either:
  //   - legacy form: addInstance('drumbus')
  //   - structured:  addInstance({ type, productId?, variantId? })
  // For products in the migration registry, productId/variantId are stored
  // on the instance so rendering + the ⓘ tooltip read the exact truth.
  const addInstance = (arg) => {
    const payload = typeof arg === 'string' ? { type: arg } : { ...arg };
    // If a registry product was reached via the non-QC menu (no variantId
    // set), resolve to the approved variant (engine_v1) or legacy.
    if (payload.type && !payload.productId) {
      const prod = getProductByLegacyType(payload.type);
      if (prod) {
        payload.productId = prod.productId;
        payload.variantId = defaultVariantFor(prod.productId);
      }
    }
    setInstances(prev => [...prev, { id: Date.now(), ...payload }]);
    setShowAddMenu(false);
  };
  const removeInstance = (id) => setInstances(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);

  // Load the alternate variant of an existing instance beside the current.
  // Non-destructive — current instance remains, the alternate is appended
  // immediately after it so A/B is visually adjacent.
  const loadAlternateVariant = useCallback((instId, altVariantId) => {
    setInstances(prev => {
      const idx = prev.findIndex(i => i.id === instId);
      if (idx < 0) return prev;
      const cur = prev[idx];
      if (!cur.productId) return prev;
      const next = [...prev];
      next.splice(idx + 1, 0, {
        id: Date.now(),
        type: cur.type,
        productId: cur.productId,
        variantId: altVariantId,
      });
      return next;
    });
  }, []);

  // Quick bypass from chain pill — calls engine directly, no prop threading needed
  const [pillBypasses, setPillBypasses] = useState({});
  const togglePillBypass = useCallback((id) => {
    setPillBypasses(prev => {
      const next = { ...prev, [id]: !prev[id] };
      enginesRef.current.get(id)?.setBypass(next[id]);
      return next;
    });
  }, []);

  const dragIdRef = useRef(null);
  // insertAfterIndex: -1 = before first, 0..n-1 = after that index, null = not dragging
  const [insertAfterIndex, setInsertAfterIndex] = useState(null);

  const onDragStart = useCallback((e, id) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragOverPill = useCallback((e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Left half of pill = insert before (idx-1), right half = insert after (idx)
    const rect = e.currentTarget.getBoundingClientRect();
    const mid  = rect.left + rect.width / 2;
    setInsertAfterIndex(e.clientX < mid ? idx - 1 : idx);
  }, []);

  const onDragEnd = useCallback(() => {
    dragIdRef.current = null;
    setInsertAfterIndex(null);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (fromId == null || insertAfterIndex === null) { onDragEnd(); return; }
    setInstances(prev => {
      const arr   = [...prev];
      const from  = arr.findIndex(i => i.id === fromId);
      if (from === -1) return prev;
      const [item] = arr.splice(from, 1);
      // insertAfterIndex was computed before splice, adjust if needed
      let to = insertAfterIndex >= from ? insertAfterIndex : insertAfterIndex + 1;
      to = Math.max(0, Math.min(arr.length, to));
      arr.splice(to, 0, item);
      return arr;
    });
    dragIdRef.current = null;
    setInsertAfterIndex(null);
  }, [insertAfterIndex]);

  if (!sharedSource) return null; // Wait for audio context

  return (
    <div className="min-h-screen flex flex-col p-6 gap-6" style={{ background: '#050a06' }}>
      {/* Master preset bar */}
      <div className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Logo */}
        <div className="text-base uppercase shrink-0" style={{
          fontFamily: "'Rubik Glitch', sans-serif",
          backgroundImage: 'linear-gradient(135deg, #7fff8f 0%, white 40%, #5fe87a 60%, #9fff6a 100%)',
          backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 0 8px rgba(100,255,120,0.5))',
          letterSpacing: '0.15em',
        }}>Nasty Orbs</div>
        {/* Global audio loader — always visible, operates on sharedSource
            directly so the file picker exists even with no Space in the chain */}
        <div className="flex items-center gap-1.5 shrink-0">
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
            onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
          <div
            className="rounded-md border border-dashed px-2.5 py-1 cursor-pointer transition-colors"
            style={{ borderColor: isPlaying && audioSource === 'file' ? 'rgba(100,220,130,0.35)' : 'rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.2)' }}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            {isPlaying && audioSource === 'file' ? (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#7fff8f' }} />
                <span className="text-[9px] font-medium truncate max-w-[90px]" style={{ color: '#7fff8f' }}>{fileName}</span>
              </div>
            ) : (
              <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Drop audio</span>
            )}
          </div>
          {isPlaying && (
            <button onClick={handleStop}
              className="rounded-md px-2 py-1 text-[9px] font-medium border"
              style={{ background: 'rgba(220,80,80,0.15)', borderColor: 'rgba(220,100,100,0.35)', color: 'rgba(255,140,140,0.9)' }}>
              Stop
            </button>
          )}
          <button onClick={handleMute}
            title={muted ? 'Unmute audio' : 'Mute audio'}
            className="rounded-md px-2 py-1 text-[9px] font-medium border transition-colors"
            style={{
              background:   muted ? 'rgba(245,158,11,0.18)'  : 'rgba(255,255,255,0.06)',
              borderColor:  muted ? 'rgba(245,158,11,0.45)'  : 'rgba(255,255,255,0.12)',
              color:        muted ? 'rgba(252,211,77,0.95)'  : 'rgba(255,255,255,0.6)',
            }}>
            {muted ? 'Muted' : 'Mute'}
          </button>
          {/* Input Pad — global pre-chain gain stage for QC */}
          <div className="flex items-center gap-0 rounded-md overflow-hidden border"
            title="Input Pad — applied before the plugin chain"
            style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.2)' }}>
            <span className="text-[8px] px-1.5 py-1 uppercase tracking-[0.15em]"
              style={{ color: 'rgba(255,255,255,0.35)' }}>Pad</span>
            {[0, -5, -10].map(db => {
              const active = inputPadDb === db;
              return (
                <button key={db} onClick={() => setInputPadDb(db)}
                  className="text-[9px] px-1.5 py-1 font-medium border-l transition-colors"
                  style={{
                    borderColor: 'rgba(255,255,255,0.08)',
                    background: active ? 'rgba(100,220,130,0.18)' : 'transparent',
                    color: active ? '#7fff8f' : 'rgba(255,255,255,0.45)',
                  }}>
                  {db === 0 ? '0' : db}
                </button>
              );
            })}
          </div>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*"
            value={bpm || ''}
            placeholder="BPM"
            onChange={(e) => {
              const v = parseInt(e.target.value) || 0;
              handleBpmChange(v);
            }}
            className="w-10 rounded-md px-1.5 py-1 text-[9px] font-medium border text-center bg-black/20 outline-none"
            style={{ borderColor: bpm ? 'rgba(100,220,130,0.35)' : 'rgba(255,255,255,0.08)', color: bpm ? '#7fff8f' : 'rgba(255,255,255,0.35)' }}
          />
        </div>
        <span className="text-[8px] uppercase tracking-[0.4em]" style={{ color: 'rgba(255,255,255,0.2)' }}>Chain</span>
        <div className="flex gap-0 flex-1 flex-wrap items-center" onDrop={onDrop} onDragOver={e => e.preventDefault()}>
          {instances.map((inst, idx) => {
            const isDragging = dragIdRef.current === inst.id;
            const insertBefore = insertAfterIndex === idx - 1;
            const insertAfter  = insertAfterIndex === idx;
            const isBypassed = !!pillBypasses[inst.id];
            const label = inst.type === 'amp' ? 'Amp' : inst.type === 'distortion' ? 'Dist' : inst.type === 'modulation' ? 'Mod' : inst.type === 'vocal' ? 'Vocal' : inst.type === 'mixbus' ? 'Mix Bus' : inst.type === 'reverb' ? 'Reverb' : inst.type === 'scope' ? 'Scope' : inst.type === 'neve' ? '1073' : inst.type === 'iron1073' ? 'Iron' : inst.type === 'nastyneve' ? 'Nasty' : inst.type === 'tape' ? '424' : inst.type === 'spring' ? 'Wabble' : inst.type === 'spring2' ? 'Spring' : inst.type === 'flapjackman' ? 'Flap Jack' : inst.type === 'tapedelay' ? 'Tape Dly' : inst.type === 'analogglue' ? 'Nasty Glue' : inst.type === 'la2a' ? 'LVL-2A' : inst.type === 'shagatron' ? 'Shag' : inst.type === 'flanger' ? 'Flanger' : inst.type === 'gluesmash' ? 'GlueSmash' : inst.type === 'bassmind' ? 'BassMind' : inst.type === 'echoform' ? 'EchoForm' : inst.type === 'drift' ? 'Drift' : inst.type === 'ampless' ? 'Ampless' : inst.type === 'finisher' ? 'Finisher' : inst.type === 'reactor' ? 'Reactor' : inst.type === 'splitdrive' ? 'SplitDrv' : inst.type === 'smoother' ? 'Smoother' : inst.type === 'playbox' ? 'PlayBox' : inst.type === 'pitchshift' ? 'Pitch' : inst.type === 'vocallock' ? 'VocLock' : inst.type === 'deharsh' ? 'DeHarsh' : inst.type === 'vibemic' ? 'VibeMic' : inst.type === 'phraserider' ? 'Rider' : inst.type === 'airlift' ? 'AirLift' : inst.type === 'character' ? 'CharBox' : inst.type === 'gravity' ? 'Gravity' : inst.type === 'focusreverb' ? 'FocusRev' : inst.type === 'nearfar' ? 'NearFar' : inst.type === 'morphreverb' ? 'Morph' : inst.type === 'transientreverb' ? 'TransRev' : inst.type === 'smear' ? 'Smear' : inst.type === 'orbit' ? 'Orbit' : inst.type === 'platex' ? 'PlateX' : inst.type === 'reverbbus' ? 'RevBus' : inst.type === 'drumbus' ? 'Panther Buss' : 'Space';
            return (
              <div key={inst.id} className="flex items-center">
                {/* Insert-before line */}
                <div style={{
                  width: insertBefore ? 3 : 6,
                  height: insertBefore ? 22 : 0,
                  background: insertBefore ? 'rgba(255,255,255,0.6)' : 'transparent',
                  borderRadius: 2,
                  marginRight: insertBefore ? 4 : 0,
                  transition: 'all 0.1s',
                  boxShadow: insertBefore ? '0 0 6px rgba(255,255,255,0.4)' : 'none',
                }} />
                {/* Pill: click anywhere to toggle bypass. Label is draggable for reorder. */}
                <div
                  onClick={() => togglePillBypass(inst.id)}
                  title={isBypassed ? 'Click to enable' : 'Click to bypass'}
                  className="flex items-center gap-0 rounded-md overflow-hidden select-none cursor-pointer"
                  style={{
                    border: isBypassed ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(255,255,255,0.1)',
                    background: isBypassed ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.06)',
                    opacity: isDragging ? 0.35 : 1,
                    marginRight: 6,
                    transition: 'all 0.15s',
                  }}>
                  <span
                    draggable
                    onDragStart={e => onDragStart(e, inst.id)}
                    onDragOver={e => onDragOverPill(e, idx)}
                    onDragEnd={onDragEnd}
                    className="text-[8px] px-2.5 py-1 cursor-grab active:cursor-grabbing transition-colors"
                    style={{ color: isBypassed ? 'rgba(252,211,77,0.55)' : isDragging ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)' }}>
                    ⠿ {label}
                  </span>
                  {/* Visual status dot (not clickable — whole pill is the click target) */}
                  <div className="px-2 py-1 border-l flex items-center"
                    style={{ borderColor: isBypassed ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.07)' }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: isBypassed ? 'rgba(252,211,77,0.8)' : 'rgba(100,220,130,0.7)',
                      boxShadow: isBypassed ? '0 0 4px rgba(252,211,77,0.5)' : '0 0 4px rgba(100,220,130,0.4)',
                      transition: 'all 0.15s',
                    }} />
                  </div>
                </div>
                {/* Insert-after line (only for last item) */}
                {idx === instances.length - 1 && (
                  <div style={{
                    width: insertAfter ? 3 : 0,
                    height: insertAfter ? 22 : 0,
                    background: insertAfter ? 'rgba(255,255,255,0.6)' : 'transparent',
                    borderRadius: 2,
                    transition: 'all 0.1s',
                    boxShadow: insertAfter ? '0 0 6px rgba(255,255,255,0.4)' : 'none',
                  }} />
                )}
              </div>
            );
          })}
        </div>
        <select value={selectedMaster} onChange={e => loadMasterPreset(e.target.value)}
          className="text-[9px] rounded px-2 py-1 outline-none cursor-pointer"
          style={{ WebkitAppearance: 'none', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', minWidth: 140 }}>
          <option value="" style={{ background: '#050a06' }}>— Load preset —</option>
          {Object.keys(masterPresets).sort().map(name => (
            <option key={name} value={name} style={{ background: '#050a06' }}>{name}</option>
          ))}
        </select>
        <button onClick={saveMasterPreset}
          className="text-[9px] font-medium px-3 py-1 rounded whitespace-nowrap"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.55)' }}>Save</button>
        <button onClick={() => deleteMasterPreset(selectedMaster)} disabled={!selectedMaster}
          className="text-[9px] font-medium px-3 py-1 rounded whitespace-nowrap disabled:opacity-30"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.55)' }}>Delete</button>
      </div>
      {/* Module grid */}
      <div className="flex flex-wrap items-start justify-center gap-6" style={{ position: 'relative' }}>
        {instances.map(inst => {
          // Registry truth for the ⓘ tooltip + QC panel. Only populated for
          // products that have been modelled in migration/registry.js — for
          // everything else, the overlays simply don't render.
          const product = inst.productId ? getProduct(inst.productId) : null;
          const variant = product && inst.variantId ? getVariant(inst.productId, inst.variantId) : null;
          const status  = product ? getStatus(product.productId) : null;
          return (
          <div key={inst.id} style={{
            borderRadius: 12,
            position: 'relative',    // anchor for InfoIcon / QcPanel overlays
            transition: 'box-shadow 0.12s ease',
            // Neve handles its own Drive-knob glow internally — suppress the box glow wrapper
            boxShadow: inst.type === 'neve' ? 'none'
              : (moduleHeat[inst.id] ?? 0) === 2
              ? '0 0 0 2px hsla(0,88%,50%,0.9),    0 0 22px hsla(0,88%,50%,0.4)'
              : (moduleHeat[inst.id] ?? 0) === 1
              ? '0 0 0 2px hsla(38,80%,48%,0.45), 0 0 14px hsla(38,80%,48%,0.18)'
              : '0 0 0 2px transparent',
          }}>
          {product && variant && (
            <InfoIcon product={product} variant={variant} status={status} />
          )}
          {qcMode && product && variant && (
            <QcPanel product={product} variant={variant}
              onLoadAlternate={(altId) => loadAlternateVariant(inst.id, altId)} />
          )}
          {inst.type === 'amp' ? (
          <AmpOrb
            key={inst.id} instanceId={inst.id} sharedSource={sharedSource}
            registerEngine={registerEngine} unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange} initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'distortion' ? (
          <DistortionOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'modulation' ? (
          <ModulationOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'vocal' ? (
          <VocalOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'mixbus' ? (
          <MixBusOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'reverb' ? (
          <SimpleReverbOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'scope' ? (
          <ScopeOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'neve' ? (
          <NeveOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
            hotLevel={moduleHeat[inst.id] ?? 0}
          />
        ) : inst.type === 'tape' ? (
          <TapeOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'spring' ? (
          <SpringReverbOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'spring2' ? (
          <SpringPhysicsOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'flapjackman' ? (
          <FlapJackManOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'tapedelay' ? (
          <TapeDelayOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'iron1073' ? (
          <Iron1073Orb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'analogglue' ? (
          <AnalogGlueOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'la2a' ? (
          <LA2AOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'shagatron' ? (
          <ShagatronOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'flanger' ? (
          <FlangerOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'phaser' ? (
          <PhaserOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'pitchshift' ? (
          <PitchShifterOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'nastyneve' ? (
          <NastyNeveOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'gluesmash' ? (
          <GluesmashOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'bassmind' ? (
          <BassmindOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'echoform' ? (
          <EchoformOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'drift' ? (
          <DriftOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'ampless' ? (
          <AmplessOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'finisher' ? (
          <FinisherOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'reactor' ? (
          <ReactorOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'splitdrive' ? (
          <SplitdriveOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'smoother' ? (
          <SmootherOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'playbox' ? (
          <PlayboxOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'vocallock' ? (
          <VocalLockOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'deharsh' ? (
          <DeHarshOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'vibemic' ? (
          <VibeMicOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'phraserider' ? (
          <PhraseRiderOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'airlift' ? (
          <AirliftOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'character' ? (
          <CharacterOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'gravity' ? (
          <GravityOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'focusreverb' ? (
          <FocusReverbOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) :inst.type === 'nearfar' ? (
          <NearFarOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'morphreverb' ? (
          <MorphReverbOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'transientreverb' ? (
          <TransientReverbOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'smear' ? (
          <SmearOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'orbit' ? (
          <OrbitOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'platex' ? (
          <PlateXOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'reverbbus' ? (
          <ReverbBusOrb
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        ) : inst.type === 'drumbus' ? (
          (() => {
            // Registry-driven: legacy variantId → DrumBusOrb, else → PantherBussOrb.
            const Shell = inst.variantId === 'legacy' ? DrumBusOrb : PantherBussOrb;
            return (
              <Shell
                key={inst.id}
                instanceId={inst.id}
                sharedSource={sharedSource}
                registerEngine={registerEngine}
                unregisterEngine={unregisterEngine}
                onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
                onStateChange={handleStateChange}
                initialState={initialStates[inst.id]}
              />
            );
          })()
        ) : (
          <OrbPluginDemo
            key={inst.id}
            instanceId={inst.id}
            sharedSource={sharedSource}
            registerEngine={registerEngine}
            unregisterEngine={unregisterEngine}
            onRemove={instances.length > 1 ? () => removeInstance(inst.id) : null}
            onStateChange={handleStateChange}
            initialState={initialStates[inst.id]}
          />
        )}
          </div>
          );
        })}
      </div>

      {/* CSS for cursor blink */}
      <style>{`
        @keyframes cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>

      {/* Add module button + categorized menu */}
      <div className="fixed bottom-6 right-6 flex flex-col items-end gap-1.5" style={{ zIndex: 500 }}>
        {showAddMenu && (
          qcMode
            ? <AddMenuTabs onAdd={payload => { addInstance(payload); setShowAddMenu(false); }} />
            : <AddMenu     onAdd={type    => { addInstance(type);    setShowAddMenu(false); }} />
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* QC Mode toggle — persists in localStorage */}
          <button
            onClick={() => setQcMode(v => !v)}
            title={qcMode ? 'QC Mode ON — click to disable' : 'QC Mode OFF — click to enable'}
            style={{
              height: 28, padding: '0 12px', borderRadius: 14,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.2em',
              fontFamily: 'system-ui, Arial, sans-serif', cursor: 'pointer',
              border: `1px solid ${qcMode ? 'rgba(127,255,143,0.55)' : 'rgba(255,255,255,0.15)'}`,
              background: qcMode ? 'rgba(30,80,40,0.45)' : 'rgba(0,0,0,0.5)',
              color:      qcMode ? '#9fff8f' : 'rgba(255,255,255,0.5)',
              backdropFilter: 'blur(8px)',
            }}>
            QC {qcMode ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setShowAddMenu(m => !m)}
            className="w-12 h-12 rounded-full border border-white/15 bg-black/50 backdrop-blur text-white/50 hover:text-white hover:border-white/30 transition-all text-2xl flex items-center justify-center"
          >{showAddMenu ? '×' : '+'}</button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Reshaped theme="slate">
      <App />
    </Reshaped>
  </React.StrictMode>
);
