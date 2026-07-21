// ============================================================
//  ui-test-lib.js — the shared harness for every ui-test-*.js suite
//  (dev/CI only, never deployed).
//
//  Each suite used to open with the same ~40 lines: the Europe/London TZ pin,
//  the today-relative date helper, the ok() assertion, a hand-picked port, the
//  php -S spawn + readiness poll, the Chromium launch (CHB_CHROMIUM override),
//  the service-worker stub and the pageerror logger. This is that block, once.
//
//      const { d, ok, boot } = require('./ui-test-lib');
//      const t = await boot({ viewport: { width: 390, height: 844 } });
//      await t.page.goto(t.base + '/index.html');
//      ...
//      await t.done(failures);   // closes browser, kills php -S, exits
//
//  Ports are leased from the kernel per suite run (no more hand-maintained
//  port registry / collisions when suites run concurrently in ui-tests.js).
// ============================================================

// The site reckons "today" in UK time (todayDashed / ukNowParts), so the tests
// must too — pin the whole process (and the browsers it launches) to
// Europe/London BEFORE the first Date call anywhere. This runs at require
// time, so requiring the lib first thing keeps every suite correct.
process.env.TZ = 'Europe/London';

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

// Fixture dates are TODAY-relative (a fixed anchor rots as real time passes)
// and formatted locally — toISOString() is UTC and slips a day near midnight.
const d = (o) => {
    const t = new Date();
    const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + o);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Assertion: prints ✓/✗ and throws on failure so the run stops at the first break.
const ok = (cond, label) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) throw new Error('FAILED: ' + label);
};

// A port leased from the kernel — free by construction, so concurrent suites
// can never collide however many run at once.
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

// Server + browser only — for suites that create (multiple) pages themselves
// with their own error handlers / device options. Returns
// { browser, server, base, port, done }.
async function bootBrowser() {
    const { chromium } = require('playwright');
    const port = await freePort();
    const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', __dirname], { stdio: 'ignore' });
    // Wait for php -S to actually accept connections (a fixed sleep flakes on slow CI runners).
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break;
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 250));
    }
    const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
    const base = `http://127.0.0.1:${port}`;
    const done = async (failures = 0) => {
        try {
            await browser.close();
        } catch (e) {}
        try {
            server.kill();
        } catch (e) {}
        process.exit(failures ? 1 : 0);
    };
    return { browser, server, base, port, done };
}

// The standard stack on top: one page with the SW stub + pageerror logging.
// Returns { page, browser, server, base, port, done }.
//   opts.viewport — page viewport (default 1000×900, the sub-1200 standalone layout)
async function boot(opts = {}) {
    const t = await bootBrowser();
    const page = await t.browser.newPage({ viewport: opts.viewport || { width: 1000, height: 900 } });
    page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
    // Top frame only — sandboxed iframes (email previews) have no serviceWorker,
    // and registering the real SW would cache-poison later suites.
    await page.addInitScript(() => {
        if (window.top === window && navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });
    return { page, ...t };
}

module.exports = { d, ok, boot, bootBrowser, freePort };
