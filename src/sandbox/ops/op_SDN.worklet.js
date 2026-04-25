// op_SDN.worklet.js — Catalog #110 (Space family).
//
// Scattering Delay Network (SDN) reverberator per
//   De Sena, Hacıhabiboğlu, Cvetković & Smith,
//   "Efficient Synthesis of Room Acoustics via Scattering Delay Networks",
//   IEEE/ACM TASLP vol. 23, no. 9, Sept 2015 — §III.
//
// PRIMARY-SOURCE PASSAGES (paper §III, pp. 5–7, eqns 5–15)
//
//   • "the network consists of a fully connected DWN with one scattering
//     node for each wall… Rectangular rooms, which are used in the
//     following, correspond to K = 5." (each node has K=5 neighbours, i.e.
//     connects to all 5 other wall nodes.)
//
//   • Isotropic scattering matrix (eq 9 / 5):
//                    A = (2/K) 1·1ᵀ − I                            (5)
//
//   • Wall absorption (eq 10):
//                    S = βA,  β = √(1 − α)                         (10)
//
//   • Source injection into a node (eq 8):
//                    p̄⁺ = p⁺ + (p_S/2)·1                           (8)
//
//   • Source-to-node 1/r attenuation (eq 11):
//                    g_{S,k} = 1 / ‖x_S − x_k‖                     (11)
//
//   • Node-to-node delay in samples:
//                    D_{k,m} = ⌊F_s · ‖x_k − x_m‖ / c⌋
//
//   • Node-to-mic correction factor (eqs 14/15):
//                    g_{k,M}   = 1 / (1 + ‖x_k−x_M‖ / ‖x_S−x_k‖)
//                    g_{S,k}·g_{k,M} = 1 / (‖x_S−x_k‖ + ‖x_k−x_M‖)
//
//   • Mic weights (eq 13): wᵀA1 = 2 ⇒ simple w = (2/K)·1 for K=5.
//
//   • LOS path: direct source→mic delay z^{−D_{S,M}} and gain
//     ḡ = g_{S,M}·Γ_S(θ_{S,M})·Γ_M(θ_{M,S})  (omnidirectional in v1).
//
// TOPOLOGY (v1)
//
//   Rectangular shoebox room Lx × Ly × Lz. 6 wall nodes (one per wall),
//   K = 5 neighbours each. Source S injects through source→node delay
//   lines (with g_{S,k}, then /2). Per sample at each node k:
//
//     1. Sum incoming p⁺[k][0..4] from neighbours via inter-node delays.
//     2. Add p_S·g_{S,k}/2 to each of 5 incoming waves  (eq 8).
//     3. Scatter: p⁻[k][i] = (2/5)·sum(p̄⁺) − p̄⁺[k][i]  (eq 5).
//     4. Apply wall filter H_k(z) (1-pole LP, damping) and β=√(1-α).
//     5. Mic tap: each filtered p⁻ contributes w·p⁻·g_{k,M} through
//        node→mic delay D_{k,M}.
//     6. Write filtered p⁻[k][i] into the delay k→m (opposite direction
//        from neighbour's incoming next sample).
//
//   Direct-path output = ḡ · source[n − D_{S,M}] + Σ_k (mic-tap).
//
// STEREO SYNTHESIS
//
//   Two mic positions M_L, M_R slightly offset on x-axis by `width`.
//   Same scattering network; two parallel sets of source→node and
//   node→mic attenuation / delays are NOT duplicated — we use a single
//   network and tap twice with different node→mic delays/gains. Source
//   is single position.
//
// PARAMS
//
//   rt60     — reverb time in seconds (sets α via Sabine eqn)       0.2..8
//   size     — room scale multiplier (Lx,Ly,Lz = size·base)         0.3..3
//   damping  — wall-filter HF absorption coefficient                0..1
//   width    — stereo mic offset in metres                          0..1
//
// DEBT
//   v1 skips: frequency-dependent wall filter per §III (beyond 1-pole),
//   source/mic directivity Γ_S/Γ_M, second-order ray-tracing corrections
//   (Fig.5 paths), ISO-354 random-incidence mapping. Debt rows logged.

const K = 5;                 // neighbours per node (rectangular room)
const N_NODES = 6;
const C_SOUND = 343.0;       // m/s
// Neighbour index → global node index:
//   node k's K neighbours are the other 5 nodes (skipping k itself).
const NEIGHBOURS = (() => {
  const m = [];
  for (let k = 0; k < N_NODES; k++) {
    const row = [];
    for (let j = 0; j < N_NODES; j++) if (j !== k) row.push(j);
    m.push(row);
  }
  return m;
})();
// reverse: node k's index (0..4) among neighbours-of-node m.
//   i.e. REV[m][k] = position where node k appears in NEIGHBOURS[m].
const REV = (() => {
  const m = [];
  for (let k = 0; k < N_NODES; k++) {
    const row = new Array(N_NODES).fill(-1);
    for (let i = 0; i < K; i++) row[NEIGHBOURS[k][i]] = i;
    m.push(row);
  }
  return m;
})();

function nextPow2(n) { let p = 1; while (p < n + 2) p <<= 1; return p; }
function dist(a, b) {
  const dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

export class SDNOp {
  static opId   = 'SDN';
  static inputs = [{ id: 'in', kind: 'audio' }];
  static outputs = [
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ];
  static params = [
    { id: 'rt60',    default: 1.2 },
    { id: 'size',    default: 1.0 },
    { id: 'damping', default: 0.3 },
    { id: 'width',   default: 0.3 },
  ];

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    // Base room & mic positions (v1 fixed; size scales all).
    this.baseLx = 8.0;
    this.baseLy = 6.0;
    this.baseLz = 3.0;
    this.baseSrc = [2.0, 2.0, 1.6];
    this.baseMicL = [5.0, 4.0, 1.6];
    this.baseMicR = [5.0, 4.0, 1.6];   // R offset added at recompute

    this.p_rt60    = 1.2;
    this.p_size    = 1.0;
    this.p_damping = 0.3;
    this.p_width   = 0.3;

    // Per-node incoming-wave state p⁺[k][i] (K=5 each, kept as concatenated)
    this.pIn = new Float32Array(N_NODES * K);

    // Inter-node delay lines: one per directed pair (k→m), k!=m. Stored as
    // a single big buffer per pair for simplicity. Index: edgeIdx(k,m).
    this.edgeBuf = new Array(N_NODES * N_NODES).fill(null);
    this.edgeW   = new Int32Array(N_NODES * N_NODES);
    this.edgeMsk = new Int32Array(N_NODES * N_NODES);
    this.edgeLen = new Int32Array(N_NODES * N_NODES);

    // Source→node delay lines (N_NODES of them).
    this.srcNodeBuf = new Array(N_NODES).fill(null);
    this.srcNodeW   = new Int32Array(N_NODES);
    this.srcNodeMsk = new Int32Array(N_NODES);
    this.srcNodeLen = new Int32Array(N_NODES);
    this.gSk        = new Float32Array(N_NODES);  // 1/‖x_S−x_k‖

    // Node→mic delays and g_{k,M} (per channel L / R).
    this.nodeMicBufL = new Array(N_NODES).fill(null);
    this.nodeMicBufR = new Array(N_NODES).fill(null);
    this.nodeMicWL   = new Int32Array(N_NODES);
    this.nodeMicWR   = new Int32Array(N_NODES);
    this.nodeMicMskL = new Int32Array(N_NODES);
    this.nodeMicMskR = new Int32Array(N_NODES);
    this.nodeMicLenL = new Int32Array(N_NODES);
    this.nodeMicLenR = new Int32Array(N_NODES);
    this.gkML        = new Float32Array(N_NODES);
    this.gkMR        = new Float32Array(N_NODES);

    // Source→mic LOS delay & gain (per channel).
    this.losBufL = null; this.losWL = 0; this.losMskL = 0; this.losLenL = 0;
    this.losBufR = null; this.losWR = 0; this.losMskR = 0; this.losLenR = 0;
    this.losGL = 0; this.losGR = 0;

    // Per-node wall-filter state (one-pole LP).
    this.wallZ = new Float32Array(N_NODES * K);
    this.wallA = 0.3;   // set by damping
    this.beta  = 0.8;   // √(1−α) set by rt60

    this.recompute();
  }

  _edgeIdx(k, m) { return k * N_NODES + m; }

  // Wall node positions: first-order reflection point on each wall along
  // source→mic path, using mirror-image construction. Ensures first-order
  // reflection delay/gain are rendered exactly (paper §III-A claim).
  _wallNode(wallAxis, wallCoord, src, mic) {
    const img = src.slice(); img[wallAxis] = 2 * wallCoord - src[wallAxis];
    // Line img → mic hits wall at wallAxis = wallCoord:
    const t = (wallCoord - img[wallAxis]) / (mic[wallAxis] - img[wallAxis]);
    return [
      img[0] + t * (mic[0] - img[0]),
      img[1] + t * (mic[1] - img[1]),
      img[2] + t * (mic[2] - img[2]),
    ];
  }

  recompute() {
    const s  = Math.max(0.3, Math.min(3, this.p_size));
    const Lx = this.baseLx * s, Ly = this.baseLy * s, Lz = this.baseLz * s;
    const src  = [this.baseSrc[0] * s,  this.baseSrc[1] * s,  this.baseSrc[2] * s];
    const micL = [this.baseMicL[0] * s, this.baseMicL[1] * s, this.baseMicL[2] * s];
    const w = Math.max(0, Math.min(1, this.p_width));
    const micR = [micL[0], micL[1] + 0.18 + w * 0.4, micL[2]];  // y-offset R ear

    // Use average of micL/micR as reference for node placement (v1 — a single
    // graph serves both ears, only tap gains/delays differ).
    const micRef = [
      0.5 * (micL[0] + micR[0]),
      0.5 * (micL[1] + micR[1]),
      0.5 * (micL[2] + micR[2]),
    ];
    const nodes = [
      this._wallNode(0, 0,   src, micRef),   // x-
      this._wallNode(0, Lx,  src, micRef),   // x+
      this._wallNode(1, 0,   src, micRef),   // y-
      this._wallNode(1, Ly,  src, micRef),   // y+
      this._wallNode(2, 0,   src, micRef),   // z-
      this._wallNode(2, Lz,  src, micRef),   // z+
    ];

    // Inter-node delays D_{k,m} = floor(Fs·‖x_k−x_m‖/c). (paper, sample form)
    for (let k = 0; k < N_NODES; k++) {
      for (let m = 0; m < N_NODES; m++) {
        if (k === m) continue;
        const d = Math.max(1, Math.floor(this.sr * dist(nodes[k], nodes[m]) / C_SOUND));
        const idx = this._edgeIdx(k, m);
        const sz  = nextPow2(d);
        if (!this.edgeBuf[idx] || this.edgeBuf[idx].length !== sz) {
          this.edgeBuf[idx] = new Float32Array(sz);
          this.edgeW[idx]   = 0;
        }
        this.edgeMsk[idx] = sz - 1;
        this.edgeLen[idx] = d;
      }
    }

    // Source→node delays and gains.
    for (let k = 0; k < N_NODES; k++) {
      const rSk = Math.max(0.1, dist(src, nodes[k]));  // eq (11): 1/r
      const d   = Math.max(1, Math.floor(this.sr * rSk / C_SOUND));
      const sz  = nextPow2(d);
      if (!this.srcNodeBuf[k] || this.srcNodeBuf[k].length !== sz) {
        this.srcNodeBuf[k] = new Float32Array(sz);
        this.srcNodeW[k]   = 0;
      }
      this.srcNodeMsk[k] = sz - 1;
      this.srcNodeLen[k] = d;
      this.gSk[k]        = 1.0 / rSk;
    }

    // Node→mic delays and g_{k,M} per channel (eqs 14/15).
    for (let k = 0; k < N_NODES; k++) {
      const rSk  = Math.max(0.1, dist(src, nodes[k]));
      const rkML = Math.max(0.1, dist(nodes[k], micL));
      const rkMR = Math.max(0.1, dist(nodes[k], micR));

      const dL = Math.max(1, Math.floor(this.sr * rkML / C_SOUND));
      const dR = Math.max(1, Math.floor(this.sr * rkMR / C_SOUND));
      const szL = nextPow2(dL), szR = nextPow2(dR);
      if (!this.nodeMicBufL[k] || this.nodeMicBufL[k].length !== szL) {
        this.nodeMicBufL[k] = new Float32Array(szL); this.nodeMicWL[k] = 0;
      }
      if (!this.nodeMicBufR[k] || this.nodeMicBufR[k].length !== szR) {
        this.nodeMicBufR[k] = new Float32Array(szR); this.nodeMicWR[k] = 0;
      }
      this.nodeMicMskL[k] = szL - 1; this.nodeMicLenL[k] = dL;
      this.nodeMicMskR[k] = szR - 1; this.nodeMicLenR[k] = dR;
      this.gkML[k] = 1.0 / (1.0 + rkML / rSk);  // eq (14)
      this.gkMR[k] = 1.0 / (1.0 + rkMR / rSk);
    }

    // LOS source→mic.
    const rSML = Math.max(0.1, dist(src, micL));
    const rSMR = Math.max(0.1, dist(src, micR));
    const dLL = Math.max(1, Math.floor(this.sr * rSML / C_SOUND));
    const dLR = Math.max(1, Math.floor(this.sr * rSMR / C_SOUND));
    const sLL = nextPow2(dLL), sLR = nextPow2(dLR);
    if (!this.losBufL || this.losBufL.length !== sLL) { this.losBufL = new Float32Array(sLL); this.losWL = 0; }
    if (!this.losBufR || this.losBufR.length !== sLR) { this.losBufR = new Float32Array(sLR); this.losWR = 0; }
    this.losMskL = sLL - 1; this.losLenL = dLL; this.losGL = 1.0 / rSML;
    this.losMskR = sLR - 1; this.losLenR = dLR; this.losGR = 1.0 / rSMR;

    // Wall absorption α from rt60 via Sabine (approx): α = 1 − exp(−13.82·V/(c·S·T60))
    // For a rectangular room of surface area S_total and volume V:
    const V = Lx * Ly * Lz;
    const S = 2 * (Lx*Ly + Lx*Lz + Ly*Lz);
    const T = Math.max(0.2, Math.min(8, this.p_rt60));
    let alpha = 1.0 - Math.exp(-13.82 * V / (C_SOUND * S * T));
    alpha = Math.max(0.02, Math.min(0.9, alpha));
    this.beta = Math.sqrt(1.0 - alpha);                 // eq (10)

    // Wall filter coef from damping (0..1) maps to 1-pole smoothing factor.
    const d01 = Math.max(0, Math.min(1, this.p_damping));
    this.wallA = 0.2 + 0.75 * d01;  // higher damping = more LP
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'rt60':    this.p_rt60    = Math.max(0.2, Math.min(8,  v)); this.recompute(); break;
      case 'size':    this.p_size    = Math.max(0.3, Math.min(3,  v)); this.recompute(); break;
      case 'damping': this.p_damping = Math.max(0,   Math.min(1,  v)); this.recompute(); break;
      case 'width':   this.p_width   = Math.max(0,   Math.min(1,  v)); this.recompute(); break;
    }
  }

  reset() {
    this.pIn.fill(0);
    this.wallZ.fill(0);
    for (let i = 0; i < this.edgeBuf.length; i++) if (this.edgeBuf[i]) { this.edgeBuf[i].fill(0); this.edgeW[i] = 0; }
    for (let k = 0; k < N_NODES; k++) {
      if (this.srcNodeBuf[k])  { this.srcNodeBuf[k].fill(0);  this.srcNodeW[k]  = 0; }
      if (this.nodeMicBufL[k]) { this.nodeMicBufL[k].fill(0); this.nodeMicWL[k] = 0; }
      if (this.nodeMicBufR[k]) { this.nodeMicBufR[k].fill(0); this.nodeMicWR[k] = 0; }
    }
    if (this.losBufL) { this.losBufL.fill(0); this.losWL = 0; }
    if (this.losBufR) { this.losBufR.fill(0); this.losWR = 0; }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inBuf = inputs && inputs.in ? inputs.in : null;
    const outL  = outputs && outputs.l ? outputs.l : null;
    const outR  = outputs && outputs.r ? outputs.r : null;
    if (!outL && !outR) return;
    if (!inBuf) {
      if (outL) outL.fill(0);
      if (outR) outR.fill(0);
      return;
    }

    const pIn   = this.pIn;
    const wallZ = this.wallZ;
    const wallA = this.wallA;
    const beta  = this.beta;
    const twoOverK = 2.0 / K;
    const micWeight = 2.0 / K;                          // simple w = (2/K)·1

    // Scratch per-sample.
    const pBarIn = new Float32Array(K);
    const pOut   = new Float32Array(K);

    for (let n = 0; n < N; n++) {
      const x = inBuf[n];

      // 1. Write source into source→node lines and LOS lines.
      for (let k = 0; k < N_NODES; k++) {
        const buf = this.srcNodeBuf[k];
        buf[this.srcNodeW[k]] = x;
        this.srcNodeW[k] = (this.srcNodeW[k] + 1) & this.srcNodeMsk[k];
      }
      this.losBufL[this.losWL] = x; this.losWL = (this.losWL + 1) & this.losMskL;
      this.losBufR[this.losWR] = x; this.losWR = (this.losWR + 1) & this.losMskR;

      // 2. LOS output.
      const rLosL = (this.losWL - this.losLenL) & this.losMskL;
      const rLosR = (this.losWR - this.losLenR) & this.losMskR;
      let yL = this.losBufL[rLosL] * this.losGL;
      let yR = this.losBufR[rLosR] * this.losGR;

      // 3. For each node: read 5 incoming waves, inject source, scatter,
      //    wall-filter, mic-tap, write outgoing into edge delays.
      for (let k = 0; k < N_NODES; k++) {
        // Read incoming p⁺[k][i] from inter-node delays m→k (m = neighbour).
        let sSum = 0;
        const nbrs = NEIGHBOURS[k];
        for (let i = 0; i < K; i++) {
          const m = nbrs[i];
          const idx = this._edgeIdx(m, k);       // line from m→k
          const buf = this.edgeBuf[idx];
          const msk = this.edgeMsk[idx];
          const len = this.edgeLen[idx];
          const rd  = (this.edgeW[idx] - len) & msk;
          pIn[k * K + i] = buf[rd];
        }

        // Inject source: p̄⁺ = p⁺ + (p_S/2)·1, with p_S = src*g_{S,k} (eq 8,11).
        const srcW  = this.srcNodeW[k];
        const srcMsk = this.srcNodeMsk[k];
        const srcLen = this.srcNodeLen[k];
        const srcBuf = this.srcNodeBuf[k];
        const pS = srcBuf[(srcW - srcLen) & srcMsk] * this.gSk[k];
        const half_pS = 0.5 * pS;
        for (let i = 0; i < K; i++) {
          pBarIn[i] = pIn[k * K + i] + half_pS;
          sSum += pBarIn[i];
        }

        // Scatter: p⁻[i] = (2/K)·s − p̄⁺[i]  (eq 5, K=5).
        for (let i = 0; i < K; i++) pOut[i] = twoOverK * sSum - pBarIn[i];

        // Wall filter H_k(z) + β absorption, per outgoing line.
        for (let i = 0; i < K; i++) {
          const zi = k * K + i;
          const filtered = (1.0 - wallA) * pOut[i] + wallA * wallZ[zi];
          wallZ[zi] = filtered;
          pOut[i]   = beta * filtered;
        }

        // Mic tap: Σ w·p⁻·g_{k,M} → node→mic delay line, read with its own D.
        // Post the *sum* w·Σp⁻  (w is (2/K)·1) so a single scalar enters line.
        let pMinusSum = 0;
        for (let i = 0; i < K; i++) pMinusSum += pOut[i];
        const micInjL = micWeight * pMinusSum * this.gkML[k];
        const micInjR = micWeight * pMinusSum * this.gkMR[k];
        this.nodeMicBufL[k][this.nodeMicWL[k]] = micInjL;
        this.nodeMicBufR[k][this.nodeMicWR[k]] = micInjR;
        const rdL = (this.nodeMicWL[k] - this.nodeMicLenL[k]) & this.nodeMicMskL[k];
        const rdR = (this.nodeMicWR[k] - this.nodeMicLenR[k]) & this.nodeMicMskR[k];
        yL += this.nodeMicBufL[k][rdL];
        yR += this.nodeMicBufR[k][rdR];
        this.nodeMicWL[k] = (this.nodeMicWL[k] + 1) & this.nodeMicMskL[k];
        this.nodeMicWR[k] = (this.nodeMicWR[k] + 1) & this.nodeMicMskR[k];

        // Write outgoing into node→neighbour edge delays (k → m).
        for (let i = 0; i < K; i++) {
          const m = nbrs[i];
          const idx = this._edgeIdx(k, m);
          const buf = this.edgeBuf[idx];
          const msk = this.edgeMsk[idx];
          buf[this.edgeW[idx]] = pOut[i];
          this.edgeW[idx] = (this.edgeW[idx] + 1) & msk;
        }
      }

      if (outL) outL[n] = yL;
      if (outR) outR[n] = yR;
    }
  }
}

