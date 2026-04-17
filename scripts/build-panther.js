#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'public', 'panther.svg');
const DEST = path.join(__dirname, '..', 'public', 'panther-v2.svg');

const raw = fs.readFileSync(SRC, 'utf8');

// ── helpers ──────────────────────────────────────────────────────────────────

function attr(tag, name) {
  const re = new RegExp(`\\b${name}="([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? m[1] : '';
}
function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s*\\b${name}="[^"]*"`, 'gi'), '');
}
function setAttr(tag, name, value) {
  if (new RegExp(`\\b${name}="`).test(tag)) {
    return tag.replace(new RegExp(`\\b${name}="[^"]*"`, 'i'), `${name}="${value}"`);
  }
  return tag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`);
}
function cleanTag(tag) {
  tag = removeAttr(tag, 'vector-effect');
  return tag;
}

/** Get the first absolute M coordinate from a path d attribute. */
function firstPoint(d) {
  const m = d.match(/M\s*([\-\d.]+)\s+([\-\d.]+)/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

/** Count M commands (subpaths) in a path d attribute. */
function countM(d) {
  return (d.match(/M/gi) || []).length;
}

// ── extract every shape element ───────────────────────────────────────────────
const elementRe = /<(path|circle|line|ellipse)\b[^>]*(?:\/>|>)/gs;
const rawElements = [];
let m;
while ((m = elementRe.exec(raw)) !== null) {
  rawElements.push(m[0].replace(/\s+/g, ' ').trim());
}
console.log(`Total elements found: ${rawElements.length}`);

// ── categorise ────────────────────────────────────────────────────────────────
const groups = {
  base_black:   [],
  ear_inner:    [],
  ivory_shapes: [],
  mouth_red:    [],
  teeth:        [],
  eyes:         [],
  linework:     [],
  whiskers:     [],
  unmatched:    [],
};

for (let tag of rawElements) {
  const fill   = attr(tag, 'fill');
  const stroke = attr(tag, 'stroke');
  const d      = attr(tag, 'd');

  tag = cleanTag(tag);

  const fp   = firstPoint(d);
  const subs = countM(d);

  // ── ARTBOARD BACKGROUND — skip entirely ──────────────────────────────────
  if (fill === '#f2e7d1' && /1773\.00\s+0\.00/.test(d)) continue;

  // ── IVORY: separate teeth vs face fills ──────────────────────────────────
  if (fill === '#f2e7d1') {
    tag = setAttr(tag, 'stroke', 'none');
    tag = removeAttr(tag, 'stroke-width');

    // Teeth / fangs: ivory shapes whose first M point is below the nose line (y > 1000)
    // Also catches the two large compound teeth paths (14 subpaths each, firstY ~1030-1059)
    if (fp.y > 1000) {
      groups.teeth.push(tag);
    } else {
      groups.ivory_shapes.push(tag);
    }
    continue;
  }

  // ── BLACK: separate eye cores vs silhouette ───────────────────────────────
  if (fill === '#1a1816') {
    tag = setAttr(tag, 'stroke', 'none');
    tag = removeAttr(tag, 'stroke-width');

    // Eye cores: small black shapes symmetrically placed in the eye band
    // Identified by: firstY between 860–980, firstX between 620–1180, single subpath, d.len < 500
    const isEye =
      fp.y >= 860 && fp.y <= 980 &&
      fp.x >= 620 && fp.x <= 1180 &&
      subs === 1 &&
      d.length < 500;

    if (isEye) {
      // Give eye cores a distinct sentinel fill so JSX can target them independently
      // from base_black — both originate from #1a1816 so we must differentiate here.
      tag = setAttr(tag, 'fill', '#e0f8ff');
      groups.eyes.push(tag);
    } else {
      groups.base_black.push(tag);
    }
    continue;
  }

  // ── EAR INNER ─────────────────────────────────────────────────────────────
  if (fill === '#efc88d') {
    tag = setAttr(tag, 'stroke', 'none');
    tag = removeAttr(tag, 'stroke-width');
    groups.ear_inner.push(tag);
    continue;
  }

  // ── MOUTH RED ─────────────────────────────────────────────────────────────
  if (fill === '#de3c40') {
    tag = setAttr(tag, 'stroke', 'none');
    tag = removeAttr(tag, 'stroke-width');
    groups.mouth_red.push(tag);
    continue;
  }

  // ── WHISKERS — stroke="#f1d8af" ───────────────────────────────────────────
  if (stroke === '#f1d8af') {
    tag = setAttr(tag, 'fill', 'none');
    tag = setAttr(tag, 'stroke-width', '4');
    groups.whiskers.push(tag);
    continue;
  }

  // ── LINEWORK — tattoo stroke colours, no fill ─────────────────────────────
  if (
    (stroke === '#868074' || stroke === '#7c2a2b' || stroke === '#857052' || stroke === '#e89289') &&
    (fill === 'none' || fill === '')
  ) {
    // CRITICAL: explicitly set fill="none" — SVG default fill is black, not none.
    // The original SVG had a root <g fill="none"> wrapper that we stripped.
    tag = setAttr(tag, 'fill', 'none');
    if (!attr(tag, 'stroke-width')) {
      tag = setAttr(tag, 'stroke-width', '3');
    }
    groups.linework.push(tag);
    continue;
  }

  groups.unmatched.push(tag);
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('\nGroup counts:');
for (const [k, v] of Object.entries(groups)) {
  console.log(`  ${k.padEnd(14)} ${v.length}`);
}

// ── build output SVG ──────────────────────────────────────────────────────────
function renderGroup(id, elements, comment = '') {
  const inner = elements.map(e => '    ' + e).join('\n');
  const commentStr = comment ? `\n    <!-- ${comment} -->` : '';
  return `  <g id="${id}">${commentStr}\n${inner}\n  </g>`;
}

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-313 2 2400 1769" width="380" height="280" style="background:transparent;display:block;">`,
  renderGroup('base_black',   groups.base_black),
  renderGroup('ear_inner',    groups.ear_inner),
  renderGroup('ivory_shapes', groups.ivory_shapes),
  renderGroup('mouth_red',    groups.mouth_red),
  renderGroup('teeth',        groups.teeth),
  renderGroup('eyes',         groups.eyes),
  renderGroup('linework',     groups.linework),
  renderGroup('whiskers',     groups.whiskers),
  `</svg>`,
].join('\n');

fs.writeFileSync(DEST, svg, 'utf8');

const sizeKB = (fs.statSync(DEST).size / 1024).toFixed(1);
console.log(`\nWrote ${DEST}`);
console.log(`Output file size: ${sizeKB} KB`);

if (groups.unmatched.length) {
  console.warn(`\nWarning: ${groups.unmatched.length} element(s) did not match any group:`);
  groups.unmatched.forEach(t => console.warn('  ' + t.slice(0, 120)));
}
