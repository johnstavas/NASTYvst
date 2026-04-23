// SandboxToyOrb — Step 2c first sandbox-native brick.
// See memory/sandbox_core_scope.md.
//
// This brick has NO hand-coded DSP. Its audio path is built at mount
// time from the SANDBOX_TOY graph (mockGraphs.js) by
// compileGraphToWebAudio. Knob writes call setParam(nodeId, paramId, v),
// which the compiler routes to the right WebAudio AudioParam.
//
// Visual: minimal panel — three sliders (Drive dB / Cutoff / Mix). The
// brick-zoom view shows the same graph data via OpGraphCanvas, so the
// "what's inside" view is literally the source of truth for what's
// running.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SANDBOX_TOY } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { setLiveGraph, clearLiveGraph } from './liveGraphStore';
import { serializeGraph, deserializeGraph } from './graphIO';

export default function SandboxToyOrb({
  instanceId, sharedSource,
  registerEngine, unregisterEngine,
  onRemove, onStateChange, initialState,
}) {
  const ctx = sharedSource?.ctx;

  const [gainDb, setGainDb] = useState(initialState?.gainDb ?? 0);
  const [cutoff, setCutoff] = useState(initialState?.cutoff ?? 4000);
  const [mix,    setMix]    = useState(initialState?.mix    ?? 0.5);
  const [bypassed, setBypassed] = useState(false);

  const compiledRef = useRef(null);
  const bypassedRef = useRef(false);
  // Holds the setBypass closure so the in-panel BYP button can call the
  // same code path the chain-host pill does. Resolves ST-W-01.
  const setBypassRef = useRef(null);

  // Build audio graph once per mount.
  useEffect(() => {
    if (!ctx) return;
    // Patch initial param values into a fresh graph object so the
    // compiled instance starts in the right state.
    const graph = {
      ...SANDBOX_TOY,
      nodes: SANDBOX_TOY.nodes.map(n => {
        if (n.id === 'n_gain')   return { ...n, params: { ...n.params, gainDb } };
        if (n.id === 'n_filter') return { ...n, params: { ...n.params, cutoff } };
        if (n.id === 'n_mix')    return { ...n, params: { ...n.params, amount: mix } };
        return n;
      }),
    };

    let inst;
    try {
      inst = compileGraphToWebAudio(graph, ctx);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SandboxToy] compile failed:', e);
      return;
    }
    compiledRef.current = inst;

    // Bypass topology is owned by compileGraphToWebAudio. inst.setBypass
    // ramps wetMute/bypassPath inverse over ~5 ms. We mirror the on-state
    // into bypassedRef (panel shows the BYP button state) and expose the
    // same closure via setBypassRef so the in-panel BYP button can call
    // it alongside the chain-host pill.
    const setBypass = (on) => {
      bypassedRef.current = !!on;
      inst.setBypass(on);
    };
    setBypassRef.current = setBypass;

    const engine = {
      input:        inst.inputNode,
      // `output` = last brick → master; `chainOutput` = mid-chain → next.
      // Both share inst.outputNode (the compiled summing bus).
      output:       inst.outputNode,
      chainOutput:  inst.outputNode,
      setBypass,
      dispose:      inst.dispose,
      // Debug surface — exposes the compiled instance so future tooling
      // (T5/T6 conformance, A/B null-test against worklet) can poke at it.
      __sandboxCompiled: inst,
      __graph: graph,
    };

    registerEngine?.(instanceId, engine);

    return () => {
      inst.dispose();
      unregisterEngine?.(instanceId);
      compiledRef.current = null;
      setBypassRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Live param updates → audio chain + the live-graph store (so the
  // brick-zoom view shows current values, not the static template).
  useEffect(() => { compiledRef.current?.setParam('n_gain',   'gainDb', gainDb); }, [gainDb]);
  useEffect(() => { compiledRef.current?.setParam('n_filter', 'cutoff', cutoff); }, [cutoff]);
  useEffect(() => { compiledRef.current?.setParam('n_mix',    'amount', mix);    }, [mix]);

  // Build the current graph object from local state. Memoized so the
  // live-graph effect, the snapshot push, and the export button all
  // share one source of truth.
  const buildCurrentGraph = useCallback(() => ({
    ...SANDBOX_TOY,
    nodes: SANDBOX_TOY.nodes.map(n => {
      if (n.id === 'n_gain')   return { ...n, params: { ...n.params, gainDb } };
      if (n.id === 'n_filter') return { ...n, params: { ...n.params, cutoff } };
      if (n.id === 'n_mix')    return { ...n, params: { ...n.params, amount: mix } };
      return n;
    }),
  }), [gainDb, cutoff, mix]);

  // Push live params on every change.
  useEffect(() => {
    setLiveGraph(instanceId, buildCurrentGraph());
  }, [instanceId, buildCurrentGraph]);

  // ─── Undo / redo stack ──────────────────────────────────────────────
  // Snapshot = { gainDb, cutoff, mix }. Pushed after a 250 ms quiet
  // window to avoid one snapshot per slider tick. Cap at 50 entries.
  const historyRef = useRef({
    stack: [{ gainDb, cutoff, mix }],
    pointer: 0,
    suppressNext: false, // set true when we're applying a snapshot ourselves
  });
  const [historyVersion, setHistoryVersion] = useState(0); // forces re-render of buttons

  useEffect(() => {
    const h = historyRef.current;
    if (h.suppressNext) { h.suppressNext = false; return; }
    const t = setTimeout(() => {
      const last = h.stack[h.pointer];
      if (last && last.gainDb === gainDb && last.cutoff === cutoff && last.mix === mix) return;
      // Truncate any "future" snapshots if user edited after undoing.
      h.stack = h.stack.slice(0, h.pointer + 1);
      h.stack.push({ gainDb, cutoff, mix });
      if (h.stack.length > 50) h.stack.shift();
      h.pointer = h.stack.length - 1;
      setHistoryVersion(v => v + 1);
    }, 250);
    return () => clearTimeout(t);
  }, [gainDb, cutoff, mix]);

  const applySnapshot = (s) => {
    historyRef.current.suppressNext = true;
    setGainDb(s.gainDb);
    setCutoff(s.cutoff);
    setMix   (s.mix);
  };
  const undo = () => {
    const h = historyRef.current;
    if (h.pointer <= 0) return;
    h.pointer -= 1;
    applySnapshot(h.stack[h.pointer]);
    setHistoryVersion(v => v + 1);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.pointer >= h.stack.length - 1) return;
    h.pointer += 1;
    applySnapshot(h.stack[h.pointer]);
    setHistoryVersion(v => v + 1);
  };
  const canUndo = historyRef.current.pointer > 0;
  const canRedo = historyRef.current.pointer < historyRef.current.stack.length - 1;

  // ─── Export / Import (graph.json round-trip) ────────────────────────
  const [ioMsg, setIoMsg] = useState(null); // tiny status line under the buttons
  useEffect(() => {
    if (!ioMsg) return;
    const t = setTimeout(() => setIoMsg(null), 1800);
    return () => clearTimeout(t);
  }, [ioMsg]);

  const exportGraph = async () => {
    try {
      const text = serializeGraph(buildCurrentGraph());
      await navigator.clipboard.writeText(text);
      setIoMsg({ kind: 'ok', text: 'Graph copied to clipboard' });
    } catch (e) {
      setIoMsg({ kind: 'err', text: 'Copy failed: ' + (e.message || e) });
    }
  };

  const importGraph = () => {
    const text = window.prompt('Paste graph.json here:');
    if (!text) return;
    try {
      const { graph, warnings } = deserializeGraph(text);
      // Pull our three known params back into local state. Unknown nodes
      // are tolerated (they live in the JSON but the toy only surfaces
      // the three knobs in the MVP UI).
      const findParam = (nodeId, paramId, fallback) => {
        const n = graph.nodes.find(n => n.id === nodeId);
        return n?.params?.[paramId] ?? fallback;
      };
      historyRef.current.suppressNext = false; // let the snapshot land
      setGainDb(findParam('n_gain',   'gainDb', gainDb));
      setCutoff(findParam('n_filter', 'cutoff', cutoff));
      setMix   (findParam('n_mix',    'amount', mix));
      setIoMsg({
        kind: warnings.length ? 'warn' : 'ok',
        text: warnings.length
          ? `Loaded with ${warnings.length} warning(s)`
          : 'Graph loaded',
      });
    } catch (e) {
      setIoMsg({ kind: 'err', text: e.message });
    }
  };

  // Clear the live entry only on unmount (not on every param change).
  useEffect(() => () => clearLiveGraph(instanceId), [instanceId]);

  // Persist UI state for master preset save/load.
  useEffect(() => {
    onStateChange?.(instanceId, { gainDb, cutoff, mix });
  }, [gainDb, cutoff, mix, instanceId, onStateChange]);

  return (
    <div style={{
      width: '100%', maxWidth: 680, margin: '0 auto',
      padding: '18px 22px',
      background: 'linear-gradient(180deg, rgba(28,34,42,0.95), rgba(14,18,24,0.95))',
      borderRadius: 14,
      border: '1px solid rgba(231,209,155,0.18)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase',
            color: 'rgba(231,209,155,0.7)',
          }}>Sandbox-native · v0</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            SandboxToy
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !bypassed;
                    setBypassed(next);
                    // Call the same setBypass closure the chain-host pill
                    // uses — the button is now functional, not illustrative.
                    setBypassRef.current?.(next);
                  }}
                  style={btnStyle(bypassed)}>
            {bypassed ? 'BYP' : 'ON'}
          </button>
          {onRemove && (
            <button onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    style={btnStyle(false)}>
              ×
            </button>
          )}
        </div>
      </div>

      <Slider label="Gain"   value={gainDb} min={-24} max={24}    step={0.1} onChange={setGainDb}
              format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`} />
      <Slider label="Cutoff" value={cutoff} min={20}  max={20000} step={1}   onChange={setCutoff}
              format={(v) => v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`}
              log />
      <Slider label="Mix"    value={mix}    min={0}   max={1}     step={0.01} onChange={setMix}
              format={(v) => `${Math.round(v * 100)}%`} />

      {/* Toolbar — undo/redo + graph.json IO. Step 2d. */}
      <div style={{
        marginTop: 12, display: 'flex', gap: 6, justifyContent: 'flex-end',
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        <button onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); undo(); }}
                disabled={!canUndo}
                title="Undo last knob change"
                style={toolbarBtn(canUndo)}>↶ UNDO</button>
        <button onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); redo(); }}
                disabled={!canRedo}
                title="Redo"
                style={toolbarBtn(canRedo)}>↷ REDO</button>
        <span style={{ width: 8 }} />
        <button onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); exportGraph(); }}
                title="Copy graph.json to clipboard"
                style={toolbarBtn(true)}>COPY</button>
        <button onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); importGraph(); }}
                title="Paste graph.json"
                style={toolbarBtn(true)}>PASTE</button>
      </div>
      {ioMsg && (
        <div style={{
          marginTop: 6, fontSize: 9, letterSpacing: '0.16em', textAlign: 'right',
          textTransform: 'uppercase',
          color: ioMsg.kind === 'err'  ? 'rgba(255,140,140,0.85)'
              : ioMsg.kind === 'warn' ? 'rgba(255,200,120,0.85)'
                                       : 'rgba(127,255,143,0.85)',
        }}>
          {ioMsg.text}
        </div>
      )}

      <div style={{
        marginTop: 12, padding: '8px 10px', borderRadius: 6,
        background: 'rgba(231,209,155,0.04)',
        border: '1px dashed rgba(231,209,155,0.18)',
        fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'rgba(231,209,155,0.55)', textAlign: 'center',
      }}>
        Audio built from graph.json — double-click to view inside
      </div>
    </div>
  );
}

const toolbarBtn = (enabled) => ({
  fontSize: 9, letterSpacing: '0.18em', fontWeight: 700,
  padding: '5px 10px',
  background: enabled ? 'rgba(231,209,155,0.08)' : 'rgba(255,255,255,0.02)',
  border: '1px solid ' + (enabled ? 'rgba(231,209,155,0.3)' : 'rgba(255,255,255,0.08)'),
  borderRadius: 4,
  color: enabled ? '#e7d19b' : 'rgba(255,255,255,0.25)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontFamily: 'system-ui, sans-serif',
});

const btnStyle = (active) => ({
  fontSize: 9, letterSpacing: '0.18em', fontWeight: 700,
  padding: '6px 10px', minWidth: 36,
  background: active ? 'rgba(231,209,155,0.2)' : 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 4,
  color: active ? '#e7d19b' : 'rgba(255,255,255,0.65)',
  cursor: 'pointer',
});

function Slider({ label, value, min, max, step, onChange, format, log }) {
  // Log slider: re-map [0..1] ↔ [min..max] geometrically for cutoff.
  const toSlider = (v) => log
    ? (Math.log(v / min) / Math.log(max / min))
    : ((v - min) / (max - min));
  const fromSlider = (s) => log
    ? min * Math.pow(max / min, s)
    : min + (max - min) * s;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.55)',
        marginBottom: 4,
      }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#e7d19b' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range" min={0} max={1} step={0.0001}
        value={toSlider(value)}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(fromSlider(parseFloat(e.target.value)))}
        style={{ width: '100%', accentColor: '#e7d19b' }}
      />
    </div>
  );
}
