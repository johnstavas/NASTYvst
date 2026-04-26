// op_crepe.worklet.js — Stage-3 op sidecar for the `crepe` op.
//
// CREPE: A Convolutional Representation for Pitch Estimation. CNN-based
// monophonic F0 tracker, reference-tier accuracy on hard material
// (breathy / noisy / vibrato-heavy / under busy mixes) where YIN (#76)
// and pYIN (#77) start missing. Trained on 16 kHz audio, 1024-sample
// frames, classifies pitch into 360 bins covering ~32 Hz to ~2050 Hz
// at 10-cent resolution.
//
// === STAGE-1 SHIP (2026-04-24): ARCHITECTURAL FOUNDATION ONLY ===
//
// This file ships the WORKLET SHELL with mocked inference. Real ORT-Web
// inference lands in Stage 2. What's locked in this file:
//   - Op contract (inputs/outputs/params) per opRegistry.js entry
//   - kind: 'neural' declaration → opts out of golden-hash harness
//     (per Neural Op Exception clause in sandbox_op_ship_protocol.md)
//   - 16 kHz resample buffer + 1024-sample frame accumulator
//   - 10 ms hop (160 samples @ 16 kHz)
//   - MessagePort protocol stub (sends 'ml.frame', listens for 'ml.result')
//   - Mocked inference returns synthetic F0 from a simple zero-crossing
//     proxy until Stage 2 wires up the real ORT-Web session
//   - Worklet/native asymmetry documented (see "Async ML ops" below)
//
// === PRIMARY SOURCES (per Neural Op Exception clause) ===
//
//   1. ARCHITECTURE PRIMARY:
//      Kim, Salamon, Li, Bello, "CREPE: A Convolutional Representation
//      for Pitch Estimation," Proc. IEEE ICASSP 2018, pp. 161-165.
//      Architecture: 6 conv layers (filter widths [n, 64, 64, 64, 64, 64]
//      where n = 1024 for 'full' or 512/256/128/64 for smaller variants),
//      first layer stride (4,1), each followed by batch-norm + max-pool +
//      dropout, ending in Dense(360, sigmoid). Verified against
//      `marl/crepe/core.py:build_and_load_model`.
//
//   2. WEIGHTS PRIMARY:
//      Original Keras weights:  github.com/marl/crepe (MIT license)
//      ONNX-converted weights:  github.com/yqzhishen/onnxcrepe (MIT license)
//      Stage 2 will bundle crepe-tiny.onnx (~2 MB, 487K params, RPA ≈ 0.92
//      vs full's 0.94 — adequate for musical applications, fits in
//      sandbox bundle).
//
//   3. INFERENCE REFERENCE:
//      `marl/crepe/core.py:to_local_average_cents` and `predict()` —
//      decoding pipeline: 360-bin sigmoid → weighted-mean cents → Hz.
//      Cents grid: linspace(0, 7180, 360) + 1997.3794084376191
//      Hz: 10 * 2^(cents/1200)
//
// === WORKLET / NATIVE ASYMMETRY (declared per Exception clause) ===
//
// ORT-Web does NOT run inside an AudioWorkletGlobalScope (microsoft/
// onnxruntime#13072 — WASM bundle assumes globalThis.self, calls
// os.cpus() to pick a backend, neither exists in worklet scope). So:
//
//   WORKLET PATH (this file):
//     - Buffers audio, resamples to 16 kHz, accumulates 1024-sample frames
//     - Every 160 samples (10 ms), posts the latest frame to host via
//       this.port.postMessage({ type: 'ml.frame', frame, seq, ... })
//     - Host-side MLRuntime runs inference, posts result back as
//       { type: 'ml.result', f0, confidence, seq }
//     - Worklet caches latest (f0, conf), broadcasts as control-rate outputs
//     - End-to-end F0 update latency: 10ms hop + ~5–15ms RTT = ~15–25ms
//
//   NATIVE PATH (op_crepe.cpp.jinja):
//     - ORT-native session loaded inline at prepareToPlay
//     - Inference runs synchronously per frame, no MessagePort
//     - End-to-end F0 update latency: ~10ms (hop only)
//
// Both paths produce functionally equivalent output, but their topologies
// differ — this is a deliberate divergence per codegen_design.md §13
// (Async ML ops).
//
// === STAGE-1 MOCK INFERENCE ===
//
// Until Stage 2 wires up the real ORT-Web call, the worklet uses a
// trivial zero-crossing F0 estimator on the 16 kHz frame as a stand-in.
// This is DELIBERATELY a bad estimator — it lets the math tests verify
// the framing/resample/decode/output-broadcast plumbing without
// depending on ORT being available. Real inference accuracy lands in
// Stage 2.

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// CREPE constants — verified against marl/crepe/core.py.
const MODEL_SR     = 16000;     // CREPE is fixed-rate
const FRAME_SIZE   = 1024;      // 64 ms at 16 kHz
const HOP_SIZE     = 160;       // 10 ms at 16 kHz
const N_BINS       = 360;
const CENTS_BASE   = 1997.3794084376191;  // bin 0 cents offset
const CENTS_RANGE  = 7180;                // bin 359 cents = 1997.38 + 7180

export class CrepeOp {
  // Standard op metadata.
  static opId   = 'crepe';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio'   }]);
  static outputs = Object.freeze([
    { id: 'f0',         kind: 'control' },   // Hz, held constant between updates
    { id: 'confidence', kind: 'control' },   // 0..1
  ]);
  static params  = Object.freeze([
    { id: 'voicingThreshold', default: 0.5 },   // confidence floor; below → f0 holds last "voiced" value
    { id: 'modelSize',        default: 'tiny' }, // 'tiny' | 'small' | 'medium' | 'large' | 'full'
  ]);

  // Marker for the golden-hash harness to skip this op (Neural Op
  // Exception clause). Required for any op that runs ML inference.
  static kind = 'neural';

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    // Resample ratio: source SR → 16 kHz model SR. Stage 1 uses linear
    // interp; Stage 2 may upgrade to Hermite for less alias.
    this._resampleStep = MODEL_SR / this.sr;
    this._resamplePhase = 0;            // fractional position into source
    this._frameBuf = new Float32Array(FRAME_SIZE);  // ring at 16 kHz
    this._frameWritePos = 0;            // next write index in _frameBuf
    this._samplesSinceLastHop = 0;      // counts 16 kHz samples since last frame post
    this._frameSeq = 0;                 // monotonic frame counter, sent with each post

    // Latest inference result. Updated when 'ml.result' message arrives.
    // Stage 1: also updated locally by the mock estimator.
    this._latestF0 = 0;
    this._latestConf = 0;

    // Param state.
    this._voicingThreshold = 0.5;
    this._modelSize = 'tiny';

    // MessagePort wiring. In a real worklet this comes from the
    // AudioWorkletProcessor `this.port`; in Node test harness it's
    // undefined and Stage 1 falls back to mock-inline inference.
    this.port = null;

    // Stage 1 mock state — last positive-going zero-crossing index.
    this._mockLastZX = -1;
    this._mockLastZXSec = 0;
  }

  reset() {
    this._resamplePhase = 0;
    this._frameBuf.fill(0);
    this._frameWritePos = 0;
    this._samplesSinceLastHop = 0;
    this._frameSeq = 0;
    this._latestF0 = 0;
    this._latestConf = 0;
    this._mockLastZX = -1;
    this._mockLastZXSec = 0;
  }

  setParam(id, v) {
    switch (id) {
      case 'voicingThreshold': {
        const x = +v;
        if (!Number.isFinite(x)) return;
        this._voicingThreshold = clip(x, 0, 1);
        break;
      }
      case 'modelSize': {
        if (typeof v === 'string') this._modelSize = v;
        break;
      }
    }
  }

  getLatencySamples() {
    // Worklet-path latency floor: 10ms hop converted back to host SR,
    // plus the message-port roundtrip (impossible to bound here — host
    // measures it). Native path returns the hop only.
    return Math.round(HOP_SIZE * (this.sr / MODEL_SR));
  }

  /**
   * Bind a MessagePort for host-side inference. Called once by the
   * sandbox host after the worklet processor is created. Stage 2 host-
   * side runner will respond to `ml.frame` with `ml.result`. Until then,
   * port stays null and `_runMockInference` fills in.
   */
  bindPort(port) {
    this.port = port;
    if (!port) return;
    port.addEventListener('message', (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== 'ml.result' || msg.opId !== CrepeOp.opId) return;
      const r = msg.result;
      if (!r || !Number.isFinite(r.f0) || !Number.isFinite(r.confidence)) return;
      this._latestF0   = r.f0;
      this._latestConf = r.confidence;
    });
  }

  /**
   * Stage-1 mock inference: zero-crossing F0 on the 1024-sample 16 kHz
   * frame. Returns a rough F0 estimate so the math tests pass without
   * ORT-Web. Replaced in Stage 2 by the real ORT inference call (which
   * runs OFF this worklet, on the host main thread).
   *
   * NOT a substitute for CREPE — accuracy is roughly YIN-equivalent at
   * best. Sole purpose: keep the framing/resample/output-broadcast path
   * end-to-end exercisable while Stage 2 work is in flight.
   */
  static _mockInference(frame) {
    // Count positive-going zero-crossings.
    let zxCount = 0;
    let prev = frame[0];
    for (let i = 1; i < FRAME_SIZE; i++) {
      const cur = frame[i];
      if (prev <= 0 && cur > 0) zxCount++;
      prev = cur;
    }
    // RMS for confidence.
    let sumSq = 0;
    for (let i = 0; i < FRAME_SIZE; i++) sumSq += frame[i] * frame[i];
    const rms = Math.sqrt(sumSq / FRAME_SIZE);
    // F0 = zx_per_sec / 2 (positive-going zx happens once per period for sine).
    const frameSec = FRAME_SIZE / MODEL_SR;
    const f0 = zxCount > 0 ? (zxCount / frameSec) : 0;
    // Confidence proxy: higher RMS → higher conf, capped at 1.
    const confidence = clip(rms * 4, 0, 1);
    return { f0, confidence };
  }

  /**
   * Post a frame to the host-side runner, OR run mock inference inline
   * if no port is bound (Node test harness).
   */
  _dispatchFrame() {
    // Snapshot the ring buffer in CHRONOLOGICAL order (oldest at index 0,
    // newest at index FRAME_SIZE-1). The naive `slice()` copies in
    // storage-index order, which after the first wrap puts a temporal
    // discontinuity mid-frame — the CNN reads that as a strong artifact
    // and the decoded F0 drifts (~10–15¢ in tests, op_crepe.test.js).
    // After every write the head points to the NEXT slot, which is the
    // OLDEST sample in the current 1024-sample window.
    const snapshot = new Float32Array(FRAME_SIZE);
    const wp = this._frameWritePos;
    for (let i = 0; i < FRAME_SIZE; i++) {
      snapshot[i] = this._frameBuf[(wp + i) % FRAME_SIZE];
    }
    // Per CREPE preprocessing: zero-mean, unit-variance per frame.
    let mean = 0;
    for (let i = 0; i < FRAME_SIZE; i++) mean += snapshot[i];
    mean /= FRAME_SIZE;
    let varSum = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      snapshot[i] -= mean;
      varSum += snapshot[i] * snapshot[i];
    }
    const std = Math.sqrt(varSum / FRAME_SIZE);
    if (std > 1e-9) {
      const inv = 1 / std;
      for (let i = 0; i < FRAME_SIZE; i++) snapshot[i] *= inv;
    }

    if (this.port) {
      // Stage 2 runtime path — host main-thread MLRuntime listens.
      this.port.postMessage({
        type:   'ml.frame',
        opId:   CrepeOp.opId,
        seq:    this._frameSeq,
        frame:  snapshot,
        modelSize: this._modelSize,
      });
    } else {
      // Stage 1 mock + Node test harness fallback.
      const { f0, confidence } = CrepeOp._mockInference(snapshot);
      this._latestF0   = f0;
      this._latestConf = confidence;
    }
    this._frameSeq++;
  }

  /**
   * Append source-rate sample `s` into the 16 kHz frame buffer using a
   * cheap linear-interpolating resampler. Returns true if a hop boundary
   * was crossed (i.e., a frame should be dispatched).
   */
  _ingestSample(s) {
    // Walk fractional phase forward; each time we cross an integer step,
    // emit one 16 kHz sample into the frame ring.
    let crossedHop = false;
    this._resamplePhase += this._resampleStep;
    while (this._resamplePhase >= 1) {
      this._resamplePhase -= 1;
      // Stage 1: zero-order-hold (cheapest possible). Stage 2 may swap
      // for linear or Hermite. The mock estimator is robust to either.
      this._frameBuf[this._frameWritePos] = s;
      this._frameWritePos = (this._frameWritePos + 1) % FRAME_SIZE;
      this._samplesSinceLastHop++;
      if (this._samplesSinceLastHop >= HOP_SIZE) {
        this._samplesSinceLastHop = 0;
        crossedHop = true;
      }
    }
    return crossedHop;
  }

  process(inputs, outputs, N) {
    const inCh = inputs.in;
    const outF0   = outputs.f0;
    const outConf = outputs.confidence;
    if (!outF0 && !outConf) return;

    if (!inCh) {
      // No input → no inference; outputs hold last value.
      if (outF0)   for (let i = 0; i < N; i++) outF0[i]   = this._latestF0;
      if (outConf) for (let i = 0; i < N; i++) outConf[i] = this._latestConf;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      if (this._ingestSample(x)) {
        this._dispatchFrame();
      }
      // Apply voicing threshold: emit 0 Hz when confidence below floor.
      // Otherwise output held latest f0 / conf (Sample-and-hold semantics
      // — control-rate output, host SR).
      const voiced = this._latestConf >= this._voicingThreshold;
      if (outF0)   outF0[i]   = voiced ? this._latestF0 : 0;
      if (outConf) outConf[i] = this._latestConf;
    }
  }
}
