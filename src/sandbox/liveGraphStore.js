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
