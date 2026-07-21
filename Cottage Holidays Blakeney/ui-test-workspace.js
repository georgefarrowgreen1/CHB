// PR-2 behaviours: the Today dashboard IS the bookings workspace.
//  1. wide: one screen holds timeline + rows + auto-docked hub, and the
//     auto-select must NOT scroll the page (quiet)
//  2. wide: tapping a TIMELINE BAR swaps the docked hub on the same screen
//     and scrolls the pane into view
//  3. narrow: a bar tap opens the standalone hub view
//  4. openBookings() alias lands on the dashboard at the workspace
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
// Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1280, height: 800 } });

  const mk = (id, ci, co, name) => ({
    id, prop_key: '21a', name, email: 'g@gmail.com', phone: '', address: '1 Lane', postcode: 'NR25 7AB',
    check_in: ci, check_out: co, check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
    payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '', agreed_total: 440,
    agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0,
    agreed_txn_fee: 0, agreed_on: d(0), hold_status: 'none', notes: '',
  });
  const rows = [mk(1, d(5), d(8), 'First Guest'), mk(2, d(20), d(23), 'Second Guest')];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') return json({ ok: true, events: [], logs: {} });
    if (url.includes('bookings.php')) return json({ bookings: rows });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(600);
  await page.evaluate(async () => { nav('view-backoffice'); await initBackOffice(); });
  await page.waitForTimeout(1200);

  console.log('1. one wide screen: timeline + rows + quiet auto-dock');
  const w1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    tlDays: document.querySelectorAll('#cal-body .tl-day').length,
    rows: document.querySelectorAll('#bookings-list .bk-row').length,
    docked: !!document.querySelector('#bookings-detail-pane #booking-hub-content .bhub-head'),
    hubName: (document.querySelector('#bookings-detail-pane .bhub-name') || {}).textContent || '',
    scrollY: window.scrollY,
  }));
  ok(w1.active === 'view-backoffice', `dashboard active (${w1.active})`);
  ok(w1.tlDays > 20 && w1.rows === 2, `timeline (${w1.tlDays} days) + ${w1.rows} booking rows on ONE screen`);
  ok(w1.docked && w1.hubName === 'First Guest', `first booking auto-docked in the pane (${w1.hubName})`);
  ok(w1.scrollY === 0, `auto-select did NOT scroll the page (scrollY ${w1.scrollY})`);

  console.log('2. timeline bar tap swaps the docked hub + scrolls to it');
  await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('#cal-body .tl-bar')).find((b) => b.textContent.trim() === 'Second');
    bar.click();
  });
  await page.waitForTimeout(1200);
  const w2 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    hubName: (document.querySelector('#bookings-detail-pane .bhub-name') || {}).textContent || '',
    rowOpen: (document.querySelector('#bookings-list .bk-row.is-open strong') || {}).textContent || '',
    paneVisible: (() => { const r = document.getElementById('bookings-detail-pane').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })(),
  }));
  ok(w2.active === 'view-backoffice', `bar tap keeps the dashboard (${w2.active})`);
  ok(w2.hubName === 'Second Guest', `docked hub swapped to the tapped booking (${w2.hubName})`);
  ok(w2.rowOpen === 'Second Guest', `its index row highlights (${w2.rowOpen})`);
  ok(w2.paneVisible, 'the docked hub was scrolled into view');

  console.log('3. narrow: bar tap opens the standalone hub');
  await page.setViewportSize({ width: 390, height: 850 });
  await page.waitForTimeout(900); // resize listener re-parents
  await page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('#cal-body .tl-bar')).find((b) => b.textContent.trim() === 'First');
    if (bar) bar.click();
  });
  await page.waitForTimeout(900);
  const n1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    hubName: (document.querySelector('#view-booking-hub .bhub-name') || {}).textContent || '',
  }));
  ok(n1.active === 'view-booking-hub' && n1.hubName === 'First Guest', `narrow bar tap → standalone hub (${n1.active}, ${n1.hubName})`);
  await page.evaluate(() => bookingHubBack());
  await page.waitForTimeout(900);
  const n2 = await page.evaluate(() => (document.querySelector('.page-view.active') || {}).id);
  ok(n2 === 'view-backoffice', `hub back returns to the dashboard (${n2})`);

  console.log('4. openBookings alias');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { nav('view-main'); window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.openBookings());
  await page.waitForTimeout(1400);
  const a1 = await page.evaluate(() => ({
    active: (document.querySelector('.page-view.active') || {}).id,
    wsVisible: (() => { const r = document.getElementById('bookings-workspace').getBoundingClientRect(); return r.top < window.innerHeight; })(),
    rows: document.querySelectorAll('#bookings-list .bk-row').length,
  }));
  ok(a1.active === 'view-backoffice' && a1.rows === 2, `openBookings lands on the dashboard with the list rendered (${a1.active}, ${a1.rows} rows)`);
  ok(a1.wsVisible, 'and scrolls to the bookings workspace');

  console.log(fails ? `MERGED WORKSPACE TEST FAILED ❌ (${fails})` : 'MERGED WORKSPACE TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
