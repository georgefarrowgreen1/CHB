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
        // `logs` carries a marker row so §7 can WAIT for the booking hub's own
        // fire-and-forget email-log read to land before it seeds the store. Booking 99
        // does not exist, so nothing renders it. See the drain below.
        if (route.request().method() === 'POST' && !/ical-import/.test(url)) return json({ ok: true, events: [], logs: { 99: [{ action: 'drain', summary: '', at: '' }] } });
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

    // DRAIN before §7 seeds. openBookingHub fires loadBookingEmailLogs() UNAWAITED (it
    // fills its own card when it lands), so on a good link that read was still in flight
    // when §7 wrote its fixture — and it then assigned the server's empty log over the
    // top, failing the assertion below for a reason that had nothing to do with the
    // rule being checked (measured: 1 run in 5). Waiting on the marker row makes it
    // deterministic: the hub's read has DEFINITELY landed before the seed goes in.
    // The hub no longer fires this read itself (its Activity feed rides the
    // hub_bundle instead), so the suite issues the read it is about to
    // break-test — same determinism, no phantom dependency on the hub's plumbing.
    let drained = true;
    try {
        await page.evaluate(() => loadBookingEmailLogs());
        await page.waitForFunction(() => typeof bookingEmailLogs === 'object' && bookingEmailLogs && bookingEmailLogs['99'], null, { timeout: 5000 });
    } catch (e) {
        drained = false;
    }
    ok(drained, "the email-log read has landed, so the fixture below is not racing it");

    // The SAME drain for deposit_returns. The live-net recovery (chbNetUp →
    // chbNetRecover → initBackOffice, fire-and-forget) was kicked off by the
    // good-link section above, and its own loadDepositReturns can land MID-SEED
    // below — measured in CI under 3-suite load: the generic 200 wiped the
    // seeded map and the check read £0 while the app code was correct. Wait for
    // the verdict to settle, then issue-and-await the read ourselves so nothing
    // of ours is still in flight when the fixture is seeded.
    await page.waitForFunction(() => !document.body.classList.contains('net-off'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => loadDepositReturns());

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

    // ── 9b. …AND THE TWO CALLERS THAT MAKE A CLAIM MUST WAIT FOR IT. saveContent
    //      rethrows (above), but these two opted out with `.catch(() => {})` — the
    //      fire-and-forget idiom, on paths that then print "Saved." and flash a green
    //      border. So the owner was told their host bio and their website text were on
    //      the site while the server had rejected both, and navigated away believing it.
    const claims = await page.evaluate(async () => {
        const out = {};
        // Host bio: the message element is the whole claim.
        const msg = document.getElementById('host-save-msg');
        if (msg) msg.textContent = '';
        await saveHostText('host-bio', 'A sentence that will not save.');
        out.host = msg ? msg.textContent : '(no element)';
        // Website content: the border colour is the claim.
        const el = document.createElement('textarea');
        el.id = 'ce-hero-title';
        el.value = 'Also will not save.';
        document.body.appendChild(el);
        await contentEditSave('hero-title');
        out.border = getComputedStyle(el).borderColor;
        // Resolve the tokens through a probe rather than guessing RGB, so the check
        // cannot drift when the palette is retuned.
        const probe = document.createElement('div');
        document.body.appendChild(probe);
        probe.style.color = 'var(--ok)';
        out.ok = getComputedStyle(probe).color;
        probe.style.color = 'var(--danger)';
        out.danger = getComputedStyle(probe).color;
        probe.remove();
        el.remove();
        return out;
    });
    ok(!/^Saved\.$/.test(claims.host) && /not saved|didn/i.test(claims.host),
        `a rejected host-text save does NOT claim "Saved." (${claims.host})`);
    ok(claims.border !== claims.ok,
        `…and a rejected content save does not flash the success border (${claims.border} vs ok ${claims.ok})`);
    ok(claims.border === claims.danger,
        `…it says the opposite, in the danger colour (${claims.border})`);

    // ── 9b-ii. THE SAME CLASS, THREE MORE CALLERS. The map pin and the cancellation
    //      policy each wrote their mirror BEFORE the answer and then claimed the save
    //      — a pin the owner believed was dropped and came back unset next load, and a
    //      chosen policy card + green toast stacked under saveContent's own
    //      "Couldn't save that change" alert, with the rejected value in the mirror
    //      for the rest of the session. The cancellation policy is the one term on the
    //      cottage page a guest agrees to. Driven with the write still refusing.
    const claims2 = await page.evaluate(async () => {
        const out = {};
        // The pin: a status element is the whole claim, and the mirror must not adopt.
        // REUSE the page's own elements when they exist — getElementById returns the
        // FIRST match, so a synthetic duplicate is written to by nobody and reads
        // empty while the real one carries the message (caught on the first run).
        const mk = (id, val) => {
            let e = document.getElementById(id);
            if (!e) { e = document.createElement(val === undefined ? 'div' : 'input'); e.id = id; document.body.appendChild(e); e.__tmp = true; }
            if (val !== undefined) e.value = val;
            return e;
        };
        const st = mk('geo-status-21a');
        st.textContent = '';
        mk('geo-lat-21a', '52.95');
        mk('geo-lng-21a', '1.02');
        delete adminPrivateContent['geo-21a'];
        await saveGeoManual('21a');
        out.geoSay = st.textContent;
        out.geoMirror = adminPrivateContent['geo-21a'] === undefined ? '(untouched)' : 'ADOPTED';
        ['geo-status-21a', 'geo-lat-21a', 'geo-lng-21a'].forEach((id) => { const e = document.getElementById(id); if (e && e.__tmp) e.remove(); });
        // The policy: the mirror is the claim the cottage page then reads.
        const before = siteContent['21a-cancellation-policy'];
        await setCancelPolicy('21a', before === 'flexible' ? 'strict' : 'flexible');
        out.polMirror = siteContent['21a-cancellation-policy'] === before ? '(unchanged)' : 'ADOPTED';
        return out;
    });
    ok(/couldn.t save/i.test(claims2.geoSay), `a rejected map pin says so, rather than reading as set (${claims2.geoSay})`);
    ok(claims2.geoMirror === '(untouched)', `…and the mirror does not adopt the refused value (${claims2.geoMirror})`);
    ok(claims2.polMirror === '(unchanged)',
        `a rejected cancellation policy is not adopted either — it is the one term the guest agrees to (${claims2.polMirror})`);

    // ── 9c. "SAVE ALL COTTAGES" REPORTS PER COTTAGE. It ran one save per cottage
    //      inside a SINGLE try, so cottage 2 failing meant cottage 1 was already
    //      saved and cottage 3 never attempted — and the catch then said "Couldn't
    //      save": total failure about a partial write. Driven with the middle cottage
    //      refusing, so the honest report is the only one that can pass.
    const partial = await page.evaluate(async () => {
        // TWO cottages, or "one failed and the rest didn't" has nothing to be about.
        // INJECT-AND-POP on the shared fixture (the documented rule): propertyList is
        // what liveCottageKeys reads, and later checks assert counts off it.
        // The grid only exists once its own section is open — and openArea REFRESHES
        // propertyList from the endpoint, so the probe cottage has to be added AFTER
        // it or the reload throws it away (measured: keys stayed at 1).
        await openArea();
        settingsOpen('seasongrid');
        await new Promise((r) => setTimeout(r, 400));
        const addedIdx = propertyList.length;
        propertyList.push({ prop_key: 'zz-probe', name: 'Probe Cottage', archived: false, unlisted: false });
        propertyMeta['zz-probe'] = { name: 'Probe Cottage', short: 'PC' };
        const keys = liveCottageKeys();
        const realPost = window.apiPost;
        const seen = [];
        window.apiPost = async (url, body) => {
            if (String(url).includes('rates.php') && body.action === 'seasons_save') {
                seen.push(body.prop_key);
                if (body.prop_key === keys[1]) throw new Error('offline');
                return { ok: true };
            }
            return realPost(url, body);
        };
        let said = '';
        const realAlert = window.glassAlert;
        window.glassAlert = (m) => { said = m; return Promise.resolve(true); };
        // A grid with one real card, so there is something to save for every cottage.
        // (The editor is season CARDS now — saveSeasonGrid iterates .sg-band divs.)
        const body = document.getElementById('season-grid-body');
        if (body) {
            const cells = keys.map((k) => `<input data-sg-prop="${k}" value="150">`).join('');
            body.innerHTML = `<div class="sg-band"><input data-sg="label" value="Test"><input data-sg="start" value="2027-06-01"><input data-sg="end" value="2027-06-30">${cells}</div>`;
        }
        await saveSeasonGrid();
        window.apiPost = realPost;
        window.glassAlert = realAlert;
        const out = { said: said, tried: seen.length, keys: keys, grid: !!document.getElementById('season-grid-body'), msg: (document.getElementById('season-grid-msg') || {}).textContent || '' };
        propertyList.splice(addedIdx, 1);
        delete propertyMeta['zz-probe'];
        return out;
    });
    ok(partial.grid && partial.keys.length >= 2,
        `PARTIAL: the grid is open with ${partial.keys.length} cottages (a one-cottage fixture proves nothing here)`);
    ok(partial.tried === partial.keys.length,
        `PARTIAL: one cottage failing does not stop the others (${partial.tried} of ${partial.keys.length} attempted)`);
    ok(!/^Couldn't save:/.test(partial.said) && /but not|Saved for/.test(partial.said),
        `PARTIAL: …and the report names who was saved and who was not ("${partial.said}")`);
    ok(/try again to finish/i.test(partial.said), 'PARTIAL: …with what to do about it');
    ok(partial.msg === partial.said, 'PARTIAL: …and the on-screen line says the same thing as the alert');

    // ── 9d. THE PRIVATE/PUBLIC CONTROL WAS BUILT AND NEVER RENDERED. `privateRow`
    //      was composed in settingsOpenAccom and left out of the innerHTML — a
    //      working action, a migrated column and a public site honouring it, with no
    //      way in. Third time this shape has appeared (the mailbox's Sent list, the
    //      status page), so it is gated now.
    const priv = await page.evaluate(async () => {
        const k = liveCottageKeys()[0];
        await openArea();
        settingsOpen('accommodations');
        settingsOpenAccom(k);
        await new Promise((r) => setTimeout(r, 300));
        const btn = document.querySelector('#accom-detail [data-act="setAccommodationPrivate"]');
        return { there: !!btn, label: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : '' };
    });
    ok(priv.there, 'PRIVATE: the make-private control is actually on the screen');
    ok(/private|website/i.test(priv.label), `PRIVATE: …and says what it does (${priv.label.slice(0, 60)})`);

    // ── 10. The private-content cache had the same shape as loadData's stores,
    //      and the sharpest edge of any of them. openSettings() refreshes
    //      adminPrivateContent on every open and used to EMPTY it in the catch —
    //      but these editors read it FIRST precisely because an INTERNAL key is
    //      absent from the anonymous boot content GET, so the fallback to
    //      siteContent is a blank. Bank details, notification preferences, the
    //      tides key and every cottage's arrival + welcome text therefore rendered
    //      EMPTY over real saved data, one Save (or, for the arrival textarea,
    //      one typed word — it saves on CHANGE) from overwriting the lot.
    await page.evaluate(() => {
        adminPrivateContent['bacs-details'] = 'Barclays · 20-00-00 · 12345678';
        adminPrivateContent['arrival-21a'] = 'Key safe code is 1234, round the back.';
        window.__netFailSaid = '';
        const t = window.toast;
        window.toast = (m, kind, act) => { window.__netFailSaid = String(m || '') + (act && act.label ? ' [' + act.label + ']' : ''); return t ? t(m, kind, act) : undefined; };
    });
    const kept = await page.evaluate(async () => {
        await window.openSettings('payments'); // content.php is stalled + dropped
        return { bacs: adminPrivateContent['bacs-details'], arr: adminPrivateContent['arrival-21a'], said: window.__netFailSaid };
    });
    ok(kept.bacs === 'Barclays · 20-00-00 · 12345678', `a dropped content.php keeps the bank details (${JSON.stringify(kept.bacs)})`);
    ok(kept.arr === 'Key safe code is 1234, round the back.', `…and every cottage's arrival text (${JSON.stringify(kept.arr)})`);
    // Nothing has ever loaded in this session, so the blank the owner IS looking
    // at gets explained rather than believed — with a way to try again.
    ok(/connection|couldn/i.test(kept.said) && /Retry/.test(kept.said),
        `…and a never-loaded cache says so, with a retry ("${kept.said}")`);
    // And the field itself: it must show what was kept, not an empty box.
    const shown = await page.evaluate(() => {
        const el = document.getElementById('bacs-details');
        return el ? String(el.value || '') : '<<no field>>';
    });
    ok(shown === 'Barclays · 20-00-00 · 12345678', `the bank-details field shows the kept value, not a blank (${JSON.stringify(shown)})`);

    // ---- 10. THE GUEST SIDE: a dropped fetch must not DELETE the page ----
    // Things to do is the one guest page where breaking the keep-last-good rule
    // destroyed content already on screen. experiences-page.php renders the
    // published list into #exp-grid server-side for crawlers; renderExperiencesView
    // then blanked that grid on a failed fetch and showed "Experiences coming
    // soon — We're putting together our favourite local spots", which is a claim
    // about the BUSINESS made because a request failed, with no way back but
    // leaving the page.
    await page.route(/experiences\.php/, (route) => route.abort('failed'));
    const exp = await page.evaluate(async () => {
        const grid = document.getElementById('exp-grid');
        // Stand in for what experiences-page.php serves: real cards, already read.
        grid.innerHTML = '<div class="exp-card" data-ssr="1">Blakeney Point seal trip</div>';
        __experiences = [];
        await renderExperiencesView();
        const vis = (id) => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
        return {
            kept: !!grid.querySelector('[data-ssr]'),
            emptyShown: vis('exp-empty'),
            errShown: vis('exp-error'),
            errText: (document.getElementById('exp-error') || {}).textContent || '',
        };
    });
    ok(exp.kept, 'GUEST: a dropped fetch does not delete the server-rendered list');
    ok(!exp.emptyShown, '…and never claims the cottages have no local favourites yet');
    // With something still on screen there is nothing to explain — the panel is
    // for a genuinely blank page, which is the next case.
    ok(!exp.errShown, '…nor stacks an error panel over content that is still there');

    const expBlank = await page.evaluate(async () => {
        document.getElementById('exp-grid').innerHTML = '';
        __experiences = [];
        await renderExperiencesView();
        const vis = (id) => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
        return {
            emptyShown: vis('exp-empty'),
            errShown: vis('exp-error'),
            errText: (document.getElementById('exp-error') || {}).textContent || '',
            retry: !!document.querySelector('#exp-error [data-act="renderExperiencesView"]'),
        };
    });
    ok(expBlank.errShown && !expBlank.emptyShown,
        'GUEST: a blank page says the connection dropped, not "coming soon"');
    ok(/Couldn/i.test(expBlank.errText) && expBlank.retry, `…with a way to try again (${expBlank.retry})`);
    // …and it really is a state, not a one-way door: once the endpoint answers,
    // the page fills in and the panel goes.
    await page.unroute(/experiences\.php/);
    await page.route(/experiences\.php/, (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ experiences: [{ id: 1, title: 'Seal trip', category: 'Boat trips', body: 'Go.', status: 'approved' }] }),
    }));
    const expBack = await page.evaluate(async () => {
        await renderExperiencesView();
        const vis = (id) => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
        return { errShown: vis('exp-error'), cards: document.getElementById('exp-grid').innerHTML.length };
    });
    ok(!expBack.errShown && expBack.cards > 0, `…and retrying fills the page in (${expBack.cards} chars)`);
    await page.unroute(/experiences\.php/);

    console.log('');
    console.log(fails ? `  ${fails} POOR-SIGNAL CHECK(S) FAILED ❌` : '  POOR-SIGNAL SUITE PASSED ✅');
    await done(fails);
})();
