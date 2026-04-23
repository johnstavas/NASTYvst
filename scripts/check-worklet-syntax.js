// Parse PROCESSOR_CODE template literal out of the worklet file and feed
// it to new Function() so we get a real V8 syntax check without loading
// the browser runtime.
const fs = require('fs');
const src = fs.readFileSync('src/nastybeast/nastyBeastEngine.worklet.js', 'utf8');
// Find `const PROCESSOR_CODE = \`...\`;` — template literal, possibly multi-line.
const m = src.match(/const\s+PROCESSOR_CODE\s*=\s*`([\s\S]*?)`;\s*\n\n\/\/\s+[─]+/);
if (!m) {
  console.error('Could not locate PROCESSOR_CODE template literal boundary.');
  process.exit(2);
}
// Replace ${...} placeholders with 'X' so we get valid JS for syntax check.
const clean = m[1].replace(/\$\{[^}]+\}/g, 'X');
try {
  new Function('sampleRate', 'registerProcessor', 'AudioWorkletProcessor', clean);
  console.log('PROCESSOR_CODE syntax OK (' + clean.length + ' chars)');
} catch (e) {
  console.error('SYNTAX ERROR in PROCESSOR_CODE:');
  console.error(' ', e.message);
  // Locate line by splitting on newlines and showing the line the error
  // message points to, if any. V8 includes "anonymous>:LINE" in stacks.
  const line = (e.stack || '').match(/anonymous>:(\d+)/);
  if (line) {
    const n = +line[1];
    const lines = clean.split('\n');
    const from = Math.max(0, n - 3);
    const to   = Math.min(lines.length, n + 2);
    for (let i = from; i < to; i++) {
      const mark = (i + 1 === n) ? ' >> ' : '    ';
      console.error(mark + (i + 1) + ': ' + lines[i]);
    }
  }
  process.exit(1);
}
