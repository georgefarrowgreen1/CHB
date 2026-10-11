// ============================================================
//  ui-test-enquiry.js — THE SCREEN THE BUSINESS RUNS ON
//  (dev/CI only, never deployed — the runner's own ui-test-*.js glob picks it up)
//
//  The enquiry flow is the one guest surface the whole business depends on, and
//  its REFUSAL LADDER was its worst-behaved part: the sentence that explains a
//  failed send rendered 836px from the field it named, never cleared, said the
//  same thing twice and claimed the dates were missing when they were set.
//
//  The claims, each measured on the real flow rather than on a composer:
//   §1 the refusal answers the tap — in the viewport, naming the field it focuses,
//      and never left standing over a state it no longer describes
//   §2 the picker does not move under the finger that just tapped it
//   §3 working is not disabled — a busy Send spins, it does not fade
//   §4 the sent moment leads with the tick, not with the optional follow step
//   §5 the sibling sheets have ONE primary each and no browser file control
//   §6 sending again after a lost answer is the same enquiry
//   §7 following the enquiry is one screen for every address; only the emailed
//      code says whether there is an account or a stay
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
    check(!/enq-follow|enq-code/.test(sent.focus), `…and not on the optional follow step (${sent.focus || '(none)'})`);
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

    // ─── §6 A SEND WHOSE ANSWER WAS LOST GOES AGAIN AS THE SAME ENQUIRY ────────
    // The request can reach the server and lose only its reply; the guest is told it
    // couldn't be sent and taps Send again. Without an id that was a second enquiry,
    // each with its own acknowledgement email and owner alert. The server answers a
    // repeated id from its ledger (integration §17), so what the client owes is the
    // SAME id on the retry, and a new one for an enquiry made after this one went.
    console.log('\n§6 Sending again after a lost answer is the same enquiry');
    const fillAll = async () => {
        await openStep2();
        for (const [id, v] of Object.entries(FILL)) await set(id, v);
        await page.evaluate(() => {
            document.getElementById('enq-nodogs').checked = true;
            document.getElementById('enq-terms').checked = true;
            enqLiveSync();
        });
    };
    await fillAll();
    const sentIds = [];
    let dropNext = true;
    holdSend = async (route) => {
        let b = {};
        try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (b.action === 'submit') {
            sentIds.push(String(b.op_id || ''));
            if (dropNext) { dropNext = false; return route.abort('failed'); }
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: 8 }) });
    };
    await page.evaluate(() => submitEnquiry('jollyboat'));
    const lost = await page.evaluate(() => document.getElementById('enq-msg-details').textContent || '');
    check(/couldn.t be sent/.test(lost), `(fixture) the first send's answer was lost (${lost.slice(0, 60)})`);
    await page.evaluate(() => submitEnquiry('jollyboat'));
    check(sentIds.length === 2 && /^op-/.test(sentIds[0]) && sentIds[0] === sentIds[1], `the retry carries the same id, so the server answers it once (${JSON.stringify(sentIds)})`);
    await fillAll();
    await page.evaluate(() => submitEnquiry('jollyboat'));
    check(sentIds.length === 3 && sentIds[2] !== sentIds[0], 'an enquiry made after one went is a new one, even in the same words');
    holdSend = null;

    // ─── §7 FOLLOW THIS ENQUIRY: ONE SCREEN FOR EVERY ADDRESS ──────────────────
    // The sent screen asked enquiries.php whether the email had an account and
    // offered "Welcome back — Sign in" or "Create account" accordingly, so anyone who
    // typed a guest's address learned whether they had stayed. Now every address gets
    // the same offer, a code goes to the inbox, and only after the code does the
    // screen say anything about an account or a stay.
    console.log('\n§7 Following the enquiry: one screen for every address, the inbox decides');
    const authPosts = [];
    let verifyAnswer = { ok: true, new: true };
    let stayRows = [];
    await page.route('**/auth.php', async (route) => {
        let b = {};
        try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        authPosts.push(b);
        const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
        if (b.action === 'guest_code_verify' && b.code === '111111') return json({ error: "That code isn't right. Check the latest email and try again.", code: 'wrong', left: 2 }, 401);
        if (b.action === 'guest_code_verify') return json(verifyAnswer);
        if (b.action === 'guest_code_register') return json({ ok: true, guest: { name: b.name, email: 'sam@example.com', phone: b.phone || '', address: b.address || '', postcode: b.postcode || '' } });
        return json({ ok: true });
    });
    await page.route('**/my-bookings.php', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bookings: stayRows, enquiries: [], completed_stays: 0 }) }));
    const followState = () => page.evaluate(() => {
        const vis = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
        const a = document.activeElement;
        return {
            start: vis('enq-follow-start'), code: vis('enq-follow-code'), done: vis('enq-follow-done'),
            startText: ((document.getElementById('enq-follow-start') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
            codeText: ((document.getElementById('enq-follow-code') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
            title: ((document.getElementById('enq-follow-done-h') || {}).textContent || '').trim(),
            text: ((document.getElementById('enq-follow-done-p') || {}).textContent || '').trim(),
            msg: ((document.getElementById('enq-follow-msg') || {}).textContent || '').trim(),
            skip: ((document.getElementById('enq-follow-skip') || {}).textContent || '').trim(),
            focus: a ? a.id : '',
            old: !!document.getElementById('enq-acct-new') || !!document.getElementById('enq-acct-existing') || !!document.getElementById('enq-acct-password'),
            guest: typeof currentGuest !== 'undefined' && currentGuest ? currentGuest.email : '',
        };
    });
    const sendFresh = async (answer) => {
        holdSend = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
        await fillAll();
        await page.evaluate(() => submitEnquiry('jollyboat'));
        await page.waitForFunction(() => document.getElementById('enquire-step-account').style.display === '', null, { timeout: 8000 });
        await page.waitForTimeout(300);
        holdSend = null;
    };
    // (a) A NEW address.
    await page.evaluate(() => { currentGuest = null; setGuestUI(); });
    await sendFresh({ success: true, id: 9 });
    const s1 = await followState();
    check(s1.start && !s1.code && !s1.done, `the sent screen offers to follow the enquiry (${JSON.stringify([s1.start, s1.code, s1.done])})`);
    check(/Follow this enquiry/.test(s1.startText) && /sam@example\.com/.test(s1.startText) && /Only someone who can open that inbox/.test(s1.startText),
        `…by a code to the address the enquiry gave (${s1.startText.slice(0, 120)})`);
    check(!s1.old, 'the old Create account / Welcome back blocks are gone');
    check(!/enq-follow|enq-code/.test(s1.focus), `…and nothing in it takes the focus before the guest asks (${s1.focus || '(none)'})`);
    await page.click('#enq-follow-send');
    await page.waitForFunction(() => document.getElementById('enq-follow-code') && !document.getElementById('enq-follow-code').hidden, null, { timeout: 5000 });
    await page.waitForTimeout(150);
    const req = authPosts.filter((b) => b.action === 'guest_code_request');
    check(req.length === 1 && req[0].email === 'sam@example.com', `"Email me a code" asks for a code to that address (${JSON.stringify(req)})`);
    const s2 = await followState();
    check(s2.code && !s2.start && /Check your email/.test(s2.codeText) && /sam@example\.com/.test(s2.codeText), `…then asks for it, naming the inbox (${s2.codeText.slice(0, 90)})`);
    check(s2.focus === 'enq-code', `…with the code field ready (${s2.focus})`);
    check(await page.evaluate(() => { const i = document.getElementById('enq-code'); return i.getAttribute('autocomplete') === 'one-time-code' && i.getAttribute('inputmode') === 'numeric'; }),
        'the field offers the code from Mail (one-time-code, numeric)');
    check(await page.evaluate(() => { const b = document.getElementById('enq-follow-resend'); return b.disabled && /in \d+s/.test(b.textContent); }),
        'a new code can be asked for again only after a short wait, which it shows');
    await page.fill('#enq-code', '12345');
    await page.click('#enq-follow-go');
    await page.waitForTimeout(150);
    check((await followState()).msg === 'Enter all 6 digits.', 'Continue with five digits says what is missing');
    await page.fill('#enq-code', '111111');
    await page.waitForFunction(() => /isn.t right/.test((document.getElementById('enq-follow-msg') || {}).textContent || ''), null, { timeout: 5000 });
    const s3 = await followState();
    check(/2 more tries/.test(s3.msg) && s3.code && !s3.guest, `a wrong code says so and signs nobody in (${s3.msg})`);
    verifyAnswer = { ok: true, new: true };
    stayRows = [];
    await page.fill('#enq-code', '424242');
    await page.waitForFunction(() => document.getElementById('enq-follow-done') && !document.getElementById('enq-follow-done').hidden, null, { timeout: 5000 });
    const reg = authPosts.filter((b) => b.action === 'guest_code_register');
    check(reg.length === 1 && reg[0].name === FILL['enq-name'] && reg[0].phone === FILL['enq-phone'] && reg[0].address === FILL['enq-address'] && reg[0].postcode === FILL['enq-postcode'],
        `a new address makes the account with the details the enquiry gave (${JSON.stringify(reg[0] || {})})`);
    const s4 = await followState();
    check(s4.title === 'You’re in, Sam' && s4.text === 'Your account uses the details you just gave. Your enquiry is in My stays.', `…and says so once the inbox is proven (${s4.title} / ${s4.text})`);
    check(s4.guest === 'sam@example.com' && s4.skip === 'Close', `…signed in, the way out reading Close (${s4.guest}, ${s4.skip})`);
    check(!authPosts.some((b) => b.action === 'guest_register'), 'nothing posts the retired password sign-up');
    await page.click('[data-act="enqFollowOpen"]');
    await page.waitForTimeout(500);
    check(await page.evaluate(() => !document.getElementById('enquire-modal').classList.contains('open')), 'Open My stays closes the enquiry');

    // (b) An address WITH an account and a stay, answered by an OLD server that still
    // says so: the screen before the code is word for word the same.
    await page.evaluate(() => { currentGuest = null; setGuestUI(); });
    const regBefore = authPosts.filter((b) => b.action === 'guest_code_register').length;
    await sendFresh({ success: true, id: 10, account_exists: true });
    const s5 = await followState();
    check(s5.start && s5.startText === s1.startText, `an account behind the address changes nothing before the code (${s5.startText === s1.startText})`);
    await page.click('#enq-follow-send');
    await page.waitForFunction(() => document.getElementById('enq-follow-code') && !document.getElementById('enq-follow-code').hidden, null, { timeout: 5000 });
    verifyAnswer = { ok: true, guest: { name: 'Sam Ferris', email: 'sam@example.com', phone: '', address: '', postcode: '' } };
    stayRows = [{ id: 5, prop_key: 'jollyboat', name: 'Sam Ferris', email: 'sam@example.com', check_in: d(-200), check_out: d(-197), adults: 2, children: 0, payment: 'paid', deposit_paid: 300, agreed_total: 300 }];
    await page.fill('#enq-code', '424242');
    await page.waitForFunction(() => document.getElementById('enq-follow-done') && !document.getElementById('enq-follow-done').hidden, null, { timeout: 5000 });
    const s6 = await followState();
    check(s6.title === 'Welcome back, Sam' && s6.text === 'This enquiry is in My stays, with your other bookings.', `a known address is welcomed back, after the code (${s6.title} / ${s6.text})`);
    check(authPosts.filter((b) => b.action === 'guest_code_register').length === regBefore, '…and no second account is made');
    await page.evaluate(() => { try { closeEnquireModal(); } catch (e) {} currentGuest = null; setGuestUI(); });

    console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
    await t.done(fails);
})();
