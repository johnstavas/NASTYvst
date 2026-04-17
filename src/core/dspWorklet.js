// dspWorklet.js — Shared AudioWorklet runtime for the new unified FX core.
//
// Hosts the IDspModule contract, primitives (DelayLine, LFO, filters,
// smoothers, soft sat) and the high-quality DelayModule that becomes the
// substrate for every time-based / modulation plugin.
//
// Loaded as a string blob via fxEngine.js → audioWorklet.addModule(blobUrl).
//
// Layering inside this file:
//   PRIMITIVES      → tiny reusable DSP atoms
//   IDspModule      → interface contract
//   DelayModule     → first concrete module
//   FxProcessor     → AudioWorkletProcessor host that owns the module list

export const WORKLET_SOURCE = `

// =====================================================================
//  PRIMITIVES
// =====================================================================

// ---- Two-stage parameter smoother (block 1-pole feeding sample 1-pole).
// Block coefficient handles macro-rate jumps; sample coefficient kills
// any residual zipper at audio rate. Schlecht-style energy-preserving
// rotation isn't needed here (just a control signal), but DelayLine
// uses the same idea for time-varying read pointers below.
class ParamSmoother {
  constructor(initial = 0, blockTauMs = 25, sampleTauMs = 5) {
    this.target = initial;
    this.block  = initial;
    this.value  = initial;
    this._sr = 48000;
    this._blockMs = blockTauMs;
    this._sampleMs = sampleTauMs;
    this._aBlock = 0;
    this._aSample = 0;
  }
  prepare(sr, blockSize) {
    this._sr = sr;
    // Block coefficient runs once per render quantum.
    const blockHz = sr / blockSize;
    this._aBlock  = 1 - Math.exp(-1 / (blockHz * (this._blockMs / 1000)));
    this._aSample = 1 - Math.exp(-1 / (sr   * (this._sampleMs / 1000)));
  }
  setTarget(v) { if (Number.isFinite(v)) this.target = v; }
  snap(v)      { this.target = this.block = this.value = v; }
  // Call once per block; pulls block toward target.
  tickBlock()  { this.block += (this.target - this.block) * this._aBlock; }
  // Call per sample; pulls value toward block.
  tickSample() { this.value += (this.block  - this.value) * this._aSample; return this.value; }
}

// ---- Circular delay line with 3rd-order Lagrange interpolation and a
// time-varying read pointer that is itself smoothed (avoids Doppler clicks
// when delayTime is modulated).
//
// All-pass fractional interp would alias less for slow mod, Lagrange-3 is
// a good general choice; both are documented in jos_pasp_dsp_reference.md.
class DelayLine {
  constructor(maxSeconds = 4) {
    this._maxSec = maxSeconds;
    this.buf = null;
    this.size = 0;
    this.wp = 0;
  }
  prepare(sr) {
    this.size = Math.ceil(sr * this._maxSec) + 4;
    this.buf  = new Float32Array(this.size);
    this.wp   = 0;
  }
  reset() { if (this.buf) this.buf.fill(0); this.wp = 0; }
  write(x) {
    this.buf[this.wp] = x;
    if (++this.wp >= this.size) this.wp = 0;
  }
  // Read with delay 'd' samples (fractional). 3rd-order Lagrange.
  read(d) {
    const N = this.size;
    if (!(d >= 0)) d = 0;               // NaN / negative guard (NaN fails the >= test)
    if (d > N - 4) d = N - 4;           // keep Lagrange 4-tap window inside buffer
    let rp = this.wp - d;
    while (rp < 0) rp += N;
    while (rp >= N) rp -= N;
    const i  = rp | 0;
    const f  = rp - i;
    const im1 = (i - 1 + N) % N;
    const ip1 = (i + 1) % N;
    const ip2 = (i + 2) % N;
    const x0 = this.buf[im1];
    const x1 = this.buf[i];
    const x2 = this.buf[ip1];
    const x3 = this.buf[ip2];
    // Lagrange-3 weights
    const c0 = -(1/6) * f * (f - 1) * (f - 2);
    const c1 =  (1/2) * (f + 1) * (f - 1) * (f - 2);
    const c2 = -(1/2) * (f + 1) * f * (f - 2);
    const c3 =  (1/6) * (f + 1) * f * (f - 1);
    return c0*x0 + c1*x1 + c2*x2 + c3*x3;
  }
}

// ---- 1-pole LP / HP and a bipolar tilt EQ.
class OnePoleLP {
  constructor(){ this.z = 0; this.a = 0; }
  setHz(hz, sr){ this.a = 1 - Math.exp(-2 * Math.PI * hz / sr); }
  process(x){ this.z += this.a * (x - this.z); return this.z; }
  reset(){ this.z = 0; }
}
class OnePoleHP {
  constructor(){ this.zx = 0; this.zy = 0; this.a = 0; }
  setHz(hz, sr){
    const w = 2 * Math.PI * hz / sr;
    this.a = 1 / (1 + w);
  }
  process(x){
    const y = this.a * (this.zy + x - this.zx);
    this.zx = x; this.zy = y;
    return y;
  }
  reset(){ this.zx = this.zy = 0; }
}

// ---- LFO (sin/tri/sq/SH) with phase-stable rate change.
class LFO {
  constructor(){ this.phase = 0; this.shape = 0; this.hz = 1; this.shVal = 0; this.shCnt = 0; }
  setShape(s){ this.shape = s | 0; }
  setRate(hz){ this.hz = hz; }
  reset(){ this.phase = 0; this.shVal = 0; this.shCnt = 0; }
  // Returns -1..+1
  tick(sr){
    const inc = this.hz / sr;
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    const p = this.phase;
    switch (this.shape) {
      case 1: return p < 0.5 ? (4*p - 1) : (3 - 4*p);            // tri
      case 2: return p < 0.5 ? 1 : -1;                            // sq
      case 3: {                                                   // S&H
        if (this.shCnt <= 0) {
          this.shVal = Math.random() * 2 - 1;
          this.shCnt = Math.max(1, (sr / Math.max(0.01, this.hz)) | 0);
        }
        this.shCnt--;
        return this.shVal;
      }
      default: return Math.sin(2 * Math.PI * p);                  // sin
    }
  }
}

// ---- DC blocker.
class DcBlock {
  constructor(){ this.zx = 0; this.zy = 0; this.r = 0.995; }
  process(x){ const y = x - this.zx + this.r * this.zy; this.zx = x; this.zy = y; return y; }
  reset(){ this.zx = this.zy = 0; }
}

// ---- Soft saturator (tanh-ish, cheap rational form).
function softSat(x){ return x / (1 + Math.abs(x)); }


// =====================================================================
//  IDspModule — interface contract
// =====================================================================
//
//   prepare(sr, maxBlock, channels)
//   reset()
//   process(inL, inR, outL, outR, n)   // operates in place; mono-safe
//   latencySamples()                   // for PDC reporting
//   tailSamples()                      // for offline render tail
//
// Modules read parameters via this.params (object of ParamSmoother).
// The processor host calls tickBlock() once per block on every smoother,
// then the module calls tickSample() inside the per-sample loop.

class IDspModule {
  constructor(){ this.params = {}; this._sr = 48000; }
  prepare(sr /*, maxBlock, channels*/){ this._sr = sr; for (const k in this.params) this.params[k].prepare(sr, 128); }
  reset(){}
  process(/*inL,inR,outL,outR,n*/){}
  latencySamples(){ return 0; }
  tailSamples(){ return 0; }
}


// =====================================================================
//  DelayModule — high-quality stereo delay (substrate for time/mod plugins)
// =====================================================================
//
// Features:
//   • Independent L/R delay times, smoothed (true tape-style pitch shift on jumps)
//   • Stereo modes: 0=Stereo, 1=Ping-pong, 2=Cross-feed
//   • Wow + Flutter LFOs (slow + fast) with depth control
//   • HF damping (1-pole LP) + LF cut (1-pole HP) in feedback path
//   • Soft saturation in feedback (tape-style limit on runaway)
//   • DC blocker on output
//   • Per-module Mix (equal-power), reported latency = 0 (zero look-ahead)
//
// Suitable as the engine for: TapeDelay, Echoform, Playbox, Drift,
// short-pre-delay reverb feed, modulation-line for chorus/flange.

class DelayModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      timeL    : new ParamSmoother(0.300, 50, 25),  // sec — long block tau for tape pitch
      timeR    : new ParamSmoother(0.300, 50, 25),
      feedback : new ParamSmoother(0.45,  25, 5),
      stereoMode: new ParamSmoother(0,    25, 5),
      wowDepth : new ParamSmoother(0.0,   25, 5),   // 0..1 → 0..6ms
      wowRate  : new ParamSmoother(0.6,   25, 5),   // Hz
      flutterDepth: new ParamSmoother(0.0,25, 5),   // 0..1 → 0..1ms
      flutterRate : new ParamSmoother(7.0,25, 5),
      damp     : new ParamSmoother(0.5,   25, 5),   // 0..1 → 18kHz..1.2kHz
      lowCut   : new ParamSmoother(80,    25, 5),   // Hz
      drive    : new ParamSmoother(0.0,   25, 5),   // 0..1 feedback saturation
      mix      : new ParamSmoother(0.35,  25, 5),
    };
    this.dlL = new DelayLine(4);
    this.dlR = new DelayLine(4);
    this.lpL = new OnePoleLP(); this.lpR = new OnePoleLP();
    this.hpL = new OnePoleHP(); this.hpR = new OnePoleHP();
    this.dcL = new DcBlock();   this.dcR = new DcBlock();
    this.wow = new LFO();       this.wow.setShape(0);
    this.flt = new LFO();       this.flt.setShape(1);
    this._fbL = 0; this._fbR = 0;
  }
  prepare(sr, maxBlock, ch){
    super.prepare(sr, maxBlock, ch);
    this.dlL.prepare(sr); this.dlR.prepare(sr);
  }
  reset(){
    this.dlL.reset(); this.dlR.reset();
    this.lpL.reset(); this.lpR.reset();
    this.hpL.reset(); this.hpR.reset();
    this.dcL.reset(); this.dcR.reset();
    this.wow.reset(); this.flt.reset();
    this._fbL = this._fbR = 0;
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params;
    // Per-block: tick smoothers and re-derive coefficients that depend on slow params
    for (const k in P) P[k].tickBlock();
    const dampHz   = 1200 + (1 - P.damp.block) * (18000 - 1200);
    this.lpL.setHz(dampHz, sr); this.lpR.setHz(dampHz, sr);
    this.hpL.setHz(P.lowCut.block, sr); this.hpR.setHz(P.lowCut.block, sr);
    this.wow.setRate(P.wowRate.block);
    this.flt.setRate(P.flutterRate.block);
    const stereoMode = P.stereoMode.block | 0;

    for (let i = 0; i < n; i++) {
      // Sample-rate smoothing of the small / fast params
      const fb    = P.feedback.tickSample();
      const wDep  = P.wowDepth.tickSample();
      const fDep  = P.flutterDepth.tickSample();
      const drv   = P.drive.tickSample();
      const mix   = P.mix.tickSample();
      const tL    = P.timeL.tickSample();
      const tR    = P.timeR.tickSample();
      // Discard sample-rate ticks for already-applied block params:
      P.damp.tickSample(); P.lowCut.tickSample(); P.wowRate.tickSample();
      P.flutterRate.tickSample(); P.stereoMode.tickSample();

      // Modulation: wow (slow, ~6ms) + flutter (fast, ~1ms)
      const wow  = this.wow.tick(sr);
      const flut = this.flt.tick(sr);
      const modSec = wow * wDep * 0.006 + flut * fDep * 0.001;

      const dSampL = Math.max(2, (tL + modSec) * sr);
      const dSampR = Math.max(2, (tR + modSec) * sr);

      // Cross-feed routing into the write nodes
      let writeL, writeR;
      const xL = inL[i], xR = inR[i];
      switch (stereoMode) {
        case 1: writeL = xL + this._fbR; writeR = xR + this._fbL; break;       // ping-pong
        case 2: writeL = xL + 0.5*this._fbL + 0.5*this._fbR;                    // cross-feed
                writeR = xR + 0.5*this._fbR + 0.5*this._fbL; break;
        default: writeL = xL + this._fbL; writeR = xR + this._fbR;              // stereo
      }
      this.dlL.write(writeL);
      this.dlR.write(writeR);

      // Read taps
      const yL = this.dlL.read(dSampL);
      const yR = this.dlR.read(dSampR);

      // Feedback path: HP → LP → soft sat (tape limit)
      let fL = this.hpL.process(this.lpL.process(yL));
      let fR = this.hpR.process(this.lpR.process(yR));
      const k = 1 + 4 * drv;
      fL = softSat(fL * k);
      fR = softSat(fR * k);
      this._fbL = fL * fb;
      this._fbR = fR * fb;

      // Output: equal-power dry/wet, DC block on wet
      const wL = this.dcL.process(yL);
      const wR = this.dcR.process(yR);
      const dryG = Math.cos(mix * Math.PI * 0.5);
      const wetG = Math.sin(mix * Math.PI * 0.5);
      outL[i] = xL * dryG + wL * wetG;
      outR[i] = xR * dryG + wR * wetG;
    }
  }
  latencySamples(){ return 0; }
  tailSamples(){
    // ~5 seconds at 96% feedback worst case; clamp to 8 sec
    return (this._sr * 8) | 0;
  }
}


// =====================================================================
//  DiffuserModule — short Schroeder-allpass diffusion (BLUR primitive)
// =====================================================================
//
// 4 cascaded allpass sections per channel, prime-spaced to avoid coloration.
// Reusable later for reverb pre-diffusion. Wet-only (mix=1 effective);
// engine-level mix happens in the FxProcessor chain runner.

class AllpassDelay {
  constructor(maxLen){ this.buf = new Float32Array(maxLen); this.size = maxLen; this.wp = 0; this.len = maxLen; this.g = 0.5; }
  setLen(l){ this.len = Math.min(this.size - 1, Math.max(2, l | 0)); }
  setG(g){ this.g = g; }
  reset(){ this.buf.fill(0); this.wp = 0; }
  process(x){
    const N = this.size;
    let rp = this.wp - this.len; if (rp < 0) rp += N;
    const d = this.buf[rp];
    const v = x + d * this.g;          // allpass canonical (Gardner form)
    const y = d - v * this.g;
    this.buf[this.wp] = v;
    if (++this.wp >= N) this.wp = 0;
    return y;
  }
}

class DiffuserModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      amount : new ParamSmoother(0.0, 25, 5),   // 0..1 → allpass g 0..0.78
      size   : new ParamSmoother(0.5, 25, 5),   // 0..1 → length scale
    };
    // Prime-spaced base lengths in samples @ 48k (~1, 3, 7, 13 ms)
    this._base = [ 47, 113, 337, 631 ];
    this.apL = this._base.map(b => new AllpassDelay(b * 4 + 8));
    this.apR = this._base.map(b => new AllpassDelay(b * 4 + 8));
  }
  reset(){ for (const a of this.apL) a.reset(); for (const a of this.apR) a.reset(); }
  process(inL, inR, outL, outR, n){
    const P = this.params; for (const k in P) P[k].tickBlock();
    const g    = Math.min(0.78, P.amount.block * 0.78);
    const sz   = 0.5 + P.size.block * 1.5;     // 0.5x..2x base
    for (let i = 0; i < this._base.length; i++) {
      const L = (this._base[i] * sz) | 0;
      this.apL[i].setLen(L); this.apL[i].setG(g);
      this.apR[i].setLen(L * 1.07); this.apR[i].setG(g);  // slight L/R offset
    }
    for (let i = 0; i < n; i++) {
      // discard sample-rate ticks (block-only params)
      P.amount.tickSample(); P.size.tickSample();
      let xL = inL[i], xR = inR[i];
      for (let s = 0; s < this.apL.length; s++) { xL = this.apL[s].process(xL); xR = this.apR[s].process(xR); }
      outL[i] = xL; outR[i] = xR;
    }
  }
}


// =====================================================================
//  ToneModule — generic LP/HP shaping with optional 2-pole cascade
// =====================================================================

class ToneModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      lpHz   : new ParamSmoother(16000, 25, 5),
      hpHz   : new ParamSmoother(20,    25, 5),
      stages : new ParamSmoother(1,     25, 5),  // 1 or 2
    };
    this.lpL1 = new OnePoleLP(); this.lpR1 = new OnePoleLP();
    this.lpL2 = new OnePoleLP(); this.lpR2 = new OnePoleLP();
    this.hpL  = new OnePoleHP(); this.hpR  = new OnePoleHP();
  }
  reset(){ this.lpL1.reset(); this.lpR1.reset(); this.lpL2.reset(); this.lpR2.reset(); this.hpL.reset(); this.hpR.reset(); }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params; for (const k in P) P[k].tickBlock();
    const lpHz = Math.max(200, P.lpHz.block);
    const hpHz = Math.max(10,  P.hpHz.block);
    this.lpL1.setHz(lpHz, sr); this.lpR1.setHz(lpHz, sr);
    this.lpL2.setHz(lpHz, sr); this.lpR2.setHz(lpHz, sr);
    this.hpL.setHz(hpHz, sr);  this.hpR.setHz(hpHz, sr);
    const twoStage = P.stages.block >= 1.5;
    for (let i = 0; i < n; i++) {
      P.lpHz.tickSample(); P.hpHz.tickSample(); P.stages.tickSample();
      let yL = this.hpL.process(this.lpL1.process(inL[i]));
      let yR = this.hpR.process(this.lpR1.process(inR[i]));
      if (twoStage) { yL = this.lpL2.process(yL); yR = this.lpR2.process(yR); }
      outL[i] = yL; outR[i] = yR;
    }
  }
}


// =====================================================================
//  TapeMultiTapModule — one tape loop, 3 read heads (TapeDelay primitive)
// =====================================================================
//
// Generic multi-tap delay: a single circular DelayLine per channel feeds
// 3 independently-positioned read taps. Each tap has on/gain/pan and
// contributes to both output and (selectable) feedback. Wow/flutter
// modulate the read positions equally (heads share a transport).
//
// Reusable for: TapeDelay, multitap delays, slap+long combos.

class TapeMultiTapModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      time1   : new ParamSmoother(0.167, 50, 25),
      time2   : new ParamSmoother(0.334, 50, 25),
      time3   : new ParamSmoother(0.501, 50, 25),
      vol1    : new ParamSmoother(0.75,  25, 5),
      vol2    : new ParamSmoother(0.75,  25, 5),
      vol3    : new ParamSmoother(0.75,  25, 5),
      on1     : new ParamSmoother(1,     25, 5),
      on2     : new ParamSmoother(0,     25, 5),
      on3     : new ParamSmoother(0,     25, 5),
      feedback: new ParamSmoother(0.40,  25, 5),
      damp    : new ParamSmoother(0.5,   25, 5),
      lowCut  : new ParamSmoother(80,    25, 5),
      drive   : new ParamSmoother(0.30,  25, 5),
      wowDepth: new ParamSmoother(0.35,  25, 5),
      wowRate : new ParamSmoother(0.7,   25, 5),
      fltDepth: new ParamSmoother(0.0,   25, 5),
      fltRate : new ParamSmoother(7.0,   25, 5),
      spread  : new ParamSmoother(0.5,   25, 5),  // 0..1 head L/R pan spread
      mix     : new ParamSmoother(1.0,   25, 5),  // typically 1 inside chain
    };
    this.dlL = new DelayLine(2.6);
    this.dlR = new DelayLine(2.6);
    this.lpL = new OnePoleLP(); this.lpR = new OnePoleLP();
    this.hpL = new OnePoleHP(); this.hpR = new OnePoleHP();
    this.dcL = new DcBlock();   this.dcR = new DcBlock();
    this.wow = new LFO();       this.wow.setShape(0);
    this.flt = new LFO();       this.flt.setShape(1);
    this._fbL = 0; this._fbR = 0;
  }
  prepare(sr, mb, ch){ super.prepare(sr, mb, ch); this.dlL.prepare(sr); this.dlR.prepare(sr); }
  reset(){
    this.dlL.reset(); this.dlR.reset();
    this.lpL.reset(); this.lpR.reset();
    this.hpL.reset(); this.hpR.reset();
    this.dcL.reset(); this.dcR.reset();
    this.wow.reset(); this.flt.reset();
    this._fbL = this._fbR = 0;
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params;
    for (const k in P) P[k].tickBlock();
    const dampHz = 1200 + (1 - P.damp.block) * (16800);
    this.lpL.setHz(dampHz, sr); this.lpR.setHz(dampHz, sr);
    this.hpL.setHz(P.lowCut.block, sr); this.hpR.setHz(P.lowCut.block, sr);
    this.wow.setRate(P.wowRate.block);
    this.flt.setRate(P.fltRate.block);
    const sp = Math.min(1, Math.max(0, P.spread.block));
    // Per-head pan: head1 left, head2 center, head3 right (scaled by spread)
    const panL = [ 1 - 0.5*sp,  1,  1 - 1.0*sp ];
    const panR = [ 1 - 1.0*sp,  1,  1 - 0.5*sp ];

    for (let i = 0; i < n; i++) {
      const t1 = P.time1.tickSample(), t2 = P.time2.tickSample(), t3 = P.time3.tickSample();
      const v1 = P.vol1.tickSample(),  v2 = P.vol2.tickSample(),  v3 = P.vol3.tickSample();
      const o1 = P.on1.tickSample()>0.5?1:0, o2 = P.on2.tickSample()>0.5?1:0, o3 = P.on3.tickSample()>0.5?1:0;
      const fb  = P.feedback.tickSample();
      const drv = P.drive.tickSample();
      const wD  = P.wowDepth.tickSample();
      const fD  = P.fltDepth.tickSample();
      const mix = P.mix.tickSample();
      P.damp.tickSample(); P.lowCut.tickSample(); P.wowRate.tickSample();
      P.fltRate.tickSample(); P.spread.tickSample();

      const wow  = this.wow.tick(sr);
      const flt  = this.flt.tick(sr);
      const modSec = wow * wD * 0.005 + flt * fD * 0.0008;

      // Write: input + feedback (drive baked in via softSat in fb path)
      const xL = inL[i], xR = inR[i];
      this.dlL.write(xL + this._fbL);
      this.dlR.write(xR + this._fbR);

      // Read 3 taps (shared transport — same modSec on all)
      const d1L = Math.max(2, (t1 + modSec) * sr);
      const d2L = Math.max(2, (t2 + modSec) * sr);
      const d3L = Math.max(2, (t3 + modSec) * sr);
      const r1L = this.dlL.read(d1L), r1R = this.dlR.read(d1L);
      const r2L = this.dlL.read(d2L), r2R = this.dlR.read(d2L);
      const r3L = this.dlL.read(d3L), r3R = this.dlR.read(d3L);

      // Sum heads (pre-pan = direct, then panned into stereo bus)
      const sumL = o1*v1*(r1L*panL[0]) + o2*v2*(r2L*panL[1]) + o3*v3*(r3L*panL[2]);
      const sumR = o1*v1*(r1R*panR[0]) + o2*v2*(r2R*panR[1]) + o3*v3*(r3R*panR[2]);

      // Feedback path: tap-summed → HP → LP → softSat
      let fL = this.hpL.process(this.lpL.process(sumL));
      let fR = this.hpR.process(this.lpR.process(sumR));
      const k = 1 + 4*drv;
      fL = softSat(fL * k);
      fR = softSat(fR * k);
      this._fbL = fL * fb;
      this._fbR = fR * fb;

      // Output (DC blocked) with internal mix
      const wL = this.dcL.process(sumL);
      const wR = this.dcR.process(sumR);
      const dG = Math.cos(mix * Math.PI * 0.5);
      const wG = Math.sin(mix * Math.PI * 0.5);
      outL[i] = xL * dG + wL * wG;
      outR[i] = xR * dG + wR * wG;
    }
  }
  latencySamples(){ return 0; }
  tailSamples(){ return (this._sr * 8) | 0; }
}


// =====================================================================
//  TapeCharacterModule — tape voice color (no time behavior)
// =====================================================================
//
// Reusable color block. Wholly orthogonal to TapeMultiTapModule:
//   • hiss + hum noise floor
//   • transformer / preamp gentle saturation + tilt color
//   • slow tape-style program compression
//   • age/wear tone (HF rolloff + LF lift)
//   • optional very-slow stereo gain & micro-delay mismatch
//
// Any product can opt in by chaining it in; bypassed-effective when all
// level params are 0 (still costs ops — products should drop it from the
// chain when not needed).

class TapeCharacterModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      hiss      : new ParamSmoother(0.0,   25, 5),   // 0..1 → ~ -90..-50 dBFS pink-ish
      hum       : new ParamSmoother(0.0,   25, 5),   // 0..1 → fundamental + 3rd
      humHz     : new ParamSmoother(60,    25, 5),   // 50 or 60
      xfmrDrive : new ParamSmoother(0.25,  25, 5),   // 0..1 transformer soft sat
      xfmrColor : new ParamSmoother(0.30,  25, 5),   // 0..1 low-mid bump strength
      compAmount: new ParamSmoother(0.30,  25, 5),   // 0..1 soft program comp
      age       : new ParamSmoother(0.20,  25, 5),   // 0..1 worn-tape tone
      stereoDrift:new ParamSmoother(0.0,   25, 5),   // 0..1 slow L/R mismatch
    };
    // Transformer: tilt = LP shelf state + DC blocker
    this.xfmrLpL = new OnePoleLP(); this.xfmrLpR = new OnePoleLP();
    this.ageLpL  = new OnePoleLP(); this.ageLpR  = new OnePoleLP();
    this.ageHpL  = new OnePoleHP(); this.ageHpR  = new OnePoleHP();
    this.dcL     = new DcBlock();   this.dcR     = new DcBlock();
    // Comp envelope (mono detector) — slow tape feel
    this._env = 0;
    // Hum phases
    this._humP = 0; this._humP3 = 0;
    // Pink noise: 4-stage LP cascade on white
    this.hissLp1 = new OnePoleLP(); this.hissLp2 = new OnePoleLP();
    // Stereo drift random walk
    this._drL = 1; this._drR = 1;
    this._drCnt = 0;
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    // Permanent coefficients
    this.hissLp1.setHz(8000, sr); this.hissLp2.setHz(2200, sr);
  }
  reset(){
    this.xfmrLpL.reset(); this.xfmrLpR.reset();
    this.ageLpL.reset();  this.ageLpR.reset();
    this.ageHpL.reset();  this.ageHpR.reset();
    this.dcL.reset();     this.dcR.reset();
    this.hissLp1.reset(); this.hissLp2.reset();
    this._env = 0; this._humP = 0; this._humP3 = 0;
    this._drL = this._drR = 1; this._drCnt = 0;
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params; for (const k in P) P[k].tickBlock();
    // Block-derived coefficients
    const xfmrTiltHz = 1200 + (1 - P.xfmrColor.block) * 6000; // 1.2k..7.2k
    this.xfmrLpL.setHz(xfmrTiltHz, sr); this.xfmrLpR.setHz(xfmrTiltHz, sr);
    const ageHz   = 18000 - P.age.block * 12000;              // 18k..6k
    const ageLfHz = 80    - P.age.block * 40;                 // 80..40
    this.ageLpL.setHz(ageHz, sr); this.ageLpR.setHz(ageHz, sr);
    this.ageHpL.setHz(ageLfHz, sr); this.ageHpR.setHz(ageLfHz, sr);
    const humInc  = 2 * Math.PI * P.humHz.block / sr;
    const hum3Inc = 3 * humInc;
    // Comp: slow attack ~30ms, release ~250ms
    const aAtk = 1 - Math.exp(-1 / (sr * 0.030));
    const aRel = 1 - Math.exp(-1 / (sr * 0.250));
    // Drift refresh interval (~80ms)
    const drInterval = (sr * 0.08) | 0;

    for (let i = 0; i < n; i++) {
      const hiss = P.hiss.tickSample();
      const hum  = P.hum.tickSample();
      const xD   = P.xfmrDrive.tickSample();
      const cA   = P.compAmount.tickSample();
      const sD   = P.stereoDrift.tickSample();
      P.humHz.tickSample(); P.xfmrColor.tickSample();
      P.age.tickSample();

      let xL = inL[i], xR = inR[i];

      // 1) Slow program compression (mono detector, stereo-linked GR)
      const det = Math.max(Math.abs(xL), Math.abs(xR));
      const a   = det > this._env ? aAtk : aRel;
      this._env += (det - this._env) * a;
      // ~3 dB GR @ env=1 when cA=1, soft knee
      const gr = 1 / (1 + cA * this._env * 0.7);
      xL *= gr; xR *= gr;

      // 2) Transformer: tilt-LP blend + soft sat
      const tL = this.xfmrLpL.process(xL);
      const tR = this.xfmrLpR.process(xR);
      // Bump = original − LP-shifted (mild presence dip / low warmth)
      xL = xL * 0.7 + tL * 0.3;
      xR = xR * 0.7 + tR * 0.3;
      const k = 1 + 2.5 * xD;
      xL = softSat(xL * k);
      xR = softSat(xR * k);

      // 3) Age tone: HF rolloff + LF tightening
      xL = this.ageHpL.process(this.ageLpL.process(xL));
      xR = this.ageHpR.process(this.ageLpR.process(xR));

      // 4) Hiss (pink-ish): two-stage LP'd white, low-level
      if (hiss > 0.0001) {
        const w = (Math.random() * 2 - 1);
        const p = this.hissLp2.process(this.hissLp1.process(w));
        const lvl = hiss * 0.012;  // ~ -38 dBFS at hiss=1; tame default
        xL += p * lvl;
        xR += p * lvl * 0.95;     // tiny decorrelation
      }

      // 5) Hum: 60 Hz fundamental + 180 Hz 3rd, low-level
      if (hum > 0.0001) {
        this._humP  += humInc;  if (this._humP  > Math.PI*2) this._humP  -= Math.PI*2;
        this._humP3 += hum3Inc; if (this._humP3 > Math.PI*2) this._humP3 -= Math.PI*2;
        const h = (Math.sin(this._humP) + 0.35 * Math.sin(this._humP3)) * hum * 0.006;
        xL += h; xR += h;
      }

      // 6) Stereo drift (very slow random walk on L/R gain)
      if (sD > 0.001) {
        if (--this._drCnt <= 0) {
          this._drCnt = drInterval;
          const wob = sD * 0.04;  // ±4% gain wobble at sD=1
          this._drL = 1 + (Math.random()*2-1) * wob;
          this._drR = 1 + (Math.random()*2-1) * wob;
        }
        xL *= this._drL; xR *= this._drR;
      }

      outL[i] = this.dcL.process(xL);
      outR[i] = this.dcR.process(xR);
    }
  }
}


// =====================================================================
//  CombBankModule — N parallel feedback combs (Freeverb-style topology)
// =====================================================================
//
// Pure DSP primitive. Owns: 4 parallel feedback combs per channel with
// per-comb feedback-path 1-pole LP (damp), global crossfeed at write, and
// length modulation that is APPLIED EXTERNALLY (mod0..mod3 params written
// by product layer / future ModMatrix). NO LFO inside the module.
//
// Reusable for: Smear, PlateX (with N=8 + dynamic-fb extension later),
// Orbit (subset of 3 combs), any classic Schroeder reverb backbone.

class CombFilter {
  constructor(maxLen){
    this.buf = new Float32Array(maxLen);
    this.size = maxLen;
    this.wp = 0;
    this.lp = 0;
    this.len = (maxLen/2)|0;
  }
  setLen(l){ this.len = Math.min(this.size - 1, Math.max(2, l|0)); }
  reset(){ this.buf.fill(0); this.wp = 0; this.lp = 0; }
  process(x, fb, damp){
    const N = this.size;
    let rp = this.wp - this.len; if (rp < 0) rp += N;
    const d = this.buf[rp];
    // Freeverb-style damp: lp = lp*damp + d*(1-damp)
    this.lp = this.lp * damp + d * (1 - damp);
    this.buf[this.wp] = x + this.lp * fb;
    if (++this.wp >= N) this.wp = 0;
    return d;
  }
}

class CombBankModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      fb        : new ParamSmoother(0.7,  25, 5),
      crossfeed : new ParamSmoother(0.0,  25, 5),
      damp      : new ParamSmoother(0.3,  25, 5),
      sizeScale : new ParamSmoother(1.0,  50, 25),
      mod0      : new ParamSmoother(0,    25, 5),  // -1..+1
      mod1      : new ParamSmoother(0,    25, 5),
      mod2      : new ParamSmoother(0,    25, 5),
      mod3      : new ParamSmoother(0,    25, 5),
      mix       : new ParamSmoother(1.0,  25, 5),
    };
    // Freeverb-derived base comb times in ms (scaled by sizeScale at runtime).
    this._baseMs = [ 35.3, 36.7, 33.8, 32.2 ];
    this._stereoOffsetMs = 0.52;       // ~23 samples @ 44.1k
    this._maxModSamples = 64;
    this.combsL = null;
    this.combsR = null;
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    // Allocate generously: max sizeScale=2.0 plus headroom + mod range.
    const maxSamp = (Math.max(...this._baseMs) * 0.001 * sr * 2.2 + this._maxModSamples + 8) | 0;
    this.combsL = this._baseMs.map(() => new CombFilter(maxSamp));
    this.combsR = this._baseMs.map(() => new CombFilter(maxSamp));
  }
  reset(){
    if (!this.combsL) return;
    for (const c of this.combsL) c.reset();
    for (const c of this.combsR) c.reset();
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params;
    for (const k in P) P[k].tickBlock();
    const fb        = P.fb.block;
    const cf        = Math.min(0.5, P.crossfeed.block);
    const damp      = Math.min(0.95, Math.max(0, P.damp.block));
    const sizeScale = Math.max(0.3, Math.min(2.0, P.sizeScale.block));
    const stOff     = (this._stereoOffsetMs * 0.001 * sr) | 0;
    const mods      = [P.mod0.block, P.mod1.block, P.mod2.block, P.mod3.block];
    const maxMod    = this._maxModSamples;
    for (let k = 0; k < this._baseMs.length; k++) {
      const baseSamp = (this._baseMs[k] * 0.001 * sr * sizeScale) | 0;
      const modSamp  = (mods[k] * maxMod) | 0;
      this.combsL[k].setLen(baseSamp + modSamp);
      this.combsR[k].setLen(baseSamp + stOff + modSamp);
    }
    for (let i = 0; i < n; i++) {
      // Discard sample-rate ticks for already-applied block params
      P.fb.tickSample(); P.crossfeed.tickSample(); P.damp.tickSample();
      P.sizeScale.tickSample(); P.mod0.tickSample(); P.mod1.tickSample();
      P.mod2.tickSample(); P.mod3.tickSample();
      const mix = P.mix.tickSample();
      // Write side: input + crossfed sum (computed from previous outputs)
      // Sum 4 combs per channel
      const xL = inL[i], xR = inR[i];
      // Cross-feed at write: feed (1-cf)*ownSide + cf*otherSide previous?
      // Simpler form: write input, sum on the read side, blend cross at write next sample.
      // To keep one-sample causal: cross is applied via a previous-block sum stored as state.
      // Simplest robust: feed input only; combs apply own fb internally. Crossfeed is implemented
      // as a write-side L<->R blend of the input (Smear taste).
      const wL = xL * (1 - cf) + xR * cf;
      const wR = xR * (1 - cf) + xL * cf;
      let sumL = 0, sumR = 0;
      for (let k = 0; k < this.combsL.length; k++) {
        sumL += this.combsL[k].process(wL, fb, damp);
        sumR += this.combsR[k].process(wR, fb, damp);
      }
      sumL *= 0.25; sumR *= 0.25;
      const dG = Math.cos(mix * Math.PI * 0.5);
      const wG = Math.sin(mix * Math.PI * 0.5);
      outL[i] = xL * dG + sumL * wG;
      outR[i] = xR * dG + sumR * wG;
    }
  }
  tailSamples(){ return (this._sr * 6) | 0; }
}


// =====================================================================
//  TiltEqModule — single bipolar tilt around fixed crossover (~1 kHz)
// =====================================================================
//
// One param ('tilt' 0..1, 0.5 = neutral). Tilt > 0.5 brightens (HF
// boost, LF cut); < 0.5 darkens. Crossover defaults to 1 kHz; exposed
// as a param for products that want a different pivot.

class TiltEqModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      tilt      : new ParamSmoother(0.5,  25, 5),
      crossover : new ParamSmoother(1000, 25, 5),
    };
    this.lpL = new OnePoleLP(); this.lpR = new OnePoleLP();
  }
  reset(){ this.lpL.reset(); this.lpR.reset(); }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params; for (const k in P) P[k].tickBlock();
    const tilt = (Math.min(1, Math.max(0, P.tilt.block)) - 0.5) * 2; // -1..+1
    const xo   = Math.max(80, Math.min(8000, P.crossover.block));
    this.lpL.setHz(xo, sr); this.lpR.setHz(xo, sr);
    const lG = 1 - tilt * 0.7;   // ±70% gain swing on lows
    const hG = 1 + tilt * 0.7;   // and highs
    for (let i = 0; i < n; i++) {
      P.tilt.tickSample(); P.crossover.tickSample();
      const lpL = this.lpL.process(inL[i]);
      const lpR = this.lpR.process(inR[i]);
      const hpL = inL[i] - lpL;
      const hpR = inR[i] - lpR;
      outL[i] = lpL * lG + hpL * hG;
      outR[i] = lpR * lG + hpR * hG;
    }
  }
}


// =====================================================================
//  FdnReverbModule — 8-channel Householder FDN (generic late-field engine)
// =====================================================================
//
// Geraint Luff / reverb_engine_architecture.md reference topology.
//   • 8 mono delay lines, prime-adjacent base lengths (ms)
//   • Householder matrix (x -= 2/N · sum) — unitary, O(N)
//   • Per-line feedback gain from RT60: g = 10^(-3·D/(decay·sr))
//   • Per-line HF damping shelf (1-pole LP inside feedback path)
//   • Per-channel fractional-delay LFOs for WARP (internal — FDN warp is
//     intrinsic character, not an external routing target)
//   • Input spray from L/R using the first Householder row sign pattern
//   • Output mix: even channels → L, odd → R
//
// Reusable for: MorphReverb, Gravity (with 4-ch option later), ReverbBus,
// NearFar.

class FdnReverbModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      decay    : new ParamSmoother(2.5,   50, 25),  // sec
      sizeScale: new ParamSmoother(1.0,   50, 25),
      dampHz   : new ParamSmoother(6000,  25, 5),
      modDepth : new ParamSmoother(0.3,   25, 5),
      modRate  : new ParamSmoother(0.5,   25, 5),
      inputGain: new ParamSmoother(0.5,   25, 5),
      mix      : new ParamSmoother(1.0,   25, 5),
    };
    // Prime-adjacent base lengths in ms — Geraint Luff style geometric spread.
    this._baseMs = [ 23.6, 31.7, 38.9, 47.3, 56.1, 65.7, 71.2, 83.5 ];
    this._N = 8;
    // First Householder row sign pattern (±1) for input spray
    this._spray = [ 1, 1, 1, -1, 1, -1, -1, 1 ];
    this.lines = null;
    this.damps = null;
    this.lfoPhase = new Float32Array(this._N);
    for (let k = 0; k < this._N; k++) this.lfoPhase[k] = k * 0.618;
    this._v = new Float32Array(this._N);   // per-sample channel vector
    this._maxModSamples = 24;
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    this.lines = this._baseMs.map(() => new DelayLine(0.25));  // 250 ms each at SIZE=2 → generous
    this.damps = this._baseMs.map(() => new OnePoleLP());
    for (const l of this.lines) l.prepare(sr);
  }
  reset(){
    if (!this.lines) return;
    for (const l of this.lines) l.reset();
    for (const d of this.damps) d.reset();
    this._v.fill(0);
    for (let k = 0; k < this._N; k++) this.lfoPhase[k] = k * 0.618;
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params; for (const k in P) P[k].tickBlock();
    const N          = this._N;
    const decay      = Math.max(0.1, P.decay.block);
    const sizeScale  = Math.max(0.3, Math.min(2.0, P.sizeScale.block));
    const dampHz     = Math.max(500, Math.min(18000, P.dampHz.block));
    const modDepth   = Math.max(0,   Math.min(1, P.modDepth.block));
    const modRate    = Math.max(0.01, P.modRate.block);
    const inputGain  = P.inputGain.block;
    // Per-line length (samples) and feedback gain from RT60
    const lenSamp = new Array(N);
    const gLine   = new Array(N);
    for (let k = 0; k < N; k++) {
      const D = (this._baseMs[k] * 0.001 * sr * sizeScale);
      lenSamp[k] = D;
      // g = 10^(-3·D/(decay·sr))  — with ceiling to stay stable
      gLine[k] = Math.min(0.999, Math.pow(10, -3 * D / (decay * sr)));
      this.damps[k].setHz(dampHz, sr);
    }
    const lfoInc = (2 * Math.PI * modRate) / sr;
    const maxMod = this._maxModSamples * modDepth;
    const v = this._v;

    for (let i = 0; i < n; i++) {
      // sample-rate ticks (no audio use; maintain smoother consistency)
      P.decay.tickSample(); P.sizeScale.tickSample(); P.dampHz.tickSample();
      P.modDepth.tickSample(); P.modRate.tickSample();
      const ig  = P.inputGain.tickSample();
      const mix = P.mix.tickSample();
      // 1) Read each channel with per-channel mod offset
      for (let k = 0; k < N; k++) {
        this.lfoPhase[k] += lfoInc;
        if (this.lfoPhase[k] > 2 * Math.PI) this.lfoPhase[k] -= 2 * Math.PI;
        const off = Math.sin(this.lfoPhase[k]) * maxMod;
        const read = this.lines[k].read(Math.max(2, lenSamp[k] + off));
        v[k] = this.damps[k].process(read) * gLine[k];
      }
      // 2) Householder: f = (sum)·(2/N); a[k] -= f
      let sum = 0;
      for (let k = 0; k < N; k++) sum += v[k];
      const f = sum * (2 / N);
      for (let k = 0; k < N; k++) v[k] -= f;
      // 3) Add input spray and write
      const inMono = (inL[i] + inR[i]) * 0.5 * inputGain * ig;
      for (let k = 0; k < N; k++) {
        this.lines[k].write(v[k] + inMono * this._spray[k]);
      }
      // 4) Output: even → L, odd → R
      const wL = (v[0] + v[2] + v[4] + v[6]) * 0.5;
      const wR = (v[1] + v[3] + v[5] + v[7]) * 0.5;
      const dG = Math.cos(mix * Math.PI * 0.5);
      const wG = Math.sin(mix * Math.PI * 0.5);
      outL[i] = inL[i] * dG + wL * wG;
      outR[i] = inR[i] * dG + wR * wG;
    }
  }
  latencySamples(){ return 0; }
  tailSamples(){ return (this._sr * 12) | 0; }
}


// =====================================================================
//  EarlyReflectionsModule — multi-tap stereo ER generator (generic)
// =====================================================================
//
// Pure FIR multi-tap. Two delay lines (L/R), N=8 taps per channel, prime-ish
// base times with independent R-side offsets for decorrelation. Tap gains
// follow a mild geometric decay. 'size' scales all tap times together;
// 'spread' scales the L/R offset (0=mono taps, 1=full spread); 'density'
// progressively activates taps (soft ramp across the set). Owns no
// feedback — the late field lives in FdnReverb.
//
// Consumers: Gravity (ER front-end before FDN), MorphReverb (optional ER
// prefix later), ReverbBus, NearFar.

class EarlyReflectionsModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      size    : new ParamSmoother(1.0, 25, 5),   // 0.3..2.0 scales tap times
      spread  : new ParamSmoother(0.7, 25, 5),   // 0..1 L/R offset scale
      density : new ParamSmoother(0.8, 25, 5),   // 0..1 tap activation
      mix     : new ParamSmoother(1.0, 25, 5),   // 0..1
    };
    // Tap base times (ms) — irregular, prime-adjacent spacing
    this._baseMs = [ 11.3, 17.9, 24.1, 31.7, 43.3, 55.7, 67.1, 83.9 ];
    // Per-tap L→R offsets (ms) for stereo decorrelation
    this._offMs  = [  0.6,  1.4,  2.1,  3.0,  3.8,  2.7,  4.6,  5.3 ];
    // Tap gain weights — slight geometric falloff (early taps loudest)
    this._gain   = [ 1.00, 0.82, 0.70, 0.60, 0.50, 0.42, 0.35, 0.28 ];
    this._N = 8;
    this.dlL = new DelayLine(0.3);
    this.dlR = new DelayLine(0.3);
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    this.dlL.prepare(sr);
    this.dlR.prepare(sr);
  }
  reset(){ this.dlL.reset(); this.dlR.reset(); }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P = this.params; for (const k in P) P[k].tickBlock();
    const N         = this._N;
    const size      = Math.max(0.3, Math.min(2.0, P.size.block));
    const spread    = Math.max(0,   Math.min(1,   P.spread.block));
    const density   = Math.max(0,   Math.min(1,   P.density.block));
    // Precompute tap sample offsets and density-weighted gains
    const dL = new Array(N), dR = new Array(N), g = new Array(N);
    for (let k = 0; k < N; k++) {
      dL[k] = this._baseMs[k] * 0.001 * sr * size;
      dR[k] = (this._baseMs[k] + this._offMs[k] * spread) * 0.001 * sr * size;
      // Soft density ramp: tap k fully on when density·N > k+1, fades over 1 unit
      const act = Math.max(0, Math.min(1, density * N - k));
      g[k] = this._gain[k] * act;
    }
    for (let i = 0; i < n; i++) {
      P.size.tickSample(); P.spread.tickSample(); P.density.tickSample();
      const mix = P.mix.tickSample();
      this.dlL.write(inL[i]);
      this.dlR.write(inR[i]);
      let aL = 0, aR = 0;
      for (let k = 0; k < N; k++) {
        aL += this.dlL.read(dL[k]) * g[k];
        aR += this.dlR.read(dR[k]) * g[k];
      }
      // Mild overall trim so summed taps stay near unity
      aL *= 0.55; aR *= 0.55;
      const dG = Math.cos(mix * Math.PI * 0.5);
      const wG = Math.sin(mix * Math.PI * 0.5);
      outL[i] = inL[i] * dG + aL * wG;
      outR[i] = inR[i] * dG + aR * wG;
    }
  }
  latencySamples(){ return 0; }
  tailSamples(){ return (this._sr * 0.2) | 0; }
}


// =====================================================================
//  WidthModule — generic stereo M/S width (0=mono, 1=stereo, 2=super-wide)
// =====================================================================
//
// Single param. Decodes input to M/S, scales S by width, re-encodes.
// Also closes the Echoform WIDTH<1 mono-collapse gap retroactively.

class WidthModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      width: new ParamSmoother(1.0, 25, 5),   // 0..2
    };
  }
  process(inL, inR, outL, outR, n){
    const P = this.params; P.width.tickBlock();
    for (let i = 0; i < n; i++) {
      const w = Math.max(0, Math.min(2, P.width.tickSample()));
      const xL = inL[i], xR = inR[i];
      const m  = (xL + xR) * 0.5;
      const s  = (xL - xR) * 0.5 * w;
      outL[i] = m + s;
      outR[i] = m - s;
    }
  }
}


// =====================================================================
//  LevelDetector — per-sample peak / RMS / hybrid level (helper class)
// =====================================================================
//
// Not a palette module. Used by CompressorModule (and future dynamics
// modules: Expander, Limiter, Gate, Ducker). Single-channel input per
// tick; stereo is handled by the owning module with two instances.
// Modes: 0 = peak, 1 = RMS, 2 = hybrid (max of peak and √2·rms).

class LevelDetector {
  constructor(){
    this._ms = 0;                 // mean-square accumulator
    this._rmsCoef = 0.99;         // one-pole smoothing coef for RMS window
    this._sr = 48000;
  }
  prepare(sr, rmsWindowMs = 5){
    this._sr = sr;
    this.setWindow(rmsWindowMs);
  }
  setWindow(rmsWindowMs){
    this._rmsCoef = Math.exp(-1 / Math.max(1e-6, rmsWindowMs * 0.001 * this._sr));
  }
  reset(){ this._ms = 0; }
  tick(x, mode){
    const peak = Math.abs(x);
    this._ms = this._rmsCoef * this._ms + (1 - this._rmsCoef) * (x * x);
    const rms = Math.sqrt(this._ms);
    if (mode === 1) return rms;
    if (mode === 2) return Math.max(peak, rms * 1.41421356);
    return peak;
  }
}


// =====================================================================
//  GainComputer — threshold / ratio / soft-knee curve (helper class)
// =====================================================================
//
// Not a palette module. Stateless (params are set per block). Feeds
// CompressorModule. Standard feedforward soft-knee (Giannoulis/Reiss).
//   xdB in (level in dBFS), gain-reduction dB out (≤ 0).

class GainComputer {
  constructor(){
    this.threshold = -18;
    this.ratio     = 4;
    this.knee      = 6;
    this._slope    = (1 / 4) - 1;    // 1/ratio − 1
  }
  set(threshold, ratio, knee){
    this.threshold = threshold;
    this.ratio     = Math.max(1, ratio);
    this.knee      = Math.max(0, knee);
    this._slope    = (1 / this.ratio) - 1;    // ≤ 0
  }
  computeDb(xdB){
    const over = xdB - this.threshold;
    const k    = this.knee;
    if (k > 0 && 2 * Math.abs(over) <= k) {
      const t = over + k * 0.5;
      return this._slope * (t * t) / (2 * k);
    }
    if (over <= 0) return 0;
    return this._slope * over;
  }
}


// =====================================================================
//  EnvelopeFollowerModule — audio pass-through + sidechain level source
// =====================================================================
//
// Generic control-source module. Reads stereo input, tracks peak envelope
// (separate attack/release coeffs), passes audio through UNCHANGED, and
// posts the envelope value back to the main thread at ~50 Hz via the
// shared processor port. Main-thread wrappers subscribe and route the
// level to any param (CombBank.fb for PlateX choke, engineMix for
// ReverbBus ducker, future auto-gain, etc.).
//
// Design choice: control-rate messaging (not a shared sidechain bus) is
// sufficient for all planned consumers (plate choke ~10-100 ms, duck
// attack 10-50 ms). When a product actually needs sample-accurate
// sidechain, a bus primitive can be added then.

class EnvelopeFollowerModule extends IDspModule {
  constructor(port){
    super();
    this._port = port;  // shared FxProcessor port, injected at construction
    this.params = {
      attackMs : new ParamSmoother(5,    50, 25),
      releaseMs: new ParamSmoother(120,  50, 25),
      sense    : new ParamSmoother(1.0,  25, 5),   // output scale 0..4
    };
    this._env = 0;
    this._sinceMsg = 0;
    this._msgEvery = 0;  // computed in prepare
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    this._msgEvery = Math.max(1, (sr / 50) | 0);  // ~50 Hz
  }
  reset(){ this._env = 0; this._sinceMsg = 0; }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P = this.params; for (const k in P) P[k].tickBlock();
    const atkMs = Math.max(0.1, P.attackMs.block);
    const relMs = Math.max(1,   P.releaseMs.block);
    const sense = Math.max(0, P.sense.block);
    const atkC  = Math.exp(-1 / (atkMs * 0.001 * sr));
    const relC  = Math.exp(-1 / (relMs * 0.001 * sr));
    let env = this._env;
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(inL[i]), Math.abs(inR[i]));
      if (x > env) env = atkC * env + (1 - atkC) * x;
      else         env = relC * env + (1 - relC) * x;
      outL[i] = inL[i];
      outR[i] = inR[i];
    }
    this._env = env;
    this._sinceMsg += n;
    if (this._sinceMsg >= this._msgEvery) {
      this._sinceMsg = 0;
      if (this._port) this._port.postMessage({ type: 'envLevel', value: env * sense });
    }
  }
  latencySamples(){ return 0; }
}


// =====================================================================
//  CompressorModule — generic dynamics processor (palette index 12)
// =====================================================================
//
// Classic VCA-comp topology:
//   per-sample:
//     lvl     = LevelDetector.tick(x, mode)          // peak / RMS / hybrid
//     xdB     = 20·log10(lvl)
//     grInst  = GainComputer.computeDb(xdB)          // ≤ 0
//     grSm    = asymmetric smoother in dB (atk on drop, rel on recover)
//     gainLin = 10^((grSm + makeup)/20)
//     out     = in·(1−mix) + in·gainLin·mix           // parallel-friendly
//
// Two LevelDetector instances (L, R). Stereo link = common max level
// drives both channels' gain smoothers. Feedforward topology.
// Attack/release live in the gain (dB) domain.
//
// Reused by: LVL-2A (opto, program-dependent release via product timer),
// GlueSmash (1176 flavour), Panther Buss (bus glue), mastering tools.

class CompressorModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      threshold : new ParamSmoother(-18, 25, 5),
      ratio     : new ParamSmoother(4,   50, 25),
      knee      : new ParamSmoother(6,   50, 25),
      attackMs  : new ParamSmoother(10,  50, 25),
      releaseMs : new ParamSmoother(120, 50, 25),
      makeupDb  : new ParamSmoother(0,   25, 5),
      detectMode: new ParamSmoother(0,   50, 25),   // 0 peak / 1 rms / 2 hybrid
      stereoLink: new ParamSmoother(1,   50, 25),
      mix       : new ParamSmoother(1,   25, 5),
    };
    this._detL = new LevelDetector();
    this._detR = new LevelDetector();
    this._comp = new GainComputer();
    this._grDbL = 0;   // smoothed gain reduction (dB, ≤ 0)
    this._grDbR = 0;
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    this._detL.prepare(sr);
    this._detR.prepare(sr);
  }
  reset(){
    this._detL.reset(); this._detR.reset();
    this._grDbL = 0; this._grDbR = 0;
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P = this.params; for (const k in P) P[k].tickBlock();
    const threshold = P.threshold.block;
    const ratio     = P.ratio.block;
    const knee      = P.knee.block;
    const atkMs     = Math.max(0.1, P.attackMs.block);
    const relMs     = Math.max(1,   P.releaseMs.block);
    const makeup    = P.makeupDb.block;
    const mode      = Math.max(0, Math.min(2, Math.round(P.detectMode.block)));
    const linked    = P.stereoLink.block > 0.5;
    const atkC = Math.exp(-1 / (atkMs * 0.001 * sr));
    const relC = Math.exp(-1 / (relMs * 0.001 * sr));
    this._comp.set(threshold, ratio, knee);
    // RMS window tied to attack time (clamped 1..50 ms) so detector
    // integration matches program response without a user-facing knob.
    const rmsMs = Math.max(1, Math.min(50, atkMs * 0.5));
    this._detL.setWindow(rmsMs);
    this._detR.setWindow(rmsMs);
    let grL = this._grDbL, grR = this._grDbR;
    for (let i = 0; i < n; i++) {
      // Per-sample smoother ticks for interpolation consistency
      P.threshold.tickSample(); P.ratio.tickSample(); P.knee.tickSample();
      P.attackMs.tickSample();  P.releaseMs.tickSample();
      const mk = P.makeupDb.tickSample();
      const mx = Math.max(0, Math.min(1, P.mix.tickSample()));
      const xL = inL[i], xR = inR[i];
      let lL = this._detL.tick(xL, mode);
      let lR = this._detR.tick(xR, mode);
      // Link selector — structured for future modes (e.g. min-link,
      // mid-side, RMS-average). Today only MAX_LINK is active.
      switch (linked ? 1 : 0) {
        case 1: {                           // MAX_LINK: common worst-case
          const m = Math.max(lL, lR);
          lL = m; lR = m;
          break;
        }
        default: /* INDEPENDENT: per-channel levels unchanged */ break;
      }
      // Level floor before log — guarantees finite xdB on silence.
      if (lL < 1e-9) lL = 1e-9;
      if (lR < 1e-9) lR = 1e-9;
      const xdBL = 20 * Math.log10(lL);
      const xdBR = 20 * Math.log10(lR);
      const giL  = this._comp.computeDb(xdBL);
      const giR  = this._comp.computeDb(xdBR);
      // Attack when gain drops (more negative), release when recovering.
      grL = (giL < grL) ? atkC * grL + (1 - atkC) * giL
                        : relC * grL + (1 - relC) * giL;
      grR = (giR < grR) ? atkC * grR + (1 - atkC) * giR
                        : relC * grR + (1 - relC) * giR;
      // Safety clamp — GR must never be positive.
      if (grL > 0) grL = 0;
      if (grR > 0) grR = 0;
      const gL = Math.pow(10, (grL + mk) / 20);
      const gR = Math.pow(10, (grR + mk) / 20);
      outL[i] = xL * (1 - mx) + xL * gL * mx;
      outR[i] = xR * (1 - mx) + xR * gR * mx;
    }
    // Self-heal: if input NaN contaminated the smoother, reset so the
    // channel recovers rather than staying stuck at NaN forever.
    this._grDbL = Number.isFinite(grL) ? grL : 0;
    this._grDbR = Number.isFinite(grR) ? grR : 0;
  }
  latencySamples(){ return 0; }
}


// =====================================================================
//  LimiterModule — brick-wall peak limiter (palette index 13)
// =====================================================================
//
// Reuses LevelDetector (peak) + GainComputer (hard-knee, ratio=100).
// Adds a short lookahead buffer so gain is already applied when the
// triggering peak arrives at the output — the behaviour that
// distinguishes a limiter from a fast compressor.
//
//   signal ─► lookahead DelayLine ─► delayed × gainLin ─► out
//             │
//             └► LevelDetector (peak) ─► GainComputer ─► dB smoother
//                (attack time == lookaheadMs; release from param)
//
// Reports latencySamples() = round(lookaheadMs · sr / 1000). When
// lookaheadMs = 0 the limiter runs zero-latency with a fixed 0.05 ms
// attack — still useful as a transparent ceiling when latency is
// unacceptable (live monitoring).

class LimiterModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      ceiling    : new ParamSmoother(-0.3, 25, 5),     // dB
      releaseMs  : new ParamSmoother(80,   50, 25),
      lookaheadMs: new ParamSmoother(2.0,  50, 25),
      mix        : new ParamSmoother(1.0,  25, 5),
    };
    this._detL = new LevelDetector();
    this._detR = new LevelDetector();
    this._gc   = new GainComputer();
    this._grDb = 0;                      // shared (true-stereo link; peak limiter)
    this._bufL = null; this._bufR = null;
    this._bufSize = 0; this._wp = 0;
    this._latency = 0;
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    this._detL.prepare(sr, 1);           // RMS window unused (peak only); harmless
    this._detR.prepare(sr, 1);
    // Max lookahead buffer sized for 5 ms at current SR
    this._bufSize = Math.max(2, Math.ceil(sr * 0.005) + 4);
    this._bufL = new Float32Array(this._bufSize);
    this._bufR = new Float32Array(this._bufSize);
    this._wp = 0;
    this._gc.set(-0.3, 100, 0);          // hard-knee, high ratio
  }
  reset(){
    this._detL.reset(); this._detR.reset();
    this._grDb = 0;
    if (this._bufL) { this._bufL.fill(0); this._bufR.fill(0); }
    this._wp = 0;
  }
  latencySamples(){ return this._latency; }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P = this.params; for (const k in P) P[k].tickBlock();
    const ceiling = P.ceiling.block;
    const relMs   = Math.max(1, P.releaseMs.block);
    const laMs    = Math.max(0, Math.min(5, P.lookaheadMs.block));
    const mix     = P.mix.block;
    // Lookahead in samples (integer for the circular read)
    const laSamp  = Math.max(0, Math.min(this._bufSize - 1, Math.round(laMs * 0.001 * sr)));
    this._latency = laSamp;
    // Attack coefficient: ~40% of lookahead so GR is ~2.5τ settled when the
    // peak reaches the output (prevents the ~37% overshoot of atk==laMs).
    // Floored at 0.1 ms; 0.05 ms zero-latency fallback when laMs == 0.
    const atkMs = laMs > 0 ? Math.max(0.1, laMs * 0.4) : 0.05;
    const atkC  = Math.exp(-1 / (atkMs * 0.001 * sr));
    const relC  = Math.exp(-1 / (relMs * 0.001 * sr));
    this._gc.set(ceiling, 100, 0);
    const bufL = this._bufL, bufR = this._bufR, N = this._bufSize;
    let wp = this._wp, gr = this._grDb;
    for (let i = 0; i < n; i++) {
      P.ceiling.tickSample(); P.releaseMs.tickSample(); P.lookaheadMs.tickSample();
      const mx = Math.max(0, Math.min(1, P.mix.tickSample()));
      const xL = inL[i], xR = inR[i];
      // Detect on incoming sample (the "future" sample from the output's POV)
      const lL = this._detL.tick(xL, 0);
      const lR = this._detR.tick(xR, 0);
      let lvl  = Math.max(lL, lR);
      if (lvl < 1e-9) lvl = 1e-9;
      const xdB   = 20 * Math.log10(lvl);
      const giDb  = this._gc.computeDb(xdB);   // ≤ 0
      gr = (giDb < gr) ? atkC * gr + (1 - atkC) * giDb
                       : relC * gr + (1 - relC) * giDb;
      if (gr > 0) gr = 0;                      // safety clamp
      const gLin = Math.pow(10, gr / 20);
      // Write incoming sample, read delayed sample
      bufL[wp] = xL; bufR[wp] = xR;
      let rp = wp - laSamp; if (rp < 0) rp += N;
      const dL = bufL[rp], dR = bufR[rp];
      if (++wp >= N) wp = 0;
      const wLim = mx;
      outL[i] = dL * (1 - wLim) + dL * gLin * wLim;
      outR[i] = dR * (1 - wLim) + dR * gLin * wLim;
    }
    this._wp = wp;
    this._grDb = Number.isFinite(gr) ? gr : 0;
  }
}


// =====================================================================
//  SaturatorModule — generic nonlinearity with ADAA-1 (palette index 14)
// =====================================================================
//
// One per-sample nonlinear stage with selectable curve and antiderivative
// anti-aliasing. Signal path:
//
//   in ─► pre-gain(drive) ─► f_curve (ADAA) ─► DC-HP ─► post-gain ─► mix ─► out
//
// Curves (all have closed-form antiderivatives → exact ADAA-1):
//   0 Soft  : tanh(x)                       F(x) = log cosh(x)
//   1 Hard  : clip(x, -1, 1)                F(x) = piecewise (C1 at ±1)
//   2 Tube  : tanh(k⁺·x) for x≥0,           F(x) = (1/k²)·log cosh(k·x) each side
//             tanh(k⁻·x) for x<0            (both zero at x=0 → continuous)
//
// ADAA-1 formula:  y = (F(x) − F(xPrev)) / (x − xPrev)
// Denominator < 1e-6 falls back to f((x+xPrev)/2).
//
// Reused by distortion-family products via product-layer curve / drive /
// asym mapping. No tone shaping inside — compose with TiltEq or
// TapeCharacter in the chain for voicing.

// Stable log(cosh(x)) without overflow at high drive.
function _logCosh(x){
  const ax = Math.abs(x);
  return ax + Math.log1p(Math.exp(-2 * ax)) - 0.6931471805599453; // − log(2)
}

class SaturatorModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      drive    : new ParamSmoother(12,  25, 5),    // dB pre-gain
      curve    : new ParamSmoother(0,   50, 25),   // 0..2 (rounded in worklet)
      asym     : new ParamSmoother(0.35, 50, 25),
      outputDb : new ParamSmoother(0,   25, 5),
      aa       : new ParamSmoother(1,   50, 25),   // 0/1
      mix      : new ParamSmoother(1.0, 25, 5),
    };
    this._xPrevL = 0; this._xPrevR = 0;
    this._FPrevL = 0; this._FPrevR = 0;
    // DC HP state (one-pole, 20 Hz) — per channel
    this._hpL = 0; this._hpR = 0;
    this._hpCoef = 0.999;
  }
  prepare(sr, mb, ch){
    super.prepare(sr, mb, ch);
    // y[n] = a·(y[n-1] + x[n] − x[n-1]), a = exp(-2π·fc/sr)
    this._hpCoef = Math.exp(-2 * Math.PI * 20 / sr);
    this._hpXL = 0; this._hpXR = 0; this._hpL = 0; this._hpR = 0;
  }
  reset(){
    this._xPrevL = this._xPrevR = 0;
    this._FPrevL = this._FPrevR = 0;
    this._hpL = this._hpR = 0;
    this._hpXL = this._hpXR = 0;
  }
  // Nonlinearity and its antiderivative for a given curve and asym.
  _f(x, curve, kPos, kNeg){
    switch (curve) {
      case 1: return x < -1 ? -1 : (x > 1 ? 1 : x);
      case 2: return x >= 0 ? Math.tanh(kPos * x) : Math.tanh(kNeg * x);
      default: return Math.tanh(x);
    }
  }
  _F(x, curve, kPos, kNeg){
    switch (curve) {
      case 1: {
        const ax = Math.abs(x);
        return ax < 1 ? (x * x) * 0.5 : ax - 0.5;
      }
      case 2: {
        const k = x >= 0 ? kPos : kNeg;
        return _logCosh(k * x) / (k * k);
      }
      default: return _logCosh(x);
    }
  }
  process(inL, inR, outL, outR, n){
    const P = this.params; for (const k in P) P[k].tickBlock();
    const driveDb = P.drive.block;
    const curve   = Math.max(0, Math.min(2, Math.round(P.curve.block)));
    const asym    = Math.max(0, Math.min(1, P.asym.block));
    const outDb   = P.outputDb.block;
    const aaOn    = P.aa.block > 0.5;
    const mix     = P.mix.block;
    const preG    = Math.pow(10, driveDb / 20);
    const postG   = Math.pow(10, outDb  / 20);
    const kPos    = 1 + asym;
    const kNeg    = Math.max(0.25, 1 - 0.5 * asym);
    const hpA     = this._hpCoef;
    // Per-sample loop
    let xpL = this._xPrevL, xpR = this._xPrevR;
    let FpL = this._FPrevL, FpR = this._FPrevR;
    let hpYL = this._hpL,   hpYR = this._hpR;
    let hpXL = this._hpXL,  hpXR = this._hpXR;
    for (let i = 0; i < n; i++) {
      P.drive.tickSample(); P.curve.tickSample(); P.asym.tickSample();
      P.outputDb.tickSample(); P.aa.tickSample();
      const mx = Math.max(0, Math.min(1, P.mix.tickSample()));
      const xL = inL[i] * preG;
      const xR = inR[i] * preG;
      // Nonlinearity
      let yL, yR;
      if (aaOn) {
        const FL = this._F(xL, curve, kPos, kNeg);
        const dL = xL - xpL;
        yL = Math.abs(dL) > 1e-6 ? (FL - FpL) / dL
                                 : this._f(0.5 * (xL + xpL), curve, kPos, kNeg);
        if (!Number.isFinite(yL)) yL = this._f(xL, curve, kPos, kNeg);
        FpL = FL;
        const FR = this._F(xR, curve, kPos, kNeg);
        const dR = xR - xpR;
        yR = Math.abs(dR) > 1e-6 ? (FR - FpR) / dR
                                 : this._f(0.5 * (xR + xpR), curve, kPos, kNeg);
        if (!Number.isFinite(yR)) yR = this._f(xR, curve, kPos, kNeg);
        FpR = FR;
      } else {
        yL = this._f(xL, curve, kPos, kNeg);
        yR = this._f(xR, curve, kPos, kNeg);
      }
      xpL = xL; xpR = xR;
      // DC-blocking HP:  y[n] = a·(y[n−1] + x[n] − x[n−1])
      const hpOutL = hpA * (hpYL + yL - hpXL);
      const hpOutR = hpA * (hpYR + yR - hpXR);
      hpXL = yL; hpXR = yR;
      hpYL = hpOutL; hpYR = hpOutR;
      // Post gain and parallel mix
      const wL = hpOutL * postG;
      const wR = hpOutR * postG;
      outL[i] = inL[i] * (1 - mx) + wL * mx;
      outR[i] = inR[i] * (1 - mx) + wR * mx;
    }
    this._xPrevL = xpL; this._xPrevR = xpR;
    this._FPrevL = FpL; this._FPrevR = FpR;
    this._hpL = hpYL;   this._hpR = hpYR;
    this._hpXL = hpXL;  this._hpXR = hpXR;
  }
  latencySamples(){ return 0; }
}


// =====================================================================
//  EqModule — 5-band RBJ biquad EQ (palette index 15)
// =====================================================================
//
// HP → LowShelf → PeakBell → HighShelf → LP  (stereo, transposed DF-II).
// RBJ cookbook coefficients; no colouration; no oversampling; no
// dynamic / linear-phase modes. Generic utility module — product-side
// EQs compose macros on top.
//
// Coefficients recomputed per block (50/25 ms smoothers on params);
// inner loop is pure state updates.

class BiquadSection {
  constructor(){
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.sL1 = 0; this.sL2 = 0;
    this.sR1 = 0; this.sR2 = 0;
  }
  reset(){ this.sL1 = this.sL2 = this.sR1 = this.sR2 = 0; }
  _setCoefs(b0, b1, b2, a0, a1, a2){
    const inv = 1 / a0;
    this.b0 = b0 * inv; this.b1 = b1 * inv; this.b2 = b2 * inv;
    this.a1 = a1 * inv; this.a2 = a2 * inv;
  }
  setBypass(){ this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; }
  setHP(f, q, sr){
    const w = 2 * Math.PI * Math.min(sr * 0.499, Math.max(1, f)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(0.05, q));
    const b0 = (1 + cw) * 0.5, b1 = -(1 + cw), b2 = (1 + cw) * 0.5;
    const a0 = 1 + alpha,      a1 = -2 * cw,   a2 = 1 - alpha;
    this._setCoefs(b0, b1, b2, a0, a1, a2);
  }
  setLP(f, q, sr){
    const w = 2 * Math.PI * Math.min(sr * 0.499, Math.max(1, f)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(0.05, q));
    const b0 = (1 - cw) * 0.5, b1 = 1 - cw, b2 = (1 - cw) * 0.5;
    const a0 = 1 + alpha,      a1 = -2 * cw, a2 = 1 - alpha;
    this._setCoefs(b0, b1, b2, a0, a1, a2);
  }
  setPeak(f, gainDb, q, sr){
    const w = 2 * Math.PI * Math.min(sr * 0.499, Math.max(1, f)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const A = Math.pow(10, gainDb / 40);
    const alpha = sw / (2 * Math.max(0.05, q));
    const b0 = 1 + alpha * A, b1 = -2 * cw, b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A, a1 = -2 * cw, a2 = 1 - alpha / A;
    this._setCoefs(b0, b1, b2, a0, a1, a2);
  }
  setLowShelf(f, gainDb, q, sr){
    const w = 2 * Math.PI * Math.min(sr * 0.499, Math.max(1, f)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const A = Math.pow(10, gainDb / 40);
    const alpha = sw / (2 * Math.max(0.05, q));
    const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
    const b0 =     A * ((A + 1) - (A - 1) * cw + twoSqrtAalpha);
    const b1 = 2 * A * ((A - 1) - (A + 1) * cw);
    const b2 =     A * ((A + 1) - (A - 1) * cw - twoSqrtAalpha);
    const a0 =          (A + 1) + (A - 1) * cw + twoSqrtAalpha;
    const a1 =    -2 * ((A - 1) + (A + 1) * cw);
    const a2 =          (A + 1) + (A - 1) * cw - twoSqrtAalpha;
    this._setCoefs(b0, b1, b2, a0, a1, a2);
  }
  setHighShelf(f, gainDb, q, sr){
    const w = 2 * Math.PI * Math.min(sr * 0.499, Math.max(1, f)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const A = Math.pow(10, gainDb / 40);
    const alpha = sw / (2 * Math.max(0.05, q));
    const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
    const b0 =      A * ((A + 1) + (A - 1) * cw + twoSqrtAalpha);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cw);
    const b2 =      A * ((A + 1) + (A - 1) * cw - twoSqrtAalpha);
    const a0 =           (A + 1) - (A - 1) * cw + twoSqrtAalpha;
    const a1 =      2 * ((A - 1) - (A + 1) * cw);
    const a2 =           (A + 1) - (A - 1) * cw - twoSqrtAalpha;
    this._setCoefs(b0, b1, b2, a0, a1, a2);
  }
  processL(x){
    const y = this.b0 * x + this.sL1;
    this.sL1 = this.b1 * x - this.a1 * y + this.sL2;
    this.sL2 = this.b2 * x - this.a2 * y;
    return y;
  }
  processR(x){
    const y = this.b0 * x + this.sR1;
    this.sR1 = this.b1 * x - this.a1 * y + this.sR2;
    this.sR2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

class EqModule extends IDspModule {
  constructor(){
    super();
    this.params = {
      hpOn   : new ParamSmoother(0,    50, 25),
      hpFreq : new ParamSmoother(80,   50, 25),
      hpQ    : new ParamSmoother(0.707,50, 25),
      lsFreq : new ParamSmoother(120,  50, 25),
      lsGain : new ParamSmoother(0,    50, 25),
      lsQ    : new ParamSmoother(0.707,50, 25),
      pkFreq : new ParamSmoother(1000, 50, 25),
      pkGain : new ParamSmoother(0,    50, 25),
      pkQ    : new ParamSmoother(1.0,  50, 25),
      hsFreq : new ParamSmoother(6000, 50, 25),
      hsGain : new ParamSmoother(0,    50, 25),
      hsQ    : new ParamSmoother(0.707,50, 25),
      lpFreq : new ParamSmoother(18000,50, 25),
      lpQ    : new ParamSmoother(0.707,50, 25),
      lpOn   : new ParamSmoother(0,    50, 25),
    };
    this.hp = new BiquadSection();
    this.ls = new BiquadSection();
    this.pk = new BiquadSection();
    this.hs = new BiquadSection();
    this.lp = new BiquadSection();
  }
  reset(){
    this.hp.reset(); this.ls.reset(); this.pk.reset();
    this.hs.reset(); this.lp.reset();
  }
  process(inL, inR, outL, outR, n){
    const sr = this._sr;
    const P  = this.params; for (const k in P) P[k].tickBlock();
    // Update coefficients once per block from smoothed values
    if (P.hpOn.block > 0.5) this.hp.setHP(P.hpFreq.block, P.hpQ.block, sr);
    else                    this.hp.setBypass();
    if (Math.abs(P.lsGain.block) > 0.01) this.ls.setLowShelf(P.lsFreq.block, P.lsGain.block, P.lsQ.block, sr);
    else                                 this.ls.setBypass();
    if (Math.abs(P.pkGain.block) > 0.01) this.pk.setPeak(P.pkFreq.block, P.pkGain.block, P.pkQ.block, sr);
    else                                 this.pk.setBypass();
    if (Math.abs(P.hsGain.block) > 0.01) this.hs.setHighShelf(P.hsFreq.block, P.hsGain.block, P.hsQ.block, sr);
    else                                 this.hs.setBypass();
    if (P.lpOn.block > 0.5) this.lp.setLP(P.lpFreq.block, P.lpQ.block, sr);
    else                    this.lp.setBypass();
    const hp = this.hp, ls = this.ls, pk = this.pk, hs = this.hs, lp = this.lp;
    for (let i = 0; i < n; i++) {
      let l = inL[i], r = inR[i];
      l = hp.processL(l); r = hp.processR(r);
      l = ls.processL(l); r = ls.processR(r);
      l = pk.processL(l); r = pk.processR(r);
      l = hs.processL(l); r = hs.processR(r);
      l = lp.processL(l); r = lp.processR(r);
      outL[i] = l; outR[i] = r;
    }
  }
  latencySamples(){ return 0; }
}


// =====================================================================
//  FxProcessor — AudioWorkletProcessor host
// =====================================================================
//
// Holds the full module palette in this.modules (stable indices).
// this.chain is an array of indices defining the active serial order.
// engineMix AudioParam controls the final dry/wet crossfade against the
// signal that entered the chain (so chained modules can run wet-only).
//
// Defaults: chain = [0] (Delay only), engineMix snapped to ignore (1.0)
// — preserves Step-5 single-module behaviour. Products (Echoform, etc.)
// reconfigure via 'setChain' + 'setEngineMixMode'.

class FxProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){
    return [
      { name: 'bypass',    defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'engineMix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'morph',     defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(){
    super();
    // Stable module palette — index is the addressing scheme for setParam.
    this.modules = [
      new DelayModule(),         // 0
      new DiffuserModule(),      // 1
      new ToneModule(),          // 2
      new TapeMultiTapModule(),  // 3
      new TapeCharacterModule(), // 4
      new CombBankModule(),      // 5
      new TiltEqModule(),        // 6
      new FdnReverbModule(),     // 7
      new DiffuserModule(),      // 8  (second diffuser for A/B morph products)
      new WidthModule(),         // 9
      new EarlyReflectionsModule(), // 10
      new EnvelopeFollowerModule(this.port), // 11
      new CompressorModule(),    // 12
      new LimiterModule(),       // 13
      new SaturatorModule(),     // 14
      new EqModule(),            // 15
    ];
    this.chain = [0];                // active serial pipeline
    this.useEngineMix = false;       // when false, modules' own mix governs
    this._prepared = false;
    this._dryL = null; this._dryR = null;
    this._tmpL = null; this._tmpR = null;

    this.port.onmessage = (ev) => {
      const m = ev.data;
      if (!m || !m.type) return;
      if (m.type === 'param') {
        const mod = this.modules[m.module]; if (!mod) return;
        const p = mod.params[m.name];        if (!p) return;
        if (m.snap) p.snap(m.value); else p.setTarget(m.value);
      } else if (m.type === 'reset') {
        for (const mod of this.modules) mod.reset();
      } else if (m.type === 'setChain') {
        // Entries may be:
        //   - integer  : serial module index
        //   - { parallel: [[idxs...], [idxs...]] } : two sub-chains crossfaded by morph AudioParam
        if (Array.isArray(m.indices) && this._validChain(m.indices)) this.chain = m.indices.slice();
      } else if (m.type === 'engineMixMode') {
        this.useEngineMix = !!m.on;
      }
    };
  }

  _prepare(blockSize){
    for (const mod of this.modules) mod.prepare(sampleRate, blockSize, 2);
    this._dryL = new Float32Array(blockSize);
    this._dryR = new Float32Array(blockSize);
    this._tmpL = new Float32Array(blockSize);
    this._tmpR = new Float32Array(blockSize);
    this._aL   = new Float32Array(blockSize);
    this._aR   = new Float32Array(blockSize);
    this._bL   = new Float32Array(blockSize);
    this._bR   = new Float32Array(blockSize);
    this._prepared = true;
  }

  _validChain(arr){
    for (const e of arr) {
      if (typeof e === 'number') {
        if (!this.modules[e]) return false;
      } else if (e && Array.isArray(e.parallel) && e.parallel.length === 2) {
        for (const sub of e.parallel) {
          if (!Array.isArray(sub)) return false;
          for (const i of sub) if (typeof i !== 'number' || !this.modules[i]) return false;
        }
      } else return false;
    }
    return true;
  }

  _runSerial(indices, srcL, srcR, dstL, dstR, n){
    if (indices.length === 0) {
      dstL.set(srcL.subarray(0, n));
      dstR.set(srcR.subarray(0, n));
      return;
    }
    let sL = srcL, sR = srcR;
    for (let s = 0; s < indices.length; s++) {
      this.modules[indices[s]].process(sL, sR, dstL, dstR, n);
      sL = dstL; sR = dstR;
    }
  }

  process(inputs, outputs, parameters){
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const n = out[0].length;
    if (!this._prepared || this._dryL.length < n) this._prepare(n);

    const iL = (inp && inp[0]) ? inp[0] : new Float32Array(n);
    const iR = (inp && inp[1]) ? inp[1] : iL;
    const oL = out[0];
    const oR = out[1] || out[0];

    if (parameters.bypass[0] > 0.5) {
      oL.set(iL); if (oR !== oL) oR.set(iR);
      return true;
    }

    // Stash dry for engine-level crossfade
    if (this.useEngineMix) {
      this._dryL.set(iL.subarray(0, n));
      this._dryR.set(iR.subarray(0, n));
    }

    // Run chain — entries are either serial module indices or {parallel:[subA,subB]}
    // Parallel branches crossfade by the 'morph' AudioParam (equal-power).
    let srcL = iL, srcR = iR;
    const morphArr = parameters.morph;
    const morph0   = morphArr[0];
    for (let s = 0; s < this.chain.length; s++) {
      const e = this.chain[s];
      if (typeof e === 'number') {
        this.modules[e].process(srcL, srcR, oL, oR, n);
        srcL = oL; srcR = oR;
      } else {
        // Parallel: run both branches from current src, crossfade into oL/oR
        this._runSerial(e.parallel[0], srcL, srcR, this._aL, this._aR, n);
        this._runSerial(e.parallel[1], srcL, srcR, this._bL, this._bR, n);
        const mKR = morphArr.length > 1 ? null : morph0;
        for (let i = 0; i < n; i++) {
          const mv = mKR !== null ? mKR : morphArr[i];
          const aG = Math.cos(mv * Math.PI * 0.5);
          const bG = Math.sin(mv * Math.PI * 0.5);
          oL[i] = this._aL[i] * aG + this._bL[i] * bG;
          oR[i] = this._aR[i] * aG + this._bR[i] * bG;
        }
        srcL = oL; srcR = oR;
      }
    }

    if (this.useEngineMix) {
      const mix = parameters.engineMix.length > 1 ? parameters.engineMix : null;
      const m0  = parameters.engineMix[0];
      for (let i = 0; i < n; i++) {
        const mv = mix ? mix[i] : m0;
        const dG = Math.cos(mv * Math.PI * 0.5);
        const wG = Math.sin(mv * Math.PI * 0.5);
        oL[i] = this._dryL[i] * dG + oL[i] * wG;
        oR[i] = this._dryR[i] * dG + oR[i] * wG;
      }
    }
    return true;
  }
}

registerProcessor('shags-fx-processor', FxProcessor);
`;
