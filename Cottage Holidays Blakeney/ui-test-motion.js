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
            // The bar's material rides header::before (the graded bar, ui-test-hig §10):
            // the blur lives on the layer, the header itself paints nothing.
            blur: (() => { const ps = getComputedStyle(h, '::before'); return ps.backdropFilter || ps.webkitBackdropFilter || cs.backdropFilter || cs.webkitBackdropFilter || ''; })(),
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
    check(/blur/.test(scrolled.blur), `the condensed bar is still the blurred material (${scrolled.blur.slice(0, 34)})`);

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

    // ---- B3) the pill stays ON the icon through a geometry change ----
    // Condensing shrinks the buttons 38 -> 34px, which moves every offset. The pill
    // is placed from measured coordinates, so unless it is re-measured it keeps the
    // old ones and drifts off-centre — 10px on the third button, which is what got
    // reported. Signing in (adding My Stays) moves things the same way.
    const centred = await page.evaluate(async () => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const dx = () => {
            const dock = document.querySelector('#guest-dock-slot .guest-dock');
            const ind = dock.querySelector('.guest-dock-indicator');
            const cur = dock.querySelector('.guest-dock-btn.current');
            if (!cur) return null;
            const ib = ind.getBoundingClientRect(), cb = cur.getBoundingClientRect();
            return {
                off: +((ib.left + ib.width / 2) - (cb.left + cb.width / 2)).toFixed(1),
                indW: Math.round(ib.width), btnW: Math.round(cb.width), tab: cur.dataset.tab,
            };
        };
        // Sign in so the 4th button (My Stays) exists — the reported state.
        currentGuest = { id: 1, name: 'G', email: 'g@x.co' };
        document.body.classList.add('guest-signed-in');
        try { setGuestUI && setGuestUI(); } catch (e) {}
        await pause(400);
        try { nav('view-guest-bookings'); } catch (e) {}
        await pause(800);
        const rest = dx();
        const h = document.querySelector('header');
        h.classList.add('header-condensed');   // as a real scroll would
        await pause(900);
        const cond = dx();
        h.classList.remove('header-condensed');
        await pause(900);
        return { rest, cond, back: dx() };
    });
    for (const [label, m] of [['at rest', centred.rest], ['condensed', centred.cond], ['expanded again', centred.back]]) {
        check(m && Math.abs(m.off) <= 1, `the pill stays centred on its icon ${label} (off by ${m ? m.off : '?'}px, tab ${m ? m.tab : '?'})`);
        check(m && Math.abs(m.indW - m.btnW) <= 1, `and matches the button's size ${label} (pill ${m ? m.indW : '?'} vs button ${m ? m.btnW : '?'})`);
    }

    // ---- B4) the condense must not animate LAYOUT ----
    // It originally transitioned width/height on the buttons, their svgs and the
    // logo — nine elements relaid out per frame, which stuttered (measured: 33ms
    // frames, dropped frames both ways). The size change is a transform now. This
    // is the structural guard: timing assertions would flake under CI load, but
    // "does it animate a layout property" is deterministic.
    const props = await page.evaluate(() => {
        const list = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).transitionProperty : '';
        };
        return {
            btn: list('#guest-dock-slot .guest-dock-btn'),
            svg: list('#guest-dock-slot .guest-dock-btn svg'),
            mark: list('header .logo-mark'),
            dock: list('#guest-dock-slot .guest-dock'),
            header: list('header'),
        };
    });
    const LAYOUT = /\b(width|height|top|left|right|bottom|margin)\b/;
    for (const [what, v] of [['icon buttons', props.btn], ['icon glyphs', props.svg], ['the crown', props.mark], ['the dock', props.dock]]) {
        check(!LAYOUT.test(v), `${what} animate no layout property (${v || 'none'})`);
    }
    check(/transform/.test(props.dock) || /transform/.test(props.mark),
        `the size change rides a transform instead (dock: ${props.dock})`);
    check(!/backdrop-filter/.test(props.header),
        `the header does not transition backdrop-filter — re-blurring per frame is the costliest thing here (${props.header})`);

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
