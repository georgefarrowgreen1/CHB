// Edit-a-confirmed-booking price lock, on the ONE booking sheet (#edit-modal
// .modal-box.bks — the sectioned form and its "Agreed total" price box are gone).
// While the stay is unchanged the sheet must state the AGREED (locked) price —
// exactly what saving preserves — and only reprice at today's rates, SAYING that
// saving replaces the agreed figure, once the stay actually changes. Reproduces
// the owner's Richard Berry case: agreed at £135/night (£631.20 with the £75
// deposit) against live rates of £165/night.
//
// Deleted with their subject: the old box's "Agreed total" label, its "locked at
// the rates in effect when booked" note and its × N nights grand line. The sheet
// says the same facts in its own rows (the "N nights" row, its sub, the night by
// night fold, the Total row), which is what the checks below read.
//
// Reduced motion: folds open without a transition, so every wait is on state.
const { d, boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

(async () => {
  const { page, base, done } = await boot({ viewport: { width: 1000, height: 1200 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const updates = [];
  const agreed = { agreed_total: 556.2, agreed_per_night: 135, agreed_nights: 4, agreed_nightly: 540, agreed_booking_fee: 75, agreed_txn_pct: 3, agreed_txn_fee: 16.2, agreed_on: d(-20) };
  const base0 = { prop_key: 'jollyboat', phone: '', address: '', postcode: '', check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, notes: '' };
  await page.route(/\.php/, (route) => {
    const url = route.request().url();
    const post = route.request().postData() || '';
    let act = ''; try { act = JSON.parse(post || '{}').action || ''; } catch (e) {}
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('admin-bootstrap.php')) return json({ ok: false });
    if (url.includes('rates.php')) return json({ properties: [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 165, extra_adult_rate: 0, child_rate: 0, booking_fee: 75, transaction_pct: 3, lastmin_pct: 0, lastmin_days: 0, sort_order: 1 }], seasons: {}, occupancy: { jollyboat: { maxAdults: 2, maxChildren: 0, maxTotal: 2 } } });
    if (url.includes('bookings.php')) {
      if (act === 'update') { try { updates.push(JSON.parse(post)); } catch (e) {} return json({ ok: true, material: false }); }
      if (act) return json({ ok: true, logs: {}, history: [] });
      return json({ bookings: [
        // Richard Berry: paid in full by card, the £75 deposit charged with it.
        Object.assign({ id: 37, name: 'Richard Berry', email: 'r@e.com', check_in: d(2), check_out: d(6), payment: 'paid', deposit_paid: 631.2, hold_status: 'charged', hold_amount: 75 }, base0, agreed),
        // The SAME agreed price, part-paid — the sheet's ordinary (unlocked) price rows.
        Object.assign({ id: 39, name: 'Dora Deposit', email: 'dora@e.com', check_in: d(20), check_out: d(24), payment: 'deposit', deposit_paid: 200, payment_method: 'Card', payment_date: d(-19), hold_status: 'none' }, base0, agreed),
        // An AGREED price: £260 for two nights against a standard £278.10 (2 x £135 + 3%), paid in full
        // by bank transfer with the £50 refundable deposit on top. The shape Tina Nudd's booking has.
        { id: 38, prop_key: 'jollyboat', name: 'Tina Nudd', email: 't@e.com', phone: '', address: '', postcode: '', check_in: d(9), check_out: d(11), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 310, payment_method: 'Bank transfer', payment_date: d(-11), agreed_total: 260, price_override: 260, price_reason: 'Returning guest', agreed_per_night: 135, agreed_nights: 2, agreed_nightly: 270, agreed_booking_fee: 50, agreed_txn_pct: 3, agreed_txn_fee: 8.1, agreed_on: d(-11), hold_status: 'none', notes: '' }] });
    }
    return json({ ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
  await page.evaluate(() => window.loadAdminBundle());
  await page.waitForFunction(() => window.__ADMIN_LOADED === true && typeof window.bksSync === 'function');
  await page.evaluate(() => loadData());
  await page.waitForFunction(() => (dbBookings.jollyboat || []).length === 3 && propertyRates.jollyboat && propertyRates.jollyboat.coupleRate === 165);

  const open = async (id) => {
    await page.evaluate((x) => openEditBooking(x), id);
    await page.waitForFunction(() => document.getElementById('edit-modal').classList.contains('open') && !!document.querySelector('#edit-modal .modal-box.bks'));
  };
  // The price card as the owner reads it: the nights row (label, sub, figure),
  // the night-by-night fold OPENED (a closed fold measures nothing), the total.
  const price = async () => {
    await page.evaluate(() => { const r = document.getElementById('bks-nights-row'); if (r && !r.disabled && r.getAttribute('aria-expanded') !== 'true') r.click(); });
    return page.evaluate(() => {
      const t = (id) => ((document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
      return {
        label: t('bks-n-l'), sub: t('bks-n-s'), warn: document.getElementById('bks-n-s').classList.contains('warn'),
        fig: t('bks-n-v'), total: t('bks-tot'), totSub: t('bks-tot-s'),
        lines: [...document.querySelectorAll('#bks-nights .bks-night')].map((n) => `${(n.querySelector('.bks-rl') || {}).textContent || ''} ${(n.querySelector('.bks-rv') || {}).textContent || ''}`.trim()),
        card: t('bks-price'),
      };
    });
  };
  // Move the checkout on the sheet's own calendar (the real route, bksDay).
  const leaveOn = async (iso) => {
    await page.click('#bks-t-out');
    await page.waitForFunction(() => document.getElementById('bks-cal-fold').classList.contains('on'));
    for (let i = 0; i < 14; i++) {
      const cell = await page.$(`#bks-cal [data-bks="day"][data-v="${iso}"]`);
      if (cell) { await cell.click(); break; }
      await page.click('#bks-cal [data-bks="nav"][data-v="1"]');
    }
    await page.waitForFunction((x) => document.getElementById('modal-checkout').value === x && !document.getElementById('bks-cal-fold').classList.contains('on'), iso);
  };

  console.log('1. unchanged stay → the AGREED price');
  await open('b39');
  const t1 = await price();
  ok(t1.label === '4 nights' && /Agreed when booked/.test(t1.sub) && !t1.warn, `the price row says the stay is at its agreed price (${t1.label} · ${t1.sub})`);
  ok(t1.fig === '£556.20' && t1.total === '£631.20', `it states the locked £556.20 rental and the £631.20 with the £75 deposit (${t1.fig} / ${t1.total})`);
  ok(t1.lines.some((l) => /^£135\.00 × 4 nights £540\.00$/.test(l)) && t1.lines.some((l) => /Card fee \(3%\) £16\.20/.test(l)),
    `agreed £135/night, not today's £165, night by night (${t1.lines.join(' | ')})`);
  ok(!/£165|£849\.75|£660\.00/.test(t1.card), 'no live-rate figure leaks into the card');

  console.log("2. change the stay → today's rates, and the sheet says saving replaces the agreed total");
  await leaveOn(d(25));
  const t2 = await price();
  ok(t2.label === '5 nights' && t2.fig === '£849.75', `a 5-night stay reprices at today's £165 + 3% (${t2.label} · ${t2.fig})`);
  ok(t2.lines.filter((l) => /£165\.00$/.test(l)).length === 5, `…every night at today's rate (${t2.lines.length} lines)`);
  ok(/Today.s rates · replaces the agreed £631\.20/.test(t2.sub) && t2.warn, `…with the explicit note that saving replaces the agreed £631.20, in warn ink (${t2.sub})`);

  console.log('3. change back → locked again');
  await leaveOn(d(24));
  const t3 = await price();
  ok(/Agreed when booked/.test(t3.sub) && !t3.warn && t3.fig === '£556.20' && t3.total === '£631.20', `reverting the dates restores the agreed figures (${t3.sub} · ${t3.fig})`);
  await page.evaluate(() => closeModal());

  console.log('3b. the same lock on a booking PAID IN FULL (Richard Berry)');
  await open('b37');
  const r1 = await price();
  ok(r1.fig === '£556.20' && r1.total === '£631.20' && !/£165/.test(r1.card), `the paid booking states its locked price (${r1.fig} / ${r1.total})`);
  await leaveOn(d(7));
  const r2 = await price();
  ok(r2.fig === '£849.75', `moving its dates reprices it at today's rates (${r2.fig})`);
  // The paid lock REPLACES the price row's sub with "Paid in full · money is
  // managed on the booking page", which also swallowed this note: the figure
  // changes, the server re-snapshots, and the sheet still reads "Paid in full".
  ok(/replaces the agreed £631\.20/.test(r2.sub), `…and still says that saving replaces the agreed £631.20 (sub: "${r2.sub}")`);
  await page.evaluate(() => closeModal());

  console.log("4. an edit keeps the booking's MONEY — the agreed price, the deposit, the reason");
  // The Edit form used to open with these inputs BLANK (openEditBookingNow never
  // fed them in) while saveModal posted every one of them, with price_override ''
  // meaning "clear it". A paid stay hides the inputs, so a save that changed
  // NOTHING dropped the agreed price, wiped the payment method and re-dated the
  // payment to today. The sheet keeps the store fed AND an edit no longer posts
  // payment fields at all (absent = the server keeps them).
  await open('b38');
  const f4 = await page.evaluate(() => {
    const v = (id) => (document.getElementById(id) || {}).value;
    return { ov: v('modal-price-override'), method: v('modal-payment-method'), date: v('modal-payment-date'), amt: v('modal-deposit-amount'), dep: v('modal-damages-deposit'),
      rcvd: (document.getElementById('bks-rcvd') || {}).textContent || '', total: (document.getElementById('bks-tot') || {}).textContent || '' };
  });
  ok(f4.ov === '260', `the agreed price is in the store, not blank (${JSON.stringify(f4.ov)})`);
  ok(f4.method === 'Bank transfer' && f4.date === d(-11) && f4.amt === '310', `…and so are how, WHEN and how much they paid (${f4.method} / ${f4.date} / ${f4.amt})`);
  ok(f4.dep === '50' && f4.total === '£310.00' && f4.rcvd === '£310.00', `…the agreed deposit, and the sheet says £310.00 of £310.00 received (${f4.dep} / ${f4.total} / ${f4.rcvd})`);
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
  for (let i = 0; i < 40 && !updates.length; i++) await page.waitForTimeout(100);
  const u = updates[updates.length - 1] || {};
  ok(u.id === 38 && u.price_override === 260, `a save with NOTHING changed still posts the agreed price (${JSON.stringify(u.price_override)})`);
  ok(u.damages_deposit === 50 && u.price_reason === 'Returning guest', `…the deposit it was agreed at, and why the price is custom (${u.damages_deposit} / ${u.price_reason})`);
  const moneyKeys = ['payment', 'deposit', 'payment_method', 'payment_date'].filter((k) => k in u);
  ok(moneyKeys.length === 0, `…and NO payment fields — absent keeps the method, the date and the status (${moneyKeys.join(',') || 'none'})`);

  // A booking with NO override must still post '' — the clear is a real action when
  // the owner empties a field that held a value, and must not become "never clear".
  updates.length = 0;
  await open('b37');
  await page.click('#modal-save-btn');
  await page.waitForFunction(() => !document.getElementById('edit-modal').classList.contains('open'));
  for (let i = 0; i < 40 && !updates.length; i++) await page.waitForTimeout(100);
  const u2 = updates[updates.length - 1] || {};
  ok(u2.id === 37 && u2.price_override === '', `a booking with no agreed price posts no price (${JSON.stringify(u2.price_override)})`);

  console.log(fails ? `PRICE-LOCK TEST FAILED ❌ (${fails})` : 'PRICE-LOCK TEST PASSED ✅');
  await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
