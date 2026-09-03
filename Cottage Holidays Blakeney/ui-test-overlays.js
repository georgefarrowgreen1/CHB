// ============================================================
//  ui-test-overlays.js — SHEET and ALERT: every overlay's exit, the phone sheet,
//  the settling alert. The last two of the twelve behaviours (PR-B).
//
//  Eighteen close functions vanished their overlay in one frame; four faded.
//  Now every one goes through chbCloseOverlay: `open` drops SYNCHRONOUSLY (the
//  state every gate, the Tab trap and Back read), `closing` paints an inert exit,
//  and `:not(.open)` in the stylesheet means a re-open mid-exit simply wins.
//
//    §1 the stylesheet — the old pop-modal pair is gone, every family has an
//       exit rule, the exit takes visibility with it;
//    §2 every overlay — open, close: state instant, exit painted and inert,
//       gone after; the pointer falls through a closing overlay;
//    §3 re-open mid-exit wins; Back finds nothing open the instant after;
//    §4 the SHEET — edge-attached on a phone with a grabber and its own
//       safe-area padding; a centred card on desktop; the reviews family is
//       never a sheet;
//    §5 the ALERT — settles down from 1.08; the queue's next dialog wins over
//       the previous one's exit;
//    §6 the picker over the glass dialog exits ABOVE it;
//    §7 reduced motion — no exit, gone at once.
//
//  Break-tested: the helper's `closing`, the `:not(.open)`, the pointer-events,
//  the sheet media block, the alert keyframe and the picker's z-index each fail
//  their named checks.
// ============================================================
const fs = require('fs');
const path = require('path');
const { boot } = require('./ui-test-lib');

const APP_CSS = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
const STUB = { ok: true, bookings: [], enquiries: [], threads: [], messages: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], sections: [] };

// [id, open, close, box] — `open` and `close` are evaluated in the page.
const OVERLAYS = [
    ['enquire-modal', "openProperty('21a'); await pause(300); openEnquireModal();", 'closeEnquireModal()', '.modal-box'],
    ['waitlist-modal', "openWaitlistModal({ prop: '21a' });", 'closeWaitlistModal()', '.modal-box'],
    ['faq-modal', "openFaqModal('jollyboat');", 'closeFaqModal()', '.reviews-modal-box'],
    ['amenities-modal', "openAmenitiesModal('jollyboat');", 'closeAmenitiesModal()', '.reviews-modal-box'],
    ['houserules-modal', "openHouseRulesModal('jollyboat');", 'closeHouseRulesModal()', '.reviews-modal-box'],
    // Opened the way the cottage page's "Read all N reviews" button opens it. The
    // markup used to sit INSIDE the home view's <main> (display:none on every other
    // view), so from the cottage page the button opened a modal that could not
    // paint — this fixture is what found it. It lives at body level now.
    ['reviews-modal', "openProperty('jollyboat'); await pause(200); openAllReviews('jollyboat');", 'closeAllReviews()', '.reviews-modal-box'],
    ['lightbox', "openProperty('jollyboat'); await pause(200); openLightbox(0);", 'closeLightbox()', '.lightbox-stage'],
    ['photo-upload-modal', "openPhotoUpload('jollyboat');", 'closePhotoUpload()', '.modal-box'],
    ['welcome-modal', "await openWelcomeBook('jollyboat');", 'closeWelcomeModal()', '.modal-box'],
    ['exp-suggest-modal', 'openExperienceSuggest();', 'closeExperienceSuggest()', '.modal-box'],
    ['guest-details-modal', 'openGuestDetailsModal();', 'closeGuestDetailsModal()', '.modal-box'],
    ['guest-security-modal', 'openGuestSecurityModal();', 'closeGuestSecurityModal()', '.modal-box'],
    ['guest-auth-modal', 'openGuestAuthModal();', 'closeGuestAuthModal()', '.modal-box'],
    ['chat-widget', 'toggleChat();', 'closeChat()', '.chat-widget-head'],
    ['date-picker', "openProperty('21a'); await pause(300); openEnquireModal(); await pause(200); openDatePicker();", 'closeDatePicker(); closeEnquireModal();', '.datepicker-card'],
    ['terms-modal', "openTermsModal(null, '21a');", 'closeTermsModal()', '.terms-modal-box'],
    ['glass-dialog', "glassConfirm('Sure?');", 'glassDialogResolve(false)', '.glass-dialog-box'],
    ['edit-modal', 'openModal();', 'closeModal()', '.modal-box'],
];

(async () => {
    let fails = 0;
    const check = (c, m, extra) => {
        console.log(`  ${c ? '✓' : '✗'} ${m}${c || extra === undefined ? '' : '  → ' + extra}`);
        if (!c) fails++;
    };

    // ============================================================
    console.log('\n  §1 the stylesheet');
    check(!/\.pop-modal/.test(APP_CSS) && !/modalPop/.test(APP_CSS), 'the pop-modal pair (open-only motion, 350ms fluid exit) is gone');
    const exits = [...APP_CSS.matchAll(/\.closing:not\(\.open\)\s*\{/g)].length;
    check(exits >= 7, 'every overlay family has an exit rule', exits + ' rules');
    const fadeOut = (APP_CSS.match(/@keyframes chbFadeOut \{[^}]*\}[^}]*\}/) || [''])[0];
    check(/visibility: hidden/.test(fadeOut), 'the exit takes visibility with it (out of the tab order)', fadeOut);
    check(/\.modal-overlay\.chb-sheet \{[^}]*align-items: flex-end/.test(APP_CSS), 'a .chb-sheet overlay is bottom-anchored');
    check(/@keyframes chbAlertIn \{ from \{[^}]*scale\(1\.08\)/.test(APP_CSS), 'the alert settles DOWN from 1.08');

    // ============================================================
    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.route(/\.php/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB) }));
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { currentGuest = { email: 'g@e.com', name: 'G', phone: '', address: '', postcode: '' }; });
    check(await page.evaluate(() => typeof chbCloseOverlay === 'function'), 'chbCloseOverlay is the one exit');

    const openIt = (spec) => page.evaluate(async (s) => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        await eval('(async () => {' + s + '})()');
    }, spec);
    // Close, and read the state in the SAME tick — the whole claim is that `open`
    // is gone and `closing` is up before any frame paints.
    const closeAndRead = (id, closeSpec, box) => page.evaluate(([i, c, b]) => {
        const el = document.getElementById(i);
        const centre = () => {
            const bx = el.querySelector(b) || el;
            const r = bx.getBoundingClientRect();
            return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
        };
        const pt = centre();
        eval(c);
        const names = el.getAnimations({ subtree: true }).map((a) => a.animationName || '');
        const hit = document.elementFromPoint(pt[0], pt[1]);
        return {
            open: el.classList.contains('open'),
            closing: el.classList.contains('closing'),
            painted: el.getClientRects().length > 0 && getComputedStyle(el).opacity !== '0',
            pe: getComputedStyle(el).pointerEvents,
            out: names.some((n) => /chb\w+(Out|Down)$/.test(n)),
            names: names.join(','),
            through: !hit || !el.contains(hit),
        };
    }, [id, closeSpec, box]);
    const after = (id) => page.evaluate((i) => {
        const el = document.getElementById(i);
        return { closing: el.classList.contains('closing'), open: el.classList.contains('open'), painted: el.getClientRects().length > 0 };
    }, id);

    // ============================================================
    console.log('\n  §2 every overlay — the state is instant, the exit is painted and inert');
    for (const [id, openSpec, closeSpec, box] of OVERLAYS) {
        try { await openIt(openSpec); } catch (e) { check(false, `#${id} did not open`, e.message); continue; }
        await page.waitForTimeout(450);
        const up = await page.evaluate((i) => { const el = document.getElementById(i); return { ok: el.classList.contains('open') && el.getClientRects().length > 0, cls: el.className, rects: el.getClientRects().length, disp: getComputedStyle(el).display }; }, id);
        if (!up.ok) { check(false, `#${id} did not open — fixture problem, not an exit problem`, JSON.stringify(up)); await page.evaluate((c) => { try { eval(c); } catch (e) {} }, closeSpec); continue; }
        const r = await closeAndRead(id, closeSpec, box);
        check(!r.open && r.closing && r.painted && r.pe === 'none' && r.out, `#${id}: open gone at once, exit painted (${r.names.split(',').filter((n) => /Out|Down/.test(n))[0] || '—'}), inert`, JSON.stringify(r));
        check(r.through, `#${id}: the pointer falls through the exiting overlay`, r.through);
        await page.waitForTimeout(450);
        const a = await after(id);
        check(!a.closing && !a.open && !a.painted, `#${id}: gone after the exit`, JSON.stringify(a));
    }

    // The defect the loop found: #reviews-modal sat inside the home view's <main>,
    // so from the cottage page "Read all N reviews" opened a modal that could not
    // paint. Asserted by NAME, not left to the fixture check above.
    const rv = await page.evaluate(async () => {
        openProperty('jollyboat');
        await new Promise((r) => setTimeout(r, 250));
        openAllReviews('jollyboat');
        const m = document.getElementById('reviews-modal');
        const out = { painted: m.getClientRects().length > 0, inView: !!m.closest('.page-view'), view: (document.querySelector('.page-view.active') || {}).id };
        closeAllReviews();
        return out;
    });
    check(rv.painted && !rv.inView && rv.view !== 'view-main', 'the reviews modal PAINTS from the cottage page (it lives at body level, not inside a view)', JSON.stringify(rv));
    await page.waitForTimeout(400);

    // ============================================================
    console.log('\n  §3 a re-open mid-exit wins; Back finds nothing open');
    await openIt("openProperty('21a'); await pause(300); openEnquireModal();");
    await page.waitForTimeout(450);
    const reopen = await page.evaluate(async () => {
        const el = document.getElementById('enquire-modal');
        closeEnquireModal();
        const backFound = closeTopOverlay(); // nothing is open the instant after
        await new Promise((r) => setTimeout(r, 60));
        openEnquireModal();
        const mid = { open: el.classList.contains('open'), painted: el.getClientRects().length > 0, pe: getComputedStyle(el).pointerEvents };
        await new Promise((r) => setTimeout(r, 450));
        return { backFound, mid, late: { open: el.classList.contains('open'), closing: el.classList.contains('closing'), painted: el.getClientRects().length > 0, opacity: getComputedStyle(el).opacity } };
    });
    check(reopen.backFound === false, 'Back finds nothing to close the instant after a close', String(reopen.backFound));
    check(reopen.mid.open && reopen.mid.painted && reopen.mid.pe !== 'none', 'a re-open 60ms into the exit is open, painted and live', JSON.stringify(reopen.mid));
    check(reopen.late.open && !reopen.late.closing && reopen.late.painted && reopen.late.opacity === '1', '…and the stale exit timer takes nothing with it', JSON.stringify(reopen.late));
    // Open again mid-exit must not leave a `closing` class that would strand the
    // NEXT close: close it now and make sure the exit still plays.
    const again = await closeAndRead('enquire-modal', 'closeEnquireModal()', '.modal-box');
    check(!again.open && again.closing && again.out, 'the next close after a re-open still exits', JSON.stringify(again));
    await page.waitForTimeout(450);

    // ============================================================
    console.log('\n  §4 the SHEET on a phone, a card on a desktop');
    const settled = (id) => page.evaluate(async (i) => {
        const el = document.getElementById(i);
        const anims = el.getAnimations({ subtree: true });
        const names = anims.map((a) => a.animationName);
        await Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1500))]);
        const box = el.querySelector('.modal-box, .reviews-modal-box, .terms-modal-box');
        const r = box.getBoundingClientRect();
        const cs = getComputedStyle(box);
        const grab = getComputedStyle(box, '::before');
        return {
            names, bottom: Math.round(r.bottom), vh: window.innerHeight, width: Math.round(r.width), vw: window.innerWidth,
            rTop: parseFloat(cs.borderTopLeftRadius), rBot: parseFloat(cs.borderBottomLeftRadius),
            grabber: grab.content !== 'none' && parseFloat(grab.height) >= 4 && parseFloat(grab.width) >= 24,
            padB: parseFloat(cs.paddingBottom),
        };
    }, id);
    await openIt("openProperty('21a'); await pause(300); openEnquireModal();");
    const sh = await settled('enquire-modal');
    check(sh.names.includes('chbSheetUp'), 'the enquiry form arrives as a SHEET (chbSheetUp)', sh.names.join(','));
    check(Math.abs(sh.bottom - sh.vh) <= 1 && sh.width === sh.vw, `…edge-attached: bottom ${sh.bottom} of ${sh.vh}, width ${sh.width} of ${sh.vw}`);
    check(sh.rTop >= 16 && sh.rBot === 0, `…rounded at the top only (${sh.rTop} / ${sh.rBot})`);
    check(sh.grabber, '…with a grabber');
    check(sh.padB >= 24, `…and its own bottom padding for the home indicator (${sh.padB}px)`);
    await page.evaluate(() => closeEnquireModal());
    await page.waitForTimeout(450);
    await openIt("openTermsModal(null, '21a');");
    const tm = await settled('terms-modal');
    check(tm.names.includes('chbSheetUp') && Math.abs(tm.bottom - tm.vh) <= 1, 'the terms are a sheet too (opened over the form on a phone)', JSON.stringify({ n: tm.names, b: tm.bottom, vh: tm.vh }));
    await page.evaluate(() => closeTermsModal());
    await page.waitForTimeout(450);
    await openIt("openFaqModal('jollyboat');");
    const fq = await settled('faq-modal');
    check(fq.names.includes('chbModalIn') && fq.bottom < fq.vh - 20 && fq.rTop === fq.rBot, 'the reviews family stays a centred card (chbModalIn, all corners)', JSON.stringify({ n: fq.names, b: fq.bottom, vh: fq.vh }));
    await page.evaluate(() => closeFaqModal());
    await page.waitForTimeout(450);

    const desk = await t.browser.newPage({ viewport: { width: 1280, height: 900 } });
    await desk.route(/\.php/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB) }));
    await desk.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await desk.waitForTimeout(1000);
    const dk = await desk.evaluate(async () => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        openProperty('21a'); await pause(300); openEnquireModal();
        const el = document.getElementById('enquire-modal');
        const names = el.getAnimations({ subtree: true }).map((a) => a.animationName);
        await pause(500);
        const box = el.querySelector('.modal-box');
        const r = box.getBoundingClientRect();
        const cs = getComputedStyle(box);
        return { names, bottom: Math.round(r.bottom), vh: window.innerHeight, width: Math.round(r.width), rTop: parseFloat(cs.borderTopLeftRadius), rBot: parseFloat(cs.borderBottomLeftRadius), grabber: getComputedStyle(box, '::before').content };
    });
    check(dk.names.includes('chbModalIn') && !dk.names.includes('chbSheetUp'), 'on a desktop the same form is a settling card (chbModalIn)', dk.names.join(','));
    check(dk.bottom < dk.vh - 20 && dk.width <= 520 && dk.rTop === dk.rBot && dk.rTop > 0 && dk.grabber === 'none', `…centred, capped and rounded all round, no grabber (${dk.width}px, bottom ${dk.bottom}/${dk.vh})`);
    await desk.close();

    // ============================================================
    console.log('\n  §5 the ALERT');
    const al = await page.evaluate(async () => {
        const o = document.getElementById('glass-dialog');
        const box = o.querySelector('.glass-dialog-box');
        const p1 = glassConfirm('One?');
        await new Promise((r) => setTimeout(r, 30));
        const inName = box.getAnimations().map((a) => a.animationName);
        const p2 = glassConfirm('Two?'); // queued behind the first
        glassDialogResolve(false);
        await p1;
        await new Promise((r) => setTimeout(r, 30));
        // The queue opened the second dialog INTO the first one's exit.
        const second = { open: o.classList.contains('open'), text: document.getElementById('glass-dialog-msg').innerText, names: box.getAnimations().map((a) => a.animationName), pe: getComputedStyle(o).pointerEvents };
        glassDialogResolve(false);
        await p2;
        const exit = { open: o.classList.contains('open'), closing: o.classList.contains('closing'), names: box.getAnimations().map((a) => a.animationName) };
        await new Promise((r) => setTimeout(r, 450));
        return { inName, second, exit, gone: o.getClientRects().length === 0 };
    });
    check(al.inName.includes('chbAlertIn'), 'the alert settles in (chbAlertIn)', al.inName.join(','));
    check(al.second.open && al.second.text === 'Two?' && al.second.names.includes('chbAlertIn') && !al.second.names.includes('chbAlertOut') && al.second.pe !== 'none', 'the queued dialog wins over the previous one’s exit', JSON.stringify(al.second));
    check(!al.exit.open && al.exit.closing && al.exit.names.includes('chbAlertOut') && al.gone, 'the last one fades out and is gone', JSON.stringify(al.exit));

    // ============================================================
    console.log('\n  §6 the picker over the glass dialog exits ABOVE it');
    const pk = await page.evaluate(async () => {
        const p = glassForm('Dates', [{ id: 'd', label: 'Dates', type: 'daterange' }]);
        await new Promise((r) => setTimeout(r, 80));
        gdfOpenDates('d');
        await new Promise((r) => setTimeout(r, 450));
        const dp = document.getElementById('date-picker');
        const over = dp.classList.contains('dp-over-glass') && getComputedStyle(dp).zIndex === '6100';
        closeDatePicker();
        const exiting = { z: getComputedStyle(dp).zIndex, painted: dp.getClientRects().length > 0, overGlass: dpOverGlass(), dlgOpen: document.getElementById('glass-dialog').classList.contains('open') };
        await new Promise((r) => setTimeout(r, 450));
        const doneZ = getComputedStyle(dp).zIndex;
        glassDialogResolve(false);
        await p;
        return { over, exiting, doneZ };
    });
    check(pk.over, 'the picker opened over the glass dialog at 6100');
    check(pk.exiting.z === '6100' && pk.exiting.painted && !pk.exiting.overGlass && pk.exiting.dlgOpen, 'its exit stays at 6100 while dpOverGlass already reads false and the form stays up', JSON.stringify(pk.exiting));
    check(pk.doneZ === '2100', 'and it is back at 2100 once gone', pk.doneZ);
    await page.waitForTimeout(400);

    // ============================================================
    console.log('\n  §7 reduced motion');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openIt("openProperty('21a'); await pause(300); openEnquireModal();");
    await page.waitForTimeout(300);
    const rm = await page.evaluate(() => {
        const el = document.getElementById('enquire-modal');
        closeEnquireModal();
        return { open: el.classList.contains('open'), closing: el.classList.contains('closing'), painted: el.getClientRects().length > 0 };
    });
    check(!rm.open && !rm.closing && !rm.painted, 'under reduced motion a close is a close — no exit, gone at once', JSON.stringify(rm));
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    console.log(fails ? `\n  OVERLAYS SUITE FAILED ❌ (${fails})` : '\n  OVERLAYS SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
