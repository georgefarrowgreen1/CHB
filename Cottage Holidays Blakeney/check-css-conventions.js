#!/usr/bin/env node
// ============================================================
//  check-css-conventions.js — CSS convention RATCHET (dev/CI only).
//
//      node check-css-conventions.js
//      node check-css-conventions.js --update   (re-baseline after a cleanup)
//
//  CLAUDE.md states two CSS rules that had no gate, so both had quietly drifted:
//
//    1. "prefer the four canonical breakpoints (480 / 640 / 900 / 1200) for new
//       media queries; migrate stray one-off widths opportunistically when
//       touched" — a one-off width means a component reflows at a width nothing
//       else does, which is how "fixed on my phone, broken on yours" happens.
//    2. "Never introduce new raw hex/px/easing values for things a token
//       covers" — a hard-coded colour is the reason a theme change (or light
//       mode) misses one element.
//
//  This is a RATCHET, not a zero gate: the existing tails only ever SHRINK.
//  Counts above the committed baseline in css-budget.json FAIL; counts below it
//  pass with a nudge to lower the baseline in the same PR. Same contract as
//  typecheck.js and perf-budget.js — never raise a number to go green.
//
//  What is NOT counted (deliberately — a noisy gate gets worked around):
//    - the COMPLEMENT of a canonical breakpoint: max-width:479/639/899/1199 and
//      min-width:481/641/901/1201 pair with a canonical one to split a range.
//    - hex inside a custom-property DECLARATION (`--ok: #4ade80`) — :root is
//      exactly where colour literals belong.
//    - hex in a `var(--x, #fallback)` fallback — a deliberate defensive default.
//    - hex in mask / mask-image / -webkit-mask gradients — those are alpha
//      channels (#000/#fff as "transparent here, opaque there"), not theme
//      colours, so a token would be meaningless.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const BUDGET_PATH = path.join(DIR, 'css-budget.json');
const CANON = [480, 640, 900, 1200];
const FILES = ['app.css', 'admin.css', 'guest-app.css'];
const update = process.argv.includes('--update');

// --- the two measurements -------------------------------------------------
function strayBreakpoints(css) {
    const out = [];
    for (const m of css.matchAll(/\(\s*(min|max)-width:\s*(\d+)px/g)) {
        const type = m[1];
        const w = +m[2];
        if (CANON.includes(w)) continue;
        // max-width:639 splits at the same place as min-width:640 — the pair is
        // one canonical boundary, not a stray width.
        if (type === 'max' && CANON.includes(w + 1)) continue;
        if (type === 'min' && CANON.includes(w - 1)) continue;
        out.push(`${type}-width:${w}px`);
    }
    return out;
}

function rawHexColours(css) {
    const out = [];
    css.split('\n').forEach((line, i) => {
        if (/^\s*--[\w-]+\s*:/.test(line)) return; // a token definition
        if (/-?(webkit-)?mask(-image)?\s*:/.test(line)) return; // alpha channel, not colour
        // Blank out var() so a `var(--accent, #c79a64)` fallback isn't counted.
        const stripped = line.replace(/var\([^)]*\)/g, 'var()');
        for (const h of stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || []) {
            out.push(`${i + 1}: ${h}`);
        }
    });
    return out;
}

// --- run ------------------------------------------------------------------
const found = {};
for (const f of FILES) {
    let css;
    try {
        css = fs.readFileSync(path.join(DIR, f), 'utf8');
    } catch (e) {
        console.error(`  ✗ ${f} — not readable (${e.message})`);
        process.exit(1);
    }
    found[f] = { breakpoints: strayBreakpoints(css), rawHex: rawHexColours(css) };
}

if (update) {
    const next = { comment: undefined };
    // Preserve the explanatory comment if one is already committed.
    let prev = {};
    try {
        prev = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
    } catch (e) {}
    next.comment =
        prev.comment ||
        'CSS convention RATCHET baselines for check-css-conventions.js: stray media-query widths (canonical: 480/640/900/1200) and raw hex colours outside token definitions. These numbers only ever go DOWN — when a PR removes some, lower the count in the same PR. Never raise one to get green; use a token / a canonical breakpoint instead. Re-baseline after a cleanup with: node check-css-conventions.js --update';
    for (const f of FILES) {
        next[f] = { breakpoints: found[f].breakpoints.length, rawHex: found[f].rawHex.length };
    }
    fs.writeFileSync(BUDGET_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log('css-budget.json re-baselined:');
    for (const f of FILES) console.log(`  ${f} — ${next[f].breakpoints} stray breakpoint(s), ${next[f].rawHex} raw hex`);
    process.exit(0);
}

let budget;
try {
    budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
} catch (e) {
    console.error('  ✗ css-budget.json missing or unreadable — create it with: node check-css-conventions.js --update');
    process.exit(1);
}

let failed = 0;
const nudges = [];
const DIMS = [
    { key: 'breakpoints', label: 'stray media-query width', fix: 'use one of 480 / 640 / 900 / 1200 (or the complement of one)' },
    { key: 'rawHex', label: 'raw hex colour', fix: 'use an existing :root token (or add one) — see DESIGN.md' },
];

console.log('\n== CSS conventions (ratchet) ==');
for (const f of FILES) {
    for (const { key, label, fix } of DIMS) {
        const n = found[f][key].length;
        const max = ((budget[f] || {})[key] != null) ? budget[f][key] : null;
        if (max == null) {
            console.log(`  ✗ ${f} ${key} — no baseline in css-budget.json (run --update)`);
            failed++;
            continue;
        }
        if (n > max) {
            failed++;
            const added = found[f][key].slice(0, 8).join(', ');
            console.log(`  ✗ ${f} — ${n} ${label}(s), baseline ${max} (+${n - max}). ${fix}.`);
            console.log(`      present: ${added}${found[f][key].length > 8 ? ' …' : ''}`);
        } else if (n < max) {
            console.log(`  ✓ ${f} — ${n} ${label}(s) (baseline ${max})`);
            nudges.push(`${f}.${key}: ${max} → ${n}`);
        } else {
            console.log(`  ✓ ${f} — ${n} ${label}(s) (at baseline)`);
        }
    }
}

if (nudges.length) {
    console.log('\n  Nice — these went DOWN. Lock the win in by lowering the baseline in this PR:');
    nudges.forEach((n) => console.log('    • ' + n));
    console.log('    (or just run: node check-css-conventions.js --update)');
}
if (failed) {
    console.error(`\n  ${failed} CSS convention ratchet(s) EXCEEDED ❌`);
    console.error('  These baselines only go down. Fix the new value rather than raising the number.');
    process.exit(1);
}
console.log('\n  CSS conventions within baseline ✅\n');
process.exit(0);
