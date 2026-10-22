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

// LONGEST FIRST. The run ends when its last suite does, so a long suite started
// near the end of an alphabetical queue left the other workers idle while it
// finished (measured: 965s against 910s ideal for three at a time). Each run
// records how long every suite took in the system temp dir and the next run
// starts the slowest first; a suite with no time recorded (a fresh machine, a new
// suite) is ranked by its file size, which gives the same finish in a simulation
// over 92 measured suites. The order only moves time around: nothing is skipped.
const TIMES_FILE = path.join(os.tmpdir(), 'chb-ui-suite-times.json');
let times = {};
try {
    times = JSON.parse(fs.readFileSync(TIMES_FILE, 'utf8')) || {};
} catch (e) {}
const sizeOf = (s) => {
    try {
        return fs.statSync(path.join(__dirname, s)).size;
    } catch (e) {
        return 0;
    }
};
// Bytes to seconds, from the same 92 suites (about 1.1KB of file per second of run).
const guess = (s) => (Number.isFinite(times[s]) ? times[s] : sizeOf(s) / 1100);
const queueOrder = suites.slice().sort((a, b) => guess(b) - guess(a) || (a < b ? -1 : 1));

if (!suites.length) {
    console.error('No ui-test-*.js suites matched.');
    process.exit(1);
}

// One suite per core. A suite averages under one core (it waits on timers and the
// network as often as it renders), so three at a time on 4 cores left 1.3 of them
// idle: measured 2.7 cores busy over 14.0 minutes, against 3.4 over 11.3 at four,
// with every suite passing. UI_TESTS_JOBS overrides (1 = serial, for debugging).
const JOBS = parseInt(process.env.UI_TESTS_JOBS, 10);
const POOL = Math.max(1, Math.min(JOBS > 0 ? JOBS : (os.cpus() || [{}]).length || 1, suites.length));

function runSuite(suite) {
    return new Promise((resolve) => {
        const chunks = [];
        const started = Date.now();
        const child = spawn(process.execPath, [path.join(__dirname, suite)], {
            cwd: __dirname,
            timeout: 5 * 60 * 1000,
        });
        child.stdout.on('data', (d) => chunks.push(d));
        child.stderr.on('data', (d) => chunks.push(d));
        child.on('close', (code) => {
            const secs = (Date.now() - started) / 1000;
            console.log(`\n════ ${suite} (${secs.toFixed(1)}s) ════`);
            process.stdout.write(Buffer.concat(chunks).toString());
            resolve({ suite, failed: code !== 0, secs });
        });
    });
}

(async () => {
    const queue = queueOrder.slice();
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
    // Only a suite that PASSED says how long it takes: a failure can stop early,
    // and recording that would start a long suite late next time.
    results.filter((r) => !r.failed).forEach((r) => { times[r.suite] = Math.round(r.secs * 10) / 10; });
    try {
        const tmp = TIMES_FILE + '.' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(times));
        fs.renameSync(tmp, TIMES_FILE);
    } catch (e) {}
    const failed = results.filter((r) => r.failed).map((r) => r.suite);
    console.log(`\n== UI suites summary (${POOL} at a time) ==`);
    suites.forEach((s) => console.log(`  ${failed.includes(s) ? '✗' : '✓'} ${s}`));
    // Where the time goes: the battery is the long pole of every local check.
    const slow = results.slice().sort((a, b) => b.secs - a.secs).slice(0, 10);
    console.log(`\n  slowest: ${slow.map((r) => `${r.suite.replace(/^ui-test-|\.js$/g, '')} ${Math.round(r.secs)}s`).join(', ')}`);
    console.log(`  total suite time ${Math.round(results.reduce((t, r) => t + r.secs, 0))}s across ${results.length} suites`);
    if (failed.length) {
        console.log(`\n  ${failed.length} SUITE(S) FAILED ❌\n`);
        process.exit(1);
    }
    console.log('\n  ALL UI SUITES PASSED ✅\n');
    process.exit(0);
})();
