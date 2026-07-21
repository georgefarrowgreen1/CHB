#!/usr/bin/env node
// ============================================================
//  ui-tests.js — behaviour suites for the back office + guest shell
//  (dev/CI only, never deployed).
//
//  Runs every ui-test-*.js in this folder CONCURRENTLY (each suite boots its
//  own `php -S` on its own port with stubbed APIs, so they cannot collide) and
//  fails if any suite fails. Output is buffered per suite and printed whole on
//  completion, so logs stay readable. Coverage: the booking hub (menu, money
//  fold, breakdown window, delete rules), the Needs-you strip, the edit
//  modal's locked-price display, the guest account modals on phones, the
//  Inbox mailbox client, the Payments workspace reconciliation, and the
//  merged Today workspace.
//
//  Run locally:  node ui-tests.js            (all suites)
//                node ui-tests.js hub money  (only suites matching a term)
//                UI_TESTS_JOBS=1 node ui-tests.js   (serial, for debugging)
//  Needs `npm i playwright` once; set CHB_CHROMIUM to use an existing
//  Chromium binary, e.g. CHB_CHROMIUM=/opt/pw-browsers/chromium.
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const suites = fs
    .readdirSync(__dirname)
    .filter((f) => /^ui-test-.*\.js$/.test(f) && f !== 'ui-test-lib.js') // the shared harness, not a suite
    .filter((f) => !filters.length || filters.some((t) => f.includes(t)))
    .sort();

if (!suites.length) {
    console.error('No ui-test-*.js suites matched.');
    process.exit(1);
}

// Three browsers + three php servers is a comfortable load for the 4-core CI
// runners; UI_TESTS_JOBS overrides (1 = the old serial behaviour).
const POOL = Math.max(
    1,
    Math.min(parseInt(process.env.UI_TESTS_JOBS, 10) || 3, (os.cpus() || [{}]).length - 1 || 1, suites.length),
);

function runSuite(suite) {
    return new Promise((resolve) => {
        const chunks = [];
        const child = spawn(process.execPath, [path.join(__dirname, suite)], {
            cwd: __dirname,
            timeout: 5 * 60 * 1000,
        });
        child.stdout.on('data', (d) => chunks.push(d));
        child.stderr.on('data', (d) => chunks.push(d));
        child.on('close', (code) => {
            console.log(`\n════ ${suite} ════`);
            process.stdout.write(Buffer.concat(chunks).toString());
            resolve({ suite, failed: code !== 0 });
        });
    });
}

(async () => {
    const queue = suites.slice();
    const results = [];
    await Promise.all(
        Array.from({ length: POOL }, async () => {
            for (;;) {
                const suite = queue.shift();
                if (!suite) return;
                results.push(await runSuite(suite));
            }
        }),
    );
    const failed = results.filter((r) => r.failed).map((r) => r.suite);
    console.log(`\n== UI suites summary (${POOL} at a time) ==`);
    suites.forEach((s) => console.log(`  ${failed.includes(s) ? '✗' : '✓'} ${s}`));
    if (failed.length) {
        console.log(`\n  ${failed.length} SUITE(S) FAILED ❌\n`);
        process.exit(1);
    }
    console.log('\n  ALL UI SUITES PASSED ✅\n');
    process.exit(0);
})();
