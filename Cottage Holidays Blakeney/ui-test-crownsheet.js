// ============================================================
//  ui-test-crownsheet.js — the assistant lives in the CROWN.
//
//  The dock's separate Search knot is retired: nav() rewrites view-main →
//  view-backoffice for anyone signed in, so the crown's old tap went to Today —
//  exactly where the calendar icon already goes. The crown opens the assistant
//  instead, as a SHEET rather than a page jump, because the bar cannot host a
//  field (measured: 80px of middle slot once the crown and four icons have theirs).
//
//  What this pins, all of it something that broke or nearly did while building it:
//    A) the crown opens/closes the sheet, and the input is genuinely typable —
//       the whole reason for a sheet over an in-bar field;
//    B) the sheet sits BELOW the header in z-order, so the crown stays hittable
//       and one target toggles both ways;
//    C) Enter hands the query to the ONE intelligence stack (the search window);
//    D) Escape / scrim close it, and Escape hands focus back to the crown;
//    E) the crown must not SHRINK — `.logo` is flex:0 1 auto and collapsed
//       48→27px the moment a sibling competed for the bar's free space;
//    F) signed OUT the crown still goes Home — the element is shared with the
//       public header, so the handler self-heals rather than trapping visitors.
// ============================================================
const { d, ok, boot } = require('./ui-test-lib');

const stub = (page) =>
    page.route(/\.php/, (r) => {
        const url = r.request().url();
        const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('auth.php')) {
            let b = {};
            try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
            if (b.action === 'admin_status') return json({ ok: true, admin: true });
            if (b.action === 'guest_status') return json({ ok: true, guest: null });
            return json({ ok: true });
        }
        if (url.includes('rates.php'))
            return json({
                properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, booking_fee: 75, transaction_pct: 3, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }],
                seasons: {}, occupancy: {},
            });
        // An arrival TODAY plus an unpaid balance, so cmdkBrief() has real rows.
        if (url.includes('bookings.php'))
            return json({ bookings: [
                { id: 501, prop_key: '21a', name: 'Cara Bell', email: 'c@x.co', check_in: d(0), check_out: d(4), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 100, agreed_total: 640, agreed_nightly: 620, agreed_txn_fee: 20, agreed_nights: 4 },
            ] });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], content: {}, blocks: [], ranges: [] });
    });

const snap = (page) =>
    page.evaluate(() => {
        const sheet = document.getElementById('crown-sheet');
        const crown = document.querySelector('.logo');
        const inp = document.getElementById('crown-ask');
        const cs = sheet ? getComputedStyle(sheet) : null;
        const cb = crown.getBoundingClientRect();
        const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
        return {
            open: !!(sheet && sheet.classList.contains('open')),
            sheetOpacity: cs ? cs.opacity : null,
            sheetTransform: cs ? cs.transform : null,
            sheetZ: cs ? +cs.zIndex : null,
            headerZ: +getComputedStyle(document.querySelector('header')).zIndex,
            inputW: inp ? Math.round(inp.getBoundingClientRect().width) : null,
            inputFocused: !!(inp && document.activeElement === inp),
            rows: document.querySelectorAll('#crown-sheet .cs-row').length,
            crownW: Math.round(cb.width),
            crownExpanded: crown.getAttribute('aria-expanded'),
            crownAct: crown.getAttribute('data-act'),
            crownFocused: document.activeElement === crown,
            crownMstate: crown.dataset.mstate || null,
            // B) the crown must remain the top hit at its own centre
            crownHittable: (() => {
                const hit = document.elementFromPoint(Math.round(cb.left + cb.width / 2), Math.round(cb.top + cb.height / 2));
                return !!(hit && (hit === crown || crown.contains(hit) || hit.closest('.logo')));
            })(),
            dockBtns: [...document.querySelectorAll('.admin-dock-btn')].filter((b) => b.offsetParent !== null).length,
            knotGone: !document.querySelector('.admin-dock-btn[data-act="openCmdK"]'),
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            activeView: (document.querySelector('.page-view.active') || {}).id || null,
            cmdkOpen: !!(document.getElementById('cmdk') || {}).classList?.contains('open'),
            searchInput: (document.getElementById('cmdk-input') || {}).value || null,
            scrimVis: vis(document.getElementById('crown-scrim')),
        };
    });

(async () => {
    let fails = 0;
    const check = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await stub(page);
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    // (The signed-out case is checked at the END: this stub reports an admin
    // session, so setAuthUI() eagerly loads the owner bundle on restore and the
    // crown is already rebound by the time the page settles — which is exactly why
    // the handler has to self-heal rather than rely on the binding being fresh.)

    await page.evaluate(async () => {
        isAuthenticated = true;
        document.body.classList.add('owner-mode');
        await loadAdminBundle();
        await initBackOffice();
    });
    await page.waitForTimeout(1400);
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });

    let s = await snap(page);
    check(s.crownAct === 'crownSheetToggle', `the owner bundle repoints the crown at the assistant (${s.crownAct})`);
    check(s.knotGone && s.dockBtns === 4, `the dock's separate Search knot is retired (${s.dockBtns} buttons left)`);
    check(!s.open, 'the sheet starts closed');

    // ---- A) the crown opens it, and the field is genuinely typable ----
    await page.click('.logo');
    await page.waitForTimeout(600);
    s = await snap(page);
    check(s.open, 'tapping the crown drops the sheet');
    check(s.inputFocused, 'the input takes focus, so you can just type');
    check(s.inputW >= 200, `and it is a REAL field, not an 80px bar squeeze (${s.inputW}px wide)`);
    check(s.crownExpanded === 'true', 'the crown reports aria-expanded=true');
    check(s.rows >= 1, `the morning brief is already on show (${s.rows} row(s))`);
    check(s.overflowX <= 0, `no horizontal overflow with it open (${s.overflowX}px)`);

    // ---- B) below the header, crown still hittable, one target toggles ----
    check(s.sheetZ < s.headerZ, `the sheet sits below the header (${s.sheetZ} < ${s.headerZ})`);
    check(s.crownHittable, 'so the crown is still the top hit at its own centre');
    check(s.crownW >= 40, `and the crown has not been squeezed (${s.crownW}px — it collapsed to 27 once)`);
    // E) Real pressure: the condensed bar reveals #admin-head-title (flex:1 1 auto)
    // with the screen's name in it. A long name is the one thing in the shipped
    // layout that can squeeze `.logo`, so that is what the pin has to survive.
    const squeeze = await page.evaluate(async () => {
        const t = document.getElementById('admin-head-title');
        if (t) { t.textContent = 'Seasonal rates — all cottages, every month'; t.classList.add('has-title'); }
        document.querySelector('header').classList.add('header-condensed');
        await new Promise((r) => setTimeout(r, 400));
        return { crownW: Math.round(document.querySelector('.logo').getBoundingClientRect().width) };
    });
    check(squeeze.crownW >= 40, `and survives a long screen name in the condensed bar (${squeeze.crownW}px)`);
    await page.evaluate(() => {
        document.querySelector('header').classList.remove('header-condensed');
        const t = document.getElementById('admin-head-title');
        if (t) { t.textContent = ''; t.classList.remove('has-title'); }
    });
    await page.click('.logo');
    await page.waitForTimeout(500);
    s = await snap(page);
    check(!s.open, 'tapping the crown again closes it (one target, both ways)');

    // ---- D) scrim closes it ----
    await page.click('.logo');
    await page.waitForTimeout(500);
    await page.mouse.click(195, 700);
    await page.waitForTimeout(400);
    s = await snap(page);
    check(!s.open, 'a tap outside the sheet closes it');

    // ---- D) Escape closes AND hands focus back ----
    await page.click('.logo');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    s = await snap(page);
    check(!s.open, 'Escape closes it');
    check(s.crownFocused, 'and hands the focus ring back to the crown');

    // ---- C) Enter hands the query to the search page ----
    await page.click('.logo');
    await page.waitForTimeout(500);
    await page.fill('#crown-ask', 'who owes me');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    s = await snap(page);
    check(!s.open, 'Enter closes the sheet');
    check(s.cmdkOpen === true, `and opens the one search window over the workspace (open=${s.cmdkOpen})`);
    check(s.activeView !== 'view-search', `without leaving the workspace (${s.activeView})`);
    check(s.searchInput === 'who owes me', `carrying the query across (“${s.searchInput}”)`);

    // ---- the crown carries the assistant's state, as the retired knot did ----
    const st = await page.evaluate(() => {
        const crown = document.querySelector('.logo');
        chbSetModelStatus(crown, 'understood');
        const a = crown.dataset.mstate;
        chbModelLoadProgress('test', 0.4);
        const ring = crown.classList.contains('ml-loading');
        const frac = crown.style.getPropertyValue('--mload');
        chbModelLoadProgress('test', null);
        return { a, ring, frac, cleared: crown.classList.contains('ml-loading') };
    });
    check(st.a === 'understood', `the crown shows the model state (${st.a})`);
    check(st.ring && st.frac.trim() === '0.4', `and the download ring with its progress (--mload ${st.frac.trim()})`);
    check(!st.cleared, 'which clears when the download finishes');

    // ---- reduced motion: it still appears, it just doesn't spring ----
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { try { nav('view-backoffice'); } catch (e) {} });
    await page.waitForTimeout(300);
    await page.click('.logo');
    await page.waitForTimeout(500);
    s = await snap(page);
    check(s.open && s.sheetOpacity === '1', 'with reduced motion the sheet still appears (it is information)');
    check(s.sheetTransform === 'none', `it just does not spring in (${s.sheetTransform})`);
    await page.emulateMedia({ reducedMotion: null });

    // ---- F) SELF-HEALING after sign-out. The crown stays bound to the admin
    // handler (admin.js is already evaluated and cannot be un-run), and the same
    // element is the public site's Home link — so the handler itself must notice
    // owner-mode has gone and just navigate home instead of opening an owner sheet.
    const healed = await page.evaluate(async () => {
        crownSheetClose();
        document.body.classList.remove('owner-mode');
        isAuthenticated = false;
        document.querySelector('.logo').click();
        await new Promise((r) => setTimeout(r, 500));
        const sheet = document.getElementById('crown-sheet');
        return {
            stillBound: document.querySelector('.logo').getAttribute('data-act'),
            sheetOpened: !!(sheet && sheet.classList.contains('open')),
            view: (document.querySelector('.page-view.active') || {}).id || null,
        };
    });
    check(healed.stillBound === 'crownSheetToggle', 'after sign-out the crown is still bound to the admin handler (it must self-heal)');
    check(!healed.sheetOpened, 'so tapping it does NOT open an owner-only sheet for a signed-out visitor');
    check(healed.view === 'view-main', `it navigates Home instead (${healed.view})`);

    console.log(fails ? `\n  ${fails} CROWN-SHEET CHECK(S) FAILED ❌` : '\n  CROWN-SHEET SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
