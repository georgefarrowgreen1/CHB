// ============================================================
//  ui-test-ownerday.js — Today, the two hubs and the Inbox: the owner's
//  daily work, measured (dev/CI only, never deployed).
//
//  §1  ONE COUNT FOR ONE FACT. The Today dock pip, the Needs-you badge and
//      the rail's Today row are the SAME number — and it is the DUTY count,
//      not the unseen-enquiry count they used to disagree over. The Inbox
//      pip keeps unseen and says so in words.
//  §2  NOTHING LOSES WORDS. Every .bk-row-name / .bk-row-dates /
//      .bhub-sticky-verb / .bhub-kv-label and every enquiry-row sub at 360
//      AND 390, swept for text lost sideways or past its clamp — with a
//      60-character verb and a 34-character guest name INJECTED, because the
//      real strings fit and the sweep would otherwise be vacuous.
//  §3  ONE ROW SHAPE. The row's IDENTITY LINE is one line whatever the data
//      (the invariant), and on a fixture where the two enquiries differ only
//      in how long they have waited they are the same height (the defect: a
//      pixel comparison of the status chip's text against the row's width —
//      the cottage-cards lesson, here driven by the enquiry's AGE).
//  §4  THE DECLINED TAB TELLS THE TRUTH. Capsule, sub and fold state all
//      describe declined enquiries — not "⚠ 3 waiting" and a WAITING
//      enquirer's name above a declined list.
//  §5  SEND IS IN REACH. The email composer's Send button is inside the
//      viewport the moment it opens, at 390 and at 1280.
//
//  §6  THE SMALLER DECLARATIONS, one measurable claim each: the accent CTA's
//      size, the day line's unbreakable money unit, the past stay's caption,
//      the "Also stayed" row, the intel sub, the Needs-attention capsule, the
//      enquiry quote's shape, the conversation sheet + its composer, the
//      ledger row's time, the filled desktop CTA and the un-repeated heading.
//
//  §2 asks each leaf whether it clipped its OWN content (scrollWidth /
//  scrollHeight against its client box — the round-eight detector), with a
//  Range over the element's text nodes as the vacuity gate: an element with no
//  painted ink is skipped rather than counted as clean. §3's second half and
//  §6's "Also stayed" case are where the INK matters — a squeezed flex child
//  keeps a comfortable box while its text run is a few pixels wide.
// ============================================================
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// Local-formatted, never toISOString() — that is UTC and slips a day near midnight.
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
// Enquiry age: the app FLOORS elapsed hours into days, so seed by hours-ago.
const hrsAgo = (h) => { const t = new Date(Date.now() - h * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:00`; };

const LONG_NAME = 'Alexandrina Featherstonehaugh-Smythe'; // 36 chars
const LONG_VERB = 'Email a secure card link and then chase the balance politely'; // 60 chars

const mkB = (id, prop, name, inD, outD, pay, dep, hold, extra) => ({
    id, prop_key: prop, name, email: 'g@e.com', phone: '07700 900000', address: '', postcode: 'NR25 7AB',
    check_in: d(inD), check_out: d(outD), check_in_time: '15:00', check_out_time: '10:00',
    adults: 2, children: 0, payment: pay, deposit_paid: dep, payment_method: 'card', payment_date: '',
    agreed_total: 640, agreed_per_night: 145, agreed_nights: 4, agreed_nightly: 580, agreed_booking_fee: 60,
    agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-10), hold_status: hold || 'none', notes: '',
    ...(extra || {}),
});

const mkE = (id, prop, name, inD, outD, hours, seen) => ({
    id, prop_key: prop, name, email: `e${id}@x.com`, phone: '', address: '', postcode: '',
    check_in: d(inD), check_out: d(outD), adults: 2, children: 1,
    message: 'Is the cottage free then, and is there parking?', status: 'new',
    created_at: hrsAgo(hours), seen_at: seen || null,
});

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 1440, height: 950 } });

    let declined = [];
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const post = route.request().postData() || '';
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
        if (url.includes('cron-status.php')) return json({ stale: false, everRan: true, ageHours: 2 });
        if (url.includes('bookings.php')) {
            if (act === 'email_logs') return json({ ok: true, logs: {} });
            if (act === 'history') return json({ ok: true, history: [] });
            if (act === 'hub_bundle') return json({ ok: true, payments: [], events: [] });
            if (act === 'payments') return json({ ok: true, payments: [] });
            if (act === 'deposit_returns') return json({ ok: true, returns: [] });
            return json({ bookings: [
                // Two deposits to return + two balances to chase = four duties.
                mkB(1, '21a', LONG_NAME, 3, 7, 'deposit', 120),
                mkB(2, 'jollyboat', 'Emma Clarke', -6, -2, 'paid', 0, 'charged'),
                mkB(3, 'pimpernel', 'Tom Hardy', -9, -5, 'paid', 0, 'charged'),
                mkB(4, 'jollyboat', 'Cara Nash', 5, 9, 'unpaid', 0),
            ] });
        }
        if (url.includes('enquiries.php')) {
            if (act === 'declined') return json({ ok: true, enquiries: declined });
            return json({ enquiries: [
                // Two UNSEEN enquiries. Their subs are the same length on
                // purpose — §3's question is whether the STATUS text decides
                // the row's height, so nothing else may differ in length.
                mkE(7, '21a', 'Jane Doe', 20, 24, 130, null),      // 5 days waiting → stale
                mkE(8, 'jollyboat', 'Ravi Shah', 20, 24, 4, null), // fresh
            ] });
        }
        if (url.includes('messages.php')) {
            if (act === 'thread') return json({ ok: true,
                thread: { thread_id: 1, name: LONG_NAME, email: 'ali@example.com', archived: 0, is_guest: 1 },
                messages: [
                    { id: 1, role: 'guest', body: 'Is there parking at the cottage?', created_at: hrsAgo(3) },
                    { id: 2, role: 'admin', body: 'Yes — off-street, right outside.', created_at: hrsAgo(2) },
                ],
                bookings: [] });
            return json({ ok: true, threads: [
                { thread_id: 1, name: 'Ali', unread: 1, last_role: 'guest', archived: 0, last_body: 'Hi' },
            ] });
        }
        if (url.includes('reviews.php')) return json({ ok: true, reviews: [] });
        if (url.includes('photos.php')) return json({ ok: true, photos: [] });
        if (url.includes('experiences.php')) return json({ ok: true, experiences: [] });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
    });

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(700);
    await page.evaluate(async () => { await openBookings(); });
    await page.waitForTimeout(1700);

    // ---------- §1. one count for one fact -----------------------------
    console.log('§1. one count for one fact');
    const counts = await page.evaluate(() => {
        renderNeedsYou();
        refreshInboxBadge();
        const txt = (id) => ((document.getElementById(id) || {}).textContent || '').trim();
        return {
            dock: txt('dock-badge-enquiries'),
            strip: txt('needs-you-count'),
            rail: txt('rail-cnt-today'),
            duties: String((window.chbDuties() || []).length),
            unseen: String(window.unseenEnquiries()),
            inboxPip: txt('dock-badge-inbox'),
            // The BUTTON's name, not the pip's: a span with no role inside a
            // button that carries an explicit aria-label is never traversed.
            inboxLbl: ((document.querySelector('.admin-dock-btn[data-view="view-inbox"]') || {}).getAttribute
                ? document.querySelector('.admin-dock-btn[data-view="view-inbox"]').getAttribute('aria-label') : '') || '',
            todayLbl: ((document.querySelector('.admin-dock-btn[data-view="view-backoffice"]') || {}).getAttribute
                ? document.querySelector('.admin-dock-btn[data-view="view-backoffice"]').getAttribute('aria-label') : '') || '',
            pipTitle: (document.getElementById('dock-badge-inbox') || {}).title || '',
        };
    });
    // VACUITY GUARD, and it is the whole point: with duties === unseen the
    // three surfaces would agree on the broken code too.
    ok(Number(counts.duties) >= 3 && counts.duties !== counts.unseen,
        `the fixture separates the two numbers (${counts.duties} duties vs ${counts.unseen} unseen)`);
    ok(counts.dock === counts.duties, `the Today dock pip counts DUTIES (${counts.dock} vs ${counts.duties})`);
    ok(counts.strip === counts.duties, `…the Needs-you badge says the same (${counts.strip})`);
    ok(counts.rail === counts.duties, `…and so does the rail's Today row (${counts.rail})`);
    // The Inbox pip is a DIFFERENT question (unseen, Mail's own sidebar badge)
    // and is DISTINGUISHED IN WORDS rather than being folded into one number.
    ok(counts.inboxPip === counts.unseen, `the Inbox pip still counts unseen (${counts.inboxPip})`);
    ok(/^Inbox, \d+ unseen$/.test(counts.inboxLbl) && /^\d+ unseen$/.test(counts.pipTitle),
        `…and names itself so the two numbers do not read as a disagreement ("${counts.inboxLbl}")`);
    ok(/^Today, \d+ needing you$/.test(counts.todayLbl),
        `…while the Today button says what ITS number counts ("${counts.todayLbl}")`);

    // ---------- §2. nothing loses words --------------------------------
    // The sweep runs at 360 and 390 over Today, the booking hub (whose sticky
    // carries the verb) and the Inbox list.
    console.log('§2. no words lost at 360 or 390');
    // The hostile GUEST NAME rides the fixture (booking 1 and the hub it
    // opens) — the shipped names fit, so a sweep of them alone would pass with
    // the clamp deleted. The hostile VERB is injected separately below,
    // because for the sticky the two claims are opposites: the DEFAULT label
    // must not clip, and a 60-character one must clip rather than push the
    // figure out (its ellipsis is the documented backstop).
    const sweep = async (w) => {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(400);
        const seen = [];
        // Today (the bookings list carries .bk-row-name / .bk-row-dates).
        await page.evaluate(async () => { await openBookings(); });
        await page.waitForTimeout(900);
        seen.push(...await lost(page));
        // The booking hub: the sticky's verb + the guest card's kv labels.
        await page.evaluate(async () => { await openBookingHub('b1'); });
        await page.waitForTimeout(900);
        // MEASURING A FOLD'S CONTENTS MEANS OPENING IT FIRST — geometry does
        // not pass through `hidden`, only textContent does. Opened through the
        // app's OWN toggle, keyed off each group's data-grp: chbAttrs emits
        // `data-args='["guest"]'` (a JSON list), NOT data-arg, so the obvious
        // selector finds nothing and the opener is a silent no-op — the
        // documented trap, walked into once while writing this.
        await page.evaluate(() => {
            document.querySelectorAll('#booking-hub-content .bhub-fold-grp[data-grp]').forEach((g) => {
                const k = g.getAttribute('data-grp');
                const f = document.getElementById('bhub-fold-' + k);
                if (f && f.hidden) window.bhubFoldToggle(k);
            });
        });
        await page.waitForTimeout(600);
        seen.push(...await lost(page));
        // The Inbox list.
        await page.evaluate(async () => { await openInbox(); });
        await page.waitForTimeout(900);
        seen.push(...await lost(page));
        return seen;
    };

    // A leaf "loses words" when its own content overflows its client box —
    // sideways (an ellipsis) or downwards (past a -webkit-box clamp). The ink
    // is measured too, but only as the vacuity gate: a leaf that paints no
    // text at all must be skipped, never counted as clean.
    const lost = (p) => p.evaluate(() => {
        const SEL = '.bk-row-name, .bk-row-dates, .bhub-sticky-verb, .bhub-kv-label';
        const out = [];
        const rng = document.createRange();
        document.querySelectorAll(SEL).forEach((el) => {
            if (!el.getClientRects().length) return;
            const txt = (el.textContent || '').trim();
            if (!txt) return;
            // The INK, not the box: a Range over the element's own text nodes.
            let inkW = 0, inkBottom = -1e9, inkTop = 1e9;
            for (const n of el.childNodes) {
                if (n.nodeType === 3 && !String(n.nodeValue).trim()) continue;
                rng.selectNodeContents(n);
                for (const r of rng.getClientRects()) {
                    inkW = Math.max(inkW, r.width);
                    inkBottom = Math.max(inkBottom, r.bottom);
                    inkTop = Math.min(inkTop, r.top);
                }
            }
            if (inkW === 0) return;
            const box = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
            const sideways = el.scrollWidth - el.clientWidth > 1 && cs.textOverflow === 'ellipsis';
            const clamped = el.scrollHeight - el.clientHeight > 1;
            if (sideways || clamped) {
                out.push({ cls: el.className, txt: txt.slice(0, 46), w: Math.round(box.width - padX), ink: Math.round(inkW), sideways, clamped });
            }
        });
        return out;
    });

    const lost360 = await sweep(360);
    ok(lost360.length === 0, `360: nothing loses words (${lost360.length ? JSON.stringify(lost360[0]) : 'clean'})`);
    const lost390 = await sweep(390);
    ok(lost390.length === 0, `390: nothing loses words (${lost390.length ? JSON.stringify(lost390[0]) : 'clean'})`);
    // VACUITY GUARD: a sweep that found nothing to measure proves nothing.
    const swept = await page.evaluate(() => document.querySelectorAll('.bk-row-name, .bk-row-dates, .bhub-sticky-verb, .bhub-kv-label').length);
    ok(swept >= 4, `the sweep had something to measure (${swept} leaves on the last screen)`);
    // THE STICKY'S DEFAULT VERB FITS. It clipped ("£340.00 Record a pay…") on
    // the page's primary control — the everyday label, not a hostile one.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const verbFit = await page.evaluate(async () => {
        await openBookingHub('b4'); // unpaid, nothing received → the cash-rail ask
        await new Promise((r) => setTimeout(r, 900));
        const v = document.querySelector('.bhub-sticky-verb');
        if (!v || !v.getClientRects().length) return null;
        return { txt: (v.textContent || '').trim(), clipped: v.scrollWidth - v.clientWidth > 1, room: Math.round(v.clientWidth) };
    });
    ok(!!verbFit && verbFit.txt.length >= 6, `the sticky renders its real verb ("${verbFit && verbFit.txt}")`);
    ok(!!verbFit && !verbFit.clipped, `…whole, not ellipsised (${verbFit && verbFit.room}px of rail)`);
    // …AND A HOSTILE ONE GIVES WAY RATHER THAN PUSHING THE FIGURE OUT. Injected,
    // because the shipped label now fits and this half would be vacuous without.
    const verbHostile = await page.evaluate((verb) => {
        const btn = document.querySelector('.bhub-sticky-btn');
        const fig = document.querySelector('.bhub-sticky-fig');
        const v = document.querySelector('.bhub-sticky-verb');
        if (!btn || !fig || !v) return null;
        v.textContent = verb;
        const rb = btn.getBoundingClientRect(), rf = fig.getBoundingClientRect();
        const out = {
            injected: (v.textContent || '').length,
            figWhole: fig.scrollWidth <= fig.clientWidth + 1,
            figInside: rf.right <= rb.right + 1 && rf.left >= rb.left - 1,
            noOverflow: btn.scrollWidth <= btn.clientWidth + 2,
        };
        renderBookingHub();
        return out;
    }, LONG_VERB);
    ok(!!verbHostile && verbHostile.injected === LONG_VERB.length, `a ${LONG_VERB.length}-character verb was injected`);
    ok(!!verbHostile && verbHostile.figWhole && verbHostile.figInside && verbHostile.noOverflow,
        'the hostile verb ellipsises — the figure never gives an inch');
    // And the long guest name is on the list (the .bk-row-name case).
    await page.evaluate(async () => { await openBookings(); });
    await page.waitForTimeout(900);
    const nameSeen = await page.evaluate((n) => [...document.querySelectorAll('.bk-row-name')].some((e) => (e.textContent || '').includes(n)), LONG_NAME);
    ok(nameSeen, 'the 34-character guest name is on the list it has to survive');

    // ---------- §3. one row shape --------------------------------------
    // The enquiries differ ONLY in how long they have waited — which used to
    // wrap one row's chip under the cottage pill and make it 145px beside a
    // neighbour at 109.
    console.log('§3. every enquiry row is the same height');
    await page.evaluate(async () => { await openInbox(); });
    await page.waitForTimeout(1000);
    const heights = await page.evaluate(() => {
        const els = [...document.querySelectorAll('#inbox-list .bk-row')].filter((e) => e.getClientRects().length);
        return els.map((e) => Math.round(e.getBoundingClientRect().height));
    });
    ok(heights.length >= 2, `two enquiry rows render (${heights.length})`);
    // The fixture's two enquiries differ ONLY in how long they have waited —
    // same cottage-name length, same dates, same party — so any difference in
    // height can only have come from the status text.
    ok(heights.length >= 2 && Math.max(...heights) - Math.min(...heights) <= 1,
        `their heights match — the status text does not decide the anatomy (${heights.join(' / ')})`);
    // …AND THE INVARIANT THAT HOLDS WITH ANY DATA: the row's top line is ONE
    // line. A sub wrapping to its second clamped line is ordinary text flow;
    // the status chip dropping BELOW the cottage pill is the anatomy
    // collapsing, and that is what made one row 145px beside a 109px twin.
    const tops = await page.evaluate(() =>
        [...document.querySelectorAll('#inbox-list .bk-row-top')].filter((e) => e.getClientRects().length).map((e) => {
            const kids = [...e.children].filter((c) => c.getClientRects().length);
            const tallest = Math.max(0, ...kids.map((c) => c.getBoundingClientRect().height));
            return { h: Math.round(e.getBoundingClientRect().height), tallest: Math.round(tallest), n: kids.length };
        }));
    ok(tops.length >= 2, `the top lines were measured (${tops.length}, vacuity guard ≥2)`);
    ok(tops.every((t) => t.n >= 2 && t.h - t.tallest <= 2),
        `every row's identity line stays ONE line (${tops.map((t) => t.h + '/' + t.tallest).join(' · ')})`);
    // …and the wait is still SAID — in the SUB, not just somewhere on the row.
    // Reading the whole list's textContent would pass on the broken code too,
    // because the old chip said it as well (break-tested; it did).
    const waitSaid = await page.evaluate(() =>
        [...document.querySelectorAll('#inbox-list .bk-row-dates')].map((e) => e.textContent || '').join(' | '));
    ok(/waiting 5 days/.test(waitSaid), `the wait moved into the sub rather than being dropped (“${waitSaid.slice(0, 70)}”)`);
    const capText = await page.evaluate(() =>
        [...document.querySelectorAll('#inbox-list .bk-row-top .st-cap')].map((e) => (e.textContent || '').trim()));
    ok(capText.length >= 2 && capText.every((t) => !/waiting/i.test(t)),
        `…and the capsule carries only the decision (${capText.join(' / ')})`);

    // ---------- §4. the declined tab tells the truth --------------------
    console.log('§4. the declined verdict describes declined enquiries');
    declined = [{ ...mkE(9, 'pimpernel', 'Jem Beighton', 30, 34, 60, null), declined_at: hrsAgo(72) }];
    await page.evaluate(async () => { await inboxTab('declined'); });
    await page.waitForTimeout(900);
    const dec = await page.evaluate(() => ({
        cap: ((document.getElementById('iv-sum-enquiries') || {}).textContent || '').trim(),
        tone: ((document.querySelector('#iv-sum-enquiries .st-cap') || {}).className || ''),
        warn: !!document.querySelector('#iv-sum-enquiries .st-wic'),
        sub: ((document.getElementById('iv-sub-enquiries') || {}).textContent || '').trim(),
        lbl: ((document.getElementById('iv-lbl-enquiries') || {}).textContent || '').trim(),
        foldOpen: !((document.getElementById('iv-fold-enquiries') || { hidden: true }).hidden),
        listShown: !!(document.getElementById('inbox-list') || {}).getClientRects().length,
        rows: ((document.getElementById('inbox-list') || {}).textContent || ''),
    }));
    ok(/declined/i.test(dec.cap) && !/waiting/i.test(dec.cap), `the capsule counts declines (“${dec.cap}”)`);
    ok(/is-unk/.test(dec.tone) && !dec.warn, 'a decline is a DECISION — muted, no warning triangle');
    ok(/Jem Beighton/.test(dec.sub) && /declined/i.test(dec.sub), `the sub names a DECLINED enquirer (“${dec.sub}”)`);
    ok(dec.lbl === 'Declined enquiries', `the fold label names the list (“${dec.lbl}”)`);
    ok(dec.foldOpen && dec.listShown, 'the drawer opens on the tap that asked for it');
    ok(/Jem Beighton/.test(dec.rows), 'and the declined row is the one in it');
    // Back to Waiting: the verdict returns to the waiting queue's own numbers.
    await page.evaluate(async () => { await inboxTab('waiting'); });
    await page.waitForTimeout(700);
    const wait = await page.evaluate(() => ((document.getElementById('iv-sum-enquiries') || {}).textContent || '').trim());
    ok(/waiting/i.test(wait), `switching back restores the waiting verdict (“${wait}”)`);

    // ---------- §5. Send is in reach -----------------------------------
    console.log('§5. the composer opens with Send on screen');
    for (const w of [390, 1280]) {
        await page.setViewportSize({ width: w, height: w === 390 ? 844 : 800 });
        await page.waitForTimeout(400);
        await page.evaluate(async () => { await openInbox(); });
        await page.waitForTimeout(800);
        await page.evaluate(() => { window.openEnquiryEmail('e7'); });
        await page.waitForTimeout(700);
        const send = await page.evaluate(() => {
            const b = document.getElementById('enq-email-send');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            const box = document.querySelector('#enq-email-modal .reviews-modal-box');
            const br = box ? box.getBoundingClientRect() : null;
            const body = document.getElementById('enq-email-body');
            const yr = body ? body.getBoundingClientRect() : null;
            return {
                top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight,
                boxBottom: br ? Math.round(br.bottom) : null, h: Math.round(r.height),
                // How far INTO the card the Message box starts — the guest
                // context used to spend ~340px above it.
                msgFromTop: yr && br ? Math.round(yr.top - br.top) : null,
                ctxOpen: !!(document.getElementById('enq-email-ctxfold') || {}).open,
            };
        });
        ok(!!send && send.h > 0, `${w}: the Send button renders`);
        ok(!!send && send.bottom <= send.vh + 1 && send.top >= 0,
            `${w}: it is inside the viewport on open (${send && send.top}–${send && send.bottom} of ${send && send.vh})`);
        ok(!!send && send.bottom <= send.boxBottom + 1,
            `${w}: …and inside the card that holds it (${send && send.bottom} vs ${send && send.boxBottom})`);
        // THE CONTEXT FOLDS, so the work starts near the top of the card. The
        // sticky footer alone would satisfy the two checks above with the whole
        // 340px panel still open above the fields (break-tested — it did).
        ok(!!send && send.ctxOpen === false, `${w}: the guest context opens FOLDED`);
        // Measured at 390: 343px folded against 686px open — the threshold sits
        // between them rather than on either, so it reads as a state, not a
        // pixel count that rots the next time a label changes.
        ok(!!send && send.msgFromTop !== null && send.msgFromTop <= 400,
            `${w}: Message starts inside the first 400px of the card (${send && send.msgFromTop}px)`);
        await page.evaluate(() => { window.closeEnquiryEmailModal(); });
        await page.waitForTimeout(300);
    }

    // ---------- §6. the smaller declarations ---------------------------
    // Each of these is one measurable claim, and nothing else in the suite set
    // covers them.
    console.log('§6. the smaller declarations');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // (C) The one accent CTA on the owner's landing reads at BODY size — it
    // wore 13px in a 44px pill while the rows it acts on read 15.
    await page.evaluate(async () => { await openBookings(); });
    await page.waitForTimeout(900);
    const cta = await page.evaluate(() => {
        const add = document.querySelector('.cal-actions .cal-add-btn');
        const row = document.querySelector('.ny-label') || document.querySelector('.bk-row-name');
        const px = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0);
        return { add: px(add), row: px(row), body: parseFloat(getComputedStyle(document.body).getPropertyValue('--fs-body')) || 0 };
    });
    ok(cta.add > 0 && Math.abs(cta.add - cta.row) < 0.5,
        `“Add booking” reads at the size of the rows it acts on (${cta.add}px vs ${cta.row}px)`);

    // (B) The money unit carries its own separator, so a wrap can only break
    // BEFORE the "·" — never leave it stranded at the end of the line above.
    const dayLine = await page.evaluate(() => {
        const u = document.querySelector('#today-date .ops-unit');
        return {
            has: !!u,
            starts: u ? (u.textContent || '').trim().startsWith('·') : false,
            nowrap: u ? getComputedStyle(u).whiteSpace === 'nowrap' : false,
            btnInside: !!(u && u.querySelector('.ops-owed')),
            said: /to collect/.test((document.getElementById('today-date') || {}).textContent || ''),
        };
    });
    ok(dayLine.has && dayLine.starts && dayLine.btnInside,
        'the day line\'s money unit holds its own separator and its button');
    ok(dayLine.nowrap, '…as one unbreakable run');
    ok(dayLine.said, '…and the line still says "£… to collect" for the gates that read it');

    // (I) The cap names the ASK's stage. A finished stay with the deposit still
    // held read "Next · 4 of 6 · Arrival info" over a sentence about the
    // deposit — capLabel renames, only capKey moves the index.
    await page.evaluate(async () => { await openBookingHub('b2'); });
    await page.waitForTimeout(900);
    const past = await page.evaluate(() => ({
        cap: ((document.querySelector('#booking-hub-content .bhub-next-cap') || {}).textContent || '').trim(),
        txt: ((document.querySelector('#booking-hub-content .bhub-next-text') || {}).textContent || '').trim(),
    }));
    ok(/deposit/i.test(past.txt), `the finished stay asks about the deposit (“${past.txt.slice(0, 44)}…”)`);
    ok(/Deposit back/.test(past.cap), `…and the caption names that stage (“${past.cap}”)`);

    // (G) "Also stayed" speaks the house range form, and nothing in the row is
    // cut. (Booking 1's guest has a second stay under the same email.)
    await page.evaluate(async () => { await openBookingHub('b1'); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { if ((document.getElementById('bhub-fold-guest') || {}).hidden) window.bhubFoldToggle('guest'); });
    await page.waitForTimeout(500);
    const stay = await page.evaluate(() => {
        const row = document.querySelector('#booking-hub-content .bhub-stay-row');
        if (!row) return null;
        const when = row.querySelector('.bhub-stay-when');
        const link = row.querySelector('.bhub-mut');
        const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; };
        return {
            when: when ? (when.textContent || '').trim() : '',
            whenLines: when ? lines(when) : 0,
            linkLines: link ? lines(link) : 0,
            tagCut: (() => { const t = row.querySelector('.prop-tag'); return !!t && t.scrollWidth - t.clientWidth > 1; })(),
        };
    });
    ok(!!stay && stay.when !== '' && !/\d{2}\/\d{2}\/\d{4}\s*→/.test(stay.when),
        `the other stay speaks the house range form (“${stay && stay.when}”)`);
    ok(!!stay && stay.whenLines === 1 && stay.linkLines === 1 && !stay.tagCut,
        `…on one line each, with the cottage name whole (${stay && stay.whenLines}/${stay && stay.linkLines} lines)`);

    // (K) The intel row says it once: the ordinal + lifetime ride the SUB, and
    // the fold no longer restates them.
    const intel = await page.evaluate(() => {
        const card = document.getElementById('hub-intel-card');
        if (!card) return null;
        const sub = card.querySelector('.bhub-fold-sub');
        const first = card.querySelector('.bhub-intel-line');
        const lbl = card.querySelector('.bhub-fold-lbl');
        const r = document.createRange();
        let lines = 0;
        for (const n of (lbl ? lbl.childNodes : [])) {
            if (n.nodeType !== 3 || !String(n.nodeValue).trim()) continue;
            r.selectNodeContents(n);
            lines = Math.max(lines, r.getClientRects().length);
        }
        return { sub: sub ? (sub.textContent || '').trim() : '', first: first ? (first.textContent || '').trim() : '', lblLines: lines };
    });
    if (intel) {
        ok(/stay/.test(intel.sub) && /lifetime/.test(intel.sub), `the visit ordinal + lifetime ride the row's sub (“${intel.sub}”)`);
        ok(!/lifetime/.test(intel.first), `…and the fold's first line no longer repeats them (“${intel.first}”)`);
        ok(intel.lblLines === 1, `“Knows your guest” stops wrapping (${intel.lblLines} line)`);
    } else {
        ok(false, 'the intel card rendered (fixture)');
    }

    // (Q) The Needs-attention row's capsule is a STATE, not a pound figure
    // dressed as a warning.
    await page.evaluate(async () => { await openInbox(); });
    await page.waitForTimeout(1000);
    const attn = await page.evaluate(() => {
        const cap = document.querySelector('#iv-attn .bhub-fold-grp .st-cap');
        const sub = document.querySelector('#iv-attn .bhub-fold-sub');
        return { cap: cap ? (cap.textContent || '').trim() : '', sub: sub ? (sub.textContent || '').trim() : '' };
    });
    ok(attn.cap !== '' && !/£/.test(attn.cap), `the attention capsule states the state, not the money (“${attn.cap}”)`);
    ok(/£/.test(attn.sub), `…and the figure joins the facts in the sub (“${attn.sub.slice(0, 60)}”)`);

    // (E) The enquiry's quote uses the BOOKING HUB'S OWN breakdown shape. As
    // .bhub-kv rows it had a 96px LABEL COLUMN — right for "Email / Phone /
    // Address", wrong for a price list: "Refundable deposit (charged with the
    // first payment)" took five lines in 96px beside 170px of empty rail.
    await page.evaluate(async () => { await openEnquiryHub('e7'); });
    await page.waitForTimeout(1100);
    await page.evaluate(() => { if ((document.getElementById('bhub-fold-equote') || {}).hidden) window.bhubFoldToggle('equote'); });
    await page.waitForTimeout(500);
    const quote = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-grp="equote"] .price-row')];
        const kv = document.querySelectorAll('[data-grp="equote"] .bhub-kv').length;
        return {
            kv,
            rows: rows.map((r) => {
                const rc = r.getBoundingClientRect();
                const val = r.children[1];
                const lh = parseFloat(getComputedStyle(r).lineHeight) || 20;
                return {
                    lines: Math.round(rc.height / lh),
                    onRail: val ? Math.abs(val.getBoundingClientRect().right - rc.right) <= 2 : false,
                    t: (r.textContent || '').trim().slice(0, 34),
                };
            }),
        };
    });
    ok(quote.rows.length >= 3, `the quote breaks down into rows (${quote.rows.length}, vacuity guard ≥3)`);
    ok(quote.kv === 0, `…none of them a 96px label column (${quote.kv} .bhub-kv left)`);
    ok(quote.rows.every((r) => r.onRail), 'every figure sits on the row\'s right rail');
    const tall = quote.rows.filter((r) => r.lines > 2);
    ok(tall.length === 0, `and no label is squeezed into a column (${tall.length ? '“' + tall[0].t + '” ' + tall[0].lines + ' lines' : 'all ≤2 lines'})`);

    // (L + M) The conversation is a sheet, and its composer is ONE row.
    await page.evaluate(async () => { await openMessageThread(1); });
    await page.waitForTimeout(900);
    const chat = await page.evaluate(() => {
        const ov = document.getElementById('messages-modal');
        const box = ov ? ov.querySelector('.modal-box') : null;
        if (!ov || !box) return null;
        const r = box.getBoundingClientRect();
        const cs = getComputedStyle(box);
        const q = (s) => { const e = box.querySelector(s); return e ? e.getBoundingClientRect() : null; };
        const att = q('.chat-attach-btn'), ta = q('.chat-composer textarea'), snd = q('.chat-send');
        const quick = box.querySelector('.msg-quick');
        const title = box.querySelector('#messages-modal-title');
        // HIDDEN MEANS NOT PAINTED. `.btn-sm { display: inline-flex }` outranks
        // the UA's [hidden], so the ✨ Draft button — hidden by chbChatMacBtnSync
        // whenever the Mac is not listening, i.e. always in this harness — painted
        // in every reply window and took a slot on the one-row composer (the
        // #day-spine[hidden] trap; final review). The attribute is not the pixel.
        const draft = box.querySelector('#msg-mac-draft');
        const draftGone = draft ? (draft.hidden && draft.getClientRects().length === 0) : null;
        return {
            draftGone,
            sheet: ov.classList.contains('chb-sheet'),
            edge: Math.round(r.bottom) >= window.innerHeight - 1 && Math.round(r.left) <= 1 && Math.round(r.right) >= window.innerWidth - 1,
            topCorners: parseFloat(cs.borderBottomLeftRadius) === 0 && parseFloat(cs.borderTopLeftRadius) > 0,
            opaque: cs.backdropFilter === 'none' || cs.backdropFilter === '',
            // ONE ROW: the composer aligns its children to the FIELD's bottom
            // (align-items: flex-end), so the shared edge is the bottom, and a
            // row that had wrapped would be taller than its tallest child.
            oneRow: !!(att && ta && snd)
                && Math.abs(att.bottom - snd.bottom) <= 2 && Math.abs(ta.bottom - snd.bottom) <= 2
                && Math.abs(box.querySelector('.chat-composer').getBoundingClientRect().height - ta.height) <= 2,
            floors: !!(att && ta && snd) && Math.min(att.height, ta.height, snd.height) >= 43.5,
            // The chrome ABOVE the field: the quick row only.
            chrome: quick ? Math.round(quick.getBoundingClientRect().height) : -1,
            sendRound: snd ? Math.round(snd.width) === Math.round(snd.height) : false,
            // A <select> clips with no ellipsis, so its own label has to fit.
            cannedWhole: (() => {
                const sel = box.querySelector('#msg-canned');
                if (!sel) return false;
                const cs = getComputedStyle(sel);
                const probe = document.createElement('span');
                probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
                probe.style.font = cs.font; probe.textContent = sel.options[0].text;
                document.body.appendChild(probe);
                const need = probe.getBoundingClientRect().width; probe.remove();
                return sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) >= need;
            })(),
            titleOwnRow: !!(title && att) && (() => {
                const acts = box.querySelector('.msg-head-acts');
                const tr = title.getBoundingClientRect(), ar = acts.getBoundingClientRect();
                return ar.top >= tr.bottom - 1; // the actions sit UNDER the name
            })(),
        };
    });
    ok(!!chat && chat.sheet && chat.edge, 'the conversation is a bottom sheet — edge-attached');
    ok(!!chat && chat.topCorners && chat.opaque, '…with top corners only, and opaque (no blur over the scrim)');
    ok(!!chat && chat.titleOwnRow, 'the guest\'s name has its own row, not a 72px column beside three pills');
    ok(!!chat && chat.oneRow && chat.sendRound, 'attach · field · send are ONE row, send a circle');
    ok(!!chat && chat.draftGone === true, `a hidden "Draft on your Mac" button paints NOTHING (${chat && chat.draftGone === null ? 'button absent' : String(chat && chat.draftGone)})`);
    ok(!!chat && chat.floors, 'and all three meet the 44px floor');
    ok(!!chat && chat.chrome > 0 && chat.chrome <= 60, `the chrome above the field is one line (${chat && chat.chrome}px, was 175)`);
    ok(!!chat && chat.cannedWhole, 'the quick-replies control shows its own label whole (a select cannot ellipsise)');
    await page.evaluate(() => { window.closeMessagesModal(); });
    await page.waitForTimeout(300);

    // ---- desktop: the filled primary action + the un-repeated heading ----
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);

    // (J) A feed sorted by time prints the time on EVERY row, the money one too.
    await page.evaluate(async () => { await openBookingHub('b1'); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { if ((document.getElementById('bhub-fold-activity') || {}).hidden) window.bhubFoldToggle('activity'); });
    await page.waitForTimeout(400);
    const feed = await page.evaluate(() => {
        // A ledger row is INJECTED: the fixture's hub_bundle is empty, and a
        // feed with no money row would pass this vacuously.
        const host = document.getElementById('hub-history');
        if (!host) return null;
        host.innerHTML = hubActivityHtml({ payments: [{ kind: 'deposit', amount: '175.00', status: 'COMPLETED', square_payment_id: 'sq1', created_at: '2026-08-16 12:31:00', deposit_carried: 0, note: '' }], events: [] }, 'b1');
        const row = host.querySelector('.bhub-ledger-row');
        const cell = row ? row.closest('.bhub-hist-row') : null;
        const when = cell ? cell.querySelector('.bhub-hist-when') : null;
        return { row: !!row, when: when ? (when.textContent || '').trim() : '' };
    });
    ok(!!feed && feed.row, 'the money row renders in the story');
    ok(!!feed && /\d{1,2} \w{3} \d{4} · \d{2}:\d{2}/.test(feed.when),
        `…carrying the time it is sorted on (“${feed && feed.when}”)`);

    // (H) The page's primary action is FILLED above 900 too — it was the
    // quietest control on the pane while the phone's sticky wore the accent.
    const fill = await page.evaluate(() => {
        const b = document.querySelector('#booking-hub-content .bhub-next .bhub-next-btn');
        if (!b) return null;
        const cs = getComputedStyle(b);
        const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim();
        const probe = document.createElement('span');
        probe.style.color = acc; document.body.appendChild(probe);
        const accRgb = getComputedStyle(probe).color; probe.remove();
        return { bg: cs.backgroundColor, accRgb, ink: cs.color };
    });
    ok(!!fill && fill.bg === fill.accRgb, `the hub's next action is filled accent on desktop (${fill && fill.bg})`);

    // …and APPROVE keeps its own colour in BOTH states — a (0,2,0) accent fill
    // would have left .btn-approve's --booked-border dead and its :hover green.
    await page.evaluate(async () => { await openEnquiryHub('e7'); });
    await page.waitForTimeout(1000);
    const appr = await page.evaluate(async () => {
        const b = document.querySelector('#enquiry-hub-content .bhub-next .btn-approve');
        if (!b) return null;
        const okv = getComputedStyle(document.body).getPropertyValue('--ok').trim();
        const probe = document.createElement('span');
        probe.style.color = okv; document.body.appendChild(probe);
        const okRgb = getComputedStyle(probe).color; probe.remove();
        const rest = getComputedStyle(b).backgroundColor;
        return { rest, okRgb };
    });
    ok(!!appr && appr.rest === appr.okRgb, `Approve is filled with its OWN colour, not the accent (${appr && appr.rest})`);
    const apprHover = await page.evaluate(async () => {
        const b = document.querySelector('#enquiry-hub-content .bhub-next .btn-approve');
        if (!b) return null;
        const before = getComputedStyle(b).backgroundColor;
        b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        return { before, after: getComputedStyle(b).backgroundColor };
    });
    ok(!!apprHover && apprHover.before === apprHover.after, 'and it does not change colour under the pointer');

    // (R) The middle column stops repeating the rail's own label 20px away —
    // clipped, NOT removed: the heading's text is still readable.
    await page.evaluate(async () => { await openInbox(); });
    await page.waitForTimeout(1000);
    const head = await page.evaluate(() => {
        const h = document.querySelector('#inbox-folder-enquiries .bo-sec-title');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return { txt: (h.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), inDom: true };
    });
    ok(!!head && head.inDom && /Enquiries/.test(head.txt), `the heading is still in the DOM and readable (“${head && head.txt}”)`);
    ok(!!head && head.w <= 2 && head.h <= 2, `…and painted nowhere at 1280 (${head && head.w}×${head && head.h})`);
    // SCOPED TO THE RAIL WIDTHS, by declaration. Below 1200 the folder divs
    // are re-parented INTO the landing's folds, where an older rule already
    // hides these h2s (the fold LABEL is the visible heading there) — so a
    // painted/not-painted check below 1200 would pass whatever this rule says.
    // The CSSOM is the honest reading: the clip lives inside min-width 1200.
    const scoped = await page.evaluate(async () => {
        // admin.css: the markup is owner-only, and app.css is the sheet every
        // anonymous visitor pays for (the PR2 rule, applied).
        const css = await (await fetch('admin.css')).text();
        const i = css.indexOf('#inbox-main .bo-sec-title');
        if (i < 0) return { found: false };
        // Walk back to the nearest @media opener that is still open at `i`.
        let depth = 0, at = '';
        for (let p = i; p >= 0; p--) {
            const c = css[p];
            if (c === '}') depth++;
            else if (c === '{') {
                if (depth === 0) {
                    const head = css.slice(Math.max(0, p - 160), p);
                    const m = head.match(/@media([^{]*)$/);
                    if (m) { at = m[1].trim(); break; }
                } else depth--;
            }
        }
        return { found: true, at };
    });
    ok(scoped.found && /min-width:\s*1200px/.test(scoped.at),
        `the hide is scoped to the rail widths by declaration (@media ${scoped.at || 'none'})`);

    console.log(fails ? `\n${fails} check(s) failed ❌` : '\nAll ownerday checks passed ✅');
    await done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
