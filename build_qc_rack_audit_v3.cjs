// Build QC_Rack_Audit.docx — audit of the QC rack system as of the γ structural split.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  PageOrientation, PageBreak
} = require('docx');

const OUT = path.join('C:', 'Users', 'HEAT2', 'Desktop', 'Shags VST', 'QC_Rack_Audit.docx');

// ---------- helpers ----------
const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  ...opts,
  children: [new TextRun({ text, font: 'Arial', size: 22, ...(opts.run || {}) })],
});
const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 },
  children: [new TextRun({ text, font: 'Arial', size: 32, bold: true })],
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: 'Arial', size: 26, bold: true })],
});
const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 100 },
  children: [new TextRun({ text, font: 'Arial', size: 23, bold: true })],
});
const Bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 60 },
  children: [new TextRun({ text, font: 'Arial', size: 22 })],
});
const Code = (text) => new Paragraph({
  spacing: { after: 80 },
  shading: { fill: 'F2F2F2', type: ShadingType.CLEAR },
  children: [new TextRun({ text, font: 'Consolas', size: 20 })],
});
const Bold = (text, size = 22) => new TextRun({ text, font: 'Arial', size, bold: true });
const Plain = (text, size = 22) => new TextRun({ text, font: 'Arial', size });

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };

function tbl(header, rows, widths) {
  const totalWidth = widths.reduce((a,b)=>a+b,0);
  const mkCell = (txt, isHead) => new TableCell({
    borders,
    width: { size: widths[0], type: WidthType.DXA }, // overwritten per col below
    shading: isHead ? { fill: '1F3A5F', type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({
        text: txt ?? '', font: 'Arial', size: 20,
        bold: isHead, color: isHead ? 'FFFFFF' : '000000',
      })],
    })],
  });
  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map((t, i) => {
      const c = mkCell(t, true);
      c.root[0].root.find(x => x && x.rootKey === 'w:tcW');
      return new TableCell({
        borders,
        width: { size: widths[i], type: WidthType.DXA },
        shading: { fill: '1F3A5F', type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: t, font: 'Arial', size: 20, bold: true, color: 'FFFFFF' })] })],
      });
    }),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((t, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: ri % 2 === 1 ? { fill: 'F7F7F7', type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: t ?? '', font: 'Arial', size: 20 })] })],
    })),
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

// ---------- content ----------
const children = [];

// Title block
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 100 },
  children: [new TextRun({ text: 'QC Rack System — Audit', font: 'Arial', size: 48, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: 'Shags VST · Plugin Quality-Control Harness', font: 'Arial', size: 26, color: '555555' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 320 },
  children: [new TextRun({ text: 'Audit date: 2026-04-20 · Post-γ structural split', font: 'Arial', size: 22, color: '777777', italics: true })],
}));

// ===== 1. Executive Summary =====
children.push(H1('1. Executive Summary'));
children.push(P('The QC rack is a four-layer, four-tier quality-control harness that sits between a prototype plugin engine and its promoted v1 successor. It probes each plugin across a battery of signals (sine, noise, impulse, sweep, silence, dirac pairs), analyses numeric bundles against versioned rules, surfaces human-readable fixes with provenance, and gates promotion through an explicit approval workflow.'));
children.push(P('This session delivered Option γ — a full structural split of the variant model. The legacy single-string "variantId" field was replaced with two disambiguated fields: productId (stable) and version (enum: prototype | v1). The localStorage namespace was bumped (migration.v1.* → migration.v2.*, qc:approvals:v1 → v2) with idempotent read-time migration shims preserving every existing approval. Nomenclature was normalised across the codebase: legacy → prototype, engine_v1 → v1.'));
children.push(P('Build status: 560 modules transformed in 8.82 s, no new errors introduced. Five core modules pass node --check. All three localStorage migrations are flag-guarded one-shots.'));

// ===== 2. Architecture Overview =====
children.push(H1('2. Architecture Overview'));

children.push(H2('2.1 Four-layer model'));
children.push(tbl(
  ['Layer', 'Name', 'Responsibility', 'Primary module(s)'],
  [
    ['A', 'Harness',  'Signal injection + capture + worklet lifecycle', 'QcHarness.jsx, captureHooks.js'],
    ['B', 'Rules',    'Versioned probe rules (T1–T4) producing findings', 'qcAnalyzer.js (RULE_META)'],
    ['C', 'userFix',  'Plain-language meaning/fix copy with provenance',  'userFix/index.js, overrides.json'],
    ['D', 'Decision', 'Approval workflow, status palette, promotion gate', 'QcStrip, QcOverlay, QcWizard, migration/store.js'],
  ],
  [1000, 1600, 4160, 2600],
));

children.push(H2('2.2 Four-tier probe system'));
children.push(tbl(
  ['Tier', 'Theme', 'Confidence', 'Examples'],
  [
    ['T1', 'Core correctness',    'MUST',   'dc_handling, gain_sanity, bypass_null, nan_inf'],
    ['T2', 'Stability',           'MUST',   'denorm_rebound, latency_report, tail_decay'],
    ['T3', 'Advanced DSP',        'SHOULD', 'freeze_stability, sidechain_regime, wdf_convergence, band_reconstruction, lpc_stability, fft_frame_phase'],
    ['T4', 'Pressure / long-run', 'COULD',  'os_boundary, series_identity, long_session_drift'],
  ],
  [900, 2400, 1400, 4660],
));

children.push(H2('2.3 Three-namespace disambiguation'));
children.push(Bullet('productId — stable identity key (e.g. manChild, lofiLoofy). Never displayed verbatim.'));
children.push(Bullet('version — enum { prototype, v1 }. Drives engine factory selection + approval key.'));
children.push(Bullet('displayLabel — free-text, user-facing. Decoupled from both of the above.'));
children.push(P('Before γ: a single variantId string conflated all three. After γ: each axis is independently addressable.'));

// ===== 3. γ Structural Split =====
children.push(H1('3. γ Structural Split — What Changed'));

children.push(H2('3.1 Field rename surface'));
children.push(tbl(
  ['Before', 'After', 'Scope'],
  [
    ['variantId',     'version',        'All modules: registry, store, analyzer, userFix, Orb shells'],
    ['legacy',        'prototype',      'Variant enum value + URL back-compat map'],
    ['engine_v1',     'v1',             'Variant enum value + approval key'],
    ['VARIANT_LABELS','VERSION_LABELS', 'registry.js display-label export'],
    ['defaultVariantFor', 'defaultVersionFor', 'store.js API'],
    ['altVariantId',  'altVersion',     'QcOverlay info row'],
  ],
  [2600, 2600, 4160],
));

children.push(H2('3.2 localStorage namespace bump + migrations'));
children.push(Code('NS      = "migration.v2"            // was "migration.v1"'));
children.push(Code('APPROVAL_LS_KEY = "qc:approvals:v2" // was "qc:approvals:v1"'));
children.push(P('Two idempotent one-shot migration shims run at module import:'));
children.push(Bullet('runV1Migration() — reads legacy migration.v1.* entries, maps legacy_only→prototype_only and approved_engine_v1→approved_v1, writes under v2, sets migration.v2.migratedFromV1=1 flag.'));
children.push(Bullet('_migrateApprovalsOnce() — reads qc:approvals:v1 JSON, rewrites keys ({pid}:legacy→{pid}:prototype, {pid}:engine_v1→{pid}:v1), writes under v2, sets qc:approvals:v2.migrated flag.'));
children.push(P('Both are guarded by flag keys so they cannot re-run or corrupt post-migration writes.'));

children.push(H2('3.3 URL back-compat'));
children.push(Code('const raw = params.get("version") || params.get("variant");'));
children.push(Code('const version = raw === "legacy" ? "prototype"'));
children.push(Code('              : raw === "engine_v1" ? "v1"'));
children.push(Code('              : raw;'));
children.push(P('Bookmarked ?variant=legacy and ?variant=engine_v1 URLs continue to resolve correctly.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ===== 4. Module inventory =====
children.push(H1('4. Module Inventory'));

children.push(tbl(
  ['File', 'Role', 'γ changes'],
  [
    ['src/migration/registry.js',  'Variant factory registry + labels',         'prototype/v1 keys, VERSION_LABELS, boot invariant rename'],
    ['src/migration/store.js',     'Approval state + one-shot v1→v2 migration', 'NS bump, defaultVersionFor, runV1Migration'],
    ['src/migration/QcStrip.jsx',  'Status pill + lifecycle buttons',           'version field reads, hasV1Variant, onSwitchVariant("v1")'],
    ['src/migration/QcOverlay.jsx','Info drawer over plugin shell',             'altVersion field, "Version" info row'],
    ['src/migration/QcWizard.jsx', 'FORK step walkthrough',                     'Code sample uses version:"v1" template'],
    ['src/qc-harness/QcHarness.jsx','Engine-side harness container',            'version prop, initialVersion picker, curVersion state'],
    ['src/qc-harness/Analyzer.jsx','Findings surface + approval UI',            'APPROVAL_LS_KEY v2, VariantChip labels, migration shim'],
    ['src/qc-harness/QcDrawer.jsx','Per-instance QC drawer',                    'VariantPill→version prop, PROTO/V1 labels'],
    ['src/qc-harness/qcAnalyzer.js','RULE_META + finding producer',             'variant_drift META docstring, bundle.product.version read'],
    ['src/qc-harness/captureHooks.js','getEngineFactory(productId, version)',   'Branches on version === "v1"'],
    ['src/qc-harness/userFix/index.js','Layer-C knowledge base',                'Match grammar field renamed, scoring uses version'],
    ['src/qc-harness/userFix/overrides.json','Per-capability copy overrides',   '(data file; schema field rename only)'],
    ['src/main.jsx',               'App root + tab state + URL back-compat',    'tab=prototype default, v1Items, URL rewrite map'],
    ['src/manChild/ManChildOrb.jsx','Plugin shell',                             'version prop, loadVariantModule(version)'],
  ],
  [3400, 3200, 2760],
));

// ===== 5. userFix layer =====
children.push(H1('5. userFix Layer — Resolution Pipeline'));
children.push(P('The userFix layer (src/qc-harness/userFix/index.js) is the bridge between a raw rule firing and actionable plain-English guidance. Every override carries provenance so help text written by strangers is trustworthy.'));

children.push(H3('5.1 Match grammar'));
children.push(Code('severity:     "fail" | "warn" | "info" | "*"'));
children.push(Code('capabilities: { key: value | ">=N" | "<=N" | "eq:X" }'));
children.push(Code('productId:    string | "*"     (prefer capabilities)'));
children.push(Code('version:      string | "*"     (prefer capabilities)'));

children.push(H3('5.2 Specificity scoring'));
children.push(Bullet('plugin-specific (productId + version): +10'));
children.push(Bullet('capability-match: +2 per matched capability'));
children.push(Bullet('severity-specific (non-*): +2'));
children.push(Bullet('Ties broken by array order — later wins.'));

children.push(H3('5.3 Resolution pipeline'));
children.push(Code('default = RULE_META[ruleId]                  // layer-B default'));
children.push(Code('bySev   = default.bySeverity?.[severity]     // back-compat branch'));
children.push(Code('fixes   = overrides.filter(matches, context) // layer-C overrides'));
children.push(Code('merged  = default < bySev < ...fixes         // specificity-ordered'));

// ===== 6. Verification =====
children.push(H1('6. Verification'));
children.push(Bullet('node --input-type=module --check on registry.js, store.js, captureHooks.js, userFix/index.js, qcAnalyzer.js — all OK.'));
children.push(Bullet('npm run build — 560 modules transformed in 8.82 s. No new warnings; only pre-existing dynamic-vs-static import notices for prototype engines.'));
children.push(Bullet('Full grep sweep for legacy / engine_v1 / variantId — remaining hits are all intentional: migration maps, URL back-compat, rack’s orthogonal version:"legacy"|"nu" namespace, CONFORMANCE pre-rename notes.'));

// ===== 7. Open work / next steps =====
children.push(H1('7. Open Work'));
children.push(H2('7.1 Onboarding queue'));
children.push(Bullet('Flap Jack Man — capabilities declaration + v1 fork + factory route'));
children.push(Bullet('Flap Jack Man — isolation sweep across all tiers, CONFORMANCE findings'));
children.push(Bullet('Panther Buss — onboarding + isolation sweep'));
children.push(Bullet('Cross-plugin T3/T4 findings rollup'));

children.push(H2('7.2 DSP surgery'));
children.push(Bullet('Lofi Loofy v2 — Mix-knob in-worklet surgery (per dry_wet_mix_rule §1)'));
children.push(Bullet('ManChild / Lofi Loofy — T3 + T4 isolation sweeps'));

children.push(H2('7.3 Probe rule coverage'));
children.push(tbl(
  ['ID',   'Name',               'Tier-confidence'],
  [
    ['T3.4','freeze_stability',    'SHOULD'],
    ['T3.5','sidechain_regime',    'SHOULD'],
    ['T3.6','band_reconstruction', 'COULD'],
    ['T3.7','lpc_stability',       'COULD'],
    ['T3.8','fft_frame_phase',     'COULD'],
    ['T3.9','wdf_convergence',     'SHOULD'],
    ['T3.10','pitch_idle',         'COULD'],
    ['T4.2','os_boundary',         'SHOULD'],
    ['T4.3','series_identity',     'SHOULD'],
    ['T4.4','long_session_drift',  'COULD'],
  ],
  [900, 3800, 4660],
));

children.push(H2('7.4 Wizard + copy'));
children.push(Bullet('FORK step UX deep work-through'));
children.push(Bullet('userFix copy rewrite — tone + provenance coverage'));

// ===== 8. Appendix: key invariants =====
children.push(H1('8. Appendix — Key Invariants'));
children.push(Bullet('Every product in the registry must expose a prototype variant (boot invariant throws otherwise).'));
children.push(Bullet('A product is promotable only when every T1 + T2 rule is approved under its v1 version.'));
children.push(Bullet('localStorage writes are never mixed across the v1/v2 namespaces post-migration — the flag key is the only read gate.'));
children.push(Bullet('The prop-level version flows: main.jsx → Shell → ManChildOrb → loadVariantModule(version). Remount key {inst.id}:{version} guarantees clean engine swap.'));
children.push(Bullet('Rack-level version:"legacy"|"nu" is a separate concept from plugin-level version and was intentionally untouched by γ.'));

// ---------- build ----------
const doc = new Document({
  creator: 'Claude',
  title: 'QC Rack System — Audit',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '1F3A5F' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '2E5984' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ],
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

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('Wrote', OUT, buf.length, 'bytes');
});
