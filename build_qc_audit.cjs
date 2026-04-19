// build_qc_audit.cjs — generate QC_Rack_Audit.docx
// Audit of the QC rack subsystem (src/rack + src/migration).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, Table, TableRow, TableCell, BorderStyle,
  WidthType, ShadingType,
} = require('docx');

const FONT = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: border, bottom: border, left: border, right: border };

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  ...opts,
  children: [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 160 }, children: [new TextRun({ text: t, bold: true, font: FONT, size: 32 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 120 }, children: [new TextRun({ text: t, bold: true, font: FONT, size: 26 })] });
const Code = (t) => new Paragraph({
  spacing: { after: 80 },
  shading: { fill: 'F2F2F2', type: ShadingType.CLEAR },
  children: [new TextRun({ text: t, font: 'Consolas', size: 18 })],
});
const Bullet = (t) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text: t, font: FONT, size: 22 })],
});

function row(cells, header = false) {
  return new TableRow({
    children: cells.map((c) => new TableCell({
      borders,
      width: { size: Math.floor(9360 / cells.length), type: WidthType.DXA },
      shading: header ? { fill: 'D9E2EC', type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: c, font: FONT, size: 20, bold: header })] })],
    })),
  });
}

function table(headers, rows) {
  const cols = headers.length;
  const colW = Math.floor(9360 / cols);
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: Array(cols).fill(colW),
    rows: [row(headers, true), ...rows.map((r) => row(r))],
  });
}

const children = [];

children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: 'QC Rack System \u2014 Audit', bold: true, font: FONT, size: 44 })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 320 },
  children: [new TextRun({ text: 'Shags VST \u00b7 Generated 2026-04-18', font: FONT, size: 22, color: '555555' })],
}));

children.push(H1('1. Executive Summary'));
children.push(P('The QC rack is a small, purpose-built subsystem for A/B listening tests between the original per-plugin engines ("legacy") and the new product-wrapper engines ("nu" / "engine_v1"). It supports strict, manually-driven approval of migrated plugins before their new engine becomes the default load target in the main UI.'));
children.push(P('Two cooperating layers comprise the system:'));
children.push(Bullet('src/rack/ \u2014 audio-graph host: a chainable slot rack, a plugin-type registry with localStorage approval state, and a visual analyzer for waveform / peak / RMS / LUFS-approx / correlation.'));
children.push(Bullet('src/migration/ \u2014 UI-side product registry, per-instance status overlay (info tooltip + QC panel), and a versioned localStorage store driving variant resolution.'));
children.push(P('Approval is exclusively a human action gated behind a UI button; no metric or analyzer output can write to the approval store. Both layers ship matching invariants enforcing this rule.', { run: { italics: true } }));

children.push(H1('2. Files In Scope'));
children.push(table(
  ['Path', 'Lines', 'Role'],
  [
    ['src/rack/rackEngine.js',     '250', 'Audio-graph host: slots, PUT taps, click-safe rewire'],
    ['src/rack/rackRegistry.js',   '208', 'Plugin-type catalogue + QC status store + version resolver'],
    ['src/rack/analyzer.js',       '127', 'Visual analyzer (peak / RMS / LUFS approx / correlation / waveform)'],
    ['src/migration/registry.js',  '111', 'Product / variant catalogue (UI-side)'],
    ['src/migration/store.js',     '83',  'localStorage QC-mode flag + per-product status hook'],
    ['src/migration/QcOverlay.jsx','145', 'Info tooltip + QC panel rendered on every instance'],
  ],
));

children.push(H1('3. rackEngine.js \u2014 Audio Graph Host'));
children.push(H2('3.1 Routing topology'));
children.push(Code('src \u2192 rack.input \u2192 slot0 \u2192 slot1 \u2192 ... \u2192 rack.output \u2192 dest'));
children.push(P('Each slot hosts an engine conforming to the host contract: { input, output, setBypass(on), dispose() }, with optional chainOutput. The rack treats kind and version as opaque labels; nothing in the routing path interprets them.'));

children.push(H2('3.2 Bypass policy'));
children.push(Bullet('Slot bypass is implemented at the rack level: bypassed slots are skipped in the routing graph, not just muted. This works for engines that ignore their own setBypass.'));
children.push(Bullet('engine.setBypass(true) is still called when a slot is bypassed so internal state can also stop processing.'));
children.push(Bullet('setRackBypass(on) collapses the entire chain to input \u2192 output passthrough.'));

children.push(H2('3.3 Plugin-Under-Test (PUT) taps'));
children.push(P('Two unity-gain GainNodes \u2014 tapPre and tapPost \u2014 are kept alive for the lifetime of the rack. When putId is set, the rewire inserts them around that slot:'));
children.push(Code('... prevSlot \u2192 tapPre \u2192 PUT.input \u2192 PUT.output \u2192 tapPost \u2192 nextSlot ...'));
children.push(P('External code (the analyzer) connects AnalyserNodes to these taps; because they are stable nodes, those analyzer fan-outs survive every structural change to the chain.'));

children.push(H2('3.4 Edge registry (the critical correctness fix)'));
children.push(P('Every connect() the rack performs is recorded in a private _edges array. _disconnectAll() iterates that registry and uses the targeted from.disconnect(to) form. The blanket form (engine.input.disconnect()) was deliberately avoided because:'));
children.push(Bullet('It severs the wrapper-internal wiring inside engines (e.g. fx.input \u2192 AudioWorkletNode in fxEngine.js).'));
children.push(Bullet('It tears down analyzer fan-outs that external UI code attached to tapPre / tapPost.'));
children.push(P('By tracking only rack-created edges, both internal engine wiring and external observer wiring are preserved across every rewire.'));

children.push(H2('3.5 Click-safe rewire envelope'));
children.push(Code('const RAMP_MS = 4;  // 4 ms fade \u2014 inaudible\n// _safeRewire():\n//   1. linearRamp output.gain \u2192 0 over RAMP_MS\n//   2. setTimeout(RAMP_MS+1): _rewire(); ramp gain \u2192 1\n//   3. coalesces bursts: extra calls inside the window extend the\n//      mute, do not double-rewire'));
children.push(P('All public mutators (addSlot, replaceSlot, removeSlot, moveSlot, setSlotBypass, setRackBypass, setPUT) call _safeRewire(). The constructor calls _rewire() directly because no audio can be playing yet.'));

children.push(H2('3.6 Engine disposal policy'));
children.push(P('removeSlot() and replaceSlot() defer engine.dispose?.() by 20 ms \u2014 past the 4 ms mute fade \u2014 so reverb / delay tails are not cut mid-ramp on engines holding internal state.'));

children.push(H2('3.7 Public API'));
children.push(table(
  ['Method', 'Returns', 'Behavior'],
  [
    ['addSlot(kind, factory, meta)', 'Promise<id>', 'Awaits factory(ctx); pushes slot; safe rewire'],
    ['replaceSlot(id, factory, meta)', 'Promise<bool>', 'Swaps engine in place; preserves slot id and position; deferred dispose'],
    ['removeSlot(id)', 'bool', 'Splices slot; safe rewire; deferred dispose'],
    ['moveSlot(id, delta)', 'bool', 'Reorder by delta (clamped); safe rewire'],
    ['setSlotBypass(id, on)', 'bool', 'Skips slot in graph + calls engine.setBypass'],
    ['setRackBypass(on)', 'void', 'Collapses chain to passthrough'],
    ['setPUT(id|null)', 'bool', 'Selects which slot is wrapped by tapPre / tapPost'],
    ['getPUT()', 'string|null', 'Current PUT slot id'],
    ['listSlots()', 'array', 'Copies slot meta + engine ref for UI'],
    ['dispose()', 'void', 'Tears down all edges and engines'],
  ],
));

children.push(H1('4. rackRegistry.js \u2014 Plugin-Type Catalogue & QC Status'));

children.push(H2('4.1 Type model'));
children.push(P('Each REGISTRY entry is a plugin type that may expose two factories:'));
children.push(Bullet('legacy \u2014 original per-plugin engine module.'));
children.push(Bullet('nu \u2014 new-engine product wrapper. Named "nu" to avoid the JS keyword "new".'));
children.push(P('A type with only legacy is not migrated yet; the UI disables its approval button. A type with both supports A/B comparison and approval.'));

children.push(H2('4.2 QC status state machine'));
children.push(table(
  ['Status', 'Color', 'Meaning', 'Affects default version?'],
  [
    ['not_started', 'gray',   'Never opened in the rack',           'No (legacy default)'],
    ['in_qc',       'blue',   'Currently being reviewed (soft flag)','No'],
    ['approved',    'green',  'Studio-listened and approved',       'Yes \u2014 nu becomes default'],
    ['needs_work',  'red',    'Listened, not acceptable',           'No'],
    ['deferred',    'yellow', 'Skipped for now, revisit later',     'No'],
  ],
));
children.push(P('Only approved changes default-version resolution. All transitions are manual.'));

children.push(H2('4.3 Strict manual approval rule'));
children.push(P('The file enforces that approval is the exclusive product of a human listening decision:'));
children.push(Bullet('No metric, threshold, correlation, LUFS delta, or null-test ever triggers approve().'));
children.push(Bullet('approve() is called only from a UI button, gated by a confirm dialog.'));
children.push(Bullet('Fresh installs / unknown types always resolve to legacy.'));
children.push(Bullet('Approval is per plugin-type, per browser profile.'));

children.push(H2('4.4 Storage'));
children.push(table(
  ['Key', 'Shape', 'Notes'],
  [
    ['shagsvst.rack.qcStatus.v1', '{ [typeId]: status }', 'Authoritative QC store'],
    ['shagsvst.rack.approved.v1', '{ [typeId]: bool }',   'Legacy flat-boolean store; one-shot migrated to qcStatus.v1 on first read; left in place as rollback anchor'],
  ],
));

children.push(H2('4.5 Registered types (18 total)'));
children.push(P('Both versions (A/B + approval available):'));
children.push(Bullet('drumbus \u2192 legacy: drumBusEngine \u00b7 nu: pantherBussEngine'));
children.push(Bullet('morphReverb \u2192 legacy: morphReverbEngine \u00b7 nu: morphReverbEngineNew'));
children.push(P('Legacy-only (approval button disabled):'));
children.push(P('la2a, analogGlue, gluesmash, neve, iron1073, nastyNeve, distortion, shagatron, tape (424), flanger, modulation, tapeDelay, echoform, simpleReverb, springReverb.'));

children.push(H2('4.6 Version resolution'));
children.push(Code("resolveDefaultVersion(typeId):\n  if type.nu     && isApproved(typeId) \u2192 'nu'\n  if type.legacy                       \u2192 'legacy'\n  if type.nu                           \u2192 'nu'  (no legacy)\n  else                                 \u2192 null"));
children.push(P('loadFactory(typeId, version) lazily imports the engine module and returns the create*Engine function.'));

children.push(H1('5. analyzer.js \u2014 Visual Inspection Tap'));
children.push(P('Strictly visual. The signal fans out to AnalyserNodes; nothing in the audio path changes. AnalyserNodes process input regardless of whether their output is connected, so no silent-pull plumbing is needed.'));

children.push(H2('5.1 Reported metrics'));
children.push(Bullet('waveform \u2014 time-domain Float32 buffer (mono mix).'));
children.push(Bullet('peakDb \u2014 peak with 0.93 decay coefficient (peakHold = max(pk, peakHold * 0.93)).'));
children.push(Bullet('rmsDb \u2014 windowed RMS over 2048 samples.'));
children.push(Bullet('lufs \u2014 momentary K-weighted approximation (400 ms window).'));
children.push(Bullet('clipping \u2014 true for 300 ms after any sample >= 0.999.'));
children.push(Bullet('lrDiffDb \u2014 peak(L) minus peak(R) in dB.'));
children.push(Bullet('correlation \u2014 sum(L*R) / sqrt(sum(L^2) * sum(R^2)). +1 mono, 0 decorrelated, -1 inverted.'));

children.push(H2('5.2 K-weighting branch'));
children.push(P('Two biquads on a silent analysis branch approximate BS.1770:'));
children.push(Bullet('HPF ~38 Hz, Q = 0.5'));
children.push(Bullet('High-shelf +4 dB @ ~1.5 kHz'));
children.push(P('LUFS = -0.691 + 10 * log10(meanSquare). UI labels this "LUFS ~" \u2014 not a certified meter; intended for eyeballing loudness deltas across a plugin.', { run: { italics: true } }));

children.push(H2('5.3 Helpers'));
children.push(Bullet('drawWave(ctx, buf, w, h, color) \u2014 paints to a 2D canvas with subtle midline and stroked waveform.'));
children.push(Bullet('fmtDb(v) \u2014 signed dB string with one decimal; "-inf" for non-finite.'));

children.push(H1('6. src/migration/ \u2014 UI-Side Status Layer'));

children.push(H2('6.1 Three-namespace discipline (registry.js)'));
children.push(P('The registry deliberately keeps three never-fused namespaces:'));
children.push(table(
  ['Namespace', 'Format', 'Stability', 'Used for'],
  [
    ['productId',    'snake_case',                  'forever',   'state key'],
    ['variantId',    "'legacy' | 'engine_v1' | ...",'closed set','code switches'],
    ['displayLabel', 'free text',                   'mutable',   'UI only \u2014 never read by code'],
  ],
));
children.push(P('Boot-time invariants: every product must have a legacy variant, and every variant entry must have variantId matching its key.'));

children.push(H2('6.2 Registered products'));
children.push(table(
  ['productId', 'displayLabel', 'category', 'legacyType', 'variants'],
  [
    ['panther_buss', 'Panther Buss', 'Dynamics', 'drumbus',  'legacy (DrumBusOrb / drumBusEngine), engine_v1 (PantherBussOrb / pantherBussEngine)'],
    ['manchild',     'MANchild',     'Dynamics', 'manchild', 'legacy only (ManChildOrb / manChildEngine) \u2014 flagship vari-mu compressor'],
  ],
));

children.push(H2('6.3 Status state model (store.js)'));
children.push(table(
  ['Status', 'Source', 'Meaning'],
  [
    ['legacy_only',        'automatic', 'No non-legacy variants exist'],
    ['in_qc',              'default',   'Seeded for products with a migrated variant'],
    ['approved_engine_v1', 'manual',    'User clicked Approve in QcPanel'],
    ['needs_work',         'manual',    'User clicked Revoke (downgrade)'],
    ['deferred',           'manual',    'User chose Defer'],
  ],
));
children.push(P('defaultVariantFor(productId) returns "engine_v1" if status is approved_engine_v1, else "legacy". This is what the non-QC menu calls when the user picks "Panther Buss" \u2014 approval flips which variant materializes.'));

children.push(H2('6.4 Versioned localStorage schema'));
children.push(Code("NS              = 'migration.v1'\nKEY_QC_MODE     = 'migration.v1.qcMode'        ('1' | '0')\nkeyStatus(pid)  = 'migration.v1.status.<pid>'  status string"));
children.push(P('Future shape changes bump the prefix to .v2. so persisted state never silently corrupts.'));

children.push(H2('6.5 Cross-instance change propagation'));
children.push(P('writeStatus dispatches a CustomEvent("migration:change") and the storage event also wakes other tabs. useProductStatus uses useSyncExternalStore against both, so all instances re-render when any one of them transitions.'));

children.push(H2('6.6 QcOverlay.jsx \u2014 per-instance widgets'));
children.push(Bullet('InfoIcon \u2014 small info glyph, always rendered (QC on or off). Hover shows a monospaced tooltip with: displayLabel, variantId, displayLabel, componentName, engineName, status.'));
children.push(Bullet('QcPanel \u2014 rendered only when QC Mode is on. Status badge (color-coded), Approve / Revoke buttons (visibility gated by current state and current variant), and a "Load <alternate>" button.'));
children.push(Bullet('Status badges use color tokens defined inline (legacy_only gray, in_qc amber, approved green, needs_work red, deferred lavender).'));

children.push(H1('7. System-Level Properties'));

children.push(H2('7.1 Two parallel approval stores \u2014 divergence risk'));
children.push(P('rackRegistry.js and migration/store.js maintain separate localStorage namespaces with overlapping intent:'));
children.push(table(
  ['Layer', 'Key', 'States'],
  [
    ['rack/rackRegistry', 'shagsvst.rack.qcStatus.v1', 'not_started, in_qc, approved, needs_work, deferred'],
    ['migration/store',   'migration.v1.status.<pid>', 'legacy_only, in_qc, approved_engine_v1, needs_work, deferred'],
  ],
));
children.push(P('Status names overlap conceptually but are typed differently (approved vs. approved_engine_v1) and keyed by different ids (typeId vs. productId). Neither writes to the other. A plugin approved in the rack does not propagate to the migration overlay, and vice versa. This is intentional in the current architecture but worth flagging for future consolidation.', { run: { italics: true } }));

children.push(H2('7.2 Click-safety contract'));
children.push(P('All structural mutations to the rack land inside a 4 ms output-gain mute window, batched. Any future code path that bypasses _safeRewire() and calls _rewire() directly violates the contract; the only legitimate caller of raw _rewire() is the constructor.'));

children.push(H2('7.3 Edge correctness contract'));
children.push(P('All rack-created connections must go through _rackConnect(from, to). Any connect() call that bypasses the registry will leak \u2014 _disconnectAll() will not undo it, and rewires will accumulate dangling edges.'));

children.push(H2('7.4 Strict-manual-approval invariant'));
children.push(P('Both layers enforce: no automated path writes "approved" status. Specifically grep-clean checkpoints are:'));
children.push(Bullet('rackRegistry.approve() callers \u2014 only UI button handlers.'));
children.push(Bullet('migration/store.approve() callers \u2014 only QcPanel button click.'));
children.push(Bullet('analyzer.js never imports any registry / store module.'));

children.push(H1('8. Findings & Recommendations'));

children.push(H2('8.1 Strengths'));
children.push(Bullet('Targeted edge tracking is the right correctness primitive \u2014 the comments document exactly which bug class it eliminates.'));
children.push(Bullet('Click-safe rewire with burst coalescing means the user cannot create audible artefacts by spamming structural changes.'));
children.push(Bullet('Strict manual-approval rule is encoded both in policy comments and in API surface (no analyzer-driven path even exists).'));
children.push(Bullet('Three-namespace registry discipline prevents UI-string drift from leaking into state keys.'));
children.push(Bullet('Versioned localStorage prefixes (.v1) provide a clean migration anchor.'));

children.push(H2('8.2 Risks / open items'));
children.push(Bullet('Two parallel status stores (rack vs. migration) \u2014 same conceptual state, different keys and label conventions. A user approving in one place does not see it reflected in the other. Recommend collapsing to a single store, or documenting the split as deliberate.'));
children.push(Bullet('rackRegistry status uses approved while migration store uses approved_engine_v1. Names should agree if the stores are ever unified.'));
children.push(Bullet('LUFS approximation is not labelled as "approx" anywhere except the source comment. UI consumers must surface "LUFS ~" themselves.'));
children.push(Bullet('replaceSlot does not currently call setBypass on the displaced engine before disposing \u2014 relies on dispose() being thorough. Worth a one-line precaution.'));
children.push(Bullet('The legacy boolean store (shagsvst.rack.approved.v1) is migrated read-only on first read of the new store. If the new store is cleared but the legacy key still exists, approvals will resurrect. Document or actively clear after a quarantine period.'));

children.push(H2('8.3 Suggested next steps'));
children.push(Bullet('Unify the rack and migration status stores behind a single API; keep both layers as thin views.'));
children.push(Bullet('Add a one-line caller-facing comment on _safeRewire describing the burst-coalescing behaviour.'));
children.push(Bullet('Add a "qcMode banner" guard in QcOverlay so InfoIcon never overlaps a host plugin badge in the top-left.'));
children.push(Bullet('Tighten the analyzer dispose() to also disconnect anL / anR / anK if any future change makes them subscribers.'));

children.push(H1('9. Glossary'));
children.push(table(
  ['Term', 'Meaning'],
  [
    ['PUT',          'Plugin Under Test \u2014 the slot currently wrapped by tapPre / tapPost so the analyzer can read its input and output'],
    ['legacy',       'The original per-plugin engine factory (e.g. drumBusEngine)'],
    ['nu',           'The new-engine product wrapper for the same plugin type (e.g. pantherBussEngine). Named "nu" to dodge the "new" keyword'],
    ['engine_v1',    'Migration-side variantId for the migrated wrapper'],
    ['QC Mode',      'A UI-wide toggle that surfaces QcPanel widgets on every plugin instance'],
    ['approved',     'The single status that flips default version resolution from legacy to nu'],
    ['safe rewire',  'Structural change wrapped in a 4 ms output-gain fade, with burst coalescing'],
    ['edge registry','Private list of connect() calls the rack made; used by _disconnectAll() to undo only what the rack created'],
  ],
));

children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 320 },
  children: [new TextRun({ text: '\u2014 End of audit \u2014', italics: true, font: FONT, size: 20, color: '777777' })],
}));

const doc = new Document({
  creator: 'Claude',
  title: 'QC Rack System \u2014 Audit',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '\u2022',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

const out = path.join(__dirname, 'QC_Rack_Audit.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
