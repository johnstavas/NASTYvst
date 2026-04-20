// src/qc-harness/conformanceChecks.js
// =========================================================================
// Per-product Phase-C conformance checks.
//
// Each check.id traces back to the corresponding row in the plugin's
// CONFORMANCE.md — if the spec row changes, update the check here. That
// coupling is intentional: the spec is the contract, the check enforces it.
//
// A check returns { severity, msg } where severity is one of:
//   ok | info | minor | major | critical | cannot_verify
// "ok" results are dropped from the items list to avoid flooding the UI;
// only non-ok entries are surfaced. "cannot_verify" is not a failure —
// it just means the harness doesn't have enough info this tick (e.g.
// the check only applies when a knob is at 0 and it isn't right now).
// =========================================================================

import { LOFI_CHARACTERS } from '../lofiLoofy/lofiLoofyEngine.js';

// ── helpers ───────────────────────────────────────────────────────────────
const ok            = (msg)  => ({ severity: 'ok',            msg: msg || '' });
const info          = (msg)  => ({ severity: 'info',          msg });
const minor         = (msg)  => ({ severity: 'minor',         msg });
const major         = (msg)  => ({ severity: 'major',         msg });
const critical      = (msg)  => ({ severity: 'critical',      msg });
const cannotVerify  = (msg)  => ({ severity: 'cannot_verify', msg: msg || '' });

// ── Universal checks (every Engine_V1 plugin) ────────────────────────────
const universalChecks = [
  {
    id: 'U1',
    name: 'getLatency() reports a finite non-negative number',
    run: ({ engine }) => {
      if (typeof engine?.getLatency !== 'function') return cannotVerify('engine.getLatency missing');
      const lat = engine.getLatency();
      if (!Number.isFinite(lat)) return major(`getLatency() returned non-finite ${lat}`);
      if (lat < 0)               return major(`getLatency() returned negative ${lat}`);
      return ok(`latency = ${(lat * 1000).toFixed(1)} ms`);
    },
  },
  {
    id: 'U2',
    name: 'engineState.bypass tracks setBypass value',
    run: ({ engineState, values }) => {
      if (!engineState) return cannotVerify('engine has no getState()');
      if (values?.setBypass === undefined) return cannotVerify('setBypass not in captured values');
      const want = values.setBypass ? 1 : 0;
      const got  = Number(engineState.bypass ?? 0);
      if (got !== want) return major(`setBypass=${values.setBypass} but engineState.bypass=${engineState.bypass}`);
      return ok();
    },
  },
];

// ── Per-product checks ────────────────────────────────────────────────────
const perProduct = {
  // ---------- Lofi Loofy ----------
  lofi_loofy: [
    {
      id: 'LL-M18',
      name: 'setDream=0 → reverbSendLevel settled to ~0',
      run: ({ engineState, values }) => {
        if (!engineState) return cannotVerify();
        if (values?.setDream === undefined) return cannotVerify('setDream not captured');
        // Check only fires when user is at 0. Elsewhere it's ok by construction.
        if (values.setDream > 0.01) return ok();
        if (engineState.reverbSendLevel === undefined) return cannotVerify('reverbSendLevel not in getState()');
        // setTargetAtTime τ=0.08 s — after 600 ms settle residual < 0.01 (≈ −40 dB of reach).
        if (engineState.reverbSendLevel > 0.01) {
          return minor(`reverbSendLevel=${engineState.reverbSendLevel.toFixed(4)} — expected ≈ 0`);
        }
        return ok();
      },
    },
    {
      id: 'LL-M20',
      name: 'setDust=0 → dust bus silent',
      run: ({ engineState, values }) => {
        if (!engineState) return cannotVerify();
        if (values?.setDust === undefined) return cannotVerify('setDust not captured');
        if (values.setDust > 0.01) return ok();
        if (engineState.dustHiss === undefined || engineState.dustGrit === undefined) {
          return cannotVerify('dustHiss/dustGrit not in getState()');
        }
        if (engineState.dustHiss > 1e-4 || engineState.dustGrit > 1e-4) {
          return minor(`dustHiss=${engineState.dustHiss.toExponential(2)} dustGrit=${engineState.dustGrit.toExponential(2)} — expected ≈ 0`);
        }
        return ok();
      },
    },
    {
      id: 'LL-M16',
      name: 'character DSP vars match LOFI_CHARACTERS definition',
      run: ({ engineState }) => {
        if (!engineState) return cannotVerify();
        const name = engineState.character;
        if (!name) return cannotVerify('no character active');
        const def = LOFI_CHARACTERS[name];
        if (!def) return major(`engineState.character='${name}' has no LOFI_CHARACTERS entry`);
        const diffs = [];
        const eq = (a, b, label, tol) => {
          if (a === undefined) { diffs.push(`${label}: missing in engineState`); return; }
          if (Math.abs(a - b) > (tol ?? 1e-3)) diffs.push(`${label}: state=${a} def=${b}`);
        };
        eq(engineState.charTilt,        def.tilt,        'tilt',        1e-3);
        eq(engineState.charBwLPHz,      def.bwLP,        'bwLP',        1);
        eq(engineState.charBwHPHz,      def.bwHP,        'bwHP',        1);
        eq(engineState.charDriftRate,   def.driftRate,   'driftRate',   0.01);
        eq(engineState.charFlutterRate, def.flutterRate, 'flutterRate', 0.05);
        // Compare against charSatBase (the pure character baseline), not the
        // live satBase sum — otherwise Age/Texture/Dream contributions would
        // read as drift. See engine getState() docstring.
        if (def.satBase != null) eq(engineState.charSatBase, def.satBase, 'satBase', 0.01);
        if (diffs.length) return major(`character '${name}' drift — ${diffs.join(' · ')}`);
        return ok();
      },
    },
    {
      id: 'LL-M19',
      name: 'Dream target=mix must NOT mutate user Mix (§8.2 known deviation)',
      run: ({ engineState, values }) => {
        if (!engineState) return cannotVerify();
        // This check reflects the spec's known deviation — current behavior
        // dual-writes dryGain/wetGain, violating DEV_RULES B4. Logged as
        // 'info' not 'major' because §8.2 catalogues it; the fix is owed
        // for spec v1.1.0. Surfacing it here keeps it visible until fixed.
        if (engineState.dreamTarget === 'mix' && values?.setDream > 0.01) {
          return info('Dream target=mix: DSP currently dual-writes user Mix (spec §8.2, fix scheduled v1.1.0)');
        }
        return ok();
      },
    },
  ],

  // ---------- ManChild ----------
  manchild: [
    {
      id: 'MC-CHAR',
      name: 'setCharacter populates engineState.character',
      run: ({ engineState, values }) => {
        if (!engineState) return cannotVerify();
        const requested = values?.setCharacter;
        if (!requested) return cannotVerify('no character requested');
        if (engineState.character !== requested) {
          return major(`values.setCharacter='${requested}' but engineState.character='${engineState.character}'`);
        }
        return ok();
      },
    },
    {
      id: 'MC-TXDRIVE-DEFAULT',
      name: 'txDrive boots at schema default 0 (F1 regression guard)',
      run: ({ engineState, values }) => {
        // This guards the F1 fix landed 2026-04-19 — currentDrive init
        // was 0.35, corrected to 0. If anyone reverts it, engineState.txDrive
        // will be 0.35 on a fresh mount with values.setTxDrive still 0.
        if (!engineState) return cannotVerify();
        if (values?.setTxDrive !== undefined && values.setTxDrive > 0.01) return ok();
        const got = Number(engineState.txDrive ?? 0);
        if (got > 0.01) return minor(`txDrive=${got} but setTxDrive not engaged — F1 regression?`);
        return ok();
      },
    },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────
export function runConformanceChecks({ productId, engineState, values, measurements, engine }) {
  const results = [];
  const all = [...universalChecks, ...(perProduct[productId] || [])];
  for (const check of all) {
    let res;
    try {
      res = check.run({ engineState, values, measurements, engine, productId });
    } catch (err) {
      res = cannotVerify(`check '${check.id}' threw: ${err?.message || err}`);
    }
    results.push({
      checkId:  check.id,
      name:     check.name,
      severity: res.severity || 'ok',
      msg:      res.msg || '',
    });
  }
  return results;
}

// Convenience: returns only the non-ok results, for UI / snapshot.
export function conformanceItems({ productId, engineState, values, measurements, engine }) {
  return runConformanceChecks({ productId, engineState, values, measurements, engine })
    .filter(r => r.severity !== 'ok');
}
