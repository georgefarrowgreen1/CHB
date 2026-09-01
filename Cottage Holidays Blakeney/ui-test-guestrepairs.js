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
//    §4 the two declarations clear the house's own 44px floor, with a drawn tick.
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

    console.log(fails ? `\n  ${fails} GUEST-REPAIR CHECK(S) FAILED ❌` : '\n  GUEST REPAIRS SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
