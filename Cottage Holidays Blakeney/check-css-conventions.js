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

// Comments aren't code — a hex mentioned while EXPLAINING a rule ("#000 here is a
// mask alpha channel, not a colour") can't affect rendering, and counting it makes
// the gate punish documentation. Blank the comment bodies but keep the newlines so
// reported line numbers still line up with the file.
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function rawHexColours(cssRaw) {
    const css = stripComments(cssRaw);
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

// A raw env(safe-area-inset-*) OUTSIDE the four token definitions silently opts
// its rule out of `body.acct-preview-embedded`, which zeroes the --safe-* tokens
// so the owner's read-only account preview doesn't inset a second time (iOS hands
// the device insets down into a same-origin iframe). All 36 call sites were
// migrated onto the tokens; this keeps the count at zero, because one new raw
// env() re-opens exactly the bug the migration closed — and it would only show on
// a real notched phone, inside a preview, which is nobody's test device.
function rawEnvInsets(cssRaw) {
    const css = stripComments(cssRaw);
    const out = [];
    css.split('\n').forEach((line, i) => {
        if (/^\s*--safe-[trbl]\s*:/.test(line)) return; // the definitions themselves
        for (const m of line.matchAll(/env\(\s*safe-area-inset-(top|right|bottom|left)/g)) {
            out.push(`${i + 1}: env(safe-area-inset-${m[1]})`);
        }
    });
    return out;
}

// A spacing value off the 4pt grid: padding / margin / gap set to a pixel value
// of 3px or more that is not a multiple of 4 (1–2px are hairlines and optical
// nudges, which the grid allows). The HIG's 8pt grid with a 4pt minor is the
// brief; measured before this ratchet, 62% of the app's pixel spacing sat on
// neither. Counted so a cleanup locks in and a new stray value shows up —
// snapping is done by component, with layout-test watching, never by sweep.
function offGridSpacing(cssRaw) {
    const css = stripComments(cssRaw);
    const out = [];
    // Declarations are matched anywhere on a line, several per line — admin.css
    // joins many rules onto one line (`}.x { padding: 6px; }`), and a start-of-line
    // match under-counted it by a third (303 against 472, measured).
    css.split('\n').forEach((line, i) => {
        for (const d of line.matchAll(/(?:^|[;{])\s*(?:padding|margin|gap|row-gap|column-gap)(?:-top|-right|-bottom|-left)?\s*:\s*([^;}]+)/g)) {
            for (const tok of d[1].trim().split(/\s+/)) {
                const m = tok.match(/^-?(\d+(?:\.\d+)?)px$/);
                if (!m) continue;
                const px = parseFloat(m[1]);
                if (px >= 3 && px % 4 !== 0) out.push(`${i + 1}: ${tok}`);
            }
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
    found[f] = { breakpoints: strayBreakpoints(css), rawHex: rawHexColours(css), rawEnv: rawEnvInsets(css), offGrid: offGridSpacing(css) };
}

const DIMS = [
    { key: 'breakpoints', label: 'stray media-query width', fix: 'use one of 480 / 640 / 900 / 1200 (or the complement of one)' },
    { key: 'rawHex', label: 'raw hex colour', fix: 'use an existing :root token (or add one) — see DESIGN.md' },
    { key: 'rawEnv', label: 'raw env(safe-area-inset)', fix: 'use var(--safe-t/r/b/l) so the account preview can zero it' },
    { key: 'offGrid', label: 'spacing value off the 4pt grid', fix: 'snap to a multiple of 4 (or use a --space-N token); 1–2px hairline nudges are allowed' },
];

if (update) {
    const next = { comment: undefined };
    // Preserve the explanatory comment if one is already committed.
    let prev = {};
    try {
        prev = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
    } catch (e) {}
    next.comment =
        prev.comment ||
        'CSS convention RATCHET baselines for check-css-conventions.js: stray media-query widths (canonical: 480/640/900/1200), raw hex colours outside token definitions, raw env(safe-area-inset-*) outside the four --safe-* definitions, and spacing values (padding/margin/gap, 3px+) off the 4pt grid. These numbers only ever go DOWN — when a PR removes some, lower the count in the same PR. Never raise one to get green; use a token / a canonical breakpoint instead. Re-baseline after a cleanup with: node check-css-conventions.js --update';
    for (const f of FILES) {
        next[f] = Object.fromEntries(DIMS.map((d) => [d.key, found[f][d.key].length]));
    }
    fs.writeFileSync(BUDGET_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log('css-budget.json re-baselined:');
    for (const f of FILES) console.log(`  ${f} — ${next[f].breakpoints} stray breakpoint(s), ${next[f].rawHex} raw hex, ${next[f].rawEnv} raw env(), ${next[f].offGrid} off-grid spacing`);
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

// ---- STRUCTURE: a stylesheet that does not close is a stylesheet that stops --
// Not a ratchet — a hard invariant, and the one CSS defect class this codebase
// has actually shipped twice. An edit that eats an `@media` opener or leaves a
// comment half-closed does not fail loudly: the parser swallows everything up
// to the next brace it likes and rules SECTIONS AWAY silently stop applying
// (measured once as the admin rail no longer hiding at 390px). Both times the
// whole local gauntlet stayed green, because every other gate reads the file as
// TEXT — sizes it, greps it — and text does not care whether it parses.
// Comments are stripped BEFORE the braces are counted, or a `{` inside prose
// reads as a rule and the check cries wolf on correct code.
console.log('\n== CSS structure (hard invariant, not a ratchet) ==');
for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const opens = (src.match(/\/\*/g) || []).length;
    const closes = (src.match(/\*\//g) || []).length;
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const braceOpen = (bare.match(/\{/g) || []).length;
    const braceClose = (bare.match(/\}/g) || []).length;
    const strayEnd = bare.includes('*/');
    const problems = [];
    if (opens !== closes) problems.push(`${opens} /* vs ${closes} */`);
    if (strayEnd) problems.push('a */ outside any comment (a comment closed early)');
    if (braceOpen !== braceClose) problems.push(`${braceOpen} { vs ${braceClose} }`);
    if (problems.length) {
        failed++;
        console.log(`  ✗ ${f} — does not parse cleanly: ${problems.join('; ')}.`);
        console.log('      Rules after the break silently stop applying. Delete or replace a');
        console.log('      rule by matching the WHOLE rule, never by slicing to the next brace.');
    } else {
        console.log(`  ✓ ${f} — comments and braces balance (${braceOpen} rules)`);
    }
}

// ---- A CLASS WITH NO RULE IS INVISIBLE TO EVERY GATE. `.btn-primary` was used
// on seven guest controls (the last-morning check-out tap among them) and defined
// nowhere, so they rendered as the browser's default grey button — and the suites
// read text and names, never paint, while a stylesheet scan has nothing to scan.
// Every btn-* token used in the markup or the JS templates must have a rule in
// one of the three sheets. Hard, not a ratchet: the count is zero and stays zero.
console.log('\n== Button classes have rules (hard invariant, not a ratchet) ==');
{
    const sheets = FILES.map((f) => stripComments(fs.readFileSync(path.join(DIR, f), 'utf8'))).join('\n');
    const markup = ['index.html', 'admin-views.html', 'app.js', 'admin.js', 'guest-app.js']
        .map((f) => { try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
    const used = new Set();
    for (const m of markup.matchAll(/class=["']([^"'`]*)["']/g)) for (const tok of m[1].split(/\s+/)) if (/^btn-[a-z0-9-]+$/.test(tok)) used.add(tok);
    const unstyled = [...used].filter((tok) => !new RegExp('\\.' + tok.replace(/-/g, '\\-') + '(?![a-z0-9-])').test(sheets));
    if (used.size < 5) { failed++; console.log(`  ✗ only ${used.size} btn-* classes found in the markup — the scan is not seeing the templates`); }
    else if (unstyled.length) { failed++; console.log(`  ✗ ${unstyled.length} button class(es) with no rule in any stylesheet: ${unstyled.join(', ')} — they render as the browser's default button`); }
    else console.log(`  ✓ every btn-* class the markup uses has a rule (${used.size} classes)`);
}

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
