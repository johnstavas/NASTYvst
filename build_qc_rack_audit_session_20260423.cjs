// QC Rack Audit — session of 2026-04-23
// Output: C:\Users\HEAT2\Desktop\Shags VST\QC_Rack_Audit.docx

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation, PageBreak,
} = require('docx');

const OUT = path.join('C:', 'Users', 'HEAT2', 'Desktop', 'Shags VST', 'QC_Rack_Audit.docx');

// ---------- helpers ----------
const FONT = 'Arial';
const run = (text, opts = {}) => new TextRun({ text, font: FONT, ...opts });
const P = (text, opts = {}) => new Paragraph({ children: [run(text, opts.run || {})], ...opts });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(t, { bold: true, size: 32 })], spacing: { before: 240, after: 120 } });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(t, { bold: true, size: 28 })], spacing: { before: 200, after: 100 } });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(t, { bold: true, size: 24 })], spacing: { before: 160, after: 80 } });
const body = (t) => new Paragraph({ children: [run(t)], spacing: { after: 80 } });
const bullet = (t, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  children: Array.isArray(t) ? t : [run(t)],
  spacing: { after: 40 },
});
const code = (t) => new Paragraph({
  children: [new TextRun({ text: t, font: 'Consolas', size: 18 })],
  shading: { fill: 'F2F2F2', type: ShadingType.CLEAR },
  spacing: { after: 60 },
});

const border = { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function tableCell(text, { bold = false, shade = null, width = 2000 } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: [run(String(text), { bold })] })],
  });
}

function table(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    borders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => tableCell(h, { bold: true, shade: 'D5E8F0', width: colWidths[i] })),
      }),
      ...rows.map(r => new TableRow({
        children: r.map((c, i) => tableCell(c, { width: colWidths[i] })),
      })),
    ],
  });
}

// ---------- content ----------
const children = [];

// Title
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [run('QC Rack Audit', { bold: true, size: 48 })],
  spacing: { after: 120 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [run('Sandbox Brick Sweep + Session Fixes — 2026-04-23', { size: 24, color: '555555' })],
  spacing: { after: 320 },
}));

// Exec summary
children.push(H1('Executive summary'));
children.push(body(
  'This audit documents the 7-brick sandbox audit sweep completed 2026-04-23 ' +
  'and the two ship-blocker fixes landed in the same session. The rack currently ' +
  'ships seven sandbox bricks. Each was run through the full ritual protocol ' +
  '(sandbox_brick_audit_protocol.md). Findings were consolidated into a fix matrix ' +
  'grouped by the minimum number of PRs required to retire them.'
));
children.push(body('Headline numbers:'));
children.push(bullet('7 of 7 sandbox bricks audited end-to-end.'));
children.push(bullet('Verdict tally: 5 RED, 2 GREEN-WITH-DEBT, 0 GREEN.'));
children.push(bullet('8 ship blockers identified. 2 landed this session.'));
children.push(bullet('3 PRs retire all 8 blockers. Two are a single-fix-kills-many shape.'));

// Verdict table
children.push(H2('Per-brick verdicts'));
children.push(table(
  ['Brick', 'Verdict', 'Blockers', 'Audit doc'],
  [
    ['EchoformLite', 'RED', '3', 'Sandbox_Audits/EchoformLite_Audit.docx'],
    ['FdnHall',      'RED', '1', 'Sandbox_Audits/FdnHall_Audit.docx'],
    ['ToyComp',      'GREEN-WITH-DEBT', '0', 'Sandbox_Audits/ToyComp_Audit.docx'],
    ['LofiLight',    'RED', '1', 'Sandbox_Audits/LofiLight_Audit.docx'],
    ['ModDuck',      'GREEN-WITH-DEBT', '0', 'Sandbox_Audits/ModDuck_Audit.docx'],
    ['FilterFX',     'RED', '1', 'Sandbox_Audits/FilterFX_Audit.docx'],
    ['SandboxToy',   'RED -> GREEN-WITH-DEBT', '2 -> 0', 'Sandbox_Audits/SandboxToy_Audit.docx'],
  ],
  [2200, 2200, 1200, 3760],
));

// Patterns
children.push(H1('Cross-brick patterns'));

children.push(H2('Pattern 1 — mix rule violation is compiler-level, not brick-level'));
children.push(body(
  'Five of five bricks that use the sandbox `mix` op violate the Dry/Wet Mix Rule. ' +
  'All five route an external dry leg as a graph wire (in -> n_mix.dry) and ' +
  'crossfade two WebAudio nodes that have divergent group delay. ' +
  'No amount of per-brick tuning fixes this — the mix op crossfades across ' +
  'nodes whose latency is implementation-defined.'
));
children.push(body(
  'One fix retires all five blockers: Stage-3 master-worklet codegen that ' +
  'collapses ops into a single AudioWorkletNode with in-worklet mix. ' +
  'Gated on op vocabulary freeze + IR stabilization per sandbox_core_scope.md ' +
  'Step 4 and AI roadmap Stage 1.7.'
));
children.push(body('Affected bricks: EchoformLite, LofiLight, FilterFX, SandboxToy, FdnHall (wet-dry via native mix op).'));

children.push(H2('Pattern 2 — feedback paths lack a DC trap'));
children.push(body(
  'Two of two feedback-bearing bricks ship without a DC trap in the loop. ' +
  'EchoformLite has no HP at all. FdnHall patches the symptom with a hard clip ' +
  'at +/- 1.8, which is a bandage, not a fix; it deviates from the canonical ' +
  'Geraint Luff reference (reverb_engine_architecture.md).'
));
children.push(body(
  'One fix retires both blockers: a shared dcBlock primitive (1-pole HP at ~10 Hz, ' +
  'RBJ canonical per Canon:filters §9) dropped inline on feedback returns. ' +
  'Landed this session — see "Landed this session" below.'
));

children.push(H2('Pattern 3 — feedforward-only bricks are clean by construction'));
children.push(body(
  'ToyComp and ModDuck ship GREEN-WITH-DEBT with zero ship blockers. ' +
  'Both are feedforward; neither uses the mix op; both use the ' +
  'delta-from-unity VCA pattern (grLin - 1 summed into an AudioParam with ' +
  'resting gain 1, giving free linear multiplication). These are the safe ' +
  'templates when cloning a new brick.'
));

children.push(H2('Pattern 4 — denormal discipline is consistent'));
children.push(body(
  'Wherever author-side IIR state exists, the DENORM bias macro pattern ' +
  'per Canon:utilities §1 is applied consistently. No gaps surfaced by the sweep.'
));

children.push(H2('Pattern 5 — delta-from-unity VCA is a winning idiom'));
children.push(body(
  'ToyComp and ModDuck both sum `grLin - 1` into an AudioParam whose resting ' +
  'value is 1. This avoids an explicit multiplier node and lets the compressor/ducker ' +
  'modulate gain with a single AudioParam automation path. Promote to canonical ' +
  'pattern for all future dynamics or ducking bricks.'
));

// Ship blockers
children.push(H1('Ship blockers'));
children.push(body('8 total. Grouped by the PR that retires them.'));

children.push(H2('Group A — retired by Stage-3 master-worklet codegen (5 blockers)'));
children.push(table(
  ['ID', 'Brick', 'Finding'],
  [
    ['EFL-SB-01',   'EchoformLite', 'mix rule via external dry leg'],
    ['LL-SB-01',    'LofiLight',    'mix rule via external dry leg (documented limit)'],
    ['F-FX-SB-01',  'FilterFX',     'mix rule via external dry leg'],
    ['ST-SB-01',    'SandboxToy',   'mix rule via external dry leg'],
    ['FDN-SB-01',   'FdnHall',      'mix rule via external dry leg'],
  ],
  [1800, 2000, 5560],
));

children.push(H2('Group B — retired by dcBlock primitive (2 blockers) — LANDED 2026-04-23'));
children.push(table(
  ['ID', 'Brick', 'Finding'],
  [
    ['EFL-SB-02', 'EchoformLite', 'no DC trap in FB loop'],
    ['FDN-SB-02', 'FdnHall',      'no DC trap in FB loop (hard-clip is a patch, not a fix)'],
  ],
  [1800, 2000, 5560],
));

children.push(H2('Group C — feedback safety (1 blocker, EchoformLite only)'));
children.push(table(
  ['ID', 'Brick', 'Finding'],
  [['EFL-SB-03', 'EchoformLite', 'no feedback runaway guard']],
  [1800, 2000, 5560],
));
children.push(body(
  'Bundle a runaway clamp into the same FB-loop primitive when Group B is being touched: ' +
  'soft-limit or tanh saturation inside the loop, not a post-sum clipper.'
));

children.push(H2('Group D — brick-local fix (1 blocker) — LANDED 2026-04-23'));
children.push(table(
  ['ID', 'Brick', 'Finding'],
  [['ST-SB-02', 'SandboxToy', 'bypass contract broken (dry/wet both audible)']],
  [1800, 2000, 5560],
));

// Landed this session
children.push(H1('Landed this session (2026-04-23)'));

children.push(H2('ST-SB-02 — SandboxToy bypass contract'));
children.push(body('Problem: the old topology ramped only the dry leg up on bypass. The compiled-output wet leg was never muted, so both were audible simultaneously during bypass. BYP = dry_plus_wet, not dry.'));
children.push(body('Fix: new topology sums two ramped mutes.'));
children.push(code(
  'const outSum = ctx.createGain();             // bus, unity\n' +
  'const wetMute = ctx.createGain();            // starts at 1 (wet on)\n' +
  'const bypassPath = ctx.createGain();         // starts at 0 (dry off)\n' +
  'inst.outputNode.connect(wetMute).connect(outSum);\n' +
  'inst.inputNode.connect(bypassPath).connect(outSum);\n' +
  'const setBypass = (on) => {\n' +
  '  const t = ctx.currentTime, tc = 0.005;\n' +
  '  wetMute.gain.setTargetAtTime(on ? 0 : 1, t, tc);\n' +
  '  bypassPath.gain.setTargetAtTime(on ? 1 : 0, t, tc);\n' +
  '};'
));
children.push(body('Also wired the in-panel BYP button through the same closure via setBypassRef — resolves ST-W-01.'));
children.push(body('Ear-test pass: cutoff=200 Hz confirmed the filter in/out swap is clean — no click, no zipper.'));

children.push(H2('EFL-SB-02 + FDN-SB-02 — dcBlock primitive'));
children.push(body('Problem: the FB loops of EchoformLite and FdnHall have no HP; asymmetric saturation can pump DC into the loop and slowly bias the tail.'));
children.push(body('Fix: dcBlock op primitive (1-pole HP ~10 Hz, Q=0.707, BiquadFilterNode highpass for graph-level; per-channel HP state inside the worklet for FDN).'));
children.push(body('Files touched:'));
children.push(bullet('src/sandbox/opRegistry.js — dcBlock op entry.'));
children.push(bullet('src/sandbox/compileGraphToWebAudio.js — dcBlock factory (BiquadFilterNode).'));
children.push(bullet('src/sandbox/mockGraphs.js — ECHOFORM_LITE rewired with n_dcblock in FB path.'));
children.push(bullet('src/sandbox/workletSources.js — SandboxFdnReverb per-channel fdnDcX/fdnDcY state + HP applied before hard-clip with DENORM bias.'));
children.push(body('Worklet HP kernel (per channel, per sample):'));
children.push(code(
  'const y = fb_sig - dcX[c] + dcR * dcY[c] + DENORM;\n' +
  'dcX[c] = fb_sig; dcY[c] = y; fb_sig = y;\n' +
  '// dcR = exp(-2*PI*10/sr) ~= 0.998692 at 48 kHz'
));
children.push(body('Static verification: 11/11 integration checks pass, sandbox worklet syntax check pass (29424 chars).'));

// Watches
children.push(H1('Watches (non-blocking debt)'));
children.push(table(
  ['ID', 'Brick', 'Debt', 'Status'],
  [
    ['ST-W-01', 'SandboxToy', 'local BYP button was intentionally-empty', 'LANDED 2026-04-23'],
    ['ST-W-02', 'SandboxToy', 'graph.json IO via clipboard + window.prompt', 'acceptable for dogfood; file-picker at Stage 3'],
    ['MD-W-01', 'ModDuck',    'stale header comment claims attack/release is not asymmetric', 'update on next touch'],
    ['LL-W-01', 'LofiLight',  'header documents the mix-rule limit', 'delete string when LL-SB-01 is retired'],
  ],
  [1400, 1600, 3800, 2560],
));

// Fix priorities
children.push(H1('Fix priorities (next sprint)'));
children.push(bullet('1. Stage-3 master-worklet codegen spike — highest leverage, retires 5 blockers. Gated on op vocab freeze + IR stabilization.'));
children.push(bullet('2. dcBlock op primitive — LANDED this session (EFL-SB-02, FDN-SB-02 clear).'));
children.push(bullet('3. FB-safety primitive (soft-limit inside the FB loop) — retires EFL-SB-03 and hardens FdnHall by replacing the +/- 1.8 clip. Pair with follow-up dcBlock polish.'));
children.push(bullet('4. SandboxToy ST-SB-02 bypass fix — LANDED this session.'));
children.push(bullet('5. Update ship_blockers.md checklist — add an explicit "mix-op brick requires master-worklet codegen" gate so future bricks inherit the block.'));

// Cross-refs
children.push(H1('Cross-references'));
children.push(bullet('sandbox_brick_audit_protocol.md — the ritual itself.'));
children.push(bullet('sandbox_core_scope.md — Stage-3 codegen is where the shared fix lands; SandboxToy is the T5 baseline (ST-SB-02 must be green first; now is).'));
children.push(bullet('ship_blockers.md — mix rule, bypass contract, DC rejection under FB, FB runaway guard, denormal tail — this sweep touched all five.'));
children.push(bullet('dry_wet_mix_rule.md — the rule all 5 mix-op bricks currently fail.'));
children.push(bullet('reverb_engine_architecture.md — FdnHall\u2019s non-canonical hard-clip FB clamp is a deviation from the Geraint Luff reference; dcBlock + soft-limit primitive is the replacement.'));
children.push(bullet('Canon:filters §9 (RBJ), Canon:utilities §1 (denormal macro), Canon:dynamics §1 (Bram env), Canon:dynamics §4 (beat detector).'));

// Appendix — commits
children.push(H1('Appendix A — commits pushed this session'));
children.push(bullet('a840104 — SandboxToy ST-SB-02 + ST-W-01 fix (bypass topology + in-panel BYP wire-through).'));
children.push(bullet('4019878 — docs: research targets + worklet syntax checker + QC_Rack_Audit refresh.'));
children.push(bullet('4de2246 — LofiLight compiler sanity test + nullTestHarness.js.'));
children.push(bullet('40bf820 — NastyBeast BPM gap+accent detector upgrade + hasBpmDetector flag.'));
children.push(bullet('df3e14a — QC harness: drag-drop, no-preset-lane fallback, bpm rule body.'));
children.push(bullet('48c49e0 — FdnHall brick (first sandbox-native reverb).'));
children.push(bullet('(pending commit) — dcBlock primitive + FDN worklet DC trap (EFL-SB-02, FDN-SB-02 retire).'));

// Done
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: FONT },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
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
  console.log('wrote', OUT, buf.length, 'bytes');
});
