#!/usr/bin/env node
// The runtime reckons "today" in Europe/London (todayDashed) while the
// time-of-day helpers (hasCheckedIn/Out) read the wall clock — pin the process
// to London BEFORE the first Date call so the two agree (else a run in the ~1h
// window after London midnight sees a 15:00 arrival as already arrived).
process.env.TZ = 'Europe/London';
/* ============================================================
 *  search-test.js — completeness gate for the ⌘K search registry.
 *
 *  DEVELOPMENT / CI tool (not uploaded to the web server).
 *
 *      node search-test.js
 *
 *  The admin feature registry (cmdkRegistry() in admin.js) is the single
 *  source of truth for every admin DESTINATION search can route to. This test
 *  loads app.js + admin.js in a browser-like shim and proves the registry, the
 *  pages and the routing code agree — so a new/renamed section can't silently
 *  become unreachable from search:
 *
 *    - every registered Manage section has a real #sec-<id> page in index.html
 *    - cmdkScreens() is generated 1:1 from the registry, all routes are functions
 *    - cmdkActions() rows are all runnable + carry a natural-language regex
 *    - every section a search action/dossier routes to (toManage/toMng/toAccom,
 *      settings*AccomSec) is a registered section — no dangling routes
 *    - no duplicate ids
 *
 *  Exit 0 = all good. Exit 1 = drift.
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
let failures = 0;
const pass = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failures++; console.log('  ✗ ' + m); };
const check = (name, cond, extra) => { cond ? pass(name) : fail(name + (extra ? ' — ' + extra : '')); };

const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const appScript = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
const adminScript = fs.readFileSync(path.join(DIR, 'admin.js'), 'utf8');

console.log('\n== ⌘K search registry completeness ==');

// ---- Minimal fake-browser shim (same shape as smoke-test.js) ----
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
    fetch: () => Promise.reject(new Error('no network in search test')),
    localStorage: (() => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }; })(),
    navigator: { credentials: undefined, userAgent: 'node-search-test' },
    document: documentShim,
};
sandbox.TextDecoder = TextDecoder;
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
    vm.runInContext(appScript, ctx, { filename: 'app.js', timeout: 5000 });
    vm.runInContext(adminScript, ctx, { filename: 'admin.js', timeout: 5000 });
    pass('app.js + admin.js evaluated without throwing');
} catch (e) {
    fail('bundle threw on load: ' + e.message);
    process.exit(1);
}

const registry = typeof ctx.cmdkRegistry === 'function' ? ctx.cmdkRegistry() : null;
check('cmdkRegistry() is defined and returns a non-empty list', Array.isArray(registry) && registry.length > 0);
if (!registry) { console.log('\nFATAL: no registry.\n'); process.exit(1); }

// ---- 1. Registry shape ----
const ids = registry.map((e) => e.id);
check('every registry entry has a unique id', new Set(ids).size === ids.length, 'dupes: ' + ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
check('every registry entry has a non-empty label', registry.every((e) => typeof e.label === 'string' && e.label.trim()));
check('every registry entry has a section OR a go()', registry.every((e) => typeof e.sec === 'string' || typeof e.go === 'function'));

// ---- 2. Every registered section has a real page ----
const pageSecs = new Set([...html.matchAll(/id="sec-([a-z0-9-]+)"/g)].map((m) => m[1]));
const regSecs = new Set(registry.filter((e) => e.sec).map((e) => e.sec));
const missingPages = [...regSecs].filter((s) => !pageSecs.has(s));
check('every registered Manage section has a #sec-<id> page in index.html', missingPages.length === 0, 'missing page for: ' + missingPages.join(', '));

// ---- 3. cmdkScreens() is generated 1:1 from the registry, all runnable ----
const screens = typeof ctx.cmdkScreens === 'function' ? ctx.cmdkScreens() : [];
check('cmdkScreens() has one entry per registry feature', screens.length === registry.length, `${screens.length} vs ${registry.length}`);
check('every screen has a run() function', screens.every((s) => typeof s.run === 'function'));
check('every screen has a non-empty label', screens.every((s) => typeof s.label === 'string' && s.label.trim()));
const scrIds = screens.map((s) => s.id);
check('screen ids are unique', new Set(scrIds).size === scrIds.length);

// ---- 4. cmdkActions() rows are runnable + carry a natural-language regex ----
const actions = typeof ctx.cmdkActions === 'function' ? ctx.cmdkActions('') : [];
check('cmdkActions() returns a non-empty catalog', actions.length > 0);
check('every action has a run() function', actions.every((a) => typeof a.run === 'function'));
// (duck-typed, not instanceof — regexes built inside the vm realm aren't
// instanceof the test realm's RegExp.)
check('every action carries a natural-language regex (re)', actions.every((a) => a.re && typeof a.re.test === 'function' && typeof a.re.source === 'string'));
check('every action has a non-empty label', actions.every((a) => typeof a.label === 'string' && a.label.trim()));
const actIds = actions.map((a) => a.id);
check('action ids are unique', new Set(actIds).size === actIds.length, 'dupes: ' + actIds.filter((id, i) => actIds.indexOf(id) !== i).join(', '));
// Action/command parity: the "do it" one-tap actions are present.
const parityActs = ['act-expense', 'act-csv', 'act-syncnow', 'act-fixsafe'];
check('parity actions present (add expense / export CSV / sync now / fix safe)', parityActs.every((id) => actIds.includes(id)), 'missing: ' + parityActs.filter((id) => !actIds.includes(id)).join(', '));
// Coverage: Payments sub-tabs reachable directly from search.
const covActs = ['act-income', 'act-recentpay', 'act-pricingcoach'];
check('Payments sub-tab actions present (income / recent / pricing coach)', covActs.every((id) => actIds.includes(id)), 'missing: ' + covActs.filter((id) => !actIds.includes(id)).join(', '));

// ---- 5. No search route points at an unregistered / non-existent section ----
// The per-cottage editors live in ACCOM_SECTIONS (rendered dynamically, no
// #sec page of their own), so their routes are checked against that list.
const accomSecs = new Set([...(adminScript.match(/ACCOM_SECTIONS\s*=\s*\[([\s\S]*?)\n\];/) || [null, ''])[1].matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
check('ACCOM_SECTIONS is defined with ids', accomSecs.size > 0);

const litManage = [...adminScript.matchAll(/\btoM(?:anage|ng)\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
const badManage = [...new Set(litManage)].filter((s) => !regSecs.has(s));
check('every toManage()/toMng() route targets a registered section', badManage.length === 0, 'unregistered: ' + badManage.join(', '));

const litAccom = [
    ...[...adminScript.matchAll(/\btoAccom\('([a-z0-9-]+)'\)/g)].map((m) => m[1]),
    ...[...adminScript.matchAll(/settings(?:Goto|Open)AccomSec\([^,]+,\s*'([a-z0-9-]+)'\)/g)].map((m) => m[1]),
];
const badAccom = [...new Set(litAccom)].filter((s) => !accomSecs.has(s));
check('every cottage-section route targets a real ACCOM_SECTIONS id', badAccom.length === 0, 'unknown: ' + badAccom.join(', '));

// ---- 6. Inline field editor registry (cmdkFields) — Tier-1 edit-in-search ----
// app.js seeds propertyMeta with the default cottages (shared lexical scope in the
// vm), so cmdkFields() builds real per-cottage fields with no extra seeding.
const fields = typeof ctx.cmdkFields === 'function' ? ctx.cmdkFields('') : null;
check('cmdkFields() is defined and returns a list', Array.isArray(fields), typeof ctx.cmdkFields);
if (Array.isArray(fields)) {
    check('cmdkFields() produced fields for the seeded cottage', fields.length > 0);
    check('every field has type "field"', fields.every((f) => f.type === 'field'));
    check('field ids are unique', new Set(fields.map((f) => f.id)).size === fields.length);
    check('every field has a non-empty label', fields.every((f) => typeof f.label === 'string' && f.label.trim()));
    check('every field carries get() and set() functions', fields.every((f) => typeof f.get === 'function' && typeof f.set === 'function'));
    check('every field ftype is text, textarea or number', fields.every((f) => f.ftype === 'text' || f.ftype === 'textarea' || f.ftype === 'number'));
    check('every field has a run() that opens the editor', fields.every((f) => typeof f.run === 'function'));
    let getOk = true;
    try { fields.forEach((f) => { if (typeof f.get() !== 'string') getOk = false; }); } catch (e) { getOk = false; }
    check('every field get() returns a string without throwing', getOk);
}
check('cmdkFieldOpen/Save/Back editor fns are defined', typeof ctx.cmdkFieldOpen === 'function' && typeof ctx.cmdkFieldSave === 'function' && typeof ctx.cmdkFieldBack === 'function');

// ---- 7. Tier-2 section sheets (cmdkSheets) — host a real screen in the palette ----
const sheets = typeof ctx.cmdkSheets === 'function' ? ctx.cmdkSheets('') : null;
check('cmdkSheets() is defined and returns a non-empty list', Array.isArray(sheets) && sheets.length > 0, typeof ctx.cmdkSheets);
if (Array.isArray(sheets)) {
    check('every sheet has type "sheet"', sheets.every((s) => s.type === 'sheet'));
    check('every sheet has a run() function', sheets.every((s) => typeof s.run === 'function'));
    check('every sheet has a non-empty label', sheets.every((s) => typeof s.label === 'string' && s.label.trim()));
    check('sheet ids are unique', new Set(sheets.map((s) => s.id)).size === sheets.length);
    // Each sheet must target a REAL #sec-<section> page (parsed from its run source).
    const sheetSecs = sheets.map((s) => { const m = /cmdkSheetOpen\(\s*'([a-z0-9-]+)'/.exec(String(s.run)); return m ? m[1] : null; });
    check('every sheet targets a real #sec-<section> page', sheetSecs.every((id) => id && pageSecs.has(id)), 'bad: ' + sheetSecs.join(', '));
}
check('cmdkSheetOpen/Close/Restore fns are defined', typeof ctx.cmdkSheetOpen === 'function' && typeof ctx.cmdkSheetClose === 'function' && typeof ctx.cmdkSheetRestore === 'function');
check('settingsRenderSection + cmdkOpenSection defined (search-first section routing)', typeof ctx.settingsRenderSection === 'function' && typeof ctx.cmdkOpenSection === 'function');

// Every section a router literal targets must be a real registered section /
// ACCOM_SECTIONS id — catches typos in help topics, actions, dossiers alike.
const openSecTargets = [...adminScript.matchAll(/\bcmdkOpenSection\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
check('every cmdkOpenSection() targets a registered section', [...new Set(openSecTargets)].every((s) => regSecs.has(s)), 'bad: ' + [...new Set(openSecTargets)].filter((s) => !regSecs.has(s)).join(', '));
const openAccomTargets = [...adminScript.matchAll(/\bcmdkOpenAccomSec\([^,]+,\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
check('every cmdkOpenAccomSec() targets a real ACCOM_SECTIONS id', [...new Set(openAccomTargets)].every((s) => accomSecs.has(s)), 'bad: ' + [...new Set(openAccomTargets)].filter((s) => !accomSecs.has(s)).join(', '));

// ---- 8. Help & how-to topics (cmdkHelp) ----
const help = typeof ctx.helpTopics === 'function' ? ctx.helpTopics() : null;
check('helpTopics() is defined and returns a non-empty list', Array.isArray(help) && help.length > 0, typeof ctx.helpTopics);
if (Array.isArray(help)) {
    const hids = help.map((t) => t.id);
    check('help topic ids are unique', new Set(hids).size === hids.length, 'dupes: ' + hids.filter((id, i) => hids.indexOf(id) !== i).join(', '));
    check('every help topic has a non-empty title', help.every((t) => typeof t.title === 'string' && t.title.trim()));
    check('every help topic has keywords', help.every((t) => typeof t.kw === 'string' && t.kw.trim()));
    check('every help topic has at least one step', help.every((t) => Array.isArray(t.steps) && t.steps.length > 0 && t.steps.every((s) => typeof s === 'string' && s.trim())));
    check('every help topic has a doIt or showMe with a run()', help.every((t) => (t.doIt && typeof t.doIt.run === 'function') || (t.showMe && typeof t.showMe.run === 'function')));
    // related ids must resolve to real topics
    const hset = new Set(hids);
    const badRel = help.flatMap((t) => (t.related || []).filter((r) => !hset.has(r)));
    check('every "related" id resolves to a real topic', badRel.length === 0, 'unknown: ' + badRel.join(', '));
}
// An explicit "how do I…" with a decisive winner GENERATES a natural-language
// how-to: ONE answer row whose flowing paragraph (nlgBody) realizes the steps,
// not a stack of topic rows.
const helpAns = typeof ctx.cmdkHelp === 'function' ? ctx.cmdkHelp('how do i refund a deposit') : null;
check('cmdkHelp() generates a single how-to ANSWER for a decisive question',
    Array.isArray(helpAns) && helpAns.length === 1 && helpAns[0].type === 'answer' && /^nlg-howto-/.test(helpAns[0].id || ''),
    'got ' + (helpAns ? JSON.stringify(helpAns.map((h) => h.type + ':' + h.id)) : 'null'));
check('the generated how-to reads as a flowing paragraph (nlgBody), keeps its action + steps',
    !!helpAns && typeof helpAns[0].nlgBody === 'string' && helpAns[0].nlgBody.length > 40 && Array.isArray(helpAns[0].steps) && helpAns[0].steps.length > 0 && Array.isArray(helpAns[0].chips) && helpAns[0].chips.length > 0,
    'body=' + (helpAns && helpAns[0] ? (helpAns[0].nlgBody || '').slice(0, 60) : 'n/a'));
check('the how-to leads with a "How to …" phrasing', !!helpAns && /^how (to|do|can)\b/i.test(helpAns[0].label || ''), 'label=' + (helpAns && helpAns[0] ? helpAns[0].label : 'n/a'));
// chbNlgHowTo is a pure realizer over a topic — spot-check it directly.
if (typeof ctx.chbNlgHowTo === 'function' && Array.isArray(help)) {
    const bk = help.find((t) => t.id === 'add-booking');
    const ht = bk ? ctx.chbNlgHowTo(bk, []) : null;
    check('chbNlgHowTo() stitches steps with connectives (First…/Finally…)',
        !!ht && /\bFirst,/.test(ht.nlgBody) && /\bFinally,/.test(ht.nlgBody), 'body=' + (ht ? ht.nlgBody.slice(0, 80) : 'n/a'));
}
// A vague keyword (no decisive question) still returns the browsable topic rows.
const helpKw = typeof ctx.cmdkHelp === 'function' ? ctx.cmdkHelp('deposit') : null;
check('a plain keyword still returns browsable help topic rows', Array.isArray(helpKw) && helpKw.length > 0 && helpKw.every((h) => h.type === 'help'), 'got ' + (helpKw ? helpKw.map((h) => h.type).join(',') : 'null'));
check('cmdkHelp() ignores a non-matching non-question', Array.isArray(ctx.cmdkHelp && ctx.cmdkHelp('xyzzy')) && ctx.cmdkHelp('xyzzy').length === 0);

// Context-aware "?" — every id in HELP_INDEX / HELP_CONTEXT must be a real topic.
if (Array.isArray(help)) {
    const hset = new Set(help.map((t) => t.id));
    const grabIds = (name) => {
        const m = adminScript.match(new RegExp('const ' + name + '\\s*=\\s*([\\s\\S]*?);'));
        if (!m) return null;
        // Only pull ids inside [ … ] arrays (the topic-id lists) — not object keys.
        return [...m[1].matchAll(/\[([^\]]*)\]/g)].flatMap((a) => [...a[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]));
    };
    const idxIds = grabIds('HELP_INDEX');
    const ctxIds = grabIds('HELP_CONTEXT');
    check('HELP_INDEX ids all resolve to real topics', idxIds && idxIds.length > 0 && idxIds.every((id) => hset.has(id)), 'bad: ' + (idxIds || []).filter((id) => !hset.has(id)).join(', '));
    check('HELP_CONTEXT ids all resolve to real topics', ctxIds && ctxIds.length > 0 && ctxIds.every((id) => hset.has(id)), 'bad: ' + (ctxIds || []).filter((id) => !hset.has(id)).join(', '));
}
check('cmdkHelpItems() maps ids to items', typeof ctx.cmdkHelpItems === 'function' && ctx.cmdkHelpItems(['add-booking']).length === 1 && ctx.cmdkHelpItems(['add-booking'])[0].type === 'help');
check('context help fns are defined (cmdkCurrentHelpIds, cmdkHelpOpen)', typeof ctx.cmdkCurrentHelpIds === 'function' && typeof ctx.cmdkHelpOpen === 'function');
check('coach-mark fns are defined (coachMark, coachClear, coach flows)', typeof ctx.coachMark === 'function' && typeof ctx.coachClear === 'function' && typeof ctx.coachAddBooking === 'function' && typeof ctx.coachBlockDates === 'function');

// ---- 8. Server results deep-link to the EXACT record + act inline ----
if (typeof ctx.cmdkServerItem === 'function') {
    const types = ['booking', 'enquiry', 'guest', 'message', 'review', 'email', 'payment', 'activity', 'expense', 'waitlist', 'subscriber', 'experience'];
    const items = types.map((t) => ctx.cmdkServerItem({ type: t, id: 7, booking_id: 7, thread_id: 7, email: 'a@b.co', title: 'x', sub: 's' }));
    check('cmdkServerItem() maps every server type to a runnable row', items.every((it) => it && typeof it.run === 'function'), items.map((i) => (i ? i.type : 'null')).join(','));
    const rev = ctx.cmdkServerItem({ type: 'review', id: 9, title: 'Lovely stay' });
    check('review rows carry inline Approve/Decline actions', !!(rev && Array.isArray(rev.actions) && rev.actions.length === 2 && rev.actions.every((a) => typeof a.run === 'function')));
    check(
        'deep-link reveal helpers are defined',
        typeof ctx.cmdkFlash === 'function' &&
            typeof ctx.cmdkPoll === 'function' &&
            typeof ctx.cmdkRevealGuest === 'function' &&
            typeof ctx.cmdkRevealReview === 'function' &&
            typeof ctx.cmdkRevealActivity === 'function' &&
            typeof ctx.cmdkOpenEmail === 'function' &&
            typeof ctx.cmdkModerateReview === 'function',
    );
} else {
    check('cmdkServerItem() is defined', false);
}

// ---- 8b. Deep Search ("search everything") entrypoints exist + reuse routing ----
check(
    'deep search fns are defined (open/close/filter/expand + renderer + cta)',
    ['cmdkDeepOpen', 'cmdkDeepClose', 'cmdkDeepFilter', 'cmdkDeepExpand', 'cmdkRenderDeep', 'cmdkDeepApply', 'cmdkDeepCta'].every((f) => typeof ctx[f] === 'function'),
);

// ---- 8c. Unified search core: the modular source registry (CHB_SEARCH) ----
if (ctx.CHB_SEARCH && typeof ctx.CHB_SEARCH.registerSource === 'function') {
    const built = ctx.CHB_SEARCH.sources();
    check('CHB_SEARCH registry carries the built-in sources', ['records', 'actions', 'screens', 'fields', 'sheets'].every((id) => built.includes(id)), built.join(','));
    ctx.CHB_SEARCH.registerSource('__unittest', () => [{ type: 'action', id: '__ut', label: '__ut', run() {} }], 5);
    check('CHB_SEARCH.registerSource() adds a modular source (upgradable)', ctx.CHB_SEARCH.sources().includes('__unittest'));
    // cmdkAll pools from the registry — even if a data-backed source throws in the
    // shim, the collector is wrapped, so the runtime source still comes through.
    check('cmdkAll() pools the registry', typeof ctx.cmdkAll === 'function' && ctx.cmdkAll('x').some((it) => it && it.label === '__ut'));
    ctx.CHB_SEARCH.registerSource('__unittest', () => [], 5); // reset so nothing leaks
    // Shared query-understanding: tokenise + synonym expansion + intent flags.
    if (typeof ctx.CHB_SEARCH.understand === 'function') {
        const u = ctx.CHB_SEARCH.understand('revenue smith');
        check('CHB_SEARCH.understand() tokenises + expands synonyms', u && Array.isArray(u.words) && u.words.length === 2 && u.synonyms && u.synonyms.revenue && u.synonyms.revenue.includes('money'));
        const p = ctx.CHB_SEARCH.understand('how do i refund a deposit');
        const m = ctx.CHB_SEARCH.understand('how much did i earn');
        check('CHB_SEARCH.understand() classifies procedural vs metric intent', p.flags.procedural === true && m.flags.procedural === false);
    } else {
        check('CHB_SEARCH.understand() is defined', false);
    }
    // CHB's OWN trained NLU model — quality gates. The model is deterministic
    // (authored corpus → TF-IDF centroids), so accuracy is CI-testable: these
    // floors were measured at tuning time (train 106/108, held-out 13/14,
    // negatives 8/8, ZERO wrong-class picks) and must never regress. A "miss"
    // below threshold is safe (falls back to normal search); a WRONG-class
    // pick would answer the wrong question, so that stays at zero.
    if (ctx.CHB_SEARCH.nlu && typeof ctx.chbNluClassify === 'function') {
        ctx.chbNluTrain();
        const nlu = ctx.CHB_SEARCH.nlu;
        let trainOk = 0, trainN = 0, wrong = [];
        for (const c of nlu.corpus) for (const ex of c.examples) {
            trainN++;
            const g = ctx.chbNluClassify(ex);
            if (g && g.canonical === c.canonical) trainOk++;
            else if (g) wrong.push(ex + '→' + g.canonical);
        }
        check(`NLU train accuracy ≥ 96% (${trainOk}/${trainN})`, trainOk / trainN >= 0.96);
        const heldout = [
            ['is anyone in arrears with me', 'who owes me money'],
            ['guests going home today', 'leaving today'],
            ['who arrives this afternoon', 'arriving today'],
            ['what bookings are ahead of us', 'upcoming bookings'],
            ['do i owe anyone their deposit back', 'deposits to return'],
            ['who do i need to remind to pay', 'balances to chase'],
            ['total number of bookings so far this year', 'how many bookings this year'],
            ['what are my earnings looking like this year', 'revenue this year'],
            ['how full have we been', 'occupancy this year'],
            ['what time of year is strongest', 'busiest month'],
            ['which of the cottages performs best', 'which cottage earns most'],
            ['average charge for one night', 'average nightly rate'],
            ['overall how is everything going', "how's business"],
        ];
        let ho = 0;
        for (const [q, want] of heldout) {
            const g = ctx.chbNluClassify(q);
            if (g && g.canonical === want) ho++;
            else if (g) wrong.push(q + '→' + g.canonical);
        }
        check(`NLU held-out (unseen phrasings) ≥ 12/13 (${ho}/13)`, ho >= 12);
        const negatives = ['sarah pemberton', 'jollyboat photos', 'wifi password for guests', 'seasonal rates grid', 'add booking for smith', 'hero image', 'newsletter subscribers'];
        const negOk = negatives.filter((q) => !ctx.chbNluClassify(q)).length;
        check(`NLU rejects all off-corpus queries (${negOk}/${negatives.length})`, negOk === negatives.length);
        check('NLU never picks the WRONG intent' + (wrong.length ? ' — ' + wrong.slice(0, 3).join(' | ') : ''), wrong.length === 0);
        // Every canonical the model maps to must be non-empty text (the intent
        // engine executes it; the browser suite proves the routing end-to-end).
        check('every NLU canonical is a non-empty phrase', nlu.corpus.every((c) => c.canonical && c.canonical.length > 3));
    } else {
        check('CHB_SEARCH.nlu (our own model) is defined', false);
    }
    // ML-powered search layer (rides the same owned model machinery) —
    // semantic retrieval, online learning, and near-miss suggestions.
    if (typeof ctx.chbRankQuery === 'function' && ctx.CHB_SEARCH.rank) {
        const pool = ctx.cmdkAll('');
        const lab = new Map();
        pool.forEach((it) => { if (it && it.id != null) lab.set(it.type + ':' + it.id, it.label); });
        const hits = ctx.chbRankQuery('create a reservation').map((h) => lab.get(h.k) || '');
        check('semantic retrieval: "create a reservation" recalls "Add a booking"', hits.some((l) => /add a booking/i.test(l)), hits.join(' | '));
        const season = ctx.chbRankQuery('season pricing').map((h) => lab.get(h.k) || '');
        check('semantic retrieval: "season pricing" recalls the seasonal rates', season.some((l) => /seasonal rate/i.test(l)));
        check('semantic retrieval rejects junk + names', ctx.chbRankQuery('zzqqxx blorp').length === 0 && ctx.chbRankQuery('sarah pemberton').length === 0);
    } else {
        check('CHB_RANK semantic retrieval is defined', false);
    }
    if (typeof ctx.chbNluLearn === 'function' && typeof ctx.chbNluSuppress === 'function' && typeof ctx.chbNluSuggest === 'function') {
        // (v2 note: the old fixture "gimme the arrears rundown" is now correctly
        // CLASSIFIED by the deep tier — the model got better — so the unknown-
        // phrase fixture uses slang with no corpus vocabulary at all.)
        check('learning: unknown phrasing starts rejected', ctx.chbNluClassify('wheres the wonga at') === null);
        ctx.chbNluLearn('wheres the wonga at', 'who owes me money');
        const g = ctx.chbNluClassify('wheres the wonga at');
        check('learning: accepted phrasing now classifies to its intent', !!(g && g.canonical === 'who owes me money'));
        ctx.chbNluSuppress('wheres the wonga at');
        check('learning: suppression un-teaches it', ctx.chbNluClassify('wheres the wonga at') === null);
        const sug = ctx.chbNluSuggest('who is checking in');
        check('near-miss suggest: ambiguous query offers the closest questions', sug.includes('arriving today') && sug.includes('leaving today'), sug.join(','));
        check('near-miss suggest: gibberish offers nothing', ctx.chbNluSuggest('zzqqxx blorp').length === 0);
    } else {
        check('NLU learning + suggest fns are defined', false);
    }
    // The one matcher the standalone list filters (mailbox/messages) now share.
    if (typeof ctx.CHB_SEARCH.matches === 'function') {
        const mt = ctx.CHB_SEARCH.matches;
        check('CHB_SEARCH.matches() empty=all, single-term substring (parity)', mt('anything', '') === true && mt('Smith deposit', 'smith') === true && mt('Jones', 'smith') === false);
        check('CHB_SEARCH.matches() multi-term AND + synonym expansion', mt('Smith, John', 'john smith') === true && mt('Smith only', 'john smith') === false && mt('quarterly money report', 'revenue') === true);
    } else {
        check('CHB_SEARCH.matches() is defined', false);
    }
} else {
    check('CHB_SEARCH source registry is defined', false);
}

// ---- 9. Search scopes (ubiquity: pre-scope to the current workspace) ----
check(
    'scope helpers are defined',
    typeof ctx.cmdkScopeMatch === 'function' && typeof ctx.cmdkInScope === 'function' && typeof ctx.cmdkScopeBar === 'function' && typeof ctx.cmdkSetScope === 'function' && typeof ctx.cmdkDefaultScope === 'function',
);
if (typeof ctx.cmdkScopeMatch === 'function') {
    const m = ctx.cmdkScopeMatch;
    check('scope=bookings keeps bookings, drops emails, keeps actions', m('bookings', 'booking') === true && m('bookings', 'email') === false && m('bookings', 'action') === true);
    check('scope=money keeps payments/expenses, drops bookings', m('money', 'payment') === true && m('money', 'expense') === true && m('money', 'booking') === false);
    check('scope=inbox keeps messages/emails, drops guests', m('inbox', 'message') === true && m('inbox', 'email') === true && m('inbox', 'guest') === false);
    check('scope=guests keeps guests/reviews, drops payments', m('guests', 'guest') === true && m('guests', 'review') === true && m('guests', 'payment') === false);
    check('scope=all keeps everything', m('all', 'booking') === true && m('all', 'email') === true);
    check('screens/help/answers are never scoped away', m('bookings', 'screen') === true && m('money', 'help') === true && m('guests', 'answer') === true);
    check('scope bar renders a chip per scope (all/bookings/inbox/money/guests)', (ctx.cmdkScopeBar().match(/class="cmdk-scope/g) || []).length >= 5);
}
// Empty-palette scope filter: screens carry a scope so each chip narrows the
// "Jump to" list (fixes "the scope chips do nothing on the empty palette").
if (typeof ctx.cmdkScreens === 'function') {
    const scr = ctx.cmdkScreens();
    const byId = {};
    scr.forEach((s) => { byId[s.id] = s; });
    check(
        'screens carry a scope tag (today→bookings, inbox→inbox, payments→money, guests→guests)',
        (byId['scr-today'] || {}).scope === 'bookings' && (byId['scr-inbox'] || {}).scope === 'inbox' && (byId['scr-payments-area'] || {}).scope === 'money' && (byId['scr-guests'] || {}).scope === 'guests',
    );
    const per = (sc) => scr.filter((s) => s.scope === sc).length;
    check('each scope has ≥2 Jump-to destinations', per('bookings') >= 2 && per('inbox') >= 2 && per('money') >= 2 && per('guests') >= 2);
}

// ---- 10. Today × Search (filter board, calendar reveal, gaps, needs-you) ----
check(
    'Today-search helpers are defined',
    typeof ctx.cmdkShowOnCalendar === 'function' &&
        typeof ctx.cmdkJumpTimeline === 'function' &&
        typeof ctx.applyTodayFilter === 'function' &&
        typeof ctx.clearTodayFilter === 'function' &&
        typeof ctx.todayGaps === 'function' &&
        typeof ctx.needsYouItems === 'function',
);
check('"Filter the Today board" action is present', actIds.includes('act-filterboard'));
if (typeof ctx.cmdkBookingActions === 'function') {
    const acts = ctx.cmdkBookingActions({ id: 1, checkIn: '2026-08-01', checkOut: '2026-08-05' }, '21a');
    check('booking rows gain a "Show on calendar" quick-action', Array.isArray(acts) && acts.some((a) => a.key === 'cal'));
}
if (typeof ctx.cmdkIntent === 'function') {
    const ny = ctx.cmdkIntent('what needs me');
    check('"what needs me" → a needs-you answer list', Array.isArray(ny) && ny.length >= 1 && ny[0].type === 'answer');
    const gaps = ctx.cmdkIntent('gaps next month');
    check('"gaps next month" → an availability answer list', Array.isArray(gaps) && gaps.length >= 1 && gaps[0].type === 'answer');
    const jump = ctx.cmdkIntent('jump to august');
    check('"jump to august" → a calendar-jump answer', Array.isArray(jump) && jump.length === 1 && typeof jump[0].run === 'function');
}
check('todayGaps returns an array', Array.isArray(ctx.todayGaps && ctx.todayGaps('2026-08-01', '2026-10-01')));
// The board filter now targets whichever workspace you're on (Today/Inbox/Payments).
check('cmdkActiveWorkspace() is defined and defaults to a real workspace', typeof ctx.cmdkActiveWorkspace === 'function' && ['view-backoffice', 'view-inbox', 'view-accounts'].includes(ctx.cmdkActiveWorkspace()));

// ---- 11. Entity-aware search (Siri-style: act on the record you're viewing) ----
// Entity suggestions live ONLY in the ⌘K palette now — the on-page "Suggested"
// hub strip (cmdkHubSuggestInject) was removed, so it must NOT come back.
check('entity helpers are defined', typeof ctx.cmdkCurrentEntity === 'function' && typeof ctx.cmdkEntityActions === 'function');
check('the on-page hub-suggest strip is gone (palette-only suggestions)', typeof ctx.cmdkHubSuggestInject === 'undefined');
if (typeof ctx.cmdkEntityActions === 'function') {
    const bookActs = ctx.cmdkEntityActions({ type: 'booking', id: 1, name: 'Jane', b: { id: 1, checkIn: '2026-08-01', checkOut: '2026-08-05' } });
    check('a booking entity suggests actions incl. "Their other stays"', Array.isArray(bookActs) && bookActs.length >= 2 && bookActs.some((a) => /other stays/i.test(a.label)) && bookActs.every((a) => typeof a.run === 'function'));
    const enqActs = ctx.cmdkEntityActions({ type: 'enquiry', id: 2, name: 'Bob' });
    check('an enquiry entity suggests Approve / Email / Decline', Array.isArray(enqActs) && enqActs.length === 4 && enqActs.some((a) => /approve/i.test(a.label)) && enqActs.some((a) => /decline/i.test(a.label)));
    check('no entity → no suggestions', ctx.cmdkEntityActions(null).length === 0);
}

// ---- 12. Page-context layer (search aware of what's on screen) ----
check('page-context helpers are defined', typeof ctx.cmdkPageContext === 'function' && typeof ctx.cmdkContextSuggest === 'function' && typeof ctx.cmdkCalendarMonthInView === 'function');
if (typeof ctx.cmdkPageContext === 'function') {
    const pc = ctx.cmdkPageContext();
    const KEYS = ['view', 'cottage', 'cottageName', 'section', 'subtab', 'folder', 'calendarMonth', 'entity'];
    check('cmdkPageContext() returns the full shape', pc && typeof pc === 'object' && KEYS.every((k) => k in pc));
    // Off-DOM (test shim) every signal degrades to null — proves it never throws
    // and is safe to call from any screen.
    check('cmdkPageContext() degrades to all-null off-DOM', KEYS.every((k) => pc[k] === null));
    check('cmdkCalendarMonthInView() is null when the timeline is not rendered', ctx.cmdkCalendarMonthInView() === null);
    check('cmdkContextSuggest() returns an array (empty with no page context)', Array.isArray(ctx.cmdkContextSuggest()) && ctx.cmdkContextSuggest().length === 0);
}

// ---- 13. Result declutter: dedup + activity collapse (cmdkArrange) ----
check('cmdkActKey normalises trailing ellipsis/space', typeof ctx.cmdkActKey === 'function' && ctx.cmdkActKey('Card balance declined — £556.20 …') === 'card balance declined — £556.20');
if (typeof ctx.cmdkArrange === 'function') {
    // Repeated activity (same event logged several times) collapses to one row.
    const acts = ctx.cmdkArrange([
        { type: 'activity', label: 'Card balance declined — £556.20', sub: 'a' },
        { type: 'activity', label: 'Card balance declined — £556.20', sub: 'b' },
        { type: 'activity', label: 'Arrival info emailed', sub: 'c' },
    ]);
    check('repeated activity rows collapse to one', acts.filter((x) => x.type === 'activity').length === 2);
    // Exact-duplicate rows (same type+label+sub) arriving from two sources collapse.
    const dup = ctx.cmdkArrange([
        { type: 'booking', id: 1, label: 'Richard Berry', sub: 'paid in full · Jollyboat' },
        { type: 'booking', id: 2, label: 'Richard Berry', sub: 'paid in full · Jollyboat' },
    ]);
    check('exact-duplicate rows collapse to one', dup.length === 1);
    // Genuinely different rows (same guest, different stay) are NOT collapsed.
    const distinct = ctx.cmdkArrange([
        { type: 'booking', id: 1, label: 'Jane Doe', sub: 'August' },
        { type: 'booking', id: 2, label: 'Jane Doe', sub: 'September' },
    ]);
    check('distinct rows (different subtitle) are kept', distinct.length === 2);
}

// ---- 14. Production polish: a11y active-descendant, loading, row ids ----
check('a11y/loading helpers are defined', typeof ctx.cmdkSyncActive === 'function' && typeof ctx.cmdkSetLoading === 'function' && typeof ctx.cmdkRenderInner === 'function');
if (typeof ctx.cmdkSetLoading === 'function') {
    let threw = false;
    try { ctx.cmdkSetLoading(true); ctx.cmdkSetLoading(false); ctx.cmdkSyncActive(); } catch (e) { threw = true; }
    check('a11y/loading helpers never throw off-DOM', !threw);
}
if (typeof ctx.cmdkRowHtml === 'function') {
    const html = ctx.cmdkRowHtml({ type: 'screen', label: 'Today', sub: 'Operations' }, 2, false);
    check('rows carry a stable option id for aria-activedescendant', /id="cmdk-opt-2"/.test(html) && /role="option"/.test(html));
}

// ---- 15. Unified booking flow (shared admin + guest progress model) ----
check('bookingFlow helpers are defined', typeof ctx.bookingFlow === 'function' && typeof ctx.bookingFlowCursor === 'function');
if (typeof ctx.bookingFlow === 'function') {
    const unpaid = ctx.bookingFlow('x', { agreedPrice: { total: 400, damagesDeposit: 0 }, depositPaid: 0, checkIn: '2026-08-01', checkOut: '2026-08-05' });
    const keys = unpaid.stages.map((s) => s.key);
    check('flow has the core stages in order', JSON.stringify(keys) === JSON.stringify(['booked', 'deposit', 'paid', 'arrival', 'stay']));
    check('Booked is always done, Deposit pending when unpaid', unpaid.stages[0].done === true && unpaid.stages[1].done === false);
    check('cursor points at the first unfinished stage (Deposit)', ctx.bookingFlowCursor(unpaid.stages) === 1);
    // Guest-details stage appears only when a reg form exists, sitting after Deposit.
    const withReg = ctx.bookingFlow('x', { agreedPrice: { total: 400, damagesDeposit: 100 }, depositPaid: 400, regUrl: 'http://x', regSubmitted: true, holdStatus: 'charged', checkIn: '2026-08-01', checkOut: '2026-08-05' });
    const rkeys = withReg.stages.map((s) => s.key);
    check('reg booking inserts Guest details after Deposit + adds Deposit-back', JSON.stringify(rkeys) === JSON.stringify(['booked', 'deposit', 'details', 'paid', 'arrival', 'stay', 'depositback']));
    check('paid booking marks Deposit + Guest details + Paid done', withReg.stages[1].done && withReg.stages[2].done && withReg.stages[3].done);
    check('stages carry guest wording (glabel)', withReg.stages.find((s) => s.key === 'details').glabel === 'Your details');
    // Guest My Stays renderer: progress pills + an actionable next step.
    if (typeof ctx.guestFlowHtml === 'function') {
        const html = ctx.guestFlowHtml('x', { agreedPrice: { total: 400, damagesDeposit: 0 }, depositPaid: 0, regUrl: 'https://x/guest-details.php?b=1&token=t', regSubmitted: false, checkIn: '2026-08-01', checkOut: '2026-08-05' }, 'paytok');
        check('guestFlowHtml renders progress pills + the details CTA', /bkflow-step/.test(html) && /Add your details/.test(html) && /guest-details\.php/.test(html));
        // A guest who's currently in-house → the Stay step reads GREEN (is-staying).
        const staying = ctx.guestFlowHtml('x', { agreedPrice: { total: 400, damagesDeposit: 0 }, depositPaid: 400, checkIn: '2000-01-01', checkOut: '2999-01-01' }, 't');
        check('the Stay step is green (is-staying) while the guest is in-house', /is-now is-staying/.test(staying));
    }
}

// ---- 16. Booking-hub payments-flow strip (money journey on the Payments card) ----
check('hubPayFlowHtml is defined', typeof ctx.hubPayFlowHtml === 'function');
if (typeof ctx.hubPayFlowHtml === 'function') {
    // No damage deposit → just Deposit → Paid, first is current.
    const noDamage = ctx.hubPayFlowHtml({ holdStatus: 'none' }, { dep: 0, paid: 0, fullyPaid: false }, { collected: 0, held: 0, deposit: 0 });
    check('two-step money flow when no damage deposit', (noDamage.match(/pipe-step/g) || []).length === 2 && !/refunded/i.test(noDamage));
    check('unpaid → Deposit is the current (amber) step', /pipe-step is-now"><span class="pipe-dot"><\/span>Deposit</.test(noDamage));
    // A damage deposit still held → the third step appears and is pending.
    const held = ctx.hubPayFlowHtml({ holdStatus: 'charged' }, { dep: 100, paid: 500, fullyPaid: true }, { collected: 100, held: 100, deposit: 100 });
    check('damage deposit adds a pending "Damages refunded" step', /Damages refunded/.test(held) && (held.match(/is-done/g) || []).length === 2);
    // Returned damages → the deposit-back step is done; retained → "Damages kept".
    const returned = ctx.hubPayFlowHtml({ holdStatus: 'returned' }, { dep: 100, paid: 500, fullyPaid: true }, { collected: 100, held: 0, deposit: 100 });
    check('returned damages deposit marks the refund step done', /is-done"><span class="pipe-dot"><\/span>Damages refunded/.test(returned));
    const kept = ctx.hubPayFlowHtml({ holdStatus: 'kept' }, { dep: 100, paid: 500, fullyPaid: true }, { collected: 100, held: 0, deposit: 100 });
    check('retained damages deposit reads "Damages kept"', /Damages kept/.test(kept) && !/refunded/i.test(kept));
    // A plain refund with NO damages amount just reads "Refunded" (not "Damages…").
    const plainRefund = ctx.hubPayFlowHtml({ holdStatus: 'returned' }, { dep: 0, paid: 500, fullyPaid: true }, { collected: 0, held: 0, deposit: 0 });
    check('non-damages refund reads plain "Refunded"', /Refunded/.test(plainRefund) && !/Damages/.test(plainRefund));
}

// ---- 17. Rental refund gating (arrived / cancellation-policy unrefundable) ----
check('rentalRefundBlocked is defined', typeof ctx.rentalRefundBlocked === 'function');
if (typeof ctx.rentalRefundBlocked === 'function') {
    const today = ctx.todayDashed();
    const plus = (n) => {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    };
    check('a well-future booking stays rental-refundable', ctx.rentalRefundBlocked('x', { checkIn: plus(30) }) === false);
    check('an arrived booking blocks the rental refund', ctx.rentalRefundBlocked('x', { checkIn: plus(-1) }) === true);
    check('a same-day arrival blocks the rental refund', ctx.rentalRefundBlocked('x', { checkIn: today }) === true);
    // flexible/moderate stay refundable right up to check-in.
    check('flexible policy still refundable 1 day out', ctx.rentalRefundBlocked('x', { checkIn: plus(1) }) === false);
    // limited policy: nothing refundable inside 7 days of check-in. siteContent is a
    // lexical binding (not reachable from the vm ctx), so force the policy via the
    // globally-hoisted cancelPolicyOf instead.
    const realPolicyOf = ctx.cancelPolicyOf;
    ctx.cancelPolicyOf = () => 'limited';
    check('limited policy blocks a refund inside 7 days', ctx.rentalRefundBlocked('lim', { checkIn: plus(3) }) === true);
    check('limited policy still refundable outside 7 days', ctx.rentalRefundBlocked('lim', { checkIn: plus(20) }) === false);
    ctx.cancelPolicyOf = realPolicyOf;
}

// ---- 18. ⌘K quick-actions layout (entity top-hit reimagined as a list) ----
if (typeof ctx.cmdkRowHtml === 'function') {
    const prevSel = ctx.__cmdkSel;
    ctx.__cmdkSel = 0; // mark row 0 selected so its actions render
    const it = {
        type: 'booking',
        label: 'Richard Berry',
        sub: 'paid',
        actions: [{ label: 'Email', run() {} }, { label: 'Show on calendar', run() {} }],
        chips: [{ label: 'Jollyboat bookings' }, { label: 'Show on calendar' }],
    };
    const html = ctx.cmdkRowHtml(it, 0, true);
    check('entity ACTIONS (verbs) render as a vertical quick-actions list of rows', /cmdk-qa-row/.test(html) && !/cmdk-actbar/.test(html));
    check('refine/related pivots render as PILLS (one chip language with the bars)', /class="cmdk-chips"/.test(html) && /class="cmdk-chip"/.test(html) && /Jollyboat bookings/.test(html));
    check('a related chip duplicating an action is suppressed', (html.match(/Show on calendar/g) || []).length === 1);
    ctx.__cmdkSel = prevSel;
}

// ---- 19. Time-aware check-in (arrival → staying flips at the check-in TIME) ----
if (typeof ctx.hasCheckedIn === 'function') {
    const today = ctx.todayDashed();
    const plus = (n) => {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    };
    check('a past-arrival booking counts as checked in', ctx.hasCheckedIn({ checkIn: plus(-1), checkInTime: '15:00' }) === true);
    check('a future-arrival booking is not checked in', ctx.hasCheckedIn({ checkIn: plus(2), checkInTime: '15:00' }) === false);
    // Arrival TODAY is time-driven: a 00:00 check-in has always passed; a 23:59
    // one effectively never has during the working day.
    check('today arrival at 00:00 reads as checked in', ctx.hasCheckedIn({ checkIn: today, checkInTime: '00:00' }) === true);
    check('today arrival at 23:59 is not yet checked in', ctx.hasCheckedIn({ checkIn: today, checkInTime: '23:59' }) === false);
    // Departure + in-residence counterparts (the "who's here" fix: a guest
    // arriving today at 15:00 isn't in the cottage at breakfast).
    check('a past-checkout booking counts as checked out', ctx.hasCheckedOut({ checkOut: plus(-1), checkOutTime: '10:00' }) === true);
    check('a future-checkout booking is not checked out', ctx.hasCheckedOut({ checkOut: plus(2), checkOutTime: '10:00' }) === false);
    check('today checkout at 00:00 reads as checked out', ctx.hasCheckedOut({ checkOut: today, checkOutTime: '00:00' }) === true);
    check('today checkout at 23:59 is not yet checked out', ctx.hasCheckedOut({ checkOut: today, checkOutTime: '23:59' }) === false);
    check('arriving-today-at-23:59 is NOT in residence yet', ctx.isInResidence({ checkIn: today, checkInTime: '23:59', checkOut: plus(3), checkOutTime: '10:00' }) === false);
    check('a mid-stay guest IS in residence', ctx.isInResidence({ checkIn: plus(-1), checkInTime: '15:00', checkOut: plus(2), checkOutTime: '10:00' }) === true);
}
// isOtaBlock — an imported OTA booking is a real guest / booked night; the
// owner's own maintenance block is not (blocked-out dates aren't booking days).
if (typeof ctx.isOtaBlock === 'function') {
    check('an Airbnb block is an OTA booking', ctx.isOtaBlock({ source: 'airbnb', checkIn: '2026-01-01', checkOut: '2026-01-03' }) === true);
    check('an owner maintenance block is NOT a booking', ctx.isOtaBlock({ source: 'owner', checkIn: '2026-01-01', checkOut: '2026-01-03' }) === false);
    check('a sourceless block is NOT a booking', ctx.isOtaBlock({ checkIn: '2026-01-01', checkOut: '2026-01-03' }) === false);
}


// ---- 20. Tier-3 DARKSTAR semantic model (darkstar.bin) — cascade gates ----
// Darkstar, our on-device semantic tier, answers ONLY when tiers 1-2 abstain.
// Floors measured at tuning time on the SAME harness as the v2 tournament:
// with the packed asset loaded, the cascade recovers 3 specific held-out
// phrasings (48→51/52) while staying ZERO-wrong and rejecting every negative.
if (typeof ctx.darkstarParse === 'function' && fs.existsSync(path.join(DIR, 'darkstar.bin'))) {
    const bin = fs.readFileSync(path.join(DIR, 'darkstar.bin'));
    // DARKSTAR is a top-level const (declarative record) — reach it by running
    // code IN the context rather than via a ctx property.
    ctx.__DARKSTAR_AB = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
    vm.runInContext('DARKSTAR.st = darkstarParse(__DARKSTAR_AB); darkstarIndex();', ctx, { timeout: 30000 });
    const shape = vm.runInContext('({ v: DARKSTAR.st.vocabN, d: DARKSTAR.st.dim })', ctx);
    check('darkstar.bin parses (29528 tokens x 256 dims)', shape.v === 29528 && shape.d === 256);
    const recovered = [
        ['guests due to depart', 'leaving today'],
        ['expected guests for tonight', 'arriving today'],
        ['what reservations lie ahead', 'upcoming bookings'],
    ];
    for (const [q, want] of recovered) {
        const g = ctx.chbNluClassify(q);
        check(`Darkstar recovers "${q}" -> ${want}`, !!g && g.canonical === want && g.ds === true);
    }
    // Zero-wrong + full negative rejection stand with the tier live.
    const NEGS = ['sarah pemberton', 'jollyboat photos', 'wifi password for guests', 'seasonal rates grid', 'add booking for smith', 'hero image', 'newsletter subscribers', 'emma richardson', 'block jollyboat next weekend', 'seasonal rates', 'pimpernel description', 'guest wifi details', 'change arrival instructions', 'newsletter', 'add a booking for jones', 'photo gallery', 'welcome book', 'check in time settings', 'best beach nearby', 'tide times', 'zzgrmph blat', 'kitchen inventory', 'email templates'];
    const leaks = NEGS.filter((q) => ctx.chbNluClassify(q));
    check('all 23 negatives still rejected with Darkstar live', leaks.length === 0, 'leaked: ' + leaks.join(', '));
    // Train-set accuracy must not degrade (Darkstar only fires on abstains).
    let ok = 0, n = 0, wrong = [];
    for (const c of ctx.CHB_SEARCH.nlu.corpus) for (const ex of c.examples) {
        n++;
        const g = ctx.chbNluClassify(ex);
        if (g && g.canonical === c.canonical) ok++;
        else if (g) wrong.push(ex + '->' + g.canonical);
    }
    check(`train accuracy holds with Darkstar live (${ok}/${n}, wrong: ${wrong.length})`, ok / n >= 0.96 && wrong.length === 0, wrong.join(', '));
    // The teach loop reaches Darkstar: a learned phrase joins its intent
    // centroid; a suppressed phrase joins the none pool.
    ctx.chbNluLearn('utterly bespoke wording zq', 'who owes me money');
    check('learned phrase folds into the Darkstar index', vm.runInContext('!!(DARKSTAR.st && DARKSTAR.st.cents)', ctx) === true);

    // Comprehensive held-out accuracy floor — the FULL evaluation set
    // (nlu-testset.js, 86 unseen paraphrases + 32 negatives) run through the
    // whole cascade with all three tiers live. Measured 86/86 · 0 wrong · 32/32
    // reject; the floor allows a little slack for future corpus edits but ZERO
    // wrong intents and full negative rejection are hard gates. This is the
    // durable guard on the model's real-world accuracy.
    const TS = require('./nlu-testset.js');
    let ho = 0, hw = 0; const hwrong = [];
    for (const [q, want] of TS.HELD) {
        const g = ctx.chbNluClassify(q);
        if (g && (Array.isArray(want) ? want.includes(g.canonical) : g.canonical === want)) ho++;
        else if (g) { hw++; hwrong.push(q + '→' + g.canonical); }
    }
    const heldFloor = Math.ceil(TS.HELD.length * 0.95); // ≥95% recall, scales with the set
    check(`NLU held-out recall ≥ ${heldFloor}/${TS.HELD.length} across the full cascade (got ${ho})`, ho >= heldFloor, `only ${ho}/${TS.HELD.length}`);
    check(`NLU held-out has ZERO wrong intents (${TS.HELD.length} phrases)`, hw === 0, hwrong.join(', '));
    let tn = 0; const tleak = [];
    for (const q of TS.NEG) if (ctx.chbNluClassify(q)) { tn++; tleak.push(q); }
    check(`NLU test-set negatives all rejected (${TS.NEG.length})`, tn === 0, tleak.join(', '));

    // TRUE semantic recall over history — embed a few history docs with the live
    // model and find one by MEANING with no shared words.
    if (typeof ctx.chbHistorySemantic === 'function') {
        vm.runInContext(`
            CHB_HIST.docs = [
              { type: 'review', id: 1, text: 'The neighbours were rather loud and noisy late at night', date: '2026-06-01', extra: {}, vec: darkstarVec('The neighbours were rather loud and noisy late at night') },
              { type: 'review', id: 2, text: 'The kitchen was well equipped and spotlessly clean', date: '2026-06-02', extra: {}, vec: darkstarVec('The kitchen was well equipped and spotlessly clean') },
              { type: 'message', id: 3, text: 'Is the cottage dog friendly, can we bring our labrador', date: '2026-06-03', extra: {}, vec: darkstarVec('Is the cottage dog friendly, can we bring our labrador') }
            ];
            CHB_HIST.built = true;
        `, ctx);
        const noise = ctx.chbHistorySemantic('a review complaining the neighbours were noisy', 3);
        check('semantic history recalls the noisy-neighbours review by meaning', !!(noise[0] && /neighbours were rather loud/i.test(noise[0].label)), noise[0] ? noise[0].label : 'none');
        const pet = ctx.chbHistorySemantic('did anyone ask about bringing a pet', 3);
        check('semantic history maps "pet" → the dog-friendly message', !!(pet[0] && /dog friendly/i.test(pet[0].label)), pet[0] ? pet[0].label : 'none');
        const off = ctx.chbHistorySemantic('quarterly VAT return figures', 3);
        check('an unrelated query recalls nothing (threshold holds)', off.length === 0, off.map((r) => r.label).join(' | '));
        vm.runInContext('CHB_HIST.docs = []; CHB_HIST.built = false;', ctx);
    }

    vm.runInContext('DARKSTAR.st = null', ctx); // leave the shim lexical-only for any later checks
} else {
    check('Darkstar asset + parser present', false, 'darkstar.bin or darkstarParse missing');
}

// ---- 21. "The guest" composer (unnamed singular) — needs a controlled fixture
// (a today-arrival with a check-in time), which can't live in golden's
// interlocked corpus, so seed one here and drive cmdkIntent directly.
if (typeof ctx.cmdkIntent === 'function') {
    const today = ctx.todayDashed();
    const plus = (nn) => { const dd = new Date(today + 'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate() + nn); return dd.toISOString().slice(0, 10); };
    const mk = (id, name, ci, co) => ({ id, name, checkIn: ci, checkOut: co, checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 400 } });
    // Richard arrives TODAY at 15:00 (not in residence yet at test time); Alice
    // is mid-stay; one future OTA block.
    ctx.__seedA = { jb: [mk(1, 'Richard Berry', today, plus(3)), mk(2, 'Alice Marsh', plus(-1), plus(2))], blk: [{ id: 901, source: 'airbnb', checkIn: plus(5), checkOut: plus(9) }] };
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedA.jb;dbBlocks["21a"]=__seedA.blk;', ctx);
    const head = (q) => { const r = ctx.cmdkIntent(q); return r && r[0] ? (r[0].label || '') + ' | ' + (r[0].sub || '') : '(none)'; };
    check('"when is the guest arriving today" → the arrival with the 15:00 TIME', /Richard Berry arrives TODAY at 15:00/.test(head('when is the guest arriving today')));
    // "how long is the guest staying" needs exactly ONE in-residence guest. Richard
    // arrives TODAY at 15:00, so once the wall-clock passes 15:00 he ALSO counts as
    // in-house and the singular composer sees two guests (this test flaked after
    // 3pm regardless of the model). Reseed to Alice alone so it's time-of-day safe.
    ctx.__seedHL = { jb: [mk(2, 'Alice Marsh', plus(-1), plus(2))] };
    vm.runInContext('dbBookings.jollyboat = __seedHL.jb; dbBlocks["21a"] = [];', ctx);
    check('"how long is the guest staying" → the in-residence guest, 3 nights', /Alice Marsh is staying 3 nights/.test(head('how long is the guest staying')));
    // OTA-only arrival today → honest "the channel doesn't share a time".
    ctx.__seedB = { blk: [{ id: 902, source: 'airbnb', checkIn: today, checkOut: plus(5) }] };
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBlocks["21a"]=__seedB.blk;', ctx);
    const otaWhen = head('when is the guest arriving today');
    check('OTA arrival today → Airbnb guest, honest "no channel time"', /Airbnb guest arrives TODAY/.test(otaWhen) && /doesn.t share a check-in time/.test(otaWhen));
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);', ctx);

    // ---- 21b. Cross-page context memory — a record read on ANOTHER page stays the
    // referent for a pronoun follow-up (no hub open, no palette conv-ctx). Guards
    // chbStampRecent / cmdkRecentEntity: fresh + real pronoun resolves; a generic
    // query is NOT hijacked; stale (past CMDK_RECENT_MS) stops resolving. Driven
    // only through the public fns (the __cmdk* state is closure-scoped) — and both
    // __cmdkEntity/__cmdkConvCtx are already unset here (set only at palette open).
    if (typeof ctx.chbStampRecent === 'function') {
        vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);dbBookings.jollyboat=[{id:77,name:"Sarah Wingate",checkIn:"' + plus(-1) + '",checkOut:"' + plus(3) + '",adults:2,children:0,payment:"deposit",agreedPrice:{total:600},holdStatus:"none"}];', ctx);
        vm.runInContext("chbStampRecent('booking',77,'Sarah Wingate');", ctx);
        check('cross-page: "email them" resolves to the record read on another page', /Sarah Wingate/.test(head('email them')));
        check('cross-page: "their balance" answers about that record', /Sarah Wingate owes/.test(head('their balance')));
        const generic = head('who owes me money');
        check('cross-page: a generic query is NOT hijacked by the recent record', /(collect|chase|owes|owed|to come in|all square|paid up)/i.test(generic));
        // Age it past the freshness window → must stop resolving. Save & restore
        // the real clock so later sections are unaffected (Date.now is an own method).
        const far = Date.now() + 7 * 60 * 1000;
        vm.runInContext('globalThis.__realNow = Date.now; Date.now = () => ' + far + ';', ctx);
        check('cross-page: stale memory (past 6 min) no longer resolves to it', !/Sarah Wingate/.test(head('email them')));
        vm.runInContext('Date.now = globalThis.__realNow; delete globalThis.__realNow;', ctx);
        vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);', ctx); // clear → recent memory can't resolve (existence check)
    }

    // ---- 21c. Unified customer directory + safeguards. chbCustomers groups
    // bookings into ONE customer by STRONG identity only; the search source floats
    // the person above their scattered stays; the row carries no destructive action.
    if (typeof ctx.chbCustomers === 'function') {
        vm.runInContext(`Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);dbBookings.jollyboat=[
          {id:1,name:"Sarah Wingate",email:"SARAH@x.co",checkIn:"2025-06-01",checkOut:"2025-06-04",agreedPrice:{total:600}},
          {id:2,name:"Sarah Wingate",email:"sarah@x.co",checkIn:"2026-07-10",checkOut:"2026-07-13",agreedPrice:{total:660}},
          {id:3,name:"John Smith",email:"john1@x.co",checkIn:"2026-01-01",checkOut:"2026-01-03",agreedPrice:{total:300}},
          {id:4,name:"John Smith",email:"john2@x.co",checkIn:"2026-02-01",checkOut:"2026-02-03",agreedPrice:{total:300}},
          {id:5,name:"Nomail Ned",checkIn:"2026-03-01",checkOut:"2026-03-02",agreedPrice:{total:100}},
          {id:6,name:"Nomail Ned",checkIn:"2026-04-01",checkOut:"2026-04-02",agreedPrice:{total:100}}];`, ctx);
        const cs = vm.runInContext('chbCustomers()', ctx);
        const sarah = cs.find((c) => /sarah/i.test(c.name));
        check('customer: same email (case-insensitive) unifies the stays', !!sarah && sarah.stays.length === 2 && sarah.nights === 6 && Math.round(sarah.revenue) === 1260);
        check('false-merge: two same-name guests with DIFFERENT emails stay separate', cs.filter((c) => c.name === 'John Smith').length === 2);
        check('false-merge: same name with NO email/phone is never merged', cs.filter((c) => c.name === 'Nomail Ned').length === 2);
        const rows = vm.runInContext('cmdkSourceCustomers()', ctx);
        check('directory: only REPEAT customers (≥2 stays) get a unified row', rows.length === 1 && /2 stays/.test(rows[0].sub) && rows[0]._customer === true);
        check('destructive-action guard: the customer row exposes no delete/refund', (rows[0].actions || []).every((a) => a.key === 'email'));
        const ranked = vm.runInContext("(function(){const p=CHB_SEARCH.collect('sarah');return p.map(it=>({c:!!it._customer,s:cmdkScore(it,['sarah'],'sarah')})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s)[0];})()", ctx);
        check('search returns the CUSTOMER first, above their scattered stays', !!ranked && ranked.c === true);
        // Full cmdkBuildResults pipeline (audit fix): a repeat guest LEADS with the
        // unified customer instead of "N bookings match that name"; two DIFFERENT
        // people who share a name still disambiguate (false-merge holds end-to-end).
        const lead = (q) => { const b = vm.runInContext(`cmdkBuildResults(${JSON.stringify(q)})`, ctx); return (b.results || [])[0] || {}; };
        check('pipeline: a repeat guest LEADS with the unified customer', lead('Sarah Wingate')._customer === true);
        check('pipeline: two same-name PEOPLE disambiguate (not merged)', !lead('John Smith')._customer && /bookings match that name/.test(lead('John Smith').label || ''));
        // Audit fix: the DIRECT insight regex no longer false-answers a cottage
        // FEATURE question (the NLU fallback is separately veto-gated once Darkstar
        // loads — see §20). Tests cmdkIntent so it's independent of the model.
        const di = (q) => { const r = vm.runInContext(`cmdkIntent(${JSON.stringify(q)})`, ctx); return (r && r[0]) || {}; };
        check('precision: "which cottage has a hot tub" hits no insight figure', di('which cottage has a hot tub').type !== 'figure');
        check('precision: "which cottage is dog friendly" hits no insight figure', di('which cottage is dog friendly').type !== 'figure');
        check('regression: "which cottage earns most" STILL answers the figure', di('which cottage earns most').type === 'figure');
        vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);', ctx);
    }
}

// ---- 22. chbNlg — conversational replies (social + fallback, shown as text) ----
if (typeof ctx.chbNlgSocial === 'function') {
    const kind = (q) => { const r = ctx.chbNlgSocial(q); return r ? r.kind : null; };
    check('greeting → a greet reply', kind('hello') === 'greet' && kind('good morning') === 'greet');
    check('thanks → a thanks reply', kind('thanks') === 'thanks' && kind('cheers') === 'thanks');
    check('"what can you do" → capability reply', kind('what can you do') === 'capability');
    check('"who are you" → identity reply', kind('who are you') === 'identity');
    check('"how are you"/"you there" → a greet reply', kind('how are you') === 'greet' && kind('you there') === 'greet');
    check('"ok"/"sorry" → an ack reply', kind('ok') === 'ack' && kind('sorry') === 'ack');
    check('a social reply carries non-empty text', (ctx.chbNlgSocial('hi') || {}).text && ctx.chbNlgSocial('hi').text.length > 3);
    // Real queries must NOT be swallowed as social.
    check('real queries are not social', kind('who owes me money') === null && kind('high earners') === null && kind('history') === null && kind('hire a cleaner') === null);
}
// chbNlgFallback — a dead-end QUESTION gets a reply; a keyword/name does not.
if (typeof ctx.chbNlgFallback === 'function') {
    check('a dead-end question gets a fallback reply', !!(ctx.chbNlgFallback('what is the meaning of life') || {}).label);
    check('a "?"-ended query gets a fallback reply', !!ctx.chbNlgFallback('will it rain tomorrow?'));
    check('a bare keyword/name is NOT a fallback', ctx.chbNlgFallback('richard') === null && ctx.chbNlgFallback('jollyboat') === null);
    // Integration: the fallback surfaces through cmdkBuildResults ONLY when the
    // intent AND fuzzy search both come up empty (empty data → nothing matches).
    if (typeof ctx.cmdkBuildResults === 'function') {
        vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);enquiries=[];', ctx);
        const fb = ctx.cmdkBuildResults('what is the meaning of life');
        check('dead-end question → nlg-fallback answer row', !!(fb && fb.results && fb.results[0] && fb.results[0].id === 'nlg-fallback'));
        const rq = ctx.cmdkBuildResults('who owes me money');
        check('a real question does NOT get the fallback', !(rq && rq.results && rq.results[0] && rq.results[0].id === 'nlg-fallback'));
        // A procedural "how do I…" leads with the GENERATED how-to answer (Top Hit),
        // not a stack of topic rows — that's the whole point of the composer.
        const hb = ctx.cmdkBuildResults('how do i take a payment');
        check('how-to question → generated how-to answer leads the results',
            !!(hb && hb.results && hb.results[0] && /^nlg-howto-/.test(hb.results[0].id) && hb.results[0].nlgBody),
            'top=' + (hb && hb.results && hb.results[0] ? hb.results[0].id : 'none'));
        check('the how-to answer does NOT bring a duplicate stack of topic rows',
            !!(hb && hb.results && hb.results.filter((r) => /^(help-|nlg-howto-)/.test(r.id || '')).length === 1),
            'howto rows=' + (hb && hb.results ? hb.results.filter((r) => /^(help-|nlg-howto-)/.test(r.id || '')).length : '?'));
    }
    // The social branch surfaces through cmdkIntent as an answer row.
    const soc = ctx.cmdkIntent('thanks');
    check('cmdkIntent answers a greeting/thanks with an nlg row', !!(soc && soc[0] && /^nlg-/.test(soc[0].id)));
    // Conversational replies are full sentences → they carry wrap:true so the row
    // renders multi-line instead of clamping to one ellipsised line.
    check('a conversational reply row is marked wrap:true', soc[0].wrap === true);
    check('cmdkIntent does NOT route a real question to nlg', !/^nlg-/.test(((ctx.cmdkIntent('who owes me money') || [{}])[0].id) || ''));
}

// ---- 23. Business insights lead with NIGHTS booked (OTA-aware); owner
// maintenance blocks are NOT booking days. Seed a month with one paying stay
// (2 nights, £400), one OTA guest stay (3 nights, no price) and one owner
// maintenance block (must not count). ----
if (typeof ctx.cmdkIntent === 'function') {
    const mm = ctx.todayDashed().slice(0, 8); // 'YYYY-MM-'
    const dir = { id: 5, name: 'Ada Vale', checkIn: mm + '01', checkOut: mm + '03', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 400 } };
    const ota = { id: 951, source: 'airbnb', checkIn: mm + '05', checkOut: mm + '08' }; // 3 nights, no price
    const own = { id: 952, source: 'owner', checkIn: mm + '10', checkOut: mm + '13' }; // maintenance, NOT a booking
    ctx.__seedI = { dir: [dir], blk: [ota, own] };
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedI.dir;dbBlocks["21a"]=__seedI.blk;', ctx);
    const ihead = (q) => { const r = ctx.cmdkIntent(q); return r && r[0] ? (r[0].label || '') + ' | ' + (r[0].sub || '') : '(none)'; };
    // Generic business summary → nights booked (direct 2 + OTA 3 = 5), maintenance
    // (3) excluded, OTA nights flagged as carrying no price.
    const biz = ihead("how's business this month");
    check('generic business summary leads with NIGHTS (OTA counted, maintenance excluded)', /^5 nights booked/.test(biz) && /incl\. 3 OTA nights/.test(biz), biz);
    // Explicit money question still leads with the revenue figure. (Bare "revenue"
    // routes to the Income & tax screen via the command registry, so probe the
    // composer's money path with "how much did I make".)
    const rev = ihead('how much did i make this month');
    check('an explicit money question still leads with revenue (avg over PAID nights only)', /^£400(\.00)? booked/.test(rev) && /avg £200(\.00)?\/night/.test(rev), rev);
    // "nights booked" counts OTA guest nights, not the owner block.
    const nb = ihead('how many nights booked this month');
    check('nights booked counts OTA, excludes owner maintenance (5, not 8)', /^5 nights booked/.test(nb), nb);
    // Occupancy flags the OTA nights too.
    const occ = ihead('occupancy this month');
    check('occupancy is OTA-aware (flags the 3 OTA nights)', /incl\. 3 OTA nights/.test(occ), occ);
    // Per-cottage split row shows nights (and honest "OTA, no price" where £0).
    const rows = ctx.cmdkIntent("how's business this month") || [];
    check('per-cottage split rows read in nights', rows.some((r) => /\d+ nights?$/.test(r.label || '')), (rows[1] || {}).label);
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);', ctx);
}

// ---- 24. Federated site content: published experiences are searchable, so a
// thing-to-do like "Folks Coffee" is findable anywhere, not just its page. ----
if (typeof ctx.cmdkContentMatches === 'function') {
    vm.runInContext('__cmdkExp = [{ id: 3, title: "Folks Coffee", category: "Food & drink", description: "Speciality roastery on the quay." }, { id: 4, title: "Blakeney Point seals", category: "Boat trips & wildlife", description: "Seal-watching boat trips." }];', ctx);
    const cm = ctx.cmdkContentMatches('folks coffee');
    check('experiences surface in content search ("folks coffee" → the card)', Array.isArray(cm) && cm.some((r) => r.type === 'content' && /folks coffee/i.test(r.label)), 'got ' + JSON.stringify((cm || []).map((r) => r.label)));
    check('a partial word finds the experience ("seals")', ctx.cmdkContentMatches('seals').some((r) => /seals/i.test(r.label)));
    // Integration: it reaches the search results (in the fuzzy pool) so the palette
    // AND the Assist Bar (which now falls back to fuzzy) surface it.
    if (typeof ctx.cmdkBuildResults === 'function') {
        vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);enquiries=[];', ctx);
        const b = ctx.cmdkBuildResults('folks coffee');
        const pool = [].concat(b.results || [], b.fuzzy || []);
        check('cmdkBuildResults surfaces the experience for "folks coffee"', pool.some((r) => /folks coffee/i.test(r.label || '')), 'pool: ' + pool.map((r) => r.label).join(', '));
    }
    vm.runInContext('__cmdkExp = [];', ctx);
}

// ---- 25. Token-importance (IDF) weighting: a distinctive query word outweighs
// a common one, and matching it in a higher field wins. Seed a content corpus
// where "kayak" is common (5 docs) and "zephyrine" rare (1 doc). ----
if (typeof ctx.cmdkIdfOf === 'function' && typeof ctx.cmdkScore === 'function') {
    vm.runInContext(`__cmdkExp = [
        { title: 'Kayak hire', category: 'Water', description: 'kayak' },
        { title: 'Kayak tour', category: 'Water', description: 'kayak trip' },
        { title: 'Sea kayak', category: 'Water', description: 'kayak coast' },
        { title: 'River kayak', category: 'Water', description: 'kayak calm' },
        { title: 'Kayak lesson', category: 'Water', description: 'learn kayak' },
        { title: 'Zephyrine special', category: 'Rare', description: 'zephyrine only' }
    ]; __cmdkIdf = null;`, ctx);
    const idfRare = ctx.cmdkIdfOf('zephyrine');
    const idfCommon = ctx.cmdkIdfOf('kayak');
    check('a rare word carries MORE weight than a common one (idf)', idfRare > idfCommon, `zephyrine=${idfRare.toFixed(2)} kayak=${idfCommon.toFixed(2)}`);
    check('a super-common word is floored, not zeroed', idfCommon >= 0.3);
    // Same base (identical labels/type, no query word in the label) → only the
    // IDF-weighted field placement differs: the item with the RARE word in the
    // higher field (sub) must outscore the one with only the common word there.
    const mk = (sub, kw) => ({ type: 'guest', label: 'record row', sub, kw });
    const q = ['zephyrine', 'kayak'];
    const sA = ctx.cmdkScore(mk('zephyrine', 'kayak'), q, 'zephyrine kayak'); // rare word in sub
    const sB = ctx.cmdkScore(mk('kayak', 'zephyrine'), q, 'zephyrine kayak'); // rare word in keywords
    check('the distinctive word in a higher field wins the tie', sA > sB, `rare-in-sub=${sA.toFixed(2)} rare-in-kw=${sB.toFixed(2)}`);
    vm.runInContext('__cmdkExp = []; __cmdkIdf = null;', ctx);
}

// ---- 26. AI-drafted enquiry reply: a new enquiry → a warm, ready-to-send draft
// (greeting, availability, live quote, the FAQ answer to what they asked, CTA,
// host sign-off). Deterministic — the owner edits, then sends. ----
if (typeof ctx.chbDraftEnquiryReply === 'function') {
    vm.runInContext(`
        propertyMeta.jollyboat = { name: 'Jollyboat' };
        propertyRates.jollyboat = { coupleRate: 130, extraAdultRate: 0, childRate: 0, damagesDeposit: 50, transactionPct: 0 };
        siteContent['host-name'] = 'George';
        siteContent['faqs-jollyboat'] = [{ q: 'Are dogs welcome?', a: 'Yes, up to two well-behaved dogs are welcome at no extra charge.' }];
        activeFrontProperty = 'jollyboat';
        Object.keys(dbBookings).forEach((k) => dbBookings[k] = []); Object.keys(dbBlocks).forEach((k) => dbBlocks[k] = []);
    `, ctx);
    const enq = { id: 99, name: 'Priya Shah', email: 'p@x.co', propKey: 'jollyboat', checkIn: '2026-09-10', checkOut: '2026-09-13', adults: 2, children: 0, guests: '2 adults', message: 'Hi, can we bring our dog?' };
    const draft = ctx.chbDraftEnquiryReply(enq);
    check('draft greets the guest by first name', /^Hi Priya,/.test(draft), draft.split('\n')[0]);
    check('draft names the cottage + dates', /Jollyboat/.test(draft) && /10\/09\/2026/.test(draft) && /13\/09\/2026/.test(draft));
    check('draft states availability when free', /those dates are free/i.test(draft));
    check('draft includes the live quote + refundable deposit', /total for your stay would be £\d/.test(draft) && /refundable damage deposit/.test(draft));
    check('draft answers the asked question from the cottage FAQ (dogs)', /two well-behaved dogs are welcome/i.test(draft));
    check('draft signs off with the host name', /Warm wishes,\nGeorge$/.test(draft.trim()));
    // A clashing enquiry flags "just taken" instead of "free".
    vm.runInContext(`dbBookings.jollyboat = [{ id: 1, name: 'Xavier Blake', checkIn: '2026-09-11', checkOut: '2026-09-14' }];`, ctx);
    check('draft flags a clash when the dates are taken', /just taken/i.test(ctx.chbDraftEnquiryReply(enq)));
    // No host name → falls back to the business name.
    vm.runInContext(`dbBookings.jollyboat = []; siteContent['host-name'] = '';`, ctx);
    check('draft falls back to the business name with no host name set', /Cottage Holidays Blakeney$/.test(ctx.chbDraftEnquiryReply(enq).trim()));
    vm.runInContext(`siteContent['faqs-jollyboat'] = []; activeFrontProperty = '21a';`, ctx);
}

// ---- 27. Proactive business pulse: this month vs last, in plain English, and
// it leads a generic "how's business" answer. ----
if (typeof ctx.chbBusinessPulse === 'function') {
    const today = ctx.todayDashed();
    const mm = today.slice(0, 8); // this month "YYYY-MM-"
    const Y = +today.slice(0, 4), M = +today.slice(5, 7);
    const lm = M === 1 ? `${Y - 1}-12-` : `${Y}-${String(M - 1).padStart(2, '0')}-`; // last month
    const seed = (rows) => vm.runInContext(`Object.keys(dbBookings).forEach((k)=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach((k)=>dbBlocks[k]=[]);dbBookings.jollyboat=${JSON.stringify(rows)};`, ctx);
    // This month 5 nights (£650), last month 2 nights → up 3.
    seed([
        { id: 1, name: 'A', checkIn: mm + '05', checkOut: mm + '10', agreedPrice: { total: 650 } },
        { id: 2, name: 'B', checkIn: lm + '04', checkOut: lm + '06', agreedPrice: { total: 260 } },
    ]);
    const p = ctx.chbBusinessPulse();
    check('business pulse compares this month vs last (up 3)', !!p && p.arrow === '↑' && /up 3 on last month/.test(p.label), p ? p.label : 'null');
    check('business pulse states the revenue + leading cottage', !!p && /£650/.test(p.sub) && /leading/i.test(p.sub), p ? p.sub : 'null');
    const hb = ctx.cmdkIntent("how's business");
    check('"how\'s business" leads with the pulse narrative', !!(hb && hb[0] && hb[0].id === 'ins-pulse' && /night/.test(hb[0].label)), hb && hb[0] ? hb[0].id + ':' + hb[0].label : 'none');
    // A real dip flags a nudge.
    seed([
        { id: 1, name: 'A', checkIn: mm + '05', checkOut: mm + '07', agreedPrice: { total: 260 } },
        { id: 2, name: 'B', checkIn: lm + '02', checkOut: lm + '09', agreedPrice: { total: 900 } },
    ]);
    const pd = ctx.chbBusinessPulse();
    check('a real dip flags a nudge (down + offer)', !!pd && pd.down && pd.arrow === '↓' && /nudge|offer/i.test(pd.sub), pd ? pd.arrow + ' ' + pd.sub : 'null');
    vm.runInContext('Object.keys(dbBookings).forEach((k)=>dbBookings[k]=[]);', ctx);
}

// ---- 28. Natural-language history recall: a history-SHAPED question is cleaned
// to its content terms before the server search (which covers messages / emails
// / reviews / the activity log); a plain keyword query is sent untouched. ----
if (typeof ctx.chbHistoryClean === 'function') {
    const cl = ctx.chbHistoryClean;
    check('"what did Sarah say about the boiler" → "sarah boiler"', cl('what did Sarah say about the boiler') === 'sarah boiler', cl('what did Sarah say about the boiler'));
    check('"when did I change the Jollyboat price" → "jollyboat price"', cl('when did I change the Jollyboat price') === 'jollyboat price', cl('when did I change the Jollyboat price'));
    check('"find the email about parking" → "parking"', cl('find the email about parking') === 'parking', cl('find the email about parking'));
    check('a plain keyword is sent untouched', cl('boiler') === 'boiler' && cl('Sarah Pemberton') === 'Sarah Pemberton');
    check('a non-history question is untouched', cl('who owes me money') === 'who owes me money');
    check('an over-stripped history query falls back to the raw text', cl('any history') === 'any history');
}

// ---- 29. Breadth tier: chbCompute (maths / VAT / percentages / conversions /
// date arithmetic / world clock) + chbAlmanac (capitals / currencies / bank
// holidays) answer exactly, abstain on EVERYTHING business-shaped, and the
// exact answer LEADS in the pipeline (prepended before keyword action rows). ----
if (typeof ctx.chbCompute === 'function' && typeof ctx.chbAlmanac === 'function') {
    const comp = (q) => { try { return ctx.chbCompute(q) || null; } catch (e) { return { label: 'THREW: ' + e.message, threw: true }; } };
    const alm = (q) => { try { return ctx.chbAlmanac(q) || null; } catch (e) { return { label: 'THREW: ' + e.message, threw: true }; } };
    const lbl = (r) => (r ? String(r.label) : '(abstain)');
    // Compute — each family answers with the right figure.
    let r = comp('20% of 480');
    check('percentage: "20% of 480" → 96', r && /\b96\b/.test(r.label), lbl(r));
    r = comp('15% off £600');
    check('discount: "15% off £600" → £510', r && /£510/.test(r.label), lbl(r));
    r = comp('vat on £480');
    check('VAT: "vat on £480" → £96 / £576 inc', r && /£96/.test(r.label) && /£576/.test(r.label), lbl(r));
    r = comp('£400 plus vat');
    check('"£400 plus vat" → £480', r && /£480/.test(r.label), lbl(r));
    r = comp('£480 plus 10%');
    check('"£480 plus 10%" → £528 (regression: this pattern once threw)', r && !r.threw && /£528/.test(r.label), lbl(r));
    r = comp('what is 12 * 7');
    check('arithmetic: "12 * 7" → 84', r && /= 84\b/.test(r.label), lbl(r));
    r = comp('10 miles in km');
    check('conversion: "10 miles in km" → 16.09', r && /16\.09/.test(r.label), lbl(r));
    r = comp('70 f to c');
    check('conversion: "70 f to c" → 21.11 °C', r && /21\.11/.test(r.label), lbl(r));
    r = comp('what day is 25 december');
    check('date: "what day is 25 december" names the weekday', r && /is a (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/.test(r.label), lbl(r));
    r = comp('days until christmas');
    check('date arithmetic: "days until christmas" counts days', r && /\d+ days until/.test(r.label), lbl(r));
    r = comp('how long until 20 august');
    check('"how long until 20 august" answers (regression: alt phrasing once threw)', r && !r.threw && /days until/.test(r.label), lbl(r));
    r = comp('time in tokyo');
    check('world clock: "time in tokyo" gives a time', r && /\d{2}:\d{2}/.test(r.label), lbl(r));
    // Almanac.
    r = alm('capital of france');
    check('almanac: "capital of france" → Paris', r && /Paris/.test(r.label), lbl(r));
    r = alm("what is spain's capital");
    check('almanac: possessive phrasing → Madrid', r && /Madrid/.test(r.label), lbl(r));
    r = alm('currency in japan');
    check('almanac: "currency in japan" → yen', r && /yen/.test(r.label), lbl(r));
    r = alm('next bank holiday');
    check('almanac: "next bank holiday" names one with a date', r && /bank holiday is .+ — /.test(r.label), lbl(r));
    // Precision: business / name / plain queries NEVER fire the breadth tier.
    ['who owes money', 'sarah wingate', 'bookings in august', 'price for 2 nights', 'how much have i earned',
     'revenue this month', '£500 balance', 'add a booking', 'deposit for jollyboat', 'time in blakeney',
     'capital of narnia', 'who is arriving on 20 august', 'occupancy in december'].forEach((q) => {
        const hit = comp(q) || alm(q);
        check(`breadth tier abstains on "${q}"`, !hit, hit && lbl(hit));
    });
    // Pipeline: the exact answer LEADS even when a keyword matches an action row.
    if (typeof ctx.cmdkBuildResults === 'function') {
        const top = (q) => { try { return ((ctx.cmdkBuildResults(q) || {}).results || [])[0] || null; } catch (e) { return null; } };
        let t = top('vat on £480');
        check('pipeline: "vat on £480" leads with the computed answer, not the Income & tax row', t && t.id === 'compute' && /£576/.test(t.label), t && `[${t.type}/${t.id}] ${t.label}`);
        t = top('capital of italy');
        check('pipeline: "capital of italy" leads with Rome', t && t.id === 'almanac' && /Rome/.test(t.label), t && t.label);
        t = top('who owes money');
        check('pipeline: business question still answered by the ops engine, not compute', t && t.id !== 'compute' && t.id !== 'almanac', t && `[${t.type}/${t.id}]`);
    }
} else fail('chbCompute / chbAlmanac missing from the bundle');

// ---- 29b. New business answer families: repeat-guest rate (from the unified
// customer directory — strong identity, so two John Smiths never fake a repeat)
// and average LENGTH of stay (habitual ask widens to the year). ----
if (typeof ctx.cmdkIntent === 'function') {
    const yr = ctx.todayDashed().slice(0, 4);
    const mkb = (id, name, email, ci, co) => ({ id, name, email, checkIn: `${yr}-${ci}`, checkOut: `${yr}-${co}`, adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 400 } });
    ctx.__seedR = [
        mkb(11, 'Sarah Holt', 'sarah@example.com', '01-10', '01-14'), // 4 nights
        mkb(12, 'Sarah Holt', 'sarah@example.com', '02-03', '02-05'), // 2 nights — repeat by email
        mkb(13, 'Tom Reed', 'tom@example.com', '03-01', '03-08'), // 7 nights
        mkb(14, 'John Smith', '', '05-02', '05-04'), // 2 nights, name-only
        mkb(15, 'John Smith', '', '06-01', '06-03'), // 2 nights, name-only — must NOT merge
    ];
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedR;__cmdkCustomers=null;', ctx);
    const head = (q) => { const r = ctx.cmdkIntent(q); return r && r[0] ? (r[0].label || '') + ' | ' + (r[0].sub || '') : '(none)'; };
    let h = head('how many repeat guests do i have');
    check('repeat rate: 1 repeat of 4 customers (25%), Sarah leads with 2 stays', /1 repeat guest — 25% come back/.test(h) && /Sarah leads with 2 stays/.test(h), h);
    const repRows = ctx.cmdkIntent('repeat guests') || [];
    check('repeat rate: the two name-only John Smiths did NOT merge into a repeat', repRows.length && !repRows.some((r2) => /John/.test(r2.label || '')), repRows.map((r2) => r2.label).join(' / '));
    h = head('what is the average stay');
    check(`average stay: (4+2+7+2+2)/5 = 3.4 nights, widened to ${yr}`, new RegExp(`3\\.4-night average stay in ${yr}`).test(h) && /shortest 2, longest 7/.test(h), h);
    h = head('how long do guests stay');
    check('habitual "how long do guests stay" answers the average, not one guest', /average stay/.test(h), h);
    h = head('average stay in march');
    check('explicit period keeps it: "average stay in march" → 7 nights', /7-night average stay in March/.test(h), h);
    h = head('average nightly rate');
    check('average RATE family still intact (not hijacked by average stay)', /avg\/night/.test(h), h);
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null;', ctx);
}

// ---- 32. Ambient intelligence: chbAnomalies (deterministic opportunity rows —
// bounded 2-4-night gaps carrying chbGapPlan's best-outcome decision (one-tap
// dated offer, 20% when imminent, live-status when already set), next-month
// shortfall vs last year) and chbGuestIntel
// (the "Knows your guest" hub card — strong identity only, mentions from the
// in-memory history index, null when there's nothing worth knowing). ----
if (typeof ctx.chbAnomalies === 'function' && typeof ctx.chbGuestIntel === 'function') {
    const today = ctx.todayDashed();
    const plus = (nn) => { const dd = new Date(today + 'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate() + nn); return dd.toISOString().slice(0, 10); };
    const mkb = (id, name, email, inD, outD) => ({ id, name, email, checkIn: inD, checkOut: outD, adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 400 } });
    const seed = (rows, blocks) => { ctx.__seedAn = { rows: rows || [], blocks: blocks || [] }; vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedAn.rows;dbBlocks.jollyboat=__seedAn.blocks;__cmdkCustomers=null;', ctx); };
    const anomalies = () => ctx.chbAnomalies();
    const gapRows = () => anomalies().filter((a) => /night gap on|Offer live on/.test(a.label));

    // Gaps — each row carries chbGapPlan's DECISION (offer vs live status).
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8)), mkb(2, 'Cara B', 'c@x.co', plus(11), plus(14))]);
    let g = gapRows();
    check('a bounded 3-night gap 8 days out proposes the 15% offer (£130→£111)', g.length === 1 && /Fill the 3-night gap on .*: offer £111\/night/.test(g[0].label) && g[0].act === 'Offer' && /15% off the usual £130/.test(g[0].sub), g.map((x) => `${x.label} | ${x.sub} [${x.act}]`).join(' || '));
    seed([mkb(1, 'Bob A', 'b@x.co', plus(2), plus(5)), mkb(2, 'Cara B', 'c@x.co', plus(8), plus(11))]);
    g = gapRows();
    check('an IMMINENT gap (≤7 days out) cuts deeper — 20% (£130→£104)', g.length === 1 && /offer £104\/night/.test(g[0].label) && /20% off/.test(g[0].sub), g.map((x) => `${x.label} | ${x.sub}`).join(' || '));
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8)), mkb(2, 'Cara B', 'c@x.co', plus(11), plus(14))]);
    vm.runInContext(`propertySeasons.jollyboat = [{ label: 'Gap offer', start_date: '${plus(8)}', end_date: '${plus(10)}', couple_rate: 111 }];`, ctx);
    g = gapRows();
    check('an offer ALREADY LIVE is reported as live and routes to Rates, never re-suggested', g.length === 1 && /Offer live on .* — £111\/night/.test(g[0].label) && g[0].act === 'Rates' && !/one tap sets/.test(g[0].sub), g.map((x) => `${x.label} [${x.act}]`).join(' || '));
    vm.runInContext('propertySeasons.jollyboat = [];', ctx);
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8)), mkb(2, 'Cara B', 'c@x.co', plus(9), plus(12))]);
    check('a 1-night hole (changeover slack) stays silent', gapRows().length === 0);
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8)), mkb(2, 'Cara B', 'c@x.co', plus(14), plus(17))]);
    check('a 6-night hole is not a "gap" (silent)', gapRows().length === 0);
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8))]);
    check('unbounded future space is not a gap (silent)', gapRows().length === 0);
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8)), mkb(2, 'Cara B', 'c@x.co', plus(11), plus(14))], [{ id: 900, source: 'owner', checkIn: plus(8), checkOut: plus(11) }]);
    check('an owner block over the hole = deliberately held (silent)', gapRows().length === 0);
    seed([mkb(1, 'Bob A', 'b@x.co', plus(50), plus(53)), mkb(2, 'Cara B', 'c@x.co', plus(56), plus(59))]);
    check('a gap starting beyond 45 days stays silent', gapRows().length === 0);
    seed([mkb(1, 'Bob A', 'b@x.co', plus(5), plus(8))], [{ id: 901, source: 'airbnb', checkIn: plus(11), checkOut: plus(14) }]);
    g = gapRows();
    check('an OTA-bounded gap counts (booking → gap → Airbnb stay)', g.length === 1, g.map((x) => x.label).join(' | '));

    // Next-month shortfall vs last year.
    const d0 = new Date(today + 'T00:00:00');
    const nmY = d0.getMonth() === 11 ? d0.getFullYear() + 1 : d0.getFullYear();
    const nmM = (d0.getMonth() + 1) % 12;
    const nm = (y, day) => `${y}-${String(nmM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pacingRows = () => anomalies().filter((a) => /looking light/.test(a.label));
    seed([mkb(1, 'Old A', 'o@x.co', nm(nmY - 1, 2), nm(nmY - 1, 14)), mkb(2, 'New B', 'n@x.co', nm(nmY, 2), nm(nmY, 4))]);
    let p = pacingRows();
    check('next month at 2 nights vs 12 last year → "looking light" flagged', p.length === 1 && /2 nights booked vs 12 last year/.test(p[0].label), p.map((x) => x.label).join(' | '));
    seed([mkb(1, 'Old A', 'o@x.co', nm(nmY - 1, 2), nm(nmY - 1, 14)), mkb(2, 'New B', 'n@x.co', nm(nmY, 2), nm(nmY, 10))]);
    check('a month at ≥50% of last year stays silent', pacingRows().length === 0);
    seed([mkb(1, 'Old A', 'o@x.co', nm(nmY - 1, 2), nm(nmY - 1, 8))]);
    check('a naturally quiet month (last year <8 nights) never nags', pacingRows().length === 0);

    // Guest intel.
    const yr = today.slice(0, 4);
    seed([
        mkb(11, 'Sarah Holt', 'sarah@example.com', `${yr}-01-10`, `${yr}-01-14`),
        mkb(12, 'Sarah Holt', 'sarah@example.com', `${yr}-03-03`, `${yr}-03-05`),
        mkb(13, 'Sarah Holt', 'sarah@example.com', `${yr}-06-01`, `${yr}-06-03`),
        mkb(14, 'John Smith', '', `${yr}-05-02`, `${yr}-05-04`),
        mkb(15, 'John Smith', '', `${yr}-07-01`, `${yr}-07-03`),
        mkb(16, 'First Timer', 'ft@x.co', `${yr}-08-01`, `${yr}-08-03`),
    ]);
    const bk = (id) => vm.runInContext(`dbBookings.jollyboat.find((b)=>b.id===${id})`, ctx);
    let intel = ctx.chbGuestIntel('jollyboat', bk(12));
    check('repeat guest: ordinal + lifetime + favourite cottage composed', !!(intel && intel.ordinal === '2nd stay' && intel.stays === 3 && /Jollyboat/i.test(intel.favName)), JSON.stringify(intel && { o: intel.ordinal, s: intel.stays, f: intel.favName }));
    check('repeat guest: last stay names the month of the PREVIOUS visit', !!(intel && /January/.test(intel.lastStay)), intel && intel.lastStay);
    check('a name-only John Smith gets NO card (weak identity, false-merge guard)', ctx.chbGuestIntel('jollyboat', bk(14)) === null);
    check('a first-time guest with no history gets NO card (empty dossier = noise)', ctx.chbGuestIntel('jollyboat', bk(16)) === null);
    // Mentions from the in-memory history index — strong-first matching.
    vm.runInContext(`
        CHB_HIST.docs = [
            { type: 'email', id: 1, text: 'Booking confirmed — your stay details', date: '2026-05-01', extra: { to: 'sarah@example.com' } },
            { type: 'message', id: 2, text: 'Hi this is Sarah Holt, can we arrive early?', date: '2026-05-02', extra: {} },
            { type: 'message', id: 3, text: 'Sarah Jones here about the parking', date: '2026-05-03', extra: {} },
            { type: 'activity', id: 4, text: 'Booking edited for Sarah Holt', date: '2026-05-04', extra: {} },
            { type: 'email', id: 5, text: 'Your balance reminder', date: '2026-05-05', extra: { to: 'sarah@example.com' } },
        ];
        CHB_HIST.built = true; CHB_HIST.enc = 0;
    `, ctx);
    intel = ctx.chbGuestIntel('jollyboat', bk(12));
    const mTypes = ((intel && intel.mentions) || []).map((m) => m.type + ':' + m.id).join(',');
    check('mentions: email-address + full-name matches only, capped at 2, newest first', mTypes === 'email:5,message:2' || mTypes === 'email:5,email:1', mTypes);
    check('mentions: the other Sarah (Jones) and the activity log never leak in', !/id.?:.?[34]/.test(JSON.stringify(intel && intel.mentions)) && mTypes.indexOf('3') < 0 && mTypes.indexOf('activity') < 0, mTypes);
    vm.runInContext('CHB_HIST.docs = []; CHB_HIST.built = false; Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);__cmdkCustomers=null;', ctx);
} else fail('chbAnomalies / chbGuestIntel missing from the bundle');

// ---- 33. Conversational frame: a one-slot follow-up ("and last year",
// "just jollyboat", "occupancy", "vs last month") patches the previous metric
// answer's frame and re-runs the same families; "vs" composes the delta.
// Monotonic-safe: full questions, bare names, ops queries, no-frame and
// stale-frame cases all fall through to the normal pipeline untouched. ----
if (typeof ctx.chbConvResolve === 'function' && typeof ctx.cmdkBuildResults === 'function') {
    const yr = +ctx.todayDashed().slice(0, 4);
    const mkb = (id, name, ci, co, tot) => ({ id, name, email: name.replace(/\s+/g, '') + '@x.co', checkIn: ci, checkOut: co, adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: tot } });
    ctx.__seedCv = {
        jb: [mkb(1, 'Ann A', `${yr}-02-10`, `${yr}-02-13`, 400), mkb(2, 'Ben B', `${yr}-05-01`, `${yr}-05-03`, 300), mkb(3, 'Old C', `${yr - 1}-06-01`, `${yr - 1}-06-09`, 1000)],
        ta: [mkb(4, 'Cat D', `${yr}-03-01`, `${yr}-03-04`, 600), mkb(5, 'Old E', `${yr - 1}-04-01`, `${yr - 1}-04-03`, 200)],
    };
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedCv.jb;dbBookings["21a"]=__seedCv.ta;__cmdkCustomers=null;__cmdkFrame=null;', ctx);
    const top = (q) => { const r = ctx.cmdkBuildResults(q); const t = (r.results || [])[0]; return t ? `[${t.type}/${t.id}] ${t.label}` : '(none)'; };
    top('revenue this year'); // frames the conversation (head stays the golden-pinned action row)
    let h = top('and last year');
    check(`"and last year" refines to last year's revenue figure (£1,200)`, /£1,200\.00 booked in \d{4}/.test(h), h);
    h = top('just jollyboat');
    check('"just jollyboat" scopes the SAME frame to the cottage (£1,000)', /£1,000\.00 booked in \d{4} at Jollyboat/.test(h), h);
    h = top('occupancy');
    check('bare "occupancy" swaps the metric, KEEPING period + cottage', /% occupancy in \d{4} at Jollyboat/.test(h), h);
    h = top('this year');
    check('bare period patches back to this year (chain continues)', new RegExp(`% occupancy in ${yr} at Jollyboat`).test(h), h);
    h = top('vs last year');
    check('"vs last year" composes the delta from BOTH frames', /^\[answer\/cmp\] this year: .+ · last year: .+ — (up|down|level)/.test(h), h);
    h = top('as nights');
    check('"as nights" swaps to the nights family, scope intact', /nights booked in \d{4} at Jollyboat/.test(h), h);
    // Guards — none of these are refinements.
    h = top('who owes money');
    check('a standalone ops question is never read as a refinement', !/at Jollyboat|booked in/.test(h), h);
    vm.runInContext(`__cmdkFrame = { slots: { metric: 'revenue', period: 'this year', prop: null }, at: Date.now() }`, ctx);
    h = top('jollyboat');
    check('a BARE cottage name stays the identity dossier (marker required to scope)', !/booked in|£1,000/.test(h), h);
    vm.runInContext('__cmdkFrame = null', ctx);
    h = top('occupancy');
    check('bare metric with NO frame keeps its own default (this month)', /occupancy this month/.test(h), h);
    vm.runInContext(`__cmdkFrame = { slots: { metric: 'revenue', period: 'this year', prop: null }, at: Date.now() - 200000 }`, ctx);
    h = top('and last year');
    check('a STALE frame (>3 min) never hijacks a follow-up', !/booked in/.test(h), h);
    // Prop-scoped insights stand alone too (what the refinement composes).
    vm.runInContext('__cmdkFrame = null', ctx);
    h = top('occupancy at 21a this year');
    check('standalone prop-scoped insights: "occupancy at 21a this year"', /% occupancy in \d{4} at 21A/.test(h), h);
    h = top('jollyboat earned last year');
    check('standalone prop-scoped money figure', /£1,000\.00 booked in \d{4} at Jollyboat/.test(h), h);
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null;__cmdkFrame=null;', ctx);
} else fail('chbConvResolve missing from the bundle');

// ---- 34. Booking logic in search: live QUOTES (priced from the model, checked
// against the calendar, one-tap prefilled booking), clash-aware add/block
// commands, and MOVE/EXTEND/SHORTEN proposals that compute + verify new dates
// and open the editor prefilled — never saving anything themselves. ----
if (typeof ctx.cmdkBookClash === 'function') {
    const today = ctx.todayDashed();
    const plus = (nn) => { const dd = new Date(today + 'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate() + nn); return dd.toISOString().slice(0, 10); };
    const mkb = (id, name, ci, co) => ({ id, name, email: 'x@x.co', checkIn: ci, checkOut: co, adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 500 } });
    ctx.__seedBk = { jb: [mkb(1, 'Bob Carter', plus(10), plus(13)), mkb(2, 'Alice Marsh', plus(-1), plus(2))], ta: [mkb(3, 'Cara Dunn', plus(20), plus(23))] };
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedBk.jb;dbBookings["21a"]=__seedBk.ta;__cmdkCustomers=null;__cmdkFrame=null;', ctx);
    const d = (n) => { const x = new Date(today + 'T00:00:00'); x.setDate(x.getDate() + n); return x.getDate() + ' ' + x.toLocaleDateString('en-GB', { month: 'short' }).toLowerCase(); };
    const rows = (q) => ctx.cmdkIntent(q) || [];
    const head = (q) => { const r = rows(q)[0]; return r ? `${r.label} | ${r.sub || ''}` : '(none)'; };

    // Quotes.
    let h = head(`how much for ${d(30)} to ${d(33)} at jollyboat`);
    check('quote: free dates → £ total, nights, free ✓, avg/night', /£[\d,.]+ for 3 nights at Jollyboat \|.*free ✓.*\/night/.test(h), h);
    const exp = ctx.priceBreakdown('jollyboat', 2, 0, plus(30), plus(33));
    check('quote: the figure IS the live price model’s total', h.indexOf(exp.total.toFixed(2)) >= 0, `${h} vs ${exp.total}`);
    h = head(`quote for jollyboat ${d(10)} to ${d(12)}`);
    check('quote: taken dates say WHO has them', /⚠ taken then \(Bob Carter\)/.test(h), h);
    const alt = rows(`quote for jollyboat ${d(10)} to ${d(12)}`).slice(1);
    check('quote: free ALTERNATIVES ride beneath, priced', alt.length >= 1 && /is free those dates — £[\d,.]+/.test(alt[0].label), alt.map((r) => r.label).join(' | '));
    h = head(`how much for 3 nights from ${d(40)}`);
    check('quote: no cottage named → "From £X" across the fleet', /^From £[\d,.]+ — /.test(h), h);
    h = head('price for next weekend 2 adults 1 child');
    check('quote: party size parsed into the sub', /2 adults \+ 1 child/.test(h), h);
    // Clash-aware commands.
    h = head(`add booking for smith ${d(10)} to ${d(12)} jollyboat`);
    check('add-booking command warns on a clash + names the free cottages', /⚠ Jollyboat is taken then \(Bob Carter\) — .*(free|nothing else)/.test(h), h);
    h = head(`add booking for smith ${d(30)} to ${d(32)} jollyboat`);
    check('add-booking command confirms free dates', /Dates are free ✓/.test(h), h);
    h = head(`block jollyboat ${d(10)} to ${d(12)}`);
    check('block command warns when a GUEST is booked over the range', /⚠ Bob Carter is booked/.test(h), h);
    // Move / extend / shorten proposals.
    h = head('move bob back a week');
    check('"move bob back a week" → computed dates + free verdict + editor route', /Move Bob Carter: \d{2}\/\d{2}\/\d{4} → \d{2}\/\d{2}\/\d{4} \(3 nights\) \| Free ✓/.test(h), h);
    h = head(`move bob to ${d(19)}`);
    check('"move bob to <date>" keeps the stay length', /\(3 nights\)/.test(h), h);
    h = head('extend bob by 2 nights');
    check('"extend bob by 2 nights" → 5-night proposal', /Extend Bob Carter: .*\(5 nights\)/.test(h), h);
    h = head('shorten bob by a night');
    check('"shorten bob by a night" → 2-night proposal', /Shorten Bob Carter: .*\(2 nights\)/.test(h), h);
    // Clash on the proposed dates is NAMED (move Bob onto Cara's cottage dates
    // is fine — different cottage — so clash-check within the same cottage).
    vm.runInContext('dbBookings.jollyboat.push({ id: 9, name: "Wall Guest", checkIn: "' + plus(17) + '", checkOut: "' + plus(20) + '", adults: 2, children: 0, payment: "paid", holdStatus: "none", agreedPrice: { total: 100 } });', ctx);
    h = head('move bob back a week');
    check('a proposal that clashes NAMES the blocker', /⚠ Clashes with Wall Guest/.test(h), h);
    vm.runInContext('dbBookings.jollyboat = dbBookings.jollyboat.filter((b) => b.id !== 9);', ctx);
    h = head('move alice back a week');
    check('an arrived guest’s dates are locked (no move proposal)', /Alice Marsh has already arrived — dates are locked/.test(h), h);
    // Guards.
    h = head('how much have i earned this year');
    check('money-insights question is NEVER a quote', /booked in \d{4}/.test(h) && !/night at|From £/.test(h), h);
    check('"move the calendar to august" is not a guest command (falls through)', !/Move .*:/.test(head('move the calendar to august')), head('move the calendar to august'));
    check('quote without any dates falls through', !/^From £|for \d+ nights at/.test(head('how much does it cost')), head('how much does it cost'));
    vm.runInContext('Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null;', ctx);
} else fail('cmdkBookClash missing from the bundle');

// ---- 35. Demand-based pricing in search: dated price-change COMMANDS (preview
// maths from the season-aware current rate; Apply saves a spliced rate_seasons
// override through the existing validated endpoint) and pricing SUGGESTIONS
// (gap offers + the coach; server demand signals merge async). ----
if (typeof ctx.chbSeasonSplice === 'function') {
    const today = ctx.todayDashed();
    const plus = (nn) => { const dd = new Date(today + 'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate() + nn); return dd.toISOString().slice(0, 10); };
    const mkb = (id, name, ci, co) => ({ id, name, email: 'x@x.co', checkIn: ci, checkOut: co, adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 500 } });
    ctx.__seedPr = [mkb(1, 'Bob', plus(5), plus(8)), mkb(2, 'Cara', plus(11), plus(14))]; // 3-night gap +8..+11
    vm.runInContext(`Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedPr;__cmdkCustomers=null;__cmdkFrame=null;
        propertySeasons.jollyboat = [{ label: 'Summer', start_date: '${plus(0)}', end_date: '${plus(60)}', couple_rate: 140 }];
        __prSaved = null; __prOldApi = apiPost; apiPost = async (u, b) => { __prSaved = { u, b }; return { ok: true }; };`, ctx);
    const head = (q) => { const r = ctx.cmdkIntent(q); return r && r[0] ? `${r[0].label} | ${r[0].sub || ''}` : '(none)'; };

    // Command parsing + preview maths (current rate derived, not hardcoded —
    // the shim's defaults own the December base).
    const decCur = ctx.chbCoupleRateOn('jollyboat', `${+today.slice(0, 4) + (today.slice(5) > '12-20' ? 1 : 0)}-12-20`);
    let h = head('set jollyboat to £150 for 20 to 23 december');
    check('SET absolute: dated preview with current→new maths', new RegExp(`Set Jollyboat to £150/night · 20/12/\\d{4}–22/12/\\d{4} \\| Currently £${decCur}/night → £150`).test(h), h);
    h = head('discount jollyboat by 10% for next weekend');
    check('DISCOUNT %: computed from the SEASON-aware current rate (£140→£126)', /£126\/night/.test(h) && /£140\/night → £126 \(-10%\)/.test(h), h);
    h = head('raise jollyboat prices 15% for september');
    check('RAISE % for a bare month: whole-month override (1st–30th)', /£161\/night · 01\/09\/\d{4}–30\/09\/\d{4}/.test(h), h);
    // Guards.
    check('"change prices" (no cottage/dates) keeps the generic rates action', /Change prices & rates/.test(head('change prices')), head('change prices'));
    check('nonsense with a set-verb falls through', head('set the table for dinner') === '(none)');

    // Suggestions: gap offer at 15% off the season rate + the coach lead.
    const sugg = ctx.cmdkIntent('should i change my prices') || [];
    check('pricing question leads with the coach route', sugg[0] && /Pricing coach/.test(sugg[0].label), sugg[0] && sugg[0].label);
    const gapRow = sugg.find((r) => /gap on Jollyboat/.test(r.label || ''));
    check('gap offer suggests 15% off the season rate (£140→£119) with the dates', !!gapRow && /£119\/night \(15% off\)/.test(gapRow.label) && /£140 → £119/.test(gapRow.sub), gapRow && `${gapRow.label} | ${gapRow.sub}`);

    // Splice: an override INSIDE an existing season splits it (never shadowed).
    const spliced = ctx.chbSeasonSplice(
        [{ label: 'Summer', start: '2026-07-01', end: '2026-08-31', rate: 140 }],
        { label: 'Offer', start: '2026-07-20', end: '2026-07-23', rate: 119 },
    );
    check('splice: override inside a season → before-part + override + after-part',
        spliced.length === 3 &&
        spliced[0].end === '2026-07-19' && spliced[1].label === 'Offer' && spliced[2].start === '2026-07-24' &&
        spliced[0].rate === 140 && spliced[2].rate === 140,
        JSON.stringify(spliced));
    const noTouch = ctx.chbSeasonSplice([{ label: 'Xmas', start: '2026-12-20', end: '2026-12-28', rate: 200 }], { label: 'Offer', start: '2026-07-20', end: '2026-07-23', rate: 119 });
    check('splice: non-overlapping seasons pass through untouched', noTouch.length === 2 && noTouch.find((s) => s.label === 'Xmas').rate === 200);

    // Apply: run the December SET — the async payload assertion lives in the
    // async tail below (the shim's setTimeout is inert; microtasks flush there).
    const applyRow = (ctx.cmdkIntent('set jollyboat to £150 for 20 to 23 december') || [])[0];
    if (applyRow) applyRow.run(); else fail('no apply row for the December set');
} else fail('chbSeasonSplice missing from the bundle');

// ---- 36. Owner's picks: the RICHER MORNING BRIEF (named arrivals with
// repeat/balance context, the soonest gap offer, the teach-loop nudge) — the
// undo command's async checks live in the async tail. ----
if (typeof ctx.cmdkBrief === 'function') {
    const today = ctx.todayDashed();
    const plus = (nn) => { const dd = new Date(today + 'T00:00:00Z'); dd.setUTCDate(dd.getUTCDate() + nn); return dd.toISOString().slice(0, 10); };
    ctx.__seedBr = {
        jb: [
            { id: 1, name: 'Rita Song', email: 'rita@x.co', checkIn: today, checkOut: plus(3), checkInTime: '15:00', adults: 2, children: 0, payment: 'deposit', depositPaid: 100, holdStatus: 'none', agreedPrice: { total: 500 } },
            { id: 2, name: 'Rita Song', email: 'rita@x.co', checkIn: plus(-200), checkOut: plus(-197), adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 400 } },
            { id: 3, name: 'Gap A', email: 'a@x.co', checkIn: plus(5), checkOut: plus(8), adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 300 } },
            { id: 4, name: 'Gap B', email: 'b@x.co', checkIn: plus(11), checkOut: plus(14), adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 300 } },
        ],
    };
    vm.runInContext(`Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);dbBookings.jollyboat=__seedBr.jb;__cmdkCustomers=null;
        chbNluStore('chb-search-misses', [{ t: 'weather for changeover', n: 2, at: '${today}' }, { t: 'paint the fence', n: 1, at: '${today}' }]); CHB_NLU.misses = null;`, ctx);
    const brief = ctx.cmdkBrief();
    const lbl = (id) => { const r = brief.find((x) => x.id === id || String(x.id).startsWith(id)); return r ? `${r.label} | ${r.sub}` : '(none)'; };
    check('brief: today’s arrival is NAMED with her check-in time', /Rita arrives today · 15:00/.test(lbl('brief-arr')), lbl('brief-arr'));
    check('brief: arrival context carries the repeat ordinal + money to take', /2nd stay with you/.test(lbl('brief-arr')) && /£400\.00 to take/.test(lbl('brief-arr')), lbl('brief-arr'));
    check('brief: the SOONEST gap rides as a ready-made offer (imminent → 20%)', /Worth a look: \d free nights on Jollyboat/.test(lbl('brief-gap')) && /offer £\d+\/night \(20% off\).*tap to apply/.test(lbl('brief-gap')), lbl('brief-gap'));
    check('brief: the teach-loop nudge counts this week’s dead ends', /2 searches found nothing this week/.test(lbl('brief-teach')), lbl('brief-teach'));
    vm.runInContext(`chbNluStore('chb-search-misses', [{ t: 'old one', n: 1, at: '2020-01-01' }]); CHB_NLU.misses = null;`, ctx);
    const brief2 = ctx.cmdkBrief();
    check('brief: STALE misses (older than a week) never nag', !brief2.some((x) => x.id === 'brief-teach'));
    vm.runInContext(`chbNluStore('chb-search-misses', []); CHB_NLU.misses = null; Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null;`, ctx);
} else fail('cmdkBrief missing from the bundle');

// ---- 37. Search precision hardening (audit iteration 1): matcher word-
// boundaries kill substring false-matches, capacity/insights branches stop
// stealing feature/deposit questions, the teach loop survives suppress→teach,
// a suppressed phrase isn't re-filed as a miss, bare social adjectives don't
// hijack the Top Hit, and more history-shaped verbs trigger meaning recall. ----
if (typeof ctx.cmdkIntent === 'function' && typeof ctx.chbNlgSocial === 'function') {
    const yr = ctx.todayDashed().slice(0, 4);
    const mkb = (id, name, ci, co, tot, pay, dep) => ({ id, name, email: name.replace(/\s+/g, '') + '@x.co', checkIn: `${yr}-${ci}`, checkOut: `${yr}-${co}`, adults: 2, children: 0, payment: pay || 'paid', depositPaid: dep || 0, holdStatus: 'none', agreedPrice: { total: tot } });
    vm.runInContext(`Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);__cmdkCustomers=null;__cmdkFrame=null;
        propertyMeta.jollyboat = propertyMeta.jollyboat || { name: 'Jollyboat' };`, ctx);
    ctx.__seedP37 = [mkb(1, 'Zed Ray', '02-10', '02-13', 400)];
    vm.runInContext('dbBookings.jollyboat = __seedP37;', ctx);
    const iHead = (q) => { const r = ctx.cmdkIntent(q); const t = r && r[0]; return t ? `[${t.type}/${t.id || '?'}] ${(t.label || '')}` : '(none)'; };
    // Substring false-matches on the Income & tax catch-all.
    ['book me a taxi', 'private booking', 'taxidermy', 'a taxing day'].forEach((q) => {
        check(`"${q}" no longer false-matches Income & tax`, !/Income & tax/.test(iHead(q)), iHead(q));
    });
    // Legit money words still reach it.
    check('"revenue this year" still reaches Income & tax (or a figure)', /Income & tax|£/.test(iHead('revenue this year')), iHead('revenue this year'));
    check('"revenues" (plural) still reaches Income & tax', /Income & tax/.test(iHead('revenues')), iHead('revenues'));
    check('"view accounts" still reaches Income & tax', /Income & tax/.test(iHead('view accounts')), iHead('view accounts'));
    // Capacity branch no longer steals "hold my deposit" / "sofa fit".
    check('"does jollyboat hold my deposit" is NOT answered "sleeps N"', !/sleeps up to/.test(iHead('does jollyboat hold my deposit')), iHead('does jollyboat hold my deposit'));
    check('capacity still answers with people-context', /sleeps up to/.test(iHead('how many people does jollyboat hold')), iHead('how many people does jollyboat hold'));
    // Insights best/top no longer swallow feature questions.
    check('"which cottage is best for families" is NOT a revenue figure', !/top earner|booked (this|last)|£[\d,]/.test(iHead('which cottage is best for families')), iHead('which cottage is best for families'));
    check('"which cottage is best for dogs" is NOT a revenue figure', !/top earner|booked (this|last)|£[\d,]/.test(iHead('which cottage is best for dogs')), iHead('which cottage is best for dogs'));
    // Social single-word hijack gone; real gratitude kept.
    ['good', 'right', 'magic', 'nice', 'cool', 'sure', 'fine'].forEach((w) => check(`bare "${w}" no longer fires a social reply`, !ctx.chbNlgSocial(w)));
    ['thanks', 'cheers', 'perfect', 'hello', 'bye', 'thank you'].forEach((w) => check(`real "${w}" still gets a social reply`, !!ctx.chbNlgSocial(w)));
    // Teach loop survives suppress→teach; suppressed phrase isn't a miss.
    // (The offline shim can't warm the model, so the fix under test is the
    // list-maintenance: re-teaching must REMOVE the phrase from the suppressed
    // list, whose gate hard-aborts chbNluClassify before any tier — the actual
    // silent-drop bug. Whether it then classifies depends on a warm model.)
    vm.runInContext(`chbNluStore('chb-nlu-suppressed', []); CHB_NLU.suppressed = null; chbNluStore('chb-nlu-learned', []); CHB_NLU.learned = null;`, ctx);
    ctx.chbNluSuppress('hows the takings looking today');
    check('a suppressed phrase classifies null (gate hard-aborts)', ctx.chbNluClassify('hows the takings looking today') === null && ctx.chbNluSuppressed().includes('hows the takings looking today'));
    ctx.chbNluLearn('hows the takings looking today', 'who owes me money');
    check('re-teaching REMOVES it from the suppressed list (lesson no longer silently dropped)', !ctx.chbNluSuppressed().includes('hows the takings looking today') && ctx.chbNluLearned().some((x) => x.t === 'hows the takings looking today'));
    vm.runInContext(`__cmdkMiss = { q: 'literal phrase i made stick', answered: false }; chbNluStore('chb-nlu-suppressed', ['literal phrase i made stick']); CHB_NLU.suppressed = null; chbNluStore('chb-search-misses', []); CHB_NLU.misses = null;`, ctx);
    ctx.chbMissRecord();
    check('a suppressed phrase is NOT re-filed as a dead-end miss', !ctx.chbMissList().some((m) => m.t === 'literal phrase i made stick'));
    // History-shaped verbs now trigger the clean/recall path.
    check('"call" is history-shaped (framing stripped to content)', ctx.chbHistoryClean('did the guest call about the heating') === 'heating');
    check('"flagged" is history-shaped', ctx.chbHistoryClean('who flagged the hot tub') === 'hot tub');
    vm.runInContext(`chbNluStore('chb-nlu-suppressed', []); chbNluStore('chb-nlu-learned', []); chbNluStore('chb-search-misses', []); CHB_NLU.misses = null; Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null; __cmdkMiss = null;`, ctx);
} else fail('cmdkIntent / chbNlgSocial missing from the bundle');

// ---- 37b. Date & window correctness (audit iteration 2): a booking on the LAST
// night of a named span is no longer read as "free", a same-month past day rolls
// to next year, breadth date maths use the UK day, a bare numeric range isn't
// computed, and a historical named-month resolves to its most recent instance. ----
if (typeof ctx.cmdkParseDates === 'function' && typeof ctx.chbCompute === 'function') {
    const t = ctx.todayDashed();
    const d0 = new Date(t + 'T00:00:00');
    // Inclusive-window off-by-one: a stay checking in on the last day of "August"
    // must be a conflict, not "free in August".
    const yr = d0.getFullYear() + (d0.getMonth() > 7 ? 1 : 0); // an August not fully past
    vm.runInContext(`Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);Object.keys(dbBlocks).forEach(k=>dbBlocks[k]=[]);__cmdkCustomers=null;
        dbBookings.jollyboat = [{ id: 'bwin', propKey: 'jollyboat', name: 'Last Night', checkIn: '${yr}-08-31', checkOut: '${yr}-09-02', adults: 2, children: 0, payment: 'paid', holdStatus: 'none', agreedPrice: { total: 200 } }];`, ctx);
    const aH = (q) => { const r = ctx.cmdkIntent(q); const t2 = r && r[0]; return t2 ? (t2.label || '') : '(none)'; };
    check('a booking on the LAST night of "August" is not reported free', /taken|No —/.test(aH('is jollyboat free in august')) && !/is free in august/i.test(aH('is jollyboat free in august')), aH('is jollyboat free in august'));
    vm.runInContext(`Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null;`, ctx);
    // cmdkParseDates: a same-month day already past rolls to next year (a booking
    // date is always the future); a future-month day stays this year.
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][d0.getMonth()];
    if (d0.getDate() > 2) {
        const pd = ctx.cmdkParseDates('book smith 1 ' + mon, t);
        check('a same-month past day parses to NEXT year, not a past date', pd && pd.from > t, JSON.stringify(pd));
    }
    // Breadth date maths seed from the UK day (not the device clock).
    const xmas = ctx.chbCompute('days until christmas');
    check('breadth "days until christmas" answers from the UK day', !!(xmas && /\d+ days until Friday 25 December/.test(xmas.label)), xmas && xmas.label);
    // A bare numeric range isn't treated as subtraction.
    check('"12-15" is NOT computed as -3', !ctx.chbCompute('12-15'), (ctx.chbCompute('12-15') || {}).label);
    check('"20-24" is NOT computed', !ctx.chbCompute('20-24'));
    check('real arithmetic still computes ("480 / 3")', !!ctx.chbCompute('480 / 3') && /160/.test(ctx.chbCompute('480 / 3').label));
} else fail('cmdkParseDates / chbCompute missing from the bundle');

// ---- 37c. Self-maintaining almanac (audit iteration 3): Easter + England &
// Wales bank holidays are COMPUTED, so "next bank holiday" never runs dry after
// the old 2026-27 table expired. Verify the algorithm against known-correct
// dates and that it reproduces the retired hardcoded table exactly. ----
if (typeof ctx.chbEaster === 'function' && typeof ctx.chbBankHols === 'function') {
    // Known Easter Sundays (Gregorian) — Meeus/Jones/Butcher must reproduce them.
    const easter = { 2024: '3-31', 2025: '4-20', 2026: '4-5', 2027: '3-28', 2028: '4-16', 2029: '4-1', 2030: '4-21', 2031: '4-13', 2032: '3-28' };
    const eOk = Object.keys(easter).every((y) => ctx.chbEaster(+y).join('-') === easter[y]);
    check('Easter computed correctly for 2024-2032', eOk, Object.keys(easter).map((y) => y + ':' + ctx.chbEaster(+y).join('-')).join(' '));
    // Reproduces the retired hardcoded 2026 table exactly.
    const bh26 = ctx.chbBankHols(2026).map(([d, n]) => d + ' ' + n);
    const want26 = ['2026-01-01 New Year\'s Day', '2026-04-03 Good Friday', '2026-04-06 Easter Monday', '2026-05-04 Early May bank holiday', '2026-05-25 Spring bank holiday', '2026-08-31 Summer bank holiday', '2026-12-25 Christmas Day', '2026-12-28 Boxing Day (substitute day)'];
    check('2026 bank holidays match the retired hardcoded table', JSON.stringify(bh26) === JSON.stringify(want26), bh26.join(' | '));
    // 2028+ (silent under the old table) now produces a full set incl. the NYD
    // substitute (1 Jan 2028 is a Saturday → Monday 3 Jan).
    const bh28 = ctx.chbBankHols(2028);
    check('2028 bank holidays are computed (was silent before)', bh28.length === 8 && bh28.some(([d, n]) => d === '2028-01-03' && /substitute/.test(n)), JSON.stringify(bh28));
    // The "next bank holiday" almanac answer resolves for any year.
    const nbh = ctx.chbAlmanac('when is the next bank holiday');
    check('"next bank holiday" answers (spans this year + next)', !!(nbh && /next bank holiday is/.test(nbh.label)), nbh && nbh.label);
} else fail('chbEaster / chbBankHols missing from the bundle');

// ---- 37d. Ranking quality (audit iteration 5): a whole-word label hit beats an
// incidental substring, and the row TYPE no longer leaks into the match haystack
// as free-text noise. Measured additive changes — golden/search ordering held. ----
if (typeof ctx.cmdkScore === 'function') {
    const mk = (label, type, kw) => ({ type: type || 'guest', label, sub: '', kw: kw || '' });
    // Word-boundary bonus: "ann" ranks a whole-word "Ann" above "Joanna".
    check('whole-word label hit outranks an incidental substring ("ann": Ann > Joanna)',
        ctx.cmdkScore(mk('Ann Reed'), ['ann'], 'ann') > ctx.cmdkScore(mk('Joanna Pike'), ['ann'], 'ann'));
    check('"art": Art > Bart (substring no longer ties)',
        ctx.cmdkScore(mk('Art Show'), ['art'], 'art') > ctx.cmdkScore(mk('Bart Lyle'), ['art'], 'art'));
    // it.type no longer matched as free text: a row whose ONLY "guest" occurrence
    // is its type name doesn't match the query "guest".
    check('the row TYPE is not matched as free-text ("guest" ≠ every guest-type row)',
        ctx.cmdkScore({ type: 'guest', label: 'Zeb Quill', sub: '', kw: '' }, ['guest'], 'guest') === 0);
    check('a real "guest" in the label still matches', ctx.cmdkScore({ type: 'booking', label: 'Guest House block', sub: '', kw: '' }, ['guest'], 'guest') > 0);
} else fail('cmdkScore missing from the bundle');

// ---- 30. Darkstar-C (contextual encoder) plumbing. The encoder itself is
// benched offline (it can't run in CI); what MUST hold here is the machinery:
// the WordPiece tokenizer, the encoder-built index (tagged CHB_HIST.enc, its
// own threshold), the sync static path declining an encoder index it can't
// query, rebuild-on-upgrade, and full graceful fallback with no model at all.
// This section is async (index builds await), so the summary lives at its end.
(async () => {
    // §35 async tail: the price-command Apply saved the SPLICED season list
    // through the validated endpoint and updated local state. Yield first so
    // the apply's microtask chain (await apiPost → state update) flushes.
    await null; await null; await null;
    if (typeof ctx.chbSeasonSplice === 'function') {
        const saved = vm.runInContext('__prSaved', ctx);
        check('apply posted seasons_save for the right cottage', !!(saved && saved.b && saved.b.action === 'seasons_save' && saved.b.prop_key === 'jollyboat'), JSON.stringify(saved && saved.b && { a: saved.b.action, p: saved.b.prop_key }));
        const list = (saved && saved.b && saved.b.seasons) || [];
        check('apply payload KEEPS the existing season and ADDS the dated override',
            list.some((s) => s.label === 'Summer' && s.rate === 140) && list.some((s) => s.rate === 150 && /-12-20$/.test(s.start) && /-12-22$/.test(s.end)),
            JSON.stringify(list));
        const st = vm.runInContext('propertySeasons.jollyboat', ctx);
        check('local propertySeasons updated with the override', Array.isArray(st) && st.some((s) => +s.couple_rate === 150), JSON.stringify(st));
        // §36 (async tail): UNDO reverses the very change §35 just applied —
        // through the same endpoint, restoring the exact prior season list.
        let h = (ctx.cmdkIntent('undo') || [])[0];
        check('"undo" offers to reverse the last search-saved change', !!(h && /Undo — £150\/night/.test(h.label)), h && h.label);
        vm.runInContext('__prSaved = null;', ctx);
        h.run();
        await null; await null; await null;
        const undone = vm.runInContext('__prSaved', ctx);
        check('undo re-saves the PRIOR season list (override gone, Summer intact)',
            !!(undone && undone.b && undone.b.action === 'seasons_save') &&
            undone.b.seasons.some((s) => s.label === 'Summer') && !undone.b.seasons.some((s) => s.rate === 150),
            JSON.stringify(undone && undone.b && undone.b.seasons));
        h = (ctx.cmdkIntent('undo') || [])[0];
        check('a second "undo" is honest: nothing to undo', !!(h && /Nothing to undo/.test(h.label)), h && h.label);
        vm.runInContext('apiPost = __prOldApi; propertySeasons.jollyboat = []; Object.keys(dbBookings).forEach(k=>dbBookings[k]=[]);__cmdkCustomers=null;', ctx);
    }
    if (typeof ctx.chbEncTokens === 'function') {
        // Tokenizer against a stub vocab: greedy longest-match, ## continuation,
        // punctuation split, [UNK] fallback, [CLS]/[SEP] framing.
        const V = new Map(['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'the', 'dog', 'play', '##ing', '##s', ','].map((t, i) => [t, i]));
        const ids = (s) => ctx.chbEncTokens(s, V);
        check('encoder tokenizer: "the dog playing" → CLS the dog play ##ing SEP', ids('the dog playing').join(',') === [2, 4, 5, 6, 7, 3].join(','), ids('the dog playing').join(','));
        check('encoder tokenizer: plural continuation + punctuation split', ids('dogs, playing').join(',') === [2, 5, 8, 9, 6, 7, 3].join(','), ids('dogs, playing').join(','));
        check('encoder tokenizer: un-tokenizable word → [UNK]', ids('zebra').join(',') === [2, 1, 3].join(','), ids('zebra').join(','));

        // No model at all → the build declines quietly (keyword search unaffected).
        vm.runInContext('DARKSTAR.st = null; CHB_ENC.st = null; CHB_ENC.failed = true; CHB_HIST.built = false; CHB_HIST.docs = []; CHB_HIST.enc = 0;', ctx);
        await ctx.chbHistoryIndexBuild();
        check('no encoder + no static model → index build declines, no crash', vm.runInContext('CHB_HIST.built', ctx) === false);

        // Encoder-built index: stub the encoder (pure keyword-bucket vectors — the
        // real model is benched offline; this gates the PLUMBING) + the corpus.
        vm.runInContext(`
            __encStubApi = apiPost;
            apiPost = async (u, b) => (b && b.corpus) ? { corpus: [
                { type: 'review', id: 1, text: 'we brought our labrador and he loved the garden', date: '2026-06-01' },
                { type: 'review', id: 2, text: 'the neighbours were awfully loud at night', date: '2026-06-02' },
                { type: 'message', id: 3, text: 'the radiators never warmed up', date: '2026-06-03' },
            ] } : __encStubApi(u, b);
            CHB_ENC.st = { embed: async (t) => {
                t = String(t).toLowerCase();
                if (/dog|pet|labrador|puppy/.test(t)) return [1, 0, 0, 0];
                if (/noise|noisy|loud/.test(t)) return [0, 1, 0, 0];
                if (/heating|radiator|boiler/.test(t)) return [0, 0, 1, 0];
                return [0, 0, 0, 1];
            } };
            CHB_ENC.failed = false;
        `, ctx);
        await ctx.chbHistoryIndexBuild(true);
        check('encoder-built index: built + stamped with the encoder version', vm.runInContext('CHB_HIST.built && CHB_HIST.enc === CHB_ENC.ver', ctx) === true, 'enc=' + vm.runInContext('CHB_HIST.enc', ctx));
        check('sync static path DECLINES an encoder-built index (different space)', ctx.chbHistorySemantic('any pets', 3).length === 0);
        const encRows = vm.runInContext('CHB_ENC.st.embed("did anyone bring a pet").then((qv) => chbHistoryRank(qv, 3))', ctx);
        const pet = await encRows;
        check('encoder query path: "pet" recalls the labrador review by meaning', !!(pet[0] && /labrador/i.test(pet[0].label)), pet[0] ? pet[0].label : 'none');
        const off = await vm.runInContext('CHB_ENC.st.embed("quarterly vat figures").then((qv) => chbHistoryRank(qv, 3))', ctx);
        check('encoder query path: unrelated query recalls nothing (threshold holds)', off.length === 0, off.map((r) => r.label).join(' | '));

        // Rebuild-on-upgrade: an index built BEFORE the encoder landed rebuilds
        // (and re-embeds) the first time a history query runs with it loaded.
        vm.runInContext('CHB_HIST.enc = 0; CHB_HIST.at = Date.now();', ctx);
        await ctx.cmdkSemanticHistory('what did guests say about the dog');
        check('an index built pre-encoder rebuilds once the encoder lands', vm.runInContext('CHB_HIST.enc === CHB_ENC.ver', ctx) === true, 'enc=' + vm.runInContext('CHB_HIST.enc', ctx));
        vm.runInContext('apiPost = __encStubApi; CHB_ENC.st = null; CHB_HIST.built = false; CHB_HIST.docs = []; CHB_HIST.enc = 0;', ctx);
    } else fail('chbEncTokens missing from the bundle');

    // ---- 31. Model-download progress: the streamed fetch reports fractions and
    // reassembles the exact bytes; multiple in-flight downloads show the
    // least-finished; the idle pill slot falls back to `loading` while a
    // download runs. (The visual ring is gated by ui-test-modelring.js.) ----
    if (typeof ctx.chbFetchProgress === 'function') {
        vm.runInContext(`
            __ringOldFetch = fetch;
            fetch = async () => ({
                ok: true,
                headers: { get: () => '10' },
                body: { getReader: () => { const chunks = [new Uint8Array([1,2,3,4,5]), new Uint8Array([6,7,8,9,10])]; let i = 0; return { read: () => Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }; } },
            });
        `, ctx);
        const fracs = [];
        const buf = await ctx.chbFetchProgress('x', (f) => fracs.push(f));
        check('streamed fetch reports per-chunk fractions (0.5, 1)', fracs.join(',') === '0.5,1', fracs.join(','));
        check('streamed fetch reassembles the exact bytes', Array.from(new Uint8Array(buf)).join(',') === '1,2,3,4,5,6,7,8,9,10');
        vm.runInContext('fetch = async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array([9, 9]).buffer })', ctx);
        const fb = await ctx.chbFetchProgress('x', () => {});
        check('no length/reader → falls back to a plain arrayBuffer (no ring)', new Uint8Array(fb).length === 2);
        vm.runInContext('fetch = __ringOldFetch', ctx);
        ctx.chbModelLoadProgress('a', 0.2);
        ctx.chbModelLoadProgress('b', 0.7);
        check('two in-flight downloads → the ring shows the least-finished', ctx.chbModelLoadFrac() === 0.2);
        ctx.chbModelLoadProgress('a', null);
        check('finishing one download hands the ring to the other', ctx.chbModelLoadFrac() === 0.7);
        const fakeEl = { dataset: {}, style: { setProperty() {}, removeProperty() {} }, querySelector: () => null, title: '' };
        ctx.chbSetModelStatus(fakeEl, '');
        check('idle pill slot reads `loading` while a download is in flight', fakeEl.dataset.mstate === 'loading', fakeEl.dataset.mstate);
        ctx.chbModelLoadProgress('b', null);
        check('all downloads done → the load fraction clears', ctx.chbModelLoadFrac() === null);
        ctx.chbSetModelStatus(fakeEl, '');
        check('…and the idle slot returns to rest', fakeEl.dataset.mstate === '', fakeEl.dataset.mstate);
    } else fail('chbFetchProgress missing from the bundle');

    // ---- Summary ----
    console.log('\n== Summary ==');
    if (failures) { console.log(`  ${failures} CHECK(S) FAILED ❌\n`); process.exit(1); }
    console.log('  ALL CHECKS PASSED ✅\n');
    process.exit(0);
})();
