// ============================================================
//  ui-test-steady.js — the guest page holds still while it refreshes.
//
//  Every 30 seconds the public site re-reads its content and rates (liveUpdateTick), and
//  two things were rebuilt each time whether anything had changed or not:
//   - the homepage headline: rewriting the h1's text threw away its word spans, so the
//     headline rose in again for every visitor, twice a minute;
//   - both cottage grids: rebuilt wholesale, which dropped keyboard focus on a card and
//     the map hover wired to the old cards.
//  Each check runs a REAL tick and asserts the nodes survive it, and that a real change
//  (a new headline, a new price, a renamed cottage) still lands.
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const props = [
    { prop_key: 'a21', name: '21A Westgate Street', slug: 'a21', couple_rate: 145, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat Cottage', slug: 'jollyboat', couple_rate: 135, sort_order: 2 },
    { prop_key: 'pimpernel', name: 'Pimpernel Cottage', slug: 'pimpernel', couple_rate: 155, sort_order: 3 },
].map((p) => Object.assign({ extra_adult_rate: 0, child_rate: 0, transaction_pct: 3, booking_fee: 0, max_adults: 2, max_children: 0, max_total: 2 }, p));
const content = { 'hero-title': 'Three cottages by the Blakeney marshes', 'it-sub': 'Sleeps 4 · Dogs welcome' };

(async () => {
    const { browser, base, done } = await bootBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('bootstrap.php')) return json({ ok: false }); // each loader reads its own endpoint
        if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
        if (url.includes('content.php')) return json({ content });
        if (url.includes('availability.php')) return json({ ok: true, ranges: [], props: {} });
        return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('#hero-headline-panel h1 .w'), null, { timeout: 15000 }).catch(() => {});
    const tick = () => page.evaluate(async () => { await liveUpdateTick(); });

    console.log('§1 the headline holds still');
    const n0 = await page.evaluate(() => {
        const ws = [...document.querySelectorAll('#hero-headline-panel h1 .w')];
        ws.forEach((w, i) => { /** @type {any} */ (w).__probe = i + 1; });
        return ws.length;
    });
    ok(n0 === 6, `(fixture) the headline is wrapped word by word (${n0} words)`);
    await tick();
    await tick();
    const kept = await page.evaluate(() => {
        const ws = [...document.querySelectorAll('#hero-headline-panel h1 .w')];
        return { n: ws.length, same: ws.every((w, i) => /** @type {any} */ (w).__probe === i + 1) };
    });
    ok(kept.n === n0 && kept.same, `two live ticks later the same word spans are there, so nothing rises again (${kept.n}, same: ${kept.same})`);
    content['hero-title'] = 'Two cottages on the quay';
    await tick();
    const changed = await page.evaluate(() => {
        const h = document.querySelector('#hero-headline-panel h1');
        const ws = [...h.querySelectorAll('.w')];
        return { label: h.getAttribute('aria-label'), n: ws.length, fresh: ws.every((w) => !/** @type {any} */ (w).__probe) };
    });
    ok(changed.label === 'Two cottages on the quay' && changed.n === 5 && changed.fresh, `a new headline still lands, wrapped afresh (${changed.label})`);
    // The separator binding is the one place the written text differs only by a no-break
    // space; it must still be written, and then held still too.
    const bound = await page.evaluate(() => {
        const p = document.createElement('p');
        p.className = 'prop-subtitle';
        p.setAttribute('data-edit-text', 'it-sub');
        p.textContent = 'Sleeps 4 · Dogs welcome';
        document.body.appendChild(p);
        applyContentOverrides(document);
        const first = p.textContent;
        const node = p.firstChild;
        applyContentOverrides(document);
        const r = { first, kept: p.firstChild === node };
        p.remove();
        return r;
    });
    ok(bound.first === 'Sleeps 4 · Dogs welcome', `the separator binding is still written (${JSON.stringify(bound.first)})`);
    ok(bound.kept, '…and left alone on the next pass');

    console.log('§2 the cottage cards hold still');
    await page.evaluate(() => nav('view-cottages'));
    await page.waitForFunction(() => document.querySelectorAll('#cottages a[data-prop]').length === 3, null, { timeout: 10000 }).catch(() => {});
    const c0 = await page.evaluate(() => {
        const card = /** @type {any} */ (document.querySelector('#cottages a[data-prop="jollyboat"]'));
        if (!card) return null;
        card.__probe = 'jb';
        card.focus();
        return { focused: document.activeElement === card, wired: !!card.__mapWired };
    });
    ok(!!c0 && c0.focused, '(fixture) a card has keyboard focus');
    ok(!!c0 && c0.wired, 'the cards on screen carry their map hover');
    await tick();
    await tick();
    const c1 = await page.evaluate(() => {
        const card = /** @type {any} */ (document.querySelector('#cottages a[data-prop="jollyboat"]'));
        return { same: !!card && card.__probe === 'jb', focused: !!card && document.activeElement === card };
    });
    ok(c1.same, 'two live ticks later it is the same card');
    ok(c1.focused, '…and keyboard focus is still on it');
    props[1].couple_rate = 199;
    await tick();
    const c2 = await page.evaluate(() => {
        const card = /** @type {any} */ (document.querySelector('#cottages a[data-prop="jollyboat"]'));
        const price = document.getElementById('card-price-jollyboat');
        return { same: !!card && card.__probe === 'jb', price: price ? price.textContent : '' };
    });
    ok(c2.same && /£199/.test(c2.price), `a new price is written into the same card (${c2.price.trim().slice(0, 30)})`);
    props[1].name = 'Jollyboat Cottage by the Quay';
    await tick();
    const c3 = await page.evaluate(() => {
        const card = /** @type {any} */ (document.querySelector('#cottages a[data-prop="jollyboat"]'));
        return { fresh: !!card && card.__probe !== 'jb', text: card ? card.textContent : '', wired: !!card && !!card.__mapWired };
    });
    ok(c3.fresh && /by the Quay/.test(c3.text), 'a renamed cottage rebuilds its card with the new name');
    ok(c3.wired, '…and the new card is wired for the map hover');

    console.log(fails ? `\n${fails} FAILED` : '\nALL STEADY CHECKS PASSED');
    await done(fails);
})();
