#!/usr/bin/env node
// ============================================================
//  golden-test.js — the search ANSWER-SHAPE regression corpus (dev/CI only).
//
//  smoke-test.js / search-test.js prove the machinery (registry, NLU quality,
//  facade); nothing proved the ANSWERS. The "who's at Jollyboat" bug was
//  exactly that class: every suite green while a real phrasing returned the
//  wrong date window. This gate closes it: ~100 real owner phrasings run
//  through cmdkIntent() against a seeded, deterministic booking set (dates
//  relative to the real today), and each asserts the SHAPE of the answer —
//  who leads, what must appear, what must NEVER appear.
//
//  Run:  node golden-test.js          (CI runs this in the checks job)
//        node golden-test.js --dump   (print every actual answer, no asserts)
//
//  When an intent's wording changes ON PURPOSE, update the case here in the
//  same PR — the corpus is the contract for what each phrasing answers.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const DUMP = process.argv.includes('--dump');
let failures = 0;
const pass = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failures++; console.log('  ✗ ' + m); };

// ---- Minimal fake-browser shim (same shape as search-test.js) ----
function stubEl() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
        getAttribute() { return null; }, appendChild() {}, append() {}, prepend() {}, remove() {},
        querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
        focus() {}, blur() {}, click() {}, scrollIntoView() {}, getBoundingClientRect() { return { top: 0, left: 0 }; },
        innerHTML: '', textContent: '', innerText: '', value: '', checked: false, children: [], files: [],
    };
}
const documentShim = {
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return stubEl(); }, addEventListener() {}, removeEventListener() {},
    body: stubEl(), documentElement: stubEl(), cookie: '',
};
const sandbox = {
    console,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('no network in golden test')),
    localStorage: (() => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }; })(),
    navigator: { credentials: undefined, userAgent: 'node-golden-test' },
    document: documentShim,
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
    vm.runInContext(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'), ctx, { filename: 'app.js', timeout: 5000 });
    vm.runInContext(fs.readFileSync(path.join(DIR, 'admin.js'), 'utf8'), ctx, { filename: 'admin.js', timeout: 5000 });
} catch (e) {
    console.log('  ✗ bundle threw on load: ' + e.message);
    process.exit(1);
}

// ---- Seeded dataset (dates relative to the REAL today so the corpus runs any day) ----
const d = (off) => {
    const x = new Date();
    x.setDate(x.getDate() + off);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
// DD/MM/YYYY, matching fmtDate() for expectations that pin an exact date.
const uk = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const mkB = (id, name, ci, co, extra) => ({
    id, name, checkIn: ci, checkOut: co, adults: 2, children: 0,
    depositPaid: 0, payment: '', holdStatus: 'none', agreedPrice: null, ...extra,
});
const FIX = {
    bookings: {
        jollyboat: [
            // Alice: MID-STAY right now (the who's-at case), paid, damages deposit charged (not yet returnable — she hasn't left).
            mkB(1, 'Alice Marsh', d(-1), d(2), { payment: 'paid', agreedPrice: { total: 440 }, holdStatus: 'charged' }),
            // Bob: arrives in 10 days, £100 down of £500 → £400 to chase (inside the 21-day window).
            mkB(2, 'Bob Carter', d(10), d(13), { payment: 'deposit', depositPaid: 100, agreedPrice: { total: 500 } }),
        ],
        '21a': [
            // Cara: arrives in 2 days, nothing paid → £600 to chase.
            mkB(3, 'Cara Dunn', d(2), d(5), { agreedPrice: { total: 600 } }),
            // Dan: checked out 7 days ago, paid, deposit still charged → THE deposit to return.
            mkB(4, 'Dan Epps', d(-10), d(-7), { payment: 'paid', agreedPrice: { total: 390 }, holdStatus: 'charged' }),
        ],
        pimpernel: [
            // Eve: checks out TODAY (leaving-today case; not "staying now").
            mkB(5, 'Eve Frost', d(-3), d(0), { payment: 'paid', agreedPrice: { total: 520 } }),
            // Finn: 40 days out, owes £600 but OUTSIDE the 21-day chase window.
            mkB(6, 'Finn Gale', d(40), d(45), { payment: 'deposit', depositPaid: 200, agreedPrice: { total: 800 } }),
        ],
    },
    blocks: { '21a': [{ id: 901, source: 'airbnb', checkIn: d(20), checkOut: d(24) }] },
    enquiries: [
        { id: 11, name: 'Enq Smith', propKey: 'jollyboat', checkIn: d(30), receivedAt: d(-1) + 'T10:00:00' },
        { id: 12, name: 'Enq Jones', propKey: '21a', receivedAt: d(0) + 'T09:00:00' },
    ],
    nyMod: { rev: 1, ph: 0, exp: 2 },
};
vm.runInContext(`(function (fx) {
    Object.keys(dbBookings).forEach((k) => { dbBookings[k].length = 0; (fx.bookings[k] || []).forEach((b) => dbBookings[k].push(b)); });
    Object.keys(dbBlocks).forEach((k) => { dbBlocks[k].length = 0; (fx.blocks[k] || []).forEach((b) => dbBlocks[k].push(b)); });
    enquiries = fx.enquiries;
    __nyMod = fx.nyMod;
})(${JSON.stringify(FIX)})`, ctx, { timeout: 2000 });

// ---- Corpus runner ----
// Each case: { q, head: /…/ on the FIRST row (label+sub), any: /…/ on some row,
//              not: /…/ that must appear NOWHERE, min: minimum row count,
//              nul: true → cmdkIntent must return null (out of scope). }
const rowText = (r) => ((r && (r.label || '')) + ' | ' + (r && (r.sub || ''))).trim();
function run(q) {
    const ql = q.trim().toLowerCase();
    return vm.runInContext(`cmdkIntent(${JSON.stringify(ql)})`, ctx, { timeout: 2000 });
}
function judge(c) {
    let rows;
    try { rows = run(c.q); } catch (e) { return fail(`"${c.q}" — cmdkIntent threw: ${e.message}`); }
    if (DUMP) {
        console.log(`\n▸ ${c.q}`);
        (rows || []).slice(0, 4).forEach((r) => console.log('    ' + rowText(r)));
        if (!rows) console.log('    (null)');
        return;
    }
    if (c.nul) return rows === null || rows === undefined ? pass(`"${c.q}" → out of scope (null)`) : fail(`"${c.q}" expected null, got: ${rowText(rows[0])}`);
    if (!Array.isArray(rows) || !rows.length) return fail(`"${c.q}" returned no answer`);
    const texts = rows.map(rowText);
    if (c.head && !c.head.test(texts[0])) return fail(`"${c.q}" head mismatch — got: ${texts[0]}`);
    if (c.any && !texts.some((t) => c.any.test(t))) return fail(`"${c.q}" missing expected row ${c.any} — head: ${texts[0]}`);
    if (c.not && texts.some((t) => c.not.test(t))) return fail(`"${c.q}" contains FORBIDDEN ${c.not}`);
    if (c.min && rows.length < c.min) return fail(`"${c.q}" expected ≥${c.min} rows, got ${rows.length}`);
    pass(`"${c.q}"`);
}

const CASES = [
    // ---- Cottage pivot: who's at / staying in (the Jollyboat regression) ----
    { q: "who's at jollyboat", head: /Alice Marsh is at Jollyboat until/, not: /Nothing upcoming/, any: /In residence/ },
    { q: "who's staying in jollyboat", head: /Alice Marsh is at Jollyboat until/, not: /Nothing upcoming/ },
    { q: 'whos staying in jollyboat', head: /Alice Marsh is at Jollyboat until/, not: /Nothing upcoming/ },
    { q: 'who is staying in jollyboat', head: /Alice Marsh is at Jollyboat until/, not: /Nothing upcoming/ },
    { q: 'anyone at jollyboat', head: /Alice Marsh is at Jollyboat until/ },
    { q: "who's at jollyboat right now", head: new RegExp('Alice Marsh is at Jollyboat until ' + uk(d(2)).replace(/\//g, '\\/')) },
    { q: "who's at 21a", head: /Nobody.s at 21A Westgate right now/, not: /Nothing upcoming/ },
    { q: "who's staying in pimpernel", head: /Nobody.s at Pimpernel right now/, not: /Eve Frost is at/ },
    { q: 'jollyboat bookings', head: /Alice Marsh is at Jollyboat until/, any: /Bob Carter/ },
    { q: 'bookings at 21a', any: /Cara Dunn/, not: /Alice Marsh/ },
    { q: 'jollyboat calendar', head: /Alice Marsh is at Jollyboat/ },
    // ---- Cottage dossier (bare name → facts card) ----
    { q: 'jollyboat', head: /Jollyboat.*Alice Marsh here until/ },
    { q: 'pimpernel', head: /Pimpernel/ },
    { q: 'jollyboat settings', head: /Jollyboat/ },
    // ---- Payments: who owes / paid / deposits ----
    { q: 'who owes me money', head: /3 guests owe £1,600/, any: /Cara Dunn.*£600.*still due/ },
    { q: 'who owes', head: /3 guests owe/ },
    { q: 'outstanding balances', head: /3 guests owe/, not: /Alice Marsh/ },
    { q: "who hasn't paid", head: /3 guests owe/ },
    { q: 'who still owes money', head: /3 guests owe/ },
    { q: "who's paid in full", head: /3 guests paid in full/, any: /Alice Marsh/ },
    { q: 'who has paid in full', head: /3 guests paid in full/ },
    { q: "who's paid a deposit", head: /5 guests paid a deposit/, any: /Bob Carter.*£100\.00 paid/ },
    // ---- Chase / overdue (21-day window; Finn is 40 days out so excluded) ----
    { q: 'overdue balances', head: /2 balances to chase · £1,000/, any: /Cara Dunn/, not: /Finn Gale/ },
    { q: 'balances to chase', head: /2 balances to chase/ },
    { q: 'payments due', head: /2 balances to chase/ },
    // ---- Damages deposits to return (Dan checked out; Alice still in-house) ----
    { q: 'deposits to return', head: /1 deposit to return/, any: /Dan Epps/, not: /Alice Marsh/ },
    { q: 'which deposits do i need to give back', head: /1 deposit to return/ },
    // ---- Leaving / arriving / staying / today ----
    { q: "who's leaving today", head: /1 guest checking out today/, any: /Eve Frost/ },
    { q: 'checkouts today', head: /1 guest checking out today/ },
    { q: 'leaving this week', any: /Eve Frost/ },
    { q: "who's arriving today", head: /No arrivals today/ },
    { q: 'arriving this week', any: /Cara Dunn/ },
    { q: "who's staying now", any: /Alice Marsh/, not: /Eve Frost|Bob Carter/ },
    // NOTE: "who IS here right now" (no apostrophe-s) is a known phrasing gap —
    // branch 5's /who.?s here/ misses it. Widened in the entity-layer PR.
    { q: "who's here right now", any: /Alice Marsh/ },
    { q: 'today', any: /Eve Frost/ },
    // ---- Upcoming ----
    { q: 'upcoming bookings', head: /Next: Cara Dunn/, any: /Bob Carter/, min: 4 },
    { q: "what's coming up", any: /Cara Dunn/ },
    { q: "who's next", head: /Next: Cara Dunn/ },
    // ---- Free tonight (Jollyboat occupied by Alice; Eve leaves today) ----
    { q: "what's free tonight", head: /2 cottages free tonight/ },
    { q: 'any cottage free', head: /2 cottages free tonight/ },
    // ---- Volume / insights (shape-level: numbers move with the calendar) ----
    { q: 'how many bookings this year', head: /\d+ bookings? in \d{4}/ },
    { q: 'how many guests this year', head: /guest|booking/ },
    { q: 'what have i earned this year', head: /£/ },
    { q: 'revenue this year', head: /Income & tax|£/ },
    { q: 'which cottage earns most', head: /Jollyboat|21A Westgate|Pimpernel/ },
    { q: 'busiest month', head: /January|February|March|April|May|June|July|August|September|October|November|December/ },
    // ---- Guest by name ----
    { q: 'alice marsh', head: /Alice Marsh/ },
    { q: 'has alice paid', head: /Alice/ },
    { q: 'has bob paid', head: /Bob/ },
    { q: 'does cara owe money', head: /Cara/ },
    { q: 'has alice been refunded her deposit', head: /Not yet — Alice Marsh.s deposit is still to refund/ },
    { q: 'was dan refunded his deposit', head: /Not yet — Dan Epps.s deposit is still to refund/ },
    // ---- Booking ref + amount ----
    { q: 'chb-000001', head: /Alice Marsh.*CHB-000001/ },
    { q: 'booking 3', head: /Cara Dunn/ },
    { q: '440', head: /1 booking near £440/, any: /Alice Marsh/ },
    // ---- Enquiries ----
    { q: 'enquiries', head: /2 enquiries in the inbox/, any: /Enq Smith/ },
    { q: "who's waiting for a reply", head: /2 enquiries in the inbox/ },
    { q: 'new leads', head: /2 enquiries in the inbox/ },
    // ---- Approvals ----
    { q: 'awaiting approval', head: /1 review · 2 suggestions awaiting approval/ },
    { q: 'anything to approve', head: /1 review · 2 suggestions awaiting approval/ },
    // ---- Month jump + commands (shape only) ----
    { q: 'jump to august', head: /Jump the calendar to 01\/08/ },
    { q: 'block jollyboat next weekend', any: /[Bb]lock.*Jollyboat|Jollyboat.*[Bb]lock/ },
    // ---- Out of scope must stay quiet ----
    { q: 'zxqv plumbus fandangle', nul: true },
    { q: 'welcome text wording ideas', nul: true },
];

console.log('\n== Golden answer-shape corpus ==');
CASES.forEach(judge);

// ---- NLU paraphrase → canonical (the model side of the same contract) ----
if (!DUMP) {
    console.log('\n== Golden NLU paraphrases ==');
    const NLU = [
        ['late payers', /owe|chase|balance/],
        ['is anyone in arrears with me', /owe|chase|balance/],
        ['strongest time of year', /busiest|month/],
        ['stay count rundown', /how many|booking/],
    ];
    NLU.forEach(([q, re]) => {
        let got;
        try { got = (ctx.chbNluClassify(q, true) || {}).canonical || ''; } catch (e) { got = 'THREW: ' + e.message; }
        re.test(got) ? pass(`"${q}" → "${got}"`) : fail(`"${q}" classified as "${got}" (wanted ${re})`);
    });
}

console.log(DUMP ? '\n(dump only — no asserts)' : failures ? `\n${failures} GOLDEN FAILURE(S) ❌` : '\n  ALL GOLDEN CHECKS PASSED ✅');
process.exit(DUMP ? 0 : failures ? 1 : 0);
