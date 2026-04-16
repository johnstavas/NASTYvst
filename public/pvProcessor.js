// pvProcessor.js — AudioWorklet phase vocoder pitch shifter
// Runs on the audio rendering thread (not the main JS thread).
// AudioWorklet process() fires every 128 samples; HOP=256 so a PV frame
// triggers every 2 process() calls via hopAccum accumulation.
// Parameters (k-rate): pitchRatio, harmonyRatio, harmonyGain
// Smart bypass: when pitchRatio≈1 AND harmonyGain≈0, outputs silence so the
// dry path (outside this node) handles the signal at zero CPU cost.

const TWO_PI    = Math.PI * 2;
const N         = 1024; // 23ms window — fine pitch resolution, musical on voices
const HOP       = 256;  // 75% overlap (N/4) — balances quality vs latency
const BINS      = N >> 1;
const OLA_NORM  = 2.0 / 3.0;
const PHASE_INC = TWO_PI * HOP / N;

// ── Pre-computed Hann window ──────────────────────────────────────────────
const WIN = new Float32Array(N);
for (let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / N);

// ── Pre-computed twiddle factor table ────────────────────────────────────
// TWIDDLE[k] = e^(-2πi·k/N).  Computed once at module load so no Math.cos/
// Math.sin ever runs inside the FFT hot loop.
// For stage s, butterfly j uses TWIDDLE[j * (N/s)].
const TWIDDLE_RE = new Float32Array(N);
const TWIDDLE_IM = new Float32Array(N);
for (let k = 0; k < N; k++) {
  TWIDDLE_RE[k] = Math.cos(-TWO_PI * k / N);
  TWIDDLE_IM[k] = Math.sin(-TWO_PI * k / N);
}

// ── In-place Cooley–Tukey FFT (twiddle-table version) ────────────────────
// ~60% fewer multiplications vs the iterative-cr/ci approach: no complex
// multiply needed to advance the twiddle — just a direct indexed lookup.
function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Butterfly stages — twiddle factor read directly from table
  for (let s = 2; s <= n; s <<= 1) {
    const h    = s >> 1;
    const step = n / s; // TWIDDLE[j*step] = e^(-2πij/s)
    for (let k = 0; k < n; k += s) {
      for (let j = 0; j < h; j++) {
        const wr = TWIDDLE_RE[j * step];
        const wi = TWIDDLE_IM[j * step];
        const ur = re[k+j],       ui = im[k+j];
        const vr = re[k+j+h]*wr - im[k+j+h]*wi;
        const vi = re[k+j+h]*wi + im[k+j+h]*wr;
        re[k+j]   = ur+vr; im[k+j]   = ui+vi;
        re[k+j+h] = ur-vr; im[k+j+h] = ui-vi;
      }
    }
  }
}

function ifft(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  const inv = 1.0 / n;
  for (let i = 0; i < n; i++) { re[i] *= inv; im[i] = -im[i] * inv; }
}

// ── Phase vocoder channel state ───────────────────────────────────────────
function makePV() {
  const IN_SIZE  = N * 4;
  const OUT_SIZE = N * 8;
  return {
    inRing:     new Float32Array(IN_SIZE),  inMask:  IN_SIZE  - 1, inWrite: 0, hopAccum: 0,
    lastPhase:  new Float32Array(BINS + 1),
    synthPhase: new Float32Array(BINS + 1),
    re:  new Float32Array(N), im:  new Float32Array(N),
    oRe: new Float32Array(N), oIm: new Float32Array(N),
    outBuf:  new Float32Array(OUT_SIZE), outMask: OUT_SIZE - 1,
    outWrite: N, outRead: 0,
  };
}

function runFrame(st, ratio) {
  const { re, im, oRe, oIm, lastPhase, synthPhase, inRing, inMask } = st;

  // Fill analysis frame from ring buffer, apply Hann window
  const base = st.inWrite - N + inRing.length;
  for (let i = 0; i < N; i++) {
    re[i] = inRing[(base + i) & inMask] * WIN[i];
    im[i] = 0;
  }
  fft(re, im);

  oRe.fill(0); oIm.fill(0);

  for (let k = 0; k <= BINS; k++) {
    const j    = k / ratio;
    if (j > BINS) continue;
    const j0   = j | 0;
    const j1   = j0 < BINS ? j0 + 1 : BINS;
    const frac = j - j0;

    const m0sq = re[j0]*re[j0] + im[j0]*im[j0];
    if (m0sq < 1e-10) { synthPhase[k] += k * PHASE_INC; continue; }

    const m0  = Math.sqrt(m0sq);
    const m1  = Math.sqrt(re[j1]*re[j1] + im[j1]*im[j1]);
    const m   = m0 + (m1 - m0) * frac;

    const ph  = Math.atan2(im[j0], re[j0]);
    let diff  = ph - lastPhase[j0] - j0 * PHASE_INC;
    diff     -= TWO_PI * Math.round(diff / TWO_PI);

    synthPhase[k] += (j0 + diff / PHASE_INC) * ratio * PHASE_INC;
    oRe[k] = m * Math.cos(synthPhase[k]);
    oIm[k] = m * Math.sin(synthPhase[k]);
  }

  // Save analysis phases, mirror spectrum for real IFFT
  for (let k = 0; k <= BINS; k++) lastPhase[k] = Math.atan2(im[k], re[k]);
  for (let k = 1; k < BINS;  k++) { oRe[N-k] = oRe[k]; oIm[N-k] = -oIm[k]; }
  oIm[0] = 0; oIm[BINS] = 0;

  ifft(oRe, oIm);

  // Overlap-add synthesis with OLA normalisation
  const outMask = st.outMask;
  let   outW    = st.outWrite;
  for (let i = 0; i < N; i++) {
    st.outBuf[(outW + i) & outMask] += oRe[i] * WIN[i] * OLA_NORM;
  }
  st.outWrite = (outW + HOP) & outMask;
}

function processChannelPV(st, inp, out, ratio) {
  const inMask  = st.inMask;
  const outMask = st.outMask;
  for (let i = 0; i < inp.length; i++) {
    st.inRing[st.inWrite & inMask] = inp[i];
    st.inWrite++;
    if (++st.hopAccum >= HOP) { st.hopAccum = 0; runFrame(st, ratio); }
    out[i] = st.outBuf[st.outRead & outMask];
    st.outBuf[st.outRead & outMask] = 0;
    st.outRead = (st.outRead + 1) & outMask;
  }
}

// ── AudioWorklet processor ────────────────────────────────────────────────
class PVProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchRatio',   defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'harmonyRatio', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'harmonyGain',  defaultValue: 0.0, minValue: 0.0,  maxValue: 1.0, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.pvCh  = [makePV(), makePV()];
    this.pvCh2 = [makePV(), makePV()];
    this.t1    = [new Float32Array(128), new Float32Array(128)];
    this.t2    = [new Float32Array(128), new Float32Array(128)];
  }

  process(inputs, outputs, parameters) {
    const pitchRatio   = parameters.pitchRatio[0];
    const harmonyRatio = parameters.harmonyRatio[0];
    const harmonyGain  = parameters.harmonyGain[0];

    // Smart bypass — dry path carries signal, zero CPU spent here
    if (Math.abs(pitchRatio - 1.0) < 0.001 && harmonyGain < 0.001) return true;

    const input  = inputs[0];
    const output = outputs[0];
    const nCh    = input ? input.length : 0;

    for (let c = 0; c < Math.min(Math.max(nCh, 1), 2); c++) {
      const inp = input?.[c] ?? input?.[0];
      const out = output?.[c];
      if (!inp || !out) continue;

      const t1 = this.t1[c];
      processChannelPV(this.pvCh[c], inp, t1, pitchRatio);

      if (harmonyGain > 0.001) {
        const t2 = this.t2[c];
        processChannelPV(this.pvCh2[c], inp, t2, harmonyRatio);
        const g2 = 0.5 * harmonyGain;
        for (let i = 0; i < out.length; i++) out[i] = t1[i] * 0.5 + t2[i] * g2;
      } else {
        out.set(t1);
      }
    }
    return true;
  }
}

registerProcessor('pv-processor', PVProcessor);
