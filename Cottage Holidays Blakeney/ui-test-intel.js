// Ambient intelligence, end to end in a real browser:
//  1. a repeat guest's booking hub leads with the "Knows your guest" card
//     (ordinal + lifetime from the unified directory, strong identity)
//  2. a first-time guest's hub has NO intel card (empty dossier = noise)
//  3. the Manage → Pricing page carries the gap row with chbGapPlan's DECISION —
//     a one-tap dated offer (15% off the current rate), not a Book action
//  4. tapping Offer SAVES the 'Gap offer' override through seasons_save and
//     the row flips to its live status (routing to Rates)
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 390, height: 844 } });

  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const mk = (id, name, email, ci, co) => ({ id, prop_key: 'jollyboat', name, email, phone: '', check_in: ci, check_out: co, adults: 2, children: 0, payment: 'paid', agreed_total: 440, hold_status: 'none' });
  // Alice is a REPEAT guest (same email, two stays); Bob + Carol bound a
  // 3-night gap starting 8 days out; Carol is also the first-time control.
  const bookings = [
    mk(1, 'Alice Harper', 'a@x.co', d(40), d(43)),
    mk(2, 'Alice Harper', 'a@x.co', d(60), d(63)),
    mk(3, 'Bob Mills', 'b@x.co', d(5), d(8)),
    mk(4, 'Carol Reeve', 'c@x.co', d(11), d(14)),
  ];
  const saved = []; // seasons_save payloads the page writes
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('bookings.php') && route.request().method() !== 'POST') return json({ bookings });
    if (url.includes('rates.php')) {
      if (route.request().method() === 'POST') {
        try { const b = JSON.parse(route.request().postData() || '{}'); if (b.action === 'seasons_save') saved.push(b); } catch (e) {}
        return json({ ok: true });
      }
      return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
      ], seasons: {}, occupancy: {} });
    }
    return json({ ok: true, events: [], logs: {}, results: [], threads: [], enquiries: [], reviews: [], photos: [], value: null, corpus: [] });
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { isAuthenticated = true; document.body.classList.add('owner-mode'); await window.loadAdminBundle(); });
  await page.evaluate(() => loadData()); await page.waitForTimeout(400);
  await page.evaluate(() => nav('view-backoffice')); await page.waitForTimeout(500);

  // 1) Repeat guest's hub leads with the intel card. (Loaded booking ids are
  // client-prefixed, so resolve Alice's SECOND stay from the data.)
  await page.evaluate(() => {
    const b = dbBookings.jollyboat.filter((x) => x.email === 'a@x.co').sort((a, z) => a.checkIn.localeCompare(z.checkIn))[1];
    openBookingHub(b.id);
  });
  await page.waitForTimeout(500);
  let card = await page.evaluate(() => {
    const c = document.getElementById('hub-intel-card');
    return c ? c.textContent : null;
  });
  ok(!!card, 'repeat guest: the "Knows your guest" card renders on the hub');
  ok(card && /2nd stay/.test(card), `card carries the visit ordinal (${(card || '').slice(0, 60).trim()})`);
  ok(card && /lifetime/.test(card), 'card carries the lifetime figures');

  // 2) First-timer gets no card.
  await page.evaluate(() => openBookingHub(dbBookings.jollyboat.find((x) => x.email === 'c@x.co').id)); await page.waitForTimeout(400);
  const none = await page.evaluate(() => !document.getElementById('hub-intel-card'));
  ok(none, 'first-time guest: no intel card (nothing worth knowing)');

  // 3) The Manage → Pricing page decides the gap's best outcome: a one-tap
  // DISCOUNT offer off the £130 rate (the depth is set by the demand model, so
  // assert a valid discount rather than a hardcoded %), never a manual Book.
  // (These recommendations moved OFF the Today ops strip and onto their own page.)
  await page.evaluate(() => { nav('view-settings'); settingsOpen('pricing'); }); await page.waitForTimeout(300);
  await page.evaluate(() => renderPricing());
  const gap = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#pricing-body .ny-row')].find((r) => /night gap on/.test(r.textContent));
    return row ? row.textContent : null;
  });
  const gapM = gap && gap.match(/offer £(\d+)\/night/);
  const offerVal = gapM ? +gapM[1] : 0;
  ok(!!gap && /Fill the 3-night gap on Jollyboat: offer £\d+\/night/.test(gap) && offerVal >= 20 && offerVal < 130, `Manage → Pricing leads with the priced offer (${(gap || 'none').slice(0, 90).trim()})`);
  ok(!!gap && /\d+% off the usual £130/.test(gap) && /Offer ›/.test(gap), `…with the discount maths + an Offer action, not Book (${(gap || 'none').slice(-60).trim()})`);

  // 4) Tapping Offer SAVES the dated 'Gap offer' override (at the rate the row
  // showed) and the row flips to its live status.
  await page.evaluate(() => { [...document.querySelectorAll('#pricing-body .ny-row')].find((r) => /night gap on/.test(r.textContent)).click(); });
  await page.waitForTimeout(600);
  const pay = saved.find((b) => b.prop_key === 'jollyboat');
  const season = pay && (pay.seasons || []).find((s) => s.label === 'Gap offer');
  ok(!!season && season.rate === offerVal && season.start === d(8) && season.end === d(10), `Offer saved the dated override via seasons_save (${JSON.stringify(season)})`);
  const live = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#pricing-body .ny-row')].find((r) => /Offer live on/.test(r.textContent));
    return row ? row.textContent : null;
  });
  ok(!!live && new RegExp(`Offer live on Jollyboat — £${offerVal}\\/night`).test(live) && /Rates ›/.test(live), `the row flips to its live status routing to Rates (${(live || 'none').slice(0, 90).trim()})`);

  console.log(fails ? `\n  ${fails} INTEL CHECK(S) FAILED ❌` : '\n  INTEL SUITE PASSED ✅');
  await done(fails);
})();
