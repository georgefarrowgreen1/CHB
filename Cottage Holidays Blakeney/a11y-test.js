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
//    §1b The same tokens on their OWN status tint, which is where they paint.
//    §1c The assistant's model-state colours at the 3:1 non-text bar — the state
//        is reported by colour ALONE, so those colours are information.
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
// §1d's ratchet: how many focusable families change SHAPE when focused. Budgeted
// at 0 — a focus ring reports where you are, it does not redraw the control.
let focusRadius = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// ---------- colour maths (WCAG 2.x relative luminance) ----------
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const hex2rgb = (h) => { h = h.replace('#', '').trim(); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

// The real page grounds, sampled from screenshots of the running app (NOT
// guessed): light mode is warm linen + near-white cards + a grey band in the
// timeline header; dark mode is the near-black ground and its raised panels.
// --cmdk-surface is in here because every word the owner reads while searching
// sits on it — a new surface has to declare itself here for the same reason a new
// text token does. It was registered when the search window was full-bleed and
// OPAQUE, i.e. exactly the flat colour this arithmetic wants. The window is now a
// 520px GLASS pop-out, so the token is a stand-in rather than the literal paint:
// measured, the real composite is #fbf8f7 on light and ~#15161a on dark, both
// within 1.03 of the registered value, and on light the registered one is the
// DARKER of the two — so dark ink measured against it reads slightly worse than it
// really is, which is the safe direction for a gate to be wrong in. What no static
// value can model is the workspace showing through the blur; that is a real limit
// of measuring glass by arithmetic, and the reason the value is conservative.
// #ededed is the DESKTOP LIGHT MODAL, and it is a composite rather than a value
// anyone declared: a .modal-box is white glass over the dark scrim, so what the
// labels really sit on is the blend. It used to be 78% white and sampled
// rgb(216,216,216), where the muted labels measured 4.32:1 and the body copy
// 3.76:1 — under the bar on five sheets at once (auth, enquiry, welcome book,
// security, suggest) while the SAME labels on the 390 opaque sheet read 5.62:1.
// At 90% the sampled ground round the labels is rgb(237,237,238), which is what
// is registered here. Below 640 those sheets are opaque --sheet-surface and this
// ground does not exist; it is the desktop case the arithmetic could not see.
const SURFACES = {
    light: { '#fdfcfa': 'card cream', '#f5f1e9': 'linen panel', '#ffffff': 'white', '#f0f0f0': 'timeline band', '#f7f4ee': 'search window', '#ededed': 'desktop light modal' },
    dark: { '#121316': 'page ground', '#1c2e3a': 'raised panel', '#22333f': 'glass over panel', '#14181d': 'search window' },
};
// §1b MEASURES AGAINST A NARROWER SET, and that is this file's own doctrine
// rather than an escape hatch: §1b's header already refuses to test "every
// percentage against every token" because it would "invent failures for pairings
// that do not exist on screen". The desktop modal composite is exactly such a
// ground for a TINTED pill — .cmdk-dt-pill and .gb-seg are search-window and
// guest-book components that can never sit inside a .modal-box, and measured,
// registering it into the shared map failed those three by 0.05–0.09 against a
// surface they never touch. §1 is the whole-app question ("does this ink work on
// every ground the app paints"), so it keeps the full map; §1b is the component
// question, so it drops the composite. The guest sheets' own status strips
// (.enq-modal-msg, .auth-msg) DO sit on it and clear it either way.
const TINT_SURFACES = {
    light: Object.fromEntries(Object.entries(SURFACES.light).filter(([hex]) => hex !== '#ededed')),
    dark: SURFACES.dark,
};

// Read a token block out of app.css. `:root` is the DARK theme (the default);
// `body.light-mode` overrides it. Tokens absent from the light block inherit.
//
// NB the selector must be found as a SELECTOR — followed by `{`, and not
// inside a comment. A bare indexOf finds the first literal occurrence, so a
// comment that merely NAMES the selector (a token block explaining that it is
// deliberately not retuned for light mode) is matched instead, the wrong block
// is read, the light tokens come back empty, and EVERY light-theme check then
// silently measures the dark values and fails. Measured; it is the third time
// a scan in this codebase has read its own explanation.
function tokens(css, selector) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
    const hit = re.exec(bare);
    if (!hit) return {};
    const i = hit.index;
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

// §1b — the same tokens on their OWN STATUS TINT, which is where they nearly always
// actually paint. §1 above measures text against a bare SURFACE; but an --ok-text
// word almost never sits on bare cream — it sits inside a
// `background: color-mix(in srgb, var(--ok) 12–18%, transparent)` pill or strip
// (13 such pairs across app.css + admin.css: the act-in-place strips, status pills,
// health banners). That tint is DARKER than the surface under it, so passing §1 does
// not mean passing where the text is really read — measured, all three of ok/warn/
// danger cleared §1 while sitting at 4.23 / 4.40 / 4.30:1 in their own components.
// The tint percentage swept 12→18 because the sites differ and the darkest wins.
// The pairs are DISCOVERED from the CSS, not listed here: a rule that sets both
// `color: var(--X-text)` and `background: color-mix(… var(--X) N% …)` is, by
// construction, status text on its own tint. Deriving them means a new status pill
// is covered the day it is written, and — just as important — it keeps the gate
// HONEST: --ok and --warn also appear at 32–34% elsewhere, but those are fills with
// no matching text colour, so testing every percentage against every token would
// invent failures for pairings that do not exist on screen.
const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const tintPairs = new Map(); // "ok|18" -> {ink:'--ok-text', fill:'--ok', pct, where}
for (const f of ['app.css', 'admin.css', 'guest-app.css']) {
    const css = stripC(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const bg = m[2].match(/background(?:-color)?\s*:\s*color-mix\(in srgb,\s*var\(--(ok|warn|danger|info)\)\s*([0-9.]+)%/);
        const col = m[2].match(/(?:^|;)\s*color\s*:\s*var\(--(ok|warn|danger|info)-text\)/);
        if (!bg || !col || bg[1] !== col[1]) continue;
        const pct = parseFloat(bg[2]) / 100;
        const key = `${bg[1]}|${bg[2]}`;
        if (!tintPairs.has(key)) tintPairs.set(key, { ink: `--${col[1]}-text`, fill: `--${bg[1]}`, pct, where: `${f} ${m[1].trim().split('\n').pop().trim().slice(0, 34)}` });
    }
}
console.log('\n== 1b. status text clears AA on its OWN tint, not just on the bare surface ==');
if (!tintPairs.size) ok(false, 'no status text-on-tint pairs found — the scanner has stopped seeing them');
for (const [theme, themeTokens] of [['light', light], ['dark', dark]]) {
    for (const { ink: inkTok, fill: fillTok, pct, where } of tintPairs.values()) {
        const inkV = themeTokens[inkTok], fillV = themeTokens[fillTok];
        if (!inkV || !fillV || !/^#[0-9a-fA-F]{6}$/.test(inkV) || !/^#[0-9a-fA-F]{6}$/.test(fillV)) {
            console.log(`  · ${theme}: ${inkTok}/${fillTok} not a plain hex pair, skipped`);
            continue;
        }
        const inkC = hex2rgb(inkV), fill = hex2rgb(fillV);
        let worst = Infinity, worstOn = '';
        for (const [bg, label] of Object.entries(TINT_SURFACES[theme])) {
            const ground = hex2rgb(bg);
            const tinted = fill.map((c, i) => c * pct + ground[i] * (1 - pct));
            const r = ratio(inkC, tinted);
            if (r < worst) { worst = r; worstOn = label; }
        }
        ok(worst >= 4.5, `${theme}: ${inkTok} on ${Math.round(pct * 100)}% ${fillTok} — worst ${worst.toFixed(2)}:1 on ${worstOn} (${where})`);
    }
}

// §1c — the ASSISTANT'S STATE COLOURS, which are information and not decoration.
// The model state (ready / understood / by-meaning / best-guess / learning) is
// reported by the knot glyph's COLOUR ALONE — there is no worded pill, by design —
// so each state colour is a WCAG 1.4.11 non-text case at 3:1 against the search
// surface. Measured before this gate existed: on light, understood sat at 2.53,
// meaning at 2.56 (1.45 mid-animation), learning 1.77 and guess 1.76, i.e. four of
// the five states were reported in ink the owner could barely see, in the theme
// this back office actually ships in. The tokens live in admin.css (owner-only), so
// they are read from there — and the two states that FADE are measured at their
// animation floor too, because a colour you can only read at the top of a 2.2s
// cycle is not a colour you can read.
// Values here are not all plain hex — a knot token may alias another token
// (`var(--ok-text)`) or wrap an HSL-parts token (`hsl(var(--siri-3))`), which is
// deliberate: the hue is stated once and the knot borrows it. So this reads WHOLE
// declarations and resolves them, rather than the hex-only reader §1 uses.
function tokensAny(css, selector) {
    // Same selector-not-comment rule as tokens() above — this one reads
    // app.css as well (appLightAll), so fixing only the other leaves it open.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
    const hit = re.exec(bare);
    if (!hit) return {};
    const i = hit.index;
    const open = css.indexOf('{', i);
    let depth = 0, end = open;
    for (let j = open; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (!depth) { end = j; break; } }
    }
    const out = {};
    for (const m of stripC(css.slice(open + 1, end)).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) out[m[1]] = m[2].trim();
    return out;
}
const hslParts = (s) => {
    const m = String(s).trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (!m) return null;
    const h = +m[1], sa = +m[2] / 100, l = +m[3] / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sa * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
};
function resolveColour(v, tables, depth = 0) {
    if (v == null || depth > 6) return null;
    v = String(v).trim();
    let m = v.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
    if (m) { for (const t of tables) if (t[m[1]] != null) return resolveColour(t[m[1]], tables, depth + 1); return null; }
    m = v.match(/^hsl\(\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*\)$/);
    if (m) { for (const t of tables) if (t[m[1]] != null) return hslParts(t[m[1]]); return null; }
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return hex2rgb(v);
    m = v.match(/^hsl\(\s*(.+?)\s*\)$/);
    if (m) return hslParts(m[1].replace(/,/g, ' '));
    return null;
}
const adminCss = fs.readFileSync(path.join(DIR, 'admin.css'), 'utf8');
const aDark = tokensAny(adminCss, ':root');
const aLight = { ...aDark, ...tokensAny(adminCss, 'body.light-mode') };
const appDarkAll = tokensAny(appCss, ':root');
const appLightAll = { ...appDarkAll, ...tokensAny(appCss, 'body.light-mode') };
const KNOT = {
    '--knot-ready': { label: 'ready', floor: 1 },
    '--knot-understood': { label: 'understood (breathes)', floor: 0.72 },
    '--knot-meaning': { label: 'by meaning', floor: 1 },
    '--knot-meaning-a': { label: 'by meaning · teal end', floor: 1 },
    '--knot-meaning-b': { label: 'by meaning · violet end', floor: 1 },
    '--knot-guess': { label: 'best guess', floor: 1 },
    '--knot-learning': { label: 'learning (pulses)', floor: 0.72 },
};
console.log('\n== 1c. every model-state colour clears 3:1 on the search surface (colour is the only channel) ==');
for (const [theme, admTok, appTok] of [['light', aLight, appLightAll], ['dark', aDark, appDarkAll]]) {
    const ground = resolveColour(admTok['--cmdk-surface'], [admTok, appTok]);
    if (!ground) { ok(false, `${theme}: --cmdk-surface did not resolve — the gate has no ground to measure against`); continue; }
    for (const [tok, { label, floor }] of Object.entries(KNOT)) {
        const ink = resolveColour(admTok[tok], [admTok, appTok]);
        if (!ink) { ok(false, `${theme}: ${tok} (${label}) did not resolve to a colour — the gate cannot see it`); continue; }
        const faded = ink.map((c, i) => c * floor + ground[i] * (1 - floor));
        const r = ratio(faded, ground);
        ok(r >= 3, `${theme}: ${label} ${admTok[tok]}${floor < 1 ? ` @${floor}` : ''} — ${r.toFixed(2)}:1 on the search surface`);
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
    // (b) text below 11px is not readable at arm's length — Apple's floor (11pt),
    //     raised from 10 once the five 0.66/0.68rem classes were lifted to 0.7
    for (const el of document.querySelectorAll('body *')) {
        if (!vis(el)) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 11) res.tiny.push(`${desc(el)} ${size.toFixed(1)}px`);
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
    // (d) THE HEADING OUTLINE, which needed a reliable SCOPE before it could be checked
    // at all — this is a SPA with twenty-odd .page-view sections, most of them
    // display:none, so a document-wide h1..h6 query concatenates screens the owner
    // cannot see into one meaningless list. Measured: scanning `body` reported the admin
    // Today h1 as the HOME page's heading. The scope is the ACTIVE view, or the topmost
    // open dialog when there is one — which is also what a screen reader gets from
    // `aria-modal`. Only VISIBLE headings: a section's title sits in the DOM whether its
    // screen is open or not, and the point is what the owner is actually looking at.
    res.outline = [];
    const dlg = [...document.querySelectorAll('[aria-modal="true"], [role="dialog"]')].filter(vis).pop();
    const scope = dlg || document.querySelector('.page-view.active');
    res.scope = dlg ? 'dialog' : 'view';
    res.scopeId = scope ? scope.id || scope.className : '(none)';
    for (const h of (scope ? scope.querySelectorAll('h1,h2,h3,h4,h5,h6') : [])) {
        if (!vis(h)) continue;
        res.outline.push({ lvl: +h.tagName[1], txt: (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) });
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
    // A real deposit liability, so the "Move money out" screen renders its two
    // number fields rather than the failed-query sentence (which has no controls
    // for §3/§5 to look at).
    // The GUEST PAY SCREEN's summary. It had no scene here at all, which is how
    // three inks on it shipped under AA (a 0.75 opacity on already-muted ink, an
    // undefined --bg fallback painting white on a muted disc, and a 0.45 on the
    // narrated steps). The shape is ui-test-pay's own deposit fixture.
    if (url.includes('pay.php')) return json({
        ok: true, propName: 'Annex', propKey: '21a', guestName: 'Debbie McGoldrick',
        checkIn: '2026-08-27', checkOut: '2026-08-30', currency: 'GBP', kind: 'deposit',
        total: 700, alreadyPaid: 0, balance: 700, depositPct: 25, amountDue: 175,
        damagesDue: 50, holdAmount: 50, holdStatus: 'none', balanceDueDate: '2026-07-28',
        part: { min: 20, max: 175 }, quote: '8:deposit:225.00:0123456789abcdef0123456789abcdef',
        autopayTerms: { amount: 525, due: '2026-10-28' }, autopayState: 'off',
        instalmentOffer: { n: 3, per: 175, last: 175, due: '2026-10-28', dates: ['2026-08-28', '2026-09-28', '2026-10-28'] },
    });
    if (url.includes('square-config.php')) return json({ enabled: true, applicationId: 'app-id', locationId: 'loc-id', environment: 'sandbox' });
    if (url.includes('accounts.php')) return json({
        years: [], deposit_liability: {
            gross: 150, feeBack: 2.62, net: 147.38, count: 2, rate: 0.0175,
            items: [{ outstanding: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Sarah Pemberton', prop_key: '21a', check_out: '2026-07-20' }],
            transactions: {
              settled: 1056.19, ringFence: 73.69, movable: 982.50, count: 2,
              items: [
                { txn_id: 11, rental: 300, deposit: 75, returned: 0, fee: 6.56, gross: 375, settled: 368.44, alreadyOut: 0, ringFence: 73.69, movable: 294.75, name: 'Sarah Pemberton', prop_key: '21a', paid_on: '2026-07-17' },
                { txn_id: 12, rental: 700, deposit: 0, returned: 0, fee: 12.25, gross: 700, settled: 687.75, alreadyOut: 0, ringFence: 0, movable: 687.75, name: 'Sarah Pemberton', prop_key: '21a', paid_on: '2026-07-24' },
              ],
            },
            payouts: {
              inBank: 294.75, onWay: 687.75, unknown: 0, nextArrival: '2026-07-31',
              counts: { inBank: 1, onWay: 1, unknown: 0 },
              checked: 1785196800, error: null, known: 2,
              items: {
                inBank: [{ txn_id: 11, name: 'Sarah Pemberton', prop_key: '21a', paid_on: '2026-07-17', settled: 368.44, ringFence: 73.69, movable: 294.75, landed: true, arrival: '2026-07-19', fee_actual: true }],
                onWay: [{ txn_id: 12, name: 'Sarah Pemberton', prop_key: '21a', paid_on: '2026-07-29', settled: 687.75, ringFence: 0, movable: 687.75, landed: false, arrival: '2026-07-31', fee_actual: true }],
                unknown: [],
              },
            },
        },
    });
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
    // The pay screen's card form asks for Square's SDK; stub it so the screen
    // renders rather than sitting on its loading skeleton.
    await page.addInitScript(() => {
        window.Square = {
            payments: () => ({
                card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'tok' }) }),
                paymentRequest: () => { throw new Error('no wallets in this gate'); },
            }),
        };
    });
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1700);

    // ── §1d FOCUS MUST NOT RESHAPE THE CONTROL ────────────────────────────────
    // A global `:focus-visible` rule used to carry `border-radius: 6px` at (0,1,1),
    // beating every component rule at (0,1,0) — so focus rewrote the GEOMETRY of
    // whatever it landed on: a 999px pill squared off, a 12px field dropped to 6px,
    // the Add-booking name field (autofocused on open) rendered at 6px for its whole
    // life, and a keyboard-opened dialog CONTAINER (tabindex="-1", focused on open so
    // a screen reader announces the sheet) took a 2px accent ring around a 760px box.
    // Neither the a11y gate nor ui-test-radii could see it: one measures names and
    // sizes, the other measures radii AT REST. So this section focuses one control
    // per family and asks whether the shape MOVED.
    //
    // Two things make it non-vacuous. It asserts the ring is really THERE on the
    // three focusable families (a fix by deletion would pass a radius check and
    // fail this one), and it asserts each control actually matched :focus-visible —
    // Chromium only grants that to a programmatic focus when the last input
    // modality was the keyboard, which is why a Tab is pressed first.
    console.log('\n== 1d. keyboard focus draws a ring and does NOT change the shape ==');
    {
        const fp = await t.browser.newPage({ viewport: { width: 390, height: 900 } });
        try {
            await stub(fp);
            await fp.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
            await fp.waitForTimeout(1700);
            await fp.evaluate(() => { openProperty('21a'); });
            await fp.waitForTimeout(700);
            await fp.evaluate(() => { openEnquireModal(); });
            await fp.waitForTimeout(700);
            await fp.evaluate(() => { try { openDatePicker(); } catch (e) {} });
            await fp.waitForTimeout(700);
            await fp.evaluate(() => { try { openAllReviews('21a'); } catch (e) {} });
            await fp.waitForTimeout(600);
            // Sets the input modality to KEYBOARD, so a scripted .focus() below is
            // granted :focus-visible the way a real Tab-walk would be.
            await fp.keyboard.press('Tab');
            await fp.waitForTimeout(120);

            const FAMILIES = [
                ['a pill button', '.btn-glass'],
                ['a 12px field', '.input-glass'],
                ['a calendar cell', '.dp-day[data-act]'],
            ];
            for (const [what, sel] of FAMILIES) {
                const r = await fp.evaluate((s) => {
                    const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length);
                    if (!el) return null;
                    const rest = getComputedStyle(el).borderRadius;
                    el.focus();
                    const cs = getComputedStyle(el);
                    return { rest, focused: cs.borderRadius, outline: cs.outlineStyle, fv: el.matches(':focus-visible') };
                }, sel);
                if (!r) { ok(false, `(fixture) ${what} — no ${sel} on screen to focus`); continue; }
                ok(r.fv, `(fixture) ${what} takes :focus-visible when focused from the keyboard`);
                ok(r.outline === 'solid', `${what} draws the ring when focused (outline-style ${r.outline})`);
                ok(r.focused === r.rest, `${what} keeps its shape when focused (${r.rest} at rest, ${r.focused} focused)`);
                if (r.focused !== r.rest) focusRadius++;
            }
            // THE CONTAINER CASE. These boxes carry tabindex="-1" and are focused on
            // open ON PURPOSE — a documented decision, so a screen reader announces
            // the dialog rather than its close button — so the rule must EXCLUDE them
            // rather than the app moving focus elsewhere.
            const box = await fp.evaluate(() => {
                const el = [...document.querySelectorAll('.reviews-modal-box, .modal-box, .glass-dialog-box')]
                    .find((e) => e.getAttribute('tabindex') === '-1' && e.getClientRects().length);
                if (!el) return null;
                const rest = getComputedStyle(el).borderRadius;
                el.focus();
                const cs = getComputedStyle(el);
                return { id: el.id || el.className, rest, focused: cs.borderRadius, outline: cs.outlineStyle };
            });
            if (!box) ok(false, '(fixture) no tabindex="-1" dialog box on screen to focus');
            else {
                ok(box.outline === 'none', `a programmatically-focused dialog box is NOT outlined whole (${box.id}: outline-style ${box.outline})`);
                ok(box.focused === box.rest, `…and keeps its panel radius (${box.rest} at rest, ${box.focused} focused)`);
                if (box.focused !== box.rest) focusRadius++;
            }
        } finally {
            await fp.close();
        }
    }
    ok(focusRadius <= budget.focusRadius, `controls whose radius changed on focus: ${focusRadius} (budget ${budget.focusRadius})`);

    const VIEWS = [
        ['home', null],
        ['cottage', "openProperty('21a')"],
        ['enquire', "(async()=>{openEnquireModal();})()"],
        // TWO GUEST SCENES THIS GATE HAD NEVER WALKED, and both were carrying inks
        // under AA because of it. The PAY SCREEN is where a guest hands over a card:
        // its deposit sub-line, its step digits and its narrated steps were all muted
        // twice (a token plus an opacity), which §1's token sweep cannot see — the
        // documented "ink outside the token set" class. The SIGN-IN SHEET is where the
        // account status lines live; they set the raw --danger / --ok FILLS as ink and
        // are display:none until something happens, so nothing had ever rendered them.
        // Both are driven with a message SHOWN, or the scene measures an empty box.
        ['pay', "(async()=>{closeEnquireModal();await openPayView('a11ytok','8','deposit');await new Promise(r=>setTimeout(r,1300));try{payStepsArm();}catch(e){}await new Promise(r=>setTimeout(r,700));})()"],
        ['signin', "(async()=>{nav('view-main');openGuestAuthModal();await new Promise(r=>setTimeout(r,600));const e=document.getElementById('login-error');if(e){e.textContent='That email and password do not match.';e.style.display='block';}const m=document.getElementById('magic-link-msg');if(m){m.className='auth-msg is-ok';m.textContent='Check your inbox \\u2014 a sign-in link is on its way.';m.style.display='block';}await new Promise(r=>setTimeout(r,400));})()"],
        ['signin-off', "(async()=>{closeGuestAuthModal();nav('view-main');await new Promise(r=>setTimeout(r,500));})()"],
        ['admin-today', "(async()=>{closeEnquireModal();isAuthenticated=true;document.body.classList.add('owner-mode');await loadAdminBundle();await initBackOffice();})()"],
        ['admin-rates', "(async()=>{await openArea('cottages');settingsOpen('seasongrid');})()"],
        ['admin-health', "(async()=>{await openArea('settings');settingsOpen('diagnostics');})()"],
        // The money-out screen: two number inputs whose only accessible name comes
        // from the <span> inside their wrapping <label>, on the one screen in the
        // app where a mistyped figure moves real money.
        ['admin-money-out', "(async()=>{await openAccounts();accountsOpen('sweep');await new Promise(r=>setTimeout(r,600));sweepSet('balance','2000');await new Promise(r=>setTimeout(r,300));})()"],
        // The SEARCH WINDOW, open and answering. It is the owner's primary
        // interface now — the crown is the only route in — and it was absent from
        // this gate entirely, which is how a 23px quick-action row and 10.2px group
        // labels lived there unnoticed. Two states, because an empty landing and a
        // list of results render different components.
        ['search-empty', "(async()=>{openCmdK();await new Promise(r=>setTimeout(r,500));})()"],
        ['search-results', "(async()=>{const i=document.getElementById('cmdk-input');i.value='who owes me';cmdkSearch('who owes me');await new Promise(r=>setTimeout(r,700));})()"],
        ['search-record', "(async()=>{const i=document.getElementById('cmdk-input');i.value='debbie';cmdkSearch('debbie');await new Promise(r=>setTimeout(r,700));})()"],
        ['search-closed', "(async()=>{cmdkBack();await new Promise(r=>setTimeout(r,400));})()"],
        // The GUIDED WALKTHROUGH overlay, which this gate had never seen — the same
        // blind spot that let a 23px quick-action row live in the search window.
        // Its Next/Back measured 70×30, over the 24px bar but under the house's own
        // 44px floor, on a control tapped once per step. Driven to a MIDDLE step so
        // Back is rendered too (step 1 renders a spacer <span> in its place).
        ['walkthrough', "(async()=>{coachWalk('add-booking');await new Promise(r=>setTimeout(r,900));coachSequence(CHB_WALK['add-booking'].steps,2);await new Promise(r=>setTimeout(r,400));})()"],
        ['walkthrough-off', "(async()=>{coachSeqStop();closeModal();await new Promise(r=>setTimeout(r,300));})()"],
        // Added for §6: the screens carrying the most headings, which is where a skipped
        // level would actually hide. They cost §3–§5 nothing and widen their cover too.
        ['admin-manage-index', "(async()=>{await openArea();await new Promise(r=>setTimeout(r,600));})()"],
        ['admin-payments-index', "(async()=>{await openAccounts();await new Promise(r=>setTimeout(r,700));})()"],
        ['admin-inbox', "(async()=>{await openInbox();await new Promise(r=>setTimeout(r,500));})()"],
        ['admin-inbox-email', "(async()=>{inboxFolder('email');await new Promise(r=>setTimeout(r,700));})()"],
        ['admin-pricing', "(async()=>{await openArea();settingsOpen('pricing');await new Promise(r=>setTimeout(r,600));})()"],
        ['admin-learning', "(async()=>{await openArea();settingsOpen('search-learning');await new Promise(r=>setTimeout(r,600));})()"],
        // THE TWO HUBS AND THE LOG — the screens the owner spends most of the day on,
        // and the three richest in headings, controls and dates. They were absent, so
        // the booking hub's ~40 controls, the enquiry hub's action row and the log's
        // filter chips had never been measured for a name, a size or an outline. The
        // hubs are opened by id off the seeded fixture; if it ever stops seeding one
        // the scene simply contributes nothing rather than failing for the wrong
        // reason, which is why §1b/§6's vacuity guards are the real backstop.
        ['admin-booking-hub', "(async()=>{const b=(dbBookings[Object.keys(dbBookings)[0]]||[])[0];if(b)await openBookingHub(b.id);await new Promise(r=>setTimeout(r,800));})()"],
        // SEEDED, not hoped for: with no enquiry in the fixture this scene silently
        // stayed on the booking hub and measured it a SECOND time, double-counting
        // every finding there. A scene that cannot open its own screen is worse than
        // no scene, because the numbers look like coverage.
        ['admin-enquiry-hub', "(async()=>{enquiries.length=0;enquiries.push({id:901,propKey:'21a',name:'Nina Salt',email:'nina@x.co',phone:'',checkIn:'2027-04-10',checkOut:'2027-04-14',adults:2,children:0,message:'Any chance of a late checkout?',received:'2027-01-04',receivedAt:'2027-01-04 09:00:00',status:'new'});await openEnquiryHub(901);await new Promise(r=>setTimeout(r,900));})()"],
        ['admin-activity-log', "(async()=>{nav('view-activity-log');await new Promise(r=>setTimeout(r,800));})()"],
    ];
    const totals = { unnamed: new Set(), tiny: new Set(), small: new Set() };
    const outlines = [];
    for (const [key, open] of VIEWS) {
        if (open) { try { await page.evaluate((c) => eval(c), open); } catch (e) {} await page.waitForTimeout(900); }
        const r = await page.evaluate(SCAN, INTERACTIVE);
        for (const k of Object.keys(totals)) for (const v of r[k]) totals[k].add(`${key}: ${v}`);
        outlines.push({ key, scope: r.scope, scopeId: r.scopeId, outline: r.outline });
    }

    console.log('\n== 3. every interactive element has an accessible name ==');
    const un = [...totals.unnamed];
    if (un.length > budget.unnamed) un.slice(0, 12).forEach((x) => console.log('     ' + x));
    ok(un.length <= budget.unnamed, `unnamed controls: ${un.length} (budget ${budget.unnamed})`);
    if (un.length < budget.unnamed) console.log(`     ↓ lower "unnamed" to ${un.length} in a11y-budget.json in this PR`);

    console.log('\n== 4. no text under 10px ==');
    const ti = [...totals.tiny];
    if (ti.length > budget.tinyText) ti.slice(0, 40).forEach((x) => console.log('     ' + x));
    ok(ti.length <= budget.tinyText, `sub-11px text nodes: ${ti.length} (budget ${budget.tinyText})`);
    if (ti.length < budget.tinyText) console.log(`     ↓ lower "tinyText" to ${ti.length} in a11y-budget.json in this PR`);

    console.log('\n== 5. standalone controls are at least 24×24 (WCAG 2.2 2.5.8) ==');
    const sm = [...totals.small];
    if (sm.length > budget.smallTargets) sm.slice(0, 12).forEach((x) => console.log('     ' + x));
    ok(sm.length <= budget.smallTargets, `sub-24px controls: ${sm.length} (budget ${budget.smallTargets})`);
    if (sm.length < budget.smallTargets) console.log(`     ↓ lower "smallTargets" to ${sm.length} in a11y-budget.json in this PR`);

    // ==========================================================================
    //  6. HEADING OUTLINE. Two questions, and the levels chosen for each are the point.
    //
    //  SKIPS are the rule WCAG actually implies: a heading must not descend by more than
    //  one level, because h2 → h4 tells a screen-reader user there is a section they have
    //  missed. Budgeted at 0 and break-tested by injecting an h4 under an h2.
    //
    //  STARTING BELOW h2 is the second, and the threshold is deliberate. An h1 is NOT
    //  required by WCAG, and several admin screens legitimately top out at h2: drilling
    //  into a Manage or Payments section hides the big "Manage"/"Payments" title on
    //  purpose — settingsOpen()'s own comment says "the section shows ONE back link + its
    //  own title instead of two stacked headers" — so the h1 is in the DOM, hidden with
    //  the index it titles, and the section's h2 is that screen's title. Demanding an h1
    //  there would be asking the app to reverse a UI decision to satisfy a rule nobody
    //  wrote. What IS worth failing on is a screen whose top heading is h3 or lower,
    //  which means levels 1 AND 2 are both absent — measured, no page view does that.
    // ==========================================================================
    console.log('\n== 6. the heading outline of each screen ==');
    const skips = [];
    const noTop = [];
    for (const o of outlines) {
        if (!o.outline.length) continue;
        console.log(`     ${o.key} [${o.scopeId}]: ${o.outline.map((h) => 'h' + h.lvl).join(' \u2192 ')}`);
        for (let i = 1; i < o.outline.length; i++) {
            if (o.outline[i].lvl - o.outline[i - 1].lvl > 1)
                skips.push(`${o.key}: h${o.outline[i - 1].lvl} \u2192 h${o.outline[i].lvl} at "${o.outline[i].txt}"`);
        }
        // Dialogs are EXCLUDED from the top-level question on purpose: a dialog is named
        // by aria-labelledby/aria-label, not by owning the document's h1, so demanding
        // one inside it would be inventing a rule rather than checking one.
        if (o.scope === 'view' && o.outline[0].lvl > 2) noTop.push(`${o.key}: starts at h${o.outline[0].lvl}`);
    }
    skips.forEach((x) => console.log('     \u2717 ' + x));
    ok(skips.length <= budget.headingSkips, `skipped heading levels: ${skips.length} (budget ${budget.headingSkips})`);
    if (skips.length < budget.headingSkips) console.log(`     \u2193 lower "headingSkips" to ${skips.length} in a11y-budget.json in this PR`);
    noTop.forEach((x) => console.log('     \u2022 ' + x));
    ok(noTop.length <= budget.headingNoTop, `views whose outline starts below h2: ${noTop.length} (budget ${budget.headingNoTop})`);
    if (noTop.length < budget.headingNoTop) console.log(`     \u2193 lower "headingNoTop" to ${noTop.length} in a11y-budget.json in this PR`);
    // A VACUITY GUARD, the same one §1b carries. §6 is worth nothing unless it is looking
    // at real outlines: if the scope query ever stops resolving — a renamed .page-view
    // class, a dialog that loses aria-modal — every list above goes empty and both checks
    // pass by seeing absolutely nothing.
    const seen = outlines.filter((o) => o.outline.length).length;
    ok(seen >= 10, `outlines collected: ${seen} of ${outlines.length} scenes (a scope that stopped resolving would pass \u00A76 in silence)`);

    // ── §7 THE TABLET BAND, MEASURED IN PIXELS ────────────────────────────────
    // Every scene above runs at 390px wide, so 769–899px is invisible to this
    // gate — and that is exactly where the cottage page's sticky booking bar
    // shows (the guest shell hides it below, the sidebar rule above). Its ground
    // was a raw dark rgba that never retunes while its inks are tokens that do,
    // so in the DEFAULT light theme the price measured 1.02:1 and the ENQUIRE NOW
    // label 1.15:1 — an invisible button that is the only way to enquire there,
    // because .prop-reserve is display:none below 900px.
    // Sampled from the PAINTED pixels, not getComputedStyle: these sit on
    // translucent glass, where computed colour reports only the top layer (the
    // trap this codebase has produced five separate false readings from).
    console.log('\n§7 The 769–899px band — a raw dark fill must not survive the light theme');
    const lumOf = ([r, g, b]) => {
        const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a, b) => { const L1 = lumOf(a), L2 = lumOf(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
    for (const theme of ['light', 'dark']) {
        const p2 = await t.browser.newPage({ viewport: { width: 820, height: 900 } });
        try {
            // Deliberately NOT stub()ed: this is the PUBLIC cottage page, and the
            // admin stub suppresses the boot that renders the bar at all.
            await p2.addInitScript((th) => { try { localStorage.setItem('chb-theme', th); } catch (e) {} }, theme);
            await p2.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
            await p2.waitForTimeout(1700);
            await p2.evaluate(() => { try { openProperty(Object.keys(propertyMeta)[0]); } catch (e) {} });
            await p2.waitForTimeout(900);
            const barUp = await p2.evaluate(() => { const e = document.querySelector('.prop-book-bar'); return !!(e && e.getClientRects().length); });
            ok(barUp, `(fixture) the cottage booking bar is on screen at 820px (${theme})`);
            if (!barUp) continue;
            for (const sel of ['.pbb-price', '.pbb-btn']) {
                const el = p2.locator(sel).first();
                if (!(await el.count()) || !(await el.isVisible())) continue;
                const shot = await el.screenshot();
                const s = await p2.evaluate(async (d) => {
                    const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
                    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
                    const D = x.getImageData(0, 0, img.width, img.height).data;
                    const L = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    const m = {}; let dark = [255, 255, 255], light = [0, 0, 0];
                    for (let i = 0; i < D.length; i += 4) {
                        const px = [D[i], D[i + 1], D[i + 2]]; m[px.join(',')] = (m[px.join(',')] || 0) + 1;
                        if (L(px) < L(dark)) dark = px;
                        if (L(px) > L(light)) light = px;
                    }
                    return { ground: Object.entries(m).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number), dark, light };
                }, shot.toString('base64'));
                const ink = theme === 'light' ? s.dark : s.light;
                const r = contrast(s.ground, ink);
                ok(r >= 4.5, `${theme}: ${sel} ink is legible on the bar (${r.toFixed(2)}:1 — ground rgb(${s.ground}))`);
            }
        } finally {
            await p2.close();
        }
    }

    // ── §8 THE DEFAULT THEME'S RAW LITERALS ───────────────────────────────────
    // Five more of the same class as §7: a literal colour that never retunes,
    // sitting under inks that do. §1/§1b can't see any of them — three are inline
    // styles or fills the pair-scanner doesn't discover, one is a background-IMAGE
    // rather than a colour, and one is a border on a class no stylesheet mentioned.
    // Measured by arithmetic on the resolved values (deterministic, no rendering)
    // except the chevron, which is a computed background-image and so exact.
    console.log('\n§8 Raw literals in the DEFAULT theme — inks, fills and a lost chevron');
    {
        const p3 = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
            await p3.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
            await p3.waitForFunction(() => typeof window.__BUILD === 'string', null, { timeout: 20000 });
            // admin.css is owner-only and lazily fetched, so a public page carries none
            // of it — .bk-row's rules included. Load it rather than stub an owner
            // session: this section wants the STYLESHEET, not the back office.
            await p3.evaluate(async () => {
                const l = document.createElement('link');
                l.rel = 'stylesheet'; l.href = 'admin.css';
                const done = new Promise((r) => { l.onload = r; l.onerror = r; });
                document.head.appendChild(l); await done;
            });
            for (const theme of ['light', 'dark']) {
                const r = await p3.evaluate((th) => {
                    document.body.classList.toggle('light-mode', th === 'light');
                    // Read the tokens off BODY, not :root — the light retunes live on
                    // `body.light-mode`, so documentElement hands back the DARK values in
                    // light mode and every ratio below is measured against the wrong ink
                    // (the first run of this section reported 1.56:1 for a badge that
                    // really renders at 4.65).
                    const cs = getComputedStyle(document.body);
                    const tok = (n) => cs.getPropertyValue(n).trim();
                    // A select's chevron is a background-IMAGE, so a computed read is
                    // exact — no compositing to model.
                    const sel = document.createElement('select');
                    sel.className = 'input-glass';
                    document.body.appendChild(sel);
                    const chev = getComputedStyle(sel).backgroundImage;
                    sel.remove();
                    // The state a paid guest arriving TODAY gets. It used to be a 3px rail
                    // on the row (a generated class styled by nothing until it was given
                    // --info); round eight retired every bookings-row rail — the chip says
                    // the state once — so the chip is what must carry the sea-blue: its
                    // dot IS --info and its ink clears AA on its own 14% tint.
                    const chip = document.createElement('span');
                    chip.className = 'bk-chip arrive';
                    chip.innerHTML = '<span class="bk-dot"></span>Arriving';
                    document.body.appendChild(chip);
                    const arrive = { dot: getComputedStyle(chip.querySelector('.bk-dot')).backgroundColor, ink: getComputedStyle(chip).color, tint: getComputedStyle(chip).backgroundColor };
                    chip.remove();
                    return {
                        chev, arrive,
                        okText: tok('--ok-text'), accentInk: tok('--accent-ink'),
                        accent: tok('--accent'), ok: tok('--ok'),
                        warn: tok('--warn'), danger: tok('--danger'), info: tok('--info'), infoText: tok('--info-text'),
                    };
                }, theme);
                const rgb = (v) => {
                    const h = String(v).replace('#', '');
                    if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
                    const m = String(v).match(/[\d.]+/g).map(Number);
                    return [m[0], m[1], m[2]];
                };
                // 25% #4CAF50 over the guest card's ground, which is what the badge sits on.
                const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
                const card = theme === 'light' ? [253, 252, 250] : [21, 21, 24];
                const badgeFill = over([76, 175, 80], 0.25, card);
                const cr = (a, b) => contrast(rgb(a), Array.isArray(b) ? b : rgb(b));

                ok(r.chev !== 'none', `${theme}: a glass <select> still says it is a menu (background-image ${r.chev === 'none' ? 'NONE' : 'present'})`);
                const badge = cr(r.okText, badgeFill);
                ok(badge >= 4.5, `${theme}: the Upcoming badge's ink is legible on its own 25% tint (${badge.toFixed(2)}:1)`);
                const chip = cr(r.accentInk, r.accent);
                ok(chip >= 4.5, `${theme}: the selected Activity-log chip is legible on the accent fill (${chip.toFixed(2)}:1)`);
                // The status hero's disc: one ink, three FILLS — and the fills must be
                // theme-invariant tokens, or no single ink can clear all three (the warn
                // one was --warn-TEXT, which is retuned, and measured 1.73:1).
                for (const [name, fill] of [['ok', r.ok], ['warn', r.warn], ['danger', r.danger]]) {
                    const v = cr(r.accentInk, fill);
                    ok(v >= 4.5, `${theme}: the Status hero's ${name} glyph resolves on its disc (${v.toFixed(2)}:1)`);
                }
                // The chip's tint is --info at 14% over the card; composite it the way
                // the Upcoming badge is (from the TOKEN — the computed color-mix comes
                // back as `color(srgb …)` in 0–1 floats, the documented false-contrast
                // trap, which read this pair as 4.37 where §1b measures 4.64), then ask
                // the ink.
                const arriveFill = over(rgb(r.info), 0.14, card);
                const arriveInk = cr(r.arrive.ink, arriveFill);
                const dotIsInfo = cr(r.arrive.dot, r.info) < 1.05 || cr(r.arrive.dot, r.infoText) < 1.05;
                ok(dotIsInfo, `${theme}: a guest arriving today gets the sea-blue state chip — its dot is --info (${r.arrive.dot})`);
                ok(arriveInk >= 4.5, `${theme}: …and the chip's ink is legible on its own tint (${arriveInk.toFixed(2)}:1)`);
            }
        } finally {
            await p3.close();
        }
    }

    console.log(fails ? `\n  ${fails} A11Y CHECK(S) FAILED ❌` : '\n  A11Y CHECKS PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
