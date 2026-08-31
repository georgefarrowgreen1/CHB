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
// Work that cannot be synchronous (downloadInvoice awaits ensureJsPdf, so its
// continuation lands on a microtask). The summary at the foot waits for these.
const pendingChecks = [];
const pass = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failures++; console.log('  ✗ ' + m); };
// The third argument is the DETAIL, printed only on failure. It was silently
// discarded, so every `check(name, cond, why)` in this file — and there are many
// — failed with no reason attached: CI reported "the program is token-for-token
// identical ✗" and nothing else, when the cause was simply that typescript was
// not installed yet. A failure that does not say why costs more than the check saves.
function check(name, cond, detail) {
    if (cond) { pass(name); return; }
    fail(name + (detail ? ' — ' + String(detail).slice(0, 200) : ''));
}
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
// The back-office MARKUP lives in admin-views.html (split out of index.html so
// guests never download it). It is injected into index.html's empty view shells
// at runtime, so for every markup gate below it counts as part of the page —
// scan the two TOGETHER or the data-act / inline-handler / duplicate-id checks
// would silently stop covering ~40% of the app's markup.
let adminViews = '';
try { adminViews = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'admin-views.html'), 'utf8'); } catch (e) {}
check('admin-views.html present (the back-office markup bundle)', adminViews.length > 1000);
const markup = html + '\n' + adminViews;
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
// Availability chip — the strongest claim is "Available from tomorrow": under
// the book-by-the-night-before rule tonight can never start a new stay, so
// "Available now" would promise a night the enquiry form then refuses (the
// same contradiction the old 2-day grace window was, from the other side).
// A later gap says "Available from <date>".
const chip = get('availChipHtml');
const fg = get('freeGaps');
if (typeof chip !== 'function' || typeof fg !== 'function') { fail('availChipHtml / freeGaps not defined'); }
else {
    check('chip: gap starting tomorrow → "Available from tomorrow", never "now"',
        /Available from tomorrow/.test(chip('2026-07-12', '2026-07-12')) && !/Available now/.test(chip('2026-07-12', '2026-07-12')));
    check('chip: gap starting in 2 days → "Available from <date>"',
        /Available from/.test(chip('2026-07-13', '2026-07-12')) && !/tomorrow/.test(chip('2026-07-13', '2026-07-12')));
    check('chip: "Available now" is nowhere in the composer (the night-before rule)',
        !/Available now/.test(String(chip)));
    // freeGaps semantics: end-exclusive blocks, minNights honoured — and the
    // scan starts TOMORROW, so an all-free calendar's first offer is tomorrow.
    const td = get('todayDashed')();
    const plus = (n) => { const d = get('dpParse')(td); d.setDate(d.getDate() + n); return get('formatDashed')(d); };
    check('freeGaps: an empty calendar offers tomorrow, not tonight',
        (fg([], 5, 1)[0] || {}).start === plus(1));
    const gaps = fg([{ start: td, end: plus(3) }, { start: plus(5), end: plus(9) }], 14, 2);
    check('freeGaps: first gap starts when the block ends (checkout day free)', gaps.length > 0 && gaps[0].start === plus(3));
    check('freeGaps: 2-night hole kept at minNights 2', gaps.length > 0 && gaps[0].nights === 2);
    const gaps3 = fg([{ start: td, end: plus(3) }, { start: plus(5), end: plus(9) }], 14, 3);
    check('freeGaps: 2-night hole skipped at minNights 3', gaps3.length > 0 && gaps3[0].start === plus(9));
}
// dpCheckinFits: a free check-in night must have minNights of consecutive free
// nights, else the picker blocks it out (a 1-night hole can't start a 2-night stay).
const fits = get('dpCheckinFits');
if (typeof fits !== 'function') { fail('dpCheckinFits not defined'); }
else {
    // Bookings 15-17 (nights 15,16) and 18-20 (nights 18,19) leave night 17 as a lone gap.
    // activeFrontProperty / propertyAvailability are lexical lets — set inside the context.
    vm.runInContext(`activeFrontProperty = '21a'; propertyAvailability = { '21a': [{ start: '2026-07-15', end: '2026-07-17' }, { start: '2026-07-18', end: '2026-07-20' }] };`, ctx);
    const at = (d, n) => fits(new Date(d), n);
    check('dpCheckinFits: lone 1-night gap fails minNights 2 (blocked)', at('2026-07-17T00:00:00', 2) === false);
    check('dpCheckinFits: same gap is fine at minNights 1', at('2026-07-17T00:00:00', 1) === true);
    check('dpCheckinFits: an open run passes minNights 2', at('2026-07-20T00:00:00', 2) === true);
    check('dpCheckinFits: a booked night fails', at('2026-07-16T00:00:00', 2) === false);
}

console.log('\n== 3. UK postcode validation ==');
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
// ukShiftDays: the ONE way to move a YYYY-MM-DD by whole days. It replaces the
// local-setDate()-through-toISOString() pattern, which mixes two clocks and is a
// day out between 00:00 and 01:00 BST — a silent off-by-one that only shows for
// one hour a night, i.e. never on the day you test it. Anchored at UTC NOON so
// the DST hour cannot move the calendar date.
const usd = get('ukShiftDays');
if (typeof usd !== 'function') { fail('ukShiftDays is not defined'); }
else {
    check('shifts back a week', usd('2026-07-28', -7) === '2026-07-21');
    check('crosses the spring DST boundary', usd('2026-03-29', 1) === '2026-03-30');
    check('crosses the autumn DST boundary', usd('2026-10-25', 1) === '2026-10-26');
    check('crosses a year end backwards', usd('2026-01-01', -1) === '2025-12-31');
    check('lands on a leap day', usd('2024-02-28', 1) === '2024-02-29');
    check('zero is a no-op', usd('2026-07-28', 0) === '2026-07-28');
    check('garbage in comes back unchanged, not Invalid Date', usd('not-a-date', 3) === 'not-a-date');
}

// A CHILD IS UNDER 16, AND THREE FILES HAVE TO AGREE ABOUT IT. The guest picks a
// number of children (index.html), pricing applies childRate to it (app.js), and
// guest-details.php registers the booking's ADULTS as "everyone staying who is 16
// or over" while never counting children — so the boundary decides who appears on
// a register the Immigration (Hotel Records) Order 1972 requires. None of the
// three used to STATE it, and the guest was left to guess. The numbers are
// extracted and COMPARED rather than each asserted as 16, so moving one without
// the others fails here.
// NB read through the context, not `get()`: a top-level const is a lexical
// binding and never becomes a property of the sandbox (the defaultRates trick
// above, same reason).
{
    const evalIn = (src) => vm.runInContext(src, ctx);
    const cua = evalIn('typeof CHILD_UNDER_AGE !== "undefined" ? CHILD_UNDER_AGE : null');
    const kidBands = [...markup.matchAll(/class="hs-gband">under (\d+)</g)].map((m) => Number(m[1]));
    const adultBands = [...markup.matchAll(/class="hs-gband">(\d+)\+</g)].map((m) => Number(m[1]));
    let regAge = null;
    try {
        const reg = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'guest-details.php'), 'utf8');
        const m = reg.match(/is <strong>(\d+) or over<\/strong>/);
        regAge = m ? Number(m[1]) : null;
    } catch (e) {}
    check('app.js states the age a child is under', cua === 16);

    // ---- CLIENT AND SERVER MUST REFUSE THE SAME STAY -----------------------
    // The booking rules are enforced twice — checkBookingRules in the browser so
    // the guest is told early, and enquiries.php so the public form cannot be
    // bypassed. They read the same rules-<propKey> store, but each carries its
    // OWN DEFAULT for a cottage the owner has never configured, and those two
    // numbers are written in different files with nothing tying them together.
    //
    // This has already bitten once: app.js line ~6930 still carries the note —
    // "`|| 1` let the client offer/price a 1-night stay the server then rejected
    // AFTER the guest filled the whole enquiry form". It was fixed by hand and
    // never gated, so nothing stops it drifting back. The failure is silent on
    // the way in: everything looks fine until a guest reaches the last step.
    let srvMinN = null;
    try {
        const enq = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'enquiries.php'), 'utf8');
        const m = enq.match(/\$defaultRules = \['minNights' => (\d+)/);
        srvMinN = m ? Number(m[1]) : null;
    } catch (e) {}
    const cliMinN = (appScript.match(/minNights: def\.minNights \|\| (\d+)/) || [])[1];
    check(`the server declares a default minimum stay (${srvMinN})`, srvMinN !== null && srvMinN >= 1);
    check(`…and the client synthesises the SAME one for a new cottage (${cliMinN})`,
        cliMinN !== undefined && Number(cliMinN) === srvMinN);
    // The three original cottages are hardcoded rather than synthesised, so they
    // need the same number for the same reason.
    // Every literal `minNights: N` in app.js — the three hardcoded cottages and
    // the synthesised default alike. The count is asserted as well as the
    // values, so a regex that stopped matching cannot pass as "all agree".
    const hardMins = [...appScript.matchAll(/\bminNights: (\d+)\b/g)].map((m) => Number(m[1]));
    check(`…as do the hardcoded cottages (${hardMins.join(', ') || 'none found'})`,
        hardMins.length >= 3 && hardMins.every((n) => n === srvMinN));
    // ---- BOOK BY THE NIGHT BEFORE, AS A MINIMUM ----------------------------
    // The earliest guest check-in is TOMORROW: checkBookingRules refuses a
    // same-day stay (one helper, so the enquiry form, the chat and the flex
    // suggestions all agree) and enquiries.php refuses the direct POST. The two
    // sentences are asserted EQUAL, not merely present — the same-stay/same-
    // refusal discipline the min-nights default above earns the hard way.
    const noticeToday = evalIn(
        `checkBookingRules('jollyboat', todayDashed(), ukShiftDays(todayDashed(), 7))`);
    check('a same-day check-in is refused with the notice rule',
        /day’s notice/.test(noticeToday || ''));
    const noticeTomorrow = evalIn(
        `checkBookingRules('jollyboat', ukShiftDays(todayDashed(), 1), ukShiftDays(todayDashed(), 8))`);
    check('…and tomorrow clears it (the boundary from the other side)', noticeTomorrow === null);
    let enqSrc = '';
    try { enqSrc = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'enquiries.php'), 'utf8'); } catch (e) {}
    let wlSrc = '';
    try { wlSrc = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'waitlist.php'), 'utf8'); } catch (e) {}
    const noticeSentence = /Online bookings need at least a day’s notice[^']*/;
    const cliNotice = (appScript.match(noticeSentence) || [])[0];
    const srvNotice = (enqSrc.match(noticeSentence) || [])[0];
    check('the server states the same refusal, word for word',
        !!cliNotice && !!srvNotice && cliNotice === srvNotice);
    // …and ENFORCES it (assert the wiring, not the ingredient): the sentence
    // must sit inside a guest-only same-day guard, not merely exist as a string.
    check('…from inside a guest-only same-day guard',
        /if \(!\$isAdminEdit && \$checkIn <= date\('Y-m-d'\)\) \{\s*json_out\(\['error' => 'Online bookings need at least a day’s notice/.test(enqSrc));
    // The waitlist is the third holder of the rule: a dated join starting
    // today or earlier could only notify a guest about dates the form refuses.
    const wlNotice = (wlSrc.match(noticeSentence) || [])[0];
    check('…and the waitlist refuses a dated same-day join, same sentence, wired',
        !!wlNotice && wlNotice === cliNotice &&
        /if \(\$ci && \$ci <= date\('Y-m-d'\)\) \{\s*json_out\(\['error' => 'Online bookings need at least a day’s notice/.test(wlSrc));
    // Both pickers the guest decides at — the hero search and the enquiry form.
    check(`both guest pickers band their children (${kidBands.length} found)`, kidBands.length === 2);
    check(`…and their adults (${adultBands.length} found)`, adultBands.length === 2);
    check('the register states the age it collects from', regAge === 16);
    check('every one of them means the SAME age',
        cua != null && regAge != null && kidBands.length > 0 && adultBands.length > 0 &&
        kidBands.every((n) => n === cua) && adultBands.every((n) => n === cua) && regAge === cua);
    // …and the hint printed beneath the enquiry pickers agrees, pluralised: it
    // used to read "max 2 adults, 2 child".
    const hint = (a, c, t) => evalIn(
        `occupancyLimits.__kidtest = { maxAdults: ${a}, maxChildren: ${c}, maxTotal: ${t} }; occupancyHint('__kidtest')`);
    check('the occupancy hint names the band', /2 children under 16/.test(hint(2, 2, 4)));
    check('…and reads "1 child under 16", not "1 children"', /1 child under 16/.test(hint(2, 1, 3)));
    check('an adults-only cottage names no band at all', hint(2, 0, 2) === 'Sleeps up to 2 adults.');
    evalIn('delete occupancyLimits.__kidtest');
}

// A CUSTOM PRICE RENDERS AS ONE COHERENT LINE. price_override swaps
// agreedPrice.total to the agreed figure while perNight/nightly/txFee stay the
// standard snapshot (mapBookingFromApi), so My Stays, the PDF and the emailed
// confirmation all printed "£130.00 × 7 nights: £910.00 … Total £750.00" — lines
// that cannot add up to their own total, on the guest's own documents (reported
// with a screenshot). priceIsCustom is the ONE decision (PHP mirror:
// booking_price_is_custom, gated in test-payrail); this drives the REAL renderer.
{
    const evalIn = (src) => vm.runInContext(src, ctx);
    const custom = (p) => evalIn(`priceIsCustom(${JSON.stringify(p)})`);
    const std = { perNight: 130, nights: 7, nightly: 910, transactionPct: 0, txFee: 0, total: 910, damagesDeposit: 50 };
    const ovr = Object.assign({}, std, { total: 700, isOverride: true });
    check('a coherent snapshot is not custom', custom(std) === false);
    check('an override total the lines cannot reach is', custom(ovr) === true);
    check('partial price data (a total alone) is not custom — the skip-guards own that case',
        custom({ total: 700 }) === false);
    const box = (p, dep, total) => evalIn(
        `guestPriceBoxHtml(${JSON.stringify(p)}, { dep: ${dep}, total: ${total} })`);
    const stdBox = box(std, 50, 960);
    check('a standard booking keeps its per-night and fee lines',
        /£130\.00 × 7 nights/.test(stdBox) && /Transaction fee \(0%\)/.test(stdBox));
    const ovrBox = box(ovr, 50, 750);
    check('a custom-priced booking says so in one line',
        /Agreed price for your stay \(7 nights\)/.test(ovrBox) && /£700\.00/.test(ovrBox));
    check('…and the standard-rate maths is GONE, not printed beside it',
        !/× 7 nights/.test(ovrBox) && !/Transaction fee/.test(ovrBox) && !/£910\.00/.test(ovrBox));
    check('…deposit and total still render, so the box still adds up',
        /Refundable damages deposit/.test(ovrBox) && /£750\.00/.test(ovrBox));
    check('…and nothing reads £NaN', !/NaN/.test(ovrBox));
}

// AND A CUSTOM PRICE STILL FOLLOWS THE PAYMENT PROCEDURE. The lines above are
// display; this is the money: deposit-then-balance must be staged off the AGREED
// total, not the standard snapshot beside it. Driven through the REAL row mapper
// (mapBookingFromApi is where the override replaces agreedPrice.total) into the
// REAL paymentSummary/bookingDue — the figures the hub's banner, the ask buttons
// and the journey pipeline all read. The server half is the same shape by
// construction (booking_amount_due and pay.php both resolve price_override before
// the pct/balance maths — gated in test-payrail).
{
    const evalIn = (src) => vm.runInContext(src, ctx);
    const row = (extra) => Object.assign({
        id: 9101, prop_key: 'jollyboat', name: 'Custom Guest', check_in: '2027-05-10',
        check_out: '2027-05-17', adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0,
        agreed_total: 910, agreed_per_night: 130, agreed_nights: 7, agreed_nightly: 910,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_booking_fee: 50, price_override: 700,
    }, extra);
    const ps = (extra) => evalIn(`paymentSummary('jollyboat', mapBookingFromApi(${JSON.stringify(row(extra))}))`);
    const fresh = ps({});
    check('an untouched custom booking owes the AGREED total, not the snapshot',
        fresh.total === 700 && fresh.balance === 700 && !fresh.fullyPaid);
    const part = ps({ payment: 'deposit', deposit_paid: 175 });
    check('a 25% deposit staged off the agreed £700 leaves a £525 balance',
        part.total === 700 && part.balance === 525 && !part.fullyPaid);
    check('paying the agreed £700 settles it — the £910 snapshot is never owed',
        ps({ payment: 'deposit', deposit_paid: 700 }).fullyPaid === true);
    // bookingDue folds the damages deposit exactly as for a standard booking.
    const due = evalIn(`bookingDue('jollyboat', mapBookingFromApi(${JSON.stringify(row({}))}))`);
    check('the owner-facing due figure = agreed £700 + the £50 deposit',
        due.total === 750 && due.balance === 750);

    // A COMPED STAY IS NOT AN UNPRICED ONE — the JS half of the audit finding
    // that booking_amount_due had. There, the rate-card fallback fired on
    // `$total <= 0` and quoted £910 for a stay the owner had set to £0. The JS
    // keys on whether a price is RECORDED (`row.agreed_total != null`, and
    // `p = b.agreedPrice || priceBreakdown(...)` falls back on the object being
    // absent) rather than on the figure being positive — so it was already
    // right. Pinned, because "already right" is one edit from "was right".
    const comp = ps({ agreed_total: 0, price_override: 0, agreed_nightly: 0, agreed_per_night: 0 });
    check('a comped stay owes nothing, not the rate card',
        comp.total === 0 && comp.balance === 0);
    check('...and reads as settled rather than as a debt', comp.fullyPaid === true);
    const compDue = evalIn(`bookingDue('jollyboat', mapBookingFromApi(${JSON.stringify(row({ agreed_total: 0, price_override: 0, agreed_nightly: 0, agreed_per_night: 0 }))}))`);
    // The refundable deposit still rides it: free to stay is not free to damage.
    check('the owner-facing figure is the refundable deposit alone',
        compDue.total === 50 && compDue.balance === 50);
    // The case the fallback genuinely exists for must still work: a legacy row
    // with NO price recorded at all still prices from the live rate card.
    const legacy = ps({ agreed_total: null, price_override: null });
    check('a legacy row with no price still prices from the rate card', legacy.total > 0);
}

// THE REVIEW FORM PROMISES ONLY WHAT reviews.php DELIVERS. `submit` writes
// status='pending' and `set_status` can DECLINE one, so "will appear on our site
// shortly" guaranteed a publication the site does not.
//
// The fresh form used to carry "We read every review before it goes on the site"
// beside Submit, and this asserted it. That line was REMOVED at the owner's ask:
// the composer is a rating and a box, and a caveat beside the button is chrome on
// a two-field form. The moderation fact is not lost — it is stated at the moment
// it becomes true, in the PENDING note below ("goes on the site once we've read
// it"), which is checked here too. What must stay true of the fresh form is the
// original concern, and it is asserted directly: it promises no publication.
{
    const review = (mine) => vm.runInContext(
        `myGuestReviews = ${JSON.stringify(mine)}; guestReviewForm('jollyboat')`, ctx);
    const fresh = review({});
    check('no review yet → no promise that it will be published', !/appear on our site/i.test(fresh));
    check('…nor any other claim about what happens to it', !/\bshortly\b|\bwill be published\b|\bgoes live\b/i.test(fresh));
    check('the button is just "Submit"', />\s*Submit\s*</.test(fresh) && !/Submit review/i.test(fresh));
    // A PENDING REVIEW GETS NO NOTE. It used to say "goes on the site once we've
    // read it"; removed at the owner's ask along with the line beside Submit. What
    // must stay true is that dropping it left no HEADLESS card: the heading was
    // suppressed whenever a note rendered, so keying it on `existing` rather than
    // on the note would have shown a pending guest bare stars and nothing else.
    const pending = review({ jollyboat: { stars: 5, text: 'Lovely', status: 'pending' } });
    check('a pending review carries no note about moderation',
        !/goes on the site|we.ve read it|Thanks for your review/i.test(pending));
    check('…but still gets the heading, so the card is never headless',
        /How was Jollyboat\?/.test(pending));
    check('…and claims nothing about being published', !/appear on our site|\bshortly\b/i.test(pending));
    check('an approved one still says it is live',
        /live on our home page/i.test(review({ jollyboat: { stars: 5, text: 'Lovely', status: 'approved' } })));

    // THE TOAST IS THE ONLY ACKNOWLEDGEMENT LEFT, so it is pinned: it must
    // confirm the submission and say nothing about our process. Read from the
    // SOURCE, because the handler is async and toast() paints from a real click.
    const submitFn = appScript.slice(appScript.indexOf('async function submitGuestReview'));
    const submitToast = (submitFn.slice(0, submitFn.indexOf('renderGuestBookings')).match(/toast\((['"])(.*?)\1/) || [, , ''])[2];
    check('the submit toast confirms it landed', /review has been submitted/i.test(submitToast));
    check('…and mentions no approval or moderation',
        !!submitToast && !/approval|approve|moderat|review it|we.ve read/i.test(submitToast));

    // THE RATING IS ASKED ONCE. The card used to render a tappable star row AND a
    // <select> of ★ strings in the composer beneath it — two controls for one
    // question, which could disagree until a tap synced them.
    // NB anchor on the BUTTON's class, not the prefix: the wrapper is
    // `class="gb2-stars"`, so a bare /gb2-star/ counts it too and reports 6.
    const stars = (s) => (s.match(/class="gb2-star(?:"| )/g) || []).length;
    check('exactly one five-star control on a fresh form', stars(fresh) === 5);
    check('…and it is not a <select>', !/<select[^>]*grf-stars/.test(fresh));
    check('the rating rides a hidden input under the id the select had',
        /<input type="hidden" id="grf-stars-jollyboat"/.test(fresh));

    // AND IT MUST RENDER FOR AN EDIT. The old star row was gated on there being no
    // review yet, so removing the select without moving the row into the composer
    // would leave "Edit your review" with no way to change the rating at all.
    const edit = review({ jollyboat: { stars: 3, text: 'Lovely', status: 'pending' } });
    check('an existing review still gets a rating control', stars(edit) === 5);
    check('…pre-filled to what they gave', (edit.match(/★/g) || []).length === 3);
    check('…and the hidden input agrees', /id="grf-stars-jollyboat" value="3"/.test(edit));
    vm.runInContext('myGuestReviews = {}', ctx);
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
for (const m of markup.matchAll(/\bon(?:click|change|input|keydown)\s*=\s*"([^"]*)"/g)) {
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
const inlineSources = { 'index.html': html, 'admin-views.html': adminViews, 'app.js': appScript, 'admin.js': adminScript };
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
    // 3-D SECURE NEEDS frame-src AND form-action, AND THEY MOVE TOGETHER. Step one
    // of 3DS is the "method URL" device fingerprint: the SDK opens a hidden iframe
    // in our document and POSTs a form to the issuer's ACS (seen live:
    // methodurl.vcas.visa.com). frame-src https: was widened for the iframe;
    // form-action stayed 'self', so the frame loaded and the POST inside it was
    // blocked — the issuer then scores the payment with no device data, which is
    // what turns a frictionless auth into a challenge or a decline. ACS hosts vary
    // per issuer and cannot be enumerated, so both have to be https:.
    const frameSrc = (csp.match(/frame-src[^;]*/) || [''])[0];
    const formAction = (csp.match(/form-action[^;]*/) || [''])[0];
    check('CSP frame-src allows the 3-D Secure issuer iframes (https:)', /(^|\s)https:(\s|$)/.test(frameSrc));
    check('CSP form-action allows the 3-D Secure device-fingerprint POST (https:)', /(^|\s)https:(\s|$)/.test(formAction));
    check("CSP form-action still pins 'self' as well", formAction.includes("'self'"));
    // Square's SDK probes for Samsung Pay; without this every pay-page visit fires
    // a connect-src report.
    const connectSrc = (csp.match(/connect-src[^;]*/) || [''])[0];
    check("CSP connect-src allows Square's Samsung Pay probe", connectSrc.includes('https://spay.samsung.com'));
    check('CSP never wildcards google (pay/apex/www only, no bare *)', !/\shttps:\/\/\*\.com/.test(connectSrc));
    // The CSP-report de-dupe key must NOT contain the reporter's IP. A phone on
    // mobile data rotates its IPv6 address every few minutes, so an IP-keyed
    // signature never matches and the hourly limit never fires — measured live as
    // the same spay.samsung.com block logged twice in three minutes from one
    // device. Keyed on the blocked HOST instead. Source scan because CI has no
    // Apache, no browser and no DB to drive the real path.
    const cspRep = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'csp-report.php'), 'utf8');
    const sigLine = (cspRep.match(/\$sig = [^;]*;/) || [''])[0];
    check('csp-report de-dupes on the blocked host, not the reporter IP (' + sigLine.trim() + ')',
        sigLine.includes('$host') && !sigLine.includes('$ip'));
    check('csp-report still records the IP on the row for forensics', /VALUES \('system', 'security'[\s\S]{0,200}\$ip/.test(cspRep) || /execute\(\[[^\]]*\$ip/.test(cspRep));
} catch (e) { check('CSP script-src check ran (' + e.message + ')', false); }

// 6a-ii-c. cmdkNoneHtml() ESCAPES ITS OWN ARGUMENTS, so its callers must pass RAW
// text. This is the chbDuties rule (escape once, at the render boundary) applied to
// the search window's one empty state, and it is worth a gate because the failure is
// silent and ugly rather than loud: the deep-search zero used to escape its query
// inline, so anyone reinstating that habit would print `&lt;b&gt;` at the owner
// instead of the query they typed. A source scan, because the double-escape is
// visible in the CALL and a rendered check can only cover the states a fixture
// happens to reach (ui-test-searchpage §18b covers the reachable ones).
try {
    const adminSrc = fs.readFileSync(path.join(__dirname, 'admin.js'), 'utf8');
    const calls = adminSrc.match(/cmdkNoneHtml\((?:[^()]|\([^()]*\))*\)/g) || [];
    const preEscaped = calls.filter((c) => /escapeHtml\s*\(/.test(c));
    check(`cmdkNoneHtml has callers to check (${calls.length})`, calls.length >= 3);
    if (preEscaped.length) console.log('     ' + preEscaped.join('\n     '));
    check(`no cmdkNoneHtml() caller pre-escapes — it escapes once, at the boundary (${preEscaped.length})`, preEscaped.length === 0);
} catch (e) { check('cmdkNoneHtml escaping scan ran (' + e.message + ')', false); }

// 6a-iii. Every data-act* value resolves to a registered chbAct() action OR a global
// function (the window-fallback path in chbRunAct). A typo'd data-act would silently
// do nothing in the browser — this catches it. data-view etc. are params, not actions.
const registeredActs = new Set([...appScript.matchAll(/chbAct\('([^']+)'/g)].map(m => m[1]));
const actValues = new Set();
// index.html static attrs + the static data-act literals emitted by app.js/admin.js
// innerHTML templates (skip ${...}-interpolated names — resolved at runtime).
for (const src of [html, adminViews, appScript, adminScript]) {
    for (const m of src.matchAll(/\bdata-act(?:-[a-z]+)?\s*=\s*["']([^"'${]+)["']/g)) {
        if (m[1]) actValues.add(m[1]);
    }
}
const unresolvedActs = [...actValues].filter(n => !registeredActs.has(n) && !definedFns.has(n));
check('every data-act* value resolves to an action or global fn' + (unresolvedActs.length ? ' (unresolved: ' + unresolvedActs.join(', ') + ')' : ''), unresolvedActs.length === 0);

// 6b. No duplicate element ids (ignore JS template-literal ids like id="x-${k}")
const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter(id => !id.includes('${'));
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
    // …but the fetch handler must no longer BYPASS admin.js (network-only): the
    // offline day sheet cannot render if the back office can't load its own
    // bundle on a dead link. Runtime-cached under its exact ?v= URL is safe —
    // an old app.js asks for the old URL, which is lockstep, not drift. Scan
    // CODE only (a comment legitimately narrates the removed exclusion).
    check('sw.js fetch handler no longer bypasses admin.js', !sw.split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .some((l) => /admin\\?\.js/.test(l) && /return/.test(l)));
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
        // 5) DISCOUNTED agreed price, paid in cash (hold_status stays 'none' on
        // that rail): the override REPLACES the rental floor. Max()'d in, the
        // floor stayed at the £910 snapshot, so £750 cash against an agreed £700
        // read paid − rental < 0 → the £50 deposit the owner genuinely holds
        // reported £0 collected: never listed in "Deposits to return" and
        // unreturnable (return_deposit caps at collected − returned). Mirrors
        // booking_rental_price (db.php), pinned the same way in test-payrail.
        const disc = { agreedPrice: { total: 700, rentalTotal: 910, damagesDeposit: 50, isOverride: true }, priceOverride: 700, payment: 'paid', holdStatus: 'none' };
        check('discounted override + rental-and-deposit paid in cash → the £50 IS held',
            dh('21a', { ...disc, depositPaid: 750, dbId: 5 }).held === 50);
        check('…paying only the discounted rental still collects nothing',
            dh('21a', { ...disc, depositPaid: 700, dbId: 6 }).held === 0);
        check('…and a RAISED override keeps its higher floor exactly as before',
            dh('21a', { agreedPrice: { total: 1200, rentalTotal: 910, damagesDeposit: 50, isOverride: true }, priceOverride: 1200, depositPaid: 1200, payment: 'paid', holdStatus: 'none', dbId: 7 }).held === 0);

        // A CASH DEPOSIT COUNTS AS PAID ON SCREEN, exactly as damages_collected
        // counts it in the ledger. displayGrand only credited the deposit via
        // hold_status ('charged'/'captured'), which cash never sets — and
        // paymentSummary CAPS depositPaid at the rental total, so a guest who
        // handed over £750 (£700 rental + £50 deposit, owner recorded the lot)
        // read "£700 received of £750, £50 still to come" on every owner surface,
        // while the server's own deposits-to-return queue said the £50 was in
        // hand. The client and server disagreed about whether money in the drawer
        // exists — the paid-so-far species again, one layer down.
        const gt = get('displayGrand');
        const cashB = { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 750, payment: 'deposit', holdStatus: 'none', dbId: 8 };
        const cashPs = get('paymentSummary')('21a', cashB);
        const cashGt = gt(cashB.agreedPrice, cashPs, 'none', cashB);
        check('cash rental+deposit recorded → paid reads £750, nothing left',
            cashGt.paid === 750 && cashGt.balance === 0 && cashGt.fullyPaid === true);
        // …and the deposit the guest paid in cash is HELD, matching the screen.
        check('…and damageHeld agrees the £50 is in hand',
            dh('21a', cashB).held === 50);
        // Rental-only cash: the deposit genuinely is still to collect.
        const cashPart = { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 700, payment: 'deposit', holdStatus: 'none', dbId: 9 };
        const partGt = gt(cashPart.agreedPrice, get('paymentSummary')('21a', cashPart), 'none', cashPart);
        check('rental-only cash → the £50 deposit stays outstanding',
            partGt.paid === 700 && partGt.balance === 50);
        // …AND THE CARD MUST NOT CALL THAT SETTLED. `fullyPaid` read
        // `ps.fullyPaid || balance <= 0.001`, and ps.fullyPaid is the RENTAL
        // rail's answer — true the moment the rental settles — so this era
        // printed "Paid in full £750.00" over "Paid − £700.00" on My Stays and
        // "Paid in full · incl. £50.00 damages deposit" on the hub, while
        // invoice.php said "Balance due £50.00" about the same booking. The
        // matrix below already states the invariant; nothing tested it here.
        check('…and is NOT reported as paid in full (the £50 is really outstanding)',
            partGt.fullyPaid === false);
        // A LEGACY booking (deposit folded INTO the total) must not double-credit:
        // paid equals the folded total, so nothing sits above the rental.
        const legB = { agreedPrice: { total: 555, rentalTotal: 480, damagesDeposit: 75 }, depositPaid: 555, payment: 'paid', holdStatus: 'none', dbId: 10 };
        const legGt = gt(legB.agreedPrice, get('paymentSummary')('21a', legB), 'none', legB);
        // A LEGACY TOTAL ALREADY CONTAINS THE DEPOSIT, and damageHeld has always
        // said so — it measures against the RENTAL (480), so it calls that £75
        // collected. displayGrand measured against the agreed TOTAL (555) and
        // called it outstanding, so the card showed a balance for money already
        // handed over; the fullyPaid short-circuit hid it, and the escape hatch
        // this check used to carry ('|| paid === 555') existed because the
        // arithmetic did not add up. One rental frame now, so it does.
        check('legacy folded-total booking: the deposit inside the total counts as paid',
            legGt.total === 630 && legGt.paid === 630 && legGt.balance === 0 && legGt.fullyPaid === true);

        // THE ERA MATRIX, as INVARIANTS (the stage-4 overhaul sweep). Every era a
        // booking can be in, driven through the same helpers every owner surface
        // reads, asserting the properties no era may break: paid + balance always
        // equals the shown total (the arithmetic can never contradict itself on
        // one card), and a settled-in-full era reads fullyPaid. Single-case
        // checks above prove figures; this proves the SHAPE holds everywhere, so
        // a new era or a helper edit cannot ship a self-contradicting card.
        const psFn = get('paymentSummary');
        const eras = [
            ['card deposit charged', { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 175, payment: 'deposit', holdStatus: 'charged', holdAmount: 50, dbId: 11 }, false],
            ['card paid in full, deposit charged', { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 700, payment: 'paid', holdStatus: 'charged', holdAmount: 50, dbId: 12 }, true],
            ['cash collected incl. deposit', { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 750, payment: 'paid', holdStatus: 'none', dbId: 13 }, true],
            ['deposit RETURNED after the stay', { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 700, payment: 'paid', holdStatus: 'returned', dbId: 14 }, true],
            ['deposit KEPT for damage', { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 700, payment: 'paid', holdStatus: 'kept', holdAmount: 50, dbId: 15 }, true],
            ['discounted override, card deposit charged', { agreedPrice: { total: 620, rentalTotal: 910, damagesDeposit: 50, isOverride: true }, priceOverride: 620, depositPaid: 155, payment: 'deposit', holdStatus: 'charged', holdAmount: 50, dbId: 16 }, false],
            // THE ERA THE MATRIX NEVER HAD: rental settled in cash, the
            // refundable deposit still to collect. hold_status never leaves
            // 'none' on this rail, so it is the one era where the rental being
            // square does NOT mean the stay is.
            ['cash rental settled, deposit still to collect', { agreedPrice: { total: 700, rentalTotal: 700, damagesDeposit: 50 }, depositPaid: 700, payment: 'paid', holdStatus: 'none', dbId: 17 }, false],
        ];
        eras.forEach(([name, b, settled]) => {
            const g = gt(b.agreedPrice, psFn('21a', b), b.holdStatus, b);
            check(`era invariant — ${name}: paid + balance = total (${g.paid}+${g.balance} vs ${g.total})`,
                Math.abs(g.paid + g.balance - g.total) < 0.006);
            check(`era invariant — ${name}: fullyPaid ${settled ? 'holds' : 'is not claimed early'}`,
                g.fullyPaid === settled);
        });
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

    // THE LCP IMAGE IS RIGHT-SIZED, AND ONLY PRELOADED WHERE IT PAINTS.
    // The upload is 1920×1440 (~726KB after htaccess's WebP negotiation) for a box
    // that is 1170 device px on a phone — the largest asset every anonymous visitor
    // pays for. And #hero lives inside <main id="view-main">, which the cottage and
    // experiences routes leave display:none, so those two were pulling it at
    // fetchpriority=high for an element they never show.
    {
        const heroShell = fs.readFileSync(path.join(__dirname, 'hero-shell.php'), 'utf8');
        const cottageSrc = fs.readFileSync(path.join(__dirname, 'cottage.php'), 'utf8');
        const expSrc = fs.readFileSync(path.join(__dirname, 'experiences-page.php'), 'utf8');
        check('the hero preload is served through img.php, not the full-size upload',
            /\$sized\s*=\s*'img\.php\?src='/.test(heroShell) && /href="'\s*\.\s*\$sized/.test(heroShell));
        check('…and the hero element asks for the SAME sized URL (or the photo downloads twice)',
            (heroShell.match(/img\.php\?src=/g) || []).length >= 2);
        check('…at a width the phone can use (1200, not the 900 default that upscales)',
            /w=1200/.test(heroShell) && !/&amp;w=900/.test(heroShell));
        check('social previews keep the full-size original',
            /str_replace\(\$origin \. '\/hero\.jpg', \$heroAbs/.test(heroShell));
        // NB not [^)]* — the cottage call contains $cv('hero-bg'), whose own ')'
        // ends the class before the argument being asserted is reached.
        const noPreload = (s) => /inject_live_hero\(.*,\s*false\s*\)/.test(s);
        check('the routes that never paint #hero do not preload it',
            noPreload(cottageSrc) && noPreload(expSrc));
    }

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
        // ONE source of truth with the PHP half (invoice.php's
        // invoice_deposit_status, driven by test-invoice.php §1): the guest's two
        // invoices used to make OPPOSITE claims about a kept deposit — the PDF said
        // "Retained after checkout for damage or loss", the emailed page said the
        // same money "is returned in full after checkout". Add a case to the JSON,
        // never here. The dates in it are DD/MM/YYYY because the caller passes
        // fmtDate — neither invoice may ever show an ISO date.
        const dfx = JSON.parse(fs.readFileSync(path.join(path.dirname(HTML_PATH), 'invoice-deposit-fixtures.json'), 'utf8'));
        check('deposit-status fixtures load', Array.isArray(dfx.cases) && dfx.cases.length >= 12);
        let disBad = [];
        for (const c of dfx.cases) {
            const got = dis(c.dep, c.hold, c.returned, c.settled);
            if (got !== c.want) disBad.push(`${c.hold}/${c.returned}: got "${got}" want "${c.want}"`);
        }
        check(`deposit status matches all ${dfx.cases.length} shared fixtures`, disBad.length === 0, disBad.slice(0, 3).join(' | '));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  THE OWNER'S PDF INVOICE, DRIVEN FOR REAL (downloadInvoice → jsPDF).
    //
    //  It is the other half of one booking's two documents and nothing had ever
    //  exercised it, so:
    //    * a settled invoice printed "Paid in full £770.25" — gbp(gt.fullyPaid ?
    //      gt.total : gt.balance) put the whole TOTAL in the column every other
    //      state uses for what is still owed;
    //    * nothing called addPage(), and the page furniture was painted once, so
    //      a long address or deposit status pushed the closing sentence off the
    //      sheet (baseline y=819 against a sheet ending at 814);
    //    * the £75 deposit was listed in Charges AND given a section of its own;
    //    * "I N V O I C E" was the accent as text (2.55:1) and "Paid in full"
    //      was #4CAF50 (2.78:1).
    //  jsPDF is stubbed by wrapping the CONSTRUCTOR (not the prototype), which is
    //  what makes every text baseline and colour measurable with no browser.
    // ════════════════════════════════════════════════════════════════════════
    const dl = get('downloadInvoice');
    if (typeof dl !== 'function') { fail('downloadInvoice is not defined'); }
    else {
        const A4 = { W: 595.28, H: 841.89 };
        // The linen now covers the whole page, so the meaningful bound is the
        // MARGIN, not a white sheet's edge: body content must stay above H-44, and
        // the per-page stamp lives in the band below it — asserted separately, so
        // relaxing one cannot silently exempt the other.
        const SHEET_BOTTOM = A4.H - 44;
        const isStamp = (t) => /^(Page \d+ of \d+|Invoice CHB-\d+)$/.test(t.s) && t.y > SHEET_BOTTOM;
        const mkDoc = () => {
            const calls = { text: [], pages: 1, colours: [], fills: [], saved: '', props: null, lang: '', on: 0, images: [] };
            let ink = [0, 0, 0];
            const doc = {
                internal: { pageSize: { getWidth: () => A4.W, getHeight: () => A4.H } },
                setFillColor(...c) { calls.fills.push(c.join(',')); }, setDrawColor() {}, setFont() {}, setFontSize() {},
                rect() {}, roundedRect() {}, line() {}, setCharSpace() {}, setLineWidth() {},
                addImage(data, fmt) { calls.images.push({ data: String(data), fmt: String(fmt) }); },
                setProperties(o) { calls.props = o; }, setLanguage(l) { calls.lang = l; },
                getNumberOfPages() { return calls.pages; },
                setPage(n) { calls.on = n; },
                getTextWidth: (t) => String(t).length * 5.2,
                setTextColor(...c) { ink = c.length === 1 ? [c[0], c[0], c[0]] : c; calls.colours.push(ink.join(',')); },
                splitTextToSize: (t, w) => {
                    // ~5.2pt per character at 10pt helvetica is close enough to make
                    // a long value wrap the way it really does
                    const per = Math.max(1, Math.floor(w / 5.2));
                    const out = [];
                    for (let i = 0; i < String(t).length; i += per) out.push(String(t).slice(i, i + per));
                    return out.length ? out : [''];
                },
                text(t, x, yy) {
                    const arr = Array.isArray(t) ? t : [t];
                    arr.forEach((s2, i) => calls.text.push({ s: String(s2), x, y: yy + i * 14, page: calls.on || calls.pages, ink: ink.join(',') }));
                },
                addPage() { calls.pages++; calls.on = calls.pages; },
                save(n) { calls.saved = n; },
            };
            return { doc, calls };
        };
        let captured = null;
        // bacs-details is an INTERNAL content key — present for the owner, absent
        // for a guest. Seeded so the how-to-pay branch can be driven at all.
        vm.runInContext("siteContent['bacs-details'] = 'Cottage Holidays Blakeney\\nSort 01-02-03  ·  Acct 12345678';", ctx);
        sandbox.window.ensureJsPdf = async () => {};
        // The crown is a real FILE now, so the harness serves it the way the host
        // does — the real ensureCrownPng runs, and its base64 encoder is exercised
        // rather than stubbed past. `noCrown` drives the failure branch.
        const CROWN_BYTES = fs.readFileSync(path.join(__dirname, 'crown.png'));
        let crownFetches = 0;
        let noCrown = false;
        sandbox.fetch = (url) => {
            if (!/^crown\.png\?v=/.test(String(url))) return Promise.reject(new Error('no network in smoke test'));
            crownFetches++;
            if (noCrown) return Promise.resolve({ ok: false, status: 404 });
            return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => CROWN_BYTES.buffer.slice(CROWN_BYTES.byteOffset, CROWN_BYTES.byteOffset + CROWN_BYTES.byteLength) });
        };
        sandbox.window.jspdf = { jsPDF: function () { const m = mkDoc(); captured = m.calls; return m.doc; } };
        // dbBookings / propertyMeta / propertyRates are `const`, so in a vm context
        // they live in the script's LEXICAL scope and never appear on the sandbox
        // object — get() cannot see them. Seed by evaluating in the same context,
        // which is also the only way to mutate a const object legitimately.
        let ADDRESS = '4 Westgate Street, Blakeney, Norfolk NR25 7NQ';
        const AGREED = { nights: 5, perNight: 135, nightly: 675, transactionPct: 3, txFee: 20.25, damagesDeposit: 75, total: 695.25, rentalTotal: 695.25 };
        const seed = (booking) => vm.runInContext(
            `propertyMeta.jollyboat = { name: 'Jollyboat', accent: '#7FA88A' };\n`
            + `propertyRates.jollyboat = ${JSON.stringify({ address: ADDRESS })};\n`
            + `dbBookings.jollyboat = [${JSON.stringify(booking)}];`,
            ctx,
        );
        const mkBooking = (over) => Object.assign({
            id: 'b42', dbId: 42, name: 'Sarah Pemberton', email: 'sarah@example.co.uk',
            checkIn: '2026-09-06', checkOut: '2026-09-11', checkInTime: '15:00', checkOutTime: '10:00',
            adults: 2, children: 1, guests: '2 adults, 1 child', agreedPrice: AGREED,
            payment: 'deposit', depositPaid: 248.81, holdStatus: 'charged', holdAmount: 75,
            paymentMethod: 'Square card', paymentDate: '2026-07-20',
        }, over || {});
        const run = async (over) => {
            captured = null;
            seed(mkBooking(over));
            await dl('b42');
            return captured;
        };
        const said = (c, re) => c.text.filter((t) => re.test(t.s));
        // -- the settled row is the same fact twice over ---------------------
        const probe = async () => {
            const paid = await run({ payment: 'paid', depositPaid: 695.25 });
            check('PDF: a settled invoice renders', !!paid && paid.saved.includes('CHB-000042'));
            const lbl = said(paid, /^Nothing outstanding$/)[0];
            check('PDF: settled says "Nothing outstanding"', !!lbl);
            if (lbl) {
                const fig = paid.text.find((t) => t.y === lbl.y && t.x > A4.W / 2);
                check('PDF: …beside £0.00, not the total', !!fig && fig.s === '£0.00', fig ? fig.s : 'no figure on that line');
            }
            // The invariant, not the old string: on a settled invoice nothing that
            // MEANS "still owed" may carry a figure at all. "Paid in full" is now
            // the hero caption over the amount received — which names its own
            // figure, and is what invoice.php does.
            check('PDF: settled — no owed-money label anywhere',
                said(paid, /^(Balance due|Still to pay)$/).length === 0,
                said(paid, /Balance|Still to pay/i).map((t) => t.s).join(' | '));
            const hCap = said(paid, /^Paid in full$/)[0];
            check('PDF: settled — the hero caption names the figure beneath it', !!hCap);
            check('PDF: …and takes the ok ink, not the 2.78:1 green', !!hCap && hCap.ink === '31,107,58',
                hCap ? hCap.ink : 'not drawn');
            // -- the deposit is stated ONCE ----------------------------------
            check('PDF: the deposit line appears once', said(paid, /^Refundable damages deposit$/).length === 1,
                said(paid, /Refundable damages deposit/).map((t) => t.s).join(' | '));
            check('PDF: …with its status underneath, not in a section of its own',
                said(paid, /refunded in full after your stay/i).length === 1);
            // -- inks ---------------------------------------------------------
            check('PDF: the retired green #4CAF50 is never set', paid.colours.indexOf('76,175,80') === -1);
            // The modernised document is space and hairlines: the only fills left are
            // the accent rule, the white ground and a status chip's tint. A linen
            // ground or a card fill would put the old letterhead back.
            check('PDF: no linen ground and no card fills', !paid.fills.includes('245,241,233'),
                paid.fills.join(' | '));
            // -- a balance still reads as a balance ---------------------------
            const part = await run({});
            const pCap = said(part, /^Balance due$/)[0];
            check('PDF: a part-paid invoice leads with "Balance due"', !!pCap);
            // the accent as WORDS takes the accent INK — the rose-gold fill is 2.55:1
            check('PDF: …in the accent ink, never the accent fill', !!pCap && pCap.ink === '138,90,43',
                pCap ? pCap.ink : 'not drawn');
            check('PDF: …over the figure actually owed',
                said(part, /^£446\.44$/).length >= 1, said(part, /^£\d/).map((t) => t.s).join(' '));
            const stp = said(part, /^Still to pay$/)[0];
            const sfig = stp && part.text.find((t) => t.y === stp.y && t.x > A4.W / 2);
            check('PDF: …and the ledger foot agrees', !!sfig && sfig.s === '£446.44', sfig ? sfig.s : 'none');
            // -- ONE ANATOMY with invoice.php: the page's own group captions ----
            for (const c of ['Charges', 'Payments', 'Your stay', 'Billed to']) {
                check(`PDF: carries the page's "${c}" group`, said(part, new RegExp('^' + c + '$')).length === 1);
            }
            // "Issued by" is FINE PRINT now, on both surfaces — its own group spent
            // 57pt restating the masthead, and that was the 57pt taking the
            // bank-rail case onto a second sheet. So the fact to assert is that the
            // issuer is still NAMED, not that it has a heading: a document must say
            // who issued it, and where it says so is a layout decision.
            check('PDF: no "Issued by" group of its own', said(part, /^Issued by$/).length === 0);
            check('PDF: …the issuer is named in the fine print instead',
                said(part, /Issued by Cottage Holidays Blakeney/).length === 1,
                said(part, /Issued by/).map((t) => t.s).join(' | '));
            check('PDF: and none of the old letterhead is left',
                said(part, /^(I N V O I C E|Invoice reference|Amount paid.*)$/).length === 0,
                said(part, /I N V O I C E|Invoice reference|Amount paid/).map((t) => t.s).join(' | '));
            // -- a REFUNDED deposit leaves the charges but stays on the page ---
            const ret = await run({ payment: 'paid', depositPaid: 695.25, holdStatus: 'returned', damagesReturned: 75, holdSettledAt: '2026-09-14 10:00:00' });
            check('PDF: refunded — the deposit is not a charge line',
                said(ret, /^Refundable damages deposit$/).length === 0);
            check('PDF: refunded — but it is still recorded, with its date',
                said(ret, /Refundable damages deposit of £75\.00/).length > 0 || said(ret, /Refunded in full on 14\/09\/2026/).length > 0);
            // -- the file's own identity ---------------------------------------
            check('PDF: carries a Title, so a viewer names the document',
                !!paid.props && /^Invoice CHB-000042 — Cottage Holidays Blakeney$/.test(paid.props.title || ''),
                paid.props ? JSON.stringify(paid.props.title) : 'setProperties never called');
            check('PDF: …an Author and a Subject naming the stay',
                !!paid.props && paid.props.author === 'Cottage Holidays Blakeney' && /Jollyboat/.test(paid.props.subject || ''),
                paid.props ? JSON.stringify(paid.props.subject) : 'none');
            check('PDF: …and a document language', paid.lang === 'en-GB', paid.lang || 'unset');
            // -- HOW TO PAY, off the card rail ---------------------------------
            const bankBal = await run({ paymentMethod: 'Bank transfer', payment: 'deposit', depositPaid: 100 });
            check('PDF: a bank-rail balance says how to pay',
                said(bankBal, /^How to pay$/).length === 1 && said(bankBal, /Sort 01-02-03/).length === 1,
                said(bankBal, /How to pay|Sort/).map((t) => t.s).join(' | '));
            const cardBal = await run({ payment: 'deposit', depositPaid: 100 });
            check('PDF: the card rail does not — it has a link instead',
                said(cardBal, /^How to pay$/).length === 0);
            const bankPaid = await run({ paymentMethod: 'Bank transfer', payment: 'paid', depositPaid: 695.25 });
            check('PDF: and a settled invoice never asks',
                said(bankPaid, /^How to pay$/).length === 0);
            // A GUEST'S COPY HAS NO bacs-details — the key is INTERNAL, so their
            // app.js never receives it. The group used to be gated on the value
            // being present, so it rendered NOTHING and a bank-rail guest kept a
            // PDF stating a balance with no way to settle it.
            vm.runInContext("delete siteContent['bacs-details'];", ctx);
            const guestBank = await run({ paymentMethod: 'Bank transfer', payment: 'deposit', depositPaid: 100 });
            check('PDF: a guest with no bank details on file still gets the group',
                said(guestBank, /^How to pay$/).length === 1);
            // NB target the sentence unique to THIS block: the closing fine print
            // also says "reply to your confirmation email", so the obvious phrase
            // matched with the whole group deleted (break-tested — it passed).
            check('PDF: …and it names a way to get them, rather than saying nothing',
                said(guestBank, /send you our bank details/i).length >= 1,
                guestBank.text.map((t) => t.s).filter((s) => /bank/i.test(s)).join(' | ') || 'nothing said');
            vm.runInContext("siteContent['bacs-details'] = 'Cottage Holidays Blakeney\\nSort 01-02-03  ·  Acct 12345678';", ctx);

            // ── NOTHING UNDRAWABLE REACHES THE PAGE ─────────────────────────
            //  jsPDF's built-in fonts declare WinAnsi and its encoder does not
            //  handle cp1252's 0x80-0x9F block, so an en dash, em dash, curly
            //  quote or ellipsis is DELETED with no error — measured against the
            //  real bundle, the Charges row's date range drew as
            //  "06/09/2026  11/09/2026" on every invoice. A character outside
            //  cp1252 is worse: jsPDF emits UTF-16BE bytes under a WinAnsi font,
            //  so a name renders as a control char and NUL-separated letters.
            //  Assert the PROPERTY over every drawn string, not a list of glyphs.
            const DRAWABLE = /^[\n\u0020-\u007E\u00A0-\u00FF]*$/;
            const undrawable = (c) => c.text.filter((t) => !DRAWABLE.test(t.s));
            const enc = await run({});
            check('PDF: every drawn string is one the font can paint', undrawable(enc).length === 0,
                undrawable(enc).map((t) => JSON.stringify(t.s)).slice(0, 3).join(' | '));
            // and the fix is a TRANSLITERATION, not deleting the dash from the source
            check('PDF: the stay range still carries its dash',
                said(enc, /06\/09\/2026\s*-\s*11\/09\/2026/).length === 1,
                said(enc, /06\/09\/2026/).map((t) => t.s).join(' | '));
            // DATA-DRIVEN: names, cottage names and addresses are free text, and no
            // fixture had ever carried one outside cp1252. é and ó are cp1252 and
            // must survive untouched; L-stroke and s-cedilla have to be folded.
            //  Asserted on the diacritic fixture SEPARATELY, because the two
            //  wrappers cover different paths: a row SUB is cleaned by
            //  splitTextToSize, a row LABEL only by text — so sweeping one
            //  fixture leaves whichever wrapper the other path uses untested
            //  (measured: removing the text wrapper left the plain sweep green).
            const dia = await run({ name: 'Łukasz Wójcik-Şahin', email: 'l@example.pl' });
            check('PDF: …including a guest name that is not Latin-1', undrawable(dia).length === 0,
                undrawable(dia).map((t) => JSON.stringify(t.s)).slice(0, 3).join(' | '));
            check('PDF: a name outside cp1252 is transliterated, never garbled',
                said(dia, /^Lukasz Wójcik-Sahin$/).length === 1,
                said(dia, /ukasz|Lukasz/).map((t) => JSON.stringify(t.s)).join(' | ') || 'name not drawn');

            // ── THE PDF'S OWN MONEY COHERES ─────────────────────────────────
            //  test-invoice asserts both properties on the guest page's RENDERED
            //  tables; the PDF drives the same money through a different renderer
            //  and asserted neither — and a Charges-coherence defect (the deposit
            //  listed in a table stated to total less than its own lines) is
            //  exactly what had to be fixed on the other surface. Read off the
            //  DRAWN rows, never the payload: summing the payload leaves a broken
            //  renderer green, which is how the first version of the page's own
            //  check passed with the fix reverted.
            const GBP = /^(-\s?)?£([\d,]+\.\d\d)$/;
            const money = (s) => { const m = GBP.exec(s); return (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')); };
            // a group's right-hand column: the values between its caption and the next
            const column = (c, from, to) => {
                const A = said(c, new RegExp('^' + from + '$'))[0];
                const B = to ? said(c, new RegExp('^' + to + '$'))[0] : null;
                if (!A) return [];
                return c.text
                    .filter((t) => t.page === A.page && t.y > A.y && (!B || t.y < B.y)
                        && t.x > A4.W / 2 && GBP.test(t.s))
                    .sort((x, z) => x.y - z.y)
                    .map((t) => money(t.s));
            };
            const near = (a, bb) => Math.abs(a - bb) < 0.005;
            for (const [label, over] of [
                ['part paid', { payment: 'deposit', depositPaid: 248.81 }],
                ['settled', { payment: 'paid', depositPaid: 695.25 }],
                ['nothing paid', { payment: 'deposit', depositPaid: 0, holdStatus: 'none' }],
                ['deposit refunded', { payment: 'paid', depositPaid: 695.25, holdStatus: 'returned', damagesReturned: 75, holdSettledAt: '2026-09-14 10:00:00' }],
            ]) {
                const c = await run(over);
                const ch = column(c, 'Charges', 'Payments');
                const pay = column(c, 'Payments', 'Your stay');
                const total = ch.length ? ch[ch.length - 1] : NaN;
                const lines = ch.slice(0, -1).reduce((a, v) => a + v, 0);
                check(`PDF (${label}): the charge lines add up to their own Total`,
                    ch.length >= 2 && near(lines, total), `lines ${lines.toFixed(2)} vs total ${total.toFixed(2)}`);
                // received is drawn as "- £248.81", so its sign is already right
                const received = pay.slice(0, -1).reduce((a, v) => a + v, 0);
                const stillToPay = pay.length ? pay[pay.length - 1] : NaN;
                check(`PDF (${label}): received + still to pay == the total`,
                    pay.length >= 2 && near(-received + stillToPay, total),
                    `${(-received).toFixed(2)} + ${stillToPay.toFixed(2)} vs ${total.toFixed(2)}`);
            }

            // ── AND NO INK ON IT IS ILLEGIBLE ───────────────────────────────
            //  The inks are invoice.php's, which test-invoice proves equal to the
            //  email design system's measured values — but nothing checked that
            //  the PDF only ever USES those. A new setTextColor here would be
            //  invisible to every other gate. Arithmetic, not pixels: there is no
            //  PDF rasteriser in CI, and the ground is a known flat colour.
            const lum = (rgb) => {
                const f = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
                return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
            };
            const ratio = (a, bb) => { const l1 = lum(a), l2 = lum(bb); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
            const GROUNDS = [['white', [255, 255, 255]], ['the returned chip', [230, 241, 233]], ['the retained chip', [250, 233, 230]]];
            const inks = [...new Set([...part.colours, ...ret.colours])].map((s) => s.split(',').map(Number));
            check('PDF: the ink sweep saw some ink', inks.length >= 3, 'inks=' + inks.length);
            for (const [gname, g] of GROUNDS) {
                const worst = inks.map((i) => [i, ratio(i, g)]).sort((a, bb) => a[1] - bb[1])[0];
                check(`PDF: every ink clears AA on ${gname}`, worst && worst[1] >= 4.5,
                    worst ? `rgb(${worst[0].join(',')}) = ${worst[1].toFixed(2)}:1` : 'no inks');
            }
            // -- PAGINATION: nothing may be drawn past the margin -------------
            for (const [label, over] of [
                ['a normal booking', {}],
                ['a very long address', {}],
                ['a long guest line', { guests: 'Six adults, four children and a party name that runs on and on and on' }],
            ]) {
                if (label === 'a very long address') {
                    ADDRESS = 'Flat 12b, The Old Lifeboat Station, Westgate Street, Blakeney, Holt, North Norfolk, NR25 7NQ, United Kingdom';
                }
                const c = await run(over);
                const off = c.text.filter((t) => t.y > SHEET_BOTTOM && !isStamp(t));
                check(`PDF: ${label} — nothing is drawn past the margin`, off.length === 0,
                    off.map((t) => `"${t.s}" at y=${Math.round(t.y)}`).slice(0, 3).join(' | '));
            }
            ADDRESS = '4 Westgate Street, Blakeney, Norfolk NR25 7NQ';
            // …and a document long enough to need one really does get a second page.
            // It has to be a WRAPPING field to grow — a single row is 18pt whatever
            // is in it — so this is the address, the same field that pushed the real
            // footer off the sheet.
            ADDRESS = Array.from({ length: 40 }, (_, i) => `Line ${i} of a preposterous address`).join(', ');
            const tall = await run({});
            check('PDF: a document that outgrows the sheet gets another page', tall.pages >= 2, 'pages=' + tall.pages);
            const off2 = tall.text.filter((t) => t.y > SHEET_BOTTOM && !isStamp(t));
            check('PDF: …and still nothing past the margin on any page', off2.length === 0,
                off2.map((t) => `"${t.s}" at y=${Math.round(t.y)}`).slice(0, 3).join(' | '));
            // A SECOND SHEET USED TO SAY NOTHING ABOUT WHICH BOOKING IT WAS.
            for (let pg = 1; pg <= tall.pages; pg++) {
                const stamps = tall.text.filter((t) => t.page === pg && isStamp(t));
                check(`PDF: page ${pg} of ${tall.pages} carries the reference and its number`,
                    stamps.some((t) => t.s === 'Invoice CHB-000042') && stamps.some((t) => t.s === `Page ${pg} of ${tall.pages}`),
                    stamps.map((t) => t.s).join(' | ') || 'nothing stamped');
            }
        };
        // -- §12e THE CROWN IS A FILE, AND IT IS THE SAME CROWN -----------------
        //    Moving an 8KB image out of app.js is only a win if the letterhead is
        //    unchanged, so this compares the bytes jsPDF is HANDED against
        //    crown.png on disk — the base64 encoder in ensureCrownPng is the new
        //    code, and a wrong encoding would draw noise, not nothing. The failure
        //    branch matters just as much: a 404 must cost the mark, never the
        //    invoice, because the export is how a guest gets their document.
        const crownProbe = async () => {
            vm.runInContext('__crownPromise = null;', ctx);
            crownFetches = 0;
            noCrown = false;
            const c = await run({});
            const img = (c.images || []).find((i) => i.fmt === 'PNG');
            check('PDF: the crown is drawn', !!img && img.data.startsWith('data:image/png;base64,'),
                img ? img.data.slice(0, 30) : 'no image drawn');
            if (img) {
                const got = Buffer.from(img.data.split(',')[1], 'base64');
                check('PDF: …and it is crown.png, byte for byte', got.equals(CROWN_BYTES),
                    `${got.length} bytes drawn vs ${CROWN_BYTES.length} on disk`);
            }
            // Memoised: a second export must not re-fetch it.
            await run({});
            check('PDF: the crown is fetched ONCE per session', crownFetches === 1, `${crownFetches} fetches`);
            // …and a failed fetch loses the mark, not the invoice.
            vm.runInContext('__crownPromise = null;', ctx);
            noCrown = true;
            const bare = await run({});
            check('PDF: a missing crown still produces the invoice',
                !!bare && bare.saved.includes('CHB-000042') && (bare.images || []).length === 0,
                bare ? `${(bare.images || []).length} images, saved "${bare.saved}"` : 'nothing produced');
            // …and it clears the memo, so the NEXT export tries again.
            noCrown = false;
            const again = await run({});
            check('PDF: …and the next export tries again', (again.images || []).length === 1,
                `${(again.images || []).length} images`);
            vm.runInContext('__crownPromise = null;', ctx);
        };
        pendingChecks.push(
            (async () => { await probe(); await crownProbe(); })().catch((e) => fail('PDF invoice probe threw: ' + e.message)),
        );
    }
    // The RATCHET that keeps the win: app.js is the file every anonymous visitor
    // downloads, and a base64 image inside it is bytes gzip cannot compress
    // charged to people who will never see the picture. Deliberately a size
    // threshold rather than a ban — a tiny inline SVG cursor or 1px spacer is a
    // legitimate thing to inline; 1KB of base64 is an asset that wants a URL.
    {
        const guestJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')
            + fs.readFileSync(path.join(__dirname, 'guest-app.js'), 'utf8');
        const big = (guestJs.match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{1024,}/g) || []);
        check('no base64 image over 1KB rides the guest JS', big.length === 0,
            big.map((s) => `${s.slice(0, 24)}… (${s.length} chars)`).join(' | '));
        // crown.png is owner-only, so it must NOT join the guest precache.
        const swSrc = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
        const core = (swSrc.match(/const CORE\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
        check('sw.js CORE parses (vacuity guard)', core.length > 40, `${core.length} chars`);
        check('crown.png stays OUT of the guest precache', !/crown\.png/.test(core));
        check('crown.png exists and is a PNG',
            fs.existsSync(path.join(__dirname, 'crown.png'))
            && fs.readFileSync(path.join(__dirname, 'crown.png')).slice(0, 8).toString('hex') === '89504e470d0a1a0a');
    }

    // §12g THE DEPLOY-TIME COMMENT STRIP IS SAFE, AND PROVABLY SO.
    //  143KB gz of a 461KB guest payload is source comments. They are blanked at
    //  deploy time — never deleted — so every stack-trace line reported to
    //  client-error.php stays exact. What must hold: the program is unchanged,
    //  the line count is unchanged, and the cases where a naive line-scanner
    //  would corrupt code are handled. Those cases are the whole risk, so they
    //  are enumerated here rather than trusted to the AST check in the deploy.
    {
        console.log('\n== 12g. The deploy-time comment strip ==');
        const { stripSource, verifyJs } = require(path.join(__dirname, 'strip-comments.js'));
        const cases = [
            ['a whole-line // comment goes', '// gone\nconst a = 1;', '\nconst a = 1;'],
            ['a TRAILING comment stays — the line has code', 'const a = 1; // kept\n', 'const a = 1; // kept\n'],
            ['an inline /** @type */ cast stays', 'const a = /** @type {any} */ (b);', 'const a = /** @type {any} */ (b);'],
            ['a one-line block comment goes', '/* gone */\nconst a = 1;', '\nconst a = 1;'],
            ['a MULTI-LINE block goes, every line blanked',
                '/* one\n   two */\nconst a = 1;', '\n\nconst a = 1;'],
            // THE ONES THAT BITE. A // inside a string or a template is CODE.
            ['a // inside a string is untouched', "const u = '//example.com';", "const u = '//example.com';"],
            ['a line that merely CONTAINS // is untouched', 'const u = "x"; // t\n', 'const u = "x"; // t\n'],
        ];
        cases.forEach(([label, src, want]) => {
            check(label, stripSource(src, 'js') === want,
                JSON.stringify(stripSource(src, 'js')) + ' want ' + JSON.stringify(want));
        });
        // A // at the start of a line INSIDE a template literal is not a comment.
        const tpl = 'const t = `\n// not a comment\n`;\nconst a = 1;';
        check('a //-looking line inside a template literal survives',
            stripSource(tpl, 'js').includes('// not a comment'), JSON.stringify(stripSource(tpl, 'js')));
        // THE INVARIANT that keeps stack traces honest, on the real files.
        ['app.js', 'guest-app.js', 'app.css', 'guest-app.css'].forEach((f) => {
            const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
            const kind = f.endsWith('.css') ? 'css' : 'js';
            const out = stripSource(src, kind);
            check(`${f}: the line count is unchanged`,
                src.split('\n').length === out.split('\n').length,
                `${src.split('\n').length} -> ${out.split('\n').length}`);
            if (kind === 'js') {
                check(`${f}: the program is token-for-token identical`, verifyJs(src, out, f) === null,
                    String(verifyJs(src, out, f)));
            }
            // …and it actually SAVES something, or the deploy step is theatre.
            const zlib = require('zlib');
            const saved = zlib.gzipSync(Buffer.from(src)).length - zlib.gzipSync(Buffer.from(out)).length;
            check(`${f}: it saves real bytes (${(saved / 1024).toFixed(1)}KB gz)`, saved > 2000, String(saved));
        });
        // Both deploy jobs must run it, or the guest payload never shrinks.
        const dep = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
        const runs = (dep.match(/strip-comments\.js" "\$OUT" --verify/g) || []).length;
        check('both deploy jobs strip, with --verify (production + staging)', runs === 2, String(runs));
        check('…and the stripper itself is removed from the artifact',
            (dep.match(/rm -f "\$OUT\/strip-comments\.js"/g) || []).length === 2);
    }

    // §12f THE FONTS ARE VERSIONED BY THEIR OWN CONTENT.
    // htaccess serves woff2 `immutable, max-age=31536000`, so an unpinned font
    // URL is a file no returning visitor can ever be given a new copy of. The
    // pin is the first 8 hex of the file's sha256 — derived, so this check can
    // print the value to paste rather than asking anyone to remember a stamp —
    // and app.css's @font-face must agree with index.html's PRELOAD exactly, or
    // the preload warms a URL nothing then asks for.
    // It DISCOVERS the referring files rather than naming them, because the first
    // version named app.css and index.html and status.php was the third — a whole
    // page holding its own unbustable, separately-downloaded copy of both faces,
    // live, invisible to the gate written the same hour. A source scan sees what it
    // was written to see; make it find its own subjects.
    {
        console.log('\n== 12f. The fonts carry a content pin, and one pin ==');
        const fontFiles = fs.readdirSync(path.join(__dirname, 'fonts')).filter((f) => f.endsWith('.woff2'));
        check('fonts/ holds woff2 files (vacuity guard)', fontFiles.length >= 2, `${fontFiles.length} found`);
        const refFiles = fs.readdirSync(__dirname)
            .filter((f) => /\.(php|html|css|js)$/.test(f) && !/^(smoke-test|.*test.*)\.js$/.test(f))
            .filter((f) => /fonts\/[a-z0-9-]+\.woff2/i.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
        check('found the files that reference a font (vacuity guard)', refFiles.length >= 3,
            refFiles.join(', ') || 'none');
        fontFiles.forEach((f) => {
            const want = require('crypto').createHash('sha256')
                .update(fs.readFileSync(path.join(__dirname, 'fonts', f))).digest('hex').slice(0, 8);
            const re = new RegExp(`fonts/${f.replace('.', '\\.')}(\\?v=([0-9a-f]+))?`, 'g');
            const wrong = [];
            refFiles.forEach((rf) => {
                const src = fs.readFileSync(path.join(__dirname, rf), 'utf8');
                for (const m of src.matchAll(re)) {
                    if (m[2] !== want) wrong.push(`${rf} ?v=${m[2] || 'none'}`);
                }
            });
            check(`${f}: every reference pins its content hash (?v=${want})`, wrong.length === 0,
                wrong.join(' | '));
        });
    }

    // THE DEPOSIT ON A GUEST'S INVOICE IS THE SUM TAKEN, NOT THE SUM AGREED.
    // agreed_booking_fee moves whenever the owner edits the deposit; hold_amount
    // is what the card really took and what damages_collected() caps a refund at.
    // Once charged, only hold_amount is true — invoice.php has billed it since the
    // same defect was fixed there, and the client PDF (downloadInvoice) plus every
    // displayGrand figure read the agreed one, so the two invoices for ONE booking
    // could quote different deposits and the PDF promised back money that cannot
    // be refunded. The gap only opens when the two differ, so every case below
    // uses 75 agreed against 100 held.
    const dta = get('depositTakenAmt');
    const dGrand = get('displayGrand');
    if (typeof dta !== 'function' || typeof dGrand !== 'function') { fail('depositTakenAmt / displayGrand are not defined'); }
    else {
        const p = { damagesDeposit: 75, total: 400 };
        const bk = (holdStatus, holdAmount) => ({ holdStatus, holdAmount });
        check('charged → the invoice bills what the card took', dta(p, bk('charged', 100)) === 100);
        check('captured (legacy hold) → the same rule', dta(p, bk('captured', 100)) === 100);
        check('kept → still the sum taken', dta(p, bk('kept', 100)) === 100);
        // Before it is charged there is nothing to have taken, so the AGREED
        // figure is the only answer — and it is the one that WILL be charged.
        check('not yet charged → the agreed figure, which is what pay.php will take', dta(p, bk('none', 0)) === 75);
        check('cash/bank booking (never charged) keeps the agreed figure', dta(p, bk('none', 100)) === 75);
        // A fresh quote has no booking at all.
        check('no booking (a quote) → the agreed figure', dta(p, null) === 75);
        // A charged booking with no recorded hold_amount is an older row; the
        // agreed figure is the best that is known, not zero.
        check('charged but no hold_amount recorded → the agreed figure, never £0', dta(p, bk('charged', 0)) === 75);
        // …and the folded TOTAL and PAID move with it, since displayGrand counts
        // the deposit as paid once hold_status says it was taken.
        const ps = { total: 400, deposit: 400, fullyPaid: true };
        const gt = dGrand(p, ps, 'charged', bk('charged', 100));
        check('the shown total folds in the sum taken', gt.total === 500);
        check('…and counts exactly that much as paid', gt.paid === 500);
        check('…leaving no phantom balance', gt.balance === 0);
        // Refunded still drops out entirely, whichever figure it was.
        check('refunded → the deposit leaves the shown total', dGrand(p, ps, 'returned', bk('returned', 100)).total === 400);
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

    // ---- THE SECOND TIER: the facts the site keeps that nobody wrote as a Q&A.
    // The house rules and the amenities are proper per-cottage stores now and the
    // matcher could not see either, so "can we bring our dog?" went to a person
    // even where the rules answer it plainly. Consulted ONLY when the written
    // corpus abstains — that ordering is what makes this safe, so it is asserted
    // rather than assumed.
    vm.runInContext(`
        siteContent['houserules-jollyboat'] = ['No smoking indoors', 'Quiet after 10pm — the lane carries sound'];
        siteContent['amenities-jollyboat'] = ['Wood-burning stove', 'Dishwasher', 'Off-street parking'];
    `, ctx);
    const smoke = faq('is smoking allowed inside?');
    check('guest FAQ answers from a HOUSE RULE when no Q&A covers it',
        !!smoke && /No smoking indoors/.test(smoke.a), smoke ? smoke.a : 'null');
    // NB phrased so it reaches tier 2 at all: "what time…" hits the built-in
    // check-in/checkout topic on the word "time", and a written answer WINS by
    // design — which is the precedence being asserted two checks below. What
    // this one owns is that among the RULES the right one is chosen.
    const quiet = faq('are there any quiet hours');
    check('…and picks the RULE that matches, not just any rule',
        !!quiet && /Quiet after 10pm/.test(quiet.a), quiet ? quiet.a : 'null');
    const dish = faq('is there a dishwasher');
    check('guest FAQ answers from the AMENITIES, as a list rather than one word',
        !!dish && /Jollyboat has:/.test(dish.a) && /Dishwasher/.test(dish.a), dish ? dish.a : 'null');
    // THE WRITTEN ANSWER STILL WINS. "Off-street parking" is an amenity AND the
    // built-in parking topic exists — a derived list must never displace either.
    const park2 = faq('where can I park the car');
    check('a written answer still beats the derived list (parking)',
        !!park2 && !/Jollyboat has:/.test(park2.a), park2 ? park2.a : 'null');
    const dog2 = faq('can I bring my dog?');
    check('…and the dogs FAQ is untouched by the new tier',
        !!dog2 && /dogs stay free/.test(dog2.a), dog2 ? dog2.a : 'null');
    // Still precision-biased: the new corpus must not answer anything and everything.
    check('the second tier stays silent on an unrelated question',
        faq('what is the airspeed of a swallow') === null);
    vm.runInContext(`delete siteContent['houserules-jollyboat']; delete siteContent['amenities-jollyboat'];`, ctx);
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

// chbSwallow: the reporter for a CAUGHT error on a path where quietly carrying on
// can hide a real bug (money totals, a missing quote, a dead pay link). Its whole
// value rests on being a safe drop-in for `catch (e) {}`, so pin that contract:
// it must never throw and never return anything that could alter control flow —
// including when the reporting hook is missing or itself throws.
console.log('\n== 11. chbSwallow (soft error reporting) ==');
if (typeof get('chbSwallow') !== 'function') {
    fail('chbSwallow is not defined');
} else {
    const sw = get('chbSwallow');
    const calls = [];
    sandbox.window.__reportSwallowed = (msg, where) => { calls.push({ msg, where }); };
    check('returns undefined (cannot change control flow)', sw(new Error('boom'), 'tag-a') === undefined);
    check('reports through the shared error hook', calls.length === 1);
    check('the message carries the tag + the error', /\[tag-a\] boom/.test(calls[0] ? calls[0].msg : ''));
    check('the "where" identifies the call site', (calls[0] || {}).where === 'swallow:tag-a');
    // Degenerate inputs must be as safe as a real Error.
    let threw = false;
    try { sw(undefined, 'tag-b'); sw(null, 'tag-c'); sw('a string', 'tag-d'); sw({}, 'tag-e'); } catch (e) { threw = true; }
    check('never throws on undefined / null / string / object', !threw);
    // A broken (or absent) hook must not turn a swallowed error into a real one.
    sandbox.window.__reportSwallowed = () => { throw new Error('hook exploded'); };
    let threw2 = false;
    try { sw(new Error('x'), 'tag-f'); } catch (e) { threw2 = true; }
    check('survives a throwing report hook', !threw2);
    delete sandbox.window.__reportSwallowed;
    let threw3 = false;
    try { sw(new Error('x'), 'tag-g'); } catch (e) { threw3 = true; }
    check('survives a missing report hook', !threw3);
}

// ============================================================
//  §7. EVERY REQUIRED FILE IS ACTUALLY DEPLOYED.
//  A `require_once __DIR__ . '/x.php'` is a file its endpoint cannot run without.
//  The deploy strips dev-only files by name, so adding a lib whose name happens to
//  match one of those patterns — or adding a require to a file that was always
//  dev-only — ships an app that fatals on the host. That is the sibling of the
//  outage this section was written for: accounts.php reached production carrying a
//  new `require sweep-lib.php` while the lib had not arrived, and the Payments
//  screen 500-ed until the next deploy completed. (The transfer failure itself is
//  handled in deploy.yml by cmd:fail-exit + a second idempotent mirror pass; this
//  catches the case where the file was never going to be sent at all.)
// ============================================================
console.log('\n== 7. Every required PHP file survives the deploy ==');
{
    const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
    // The deploy stages a copy of the app folder then `rm -f`s the dev-only files.
    // Collect every basename those lines remove.
    const stripped = new Set();
    for (const m of wf.matchAll(/rm -f ([^\n]+)/g)) {
        for (const t of m[1].matchAll(/"\$OUT\/([^"]+)"|"\$OUT"\/(\S+)/g)) {
            stripped.add((t[1] || t[2]).replace(/^\//, ''));
        }
    }
    check(`the deploy's strip list was parsed (${stripped.size} entries)`, stripped.size > 20);
    // Every require target, derived from the source rather than listed here.
    const required = new Set();
    for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.php'))) {
        const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
        for (const m of src.matchAll(/require(?:_once)?\s+__DIR__\s*\.\s*'\/([A-Za-z0-9._-]+\.php)'/g)) {
            required.add(m[1]);
        }
    }
    check(`require targets were derived (${required.size} files)`, required.size > 20);
    // config.php is the one legitimate exception: it IS stripped, because the host
    // keeps its own (the deploy never deletes remote-only files).
    const clash = [...required].filter((f) => stripped.has(f) && f !== 'config.php');
    check(`no required file is stripped from the deploy${clash.length ? ' — ' + clash.join(', ') : ''}`, clash.length === 0);
    // A required file must also EXIST in the repo, or the checkout ships a dangling
    // require — the same fatal, one step earlier.
    const absent = [...required].filter((f) => !fs.existsSync(path.join(__dirname, f)));
    check(`every required file exists in the repo${absent.length ? ' — ' + absent.join(', ') : ''}`, absent.length === 0);
    // …AND THE PAYLOAD HELPERS THE BOOTSTRAPS CALL MUST BE DECLARED BY THE FILES
    // THEY REQUIRE. Reported live: bootstrap.php fataled with "Call to undefined
    // function rates_public_payload()" on a host whose rates.php was stale. The
    // repo was consistent, so this could not have caught THAT — but it catches
    // the same shape one step earlier: a helper renamed, moved, or called from a
    // bootstrap that never requires its home. Each bootstrap now also DEGRADES
    // rather than 500s, so this pairs a compile-time rule with a runtime one.
    for (const boot of ['bootstrap.php', 'admin-bootstrap.php']) {
        const src = fs.readFileSync(path.join(__dirname, boot), 'utf8');
        const reqs = [...src.matchAll(/require(?:_once)?\s+__DIR__\s*\.\s*'\/([A-Za-z0-9._-]+\.php)'/g)].map((m) => m[1]);
        // Transitively: a bootstrap's requires may pull in the file that declares it.
        const seen = new Set();
        const queue = [...reqs];
        let decls = '';
        while (queue.length) {
            const f = queue.shift();
            if (seen.has(f) || !fs.existsSync(path.join(__dirname, f))) continue;
            seen.add(f);
            const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
            decls += s;
            for (const m of s.matchAll(/require(?:_once)?\s+__DIR__\s*\.\s*'\/([A-Za-z0-9._-]+\.php)'/g)) queue.push(m[1]);
        }
        // The helpers this bootstrap calls, taken from its own $part('…') list
        // and any bare foo_payload() calls.
        const called = new Set();
        for (const m of src.matchAll(/\$part\('([A-Za-z0-9_]+)'\)/g)) called.add(m[1]);
        for (const m of src.matchAll(/\b([a-z0-9_]*payload)\s*\(/g)) called.add(m[1]);
        called.delete('payload');
        const missing = [...called].filter((fn) => !new RegExp('function\\s+' + fn + '\\s*\\(').test(decls));
        check(`${boot}: every payload helper it calls is declared by a file it requires (${called.size} helpers)`,
            called.size >= 4 && missing.length === 0, missing.join(', '));
    }

    // ---- §7c. ONE definition of the site's base URL. -----------------------
    // Four crons rebuilt it by hand from HTTP_HOST (?? 'localhost') + the
    // detected scheme — the exact reconstruction that broke the Square webhook
    // (a proxy hiding the scheme, an untrusted Host header): review-request
    // emails one proxy quirk away from http:// links, the Airbnb export URL
    // built off whatever Host arrived. site_base_url() (db.php) is the
    // trusted-host + proxy-aware definition; the marker of a hand-rolled copy
    // is dirname($_SERVER['SCRIPT_NAME']), which only that helper may use.
    {
        const offenders = [];
        for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.php') && n !== 'db.php')) {
            if (fs.readFileSync(path.join(__dirname, f), 'utf8').includes("dirname($_SERVER['SCRIPT_NAME']")) offenders.push(f);
        }
        check(`no file rebuilds the base URL by hand — site_base_url() is the one definition${offenders.length ? ' — ' + offenders.join(', ') : ''}`,
            offenders.length === 0);
        check('…and the helper itself still exists to point at',
            fs.readFileSync(path.join(__dirname, 'db.php'), 'utf8').includes('function site_base_url'));
    }
}

// ---- 12. Nothing overrides the double-booking guard on its own ------------
// The server's clash check is a SOFT stop: it answers {clash:true} and proceeds
// only if the caller sends override_clash, which exists so the owner can overlap
// deliberately. That makes the flag the single bypass of the one guarantee this
// business cannot trade away — so it may only ever be set AFTER a human has read
// the clash and said yes. The Test Centre's demo-booking button sent it
// unconditionally, so the one control that creates a booking with nobody reading
// the answer could also silently overlap a real guest.
console.log('\n== 12. The clash guard has exactly one bypass, and it is a human ==');
{
    const files = ['app.js', 'admin.js', 'guest-app.js'];
    const sites = [];
    for (const f of files) {
        const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
        for (const m of src.matchAll(/override_clash\s*[:=]\s*true/g)) {
            // The 400 characters before it — a confirm has to be close enough to
            // be the thing that gated this line.
            sites.push({ file: f, before: src.slice(Math.max(0, m.index - 400), m.index) });
        }
    }
    check(`override_clash sites were found (${sites.length})`, sites.length > 0);
    const unconfirmed = sites.filter((s) => !/glassConfirm|confirm\(/.test(s.before));
    check(
        `every override_clash is set only after a confirm${unconfirmed.length ? ' — ' + unconfirmed.map((s) => s.file).join(', ') : ''}`,
        unconfirmed.length === 0,
    );
}

// ---- 12b. Backing out of "Add accommodation" creates nothing ----------------
// A new cottage goes LIVE the moment it is created — public page, enquirable, no
// photos, default text — so the dialog that creates one has to be dismissable. The
// last step used to be a glassConfirm used as a two-way choice ("OK = private ·
// Cancel = list it publicly") with no third branch, and glassConfirm resolves FALSE
// on Cancel AND on Escape: a reflexive dismissal PUBLISHED the cottage. It is one
// glassForm now, which resolves null on both.
//
// Asserted on the SOURCE rather than driven: the browser suites drive this dialog
// through three different dismissal routes and each one left the promise unsettled
// and hung the run, which is a lot of machinery to prove a property the code states
// exactly. Both halves are checked, so it cannot pass vacuously — the function must
// use the dialog type whose dismissal aborts, and must NOT gate the create on the
// one whose dismissal is an answer.
console.log('\n== 12b. Adding a cottage has a way out ==');
{
    const src = fs.readFileSync(path.join(__dirname, 'admin.js'), 'utf8');
    const i = src.indexOf('async function addAccommodationPrompt');
    const body = i < 0 ? '' : src.slice(i, src.indexOf('\n}', i));
    check('addAccommodationPrompt was found', body.length > 200);
    check('…it asks with a glassForm, which resolves null on Cancel AND Escape', /await glassForm\(/.test(body));
    check('…and aborts on that null before creating anything', /if \(!vals\) return/.test(body));
    check(
        '…with no glassConfirm deciding the listing, whose dismissal is an ANSWER',
        !/glassConfirm\(/.test(body),
    );
}

// ---- 12c. An external block loses only the nights a booking really covers ----
// suppressBlocksUnderLocalBookings drops an iCal/owner block whenever it overlaps a
// local booking AT ALL. The case it exists for is the exact-range MIRROR (our own
// booking exported to Airbnb and imported back), and for any PARTIAL overlap it
// removed the non-overlapping nights from dbBlocks too — which is what the owner's
// timeline, the tl-ext bars and conflict-audit read. So an owner block 01–15 Sep
// with a phone booking 01–03 Sep saved through the clash confirm left 03–15 Sep
// showing FREE on the one screen the owner scans to avoid double-booking.
console.log('\n== 12c. A partial overlap subtracts nights, it does not delete the block ==');
{
    const nights = (list) => list.map((b) => b.checkIn + '→' + b.checkOut).join(', ');
    // SNAPSHOT the two stores: they are module-level objects mutated in place, and
    // later sections render real bookings out of them (the PDF probe failed on the
    // first run of this block for exactly that).
    const savedStores = vm.runInContext('JSON.stringify({bk:dbBookings,bl:dbBlocks})', ctx);
    const run = (bookings, blocks) => {
        vm.runInContext(
            'Object.keys(dbBookings).forEach(k=>delete dbBookings[k]);' +
            'Object.keys(dbBlocks).forEach(k=>delete dbBlocks[k]);' +
            'dbBookings.t=' + JSON.stringify(bookings) + '; dbBlocks.t=' + JSON.stringify(blocks) + ';' +
            'suppressBlocksUnderLocalBookings();',
            ctx,
        );
        return vm.runInContext('dbBlocks.t.map(b=>({checkIn:b.checkIn,checkOut:b.checkOut,id:String(b.id)}))', ctx);
    };
    // The MIRROR still disappears — that is what this function is for.
    const mirror = run(
        [{ id: 1, checkIn: '2026-09-01', checkOut: '2026-09-04' }],
        [{ id: 'x1', source: 'airbnb', checkIn: '2026-09-01', checkOut: '2026-09-04' }],
    );
    check(`an exact-range mirror still disappears (${nights(mirror) || 'none'})`, mirror.length === 0);
    // A PARTIAL overlap keeps the nights the booking does not cover.
    const partial = run(
        [{ id: 1, checkIn: '2026-09-01', checkOut: '2026-09-03' }],
        [{ id: 'x1', source: 'owner', checkIn: '2026-09-01', checkOut: '2026-09-15' }],
    );
    check(
        `a partial overlap keeps the rest of the block (${nights(partial) || 'NOTHING — the nights read as free'})`,
        partial.length === 1 && partial[0].checkIn === '2026-09-03' && partial[0].checkOut === '2026-09-15',
    );
    // A booking INSIDE a block splits it, rather than clearing both sides.
    const split = run(
        [{ id: 1, checkIn: '2026-09-05', checkOut: '2026-09-08' }],
        [{ id: 'x1', source: 'owner', checkIn: '2026-09-01', checkOut: '2026-09-15' }],
    );
    check(
        `a booking in the MIDDLE splits the block in two (${nights(split) || 'NOTHING'})`,
        split.length === 2 && split[0].checkOut === '2026-09-05' && split[1].checkIn === '2026-09-08',
    );
    check('…and the two halves carry distinct ids', split.length === 2 && split[0].id !== split[1].id);
    // A block nowhere near a booking is untouched.
    const clear = run(
        [{ id: 1, checkIn: '2026-10-01', checkOut: '2026-10-03' }],
        [{ id: 'x1', source: 'airbnb', checkIn: '2026-09-01', checkOut: '2026-09-04' }],
    );
    check(`an unrelated block is untouched (${nights(clear)})`, clear.length === 1 && clear[0].checkIn === '2026-09-01');
    vm.runInContext(
        'var __s = ' + savedStores + ';' +
        'Object.keys(dbBookings).forEach(k=>delete dbBookings[k]); Object.assign(dbBookings, __s.bk);' +
        'Object.keys(dbBlocks).forEach(k=>delete dbBlocks[k]); Object.assign(dbBlocks, __s.bl);',
        ctx,
    );
}

// ---- 12d. The clock and the money format are built ONCE ---------------------
// An Intl.DateTimeFormat is expensive to construct and free to reuse. ukNowParts
// is the app's CLOCK — todayDashed() and ukNowMinutes() both read it, so every
// date comparison in every render went through a fresh one — and gbp() called
// Number#toLocaleString, which constructs an Intl.NumberFormat per call, on every
// money figure in every row. Measured through the real boot with the constructors
// counted: a guest boot went 13 → 1 and an owner boot 51 → 2 (on an EMPTY booking
// list; the render loops that call these per row are what make it thousands on a
// real one). Lazy, so a guest who never sees a price never builds the money one.
console.log('\n== 12d. The clock and the money format are built once ==');
{
    // Count constructions in the SANDBOX's own realm, which is where app.js ran.
    vm.runInContext('__intlCount = { d: 0, n: 0 };', ctx);
    vm.runInContext(
        'var __RD = Intl.DateTimeFormat, __RN = Intl.NumberFormat;' +
        'Intl.DateTimeFormat = function (...a) { __intlCount.d++; return new __RD(...a); };' +
        'Intl.NumberFormat = function (...a) { __intlCount.n++; return new __RN(...a); };',
        ctx,
    );
    // Warm them, then call each MANY times: the property is that the count does not
    // grow with the calls, which is exactly what a per-call constructor fails.
    vm.runInContext('todayDashed(); gbp(1); __intlCount = { d: 0, n: 0 };', ctx);
    const counted = vm.runInContext(
        'for (let i = 0; i < 200; i++) { todayDashed(); ukNowMinutes(); gbp(i + 0.5); } __intlCount;',
        ctx,
    );
    check(`600 clock/money calls construct no new date formatter (${counted.d})`, counted.d === 0);
    check(`…and no new number formatter (${counted.n})`, counted.n === 0);
    // …and the money format is unchanged by the swap from toLocaleString.
    const money = vm.runInContext('[gbp(0), gbp(1234.5), gbp(-12.345), gbp(1e6)].join(" | ")', ctx);
    check(`the money format is byte-identical (${money})`, money === '£0.00 | £1,234.50 | £-12.35 | £1,000,000.00');
    vm.runInContext('Intl.DateTimeFormat = __RD; Intl.NumberFormat = __RN;', ctx);
}

// ============================================================
//  §13 — NO SILENT CAPS, and the number is stated ONCE.
//  The activity log asks for 250 rows and rendered them with nothing saying so,
//  so a full page read exactly like a complete history. The sentence and the
//  request must read the same constant, or one can drift from the other.
// ============================================================
console.log('\n§13 The activity log declares its own cap');
{
    const adm = adminScript;
    check('ACT_LOG_LIMIT is the one definition', /const ACT_LOG_LIMIT = \d+;/.test(adm));
    check('...the request asks for it', /limit: ACT_LOG_LIMIT,/.test(adm));
    check('...no bare 250 left in the log renderer', !/limit: 250/.test(adm));
    check(
        '...a full page SAYS it is capped, and names the remedy already on screen',
        /events\.length >= ACT_LOG_LIMIT/.test(adm) &&
            /Showing the \$\{ACT_LOG_LIMIT\} most recent/.test(adm) &&
            /search or filter above/.test(adm),
    );
}

// ============================================================
//  §14 — THE MAC APP'S DOWNLOAD LINK NAMES THE FILE THE BUILD MAKES.
//  The back office links to /releases/latest/download/<name>, and <name> is
//  decided in mac-app/package.json by electron-builder's artifactName. They are
//  two files that must agree, and nothing checked them — so renaming the app
//  silently pointed the only download button at a 404, which is a dead end the
//  owner discovers and nobody else can.
//
//  DERIVED, never a second copy of the string: the expectation is READ from
//  package.json, so a future rename is caught rather than needing to be
//  remembered in a third place.
// ============================================================
console.log('\n§14 The Mac app download link names the built file');
{
    const pkgPath = path.join(__dirname, '..', 'mac-app', 'package.json');
    if (!fs.existsSync(pkgPath)) {
        check('mac-app/package.json is where this expects it', false);
    } else {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const artifact = String((pkg.build && pkg.build.dmg && pkg.build.dmg.artifactName) || '');
        check('the dmg artifact name is declared', /\$\{ext\}$/.test(artifact), artifact);
        const dmg = artifact.replace('${ext}', 'dmg');
        // It must carry NO version, or /releases/latest/download/ rots the first
        // time the app's version changes.
        check('...and carries no version, so the latest-release URL cannot rot',
            !/\d+\.\d+/.test(dmg), dmg);
        const m = adminScript.match(/const NIGHT_APP_LATEST = '([^']+)'/);
        check('admin.js states the download link once', !!m);
        if (m) {
            check('...pointing at the LATEST release, not one particular build',
                /\/releases\/latest\/download\//.test(m[1]), m[1]);
            check('...and naming exactly the file electron-builder produces',
                m[1].endsWith('/' + dmg), m[1] + ' vs ' + dmg);
        }
        // The workflow proves the universal binary by name, and electron-builder
        // names the executable after productName — so that line moves too.
        const wf = path.join(__dirname, '..', '.github', 'workflows', 'mac-app.yml');
        if (fs.existsSync(wf)) {
            const y = fs.readFileSync(wf, 'utf8');
            check('the workflow checks the architectures of the REAL binary name',
                y.includes('MacOS/' + pkg.build.productName));
            // CFBUNDLENAME MUST TRACK PRODUCTNAME. Electron finds its helper
            // apps by CFBundleName + " Helper.app" while electron-builder
            // names the helpers from productName — so an extendInfo pin left
            // behind by a rename is an app that dies at ElectronMain with
            // "Unable to find helper app" (SIGTRAP, "quit unexpectedly").
            // Shipped exactly once: hand-build-20260819-1839, found by the
            // owner. The pin itself is legitimate (it is what names the app
            // in the macOS menu bar); it just may never disagree.
            const bn = pkg.build.mac && pkg.build.mac.extendInfo && pkg.build.mac.extendInfo.CFBundleName;
            if (bn !== undefined) {
                check('mac extendInfo.CFBundleName equals productName (a mismatch cannot launch)',
                    bn === pkg.build.productName);
            }
        }
    }
}

Promise.all(pendingChecks).then(() => {
    console.log('\n== Summary ==');
    if (failures === 0) { console.log('  ALL CHECKS PASSED ✅\n'); process.exit(0); }
    console.log('  ' + failures + ' CHECK(S) FAILED ❌\n'); process.exit(1);
});
