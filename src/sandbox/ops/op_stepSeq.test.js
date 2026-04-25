// op_stepSeq.test.js — SC Stepper-driven 8-step sequencer.

import { StepSeqOp } from './op_stepSeq.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new StepSeqOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, trigArr) {
  const N = trigArr.length;
  const out = new Float32Array(N);
  op.process({ trig: trigArr }, { out }, N);
  return out;
}

const EPS = 1e-6;
function eq(a, b) { return Math.abs(a - b) < EPS; }

const tests = [
  {
    name: 'before any trigger: output = 0',
    run() {
      const op = freshOp({ s0: 0.5, s1: 0.7 });
      const out = render(op, new Float32Array(8));
      for (let i = 0; i < 8; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'first rising edge → step 0 value',
    run() {
      const op = freshOp({ s0: 0.5, s1: 0.7 });
      const trig = Float32Array.of(0, 1, 0, 0);
      const out = render(op, trig);
      if (out[0] !== 0)        return { pass: false, why: `out[0]=${out[0]}` };
      if (!eq(out[1], 0.5))    return { pass: false, why: `out[1]=${out[1]}` };
      if (!eq(out[2], 0.5))    return { pass: false, why: `out[2]=${out[2]}` };
      if (!eq(out[3], 0.5))    return { pass: false, why: `out[3]=${out[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'sequential triggers walk through s0, s1, s2',
    run() {
      const op = freshOp({ s0: 0.1, s1: 0.2, s2: 0.3 });
      const trig = Float32Array.of(1, 0, 1, 0, 1, 0);
      const out = render(op, trig);
      // i=0: prev=0,cur=1 → idx=0, level=0.1
      // i=1: hold 0.1
      // i=2: prev=0,cur=1 → idx=1, level=0.2
      // i=3: hold 0.2
      // i=4: prev=0,cur=1 → idx=2, level=0.3
      if (!eq(out[0], 0.1)) return { pass: false, why: `out[0]=${out[0]}` };
      if (!eq(out[1], 0.1)) return { pass: false, why: `out[1]=${out[1]}` };
      if (!eq(out[2], 0.2)) return { pass: false, why: `out[2]=${out[2]}` };
      if (!eq(out[3], 0.2)) return { pass: false, why: `out[3]=${out[3]}` };
      if (!eq(out[4], 0.3)) return { pass: false, why: `out[4]=${out[4]}` };
      return { pass: true };
    },
  },
  {
    name: 'wrap from last step back to step 0',
    run() {
      const op = freshOp({ length: 3, s0: 0.1, s1: 0.2, s2: 0.3 });
      const trig = Float32Array.of(1, 0, 1, 0, 1, 0, 1, 0);
      const out = render(op, trig);
      // 4 triggers, length=3 → indices 0,1,2,0
      if (!eq(out[0], 0.1)) return { pass: false, why: `t0 out=${out[0]}` };
      if (!eq(out[2], 0.2)) return { pass: false, why: `t1 out=${out[2]}` };
      if (!eq(out[4], 0.3)) return { pass: false, why: `t2 out=${out[4]}` };
      if (!eq(out[6], 0.1)) return { pass: false, why: `t3 should wrap to s0=${out[6]}` };
      return { pass: true };
    },
  },
  {
    name: 'length=1 → all triggers reproduce s0',
    run() {
      const op = freshOp({ length: 1, s0: 0.42 });
      const trig = Float32Array.of(1, 0, 1, 0, 1, 0);
      const out = render(op, trig);
      if (!eq(out[0], 0.42)) return { pass: false, why: `out[0]=${out[0]}` };
      if (!eq(out[2], 0.42)) return { pass: false, why: `out[2]=${out[2]}` };
      if (!eq(out[4], 0.42)) return { pass: false, why: `out[4]=${out[4]}` };
      return { pass: true };
    },
  },
  {
    name: 'full 8-step cycle hits all 8 values',
    run() {
      const params = { length: 8 };
      for (let i = 0; i < 8; i++) params[`s${i}`] = (i + 1) * 0.1;
      const op = freshOp(params);
      const trig = new Float32Array(16);
      for (let i = 0; i < 16; i += 2) trig[i] = 1;
      const out = render(op, trig);
      for (let k = 0; k < 8; k++) {
        const expected = (k + 1) * 0.1;
        if (!eq(out[k * 2], expected)) {
          return { pass: false, why: `step ${k} got ${out[k*2]} expected ${expected}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'trigger held high → only fires on rising edge',
    run() {
      const op = freshOp({ s0: 0.1, s1: 0.2 });
      const trig = Float32Array.of(0, 1, 1, 1, 1);
      const out = render(op, trig);
      // i=1: rising → idx=0, level=0.1
      // i=2..4: held high, no further advance
      if (!eq(out[1], 0.1)) return { pass: false, why: `out[1]=${out[1]}` };
      for (let i = 2; i < 5; i++) {
        if (!eq(out[i], 0.1)) return { pass: false, why: `i=${i} out=${out[i]} (should not advance)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() returns idx to -1, output to 0',
    run() {
      const op = freshOp({ s0: 0.5 });
      op.process({ trig: Float32Array.of(1) }, { out: new Float32Array(1) }, 1);
      // now idx=0, level=0.5
      op.reset();
      const trig = Float32Array.of(0, 0);
      const out = new Float32Array(2);
      op.process({ trig }, { out }, 2);
      if (out[0] !== 0 || out[1] !== 0) return { pass: false, why: `out=[${out[0]},${out[1]}]` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary state: idx + prevTrig carry',
    run() {
      const op = freshOp({ s0: 0.1, s1: 0.2, s2: 0.3 });
      // Block A: 1 trigger → idx=0 level=0.1
      const trA = Float32Array.of(1, 0, 0, 0);
      const oA = new Float32Array(4); op.process({ trig: trA }, { out: oA }, 4);
      // Block B: 1 trigger → idx=1 level=0.2
      const trB = Float32Array.of(0, 1, 0, 0);
      const oB = new Float32Array(4); op.process({ trig: trB }, { out: oB }, 4);
      if (!eq(oA[3], 0.1)) return { pass: false, why: `A end=${oA[3]}` };
      if (!eq(oB[0], 0.1)) return { pass: false, why: `B start should hold A end, got ${oB[0]}` };
      if (!eq(oB[1], 0.2)) return { pass: false, why: `B[1]=${oB[1]}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range / NaN stay finite',
    run() {
      const op = freshOp({});
      op.setParam('length', 99); op.setParam('length', -1); op.setParam('length', NaN);
      op.setParam('s0', 999); op.setParam('s0', -999); op.setParam('s0', NaN);
      const out = render(op, Float32Array.of(1, 0, 1, 0));
      for (let i = 0; i < 4; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'unknown param is silently ignored',
    run() {
      const op = freshOp({});
      try { op.setParam('s9', 0.5); op.setParam('xyz', 1); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'missing trig input → no advance, output stays at 0',
    run() {
      const op = freshOp({ s0: 0.5 });
      const out = new Float32Array(8);
      op.process({}, { out }, 8);
      for (let i = 0; i < 8; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ trig: Float32Array.of(1) }, {}, 1); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false };
      return { pass: true };
    },
  },
];

export default { opId: 'stepSeq', tests };
