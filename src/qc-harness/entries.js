// src/qc-harness/entries.js
//
// Shared helpers for building the harness control list from an engine.
// Used by BOTH the standalone QcHarness (?qc= route) AND the docked
// QcDrawer that runs inside the main app.
//
// Keeping them identical means the in-app QC experience and the headless
// route report the same thing for the same engine.

export function inferKind(name) {
  const n = name;
  if (/^setBypass$/.test(n))        return { kind: 'bool', def: 0 };
  if (/^setFB$/.test(n))            return { kind: 'bool', def: 0 };
  if (/^setSc[AB]$/.test(n))        return { kind: 'bool', def: 1 };
  if (/^setComp$/.test(n))          return { kind: 'bool', def: 0 };
  const low = n.toLowerCase();
  if (low.includes('threshold'))    return { kind: 'db',   min: -60, max: 0,  step: 0.5, def: -18 };
  if (/^set(In|Out)$/.test(n))      return { kind: 'db',   min: -24, max: 24, step: 0.1, def: 0 };
  if (low.includes('freq') || low.endsWith('hz'))
                                    return { kind: 'hz',   min: 20,  max: 20000, step: 1, def: 1000 };
  return { kind: 'unit', min: 0, max: 1, step: 0.01, def: 0.5 };
}

export function buildEntries(engine) {
  const setKeys = Object.keys(engine)
    .filter(k => /^set[A-Z]/.test(k) && typeof engine[k] === 'function')
    .sort();
  const schema = Array.isArray(engine.paramSchema) ? engine.paramSchema : null;

  if (schema) {
    const byName = new Map(schema.map(s => [s.name, s]));
    const out = schema.map(s => ({ ...s, _inSchema: true }));
    for (const k of setKeys) {
      if (!byName.has(k)) out.push({ name: k, label: k + ' (UNDECLARED)', ...inferKind(k), _inSchema: false });
    }
    return out;
  }
  return setKeys.map(k => ({ name: k, label: k, ...inferKind(k), _inSchema: false }));
}

export function candidateKeys(setName) {
  if (!setName.startsWith('set')) return [setName];
  const rest = setName.slice(3);
  const camel = rest[0].toLowerCase() + rest.slice(1);
  const snake = camel.replace(/([A-Z])/g, '_$1').toLowerCase();
  return [camel, snake, setName, rest];
}

// Split entries into a COMMON list plus A/B paired sections. An entry with
// `group: 'A'` / `group: 'B'` is explicitly paired; otherwise we auto-pair
// by suffix (setFooA / setFooB → one pair named 'setFoo').
export function groupEntries(entries) {
  const common = [];
  const aByBase = new Map();
  const bByBase = new Map();

  for (const e of entries) {
    const m = e.name.match(/^(.+)([AB])$/);
    if (e.group === 'A' || (m && m[2] === 'A')) aByBase.set(m ? m[1] : e.name, e);
    else if (e.group === 'B' || (m && m[2] === 'B')) bByBase.set(m ? m[1] : e.name, e);
    else common.push(e);
  }

  const pairs = [];
  const extraCommon = [...common];
  const seenBases = new Set();
  for (const [base, a] of aByBase) {
    const b = bByBase.get(base);
    if (b) { pairs.push({ base, A: a, B: b }); seenBases.add(base); }
    else   { extraCommon.push(a); }
  }
  for (const [base, b] of bByBase) {
    if (!seenBases.has(base)) extraCommon.push(b);
  }
  return { common: extraCommon, pairs };
}

// Build the initial { paramName: value } map from entries.
export function buildDefaults(entries) {
  const defaults = {};
  for (const en of entries) {
    if (en.kind === 'noop')   continue;
    if (en.kind === 'preset') defaults[en.name] = '';
    else                      defaults[en.name] = en.def ?? 0;
  }
  return defaults;
}
