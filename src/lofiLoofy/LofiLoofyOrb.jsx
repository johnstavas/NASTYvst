// LofiLoofyOrb.jsx — Lo-fi Loofy plugin UI.
//
// Standard rack wrapper: registerEngine on mount, unregisterEngine on
// unmount, onStateChange persistence, sharedSource awareness.
//
// Cat morph: two layered <img> elements (LofiCat_1 = clean, LofiCat_2 =
// degraded) cross-faded by Age, with CSS filters/transforms driven by
// Age and Dream LFO output for "the cat warps as the audio degrades."

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createLofiLoofyEngine, LOFI_CHARACTERS } from './lofiLoofyEngine.js';

// Palette
// Dreamy lemon / soft-white shell with pink accents — matches the cloud sky.
const COL = {
  bg:      '#FFF7DE',  // soft lemon cream (plugin shell)
  panel:   '#FDEFF4',  // blush-white panels
  text:    '#4A2F3C',  // deep plum — strong contrast on lemon shell
  muted:   '#8A5E72',  // darker dusty pink — still readable on cream/lemon
  cream:   '#FFFDF2',  // lightest lemon highlight
  caramel: '#F6B8C9',  // mid pink (knob mid-tone)
  rust:    '#E8799A',  // hot pink accent
  amber:   '#F4C96F',  // soft lemon accent (active states)
  border:  '#EAD5DC',  // pink-tinted border
  shadow:  'rgba(180,120,140,0.18)',
};

// ── BITS / RATE button-strip (hoisted; defining these inside render
//    caused remounts on every RAF tick, which ate mouse clicks) ──────────
const BIT_OPTS = [
  { v: 0, label: 'OFF' }, { v: 12, label: '12' },
  { v: 10, label: '10' }, { v: 8, label: '8' }, { v: 6, label: '6' },
];
const RATE_OPTS = [
  { v: 0, label: 'OFF' }, { v: 24000, label: '24k' },
  { v: 16000, label: '16k' }, { v: 12000, label: '12k' }, { v: 8000, label: '8k' },
];

function SampleCell({ o, active, onPick }) {
  return (
    <button
      onClick={() => onPick(o.v)}
      style={{
        height: 16, border: `1px solid ${COL.border}`, borderRadius: 3,
        padding: 0, cursor: 'pointer',
        background: active
          ? `linear-gradient(180deg, ${COL.amber}55, ${COL.caramel}66)`
          : COL.panel,
        color: active ? COL.rust : COL.text,
        fontSize: 8, fontWeight: 700, letterSpacing: '0.03em',
        fontFamily: 'inherit', lineHeight: 1,
      }}>{o.label}</button>
  );
}

function SampleRow({ label, opts, current, onPick, tip }) {
  return (
    <div title={tip} style={{
      display: 'grid',
      gridTemplateColumns: '32px repeat(5, 1fr)',
      gap: 3, alignItems: 'center',
    }}>
      <div style={{
        fontSize: 8, fontWeight: 700, color: COL.muted,
        letterSpacing: '0.10em', textAlign: 'right',
      }}>{label}</div>
      {opts.map(o => (
        <SampleCell key={o.v} o={o} active={current === o.v} onPick={onPick} />
      ))}
    </div>
  );
}

// ── Knob (mirrors the rack's compact knob style) ───────────────────────
function Knob({ label, value, min, max, fmt, onChange, defaultVal, size = 36, tip, tint, labelColor }) {
  const draggingRef = useRef(false);
  const startRef = useRef({ y: 0, v: 0 });
  const norm = (value - min) / (max - min);
  const angle = -135 + norm * 270;

  const onDown = (e) => {
    draggingRef.current = true;
    startRef.current = { y: e.clientY, v: value };
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const dy = startRef.current.y - e.clientY;
      const range = max - min;
      const next = startRef.current.v + (dy / 200) * range;
      onChange(Math.max(min, Math.min(max, next)));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [min, max, onChange]);
  const onDouble = () => { if (defaultVal != null) onChange(defaultVal); };

  return (
    <div title={tip} style={{ display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 2, userSelect: 'none' }}>
      <div onMouseDown={onDown} onDoubleClick={onDouble}
        style={{ width: size, height: size, borderRadius: '50%',
          background: tint
            ? `radial-gradient(circle at 30% 30%, #FFFEF2, ${tint} 72%, ${COL.caramel} 100%)`
            : `radial-gradient(circle at 30% 30%, ${COL.cream}, ${COL.caramel} 72%, ${COL.rust} 100%)`,
          border: `1px solid ${COL.border}`, position: 'relative', cursor: 'ns-resize',
          boxShadow: `inset 0 1px 2px rgba(255,255,255,0.8), 0 1px 4px ${COL.shadow}` }}>
        <div style={{ position: 'absolute', bottom: '50%', left: '50%',
          width: 2, height: size * 0.42,
          background: COL.rust, transformOrigin: '50% 100%',
          transform: `translate(-50%, 0) rotate(${angle}deg)`, borderRadius: 1 }} />
      </div>
      <div style={{
        fontSize: labelColor ? 9 : 7,
        color: labelColor || COL.text,
        letterSpacing: labelColor ? '0.14em' : '0.10em',
        fontWeight: labelColor ? 800 : 700,
        textShadow: labelColor ? '0 1px 2px rgba(0,0,0,0.45)' : 'none'
      }}>{label}</div>
    </div>
  );
}

// Tiny button helper
function btnTiny(active) {
  return {
    padding: '3px 6px', borderRadius: 3, cursor: 'pointer',
    border: `1px solid ${active ? COL.rust : COL.border}`,
    background: active ? `${COL.rust}22` : COL.panel,
    color: active ? COL.rust : COL.text,
    fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
    fontFamily: 'inherit',
  };
}

const CHAR_TIPS = {
  Tape:     'Tape: warm tilt, slow drift, soft top end. The classic warm-glue sound.',
  Cassette: 'Cassette: faster flutter, narrower bandwidth, more saturation. The "boombox" feel.',
  Sampler:  'Sampler: short bandwidth, low flutter, grainy texture. Hardware-sampler character.',
  Radio:    'Radio: cut lows + cut highs, midrange-focused. The AM/transistor feel.',
  Dusty:    'Dusty: heavy tilt, slow swirl on Mix. Old, thick, slightly tired.',
  Slam:     'Slam: hot parallel crush with vibe on, 12-bit @ 12k. Punchy, crunchy, weighted.',
};

// ── Single source of truth for defaults + persisted keys ───────────────
// Every knob/control: its default, its Knob defaultVal, its state init, and
// its persistence payload all derive from this one table. Adding a new
// control = one line here + one setter/effect. No more drift between what
// the knob shows, what state initializes to, and what gets saved.
const DEFAULTS = Object.freeze({
  // Dust/dropouts default to 0 so a freshly loaded plugin is silent —
  // the crackle/stutter generators only start when the user dials them in.
  // Previously dust=0.25 fired an audible crackle every ~0.7s on load.
  // Defaults snapshotted from the on-load screenshot the user approved.
  age: 0.50, drift: 0.28, flutter: 0.28, dust: 0.15, dropouts: 0.10,
  tone: 0.30, width: 1.0, glue: 0.30, texture: 0.50,
  dream: 0.05,
  crush: 0.30, pump: 0.30, compBlend: 0.30, compVibe: false,
  compOff: true, boom: 0.60,
  // SAMPLE block: bits 6..12, rate in Hz. 0 on either = OFF.
  bits: 10, rate: 16000,
  inDb: 0, outDb: 0, mix: 1.0, bypass: false, character: null,
});
const PERSISTED_KEYS = Object.keys(DEFAULTS);

// Macro presets — values applied to the visible knobs when a CHARACTER
// button is clicked. Engine-internal config still comes from
// LOFI_CHARACTERS in the engine; these are the user-facing knob positions
// that match each preset's flavor.
const CHAR_MACROS = {
  // Flutter values halved from original — presets were too seasick.
  // Dust/dropouts defaults reduced so presets aren't tick-heavy on load.
  Tape:     { age:0.40, drift:0.40, flutter:0.15, dust:0.12, dropouts:0.08,
              tone:0.55, width:1.00, glue:0.45, texture:0.30,
              dream:0.10 },
  Cassette: { age:0.55, drift:0.45, flutter:0.28, dust:0.15, dropouts:0.10,
              tone:0.45, width:0.90, glue:0.50, texture:0.40,
              dream:0.10 },
  Sampler:  { age:0.50, drift:0.20, flutter:0.08, dust:0.10, dropouts:0.05,
              tone:0.40, width:0.95, glue:0.55, texture:0.55,
              dream:0.10 },
  Radio:    { age:0.60, drift:0.30, flutter:0.15, dust:0.22, dropouts:0.18,
              tone:0.30, width:0.70, glue:0.60, texture:0.35,
              dream:0.10 },
  Dusty:    { age:0.70, drift:0.50, flutter:0.20, dust:0.28, dropouts:0.20,
              tone:0.35, width:1.00, glue:0.55, texture:0.45,
              dream:0.10 },
  // SLAM — matches the visible knob layout: hot crush, vibe on, boom
  // lifted, bits 12 + rate 12k for sampler bite.
  Slam:     { age:0.55, drift:0.35, flutter:0.28, dust:0.18, dropouts:0.12,
              tone:0.38, width:1.00, glue:0.50, texture:0.55,
              dream:0.10,
              crush:0.65, pump:0.42, compBlend:0.60, compVibe:true,
              boom:0.55, compOff:false,
              bits:12, rate:12000 },
};

// ── Main component ─────────────────────────────────────────────────────
export default function LofiLoofyOrb({
  instanceId, sharedSource, registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState
}) {
  const rawInit = initialState || {};
  // Migration: older saves had dust=0.25 + dropouts=0.15 defaults that
  // trigger audible vinyl crackles and stutters on every load. If a
  // persisted blob matches that exact legacy pair, treat it as stale and
  // fall through to the new silent defaults. User can always dial them
  // back up intentionally — this just prevents surprise ticking on reload.
  const LEGACY_DUST = 0.25, LEGACY_DROP = 0.15;
  const isStaleNoise = rawInit.dust === LEGACY_DUST && rawInit.dropouts === LEGACY_DROP;
  const init = isStaleNoise ? { ...rawInit, dust: 0, dropouts: 0 } : rawInit;
  // Every state initializer reads DEFAULTS — single source of truth.
  const D = DEFAULTS;
  const [age,        setAge]        = useState(init.age        ?? D.age);
  const [drift,      setDrift]      = useState(init.drift      ?? D.drift);
  const [flutter,    setFlutter]    = useState(init.flutter    ?? D.flutter);
  const [dust,       setDust]       = useState(init.dust       ?? D.dust);
  const [dropouts,   setDropouts]   = useState(init.dropouts   ?? D.dropouts);
  const [tone,       setTone]       = useState(init.tone       ?? D.tone);
  const [width,      setWidth]      = useState(init.width      ?? D.width);
  const [glue,       setGlue]       = useState(init.glue       ?? D.glue);
  const [texture,    setTexture]    = useState(init.texture    ?? D.texture);
  const [dream,        setDream]        = useState(init.dream        ?? D.dream);
  const [crush,      setCrush]      = useState(init.crush      ?? D.crush);
  const [pump,       setPump]       = useState(init.pump       ?? D.pump);
  const [compBlend,  setCompBlend]  = useState(init.compBlend  ?? D.compBlend);
  const [compVibe,   setCompVibe]   = useState(init.compVibe   ?? D.compVibe);
  const [boom,       setBoom]       = useState(init.boom       ?? D.boom);
  const [compOff,    setCompOff]    = useState(init.compOff    ?? D.compOff);
  const [bits,       setBits]       = useState(init.bits       ?? D.bits);
  const [rate,       setRate]       = useState(init.rate       ?? D.rate);
  const [inDb,    setInDb]    = useState(init.inDb   ?? D.inDb);
  const [outDb,   setOutDb]   = useState(init.outDb  ?? D.outDb);
  const [mix,     setMix]     = useState(init.mix    ?? D.mix);
  const [bypass,  setBypass]  = useState(init.bypass ?? D.bypass);
  const [character, setCharacter] = useState(init.character ?? D.character);

  // Suppress param-sync effects during preset application so the engine
  // receives one atomic applyBulk() instead of 14 clobbering writes.
  const applyingPresetRef = useRef(false);

  // Visual
  const [inMtr,   setInMtr]   = useState(0);
  const [outMtr,  setOutMtr]  = useState(0);
  const [wobble,  setWobble]  = useState(0);
  const [driftT,  setDriftT]  = useState(0); // slow monotonic clock for cloud-layer drift

  const engineRef = useRef(null);
  const ctx = sharedSource?.ctx;

  // Apply a preset atomically. Set the suppression flag, update all React
  // state, and push one bulk write to the engine so the DSP lands exactly
  // on the macro values — no races between individual setX useEffects.
  const applyCharacter = (name) => {
    const m = CHAR_MACROS[name];
    if (!m) return;
    applyingPresetRef.current = true;
    setCharacter(name);
    setAge(m.age); setDrift(m.drift); setFlutter(m.flutter);
    setDust(m.dust); setDropouts(m.dropouts);
    setTone(m.tone); setWidth(m.width); setGlue(m.glue); setTexture(m.texture);
    setDream(m.dream);
    // Optional comp + sample fields (present on SLAM-style presets only).
    if (m.crush     != null) setCrush(m.crush);
    if (m.pump      != null) setPump(m.pump);
    if (m.compBlend != null) setCompBlend(m.compBlend);
    if (m.compVibe  != null) setCompVibe(m.compVibe);
    if (m.boom      != null) setBoom(m.boom);
    if (m.compOff   != null) setCompOff(m.compOff);
    if (m.bits      != null) setBits(m.bits);
    if (m.rate      != null) setRate(m.rate);
    // Engine gets one atomic pass — character preset first, then overrides.
    engineRef.current?.setCharacter(name);
    engineRef.current?.applyBulk(m);
    // Release suppression after React commits.
    queueMicrotask(() => { applyingPresetRef.current = false; });
  };

  // Wrapped knob setters — clear the active preset highlight whenever
  // the user manually moves a tracked knob (preset no longer matches).
  const editing = (setter) => (v) => { setter(v); setCharacter(null); };
  const setAgeE       = editing(setAge);
  const setDriftE     = editing(setDrift);
  const setFlutterE   = editing(setFlutter);
  const setDustE      = editing(setDust);
  const setDropoutsE  = editing(setDropouts);
  const setToneE      = editing(setTone);
  const setWidthE     = editing(setWidth);
  const setGlueE      = editing(setGlue);
  const setTextureE   = editing(setTexture);
  const setDreamE     = editing(setDream);
  const setCrushE     = editing(setCrush);
  const setPumpE      = editing(setPump);
  const setCompBlendE = editing(setCompBlend);
  const setCompVibeE  = editing(setCompVibe);
  const setBoomE      = editing(setBoom);
  const setCompOffE   = editing(setCompOff);
  const setBitsE      = editing(setBits);
  const setRateE      = editing(setRate);

  // ── Engine create + initial sync ──────────────────────────────────────
  useEffect(() => {
    if (!ctx) return;
    const eng = createLofiLoofyEngine(ctx);
    engineRef.current = eng;

    eng.setIn(Math.pow(10, inDb / 20));
    eng.setOut(Math.pow(10, outDb / 20));
    eng.setMix(mix);
    eng.setAge(age);
    eng.setDrift(drift);
    eng.setFlutter(flutter);
    eng.setDust(dust);
    eng.setDropouts(dropouts);
    eng.setTone(tone);
    eng.setWidth(width);
    eng.setGlue(glue);
    eng.setTexture(texture);
    eng.setDream(dream);
    eng.setCrush(crush);
    eng.setPump(pump);
    eng.setCompBlend(compBlend);
    eng.setCompVibe(compVibe);
    eng.setBoom(boom);
    eng.setCompOff(compOff);
    eng.setBits(bits);
    eng.setRate(rate);
    if (character) eng.setCharacter(character);

    registerEngine?.(instanceId, eng);
    return () => {
      unregisterEngine?.(instanceId, eng);
      eng.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSource]);

  // ── Param sync ────────────────────────────────────────────────────────
  // Each effect early-returns while a preset is being applied — the engine
  // gets the preset via one applyBulk() call in applyCharacter().
  const gated = (fn) => { if (!applyingPresetRef.current) fn(); };
  useEffect(() => gated(() => engineRef.current?.setIn(Math.pow(10, inDb / 20))), [inDb]);
  useEffect(() => gated(() => engineRef.current?.setOut(Math.pow(10, outDb / 20))), [outDb]);
  useEffect(() => gated(() => engineRef.current?.setMix(mix)),       [mix]);
  useEffect(() => gated(() => engineRef.current?.setBypass(bypass)), [bypass]);
  useEffect(() => gated(() => engineRef.current?.setAge(age)),       [age]);
  useEffect(() => gated(() => engineRef.current?.setDrift(drift)),   [drift]);
  useEffect(() => gated(() => engineRef.current?.setFlutter(flutter)),[flutter]);
  useEffect(() => gated(() => engineRef.current?.setDust(dust)),     [dust]);
  useEffect(() => gated(() => engineRef.current?.setDropouts(dropouts)), [dropouts]);
  useEffect(() => gated(() => engineRef.current?.setTone(tone)),     [tone]);
  useEffect(() => gated(() => engineRef.current?.setWidth(width)),   [width]);
  useEffect(() => gated(() => engineRef.current?.setGlue(glue)),     [glue]);
  useEffect(() => gated(() => engineRef.current?.setTexture(texture)), [texture]);
  useEffect(() => gated(() => engineRef.current?.setDream(dream)),   [dream]);
  useEffect(() => gated(() => engineRef.current?.setCrush(crush)),   [crush]);
  useEffect(() => gated(() => engineRef.current?.setPump(pump)),     [pump]);
  useEffect(() => gated(() => engineRef.current?.setCompBlend(compBlend)), [compBlend]);
  useEffect(() => gated(() => engineRef.current?.setCompVibe(compVibe)),   [compVibe]);
  useEffect(() => gated(() => engineRef.current?.setBoom(boom)),           [boom]);
  useEffect(() => gated(() => engineRef.current?.setCompOff(compOff)),     [compOff]);
  useEffect(() => gated(() => engineRef.current?.setBits(bits)),           [bits]);
  useEffect(() => gated(() => engineRef.current?.setRate(rate)),           [rate]);
  useEffect(() => { if (character && !applyingPresetRef.current) engineRef.current?.setCharacter(character); }, [character]);

  // ── State persistence ────────────────────────────────────────────────
  useEffect(() => {
    // Build payload from PERSISTED_KEYS so adding a knob here can never
    // silently drop it from save/reload.
    const values = {
      age, drift, flutter, dust, dropouts, tone, width, glue, texture,
      dream, crush, pump, compBlend, compVibe, compOff, boom, bits, rate,
      inDb, outDb, mix, bypass, character,
    };
    const payload = {};
    for (const k of PERSISTED_KEYS) payload[k] = values[k];
    onStateChange?.(instanceId, payload);
  }, [age, drift, flutter, dust, dropouts, tone, width, glue, texture,
      dream, crush, pump, compBlend, compVibe, compOff, boom, bits, rate, bypass,
      inDb, outDb, mix, character, instanceId, onStateChange]);

  // ── Meter + wobble RAF (throttled ~30fps, change-gated) ──────────────
  useEffect(() => {
    let id, last = 0;
    let lastIn = -1, lastOut = -1, lastWob = -999;
    const tick = (t) => {
      id = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      const e = engineRef.current;
      if (!e) return;
      const i = e.getInputPeak(), o = e.getOutputPeak(), w = e.getDreamValue();
      if (Math.abs(i - lastIn)  > 0.01) { lastIn  = i; setInMtr(i); }
      if (Math.abs(o - lastOut) > 0.01) { lastOut = o; setOutMtr(o); }
      if (Math.abs(w - lastWob) > 0.02) { lastWob = w; setWobble(w); }
      setDriftT(t * 0.001); // seconds — independent cloud drift clock
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Cloud visual scalars (driven by Age + wobble) ────────────────────
  // Vertical-blur amount for the morph filter — gentler so clouds keep
  // definition at high Age. Previous (age*8 + wobble*4) smeared too hard.
  const vBlurAmt = Math.min(age * 3 + Math.abs(wobble) * 1.2, 4);

  // ── Per-path cloud isolation ─────────────────────────────────────────
  // Fetch clouds.svg once, cluster its 2600+ <path>s by spatial region,
  // and wrap each cluster in a <g> with its own CSS animation. Every
  // cluster drifts on a unique phase via animation-delay — no stacked
  // full copies of the image.
  const [cloudsMarkup, setCloudsMarkup] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/clouds.svg').then(r => r.text()).then(text => {
      if (cancelled) return;
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return;
      // Fill the panel edge-to-edge — crop overflow instead of letterboxing.
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      const root = svg.querySelector('g') || svg;

      // Cluster paths by the coordinate of their first M command.
      // CELL defines the bucket size in SVG user units — tune to taste.
      const CELL = 160;
      const groups = new Map();
      const paths = Array.from(svg.querySelectorAll('path'));
      paths.forEach(p => {
        const d = p.getAttribute('d') || '';
        const m = d.match(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/);
        if (!m) return;
        const x = parseFloat(m[1]), y = parseFloat(m[2]);
        const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
        const key = `${gx},${gy}`;
        if (!groups.has(key)) groups.set(key, { cx:(gx+0.5)*CELL, cy:(gy+0.5)*CELL, paths:[] });
        groups.get(key).paths.push(p);
      });

      // Multiple pulse targets — one per visible face-cloud. Each path
      // is assigned to the NEAREST target within its radius, so the
      // face-clouds pulse independently without fighting over paths.
      const vb = (svg.getAttribute('viewBox') || '0 0 2286 1375').split(/\s+/).map(Number);
      const [vx, vy, vw, vh] = vb;
      const minDim = Math.min(vw, vh);
      const PULSE_R = minDim * 0.17;

      // Target positions in viewBox fractions — derived from the visible
      // face-cloud spots. Tweak if a face ends up static.
      const pulseTargets = [
        { x: 0.50, y: 0.50 }, // 0 — central purple
        { x: 0.25, y: 0.40 }, // 1 — pink upper-left
        { x: 0.78, y: 0.38 }, // 2 — blue upper-right
        { x: 0.32, y: 0.72 }, // 3 — pink lower-left
        { x: 0.72, y: 0.72 }, // 4 — white-cream lower-right
        { x: 0.50, y: 0.22 }, // 5 — upper-center band
        { x: 0.50, y: 0.82 }, // 6 — lower-center band
        { x: 0.15, y: 0.55 }, // 7 — mid-left edge
        { x: 0.85, y: 0.55 }, // 8 — mid-right edge
        { x: 0.42, y: 0.62 }, // 9 — lower-mid cluster
        { x: 0.10, y: 0.22 }, // 10 — top-left face
      ].map(t => ({ cx: vx + vw * t.x, cy: vy + vh * t.y }));

      // Assign each path to its nearest target within PULSE_R.
      const pulseAssign = new Map(); // path -> targetIndex
      paths.forEach(p => {
        const d = p.getAttribute('d') || '';
        const m = d.match(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/);
        if (!m) return;
        const x = parseFloat(m[1]), y = parseFloat(m[2]);
        let best = -1, bestDist = PULSE_R;
        pulseTargets.forEach((t, i) => {
          const d2 = Math.hypot(x - t.cx, y - t.cy);
          if (d2 < bestDist) { bestDist = d2; best = i; }
        });
        if (best >= 0) pulseAssign.set(p, best);
      });

      // Re-parent: one <g class="ll-pulse"> holds all pulse paths, each
      // remaining cluster stays static in its own <g>.
      const NS = 'http://www.w3.org/2000/svg';
      paths.forEach(p => p.parentNode && p.parentNode.removeChild(p));

      // One pulse pair (orbit + inner) per target. Each inner group gets
      // its own index-bearing class so it reads its own CSS var.
      const pulseOrbits = pulseTargets.map((t, i) => {
        const orbit = doc.createElementNS(NS, 'g');
        orbit.setAttribute('class', `ll-pulse-orbit ll-pulse-orbit-${i}`);
        orbit.setAttribute('style',
          `transform-box: fill-box; transform-origin: ${t.cx}px ${t.cy}px;`
        );
        const inner = doc.createElementNS(NS, 'g');
        inner.setAttribute('class', `ll-pulse ll-pulse-${i}`);
        inner.setAttribute('style',
          `transform-box: fill-box; transform-origin: ${t.cx}px ${t.cy}px;` +
          // Soft edge so each pulsing cluster blends with the static clouds.
          `filter: blur(0.6px) drop-shadow(0 2px 6px rgba(150,90,130,0.25));`
        );
        orbit.appendChild(inner);
        return { orbit, inner };
      });

      // Re-parent paths: static paths into plain <g>s, pulse paths into
      // their assigned inner group.
      for (const { paths: ps } of groups.values()) {
        const g = doc.createElementNS(NS, 'g');
        ps.forEach(p => {
          const ti = pulseAssign.get(p);
          if (ti != null) pulseOrbits[ti].inner.appendChild(p);
          else g.appendChild(p);
        });
        if (g.childNodes.length) root.appendChild(g);
      }
      // Pulse groups render last so they layer cleanly over neighbours.
      pulseOrbits.forEach(({ orbit }) => root.appendChild(orbit));

      setCloudsMarkup(new XMLSerializer().serializeToString(svg));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Layout ───────────────────────────────────────────────────────────
  const panel = {
    background: COL.panel,
    border: `1px solid ${COL.border}`,
    borderRadius: 4,
    padding: '6px 6px',
    marginBottom: 4,
  };

  return (
    <div style={{
      width: 380, height: 500, boxSizing: 'border-box', padding: 12,
      borderRadius: 5, background: COL.bg, color: COL.text,
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', position: 'relative',
      border: `1px solid ${COL.border}`,
    }}>
      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.10em',
            color: COL.rust }}>LOFI LOOFY</span>
          <div style={{
            display: 'flex', flexDirection: 'column',
            fontSize: 6, color: COL.muted, letterSpacing: '0.25em',
            lineHeight: 1.15, fontWeight: 700,
          }}>
            <span>TEXTURE</span>
            <span>MOVEMENT</span>
            <span>NOSTALGIA</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setBypass(b => !b)}
            title="Bypass — phase-safe"
            style={btnTiny(bypass)}>{bypass ? 'BYP' : 'ON'}</button>
          {onRemove && (
            <button onClick={onRemove} title="Remove from chain"
              style={{ ...btnTiny(false), color: COL.rust }}>✕</button>
          )}
        </div>
      </div>

      {/* ── CLOUDS MORPH + AGE ──
          The "canvas" fills the whole panel (inset: 0, cover-fit sky gradient).
          Each cloud layer drifts on its own phase/speed for an isolated feel. */}
      <div style={{
        ...panel, padding: 0, position: 'relative',
        height: 200, overflow: 'hidden',
        // Sky background fills the canvas — decoupled from the cloud SVG.
        background: `linear-gradient(180deg,
          ${age > 0.5 ? '#FFE0EC' : '#FFF6DA'} 0%,
          ${age > 0.5 ? '#FDD2E1' : '#FFF0E6'} 45%,
          #FFE8F2 100%)`,
      }}>
        {/* Inline vertical-blur filter — stdDeviation.y scales with Age + wobble. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            {/* Compound age-driven distortion:
                1. feTurbulence generates a slow warp field — baseFreq
                   rises with Age so warped scale gets finer.
                2. feDisplacementMap shoves the SVG along the warp at a
                   magnitude that scales with Age (max ~28 px at full).
                3. feGaussianBlur keeps the existing vertical smear. */}
            <filter id="ll-vblur" x="-15%" y="-20%" width="130%" height="140%">
              <feTurbulence
                type="turbulence"
                baseFrequency={(0.008 + age * 0.022).toFixed(4)}
                numOctaves="2"
                seed="3"
                result="warp"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="warp"
                scale={(age * 28).toFixed(2)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="distorted"
              />
              <feGaussianBlur in="distorted" stdDeviation={`0 ${vBlurAmt.toFixed(2)}`} />
            </filter>
          </defs>
        </svg>

        {/* Per-cluster cloud drift keyframes. Each <g class="ll-cloud">
            reads its own --ax / --ay amplitude CSS vars (assigned at
            parse time) so every cloud moves through a unique ellipse. */}
        <style>{`
          /* Per-cluster audio pulse. Each face-cloud reads its own CSS
             var (--ll-pulse-0 .. --ll-pulse-4) set inline from a
             phase-shifted envelope of outMtr, so the faces breathe at
             different times even when the audio is continuous. */
          .ll-pulse     { will-change: transform; transition: transform 220ms cubic-bezier(.4,.0,.3,1); }
          .ll-pulse-0   { transform: scale(calc(1 + var(--ll-pulse-0, 0) * 0.10)); }
          .ll-pulse-1   { transform: scale(calc(1 + var(--ll-pulse-1, 0) * 0.09)); }
          .ll-pulse-2   { transform: scale(calc(1 + var(--ll-pulse-2, 0) * 0.09)); }
          .ll-pulse-3   { transform: scale(calc(1 + var(--ll-pulse-3, 0) * 0.08)); }
          .ll-pulse-4   { transform: scale(calc(1 + var(--ll-pulse-4, 0) * 0.10)); }
          .ll-pulse-5   { transform: scale(calc(1 + var(--ll-pulse-5, 0) * 0.09)); }
          .ll-pulse-6   { transform: scale(calc(1 + var(--ll-pulse-6, 0) * 0.08)); }
          .ll-pulse-7   { transform: scale(calc(1 + var(--ll-pulse-7, 0) * 0.09)); }
          .ll-pulse-8   { transform: scale(calc(1 + var(--ll-pulse-8, 0) * 0.09)); }
          .ll-pulse-9   { transform: scale(calc(1 + var(--ll-pulse-9, 0) * 0.08)); }
          .ll-pulse-10  { transform: scale(calc(1 + var(--ll-pulse-10, 0) * 0.09)); }

          /* Five distinct orbit shapes — circles CW/CCW, horizontal and
             vertical ellipses, and a figure-8. Each cluster maps to a
             different one so no two faces trace the same path. */
          @keyframes ll-orbit-cw {
            0%   { transform: translate( 6px,  0px); }
            25%  { transform: translate( 0px,  6px); }
            50%  { transform: translate(-6px,  0px); }
            75%  { transform: translate( 0px, -6px); }
            100% { transform: translate( 6px,  0px); }
          }
          @keyframes ll-orbit-ccw {
            0%   { transform: translate( 6px,  0px); }
            25%  { transform: translate( 0px, -6px); }
            50%  { transform: translate(-6px,  0px); }
            75%  { transform: translate( 0px,  6px); }
            100% { transform: translate( 6px,  0px); }
          }
          @keyframes ll-orbit-hell { /* horizontal-biased ellipse */
            0%   { transform: translate( 9px,  0px); }
            25%  { transform: translate( 0px,  3px); }
            50%  { transform: translate(-9px,  0px); }
            75%  { transform: translate( 0px, -3px); }
            100% { transform: translate( 9px,  0px); }
          }
          @keyframes ll-orbit-vell { /* vertical-biased ellipse */
            0%   { transform: translate( 3px,  0px); }
            25%  { transform: translate( 0px,  9px); }
            50%  { transform: translate(-3px,  0px); }
            75%  { transform: translate( 0px, -9px); }
            100% { transform: translate( 3px,  0px); }
          }
          @keyframes ll-orbit-fig8 {
            0%   { transform: translate( 7px,  0px); }
            12%  { transform: translate( 4px,  4px); }
            25%  { transform: translate( 0px,  0px); }
            37%  { transform: translate(-4px, -4px); }
            50%  { transform: translate(-7px,  0px); }
            62%  { transform: translate(-4px,  4px); }
            75%  { transform: translate( 0px,  0px); }
            87%  { transform: translate( 4px, -4px); }
            100% { transform: translate( 7px,  0px); }
          }
          .ll-pulse-orbit    { will-change: transform; }
          .ll-pulse-orbit-0  { animation: ll-orbit-cw   11s linear infinite;              animation-delay:  0s; }
          .ll-pulse-orbit-1  { animation: ll-orbit-ccw  13s linear infinite;              animation-delay: -4s; }
          .ll-pulse-orbit-2  { animation: ll-orbit-hell 15s ease-in-out infinite;         animation-delay: -7s; }
          .ll-pulse-orbit-3  { animation: ll-orbit-fig8 12s linear infinite;              animation-delay: -9s; }
          .ll-pulse-orbit-4  { animation: ll-orbit-vell 17s ease-in-out infinite;         animation-delay: -2s; }
          .ll-pulse-orbit-5  { animation: ll-orbit-ccw  14s linear infinite;              animation-delay: -6s; }
          .ll-pulse-orbit-6  { animation: ll-orbit-cw   16s linear infinite;              animation-delay: -1s; }
          .ll-pulse-orbit-7  { animation: ll-orbit-fig8 10s linear infinite;              animation-delay: -8s; }
          .ll-pulse-orbit-8  { animation: ll-orbit-hell 18s ease-in-out infinite;         animation-delay: -3s; }
          .ll-pulse-orbit-9  { animation: ll-orbit-vell 13s ease-in-out infinite;         animation-delay: -12s; }
          .ll-pulse-orbit-10 { animation: ll-orbit-ccw  19s linear infinite;              animation-delay: -5s; }
          .ll-clouds-host > svg { width: 100%; height: 100%; display: block; }
        `}</style>

        {/* Single inline SVG — each cluster animates on its own. Audio
            push + vertical blur are applied at the wrapper level so they
            affect the whole image uniformly without multiplying cost. */}
        {cloudsMarkup && (
          <div
            aria-hidden="true"
            className="ll-clouds-host"
            dangerouslySetInnerHTML={{ __html: cloudsMarkup }}
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // Static zoom past edges so sides never show.
              transform: `scale(1.35)`,
              transformOrigin: '50% 50%',
              // Drives the 5 face-clusters. Each var is outMtr modulated
              // by a slow phase-shifted sine so the faces peak at
              // different moments even during sustained audio. When
              // audio goes silent they all rest at 0.
              ...(() => {
                const t = driftT;
                const rates  = [0.70, 1.15, 0.55, 1.35, 0.90, 0.82, 1.05, 0.62, 1.25, 0.48, 1.00];
                const phases = [0.00, 1.20, 2.40, 3.60, 4.80, 0.70, 2.10, 3.30, 5.00, 1.80, 2.80];
                const vars = {};
                for (let i = 0; i < 11; i++) {
                  const gate = 0.25 + 0.75 * ((Math.sin(t * rates[i] + phases[i]) + 1) * 0.5);
                  vars[`--ll-pulse-${i}`] = (outMtr * gate).toFixed(3);
                }
                return vars;
              })(),
              // Drop shadow deepens as knobs are pushed. `knobEnergy` is a
              // 0..1 blend of the main wear/movement knobs so any of them
              // sinks the clouds further into their own shadow.
              filter: (() => {
                const knobEnergy = Math.min(1,
                  age * 0.45 + dream * 0.20 + texture * 0.15 +
                  dust * 0.10 + drift * 0.05 + flutter * 0.05);
                const shBlur = 2 + knobEnergy * 14;   // px
                const shY    = 1 + knobEnergy * 6;    // px
                const shA    = 0.10 + knobEnergy * 0.45;
                const shadow = `drop-shadow(0 ${shY.toFixed(1)}px ${shBlur.toFixed(1)}px rgba(140,70,95,${shA.toFixed(2)}))`;
                return `${shadow} saturate(${1 - age*0.55}) hue-rotate(${age*-8}deg) sepia(${age*0.35}) url(#ll-vblur)`;
              })(),
              opacity: 0.92,
              willChange: 'transform',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Subtle film-grain overlay — SVG fractal noise at ~10% opacity.
            Sits above the clouds but below the AGE knob so UI stays crisp. */}
        <svg aria-hidden="true" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          // Grain density rises with Age — clean at 0, dense at 1.
          // Base 0.28 keeps the texture always present.
          opacity: 0.28 + age * 0.38,
          mixBlendMode: 'overlay', pointerEvents: 'none',
        }}>
          <filter id="ll-grain">
            {/* Colour-noise grain — no desaturation. Slightly pushed
                saturation so it reads as punchy film grain, not luminance. */}
            <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="2.6" />
          </filter>
          <rect width="100%" height="100%" filter="url(#ll-grain)" />
        </svg>

        {/* Soft vignette / mat overlay — dark olive frame that fades to
            clear at the centre. Multiply-blended so the clouds still
            read through but edges get mood and depth. */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `
            radial-gradient(ellipse 85% 80% at 50% 50%,
              rgba(74,74,66,0.00) 60%,
              rgba(52,50,44,0.20) 88%,
              rgba(28,26,22,0.40) 100%),
            linear-gradient(180deg, rgba(70,68,60,0.04), rgba(40,38,34,0.08))
          `,
          mixBlendMode: 'multiply',
          opacity: 0.55,
          borderRadius: 4,
        }} />

        {/* Wobble indicator dot (top-right) */}
        <div title="Dream LFO motion" style={{
          position: 'absolute', top: 6, right: 8,
          width: 6, height: 6, borderRadius: '50%',
          background: COL.amber,
          opacity: 0.30 + Math.abs(wobble) * 0.7,
          boxShadow: `0 0 ${4 + Math.abs(wobble) * 12}px ${COL.amber}`,
          transition: 'opacity 0.08s linear',
        }} />
        {/* Noise indicator dot (top-left) — blend of Dust (noise bed) +
            Dropouts (stutter activity). Matches what it claims. */}
        <div title="Dust + crackle + dropout activity" style={{
          position: 'absolute', top: 6, left: 8,
          width: 6, height: 6, borderRadius: '50%',
          background: COL.cream,
          opacity: 0.15 + Math.min(1, dust * 0.8 + dropouts * 0.6) * 0.75,
          boxShadow: `0 0 ${2 + dust * 6}px ${COL.cream}`,
        }} />
      </div>

      {/* ── SAMPLE strips (BITS + RATE) — its own panel, clear of overlays ── */}
      <div style={{ ...panel, position: 'relative', zIndex: 50 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <SampleRow label="BITS" opts={BIT_OPTS}  current={bits} onPick={setBitsE}
            tip="Bit-depth quantization. OFF = transparent. 6 bits = brutally crushed." />
          <SampleRow label="RATE" opts={RATE_OPTS} current={rate} onPick={setRateE}
            tip="Sample-rate reduction (lowpass proxy). 12k ≈ SP-1200, 8k ≈ telephone." />
        </div>
      </div>

      {/* ── CHARACTER BUTTONS ── */}
      <div style={panel}>
        <div style={{ display: 'flex', gap: 3 }}>
          {Object.keys(LOFI_CHARACTERS).map(name => {
            const active = character === name;
            return (
              <button key={name}
                onClick={() => active ? setCharacter(null) : applyCharacter(name)}
                title={CHAR_TIPS[name]}
                style={{
                  flex: 1, padding: '4px 0', borderRadius: 3, cursor: 'pointer',
                  border: active ? `1px solid ${COL.rust}` : `1px solid ${COL.border}`,
                  background: active
                    ? `linear-gradient(180deg, ${COL.amber}55, ${COL.caramel}66)`
                    : COL.panel,
                  color: active ? COL.rust : COL.text,
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
                  fontFamily: 'inherit',
                }}>{name.toUpperCase()}</button>
            );
          })}
        </div>
      </div>

      {/* ── MOVEMENT ROW: Drift / Flutter / Dust / Dropouts / Dream ── */}
      <div style={panel}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
          <Knob label="DRIFT"  value={drift}    min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setDriftE} defaultVal={0.35}
            tip="Slow pitch wobble. Low = stable, high = drifting tape. Always musical, never seasick." />
          <Knob label="FLUTTER" value={flutter} min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setFlutterE} defaultVal={0.30}
            tip="Faster pitch shimmer on top of Drift. Adds the cassette-grain feel." />
          <Knob label="DUST"   value={dust}     min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setDustE} defaultVal={0.25}
            tip="Tape hiss + vinyl crackle layer. Sits behind the audio." />
          <Knob label="DROP"   value={dropouts} min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setDropoutsE} defaultVal={0.15}
            tip="Random soft signal dips — no clicks, irregular timing. The 'old tape' moments." />
          <Knob label="DREAM"  value={dream}    min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setDreamE} defaultVal={0.45}
            tip="Dream LFO amount: smooth, lingering modulation routed to the chosen target. Felt more than heard at low values." />
        </div>
      </div>

      {/* ── TONE ROW: Tone / Boom / Width / Age / Texture ── */}
      <div style={panel}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
          <Knob label="TONE"    value={tone}    min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setToneE} defaultVal={0.55}
            tip="Tilt + LP. Low = dark/warm, high = open/bright. Always within lo-fi range." />
          <Knob label="BOOM"    value={boom}    min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setBoomE} defaultVal={0.0}
            tip="Post-comp low shelf at 120 Hz (0 → +8 dB). Adds weight without boosting hiss or reverb." />
          <Knob label="WIDTH"   value={width}   min={0} max={2} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setWidthE} defaultVal={1.0}
            tip="Stereo width (0 = mono, 1 = stereo, 2 = wide). Phase-safe M/S." />
          <Knob label="AGE"     value={age}     min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setAgeE} defaultVal={0.40}
            tip="Master wear macro: soft saturation + highpass + bitcrush with a smoothing LP. Low = clean, high = crushed/aged." />
          <Knob label="TEXTURE" value={texture} min={0} max={1} size={32}
            fmt={v => `${(v*100)|0}`}
            onChange={setTextureE} defaultVal={0.30}
            tip="Subtle grain + transient softening. Sampler-style edge, not distortion." />
        </div>
      </div>

      {/* ── PARALLEL COMP ROW: CompOff / Glue / Crush / Pump / Blend / Vibe ── */}
      <div style={panel}>
        <div style={{
          display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr 44px',
          gap: 3, alignItems: 'center', justifyItems: 'center',
        }}>
          <button
            onClick={() => setCompOffE(!compOff)}
            title="COMP bypass: neutralizes GLUE, CRUSH, PUMP, and the parallel wet leg so you can A/B the comp stage. BOOM stays live."
            style={{
              width: 40, height: 40,
              border: `1px solid ${COL.border}`,
              borderRadius: 4,
              padding: 0,
              cursor: 'pointer',
              background: compOff
                ? `linear-gradient(180deg, ${COL.amber}55, ${COL.caramel}66)`
                : COL.panel,
              color: compOff ? COL.rust : COL.text,
              fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
              fontFamily: 'inherit',
              lineHeight: 1.05,
            }}>{compOff ? 'OFF' : 'COMP'}</button>
          {(() => {
            // Visual disable when COMP bypass is engaged. Wraps GLUE / CRUSH /
            // PUMP / BLEND / VIBE in a dimmed, pointer-events-off shell so
            // it's obvious the stage is inert. BOOM + the COMP button itself
            // stay fully interactive.
            const dim = {
              opacity: compOff ? 0.30 : 1,
              pointerEvents: compOff ? 'none' : 'auto',
              filter: compOff ? 'grayscale(0.35)' : 'none',
              transition: 'opacity 0.15s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            };
            return (<>
              <div style={dim}>
                <Knob label="GLUE"  value={glue}  min={0} max={1} size={32}
                  fmt={v => `${(v*100)|0}`}
                  onChange={setGlueE} defaultVal={0.0}
                  tip="Soft compression for cohesion. Never crushes — just gathers." />
              </div>
              <div style={dim}>
                <Knob label="CRUSH" value={crush} min={0} max={1} size={32}
                  fmt={v => `${(v*100)|0}`}
                  onChange={setCrushE} defaultVal={0.0}
                  tip="Fast FET-style squash with baked-in drive. Audibly colors — not a clean comp." />
              </div>
              <div style={dim}>
                <Knob label="PUMP" value={pump} min={0} max={1} size={32}
                  fmt={v => `${(v*100)|0}`}
                  onChange={setPumpE} defaultVal={0.0}
                  tip="Free-running breathing. Slow rhythmic ducking — no host tempo needed." />
              </div>
              <div style={dim}>
                <Knob label="BLEND" value={compBlend} min={0} max={1} size={32}
                  fmt={v => `${(v*100)|0}`}
                  onChange={setCompBlendE} defaultVal={0.0}
                  tip="Parallel comp mix. Dry ↔ compressed — linear crossfade." />
              </div>
            </>);
          })()}
          <button
            disabled={compOff}
            onClick={() => setCompVibeE(!compVibe)}
            title="VIBE: softens the comp knee, slows the pump, and adds a touch of 2nd-harmonic warmth. Dreamier character."
            style={{
              width: 40, height: 40,
              border: `1px solid ${COL.border}`,
              borderRadius: 4,
              padding: 0,
              cursor: compOff ? 'default' : 'pointer',
              opacity: compOff ? 0.30 : 1,
              filter: compOff ? 'grayscale(0.35)' : 'none',
              transition: 'opacity 0.15s ease',
              background: compVibe
                ? `linear-gradient(180deg, ${COL.amber}55, ${COL.caramel}66)`
                : COL.panel,
              color: compVibe ? COL.rust : COL.text,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              fontFamily: 'inherit',
            }}>VIBE</button>
        </div>
      </div>

      {/* ── BOTTOM: meters + IN/OUT/MIX ── */}
      <div style={{
        ...panel, marginBottom: 0, marginTop: 'auto', padding: '4px 6px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {/* Input meter */}
        <div title="Input level" style={{
          width: 36, height: 6, background: '#F3DDE5', borderRadius: 2,
          overflow: 'hidden', border: `1px solid ${COL.border}`,
        }}>
          <div style={{
            width: `${Math.min(100, inMtr * 140)}%`, height: '100%',
            background: `linear-gradient(90deg, ${COL.cream}, ${COL.amber})`,
          }} />
        </div>
        {/* Output meter */}
        <div title="Output level" style={{
          width: 36, height: 6, background: '#F3DDE5', borderRadius: 2,
          overflow: 'hidden', border: `1px solid ${COL.border}`,
        }}>
          <div style={{
            width: `${Math.min(100, outMtr * 140)}%`, height: '100%',
            background: `linear-gradient(90deg, ${COL.cream}, ${COL.rust})`,
          }} />
        </div>

        {/* IO knobs */}
        <Knob label="IN"  value={inDb}  min={-24} max={12} size={24}
          fmt={v => `${v>=0?'+':''}${v.toFixed(1)}`}
          onChange={setInDb} defaultVal={0}
          tip="Input trim (dB)." />
        <Knob label="OUT" value={outDb} min={-24} max={12} size={24}
          fmt={v => `${v>=0?'+':''}${v.toFixed(1)}`}
          onChange={setOutDb} defaultVal={0}
          tip="Output trim (dB)." />
        <Knob label="MIX" value={mix}   min={0} max={1} size={24}
          fmt={v => `${(v*100)|0}`}
          onChange={setMix} defaultVal={0.5}
          tip="Wet/dry mix. Phase-safe: 0 = full dry, 1 = full wet." />
      </div>
    </div>
  );
}
