// POOR SIGNAL: tapping an admin page must OPEN IT, slowly if need be — never
// leave the owner on the page they were trying to leave, and never move them
// somewhere they didn't ask to go.
//
// Reported from a phone on a weak connection: "I click on a page and if the
// signal is poor it reverts me to an old page and doesn't slow load the new
// page." Two separate causes, both reproduced here against a stalled route:
//
//  1. ORDERING — openAccounts()/openBookings() awaited their fetch BEFORE
//     navigating, so the tap did nothing for the length of the request and, on
//     a dropped one, threw an alert and left the owner where they started.
//  2. DESTRUCTIVE FAILURE — loadData() emptied dbBookings/enquiries/dbBlocks in
//     its catch, so ONE dropped request wiped the owner's data out of memory.
//     Everything then rendered as though the business had no bookings, and a
//     tapped booking was reported "no longer here" before bouncing them off it.
//     That second one is the "reverts me to an old page" they actually saw.
//
// The stall ABORTS after a delay, which is what a dead mobile link does — not a
// 500, which the app already handles. Every check below break-tests: revert the
// matching hunk and it fails.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 900, height: 800 } });

    const booking = {
        id: 1, prop_key: '21a', name: 'First Guest', email: 'g@example.com', phone: '', address: '1 Lane',
        postcode: 'NR25 7AB', check_in: d(5), check_out: d(8), check_in_time: '15:00', check_out_time: '10:00',
        adults: 2, children: 0, payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '',
        agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
    };
    const enquiry = { id: 9, prop_key: '21a', name: 'Jane Doe', email: 'j@example.com', phone: '', check_in: d(30), check_out: d(33), adults: 2, children: 0, message: 'Any room?', status: 'pending', created_at: d(0) };

    // The signal switch. When on, the data endpoints hang then drop.
    let stall = false;
    // Widened only for the later sections: content.php and expenses.php are not
    // part of the navigation story above, and stalling them from the start would
    // starve the boot.
    let stallMore = false;
    await page.route(/\.php/, async (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (stall && stallMore && /(expenses|content)\.php/.test(url)) {
            await new Promise((r) => setTimeout(r, 800));
            return route.abort('failed');
        }
        if (stall && /(bookings|accounts|enquiries|admin-bootstrap|ical-import)\.php/.test(url)) {
            await new Promise((r) => setTimeout(r, 8000));
            return route.abort('failed');
        }
        if (route.request().method() === 'POST' && !/ical-import/.test(url)) return json({ ok: true, events: [], logs: {} });
        if (url.includes('bookings.php')) return json({ bookings: [booking] });
        if (url.includes('enquiries.php')) return json({ enquiries: [enquiry] });
        if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
        return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
    });

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1300);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(700);
    await page.evaluate(async () => { nav('view-backoffice'); await initBackOffice(); });
    await page.waitForTimeout(1200);

    const view = () => page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
    const loaded = await page.evaluate(() => Object.values(dbBookings).flat().length);
    ok((await view()) === 'view-backoffice' && loaded === 1, `the back office is up with its data (${loaded} booking)`);

    // ── 1. A dropped refresh must not DESTROY what we already have ──────────
    // This is the root cause: with the store wiped, every screen renders empty
    // and the record the owner just tapped genuinely isn't there any more.
    stall = true;
    const after = await page.evaluate(async () => {
        const r = await loadData();
        return { kept: Object.values(dbBookings).flat().length, enq: enquiries.length, report: r };
    });
    ok(after.kept === 1, `a dropped refresh KEEPS the bookings it already had (${after.kept} of 1)`);
    ok(after.enq === 1, `…and the enquiries (${after.enq} of 1)`);
    ok(!!after.report && after.report.ok === false, 'loadData REPORTS the failure rather than throwing (it never rejects)');
    ok(!!after.report && after.report.failed.includes('bookings'), `…and names what failed (${after.report && after.report.failed.join(',')})`);

    // ── 2. Tapping Payments lands on Payments, at once ──────────────────────
    // Not after the request: the year list is a dropdown ON the page, never
    // permission to show it.
    await page.evaluate(() => { window.openAccounts(); });
    await page.waitForTimeout(600); // far inside the 8s stall
    const early = await view();
    ok(early === 'view-accounts', `Payments opens IMMEDIATELY on a stalled link, not after it (${early})`);
    await page.waitForTimeout(8200); // let the dropped request land
    const settled = await page.evaluate(() => ({
        v: (document.querySelector('.page-view.active') || {}).id,
        blocking: !!document.querySelector('#glass-dialog.open'),
    }));
    ok(settled.v === 'view-accounts', `…and the failure does not throw them back (${settled.v})`);
    ok(!settled.blocking, 'no blocking alert stands between the owner and the page');

    // ── 3. A booking tap on a dead link: honest, and STAYS PUT ──────────────
    await page.evaluate(() => { nav('view-backoffice'); });
    await page.waitForTimeout(200);
    const hub = await page.evaluate(async () => {
        Object.keys(dbBookings).forEach((k) => { dbBookings[k] = []; }); // not in memory yet
        document.querySelectorAll('.toast').forEach((t) => t.remove());
        await window.openBookingHub(1);
        const t = document.querySelector('.toast');
        return {
            v: (document.querySelector('.page-view.active') || {}).id,
            msg: t ? (t.querySelector('.toast-body span') || {}).textContent || '' : '',
            retry: t ? (t.querySelector('.toast-action') || {}).textContent || '' : '',
        };
    });
    ok(!/no longer here/i.test(hub.msg), `a dropped request is not reported as a deleted booking ("${hub.msg}")`);
    ok(/connection/i.test(hub.msg), '…it says what actually happened');
    ok(hub.retry === 'Retry', `…and offers a way through (${hub.retry || 'nothing'})`);
    ok(hub.v === 'view-backoffice', `…without moving them anywhere (${hub.v})`);

    // ── 4. Same rule for an enquiry ─────────────────────────────────────────
    const enqHub = await page.evaluate(async () => {
        enquiries = [];
        document.querySelectorAll('.toast').forEach((t) => t.remove());
        await window.openEnquiryHub(9);
        const t = document.querySelector('.toast');
        return { v: (document.querySelector('.page-view.active') || {}).id, msg: t ? (t.querySelector('.toast-body span') || {}).textContent || '' : '' };
    });
    ok(!/no longer here/i.test(enqHub.msg) && /connection/i.test(enqHub.msg), `an enquiry is not declared gone on a dropped request ("${enqHub.msg}")`);
    ok(enqHub.v === 'view-backoffice', `…and the owner stays where they were (${enqHub.v})`);

    // ── 5. Bookings lands at once too ───────────────────────────────────────
    await page.evaluate(() => { nav('view-inbox'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.openBookings(); });
    await page.waitForTimeout(600);
    const bk = await view();
    ok(bk === 'view-backoffice', `Bookings opens immediately on a stalled link (${bk})`);

    // ── 6. And with a GOOD signal nothing above changed the happy path ──────
    stall = false;
    const good = await page.evaluate(async () => {
        const r = await loadData();
        return { ok: r && r.ok, n: Object.values(dbBookings).flat().length };
    });
    ok(good.ok === true && good.n === 1, `on a good link loadData reports ok and refills (${good.n} booking)`);
    const backOk = await page.evaluate(async () => { await window.openBookingHub(1); return (document.querySelector('.page-view.active') || {}).id; });
    ok(backOk === 'view-booking-hub' || backOk === 'view-backoffice', `…and a booking still opens normally (${backOk})`);

    // ── 7. The same rule, everywhere else that caches server data ───────────
    // Found by auditing for the loadData shape. Each of these emptied its own
    // store in the catch, and each lie is different: expenses at zero make the
    // net-profit headline too HIGH, an empty email log invites sending a guest
    // the same email twice, and empty deposit-returns make a PARTIALLY returned
    // damage deposit reappear as a full one to hand back.
    stall = true;
    stallMore = true;
    const stores = await page.evaluate(async () => {
        allExpenses = [{ id: 1, amount: 120, date: '2026-05-01', note: 'seed' }];
        bookingEmailLogs = { 1: [{ action: 'confirmation', at: '2026-05-01' }] };
        damagesReturnedMap = { 1: 30 };
        await loadExpenses();
        await loadBookingEmailLogs();
        await loadDepositReturns();
        return {
            expenses: allExpenses.length,
            logs: Object.keys(bookingEmailLogs).length,
            returns: Number(damagesReturnedMap[1]) || 0,
        };
    });
    ok(stores.expenses === 1, `a dropped expenses fetch keeps them (${stores.expenses} of 1) — zero would overstate net profit`);
    ok(stores.logs === 1, `a dropped email-log fetch keeps the history (${stores.logs} of 1)`);
    ok(stores.returns === 30, `a dropped deposit-returns fetch keeps them (£${stores.returns} of £30)`);

    // ── 8. Clearing a map pin must not CLAIM success it hasn't got ──────────
    const geo = await page.evaluate(async () => {
        // The status line only exists once the cottage editor has rendered, and
        // this suite never opens it — so create it, or the message assertion
        // below passes by finding nothing.
        let st = document.getElementById('geo-status-21a');
        if (!st) { st = document.createElement('span'); st.id = 'geo-status-21a'; document.body.appendChild(st); }
        st.textContent = 'Set';
        adminPrivateContent['geo-21a'] = '52.9,1.0';
        await window.clearGeo('21a');
        return { mirror: adminPrivateContent['geo-21a'], said: st.textContent };
    });
    ok(geo.mirror === '52.9,1.0', `a failed clear does not wipe the local value either (${geo.mirror})`);
    ok(/connection|couldn/i.test(geo.said) && !/^Not set$/.test(geo.said),
        `…and it says so rather than reporting "Not set" ("${geo.said}")`);

    // ── 9. The root of it: a save that FAILED must not return as though it
    //      worked. saveContent used to alert the OWNER and tell its CALLER
    //      nothing was wrong, which left 14 try/catch blocks unable to fire.
    const st = await page.evaluate(async () => {
        let threw = false;
        try { await saveContent('geo-21a', 'x'); } catch (e) { threw = true; }
        return threw;
    });
    ok(st === true, 'saveContent REPORTS a failed write to its caller, not just to the screen');

    console.log('');
    console.log(fails ? `  ${fails} POOR-SIGNAL CHECK(S) FAILED ❌` : '  POOR-SIGNAL SUITE PASSED ✅');
    await done(fails);
})();
