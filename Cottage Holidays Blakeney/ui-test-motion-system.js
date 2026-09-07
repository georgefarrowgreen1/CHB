// ============================================================
//  ui-test-motion-system.js — the twelve behaviours, driven for real.
//
//  The spec (twelve shared behaviours, ~100 assignments) is the record; this
//  gate holds the STYLESHEET to its four curves and the SITE to the behaviours,
//  through the real functions and the real markup. Each section is break-tested:
//  reverting the behaviour it names fails checks by name, never the suite.
//
//    §1 the stylesheet — nothing overshoots >0.5% (the chat bubble is the one
//       documented exception), the killswitch reaches pseudo-elements, no press
//       rides the overshooting spring, payPop and the bows are settled;
//    §2 PRESS — a constant 4px of depth on a 40px control and a 300px one;
//       the five inert controls press;
//    §3 ROLL — the party count travels, direction follows the change;
//    §4 SETTLE — the card price lands once, and a refresh replays nothing;
//    §5 UNFOLD — the payline fold has a height in flight and honest [hidden];
//    §6 TRAVEL — the experiences pill moves and lands, the chips survive;
//       the progress connector lights;
//    §7 WORK — a busy button spins and does not dim; My Stays waits with a
//       shape and a sentence that waits its turn;
//    §8 NUDGE — the refused field is marked, focused, and clears as you type;
//    §9 DRAW — Copy code keeps its width and draws a tick;
//   §10 CROSS — the cottage calendar turns the page; two fast taps land on the
//       newest month; the lightbox carries a decoded back layer;
//   §11 reduced motion — the fold is open at once, the spinner stands down.
//   §12 PRESS UNDER A REAL POINTER — a held mouse.down on the owner's most-tapped
//       controls, sampled FOR THE WHOLE HOLD. This is the section that catches a
//       hover rule outranking :active, which no source scan can see: `.card:hover`
//       and `.card:active` are both (0,2,0) and the hover sat 1450 lines later, so
//       the card computed matrix(1.0121, …, -7) — the LIFT — with :active true.
//   §13 ONE ARRIVAL PER NAVIGATION — Today → hub → Today plays exactly one
//       arrival animation per swap, at ≤400ms, and the offline day sheet plays
//       none at all (the stated reason a nav transition was refused as a feature).
//   §14 REDUCED MOTION REACHES THE JS SCROLLS — the CSS killswitch sets
//       `scroll-behavior: auto` and cannot touch a `behavior: 'smooth'` passed as
//       an argument; chbScroll reads the preference in one place instead.
//
//  Disciplines (see CLAUDE.md): sample by STATE, never a clock, where a state
//  exists; getAnimations({subtree:true}) — element.getAnimations() cannot see a
//  ::before; drive the ROUTE, not a fixture.
// ============================================================
const fs = require('fs');
const path = require('path');
const { boot } = require('./ui-test-lib');

const APP_CSS = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
const ADMIN_CSS = fs.readFileSync(path.join(__dirname, 'admin.css'), 'utf8');
const GUEST_CSS = fs.readFileSync(path.join(__dirname, 'guest-app.css'), 'utf8');
const SHEETS = [['app.css', APP_CSS], ['admin.css', ADMIN_CSS], ['guest-app.css', GUEST_CSS]];
const noComments = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '');
// Every rule as {sel, body} — a block regex, so a selector LIST is one entry and
// can be split honestly rather than counted as one.
const rules = (css) => [...noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
const PROPS = [
    { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, extra_adult_rate: 42, child_rate: 25, booking_fee: 75, transaction_pct: 3, max_adults: 4, max_children: 2, max_total: 6, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 120, extra_adult_rate: 40, child_rate: 25, booking_fee: 75, transaction_pct: 3, max_adults: 4, max_children: 2, max_total: 6, sort_order: 2 },
];
const BOOKINGS = [
    { id: 3, prop_key: 'jollyboat', name: 'Guest Tester', email: 'guest@example.com', check_in: d(-1), check_out: d(3), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 640, agreed_total: 640, completed_stays: 2, door_code: '7302', door_code_from: d(-3) },
    { id: 5, prop_key: '21a', name: 'Guest Tester', email: 'guest@example.com', check_in: d(21), check_out: d(25), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 150, agreed_total: 620 },
];
// The payload's occupancy map is copied verbatim into occupancyLimits; without it
// the app falls back to its offline caps (2 adults for 21A) and the stepper
// correctly refuses a third adult — which read as the roll being broken.
const OCC = { '21a': { maxAdults: 4, maxChildren: 2, maxTotal: 6 }, jollyboat: { maxAdults: 4, maxChildren: 2, maxTotal: 6 } };
const REVIEWS = [1, 2, 3, 4].map((i) => ({ id: i, prop: '21a', name: 'G' + i, stars: 5, text: 'Lovely.', status: 'approved', created_at: d(-9 * i) }));
// Categories must be the app's own (EXPERIENCE_CATEGORIES) or no filter chips
// render at all — the first fixture used made-up names and proved nothing.
const EXPS = [
    { id: 1, title: 'Seal trips', category: 'Boat trips & wildlife', body: 'Daily.', status: 'approved' },
    { id: 2, title: 'Blakeney Point', category: 'Beaches & coast', body: 'Close.', status: 'approved' },
    { id: 3, title: 'Coast path', category: 'Walks & nature', body: 'Past the door.', status: 'approved' },
];

(async () => {
    let fails = 0;
    const check = (c, m, extra) => {
        console.log(`  ${c ? '✓' : '✗'} ${m}${c || extra === undefined ? '' : '  → ' + extra}`);
        if (!c) fails++;
    };
    const anims = (page, sel) => page.evaluate((s) => {
        const r = document.querySelector(s);
        if (!r) return ['(missing)'];
        return r.getAnimations({ subtree: true }).map((a) => a.animationName || 't:' + (a.transitionProperty || '?'));
    }, sel);

    // ============================================================
    console.log('\n  §1 the stylesheet');
    const linears = [...APP_CSS.matchAll(/(--[\w-]+):\s*linear\(([^)]+)\)/g)].map((m) => ({ name: m[1], peak: Math.max(...m[2].split(',').map(Number)) }));
    const over = linears.filter((l) => l.peak > 1.005 && l.name !== '--ios-bubble');
    check(linears.length >= 3 && over.length === 0, 'no curve swings past 0.5% (the chat bubble is the one exception)', linears.map((l) => `${l.name}:${l.peak}`).join(' '));
    // ALL THREE SHEETS. This used to read app.css alone, which is why nothing
    // noticed that admin.css carried 42 --fluid-bezier and 12 --spring against
    // five uses of the four curves — the owner's side was outside the gate.
    const pressSpring = SHEETS.flatMap(([f, css]) =>
        rules(css).filter((r) => /:active/.test(r.sel) && /var\(--spring\)/.test(r.body)).map((r) => f + ' ' + r.sel.slice(0, 40)));
    check(pressSpring.length === 0, 'no press rides the overshooting spring, in any sheet', pressSpring.join(' | '));
    // Counted as SELECTORS, not blocks: the press is declared as grouped lists, so
    // a block count says 25 where 60 controls carry it. 55 before this PR (all of
    // them guest-side, app.css only); the owner's fifteen most-tapped controls —
    // the fold row, the filters, the spine chips, the rail's own controls, the
    // timeline bar, the Manage tiles — are what took it to 75.
    const pressSc = SHEETS.reduce((n, [, css]) =>
        n + rules(css).filter((r) => /scale\(var\(--sc/.test(r.body))
            .reduce((m, r) => m + r.sel.split(',').filter((s) => /:active/.test(s)).length, 0), 0);
    check(pressSc >= 70, 'every press reads its depth from --sc (all three sheets)', pressSc + ' selectors');
    // THE THINGS THAT TRAVEL LAND, they do not rebound. Named rather than counted,
    // because --spring legitimately survives on the ONE thing built for it (the
    // chat bubble, via --ios-bubble) plus the pop-out's own documented drop and
    // the pay choreography's appearing figures — an "allow only the bubble" sweep
    // would fail on correct code. What must never ride it again is anything that
    // moves BETWEEN two resting places: measured, the rail indicator passed its
    // row by 4.5px and the switch thumb by 1.57px.
    const travellers = [
        ['admin.css', ADMIN_CSS, '.rail-ind', /\.rail-ind\s*\{[^}]*translate\s+([^,;]+)/],
        ['admin.css', ADMIN_CSS, '.chb-switch-track::after', /\.chb-switch-track::after\s*\{[^}]*transition:\s*transform\s+([^;}]+)/],
        ['app.css', APP_CSS, '.admin-dock-indicator', /\.admin-dock-indicator\s*\{[^}]*translate\s+([^,;]+)/],
        ['app.css', APP_CSS, '.settings-row-chev', /\.settings-row \.settings-row-chev\s*\{[^}]*transform\s+([^,;]+)/],
        ['guest-app.css', GUEST_CSS, '.guest-dock-indicator', /\.guest-dock-indicator\s*\{[^}]*translate\s+([^,;]+)/],
    ];
    const sprung = travellers.filter(([, css, , re]) => { const m = noComments(css).match(re); return !m || /--spring/.test(m[1]); })
        .map(([f, , name]) => f + ' ' + name);
    check(sprung.length === 0, 'nothing that travels between two rows still rides --spring', sprung.join(' | '));
    check(/prefers-reduced-motion: reduce\) \{[\s\S]{0,200}\*::before,\n\s*\*::after \{/.test(APP_CSS), 'the killswitch names ::before and ::after');
    const payPop = (APP_CSS.match(/@keyframes payPop \{[\s\S]*?\n\s*\}/) || [''])[0];
    check(/scale\(0\.94\)/.test(payPop) && !/1\.2/.test(payPop), 'payPop appears from 0.94 with no 1.2 hump', payPop.replace(/\s+/g, ' ').slice(0, 80));
    const bows = [...APP_CSS.matchAll(/@keyframes revBow(?:Tap)? \{[\s\S]*?scale\(([\d.]+)\)/g)].map((m) => +m[1]);
    check(bows.length === 2 && Math.max(...bows) <= 1.12, 'the star bows are settled (≤1.12)', bows.join(','));
    const durs = [...APP_CSS.matchAll(/chb\w+ (\d+)ms/g)].map((m) => +m[1]);
    const okSet = new Set([80, 160, 200, 240, 280, 300, 320, 400, 480]);
    check(durs.length > 8 && durs.every((x) => okSet.has(x)), 'every system duration is on the sanctioned set', [...new Set(durs)].join(','));

    // ============================================================
    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    let holdMine = null;
    await page.route(/\.php/, async (r) => {
        const u = r.request().url();
        const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (u.includes('rates.php')) return j({ properties: PROPS, seasons: {}, occupancy: OCC, payment: { deposit_pct: 25, balance_days: 30 } });
        if (u.includes('my-bookings.php')) { if (holdMine) await holdMine; return j({ ok: true, bookings: BOOKINGS, guest: { name: 'Guest Tester', email: 'guest@example.com' } }); }
        if (u.includes('reviews.php')) return j({ ok: true, reviews: REVIEWS });
        if (u.includes('availability')) return j({ ok: true, ranges: [{ start: d(10), end: d(14) }] });
        if (u.includes('experiences.php')) return j({ ok: true, experiences: EXPS });
        return j({ ok: true, bookings: [], enquiries: [], threads: [], messages: [], content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: PROPS });
    });
    await page.goto(t.base + '/index.html');
    await page.waitForTimeout(1200);

    // ============================================================
    console.log('\n  §2 PRESS — a constant depth');
    await page.evaluate(() => { window.openProperty('21a'); });
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.openEnquireModal(); });
    await page.waitForTimeout(600);
    const depth = await page.evaluate(() => {
        const out = {};
        // PAINTED controls only: the handler writes nothing for a 0px element,
        // which is right, and probing a hidden twin proves nothing.
        const probe = (sel) => {
            const el = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 0);
            if (!el) return null;
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const sc = parseFloat(el.style.getPropertyValue('--sc'));
            return { w: Math.round(el.getBoundingClientRect().width), sc, px: +(el.getBoundingClientRect().width * (1 - sc)).toFixed(1) };
        };
        out.step = probe('#enquire-modal .hs-step');
        out.wide = probe('#enquire-modal .btn-glass');
        return out;
    });
    check(depth.step && Math.abs(depth.step.px - 4) <= 0.6, 'a 40px control presses ~4px', JSON.stringify(depth.step));
    check(depth.wide && Math.abs(depth.wide.px - 4) <= 0.6, 'a wide control presses ~4px too', JSON.stringify(depth.wide));
    check(depth.step && depth.wide && depth.step.sc < depth.wide.sc, 'so the scale differs while the depth does not', `${depth.step.sc} vs ${depth.wide.sc}`);
    const inert = await page.evaluate(() => {
        const rules = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } })
            .filter((r) => r.selectorText && /:active/.test(r.selectorText) && /var\(--sc/.test(r.style.transform || ''))
            .map((r) => r.selectorText);
        return ['.gb2-again', '.gb2-payline', '.hub-code-copy', '.back-link', 'header nav a'].map((s) => [s, rules.some((r) => r.split(',').map((x) => x.trim()).includes(s + ':active'))]);
    });
    check(inert.every(([, v]) => v), 'the five inert controls press now', inert.filter(([, v]) => !v).map(([s]) => s).join(',') || 'all five');

    // ============================================================
    console.log('\n  §3 ROLL — the party count');
    const r0 = await page.evaluate(() => document.getElementById('enq-adults-count').textContent.trim());
    const in0 = await page.evaluate(() => ({ v: document.getElementById('enq-adults').value, lim: JSON.stringify(window.occupancyLimits && window.occupancyLimits[window.activeFrontProperty]) }));
    await page.evaluate(() => window.enqAdjust('adults', 1));
    await page.waitForTimeout(40);
    const rMid = await page.evaluate(() => {
        const h = document.getElementById('enq-adults-count');
        return { n: h.querySelectorAll('span').length, anims: [...h.querySelectorAll('span')].flatMap((s) => s.getAnimations().map((a) => a.animationName)), dn: h.classList.contains('dn'), html: h.innerHTML.slice(0, 80) };
    });
    // The FIRST tap must roll: the markup ships a bare text node, and the first
    // version of chbRoll adopted it silently and only rolled from the second tap.
    check(rMid.n === 2 && rMid.anims.includes('chbRollOut') && rMid.anims.includes('chbRollIn'), 'up: two digits mid-flight, old out and new in — on the FIRST tap', rMid.anims.join(',') + ' ' + rMid.html + ' | input before ' + JSON.stringify(in0) + ' after ' + await page.evaluate(() => document.getElementById('enq-adults').value));
    check(!rMid.dn, 'up is not marked down');
    await page.waitForFunction(() => document.getElementById('enq-adults-count').querySelectorAll('span').length === 1, null, { timeout: 2000 });
    const r1 = await page.evaluate(() => document.getElementById('enq-adults-count').textContent.trim());
    check(+r1 === +r0 + 1, 'and settles to one digit, one higher', r0 + ' -> ' + r1);
    await page.evaluate(() => window.enqAdjust('adults', -1));
    await page.waitForTimeout(40);
    const rDn = await page.evaluate(() => ({ dn: document.getElementById('enq-adults-count').classList.contains('dn'), anims: [...document.querySelectorAll('#enq-adults-count span')].flatMap((s) => s.getAnimations().map((a) => a.animationName)) }));
    check(rDn.dn && rDn.anims.includes('chbRollOutDn'), 'down travels the other way', rDn.anims.join(','));
    await page.waitForFunction(() => document.getElementById('enq-adults-count').querySelectorAll('span').length === 1, null, { timeout: 2000 });
    const rSame = await page.evaluate(() => { const h = document.getElementById('enq-adults-count'); const before = h.innerHTML; window.chbRoll(h, h.textContent.trim()); return h.innerHTML === before; });
    check(rSame, 'an unchanged value rolls nothing');

    // ============================================================
    console.log('\n  §4 SETTLE — the price lands once');
    await page.evaluate(() => { try { window.closeEnquireModal(); } catch (e) {} window.nav('view-cottages'); });
    await page.waitForTimeout(700);
    const landed = await page.evaluate(() => {
        const el = document.querySelector('#cottages .card-price, .card-price');
        return el ? { has: el.classList.contains('is-landed'), txt: el.textContent.trim().slice(0, 12) } : null;
    });
    check(landed && landed.has && /£/.test(landed.txt), 'the card price carries its landing', JSON.stringify(landed));
    const replay = await page.evaluate(() => {
        const el = document.querySelector('.card-price.is-landed');
        el.classList.remove('is-landed'); // simulate a re-render that lost the class
        window.renderCardPrices();
        return { reAdded: el.classList.contains('is-landed'), anims: el.getAnimations().length };
    });
    check(!replay.reAdded && replay.anims === 0, 'a refresh does NOT replay the landing (first-fill guard)', JSON.stringify(replay));

    // ============================================================
    console.log('\n  §5 UNFOLD — the payline fold');
    await page.evaluate(async () => {
        // bare name: currentGuest is a module-scoped `let` (CLAUDE.md) — window.currentGuest is a different variable
        currentGuest = { id: 1, name: 'Guest Tester', email: 'guest@example.com' };
        try { window.setAuthUI(); } catch (e) {}
        window.nav('view-guest-bookings');
        await window.renderGuestBookings();
    });
    await page.waitForTimeout(700);
    const foldSel = await page.evaluate(() => { const f = document.querySelector('.gb2-fold'); return f ? '#' + f.id : null; });
    check(!!foldSel, 'a payline fold rendered', foldSel);
    const foldShape = await page.evaluate((s) => { const f = document.querySelector(s); return { kids: f.children.length, in: f.firstElementChild && f.firstElementChild.classList.contains('gb2-foldin'), hidden: f.hidden, h: Math.round(f.getBoundingClientRect().height) }; }, foldSel);
    check(foldShape.kids === 1 && foldShape.in, 'the fold holds exactly one child (a 0fr grid collapses only the first track)', JSON.stringify(foldShape));
    check(foldShape.hidden && foldShape.h < 3, 'closed: hidden and 0px', foldShape.h + 'px');
    await page.click('.gb2-payline');
    await page.waitForTimeout(60);
    const foldMid = await page.evaluate((s) => { const f = document.querySelector(s); return { hidden: f.hidden, h: Math.round(f.getBoundingClientRect().height), anims: f.getAnimations({ subtree: true }).map((a) => 't:' + a.transitionProperty) }; }, foldSel);
    check(!foldMid.hidden, 'hidden is false the instant it opens');
    check(foldMid.anims.some((a) => /grid-template-rows/.test(a)), 'and the height is in flight', foldMid.anims.join(','));
    await page.waitForFunction((s) => document.querySelector(s).getAnimations({ subtree: true }).length === 0, foldSel, { timeout: 2000 });
    const foldOpen = await page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().height), foldSel);
    check(foldOpen > 60 && foldMid.h < foldOpen, 'it was genuinely part-open mid-flight', foldMid.h + ' -> ' + foldOpen);
    await page.click('.gb2-payline');
    const foldClosing = await page.evaluate((s) => document.querySelector(s).hidden, foldSel);
    check(foldClosing, 'hidden is true the instant it closes (every gate that reads it stays honest)');
    await page.waitForTimeout(500);
    const foldVis = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).visibility, foldSel);
    check(foldVis === 'hidden', 'and it leaves the tab order once shut', foldVis);

    // ============================================================
    console.log('\n  §6 TRAVEL — the pill and the connector');
    await page.evaluate(() => window.nav('view-experiences'));
    await page.waitForTimeout(900);
    const seat = await page.evaluate(() => {
        const host = document.getElementById('exp-filters');
        const pill = host.querySelector(':scope > .chb-pill'), on = host.querySelector('.exp-chip.is-on');
        if (!pill || !on) return null;
        const p = pill.getBoundingClientRect(), c = on.getBoundingClientRect();
        window.__chipRef = host.querySelector('.exp-chip:not(.is-on)');
        return { dx: Math.abs(p.left - c.left), dw: Math.abs(p.width - c.width), hasPill: host.classList.contains('has-pill'), onBg: getComputedStyle(on).backgroundColor };
    });
    check(seat && seat.hasPill && seat.dx <= 2 && seat.dw <= 2, 'the pill is seated on the chosen chip on first paint', JSON.stringify(seat));
    check(seat && /rgba\(0, 0, 0, 0\)|transparent/.test(seat.onBg), 'and the chip has handed its fill to the pill', seat && seat.onBg);
    await page.evaluate(() => window.__chipRef.click());
    await page.waitForTimeout(50);
    const travel = await page.evaluate(() => document.getElementById('exp-filters').querySelector('.chb-pill').getAnimations().map((a) => 't:' + a.transitionProperty));
    check(travel.some((a) => /translate|width/.test(a)), 'tapping another chip moves the pill', travel.join(','));
    await page.waitForFunction(() => document.querySelector('#exp-filters .chb-pill').getAnimations().length === 0, null, { timeout: 2000 });
    const landedPill = await page.evaluate(() => {
        const host = document.getElementById('exp-filters');
        const p = host.querySelector('.chb-pill').getBoundingClientRect(), c = host.querySelector('.exp-chip.is-on').getBoundingClientRect();
        return { dx: Math.abs(p.left - c.left), dw: Math.abs(p.width - c.width), survived: window.__chipRef.isConnected, on: host.querySelector('.exp-chip.is-on').textContent };
    });
    check(landedPill.dx <= 2 && landedPill.dw <= 2, 'and lands on it', JSON.stringify(landedPill));
    check(landedPill.survived, 'the chips were toggled in place, not rebuilt (a rebuild kills the pill mid-flight)');
    // the connector
    await page.evaluate(() => { window.openProperty('21a'); });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.openEnquireModal(); });
    await page.waitForTimeout(500);
    const conn0 = await page.evaluate(() => document.querySelectorAll('.enq-prog-line.done').length);
    await page.evaluate(() => { window.setEnqStep(2); });
    await page.waitForTimeout(60);
    const conn = await page.evaluate(() => {
        const l = document.querySelector('.enq-prog-line');
        return { done: l.classList.contains('done'), anims: l.getAnimations({ subtree: true }).map((a) => 't:' + a.transitionProperty), n: document.querySelectorAll('.enq-prog-line.done').length };
    });
    check(conn0 === 0 && conn.done && conn.n === 1, 'step two lights the first connector and only the first', conn0 + ' -> ' + conn.n);
    check(conn.anims.some((a) => /transform/.test(a)), 'and it fills rather than switches', conn.anims.join(','));
    await page.evaluate(() => { window.setEnqStep(1); });

    // ============================================================
    console.log('\n  §7 WORK — busy is not disabled; the wait has a shape');
    const busy = await page.evaluate(() => {
        const b = document.getElementById('enq-submit-btn');
        b.classList.add('is-busy');
        const cs = getComputedStyle(b), ps = getComputedStyle(b, '::before');
        const out = { op: cs.opacity, spin: ps.animationName, ptr: cs.pointerEvents };
        b.classList.remove('is-busy');
        b.disabled = true;
        out.disabledOp = getComputedStyle(b).opacity;
        b.disabled = false;
        return out;
    });
    check(busy.spin === 'chbSpin' && busy.ptr === 'none', 'a busy button spins and refuses taps', JSON.stringify(busy));
    check(busy.op === '1' && busy.disabledOp === '0.6', 'and does not dim — disabled still does', busy.op + ' vs ' + busy.disabledOp);
    // the wait: hold the fetch and look
    await page.evaluate(() => { try { window.closeEnquireModal(); } catch (e) {} });
    let release;
    holdMine = new Promise((r) => (release = r));
    const waitP = page.evaluate(async () => {
        document.getElementById('guest-bookings-list').innerHTML = ''; // a cold list
        window.nav('view-guest-bookings');
        await window.renderGuestBookings();
    });
    await page.waitForTimeout(400);
    const waiting = await page.evaluate(() => ({ sk: document.querySelectorAll('#guest-bookings-list .sk-card').length, w: document.getElementById('guest-welcome').textContent }));
    check(waiting.sk === 2, 'a cold My Stays waits with two skeleton cards', waiting.sk);
    check(/Finding your stays/.test(waiting.w) && !/here are your stays/.test(waiting.w), 'and the sentence waits its turn', waiting.w);
    release(); holdMine = null;
    await waitP;
    const arrived = await page.evaluate(() => ({ sk: document.querySelectorAll('#guest-bookings-list .sk-card').length, cards: document.querySelectorAll('#guest-bookings-list .gb2').length, w: document.getElementById('guest-welcome').textContent }));
    check(arrived.sk === 0 && arrived.cards === 2 && /Welcome back/.test(arrived.w), 'the stays replace the skeletons and the welcome arrives with them', JSON.stringify(arrived));

    // ============================================================
    console.log('\n  §8 NUDGE — the refused field');
    await page.evaluate(() => { window.openProperty('21a'); });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        window.openEnquireModal();
        const dd = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
        document.getElementById('enq-checkin').value = dd(30);
        document.getElementById('enq-checkout').value = dd(34);
        try { window.refreshDateTrigger(); window.updateEnquiryPrice(); } catch (e) {}
        window.enquireContinue();
        document.getElementById('enq-name').value = '';
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { try { window.submitEnquiry(); } catch (e) {} });
    await page.waitForTimeout(60);
    const nudge = await page.evaluate(() => {
        const f = document.getElementById('enq-name');
        return { bad: f.classList.contains('is-bad'), focus: document.activeElement === f, anims: f.getAnimations().map((a) => a.animationName), msg: document.getElementById('enq-msg-details').textContent };
    });
    check(nudge.bad && nudge.focus, 'the refused field is marked and focused', JSON.stringify({ bad: nudge.bad, focus: nudge.focus }));
    check(nudge.anims.includes('chbNudge'), 'and nudged once', nudge.anims.join(','));
    check(/name/i.test(nudge.msg), 'the words still name it', nudge.msg);
    await page.type('#enq-name', 'S');
    const cleared = await page.evaluate(() => document.getElementById('enq-name').classList.contains('is-bad'));
    check(!cleared, 'the mark clears as you type');

    // ============================================================
    console.log('\n  §9 DRAW — Copy code');
    const draw = await page.evaluate(() => {
        const b = document.createElement('button');
        b.className = 'hub-code-copy'; b.textContent = 'Copy code';
        document.body.appendChild(b);
        const w0 = Math.round(b.getBoundingClientRect().width);
        const orig = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
        window.guestCopyCode('7302', b);
        return new Promise((res) => setTimeout(() => {
            const w1 = Math.round(b.getBoundingClientRect().width);
            const tick = b.querySelector('.cc-tick path');
            const out = { w0, w1, done: b.classList.contains('is-done'), tick: !!tick, anim: tick ? tick.getAnimations().map((a) => a.animationName) : [] };
            if (orig) Object.defineProperty(navigator, 'clipboard', { value: orig, configurable: true });
            res(out);
        }, 80));
    });
    check(draw.done && draw.tick && draw.anim.includes('chbDraw'), 'the tick draws itself', JSON.stringify(draw));
    check(draw.w0 === draw.w1, 'and the button keeps its width under the thumb', draw.w0 + ' -> ' + draw.w1);

    // ============================================================
    console.log('\n  §10 CROSS — the calendar and the lightbox');
    await page.evaluate(() => { try { window.closeEnquireModal(); } catch (e) {} window.openProperty('21a'); });
    await page.waitForTimeout(700);
    const t0 = await page.evaluate(() => document.getElementById('avail-cal-title').textContent);
    await page.evaluate(() => window.availCalMove(1));
    await page.waitForTimeout(40);
    const calOut = await page.evaluate(() => { const g = document.getElementById('avail-cal-grid'); return { out: g.classList.contains('chb-mo-out'), anim: g.getAnimations().map((a) => a.animationName), mx: g.style.getPropertyValue('--mx').trim() }; });
    check(calOut.out && calOut.anim.includes('chbMoOut') && calOut.mx === '1', 'the month travels out in the direction of the arrow', JSON.stringify(calOut));
    await page.waitForTimeout(220);
    const calIn = await page.evaluate(() => { const g = document.getElementById('avail-cal-grid'); return { inn: g.classList.contains('chb-mo-in'), anim: g.getAnimations().map((a) => a.animationName), t: document.getElementById('avail-cal-title').textContent }; });
    check(calIn.inn && calIn.anim.includes('chbMoIn') && calIn.t !== t0, 'and the new month travels in', calIn.t);
    // two fast taps: the newest wins, no stuck frame
    await page.evaluate(() => { window.availCalMove(1); window.availCalMove(1); });
    await page.waitForTimeout(600);
    const calTwo = await page.evaluate(() => { const g = document.getElementById('avail-cal-grid'); return { out: g.classList.contains('chb-mo-out'), op: getComputedStyle(g).opacity, t: document.getElementById('avail-cal-title').textContent }; });
    check(!calTwo.out && calTwo.op === '1' && calTwo.t !== calIn.t, 'two fast taps land two months on, with no stuck frame', JSON.stringify(calTwo));
    const lb = await page.evaluate(() => {
        const back = document.getElementById('lightbox-img2');
        const rule = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).find((r) => r.selectorText === '#lightbox-img2.is-front');
        return { back: !!back, hidden: back && back.getAttribute('aria-hidden') === 'true', pos: back && getComputedStyle(back).position, rule: !!rule, stamp: typeof window.__lbStamp };
    });
    check(lb.back && lb.hidden && lb.pos === 'absolute' && lb.rule, 'the lightbox carries a decoded back layer over the in-flow image', JSON.stringify(lb));

    // ============================================================
    console.log('\n  §11 reduced motion');
    const rm = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
    await rm.emulateMedia({ reducedMotion: 'reduce' });
    await rm.route(/\.php/, (r) => {
        const u = r.request().url();
        const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (u.includes('rates.php')) return j({ properties: PROPS, seasons: {}, occupancy: OCC, payment: { deposit_pct: 25, balance_days: 30 } });
        if (u.includes('my-bookings.php')) return j({ ok: true, bookings: BOOKINGS, guest: { name: 'Guest Tester', email: 'guest@example.com' } });
        return j({ ok: true, bookings: [], enquiries: [], reviews: [], experiences: [], threads: [], messages: [], content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: PROPS });
    });
    await rm.goto(t.base + '/index.html');
    await rm.waitForTimeout(900);
    await rm.evaluate(async () => {
        // bare name: currentGuest is a module-scoped `let` (CLAUDE.md) — window.currentGuest is a different variable
        currentGuest = { id: 1, name: 'Guest Tester', email: 'guest@example.com' };
        try { window.setAuthUI(); } catch (e) {}
        window.nav('view-guest-bookings');
        await window.renderGuestBookings();
    });
    await rm.waitForTimeout(500);
    await rm.click('.gb2-payline');
    await rm.waitForTimeout(40);
    const rmFold = await rm.evaluate(() => Math.round(document.querySelector('.gb2-fold').getBoundingClientRect().height));
    check(rmFold > 60, 'the fold is fully open at 40ms — no travel', rmFold + 'px');
    const rmSpin = await rm.evaluate(() => { const b = document.createElement('button'); b.className = 'btn-glass is-busy'; document.body.appendChild(b); const n = getComputedStyle(b, '::before').animationName; b.remove(); return n; });
    check(rmSpin === 'none', 'the busy spinner stands down', rmSpin);
    const rmKill = await rm.evaluate(() => {
        for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r.media && /reduced-motion: reduce/.test(r.media.mediaText)) for (const x of r.cssRules) if (x.selectorText && /(^|,\s*)\*?::before/.test(x.selectorText)) return true; /* CSSOM serialises `*::before` as `::before` */ } catch (e) {} }
        return false;
    });
    check(rmKill, 'the killswitch rule names pseudo-elements (CSSOM)');
    await rm.close();

    // ============================================================
    //  THE OWNER'S SIDE. §12–§14 need the back office, so they run on their own
    //  page with an admin fixture rather than reusing the guest one above.
    // ============================================================
    const OBK = [
        { id: 1, prop_key: '21a', name: 'Sarah Pemberton', email: 'sarah@example.com', check_in: d(3), check_out: d(7), adults: 2, children: 0, deposit_paid: 0, payment: 'unpaid', payment_method: 'Card', hold_status: 'none', notes: '' },
        { id: 2, prop_key: 'jollyboat', name: 'Tom Ashby', email: 'tom@example.com', check_in: d(9), check_out: d(12), adults: 2, children: 0, deposit_paid: 900, payment: 'paid', payment_method: 'Card', hold_status: 'none', notes: '' },
    ];
    const ownerRoutes = (route) => {
        const u = route.request().url();
        const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (u.includes('admin-bootstrap.php')) return j({ ok: true, cron: { stale: false, everRan: true, ageHours: 2 }, feeds: [] });
        if (u.includes('accounts.php')) return j({ ok: true, total: 100, card_fees: 1, kept_deposits: 0, payments: [], deposit_liability: { net: 0, items: [], payouts: { known: 0, inBank: 0, lookback: 90, items: { inBank: [], unknown: [] } } } });
        if (u.includes('rates.php')) return j({ properties: PROPS, seasons: {}, occupancy: OCC, payment: { deposit_pct: 25, balance_days: 30 } });
        return j({ ok: true, bookings: OBK, enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [{ id: 90, prop_key: 'jollyboat', check_in: d(2), check_out: d(5), source: 'airbnb' }], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
    };
    const ownerBoot = async (vp) => {
        const p = await t.browser.newPage({ viewport: vp });
        p.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
        await p.route(/\.php/, ownerRoutes);
        await p.goto(t.base + '/index.html');
        await p.waitForTimeout(900);
        await p.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
        await p.evaluate(() => window.loadAdminBundle());
        await p.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
        await p.evaluate(async () => { await loadData(); });
        await p.evaluate(() => window.nav('view-backoffice'));
        await p.waitForTimeout(700);
        return p;
    };

    // ============================================================
    console.log('\n  §12 PRESS under a real pointer — held, and held');
    // 1000px: below the 1200 rail boundary, so the Inbox is STACKED (its fold rows
    // paint) and the hub is a page rather than a docked pane.
    const op = await ownerBoot({ width: 1000, height: 900 });
    // A HELD PRESS, sampled twice with 250ms between the samples. One sample after
    // the mouse goes down proves nothing: the compress is 80ms, so a rule that wins
    // for a frame and loses to a hover afterwards would pass. What this catches is
    // the state HOLDING, which is what a finger on a control actually does.
    const held = async (sel, label, kind) => {
        // BRING IT ON SCREEN FIRST. A control below the fold cannot be pressed by
        // real mouse coordinates, and skipping it would be a check that quietly
        // stopped running. Playwright's own scroll-into-view is used rather than a
        // scripted one because it waits for the scroll to COMMIT (a rAF does not —
        // the documented trap) before handing back a box.
        const marked = await op.evaluate((s) => {
            document.querySelectorAll('[data-msprobe]').forEach((e) => e.removeAttribute('data-msprobe'));
            const el = [...document.querySelectorAll(s)].find((x) => { const b = x.getBoundingClientRect(); return b.width > 6 && b.height > 6; });
            if (!el) return false;
            el.setAttribute('data-msprobe', '1');
            return true;
        }, sel);
        let box = null;
        if (marked) {
            const h = await op.$('[data-msprobe]');
            try { await h.scrollIntoViewIfNeeded(); } catch (e) {}
            await op.waitForTimeout(120);
            const bb = await h.boundingBox();
            if (bb && bb.y > 74 && bb.y + bb.height < 896) box = { x: Math.round(bb.x + Math.min(bb.width / 2, 24)), y: Math.round(bb.y + bb.height / 2), w: Math.round(bb.width) };
        }
        if (!box) { check(false, `${label}: a painted one to press`, sel); return; }
        const read = () => op.evaluate(() => {
            const el = document.querySelector('[data-msprobe]');
            const cs = getComputedStyle(el);
            const m = /matrix\(([\d.\-]+)/.exec(cs.transform);
            return { sc: m ? +m[1] : 1, bg: cs.backgroundColor, act: el.matches(':active') };
        });
        await op.mouse.move(box.x, box.y);
        const rest = await read();
        await op.mouse.down();
        await op.waitForTimeout(140);
        const a = await read();
        await op.waitForTimeout(250);
        const b = await read();
        // A PROBE MUST NOT ACTIVATE THE CONTROL. mouse.down + mouse.up IS a click,
        // and the first press navigated to a hub — after which every later probe
        // reported "not painted", i.e. the harness broke its own later checks.
        await op.evaluate(() => window.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true }));
        await op.mouse.up();
        await op.waitForTimeout(120);
        await op.evaluate(() => document.querySelectorAll('[data-msprobe]').forEach((e) => e.removeAttribute('data-msprobe')));
        if (kind === 'scale') {
            const px = (box.w * (1 - a.sc)).toFixed(1);
            check(a.act && a.sc < 1 && b.sc < 1, `${label} presses for the WHOLE hold`, `w${box.w} scale ${a.sc}/${b.sc} (${px}px) active=${a.act}`);
            check(Math.abs(px - 4) <= 0.8, `${label} presses ~4px, whatever it is`, px + 'px');
        } else {
            // THE GROUND MUST BE THE PRESS GROUND, not merely a different colour.
            // `!== rest.bg` was tried and is VACUOUS: several of these carry a
            // hover that says `:not(:active)`, so the hover DROPPING OUT is itself
            // a change and the check passed with the press rule deleted
            // (break-tested). Compare against the token, so it cannot rot when the
            // wash is retuned.
            const want = await op.evaluate(() => getComputedStyle(document.body).getPropertyValue('--press-ground').trim());
            const norm = (c) => c.replace(/\s+/g, '');
            check(a.act && norm(a.bg) === norm(want) && b.bg === a.bg, `${label} presses with its GROUND (--press-ground) for the whole hold`, `${rest.bg} → ${a.bg} / ${b.bg}, want ${want}`);
        }
    };
    // The two the reviewer measured DEAD under a pointer, and the three that had
    // no :active rule of any kind.
    await held('#needs-you-list .ny-row', '.ny-row', 'scale');
    await held('.inbox-sort-btn', '.inbox-sort-btn', 'scale');
    // The timeline's two. BOTH were dead under a pointer for the same reason the
    // card was, and neither was found by reading the sheet: `.tl-bar:not(.tl-ext)
    // :hover` (0,3,0) and `body.light-mode .tl-cell:hover` (0,3,0) each outranked
    // a press written at (0,2,0). A held press is the only thing that sees it.
    await held('.tl-bar', '.tl-bar', 'scale');
    await held('.tl-cell', '.tl-cell', 'list');
    await op.evaluate(() => window.openInbox());
    await op.waitForTimeout(800);
    await held('.bhub-fold-row', '.bhub-fold-row', 'list');
    // THE RAIL only exists from 1200px, so its rows are pressed on their own page.
    const railPage = await ownerBoot({ width: 1440, height: 900 });
    const railPress = await (async () => {
        await railPage.evaluate(() => { const r = document.querySelector('#admin-rail .rail-row'); if (r) r.setAttribute('data-msprobe', '1'); });
        const h = await railPage.$('[data-msprobe]');
        if (!h) return null;
        const bb = await h.boundingBox();
        if (!bb || bb.width < 6) return { dead: true };
        await railPage.mouse.move(Math.round(bb.x + bb.width / 2), Math.round(bb.y + bb.height / 2));
        const read = () => railPage.evaluate(() => { const el = document.querySelector('[data-msprobe]'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, act: el.matches(':active') }; });
        const rest = await read();
        await railPage.mouse.down();
        await railPage.waitForTimeout(140);
        const a = await read();
        await railPage.waitForTimeout(250);
        const b = await read();
        await railPage.evaluate(() => window.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true }));
        await railPage.mouse.up();
        const want = await railPage.evaluate(() => getComputedStyle(document.body).getPropertyValue('--press-ground').trim());
        return { rest, a, b, want };
    })();
    const railWant = (railPress && railPress.want) || '';
    const nrm = (c) => String(c).replace(/\s+/g, '');
    check(railPress && !railPress.dead && railPress.a.act && nrm(railPress.a.bg) === nrm(railWant) && railPress.b.bg === railPress.a.bg,
        '.rail-row presses with its GROUND (--press-ground) for the whole hold', railPress && !railPress.dead ? `${railPress.rest.bg} → ${railPress.a.bg} / ${railPress.b.bg}, want ${railWant}` : 'no painted rail row at 1440');
    await railPage.close();

    // .card is a GUEST surface, so it is pressed on the public page — this is the
    // one whose hover outranked its press by 1450 lines of stylesheet.
    const cardPage = await t.browser.newPage({ viewport: { width: 1000, height: 900 } });
    await cardPage.route(/\.php/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, properties: PROPS, seasons: {}, occupancy: OCC, bookings: [], enquiries: [], reviews: [], content: {}, blocks: [], ranges: [] }) }));
    await cardPage.goto(t.base + '/index.html');
    await cardPage.waitForTimeout(1200);
    await cardPage.evaluate(() => {
        const el = [...document.querySelectorAll('.card')].find((x) => x.getBoundingClientRect().width > 60);
        if (el) el.setAttribute('data-cardprobe', '1');
    });
    let cardPress = null;
    const ch = await cardPage.$('[data-cardprobe]');
    if (ch) {
        try { await ch.scrollIntoViewIfNeeded(); } catch (e) {}
        await cardPage.waitForTimeout(160);
        const bb = await ch.boundingBox();
        if (bb && bb.y > 80) cardPress = { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + 40), w: Math.round(bb.width) };
    }
    if (!cardPress) check(false, '.card: a painted one to press');
    else {
        await cardPage.mouse.move(cardPress.x, cardPress.y);
        await cardPage.mouse.down();
        await cardPage.waitForTimeout(140);
        const c1 = await cardPage.evaluate(() => { const el = document.querySelector('[data-cardprobe]'); const m = /matrix\(([\d.\-]+)/.exec(getComputedStyle(el).transform); return { sc: m ? +m[1] : 1, tr: getComputedStyle(el).transform, act: el.matches(':active') }; });
        await cardPage.waitForTimeout(250);
        const c2 = await cardPage.evaluate(() => { const el = document.querySelector('[data-cardprobe]'); const m = /matrix\(([\d.\-]+)/.exec(getComputedStyle(el).transform); return { sc: m ? +m[1] : 1 }; });
        await cardPage.evaluate(() => window.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true }));
        await cardPage.mouse.up();
        check(c1.act && c1.sc < 1 && c2.sc < 1, 'a hovered .card still presses (its hover no longer outranks :active)', `${c1.tr} active=${c1.act}`);
    }
    await cardPage.close();

    // ============================================================
    console.log('\n  §13 ONE arrival per navigation');
    // ARRIVAL animations only, by name. tlDraw (the timeline's once-per-visit
    // decoration) and a transition are not arrivals; chbPageIn / bhubIn / cardRise
    // are, and they are what doubled — a 700ms page rise with every card rising
    // again on top of it.
    const ARRIVALS = ['chbPageIn', 'bhubIn', 'cardRise', 'gtFade', 'fluidFadeIn'];
    const arrivals = async (fn) => {
        await op.evaluate(fn);
        await op.waitForTimeout(40);
        return op.evaluate((names) => [...document.querySelectorAll('.page-view.active')]
            .flatMap((v) => v.getAnimations({ subtree: true }))
            .filter((a) => names.includes(a.animationName))
            .map((a) => ({ n: a.animationName, dur: a.effect.getTiming().duration })), ARRIVALS);
    };
    await op.evaluate(() => window.nav('view-backoffice'));
    await op.waitForTimeout(900);
    const toHub = await arrivals(() => window.openBookingHub(1));
    check(toHub.length === 1 && toHub[0].n === 'chbPageIn', 'Today → hub: exactly ONE arrival', JSON.stringify(toHub));
    check(toHub.length === 1 && toHub[0].dur <= 400, 'and it is ≤400ms (iOS pushes a screen in ~350)', toHub[0] && toHub[0].dur + 'ms');
    await op.waitForTimeout(900);
    const back = await arrivals(() => window.nav('view-backoffice'));
    check(back.length === 1 && back[0].n === 'chbPageIn' && back[0].dur <= 400, 'hub → Today: one arrival too, and the cards do not rise again', JSON.stringify(back));
    await op.waitForTimeout(900);
    const toArea = await arrivals(() => window.openArea());
    check(toArea.length === 1 && toArea[0].dur <= 400, 'Today → Manage: one arrival', JSON.stringify(toArea));
    await op.waitForTimeout(900);
    // THE DAY SHEET APPEARS AT ONCE. This is the reason a nav transition was
    // refused as a feature, so the surface it was refused for gets none of it.
    await op.evaluate(() => document.body.classList.add('offline-snap'));
    const offline = await arrivals(() => window.nav('view-booking-hub'));
    check(offline.length === 0, 'with the day sheet up, a navigation animates NOTHING', JSON.stringify(offline));
    await op.evaluate(() => { document.body.classList.remove('offline-snap'); window.nav('view-backoffice'); });
    await op.waitForTimeout(700);

    // ============================================================
    console.log('\n  §14 reduced motion reaches the JS scrolls');
    const rmOwner = await t.browser.newPage({ viewport: { width: 1000, height: 900 } });
    rmOwner.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await rmOwner.emulateMedia({ reducedMotion: 'reduce' });
    await rmOwner.route(/\.php/, ownerRoutes);
    await rmOwner.goto(t.base + '/index.html');
    await rmOwner.waitForTimeout(900);
    await rmOwner.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await rmOwner.evaluate(() => window.loadAdminBundle());
    await rmOwner.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
    await rmOwner.evaluate(async () => { await loadData(); });
    await rmOwner.evaluate(() => window.nav('view-backoffice'));
    await rmOwner.waitForTimeout(700);
    check(await rmOwner.evaluate(() => typeof window.chbScroll === 'function'), 'chbScroll exists — the preference is read in one place');
    // Scroll a hub down, then leave it. With the preference on, the landing must be
    // in ONE read: an intermediate scrollY IS the glide.
    await rmOwner.evaluate(() => window.openBookingHub(1));
    await rmOwner.waitForTimeout(900);
    const jump = await rmOwner.evaluate(() => new Promise((res) => {
        document.body.style.minHeight = '3000px';
        window.scrollTo(0, 400);
        setTimeout(() => {
            const seen = [];
            let n = 0;
            const tick = () => { seen.push(Math.round(window.scrollY)); if (++n < 24) requestAnimationFrame(tick); else { document.body.style.minHeight = ''; res(seen); } };
            window.nav('view-backoffice');
            requestAnimationFrame(tick);
        }, 260);
    }));
    const mid = jump.filter((y) => y > 4 && y < 396);
    check(jump[jump.length - 1] === 0, 'the scroll lands at the top', jump.join(','));
    check(mid.length === 0, 'and it lands in ONE read — no mid-flight value', 'mid-flight: ' + (mid.join(',') || 'none'));
    // The killswitch's own half, asserted through the CSSOM: Chromium's emulation
    // forces every transition-duration to ~1e-05s whatever the CSS says, so a
    // computed read cannot tell our rule from the browser's own.
    const rmRule = await rmOwner.evaluate(() => {
        for (const s of document.styleSheets) {
            try { for (const r of s.cssRules) if (r.media && /reduced-motion: reduce/.test(r.media.mediaText)) for (const x of r.cssRules) if (x.selectorText && /\.bhub-menu/.test(x.selectorText) && /none/.test(x.style.animation || '')) return true; } catch (e) {}
        }
        return false;
    });
    check(rmRule, 'the hub menu stands its exit down under the preference (CSSOM)');
    await rmOwner.close();
    await op.close();

    console.log(fails ? `\n  ${fails} MOTION-SYSTEM CHECK(S) FAILED ❌` : '\n  motion system: all checks passed ✅');
    await t.done(fails);
})();
