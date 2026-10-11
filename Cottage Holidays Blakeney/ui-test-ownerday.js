// ============================================================
//  ui-test-ownerday.js — Today, the two hubs and the Inbox: the owner's
//  daily work, measured (dev/CI only, never deployed).
//
//  §1  ONE COUNT FOR ONE FACT. The Today dock pip, the Needs-you badge and
//      the rail's Today row are the SAME number — and it is the DUTY count,
//      not the Inbox's count they used to disagree over. The Inbox pip is the
//      one list's own number (people WAITING on you) and says so in words.
//  §2  NOTHING LOSES WORDS. Every .bk-row-name / .bk-row-dates /
//      .bhub-sticky-verb / .bhub-kv-label and every Inbox row's name and
//      context line at 360 AND 390, swept for text lost sideways or past its
//      clamp — with a 60-character verb and a 34-character guest name
//      INJECTED, because the real strings fit and the sweep would otherwise
//      be vacuous.
//  §3  ONE ROW SHAPE. An Inbox row's IDENTITY LINE (name + time) is one line
//      whatever the data (the invariant), and on a fixture where the two
//      enquiries differ only in how long they have waited they are the same
//      height (the defect: a pixel comparison of the status text against the
//      row's width — the cottage-cards lesson, here driven by the AGE).
//  §4  A DECLINE TELLS THE TRUTH. In the one list a declined enquirer is a row
//      wearing a muted "Declined" capsule — a decision, not a fault — that
//      never asks you to decide again, and the conversation records it.
//  §5  SEND IS IN REACH. The email composer's Send button is inside the
//      viewport the moment it opens, at 390 and at 1280.
//
//  §6  THE SMALLER DECLARATIONS, one measurable claim each: the accent CTA's
//      size, the day line's unbreakable money unit, the past stay's caption,
//      the "Also stayed" row, the intel sub, the decision card's capsule, the
//      enquiry quote's shape, the conversation + its composer, the ledger
//      row's time, the filled desktop CTA and the list's unpainted heading.
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
const d = require('./ui-test-lib').d; // the harness's day (keeps the page's clock near midnight)
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
                thread: { thread_id: 1, name: 'Ali Khan', email: 'ali@example.com', archived: 0, is_guest: 1 },
                messages: [
                    // The guest spoke LAST, as the thread list says (last_role guest).
                    { id: 1, role: 'admin', body: 'Hello — just ask if anything comes up.', at: hrsAgo(4), created_at: hrsAgo(4) },
                    { id: 2, role: 'guest', body: 'Is there parking at the cottage?', at: hrsAgo(3), created_at: hrsAgo(3) },
                ],
                bookings: [] });
            // A real thread shape (email + last_at): without them the one list has
            // nothing to file the chat under and the person never appears.
            return json({ ok: true, threads: [
                { thread_id: 1, name: 'Ali Khan', email: 'ali@example.com', unread: 1, last_role: 'guest', archived: 0, last_at: hrsAgo(3), last_body: 'Is there parking at the cottage?' },
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
    const counts = await page.evaluate(async () => {
        // The chat store is filled by its own loader (it runs when the Inbox opens and
        // on the message poll); load it here so the Inbox's number has every person
        // it counts, then let the one list rebuild from it (ibSoon's frame).
        await loadAdminMessages();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        renderNeedsYou();
        refreshInboxBadge();
        const txt = (id) => ((document.getElementById(id) || {}).textContent || '').trim();
        return {
            dock: txt('dock-badge-enquiries'),
            strip: txt('needs-you-count'),
            rail: txt('rail-cnt-today'),
            duties: String((window.chbDuties() || []).length),
            unseen: String(window.unseenEnquiries()),
            waiting: String(window.ibWaitingCount()),
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
    // The Inbox pip is a DIFFERENT question: since the one-list Inbox it is the
    // list's own number — people WAITING on you (an enquiry to decide, a chat they
    // spoke last in) — no longer unseen enquiries. The fixture's chat is what keeps
    // the two apart: it waits, and it is not an enquiry, so a pip still counting
    // unseen enquiries would read one short.
    ok(counts.waiting !== counts.unseen, `the fixture separates waiting from unseen (${counts.waiting} waiting vs ${counts.unseen} unseen)`);
    ok(counts.inboxPip === counts.waiting, `the Inbox pip counts the people WAITING (${counts.inboxPip} vs ${counts.waiting})`);
    // …and is DISTINGUISHED IN WORDS rather than being folded into one number.
    ok(/^Inbox, \d+ waiting$/.test(counts.inboxLbl) && /^\d+ waiting$/.test(counts.pipTitle),
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
        // The Inbox list — ONE list of people now; each row's name and its context
        // line (the sub beside the row's capsule) are the leaves that must keep their
        // words. Waited on by state: the list fills as its stores land.
        await page.evaluate(async () => { await openInbox(); });
        await page.waitForFunction(() => [...document.querySelectorAll('#ib-rows .ib-rctx')].filter((e) => e.getClientRects().length).length >= 2, null, { timeout: 8000 }).catch(() => {});
        seen.push(...await lost(page));
        return seen;
    };

    // A leaf "loses words" when its own content overflows its client box —
    // sideways (an ellipsis) or downwards (past a -webkit-box clamp). The ink
    // is measured too, but only as the vacuity gate: a leaf that paints no
    // text at all must be skipped, never counted as clean.
    const lost = (p) => p.evaluate(() => {
        const SEL = '.bk-row-name, .bk-row-dates, .bhub-sticky-verb, .bhub-kv-label, #ib-rows .ib-name, #ib-rows .ib-rctx';
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
    // VACUITY GUARD: a sweep that found nothing to measure proves nothing. Counted
    // as PAINTED leaves on the last screen (the Inbox) — the old count also counted
    // the hidden legacy lists, so it could pass with nothing on screen at all.
    const swept = await page.evaluate(() => [...document.querySelectorAll('#ib-rows .ib-name, #ib-rows .ib-rctx')].filter((e) => e.getClientRects().length).length);
    ok(swept >= 4, `the sweep had something to measure (${swept} painted Inbox leaves on the last screen)`);
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
    // wrap one row's status under the cottage pill and make it 145px beside a
    // neighbour at 109. The Inbox is ONE list of people now; each enquirer is a
    // row there (name + time, context + capsule, preview), so that is the row.
    console.log('§3. every enquiry row is the same height');
    await page.evaluate(async () => { await openInbox(); });
    const ENQ_KEYS = ['e:e7@x.com', 'e:e8@x.com']; // Jane (5 days) · Ravi (fresh)
    await page.waitForFunction((ks) => ks.every((k) => { const r = document.querySelector(`#ib-rows .ib-rowwrap[data-key="${k}"] .ib-row`); return r && r.getClientRects().length; }), ENQ_KEYS, { timeout: 8000 }).catch(() => {});
    const erows = await page.evaluate((ks) => ks.map((k) => {
        const row = document.querySelector(`#ib-rows .ib-rowwrap[data-key="${k}"] .ib-row`);
        if (!row || !row.getClientRects().length) return null;
        const name = row.querySelector('.ib-name'), time = row.querySelector('.ib-time');
        const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
        return {
            h: Math.round(row.getBoundingClientRect().height),
            // The IDENTITY LINE is the name and its time, side by side on one line.
            oneLine: !!(name && time) && Math.abs(mid(name) - mid(time)) <= 3 && time.getBoundingClientRect().left >= name.getBoundingClientRect().right - 1,
            time: time ? time.textContent.trim() : '',
            aged: !!time && time.classList.contains('is-age'),
            label: row.getAttribute('aria-label') || '',
            caps: [...row.querySelectorAll('.ib-cap')].map((c) => c.textContent.trim()),
        };
    }), ENQ_KEYS);
    const heights = erows.filter(Boolean).map((r) => r.h);
    ok(heights.length >= 2, `two enquiry rows render (${heights.length})`);
    // The fixture's two enquiries differ ONLY in how long they have waited —
    // same cottage-name length, same dates, same party — so any difference in
    // height can only have come from the status text.
    ok(heights.length >= 2 && Math.max(...heights) - Math.min(...heights) <= 1,
        `their heights match — the status text does not decide the anatomy (${heights.join(' / ')})`);
    // …AND THE INVARIANT THAT HOLDS WITH ANY DATA: the row's identity line is ONE
    // line, the name with its time beside it.
    ok(erows.filter(Boolean).length >= 2 && erows.every((r) => r && r.oneLine),
        `every row's identity line stays ONE line (${erows.map((r) => (r ? r.oneLine : 'none')).join(' · ')})`);
    // …and the wait is still SAID, on the row itself: the stale one's time becomes
    // its age, in the warning ink, and a screen reader is told it is waiting.
    const [jane, ravi] = erows;
    ok(!!jane && /^5 days$/.test(jane.time) && jane.aged && /waiting 5 days/.test(jane.label),
        `the stale enquiry says how long it has waited (“${jane && jane.time}”, “${jane && jane.label}”)`);
    ok(!!ravi && !ravi.aged, `…and the fresh one does not (“${ravi && ravi.time}”)`);
    ok(erows.every((r) => r && r.caps.length === 1 && r.caps[0] === 'Decide'),
        `…and the capsule carries only the decision (${erows.map((r) => (r ? r.caps.join('+') : 'none')).join(' / ')})`);

    // ---------- §4. a decline tells the truth ---------------------------
    // The declined DRAWER is gone with the folders: a declined enquirer is a row of
    // the one list, and what used to be the drawer's verdict is that row's capsule.
    console.log('§4. a declined enquiry is said as a decline');
    declined = [{ ...mkE(9, 'pimpernel', 'Jem Beighton', 30, 34, 60, null), declined_at: hrsAgo(72) }];
    await page.evaluate(async () => { await ibLoadAll(true); });
    await page.waitForFunction(() => { const r = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:e9@x.com"] .ib-row'); return r && r.getClientRects().length; }, null, { timeout: 8000 }).catch(() => {});
    const dec = await page.evaluate(() => {
        const w = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:e9@x.com"]');
        const row = w && w.querySelector('.ib-row');
        const cap = w && w.querySelector('.ib-cap');
        return {
            painted: !!(row && row.getClientRects().length),
            cap: cap ? cap.textContent.trim() : '',
            capCls: cap ? cap.className : '',
            ctx: w ? ((w.querySelector('.ib-rctx') || {}).textContent || '').trim() : '',
            label: row ? row.getAttribute('aria-label') || '' : '',
        };
    });
    ok(dec.painted, 'the declined enquirer is a row of the one list');
    ok(dec.cap === 'Declined', `its capsule says Declined (“${dec.cap}”)`);
    ok(/\bunk\b/.test(dec.capCls) && !/\b(warn|bad)\b/.test(dec.capCls), `a decline is a DECISION — the muted capsule, no warning tone (${dec.capCls})`);
    ok(!/Decide/.test(dec.label + dec.cap), 'and it never asks for the decision again');
    ok(/Pimpernel/.test(dec.ctx), `its context names the stay that was declined (“${dec.ctx}”)`);
    // …and the conversation keeps the record: their own words, then the decline.
    await page.click('#ib-rows .ib-rowwrap[data-key="e:e9@x.com"] .ib-row');
    await page.waitForFunction(() => /Jem Beighton/.test((document.querySelector('#ib-conv .ib-hname') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const decConv = await page.evaluate(() => ({
        words: [...document.querySelectorAll('#ib-thread .ib-msg.is-them .ib-text')].some((t) => /parking/.test(t.textContent)),
        event: [...document.querySelectorAll('#ib-thread .ib-event')].some((e) => /Enquiry declined/.test(e.textContent)),
        decide: !!document.querySelector('#ib-conv [data-ib="approve"]'),
    }));
    ok(decConv.words && decConv.event, 'the conversation shows what they asked and that it was declined');
    ok(!decConv.decide, '…with no Approve on a declined enquiry');
    await page.evaluate(() => { const b = document.querySelector('#ib-conv .ib-back'); if (b && b.getClientRects().length) b.click(); });
    await page.waitForTimeout(500);

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
            const box = document.querySelector('#enq-email-modal .cmp-sheet');
            const br = box ? box.getBoundingClientRect() : null;
            const body = document.getElementById('enq-email-body');
            const yr = body ? body.getBoundingClientRect() : null;
            return {
                top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight,
                boxBottom: br ? Math.round(br.bottom) : null, h: Math.round(r.height),
                // How far INTO the card the Message box starts — the guest
                // context used to spend ~340px above it.
                msgFromTop: yr && br ? Math.round(yr.top - br.top) : null,
                ctxOpen: !!(document.getElementById('cmp-ctx') || { classList: { contains: () => false } }).classList.contains('on'),
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

    // (C) The one accent control on the owner's landing is the + in the month row: a 44px
    // target, a real name for a screen reader, and the accent as its fill (it carries a glyph,
    // not words, so the house ink-on-accent pair is what it must read in).
    await page.evaluate(async () => { await openBookings(); });
    await page.waitForTimeout(900);
    const cta = await page.evaluate(() => {
        const add = document.querySelector('.cal-actions .cal-add-btn');
        const r = add ? add.getBoundingClientRect() : { width: 0, height: 0 };
        return { w: Math.round(r.width), h: Math.round(r.height), name: add ? add.getAttribute('aria-label') || '' : '' };
    });
    ok(cta.w >= 44 && cta.h >= 44, `the + is a 44px target (${cta.w}x${cta.h})`);
    ok(/Add/.test(cta.name), `…and is named for a screen reader ("${cta.name}")`);

    // (B) Who owes is said ONCE, in Today's status pill beside the title — a real button that
    // says the figure and opens the list. (It used to ride the day line as an unbreakable run.)
    const dayLine = await page.evaluate(() => {
        const b = document.querySelector('#bookings-owed .head-pill');
        return {
            has: !!b,
            isBtn: !!b && b.tagName === 'BUTTON' && b.getAttribute('data-act') === 'openBookingsNeedsPay',
            said: /^£[\d,]+ to collect$/.test(((b && b.textContent) || '').trim()) && /from \d+ guests?/.test((b && b.getAttribute('aria-label')) || ''),
            onDayLine: /to collect/.test((document.getElementById('today-date') || {}).textContent || ''),
        };
    });
    ok(dayLine.has && dayLine.isBtn, 'who owes is one button: the pill beside the Today title');
    ok(dayLine.said, '…saying the figure, and to a screen reader the number of guests');
    ok(!dayLine.onDayLine, '…and the day sentence no longer repeats it');

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
        const chev = row.querySelector('.bhub-chev');
        const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; };
        return {
            when: when ? (when.textContent || '').trim() : '',
            whenLines: when ? lines(when) : 0,
            chev: !!chev,
            tagCut: (() => { const t = row.querySelector('.prop-tag'); return !!t && t.scrollWidth - t.clientWidth > 1; })(),
        };
    });
    ok(!!stay && stay.when !== '' && !/\d{2}\/\d{2}\/\d{4}\s*→/.test(stay.when),
        `the other stay speaks the house range form (“${stay && stay.when}”)`);
    ok(!!stay && stay.whenLines === 1 && stay.chev && !stay.tagCut,
        `…on one line, with the cottage name whole and the one chevron where "open →" was (${stay && stay.whenLines} line)`);

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

    // (Q) A capsule is a STATE, never a pound figure dressed as one. The Inbox's
    // Needs-attention rows went with its landing; the capsule that sits over an
    // enquiry now is the decision card's, in the conversation — the state in the
    // capsule, the money in the figure beside it.
    await page.evaluate(async () => { await openInbox(); });
    await page.waitForFunction(() => !!document.querySelector('#ib-rows .ib-rowwrap[data-key="e:e7@x.com"] .ib-row'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => { const r = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:e7@x.com"] .ib-row'); if (r) r.click(); });
    await page.waitForFunction(() => !!document.querySelector('#ib-conv .ib-decide .ib-decide-cap'), null, { timeout: 8000 }).catch(() => {});
    const attn = await page.evaluate(() => ({
        cap: ((document.querySelector('#ib-conv .ib-decide .ib-decide-cap') || {}).textContent || '').trim(),
        fig: ((document.querySelector('#ib-conv .ib-decide .ib-decide-fig') || {}).textContent || '').trim(),
    }));
    ok(attn.cap !== '' && !/£/.test(attn.cap), `the decision's capsule states the state, not the money (“${attn.cap}”)`);
    ok(/£/.test(attn.fig), `…and the figure stands beside it (“${attn.fig}”)`);
    await page.evaluate(() => { const b = document.querySelector('#ib-conv .ib-back'); if (b && b.getClientRects().length) b.click(); });
    await page.waitForTimeout(400);

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

    // (L + M) The conversation takes the whole phone, and its composer meets the
    // thumb. The chat SHEET this measured (#messages-modal, openMessageThread) is no
    // longer reachable — its only opener was the old Messages folder list — and a
    // guest's chat now opens in the one list's conversation, so that is the subject.
    // (Its quick-replies select went with the sheet.)
    await page.evaluate(async () => { await openInbox(); });
    await page.waitForFunction(() => !!document.querySelector('#ib-rows .ib-rowwrap[data-key="e:ali@example.com"] .ib-row'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => { const r = document.querySelector('#ib-rows .ib-rowwrap[data-key="e:ali@example.com"] .ib-row'); if (r) r.click(); });
    await page.waitForFunction(() => /Ali Khan/.test((document.querySelector('#ib-conv .ib-hname') || {}).textContent || '') && !!document.getElementById('ib-reply')
        && [...document.querySelectorAll('#ib-thread .ib-msg')].length >= 2, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(450); // the pane slides in on a phone; measure where it lands
    // Words in the box, so Send is in its live state (an empty box disables it and
    // shrinks it to 0.9) — the floor is about the control the owner actually taps.
    await page.fill('#ib-reply', 'Yes, right outside.');
    await page.waitForTimeout(250);
    const chat = await page.evaluate(() => {
        const conv = document.getElementById('ib-conv');
        if (!conv || !conv.getClientRects().length) return null;
        const r = conv.getBoundingClientRect();
        const q = (s) => { const e = conv.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
        // A control's EFFECTIVE hit region: its own box grown by any absolutely
        // positioned ::before/::after region (the round-seven mechanism — the
        // Chat / Email buttons carry one), as ui-test-reach measures it.
        const reach = (el) => {
            const b = el.getBoundingClientRect();
            const box = { t: b.top, b: b.bottom, l: b.left, r: b.right };
            for (const ps of ['::before', '::after']) {
                const cs = getComputedStyle(el, ps);
                if (cs.content === 'none' || cs.position !== 'absolute' || !/px/.test(cs.top) || !/px/.test(cs.left)) continue;
                const p = (v) => parseFloat(v) || 0;
                box.t = Math.min(box.t, b.top + p(cs.top)); box.l = Math.min(box.l, b.left + p(cs.left));
                box.r = Math.max(box.r, b.right - p(cs.right)); box.b = Math.max(box.b, b.bottom - p(cs.bottom));
            }
            return { width: box.r - box.l, height: box.b - box.t };
        };
        const name = q('.ib-hname'), acts = q('.ib-acts');
        const replyEl = conv.querySelector('#ib-reply'), sendEl = conv.querySelector('#ib-send');
        const reply = replyEl && replyEl.getClientRects().length ? reach(replyEl) : null;
        const send = sendEl && sendEl.getClientRects().length ? reach(sendEl) : null;
        const chans = [...conv.querySelectorAll('.ib-chan button')].filter((b) => b.getClientRects().length).map(reach);
        const sugg = q('.ib-sugg');
        return {
            edge: Math.round(r.left) <= 1 && Math.round(r.right) >= window.innerWidth - 1 && Math.round(r.bottom) >= window.innerHeight - 1,
            // The name has its OWN row: under the actions, and the width of the pane.
            nameOwnRow: !!(name && acts) && name.top >= acts.bottom - 1 && name.width >= r.width * 0.8,
            sendRound: !!send && Math.round(send.width) === Math.round(send.height),
            floors: { reply: reply ? Math.round(reply.height) : 0, send: send ? Math.round(Math.min(send.width, send.height)) : 0, chan: chans.length ? Math.round(Math.min(...chans.map((c) => c.height))) : 0, n: chans.length },
            chrome: sugg ? Math.round(sugg.height) : 0,
        };
    });
    ok(!!chat && chat.edge, 'the conversation takes the phone edge to edge, down to the bottom');
    ok(!!chat && chat.nameOwnRow, 'the guest\'s name has its own row, not a column beside the buttons');
    ok(!!chat && chat.sendRound, 'Send is a circle');
    ok(!!chat && chat.floors.n === 2 && Math.min(chat.floors.reply, chat.floors.send, chat.floors.chan) >= 43.5,
        `the reply box, Chat / Email and Send all reach the 44px floor (effective regions: box ${chat && chat.floors.reply}, Chat/Email ${chat && chat.floors.chan}, Send ${chat && chat.floors.send})`);
    ok(!!chat && chat.chrome <= 60, `the chrome above the reply box is one line at most (${chat && chat.chrome}px)`);
    await page.fill('#ib-reply', ''); // and the draft it would have kept goes with it
    await page.evaluate(() => { const b = document.querySelector('#ib-conv .ib-back'); if (b && b.getClientRects().length) b.click(); });
    await page.waitForTimeout(400);

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

    // (R) The list stops repeating the page's own title. The old middle column
    // carried an "Enquiries" h2 20px from the rail's label; the one list's column
    // is NAMED for a screen reader (its aria-label says which folder) and paints no
    // heading of its own, so the page's title says Inbox once. (The CSSOM check that
    // the old h2's clip was scoped to the rail widths went with that h2.)
    await page.evaluate(async () => { await openInbox(); });
    await page.waitForFunction(() => !!document.querySelector('#ib-rows .ib-row'), null, { timeout: 8000 }).catch(() => {});
    const head = await page.evaluate(() => {
        const list = document.getElementById('ib-list');
        const painted = (e) => e.getClientRects().length && e.getBoundingClientRect().width > 2 && e.getBoundingClientRect().height > 2;
        return {
            name: list ? list.getAttribute('aria-label') : '',
            listHeads: list ? [...list.querySelectorAll('h1, h2, h3, h4')].filter(painted).map((h) => h.textContent.trim()) : ['(no list)'],
            titles: [...document.querySelectorAll('#view-inbox h1')].filter(painted).map((h) => h.textContent.trim()),
        };
    });
    ok(head.name === 'Inbox', `the list is named for a screen reader (“${head.name}”)`);
    ok(head.listHeads.length === 0 && head.titles.length === 1 && head.titles[0] === 'Inbox',
        `…and paints no heading of its own: the title says Inbox once (${head.titles.join(', ')}${head.listHeads.length ? '; list: ' + head.listHeads.join(', ') : ''})`);

    console.log(fails ? `\n${fails} check(s) failed ❌` : '\nAll ownerday checks passed ✅');
    await done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
