#!/usr/bin/env node
// ============================================================
//  check-versions.js — CI gate for the deploy-checklist version chain
//  (dev/CI only — excluded from deploy).
//
//  smoke-test.js already guards the STATIC consistency (sw.js CORE ?v= ==
//  index.html ?v=, BUILD well-formed). This check adds the GIT half: if a PR
//  changes a cached asset, its cache-buster must change too — the class of
//  mistake that ships fine in CI and then serves guests a stale file.
//
//  Rules (each only when the source file changed between base and head):
//    app.js       → index.html app.js?v= bumped  AND  const BUILD changed
//    app.css      → index.html app.css?v= bumped
//    guest-app.js / guest-app.css → their ?v= bumped
//    admin.js     → ADMIN_BUNDLE_V (app.js) bumped
//    admin.css    → ADMIN_CSS_V (app.js) bumped
//    any of the above or index.html → sw.js CACHE bumped
//
//  Base/head come from CHB_BASE_SHA / CHB_HEAD_SHA (set by ci.yml). If the
//  diff can't be computed (shallow clone, force push), the check SKIPS —
//  it must never block a PR on git plumbing. `node bump.js <stamp>` does all
//  of the above in one go.
// ============================================================
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const DIR = __dirname;
const base = process.env.CHB_BASE_SHA;
const head = process.env.CHB_HEAD_SHA || 'HEAD';
const PREFIX = 'Cottage Holidays Blakeney/';

const git = (cmd) => execSync(cmd, { cwd: DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

if (!base || /^0+$/.test(base)) {
    console.log('check-versions: no base SHA (not a PR / new branch) — skipping.');
    process.exit(0);
}

let changed, at;
try {
    changed = new Set(git(`git diff --name-only ${base} ${head}`).split('\n')
        .filter(f => f.startsWith(PREFIX)).map(f => path.basename(f)));
    at = (sha, file) => { try { return git(`git show ${sha}:"${PREFIX}${file}"`); } catch (e) { return ''; } };
    at(base, 'index.html'); // probe: throws → skip below
} catch (e) {
    console.log('check-versions: could not diff base…head (' + e.message.split('\n')[0] + ') — skipping.');
    process.exit(0);
}

const grab = (src, re) => (src.match(re) || [])[1] || null;
const fails = [];
const ok = [];
// `detail` is the DIAGNOSIS — what went wrong and how to fix it — so it belongs on
// a failure only. It used to print on both, which made every passing line read like
// a complaint ("✓ app.js changed → its ?v= bumped — still ?v=566 (run: node bump.js)"
// says the opposite of what happened).
const rule = (name, cond, detail) => (cond ? ok.push(name) : fails.push(`${name}${detail ? ' — ' + detail : ''}`));

const baseHtml = at(base, 'index.html');
const headHtml = at(head, 'index.html');
const baseApp = at(base, 'app.js');
const headApp = at(head, 'app.js');
const vOf = (src, asset) => grab(src, new RegExp('(?<![-\\w])' + asset.replace('.', '\\.') + '\\?v=(\\d+)'));

['app.js', 'app.css', 'guest-app.js', 'guest-app.css'].forEach((a) => {
    if (!changed.has(a)) return;
    const b = vOf(baseHtml, a);
    const h = vOf(headHtml, a);
    rule(`${a} changed → its ?v= bumped`, b !== h, `still ?v=${h} (run: node bump.js <stamp>)`);
});
if (changed.has('app.js')) {
    rule('app.js changed → BUILD stamp changed', grab(baseApp, /const BUILD = '([a-z0-9]+)';/) !== grab(headApp, /const BUILD = '([a-z0-9]+)';/), 'const BUILD (last statement of app.js) is unchanged');
}
// admin-views.html (the back-office markup) rides admin.js's stamp — admin.js
// renders into that markup, so they must always ship as one version.
if (changed.has('admin.js') || changed.has('admin-views.html')) {
    const which = [changed.has('admin.js') && 'admin.js', changed.has('admin-views.html') && 'admin-views.html'].filter(Boolean).join(' + ');
    rule(`${which} changed → ADMIN_BUNDLE_V bumped`, grab(baseApp, /const ADMIN_BUNDLE_V = (\d+);/) !== grab(headApp, /const ADMIN_BUNDLE_V = (\d+);/), 'ADMIN_BUNDLE_V (top of app.js) is unchanged');
}
if (changed.has('admin.css')) {
    rule('admin.css changed → ADMIN_CSS_V bumped', grab(baseApp, /const ADMIN_CSS_V = (\d+);/) !== grab(headApp, /const ADMIN_CSS_V = (\d+);/), 'ADMIN_CSS_V (top of app.js) is unchanged');
}
// ---- WHAT NEEDS A CACHE BUMP IS DERIVED, NOT LISTED ----------------------------
// This used to be a hand-written array — ['app.js','app.css','guest-app.js',
// 'guest-app.css','index.html'] — and a hand-written array is a list somebody has
// to remember to update. That is the defect that shipped a broken 3-D Secure fix:
// the CSP is not a file in any list, so nothing demanded a bump, and installed PWAs
// went on enforcing the old policy while the server served the new one. Both rules
// below now read their inputs from the source of truth, so a new precached asset or
// a new security header is covered the day it is written.
const cacheV = (sha) => grab(at(sha, 'sw.js'), /const CACHE = 'chb-cache-v(\d+)';/);
const cacheBumped = cacheV(base) !== cacheV(head);

// (1) THE PRECACHE LIST IS sw.js's OWN `CORE`. Anything in it is stored in the
// Cache API and served to installed clients until CACHE changes — so if one of
// those files changed in this PR, CACHE must change too. Derived from CORE rather
// than restated, which is what makes a future addition to CORE self-covering.
const coreRaw = grab(at(head, 'sw.js'), /const CORE = \[([^\]]*)\]/);
const coreFiles = [...new Set((coreRaw || '').split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, '').replace(/\?v=\d+$/, '').replace(/^\.\//, ''))
    .filter((f) => f && f !== '' && /\.[a-z0-9]+$/i.test(f)))];
// A guard, in the a11y-test §1b spirit: if the parse ever stops finding entries
// (someone reformats CORE across lines), this rule would silently cover NOTHING.
// Fail loudly instead of passing vacuously.
rule(`sw.js CORE parsed for the precache rule (${coreFiles.length} assets)`, coreFiles.length >= 5,
    'const CORE did not parse — the derived cache rule would cover NOTHING and pass in silence');
const coreChanged = coreFiles.filter((f) => changed.has(f));
if (coreChanged.length) {
    rule(`precached asset changed (${coreChanged.join(', ')}) → sw.js CACHE bumped`, cacheBumped, 'CACHE (sw.js) is unchanged');
}

// (2) RESPONSE HEADERS RIDE ON THE CACHED SHELL. The Cache API stores headers with
// the body, and sw.js serves the precached index.html on any navigation the network
// does not answer — so a header set in htaccess.txt reaches installed clients only
// when the shell is refetched. Measured: PR #861 widened form-action for 3-D Secure,
// changed no file in any list, and nothing bumped; the live server sent the new
// policy (curl-confirmed at the domain) while the owner's phone kept reporting
// "CSP blocked form-action → methodurl.vcas.visa.com" from the old one.
// Deliberately EVERY `Header set` directive, not just the CSP: X-Frame-Options,
// Referrer-Policy, HSTS and the rest travel the same way, and the failure mode is
// silent. Over-triggering costs one version bump; under-triggering cost a live
// payment defect.
if (changed.has('htaccess.txt')) {
    const hdrs = (src) => (src.match(/Header\s+(?:always\s+)?set\s+[^\n]*/g) || []).map((s) => s.trim()).join('\n');
    if (hdrs(at(base, 'htaccess.txt')) !== hdrs(at(head, 'htaccess.txt'))) {
        rule('response header changed → sw.js CACHE bumped (headers ride on the cached shell)', cacheBumped,
            'CACHE (sw.js) is unchanged — installed PWAs would keep applying the OLD headers');
    }
}

ok.forEach(m => console.log('  ✓ ' + m));
fails.forEach(m => console.log('  ✗ ' + m));
if (!ok.length && !fails.length) console.log('check-versions: no versioned assets touched — nothing to enforce.');
if (fails.length) {
    console.error(`\n${fails.length} version bump(s) missing. \`node bump.js <new-build-stamp>\` applies the whole checklist.`);
    process.exit(1);
}
console.log('check-versions: version chain consistent with the diff.');
