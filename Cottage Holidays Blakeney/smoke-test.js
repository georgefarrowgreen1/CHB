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

console.log('\n== 2. Pricing engine (priceBreakdown) ==');
const pb = get('priceBreakdown');
if (typeof pb !== 'function') {
    fail('priceBreakdown is not defined');
} else {
    // 21A: couple 130, txn 3%, deposit 75. 3 nights, 2 adults, 0 children, no season.
    const p = pb('21a', 2, 0, '2026-07-01', '2026-07-04');
    check('3-night stay => nights = 3', p.nights === 3);
    check('nightly = 390 (3 x 130)', approx(p.nightly, 390));
    check('per-night = 130', approx(p.perNight, 130));
    check('transaction fee = 11.70 (3% of 390)', approx(p.txFee, 11.7));
    check('damages deposit = 75 (charged with first payment, not in rental total)', approx(p.damagesDeposit, 75));
    check('total = 401.70 (390 + 11.70; deposit charged separately, refunded after stay)', approx(p.total, 401.7));
    // Extra adult should add the extra-adult rate per night (pimpernel allows 3).
    const p2 = pb('pimpernel', 3, 0, '2026-07-01', '2026-07-03'); // 2 nights, 1 extra adult @ 42
    check('extra adult adds 42/night (pimpernel 2 nights)', approx(p2.nightly, (120 + 42) * 2));
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
} catch (e) { check('sw.js precache version check ran (' + e.message + ')', false); }

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
    // allow any https: frame or the verification times out (seen live).
    try {
        const ht = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'htaccess.txt'), 'utf8');
        check('CSP frame-src allows https: (3DS issuer iframes)', /frame-src https:;/.test(ht));
    } catch (e) { fail('htaccess.txt unreadable for CSP check'); }

    // Invoice deposit status: the guest invoice must state the refundable deposit
    // was PAID and, after checkout, REFUNDED (per the charge-upfront model).
    const dis = get('depositInvoiceStatus');
    if (typeof dis !== 'function') { fail('depositInvoiceStatus is not defined'); }
    else {
        check('deposit charged → "Paid … refunded after your stay"', /Paid.*refunded in full after your stay/i.test(dis(75, 'charged', 0, '')));
        check('deposit returned → "Refunded in full on <date>"', dis(75, 'returned', 75, '2026-07-18') === 'Refunded in full on 2026-07-18.');
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

console.log('\n== Summary ==');
if (failures === 0) { console.log('  ALL CHECKS PASSED ✅\n'); process.exit(0); }
console.log('  ' + failures + ' CHECK(S) FAILED ❌\n'); process.exit(1);
