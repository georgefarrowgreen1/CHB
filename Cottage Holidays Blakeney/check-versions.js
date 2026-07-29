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
const rule = (name, cond, detail) => (cond ? ok : fails).push(`${name}${detail ? ' — ' + detail : ''}`);

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
if (['app.js', 'app.css', 'guest-app.js', 'guest-app.css', 'index.html'].some(f => changed.has(f))) {
    rule('core asset changed → sw.js CACHE bumped', grab(at(base, 'sw.js'), /const CACHE = 'chb-cache-v(\d+)';/) !== grab(at(head, 'sw.js'), /const CACHE = 'chb-cache-v(\d+)';/), 'CACHE (sw.js) is unchanged');
}
// THE CSP IS A CACHED ASSET, because it is a RESPONSE HEADER ON index.html and the
// Cache API stores headers with the body. sw.js precaches index.html and serves it
// on any navigation the network doesn't answer — so an installed PWA keeps applying
// the CSP that was current when its shell was last cached, however many deploys ago.
// Measured: PR #861 widened form-action for 3-D Secure and changed no cached asset,
// so nothing bumped; the live server sent the new policy (curl-confirmed) while the
// owner's phone went on enforcing the old one and kept reporting
// "CSP blocked form-action → methodurl.vcas.visa.com". A CSP edit therefore has to
// invalidate the shell exactly like an app.js edit does.
if (changed.has('htaccess.txt')) {
    const cspOf = (src) => grab(src, /Content-Security-Policy "([^"]*)"/);
    const b = cspOf(at(base, 'htaccess.txt'));
    const h = cspOf(at(head, 'htaccess.txt'));
    if (b !== h) {
        rule('CSP changed → sw.js CACHE bumped (the header rides on the cached shell)',
            grab(at(base, 'sw.js'), /const CACHE = 'chb-cache-v(\d+)';/) !== grab(at(head, 'sw.js'), /const CACHE = 'chb-cache-v(\d+)';/),
            'CACHE (sw.js) is unchanged — installed PWAs would keep enforcing the OLD policy');
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
