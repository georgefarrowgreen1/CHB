// ============================================================
//  ui-test-msgscreen.js — Messages is a SCREEN on a phone, not a pop-up
//  (approved demo: "remove the pop up … can the messages become a screen
//  instead of a pop up with a back button?").
//
//    §1 no floating Messages pill on You or the pages under it ("Message us"
//       is a row there), and it still shows on the homepage;
//    §2 "Message us" carries the › its neighbours carry, since it opens a screen;
//    §3 Messages is pushed in from the right (not raised as a sheet), wears an
//       edge shadow while it moves and the keyboard-covering ground at rest, and
//       the page it was opened from steps aside and dims underneath;
//    §4 a back link names where it goes (You, Your details, a cottage, Home)
//       and the × is not drawn;
//    §5 the page's own tab stays lit and the bar reads "Messages";
//    §6 back slides it off, the page returns to where it was, and Escape and
//       the phone's Back do the same;
//    §7 leaving by the menu never slides the page you arrive at;
//    §8 the installed app takes a drag from the left edge: a short one springs
//       back, a long one or a flick goes back, a vertical one does nothing —
//       and Safari, which has its own swipe back, gets no strip;
//    §9 a computer keeps the corner panel with its ×;
//    §10 reduced motion keeps the screen and drops the movement.
//
//  Break-tested: the pill rule, the chevron, the push keyframes, the edge
//  shadow, the back name, the lit tab, the strip gate and the spring-back each
//  fail their named checks. §7 is a property, not a break-test of nav()'s order:
//  with closeChat moved back after the switch it still passes, because nothing
//  reads style between the two, so the arriving page never takes the -30%.
// ============================================================
const { bootBrowser } = require('./ui-test-lib');

const GUEST = { id: 9, name: 'Laura Smith', email: 'laura@x.co', phone: '', address: '', postcode: '' };

function stub(page) {
    return page.route(/\.php/, (r) => {
        const url = r.request().url();
        const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        let b = {};
        try {
            b = JSON.parse(r.request().postData() || '{}');
        } catch (e) {}
        if (url.includes('auth.php')) {
            if (b.action === 'admin_status') return json({ ok: true, admin: false });
            if (b.action === 'guest_status') return json({ ok: true, guest: GUEST });
            return json({ ok: true });
        }
        if (url.includes('rates.php'))
            return json({
                properties: [
                    { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 130, booking_fee: 75, max_adults: 2, max_children: 1, max_total: 3, sort_order: 1 },
                    { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
                ],
                seasons: {},
                occupancy: {},
            });
        if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [], enquiries: [], completed_stays: 0 });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], messages: [], reviews: [], photos: [], experiences: [], content: {}, blocks: [], ranges: [], properties: [], events: [], results: [] });
    });
}

(async () => {
    const t = await bootBrowser();
    let fails = 0;
    const check = (c, m, extra) => {
        console.log(`  ${c ? '✓' : '✗'} ${m}${c || extra === undefined ? '' : '  → ' + extra}`);
        if (!c) fails++;
    };
    const open = async (o = {}) => {
        const page = await t.browser.newPage({ viewport: o.vp || { width: 390, height: 844 }, hasTouch: !!o.touch, reducedMotion: o.rm ? 'reduce' : 'no-preference' });
        page.on('pageerror', (e) => {
            console.log('  PAGEERR:', e.message);
            fails++;
        });
        await page.addInitScript(() => {
            navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.reject(new Error('stubbed')));
        });
        if (o.standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
        await stub(page);
        await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof currentGuest !== 'undefined' && currentGuest && typeof openGuestAccount === 'function', null, { timeout: 15000 });
        await page.waitForTimeout(500);
        return page;
    };
    const painted = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
    const youRow = (page, label) => page.evaluate((l) => {
        const row = [...document.querySelectorAll('#guest-account-body .ga-row')].find((x) => (x.querySelector('.ga-t') || {}).textContent === l);
        return row ? { chev: !!row.querySelector('.ga-chev') } : null;
    }, label);
    const tapRow = (page, label) => page.evaluate((l) => [...document.querySelectorAll('#guest-account-body .ga-row')].find((x) => (x.querySelector('.ga-t') || {}).textContent === l).click(), label);
    const atRest = (page) => page.waitForFunction(() => {
        const w = document.getElementById('chat-widget');
        return w.classList.contains('open') && w.getAnimations().length === 0;
    }, null, { timeout: 5000 }).catch(() => {});
    const gone = (page) => page.waitForFunction(() => {
        const w = document.getElementById('chat-widget');
        return !w.classList.contains('open') && !w.classList.contains('closing');
    }, null, { timeout: 5000 }).catch(() => {});
    const state = (page) => page.evaluate(() => {
        const w = document.getElementById('chat-widget');
        const pg = document.querySelector('.page-view.active');
        const m = /0px 0px 0px (\d+(?:\.\d+)?)px/.exec(getComputedStyle(w).boxShadow);
        return {
            open: w.classList.contains('open'),
            anims: w.getAnimations().map((a) => a.animationName),
            spread: m ? parseFloat(m[1]) : 0,
            shadow: getComputedStyle(w).boxShadow,
            pageTr: getComputedStyle(pg).translate,
            dim: parseFloat(getComputedStyle(document.getElementById('chat-dim')).opacity),
            screen: document.body.classList.contains('chat-screen'),
            back: (document.getElementById('chat-back-l') || {}).textContent,
            backLabel: document.getElementById('chat-back').getAttribute('aria-label'),
            backPainted: document.getElementById('chat-back').getClientRects().length > 0,
            xPainted: w.querySelector('.chat-widget-head .reviews-modal-close').getClientRects().length > 0,
            lit: [...document.querySelectorAll('#guest-dock-slot .guest-dock-btn.current')].map((b) => b.dataset.tab),
            title: (document.getElementById('guest-head-title') || {}).textContent,
            edge: document.getElementById('chat-edge').getClientRects().length > 0,
            scrollY: Math.round(window.scrollY),
        };
    });

    // ============================================================
    console.log('\n  §1 no floating Messages pill on You');
    let page = await open();
    check(await painted(page, '#guest-msg-fab'), '(control) the pill shows on the homepage');
    await page.evaluate(() => openGuestAccount());
    await page.waitForTimeout(400);
    check(!(await painted(page, '#guest-msg-fab')), 'on You the pill is gone — Message us is a row on the page');
    for (const sub of ['details', 'security', 'privacy']) {
        await page.evaluate((s) => gaGo(s), sub);
        await page.waitForTimeout(200);
        check(!(await painted(page, '#guest-msg-fab')), `…and on the ${sub} page under You`);
    }
    await page.evaluate(() => gaGo(''));
    await page.waitForTimeout(200);

    // ============================================================
    console.log('\n  §2 Message us carries the › its neighbours carry');
    const mu = await youRow(page, 'Message us');
    const bt = await youRow(page, 'Booking terms');
    check(!!bt && bt.chev, '(control) Booking terms carries the ›');
    check(!!mu && mu.chev, 'Message us carries the › — it opens a screen');

    // ============================================================
    console.log('\n  §3 it is pushed in from the right, and the page steps aside');
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
    await page.waitForTimeout(150);
    const y0 = await page.evaluate(() => Math.round(window.scrollY));
    await tapRow(page, 'Message us');
    await page.waitForTimeout(60);
    const moving = await state(page);
    check(moving.anims.includes('chbPushIn') && !moving.anims.includes('chbSheetUp'), `it arrives as a push, not a sheet (${moving.anims.join(',')})`);
    check(moving.spread === 0 && /-18px 0px 40px/.test(moving.shadow), 'while it moves it wears an edge shadow, so the page shows beside it', moving.shadow.slice(0, 60));
    await atRest(page);
    const rest = await state(page);
    check(rest.spread >= 844, 'at rest its own ground covers past its box again (the iOS keyboard fix)', rest.shadow.slice(0, 60));
    check(rest.pageTr === '-30%', `the page underneath has stepped a third to the left (${rest.pageTr})`);
    check(rest.dim > 0.05, `…and is dimmed (${rest.dim})`);

    // ============================================================
    console.log('\n  §4 the back link names where it goes');
    check(rest.backPainted && rest.back === 'You', `it reads "You" (${rest.back})`);
    check(rest.backLabel === 'Back to You', `its name says where it goes (${rest.backLabel})`);
    check(!rest.xPainted, 'the × is not drawn on the phone');

    // ============================================================
    console.log('\n  §5 the page keeps its tab, and the bar names the screen');
    check(rest.lit.length === 1 && rest.lit[0] === 'account', `You stays lit while Messages is open (${rest.lit.join(',') || 'nothing'})`);
    check(rest.title === 'Messages', `the bar reads "Messages" (${rest.title})`);

    // ============================================================
    console.log('\n  §6 back slides it off, and the page is where it was');
    await page.click('#chat-back');
    await page.waitForTimeout(40);
    const leaving = await state(page);
    check(!leaving.open && leaving.anims.includes('chbPushOut'), `it leaves to the right (${leaving.anims.join(',')})`);
    await gone(page);
    await page.waitForTimeout(400);
    const after = await state(page);
    check(!after.screen && after.pageTr === 'none', `the page is back in place (${after.pageTr})`);
    check(after.dim === 0, 'the dim is gone');
    check(Math.abs(after.scrollY - y0) <= 2, `the page is scrolled where it was (${after.scrollY} vs ${y0})`);
    check(after.title === 'You', `the bar names the page again (${after.title})`);
    // Escape and the phone's Back do the same.
    await page.evaluate(() => toggleChat());
    await atRest(page);
    await page.keyboard.press('Escape');
    await gone(page);
    check(!(await state(page)).open, 'Escape closes it');
    await page.evaluate(() => toggleChat());
    await atRest(page);
    await page.goBack();
    await gone(page);
    const bk = await state(page);
    check(!bk.open && (await page.evaluate(() => document.querySelector('.page-view.active').id)) === 'view-guest-account', 'the phone’s Back closes it and stays on You');

    // The name follows the page it was opened over.
    await page.evaluate(() => gaGo('details'));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#guest-account-body .ga-link[data-act="toggleChat"]').click());
    await atRest(page);
    let s = await state(page);
    check(s.back === 'Your details' && s.backLabel === 'Back to Your details', `from Your details it reads "Your details" (${s.back})`);
    await page.evaluate(() => closeChat());
    await gone(page);
    await page.evaluate(() => openProperty('jollyboat'));
    await page.waitForTimeout(500);
    await page.evaluate(() => toggleChat());
    await atRest(page);
    s = await state(page);
    const cottage = await page.evaluate(() => document.getElementById('prop-title').textContent.trim());
    check(!!cottage && s.back === cottage, `from a cottage it reads the cottage's own name (${s.back} / ${cottage})`);
    await page.evaluate(() => closeChat());
    await gone(page);
    await page.evaluate(() => nav('view-main'));
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleChat());
    await atRest(page);
    s = await state(page);
    check(s.back === 'Home', `from the homepage it reads "Home" (${s.back})`);

    // ============================================================
    console.log('\n  §7 leaving by the menu never slides the page you arrive at');
    const arrive = await page.evaluate(async () => {
        nav('view-cottages');
        const pg = document.querySelector('.page-view.active');
        const seen = [getComputedStyle(pg).translate];
        for (let i = 0; i < 6; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            seen.push(getComputedStyle(pg).translate);
        }
        return { id: pg.id, seen, open: document.getElementById('chat-widget').classList.contains('open') };
    });
    check(arrive.id === 'view-cottages' && !arrive.open, '(fixture) the menu left Messages for Cottages');
    check(arrive.seen.every((v) => v === 'none'), `Cottages arrives in place, never from the side (${[...new Set(arrive.seen)].join(',')})`);
    await page.close();

    // ============================================================
    console.log('\n  §8 the installed app takes a drag from the left edge');
    page = await open();
    await page.evaluate(() => toggleChat());
    await atRest(page);
    check(!(await state(page)).edge, 'in Safari there is no strip (Safari’s own swipe back closes it)');
    await page.close();
    page = await open({ standalone: true, touch: true });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await page.evaluate(() => openGuestAccount());
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleChat());
    await atRest(page);
    check((await state(page)).edge, 'installed, the strip is there');
    // A short drag: the page and the dim follow the finger, then it springs back.
    await touch('touchStart', 4, 500);
    for (let x = 10; x <= 90; x += 10) {
        await touch('touchMove', x, 500);
        await page.waitForTimeout(30);
    }
    const mid = await page.evaluate(() => ({ tr: document.getElementById('chat-widget').style.transform, pageTr: parseFloat(getComputedStyle(document.querySelector('.page-view.active')).translate), shadow: getComputedStyle(document.getElementById('chat-widget')).boxShadow }));
    check(/translateX\(8\dpx\)/.test(mid.tr), `the screen follows the finger (${mid.tr})`);
    check(mid.pageTr < -1 && mid.pageTr > -30, `…and the page comes back with it (${mid.pageTr}%)`);
    check(/-18px 0px 40px/.test(mid.shadow), 'while dragged it wears the edge shadow');
    await page.waitForTimeout(300); // let the finger stop, so the release is not a flick
    await touch('touchEnd');
    await page.waitForTimeout(500);
    s = await state(page);
    check(s.open && (await page.evaluate(() => getComputedStyle(document.getElementById('chat-widget')).transform)) === 'none', 'a short drag springs back');
    check(s.pageTr === '-30%' && s.spread >= 844, 'the page steps aside again and the ground is back');
    // A long drag goes back.
    await touch('touchStart', 4, 500);
    for (let x = 20; x <= 240; x += 20) {
        await touch('touchMove', x, 500);
        await page.waitForTimeout(30);
    }
    await page.waitForTimeout(250);
    await touch('touchEnd');
    await page.waitForTimeout(40);
    const lv = await page.evaluate(() => {
        const w = document.getElementById('chat-widget');
        const m = /matrix\(1, 0, 0, 1, ([\d.]+), 0\)/.exec(getComputedStyle(w).transform);
        return { anims: w.getAnimations().map((a) => a.animationName), x: m ? parseFloat(m[1]) : 0 };
    });
    check(lv.anims.includes('chbPushOut') && lv.x >= 230, `a long drag goes back, leaving from under the finger (${lv.x}px)`);
    await gone(page);
    // The page's own slide back (320ms) outlasts the screen's exit (300ms).
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.page-view.active')).translate === 'none', null, { timeout: 3000 }).catch(() => {});
    s = await state(page);
    check(!s.open && s.pageTr === 'none', `and the page is back in place (${s.pageTr})`);
    // A flick goes back.
    await page.evaluate(() => toggleChat());
    await atRest(page);
    await touch('touchStart', 4, 500);
    await touch('touchMove', 30, 500);
    await page.waitForTimeout(16);
    await touch('touchMove', 70, 500);
    await page.waitForTimeout(16);
    await touch('touchMove', 110, 500);
    await touch('touchEnd');
    await gone(page);
    check(!(await state(page)).open, 'a short fast flick goes back');
    // A vertical drag on the strip is not a swipe.
    await page.evaluate(() => toggleChat());
    await atRest(page);
    await touch('touchStart', 6, 400);
    for (let y = 410; y <= 520; y += 10) {
        await touch('touchMove', 8, y);
        await page.waitForTimeout(16);
    }
    await touch('touchEnd');
    await page.waitForTimeout(400);
    s = await state(page);
    check(s.open && !(await page.evaluate(() => document.body.classList.contains('chat-dragging'))), 'a vertical drag on the strip does nothing');
    await page.close();

    // ============================================================
    console.log('\n  §9 a computer keeps the corner panel');
    page = await open({ vp: { width: 1280, height: 900 } });
    await page.evaluate(() => toggleChat());
    await page.waitForTimeout(60);
    const dk = await state(page);
    check(dk.anims.includes('chbChatIn'), `it opens as the panel it always was (${dk.anims.join(',')})`);
    await page.waitForTimeout(500);
    const dk2 = await state(page);
    check(dk2.xPainted && !dk2.backPainted, 'with its ×, and no back link');
    check(dk2.pageTr === 'none' && !dk2.edge, 'the page does not move and there is no strip');
    check(!(await painted(page, '#chat-dim')), 'nothing dims the page');
    await page.close();

    // ============================================================
    console.log('\n  §10 reduced motion keeps the screen and drops the movement');
    page = await open({ rm: true });
    await page.evaluate(() => openGuestAccount());
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleChat());
    await page.waitForTimeout(60);
    const rm = await state(page);
    check(rm.open && rm.anims.length === 0, `no push animation (${rm.anims.join(',') || 'none'})`);
    check(rm.backPainted && rm.back === 'You' && !rm.xPainted, 'still a screen with its back link');
    check(rm.pageTr === 'none', `the page does not move underneath (${rm.pageTr})`);
    await page.close();

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌` : '\n  MESSAGES SCREEN TEST PASSED ✅');
    await t.done(fails);
})();
