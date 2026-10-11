// ============================================================
//  ui-test-handover.js — one device, two people.
//
//  A phone or a shared computer passes from one person to the next. What the first
//  person typed, and answers still on their way to them, must not reach the second.
//   §1 a guest signing out leaves the enquiry form and the chat box empty
//   §2 a stays request still on its way at sign-out never shows its stays to the
//      next guest (it used to: the next sign-in asked nothing, and the late answer
//      painted the first guest's stays, pay button and door code)
//   §3 a session the server ended starts the page again from nothing, once read
//   §4 an account with a stay still to come is not deleted, and says so plainly
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
    const { browser, base, done } = await bootBrowser();
    const d = require('./ui-test-lib').d; // the harness's day (today, UK)
    const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };
    const ann = { name: 'Ann Able', email: 'ann@example.com', phone: '07700 900111', address: '1 Quay Street, Blakeney', postcode: 'NR25 7ND' };
    const bob = { name: 'Bob Best', email: 'bob@example.com', phone: '07700 900222', address: '2 High Street, Holt', postcode: 'NR25 6BN' };
    const stay = (pk, id, i, o) => Object.assign({ id, prop_key: pk, check_in: i, check_out: o, adults: 2, children: 0, pay_token: 'tok' + id }, priced);
    const annStays = [stay('jollyboat', 501, d(12), d(15))];
    const bobStays = [stay('pimpernel', 602, d(30), d(33))];

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    let signedIn = ann;
    let gate = null; // while set, Ann's my-bookings answers wait for it (a slow link)
    let deleteReply = null;
    const posts = [];
    await page.route(/\.php/, async (route) => {
        const url = route.request().url();
        const json = (x, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (route.request().method() === 'POST') posts.push({ url, body });
        if (url.includes('auth.php')) {
            if (body.action === 'guest_status') return json({ ok: true, guest: signedIn });
            if (body.action === 'guest_logout') return json({ ok: true });
            if (body.action === 'guest_delete_account' && deleteReply) return json(deleteReply.body, deleteReply.status);
            return json({ ok: true, admin: false, guest: null });
        }
        if (url.includes('my-bookings.php')) {
            const who = signedIn; // answered for whoever asked, however late it lands
            if (who === ann && gate) await gate;
            return json({ ok: true, bookings: who === ann ? annStays : bobStays, enquiries: [], completed_stays: 0 });
        }
        if (url.includes('passkeys.php')) return json({ ok: true, passkeys: [] });
        return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof currentGuest !== 'undefined' && !!currentGuest, null, { timeout: 10000 }).catch(() => {});

    console.log('§1 signing out leaves the enquiry form and the chat box empty');
    await page.evaluate(() => {
        openProperty('jollyboat');
        const t = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
        t.value = 'Is the cot still free for Saturday?';
    });
    await page.waitForTimeout(300);
    const filled = await page.evaluate(() => ['enq-name', 'enq-email', 'enq-phone', 'enq-address', 'enq-postcode'].map((id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value));
    ok(filled.join('|') === [ann.name, ann.email, ann.phone, ann.address, ann.postcode].join('|'), `(fixture) the form fills itself from the signed-in guest (${filled.join(', ')})`);
    await page.evaluate(() => guestLogout());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
        f: ['enq-name', 'enq-email', 'enq-phone', 'enq-address', 'enq-postcode'].map((id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value),
        locked: /** @type {HTMLInputElement} */ (document.getElementById('enq-email')).readOnly,
        chat: /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input')).value,
    }));
    ok(after.f.every((v) => v === ''), `after signing out the form holds none of their name, email, phone or address (${after.f.join('|')})`);
    ok(!after.locked, '…and the email box is the next person\'s to type in');
    ok(after.chat === '', '…and the chat box holds no unsent words of theirs');

    console.log('§2 a stays request on its way at sign-out is not shown to the next guest');
    signedIn = ann;
    let release;
    gate = new Promise((r) => { release = r; });
    await page.evaluate((g) => { currentGuest = g; setGuestUI(); gaStaysLoad(true); renderGuestBookings(); }, ann);
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => __gaStaysBusy === true), '(fixture) Ann\'s stays are on their way, to You and to the stays page');
    await page.evaluate(() => guestLogout());
    await page.waitForTimeout(200);
    signedIn = bob;
    await page.evaluate((g) => { currentGuest = g; setGuestUI(); }, bob);
    await page.waitForFunction(() => __gaStays && __gaStays !== 'err', null, { timeout: 5000 }).catch(() => {});
    release();
    await page.waitForTimeout(600);
    gate = null;
    const shown = await page.evaluate(() => {
        guestAccountTab();
        const st = __gaStays && __gaStays !== 'err' ? __gaStays.rows.map((r) => r.propKey + ':' + r.payToken).join(',') : String(__gaStays);
        return { st, page: (document.getElementById('view-guest-account') || {}).textContent || '', list: (document.getElementById('guest-bookings-list') || {}).textContent || '', cache: JSON.stringify(guestBookingsCache || []) };
    });
    ok(shown.st === 'pimpernel:tok602', `Bob's page holds Bob's stay, not Ann's late answer (${shown.st})`);
    ok(!/Jollyboat/.test(shown.page), '…and nothing on it names Ann\'s cottage');
    ok(!/Jollyboat/.test(shown.list) && !/jollyboat/.test(shown.cache), '…nor does the stays page, which her late answer used to repaint');

    console.log('§3 a session the server ended starts again from nothing');
    await page.evaluate(() => { window.__handoverMark = 1; forceAdminLogout(); });
    await page.waitForSelector('#glass-dialog.open', { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => /sign-in has ended/i.test((document.getElementById('glass-dialog') || {}).textContent || '') && window.__handoverMark === 1), 'it says why first, and has not reloaded under the owner');
    await Promise.all([
        page.waitForNavigation({ timeout: 8000 }).catch(() => {}),
        page.click('#glass-dialog-ok'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    ok(await page.evaluate(() => typeof window.__handoverMark === 'undefined'), 'once read, the page is loaded afresh — nothing of the back office stays in memory');

    console.log('§4 an account with a stay still to come is not deleted');
    signedIn = ann;
    await page.waitForFunction(() => typeof currentGuest !== 'undefined' && !!currentGuest, null, { timeout: 10000 }).catch(() => {});
    const sentence = 'You have a stay booked from 22/10/2026. Your account can be deleted once it has ended. To cancel the stay, message us.';
    deleteReply = { status: 409, body: { error: sentence, code: 'stay_ahead' } };
    // NOT awaited inside the page: it resolves only once its dialogs are answered, and
    // answering them is the next line.
    await page.evaluate(() => { deleteGuestAccount(); });
    await page.waitForSelector('#glass-dialog.open');
    await page.click('#glass-dialog-ok');
    await page.waitForTimeout(400);
    await page.waitForSelector('#glass-dialog.open');
    const said = await page.evaluate(() => (document.getElementById('glass-dialog-msg') || {}).textContent || '');
    ok(said === sentence, `it says when the stay is and what to do, in the server's words (${said.slice(0, 60)}…)`);
    ok(await page.evaluate(() => !!currentGuest), '…and the guest is still signed in');

    await page.close();
    console.log(fails ? `\n${fails} FAILED` : '\nALL HANDOVER CHECKS PASSED');
    await done(fails);
})();
