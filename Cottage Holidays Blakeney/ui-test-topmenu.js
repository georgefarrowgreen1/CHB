// ============================================================
//  ui-test-topmenu.js — the customer menu sits in the HEADER on mobile, the
//  same place it does on desktop (Option C).
//
//  guest-app.js does not build a second nav: placeDock() MOVES the existing
//  .guest-dock node into #guest-dock-slot in the header, so every button
//  handler, setActiveTab and the sliding indicator keep working. That makes the
//  things worth testing structural rather than cosmetic:
//
//    A) on a phone the dock is INSIDE the header, and the header is visible;
//    B) the standalone Messages pill (a second .guest-dock) is NOT the one that
//       moved — that bug puts the chat bubble in the header and leaves the nav
//       behind;
//    C) "Check availability" stays BOTTOM-anchored, in thumb reach (it lives in
//       #guest-tabbar, which must not travel with the menu);
//    D) crossing the 768px boundary re-parents both ways, live;
//    E) the header out-ranks the full-page guest screens (chat/auth, z-index
//       1390) so the menu is still tappable over them — otherwise a guest who
//       opens Messages cannot navigate out;
//    F) content clears the header instead of sitting under it.
// ============================================================
const { boot, ok } = require('./ui-test-lib');

(async () => {
    let fails = 0;
    const check = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const snap = () =>
        page.evaluate(() => {
            const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
            const header = document.querySelector('header');
            const slot = document.getElementById('guest-dock-slot');
            const wrap = document.getElementById('guest-tabbar');
            const navDock = slot ? slot.querySelector('.guest-dock') : null;
            const inWrap = wrap ? wrap.querySelector('.guest-dock') : null;
            const msgDock = document.querySelector('#guest-msg-fab .guest-dock');
            const tabs = (navDock || inWrap)
                ? [...(navDock || inWrap).querySelectorAll('.guest-dock-btn')].map((b) => b.dataset.tab)
                : [];
            const hr = header ? header.getBoundingClientRect() : null;
            const title = document.querySelector('.hero h1, .hero-inner h1');
            return {
                guestApp: document.body.classList.contains('guest-app'),
                headerVisible: vis(header),
                dockInHeader: !!navDock,
                dockInWrap: !!inWrap,
                tabs,
                // the Messages pill must still be its own thing, outside the header
                msgOutsideHeader: !!msgDock && !(header && header.contains(msgDock)),
                headerZ: header ? +getComputedStyle(header).zIndex || 0 : 0,
                headerBottom: hr ? Math.round(hr.bottom) : null,
                titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
                hamburger: vis(document.querySelector('.menu-toggle')),
                overflowX: document.documentElement.scrollWidth - window.innerWidth,
            };
        });

    // ---- A/B/F: phone ----
    let s = await snap();
    check(s.guestApp, 'the guest shell is active at 390px');
    check(s.headerVisible, 'the header is visible on mobile (it used to be display:none)');
    check(s.dockInHeader && !s.dockInWrap, 'the menu dock is INSIDE the header');
    check(s.tabs.includes('experiences') && s.tabs.includes('cottages') && s.tabs.includes('account'),
        `the real nav moved, with its tabs intact (${s.tabs.join(',')})`);
    check(s.msgOutsideHeader, 'the standalone Messages pill did NOT move into the header');
    check(!s.hamburger, 'the now-redundant hamburger is hidden');
    check(s.titleTop == null || s.titleTop >= s.headerBottom, `hero text clears the header (title ${s.titleTop} vs header ${s.headerBottom})`);
    check(s.overflowX <= 0, `no horizontal overflow (${s.overflowX}px)`);

    // ---- E: the menu must out-rank the full-page guest screens ----
    const z = await page.evaluate(() => {
        const zi = (sel) => {
            const el = document.querySelector(sel);
            return el ? +getComputedStyle(el).zIndex || 0 : null;
        };
        return { header: zi('header'), chat: zi('#chat-widget'), auth: zi('#guest-auth-modal') };
    });
    check(z.header > z.chat, `the header out-ranks the Messages page (${z.header} > ${z.chat}) so the menu stays tappable`);
    check(z.header > z.auth, `the header out-ranks the account pages (${z.header} > ${z.auth})`);

    // ---- C: the booking pill stays in thumb reach on a cottage page ----
    const cta = await page.evaluate(async () => {
        try { openProperty('21a'); } catch (e) {}
        await new Promise((r) => setTimeout(r, 700));
        const el = document.getElementById('guest-book-cta');
        const visible = !!el && getComputedStyle(el).display !== 'none';
        const r = visible ? el.getBoundingClientRect() : null;
        const header = document.querySelector('header');
        return {
            visible,
            top: r ? Math.round(r.top) : null,
            vh: window.innerHeight,
            inHeader: !!(el && header && header.contains(el)),
        };
    });
    check(cta.visible, 'the cottage page still shows "Check availability"');
    check(!cta.inHeader, 'the CTA did NOT travel into the header with the menu');
    check(cta.top > cta.vh * 0.6, `the CTA is still bottom-anchored, in thumb reach (top ${cta.top} of ${cta.vh})`);

    // ---- D: crossing the breakpoint re-parents both ways ----
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(600);
    s = await snap();
    check(!s.guestApp, 'the shell switches off on desktop');
    check(s.dockInWrap && !s.dockInHeader, 'on desktop the dock returns to its floating wrapper');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    s = await snap();
    check(s.dockInHeader && !s.dockInWrap, 'coming back to a phone puts it in the header again');
    check(s.tabs.length > 0, `the tabs survived the round trip (${s.tabs.join(',')})`);

    console.log(fails ? `\n  ${fails} TOP-MENU CHECK(S) FAILED ❌` : '\n  TOP-MENU SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
