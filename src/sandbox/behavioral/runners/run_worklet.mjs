// run_worklet.mjs — invoke a worklet op with stimulus, capture float32 output.
//
// L2 behavioral runner — worklet arm. Loads op_<id>.worklet.js from
// src/sandbox/ops/, instantiates the class at the requested sample rate,
// applies declared params, drives the requested input ports with the supplied
// stimulus dict, captures the 'out' (or first declared output) channel.
//
// Universal block-level invariants (per pluginval, paraphrased from
// TestUtilities.cpp):
//   - count NaN, Inf, subnormal samples in every output block
//   - report counts in result; non-zero values become diagnostic in reports
//
// Contract:
//   stim = { audio: Float32Array, cv: Float32Array, ... }   // by port id
//   params = { cutoffScale: 1.0, ... }                       // by param id
//   options = { sampleRate: 48000, blockSize: 256 }
// Returns:
//   { outputs: { out: Float32Array, ... }, blocksProcessed,
//     nanCount, infCount, subnormalCount }

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..', '..', '..', '..');
const opsDir    = resolve(repoRoot, 'src', 'sandbox', 'ops');
const tmpDir    = resolve(repoRoot, 'node_modules', '.behavioral-worklet-cache');

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

// Per-op class cache so we only import each worklet once per process.
const opClassCache = new Map();

async function loadOpClass(opId) {
  if (opClassCache.has(opId)) return opClassCache.get(opId);
  const src = resolve(opsDir, `op_${opId}.worklet.js`);
  const dst = resolve(tmpDir, `op_${opId}.worklet.js`);
  copyFileSync(src, dst);
  const mod = await import(pathToFileURL(dst).href);
  // Find the exported class — convention is {OpName}Op; we accept any class.
  const klass = Object.values(mod).find(v =>
    typeof v === 'function' && v.prototype && typeof v.prototype.process === 'function'
  );
  if (!klass) throw new Error(`run_worklet: no class with .process found in op_${opId}.worklet.js`);
  opClassCache.set(opId, klass);
  return klass;
}

// FLT_MIN for f32 = 1.1754943508222875e-38; values below this and != 0 are subnormal.
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
 * Drive an op through a stimulus end-to-end. All input/output buffers are
 * processed in fixed-size blocks; per-block hooks scan invariants.
 */
export async function runWorklet(opId, params, stim, options = {}) {
  const sr = options.sampleRate || 48000;
  const blockSize = options.blockSize || 256;

  const Klass = await loadOpClass(opId);
  const op = new Klass(sr);

  // Apply declared params (after construction so user values override defaults).
  for (const [pid, v] of Object.entries(params || {})) {
    op.setParam(pid, v);
  }

  // Determine total length from longest input (or fall back to silence length).
  const inPortIds = Object.keys(stim);
  if (inPortIds.length === 0) throw new Error('runWorklet: no stimulus provided');
  const N = Math.max(...inPortIds.map(id => stim[id]?.length || 0));
  if (N === 0) throw new Error('runWorklet: empty stimulus');

  // Determine output port ids from class metadata (static `outputs`) or default to ['out'].
  const outIds = (Klass.outputs && Klass.outputs.length > 0)
    ? Klass.outputs.map(p => p.id)
    : ['out'];
  const outputs = {};
  for (const oid of outIds) outputs[oid] = new Float32Array(N);

  const counts = { nan: 0, inf: 0, subnormal: 0 };
  let blocksProcessed = 0;

  // Reusable per-block views.
  for (let off = 0; off < N; off += blockSize) {
    const blk = Math.min(blockSize, N - off);
    const inputs  = {};
    const outBlk  = {};
    for (const id of inPortIds) {
      const fullBuf = stim[id];
      // Subarray creates a view; if stim shorter than N, pad-by-zero is implicit
      // because the view will return undefined for OOB indices — guard below.
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
