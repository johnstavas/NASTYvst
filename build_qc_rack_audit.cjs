// Build QC Rack Audit document for the current session's work.
// Output: C:\Users\HEAT2\Desktop\Shags VST\QC_Rack_Audit.docx
// Usage: node build_qc_rack_audit_session.cjs

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber,
  Header, Footer, PageBreak, TabStopType, TabStopPosition,
} = require('docx');

// ---------- style helpers ----------
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

const bodyFont = 'Arial';

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, font: bodyFont, size: 22, ...(opts.run || {}) })],
  });
}

function pRuns(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: runs.map(r => new TextRun({ font: bodyFont, size: 22, ...r })),
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, font: bodyFont, size: 36, bold: true })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text, font: bodyFont, size: 28, bold: true })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: bodyFont, size: 24, bold: true })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: bodyFont, size: 22 })],
  });
}

function bulletRuns(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80 },
    children: runs.map(r => new TextRun({ font: bodyFont, size: 22, ...r })),
  });
}

function code(text) {
  // Represent multi-line code as a shaded paragraph block (one paragraph per line).
  const lines = text.split('\n');
  return lines.map((ln, i) => new Paragraph({
    spacing: { after: i === lines.length - 1 ? 160 : 0 },
    shading: { type: ShadingType.CLEAR, fill: 'F4F4F4' },
    children: [new TextRun({ text: ln || ' ', font: 'Consolas', size: 18 })],
  }));
}

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: 'D5E8F0' },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: bodyFont, size: 22 })] })],
  });
}
function bodyCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: bodyFont, size: 22 })] })],
  });
}

function simpleTable(headers, rows, columnWidths) {
  const total = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => headerCell(h, columnWidths[i])),
      }),
      ...rows.map(r => new TableRow({
        children: r.map((c, i) => bodyCell(c, columnWidths[i])),
      })),
    ],
  });
}

// ---------- content ----------
const today = '2026-04-20';

const children = [];

// Title block
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 120 },
  children: [new TextRun({ text: 'QC Rack System — Session Audit', font: bodyFont, size: 48, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: 'Shags VST · QC Harness Work Unit', font: bodyFont, size: 24, color: '555555' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 360 },
  children: [new TextRun({ text: `Date: ${today}`, font: bodyFont, size: 22, italics: true, color: '555555' })],
}));

// Executive summary
children.push(h1('1. Executive Summary'));
children.push(p(
  'This document audits the QC rack (Quality Control harness) work completed in the current session. ' +
  'The session advanced three parallel work units: (a) completion of a T3 capability-gated rule-body ' +
  'batch in the analyzer, (b) delivery of Knowledge Phase A — the invisible plumbing that attaches a ' +
  'deterministic knowledgeId and knowledgeSource to every finding — and (c) start of Lofi Loofy plugin ' +
  'onboarding, including a dry-run Node preview harness and the F1 Dream-mix dual-writer fix.'
));
children.push(p(
  'Nothing in this session changes end-user UI. Phase A shipped dark; the Ear Lesson render path ' +
  'remains gated behind ENABLE_EAR_LESSONS=false until Phase B dogfoods against the ManChild hot path. ' +
  'The Lofi Loofy F1 fix is localized to the engine and is behavior-preserving at mix centre.'
));

// Scope
children.push(h2('1.1 Scope of this audit'));
children.push(bullet('T3 rule body completion (fft_frame_phase) and Knowledge Phase A plumbing inside src/qc-harness/'));
children.push(bullet('New knowledge sub-module: knowledgeLoader, ruleKnowledgeMap, capabilityToFamily, earLessonsFlag'));
children.push(bullet('Lofi Loofy onboarding: capabilities/paramSchema preview script, F1 (DreamTarget mix dual-write) engine fix'));
children.push(bullet('Cross-cutting: ship-blocker and backlog ledgers remain source of truth; this doc does not replace them'));

// Tier architecture
children.push(h1('2. Tier Architecture (T1–T7)'));
children.push(p(
  'The QC preset sweep is tiered to separate ship-blocker checks from capability- and time-gated checks. ' +
  'Tier selection flows from the engine\'s declared capabilities and paramSchema; the harness never hard-codes ' +
  'per-plugin presets.'
));
children.push(simpleTable(
  ['Tier', 'Role', 'Gate', 'Ship impact'],
  [
    ['T1', 'Core invariants — bypass, DC, denormal, louder-than-input', 'Always runs', 'Hard ship-blocker — any FAIL blocks publish'],
    ['T2', 'Bench sanity — stereo hygiene, pathological inputs, preset round-trip', 'Always runs', 'Blocker for the affected plugin family'],
    ['T3', 'Capability-gated measurement (FFT, LPC, WDF, pitch, sidechain, bands, TP)', 'capabilities[flag] === true', 'Blocker when capability is declared'],
    ['T4', 'Long-running / drift / series identity captures', 'includeLong === true', 'Warn-tier; escalates on repeat'],
    ['T5–T7', 'Reserved — UX/regression, golden-file, cross-plugin topology', 'Future', 'Not yet wired'],
  ],
  [700, 3500, 2500, 2660],
));
children.push(p(''));
children.push(h3('Probe-presence pattern'));
children.push(p(
  'T3 rules are activated by filtering ctx.qcSnaps by ruleId and bailing if the filtered set is empty. ' +
  'This replaces direct capability-vocabulary gating, which drifts as new flags appear.'
));
children.push(h3('Three-tier threshold pattern'));
children.push(p(
  'Every analyzer rule returns one of: non-finite → FAIL, specific failure window → FAIL, middle range → WARN, ' +
  'clean → INFO. This keeps downstream UX uniform across rule families.'
));

// T3 completion
children.push(h1('3. T3 Rule Body Completion'));
children.push(h2('3.1 fft_frame_phase (T3.8)'));
children.push(p(
  'Replaced the fft_frame_phase stub in src/qc-harness/qcAnalyzer.js with a probe-presence body that reads ' +
  'per-frame SNR snapshots, derives FAIL/WARN/INFO against the three-tier envelope, and emits a normalized ' +
  'finding with knowledgeId attached downstream by the Phase A enrichment loop.'
));
children.push(h2('3.2 Status of the broader T3 batch'));
children.push(simpleTable(
  ['Rule', 'Status', 'Notes'],
  [
    ['fft_frame_phase', 'Landed this session', 'Three-tier; uses fftFrameSnrDb'],
    ['lpc_stability', 'Pending', 'Uses lpcPeakGrowthDb; awaiting probe coverage'],
    ['wdf_convergence', 'Pending', 'Uses wdfPeakDb'],
    ['pitch_idle', 'Pending', 'Uses pitchIdleHz'],
    ['band_reconstruction', 'Pending', 'Multiband sum vs. input null'],
    ['sidechain_regime', 'Blocked', 'Requires 2-input runtime adapter + plugin scInput contract; no plugin exposes scInput yet'],
    ['os_boundary', 'Pending', 'Oversampling boundary artifacts'],
    ['series_identity (capture)', 'Pending', 'T4 long capture body'],
    ['long_session_drift', 'Pending', 'T4'],
  ],
  [2600, 1800, 4960],
));

// Knowledge Phase A
children.push(h1('4. Knowledge Phase A — Invisible Plumbing'));
children.push(p(
  'Phase A attaches a deterministic knowledgeId and knowledgeSource to every finding, unconditionally. ' +
  'Phase B (future) will render Ear Lessons beside the active finding when ENABLE_EAR_LESSONS flips on. ' +
  'Phase C (future) will add the searchable drawer. The feature flag only gates rendering; attachment is ' +
  'always on so the 50+ plugin sweep does not need a second pass once Phase B ships.'
));

children.push(h2('4.1 New files'));
children.push(simpleTable(
  ['Path', 'Role'],
  [
    ['src/qc-harness/knowledge/knowledgeLoader.js', 'O(1) card lookup, families-covered set, safe-card enforcement (must_fix → canKeepIntentional=false)'],
    ['src/qc-harness/knowledge/ruleKnowledgeMap.js', '35 ruleId → knowledgeId mappings; diagnostic rules → null'],
    ['src/qc-harness/knowledge/capabilityToFamily.js', 'Capability flag → pluginFamily[] bridge (drawer filtering only)'],
    ['src/qc-harness/knowledge/earLessonsFlag.js', 'ENABLE_EAR_LESSONS feature flag (default off)'],
  ],
  [4760, 4600],
));

children.push(h2('4.2 Resolution order for finding.knowledgeId'));
children.push(bullet('userFix override — any explicit knowledgeId attached by a rule body wins (knowledgeSource = "override")'));
children.push(bullet('RULE_META default — RULE_KNOWLEDGE_MAP lookup by rule id (knowledgeSource = "rule")'));
children.push(bullet('Fallback — no mapping; knowledgeId = null, knowledgeSource = "fallback"'));

children.push(h2('4.3 Enrichment loop (qcAnalyzer.js)'));
children.push(...code(
`for (const f of findings) {
  if (typeof f.knowledgeId === 'string' && f.knowledgeId) {
    if (!f.knowledgeSource) f.knowledgeSource = 'override';
    continue;
  }
  const ruleDefault = getDefaultKnowledgeIdForRule(f.rule);
  if (ruleDefault) {
    f.knowledgeId = ruleDefault;
    f.knowledgeSource = 'rule';
  } else {
    f.knowledgeId = null;
    f.knowledgeSource = 'fallback';
  }
}`
));

children.push(h2('4.4 Strict scope rules'));
children.push(bulletRuns([
  { text: 'Active Ear Lesson: ', bold: true }, { text: 'exact knowledgeId lookup only — never fuzzy/capability-based.' },
]));
children.push(bulletRuns([
  { text: 'Related cards / drawer: ', bold: true }, { text: 'capabilityToFamily + measurement tags, never for active lesson.' },
]));
children.push(bulletRuns([
  { text: 'Phase A never renders. ', bold: true }, { text: 'ENABLE_EAR_LESSONS is read only by render paths; never by the attachment loop.' },
]));

// Lofi Loofy
children.push(h1('5. Lofi Loofy Onboarding'));
children.push(h2('5.1 Dry-run preview harness'));
children.push(p(
  'scripts/qc-preview-lofiloofy.mjs extracts capabilities and paramSchema from ' +
  'lofiLoofyEngine.v1.js via a balanced-brace parser, then imports qcPresets.js via a base64 data: URL ' +
  'to sidestep the project lacking "type":"module" in package.json. It lists the presets the browser ' +
  'sweep will emit, by tier and rule, without constructing an AudioContext.'
));
children.push(h3('Preset counts (includeLong = false)'));
children.push(simpleTable(
  ['Tier', 'Count'],
  [['T1', '5'], ['T2', '11'], ['T3', '1'], ['T4', '5']],
  [2000, 7360],
));

children.push(h2('5.2 F1 — DreamTarget mix dual-write fix'));
children.push(p(
  'Pre-fix, the Dream modulator\'s case "mix" wrote directly to dryGain / wetGain — the same gain nodes the ' +
  'user\'s Mix knob owns. That is a DEV_RULES B4 violation (one writer per gain node). The engine\'s own ' +
  'comment at line 836–838 specified the prescribed fix: add a dedicated series mixMod gain node and write ' +
  'that instead.'
));
children.push(h3('Changes'));
children.push(bullet('Added dryMixMod / wetMixMod gain nodes (unity at rest); added both to channel-config loop'));
children.push(bullet('Rewired dry path: dryCompensate → dryGain → dryMixMod → preOut'));
children.push(bullet('Rewired wet path: wetGain → wetMixMod → preOut (summing alongside dry)'));
children.push(bullet('Replaced Dream case "mix" with equal-power swing writing dryMixMod / wetMixMod only'));

children.push(h3('Dream swing (equal-power, ±0.35 breathing around centre)'));
children.push(...code(
`case 'mix': {
  const swing = Math.max(-0.45, Math.min(0.45, m * 0.35));
  const bias  = 0.5 + swing;
  const refD  = Math.cos(0.5 * Math.PI * 0.5); // √2/2
  const dMod  = Math.cos(bias * Math.PI * 0.5) / refD;
  const wMod  = Math.sin(bias * Math.PI * 0.5) / refD;
  dryMixMod.gain.setTargetAtTime(dMod, now, tau);
  wetMixMod.gain.setTargetAtTime(wMod, now, tau);
  break;
}`
));

children.push(h2('5.3 Known issues still open on Lofi Loofy'));
children.push(simpleTable(
  ['ID', 'Severity', 'Description', 'Plan'],
  [
    ['F1', '🔴 FIXED', 'DreamTarget "mix" dual-write (DEV_RULES B4)', 'Landed this session — CONFORMANCE_REPORT §8.2 to update'],
    ['F2', '⚠️  WARN', 'Width=0 is not exact mono (pan-law residual)', 'Tracked; revisit during sweep'],
    ['F3', '⚠️  WARN', 'reverbSend / noiseGain / crackleGain missing from getState', 'Tracked; non-shipping'],
    ['B1', '🔴 BLOCKER', 'External parallel dry/wet mix topology — violates Dry/Wet Mix Rule', 'Requires worklet refactor; scheduled as its own work unit'],
  ],
  [700, 1200, 4000, 3460],
));

// Ship gates
children.push(h1('6. Ship Gates Unchanged'));
children.push(p(
  'This session did not modify the ship-blocker list. T1 zero-FAIL, Dry/Wet Mix Rule, bypass contract, ' +
  'DC rejection under FB, feedback-runaway guard, and denormal tail remain the hard gates before marketplace ' +
  'publish. Conditional gates (per reverb / multiband / stereo / sidechain / latency class) likewise unchanged.'
));
children.push(p(
  'Lofi Loofy cannot ship until Blocker #1 (external dry/wet topology) is resolved. The F1 fix does not ' +
  'advance that gate; it removes a separate B4 violation that would have produced a WARN in the sweep.'
));

// Backlog delta
children.push(h1('7. Backlog Delta'));
children.push(simpleTable(
  ['Item', 'Before session', 'After session'],
  [
    ['fft_frame_phase rule body', 'Stub', 'Landed'],
    ['Knowledge Phase A plumbing', 'Not started', 'Landed (dark, flag-gated)'],
    ['Lofi Loofy preview harness', 'Not started', 'Landed (Node CLI)'],
    ['Lofi Loofy F1', 'Open (B4 violation)', 'Fixed — pending commit + report update'],
    ['Lofi Loofy sweep', 'Pending', 'Pending (browser-only)'],
    ['Flap Jack Man / Panther Buss onboarding', 'Pending', 'Pending'],
    ['sidechain_regime T3 body', 'Pending', 'Blocked (runtime adapter + scInput contract)'],
    ['Knowledge Phase B (render)', 'Not started', 'Ready — gated on flag'],
  ],
  [3500, 2930, 2930],
));

// Follow-ups
children.push(h1('8. Immediate Follow-ups'));
children.push(bullet('Syntax-check modified src/lofiLoofy/lofiLoofyEngine.js and commit F1 fix'));
children.push(bullet('Update src/lofiLoofy/CONFORMANCE_REPORT.md §8.2 — move F1 from open-deviation to fixed with commit ref'));
children.push(bullet('Confirm with user: pivot to Flap Jack Man or Panther Buss onboarding rather than tackling Lofi Loofy Blocker #1 worklet refactor in the same work unit'));
children.push(bullet('Once a plugin with clean dry/wet topology is sweeping green: dogfood Knowledge Phase B by flipping ENABLE_EAR_LESSONS against the ManChild hot path'));

// Appendix
children.push(h1('Appendix A — Files touched / created this session'));
children.push(simpleTable(
  ['Path', 'Change'],
  [
    ['src/qc-harness/qcAnalyzer.js', 'fft_frame_phase rule body + Phase A enrichment loop + import'],
    ['src/qc-harness/knowledge/knowledgeLoader.js', 'NEW — O(1) card lookup'],
    ['src/qc-harness/knowledge/ruleKnowledgeMap.js', 'NEW — 35 ruleId mappings'],
    ['src/qc-harness/knowledge/capabilityToFamily.js', 'NEW — capability → family bridge'],
    ['src/qc-harness/knowledge/earLessonsFlag.js', 'NEW — default-off feature flag'],
    ['scripts/qc-preview-lofiloofy.mjs', 'NEW — Node CLI dry-run preset preview'],
    ['src/lofiLoofy/lofiLoofyEngine.js', 'F1 fix — dryMixMod/wetMixMod series gain nodes'],
    ['../Codex_VST_help/Audio React/AudioReactive_Engine_Handoff_v1.md', 'NEW — Codex handoff brief'],
  ],
  [5000, 4360],
));

// ---------- document ----------
const doc = new Document({
  creator: 'Claude',
  title: 'QC Rack System — Session Audit',
  styles: {
    default: { document: { run: { font: bodyFont, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: bodyFont },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: bodyFont },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: bodyFont },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'Shags VST · QC Rack Audit', font: bodyFont, size: 18, color: '888888' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', font: bodyFont, size: 18, color: '888888' }),
          new TextRun({ children: [PageNumber.CURRENT], font: bodyFont, size: 18, color: '888888' }),
          new TextRun({ text: ' of ', font: bodyFont, size: 18, color: '888888' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: bodyFont, size: 18, color: '888888' }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, 'QC_Rack_Audit.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
