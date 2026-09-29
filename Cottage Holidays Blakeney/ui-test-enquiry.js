// ============================================================
//  ui-test-enquiry.js — THE SCREEN THE BUSINESS RUNS ON
//  (dev/CI only, never deployed — the runner's own ui-test-*.js glob picks it up)
//
//  The enquiry flow is the one guest surface the whole business depends on, and
//  its REFUSAL LADDER was its worst-behaved part: the sentence that explains a
//  failed send rendered 836px from the field it named, never cleared, said the
//  same thing twice and claimed the dates were missing when they were set.
//
//  Five claims, each measured on the real flow rather than on a composer:
//   §1 the refusal answers the tap — in the viewport, naming the field it focuses,
//      and never left standing over a state it no longer describes
//   §2 the picker does not move under the finger that just tapped it
//   §3 working is not disabled — a busy Send spins, it does not fade
//   §4 the sent moment leads with the tick, not with an optional password field
//   §5 the sibling sheets have ONE primary each and no browser file control
//
//  NB the refusal element is #enq-msg-details throughout: e2e-test and
//  ui-test-motion-system both read its textContent, and keeping it as THE
//  refusal (rather than scattering per-field lines) is what keeps those firing.
// ============================================================
const { d, ok, boot } = require('./ui-test-lib');

let fails = 0;
const check = (cond, label) => {
    try {
        ok(cond, label);
    } catch (e) {
        fails++;
        if (process.env.CHB_STOP) throw e;
    }
};

// The step-2 form, filled except for whatever the caller wants missing.
const FILL = {
    'enq-name': 'Sam Ferris',
    'enq-email': 'sam@example.com',
    'enq-phone': '07700900123',
    'enq-address': '3 Quay Lane, Blakeney',
    'enq-postcode': 'NR25 7ND',
    'enq-message': 'Two of us and our teenage daughter.',
};

(async () => {
    const t = await boot({ viewport: { width: 390, height: 844 } });
    const { page } = t;
    page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
    let holdSend = null; // set while §3 holds the POST open
    await page.route('**/enquiries.php', async (route) => {
        if (holdSend) return holdSend(route);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: 7 }) });
    });
    await page.goto(t.base + '/index.html');

    // Open the enquiry on a real cottage page, with dates chosen, on step 2.
    const openStep2 = async () => {
        await page.evaluate(() => {
            try { closeEnquireModal(); } catch (e) {}
            try { resetEnquiryForm(); } catch (e) {}
        });
        await page.waitForTimeout(250);
        await page.evaluate(() => { openProperty('jollyboat'); });
        await page.waitForTimeout(300);
        await page.evaluate(() => { openEnquireModal(); });
        await page.waitForTimeout(450);
        await page.evaluate(({ ci, co }) => {
            document.getElementById('enq-checkin').value = ci;
            document.getElementById('enq-checkout').value = co;
            try { dpState.start = ci; dpState.end = co; refreshDateTrigger(); } catch (e) {}
            updateEnquiryPrice();
            enquireContinue();
        }, { ci: d(30), co: d(33) });
        await page.waitForTimeout(450);
    };
    const set = (id, v) => page.evaluate(({ i, val }) => {
        const el = document.getElementById(i);
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { i: id, val: v });
    const read = () => page.evaluate(() => {
        const m = document.getElementById('enq-msg-details');
        const r = m.getBoundingClientRect();
        const a = document.activeElement;
        return {
            msg: m.textContent || '',
            shown: m.classList.contains('show'),
            inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0,
            focus: a ? a.id : '',
            live: (document.getElementById('enq-live-sub') || {}).textContent || '',
        };
    });

    // ─── §1 THE REFUSAL ANSWERS THE TAP ────────────────────────────────────────
    // It is the ANSWER to a tap; the living line under the button is the PREDICTION.
    // So the refusal has to be where the guest is when it arrives, name the field it
    // sends them to, and disappear the moment it stops being true — measured before
    // this PR: the alert at y=1207 in an 844px viewport with the named field at 330,
    // still reading "Please fill in your name and both dates" after the whole form
    // was filled, while the living line had moved on three sentences.
    console.log('\n§1 The refusal answers the tap, and never outlives it');
    await openStep2();
    // Tap it the way a guest does: scroll to the button and click it.
    await page.evaluate(() => document.getElementById('enq-submit-btn').scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(250);
    await page.click('#enq-submit-btn');
    await page.waitForTimeout(400);
    const r1 = await read();
    check(r1.shown && r1.inViewport, `the refusal is on screen where the guest is (${JSON.stringify(r1.msg)})`);
    check(/your name/i.test(r1.msg), `…it names the FIRST thing missing (${r1.msg})`);
    check(r1.focus === 'enq-name', `…and the focused field is the one it names (${r1.focus})`);
    // The dates were never missing here, and the ladder must not say they were.
    check(!/date/i.test(r1.msg), 'it does not claim the dates are missing — they are set');

    // Type the field it named: the sentence must not be left standing.
    await set('enq-name', FILL['enq-name']);
    await page.waitForTimeout(200);
    const r2 = await read();
    check(r2.msg !== r1.msg, `typing the named field changes or clears the refusal (${JSON.stringify(r2.msg)})`);
    check(!r2.shown || r2.msg === r2.live, `…and it can never contradict the living line (${JSON.stringify(r2.live)})`);

    // Fill the rest: with nothing left to refuse, nothing is refused.
    for (const [id, v] of Object.entries(FILL)) if (id !== 'enq-name') await set(id, v);
    await page.evaluate(() => {
        document.getElementById('enq-nodogs').checked = true;
        document.getElementById('enq-terms').checked = true;
        enqLiveSync();
    });
    await page.waitForTimeout(200);
    const r3 = await read();
    check(!r3.shown && r3.msg === '', `a sendable form carries no refusal at all (${JSON.stringify(r3.msg)})`);

    // A SERVER REFUSAL IS NOT THE LADDER'S TO CLEAR. The sweep above used to
    // clear anything that differed from the ladder — and a server's sentence
    // never matches the ladder, so "those dates are no longer available" was
    // wiped by the guest's 30-second background tick (liveUpdateTick →
    // updateEnquiryPrice → enqLiveSync) with nothing touched, the dot turned
    // green and the form claimed to be sendable after the server had said no.
    // Drive the exact path: an UNMARKED write (the server's shape), then the
    // tick's own call; then a LADDER-marked write, which the sweep may take.
    const srv = await page.evaluate(() => {
        setEnqMsg('details', "Sorry, your enquiry couldn't be sent: those dates are no longer available");
        updateEnquiryPrice(); // what liveUpdateTick runs every 30s
        enqLiveSync();
        const el = document.getElementById('enq-msg-details');
        return { shown: el.classList.contains('show'), msg: el.textContent };
    });
    check(srv.shown && /no longer available/.test(srv.msg), `a server refusal survives the background tick (${JSON.stringify(srv.msg)})`);
    const lad = await page.evaluate(() => {
        setEnqMsg('details', 'Please tell us your name.', 'ladder'); // stale: the name IS filled
        enqLiveSync();
        const el = document.getElementById('enq-msg-details');
        return { shown: el.classList.contains('show'), msg: el.textContent };
    });
    check(!lad.shown && lad.msg === '', `…while a stale LADDER sentence is swept (${JSON.stringify(lad.msg)})`);

    // THE SECOND RUNG IS ITS OWN SENTENCE. One rung used to cover the name AND both
    // dates, so a guest with dates chosen and no name was told the dates were missing.
    await page.evaluate(() => {
        document.getElementById('enq-checkin').value = '';
        document.getElementById('enq-checkout').value = '';
        try { dpState.start = null; dpState.end = null; } catch (e) {}
        submitEnquiry('jollyboat');
    });
    await page.waitForTimeout(350);
    // The date control lives on STEP ONE, so this refusal has to take the guest
    // there — and carry its sentence with it, or they arrive at a step that says
    // nothing about why.
    const r4 = await page.evaluate(() => {
        const a = document.activeElement;
        return {
            msg: (document.getElementById('enq-msg-review').textContent || '') + (document.getElementById('enq-msg-details').textContent || ''),
            focus: a ? a.id : '',
            onStep1: document.getElementById('enquire-step-review').style.display !== 'none',
        };
    });
    check(/dates/i.test(r4.msg) && !/name/i.test(r4.msg), `missing dates get their OWN sentence (${r4.msg})`);
    check(r4.onStep1 && r4.focus === 'enq-date-trigger', `…on the step that owns the date control, focused (${r4.focus}, step1 ${r4.onStep1})`);

    // ─── §2 THE PICKER DOES NOT MOVE UNDER THE FINGER ──────────────────────────
    // The pop was a CENTRED flex column and the card's height changes twice per
    // selection (the hint grows above the grid, the foot's receipt below it), so the
    // whole calendar walked up the screen between the two taps that make a range:
    // measured at 390, card top 204.3 → 204.3 → 178.3.
    console.log('\n§2 The calendar stays where it was tapped');
    await openStep2();
    await page.evaluate(() => { enquireBack(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        document.getElementById('enq-checkin').value = '';
        document.getElementById('enq-checkout').value = '';
        openDatePicker();
    });
    await page.waitForTimeout(450);
    const ymd = d(40).split('-');
    await page.evaluate(({ y, m }) => { dpState.view = new Date(+y, +m - 1, 1); renderDatePicker(); }, { y: ymd[0], m: ymd[1] });
    // The card animates in on --sheet; wait for the paint to SETTLE rather than
    // guessing at a clock (the seek-never-race rule).
    const settle = async () => {
        await page.waitForFunction(() => {
            const c = document.querySelector('.datepicker-card');
            return !!c && c.getAnimations({ subtree: true }).every((a) => a.playState !== 'running');
        }, null, { timeout: 4000, polling: 'raf' }).catch(() => {});
        await page.waitForTimeout(120);
    };
    const cardTop = async () => {
        await settle();
        return page.evaluate(() => Math.round(document.querySelector('.datepicker-card').getBoundingClientRect().top * 10) / 10);
    };
    const t0 = await cardTop();
    await page.evaluate((iso) => dpPick(iso), d(40));
    const t1 = await cardTop();
    await page.evaluate((iso) => dpPick(iso), d(43));
    const t2 = await cardTop();
    const spread = Math.max(t0, t1, t2) - Math.min(t0, t1, t2);
    check(spread <= 1, `the card's top is the same across all three renders (${t0} / ${t1} / ${t2})`);
    await page.evaluate(() => closeDatePicker());
    await page.waitForTimeout(300);

    // ─── §3 WORKING IS NOT DISABLED ────────────────────────────────────────────
    // The disable stays — pointer-events alone does not stop keyboard activation,
    // and it is the documented guard against a double-submitted enquiry — but
    // busy+disabled computed 0.6, so "Sending…" faded to 60% while it worked.
    console.log('\n§3 A Send that is working spins; it does not fade');
    await openStep2();
    for (const [id, v] of Object.entries(FILL)) await set(id, v);
    await page.evaluate(() => {
        document.getElementById('enq-nodogs').checked = true;
        document.getElementById('enq-terms').checked = true;
        enqLiveSync();
    });
    // SCROLLED TO THE BUTTON, which is where a guest is when they press Send —
    // and what makes §4's scrollTop check mean anything: from the top of the sheet
    // it would read 0 whatever the sent moment did.
    await page.evaluate(() => {
        const b = document.querySelector('#enquire-modal .modal-box');
        b.scrollTop = b.scrollHeight;
    });
    await page.waitForTimeout(200);
    const preScroll = await page.evaluate(() => Math.round(document.querySelector('#enquire-modal .modal-box').scrollTop));
    check(preScroll > 100, `(fixture) the sheet really is scrolled down before the send (${preScroll})`);
    let release = null;
    holdSend = (route) => { release = () => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: 7 }) }); };
    page.evaluate(() => { submitEnquiry('jollyboat'); }).catch(() => {});
    await page.waitForFunction(() => document.getElementById('enq-submit-btn').classList.contains('is-busy'), null, { timeout: 5000 });
    const busy = await page.evaluate(() => {
        const b = document.getElementById('enq-submit-btn');
        return { disabled: b.disabled, busy: b.classList.contains('is-busy'), op: getComputedStyle(b).opacity, spin: getComputedStyle(b, '::before').animationName };
    });
    check(busy.busy && busy.disabled, `the send is guarded while it is in flight (busy ${busy.busy}, disabled ${busy.disabled})`);
    check(busy.op === '1', `…and it does not dim (opacity ${busy.op})`);
    check(busy.spin === 'chbSpin', `…the wait has a shape instead (${busy.spin})`);

    // ─── §4 THE SENT MOMENT LEADS WITH THE TICK ────────────────────────────────
    console.log('\n§4 The sent moment leads with the tick');
    for (let i = 0; i < 60 && !release; i++) await page.waitForTimeout(50);
    release();
    holdSend = null;
    await page.waitForFunction(() => document.getElementById('enquire-step-account').style.display === '', null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const sent = await page.evaluate(() => {
        const a = document.activeElement;
        return {
            scrollTop: Math.round(document.querySelector('#enquire-modal .modal-box').scrollTop),
            focus: a ? a.id : '',
            drawn: document.querySelectorAll('#enquire-step-account .pay-done-tick').length,
            marks: document.querySelectorAll('#enquire-step-account svg').length,
            sumBg: getComputedStyle(document.getElementById('enq-sent-sum')).backgroundColor,
        };
    });
    check(sent.scrollTop === 0, `the sheet opens at the top, on the tick (scrollTop ${sent.scrollTop})`);
    check(sent.focus !== 'enq-acct-password', `…and not on the optional password field (${sent.focus || '(none)'})`);
    check(sent.drawn === 1 && sent.marks === 1, `"sent" is said ONCE — one drawn tick, no second ✓ (${sent.drawn}/${sent.marks})`);
    check(!/^rgba?\(0, 0, 0/.test(sent.sumBg), `…and the receipt is a well, not a black stain (${sent.sumBg})`);

    // ─── §5 THE SIBLING SHEETS ─────────────────────────────────────────────────
    // One primary each (the enquiry's Continue / Send are accent, and these three
    // asked for the same commitment in outlined glass), one close control at the
    // 44px floor, and no browser file chrome painting inside our own field.
    console.log('\n§5 The sibling sheets: one primary, one close, no UA file control');
    await page.evaluate(() => { try { closeEnquireModal(); } catch (e) {} });
    await page.waitForTimeout(300);
    const SHEETS = [
        ['waitlist-modal', 'openWaitlistModal("jollyboat")', 'closeWaitlistModal()', true],
        ['photo-upload-modal', 'openPhotoUpload("jollyboat")', 'closePhotoUpload()', true],
        ['exp-suggest-modal', 'openExperienceSuggest()', 'closeExperienceSuggest()', true],
        ['terms-modal', 'openTermsModal()', 'closeTermsModal()', false],  // a document, not a form
    ];
    for (const [id, open, close, wantsPrimary] of SHEETS) {
        await page.evaluate((o) => {
            currentGuest = { email: 'g@e.com', name: 'G', phone: '', address: '', postcode: '' };
            eval(o);
        }, open);
        await page.waitForTimeout(450);
        const m = await page.evaluate((i) => {
            const el = document.getElementById(i);
            if (!el || !el.classList.contains('open')) return { err: 'not open' };
            const painted = (n) => { const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(n).opacity !== '0'; };
            const cl = el.querySelector('.reviews-modal-close, .toast-close');
            const cr = cl ? cl.getBoundingClientRect() : null;
            return {
                accents: [...el.querySelectorAll('.btn-accent')].filter(painted).map((b) => b.textContent.trim()),
                closeCls: cl ? cl.className : '(none)',
                closeW: cr ? Math.round(cr.width) : 0,
                closeH: cr ? Math.round(cr.height) : 0,
                uaFiles: [...el.querySelectorAll('input[type=file]')].filter(painted).length,
            };
        }, id);
        check(!m.err, `${id} opens (${m.err || 'ok'})`);
        if (!m.err) {
            if (wantsPrimary) check(m.accents.length === 1, `${id}: exactly one accent primary (${JSON.stringify(m.accents)})`);
            check(m.uaFiles === 0, `${id}: no bare file input is painted (${m.uaFiles})`);
            check(m.closeW >= 44 && m.closeH >= 44, `${id}: the close control meets the 44px floor (${m.closeW}×${m.closeH}, ${m.closeCls})`);
        }
        await page.evaluate((c) => eval(c), close);
        await page.waitForTimeout(300);
    }

    console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
    await t.done(fails);
})();
