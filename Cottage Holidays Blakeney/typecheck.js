#!/usr/bin/env node
// ============================================================
//  typecheck.js — TypeScript checkJs RATCHET over the front-end JS
//  (dev/CI only — excluded from deploy).
//
//      node typecheck.js            (expects typescript installed locally,
//                                    CI pins typescript@5.6.3 — counts differ
//                                    across compiler versions)
//
//  There is deliberately NO build step and no TypeScript in this codebase —
//  this runs tsc as a LINTER ONLY (--noEmit --checkJs) and compares the error
//  COUNT per group against the committed budget in tsc-budget.json:
//    - count > budget  → FAIL (new code introduced new type errors)
//    - count < budget  → pass, with a nudge to lower the budget in the same PR
//  A ratchet (not a zero gate) because the existing globals-style code has a
//  long tail of TS2339 "property does not exist on window" — the point is that
//  the tail only ever SHRINKS. Fixing errors near code you touch + lowering
//  the budget is the expected workflow; never raise a budget to make a PR pass
//  without understanding what the new errors are.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR = __dirname;
const budget = JSON.parse(fs.readFileSync(path.join(DIR, 'tsc-budget.json'), 'utf8'));

// sw.js is a ServiceWorker global scope (webworker lib), the rest are DOM.
const GROUPS = {
    app: { files: ['app.js', 'admin.js', 'guest-app.js'], lib: 'es2020,dom' },
    sw: { files: ['sw.js'], lib: 'es2020,webworker' },
};

// The compiler is PINNED: error counts differ across tsc versions, so a
// floating `npx tsc` would move the budgets under everyone's feet. CI installs
// typescript@<pin> next to eslint; locally do the same (or point TSC_BIN at one).
const PIN = String(budget.typescript || '');
let tscBin = process.env.TSC_BIN || path.join(DIR, 'node_modules', '.bin', 'tsc');
if (!process.env.TSC_BIN && !fs.existsSync(tscBin)) {
    console.error(`typecheck: tsc not found — run: npm install typescript@${PIN}  (or set TSC_BIN)`);
    process.exit(1);
}
tscBin = `"${tscBin}"`; // the folder name has spaces
const ver = execSync(`${tscBin} --version`, { cwd: DIR, encoding: 'utf8' }).replace(/[^\d.]/g, '');
if (ver !== PIN) {
    console.error(`typecheck: typescript ${ver} found but the budgets are calibrated for ${PIN} — install typescript@${PIN}.`);
    process.exit(1);
}

let failures = 0;
for (const [name, g] of Object.entries(GROUPS)) {
    let out = '';
    try {
        execSync(`${tscBin} --allowJs --checkJs --noEmit --target es2020 --lib ${g.lib} --skipLibCheck ${g.files.join(' ')}`,
            { cwd: DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        out = (e.stdout || '') + (e.stderr || '');
        if (!/error TS\d+/.test(out)) { console.error(`typecheck [${name}]: tsc did not run — ${out.split('\n')[0]}`); process.exit(1); }
    }
    const count = (out.match(/error TS\d+/g) || []).length;
    const max = budget[name];
    if (typeof max !== 'number') { console.error(`typecheck [${name}]: no budget in tsc-budget.json`); failures++; continue; }
    if (count > max) {
        // Show the newest-looking offenders (tsc output is file-ordered; print the tail).
        console.error(`  ✗ [${name}] ${count} type errors > budget ${max} — new type errors introduced:`);
        out.split('\n').filter(l => /error TS\d+/.test(l)).slice(-12).forEach(l => console.error('      ' + l));
        failures++;
    } else if (count < max) {
        console.log(`  ✓ [${name}] ${count} type errors (budget ${max}) — nice, lower "${name}" to ${count} in tsc-budget.json in this PR`);
    } else {
        console.log(`  ✓ [${name}] ${count} type errors — at budget`);
    }
}

if (failures) { console.error('\ntypecheck: the error count only ever ratchets DOWN. Fix the new errors (or discuss before raising a budget).'); process.exit(1); }
console.log('typecheck: within budget.');
