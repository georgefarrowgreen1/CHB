#!/usr/bin/env node
// ============================================================
//  a11y-test.js — accessibility gate (dev/CI only, never deployed).
//
//      node a11y-test.js
//
//  WHY THIS SHAPE. A full-page "sample every pixel behind every glyph" contrast
//  crawler is the obvious design and it is a trap: building one for the audit
//  this gate came out of produced three separate rounds of confident, wrong
//  numbers (a modelled background stack that stopped short at a translucent
//  parent; a probe stylesheet that leaked into the next measurement; and
//  getComputedStyle being LIVE, so a colour read after blanking the text came
//  back transparent). Every one of those reported failures that did not exist.
//  So this gate deliberately checks only things that are cheap AND
//  deterministic:
//
//    §1  TOKEN contrast, by arithmetic. Text colour in this codebase comes from
//        tokens, so if every text token clears AA against every surface of its
//        own theme, the text passes. No rendering, no sampling, no flake.
//    §2  A ratchet on accent-as-text, the specific bug §1 was added for.
//    §3  Accessible NAMES on interactive elements — an attribute question.
//    §4  Minimum font size.
//    §5  Minimum size for standalone controls (WCAG 2.2 2.5.8).
//
//  §3–§5 run in a real browser but only read geometry and attributes, which is
//  the part that measured reliably. They are RATCHETS against
//  a11y-budget.json in the same style as css-budget/size-budget/tsc-budget:
//  counts may only fall. Fix the element, don't raise the number.
//
//  KNOWN COVERAGE LIMIT, stated so nobody reads a green §4/§5 as "the whole app
//  is clean". These only see what actually RENDERS in this harness, and two
//  things routinely do not: content inside a collapsed container (the cottage
//  page's availability calendar keeps `.ac-price` at 0x0 until it is opened) and
//  the site footer (its wrapper computes display:none here). `openProperty()`
//  also does not reliably activate a page-view under this stub, so the public
//  cottage screen is thinner cover than the admin ones. Elements outside that
//  window have to be checked directly — via computed style, which is what
//  confirmed the .ac-price and .footer-links fixes this gate ships alongside.
//  Widening the harness is worth doing; pretending the current window is the
//  whole app is not.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { boot } = require('./ui-test-lib');

const DIR = __dirname;
const budget = JSON.parse(fs.readFileSync(path.join(DIR, 'a11y-budget.json'), 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// ---------- colour maths (WCAG 2.x relative luminance) ----------
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const hex2rgb = (h) => { h = h.replace('#', '').trim(); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

// The real page grounds, sampled from screenshots of the running app (NOT
// guessed): light mode is warm linen + near-white cards + a grey band in the
// timeline header; dark mode is the near-black ground and its raised panels.
const SURFACES = {
    light: { '#fdfcfa': 'card cream', '#f5f1e9': 'linen panel', '#ffffff': 'white', '#f0f0f0': 'timeline band' },
    dark: { '#121316': 'page ground', '#1c2e3a': 'raised panel', '#22333f': 'glass over panel' },
};

// Read a token block out of app.css. `:root` is the DARK theme (the default);
// `body.light-mode` overrides it. Tokens absent from the light block inherit.
function tokens(css, selector) {
    const i = css.indexOf(selector);
    if (i < 0) return {};
    const open = css.indexOf('{', i);
    let depth = 0, end = open;
    for (let j = open; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (!depth) { end = j; break; } }
    }
    const body = css.slice(open + 1, end);
    const out = {};
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*(?:;|$)/g)) out[m[1]] = m[2];
    return out;
}

const appCss = fs.readFileSync(path.join(DIR, 'app.css'), 'utf8');
const dark = tokens(appCss, ':root');
const light = { ...dark, ...tokens(appCss, 'body.light-mode') };

// Every token that names TEXT ink. If you add another, add it here — that is
// the point: a new text colour has to state which surfaces it must work on.
const TEXT_TOKENS = ['--text-light', '--text-muted', '--accent-text', '--ok-text', '--warn-text', '--danger-text', '--info-text'];

console.log('\n== 1. text tokens clear WCAG AA (4.5:1) on every surface of their theme ==');
for (const [theme, themeTokens] of [['light', light], ['dark', dark]]) {
    for (const tok of TEXT_TOKENS) {
        const v = themeTokens[tok];
        if (!v) { ok(false, `${theme}: ${tok} is not defined`); continue; }
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) { console.log(`  · ${theme}: ${tok} = ${v} (not a plain 6-digit hex, skipped)`); continue; }
        const ink = hex2rgb(v);
        let worst = Infinity, worstOn = '';
        for (const [bg, label] of Object.entries(SURFACES[theme])) {
            const r = ratio(ink, hex2rgb(bg));
            if (r < worst) { worst = r; worstOn = `${label} ${bg}`; }
        }
        ok(worst >= 4.5, `${theme}: ${tok} ${v} — worst ${worst.toFixed(2)}:1 on ${worstOn}`);
    }
}

console.log('\n== 2. the brand accent is not used as TEXT (it fails AA on light: 2.6–3.0:1) ==');
// --accent is for icons, stars, borders and fills (3:1 non-text bar). Words take
// --accent-text. A count ratchet rather than a selector rule, because whether a
// given rule actually RENDERS is not decidable from the stylesheet — several
// `color: var(--accent)` declarations in this codebase are overridden by later
// rules and never paint.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
let accentAsText = 0;
const accentSites = [];
for (const f of ['app.css', 'admin.css', 'guest-app.css']) {
    const css = strip(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/(^|;)\s*color\s*:\s*var\(--accent\)\s*(;|$)/.test(m[2])) continue;
        accentAsText++;
        accentSites.push(`${f}:${css.slice(0, m.index).split('\n').length} ${m[1].trim().split('\n').pop().trim().slice(0, 46)}`);
    }
}
for (const f of ['app.js', 'admin.js', 'guest-app.js', 'index.html', 'admin-views.html']) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const n = (src.match(/color:\s*var\(--accent\)(?!-)/g) || []).length;
    accentAsText += n;
    if (n) accentSites.push(`${f}: ${n} inline`);
}
if (accentAsText > budget.accentAsText) {
    console.log('     sites: ' + accentSites.join(' · '));
    console.log('     If it is an ICON/border/fill, --accent is right and the budget may rise with that stated.');
    console.log('     If it is WORDS, use var(--accent-text).');
}
ok(accentAsText <= budget.accentAsText, `\`color: var(--accent)\` sites: ${accentAsText} (budget ${budget.accentAsText})`);
if (accentAsText < budget.accentAsText) console.log(`     ↓ lower "accentAsText" to ${accentAsText} in a11y-budget.json in this PR`);

// ---------- the browser half: attributes + geometry only ----------
const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="option"], [role="tab"]';

const SCAN = (INTERACTIVE) => {
    const res = { unnamed: [], tiny: [], small: [] };
    const vis = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        const b = el.getBoundingClientRect();
        return b.width > 2 && b.height > 1;
    };
    const desc = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''));

    // (a) accessible name on every interactive element
    for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!vis(el)) continue;
        const by = el.getAttribute('aria-labelledby');
        const byTxt = by ? by.split(/\s+/).map((id) => ((document.getElementById(id) || {}).textContent || '')).join(' ').trim() : '';
        const alt = [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join('');
        let named = !!((el.textContent || '').trim() || (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('title') || '').trim() || byTxt || alt);
        if (!named && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
            const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
            named = !!(lab || el.closest('label'));
        }
        if (!named) res.unnamed.push(desc(el));
    }
    // (b) text below 10px is not readable at arm's length
    for (const el of document.querySelectorAll('body *')) {
        if (!vis(el)) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 10) res.tiny.push(`${desc(el)} ${size.toFixed(1)}px`);
    }
    // (c) WCAG 2.2 2.5.8 — 24x24 for a standalone control. Links inside prose are
    // explicitly exempt by the success criterion, so they are excluded.
    for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!vis(el)) continue;
        const cs = getComputedStyle(el);
        if (el.tagName === 'A' && cs.display.startsWith('inline') && el.closest('p, li, label, .prose')) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 24 || b.height < 24) res.small.push(`${desc(el)} ${Math.round(b.width)}×${Math.round(b.height)}`);
    }
    return res;
};

const stub = (page) => page.route(/\.php/, (r) => {
    const url = r.request().url();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) {
        let b = {};
        try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
        if (b.action === 'admin_status') return json({ ok: true, admin: true });
        if (b.action === 'guest_status') return json({ ok: true, guest: null });
        return json({ ok: true });
    }
    if (url.includes('rates.php')) return json({ properties: [
        { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, booking_fee: 75, transaction_pct: 3, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    ], seasons: {}, occupancy: {} });
    // A booking is needed, not decoration: quick-action rows only render beneath a
    // selected RECORD, so with an empty list §5 could never see them — which is
    // exactly how a 23px .cmdk-qa-row survived in the search window.
    if (url.includes('bookings.php'))
        return json({ bookings: [
            { id: 502, prop_key: '21a', name: 'Debbie McGoldrick', email: 'd@x.co', check_in: '2026-09-09', check_out: '2026-09-12', check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 200, agreed_total: 540, agreed_nightly: 520, agreed_txn_fee: 20, agreed_nights: 3 },
        ] });
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], content: {}, blocks: [], ranges: [], mine: {}, value: null, properties: [] });
});

(async () => {
    // A TALL viewport on purpose. At a real 844px phone height the footer and
    // anything else below the fold is still behind the scroll-reveal, so it
    // measures 0x0 and silently drops out of coverage — which made an earlier
    // version of §4/§5 pass while the very elements they were written for were
    // invisible to them. Height here is a measurement device, not a device size;
    // the WIDTH is what stays phone-sized.
    const t = await boot({ viewport: { width: 390, height: 2600 } });
    const page = t.page;
    await stub(page);
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1700);

    const VIEWS = [
        ['home', null],
        ['cottage', "openProperty('21a')"],
        ['enquire', "(async()=>{openEnquireModal();})()"],
        ['admin-today', "(async()=>{closeEnquireModal();isAuthenticated=true;document.body.classList.add('owner-mode');await loadAdminBundle();await initBackOffice();})()"],
        ['admin-rates', "(async()=>{await openArea('cottages');settingsOpen('seasongrid');})()"],
        ['admin-health', "(async()=>{await openArea('settings');settingsOpen('diagnostics');})()"],
        // The SEARCH WINDOW, open and answering. It is the owner's primary
        // interface now — the crown is the only route in — and it was absent from
        // this gate entirely, which is how a 23px quick-action row and 10.2px group
        // labels lived there unnoticed. Two states, because an empty landing and a
        // list of results render different components.
        ['search-empty', "(async()=>{openCmdK();await new Promise(r=>setTimeout(r,500));})()"],
        ['search-results', "(async()=>{const i=document.getElementById('cmdk-input');i.value='who owes me';cmdkSearch('who owes me');await new Promise(r=>setTimeout(r,700));})()"],
        ['search-record', "(async()=>{const i=document.getElementById('cmdk-input');i.value='debbie';cmdkSearch('debbie');await new Promise(r=>setTimeout(r,700));})()"],
        ['search-closed', "(async()=>{cmdkBack();await new Promise(r=>setTimeout(r,400));})()"],
    ];
    const totals = { unnamed: new Set(), tiny: new Set(), small: new Set() };
    for (const [key, open] of VIEWS) {
        if (open) { try { await page.evaluate((c) => eval(c), open); } catch (e) {} await page.waitForTimeout(900); }
        const r = await page.evaluate(SCAN, INTERACTIVE);
        for (const k of Object.keys(totals)) for (const v of r[k]) totals[k].add(`${key}: ${v}`);
    }

    console.log('\n== 3. every interactive element has an accessible name ==');
    const un = [...totals.unnamed];
    if (un.length > budget.unnamed) un.slice(0, 12).forEach((x) => console.log('     ' + x));
    ok(un.length <= budget.unnamed, `unnamed controls: ${un.length} (budget ${budget.unnamed})`);
    if (un.length < budget.unnamed) console.log(`     ↓ lower "unnamed" to ${un.length} in a11y-budget.json in this PR`);

    console.log('\n== 4. no text under 10px ==');
    const ti = [...totals.tiny];
    if (ti.length > budget.tinyText) ti.slice(0, 12).forEach((x) => console.log('     ' + x));
    ok(ti.length <= budget.tinyText, `sub-10px text nodes: ${ti.length} (budget ${budget.tinyText})`);
    if (ti.length < budget.tinyText) console.log(`     ↓ lower "tinyText" to ${ti.length} in a11y-budget.json in this PR`);

    console.log('\n== 5. standalone controls are at least 24×24 (WCAG 2.2 2.5.8) ==');
    const sm = [...totals.small];
    if (sm.length > budget.smallTargets) sm.slice(0, 12).forEach((x) => console.log('     ' + x));
    ok(sm.length <= budget.smallTargets, `sub-24px controls: ${sm.length} (budget ${budget.smallTargets})`);
    if (sm.length < budget.smallTargets) console.log(`     ↓ lower "smallTargets" to ${sm.length} in a11y-budget.json in this PR`);

    console.log(fails ? `\n  ${fails} A11Y CHECK(S) FAILED ❌` : '\n  A11Y CHECKS PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
