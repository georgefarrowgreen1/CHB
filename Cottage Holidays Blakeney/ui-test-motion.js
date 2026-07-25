// ============================================================
//  ui-test-motion.js — the guest shell's iOS-flavoured motion.
//
//  Look-and-feel work is easy to break invisibly, so this pins the parts that
//  are behavioural rather than decorative:
//
//    A) the selection pill travels by TRANSFORM, not left/width — animating
//       layout properties is the jank iOS motion doesn't have, and it would
//       still "work" while feeling wrong;
//    B) scrolling CONDENSES the header and never hides it — the header carries
//       the menu now, so .header-hidden would take the customer's navigation
//       away mid-scroll;
//    C) on desktop the old hide-on-scroll-down behaviour is untouched;
//    D) prefers-reduced-motion drops the springs and the squash but KEEPS the
//       pill's movement and the condensed layout (they carry meaning).
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
    // The stylesheet sets scroll-behavior: smooth, so scrollTo() ANIMATES and a
    // short wait would sample mid-flight. Pin it to instant for measurement only.
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });

    // On Home the header's Home button is hidden (the crown carries it), so the
    // pill has nothing to sit under yet — move to a real tab first.
    await page.evaluate(async () => {
        document.querySelector('#guest-dock-slot .guest-dock-btn[data-tab="cottages"]').click();
        await new Promise((r) => setTimeout(r, 700));
    });

    // ---- A) transform-driven selection pill ----
    const ind = await page.evaluate(() => {
        const el = document.querySelector('#guest-dock-slot .guest-dock-indicator');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
            x: el.style.translate,
            inlineLeft: el.style.left,
            translate: cs.translate,
            transitionProps: cs.transitionProperty,
        };
    });
    check(!!ind, 'the selection pill exists in the header dock');
    check(ind && /px/.test(ind.x), `its position is a translate offset (translate: ${ind && ind.x})`);
    check(ind && !ind.inlineLeft, `no inline left is being animated (left: "${ind && ind.inlineLeft}")`);
    check(ind && /translate/.test(ind.transitionProps), `translate is what transitions (${ind && ind.transitionProps})`);
    check(ind && !/\bleft\b|\bwidth\b/.test(ind.transitionProps), 'left/width are NOT transitioned (no per-frame layout)');

    // It must actually MOVE when you switch tab, and squash while travelling.
    // SAMPLED OVER A WINDOW, not at one instant: on a loaded machine the click →
    // rAF → style write → transition start can take well over 100ms, so a single
    // early read lands on the start value and reads as a teleport. Polling still
    // fails hard on a real teleport — that never produces an intermediate value.
    const travel = await page.evaluate(async () => {
        const el = document.querySelector('#guest-dock-slot .guest-dock-indicator');
        const before = el.style.translate;
        document.querySelector('#guest-dock-slot .guest-dock-btn[data-tab="experiences"]').click();
        const xs = [];
        let sawSquash = false;
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            xs.push(parseFloat(getComputedStyle(el).translate));
            if (el.classList.contains('gd-travel')) sawSquash = true;
        }
        await new Promise((r) => setTimeout(r, 700));
        const fromX = parseFloat(before) || 0;
        const toX = parseFloat(el.style.translate) || 0;
        const lo = Math.min(fromX, toX), hi = Math.max(fromX, toX);
        const between = xs.filter((v) => v > lo + 1 && v < hi - 1);
        return {
            before, after: el.style.translate, sawSquash,
            settled: el.classList.contains('gd-travel'),
            fromX, toX, samples: xs.length, mids: between.length,
            example: between.length ? Math.round(between[Math.floor(between.length / 2)]) : null,
        };
    });
    check(travel.before !== travel.after, `the pill travels on a tab switch (${travel.before} → ${travel.after})`);
    check(travel.mids >= 2, `it GLIDES rather than teleporting — ${travel.mids}/${travel.samples} frames landed between ${travel.fromX} and ${travel.toX} (e.g. ${travel.example}px)`);
    check(travel.sawSquash, 'it squashes while travelling (gd-travel seen)');
    check(!travel.settled, 'the squash is cleaned up once it settles');

    // ---- B) scroll condenses, never hides ----
    const scrolled = await page.evaluate(async () => {
        window.scrollTo(0, 600);
        await new Promise((r) => setTimeout(r, 300));
        const h = document.querySelector('header');
        const r = h.getBoundingClientRect();
        const cs = getComputedStyle(h);
        return {
            condensed: h.classList.contains('header-condensed'),
            hidden: h.classList.contains('header-hidden'),
            onScreen: r.bottom > 0 && r.top < window.innerHeight,
            pad: cs.paddingTop,
            blur: cs.backdropFilter || cs.webkitBackdropFilter || '',
            menuHittable: (() => {
                const b = document.querySelector('#guest-dock-slot .guest-dock-btn');
                if (!b) return false;
                const q = b.getBoundingClientRect();
                const hit = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
                return !!(hit && (hit === b || b.contains(hit) || hit.closest('#guest-dock-slot')));
            })(),
        };
    });
    check(scrolled.condensed, 'scrolling condenses the header');
    check(!scrolled.hidden, 'the header is NEVER hidden in the guest shell (the menu is in it)');
    check(scrolled.onScreen, 'it is still on screen after scrolling 600px');
    check(scrolled.menuHittable, 'the menu is still tappable while scrolled');
    check(/blur/.test(scrolled.blur), `the condensed bar deepens its blur (${scrolled.blur.slice(0, 34)})`);

    const expanded = await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 300));
        return document.querySelector('header').classList.contains('header-condensed');
    });
    check(!expanded, 'scrolling back to the top expands it again');

    // ---- B2) the condensed bar names the screen ----
    // The space between crown and icons was ~40% of the bar and empty. It now
    // carries the screen's title, but ONLY once condensed — otherwise it would
    // repeat the page's own big heading, which is still on screen at rest.
    const title = await page.evaluate(async () => {
        const el = () => document.getElementById('guest-head-title');
        const op = () => (el() ? getComputedStyle(el()).opacity : null);
        window.scrollTo(0, 0);
        try { openProperty('21a'); } catch (e) {}
        await new Promise((r) => setTimeout(r, 700));
        const h1 = (document.getElementById('prop-title') || {}).textContent || '';
        const rest = { text: el() ? el().textContent : null, opacity: op() };
        window.scrollTo(0, 500);
        await new Promise((r) => setTimeout(r, 700));
        const cond = { opacity: op(), overflowX: document.documentElement.scrollWidth - window.innerWidth };
        // Home needs no title — the crown already says Home.
        window.scrollTo(0, 0);
        try { nav('view-main'); } catch (e) {}
        await new Promise((r) => setTimeout(r, 600));
        const home = { text: el() ? el().textContent : null, hasClass: el() ? el().classList.contains('has-title') : null };
        return { h1: h1.trim(), rest, cond, home };
    });
    check(title.rest.text === title.h1 && !!title.h1,
        `the title is read from the cottage's own heading, not a second copy ("${title.rest.text}")`);
    check(title.rest.opacity === '0', `it stays hidden at rest, so the page heading isn't echoed (opacity ${title.rest.opacity})`);
    check(title.cond.opacity === '1', `it appears once the bar condenses (opacity ${title.cond.opacity})`);
    check(title.cond.overflowX <= 0, `it never causes overflow (${title.cond.overflowX}px)`);
    check(!title.home.text && !title.home.hasClass, `Home carries no title — the crown already says it ("${title.home.text}")`);

    // ---- C) desktop keeps the original hide-on-scroll ----
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);
    const desktop = await page.evaluate(async () => {
        try { nav('view-main'); } catch (e) {}
        await new Promise((r) => setTimeout(r, 350));
        window.scrollTo(0, 200);
        await new Promise((r) => setTimeout(r, 200));
        window.scrollTo(0, 900); // a downward move well past TOP_ZONE
        await new Promise((r) => setTimeout(r, 350));
        const h = document.querySelector('header');
        return { hidden: h.classList.contains('header-hidden'), condensed: h.classList.contains('header-condensed') };
    });
    check(desktop.hidden, 'desktop still slides the header away on scroll down (unchanged)');
    check(!desktop.condensed, 'the condensed class is a guest-shell thing only');
    await page.close();

    // ---- D) reduced motion ----
    const rm = await t.browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await rm.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await rm.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await rm.waitForTimeout(1200);
    await rm.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    const red = await rm.evaluate(async () => {
        const el = document.querySelector('#guest-dock-slot .guest-dock-indicator');
        const before = el.style.translate;
        const btn = document.querySelector('#guest-dock-slot .guest-dock-btn[data-tab="cottages"]');
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 120));
        const cs = getComputedStyle(el);
        window.scrollTo(0, 600);
        await new Promise((r) => setTimeout(r, 250));
        return {
            moved: el.style.translate !== before,
            squash: cs.animationName,
            transition: cs.transitionProperty,
            stillCondenses: document.querySelector('header').classList.contains('header-condensed'),
        };
    });
    check(red.moved, 'reduced motion: the pill still MOVES (it marks where you are)');
    check(red.squash === 'none', `reduced motion: no squash animation (${red.squash})`);
    check(!/translate/.test(red.transition), `reduced motion: no springy travel transition (${red.transition})`);
    check(red.stillCondenses, 'reduced motion: the header still condenses (layout, not decoration)');
    await rm.close();

    console.log(fails ? `\n  ${fails} MOTION CHECK(S) FAILED ❌` : '\n  MOTION SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
