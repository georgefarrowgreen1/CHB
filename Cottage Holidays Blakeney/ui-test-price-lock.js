// Edit-a-confirmed-booking price lock: while the stay is unchanged the modal
// must show the AGREED (locked) price — exactly what saving preserves — and
// only show today's rates (with an explicit replaces-note) once the stay
// actually changes. Reproduces the owner's Richard Berry case: agreed at
// £135/night (£631.20 grand incl. £75 deposit) vs live rates at £165/night.
// The site reckons "today" in UK time (todayDashed / ukNowParts), so the
// tests must too — pin the whole process (and the browser it launches) to
// Europe/London so fixtures built from new Date() agree with the app on
// any runner, in any timezone. Must run before the first Date call.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, browser, base, done } = await boot({ viewport: { width: 1000, height: 1200 } });
  // Local-formatted, never toISOString() — that's UTC and slips a day near midnight.
  const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  const updates = [];
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 165, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
    if (url.includes('bookings.php')) {
      if (act === 'update') { try { updates.push(JSON.parse(post)); } catch (e) {} return json({ ok: true, material: false }); }
      if (act) return json({ ok: true, logs: {}, history: [] });
      return json({ bookings: [{ id: 37, prop_key: 'jollyboat', name: 'Richard Berry', email: 'r@e.com', phone: '', address: '', postcode: '', check_in: d(2), check_out: d(6), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 631.2, agreed_total: 556.2, agreed_per_night: 135, agreed_nights: 4, agreed_nightly: 540, agreed_booking_fee: 75, agreed_txn_pct: 3, agreed_txn_fee: 16.2, agreed_on: d(-20), hold_status: 'charged', notes: '' },
        // An AGREED price: £260 for two nights against a standard £278.10 (2 x £135 + 3%), paid in full
        // by bank transfer with the £50 refundable deposit on top. The shape Tina Nudd's booking has.
        { id: 38, prop_key: 'jollyboat', name: 'Tina Nudd', email: 't@e.com', phone: '', address: '', postcode: '', check_in: d(3), check_out: d(5), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 310, payment_method: 'Bank transfer', payment_date: d(-11), agreed_total: 260, price_override: 260, agreed_per_night: 135, agreed_nights: 2, agreed_nightly: 270, agreed_booking_fee: 50, agreed_txn_pct: 3, agreed_txn_fee: 8.1, agreed_on: d(-11), hold_status: 'none', notes: '' }] });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForTimeout(700);
  await page.evaluate(() => loadData());
  await page.waitForTimeout(600);

  console.log('1. unchanged stay → the LOCKED price');
  await page.evaluate(() => openEditBooking('b37'));
  await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => (document.getElementById('modal-price-box') || {}).textContent || '');
  ok(/Agreed total/.test(t1), 'labelled "Agreed total"');
  ok(/£631\.20/.test(t1), `shows the locked £631.20 grand (${(t1.match(/£[\d.]+/g) || []).join(' ')})`);
  ok(/£135\.00 × 4 nights/.test(t1.replace(/\s+/g, ' ')), 'agreed £135/night, not today’s £165');
  ok(/locked at the rates in effect when booked/.test(t1), 'locked note shown');
  ok(!/£754\.80/.test(t1) && !/£660\.00/.test(t1), 'no live-rate figures leak in');

  console.log('2. change the stay → today’s rates + explicit replaces-note');
  await page.evaluate(() => {
    const co = document.getElementById('modal-checkout');
    const dt = new Date(co.value); dt.setDate(dt.getDate() + 1);
    co.value = dt.toISOString().slice(0, 10);
    updateModalPrice();
  });
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => (document.getElementById('modal-price-box') || {}).textContent || '');
  ok(/× 5 nights/.test(t2) && /£165|£825/.test(t2), 'live reprice at today’s rates for the new stay');
  ok(/saving replaces the agreed £631\.20/.test(t2), 'explicit note that saving replaces the agreed total');

  console.log('3. change back → locked again');
  await page.evaluate(() => {
    const co = document.getElementById('modal-checkout');
    const dt = new Date(co.value); dt.setDate(dt.getDate() - 1);
    co.value = dt.toISOString().slice(0, 10);
    updateModalPrice();
  });
  await page.waitForTimeout(300);
  const t3 = await page.evaluate(() => (document.getElementById('modal-price-box') || {}).textContent || '');
  ok(/Agreed total/.test(t3) && /£631\.20/.test(t3), 'reverting the dates restores the locked display');

  console.log('4. an edit keeps the booking\'s MONEY — the agreed price, the method, the date');
  // The Edit form used to open with these inputs BLANK (openEditBookingNow never
  // fed them in) while saveModal posts every one of them on every save, with
  // price_override '' meaning "clear it". A paid stay hides the inputs, so a save
  // that changed NOTHING dropped the agreed price, wiped the payment method and
  // re-dated the payment to today. The server only ever did what it was told.
  await page.evaluate(() => openEditBooking('b38'));
  await page.waitForTimeout(700);
  const f4 = await page.evaluate(() => {
    const v = (id) => (document.getElementById(id) || {}).value;
    return { ov: v('modal-price-override'), method: v('modal-payment-method'), date: v('modal-payment-date'), amt: v('modal-deposit-amount'), dep: v('modal-damages-deposit'), pay: v('modal-payment') };
  });
  ok(f4.ov === '260', `the agreed price is in the form, not blank (${JSON.stringify(f4.ov)})`);
  ok(f4.method === 'Bank transfer', `…and so is how they paid (${JSON.stringify(f4.method)})`);
  ok(f4.date === d(-11), `…and WHEN — not today (${JSON.stringify(f4.date)})`);
  ok(f4.dep === '50', `…and the agreed refundable deposit (${JSON.stringify(f4.dep)})`);
  ok(f4.amt === '310', `…and what has been received (${JSON.stringify(f4.amt)})`);
  await page.evaluate(() => { saveModal(); });
  for (let i = 0; i < 20 && !updates.length; i++) await page.waitForTimeout(150);
  const u = updates[updates.length - 1] || {};
  ok(u.price_override === 260, `a save with NOTHING changed still posts the agreed price (${JSON.stringify(u.price_override)})`);
  ok(u.payment_method === 'Bank transfer' && u.payment_date === d(-11), `…the method and the original payment date (${u.payment_method} / ${u.payment_date})`);
  ok(u.payment === 'paid' && u.damages_deposit === 50, `…the status and the deposit it was agreed at (${u.payment} / ${u.damages_deposit})`);
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });

  // A booking with NO override must still post '' — the clear is a real action when
  // the owner empties a field that held a value, and must not become "never clear".
  updates.length = 0;
  await page.evaluate(() => openEditBooking('b37'));
  await page.waitForTimeout(600);
  await page.evaluate(() => { saveModal(); });
  for (let i = 0; i < 20 && !updates.length; i++) await page.waitForTimeout(150);
  const u2 = updates[updates.length - 1] || {};
  ok(u2.price_override === '', `a booking with no agreed price posts no price (${JSON.stringify(u2.price_override)})`);

  console.log(fails ? `PRICE-LOCK TEST FAILED ❌ (${fails})` : 'PRICE-LOCK TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
