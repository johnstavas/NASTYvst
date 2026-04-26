// Neural-op real-inference harness.
//
// Stage-3 / Stage-2 verification gate for ops declared `kind: 'neural'`.
// Loads the actual ONNX weights via ORT-Node, drives the host-side
// MLRuntime, and validates decoded outputs against synthesized audio
// inputs (sines, silence, noise) using tolerance-based assertions.
//
// Why a separate harness from check_op_math.mjs:
//   - Real ORT inference is async; the math harness expects sync run()s.
//   - Loading a 2 MB ONNX model is too slow to run on every math test.
//   - Neural ops opt out of the bit-for-bit-mirror golden-hash harness;
//     this is their replacement (Neural Op Exception clause in
//     sandbox_op_ship_protocol.md).
//
// Skip behaviour:
//   - If `onnxruntime-node` is not installed → SKIP all tests (warn).
//   - If a weights file is missing for an op → SKIP that op's tests.
// Skips count as PASS so this can run in qc:all without blocking when an
// install hasn't run yet, but a clear "SKIPPED" line keeps the absence
// visible.
//
// Run:       node scripts/check_ml_inference.mjs
// Force:     node scripts/check_ml_inference.mjs --strict   (skips → fails)

import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..');

const STRICT = process.argv.includes('--strict');

// Stage MLRuntime.js + op_crepe.worklet.js into a tmp dir flagged
// "type": "module" so Node imports them as ESM. (Mirrors the pattern
// used by check_op_math.mjs / check_op_goldens.mjs.)
const tmpDir = resolve(repoRoot, 'node_modules', '.sandbox-ml-harness');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');
copyFileSync(
  resolve(repoRoot, 'src', 'sandbox', 'host', 'MLRuntime.js'),
  resolve(tmpDir, 'MLRuntime.js'),
);
copyFileSync(
  resolve(repoRoot, 'src', 'sandbox', 'ops', 'op_crepe.worklet.js'),
  resolve(tmpDir, 'op_crepe.worklet.js'),
);

// ---------------------------------------------------------------------------
// 1. Try to load ORT-Node. Bail with skip if not installed.
// ---------------------------------------------------------------------------
let ort;
try {
  ort = await import('onnxruntime-node');
} catch (err) {
  const msg = `onnxruntime-node not installed (${err?.code || err?.message || err}). Run \`npm install\`.`;
  if (STRICT) {
    console.log(`\nML inference — neural-op verification\n`);
    console.log(`  FAIL  ml-runtime: ${msg}`);
    console.log(`\nRESULT: FAIL — strict mode\n`);
    process.exit(1);
  }
  console.log(`\nML inference — neural-op verification\n`);
  console.log(`  SKIP  ${msg}`);
  console.log(`\nRESULT: PASS — 0 of 0 checks ran (skipped)\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Bring up MLRuntime against the local /public/models bundle.
// ---------------------------------------------------------------------------
const { MLRuntime } = await import(pathToFileURL(
  resolve(tmpDir, 'MLRuntime.js')
).href);

const modelsDir = resolve(repoRoot, 'public', 'models');
const ml = new MLRuntime({
  ort,
  loadModel: async (opId) => {
    const path = resolve(modelsDir, `${opId}.onnx`);
    if (!existsSync(path)) {
      throw new Error(`weights not found: ${path}`);
    }
    return readFileSync(path);
  },
  onError: () => {},   // tests handle their own error reporting
});

// ---------------------------------------------------------------------------
// 3. Test fixtures.
// ---------------------------------------------------------------------------
const MODEL_SR = 16000;

function sineFrame(N, freq, sr = MODEL_SR, amp = 0.5) {
  const out = new Float32Array(N);
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin(i * w);
  return out;
}

function whiteNoiseFrame(N, seed = 1, amp = 0.3) {
  const out = new Float32Array(N);
  let s = seed >>> 0;
  for (let i = 0; i < N; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = ((s / 0xFFFFFFFF) - 0.5) * 2 * amp;
  }
  return out;
}

/** Zero-mean unit-variance normalize (mirror of worklet/native preprocess). */
function zMeanUStd(frame) {
  const N = frame.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += frame[i];
  mean /= N;
  const out = new Float32Array(N);
  let varSum = 0;
  for (let i = 0; i < N; i++) {
    out[i] = frame[i] - mean;
    varSum += out[i] * out[i];
  }
  const std = Math.sqrt(varSum / N);
  if (std > 1e-9) {
    const inv = 1 / std;
    for (let i = 0; i < N; i++) out[i] *= inv;
  }
  return out;
}

/** cents error from a target Hz. */
function cents(measured, target) {
  if (!Number.isFinite(measured) || measured <= 0) return Infinity;
  return 1200 * Math.log2(measured / target);
}

// ---------------------------------------------------------------------------
// 4. Tests.
// ---------------------------------------------------------------------------
const results = [];
function record(name, pass, why) {
  results.push({ name, pass, why });
}
async function test(name, fn) {
  try {
    const r = await fn();
    if (r && r.pass === false) record(name, false, r.why);
    else                       record(name, true);
  } catch (err) {
    record(name, false, err?.stack || err?.message || String(err));
  }
}

// --- Verify weights file exists --------------------------------------------
const crepeOnnx = resolve(modelsDir, 'crepe.onnx');
if (!existsSync(crepeOnnx)) {
  console.log(`\nML inference — neural-op verification\n`);
  console.log(`  SKIP  crepe: weights missing at ${crepeOnnx}`);
  console.log(`        (download via scripts/fetch_models.mjs or curl)`);
  console.log(`\nRESULT: PASS — 0 of 0 checks ran (skipped)\n`);
  await ml.dispose();
  process.exit(STRICT ? 1 : 0);
}

// --- Session lifecycle -----------------------------------------------------
await test('crepe: getSession lazy-loads + memoizes', async () => {
  const a = await ml.getSession('crepe');
  const b = await ml.getSession('crepe');
  if (a !== b) return { pass: false, why: 'session not memoized' };
  if (typeof a.run !== 'function') return { pass: false, why: 'session has no run()' };
});

// --- Decode accuracy: pure sines (RPA target ≤5¢) --------------------------
// CREPE-tiny published RPA is ~0.92; single-frame error widens at the
// edges of the trained distribution. Tolerances reflect that — 5¢ at
// the canonical A=440 / C4 / A5 centre, 10¢ at A3/A2 lower-octave.
const sineCases = [
  { hz: 440, tolCents: 5,  label: 'A4 (440 Hz)' },
  { hz: 220, tolCents: 10, label: 'A3 (220 Hz)' },
  { hz: 880, tolCents: 5,  label: 'A5 (880 Hz)' },
  { hz: 110, tolCents: 10, label: 'A2 (110 Hz, low end)' },
  { hz: 261.6256, tolCents: 5, label: 'C4 (261.63 Hz)' },
];

for (const tc of sineCases) {
  await test(`crepe: ${tc.label} → F0 within ±${tc.tolCents}¢`, async () => {
    const frame  = zMeanUStd(sineFrame(1024, tc.hz));
    const result = await ml.run('crepe', frame);
    const err = cents(result.f0, tc.hz);
    if (Math.abs(err) > tc.tolCents) {
      return { pass: false, why: `f0=${result.f0.toFixed(3)} err=${err.toFixed(2)}¢ conf=${result.confidence.toFixed(3)}` };
    }
    if (!(result.confidence >= 0.5)) {
      return { pass: false, why: `low confidence=${result.confidence.toFixed(3)} on pure sine` };
    }
  });
}

// --- Decoder math: synthetic salience fixture ------------------------------
// Pin the local-average-cents decoder math against hand-built salience
// arrays. This isolates the decoder from ORT/weights so the JS, C++, and
// any future port produce the same f0 for the same 360-bin input. The
// native Stage-3 harness (T8 codegen scope) replays these same fixtures
// against ml_runtime_native.cpp:decodeCrepe.
await test('crepe decoder: salience peak at bin 180 → cents grid + Hz match', async () => {
  const { DECODERS } = await import(pathToFileURL(
    resolve(tmpDir, 'MLRuntime.js')
  ).href);
  // Single sharp peak at bin 180. Local-average over ±4 with one non-zero
  // bin collapses to that bin's cents value.
  const sal = new Float32Array(360);
  sal[180] = 1.0;
  const r = DECODERS.crepe(sal);
  // cents = 7180·180/359 + 1997.3794 = 3599.4986... + 1997.3794 = 5596.878...
  const expectedCents = 7180 * 180 / 359 + 1997.3794084376191;
  const expectedHz    = 10 * Math.pow(2, expectedCents / 1200);
  const errCents      = Math.abs(1200 * Math.log2(r.f0 / expectedHz));
  if (errCents > 0.01) {
    return { pass: false, why: `f0=${r.f0} expected=${expectedHz.toFixed(4)} err=${errCents.toFixed(4)}¢` };
  }
  if (Math.abs(r.confidence - 1.0) > 1e-6) {
    return { pass: false, why: `confidence=${r.confidence} expected 1.0 (peak=1)` };
  }
});

await test('crepe decoder: weighted-mean over 9-bin local window', async () => {
  const { DECODERS } = await import(pathToFileURL(
    resolve(tmpDir, 'MLRuntime.js')
  ).href);
  // Symmetric distribution centered at bin 200 (peak), with falloff ±1, ±2, ±3, ±4.
  // Local-average should land cleanly at bin 200's cents.
  const sal = new Float32Array(360);
  sal[196] = 0.10;
  sal[197] = 0.30;
  sal[198] = 0.60;
  sal[199] = 0.85;
  sal[200] = 1.00;   // peak
  sal[201] = 0.85;
  sal[202] = 0.60;
  sal[203] = 0.30;
  sal[204] = 0.10;
  const r = DECODERS.crepe(sal);
  const expectedCents = 7180 * 200 / 359 + 1997.3794084376191;
  const expectedHz    = 10 * Math.pow(2, expectedCents / 1200);
  const errCents      = Math.abs(1200 * Math.log2(r.f0 / expectedHz));
  if (errCents > 0.5) {
    return { pass: false, why: `f0=${r.f0.toFixed(3)} expected=${expectedHz.toFixed(3)} err=${errCents.toFixed(3)}¢ (symmetric peak should center)` };
  }
});

await test('crepe decoder: edge-clamp at bin 0 + bin 359 (no array OOB)', async () => {
  const { DECODERS } = await import(pathToFileURL(
    resolve(tmpDir, 'MLRuntime.js')
  ).href);
  const lo = new Float32Array(360); lo[0]   = 1.0;
  const hi = new Float32Array(360); hi[359] = 1.0;
  const rLo = DECODERS.crepe(lo);
  const rHi = DECODERS.crepe(hi);
  if (!Number.isFinite(rLo.f0) || rLo.f0 <= 0) return { pass: false, why: `low edge f0=${rLo.f0}` };
  if (!Number.isFinite(rHi.f0) || rHi.f0 <= 0) return { pass: false, why: `high edge f0=${rHi.f0}` };
  // bin 0 cents = 1997.379 → Hz = 10·2^(1.664) = 31.7 Hz
  // bin 359 cents = 7180 + 1997.379 = 9177.379 → Hz = 10·2^(7.65) = 2007 Hz
  if (Math.abs(rLo.f0 - 31.7) > 1) return { pass: false, why: `bin 0 f0=${rLo.f0.toFixed(2)} expected ~31.7` };
  if (Math.abs(rHi.f0 - 2006.6) > 5) return { pass: false, why: `bin 359 f0=${rHi.f0.toFixed(2)} expected ~2006.6` };
});

await test('crepe decoder: silent / negative salience → zero result', async () => {
  const { DECODERS } = await import(pathToFileURL(
    resolve(tmpDir, 'MLRuntime.js')
  ).href);
  const zero = new Float32Array(360);
  const neg  = new Float32Array(360); neg.fill(-1.0);
  const rZ = DECODERS.crepe(zero);
  const rN = DECODERS.crepe(neg);
  if (rZ.f0 !== 0 || rZ.confidence !== 0) return { pass: false, why: `zero salience: f0=${rZ.f0} conf=${rZ.confidence}` };
  if (rN.f0 !== 0 || rN.confidence !== 0) return { pass: false, why: `negative salience: f0=${rN.f0} conf=${rN.confidence}` };
});

// --- Confidence sanity: white noise should produce LOW confidence ----------
await test('crepe: white noise → confidence < 0.5 (no false-positive pitch)', async () => {
  const frame  = zMeanUStd(whiteNoiseFrame(1024, 0xDEADBEEF));
  const result = await ml.run('crepe', frame);
  if (!(result.confidence < 0.5)) {
    return { pass: false, why: `noise confidence=${result.confidence.toFixed(3)} (expected <0.5; f0=${result.f0.toFixed(2)})` };
  }
});

// --- Confidence sanity: silence → low confidence (post-normalize is undefined) ---
await test('crepe: silence (post-normalize = zero frame) → conf finite, no throw', async () => {
  const frame = new Float32Array(1024);   // already zero
  const result = await ml.run('crepe', frame);
  if (!Number.isFinite(result.f0))         return { pass: false, why: `f0=${result.f0}` };
  if (!Number.isFinite(result.confidence)) return { pass: false, why: `conf=${result.confidence}` };
});

// --- Determinism: same input → same output (within float epsilon) ----------
await test('crepe: deterministic — same input twice produces same f0 within 0.5¢', async () => {
  const frame = zMeanUStd(sineFrame(1024, 330));
  const a = await ml.run('crepe', frame);
  const b = await ml.run('crepe', frame);
  const err = Math.abs(cents(a.f0, b.f0));
  if (err > 0.5) return { pass: false, why: `Δ=${err.toFixed(3)}¢ a=${a.f0} b=${b.f0}` };
});

// --- MessagePort end-to-end: worklet ↔ MLRuntime --------------------------
// Simulate the worklet posting ml.frame through a MessageChannel; verify
// MLRuntime receives, runs, and posts ml.result back through the same port.
await test('end-to-end: MessageChannel ml.frame → ml.result with f0 within 5¢', async () => {
  // node:worker_threads MessageChannel: postMessage on port A is heard on
  // the OTHER port (B's 'message' event). So if MLRuntime listens on
  // port2, the frame must be posted from port1, and the reply will come
  // back on port1's 'message' (because MLRuntime calls port2.postMessage).
  let MessageChannel;
  try {
    ({ MessageChannel } = await import('node:worker_threads'));
  } catch {
    return { pass: false, why: 'MessageChannel not available in node:worker_threads' };
  }
  const chan    = new MessageChannel();
  const detach  = ml.attachWorkletPort(chan.port2);

  let timer;
  const frame   = zMeanUStd(sineFrame(1024, 440));
  const replyP  = new Promise((resolveR, rejectR) => {
    const onMsg = (msg) => {
      if (!msg || msg.type !== 'ml.result') return;
      chan.port1.off('message', onMsg);
      clearTimeout(timer);
      resolveR(msg);
    };
    chan.port1.on('message', onMsg);
    timer = setTimeout(() => {
      chan.port1.off('message', onMsg);
      rejectR(new Error('timeout waiting for ml.result'));
    }, 5000);
  });
  chan.port1.postMessage({ type: 'ml.frame', opId: 'crepe', nodeId: 'test_42', seq: 7, frame });

  let reply;
  try {
    reply = await replyP;
  } finally {
    clearTimeout(timer);
    detach();
    chan.port1.close();
    chan.port2.close();
  }

  if (reply.opId   !== 'crepe')   return { pass: false, why: `opId=${reply.opId}` };
  if (reply.nodeId !== 'test_42') return { pass: false, why: `nodeId=${reply.nodeId}` };
  if (reply.seq    !== 7)         return { pass: false, why: `seq=${reply.seq}` };
  const err = Math.abs(cents(reply.result.f0, 440));
  if (err > 5) return { pass: false, why: `f0=${reply.result.f0} err=${err.toFixed(2)}¢` };
});

// --- Integration: real CrepeOp worklet driven through MLRuntime ------------
// Boots a CrepeOp from op_crepe.worklet.js, attaches MLRuntime to a
// MessageChannel so inference roundtrips actually fire, runs ~1 second of
// host-rate sine through the worklet, and asserts the worklet's broadcast
// f0 matches input within 5¢.
await test('worklet→runtime integration: 440 Hz @ 48 kHz → worklet f0 within 5¢', async () => {
  // Import worklet sidecar.
  const { CrepeOp } = await import(pathToFileURL(
    resolve(tmpDir, 'op_crepe.worklet.js')
  ).href);
  const op = new CrepeOp(48000);
  op.setParam('voicingThreshold', 0);
  op.reset();

  const { MessageChannel } = await import('node:worker_threads');
  const chan = new MessageChannel();
  // Worklet binds to its end (port1); MLRuntime listens on the other (port2).
  // Worklet's bindPort uses addEventListener('message', ...). Node ports
  // support addEventListener via the EventTarget API.
  op.bindPort(chan.port1);
  const detach = ml.attachWorkletPort(chan.port2);
  // Both ports must be started for messages to flow.
  if (typeof chan.port1.start === 'function') chan.port1.start();
  if (typeof chan.port2.start === 'function') chan.port2.start();

  // Generate ~1 s of 440 Hz at 48 kHz, render in 128-sample blocks, drain
  // microtask + a tick between blocks so port messages have a chance to
  // round-trip while the next block is generated.
  const SR_HOST = 48000;
  const totalSamples = SR_HOST;
  const block = 128;
  const totalBlocks = Math.floor(totalSamples / block);
  const f0Out   = new Float32Array(block);
  const confOut = new Float32Array(block);
  for (let b = 0; b < totalBlocks; b++) {
    const inBuf = new Float32Array(block);
    for (let i = 0; i < block; i++) {
      const t = (b * block + i) / SR_HOST;
      inBuf[i] = 0.5 * Math.sin(2 * Math.PI * 440 * t);
    }
    op.process({ in: inBuf }, { f0: f0Out, confidence: confOut }, block);
    // Yield: let port messages flush.
    await new Promise((r) => setImmediate(r));
  }

  // After 1 s of audio, give a few extra ticks for the LAST inference
  // roundtrip to land before reading.
  for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r));

  detach();
  chan.port1.close();
  chan.port2.close();

  const finalF0   = op._latestF0;
  const finalConf = op._latestConf;
  const err = Math.abs(cents(finalF0, 440));
  if (!Number.isFinite(finalF0) || finalF0 <= 0) {
    return { pass: false, why: `worklet f0=${finalF0} (no inference roundtrip happened?)` };
  }
  if (err > 5) {
    return { pass: false, why: `worklet f0=${finalF0.toFixed(3)} err=${err.toFixed(2)}¢ conf=${finalConf.toFixed(3)}` };
  }
});

// ---------------------------------------------------------------------------
// 5. Report.
// ---------------------------------------------------------------------------
console.log(`\nML inference — neural-op verification\n`);
let fails = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.pass) {
    if (r.why) console.log(`        ${r.why}`);
    fails++;
  }
}
console.log('');

await ml.dispose();

if (fails) {
  console.log(`RESULT: FAIL — ${fails} of ${results.length} checks failed\n`);
  process.exit(1);
} else {
  console.log(`RESULT: PASS — all ${results.length} checks clean\n`);
}
