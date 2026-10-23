// LONG LISTS DRAW A PAGE AT A TIME (CLAUDE.md "Long lists draw a page at a time"):
//  1. Today's Past list draws its first page and says how many more; its count covers all
//  2. the next page is drawn as the end of the list comes near, and on the button
//  3. a search finds a booking not drawn yet; a data refresh keeps the pages drawn; another
//     filter starts again at the first page
//  4. the board filter, which counts the rows on screen, sees every row
//  5. on a computer the booking open beside the list always has its row
//  6. the Guest list: a page per group, a guest's details drawn only when their row is open,
//     a search across every guest, and search's "show this guest" reaching one not drawn
//  7. Payments: Needs you's deposits and the owed card a page at a time, their figures of all
const { d, bootVerdict, boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};
const pad = (n) => String(n).padStart(3, '0');

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    const mk = (id, over = {}) => Object.assign({
        id, prop_key: '21a', name: 'Guest ' + id, email: `g${id}@example.com`, phone: '', address: '1 Lane',
        postcode: 'NR25 7AB', check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00',
        adults: 2, children: 0, payment: 'paid', deposit_paid: 440, payment_method: 'Card', payment_date: d(-30),
        agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-40), hold_status: 'none', notes: '',
    }, over);
    // 100 finished stays, the most recent first in the Past list, and a few to come.
    const PAST = 100;
    const rows = [];
    for (let i = 1; i <= PAST; i++) rows.push(mk(i, { name: 'Past Guest ' + pad(i), check_in: d(-10 - 3 * i), check_out: d(-8 - 3 * i) }));
    for (let i = 1; i <= 5; i++) rows.push(mk(500 + i, { name: 'Coming Guest ' + i, email: `c${i}@example.com`, check_in: d(10 + 4 * i), check_out: d(12 + 4 * i) }));
    const POS = { with_square: 0, with_square_count: 0, unknown: 0, unreported: 0, unreported_count: 0, next_arrival: '', in_bank: 0, ready: 0, held: 0, last_moved: 0, error: false, checked: 0, payout_error: null, failed: [], disputes: null, bank: '' };
    const guests = [];
    for (let i = 1; i <= PAST; i++) guests.push({ email: `g${i}@example.com`, name: 'Past Guest ' + pad(i), ltv: 2000 - i, has_account: 0, stays: 1 });
    for (let i = 1; i <= 20; i++) guests.push({ email: `n${i}@example.com`, name: 'New Guest ' + pad(i), ltv: 10, has_account: 0, stays: 0 });
    await page.route(/\.php/, (route) => {
        const req = route.request();
        const url = req.url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'POST') {
            const b = JSON.parse(req.postData() || '{}');
            const ep = url.split('/').pop().split('?')[0];
            if (ep === 'auth.php' && b.action === 'guest_crm') return json({ ok: true, guests });
            if (ep === 'money.php' && b.action === 'summary') return json({ ok: true, at: Math.floor(Date.now() / 1000), position: POS, bank_items: [], way_items: [], moved_map: {}, landed_map: {}, books: null, years: [], activity: [] });
            if (ep === 'statements.php' && b.action === 'status') return json({ ok: true, ready: false });
            if (ep === 'split.php' && b.action === 'status') return json({ ok: true, on: false });
            return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], threads: [], expenses: [], returns: {} });
        }
        if (url.includes('bookings.php')) return json({ bookings: rows });
        if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
        return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await bootVerdict(page);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForFunction(() => /** @type {any} */ (window).__ADMIN_LOADED === true, null, { timeout: 15000 });
    await page.evaluate(() => loadData());
    await page.waitForFunction((n) => Object.values(dbBookings).reduce((s, l) => s + l.length, 0) === n, PAST + 5, { timeout: 10000 });
    const STEP = await page.evaluate(() => CHB_PAGE);
    const bk = () => page.evaluate(() => ({
        rows: document.querySelectorAll('#bookings-list .bk-row').length,
        more: ((document.querySelector('#bookings-list .chb-more') || {}).textContent || '').trim(),
        sum: ((document.getElementById('bookings-summary') || {}).textContent || '').trim(),
        first: ((document.querySelector('#bookings-list .bk-row .bk-row-name') || {}).textContent || '').trim(),
    }));

    // ---- 1. the first page ----
    console.log('1. Today\'s Past list draws its first page');
    await page.evaluate(() => { nav('view-backoffice'); bookingsSetFilter('past'); });
    await page.waitForFunction(() => document.querySelectorAll('#bookings-list .bk-row').length > 0, null, { timeout: 8000 });
    const p1 = await bk();
    ok(p1.rows === STEP, `the first page is drawn (${p1.rows} of ${PAST} rows)`);
    ok(new RegExp(`\\(${PAST - STEP}\\)`).test(p1.more), `…with a row saying how many more (${p1.more})`);
    ok(new RegExp(`${PAST} past`).test(p1.sum), `the count covers every row, drawn or not (${p1.sum})`);
    ok(p1.first === 'Past Guest 001', `in the list's own order, the most recent first (${p1.first})`);

    // ---- 2. the next page ----
    console.log('2. the next page as the end comes near, and on the button');
    await page.evaluate(() => { const b = document.querySelector('#bookings-list .chb-more'); if (b) b.scrollIntoView({ block: 'end' }); });
    await page.waitForFunction((n) => document.querySelectorAll('#bookings-list .bk-row').length > n, STEP, { timeout: 5000 }).catch(() => {});
    const p2 = await bk();
    ok(p2.rows >= 2 * STEP, `scrolling to the end drew the next page (${p2.rows} rows)`);
    await page.evaluate(() => { const b = /** @type {HTMLElement|null} */ (document.querySelector('#bookings-list .chb-more')); if (b) b.click(); });
    await page.waitForFunction((n) => document.querySelectorAll('#bookings-list .bk-row').length === n, PAST, { timeout: 5000 }).catch(() => {});
    const p3 = await bk();
    ok(p3.rows === PAST && p3.more === '', `the button draws the rest, and goes when there is no more (${p3.rows} rows, "${p3.more}")`);
    const dupes = await page.evaluate(() => { const ids = [...document.querySelectorAll('#bookings-list .bk-row')].map((r) => r.getAttribute('data-bkid')); return ids.length - new Set(ids).size; });
    ok(dupes === 0, `no row is drawn twice (${dupes} repeated)`);

    // ---- 3. search, refresh, another filter ----
    console.log('3. a search across every row; a refresh keeps the pages; a new filter starts again');
    await page.evaluate(() => renderBookings());
    ok((await bk()).rows === PAST, 'a redraw of the same list keeps the pages it had');
    // From the top of the page (at once: the page scrolls smoothly): a list whose end is
    // within reach draws its next page by itself, which is the point, and would draw it here too.
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); bookingsSetFilter('upcoming'); bookingsSetFilter('past'); });
    await page.waitForTimeout(150);
    const p4 = await bk();
    ok(p4.rows === STEP, `another filter starts again at the first page (${p4.rows})`);
    await page.evaluate(() => bookingsSetSearch('past guest 093'));
    await page.waitForFunction(() => document.querySelectorAll('#bookings-list .bk-row').length === 1, null, { timeout: 4000 }).catch(() => {});
    const s1 = await bk();
    ok(s1.rows === 1 && s1.first === 'Past Guest 093', `a search finds a booking that was not drawn (${s1.rows} row: ${s1.first})`);
    await page.evaluate(() => bookingsSetSearch(''));
    await page.waitForTimeout(200);

    // ---- 4. the board filter ----
    console.log('4. the board filter sees every row');
    await page.evaluate(() => applyTodayFilter('past guest 09'));
    await page.waitForFunction(() => !!document.getElementById('today-filter-bar'), null, { timeout: 5000 }).catch(() => {});
    const f4 = await page.evaluate(() => ({
        rows: document.querySelectorAll('#bookings-list .bk-row').length,
        bar: ((document.getElementById('today-filter-bar') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    ok(f4.rows === PAST, `every row is drawn while the filter is on (${f4.rows})`);
    ok(/· 10 matches/.test(f4.bar), `…so its count is of every booking that matches, 090 to 099, most of them not drawn before (${f4.bar})`);
    await page.evaluate(() => clearTodayFilter());

    // ---- 5. the open booking on a computer ----
    console.log('5. on a computer, the booking open beside the list has its row');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { bookingsSetFilter('upcoming'); bookingsSetFilter('past'); });
    const far = await page.evaluate(() => { const b = Object.values(dbBookings).flat().find((x) => x.name === 'Past Guest 077'); return b ? b.id : ''; });
    await page.evaluate((id) => openBookingHub(id), far);
    await page.waitForTimeout(400);
    await page.evaluate(() => renderBookings());
    const open5 = await page.evaluate((id) => ({ row: !!document.querySelector(`#bookings-list .bk-row[data-bkid="${id}"]`), open: !!document.querySelector(`#bookings-list .bk-row.is-open[data-bkid="${id}"]`) }), far);
    ok(open5.row && open5.open, `the 77th past stay, open in the pane, is drawn and marked (${JSON.stringify(open5)})`);
    await page.setViewportSize({ width: 390, height: 844 });

    // ---- 6. the Guest list ----
    console.log('6. the Guest list');
    await page.evaluate(() => settingsOpen('guests'));
    await page.waitForFunction(() => document.querySelectorAll('#gst-body .gst-item').length > 0, null, { timeout: 10000 });
    const g1 = await page.evaluate(() => ({
        items: document.querySelectorAll('#gst-body .gst-item').length,
        more: [...document.querySelectorAll('#gst-body .chb-more')].map((b) => b.textContent.trim()),
        details: [...document.querySelectorAll('#gst-body .gst-more')].filter((m) => m.children.length > 0).length,
        tile: ((document.querySelector('#gst-stats .gst-stat span') || {}).textContent || '').trim(),
    }));
    ok(g1.items < 120 && g1.more.length >= 1, `each group draws a page at a time (${g1.items} of 120 guests, ${g1.more.join(' / ')})`);
    ok(/120 guests/.test(g1.tile), `the figures cover every guest (${g1.tile})`);
    ok(g1.details === 0, `no guest's details are drawn while every row is closed (${g1.details})`);
    await page.evaluate(() => { const r = /** @type {HTMLElement|null} */ (document.querySelector('#gst-body .gst-row')); if (r) r.click(); });
    await page.waitForTimeout(200);
    const g2 = await page.evaluate(() => [...document.querySelectorAll('#gst-body .gst-more')].filter((m) => m.children.length > 0).length);
    ok(g2 === 1, `opening a row draws that guest's details, and only theirs (${g2})`);
    await page.evaluate(() => { const r = /** @type {HTMLElement|null} */ (document.querySelector('#gst-body .gst-item.is-open .gst-row')); if (r) r.click(); });
    await page.evaluate(() => { const i = /** @type {HTMLInputElement|null} */ (document.getElementById('gst-q')); if (i) { i.value = 'new guest 019'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.waitForTimeout(250);
    const g3 = await page.evaluate(() => [...document.querySelectorAll('#gst-body .gst-item')].map((r) => r.getAttribute('data-gemail')));
    ok(g3.length === 1 && g3[0] === 'n19@example.com', `a search finds a guest not drawn (${g3.join(', ')})`);
    await page.evaluate(() => { const i = /** @type {HTMLInputElement|null} */ (document.getElementById('gst-q')); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.waitForTimeout(250);
    const hidden = await page.evaluate(() => !document.querySelector('#gst-body [data-gemail="g99@example.com"]'));
    await page.evaluate(() => cmdkRevealGuest('g99@example.com'));
    await page.waitForFunction(() => !!document.querySelector('#gst-body [data-gemail="g99@example.com"]'), null, { timeout: 5000 }).catch(() => {});
    const g4 = await page.evaluate(() => !!document.querySelector('#gst-body [data-gemail="g99@example.com"]'));
    ok(hidden && g4, `search's "show this guest" draws one that was not drawn (hidden before: ${hidden}, drawn after: ${g4})`);

    // ---- 7. Payments ----
    // Its own business: 60 guests who have left with a £50 deposit still held, and 45 who
    // owe for a stay to come.
    console.log('7. Payments: the owed card and the deposits to return a page at a time');
    rows.length = 0;
    for (let i = 1; i <= 60; i++) rows.push(mk(700 + i, { name: 'Left Guest ' + pad(i), email: `l${i}@example.com`, check_in: d(-10 - 3 * i), check_out: d(-8 - 3 * i), hold_status: 'charged', hold_amount: 50 }));
    for (let i = 1; i <= 45; i++) rows.push(mk(800 + i, { name: 'Owing Guest ' + pad(i), email: `o${i}@example.com`, check_in: d(40 + 3 * i), check_out: d(42 + 3 * i), payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '' }));
    await page.evaluate(() => loadData());
    await page.waitForFunction(() => Object.values(dbBookings).reduce((s, l) => s + l.length, 0) === 105, null, { timeout: 10000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.evaluate(() => openAccounts());
    await page.waitForFunction(() => document.querySelectorAll('#pm-list .pm-orow').length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    // A list whose end is already within reach of the screen draws its next page by
    // itself (the owed card sits near the top of a phone), so the checks below hold for
    // whatever was drawn: whole pages of 20, never the whole list, and the button
    // counting the rest.
    const pmNow = () => page.evaluate(() => {
        const deps = [...document.querySelectorAll('#pm-list .pm-needrow')].filter((r) => /’s deposit/.test(r.textContent || ''));
        return {
            owed: document.querySelectorAll('#pm-coming .pm-orow').length,
            owedMore: ((document.querySelector('#pm-coming .chb-more') || {}).textContent || '').trim(),
            owedSub: ((document.querySelector('#pm-coming .pm-owe-top .pm-s') || {}).textContent || '').trim(),
            deps: deps.length,
            depMore: ((document.querySelector('#pm-list .pm-rows .chb-more') || {}).textContent || '').trim(),
            booksAfter: !!document.querySelector('#pm-list .pm-rows ~ *'),
        };
    });
    const m1 = await pmNow();
    const pageOf = (n, all, more) => n > 0 && n < all && n % 20 === 0 && new RegExp(`\\(${all - n}\\)`).test(more);
    ok(pageOf(m1.owed, 45, m1.owedMore), `the owed card draws whole pages of 20 of its 45 guests and says how many more (${m1.owed}, ${m1.owedMore})`);
    ok(/^45 guests/.test(m1.owedSub), `…and its count covers all 45 (${m1.owedSub})`);
    ok(pageOf(m1.deps, 60, m1.depMore), `Needs you draws whole pages of 20 of the 60 deposits to return and says how many more (${m1.deps}, ${m1.depMore})`);
    ok(m1.booksAfter, 'what comes after the list is drawn without waiting for the rest of it');
    await page.evaluate(() => { const b = /** @type {HTMLElement|null} */ (document.querySelector('#pm-coming .chb-more')); if (b) b.click(); });
    await page.waitForTimeout(150);
    const m2 = await pmNow();
    ok(m2.owed === Math.min(45, m1.owed + 20), `the owed card's button draws its next page (${m1.owed} → ${m2.owed})`);
    await page.evaluate(() => pmRender());
    await page.waitForTimeout(150);
    ok((await pmNow()).owed === m2.owed, 'a redraw of the page keeps the pages drawn');
    const d1 = (await pmNow()).deps;
    await page.evaluate(() => { const b = document.querySelector('#pm-list .pm-rows .chb-more'); if (b) b.scrollIntoView({ block: 'end' }); });
    await page.waitForFunction((n) => [...document.querySelectorAll('#pm-list .pm-needrow')].filter((r) => /’s deposit/.test(r.textContent || '')).length > n, d1, { timeout: 5000 }).catch(() => {});
    const d2 = (await pmNow()).deps;
    ok(d2 > d1, `scrolling to the end of the deposits draws the next page (${d1} → ${d2})`);

    console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
    await done(fails);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
