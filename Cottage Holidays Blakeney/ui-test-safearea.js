// ============================================================
//  ui-test-safearea.js — nothing may sit under the iOS Dynamic Island.
//
//  Reported from a real iPhone: the enquire panel's top edge was tucked under the
//  top pill. Every full-screen overlay used a flat 20px inset, which is simply
//  smaller than the ~59px status inset on a notched phone.
//
//  This bug CANNOT be seen in a desktop browser: env(safe-area-inset-*) always
//  reports 0px, so the flat pad looks correct everywhere CI runs. That's why the
//  insets are read once into --safe-t/r/b/l tokens (app.css :root) — this suite
//  overrides those tokens to stand in for a notched device, and then asserts by
//  geometry that each overlay's panel clears the inset. Override the tokens and
//  the real env() plumbing is the only thing left untested, which is one line per
//  token rather than a whole layout.
// ============================================================
const { boot } = require('./ui-test-lib');

// iPhone 15 Pro portrait: 59px top, 34px bottom home indicator.
const TOP = 59;
const BOTTOM = 34;

(async () => {
    let fails = 0;
    const check = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

    const t = await boot({ viewport: { width: 393, height: 852 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // Stand in for a notched device. env() reports 0 here, so without this the
    // whole suite would pass against a broken flat inset.
    await page.addStyleTag({
        content: `:root { --safe-t: ${TOP}px; --safe-r: 0px; --safe-b: ${BOTTOM}px; --safe-l: 0px; }`,
    });
    await page.waitForTimeout(150);

    // First prove the simulation is actually reaching the tokens — otherwise every
    // check below would pass for the wrong reason.
    const wired = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-t').trim());
    check(wired === TOP + 'px', `the notch simulation is live (--safe-t: ${wired})`);

    // Each overlay: open it, then measure the PANEL inside it.
    const CASES = [
        { name: 'enquire panel (the reported one)', open: "openProperty('21a'); await pause(400); openEnquireModal();", panel: '#enquire-modal .modal-box' },
        { name: 'date picker', open: "openProperty('21a'); await pause(400); openEnquireModal(); await pause(300); openDatePicker();", panel: '.datepicker-pop .dp-panel, .datepicker-pop > div' },
        { name: 'waitlist panel', open: "openWaitlistModal({ prop: '21a' });", panel: '#waitlist-modal .modal-box' },
        { name: 'confirm dialog', open: "glassConfirm('Test', 'Body');", panel: '#glass-dialog .glass-dialog-box, #glass-dialog > div' },
    ];

    for (const c of CASES) {
        const r = await page.evaluate(async (cs) => {
            const pause = (ms) => new Promise((r) => setTimeout(r, ms));
            // close anything already open so panels can't stack
            document.querySelectorAll('.modal-overlay.open, .datepicker-pop.open, #glass-dialog.open').forEach((n) => n.classList.remove('open'));
            await pause(120);
            try { await eval('(async () => {' + cs.open + '})()'); } catch (e) { return { err: String(e.message || e) }; }
            // Sample by STATE, not on a clock (the search suite's rule): a fixed
            // 500ms caught the waitlist panel MID-SETTLE on a loaded CI runner
            // (top 144 vs 79 — 65px of entry travel still to run, and rects
            // include transforms) and called a correct inset a violation.
            //
            // Two things are needed, and the first attempt at this had only a
            // weaker form of the second. Polling for "the rect matched the last
            // sample 140ms ago" does NOT prove settled: on a starved runner two
            // wall-clock reads can straddle a stalled compositor and be identical
            // because NOTHING PAINTED between them, which is the opposite of the
            // conclusion. So:
            //   1. await the element's own animations/transitions — `finished` is
            //      authoritative however badly frames are being scheduled. Only
            //      FINITE ones (an infinite decorative loop never resolves), and
            //      capped, so a missing animation can't hang the suite.
            //   2. then require three consecutive equal rects sampled on rAF.
            //      rAF ties each sample to a real painted frame, so a stall means
            //      no samples rather than falsely equal ones.
            await pause(120);
            let el = document.querySelector(cs.panel);
            if (!el) return { missing: true };
            try {
                const anims = (el.getAnimations ? el.getAnimations({ subtree: true }) : []).filter((a) => {
                    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
                    return t && t.iterations !== Infinity && t.endTime !== Infinity;
                });
                await Promise.race([
                    Promise.all(anims.map((a) => a.finished.catch(() => null))),
                    pause(2000),
                ]);
            } catch (e) {}
            const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
            let same = 0, key = null;
            for (let i = 0; i < 120 && same < 3; i++) {
                await frame();
                el = document.querySelector(cs.panel);
                const r0 = el ? el.getBoundingClientRect() : null;
                const k = r0 ? Math.round(r0.top) + ':' + Math.round(r0.height) : 'none';
                same = k !== 'none' && k === key ? same + 1 : 0;
                key = k;
            }
            if (!el) return { missing: true };
            const b = el.getBoundingClientRect();
            if (b.height < 10) return { hidden: true };
            return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight };
        }, c);
        if (r.err || r.missing || r.hidden) {
            check(false, `${c.name} — could not measure (${r.err || (r.missing ? 'panel not found' : 'not visible')})`);
            continue;
        }
        check(r.top >= TOP, `${c.name}: top clears the Dynamic Island (${r.top} ≥ ${TOP})`);
        check(r.bottom <= r.vh - BOTTOM + 1, `${c.name}: bottom clears the home indicator (${r.bottom} ≤ ${r.vh - BOTTOM})`);
    }

    // The guest-shell auth screens are full-page SCROLLERS — the panel runs to the
    // bottom edge on purpose and scrolls, so its box bottom is meaningless. What
    // matters there is that the LAST control can clear the home indicator.
    const auth = await page.evaluate(async (bottomInset) => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelectorAll('.modal-overlay.open, .datepicker-pop.open, #glass-dialog.open').forEach((n) => n.classList.remove('open'));
        await pause(120);
        try { openGuestAuthModal(); } catch (e) { return { err: String(e.message || e) }; }
        await pause(500);
        const ov = document.getElementById('guest-auth-modal');
        const box = ov.querySelector('.modal-box');
        if (!box) return { missing: true };
        box.scrollTop = box.scrollHeight; // scroll to the very end
        await pause(200);
        const btns = [...box.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
        const last = btns[btns.length - 1];
        return {
            top: Math.round(box.getBoundingClientRect().top),
            lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
            label: last ? last.textContent.trim().slice(0, 20) : '',
            vh: window.innerHeight,
            padBottom: parseFloat(getComputedStyle(box).paddingBottom),
        };
    }, BOTTOM);
    if (auth && !auth.err && !auth.missing) {
        check(auth.top >= TOP, `sign-in screen: content starts below the Dynamic Island (${auth.top} ≥ ${TOP})`);
        check(auth.padBottom >= BOTTOM, `sign-in screen: reserves room for the home indicator (${auth.padBottom}px ≥ ${BOTTOM})`);
        if (auth.lastBottom != null) {
            check(auth.lastBottom <= auth.vh - BOTTOM + 1, `sign-in screen: last action "${auth.label}" scrolls clear of the indicator (${auth.lastBottom} ≤ ${auth.vh - BOTTOM})`);
        }
    } else {
        check(false, `sign-in screen — could not measure (${(auth && (auth.err || 'panel missing')) || 'unknown'})`);
    }

    // Bottom-anchored floaters.
    const floaters = await page.evaluate(async () => {
        document.querySelectorAll('.modal-overlay.open, .datepicker-pop.open, #glass-dialog.open').forEach((n) => n.classList.remove('open'));
        await new Promise((r) => setTimeout(r, 150));
        try { toast('safe area probe'); } catch (e) {}
        await new Promise((r) => setTimeout(r, 300));
        const pick = (sel) => {
            const el = document.querySelector(sel);
            if (!el || getComputedStyle(el).display === 'none') return null;
            const b = el.getBoundingClientRect();
            return b.height > 4 ? { bottom: Math.round(b.bottom) } : null;
        };
        return { toast: pick('.toast-stack'), vh: window.innerHeight };
    });
    if (floaters.toast) {
        check(floaters.toast.bottom <= floaters.vh - BOTTOM + 1,
            `toasts clear the home indicator (${floaters.toast.bottom} ≤ ${floaters.vh - BOTTOM})`);
    } else {
        console.log('  · toast stack not visible — skipped');
    }

    // And the ordinary (un-notched) case must be unchanged: max() keeps 20px.
    const plain = await page.evaluate(async () => {
        document.getElementById('proto-safe')?.remove();
        const s = document.createElement('style');
        s.textContent = ':root { --safe-t: 0px; --safe-r: 0px; --safe-b: 0px; --safe-l: 0px; }';
        document.head.appendChild(s);
        await new Promise((r) => setTimeout(r, 150));
        const ov = document.querySelector('.modal-overlay');
        return getComputedStyle(ov).paddingTop;
    });
    check(plain === '20px', `a device with no insets keeps the original 20px pad (${plain})`);

    console.log(fails ? `\n  ${fails} SAFE-AREA CHECK(S) FAILED ❌` : '\n  SAFE-AREA SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
