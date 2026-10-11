// ============================================================
//  ui-test-latework.js — answers that land late, and edits made in quick succession.
//
//  The back office reuses one node for many records (the email sheet, the booking
//  page's guest-book card) and saves several settings as one whole object. Both go
//  wrong only when a request is slow or two edits overlap, so every check here holds
//  a request open, does the next thing, then lets the answer land.
//   §1 an arrival review that fails after the sheet moved on clears nobody's words
//   §2 a guest-book save that lands on another booking's page paints nothing there,
//      and leaves that booking's half-made rating alone
//   §3 two quick edits to the chat's answers both survive
//   §4 two quick alert switches both survive
//   §5 two "in my bank" marks both survive, and undoing the first keeps the second
//   §6 an Undo that fails says so
//   §7 a failed approvals count keeps the last count, not zero
//   §8 a repaint of the booking page keeps its activity
//   §9 a stay's history that fails to reload keeps what it showed, and with nothing
//      to show says it couldn't read it
//  §10 a host whose split did not load is shown none of the business's money
//  §11 an email sent again after its answer was lost carries the same retry id, so the
//      server answers the retry and the guest gets one email; a deliberate resend later
//      is a new send
// ============================================================
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const d = require('./ui-test-lib').d; // the harness's day (today, UK)
const mk = (id, name, ci, co) => ({
    id: 'b' + id, dbId: id, name, email: name.split(' ')[0].toLowerCase() + '@example.com', phone: '07700 900' + id,
    checkIn: ci, checkOut: co, checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0,
    payment: 'paid', depositPaid: 400, holdStatus: 'none', guestRating: null,
    agreedPrice: { total: 400, perNight: 133.33, nights: 3, txnFee: 0 },
});

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    const posts = [];
    const gates = {}; // action → { promise, release }: that request waits until released
    const failing = {}; // action → true: that request is refused
    const dropOnce = {}; // action → true: the next one is lost on the wire (no answer)
    let held = false;
    let reviewsPending = 2;
    const saved = {}; // content key → the last value the page saved
    const gate = (name) => { let release; const promise = new Promise((r) => { release = r; }); gates[name] = { promise, release: () => { delete gates[name]; release(); } }; };
    await page.route(/\.php/, async (route) => {
        const req = route.request();
        const url = req.url();
        const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'GET') {
            // Once seeded, no background refresh may replace the fixture: it is left
            // unanswered, which is what a slow link does anyway.
            if (held) return;
            return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], threads: [], reviews: [], photos: [], experiences: [], events: [] });
        }
        let b = {};
        try { b = JSON.parse(req.postData() || '{}'); } catch (e) {}
        b.__url = url.split('/').pop().split('?')[0];
        posts.push(b);
        const act = b.action || '';
        if (gates[act]) await gates[act].promise;
        if (dropOnce[act]) { delete dropOnce[act]; return route.abort('failed'); }
        if (failing[act]) return json({ error: 'The server said no.' }, 500);
        if (act === 'set' && b.__url === 'content.php') { saved[b.key] = b.value; return json({ ok: true }); }
        if (act === 'admin_notify_set') return json({ ok: true, me: { id: 1, name: 'Owner', full: true, role: 'super', notify: b.prefs } });
        if (act === 'hub_bundle') return json({ ok: true, payments: [], events: [{ action: 'booking.update', summary: 'Dates moved by the owner', at: d(-1) + ' 10:00:00', actor: 'You' }] });
        if (act === 'rate_guest') return json({ ok: true, at: d(0) + ' 12:00:00' });
        if (act === 'list_admin' && b.__url === 'reviews.php') return json({ ok: true, reviews: Array.from({ length: reviewsPending }, () => ({ status: 'pending' })) });
        if (act === 'summary' && b.__url === 'money.php') return json({ ok: true, landed_map: saved['sweep-landed'] ? JSON.parse(saved['sweep-landed']) : {}, activity: [], years: [] });
        if (act === 'stay' && b.__url === 'money.php') return json({ ok: true, events: [{ kind: 'in', what: 'Deposit', amount: 100, at: Math.floor(Date.now() / 1000) - 86400 }] });
        return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], experiences: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    held = true;
    await page.evaluate((fx) => {
        Object.keys(dbBookings).forEach((k) => { dbBookings[k] = []; });
        dbBookings.jollyboat = fx;
    }, [mk(201, 'Ada Past', d(-10), d(-7)), mk(202, 'Ben Past', d(-20), d(-17)), mk(203, 'Cara Soon', d(5), d(8))]);
    const settle = (ms) => page.waitForTimeout(ms || 400);

    console.log("§1 an arrival review that fails late clears nobody else's words");
    gate('arrival_preview');
    failing.arrival_preview = true;
    await page.evaluate(() => { openArrivalReview('b203'); });
    await settle(300);
    await page.evaluate(() => { openBookingEmail('b201'); });
    await settle(300);
    await page.evaluate(() => { /** @type {HTMLTextAreaElement} */ (document.getElementById('enq-email-body')).value = 'Dear Ada, the words I typed'; });
    gates.arrival_preview.release();
    await settle(600);
    const s1 = await page.evaluate(() => ({
        body: /** @type {HTMLTextAreaElement} */ (document.getElementById('enq-email-body')).value,
        alert: !!document.querySelector('#glass-dialog.open'),
    }));
    ok(s1.body === 'Dear Ada, the words I typed', `the next guest's message is still in the box (${JSON.stringify(s1.body)})`);
    ok(!s1.alert, '…and no alert about an email nobody is looking at any more');
    delete failing.arrival_preview;
    await page.evaluate(() => { try { closeEnquiryEmailModal(true); } catch (e) {} });
    await settle(300);

    console.log("§2 a guest-book save that lands on another booking's page paints nothing there");
    await page.evaluate(() => { openBookingHub('b201'); });
    await settle(500);
    await page.evaluate(() => { gbSetStar('b201', 4); });
    gate('rate_guest');
    await page.evaluate(() => { gbSave('b201'); });
    await settle(200);
    await page.evaluate(() => { openBookingHub('b202'); });
    await settle(500);
    await page.evaluate(() => { gbSetStar('b202', 2); });
    gates.rate_guest.release();
    await settle(600);
    const s2 = await page.evaluate(() => {
        const host = document.getElementById('gb-card-host');
        const ids = host ? [...host.querySelectorAll('[data-args]')].map((x) => x.getAttribute('data-args') || '').join(' ') : '';
        return {
            hostFor: /b201/.test(ids) ? 'b201' : /b202/.test(ids) ? 'b202' : '?',
            onStars: host ? host.querySelectorAll('.gb-star.on').length : -1,
            draft: __gbDraft ? { id: __gbDraft.id, overall: __gbDraft.overall } : null,
            saved: (findBookingById('b201').guestRating || {}).overall || 0,
        };
    });
    ok(s2.saved === 4, `the first booking's rating is saved (${s2.saved}★)`);
    ok(s2.hostFor === 'b202', `the page on screen still shows its own booking's card (${s2.hostFor})`);
    ok(!!s2.draft && s2.draft.id === 'b202' && s2.draft.overall === 2 && s2.onStars === 2, `…with its own half-made rating untouched (${JSON.stringify(s2.draft)}, ${s2.onStars} stars lit)`);

    console.log("§3 two quick edits to the chat's answers both survive");
    await page.evaluate(() => {
        siteContent['chat-chips'] = { hide: [], extra: [
            { id: 'x1', q: 'Dogs?', chip: 'Dogs?', a: 'Yes, two at most.', btn: true, prop: '' },
            { id: 'x2', q: 'Parking?', chip: 'Parking?', a: 'Free, on the drive.', btn: true, prop: '' },
        ] };
    });
    gate('set');
    await page.evaluate(() => { gcBtn('x1', false); gcBtn('x2', false); });
    await settle(200);
    gates.set.release();
    for (let i = 0; i < 30 && posts.filter((p) => p.key === 'chat-chips').length < 2; i++) await settle(100);
    await settle(300);
    const chips = saved['chat-chips'];
    const chipsV = typeof chips === 'string' ? JSON.parse(chips) : chips;
    const btnOf = (id) => ((chipsV && chipsV.extra) || []).find((x) => x.id === id);
    ok(!!chipsV && btnOf('x1') && btnOf('x1').btn === false && btnOf('x2') && btnOf('x2').btn === false,
        `both answers came off the buttons in what was saved last (${JSON.stringify(((chipsV && chipsV.extra) || []).map((x) => x.id + ':' + x.btn))})`);

    console.log('§4 two quick alert switches both survive');
    posts.length = 0;
    gate('admin_notify_set');
    await page.evaluate(() => { saveNotifyPref('money', false); saveNotifyPref('enquiries', false); });
    await settle(200);
    gates.admin_notify_set.release();
    for (let i = 0; i < 30 && posts.filter((p) => p.action === 'admin_notify_set').length < 2; i++) await settle(100);
    await settle(300);
    const ns = posts.filter((p) => p.action === 'admin_notify_set');
    const last = ns.length ? ns[ns.length - 1].prefs || {} : {};
    ok(ns.length === 2 && last.money === false && last.enquiries === false, `the second save carries the first change too (${JSON.stringify({ money: last.money, enquiries: last.enquiries })})`);

    console.log('§5 two "in my bank" marks both survive, and undoing the first keeps the second');
    await page.evaluate(() => { __pm = { landed_map: {}, activity: [] }; });
    gate('set');
    await page.evaluate(() => { pmLanded(['t1'], true); pmLanded(['t2'], true); });
    await settle(200);
    gates.set.release();
    for (let i = 0; i < 30 && !(saved['sweep-landed'] && /t2/.test(saved['sweep-landed'])); i++) await settle(100);
    await settle(400);
    const both = saved['sweep-landed'] ? JSON.parse(saved['sweep-landed']) : {};
    ok(!!both.t1 && !!both.t2, `both marks are in what was saved (${Object.keys(both).join(', ')})`);
    // The two toasts carry an Undo each; the FIRST mark's is the older toast.
    await page.evaluate(() => {
        const btns = [...document.querySelectorAll('#app-toasts .toast .toast-action')];
        if (btns.length) /** @type {HTMLElement} */ (btns[0]).click();
    });
    for (let i = 0; i < 30 && saved['sweep-landed'] && /t1/.test(saved['sweep-landed']); i++) await settle(100);
    await settle(400);
    const after = saved['sweep-landed'] ? JSON.parse(saved['sweep-landed']) : {};
    ok(!after.t1 && !!after.t2, `undoing the first mark takes back only that one (${Object.keys(after).join(', ') || 'none'})`);

    console.log('§6 an Undo that fails says so');
    await page.evaluate(() => {
        document.querySelectorAll('#app-toasts .toast').forEach((t) => t.remove());
        toast('Done that.', 'success', { label: 'Undo', fn: () => Promise.reject(new Error('the server said no')) });
    });
    await settle(200);
    await page.click('#app-toasts .toast-action');
    await settle(500);
    const said = await page.evaluate(() => [...document.querySelectorAll('#app-toasts .toast')].map((t) => t.textContent).join(' | '));
    ok(/Couldn.t undo that: the server said no/.test(said), `the failure is reported in the server's words (${said.slice(0, 80)})`);

    console.log('§7 a failed approvals count keeps the last count, not zero');
    reviewsPending = 2;
    await page.evaluate(async () => { await refreshModerationCounts(); });
    const m1 = await page.evaluate(() => __nyMod.rev);
    failing.list_admin = true;
    await page.evaluate(async () => { await refreshModerationCounts(); });
    const m2 = await page.evaluate(() => __nyMod.rev);
    delete failing.list_admin;
    ok(m1 === 2, `(fixture) two reviews are waiting (${m1})`);
    ok(m2 === 2, `a count that could not be read keeps the last answer, rather than saying none are waiting (${m2})`);

    console.log('§8 a repaint of the booking page keeps its activity');
    await page.evaluate(() => { openBookingHub('b201'); });
    for (let i = 0; i < 30 && !(await page.evaluate(() => /Dates moved/.test((document.getElementById('hub-history') || {}).textContent || ''))); i++) await settle(100);
    await page.evaluate(() => { renderBookingHub(); });
    await settle(200);
    const s8 = await page.evaluate(() => ({
        feed: (document.getElementById('hub-history') || {}).textContent || '',
        sum: (document.getElementById('bhub-activity-sum') || {}).textContent || '',
    }));
    ok(/Dates moved by the owner/.test(s8.feed) && !/Loading/.test(s8.feed), `the activity is still there after a repaint (${s8.feed.slice(0, 50)})`);
    ok(!/Loading/.test(s8.sum), `…and so is its summary (${s8.sum})`);

    console.log("§9 a stay's history that fails to reload keeps what it showed");
    const s9 = await page.evaluate(async () => {
        __pmStay[201] = [{ kind: 'in', what: 'Balance', amount: 300, at: Math.floor(Date.now() / 1000) - 3600 }];
        return null;
    });
    failing.stay = true;
    await page.evaluate(async () => { await pmLoadStay('b201'); });
    const kept = await page.evaluate(() => Array.isArray(__pmStay[201]) && __pmStay[201].length === 1);
    ok(kept, 'a failed reload keeps the history it had');
    await page.evaluate(async () => { delete __pmStay[201]; await pmLoadStay('b201'); });
    const html = await page.evaluate(() => pmStayPage('b201'));
    delete failing.stay;
    ok(/Couldn’t load what has happened/.test(html) && !/Loading what has happened/.test(html), "with nothing to show, the page says it couldn't read it — never an empty history");
    void s9;

    console.log("§10 a host whose split did not load is shown none of the business's money");
    await page.evaluate((b) => { dbBookings.jollyboat.push(b); }, Object.assign(mk(204, 'Dora Owes', d(20), d(23)), { payment: 'deposit', depositPaid: 100 }));
    failing.status = true;
    await page.evaluate(async () => {
        chbSetMe({ id: 2, name: 'Hana Host', full: false, role: 'host', perms: {} });
        __split = null;
        await splitLoad();
        pmRenderList();
    });
    const s10 = await page.evaluate(() => ({ list: (document.getElementById('pm-list') || {}).textContent || '', pill: (document.getElementById('mo-pill') || {}).textContent || '' }));
    ok(/Couldn.t check which cottages are yours/.test(s10.list) && !/Dora/.test(s10.list), `the list says so and names no guest (${s10.list.slice(0, 70)})`);
    ok(s10.pill.trim() === '', `…and the title claims nothing about the money (${JSON.stringify(s10.pill)})`);
    const pane10 = await page.evaluate(() => { __pmOpen = 'books'; pmRenderDetail(); const t = (document.getElementById('pm-detail') || {}).textContent || ''; __pmOpen = null; return t; });
    ok(pane10.trim() === '', `…nor does the side pane open the business's books (${pane10.trim().slice(0, 40)})`);
    await page.evaluate(() => { chbSetMe({ id: 1, name: 'Owner', full: true, role: 'super' }); pmRenderList(); });
    const s10b = await page.evaluate(() => (document.getElementById('pm-list') || {}).textContent || '');
    ok(/Dora/.test(s10b), 'full access still sees the whole business when the split cannot be read');
    delete failing.status;

    console.log('§11 an email sent again after its answer was lost reaches the guest once');
    posts.length = 0;
    const sendNow = () => page.evaluate(() => { sendEnquiryEmail(); composeFlush(); });
    await page.evaluate(() => {
        openBookingEmail('b202');
        /** @type {HTMLTextAreaElement} */ (document.getElementById('enq-email-subject')).value = 'Your keys';
        /** @type {HTMLTextAreaElement} */ (document.getElementById('enq-email-body')).value = 'The key safe is by the door.';
        composeTyped();
    });
    dropOnce.email_guest = true;
    await sendNow();
    for (let i = 0; i < 30 && !(await page.evaluate(() => document.getElementById('enq-email-modal').classList.contains('open'))); i++) await settle(100);
    await settle(300);
    await sendNow();
    for (let i = 0; i < 30 && posts.filter((p) => p.action === 'email_guest').length < 2; i++) await settle(100);
    await settle(400);
    const eg = posts.filter((p) => p.action === 'email_guest');
    ok(eg.length === 2 && !!eg[0].op_id && eg[0].op_id === eg[1].op_id, `the resend carries the first attempt's id (${eg.map((p) => p.op_id).join(' / ')})`);
    await page.evaluate(() => {
        openBookingEmail('b202');
        /** @type {HTMLTextAreaElement} */ (document.getElementById('enq-email-subject')).value = 'Your keys';
        /** @type {HTMLTextAreaElement} */ (document.getElementById('enq-email-body')).value = 'The key safe is by the door.';
        composeTyped();
    });
    await sendNow();
    for (let i = 0; i < 30 && posts.filter((p) => p.action === 'email_guest').length < 3; i++) await settle(100);
    const eg3 = posts.filter((p) => p.action === 'email_guest');
    ok(eg3.length === 3 && eg3[2].op_id !== eg3[1].op_id, 'the same words sent again on purpose, after one has gone, are a new send');

    ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
    console.log(fails ? `\n${fails} FAILED` : '\nALL LATE-WORK CHECKS PASSED');
    await done(fails);
})();
