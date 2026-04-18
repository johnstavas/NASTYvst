// rackEngine.js — QC plugin-chain host.
//
// Purpose: chain arbitrary plugin engines for A/B listening tests:
//
//   src ─► rack.input ─► slot0 ─► slot1 ─► ... ─► rack.output ─► dest
//
// Every slot hosts an engine that conforms to the host contract:
//   { input: AudioNode, output: AudioNode, setBypass(on), dispose() }
// (chainOutput is optional; we fall back to .output.)
//
// Bypass is implemented at the rack level (slot.bypassed skips the slot's
// engine in the routing graph) so it works for engines that don't honour
// their internal setBypass. We still call engine.setBypass(true) when the
// slot is bypassed, so internal state stops processing if supported.
//
// Design choices kept minimal on purpose:
//   - Disconnect-all-then-rewire on every structural change. O(n) slots,
//     negligible for the QC use case, and dodges dangling-connection bugs.
//   - No DSP code here. No engine internals touched. Pure graph plumbing.

export function createRack(ctx) {
  const input  = ctx.createGain();   // rack entry
  const output = ctx.createGain();   // rack exit
  input.gain.value = 1;
  output.gain.value = 1;

  /**
   * Slot shape: the rack treats `kind` as the plugin type id (opaque
   * string) and `version` as one of 'legacy' | 'nu' (also opaque — only
   * used by the UI to label / toggle). Neither is interpreted here;
   * they're just carried through for listSlots().
   *
   * @type {{id:string, kind:string, version:string, engine:any, bypassed:boolean}[]}
   */
  const slots = [];
  let rackBypassed = false;
  let idSeq = 0;

  // Plugin-under-test taps. When putId is non-null, the rewire inserts two
  // unity-gain passthrough nodes around that slot:
  //   ... prevSlot → tapPre → PUT → tapPost → nextSlot ...
  // External code (UI analysers) connects AnalyserNodes to these taps.
  // They are always present so analyser fan-outs survive rewires; only
  // their position in the chain changes.
  const tapPre  = ctx.createGain(); tapPre.gain.value  = 1;
  const tapPost = ctx.createGain(); tapPost.gain.value = 1;
  let putId = null;

  // Edge registry. Every node.connect() the rack performs is recorded
  // here so _disconnectAll() can undo ONLY the rack-created edges.
  //
  // Critical: the old blanket-disconnect form (e.g. engine.input.disconnect())
  // severs every outgoing edge from a node, which destroys the wrapper's
  // internal wiring (e.g. fx.input → AudioWorkletNode inside fxEngine.js),
  // as well as any analyser fan-outs external code attached to tapPre /
  // tapPost. By tracking our own edges and using the targeted form
  // from.disconnect(to), internal and external wiring survive rewires.
  const _edges = []; // [{from, to}, ...]

  function _out(engine) { return engine.chainOutput || engine.output; }

  function _rackConnect(from, to) {
    from.connect(to);
    _edges.push({ from, to });
  }

  function _disconnectAll() {
    for (const e of _edges) {
      try { e.from.disconnect(e.to); } catch {}
    }
    _edges.length = 0;
  }

  function _connectInto(prev, node) { prev.connect(node); return node; }

  // ── Click-safe rewire envelope ────────────────────────────────────────
  // Rewire itself is still synchronous and O(n) slots. The envelope just
  // mutes rack.output for a few ms around the disconnect so the graph
  // mutation lands on a quantum where the output gain is already 0.
  // Architecture unchanged: every public mutator still calls the same
  // _rewire(), just wrapped by _safeRewire() instead of calling it raw.
  const RAMP_MS = 4;            // 4 ms fade — inaudible, covers 1-2 quanta
  let _rewirePending = false;
  function _safeRewire() {
    const t0 = ctx.currentTime;
    const g  = output.gain;
    try {
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(0, t0 + RAMP_MS / 1000);
    } catch {}
    // Coalesce bursts of mutations within one fade window: the first one
    // schedules the actual rewire; subsequent ones just extend the mute.
    if (_rewirePending) return;
    _rewirePending = true;
    setTimeout(() => {
      _rewirePending = false;
      _rewire();
      const t1 = ctx.currentTime;
      try {
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + RAMP_MS / 1000);
      } catch {}
    }, RAMP_MS + 1);
  }

  function _rewire() {
    _disconnectAll();
    if (rackBypassed) { _rackConnect(input, output); return; }

    // Route through only non-bypassed slots. Bypassed slots are skipped in
    // the graph entirely — the engine still exists, just not in the path.
    // If a slot is the current PUT, wrap it: prev → tapPre → slot → tapPost.
    // Every edge goes through _rackConnect so the registry can undo it.
    let prev = input;
    for (const s of slots) {
      if (s.bypassed) continue;
      if (s.id === putId) {
        _rackConnect(prev, tapPre);           prev = tapPre;
        _rackConnect(prev, s.engine.input);   prev = _out(s.engine);
        _rackConnect(prev, tapPost);          prev = tapPost;
      } else {
        _rackConnect(prev, s.engine.input);
        prev = _out(s.engine);
      }
    }
    _rackConnect(prev, output);
  }

  // ---- slot management -----------------------------------------------------

  async function addSlot(kind, factory, meta = {}) {
    // factory: async (ctx) => engine
    // meta.version: 'legacy' | 'nu' (optional; UI metadata only)
    const engine = await factory(ctx);
    const id = `slot_${++idSeq}`;
    slots.push({
      id, kind,
      version: meta.version || 'legacy',
      engine, bypassed: false,
    });
    _safeRewire();
    return id;
  }

  /**
   * Replace the engine in an existing slot without disturbing the rest of
   * the chain. Used by the PUT version-toggle (legacy ↔ nu) and by the
   * "Approve new" action when the current PUT is still on the legacy
   * version. The slot id is preserved, so PUT selection and position stay
   * put; only the engine instance changes.
   */
  async function replaceSlot(id, factory, meta = {}) {
    const s = slots.find(x => x.id === id);
    if (!s) return false;
    const oldEngine = s.engine;
    const newEngine = await factory(ctx);
    s.engine  = newEngine;
    if (meta.version) s.version = meta.version;
    _safeRewire();
    // Dispose the displaced engine after the mute window so its tail
    // doesn't get cut mid-fade (same policy as removeSlot).
    setTimeout(() => { try { oldEngine.dispose?.(); } catch {} }, 20);
    return true;
  }

  function removeSlot(id) {
    const i = slots.findIndex(s => s.id === id);
    if (i < 0) return false;
    const [s] = slots.splice(i, 1);
    _safeRewire();
    // Defer dispose until after the mute window so we don't cut a tail
    // mid-ramp on engines that hold internal delay/reverb state.
    setTimeout(() => { try { s.engine.dispose?.(); } catch {} }, 20);
    return true;
  }

  function moveSlot(id, delta) {
    const i = slots.findIndex(s => s.id === id);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(slots.length - 1, i + delta));
    if (i === j) return false;
    const [s] = slots.splice(i, 1);
    slots.splice(j, 0, s);
    _safeRewire();
    return true;
  }

  function setSlotBypass(id, on) {
    const s = slots.find(x => x.id === id);
    if (!s) return false;
    s.bypassed = !!on;
    try { s.engine.setBypass?.(!!on); } catch {}
    _safeRewire();
    return true;
  }

  function setRackBypass(on) {
    rackBypassed = !!on;
    _safeRewire();
  }

  function listSlots() {
    return slots.map(s => ({
      id: s.id, kind: s.kind, version: s.version,
      bypassed: s.bypassed, engine: s.engine,
    }));
  }

  function dispose() {
    _disconnectAll();
    for (const s of slots) { try { s.engine.dispose?.(); } catch {} }
    slots.length = 0;
    try { input.disconnect(); } catch {}
    try { output.disconnect(); } catch {}
  }

  function setPUT(id) {
    // null clears. Only accept ids that exist.
    if (id && !slots.find(s => s.id === id)) return false;
    putId = id || null;
    _safeRewire();
    return true;
  }
  function getPUT() { return putId; }

  // ── Initial wiring ────────────────────────────────────────────────────
  // Without this, an empty chain leaves rack.input disconnected from
  // rack.output and no audio reaches ctx.destination. _rewire() with zero
  // slots correctly wires input→output as a passthrough. Using the raw
  // _rewire (not _safeRewire) here because no audio can be playing yet
  // and there is nothing to fade.
  _rewire();
  try {
    console.log('[rack] constructed. graph:',
      { input, output, tapPre, tapPost },
      'input→output passthrough active (empty chain)');
  } catch {}

  return {
    input, output,
    tapPre, tapPost,
    addSlot, replaceSlot, removeSlot, moveSlot,
    setSlotBypass, setRackBypass,
    setPUT, getPUT,
    listSlots,
    dispose,
  };
}
