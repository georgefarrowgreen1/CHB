// UI gate for THE FRAME — the day spine + the rail (the approved redesign).
//
// The claims under test, each of which shipped broken in the prototype phase
// and was caught only by driving it:
//   §1 the spine carries the day onto every admin view EXCEPT the two that
//      already open with it (Today, AI chat), and its sentence IS cmdkDayLine
//      — equality of derivations, not a copied string;
//   §2 a duty chip wears the duty's OWN route (the strip's go attributes) and
//      really lands there; labels are escaped at the render boundary;
//   §3 at ≥1200 the rail replaces the header dock, its rows route, and every
//      count equals the derivation its surface already reads — the dock pip's
//      unseenEnquiries, the ops line's owed figure, the duty count;
//   §4 the handover is live CSS at the one boundary — resize down and the
//      dock returns byte-identical, resize up and the rail returns;
//   §5 the phone never meets the rail and the spine never overflows;
//   §6 the a11y floors the 390px a11y-test can never see at 1440 — every rail
//      row and spine chip ≥24px and named.
//
// Run: node ui-test-railspine.js   (or node ui-tests.js railspine)
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
    const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // ---- Fixtures. Money is asserted by EQUALITY between surfaces, never in
    // absolute pounds, so the booking shapes only need to map cleanly:
    // b1 arrives today paid (an arrival for the ops line), b2 arrives in five
    // days part-paid (a balance duty + the owed figure). The stale enquiry
    // carries a HOSTILE name so the escaping check cannot pass vacuously.
    const BOOKINGS = [
        { id: 501, prop_key: '21a', name: 'Wren Hollis', email: 'wren@x.co', phone: '07700 900001', address: '1 Quay St', postcode: 'NR25 7NA', check_in: d(0), check_out: d(3), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 468, payment_method: 'Square card', payment_date: d(-20), agreed_total: 468, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 2, agreed_txn_fee: 8, agreed_on: d(-30), hold_status: 'charged', hold_amount: 50, notes: '' },
        { id: 502, prop_key: '21a', name: 'Sarah Pemberton', email: 'sarah@x.co', phone: '07700 900002', address: '2 Quay St', postcode: 'NR25 7NB', check_in: d(5), check_out: d(8), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 147.5, payment_method: 'Square card', payment_date: d(-10), agreed_total: 667.5, agreed_per_night: 195, agreed_nights: 3, agreed_nightly: 585, agreed_booking_fee: 50, agreed_txn_pct: 2, agreed_txn_fee: 12.5, agreed_on: d(-12), hold_status: 'none', hold_amount: 0, notes: '' },
    ];
    const stamp = (n) => `${d(n)} 09:00:00`;
    const ENQ = [
        { id: 901, prop_key: '21a', name: "Priya O'Brien <b>x</b>", email: 'priya@x.co', phone: '', address: '', postcode: '', check_in: d(20), check_out: d(24), adults: 2, children: 0, message: 'Is there parking?', created_at: stamp(-3), seen_at: '', no_dogs_at: stamp(-3), terms_accepted_at: stamp(-3) },
        { id: 902, prop_key: '21a', name: 'Marcus Bell', email: 'marcus@x.co', phone: '', address: '', postcode: '', check_in: d(30), check_out: d(34), adults: 2, children: 0, message: 'Late checkout possible?', created_at: stamp(0), seen_at: '', no_dogs_at: stamp(0), terms_accepted_at: stamp(0) },
    ];
    const PROPS = [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 2, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }];

    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        let b = {};
        try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (url.includes('auth.php')) {
            if (b.action === 'admin_status') return json({ ok: true, admin: true });
            if (b.action === 'guest_status') return json({ ok: true, guest: null });
            return json({ ok: true });
        }
        if (url.includes('admin-bootstrap.php')) return json({ ok: true, cron: null, feeds: [], payoutTrouble: null, rates: null, bookings: { bookings: BOOKINGS }, enquiries: { enquiries: ENQ }, blocks: { ok: true, blocks: [] } });
        if (url.includes('bookings.php')) {
            if (b.action === 'email_logs') return json({ ok: true, logs: {} });
            if (b.action === 'history') return json({ ok: true, history: [] });
            if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [] });
            return json({ bookings: BOOKINGS });
        }
        if (url.includes('enquiries.php')) return json({ enquiries: ENQ });
        if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
        if (url.includes('accounts.php')) return json({ ok: true, years: [new Date().getFullYear()] });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], value: null, mine: {}, safes: {} });
    });

    await page.clock.setFixedTime((() => { const t = new Date(); t.setHours(12, 0, 0, 0); return t; })());
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(800);
    await page.evaluate(async () => { await openBookings(); });
    await page.waitForTimeout(1600);

    const painted = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; }, sel);
    const activeView = () => page.evaluate(() => { const v = document.querySelector('.page-view.active'); return v ? v.id : ''; });

    console.log('§1 the spine is the day, where the day is not already');
    ok(await activeView() === 'view-backoffice', 'the suite starts on Today');
    ok(!(await painted('#day-spine')), 'Today shows NO spine — Today IS the day (header line + strip)');
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(900);
    ok(await painted('#day-spine'), 'Payments carries the spine');
    ok(await page.evaluate(() => { const sp = document.getElementById('day-spine'); const av = document.querySelector('.page-view.active'); return !!sp && !!av && sp.parentElement === av && av.firstElementChild === sp; }), 'as the first child of the ACTIVE view, so it wears that view’s own container width');
    const eq = await page.evaluate(() => {
        const el = document.querySelector('#day-spine .spine-day');
        return { shown: el ? el.textContent : '', derived: cmdkDayLine() };
    });
    ok(!!eq.shown && eq.shown === eq.derived, `the sentence IS cmdkDayLine — one derivation ("${eq.shown}")`);
    ok(/1 arrival/.test(eq.shown) && /to collect/.test(eq.shown), `and it carries the day's shape (${eq.shown})`);
    await page.evaluate(() => openAiChat());
    await page.waitForTimeout(700);
    ok(await activeView() === 'view-aichat', 'the AI chat opens');
    ok(!(await painted('#day-spine')), 'the AI chat shows NO spine — its welcome card already opens the day (one statement, never two)');
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(700);
    ok(await painted('#day-spine'), 'and coming back, the spine is back');
    ok(await page.evaluate(() => !document.querySelector('#day-spine h1, #day-spine h2, #day-spine h3, #day-spine h4')), 'the spine carries NO heading — it must never sit above a view’s own h1 in the outline');

    console.log('§2 duty chips carry the duties’ own routes');
    const chips = await page.evaluate(() => ({
        n: document.querySelectorAll('#day-spine .spine-duty:not(.is-more)').length,
        more: (document.querySelector('#day-spine .spine-duty.is-more') || {}).textContent || '',
        first: (document.querySelector('#day-spine .spine-duty') || {}).textContent || '',
        firstLabel: (chbDuties()[0] || {}).label || '',
        duties: chbDuties().length,
    }));
    ok(chips.duties >= 3, `the fixture mints ${chips.duties} duties (2 enquiries + a balance)`);
    ok(chips.n === 2, `the spine shows exactly two chips (${chips.n})`);
    ok(/more/.test(chips.more), `the rest fold into “${chips.more.trim()}”`);
    ok(chips.first.includes(chips.firstLabel), 'chip one carries duty one’s own label');
    ok(await page.evaluate(() => !document.querySelector('#day-spine .spine-duty b')), 'a hostile guest name cannot inject markup — escaped at the render boundary');
    ok(await page.evaluate(() => (document.querySelector('#day-spine .spine-duty') || { textContent: '' }).textContent.includes("O'Brien")), 'and the name itself still reads');
    await page.click('#day-spine .spine-duty');
    await page.waitForTimeout(900);
    ok(await activeView() === 'view-enquiry-hub', 'tapping the enquiry chip lands on that enquiry’s hub — the duty’s own route, not a copy');
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(700);
    await page.click('#day-spine .spine-duty.is-more');
    await page.waitForTimeout(900);
    ok(await activeView() === 'view-backoffice', '“N more” lands on Today, where the full strip lives');

    console.log('§3 the rail at 1440 — live state beside every destination');
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.waitForTimeout(400);
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(700);
    ok(await painted('#admin-rail'), 'the rail is painted at 1440');
    ok(await page.evaluate(() => [...document.querySelectorAll('.admin-dock-btn')].every((b) => b.offsetParent === null)), 'and the header dock stands down — one nav at a time');
    ok(!(await painted('header')), 'the HEADER stands down with it — the prototype has no top bar on rail screens');
    ok(await painted('#admin-rail .rail-brand'), 'so the rail carries the brand');
    await page.click('#rail-ask');
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => { const c = document.getElementById('cmdk'); return !!c && c.classList.contains('open'); }), 'the Ask pill opens the assistant — the hidden crown’s job, handed over');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => { const c = document.getElementById('cmdk'); return !c || !c.classList.contains('open'); }), 'Escape closes it');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'rail-ask'), 'and focus comes back to the Ask pill, since the crown is not on screen');
    const themed = await page.evaluate(() => {
        const before = document.body.classList.contains('light-mode');
        const t = document.querySelector('#admin-rail .rail-theme');
        if (t) /** @type {HTMLElement} */ (t).click();
        const after = document.body.classList.contains('light-mode');
        if (t) /** @type {HTMLElement} */ (t).click();
        return before !== after;
    });
    ok(themed, 'the theme row really flips the theme (and back)');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#admin-rail .rail-row')].map((r) => (r.querySelector('.rail-lbl') || {}).textContent || ''));
    ok(rows.length === 7 && rows.join('|') === 'Today|Inbox|AI chat|Payments|Cottages|Key safes|Manage', `seven destinations (${rows.join(' · ')})`);
    ok(await page.evaluate(() => { const r = document.querySelector('#admin-rail .rail-row[data-view="view-accounts"]'); return !!r && r.getAttribute('aria-current') === 'page'; }), 'Payments is current while Payments is open');
    const counts = await page.evaluate(() => ({
        inbox: (document.getElementById('rail-cnt-inbox') || {}).textContent || '',
        inboxDerived: String(unseenEnquiries()),
        money: (document.getElementById('rail-cnt-money') || {}).textContent || '',
        moneyDerived: '£' + Math.round(chbOpsParts(chbDayTuples()).owed).toLocaleString('en-GB'),
        today: (document.getElementById('rail-cnt-today') || {}).textContent || '',
        todayDerived: String(chbDuties().length),
    }));
    ok(counts.inbox === counts.inboxDerived && counts.inbox !== '', `the Inbox count IS the dock pip's number (${counts.inbox})`);
    ok(counts.money === counts.moneyDerived && counts.money !== '', `the Payments figure IS the ops line's owed derivation (${counts.money})`);
    ok(counts.today === counts.todayDerived && counts.today !== '', `the Today count IS the duty count (${counts.today})`);
    await page.click('#admin-rail .rail-row[data-view="view-backoffice"]');
    await page.waitForTimeout(900);
    ok(await activeView() === 'view-backoffice', 'the Today row routes');
    ok(await page.evaluate(() => { const r = document.querySelector('#admin-rail .rail-row[data-view="view-backoffice"]'); return !!r && r.getAttribute('aria-current') === 'page'; }), 'and takes the current mark with it');
    await page.click('#admin-rail .rail-row[data-rail="cottages"]');
    await page.waitForTimeout(900);
    const cot = await page.evaluate(() => ({
        view: (document.querySelector('.page-view.active') || {}).id,
        sec: (() => { const s = document.getElementById('sec-accom'); return !!s && s.getClientRects().length > 0; })(),
        cur: (document.querySelector('#admin-rail .rail-row[data-rail="cottages"]') || {}).getAttribute ? document.querySelector('#admin-rail .rail-row[data-rail="cottages"]').getAttribute('aria-current') : null,
        manageCur: document.querySelector('#admin-rail .rail-row[data-view="view-settings"]').getAttribute('aria-current'),
    }));
    ok(cot.view === 'view-settings' && cot.sec, 'Cottages opens the cottage list (Manage’s accom section, promoted)');
    ok(cot.cur === 'page' && cot.manageCur !== 'page', 'and Cottages — not Manage — is current, judged on the PAINT of the section');
    await page.click('#admin-rail .rail-row[data-view="view-settings"]');
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => { const m = document.querySelector('#admin-rail .rail-row[data-view="view-settings"]'); const c = document.querySelector('#admin-rail .rail-row[data-rail="cottages"]'); return m.getAttribute('aria-current') === 'page' && c.getAttribute('aria-current') !== 'page'; }), 'the Manage row takes it back at the index');
    for (const [sel, view] of [['[data-view="view-inbox"]', 'view-inbox'], ['[data-view="view-keysafe"]', 'view-keysafe'], ['[data-view="view-aichat"]', 'view-aichat']]) {
        await page.click(`#admin-rail .rail-row${sel}`);
        await page.waitForTimeout(700);
        ok(await activeView() === view, `${view} routes from the rail`);
    }

    console.log('§4 the handover is live at the one boundary — and the boundary is 1440');
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(400);
    ok(!(await painted('#admin-rail')), 'below the boundary the rail is gone');
    ok(await page.evaluate(() => [...document.querySelectorAll('.admin-dock-btn')].filter((b) => b.offsetParent !== null).length >= 4), 'and the header dock is back, byte-identical — the folded rail IS the dock');
    // 1280 is the prototype's FOLD: an icon rail, because the ≥1200 two-pane
    // layouts need the width back (measured: a 220px rail left the Inbox
    // reading pane ~330px; the 64px fold leaves ~530). Labels hide, so the
    // accessible names must ride aria-label — asserted here because a
    // display:none label contributes nothing to name computation.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);
    const fold = await page.evaluate(() => {
        const r = document.getElementById('admin-rail');
        const b = r ? r.getBoundingClientRect() : { width: 0 };
        return {
            painted: !!r && r.getClientRects().length > 0,
            width: Math.round(b.width),
            labelsHidden: [...document.querySelectorAll('#admin-rail .rail-row .rail-lbl')].every((l) => l.getClientRects().length === 0),
            named: [...document.querySelectorAll('#admin-rail .rail-row')].every((x) => (x.getAttribute('aria-label') || '').length > 0),
            dockGone: [...document.querySelectorAll('.admin-dock-btn')].every((x) => x.offsetParent === null),
        };
    });
    ok(fold.painted && fold.width < 100, `at 1280 the rail FOLDS to icons (${fold.width}px) — the prototype's own answer to the two-pane widths`);
    ok(fold.labelsHidden && fold.named, 'folded, the labels hide but every row keeps its accessible name');
    ok(fold.dockGone, 'and the dock stays down — one nav at a time');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const r = document.getElementById('admin-rail'); return !!r && r.getBoundingClientRect().width > 180; }), 'at 1440 it unfolds to labels and counts — matchMedia drives the classes, a live resize cannot leave them stale');
    // A signed-in admin has no customer-facing site — nav() bounces every
    // public view to the back office — EXCEPT view-pay, which is deliberately
    // let through (an admin settling on a guest's behalf, or testing a link on
    // staging). That page is a GUEST page and must render as one: unshifted,
    // no rail beside it. The .admin-screen half of the rail's CSS pair is what
    // guards it. (The first draft of this check nav'd to view-experiences and
    // silently measured the back office again — the redirect ate it.)
    await page.evaluate(() => nav('view-pay'));
    await page.waitForTimeout(500);
    ok(await activeView() === 'view-pay', 'the pay page is the one customer view an admin reaches');
    ok(!(await painted('#admin-rail')), 'and the rail stands down beside it — a guest page renders as a guest page');
    ok(await painted('header'), 'with the header back above it, exactly as a guest gets it');
    // CENTRED, not left-anchored: a computed margin-left is the wrong probe —
    // the base .container's `margin: 0 auto` resolves to 120px at 1440, so a
    // threshold on the margin fails a perfectly centred page. The rail-shifted
    // layout is LEFT-ANCHORED (left ≈ 244); a guest page is symmetric.
    ok(await page.evaluate(() => {
        const m = document.querySelector('main.container.page-view.active');
        if (!m) return true;
        const r = m.getBoundingClientRect();
        return Math.abs(r.left - (window.innerWidth - r.width) / 2) < 3;
    }), 'and the page sits centred — not left-anchored beside a rail that is not there');
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(700);
    ok(await painted('#admin-rail'), 'back on an admin screen, the rail is back');

    console.log('§5 the phone');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(700);
    ok(!(await painted('#admin-rail')), 'no rail at 390');
    ok(await painted('#day-spine'), 'the spine is there');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'and the page never scrolls sideways');

    console.log('§7 the spine condenses on scroll — the prototype’s head, hysteresis and all');
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await openArea(); });
    await page.waitForTimeout(800);
    const tall = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    ok(tall > 200, `the Manage index overflows enough to scroll (${tall}px)`);
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('day-spine').classList.contains('spine-cond')), 'scrolled past 120, the spine condenses to one line + the count');
    ok(await page.evaluate(() => { const c = document.querySelector('#day-spine .spine-cnt'); return !!c && c.getClientRects().length > 0; }), 'and the count pill is painted in its place');
    // No flapping: hold the scroll and sample twice — the hysteresis dead zone
    // is what stops condense→reclaim→expand oscillation (measured in the
    // prototype at 1440×620 before the dead zone existed).
    await page.waitForTimeout(350);
    const stable = await page.evaluate(() => document.getElementById('day-spine').classList.contains('spine-cond'));
    ok(stable, 'and it HOLDS — no condense/expand flap');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.getElementById('day-spine').classList.contains('spine-cond')), 'back under 40, it expands again');
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await openAccounts(); });
    await page.waitForTimeout(500);

    console.log('§6 the floors the 390px a11y sweep can never see at 1440');
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.waitForTimeout(400);
    const floors = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('#admin-rail .rail-row, #day-spine .spine-duty').forEach((el) => {
            const b = el.getBoundingClientRect();
            if (b.width && b.height && (b.width < 24 || b.height < 24)) bad.push(`${el.className} ${Math.round(b.width)}×${Math.round(b.height)}`);
            if (!(el.textContent || '').trim()) bad.push(`${el.className} unnamed`);
        });
        return bad;
    });
    ok(floors.length === 0, `every rail row and spine chip is ≥24px and named${floors.length ? ' — ' + floors.join(', ') : ''}`);

    if (errs.length) { console.log('  PAGE ERRORS:\n  ' + errs.join('\n  ')); fails += errs.length; }
    console.log(fails ? `RAILSPINE TEST FAILED ❌ (${fails})` : 'RAILSPINE TEST PASSED ✅');
    await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
