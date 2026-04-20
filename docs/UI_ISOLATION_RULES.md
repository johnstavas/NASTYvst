# UI-Isolation Ruleset

> Universal rule: **the UI layer does not touch the audio graph.** React
> components are read-only observers + public-setter callers. Nothing
> that runs in a render path, an effect, or a RAF loop is allowed to
> create audio nodes, write AudioParams, reconnect the graph, or
> re-instantiate the engine.
>
> A plugin that fails UI-isolation cannot be marked conformant,
> regardless of how good its DSP is.

---

## Why this matters

A UI-driven rogue write looks identical to a correctly-moving knob from
the audio side. The harness measures output; it cannot tell *where* a
write came from. So UI-isolation needs its own layer of checks —
otherwise drag handlers, re-renders, memo misses, and stale effects can
silently smear the audio and no sweep will ever catch it.

---

## What "touching the audio" means

Any of the following, executed from inside a `.jsx` component, a hook,
a `useEffect`, a RAF callback, or an event handler that runs in the UI
thread's render lifecycle:

1. `new <X>Node(...)` — creating an AudioNode
2. `.setValueAtTime(...)`, `.setTargetAtTime(...)`,
   `.linearRampToValueAtTime(...)`, `.exponentialRampToValueAtTime(...)`,
   `.cancelScheduledValues(...)` — AudioParam automation
3. Direct AudioParam `.value =` writes
4. `.connect(...)` or `.disconnect(...)`
5. Reading/holding a raw `AudioContext` reference to do anything other
   than pass it into the engine factory once
6. Re-instantiating the engine inside a render-reactive path
7. Any DSP math (filter coefficients, curve building) computed in React

Allowed from React:

- Calling **public setters** on the engine (`engine.setDrive(x)`).
- Calling **declared observer methods** (`engine.getState()`,
  `engine.getGrDbA()`).
- Reading the output of those methods and writing to DOM / CSS
  transforms only.

---

## Layer 1 — Static rules (cheap, commit-time)

Grep-enforceable. Fails the commit on any match inside `src/**/*.jsx`.

Forbidden patterns inside `*.jsx`:

| Pattern | Reason |
|---------|--------|
| `new \w+Node\(` | Creating an audio node in UI |
| `\.setValueAtTime\(` | Scheduling an AudioParam from UI |
| `\.setTargetAtTime\(` | Scheduling an AudioParam from UI |
| `\.linearRampToValueAtTime\(` | Scheduling an AudioParam from UI |
| `\.exponentialRampToValueAtTime\(` | Scheduling an AudioParam from UI |
| `\.cancelScheduledValues\(` | Scheduling an AudioParam from UI |
| `\.connect\(` | Mutating the audio graph from UI |
| `\.disconnect\(` | Mutating the audio graph from UI |
| `new (OfflineAudio\|Audio)Context\(` | UI must not own a context |
| `\.createBiquadFilter\|createGain\|createDelay\|createWaveShaper\|createConvolver\|createDynamicsCompressor\|createOscillator\|createAnalyser\|createChannelSplitter\|createChannelMerger\|createConstantSource\|createBuffer(Source)?\(` | Any context-factory call |

Allowed callers of engine factories (`createXEngine`): registry /
instance manager / main.jsx only — never a component.

### Reference check script

```bash
# 5-line audit, no dependencies
cd "src"
for pat in \
  'new [A-Z][A-Za-z]*Node\(' \
  '\.setValueAtTime\(' '\.setTargetAtTime\(' \
  '\.linearRampToValueAtTime\(' '\.exponentialRampToValueAtTime\(' \
  '\.cancelScheduledValues\(' \
  '\.connect\(' '\.disconnect\(' \
  'new (OfflineAudio|Audio)Context\('; do
    git --no-pager grep -nE "$pat" -- '*.jsx' && echo "VIOLATION: $pat" && exit 1
done
echo "UI-isolation static audit: OK"
```

Wire this into pre-commit and CI.

---

## Layer 2 — Runtime write-origin proxy

Static rules catch the obvious. Layer 2 catches everything else by
proxying every AudioParam the engine exposes and recording the call
stack of every write.

### Engine-side instrumentation

In every engine factory, during QC mode (e.g. `ctx.qcMode === true`):

```js
function wrapParam(param, name) {
  const wrap = (method) => {
    const orig = param[method].bind(param);
    param[method] = (...args) => {
      const stack = new Error().stack || '';
      const origin = classifyOrigin(stack);        // 'engine' | 'ui' | 'unknown'
      if (origin === 'ui') {
        (engine._uiWrites ||= []).push({ name, method, args, stack });
      }
      return orig(...args);
    };
  };
  wrap('setValueAtTime');
  wrap('setTargetAtTime');
  wrap('linearRampToValueAtTime');
  wrap('exponentialRampToValueAtTime');
  wrap('cancelScheduledValues');
  // .value is a setter — intercept via Object.defineProperty on a forwarder
}

function classifyOrigin(stack) {
  if (/\.jsx(:|\?)/i.test(stack)) return 'ui';
  if (/Engine\.js|engine\.js/.test(stack)) return 'engine';
  return 'unknown';
}
```

### Harness-side check

The QC snapshot adds:

```json
"uiAudioWrites": []      // MUST be empty
"uiAudioWriteCount": 0   // MUST be 0
```

Any non-empty array fails the conformance check with `critical`
severity, listing the offending `(paramName, method, jsx file, line)`.

---

## Layer 3 — Idle null test

A component can pass layers 1 and 2 and still perturb audio through
re-mount, graph rebuilds, or node replacement. Layer 3 is the blunt
confirmation.

**Procedure:**

1. Instantiate the plugin in bypass.
2. Drive pink noise at −18 dBFS.
3. Render the UI at 60 Hz (simulated or real) for 10 seconds with
   **no user interaction**.
4. Null the output against a reference-bypass capture of the same
   noise.
5. **Pass** if residual < −120 dB RMS. **Fail** otherwise.

Anything above −120 dB means something in the UI render path is
reaching the audio — a new node per render, a reconnect, a silent
re-instantiation. Find it.

---

## What each layer catches

| Layer | Catches | Misses |
|-------|---------|--------|
| 1 — Static | Obvious API misuse in JSX | Indirect calls via imported helpers; `.value =` writes |
| 2 — Runtime proxy | Any scheduled write from UI stack | Writes on nodes that aren't AudioParams (connect/disconnect) |
| 3 — Idle null | Anything that actually moves the audio | Nothing (but slow; reserved for Phase C / pre-release) |

All three are required. Any one of them in isolation has blind spots
the other two cover.

---

## Approved patterns (copy these, don't improvise)

**Knob change → engine.** The component calls the public setter. The
setter owns the AudioParam write with smoothing.

```jsx
// Component
<Knob onChange={v => engineRef.current.setDrive(v)} />
```

```js
// Engine
function setDrive(v) {
  state.drive = v;
  driveParam.setTargetAtTime(v, ctx.currentTime, 0.02);
}
```

**Metering.** Component calls an observer; writes to DOM only.

```jsx
useEffect(() => {
  let raf;
  const tick = () => {
    const gr = engineRef.current.getGrDbA();
    needleRef.current.style.transform = `rotate(${grToDeg(gr)}deg)`;
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}, []);
```

**Engine lifecycle.** One factory call per instance, disposed on
unmount.

```jsx
const engineRef = useRef(null);
useEffect(() => {
  let disposed = false;
  createXEngine(ctx).then(engine => {
    if (disposed) return engine.dispose();
    engineRef.current = engine;
  });
  return () => {
    disposed = true;
    engineRef.current?.dispose();
    engineRef.current = null;
  };
}, [ctx]);
```

---

## Where this hooks into the rest of the standard

- **DSP Conformance Spec** section 7 declares each plugin's public
  setter + observer surface — that's the allow-list against which layer
  1 and layer 2 are judged.
- **QC harness** runs layers 2 and 3 automatically during the Phase C
  sweep and surfaces `UI-isolation: PASS/FAIL` as a top-level line in
  the Conformance Report.
- **DEV_RULES** references this document as the enforcement authority;
  no rule duplicated, one source of truth.
