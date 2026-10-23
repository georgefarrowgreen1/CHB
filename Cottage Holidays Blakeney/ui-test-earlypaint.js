// THE PAGE BEFORE THE SCRIPT (CLAUDE.md). home.php writes the home page's first screen
// (ssr-lib.php) and index.html's head script shows it with no cover to a visitor who has
// never signed in on this device, holding any tap until app.js takes over. Driven in a real
// browser with the page written by the REAL renderer (the php CLI, from this index.html and a
// fixture business) and app.js held back on the wire, so every check sees the page as a
// visitor on a slow connection does:
//   1. before the script: no cover, the headline rising, the server's cards with prices and
//      ratings, the light theme and the phone shell, the hero at its size, card photos held
//   2. a tap is held (pulsing) and the last one replayed when the script takes over
//   3. nothing the visitor is reading is redrawn: the cards, the headline, the prices, the
//      sections on screen; the card photos then arrive and settle in
//   4. a link to another page is not held; a returning device, a ?query or an unmarked page
//      keep the cover exactly as before
//   5. a tap held 10s with no script brings the cover back with its Reload
//   6. cards that no longer say what the script would write are rebuilt (the check is real)
const { execFileSync } = require('child_process');
const path = require('path');
const { bootBrowser } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// One fixture business, for the renderer and for the script's own boot payload alike.
const PROPS = [
    { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 165, max_adults: 6, max_children: 0, max_total: 6, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 1234.5, max_adults: 2, max_children: 0, max_total: 2, sort_order: 2 },
    { prop_key: 'boathouse', name: 'The Boathouse', slug: 'the-boathouse', couple_rate: 140, max_adults: 3, max_children: 1, max_total: 4, sort_order: 3 },
].map((p) => ({ extra_adult_rate: 40, child_rate: 20, booking_fee: 75, transaction_pct: 0, weekend_pct: 0, weekend_days: '5,6', lastmin_pct: 0, lastmin_days: 0, accent: '', address: '', ...p }));
const CONTENT = {
    'hero-bg': 'uploads/hero-ui.jpg',
    'hero-title': 'Three cottages by the quay',
    'card1-title': 'Westgate House',
    'card1-img': 'uploads/card-ui-21a.jpg',
    'card2-img': 'uploads/card-ui-jolly.jpg',
    'occupancy-boathouse': { maxAdults: 4, maxChildren: 1, maxTotal: 5 },
};
// What rates.php sends for these rows (occupancy_limits: a saved limit wins).
const OCC = { '21a': { maxAdults: 6, maxChildren: 0, maxTotal: 6 }, jollyboat: { maxAdults: 2, maxChildren: 0, maxTotal: 2 }, boathouse: { maxAdults: 4, maxChildren: 1, maxTotal: 5 } };
const REVIEWS = { v: 2, list: [], n: 24, sum: 104, props: { '21a': [20, 87], jollyboat: [4, 17] }, ld: [0, 0] };

// The page, written by the real renderer, as home.php writes it (the hero first, then the rest).
function render(content) {
    const php = `require 'ssr-lib.php'; require 'reviews-lib.php'; require 'hero-shell.php';
        $f = json_decode(stream_get_contents(STDIN), true);
        $rows = array_map(fn($p) => $p + ['archived_at' => null, 'unlisted' => 0], $f['props']);
        $out = inject_live_hero(file_get_contents('index.html'), $f['content']['hero-bg'], 'https://x.test');
        echo ssr_home($out, ['content' => $f['content'], 'props' => $rows, 'reviews' => $f['reviews'], 'base' => '/']);`;
    return execFileSync('php', ['-r', php], { cwd: __dirname, input: JSON.stringify({ props: PROPS, content, reviews: REVIEWS }), encoding: 'utf8' });
}
const SSR = render(CONTENT);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
// The early page's entrance plays at its first paint (the hero bar rises for 1.9s): a step that
// taps or measures waits for every animation that ends to have ended (the held tap's pulse and
// the scene's loops never end, so they do not count).
const settle = (pg) => pg.waitForFunction(() => document.getAnimations().every((a) => {
    const t = a.effect && a.effect.getComputedTiming();
    return a.playState !== 'running' || !t || !Number.isFinite(Number(t.endTime));
}), null, { timeout: 10000, polling: 50 });

// A page whose app.js waits for the suite to let it through. opts: html (what '/' serves),
// content (the boot payload's), seen (localStorage before load), clock (install a fake clock).
async function openEarly(browser, base, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    if (opts.seen) await page.addInitScript((k) => { try { localStorage.setItem(k, '1'); } catch (e) {} }, opts.seen);
    // The head script's stuck timer, kept rather than run: the suite fires that callback itself,
    // so the step does not depend on a clock (a fake one let it miss once under load).
    if (opts.holdStuck) {
        await page.addInitScript(() => {
            const st = window.setTimeout;
            window.setTimeout = /** @type {any} */ (function (f, ms, ...a) {
                if (typeof f === 'function' && String(f).includes('chb-stuck')) {
                    window.__stuckAsked = ms;
                    window.__stuckFire = f;
                    return 1;
                }
                return st.call(this, f, ms, ...a);
            });
        });
    }
    const app = gate();
    const log = { img: [], released: 0 };
    await page.route('**/*', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        if (u.pathname === '/' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: opts.html || SSR });
        if (/\/cottages\//.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>cottage</title><p id="elsewhere">a cottage page</p>' });
        if (u.pathname.endsWith('/app.js')) { await app.p; return route.continue(); }
        if (u.pathname.endsWith('/img.php')) { log.img.push({ src: u.searchParams.get('src'), w: u.searchParams.get('w'), at: Date.now() }); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
        if (u.pathname.startsWith('/uploads/')) { log.img.push({ src: u.pathname.slice(1), w: 'original', at: Date.now() }); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
        if (!u.pathname.endsWith('.php')) return route.continue();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        const rates = { properties: PROPS.map((p) => ({ ...p, archived: false, unlisted: false })), seasons: {}, occupancy: OCC };
        if (u.pathname.endsWith('bootstrap.php')) return json({ ok: true, rates, content: { content: opts.content || CONTENT }, reviews: REVIEWS, square: { enabled: false } });
        if (u.pathname.endsWith('rates.php')) return json(rates);
        if (u.pathname.endsWith('content.php')) return json({ content: opts.content || CONTENT });
        if (u.pathname.endsWith('reviews.php')) return json(REVIEWS);
        return json({ ok: true, props: {}, ranges: [], bookings: [], enquiries: [], reviews: [], photos: [], events: [] });
    });
    // DOMContentLoaded waits for the deferred scripts, so with app.js held it never comes: the
    // page is parsed (and painted) when readyState leaves 'loading'.
    await page.goto(base + (opts.path || '/'), { waitUntil: 'commit' });
    await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 15000 });
    const release = async () => {
        log.released = Date.now();
        app.open();
        await page.waitForFunction(() => typeof window.__BUILD === 'string', null, { timeout: 20000 });
    };
    return { ctx, page, errs, release, log };
}

(async () => {
    const t = await bootBrowser();
    const { browser, base } = t;
    ok(/<html[^>]*data-ssr="home"/.test(SSR) && SSR.includes('data-ssr-keys="21a,jollyboat,boathouse"'), '(vacuity) the renderer wrote the page and marked it');

    console.log('1. the page before the script');
    const A = await openEarly(browser, base);
    const pg = A.page;
    await pg.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', null, { timeout: 10000 }).catch(() => {});
    const s1 = await pg.evaluate(() => {
        const o = document.getElementById('loading-overlay');
        const w = document.querySelector('#hero-headline-panel h1 .w > i');
        const grid = document.getElementById('home-cottages-grid');
        const cards = [...grid.querySelectorAll(':scope > a.card')];
        const hero = getComputedStyle(document.querySelector('#hero .hero-bg')).backgroundImage;
        return {
            script: typeof window.__BUILD,
            early: document.documentElement.classList.contains('chb-early'),
            cover: o ? getComputedStyle(o).display : 'gone',
            words: document.querySelectorAll('#hero-headline-panel h1 .w').length,
            rising: w ? getComputedStyle(w).animationPlayState : '',
            light: document.body.classList.contains('light-mode'),
            shell: document.body.classList.contains('guest-app'),
            cards: cards.map((c) => [c.getAttribute('data-prop'), (c.querySelector('.card-title') || {}).textContent, (c.querySelector('.card-price') || {}).textContent.replace(/\s+/g, ' ').trim(), (c.querySelector('.card-rating') || {}).textContent.replace(/\s+/g, ' ').trim()]),
            photo: getComputedStyle(cards[0].querySelector('.card-img')).backgroundImage,
            hero,
            count: (document.getElementById('heritage-count') || {}).textContent,
        };
    });
    ok(s1.script === 'undefined', '(vacuity) app.js has not run');
    ok(s1.early && s1.cover === 'none', `there is no cover: the page is the first paint (early ${s1.early}, cover ${s1.cover})`);
    ok(s1.words === 5 && s1.rising === 'running', `the headline is in its word spans and rising, not held for a reveal (${s1.words} words, ${s1.rising})`);
    ok(s1.light && s1.shell, `the light theme and the phone shell are on before the script (light ${s1.light}, shell ${s1.shell})`);
    ok(JSON.stringify(s1.cards[0]) === JSON.stringify(['21a', 'Westgate House', 'from £165.00 / night (couple)', '★ 4.3 · 20 reviews'])
        && s1.cards.length === 3 && s1.cards[2][1] === 'The Boathouse' && s1.cards[1][2] === 'from £1,234.50 / night (couple)',
        `the server's cards say the owner's words, prices and ratings: ${JSON.stringify(s1.cards[0])}`);
    ok(s1.count === '3', `the cottage count is the live list (${s1.count})`);
    ok(/img\.php\?src=uploads%2Fhero-ui\.jpg&w=1200/.test(s1.hero), `the hero photo at the phone's size (${s1.hero.slice(0, 70)})`);
    ok(s1.photo === 'none' && !A.log.img.some((r) => /card-ui/.test(r.src || '')), `the card photos wait for the script (${s1.photo}; ${A.log.img.length} image requests, ${A.log.img.filter((r) => /card-ui/.test(r.src || '')).length} for a card)`);

    console.log('2. a tap is held, and the last one replayed');
    await pg.evaluate(() => {
        const g = document.getElementById('home-cottages-grid');
        window.__keep = { card: g.firstElementChild, word: document.querySelector('#hero-headline-panel h1 .w'), price: document.getElementById('home-card-price-21a') };
    });
    await settle(pg);
    await pg.click('#hb-guests-btn');
    await pg.click('[data-act="heroBarGo"]');
    const s2 = await pg.evaluate(() => ({
        go: document.querySelector('[data-act="heroBarGo"]').hasAttribute('data-chb-wait'),
        guests: document.getElementById('hb-guests-btn').hasAttribute('data-chb-wait'),
        picker: document.getElementById('date-picker').classList.contains('open'),
        pop: document.getElementById('hb-pop').hidden,
    }));
    ok(s2.go && !s2.guests, `only the last tap is held, and it says so (Choose dates ${s2.go}, Guests ${s2.guests})`);
    ok(!s2.picker && s2.pop, '…and nothing ran: no calendar, no guest panel');
    // The visitor has scrolled to the cottages before the script arrives. INSTANT, with the fonts
    // in and a frame drawn: the page scrolls smoothly (app.css), and a scroll still moving when
    // the script marks what is on screen made this check a race (it failed once under load).
    await pg.evaluate(async () => {
        await document.fonts.ready;
        document.getElementById('home-cottages').scrollIntoView({ block: 'start', behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await A.release();
    // Read the moment the script has run: a section hidden and re-shown as reveals arm would
    // still be moving (0.8s), so this cannot pass on a transition that had time to finish.
    const s3a = await pg.evaluate(() => {
        const rv = [...document.querySelectorAll('#view-main .reveal')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight; });
        return {
            armed: document.documentElement.classList.contains('js-reveal'),
            onScreen: rv.length,
            shown: rv.filter((el) => el.classList.contains('in-view') && getComputedStyle(el).opacity === '1').length,
            moving: rv.filter((el) => el.getAnimations().length > 0).length,
        };
    });
    ok(s3a.armed && s3a.onScreen >= 1 && s3a.shown === s3a.onScreen && s3a.moving === 0, `the sections on screen stay as they were when reveals arm (${s3a.shown} of ${s3a.onScreen} shown, ${s3a.moving} moving)`);
    await pg.waitForFunction(() => window.__chbTaken === true, null, { timeout: 15000 });
    const s3 = await pg.evaluate(() => ({
        picker: document.getElementById('date-picker').classList.contains('open'),
        wait: document.querySelectorAll('[data-chb-wait]').length,
        pop: document.getElementById('hb-pop').hidden,
    }));
    ok(s3.picker && s3.wait === 0 && s3.pop, `the held tap ran when the script took over: the calendar opened, the pulse stopped, the earlier tap was dropped (${JSON.stringify(s3)})`);

    console.log('3. nothing the visitor is reading is redrawn');
    await pg.evaluate(() => closeDatePicker());
    await pg.waitForFunction(() => typeof __contentLoaded !== 'undefined' && __contentLoaded === true, null, { timeout: 10000 });
    const s4 = await pg.evaluate(() => {
        const g = document.getElementById('home-cottages-grid');
        const k = window.__keep;
        renderHomeCottages(); // what every later tick does, now with the content in hand
        return {
            card: k.card === g.firstElementChild && k.card.isConnected,
            word: k.word.isConnected,
            price: k.price.isConnected && !k.price.classList.contains('is-landed') && /£165\.00/.test(k.price.textContent),
            decided: typeof g.__chbCards === 'string' && g.__chbCards.length > 100,
            after: k.card === g.firstElementChild,
        };
    });
    ok(s4.card && s4.word, `the server's cards and the headline's words are the same nodes after the takeover (card ${s4.card}, words ${s4.word})`);
    ok(s4.price, '…the price stands, with no settle as if it had just arrived');
    ok(s4.decided && s4.after, `with the content in, the cards are judged the script's own and kept for good (${s4.decided}, ${s4.after})`);
    await pg.waitForFunction(() => [...document.querySelectorAll('#home-cottages-grid .card-img')].slice(0, 2).every((el) => el.classList.contains('img-in')), null, { timeout: 8000 }).catch(() => {});
    const s5 = await pg.evaluate(() => {
        const im = document.querySelector('#home-cottages-grid .card-img');
        return { taken: document.documentElement.classList.contains('chb-taken'), bg: getComputedStyle(im).backgroundImage, in: im.classList.contains('img-in') };
    });
    const cardReqs = A.log.img.filter((r) => /card-ui/.test(r.src || ''));
    ok(s5.taken && /card-ui-21a\.jpg&w=900/.test(s5.bg) && s5.in, `the card photos arrive once the script is in, and settle in (${s5.bg.slice(0, 60)}, img-in ${s5.in})`);
    ok(cardReqs.length >= 2 && cardReqs.every((r) => r.at >= A.log.released), `…and none was asked for before it (${cardReqs.length} requests, all after the release)`);
    const heroNow = await pg.evaluate(() => getComputedStyle(document.querySelector('#hero .hero-bg')).backgroundImage);
    const originals = A.log.img.filter((r) => r.w === 'original');
    ok(/hero-ui\.jpg&w=1200/.test(heroNow) && !originals.length, `the script keeps the hero at the size on screen, never the full original (${heroNow.slice(-40)}; ${originals.length} originals asked for)`);
    ok(!A.errs.length, `no page errors (${A.errs.join(' | ').slice(0, 160)})`);
    await A.ctx.close();

    console.log('4. what keeps the cover, and a link elsewhere');
    const B = await openEarly(browser, base);
    await Promise.all([B.page.waitForURL(/\/cottages\/21a-westgate$/, { timeout: 8000 }).then(() => true, () => false), B.page.click('#home-cottages-grid a.card')]);
    ok(/\/cottages\/21a-westgate$/.test(B.page.url()), `a card is a link to its own page and goes there before the script (${new URL(B.page.url()).pathname})`);
    await B.ctx.close();
    const cover = async (opts) => {
        const C = await openEarly(browser, base, opts);
        const r = await C.page.evaluate(() => ({ early: document.documentElement.classList.contains('chb-early'), cover: getComputedStyle(document.getElementById('loading-overlay')).display, words: document.querySelectorAll('#hero-headline-panel h1 .w').length, held: getComputedStyle(document.querySelector('#hero-headline-panel h1 .w > i') || document.body).animationPlayState }));
        await C.release();
        await C.page.waitForFunction(() => { const o = document.getElementById('loading-overlay'); return !o || o.classList.contains('fade-out'); }, null, { timeout: 15000 }).catch(() => {});
        await C.ctx.close();
        return r;
    };
    const seen = await cover({ seen: 'chb-was-guest' });
    ok(!seen.early && seen.cover === 'flex' && seen.held === 'paused', `a device that has signed in keeps the cover and the held entrance (early ${seen.early}, cover ${seen.cover}, ${seen.held})`);
    const owner = await cover({ seen: 'chb-was-admin' });
    ok(!owner.early && owner.cover === 'flex', `…so does an owner's device (cover ${owner.cover})`);
    const q = await cover({ path: '/?ref=newsletter' });
    ok(!q.early && q.cover === 'flex', `a link with a query keeps the cover: it may open somewhere else (cover ${q.cover})`);
    const plain = await cover({ html: require('fs').readFileSync(path.join(__dirname, 'index.html'), 'utf8') });
    ok(!plain.early && plain.cover === 'flex' && plain.words === 0, `a page the server did not write keeps the cover (cover ${plain.cover})`);

    console.log('5. a tap held with no script brings the cover back');
    const D = await openEarly(browser, base, { holdStuck: true });
    await settle(D.page);
    await D.page.click('[data-act="heroBarGo"]');
    const before = await D.page.evaluate(() => ({
        held: !!document.querySelector('[data-act="heroBarGo"][data-chb-wait]'),
        asked: window.__stuckAsked,
        stuck: document.documentElement.classList.contains('chb-stuck'),
        cover: getComputedStyle(document.getElementById('loading-overlay')).display,
    }));
    ok(before.held && before.asked === 10000 && !before.stuck && before.cover === 'none', `(before) the tap is held, the page stays up, and the cover is asked for in ten seconds (${JSON.stringify(before)})`);
    await D.page.evaluate(() => window.__stuckFire && window.__stuckFire());
    const after = await D.page.evaluate(() => ({ stuck: document.documentElement.classList.contains('chb-stuck'), cover: getComputedStyle(document.getElementById('loading-overlay')).display, msg: getComputedStyle(document.getElementById('loading-slow-msg')).display }));
    ok(after.stuck && after.cover === 'flex' && after.msg === 'block', `ten seconds on, the cover returns saying it is taking longer (${JSON.stringify(after)})`);
    const reloaded = await Promise.all([D.page.waitForEvent('framenavigated', { timeout: 5000 }).then(() => true, () => false), D.page.click('#loading-slow-msg [data-act="reload"]')]);
    ok(reloaded[0], '…and its Reload works without the script');
    await D.ctx.close();

    console.log('6. cards that no longer say what the script would write are rebuilt');
    const E = await openEarly(browser, base, { content: { ...CONTENT, 'card1-title': 'Westgate Cottage' } });
    await E.page.evaluate(() => { window.__keep = document.getElementById('home-cottages-grid').firstElementChild; });
    await E.release();
    await E.page.waitForFunction(() => typeof __contentLoaded !== 'undefined' && __contentLoaded === true, null, { timeout: 10000 });
    const s6 = await E.page.evaluate(() => {
        renderHomeCottages();
        const g = document.getElementById('home-cottages-grid');
        return { same: window.__keep === g.firstElementChild, title: (g.querySelector('.card-title') || {}).textContent };
    });
    ok(!s6.same && s6.title === 'Westgate Cottage', `the owner's newer title replaces the server's card (rebuilt ${!s6.same}, "${s6.title}")`);
    await E.ctx.close();

    await t.done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
