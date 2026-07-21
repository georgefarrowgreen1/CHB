#!/usr/bin/env node
/* ============================================================
 *  smoke-test.js — local safety net for Cottage Holidays Blakeney.
 *
 *  This is a DEVELOPMENT tool. Do NOT upload it to the web server.
 *  Run it after editing index.html (or the PHP) to catch regressions
 *  that a plain syntax check can't:
 *
 *      node smoke-test.js
 *
 *  It loads the real index.html, runs its JavaScript inside a tiny
 *  fake-browser shim, then exercises the high-risk logic (pricing
 *  maths, postcode + occupancy validation, date helpers) and checks
 *  structural invariants (every onclick points at a real function,
 *  no duplicate element ids, the build stamp + JSON-LD are intact).
 *
 *  Exit code 0 = all good. Exit code 1 = something broke.
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'index.html');
let failures = 0;
const pass = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failures++; console.log('  ✗ ' + m); };
function check(name, cond) { cond ? pass(name) : fail(name); }
function approx(a, b) { return Math.abs(a - b) < 0.005; }

const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---- The app code. It now lives in an external app.js (extracted from the old
// inline <script>); fall back to the largest inline <script> if ever re-inlined. ----
let appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || '';
if (appScript.trim().length < 2000) {
    try { appScript = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'app.js'), 'utf8'); } catch (e) {}
}

console.log('\n== 1. JavaScript loads in a browser-like shim ==');

// Minimal fake-browser so top-level code (IIFEs, event registrations) runs cleanly.
function stubEl() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
        getAttribute() { return null; }, appendChild() {}, append() {}, prepend() {}, remove() {},
        querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
        focus() {}, blur() {}, click() {}, scrollIntoView() {}, getBoundingClientRect() { return { top: 0, left: 0 }; },
        innerHTML: '', textContent: '', innerText: '', value: '', checked: false, children: [], files: []
    };
}
const documentShim = {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubEl(); },
    addEventListener() {}, removeEventListener() {},
    body: stubEl(), documentElement: stubEl(),
    cookie: ''
};
const sandbox = {
    console,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('no network in smoke test')),
    localStorage: (() => { const d = {}; return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; })(),
    navigator: { credentials: undefined, userAgent: 'node-smoke-test' },
    document: documentShim
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.location = { pathname: '/', href: 'http://localhost/', hostname: 'localhost', search: '' };
sandbox.window.location = sandbox.location;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
sandbox.window.addEventListener = () => {};
sandbox.window.scrollTo = () => {};

let ctx;
try {
    ctx = vm.createContext(sandbox);
    vm.runInContext(appScript, ctx, { filename: 'index.html(script)', timeout: 5000 });
    pass('app script evaluated without throwing');
} catch (e) {
    fail('app script threw on load: ' + e.message);
    console.log('\nFATAL: cannot continue behavioural tests.\n');
    process.exit(1);
}

// The owner back office lives in admin.js (fetched on demand by loadAdminBundle;
// facade stubs in app.js cover any call that lands first). Evaluate it in the
// SAME context, exactly like the browser does, so (a) a load-time throw fails
// CI and (b) the behavioural checks below see the full app.
let adminScript = '';
try { adminScript = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'admin.js'), 'utf8'); } catch (e) {}
if (adminScript) {
    try {
        vm.runInContext(adminScript, ctx, { filename: 'admin.js', timeout: 5000 });
        pass('admin bundle evaluated without throwing');
        check('admin bundle sets __ADMIN_LOADED', sandbox.window.__ADMIN_LOADED === true);
        // Facade contract: every stub target must now be a REAL function on window
        // (a stub left in place would recurse forever at runtime).
        const stubSrc = appScript.match(/^\[(.*)\]\.forEach\(\(n\) => \{/m);
        if (stubSrc) {
            const stubNames = JSON.parse('[' + stubSrc[1] + ']');
            const unreplaced = stubNames.filter((n) => {
                const f = sandbox.window[n];
                return typeof f !== 'function' || f.__adminStub;
            });
            check(`all ${stubNames.length} facade stubs replaced by real admin functions`, unreplaced.length === 0);
            if (unreplaced.length) console.log('    still stubs: ' + unreplaced.join(', '));
        } else {
            fail('facade stub list not found in app.js');
        }
    } catch (e) {
        fail('admin bundle threw on load: ' + e.message);
    }
} else {
    fail('admin.js missing (owner back office bundle)');
}

const get = (n) => ctx[n] || sandbox[n];

console.log('\n== 2. Pricing engine (priceBreakdown) — shared parity fixtures ==');
const pb = get('priceBreakdown');
if (typeof pb !== 'function') {
    fail('priceBreakdown is not defined');
} else {
    // ONE source of truth for the JS/PHP parity cases: pricing-fixtures.json
    // (test-pricing.php loops the same file). The rate guard asserts the shim's
    // built-in rates for the prop match the fixture's, so the two sides can
    // never silently drift onto different inputs.
    const fx = JSON.parse(fs.readFileSync(path.join(path.dirname(HTML_PATH), 'pricing-fixtures.json'), 'utf8'));
    // defaultRates is a top-level const (a lexical binding, not a ctx property) —
    // read it by evaluating inside the context.
    const rates = vm.runInContext('typeof defaultRates !== "undefined" ? defaultRates : null', ctx) || {};
    const MAP = { couple_rate: 'coupleRate', extra_adult_rate: 'extraAdultRate', child_rate: 'childRate', booking_fee: 'damagesDeposit', transaction_pct: 'transactionPct' };
    fx.cases.forEach((c) => {
        const shim = rates[c.prop] || {};
        Object.keys(c.rate).forEach((k) => {
            check(`${c.name}: shim rate ${k} matches the fixture (${c.rate[k]})`, approx(parseFloat(shim[MAP[k]]) || 0, c.rate[k]));
        });
        const p = pb(c.prop, c.adults, c.children, c.checkIn, c.checkOut);
        Object.keys(c.expect).forEach((k) => {
            check(`${c.name}: ${k} = ${c.expect[k]}`, k === 'nights' ? p[k] === c.expect[k] : approx(p[k], c.expect[k]));
        });
    });
}
// Weekend uplift — tested via the pure helper (propertyRates isn't reachable in
// the shim). MUST match weekend_pct_for_night()/nightly_rate_for() in pricing.php.
const nrf = get('nightlyRateFor');
if (typeof nrf !== 'function') { fail('nightlyRateFor is not defined'); }
else {
    const wk = { coupleRate: 100, weekendPct: 20, weekendDays: '5,6' };
    check('weekend +20% on a Friday (2026-01-02)', approx(nrf('2026-01-02', wk, []), 120));
    check('weekend +20% on a Saturday (2026-01-03)', approx(nrf('2026-01-03', wk, []), 120));
    check('no uplift on a Monday (2026-01-05)', approx(nrf('2026-01-05', wk, []), 100));
    check('no uplift when weekendPct = 0', approx(nrf('2026-01-03', { coupleRate: 100, weekendPct: 0 }, []), 100));
    // Empty weekendDays must mean "no weekend days" (parity with PHP), NOT a fallback to Fri/Sat.
    check('weekendDays="" applies no uplift (parity)', approx(nrf('2026-01-03', { coupleRate: 100, weekendPct: 20, weekendDays: '' }, []), 100));
}
// Last-minute discount factor — pure helper, MUST match last_minute_factor() in pricing.php.
const lmf = get('lastMinuteFactor');
if (typeof lmf !== 'function') { fail('lastMinuteFactor is not defined'); }
else {
    check('lastmin: within window → 0.8 (20% off)', approx(lmf('2026-01-03', '2026-01-01', 20, 10), 0.8));
    check('lastmin: outside window → 1.0', approx(lmf('2026-01-20', '2026-01-01', 20, 10), 1.0));
    check('lastmin: past check-in → 1.0', approx(lmf('2025-12-31', '2026-01-01', 20, 10), 1.0));
    check('lastmin: 0% → 1.0 (off)', approx(lmf('2026-01-03', '2026-01-01', 0, 10), 1.0));
    check('lastmin: 0 days → 1.0 (off)', approx(lmf('2026-01-03', '2026-01-01', 20, 0), 1.0));
    check('lastmin: capped at 90% off', approx(lmf('2026-01-03', '2026-01-01', 99, 10), 0.1));
}
// Availability chip — "Available now" must mean TONIGHT is free. A gap starting
// tomorrow (or the old 2-day grace window) must say "Available from <date>",
// or the card contradicts the cottage's own calendar.
const chip = get('availChipHtml');
const fg = get('freeGaps');
if (typeof chip !== 'function' || typeof fg !== 'function') { fail('availChipHtml / freeGaps not defined'); }
else {
    check('chip: gap starting today → "Available now"', /Available now/.test(chip('2026-07-11', '2026-07-11')));
    check('chip: gap starting tomorrow → "Available from"', /Available from/.test(chip('2026-07-12', '2026-07-11')) && !/Available now/.test(chip('2026-07-12', '2026-07-11')));
    check('chip: gap starting in 2 days → "Available from" (regression: old grace said now)', /Available from/.test(chip('2026-07-13', '2026-07-11')));
    // freeGaps semantics: end-exclusive blocks, minNights honoured.
    const td = get('todayDashed')();
    const plus = (n) => { const d = get('dpParse')(td); d.setDate(d.getDate() + n); return get('formatDashed')(d); };
    const gaps = fg([{ start: td, end: plus(3) }, { start: plus(5), end: plus(9) }], 14, 2);
    check('freeGaps: first gap starts when the block ends (checkout day free)', gaps.length > 0 && gaps[0].start === plus(3));
    check('freeGaps: 2-night hole kept at minNights 2', gaps.length > 0 && gaps[0].nights === 2);
    const gaps3 = fg([{ start: td, end: plus(3) }, { start: plus(5), end: plus(9) }], 14, 3);
    check('freeGaps: 2-night hole skipped at minNights 3', gaps3.length > 0 && gaps3[0].start === plus(9));
}

console.log('\n== 3. UK postcode validation ==');
const hp = get('hasUkPostcode');
if (typeof hp !== 'function') { fail('hasUkPostcode is not defined'); }
else {
    check('hasUkPostcode: finds a postcode inside an address', hp('12 High St, Blakeney NR25 7AB') === true);
    check('hasUkPostcode: rejects text with no postcode', hp('12 High Street, Blakeney') === false);
}
const ip = get('isUkPostcode');
if (typeof ip !== 'function') { fail('isUkPostcode is not defined'); }
else {
    check('isUkPostcode: accepts "NR25 7AB"', ip('NR25 7AB') === true);
    check('isUkPostcode: accepts lowercase "sw1a 1aa"', ip('sw1a 1aa') === true);
    check('isUkPostcode: accepts no-space "NR257AB"', ip('NR257AB') === true);
    check('isUkPostcode: rejects a whole address (not just a postcode)', ip('12 High St NR25 7AB') === false);
    check('isUkPostcode: rejects gibberish', ip('not a postcode') === false);
    check('isUkPostcode: rejects empty', ip('') === false);
}

console.log('\n== 4. Occupancy limits (checkOccupancy) ==');
const co = get('checkOccupancy');
if (typeof co !== 'function') { fail('checkOccupancy is not defined'); }
else {
    check('21A: 2 adults OK (returns null)', co('21a', 2, 0) === null);
    check('21A: 3 adults rejected', typeof co('21a', 3, 0) === 'string');
    check('21A: a child rejected (adults-only)', typeof co('21a', 2, 1) === 'string');
    check('Pimpernel: 3 total OK', co('pimpernel', 2, 1) === null);
    check('Pimpernel: 4 total rejected', typeof co('pimpernel', 3, 1) === 'string');
}

console.log('\n== 5. Date helper (nightsBetween) ==');
const nb = get('nightsBetween');
if (typeof nb !== 'function') { fail('nightsBetween is not defined'); }
else {
    check('1 Jul -> 4 Jul = 3 nights', nb('2026-07-01', '2026-07-04') === 3);
    check('same day = 0 nights', nb('2026-07-01', '2026-07-01') === 0);
}

console.log('\n== 6. Structural integrity (raw HTML) ==');
// 6a. Every onclick handler references a function that exists (catches deleted/renamed fns).
// The back office lives in admin.js (with facade stubs in app.js), so a handler is
// "defined" if it exists in EITHER file — both are evaluated into the same global
// scope in the browser, and the stubs cover any pre-load click.
const definedFns = new Set([...(appScript + '\n' + adminScript).matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const JS_BUILTINS = new Set(['if', 'for', 'while', 'return', 'event', 'this', 'window', 'document', 'console',
    'alert', 'confirm', 'prompt', 'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
    'parseInt', 'parseFloat', 'location', 'setTimeout', 'true', 'false', 'null', 'undefined', 'typeof', 'new']);
const calledInOnclick = new Set();
for (const m of html.matchAll(/\bon(?:click|change|input|keydown)\s*=\s*"([^"]*)"/g)) {
    // Match bare function calls only — skip member calls like el.remove() / location.reload().
    for (const c of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calledInOnclick.add(c[1]);
}
const missing = [...calledInOnclick].filter(n => !definedFns.has(n) && !JS_BUILTINS.has(n));
check('every inline handler maps to a defined function' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);

// 6a-ii. unsafe-inline migration RATCHET. The whole front end is now migrated off
// inline on* handlers to CSP-clean data-act delegation (app.js chbDelegate), and
// script-src no longer carries 'unsafe-inline' — so ANY inline event-handler
// attribute reintroduced ANYWHERE (index.html markup OR an app.js/admin.js/
// guest-app.js innerHTML template) would be silently DEAD in the browser. Ceiling
// is 0 across all four; add handlers via data-act / chbAttrs only.
const INLINE_ATTR_RE = /\son[a-z]+\s*=\s*["'`]/g;
const inlineSources = { 'index.html': html, 'app.js': appScript, 'admin.js': adminScript };
try { inlineSources['guest-app.js'] = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'guest-app.js'), 'utf8'); } catch (e) {}
const inlineOffenders = Object.entries(inlineSources)
    .map(([f, src]) => [f, (src.match(INLINE_ATTR_RE) || []).length])
    .filter(([, n]) => n > 0);
check('no inline on* handlers anywhere (migration ratchet)' + (inlineOffenders.length ? ' — ' + inlineOffenders.map(([f, n]) => `${f}:${n}`).join(', ') : ''), inlineOffenders.length === 0);

// 6a-ii-b. The CSP must NOT reintroduce script-src 'unsafe-inline' (the migration's
// whole point). Parse the script-src directive out of htaccess.txt and assert it's
// gone; a regression here re-opens the XSS gap the delegation work closed.
try {
    const ht = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'htaccess.txt'), 'utf8');
    const csp = (ht.match(/Content-Security-Policy "([^"]*)"/) || [])[1] || '';
    const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
    check("CSP script-src has dropped 'unsafe-inline'" + (scriptSrc.includes("'unsafe-inline'") ? ' (still present!)' : ''), scriptSrc !== '' && !scriptSrc.includes("'unsafe-inline'"));
    // The ONE allowed inline <script> (the anti-FOUC theme boot) is whitelisted by
    // a sha256 hash in script-src. If its body is edited without re-hashing, it'd be
    // silently BLOCKED under CSP — so assert the live hash is in the policy.
    const boot = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
    if (boot) {
        const h = "'sha256-" + require('crypto').createHash('sha256').update(boot, 'utf8').digest('base64') + "'";
        check('inline theme-boot script hash is whitelisted in the CSP' + (scriptSrc.includes(h) ? '' : ' (expected ' + h + ')'), scriptSrc.includes(h));
    }
    // The Square SDK loads its card-field typeface from its own CloudFront
    // distribution (NOT squarecdn) — without this exact host in font-src every
    // guest on the pay page fires a "CSP blocked font-src" report.
    const fontSrc = (csp.match(/font-src[^;]*/) || [''])[0];
    check("CSP font-src allows Square's font CDN (d1g145x70srn7h.cloudfront.net)", fontSrc.includes('https://d1g145x70srn7h.cloudfront.net'));
    check('CSP never wildcards cloudfront (only the pinned Square host)', !csp.includes('*.cloudfront.net'));
} catch (e) { check('CSP script-src check ran (' + e.message + ')', false); }

// 6a-iii. Every data-act* value resolves to a registered chbAct() action OR a global
// function (the window-fallback path in chbRunAct). A typo'd data-act would silently
// do nothing in the browser — this catches it. data-view etc. are params, not actions.
const registeredActs = new Set([...appScript.matchAll(/chbAct\('([^']+)'/g)].map(m => m[1]));
const actValues = new Set();
// index.html static attrs + the static data-act literals emitted by app.js/admin.js
// innerHTML templates (skip ${...}-interpolated names — resolved at runtime).
for (const src of [html, appScript, adminScript]) {
    for (const m of src.matchAll(/\bdata-act(?:-[a-z]+)?\s*=\s*["']([^"'${]+)["']/g)) {
        if (m[1]) actValues.add(m[1]);
    }
}
const unresolvedActs = [...actValues].filter(n => !registeredActs.has(n) && !definedFns.has(n));
check('every data-act* value resolves to an action or global fn' + (unresolvedActs.length ? ' (unresolved: ' + unresolvedActs.join(', ') + ')' : ''), unresolvedActs.length === 0);

// 6b. No duplicate element ids (ignore JS template-literal ids like id="x-${k}")
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter(id => !id.includes('${'));
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
check('no duplicate element ids' + (dupes.length ? ' (dupes: ' + [...new Set(dupes)].join(', ') + ')' : ''), dupes.length === 0);

// 6c. Build stamp present and well-formed.
check('build stamp present (const BUILD = \'xxxxxxxx\')', /const BUILD = '[a-z0-9]{6,}';/.test(appScript));

// 6c-ii. Service-worker precache ?v= versions must match index.html's, so a
// half-bump can't make the SW precache a stale asset (silent regression).
try {
    const sw = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'sw.js'), 'utf8');
    const drift = [];
    ['app.css', 'app.js', 'guest-app.css', 'guest-app.js'].forEach(a => {
        const re = new RegExp('(?<![-\\w])' + a.replace('.', '\\.') + '\\?v=(\\d+)');
        const inHtml = (html.match(re) || [])[1];
        const inSw = (sw.match(re) || [])[1];
        if (inHtml !== inSw) drift.push(`${a} (index.html v${inHtml} vs sw.js v${inSw})`);
    });
    check('sw.js precache ?v= matches index.html' + (drift.length ? ' — drift: ' + drift.join(', ') : ''), drift.length === 0);
    // admin.js is owner-only and loaded on demand — precaching it would make every
    // guest download the back office and defeat the split.
    check('admin.js is NOT in the sw.js CORE precache list', !/CORE = \[[^\]]*admin\.js/.test(sw));
    // admin.css is the same story: owner-only, injected by ensureAdminCss on
    // bundle load — it must NOT be precached, and app.js must actually inject it.
    check('admin.css is NOT in the sw.js CORE precache list', !/CORE = \[[^\]]*admin\.css/.test(sw));
    check('app.js injects admin.css via ensureAdminCss', /ensureAdminCss/.test(appScript) && /admin\.css\?v=/.test(appScript));
} catch (e) { check('sw.js precache version check ran (' + e.message + ')', false); }

// 6c-iii. Migration naming convention: NEW migrations must be
// migration-NNN-<slug>.sql (NNN ≥ 100, applied after all legacy files by
// migrate.php's migration_sort — see test-migrate.php). The legacy names below
// are FROZEN: never add to this list, never rename them (the ledger + live
// databases key off the filenames).
try {
    const LEGACY_MIGRATIONS = new Set(['accommodations', 'activity-log', 'activity-severity', 'admin-2fa', 'admin-passkeys', 'analytics-v2', 'analytics-v3', 'analytics-v4', 'damage-hold', 'damages-deposit', 'deposit-recovery', 'direct-leads', 'enquiry-nudge', 'enquiry-soft-decline', 'expenses', 'expenses2', 'expenses3', 'experiences-blakeney', 'experiences', 'guest-address', 'guest-photos', 'guest-postcode', 'guest-registrations', 'guest-reviews', 'ical', 'lastmin', 'login-throttle', 'mail-sent', 'messages', 'messaging-threads', 'messaging-threads2', 'newsletter', 'pageviews', 'passkeys', 'payment-reminders', 'payment-schedule', 'pre-arrival', 'price-override', 'push', 'push2-admin', 'review-request', 'seasons', 'smart-pricing', 'sms-optin', 'square-payments', 'square-payments2', 'terms', 'tide-cache', 'tide-push', 'waitlist', 'zz-experience-photos', 'zz3-content-no-dogs', 'zz4-drop-push-columns', 'zz5-chat-attachment', 'zz6-chat-typing', 'zz7-messages-thread-index', 'zz8-payment-damages-kind', 'zz9-clean-webview-noise', 'zz9a-payment-lifecycle', 'zz9b-payment-snapshot', 'zza-clean-ios-webview-noise', 'zzb-unlisted', 'zzc-enquiry-drafts', 'zzd-magic-single-use']);
    const badMigrations = fs.readdirSync(path.dirname(HTML_PATH))
        .filter(f => /^migration-.*\.sql$/.test(f))
        .filter(f => !LEGACY_MIGRATIONS.has(f.replace(/^migration-/, '').replace(/\.sql$/, '')))
        .filter(f => !/^migration-[1-9]\d{2,}-[a-z0-9][a-z0-9-]*\.sql$/.test(f));
    check('new migrations follow migration-NNN-<slug>.sql (NNN ≥ 100)' + (badMigrations.length ? ' — rename: ' + badMigrations.join(', ') : ''), badMigrations.length === 0);
} catch (e) { check('migration naming check ran (' + e.message + ')', false); }

// 6d. JSON-LD structured data parses.
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let ldOk = false; try { if (ld) { JSON.parse(ld[1]); ldOk = true; } } catch (e) {}
check('JSON-LD structured data is valid JSON', ldOk);

// 6e. CSS braces balanced. The bulk of the CSS now lives in app.css (extracted
// from the old inline <style>); fall back to an inline <style> if present.
let cssText = '';
const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/);
if (inlineStyle) cssText = inlineStyle[1];
else { try { cssText = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'app.css'), 'utf8'); } catch (e) {} }
const braceBal = cssText ? (cssText.split('{').length - cssText.split('}').length) : 1;
check('CSS braces balanced (app.css)', braceBal === 0);

// 6f. Viewport has cover (landscape fix should not regress).
check('viewport-fit=cover present', /viewport-fit=cover/.test(html));

// 6g. cottage.php (server-rendered /cottages/<slug> SEO) injects into these exact
// markup anchors. If a redesign moves one, cottage.php silently degrades to the
// plain shell — this catches that so the anchor (or cottage.php) gets updated.
{
    const anchors = [
        /<title>.*?<\/title>/s,
        /<meta name="description" content="[^"]*"/,
        /<link rel="canonical" href="[^"]*"/,
        /<meta property="og:title" content="[^"]*"/,
        /<meta property="og:description" content="[^"]*"/,
        /<meta property="og:url" content="[^"]*"/,
        /<meta name="twitter:title" content="[^"]*"/,
        /<meta name="twitter:description" content="[^"]*"/,
        /<meta property="og:image:alt" content="[^"]*"/,
        /<meta name="twitter:image:alt" content="[^"]*"/,
        /<h1 class="section-title prop-h1" id="prop-title"><\/h1>/,
        /<p class="prop-subtitle" id="prop-subtitle"><\/p>/,
        /id="prop-desc"><\/p>/,
    ];
    const lost = anchors.filter(re => !re.test(html));
    check('cottage.php SEO injection anchors all present in index.html' + (lost.length ? ' (' + lost.length + ' missing)' : ''), lost.length === 0);
}

// 6h. home.php injects the LIVE hero into these exact anchors (the static
// hero.jpg doesn't exist on the live host). Same deal as 6g: if a redesign
// moves one, update home.php alongside it.
{
    const anchors = [
        /<link rel="preload" as="image" href="hero\.jpg" fetchpriority="high">/,
        /https:\/\/cottageholidaysblakeney\.co\.uk\/hero\.jpg/,
        /data-edit-img="hero-bg" style="background-image: url\('hero\.jpg'\);"/,
        /<meta property="og:image" content="[^"]*"/,
        /<meta name="twitter:image" content="[^"]*"/,
        // experiences-page.php renders the published list into this (empty) grid:
        /<div id="exp-grid" class="grid grid-3" style="margin-top:18px;"><\/div>/,
        // cottage.php injects each cottage's aggregateRating after its node id:
        /"@id": "https:\/\/cottageholidaysblakeney\.co\.uk\/#cottage-21a",/,
    ];
    const lost = anchors.filter(re => !re.test(html));
    check('server-render injection anchors all present in index.html' + (lost.length ? ' (' + lost.length + ' missing)' : ''), lost.length === 0);
}

console.log('\n== 9. Damage-deposit accounting (damageHeld) ==');
{
    const dh = get('damageHeld');
    if (typeof dh !== 'function') {
        fail('damageHeld is not defined');
    } else {
        // agreedPrice with the current (hold) model: total is RENTAL ONLY, deposit separate.
        const ap = (over) => ({ total: 480, rentalTotal: 480, damagesDeposit: 75, ...(over || {}) });
        // 1) Hold-model booking, fully paid: deposit is a Square hold → nothing in the ledger.
        check('hold-model fully-paid → £0 held (no phantom deposit)',
            dh('21a', { agreedPrice: ap(), depositPaid: 480, payment: 'paid', holdStatus: 'authorized', dbId: 1 }).held === 0);
        // 2) No hold placed, fully paid the rental → still nothing collected as deposit.
        check('no-hold fully-paid rental → £0 held',
            dh('21a', { agreedPrice: ap(), depositPaid: 480, payment: 'paid', holdStatus: 'none', dbId: 2 }).held === 0);
        // 3) Legacy booking: total INCLUDED the deposit, guest paid rental+deposit → deposit is held.
        check('legacy paid rental+deposit → full deposit held',
            dh('21a', { agreedPrice: { total: 555, rentalTotal: 480, damagesDeposit: 75 }, depositPaid: 555, payment: 'paid', holdStatus: 'none', dbId: 3 }).held === 75);
        // 4) Legacy, only the rental paid so far → no deposit collected yet.
        check('legacy rental-only paid → £0 held',
            dh('21a', { agreedPrice: { total: 555, rentalTotal: 480, damagesDeposit: 75 }, depositPaid: 480, payment: 'deposit', holdStatus: 'none', dbId: 4 }).held === 0);
    }
}

console.log('\n== 10. Design-system & recent-fix contracts ==');
{
    // Liquid Glass MATERIAL (Apple iOS 26 / Tahoe): the primitive must lift
    // saturation (not a flat frost) and carry the specular edge, and every glass
    // surface must build from the tokens — so a redesign can't silently drop the look.
    check('--glass-filter token lifts saturation (app.css)', /--glass-filter:\s*blur\([^;]*saturate/.test(cssText));
    check('--glass-rim specular-edge token defined', /--glass-rim:\s*inset/.test(cssText));
    const gp = cssText.match(/\.glass-panel\s*\{[^}]*\}/);
    check('.glass-panel uses var(--glass-filter)', !!gp && /var\(--glass-filter\)/.test(gp[0]));
    check('.glass-panel uses var(--glass-rim)', !!gp && /var\(--glass-rim\)/.test(gp[0]));
    check('.btn-glass carries the specular rim', /\.btn-glass\s*\{[^}]*var\(--glass-rim\)/.test(cssText));

    // Perf: the hero is a one-shot settle, never a perpetual drift (that made the
    // frosted panels re-blur every frame while idle — the mobile GPU/battery fix).
    check('hero drift is not infinite (perf regression guard)', !/heroDrift[^;{]*infinite/.test(cssText));

    // SEO: the footer carries REAL crawlable /cottages/ links, rebuilt from the
    // live list, with the SPA-nav helpers that keep them clickable in-app.
    check('footer has real /cottages/ crawlable links', /href="\/cottages\//.test(html));
    check('renderFooterCottages defined (live footer links)', /function renderFooterCottages\b/.test(appScript));
    check('routeLink defined (footer SPA nav)', /function routeLink\b/.test(appScript));

    // SCA (3-D Secure) contract: UK banks decline card charges made without
    // buyer verification (CARD_DECLINED_VERIFICATION_REQUIRED, seen live), so
    // the card tokenize MUST pass verification details, and those details must
    // carry the amount/intent Square needs to run the bank check.
    check('card tokenize passes SCA verification details', /squareCard\.tokenize\(payVerificationDetails\(\)\)/.test(appScript));
    const pvd = get('payVerificationDetails');
    if (typeof pvd !== 'function') { fail('payVerificationDetails is not defined'); }
    else {
        // payState is a top-level const (lexical, not on the vm global) — set it
        // from inside the context, exactly as page code would.
        vm.runInContext("payState.amountDue = 556.2; payState.guestName = 'Richard Berry';", ctx);
        const vd = pvd();
        check('SCA details: amount matches the charge (556.20)', vd.amount === '556.20');
        check('SCA details: intent CHARGE + GBP + customer-initiated', vd.intent === 'CHARGE' && vd.currencyCode === 'GBP' && vd.customerInitiated === true);
        check('SCA details: billing contact carries the guest name + GB', vd.billingContact && vd.billingContact.givenName === 'Richard' && vd.billingContact.familyName === 'Berry' && vd.billingContact.countryCode === 'GB');
    }
    // 3DS bank iframes come from unpredictable issuer domains — the CSP must
    // allow any https: frame or the verification times out (seen live). blob: is
    // also allowed so iOS Safari's frame-src fallback for the encoder's blob
    // Worker doesn't block it (worker-src blob: covers spec-compliant browsers).
    try {
        const ht = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'htaccess.txt'), 'utf8');
        const frameSrc = (ht.match(/frame-src ([^;]*);/) || [''])[0];
        check('CSP frame-src allows https: (3DS issuer iframes)', /\bhttps:/.test(frameSrc));
        check('CSP frame-src allows blob: (iOS Safari worker fallback)', /\bblob:/.test(frameSrc));
    } catch (e) { fail('htaccess.txt unreadable for CSP check'); }

    // Invoice deposit status: the guest invoice must state the refundable deposit
    // was PAID and, after checkout, REFUNDED (per the charge-upfront model).
    const dis = get('depositInvoiceStatus');
    if (typeof dis !== 'function') { fail('depositInvoiceStatus is not defined'); }
    else {
        check('deposit charged → "Paid … refunded after your stay"', /Paid.*refunded in full after your stay/i.test(dis(75, 'charged', 0, '')));
        // The caller passes a DD/MM/YYYY date (fmtDate at the invoice call site) —
        // the on-screen/PDF invoice must never show an ISO date.
        check('deposit returned → "Refunded in full on <DD/MM/YYYY>"', dis(75, 'returned', 75, '18/07/2026') === 'Refunded in full on 18/07/2026.');
        check('deposit fully returned while still charged → refunded', /Refunded in full/i.test(dis(75, 'charged', 75, '')));
        check('deposit partially returned → "£X of £Y refunded"', /£40\.00 of £75\.00 refunded/.test(dis(75, 'charged', 40, '')));
        check('deposit kept → "Retained … for damage"', /Retained.*damage/i.test(dis(75, 'kept', 0, '')));
        check('legacy hold → "Held on your card"', /Held on your card/i.test(dis(75, 'authorized', 0, '')));
        check('no deposit → empty status', dis(0, 'none', 0, '') === '');
    }
}

// ---------- §8: stylesheet structural integrity ----------
// A mangled edit once left an UNTERMINATED /* comment that silently swallowed
// the following rules until the next */ (the browser drops them without any
// error). Walk each stylesheet honouring comments: every /* must close, and
// braces must balance OUTSIDE comments — so a truncated comment or a stray
// brace fails CI instead of shipping invisible style loss.
console.log('\n== 8. Stylesheet integrity ==');
for (const cssFile of ['app.css', 'guest-app.css']) {
    const css = fs.readFileSync(path.join(__dirname, cssFile), 'utf8');
    let inComment = false;
    let depth = 0;
    let bad = '';
    for (let i = 0; i < css.length; i++) {
        if (inComment) {
            if (css[i] === '*' && css[i + 1] === '/') { inComment = false; i++; }
        } else if (css[i] === '/' && css[i + 1] === '*') {
            inComment = true; i++;
        } else if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth < 0) { bad = 'stray } at index ' + i; break; } }
    }
    if (!bad && inComment) bad = 'unterminated /* comment';
    if (!bad && depth !== 0) bad = 'unbalanced braces (depth ' + depth + ' at EOF)';
    check(cssFile + ' parses cleanly (comments closed, braces balanced)', !bad, bad);
}

// ---------- §9: locked-price guard ----------
// A confirmed booking's price is LOCKED at its agreed snapshot. Rendering a
// booking with a live priceBreakdown() call once leaked today's rates into a
// guest email (£679.80 instead of the agreed £556.20). Structural rule: any
// priceBreakdown() call fed a BOOKING object's fields (b.adults / booking.adults)
// must sit behind an agreedPrice check within a few lines above. Quote/enquiry
// contexts (plain adults, e.adults, enq.adults) are exempt — nothing is locked
// there. PHP has the mirror guard in test-pricing.php.
console.log('\n== 9. Locked-price guard (agreedPrice-first) ==');
for (const [name, src] of [['app.js', appScript], ['admin.js', adminScript]]) {
    const lines = src.split('\n');
    const offenders = [];
    lines.forEach((line, i) => {
        if (!/priceBreakdown\s*\(/.test(line)) return;
        // The call's arguments may wrap onto following lines.
        const callText = lines.slice(i, i + 8).join('\n');
        if (!/\b(?:b|booking)\s*\.\s*adults\b/.test(callText)) return; // not a booking object
        const before = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
        if (!/agreedPrice/.test(before)) offenders.push(name + ':' + (i + 1));
    });
    check(
        name + ': every booking-fed priceBreakdown() is agreedPrice-first' +
            (offenders.length ? ' — use `b.agreedPrice || priceBreakdown(...)` at ' + offenders.join(', ') : ''),
        offenders.length === 0,
    );
}
// The edit modal must keep its locked-price branch (agreed figures + note while
// the stay is unchanged; live reprice only once it genuinely changes).
check('updateModalPrice keeps the locked-price branch', /locked at the rates in effect when booked/.test(appScript));
check('updateModalPrice keeps the replaces-the-agreed reprice note', /saving replaces the agreed/.test(appScript));

// ---- Guest FAQ assistant: a TYPED guest question is answered on-device from the
// cottage's own FAQ content; anything unrelated returns null (→ reaches a person).
if (typeof get('guestFaqAnswer') === 'function') {
    vm.runInContext(`
        siteContent['faqs-jollyboat'] = [
          { q: 'Are dogs welcome?', a: 'Yes — up to two well-behaved dogs stay free of charge.' },
          { q: 'Is there a cot?', a: 'A travel cot and high-chair are in the utility cupboard.' }
        ];
        propertyMeta.jollyboat = { name: 'Jollyboat' };
        activeFrontProperty = 'jollyboat';
    `, ctx);
    const faq = get('guestFaqAnswer');
    const dog = faq('can I bring my dog?');
    check('guest FAQ answers a typed question from cottage content (dog → dogs FAQ)', !!dog && /dogs stay free/.test(dog.a), dog ? dog.q : 'null');
    const cot = faq('do you have a cot for the baby');
    check('guest FAQ matches on synonyms (baby → cot FAQ)', !!cot && /cot/i.test(cot.q), cot ? cot.q : 'null');
    const park = faq('where can I park the car');
    check('guest FAQ answers a built-in topic (parking)', !!park && /park/i.test(park.q + ' ' + park.a), park ? park.q : 'null');
    check('guest FAQ returns null for an unrelated question (→ owner)', faq('what is the airspeed of a swallow') === null);
    check('guest FAQ ignores a bare greeting', faq('hi there') === null);
}

// ---- Payments ledger: a refund the owner has issued reads "Completed" (not a
// scary "Pending" while Square settles); an explicit failure still shows "Failed";
// card-in rows keep Square's live status.
if (typeof get('paymentStatusLabel') === 'function') {
    const psl = get('paymentStatusLabel');
    check('refund PENDING → Completed', psl('refund', 'PENDING') === 'Completed');
    check('deposit-return PENDING → Completed', psl('damages_return', 'PENDING') === 'Completed');
    check('manually-returned deposit → Completed', psl('damages_return', 'MANUAL') === 'Completed');
    check('refund FAILED → Failed', psl('refund', 'FAILED') === 'Failed');
    check('refund REJECTED → Failed', psl('refund', 'REJECTED') === 'Failed');
    check('card-in balance keeps Square status', psl('balance', 'COMPLETED') === 'COMPLETED');
    check('card-in deposit not-yet-settled stays truthful', psl('deposit', 'PENDING') === 'PENDING');
}
// Traffic-light status dots: green (done) / amber (in-progress) / red (problem),
// with a Title-cased word carried as the label (never colour-only).
if (typeof get('paymentStatusMeta') === 'function') {
    const psm = get('paymentStatusMeta');
    check('issued refund → green dot (ok) labelled Completed', psm('refund', 'PENDING').level === 'ok' && psm('refund', 'PENDING').label === 'Completed');
    check('failed refund → red dot (bad) labelled Failed', psm('refund', 'FAILED').level === 'bad' && psm('refund', 'FAILED').label === 'Failed');
    check('card-in completed → green dot', psm('balance', 'COMPLETED').level === 'ok');
    check('card-in pending → amber dot', psm('deposit', 'PENDING').level === 'wait' && psm('deposit', 'PENDING').label === 'Pending');
}

// ---- Guest-side learning: only QUESTION-shaped unanswered chat is captured for
// the owner (guestQuestionShaped), so greetings/one-word messages aren't logged.
if (typeof get('guestQuestionShaped') === 'function') {
    const qs = get('guestQuestionShaped');
    check('question-shaped capture: a "how" question is captured', qs('how do I get to the cottage') === true);
    check('question-shaped capture: a trailing "?" is captured', qs('parking nearby?') === true);
    check('question-shaped capture: a bare greeting is not captured', qs('hi there') === false);
    check('question-shaped capture: a too-short message is not captured', qs('cot') === false);
}

console.log('\n== Summary ==');
if (failures === 0) { console.log('  ALL CHECKS PASSED ✅\n'); process.exit(0); }
console.log('  ' + failures + ' CHECK(S) FAILED ❌\n'); process.exit(1);
