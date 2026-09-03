// ============================================================
//  ui-test-adminmenu.js — the ADMIN nav lives in the header, mirroring the
//  customer menu.
//
//  owner-mode used to hide the header outright (`display: none !important`) and
//  float the dock at the bottom of the screen — exactly where the guest side was
//  before the menu moved up. Both now put navigation in one bar at the top.
//
//  Unlike the guest dock this needs no re-parenting: the admin dock is static
//  markup with a single home, so it simply lives inside <header>. What DOES need
//  pinning is everything that broke on the way there:
//
//    A) the dock must be in the header, and visible — `header nav { display:none }`
//       (meant for the CUSTOMER nav) also matched the admin dock, which is itself a
//       <nav>, and hid the whole menu;
//    B) the guest dock must VACATE the header when the owner signs in — nothing
//       re-evaluated its placement on a body-class change, so on a phone it stayed
//       behind as a 60px ghost inside the admin bar;
//    C) the selection pill must stay centred on its icon, at rest and condensed;
//    D) the pill must travel by transform and the icons must not animate layout
//       (the guest side stuttered doing that);
//    E) scrolling condenses and never hides — the bar carries the nav now.
// ============================================================
const { boot } = require('./ui-test-lib');

const stub = (page) => page.route(/\.php/, (r) => {
    const url = r.request().url();
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('auth.php')) {
        let b = {};
        try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
        if (b.action === 'admin_status') return json({ ok: true, admin: true });
        if (b.action === 'guest_status') return json({ ok: true, guest: null });
        return json({ ok: true });
    }
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], events: [], enquiries: [], threads: [], reviews: [], photos: [], mine: {}, value: null, properties: [] });
});

(async () => {
    let fails = 0;
    const check = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await stub(page);
    await page.goto(t.base + '/index.html', { waitUntil: 'networkidle' });
    // Sign in as the owner AFTER load, which is what real life does — and what
    // stranded the guest dock in the header.
    await page.evaluate(async () => {
        isAuthenticated = true;
        document.body.classList.add('owner-mode');
        await window.loadAdminBundle();
    });
    await page.waitForTimeout(700);
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    await page.evaluate(async () => {
        try { await initBackOffice(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 800));
    });

    const snap = () =>
        page.evaluate(() => {
            const h = document.querySelector('header');
            const dock = document.querySelector('.admin-dock');
            const wrap = document.querySelector('.admin-dock-wrap');
            const ind = dock ? dock.querySelector('.admin-dock-indicator') : null;
            const cur = dock ? dock.querySelector('.admin-dock-btn.current') : null;
            const ttl = document.getElementById('admin-head-title');
            const ib = ind ? ind.getBoundingClientRect() : null;
            const cb = cur ? cur.getBoundingClientRect() : null;
            const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
            return {
                headerVisible: vis(h),
                barH: Math.round(h.getBoundingClientRect().height),
                dockInHeader: !!(wrap && h.contains(wrap)),
                dockVisible: vis(dock),
                buttons: dock ? [...dock.querySelectorAll('.admin-dock-btn')].filter((b) => b.offsetParent !== null).length : 0,
                // The icons were white for a DARK floating pill; on the light bar
                // that made them invisible. Compare each icon's ink to the bar.
                inkVsBar: (() => {
                    const rgb = (v) => (v.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
                    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
                    const bar = rgb(getComputedStyle(h).backgroundColor);
                    if (!bar.length || !dock) return null;
                    const bl = lum(bar);
                    return [...dock.querySelectorAll('.admin-dock-btn')]
                        .filter((b) => b.offsetParent !== null)
                        .map((b) => Math.round(Math.abs(lum(rgb(getComputedStyle(b).color)) - bl)));
                })(),
                curView: cur ? cur.getAttribute('data-view') : null,
                dx: ib && cb ? +((ib.left + ib.width / 2) - (cb.left + cb.width / 2)).toFixed(1) : null,
                indW: ib ? Math.round(ib.width) : null,
                btnW: cb ? Math.round(cb.width) : null,
                title: ttl ? ttl.textContent : null,
                titleOpacity: ttl ? getComputedStyle(ttl).opacity : null,
                titleHidden: ttl ? getComputedStyle(ttl).display === 'none' : null,
                condensed: h.classList.contains('header-condensed'),
                hidden: h.classList.contains('header-hidden'),
                // B) the guest shell's slot must not linger in the admin bar
                guestSlotInHeader: !!document.getElementById('guest-dock-slot'),
                guestDockInHeader: !!h.querySelector('.guest-dock'),
                overflowX: document.documentElement.scrollWidth - window.innerWidth,
                indTransition: ind ? getComputedStyle(ind).transitionProperty : '',
                btnTransition: cur ? getComputedStyle(cur).transitionProperty : '',
                menuHittable: (() => {
                    if (!cur) return false;
                    const q = cur.getBoundingClientRect();
                    const hit = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
                    return !!(hit && (hit === cur || cur.contains(hit) || hit.closest('.admin-dock')));
                })(),
            };
        });

    // ---- A) in the header, and actually visible ----
    let s = await snap();
    check(s.headerVisible, 'the header is visible in owner-mode (it used to be display:none)');
    check(s.dockInHeader, 'the admin dock is INSIDE the header');
    check(s.dockVisible, 'the dock is visible — `header nav` must not match it (it is a <nav>)');
    check(s.buttons >= 4, `its buttons are all there (${s.buttons})`);
    check(s.curView === 'view-backoffice', `the current screen is marked (${s.curView})`);
    check(s.overflowX <= 0, `no horizontal overflow (${s.overflowX}px)`);
    check(
        s.inkVsBar && s.inkVsBar.every((d) => d > 40),
        `every icon contrasts with the light bar — they were white-on-white (deltas: ${(s.inkVsBar || []).join(', ')})`,
    );

    // ---- B) the guest dock got out of the way ----
    check(!s.guestDockInHeader, 'the guest dock is NOT left in the admin header');
    check(!s.guestSlotInHeader, 'and neither is its empty slot');

    // ---- C/D) pill centred, and animated the cheap way ----
    check(s.dx !== null && Math.abs(s.dx) <= 1, `the selection pill is centred on its icon (off by ${s.dx}px)`);
    check(Math.abs(s.indW - s.btnW) <= 1, `and matches its size (${s.indW} vs ${s.btnW})`);
    check(/translate/.test(s.indTransition), `the pill travels on a transform (${s.indTransition})`);
    check(!/\b(width|height|left)\b/.test(s.indTransition), 'it does not animate layout properties');
    check(!/\b(width|height)\b/.test(s.btnTransition), `nor do the icon buttons (${s.btnTransition})`);

    // ---- E) scroll condenses, never hides; pill holds its place ----
    // The stubbed back office has no data, so the page is too short to scroll and
    // the handler would never fire. Give it real height, then scroll for real —
    // forcing the class instead would test the CSS but not the trigger.
    const cond = await page.evaluate(async () => {
        const av = document.querySelector('.page-view.active') || document.body;
        const spacer = document.createElement('div');
        spacer.id = 'scroll-spacer';
        spacer.style.height = '2000px';
        av.appendChild(spacer);
        await new Promise((r) => setTimeout(r, 100));
        window.scrollTo(0, 600);
        await new Promise((r) => setTimeout(r, 800));
        return { y: Math.round(window.scrollY) };
    });
    check(cond.y > 24, `the page actually scrolled, so the handler ran (y=${cond.y})`);
    s = await snap();
    check(s.condensed, 'scrolling condenses the admin bar');
    check(!s.hidden, 'it is never hidden — the nav is in it now');
    check(s.headerVisible, 'so the menu is still on screen while scrolled');
    check(s.menuHittable, 'and still tappable');
    check(s.dx !== null && Math.abs(s.dx) <= 1, `the pill stays centred once condensed (off by ${s.dx}px)`);
    check(Math.abs(s.indW - s.btnW) <= 1, `and still matches its size (${s.indW} vs ${s.btnW})`);
    // At 390 the slot between the crown and six dock icons is one character wide
    // — it painted "T." for Today. A letter is not a name, so the title STANDS
    // DOWN below 480 (the page's own heading names the screen) and paints where
    // a name fits. Both halves gated: hidden here, named at 480 below.
    check(s.titleHidden === true, 'at 390 the condensed bar carries NO title — the slot is a letter wide');
    check(!!s.title, `the name is still SET, ready for a width that fits ("${s.title}")`);

    const back = await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
        const sp = document.getElementById('scroll-spacer');
        if (sp) sp.remove();
        await new Promise((r) => setTimeout(r, 800));
        const h = document.querySelector('header');
        const ttl = document.getElementById('admin-head-title');
        return { condensed: h.classList.contains('header-condensed'), titleOpacity: ttl ? getComputedStyle(ttl).opacity : null };
    });
    check(!back.condensed, 'scrolling back to the top expands it again');
    check(back.titleOpacity === '0', 'and the title hides again, so the page heading is not echoed');

    // ---- where a name FITS (480), the condensed bar names the screen ----
    await page.setViewportSize({ width: 480, height: 844 });
    const wide = await page.evaluate(async () => {
        const av = document.querySelector('.page-view.active') || document.body;
        const spacer = document.createElement('div');
        spacer.id = 'scroll-spacer';
        spacer.style.height = '2000px';
        av.appendChild(spacer);
        await new Promise((r) => setTimeout(r, 100));
        window.scrollTo(0, 600);
        await new Promise((r) => setTimeout(r, 900));
        const ttl = document.getElementById('admin-head-title');
        const out = { title: ttl ? ttl.textContent : null, opacity: ttl ? getComputedStyle(ttl).opacity : null, display: ttl ? getComputedStyle(ttl).display : null };
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
        spacer.remove();
        await new Promise((r) => setTimeout(r, 800));
        return out;
    });
    check(wide.display !== 'none' && wide.opacity === '1' && !!wide.title, `at 480 the condensed bar names the screen ("${wide.title}")`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    // ---- switching screens moves the pill and renames the bar ----
    const moved = await page.evaluate(async () => {
        const before = document.querySelector('.admin-dock-indicator').style.translate;
        const btn = document.querySelector('.admin-dock-btn[data-view="view-inbox"]');
        if (!btn) return { skip: true };
        btn.click();
        await new Promise((r) => setTimeout(r, 1100));
        const dock = document.querySelector('.admin-dock');
        const ind = dock.querySelector('.admin-dock-indicator');
        const cur = dock.querySelector('.admin-dock-btn.current');
        const ib = ind.getBoundingClientRect(), cb = cur ? cur.getBoundingClientRect() : null;
        return {
            before, after: ind.style.translate,
            curView: cur ? cur.getAttribute('data-view') : null,
            dx: cb ? +((ib.left + ib.width / 2) - (cb.left + cb.width / 2)).toFixed(1) : null,
            title: (document.getElementById('admin-head-title') || {}).textContent,
        };
    });
    if (moved.skip) {
        console.log('  · Inbox button not present — skipped');
    } else {
        check(moved.before !== moved.after, `the pill travels to the new screen (${moved.before} → ${moved.after})`);
        check(moved.curView === 'view-inbox', `the new screen is marked (${moved.curView})`);
        check(Math.abs(moved.dx) <= 1, `and the pill lands centred (off by ${moved.dx}px)`);
        check(/inbox/i.test(moved.title || ''), `the bar renames itself ("${moved.title}")`);
    }

    // ---- F) reduced motion must drop the EASING, not the layout ----
    // The bar centres itself with `left: 50%` + `translateX(-50%)`, so a
    // reduced-motion rule that blanks `transform` shoves the whole thing 185px
    // right and its icons off the screen (measured: header right 380 → 550,
    // buttons out to 550 at a 390px viewport). The layout gate caught that; this
    // pins it where the cause is legible.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    const rm = await page.evaluate(() => {
      const h = document.querySelector('header').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.admin-dock .admin-dock-btn')].filter((b) => b.offsetParent !== null);
      return {
        vw: window.innerWidth,
        left: Math.round(h.left),
        right: Math.round(h.right),
        worstBtn: Math.round(Math.max(...btns.map((b) => b.getBoundingClientRect().right))),
      };
    });
    check(rm.left >= 0 && rm.right <= rm.vw + 1, `with reduced motion the bar stays on screen (${rm.left}→${rm.right} of ${rm.vw})`);
    check(rm.worstBtn <= rm.vw + 1, `and so does every button (rightmost edge ${rm.worstBtn})`);
    await page.emulateMedia({ reducedMotion: null });

    console.log(fails ? `\n  ${fails} ADMIN-MENU CHECK(S) FAILED ❌` : '\n  ADMIN-MENU SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
