// Live-graph store — Step 2c addendum.
// See memory/sandbox_core_scope.md.
//
// Sandbox-native bricks write their *current* graph (with live param
// values) here, keyed by instance id. BrickZoomView reads from here so
// its visual reflects what the audio is actually doing, not the static
// template the brick was instantiated from.
//
// This is a stop-gap for Step 2c. In Step 2d the brick's graph becomes
// real persisted state (graph.json round-trip + undo) and this module
// either becomes the canonical store or gets replaced by it.

const live = new Map();          // instanceId → graph object
const subs = new Map();          // instanceId → Set<callback>
const setters = new Map();       // instanceId → setParam(nodeId, paramId, value) function

export function setLiveGraph(instanceId, graph) {
  live.set(instanceId, graph);
  const set = subs.get(instanceId);
  if (set) for (const cb of set) cb(graph);
}

export function getLiveGraph(instanceId) {
  return live.get(instanceId) || null;
}

export function clearLiveGraph(instanceId) {
  live.delete(instanceId);
  const set = subs.get(instanceId);
  if (set) for (const cb of set) cb(null);
}

/** Subscribe to live-graph updates for a given instance. Returns an
 *  unsubscribe function. Used by BrickZoomView to re-render when knob
 *  values change in the parent brick. */
export function subscribeLiveGraph(instanceId, cb) {
  let set = subs.get(instanceId);
  if (!set) { set = new Set(); subs.set(instanceId, set); }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) subs.delete(instanceId);
  };
}

/** Register a per-instance setParam dispatcher. Each sandbox-native orb
 *  calls this on compile so BrickZoomView can mutate node params live
 *  via direct setParam (bypassing the panel knobs).
 *  fn signature: (nodeId, paramId, value) => void */
export function setLiveSetParam(instanceId, fn) {
  setters.set(instanceId, fn);
}

export function getLiveSetParam(instanceId) {
  return setters.get(instanceId) || null;
}

export function clearLiveSetParam(instanceId) {
  setters.delete(instanceId);
}

// ─── Edit layout (session-scope draft) ───────────────────────────────
//
// Per-instance state for the inside-view editor:
//   { nodes:     { [nodeId]: { x, y } },
//     terminals: { [terminalId]: { x, y } },
//     overrides: { [nodeId]: { [paramId]: value } },
//     dirty:     boolean  ← unsaved changes since the last commit
//     committed: { ...same shape as the top-level fields, snapshot of last save }
//   }
//
// Lives in memory only — survives close/reopen of the inside-view within
// a session. Save button copies the live edits into `committed`. Full
// across-app-reload persistence (round-trip into the orb's parent state
// via onStateChange + initialState.editLayout) is a follow-up.

const editLayouts = new Map();    // instanceId → editLayout object
const layoutSubs  = new Map();    // instanceId → Set<callback>

function notifyLayoutChange(instanceId) {
  const set = layoutSubs.get(instanceId);
  if (!set) return;
  const layout = editLayouts.get(instanceId);
  for (const cb of set) cb(layout);
}

function ensureLayout(instanceId) {
  let l = editLayouts.get(instanceId);
  if (!l) {
    l = { nodes: {}, terminals: {}, overrides: {}, dirty: false, committed: null };
    editLayouts.set(instanceId, l);
  }
  return l;
}

export function getEditLayout(instanceId) {
  return editLayouts.get(instanceId) || null;
}

/** Update a node's position. Auto-flags the layout as dirty. */
export function setEditNodePos(instanceId, nodeId, x, y) {
  const l = ensureLayout(instanceId);
  l.nodes = { ...l.nodes, [nodeId]: { x, y } };
  l.dirty = true;
  notifyLayoutChange(instanceId);
}

/** Update a terminal's position. */
export function setEditTerminalPos(instanceId, terminalId, x, y) {
  const l = ensureLayout(instanceId);
  l.terminals = { ...l.terminals, [terminalId]: { x, y } };
  l.dirty = true;
  notifyLayoutChange(instanceId);
}

/** Set a per-node param override. */
export function setEditOverride(instanceId, nodeId, paramId, value) {
  const l = ensureLayout(instanceId);
  const cur = l.overrides[nodeId] || {};
  l.overrides = { ...l.overrides, [nodeId]: { ...cur, [paramId]: value } };
  l.dirty = true;
  notifyLayoutChange(instanceId);
}

/** Snapshot current edits into `committed`. Clears the dirty flag. */
export function commitEditLayout(instanceId) {
  const l = ensureLayout(instanceId);
  l.committed = {
    nodes:     { ...l.nodes },
    terminals: { ...l.terminals },
    overrides: JSON.parse(JSON.stringify(l.overrides)),
  };
  l.dirty = false;
  notifyLayoutChange(instanceId);
}

/** Subscribe to layout updates (BrickZoomView uses this to render the
 *  dirty indicator + SAVE button state). */
export function subscribeEditLayout(instanceId, cb) {
  let set = layoutSubs.get(instanceId);
  if (!set) { set = new Set(); layoutSubs.set(instanceId, set); }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) layoutSubs.delete(instanceId);
  };
}
