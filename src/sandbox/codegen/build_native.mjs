// build_native.mjs — Phase 1 orchestrator.
//
//   graph.json  → validate → PCOF → render → cmake configure → cmake build → .vst3
//
// Per memory/codegen_pipeline_buildout.md § 4.3.
//
// Usage:
//   node src/sandbox/codegen/build_native.mjs <path/to/graph.json>

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateGraph, buildPCOF, validatePCOF, OPS } from './pcof_builder.mjs';
import { renderTemplate } from './render_native.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..', '..', '..');
const tplDir    = resolve(__dirname, 'templates');
const opsDir    = resolve(__dirname, '..', 'ops');

// ── arg parse ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('usage: node build_native.mjs <graph.json> [--no-build]');
  process.exit(2);
}
const noBuild  = argv.includes('--no-build');
const graphArg = argv.find(a => !a.startsWith('--'));
const graphPath = resolve(graphArg);

// ── helpers ───────────────────────────────────────────────────────────────
function sanitizeIdent(s) {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}
function camelCap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function projectNameFrom(graphId) {
  // e.g. "smoke-gain-v0" → "SmokeGainV0"
  return graphId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(camelCap)
    .join('');
}
function fourCharCode(s, fallback) {
  // VST3 ClassUID is hashed from PLUGIN_MANUFACTURER_CODE + PLUGIN_CODE,
  // so PLUGIN_CODE MUST be unique per plugin or the host dedupes them.
  // Strategy: 1 leading initial from PROJECT_NAME + 3 base-36 chars from
  // an FNV-1a hash of the FULL graph.id. The hash sees every character
  // (including lowercase), so "SmokeSignV0" vs "SmokeScalebyV0" can never
  // collide — even when their PascalCase initialisms ("SSV0") match.
  const cleaned = (s || '').replace(/[^A-Za-z0-9]/g, '') || (fallback || 'Plug');
  const initial = cleaned[0].toUpperCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < cleaned.length; i++) {
    h ^= cleaned.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // 3 base-36 chars from the hash (low/mid/high 11-bit slices).
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let pad = '';
  for (let i = 0; i < 3; i++) {
    pad += alphabet[(h >>> (i * 11)) % alphabet.length];
  }
  return initial + pad;
}

function findVst3(buildDir) {
  // walk buildDir looking for *.vst3 (a directory bundle on Windows)
  const out = [];
  function walk(d) {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      const st   = statSync(full);
      if (st.isDirectory()) {
        if (e.endsWith('.vst3')) out.push(full);
        else walk(full);
      }
    }
  }
  walk(buildDir);
  return out;
}

// ── load + validate ──────────────────────────────────────────────────────
console.log(`[build_native] graph: ${graphPath}`);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));

const valRes = validateGraph(graph);
if (!valRes.ok) {
  console.error('[build_native] T6 validateGraph FAILED:');
  for (const e of valRes.errors || []) console.error(`  - ${e.message || JSON.stringify(e)}`);
  process.exit(1);
}
console.log(`[build_native] T6 validateGraph OK (${(valRes.warnings || []).length} warnings)`);

const pcof = buildPCOF(graph);
const pcofRes = validatePCOF(pcof);
if (!pcofRes.ok) {
  console.error('[build_native] PCOF validation FAILED:');
  for (const e of pcofRes.errors || []) console.error(`  - ${e.message || JSON.stringify(e)}`);
  process.exit(1);
}
console.log(`[build_native] PCOF OK (${pcof.nodes.length} nodes, ${pcof.buffers.length} buffers, ${pcof.feedbackEdges.length} fb)`);

// ── derive project metadata ──────────────────────────────────────────────
// BUILD_SUFFIX: compact UTC stamp (YYMMDDhhmm) appended to PROJECT_NAME.
// This makes every build a DISTINCT plugin from the host's POV:
//   • unique .vst3 filename → no LNK1104 when Reaper holds prior build open
//   • unique VST3 ClassUID  → no Reaper plugin-cache collision
//   • visible in Reaper's plugin list → user always knows which build they
//     loaded (e.g. "SmokeDriveV0_2604251530")
// Old builds remain on disk until manually deleted; pick the latest by name.
const BUILD_SUFFIX = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
})();
const PROJECT_NAME_BASE = projectNameFrom(graph.id || 'Plugin');
const PROJECT_NAME = `${PROJECT_NAME_BASE}_${BUILD_SUFFIX}`;
const COMPANY_NAME = 'Stavas';
const BUNDLE_ID    = `com.stavas.${(graph.id || 'plugin').replace(/[^a-z0-9]/gi, '').toLowerCase()}.${BUILD_SUFFIX}`;
const PLUGIN_MANUFACTURER_CODE = 'Stav';
const PLUGIN_CODE  = fourCharCode(PROJECT_NAME, 'Plug');

// ── canonicalize one (op-param spec, raw value) → numeric value ──────────
// Phase 3 Tier A2: bool + enum params canonicalized to floats so APVTS can
// own them as AudioParameterFloat just like number params. The op C++ side
// already takes a numeric setParam(id, double v), so this is the bridge.
function canonParam(p, raw) {
  if (p.type === 'bool') {
    if (raw === true || raw === 1 || raw === '1' || raw === 'true') return 1;
    return 0;
  }
  if (p.type === 'enum') {
    const opts = p.options || [];
    // Allow raw to be either the string value or a numeric index.
    if (typeof raw === 'number') return Math.max(0, Math.min(opts.length - 1, raw | 0));
    const idx = opts.findIndex(o => o.value === raw);
    return idx >= 0 ? idx : 0;
  }
  // number (default)
  return Number(raw);
}
function paramRange(p) {
  if (p.type === 'bool') return { min: 0, max: 1, step: 1 };
  if (p.type === 'enum') return { min: 0, max: Math.max(0, (p.options || []).length - 1), step: 1 };
  return { min: Number(p.min), max: Number(p.max), step: Number(p.step ?? 0.0001) };
}

// ── compute apvtsParams (UI-bound knobs/sliders/buttons/choices) ─────────
const apvtsParams = [];
for (const n of pcof.nodes) {
  const opSpec = OPS[n.op];
  if (!opSpec) throw new Error(`unknown op ${n.op}`);
  for (const p of (opSpec.params || [])) {
    if (p.type !== 'number' && p.type !== 'bool' && p.type !== 'enum') continue;
    const raw = (n.params && n.params[p.id] !== undefined) ? n.params[p.id] : p.default;
    const valueDefault = canonParam(p, raw);
    const r = paramRange(p);
    const ui = p.ui || (p.type === 'bool' ? 'toggle' : (p.type === 'enum' ? 'choice' : 'knob'));
    apvtsParams.push({
      paramId   : sanitizeIdent(`${n.id}__${p.id}`),
      nodeId    : n.id,
      opParamId : p.id,
      label     : p.label || p.id,
      min       : r.min.toFixed(4),
      max       : r.max.toFixed(4),
      step      : r.step.toFixed(4),
      default   : Number(valueDefault).toFixed(4),
      ui,
    });
  }
}

// ── compute per-node renderer fields ─────────────────────────────────────
function bufExpr(idx) { return `scratch_[${idx}].data()`; }

function callExprFor(node) {
  const opSpec = OPS[node.op];
  // Each input port → expression (nullptr | bufExpr | error if multi-fanin in Phase 1)
  const inExprs = opSpec.ports.inputs.map(p => {
    const portRec = node.inputs.find(ii => ii.port === p.id);
    const sources = portRec ? portRec.sources : [];
    if (sources.length === 0) return 'nullptr';
    if (sources.length === 1) return bufExpr(sources[0].bufferIdx);
    throw new Error(`Phase 1: multi-fanin on ${node.id}.${p.id} not yet supported (have ${sources.length})`);
  });
  const outExprs = opSpec.ports.outputs.map(p => {
    const out = node.outputs.find(oo => oo.port === p.id);
    return bufExpr(out.bufferIdx);
  });
  return `${node.id}_[ch]->process(${[...inExprs, ...outExprs, 'N'].join(', ')});`;
}

const nodes = pcof.nodes.map(n => {
  const opSpec = OPS[n.op];
  const paramSet = (opSpec.params || [])
    .filter(p => p.type === 'number' || p.type === 'bool' || p.type === 'enum')
    .map(p => {
      const raw = (n.params && n.params[p.id] !== undefined) ? n.params[p.id] : p.default;
      return { k: p.id, v: Number(canonParam(p, raw)).toFixed(6) };
    });
  return {
    id       : n.id,
    op       : n.op,
    opStruct : `${camelCap(n.op)}Op`,
    callExpr : callExprFor(n),
    paramSet,
  };
});

// Input/output terminals.
const inputTerminals  = pcof.terminals.inputs.map(t => ({ id: t.id, bufferIdx: t.bufferIdx }));
const outputTerminals = pcof.terminals.outputs.map(t => ({
  id: t.id,
  sources: (t.sources || []).map(s => ({ bufferIdx: s.bufferIdx })),
}));

// ── compute presets (UI-mode: presets-only) ──────────────────────────────
// Each preset becomes a button on the editor. Click → set every APVTS
// parameter to the preset's value (normalized [0,1]). Internal sidechain
// params can be locked here at recipe-author-vetted values, eliminating
// the "10 knobs the user can break" problem.
const uiMode = (graph.ui && graph.ui.mode) || 'knobs';
const apvtsByFullId = Object.fromEntries(apvtsParams.map(p => [p.paramId, p]));
const presets = (graph.presets || []).map(preset => {
  const paramSettings = [];
  for (const [fullId, raw] of Object.entries(preset.params || {})) {
    const ap = apvtsByFullId[fullId];
    if (!ap) {
      console.warn(`[build_native] preset '${preset.id}' references unknown param '${fullId}' — skipping`);
      continue;
    }
    const min = parseFloat(ap.min), max = parseFloat(ap.max);
    const norm = (Number(raw) - min) / (max - min);
    const normClamped = Math.max(0, Math.min(1, norm));
    paramSettings.push({ paramId: ap.paramId, normValue: normClamped.toFixed(6) });
  }
  return { id: preset.id, label: preset.label, paramSettings };
});
const defaultPresetId = (graph.ui && graph.ui.defaultPreset) || (presets[0] && presets[0].id) || null;

// userKnobs: in presets-only mode, the buttons lock most params. This
// whitelist keeps a few specific ones user-adjustable (e.g. an output TRIM
// knob alongside the preset buttons). Resolved against apvtsParams entries.
const userKnobsList = (graph.ui && graph.ui.userKnobs) || [];
const userKnobs = userKnobsList.map(uk => {
  const ap = apvtsByFullId[uk.paramId];
  if (!ap) {
    console.warn(`[build_native] userKnobs references unknown param '${uk.paramId}' — skipping`);
    return null;
  }
  return { ...ap, label: uk.label || ap.label };
}).filter(Boolean);

// ── compute editor footprint ─────────────────────────────────────────────
const knobCount    = apvtsParams.length;
const editorWidth  = uiMode === 'presets-only'
  ? 480
  : Math.max(360, 120 + 100 * knobCount + 96);
const editorHeight = uiMode === 'presets-only' ? (userKnobs.length > 0 ? 320 : 240) : 280;

// BUILD_TAG — UTC timestamp baked into the editor so the user can confirm
// at a glance which build Reaper actually loaded (defeats stale-cache
// confusion when DSP changes don't seem to take effect).
const BUILD_TAG = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
})();

const ctx = {
  PROJECT_NAME, COMPANY_NAME, BUNDLE_ID, PLUGIN_MANUFACTURER_CODE, PLUGIN_CODE,
  GRAPH_ID: graph.id,
  BUILD_TAG,
  apvtsParams,
  nodes,
  inputTerminals,
  outputTerminals,
  numBuffers: pcof.buffers.length,
  editorWidth,
  editorHeight,
  uiMode,
  presetsMode: uiMode === 'presets-only',  // boolean for Jinja-subset engine
  presets,
  defaultPresetId,
  userKnobs,
};

// ── workspace ────────────────────────────────────────────────────────────
const workDir   = resolve(repoRoot, '.shagsplug', graph.id || 'plugin');
const codegenDir = resolve(workDir, 'codegen');
const buildDir   = resolve(workDir, 'build');
mkdirSync(resolve(codegenDir, 'src', 'ops'), { recursive: true });

console.log(`[build_native] workspace: ${workDir}`);
console.log(`[build_native] PROJECT_NAME=${PROJECT_NAME} CODE=${PLUGIN_CODE} params=${knobCount} build=${BUILD_TAG}`);

// ── render templates ─────────────────────────────────────────────────────
function renderTo(tplName, outRel) {
  const tpl  = readFileSync(resolve(tplDir, tplName), 'utf8');
  const text = renderTemplate(tpl, ctx);
  const outPath = resolve(codegenDir, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  console.log(`  rendered ${outRel}  (${text.length} B)`);
}

renderTo('CMakeLists.txt.jinja',     'CMakeLists.txt');
renderTo('PluginProcessor.h.jinja',  'src/PluginProcessor.h');
renderTo('PluginProcessor.cpp.jinja','src/PluginProcessor.cpp');
renderTo('MasterGraph.h.jinja',      'src/MasterGraph.h');
renderTo('MasterGraph.cpp.jinja',    'src/MasterGraph.cpp');
renderTo('PluginEditor.h.jinja',     'src/PluginEditor.h');
renderTo('PluginEditor.cpp.jinja',   'src/PluginEditor.cpp');

// Render per-node op headers from src/sandbox/ops/op_<op>.cpp.jinja
for (const n of nodes) {
  const opTplPath = resolve(opsDir, `op_${n.op}.cpp.jinja`);
  if (!existsSync(opTplPath)) {
    console.error(`[build_native] missing op template ${opTplPath}`);
    process.exit(1);
  }
  const tpl   = readFileSync(opTplPath, 'utf8');
  const text  = renderTemplate(tpl, { node_id: n.id, graph_id: graph.id });
  const out   = resolve(codegenDir, 'src', 'ops', `op_${n.id}.h`);
  writeFileSync(out, text);
  console.log(`  rendered ops/op_${n.id}.h  (${text.length} B)`);
}

// ── PCOF dump for traceability ───────────────────────────────────────────
writeFileSync(resolve(workDir, 'pcof.json'), JSON.stringify(pcof, null, 2));

// ── param_ranges.json sidecar ────────────────────────────────────────────
// Mirrors the APVTS ranges the plugin actually exposes. Consumed by
// scripts/check_native_parity.mjs (via param_snap.mjs) so spec values are
// snapped to the float32-quantized values the plugin truly sees, removing
// the precision class that forced cherry-picked dyadic test values for SVF.
const paramRangesSidecar = {
  graphId: graph.id,
  projectName: PROJECT_NAME,
  params: Object.fromEntries(apvtsParams.map(p => {
    // recover the per-op spec to find the original type
    const node = pcof.nodes.find(n => n.id === p.nodeId);
    const opSpec = node ? OPS[node.op] : null;
    const pSpec  = opSpec ? (opSpec.params || []).find(pp => pp.id === p.opParamId) : null;
    return [p.paramId, {
      min:  Number(p.min),
      max:  Number(p.max),
      step: Number(p.step),
      type: pSpec ? pSpec.type : 'number',
      nodeId: p.nodeId,
      opParamId: p.opParamId,
    }];
  })),
};
writeFileSync(resolve(workDir, 'param_ranges.json'),
  JSON.stringify(paramRangesSidecar, null, 2));
console.log(`  wrote param_ranges.json (${apvtsParams.length} params)`);

if (noBuild) {
  console.log('[build_native] --no-build set — skipping cmake');
  process.exit(0);
}

// ── cmake configure + build ──────────────────────────────────────────────
const CMAKE = process.env.CMAKE
  || 'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe';

if (!existsSync(CMAKE)) {
  console.error(`[build_native] cmake not found at ${CMAKE}. Set $CMAKE env to override.`);
  process.exit(1);
}

console.log(`[build_native] cmake configure ...`);
const configureRes = spawnSync(CMAKE, [
  '-S', codegenDir,
  '-B', buildDir,
  '-G', 'Visual Studio 17 2022',
  '-A', 'x64',
], { stdio: 'inherit' });
if (configureRes.status !== 0) {
  console.error(`[build_native] cmake configure failed (${configureRes.status})`);
  process.exit(configureRes.status || 1);
}

console.log(`[build_native] cmake build ...`);
const buildRes = spawnSync(CMAKE, [
  '--build', buildDir,
  '--config', 'Release',
  '--parallel',
], { stdio: 'inherit' });
if (buildRes.status !== 0) {
  console.error(`[build_native] cmake build failed (${buildRes.status})`);
  process.exit(buildRes.status || 1);
}

const vst3s = findVst3(buildDir);
console.log(`[build_native] DONE. emitted .vst3:`);
for (const v of vst3s) console.log(`  ${v}`);
