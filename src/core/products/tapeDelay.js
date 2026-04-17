// tapeDelay.js — TAPE DELAY product layer (3-head shared-tape).
//
// Composes:
//   [TapeMultiTapModule → ToneModule]   inside FxProcessor
//   engineMix handles dry/wet
//
// Owns no DSP. Maps the legacy 17-knob TapeDelay UI to underlying module
// params. Tape character omissions vs legacy (deferred to a later
// "TapeCharacter" pass): hiss noise, 60Hz hum, output transformer shelf,
// dry warmth filter — these are voice-only, not pitch/time identity.
//
// Replaces (when UI swap happens): src/tapeDelayEngine.js

import { MODULE } from '../fxEngine.js';

export function createTapeDelay(fx) {
  // Default chain includes character; setCharacterEnabled(false) drops it.
  function rebuildChain(charOn) {
    const chain = [MODULE.TAPE_MULTITAP];
    if (charOn) chain.push(MODULE.TAPE_CHARACTER);
    chain.push(MODULE.TONE);
    fx.setChain(chain);
  }
  fx.setEngineMixMode(true);
  fx.setEngineMix(0.45);
  fx.setParam(MODULE.TAPE_MULTITAP, 'mix', 1.0, { snap: true });

  const defaults = {
    time1: 0.167, time2: 0.334, time3: 0.501,
    feedback: 0.40,
    wow: 0.35,
    treble: 0.5,
    bass:   0.5,
    drive: 0.30,
    head1on: 1, head2on: 0, head3on: 0,
    head1vol: 0.75, head2vol: 0.75, head3vol: 0.75,
    spread: 0.5,
    mix: 0.45,
    // ---- Character (off by default to preserve clean A/B ability) ----
    characterEnabled: true,
    hiss: 0.10,
    hum: 0.05,
    humHz: 60,
    xfmrDrive: 0.30,
    xfmrColor: 0.35,
    comp: 0.30,
    age: 0.20,
    stereoDrift: 0.10,
  };
  const state = { ...defaults };

  const tape = (n, v, opts) => fx.setParam(MODULE.TAPE_MULTITAP,  n, v, opts);
  const tone = (n, v, opts) => fx.setParam(MODULE.TONE,           n, v, opts);
  const ch   = (n, v, opts) => fx.setParam(MODULE.TAPE_CHARACTER, n, v, opts);

  function applyTimes() {
    tape('time1', Math.max(0.020, Math.min(1.2, state.time1)));
    tape('time2', Math.max(0.020, Math.min(1.2, state.time2)));
    tape('time3', Math.max(0.020, Math.min(1.2, state.time3)));
  }
  function applyFeedback() { tape('feedback', state.feedback * 0.96); }
  function applyHeads() {
    tape('on1', state.head1on ? 1 : 0); tape('vol1', state.head1vol);
    tape('on2', state.head2on ? 1 : 0); tape('vol2', state.head2vol);
    tape('on3', state.head3on ? 1 : 0); tape('vol3', state.head3vol);
  }
  function applyWow() {
    // Legacy wow had three slow LFOs summed; we map to wowDepth + a touch of flutter
    const w = state.wow;
    tape('wowDepth', w * 0.7);
    tape('wowRate',  0.4 + w * 1.2);
    tape('fltDepth', w * 0.25);   // subtle scrape flutter
    tape('fltRate',  6 + w * 6);
  }
  function applyDrive() {
    tape('drive', state.drive);
    // Legacy drive also boosted feedback-path saturation; covered above.
  }
  function applyTone() {
    // treble: 0=very dark (1.8k LP), 1=open (16k LP)
    const lpHz = 1800 + state.treble * 14200;
    // bass: 0=full (HP=20Hz), 1=thin (HP=400Hz)
    const hpHz = 20   + state.bass   * 380;
    tone('lpHz', lpHz);
    tone('hpHz', hpHz);
    tone('stages', 1);
    // Mirror low-cut into the feedback HP for tape head freq response feel
    tape('lowCut', 60 + state.bass * 200);
  }
  function applySpread() { tape('spread', state.spread); }
  function applyMix()    { fx.setEngineMix(state.mix); }

  function applyCharacter() {
    ch('hiss',        state.hiss);
    ch('hum',         state.hum);
    ch('humHz',       state.humHz);
    ch('xfmrDrive',   state.xfmrDrive);
    ch('xfmrColor',   state.xfmrColor);
    ch('compAmount',  state.comp);
    ch('age',         state.age);
    ch('stereoDrift', state.stereoDrift);
  }

  const api = {
    setTime1   : v => { state.time1 = v; applyTimes(); },
    setTime2   : v => { state.time2 = v; applyTimes(); },
    setTime3   : v => { state.time3 = v; applyTimes(); },
    setFeedback: v => { state.feedback = v; applyFeedback(); },
    setWow     : v => { state.wow = v; applyWow(); },
    setTreble  : v => { state.treble = v; applyTone(); },
    setBass    : v => { state.bass = v; applyTone(); },
    setDrive   : v => { state.drive = v; applyDrive(); },
    setHead1On : v => { state.head1on = v ? 1 : 0; applyHeads(); },
    setHead2On : v => { state.head2on = v ? 1 : 0; applyHeads(); },
    setHead3On : v => { state.head3on = v ? 1 : 0; applyHeads(); },
    setHead1Vol: v => { state.head1vol = v; applyHeads(); },
    setHead2Vol: v => { state.head2vol = v; applyHeads(); },
    setHead3Vol: v => { state.head3vol = v; applyHeads(); },
    setSpread  : v => { state.spread = v; applySpread(); },
    setMix     : v => { state.mix = v; applyMix(); },
    setBypass  : on => fx.setBypass(on),
    // ---- Character controls --------------------------------------
    setCharacterEnabled: on => { state.characterEnabled = !!on; rebuildChain(state.characterEnabled); },
    setHiss        : v => { state.hiss = v;        ch('hiss', v); },
    setHum         : v => { state.hum = v;         ch('hum', v); },
    setHumHz       : v => { state.humHz = v;       ch('humHz', v); },
    setXfmrDrive   : v => { state.xfmrDrive = v;   ch('xfmrDrive', v); },
    setXfmrColor   : v => { state.xfmrColor = v;   ch('xfmrColor', v); },
    setComp        : v => { state.comp = v;        ch('compAmount', v); },
    setAge         : v => { state.age = v;         ch('age', v); },
    setStereoDrift : v => { state.stereoDrift = v; ch('stereoDrift', v); },

    reset      : ()  => fx.reset(),
    getState   : ()  => ({ ...state }),
    loadPreset : (preset) => {
      Object.assign(state, defaults, preset || {});
      rebuildChain(state.characterEnabled);
      applyTimes(); applyFeedback(); applyHeads();
      applyWow(); applyDrive(); applyTone();
      applySpread(); applyMix();
      applyCharacter();
    },
  };

  api.loadPreset({});
  return api;
}
