#!/usr/bin/env node
// ============================================================
//  bump.js — does the ENTIRE deploy-checklist version chain in one go
//  (dev tool only — excluded from deploy, like smoke-test.js).
//
//      node bump.js <build-stamp>          e.g.  node bump.js paypolish2
//      node bump.js <build-stamp> --dry    show what would change, touch nothing
//
//  It git-diffs the working tree + branch against origin/main to see WHICH
//  assets actually changed, then applies exactly the checklist:
//    - const BUILD  (app.js, last statement)  ← <build-stamp>   (always)
//    - CACHE        (sw.js)                    +1               (always)
//    - app.js ?v=   (index.html + sw.js CORE)  +1               (always — the
//                    BUILD edit itself changes app.js)
//    - app.css / guest-app.css / guest-app.js ?v=               +1 when changed
//    - ADMIN_BUNDLE_V (app.js facade)          +1 when admin.js changed
//    - ADMIN_CSS_V    (app.js facade)          +1 when admin.css changed
//
//  After running: re-run `node smoke-test.js` (it guards the chain's
//  consistency) — bump.js reminds you. CI's check-versions.js enforces the
//  same rules on every PR, so a forgotten bump fails fast, not in production.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR = __dirname;
const stamp = process.argv[2];
const dry = process.argv.includes('--dry');

if (!stamp || !/^[a-z0-9]{6,}$/.test(stamp)) {
    console.error('Usage: node bump.js <build-stamp>  (lowercase letters/digits, ≥6 chars, e.g. paypolish2)');
    process.exit(1);
}

const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const write = (f, s) => { if (!dry) fs.writeFileSync(path.join(DIR, f), s); };

// ---- Which assets changed vs origin/main (committed on this branch OR uncommitted)?
let changed = new Set();
try {
    const branch = execSync('git diff --name-only origin/main...HEAD', { cwd: DIR, encoding: 'utf8' });
    const tree = execSync('git status --porcelain', { cwd: DIR, encoding: 'utf8' })
        .split('\n').map(l => l.slice(3)).join('\n');
    (branch + '\n' + tree).split('\n').forEach(l => { const b = path.basename(l.trim()); if (b) changed.add(b); });
} catch (e) {
    console.error('Could not git-diff against origin/main (' + e.message.split('\n')[0] + ') — assuming EVERYTHING changed.');
    changed = new Set(['app.css', 'guest-app.css', 'guest-app.js', 'admin.js', 'admin.css']);
}

let appJs = read('app.js');
let html = read('index.html');
let sw = read('sw.js');
const done = [];

// ---- BUILD stamp (always)
const curBuild = (appJs.match(/const BUILD = '([a-z0-9]+)';/) || [])[1];
if (!curBuild) { console.error('const BUILD not found in app.js'); process.exit(1); }
if (curBuild === stamp) { console.error(`BUILD is already '${stamp}' — pick a new stamp.`); process.exit(1); }
appJs = appJs.replace(/const BUILD = '[a-z0-9]+';/, `const BUILD = '${stamp}';`);
done.push(`BUILD ${curBuild} → ${stamp} (app.js)`);

// ---- ADMIN_BUNDLE_V / ADMIN_CSS_V (when their files changed)
const bumpConst = (name, when) => {
    if (!changed.has(when)) return;
    const re = new RegExp(`const ${name} = (\\d+);`);
    const cur = (appJs.match(re) || [])[1];
    if (!cur) { console.error(`const ${name} not found in app.js`); process.exit(1); }
    appJs = appJs.replace(re, `const ${name} = ${+cur + 1};`);
    done.push(`${name} ${cur} → ${+cur + 1} (${when} changed)`);
};
bumpConst('ADMIN_BUNDLE_V', 'admin.js');
bumpConst('ADMIN_CSS_V', 'admin.css');

// ---- ?v= pins in index.html + sw.js CORE (app.js always — BUILD changes it)
['app.js', 'app.css', 'guest-app.css', 'guest-app.js'].forEach((a) => {
    if (a !== 'app.js' && !changed.has(a)) return;
    const re = new RegExp('(?<![-\\w])' + a.replace('.', '\\.') + '\\?v=(\\d+)', 'g');
    const cur = (html.match(new RegExp('(?<![-\\w])' + a.replace('.', '\\.') + '\\?v=(\\d+)')) || [])[1];
    if (!cur) { console.error(`${a}?v= not found in index.html`); process.exit(1); }
    html = html.replace(re, `${a}?v=${+cur + 1}`);
    sw = sw.replace(re, `${a}?v=${+cur + 1}`);
    done.push(`${a} ?v=${cur} → ${+cur + 1} (index.html + sw.js)`);
});

// ---- sw.js CACHE (always)
const curCache = (sw.match(/const CACHE = 'chb-cache-v(\d+)';/) || [])[1];
if (!curCache) { console.error('const CACHE not found in sw.js'); process.exit(1); }
sw = sw.replace(/const CACHE = 'chb-cache-v\d+';/, `const CACHE = 'chb-cache-v${+curCache + 1}';`);
done.push(`CACHE v${curCache} → v${+curCache + 1} (sw.js)`);

write('app.js', appJs);
write('index.html', html);
write('sw.js', sw);

console.log((dry ? 'DRY RUN — would bump:\n' : 'Bumped:\n') + done.map(d => '  • ' + d).join('\n'));
if (changed.has('admin.js') || changed.has('admin.css')) console.log('  (admin bundle repinned — guests never fetch it, no CORE entry to touch)');
console.log('\nNow re-run: node smoke-test.js  &&  php test-pricing.php');
