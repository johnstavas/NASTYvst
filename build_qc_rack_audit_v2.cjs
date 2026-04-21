// Build QC_Rack_Audit.docx — audit of the QC rack system built this session.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageOrientation, PageBreak,
} = require('docx');

const OUT = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx';

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

function H1(t){ return new Paragraph({ heading: HeadingLevel.HEADING_1, children:[new TextRun(t)] }); }
function H2(t){ return new Paragraph({ heading: HeadingLevel.HEADING_2, children:[new TextRun(t)] }); }
function H3(t){ return new Paragraph({ heading: HeadingLevel.HEADING_3, children:[new TextRun(t)] }); }
function P(t, opts={}){ return new Paragraph({ children:[new TextRun({ text:t, ...opts })] }); }
function B(t){ return new Paragraph({ children:[new TextRun({ text:t, bold:true })] }); }
function bullet(t){ return new Paragraph({ numbering:{ reference:'bullets', level:0 }, children:[new TextRun(t)] }); }
function bulletBold(label, rest){ return new Paragraph({ numbering:{ reference:'bullets', level:0 }, children:[
  new TextRun({ text: label, bold: true }), new TextRun({ text: rest })
]}); }
function code(t){ return new Paragraph({ children:[new TextRun({ text:t, font:'Consolas', size:20 })] }); }

function tableRow(cells, isHeader=false){
  return new TableRow({ tableHeader: isHeader, children: cells.map(c => new TableCell({
    borders,
    width: { size: c.w, type: WidthType.DXA },
    shading: isHeader ? { fill: 'D5E8F0', type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: (Array.isArray(c.text) ? c.text : [c.text]).map(t =>
      new Paragraph({ children:[new TextRun({ text: t, bold: isHeader })] }))
  }))});
}

function twoColTable(rows, widths=[3120,6240]){
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r,i)=>tableRow([{w:widths[0],text:r[0]},{w:widths[1],text:r[1]}], i===0))
  });
}
function threeColTable(rows, widths=[2400,2400,4560]){
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r,i)=>tableRow(
      [{w:widths[0],text:r[0]},{w:widths[1],text:r[1]},{w:widths[2],text:r[2]}], i===0))
  });
}

const children = [];

// Title
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children:[new TextRun({ text:'QC Rack — System Audit', bold:true, size:44 })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children:[new TextRun({ text:'Session close-out · 2026-04-20 · build 627263f-dirty', size:22, color:'666666' })]
}));
children.push(P(''));

// Exec summary
children.push(H1('1. Executive summary'));
children.push(P('This document audits the QC rack subsystem built during this session — the in-app pipeline that takes a candidate plugin, sweeps it against the QC analyzer, and lets a human decide whether to ship it.'));
children.push(P('Three things shipped this session:'));
children.push(bulletBold('ManChild engine_v1 approval — ', 'first plugin taken end-to-end through the full QC + approval flow. Six sweeps, final green at 09:55:07Z, approved at 09:55:54Z, build 627263f-dirty.'));
children.push(bulletBold('Approval infrastructure in the drawer — ', 'three-button decision model (RE-RUN / ACKNOWLEDGE / APPROVE) with localStorage persistence, SHA-pinned invalidation, and a blessed markdown artifact per decision.'));
children.push(bulletBold('userFix Layer C — ', 'a knowledge-base of proven fix copy indexed by ruleId + capability match, so plugins inheriting a capability auto-inherit vetted fix language written by a human who shipped it before.'));
children.push(P(''));
children.push(B('Known gap at session end: '));
children.push(P('The userFix "Try this" copy is written as if the reader is an end-user of the plugin ("turn down the output knob"). The actual user is a musician BUILDING a plugin. Turning a knob on the finished plugin does not fix the plugin definition. This gap is unresolved — see §7 Open Questions.'));

// Architecture
children.push(H1('2. Architecture'));
children.push(P('The rack has four layers. Each layer has one job.'));

children.push(threeColTable([
  ['Layer', 'File(s)', 'Job'],
  ['A — Harness', 'src/qc-harness/Analyzer.jsx, qcPresets.js, seriesRender.js',
    'Drive the plugin under test through a preset sweep, capture outputs, produce findings.'],
  ['B — Rules', 'src/qc-harness/qcAnalyzer.js (RULE_META)',
    'Default copy (title/meaning/fix/dev) per rule. Includes legacy bySeverity branches.'],
  ['C — userFix', 'src/qc-harness/userFix/{index.js, overrides.json}',
    'Per-capability / per-plugin copy overrides with provenance. Layered on top of Layer B.'],
  ['D — Decision', 'Analyzer.jsx approval helpers + qc_approvals/*.md artifacts',
    'Approve / Acknowledge / Re-run a sweep. Persist decision + emit markdown receipt.'],
]));
children.push(P(''));

children.push(H2('2.1 Resolution pipeline'));
children.push(P('For any finding rendered in the popup, the final meta is resolved as:'));
children.push(code('default  = RULE_META[ruleId]                         // Layer B'));
children.push(code('bySev    = default.bySeverity?.[severity]            // legacy branch'));
children.push(code('fixes    = overrides.filter(o => matches(o, ctx))    // Layer C'));
children.push(code('merged   = default < bySev < ...fixes (by specificity)'));
children.push(P('Specificity scoring in Layer C: plugin+variant +10, variant +5, capability +2 each, severity +2. Ties broken by array order (later wins).'));

// Approval flow
children.push(H1('3. Approval flow'));
children.push(H2('3.1 Two-tier model'));
children.push(threeColTable([
  ['Tier', 'Surface', 'What it records'],
  ['Per-sweep', 'Drawer buttons (APPROVE / ACKNOWLEDGE / RE-RUN)',
    'One decision tied to one captured snapshot. Keyed productId:variantId:sha in localStorage.'],
  ['Product-level', 'Top-bar wizard (FORK → PARITY → AUDIO → APPROVE)',
    'Promotes the plugin status (e.g. engine_v1 → approved_engine_v1). Separate from drawer.'],
]));
children.push(P(''));

children.push(H2('3.2 Three-button decision model'));
children.push(threeColTable([
  ['Button', 'Gate', 'Outcome'],
  ['APPROVE', 'Verdict must be green (no FAIL/WARN findings)',
    'Writes approval to localStorage, emits qc_approvals/<timestamp>_<variant>.md.'],
  ['ACKNOWLEDGE', 'Reason required (≥5 chars)',
    'Ships with findings. Reason is baked into the markdown receipt — no silent bypass.'],
  ['RE-RUN', 'Always available',
    'Invalidates any live approval for the current snapshot and kicks a fresh sweep. Label reflects invalidation when a decision is live.'],
]));
children.push(P(''));
children.push(P('Why no plain "Ignore": silent dismissal destroys the trust signal. ACKNOWLEDGE with a typed reason preserves the audit trail — a reviewer can always see why a WARN shipped.'));

children.push(H2('3.3 Invalidation'));
children.push(bullet('Approvals are keyed on the captured snapshot SHA. Any code change that re-renders the rack invalidates the stored decision.'));
children.push(bullet('RE-RUN explicitly calls clearApproval(productId, variantId) at start — stale approvals never carry across sweeps.'));
children.push(bullet('The verdict banner carries a DecisionChip showing the current decision state so a user can never ship a previously-approved plugin whose code has drifted.'));

// Layer C
children.push(H1('4. Layer C — userFix knowledge base'));
children.push(H2('4.1 Match grammar'));
children.push(P('Every override declares a match block. Fields:'));
children.push(twoColTable([
  ['Field', 'Accepts'],
  ['severity', "'fail' | 'warn' | 'info' | '*'"],
  ['capabilities', '{ key: literal | ">=N" | "<=N" | ">N" | "<N" | "eq:X" | true | false }'],
  ['productId', 'exact product id | "*"  (prefer capabilities)'],
  ['variantId', 'exact variant id | "*"  (prefer capabilities)'],
]));
children.push(P(''));

children.push(H2('4.2 Provenance'));
children.push(P('Every override carries a provenance block:'));
children.push(code('source:         "<product>·<engineVersion>·<isoTimestamp>"'));
children.push(code('approvedBuild:  "<git-sha>"'));
children.push(code('proven:         true'));
children.push(code('addedAt:        "YYYY-MM-DD"'));
children.push(P('This is what makes third-party copy trustworthy. The popup can surface "this fix was verified against ManChild on 2026-04-20, build 627263f-dirty." Not a stranger\'s opinion — a receipt.'));

children.push(H2('4.3 Seeded overrides'));
children.push(twoColTable([
  ['id', 'Fires when'],
  ['mix_null.info.coloration_bearing', 'capabilities.nonlinearStages ≥ 1 (any plugin with tubes/tape/transformers/saturators)'],
  ['mix_null_series.info.dry_leg_colored', 'capabilities.dryLegHasColoration = true (hardware-faithful emulation with always-on dry-leg color)'],
]));
children.push(P(''));
children.push(P('These two both earned their provenance on ManChild engine_v1. Any future plugin declaring the same capability auto-inherits the vetted "not-a-bug" copy instead of the scary default FAIL text.'));

// ManChild as exemplar
children.push(H1('5. Reference run — ManChild engine_v1'));
children.push(P('ManChild was the first plugin taken all the way through. Sweep progression:'));
children.push(threeColTable([
  ['Time (UTC)', 'Verdict', 'What happened'],
  ['08:36:00', '🔴 FAIL', 'mix_null fired as Problem — before coloration-bearing capability was declared.'],
  ['08:41:xx', '🟡 WARN', 'mix_null_series fired — before dryLegHasColoration was declared.'],
  ['08:46:02', '✅ PASS', 'First green sweep after capability gates landed (demoted to INFO).'],
  ['08:54:57', '✅ PASS', 'Same build — reproducibility confirmed.'],
  ['09:45:32', '✅ PASS', 'Post-GANG / post-BYPASS-relocation UI. No DSP drift.'],
  ['09:55:07', '✅ PASS', 'Final sweep used for approval.'],
]));
children.push(P(''));
children.push(B('Approval artifact:'));
children.push(bullet('File: src/manChild/qc_approvals/2026-04-20T09-55-07_engine_v1.md'));
children.push(bullet('Build SHA: 627263f-dirty'));
children.push(bullet('Decided: 2026-04-20T09:55:54.898Z'));
children.push(bullet('Findings: 0 Problems, 2 Info (both expected carve-outs)'));

// What went right
children.push(H1('6. What worked'));
children.push(bulletBold('Capability-driven demotion. ', 'Instead of suppressing a failing test, the rule engine checks the plugin\'s declared capabilities and re-classifies. mix_null as FAIL on a coloration-bearing plugin becomes INFO — "check skipped, here\'s why." The test didn\'t lie; the context changed.'));
children.push(bulletBold('Copy lives next to proof. ', 'A fix that worked on ManChild gets written once, tagged with provenance, and every capability-match inherits it. The third-party fear ("do I trust help text written by a stranger?") is answered by the receipt.'));
children.push(bulletBold('Acknowledge > Ignore. ', 'Forcing a typed reason on ship-with-findings kept the rack\'s credibility intact. The decision audit trail survives.'));
children.push(bulletBold('RE-RUN invalidates. ', 'A stored approval never silently survives a code change. The SHA pin is cheap and correct.'));

// Open questions
children.push(H1('7. Open questions'));
children.push(H2('7.1 Who is the reader?'));
children.push(P('The "Try this" copy is currently written as if the reader is an end-user of the finished plugin. The real reader is a musician BUILDING a plugin. When a QC finding says "your output is too loud" and the fix says "lower the output knob", the author can lower the knob on the UI — but there is no finishing step that bakes that change back into the plugin definition. The fix has to live upstream in the authoring flow.'));
children.push(P('Resolution blocked on: what does the plugin-builder UI look like? Preset stacking? Module patching? Template choosing? Until that\'s nailed down, fix copy can\'t give a complete instruction.'));

children.push(H2('7.2 Rule copy rewrite'));
children.push(P('13 RULE_META entries in qcAnalyzer.js still carry dev-speak titles/meaning/fix. These need a musician-facing rewrite with the dev block tucked behind a collapsed toggle. Held until §7.1 resolves.'));

children.push(H2('7.3 Capture-layer extensions'));
children.push(P('From the carryover list — Tier-1 captures not yet wired: bypass_exact, impulse_ir, fb_runaway, latency_report, pathological_stereo, denormal_tail, mix_identity. Each one opens a new rule class.'));

children.push(H2('7.4 Tech debt (ManChild engine)'));
children.push(P('Three WARNs are parked for the next engine revision — not ship blockers for engine_v1:'));
children.push(threeColTable([
  ['ID', 'Finding', 'Lines'],
  ['F1', 'currentDrive init 0.35 → 0 so getState().txDrive matches schema default', '1'],
  ['F2', 'setThreshold*/setDc*/setVar* use .value = — switch to setTargetAtTime', '~8'],
  ['F3', 'applyBulk silently ignores unknown fields — add dev-mode console.warn', '~5'],
]));

// Next steps
children.push(H1('8. Recommended next steps'));
children.push(new Paragraph({ numbering:{ reference:'numbers', level:0 }, children:[
  new TextRun('Resolve §7.1 — define the plugin-builder UI surface. Only once the author flow has a "finishing step" can fix copy close the loop.')
]}));
children.push(new Paragraph({ numbering:{ reference:'numbers', level:0 }, children:[
  new TextRun('Sweep Lofi Loofy through the same flow. Harvest any new capability gates + provenance.')
]}));
children.push(new Paragraph({ numbering:{ reference:'numbers', level:0 }, children:[
  new TextRun('Wire resolveUserFix() into qcAnalyzer.renderCard and Analyzer.jsx popup — replace the inline bySeverity merge.')
]}));
children.push(new Paragraph({ numbering:{ reference:'numbers', level:0 }, children:[
  new TextRun('Rewrite the 13 RULE_META entries once §7.1 is unblocked.')
]}));
children.push(new Paragraph({ numbering:{ reference:'numbers', level:0 }, children:[
  new TextRun('Park F1/F2/F3 for the next ManChild engine revision.')
]}));

// Doc
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id:'Heading1', name:'Heading 1', basedOn:'Normal', next:'Normal', quickFormat:true,
        run:{ size:32, bold:true, font:'Arial' },
        paragraph:{ spacing:{ before:280, after:160 }, outlineLevel:0 } },
      { id:'Heading2', name:'Heading 2', basedOn:'Normal', next:'Normal', quickFormat:true,
        run:{ size:26, bold:true, font:'Arial' },
        paragraph:{ spacing:{ before:200, after:120 }, outlineLevel:1 } },
      { id:'Heading3', name:'Heading 3', basedOn:'Normal', next:'Normal', quickFormat:true,
        run:{ size:24, bold:true, font:'Arial', color:'444444' },
        paragraph:{ spacing:{ before:160, after:80 }, outlineLevel:2 } },
    ],
  },
  numbering: {
    config: [
      { reference:'bullets', levels:[{ level:0, format:LevelFormat.BULLET, text:'•',
        alignment:AlignmentType.LEFT, style:{ paragraph:{ indent:{ left:720, hanging:360 } } } }] },
      { reference:'numbers', levels:[{ level:0, format:LevelFormat.DECIMAL, text:'%1.',
        alignment:AlignmentType.LEFT, style:{ paragraph:{ indent:{ left:720, hanging:360 } } } }] },
    ],
  },
  sections: [{
    properties: { page: {
      size: { width:12240, height:15840 },
      margin: { top:1440, right:1440, bottom:1440, left:1440 },
    }},
    children,
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync(OUT, buf); console.log('Wrote', OUT, buf.length, 'bytes'); });
