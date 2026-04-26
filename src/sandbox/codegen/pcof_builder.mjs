// pcof_builder.mjs — Node-side bridge to src/sandbox/buildPCOF.js.
//
// Why a bridge: src/sandbox/*.js are written for the Vite/browser side
// (bare `./opRegistry` imports, no `.js` suffix). Node's ESM loader needs
// explicit `.js`. Same trick used by scripts/check_pcof.mjs: copy-rewrite
// the four sandbox files into a tmp dir with `package.json:{type:module}`
// and dynamic-import from there.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const sandboxDir = resolve(__dirname, '..');
const tmpDir     = resolve(__dirname, '..', '..', '..', 'node_modules', '.codegen-pcof-bridge');

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

function copyRewrite(fname, rewrites = []) {
  let src = readFileSync(resolve(sandboxDir, fname), 'utf8');
  for (const [re, to] of rewrites) src = src.replace(re, to);
  writeFileSync(resolve(tmpDir, fname), src);
}

copyRewrite('opRegistry.js');
copyRewrite('validateGraph.js', [[/from '\.\/opRegistry'/g, "from './opRegistry.js'"]]);
copyRewrite('buildPCOF.js', [
  [/from '\.\/opRegistry'/g, "from './opRegistry.js'"],
  [/from '\.\/validateGraph'/g, "from './validateGraph.js'"],
]);
copyRewrite('validatePCOF.js', [[/from '\.\/buildPCOF'/g, "from './buildPCOF.js'"]]);

const validateMod = await import(pathToFileURL(resolve(tmpDir, 'validateGraph.js')).href);
const pcofMod     = await import(pathToFileURL(resolve(tmpDir, 'buildPCOF.js')).href);
const valPcofMod  = await import(pathToFileURL(resolve(tmpDir, 'validatePCOF.js')).href);
const opRegMod    = await import(pathToFileURL(resolve(tmpDir, 'opRegistry.js')).href);

export const SCHEMA_VERSION = validateMod.SCHEMA_VERSION;
export const PCOF_VERSION   = pcofMod.PCOF_VERSION;
export const validateGraph  = validateMod.validateGraph;
export const buildPCOF      = pcofMod.buildPCOF;
export const validatePCOF   = valPcofMod.validatePCOF;
export const getOp          = opRegMod.getOp;
export const OPS            = opRegMod.OPS;
