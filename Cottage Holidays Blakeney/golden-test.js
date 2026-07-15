#!/usr/bin/env node
// The runtime reckons "today" in Europe/London (todayDashed / uk_date), so the
// fixtures — whose relative dates come from new Date() — must too, or a run in
// the ~1h window after London midnight but before UTC midnight seeds dates one
// day off and every "in N days" / "today" expectation drifts. Pin the process
// to London BEFORE the first Date call (same guard as the ui-test-* suites).
process.env.TZ = 'Europe/London';
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
            mkB(2, 'Bob Carter', d(10), d(13), { payment: 'deposit', depositPaid: 100, agreedPrice: { total: 500 }, email: 'bob@example.com', phone: '07700 900102' }),
        ],
        '21a': [
            // Cara: arrives in 2 days, nothing paid → £600 to chase.
            mkB(3, 'Cara Dunn', d(2), d(5), { agreedPrice: { total: 600 } }),
            // Dan: checked out 7 days ago, paid, deposit still charged → THE deposit to return.
            mkB(4, 'Dan Epps', d(-10), d(-7), { payment: 'paid', agreedPrice: { total: 390 }, holdStatus: 'charged' }),
        ],
        pimpernel: [
            // Eve: checks out TODAY (leaving-today case). checkOutTime 00:00 so
            // she's provably departed at any run time — with time-aware residence
            // (isInResidence) she's cleanly "leaving today" (a date-match departure)
            // WITHOUT being counted as "staying now", deterministically.
            mkB(5, 'Eve Frost', d(-3), d(0), { payment: 'paid', agreedPrice: { total: 520 }, checkOutTime: '00:00' }),
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
    // ---- NL command: "create a booking for <cottage>" prefills that cottage ----
    { q: 'create a booking for 21a', head: /Add booking · 21A Westgate/ },
    { q: 'add a booking for jollyboat', head: /Add booking · Jollyboat/ },
    { q: 'new booking for pimpernel', head: /Add booking · Pimpernel/ },
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
    // ---- Payments: who owes / paid / deposits. Heads are now CONVERSATIONAL
    // (chbSay), so golden asserts the CORRECT content — the total, the salient
    // guest, the count — not the exact phrasing (which varies by design). ----
    { q: 'who owes me money', head: /£1,600/, any: /Cara Dunn.*£600.*still due/ },
    { q: 'who owes', head: /£1,600/ },
    { q: 'outstanding balances', head: /£1,600/, not: /Alice Marsh/ },
    { q: "who hasn't paid", head: /£1,600/ },
    { q: 'who still owes money', head: /£1,600/ },
    { q: "who's paid in full", head: /\b3\b.*(full|settled|squared)/i, any: /Alice Marsh/ },
    { q: 'who has paid in full', head: /\b3\b.*(full|settled|squared)/i },
    { q: "who's paid a deposit", head: /\b5\b.*deposit/i, any: /Bob Carter.*£100\.00 paid/ },
    // ---- Chase / overdue (21-day window; Finn is 40 days out so excluded) ----
    { q: 'overdue balances', head: /2 balances to chase · £1,000/, any: /Cara Dunn/, not: /Finn Gale/ },
    { q: 'balances to chase', head: /2 balances to chase/ },
    { q: 'payments due', head: /2 balances to chase/ },
    // ---- Damages deposits to return (Dan checked out; Alice still in-house) ----
    { q: 'deposits to return', head: /Dan|only one to (return|refund|hand back)/i, any: /Dan Epps/, not: /Alice Marsh/ },
    { q: 'which deposits do i need to give back', head: /Dan|only one to (return|refund|hand back)/i },
    // ---- Leaving / arriving / staying / today ----
    { q: "who's leaving today", head: /Eve|(departure|checkout|heads? off).*today|today/i, any: /Eve Frost/ },
    { q: 'checkouts today', head: /Eve|checkout today|heads? off/i },
    { q: 'leaving this week', any: /Eve Frost/ },
    { q: "who's arriving today", head: /no.*(arriv|check.?in)|quiet|nobody.*(due|arriv)/i },
    { q: 'arriving this week', any: /Cara Dunn/ },
    { q: "who's staying now", any: /Alice Marsh/, not: /Eve Frost|Bob Carter/ },
    { q: "who's here right now", any: /Alice Marsh/ },
    { q: 'who is here right now', any: /Alice Marsh/ }, // the PR-1 phrasing gap, since widened
    // ---- Entity-composed filters (dates + money bounds + cottage, one branch) ----
    { q: 'bookings over £500', head: /3 bookings — over £500/, any: /Finn Gale/, not: /Alice Marsh/ },
    { q: 'bookings under £450', head: /2 bookings — under £450/, any: /Dan Epps/ },
    { q: 'jollyboat bookings over £400', head: /2 bookings — at Jollyboat · over £400/, any: /Bob Carter/, not: /Cara Dunn/ },
    { q: 'stays this year', head: /\d+ bookings? — \d{4}/ },
    { q: 'guests this weekend', head: /this weekend/ },
    { q: 'who was here last week', head: /last week/ },
    { q: 'today', any: /Eve Frost/ },
    // ---- Upcoming ----
    { q: 'upcoming bookings', head: /Cara.*(next|arrives)|next in: cara/i, any: /Bob Carter/, min: 4 },
    { q: "what's coming up", any: /Cara Dunn/ },
    // Composed by the generative branch now — a sentence, same correct guest.
    { q: "who's next", head: /Next arrival: Cara Dunn/ },
    { q: 'who arrives next', head: /Next arrival: Cara Dunn/, any: /Bob Carter/ },
    { q: 'next arrival', head: /Next arrival: Cara Dunn/ },
    // "staying next" reads as the NEXT arrival, never "in-house now".
    { q: "who's staying next", any: /Cara Dunn|Next/, not: /in-house now|staying now|In residence now/ },
    { q: 'who is staying next', any: /Cara Dunn|Next/, not: /in-house now|staying now/ },

    // ---- COMPOSED answers (the generative branch: parse → compute → phrase) ----
    // WHEN — arrivals/departures for a NAMED guest read as a sentence.
    { q: 'when does bob arrive', head: /Bob Carter arrives \w+ \d+ \w+/, any: /in 10 days/ },
    { q: 'when is bob coming', head: /Bob Carter arrives/ },
    { q: 'when does alice leave', head: /Alice Marsh leaves/, not: /arrives/ },
    { q: 'when does eve check out', head: /Eve Frost leaves TODAY/ },
    { q: 'when did dan leave', head: /Dan Epps left/, any: /days ago/ },
    // WHEN + money words = a payment answer, not a date.
    { q: 'when does bob pay', head: /Bob Carter owes £400\.00 — due before the stay/ },
    // HOW LONG — beats the occupancy aggregate when a guest is named.
    { q: 'how long is bob staying', head: /Bob Carter is staying 3 nights/ },
    { q: 'how many nights is cara staying', head: /Cara Dunn is staying 3 nights/, not: /occupancy/ },
    // NEXT-ARRIVAL phrasing must NOT swallow date windows.
    { q: 'who is arriving next week', head: /next week/i, not: /Next arrival:/ },
    // AVAILABILITY answers the ASKED window, not tonight. Whether Bob's
    // d(+10) stay overlaps "next weekend" DEPENDS ON TODAY'S WEEKDAY (from a
    // Thursday, next weekend ends before he arrives), so the relative-window
    // phrasings assert the WINDOW ECHO (the real intent: not "tonight"), and a
    // separate day-anchored case pins the taken-answer deterministically.
    { q: 'is jollyboat free next weekend', head: /Jollyboat is (free|taken) next weekend/, not: /tonight/ },
    { q: 'is jollyboat free in 10 days', head: /No — Jollyboat is taken in 10 days/, any: /Bob Carter/ },
    { q: 'is 21a free tomorrow', head: /Yes — 21A Westgate is free tomorrow/ },
    { q: 'is pimpernel empty this week', head: /Pimpernel is (free|taken) this week/, not: /tonight/ },
    // The airbnb block on 21a counts as taken (d+20..d+24 → "in 3 weeks").
    { q: 'is 21a available in 3 weeks', head: /No — 21A Westgate is taken in 3 weeks/, any: /airbnb/ },
    // CAPACITY from the occupancy limits.
    { q: 'how many people can jollyboat sleep', head: /Jollyboat sleeps up to 2 guests/ },
    { q: 'what is the capacity of pimpernel', head: /Pimpernel sleeps up to 3 guests/, any: /1 child/ },
    // "check out" must never be hijacked by the System-check action.
    { q: 'when does eve check out', not: /System check/ },
    // CONTACT DETAIL — the VALUE is the answer (and its absence is answered too).
    { q: "what's bob's email", head: /Bob Carter.s email is bob@example\.com/ },
    { q: 'bobs phone number', head: /Bob Carter.s phone is 07700 900102/ },
    { q: 'do i have an address for bob', head: /No address on file for Bob Carter/ },

    // ---- SOURCE QUALIFIER — filter by channel (Airbnb / Vrbo / direct) ----
    // The only OTA block in the fixture is 20 days out, so a source query finds
    // it while NEVER leaking the direct bookings (the old bug showed both).
    { q: 'any airbnb bookings', head: /1 Airbnb booking/, any: /Airbnb guest/, not: /Alice|Bob|Cara|Dan/ },
    { q: 'is there an airbnb booking today', head: /No Airbnb bookings today/ },
    { q: 'direct bookings this week', head: /direct booking/, not: /Airbnb guest/ },
    { q: 'any vrbo bookings', head: /No Vrbo bookings/ },

    // ---- DEPOSIT REFUND TIMING (owner → guest, from the hold state) ----
    // Dan checked out days ago with the deposit still charged → owed back now.
    { q: 'when do i owe dan his deposit', head: /Dan Epps.s deposit is due back now/, not: /paid in full/ },
    // Alice is mid-stay with the deposit charged → owed back after her checkout.
    { q: 'when do i owe alice her deposit', head: /owe Alice Marsh their deposit back after checkout/ },

    // ---- "THE guest" (no name) — HOW LONG resolves to the salient stay (Alice,
    // in residence). The arriving-with-time path is covered in search-test with
    // its own fixture (a today-arrival can't live in this interlocked fixture).
    { q: 'how long is the guest staying', head: /Alice Marsh is staying 3 nights/ },
    { q: 'how long are they staying', head: /Alice Marsh is staying 3 nights/ },

    // ---- chbNlg — social / conversational replies (natural language) ----
    // The exact phrasing varies (deterministic pick + time of day), so match the
    // union of the possible replies rather than one fixed string.
    { q: 'hi', head: /would you like to know|ask me anything|What can I get you|Morning|Afternoon|Evening/ },
    { q: 'how are you', head: /would you like to know|ask me anything|What can I get you|Morning|Afternoon|Evening/ },
    { q: 'thanks', head: /Anytime|You.re welcome|No trouble|Happy to help|My pleasure/ },
    { q: 'what can you do', head: /I read your live calendar|answer in your own words/ },
    { q: 'who are you', head: /your booking assistant/ },
    // "who's in" (the missing in-residence phrasing) now answers.
    { q: "who's in", any: /in right now|in-house|Alice/i, not: /Nothing here|no answer/ },
    { q: 'who is in', any: /in right now|in-house|Alice/i },
    // (The dead-end-question FALLBACK is a cmdkBuildResults concern — it only
    // fires when the intent AND fuzzy search are both empty — so it's covered in
    // search-test, not here where only cmdkIntent runs.)
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
    // Business SLANG the stress set surfaced — each maps to its deterministic
    // family, not the classifier (adr → rate, fill rate → occupancy, trade /
    // state of play → the pulse narrative, pipeline → upcoming, top line → revenue).
    { q: 'whats my adr', head: /avg\/night/ },
    { q: 'whats my fill rate', head: /% occupancy/, not: /avg\/night/ },
    { q: 'hows trade', head: /night|quiet|booked/i, any: /nights booked|revenue/ },
    { q: 'state of play', head: /night|quiet|booked/i },
    { q: 'whats in the pipeline', head: /Next arrival|next one in|arrives next|Cara/ },
    { q: 'whats my top line this year', head: /£[\d,.]+ booked in \d{4}/ },
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

// ---- Entity extraction invariants (chbEntities date maths, day-independent) ----
if (!DUMP) {
    console.log('\n== Golden entity extraction ==');
    const ent = (q) => vm.runInContext(`chbEntities(${JSON.stringify(q)})`, ctx, { timeout: 2000 });
    const todayIso = d(0);
    const e1 = ent('bookings in august').dateRange;
    ok2('"in august" → a full August not already past', e1 && /-08-01$/.test(e1.from) && /-08-31$/.test(e1.to) && e1.to >= todayIso);
    const e2 = ent('bookings this month').dateRange;
    ok2('"this month" starts on the 1st of the current month', e2 && e2.from === todayIso.slice(0, 8) + '01');
    const e3 = ent('stays this weekend').dateRange;
    ok2('"this weekend" is Friday→Sunday and not past', e3 && new Date(e3.from + 'T00:00:00').getDay() === 5 && new Date(e3.to + 'T00:00:00').getDay() === 0 && e3.to >= todayIso);
    const e4 = ent('guests last week').dateRange;
    ok2('"last week" is Monday-anchored and fully past', e4 && new Date(e4.from + 'T00:00:00').getDay() === 1 && e4.to < todayIso);
    ok2('"may i see bookings" does NOT read "may" as a month', !ent('may i see bookings').dateRange);
    const e5 = ent('bookings in may 2027').dateRange;
    ok2('"in may 2027" pins the explicit year', e5 && e5.from === '2027-05-01');
    ok2('"over £500" parses the money bound', JSON.stringify(ent('paid over £500').amount) === '{"op":"over","value":500}');
    ok2('cottage name extracted', ent('bookings at jollyboat in august').prop === 'jollyboat');
    function ok2(m, c) { c ? pass(m) : fail(m); }
}

// ---- Conversational follow-ups (one-turn memory: __cmdkConvCtx) ----
if (!DUMP) {
    console.log('\n== Golden conversational follow-ups ==');
    const setCtx = (id) => vm.runInContext(`__cmdkConvCtx = ${id == null ? 'null' : `{ type: 'booking', id: ${id} }`}`, ctx, { timeout: 2000 });
    setCtx(1); // Alice Marsh, mid-stay at Jollyboat, paid £440
    judge({ q: 'when do they leave', head: new RegExp('Alice Marsh leaves ' + uk(d(2)).replace(/\//g, '\\/')) });
    judge({ q: 'when did she arrive', head: new RegExp('Alice Marsh arrived ' + uk(d(-1)).replace(/\//g, '\\/')) });
    judge({ q: 'how much do they owe', head: /Alice Marsh is paid in full — £440/ });
    judge({ q: 'email them', any: /mail|Email/i, min: 2 });
    setCtx(2); // Bob Carter, £100 down of £500
    judge({ q: 'how much does he owe', head: /Bob Carter owes £400\.00 of £500\.00/ });
    judge({ q: 'when does he arrive', head: new RegExp('Bob Carter arrives ' + uk(d(10)).replace(/\//g, '\\/')) });
    setCtx(null); // no conversation → the generic branches keep these
    judge({ q: 'when do they leave', head: /departure|checkout|heads? off|checking out|No check-outs|Nobody heading|quiet/i });
    judge({ q: "who's paid a deposit", head: /\b5\b.*deposit/i }); // pronoun-free query never hijacked even mid-conversation
    setCtx(1);
    judge({ q: "who's paid a deposit", head: /5 guests paid a deposit/ });
    setCtx(null);
}

// ---- Dead-ends review (search-miss capture + teach) ----
if (!DUMP) {
    console.log('\n== Golden dead-ends review ==');
    judge({ q: 'search dead ends', head: /No dead ends/ });
    vm.runInContext(
        `chbNluStore('chb-search-misses', [{ t: 'weather for changeover', n: 2, at: '2026-01-01' }, { t: 'paint the fence', n: 1, at: '2026-01-02' }]); CHB_NLU.misses = null;`,
        ctx, { timeout: 2000 },
    );
    judge({ q: 'search dead ends', head: /2 searches found nothing/, any: /weather for changeover.*Searched 2 times|Searched 2 times/ });
    judge({ q: 'teach the assistant', head: /2 searches found nothing/ });
    judge({ q: 'search misses', head: /2 searches found nothing/ });
}

console.log(DUMP ? '\n(dump only — no asserts)' : failures ? `\n${failures} GOLDEN FAILURE(S) ❌` : '\n  ALL GOLDEN CHECKS PASSED ✅');
process.exit(DUMP ? 0 : failures ? 1 : 0);
