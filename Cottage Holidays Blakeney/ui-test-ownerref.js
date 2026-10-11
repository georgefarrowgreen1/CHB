// THE OWNER'S REFERENCE SCREENS — Money, Income & tax, the assistant and the
// key safes. These are the pages the owner opens when they need an ANSWER
// rather than every morning, and they carried the two flat-out wrong things the
// whole-site review found last:
//
//  §1 THE HOW-TO ANSWER CARRIES ITS STEPS. A generated how-to is ALWAYS the
//     hero, and cmdkHeroHtml composed label + sub only — so the paragraph the
//     query asked for (`nlgBody`, which cmdkRowHtml has always rendered) stopped
//     appearing on screen the moment the hero existed. Asserted as EQUALITY with
//     the composer's own data, so the hero cannot render a different answer.
//  §2 (removed with the Move money out screen it measured)
//  §3 NOTHING LOSES ITS WORDS. The subs, labels and money lines on the owner's
//     reference surfaces, at 360 / 390 / 1280: the one Payments page (the
//     landing, the books — Income & tax lives there now — a stay's payments,
//     which replaced Payments & balances, and With Square), the key safes and
//     the assistant's thread. Measured as INK — a Range over each element's
//     contents against its own content box — never `scrollWidth`, because a
//     `::before` hit region inflates that (the searchpage §13 lesson) and a
//     clamped element's overflow is VERTICAL, which a width check cannot see.
//  §4 INCOME & TAX STANDS ON ONE RAIL. It is the Payments page's books page now;
//     at 1280 the old page ran four widths on one page (select 1120px, headline
//     460, folds 640, forecast 718). Its blocks share one left and one right
//     edge, and at 390 nothing in it reaches past the viewport. (The monthly
//     forecast and its four-column table went with the old page; the books
//     page's quarters carry the year's shape.)
//  §5 (removed: ONE DISCLOSURE VOCABULARY had no subject left on the screens it
//     walked — the Status page's text disclosures became the Tools card row, the
//     key safe's moved into its sheet, and the last one, Move money out's "Show
//     how these figures are worked out", went with that screen.)
//
// TZ is pinned by ui-test-lib at require time (the app reckons "today" in UK
// time, so fixtures built from new Date() must agree with it on any runner).
const { boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
// Local-formatted, never toISOString() — that is UTC and slips a day near midnight.
const d = require('./ui-test-lib').d; // the harness's day (keeps the page's clock near midnight)

// ---- THE INK, NOT THE BOX -------------------------------------------------
// An element loses words when its own text is painted outside its content box —
// past the right edge (a nowrap ellipsis) or past the bottom (a line clamp).
// Both are found the same way: a Range over the CONTENTS gives the rectangles
// the browser really laid the text out in, clipped lines included. The element
// box is useless here twice over: a hit-region pseudo inflates scrollWidth
// (which is what made an earlier detector cry wolf on the scope chips), and a
// wrapping element's box is exactly as tall as its clamp whatever it holds.
const LOST = (sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
        if (!el.getClientRects().length) continue;
        const txt = (el.textContent || '').trim();
        if (!txt) continue;
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const padR = parseFloat(cs.paddingRight) || 0;
        const padB = parseFloat(cs.paddingBottom) || 0;
        const r = document.createRange();
        r.selectNodeContents(el);
        const rects = [...r.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5);
        if (!rects.length) continue;
        let over = 0;
        for (const q of rects) {
            over = Math.max(over, q.right - (box.right - padR), q.bottom - (box.bottom - padB));
        }
        // 1.5px of tolerance: sub-pixel line boxes and a font's own overshoot
        // routinely poke a fraction past a box that is not clipping anything.
        if (over > 1.5) out.push({ sel: el.className || el.tagName, txt: txt.slice(0, 52), over: Math.round(over) });
    }
    return out;
};

// The selectors that carry WORDS on these screens. Deliberately the reading
// tiers only — a figure column is nowrap by design and says so.
const READ_SELS = [
    '.bhub-fold-sub', '.bhub-kv-label', '.bhub-kv-sub',
    '.mo-pulse', '.bk-row-dates', '.bk-row-name', '.feed-who',
    '.cmdk-turn-a', '.ks-say', '.ks-row-sub', '.acr-cap', '.mf-name', '.mf-sub',
    // The one Payments page's reading tiers: a row's title and sub, a caption, the
    // owed card's caption line, a detail page's title and sub, a sum row's label, a
    // stay's timeline and a page's note.
    '#pm .pm-t', '#pm .pm-s', '#pm .pm-capline > span:first-child', '#pm .pm-owe-top > span',
    '#pm .pm-dname', '#pm .pm-dsub', '#pm .pm-kv > span:first-child', '#pm .pm-tl-t', '#pm .pm-tl-s',
    '#pm .pm-note', '#pm .pm-hero-sub', '#pm .pm-hero-top > span',
].join(', ');

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 1280, height: 950 } });

    const PROPS = [
        { prop_key: '21a', name: '21A Westgate Street', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 150, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 6, sort_order: 2 },
        { prop_key: 'pimpernel', name: 'Pimpernel', slug: 'pimpernel', couple_rate: 140, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 0, max_total: 4, sort_order: 3 },
    ];
    const bk = (id, over) => Object.assign({
        id, prop_key: '21a', name: 'Richard Berry', email: 'r@x.co', phone: '', address: '1 Lane', postcode: 'NR25 7AB',
        check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00',
        adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
        agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '',
    }, over || {});
    // A HOSTILE fixture, because the real names fit: the long guest name is what
    // makes the row's own clamp the thing under test rather than the copy.
    const BK = [
        bk(1, { name: 'Alexandrina Featherstonehaugh-Smythe', check_in: d(-30), check_out: d(-26), payment: 'part', deposit_paid: 300, payment_method: 'Card', payment_date: d(-40) }),
        bk(2, { name: 'Part Paid Plan', prop_key: 'jollyboat', check_in: d(45), check_out: d(52), payment: 'part', deposit_paid: 300, payment_method: 'Card', payment_date: d(-3), balance_due_date: d(60), agreed_total: 960, agreed_nightly: 910, hold_status: 'charged', hold_amount: 50 }),
        bk(3, { name: 'Paid Up Guest', prop_key: 'pimpernel', check_in: d(9), check_out: d(12), payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-9) }),
    ];
    const LIAB = {
        gross: 150, feeBack: 2.62, net: 147.38, count: 2, rate: 0.0175,
        items: [
            { outstanding: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Sarah Pemberton', prop_key: '21a', check_in: d(-8), check_out: d(-4) },
            { outstanding: 75, gross: 75, feeBack: 1.31, net: 73.69, name: 'Dan Rowe', prop_key: '21a', check_in: d(-6), check_out: d(-2) },
        ],
        transactions: {
            settled: 1056.19, ringFence: 73.69, movable: 982.5, count: 2,
            items: [
                { txn_id: 11, rental: 300, deposit: 75, returned: 0, fee: 6.56, gross: 375, settled: 368.44, alreadyOut: 0, ringFence: 73.69, movable: 294.75, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-12) },
                { txn_id: 12, rental: 700, deposit: 0, returned: 0, fee: 12.25, gross: 700, settled: 687.75, alreadyOut: 0, ringFence: 0, movable: 687.75, name: 'Sarah Pemberton', prop_key: '21a', paid_on: d(-5) },
            ],
        },
        // `unknown` carries a 40-day-old charge so the Money landing renders its
        // "Square hasn't said" exception — the one sub on that page that was
        // being cut, and which no fixture had ever produced.
        payouts: {
            inBank: 294.75, onWay: 687.75, unknown: 491.25, moved: 0, fees: 0, nextArrival: d(2),
            counts: { inBank: 1, onWay: 1, unknown: 1, moved: 0 }, movedMap: {},
            checked: Math.floor(Date.now() / 1000), error: null, known: 3, lookback: 90,
            items: {
                inBank: [{ txn_id: 11, name: 'Sarah Pemberton', kind: 'balance', prop_key: '21a', paid_on: d(-12), settled: 368.44, ringFence: 73.69, movable: 294.75, landed: true, arrival: d(-10) }],
                onWay: [{ txn_id: 12, name: 'Sarah Pemberton', kind: 'balance', prop_key: '21a', paid_on: d(0), settled: 687.75, ringFence: 0, movable: 687.75, landed: false, arrival: d(2) }],
                unknown: [{ txn_id: 13, name: 'Ines Duarte', kind: 'deposit', prop_key: '21a', paid_on: d(-40), settled: 491.25, ringFence: 0, movable: 491.25 }],
                moved: [],
            },
        },
    };
    // THE ONE PAYMENTS PAGE reads money.php: where the money is (a 40-day-old card
    // charge Square has not reported, so Needs you raises "Card payments to check" and
    // With Square lists it), the tax year's books, and the movements — the hostile
    // name among them, on a deposit return still on its way.
    const now = Math.floor(Date.now() / 1000);
    const TY = d(0) < `${new Date().getFullYear()}-04-06` ? new Date().getFullYear() - 1 : new Date().getFullYear();
    const MONEY = {
        ok: true, at: now,
        position: { with_square: 1179, with_square_count: 2, unknown: 491.25, unreported: 491.25, unreported_count: 1, next_arrival: d(2), in_bank: 368.44, ready: 294.75, held: 73.69, last_moved: 0, error: false, checked: now, payout_error: null, failed: [], disputes: null, bank: '' },
        bank_items: [{ txn_id: 11, booking_id: 2, name: 'Sarah Pemberton', prop: '21a', paid_on: d(-12), gross: 375, fee: 6.56, settled: 368.44, fenced: 73.69, movable: 294.75, arrival: d(-10), moved_at: 0, by_owner: 0, failed: false }],
        moved_map: {}, landed_map: {},
        way_items: [
            { txn_id: 12, booking_id: 2, name: 'Sarah Pemberton', prop: '21a', paid_on: d(0), gross: 700, fee: 12.25, settled: 687.75, fenced: 0, movable: 687.75, arrival: d(2), moved_at: 0, by_owner: 0, failed: false },
            { txn_id: 13, booking_id: 1, name: 'Alexandrina Featherstonehaugh-Smythe', prop: '21a', paid_on: d(-40), gross: 500, fee: 8.75, settled: 491.25, fenced: 0, movable: 491.25, arrival: '', moved_at: 0, by_owner: 0, failed: false },
        ],
        books: { year: TY, income: 656.2, kept: 50, fees: 9.8, expenses: 120, profit: 576.4, quarters: [0, 656.2, 50, 0], by_category: [{ category: 'Maintenance', amount: 120 }], undated: { count: 0, total: 0, held: 0 } },
        years: [TY, TY - 1],
        activity: [
            { id: 'p31', at: now - 86400, kind: 'back', what: 'Deposit returned', booking_id: 1, name: 'Alexandrina Featherstonehaugh-Smythe', prop: '21a', amount: 110, deposit: 0, fee: null, method: 'card', status: 'pending', payout: null },
            { id: 'p30', at: now - 3 * 86400, kind: 'in', what: 'Deposit', booking_id: 2, name: 'Part Paid Plan', prop: 'jollyboat', amount: 350, deposit: 50, fee: 6.13, method: 'card', status: 'done', payout: { payout: 'po_1', arrival: d(-1), landed: true, fee: 6.13 } },
            { id: 'opo_1', payout: 'po_1', at: now - 86400 - 3600, kind: 'payout', amount: 343.87, arrival: d(-1), state: 'landed' },
            // A payment the owner recorded by hand: its sub says how it came, on every such row.
            { id: 'p29', at: now - 5 * 86400, kind: 'in', what: 'Balance', booking_id: 3, name: 'Paid Up Guest', prop: 'pimpernel', amount: 440, deposit: 0, fee: null, method: 'Bank transfer', status: 'done', payout: null },
            { id: 'x1', at: now - 40 * 86400, kind: 'expense', what: 'Maintenance', who: 'Boiler service', prop: '', amount: 120 },
        ],
    };
    const STAY_EVENTS = [
        { id: 'p20', at: now - 41 * 86400, kind: 'in', what: 'Deposit', booking_id: 1, name: 'Alexandrina Featherstonehaugh-Smythe', prop: '21a', amount: 300, deposit: 0, fee: 5.25, method: 'card', status: 'done', payout: { payout: 'po_0', arrival: d(-39), landed: true, fee: 5.25 } },
        { id: 'p31', at: now - 86400, kind: 'back', what: 'Deposit returned', booking_id: 1, name: 'Alexandrina Featherstonehaugh-Smythe', prop: '21a', amount: 110, status: 'pending' },
    ];
    const SAFE = { code: '9265', setAt: d(-8) + 'T09:00:00Z', forBooking: 1, forStay: 'b:1', history: [], name: '21A Westgate Street' };
    const SAFE_JB = { code: '', setAt: '', forBooking: 0, forStay: '', history: [], name: 'Jollyboat' };

    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (url.includes('keysafe.php')) return json({ ok: true, safes: { '21a': SAFE, jollyboat: SAFE_JB }, revealDays: 2 });
        if (url.includes('admin-bootstrap')) return json({ ok: true, cron: { stale: false, everRan: true, ageHours: 3 }, feeds: [] });
        if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
        if (url.includes('accounts.php')) return json({
            ok: true, year: 2026, years: [2026, 2025], total: 656.2, held_deposits: 0,
            card_fees: 9.8, fee_days: [], kept_deposits: 50, kept_days: [], count: 1,
            by_property: { '21a': 656.2 }, payments: [], undated: { count: 0, total: 0, held: 0 },
            deposit_liability: LIAB,
        });
        if (url.includes('money.php')) {
            if (b.action === 'stay') return json({ ok: true, events: STAY_EVENTS });
            return json(MONEY);
        }
        if (url.includes('expenses.php')) return json({ ok: true, expenses: [{ id: 1, date: d(-40), category: 'Maintenance', note: 'Boiler service', amount: 120 }] });
        if (url.includes('bookings.php')) {
            if (b.action === 'recent_payments') return json({ ok: true, payments: [{ name: 'Alexandrina Featherstonehaugh-Smythe', prop_key: '21a', kind: 'damages_return', amount: '110.00', created_at: d(-1) + ' 10:00:00', status: 'FAILED' }] });
            if (b.action === 'email_logs') return json({ ok: true, logs: {} });
            if (b.action === 'history') return json({ ok: true, events: [] });
            return json({ ok: true, bookings: BK });
        }
        if (url.includes('leads.php')) return json({ ok: true, leads: [] });
        if (url.includes('reviews.php')) return json({ ok: true, reviews: [] });
        return json({ ok: true, bookings: BK, enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: PROPS, years: [2026, 2025] });
    });

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1300);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(900);
    await page.evaluate(() => loadData());
    await page.waitForTimeout(900);

    // =====================================================================
    console.log('\n§1 The how-to answer carries its steps');
    // =====================================================================
    const howto = await page.evaluate(async () => {
        openCmdK();
        await new Promise((r) => setTimeout(r, 350));
        const i = document.getElementById('cmdk-input');
        i.value = 'how do i take a payment';
        cmdkSearchCore('how do i take a payment', false);
        await new Promise((r) => setTimeout(r, 500));
        const lead = __cmdkResults[0] || null;
        const heroEl = document.querySelector('#cmdk .cmdk-hero');
        const bodyEl = document.querySelector('#cmdk .cmdk-hero .cmdk-nlg-body');
        return {
            leadHasBody: !!(lead && lead.nlgBody),
            data: (lead && lead.nlgBody) || '',
            isHero: !!heroEl,
            dom: bodyEl ? (bodyEl.textContent || '').trim() : null,
            painted: !!(bodyEl && bodyEl.getClientRects().length),
        };
    });
    ok(howto.leadHasBody, `(fixture) the how-to answer leads and its data carries a spoken body (${howto.data.slice(0, 46)}…)`);
    ok(howto.isHero, '…and it renders as the HERO, which is why the row version never showed');
    ok(howto.dom !== null && howto.painted, 'the hero paints a .cmdk-nlg-body');
    ok(howto.dom === howto.data.trim(), 'and its words are EXACTLY the composer’s nlgBody — the hero answers the same question the row would');

    // The sub stays the CAPTION: the body is an addition, never a replacement.
    const heroSub = await page.evaluate(() => {
        const s = document.querySelector('#cmdk .cmdk-hero-sub');
        return s ? (s.textContent || '').trim() : '';
    });
    ok(heroSub.length > 0 && heroSub !== howto.dom, `the sub is still the caption beside it (${heroSub})`);
    await page.evaluate(() => { try { closeCmdK(); } catch (e) {} });
    await page.waitForTimeout(300);

    // =====================================================================
    console.log('\n§3 No sub, label or money line loses its words');
    // =====================================================================
    // Every owner surface, driven for real. A screen that renders NOTHING would
    // pass vacuously, so every sweep carries a floor, counted INSIDE the surface
    // (a detail page slides over the list on a phone, and the list behind it must
    // not make up the detail page's count).
    // [name, open, floor, scope, ready]
    const surfaces = [
        ['Payments landing', async () => { await openAccounts(); pmClose(); }, 6, '#pm-list',
            () => /Card payments? to check/.test(document.getElementById('pm-list').textContent) && !!document.querySelector('#pm-list .pm-mrow[aria-label^="Alexandrina"]')],
        // Income & tax IS the books page now (accountsOpen('income') routes to it).
        ['The books (Income & tax)', async () => { await openAccounts(); accountsOpen('income'); }, 3, '#pm-detail',
            () => !!document.querySelector('#pm-detail .pm-hero') && /The books/.test(document.getElementById('pm-detail').textContent)],
        // A stay's payments: the per-booking page that replaced Payments & balances,
        // opened from the guest's row in "Guests still to pay".
        ['A stay’s payments', async () => {
            await openAccounts(); pmClose();
            const r = [...document.querySelectorAll('#pm-list .pm-orow')].find((x) => /^Alexandrina/.test(x.getAttribute('aria-label') || ''));
            if (r) r.click();
        }, 3, '#pm-detail', () => /Deposit returned/.test((document.getElementById('pm-detail') || {}).textContent || '')],
        // With Square: the card payments not yet in the bank, the 40-day-old one Square
        // has not reported among them (the old landing's "Square hasn't said" row).
        ['With Square', async () => { await openAccounts(); pmOpen('way'); }, 2, '#pm-detail',
            () => /Not reported by Square/.test((document.getElementById('pm-detail') || {}).textContent || '')],
        ['Key safes', async () => { await openKeysafe(); }, 2, '#view-keysafe', () => document.querySelectorAll('#view-keysafe .ks-row').length > 0],
    ];
    for (const w of [360, 390, 1280]) {
        await page.setViewportSize({ width: w, height: 950 });
        await page.waitForTimeout(250);
        for (const [name, open, floor, scope, ready] of surfaces) {
            await page.evaluate(new Function('return (' + open.toString() + ')()'));
            await page.waitForFunction(new Function('return (' + ready.toString() + ')()'), null, { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(150);
            const sels = READ_SELS.split(', ').map((x) => scope + ' ' + x.replace(/^#pm /, '')).join(', ');
            const n = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).length, sels);
            ok(n >= floor, `${w}px ${name}: ${n} reading elements on screen (floor ${floor})`);
            const lost = await page.evaluate(LOST, sels);
            ok(lost.length === 0, `${w}px ${name}: none loses its words${lost.length ? ' — ' + lost.map((c) => `“${c.txt}” (.${String(c.sel).split(' ')[0]}) by ${c.over}px`).join('; ') : ''}`);
        }
        await page.evaluate(() => { try { pmClose(); } catch (e) {} });
        // The assistant's THREAD: a past answered turn keeps its figure. Driven
        // by asking twice — only an ANSWERED turn joins the thread.
        const turns = await page.evaluate(async () => {
            try { closeCmdK(); } catch (e) {}
            cmdkThreadClear();
            openCmdK();
            await new Promise((r) => setTimeout(r, 300));
            const i = document.getElementById('cmdk-input');
            for (const q of ['who owes me money', 'who arrives today']) {
                i.value = q; cmdkSearchCore(q, false);
                await new Promise((r) => setTimeout(r, 450));
            }
            return document.querySelectorAll('#cmdk .cmdk-turn-a').length;
        });
        ok(turns >= 1, `${w}px the assistant’s thread: ${turns} past turn(s) rendered (floor 1)`);
        const lostT = await page.evaluate(LOST, '.cmdk-turn-a');
        ok(lostT.length === 0, `${w}px the assistant’s thread: the past turn keeps its figure${lostT.length ? ' — ' + lostT.map((c) => `“${c.txt}” by ${c.over}px`).join('; ') : ''}`);
        await page.evaluate(() => { try { closeCmdK(); } catch (e) {} });
        await page.waitForTimeout(200);
    }

    // =====================================================================
    console.log('\n§4 Income & tax (the books page) stands on one rail');
    // =====================================================================
    const booksOpen = async () => {
        await page.evaluate(async () => { await openAccounts(); accountsOpen('income'); });
        // On a phone the page slides over the list: measure it where it COMES TO REST,
        // never mid-slide (a 0.38s translate reads as 380px past the viewport).
        await page.waitForFunction(() => {
            const pane = document.getElementById('pm-detail');
            return !!document.querySelector('#pm-detail .pm-hero') && !!document.querySelector('#pm-detail .pm-yr')
                && pane.getAnimations().length === 0 && Math.round(pane.getBoundingClientRect().left) <= Math.round(document.getElementById('pm').getBoundingClientRect().right);
        }, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(100);
    };
    await page.setViewportSize({ width: 390, height: 950 });
    await page.waitForTimeout(200);
    await booksOpen();
    const fc = await page.evaluate(() => {
        const host = document.querySelector('#pm-detail .pm-dbody');
        if (!host) return { missing: true };
        const rows = [...host.querySelectorAll('.pm-calc .pm-kv')].filter((e) => e.getClientRects().length);
        const wide = [...host.querySelectorAll('*')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > window.innerWidth + 1;
        }).map((e) => e.className || e.tagName);
        return {
            rows: rows.map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim()),
            quarters: [...host.querySelectorAll('.pm-ql span')].map((q) => (q.textContent || '').trim()),
            wide: wide.slice(0, 4),
            docW: Math.round(document.documentElement.scrollWidth),
            vw: window.innerWidth,
        };
    });
    ok(!fc.missing && fc.rows.length >= 5, `(vacuity guard) the books page renders its sum (${fc.rows && fc.rows.length} rows)`);
    ok(!fc.missing && /Rental income/.test(fc.rows.join('|')) && /card fees/.test(fc.rows.join('|')) && /Expenses/.test(fc.rows.join('|')) && /Profit\s*£576\.40/.test(fc.rows.join('|')),
        `it states income, fees, expenses and the profit they make (${fc.rows && fc.rows.join(' | ')})`);
    ok(!fc.missing && fc.quarters.length === 4 && fc.quarters.every((q) => /£|–/.test(q)), `each quarter states its figure (${fc.quarters && fc.quarters.join(' / ')})`);
    ok(fc.wide.length === 0, `nothing in the page reaches past the viewport${fc.wide.length ? ' — ' + fc.wide.join(', ') : ''}`);
    ok(fc.docW <= fc.vw + 1, `…and the page does not scroll sideways (${fc.docW} of ${fc.vw})`);

    await page.setViewportSize({ width: 1280, height: 950 });
    await page.waitForTimeout(300);
    await booksOpen();
    const rail = await page.evaluate(() => {
        const sec = document.querySelector('#pm-detail .pm-dbody');
        const pick = (sel) => sec.querySelector(sel);
        const parts = [
            ['tax-year switch', pick('.pm-yr')],
            ['profit headline', pick('.pm-hero')],
            ['the sum', pick('.pm-kvs.pm-calc')],
            ['the actions', pick('.pm-acts')],
        ].filter(([, el]) => el && el.getClientRects().length);
        const boxes = parts.map(([n, el]) => { const r = el.getBoundingClientRect(); return { n, l: Math.round(r.left), r: Math.round(r.right) }; });
        return { boxes, lefts: [...new Set(boxes.map((b) => b.l))], rights: [...new Set(boxes.map((b) => b.r))] };
    });
    ok(rail.boxes.length === 4, `(vacuity guard) all four blocks are on screen (${rail.boxes.map((b) => b.n).join(', ')})`);
    ok(rail.lefts.length === 1, `they share ONE left edge (${rail.boxes.map((b) => b.n + ' ' + b.l).join(' / ')})`);
    ok(rail.rights.length === 1, `and ONE right edge (${rail.boxes.map((b) => b.n + ' ' + b.r).join(' / ')})`);

    console.log(`\n${fails ? fails + ' FAILED' : 'All owner-reference checks passed'}`);
    await done(fails);
})();
