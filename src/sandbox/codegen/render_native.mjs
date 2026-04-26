// render_native.mjs — minimal Jinja2-subset template engine.
//
// Supports just what Phase 1 templates need:
//   {{ expr }}                 — substitution; expr is a dotted path with
//                                optional `|length` filter.
//   {% for x in expr %} ... {% endfor %}
//   {% if expr %} ... {% else %} ... {% endif %}
//
// Whitespace control: a leading `-` after `{%` strips preceding whitespace
// up to (and including) the previous newline; a trailing `-` before `%}`
// strips following whitespace up to (and including) the next newline.
// Same for `{{- ... -}}`.
//
// Truthiness: JS truthiness; arrays evaluate truthy iff non-empty.
// Filter: only `|length`.
//
// Use: import { renderTemplate } from './render_native.mjs';
//      const out = renderTemplate(srcString, ctx);
//
// The engine is intentionally tiny — strict on syntax, no inheritance,
// no macros, no auto-escape. All template inputs come from build_native.mjs
// which controls the data shape; no untrusted strings flow in.

export function renderTemplate(src, ctx) {
  const ast = parse(src);
  return render(ast, ctx);
}

// ── tokenize ───────────────────────────────────────────────────────────────
const TAG_RE = /\{%-?\s*([\s\S]*?)\s*-?%\}|\{\{-?\s*([\s\S]*?)\s*-?\}\}/g;

function tokenize(src) {
  const tokens = [];
  let i = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src))) {
    const start = m.index;
    const end   = TAG_RE.lastIndex;
    if (start > i) tokens.push({ type: 'text', value: src.slice(i, start) });
    const full   = m[0];
    const isStmt = full.startsWith('{%');
    const stripL = full.startsWith('{%-') || full.startsWith('{{-');
    const stripR = full.endsWith('-%}') || full.endsWith('-}}');
    const inner  = (isStmt ? m[1] : m[2]).trim();
    tokens.push({ type: isStmt ? 'stmt' : 'expr', inner, stripL, stripR });
    i = end;
  }
  if (i < src.length) tokens.push({ type: 'text', value: src.slice(i) });

  // Apply whitespace stripping. A stmt/expr with stripL trims trailing
  // whitespace+newline of the previous text token; with stripR trims
  // leading whitespace+newline of the next text token.
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'text') continue;
    if (t.stripL && k > 0 && tokens[k - 1].type === 'text') {
      tokens[k - 1].value = tokens[k - 1].value.replace(/[ \t]*\n?$/, '');
    }
    if (t.stripR && k + 1 < tokens.length && tokens[k + 1].type === 'text') {
      tokens[k + 1].value = tokens[k + 1].value.replace(/^\n?[ \t]*/, '');
    }
  }
  return tokens;
}

// ── parse ──────────────────────────────────────────────────────────────────
function parse(src) {
  const toks = tokenize(src);
  let pos = 0;

  function parseBlock(stopAt = []) {
    const out = [];
    while (pos < toks.length) {
      const t = toks[pos];
      if (t.type === 'stmt') {
        const head = t.inner.split(/\s+/)[0];
        if (stopAt.includes(head)) return out;
        if (head === 'for') {
          pos++;
          const m = /^for\s+(\w+)\s+in\s+(.+)$/.exec(t.inner);
          if (!m) throw new Error(`bad for: ${t.inner}`);
          const body = parseBlock(['endfor']);
          if (pos >= toks.length || toks[pos].inner !== 'endfor')
            throw new Error('unterminated for');
          pos++;
          out.push({ type: 'for', loopVar: m[1], expr: m[2], body });
          continue;
        }
        if (head === 'if') {
          pos++;
          const m = /^if\s+(.+)$/.exec(t.inner);
          if (!m) throw new Error(`bad if: ${t.inner}`);
          const thenBody = parseBlock(['else', 'endif']);
          let elseBody = [];
          if (toks[pos]?.inner === 'else') {
            pos++;
            elseBody = parseBlock(['endif']);
          }
          if (toks[pos]?.inner !== 'endif')
            throw new Error('unterminated if');
          pos++;
          out.push({ type: 'if', cond: m[1], thenBody, elseBody });
          continue;
        }
        throw new Error(`unknown stmt: ${t.inner}`);
      } else if (t.type === 'expr') {
        out.push({ type: 'expr', inner: t.inner });
        pos++;
      } else {
        out.push({ type: 'text', value: t.value });
        pos++;
      }
    }
    return out;
  }

  return parseBlock();
}

// ── render ─────────────────────────────────────────────────────────────────
function lookup(expr, ctx) {
  // Support `name`, `name.field`, `name|length`
  let filter = null;
  let path   = expr;
  const pipe = expr.indexOf('|');
  if (pipe >= 0) {
    path   = expr.slice(0, pipe).trim();
    filter = expr.slice(pipe + 1).trim();
  }
  const parts = path.split('.');
  let v = ctx;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  if (filter === 'length') {
    if (v == null) return 0;
    if (Array.isArray(v) || typeof v === 'string') return v.length;
    if (typeof v === 'object') return Object.keys(v).length;
    return 0;
  }
  return v;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function render(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'expr') {
      const v = lookup(n.inner, ctx);
      out += v == null ? '' : String(v);
    } else if (n.type === 'for') {
      const arr = lookup(n.expr, ctx);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const childCtx = Object.assign(Object.create(ctx), { [n.loopVar]: item });
        out += render(n.body, childCtx);
      }
    } else if (n.type === 'if') {
      const v = lookup(n.cond, ctx);
      out += render(truthy(v) ? n.thenBody : n.elseBody, ctx);
    }
  }
  return out;
}
