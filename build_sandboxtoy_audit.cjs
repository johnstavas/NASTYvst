// Sandbox Brick Audit — SandboxToy (brick 7/7)
// Ritual: memory/sandbox_brick_audit_protocol.md
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, LevelFormat, BorderStyle, WidthType, ShadingType, PageBreak,
} = require('docx');

const GOLD = '9E7F3E';
const GREY = 'CCCCCC';
const RED = 'C0392B';
const AMBER = 'C07A1A';
const GREEN = '2E7D32';

const border = { style: BorderStyle.SINGLE, size: 1, color: GREY };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true, size: 32 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true, size: 26 })] });
const P  = (t, opts = {}) => new Paragraph({ children: [new TextRun({ text: t, ...opts })], spacing: { after: 120 } });
const Code = (t) => new Paragraph({ children: [new TextRun({ text: t, font: 'Consolas', size: 18 })], spacing: { after: 80 } });
const Bul = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: t })] });

const cell = (text, opts = {}) => new TableCell({
  borders,
  width: { size: opts.width || 2340, type: WidthType.DXA },
  shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold, color: opts.color || '000000', size: 20 })] })],
});

function verdictTable(rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2600, 1400, 5360],
    rows: [
      new TableRow({ tableHeader: true, children: [
        cell('Reference', { width: 2600, bold: true, fill: GOLD }),
        cell('Verdict', { width: 1400, bold: true, fill: GOLD }),
        cell('Notes', { width: 5360, bold: true, fill: GOLD }),
      ]}),
      ...rows.map(r => new TableRow({ children: [
        cell(r[0], { width: 2600 }),
        cell(r[1], { width: 1400, color: r[1].startsWith('✅') ? GREEN : r[1].startsWith('⚠') ? AMBER : r[1].startsWith('❌') ? RED : '000000', bold: true }),
        cell(r[2], { width: 5360 }),
      ]})),
    ],
  });
}

const doc = new Document({
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '2E2E2E' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: [
      new Paragraph({ children: [new TextRun({ text: 'SANDBOX BRICK AUDIT', bold: true, size: 44, color: GOLD })], alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
      new Paragraph({ children: [new TextRun({ text: 'SandboxToy · brick 7 of 7 · final', size: 22, color: '555555' })], alignment: AlignmentType.CENTER, spacing: { after: 320 } }),

      H1('1 · What it does'),
      P('SandboxToy is the Step-2c reference brick — the first fully sandbox-native plugin, whose entire audio path is compiled from SANDBOX_TOY in mockGraphs.js. No hand-coded DSP. Topology: in → n_gain → n_filter(biquad LP) → n_mix.wet, with a parallel in → n_mix.dry leg. The op registry supplies gain / filter / mix; the compiler wires them to native WebAudio GainNode, BiquadFilterNode, and a mix crossfader.'),
      P('Role in the sandbox-core roadmap: dogfood reference. Undo/redo (50-deep, 250ms debounced), graph.json export/import via clipboard, live-graph store push on every param change, and OpGraphCanvas brick-zoom showing the compiled graph itself as the source of truth. This is where we prove the round-trip: UI state ↔ graph.json ↔ compiled audio ↔ canvas.'),
      P('DSP-wise it is identical to FilterFX; SandboxToy exposes three panel knobs (gainDb / cutoff / mix) while FilterFX locks two and exposes one (TONE). Both demonstrate the panel-mapping-over-ops layering.'),

      H1('2 · Applicable memory files'),
      Bul('sandbox_core_scope.md — SandboxToy is called out by name as Step-2c; the success criterion is graph.json round-trip with T5 conformance.'),
      Bul('ship_blockers.md — mix-rule, bypass contract, denormal-tail gates apply to every brick.'),
      Bul('dry_wet_mix_rule.md — non-negotiable; external dry legs are forbidden.'),
      Bul('dsp_code_canon_filters.md §9 — RBJ Cookbook biquad is the canonical LP source.'),
      Bul('ai_agent_layer_roadmap.md — this brick gates Stage 0.5 dogfood validation.'),
      Bul('authoring_runtime_precedent.md — graph.json = IR; SandboxToy is the first JSON-authored plugin and the template for the IR round-trip promise.'),

      H1('3 · Per-reference compliance'),
      verdictTable([
        ['Canon:filters §9 (RBJ biquad)', '✅ PASS', 'Native BiquadFilterNode = vendor RBJ LP. Canonical source, no authoring required.'],
        ['Canon:utilities §1 (Watte DENORM)', 'N/A', 'No author-side recursive state — browser nodes are vendor-hardened.'],
        ['Mix rule (in-worklet, same-sample)', '❌ FAIL', 'Graph routes `in → n_mix.dry` as external wire. Mix op is a crossfade across dry+wet nodes with divergent group delay (biquad group delay in wet leg only). Class-identical to FilterFX / LofiLight / EchoformLite. Retires when master-worklet codegen lands.'],
        ['Bypass contract', '❌ FAIL', 'setBypass only ramps bypassPath.gain to 1 — it never mutes the wet (compiled) chain. ON state = dry + wet summed, not dry-only. Source comment admits the gap ("Mute the wet (compiled) sum ... is wrong"). Local BYP button is an explicit no-op; chain-host pill calls this same broken setBypass.'],
        ['FB runaway guard', 'N/A', 'No feedback edges in graph.'],
        ['Denormal tail', '✅ PASS', 'No author-side IIR state. Biquad is vendor-hardened.'],
        ['DC rejection under FB', 'N/A', 'No FB.'],
        ['Graph.json round-trip (Step-2d)', '✅ PASS', 'serializeGraph / deserializeGraph exercised via COPY / PASTE buttons; warnings surfaced via ioMsg; historyRef.suppressNext coordinates with undo stack so pasted state is atomic.'],
        ['Undo/redo', '✅ PASS', '50-deep ring, 250ms debounce, branch-truncates on new edit, suppressNext flag prevents programmatic applies from re-snapshotting.'],
        ['Live-graph store push', '✅ PASS', 'Every gainDb/cutoff/mix change rebuilds the graph object and calls setLiveGraph — brick-zoom view always shows current values.'],
        ['Validator (validateGraphLoud)', '✅ PASS', 'SANDBOX_TOY validates at module load via the mock-graphs bootstrap loop.'],
      ]),

      H1('4 · Ship-gate status'),
      P('Summary: 2 ship blockers. 1 is compiler-level and shared across all mix-op bricks (expected to retire with master-worklet codegen). 1 is brick-local and should be fixed before this becomes a canonical template — it is the reference brick.', { bold: true }),
      new Paragraph({ spacing: { after: 120 } }),

      H2('Ship blockers'),
      verdictTable([
        ['ST-SB-01 · Mix rule', '❌ BLOCK', 'External dry leg from `in → n_mix.dry`. Biquad-only group delay in wet path — small magnitude but strictly non-null at Mix<1. Same class as F-FX-SB-01 / LL-SB-01 / EFL-SB-01. Fix: master-worklet codegen (Stage 3) collapses all three ops into one worklet node with in-worklet mix.'],
        ['ST-SB-02 · Bypass contract', '❌ BLOCK', 'setBypass does not mute the compiled wet chain. Bypass ON sums dry on top of active wet. Fix is local and cheap: insert a wet-mute gain between inst.inputNode and the compiled head, ramp inversely to bypassPath. Must ship before SandboxToy is used as the dogfood reference or T5 null-test baseline.'],
      ]),

      H2('Watches'),
      verdictTable([
        ['ST-W-01 · "Illustrative" local BYP button', '⚠ DEBT', 'The in-panel BYP toggle has an intentionally-empty onClick body — canonical bypass goes through the chain-host pill. Fine as a demo, but with ST-SB-02 unfixed both paths are broken. Either wire it to setBypass or remove it before this brick ships as public template.'],
        ['ST-W-02 · graph.json clipboard IO', '⚠ NOTE', 'COPY uses navigator.clipboard.writeText (requires secure context); PASTE uses window.prompt. Acceptable for sandbox-dogfood; not acceptable for user-facing authoring. File-picker / drag-drop arrive at Stage 3.'],
      ]),

      H1('5 · Canonical-recipe deviations'),
      Bul('None on the DSP side — every op maps to its canonical primitive (gain, RBJ biquad, linear mix).'),
      Bul('The deviation is architectural: external dry wire instead of in-op dry sum. This is a compiler deviation, not a SandboxToy deviation — it is how the current mix op is implemented. Noted under ST-SB-01.'),

      H1('6 · Findings'),
      H2('Ship blockers'),
      Bul('ST-SB-01 — mix rule (shared compiler fix; Stage 3).'),
      Bul('ST-SB-02 — bypass contract (local fix; insert wet-mute gain).'),
      H2('Non-blocking debt'),
      Bul('ST-W-01 — illustrative BYP button is a no-op; either wire or remove.'),
      Bul('ST-W-02 — clipboard-based IO is sandbox-grade, not user-grade.'),
      H2('Architectural wins'),
      Bul('graph.json serialize/deserialize round-trips cleanly with warnings surfaced.'),
      Bul('Undo stack with suppressNext flag is a reusable pattern for every future sandbox brick.'),
      Bul('Brick-zoom canvas pulls from the same live-graph store the audio reads — single source of truth proven.'),
      Bul('validateGraphLoud bootstrap catches schema drift at module load.'),

      H1('7 · Sign-off'),
      new Paragraph({ children: [new TextRun({ text: 'Verdict: RED ', bold: true, color: RED, size: 28 }), new TextRun({ text: '(2 ship blockers)', size: 22, color: '555555' })], spacing: { after: 120 } }),
      P('ST-SB-01 retires on the master-worklet codegen pass (Stage 3) along with FilterFX / LofiLight / EchoformLite. ST-SB-02 is brick-local and cheap — must be fixed before SandboxToy is used as the dogfood reference or T5 null-test target.'),
      P('Per ship_blockers.md waiver policy: Claude does not self-waive. User sign-off required to ship-flag this brick even after ST-SB-02 is patched; ST-SB-01 is unwaivable until the compiler fix lands.'),

      new Paragraph({ children: [new PageBreak()] }),
      H1('Sweep close-out (7/7)'),
      verdictTable([
        ['EchoformLite', '❌ RED', '3 blockers'],
        ['FdnHall', '❌ RED', '1 blocker'],
        ['ToyComp', '⚠ GREEN-WITH-DEBT', '0 blockers'],
        ['LofiLight', '❌ RED', '1 blocker'],
        ['ModDuck', '⚠ GREEN-WITH-DEBT', '0 blockers'],
        ['FilterFX', '❌ RED', '1 blocker'],
        ['SandboxToy', '❌ RED', '2 blockers'],
      ]),
      P('Totals: 5 RED · 2 GREEN-WITH-DEBT · 0 GREEN. 8 ship blockers across 5 bricks.', { bold: true }),
      H2('Pattern summary'),
      Bul('5/5 mix-op bricks violate the mix rule via external dry leg — single compiler-level fix (Stage 3 master-worklet codegen) retires all 5.'),
      Bul('2/2 FB-bearing bricks lack DC trap in the feedback loop — needs a shared dcBlock primitive before FB-ops go canonical.'),
      Bul('2/2 feedforward-only bricks (ToyComp, ModDuck) are clean by construction. These are the safe templates.'),
      Bul('Denormal discipline is consistent wherever author-side IIR state exists (DENORM macro pattern per Canon:utilities §1).'),
      Bul('Architectural win recurring across bricks: delta-from-unity VCA modulation (grLin−1 summed into AudioParam=1).'),
      H2('Backlog routes'),
      Bul('Add all 8 blockers + watches to qc_backlog.md.'),
      Bul('Schedule Stage-3 master-worklet codegen spike — retires 5 blockers in one stroke.'),
      Bul('Schedule dcBlock primitive + retrofit into EchoformLite + FdnHall FB paths.'),
      Bul('Schedule SandboxToy ST-SB-02 fix before dogfood reference is frozen.'),
      Bul('Update ship_blockers.md checklist to include the shared compiler fix as an explicit gate for any mix-op brick.'),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join('C:/Users/HEAT2/Desktop/Shags VST', 'Sandbox_Audits', 'SandboxToy_Audit.docx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
