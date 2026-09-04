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

    // ---- G: the crown is ONE size, in ONE place, on every screen ----
    // Reported from a phone: "between experiences page and any other page the crown logo
    // changes size". It did. `.logo` sits in a flex row beside `#guest-head-title`, which
    // is `flex: 1 1 auto` and carries the OWNER-EDITABLE screen name — and `.logo` was left
    // at the `0 1 auto` default, so it was a shrinkable sibling. A long name therefore took
    // its share of the shortfall out of the BRAND: measured at 390px, "21A Westgate Street"
    // shrank the mark 49.9px → 38.5px, 23% smaller on the page most guests land on, while
    // Home (which deliberately has no title, the crown already says it) stayed full size.
    // The sting is that the title is `opacity: 0` until the bar condenses, so an element
    // nobody could see was resizing the logo. The title already has min-width: 0 and an
    // ellipsis, so it is the sibling that should absorb a squeeze.
    //
    // Asserted as an OUTCOME — same box, same position — rather than by reading `flex` off
    // the rule: what the guest sees is the geometry, and a declaration check would pass on
    // any future layout that pins the logo some other way while still moving it.
    const crown = () =>
        page.evaluate(() => {
            const m = document.querySelector('header .logo-mark');
            const t = document.getElementById('guest-head-title');
            if (!m) return null;
            const r = m.getBoundingClientRect();
            return {
                w: +r.width.toFixed(1), h: +r.height.toFixed(1),
                x: Math.round(r.left), y: Math.round(r.top),
                title: t ? t.textContent.trim() : '',
            };
        });
    const sweep = async () => {
        const out = {};
        for (const [label, view] of [['home', 'view-main'], ['experiences', 'view-experiences'], ['cottages', 'view-cottages'], ['cottage', 'view-21a']]) {
            await page.evaluate((v) => {
                if (v === 'view-21a') { try { openProperty('21a'); } catch (e) {} } else { try { nav(v); } catch (e) {} }
            }, view);
            await page.waitForTimeout(320);
            out[label] = await crown();
        }
        return out;
    };
    const identical = (o) => {
        const vals = Object.values(o);
        const k = (v) => (v ? `${v.w}x${v.h}@${v.x},${v.y}` : 'missing');
        return { same: vals.every((v) => v && k(v) === k(vals[0])), show: Object.entries(o).map(([n, v]) => `${n} ${k(v)}`).join(' · ') };
    };

    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('header').classList.remove('header-condensed'); });
    let rest = identical(await sweep());
    check(rest.same, `the crown is the same size and place on every page (${rest.show})`);

    // ...and in the CONDENSED bar too, which is where the title is actually VISIBLE and so
    // pushing hardest. Compared within the state, never across it: condensing scales the
    // mark 30px → 25px on purpose, so that difference is the design, not the defect.
    await page.evaluate(() => document.querySelector('header').classList.add('header-condensed'));
    await page.waitForTimeout(250);
    const cond = identical(await sweep());
    check(cond.same, `…and again once the bar condenses and the title shows (${cond.show})`);

    // A HOSTILE NAME, because the real ones are short enough that this check could pass on
    // its own — the same discipline as the injected long chip label in the search suite. The
    // cottage titles are owner-editable, so the next one could be any length.
    // NB every reading is taken BEFORE the name is put back. The first version restored it
    // first and then read `textContent` and `scrollWidth`, so it measured the SHORT title
    // and reported a clipped 19-character name — passing while proving nothing.
    const hostile = await page.evaluate(async () => {
        const mark = () => document.querySelector('header .logo-mark').getBoundingClientRect().width;
        const before = mark();
        const h = document.getElementById('prop-title');
        const was = h ? h.textContent : '';
        const LONG = 'The Old Lifeboat House at Blakeney Point, Westgate Street';
        if (h) h.textContent = LONG;
        setActiveTab('view-21a'); // the exported entry; setHeadTitle is a closure
        await new Promise((r) => setTimeout(r, 200));
        const el = document.getElementById('guest-head-title');
        const out = {
            before: +before.toFixed(1),
            after: +mark().toFixed(1),
            long: el.textContent.length,
            arrived: el.textContent === LONG,
            clipped: el.scrollWidth > Math.ceil(el.getBoundingClientRect().width),
        };
        if (h) h.textContent = was;
        setActiveTab('view-21a');
        return out;
    });
    check(hostile.arrived, `the hostile name really reached the header (${hostile.long} chars)`);
    check(Math.abs(hostile.after - hostile.before) < 0.5,
        `…and a ${hostile.long}-character screen name does not shrink the crown (${hostile.before}px → ${hostile.after}px)`);
    check(hostile.clipped, '…because the TITLE takes the squeeze and ellipsises instead');

    // H) The Messages pill stands down on the PRIVACY page — the one view whose
    //    prose runs full-width to the edge, so the fixed bubble sat on the
    //    line-ends of text being read (audit screenshot pass). Measured on the
    //    PAINT (getClientRects — the property is not the pixel), and BOTH ways
    //    so the fix can never erode into "always hidden".
    const fab = await page.evaluate(async () => {
        const painted = () => {
            const el = document.getElementById('guest-msg-fab');
            return !!el && el.getClientRects().length > 0;
        };
        nav('view-main');
        await new Promise((r) => setTimeout(r, 150));
        const onHome = painted();
        nav('view-privacy');
        await new Promise((r) => setTimeout(r, 150));
        const onPrivacy = painted();
        nav('view-main');
        await new Promise((r) => setTimeout(r, 150));
        const backHome = painted();
        return { onHome, onPrivacy, backHome };
    });
    check(fab.onHome, 'the Messages pill paints on the home page');
    check(!fab.onPrivacy, 'the pill stands down on the privacy policy — the bubble must not sit on reading text');
    check(fab.backHome, 'and it returns the moment the guest navigates away');

    // I) ?open=stay — the guest emails' "Open my booking" button. It used to be
    //    swallowed by the admin-only gate in maybeHandleNotificationOpen, so
    //    every guest who tapped it (including the arrival-day guest going for
    //    their entry details) landed on the bare homepage. Signed out, the
    //    honest destination is the sign-in; the URL is tidied either way.
    await page.goto(t.base + '/index.html?open=stay', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    const stay = await page.evaluate(() => ({
        authOpen: !!document.querySelector('#guest-auth-modal.open'),
        urlClean: !window.location.search.includes('open=stay'),
    }));
    check(stay.authOpen, '?open=stay lands a signed-out guest on the sign-in, not the bare homepage');
    check(stay.urlClean, '…and the URL is tidied so a refresh does not repeat it');

    // I) THE HALO FOLLOWS THE MARK. The "you are on Home" glow was a background on
    //    .logo, a box that never moves, while the mark scales about its left edge
    //    when the bar condenses — so the glow sat right of the crown (owner
    //    screenshot). It rides .logo::before now, scaled on the same clock about
    //    the same edge. Measured as a RELATIONSHIP in both states: the halo's centre
    //    (its box under its own transform) against the mark's painted centre.
    const halo = await page.evaluate(async () => {
        const fz = document.createElement('style'); fz.textContent = 'header,header *,header .logo::before{transition:none!important}'; document.head.appendChild(fz);
        const logo = document.querySelector('header .logo'); const mark = logo.querySelector('.logo-mark');
        setActiveTab('view-main'); await new Promise((r) => setTimeout(r, 150));
        const read = () => {
            const ps = getComputedStyle(logo, '::before'); const lr = logo.getBoundingClientRect(); const mr = mark.getBoundingClientRect();
            const m = ps.transform.match(/matrix\(([^)]+)\)/); const s = m ? parseFloat(m[1].split(',')[0]) : 1;
            const ox = parseFloat(ps.transformOrigin) || 0; // px from the pseudo's left edge
            // The pseudo spans the logo box; the gradient's centre is 50% across it.
            const haloCx = lr.left + ox + (lr.width / 2 - ox) * s;
            return { s: +s.toFixed(3), on: parseFloat(ps.opacity), dx: +(haloCx - (mr.left + mr.width / 2)).toFixed(1), markW: +mr.width.toFixed(1) };
        };
        window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 200)); const rest = read();
        const sp = document.createElement('div'); sp.style.height = '2000px'; document.querySelector('.page-view.active').appendChild(sp);
        window.scrollTo(0, 300); await new Promise((r) => setTimeout(r, 300)); const cond = read();
        const condensed = document.querySelector('header').classList.contains('header-condensed');
        window.scrollTo(0, 0); sp.remove(); await new Promise((r) => setTimeout(r, 200)); fz.remove();
        return { rest, cond, condensed };
    });
    check(halo.rest.on === 1 && halo.rest.s === 1 && Math.abs(halo.rest.dx) <= 1.5, `at rest the Home halo is on and centred behind the crown (offset ${halo.rest.dx}px)`);
    check(halo.condensed && halo.cond.s < 0.9 && halo.cond.markW < halo.rest.markW, `condensed, the mark and the halo both scale (${halo.rest.markW} → ${halo.cond.markW}px, halo ×${halo.cond.s})`);
    check(Math.abs(halo.cond.dx) <= 1.5, `…and the halo stays centred behind the crown (offset ${halo.cond.dx}px)`);

    console.log(fails ? `\n  ${fails} TOP-MENU CHECK(S) FAILED ❌` : '\n  TOP-MENU SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
