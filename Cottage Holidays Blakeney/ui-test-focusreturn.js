// ============================================================
//  ui-test-focusreturn.js — keyboard focus comes BACK to where it was.
//
//  Round-3 audit (guest screens, driven by keyboard):
//    A) A NESTED overlay (terms or the date picker opened from the enquiry
//       sheet) hands focus back INSIDE the sheet that is still open — one
//       shared opener slot used to spend the outer sheet's opener and drop
//       focus on the page behind it.
//    B) Closing the outer overlay then returns focus to ITS opener.
//    C) An async button the dispatcher disables while it works (which blurs
//       it) still gets focus back when the overlay it opened closes.
//    D) The closed mobile menu is out of the Tab order (it sat off screen with
//       three live links).
//    E) The crown — the first Tab stop — shows a focus ring.
// ============================================================
const { boot } = require('./ui-test-lib');

(async () => {
    let fails = 0;
    const check = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // A + B: opener → privacy window → a control inside it → terms window.
    const ab = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const outer = document.getElementById('privacy-modal');
        const inner = document.getElementById('terms-modal');
        if (!outer || !inner) return { missing: true };
        const opener = document.createElement('button');
        opener.id = 't3-opener'; opener.textContent = 'open';
        document.body.appendChild(opener);
        opener.focus();
        outer.classList.add('open');
        await wait(150);
        const innerBtn = document.createElement('button');
        innerBtn.id = 't3-inner'; innerBtn.textContent = 'inner';
        (outer.querySelector('.modal-box, .terms-modal-box') || outer).appendChild(innerBtn);
        innerBtn.focus();
        inner.classList.add('open');
        await wait(150);
        inner.classList.remove('open');
        await wait(80);
        const afterInner = document.activeElement && document.activeElement.id;
        outer.classList.remove('open');
        await wait(80);
        const afterOuter = document.activeElement && document.activeElement.id;
        innerBtn.remove();
        return { afterInner, afterOuter };
    });
    check(!ab.missing, '(fixture) the privacy and terms windows exist');
    check(ab.afterInner === 't3-inner', `closing the INNER window returns focus inside the still-open outer one (${ab.afterInner})`);
    check(ab.afterOuter === 't3-opener', `closing the outer window returns focus to ITS opener (${ab.afterOuter})`);

    // C: an async data-act button (disabled while it works) gets focus back.
    const c = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.t3OpenLater = async function () {
            await wait(60);
            document.getElementById('privacy-modal').classList.add('open');
        };
        const b = document.createElement('button');
        b.id = 't3-async'; b.textContent = 'async'; b.setAttribute('data-act', 't3OpenLater');
        document.body.appendChild(b);
        b.focus();
        b.click();
        await wait(300);
        const blurredWhileWorking = document.activeElement !== b;
        document.getElementById('privacy-modal').classList.remove('open');
        await wait(600);
        return { blurredWhileWorking, back: document.activeElement && document.activeElement.id };
    });
    check(c.back === 't3-async', `an async button the dispatcher disabled gets focus back on close (${c.back})`);

    // D: the closed mobile menu takes no Tab stops.
    const d = await page.evaluate(() => {
        const m = document.getElementById('mobileMenu');
        return m ? getComputedStyle(m).visibility : 'missing';
    });
    check(d === 'hidden', `the closed mobile menu is hidden from Tab and the a11y tree (${d})`);

    // E: the crown shows a ring under KEYBOARD focus.
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
    let ring = null;
    for (let i = 0; i < 8 && !ring; i++) {
        await page.keyboard.press('Tab');
        ring = await page.evaluate(() => {
            const a = document.activeElement;
            if (!a || !a.classList.contains('logo')) return null;
            const cs = getComputedStyle(a);
            return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0 };
        });
    }
    check(!!ring, 'the crown is reachable by Tab');
    check(!!ring && ring.style !== 'none' && ring.width >= 2, `…and shows a focus ring (${ring ? ring.style + ' ' + ring.width + 'px' : 'n/a'})`);

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌` : '\n  FOCUS-RETURN TEST PASSED ✅');
    await t.done(fails);
})();
