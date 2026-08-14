// ============================================================
//  ui-test-cottagecards.js — the cottage cards are ONE shape, whatever the cottages
//  are called and whatever phone the guest is holding.
//
//  Reported from a phone: the cards don't lay out the same way. They didn't, and it was
//  never a second template — all of them come from cottageCardHtml(). The NAME and the
//  RATING were siblings in a WRAPPING flex row, so the card's anatomy was decided by a
//  pixel comparison against owner-editable text. Measured at 402px, with 344px of card
//  to play with:
//
//      21A Westgate Street   245 + 122 + 12 gap = 379   → rating drops to its own line
//      Jollyboat Cottage     209 + 122 + 12     = 343   → fits, sits beside the name
//      Pimpernel Cottage     228 + 122 + 12     = 362   → own line
//
//  Jollyboat cleared it by ONE pixel, which made its card 33px shorter than the two
//  either side of it. And because the test is a pixel comparison it moves with the
//  screen: all three wrap at 390px, one is inline at 402, two at 430 — so the same list
//  was tidy on one guest's phone and mixed on another's, and would flip the moment a
//  cottage was renamed in Settings.
//
//  The name now owns its own line and the two REFERENCE facts — rating and occupancy —
//  share the line beneath it. Price and availability keep their own lines; they are the
//  decision, not the reference.
//
//  Two more things this suite pins, both found while measuring rather than reported:
//   - renderCottageGrid repainted the price and the rating and NOT the availability, which
//     is filled by a single call after loadAvailabilityAll() resolves. On this load order
//     the grid is rebuilt after that call has already run, so every card settled with NO
//     "Available from …" at all — measured here as blank at rest, and it only looks fine if
//     you re-render by hand before reading it;
//   - the standalone Messages button sat bottom-LEFT, in the same column as every card's
//     left-aligned text. At 402px a price reads x 28..238 and at scrollY 74 sits at y
//     808..833, straight through the button's 764..824 band, so a button at x 12..76 covers
//     48px of it — the owner's screenshot, with the word "from" hidden.
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// The three real cottages, with the real names — the lengths ARE the fixture here.
const PROPS = [
    { prop_key: 'a21', name: '21A Westgate Street', slug: 'a21', couple_rate: 145, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat Cottage', slug: 'jollyboat', couple_rate: 135, sort_order: 2 },
    { prop_key: 'pimpernel', name: 'Pimpernel Cottage', slug: 'pimpernel', couple_rate: 155, sort_order: 3 },
].map((p) => Object.assign(
    { extra_adult_rate: 0, child_rate: 0, transaction_pct: 3, booking_fee: 0, max_adults: 2, max_children: 0, max_total: 2 },
    p,
));
const OCC = {
    a21: { maxAdults: 2, maxChildren: 0, maxTotal: 2 },
    jollyboat: { maxAdults: 2, maxChildren: 0, maxTotal: 2 },
    pimpernel: { maxAdults: 2, maxChildren: 1, maxTotal: 3 },
};
const FREE = {
    a21: [{ start: '2026-08-09', end: '2026-09-21' }],
    jollyboat: [{ start: '2026-08-09', end: '2026-08-10' }],
    pimpernel: [{ start: '2026-08-09', end: '2026-08-16' }],
};
// Pinned: the availability chip says "from <date>" or "from tomorrow" off the wall clock,
// and the fixture dates are fixed, so an unpinned run would drift into the past.
const PINNED = new Date('2026-08-08T09:00:00Z');

(async () => {
    const { browser, base, done } = await bootBrowser();
    const page = await browser.newPage({ viewport: { width: 402, height: 844 } });
    await page.clock.setFixedTime(PINNED);
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: OCC });
        if (url.includes('availability.php')) return json({ ok: true, ranges: [], props: FREE });
        return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => nav('view-cottages'));
    await page.waitForTimeout(700);
    // THE AVAILABILITY ROW AS THE BOOT LEAVES IT — captured before anything below
    // re-renders, because that is the only state which shows the defect. It is filled by a
    // single renderCardAvailability() after loadAvailabilityAll() resolves, and
    // renderCottageGrid repainted the price and the rating without it, so on this load
    // order (loadRates rebuilds the grid after availability has landed) every card came up
    // with no "Available from …" at all. Reading it after a manual re-render hides that,
    // which is how the first version of this check passed with the fix reverted.
    const atRest = await page.evaluate(() =>
        [...document.querySelectorAll('#cottages .card-avail')].map((e) => e.textContent.trim()));
    // Sixteen five-star reviews each, so the rating renders its real "★ 5.0 · 16 reviews"
    // rather than the shorter "New — be the first to review" — the LENGTH is what used to
    // decide the layout, so the fixture has to carry the real one.
    await page.evaluate(() => {
        publicGuestReviews = [];
        for (const k of ['a21', 'jollyboat', 'pimpernel'])
            for (let i = 0; i < 16; i++)
                publicGuestReviews.push({ id: k + i, prop: k, name: 'Guest', stars: 5, text: 'Lovely stay.', created_at: '2026-05-01' });
        renderCottageCards();
    });
    await page.waitForTimeout(400);

    // Read each card as an ANATOMY: which rows it has, in what order, and which of them
    // share a line. Line-sharing is decided on `left`, never on `top`: the rows are
    // baseline-aligned, so a tall name and a small rating sitting on ONE line still have
    // very different tops — testing `top` reported "wrapped" for every inline case and
    // sent the first draft of this suite chasing a layout it had measured wrong.
    const anatomy = (sel) => page.evaluate((s) => {
        return [...document.querySelectorAll(s + ' .card')].map((c) => {
            const kids = [...c.children].map((e) => e.className.split(' ')[0]);
            const facts = c.querySelector('.cott-facts');
            const t = c.querySelector('.card-title');
            const r = c.querySelector('.card-rating');
            const m = c.querySelector('.card-meta');
            const box = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
            return {
                name: t ? t.textContent.trim() : '',
                rows: kids,
                h: Math.round(c.getBoundingClientRect().height),
                factsHasBoth: !!(facts && facts.contains(r) && facts.contains(m)),
                // the two facts share a line, and the name is above them
                factsOneLine: !!(r && m && m.getBoundingClientRect().left > r.getBoundingClientRect().left),
                nameAbove: !!(t && facts && t.getBoundingClientRect().bottom <= facts.getBoundingClientRect().top + 1),
                ratingBesideName: !!(t && r && r.getBoundingClientRect().left > t.getBoundingClientRect().left + 5),
                avail: (c.querySelector('.card-avail') || {}).textContent ? c.querySelector('.card-avail').textContent.trim() : '',
                metaText: m ? m.textContent.trim() : '',
                title: t ? box(t) : null,
            };
        });
    }, sel);

    console.log('1. one anatomy, in one order');
    let cards = await anatomy('#cottages');
    ok(cards.length === 3, `the three cottages rendered (${cards.length})`);
    const ORDER = 'card-img-wrap,card-title,cott-facts,card-foot';
    ok(
        cards.every((c) => c.rows.join(',') === ORDER),
        `every card has the same rows in the same order (${cards.map((c) => c.rows.join(',')).join(' | ')})`,
    );
    ok(
        cards.every((c) => c.factsHasBoth && c.factsOneLine),
        'the rating and the occupancy share one facts line',
    );
    ok(
        cards.every((c) => c.nameAbove && !c.ratingBesideName),
        'and the name is on its own line above them, never beside the rating',
    );

    console.log('2. the same shape at every phone width');
    for (const w of [360, 375, 390, 402, 414, 430]) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.waitForTimeout(300);
        cards = await anatomy('#cottages');
        const hs = cards.map((c) => c.h);
        const same = hs.every((h) => h === hs[0]) && cards.every((c) => c.rows.join(',') === ORDER && !c.ratingBesideName);
        ok(same, `${w}px — all three identical (${hs.join(' · ')}px)`);
    }
    await page.setViewportSize({ width: 402, height: 844 });
    await page.waitForTimeout(300);

    console.log('3. a long name takes its own lines and moves nothing else');
    // A HOSTILE NAME, because the real three all fit on one line — without one, section 2
    // could pass on a layout that still hands the name's length to its neighbours.
    const hostile = await page.evaluate(async () => {
        const было = propertyMeta.jollyboat.name;
        propertyMeta.jollyboat.name = 'The Old Lifeboat House at Blakeney Point';
        renderCottageCards();
        await new Promise((r) => setTimeout(r, 250));
        const c = document.querySelector('#cottages .card[data-prop="jollyboat"]');
        const t = c.querySelector('.card-title');
        const facts = c.querySelector('.cott-facts');
        const r = c.querySelector('.card-rating');
        const m = c.querySelector('.card-meta');
        const out = {
            arrived: t.textContent.trim().length > 30,
            lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)),
            clipped: t.scrollWidth > Math.ceil(t.getBoundingClientRect().width) + 1,
            factsOneLine: m.getBoundingClientRect().left > r.getBoundingClientRect().left,
            nameAbove: t.getBoundingClientRect().bottom <= facts.getBoundingClientRect().top + 1,
            rows: [...c.children].map((e) => e.className.split(' ')[0]).join(','),
        };
        propertyMeta.jollyboat.name = было;
        renderCottageCards();
        return out;
    });
    await page.waitForTimeout(300);
    ok(hostile.arrived, `the long name really reached the card (${hostile.lines} line(s))`);
    ok(hostile.lines >= 2, 'it takes the lines it needs rather than being squeezed');
    ok(!hostile.clipped, '…and is not clipped — the name is never the thing that gives way');
    ok(
        hostile.factsOneLine && hostile.nameAbove && hostile.rows === ORDER,
        'the facts line and the row order are untouched by it',
    );

    console.log('4. an unknown occupancy leaves no empty row and no dangling separator');
    const noOcc = await page.evaluate(async () => {
        const было = occupancyLimits.pimpernel;
        delete occupancyLimits.pimpernel;
        renderCottageCards();
        await new Promise((r) => setTimeout(r, 250));
        const c = document.querySelector('#cottages .card[data-prop="pimpernel"]');
        const m = c.querySelector('.card-meta');
        const sep = getComputedStyle(m, '::before').content;
        const out = {
            metaEmpty: m.textContent.trim() === '',
            sep: sep,
            factsH: Math.round(c.querySelector('.cott-facts').getBoundingClientRect().height),
            ratingH: Math.round(c.querySelector('.card-rating').getBoundingClientRect().height),
        };
        occupancyLimits.pimpernel = было;
        renderCottageCards();
        return out;
    });
    await page.waitForTimeout(300);
    ok(noOcc.metaEmpty, 'the fixture really has no occupancy to show');
    ok(
        noOcc.sep === 'none' || noOcc.sep === 'normal' || noOcc.sep === '',
        `…so no separator is printed in front of nothing (content: ${noOcc.sep})`,
    );
    ok(
        Math.abs(noOcc.factsH - noOcc.ratingH) <= 2,
        `…and the facts line is only as tall as the rating, with no empty row below (${noOcc.factsH}px vs ${noOcc.ratingH}px)`,
    );

    console.log('5. the availability row is there when the page settles');
    ok(
        atRest.length === 3 && atRest.every((t) => /available|free/i.test(t)),
        `every card came up with its availability, unprompted (${atRest.map((t) => t || '(blank)').join(' | ')})`,
    );
    // ...and a later rebuild keeps it, which is the same call doing the same job.
    const repaint = await page.evaluate(() => {
        renderCottageCards();
        return [...document.querySelectorAll('#cottages .card-avail')].map((e) => e.textContent.trim());
    });
    ok(
        repaint.length === 3 && repaint.every((t) => /available|free/i.test(t)),
        `…and a rebuilt grid has it immediately, with nothing to wait for (${repaint.map((t) => t || '(blank)').join(' | ')})`,
    );

    console.log('6. no floating control sits on the card text');
    const fabSweep = await (async () => {
        let bad = 0, total = 0, worst = null;
        for (let y = 0; y <= 1200; y += 40) {
            await page.evaluate((v) => window.scrollTo(0, v), y);
            await page.waitForTimeout(40);
            const r = await page.evaluate(() => {
                const fab = document.getElementById('guest-msg-fab');
                if (!fab || getComputedStyle(fab).display === 'none') return { px: 0, skip: true };
                const f = fab.getBoundingClientRect();
                // THE INKED TEXT, not the element's box. `.card-title` is a plain block, so
                // its box spans the whole card whatever the name's length — measured that
                // way this check reported the button "covering" 48px of a title whose words
                // stop 89px short of it. A Range over the contents gives what is actually
                // painted, which is the only thing that can be obscured.
                const textRect = (el) => {
                    const rg = document.createRange();
                    rg.selectNodeContents(el);
                    const b = rg.getBoundingClientRect();
                    rg.detach && rg.detach();
                    return b;
                };
                let px = 0, what = '';
                document.querySelectorAll('#cottages .card-title, #cottages .card-rating, #cottages .card-meta, #cottages .card-price, #cottages .card-avail').forEach((e) => {
                    if (!e.textContent.trim()) return;
                    const b = textRect(e);
                    if (!b.width || !b.height) return;
                    if (b.left < f.right && b.right > f.left && b.top < f.bottom && b.bottom > f.top) {
                        const o = Math.min(b.right, f.right) - Math.max(b.left, f.left);
                        if (o > px) { px = Math.round(o); what = e.className.split(' ')[0] + ' "' + e.textContent.trim().slice(0, 22) + '"'; }
                    }
                });
                return { px, what };
            });
            if (r.skip) return { skipped: true };
            total++;
            if (r.px > 0) { bad++; if (!worst || r.px > worst.px) worst = { ...r, y }; }
        }
        return { bad, total, worst };
    })();
    await page.evaluate(() => window.scrollTo(0, 0));
    ok(!fabSweep.skipped && fabSweep.total > 20, `the Messages button is on screen to be tested (${fabSweep.total} scroll positions swept)`);
    ok(
        fabSweep.bad === 0,
        `it never covers card text${fabSweep.worst ? ` — ${fabSweep.worst.px}px over ${fabSweep.worst.what} at scrollY ${fabSweep.worst.y}` : ''}`,
    );

    console.log('7. the homepage grid is the same card');
    // Both grids render from cottageCardHtml, so they cannot be allowed to drift: the
    // homepage is where most guests meet these cards first.
    await page.evaluate(() => { nav('view-main'); renderHomeCottages(); });
    await page.waitForTimeout(500);
    const home = await anatomy('#home-cottages-grid');
    ok(home.length === 3, `the homepage grid rendered (${home.length})`);
    ok(
        home.every((c) => c.rows.join(',') === ORDER && c.factsHasBoth && c.factsOneLine && !c.ratingBesideName),
        `…with the same anatomy as the cottages page (${home.map((c) => c.rows.join(',')).join(' | ')})`,
    );

    // ── A COTTAGE WITH NO PHOTOS DOES NOT PRETEND TO HAVE ONE ──────────────────
    // A cottage goes live the moment it is created, so this is the state a guest can
    // meet before the first upload. renderGallery substituted [''] for an empty list
    // and dressed the result as a photo: measured 538px of a 390x844 phone — the whole
    // first screen — as a blank rectangle with role=button, tabindex=0, an aria-label
    // reading "Photo 1 of 1 … open photo viewer", two carousel arrows over nothing, and
    // a lightbox that does not open when you press Enter on it.
    console.log('\nA cottage with no photos yet');
    const nophotos = await page.evaluate(async () => {
        renderGallery([]);
        await new Promise((r) => setTimeout(r, 150));
        const track = document.getElementById('gallery-21a');
        const slides = [...track.querySelectorAll('.gallery-slide')];
        const arrows = [...(track.parentElement ? track.parentElement.querySelectorAll('.gallery-nav') : [])];
        return {
            n: slides.length,
            interactive: slides.filter((el) => el.getAttribute('role') || el.getAttribute('tabindex') || el.getAttribute('data-act') || el.getAttribute('aria-label')).length,
            says: (track.textContent || '').trim(),
            arrowsShown: arrows.filter((a) => a.getClientRects().length).length,
        };
    });
    ok(nophotos.n === 1 && nophotos.interactive === 0,
        `the empty gallery offers nothing to open (${nophotos.n} slide, ${nophotos.interactive} interactive)`);
    ok(/coming soon/i.test(nophotos.says), `…and says so in words (${nophotos.says})`);
    ok(nophotos.arrowsShown === 0, `…with no arrows over nothing (${nophotos.arrowsShown})`);

    console.log(fails ? `\n  ${fails} COTTAGE-CARD CHECK(S) FAILED ❌` : '\n  COTTAGE-CARD SUITE PASSED ✅');
    await done(fails);
})();
