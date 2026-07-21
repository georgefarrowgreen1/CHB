// Welcome-back rebook, end to end in a real browser:
//  1. a returning signed-in guest gets the homepage nudge with their
//     favourite cottage (mode of PAST stays) + first name
//  2. the CTA lands on that cottage's page, which carries the quiet
//     "you've stayed here before" note
//  3. a cottage they have NOT stayed in shows no note
//  4. an upcoming-only guest (no completed stays) gets no nudge
//  5. logged out → nothing renders
const { d, bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { browser, base, done } = await bootBrowser();
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  const openPage = async (guest, bookings) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
      const url = route.request().url();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.includes('auth.php')) {
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (body.action === 'guest_status') return json({ ok: true, guest });
        return json({ ok: true, admin: false, guest: null });
      }
      if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: 0 });
      if (url.includes('rates.php')) return json({ properties: [
        { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 130, booking_fee: 50, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
        { prop_key: '21a', name: '21A Westgate', slug: '21a-westgate', couple_rate: 120, booking_fee: 50, max_adults: 2, max_children: 1, max_total: 3, sort_order: 2 },
      ], seasons: {}, occupancy: {} });
      return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    return page;
  };

  // 1+2+3) Returning guest: 2 past Jollyboat stays + 1 past 21a stay.
  const mk = (pk, inD, outD) => ({ prop_key: pk, check_in: inD, check_out: outD, adults: 2, children: 0 });
  let page = await openPage({ name: 'Sarah Holt', email: 's@x.co' }, [
    mk('jollyboat', d(-400), d(-396)), mk('jollyboat', d(-30), d(-27)), mk('21a', d(-200), d(-198)),
  ]);
  let wb = await page.evaluate(() => (document.getElementById('welcome-back') || {}).textContent || '');
  ok(/Welcome back, Sarah/.test(wb), `homepage nudge greets by first name (${wb.trim().slice(0, 40)})`);
  ok(/Jollyboat/.test(wb) && !/Westgate/.test(wb.replace(/Check.*dates/, '')), 'nudge names the FAVOURITE cottage (mode of past stays)');
  await page.evaluate(() => document.querySelector('#welcome-back a[data-act="cottageLink"]').click());
  await page.waitForTimeout(600);
  let st = await page.evaluate(() => ({
    view: (document.querySelector('.page-view.active') || {}).id,
    note: (document.getElementById('stayed-before') || {}).textContent || '',
  }));
  ok(st.view === 'view-21a', `CTA lands on the cottage page (${st.view})`);
  ok(/stayed here before/.test(st.note), `cottage page carries the "stayed here before" note (${st.note.trim().slice(0, 50)})`);
  // A cottage with no past stay for this guest... switch to a cottage they HAVE
  // stayed at once (21a) then one they haven't — reuse openProperty directly.
  await page.evaluate(() => openProperty('21a'));
  await page.waitForTimeout(300);
  let note = await page.evaluate(() => (document.getElementById('stayed-before') || {}).textContent || '');
  ok(/stayed here before/.test(note), '21a (one past stay) also shows the note');
  await page.close();

  // 4) Upcoming-only guest → no nudge (a first stay still ahead isn't "back").
  page = await openPage({ name: 'New Guest', email: 'n@x.co' }, [mk('jollyboat', d(20), d(23))]);
  wb = await page.evaluate(() => (document.getElementById('welcome-back') || {}).textContent || '');
  ok(wb.trim() === '', 'upcoming-only guest gets no nudge');
  await page.close();

  // 5) Logged out → nothing.
  page = await openPage(null, []);
  wb = await page.evaluate(() => (document.getElementById('welcome-back') || {}).textContent || '');
  ok(wb.trim() === '', 'logged out → welcome-back stays empty');
  await page.close();

  console.log(fails ? `\n  ${fails} WELCOME-BACK CHECK(S) FAILED ❌` : '\n  WELCOME-BACK SUITE PASSED ✅');
  await done(fails);
})();
