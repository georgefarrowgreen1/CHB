// ============================================================
//  ui-test-chat-layout.js — the guest chat's layout on a phone.
//
//  Two defects were reported from a real device and both were geometric, so they
//  are pinned by measurement rather than by eye:
//
//    A) the Messages pill (#guest-msg-fab, z-index 1400) sat ON TOP of the
//       composer — it overlapped the attach button and the left edge of the
//       message box, because toggleChat() hides the desktop .chat-fab but never
//       its guest-shell twin. Nothing about the chat "failed", it just covered
//       the controls, which is exactly the kind of bug a functional test misses.
//    B) the composer clipped its own text: a 1-row textarea whose content needed
//       68px inside a 49px box, so the second line was cut in half.
//
//  Plus the quick-reply row, which scrolls with a hidden scrollbar and so needs a
//  visible edge treatment rather than a chip sliced mid-word.
// ============================================================
const { boot } = require('./ui-test-lib');

(async () => {
    let fails = 0;
    const check = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };

    const t = await boot({ viewport: { width: 390, height: 844 } });
    const page = t.page;
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.goto(t.base + '/index.html', { waitUntil: 'domcontentloaded' });
    // WAIT FOR THE REAL CONDITION, not a clock. The checks below hit-test whether
    // anything covers the composer, and #loading-overlay is a full-screen panel
    // that sits there until the boot finishes — so a fixed 1200ms wait meant a
    // slow runner reported "covered by loading-overlay" for all three controls,
    // which reads exactly like the layout bug they exist to catch. It did: CI run
    // 31824770415, green here serially, under 3-way concurrency, and through
    // ui-tests.js. Same lesson as ui-test-lib's appReadyGoto — a
    // wait-for-the-condition belongs in the harness, not a guessed duration.
    let booted = true;
    try {
        await page.waitForFunction(() => {
            const o = document.getElementById('loading-overlay');
            return !o || o.classList.contains('fade-out');
        }, null, { timeout: 20000 });
    } catch (e) { booted = false; }
    check(booted, 'the boot finished and the loading overlay lifted (or the hit-tests below mean nothing)');
    await page.waitForTimeout(250); // the overlay's own 600ms fade begins here; let paint settle

    const open = await page.evaluate(async () => {
        try { toggleChat(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 800));
        const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
        const rect = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
        const fab = document.getElementById('guest-msg-fab');
        const input = rect('#chat-input');
        const attach = rect('#chat-attach-btn');
        const send = rect('#chat-widget .chat-send');
        const ta = document.getElementById('chat-input');
        // Is any composer control actually covered at its own centre?
        // Resolve to something readable: an SVG child's className is an
        // SVGAnimatedString, not a string, so walk up to the control it belongs to.
        const covered = (r) => {
            if (!r) return 'missing';
            const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
            if (!hit) return 'nothing';
            const own = hit.closest('button, textarea, #guest-msg-fab');
            const el = own || hit;
            return el.id || (typeof el.className === 'string' ? el.className : '') || el.tagName;
        };
        return {
            chatOpen: document.getElementById('chat-widget').classList.contains('open'),
            fabVisible: vis(fab),
            widgetBottom: Math.round(rect('#chat-widget').bottom),
            composerBottom: Math.round(rect('#chat-widget .chat-composer').bottom),
            vh: window.innerHeight,
            inputClient: ta.clientHeight,
            inputScroll: ta.scrollHeight,
            hitInput: covered(input),
            hitAttach: covered(attach),
            hitSend: covered(send),
        };
    });
    check(open.chatOpen, 'the chat opens as a full page');
    check(!open.fabVisible, 'the Messages pill is hidden while the chat is open (it opened this screen)');
    check(/chat-input/.test(open.hitInput), `the message box is not covered (hit: ${open.hitInput})`);
    check(/attach/.test(open.hitAttach), `the attach button is not covered (hit: ${open.hitAttach})`);
    check(/chat-send/.test(open.hitSend), `the send button is not covered (hit: ${open.hitSend})`);
    check(open.inputScroll <= open.inputClient + 1, `the empty composer shows its placeholder in full (needs ${open.inputScroll}px, has ${open.inputClient}px)`);
    check(open.composerBottom <= open.vh, `the composer sits inside the viewport (${open.composerBottom} of ${open.vh})`);

    // ---- B) typed text grows the box instead of being clipped ----
    const typed = await page.evaluate(async () => {
        const ta = document.getElementById('chat-input');
        ta.focus();
        ta.value = 'We are arriving late on the Friday, is that alright, and is there somewhere to park a second car nearby?';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const max = parseFloat(getComputedStyle(ta).maxHeight);
        // `max-height` caps the BORDER box (box-sizing: border-box) while clientHeight is
        // the content box, two hairlines shorter — so "has it hit the cap" is asked of
        // offsetHeight. Read against clientHeight the check failed the day the field's
        // type moved to the 17px step and the sentence took one more line.
        return { client: ta.clientHeight, box: ta.offsetHeight, scroll: ta.scrollHeight, max, bottom: Math.round(ta.getBoundingClientRect().bottom), vh: window.innerHeight };
    });
    check(typed.client > 50, `the box GROWS with what you type (${typed.client}px)`);
    check(typed.scroll <= typed.client + 1 || typed.box >= typed.max - 1,
        `nothing is clipped — it fits (${typed.scroll} in ${typed.client}) or has hit its ${typed.max}px cap (box ${typed.box})`);
    check(typed.bottom <= typed.vh, `the grown box stays on screen (${typed.bottom} of ${typed.vh})`);

    // ---- and it returns to one line after sending ----
    const reset = await page.evaluate(async () => {
        const ta = document.getElementById('chat-input');
        const grown = ta.clientHeight;
        ta.value = '';
        chatResetInputHeight();
        await new Promise((r) => setTimeout(r, 120));
        return { grown, back: ta.clientHeight };
    });
    check(reset.back < reset.grown, `it drops back to one line when cleared (${reset.grown} → ${reset.back}px)`);

    // ---- C) the quick-reply row reads as scrollable ----
    const chips = await page.evaluate(() => {
        const q = document.querySelector('#chat-widget .chat-quick');
        if (!q) return null;
        const cs = getComputedStyle(q);
        return {
            scrollable: q.scrollWidth > q.clientWidth + 1,
            mask: cs.maskImage || cs.webkitMaskImage || '',
        };
    });
    check(!!chips, 'the quick-reply row is present');
    check(chips && (!chips.scrollable || /gradient/.test(chips.mask)),
        `an overflowing chip row fades at the edge rather than slicing a chip (mask: ${(chips && chips.mask || 'none').slice(0, 30)})`);

    // ---- the pill must come BACK once the chat closes ----
    const closed = await page.evaluate(async () => {
        try { closeChat(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 500));
        const fab = document.getElementById('guest-msg-fab');
        return getComputedStyle(fab).display !== 'none' && fab.getBoundingClientRect().height > 0;
    });
    check(closed, 'the Messages pill returns when the chat is closed');

    console.log(fails ? `\n  ${fails} CHAT-LAYOUT CHECK(S) FAILED ❌` : '\n  CHAT-LAYOUT SUITE PASSED ✅');
    await t.done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
