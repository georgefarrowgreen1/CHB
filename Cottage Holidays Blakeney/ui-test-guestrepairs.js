// ============================================================
//  ui-test-guestrepairs.js — three guest-side repairs found by looking.
//
//    §1 the chat's empty thread LEADS with its welcome instead of pinning it to
//       the floor of a 360px pane, and the welcome earns that space by naming
//       who answers and when;
//    §2 a message ARRIVES — the thread makes room while the bubble grows from
//       the corner it hangs off — and the scroll FOLLOWS it rather than
//       teleporting, with the 60px policy untouched and a pill for the one case
//       where a reply lands off-screen;
//    §3 the site's first line no longer orphans a word;
//    §4 the two declarations clear the house's own 44px floor, with a drawn tick;
//    §5 a stay you are IN is not filed under "Upcoming" — `upcoming` meant only
//       "has not ended", so a guest in the cottage saw their booking under
//       Upcoming stays with a green Upcoming badge and dates that had started;
//    §6 the cottage page's amenities FLOW rather than taking a row each.
//
//  Two disciplines this file is built on, both learned the hard way:
//    · SEEK, never race. Two evaluate() round trips overshoot a 500ms spring, so
//      a working animation samples as a teleport. Pause it and set currentTime —
//      and do that LAST, because a paused CSS animation does not resume into a
//      clean flight.
//    · Drive the ROUTE, not a fixture. Every assertion here goes through the
//      real chatBubbles / chatHelloHtml / .terms-accept markup; asserting on
//      markup the gate composed itself proves the stylesheet and nothing else.
// ============================================================
const { boot } = require('./ui-test-lib');

(async () => {
    let fails = 0;
    const check = (c, m, extra) => {
        console.log(`  ${c ? '✓' : '✗'} ${m}${c || extra === undefined ? '' : '  → ' + extra}`);
        if (!c) fails++;
    };

    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => {
        console.log('  PAGEERR:', e.message);
        fails++;
    });
    await page.goto(t.base + '/index.html');
    await page.waitForTimeout(1300);

    // ============================================================
    //  §1 — the empty thread leads with its welcome
    // ============================================================
    console.log('\n  §1 the chat opens on its welcome, not on a void');
    await page.evaluate(() => window.toggleChat());
    await page.waitForTimeout(700);

    const empty = await page.evaluate(() => {
        const th = document.getElementById('chat-thread');
        const h = th.querySelector('.chat-hello');
        if (!h) return { none: true };
        const tb = th.getBoundingClientRect();
        const hb = h.getBoundingClientRect();
        return {
            above: Math.round(hb.top - tb.top),
            below: Math.round(tb.bottom - hb.bottom),
            pane: Math.round(tb.height),
            justify: getComputedStyle(th).justifyContent,
            who: (th.querySelector('.chat-hello-who') || {}).textContent || '',
            role: !!th.querySelector('.chat-hello-role'),
            when: (th.querySelector('.chat-hello-when') || {}).textContent || '',
        };
    });
    check(!empty.none, 'the welcome renders');
    // The defect was 267px above and 0 below. Centred, the two are within a few px.
    check(
        Math.abs(empty.above - empty.below) < 24,
        'it is CENTRED, not pinned to the floor',
        `${empty.above}px above / ${empty.below}px below a ${empty.pane}px pane`,
    );
    check(empty.justify === 'center', 'via justify-content on the empty thread only', empty.justify);
    check(!!empty.who && empty.role, 'and it names who answers', empty.who);
    check(/hour|minute|day/i.test(empty.when), 'and says when', empty.when);

    // …and the moment a real bubble exists, messages bottom-anchor as before.
    const withMsgs = await page.evaluate(() => {
        const th = document.getElementById('chat-thread');
        th.innerHTML = window.chatBubbles(
            [{ role: 'guest', body: 'Hello', at: '2026-09-01 10:00:00' }],
            'guest',
            false,
        );
        const tb = th.getBoundingClientRect();
        const first = th.querySelector('.chat-row').getBoundingClientRect();
        return {
            justify: getComputedStyle(th).justifyContent,
            above: Math.round(first.top - tb.top),
            below: Math.round(tb.bottom - first.bottom),
        };
    });
    check(
        withMsgs.justify !== 'center' && withMsgs.above > withMsgs.below,
        'a thread with a message bottom-anchors exactly as it always did',
        JSON.stringify(withMsgs),
    );

    // ============================================================
    //  §2 — the arrival, and the scroll that follows it
    // ============================================================
    console.log('\n  §2 a message arrives, and the thread follows it');

    // ONLY the newest row is marked — every caller rebuilds the whole thread, so
    // an entrance keyed on anything else replays the conversation on each poll.
    const marks = await page.evaluate(() => {
        const th = document.getElementById('chat-thread');
        const msgs = [];
        for (let i = 0; i < 4; i++)
            msgs.push({ role: i % 2 ? 'admin' : 'guest', body: 'm' + i, at: '2026-09-01 10:0' + i + ':00' });
        th.innerHTML = window.chatBubbles(msgs, 'guest', true);
        const rows = th.querySelectorAll('.chat-row');
        const lastIsNew = rows[rows.length - 1].classList.contains('is-new');
        return { rows: rows.length, marked: th.querySelectorAll('.chat-row.is-new').length, lastIsNew };
    });
    check(marks.rows === 4 && marks.marked === 1 && marks.lastIsNew, 'only the newest row enters', JSON.stringify(marks));

    const noEnter = await page.evaluate(() => {
        const th = document.getElementById('chat-thread');
        th.innerHTML = window.chatBubbles([{ role: 'guest', body: 'x', at: '2026-09-01 10:00:00' }], 'guest', false);
        return th.querySelectorAll('.chat-row.is-new').length;
    });
    check(noEnter === 0, 'opening a conversation is not a message arriving — no entrance', String(noEnter));

    // THE SCROLL FOLLOWS. Today's teleport reports one distinct scrollTop across
    // the flight; the pinned one reports many.
    const follow = await page.evaluate(async () => {
        const th = document.getElementById('chat-thread');
        const msgs = [];
        for (let i = 0; i < 9; i++)
            msgs.push({
                role: i % 2 ? 'admin' : 'guest',
                body: 'And is parking easy at the cottage?',
                at: '2026-09-01 10:0' + i + ':00',
            });
        th.innerHTML = window.chatBubbles(msgs, 'guest', false);
        th.scrollTop = th.scrollHeight;
        const scrollable = th.scrollHeight > th.clientHeight;
        // one more arrives
        msgs.push({ role: 'admin', body: 'It is — right outside the door.', at: '2026-09-01 10:09:00' });
        th.innerHTML = window.chatBubbles(msgs, 'guest', true);
        window.chatFollow(th, true);
        const seen = [];
        for (let i = 0; i < 14; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            seen.push(Math.round(th.scrollTop));
        }
        return { scrollable, distinct: new Set(seen).size, first: seen[0], last: seen[seen.length - 1] };
    });
    check(follow.scrollable, 'the thread overflows, so there is somewhere to travel');
    check(follow.distinct > 3, 'the scroll TRAVELS rather than teleporting', follow.distinct + ' distinct positions');
    check(follow.last > follow.first, 'and it travels downward', follow.first + ' → ' + follow.last);

    // THE POLICY IS UNCHANGED: the 60px threshold, read BEFORE the re-render.
    const policy = await page.evaluate(() => {
        const th = document.getElementById('chat-thread');
        th.scrollTop = 0;
        const far = window.chatNearBottom(th);
        th.scrollTop = th.scrollHeight;
        const near = window.chatNearBottom(th);
        return { far, near };
    });
    check(!policy.far && policy.near, 'chatNearBottom still answers the 60px question', JSON.stringify(policy));

    // …and the one thing that IS new: a reply landing off-screen says so.
    const pill = await page.evaluate(() => {
        const p = document.getElementById('chat-newpill');
        if (!p) return { none: true };
        window.chatNewPill(true);
        const shown = p.classList.contains('show') && p.getClientRects().length > 0;
        const h = Math.round(p.getBoundingClientRect().height);
        window.chatNewPill(false);
        return { shown, h, hidden: !p.classList.contains('show') };
    });
    check(!pill.none && pill.shown, 'the new-message pill can be raised');
    check(pill.h >= 30, 'and is a real target', pill.h + 'px');
    check(pill.hidden, 'and stands down again');

    // SEEK LAST: the spring's own shape, sampled deterministically.
    const spring = await page.evaluate(async () => {
        const th = document.getElementById('chat-thread');
        th.innerHTML = window.chatBubbles(
            [
                { role: 'guest', body: 'one', at: '2026-09-01 10:00:00' },
                { role: 'admin', body: 'two', at: '2026-09-01 10:01:00' },
            ],
            'guest',
            true,
        );
        await new Promise((r) => requestAnimationFrame(r));
        const row = th.querySelector('.chat-row.is-new');
        const msg = row.querySelector('.chat-msg');
        const pop = msg.getAnimations().find((a) => a.animationName === 'chatMsgPop');
        const fade = msg.getAnimations().find((a) => a.animationName === 'chatMsgFade');
        if (!pop) return { none: true };
        pop.pause();
        const curve = [];
        for (let i = 0; i <= 10; i++) {
            pop.currentTime = i * 50;
            curve.push(+new DOMMatrixReadOnly(getComputedStyle(msg).transform).a.toFixed(3));
        }
        let opFull = null;
        if (fade) {
            fade.pause();
            fade.currentTime = 140;
            opFull = +getComputedStyle(msg).opacity;
            fade.play();
        }
        pop.play();
        return {
            curve,
            rowAnim: getComputedStyle(row).animationName,
            origin: getComputedStyle(msg).transformOrigin,
            themOrigin: getComputedStyle(th.querySelector('.chat-msg.them')).transformOrigin,
            opFull,
        };
    });
    check(!spring.none && spring.rowAnim === 'chatRowOpen', 'the row makes room', spring.rowAnim);
    const peak = Math.max(...(spring.curve || [0]));
    const after = (spring.curve || []).slice((spring.curve || []).indexOf(peak));
    check(peak > 1.005, 'the bubble OVERSHOOTS', 'peak ' + peak);
    check(
        Math.min(...after) < 1,
        'and swings back — the second swing a cubic-bezier cannot express',
        'dips to ' + Math.min(...after),
    );
    check(spring.opFull === 1, 'the fade is its own animation, done by 140ms', String(spring.opFull));
    check(/^0px /.test(spring.themOrigin), 'a received bubble grows from bottom LEFT', spring.themOrigin);

    // Reduced motion: nothing animates, and the scroll simply lands.
    const rm = await t.browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const p2 = await rm.newPage();
    await p2.goto(t.base + '/index.html');
    await p2.waitForTimeout(1200);
    await p2.evaluate(() => window.toggleChat());
    await p2.waitForTimeout(500);
    const still = await p2.evaluate(() => {
        const th = document.getElementById('chat-thread');
        th.innerHTML = window.chatBubbles([{ role: 'guest', body: 'x', at: '2026-09-01 10:00:00' }], 'guest', true);
        const row = th.querySelector('.chat-row.is-new');
        return {
            row: getComputedStyle(row).animationName,
            msg: getComputedStyle(row.querySelector('.chat-msg')).animationName,
            off: window.chatMotionOff(),
        };
    });
    check(still.off && still.row === 'none' && still.msg === 'none', 'reduced motion stands it all down', JSON.stringify(still));
    await rm.close();

    // ============================================================
    //  §3 — the site's first line
    // ============================================================
    console.log('\n  §3 the hero eyebrow does not orphan a word');
    await page.evaluate(() => {
        window.closeChat();
        window.nav('view-main');
    });
    await page.waitForTimeout(500);
    const kick = await page.evaluate(() => {
        const el = document.querySelector('.hero-kicker');
        const r = document.createRange();
        r.selectNodeContents(el);
        const w = [...r.getClientRects()].filter((b) => b.width > 2).map((b) => Math.round(b.width));
        return { lines: w.length, w, balance: getComputedStyle(el).textWrap === 'balance' };
    });
    check(kick.balance, 'the eyebrow is balanced');
    // The RATIO is the honest test: it compares across widths and type sizes,
    // where a pixel figure only describes one rendering. It was 67/312 = 21%.
    const ratio = kick.lines > 1 ? kick.w[kick.w.length - 1] / kick.w[0] : 1;
    check(ratio > 0.45, 'so its last line is not a stub', Math.round(ratio * 100) + '% of the first (' + kick.w.join(', ') + 'px)');

    // ============================================================
    //  §4 — the two declarations
    // ============================================================
    console.log('\n  §4 the declarations clear the house floor');
    await page.evaluate(() => window.openProperty(Object.keys(window.propertyMeta || {})[0] || 'jollyboat'));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.openEnquireModal());
    await page.waitForTimeout(500);
    const dec = await page.evaluate(() => {
        document.getElementById('enquire-step-review').style.display = 'none';
        document.getElementById('enquire-step-details').style.display = '';
        return ['enq-nodogs', 'enq-terms'].map((id) => {
            const inp = document.getElementById(id);
            const row = inp.closest('.terms-accept');
            const box = row.querySelector('.terms-box');
            return {
                id,
                row: Math.round(row.getBoundingClientRect().height),
                box: Math.round(box.getBoundingClientRect().width),
                hit: Math.round(inp.getBoundingClientRect().width),
                opacity: +getComputedStyle(inp).opacity,
                tick: !!box.querySelector('svg path'),
            };
        });
    });
    dec.forEach((d) => {
        check(d.row >= 44, `${d.id}: the row clears the 44px floor`, d.row + 'px');
        check(d.box >= 24, `${d.id}: the box is at least 24px`, d.box + 'px');
        check(d.hit >= 24 && d.opacity === 0, `${d.id}: the REAL input is still there, full size and transparent`, d.hit + 'px @ ' + d.opacity);
        check(d.tick, `${d.id}: the tick is strokable`);
    });

    // The label text is the target, not just the box — and the tick draws.
    const tick = await page.evaluate(() => {
        const inp = document.getElementById('enq-nodogs');
        const row = inp.closest('.terms-accept');
        row.querySelector('span:not(.terms-box)').click(); // the WORDS, not the box
        const box = row.querySelector('.terms-box');
        const path = box.querySelector('svg path');
        return {
            checked: inp.checked,
            anim: getComputedStyle(path).animationName,
            dur: getComputedStyle(path).animationDuration,
            stroke: getComputedStyle(path).stroke,
        };
    });
    check(tick.checked, 'clicking the label TEXT ticks it');
    check(tick.anim === 'termsDraw', 'and the tick draws itself', tick.anim + ' ' + tick.dur);
    check(tick.stroke !== 'rgb(255, 255, 255)', 'in an ink that clears 3:1 on the green — not white (2.78:1)', tick.stroke);

    // ============================================================
    //  §5 — a stay you are IN says so
    // ============================================================
    // Driven through the REAL renderGuestBookings with a stubbed my-bookings
    // payload: one stay that STARTED YESTERDAY and has not ended, one genuinely
    // future, one past. Asserting on markup the gate composed itself would prove
    // the stylesheet and nothing else (this file's own second discipline).
    console.log('\n  §5 a stay in progress is not filed under “Upcoming”');
    const day = (n) => { const t2 = new Date(); t2.setDate(t2.getDate() + n); return t2.toISOString().slice(0, 10); };
    await page.route(/my-bookings\.php/, (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                guest: { name: 'Guest Tester', email: 'guest@example.com' },
                bookings: [
                    // in progress: arrived yesterday, leaves in three days
                    { id: 3, prop_key: 'jollyboat', name: 'Guest Tester', email: 'guest@example.com', check_in: day(-1), check_out: day(3), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 640, agreed_total: 640 },
                    { id: 5, prop_key: '21a', name: 'Guest Tester', email: 'guest@example.com', check_in: day(21), check_out: day(25), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'deposit', deposit_paid: 150, agreed_total: 620 },
                    { id: 6, prop_key: 'pimpernel', name: 'Guest Tester', email: 'guest@example.com', check_in: day(-40), check_out: day(-36), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 500, agreed_total: 500 },
                ],
            }),
        }),
    );
    const stays = await page.evaluate(async () => {
        try { closeChat(); } catch (e) {}
        currentGuest = { id: 1, name: 'Guest Tester', email: 'guest@example.com' };
        try { setAuthUI(); } catch (e) {}
        nav('view-guest-bookings');
        await renderGuestBookings();
        await new Promise((r) => setTimeout(r, 400));
        const list = document.getElementById('guest-bookings-list');
        // Which HEADING is each card under? Read from the painted order, because
        // the section a card sits in is half the claim being made about it.
        const nodes = [...list.querySelectorAll('h2, h3, .guest-booking')];
        let head = '';
        const cards = [];
        for (const n of nodes) {
            if (/^H[23]$/.test(n.tagName) && !n.closest('.guest-booking')) { head = (n.textContent || '').trim(); continue; }
            if (!n.classList.contains('guest-booking')) continue;
            const badge = n.querySelector('.guest-status-badge');
            cards.push({
                name: ((n.querySelector('h3') || {}).textContent || '').trim().slice(0, 40),
                head,
                badge: badge ? (badge.textContent || '').trim() : '',
            });
        }
        // Section headings only — a card's own h3 carries the badge text, which
        // would otherwise read as a heading called "Pimpernel Past stay".
        return { cards, heads: [...list.querySelectorAll('h2, h3')].filter((h) => !h.closest('.guest-booking')).map((h) => (h.textContent || '').trim()) };
    });
    const inProgress = stays.cards.find((c) => /Jollyboat/i.test(c.name));
    const future = stays.cards.find((c) => /21A/i.test(c.name));
    const past = stays.cards.find((c) => /Pimpernel/i.test(c.name));
    check(!!inProgress && !!future && !!past, 'all three stays render', JSON.stringify(stays.cards.map((c) => c.name)));
    // BOTH halves of the claim: the badge AND the heading. Fixing one and not
    // the other is the option this build deliberately did not take.
    check(!!inProgress && /Staying now/i.test(inProgress.badge), 'the stay in progress is badged “Staying now”', inProgress && inProgress.badge);
    check(!!inProgress && !/Upcoming/i.test(inProgress.head), '…and it is NOT under “Upcoming stays”', inProgress && inProgress.head);
    check(!!inProgress && /Staying now/i.test(inProgress.head), '…it has its own group, matching the hub above it', inProgress && inProgress.head);
    // …and the repair must not swallow the two states that were already right.
    check(!!future && /Upcoming/i.test(future.badge) && /Upcoming/i.test(future.head), 'a genuinely future stay is still Upcoming', future && future.badge + ' / ' + future.head);
    check(!!past && /Past/i.test(past.badge) && /Past/i.test(past.head), 'a finished stay is still a Past stay', past && past.badge + ' / ' + past.head);
    check(stays.heads.filter((h) => /^Staying now$/i.test(h)).length === 1, 'the new group appears exactly once', JSON.stringify(stays.heads));

    // ============================================================
    //  §6 — the cottage page's amenities flow
    // ============================================================
    // .amenity-sheet (My Stays) was fixed with flex-wrap and .amenities (the
    // cottage page) was left on a grid whose minmax is wider than a phone
    // column. Measured as ROWS, which is the outcome — a declaration check would
    // pass on any future layout that happened to stack them another way.
    console.log('\n  §6 the cottage page’s amenities flow, not one per row');
    // Seeded into the store the renderer READS (guestAmenityList → siteContent),
    // not through a route: content lands at boot, long before a route registered
    // here could intercept it. The list is a deliberate MIX — short names are
    // what a one-column grid wasted a whole row on, and a long one has to still
    // get the width it needs.
    // The list is a deliberate MIX — short names are what a one-column grid
    // wasted a whole row on, and a long one has to still get the width it needs.
    // Driven through the REAL renderAmenities: it reads a module-scoped
    // `activePropAmenities`, so seeding siteContent would not reach it (and
    // guestAmenityList wants an ARRAY, not the JSON string a route would send).
    const AMENS = ['Wifi', 'Smeg Chef Kitchen', 'Off-street parking', 'Private Walled Garden',
        'Dishwasher', 'Heritage Coastal Setting', 'Log burner', 'Bath'];
    for (const w of [360, 390, 430]) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.waitForTimeout(200);
        const am = await page.evaluate(async (list) => {
            openProperty('21a');
            await new Promise((r) => setTimeout(r, 900));
            activePropAmenities = list;
            renderAmenities('21a');
            await new Promise((r) => setTimeout(r, 200));
            const host = document.querySelector('#view-21a .amenities');
            if (!host) return { none: true };
            const pills = [...host.querySelectorAll('.amenity-pill')].filter((e) => e.getClientRects().length);
            const rows = new Set(pills.map((e) => Math.round(e.getBoundingClientRect().top)));
            const widths = pills.map((e) => Math.round(e.getBoundingClientRect().width));
            return {
                n: pills.length,
                rows: rows.size,
                hostW: Math.round(host.getBoundingClientRect().width),
                distinctWidths: new Set(widths).size,
                full: widths.filter((x) => x >= Math.round(host.getBoundingClientRect().width) - 2).length,
            };
        }, AMENS);
        check(!am.none && am.n >= 6, `${w}px: the cottage page lists its amenities`, JSON.stringify(am));
        check(!am.none && am.rows < am.n, `${w}px: they share lines (${am.rows} rows for ${am.n} amenities)`, JSON.stringify(am));
        // A pill spanning the whole container IS the defect — that is what a
        // one-column grid produces, and what a too-narrow minmax would reproduce.
        check(!am.none && am.full === 0, `${w}px: no pill takes the full width`, JSON.stringify(am));
        // Flowing, not equal columns: a one-word amenity must not get the same
        // box as "Heritage Coastal Setting".
        check(!am.none && am.distinctWidths > 2, `${w}px: each pill takes what it needs (${am.distinctWidths} distinct widths)`, JSON.stringify(am));
    }
    await page.setViewportSize({ width: 390, height: 844 });

    console.log(fails ? `\n  ${fails} GUEST-REPAIR CHECK(S) FAILED ❌` : '\n  GUEST REPAIRS SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
