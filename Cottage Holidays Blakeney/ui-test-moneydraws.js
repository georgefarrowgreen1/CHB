// THE BACK OFFICE STOPS REDOING ITS SUMS (CLAUDE.md "The back office stops redoing five
// years of sums"), driven in a browser with every answer's timing in the suite's hands:
//  1. opening Payments draws its list twice: the held copy at once, then the page's
//     answers together (it drew five to seven times, once per answer)
//  2. a second visit with nothing changed rewrites nothing (a list drawn the same as it
//     stands is not drawn again), and a slow answer about returned deposits does not
//     make the opening ask for the summary twice
//  3. a change to the returned deposits is drawn at once, before the summary lands, also
//     when Today's own read of them lands between the page's draw and the page's read
//  4. a side answer later than the summary draws itself
//  5. a summary slower than PM_BATCH_WAIT does not hold the others back, draws itself
//     when it lands, and a caller awaiting the load still gets its answer
//  6. a booking's money is worked out once per load, not once per question
//  7. Today at rest with a guest staying does no style work (the "here now" pulse is a
//     layer the compositor runs), and both pulses animate only transform and opacity
const { d, bootVerdict, boot } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    const mk = (id, over = {}) => Object.assign({
        id, prop_key: '21a', name: 'Guest ' + id, email: `g${id}@example.com`, phone: '', address: '1 Lane',
        postcode: 'NR25 7AB', check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00',
        adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
        agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '',
    }, over);
    const rows = [
        mk(1, { name: 'Owes Money' }),
        // Left three days ago with £100 still held: a deposit to return.
        mk(2, { name: 'Left Deposit', check_in: d(-6), check_out: d(-3), payment: 'paid', deposit_paid: 540, payment_method: 'Card', payment_date: d(-30), hold_status: 'charged', hold_amount: 100 }),
        // In the cottage now: Today's "Staying" chip with its pulse.
        mk(3, { name: 'Staying Now', check_in: d(-1), check_out: d(2), payment: 'paid', deposit_paid: 490, payment_method: 'Card', payment_date: d(-20), hold_status: 'charged', hold_amount: 50 }),
    ];
    const TY = d(0) < `${new Date().getFullYear()}-04-06` ? new Date().getFullYear() - 1 : new Date().getFullYear();
    const books = (profit) => ({ year: TY, income: 656.2, kept: 50, fees: 9.8, expenses: 120, profit, quarters: [0, 706.2, 0, 0], by_category: [], undated: { count: 0, total: 0, held: 0 } });
    const POS = { with_square: 0, with_square_count: 0, unknown: 0, unreported: 0, unreported_count: 0, next_arrival: '', in_bank: 0, ready: 0, held: 0, last_moved: 0, error: false, checked: 0, payout_error: null, failed: [], disputes: null, bank: '' };
    // What each answer says and how long it takes to arrive; the cases below set them.
    // returnsQ: the delays of the next returns answers, in the order they are asked for.
    const S = { summaryMs: 300, bankMs: 80, splitMs: 120, returnsMs: 30, returnsQ: [], profit: 576.4, bank: 1234.56, returns: {} };
    const asked = { summary: 0, bank: 0, split: 0 };
    const answered = { summary: 0 };
    const later = (ms) => new Promise((r) => setTimeout(r, ms));
    await page.route(/\.php/, async (route) => {
        const req = route.request();
        const url = req.url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'POST') {
            const b = JSON.parse(req.postData() || '{}');
            const ep = url.split('/').pop().split('?')[0];
            if (ep === 'money.php' && b.action === 'summary') {
                asked.summary++;
                const ms = S.summaryMs;
                const body = { ok: true, at: Math.floor(Date.now() / 1000), position: POS, bank_items: [], way_items: [], moved_map: {}, landed_map: {}, books: books(S.profit), years: [TY], activity: [] };
                await later(ms);
                answered.summary++;
                return json(body);
            }
            if (ep === 'statements.php' && b.action === 'status') {
                asked.bank++;
                const body = { ok: true, ready: true, on: true, balance: S.bank, balance_at: d(-1), lines: [], learned: {}, live: { state: 'off' } };
                await later(S.bankMs);
                return json(body);
            }
            if (ep === 'split.php' && b.action === 'status') {
                asked.split++;
                await later(S.splitMs);
                return json({ ok: true, on: false });
            }
            if (ep === 'bookings.php' && b.action === 'deposit_returns') {
                const body = { returns: Object.assign({}, S.returns) };
                await later(S.returnsQ.length ? S.returnsQ.shift() : S.returnsMs);
                return json(body);
            }
            if (ep === 'money.php') return json({ ok: true, events: [], activity: [], books: books(S.profit) });
            return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], threads: [], expenses: [] });
        }
        if (url.includes('bookings.php')) return json({ bookings: rows });
        if (url.includes('expenses.php')) return json({ ok: true, expenses: [] });
        if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
        return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await bootVerdict(page);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForFunction(() => /** @type {any} */ (window).__ADMIN_LOADED === true && !!document.getElementById('pm-list'), null, { timeout: 15000 });
    await page.evaluate(() => loadData());
    await page.waitForFunction(() => Object.values(dbBookings).reduce((s, l) => s + l.length, 0) === 3, null, { timeout: 10000 });

    // Every write of the Payments list: pmRenderList replaces its children in one go, so
    // one childList record on #pm-list is one draw.
    await page.evaluate(() => {
        const W = /** @type {any} */ (window);
        W.__writes = 0;
        new MutationObserver((recs) => { if (recs.some((r) => r.target.id === 'pm-list' && (r.addedNodes.length || r.removedNodes.length))) W.__writes++; })
            .observe(document.getElementById('pm-list'), { childList: true });
    });
    const writes = () => page.evaluate(() => /** @type {any} */ (window).__writes);
    const zero = () => page.evaluate(() => { /** @type {any} */ (window).__writes = 0; });
    const shown = () => page.evaluate(() => ({
        books: ((document.querySelector('#pm-list .pm-books-top b') || {}).textContent || '').trim(),
        bank: ((document.querySelector('#pm-list [data-fig="bank"]') || {}).textContent || '').trim(),
        deposit: [...document.querySelectorAll('#pm-list .pm-rows > *')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Left Deposit/.test(t)).join(' | '),
    }));
    const settle = async () => {
        // Nothing of the page's load left to land: both answers in and the batch drawn.
        await page.waitForFunction(() => /** @type {any} */ (window).__pmIdle === true, null, { timeout: 15000 }).catch(() => {});
        await later(400);
    };
    // pmLoad's own completion, read from outside: the stamp it took and the promise it returns.
    await page.evaluate(() => {
        const W = /** @type {any} */ (window);
        const real = W.pmLoad;
        W.pmLoad = function (...a) {
            W.__pmIdle = false;
            const p = real.apply(this, a);
            W.__pmLast = p;
            Promise.resolve(p).finally(() => { if (W.__pmLast === p) W.__pmIdle = true; });
            return p;
        };
    });

    // ---- 1. one draw for the page's answers ----
    console.log('1. opening Payments draws the held copy, then its answers together');
    await zero();
    await page.evaluate(() => openAccounts());
    await settle();
    const w1 = await writes();
    const s1 = await shown();
    ok(w1 === 2, `the list was written twice: the held copy, then the answers together (${w1}; it was once per answer)`);
    ok(s1.books === '£576.40' && s1.bank === '£1,234.56', `…and that one draw carries the summary and the bank (books ${s1.books}, bank ${s1.bank})`);
    ok(asked.summary === 1 && asked.bank === 1 && asked.split === 1, `…each answer asked for once (summary ${asked.summary}, bank ${asked.bank}, split ${asked.split})`);

    // ---- 2. nothing changed: nothing rewritten ----
    console.log('2. a second visit with nothing changed rewrites nothing');
    await page.evaluate(() => nav('view-backoffice'));
    await later(300);
    await zero();
    await page.evaluate(() => openAccounts());
    await settle();
    const w2 = await writes();
    ok(w2 === 0, `the list was not rewritten (${w2} writes)`);
    ok((await shown()).books === '£576.40', 'and still shows the books');

    // ---- 2b. a slow answer about returns does not ask for the summary twice ----
    console.log('2b. a slow returned-deposits answer asks for the summary once');
    await page.evaluate(() => nav('view-backoffice'));
    await later(300);
    S.returnsMs = 700; // longer than the refresh's 200ms wait
    const sum2b = asked.summary;
    await page.evaluate(() => openAccounts());
    await settle();
    ok(asked.summary - sum2b === 1, `one opening asked for the summary once (${asked.summary - sum2b}; a second refresh after the returns asked twice)`);
    S.returnsMs = 30;

    // ---- 3. the returned deposits changed: drawn at once ----
    console.log('3. a change to the returned deposits is drawn at once');
    const before3 = (await shown()).deposit;
    await page.evaluate(() => nav('view-backoffice'));
    await later(300);
    S.returns = { 2: 40 };
    S.summaryMs = 2500;
    await zero();
    const sumAsked3 = asked.summary;
    const sumAnswered3 = answered.summary;
    await page.evaluate(() => { openAccounts(); });
    await page.waitForFunction(() => /** @type {any} */ (window).__writes >= 1 && /Left Deposit/.test((document.getElementById('pm-list') || {}).textContent || '') && /£60/.test([...document.querySelectorAll('#pm-list .pm-rows > *')].map((e) => e.textContent).filter((t) => /Left Deposit/.test(t)).join(' ')), null, { timeout: 2000 }).catch(() => {});
    const early3 = await shown();
    const sumEarly3 = answered.summary - sumAnswered3;
    ok(/£60/.test(early3.deposit) && !/£100/.test(early3.deposit), `the deposit row says what is still held (£60) before the summary lands (${early3.deposit || 'no row'}; was ${before3})`);
    await settle();
    ok(sumEarly3 === 0 && asked.summary - sumAsked3 === 1, `…drawn while the summary was still unanswered, and asked for once on this visit (${sumEarly3} answered by then, ${asked.summary - sumAsked3} asked)`);

    // ---- 3b. Today's own read of the returns lands between the draw and the page's read ----
    // The page draws from the held map, Today's read (asked a moment earlier) brings the new
    // one, and the page's own read then brings the same: compared with the map at the time
    // of its answer, nothing changed, and the row stayed at the figure it was drawn with.
    console.log('3b. a change Today read first is still drawn');
    await page.evaluate(() => nav('view-backoffice'));
    await later(600);
    S.returns = { 2: 70 };
    S.returnsQ = [150, 700];
    await zero();
    const sumAnswered3b = answered.summary;
    await page.evaluate(() => { loadDepositReturns(); openAccounts(); });
    await page.waitForFunction(() => /£30/.test([...document.querySelectorAll('#pm-list .pm-rows > *')].map((e) => e.textContent).filter((t) => /Left Deposit/.test(t)).join(' ')), null, { timeout: 1600 }).catch(() => {});
    const early3b = await shown();
    const sumEarly3b = answered.summary - sumAnswered3b;
    ok(/£30/.test(early3b.deposit) && !/£60/.test(early3b.deposit), `the deposit row says £30 is still held, though Today read the change first (${early3b.deposit || 'no row'})`);
    ok(sumEarly3b === 0, `…before the summary landed (${sumEarly3b} answered by then)`);
    await settle();
    S.returnsQ = [];
    S.summaryMs = 300;

    // ---- 4. a late side answer draws itself ----
    console.log('4. a bank answer later than the summary draws itself');
    await page.evaluate(() => nav('view-backoffice'));
    await later(300);
    S.bank = 2222.22;
    S.bankMs = 2600;
    S.profit = 601.1;
    await zero();
    await page.evaluate(() => { openAccounts(); });
    await page.waitForFunction(() => ((document.querySelector('#pm-list .pm-books-top b') || {}).textContent || '').trim() === '£601.10', null, { timeout: 4000 }).catch(() => {});
    const mid4 = await shown();
    ok(mid4.books === '£601.10' && mid4.bank === '£1,234.56', `the summary was drawn without waiting for the bank (books ${mid4.books}, bank still ${mid4.bank})`);
    await page.waitForFunction(() => ((document.querySelector('#pm-list [data-fig="bank"]') || {}).textContent || '').trim() === '£2,222.22', null, { timeout: 5000 }).catch(() => {});
    const end4 = await shown();
    ok(end4.bank === '£2,222.22', `…and the bank's answer drew itself when it landed (${end4.bank})`);
    await settle();
    S.bankMs = 80;

    // ---- 5. a slow summary does not hold the others back ----
    console.log('5. a summary slower than PM_BATCH_WAIT');
    await page.evaluate(() => nav('view-backoffice'));
    await later(300);
    S.summaryMs = 6000;
    S.bank = 3333.33;
    S.profit = 777.7;
    await zero();
    await page.evaluate(() => { /** @type {any} */ (window).__awaited = null; openAccounts(); });
    // The page's own load, awaited the way the expense sheet awaits pmLoad.
    await page.waitForFunction(() => /** @type {any} */ (window).__pmIdle === false, null, { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => {
        const W = /** @type {any} */ (window);
        Promise.resolve(W.__pmLast).then(() => { W.__awaited = __pm && __pm.books ? __pm.books.profit : 'none'; });
    });
    await later(4700);
    const mid5 = await shown();
    const aw5a = await page.evaluate(() => /** @type {any} */ (window).__awaited);
    ok(mid5.bank === '£3,333.33' && mid5.books !== '£777.70', `after PM_BATCH_WAIT the bank is drawn and the summary is not yet (bank ${mid5.bank}, books ${mid5.books})`);
    ok(aw5a === null, `…and a caller awaiting the load is still waiting for the summary (${aw5a})`);
    await page.waitForFunction(() => ((document.querySelector('#pm-list .pm-books-top b') || {}).textContent || '').trim() === '£777.70', null, { timeout: 6000 }).catch(() => {});
    ok((await shown()).books === '£777.70', 'the summary drew itself when it landed');
    await page.waitForFunction(() => /** @type {any} */ (window).__awaited !== null, null, { timeout: 4000 }).catch(() => {});
    const aw5b = await page.evaluate(() => /** @type {any} */ (window).__awaited);
    ok(aw5b === 777.7, `…and the awaiting caller read the summary's answer (${aw5b})`);
    await settle();
    S.summaryMs = 300;

    // ---- 6. a booking's money is worked out once per load ----
    console.log('6. a booking\'s money is worked out once per load');
    const money = await page.evaluate(async () => {
        const W = /** @type {any} */ (window);
        await loadData(); // a load: every booking is a fresh record with nothing kept beside it
        const n = { due: 0, ps: 0, held: 0 };
        const wrap = (name, k) => { const f = W[name]; W[name] = function (...a) { n[k]++; return f.apply(this, a); }; return () => { W[name] = f; }; };
        const undo = [wrap('bookingDueNow', 'due'), wrap('paymentSummaryNow', 'ps'), wrap('damageHeldNow', 'held')];
        for (let i = 0; i < 3; i++) { renderNeedsYou(); renderBookings(); pmRender(); }
        const first = Object.assign({}, n);
        n.due = n.ps = n.held = 0;
        for (let i = 0; i < 3; i++) { renderNeedsYou(); renderBookings(); pmRender(); }
        const again = Object.assign({}, n);
        undo.forEach((f) => f());
        return { first, again, bookings: Object.values(dbBookings).reduce((s, l) => s + l.length, 0) };
    });
    ok(money.first.due >= 1 && money.first.due <= money.bookings && money.first.ps <= money.bookings && money.first.held <= money.bookings,
        `three renders of Today and Payments worked each booking out at most once (due ${money.first.due}, summary ${money.first.ps}, held ${money.first.held} for ${money.bookings} bookings)`);
    ok(money.again.due === 0 && money.again.ps === 0 && money.again.held === 0, `…and three more worked out nothing (${JSON.stringify(money.again)})`);

    // ---- 7. Today at rest ----
    console.log('7. Today at rest with a guest staying');
    await page.evaluate(() => { nav('view-backoffice'); initBackOffice(); });
    await page.waitForFunction(() => !!document.querySelector('#bookings-list .bk-chip.stay'), null, { timeout: 10000 }).catch(() => {});
    const hasStay = await page.evaluate(() => !!document.querySelector('#bookings-list .bk-chip.stay .bk-dot'));
    ok(hasStay, 'Today lists the staying guest with the "Staying" chip');
    await later(2500); // past the arrival animation
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const a7 = await m();
    await later(2000);
    const b7 = await m();
    const recalcs = Math.round(b7.RecalcStyleCount - a7.RecalcStyleCount);
    ok(recalcs <= 4, `two seconds at rest restyled the page ${recalcs} time(s) (a box-shadow pulse restyles it every frame)`);
    const kf = await page.evaluate(() => {
        const out = {};
        for (const sh of [...document.styleSheets]) {
            let rules = [];
            try { rules = [...sh.cssRules]; } catch (e) { continue; }
            const walk = (list) => list.forEach((r) => {
                if (r instanceof CSSKeyframesRule && (r.name === 'bkStayPulse' || r.name === 'alPulse')) {
                    const props = new Set();
                    [...r.cssRules].forEach((k) => { for (let i = 0; i < k.style.length; i++) props.add(k.style[i]); });
                    out[r.name] = [...props].sort();
                } else if (r.cssRules && r.cssRules.length) walk([...r.cssRules]);
            });
            walk(rules);
        }
        return out;
    });
    const onlyComposited = (p) => Array.isArray(p) && p.length > 0 && p.every((x) => x === 'transform' || x === 'opacity');
    ok(onlyComposited(kf.bkStayPulse), `the "Staying" pulse animates only transform and opacity (${JSON.stringify(kf.bkStayPulse)})`);
    ok(onlyComposited(kf.alPulse), `the activity log's pulse likewise (${JSON.stringify(kf.alPulse)})`);

    console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
    await done(fails);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
