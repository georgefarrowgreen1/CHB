#!/usr/bin/env node
// ============================================================
//  ui-tests.js — behaviour suites for the back office + guest shell
//  (dev/CI only, never deployed).
//
//  Runs every ui-test-*.js in this folder sequentially (each boots its own
//  `php -S` on its own port with stubbed APIs, like e2e-test.js) and fails
//  if any suite fails. Coverage: the booking hub (menu, money fold,
//  breakdown window, delete rules), the Needs-you strip, the edit modal's
//  locked-price display, the guest account modals on phones, the Inbox
//  mailbox client, the Money workspace reconciliation, and the merged
//  Today workspace.
//
//  Run locally:  node ui-tests.js            (all suites)
//                node ui-tests.js hub money  (only suites matching a term)
//  Needs `npm i playwright` once; set CHB_CHROMIUM to use an existing
//  Chromium binary, e.g. CHB_CHROMIUM=/opt/pw-browsers/chromium.
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const suites = fs
    .readdirSync(__dirname)
    .filter((f) => /^ui-test-.*\.js$/.test(f))
    .filter((f) => !filters.length || filters.some((t) => f.includes(t)))
    .sort();

if (!suites.length) {
    console.error('No ui-test-*.js suites matched.');
    process.exit(1);
}

const failed = [];
for (const suite of suites) {
    console.log(`\n════ ${suite} ════`);
    const r = spawnSync(process.execPath, [path.join(__dirname, suite)], {
        stdio: 'inherit',
        cwd: __dirname,
        timeout: 5 * 60 * 1000,
    });
    if (r.status !== 0) failed.push(suite);
}

console.log('\n== UI suites summary ==');
suites.forEach((s) => console.log(`  ${failed.includes(s) ? '✗' : '✓'} ${s}`));
if (failed.length) {
    console.log(`\n  ${failed.length} SUITE(S) FAILED ❌\n`);
    process.exit(1);
}
console.log('\n  ALL UI SUITES PASSED ✅\n');
process.exit(0);
