// A VISITOR IS SENT THE REVIEWS THE PAGE SHOWS (reviews.php reviews_summary). Every review
// rode every visitor's first load; a visitor now gets the figures the page states and only
// the reviews on screen, and "Read all" asks for the rest. Driven in a real browser against
// a summary built the way the server builds it, from a fixture whose figures DIFFER from
// what the reviews on screen alone would give, so a page counting its list fails by name:
//   1. the cottage cards, the cottage page's figures, the enquiry summary, the homepage's
//      rating and the host card state the summary's figures
//   2. the cottage page shows four reviews and offers "Read all <the real count>"
//   3. "Read all" shows what it has at once, says the rest is coming, and then shows
//      every review; a failed ask says so and keeps the newest; an answer that lands
//      after its window closed, or after another opened, paints nothing; once one has
//      landed the window opens on it, and a failed refresh leaves it as it was
//   4. the search-result markup states the guests' figures and lists twelve
//   5. the owner's shape (every review held) still counts its own list and asks nothing
const { bootBrowser } = require('./ui-test-lib');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const prop = (key, name) => ({
  prop_key: key, name, slug: key, couple_rate: 130, extra_adult_rate: 45, child_rate: 30,
  booking_fee: 60, transaction_pct: 0, weekend_pct: 0, weekend_days: '5,6',
  lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 4, sort_order: 1,
  address: '1 Test Lane, Blakeney',
});
// Thirty reviews in the site's order: sixteen from guests, then fourteen of the owner's.
// Pimpernel's are three stars and its later ones one, so no figure the page states comes
// out the same from the reviews on screen as from all of them.
const FULL = Array.from({ length: 30 }, (_, i) => ({
  name: 'Reviewer ' + i,
  stars: i % 3 === 0 ? (i >= 16 ? 1 : 3) : i % 5 === 0 ? 4 : 5,
  text: `Review number ${i}, a lovely stay with words enough to quote`,
  prop: i % 3 === 0 ? 'pimpernel' : 'jollyboat',
  src: i < 16 ? 'g' : 'c',
}));
const star = (r) => Math.max(1, Math.min(5, parseInt(r.stars) || 5));
// The server's rule (reviews.php reviews_summary), restated for the fixture.
function summarise(all) {
  const props = {};
  let sum = 0;
  const ld = [0, 0];
  const pick = new Set();
  const per = {};
  let rot = 0;
  let ldShown = 0;
  all.forEach((r, i) => {
    const s = star(r);
    sum += s;
    const p = r.prop || '';
    props[p] = [((props[p] || [])[0] || 0) + 1, ((props[p] || [])[1] || 0) + s];
    if ((per[p] || 0) < 4) { pick.add(i); per[p] = (per[p] || 0) + 1; }
    const t = (r.text || '').trim();
    if (rot < 12 && Buffer.byteLength(t) > 20) { pick.add(i); rot++; }
    if (r.src === 'g' && t) { ld[0]++; ld[1] += s; if (ldShown < 12) { pick.add(i); ldShown++; } }
  });
  return { v: 2, list: all.filter((_, i) => pick.has(i)), n: all.length, sum, props, ld };
}
const SUM = summarise(FULL);
const fig = (list) => ({ n: list.length, avg: list.length ? list.reduce((t, r) => t + star(r), 0) / list.length : 0 });
const want = {
  all: { n: SUM.n, avg: SUM.sum / SUM.n },
  jolly: { n: SUM.props.jollyboat[0], avg: SUM.props.jollyboat[1] / SUM.props.jollyboat[0] },
  pimp: { n: SUM.props.pimpernel[0], avg: SUM.props.pimpernel[1] / SUM.props.pimpernel[0] },
  ld: { n: SUM.ld[0], avg: SUM.ld[1] / SUM.ld[0] },
};
const shownJolly = SUM.list.filter((r) => r.prop === 'jollyboat').length;
const shownPimp = SUM.list.filter((r) => r.prop === 'pimpernel').length;

async function openSite(browser, base, reviewsPart, content, ctl) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route(/\.php/, async (route) => {
    const url = route.request().url();
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') return json({ ok: true });
    const rates = { properties: [prop('jollyboat', 'Jollyboat'), prop('pimpernel', 'Pimpernel')], seasons: {}, occupancy: {} };
    if (url.includes('reviews.php') && url.includes('all=1')) {
      ctl.asks.push(url);
      const hold = ctl.hold.shift();
      if (hold) await hold;
      const fail = ctl.fail;
      await (fail ? json({ error: 'Down for a moment' }, 500) : json({ v: 2, list: FULL }));
      ctl.done = (ctl.done || 0) + 1;
      return;
    }
    if (url.includes('bootstrap.php')) return json({ ok: true, rates, content: { content }, reviews: reviewsPart, square: { enabled: false } });
    if (url.includes('rates.php')) return json(rates);
    if (url.includes('content.php')) return json({ content });
    if (url.includes('reviews.php')) return json(reviewsPart);
    return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], ranges: [], value: null, content });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[id^="card-rating-"]').length > 0 && /review/.test((document.getElementById('card-rating-jollyboat') || {}).textContent || ''), null, { timeout: 15000 });
  return page;
}
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const modal = (page) => page.evaluate(() => ({
  open: document.getElementById('reviews-modal').classList.contains('open'),
  cards: document.querySelectorAll('#reviews-modal-list .review-card').length,
  names: [...document.querySelectorAll('#reviews-modal-list .review-who')].map((e) => e.textContent.trim().split(' — ')[0]),
  note: ((document.querySelector('#reviews-modal-list .reviews-more') || {}).textContent || '').trim(),
}));
// A request reaches the route a moment after the page sends it: wait for it, never a clock.
const until = async (cond, ms = 5000) => { for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 25)); return cond(); };
const waitModal = (page, fn, arg = null, ms = 5000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

(async () => {
  const t = await bootBrowser();
  console.log(`(the fixture: ${FULL.length} reviews, ${SUM.list.length} on screen; Jollyboat ${want.jolly.n} at ${want.jolly.avg.toFixed(1)}, ${shownJolly} on screen)`);
  const onScreen = fig(SUM.list);
  const onScreenLd = fig(SUM.list.filter((r) => r.src === 'g'));
  ok(SUM.list.length < FULL.length && shownJolly < want.jolly.n && onScreenLd.n < want.ld.n
    && onScreen.avg.toFixed(1) !== want.all.avg.toFixed(1) && onScreenLd.avg.toFixed(1) !== want.ld.avg.toFixed(1),
    '(vacuity) the reviews on screen give different counts and averages from the figures, so a page counting its list fails');

  console.log('1. the figures are the summary\'s');
  const ctl = { asks: [], hold: [], fail: false };
  const page = await openSite(t.browser, t.base, SUM, {}, ctl);
  const card = (k) => page.evaluate((key) => (document.getElementById('card-rating-' + key) || {}).textContent || '', k);
  ok((await card('jollyboat')).replace(/\s+/g, ' ').trim() === `★ ${want.jolly.avg.toFixed(1)} · ${want.jolly.n} reviews`, `the Jollyboat card: "${(await card('jollyboat')).replace(/\s+/g, ' ').trim()}"`);
  ok((await card('pimpernel')).replace(/\s+/g, ' ').trim() === `★ ${want.pimp.avg.toFixed(1)} · ${want.pimp.n} reviews`, `the Pimpernel card: "${(await card('pimpernel')).replace(/\s+/g, ' ').trim()}"`);
  const fav = await page.evaluate(() => { const f = document.getElementById('cott-fav-jollyboat'); return f ? !f.hidden : null; });
  ok(fav === (want.jolly.n >= 3 && want.jolly.avg >= 4.8), `…and its "Guest favourite" follows the summary (${fav})`);
  const home = await page.evaluate(() => { updateHeritageStats(); return (document.getElementById('heritage-rating') || {}).textContent || ''; });
  ok(home === '★ ' + (Math.round(want.all.avg * 10) / 10).toFixed(1), `the homepage rating is every review's: "${home}"`);
  const host = await page.evaluate(() => hostReviewFigures());
  ok(host.count === String(want.all.n) && host.rating === want.all.avg.toFixed(1) + ' ★', `the host card counts every review: ${host.count} · ${host.rating}`);
  const rot = await page.evaluate(() => { renderGuestWords(); return __gwList.length; });
  ok(rot === SUM.list.filter((r) => (r.text || '').trim().length > 20).length && rot >= 12, `the homepage rotates the quotes it was sent (${rot})`);
  await page.evaluate(() => { openProperty('jollyboat'); });
  await page.waitForFunction(() => !!document.querySelector('#prop-reviews .review-card'), null, { timeout: 8000 });
  const pr = await page.evaluate(() => ({
    cards: document.querySelectorAll('#prop-reviews .review-card').length,
    count: ((document.querySelector('#prop-reviews .prop-reviews-count') || {}).textContent || '').trim(),
    btn: ((document.querySelector('#prop-reviews [data-act="openAllReviews"]') || {}).textContent || '').trim(),
    stats: ((document.getElementById('prop-stats') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  ok(pr.cards === 4, `the cottage page shows four reviews (${pr.cards})`);
  ok(pr.count === `${want.jolly.n} reviews` && pr.btn === `Read all ${want.jolly.n} reviews`, `…counts every one ("${pr.count}") and offers them all ("${pr.btn}")`);
  ok(pr.stats.includes(want.jolly.avg.toFixed(1)) && pr.stats.includes(String(want.jolly.n)), `…and its figures say so too ("${pr.stats}")`);
  const enq = await page.evaluate(() => { openEnquireModal(); return (document.getElementById('enq-sum-rating') || {}).innerText || ''; });
  ok(enq === `★ ${want.jolly.avg.toFixed(1)} · ${want.jolly.n} reviews`, `the enquiry summary: "${enq}"`);
  await page.evaluate(() => { try { closeEnquireModal(); } catch (e) {} });

  console.log('2. "Read all" asks for the rest');
  // A failed ask, with nothing held yet: the newest, and a sentence saying so.
  ctl.fail = true;
  await page.evaluate(() => openAllReviews('jollyboat'));
  await waitModal(page, () => /Couldn't load/.test(((document.querySelector('#reviews-modal-list .reviews-more') || {}).textContent || '')));
  let m = await modal(page);
  ok(m.open && m.cards === shownJolly && /^Couldn't load every review just now\. These are the newest\.$/.test(m.note), `a failed ask keeps the newest and says so (${m.cards}, "${m.note}")`);
  ok((await until(() => ctl.asks.length === 1)) && /reviews\.php\?all=1/.test(ctl.asks[0]), `…having asked for every review (${ctl.asks.length})`);
  await page.evaluate(() => closeAllReviews());
  ctl.fail = false;
  // Two asks held: the first window is closed and another opened before either lands.
  const g1 = gate();
  const g2 = gate();
  ctl.hold.push(g1.p, g2.p);
  await page.evaluate(() => openAllReviews('jollyboat'));
  m = await modal(page);
  ok(m.cards === shownJolly && m.note === 'Loading the rest…', `it opens at once with what it has (${m.cards}) and says the rest is coming ("${m.note}")`);
  await page.evaluate(() => closeAllReviews());
  await page.evaluate(() => openAllReviews('pimpernel'));
  ok((await until(() => ctl.asks.length >= 3)) && ctl.asks.length === 3, `each opening asks once (${ctl.asks.length - 1} more)`);
  g1.open();
  await new Promise((r) => setTimeout(r, 400));
  m = await modal(page);
  ok(m.cards === shownPimp && m.note === 'Loading the rest…' && m.names.every((nm) => FULL.find((r) => r.name === nm).prop === 'pimpernel'),
    `a late answer for the window closed before paints nothing over the one open now (${m.cards} Pimpernel)`);
  g2.open();
  ok(await waitModal(page, (n) => document.querySelectorAll('#reviews-modal-list .review-card').length === n, want.pimp.n), 'the open window\'s own answer lands');
  m = await modal(page);
  const firstPimp = FULL.find((r) => r.prop === 'pimpernel').name;
  ok(m.cards === want.pimp.n && m.note === '' && m.names[0] === firstPimp, `…every one of Pimpernel's, in the site's order, the line gone (${m.cards})`);
  await page.evaluate(() => closeAllReviews());
  // Once an answer has landed the window opens on it, and the ask only refreshes it.
  const g3 = gate();
  ctl.hold.push(g3.p);
  await page.evaluate(() => openAllReviews('jollyboat'));
  m = await modal(page);
  ok(m.cards === want.jolly.n && m.note === '' && m.names[0] === FULL.find((r) => r.prop === 'jollyboat').name,
    `opened again, it shows every one at once (${m.cards}, "${m.note}")`);
  ok((await until(() => ctl.asks.length >= 4)) && ctl.asks.length === 4, `…and still asks, to stay current (${ctl.asks.length - 3} more)`);
  g3.open();
  await page.evaluate(() => closeAllReviews());
  ctl.fail = true;
  const answered = ctl.done;
  await page.evaluate(() => openAllReviews('jollyboat'));
  await until(() => ctl.done > answered);
  await new Promise((r) => setTimeout(r, 250));
  m = await modal(page);
  ok(ctl.done > answered && m.cards === want.jolly.n && m.note === '', `a failed refresh leaves the full list as it was, with no sentence about the newest (${m.cards})`);
  await page.evaluate(() => closeAllReviews());
  ctl.fail = false;

  console.log('3. the search-result markup');
  const ldNode = await page.evaluate(() => {
    renderSeoText();
    const el = document.getElementById('seo-dynamic');
    const g = el ? JSON.parse(el.textContent)['@graph'] : [];
    return g.find((n) => n['@type'] === 'LodgingBusiness') || null;
  });
  const agg = ldNode && ldNode.aggregateRating;
  ok(!!agg && agg.reviewCount === String(want.ld.n) && agg.ratingValue === want.ld.avg.toFixed(1), `it states every guest review's figures (${agg && agg.reviewCount} · ${agg && agg.ratingValue})`);
  ok(!!ldNode && Array.isArray(ldNode.review) && ldNode.review.length === 12, `…and lists twelve of them (${ldNode && ldNode.review && ldNode.review.length})`);
  await page.close();

  console.log('4. the owner holds every review, and asks nothing');
  const ctl2 = { asks: [], hold: [], fail: false };
  const owner = await openSite(t.browser, t.base, { reviews: FULL.filter((r) => r.src === 'g') }, { reviews: FULL.filter((r) => r.src === 'c') }, ctl2);
  const oc = (await owner.evaluate(() => (document.getElementById('card-rating-jollyboat') || {}).textContent || '')).replace(/\s+/g, ' ').trim();
  ok(oc === `★ ${want.jolly.avg.toFixed(1)} · ${want.jolly.n} reviews`, `the card counts the list it holds ("${oc}")`);
  await owner.evaluate(() => { openProperty('jollyboat'); openAllReviews('jollyboat'); });
  m = await modal(owner);
  ok(m.cards === want.jolly.n && m.note === '' && ctl2.asks.length === 0, `"Read all" shows every one at once and asks nothing (${m.cards}, ${ctl2.asks.length} asks)`);
  await owner.close();

  await t.done(fails);
})().catch(async (e) => { console.error(e); process.exit(1); });
