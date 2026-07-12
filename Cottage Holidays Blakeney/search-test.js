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

// ---- Summary ----
console.log('\n== Summary ==');
if (failures) { console.log(`  ${failures} CHECK(S) FAILED ❌\n`); process.exit(1); }
console.log('  ALL CHECKS PASSED ✅\n');
process.exit(0);
