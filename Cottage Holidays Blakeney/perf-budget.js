#!/usr/bin/env node
// ============================================================
//  perf-budget.js — PERFORMANCE budget gate (dev/CI only, never deployed).
//
//      node perf-budget.js
//
//  Guards the one performance dimension nothing else watches: the gzipped
//  TRANSFER SIZE of every shipped asset, against the budgets committed in
//  size-budget.json. app.js has grown with every feature and nothing pushed
//  back — this makes byte growth a conscious, reviewed decision instead of
//  silent rot:
//    - size > budget  → FAIL. If the growth is a real feature trade, bump the
//      budget IN THE SAME PR and say what the bytes buy.
//    - size well under budget (>3%) → pass, with a nudge to lower the budget
//      and lock the win in.
//  Sizes are node-zlib gzip (default level) so local and CI agree; the live
//  host serves precompressed brotli, which is smaller still — this is a
//  consistent relative measure, not an exact wire byte count.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = __dirname;
const budget = JSON.parse(fs.readFileSync(path.join(DIR, 'size-budget.json'), 'utf8'));

let failures = 0;
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
for (const [file, max] of Object.entries(budget)) {
    if (file === 'comment') continue;
    let raw;
    try {
        raw = fs.readFileSync(path.join(DIR, file));
    } catch (e) {
        console.error(`  ✗ ${file} — in size-budget.json but missing on disk`);
        failures++;
        continue;
    }
    const gz = zlib.gzipSync(raw).length;
    if (gz > max) {
        console.error(`  ✗ ${file} — ${kb(gz)} gz OVER its ${kb(max)} budget (+${gz - max} bytes). If this growth is a deliberate trade, raise the budget in this PR and say what the bytes buy.`);
        failures++;
    } else if (gz < max * 0.95) {
        console.log(`  ✓ ${file} — ${kb(gz)} gz (budget ${kb(max)}) — nice, lower its budget to ~${gz + 500} to lock the win in`);
    } else {
        console.log(`  ✓ ${file} — ${kb(gz)} gz (budget ${kb(max)})`);
    }
}

if (failures) {
    console.error('\nperf-budget: shipped bytes exceed the committed budgets.');
    process.exit(1);
}
console.log('perf-budget: all shipped assets within budget.');
