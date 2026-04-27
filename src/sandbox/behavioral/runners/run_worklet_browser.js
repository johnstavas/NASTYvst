// run_worklet_browser.js — browser-side worklet runner.
//
// Mirror of run_worklet.mjs but drops Node `fs`/`path`/`url` so it imports
// cleanly from React. Uses Vite's import.meta.glob to make every
// op_*.worklet.js loadable via dynamic import without filesystem access.
//
// Same contract as the .mjs version:
//   stim     = { audio: Float32Array, cv: Float32Array, ... } by port id
//   params   = { paramId: value, ... }
//   options  = { sampleRate, blockSize, workletOpId? }
// Returns:
//   { outputs, blocksProcessed, nanCount, infCount, subnormalCount,
//     sampleRate, blockSize }

// Vite glob import — eager:false means each module is loaded on demand.
// The path string passes through Vite's resolver so this works in dev
// (HMR) and prod (rollup chunking) identically.
const opModules = import.meta.glob('../../ops/op_*.worklet.js');

const opClassCache = new Map();

async function loadOpClass(opId) {
  if (opClassCache.has(opId)) return opClassCache.get(opId);
  const key = `../../ops/op_${opId}.worklet.js`;
  const importer = opModules[key];
  if (!importer) {
    throw new Error(`run_worklet_browser: no worklet found for op_${opId}.worklet.js`);
  }
  const mod = await importer();
  const klass = Object.values(mod).find(v =>
    typeof v === 'function' && v.prototype && typeof v.prototype.process === 'function'
  );
  if (!klass) throw new Error(`run_worklet_browser: no class with .process found in op_${opId}.worklet.js`);
  opClassCache.set(opId, klass);
  return klass;
}

const FLT_MIN = 1.1754943508222875e-38;

function scanInvariants(buf, counts) {
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i];
    if (Number.isNaN(s)) counts.nan++;
    else if (!Number.isFinite(s)) counts.inf++;
    else if (s !== 0 && Math.abs(s) < FLT_MIN) counts.subnormal++;
  }
}

/**
 * Drive an op through a stimulus end-to-end. Same shape as run_worklet.mjs.
 */
export async function runWorkletBrowser(opId, params, stim, options = {}) {
  const sr = options.sampleRate || 48000;
  const blockSize = options.blockSize || 256;

  const workletId = options.workletOpId || opId;
  const Klass = await loadOpClass(workletId);
  const op = new Klass(sr);

  for (const [pid, v] of Object.entries(params || {})) {
    op.setParam(pid, v);
  }

  const inPortIds = Object.keys(stim);
  if (inPortIds.length === 0) throw new Error('runWorkletBrowser: no stimulus provided');
  const N = Math.max(...inPortIds.map(id => stim[id]?.length || 0));
  if (N === 0) throw new Error('runWorkletBrowser: empty stimulus');

  const outIds = (Klass.outputs && Klass.outputs.length > 0)
    ? Klass.outputs.map(p => p.id)
    : ['out'];
  const outputs = {};
  for (const oid of outIds) outputs[oid] = new Float32Array(N);

  const counts = { nan: 0, inf: 0, subnormal: 0 };
  let blocksProcessed = 0;

  for (let off = 0; off < N; off += blockSize) {
    const blk = Math.min(blockSize, N - off);
    const inputs = {};
    const outBlk = {};
    for (const id of inPortIds) {
      const fullBuf = stim[id];
      inputs[id] = fullBuf && fullBuf.length > off
        ? fullBuf.subarray(off, off + blk)
        : new Float32Array(blk);
    }
    for (const oid of outIds) {
      outBlk[oid] = outputs[oid].subarray(off, off + blk);
    }
    op.process(inputs, outBlk, blk);
    for (const oid of outIds) scanInvariants(outBlk[oid], counts);
    blocksProcessed++;
  }

  return {
    outputs,
    blocksProcessed,
    nanCount: counts.nan,
    infCount: counts.inf,
    subnormalCount: counts.subnormal,
    sampleRate: sr,
    blockSize,
  };
}

/** List every op id we have a worklet module for. */
export function listOpIds() {
  return Object.keys(opModules)
    .map(p => p.match(/op_(.+)\.worklet\.js$/)?.[1])
    .filter(Boolean)
    .sort();
}
