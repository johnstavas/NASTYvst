// run_native.mjs — invoke compiled VST3 via parity_host.exe, capture float32.
//
// L2 native arm. Same interface as run_worklet.mjs — accepts (opId, params,
// stim, options) and returns { outputs, ... }. Internally:
//
//   1. Look up the op's smoke-graph VST3 path from per_op_specs.json
//   2. Load param_ranges.json sidecar to translate raw → normalized [0,1]
//   3. Hash param IDs via JUCE String::hashCode convention
//   4. Write stim WAV to .shagsplug/parity_workspace/behavioral/<opId>/
//   5. Spawn parity_host.exe
//   6. Read output WAV and return as Float32Array
//
// Constraints:
//   - parity_host accepts ONE input WAV. Ops with multiple audio inputs
//     (e.g., compressor cells with audio + cv) cannot run native through this
//     path. Those return { skipped: true, reason: 'multi-input op' }.
//   - VST3 must already be built. Missing builds return { skipped: true }.
//
// Universal NaN/Inf/subnormal scan applied identically to worklet arm
// (paraphrased from pluginval TestUtilities.cpp).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeWav, readWav } from '../../../../scripts/parity_signals.mjs';
import { snapParamValue, rawToNorm } from '../../../../scripts/param_snap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..', '..', '..', '..');
const PARITY_HOST = resolve(repoRoot,
  '.shagsplug/parity_host/build/parity_host_artefacts/Release/parity_host.exe');
const SPECS_PATH = resolve(repoRoot, 'test/fixtures/parity/per_op_specs.json');
const WORKSPACE  = resolve(repoRoot, '.shagsplug/parity_workspace/behavioral');

let specsCache = null;
function loadSpecs() {
  if (specsCache) return specsCache;
  if (!existsSync(SPECS_PATH)) throw new Error(`per_op_specs.json missing at ${SPECS_PATH}`);
  specsCache = JSON.parse(readFileSync(SPECS_PATH, 'utf8'));
  return specsCache;
}

// JUCE String::hashCode (Java-style 31*h + c, int32 → uint32 with top bit cleared).
function juceParamHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return ((h >>> 0) & 0x7FFFFFFF).toString();
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
 * Native runner — same shape as runWorklet.
 *
 * @param {string} opId
 * @param {object} params
 * @param {object} stim    must have exactly ONE audio input port; if multi-port,
 *                          returns { skipped: true, reason }
 * @param {object} options { sampleRate, blockSize }
 * @returns {Promise<{ outputs, blocksProcessed, nanCount, infCount,
 *                     subnormalCount, sampleRate, blockSize, native: true }>}
 */
export async function runNative(opId, params, stim, options = {}) {
  if (!existsSync(PARITY_HOST)) {
    return { skipped: true, outputs: {}, reason: `parity_host.exe not built at ${PARITY_HOST}` };
  }

  const allSpecs = loadSpecs();
  // options.parityKey lets behavioral specs override the per_op_specs.json
  // lookup — necessary when worklet ops compose multiple parity smoke builds
  // (e.g., worklet 'onePole' covers parity 'onePole_lp' AND 'onePole_hp').
  const lookupKey = options.parityKey || opId;
  const opSpec = allSpecs.ops?.[lookupKey];
  if (!opSpec) {
    return { skipped: true, outputs: {}, reason: `no parity-fixture entry for '${lookupKey}'` };
  }

  const vst3Abs = resolve(repoRoot, opSpec.vst3);
  if (!existsSync(vst3Abs)) {
    return { skipped: true, outputs: {}, reason: `VST3 not built at ${opSpec.vst3}` };
  }

  // Single-input constraint.
  const inputIds = Object.keys(stim);
  if (inputIds.length !== 1) {
    return { skipped: true, outputs: {}, reason: `parity_host accepts single input; op stim has ${inputIds.length}` };
  }
  const inputBuf = stim[inputIds[0]];

  const sr = options.sampleRate || opSpec.sr || 48000;
  const blockSize = options.blockSize || opSpec.block || 512;

  // Build native param dict: snap → hash → normalize.
  // Behavioral spec uses bare opParamId keys (e.g., 'cutoff'). Per_op_specs has
  // 'paramRanges' keyed by '<nodeId>__<opParamId>' (e.g., 'n_filter__cutoff').
  // We build a node-prefixed dict by matching tail names.
  const paramRanges = opSpec.paramRanges || {};
  // Also try the param_ranges.json sidecar for richer range info.
  const sidecarPath = resolve(dirname(dirname(dirname(dirname(dirname(vst3Abs))))), 'param_ranges.json');
  let sidecar = null;
  if (existsSync(sidecarPath)) {
    try { sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')); } catch {}
  }
  // Sidecar wins over per_op_specs.json paramRanges — it is generated
  // from the actual codegen at build time, so matches the compiled VST3.
  // per_op_specs entries can drift from VST3 reality (caught by tilt
  // 2026-04-26: spec said gfactor [0.01, 100], VST3 had [0.1, 20]).
  const allRanges = { ...paramRanges, ...(sidecar?.params || {}) };

  const paramKeys = Object.keys(allRanges);
  const hashedParams = {};
  for (const [bareKey, val] of Object.entries(params || {})) {
    // Find the prefixed key whose tail matches this bareKey.
    const fullKey = paramKeys.find(k => k.endsWith(`__${bareKey}`));
    if (!fullKey) continue;  // op may not actually expose this param
    const rng = allRanges[fullKey];
    if (rng?.type && rng.type !== 'number') {
      // Enum/bool: pass through unchanged (parity_host expects raw 0/1/etc).
      hashedParams[juceParamHash(fullKey)] = val;
    } else {
      const snapped = rng ? snapParamValue(val, rng) : val;
      const norm = rng ? rawToNorm(snapped, rng) : val;
      hashedParams[juceParamHash(fullKey)] = norm;
    }
  }

  // Workspace.
  const workDir = resolve(WORKSPACE, opId);
  mkdirSync(workDir, { recursive: true });
  const inWav = resolve(workDir, 'in.wav');
  const outWav = resolve(workDir, 'out.wav');
  const paramsJson = resolve(workDir, 'params.json');
  writeWav(inWav, inputBuf, sr);
  writeFileSync(paramsJson, JSON.stringify(hashedParams, null, 2));

  // Spawn parity_host.
  const res = spawnSync(PARITY_HOST, [
    '--vst3',   vst3Abs,
    '--in',     inWav,
    '--out',    outWav,
    '--sr',     String(sr),
    '--block',  String(blockSize),
    '--params', paramsJson,
  ], { stdio: 'pipe', encoding: 'utf8' });

  if (res.status !== 0) {
    return {
      skipped: false,
      error: `parity_host status=${res.status}; stderr=${(res.stderr || '').slice(0, 500)}`,
      outputs: {},
    };
  }

  const nativeOut = readWav(outWav).samples;
  const counts = { nan: 0, inf: 0, subnormal: 0 };
  scanInvariants(nativeOut, counts);

  // Return shape mirrors runWorklet — outputs.out is the native render.
  const blocksProcessed = Math.ceil(nativeOut.length / blockSize);
  return {
    outputs: { out: nativeOut },
    blocksProcessed,
    nanCount: counts.nan,
    infCount: counts.inf,
    subnormalCount: counts.subnormal,
    sampleRate: sr,
    blockSize,
    native: true,
  };
}
