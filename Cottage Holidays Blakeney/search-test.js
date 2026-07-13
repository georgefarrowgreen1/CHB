#!/usr/bin/env node
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
const helpAns = typeof ctx.cmdkHelp === 'function' ? ctx.cmdkHelp('how do i refund a deposit') : null;
check('cmdkHelp() answers a "how do I…" question with a help item', Array.isArray(helpAns) && helpAns.length > 0 && helpAns[0].type === 'help' && Array.isArray(helpAns[0].steps), 'got ' + (helpAns ? helpAns.length : 'null'));
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

// ---- Summary ----
console.log('\n== Summary ==');
if (failures) { console.log(`  ${failures} CHECK(S) FAILED ❌\n`); process.exit(1); }
console.log('  ALL CHECKS PASSED ✅\n');
process.exit(0);
