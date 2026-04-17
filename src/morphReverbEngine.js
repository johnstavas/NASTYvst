// morphReverbEngine.js — MorphReverb v4
// Geraint Luff (signalsmith) architecture + extensions:
//   • DiffuserHalfLengths A (tight) + B (loose), MORPH blends between them
//   • 8-channel FDN with Householder feedback matrix
//   • Per-channel first-order HF shelf (frequency-dependent decay)
//   • Fractional delay modulation on 4 FDN channels (WARP)
//   • 8-tap early reflections, SIZE-scaled, stereo-spread
//   • RT60 → decayGain via reference formula

const PROCESSOR_VERSION = 'morphreverb-v6';

const PROCESSOR_CODE = `
// ─── Hadamard N=8 (unrolled, normalised by 1/sqrt(8)) ────────────────────────
function hadamard8(a) {
  var t;
  t=a[0];a[0]=t+a[1];a[1]=t-a[1]; t=a[2];a[2]=t+a[3];a[3]=t-a[3];
  t=a[4];a[4]=t+a[5];a[5]=t-a[5]; t=a[6];a[6]=t+a[7];a[7]=t-a[7];
  t=a[0];a[0]=t+a[2];a[2]=t-a[2]; t=a[1];a[1]=t+a[3];a[3]=t-a[3];
  t=a[4];a[4]=t+a[6];a[6]=t-a[6]; t=a[5];a[5]=t+a[7];a[7]=t-a[7];
  t=a[0];a[0]=t+a[4];a[4]=t-a[4]; t=a[1];a[1]=t+a[5];a[5]=t-a[5];
  t=a[2];a[2]=t+a[6];a[6]=t-a[6]; t=a[3];a[3]=t+a[7];a[7]=t-a[7];
  var s=0.35355339059327373;
  a[0]*=s;a[1]*=s;a[2]*=s;a[3]*=s;a[4]*=s;a[5]*=s;a[6]*=s;a[7]*=s;
}

// ─── Householder N=8: x -= (2/N)*sum(x) ──────────────────────────────────────
function householder8(a) {
  var f=(a[0]+a[1]+a[2]+a[3]+a[4]+a[5]+a[6]+a[7])*0.25;
  a[0]-=f;a[1]-=f;a[2]-=f;a[3]-=f;a[4]-=f;a[5]-=f;a[6]-=f;a[7]-=f;
}

class MorphReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name:'morph',   defaultValue:50,  minValue:0, maxValue:100 },
      { name:'size',    defaultValue:55,  minValue:0, maxValue:100 },
      { name:'decay',   defaultValue:50,  minValue:0, maxValue:100 },
      { name:'tone',    defaultValue:55,  minValue:0, maxValue:100 },
      { name:'density', defaultValue:60,  minValue:0, maxValue:100 },
      { name:'warp',    defaultValue:30,  minValue:0, maxValue:100 },
      { name:'mix',     defaultValue:30,  minValue:0, maxValue:100 },
      { name:'bypass',  defaultValue:0,   minValue:0, maxValue:1   },
      { name:'smooth',  defaultValue:0,   minValue:0, maxValue:5   },
    ];
  }

  constructor() {
    super();
    var sr = sampleRate;
    this.sr = sr;

    // Smoothed params
    this._sm=0.5; this._ss=0.55; this._sd=0.5;
    this._st=0.55; this._sden=0.6; this._sw=0.3; this._smix=0.3;

    // ── Two DiffuserHalfLengths ────────────────────────────────────────
    // A: initMs=60  → steps 30/15/7.5/3.75ms  (tight, crystalline)
    // B: initMs=160 → steps 80/40/20/10ms      (loose, hall)
    this.diffA = this._buildDiffuser(sr, 60);
    this.diffB = this._buildDiffuser(sr, 160);

    // ── FDN: 8 channels, exponential delays 100–200ms ─────────────────
    var fdnBase = Math.round(0.100 * sr);
    this.fdnDelays = new Int32Array(8);
    this.fdnBufs   = [];
    this.fdnIdxs   = new Int32Array(8);
    this.fdnShelf  = new Float64Array(8); // per-channel HF shelf LP state
    for (var c = 0; c < 8; c++) {
      this.fdnDelays[c] = Math.round(Math.pow(2, c / 8) * fdnBase);
      this.fdnBufs.push(new Float32Array(this.fdnDelays[c] + 16)); // +16 headroom for fractional
    }

    // ── Fractional delay LFOs — only even channels (0,2,4,6) ──────────
    // Odd channels get modulation spread via Householder matrix
    var lfoHz = [0.15, 0, 0.22, 0, 0.31, 0, 0.44, 0];
    this.fdnLfoPhase = new Float64Array(8);
    this.fdnLfoRate  = new Float64Array(8);
    for (var c = 0; c < 8; c++) {
      this.fdnLfoRate[c]  = lfoHz[c] > 0 ? 2 * Math.PI * lfoHz[c] / sr : 0;
      this.fdnLfoPhase[c] = Math.random() * Math.PI * 2; // stagger start phases
    }

    // ── Early reflections: 8 stereo-spread taps ───────────────────────
    // Nominal tap times in ms (scaled by SIZE at runtime)
    // L/R weights create natural stereo image without hard panning
    this.erTapMs  = [7, 13, 17, 23, 29, 37, 43, 53];
    this.erTapGain= [0.65, 0.56, 0.50, 0.44, 0.38, 0.32, 0.27, 0.22];
    this.erTapWL  = [1.0, 0.3, 0.8, 0.4, 1.0, 0.5, 0.7, 0.3];
    this.erTapWR  = [0.3, 1.0, 0.5, 0.9, 0.3, 0.8, 0.4, 1.0];
    this.erMaxLen = Math.ceil(sr * 0.075);
    this.erBufL   = new Float32Array(this.erMaxLen);
    this.erBufR   = new Float32Array(this.erMaxLen);
    this.erIdx    = 0;
    this._erSamps = new Int32Array(8); // pre-computed tap sample counts (no per-sample alloc)

    // ── Pre-delay up to 60ms ──────────────────────────────────────────
    this.pdMax = Math.ceil(sr * 0.065);
    this.pdL   = new Float32Array(this.pdMax);
    this.pdR   = new Float32Array(this.pdMax);
    this.pdIdx = 0;

    // ── Smooth LP ─────────────────────────────────────────────────────
    this.slpL1=0; this.slpR1=0; this.slpL2=0; this.slpR2=0;

    // ── Scratch (zero allocations in process) ─────────────────────────
    this._inp = new Float64Array(8);
    this._dA  = new Float64Array(8);
    this._dB  = new Float64Array(8);
    this._bl  = new Float64Array(8);
    this._del = new Float64Array(8);
    this._mix = new Float64Array(8);

    this._peak = 0;
    this.port.postMessage({ ready: true });
  }

  // DiffuserHalfLengths: 4 steps, 8 channels, halving delay ranges
  _buildDiffuser(sr, initMs) {
    var steps = [], ms = initMs;
    for (var s = 0; s < 4; s++) {
      ms *= 0.5;
      var rangeS = ms * 0.001 * sr;
      var delays=new Int32Array(8), bufs=[], idxs=new Int32Array(8), flips=new Uint8Array(8);
      for (var c = 0; c < 8; c++) {
        var lo=rangeS*c/8, hi=rangeS*(c+1)/8;
        delays[c] = Math.max(2, Math.round(lo + Math.random()*(hi-lo)));
        bufs.push(new Float32Array(delays[c]+4));
        flips[c] = Math.random()<0.5 ? 1 : 0;
      }
      steps.push({ delays:delays, bufs:bufs, idxs:idxs, flips:flips });
    }
    return steps;
  }

  // Run one sample through all 4 diffusion steps; writes result into outArr
  _diffuse(diff, inArr, outArr) {
    var c, s, buf, len, wi, ri;
    for (c=0;c<8;c++) outArr[c]=inArr[c];
    for (s=0;s<4;s++) {
      var st=diff[s];
      for (c=0;c<8;c++) {
        buf=st.bufs[c]; len=buf.length; wi=st.idxs[c];
        buf[wi]=outArr[c];
        ri=wi-st.delays[c]; if(ri<0) ri+=len;
        outArr[c]=buf[ri];
        st.idxs[c]=wi+1<len?wi+1:0;
      }
      hadamard8(outArr);
      for (c=0;c<8;c++) { if(st.flips[c]) outArr[c]=-outArr[c]; }
    }
  }

  process(inputs, outputs, params) {
    var inBufs=inputs[0], outBufs=outputs[0];
    if (!inBufs||!inBufs.length||!inBufs[0]||!outBufs[0]) return true;

    var iL=inBufs[0], iR=inBufs[1]||inBufs[0];
    var oL=outBufs[0], oR=outBufs[1]||outBufs[0];
    var N=iL.length, sr=this.sr;

    if (params.bypass[0]>0.5) {
      for (var nb=0;nb<N;nb++){oL[nb]=iL[nb];oR[nb]=iR[nb];}
      return true;
    }

    // ── Block-level param smoothing ───────────────────────────────────
    var PS=0.85;
    this._sm   = PS*this._sm   + (1-PS)*(params.morph[0]  /100);
    this._ss   = PS*this._ss   + (1-PS)*(params.size[0]   /100);
    this._sd   = PS*this._sd   + (1-PS)*(params.decay[0]  /100);
    this._st   = PS*this._st   + (1-PS)*(params.tone[0]   /100);
    this._sden = PS*this._sden + (1-PS)*(params.density[0]/100);
    this._sw   = PS*this._sw   + (1-PS)*(params.warp[0]   /100);
    this._smix = PS*this._smix + (1-PS)*(params.mix[0]    /100);

    var mo=this._sm, sz=this._ss, dc=this._sd;
    var tn=this._st, dn=this._sden, wp=this._sw, mx=this._smix;

    // ── DECAY → decayGain (reference formula, fixed actual loop time) ─
    // FDN delays are fixed 100–200ms → typical loop = 150ms.
    // Using roomSizeMs in the formula caused DECAY and SIZE to fight.
    // Exponential RT60 curve: 0%=0.3s (tight room), 50%=3s (hall), 100%=freeze
    var actualLoopMs = 150.0;
    var g_dc;
    if (dc >= 0.99) {
      g_dc = 0.9998;                               // freeze at top 1%
    } else {
      var rt60          = 0.3 * Math.pow(100.0, dc);   // 0.3s → 30s (2 decades)
      var loopsPerRt60  = rt60 / (actualLoopMs * 0.001);
      var dbPerCycle    = -60.0 / loopsPerRt60;
      g_dc = Math.min(0.9997, Math.pow(10, dbPerCycle * 0.05));
    }

    // ── TONE → per-channel HF shelf ───────────────────────────────────
    // Crossover at 1.5kHz gives real separation within one FDN loop.
    // hfRatio sweeps from 0.02 (nearly dead HF) to 0.99 (full HF).
    var shelfCoeff = 1 - Math.exp(-2 * Math.PI * 1500 / sr);
    var hfRatio    = 0.02 + tn * 0.97;
    var g_hf       = g_dc * hfRatio;
    var g_shelf    = g_dc - g_hf;

    // ── SIZE → pre-delay + ER spread (what the ear hears as room scale) ─
    var pdSamps = Math.min(Math.round(sz * 75 * sr * 0.001), this.pdMax - 2);
    var erScale = 0.1 + sz * 1.1;   // 0.1 (0.7–5ms taps) → 1.2 (8–64ms taps)

    // ── WARP → fractional delay modulation depth ──────────────────────
    // Wide range: subtle at low end, obvious chorus/shimmer at high end
    var modAmt = wp * wp * 22.0;   // quadratic: 0→22 samples (0→0.5ms)

    // Pre-compute ER tap sample counts once per block
    for (var t=0;t<8;t++) {
      this._erSamps[t] = Math.min(
        Math.max(1, Math.round(this.erTapMs[t] * erScale * sr * 0.001)),
        this.erMaxLen - 2
      );
    }

    // Morph + mix coefficients
    var blendA   = Math.cos(mo * Math.PI * 0.5);
    var blendB   = Math.sin(mo * Math.PI * 0.5);
    var dryCoeff = Math.cos(mx * Math.PI * 0.5);
    var wetCoeff = Math.sin(mx * Math.PI * 0.5);
    var smooth   = params.smooth[0];

    var peakAcc = 0;

    // ── Per-sample loop ───────────────────────────────────────────────
    for (var n = 0; n < N; n++) {
      var dL=iL[n], dR=iR[n];

      // Pre-delay
      this.pdL[this.pdIdx]=dL; this.pdR[this.pdIdx]=dR;
      var pdRi=this.pdIdx-pdSamps; if(pdRi<0) pdRi+=this.pdMax;
      var pdL=this.pdL[pdRi], pdR=this.pdR[pdRi];
      this.pdIdx=this.pdIdx+1<this.pdMax?this.pdIdx+1:0;

      // ── Diffusion (must run before ER — article: "tap from diffused signal") ─
      var inp=this._inp;
      inp[0]=pdL;inp[1]=pdR;inp[2]=pdL;inp[3]=pdR;
      inp[4]=pdL;inp[5]=pdR;inp[6]=pdL;inp[7]=pdR;

      this._diffuse(this.diffA, inp, this._dA);
      this._diffuse(this.diffB, inp, this._dB);

      // Morph blend + density
      var bl=this._bl, dA=this._dA, dB=this._dB;
      for (var c=0;c<8;c++) {
        var morphed=dA[c]*blendA+dB[c]*blendB;
        bl[c]=inp[c]*(1-dn)+morphed*dn;
      }

      // ── Early reflections — tapped from diffused signal, not raw input ──
      // Geraint Luff: "a separate delay path taken from the diffused signal
      // to fill the time until the first echoes from the feedback loop"
      var blL=(bl[0]+bl[2]+bl[4]+bl[6])*0.25;
      var blR=(bl[1]+bl[3]+bl[5]+bl[7])*0.25;
      this.erBufL[this.erIdx]=blL; this.erBufR[this.erIdx]=blR;
      var erL=0, erR=0;
      var erSamps=this._erSamps, erGain=this.erTapGain;
      var erWL=this.erTapWL, erWR=this.erTapWR;
      for (var t=0;t<8;t++) {
        var tri=this.erIdx-erSamps[t]; if(tri<0) tri+=this.erMaxLen;
        var samp=this.erBufL[tri]; erL+=samp*erGain[t]*erWL[t];
        samp=this.erBufR[tri];     erR+=samp*erGain[t]*erWR[t];
      }
      this.erIdx=this.erIdx+1<this.erMaxLen?this.erIdx+1:0;
      erL*=0.15; erR*=0.15;

      // ── FDN ───────────────────────────────────────────────────────
      var del=this._del, mix=this._mix;
      var fb=this.fdnBufs, fd=this.fdnDelays;
      var fi=this.fdnIdxs, fsh=this.fdnShelf;
      var flp=this.fdnLfoPhase, flr=this.fdnLfoRate;

      // Read with fractional delay (modulated even channels only)
      for (var c=0;c<8;c++) {
        var flen=fb[c].length, fwi=fi[c];
        var fracDel=fd[c];
        if (flr[c]>0) {
          flp[c]+=flr[c];
          fracDel+=Math.sin(flp[c])*modAmt;
          if(fracDel<2) fracDel=2;
        }
        var iD=Math.floor(fracDel), fr=fracDel-iD;
        var r0=fwi-iD;   if(r0<0) r0+=flen;
        var r1=fwi-iD-1; if(r1<0) r1+=flen;
        del[c]=fb[c][r0]+fr*(fb[c][r1]-fb[c][r0]);
        mix[c]=del[c];
      }

      // Householder feedback mix
      householder8(mix);

      // Per-channel HF shelf → frequency-dependent feedback write
      for (var c=0;c<8;c++) {
        fsh[c]+=shelfCoeff*(mix[c]-fsh[c]);
        // LF channel: gain = g_dc, HF channel: gain = g_hf
        var fb_sig=mix[c]*g_hf+fsh[c]*g_shelf;
        // Safety clamp
        if(fb_sig> 1.8) fb_sig= 1.8;
        if(fb_sig<-1.8) fb_sig=-1.8;
        var flen=fb[c].length, fwi=fi[c];
        fb[c][fwi]=bl[c]+fb_sig;
        fi[c]=fwi+1<flen?fwi+1:0;
      }

      // Mix 8ch → stereo + early reflections
      var wL=(del[0]+del[2]+del[4]+del[6])*0.25+erL;
      var wR=(del[1]+del[3]+del[5]+del[7])*0.25+erR;

      // Smooth LP
      if (smooth>0.5) {
        var smF=16000-smooth*2000;
        var sc=Math.exp(-2*Math.PI*smF/sr), sc1=1-sc;
        this.slpL1=sc*this.slpL1+sc1*wL; this.slpR1=sc*this.slpR1+sc1*wR;
        this.slpL2=sc*this.slpL2+sc1*this.slpL1; this.slpR2=sc*this.slpR2+sc1*this.slpR1;
        wL=this.slpL2; wR=this.slpR2;
      }

      oL[n]=dL*dryCoeff+wL*wetCoeff;
      oR[n]=dR*dryCoeff+wR*wetCoeff;

      if(oL[n]>0.98||oL[n]<-0.98) oL[n]=Math.tanh(oL[n]*0.95);
      if(oR[n]>0.98||oR[n]<-0.98) oR[n]=Math.tanh(oR[n]*0.95);

      var pk=Math.abs(oL[n])>Math.abs(oR[n])?Math.abs(oL[n]):Math.abs(oR[n]);
      if(pk>peakAcc) peakAcc=pk;
    }

    this._peak=peakAcc;
    this.port.postMessage({ peak:peakAcc, morph:this._sm });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', MorphReverbProcessor);
`;

export async function createMorphReverbEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();
  const inputTrim   = audioCtx.createGain();
  const outputTrim  = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelCount: 2, channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak=0, _morph=0.5;
  worklet.port.onmessage = e => {
    if (e.data?.peak  !== undefined) _peak  = e.data.peak;
    if (e.data?.morph !== undefined) _morph = e.data.morph;
  };

  const _buf = new Float32Array(2048);
  function getPeakAn(an) {
    an.getFloatTimeDomainData(_buf);
    let m=0; for (let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m;
  }
  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s=0; for (let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length);
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn=0, _peakOut=0;
  const PDECAY=0.94;

  return {
    input, output, chainOutput,

    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },

    setMorph:   v => { p('morph').value   = v*100; },
    setSize:    v => { p('size').value    = v*100; },
    setDecay:   v => { p('decay').value   = v*100; },
    setTone:    v => { p('tone').value    = v*100; },
    setDensity: v => { p('density').value = v*100; },
    setWarp:    v => { p('warp').value    = v*100; },
    setMix:     v => { p('mix').value     = v*100; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },
    setSmooth:  v => { p('smooth').value  = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeakAn(analyserIn),  _peakIn *PDECAY); return _peakIn;  },
    getOutputPeak:  () => { _peakOut = Math.max(getPeakAn(analyserOut), _peakOut*PDECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getMorph:       () => _morph,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
